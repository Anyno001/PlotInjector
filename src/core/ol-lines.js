import { isPlainObject, stageNodes } from './outline.js';
import { compileClue, evalCondition, effectiveFact, resolveLineWindow, TRI } from './clue-rules.js';
import { discoveryList, clueText } from './clue-project.js';
import { normalizeClueOps, effectiveClueProgress } from './clue-progress.js';
import { unitStates, offNodes, STATES } from './progress.js';
import { NO_LINKS } from './align.js';

// 大纲推进的多条剧情线（大型项目方案 五）：几条线预先写好，按触发条件分别开始，同一时间只演一条。
// 所有线一视同仁（不分主线 / 支线）；「接上一条」= 大纲里的前一条线结束（完成或放弃）。
// 进度：progress.lines[线编号] = { at: 线内当前阶段id, passed? }；开始 / 暂停 / 完成 / 放弃 / 还原记在
// progress.olOps（带楼层锚点，删楼、重 roll 一起撤回）；progress.current 始终是进行中那条线的当前阶段。
// progress.lineFlow === 'seq'：本聊天按顺序推进（兜底），整本当一条线，和老版本一样。

export const OL_ENDED = ['完成', '放弃'];

// 开启条件写成一句话（不是 事实 / 节点 / 线 / 表 这些写法）：交给定期检测判断，确认后记成编号「句：原话」
const SENTENCE_ID = '句：';
const KEYWORD = /^(事实|知情|核实|节点|表|时间|线|计数)\s*[:：]/;
function sentenceize(cond) {
    if (!cond) return cond;
    if (cond.kind === 'group') return { ...cond, items: cond.items.map(sentenceize) };
    let raw = String(cond.raw || '').trim();
    return cond.kind === 'bad' && raw.length >= 4 && !KEYWORD.test(raw) ? { kind: 'fact', fact: SENTENCE_ID + raw, raw } : cond;
}
function atomsOf(cond, out = []) {
    if (!cond) return out;
    if (cond.kind === 'group') return (cond.items.forEach((c) => atomsOf(c, out)), out);
    return (out.push(cond), out);
}
// 原因里的「尚无记录」在大纲推进里是在等检测确认
const waitWhy = (text) => String(text || '').replace(/ ?尚无记录/g, '，等待检测确认').split(SENTENCE_ID).join('');
const truthy = (v) => v === !0 || v === 'true' || v === '是';

// 这个项目的大纲推进是否按线：大纲写了 `线:`，并且本聊天没改成按顺序。
export function olByLine(volumes, progress) {
    if (progress && progress.lineFlow === 'seq') return !1;
    return (volumes || []).some((v) => isPlainObject(v.line));
}

// 大纲推进的线一视同仁：开启时段可以引用任何一条线（线索模式只认主线，那边不变）
// 界面上的线名：编号 + 名称，去掉卷名里的「卷N」和「·」（和执行页剧情线卡一样）
export function olShowName(l) {
    let name = String((l && l.name) || '').replace(/·/g, ' ');
    l && l.id && (name = name.replace(/^卷[^\s]*\s+/, ''));
    return l && l.id && !name.startsWith(l.id) ? `${l.id} ${name}` : name;
}
export function olLines(volumes) {
    let lines = compileClue(volumes || []).lines || [];
    for (let l of lines) {
        let raw = isPlainObject(l.volume.line) ? l.volume.line.开启时段 : null;
        if (!l.window || !l.window.bad || !isPlainObject(raw)) continue;
        let errs = [],
            w = resolveLineWindow(raw, lines.map((x) => ({ ...x, kind: 'main' })), errs);
        w && !w.bad && (l.window = w);
    }
    return lines;
}

