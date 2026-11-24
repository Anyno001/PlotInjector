// 跑团导入审阅的条件检查（跑团判定可见与导入检查计划 3.3 第 1–6 条）。纯逻辑，不碰界面。
//   importFlowIssues：阶段衔接、跨阶段卡死（用推演第二遍：钟点和情况当作已到、被跳过的阶段拿不到发现）。
//   importCondIssues：条件里的线索不存在、时间写法、时间没绑定、条件成环、必需节点只靠判定。
//   applyImportFix：一键修的修改函数，由审阅页放进 editDraft 里调用（可撤销）。
// 问题的 quick / alts 是一键修的数据：{ label, q: { op, ... } }，界面上不出现线索和节点编号。
import { compileClue, conditionRefs } from './trpg-clue-rules.js';
import { clueReachability, discoveryList } from './trpg-clue-project.js';
import { nodeUid } from './trpg-clue-model.js';
import { isPlainObject, stageLabel, stageNodes } from '../core/outline.js';
import { readClock, clockText } from './trpg-timeline.js';
import { GOT_ANYWAY } from './trpg.js';

const itemOf = (n) => (isPlainObject(n.item) ? n.item : {});
const sat = (cond, fn) => !cond || (cond.kind === 'group' ? (cond.mode === 'any' ? cond.items.some((i) => sat(i, fn)) : cond.items.every((i) => sat(i, fn))) : fn(cond));
const isClock = (a) => a.kind === 'time' || a.kind === 'say';
function atomsOf(cond, out = []) {
    cond && (cond.kind === 'group' ? cond.items.forEach((i) => atomsOf(i, out)) : out.push(cond));
    return out;
}
const quote = (names) => names.map((n) => `「${n}」`).join('、');

// 条件里的钟点和「情况」，写成可以放进「任一」的条目
function clockItems(...conds) {
    let out = [],
        seen = new Set();
    for (let a of conds.flatMap((c) => atomsOf(c)).filter(isClock)) {
        let it = a.kind === 'time' ? `时间 ${a.op} ${a.value}` : { 情况: a.text },
            k = normAtom(it);
        seen.has(k) || (seen.add(k), out.push(it));
    }
    return out;
}
// 条件原文里的一项 → [键, 值]
function unatom(s) {
    let m = /^(事实|知情|核实|节点|表|线|情况)\s*[:：]\s*([\s\S]*)$/.exec(s);
    if (m) return [m[1], m[2]];
    m = /^时间\s*([\s\S]*)$/.exec(s);
    return m ? ['时间', m[1]] : null;
}
const atomText = (it) => (typeof it == 'string' ? it : isPlainObject(it) && Object.keys(it).length === 1 ? (Object.keys(it)[0] === '时间' ? `时间 ${it.时间}` : `${Object.keys(it)[0]}: ${Object.values(it)[0]}`) : '');
const normAtom = (it) => atomText(it).replace(/\s+/g, '').replace(/：/g, ':') || JSON.stringify(it);
const isAny = (v) => isPlainObject(v) && Array.isArray(v.任一) && Object.keys(v).length === 1;
const isAll = (v) => isPlainObject(v) && Array.isArray(v.全部) && Object.keys(v).length === 1;
const empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length) || (isPlainObject(v) && !Object.keys(v).length);

function withFallback(orig, items) {
    if (empty(orig)) return orig;
    let have = new Set((isAny(orig) ? orig.任一 : [orig]).map(normAtom)),
        extra = items.filter((it) => !have.has(normAtom(it)));
    return !extra.length ? orig : isAny(orig) ? { 任一: [...orig.任一, ...extra] } : { 任一: [orig, ...extra] };
}
function withAll(orig, items) {
    return empty(orig) ? { 全部: items } : isAll(orig) ? { 全部: [...orig.全部, ...items] } : { 全部: [orig, ...items] };
}

