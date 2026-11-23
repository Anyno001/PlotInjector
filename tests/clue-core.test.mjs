import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';

const C = loadCore();

// 匿名通用示例：阶段二两个必需节点 A/B（先后不限），阶段三需要两条事实。
const SECRET = 'XYZZY_未来答案_唯一测试串';
function sampleVolumes() {
  return [{
    id: 'v1', key: '剧情_卷一_测试', stages: [
      { id: 's1', key: '阶段一_开端', data: { 主线节点: [{ id: 'n1', 名称: '接受委托', 场景: '委托人来访', 完成条件: { 事实: 'F00' } }] } },
      { id: 's2', key: '阶段二_调查', data: {
        AI指令: '调查阶段',
        主线节点: [
          { id: 'nA', 名称: '查记录A', 入口: '去档案室查记录', 场景: '档案室', 发现: [{ 事实: 'FA', 内容: '记录显示设备来自仓库' }], 完成条件: { 事实: 'FA' } },
          { id: 'nB', 名称: '访谈B', 入口: '找证人B谈谈', 场景: '证人家', 发现: [{ 事实: 'FB', 内容: '证人看到了车牌' }], 完成条件: { 事实: 'FB' } },
        ],
        支线事件: [{ id: 'sx', 名称: '可选闲聊', 必需: false, 入口: '去咖啡店', 完成条件: '事实: FX' }],
      } },
      { id: 's3', key: `阶段三_${SECRET}`, data: {
        进入条件: { 全部: [{ 事实: 'FA' }, { 事实: 'FB' }] },
        主线节点: [{ id: 'nC', 名称: `对质${SECRET}`, 场景: `仓库里藏着${SECRET}`, 作者备注: SECRET, 完成条件: '事实: FC' }],
      } },
    ],
  }];
}
const FACT_BIND = [{ 表: '事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实', 内容列: '内容' }];
const KNOW_BIND = [{ 表: '知情表', 事实列: '事实', 角色列: '持有人', 可信度列: '可信度', 已核实值: '已核实' }];
function tables(factRows = [], knowRows = []) {
  return {
    sheet_f: { name: '事实表', content: [[null, '编号', '状态', '内容'], ...factRows.map((r) => [null, ...r])] },
    sheet_k: { name: '知情表', content: [[null, '事实', '持有人', '可信度'], ...knowRows.map((r) => [null, ...r])] },
    sheet_c: { name: '控制表', content: [[null, '案件', '启用', '日期'], [null, 'M01', 1, '第3天']] },
  };
}
function run(t, prog = C.emptyClueProgress(), config) {
  const compiled = C.compileClue(sampleVolumes());
  const f = C.readFacts(t, FACT_BIND), k = C.readKnowledge(t, KNOW_BIND);
  const snap = { facts: f.facts, knowledge: k.rows, tables: t, problems: [...f.problems, ...k.problems] };
  const cfg = config || C.normalizeClue({ mode: 'clue', bindings: { facts: FACT_BIND, knowledge: KNOW_BIND, time: { 路径: '控制表/M01/日期' } } });
  const state = C.computeClueState(compiled, snap, prog, cfg);
  const status = Object.fromEntries(state.nodeStates.map((s) => [s.node.uid, s.status]));
  return { compiled, snap, state, status, cfg };
}


test('F03: A→B and B→A both work; one alone does not end stage', () => {
  let r = run(tables([['F00', '已核实', '委托已接']]));
  assert.equal(r.status.nA, 'available');
  assert.equal(r.status.nB, 'available');
  assert.equal(r.status.nC, 'locked');
  r = run(tables([['F00', '已核实', ''], ['FA', '已核实', '记录A']]));
  assert.equal(r.status.nA, 'done');
  assert.equal(r.status.nC, 'locked');
  assert.equal(r.state.stageStates.get('s2').done, false);
  r = run(tables([['F00', '已核实', ''], ['FB', '已核实', '证词B']]));
  assert.equal(r.status.nB, 'done');
  assert.equal(r.status.nC, 'locked');
  r = run(tables([['F00', '已核实', ''], ['FA', '已核实', ''], ['FB', '已核实', '']]));
  assert.equal(r.status.nC, 'active', 'single available main node becomes auto focus');
});



