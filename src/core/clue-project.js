import {
    lineTriggerFacts,
    sampleAgrees,
    conditionRefs,
    effectiveFact,
    compileClue,
    computeClueState,
    NODE_STATUS_LABELS,
    emptyClueProgress,
    TRI,
} from './clue-rules.js';
import { findSheet, sheetRows, cellText, findRow, cellEntries, pickEntry, tierOrderInNote, tierIndex, knowKey, knowKeyOf, readFacts, readKnowledge } from './clue-tables.js';

import { stripAuthorBlocks, nodeUid, normalizeClue } from './clue-model.js';
import { isPlainObject, stageLabel, flattenUnits, stageNodes, NODE_FIELDS, volumeShowName, outlineToText } from './outline.js';

import { bodyGuideText } from './inject.js';
import { normalizeCheck, hasChecks, checkRule, checkLine, freshCheckLines } from './trpg.js';

export function clueText(value) {
    return Array.isArray(value)
        ? value
              .map((v) => clueText(v))
              .filter(Boolean)
              .join('、')
        : stripAuthorBlocks(value == null ? '' : String(value)).trim();
}

export function discoveryList(item) {
    let list = Array.isArray(item.发现) ? item.发现 : item.发现 ? [item.发现] : [];
    return list
        .map((d) =>
            isPlainObject(d)
                ? {
                      fact: String(d.事实 || d.id || '').trim(),
                      text: clueText(d.内容),
                      record: clueText(d.记录),
                      // 跑团模式的「判定」（core/trpg.js）；没写判定的发现不带这个键
                      ...(normalizeCheck(d.判定) ? { check: normalizeCheck(d.判定) } : {}),
                  }
                : { fact: '', text: clueText(d), record: '' },
        )
        .filter((d) => d.text);
}

export function nodeFactRefs(node) {
    let refs = /* @__PURE__ */ new Set();
    // 阶段进入条件中的事实也算：门槛事实常写在阶段上。
    let unitEnter = node.unit && node.unit.clue ? node.unit.clue.enter : null;
    for (let cond of [unitEnter, node.open, node.done]) for (let f of conditionRefs(cond).facts) refs.add(f);
    let extra = isPlainObject(node.item) && node.item.相关事实;
    for (let f of Array.isArray(extra) ? extra : extra ? [extra] : []) refs.add(String(f).trim());
    return [...refs].filter(Boolean);
}

export const CLUE_STATUS_TEXT = { locked: '未开放', available: '可进行', active: '进行中', done: '已完成' };

export function clueProgressText(state, snapshot, clueProg, { problems = [] } = {}) {
    // 读条件用的视图（含已收起的行）；模板初值是「未获得 / 未知」，不会被列成已确认或知情
    snapshot = (snapshot && snapshot.cond) || snapshot;
    let lines = ['【线索进度（作者视角，含未开放节点的名称；只用于讨论和写大纲，不会给正文）】'],
        stages = [];
    for (let [, s] of state.stageStates) {
        let label = stageLabel(s.unit.stage.key),
            status = s.done ? '已结束' : s.entered.v === 'true' ? '进行中' : '未进入';
        stages.push(
            `${label}（${status}${status === '未进入' && s.entered.reasons.length ? `：${s.entered.reasons.join('；')}` : status === '进行中' && s.requiredLeft.length ? `，还差 ${s.requiredLeft.map((n) => n.uid || n.name).join('、')}` : ''}）`,
        );
    }
    stages.length && lines.push(`阶段：${stages.join(' → ')}`);
    let nodes = state.nodeStates.filter((s) => s.node.uid);
    nodes.length &&
        lines.push(
            '节点：',
            ...nodes.map((s) => {
                let why = s.status === 'locked' ? ((s.open && s.open.reasons) || []).slice(0, 2).join('；') : '';
                return `- [${CLUE_STATUS_TEXT[s.status] || s.status}${s.skipped ? '·已跳过' : ''}] ${s.node.uid} ${s.node.name}${state.focus.uid === s.node.uid ? ' ← 当前焦点' : ''}${why ? `（${why}）` : ''}`;
            }),
        );
    let holders = (id) =>
            [...new Set((snapshot.knowledge || []).filter((r) => r.fact === id).map((r) => `${r.actor}${r.way ? `·${r.way}` : ''}`))].join(
                '、',
            ),
        confirmed = [],
        claims = [];
    for (let [id, fact] of snapshot.facts || []) {
        let eff = effectiveFact(id, snapshot, clueProg),
            who = holders(id);
        eff.confirmed
            ? confirmed.push(`- ${id}：${clueText(eff.text) || '（表里没写内容）'}${who ? `｜知道：${who}` : ''}`)
            : fact.claimed && claims.push(`- ${id}：${clueText(fact.text) || '（表里没写内容）'}${who ? `｜听到：${who}` : ''}`);
    }
    for (let [id, over] of Object.entries((clueProg && clueProg.factOverrides) || {}))
        over.status === 'confirmed' &&
            !(snapshot.facts && snapshot.facts.has(id)) &&
            confirmed.push(`- ${id}：（人工确认）${clueText(over.text)}`);
    for (let [id, over] of Object.entries((clueProg && clueProg.factOverrides) || {}))
        over.status === 'claimed' && !(snapshot.facts && snapshot.facts.has(id)) && claims.push(`- ${id}：（人工记为存疑）${clueText(over.text)}`);
    lines.push(confirmed.length ? '已确认的事实：' : '已确认的事实：暂无', ...confirmed);
    claims.length && lines.push('已经出现、尚未核实的说法：', ...claims);
    problems.length && lines.push('表格问题：', ...problems.slice(0, 5).map((p) => `- ${p}`));
    return lines.join('\n');
}

// 一卷（一条线）用到的事实编号和节点 id：线 / 阶段 / 节点条件、节点的相关事实、条件里直接读线索表某一行的路径。
// 改写请求与采用前的跨线检查共用这份「别的线用到本线什么」。
export function volumeUses(compiled, v) {
    let refs = { facts: new Set(), nodes: new Set(), lines: new Set(), knows: new Set() },
        use = (c) => (conditionRefs(c, refs), condPathFacts(c, refs));
    for (let n of compiled.nodes.filter((n) => n.unit.volume === v)) {
        [n.open, n.early, n.done].forEach(use);
        let extra = isPlainObject(n.item) && n.item.相关事实;
        for (let f of Array.isArray(extra) ? extra : extra ? [extra] : []) String(f).trim() && refs.facts.add(String(f).trim());
    }
    for (let u of compiled.units.filter((u) => u.volume === v)) u.clue && (use(u.clue.enter), use(u.clue.end));
    let l = (compiled.lines || []).find((x) => x.volume === v);
    l && use(l.open);
    return refs;
}

// 按线改写时，别的线的紧凑参考（大型项目方案 四.1、四.4）：一行线名和简介，加上已用的节点 id、事实编号，
// 以及它和目标线之间的引用。不发别的线的正文，免得几十条线全塞进请求。
export function otherLinesText(volumes, targetVolumeId) {
    let compiled = compileClue(volumes || []),
        target = (volumes || []).find((v) => v.id === targetVolumeId),
        mine = compiled.nodes.filter((n) => n.unit.volume === target),
        myFacts = new Set(mine.flatMap((n) => discoveryList(isPlainObject(n.item) ? n.item : {}).map((d) => d.fact)).filter(Boolean)),
        myNodes = new Set(mine.map((n) => n.uid).filter(Boolean)),
        out = [];
    for (let v of volumes || []) {
        if (v === target) continue;
        let nodes = compiled.nodes.filter((n) => n.unit.volume === v),
            gives = [...new Set(nodes.flatMap((n) => discoveryList(isPlainObject(n.item) ? n.item : {}).map((d) => d.fact)).filter(Boolean))],
            refs = volumeUses(compiled, v);
        let uses = [...refs.facts].filter((f) => myFacts.has(f)).concat([...refs.nodes].filter((x) => myNodes.has(x))),
            line = isPlainObject(v.line) ? v.line : {},
            head = `- ${volumeShowName(v)}${clueText(line.简介) ? `：${clueText(line.简介)}` : ''}`;
        out.push(
            [
                head,
                nodes.some((n) => n.uid) && `  节点 id：${nodes.map((n) => n.uid).filter(Boolean).join('、')}`,
                gives.length && `  产出事实：${gives.join('、')}`,
                uses.length && `  用到这条线的：${uses.join('、')}（改写时不能删掉或改编号）`,
            ]
                .filter(Boolean)
                .join('\n'),
        );
    }
    return out.length ? `【其他剧情线（只作参考，不能改动）】\n${out.join('\n')}` : '';
}

// 写卷、讨论的大纲参考（大型项目方案 四.4）：勾选的线（卷 id）附完整 YAML，其余每条线几行：
// 简介、节点 id、产出的事实编号、它用到勾选的线的哪些编号。full 为空时只有简介部分。
// 返回 { text, full: [卷名], brief: 条数 }。
export function outlineRefText(volumes, fullIds) {
    let list = volumes || [],
        want = new Set(fullIds || []),
        full = list.filter((v) => want.has(v.id)),
        compiled = compileClue(list),
        mineFacts = new Set(),
        mineNodes = new Set();
    for (let n of compiled.nodes.filter((n) => want.has(n.unit.volume && n.unit.volume.id))) {
        n.uid && mineNodes.add(n.uid);
        for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) d.fact && mineFacts.add(d.fact);
    }
    let brief = [];
    for (let v of list) {
        if (want.has(v.id)) continue;
        let nodes = compiled.nodes.filter((n) => n.unit.volume === v),
            gives = [...new Set(nodes.flatMap((n) => discoveryList(isPlainObject(n.item) ? n.item : {}).map((d) => d.fact)).filter(Boolean))],
            refs = volumeUses(compiled, v),
            uses = [...refs.facts].filter((f) => mineFacts.has(f)).concat([...refs.nodes].filter((x) => mineNodes.has(x))),
            line = isPlainObject(v.line) ? v.line : {},
            stages = v.stages.map((s) => stageLabel(s.key)).join('、');
        brief.push(
            [
                `- ${volumeShowName(v)}${clueText(line.简介) ? `：${clueText(line.简介)}` : ''}`,
                stages && `  阶段：${stages}`,
                nodes.some((n) => n.uid) && `  节点 id：${nodes.map((n) => n.uid).filter(Boolean).join('、')}`,
                gives.length && `  产出事实：${gives.join('、')}`,
                uses.length && `  用到上面完整附带的线：${uses.join('、')}`,
            ]
                .filter(Boolean)
                .join('\n'),
        );
    }
    return {
        text: [full.length ? outlineToText(full) : '', brief.length ? `【其他剧情线（只附简介）】\n${brief.join('\n')}` : ''].filter(Boolean).join('\n\n'),
        full: full.map((v) => volumeShowName(v)),
        brief: brief.length,
    };
}

