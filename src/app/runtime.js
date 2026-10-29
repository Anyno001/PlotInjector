import { buildCheckMessages, cleanFloorText, parseCheckReply } from '../core/check.js';
import { buildEntries, buildIndexText, carriedNodes, toWorldInfoEntry } from '../core/inject.js';
import { parseOutlineReply, rewriteRestMessages } from '../core/prompts.js';
import { flattenUnits, replaceRest, stageLabel, stageNodes, volumeLabel } from '../core/outline.js';
import { advance, currentIndex, emptyProgress, goTo, isMuted, mute, uncheckByNames, unitStates } from '../core/progress.js';
import { resolveLlm } from '../core/store.js';
import { requestLlm } from '../host/llm.js';
import { cardKey, cardName, chatMessages, ctx, hostWindow, toast } from '../host/st.js';
import { writeFallbackBook } from '../host/worldbook.js';
import { readChatState, readProgress, writeProgress } from './progress-store.js';

export const VIRTUAL_WORLD = '剧情注入器';

const placeOf = unit => `${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}`;

// 运行时：注入、每 N 楼检测、偏离大纲时提醒或自动改写。UI 关着也在跑。
// askReason 由入口传入（弹输入框），运行时本身不依赖界面。
export function createRuntime({ data, notice, emit, askReason = async () => '' }) {
    const view = hostWindow();
    let progress = null;
    let progressFor = '';
    let checking = false;
    let mismatchShownFor = '';
    let fallbackTimer = 0;
    const listeners = [];

    function activeId() {
        return data.activeIdFor(cardKey());
    }

    function activeProject() {
        const id = activeId();
        return id ? data.project(id) : null;
    }

    function currentProgress() {
        const id = activeId();
        if (!id) return null;
        if (!progress || progressFor !== id) {
            progress = readProgress(id);
            progressFor = id;
        }
        return progress;
    }

    function units() {
        const project = activeProject();
        return project ? flattenUnits(project.outline.volumes) : [];
    }

    function setProgress(next, reason = 'progress') {
        progress = next;
        progressFor = next.projectId;
        writeProgress(next);
        scheduleFallback();
        emit(reason);
    }

    function entries() {
        const project = activeProject();
        const prog = currentProgress();
        return project && prog ? buildEntries(project, prog, data.settings()) : [];
    }

    function virtualEntries() {
        return entries().filter(entry => entry.enabled && entry.content).map((entry, index) => toWorldInfoEntry(entry, index, VIRTUAL_WORLD));
    }

    function eventTypes() {
        const c = ctx();
        return (c && c.eventTypes) || {};
    }

    function hasEntriesEvent() {
        return Boolean(eventTypes().WORLDINFO_ENTRIES_LOADED);
    }

    function onEntriesLoaded(payload) {
        if (!payload || !Array.isArray(payload.chatLore)) return;
        try {
            payload.chatLore.push(...virtualEntries());
        } catch (error) {
            console.error('[剧情注入器] 注入失败', error);
        }
    }

    // 回退方案 D：没有条目加载事件的旧酒馆，把同样的条目写进专用世界书。
    function scheduleFallback() {
        if (hasEntriesEvent()) return;
        view.clearTimeout(fallbackTimer);
        fallbackTimer = view.setTimeout(async () => {
            const name = `剧情注入器·${cardName() || '未命名'}`;
            try {
                const result = await writeFallbackBook(name, virtualEntries());
                if (result.conflict) toast('warning', `聊天已绑定世界书「${result.conflict}」，剧情注入器的条目写在「${name}」，需要手动启用。`);
            } catch (error) {
                toast('error', `写入专用世界书失败：${error.message}`);
            }
        }, 1000);
    }

    function floorCount() {
        return chatMessages().filter(msg => msg && !msg.is_system).length;
    }

    function activeUnit() {
        const list = units();
        const prog = currentProgress();
        if (!list.length || !prog) return null;
        const states = unitStates(list, prog);
        return list.find(unit => states[unit.id] === 'active') || list[currentIndex(list, prog)];
    }

    function openNext({ silent = false } = {}) {
        const prog = currentProgress();
        const step = prog && advance(prog, units());
        if (!step) {
            if (!silent) toast('info', '已经是最后一段。');
            return null;
        }
        setProgress(step.progress);
        notice.hide('advance');
        return step;
    }

    function backTo(unitId) {
        const prog = currentProgress();
        if (!prog) return;
        setProgress(goTo(prog, units(), unitId));
    }

    function proposeAdvance({ unit, reason = '' }) {
        const settings = data.settings();
        const prog = currentProgress();
        if (!prog || isMuted(prog, unit.id)) return;
        if (settings.handleMode === 'nodes') return;
        const step = advance(prog, units());
        if (!step) return;
        if (settings.handleMode === 'auto') {
            setProgress(step.progress);
            notice.show({
                id: 'advance',
                title: `已切到 ${placeOf(step.to)}`,
                body: reason || '检测判断本阶段已演完。',
                actions: [{ label: '撤销', run: () => backTo(unit.id) }],
                timeout: 12000,
            });
            return;
        }
        notice.show({
            id: 'advance',
            title: `${placeOf(unit)} 已演完`,
            body: reason || '检测判断本阶段已演完。',
            actions: [
                { label: '打开下一段', primary: true, run: () => openNext() },
                { label: '暂不', run: () => notice.hide('advance') },
                { label: '本阶段不再提醒', run: () => setProgress(mute(currentProgress(), unit.id)) },
            ],
        });
    }

    // 按最近正文改写当前段及之后的阶段，直接替换并把进度移到改写后的第一段；返回撤销用的快照。
    async function rewriteRest(reason) {
        const project = activeProject();
        const prog = currentProgress();
        const unit = activeUnit();
        if (!project || !prog || !unit) throw new Error('当前卡没有启用的项目');
        const list = units();
        const from = list.findIndex(item => item.id === unit.id);
        const recent = recentFloors(6).map(floor => floor.text).join('\n\n');
        const reply = await requestLlm(rewriteRestMessages({ setting: project.setting.text, volumes: project.outline.volumes, fromUnitIndex: from, units: list, recent, reason }), resolveLlm(data.settings(), 'outline'));
        const parsed = parseOutlineReply(reply);
        if (!parsed.ok) throw new Error(`改写结果格式有误：${parsed.error}`);
        const before = { volumes: project.outline.volumes, progress: prog };
        const volumes = replaceRest(project.outline.volumes, unit.stage.id, parsed.volumes);
        data.updateProject(project.id, current => ({ ...current, outline: { ...current.outline, volumes } }));
        const first = parsed.volumes[0] && parsed.volumes[0].stages[0];
        if (first) setProgress(goTo(currentProgress(), flattenUnits(volumes), first.id));
        return before;
    }

    function undoRewrite(projectId, before) {
        data.updateProject(projectId, current => ({ ...current, outline: { ...current.outline, volumes: before.volumes } }));
        setProgress(before.progress);
        toast('info', '已撤销改写，恢复原来的大纲和进度。');
    }

    async function runRewrite(reason, { auto = false } = {}) {
        const projectId = activeId();
        notice.show({ id: 'offtrack', title: '正在改写后续阶段…', body: reason });
        try {
            const before = await rewriteRest(reason);
            notice.show({
                id: 'offtrack',
                title: auto ? '剧情偏离大纲，已自动改写后续阶段' : '已改写后续阶段',
                body: reason,
                actions: [{ label: '撤销', run: () => undoRewrite(projectId, before) }],
                timeout: 20000,
            });
        } catch (error) {
            notice.hide('offtrack');
            toast('error', `改写失败：${error.message}`);
        }
    }

    function handleOffTrack(unit, reason) {
        notice.hide('advance');
        if (data.settings().offTrackMode === 'auto') {
            runRewrite(reason, { auto: true });
            return;
        }
        notice.show({
            id: 'offtrack',
            title: `${placeOf(unit)} 偏离大纲`,
            body: `${reason || '正文走向与后续阶段冲突。'}后续阶段可能接不上，建议改写。`,
            actions: [
                { label: '改写后续阶段', primary: true, run: async () => {
                    const note = await askReason(reason);
                    if (note != null) runRewrite(note.trim() || reason);
                } },
                { label: '暂不', run: () => notice.hide('offtrack') },
                { label: '本阶段不再提醒', run: () => {
                    const prog = currentProgress();
                    if (prog && !prog.offMuted.includes(unit.id)) setProgress({ ...prog, offMuted: [...prog.offMuted, unit.id] });
                } },
            ],
        });
    }

    function recentFloors(count) {
        const out = [];
        const chat = chatMessages();
        for (let i = chat.length - 1; i >= 0 && out.length < count; i -= 1) {
            const msg = chat[i];
            if (!msg || msg.is_system) continue;
            const text = cleanFloorText(msg.mes);
            if (text) out.unshift({ index: i, text: `${msg.is_user ? '（用户）' : ''}${text}` });
        }
        return out;
    }

    async function checkNow({ manual = false } = {}) {
        if (checking) return null;
        const project = activeProject();
        const prog = currentProgress();
        const settings = data.settings();
        if (!project || !prog) {
            if (manual) toast('info', '当前卡没有启用的项目。');
            return null;
        }
        const unit = activeUnit();
        if (!unit) return null;
        const floors = recentFloors(settings.checkFloors);
        if (!floors.length) {
            if (manual) toast('info', '还没有可检测的正文。');
            return null;
        }
        checking = true;
        emit('checking');
        try {
            const list = units();
            const states = unitStates(list, prog);
            const index = buildIndexText(list, states, prog, { carryOver: settings.carryOver });
            const reply = await requestLlm(buildCheckMessages(unit, index, floors), resolveLlm(settings, 'check'), { timeoutMs: 120000 });
            const result = parseCheckReply(reply);
            let next = currentProgress();
            next = uncheckByNames(next, unit.id, stageNodes(unit.stage.data), result.done);
            if (settings.carryOver) for (const item of carriedNodes(list, states, prog)) next = uncheckByNames(next, item.unit.id, [item.node], result.done);
            next = { ...next, lastCheckFloor: floorCount() };
            setProgress(next);
            if (result.offTrack && settings.offTrackMode !== 'off' && !next.offMuted.includes(unit.id)) {
                handleOffTrack(unit, result.offReason || result.reason);
            } else if (result.stageDone) {
                proposeAdvance({ unit, reason: result.reason });
            } else if (manual) {
                toast('info', result.reason || '本阶段尚未演完。');
            }
            return result;
        } catch (error) {
            setProgress({ ...currentProgress(), lastCheckFloor: floorCount() });
            toast(manual ? 'error' : 'warning', `进度检测失败：${error.message}`);
            return null;
        } finally {
            checking = false;
            emit('checked');
        }
    }

    function onMessageReceived(messageId) {
        const project = activeProject();
        if (!project) return;
        const settings = data.settings();
        const prog = currentProgress();
        const floors = floorCount();
        if (floors - prog.lastCheckFloor >= settings.checkEvery) view.setTimeout(() => checkNow(), 0);
    }

    function onMessageChanged() {
        const prog = currentProgress();
        if (!prog) return;
        const floors = floorCount();
        if (prog.lastCheckFloor > floors) setProgress({ ...prog, lastCheckFloor: floors });
    }

    async function onChatChanged() {
        progress = null;
        progressFor = '';
        notice.hide('advance');
        notice.hide('offtrack');
        const id = activeId();
        if (id) {
            try {
                await data.loadProject(id);
            } catch (error) {
                toast('error', `读取项目失败：${error.message}`);
            }
        }
        checkMismatch();
        scheduleFallback();
        emit('chat');
    }

    function checkMismatch() {
        const id = activeId();
        const state = readChatState();
        const key = `${cardKey()}|${ctx() && ctx().chatId}`;
        if (!state.projectId || state.projectId === id || mismatchShownFor === key) return;
        const other = data.index().projects.find(item => item.id === state.projectId);
        if (!other) return;
        mismatchShownFor = key;
        notice.show({
            id: 'mismatch',
            title: '此聊天属于另一条线',
            body: `聊天记录的进度属于「${other.name}」，当前启用的是「${(data.index().projects.find(item => item.id === id) || {}).name || '无'}」。`,
            actions: [
                { label: '切过去', primary: true, run: () => { switchProject(other.id); notice.hide('mismatch'); } },
                { label: '保持当前', run: () => notice.hide('mismatch') },
            ],
        });
    }

    async function switchProject(id) {
        if (id) await data.loadProject(id);
        data.setActive(id);
        progress = null;
        progressFor = '';
        scheduleFallback();
        emit('switch');
    }

    function on(eventName, handler) {
        const c = ctx();
        if (!c || !c.eventSource || !eventName) return;
        c.eventSource.on(eventName, handler);
        listeners.push([eventName, handler]);
    }

    function start() {
        const types = eventTypes();
        if (types.WORLDINFO_ENTRIES_LOADED) on(types.WORLDINFO_ENTRIES_LOADED, onEntriesLoaded);
        on(types.CHAT_CHANGED, onChatChanged);
        on(types.MESSAGE_RECEIVED, onMessageReceived);
        on(types.MESSAGE_UPDATED, onMessageChanged);
        on(types.MESSAGE_DELETED, onMessageChanged);
        onChatChanged();
    }

    function stop() {
        const c = ctx();
        for (const [name, handler] of listeners.splice(0)) {
            try { c.eventSource.removeListener(name, handler); } catch { /* 酒馆已卸载 */ }
        }
        view.clearTimeout(fallbackTimer);
    }

    return {
        start,
        stop,
        activeId,
        activeProject,
        progress: () => currentProgress() || emptyProgress(''),
        setProgress,
        units,
        entries,
        openNext,
        backTo,
        checkNow,
        isChecking: () => checking,
        switchProject,
        floorCount,
        recentFloors,
        rewriteRest,
        injectMode: () => (hasEntriesEvent() ? 'virtual' : 'book'),
        refresh: () => { scheduleFallback(); emit('progress'); },
    };
}
