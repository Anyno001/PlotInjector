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
} from '../core/clue-rules.js';
import {
    focusTakenOver,
    validStays,
    stayText,
    stayState,
    normalizeClueOps,
    effectiveClueProgress,
    diffClueStatus,
    addClueOp,
    anchorOf,
    sameAnchor,
    anchorValid,
} from '../core/clue-progress.js';
import { ENDED_STATES, FOLD_AUTO_RELEASED, FOLD_QUIET, foldPlan, foldRows, foldFill, normalizeFolds, foldStatus, foldView, foldBusyCodes, pauseRounds } from '../core/fold.js';
import { createFoldOps } from './clue-fold.js';
import { createPlotOps } from './clue-plot.js';
import { stripPlotScene } from '../core/plot-scene.js';
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
    seedRowsState,
    trackedFillFloor,
    aiFloorCount,
    isolatedTag,
    START_MIN_AI,
    START_TIMING,
    START_TRIES,
} from '../core/lines.js';

import {
    prebuildDiff,
    prebuildPlan,
    focusScore,
    discoveryList,
    buildClueProjection,
    clueText,
    rowScope,
    nodeFrontier,
    admitRegistrations,
    withHeld,
    startedLines,
    effectiveTables,
    seedable,
    condReads,
} from '../core/clue-project.js';

import {
    findSheet,
    sheetRows,
    findRow,
    cloneTables,
    readFacts,
    readKnowledge,
    readCell,
    withSeedGate,
    entityTables,
    SEED_HOLD,
    SEED_OFF,
    sameValue,
    cellText,
    plotPresetConflicts,
    knowKey,
} from '../core/clue-tables.js';

import { hostWindow, chatMessages, ctx, toast } from '../host/st.js';
import { isClueMode, withNodeIds } from '../core/clue-model.js';

import { isPlainObject, lineShowName } from '../core/outline.js';