// 按线改写采用前（大型项目方案 四.1）：别的线用到、改写后不见了的事实编号和节点 id。
// 「来源」只算节点产出（发现）；引用方自己的条件不能证明来源还在。原来就没有节点产出的（纯开线事件，由正文登记）
// 不算丢。引用方看线 / 阶段 / 节点条件、节点的相关事实、条件里直接读线索表某一行的路径。
export function crossLineLoss(oldVolumes, nextVolumes, targetVolumeId) {
    let gather = (vols) => {
            let c = compileClue(vols || []),
                facts = new Set(),
                nodes = new Set(c.nodes.map((n) => n.uid).filter(Boolean));
            for (let n of c.nodes) for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) d.fact && facts.add(d.fact);
            return { c, facts, nodes };
        },
        before = gather(oldVolumes),
        after = gather(nextVolumes),
        out = [];
    for (let v of nextVolumes || []) {
        if (v.id === targetVolumeId) continue;
        let refs = volumeUses(after.c, v);
        let lost = [
            ...[...refs.facts].filter((f) => before.facts.has(f) && !after.facts.has(f)),
            ...[...refs.nodes].filter((x) => before.nodes.has(x) && !after.nodes.has(x)),
        ];
        lost.length && out.push(`「${volumeShowName(v)}」还在用${lost.join('、')}，改写后已经没有了`);
    }
    return out;
}

export function clueIndexText(volumes) {
    let compiled = compileClue(volumes || []),
        lines = [];
    for (let l of compiled.lines || []) lines.push(`- 线 ${l.id}（${l.kind === 'main' ? '主线' : '支线'}）「${l.name}」`);
    for (let node of compiled.nodes) {
        if (!node.uid) continue;
        let item = isPlainObject(node.item) ? node.item : {},
            gives = discoveryList(item)
                .map((d) => d.fact)
                .filter(Boolean),
            needs = [...new Set([node.open, node.done].flatMap((c) => [...conditionRefs(c).facts]))];
        lines.push(
            `- ${node.uid}「${node.name}」${clueText(item.入口) ? ` 入口：${clueText(item.入口)}` : ''}${gives.length ? ` · 产出 ${gives.join('、')}` : ''}${needs.length ? ` · 用到 ${needs.join('、')}` : ''}`,
        );
    }
    return lines.join(`
`);
}

export function chatFactSets(c) {
    if (!c) return { known: [], claimed: [] };
    // 编号取表中和手动操作的并集：执行页「手动确认」的事实可能还没有表格行。
    let known = [],
        claimed = [],
        ids = /* @__PURE__ */ new Set([
            ...(c.snap.facts || /* @__PURE__ */ new Map()).keys(),
            ...Object.keys((c.prog && c.prog.factOverrides) || {}),
        ]);
    for (let id of ids) {
        let f = c.snap.facts && c.snap.facts.get(id);
        let eff = effectiveFact(id, c.snap, c.prog),
            over = c.prog && c.prog.factOverrides && c.prog.factOverrides[id];
        eff.confirmed ? known.push(id) : f && f.claimed && !(over && over.status === 'revoked') && claimed.push(id);
    }
    return { known, claimed };
}

export function prebuildPlan(volumes, { actors = ['user'] } = {}) {
    let compiled = compileClue(volumes || []),
        facts = /* @__PURE__ */ new Map(),
        knows = /* @__PURE__ */ new Set(),
        scenes = [];
    for (let node of compiled.nodes) {
        let item = isPlainObject(node.item) ? node.item : {};
        node.uid && clueText(item.入口) && scenes.push({ uid: node.uid, entry: clueText(item.入口), place: clueText(item.地点) });
        for (let d of discoveryList(item)) {
            if (!d.fact || facts.has(d.fact)) continue;
            let criterion = d.record,
                overlap = criterion && answerOverlap(criterion, d.text);
            facts.set(d.fact, {
                code: d.fact,
                label: '',
                criterion: overlap ? '' : criterion,
                draftCriterion: criterion,
                risky: !!overlap,
                overlap: overlap || '',
                node: node.uid || node.name,
            });
        }
    }
    let refs = { facts: /* @__PURE__ */ new Set(), nodes: /* @__PURE__ */ new Set(), knows: /* @__PURE__ */ new Set() };
    for (let unit of compiled.units) unit.clue && (conditionRefs(unit.clue.enter, refs), conditionRefs(unit.clue.end, refs));
    for (let n of compiled.nodes) for (let c of [n.open, n.early, n.done]) conditionRefs(c, refs);
    for (let l of compiled.lines || []) conditionRefs(l.open, refs);
    for (let k of refs.knows) knows.add(k);
    let cellKnows = (cond) => {
        if (cond) {
            if (cond.kind === 'group') return cond.items.forEach(cellKnows);
            if (cond.kind === 'cell') {
                let m = /^[^/]+\/([^/@]+)@([^/]+)\//.exec(cond.path);
                m && knows.add(`${m[1].trim()}@${m[2].trim()}`);
            }
        }
    };
    for (let unit of compiled.units) unit.clue && (cellKnows(unit.clue.enter), cellKnows(unit.clue.end));
    for (let n of compiled.nodes) [n.open, n.early, n.done].forEach(cellKnows);
    for (let l of compiled.lines || []) cellKnows(l.open);
    for (let [f, ids] of lineTriggerFacts(compiled))
        facts.has(f) ||
            facts.set(f, {
                code: f,
                label: '',
                criterion: '',
                draftCriterion: '',
                risky: !1,
                overlap: '',
                node: `线 ${ids.join('、')}`,
                opening: ids[0],
                trigger: !0,
            });
    for (let id of refs.facts)
        facts.has(id) ||
            facts.set(id, { code: id, label: '', criterion: '', draftCriterion: '', risky: !1, overlap: '', node: '', orphan: !0 });
    for (let a of actors) for (let id of facts.keys()) knows.add(`${id}@${a}`);
    // 同一事实、主角的几种写法（主角 / user / 玩家…）只要一行（D48）：留先出现的写法（条件里作者写的在前），
    // 模板、补行、读条件共用这一份，保证行数一致
    let seenKey = /* @__PURE__ */ new Set();
    return {
        facts: [...facts.values()],
        knows: [...knows]
            .filter((k) => {
                let key = knowKeyOf(k);
                return seenKey.has(key) ? !1 : (seenKey.add(key), !0);
            })
            .map((k) => {
                let i = k.lastIndexOf('@');
                return { key: k, fact: k.slice(0, i), actor: k.slice(i + 1) };
            }),
        scenes,
    };
}

