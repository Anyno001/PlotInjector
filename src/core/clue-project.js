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
import { findSheet, sheetRows, cellText, findRow, cellEntries, pickEntry, tierOrderInNote, tierIndex } from './clue-tables.js';

import { stripAuthorBlocks, nodeUid, normalizeClue } from './clue-model.js';
import { isPlainObject, stageLabel, flattenUnits, stageNodes, NODE_FIELDS } from './outline.js';

import { bodyGuideText } from './inject.js';

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
                ? { fact: String(d.事实 || d.id || '').trim(), text: clueText(d.内容), record: clueText(d.记录) }
                : { fact: '', text: clueText(d), record: '' },
        )
        .filter((d) => d.text);
}

export function nodeFactRefs(node) {
    let refs = /* @__PURE__ */ new Set();
    // 所在阶段的进入条件也算：门槛事实往往写在阶段上（如「账页 + 证词 → 进入对质」），进了场景正文需要它们。
    let unitEnter = node.unit && node.unit.clue ? node.unit.clue.enter : null;
    for (let cond of [unitEnter, node.open, node.done]) for (let f of conditionRefs(cond).facts) refs.add(f);
    let extra = isPlainObject(node.item) && node.item.相关事实;
    for (let f of Array.isArray(extra) ? extra : extra ? [extra] : []) refs.add(String(f).trim());
    return [...refs].filter(Boolean);
}

export const CLUE_STATUS_TEXT = { locked: '未开放', available: '可进行', active: '进行中', done: '已完成' };

export function clueProgressText(state, snapshot, clueProg, { problems = [] } = {}) {
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
    lines.push(confirmed.length ? '已确认的事实：' : '已确认的事实：暂无', ...confirmed);
    claims.length && lines.push('已经出现、尚未核实的说法：', ...claims);
    problems.length && lines.push('表格问题：', ...problems.slice(0, 5).map((p) => `- ${p}`));
    return lines.join('\n');
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
    // 编号取表中和人工操作的并集（内测前审阅）：执行页「人工确认」的事实可能还没有表格行。
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
    return {
        facts: [...facts.values()],
        knows: [...knows].map((k) => {
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

export function prebuildDiff(plan, snapshot, bindings) {
    let fb = (bindings.facts || [])[0],
        kb = (bindings.knowledge || [])[0],
        haveFacts = snapshot.facts || /* @__PURE__ */ new Map(),
        haveKnows = snapshot.knowPresent || /* @__PURE__ */ new Set(),
        planFacts = new Set(plan.facts.map((f) => f.code));
    return {
        factTable: fb ? fb.表 : '',
        knowTable: kb ? kb.表 : '',
        newFacts: plan.facts.filter((f) => !haveFacts.has(f.code)),
        newKnows: plan.knows.filter((k) => !haveKnows.has(k.key)),
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
    noDone.length && out.push(`这些主线节点没有完成条件，只能人工标记完成：${noDone.join('、')}`);
    let noFind = draft.nodes
        .filter((n) => n.kind === 'main' && !discoveryList(isPlainObject(n.item) ? n.item : {}).length)
        .map((n) => n.uid || n.name);
    if ((noFind.length && out.push(`这些主线节点没有「发现」：${noFind.join('、')}`), !applied)) return out;
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
              notes.push(`阶段「${name}」原来已经进入，改写后会变成「未进入」，这个阶段里的入口会消失`);
    }
    // 失去的入口：原来可进行 / 进行中、改写后不再开放的节点（不论原因：阶段倒退、开放条件被改）。
    let lostEntries = [...before]
        .filter(([uid, s]) => (s.status === 'available' || s.status === 'active') && after.has(uid) && after.get(uid).status === 'locked')
        .map(([uid, s]) => `${uid}「${s.node.name}」`);
    lostEntries.length && notes.push(`改写后这些原来可以去做的事会重新锁上：${lostEntries.join('、')}`);
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
                    `${label}${t ? '里' : '（改写后被删除）中'}已经获得或已经说出的发现 ${lost
                        .map((f) => {
                            let m = movedTo(f);
                            return m ? `${f}（挪到了 ${m[0]}）` : f;
                        })
                        .join('、')} 在原位置不见了；表格里的记录还在，但正文可能把它当成没发生过`,
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
            notes.push(`这次改写会让 ${uid}「${t.node.name}」直接变成已完成（原来：${s ? NODE_STATUS_LABELS[was] : was}），调查会被跳过`);
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
    { pace = 'normal', stay = '', plan = null, notReady = null } = {},
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
            scene && lines.push(`场景（初次到达时的样子；人物态度和环境后来的变化以前文为准，不要重置）：${scene}`));
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
                    (lines.push(`- ${d.text}`),
                        used.discoveries.push(d.fact || d.text.slice(0, 20)),
                        d.fact && used.candidates.push({ fact: d.fact, record: d.record }));
                })));
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
            recordedOr = (id, text) =>
                text ||
                `（${id} 已经${snapshot.facts && snapshot.facts.get(id) && snapshot.facts.get(id).claimed ? '有人说出' : '确认'}，但表格没有记录具体内容；沿用正文里已经写出的部分，不要补充）`;
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
                (known.push(`- ${text || `（${id} 已经确认，但表格没有记录具体内容）`}${whoText(id)}`), used.facts.push(id));
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
                `可用的后续方向：${items.map((x) => x.entry).join('；')}。${offer.hint ? `（由头：${offer.hint}）` : ''}`,
                '只有本轮行动自然涉及它时才接入；否则继续眼前的事，不必提及。尚未进入时不要补写调查结果。',
                ...(offer.kind === 'side' ? ['如果前文已经发生过类似的事，就接着前文写，不要重演。'] : []),
            ),
            (used.offer = offer.line),
            (used.leads = items.map((x) => x.uid)));
        let sidePaused = !!(clueProg && clueProg.sidePaused),
            live = (state.lineStates || []).some((s) => s.state === '进行中' && (s.line.kind === 'main' || !sidePaused));
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
        // 分叉起点：开放条件既不依赖其他可选节点产出的事实，也不引用其他可选节点（内测前审阅：{任一:[{节点:A},{节点:B}]} 写法）。
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
            let s = state.stageStates.get(u.id),
                next = units[ui + 1],
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
            out.push({
                stage: stageLabel(u.stage.key),
                node: used.map((n) => n.uid || n.name).join(' → '),
                ok: verdict !== 'blocked',
                verdict,
                why,
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

export const CLUE_OFF_MATERIAL_RULE =
    '用户转去调查另一件事，而本轮材料没有提供那件事的具体发现时，写到到达、接触和开始调查为止：可以写环境、人物和对方的反应；东西上写着什么、翻开或打开后看到什么、对方说出的关键信息，都不要自己编，待后续材料提供后再写。本轮已经提供的发现、前文已经明确的内容以及普通日常行动，可以按实际行动继续，不必机械等到下一轮。';
