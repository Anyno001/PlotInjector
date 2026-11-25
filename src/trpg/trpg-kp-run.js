// 跑团模式的 KP 自动检测（运行时）：每轮回复结束后发一次检测请求，把核对过的结果写进进度。
// 排队、重试、通知卡的写法照大纲模式的检测（app/runtime.js）。判断结果存在注入器自己的进度里，表格只是镜像（通过的线索写回事实表、知情表，写不进去只记日志）。
import { chatMessages } from '../host/st.js';
import { requestLlm } from '../host/llm.js';
import { resolveLlm } from '../core/store.js';
import { menuDialog, promptDialog, openDialog, esc } from '../ui/dom.js';
import { isPlainObject } from '../core/outline.js';
import { effectiveFact } from './trpg-clue-rules.js';
import { findSheet, sheetRows, cellText, SELF_KEYS } from './trpg-clue-tables.js';
import { acuApi } from './trpg-clue-runtime.js';
import { trpgCheckResults, GOT_ANYWAY } from './trpg.js';
import { aiFloorCount, KP_LEVELS, kpPushTarget, kpFind } from './trpg-kp.js';
import { discoveryList } from './trpg-clue-project.js';
import { checkProblems, problemText, rollNoticeText, isKnownCode } from './trpg-check-board.js';
import { steerContext } from './trpg-steer.js';
import { seedCandidates, plantedSeeds } from './trpg-slices.js';
import { confirmRecheck, recheckHits } from './trpg-kp-verify-ui.js';
import {
    KP_NOTE,
    kpAutoOn,
    recentTwo,
    kpCandidates,
    kpPendingSays,
    kpScenes,
    kpCheckMessages,
    parseKpReply,
    verifyKp,
    kpFactLabel,
    kpLogEntry,
    kpFailedChecks,
    pushLog,
    kpOffText,
    recentFloors,
    kpRecheckCandidates,
    kpRecheckMessages,
} from './trpg-kp-check.js';

const CHECK_RETRIES = 3;
const RETRY_GAP_MS = 2e3;

