// 跑团项目线索行按进度预建（core/trpg-rows.js）：只挑眼前要用的事实。样本自造。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import * as R from '../src/core/trpg-rows.js';

const C = loadCore();

// 三个阶段一路往下：每阶段两个节点，第二个节点要第一个的事实才开；阶段结束要第二个节点的事实。
function linear() {
    let stage = (i) => ({
        id: `s${i}`,
        key: `阶段${i}_第${i}幕`,
        data: {
            结束条件: { 事实: `F${i}b` },
            主线节点: [
                { id: `n${i}a`, 名称: `甲${i}`, 入口: `去甲${i}`, 发现: [{ 事实: `F${i}a`, 内容: `甲${i}的线索` }], 完成条件: { 事实: `F${i}a` } },
                { id: `n${i}b`, 名称: `乙${i}`, 入口: `去乙${i}`, 开放条件: { 事实: `F${i}a` }, 发现: [{ 事实: `F${i}b`, 内容: `乙${i}的线索` }], 完成条件: { 事实: `F${i}b` } },
            ],
        },
    });
    return [{ id: 'v1', key: '剧情_卷一_测试', stages: [stage(1), stage(2), stage(3)] }];
}

function want(vols, got = [], opts) {
    let compiled = C.compileClue(vols),
        facts = new Map(got.map((id) => [id, { id, status: 'confirmed', text: '', raw: '已核实' }])),
        snap = { facts, knowledge: [], tables: {}, problems: [] },
        prog = C.emptyClueProgress(),
        cfg = C.normalizeClue({ mode: 'clue', autoFocusSingle: !1 }),
        state = C.computeClueState(compiled, snap, prog, cfg);
    return [...R.trpgWantFacts(compiled, state, snap, prog, cfg, opts)].sort();
}

test('开局：只有第一阶段眼前的节点，加上「只差它就能开」的下一个节点', () => {
    assert.deepEqual(want(linear()), ['F1a', 'F1b']);
});

test('推进以后：拿到的越多，往后补的越多；已经拿到的不丢', () => {
    assert.deepEqual(want(linear(), ['F1a']), ['F1a', 'F1b', 'F2a']);
    assert.deepEqual(want(linear(), ['F1a', 'F1b']), ['F1a', 'F1b', 'F2a', 'F2b']);
});

test('往前推几层可以调；上限只管第 1 层以后', () => {
    assert.deepEqual(want(linear(), [], { depth: 0 }), ['F1a']);
    assert.deepEqual(want(linear(), [], { depth: 3 }), ['F1a', 'F1b', 'F2a', 'F2b']);
    assert.deepEqual(want(linear(), [], { depth: 3, cap: 1 }), ['F1a', 'F1b']);
});

test('「任一」条件：任何一支满足就算能开', () => {
    let vols = linear();
    vols[0].stages[0].data.主线节点.push({ id: 'n1c', 名称: '丙', 入口: '去丙', 开放条件: { 任一: [{ 事实: 'F1a' }, { 事实: 'F9' }] }, 发现: [{ 事实: 'F1c', 内容: '丙的线索' }] });
    assert.ok(want(vols).includes('F1c'));
});

test('没有节点产出的事实（线的触发、孤立事实）模板里始终保留', () => {
    let compiled = C.compileClue(linear()),
        keep = R.trpgRowFilter(compiled, new Set(['F1a']));
    assert.equal(keep('F1a'), true);
    assert.equal(keep('F3b'), false);
    assert.equal(keep('F_orphan'), true);
});