import { requestToText, auditRequest } from '../core/clue-audit.js';

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
        fillStartCallback = null,
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
              note('已为缺少编号的节点和剧情线补充编号'),
              data.project(p.id) || p);
    }
    function snapshot(p) {
        let api = acuApi();
        if (!api || typeof api.exportTableAsJson != 'function')
            return {
                facts: /* @__PURE__ */ new Map(),
                knowledge: [],
                tables: {},
                problems: ['未检测到数据库插件（shujuku），所有线索按未知处理。请确认数据库插件已安装并开启'],
                api: !1,
            };
        // 模板初始行只在数据库仍会使用时才算数（新聊天沿用 D21）
        let tables = withSeedGate(cloneTables(api.exportTableAsJson()), seedRowsState(chatMessages(), isoKey())),
            f = readFacts(tables, p.clue.bindings.facts),
            k = readKnowledge(tables, p.clue.bindings.knowledge),
            problems = [...f.problems, ...k.problems],
            knowPresent = (p.clue.bindings.knowledge || []).length ? k.present : null;
        p.clue.bindings.facts.length || problems.push('未绑定事实表');
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
        // 读条件用的表：实表 + 已收起的行（方案 三.6），再按「全部建好时应有的行」补齐（固定参照，只由大纲决定）。
        // 写操作、缺行与补行判断仍用实表；条件只在 view 上算。
        let cond = snap,
            folds = normalizeFolds((getProgress() || {}).folds),
            foldSt =
                snap.api && compiled.lines.length && folds.length
                    ? foldStatus(folds, { tables: snap.tables, bindings: p.clue.bindings, chat: chatMessages(), iso: isoKey(), anchorOk: anchorValid })
                    : [];
        if (snap.api && compiled.lines.length) {
            let base = foldView(snap.tables, p.clue.bindings, foldSt, chatMessages(), anchorValid),
                view = effectiveTables(base, p.clue.bindings, prebuildPlan(p.outline.volumes), p.clue.labels);
            if (view !== snap.tables) {
                let r = condReads(base, view, p.clue.bindings);
                cond = { ...snap, tables: view, facts: r.facts, knowledge: r.knowledge };
            }
        }
        // 越序登记（线索建行与登记方案 二.3）：只查还没认可的新登记，前提不成立的这一轮不算（held），同步时写回未获得
        let acc = acceptedSet(),
            reg = snap.api && acc ? admitRegistrations(compiled, cond, prog, p.clue, acc) : null,
            held = reg ? reg.held : /* @__PURE__ */ new Set();
        held.size && (cond = withHeld(cond, held, p.clue.bindings));
        // 按节点建行（跑团项目走 src/trpg 自己的运行时，不经过这里）
        let state = computeClueState(compiled, cond, prog, p.clue),
            frontier = snap.api && compiled.lines.length ? nodeFrontier(compiled, state, cond, prog, p.clue) : null,
            scope = snap.api && compiled.lines.length ? rowScope(compiled, startedLines(state), frontier) : null;
        // 已收起、待核对、记录已存未删的线索不算漏行，也不自动补（方案 十.1）
        let busy = foldBusyCodes(foldSt);
        scope && busy.size && (scope = { facts: new Set([...scope.facts].filter((f) => !busy.has(f))), future: new Set([...scope.future, ...busy]) });
        snap.scope = scope;
        snap.frontier = frontier;
        snap.held = held;
        snap.admit = reg ? reg.admit : /* @__PURE__ */ new Set();
        snap.cond = cond;
        snap.fold = foldSt;
        snap.foldBusy = busy;
        // 缺行提示：多线项目不报插件不能预建的绑定（无状态列的事实表、无方式列的知情表），这些等填表模型登记；无线的老项目全报。
        let can = seedable(p.clue.bindings),
            seedF = can.facts,
            seedK = can.knows,
            seedPending = pendingSeedCodes(snap.tables, (p.clue.bindings.facts || [])[0]),
            factsBroken = snap.problems.some((s) => /^表「.*」缺少(编号|状态)列/.test(s));
        snap.seedPending = seedPending;
        snap.factsBroken = factsBroken;
        snap.api &&
            (p.clue.bindings.facts || []).length &&
            snap.problems.push(
                ...prebuiltGaps(compiled, snap, {
                    skip: new Set([...(scope ? scope.future : []), ...seedPending]),
                    checkFacts: !factsBroken && (!scope || seedF),
                    checkKnowledge: !factsBroken && (!scope || seedK),
                }),
            );
        let unoffered = snap.api ? unofferedFacts(compiled, snap, prog) : [],
            hints = snap.api ? tableConsistencyHints(snap, prog.factOverrides) : [],
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
            restoring = multi && snap.fold && snap.fold.length ? foldNeedRestore({ compiled, state, snap }, p) : new Set(),
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
                notReady: restoring.size ? new Set([...notReady, ...restoring]) : notReady,
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
        let plan = prebuildPlan(p.outline.volumes),
            keep = snap.scope ? snap.scope.facts : null,
            diff = prebuildDiff(
                keep ? { ...plan, facts: plan.facts.filter((f) => keep.has(f.code)), knows: plan.knows.filter((k) => keep.has(k.fact)) } : plan,
                snap,
                p.clue.bindings,
            ),
            // 只把插件会建的行作为准备门槛（不能预建的要等真实登记）。事实行建不了且表里没有时，知情行不挡第一次发现。
            can = seedable(p.clue.bindings),
            hasFact = (code) => can.facts || (snap.facts && snap.facts.has(code)),
            facts = can.facts ? diff.newFacts : [],
            knows = can.knows && snap.knowPresent ? diff.newKnows.filter((k) => hasFact(k.fact)) : [];
        return /* @__PURE__ */ new Set([...facts.map((f) => f.code), ...knows.map((k) => k.fact)]);
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
    // 线索表从当前楼层开始记。数据库对新加的表会从第 1 楼起逐批补填旧楼层，补完之前新剧情记不进表。
    // 官方能把「已记录」推到当前楼层的只有手动填表，它会先清空所选的表再从空表填，
    // 所以只在表里还没有要登记的内容时用：刚生成模板时；或开始那一楼被重新生成，记录和线索行一起没了时。
    // 进行期间不补行，免得刚补的行被清掉。
    // 正在发起的时间（0 = 没有）。超过 START_BUSY_MS 还没结束（数据库没回应、确认框被顶掉）就当作卡住，放开
    let startBusyAt = 0,
        recoverTimer = 0,
        lastFillStart = 0;
    function clueSheetKeys(p, tables) {
        let b = p.clue.bindings || {},
            names = [
                b.scene && b.scene.路径 ? String(b.scene.路径).split('/')[0].trim() : '',
                (b.facts || [])[0] && b.facts[0].表,
                (b.knowledge || [])[0] && b.knowledge[0].表,
            ];
        // 按 [线索控制表, 关键事实表, 知情表] 对位，没绑或找不到的是 ''
        return names.map((n) => {
            let f = n ? findSheet(tables || {}, n) : { error: 'x' };
            return !f.error && f.sheet && f.sheet.key ? f.sheet.key : '';
        });
    }
    const START_BUSY_MS = 6e5;
    const startBusy = () => !!startBusyAt && Date.now() - startBusyAt < START_BUSY_MS;
    function canStartFromNow() {
        let api = acuApi();
        return !!api && ['getManualSelectedTables', 'setManualSelectedTables', 'manualUpdate'].every((k) => typeof api[k] == 'function');
    }
    // 点了「确认」数据库一定先发「开始填表」（官方 handleManualUpdate_ACU 在确认后 notifyTableFillStart），点「取消」不会：
    // 取消 = 玩家不要，不再自动弹；确认了但没记上（数据库正忙、模型出错）= 等空闲再试，最多 START_TRIES 次。
    // 刚导入的表数据库可能还没载入（SQLite 模式实测：导入后 insertRow 报找不到表），选不中就先让它重新读取数据；
    // 还是不行返回 wait，等下次再来，不算一次失败。
    let waits = 0;
    // 数据库的「手动填表确认」框层级是 100000，有的美化主题会把聊天区盖在它上面：出现后提到最上层（只改显示层级）
    function raiseConfirm() {
        let w = hostWindow(),
            end = Date.now() + 1e4,
            tick = () => {
                let el = w.document && w.document.querySelector('[id$="-custom-confirm-overlay"]');
                el ? (el.style.zIndex = '2147483647', w.document.body.appendChild(el)) : Date.now() < end && w.setTimeout(tick, 100);
            };
        tick();
    }
    async function startFromNow() {
        let api = acuApi(),
            p = project();
        if (!p) return { ok: !1, why: '当前不是线索模式的项目' };
        if (startBusy()) return { ok: !1, why: '上一次还没结束（在等数据库或确认框）' };
        if (!canStartFromNow()) return { ok: !1, why: '数据库没有手动填表接口' };
        let picked = (keys) => {
                try {
                    api.setManualSelectedTables(keys);
                    let now = api.getManualSelectedTables();
                    return keys.every((k) => (now.selectedTables || []).includes(k));
                } catch {
                    return !1;
                }
            },
            ready = async (prev, again) => {
                invalidate();
                let c = compute(),
                    keys = c ? clueSheetKeys(p, c.snap.tables) : [];
                if (keys.length === 3 && keys.every(Boolean) && picked(keys)) return keys;
                if (again || typeof api.refreshDataAndWorldbook != 'function') return null;
                try {
                    await Promise.race([api.refreshDataAndWorldbook(), new Promise((r) => hostWindow().setTimeout(r, 15e3))]);
                } catch {}
                return ready(prev, !0);
            };
        let chat = chatMessages(),
            n = aiFloorCount(chat),
            t0 = ticket(),
            began = Date.now(),
            prev = null,
            keys = null;
        startBusyAt = Date.now();
        try {
            prev = api.getManualSelectedTables();
            keys = await ready(prev, !1);
            keys && (raiseConfirm(), await api.manualUpdate());
        } catch (e) {
            note(`从当前楼层开始记录出错：${e.message}`);
        } finally {
            try {
                prev && prev.hasManualSelection
                    ? api.setManualSelectedTables(prev.selectedTables || [])
                    : typeof api.clearManualSelectedTables == 'function' && api.clearManualSelectedTables();
            } catch {}
            startBusyAt = 0;
        }
        if (!ticketValid(t0)) return { ok: !1, why: '期间切换了聊天或项目' };
        if (!keys) return (note('线索表还没载入数据库，稍后再从当前楼层开始记录'), invalidate(), scheduleSync(), { ok: !1, wait: !0, why: '数据库还没认出三张线索表' });
        let at = trackedFillFloor(chatMessages(), keys[0], isoKey()),
            ok = at != null && at >= n,
            cancelled = !ok && lastFillStart < began,
            prog = getProgress(),
            cs = prog && isPlainObject(prog.clueStart) ? prog.clueStart : {},
            tries = ok ? 0 : (Number(cs.tries) || 0) + 1,
            off = !ok && (cancelled || tries >= START_TRIES);
        ((waits = 0),
            prog && setProgress({ ...prog, clueStart: { ai: Math.max(n, Number(cs.ai) || 0), tries, ...(off ? { off: !0 } : {}) } }, 'clue-start'),
            note(
                ok
                    ? `线索表从第${n}个AI楼层开始记录`
                    : cancelled
                      ? '线索表从当前楼层开始记录：已取消'
                      : `线索表没能从当前楼层开始记录（第${tries}次）${off ? '，不再重试' : '，数据库空闲后再试'}`,
            ),
            off && toast('warning', '线索表没能从当前楼层开始记录，数据库会先补填之前的楼层，补完之前新剧情记不进表。'),
            invalidate(),
            scheduleSync());
        return { ok, ...(ok ? {} : { why: cancelled ? '确认框被取消或没有出现（数据库没开始填表）' : '确认了，但填表没记上' }) };
    }
    // 生成模板后：记下要从哪一楼开始记，表已经载入就马上开始，没载入就交给下面的「等空闲再来」
    async function wantStart() {
        let prog = getProgress();
        if (!prog || !canStartFromNow()) return { ok: !1 };
        (setProgress({ ...prog, clueStart: { ai: aiFloorCount(chatMessages()), tries: 0 } }, 'clue-start'), (waits = 0));
        let r = await startFromNow();
        r.wait && scheduleRestart(project());
        return r;
    }
    // 还没从当前楼层记上：上次没成功，或开始那一楼被重新生成、删掉，记录退回到开始之前。
    // 数据库此时多半在补填旧楼层，等它空闲（一段时间内没有填表）再开始。
    function needRestart(p, c, chat) {
        let cs = (getProgress() || {}).clueStart;
        if (!isPlainObject(cs) || cs.off || startBusy()) return !1;
        let n = aiFloorCount(chat),
            key = clueSheetKeys(p, c.snap.tables).find(Boolean),
            at = key ? trackedFillFloor(chat, key, isoKey()) : 0;
        return at != null && n >= START_MIN_AI && at < Math.min(Number(cs.ai) || 0, n);
    }
    function scheduleRestart(p) {
        let w = hostWindow();
        (w.clearTimeout(recoverTimer),
            (recoverTimer = w.setTimeout(() => {
                let c = compute(),
                    chat = chatMessages(),
                    quiet = Date.now() - Math.max(lastTableUpdate, lastFillStart) >= START_TIMING.quiet;
                if (!c || (project() || {}).id !== p.id || !needRestart(project(), c, chat)) return;
                if (!quiet || fold.fillBusy()) return scheduleRestart(p);
                // 表还没载入：最多再等 START_TRIES 轮，之后等聊天里有新动静（填表、换聊天、刷新）再来
                startFromNow()
                    .then(
                        (r) =>
                            !r.ok &&
                            (project() || {}).id === p.id &&
                            (getProgress() || {}).clueStart &&
                            !getProgress().clueStart.off &&
                            (!r.wait || ++waits < START_TRIES) &&
                            scheduleRestart(p),
                    )
                    .catch((e) => note(`从当前楼层开始记录出错：${e.message}`));
            }, START_TIMING.delay)));
    }
    function sceneSheetKey(p, tables) {
        let path = p.clue.bindings.scene && p.clue.bindings.scene.路径,
            name = path ? String(path).split('/')[0].trim() : '',
            f = name ? findSheet(tables || {}, name) : { error: 'x' };
        return f.error ? '' : f.sheet.key;
    }
    async function syncLines() {
        if (syncing) return void (syncAgain = !0);
        if (startBusy()) return;
        let p = project();
        if (p) {
            syncing = !0;
            try {
                dirty = !0;
                let c = compute();
                if (!c || !c.snap.api) return;
                if (await checkRegistrations(p, c, ticket())) c = compute();
                if (!c) return;
                c.plan && p.clue.bindings.scene && plot.syncPreset().catch((e) => note(`推进预设出错：${e.message}`));
                let t0 = ticket(),
                    chat = chatMessages(),
                    changed = !1,
                    lastAi = -1;
                needRestart(p, c, chat) && scheduleRestart(p);
                if (!c.plan) return void (await writeCatalog(p, c, t0));
                for (let i = chat.length - 1; i >= 0; i--)
                    if (chat[i] && !chat[i].is_user) {
                        lastAi = i;
                        break;
                    }
                recordEnds(c, chat, lastAi);
                let rec = lastAi >= 0 ? lineFloors().find((x) => x.i === lastAi) : null,
                    path = p.clue.bindings.scene && p.clue.bindings.scene.路径,
                    cell = path ? readCell(c.snap.tables || {}, path) : null,
                    value = cell && cell.state === 'ok' ? cellText(cell.value) : '',
                    iso = isoKey(),
                    proof = lastAi >= 0 ? fillEvidence(chat[lastAi], sceneSheetKey(p, c.snap.tables), iso) : { ok: !1, reason: '' },
                    // 同一次填表里开始又结束的主线（状态已是「完成」）也要记开始，否则下一条主线开始后它会变回未开始
                    autoStart = c.state.lineStates.filter(
                        (s) =>
                            s.line.mode === 'auto' &&
                            s.started &&
                            !s.manual.started &&
                            !s.manual.state &&
                            ((s.state === '进行中' && s.why === '开启条件已满足') || (s.state === '完成' && s.why === '最后一个阶段已结束' && !s.line.legacyFact)),
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
                        (proof.ok || note(`当前场景是入口${value}，但${proof.reason}，暂不计为进入（可在执行页点「进入」）`),
                        ev && ls && !ls.started && !ls.manual.state)
                    ) {
                        let slots = sideSlots(c.state.lineStates, p.clue.sideLimit || 1),
                            busy = ls.line.kind === 'main' ? mainSlotTaken(c.state.lineStates, ls.line.id) : '';
                        if (busy) note(`未开始${ev.line}：${busy}`);
                        else if (ls.line.kind === 'main' && c.prog.mainPaused) note(`主线已全部暂停：未开始${ev.line}`);
                        else if (ls.line.kind === 'side' && c.prog.sidePaused) note(`支线已全部暂停：未开始${ev.line}`);
                        else if (ls.line.kind === 'side' && slots.full) {
                            let off = slots.used.length === 1 ? c.state.lineStates.find((x) => x.line.id === slots.used[0]) : null;
                            lineToast(`full:${ev.key}`, '支线已满', lineShowName(ls.line), '切换', () =>
                                switchSide(ev.line, ev.key, lastAi, '', ev.uid),
                            );
                        } else
                            (addOps([{ kind: 'line', target: ev.line, value: 'start', text: ev.key, note: '走进了入口', atIndex: lastAi }]),
                                (changed = !0),
                                note(`线${ev.line}开始：第${lastAi}楼走进了入口${ev.uid}`),
                                lineToast(`start:${ev.key}`, ls.line.kind === 'side' ? '支线开始' : '主线开始', lineShowName(ls.line), '取消', () =>
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
                        note(`支线${c.plan.due}已提示3次未进入，顺延`)),
                    !ticketValid(t0))
                )
                    return;
                changed && (dirty = !0);
                let now = compute();
                now && (await writeCatalog(p, now, t0), await fillRows(p, now, t0));
                // 已收起的行：线不再是已结束、或有没结束的线要读，恢复回表里
                ticketValid(t0) && (await fold.maintain(compute()).catch((e) => note(`恢复已收起的行出错：${e.message}`)));
                ticketValid(t0) && (await autoFoldWhenQuiet(p, t0).catch((e) => note(`收起出错：${e.message}`)));
            } finally {
                ((syncing = !1), syncAgain && ((syncAgain = !1), scheduleSync()));
            }
        }
    }
    // 线结束在哪一楼（方案 三.2）：算出来的结束挂在这次同步对应的最后一条 AI 楼（和自动开始同一规则，D51 R7）。
    // 线不再是结束状态时删掉；所在楼删除或重新生成后，下次同步重记。
    function recordEnds(c, chat, lastAi) {
        let prog = getProgress();
        if (!prog || lastAi < 0) return;
        let ends = isPlainObject(prog.lineEnds) ? prog.lineEnds : {},
            next = { ...ends },
            changed = !1;
        for (let s of c.state.lineStates || []) {
            let id = s.line.id,
                at = ends[id];
            if (!ENDED_STATES.includes(s.state)) {
                at && (delete next[id], (changed = !0));
                continue;
            }
            (at && anchorValid(at, chat)) || ((next[id] = anchorOf(chat, lastAi)), (changed = !0));
        }
        changed && setProgress({ ...prog, lineEnds: next }, 'line-end');
    }
    // 手动「标记完成」「放弃」的线，结束楼取这次操作所在的楼。
    function manualEndFloor(id, chat) {
        let ops = clueOps().ops.filter((op) => op.kind === 'line' && op.target === id && anchorValid(op.at, chat)),
            last = ops[ops.length - 1];
        return last && (last.value === 'done' || last.value === 'abandon') && last.at ? last.at.i : -1;
    }
    // 单条暂停满回合的线：Map(线编号 → 第 10 个有效回合所在楼)
    function pausedReady(c) {
        let ops = clueOps().ops,
            chat = chatMessages(),
            out = new Map();
        for (let s of c.state.lineStates || []) {
            if (s.state !== '暂停' || s.manual.state !== 'pause') continue;
            let r = pauseRounds(ops, chat, s.line);
            r.floor >= 0 && out.set(s.line.id, r.floor);
        }
        return out;
    }
    // 已收起、但现在不该收着的行（线不再结束 / 暂停未满、有没结束的线要读）：恢复回表之前，这些线索不给正文具体发现
    function foldNeedRestore(c, p) {
        let st = c.snap.fold || [];
        if (!st.length) return new Set();
        let live = new Set(foldPlan(c.compiled, c.state.lineStates, { keep: p.clue.noFold, paused: new Set(pausedReady(c).keys()) }).flatMap((x) => x.facts));
        return new Set(st.filter((x) => (x.st === 'folded' || x.st === 'lost') && (x.st === 'lost' || !live.has(x.row.code))).map((x) => x.row.code));
    }
    // 收起检查（方案 三）：哪些行能收、在等哪次填表。只计算，不写表。收起只给线索模式（跑团项目走 src/trpg，不经过这里）。
    function foldCheck() {
        let p = project();
        if (!p) return null;
        let c = compute(),
            api = acuApi();
        if (!c || !c.snap.api || !c.compiled.lines.length) return null;
        let chat = chatMessages(),
            iso = isoKey(),
            prog = getProgress() || {},
            ends = isPlainObject(prog.lineEnds) ? prog.lineEnds : {},
            can = seedable(p.clue.bindings),
            paused = pausedReady(c),
            plan = foldPlan(c.compiled, c.state.lineStates, { keep: p.clue.noFold, paused: new Set(paused.keys()) }),
            rows = foldRows(c.snap.tables, p.clue.bindings, plan.flatMap((x) => x.facts)),
            kb = (p.clue.bindings.knowledge || [])[0],
            keys = { facts: rows.factKey, knows: kb ? rows.knowKey : '' },
            sum = (map, codes) => codes.reduce((n, f) => n + (map[f] || 0), 0),
            lines = plan.map((x) => {
                let s = c.state.lineStates.find((y) => y.line.id === x.line.id),
                    manual = s && (s.manual.state === 'done' || s.manual.state === 'abandon'),
                    at = paused.has(x.line.id)
                        ? paused.get(x.line.id)
                        : manual
                          ? manualEndFloor(x.line.id, chat)
                          : ends[x.line.id] && anchorValid(ends[x.line.id], chat)
                            ? ends[x.line.id].i
                            : -1,
                    factRows = sum(rows.facts, x.facts),
                    knowRows = can.knows ? sum(rows.knows, x.facts) : 0;
                let mine = (c.snap.fold || []).filter((y) => y.rec.line === x.line.id);
                return {
                    id: x.line.id,
                    name: x.line.name,
                    state: x.state,
                    folded: mine.filter((y) => y.st === 'folded' || y.st === 'lost').length,
                    checking: mine.filter((y) => y.st === 'check').length,
                    endFloor: at,
                    facts: x.facts,
                    factRows,
                    knowRows,
                    rows: factRows + knowRows,
                    kept: x.kept,
                    fill: factRows + knowRows ? foldFill(chat, at, keys, iso) : { ok: !1, why: 'none' },
                };
            });
        return {
            lines,
            records: normalizeFolds(prog.folds).filter((r) => r.iso === iso),
            status: c.snap.fold || [],
            storage: api && typeof api.querySql == 'function' ? 'sqlite' : 'native',
            blocked: can.facts ? '' : '事实表未配置状态列和已核实值',
            problems: rows.problems,
        };
    }
    let plot = createPlotOps({ api: acuApi, note });
    let fold = createFoldOps({
        project,
        api: acuApi,
        getProgress,
        setProgress,
        isoKey,
        ticket,
        ticketValid,
        note,
        invalidate: (reason) => invalidate(reason),
        foldCheck: () => foldCheck(),
        needRestore: (c, p) => foldNeedRestore(c, p),
    });
    // 本聊天是否收起：'on' 开启，'off' 不收；没设过时用新版模板生成的聊天算开启，其余先问（执行页「已结束」里）
    function foldChat() {
        let prog = getProgress();
        return prog && (prog.foldChat === 'on' || prog.foldChat === 'off') ? prog.foldChat : '';
    }
    function setFoldChat(v) {
        let prog = getProgress();
        prog && setProgress({ ...prog, foldChat: v === 'on' || v === 'off' ? v : void 0 }, 'fold-chat');
    }
    function foldAutoOn(p) {
        let api = acuApi(),
            storage = api && typeof api.querySql == 'function' ? 'sqlite' : 'native';
        return !!api && !!FOLD_AUTO_RELEASED[storage] && p.clue.foldAuto !== !1 && foldChat() === 'on';
    }
    // 玩家手动恢复过的线（实测问题 16）：自动收起不再动它，要收从「⋯」手动收；线不再是已结束时清掉记号
    function foldKept() {
        let prog = getProgress();
        return new Set(prog && Array.isArray(prog.foldKept) ? prog.foldKept.filter((x) => typeof x == 'string') : []);
    }
    function setFoldKept(list) {
        let prog = getProgress();
        prog && setProgress({ ...prog, foldKept: list.length ? list : void 0 }, 'fold-kept');
    }
    // 玩家点的恢复（顶端提示、「⋯」、收起记录、关闭收起时全部恢复）：恢复成功的线记进 foldKept；同步时的自动恢复不走这里
    async function userRestore(pick) {
        let lines = [...new Set(normalizeFolds((getProgress() || {}).folds).filter((rec) => pick(rec)).map((rec) => rec.line))],
            r = await fold.restore(pick);
        r && r.ok && lines.length && setFoldKept([...new Set([...foldKept(), ...lines])]);
        return r;
    }
    async function userCollapse(ids, opts = {}) {
        let r = await fold.collapse(ids, opts),
            kept = foldKept();
        opts.manual && r && r.ok && ids.some((id) => kept.has(id)) && setFoldKept([...kept].filter((id) => !ids.includes(id)));
        return r;
    }
    // 表格安静、不在填表时才自动收起；否则等安静了再来（一个计时器，换聊天作废）
    let foldTimer = 0;
    async function autoFoldWhenQuiet(p, t0) {
        hostWindow().clearTimeout(foldTimer);
        let wait = lastTableUpdate ? FOLD_QUIET.ms - (Date.now() - lastTableUpdate) : 0;
        if (FOLD_QUIET.ms > 0 && (wait > 0 || fold.fillBusy()))
            return void (foldTimer = hostWindow().setTimeout(() => {
                let p2 = project();
                ticketValid(t0) && p2 && !syncing && autoFoldWhenQuiet(p2, t0).catch((e) => note(`收起出错：${e.message}`));
            }, Math.max(wait, Math.min(3e3, FOLD_QUIET.ms))));
        await autoFold(p);
    }
    // 填表后自动收起：结束楼之后有有效填表的线一起收，合并成一条顶端提示（方案 三.9）
    async function autoFold(p) {
        if (!foldAutoOn(p)) return;
        let f = foldCheck();
        if (!f || f.blocked) return;
        let kept = foldKept(),
            live = new Set(f.lines.map((x) => x.id));
        [...kept].some((id) => !live.has(id)) && setFoldKept([...kept].filter((id) => live.has(id)));
        let ready = f.lines.filter((x) => x.rows && x.fill.ok && !kept.has(x.id)).map((x) => x.id);
        if (!ready.length) return;
        let r = await fold.collapse(ready);
        if (!r.ok || !r.rows) return;
        let recs = new Set(r.recs);
        lineToast(
            `fold:${r.recs.join(',')}`,
            `${r.lines.length}条线，共${r.rows}行`,
            '已收起结束的剧情线',
            '恢复',
            () => userRestore((rec) => recs.has(rec.id)).then((x) => x && x.ok && toast(x.failed ? 'warning' : 'success', `已恢复${x.rows}行${x.failed ? `，${x.failed}行未恢复` : ''}。`)),
            { confirm: !1 },
        );
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
            return toast('info', '这条支线的状态已变化，未切换。');
        if (c.prog.sidePaused) return toast('info', '支线已全部暂停，未切换。请先点「继续全部支线」。');
        let off = pauseId || (used.length === 1 ? used[0] : '');
        if (used.length >= (p.clue.sideLimit || 1) && !used.includes(off))
            return toast('info', `已有${used.length}条支线进行中，请到执行页「剧情线」先暂停其中一条，再点这条的「进入」。`);
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
        let offName = ops.length > 1 && lineShowName((c.state.lineStates.find((x) => x.line.id === off) || { line: { name: off } }).line);
        (addOps(ops), scheduleSync(), offName && toast('success', `已切换到「${lineShowName(s.line)}」，「${offName}」已暂停。`));
    }
    function enterLine(id, pauseId = '', uid = '') {
        let c = ((dirty = !0), compute()),
            p = project();
        if (!c || !p) return;
        let s = c.state.lineStates.find((x) => x.line.id === id);
        if (!s || s.started) return;
        if (!s.eligible) throw new Error('这条线的开启条件尚未满足；需要提前开始时，可修改开启条件');
        let other = s.line.kind === 'main' ? mainInProgress(c.state.lineStates, id) : null;
        if (s.line.kind === 'main' && c.prog.mainPaused) throw new Error('主线已全部暂停，请先点「继续全部主线」');
        if (s.line.kind === 'side' && c.prog.sidePaused) throw new Error('支线已全部暂停，请先点「继续全部支线」');
        let entry = uid && s.entries.includes(uid) ? uid : s.entries.length === 1 ? s.entries[0] : '';
        if (s.line.kind === 'side' && sideSlots(c.state.lineStates, p.clue.sideLimit || 1).full)
            return switchSide(id, 'manual', void 0, pauseId, entry);
        (addOps([
            ...(other ? [{ kind: 'line', target: other.line.id, value: 'pause', note: `换成${id}` }] : []),
            { kind: 'line', target: id, value: 'start', text: 'manual', note: '手动进入' },
            ...(entry ? [{ kind: 'focus', target: entry, value: !0, sceneAt: sceneNow() }] : []),
        ]),
            scheduleSync());
    }
    // opts.confirm：false 时按钮点一次就执行（恢复这类随时能撤回的操作，实测问题 17）
    function lineToast(key, tag, text, action, run, opts = {}) {
        let p = project();
        if (!p || p.clue.lineToast === !1 || lastToast.key === key) return;
        let t0 = ticket(),
            guarded = () => (ticketValid(t0) && project() ? run() : toast('info', '已切换聊天或项目，这条提示已失效。'));
        ((lastToast = { key, at: Date.now() }), lineBar && lineBar({ key, tag, text, action, run: guarded, confirm: opts.confirm !== !1 }));
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
        if (ci < 0) return catalogMissing || ((catalogMissing = !0), note(`线索控制表缺少「${col}」列：请点「创建模板」补上`));
        if (hits.length !== 1 || cellText(hits[0][ci]) === want || !ticketValid(t0)) return;
        let index = found.sheet.content.indexOf(hits[0]);
        if (index < 1) return;
        let ok = await Promise.resolve(
                api.updateCell({ tableName: table, rowIndex: index, colIdentifier: col, value: want, skipNotify: !0 }),
            ).catch(() => !1),
            // 写后回读只认真实行
            back = readCell(entityTables(cloneTables(api.exportTableAsJson())), `${table}/${row}/${col}`);
        (ok && back.state === 'ok' && cellText(back.value) === want
            ? note('场景目录已更新')
            : note('场景目录写入失败，下次重试；未写入的入口暂不提示'),
            invalidate('clue-catalog'));
    }
    async function fillRows(p, c, t0) {
        let api = acuApi(),
            fb = (p.clue.bindings.facts || [])[0],
            kb = (p.clue.bindings.knowledge || [])[0];
        if (!api || typeof api.insertRow != 'function' || !fb || findSheet(c.snap.tables || {}, fb.表).error) return;
        // 只为能表达「未获得 / 未知」的绑定预建占位行：无状态列的老事实表插一行即「已核实」，无方式列的老知情表插一行即「知道」，这两种不预建。事实行、知情行各自判断。
        let can = seedable(p.clue.bindings),
            // 只有初始行、数据库可能还要用它们的表，先不补（补一行会让其余初始行不再生效）
            held = (name) => {
                let f = findSheet(c.snap.tables || {}, name);
                return !!(f.sheet && f.sheet[SEED_HOLD]);
            };
        can = { facts: can.facts && !held(fb.表), knows: can.knows && !!kb && !held(kb.表) };
        kb && !can.knows && (kb = null);
        if (!can.facts && !kb) return;
        let labels = isPlainObject(p.clue.labels) ? p.clue.labels : {},
            plan = prebuildPlan(p.outline.volumes),
            everStarted = startedLines(c.state) || new Set(),
            started = new Map(c.state.lineStates.filter((s) => everStarted.has(s.line.id)).map((s) => [s.line.id, s])),
            target = appendTargetFloor(chatMessages(), isoKey());
        // 线开始的那一楼还没轮到数据库能写的楼层时先不补（删楼回退时两边一起退）
        let lineReady = (lid) => {
                let s = started.get(lid);
                return !!s && (s.manual.startAt === void 0 || s.manual.startAt < 0 || target >= s.manual.startAt);
            },
            // 补哪些行：与模板、缺行提示同一范围规则——开线事件、孤立事实、已开始线自身产出的及其条件用到的外部事实
            want = rowScope(c.compiled, new Set([...started.keys()].filter(lineReady)), c.snap.frontier || null).facts,
            wantFact = (code) => want.has(code) && !(c.snap.foldBusy && c.snap.foldBusy.has(code)),
            diff = prebuildDiff(
                { ...plan, facts: plan.facts.filter((f) => wantFact(f.code)), knows: plan.knows.filter((k) => wantFact(k.fact)) },
                c.snap,
                p.clue.bindings,
            ),
            labelOf = (code) => labels[code] || {},
            // 建不了事实行（老事实表）：只补知情行，事实行等填表模型登记
            newFacts = can.facts ? diff.newFacts : [],
            ready = newFacts.filter((f) => labelOf(f.code).label),
            waiting = newFacts.length - ready.length;
        if (
            (waiting &&
                !labelsWarned &&
                ((labelsWarned = !0), note(`有${waiting}条事实尚无标签，暂不补行（采用大纲时自动生成，也可用「补全表格」）`)),
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
            (note(`自动补入${done.length}行：${done.slice(0, 6).join('、')}${done.length > 6 ? '……' : ''}`), invalidate('clue-rows'));
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
            // 继续主线：同时只能一条进行。界面先确认，这里一起暂停占位的那条。自动开始的主线没有「开始」记录，继续时补一条，避免被别的暂停主线挡回「可开启」。
            let other = s && s.line.kind === 'main' ? mainInProgress(c.state.lineStates, id) : null,
                mark = s && s.line.kind === 'main' && !s.manual.started ? [{ kind: 'line', target: id, value: 'start', text: 'manual', note: '继续' }] : [];
            if (s && s.line.kind === 'main' && c.prog.mainPaused) throw new Error('主线已全部暂停，请先点「继续全部主线」');
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
        // 已开始的主线（自动开始的无「开始」记录）：先补一条，换顺序后不会被锁回
        let c = kind === 'main' ? compute() : null,
            mark = c ? c.state.lineStates.filter((x) => x.line.kind === 'main' && x.started && !x.manual.started).map((x) => ({ kind: 'line', target: x.line.id, value: 'start', text: 'manual', note: '调整顺序前已开始' })) : [];
        mark.length && addOps(mark);
        let next = vols.slice();
        (([next[at], next[to]] = [next[to], next[at]]),
            data.updateProject(p.id, (cur) => ({ ...cur, outline: { ...cur.outline, volumes: next } })),
            invalidate('line-order'));
    }
    // ---------- 越序登记（线索建行与登记方案 二.3） ----------
    // 认可名单 progress.clueAccept：[{ f: 编号, at: 楼层锚点（null = 升级时的底账，一直有效） }]。还没有名单时不查。
    function acceptedSet() {
        let list = (getProgress() || {}).clueAccept;
        if (!Array.isArray(list)) return null;
        let chat = chatMessages();
        return new Set(list.filter((e) => e && anchorValid(e.at, chat)).map((e) => e.f));
    }
    const isReg = (f) => !!f && (f.status === 'confirmed' || f.claimed);
    // 填表后：建底账 / 记认可 / 退出已回到未获得的 / 撤回前提不成立的（SQLite 写回未获得，先备份原登记）。改了进度返回 true。
    async function checkRegistrations(p, c, t0) {
        if (fold.fillBusy()) return !1;
        let prog = getProgress() || {},
            chat = chatMessages(),
            view = c.snap.cond || c.snap,
            regs = new Set([...(view.facts || [])].filter(([, f]) => isReg(f)).map(([id]) => id)),
            busy = c.snap.foldBusy || /* @__PURE__ */ new Set();
        // 升级后第一次 / 新聊天：现有登记全部认可，不改表、不提示
        if (!Array.isArray(prog.clueAccept)) {
            setProgress({ ...prog, clueAccept: [...regs].concat([...c.snap.held]).map((f) => ({ f, at: null })) }, 'clue-accept');
            return (invalidate('clue-accept'), !0);
        }
        let lastAi = -1;
        for (let i = chat.length - 1; i >= 0; i--)
            if (chat[i] && !chat[i].is_user) {
                lastAi = i;
                break;
            }
        let at = anchorOf(chat, lastAi),
            list = prog.clueAccept.filter((e) => e && anchorValid(e.at, chat) && (regs.has(e.f) || busy.has(e.f) || c.snap.held.has(e.f))),
            have = new Set(list.map((e) => e.f));
        for (let id of c.snap.admit) have.has(id) || (list.push({ f: id, at }), have.add(id));
        let wd = new Map(
                (prog.clueWithdrawn || []).filter((w) => w && anchorValid(w.at, chat) && !have.has(w.f)).map((w) => [w.f, w]),
            ),
            api = acuApi(),
            sql = !!api && typeof api.executeSqlMutation == 'function' && typeof api.querySql == 'function',
            notes = [];
        for (let id of c.snap.held) {
            let old = wd.get(id);
            if (old && sameAnchor(old.at, at)) continue;
            let f = c.snap.facts && c.snap.facts.get(id),
                lab = (p.clue.labels || {})[id] || {},
                entry = {
                    f: id,
                    at,
                    label: lab.label || '',
                    text: (f && f.text) || '',
                    raw: (f && f.raw) || '',
                    knows: (c.snap.knowledge || []).filter((k) => k.fact === id).map((k) => ({ actor: k.actor, way: k.way, cred: k.credibility })),
                    table: 'none',
                };
            if (sql) {
                let r = await voidTables(p, id, t0, isoKey()).catch((e) => ({ table: 'none', why: (e && e.message) || String(e) }));
                if (!ticketValid(t0)) return !1;
                entry.table = r.table;
            }
            (wd.set(id, entry), notes.push(`${id}${entry.table === 'ok' ? '（表格已改回未获得）' : sql ? '（表格没改成）' : '（只在插件里不算）'}`));
        }
        let next = { ...prog, clueAccept: list, clueWithdrawn: [...wd.values()] };
        if (JSON.stringify(prog.clueAccept) === JSON.stringify(next.clueAccept) && JSON.stringify(prog.clueWithdrawn || []) === JSON.stringify(next.clueWithdrawn))
            return !1;
        notes.length && note(`前提还没成立的登记先撤回：${notes.join('、')}`);
        setProgress(next, 'clue-accept');
        return (invalidate('clue-accept'), !0);
    }
    // 「提前登记已撤回」的处理：keep 按备份恢复原登记并认可；不保留只是移出待处理
    async function settleWithdrawn(id, keep, s0 = opScope()) {
        let p = project(),
            w = ((getProgress() || {}).clueWithdrawn || []).find((x) => x && x.f === id);
        if (!p || !w || !scopeValid(s0)) return { done: !1, why: '已经切换了聊天、项目或数据隔离，请重新点一次' };
        // 撤回时改过表（全部或一部分）就按备份恢复，读回核对后才算保留；没改成的表本来就还是原登记
        if (keep && w.table !== 'none') {
            if (fold.fillBusy()) return { done: !1, why: '数据库正在填表，请稍后再试' };
            let r = await restoreRegistration(p, w, s0);
            if (!r.ok) return { done: !1, why: r.why };
            invalidate('clue-restore');
            let c = compute(),
                fact = c && c.snap.facts && c.snap.facts.get(id),
                know = (actor) => ((c && c.snap.knowledge) || []).find((k) => k.fact === id && k.actor === actor),
                ok = !!fact && fact.raw === w.raw && (w.knows || []).every((k) => know(k.actor) && know(k.actor).way === k.way);
            if (!ok) return { done: !1, why: '读回表格时还不是原来的登记' };
        }
        let chat = chatMessages(),
            lastAi = chat.map((m) => !!m && !m.is_user).lastIndexOf(!0),
            cur = getProgress() || {};
        setProgress(
            {
                ...cur,
                clueWithdrawn: (cur.clueWithdrawn || []).filter((x) => x && x.f !== id),
                clueAccept: keep ? [...(cur.clueAccept || []).filter((x) => x && x.f !== id), { f: id, at: anchorOf(chat, lastAi) }] : cur.clueAccept,
            },
            'clue-accept',
        );
        keep && keepManual([id], '保留提前登记');
        return (invalidate('clue-withdrawn'), note(keep ? `保留提前登记 ${id}` : `不保留提前登记 ${id}`), { done: !0 });
    }
    // 按撤回时的备份写回原登记：事实状态，以及这条事实各角色的获知方式和可信度
    async function restoreRegistration(p, w, s0) {
        let api = acuApi(),
            fb = (p.clue.bindings.facts || [])[0],
            kb = (p.clue.bindings.knowledge || [])[0];
        if (!api || typeof api.executeSqlMutation != 'function' || !fb || !fb.状态列) return { ok: !1, why: '数据库不是 SQLite 存储模式，没法改表' };
        let jobs = [{ sql: [fb.表, fb.状态列, fb.编号列], text: `UPDATE ${fb.表} SET ${fb.状态列} = ? WHERE ${fb.编号列} = ?`, params: [w.raw, w.f] }];
        if (kb && kb.方式列 && kb.事实列 && kb.角色列)
            for (let k of w.knows || [])
                jobs.push({
                    sql: [kb.表, kb.方式列, kb.事实列, kb.角色列, ...(kb.可信度列 ? [kb.可信度列] : [])],
                    text: `UPDATE ${kb.表} SET ${kb.方式列} = ?${kb.可信度列 ? `, ${kb.可信度列} = ?` : ''} WHERE ${kb.事实列} = ? AND ${kb.角色列} = ?`,
                    params: [k.way, ...(kb.可信度列 ? [k.cred] : []), w.f, k.actor],
                });
        if (jobs.flatMap((j) => j.sql).some((n) => !SQL_WORD.test(String(n || '')))) return { ok: !1, why: '表名或列名带特殊字符，插件没法安全改表' };
        for (let j of jobs) {
            if (!scopeValid(s0)) return { ok: !1, why: '改表途中切换了聊天、项目或数据隔离' };
            let res = await Promise.resolve(api.executeSqlMutation({ sql: j.text, params: j.params, skipNotify: !0 })).catch((e) => ({
                errors: [(e && e.message) || String(e)],
            }));
            if (res && Array.isArray(res.errors) && res.errors.length) return { ok: !1, why: res.errors[0] };
        }
        return { ok: !0 };
    }
    function withdrawnList() {
        let chat = chatMessages();
        return ((getProgress() || {}).clueWithdrawn || []).filter((w) => w && anchorValid(w.at, chat));
    }
    // ---------- 手动纠错同步改表（线索建行与登记方案 二.4） ----------
    // SQLite 才改表；原生存储只改插件判断（和以前一样）。
    function sqlOk() {
        let api = acuApi();
        return !!api && typeof api.executeSqlMutation == 'function' && typeof api.querySql == 'function';
    }
    // 选的是不是「存疑」（事实表绑定的说法值）
    function isClaim(p, status) {
        let fb = (p.clue.bindings.facts || [])[0] || {},
            claims = (Array.isArray(fb.说法值) ? fb.说法值 : [fb.说法值 || '存疑']).map(cellText);
        return claims.includes(cellText(status));
    }
    // 条件里对某条线索的知情 / 核实门槛：[{ fact, actor, verified }]
    function knowGates(compiled, codes) {
        let out = [],
            seen = /* @__PURE__ */ new Set(),
            walk = (c) => {
                if (!c) return;
                if (c.kind === 'group') return c.items.forEach(walk);
                if (c.kind !== 'know' || !codes.has(c.fact)) return;
                let k = `${c.fact}@${c.actor}@${c.verified ? 1 : 0}`;
                seen.has(k) || (seen.add(k), out.push({ fact: c.fact, actor: c.actor, verified: !!c.verified }));
            };
        for (let u of compiled.units) u.clue && (walk(u.clue.enter), walk(u.clue.end));
        for (let l of compiled.lines || []) walk(l.open);
        for (let n of compiled.nodes) [n.open, n.early, n.done].forEach(walk);
        return out;
    }
    // 「手动标记完成」要补记的：这个节点的发现里表里还没登记的线索，以及后面条件要求、表里还没满足的知情 / 核实
    function nodeFillIn(uid) {
        let c = compute(),
            s = c && c.state.nodeStates.find((x) => x.node.uid === uid);
        if (!s) return null;
        let view = c.snap.cond || c.snap,
            labels = (project().clue.labels || {}),
            facts = discoveryList(isPlainObject(s.node.item) ? s.node.item : {})
                .filter((d) => d.fact)
                .map((d) => ({ f: d.fact, label: (labels[d.fact] && labels[d.fact].label) || '', have: isReg(view.facts && view.facts.get(d.fact)), claim: /存疑|证词|说法|传闻/.test(d.record || '') })),
            missing = facts.filter((x) => !x.have),
            known = (fact, actor, verified) =>
                (view.knowledge || []).some((k) => k.fact === fact && knowKey(fact, k.actor) === knowKey(fact, actor) && (!verified || k.verified)),
            gates = knowGates(c.compiled, new Set(facts.map((x) => x.f))).filter((g) => !known(g.fact, g.actor, g.verified));
        return { node: s.node, missing, gates, sql: sqlOk() };
    }
    // 写一条线索（和它的知情行）：有行就改，没有行就补一行。返回 { ok, why }
    async function writeFact(p, item, s0) {
        let api = acuApi(),
            fb = (p.clue.bindings.facts || [])[0],
            kb = (p.clue.bindings.knowledge || [])[0],
            labels = p.clue.labels || {},
            say = '手动补记',
            run = async (text, params, names) => {
                if (names.some((n) => !SQL_WORD.test(String(n || '')))) return { errors: ['表名或列名带特殊字符，插件没法安全改表'] };
                if (!scopeValid(s0)) return { errors: ['改表途中切换了聊天、项目或数据隔离'] };
                return Promise.resolve(api.executeSqlMutation({ sql: text, params, skipNotify: !0 })).catch((e) => ({ errors: [(e && e.message) || String(e)] }));
            },
            bad = (r) => r && Array.isArray(r.errors) && r.errors.length,
            src = fb.来源列 ? `, ${fb.来源列} = ?` : '',
            r = await run(`UPDATE ${fb.表} SET ${fb.状态列} = ?${src} WHERE ${fb.编号列} = ?`, [item.status, ...(fb.来源列 ? [say] : []), item.f], [fb.表, fb.状态列, fb.编号列, ...(fb.来源列 ? [fb.来源列] : [])]);
        if (bad(r)) return { ok: !1, why: r.errors[0] };
        if (!r || !r.changes) {
            let lab = labels[item.f] || {},
                row = { [fb.编号列]: item.f, 标签: lab.label || '', 登记口径: lab.criterion || '', [fb.状态列]: item.status, ...(fb.来源列 ? { [fb.来源列]: say } : {}) };
            if ((await Promise.resolve(api.insertRow({ tableName: fb.表, data: row, skipNotify: !0 })).catch(() => -1)) < 0) return { ok: !1, why: `关键事实表里没有 ${item.f} 这一行，也补不进去` };
        }
        let had = (compute().snap.knowledge || []).filter((k) => k.fact === item.f);
        for (let k of item.knows || []) {
            if (!kb || !kb.方式列) break;
            // 已有的获知方式保留，只补可信度；第一次补记写「被告知」，不从「已核实」推出「亲见」（GPT 发布前审阅 R8）
            let old = had.find((x) => knowKey(item.f, x.actor) === knowKey(item.f, k.actor)),
                way = (old && old.way) || '被告知',
                cred = k.verified ? (Array.isArray(kb.已核实值) ? kb.已核实值[0] : kb.已核实值 || '已核实') : '未核实',
                set = `${kb.方式列} = ?${kb.可信度列 ? `, ${kb.可信度列} = ?` : ''}`,
                q = await run(`UPDATE ${kb.表} SET ${set} WHERE ${kb.事实列} = ? AND ${kb.角色列} = ?`, [way, ...(kb.可信度列 ? [cred] : []), item.f, k.actor], [kb.表, kb.方式列, kb.事实列, kb.角色列, ...(kb.可信度列 ? [kb.可信度列] : [])]);
            if (bad(q)) return { ok: !1, why: q.errors[0] };
            if (!q || !q.changes) {
                let row = { 键: `${item.f}@${k.actor}`, [kb.事实列]: item.f, [kb.角色列]: k.actor, [kb.方式列]: way, ...(kb.可信度列 ? { [kb.可信度列]: cred } : {}) };
                if ((await Promise.resolve(api.insertRow({ tableName: kb.表, data: row, skipNotify: !0 })).catch(() => -1)) < 0) return { ok: !1, why: `知情表里补不进 ${item.f}@${k.actor}` };
            }
        }
        return { ok: !0 };
    }
    // 记进认可名单（手动写的登记不再被越序检查撤回）
    function acceptNow(codes) {
        let chat = chatMessages(),
            lastAi = chat.map((m) => !!m && !m.is_user).lastIndexOf(!0),
            cur = getProgress() || {},
            list = (cur.clueAccept || []).filter((x) => x && !codes.includes(x.f));
        setProgress({ ...cur, clueAccept: [...list, ...codes.map((f) => ({ f, at: anchorOf(chat, lastAi) }))], clueWithdrawn: (cur.clueWithdrawn || []).filter((x) => x && !codes.includes(x.f)) }, 'clue-accept');
    }
    // 玩家明确认可的登记记成「保留线索」（照表格判断）；标为未完成时 clearNodeDone 会解除
    function keepManual(codes, why) {
        for (let f of codes) act({ kind: 'fact', target: f, value: 'kept', note: why });
    }
    // 手动标记完成：picks [{ f, status: 已核实值 / 说法值 / ''（没拿到） }]，knows [{ fact, actor, verified }]
    async function markNodeDone(uid, picks, knows, reason = '', s0 = opScope()) {
        let p = project();
        if (!p || !scopeValid(s0)) return { done: !1, why: '已经切换了聊天、项目或数据隔离，请重新点一次' };
        let chosen = picks.filter((x) => x.status);
        if (!sqlOk()) {
            for (let x of chosen) act({ kind: 'fact', target: x.f, value: isClaim(p, x.status) ? 'claimed' : 'confirmed', note: '手动标记完成时补记（不改表格）' });
            act({ kind: 'done', target: uid, value: 'force', note: reason });
            return { done: !0, table: 'none' };
        }
        if (fold.fillBusy()) return { done: !1, why: '数据库正在填表，请稍后再试' };
        let byFact = new Map(chosen.map((x) => [x.f, { ...x, knows: [] }]));
        for (let k of knows) (byFact.get(k.fact) || byFact.set(k.fact, { f: k.fact, status: '', knows: [] }).get(k.fact)).knows.push(k);
        for (let item of byFact.values()) {
            let fb = (p.clue.bindings.facts || [])[0];
            item.status = item.status || ((compute().snap.facts || new Map()).get(item.f) || {}).raw || (fb && fb.已核实值) || '已核实';
            let r = await writeFact(p, item, s0);
            if (!r.ok) return { done: !1, why: r.why };
        }
        chosen.length && acceptNow(chosen.map((x) => x.f));
        // 写进表格后记一条「保留线索」：仍按表格判断（存疑不会变成已核实），不再当成正文自行编造来问；原因进操作记录
        keepManual(chosen.map((x) => x.f), reason ? `手动补记：${reason}` : '手动补记，已写进表格');
        invalidate('clue-manual');
        let s = compute().state.nodeStates.find((x) => x.node.uid === uid);
        // 完成条件不只看这些线索（或填表之后又被改）：照旧记一条人工完成
        (s && s.status === 'done') || act({ kind: 'done', target: uid, value: 'force', note: reason });
        return { done: !0, table: 'ok' };
    }
    // 标为未完成（一次性）：这个节点自己的登记写回未获得（别的已完成节点也产出的不动），恢复自动判断
    async function clearNodeDone(uid, s0 = opScope()) {
        let p = project(),
            c = compute();
        if (!p || !c || !scopeValid(s0)) return { done: !1, why: '已经切换了聊天、项目或数据隔离，请重新点一次' };
        if (!sqlOk()) return { done: !1, native: !0, why: '数据库不是 SQLite 存储模式，插件没法改表' };
        if (fold.fillBusy()) return { done: !1, why: '数据库正在填表，请稍后再试' };
        let s = c.state.nodeStates.find((x) => x.node.uid === uid);
        if (!s) return { done: !1, why: '找不到这个节点' };
        let other = /* @__PURE__ */ new Set();
        for (let x of c.state.nodeStates)
            x !== s && x.status === 'done' && discoveryList(isPlainObject(x.node.item) ? x.node.item : {}).forEach((d) => d.fact && other.add(d.fact));
        let view = c.snap.cond || c.snap,
            overs = c.prog.factOverrides || {},
            mine = discoveryList(isPlainObject(s.node.item) ? s.node.item : {})
                .map((d) => d.fact)
                .filter((f) => f && !other.has(f)),
            codes = mine.filter((f) => isReg(view.facts && view.facts.get(f))),
            folded = (id) => (c.snap.fold || []).some((x) => x.row.code === id && (x.st === 'folded' || x.st === 'lost'));
        for (let id of codes) {
            let r = await voidTables(p, id, s0.ticket, s0.iso).catch((e) => ({ table: 'none', why: (e && e.message) || String(e) }));
            if (r.table !== 'ok') return { done: !1, why: r.why || '表格没改成' };
            if (folded(id) && !(await fold.markCleared(id))) return { done: !1, why: `已收起的 ${id} 清除记录没能存盘` };
        }
        for (let id of mine) overs[id] && ['confirmed', 'claimed', 'kept'].includes(overs[id].status) && act({ kind: 'fact', target: id, value: '', note: '标为未完成：解除人工确认' });
        let cur = getProgress() || {};
        setProgress({ ...cur, clueAccept: (cur.clueAccept || []).filter((x) => x && !codes.includes(x.f)) }, 'clue-accept');
        (c.prog.overrides[uid] || {}).done && act({ kind: 'done', target: uid, value: '', note: '标为未完成' });
        invalidate('clue-manual');
        let after = compute().state.nodeStates.find((x) => x.node.uid === uid);
        return { done: !0, cleared: codes, stillDone: !!after && after.status === 'done', why: after ? after.done.reasons.join('；') : '' };
    }
    // 线索菜单「手动确认已获得」：status 为已核实值或说法值
    async function confirmFact(id, status, s0 = opScope()) {
        let p = project();
        if (!p || !scopeValid(s0)) return { done: !1, why: '已经切换了聊天、项目或数据隔离，请重新点一次' };
        if (!sqlOk()) return (act({ kind: 'fact', target: id, value: isClaim(p, status) ? 'claimed' : 'confirmed', note: '手动确认（不改表格）' }), { done: !0, table: 'none' });
        if (fold.fillBusy()) return { done: !1, why: '数据库正在填表，请稍后再试' };
        let r = await writeFact(p, { f: id, status, knows: [] }, s0);
        if (!r.ok) return { done: !1, why: r.why };
        // 以前的人工确认 / 作废换成「保留线索」：表格就是依据，也不再问是否自行编造
        return (acceptNow([id]), keepManual([id], '手动确认，已写进表格'), invalidate('clue-manual'), { done: !0, table: 'ok' });
    }
    // 只有开场白时，模板初始行要等数据库第一次填表才成为正式行（seedRowsState 为 pending）：这些编号不算缺行（实测问题 9）
    function pendingSeedCodes(tables, fb) {
        let out = /* @__PURE__ */ new Set(),
            f = fb && tables ? findSheet(tables, fb.表) : null;
        if (!f || !f.sheet || f.sheet[SEED_OFF] !== 'pending' || !Array.isArray(f.sheet.seedRows)) return out;
        let ic = sheetRows({ ...f.sheet, [SEED_OFF]: void 0 }).col(fb.编号列 || '');
        if (ic >= 0) for (let r of f.sheet.seedRows) Array.isArray(r) && cellText(r[ic]) && out.add(cellText(r[ic]));
        return out;
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
        let away = new Set([...(snap.held || []), ...withdrawnList().map((w) => w.f)]);
        for (let [id, f] of snap.facts || [])
            away.has(id) ||
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
        if (fold.fillBusy()) return { done: !1, table: 'none', why: '数据库正在填表，请稍后再试' };
        let f = c.snap.facts && c.snap.facts.get(id);
        act({ kind: 'fact', target: id, value: 'revoked', text: f ? f.text : '', note: '作废：正文可能自行编造' });
        let r = await voidTables(p, id, s0.ticket, s0.iso).catch((e) => ({ table: 'none', why: (e && e.message) || String(e) })),
            api0 = acuApi(),
            folded = (c.snap.fold || []).some((x) => x.row.code === id && (x.st === 'folded' || x.st === 'lost'));
        // 已收起的线索：SQLite 记下清除，读视图和恢复按清除后的值；原生只记手动撤销（方案 十.6）
        if (folded && api0 && typeof api0.querySql == 'function')
            r = (await fold.markCleared(id))
                ? { ...r, table: 'ok', why: '' }
                : { ...r, table: 'none', why: '已收起的这条线索，清除记录没能确认存盘；插件按未获得处理，恢复时可能仍是原值' };
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
            let res = await Promise.resolve(api.executeSqlMutation({ sql: j.text, params: j.params, skipNotify: !0 })).catch((e) => ({
                errors: [(e && e.message) || String(e)],
            }));
            res && Array.isArray(res.errors) && res.errors.length && failed.push(`${j.what}：${res.errors[0]}`);
        }
        if (!ticketValid(t0) || isoKey() !== iso0) return { table: 'partial', why: '改表途中切换了聊天、项目或数据隔离，没法确认表格结果' };
        let tables = entityTables(cloneTables(api.exportTableAsJson())),
            fr = readFacts(tables, [fb]),
            kr = kb && kb.方式列 ? readKnowledge(tables, [kb]) : null,
            fact = fr.facts.get(id),
            knows = kr ? kr.rows.filter((row) => row.fact === id) : [],
            factOk = !fr.problems.length && (!fact || (fact.status === 'unconfirmed' && !fact.claimed)),
            knowOk = !kr || (!kr.problems.length && !knows.length);
        if (factOk && knowOk && !failed.length) return { table: 'ok', why: '' };
        let why = [
            failed.join('；'),
            fr.problems.length ? `事实表无法读取：${fr.problems[0]}` : !factOk && '事实表中这条线索不是「未获得」',
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
        return c ? effectiveFact(id, c.snap.cond || c.snap, c.prog) : null;
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
        if (c.prog.paused) return { content: '', reason: '剧情已暂停' };
        if (!c.snap.enabled) return { content: '', reason: '主线开关未开启' };
        let r = roundState();
        if (!r.ok) return { content: '', reason: r.reason };
        let prog = getProgress(),
            info = stayInfo(c),
            { state, arrive } = arriveState(c),
            out = buildClueProjection(state, c.snap.cond || c.snap, c.prog, data.settings(), {
                pace: prog && prog.pace,
                stay: stayText(stayState(prog && prog.stays, chatMessages(), info), 'clue'),
                plan: c.plan,
                notReady: c.notReady,
                arrive,
            });
        return {
            ...out,
            reason: out.content ? '' : '当前无可进行的线索场景',
            lineOnly: !out.content && !!(out.used && out.used.recognize && out.used.recognize.length),
        };
    }
    // 剧情推进判断本轮走进了某个场景：这一轮就按它是当前场景出材料（表格里的当前场景要等填表后才变）。
    // 只认正在进行、没有暂停的线里现在能做的场景；还没开始的支线入口照旧等填表识别。
    function arriveState(c) {
        let uid = c.plan ? plot.roundScene() : '',
            s = uid && uid !== c.state.focus.uid ? c.state.nodeStates.find((x) => x.node.uid === uid) : null,
            ln = s && s.node.unit.line,
            ls = ln && c.state.lineStates.find((x) => x.line === ln || x.line.id === (ln.id || ln));
        // 暂停的线里的节点选不成当前场景（下面 focus 对不上就不用）
        if (!ls || ls.state !== '进行中') return { state: c.state, arrive: !1 };
        let st = computeClueState(c.compiled, c.snap.cond || c.snap, { ...c.prog, focus: uid, focusSceneAt: void 0, focusTaken: !1 }, project().clue);
        return st.focus.uid === uid ? (note(`本轮按剧情推进的判断给场景${uid}的材料`), { state: st, arrive: !0 }) : { state: c.state, arrive: !1 };
    }
    // 推进原文里的 <pi_scene> 行不进正文请求
    function stripPlotSceneFrom(payload) {
        let list = payload && (payload.chat || payload.messages);
        if (!Array.isArray(list)) return;
        for (let m of list)
            m && typeof m.content == 'string'
                ? (m.content = stripPlotScene(m.content))
                : m && Array.isArray(m.content) && m.content.forEach((x) => x && typeof x.text == 'string' && (x.text = stripPlotScene(x.text)));
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
        (pendingCandidates && note('生成已中止，本次提供给正文的线索记录作废'), (pendingCandidates = null));
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
                toast('warning', `本轮请求中出现了不应出现的剧情（${leaks[0].source}）${leaks[0].where === 'setting' ? '，在这个项目的设定里' : leaks[0].where === 'table' ? '，在数据库表格里' : '，并非剧情注入器注入'}。请到诊断页查看。`)),
            result.duplicated &&
                (note(`最终请求核验：本轮线索内容出现了 ${result.projectionCount} 次（重复注入）`),
                toast('warning', '本轮线索内容在正文请求中出现多次，请检查是否同时启用了其他注入路径。')),
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
                ((lastTableUpdate = Date.now()), fold.onTableUpdate(), invalidate('clue-table'), project() && scheduleSync());
            }),
            api.registerTableUpdateCallback(tableCallback),
            typeof api.registerTableFillStartCallback == 'function' &&
                ((fillStartCallback = () => ((lastFillStart = Date.now()), fold.onFillStart())), api.registerTableFillStartCallback(fillStartCallback)),
            project() && scheduleSync());
    }
    function unregisterAll() {
        let api = acuApi();
        try {
            tableCallback && api && api.unregisterTableUpdateCallback && api.unregisterTableUpdateCallback(tableCallback);
            fillStartCallback && api && api.unregisterTableFillStartCallback && api.unregisterTableFillStartCallback(fillStartCallback);
        } catch {}
        ((tableCallback = null), (fillStartCallback = null), hostWindow().clearTimeout(foldTimer));
    }
    function act(op) {
        let p = project(),
            prog = getProgress();
        if (!p || !prog) throw new Error('当前项目不是线索模式');
        let ops = addClueOp(clueOps(), chatMessages(), op);
        (setProgress({ ...prog, clue: ops }, 'clue-op'), invalidate(), note(`手动操作：${opLabel(op)}`));
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
                done: { force: '手动完成', undo: '标为未完成', '': '完成改回按表格判断' },
                skip: { true: '跳过', '': '取消跳过' },
                focus: { true: '设为本轮场景', '': '取消手选' },
                fact: { confirmed: '确认线索', claimed: '记为存疑', kept: '保留线索', revoked: '作废线索', '': '线索改回按表格判断' },
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
            size: c ? sizeOf(c) : null,
        };
    }
    // 本轮规模：线索表实际行数、线索表文字量、未建行线索、场景目录长度、上次注入长度。
    function sizeOf(c) {
        let p = project(),
            fb = (p.clue.bindings.facts || [])[0],
            kb = (p.clue.bindings.knowledge || [])[0],
            sheet = (name) => {
                let f = name ? findSheet(c.snap.tables || {}, name) : { error: 'x' };
                return f.error ? null : f.sheet;
            },
            rowsOf = (s) => (s ? sheetRows(s).rows : []),
            chars = (s) => (s ? JSON.stringify(rowsOf(s)).length : 0),
            fs = sheet(fb && fb.表),
            ks = sheet(kb && kb.表),
            scenePath = p.clue.bindings.scene && p.clue.bindings.scene.路径,
            ctrl = sheet(scenePath ? String(scenePath).split('/')[0].trim() : ''),
            lines = c.state.lineStates || [];
        return {
            factRows: rowsOf(fs).length,
            knowRows: rowsOf(ks).length,
            tableChars: chars(fs) + chars(ks) + chars(ctrl),
            future: c.snap.scope ? c.snap.scope.future.size : 0,
            openable: lines.filter((s) => s.state === '可开启').length,
            running: lines.filter((s) => s.state === '进行中').length,
            catalog: c.plan ? c.plan.catalog.length : 0,
            injected: lastInjected ? String(lastInjected.content || '').length : null,
        };
    }
    return {
        compute,
        invalidate,
        projection,
        act,
        opScope,
        voidFact,
        settleWithdrawn,
        withdrawnList,
        nodeFillIn,
        markNodeDone,
        clearNodeDone,
        confirmFact,
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
        canStartFromNow,
        startFromNow,
        wantStart,
        startTiming: START_TIMING,
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
        foldCheck,
        foldCollapse: (ids, opts) => userCollapse(ids, opts),
        foldChat,
        setFoldChat,
        foldAutoOn: () => {
            let p = project();
            return !!p && foldAutoOn(p);
        },
        // 自动收起的放行开关（按存储模式）。真实酒馆放行验收时用。
        foldRelease: FOLD_AUTO_RELEASED,
        foldRestore: (pick, opts) => (opts && opts.auto ? fold.restore(pick, opts) : userRestore(pick)),
        foldKept: () => [...foldKept()],
        foldQuiet: FOLD_QUIET,
        foldFillBusy: () => fold.fillBusy(),
        auditFinalRequest,
        stripPlotSceneFrom,
        awaitPlotScene: () => plot.awaitScene(),
        syncPlotPreset: (o) => plot.syncPreset(o),
        record,
        ensureRound,
        endRound,
        bindCandidatesToMessage,
        discardPendingCandidates,
        leaveScene,
        lastInjected: () => lastInjected,
        onChatChanged() {
            (hostWindow().clearTimeout(syncTimer),
                hostWindow().clearTimeout(foldTimer),
                (catalogMissing = !1),
                (labelsWarned = !1),
                (lastToast = { key: '', at: 0 }),
                lineBar && lineBar(null),
                (lastStatus = null),
                (lastTableUpdate = 0),
                hostWindow().clearTimeout(recoverTimer),
                (waits = 0),
                plot.clear(),
                (pendingCandidates = null),
                (round = null),
                invalidate());
        },
    };
}
