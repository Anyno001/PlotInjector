// 跑团项目的线索行按进度预建（用户 2026-11-22；计划：特殊文件/剧情注入器/跑团懒预建线索行计划.md）。
// 线索模式原版一条线开始就把这条线的线索全部建行；跑团模组一般只有一条主线，长模组开局就是整本。
// 这里只挑「眼前要用的」：已经开放/进行中/完成的节点产出的事实（第 0 层），再假设这批都拿到，
// 用线索模式自己的推演看哪些节点会因此开放，把它们的产出加进来（往前推 depth 层）。
// 只在跑团项目调用；普通线索项目不经过这里。已经建了的行不删，由调用方只拿来筛「要不要补」。
import { computeClueState, conditionRefs } from './trpg-clue-rules.js';
import { discoveryList } from './trpg-clue-project.js';
import { isPlainObject } from '../core/outline.js';

export const TRPG_ROW_DEPTH = 1;
export const TRPG_ROW_CAP = 30;

const gives = (n) =>
    discoveryList(isPlainObject(n.item) ? n.item : {})
        .map((d) => d.fact)
        .filter(Boolean);

// compiled：compileClue 的结果；state：当前真实状态；snap：当前读表快照；prog：线索进度；config：项目的 clue 设置。
// 返回 Set（事实编号）。cap 只限制第 1 层以后新加的条数，第 0 层总是全给。
export function trpgWantFacts(compiled, state, snap, prog, config, { depth = TRPG_ROW_DEPTH, cap = TRPG_ROW_CAP } = {}) {
    let want = new Set(),
        have = new Set(),
        add = (ns) => ns.status !== 'locked' && gives(ns.node).forEach((f) => want.add(f));
    for (let ns of (state && state.nodeStates) || []) add(ns);
    for (let [id, f] of (snap && snap.facts) || []) f && f.status === 'confirmed' && have.add(id);
    let knowAtoms = new Set();
    for (let u of compiled.units) u.clue && [u.clue.enter, u.clue.end].forEach((c) => conditionRefs(c).knows.forEach((k) => knowAtoms.add(k)));
    for (let n of compiled.nodes) [n.open, n.early, n.done].forEach((c) => conditionRefs(c).knows.forEach((k) => knowAtoms.add(k)));
    let base = want.size;
    for (let layer = 0; layer < depth && want.size - base < cap; layer++) {
        want.forEach((f) => have.add(f));
        let facts = new Map(snap && snap.facts ? snap.facts : []);
        for (let id of have) facts.set(id, { ...(facts.get(id) || {}), id, status: 'confirmed', raw: '已核实', text: (facts.get(id) || {}).text || '' });
        let knowledge = [
                ...((snap && snap.knowledge) || []),
                ...[...knowAtoms].flatMap((k) => {
                    let i = k.lastIndexOf('@'),
                        fact = k.slice(0, i);
                    return have.has(fact) ? [{ fact, actor: k.slice(i + 1), way: '亲见', verified: !0 }] : [];
                }),
            ],
            sim = computeClueState(compiled, { ...(snap || {}), facts, knowledge }, prog, config),
            before = want.size;
        for (let ns of sim.nodeStates) {
            if (want.size - base >= cap) break;
            add(ns);
        }
        if (want.size === before) break;
    }
    return want;
}

// 模板初始行用：没有节点产出的事实（线的触发事实、孤立事实）照原版始终建行，否则线和条件判断不了。
export function trpgRowFilter(compiled, want) {
    let produced = new Set(compiled.nodes.flatMap(gives));
    return (code) => !produced.has(code) || want.has(code);
}