export function answerOverlap(record, answer) {
    let a = String(answer || '').replace(/[\s，。、；：！？“”「」（）,.;:!?()"']/g, ''),
        r = String(record || '');
    for (let len = Math.min(8, a.length); len >= 4; len--)
        for (let i = 0; i + len <= a.length; i++) {
            let piece = a.slice(i, i + len);
            if (r.includes(piece)) return piece;
        }
    return '';
}

// ---------- 大型项目第 2 批：哪些行该在表里（一份范围规则，模板、自动补行、缺行提示、补表格行共用） ----------
// 方案 二.1：
//   观察：开线事件（没有节点产出、只给开线用的事实）——对所有没开始的线都保留，提前发生的事才记得住；
//   进行中：已开始（含完成、放弃、暂停）的线自己产出的事实；
//   被依赖：已开始的线的条件读到的外部事实（事实、知情、核实、表格路径、计数各种写法，以及节点的「相关事实」）；
//   无线：不属于任何线的节点产出的事实（老的单线大纲）；
//   未来：只由还没开始的线产出——不建行，也不报缺行。
// started：已经开始过的线的编号集合；null = 整本都要（老大纲、没有线的项目，行为和以前一样）。
// frontier（线索建行与登记方案 二.2）：按节点建行用的节点集合（nodeFrontier）。给了它，节点产出的线索只看产出它的节点：
//   在已开始的线上、且在 frontier 里才建；条件里读到它不再是建行的理由（读条件本来就用完整模板参照）。
//   开线事件、老写法开场事实、孤立事实、不属于任何线的线索照旧。不给（跑团、中途开线索补登）就按线，和以前一样。
// 返回 { facts: Set, future: Set }。
export function rowScope(compiled, started, frontier = null) {
    let lines = compiled.lines || [],
        facts = /* @__PURE__ */ new Set(),
        all = /* @__PURE__ */ new Set(),
        producedBy = /* @__PURE__ */ new Map();
    for (let n of compiled.nodes)
        for (let d of discoveryList(isPlainObject(n.item) ? n.item : {}))
            d.fact && (all.add(d.fact), producedBy.set(d.fact, (producedBy.get(d.fact) || /* @__PURE__ */ new Set()).add(n.unit.line ? n.unit.line.id : '')));
    let trig = lineTriggerFacts(compiled);
    for (let f of trig.keys()) (all.add(f), facts.add(f));
    // 老写法「开场事实」：线自己的节点产出它时也开局就建，否则线没开始就登记不上，这条线永远开不了（设计决定 :959）
    for (let l of lines) l.legacyFact && (all.add(l.legacyFact), facts.add(l.legacyFact));
    // 没有节点产出、但条件里用到的事实（孤立事实）：一直要（和以前一样，缺了会报问题）
    let refsOf = (units, nodes, extraConds = []) => {
        let r = { facts: /* @__PURE__ */ new Set(), nodes: /* @__PURE__ */ new Set(), knows: /* @__PURE__ */ new Set(), lines: /* @__PURE__ */ new Set() };
        for (let u of units) u.clue && (conditionRefs(u.clue.enter, r), conditionRefs(u.clue.end, r), condPathFacts(u.clue.enter, r), condPathFacts(u.clue.end, r));
        for (let n of nodes) {
            for (let c of [n.open, n.early, n.done]) (conditionRefs(c, r), condPathFacts(c, r));
            let extra = isPlainObject(n.item) && n.item.相关事实;
            for (let f of Array.isArray(extra) ? extra : extra ? [extra] : []) String(f).trim() && r.facts.add(String(f).trim());
        }
        for (let c of extraConds) (conditionRefs(c, r), condPathFacts(c, r));
        return r.facts;
    };
    for (let f of refsOf(compiled.units, compiled.nodes, lines.map((l) => l.open))) producedBy.has(f) || (all.add(f), facts.add(f));
    if (!started || !lines.length) {
        for (let f of all) facts.add(f);
        return { facts, future: /* @__PURE__ */ new Set() };
    }
    if (frontier) {
        for (let n of compiled.nodes) {
            let id = n.unit.line ? n.unit.line.id : '';
            (id === '' || (started.has(id) && frontier.has(n))) &&
                discoveryList(isPlainObject(n.item) ? n.item : {}).forEach((d) => d.fact && facts.add(d.fact));
        }
        return { facts, future: new Set([...all].filter((f) => !facts.has(f))) };
    }
    for (let [f, ids] of producedBy) [...ids].some((id) => id === '' || started.has(id)) && facts.add(f);
    let live = lines.filter((l) => started.has(l.id));
    for (let f of refsOf(
        live.flatMap((l) => l.units),
        compiled.nodes.filter((n) => n.unit.line && started.has(n.unit.line.id)),
        live.map((l) => l.open),
    ))
        all.has(f) && facts.add(f);
    return { facts, future: new Set([...all].filter((f) => !facts.has(f))) };
}

// 按节点建行的节点集合（线索建行与登记方案 二.2）：已开放、进行中、已完成的节点，再往前看一层——
// 假设这些节点的线索都拿到了，推一遍会新开放的节点。往前看的一层只是表里的空行，正文仍按真实开放状态给材料；
// 一批里正常连走两步（A 拿到马上开 B）时 B 也有行登记。往前看新增的线索最多 cap 条（和跑团一样 30）。
export const FRONTIER_CAP = 30;
export function nodeFrontier(compiled, state, snap, prog, config, { cap = FRONTIER_CAP } = {}) {
    if (!state || !state.nodeStates) return null;
    let gives = (n) =>
            discoveryList(isPlainObject(n.item) ? n.item : {})
                .map((d) => d.fact)
                .filter(Boolean),
        out = /* @__PURE__ */ new Set(),
        have = /* @__PURE__ */ new Set();
    for (let ns of state.nodeStates) ns.status !== 'locked' && (out.add(ns.node), gives(ns.node).forEach((f) => have.add(f)));
    let knowAtoms = /* @__PURE__ */ new Set(),
        refs = (c) => conditionRefs(c).knows.forEach((k) => knowAtoms.add(k));
    for (let u of compiled.units) u.clue && (refs(u.clue.enter), refs(u.clue.end));
    for (let n of compiled.nodes) [n.open, n.early, n.done].forEach(refs);
    let facts = new Map((snap && snap.facts) || []);
    for (let id of have) facts.set(id, { ...(facts.get(id) || {}), id, status: 'confirmed', raw: '已核实', text: (facts.get(id) || {}).text || '' });
    let knowledge = [
            ...((snap && snap.knowledge) || []),
            ...[...knowAtoms].flatMap((k) => {
                let i = k.lastIndexOf('@'),
                    fact = k.slice(0, i);
                return have.has(fact) ? [{ fact, actor: k.slice(i + 1), way: '亲见', verified: !0 }] : [];
            }),
        ],
        assumedKnows = knowledge.slice(((snap && snap.knowledge) || []).length),
        tables = patchClueView(snap && snap.tables, config && config.bindings, {
            facts: new Map([...have].map((id) => [id, 'yes'])),
            knows: new Map(assumedKnows.map((k) => [knowKey(k.fact, k.actor), 'yes'])),
        }),
        sim = computeClueState(compiled, { ...(snap || {}), facts, knowledge, tables }, prog, config),
        added = 0;
    for (let ns of sim.nodeStates) {
        if (ns.status === 'locked' || out.has(ns.node)) continue;
        let fresh = gives(ns.node).filter((f) => !have.has(f));
        if (added + fresh.length > cap) continue;
        ((added += fresh.length), out.add(ns.node));
    }
    return out;
}

// 越序登记检查（线索建行与登记方案 二.3）：只看还没认可的新登记。
// 已认可的登记是起点；时间、关系等普通格子用现在的值；新登记里，产出它的节点前提成立的先纳入，再看它让哪些后继节点成立，
// 直到不再变化。暂停的线、正常结束的线不挡（按照常进行算），没开始、错过、放弃的线挡。没有节点产出的线索（开线事件等）直接纳入。
// accepted：已认可的编号集合。返回 { admit: 这次纳入的, held: 前提不成立的 }。
export function admitRegistrations(compiled, snap, prog, config, accepted) {
    let overs = prog.factOverrides || {},
        pending = /* @__PURE__ */ new Set(),
        admit = /* @__PURE__ */ new Set();
    for (let [id, f] of (snap && snap.facts) || [])
        f && (f.status === 'confirmed' || f.claimed) && !accepted.has(id) && !(overs[id] && ['confirmed', 'kept'].includes(overs[id].status)) && pending.add(id);
    if (!pending.size) return { admit, held: pending };
    let producers = /* @__PURE__ */ new Map();
    for (let n of compiled.nodes)
        for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) d.fact && producers.set(d.fact, [...(producers.get(d.fact) || []), n]);
    for (let id of [...pending]) producers.has(id) || (pending.delete(id), admit.add(id));
    let lines = {};
    for (let [k, v] of Object.entries(prog.lines || {})) {
        let { state, ...rest } = v || {};
        lines[k] = state === 'pause' ? rest : v;
    }
    let loose = { ...prog, paused: !1, mainPaused: !1, sidePaused: !1, lines };
    for (let round = 0; round < 64 && pending.size; round++) {
        let st = computeClueState(compiled, withHeld(snap, pending, config && config.bindings), loose, config, { endedOpen: !0 }),
            // 看节点开没开放，不看显示状态：完成条件另有写法时，「已完成」不等于开放条件成立（GPT 发布前审阅 R7）
            ok = new Set(st.nodeStates.filter((x) => x.open && x.open.v === TRI.t).map((x) => x.node)),
            got = [...pending].filter((id) => producers.get(id).some((n) => ok.has(n)));
        if (!got.length) break;
        got.forEach((id) => (pending.delete(id), admit.add(id)));
    }
    return { admit, held: pending };
}
// 内存里改线索表的读视图（不写库）：事实行改状态；知情行改获知方式和可信度。
// set：{ facts: Map(编号 → 'yes' | 'no'), knows: Map(knowKey → 'yes' | 'no') }。只改已有的行（读视图里按完整模板补过行）。
function patchClueView(tables, bindings, set) {
    if (!tables) return tables;
    let fb = ((bindings && bindings.facts) || [])[0],
        kb = ((bindings && bindings.knowledge) || [])[0],
        first = (v, d) => cellText(Array.isArray(v) ? v[0] : v) || d,
        edit = (name, fn) => {
            let found = name ? findSheet(tables, name) : { error: !0 };
            if (found.error || !Array.isArray(found.sheet.content) || !found.sheet.content[0]) return;
            let head = found.sheet.content[0],
                col = (c) => (c ? head.indexOf(c) : -1),
                key = found.sheet.key,
                changed = !1,
                rows = found.sheet.content.map((row, i) => {
                    if (!i) return row;
                    let next = fn(row, col);
                    return next ? ((changed = !0), next) : row;
                });
            changed && (tables = { ...tables, [key]: { ...tables[key], content: rows } });
        };
    fb &&
        fb.状态列 &&
        set.facts.size &&
        edit(fb.表, (row, col) => {
            let v = set.facts.get(cellText(row[col(fb.编号列)])),
                c = col(fb.状态列);
            return v && c > 0 ? Object.assign([...row], { [c]: v === 'yes' ? first(fb.已核实值, '已核实') : '未获得' }) : null;
        });
    kb &&
        kb.方式列 &&
        set.knows.size &&
        edit(kb.表, (row, col) => {
            let fact = cellText(row[col(kb.事实列)]),
                v = set.knows.get(knowKey(fact, cellText(row[col(kb.角色列)]))) || set.knows.get(`${fact}@*`),
                w = col(kb.方式列),
                cr = col(kb.可信度列);
            if (!v || w < 1) return null;
            let out = Object.assign([...row], { [w]: v === 'yes' ? '亲见' : first(kb.未知值, '未知') });
            return (cr > 0 && (out[cr] = v === 'yes' ? first(kb.已核实值, '已核实') : '未核实'), out);
        });
    return tables;
}
// 不算数的登记：事实按未获得，这条事实的知情记录也不算；直接读线索表格子的条件看到的也是改过的值。
export function withHeld(snap, held, bindings = null) {
    if (!held || !held.size) return snap;
    let facts = new Map((snap && snap.facts) || []);
    for (let id of held) facts.has(id) && facts.set(id, { ...facts.get(id), status: 'unconfirmed', claimed: !1, raw: '未获得' });
    return {
        ...snap,
        facts,
        tables: patchClueView(snap && snap.tables, bindings, { facts: new Map([...held].map((id) => [id, 'no'])), knows: new Map([...held].map((id) => [`${id}@*`, 'no'])) }),
        knowledge: ((snap && snap.knowledge) || []).filter((r) => !held.has(r.fact)),
    };
}

// 条件里直接读线索表某一行的路径也算用到这条事实：关键事实表 `表/F8/列`，知情表 `表/F8@角色/列`。
function condPathFacts(cond, out) {
    if (!cond) return out;
    if (cond.kind === 'group') return (cond.items.forEach((c) => condPathFacts(c, out)), out);
    if (cond.kind === 'cell') {
        let m = /^[^/]+\/([^/@]+)(?:@[^/]+)?\//.exec(cond.path || '');
        m && /^F/i.test(m[1].trim()) && out.facts.add(m[1].trim());
    }
    return out;
}

// 已开始过的线（进行中、完成、放弃、暂停都算）。线索进度算出来以前用不了，就返回 null（整本都要）。
export function startedLines(state) {
    let ls = state && state.lineStates;
    return ls ? new Set(ls.filter((s) => s.started || ['完成', '放弃', '暂停'].includes(s.state)).map((s) => s.line.id)) : null;
}

// 插件能不能为这个绑定预建占位行（方案 十.1）：只有能表达「未获得 / 未知」的绑定才行。
// 事实表要配了状态列和已核实值（没配状态列的老绑定，表里有这一行就算已核实，建一行就等于确认了没发生的事）；
// 知情表要配了方式列（没配方式列，每一行都算知情）。
export function canSeedFacts(fb) {
    return !!(fb && fb.表 && fb.编号列 && fb.状态列 && cellText(fb.已核实值) !== '');
}
export function canSeedKnows(kb) {
    return !!(kb && kb.表 && kb.事实列 && kb.角色列 && kb.方式列);
}
// 项目级绑定：事实行、知情行各自能否预建。目标取第一个绑定；同一张表另有老绑定
// （事实没配状态列 / 知情没配方式列）时，补进去的占位行会被那个老绑定读成已核实 / 已知，这种行也不建。
export function seedable(bindings) {
    let fbs = (bindings && bindings.facts) || [],
        kbs = (bindings && bindings.knowledge) || [],
        fb = fbs[0],
        kb = kbs[0];
    return {
        facts: canSeedFacts(fb) && fbs.slice(1).every((b) => !b || b.表 !== fb.表 || canSeedFacts(b)),
        knows: canSeedKnows(kb) && kbs.slice(1).every((b) => !b || b.表 !== kb.表 || canSeedKnows(b)),
    };
}

// 读条件用的表（方案 二.3〔五〕）：以「全部建好时应有的行」为固定参照——prebuildPlan 对整本大纲给出的事实行和
// (事实, 角色) 知情行，和不按线筛选时生成模板会建的一样。实表里有就用实表的；没有的补模板初值（事实「未获得」，
// 知情「未知 / 未核实」）。这个集合只由大纲决定，不看算出来的线状态，所以算一次就定，不会来回跳。
// 只给能表达初值的绑定补（canSeedFacts / canSeedKnows）；读不到表、列不对，原样返回，照旧按原规则报问题。
// 补的行不写回数据库，也不发给填表模型；写操作一律用原始表。返回的 tables 里，补过的表 seedRows 清空（不再拿初始行充数）。
export function effectiveTables(tables, bindings, plan, labels = {}) {
    if (!tables || !plan) return tables;
    let out = tables,
        can = seedable(bindings),
        fb = ((bindings && bindings.facts) || [])[0],
        kb = ((bindings && bindings.knowledge) || [])[0],
        patch = (name, build) => {
            let found = findSheet(out, name);
            if (found.error) return;
            let key = found.sheet.key,
                head = Array.isArray(found.sheet.content && found.sheet.content[0]) ? found.sheet.content[0] : null;
            if (!head) return;
            // 表里的行和别处读法一样：还没填过表时用模板带的初始行（D21），不能当成空表补「未获得」盖掉作者预填的值
            let col = (c) => head.findIndex((x, i) => i > 0 && String(x ?? '').trim() === c),
                own = sheetRows(found.sheet).rows,
                add = build(col, own, head);
            add && add.length && (out = { ...out, [key]: { ...out[key], content: [head, ...own, ...add], seedRows: [] } });
        },
        blank = (head) => {
            let row = head.map(() => '');
            return ((row[0] = null), row);
        };
    can.facts &&
        patch(fb.表, (col, own, head) => {
            let idCol = col(fb.编号列),
                stCol = col(fb.状态列);
            if (idCol < 0 || stCol < 0) return null;
            let have = new Set(own.map((r) => cellText(r[idCol])));
            return plan.facts
                .filter((f) => !have.has(f.code))
                .map((f) => {
                    let row = blank(head);
                    return (
                        (row[idCol] = f.code),
                        (row[stCol] = '未获得'),
                        col('标签') >= 0 && (row[col('标签')] = (labels[f.code] && labels[f.code].label) || ''),
                        col('登记口径') >= 0 && (row[col('登记口径')] = (labels[f.code] && labels[f.code].criterion) || ''),
                        row
                    );
                });
        });
    can.knows &&
        patch(kb.表, (col, own, head) => {
            let fCol = col(kb.事实列),
                aCol = col(kb.角色列),
                wCol = col(kb.方式列),
                cCol = kb.可信度列 ? col(kb.可信度列) : -1,
                keyCol = col('键');
            if (fCol < 0 || aCol < 0 || wCol < 0) return null;
            // 主角的几种写法算同一个人（D47）；每补一条就记进集合，同一人不补两行
            let have = new Set(own.map((r) => knowKey(r[fCol], r[aCol])));
            return plan.knows
                .filter((k) => {
                    let key = knowKey(k.fact, k.actor);
                    return have.has(key) ? !1 : (have.add(key), !0);
                })
                .map((k) => {
                    let row = blank(head);
                    return (
                        keyCol >= 0 && (row[keyCol] = k.key),
                        (row[fCol] = k.fact),
                        (row[aCol] = k.actor),
                        (row[wCol] = Array.isArray(kb.未知值) ? kb.未知值[0] : kb.未知值 || '未知'),
                        cCol >= 0 && (row[cCol] = '未核实'),
                        row
                    );
                });
        });
    return out;
}

// 条件用的事实和知情（方案 二.3、十.1）：补了初值的那张表，只让「能表达初值」的绑定从视图读；
// 别的绑定（没配状态列 / 方式列的老绑定，哪怕和它是同一张表）照旧读实表，免得把补的「未获得 / 未知」行读成已核实 / 已知。
// 合并规则同 readFacts，按绑定顺序：前面已核实的锁定，否则后面覆盖；别表的「存疑」不被补的「未获得」覆盖。
export function condReads(tables, view, bindings) {
    let fbs = (bindings && bindings.facts) || [],
        kbs = (bindings && bindings.knowledge) || [],
        can = seedable(bindings),
        facts = /* @__PURE__ */ new Map(),
        knowledge = [];
    fbs.forEach((b, i) => {
        for (let [id, x] of readFacts(i === 0 && can.facts ? view : tables, [b]).facts) {
            let prev = facts.get(id);
            (prev && prev.status === 'confirmed') || facts.set(id, x);
        }
    });
    kbs.forEach((b, i) => knowledge.push(...readKnowledge(i === 0 && can.knows ? view : tables, [b]).rows));
    return { facts, knowledge };
}

// 差额按目标表自身计算（别表有记录不代表目标表有该行）；读不到目标表时退回汇总读数。
export function prebuildDiff(plan, snapshot, bindings) {
    let fb = (bindings.facts || [])[0],
        kb = (bindings.knowledge || [])[0],
        ownF = fb && snapshot.tables ? readFacts(snapshot.tables, [fb]) : null,
        ownK = kb && snapshot.tables ? readKnowledge(snapshot.tables, [kb]) : null,
        missing = (r) => r.problems.some((x) => /缺少|重名/.test(x)),
        haveFacts = ownF && !missing(ownF) ? ownF.facts : snapshot.facts || /* @__PURE__ */ new Map(),
        haveKnows = ownK && !missing(ownK) ? ownK.present : snapshot.knowPresent || /* @__PURE__ */ new Set(),
        seenKnows = /* @__PURE__ */ new Set(),
        planFacts = new Set(plan.facts.map((f) => f.code));
    return {
        factTable: fb ? fb.表 : '',
        knowTable: kb ? kb.表 : '',
        newFacts: plan.facts.filter((f) => !haveFacts.has(f.code)),
        // 「事实@角色」按 knowKeyOf 比（主角 / user / 玩家 算一个人，D47）；计划里同一人写了两种写法只补一行
        newKnows: plan.knows.filter((k) => {
            let key = knowKeyOf(k.key);
            return haveKnows.has(key) || seenKnows.has(key) ? !1 : (seenKnows.add(key), !0);
        }),
        // 表里有、大纲里已经没有的编号（改写后失效）：只报告，不删除
        stale: [...haveFacts.keys()].filter((id) => !planFacts.has(id)),
        kept: plan.facts.filter((f) => haveFacts.has(f.code)).map((f) => f.code),
    };
}

export function checkClueDraft(
    draftVolumes,
    existingVolumes,
    { keepIds = [], isObtained = () => !1, obtainedFacts = [], claimedFacts = [], applied = null, tables = null } = {},
) {
    let out = [],
        draft = compileClue(draftVolumes || []),
        existing = compileClue(existingVolumes || []),
        keep = new Set(keepIds),
        existingIds = new Set(existing.nodes.map((n) => n.uid).filter((id) => id && !keep.has(id)));
    out.push(...draft.errors.filter((e) => !/引用了不存在的节点|引用了不存在的线/.test(e)));
    let dup = draft.nodes.filter((n) => n.uid && existingIds.has(n.uid)).map((n) => n.uid);
    dup.length && out.push(`这些 id 和已有节点重复，保存时会自动换成新 id：${dup.join('、')}`);
    let oldGives = /* @__PURE__ */ new Map();
    for (let n of existing.nodes)
        if (!(n.uid && keep.has(n.uid)))
            for (let d of discoveryList(isPlainObject(n.item) ? n.item : {}))
                d.fact && !oldGives.has(d.fact) && oldGives.set(d.fact, { node: n.uid || n.name, text: d.text });
    for (let n of draft.nodes)
        for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) {
            let old = d.fact && oldGives.get(d.fact);
            if (!old) continue;
            let got = isObtained(d.fact);
            out.push(
                `事实编号 ${d.fact} 已经由 ${old.node} 使用（「${old.text}」）${got ? '，本聊天里已经取得' : ''}；新草稿的 ${n.uid || n.name} 又把它作为发现（「${d.text}」）。${got ? '保存后这个新节点会当即算完成。' : ''}如果是同一件事的另一条取得途径可以保留；如果是另一件事，请改用新编号。`,
            );
        }
    let produced = /* @__PURE__ */ new Set();
    for (let n of [...existing.nodes, ...draft.nodes])
        for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) d.fact && produced.add(d.fact);
    let allIds = new Set([...existing.nodes, ...draft.nodes].map((n) => n.uid).filter(Boolean)),
        used = /* @__PURE__ */ new Set(),
        badNodes = /* @__PURE__ */ new Set();
    for (let unit of draft.units)
        unit.clue &&
            [unit.clue.enter, unit.clue.end].forEach((c) => {
                let r = conditionRefs(c);
                (r.facts.forEach((f) => used.add(f)), r.nodes.forEach((id) => allIds.has(id) || badNodes.add(id)));
            });
    for (let n of draft.nodes)
        [n.open, n.early, n.done].forEach((c) => {
            let r = conditionRefs(c);
            (r.facts.forEach((f) => used.add(f)), r.nodes.forEach((id) => allIds.has(id) || badNodes.add(id)));
        });
    for (let l of [...(existing.lines || []), ...(draft.lines || [])]) {
        for (let f of conditionRefs(l.open).facts) produced.add(f);
        l.legacyFact && produced.add(l.legacyFact);
    }
    for (let l of draft.lines || []) {
        let own = new Set(
                draft.nodes
                    .filter((n) => n.unit.line === l)
                    .flatMap((n) => discoveryList(isPlainObject(n.item) ? n.item : {}).map((d) => d.fact))
                    .filter(Boolean),
            ),
            other = new Set(
                [...existing.nodes, ...draft.nodes]
                    .filter((n) => n.unit.line !== l)
                    .flatMap((n) => discoveryList(isPlainObject(n.item) ? n.item : {}).map((d) => d.fact))
                    .filter(Boolean),
            ),
            self = [...conditionRefs(l.open).facts].filter((f) => own.has(f) && !other.has(f));
        self.length &&
            out.push(
                `线 ${l.id} 要等的${self.join('、')}只能在这条线自己的节点里拿到，但线没开始时这些节点都打不开，这条线会一直开不了。开启条件里的事实不用写成节点的发现，正文里发生了填表就会记下`,
            );
    }
    let orphan = [...used].filter((f) => !produced.has(f));
    if (
        (orphan.length && out.push(`条件用到了没有任何节点产出的事实：${orphan.join('、')}（玩家永远拿不到，需要补节点或改条件）`),
        badNodes.size && out.push(`条件引用了不存在的节点：${[...badNodes].join('、')}`),
        tables)
    )
        for (let r of tableCondReport(draftVolumes, tables))
            r.level !== 'ok' &&
                out.push(
                    `${r.where}：${r.raw}——${r.notes.join('；')}${r.level === 'bad' ? '。这个条件会一直是未知，用到它的线或节点开不了；可以换成等一件事发生，或者改成手动开始' : ''}`,
                );
    let oldLines = new Set((existing.lines || []).map((l) => l.id)),
        dupLines = (draft.lines || []).filter((l) => oldLines.has(l.id)).map((l) => l.id);
    dupLines.length && out.push(`这些线的编号和已有的线重复：${dupLines.join('、')}`);
    let allLines = new Set([...(existing.lines || []), ...(draft.lines || [])].map((l) => l.id)),
        badLines = /* @__PURE__ */ new Set();
    for (let l of draft.lines || []) for (let id of conditionRefs(l.open).lines) allLines.has(id) || badLines.add(id);
    badLines.size && out.push(`开启条件引用了不存在的线：${[...badLines].join('、')}`);
    let noDone = draft.nodes.filter((n) => n.kind === 'main' && !n.done).map((n) => n.uid || n.name);
    noDone.length && out.push(`这些剧情节点没有完成条件，只能人工标记完成：${noDone.join('、')}`);
    let noFind = draft.nodes
        .filter((n) => n.kind === 'main' && !discoveryList(isPlainObject(n.item) ? n.item : {}).length)
        .map((n) => n.uid || n.name);
    if ((noFind.length && out.push(`这些剧情节点没有「发现」：${noFind.join('、')}`), !applied)) return out;
    let reach = clueReachability(applied, { knownFacts: obtainedFacts, claimedFacts }),
        list = (xs) =>
            xs
                .slice(0, 6)
                .map((x) => `${x.stage}${x.node ? `·${x.node}` : ''}（${x.why}）`)
                .join('；');
    (reach.verdict === 'blocked' && out.push(`按大纲自身推演，有走不通的地方：${list([...reach.stuckStages, ...reach.stuckNodes])}`),
        reach.verdict === 'unknown' &&
            out.push(`有些地方要看时间、知情或表格里的值才能走通，这里判断不了：${list([...reach.stuckStages, ...reach.stuckNodes])}`));
    for (let r of clueAlternativeRoutes(applied, { knownFacts: obtainedFacts, claimedFacts }))
        r.ok || out.push(`替代途径走不通：${r.stage}·${r.node} 单独走完时，${r.why}`);
    return out;
}

