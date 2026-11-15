import { isPlainObject, flattenUnits, stageLabel, stageNodes } from './outline.js';
import { cellText, sameValue, readCell } from './clue-tables.js';

import { nodeUid, DEFAULT_CLUE } from './clue-model.js';

export const COND_MAX_DEPTH = 2;

export const OPS = ['==', '!=', '>=', '<=', '>', '<'];

export const ATOM_KEYS = ['事实', '知情', '核实', '节点', '表', '时间'];

export const TRI = { t: 'true', f: 'false', u: 'unknown' };

export function atomString(key, value) {
    let v = String(value ?? '').trim();
    return key === '时间' ? `时间 ${v}` : `${key}: ${v}`;
}

export function parseAtom(text) {
    let raw = String(text || '').trim(),
        m;
    if ((m = /^事实\s*[:：]\s*(\S+)$/.exec(raw))) return { kind: 'fact', fact: m[1], raw };
    if ((m = /^核实\s*[:：]\s*([^@\s]+)$/.exec(raw))) return { kind: 'fact', fact: m[1], verified: !0, raw };
    if ((m = /^(知情|核实)\s*[:：]\s*([^@\s]+)\s*@\s*(.+)$/.exec(raw)))
        return { kind: 'know', fact: m[2], actor: m[3].trim(), verified: m[1] === '核实', raw };
    if ((m = /^节点\s*[:：]\s*(\S+)$/.exec(raw))) return { kind: 'node', node: m[1], raw };
    if ((m = /^表\s*[:：]\s*(.+?)\s*(==|!=|>=|<=|>|<)\s*(.*)$/.exec(raw)))
        return { kind: 'cell', path: m[1].trim(), op: m[2], value: m[3].trim(), raw };
    if ((m = /^时间\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(raw))) return { kind: 'time', op: m[1], value: m[2].trim(), raw };
    return { kind: 'bad', raw, error: `无法识别的条件「${raw}」` };
}

