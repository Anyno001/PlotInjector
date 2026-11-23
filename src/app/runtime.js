import { stayText, stayState, addStay, stayEntry, normalizeClueOps, addClueOp } from '../core/clue-progress.js';
import { olByLine, olLines, olLineStates, olUnitStates, olOtherLinesText, olPendingFacts, olReachedStates, olShowName } from '../core/ol-lines.js';
import { cloneTables, readFacts, readKnowledge } from '../core/clue-tables.js';

import { injectedSetting, changedBlockKeys, mergeBlocks, parseSettingReply, pushHistory, splitBlocks } from '../core/setting.js';
import { ensureOutlineIds, isClueMode, stripAuthorBlocks, outlineVolumesView } from '../core/clue-model.js';
import { createClueRuntime, acuApi } from './clue-runtime.js';

import { DEFAULT_PARAMS, pickParams, buildEntries, buildIndexText, carriedNodes, toWorldInfoEntry } from '../core/inject.js';
import { buildPersonaCheckMessages, buildClueCheckMessages, buildCheckMessages, cleanFloorText, parseCheckReply } from '../core/check.js';
import {
    alignPersonaProgress,
    buildPersonaEntries,
    applyMoves,
    checkItems,
    currentStage,
    hasPersonas,
    personaEnv,
    moveText,
    resolveMoves,
    syncPersonas,
    undoMoves,
} from '../core/personas.js';
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
    goToIn,
    undoGoToIn,
    remapStages,
} from '../core/progress.js';

import {
    isPlainObject,
    flattenUnits,
    replaceRest,
    replaceLineRest,
    rewriteByLine,
    lineRestSig,
    pickLineIncoming,
    outlineToText,
    stageLabel,
    stageNodes,
    volumeLabel,
    makeId,
    pushOutlineHistory,
} from '../core/outline.js';
import { discoveryList, clueText, otherLinesText, crossLineLoss } from '../core/clue-project.js';

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

