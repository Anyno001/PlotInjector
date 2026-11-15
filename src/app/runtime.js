import { injectedSetting, changedBlockKeys, mergeBlocks, parseSettingReply, pushHistory, splitBlocks } from '../core/setting.js';
import { ensureOutlineIds, isClueMode, stripAuthorBlocks, outlineVolumesView } from '../core/clue-model.js';
import { createClueRuntime } from './clue-runtime.js';

import { DEFAULT_PARAMS, pickParams, buildEntries, buildIndexText, carriedNodes, toWorldInfoEntry } from '../core/inject.js';
import {
    SETTING_SLOT,
    CLUE_SLOT,
    advance,
    checkBase,
    currentIndex,
    emptyProgress,
    goTo,
    isMuted,
    mute,
    patchSlot,
    uncheckByNames,
    unitStates,
} from '../core/progress.js';

import {
    isPlainObject,
    flattenUnits,
    replaceRest,
    stageLabel,
    stageNodes,
    volumeLabel,
    makeId,
    pushOutlineHistory,
} from '../core/outline.js';
import { discoveryList, clueText } from '../core/clue-project.js';

import { buildClueCheckMessages, buildCheckMessages, cleanFloorText, parseCheckReply } from '../core/check.js';
import { requestToText, auditOutlineRequest } from '../core/clue-audit.js';

import { isBackgroundRequest, requestLlm } from '../host/llm.js';

import { parseOutlineReply, rewriteRestMessages, syncSettingMessages } from '../core/prompts.js';

import { BUILTIN_GUIDE } from '../core/guide.js';

import { alignProgress, outlineLinks } from '../core/align.js';
import {
    createWorld,
    emptyInfinite,
    enterWorld,
    leaveWorld,
    reenterWorld,
    removeWorld,
    undoEnter,
    undoLeave,
    withTrigger,
} from '../core/infinite-flow.js';
import { decideTrigger, hashText, judgeTrigger, makeTrigger, parseTrainState } from '../core/infinite-state.js';
import { hubWordNames, normalizeInfinite, randomFloat, resolveHub, rollWorldDice, titleKey } from '../core/infinite.js';
import { buildWorldMessages, horrorTitle, parseWorldReply, worldSpecText } from '../core/infinite-world.js';

import { resolveLlm } from '../core/store.js';
import {
    addPlayerThread,
    applyCheck,
    checkThreads,
    clampThreads,
    hasNodeNamed,
    ignoreThread,
    isThreadNode,
    liveThreads,
    maskUnits,
    threadState,
    threadSwitches,
} from '../core/threads.js';

import { cardKey, cardName, chatMessages, ctx, hostWindow, toast } from '../host/st.js';
import { readEntryContent, writeFallbackBook } from '../host/worldbook.js';
import { bindChat, readChatState, readProgress, writeProgress } from './progress-store.js';

export const VIRTUAL_WORLD = '剧情注入器';

const LOG_MAX = 40;
// 主回复没结束时先挂起检测，最多等这么久。
const PENDING_MAX_MS = 30000;
// 检测请求失败后自动重试的次数与间隔，全部失败才弹提示。
const CHECK_RETRIES = 3;
const RETRY_GAP_MS = 2000;
// 造世界解析失败或请求失败时的重试次数。
const WORLD_RETRIES = 2;
// 档案还在生成时用户发了下一条，最多等这么久。
const WORLD_WAIT_MS = 90000;

const placeOf = (unit) => `${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}`;