// 节点是否已演（大纲推进按阶段的取消勾选记）：uid 是节点的稳定 id。
function nodeDoneIn(lines, progress, links) {
    let byUid = new Map();
    for (let l of lines)
        for (let u of l.units)
            for (let n of stageNodes(u.stage.data)) isPlainObject(n.item) && n.item.id && byUid.set(String(n.item.id), { u, n });
    return (uid) => {
        let hit = byUid.get(String(uid));
        return hit ? new Set(offNodes(progress, hit.u, links)).has(hit.n.id) : void 0;
    };
}

// 每条线的状态。env0：{ facts, knowledge, tables, factOverrides, timePath }（读不到表时都可以缺省，表格条件就是未知）。
// 返回 [{ line, state, started, eligible, why, at, auto, missed, ever }]，按大纲顺序。
// 状态：已过（迁移标记）/ 完成 / 放弃 / 暂停 / 进行中 / 可开启 / 未触发；同时最多一条进行中。
export function olLineStates(lines, progress, chat, env0 = {}, links = NO_LINKS) {
    let prog = progress || {},
        recs = isPlainObject(prog.lines) ? prog.lines : {},
        eff = effectiveClueProgress(normalizeClueOps(prog.olOps), chat),
        ops = eff.lines,
        memo = new Map(),
        visiting = new Set(),
        forced = '',
        nodeDone = nodeDoneIn(lines, prog, links),
        byId = new Map(lines.map((l) => [l.id, l])),
        env = { facts: new Map(), knowledge: [], tables: {}, ...env0, factOverrides: { ...(env0.factOverrides || {}), ...eff.factOverrides }, nodeDone, lineState: (id) => (byId.has(id) ? (stateOf(byId.get(id)) || { state: null }).state : void 0), lineStarted: (id) => !!(ops[id] && ops[id].started) };
    function atOf(l) {
        let rec = recs[l.id] || {},
            ids = l.units.map((u) => u.id);
        return ids.includes(prog.current) ? prog.current : ids.includes(rec.at) ? rec.at : '';
    }
    function windowOf(l) {
        let w = l.window;
        if (!w) return { v: TRI.t, reasons: [] };
        if (w.bad) return { v: TRI.u, reasons: [`开启时段写得不对：${w.bad}`] };
        let ref = byId.get(w.main),
            rs = ref ? stateOf(ref) : null;
        if (!rs) return { v: TRI.u, reasons: [`线${w.main}的状态无法判断`] };
        if (OL_ENDED.includes(rs.state) || rs.state === '已过') return { v: TRI.f, missed: !0, reasons: [`开启时段已过（${w.main}已结束）`] };
        if (!rs.started) return { v: TRI.f, reasons: [`要等${w.main}开始`] };
        let ids = ref.units.map((u) => u.id),
            pos = ids.indexOf(rs.at),
            from = w.from ? ids.indexOf(w.from) : -1,
            to = w.to ? ids.indexOf(w.to) : -1;
        return from >= 0 && pos < from
            ? { v: TRI.f, reasons: [`要等${w.main}进入「${w.fromLabel}」`] }
            : to >= 0 && pos > to
              ? { v: TRI.f, missed: !0, reasons: [`开启时段已过（${w.main}的「${w.toLabel}」已经结束）`] }
              : { v: TRI.t, reasons: [] };
    }
    function stateOf(l) {
        if (memo.has(l.id)) return memo.get(l.id);
        if (visiting.has(l.id)) return null;
        visiting.add(l.id);
        let man = ops[l.id] || {},
            rec = recs[l.id] || {},
            at = atOf(l),
            began = !!man.started || !!rec.mig || l.id === forced,
            r = { line: l, state: '未触发', started: began, eligible: !1, why: '', at, auto: !1, missed: !1, ever: began };
        if (rec.passed && !man.state && !man.started) r.state = '已过';
        else if (man.state === 'abandon') r.state = '放弃';
        else if (man.state === 'done') r.state = '完成';
        else if (man.state === 'pause' && began) r.state = '暂停';
        else if (began) r.state = '进行中';
        else {
            let k = lines.indexOf(l),
                prev = k > 0 ? lines[k - 1] : null,
                after = isPlainObject(l.volume.line) && truthy(l.volume.line.接上一条),
                ps = after && prev ? stateOf(prev) : null,
                cond = evalCondition(sentenceize(l.open), env),
                win = windowOf(l),
                prevOk = !after || !prev || (ps && OL_ENDED.includes(ps.state));
            r.eligible = cond.v === TRI.t && win.v === TRI.t && prevOk;
            r.missed = !!win.missed;
            r.why = !prevOk ? `排在${prev.id}后面，要等它结束` : waitWhy([...cond.reasons, ...win.reasons].filter(Boolean).join('；'));
            r.state = r.eligible ? '可开启' : '未触发';
            r.after = after;
        }
        return (visiting.delete(l.id), memo.set(l.id, r), r);
    }
    let all = () => lines.map((l) => stateOf(l) || { line: l, state: '未触发', started: !1, eligible: !1, why: '线之间循环引用', at: '', auto: !1, missed: !1 }),
        list = all();
    // 没有线在进行时自动开始：接上一条的线；或者整局还没开始过时，第一条满足条件的线（新开局从头演，和以前一样）。
    // 自动开始的线当作已开始重算一遍，别的线读到的「线 M1 == 进行中」才对。
    if (!list.some((s) => s.state === '进行中')) {
        let fresh = !list.some((s) => s.ever || s.state === '已过'),
            pick = list.find((s) => s.state === '可开启' && (s.after || (fresh && s.line.mode !== 'manual')));
        if (pick) {
            let why = pick.after ? '前一条线已结束，自动开始' : '开局自动开始';
            ((forced = pick.line.id), memo.clear(), (list = all()));
            Object.assign(list.find((s) => s.line.id === forced), { auto: !0, why });
        }
    }
    // 进行中但还没记过位置（新开局）：从第一段开始
    for (let x of list) x.state === '进行中' && !x.at && x.line.units.length && (x.at = x.line.units[0].id);
    return list;
}

