import { countRows, pickEntry, tierCompare, findSheet, tierOrderInNote, cellText, sameValue, readCell } from './clue-tables.js';

import { splitStageKey, volumeLabel, isPlainObject, flattenUnits, stageLabel, stageNodes } from './outline.js';

import { clueText, discoveryList } from './clue-project.js';

import { nodeUid, DEFAULT_CLUE } from './clue-model.js';

export const COND_MAX_DEPTH = 2;

export const ATOM_KEYS = ['事实', '知情', '核实', '节点', '表', '时间', '线'];

export const TRI = { t: 'true', f: 'false', u: 'unknown' };

export function atomString(key, value) {
    let v = String(value ?? '').trim();
    return key === '时间' ? `时间 ${v}` : `${key}: ${v}`;
}

// 列名、行名里常有 <user> 这类标签：拆比较符号前先换成占位，免得其中的 < > 被当成比较符号
// （实测 2026-11-17：「重要角色表/彼得·帕克/对<user>阶段 >= 信任」被拆成列「对」、值「user>阶段 >= 信任」）。
const TAG_RE = /<[A-Za-z_][\w-]*>/g;
export function splitCompare(text, re) {
    let tags = [],
        masked = String(text ?? '').replace(TAG_RE, (t) => (tags.push(t), `\u0000${tags.length - 1}\u0000`)),
        m = re.exec(masked);
    return m && [...m].map((x) => (x == null ? x : x.replace(/\u0000(\d+)\u0000/g, (_, i) => tags[+i])));
}