// 条件原文里逐项改写：fn(项的文字) 返回新文字（不变就返回原样）
function mapRaw(raw, fn) {
    if (typeof raw == 'string') return fn(raw);
    if (Array.isArray(raw)) return raw.map((x) => mapRaw(x, fn));
    if (!isPlainObject(raw)) return raw;
    let out = {};
    for (let [k, v] of Object.entries(raw)) {
        if (k === '全部' || k === '任一') out[k] = mapRaw(v, fn);
        else if (typeof v == 'string' && unatom(`${k}${k === '时间' ? ' ' : ':'}${v}`)) {
            let t = k === '时间' ? `时间 ${v}` : `${k}: ${v}`,
                r = fn(t),
                u = r !== t && typeof r == 'string' ? unatom(r) : null;
            u ? (out[u[0]] = u[1]) : (out[k] = v);
        } else out[k] = v;
    }
    return out;
}
// 去掉符合条件的项；整个条件空了返回 undefined
function dropRaw(raw, pred) {
    if (typeof raw == 'string') return pred(raw) ? void 0 : raw;
    if (Array.isArray(raw)) {
        let l = raw.map((x) => dropRaw(x, pred)).filter((x) => x !== void 0);
        return l.length ? l : void 0;
    }
    if (!isPlainObject(raw)) return raw;
    let out = {};
    for (let [k, v] of Object.entries(raw)) {
        if (k === '全部' || k === '任一') {
            let l = dropRaw(v, pred);
            l !== void 0 && (out[k] = l);
        } else if (typeof v == 'string' && pred(k === '时间' ? `时间 ${v}` : `${k}: ${v}`)) continue;
        else out[k] = v;
    }
    return Object.keys(out).length ? out : void 0;
}
const factAtom = (code) => new RegExp(`^(?:事实|核实|知情)\\s*[:：]\\s*${code.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?:\\s*@[\\s\\S]*)?$`);
const STAGE_CONDS = ['进入条件', '结束条件'],
    NODE_CONDS = ['开放条件', '提前条件', '完成条件'];

// ---------------- 一键修 ----------------
export function applyImportFix(volumes, q) {
    let stage = (id) => volumes.flatMap((v) => v.stages).find((s) => s.id === id),
        locate = (uid) => {
            for (let v of volumes) for (let s of v.stages) for (let n of stageNodes(s.data)) if (isPlainObject(n.item) && nodeUid(n.item) === uid) return n.item;
            return null;
        },
        each = (st, fn) => {
            if (!st || !isPlainObject(st.data)) return;
            for (let k of STAGE_CONDS) st.data[k] != null && (st.data[k] = fn(st.data[k]));
            for (let n of stageNodes(st.data)) if (isPlainObject(n.item)) for (let k of NODE_CONDS) n.item[k] != null && (n.item[k] = fn(n.item[k]));
        };
    switch (q.op) {
        case 'fallback':
            for (let { uid, field } of q.nodes || []) {
                let it = locate(uid);
                it && it[field] != null && (it[field] = withFallback(it[field], q.items));
            }
            for (let id of q.ends || []) {
                let st = stage(id);
                st && st.data && st.data.结束条件 != null && (st.data.结束条件 = withFallback(st.data.结束条件, q.items));
            }
            break;
        case 'optional':
            for (let uid of q.nodes || []) {
                let it = locate(uid);
                it && (it.必需 = !1);
            }
            break;
        case 'gate': {
            let st = stage(q.stage);
            st && st.data && (st.data.进入条件 = withAll(st.data.进入条件, q.nodes.map((uid) => ({ 节点: uid }))));
            break;
        }
        case 'rename':
            each(stage(q.stage), (raw) => mapRaw(raw, (t) => (factAtom(q.from).test(t) ? t.replace(q.from, q.to) : t)));
            break;
        case 'drop':
            each(stage(q.stage), (raw) => {
                let r = dropRaw(raw, (t) => factAtom(q.from).test(t));
                return r === void 0 ? raw : r;
            });
            break;
        case 'time':
            each(stage(q.stage), (raw) =>
                mapRaw(raw, (t) => {
                    let m = /^时间\s*([=!<>≥≤＞＜＝]+)\s*([\s\S]+)$/.exec(t);
                    return m && m[2].trim() === q.from ? `时间 ${m[1]} ${q.to}` : t;
                }),
            );
            break;
    }
    return volumes;
}
// 这个修法对草稿有没有实际改动、会不会带来新的编译错误
function worksOn(volumes, q) {
    try {
        let copy = JSON.parse(JSON.stringify(volumes)),
            before = compileClue(copy).errors.length;
        applyImportFix(copy, q);
        return JSON.stringify(copy) !== JSON.stringify(volumes) && compileClue(copy).errors.length <= before;
    } catch {
        return !1;
    }
}
const fixOf = (volumes, label, q) => (worksOn(volumes, q) ? { label, q } : null);

