import { hostWindow, chatMessages, ctx, toast } from '../host/st.js';
import { isClueMode, withNodeIds } from '../core/clue-model.js';
import { normalizeClueOps, effectiveClueProgress, diffClueStatus, addClueOp } from '../core/clue-progress.js';

import { cloneTables, readFacts, readKnowledge, readCell, sameValue, cellText, plotPresetConflicts } from '../core/clue-tables.js';

import {
    compileClue,
    computeClueState,
    prebuiltGaps,
    tableConsistencyHints,
    NODE_STATUS_LABELS,
    effectiveFact,
    AWAY_PREFIX,
} from '../core/clue-rules.js';

import { discoveryList, buildClueProjection, clueText } from '../core/clue-project.js';
import { isPlainObject } from '../core/outline.js';

import { requestToText, auditRequest } from '../core/clue-audit.js';

export const CLUE_PROVIDER_ID = 'plot-injector';

export const CLUE_LOG_MAX = 40;

export const ROUND_TTL_MS = 18e4;

export const CANDIDATE_KEEP = 40;

export function acuApi() {
    let w = hostWindow();
    return w.AutoCardUpdaterAPI || window.AutoCardUpdaterAPI || null;
}

export function createClueRuntime({ data, getProject, getProgress, setProgress, emit, log, ticket = () => null, ticketValid = () => !0 }) {
    // lastTableUpdate：官方表格更新回调最近一次触发的时间（只代表「表变了」，不代表上一楼的填表全部完成）。
    let lastTableUpdate = 0,
        lastAudit = null,
        lastInjected = null,
        dirty = !0,
        cache = null,
        lastStatus = null,
        filling = !1,
        lastFill = null,
        lastCommit = null,
        provided = null,
        registered = !1,
        unregister = null,
        tableCallback = null,
        events = [];
    // 本轮：从「等待填表」之前就建立，后续前置上下文、临时世界书注入都核对同一张票据。
    let round = null;
    // 自动填表流水线：数据库发 queued 后、settled 前都算「还有填表待处理」（v3）。
    let pendingPipelines = /* @__PURE__ */ new Map();
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
    // 给缺 ID 的节点补 ID 并保存；已有 ID 不动。只在线索模式下做，避免改写大纲模式项目。
    function ensureIds(p) {
        let next = withNodeIds(p.outline.volumes);
        return next === p.outline.volumes
            ? p
            : (data.updateProject(p.id, (cur) => ({ ...cur, outline: { ...cur.outline, volumes: withNodeIds(cur.outline.volumes) } })),
              note('已给缺少 ID 的节点补上稳定 ID'),
              data.project(p.id) || p);
    }
    function snapshot(p) {
        let api = acuApi();
        if (!api || typeof api.exportTableAsJson != 'function')
            return {
                facts: /* @__PURE__ */ new Map(),
                knowledge: [],
                tables: {},
                problems: ['没有检测到数据库插件（AutoCardUpdaterAPI），所有事实视为未知'],
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
    // 计算（带缓存）。表格更新、聊天变化、人工操作、项目修改都会置脏。
    function compute() {
        let p = project();
        if (!p) return null;
        if (!dirty && cache && cache.projectId === p.id && cache.outline === p.outline && cache.clue === p.clue) return cache;
        p = ensureIds(p);
        let compiled = compileClue(p.outline.volumes),
            snap = snapshot(p),
            prog = effectiveClueProgress(clueOps(), chatMessages()),
            state = computeClueState(compiled, snap, prog, p.clue);
        snap.api && (p.clue.bindings.facts || []).length && snap.problems.push(...prebuiltGaps(compiled, snap));
        let hints = snap.api ? [...tableConsistencyHints(snap), ...uncandidatedHints(compiled, snap, prog)] : [],
            status = Object.fromEntries(state.nodeStates.filter((s) => s.node.uid).map((s) => [s.node.uid, s.status]));
        if (lastStatus && lastStatus.projectId === p.id)
            for (let change of diffClueStatus(lastStatus.map, status)) {
                let s = state.nodeStates.find((x) => x.node.uid === change.uid);
                note(`${s ? s.node.name : change.uid}：${NODE_STATUS_LABELS[change.from]} → ${NODE_STATUS_LABELS[change.to]}`);
            }
        return (
            (lastStatus = { projectId: p.id, map: status }),
            (cache = { projectId: p.id, outline: p.outline, clue: p.clue, compiled, snap, prog, state, hints, at: Date.now() }),
            (dirty = !1),
            cache
        );
    }
    // 「没作为候选给过正文、却第一次被记为已核实」的事实（GPT §13.2）：可能是填表误记（如把推进计划当成发生），
    // 也可能是合理的越序调查或替代发现。只提示作者检查依据，不改判定、不自动纠正。
    // 候选记录：本聊天各楼绑定过的 clueCandidates（含已换掉的回复版本，宽松处理）+ 本次待绑定的。人工确认的事实不提示。
    function uncandidatedHints(compiled, snap, prog) {
        let pr = getProgress(),
            offered = /* @__PURE__ */ new Set();
        for (let x of pr && Array.isArray(pr.clueCandidates) ? pr.clueCandidates : [])
            for (let c of x.candidates || []) offered.add(c.fact);
        // 逐楼记录最多留 CANDIDATE_KEEP 条；另存一份「本聊天给过的事实编号」，不设上限（数量很小），长聊天里不会误报（GPT §14.2-4）。
        for (let id of pr && Array.isArray(pr.clueOffered) ? pr.clueOffered : []) offered.add(id);
        for (let c of (pendingCandidates && pendingCandidates.candidates) || []) offered.add(c.fact);
        let tracked = /* @__PURE__ */ new Set();
        for (let n of compiled.nodes) for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) d.fact && tracked.add(d.fact);
        // 「存疑」（说法值）也算：实测里填表把一段别的传闻错记到了 F_gossip（存疑），已核实之外的误记同样需要提醒。
        let list = [],
            claims = [];
        for (let [id, f] of snap.facts || []) {
            if (!tracked.has(id) || offered.has(id)) continue;
            let over = prog.factOverrides && prog.factOverrides[id];
            if (over && over.status === 'confirmed') continue;
            f.status === 'confirmed' ? list.push(id) : f.claimed && claims.push(id);
        }
        let out = [];
        list.length &&
            out.push(
                `这些事实被记为已核实，但插件从没把它们作为可能发现给过正文：${list.join('、')}。可能是合理的越序调查，也可能是填表把计划或推测当成了发生，请对照正文检查依据${list.length === 1 ? '' : '（逐条）'}`,
            );
        claims.length &&
            out.push(
                `这些事实被记为「说法 / 存疑」，但插件从没把它们作为可能发现给过正文：${claims.join('、')}。可能是填表把别的传闻对错了编号，请对照正文和登记口径检查`,
            );
        return out;
    }
    function invalidate(reason = '') {
        ((dirty = !0), reason && emit(reason));
    }
    // ---- 本轮票据（R3） ----
    function beginRound(source) {
        return ((round = { ticket: ticket(), at: Date.now(), source, stale: !1 }), round);
    }
    // 没有本轮（或已过期）才新建；返回是否新建。已有的本轮哪怕失效也沿用（失效的本轮不提供任何材料）。
    function ensureRound(source) {
        return round && Date.now() - round.at <= ROUND_TTL_MS ? !1 : (beginRound(source), !0);
    }
    function roundState() {
        if (!round) return { ok: !0 };
        if (Date.now() - round.at > ROUND_TTL_MS) return ((round = null), { ok: !0 });
        return ticketValid(round.ticket) ? { ok: !0 } : { ok: !1, reason: '本轮开始后切换了聊天、项目或推进方式' };
    }
    function endRound() {
        round = null;
    }
    // 本轮给正文的投影。主线关闭、数据库不可用、本轮票据失效时返回空并给出原因，不退回整阶段注入。
    function projection() {
        let c = compute();
        if (!c) return { content: '', reason: '不是线索模式' };
        if (!c.snap.api) return { content: '', reason: c.snap.problems[0] };
        if (c.prog.paused) return { content: '', reason: '主线已暂停（日常游玩）' };
        if (!c.snap.enabled) return { content: '', reason: '主线开关未开启' };
        let r = roundState();
        if (!r.ok) return { content: '', reason: r.reason };
        let prog = getProgress(),
            out = buildClueProjection(c.state, c.snap, c.prog, data.settings(), { pace: prog && prog.pace });
        return { ...out, reason: out.content ? '' : '当前没有可演的线索场景', stale: filling || pendingPipelines.size > 0 };
    }
    // 给前置任务（召回 / 基础推进）的简短上下文：只给焦点场景的入口与地点、其它可进行入口；不给发现内容。
    function preTaskContext() {
        let c = compute();
        if (!c || !c.snap.api || !c.snap.enabled || c.prog.paused) return '';
        let lines = [],
            focus = c.state.nodeStates.find((s) => s.node.uid && s.node.uid === c.state.focus.uid);
        if (focus) {
            let item = isPlainObject(focus.node.item) ? focus.node.item : {},
                entry = clueText(item.入口),
                place = clueText(item.地点);
            (entry || place) &&
                lines.push(
                    `当前候选场景（尚未发生，由用户行动决定是否进入）：${[entry, place && `地点：${place}`].filter(Boolean).join('；')}`,
                );
        }
        let leads = c.state.nodeStates
            .filter((s) => s.status === 'available' && s !== focus && !s.disabled)
            .map((s) => clueText(isPlainObject(s.node.item) ? s.node.item.入口 : ''))
            .filter(Boolean);
        return (leads.length && lines.push(`其他可进行的事：${leads.join('；')}`), lines.join('\n'));
    }
    // 记录实际注入（临时世界书），并把本轮候选发现编号存到聊天元数据，供之后填「这条回复」时使用。
    function record(via, out) {
        ((lastInjected = {
            at: Date.now(),
            via,
            chars: (out.content || '').length,
            focus: (out.used && out.used.focus) || '',
            facts: out.used ? out.used.facts.slice() : [],
            leads: out.used ? out.used.leads.slice() : [],
            reason: out.reason || '',
            stale: !!out.stale,
            content: out.content || '',
        }),
            out.stale && note('本轮使用的表格可能不含上一轮的填表结果'));
        // 每次注入都覆盖待绑定项：本次没有线索内容（主线关闭、票据失效等）就清空，不让上一次中止生成的候选落到这一楼。
        pendingCandidates =
            out.content && out.used && ((out.used.candidates || []).length || (out.used.scenes || []).length)
                ? makePending(out.used)
                : null;
    }
    // 生成被中止且还没有回复绑定：这次的候选作废。
    function discardPendingCandidates() {
        (pendingCandidates && note('生成已中止，本次的填表编号对照作废'), (pendingCandidates = null));
    }
    // ---- 填表候选编号：按「哪一条回复」绑定，填表时按楼层与回复版本取回，不读当前焦点 ----
    // 生成时还不知道回复会落在哪一楼：先记成「待定」，回复到达（MESSAGE_RECEIVED）时绑定到那一楼的当前回复版本。
    let pendingCandidates = null;
    function makePending(used) {
        return {
            at: Date.now(),
            focus: used.focus,
            candidates: (used.candidates || []).map((c) => ({ fact: c.fact, record: c.record || '' })),
            scenes: (used.scenes || []).map((s) => ({ uid: s.uid, entry: s.entry || '', place: s.place || '', focus: !!s.focus })),
            ticket: round ? round.ticket : ticket(),
        };
    }
    function bindCandidatesToMessage(index) {
        let pc = pendingCandidates;
        if (((pendingCandidates = null), !pc || Date.now() - pc.at > ROUND_TTL_MS || !ticketValid(pc.ticket))) return;
        let msg = chatMessages()[index];
        if (!msg || msg.is_user) return;
        let prog = getProgress();
        if (!prog) return;
        let list = (Array.isArray(prog.clueCandidates) ? prog.clueCandidates : []).filter(
            (x) => !(x.i === index && x.swipe === (Number(msg.swipe_id) || 0)),
        );
        let offered = new Set(Array.isArray(prog.clueOffered) ? prog.clueOffered : []);
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
    // 给填表请求：指定楼层范围内，每条回复「当前版本」实际提供过的候选。版本对不上（换了 swipe、重生成）就不给。
    function candidatesFor(indices) {
        // 没有明确楼层就不给（不能把历史上所有楼层的编号一起交出去）。
        let prog = getProgress(),
            chat = chatMessages(),
            list = prog && Array.isArray(prog.clueCandidates) ? prog.clueCandidates : [],
            wanted = new Set((indices || []).map(Number).filter(Number.isInteger));
        if (!wanted.size) return [];
        return list.filter(
            (x) =>
                wanted.has(x.i) &&
                chat[x.i] &&
                (Number(chat[x.i].swipe_id) || 0) === x.swipe &&
                String(chat[x.i].send_date ?? '') === x.stamp,
        );
    }
    // 数据库的聊天标识是去掉路径和 .jsonl 后缀的文件名（cleanChatName_ACU），酒馆 getCurrentChatId 可能带后缀；统一后精确比较。
    function chatKeyOf(value) {
        let text = String(value ?? '').trim();
        return text
            .split(/[\\/]/)
            .pop()
            .replace(/\.jsonl?$/, '');
    }
    function scopeMatches(scope) {
        let c = ctx(),
            chatId = c && typeof c.getCurrentChatId == 'function' ? chatKeyOf(c.getCurrentChatId()) : '';
        return !scope || !scope.chatId || !chatId || chatKeyOf(scope.chatId) === chatId;
    }
    // 最终请求核验：酒馆把请求拼好之后（CHAT_COMPLETION_PROMPT_READY / GENERATE_AFTER_COMBINE_PROMPTS），只读检查。
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
            isRevealed = (id) => effectiveFact(id, c.snap, c.prog).confirmed;
        // 焦点豁免跟着「本轮实际注入了哪个焦点」走（GPT §17.1）：暂停、主线关闭、票据失效时投影为空，焦点场景同样算未开放内容；
        // 别的路径把它带进请求要报警。不按「如果没暂停会是谁」来豁免。
        let injectedFocus = fresh && out ? lastInjected.focus || '' : '',
            auditState = { ...c.state, focus: { ...c.state.focus, uid: injectedFocus } };
        let result = auditRequest(text, p, auditState, out, { history, isRevealed }),
            leaks = result.leaks.filter((l) => l.level === 'leak');
        return (
            (lastAudit = { ...result, at: Date.now(), via: lastInjected ? lastInjected.via : '' }),
            leaks.length &&
                (note(
                    `最终请求核验：发现 ${leaks.length} 处本项目受限内容（${leaks
                        .slice(0, 3)
                        .map((l) => l.source)
                        .join('、')}${leaks.length > 3 ? '……' : ''}）`,
                ),
                toast(
                    'warning',
                    `本轮正文请求里出现了本项目未开放的作者材料（${leaks[0].source}）。来源不是剧情注入器的线索注入，请到诊断页查看。`,
                )),
            result.duplicated &&
                (note(`最终请求核验：本轮线索内容出现了 ${result.projectionCount} 次（重复注入）`),
                toast('warning', '本轮线索内容在正文请求里出现了不止一次，请检查是否同时启用了别的注入路径。')),
            emit('clue-audit'),
            result
        );
    }
    // ---- R07 / R1：上一轮填表未提交时，等它结束再开始本轮 ----
    // 数据库 v3 提供 queued/settled：只要还有没收尾的排队，就说明有填表待处理（含防抖、读聊天、楼层延迟）。
    // 旧版数据库（v2 及以下）没有排队信号，只能退回「回复后宽限窗口」的估计，并在诊断页提示。
    var FILL_GRACE_MS = 2500;
    let expectFillUntil = 0,
        waiters = [];
    function wake() {
        let list = waiters;
        ((waiters = []), list.forEach((fn) => fn()));
    }
    function nextChange(ms) {
        return new Promise((resolve) => {
            let done = !1,
                finish = () => {
                    done || ((done = !0), hostWindow().clearTimeout(timer), resolve());
                },
                timer = hostWindow().setTimeout(finish, Math.max(0, ms));
            waiters.push(finish);
        });
    }
    function hasQueueSignals() {
        let api = acuApi();
        return !!(api && Number(api.plotLinkVersion) >= 3);
    }
    function expectFill() {
        let p = project();
        p && p.clue.waitFill !== !1 && !hasQueueSignals() && (expectFillUntil = Date.now() + FILL_GRACE_MS);
    }
    // 返回 { ready, reason, waitedMs }。不抛错；最长等待 maxMs（数据库侧另有 90 秒上限）。
    // 等待期间本轮票据失效（切聊天 / 项目 / 模式）→ 立即返回 scope_changed，不再继续等。
    async function waitForFill({ maxMs = 85e3, isValid = () => !0 } = {}) {
        let p = project(),
            started = Date.now(),
            waited = !1;
        if (!p || p.clue.waitFill === !1) return { ready: !0, reason: '', waitedMs: 0 };
        for (;;) {
            let now = Date.now(),
                left = started + maxMs - now;
            if (!isValid())
                return (
                    note('等待填表期间切换了聊天、项目或推进方式，本轮不提供线索材料'),
                    { ready: !1, reason: 'scope_changed', waitedMs: now - started }
                );
            if (left <= 0)
                return (
                    note('等待上一轮填表超时，本轮按上一次已提交的表格计算'),
                    { ready: !1, reason: 'fill_timeout', waitedMs: now - started }
                );
            if (filling || pendingPipelines.size || now < expectFillUntil) {
                (filling || pendingPipelines.size) &&
                    !waited &&
                    ((waited = !0), note('上一轮填表尚未完成，等待其提交后再开始本轮'), toast('info', '等待上一轮填表完成后再开始本轮…'));
                await nextChange(filling || pendingPipelines.size ? left : Math.min(left, expectFillUntil - now));
                continue;
            }
            if (waited && lastFill && lastFill.phase === 'end' && !lastFill.success)
                return (
                    note('上一轮填表未成功，本轮按上一次已提交的表格计算'),
                    { ready: !1, reason: lastFill.aborted ? 'fill_aborted' : 'fill_failed', waitedMs: Date.now() - started }
                );
            return (
                waited && note(`上一轮填表已完成（等待 ${Math.round((Date.now() - started) / 100) / 10} 秒）`),
                { ready: !0, reason: '', waitedMs: Date.now() - started }
            );
        }
    }
    let provider = {
        id: CLUE_PROVIDER_ID,
        // 本轮从这里开始：先建票据，再等待；等待期间票据失效则本轮不提供任何材料。
        async awaitReady(scope) {
            if (!scopeMatches(scope)) return { ready: !0 };
            ensureRound('link');
            let r = round,
                result = await waitForFill({ isValid: () => ticketValid(r.ticket) });
            return (result.reason === 'scope_changed' && (r.stale = !0), invalidate(), { ready: result.ready, reason: result.reason });
        },
        provideContext(scope) {
            if (!scopeMatches(scope)) return (note('前置任务请求的聊天与当前聊天不一致，不提供上下文'), '');
            ensureRound('link');
            let rs = roundState();
            if (!rs.ok || (round && round.stale)) return (note(`不提供前置任务上下文：${rs.reason || '本轮已失效'}`), '');
            let text = preTaskContext();
            return ((provided = { at: Date.now(), hook: 'context', chars: text.length }), text);
        },
        onFillEvent(event) {
            if (event.chatKey && !scopeMatches({ chatId: event.chatKey })) return;
            if (event.phase === 'queued') return (event.pipelineId && pendingPipelines.set(event.pipelineId, Date.now()), wake());
            if (event.phase === 'settled')
                return (event.pipelineId && pendingPipelines.delete(event.pipelineId), invalidate('clue-fill'), wake());
            (event.phase === 'start'
                ? ((filling = !0), (expectFillUntil = 0), note(`填表开始（${event.source === 'manual' ? '手动' : '自动'}）`))
                : ((filling = !1),
                  (lastFill = { ...event, at: Date.now() }),
                  note(
                      `填表结束：${event.aborted ? '已取消' : event.success ? '成功' : `失败${event.failedGroups ? `（${event.failedGroups} 组）` : ''}`}`,
                  ),
                  invalidate('clue-fill')),
                wake());
        },
        onTableCommitted(event) {
            if (event.chatKey && !scopeMatches({ chatId: event.chatKey })) return;
            ((lastCommit = { ...event, at: Date.now() }), invalidate('clue-commit'));
        },
        // 填表候选：数据库在构建填表请求时调用（可选，v4）。只给这批楼层里每条回复实际提供过的候选编号与记录要求。
        fillCandidates(scope, info) {
            if (!scopeMatches(scope) || !project()) return null;
            let items = candidatesFor(info && Array.isArray(info.messageIndices) ? info.messageIndices : []);
            if (!items.length) return null;
            // 场景编号只在绑定了「当前场景」单元格时给出：填表靠它把并行节点里实际进入的那个写进表格（否则没有地方可抄编号）。
            let p = project(),
                scenePath = (p && p.clue.bindings.scene && p.clue.bindings.scene.路径) || '',
                sceneCol = scenePath ? scenePath.split('/').pop().trim() : '',
                withScenes = !!sceneCol && items.some((x) => Array.isArray(x.scenes) && x.scenes.length),
                withFacts = items.some((x) => x.candidates && x.candidates.length);
            if (!withFacts && !withScenes) return null;
            let lines = ['【线索编号对照（只用于匹配编号，不代表已经发生）】'];
            withFacts &&
                lines.push(
                    '「可能发现」是这些回复生成时提供给正文的可能发现。只有正文里实际写出了对应结果，才按编号记录；正文没写出来、只是到达、尝试、答应或中途离开，都不要记录为已获得。',
                );
            let awayWord = cellText((p.clue.bindings.scene && p.clue.bindings.scene.离场值) || '离场');
            withScenes &&
                lines.push(
                    `「可进入场景」是当时可以去做的事。「${sceneCol}」以这一批最后一楼结束时的位置为准：主角实际到达并开始做其中一件事，填它的编号（只能照抄下面列出的编号）；明确离开调查、转去做无关的事，填「${awayWord}」；只是提到、打算、约好，保持原值。`,
                );
            for (let x of items) {
                let facts = x.candidates || [],
                    scenes = withScenes && Array.isArray(x.scenes) ? x.scenes : [];
                if (!facts.length && !scenes.length) continue;
                lines.push(`第 ${x.i} 楼：`);
                scenes.length &&
                    lines.push(
                        '  可进入场景：',
                        ...scenes.map(
                            (s) =>
                                `  - ${s.uid}：${[s.entry, s.place && `地点：${s.place}`].filter(Boolean).join('；')}${s.focus ? '（生成时的焦点；实际是否到达以正文为准）' : ''}`,
                        ),
                    );
                facts.length && lines.push('  可能发现：', ...facts.map((c) => `  - ${c.fact}${c.record ? `：${c.record}` : ''}`));
            }
            return { text: lines.join('\n') };
        },
    };
    function register() {
        let api = acuApi();
        if (
            (api &&
                typeof api.registerTableUpdateCallback == 'function' &&
                !tableCallback &&
                ((tableCallback = () => ((lastTableUpdate = Date.now()), invalidate('clue-table'))),
                api.registerTableUpdateCallback(tableCallback)),
            registered)
        )
            return;
        if (api && typeof api.registerPlotLinkProvider == 'function')
            try {
                let off = api.registerPlotLinkProvider(provider);
                ((unregister =
                    typeof off == 'function'
                        ? off
                        : () => api.unregisterPlotLinkProvider && api.unregisterPlotLinkProvider(CLUE_PROVIDER_ID)),
                    (registered = !0),
                    note('已向数据库注册剧情联动'));
            } catch (error) {
                note(`注册剧情联动失败：${error.message}`);
            }
    }
    function unregisterAll() {
        let api = acuApi();
        try {
            unregister && unregister();
        } catch {}
        try {
            tableCallback && api && api.unregisterTableUpdateCallback && api.unregisterTableUpdateCallback(tableCallback);
        } catch {}
        ((unregister = null), (tableCallback = null), (registered = !1), pendingPipelines.clear(), wake());
    }
    // 统一的人工写入口：所有人工修改都经过这里，记录来源并锚定当前楼层。
    function act(op) {
        let p = project(),
            prog = getProgress();
        if (!p || !prog) throw new Error('当前项目不是线索模式');
        let ops = addClueOp(clueOps(), chatMessages(), op);
        (setProgress({ ...prog, clue: ops }, 'clue-op'), invalidate(), note(`人工操作：${opLabel(op)}`));
    }
    function opLabel(op) {
        if (op.kind === 'pause') return op.value ? '暂停主线' : '继续主线';
        let names = {
                open: { force: '开放', block: '暂禁', '': '恢复程序判断（开放）' },
                done: { force: '标记完成', undo: '撤销完成', '': '恢复程序判断（完成）' },
                skip: { true: '跳过', '': '取消跳过' },
                focus: { true: '设为焦点', '': '取消焦点' },
                fact: { confirmed: '确认事实', revoked: '撤销事实', '': '恢复表格判断（事实）' },
            },
            label = (names[op.kind] && names[op.kind][String(op.value ?? '')]) || op.kind;
        return op.kind === 'focus' && op.value && op.target.startsWith(AWAY_PREFIX)
            ? `离开调查 ${op.target.slice(AWAY_PREFIX.length)}`
            : `${label} ${op.target}${op.note ? `（${op.note}）` : ''}`;
    }
    // 手动选焦点：必须已开放；越过条件要先用「开放」操作，留下单独记录。
    // 人工记「已离开这个调查」：不再自动聚焦到它，只给入口；之后填表写入新场景、或人工选焦点时恢复。随楼层回滚。
    function leaveScene(uid) {
        if (!uid) return;
        act({ kind: 'focus', target: `${AWAY_PREFIX}${uid}`, value: !0 });
    }
    // 暂停 / 继续主线（日常游玩）：只停注入和前置上下文，进度、表格、人工记录都不动。
    function setPaused(paused) {
        act({ kind: 'pause', target: 'main', value: paused ? !0 : '' });
    }
    function setFocus(uid) {
        let c = compute(),
            s = c && c.state.nodeStates.find((x) => x.node.uid === uid);
        if (uid && (!s || s.status === 'locked' || s.status === 'done' || s.disabled))
            throw new Error('这个节点当前不可进行；需要先满足开放条件，或用「人工开放」');
        act(uid ? { kind: 'focus', target: uid, value: !0 } : { kind: 'focus', target: (c && c.prog.focus) || '', value: '' });
    }
    // 当前聊天实际生效的剧情推进预设里，有没有召回以外的启用任务。读不到就当没有（不提示）。
    function plotConflicts() {
        let api = acuApi();
        try {
            let name = api && typeof api.getCurrentPlotPreset == 'function' ? api.getCurrentPlotPreset() : '';
            if (!name || typeof api.getPlotPresetDetails != 'function') return { preset: name || '', items: [] };
            return { preset: name, items: plotPresetConflicts(api.getPlotPresetDetails(name)) };
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
            linkApi: !!(api && typeof api.registerPlotLinkProvider == 'function'),
            linkVersion: (api && api.plotLinkVersion) || 0,
            queueSignals: hasQueueSignals(),
            registered,
            filling,
            pendingFills: pendingPipelines.size,
            lastFill,
            lastCommit,
            lastTableUpdate,
            tableAgeMs: lastTableUpdate ? Date.now() - lastTableUpdate : null,
            provided,
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
        preTaskContext,
        act,
        setFocus,
        setPaused,
        register,
        stop: unregisterAll,
        diagnose,
        isFilling: () => filling || pendingPipelines.size > 0,
        auditFinalRequest,
        expectFill,
        waitForFill,
        record,
        beginRound,
        ensureRound,
        endRound,
        roundState,
        bindCandidatesToMessage,
        discardPendingCandidates,
        leaveScene,
        candidatesFor,
        provider,
        lastInjected: () => lastInjected,
        onChatChanged() {
            ((lastStatus = null),
                (lastTableUpdate = 0),
                (filling = !1),
                (expectFillUntil = 0),
                pendingPipelines.clear(),
                (pendingCandidates = null),
                (round = null),
                wake(),
                invalidate());
        },
    };
}
