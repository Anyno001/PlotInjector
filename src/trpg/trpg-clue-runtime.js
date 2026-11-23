import { injectedSetting } from '../core/setting.js';
import {
    withLineIds,
    lineToManual,
    confirmTierOrder,
    compileClue,
    computeClueState,
    prebuiltGaps,
    tableConsistencyHints,
    NODE_STATUS_LABELS,
    effectiveFact,
    AWAY_PREFIX,
} from './trpg-clue-rules.js';
import {
    focusTakenOver,
    validStays,
    stayText,
    stayState,
    normalizeClueOps,
    effectiveClueProgress,
    diffClueStatus,
    addClueOp,
} from './trpg-clue-progress.js';
import {
    catalogKnown,
    lineEntryPlan,
    lineAwayInfo,
    acuIsolationKey,
    fillEvidence,
    enterEvidence,
    sideSlots,
    mainSlotTaken,
    mainInProgress,
    LINE_CATALOG_COL,
    sceneCatalogCell,
    appendTargetFloor,
} from '../core/lines.js';

import { prebuildDiff, prebuildPlan, focusScore, discoveryList, buildClueProjection, clueText } from './trpg-clue-project.js';

import {
    findSheet,
    sheetRows,
    findRow,
    cloneTables,
    readFacts,
    readKnowledge,
    readCell,
    sameValue,
    cellText,
    plotPresetConflicts,
} from './trpg-clue-tables.js';

import { hostWindow, chatMessages, ctx, toast } from '../host/st.js';
import { isTrpg, trpgCheckResults } from './trpg.js';
import { kpInject } from './trpg-kp.js';
import { parseTimeline, readGameClock } from './trpg-timeline.js';
import { trpgWantFacts } from './trpg-rows.js';
import { isClueMode, withNodeIds } from './trpg-clue-model.js';

import { isPlainObject } from '../core/outline.js';

import { requestToText, auditRequest } from './trpg-clue-audit.js';

export const CLUE_LOG_MAX = 40;

export const ROUND_TTL_MS = 18e4;

export const CANDIDATE_KEEP = 40;

export function acuApi() {
    let w = hostWindow();
    return w.AutoCardUpdaterAPI || window.AutoCardUpdaterAPI || null;
}