export function parseCondition(value, errors = [], depth = 0) {
    if (value == null || value === '' || (Array.isArray(value) && !value.length)) return null;
    if (typeof value == 'string') {
        let atom = parseAtom(value);
        return (atom.kind === 'bad' && errors.push(atom.error), atom);
    }
    let mode = 'all',
        items;
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
    if (depth >= COND_MAX_DEPTH) return (errors.push('条件嵌套超过两层'), { kind: 'bad', raw: '', error: '嵌套过深' });
    return { kind: 'group', mode, items: items.map((item) => parseCondition(item, errors, depth + 1)).filter(Boolean) };
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

export function applyOp(op, cell, wanted) {
    if (op === '==') return sameValue(cell, wanted);
    if (op === '!=') return !sameValue(cell, wanted);
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
            // 「事实」：说法值（存疑）也算正文里已经出现；「核实」只认已核实。人工撤销对两者都生效。
            let eff = effectiveFact(atom.fact, { facts: env.facts }, { factOverrides: env.factOverrides });
            if (atom.verified || eff.v !== TRI.f) return { v: eff.v, why: eff.why };
            let fact = env.facts && env.facts.get(atom.fact),
                over = env.factOverrides && env.factOverrides[atom.fact];
            return fact && fact.claimed && !(over && over.status === 'revoked')
                ? { v: TRI.t, why: `${atom.fact} 已在正文出现（${fact.raw || '说法'}）` }
                : { v: eff.v, why: eff.why };
        }
        case 'know': {
            let rows = env.knowledge.filter((row) => row.fact === atom.fact && row.actor === atom.actor);
            if (!rows.length) return { v: TRI.u, why: `${atom.actor} 没有 ${atom.fact} 的知情记录` };
            if (!atom.verified) return { v: TRI.t, why: `${atom.actor} 知道 ${atom.fact}${rows[0].way ? `（${rows[0].way}）` : ''}` };
            // verified: true 已核实 / false 明确未核实 / null 无法判断（没绑定可信度、缺列或空值）→ 未知。
            if (rows.some((row) => row.verified === !0)) return { v: TRI.t, why: `${atom.actor} 已核实 ${atom.fact}` };
            if (rows.some((row) => row.verified === null))
                return { v: TRI.u, why: `无法判断 ${atom.actor} 是否核实 ${atom.fact}（可信度未绑定或未填写）` };
            return { v: TRI.f, why: `${atom.actor} 对 ${atom.fact} 仅为${rows[0].credibility || '未核实'}` };
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
            // 故事时间可以绑定多个位置（默认：数据库默认的全局数据表，其次线索控制表），取第一个已填写的。
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
            let ok = applyOp(atom.op, cell.value, atom.value),
                label = atom.kind === 'time' ? '时间' : atom.path;
            return ok === null
                ? { v: TRI.u, why: `${label}「${cellText(cell.value)}」无法与「${atom.value}」比较` }
                : { v: ok ? TRI.t : TRI.f, why: `${label} = ${cellText(cell.value)}` };
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
    out = { facts: /* @__PURE__ */ new Set(), nodes: /* @__PURE__ */ new Set(), knows: /* @__PURE__ */ new Set() },
) {
    if (!cond) return out;
    out.knows || (out.knows = /* @__PURE__ */ new Set());
    if (cond.kind === 'group') return (cond.items.forEach((item) => conditionRefs(item, out)), out);
    return (
        (cond.kind === 'fact' || cond.kind === 'know') && out.facts.add(cond.fact),
        cond.kind === 'know' && out.knows.add(`${cond.fact}@${cond.actor}`),
        cond.kind === 'node' && out.nodes.add(cond.node),
        out
    );
}

export function prebuiltGaps(compiled, snapshot, { checkKnowledge = !0 } = {}) {
    let refs = { facts: /* @__PURE__ */ new Set(), nodes: /* @__PURE__ */ new Set(), knows: /* @__PURE__ */ new Set() };
    for (let unit of compiled.units) unit.clue && (conditionRefs(unit.clue.enter, refs), conditionRefs(unit.clue.end, refs));
    for (let node of compiled.nodes) for (let cond of [node.open, node.early, node.done]) conditionRefs(cond, refs);
    let out = [],
        missingFacts = [...refs.facts].filter((id) => !(snapshot.facts && snapshot.facts.has(id))),
        present = snapshot.knowPresent;
    missingFacts.length && out.push(`事实表里没有这些编号的行：${missingFacts.join('、')}（条件会一直是「未知」）`);
    if (checkKnowledge && present) {
        let missingKnows = [...refs.knows].filter((k) => !present.has(k));
        missingKnows.length && out.push(`知情表里没有这些「事实@角色」的预建行：${missingKnows.join('、')}`);
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

export const NODE_STATUS = ['locked', 'available', 'active', 'done'];

export const NODE_STATUS_LABELS = { locked: '未开放', available: '可进行', active: '进行中', done: '已完成' };

export function emptyClueProgress() {
    return { focus: '', overrides: {}, factOverrides: {}, log: [] };
}

export function normalizeClueProgress(value) {
    let src = isPlainObject(value) ? value : {};
    return {
        focus: typeof src.focus == 'string' ? src.focus : '',
        paused: src.paused === !0,
        overrides: isPlainObject(src.overrides) ? src.overrides : {},
        factOverrides: isPlainObject(src.factOverrides) ? src.factOverrides : {},
        log: Array.isArray(src.log) ? src.log.slice(-60) : [],
    };
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
    // 完成条件引用节点自己：「自己完成了才算完成」永远不成立（实测 AI 导入时会这样写）。
    for (let node of nodes)
        node.uid &&
            conditionRefs(node.done).nodes.has(node.uid) &&
            errors.push(
                `${stageLabel(node.unit.stage.key)}·${node.name}：完成条件引用了节点自己（${node.uid}），永远不会完成；应写成它自己产出的事实`,
            );
    // 阶段的进入 / 结束条件也检查节点引用（V7）。
    for (let unit of units)
        for (let [label, cond] of [
            ['进入条件', unit.clue.enter],
            ['结束条件', unit.clue.end],
        ])
            for (let ref of conditionRefs(cond).nodes)
                ids.has(ref) || errors.push(`${stageLabel(unit.stage.key)}·${label}：引用了不存在的节点「${ref}」`);
    return { units, nodes, errors };
}

export function computeClueState(compiled, snapshot, clueProg, config = DEFAULT_CLUE) {
    let { units, nodes } = compiled,
        byUid = new Map(nodes.filter((n) => n.uid).map((n) => [n.uid, n])),
        overrides = clueProg.overrides || {},
        doneMemo = /* @__PURE__ */ new Map(),
        visiting = /* @__PURE__ */ new Set(),
        cycles = [];
    let env = {
        facts: snapshot.facts || /* @__PURE__ */ new Map(),
        knowledge: snapshot.knowledge || [],
        tables: snapshot.tables || {},
        timePath: config.bindings && config.bindings.time && config.bindings.time.路径,
        factOverrides: clueProg.factOverrides || {},
        nodeDone: (uid) => {
            let node = byUid.get(uid);
            return node ? nodeDone(node).v === TRI.t : void 0;
        },
    };
    // 完成只看完成条件和人工记录；节点相互引用形成环时视为未知。
    function nodeDone(node) {
        if (node.uid && doneMemo.has(node.uid)) return doneMemo.get(node.uid);
        let over = (node.uid && overrides[node.uid]) || {},
            result;
        if (over.done === 'force') result = { v: TRI.t, reasons: ['人工标记完成'], manual: !0 };
        else if (over.done === 'undo') result = { v: TRI.f, reasons: ['人工撤销完成'], manual: !0 };
        else if (!node.done) result = { v: TRI.f, reasons: ['没有完成条件，需人工标记'] };
        else if (node.uid && visiting.has(node.uid))
            (cycles.push(node.uid), (result = { v: TRI.u, reasons: [`节点 ${node.uid} 条件循环引用`] }));
        else (node.uid && visiting.add(node.uid), (result = evalCondition(node.done, env)), node.uid && visiting.delete(node.uid));
        return (node.uid && doneMemo.set(node.uid, result), result);
    }
    let stageStates = /* @__PURE__ */ new Map(),
        prevDone = !0;
    for (let unit of units) {
        let own = nodes.filter((n) => n.unit === unit),
            required = own.filter((n) => n.required),
            entered = unit.clue.hasEnter
                ? evalCondition(unit.clue.enter, env)
                : prevDone
                  ? { v: TRI.t, reasons: ['上一阶段已结束'] }
                  : { v: TRI.f, reasons: ['上一阶段尚未结束'] },
            requiredLeft = required.filter((n) => {
                let over = overrides[n.uid] || {};
                return !over.skip && nodeDone(n).v !== TRI.t;
            }),
            end = evalCondition(unit.clue.end, env),
            done = entered.v === TRI.t && !requiredLeft.length && end.v === TRI.t;
        (stageStates.set(unit.id, { unit, entered, end, requiredLeft, done }), (prevDone = done));
    }
    let nodeStates = nodes.map((node) => {
        let over = (node.uid && overrides[node.uid]) || {},
            stage = stageStates.get(node.unit.id),
            done = nodeDone(node),
            open;
        if (over.open === 'force') open = { v: TRI.t, reasons: ['人工开放'], manual: !0 };
        else if (over.open === 'block') open = { v: TRI.f, reasons: ['人工暂禁'], manual: !0 };
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
    });
    let focus = pickFocus(nodeStates, clueProg, config, snapshot, stageStates);
    for (let state of nodeStates)
        state.node.uid && state.node.uid === focus.uid && state.status === 'available' && (state.status = 'active');
    let current =
        units.find((unit) => {
            let s = stageStates.get(unit.id);
            return s.entered.v === TRI.t && !s.done;
        }) || null;
    return { nodeStates, stageStates, focus, current, cycles: [...new Set(cycles)], problems: snapshot.problems || [] };
}

export function pickFocus(nodeStates, clueProg, config, snapshot, stageStates) {
    let usable = (uid) => nodeStates.find((s) => s.node.uid === uid && s.status === 'available' && !s.disabled);
    // 人工焦点寄存器：节点 id = 指定焦点；「@away:节点id」= 人工记下已离开该调查（只压住对它的自动聚焦）。
    let manual = clueProg.focus || '',
        awayFrom = manual.startsWith(AWAY_PREFIX) ? manual.slice(AWAY_PREFIX.length) : '';
    if (manual && !awayFrom && usable(manual)) return { uid: manual, source: 'manual' };
    let sceneBinding = config.bindings && config.bindings.scene,
        scenePath = sceneBinding && sceneBinding.路径,
        tableAway = !1;
    if (scenePath) {
        let cell = readCell(snapshot.tables || {}, scenePath);
        // 人工记了「离开」的那个场景，表格格子没清空时不再据此聚焦（填表写了别的场景照常生效）。
        if (cell.state === 'ok' && cellText(cell.value) !== awayFrom && usable(cellText(cell.value)))
            return { uid: cellText(cell.value), source: 'table' };
        // 场景格写的是「离场」：玩家明确离开了调查，不自动聚焦，只给入口。
        tableAway = cell.state === 'ok' && cellText(cell.value) === cellText(sceneBinding.离场值 ?? '离场');
    }
    if (config.autoFocusSingle !== !1 && !tableAway) {
        // 已经结束的阶段里剩下的可选节点仍然作为入口提供，但不自动聚焦：玩家已经走过了这一段，
        // 不能因为它是「唯一剩下的」就把旧场景推给正文（实测：故事结束后自动聚焦到了没问的更夫）。
        let stageDone = (s) => !!(stageStates && s.node.unit && (stageStates.get(s.node.unit.id) || {}).done);
        let mains = nodeStates.filter(
            (s) => s.status === 'available' && s.node.kind === 'main' && s.node.uid && !s.disabled && !stageDone(s),
        );
        if (mains.length === 1 && mains[0].node.uid !== awayFrom) return { uid: mains[0].node.uid, source: 'auto' };
        if (mains.length === 1) return { uid: '', source: 'away' };
    }
    if (tableAway || awayFrom) return { uid: '', source: 'away' };
    // 人工焦点指向的节点已经完成：属于正常结束，不是「失效」，界面上要分开说。
    if (manual && !awayFrom && nodeStates.some((s) => s.node.uid === manual && s.status === 'done'))
        return { uid: '', source: 'manualDone' };
    return { uid: '', source: clueProg.focus ? 'stale' : 'none' };
}