export function historyGuard(oldVolumes, nextVolumes, snapshot, clueProg, config, { scope = null } = {}) {
    let full = (vols) => computeClueState(compileClue(vols), snapshot, clueProg, config),
        stateOf = (st2) => new Map(st2.nodeStates.filter((s) => s.node.uid).map((s) => [s.node.uid, s])),
        fullBefore = full(oldVolumes),
        fullAfter = full(nextVolumes),
        before = stateOf(fullBefore),
        after = stateOf(fullAfter),
        diffs = [],
        notes = [],
        keepDone = /* @__PURE__ */ new Map(),
        reinsert = /* @__PURE__ */ new Map(),
        home = /* @__PURE__ */ new Map();
    // 阶段倒退（15.2-2）：已结束 / 已进入的阶段在改写后变成未结束 / 未进入，后面阶段的入口可能被锁住。
    // 阶段按「卷名 + 阶段名」对应（改写重新解析会产生新的阶段内部 id）。只提示，由作者决定是否接受。
    let stageKey = (u) => `${u.volume.key}|${u.stage.key}`,
        stageMap = (st2) => new Map([...st2.stageStates.values()].map((x) => [stageKey(x.unit), x])),
        sBefore = stageMap(fullBefore),
        sAfter = stageMap(fullAfter);
    for (let [key, a] of sBefore) {
        let b = sAfter.get(key);
        if (!b) continue;
        let name = stageLabel(a.unit.stage.key);
        a.done && !b.done
            ? notes.push(
                  `阶段「${name}」原来已经结束，改写后会变回「${b.entered.v === 'true' ? '进行中' : '未进入'}」，后面阶段的入口可能会被锁住`,
              )
            : a.entered.v === 'true' &&
              b.entered.v !== 'true' &&
              notes.push(`阶段「${name}」原来已进入，改写后会变成「未进入」，这个阶段里的入口会消失`);
    }
    // 失去的入口：原来可进行 / 进行中、改写后不再开放的节点（不论原因：阶段倒退、开放条件被改）。
    let lostEntries = [...before]
        .filter(([uid, s]) => (s.status === 'available' || s.status === 'active') && after.has(uid) && after.get(uid).status === 'locked')
        .map(([uid, s]) => `${uid}「${s.node.name}」`);
    lostEntries.length && notes.push(`改写后这些原本可进行的节点会重新锁定：${lostEntries.join('、')}`);
    for (let unit of flattenUnits(oldVolumes))
        for (let n of stageNodes(unit.stage.data))
            nodeUid(n.item) && home.set(nodeUid(n.item), { volKey: unit.volume.key, stageKey: unit.stage.key, field: n.field });
    for (let [uid, s] of before) {
        if (scope && !scope.has(uid)) continue;
        let t = after.get(uid),
            label = `${uid}「${s.node.name}」`,
            item = isPlainObject(s.node.item) ? s.node.item : {};
        if (s.status === 'done' && !t)
            (diffs.push(`${label}已完成，改写结果里没有这个节点；应用时会放回原位`), reinsert.set(uid, s.node.item));
        else if (s.status === 'done' && t.status !== 'done')
            (diffs.push(`${label}已完成，改写后会变回「${NODE_STATUS_LABELS[t.status]}」；应用时会保留它原来的完成条件`),
                keepDone.set(uid, item.完成条件));
        let got = discoveryList(item).filter(
            (d) =>
                d.fact &&
                (effectiveFact(d.fact, snapshot, clueProg).confirmed ||
                    (snapshot.facts && snapshot.facts.get(d.fact) && snapshot.facts.get(d.fact).claimed)),
        );
        if (got.length) {
            // 节点还在：看同一节点里是否还有这些编号；节点被删（15.3）：同样列出，事实挪到了别的节点就说明新去向。
            let ids = new Set(t ? discoveryList(isPlainObject(t.node.item) ? t.node.item : {}).map((d) => d.fact) : []),
                lost = got.filter((d) => !ids.has(d.fact)).map((d) => d.fact);
            if (lost.length) {
                let movedTo = (fact) =>
                    [...after].find(([, x]) => discoveryList(isPlainObject(x.node.item) ? x.node.item : {}).some((d) => d.fact === fact));
                notes.push(
                    `${label}${t ? '里' : '（改写后被删除）中'}已获得或已说出的发现${lost
                        .map((f) => {
                            let m = movedTo(f);
                            return m ? `${f}（移到了${m[0]}）` : f;
                        })
                        .join('、')}在原位置不见了；表格里的记录还在，但正文可能把它当成没发生过`,
                );
            }
        }
    }
    for (let [uid, t] of after) {
        if (scope && !scope.has(uid) && before.has(uid)) continue;
        let s = before.get(uid),
            was = s ? s.status : '（新节点）';
        t.status === 'done' &&
            was !== 'done' &&
            notes.push(`这次改写会让${uid}「${t.node.name}」直接变成已完成（原来：${s ? NODE_STATUS_LABELS[was] : was}），这个节点的调查会被跳过`);
    }
    return { diffs, notes, keepDone, reinsert, home };
}