// 定期检测要顺带确认的事（方案 五.4）：还没开始的线，开启条件里没有记录的事实和一句话条件。
// 说明只用公开的：线索标签和登记口径、节点发现里的登记说明、线的开始时机原文；一句话条件就是作者的原话。没有说明的事实不带。
// 开启条件其余部分都满足的线排前面；每次最多 limit 条，按 turn 轮流。返回 [{ id, text, line }]。
export function olPendingFacts(lines, lineStates, progress, chat, env0 = {}, { labels = {}, limit = 10, turn = 0 } = {}) {
    let eff = effectiveClueProgress(normalizeClueOps((progress || {}).olOps), chat),
        env = { facts: new Map(), ...env0, factOverrides: { ...(env0.factOverrides || {}), ...eff.factOverrides } },
        record = new Map(),
        out = [],
        seen = new Set();
    for (let l of lines)
        for (let u of l.units)
            for (let n of stageNodes(u.stage.data))
                for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) d.fact && d.record && !record.has(d.fact) && record.set(d.fact, clueText(d.record));
    for (let s of lineStates || []) {
        if (s.state !== '未触发' || s.missed || !s.line.open) continue;
        let raw = isPlainObject(s.line.volume.line) ? s.line.volume.line : {},
            origin = clueText(raw.开始时机原文) || clueText(s.line.origCond),
            cond = sentenceize(s.line.open),
            mine = atomsOf(cond).filter((a) => a.kind === 'fact' && effectiveFact(a.fact, { facts: env.facts }, { factOverrides: env.factOverrides }).v === TRI.u);
        if (!mine.length) continue;
        let assume = { ...env, factOverrides: { ...env.factOverrides, ...Object.fromEntries(mine.map((a) => [a.fact, { status: 'confirmed' }])) } },
            prio = evalCondition(cond, assume).v === TRI.t;
        for (let a of mine) {
            if (seen.has(a.fact)) continue;
            let lab = isPlainObject(labels[a.fact]) ? labels[a.fact] : {},
                text = a.fact.startsWith(SENTENCE_ID)
                    ? a.fact.slice(SENTENCE_ID.length)
                    : clueText(lab.criterion) || record.get(a.fact) || clueText(lab.label) || (origin ? `（${s.line.id}的开启时机）${origin}` : '');
            text && (seen.add(a.fact), out.push({ id: a.fact, text, line: s.line.id, prio }));
        }
    }
    out.sort((a, b) => Number(b.prio) - Number(a.prio));
    if (out.length <= limit) return out;
    let start = (turn * limit) % out.length;
    return [...out, ...out].slice(start, start + limit);
}

