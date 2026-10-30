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

const LOG_MAX = 40;
// 主回复没结束时先挂起检测，最多等这么久。
const PENDING_MAX_MS = 30000;

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
    let generating = false;
    let chatStartFloors = 0;
    let pendingCheck = false;
    let pendingTimer = 0;
    const listeners = [];
    const stats = {};
    const logs = [];

    // 诊断页用：最近的事件与检测判断。
    function log(text) {
        logs.push({ at: Date.now(), text });
        if (logs.length > LOG_MAX) logs.shift();
    }

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

    // 隐藏楼（/hide、记忆类插件）也是 is_system，旧算法会把楼数算小、检测永远不到点；楼数直接取聊天长度。
    const isNote = msg => !msg || (msg.is_system && msg.extra && msg.extra.type);

    function floorCount() {
        return chatMessages().length;
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
            if (isNote(msg)) continue;
            const text = cleanFloorText(msg.mes);
            if (text) out.unshift({ index: i, text: `${msg.is_user ? '（用户）' : ''}${text}` });
        }
        return out;
    }

    async function checkNow({ manual = false } = {}) {
        if (checking) {
            log('跳过检测：上一次检测还没结束');
            return null;
        }
        const project = activeProject();
        const prog = currentProgress();
        const settings = data.settings();
        if (!project || !prog) {
            log('跳过检测：当前卡没有启用的项目');
            if (manual) toast('info', '当前卡没有启用的项目。');
            return null;
        }
        const unit = activeUnit();
        if (!unit) {
            log('跳过检测：大纲为空');
            return null;
        }
        const floors = recentFloors(settings.checkFloors);
        if (!floors.length) {
            log('跳过检测：没有可检测的正文');
            if (manual) toast('info', '还没有可检测的正文。');
            return null;
        }
        checking = true;
        log(`开始检测：${placeOf(unit)}，读最近 ${floors.length} 楼${manual ? '（手动）' : ''}`);
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
            log(`检测完成：已演 ${result.done.length} 个节点${result.stageDone ? '，本阶段已演完' : ''}${result.offTrack ? '，偏离大纲' : ''}`);
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
            log(`检测失败：${error.message}`);
            toast(manual ? 'error' : 'warning', `进度检测失败：${error.message}`);
            return null;
        } finally {
            checking = false;
            emit('checked');
        }
    }

    // 上次检测楼层比现有楼数还大（删楼、开分支、换了存档），以现有楼数重新起算，否则要等楼数追上才会再检测。
    function clampBase() {
        const prog = currentProgress();
        if (!prog) return null;
        const floors = floorCount();
        if (prog.lastCheckFloor <= floors) return prog;
        log(`上次检测楼层 ${prog.lastCheckFloor} 大于当前楼数 ${floors}，已改为 ${floors}`);
        const next = { ...prog, lastCheckFloor: floors };
        setProgress(next, 'floor');
        return next;
    }

    function resetBase() {
        const prog = currentProgress();
        if (!prog) return;
        log(`手动重设检测起点为第 ${floorCount()} 楼`);
        setProgress({ ...prog, lastCheckFloor: floorCount() }, 'floor');
    }

    function runPending() {
        view.clearTimeout(pendingTimer);
        if (!pendingCheck) return;
        pendingCheck = false;
        checkNow();
    }

    // 主回复还在生成（流式、后续插件处理）时先不发检测请求，等生成结束再发，避免和主回复抢接口。
    function queueCheck() {
        if (!generating) {
            view.setTimeout(() => checkNow(), 0);
            return;
        }
        if (pendingCheck) return;
        pendingCheck = true;
        log('主回复仍在生成，生成结束后检测');
        view.clearTimeout(pendingTimer);
        pendingTimer = view.setTimeout(() => {
            if (!pendingCheck) return;
            log('等待生成结束超时，直接检测');
            generating = false;
            runPending();
        }, PENDING_MAX_MS);
    }

    function onGenerationStarted(type, options, dryRun) {
        if (dryRun) return;
        generating = true;
    }

    function onGenerationEnded() {
        generating = false;
        runPending();
    }

    function onMessageReceived(messageId) {
        const floors = floorCount();
        const project = activeProject();
        if (!project) {
            log(`收到第 ${messageId} 楼：当前卡没有启用的项目，不检测`);
            emit('floor');
            return;
        }
        const settings = data.settings();
        const prog = clampBase() || currentProgress();
        const gap = floors - prog.lastCheckFloor;
        if (gap >= settings.checkEvery) {
            log(`收到第 ${messageId} 楼：距上次检测 ${gap} 楼，触发检测`);
            queueCheck();
        } else {
            log(`收到第 ${messageId} 楼：距上次检测 ${gap} 楼，还差 ${settings.checkEvery - gap} 楼`);
        }
        emit('floor');
    }

    function onMessageChanged() {
        if (!clampBase()) return;
        emit('floor');
    }

    async function onChatChanged() {
        progress = null;
        progressFor = '';
        pendingCheck = false;
        view.clearTimeout(pendingTimer);
        chatStartFloors = floorCount();
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
        log(`切换聊天：${floorCount()} 楼，${id ? `启用项目「${(data.index().projects.find(item => item.id === id) || {}).name || id}」` : '本卡没有启用项目'}`);
        if (id) clampBase();
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

    // key 是事件在 eventTypes 里的名字，诊断页按它显示是否绑上、收到过几次。
    const BINDINGS = [
        ['WORLDINFO_ENTRIES_LOADED', onEntriesLoaded],
        ['CHAT_CHANGED', onChatChanged],
        ['MESSAGE_RECEIVED', onMessageReceived],
        ['MESSAGE_UPDATED', onMessageChanged],
        ['MESSAGE_DELETED', onMessageChanged],
        ['MESSAGE_SWIPED', onMessageChanged],
        ['GENERATION_STARTED', onGenerationStarted],
        ['GENERATION_ENDED', onGenerationEnded],
        ['GENERATION_STOPPED', onGenerationEnded],
    ];

    function bind() {
        const c = ctx();
        const types = eventTypes();
        if (!c || !c.eventSource) return;
        for (const [key, handler] of BINDINGS) {
            const name = types[key];
            if (!name) continue;
            const wrapped = (...args) => {
                const stat = stats[key] || (stats[key] = { count: 0, at: 0 });
                stat.count += 1;
                stat.at = Date.now();
                return handler(...args);
            };
            c.eventSource.on(name, wrapped);
            listeners.push([key, name, wrapped]);
        }
    }

    function unbind() {
        const c = ctx();
        for (const [, name, handler] of listeners.splice(0)) {
            try { c.eventSource.removeListener(name, handler); } catch { /* 酒馆已卸载 */ }
        }
    }

    function start() {
        unbind();
        bind();
        log(`已绑定 ${listeners.length} 个酒馆事件`);
        onChatChanged();
    }

    function stop() {
        unbind();
        view.clearTimeout(fallbackTimer);
        view.clearTimeout(pendingTimer);
    }

    function diagnose() {
        const types = eventTypes();
        const bound = new Set(listeners.map(item => item[0]));
        return {
            hasContext: Boolean(ctx()),
            hasEventSource: Boolean(ctx() && ctx().eventSource),
            events: BINDINGS.map(([key]) => ({ key, name: types[key] || '', bound: bound.has(key), count: (stats[key] || {}).count || 0, at: (stats[key] || {}).at || 0 })),
            cardKey: cardKey(),
            chatLength: chatMessages().length,
            floors: floorCount(),
            chatStartFloors,
            generating,
            pending: pendingCheck,
            checking,
            logs: logs.slice(),
        };
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
        diagnose,
        resetBase,
        rebind: start,
        injectMode: () => (hasEntriesEvent() ? 'virtual' : 'book'),
        refresh: () => { scheduleFallback(); emit('progress'); },
    };
}