export function restoreHistory(draftVolumes, guard) {
    if (!guard.keepDone.size && !guard.reinsert.size) return draftVolumes;
    let out = (draftVolumes || []).map((v) => ({
        ...v,
        stages: v.stages.map((st2) => {
            if (!isPlainObject(st2.data)) return st2;
            let data = { ...st2.data };
            for (let { field } of NODE_FIELDS)
                Array.isArray(data[field]) &&
                    (data[field] = data[field].map((it) => {
                        let uid = nodeUid(it);
                        return uid && guard.keepDone.has(uid) ? { ...it, 完成条件: guard.keepDone.get(uid) } : it;
                    }));
            return { ...st2, data };
        }),
    }));
    for (let [uid, item] of guard.reinsert) {
        let h = guard.home.get(uid) || { volKey: '', stageKey: '', field: '主线节点' },
            vol = out.find((v) => v.key === h.volKey),
            target =
                (vol && vol.stages.find((st2) => st2.key === h.stageKey)) ||
                (vol && vol.stages[vol.stages.length - 1]) ||
                (out[0] && out[0].stages[0]);
        target &&
            (target.data = { ...target.data, [h.field]: [item, ...(Array.isArray(target.data[h.field]) ? target.data[h.field] : [])] });
    }
    return out;
}