// 给注入、检测用的阶段状态（和 unitStates 同形）：进行中的线按当前阶段位置推；
// 其他线：迁移来的已过整条算已过；完成、放弃、暂停的按实际演到的位置——当前阶段之前算已过，
// 演到最后一段才完成的连最后一段也算（提前「标记完成」不让没演到的阶段算发生）；没开始的算未到。
// 别的线上手动标的「进行中 / 下一段」不生效（同一时间只演一条），手动标的「已过」照旧。
export function olUnitStates(units, progress, lineStates, links = NO_LINKS) {
    let out = {},
        slots = (progress && progress.slots) || {},
        manual = (id) => (slots[id] && STATES.includes(slots[id].state) ? slots[id].state : ''),
        seen = new Set();
    for (let s of lineStates || []) {
        let ids = s.line.units.map((u) => u.id);
        ids.forEach((id) => seen.add(id));
        if (s.state === '进行中') {
            let own = units.filter((u) => ids.includes(u.id)),
                st = unitStates(own, { ...progress, current: s.at || ids[0] }, links);
            Object.assign(out, st);
            continue;
        }
        let pos = ids.indexOf(s.at),
            last = ids.length - 1;
        for (let [i, id] of ids.entries()) {
            let played = pos >= 0 && (i < pos || (s.state === '完成' && pos === last && i === last)),
                d = s.state === '已过' || (['完成', '放弃', '暂停'].includes(s.state) && played) ? 'done' : 'todo',
                m = manual(id);
            out[id] = m === 'done' || m === 'todo' ? m : d;
        }
    }
    for (let u of units) seen.has(u.id) || (out[u.id] = manual(u.id) || 'todo');
    return out;
}

// 跟随大纲的人设看「已到达」：暂停、放弃、完成的线，停下的那一段也算到达过
export function olReachedStates(ov) {
    if (!ov) return null;
    let out = { ...ov.states };
    for (let s of ov.ls) ['暂停', '放弃', '完成'].includes(s.state) && s.at && out[s.at] === 'todo' && (out[s.at] = 'active');
    return out;
}

// 检测索引里别的线各一行；暂停和结束的最多列 5 条，其余写「另有 N 条」
export function olOtherLinesText(lineStates, current) {
    let rows = [],
        label = (s) => {
            let k = s.line.units.findIndex((u) => u.id === s.at);
            return s.state === '暂停' && k >= 0 ? `暂停在第${k + 1}段` : s.state === '可开启' ? '可开始' : s.state === '未触发' ? '未开始' : s.state;
        },
        others = (lineStates || []).filter((s) => s !== current),
        shown = 0,
        hidden = 0;
    for (let s of others) {
        let capped = ['暂停', '完成', '放弃', '已过'].includes(s.state);
        if (capped && shown >= 5) {
            hidden++;
            continue;
        }
        capped && shown++;
        rows.push(`- ${s.line.id} ${s.line.name}：${label(s)}`);
    }
    hidden && rows.push(`- 另有 ${hidden} 条已暂停或已结束`);
    return rows.length ? ['【其他剧情线】', ...rows].join('\n') : '';
}