export function createClueRuntime({ data, getProject, getProgress, setProgress, emit, log, ticket = () => null, ticketValid = () => !0 }) {
    let lastTableUpdate = 0,
        lastAudit = null,
        lastInjected = null,
        dirty = !0,
        cache = null,
        lastStatus = null,
        tableCallback = null,
        events = [],
        round = null;
    function note(text) {
        (events.push({ at: Date.now(), text }), events.length > CLUE_LOG_MAX && events.shift(), log(`[线索] ${text}`));
    }
    function project() {
        let p = getProject();
        return isClueMode(p) ? p : null;
    }
    function clueOps() {
        let prog = getProgress();
        return normalizeClueOps(prog && prog.clue);
    }
    function ensureIds(p) {
        let fix = (vols) => withLineIds(withNodeIds(vols));
        return fix(p.outline.volumes) === p.outline.volumes
            ? p
            : (data.updateProject(p.id, (cur) => ({ ...cur, outline: { ...cur.outline, volumes: fix(cur.outline.volumes) } })),
              note('已给缺少编号的节点、剧情线补上稳定编号'),
              data.project(p.id) || p);
    }
    function snapshot(p) {
        let api = acuApi();
        if (!api || typeof api.exportTableAsJson != 'function')
            return {
                facts: /* @__PURE__ */ new Map(),
                knowledge: [],
                tables: {},
                problems: ['没有检测到数据库插件（shujuku），所有线索都按未知算。请确认数据库插件已安装并开启'],
                api: !1,
            };
        let tables = cloneTables(api.exportTableAsJson()),
            f = readFacts(tables, p.clue.bindings.facts),
            k = readKnowledge(tables, p.clue.bindings.knowledge),
            problems = [...f.problems, ...k.problems],
            knowPresent = (p.clue.bindings.knowledge || []).length ? k.present : null;
        p.clue.bindings.facts.length || problems.push('还没有绑定事实表');
        let sw = p.clue.bindings.switch,
            enabled = !0;
        if (sw && sw.路径) {
            let cell = readCell(tables, sw.路径);
            cell.state !== 'ok'
                ? (problems.push(`主线开关：${cell.reason}`), (enabled = !1))
                : (enabled = sameValue(cell.value, sw.开启值 ?? 1));
        }
        return { facts: f.facts, knowledge: k.rows, knowPresent, tables, problems, enabled, api: !0 };
    }
    function compute() {
        let p = project();
        if (!p) return null;
        if (!dirty && cache && cache.projectId === p.id && cache.outline === p.outline && cache.clue === p.clue) return cache;
        p = ensureIds(p);
        let compiled = compileClue(p.outline.volumes),
            snap = snapshot(p),
            prog = effectiveClueProgress(clueOps(), chatMessages()),
            scenePath = p.clue.bindings.scene && p.clue.bindings.scene.路径,
            sceneCell = scenePath ? readCell(snap.tables || {}, scenePath) : null;
        prog.focusTaken = focusTakenOver(
            prog,
            (getProgress() || {}).stays,
            chatMessages(),
            sceneCell && sceneCell.state === 'ok' ? cellText(sceneCell.value) : void 0,
        );
        // KP 检测判成立的「情况」条件（progress.trpgKp.conds）
        prog.trpgConds = ((getProgress() || {}).trpgKp || {}).conds || {};
        let state = computeClueState(compiled, snap, prog, p.clue);
        snap.api && (p.clue.bindings.facts || []).length && snap.problems.push(...prebuiltGaps(compiled, snap));
        let unoffered = snap.api ? unofferedFacts(compiled, snap, prog) : [],
            hints = snap.api ? tableConsistencyHints(snap) : [],
            status = Object.fromEntries(state.nodeStates.filter((s) => s.node.uid).map((s) => [s.node.uid, s.status]));
        if (lastStatus && lastStatus.projectId === p.id)
            for (let change of diffClueStatus(lastStatus.map, status)) {
                let s = state.nodeStates.find((x) => x.node.uid === change.uid);
                note(`${s ? s.node.name : change.uid}：${NODE_STATUS_LABELS[change.from]} → ${NODE_STATUS_LABELS[change.to]}`);
            }
        let multi = compiled.lines.length > 0,
            known = multi && snap.api && scenePath ? catalogKnown(snap.tables, scenePath) : null,
            plan = multi
                ? lineEntryPlan(state, prog, {
                      limit: p.clue.sideLimit || 1,
                      offers: lineOffers(),
                      round: aiFloors(),
                      firstOffer: firstOffered(),
                      known,
                  })
                : null,
            notReady = multi && snap.api && (p.clue.bindings.facts || []).length ? factsNotReady(p, snap) : /* @__PURE__ */ new Set(),
            away = multi ? linesAway(compiled, state, sceneCell && sceneCell.state === 'ok' ? cellText(sceneCell.value) : '') : {};
        return (
            (lastStatus = { projectId: p.id, map: status }),
            (cache = {
                projectId: p.id,
                outline: p.outline,
                clue: p.clue,
                compiled,
                snap,
                prog,
                state,
                plan,
                notReady,
                hints,
                unoffered,
                away,
                at: Date.now(),
            }),
            (dirty = !1),
            cache
        );
    }
    function linesAway(compiled, state, sceneNowValue) {
        let uidLine = /* @__PURE__ */ new Map(),
            placeOf = /* @__PURE__ */ new Map(),
            out = {};
        for (let n of compiled.nodes)
            n.uid &&
                n.unit.line &&
                (uidLine.set(n.uid, n.unit.line.id), placeOf.set(n.uid, clueText(isPlainObject(n.item) ? n.item.地点 : '')));
        let prog = getProgress(),
            rows = [{ scene: sceneNowValue || '' }, ...validStays(prog && prog.stays, chatMessages())];
        for (let s of state.lineStates || []) {
            if (s.state !== '进行中') continue;
            let a = lineAwayInfo(rows, s.line.id, uidLine, placeOf);
            a && (out[s.line.id] = a);
        }
        return out;
    }
    function factsNotReady(p, snap) {
        let diff = prebuildDiff(prebuildPlan(p.outline.volumes), snap, p.clue.bindings),
            knows = (p.clue.bindings.knowledge || []).length && snap.knowPresent ? diff.newKnows : [];
        return /* @__PURE__ */ new Set([...diff.newFacts.map((f) => f.code), ...knows.map((k) => k.fact)]);
    }
    function isoKey() {
        let c = ctx(),
            bridge = hostWindow().__ACU_USERSCRIPT_BRIDGE__,
            a = acuIsolationKey(c && c.extensionSettings);
        return a !== null ? a : acuIsolationKey(bridge && bridge.extension_settings);
    }
    var LINE_FLOOR_KEEP = 400;
    function lineFloors() {
        let prog = getProgress(),
            chat = chatMessages();
        return (prog && Array.isArray(prog.lineFloors) ? prog.lineFloors : []).filter(
            (x) =>
                chat[x.i] &&
                !chat[x.i].is_user &&
                (Number(chat[x.i].swipe_id) || 0) === x.swipe &&
                String(chat[x.i].send_date ?? '') === x.stamp,
        );
    }
    function lineOffers() {
        return lineFloors()
            .filter((x) => x.offer)
            .map((x) => ({ i: x.i, line: x.offer }));
    }
    function firstOffered() {
        return new Set(
            lineFloors()
                .map((x) => x.offer)
                .filter(Boolean),
        );
    }
    function aiFloors() {
        return chatMessages().filter((m) => m && !m.is_user).length;
    }
    function bindLineFloor(index, used) {
        let msg = chatMessages()[index],
            prog = getProgress();
        if (!msg || msg.is_user || !prog || !used) return;
        let list = (Array.isArray(prog.lineFloors) ? prog.lineFloors : []).filter(
            (x) => !(x.i === index && x.swipe === (Number(msg.swipe_id) || 0)),
        );
        (list.push({
            i: index,
            swipe: Number(msg.swipe_id) || 0,
            stamp: String(msg.send_date ?? ''),
            recognize: (used.recognize || []).map((r) => ({ uid: r.uid, line: r.line })),
            offer: used.offer || '',
        }),
            setProgress({ ...prog, lineFloors: list.sort((a, b) => a.i - b.i).slice(-LINE_FLOOR_KEEP) }, 'line-floor'));
    }
    var SYNC_DELAY_MS = 1500;
    let syncTimer = 0,
        syncing = !1,
        syncAgain = !1,
        lastToast = { key: '', at: 0 },
        lineBar = null,
        catalogMissing = !1,
        labelsWarned = !1;
    function scheduleSync() {
        let w = hostWindow();
        (w.clearTimeout(syncTimer),
            (syncTimer = w.setTimeout(() => {
                syncLines().catch((e) => note(`多线同步出错：${e.message}`));
            }, SYNC_DELAY_MS)));
    }
    function sceneSheetKey(p, tables) {
        let path = p.clue.bindings.scene && p.clue.bindings.scene.路径,
            name = path ? String(path).split('/')[0].trim() : '',
            f = name ? findSheet(tables || {}, name) : { error: 'x' };
        return f.error ? '' : f.sheet.key;
    }
    async function syncLines() {
        if (syncing) return void (syncAgain = !0);
        let p = project();
        if (p) {
            syncing = !0;
            try {
                dirty = !0;
                let c = compute();
                if (!c || !c.snap.api) return;
                let t0 = ticket(),
                    chat = chatMessages(),
                    changed = !1,
                    lastAi = -1;
                if (!c.plan) return void (await writeCatalog(p, c, t0));
                for (let i = chat.length - 1; i >= 0; i--)
                    if (chat[i] && !chat[i].is_user) {
                        lastAi = i;
                        break;
                    }
                let rec = lastAi >= 0 ? lineFloors().find((x) => x.i === lastAi) : null,
                    path = p.clue.bindings.scene && p.clue.bindings.scene.路径,
                    cell = path ? readCell(c.snap.tables || {}, path) : null,
                    value = cell && cell.state === 'ok' ? cellText(cell.value) : '',
                    iso = isoKey(),
                    proof = lastAi >= 0 ? fillEvidence(chat[lastAi], sceneSheetKey(p, c.snap.tables), iso) : { ok: !1, reason: '' },
                    autoStart = c.state.lineStates.filter(
                        (s) => s.line.mode === 'auto' && s.state === '进行中' && !s.manual.started && s.why === '开启条件已满足',
                    );
                if (
                    (autoStart.length &&
                        lastAi >= 0 &&
                        (addOps(
                            autoStart.map((s) => ({
                                kind: 'line',
                                target: s.line.id,
                                value: 'start',
                                text: `auto@${lastAi}`,
                                note: '开启条件满足，自动开始',
                                atIndex: lastAi,
                            })),
                        ),
                        (changed = !0)),
                    rec && value && rec.recognize.some((r) => r.uid === value))
                ) {
                    let denied = Object.fromEntries(Object.entries(c.prog.lines || {}).map(([k, v]) => [k, v.denied || []])),
                        ev = enterEvidence({
                            allowed: rec.recognize,
                            cell: value,
                            floor: lastAi,
                            swipe: Number(chat[lastAi].swipe_id) || 0,
                            evidenceOk: proof.ok,
                            denied,
                        }),
                        ls = ev && c.state.lineStates.find((s) => s.line.id === ev.line);
                    if (
                        (proof.ok || note(`当前场景是入口${value}，但${proof.reason}，先不算进入（可以在执行页点「进入」）`),
                        ev && ls && !ls.started && !ls.manual.state)
                    ) {
                        let slots = sideSlots(c.state.lineStates, p.clue.sideLimit || 1),
                            busy = ls.line.kind === 'main' ? mainSlotTaken(c.state.lineStates, ls.line.id) : '';
                        if (busy) note(`没有开始${ev.line}：${busy}`);
                        else if (ls.line.kind === 'main' && c.prog.mainPaused) note(`主线已全部暂停：没有开始${ev.line}`);
                        else if (ls.line.kind === 'side' && c.prog.sidePaused) note(`支线已全部暂停：没有开始${ev.line}`);
                        else if (ls.line.kind === 'side' && slots.full) {
                            let off = slots.used.length === 1 ? c.state.lineStates.find((x) => x.line.id === slots.used[0]) : null;
                            lineToast(`full:${ev.key}`, '支线已满', ls.line.name, '切换', () =>
                                switchSide(ev.line, ev.key, lastAi, '', ev.uid),
                            );
                        } else
                            (addOps([{ kind: 'line', target: ev.line, value: 'start', text: ev.key, note: '走进了入口', atIndex: lastAi }]),
                                (changed = !0),
                                note(`线${ev.line}开始：第${lastAi}楼走进了入口${ev.uid}`),
                                lineToast(`start:${ev.key}`, ls.line.kind === 'side' ? '支线开始' : '主线开始', ls.line.name, '取消', () =>
                                    denyStart(ev.line, ev.key),
                                ));
                    }
                }
                let dueEntry = c.plan.due && rec && rec.recognize.some((r) => r.line === c.plan.due && r.uid === value);
                if (
                    (!changed &&
                        c.plan.due &&
                        lastAi >= 0 &&
                        proof.ok &&
                        !dueEntry &&
                        (addOps([
                            {
                                kind: 'line',
                                target: c.plan.due,
                                value: 'skip',
                                note: '提示了3次没有进入，先让后面的上来',
                                atIndex: lastAi,
                            },
                        ]),
                        (changed = !0),
                        note(`支线${c.plan.due}提示了3次没有进入，排到后面`)),
                    !ticketValid(t0))
                )
                    return;
                changed && (dirty = !0);
                let now = compute();
                now && (await writeCatalog(p, now, t0), await fillRows(p, now, t0));
            } finally {
                ((syncing = !1), syncAgain && ((syncAgain = !1), scheduleSync()));
            }
        }
    }
    function addOps(list) {
        let prog = getProgress();
        if (!prog) return;
        let ops = clueOps(),
            chat = chatMessages();
        for (let op of list) ops = addClueOp(ops, chat, op);
        (setProgress({ ...prog, clue: ops }, 'clue-op'), invalidate(), list.forEach((op) => note(`操作：${opLabel(op)}`)));
    }
    function denyStart(id, key) {
        (addOps([{ kind: 'line', target: id, value: 'deny', text: key, note: '玩家点了取消开启' }]), scheduleSync());
    }
    function switchSide(id, key, floor, pauseId = '', uid = '') {
        let c = ((dirty = !0), compute()),
            p = project();
        if (!c || !p) return;
        let s = c.state.lineStates.find((x) => x.line.id === id),
            used = sideSlots(c.state.lineStates, p.clue.sideLimit || 1).used;
        if (!s || s.started || (s.manual.state && s.manual.state !== 'pause') || !s.eligible)
            return toast('info', '这条支线的状态已经变了，没有切换。');
        if (c.prog.sidePaused) return toast('info', '支线已全部暂停，没有切换。先点「继续全部支线」。');
        let off = pauseId || (used.length === 1 ? used[0] : '');
        if (used.length >= (p.clue.sideLimit || 1) && !used.includes(off))
            return toast('info', `现在有${used.length}条支线在进行，请到执行页「剧情线」里先暂停其中一条，再点这条的「进入」。`);
        let ops = [];
        (used.includes(off) &&
            used.length >= (p.clue.sideLimit || 1) &&
            ops.push({ kind: 'line', target: off, value: 'pause', note: `切换到${id}` }),
            s.manual.state === 'pause' && ops.push({ kind: 'line', target: id, value: 'resume' }),
            ops.push({
                kind: 'line',
                target: id,
                value: 'start',
                text: key || 'manual',
                note: ops.length ? `从${off}切换过来` : '人工进入',
                ...(Number.isInteger(floor) ? { atIndex: floor } : {}),
            }),
            (!key || key === 'manual') && uid && ops.push({ kind: 'focus', target: uid, value: !0, sceneAt: sceneNow() }));
        let offName = ops.length > 1 && (c.state.lineStates.find((x) => x.line.id === off) || { line: { name: off } }).line.name;
        (addOps(ops), scheduleSync(), offName && toast('success', `已换成「${s.line.name}」，「${offName}」先暂停。`));
    }
    function enterLine(id, pauseId = '', uid = '') {
        let c = ((dirty = !0), compute()),
            p = project();
        if (!c || !p) return;
        let s = c.state.lineStates.find((x) => x.line.id === id);
        if (!s || s.started) return;
        if (!s.eligible) throw new Error('这条线的开启条件还没满足；想早点开，可以修改它的开启条件');
        let other = s.line.kind === 'main' ? mainInProgress(c.state.lineStates, id) : null;
        if (s.line.kind === 'main' && c.prog.mainPaused) throw new Error('主线已全部暂停，先点「继续全部主线」');
        if (s.line.kind === 'side' && c.prog.sidePaused) throw new Error('支线已全部暂停，先点「继续全部支线」');
        let entry = uid && s.entries.includes(uid) ? uid : s.entries.length === 1 ? s.entries[0] : '';
        if (s.line.kind === 'side' && sideSlots(c.state.lineStates, p.clue.sideLimit || 1).full)
            return switchSide(id, 'manual', void 0, pauseId, entry);
        (addOps([
            ...(other ? [{ kind: 'line', target: other.line.id, value: 'pause', note: `换成${id}` }] : []),
            { kind: 'line', target: id, value: 'start', text: 'manual', note: '人工进入' },
            ...(entry ? [{ kind: 'focus', target: entry, value: !0, sceneAt: sceneNow() }] : []),
        ]),
            scheduleSync());
    }
    function lineToast(key, tag, text, action, run) {
        let p = project();
        if (!p || p.clue.lineToast === !1 || lastToast.key === key) return;
        let t0 = ticket(),
            guarded = () => (ticketValid(t0) && project() ? run() : toast('info', '已经切换了聊天或项目，这条提示作废了。'));
        ((lastToast = { key, at: Date.now() }), lineBar && lineBar({ key, tag, text, action, run: guarded }));
    }
    async function writeCatalog(p, c, t0) {
        let api = acuApi(),
            col = LINE_CATALOG_COL,
            path = p.clue.bindings.scene && p.clue.bindings.scene.路径;
        if (!api || typeof api.updateCell != 'function' || !path) return;
        let [table, row] = String(path)
                .split('/')
                .map((x) => x.trim()),
            want = sceneCatalogCell(c.state, c.plan || { recognize: [] }, c.prog),
            found = findSheet(c.snap.tables || {}, table);
        if (found.error) return;
        let { col: colOf, rows } = sheetRows(found.sheet),
            ci = colOf(col),
            hits = findRow(rows, row);
        if (ci < 0) return catalogMissing || ((catalogMissing = !0), note(`线索控制表还没有「${col}」这一列：点一次「创建模板」补上`));
        if (hits.length !== 1 || cellText(hits[0][ci]) === want || !ticketValid(t0)) return;
        let index = found.sheet.content.indexOf(hits[0]);
        if (index < 1) return;
        let ok = await Promise.resolve(
                api.updateCell({ tableName: table, rowIndex: index, colIdentifier: col, value: want, skipNotify: !0 }),
            ).catch(() => !1),
            back = readCell(cloneTables(api.exportTableAsJson()), `${table}/${row}/${col}`);
        (ok && back.state === 'ok' && cellText(back.value) === want
            ? note('场景目录已更新')
            : note('场景目录没写上，下次再试；没写进去的入口先不提示'),
            invalidate('clue-catalog'));
    }
    async function fillRows(p, c, t0) {
        let api = acuApi(),
            fb = (p.clue.bindings.facts || [])[0],
            kb = (p.clue.bindings.knowledge || [])[0];
        if (!api || typeof api.insertRow != 'function' || !fb) return;
        let labels = isPlainObject(p.clue.labels) ? p.clue.labels : {},
            plan = prebuildPlan(p.outline.volumes),
            started = new Map(c.state.lineStates.filter((s) => s.started).map((s) => [s.line.id, s])),
            target = appendTargetFloor(chatMessages(), isoKey()),
            factLines = /* @__PURE__ */ new Map(),
            triggers = new Set(plan.facts.filter((f) => f.trigger).map((f) => f.code));
        for (let n of c.compiled.nodes)
            for (let d of discoveryList(isPlainObject(n.item) ? n.item : {}))
                d.fact &&
                    factLines.set(d.fact, (factLines.get(d.fact) || /* @__PURE__ */ new Set()).add(n.unit.line ? n.unit.line.id : ''));
        let lineReady = (lid) => {
                if (!lid) return !0;
                let s = started.get(lid);
                return !!s && (s.manual.startAt === void 0 || s.manual.startAt < 0 || target >= s.manual.startAt);
            },
            // 跑团项目只补眼前要用的线索（core/trpg-rows.js）；普通项目 trpgSet 为 null，和原来一样
            trpgSet = isTrpg(p) ? trpgWantFacts(c.compiled, c.state, c.snap, c.prog, p.clue) : null,
            wantFact = (code) =>
                triggers.has(code) || !factLines.has(code) || ([...factLines.get(code)].some(lineReady) && (!trpgSet || trpgSet.has(code))),
            diff = prebuildDiff(
                { ...plan, facts: plan.facts.filter((f) => wantFact(f.code)), knows: plan.knows.filter((k) => wantFact(k.fact)) },
                c.snap,
                p.clue.bindings,
            ),
            labelOf = (code) => labels[code] || {},
            ready = diff.newFacts.filter((f) => labelOf(f.code).label),
            waiting = diff.newFacts.length - ready.length;
        if (
            (waiting &&
                !labelsWarned &&
                ((labelsWarned = !0), note(`有${waiting}条事实还没有标签，先不补行（采用模组时会自动生成；也可以用「补全表格」）`)),
            !ready.length && !diff.newKnows.length)
        )
            return;
        let factOk = new Set(c.snap.facts ? c.snap.facts.keys() : []),
            done = [];
        for (let f of ready) {
            if (!ticketValid(t0)) return;
            let l = labelOf(f.code),
                row = { [fb.编号列]: f.code, 标签: l.label, 登记口径: l.criterion || '' };
            (fb.状态列 && (row[fb.状态列] = '未获得'),
                (await Promise.resolve(api.insertRow({ tableName: fb.表, data: row, skipNotify: !0 })).catch(() => -1)) >= 0 &&
                    (factOk.add(f.code), done.push(f.code)));
        }
        if (kb)
            for (let k of diff.newKnows) {
                if (!factOk.has(k.fact) || !ticketValid(t0)) continue;
                let row = { 键: k.key, [kb.事实列]: k.fact, [kb.角色列]: k.actor };
                (kb.方式列 && (row[kb.方式列] = Array.isArray(kb.未知值) ? kb.未知值[0] : kb.未知值 || '未知'),
                    kb.可信度列 && (row[kb.可信度列] = '未核实'),
                    (await Promise.resolve(api.insertRow({ tableName: kb.表, data: row, skipNotify: !0 })).catch(() => -1)) >= 0 &&
                        done.push(k.key));
            }
        done.length &&
            (note(`自动补了${done.length}行：${done.slice(0, 6).join('、')}${done.length > 6 ? '……' : ''}`), invalidate('clue-rows'));
    }
    function lineAct(id, value, uid = '', s0 = null) {
        if (s0 && !scopeValid(s0)) throw new Error('已经切换了聊天、项目或推进方式，这次操作没有执行，请重新点一次');
        if (value === 'enter') return enterLine(id, '', uid);
        if (value === 'deny') {
            let c = compute(),
                s = c && c.state.lineStates.find((x) => x.line.id === id);
            return s && s.manual.evidence ? denyStart(id, s.manual.evidence) : act({ kind: 'line', target: id, value: '' });
        }
        if (value === 'resume') {
            let c = ((dirty = !0), compute()),
                p = project(),
                s = c && c.state.lineStates.find((x) => x.line.id === id);
            if (s && s.line.kind === 'side' && s.started && sideSlots(c.state.lineStates, p.clue.sideLimit || 1).full)
                throw new Error('同时进行的支线已经满了：先暂停正在进行的那条，再继续这条');
            // 继续一条主线：同时只能有一条主线进行中（GPT 审阅 R6）。占着位置的那条由界面先问过，这里一起暂停（一次操作）。
            // 自动开始的主线没有「开始」记录，暂停后只靠条件判断：继续时补一条开始记录，免得被别的暂停中的主线挡住又回到「可开启」。
            let other = s && s.line.kind === 'main' ? mainInProgress(c.state.lineStates, id) : null,
                mark = s && s.line.kind === 'main' && !s.manual.started ? [{ kind: 'line', target: id, value: 'start', text: 'manual', note: '继续' }] : [];
            if (s && s.line.kind === 'main' && c.prog.mainPaused) throw new Error('主线已全部暂停，先点「继续全部主线」');
            if (other || mark.length)
                return (
                    addOps([
                        ...(other ? [{ kind: 'line', target: other.line.id, value: 'pause', note: `换成${id}` }] : []),
                        { kind: 'line', target: id, value: 'resume' },
                        ...mark,
                    ]),
                    scheduleSync()
                );
        }
        (act({ kind: 'line', target: id, value: value || '' }), scheduleSync());
    }
    function toManual(id) {
        let p = project();
        return p
            ? lineToManual(p.outline.volumes, id) === p.outline.volumes
                ? !1
                : (data.updateProject(p.id, (cur) => ({
                      ...cur,
                      outline: { ...cur.outline, volumes: lineToManual(cur.outline.volumes, id) },
                  })),
                  invalidate('line-manual'),
                  !0)
            : !1;
    }
    function confirmTiers(tiers) {
        let p = project();
        return p
            ? confirmTierOrder(p.outline.volumes, tiers) === p.outline.volumes
                ? !1
                : (data.updateProject(p.id, (cur) => ({
                      ...cur,
                      outline: { ...cur.outline, volumes: confirmTierOrder(cur.outline.volumes, tiers) },
                  })),
                  invalidate('line-tiers'),
                  !0)
            : !1;
    }
    function moveLine(id, dir) {
        let p = project();
        if (!p) return;
        let vols = p.outline.volumes,
            idOf = (v) => (isPlainObject(v.line) ? String(v.line.编号 || '').trim() : ''),
            kindOf = (v) => (isPlainObject(v.line) ? (String(v.line.类型 || '').trim() === '主线' ? 'main' : 'side') : ''),
            at = vols.findIndex((v) => idOf(v) === id),
            kind = at < 0 ? '' : kindOf(vols[at]);
        if (!kind) return;
        let to = at + dir;
        for (; to >= 0 && to < vols.length && kindOf(vols[to]) !== kind;) to += dir;
        if (to < 0 || to >= vols.length) return;
        // 已经开始的主线（自动开始的没有「开始」记录，只靠顺序推出来）：先补一条开始记录，换了顺序也不会被锁回去（GPT 审阅 R6）
        let c = kind === 'main' ? compute() : null,
            mark = c ? c.state.lineStates.filter((x) => x.line.kind === 'main' && x.started && !x.manual.started).map((x) => ({ kind: 'line', target: x.line.id, value: 'start', text: 'manual', note: '调整顺序前已开始' })) : [];
        mark.length && addOps(mark);
        let next = vols.slice();
        (([next[at], next[to]] = [next[to], next[at]]),
            data.updateProject(p.id, (cur) => ({ ...cur, outline: { ...cur.outline, volumes: next } })),
            invalidate('line-order'));
    }
    function unofferedFacts(compiled, snap, prog) {
        let pr = getProgress(),
            offered = /* @__PURE__ */ new Set();
        for (let x of pr && Array.isArray(pr.clueCandidates) ? pr.clueCandidates : [])
            for (let c of x.candidates || []) offered.add(c.fact);
        for (let id of pr && Array.isArray(pr.clueOffered) ? pr.clueOffered : []) offered.add(id);
        for (let c of (pendingCandidates && pendingCandidates.candidates) || []) offered.add(c.fact);
        let tracked = /* @__PURE__ */ new Set();
        for (let n of compiled.nodes) for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) d.fact && tracked.add(d.fact);
        let out = [],
            overs = prog.factOverrides || {};
        for (let [id, over] of Object.entries(overs)) {
            if (!tracked.has(id) || !over || over.status !== 'revoked') continue;
            let f = snap.facts && snap.facts.get(id);
            out.push({ id, raw: f ? f.raw : '', text: over.text || (f && f.text) || '', revoked: !0 });
        }
        for (let [id, f] of snap.facts || [])
            !tracked.has(id) ||
                offered.has(id) ||
                overs[id] ||
                ((f.status === 'confirmed' || f.claimed) && out.push({ id, raw: f.raw, text: f.text || '', revoked: !1 }));
        return out;
    }
    function opScope() {
        return { ticket: ticket(), iso: isoKey() };
    }
    function scopeValid(s0) {
        return !!s0 && ticketValid(s0.ticket) && isoKey() === s0.iso;
    }
    async function voidFact(id, s0 = opScope()) {
        let p = project(),
            c = compute();
        if (!p || !c || !scopeValid(s0))
            return { done: !1, table: 'none', why: '已经切换了聊天、项目、推进方式或数据隔离，这次作废没有执行，请重新点一次' };
        let f = c.snap.facts && c.snap.facts.get(id);
        act({ kind: 'fact', target: id, value: 'revoked', text: f ? f.text : '', note: '玩家作废：正文可能自己编的' });
        let r = await voidTables(p, id, s0.ticket, s0.iso).catch((e) => ({ table: 'none', why: (e && e.message) || String(e) }));
        return (
            invalidate('clue-void'),
            note(r.table === 'ok' ? `作废${id}：表格已改回未获得` : `作废${id}：${r.why || '表格没改'}`),
            { done: !0, ...r }
        );
    }
    var SQL_WORD = /^[A-Za-z_\u0080-￿][A-Za-z0-9_$\u0080-￿]*$/;
    async function voidTables(p, id, t0, iso0) {
        let api = acuApi(),
            fb = (p.clue.bindings.facts || [])[0],
            kb = (p.clue.bindings.knowledge || [])[0];
        if (!api || !fb || !fb.状态列) return { table: 'none', why: '没有绑定事实表的状态列，表格没改' };
        if (typeof api.executeSqlMutation != 'function' || typeof api.querySql != 'function')
            return {
                table: 'none',
                why: '数据库不是SQLite存储模式（或还没就绪），插件没法安全改表；需要的话请到数据库里把这条改回「未获得」',
            };
        let unknown = Array.isArray(kb && kb.未知值) ? kb.未知值[0] : (kb && kb.未知值) || '未知',
            jobs = [
                {
                    what: '事实表',
                    sql: [fb.表, fb.状态列, fb.编号列],
                    text: `UPDATE ${fb.表} SET ${fb.状态列} = ? WHERE ${fb.编号列} = ?`,
                    params: ['未获得', id],
                },
            ];
        kb &&
            kb.方式列 &&
            kb.事实列 &&
            jobs.push({
                what: '知情表',
                sql: [kb.表, kb.方式列, kb.事实列, ...(kb.可信度列 ? [kb.可信度列] : [])],
                text: `UPDATE ${kb.表} SET ${kb.方式列} = ?${kb.可信度列 ? `, ${kb.可信度列} = ?` : ''} WHERE ${kb.事实列} = ?`,
                params: [unknown, ...(kb.可信度列 ? ['未核实'] : []), id],
            });
        let bad = jobs.flatMap((j) => j.sql).find((name) => !SQL_WORD.test(String(name || '')));
        if (bad !== void 0) return { table: 'none', why: `表名或列名「${bad}」带特殊字符，插件没法安全改表` };
        let failed = [],
            tried = 0;
        for (let j of jobs) {
            if (!ticketValid(t0) || isoKey() !== iso0)
                return {
                    table: tried ? 'partial' : 'none',
                    why: tried ? '改表途中切换了聊天、项目或数据隔离，没有全部完成' : '切换了聊天、项目或数据隔离，表格没改',
                };
            tried++;
            let res = await Promise.resolve(api.executeSqlMutation(j.text, j.params)).catch((e) => ({
                errors: [(e && e.message) || String(e)],
            }));
            res && Array.isArray(res.errors) && res.errors.length && failed.push(`${j.what}：${res.errors[0]}`);
        }
        if (!ticketValid(t0) || isoKey() !== iso0) return { table: 'partial', why: '改表途中切换了聊天、项目或数据隔离，没法确认表格结果' };
        let tables = cloneTables(api.exportTableAsJson()),
            fr = readFacts(tables, [fb]),
            kr = kb && kb.方式列 ? readKnowledge(tables, [kb]) : null,
            fact = fr.facts.get(id),
            knows = kr ? kr.rows.filter((row) => row.fact === id) : [],
            factOk = !fr.problems.length && (!fact || (fact.status === 'unconfirmed' && !fact.claimed)),
            knowOk = !kr || (!kr.problems.length && !knows.length);
        if (factOk && knowOk && !failed.length) return { table: 'ok', why: '' };
        let why = [
            failed.join('；'),
            fr.problems.length ? `事实表读不到：${fr.problems[0]}` : !factOk && '事实表这条还不是「未获得」',
            kr && kr.problems.length
                ? `知情表读不到：${kr.problems[0]}`
                : !knowOk && `知情表还有${knows.map((k) => k.actor).join('、')}记着知道`,
        ]
            .filter(Boolean)
            .join('；');
        return { table: (factOk && knowOk) || factOk || knowOk ? 'partial' : 'none', why: why || '没法确认表格结果' };
    }
    function restoreFact(id) {
        act({ kind: 'fact', target: id, value: '', note: '玩家解除作废：按表格判断' });
        let c = compute();
        return c ? effectiveFact(id, c.snap, c.prog) : null;
    }
    function invalidate(reason = '') {
        ((dirty = !0), reason && emit(reason));
    }
    function beginRound(source) {
        return ((round = { ticket: ticket(), at: Date.now(), source }), round);
    }
    function ensureRound(source) {
        return round && Date.now() - round.at <= ROUND_TTL_MS ? !1 : (beginRound(source), !0);
    }
    function roundState() {
        return round
            ? Date.now() - round.at > ROUND_TTL_MS
                ? ((round = null), { ok: !0 })
                : ticketValid(round.ticket)
                  ? { ok: !0 }
                  : { ok: !1, reason: '本轮开始后切换了聊天、项目或推进方式' }
            : { ok: !0 };
    }
    function endRound() {
        round = null;
    }
    function projection() {
        let c = compute();
        if (!c) return { content: '', reason: '不是线索模式' };
        if (!c.snap.api) return { content: '', reason: c.snap.problems[0] };
        if (c.prog.paused) return { content: '', reason: '主线已暂停（日常游玩）' };
        if (!c.snap.enabled) return { content: '', reason: '主线开关未开启' };
        let r = roundState();
        if (!r.ok) return { content: '', reason: r.reason };
        let prog = getProgress(),
            info = stayInfo(c),
            out = buildClueProjection(c.state, c.snap, c.prog, data.settings(), {
                pace: prog && prog.pace,
                stay: stayText(stayState(prog && prog.stays, chatMessages(), info), 'clue'),
                plan: c.plan,
                notReady: c.notReady,
                // 跑团模式：从聊天记录算出各检定的结果（core/trpg.js）；不是跑团项目不算
                checks: isTrpg(project()) ? trpgCheckResults(chatMessages()) : null,
            });
        // 跑团模式的 KP 推一把（core/trpg-kp.js）；普通线索项目不进这里
        isTrpg(project()) &&
            (out = kpInject(out, {
                state: c.state,
                snap: c.snap,
                prog: c.prog,
                checks: trpgCheckResults(chatMessages()),
                settings: data.settings(),
                push: prog && prog.trpgKp && prog.trpgKp.push,
                floors: aiFloors(),
                timeline: trpgTimeline(prog),
            }));
        return {
            ...out,
            reason: out.content ? '' : '当前没有可演的线索场景',
            lineOnly: !out.content && !!(out.used && out.used.recognize && out.used.recognize.length),
        };
    }
    // 跑团时间线：事件来自设定的「KP规则」，时间读绑定的表格；时钟记进 progress.trpgKp.clock（微任务里写，不在投影中同步写）
    function trpgTimeline(prog) {
        let p = project(),
            events = parseTimeline(p && p.setting && p.setting.text);
        if (!events.length) return null;
        let c = compute(),
            now = c ? readGameClock(c.snap.tables, p.clue.bindings.time && p.clue.bindings.time.路径) : null;
        return {
            events,
            now,
            clock: prog && prog.trpgKp && prog.trpgKp.clock,
            onClock: (next) =>
                Promise.resolve().then(() => {
                    let cur = getProgress() || {};
                    setProgress({ ...cur, trpgKp: { ...(cur.trpgKp || {}), clock: next } }, 'trpg-kp');
                }),
        };
    }
    function stayInfo(cc) {
        let c = cc || compute();
        if (!c) return null;
        let paused = !!c.prog.paused || c.snap.enabled === !1,
            p = project(),
            path = p && p.clue.bindings.scene && p.clue.bindings.scene.路径,
            cell = path ? readCell(c.snap.tables || {}, path) : null;
        return {
            key: paused ? '' : c.state.focus.uid || '',
            score: focusScore(c.state, c.snap, c.prog),
            paused,
            scene: cell && cell.state === 'ok' ? cellText(cell.value) : '',
        };
    }
    function record(via, out) {
        lastInjected = {
            at: Date.now(),
            via,
            chars: (out.content || '').length,
            focus: (out.used && out.used.focus) || '',
            facts: out.used ? out.used.facts.slice() : [],
            leads: out.used ? out.used.leads.slice() : [],
            reason: out.reason || '',
            content: out.content || '',
        };
        let lineOnly = !out.content && out.lineOnly;
        pendingCandidates =
            out.used &&
            (out.content || lineOnly) &&
            ((out.used.candidates || []).length || (out.used.scenes || []).length || (out.used.recognize && out.used.recognize.length))
                ? makePending(lineOnly ? { ...out.used, candidates: [], scenes: [] } : out.used)
                : null;
    }
    function discardPendingCandidates() {
        (pendingCandidates && note('生成已中止，这一次给正文的线索记录作废'), (pendingCandidates = null));
    }
    let pendingCandidates = null;
    function makePending(used) {
        return {
            at: Date.now(),
            focus: used.focus,
            candidates: (used.candidates || []).map((c) => ({ fact: c.fact, record: c.record || '' })),
            scenes: (used.scenes || []).map((s) => ({ uid: s.uid, entry: s.entry || '', place: s.place || '', focus: !!s.focus })),
            lines: used.recognize ? { recognize: used.recognize, offer: used.offer || '' } : null,
            ticket: round ? round.ticket : ticket(),
        };
    }
    function bindCandidatesToMessage(index) {
        let pc = pendingCandidates;
        if (((pendingCandidates = null), !pc || Date.now() - pc.at > ROUND_TTL_MS || !ticketValid(pc.ticket))) return;
        pc.lines && bindLineFloor(index, pc.lines);
        let msg = chatMessages()[index];
        if (!msg || msg.is_user) return;
        let prog = getProgress();
        if (!prog) return;
        let list = (Array.isArray(prog.clueCandidates) ? prog.clueCandidates : []).filter(
                (x) => !(x.i === index && x.swipe === (Number(msg.swipe_id) || 0)),
            ),
            offered = new Set(Array.isArray(prog.clueOffered) ? prog.clueOffered : []);
        for (let c of pc.candidates || []) offered.add(c.fact);
        (list.push({
            i: index,
            swipe: Number(msg.swipe_id) || 0,
            stamp: String(msg.send_date ?? ''),
            focus: pc.focus,
            candidates: pc.candidates,
            scenes: pc.scenes,
        }),
            setProgress({ ...prog, clueCandidates: list.slice(-CANDIDATE_KEEP), clueOffered: [...offered] }, 'clue-candidates'));
    }
    function auditFinalRequest(payload) {
        let c = compute();
        if (!c) return null;
        let p = project(),
            text = requestToText(payload);
        if (!text) return null;
        let fresh = lastInjected && Date.now() - lastInjected.at < ROUND_TTL_MS,
            out = fresh ? lastInjected.content : '',
            history = chatMessages()
                .filter((m) => m && !m.is_user && !m.is_system)
                .map((m) => String(m.mes || '')),
            isRevealed = (id) => effectiveFact(id, c.snap, c.prog).confirmed,
            injectedFocus = (fresh && out && lastInjected.focus) || '',
            auditState = { ...c.state, focus: { ...c.state.focus, uid: injectedFocus } },
            tablesText = Object.values((c.snap && c.snap.tables) || {})
                .map((sh) => (sh && Array.isArray(sh.content) ? sh.content.map((r) => (Array.isArray(r) ? r.join(' ') : '')).join(' ') : ''))
                .join(' '),
            result = auditRequest(text, p, auditState, out, { history, isRevealed, places: { setting: injectedSetting(p.setting), tables: tablesText } }),
            leaks = result.leaks.filter((l) => l.level === 'leak');
        return (
            (lastAudit = { ...result, at: Date.now(), via: lastInjected ? lastInjected.via : '' }),
            leaks.length &&
                (note(
                    `最终请求核验：发现 ${leaks.length} 处不该出现的剧情（${leaks
                        .slice(0, 3)
                        .map((l) => l.source)
                        .join('、')}${leaks.length > 3 ? '……' : ''}）`,
                ),
                toast('warning', `本轮请求里提前出现了还没开放的剧情（${leaks[0].source}）${leaks[0].where === 'setting' ? '，在这个项目的设定里' : leaks[0].where === 'table' ? '，在数据库表格里' : ''}。到诊断页看怎么处理。`)),
            result.duplicated &&
                (note(`最终请求核验：本轮线索内容出现了 ${result.projectionCount} 次（重复注入）`),
                toast('warning', '本轮线索内容在正文请求里出现了不止一次，请检查是否同时启用了别的注入路径。')),
            emit('clue-audit'),
            result
        );
    }
    function register() {
        let api = acuApi();
        api &&
            typeof api.registerTableUpdateCallback == 'function' &&
            !tableCallback &&
            ((tableCallback = () => {
                ((lastTableUpdate = Date.now()), invalidate('clue-table'), project() && scheduleSync());
            }),
            api.registerTableUpdateCallback(tableCallback),
            project() && scheduleSync());
    }
    function unregisterAll() {
        let api = acuApi();
        try {
            tableCallback && api && api.unregisterTableUpdateCallback && api.unregisterTableUpdateCallback(tableCallback);
        } catch {}
        tableCallback = null;
    }
    function act(op) {
        let p = project(),
            prog = getProgress();
        if (!p || !prog) throw new Error('当前项目不是线索模式');
        let ops = addClueOp(clueOps(), chatMessages(), op);
        (setProgress({ ...prog, clue: ops }, 'clue-op'), invalidate(), note(`人工操作：${opLabel(op)}`));
    }
    function opLabel(op) {
        if (op.kind === 'pause')
            return op.target === 'side'
                ? op.value ? '暂停全部支线' : '继续全部支线'
                : op.target === 'mains'
                  ? op.value ? '暂停全部主线' : '继续全部主线'
                  : op.value ? '暂停剧情' : '继续剧情';
        if (op.kind === 'line')
            return `${{ start: '开启', pause: '暂停', resume: '继续', done: '标记完成', abandon: '放弃', deny: '取消开启', skip: '跳过', '': '还原手动操作' }[String(op.value || '')] || op.value}线${op.target}${op.note ? `（${op.note}）` : ''}`;
        let names = {
                open: { force: '手动开放', block: '暂时停用', '': '开放改回按条件判断' },
                done: { force: '手动完成', undo: '算作没完成', '': '完成改回按表格判断' },
                skip: { true: '跳过', '': '取消跳过' },
                focus: { true: '设为本轮场景', '': '取消我选的场景' },
                fact: { confirmed: '确认线索', revoked: '作废线索', '': '线索改回按表格判断' },
            },
            label = (names[op.kind] && names[op.kind][String(op.value ?? '')]) || op.kind;
        return op.kind === 'focus' && op.value && op.target.startsWith(AWAY_PREFIX)
            ? `主角离开${op.target.slice(AWAY_PREFIX.length)}`
            : `${label} ${op.target}${op.note ? `（${op.note}）` : ''}`;
    }
    function sceneNow() {
        let p = project(),
            path = p && p.clue.bindings.scene && p.clue.bindings.scene.路径,
            c = compute();
        if (!path || !c) return '';
        let cell = readCell(c.snap.tables || {}, path);
        return cell.state === 'ok' ? cellText(cell.value) : '';
    }
    function leaveScene(uid) {
        uid && act({ kind: 'focus', target: `${AWAY_PREFIX}${uid}`, value: !0, sceneAt: sceneNow() });
    }
    function setPaused(paused, target = 'main') {
        (act({ kind: 'pause', target: target === 'side' ? 'side' : target === 'mains' ? 'mains' : 'main', value: paused ? !0 : '' }), scheduleSync());
    }
    function setFocus(uid) {
        let c = compute(),
            s = c && c.state.nodeStates.find((x) => x.node.uid === uid);
        if (uid && (!s || s.status === 'locked' || s.status === 'done' || s.disabled))
            throw new Error('这个节点当前不可进行；需要先满足开放条件，或用「人工开放」');
        act(
            uid
                ? { kind: 'focus', target: uid, value: !0, sceneAt: sceneNow() }
                : { kind: 'focus', target: (c && c.prog.focus) || '', value: '' },
        );
    }
    function plotConflicts() {
        let api = acuApi();
        try {
            let name = api && typeof api.getCurrentPlotPreset == 'function' ? api.getCurrentPlotPreset() : '';
            return !name || typeof api.getPlotPresetDetails != 'function'
                ? { preset: name || '', items: [] }
                : { preset: name, items: plotPresetConflicts(api.getPlotPresetDetails(name)) };
        } catch {
            return { preset: '', items: [] };
        }
    }
    function diagnose() {
        let c = compute(),
            api = acuApi();
        return {
            mode: project() ? 'clue' : 'outline',
            api: !!api,
            lastTableUpdate,
            tableAgeMs: lastTableUpdate ? Date.now() - lastTableUpdate : null,
            lastInjected,
            lastAudit,
            problems: c ? [...c.snap.problems, ...c.state.problems.filter((x) => !c.snap.problems.includes(x)), ...c.compiled.errors] : [],
            enabled: c ? c.snap.enabled : null,
            paused: c ? !!c.prog.paused : null,
            plot: plotConflicts(),
            focus: c ? c.state.focus : null,
            events: events.slice(),
        };
    }
    return {
        compute,
        invalidate,
        projection,
        act,
        opScope,
        voidFact,
        restoreFact,
        setFocus,
        setPaused,
        lineAct,
        opLabel,
        lineToManual: toManual,
        confirmTiers,
        moveLine,
        syncLines,
        scheduleSync,
        setLineBar: (fn) => {
            lineBar = fn;
        },
        hideLineBar: () => {
            ((lastToast = { key: '', at: 0 }), lineBar && lineBar(null));
        },
        stayInfo: () => stayInfo(),
        register,
        stop: unregisterAll,
        diagnose,
        auditFinalRequest,
        record,
        ensureRound,
        endRound,
        bindCandidatesToMessage,
        discardPendingCandidates,
        leaveScene,
        lastInjected: () => lastInjected,
        onChatChanged() {
            (hostWindow().clearTimeout(syncTimer),
                (catalogMissing = !1),
                (labelsWarned = !1),
                (lastToast = { key: '', at: 0 }),
                lineBar && lineBar(null),
                (lastStatus = null),
                (lastTableUpdate = 0),
                (pendingCandidates = null),
                (round = null),
                invalidate());
        },
    };
}