export function buildClueProjection(
    state,
    snapshot,
    clueProg,
    settings,
    { pace = 'normal', stay = '', plan = null, notReady = null, checks = null, arrive = !1 } = {},
) {
    let tag = String(settings.tagName || '剧情参考').trim() || '剧情参考',
        focus = state.nodeStates.find((s) => s.node.uid && s.node.uid === state.focus.uid),
        lines = [],
        used = {
            focus: focus ? focus.node.uid : '',
            facts: [],
            discoveries: [],
            leads: [],
            candidates: [],
            scenes: [],
            offer: '',
            recognize: plan ? plan.recognize.map((r) => ({ uid: r.uid, line: r.line, entry: r.entry, place: r.place })) : [],
        };
    if (focus) {
        let node = focus.node,
            item = isPlainObject(node.item) ? node.item : {},
            stageData = isPlainObject(node.unit.stage.data) ? node.unit.stage.data : {},
            instr = clueText(stageData.AI指令),
            place = clueText(item.地点),
            scene = clueText(item.场景),
            finds = discoveryList(item);
        (used.scenes.push({ uid: node.uid, entry: clueText(item.入口), place, focus: !0 }),
            lines.push(
                '以下是本轮可演的场景材料。列出的发现尚未发生，只有正文中实际完成相应调查、交谈或行动时才能揭示；中途离开、失败或转去做别的事，就不要揭示，也不要当作已知。',
            ),
            stay && lines.push(stay),
            instr && lines.push(`本段要求：${instr}`),
            place && lines.push(`地点：${place}`),
            scene && lines.push(`场景（初次到达时的样子；人物态度和环境后来的变化以前文为准，不要重置）：${scene}`),
            arrive && lines.push(ARRIVE_RULE));
        let isClaimed = (d) => {
                if (!d.fact) return !1;
                let f = snapshot.facts && snapshot.facts.get(d.fact),
                    over = clueProg && clueProg.factOverrides && clueProg.factOverrides[d.fact];
                return !!(f && f.claimed) && !(over && over.status === 'revoked');
            },
            got = finds.filter((d) => d.fact && effectiveFact(d.fact, snapshot, clueProg).confirmed),
            voiced = finds.filter((d) => !got.includes(d) && isClaimed(d)),
            held = finds.filter((d) => !got.includes(d) && !voiced.includes(d) && d.fact && notReady && notReady.has(d.fact)),
            pending = finds.filter((d) => !got.includes(d) && !voiced.includes(d) && !held.includes(d)),
            gotFacts = new Set([...got, ...voiced].map((d) => d.fact));
        (held.length && (used.held = held.map((d) => d.fact)),
            held.length && !pending.length && lines.push('这一场的具体发现还在准备，这一轮先写到人物和环境，不要写出调查结果。'),
            pending.length &&
                (lines.push(got.length ? '本场景还可能获得的发现（尚未发生）：' : '本场景可能获得的发现（尚未发生）：'),
                pending.forEach((d) => {
                    // 跑团模式：带判定的发现按骰点结果写（掷骰成功前不给内容，core/trpg.js checkLine）；没有判定的原样
                    let ck = checkLine(d, checks);
                    (lines.push(ck ? ck.line : `- ${d.text}`),
                        used.discoveries.push(d.fact || d.text.slice(0, 20)),
                        d.fact && (!ck || ck.reveal) && used.candidates.push({ fact: d.fact, record: d.record }));
                }),
                // 跑团模式：有带判定的发现时，加一条检定写法（没有判定时什么都不加）
                hasChecks(pending) && lines.push(checkRule(settings, [...new Set(pending.flatMap((d) => (d && d.check && d.check.skills) || []))]))));
        let holdersOf = (id) => [
                ...new Set(
                    (snapshot.knowledge || [])
                        .filter((row) => row.fact === id && clueText(row.actor))
                        .map((row) => `${clueText(row.actor)}${row.verified === !0 ? '' : `（${clueText(row.credibility) || '未核实'}）`}`),
                ),
            ],
            whoText = (id) => {
                let h = holdersOf(id);
                return snapshot.knowPresent || (snapshot.knowledge || []).length
                    ? h.length
                        ? `｜知道的人：${h.join('、')}`
                        : '｜知情范围未记录'
                    : '';
            },
            nameOf = (id) => {
                let f = snapshot.facts && snapshot.facts.get(id);
                return f && f.label ? `「${f.label}」` : id;
            },
            recordedOr = (id, text) =>
                text ||
                `（${nameOf(id)} 已经${snapshot.facts && snapshot.facts.get(id) && snapshot.facts.get(id).claimed ? '有人说出' : '确认'}，但表格没有记录具体内容；沿用正文里已经写出的部分，不要补充）`;
        (got.length &&
            lines.push(
                '本场景已经获得的发现（不要重复揭示）：',
                ...got.map((d) => `- ${recordedOr(d.fact, clueText(effectiveFact(d.fact, snapshot, clueProg).text))}${whoText(d.fact)}`),
            ),
            voiced.length &&
                (lines.push(
                    '本场景已经有人说出、但尚未核实的内容（只是说法；沿用原话、说话人和听到的人，不要当成事实，也不要重复首次揭示）：',
                    ...voiced.map((d) => {
                        let f = snapshot.facts.get(d.fact),
                            src = clueText(f.source);
                        return `- ${recordedOr(d.fact, clueText(f.text))}${src ? `｜来源：${src}` : ''}${whoText(d.fact)}`;
                    }),
                ),
                voiced.forEach((d) => {
                    (used.facts.push(d.fact), used.candidates.push({ fact: d.fact, record: d.record }));
                })));
        let known = [],
            claims = [];
        for (let id of nodeFactRefs(node)) {
            if (gotFacts.has(id) || finds.some((d) => d.fact === id && !got.includes(d))) continue;
            let eff = effectiveFact(id, snapshot, clueProg),
                fact = snapshot.facts && snapshot.facts.get(id);
            if (eff.confirmed) {
                let text = clueText(eff.text);
                (known.push(`- ${text || `（${nameOf(id)} 已经确认，但表格没有记录具体内容）`}${whoText(id)}`), used.facts.push(id));
                continue;
            }
            let override = clueProg && clueProg.factOverrides && clueProg.factOverrides[id];
            if (fact && fact.claimed && !(override && override.status === 'revoked')) {
                let text = clueText(fact.text);
                text && (claims.push(`- ${text}${whoText(id)}`), used.facts.push(id));
            }
        }
        (known.length &&
            lines.push('与本场景相关、已经确认的事实（只有列出的人知道；其他角色要经过告知、展示或亲眼所见才会知道）：', ...known),
            claims.length &&
                lines.push('与本场景相关、已经出现过但尚未核实的说法（只是说法，不要当成事实；只有列出的人听到过）：', ...claims));
    }
    let leadOf = (s) => ({
        uid: s.node.uid,
        text: clueText(isPlainObject(s.node.item) ? s.node.item.入口 : ''),
        place: clueText(isPlainObject(s.node.item) ? s.node.item.地点 : ''),
    });
    if (plan) {
        let listed = (uid) => !plan.known || plan.known.has(uid),
            sameLine = focus
                ? state.nodeStates
                      .filter(
                          (s) =>
                              s.status === 'available' &&
                              s !== focus &&
                              !s.disabled &&
                              s.node.uid &&
                              s.node.unit.line === focus.node.unit.line &&
                              listed(s.node.uid),
                      )
                      .map(leadOf)
                      .filter((l) => l.text)
                : [];
        sameLine.length &&
            (lines.push('同一段剧情里另外可以去做的事（由用户选择，不要强行引导）：', ...sameLine.map((l) => `- ${l.text}`)),
            (used.leads = sameLine.map((l) => l.uid)),
            sameLine.forEach((l) => used.scenes.push({ uid: l.uid, entry: l.text, place: l.place, focus: !1 })));
        let offer = !focus && plan.offer,
            items = offer ? offer.items.filter((x) => x.entry) : [];
        items.length &&
            (lines.push(
                `可用的后续方向：${items.map((x) => String(x.entry).trim().replace(/[。；;，,\s]+$/, '')).join('；')}。${offer.hint ? `（由头：${offer.hint}）` : ''}`,
                '只有本轮行动自然涉及它时才接入；否则继续眼前的事，不必提及。尚未进入时不要补写调查结果。',
                ...(offer.kind === 'side' ? ['如果前文已经发生过类似的事，就接着前文写，不要重演。'] : []),
            ),
            (used.offer = offer.line),
            (used.leads = items.map((x) => x.uid)));
        let sidePaused = !!(clueProg && clueProg.sidePaused),
            mainPaused = !!(clueProg && clueProg.mainPaused),
            live = (state.lineStates || []).some((s) => s.state === '进行中' && (s.line.kind === 'main' ? !mainPaused : !sidePaused));
        (focus || lines.length || plan.recognize.length || live) && (lines.push(CLUE_OFF_MATERIAL_RULE), (used.guard = !0));
        for (let r of plan.recognize)
            used.scenes.some((x) => x.uid === r.uid) || used.scenes.push({ uid: r.uid, entry: r.entry, place: r.place, focus: !1 });
    } else {
        let leads = state.nodeStates
            .filter((s) => s.status === 'available' && s !== focus && !s.disabled && s.node.uid)
            .map(leadOf)
            .filter((l) => l.text);
        leads.length &&
            (lines.push(
                focus ? '另外可以去做的事（由用户选择，不要强行引导）：' : '目前可以去做的事（由用户选择，不要强行引导）：',
                ...leads.map((l) => `- ${l.text}`),
                '如果用户这一轮去做了上面的某件事，写到他到达、开始就可以；具体查到什么、对方说出什么，留到之后再写，不要自己编造结果。',
            ),
            (used.leads = leads.map((l) => l.uid)),
            leads.forEach((l) => used.scenes.push({ uid: l.uid, entry: l.text, place: l.place, focus: !1 })));
    }
    // 跑团模式：这一轮刚掷的检定，焦点场景里没列出的单独列出（没有判定结果时什么都不加）
    checks &&
        lines.push(
            ...freshCheckLines(state.nodeStates, checks, {
                printed: used.discoveries,
                isGot: (id) => effectiveFact(id, snapshot, clueProg).confirmed,
                discoveriesOf: discoveryList,
                used,
            }),
        );
    if (!lines.length) return { content: '', used };
    let note = pace === 'slow' ? '节奏放慢，细写当下。' : pace === 'fast' ? '节奏加快，次要细节一笔带过。' : '',
        guide = bodyGuideText(settings);
    return {
        content: `<${tag}>
${
    guide
        ? `${guide}

`
        : ''
}${
            note
                ? `${note}
`
                : ''
        }${lines.join(`
`)}
</${tag}>`,
        used,
    };
}