// ---------------- 共用 ----------------
function chainsOf(c) {
    return [c.units.filter((u) => !u.line), ...(c.lines || []).map((l) => l.units || [])].filter((x) => x.length);
}
const shortText = (t, n = 12) => {
    let x = String(t || '').trim().replace(/[。；，、.!！]+$/, '');
    return x.length > n ? `${x.slice(0, n)}…` : x;
};
function factInfo(compiled) {
    let out = new Map();
    for (let n of compiled.nodes)
        for (let d of discoveryList(itemOf(n)))
            d.fact && (out.has(d.fact) ? out.get(d.fact).nodes.push(n) : out.set(d.fact, { text: d.text, nodes: [n], checks: [] }), out.get(d.fact).checks.push(d.check || null));
    return out;
}
const labelOf = (info, labels, code) => (labels && labels[code] && labels[code].label) || shortText(info.get(code) && info.get(code).text) || '一条线索';

// ---------------- 第 1、2 条 + 推演第二遍 ----------------
// 对每个阶段，假设它被时间推过去：钟点和「情况」都已到，它自己的发现一条都没拿到，再看
//   本阶段：必需节点（或结束条件）做不完，而下一阶段已经开始 → 阶段衔接
//   后面的阶段：必需节点开不了或完不成 → 跨阶段卡死
export function importFlowIssues(volumes, { labels = null } = {}) {
    let compiled = compileClue(volumes || []),
        out = [],
        hang = new Map(),
        cross = new Map(),
        info = factInfo(compiled),
        byUid = new Map(compiled.nodes.filter((n) => n.uid).map((n) => [n.uid, n]));
    if (compiled.errors.length && compiled.errors.some((e) => /引用了不存在的节点/.test(e))) return out;
    for (let ch of chainsOf(compiled))
        for (let k = 0; k < ch.length - 1; k++) {
            let cur = ch[k],
                next = ch[k + 1],
                r = clueReachability(volumes, { clock: 'reached', skipGives: (n) => n.unit.id === cur.id }),
                notEntered = (u) => r.stuckStages.some((s) => s.stageId === u.id && /^进不去/.test(s.why)),
                own = r.stuckStages.find((s) => s.stageId === cur.id),
                left = r.stuckNodes.filter((n) => n.stageId === cur.id && byUid.has(n.node));
            if (own && !/^进不去/.test(own.why) && !notEntered(next) && (left.length || /^结束条件不满足/.test(own.why)))
                hang.has(cur.id) || hang.set(cur.id, { cur, next, nodes: left.map((n) => byUid.get(n.node)), end: /^结束条件不满足/.test(own.why) });
            for (let j = k + 1; j < ch.length; j++)
                if (!notEntered(ch[j]))
                    for (let s of r.stuckNodes.filter((n) => n.stageId === ch[j].id && byUid.has(n.node))) {
                        // 只报直接依赖被跳过阶段的节点；后面连带卡住的不再单独报
                        let n0 = byUid.get(s.node),
                            refs = conditionRefs(/^一直打不开/.test(s.why) ? n0.open : n0.done);
                        if (
                            ![...refs.facts].some((f) => info.has(f) && info.get(f).nodes.every((x) => x.unit === cur)) &&
                            ![...refs.nodes].some((id) => byUid.has(id) && byUid.get(id).unit === cur)
                        )
                            continue;
                        let e = cross.get(s.node) || { node: byUid.get(s.node), skipped: [], locked: !1 };
                        (e.skipped.includes(cur) || e.skipped.push(cur), (e.locked = e.locked || /^一直打不开/.test(s.why)), cross.set(s.node, e));
                    }
        }
    for (let { cur, next, nodes, end } of hang.values()) {
        let hasDone = nodes.filter((n) => n.done),
            items = clockItems(cur.clue.end).length ? clockItems(cur.clue.end) : clockItems(next.clue.enter),
            names = nodes.map((n) => n.name || '一个节点'),
            ends = end && cur.clue.end ? [cur.id] : [],
            opt = [
                nodes.length ? fixOf(volumes, '把这些节点改为可选', { op: 'optional', nodes: nodes.filter((n) => n.uid).map((n) => n.uid) }) : null,
                nodes.length && next.clue.hasEnter ? fixOf(volumes, `让「${stageLabel(next.stage.key)}」要等这些节点做完`, { op: 'gate', stage: next.id, nodes: nodes.filter((n) => n.uid).map((n) => n.uid) }) : null,
            ].filter(Boolean),
            main = items.length ? fixOf(volumes, '补上时间兜底', { op: 'fallback', items, nodes: hasDone.filter((n) => n.uid).map((n) => ({ uid: n.uid, field: '完成条件' })), ends }) : null,
            prev = stageLabel(cur.stage.key);
        out.push({
            level: 'error',
            kind: 'gap',
            name: 'gap',
            stage: prev,
            stageId: cur.id,
            nodeIds: nodes.map((n) => n.uid).filter(Boolean),
            text: `阶段衔接：${stageLabel(next.stage.key)}不必等${prev}结束就能开始，但${prev}${nodes.length ? `的${quote(names)}` : '的结束条件'}只认线索`,
            plain: `「${stageLabel(next.stage.key)}」不必等「${prev}」结束就能开始，但「${prev}」${nodes.length ? `的${quote(names)}` : '的结束条件'}只认线索；剧情跳过${nodes.length ? '它们' : '这些线索'}时，「${prev}」会一直显示进行中。`,
            fix: items.length ? '给它们补上时间或情节的兜底，剧情推过去时也算完成。' : '给它们加上别的出路，或改为可选。',
            ...(main ? { quick: main } : {}),
            ...(opt.length ? { alts: opt } : {}),
        });
    }
    // 跨阶段：按「所在阶段」归并，一张卡
    let byStage = new Map();
    for (let e of cross.values()) {
        let u = e.node.unit;
        byStage.set(u.id, [...(byStage.get(u.id) || []), e]);
    }
    for (let [id, list] of byStage) {
        let u = list[0].node.unit,
            skipped = [...new Set(list.flatMap((e) => e.skipped.map((s) => stageLabel(s.stage.key))))],
            items = clockItems(u.clue.enter),
            nodes = list.filter((e) => e.node.uid),
            names = list.map((e) => e.node.name || '一个节点'),
            main = items.length
                ? fixOf(volumes, '补上本阶段的进入兜底', { op: 'fallback', items, nodes: nodes.map((e) => ({ uid: e.node.uid, field: e.locked ? '开放条件' : '完成条件' })) })
                : null;
        out.push({
            level: 'error',
            kind: 'skip-stuck',
            name: 'skip',
            stage: stageLabel(u.stage.key),
            stageId: id,
            nodeIds: nodes.map((e) => e.node.uid),
            text: `跨阶段卡死：${skipped.join('、')}被时间推过去时，${stageLabel(u.stage.key)}的${names.join('、')}开不了或完不成`,
            plain: `如果剧情被时间推着走、跳过了「${skipped.join('」「')}」，「${stageLabel(u.stage.key)}」的${quote(names)}就${list.some((e) => e.locked) ? '一直开不了' : '完不成'}：它们要的线索只在前面的阶段产出，而本阶段到时间就会开始。`,
            fix: items.length ? '给它们补上本阶段的进入兜底，到点就放行。' : '让它们也能靠别的途径开放。',
            ...(main ? { quick: main } : {}),
        });
    }
    return out;
}