// 运行时：注入、每 N 楼检测、偏离大纲时提醒或自动改写。UI 关着也在跑。
// askReason 由入口传入（弹输入框），运行时本身不依赖界面。
export function createRuntime({ data, notice, emit, askReason = async () => '' }) {
    const view = hostWindow();
    let progress = null,
        progressFor = '',
        alignedFrom = null,
        alignedOutline = null,
        checking = !1,
        fallbackTimer = 0,
        generating = !1,
        chatStartFloors = 0,
        pendingCheck = !1,
        pendingTimer = 0,
        opening = !1,
        openGen = 0,
        openPromise = Promise.resolve(null),
        pendingTrigger = null,
        lastRead = null;
    const listeners = [],
        stats = {},
        logs = [];
    function log(text) {
        (logs.push({ at: Date.now(), text }), logs.length > LOG_MAX && logs.shift());
    }
    let clue = createClueRuntime({
        data,
        getProject: () => activeProject(),
        getProgress: () => currentProgress(),
        setProgress: (next, reason) => setProgress(next, reason),
        emit: (reason) => emit(reason),
        log,
        ticket: () => ticket(),
        ticketValid: (t) => ticketValid(t),
    });
    function clueMode() {
        return !isInfinite(activeProject()) && isClueMode(activeProject());
    }
    // 异步隔离：所有 await 模型的地方先取一张票（聊天 + 项目 + 模式 + 切换纪元），返回后票不一致就丢弃结果。
    let epoch = 0;
    function bumpEpoch() {
        epoch += 1;
    }
    function ticket() {
        let c = ctx();
        return {
            epoch,
            chat: c && typeof c.getCurrentChatId == 'function' ? String(c.getCurrentChatId() || '') : '',
            project: activeId(),
            mode: clueMode() ? 'clue' : 'outline',
        };
    }
    function ticketValid(t) {
        let now = ticket();
        return !!t && t.epoch === now.epoch && t.chat === now.chat && t.project === now.project && t.mode === now.mode;
    }

    function chatBoundId() {
        const id = readChatState().projectId;
        return id && data.index().projects.some((item) => item.id === id) ? id : '';
    }
    function activeId() {
        return chatBoundId() || data.activeIdFor(cardKey());
    }
    function activeProject() {
        const id = activeId();
        const project = id ? data.project(id) : null;
        if (!project || project.mode === 'infinite') return project;
        const ids = ensureOutlineIds(project.outline.volumes, project.outlineIdMap);
        if (!ids.changed) return project;
        data.updateProject(id, (cur) => ({ ...cur, outline: { ...cur.outline, volumes: ids.volumes }, outlineIdMap: ids.legacyMap }));
        return data.project(id);
    }
    function currentProgress() {
        const id = activeId();
        if (!id) return null;
        (!progress || progressFor !== id) && ((progress = readProgress(id)), (progressFor = id));
        const project = activeProject();
        if (
            (project &&
                project.mode === 'infinite' &&
                !progress.infinite &&
                ((progress = { ...progress, infinite: emptyInfinite() }), writeProgress(progress)),
            project && !isInfinite(project) && (progress !== alignedFrom || project.outline !== alignedOutline))
        ) {
            const migrated = migrateStableProgress(progress, project.outline.volumes, project.outlineIdMap, project.outline.idAlias);
            const aligned = stampNodeIds(alignProgress(migrated, project.outline), project.outline.volumes);
            (aligned !== progress && ((progress = aligned), writeProgress(progress), log('按大纲对照表归位了本聊天的进度')),
                (alignedFrom = progress),
                (alignedOutline = project.outline));
        }
        return progress;
    }
    function links() {
        const project = activeProject();
        return project ? outlineLinks(project.outline) : void 0;
    }
    const isInfinite = (project) => !!(project && project.mode === 'infinite');
    function units() {
        const project = activeProject();
        return project ? flattenUnits(project.outline.volumes) : [];
    }
    function stampActive(prev, next) {
        if (!next || next.infinite) return next;
        const list = units();
        if (!list.length) return next;
        const activeOf = (prog) => {
                const states = unitStates(list, prog),
                    found = list.find((unit) => states[unit.id] === 'active');
                return found ? found.id : '';
            },
            now = activeOf(next);
        if (!now) return next;
        const changed = !prev || prev.projectId !== next.projectId || activeOf(prev) !== now,
            slot = next.slots[now] || {};
        return (!changed && slot.since) || (!prev && slot.since) ? next : patchSlot(next, now, { since: floorCount() });
    }
    function setProgress(next, reason = 'progress') {
        const project = activeProject();
        if (project && project.mode !== 'infinite') next = stampNodeIds(next, project.outline.volumes);
        ((next = stampActive(progress && progressFor === next.projectId ? progress : null, next)),
            (progress = next),
            (progressFor = next.projectId),
            writeProgress(next),
            scheduleFallback(),
            emit(reason));
    }
    function entries() {
        let project = activeProject(),
            prog = currentProgress();
        return !project || !prog
            ? []
            : isClueMode(project)
              ? buildClueEntries(project, prog)
              : buildEntries(
                    {
                        ...project,
                        setting: { ...project.setting, text: stripAuthorBlocks(project.setting.text) },
                        outline: { ...project.outline, volumes: outlineVolumesView(project.outline.volumes) },
                    },
                    prog,
                    data.settings(),
                );
    }
    function buildClueEntries(project, prog) {
        let defaults = { ...DEFAULT_PARAMS, ...project.defaults },
            out = [],
            settingText = injectedSetting(project.setting);
        settingText &&
            out.push({
                slotId: SETTING_SLOT,
                kind: 'setting',
                title: '设定',
                content: settingText,
                ...pickParams(defaults.setting, prog.slots[SETTING_SLOT]),
            });
        let proj = clue.projection();
        return (
            out.push({
                slotId: CLUE_SLOT,
                kind: 'detail',
                title: '线索场景',
                content: proj.content,
                reason: proj.reason,
                used: proj.used,
                stale: proj.stale,
                ...pickParams(defaults.detail, prog.slots[CLUE_SLOT]),
            }),
            out
        );
    }
    function virtualEntries({ recordClue = !1 } = {}) {
        let list = entries(),
            clueEntry = list.find((entry) => entry.slotId === CLUE_SLOT);
        return (
            recordClue &&
                clueEntry &&
                clue.record(
                    'worldbook',
                    clueEntry.enabled
                        ? { content: clueEntry.content, used: clueEntry.used, reason: clueEntry.reason, stale: clueEntry.stale }
                        : { content: '', reason: '线索条目已被关闭' },
                ),
            list.filter((entry) => entry.enabled && entry.content).map((entry, index) => toWorldInfoEntry(entry, index, VIRTUAL_WORLD))
        );
    }
    function eventTypes() {
        const c = ctx();
        return (c && c.eventTypes) || {};
    }
    function hasEntriesEvent() {
        return !!eventTypes().WORLDINFO_ENTRIES_LOADED;
    }
    async function onEntriesLoaded(payload) {
        if (!(!payload || !Array.isArray(payload.chatLore))) {
            opening && (await waitOpening());
            try {
                payload.chatLore.push(...virtualEntries({ recordClue: !0 }));
            } catch (error) {
                console.error('[剧情注入器] 注入失败', error);
            }
        }
    }
    function scheduleFallback() {
        hasEntriesEvent() ||
            (view.clearTimeout(fallbackTimer),
            (fallbackTimer = view.setTimeout(async () => {
                const name = `剧情注入器·${cardName() || '未命名'}`;
                try {
                    let result = await writeFallbackBook(name, clueMode() ? [] : virtualEntries());
                    result.conflict &&
                        toast('warning', `聊天已绑定世界书「${result.conflict}」，剧情注入器的条目写在「${name}」，需要手动启用。`);
                } catch (error) {
                    toast('error', `写入专用世界书失败：${error.message}`);
                }
            }, 1e3)));
    }
    const isNote = (msg) => !msg || (msg.is_system && msg.extra && msg.extra.type);
    function floorCount() {
        return chatMessages().length;
    }
    function activeUnit() {
        const list = units(),
            prog = currentProgress();
        if (!list.length || !prog) return null;
        const states = unitStates(list, prog);
        return list.find((unit) => states[unit.id] === 'active') || list[currentIndex(list, prog)];
    }
    function openNext({ silent = !1 } = {}) {
        const prog = currentProgress(),
            step = prog && advance(prog, units());
        return step ? (setProgress(step.progress), notice.hide('advance'), step) : (silent || toast('info', '已经是最后一段。'), null);
    }
    function backTo(unitId) {
        const prog = currentProgress();
        prog && setProgress(goTo(prog, units(), unitId));
    }
    function proposeAdvance({ unit, reason = '' }) {
        const settings = data.settings(),
            prog = currentProgress();
        if (!prog || isMuted(prog, unit.id) || settings.handleMode === 'nodes') return;
        const step = advance(prog, units());
        if (step) {
            if (settings.handleMode === 'auto') {
                (setProgress(step.progress),
                    notice.show({
                        id: 'advance',
                        title: `已切到 ${placeOf(step.to)}`,
                        body: reason || '检测判断本阶段已演完。',
                        actions: [{ label: '撤销', run: () => backTo(unit.id) }],
                        timeout: 12e3,
                    }));
                return;
            }
            notice.show({
                id: 'advance',
                title: `${placeOf(unit)} 已演完`,
                body: reason || '检测判断本阶段已演完。',
                actions: [
                    { label: '打开下一段', primary: !0, run: () => openNext() },
                    { label: '暂不', run: () => notice.hide('advance') },
                    { label: '本阶段不再提醒', run: () => setProgress(mute(currentProgress(), unit.id)) },
                ],
            });
        }
    }
    async function syncSetting(projectId, { from = 0, reason = '' } = {}) {
        const project = data.project(projectId),
            text = project && project.setting.text.trim();
        if (!text) return [];
        const list = flattenUnits(project.outline.volumes),
            guide = String(data.settings().guide || '').trim() || BUILTIN_GUIDE,
            reply = await requestLlm(
                syncSettingMessages({ guide, setting: text, units: list, fromUnitIndex: from, reason }),
                resolveLlm(data.settings(), 'outline'),
            ),
            body = parseSettingReply(reply).body,
            keys = body ? changedBlockKeys(text, body) : [];
        if (!keys.length) return [];
        const next = mergeBlocks(text, body, keys);
        data.updateProject(projectId, (current) => ({
            ...current,
            setting: {
                ...current.setting,
                text: next,
                history: pushHistory(pushHistory(current.setting.history, current.setting.text), next),
            },
        }));
        const titles = new Map(splitBlocks(text).map((block) => [block.key, block.title]));
        return keys.map((key) => titles.get(key) || key);
    }
    async function rewriteRest(reason) {
        const project = activeProject(),
            prog = currentProgress(),
            unit = activeUnit();
        if (!project || !prog || !unit) throw new Error('当前卡没有启用的项目');
        let t = ticket(),
            list = units(),
            from = list.findIndex((item) => item.id === unit.id),
            recent = recentFloors(6).map((floor) => floor.text).join(`

`),
            reply = await requestLlm(
                rewriteRestMessages({
                    setting: project.setting.text,
                    volumes: project.outline.volumes,
                    fromUnitIndex: from,
                    units: list,
                    recent,
                    reason,
                }),
                resolveLlm(data.settings(), 'outline'),
            ),
            parsed = parseOutlineReply(reply);
        if (!parsed.ok) throw new Error(`改写结果格式有误：${parsed.error}`);
        if (!ticketValid(t)) throw new Error('改写期间聊天、项目或推进方式已切换，结果未应用');
        const before = { volumes: project.outline.volumes, progress: prog, setting: project.setting.text },
            volumes = replaceRest(project.outline.volumes, unit.stage.id, parsed.volumes);
        data.updateProject(project.id, (current) => ({
            ...current,
            outline: {
                ...current.outline,
                volumes,
                history: pushOutlineHistory(current.outline.history, current.outline.volumes, '偏离改写'),
            },
        }));
        const first = parsed.volumes[0] && parsed.volumes[0].stages[0];
        return (first && setProgress(goTo(currentProgress(), flattenUnits(volumes), first.id)), before);
    }
    function undoRewrite(projectId, before) {
        (data.updateProject(projectId, (current) => ({
            ...current,
            outline: { ...current.outline, volumes: before.volumes },
            setting: { ...current.setting, text: before.setting, history: pushHistory(current.setting.history, before.setting) },
        })),
            setProgress(before.progress),
            toast('info', '已撤销改写，恢复原来的大纲、设定和进度。'));
    }
    async function runRewrite(reason, { auto = !1 } = {}) {
        const projectId = activeId();
        notice.show({ id: 'offtrack', title: '正在改写后续阶段…', body: reason });
        try {
            const before = await rewriteRest(reason);
            let synced = '';
            try {
                notice.show({ id: 'offtrack', title: '正在按新大纲校对设定…', body: reason });
                const titles = await syncSetting(projectId, { from: currentIndex(units(), currentProgress()), reason });
                synced = titles.length
                    ? `
设定已同步修改：${titles.join('、')}。`
                    : '';
            } catch (error) {
                synced = `
设定校对失败：${error.message}`;
            }
            notice.show({
                id: 'offtrack',
                title: auto ? '剧情偏离大纲，已自动改写后续阶段' : '已改写后续阶段',
                body: `${reason}${synced}`,
                actions: [{ label: '撤销', run: () => undoRewrite(projectId, before) }],
                timeout: 2e4,
            });
        } catch (error) {
            (notice.hide('offtrack'), toast('error', `改写失败：${error.message}`));
        }
    }
    function handleOffTrack(unit, reason) {
        if ((notice.hide('advance'), data.settings().offTrackMode === 'auto')) {
            runRewrite(reason, { auto: !0 });
            return;
        }
        notice.show({
            id: 'offtrack',
            title: `${placeOf(unit)} 偏离大纲`,
            body: `${reason || '正文走向与后续阶段冲突。'}后续阶段可能接不上，建议改写。`,
            actions: [
                {
                    label: '改写后续阶段',
                    primary: !0,
                    run: async () => {
                        const note = await askReason(reason);
                        note != null && runRewrite(note.trim() || reason);
                    },
                },
                { label: '暂不', run: () => notice.hide('offtrack') },
                {
                    label: '本阶段不再提醒',
                    run: () => {
                        const prog = currentProgress();
                        prog && !prog.offMuted.includes(unit.id) && setProgress({ ...prog, offMuted: [...prog.offMuted, unit.id] });
                    },
                },
            ],
        });
    }
    function threadEventText(event) {
        return (
            {
                'clock-tick': `进度钟「${event.name}」推进到 ${event.filled}/${event.total}`,
                'clock-due': `进度钟「${event.name}」已满格，本段必须发生`,
                'clock-done': `世界动态「${event.name}」已发生`,
                'hook-on': `支线「${event.name}」条件满足，已激活`,
                'chain-step': `支线链「${event.name}」进入第 ${event.step + 1}/${event.total} 步`,
                'hook-done': `支线「${event.name}」已演完`,
                'hook-expired': `支线「${event.name}」超过时限，已过期`,
            }[event.type] || event.type
        );
    }
    function adoptThread(projectId, stageId, thread) {
        (data.updateProject(projectId, (current) => ({
            ...current,
            outline: {
                ...current.outline,
                volumes: addPlayerThread(current.outline.volumes, stageId, thread),
                history: pushOutlineHistory(current.outline.history, current.outline.volumes, '收录支线'),
            },
        })),
            log(`收录玩家自开的线「${thread.name}」为支线`),
            scheduleFallback(),
            emit('progress'));
    }
    function offerThread(unit, thread) {
        const settings = data.settings(),
            project = activeProject(),
            prog = currentProgress();
        if (
            !(settings.newThreadMode === 'off' || !project || !prog || !threadSwitches(project).sideOn) &&
            !(threadState(prog).ignored.includes(thread.name) || hasNodeNamed(units(), thread.name))
        ) {
            if (settings.newThreadMode === 'auto') {
                (adoptThread(project.id, unit.stage.id, thread),
                    notice.show({ id: 'thread', title: `已收录支线「${thread.name}」`, body: thread.summary, timeout: 1e4 }));
                return;
            }
            notice.show({
                id: 'thread',
                title: `正文开了一条新线「${thread.name}」`,
                body: thread.summary || '大纲里没有这条线。',
                actions: [
                    { label: '收录为支线', primary: !0, run: () => adoptThread(project.id, unit.stage.id, thread) },
                    { label: '忽略', run: () => setProgress(ignoreThread(currentProgress(), thread.name)) },
                ],
            });
        }
    }
    function recentFloors(count) {
        const out = [],
            chat = chatMessages();
        for (let i = chat.length - 1; i >= 0 && out.length < count; i -= 1) {
            const msg = chat[i];
            if (isNote(msg)) continue;
            const text = cleanFloorText(msg.mes);
            text && out.unshift({ index: i, text: `${msg.is_user ? '（用户）' : ''}${text}` });
        }
        return out;
    }
    function infState() {
        const project = activeProject(),
            prog = currentProgress();
        return !isInfinite(project) || !prog || !prog.infinite
            ? null
            : { project, prog, infinite: normalizeInfinite(project.infinite), inf: prog.infinite };
    }
    function setInf(inf, reason = 'progress') {
        setProgress({ ...currentProgress(), infinite: inf }, reason);
    }
    function latestAiFloor() {
        const chat = chatMessages();
        for (let i = chat.length - 1; i >= 0; i -= 1) {
            const msg = chat[i];
            if (!(!msg || msg.is_user || msg.is_system)) return { floor: i, text: String(msg.mes || '') };
        }
        return null;
    }
    function hubConfig() {
        const project = activeProject();
        return project && project.infinite ? normalizeInfinite(project.infinite).config : void 0;
    }
    function refreshRead() {
        const found = latestAiFloor();
        return ((lastRead = found ? { floor: found.floor, state: parseTrainState(found.text, hubConfig()) } : null), found);
    }
    function abandonOpening() {
        opening && ((openGen += 1), (opening = !1), (pendingTrigger = null), emit('opened'));
    }
    function revalidateTrigger() {
        const state = infState();
        if (!state) return;
        const pending = opening && pendingTrigger ? pendingTrigger : null,
            trig = pending || state.inf.trigger;
        if (!trig) return;
        const msg = chatMessages()[trig.floor],
            text = msg && !msg.is_user && !msg.is_system ? String(msg.mes || '') : null;
        if (text !== null && !text.trim()) return;
        const cfg = state.infinite.config,
            names = hubWordNames(cfg),
            word = trig.kind === 'enter' ? names.depart : names.back,
            verdict = judgeTrigger(trig, text, cfg);
        if (!(verdict === 'none' || verdict === 'same')) {
            if (verdict === 'keep') {
                const next = { ...trig, hash: hashText(text) };
                (pending ? (pendingTrigger = next) : setInf(withTrigger(state.inf, next)),
                    log(`第 ${trig.floor} 楼文字变了，仍是「${word}」，不重复处理`));
                return;
            }
            (pending
                ? (log(`第 ${trig.floor} 楼不再是「${names.depart}」，取消正在生成的世界档案`), abandonOpening())
                : trig.kind === 'enter'
                  ? (log(`第 ${trig.floor} 楼不再是「${names.depart}」，撤销开副本，删掉刚生成的档案`),
                    setInf(undoEnter(state.inf, `第 ${trig.floor} 楼不再是「${names.depart}」，撤销开副本`)))
                  : (log(`第 ${trig.floor} 楼不再是「${names.back}」，撤销关副本`),
                    setInf(undoLeave(state.inf, `第 ${trig.floor} 楼不再是「${names.back}」，撤销关副本`))),
                notice.show({
                    id: 'inf-undo',
                    title: '触发楼已改动',
                    body:
                        trig.kind === 'enter'
                            ? `这一楼不再是「${names.depart}」，已撤销开副本并删掉刚生成的档案。`
                            : `这一楼不再是「${names.back}」，已重新打开那份档案。`,
                    timeout: 1e4,
                }));
        }
    }
    function onInfiniteReceived() {
        const found = refreshRead();
        revalidateTrigger();
        const state = infState();
        if (!state || !found) {
            (found || log('收到回复：没有 AI 楼层可读'), emit('floor'));
            return;
        }
        const train = lastRead.state;
        log(`读状态块：第 ${found.floor} 楼 ${train ? `${resolveHub(state.infinite.config).hubName}：${train}` : '没有状态块'}`);
        const kind = decideTrigger(state.inf.phase, train, state.infinite.config);
        if (kind === 'enter') openWorld({ floor: found.floor, text: found.text });
        else if (kind === 'leave') {
            const trigger = makeTrigger({ kind: 'leave', floor: found.floor, text: found.text, worldId: state.inf.worldId });
            setInf(
                withTrigger(
                    leaveWorld(state.inf, `第 ${found.floor} 楼读到「${hubWordNames(state.infinite.config).back}」，关副本`),
                    trigger,
                ),
            );
        }
        emit('floor');
    }
    async function waitOpening() {
        const promise = openPromise;
        let timer = 0,
            timedOut = !1;
        const timeout = new Promise((resolve) => {
            timer = view.setTimeout(() => {
                ((timedOut = !0), resolve());
            }, WORLD_WAIT_MS);
        });
        (log('世界档案还在生成，先等它完成'),
            await Promise.race([promise.catch(() => null), timeout]),
            view.clearTimeout(timer),
            timedOut &&
                opening &&
                (log(`等待世界档案超过 ${WORLD_WAIT_MS / 1e3} 秒，本次回复先不带档案`),
                notice.show({
                    id: 'inf-wait',
                    title: '世界档案还没生成完',
                    body: `已等待 ${WORLD_WAIT_MS / 1e3} 秒，本次回复先不带档案，生成完成后从下一次回复起带上。`,
                    timeout: 12e3,
                })));
    }
    function openWorld(trigger = null) {
        if (opening) return openPromise;
        const state = infState();
        if (!state) return Promise.resolve(null);
        if (state.inf.phase !== 'train')
            return (toast('info', `只有在${resolveHub(state.infinite.config).hubName}时才能进入新世界。`), Promise.resolve(null));
        ((opening = !0), (openGen += 1));
        const gen = openGen;
        return (
            (pendingTrigger = trigger ? { kind: 'enter', floor: trigger.floor, hash: hashText(trigger.text), worldId: '' } : null),
            (openPromise = runOpen(state, gen).finally(() => {
                gen === openGen && ((opening = !1), (pendingTrigger = null), emit('opened'));
            })),
            openPromise
        );
    }
    async function runOpen(state, gen) {
        const projectId = state.project.id;
        emit('opening');
        try {
            const dice = rollWorldDice(state.infinite, randomFloat);
            log(`开副本掷骰：${dice.horror}｜${dice.cycle}｜${dice.client}｜情欲${dice.lust}`);
            const spec = worldSpecText(state.infinite),
                titles = state.inf.worlds.map((world2) => world2.title),
                guideTitle = horrorTitle(state.infinite.config.horrorPrefix, dice.horror);
            let horrorGuide = '';
            try {
                horrorGuide = await readEntryContent(guideTitle, (a, b) => titleKey(a) === titleKey(b));
            } catch (error) {
                log(`读取恐怖类型写法失败：${error.message}`);
            }
            horrorGuide || log(`卡里没找到「${guideTitle}」，造世界时不带恐怖类型写法`);
            let parsed = null,
                hint = '';
            for (let attempt = 0; ; attempt += 1)
                try {
                    const messages = buildWorldMessages({ spec, dice, setting: state.project.setting.text, titles, hint, horrorGuide });
                    parsed = parseWorldReply(await requestLlm(messages, resolveLlm(data.settings(), 'outline'), { timeoutMs: 18e4 }));
                    break;
                } catch (error) {
                    if (attempt >= WORLD_RETRIES) throw error;
                    ((hint = error.message), log(`造世界失败：${error.message}，第 ${attempt + 1} 次重试`));
                }
            const now = infState();
            if (gen !== openGen || !now || now.project.id !== projectId || now.inf.phase !== 'train')
                return (log('造世界结果作废：开副本期间状态已变'), null);
            const world = createWorld({ id: makeId('w'), dice, parsed }),
                trig = pendingTrigger ? { ...pendingTrigger, worldId: world.id } : null;
            return (
                setInf(withTrigger(enterWorld(now.inf, world), trig)),
                notice.show({
                    id: 'inf-stop',
                    title: `进入新世界「${world.title}」`,
                    body: `${dice.horror}｜${dice.client}`,
                    timeout: 12e3,
                }),
                world
            );
        } catch (error) {
            return (
                gen !== openGen ||
                    (log(`开副本失败：${error.message}`),
                    notice.show({
                        id: 'inf-stop',
                        title: '开副本失败',
                        body: error.message,
                        actions: [
                            { label: '重试', primary: !0, run: () => openWorld() },
                            { label: '关闭', run: () => {} },
                        ],
                    })),
                null
            );
        }
    }
    function returnToTrain() {
        const state = infState();
        !state || state.inf.phase !== 'world' || setInf(leaveWorld(state.inf, `手动回到${resolveHub(state.infinite.config).hubName}`));
    }
    function reopenWorld(worldId) {
        const state = infState();
        if (state) {
            if (state.inf.phase !== 'train') {
                toast('info', `先回到${resolveHub(state.infinite.config).hubName}，再重新打开档案。`);
                return;
            }
            setInf(reenterWorld(state.inf, worldId));
        }
    }
    function deleteWorld(worldId) {
        const state = infState();
        state && setInf(removeWorld(state.inf, worldId, state.infinite.config));
    }
    async function checkNow({ manual = !1 } = {}) {
        if (isInfinite(activeProject())) return (log('无限流项目不使用检测模型'), null);
        if (checking) return (log('跳过检测：上一次检测还没结束'), null);
        const project = activeProject(),
            prog = currentProgress(),
            settings = data.settings();
        if (!project || !prog) return (log('跳过检测：当前卡没有启用的项目'), manual && toast('info', '当前卡没有启用的项目。'), null);
        const sw = threadSwitches(project),
            unit = activeUnit() && maskUnits([activeUnit()], sw)[0];
        if (!unit) return (log('跳过检测：大纲为空'), null);
        const floors = recentFloors(settings.checkFloors);
        if (!floors.length) return (log('跳过检测：没有可检测的正文'), manual && toast('info', '还没有可检测的正文。'), null);
        ((checking = !0), log(`开始检测：${placeOf(unit)}，读最近 ${floors.length} 楼${manual ? '（手动）' : ''}`), emit('checking'));
        let t = ticket();
        try {
            if (clueMode()) return await clueCheck(floors);
            const list = maskUnits(flattenUnits(outlineVolumesView(project.outline.volumes)), sw),
                states = unitStates(list, prog),
                opts = { carryOver: settings.carryOver, hookCap: settings.hookCap, links: links() },
                index = buildIndexText(list, states, prog, opts),
                threadInfo = checkThreads(liveThreads(list, states, prog, opts), {
                    newThreadMode: sw.sideOn ? settings.newThreadMode : 'off',
                    ignored: threadState(prog).ignored,
                    readTo: prog.lastCheckFloor,
                }),
                messages = buildCheckMessages(unit, index, floors, threadInfo);
            let result = null;
            for (let attempt = 0; ; attempt += 1)
                try {
                    if (!ticketValid(t)) return null;
                    result = parseCheckReply(await requestLlm(messages, resolveLlm(settings, 'check'), { timeoutMs: 12e4 }));
                    break;
                } catch (error) {
                    if (!ticketValid(t) || attempt >= CHECK_RETRIES) throw error;
                    (log(`检测请求失败：${error.message}，${RETRY_GAP_MS / 1e3} 秒后第 ${attempt + 1} 次重试`),
                        await new Promise((resolve) => view.setTimeout(resolve, RETRY_GAP_MS)));
                }
            if (!ticketValid(t)) return (log('检测返回时聊天、项目或推进方式已切换，结果丢弃'), null);
            notice.hide('checkfail');
            let next = currentProgress();
            if (
                ((next = uncheckByNames(
                    next,
                    unit.id,
                    stageNodes(unit.stage.data).filter((node) => !isThreadNode(node)),
                    result.done,
                )),
                settings.carryOver)
            )
                for (const item of carriedNodes(list, states, prog, { links: opts.links }))
                    next = uncheckByNames(next, item.unit.id, [item.node], result.done);
            const merged = applyCheck(next, liveThreads(list, unitStates(list, next), next, opts), result, { floor: floorCount() });
            ((next = { ...merged.progress, lastCheckFloor: floorCount() }), delete next.lastFailFloor, setProgress(next));
            for (const event of merged.events) log(threadEventText(event));
            return (
                log(
                    `检测完成：已演 ${result.done.length} 个节点${result.stageDone ? '，本阶段已演完' : ''}${result.offTrack ? '，偏离大纲' : ''}`,
                ),
                result.offTrack && settings.offTrackMode !== 'off' && !next.offMuted.includes(unit.id)
                    ? handleOffTrack(unit, result.offReason || result.reason)
                    : result.stageDone
                      ? proposeAdvance({ unit, reason: result.reason })
                      : manual && toast('info', result.reason || '本阶段尚未演完。'),
                result.newThread && sw.sideOn && offerThread(unit, result.newThread),
                result
            );
        } catch (error) {
            if (!ticketValid(t)) return (log('检测失败且请求期间已切换，保留当前进度'), null);
            return (
                setProgress({ ...currentProgress(), lastFailFloor: floorCount() }),
                log(`检测失败：${error.message}`),
                notice.show({
                    id: 'checkfail',
                    title: '进度检测失败',
                    body: `已自动重试 ${CHECK_RETRIES} 次：${error.message}`,
                    actions: [
                        { label: '重试', primary: !0, run: () => checkNow({ manual }) },
                        { label: '关闭', run: () => {} },
                    ],
                }),
                null
            );
        } finally {
            ((checking = !1), emit('checked'));
        }
    }
    async function clueCheck(floors) {
        let c = clue.compute(),
            focus = c && c.state.nodeStates.find((s) => s.node.uid && s.node.uid === c.state.focus.uid);
        if (!focus) return (toast('info', '线索模式下需要先有焦点场景才能检测。'), null);
        let item = isPlainObject(focus.node.item) ? focus.node.item : {},
            finds = discoveryList(item),
            material = [
                clueText(item.入口) && `入口：${clueText(item.入口)}`,
                clueText(item.地点) && `地点：${clueText(item.地点)}`,
                clueText(item.场景) && `场景：${clueText(item.场景)}`,
                finds.length
                    ? `【可能的发现】
${finds.map((d) => `- ${d.text}`).join(`
`)}`
                    : `【可能的发现】
（未列出，只判断场景是否结束）`,
            ].filter(Boolean).join(`
`),
            t = ticket(),
            reply2 = await requestLlm(buildClueCheckMessages(material, floors), resolveLlm(data.settings(), 'check'), { timeoutMs: 12e4 }),
            result = parseCheckReply(reply2);
        return ticketValid(t)
            ? (log(`线索检测建议：${result.done.length ? '场景可能已演完' : '场景未演完'}`),
              notice.show({
                  id: 'clue-check',
                  title: '检测建议（不会自动改状态）',
                  body: `${result.reason || ''}${result.done.length ? ' 如确认已完成，请到执行页手动标记，或等待填表记录事实。' : ''}`,
                  timeout: 2e4,
              }),
              result)
            : (log('线索检测返回时项目、模式或聊天已切换，结果丢弃'), null);
    }
    function clampBase() {
        const prog = currentProgress();
        if (!prog) return null;
        const floors = floorCount(),
            threads = clampThreads(prog, floors),
            failOver = Number(prog.lastFailFloor) > floors;
        if (prog.lastCheckFloor <= floors && !failOver && threads === prog) return prog;
        (prog.lastCheckFloor > floors && log(`上次检测楼层 ${prog.lastCheckFloor} 大于当前楼数 ${floors}，已改为 ${floors}`),
            failOver && log(`上次检测失败时的楼层 ${prog.lastFailFloor} 大于当前楼数 ${floors}，已改为 ${floors}`),
            threads !== prog && log(`支线与进度钟记下的楼数大于当前楼数 ${floors}，已改为 ${floors}`));
        const next = { ...threads, lastCheckFloor: Math.min(prog.lastCheckFloor, floors) };
        return (failOver && (next.lastFailFloor = floors), setProgress(next, 'floor'), next);
    }
    function resetBase() {
        const prog = currentProgress();
        if (!prog) return;
        log(`手动重设检测起点为第 ${floorCount()} 楼`);
        const next = { ...prog, lastCheckFloor: floorCount() };
        (delete next.lastFailFloor, setProgress(next, 'floor'));
    }
    function runPending() {
        (view.clearTimeout(pendingTimer), pendingCheck && ((pendingCheck = !1), checkNow()));
    }
    function queueCheck() {
        if (!generating) {
            view.setTimeout(() => checkNow(), 0);
            return;
        }
        pendingCheck ||
            ((pendingCheck = !0),
            log('主回复仍在生成，生成结束后检测'),
            view.clearTimeout(pendingTimer),
            (pendingTimer = view.setTimeout(() => {
                pendingCheck && (log('等待生成结束超时，直接检测'), (generating = !1), runPending());
            }, PENDING_MAX_MS)));
    }
    function onGenerationStarted(type, options2, dryRun) {
        if (dryRun || ((generating = !0), !clueMode())) return;
        (clue.register(),
            clue.invalidate(),
            clue.ensureRound(String(type || 'generate')) &&
                clue.isFilling() &&
                (log(`上一轮填表尚未完成；本次生成（${type || '普通'}）没有经过数据库剧情推进，无法等待，线索按上一次已提交的表格计算`),
                toast('warning', '上一轮填表还没完成，本次生成没有经过数据库剧情推进，无法等待；线索按上一次已提交的表格计算。')));
    }
    function onGenerationEnded() {
        ((generating = !1), clue.endRound(), runPending());
    }
    function onGenerationStopped() {
        (clue.discardPendingCandidates(), onGenerationEnded());
    }
    function onMessageReceived(messageId) {
        const floors = floorCount(),
            project = activeProject();
        if (!project) {
            (log(`收到第 ${messageId} 楼：当前卡没有启用的项目，不检测`), emit('floor'));
            return;
        }
        if (clueMode()) {
            clue.bindCandidatesToMessage(Number(messageId));
            clue.expectFill();
            clue.invalidate();
            emit('floor');
            return;
        }
        if (isInfinite(project)) {
            onInfiniteReceived();
            return;
        }
        const settings = data.settings(),
            prog = clampBase() || currentProgress(),
            gap = floors - checkBase(prog);
        (gap >= settings.checkEvery
            ? (log(`收到第 ${messageId} 楼：距上次检测 ${gap} 楼，触发检测`), queueCheck())
            : log(`收到第 ${messageId} 楼：距上次检测 ${gap} 楼，还差 ${settings.checkEvery - gap} 楼`),
            emit('floor'));
    }
    function onMessageChanged() {
        clue.invalidate();
        if (isInfinite(activeProject())) {
            (refreshRead(), revalidateTrigger(), emit('floor'));
            return;
        }
        clampBase() && emit('floor');
    }
    async function onChatChanged() {
        bumpEpoch();
        clue.onChatChanged();
        clue.register();
        ((progress = null),
            (progressFor = ''),
            abandonOpening(),
            (lastRead = null),
            (pendingCheck = !1),
            view.clearTimeout(pendingTimer),
            (chatStartFloors = floorCount()),
            notice.hide('advance'),
            notice.hide('offtrack'),
            notice.hide('thread'));
        const id = activeId();
        if (id)
            try {
                await data.loadProject(id);
            } catch (error) {
                toast('error', `读取项目失败：${error.message}`);
            }
        (log(
            `切换聊天：${floorCount()} 楼，${id ? `启用项目「${(data.index().projects.find((item) => item.id === id) || {}).name || id}」` : '本卡没有启用项目'}`,
        ),
            id && clampBase(),
            refreshRead(),
            scheduleFallback(),
            emit('chat'));
    }
    async function switchProject(id, scope = 'chat') {
        bumpEpoch();
        clue.invalidate();
        (id && (await data.loadProject(id)), abandonOpening());
        const bound = bindChat(id);
        ((scope === 'card' || !bound || !data.activeIdFor(cardKey())) && data.setActive(id),
            (progress = null),
            (progressFor = ''),
            scheduleFallback(),
            emit('switch'));
    }
    let lastOutlineAudit = null;
    function auditOutline(payload) {
        let project = activeProject(),
            prog = currentProgress();
        if (!project || !prog) return null;
        let text = requestToText(payload);
        if (!text) return null;
        let list = flattenUnits(project.outline.volumes),
            states = isInfinite(project) ? Object.fromEntries(list.map((u) => [u.id, 'done'])) : unitStates(list, prog),
            projection = entries()
                .filter((e) => e.enabled && e.content)
                .map((e) => e.content);
        let history = chatMessages()
            .filter((m) => m && !m.is_user && !m.is_system)
            .map((m) => String(m.mes || ''));
        let result = auditOutlineRequest(text, project, states, projection, { history }),
            leaks = result.leaks;
        lastOutlineAudit = { ...result, at: Date.now() };
        leaks.length &&
            (log(
                `最终请求核验：发现 ${leaks.length} 处本项目受限内容（${leaks
                    .slice(0, 3)
                    .map((l) => l.source)
                    .join('、')}${leaks.length > 3 ? '……' : ''}）`,
            ),
            toast(
                'warning',
                `本轮正文请求里出现了还不该出现的剧情内容（${leaks[0].source}，匹配到「${leaks[0].sample}」）。可能是世界书、预设或别的插件带进来的，请到诊断页查看。`,
            ));
        result.duplicated &&
            (log(`最终请求核验：本轮剧情内容出现了 ${result.projectionCount} 次（重复注入）`),
            toast('warning', '本轮剧情内容在正文请求里出现了不止一次，请检查是否同时启用了别的注入路径。'));
        return (emit('clue-audit'), lastOutlineAudit);
    }
    function onPromptReady(payload) {
        if (payload && payload.dryRun) return;
        try {
            if (isBackgroundRequest(requestToText(payload))) return log('插件自己的后台请求（讨论、整理、导入、检测），不做正文核验');
            clueMode() ? clue.auditFinalRequest(payload) : auditOutline(payload);
        } catch (error) {
            log(`最终请求核验出错：${error.message}`);
        }
    }

    const BINDINGS = [
        ['WORLDINFO_ENTRIES_LOADED', onEntriesLoaded],
        ['CHAT_CHANGED', onChatChanged],
        ['MESSAGE_RECEIVED', onMessageReceived],
        ['MESSAGE_UPDATED', onMessageChanged],
        ['MESSAGE_DELETED', onMessageChanged],
        ['MESSAGE_SWIPED', onMessageChanged],
        ['GENERATION_STARTED', onGenerationStarted],
        ['GENERATION_ENDED', onGenerationEnded],
        ['GENERATION_STOPPED', onGenerationStopped],
        ['CHAT_COMPLETION_PROMPT_READY', onPromptReady],
        ['GENERATE_AFTER_COMBINE_PROMPTS', onPromptReady],
    ];
    function bind() {
        const c = ctx(),
            types = eventTypes();
        if (!(!c || !c.eventSource))
            for (const [key, handler] of BINDINGS) {
                const name = types[key];
                if (!name) continue;
                const wrapped = (...args) => {
                    const stat = stats[key] || (stats[key] = { count: 0, at: 0 });
                    return ((stat.count += 1), (stat.at = Date.now()), handler(...args));
                };
                (c.eventSource.on(name, wrapped), listeners.push([key, name, wrapped]));
            }
    }
    function unbind() {
        const c = ctx();
        for (const [, name, handler] of listeners.splice(0))
            try {
                c.eventSource.removeListener(name, handler);
            } catch {}
    }
    function start() {
        (unbind(), bind(), log(`已绑定 ${listeners.length} 个酒馆事件`), onChatChanged());
    }
    function stop() {
        (clue.stop(), unbind(), view.clearTimeout(fallbackTimer), view.clearTimeout(pendingTimer));
    }
    function diagnose() {
        const types = eventTypes(),
            bound = new Set(listeners.map((item) => item[0]));
        return {
            hasContext: !!ctx(),
            hasEventSource: !!(ctx() && ctx().eventSource),
            events: BINDINGS.map(([key]) => ({
                key,
                name: types[key] || '',
                bound: bound.has(key),
                count: (stats[key] || {}).count || 0,
                at: (stats[key] || {}).at || 0,
            })),
            cardKey: cardKey(),
            chatLength: chatMessages().length,
            floors: floorCount(),
            chatStartFloors,
            generating,
            pending: pendingCheck,
            checking,
            lastOutlineAudit,
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
        syncSetting,
        diagnose,
        isInfinite: () => isInfinite(activeProject()),
        infState,
        openWorld,
        isOpening: () => opening,
        lastRead: () => lastRead,
        returnToTrain,
        reopenWorld,
        deleteWorld,
        note: log,
        resetBase,
        rebind: start,
        injectMode: () => (hasEntriesEvent() ? 'virtual' : 'book'),
        clue,
        isClueMode: clueMode,
        bumpEpoch,
        ticket,
        ticketValid,
        refresh: () => {
            (scheduleFallback(), emit('progress'));
        },
    };
}

// v0.2.0 内测版用 @节点id 记录已演节点，统一接入上游跨聊天对齐。
export function migrateStableProgress(progress, volumes, legacyMap = {}) {
    let changed = false,
        dropped = 0;
    const units = flattenUnits(volumes),
        byUid = new Map();
    for (const unit of units)
        for (const node of stageNodes(unit.stage.data)) if (node.item && node.item.id) byUid.set(node.item.id, { node, stageId: unit.id });
    const slots = Object.fromEntries(
        Object.entries(progress.slots || {}).map(([id, slot]) => [
            id,
            Array.isArray(slot.off) ? { ...slot, off: [], offNames: { ...slot.offNames } } : slot,
        ]),
    );
    for (const [stageId, slot] of Object.entries(progress.slots || {})) {
        if (!Array.isArray(slot.off)) continue;
        for (const key of slot.off) {
            const uid = String(key).startsWith('@')
                ? String(key).slice(1)
                : slot.offIds?.[key] || (!slot.offNames ? legacyMap[stageId]?.[key] : null);
            if (uid) {
                changed = true;
                const hit = byUid.get(uid);
                if (hit) {
                    const target = slots[hit.stageId] || { off: [], offNames: {} };
                    slots[hit.stageId] = target;
                    target.off ??= [];
                    target.offNames ??= {};
                    target.off.push(hit.node.id);
                    target.offNames[hit.node.id] = hit.node.name;
                }
            } else if (
                !slot.offNames &&
                !slot.offIds &&
                units.some((u) => u.id === stageId && stageNodes(u.stage.data).some((n) => n.item?.id)) &&
                /^[msw]\d+$/.test(key)
            ) {
                dropped++;
                changed = true;
            } else slots[stageId].off.push(key);
        }
    }
    if (!changed) return progress;
    for (const slot of Object.values(slots)) if (Array.isArray(slot.off)) slot.off = [...new Set(slot.off)];
    return { ...progress, slots, ...(dropped ? { droppedLegacy: (progress.droppedLegacy || 0) + dropped } : {}) };
}

// Positional keys keep upstream thread support; identities keep marks on the same events after edits.
export function stampNodeIds(progress, volumes) {
    let changed = false;
    const byStage = new Map(
        flattenUnits(volumes).map((u) => [u.id, new Map(stageNodes(u.stage.data).map((n) => [n.id, n.item && n.item.id]))]),
    );
    const slots = Object.fromEntries(
        Object.entries(progress.slots || {}).map(([stageId, slot]) => {
            if (!Array.isArray(slot.off)) return [stageId, slot];
            const ids = byStage.get(stageId),
                offIds = {};
            for (const key of slot.off) if (ids && ids.get(key)) offIds[key] = ids.get(key);
            if (JSON.stringify(offIds) === JSON.stringify(slot.offIds || {})) return [stageId, slot];
            changed = true;
            return [stageId, { ...slot, offIds }];
        }),
    );
    return changed ? { ...progress, slots } : progress;
}