export function parseAtom(text) {
    let raw = String(text || '').trim(),
        m;
    if (
        ((m = /^<if\s+cell\s*=\s*["“]([^"”]+)["”]\s*>?/i.exec(raw)) && (raw = `表: ${m[1].trim()}`),
        (raw = normalizeOps(raw)),
        (m = /^事实\s*[:：]\s*(\S+)$/.exec(raw)))
    )
        return { kind: 'fact', fact: m[1], raw };
    if ((m = /^核实\s*[:：]\s*([^@\s]+)$/.exec(raw))) return { kind: 'fact', fact: m[1], verified: !0, raw };
    if ((m = /^(知情|核实)\s*[:：]\s*([^@\s]+)\s*@\s*(.+)$/.exec(raw)))
        return { kind: 'know', fact: m[2], actor: m[3].trim(), verified: m[1] === '核实', raw };
    if ((m = /^节点\s*[:：]\s*(\S+)$/.exec(raw))) return { kind: 'node', node: m[1], raw };
    if ((m = splitCompare(raw, /^表\s*[:：]\s*(.+?)\s*(==|!=|>=|<=|>|<|不包含|包含)\s*(.*)$/)))
        return { kind: 'cell', path: m[1].trim(), op: m[2], value: m[3].trim(), raw };
    if ((m = /^时间\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(raw))) return { kind: 'time', op: m[1], value: m[2].trim(), raw };
    if ((m = /^线\s*[:：]\s*(\S+?)\s*(==|!=)\s*(\S+)$/.exec(raw))) {
        let state = m[3].trim();
        return LINE_STATES.includes(state) || LINE_STATE_ALIAS[state]
            ? { kind: 'line', line: m[1], op: m[2], state, raw }
            : {
                  kind: 'bad',
                  raw,
                  error: `线的状态「${state}」不认识，可以写：${[...LINE_STATES, ...Object.keys(LINE_STATE_ALIAS)].join('、')}`,
              };
    }
    return { kind: 'bad', raw, error: `无法识别的条件「${raw}」` };
}

export function parseCondition(value, errors = [], depth = 0) {
    if (value == null || value === '' || (Array.isArray(value) && !value.length) || (isPlainObject(value) && !Object.keys(value).length))
        return null;
    if (typeof value == 'string') {
        let atom = parseAtom(value);
        return (atom.kind === 'bad' && errors.push(atom.error), atom);
    }
    let mode = 'all',
        items;
    if (isPlainObject(value) && Object.keys(value).length === 1 && value.计数 !== void 0) return parseCountAtom(value.计数, errors);
    if (
        isPlainObject(value) &&
        value.表 !== void 0 &&
        Object.keys(value).length > 1 &&
        Object.keys(value).every((k) => CELL_EXTRA_KEYS.includes(k))
    )
        return parseCellExtra(value, errors);
    if (isPlainObject(value)) {
        let keys = Object.keys(value),
            atoms = keys.filter((key) => ATOM_KEYS.includes(key));
        if (atoms.length && atoms.length === keys.length) {
            let list = atoms.map((key) => atomString(key, value[key]));
            if (list.length === 1) return parseCondition(list[0], errors, depth);
            value = list;
        }
    }
    if (Array.isArray(value)) items = value;
    else if (isPlainObject(value) && Array.isArray(value.全部) && Object.keys(value).length === 1) items = value.全部;
    else if (isPlainObject(value) && Array.isArray(value.任一) && Object.keys(value).length === 1) ((mode = 'any'), (items = value.任一));
    else return (errors.push(`无法识别的条件结构：${JSON.stringify(value).slice(0, 60)}`), { kind: 'bad', raw: '', error: '结构错误' });
    return depth >= COND_MAX_DEPTH
        ? (errors.push('条件嵌套超过两层'), { kind: 'bad', raw: '', error: '嵌套过深' })
        : { kind: 'group', mode, items: items.map((item) => parseCondition(item, errors, depth + 1)).filter(Boolean) };
}

export function digitsOf(text) {
    return (String(text).match(/\d+/g) || []).map(Number);
}

export function compareValues(a, b) {
    let na = Number(cellText(a)),
        nb = Number(cellText(b));
    if (cellText(a) !== '' && cellText(b) !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    let da = digitsOf(a),
        db = digitsOf(b);
    if (!da.length || !db.length) return null;
    for (let i = 0; i < Math.max(da.length, db.length); i += 1) {
        let x = da[i] ?? 0,
            y = db[i] ?? 0;
        if (x !== y) return x - y;
    }
    return 0;
}

// 「编号 + 档位名」的格子（如「3 信任」「2 熟悉」，用户的卡 2026-11-17）：条件写整数时按编号比，「== 3」成立。
// 只认「整数、空格、汉字开头的名字」这一种写法；本身就是数字的（1e3、3,000）和日期（2026年11月17日）不算（GPT 第六轮 R5）。
const TIER_CELL = /^\s*(\d+)\s+[\u4e00-\u9fff][^\d]*$/;
function sameOrLead(cell, wanted) {
    if (sameValue(cell, wanted)) return !0;
    let w = cellText(wanted),
        m = TIER_CELL.exec(cellText(cell));
    return !!m && /^\d+$/.test(w) && Number(m[1]) === Number(w);
}
export function applyOp(op, cell, wanted) {
    if (op === '==') return sameOrLead(cell, wanted);
    if (op === '!=') return !sameOrLead(cell, wanted);
    let diff = compareValues(cell, wanted);
    return diff === null ? null : op === '>=' ? diff >= 0 : op === '<=' ? diff <= 0 : op === '>' ? diff > 0 : diff < 0;
}

export function effectiveFact(id, snapshot, clueProg) {
    let over = clueProg && clueProg.factOverrides && clueProg.factOverrides[id],
        fact = snapshot && snapshot.facts && snapshot.facts.get(id);
    if (over && over.status === 'revoked') return { v: TRI.f, confirmed: !1, text: '', why: `${id} 已人工撤销` };
    if (over && over.status === 'confirmed')
        return { v: TRI.t, confirmed: !0, text: (fact && fact.text) || over.text || '', why: `${id} 已人工确认` };
    if (!fact) return { v: TRI.u, confirmed: !1, text: '', why: `${id} 尚无记录` };
    if (fact.status === 'confirmed') return { v: TRI.t, confirmed: !0, text: fact.text, why: `${id} 已确认` };
    if (fact.status === 'pending') return { v: TRI.u, confirmed: !1, text: '', why: `${id} 待确认` };
    return { v: TRI.f, confirmed: !1, text: '', why: `${id} 未核实（${fact.raw || '空'}）` };
}

export function evalAtom(atom, env) {
    switch (atom.kind) {
        case 'fact': {
            let eff = effectiveFact(atom.fact, { facts: env.facts }, { factOverrides: env.factOverrides });
            if (atom.verified || eff.v !== TRI.f) return { v: eff.v, why: eff.why };
            let fact = env.facts && env.facts.get(atom.fact),
                over = env.factOverrides && env.factOverrides[atom.fact];
            return fact && fact.claimed && !(over && over.status === 'revoked')
                ? { v: TRI.t, why: `${atom.fact} 已在正文出现（${fact.raw || '说法'}）` }
                : { v: eff.v, why: eff.why };
        }
        case 'know': {
            let over = env.factOverrides && env.factOverrides[atom.fact];
            if (over && over.status === 'revoked') return { v: TRI.f, why: `${atom.fact} 已人工撤销` };
            let rows = env.knowledge.filter((row) => row.fact === atom.fact && row.actor === atom.actor);
            return rows.length
                ? atom.verified
                    ? rows.some((row) => row.verified === !0)
                        ? { v: TRI.t, why: `${atom.actor} 已核实 ${atom.fact}` }
                        : rows.some((row) => row.verified === null)
                          ? { v: TRI.u, why: `无法判断 ${atom.actor} 是否核实 ${atom.fact}（可信度未绑定或未填写）` }
                          : { v: TRI.f, why: `${atom.actor} 对 ${atom.fact} 仅为${rows[0].credibility || '未核实'}` }
                    : { v: TRI.t, why: `${atom.actor} 知道 ${atom.fact}${rows[0].way ? `（${rows[0].way}）` : ''}` }
                : { v: TRI.u, why: `${atom.actor} 没有 ${atom.fact} 的知情记录` };
        }
        case 'line': {
            let st = env.lineState ? env.lineState(atom.line) : void 0;
            if (st === void 0) return { v: TRI.u, why: `没有编号为 ${atom.line} 的线` };
            if (st === null)
                return atom.state === '开过' && env.lineStarted && env.lineStarted(atom.line)
                    ? { v: atom.op === '==' ? TRI.t : TRI.f, why: `线 ${atom.line} 已经开始过` }
                    : { v: TRI.u, why: `线 ${atom.line} 的状态还算不出来（开启条件未知，或线之间循环引用）` };
            let hit = (LINE_STATE_ALIAS[atom.state] || [atom.state]).includes(st);
            return { v: (atom.op === '==' ? hit : !hit) ? TRI.t : TRI.f, why: `线 ${atom.line} 现在是「${st}」` };
        }
        case 'count': {
            let r = countRows(env.tables, atom.table, atom.column, atom.op, atom.value, applyOp);
            if (r.state !== 'ok') return { v: TRI.u, why: r.reason };
            let test = (n) => (atom.cmp === '至少' ? n >= atom.n : atom.cmp === '至多' ? n <= atom.n : n === atom.n),
                lo = test(r.count),
                hi = test(r.count + r.unsure),
                label = `${atom.table} 里 ${atom.column} ${atom.op} ${atom.value} 的有 ${r.count} 行${r.unsure ? `，另有 ${r.unsure} 行的值无法比较` : ''}`;
            return (
                atom.cmp === '等于' && (lo = hi = atom.n >= r.count && atom.n <= r.count + r.unsure && (!r.unsure || null)),
                lo === hi && lo !== null
                    ? lo
                        ? { v: TRI.t, why: label }
                        : { v: TRI.f, why: `${label}（要${atom.cmp} ${atom.n} 行）` }
                    : { v: TRI.u, why: label }
            );
        }
        case 'node': {
            let done = env.nodeDone(atom.node);
            return done === void 0
                ? { v: TRI.u, why: `节点 ${atom.node} 不存在` }
                : done
                  ? { v: TRI.t, why: `节点 ${atom.node} 已完成` }
                  : { v: TRI.f, why: `节点 ${atom.node} 未完成` };
        }
        case 'cell':
        case 'time': {
            let paths = atom.kind === 'time' ? [].concat(env.timePath || []).filter(Boolean) : [atom.path];
            if (!paths.length) return { v: TRI.u, why: '未绑定故事时间' };
            let cell = null,
                misses = [];
            for (let path of paths) {
                let got = readCell(env.tables, path);
                if (got.state === 'ok') {
                    cell = got;
                    break;
                }
                misses.push(got.reason);
            }
            if (!cell) return { v: TRI.u, why: misses.join('；') };
            let label = atom.kind === 'time' ? '时间' : atom.path,
                value = cell.value;
            if (atom.sample && !sampleAgrees(atom))
                return { v: TRI.u, why: `${label}：这种写法插件暂时读不出来（样例核对没通过），可以改成手动开始` };
            if (atom.pick) {
                let got = pickEntry(value, atom.pick);
                if (got.state !== 'ok') return { v: TRI.u, why: `${label}：${got.reason}` };
                ((value = got.value), (label = `${label}里「${atom.pick}」那一项`));
            }
            if (atom.tiers && !['==', '!='].includes(atom.op) && !tierOrderKnown(atom, env.tables))
                return { v: TRI.u, why: `${label}：档位顺序「${atom.tiers.join(' < ')}」还没确认，确认前不比大小` };
            let ok =
                atom.op === '包含' || atom.op === '不包含'
                    ? cellText(value).includes(atom.value) === (atom.op === '包含')
                    : atom.tiers
                      ? tierCompare(atom.op, value, atom.value, atom.tiers)
                      : applyOp(atom.op, value, atom.value);
            return ok === null
                ? {
                      v: TRI.u,
                      why: atom.tiers
                          ? `${label}「${cellText(value)}」不是档位 ${atom.tiers.join('/')} 里的任何一档`
                          : `${label}「${cellText(value)}」无法与「${atom.value}」比较`,
                  }
                : { v: ok ? TRI.t : TRI.f, why: `${label} = ${cellText(value)}` };
        }
        default:
            return { v: TRI.u, why: atom.error || '条件错误' };
    }
}

export function evalCondition(cond, env) {
    if (!cond) return { v: TRI.t, reasons: [] };
    if (cond.kind !== 'group') {
        let r = evalAtom(cond, env);
        return { v: r.v, reasons: [r.why] };
    }
    let results = cond.items.map((item) => evalCondition(item, env));
    if (cond.mode === 'all') {
        let bad = results.filter((r) => r.v !== TRI.t);
        return bad.length
            ? { v: bad.some((r) => r.v === TRI.f) ? TRI.f : TRI.u, reasons: bad.flatMap((r) => r.reasons) }
            : { v: TRI.t, reasons: results.flatMap((r) => r.reasons) };
    }
    let hit = results.find((r) => r.v === TRI.t);
    return hit
        ? { v: TRI.t, reasons: hit.reasons }
        : {
              v: results.some((r) => r.v === TRI.u) ? TRI.u : TRI.f,
              reasons: [`以下任一满足即可：${results.flatMap((r) => r.reasons).join('；')}`],
          };
}

export function conditionRefs(
    cond,
    out = {
        facts: /* @__PURE__ */ new Set(),
        nodes: /* @__PURE__ */ new Set(),
        knows: /* @__PURE__ */ new Set(),
        lines: /* @__PURE__ */ new Set(),
    },
) {
    return (
        out.knows || (out.knows = /* @__PURE__ */ new Set()),
        out.lines || (out.lines = /* @__PURE__ */ new Set()),
        cond
            ? cond.kind === 'group'
                ? (cond.items.forEach((item) => conditionRefs(item, out)), out)
                : ((cond.kind === 'fact' || cond.kind === 'know') && out.facts.add(cond.fact),
                  cond.kind === 'know' && out.knows.add(`${cond.fact}@${cond.actor}`),
                  cond.kind === 'node' && out.nodes.add(cond.node),
                  cond.kind === 'line' && out.lines.add(cond.line),
                  out)
            : out
    );
}

export function prebuiltGaps(compiled, snapshot, { checkKnowledge = !0 } = {}) {
    let refs = { facts: /* @__PURE__ */ new Set(), nodes: /* @__PURE__ */ new Set(), knows: /* @__PURE__ */ new Set() };
    for (let unit of compiled.units) unit.clue && (conditionRefs(unit.clue.enter, refs), conditionRefs(unit.clue.end, refs));
    for (let node of compiled.nodes) for (let cond of [node.open, node.early, node.done]) conditionRefs(cond, refs);
    for (let l of compiled.lines || []) (conditionRefs(l.open, refs), l.legacyFact && refs.facts.add(l.legacyFact));
    let out = [],
        missingFacts = [...refs.facts].filter((id) => !(snapshot.facts && snapshot.facts.has(id))),
        present = snapshot.knowPresent;
    if (
        (missingFacts.length && out.push(`事实表里没有这些编号的行：${missingFacts.join('、')}（条件会一直是「未知」）`),
        checkKnowledge && present)
    ) {
        let missingKnows = [...refs.knows].filter((k) => !present.has(k));
        missingKnows.length && out.push(`知情表里还没有这些「事实@角色」的行：${missingKnows.join('、')}`);
    }
    return out;
}

export function tableConsistencyHints(snapshot) {
    let hints = [],
        holders = /* @__PURE__ */ new Map();
    for (let row of snapshot.knowledge || []) holders.set(row.fact, [...(holders.get(row.fact) || []), row.actor]);
    for (let [id, fact] of snapshot.facts || []) {
        let who = holders.get(id) || [];
        (fact.status === 'confirmed' || fact.claimed) &&
            !who.length &&
            snapshot.knowPresent &&
            [...snapshot.knowPresent].some((k) => k.startsWith(`${id}@`)) &&
            hints.push(
                `${id} 在事实表里已记为「${fact.raw || '已确认'}」，但知情表里还没有任何人知道它；如果正文里有人亲见或听到，检查知情表是否漏填`,
            );
        fact.status === 'unconfirmed' &&
            !fact.claimed &&
            who.length &&
            hints.push(`知情表记录了 ${who.join('、')} 知道 ${id}，但事实表仍是「${fact.raw}」；检查事实表是否漏填`);
    }
    return hints;
}

export const AWAY_PREFIX = '@away:';

export const NODE_STATUS_LABELS = { locked: '未开放', available: '可进行', active: '进行中', done: '已完成' };

export function emptyClueProgress() {
    return { focus: '', overrides: {}, factOverrides: {}, log: [] };
}

export function isRequired(node) {
    let flag = isPlainObject(node.item) ? node.item.必需 : void 0;
    return flag === void 0 || flag === null || flag === '' ? node.kind === 'main' : flag === !0 || flag === '是' || flag === 'true';
}

export function compileClue(volumes) {
    let errors = [],
        units = flattenUnits(volumes),
        nodes = [],
        ids = /* @__PURE__ */ new Set();
    for (let unit of units) {
        let data = isPlainObject(unit.stage.data) ? unit.stage.data : {},
            where = stageLabel(unit.stage.key),
            errs = [],
            enter = parseCondition(data.进入条件, errs),
            end = parseCondition(data.结束条件, errs);
        (errs.forEach((e) => errors.push(`${where}：${e}`)),
            (unit.clue = { enter, end, hasEnter: data.进入条件 != null && data.进入条件 !== '' }));
        for (let node of stageNodes(data)) {
            let item = isPlainObject(node.item) ? node.item : {},
                uid = nodeUid(item),
                nerrs = [],
                c = {
                    ...node,
                    uid,
                    unit,
                    required: isRequired(node),
                    open: parseCondition(item.开放条件, nerrs),
                    early: parseCondition(item.提前条件, nerrs),
                    done: parseCondition(item.完成条件, nerrs),
                };
            (nerrs.forEach((e) => errors.push(`${where}·${node.name}：${e}`)),
                uid
                    ? ids.has(uid)
                        ? errors.push(`节点 ID「${uid}」重复`)
                        : ids.add(uid)
                    : node.kind === 'main' && errors.push(`${where}·${node.name}：缺少稳定 ID`),
                nodes.push(c));
        }
    }
    for (let node of nodes)
        for (let ref of conditionRefs(node.open).nodes)
            ids.has(ref) || errors.push(`${stageLabel(node.unit.stage.key)}·${node.name}：引用了不存在的节点「${ref}」`);
    for (let node of nodes)
        for (let cond of [node.early, node.done])
            for (let ref of conditionRefs(cond).nodes)
                ids.has(ref) || errors.push(`${stageLabel(node.unit.stage.key)}·${node.name}：引用了不存在的节点「${ref}」`);
    for (let node of nodes)
        node.uid &&
            conditionRefs(node.done).nodes.has(node.uid) &&
            errors.push(
                `${stageLabel(node.unit.stage.key)}·${node.name}：完成条件引用了节点自己（${node.uid}），永远不会完成；应写成它自己产出的事实`,
            );
    for (let unit of units)
        for (let [label, cond] of [
            ['进入条件', unit.clue.enter],
            ['结束条件', unit.clue.end],
        ])
            for (let ref of conditionRefs(cond).nodes)
                ids.has(ref) || errors.push(`${stageLabel(unit.stage.key)}·${label}：引用了不存在的节点「${ref}」`);
    let lines = compileLines(units, errors),
        lineIds = new Set(lines.map((l) => l.id)),
        refCheck = (cond, where) => {
            for (let ref of conditionRefs(cond).lines) lineIds.has(ref) || errors.push(`${where}：引用了不存在的线「${ref}」`);
        };
    for (let l of lines) refCheck(l.open, `线 ${l.id} 的开启条件`);
    for (let node of nodes)
        [node.open, node.early, node.done].forEach((c) => refCheck(c, `${stageLabel(node.unit.stage.key)}·${node.name}`));
    for (let unit of units) [unit.clue.enter, unit.clue.end].forEach((c) => refCheck(c, stageLabel(unit.stage.key)));
    return { units, nodes, errors, lines };
}

export function computeClueState(compiled, snapshot, clueProg, config = DEFAULT_CLUE) {
    let { units, nodes } = compiled,
        lines = compiled.lines || [],
        byUid = new Map(nodes.filter((n) => n.uid).map((n) => [n.uid, n])),
        overrides = clueProg.overrides || {},
        doneMemo = /* @__PURE__ */ new Map(),
        visiting = /* @__PURE__ */ new Set(),
        cycles = [],
        lineMemo = /* @__PURE__ */ new Map(),
        lineVisiting = /* @__PURE__ */ new Set(),
        byLine = new Map(lines.map((l) => [l.id, l])),
        env = {
            facts: snapshot.facts || /* @__PURE__ */ new Map(),
            knowledge: snapshot.knowledge || [],
            tables: snapshot.tables || {},
            timePath: config.bindings && config.bindings.time && config.bindings.time.路径,
            factOverrides: clueProg.factOverrides || {},
            nodeDone: (uid) => {
                let node = byUid.get(uid);
                return node ? nodeDone(node).v === TRI.t : void 0;
            },
            // 给条件求值用的线状态：开启条件是未知（含循环）而落到「未触发」的，不当成确定的「未触发」交出去，返回 null（GPT 代码审阅 R4）。
            lineState: (id) => {
                let l = byLine.get(id);
                if (!l) return;
                let s = lineStateOf(l);
                return s && !s.pending ? s.state : null;
            },
            lineStarted: (id) => {
                let l = byLine.get(id);
                return !!l && lineEvidence(l);
            },
        };
    function nodeDone(node) {
        if (node.uid && doneMemo.has(node.uid)) return doneMemo.get(node.uid);
        let over = (node.uid && overrides[node.uid]) || {},
            result;
        return (
            over.done === 'force'
                ? (result = { v: TRI.t, reasons: ['人工标记完成'], manual: !0 })
                : over.done === 'undo'
                  ? (result = { v: TRI.f, reasons: ['人工撤销完成'], manual: !0 })
                  : node.done
                    ? node.uid && visiting.has(node.uid)
                        ? (cycles.push(node.uid), (result = { v: TRI.u, reasons: [`节点 ${node.uid} 条件循环引用`] }))
                        : (node.uid && visiting.add(node.uid),
                          (result = evalCondition(node.done, env)),
                          node.uid && visiting.delete(node.uid))
                    : (result = { v: TRI.f, reasons: ['没有完成条件，需人工标记'] }),
            node.uid && doneMemo.set(node.uid, result),
            result
        );
    }
    let stageStates = /* @__PURE__ */ new Map();
    function stageChain(list, firstEntered) {
        let prevDone = !0;
        for (let [k, unit] of list.entries()) {
            let own = nodes.filter((n) => n.unit === unit),
                required = own.filter((n) => n.required),
                gate = k === 0 && firstEntered ? firstEntered() : null,
                entered =
                    gate && gate.v !== TRI.t
                        ? gate
                        : unit.clue.hasEnter
                          ? evalCondition(unit.clue.enter, env)
                          : prevDone
                            ? { v: TRI.t, reasons: [k === 0 && gate ? gate.reasons[0] : '上一阶段已结束'] }
                            : { v: TRI.f, reasons: ['上一阶段尚未结束'] },
                requiredLeft = required.filter((n) => !(overrides[n.uid] || {}).skip && nodeDone(n).v !== TRI.t),
                end = evalCondition(unit.clue.end, env),
                done = entered.v === TRI.t && !requiredLeft.length && end.v === TRI.t;
            (gate && gate.v !== TRI.t && (entered = gate),
                stageStates.set(unit.id, { unit, entered, end, requiredLeft, done: entered.v === TRI.t && done }),
                (prevDone = entered.v === TRI.t && done));
        }
    }
    function legacySeen(l) {
        return !!l.legacyFact && evalAtom({ kind: 'fact', fact: l.legacyFact }, env).v === TRI.t;
    }
    function lineEvidence(l) {
        return !!((clueProg.lines || {})[l.id] || {}).started || legacySeen(l);
    }
    function windowOf(l) {
        let w = l.window;
        if (!w) return { v: TRI.t, reasons: [] };
        if (w.bad) return { v: TRI.u, reasons: [`开启时段写得不对：${w.bad}`] };
        let main = byLine.get(w.main),
            ms = main ? lineStateOf(main) : null;
        if (!ms) return { v: TRI.u, reasons: [`主线 ${w.main} 的状态还算不出来`] };
        if (ms.state === '完成' || ms.state === '放弃')
            return { v: TRI.f, missed: !0, reasons: [`开启时段已过（${w.main} ${ms.state === '完成' ? '已经完成' : '已经放弃'}）`] };
        if (!ms.started) return { v: TRI.f, reasons: [`要等主线 ${w.main} 开始`] };
        let from = w.from ? stageStates.get(w.from) : null,
            to = w.to ? stageStates.get(w.to) : null;
        return from && from.entered.v !== TRI.t
            ? { v: from.entered.v === TRI.u ? TRI.u : TRI.f, reasons: [`要等 ${w.main} 进入「${w.fromLabel}」`] }
            : to && to.done
              ? { v: TRI.f, missed: !0, reasons: [`开启时段已过（${w.main} 的「${w.toLabel}」已经结束）`] }
              : { v: TRI.t, reasons: [`在 ${w.main} 的开启时段内`] };
    }
    function mainBusy(l) {
        let at = lines.indexOf(l);
        for (let [k, o] of lines.entries()) {
            if (o === l || o.kind !== 'main' || (o.mode !== 'auto' && !lineEvidence(o)) || (!lineEvidence(o) && k > at)) continue;
            let s = lineStateOf(o);
            if (!s) return `主线 ${o.id} 的状态还算不出来`;
            // 自动开始：暂停的主线也挡着（GPT 七题审阅 §3：暂停 M1 不会自己开 M2）。
            // 手动「进入」看的是 mainSlotTaken，暂停的不占位置（GPT 审阅 R6），想先玩别的主线就手动进入。
            if (s.state === '进行中' || s.state === '暂停')
                return `主线 ${o.id} ${s.state === '暂停' ? '暂停中（想先玩这条，点「进入」）' : '还在进行'}`;
        }
        return '';
    }
    // 接上一条：大纲里排在它前面的那条主线（按卷的先后）结束了没有。第一条主线没有前序，视为满足。
    function prevMainDone(l) {
        if (!l.after) return { v: TRI.t, reasons: [] };
        let mains = lines.filter((x) => x.kind === 'main'),
            prev = mains[mains.indexOf(l) - 1];
        if (!prev) return { v: TRI.t, reasons: [] };
        let s = lineStateOf(prev);
        if (!s) return { v: TRI.u, reasons: [`主线 ${prev.id} 的状态还算不出来`] };
        return s.state === '完成' || s.state === '放弃' ? { v: TRI.t, reasons: [] } : { v: TRI.f, reasons: [`排在主线 ${prev.id} 后面，要等它结束`] };
    }
    function lineStateOf(l) {
        if (lineMemo.has(l.id)) return lineMemo.get(l.id);
        if (lineVisiting.has(l.id)) return (cycles.push(`线 ${l.id}`), null);
        lineVisiting.add(l.id);
        let man = (clueProg.lines || {})[l.id] || {},
            legacy = !man.started && legacySeen(l),
            evidence = !!man.started || legacy,
            settled = man.state && (evidence || man.state !== 'pause'),
            cond = settled ? { v: TRI.t, reasons: [] } : evalCondition(l.open, env),
            win = settled || evidence ? { v: TRI.t, reasons: [] } : windowOf(l),
            eligible = cond.v === TRI.t && win.v === TRI.t,
            started = evidence,
            why = man.started ? man.how || '已开始' : legacy ? `开场事实 ${l.legacyFact} 已出现` : '',
            waitMain = '';
        let after = !evidence && !man.state && l.kind === 'main' ? prevMainDone(l) : { v: TRI.t, reasons: [] };
        !evidence &&
            !man.state &&
            eligible &&
            l.kind === 'main' &&
            l.mode === 'auto' &&
            ((waitMain = after.v !== TRI.t ? after.reasons.join('；') || '要等前一条主线结束' : clueProg.mainPaused ? '主线已全部暂停' : mainBusy(l)) ||
                ((started = !0), (why = '开启条件已满足')));
        let state =
                man.state === 'abandon'
                    ? '放弃'
                    : man.state === 'done'
                      ? '完成'
                      : man.state === 'pause'
                        ? '暂停'
                        : started
                          ? '进行中'
                          : eligible
                            ? '可开启'
                            : '未触发',
            result = {
                line: l,
                state,
                started,
                eligible,
                cond,
                window: win,
                missed: !started && !man.state && !!win.missed,
                why,
                waitMain,
                manual: man,
                entries: [],
                pending: !man.state && !started && (cond.v === TRI.u || win.v === TRI.u),
            };
        if (state === '进行中') {
            stageChain(l.units, () => ({ v: TRI.t, reasons: [`线 ${l.id} 进行中（${why}）`] }));
            let last = stageStates.get(l.units[l.units.length - 1].id);
            last && last.done && ((result.state = '完成'), (result.why = '最后一个阶段已结束'));
        }
        return (lineVisiting.delete(l.id), lineMemo.set(l.id, result), result);
    }
    let free = units.filter((u) => !u.line);
    stageChain(free, null);
    let lineStates = lines.map(
        (l) =>
            lineStateOf(l) || {
                line: l,
                state: '未触发',
                started: !1,
                eligible: !1,
                cond: { v: TRI.u, reasons: ['线之间循环引用'] },
                window: { v: TRI.u, reasons: [] },
                missed: !1,
                why: '',
                waitMain: '',
                manual: {},
                entries: [],
                pending: !0,
            },
    );
    for (let s of lineStates) {
        if (s.state === '进行中' || (s.state === '完成' && s.started)) {
            stageStates.has(s.line.units[0].id) || stageChain(s.line.units, () => ({ v: TRI.t, reasons: [`线 ${s.line.id} ${s.state}`] }));
            continue;
        }
        let gate = {
            v: s.state === '可开启' ? TRI.f : s.pending ? TRI.u : TRI.f,
            reasons: [`线 ${s.line.id} ${s.missed ? '已错过' : s.state}${s.state === '可开启' ? '，还没开始' : ''}`],
        };
        for (let unit of s.line.units) {
            let own = nodes.filter((n) => n.unit === unit),
                required = own.filter((n) => n.required);
            stageStates.set(unit.id, {
                unit,
                entered: gate,
                end: evalCondition(unit.clue.end, env),
                requiredLeft: required.filter((n) => !(overrides[n.uid] || {}).skip && nodeDone(n).v !== TRI.t),
                done: !1,
            });
        }
    }
    for (let s of lineStates) {
        if (s.started || s.state !== '可开启') continue;
        let first = s.line.units[0];
        !first ||
            (first.clue.hasEnter && evalCondition(first.clue.enter, env).v !== TRI.t) ||
            (s.entries = nodes
                .filter(
                    (n) =>
                        n.unit === first &&
                        n.uid &&
                        (overrides[n.uid] || {}).open !== 'block' &&
                        nodeDone(n).v !== TRI.t &&
                        (!n.open || evalCondition(n.open, env).v === TRI.t),
                )
                .map((n) => n.uid));
    }
    let lineOf = new Map(lineStates.map((s) => [s.line, s])),
        nodeStates = nodes.map((node) => {
            let over = (node.uid && overrides[node.uid]) || {},
                stage = stageStates.get(node.unit.id),
                done = nodeDone(node),
                open,
                ls = node.unit.line && lineOf.get(node.unit.line);
            if (ls && ls.state !== '进行中') open = { v: TRI.f, reasons: [`所在的线 ${ls.line.id} ${ls.missed ? '已错过' : ls.state}`] };
            else if (ls && ls.line.kind === 'side' && clueProg.sidePaused) open = { v: TRI.f, reasons: ['支线已全部暂停'] };
            else if (ls && ls.line.kind === 'main' && clueProg.mainPaused) open = { v: TRI.f, reasons: ['主线已全部暂停'] };
            else if (over.open === 'force') open = { v: TRI.t, reasons: ['人工开放'], manual: !0 };
            else if (over.open === 'block') open = { v: TRI.f, reasons: ['已手动停用'], manual: !0 };
            else {
                let normal =
                        stage.entered.v !== TRI.t
                            ? { v: stage.entered.v, reasons: [`阶段未进入：${stage.entered.reasons.join('；')}`] }
                            : evalCondition(node.open, env),
                    early = node.early ? evalCondition(node.early, env) : null;
                open =
                    normal.v === TRI.t
                        ? normal
                        : early && early.v === TRI.t
                          ? { v: TRI.t, reasons: ['提前条件满足', ...early.reasons] }
                          : normal;
            }
            let status = done.v === TRI.t ? 'done' : open.v === TRI.t ? 'available' : 'locked';
            return { node, status, open, done, skipped: !!over.skip, disabled: over.open === 'block', manualOpen: over.open === 'force' };
        }),
        focus = pickFocus(nodeStates, clueProg, lines.length ? { ...config, autoFocusSingle: !1 } : config, snapshot, stageStates);
    for (let state of nodeStates)
        state.node.uid && state.node.uid === focus.uid && state.status === 'available' && (state.status = 'active');
    let current =
        units.find((unit) => {
            let s = stageStates.get(unit.id);
            return s.entered.v === TRI.t && !s.done;
        }) || null;
    return { nodeStates, stageStates, focus, current, lineStates, cycles: [...new Set(cycles)], problems: snapshot.problems || [] };
}

export function pickFocus(nodeStates, clueProg, config, snapshot, stageStates) {
    let usable = (uid) => nodeStates.find((s) => s.node.uid === uid && s.status === 'available' && !s.disabled),
        manual = clueProg.focus || '',
        awayFrom = manual.startsWith(AWAY_PREFIX) ? manual.slice(AWAY_PREFIX.length) : '',
        sceneBinding = config.bindings && config.bindings.scene,
        scenePath = sceneBinding && sceneBinding.路径,
        cell = scenePath ? readCell(snapshot.tables || {}, scenePath) : null,
        cellValue = cell && cell.state === 'ok' ? cellText(cell.value) : '',
        tableMovedOn =
            !!manual &&
            clueProg.focusSceneAt !== void 0 &&
            (!!clueProg.focusTaken || (cell && cell.state === 'ok' && cellValue !== clueProg.focusSceneAt));
    if (manual && !awayFrom && !tableMovedOn && usable(manual)) return { uid: manual, source: 'manual' };
    let tableAway = !1;
    if (scenePath) {
        if (cell.state === 'ok' && (cellValue !== awayFrom || tableMovedOn) && usable(cellValue))
            return { uid: cellValue, source: 'table' };
        tableAway = cell.state === 'ok' && sceneIsNone(cell.value, sceneBinding);
    }
    if (config.autoFocusSingle !== !1 && !tableAway) {
        let stageDone = (s) => !!(stageStates && s.node.unit && (stageStates.get(s.node.unit.id) || {}).done),
            mains = nodeStates.filter(
                (s) => s.status === 'available' && s.node.kind === 'main' && s.node.uid && !s.disabled && !stageDone(s),
            );
        if (mains.length === 1 && mains[0].node.uid !== awayFrom) return { uid: mains[0].node.uid, source: 'auto' };
        if (mains.length === 1) return { uid: '', source: 'away' };
    }
    return tableAway || (awayFrom && !tableMovedOn)
        ? { uid: '', source: 'away' }
        : manual && !awayFrom && nodeStates.some((s) => s.node.uid === manual && s.status === 'done')
          ? { uid: '', source: 'manualDone' }
          : { uid: '', source: clueProg.focus ? 'stale' : 'none' };
}

export const LINE_STATES = ['未触发', '可开启', '进行中', '暂停', '完成', '放弃'];

// 结束 = 完成或放弃（导入审阅总方案 H / GPT 审阅 R6）：「前一条结束后再开」不会因为前一条被放弃而永远等着。原来的「完成」仍只表示完成。
export const LINE_STATE_ALIAS = { 开过: ['进行中', '暂停', '完成', '放弃'], 开着: ['进行中', '暂停'], 结束: ['完成', '放弃'] };

export function normalizeOps(text) {
    return String(text || '')
        .replace(/＞＝|≥/g, '>=')
        .replace(/＜＝|≤|≦/g, '<=')
        .replace(/！＝|≠/g, '!=')
        .replace(/＝＝/g, '==')
        .replace(/＞/g, '>')
        .replace(/＜/g, '<')
        .replace(/＝/g, '==')
        .replace(/(^|[^=!<>])=(?!=)/g, '$1==');
}

export function parseCountAtom(value, errors) {
    let raw = JSON.stringify(value);
    if (!isPlainObject(value))
        return (
            errors.push(`计数条件应写成 {表: 表名, 条件: 列 >= 值, 至少: N}：${raw.slice(0, 60)}`),
            { kind: 'bad', raw, error: '计数格式错误' }
        );
    let table = String(value.表 || '').trim(),
        m = splitCompare(normalizeOps(value.条件), /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.*)$/),
        cmp = ['至少', '至多', '等于'].find((k) => value[k] !== void 0 && value[k] !== ''),
        n = cmp ? Number(value[cmp]) : NaN;
    return !table || !m || !cmp || !Number.isFinite(n)
        ? (errors.push(`计数条件缺少表名、条件（列 运算 值）或数量（至少 / 至多 / 等于）：${raw.slice(0, 60)}`),
          { kind: 'bad', raw, error: '计数格式错误' })
        : {
              kind: 'count',
              table,
              column: m[1].trim(),
              op: m[2],
              value: m[3].trim(),
              cmp,
              n,
              raw: `计数: ${table} 中 ${m[1].trim()} ${m[2]} ${m[3].trim()} 的行数${cmp}${n}`,
          };
}

export const CELL_EXTRA_KEYS = ['表', '取', '档位', '样例', '顺序'];

export function parseCellExtra(value, errors) {
    let atom = parseAtom(`表: ${String(value.表 ?? '').trim()}`),
        raw = JSON.stringify(value).slice(0, 80);
    if (atom.kind !== 'cell') return (errors.push(atom.error), atom);
    if (value.取 !== void 0) {
        let key = String(value.取 ?? '').trim();
        if (!key) return (errors.push(`「取」没写名字：${raw}`), { kind: 'bad', raw, error: '取值格式错误' });
        atom.pick = key;
    }
    if (value.档位 !== void 0) {
        let tiers = Array.isArray(value.档位) ? value.档位.map((t) => String(t ?? '').trim()).filter(Boolean) : [];
        if (tiers.length < 2 || new Set(tiers).size !== tiers.length)
            return (errors.push(`档位要写成至少两项、不重复的列表，从低到高：${raw}`), { kind: 'bad', raw, error: '档位格式错误' });
        if (/包含/.test(atom.op)) return (errors.push(`「包含」不用写档位：${raw}`), { kind: 'bad', raw, error: '档位格式错误' });
        if (!tiers.includes(atom.value))
            return (
                errors.push(`条件里的「${atom.value}」不在档位 ${tiers.join('/')} 里：${raw}`),
                { kind: 'bad', raw, error: '档位格式错误' }
            );
        ((atom.tiers = tiers), (atom.tierOk = String(value.顺序 ?? '').trim() === '已确认'));
    }
    if (value.样例 !== void 0) {
        let s = joinFlowSplit(value.样例, ['原文', '取', '得']);
        if (!isPlainObject(s) || s.原文 == null || s.得 == null)
            return (errors.push(`样例要写成 {原文: …, 取: …, 得: …}：${raw}`), { kind: 'bad', raw, error: '样例格式错误' });
        atom.sample = { text: String(s.原文), key: String(s.取 ?? atom.pick ?? '').trim(), want: String(s.得).trim() };
    }
    return (
        (atom.raw = `${atom.raw}${atom.pick ? `（取「${atom.pick}」）` : ''}${atom.tiers ? `（档位 ${atom.tiers.join('<')}）` : ''}`),
        atom
    );
}

export function joinFlowSplit(obj, keys) {
    if (!isPlainObject(obj)) return obj;
    let out = {},
        cur = '';
    for (let [k, v] of Object.entries(obj))
        if (keys.includes(k)) ((out[k] = v), (cur = k));
        else if (v == null && cur) out[cur] = `${out[cur] ?? ''},${k}`;
        else return obj;
    return out;
}

export function sampleAgrees(atom) {
    if (!atom.sample) return null;
    let s = atom.sample;
    if (!s.key) return cellText(s.text) === s.want;
    let got = pickEntry(s.text, s.key);
    return (
        got.state === 'ok' &&
        (got.value === s.want ||
            got.value
                .split(/[,，、]/)
                .map((x) => x.trim())
                .includes(s.want))
    );
}

export function tierOrderKnown(atom, tables) {
    if (atom.tierOk) return !0;
    let f = findSheet(
        tables || {},
        String(atom.path || '')
            .split('/')[0]
            .trim(),
    );
    return !f.error && tierOrderInNote(f.sheet.note, atom.tiers);
}

export function confirmTierOrder(volumes, tiers) {
    let want = (tiers || []).join(''),
        changed = !1,
        walk = (v) => {
            if (Array.isArray(v)) {
                let out2 = v.map(walk);
                return out2.some((x, i) => x !== v[i]) ? out2 : v;
            }
            if (!isPlainObject(v)) return v;
            let out = null;
            for (let [k, x] of Object.entries(v)) {
                let y = walk(x);
                y !== x && ((out = out || { ...v })[k] = y);
            }
            let cur = out || v;
            return cur.表 !== void 0 &&
                Array.isArray(cur.档位) &&
                cur.档位.map((t) => String(t ?? '').trim()).join('') === want &&
                String(cur.顺序 ?? '').trim() !== '已确认'
                ? ((changed = !0), { ...cur, 顺序: '已确认' })
                : cur;
        },
        next = (volumes || []).map((vol) => {
            let line = walk(vol.line),
                stages = walk(vol.stages);
            return line === vol.line && stages === vol.stages ? vol : { ...vol, ...(vol.line !== void 0 ? { line } : {}), stages };
        });
    return changed ? next : volumes;
}

export const LINE_MODES = { 条件满足即开始: 'auto', 走进去才开始: 'enter', 人工: 'manual', 等开场: 'enter' };

export function withLineIds(volumes) {
    let list = volumes || [];
    if (!list.some((v) => isPlainObject(v.line))) return list;
    let used = new Set(list.map((v) => (isPlainObject(v.line) ? String(v.line.编号 || '').trim() : '')).filter(Boolean)),
        n = 1,
        changed = !1,
        next = list.map((v) => {
            if (isPlainObject(v.line)) return v;
            for (; used.has(`M${n}`);) n++;
            return (used.add(`M${n}`), (changed = !0), { ...v, line: { 编号: `M${n}`, 类型: '主线' } });
        });
    return changed ? next : list;
}

export function resolveLineWindow(raw, lines, errs) {
    if (raw == null || raw === '') return null;
    if (!isPlainObject(raw)) return (errs.push('开启时段应写成 {主线: M1, 从: 阶段2, 到: 阶段3}'), { bad: '开启时段写法不对' });
    let mainId = String(raw.主线 || '').trim(),
        main = lines.find((l) => l.id === mainId);
    if (!main) return (errs.push(`开启时段引用了不存在的主线「${mainId}」`), { bad: `找不到主线 ${mainId}` });
    if (main.kind !== 'main') return (errs.push(`开启时段里的「${mainId}」不是主线`), { bad: `${mainId} 不是主线` });
    let find = (ref) => {
            let r = String(ref ?? '').trim();
            if (!r) return { unit: null };
            let hits = main.units.filter((u) => {
                let { short, title: title2 } = splitStageKey(u.stage.key);
                return [u.stage.key, short, title2, stageLabel(u.stage.key)].map((x) => String(x || '').trim()).includes(r);
            });
            return hits.length === 1
                ? { unit: hits[0] }
                : {
                      error: hits.length
                          ? `开启时段里的「${r}」在 ${mainId} 里有好几个同名阶段`
                          : `开启时段里的阶段「${r}」在 ${mainId} 里找不到`,
                  };
        },
        from = find(raw.从),
        to = find(raw.到),
        bad = from.error || to.error;
    return bad
        ? (errs.push(bad), { bad })
        : {
              main: mainId,
              from: from.unit ? from.unit.id : '',
              to: to.unit ? to.unit.id : '',
              fromLabel: from.unit ? stageLabel(from.unit.stage.key) : '',
              toLabel: to.unit ? stageLabel(to.unit.stage.key) : '',
          };
}

export function compileLines(units, errors) {
    let vols = [...new Set(units.map((u) => u.volume))];
    if (!vols.some((v) => isPlainObject(v.line))) return [];
    let named = withLineIds(vols),
        lines = [],
        seen = /* @__PURE__ */ new Set(),
        pend = [];
    for (let [k, volume] of vols.entries()) {
        let own = units.filter((u) => u.volume === volume),
            raw = named[k].line,
            where = `卷「${volumeLabel(volume.key)}」的线`,
            id = String(raw.编号 || '').trim(),
            errs = [];
        if (!id) {
            errors.push(`${where}：缺少编号`);
            continue;
        }
        if (seen.has(id)) {
            errors.push(`${where}：编号「${id}」和别的线重复`);
            continue;
        }
        seen.add(id);
        let kind = String(raw.类型 || '').trim() === '主线' ? 'main' : 'side',
            open = parseCondition(raw.开启条件, errs),
            legacyFact = String(raw.开场事实 || '').trim(),
            modeText = String(raw.开启方式 || '').trim();
        modeText && !LINE_MODES[modeText] && errs.push(`开启方式「${modeText}」不认识，可以写：条件满足即开始、走进去才开始、人工`);
        let mode = LINE_MODES[modeText] === 'manual' ? 'manual' : kind === 'main' ? 'auto' : 'enter',
            line = {
                id,
                kind,
                name: volumeLabel(volume.key),
                brief: clueText(raw.简介),
                entryHint: clueText(raw.入口提示),
                open,
                legacyFact,
                mode,
                volume,
                units: own,
                synthetic: !isPlainObject(volume.line),
                window: null,
                origCond: clueText(raw.原开启条件),
                // 接上一条（导入审阅总方案 H / GPT 审阅 R6）：排在前一条主线后面，前一条「结束」（完成或放弃）后才自动开始。
                // 只管自动开始；手动进入可以跳过它，剧情条件照样要满足。
                after: kind === 'main' && (raw.接上一条 === !0 || raw.接上一条 === 'true' || raw.接上一条 === '是'),
            };
        (lines.push(line), pend.push([line, raw.开启时段, errs, where]));
    }
    for (let [l, w, errs, where] of pend)
        ((l.window = resolveLineWindow(w, lines, errs)), errs.forEach((e) => errors.push(`${where}：${e}`)));
    for (let l of lines) for (let u of l.units) u.line = l;
    return lines;
}

export function lineToManual(volumes, id) {
    let at = (volumes || []).findIndex((v) => isPlainObject(v.line) && String(v.line.编号 || '').trim() === id);
    if (at < 0) return volumes;
    let line = { ...volumes[at].line },
        cond = line.开启条件,
        text = cond == null || cond === '' ? '' : typeof cond == 'string' ? cond : JSON.stringify(cond).replace(/"/g, '');
    if (LINE_MODES[String(line.开启方式 || '').trim()] === 'manual' && !text) return volumes;
    (delete line.开启条件, (line.开启方式 = '人工'), text && (line.原开启条件 = line.原开启条件 ? `${line.原开启条件}；${text}` : text));
    let next = volumes.slice();
    return ((next[at] = { ...volumes[at], line }), next);
}

export function lineTriggerFacts(compiled) {
    let produced = /* @__PURE__ */ new Set(),
        out = /* @__PURE__ */ new Map();
    for (let n of compiled.nodes || []) for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) d.fact && produced.add(d.fact);
    for (let l of compiled.lines || [])
        for (let f of [...conditionRefs(l.open).facts, ...(l.legacyFact ? [l.legacyFact] : [])])
            produced.has(f) || out.set(f, [...(out.get(f) || []), l.id]);
    return out;
}

export function sceneIsNone(value, binding) {
    let v = cellText(value);
    return !!v && (v === '无' || v === '离场' || (!!binding && binding.离场值 != null && v === cellText(binding.离场值)));
}