export function claimSnapshot(allFacts, have, claimed) {
    return new Map(
        [...allFacts].map((id) => [
            id,
            have.has(id)
                ? { id, status: 'confirmed', text: '', raw: '已核实' }
                : claimed.has(id)
                  ? { id, status: 'unconfirmed', claimed: !0, text: '', raw: '存疑' }
                  : { id, status: 'unconfirmed', text: '', raw: '未获得' },
        ]),
    );
}

export function clueReachability(volumes, { knownFacts = [], claimedFacts = [] } = {}) {
    let compiled = compileClue(volumes || []),
        have = new Set(knownFacts),
        claimed = new Set(claimedFacts),
        external = /* @__PURE__ */ new Set(),
        cfg = normalizeClue({ mode: 'clue', autoFocusSingle: !1 }),
        gives = new Map(
            compiled.nodes.map((n) => [
                n,
                discoveryList(isPlainObject(n.item) ? n.item : {})
                    .map((d) => d.fact)
                    .filter(Boolean),
            ]),
        ),
        knowActors = /* @__PURE__ */ new Map(),
        assumptions = /* @__PURE__ */ new Set(),
        extAtoms = (cond) => {
            if (cond) {
                if (cond.kind === 'group') return cond.items.forEach(extAtoms);
                if (cond.kind === 'know')
                    return (
                        knowActors.set(cond.fact, (knowActors.get(cond.fact) || /* @__PURE__ */ new Set()).add(cond.actor)),
                        assumptions.add(`${cond.actor} 得知 ${cond.fact}`)
                    );
                ['time', 'cell', 'count'].includes(cond.kind) &&
                    external.add(
                        cond.kind === 'time'
                            ? `时间 ${cond.op} ${cond.value}`
                            : cond.kind === 'count'
                              ? `表格 ${cond.table} 的计数`
                              : `表格 ${cond.path}`,
                    );
            }
        };
    for (let u of compiled.units) u.clue && (extAtoms(u.clue.enter), extAtoms(u.clue.end));
    for (let n of compiled.nodes) [n.open, n.early, n.done].forEach(extAtoms);
    for (let l of compiled.lines || []) extAtoms(l.open);
    for (let [f, ids] of lineTriggerFacts(compiled)) (have.add(f), assumptions.add(`正文里发生线 ${ids.join('、')} 要等的事（${f}）`));
    let allFacts = /* @__PURE__ */ new Set([...have, ...claimed]);
    for (let u of compiled.units)
        u.clue && [u.clue.enter, u.clue.end].forEach((c) => conditionRefs(c).facts.forEach((f) => allFacts.add(f)));
    for (let n of compiled.nodes)
        ([n.open, n.early, n.done].forEach((c) => conditionRefs(c).facts.forEach((f) => allFacts.add(f))),
            gives.get(n).forEach((f) => allFacts.add(f)));
    let state = null,
        lineProg = { lines: {} };
    for (let round = 0; round < 64; round++) {
        let facts = claimSnapshot(allFacts, have, claimed),
            knowledge = [...knowActors].flatMap(([fact, actors]) =>
                have.has(fact) ? [...actors].map((actor) => ({ fact, actor, way: '亲见', verified: !0 })) : [],
            );
        state = computeClueState(compiled, { facts, knowledge, tables: {}, problems: [] }, { ...emptyClueProgress(), ...lineProg }, cfg);
        let before0 = Object.keys(lineProg.lines).length;
        for (let s of state.lineStates || [])
            (s.state === '可开启' || (s.state === '未触发' && s.cond.v === TRI.u)) && (lineProg.lines[s.line.id] = { started: !0 });
        if (Object.keys(lineProg.lines).length !== before0) continue;
        let before = have.size;
        for (let s of state.nodeStates)
            (s.status === 'available' || s.status === 'active' || s.status === 'done') && gives.get(s.node).forEach((f) => have.add(f));
        if (have.size === before) break;
    }
    let stuckStages = [],
        stuckNodes = [],
        depends = !1;
    for (let u of compiled.units) {
        let s = state.stageStates.get(u.id);
        if (s.done) continue;
        let why =
            s.entered.v !== TRI.t
                ? `进不去：${s.entered.reasons.join('；')}`
                : s.requiredLeft.length
                  ? `必需节点做不完：${s.requiredLeft.map((n) => n.uid || n.name).join('、')}`
                  : `结束条件不满足：${s.end.reasons.join('；')}`;
        ((s.entered.v === TRI.u || s.end.v === TRI.u) && (depends = !0),
            stuckStages.push({
                stage: stageLabel(u.stage.key),
                stageId: u.id,
                why,
                line: u.line ? u.line.id : '',
                unknown: s.entered.v === TRI.u || s.end.v === TRI.u,
            }));
    }
    for (let ns of state.nodeStates) {
        if (ns.status === 'done' || !ns.node.required) continue;
        let reason =
            ns.status === 'locked'
                ? `一直打不开：${ns.open.reasons.join('；')}`
                : ns.done.v === TRI.u
                  ? `完成条件判断不了：${ns.done.reasons.join('；')}`
                  : `打开了也完不成：${ns.done.reasons.join('；')}`;
        ((ns.open.v === TRI.u || ns.done.v === TRI.u || !ns.node.done) && (depends = !0),
            stuckNodes.push({
                node: ns.node.uid || ns.node.name,
                nodeName: ns.node.name || ns.node.uid,
                stageId: ns.node.unit.id,
                stage: stageLabel(ns.node.unit.stage.key),
                why: reason,
                line: ns.node.unit.line ? ns.node.unit.line.id : '',
                unknown: ns.open.v === TRI.u || ns.done.v === TRI.u || !ns.node.done,
            }));
    }
    return {
        verdict: !stuckStages.length && !stuckNodes.length ? 'ok' : depends ? 'unknown' : 'blocked',
        stuckStages,
        stuckNodes,
        external: [...external],
        assumptions: [...assumptions],
        obtainable: [...have],
        claimed: [...claimed],
    };
}

export function clueAlternativeRoutes(volumes, { knownFacts = [], claimedFacts = [] } = {}) {
    let compiled = compileClue(volumes || []),
        out = [],
        cfg = normalizeClue({ mode: 'clue', autoFocusSingle: !1 }),
        units = compiled.units,
        claimed = new Set(claimedFacts);
    let gives = (n) =>
        discoveryList(isPlainObject(n.item) ? n.item : {})
            .map((d) => d.fact)
            .filter(Boolean);
    let reach = null,
        obtainable = () => reach || (reach = new Set(clueReachability(volumes, { knownFacts, claimedFacts }).obtainable));
    let all = new Set([...knownFacts, ...claimed]),
        knowActors = /* @__PURE__ */ new Map(),
        knowAtoms = (cond) => {
            if (!cond) return;
            if (cond.kind === 'group') return cond.items.forEach(knowAtoms);
            cond.kind === 'know' && knowActors.set(cond.fact, (knowActors.get(cond.fact) || /* @__PURE__ */ new Set()).add(cond.actor));
        };
    for (let u of units)
        u.clue && [u.clue.enter, u.clue.end].forEach((c) => (conditionRefs(c).facts.forEach((f) => all.add(f)), knowAtoms(c)));
    for (let n of compiled.nodes)
        ([n.open, n.early, n.done].forEach((c) => (conditionRefs(c).facts.forEach((f) => all.add(f)), knowAtoms(c))),
            gives(n).forEach((f) => all.add(f)));
    let snapshot = (have) => ({
        facts: claimSnapshot(all, have, claimed),
        knowledge: [...knowActors].flatMap(([fact, actors]) =>
            have.has(fact) ? [...actors].map((actor) => ({ fact, actor, way: '亲见', verified: !0 })) : [],
        ),
        tables: {},
        problems: [],
    });
    for (let [ui, u] of units.entries()) {
        let own = compiled.nodes.filter((n) => n.unit === u),
            alts = own.filter((n) => n.kind === 'main' && !n.required);
        if (alts.length < 2) continue;
        // 分叉起点：开放条件既不依赖其他可选节点产出的事实，也不引用其他可选节点（含 {任一:[{节点:A},{节点:B}]} 写法）。
        let altFacts = new Set(alts.flatMap(gives)),
            altIds = new Set(alts.map((n) => n.uid).filter(Boolean)),
            starts = alts.filter((n) => {
                let refs = conditionRefs(n.open);
                return (
                    ![...refs.facts].some((f) => altFacts.has(f) && !gives(n).includes(f)) &&
                    ![...refs.nodes].some((id) => altIds.has(id) && id !== n.uid)
                );
            });
        if (starts.length < 2) continue;
        // 起点：之前各阶段按大纲推演确实拿得到的事实。本阶段的必需节点不预先给。
        let base = new Set(knownFacts),
            got = obtainable(),
            required = own.filter((n) => n.required);
        for (let n of compiled.nodes) units.indexOf(n.unit) < ui && gives(n).forEach((f) => got.has(f) && base.add(f));
        if (units.length && computeClueState(compiled, snapshot(base), emptyClueProgress(), cfg).stageStates.get(u.id).entered.v !== TRI.t)
            continue;
        for (let start of starts) {
            // 这条线：起点节点 + 非起点的可选节点（共同后继）+ 本阶段必需节点；另一个起点不参与。都要在推演里开放了才收取产物。
            let allowed = new Set([start, ...alts.filter((n) => !starts.includes(n)), ...required]),
                have = new Set(base),
                used = [start],
                state = null;
            for (let round = 0; round < 32; round++) {
                state = computeClueState(compiled, snapshot(have), emptyClueProgress(), cfg);
                let before = have.size;
                for (let ns of state.nodeStates)
                    allowed.has(ns.node) &&
                        ns.status !== 'locked' &&
                        (ns.node.required || used.includes(ns.node) || used.push(ns.node), gives(ns.node).forEach((f) => have.add(f)));
                if (have.size === before) break;
            }
            // 「下一阶段」只在同一条剧情线内找：线的最后一个阶段之后是另一条独立的线，
            // 那条线等手动开启、等条件都是正常设计，不算这条线走不通。没有线信息的旧大纲仍按整串卷连着算。
            let s = state.stageStates.get(u.id),
                next = units[ui + 1] && units[ui + 1].line === u.line ? units[ui + 1] : null,
                ns = next && state.stageStates.get(next.id),
                tri = (x) => x && x.v;
            let endV = s.done ? TRI.t : s.entered.v !== TRI.t ? tri(s.entered) : s.requiredLeft.length ? TRI.f : tri(s.end),
                nextV = !next ? TRI.t : tri(ns.entered);
            let verdict =
                endV === TRI.t && nextV === TRI.t ? 'ok' : endV === TRI.f || (endV === TRI.t && nextV === TRI.f) ? 'blocked' : 'unknown';
            let why =
                verdict === 'ok'
                    ? ''
                    : endV !== TRI.t
                      ? `本阶段结束${verdict === 'unknown' ? '要看运行时的情况' : '不了'}：${(s.entered.v !== TRI.t ? s.entered.reasons : s.end.reasons).join('；') || s.requiredLeft.map((n) => n.uid).join('、')}`
                      : `下一阶段${verdict === 'unknown' ? '能否进入要看运行时的情况' : '进不去'}：${ns.entered.reasons.join('；')}`;
            // 结构化字段：给审阅页拼人话、跳转、按根因去重用。原来的 stage / node / why 文字不变。
            let need = verdict === 'ok' ? null : endV !== TRI.t ? (s.entered.v !== TRI.t ? u.clue && u.clue.enter : u.clue && u.clue.end) : next && next.clue && next.clue.enter;
            out.push({
                stage: stageLabel(u.stage.key),
                node: used.map((n) => n.uid || n.name).join(' → '),
                ok: verdict !== 'blocked',
                verdict,
                why,
                lineId: u.line ? u.line.id : '',
                volumeId: u.volume ? u.volume.id : '',
                stageId: u.id,
                nodeIds: used.map((n) => n.uid).filter(Boolean),
                nodeNames: used.map((n) => n.name || n.uid),
                at: verdict === 'ok' ? '' : endV !== TRI.t ? (s.entered.v !== TRI.t ? 'enter' : s.requiredLeft.length ? 'required' : 'end') : 'next',
                nextStageId: next ? next.id : '',
                gets: [...have].filter((f) => used.some((n) => gives(n).includes(f))),
                needs: need ? [...conditionRefs(need).facts].filter((f) => !have.has(f)) : [],
                left: s.requiredLeft.map((n) => n.name || n.uid),
            });
        }
    }
    return out;
}