// ---------------- 第 3、5、6 条 ----------------
function editDistance(a, b) {
    let d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
    for (let j = 1; j <= b.length; j++) d[0][j] = j;
    for (let i = 1; i <= a.length; i++)
        for (let j = 1; j <= b.length; j++) d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    return d[a.length][b.length];
}
const CN = { 零: 0, 〇: 0, 一: 1, 二: 2, 两: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
function cnInt(s) {
    if (/^\d+$/.test(s)) return +s;
    if (s.length === 1 && s in CN) return CN[s];
    let m = /^([一二两三四五六七八九])?十([一二三四五六七八九])?$/.exec(s);
    return m ? (m[1] ? CN[m[1]] : 1) * 10 + (m[2] ? CN[m[2]] : 0) : null;
}
// 「晚上七点半」「19点30」→「19:30」；读不出来返回 null
export function guessClock(text) {
    let m = /^(凌晨|清晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|夜晚|深夜)?\s*(\d{1,2}|[零〇一二两三四五六七八九十]{1,3})\s*(?:[:：]|点|时)\s*(半|整|\d{1,2}|[零〇一二三四五六七八九十]{1,3})?\s*分?\s*$/.exec(String(text || '').trim());
    if (!m) return null;
    let h = cnInt(m[2]),
        mm = m[3] === '半' ? 30 : !m[3] || m[3] === '整' ? 0 : cnInt(m[3]);
    if (h == null || mm == null || h > 24 || mm > 59) return null;
    let v = readClock(`${m[1] || ''}${h}:${String(mm).padStart(2, '0')}`);
    return v == null ? null : clockText(v);
}
// 依赖：条件成立必须先有的节点（任一取交集，全部取并集；线索按唯一的产出节点算）
function mustNodes(cond, producers, mode) {
    if (!cond) return new Set();
    if (cond.kind === 'group') {
        let sets = cond.items.map((i) => mustNodes(i, producers, mode));
        return cond.mode === 'any' ? sets.reduce((a, b) => new Set([...a].filter((x) => b.has(x))), sets[0] || new Set()) : new Set(sets.flatMap((s) => [...s]));
    }
    if (cond.kind === 'node') return new Set([cond.node]);
    if (mode === 'open' && cond.kind === 'fact') {
        let p = producers.get(cond.fact);
        return p && p.size === 1 ? new Set(p) : new Set();
    }
    return new Set();
}
function findCycles(edges) {
    let out = [],
        seen = new Set(),
        state = new Map();
    let visit = (u, path) => {
        state.set(u, 1);
        for (let v of edges.get(u) || []) {
            if (state.get(v) === 1) {
                let cyc = path.slice(path.indexOf(v));
                cyc.length > 1 && !seen.has([...cyc].sort().join()) && (seen.add([...cyc].sort().join()), out.push(cyc));
            } else if (!state.has(v)) visit(v, [...path, v]);
        }
        state.set(u, 2);
    };
    for (let u of edges.keys()) state.has(u) || visit(u, [u]);
    return out;
}

export function importCondIssues(volumes, { only = null, labels = null, timeBound = !0 } = {}) {
    let compiled = compileClue(volumes || []),
        info = factInfo(compiled),
        out = [],
        mine = (u) => !only || only.has(u.id),
        produced = new Set(info.keys());
    for (let l of compiled.lines || []) {
        conditionRefs(l.open).facts.forEach((f) => produced.add(f));
        l.legacyFact && produced.add(l.legacyFact);
    }
    let nearest = (code) =>
        [...info.keys()]
            .map((f) => [f, editDistance(code.toLowerCase(), f.toLowerCase())])
            .filter(([, d]) => d <= Math.max(2, Math.floor(code.length / 3)))
            .sort((a, b) => a[1] - b[1])
            .slice(0, 3)
            .map(([f]) => f);
    let draftVols = volumes || [];
    for (let u of compiled.units.filter(mine)) {
        let where = new Map(),
            times = new Map(),
            spots = [
                ['本阶段的进入条件', u.clue.enter],
                ['本阶段的结束条件', u.clue.end],
                ...compiled.nodes.filter((n) => n.unit === u).flatMap((n) => [['开放条件', n.open], ['提前条件', n.early], ['完成条件', n.done]].map(([w, c]) => [`节点「${n.name}」的${w}`, c])),
            ];
        for (let [place, c] of spots) {
            for (let f of conditionRefs(c).facts) produced.has(f) || where.set(f, [...(where.get(f) || []), place]);
            for (let a of atomsOf(c).filter((x) => x.kind === 'time' && ['==', '!=', '>=', '<=', '>', '<'].includes(x.op) && !/^\d{1,2}[:：]\d{2}$/.test(String(x.value).trim())))
                times.set(a.value, [...(times.get(a.value) || []), place]);
        }
        for (let [code, ws] of where) {
            let near = nearest(code),
                alts = near.map((f) => fixOf(draftVols, `改成「${labelOf(info, labels, f)}」`, { op: 'rename', stage: u.id, from: code, to: f })).filter(Boolean),
                drop = fixOf(draftVols, '去掉这一项', { op: 'drop', stage: u.id, from: code }),
                place = [...new Set(ws)].join('、');
            out.push({
                level: 'error',
                kind: 'orphan',
                name: code,
                stage: stageLabel(u.stage.key),
                stageId: u.id,
                text: `条件用到了没有任何节点产出的线索：${stageLabel(u.stage.key)}，${place}`,
                plain: `「${stageLabel(u.stage.key)}」里，${place}要一条找不到的线索：没有任何节点产出它，玩家永远拿不到。`,
                fix: near.length ? `是不是写错了？最接近的是${near.map((f) => `「${labelOf(info, labels, f)}」`).join('、')}。` : '补上产出它的节点，或把这一项从条件里去掉。',
                ...(alts[0] ? { quick: alts[0] } : {}),
                ...([...alts.slice(1), ...(drop ? [drop] : [])].length ? { alts: [...alts.slice(1), ...(drop ? [drop] : [])] } : {}),
            });
        }
        for (let [val, ws] of times) {
            let to = guessClock(val),
                fx = to ? fixOf(draftVols, `改成${to}`, { op: 'time', stage: u.id, from: String(val).trim(), to }) : null;
            out.push({
                level: 'warn',
                kind: 'time-format',
                name: String(val),
                stage: stageLabel(u.stage.key),
                stageId: u.id,
                text: `时间写法读不出钟点：${stageLabel(u.stage.key)}，${[...new Set(ws)].join('、')}写了「${val}」`,
                plain: `「${stageLabel(u.stage.key)}」里，${[...new Set(ws)].join('、')}把时间写成了「${val}」，插件按钟点比较，读不出来。`,
                fix: to ? `应写成${to}这样的钟点。` : '请写成19:30这样的钟点。',
                ...(fx ? { quick: fx } : {}),
            });
        }
    }
    // 条件里用到了时间，但项目没有绑定故事时间的那一格
    if (!timeBound) {
        let u = compiled.units.filter(mine).find((x) => atomsOfUnit(x, compiled).some((a) => a.kind === 'time'));
        u &&
            out.push({
                level: 'warn',
                kind: 'time-unbound',
                name: 'time-unbound',
                stage: stageLabel(u.stage.key),
                stageId: u.id,
                text: '条件里用到了时间，但项目还没有绑定故事时间',
                plain: '条件里用到了时间，可项目还没有绑定故事时间所在的那一格，时间条件会一直算不出来。',
                fix: '保存到模组后，到执行页的「表格绑定」里填上故事时间。',
                action: { label: '去设置', act: 'rv-bind' },
            });
    }
    // 条件成环：开放条件（节点和唯一产出线索的节点）、完成条件（节点）各查一遍
    let producers = new Map([...info].map(([f, v]) => [f, new Set(v.nodes.map((n) => n.uid).filter(Boolean))])),
        nameOf = new Map(compiled.nodes.filter((n) => n.uid).map((n) => [n.uid, n])),
        seenCycle = new Set();
    for (let mode of ['open', 'done']) {
        let edges = new Map();
        for (let n of compiled.nodes.filter((x) => x.uid)) edges.set(n.uid, [...mustNodes(mode === 'open' ? n.open : n.done, producers, mode)].filter((x) => x !== n.uid && nameOf.has(x)));
        for (let cyc of findCycles(edges)) {
            let key = [...cyc].sort().join();
            if (seenCycle.has(key)) continue;
            seenCycle.add(key);
            let ns = cyc.map((x) => nameOf.get(x)),
                units = [...new Set(ns.map((n) => n.unit))];
            if (only && !units.some(mine)) continue;
            out.push({
                level: 'warn',
                kind: 'cycle',
                name: key,
                stageIds: units.map((x) => x.id),
                stageId: units.find(mine) ? units.find(mine).id : units[0].id,
                nodeIds: cyc,
                text: `节点条件成环：${ns.map((n) => n.name).join('、')}`,
                plain: `${quote(ns.map((n) => n.name))}互相等对方${mode === 'open' ? '开放' : '完成'}，谁也等不到，这几个节点都不会走通。`,
                fix: '改掉其中一个节点的条件，让它不必等另一个。',
            });
        }
    }
    // 开放条件要等同一条线里更靠后的阶段才产出的线索或节点
    let chainOfUnit = new Map(chainsOf(compiled).flatMap((ch) => ch.map((u, i) => [u.id, { ch, i }])));
    for (let n of compiled.nodes.filter((x) => x.uid && x.open && mine(x.unit))) {
        let at = chainOfUnit.get(n.unit.id),
            laters = [...mustNodes(n.open, producers, 'open')].map((id) => nameOf.get(id)).filter((d) => d && d !== n && chainOfUnit.get(d.unit.id) && chainOfUnit.get(d.unit.id).ch === at.ch && chainOfUnit.get(d.unit.id).i > at.i);
        laters.length &&
            out.push({
                level: 'warn',
                kind: 'later-stage',
                name: n.uid,
                stage: stageLabel(n.unit.stage.key),
                stageId: n.unit.id,
                nodeIds: [n.uid],
                text: `开放条件要等后面阶段的内容：${n.name}`,
                plain: `「${n.name}」在「${stageLabel(n.unit.stage.key)}」，开放条件却要等${quote([...new Set(laters.map((d) => stageLabel(d.unit.stage.key)))])}才产出的内容，到那时这个阶段早就过去了。`,
                fix: '看看这个节点的开放条件是不是写错了线索。',
            });
    }
    // 必需节点的完成条件只能靠判定拿线索，而判定失败又没写照样拿到
    for (let n of compiled.nodes.filter((x) => x.required && x.done && mine(x.unit))) {
        let free = (f) => {
            let v = info.get(f);
            return !v || v.checks.some((c) => !c || (c.fail && GOT_ANYWAY.test(c.fail)));
        };
        sat(n.done, (a) => (a.kind === 'fact' ? free(a.fact) : !0)) ||
            out.push({
                level: 'warn',
                kind: 'judge-only',
                name: n.uid || n.name,
                stage: stageLabel(n.unit.stage.key),
                stageId: n.unit.id,
                nodeIds: [n.uid].filter(Boolean),
                text: `必需节点只靠判定：${n.name}`,
                plain: `「${n.name}」必须完成，它的完成条件却只能靠要掷骰的线索；判定失败又没写「仍然得到」的话，就会一直卡在这里。`,
                fix: '给判定写上失败时也能拿到线索的情形，或在完成条件里加上别的出路。',
            });
    }
    return out;
}
const atomsOfUnit = (u, compiled) => [u.clue.enter, u.clue.end, ...compiled.nodes.filter((n) => n.unit === u).flatMap((n) => [n.open, n.early, n.done])].flatMap((c) => atomsOf(c));