test('F07: manual open ≠ granted fact; manual done; undo', () => {
  let prog = { ...C.emptyClueProgress(), overrides: { nC: { open: 'force' } } };
  let r = run(tables([['F00', '已核实', '']]), prog);
  assert.equal(r.status.nC === 'available' || r.status.nC === 'active', true);
  assert.equal(r.state.stageStates.get('s2').done, false, 'opening a node does not complete prerequisites');
  prog = { ...C.emptyClueProgress(), overrides: { nA: { done: 'force' }, nB: { done: 'force' } } };
  r = run(tables([['F00', '已核实', '']]), prog);
  assert.equal(r.status.nA, 'done');
  // stage 3 needs facts, not nodes: still locked
  assert.equal(r.status.nC, 'locked');
  prog = { ...C.emptyClueProgress(), factOverrides: { FA: { status: 'confirmed' }, FB: { status: 'confirmed' } } };
  r = run(tables([['F00', '已核实', '']]), prog);
  assert.notEqual(r.status.nC, 'locked');
  prog = { ...C.emptyClueProgress(), factOverrides: { FA: { status: 'revoked' } } };
  r = run(tables([['F00', '已核实', ''], ['FA', '已核实', '']]), prog);
  assert.notEqual(r.status.nA, 'done');
});

test('knowledge: 知情 = has a record (any credibility); 核实 = verified; no auto propagation', () => {
  const t = tables([['F00', '已核实', '']], [['FA', '甲', '已核实'], ['FB', '乙', '陈述']]);
  const r = run(t);
  const env = { facts: r.snap.facts, knowledge: r.snap.knowledge, tables: t, nodeDone: () => false };
  const ev = (s) => C.evalCondition(C.parseCondition(s), env).v;
  assert.equal(ev('知情: FA@甲'), 'true');
  assert.equal(ev('知情: FA@乙'), 'unknown', 'no record → unknown, not propagated from 甲');
  assert.equal(ev('知情: FB@乙'), 'true', 'a rumor still counts as knowing');
  assert.equal(ev('核实: FB@乙'), 'false', 'but not as verified');
  assert.equal(ev('核实: FA@甲'), 'true');
  assert.equal(ev({ 知情: 'FB@乙' }), 'true', 'object form');
});

test('conditions: any/all groups, cell & time compare, depth limit', () => {
  const t = tables();
  const env = { facts: new Map(), knowledge: [], tables: t, nodeDone: () => false, timePath: '控制表/M01/日期' };
  const ev = (v) => C.evalCondition(C.parseCondition(v), env).v;
  assert.equal(ev('表: 控制表/M01/启用 == 1'), 'true');
  assert.equal(ev('表: 控制表/M01/启用 == 0'), 'false');
  assert.equal(ev('表: 控制表/M01/不存在 == 0'), 'unknown');
  assert.equal(ev('时间 >= 第2天'), 'true');
  assert.equal(ev('时间 >= 第5天'), 'false');
  assert.equal(ev({ 任一: ['事实: Z', '表: 控制表/M01/启用 == 1'] }), 'true');
  assert.equal(ev({ 任一: ['事实: Z', '表: 控制表/M01/启用 == 0'] }), 'unknown');
  const errs = [];
  C.parseCondition({ 全部: [{ 任一: [{ 全部: ['事实: A'] }] }] }, errs);
  assert.ok(errs.some((e) => e.includes('两层')));
  const errs2 = [];
  C.parseCondition('瞎写的条件', errs2);
  assert.equal(errs2.length, 1);
});

test('F02/F11: stable ids survive reorder; bad refs and duplicates reported', () => {
  const vols = sampleVolumes();
  const s2 = vols[0].stages[1].data.主线节点;
  vols[0].stages[1].data.主线节点 = [s2[1], s2[0]];
  const r = C.compileClue(vols);
  assert.deepEqual(r.errors, []);
  vols[0].stages[2].data.主线节点[0].开放条件 = '节点: 不存在';
  vols[0].stages[0].data.主线节点[0].id = 'nA';
  const errs = C.compileClue(vols).errors;
  assert.ok(errs.some((e) => e.includes('不存在')));
  assert.ok(errs.some((e) => e.includes('重复')));
});




test('projection: focused node gives scene + pending discoveries, other leads give only entry text', () => {
  const prog = { ...C.emptyClueProgress(), focus: 'nA' };
  const r = run(tables([['F00', '已核实', '']]), prog);
  const out = C.buildClueProjection(r.state, r.snap, prog, { tagName: '剧情参考' });
  assert.match(out.content, /档案室/);
  assert.match(out.content, /记录显示设备来自仓库/);
  assert.match(out.content, /尚未发生/);
  assert.match(out.content, /找证人B谈谈/);
  assert.ok(!out.content.includes('证人看到了车牌'), 'non-focused discovery leaked');
  assert.equal(out.used.focus, 'nA');
});










