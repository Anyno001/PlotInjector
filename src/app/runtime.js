import { buildCheckMessages, cleanFloorText, hasSignal, parseCheckReply } from '../core/check.js';
import { buildEntries, toWorldInfoEntry } from '../core/inject.js';
import { flattenUnits, stageLabel, stageNodes, volumeLabel } from '../core/outline.js';
import { advance, currentIndex, emptyProgress, goTo, isMuted, mute, uncheckByNames, unitStates } from '../core/progress.js';
import { resolveLlm } from '../core/store.js';
import { requestLlm } from '../host/llm.js';
import { cardKey, cardName, chatMessages, ctx, hostWindow, toast } from '../host/st.js';
import { writeFallbackBook } from '../host/worldbook.js';
import { readChatState, readProgress, writeProgress } from './progress-store.js';

export const VIRTUAL_WORLD = '剧情注入器';

const placeOf = unit => `${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}`;

// 运行时：注入、报信、每 N 楼检测。UI 关着也在跑。
export function createRuntime({ data, notice, emit }) {
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

    function proposeAdvance({ unit, source, reason = '', messageId = null }) {
        const settings = data.settings();
        const prog = currentProgress();
        if (!prog || isMuted(prog, unit.id)) return;
        if (settings.handleMode === 'nodes') return;
        const step = advance(prog, units());
        if (!step) return;
        const signal = source === 'signal' ? { unitId: unit.id, messageId, at: Date.now() } : null;
        if (settings.handleMode === 'auto') {
            const review = source === 'signal' && settings.switchSource === 'both' ? { from: unit.id, to: step.to.id } : null;
            setProgress({ ...step.progress, signal: signal ? { ...signal, advanced: true, to: step.to.id } : null, review });
            notice.show({
                id: 'advance',
                title: `已切到 ${placeOf(step.to)}`,
                body: reason || (source === 'signal' ? 'AI 报告本阶段已演完。' : '检测判断本阶段已演完。'),
                actions: [{ label: '撤销', run: () => backTo(unit.id) }],
                timeout: 12000,
            });
            return;
        }
        if (signal) setProgress({ ...prog, signal });
        notice.show({
            id: 'advance',
            title: `${placeOf(unit)} 已演完`,
            body: reason || (source === 'signal' ? 'AI 报告本阶段已演完。' : '检测判断本阶段已演完。'),
            actions: [
                { label: '打开下一段', primary: true, run: () => {
                    const done = openNext();
                    if (done && source === 'signal' && data.settings().switchSource === 'both') {
                        setProgress({ ...currentProgress(), review: { from: unit.id, to: done.to.id } });
                    }
                } },
                { label: '暂不', run: () => notice.hide('advance') },
                { label: '本阶段不再提醒', run: () => setProgress(mute(currentProgress(), unit.id)) },
            ],
        });
    }

    function handleSignal(messageId) {
        const unit = activeUnit();
        const prog = currentProgress();
        if (!unit || !prog) return;
        if (prog.signal && prog.signal.unitId === unit.id) return;
        proposeAdvance({ unit, source: 'signal', messageId });
    }

    // 滑动或重新生成后报信消失：撤回提示；已自动切换且还停在切过去的那段时退回。
    function revokeSignalIfGone() {
        const prog = currentProgress();
        if (!prog || !prog.signal) return;
        const msg = chatMessages()[prog.signal.messageId];
        if (msg && hasSignal(msg.mes)) return;
        const signal = prog.signal;
        if (signal.advanced) {
            const unit = activeUnit();
            if (unit && unit.id === signal.to) {
                setProgress({ ...goTo(prog, units(), signal.unitId), review: null });
                toast('info', '报信的回复已被替换，剧情退回上一段。');
                return;
            }
        }
        setProgress({ ...prog, signal: null });
        notice.hide('advance');
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
        const review = prog.review;
        const list = units();
        const unit = review ? list.find(item => item.id === review.from) : activeUnit();
        if (!unit) return null;
        const floors = recentFloors(settings.checkFloors);
        if (!floors.length) {
            if (manual) toast('info', '还没有可检测的正文。');
            return null;
        }
        checking = true;
        emit('checking');
        try {
            const off = (prog.slots[unit.id] && prog.slots[unit.id].off) || [];
            const reply = await requestLlm(buildCheckMessages(unit, off, floors), resolveLlm(settings, 'check'), { timeoutMs: 120000 });
            const result = parseCheckReply(reply);
            let next = currentProgress();
            next = uncheckByNames(next, unit.id, stageNodes(unit.stage.data), result.done);
            next = { ...next, lastCheckFloor: floorCount(), review: null };
            setProgress(next);
            if (review) {
                if (!result.stageDone) {
                    notice.show({
                        id: 'advance',
                        title: `复核：${placeOf(unit)} 可能还没演完`,
                        body: result.reason || '检测认为上一段的主线节点未全部发生。',
                        actions: [
                            { label: '退回上一段', primary: true, run: () => backTo(unit.id) },
                            { label: '保持现状', run: () => notice.hide('advance') },
                        ],
                    });
                }
            } else if (result.stageDone) {
                proposeAdvance({ unit, source: 'check', reason: result.reason });
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
        const msg = chatMessages()[messageId];
        if (msg && !msg.is_user && !msg.is_system && settings.switchSource !== 'check' && hasSignal(msg.mes)) handleSignal(Number(messageId));
        if (settings.switchSource === 'signal') return;
        const prog = currentProgress();
        const floors = floorCount();
        if (floors - prog.lastCheckFloor >= settings.checkEvery) view.setTimeout(() => checkNow(), 0);
    }

    function onMessageChanged() {
        const prog = currentProgress();
        if (!prog) return;
        const floors = floorCount();
        if (prog.lastCheckFloor > floors) setProgress({ ...prog, lastCheckFloor: floors });
        revokeSignalIfGone();
    }

    function onSwiped(messageId) {
        revokeSignalIfGone();
        const msg = chatMessages()[messageId];
        if (msg && !msg.is_user && hasSignal(msg.mes) && data.settings().switchSource !== 'check') handleSignal(Number(messageId));
    }

    async function onChatChanged() {
        progress = null;
        progressFor = '';
        notice.hide('advance');
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
        on(types.MESSAGE_SWIPED, onSwiped);
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
        injectMode: () => (hasEntriesEvent() ? 'virtual' : 'book'),
        refresh: () => { scheduleFallback(); emit('progress'); },
    };
}