export function tableCondChecks(cond, tables, where = '', out = []) {
    if (!cond) return out;
    if (cond.kind === 'group') return (cond.items.forEach((c) => tableCondChecks(c, tables, where, out)), out);
    if (cond.kind === 'count') {
        let f = findSheet(tables, cond.table),
            bad = f.error
                ? `这张卡没有「${cond.table}」这张表`
                : sheetRows(f.sheet).col(cond.column) < 0
                  ? `「${cond.table}」没有「${cond.column}」这一列`
                  : '';
        out.push({ where, raw: cond.raw, now: '', level: bad ? 'bad' : 'ok', notes: bad ? [bad] : [], stuck: !!bad });
    } else if (cond.kind === 'cell') {
        let r = cellCondCheck(cond, tables);
        out.push({ where, ...r, stuck: r.level === 'bad' || (!!cond.sample && !sampleAgrees(cond)) });
    }
    return out;
}

export function tableCondReport(volumes, tables) {
    let compiled = compileClue(volumes || []),
        out = [],
        visit = (cond, where) => tableCondChecks(cond, tables, where, out);
    for (let l of compiled.lines || []) visit(l.open, `线 ${l.id}「${l.name}」的开启条件`);
    for (let u of compiled.units) u.clue && [u.clue.enter, u.clue.end].forEach((c) => visit(c, stageLabel(u.stage.key)));
    for (let n of compiled.nodes) [n.open, n.early, n.done].forEach((c) => visit(c, `${stageLabel(n.unit.stage.key)}·${n.name}`));
    return out;
}

export function cellCondCheck(cond, tables) {
    let parts = String(cond.path)
            .split('/')
            .map((x) => x.trim()),
        notes = [],
        tierPending = null,
        res = (level, now2 = '') => ({ raw: cond.raw, now: now2, level, notes, ...(tierPending ? { tierPending } : {}) });
    if (parts.length !== 3 || parts.some((x) => !x)) return (notes.push(`路径「${cond.path}」应写成 表/行/列`), res('bad'));
    let [table, rowKey, column] = parts,
        f = findSheet(tables, table);
    if (f.error) return (notes.push(`这张卡没有「${table}」这张表`), res('bad'));
    let { col, rows } = sheetRows(f.sheet),
        c = col(column),
        sheet = f.sheet;
    if ((c < 0 && col(rowKey) >= 0 && ((c = col(rowKey)), (rowKey = column)), c < 0))
        return (notes.push(`「${table}」没有「${column}」这一列`), res('bad'));
    let note = sheet.note || '',
        others = rows
            .filter((r) => cellText(r[1]) !== rowKey && !r.slice(1).some((x) => cellText(x) === rowKey))
            .map((r) => cellText(r[c]))
            .filter(Boolean),
        hits = findRow(rows, rowKey),
        cell = hits.length === 1 ? cellText(hits[0][c]) : '';
    (sheet.freq === 0 && notes.push(`「${table}」设置成不自动更新（更新频率 0），条件可能一直不变`),
        hits.length > 1 && notes.push(`「${table}」里「${rowKey}」有 ${hits.length} 行，读的时候分不清，会一直是未知`),
        hits.length ||
            notes.push(
                others.length
                    ? `表里还没有「${rowKey}」这一行；同一列别的行已经有值（如「${others[0].slice(0, 30)}」），${rowKey}出现在表里以后才开始判断`
                    : rows.length
                      ? `表里还没有「${rowKey}」这一行，同一列也都还没填，等表里有数据再看`
                      : `「${table}」还没有数据，等表里有数据再核对`,
            ));
    let value = cell;
    if (cond.pick) {
        let pool = [cell, ...others].filter(Boolean),
            readable = pool.filter((x) => cellEntries(x).length);
        if (
            (pool.length &&
                !readable.length &&
                notes.push(`「${column}」这一列现在的内容不是按「名字:内容」分条写的，取不出「${cond.pick}」这一项`),
            cell)
        ) {
            let got = pickEntry(cell, cond.pick);
            ((value = got.state === 'ok' ? got.value : ''), got.state !== 'ok' && !/还没有/.test(got.reason) && notes.push(got.reason));
        }
    }
    if (cond.sample) {
        let s = cond.sample,
            real = [cell, ...others].some((x) => x && (x === s.text || x.includes(s.text))) || note.includes(s.text),
            proven = !!(cond.pick && cell && pickEntry(cell, cond.pick).state === 'ok');
        (real || proven || notes.push(`样例的原文「${s.text.slice(0, 30)}」不是表里或说明里的真实内容，证明不了插件读得懂这一列`),
            sampleAgrees(cond) ||
                notes.push(
                    `样例核对没通过：插件从「${s.text.slice(0, 30)}」里取「${s.key}」得到的是「${(s.key ? pickEntry(s.text, s.key).value : s.text) || '（取不出）'}」，AI 说是「${s.want}」。运行时这个条件按「读不出来」处理，不会放宽；可以改成手动开始`,
                ));
    }
    if (cond.tiers) {
        cond.tierOk ||
            tierOrderInNote(note, cond.tiers) ||
            ['==', '!='].includes(cond.op) ||
            ((tierPending = cond.tiers),
            notes.push(`档位顺序「${cond.tiers.join(' < ')}」是 AI 推断的，表格说明里没有明写先后（待确认）。确认之前这个条件是未知`));
        let seen = (t) => note.includes(t) || [cell, ...others].some((x) => x.includes(t)),
            miss = cond.tiers.filter((t) => !seen(t));
        (miss.length && notes.push(`档位里的${miss.map((t) => `「${t}」`).join('、')}在表格说明和现有数据里都没出现，填表不一定会写`),
            value && tierIndex(value, cond.tiers) < 0 && notes.push(`现在的值「${value}」不是档位里的任何一档，这个条件会是未知`));
    } else if (['>=', '<=', '>', '<'].includes(cond.op) && !Number.isFinite(Number(cond.value)))
        notes.push(`「${cond.value}」不是数字，比大小要写档位（从低到高的列表）`);
    else if ((cond.op === '==' || /包含/.test(cond.op)) && cond.value && !Number.isFinite(Number(cond.value))) {
        let pool = [cell, ...others];
        if (!note.includes(cond.value) && !pool.some((x) => x.includes(cond.value))) {
            let long = pool.length && pool.every((x) => x.length > 12);
            notes.push(
                long && cond.op === '=='
                    ? `「${column}」每次填的是一句话，「== ${cond.value}」几乎不会成立，可以改用「包含 关键词」，或者改成等某件事发生`
                    : `「${cond.value}」在表格说明和现有数据里都没出现，填表不一定会写出这个词`,
            );
        }
    }
    let now = hits.length
        ? cond.pick
            ? value
                ? `${cond.pick}：${value}`
                : cell
                  ? `（没有「${cond.pick}」这一项）`
                  : '（空）'
            : cell || '（空）'
        : '';
    return res(notes.length ? 'warn' : 'ok', now);
}

export function focusScore(state, snapshot, clueProg) {
    let focus = state.nodeStates.find((s) => s.node.uid && s.node.uid === state.focus.uid);
    if (!focus) return 0;
    let n = 0;
    for (let d of discoveryList(isPlainObject(focus.node.item) ? focus.node.item : {})) {
        if (!d.fact) continue;
        let f = snapshot.facts && snapshot.facts.get(d.fact),
            over = clueProg && clueProg.factOverrides && clueProg.factOverrides[d.fact];
        effectiveFact(d.fact, snapshot, clueProg).confirmed ? (n += 2) : f && f.claimed && !(over && over.status === 'revoked') && (n += 1);
    }
    return n;
}

// 剧情推进判断玩家这一轮才走进这个场景时加的一句（场景和发现当轮一起给）
export const ARRIVE_RULE = '用户这一轮刚到这里：只写到达时自然看到的、对方主动说出的；需要用户进一步搜查、说服、检验才能得到的，留到用户真的做了再写。';

export const CLUE_OFF_MATERIAL_RULE =
    '用户转去调查另一件事，而本轮材料没有提供那件事的具体发现时，写到到达、接触和开始调查为止：可以写环境、人物和对方的反应；东西上写着什么、翻开或打开后看到什么、对方说出的关键信息，都不要自己编，待后续材料提供后再写。本轮已经提供的发现、前文已经明确的内容以及普通日常行动，可以按实际行动继续，不必机械等到下一轮。';