import { setIgsView } from '../core/trpg.js';
import { cardKey, cardName, chatId, chatMessages, ctx, hostWindow, toast } from '../host/st.js';
import { readEntryContent, worldInfoMatchSettings, worldInfoScanDepth, writeFallbackBook } from '../host/worldbook.js';
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
    setIgsView(view);
    let progress = null,
        progressFor = '',
        alignedFrom = null,
        alignedOutline = null,
        alignedPersonas = null,
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
        const id = activeId(),
            project = id ? data.project(id) : null;
        if (!project || project.mode === 'infinite') return project;
        const ids = ensureOutlineIds(project.outline.volumes, project.outlineIdMap);
        return ids.changed
            ? (data.updateProject(id, (cur) => ({
                  ...cur,
                  outline: { ...cur.outline, volumes: ids.volumes },
                  outlineIdMap: ids.legacyMap,
              })),
              data.project(id))
            : project;
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
            const migrated = migrateStableProgress(progress, project.outline.volumes, project.outlineIdMap, project.outline.idAlias),
                aligned = stampNodeIds(alignProgress(migrated, project.outline), project.outline.volumes);
            (aligned !== progress && ((progress = aligned), writeProgress(progress), log('按大纲对照表归位了本聊天的进度')),
                (alignedFrom = progress),
                (alignedOutline = project.outline));
        }
        // 已经在玩、大纲带 `线:` 的老聊天：第一次打开时迁移成按线（当前线接着演，前面的卷标「已过」，不算完成）
        if (
            project &&
            !isInfinite(project) &&
            !isClueMode(project) &&
            progress.current &&
            progress.lineFlow === void 0 &&
            !progress.lines &&
            !normalizeClueOps(progress.olOps).ops.length &&
            olByLine(project.outline.volumes, progress)
        ) {
            const lines = olLines(project.outline.volumes),
                k = lines.findIndex((l) => l.units.some((u) => u.id === progress.current));
            if (k >= 0) {
                const recs = {},
                    line = lines[k],
                    stage = line.units.findIndex((u) => u.id === progress.current) + 1;
                (lines.slice(0, k).forEach((l) => (recs[l.id] = { passed: !0 })),
                    (recs[line.id] = { at: progress.current, mig: !0 }),
                    (progress = { ...progress, lines: recs }),
                    writeProgress(progress),
                    log(`本聊天改为按剧情线推进：${line.id}第${stage}段继续，前${k}卷标为已过`));
                const key = `${chatId()}:${project.id}`;
                olMigrated !== key &&
                    notice.topBar &&
                    ((olMigrated = key),
                    notice.topBar({
                        tag: '剧情线',
                        text: `本聊天已改为按剧情线推进：${line.id}从第${stage}段继续${k ? `，前${k}卷标为已过` : ''}`,
                        action: '改回',
                        run: () => olSetFlow('seq'),
                    }));
            }
        }
        if (project && project.personas !== alignedPersonas) {
            const aligned = alignPersonaProgress(progress, project.personas);
            (aligned !== progress && ((progress = aligned), writeProgress(progress), log('按人设对回了本聊天的人设进度')),
                (alignedPersonas = project.personas));
        }
        return progress;
    }
    function fameNow() {
        try {
            const igs = view.IGS,
                list = igs && igs.stats && typeof igs.stats.fame == 'function' ? igs.stats.fame() : [],
                favor = igs && igs.stats && typeof igs.stats.favor == 'function' ? igs.stats.favor() : [];
            return [...(Array.isArray(list) ? list : []), ...(Array.isArray(favor) ? favor.map((row) => ({ ...row, kind: 'favor' })) : [])];
        } catch {
            return [];
        }
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
    // ---------- 大纲推进按线（方案 五）：不按线时 olInfo 返回 null，其余一切照旧 ----------
    function olEnv(project) {
        const api = acuApi();
        if (!api || typeof api.exportTableAsJson != 'function') return {};
        try {
            const tables = cloneTables(api.exportTableAsJson()),
                b = (project.clue && project.clue.bindings) || {};
            return { tables, facts: readFacts(tables, b.facts || []).facts, knowledge: readKnowledge(tables, b.knowledge || []).rows };
        } catch {
            return {};
        }
    }
    function olInfo(project = activeProject(), prog = currentProgress()) {
        if (!project || isInfinite(project) || isClueMode(project) || !prog || !olByLine(project.outline.volumes, prog)) return null;
        const lines = olLines(project.outline.volumes);
        if (!lines.length) return null;
        const ls = olLineStates(lines, prog, chatMessages(), olEnv(project), links()),
            cur = ls.find((s) => s.state === '进行中') || null;
        return {
            lines,
            ls,
            cur,
            own: new Set(cur ? cur.line.units.map((u) => u.id) : []),
            states: olUnitStates(flattenUnits(project.outline.volumes), prog, ls, links()),
            others: olOtherLinesText(ls, cur),
            turn: floorCount(),
        };
    }
    // 写进度前对齐：current 落在进行中那条线里，记下这条线的位置；自动开始的线补一条开始记录（带楼层锚点）
    function olNormalize(project, next) {
        const ov = olInfo(project, next);
        if (!ov || !ov.cur) return next;
        const id = ov.cur.line.id,
            ids = ov.cur.line.units.map((u) => u.id),
            cur = ids.includes(next.current) ? next.current : ov.cur.at || ids[0],
            recs = next.lines || {},
            rec = recs[id] || {};
        let out = next;
        cur !== out.current && (out = { ...out, current: cur });
        rec.at !== cur && (out = { ...out, lines: { ...recs, [id]: { ...rec, at: cur } } });
        ov.cur.auto && (out = { ...out, olOps: addClueOp(normalizeClueOps(out.olOps), chatMessages(), { kind: 'line', target: id, value: 'start', note: ov.cur.why }) });
        return out;
    }
    function olSyncPersonas(project, next) {
        return syncPersonas(project, next, fameNow(), olReachedStates(olInfo(project, next)));
    }
    function olOpsWith(prog, id, value, note = '') {
        return addClueOp(normalizeClueOps(prog.olOps), chatMessages(), { kind: 'line', target: id, value, note });
    }
    // 线操作：start（开始）/ resume（继续）/ pause / done / abandon / ''（还原）。开始、继续另一条时当前这条暂停。
    function olAct(id, value, note = '') {
        const project = activeProject(),
            prog = currentProgress(),
            ov = olInfo(project, prog);
        if (!ov) return !1;
        const s = ov.ls.find((x) => x.line.id === id);
        if (!s) return !1;
        let next = prog;
        if (value === 'start' || value === 'resume') {
            ov.cur && ov.cur.line.id !== id && (next = { ...next, olOps: olOpsWith(next, ov.cur.line.id, 'pause', `换成${id}`) });
            next = { ...next, olOps: olOpsWith(next, id, value === 'resume' ? 'resume' : 'start', note) };
            const rec = (next.lines || {})[id] || {},
                ids = s.line.units.map((u) => u.id);
            next = { ...next, current: ids.includes(rec.at) ? rec.at : ids[0] };
            value === 'resume' && s.state !== '暂停' && (next = { ...next, olOps: olOpsWith(next, id, 'start', note) });
        } else next = { ...next, olOps: olOpsWith(next, id, value, note) };
        return (setProgress(next, 'line'), notice.hide('advance'), !0);
    }
    // 兜底：本聊天改成按顺序推进（'seq'）或改回按线（''）。各线的状态都保留。
    function olSetFlow(flow) {
        const prog = currentProgress();
        if (!prog) return;
        const next = { ...prog };
        flow === 'seq' ? (next.lineFlow = 'seq') : delete next.lineFlow;
        (setProgress(next, 'line-flow'), notice.hideBar && notice.hideBar());
    }
    // 定期检测顺带确认的事（5b）：每次最多 10 条，按检测次数轮流
    function olFactItems(project, prog, ov) {
        if (!ov) return [];
        return olPendingFacts(ov.lines, ov.ls, prog, chatMessages(), olEnv(project), {
            labels: (project.clue && project.clue.labels) || {},
            turn: Number(prog.olFactTurn) || 0,
        });
    }
    // 检测说发生了的事：记成带楼层锚点的确认（删楼、重 roll 一起撤回）；楼号不在这次读的楼里就记在最后一楼
    function olApplyFacts(next, hits, items, floors) {
        if (!items.length) return next;
        const sent = new Set(items.map((x) => x.id)),
            idx = new Set(floors.map((f) => f.index));
        let ops = normalizeClueOps(next.olOps);
        for (const h of hits || []) {
            if (!sent.has(h.id)) continue;
            ops = addClueOp(ops, chatMessages(), { kind: 'fact', target: h.id, value: 'confirmed', note: '检测确认', atIndex: idx.has(h.floor) ? h.floor : void 0 });
            log(`检测确认：${h.id}`);
        }
        return { ...next, olOps: ops, olFactTurn: (Number(next.olFactTurn) || 0) + 1 };
    }
    let olNotified = null,
        olMigrated = '';
    // 进聊天、换项目时记下已经可以开始的线，之后新满足的才提示
    function olBaseline() {
        const ov = olInfo();
        olNotified = ov ? new Set(ov.ls.filter((s) => s.state === '可开启').map((s) => s.line.id)) : null;
    }
    // 新满足条件的线：顶端提示一行「S01 叶莲娜 可以开始了」，按钮「开始」；同一条只提示一次（进聊天时已满足的不提示）
    function olNotify() {
        const ov = olInfo();
        if (!ov || !notice.topBar) return;
        const ready = ov.ls.filter((s) => s.state === '可开启').map((s) => s.line.id);
        if (!olNotified) return void (olNotified = new Set(ready));
        const fresh = ov.ls.find((s) => s.state === '可开启' && !olNotified.has(s.line.id));
        ready.forEach((id) => olNotified.add(id));
        fresh && notice.topBar({ tag: '剧情线', text: `${olShowName(fresh.line)}可以开始了`, action: '开始', run: () => olAct(fresh.line.id, 'start') });
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
        (project && project.mode !== 'infinite' && (next = stampNodeIds(next, project.outline.volumes)),
            (next = isClueMode(project) ? next : olSyncPersonas(project, olNormalize(project, next))),
            (next = isClueMode(project) ? next : stampActive(progress && progressFor === next.projectId ? progress : null, next)),
            (progress = next),
            (progressFor = next.projectId),
            writeProgress(next),
            scheduleFallback(),
            emit(reason));
    }
    // 只在接口边界把线索阶段映射给人设；不改写大纲模式的独立进度。
    function personaStates() {
        if (!clueMode()) return olReachedStates(olInfo());
        const computed = clue.compute();
        return computed
            ? Object.fromEntries(
                  [...computed.state.stageStates].map(([id, state]) => [
                      id,
                      state.done ? 'done' : state.entered.v === 'true' ? 'active' : 'todo',
                  ]),
              )
            : {};
    }
    function entries({ inject = !1 } = {}) {
        let project = activeProject(),
            prog = currentProgress();
        const persona = hasPersonas(project)
            ? {
                  fame: fameNow(),
                  stageStates: personaStates(),
                  ...(inject ? { recentText: scanText(), globals: worldInfoMatchSettings() } : {}),
              }
            : {};
        return !project || !prog
            ? []
            : isClueMode(project)
              ? [...buildClueEntries(project, prog), ...buildPersonaEntries(project, prog, persona)]
              : buildEntries(
                    {
                        ...project,
                        setting: { ...project.setting, text: stripAuthorBlocks(project.setting.text) },
                        outline: { ...project.outline, volumes: outlineVolumesView(project.outline.volumes) },
                    },
                    prog,
                    data.settings(),
                    { ...persona, stayOf: (unit) => stayText(stayState(prog.stays, chatMessages(), outlineStay(prog, unit)), 'outline'), olView: olInfo(project, prog) },
                );
    }
    function outlineStay(prog, unit) {
        let list = flattenUnits((activeProject() || { outline: { volumes: [] } }).outline.volumes),
            states = unitStates(list, prog),
            active = list.filter((u) => states[u.id] === 'active'),
            only = active.length === 1 ? active[0] : null,
            enabled = (u) => pickParams({ ...DEFAULT_PARAMS, ...activeProject().defaults }.detail, prog.slots[u.id]).enabled;
        return unit ? { key: unit.id, paused: !enabled(unit) } : { key: only ? only.id : '', paused: !!only && !enabled(only) };
    }
    function recordStay(messageId) {
        let prog = currentProgress(),
            project = activeProject();
        if (!prog || !project) return;
        let info = isClueMode(project) ? clue.stayInfo() : outlineStay(prog, null);
        if (!info) return;
        let next = addStay(prog.stays, stayEntry(chatMessages(), Number(messageId), info));
        next !== prog.stays && setProgress({ ...prog, stays: next }, 'stay');
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
                lineOnly: !!proj.lineOnly,
                ...pickParams(defaults.detail, prog.slots[CLUE_SLOT]),
            }),
            out
        );
    }
    function virtualEntries({ recordClue = !1 } = {}) {
        let list = entries({ inject: !0 }),
            clueEntry = list.find((entry) => entry.slotId === CLUE_SLOT);
        return (
            recordClue &&
                clueEntry &&
                clue.record(
                    'worldbook',
                    clueEntry.enabled
                        ? { content: clueEntry.content, used: clueEntry.used, reason: clueEntry.reason, lineOnly: clueEntry.lineOnly }
                        : { content: '', reason: '线索条目已被关闭' },
                ),
            list.filter((entry) => entry.enabled && entry.content).map((entry, index) => toWorldInfoEntry(entry, index, VIRTUAL_WORLD))
        );
    }
    function scanText() {
        const depth = Math.max(1, worldInfoScanDepth());
        return chatMessages()
            .filter((msg) => !isNote(msg))
            .slice(-depth)
            .map((msg) => String(msg.mes || '')).join(`
`);
    }
    function refreshPersonas() {
        const project = activeProject(),
            prog = currentProgress();
        if (!hasPersonas(project) || !prog) return;
        const next = syncPersonas(project, prog, fameNow(), personaStates());
        next !== prog && setProgress(next);
    }
    function onStatsChanged() {
        hasPersonas(activeProject()) && (refreshPersonas(), scheduleFallback(), emit('progress'));
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
            (opening && (await waitOpening()), refreshPersonas());
            clueMode() && (await clue.awaitPlotScene().catch((e) => log(`读剧情推进结果出错：${e.message}`)));
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
        const ov = olInfo(void 0, prog);
        if (ov) {
            if (!ov.cur) return null;
            const own = list.filter((u) => ov.own.has(u.id));
            return own.find((u) => ov.states[u.id] === 'active') || own.find((u) => u.id === ov.cur.at) || own[0] || null;
        }
        const states = unitStates(list, prog);
        return list.find((unit) => states[unit.id] === 'active') || list[currentIndex(list, prog)];
    }
    // 按线：只在当前线里往下走；最后一段演完，这条线完成（接上一条的线随后自动开始）
    function olAdvance(prog, ov) {
        const list = units().filter((u) => ov.own.has(u.id));
        return list.length ? advance({ ...prog, current: ov.own.has(prog.current) ? prog.current : ov.cur.at || list[0].id }, list) : null;
    }
    function openNext({ silent = !1 } = {}) {
        const prog0 = currentProgress(),
            ov = olInfo(void 0, prog0);
        if (ov) {
            if (!ov.cur) return (silent || toast('info', '没有正在演的剧情线。'), null);
            const step = olAdvance(prog0, ov);
            if (step) return (setProgress(step.progress), notice.hide('advance'), step);
            return (olAct(ov.cur.line.id, 'done', '最后一段演完'), silent || toast('info', `${olShowName(ov.cur.line)}已演完。`), null);
        }
        const prog = prog0,
            step = prog && advance(prog, units());
        return step ? (setProgress(step.progress), notice.hide('advance'), step) : (silent || toast('info', '已是最后一段。'), null);
    }
    function backTo(unitId) {
        const prog = currentProgress();
        prog && setProgress(goTo(prog, units(), unitId));
    }
    function proposeAdvance({ unit, reason = '' }) {
        const settings = data.settings(),
            prog = currentProgress();
        if (!prog || isMuted(prog, unit.id) || settings.handleMode === 'nodes') return;
        const ov = olInfo(void 0, prog),
            step = ov ? (ov.cur ? olAdvance(prog, ov) : null) : advance(prog, units());
        if (!step && ov && ov.cur) {
            const lid = ov.cur.line.id,
                name = olShowName(ov.cur.line);
            if (settings.handleMode === 'auto') {
                const before = { olOps: prog.olOps, lines: prog.lines, current: prog.current };
                olAct(lid, 'done', '最后一段演完');
                const after = currentProgress(),
                    mark = JSON.stringify([after.olOps, after.lines, after.current]);
                notice.show({
                    id: 'advance',
                    title: `${name}已演完`,
                    body: reason || '检测判断最后一段已演完。',
                    actions: [
                        {
                            label: '撤销',
                            run: () => {
                                const now = currentProgress();
                                if (JSON.stringify([now.olOps, now.lines, now.current]) !== mark) return toast('info', '之后剧情线又有变化，未撤销。');
                                setProgress({ ...now, olOps: before.olOps, lines: before.lines, current: before.current }, 'line');
                            },
                        },
                    ],
                    timeout: 12e3,
                });
                return;
            }
            notice.show({
                id: 'advance',
                title: `${name}最后一段已演完`,
                body: reason || '检测判断最后一段已演完。',
                actions: [
                    { label: '结束这条线', primary: !0, run: () => olAct(lid, 'done', '最后一段演完') },
                    { label: '暂不', run: () => notice.hide('advance') },
                    { label: '本阶段不再提醒', run: () => setProgress(mute(currentProgress(), unit.id)) },
                ],
            });
            return;
        }
        if (step) {
            if (settings.handleMode === 'auto') {
                (setProgress(step.progress),
                    notice.show({
                        id: 'advance',
                        title: `已切到${placeOf(step.to)}`,
                        body: reason || '检测判断本阶段已演完。',
                        actions: [{ label: '撤销', run: () => backTo(unit.id) }],
                        timeout: 12e3,
                    }));
                return;
            }
            notice.show({
                id: 'advance',
                title: `${placeOf(unit)}已演完`,
                body: reason || '检测判断本阶段已演完。',
                actions: [
                    { label: '打开下一段', primary: !0, run: () => openNext() },
                    { label: '暂不', run: () => notice.hide('advance') },
                    { label: '本阶段不再提醒', run: () => setProgress(mute(currentProgress(), unit.id)) },
                ],
            });
        }
    }
    // volumeId：按线改写后只校对这条线剩余阶段。record：写了设定才填 { before, after }，撤销只认这一笔。
    async function syncSetting(projectId, { from = 0, reason = '', volumeId = '', record = null } = {}) {
        const project = data.project(projectId),
            text = project && project.setting.text.trim();
        if (!text) return [];
        const list = flattenUnits(project.outline.volumes),
            rest = volumeId ? list.slice(from).filter((u) => u.volume.id === volumeId) : null,
            guide = String(data.settings().guide || '').trim() || BUILTIN_GUIDE,
            reply = await requestLlm(
                syncSettingMessages({ guide, setting: text, units: list, fromUnitIndex: from, reason, rest }),
                resolveLlm(data.settings(), 'outline'),
            ),
            body = parseSettingReply(reply).body,
            keys = body ? changedBlockKeys(text, body) : [];
        if (!keys.length) return [];
        // 校对期间设定被手改：不用旧稿结果覆盖
        const now = data.project(projectId);
        if (!now || now.setting.text.trim() !== text) throw new Error('校对期间设定已被修改，校对结果未应用，保留当前设定');
        const next = mergeBlocks(text, body, keys);
        record && ((record.before = now.setting.text), (record.after = next));
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
    // 本聊天大纲推进是否按线（自动偏离改写只改当前线）
    function chatOutlineByLine(project) {
        return !!project && !isClueMode(project) && olByLine(project.outline.volumes, currentProgress());
    }
    async function rewriteRest(reason) {
        const project = activeProject(),
            prog = currentProgress(),
            unit = activeUnit();
        if (!project || !prog || !unit) throw new Error('当前卡未启用项目');
        let t = ticket(),
            list = units(),
            from = list.findIndex((item) => item.id === unit.id),
            // 按线改写：多线项目只改当前线，其余线给紧凑参考；按顺序则改写全书后续。自动偏离改写按本聊天推进方式（方案 四.1、五.2）；「按线」尚未开放，现一律按顺序。作者在改写弹窗手选线不受影响。
            byLine = chatOutlineByLine(project) && rewriteByLine(project.outline.volumes),
            sig = byLine ? lineRestSig(project.outline.volumes, unit.volume.id, unit.stage.id) : '',
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
                    ...(byLine
                        ? { rest: list.slice(from).filter((u) => u.volume === unit.volume), others: otherLinesText(project.outline.volumes, unit.volume.id) }
                        : {}),
                }),
                resolveLlm(data.settings(), 'outline'),
            ),
            parsed = parseOutlineReply(reply);
        if (!parsed.ok) throw new Error(`改写结果格式有误：${parsed.error}`);
        if (!ticketValid(t)) throw new Error('改写期间聊天、项目或推进方式已切换，结果未应用');
        // 以采用这一刻的大纲为底（请求期间别处的修改保留）
        const now = data.project(project.id) || project;
        if (byLine && lineRestSig(now.outline.volumes, unit.volume.id, unit.stage.id) !== sig)
            throw new Error('改写期间这条剧情线被改过（改名、移动或删了阶段），结果未应用');
        const volumes = byLine
            ? replaceLineRest(now.outline.volumes, unit.stage.id, parsed.volumes)
            : replaceRest(now.outline.volumes, unit.stage.id, parsed.volumes);
        if (!volumes)
            throw new Error(byLine ? '回复中无法识别要改写的剧情线（卷名和线编号都不匹配），结果未应用' : '原来的阶段已不存在，结果未应用');
        const lost = byLine ? crossLineLoss(now.outline.volumes, volumes, unit.volume.id) : [];
        if (lost.length) throw new Error(`改写会让别的剧情线用到的内容消失，结果未应用：${lost.join('；')}`);
        const before = {
            volumes: now.outline.volumes,
            progress: currentProgress(),
            setting: now.setting.text,
            volumeId: byLine ? unit.volume.id : '',
        };
        data.updateProject(project.id, (current) => ({
            ...current,
            outline: {
                ...current.outline,
                volumes,
                history: pushOutlineHistory(current.outline.history, current.outline.volumes, '偏离改写'),
            },
        }));
        const first = byLine ? pickLineIncoming(unit.volume, parsed.volumes).stages[0] : parsed.volumes[0] && parsed.volumes[0].stages[0];
        if (first) {
            // 清手动状态：按顺序清全书（同 goTo）；按线只清被替换的段（方案 十.3）。记下实际改动，撤销只还原这些字段。
            const all = flattenUnits(volumes),
                at = Math.max(all.findIndex((u) => u.id === first.id), 0),
                own = byLine ? all.slice(at).filter((u) => u.volume.id === unit.volume.id).map((u) => u.id) : all.map((u) => u.id),
                r = goToIn(currentProgress(), first.id, own);
            (setProgress(r.next), (before.progChanges = r.changes));
        }
        // 指纹在保存、补完节点稳定 id（activeProject 里的 ensureOutlineIds）之后取，补 id 不算「之后又改过」
        activeProject();
        return ((before.afterText = outlineToText((data.project(project.id) || now).outline.volumes)), (before.progressAfter = currentProgress()), before);
    }
    // 撤销只还原本次改动；之后又被修改的内容不覆盖并提示。
    function undoRewrite(projectId, before) {
        // 只在发起改写的聊天里撤（进度属于该聊天）
        if (before.ticket && !ticketValid(before.ticket)) return void toast('warning', '已切换聊天或项目，无法在此撤销本次改写。');
        const cur = data.project(projectId);
        if (!cur) return;
        // 设定只撤这次校对真正写进去的那一笔，而且现在还是写出的样子；没写（失败、拒写、没变化）就不动设定
        const wrote = before.settingWrote && before.settingWrote.after !== void 0 ? before.settingWrote : null,
            outlineSame = outlineToText(cur.outline.volumes) === before.afterText,
            settingSame = !!wrote && cur.setting.text === wrote.after,
            // 进度只撤这次改过的字段（goToIn 记下的）；没有记录（没跳段）就不动进度
            progSame = !!before.progChanges;
        if (!outlineSame)
            return void toast('warning', '改写后大纲又被修改，为避免覆盖后续修改未撤销。如需恢复，可在大纲页「历史」中找回改写前的版本。');
        (data.updateProject(projectId, (current) => ({
            ...current,
            outline: { ...current.outline, volumes: before.volumes },
            ...(settingSame
                ? { setting: { ...current.setting, text: wrote.before, history: pushHistory(current.setting.history, current.setting.text) } }
                : {}),
        })),
            // 撤销等待校对期间玩家可能已操作进度：对得上的段搬回原 id
            currentProgress() &&
                setProgress(
                    remapStages(
                        progSame ? undoGoToIn(currentProgress(), before.progChanges) : currentProgress(),
                        flattenUnits(cur.outline.volumes),
                        flattenUnits(before.volumes),
                    ),
                ),
            toast(
                'info',
                `已撤销改写，恢复原来的大纲${settingSame ? '和设定' : ''}${progSame ? '、进度' : ''}。${wrote && !settingSame ? '设定在改写后被修改过，保留当前设定。' : ''}${progSame ? '之后手动改过的进度保留。' : ''}`,
            ));
    }
    async function runRewrite(reason, { auto = !1 } = {}) {
        const projectId = activeId(),
            t0 = ticket();
        notice.show({ id: 'offtrack', title: '正在改写后续阶段…', body: reason });
        try {
            const before = await rewriteRest(reason);
            before.ticket = t0;
            before.settingWrote = {};
            let synced = '';
            try {
                notice.show({ id: 'offtrack', title: '正在按新大纲校对设定…', body: reason });
                const titles = await syncSetting(projectId, {
                    from: currentIndex(units(), currentProgress()),
                    reason,
                    volumeId: before.volumeId,
                    record: before.settingWrote,
                });
                synced = titles.length
                    ? `
设定已同步修改：${titles.join('、')}。`
                    : '';
            } catch (error) {
                synced = `
设定校对失败：${error.message}`;
            }
            // 校对期间换了聊天：大纲已改好，但撤销须回原聊天对应进度，不再弹撤销提醒
            if (!ticketValid(t0))
                return void toast('info', `已改写后续阶段（大纲已更新）。${synced.trim()}改写期间切换了聊天，不再显示撤销入口。`);
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
            title: `${placeOf(unit)}偏离大纲`,
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
                'clock-tick': `进度钟「${event.name}」推进到${event.filled}/${event.total}`,
                'clock-due': `进度钟「${event.name}」已满格，本段必须发生`,
                'clock-done': `世界动态「${event.name}」已发生`,
                'hook-on': `可选事件「${event.name}」条件满足，已激活`,
                'chain-step': `可选事件链「${event.name}」进入第${event.step + 1}/${event.total}步`,
                'hook-done': `可选事件「${event.name}」已演完`,
                'hook-expired': `可选事件「${event.name}」超过时限，已过期`,
            }[event.type] || event.type
        );
    }
    function adoptThread(projectId, stageId, thread) {
        (data.updateProject(projectId, (current) => ({
            ...current,
            outline: {
                ...current.outline,
                volumes: addPlayerThread(current.outline.volumes, stageId, thread),
                history: pushOutlineHistory(current.outline.history, current.outline.volumes, '收录可选事件'),
            },
        })),
            log(`收录正文里的新事件「${thread.name}」为可选事件`),
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
                    notice.show({ id: 'thread', title: `已收录为可选事件「${thread.name}」`, body: thread.summary, timeout: 1e4 }));
                return;
            }
            notice.show({
                id: 'thread',
                title: `正文出现大纲外的事件「${thread.name}」`,
                body: thread.summary || '大纲中没有这个事件。',
                actions: [
                    { label: '收录', primary: !0, run: () => adoptThread(project.id, unit.stage.id, thread) },
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
                    title: '世界档案尚未生成完成',
                    body: `已等待${WORLD_WAIT_MS / 1e3}秒，本次回复不含档案，生成完成后从下一次回复起带入。`,
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
                toast('info', `请先回到${resolveHub(state.infinite.config).hubName}，再重新打开档案。`);
                return;
            }
            setInf(reenterWorld(state.inf, worldId));
        }
    }
    function deleteWorld(worldId) {
        const state = infState();
        state && setInf(removeWorld(state.inf, worldId, state.infinite.config));
    }
    function personaCheckItems(floors) {
        const project = activeProject(),
            prog = currentProgress();
        return !hasPersonas(project) || !prog || data.settings().personaMode === 'off'
            ? []
            : checkItems(
                  project,
                  prog,
                  floors.map((floor) => floor.text).join(`
`),
                  {
                      globals: worldInfoMatchSettings(),
                      fame: fameNow(),
                      stageStates: personaStates(),
                  },
              );
    }
    function offerPersonaMoves(items, replyMoves) {
        const scope = ticket(),
            project = activeProject(),
            moves = resolveMoves(items, replyMoves);
        if (!moves.length || !project) return;
        const lines = moves.map(moveText),
            adopt = () => {
                if (!ticketValid(scope)) return;
                const prog = currentProgress(),
                    env = personaEnv(activeProject(), prog, fameNow(), personaStates()),
                    still = moves.filter((move) => {
                        const line = activeProject().personas.lines.find((item) => item.id === move.item.lineId);
                        return line && currentStage(line, prog, env).stage.id === move.item.fromId;
                    });
                if (!still.length) {
                    log('人设阶段推进作废：阶段已被改动');
                    return;
                }
                (setProgress(applyMoves(prog, activeProject(), still)), log(`人设阶段推进：${lines.join('；')}`));
            };
        if (data.settings().personaMode === 'auto') {
            (adopt(),
                notice.show({
                    id: 'persona',
                    title: '人设阶段已推进',
                    body: lines.join(`
`),
                    actions: [
                        {
                            label: '撤销',
                            run: () => ticketValid(scope) && setProgress(undoMoves(currentProgress(), activeProject(), moves)),
                        },
                    ],
                    timeout: 15e3,
                }));
            return;
        }
        notice.show({
            id: 'persona',
            title: '人设阶段有变化',
            body: lines.join(`
`),
            actions: [
                { label: '采用', primary: !0, run: adopt },
                { label: '暂不', run: () => notice.hide('persona') },
            ],
        });
    }
    async function checkPersonasOnly({ manual = !1 } = {}) {
        const scope = ticket(),
            settings = data.settings(),
            floors = recentFloors(settings.checkFloors),
            items = floors.length ? personaCheckItems(floors) : [],
            fItems = floors.length ? olFactItems(activeProject(), currentProgress(), olInfo()) : [];
        if (!items.length && !fItems.length)
            return (
                floors.length && !manual && setProgress({ ...currentProgress(), lastCheckFloor: floorCount() }),
                log('跳过检测：大纲为空'),
                manual && hasPersonas(activeProject()) && toast('info', floors.length ? '无需检测的人设线。' : '暂无可检测的正文。'),
                null
            );
        ((checking = !0),
            log(`开始检测人设阶段：${items.length} 条线，读最近 ${floors.length} 楼${manual ? '（手动）' : ''}`),
            emit('checking'));
        try {
            const messages = buildPersonaCheckMessages(items, floors, fItems);
            let result = null;
            for (let attempt = 0; ; attempt += 1)
                try {
                    if (!ticketValid(scope)) return null;
                    result = parseCheckReply(await requestLlm(messages, resolveLlm(settings, 'check'), { timeoutMs: 12e4 }));
                    break;
                } catch (error) {
                    if (!ticketValid(scope) || attempt >= CHECK_RETRIES) throw error;
                    (log(`检测请求失败：${error.message}，${RETRY_GAP_MS / 1e3} 秒后第 ${attempt + 1} 次重试`),
                        await new Promise((resolve) => view.setTimeout(resolve, RETRY_GAP_MS)));
                }
            if (!ticketValid(scope)) return null;
            notice.hide('checkfail');
            const next = olApplyFacts({ ...currentProgress(), lastCheckFloor: floorCount() }, result.facts, fItems, floors);
            (delete next.lastFailFloor, setProgress(next), olNotify());
            const moves = result.personas || [];
            return (
                log(`${items.length ? '人设' : '剧情线条件'}检测完成：${moves.length}条人设建议${fItems.length ? `，确认${(result.facts || []).filter((h) => fItems.some((x) => x.id === h.id)).length}件事` : ''}`),
                items.length && offerPersonaMoves(items, moves),
                manual && !moves.length && !(result.facts || []).length && toast('info', items.length ? '人设阶段无变化。' : '没有确认新的事。'),
                result
            );
        } catch (error) {
            return (
                ticketValid(scope) &&
                    (setProgress({ ...currentProgress(), lastFailFloor: floorCount() }),
                    log(`检测失败：${error.message}`),
                    notice.show({
                        id: 'checkfail',
                        title: '进度检测失败',
                        body: `已自动重试${CHECK_RETRIES}次：${error.message}`,
                        actions: [
                            { label: '重试', primary: !0, run: () => checkNow({ manual }) },
                            { label: '关闭', run: () => {} },
                        ],
                    })),
                null
            );
        } finally {
            ((checking = !1), emit('checked'));
        }
    }
    async function checkNow({ manual = !1 } = {}) {
        if (isInfinite(activeProject())) return (log('无限流项目不使用检测模型'), null);
        if (checking) return (log('跳过检测：上一次检测还没结束'), null);
        const project = activeProject(),
            prog = currentProgress(),
            settings = data.settings();
        if (!project || !prog) return (log('跳过检测：当前卡没有启用的项目'), manual && toast('info', '当前卡未启用项目。'), null);
        const sw = threadSwitches(project),
            unit = activeUnit() && maskUnits([activeUnit()], sw)[0];
        if (!unit) return checkPersonasOnly({ manual });
        const floors = recentFloors(settings.checkFloors);
        if (!floors.length) return (log('跳过检测：没有可检测的正文'), manual && toast('info', '暂无可检测的正文。'), null);
        ((checking = !0), log(`开始检测：${placeOf(unit)}，读最近 ${floors.length} 楼${manual ? '（手动）' : ''}`), emit('checking'));
        let t = ticket();
        try {
            if (clueMode()) return await clueCheck(floors);
            const olKey = (p) => {
                    const o = olInfo(project, p);
                    return JSON.stringify([p.lineFlow || '', o && o.cur ? o.cur.line.id : '', o && o.cur ? o.cur.at : p.current]);
                },
                key0 = olKey(prog),
                ov = olInfo(project, prog),
                list = maskUnits(flattenUnits(outlineVolumesView(project.outline.volumes)), sw),
                states = ov ? ov.states : unitStates(list, prog),
                opts = { carryOver: settings.carryOver, hookCap: settings.hookCap, links: links() },
                index = buildIndexText(list, states, prog, { ...opts, olView: ov }),
                own = ov ? list.filter((u) => ov.own.has(u.id)) : list,
                threadInfo = checkThreads(liveThreads(own, states, prog, opts), {
                    newThreadMode: sw.sideOn ? settings.newThreadMode : 'off',
                    ignored: threadState(prog).ignored,
                    readTo: prog.lastCheckFloor,
                }),
                pItems = personaCheckItems(floors),
                fItems = olFactItems(project, prog, ov),
                messages = buildCheckMessages(unit, index, floors, threadInfo, pItems, fItems);
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
            if (olKey(currentProgress()) !== key0) return (log('检测返回时剧情线或当前阶段已经变了，结果丢弃'), null);
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
                for (const item of carriedNodes(own, states, prog, { links: opts.links }))
                    next = uncheckByNames(next, item.unit.id, [item.node], result.done);
            const ov2 = ov && olInfo(project, next),
                merged = applyCheck(next, liveThreads(own, ov2 ? ov2.states : unitStates(list, next), next, opts), result, { floor: floorCount() });
            ((next = olApplyFacts({ ...merged.progress, lastCheckFloor: floorCount() }, result.facts, fItems, floors)), delete next.lastFailFloor, setProgress(next), olNotify());
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
                offerPersonaMoves(pItems, result.personas || []),
                result
            );
        } catch (error) {
            return ticketValid(t)
                ? (setProgress({ ...currentProgress(), lastFailFloor: floorCount() }),
                  log(`检测失败：${error.message}`),
                  notice.show({
                      id: 'checkfail',
                      title: '进度检测失败',
                      body: `已自动重试${CHECK_RETRIES}次：${error.message}`,
                      actions: [
                          { label: '重试', primary: !0, run: () => checkNow({ manual }) },
                          { label: '关闭', run: () => {} },
                      ],
                  }),
                  null)
                : (log('检测失败且请求期间已切换，保留当前进度'), null);
        } finally {
            ((checking = !1), emit('checked'));
        }
    }
    async function clueCheck(floors) {
        let c = clue.compute(),
            focus = c && c.state.nodeStates.find((s) => s.node.uid && s.node.uid === c.state.focus.uid);
        if (!focus)
            return hasPersonas(activeProject())
                ? checkPersonasOnly({ manual: true })
                : (toast('info', '线索模式需先确定本轮场景才能检测。'), null);
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
            pItems = personaCheckItems(floors),
            reply2 = await requestLlm(buildClueCheckMessages(material, floors, pItems), resolveLlm(data.settings(), 'check'), {
                timeoutMs: 12e4,
            }),
            result = parseCheckReply(reply2);
        return ticketValid(t)
            ? (offerPersonaMoves(pItems, result.personas || []),
              log(`线索检测建议：${result.done.length ? '场景可能已演完' : '场景未演完'}`),
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
            threads !== prog && log(`可选事件与进度钟记下的楼数大于当前楼数${floors}，已改为${floors}`));
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
    async function onGenerationStarted(type, options2, dryRun) {
        dryRun || ((generating = !0), clueMode() && (clue.register(), clue.invalidate(), clue.ensureRound(String(type || 'generate'))));
        // 推进在这之后才跑（数据库在 GENERATION_AFTER_COMMANDS 里调用）：先确认它用的是带场景判断的最新复制品
        !dryRun && clueMode() && (await clue.syncPlotPreset({ force: !0 }).catch((e) => log(`推进预设出错：${e.message}`)));
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
        if ((recordStay(messageId), clueMode())) {
            (clue.bindCandidatesToMessage(Number(messageId)),
                clue.invalidate(),
                log(`收到第 ${messageId} 楼：线索模式不做自动检测，等待填表结果`),
                emit('floor'));
            return;
        }
        if (isInfinite(project)) {
            onInfiniteReceived();
            return;
        }
        olNotify();
        const settings = data.settings(),
            prog = clampBase() || currentProgress(),
            gap = floors - checkBase(prog);
        (gap >= settings.checkEvery
            ? (log(`收到第 ${messageId} 楼：距上次检测 ${gap} 楼，触发检测`), queueCheck())
            : log(`收到第 ${messageId} 楼：距上次检测 ${gap} 楼，还差 ${settings.checkEvery - gap} 楼`),
            emit('floor'));
    }
    function onMessageChanged() {
        if ((clue.invalidate(), isInfinite(activeProject()))) {
            (refreshRead(), revalidateTrigger(), emit('floor'));
            return;
        }
        clampBase() && emit('floor');
    }
    async function onChatChanged() {
        ((olNotified = null),
            bumpEpoch(),
            clue.onChatChanged(),
            clue.register(),
            (alignedPersonas = null),
            (progress = null),
            (progressFor = ''),
            abandonOpening(),
            (lastRead = null),
            (pendingCheck = !1),
            view.clearTimeout(pendingTimer),
            (chatStartFloors = floorCount()),
            notice.hide('advance'),
            notice.hide('offtrack'),
            notice.hide('thread'),
            notice.hide('persona'));
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
            olBaseline(),
            // 项目读完再同步一次线索表（补行、场景目录、从当前楼层开始记），不用等下一次填表
            clueMode() && (clue.register(), clue.scheduleSync()),
            emit('chat'));
    }
    async function switchProject(id, scope = 'chat') {
        (bumpEpoch(),
            clue.invalidate(),
            (alignedPersonas = null),
            notice.hide('persona'),
            id && (await data.loadProject(id)),
            abandonOpening());
        const bound = bindChat(id);
        ((scope === 'card' || !bound || !data.activeIdFor(cardKey())) && data.setActive(id),
            (progress = null),
            (progressFor = ''),
            clue.hideLineBar(),
            clue.invalidate(),
            clueMode() && clue.scheduleSync(),
            scheduleFallback(),
            (olNotified = null),
            olBaseline(),
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
                .map((e) => e.content),
            history = chatMessages()
                .filter((m) => m && !m.is_user && !m.is_system)
                .map((m) => String(m.mes || '')),
            result = auditOutlineRequest(text, project, states, projection, { history }),
            leaks = result.leaks;
        return (
            (lastOutlineAudit = { ...result, at: Date.now() }),
            leaks.length &&
                (log(
                    `最终请求核验：发现 ${leaks.length} 处不该出现的剧情（${leaks
                        .slice(0, 3)
                        .map((l) => l.source)
                        .join('、')}${leaks.length > 3 ? '……' : ''}）`,
                ),
                toast(
                    'warning',
                    `本轮正文请求中出现了不应出现的剧情内容（${leaks[0].source}，匹配到「${leaks[0].sample}」）。可能来自世界书、预设或其他插件，请到诊断页查看。`,
                )),
            result.duplicated &&
                (log(`最终请求核验：本轮剧情内容出现了 ${result.projectionCount} 次（重复注入）`),
                toast('warning', '本轮剧情内容在正文请求中出现多次，请检查是否同时启用了其他注入路径。')),
            emit('clue-audit'),
            lastOutlineAudit
        );
    }
    function onPromptReady(payload) {
        if (!(payload && payload.dryRun))
            try {
                if (isBackgroundRequest(requestToText(payload))) return log('插件自己的后台请求（讨论、整理、导入、检测），不做正文核验');
                clueMode() ? (clue.stripPlotSceneFrom(payload), clue.auditFinalRequest(payload)) : auditOutline(payload);
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
        try {
            for (const win of /* @__PURE__ */ new Set([view, window])) win.addEventListener('igs:stats-changed', onStatsChanged);
        } catch {}
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
        try {
            for (const win of /* @__PURE__ */ new Set([view, window])) win.removeEventListener('igs:stats-changed', onStatsChanged);
        } catch {}
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
        fame: fameNow,
        personaStates,
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
        olInfo: () => olInfo(),
        olAct,
        olSetFlow,
        isClueMode: clueMode,
        bumpEpoch,
        ticket,
        ticketValid,
        refresh: () => {
            (scheduleFallback(), emit('progress'));
        },
    };
}

// 兼容 v0.2.0 的 @节点id 记录。
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