// deps：data、notice、clue（运行时里的线索运行时）、getProject / getProgress / setProgress、ticket / ticketValid、log、setTimeout
export function createKpRunner(deps) {
    const { data, notice, log } = deps;
    let running = false,
        again = false,
        lastKey = '';

    function kpOf() {
        return (deps.getProgress() || {}).trpgKp || {};
    }
    function saveKp(patch) {
        let prog = deps.getProgress();
        prog && deps.setProgress({ ...prog, trpgKp: { ...(prog.trpgKp || {}), ...patch } }, 'trpg-kp');
    }

    // floor：刚收到的那一楼；manual：手动重试时不看「已经检测过这一楼」
    async function run({ floor = -1, manual = false } = {}) {
        let project = deps.getProject();
        // 每轮检测关着也照样数层数做自动核实
        if (!project || !kpAutoOn(data.settings())) return (project && deps.setTimeout(() => autoVerify(), 0), null);
        if (running) return ((again = true), log('跑团检测：上一次还没结束，结束后再检测'), null);
        let chat = chatMessages(),
            at = floor >= 0 && chat[floor] && !chat[floor].is_user ? floor : chat.length - 1,
            msg = chat[at];
        if (!msg || msg.is_user || msg.is_system) return null;
        let key = `${deps.ticket().chat}:${at}:${Number(msg.swipe_id) || 0}:${msg.send_date ?? ''}`;
        if (!manual && key === lastKey) return null;
        let c = deps.clue.compute();
        if (!c || !c.snap.api || c.prog.paused || !c.snap.enabled) return null;
        running = true;
        let iso0 = deps.clue.opScope().iso;
        let t = deps.ticket();
        try {
            lastKey = key;
            let checks = trpgCheckResults(chat),
                recent = recentTwo(chat),
                candidates = kpCandidates({ prog: deps.getProgress(), chat, floor: at, state: c.state, snap: c.snap, effective: (id, snap) => effectiveFact(id, snap, c.prog), checks }),
                says = kpPendingSays({ compiled: c.compiled, state: c.state, conds: c.prog.trpgConds }),
                scenes = kpScenes(c.state),
                labels = isPlainObject(project.clue.labels) ? project.clue.labels : {},
                labelOf = (id) => kpFactLabel(labels, id, (candidates.find((x) => x.fact === id) || {}).text),
                ctx = steerContext(project, c),
                sl = project.trpg && !project.trpg.sliceOff && project.trpg.slices ? project.trpg.slices : [],
                // 伏笔随同一次检测一起判，不另发请求
                seeds = sl.length ? seedCandidates({ prog: deps.getProgress(), chat, floor: at, slices: sl, planted: plantedSeeds(kpOf().seeds, chat) }) : [],
                messages = kpCheckMessages({ recent, candidates, says, scenes, stage: ctx.stage, rules: ctx.rules, labelOf, seeds });
            log(`跑团检测：第 ${at} 楼，${candidates.length} 条线索、${says.length} 个条件`);
            let parsed = null;
            for (let attempt = 0; ; attempt += 1)
                try {
                    if (!deps.ticketValid(t)) return null;
                    parsed = parseKpReply(await requestLlm(messages, resolveLlm(data.settings(), 'check'), { timeoutMs: 12e4 }));
                    break;
                } catch (error) {
                    if (!deps.ticketValid(t) || attempt >= CHECK_RETRIES) throw error;
                    (log(`跑团检测请求失败：${error.message}，${RETRY_GAP_MS / 1e3} 秒后第 ${attempt + 1} 次重试`),
                        await new Promise((resolve) => deps.setTimeout(resolve, RETRY_GAP_MS)));
                }
            if (!deps.ticketValid(t)) return (log('跑团检测返回时聊天或项目已切换，结果丢弃'), null);
            // 返回时这一楼已经被删、被重新生成：结果不要了
            let now = chatMessages()[at];
            if (!now || now.send_date !== msg.send_date || (Number(now.swipe_id) || 0) !== (Number(msg.swipe_id) || 0))
                return (log('跑团检测返回时这一楼已经变了，结果丢弃'), null);
            notice.hide('checkfail');
            let result = verifyKp(parsed, { candidates, says, scenes, recent, seeds }),
                prog0 = c.prog.factOverrides || {};
            // 通过的线索：已有人工记录（或 KP 之前判过）的不覆盖
            let recorded = [];
            for (let f of result.facts) {
                if (!f.ok || prog0[f.id]) continue;
                try {
                    let text = (candidates.find((x) => x.fact === f.id) || {}).text || '';
                    deps.clue.act({ kind: 'fact', target: f.id, value: 'confirmed', text, note: KP_NOTE });
                    recorded.push({ id: f.id, text, label: labelOf(f.id) });
                } catch (error) {
                    log(`跑团检测：记录线索失败：${error.message}`);
                }
            }
            // 场景：命中的节点在可进行的前提下设为焦点
            if (result.scene && result.scene !== c.state.focus.uid) {
                try {
                    deps.clue.setFocus(result.scene);
                } catch (error) {
                    log(`跑团检测：设场景失败：${error.message}`);
                }
            }
            let stage = c.state.current ? c.state.current.id : '',
                kp = kpOf(),
                muted = !!stage && kp.offMuted === stage,
                conds = { ...(kp.conds || {}) };
            for (let x of result.conds) x.ok && (conds[x.text] = { floor: at, quote: x.quote });
            // 埋下的伏笔：记楼层、swipe、发送时间，重 roll 或删楼后读取时对不上就当没埋
            let seedsDone = { ...(kp.seeds || {}) };
            for (let x of result.seeds || []) x.ok && (seedsDone[x.id] = { floor: at, swipe: Number(msg.swipe_id) || 0, stamp: String(msg.send_date ?? ''), quote: x.quote });
            // 判断以上面的进度记录为准；表格只是镜像，写不进去只记日志
            let tables = await mirrorTables(recorded, project, t, iso0);
            if (!deps.ticketValid(t)) return (log('跑团检测写表后聊天或项目已切换，不再保存日志'), null);
            saveKp({ conds, ...(result.seeds ? { seeds: seedsDone } : {}), log: pushLog(kp.log, { ...kpLogEntry({ floor: at, result, labelOf, off: result.offTrack, checkOf: (id) => !!(kpFind(c.state, id) || {}).discovery?.check, failed: kpFailedChecks({ state: c.state, snap: c.snap, effective: (id, snap) => effectiveFact(id, snap, c.prog), checks }) }), ...(tables.length ? { tables } : {}) }) });
            deps.clue.invalidate('kp-check');
            result.offTrack && !muted && offerOffTrack({ result, stage });
            log(`跑团检测完成：拿到 ${result.facts.filter((x) => x.ok).length} 条线索，${result.conds.filter((x) => x.ok).length} 个条件成立${result.offTrack ? '，偏离模组' : ''}`);
            return result;
        } catch (error) {
            if (deps.ticketValid(t)) {
                lastKey = '';
                log(`跑团检测失败：${error.message}`);
                notice.show({
                    id: 'checkfail',
                    title: '跑团检测失败',
                    body: `已自动重试${CHECK_RETRIES}次：${error.message}`,
                    actions: [
                        { label: '重试', primary: !0, run: () => run({ floor: at, manual: !0 }) },
                        { label: '关闭', run: () => {} },
                    ],
                });
            }
            return null;
        } finally {
            running = false;
            again ? ((again = false), deps.setTimeout(() => run({ floor: -1 }), 0)) : deps.setTimeout(() => autoVerify(), 0);
        }
    }

    // ---- 每 N 层自动核实（用户 2026-11-24）：progress.trpgKp.autoVerify = { every, last }，按聊天存，默认关 ----
    // last = 上次核实时的聊天楼数；楼数比它多出 every 层就在后台核实最近 every+2 层（多读两层接上前一次），
    // 有结果弹提示卡，点开走和手动核实同一个勾选确认窗口；没结果、出错都只记日志不打扰
    function autoVerifyEvery() {
        let a = kpOf().autoVerify;
        return a && Number(a.every) > 0 ? Number(a.every) : 0;
    }
    function setAutoVerify(every) {
        saveKp({ autoVerify: every > 0 ? { every, last: chatMessages().length } : null });
    }
    let autoBusy = false;
    async function autoVerify() {
        let every = autoVerifyEvery();
        if (!every || autoBusy || running) return;
        let floors = chatMessages().length,
            last = Number((kpOf().autoVerify || {}).last) || 0;
        // 删楼、换分支后楼数变少：从现在重新计
        if (floors < last) return saveKp({ autoVerify: { every, last: floors } });
        if (floors - last < every) return;
        autoBusy = true;
        saveKp({ autoVerify: { every, last: floors } });
        try {
            let r = await recheck({ floors: every + 2 });
            if (!r || r.error || r.empty) return r && r.error && log(`自动核实没做：${r.error}`);
            let hits = recheckHits(r);
            log(`自动核实第 ${r.from}–${r.to} 楼：${hits} 条有结果`);
            if (!hits) return;
            notice.show({
                id: 'kp-verify',
                title: '自动核实阶段',
                body: `第${r.from}–${r.to}楼里找到${r.result.facts.filter((f) => f.ok).length}条线索、${r.result.conds.filter((x) => x.ok).length}个条件，确认后写入`,
                actions: [
                    { label: '查看并写入', primary: !0, run: () => confirmRecheck(r, { kp: api, compute: () => deps.clue.compute(), title: '自动核实阶段' }) },
                    { label: '忽略', run: () => {} },
                ],
            });
        } catch (error) {
            log(`自动核实失败：${error.message}`);
        } finally {
            autoBusy = false;
        }
    }

    // 判定通过的线索写回数据库表格（写法照 trpg-clue-run.js 的改线索标签）：
    // 每条写之前按编号重新找行号、核对作用域，优先官方 updateRow，旧版逐格 updateCell，写完回读核对；
    // 表里没有对应行不新建；写不进去不影响判断，只返回说明记进日志。
    async function mirrorTables(items, project, t, iso0) {
        if (!items.length) return [];
        let api = acuApi(),
            fb = ((project.clue.bindings || {}).facts || [])[0],
            kb = ((project.clue.bindings || {}).knowledge || [])[0],
            first = (v, d = '') => String(Array.isArray(v) ? (v[0] ?? d) : (v ?? d)),
            live = () => deps.ticketValid(t) && deps.clue.opScope().iso === iso0,
            tableNow = (name) => {
                deps.clue.invalidate();
                let now = deps.clue.compute(),
                    sh = findSheet((now && now.snap.tables) || {}, name);
                if (sh.error) return null;
                return { sheet: sh.sheet, col: sheetRows(sh.sheet).col };
            },
            // 写一行：find(t) 返回行号（content 下标，0 是表头）；多于一行匹配也不写
            writeRow = async (name, find, data) => {
                if (!live()) return '写表前切换了聊天、项目或数据隔离';
                let t0 = tableNow(name),
                    at = t0 ? find(t0) : -1;
                if (at === -2) return '表里有多行同一个编号，没写';
                if (at < 1) return '表里还没有这一行，没写';
                if (Object.keys(data).some((k) => t0.col(k) < 0)) return `表里缺少列：${Object.keys(data).filter((k) => t0.col(k) < 0).join('、')}`;
                if (typeof api.updateRow == 'function') await Promise.resolve(api.updateRow(name, at, data)).catch(() => !1);
                else
                    for (let [k, v] of Object.entries(data)) {
                        if (!live()) break;
                        let t2 = tableNow(name),
                            at2 = t2 ? find(t2) : -1;
                        if (at2 < 1) break;
                        await Promise.resolve(api.updateCell({ tableName: name, rowIndex: at2, colIdentifier: k, value: v, skipNotify: !0 })).catch(() => !1);
                    }
                if (!live()) return '写表途中切换了聊天、项目或数据隔离，没法确认结果';
                let t3 = tableNow(name),
                    at3 = t3 ? find(t3) : -1;
                return at3 >= 1 && Object.entries(data).every(([k, v]) => cellText(t3.sheet.content[at3][t3.col(k)]) === cellText(v)) ? 'ok' : '写了但回读对不上';
            },
            findBy = (cols, test) => (t0) => {
                let idx = cols.map((n) => t0.col(n));
                if (idx.some((i) => i < 0)) return -1;
                let hits = [];
                t0.sheet.content.forEach((r, k) => k > 0 && Array.isArray(r) && test(idx.map((i) => cellText(r[i]))) && hits.push(k));
                return hits.length > 1 ? -2 : hits.length ? hits[0] : -1;
            },
            out = [];
        try {
            if (!api || !fb || !fb.状态列 || (typeof api.updateRow != 'function' && typeof api.updateCell != 'function'))
                return items.map((x) => ({ label: x.label, fact: '没有可写的数据库接口，或没绑定事实表状态列' }));
            for (let x of items) {
                let data = { [fb.状态列]: first(fb.已核实值, '已核实') };
                fb.内容列 && x.text && (data[fb.内容列] = x.text);
                let entry = { label: x.label, fact: await writeRow(fb.表, findBy([fb.编号列], ([c]) => c === x.id), data) };
                if (kb && kb.方式列 && kb.事实列 && kb.角色列 && entry.fact === 'ok') {
                    let kd = { [kb.方式列]: first(kb.有效值, '亲见') };
                    kb.可信度列 && (kd[kb.可信度列] = first(kb.已核实值, '已核实'));
                    entry.know = await writeRow(kb.表, findBy([kb.事实列, kb.角色列], ([f, a]) => f === x.id && SELF_KEYS.includes(a.toLowerCase())), kd);
                }
                out.push(entry);
            }
        } catch (error) {
            out.push({ label: '', fact: `写表出错：${error.message}` });
        }
        return out;
    }

    // 偏离提醒：写法照大纲模式的偏离提醒
    function offerOffTrack({ result, stage }) {
        let actions = [],
            steer = (text) => (saveKp({ push: { kind: 'steer', text, floor: aiFloorCount(chatMessages()) } }), notice.hide('kp-offtrack'));
        if (result.pullBack) {
            actions.push({ label: '按建议拉回', primary: !0, run: () => steer(result.pullBack) });
            // 预览里可能带剧透，所以单独放一个按钮；取消就把提示卡放回去
            actions.push({
                label: '先看再改（可能剧透）',
                run: async () => {
                    let text = await promptDialog({ title: '按建议拉回', label: '下一轮正文会这样把剧情引回来，可以修改', value: result.pullBack, multiline: !0 });
                    if (text == null || !String(text).trim()) return offerOffTrack({ result, stage });
                    steer(String(text).trim());
                },
            });
        }
        result.offReason &&
            actions.push({
                label: '查看原因（可能剧透）',
                run: async () => {
                    await openDialog({ title: '偏离原因', html: `<p class="pi-hint">${esc(result.offReason)}</p>` });
                    offerOffTrack({ result, stage });
                },
            });
        actions.push({
            label: '给点线索',
            run: async () => {
                let c = deps.clue.compute(),
                    target = c && kpPushTarget(c.state, c.snap, c.prog);
                if (!target) return notice.show({ id: 'kp-offtrack', title: '眼下没有能推的线索', body: '', timeout: 4e3 });
                let pick = await menuDialog({ title: '给点线索', items: KP_LEVELS.map((x) => ({ label: x.label, value: String(x.level) })) });
                pick && (saveKp({ push: { fact: target.fact, level: Number(pick), floor: aiFloorCount(chatMessages()) } }), notice.hide('kp-offtrack'));
            },
        });
        actions.push({ label: '这次不管', run: () => notice.hide('kp-offtrack') });
        stage && actions.push({ label: '本阶段不再提醒', run: () => (saveKp({ offMuted: stage }), notice.hide('kp-offtrack')) });
        notice.show({ id: 'kp-offtrack', title: '剧情偏离模组', body: kpOffText(result.offKind), actions });
    }

    // 重新核实阶段（用户 2026-11-24）：读最近 floors 楼，重判进行中阶段没完成的线索和条件。
    // 只判断不写入，返回 { result, labelOf, from, to, t, iso0 } 交给界面让用户勾选；不能核实时返回 { error } 或 { empty: true }
    async function recheck({ floors = 10 } = {}) {
        let project = deps.getProject();
        if (!project) return { error: '没有启用的跑团项目' };
        if (running) return { error: '上一次检测还没结束，稍后再试' };
        let c = deps.clue.compute();
        if (!c || !c.snap.api) return { error: '数据库还没就绪' };
        let chat = chatMessages(),
            recent = recentFloors(chat, floors);
        if (!recent.length) return { error: '聊天里还没有正文' };
        let candidates = kpRecheckCandidates({ compiled: c.compiled, state: c.state, snap: c.snap, effective: (id, snap) => effectiveFact(id, snap, c.prog), checks: trpgCheckResults(chat) }),
            says = kpPendingSays({ compiled: c.compiled, state: c.state, conds: c.prog.trpgConds });
        if (!candidates.length && !says.length) return { empty: true };
        let labels = isPlainObject(project.clue.labels) ? project.clue.labels : {},
            labelOf = (id) => kpFactLabel(labels, id, (candidates.find((x) => x.fact === id) || {}).text),
            ctx = steerContext(project, c),
            messages = kpRecheckMessages({ recent, candidates, says, stage: ctx.stage, rules: ctx.rules, labelOf }),
            t = deps.ticket(),
            iso0 = deps.clue.opScope().iso;
        running = true;
        log(`重新核实阶段：第 ${recent[0].floor}–${recent[recent.length - 1].floor} 楼，${candidates.length} 条线索、${says.length} 个条件`);
        try {
            let parsed = null;
            for (let attempt = 0; ; attempt += 1)
                try {
                    if (!deps.ticketValid(t)) return null;
                    parsed = parseKpReply(await requestLlm(messages, resolveLlm(data.settings(), 'check'), { timeoutMs: 18e4 }));
                    break;
                } catch (error) {
                    if (!deps.ticketValid(t) || attempt >= CHECK_RETRIES) throw error;
                    (log(`重新核实请求失败：${error.message}，${RETRY_GAP_MS / 1e3} 秒后第 ${attempt + 1} 次重试`),
                        await new Promise((resolve) => deps.setTimeout(resolve, RETRY_GAP_MS)));
                }
            if (!deps.ticketValid(t)) return null;
            let result = verifyKp(parsed, { candidates, says, scenes: [], recent });
            return { result, candidates, labelOf, from: recent[0].floor, to: recent[recent.length - 1].floor, t, iso0 };
        } finally {
            running = false;
            again && ((again = false), deps.setTimeout(() => run({ floor: -1 }), 0));
        }
    }

    // 写入用户勾选的核实结果：pick = { facts: [编号], conds: [条件原文] }。已有人工记录的线索不覆盖
    async function applyRecheck(r, pick) {
        if (!r || !deps.ticketValid(r.t)) return null;
        let c = deps.clue.compute(),
            prog0 = (c && c.prog.factOverrides) || {},
            facts = new Set(pick.facts || []),
            condSet = new Set(pick.conds || []),
            recorded = [];
        for (let f of r.result.facts) {
            if (!f.ok || !facts.has(f.id) || prog0[f.id]) continue;
            try {
                let text = (r.candidates.find((x) => x.fact === f.id) || {}).text || '';
                deps.clue.act({ kind: 'fact', target: f.id, value: 'confirmed', text, note: KP_NOTE });
                recorded.push({ id: f.id, text, label: r.labelOf(f.id) });
            } catch (error) {
                log(`重新核实：记录线索失败：${error.message}`);
            }
        }
        let kp = kpOf(),
            conds = { ...(kp.conds || {}) },
            nConds = 0;
        for (let x of r.result.conds) x.ok && condSet.has(x.text) && ((conds[x.text] = { floor: r.to, quote: x.quote }), (nConds += 1));
        let tables = await mirrorTables(recorded, deps.getProject(), r.t, r.iso0);
        if (!deps.ticketValid(r.t)) return null;
        // 日志里只把真正写入的算通过
        let applied = {
            ...r.result,
            sceneName: '',
            facts: r.result.facts.map((f) => (f.ok && !facts.has(f.id) ? { ...f, ok: !1, note: '没选写入' } : f)),
            conds: r.result.conds.map((x) => (x.ok && !condSet.has(x.text) ? { ...x, ok: !1, note: '没选写入' } : x)),
        };
        saveKp({ conds, log: pushLog(kp.log, { ...kpLogEntry({ floor: r.to, result: applied, labelOf: r.labelOf, off: !1 }), recheck: r.from, ...(tables.length ? { tables } : {}) }) });
        deps.clue.invalidate('kp-recheck');
        log(`重新核实写入：${recorded.length} 条线索、${nConds} 个条件`);
        return { facts: recorded.length, conds: nConds };
    }

    // 清空本聊天的 KP 记录：撤销 KP 判的线索（人工确认的不动）、清掉一句话条件、检测日志和「本阶段不再提醒」。表格里已写回的不动（删楼或重 roll 会跟着退回）。
    function clearKp() {
        let c = deps.clue.compute(),
            ids = Object.entries((c && c.prog.factOverrides) || {})
                .filter(([, v]) => v && v.by === 'kp')
                .map(([id]) => id);
        for (let id of ids) deps.clue.act({ kind: 'fact', target: id, value: '', note: '清空KP记录' });
        saveKp({ conds: {}, log: [], offMuted: '' });
        lastKey = '';
        deps.clue.invalidate('kp-clear');
        return ids.length;
    }
    // 掷完弹小卡（用户 2026-11-24）：用户最后一条消息里刚掷的判定、没认出的骰点，各弹一次。
    // 同一楼同一编号只弹一次，记在 progress.trpgKp.rollSeen（键带楼层的发送时间，删楼后重发能再弹）
    function rollNotice() {
        let project = deps.getProject();
        if (!project) return;
        let chat = chatMessages(),
            checks = trpgCheckResults(chat),
            at = checks.lastUser,
            msg = chat[at];
        if (!msg) return;
        let c = deps.clue.compute(),
            known = new Set(),
            seen = Array.isArray(kpOf().rollSeen) ? kpOf().rollSeen : [],
            stamp = `${at}:${msg.send_date ?? ''}`,
            fresh = [];
        if (c) for (let ns of c.state.nodeStates) for (let d of discoveryList(isPlainObject(ns.node.item) ? ns.node.item : {})) d.fact && known.add(d.fact);
        for (let [code, r] of Object.entries(checks)) r.fresh && !seen.includes(`${stamp}:${code}`) && fresh.push([code, r]);
        let probs = checkProblems(checks, c ? known : null).filter((p) => p.at === at && !seen.includes(`${stamp}:!${p.kind}`));
        // 掷的是编号对不上模组的检定：不报成败（报了成功也没有线索可给），只说编号不对
        if (c) {
            let bad = fresh.filter(([code]) => !isKnownCode(code, known));
            bad.length && !probs.some((p) => p.kind === 'badcode') && probs.push({ at, kind: 'badcode', skill: bad[0][1].skill, code: bad[0][0] });
            fresh = fresh.filter(([code]) => isKnownCode(code, known) && !/^SAN$/i.test(code));
        }
        if (!fresh.length && !probs.length) return;
        saveKp({ rollSeen: [...seen, ...Object.keys(checks).filter((code) => checks[code].fresh).map((code) => `${stamp}:${code}`), ...probs.map((p) => `${stamp}:!${p.kind}`)].slice(-40) });
        if (probs.length && !fresh.length)
            return notice.show({ id: 'kp-roll', title: '判定未生效', body: probs.map(problemText).join('；'), actions: [{ label: '关闭', run: () => {} }], timeout: 8e3 });
        let parts = fresh.map(([code, r]) => {
                let rescue = /-KP$/.test(code),
                    base = code.replace(/-KP$/, ''),
                    hit = c && kpFind(c.state, base),
                    check = hit && hit.discovery.check;
                return { base, ...rollNoticeText(r, { hidden: !!(check && check.hidden), rescue, anyway: !!(check && check.fail && GOT_ANYWAY.test(check.fail)) }) };
            }),
            rescueOf = parts.find((p) => p.canRescue && !(c && effectiveFact(p.base, c.snap, c.prog).confirmed)),
            body = [...parts.map((p) => p.body), ...probs.map(problemText)].join('；'),
            actions = [];
        rescueOf &&
            actions.push({
                label: '补救检定',
                primary: !0,
                run: () => {
                    // 正文还没回来时点的：推一把要对准下一轮（AI 楼数会多一楼）
                    let now = chatMessages(),
                        tail = now[now.length - 1];
                    saveKp({ push: { fact: rescueOf.base, level: 2, floor: aiFloorCount(now) + (tail && tail.is_user ? 1 : 0) } });
                },
            });
        actions.push({ label: '关闭', run: () => {} });
        notice.show({ id: 'kp-roll', title: parts.length === 1 ? parts[0].title : '判定结果', body, actions, ...(rescueOf ? {} : { timeout: 8e3 }) });
    }
    const api = { run, recheck, applyRecheck, clearKp, autoVerifyEvery, setAutoVerify, rollNotice, reset: () => ((again = false), (lastKey = '')) };
    return api;
}
