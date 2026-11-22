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

test('compile: sample has no errors', () => {
  assert.deepEqual(C.compileClue(sampleVolumes()).errors, []);
});

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

test('F04: optional side node does not block', () => {
  const r = run(tables([['F00', '已核实', ''], ['FA', '已核实', ''], ['FB', '已核实', '']]));
  assert.equal(r.status.sx, 'available');
  assert.equal(r.state.stageStates.get('s2').done, true);
});

test('F05/F06: pending/unverified/missing are not satisfied', () => {
  let r = run(tables([['F00', '已核实', ''], ['FA', '', ''], ['FB', '陈述', '']]));
  assert.equal(r.status.nA, 'available');
  assert.equal(r.status.nB, 'available');
  const s3 = r.state.stageStates.get('s3');
  assert.equal(s3.entered.v, 'false');
  assert.ok(s3.entered.reasons.some((x) => x.includes('FA待确认')));
  assert.ok(s3.entered.reasons.some((x) => x.includes('FB未核实')));
  // missing table → unknown with explicit reason
  r = run({});
  assert.ok(r.state.problems.includes('缺少表「事实表」'));
  assert.equal(r.state.stageStates.get('s1').done, false);
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

test('withNodeIds: adds missing ids only once, keeps existing', () => {
  const vols = [{ id: 'v', key: 'k', stages: [{ id: 's', key: '阶段一', data: { 主线节点: [{ 名称: 'x' }, { id: 'keep', 名称: 'y' }, '纯文本节点'] } }] }];
  let n = 0;
  const once = C.withNodeIds(vols, () => `gen${n++}`);
  assert.equal(once[0].stages[0].data.主线节点[0].id, 'gen0');
  assert.equal(once[0].stages[0].data.主线节点[1].id, 'keep');
  assert.equal(once[0].stages[0].data.主线节点[2], '纯文本节点');
  assert.equal(C.withNodeIds(once, () => 'never'), once, 'idempotent: same object when nothing to add');
});

test('outline mode: clue fields stripped from injected detail; old behavior otherwise intact', () => {
  const vols = sampleVolumes();
  const units = C.flattenUnits(C.outlineVolumesView(vols));
  const text = C.buildDetailText(units[2], [], { tagName: '剧情参考' });
  assert.ok(!text.includes('作者备注'));
  assert.ok(!text.includes('完成条件'));
  assert.ok(!text.includes('进入条件'));
  // legacy project without clue fields produces byte-identical text either way
  const legacy = [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's', key: '阶段一_x', data: { 时间范围: '一天', 主线节点: [{ 名称: 'a', 事件: 'b' }] } }] }];
  const u1 = C.flattenUnits(legacy)[0], u2 = C.flattenUnits(C.outlineVolumesView(legacy))[0];
  assert.equal(C.buildDetailText(u1, [], {}), C.buildDetailText(u2, [], {}));
});

test('I01/I02: locked author material never appears in clue projection', () => {
  for (const facts of [[['F00', '已核实', '']], [['F00', '已核实', ''], ['FA', '已核实', 'A']]]) {
    const r = run(tables(facts));
    const out = C.buildClueProjection(r.state, r.snap, C.emptyClueProgress(), { tagName: '剧情参考' });
    assert.ok(!out.content.includes(SECRET), 'secret leaked');
    assert.ok(!out.content.includes('查记录A'), 'node titles are not emitted');
    assert.ok(!out.content.includes('仓库'), 'undiscovered finding of non-focused node leaked');
  }
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

test('projection: <仅作者> blocks stripped; known facts list holders only', () => {
  const vols = sampleVolumes();
  vols[0].stages[1].data.主线节点[0].场景 = `档案室<仅作者>${SECRET}</仅作者>`;
  vols[0].stages[1].data.主线节点[0].相关事实 = ['F00'];
  const t = tables([['F00', '已核实', '委托已接']], [['F00', '甲', '已核实']]);
  const compiled = C.compileClue(vols);
  const f = C.readFacts(t, FACT_BIND), k = C.readKnowledge(t, KNOW_BIND);
  const snap = { facts: f.facts, knowledge: k.rows, tables: t };
  const prog = { ...C.emptyClueProgress(), focus: 'nA' };
  const state = C.computeClueState(compiled, snap, prog, C.normalizeClue({ mode: 'clue' }));
  const out = C.buildClueProjection(state, snap, prog, {});
  assert.ok(!out.content.includes(SECRET));
  assert.match(out.content, /委托已接｜知道的人：甲/);
});

test('focus: no keyword guessing; ambiguous parallel nodes yield no focus', () => {
  const r = run(tables([['F00', '已核实', '']]));
  assert.equal(r.state.focus.uid, '');
  const out = C.buildClueProjection(r.state, r.snap, C.emptyClueProgress(), {});
  assert.ok(!out.content.includes('场景：'), 'no scene without focus');
  assert.ok(!out.content.includes('记录显示') && !out.content.includes('车牌'), 'no discoveries without focus');
  assert.match(out.content, /去档案室查记录/);
  assert.match(out.content, /找证人B谈谈/);
});

test('cycle in node references is reported, not infinite', () => {
  const vols = sampleVolumes();
  vols[0].stages[1].data.主线节点[0].完成条件 = '节点: nB';
  vols[0].stages[1].data.主线节点[1].完成条件 = '节点: nA';
  const r = run(tables([['F00', '已核实', '']]));
  const compiled = C.compileClue(vols);
  const state = C.computeClueState(compiled, r.snap, C.emptyClueProgress(), r.cfg);
  assert.ok(state.cycles.length > 0);
});

test('readCell: duplicate table names and rows are unknown', () => {
  const t = { a: { name: 'X', content: [[null, 'k', 'v'], [null, 'r', 1]] }, sheet_b: { name: 'X', content: [[null, 'k', 'v']] }, sheet_a: { name: 'X', content: [[null, 'k', 'v'], [null, 'r', 1], [null, 'r', 2]] } };
  assert.equal(C.readCell(t, 'X/r/v').state, 'unknown');
  const t2 = { sheet_a: { name: 'X', content: [[null, 'k', 'v'], [null, 'r', 1], [null, 'r', 2]] } };
  assert.match(C.readCell(t2, 'X/r/v').reason, /重复/);
});

test('YAML: recommended object syntax parses and evaluates; invalid compact form is a YAML error', async () => {
  const { default: YAML } = await import('yaml');
  const doc = YAML.parse(`
开放条件:
  全部:
    - 事实: F00
    - 表: 控制表/M01/启用 == 1
完成条件:
  事实: FA
进入条件:
  任一:
    - 全部:
        - 事实: FA
        - 事实: FB
    - 事实: F紧急
提前条件: {时间: ">= 第2天"}
`);
  const t = tables([['F00', '已核实', ''], ['FA', '已核实', ''], ['FB', '已核实', '']]);
  const f = C.readFacts(t, FACT_BIND);
  const env = { facts: f.facts, knowledge: [], tables: t, nodeDone: () => false, timePath: '控制表/M01/日期' };
  for (const key of ['开放条件', '完成条件', '进入条件', '提前条件']) {
    const errs = [];
    const cond = C.parseCondition(doc[key], errs);
    assert.deepEqual(errs, [], key);
    assert.equal(C.evalCondition(cond, env).v, 'true', key);
  }
  assert.throws(() => YAML.parse('完成条件: 事实: FA'));
  // time without a binding is unknown, never derived from chat length
  assert.equal(C.evalCondition(C.parseCondition({ 时间: '>= 第1天' }), { ...env, timePath: '' }).v, 'unknown');
});

test('no completion condition → never auto-done; manual mark works', () => {
  const vols = sampleVolumes();
  delete vols[0].stages[0].data.主线节点[0].完成条件;
  const r = run(tables([['F00', '已核实', '']]));
  const compiled = C.compileClue(vols);
  let st = C.computeClueState(compiled, r.snap, C.emptyClueProgress(), r.cfg);
  assert.notEqual(st.nodeStates.find((x) => x.node.uid === 'n1').status, 'done');
  st = C.computeClueState(compiled, r.snap, { ...C.emptyClueProgress(), overrides: { n1: { done: 'force' } } }, r.cfg);
  assert.equal(st.nodeStates.find((x) => x.node.uid === 'n1').status, 'done');
});

test('real ST: manual focus on a node that then completes → "manualDone", not "stale"', () => {
  // (with only one main node left, auto-focus takes over first — turn it off to isolate the manual case)
  const cfg = C.normalizeClue({ mode: 'clue', autoFocusSingle: false, bindings: { facts: FACT_BIND, knowledge: KNOW_BIND } });
  const prog = { ...C.emptyClueProgress(), focus: 'nA' };
  let r = run(tables([['F00', '已核实', '']]), prog, cfg);
  assert.deepEqual(r.state.focus, { uid: 'nA', source: 'manual' });
  r = run(tables([['F00', '已核实', ''], ['FA', '已核实', '记录A']]), prog, cfg);
  assert.equal(r.status.nA, 'done');
  assert.deepEqual(r.state.focus, { uid: '', source: 'manualDone' });
  // a manual focus on a node that is no longer usable for another reason stays "stale"
  r = run(tables([]), { ...C.emptyClueProgress(), focus: 'nA' }, cfg);
  assert.equal(r.state.focus.source, 'stale');
});

test('real ST: a leftover optional node in an ended stage is offered but never auto-focused', () => {
  const vols = [{ id: 'v', key: '剧情_卷一', stages: [
    { id: 's1', key: '阶段一_a', data: { 结束条件: { 事实: 'F1' }, 主线节点: [
      { id: 'n1', 名称: '必做', 入口: '去甲处', 发现: [{ 事实: 'F1', 内容: 'c' }], 完成条件: { 事实: 'F1' } },
      { id: 'n2', 名称: '可选', 入口: '去乙处', 必需: false, 发现: [{ 事实: 'F2', 内容: 'c' }], 完成条件: { 事实: 'F2' } },
    ] } },
    { id: 's2', key: '阶段二_b', data: { 主线节点: [{ id: 'n3', 名称: '收尾', 入口: '去丙处', 发现: [{ 事实: 'F3', 内容: 'c' }], 完成条件: { 事实: 'F3' } }] } },
  ] }];
  const cfg = C.normalizeClue({ mode: 'clue', bindings: { facts: FACT_BIND, knowledge: KNOW_BIND } });
  const at = (rows) => {
    const t = tables(rows), f = C.readFacts(t, FACT_BIND), k = C.readKnowledge(t, KNOW_BIND);
    return C.computeClueState(C.compileClue(vols), { facts: f.facts, knowledge: k.rows, tables: t, problems: [] }, C.emptyClueProgress(), cfg);
  };
  // stage 1 ended, stage 2 running: the only current-stage main node is focused, not the leftover n2
  let st = at([['F1', '已核实', '']]);
  assert.equal(st.focus.uid, 'n3');
  assert.equal(st.nodeStates.find((s) => s.node.uid === 'n2').status, 'available', 'leftover still offered as a lead');
  // everything ended: the leftover is NOT pushed as the scene
  st = at([['F1', '已核实', ''], ['F3', '已核实', '']]);
  assert.deepEqual(st.focus, { uid: '', source: 'none' });
  assert.equal(st.nodeStates.find((s) => s.node.uid === 'n2').status, 'available');
});

test('time binding: list of paths, first filled one wins (default 全局数据表, fallback 线索控制表)', () => {
  const vols = [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's1', key: '阶段一_a', data: { 主线节点: [
    { id: 'n1', 名称: '甲', 入口: 'e', 开放条件: { 事实: 'FX' }, 提前条件: { 时间: '>= 2026-03-16' }, 发现: [{ 事实: 'F1', 内容: 'c' }], 完成条件: { 事实: 'F1' } },
  ] } }] }];
  const binding = C.normalizeClue({ mode: 'clue', bindings: { facts: FACT_BIND, time: { 路径: ['全局数据表/全局状态/当前时间', '线索控制表/主线/当前时间'] } } });
  assert.deepEqual(binding.bindings.time, { 路径: ['全局数据表/全局状态/当前时间', '线索控制表/主线/当前时间'] });
  const at = (globalTime, ctrlTime) => {
    const t = {
      ...tables([]),
      sheet_g: { name: '全局数据表', content: [[null, '全局状态', '当前详细地点', '当前时间'], [null, '全局状态', '码头', globalTime]] },
      sheet_x: { name: '线索控制表', content: [[null, '标识', '当前场景', '当前时间'], [null, '主线', '', ctrlTime]] },
    };
    const f = C.readFacts(t, FACT_BIND);
    return C.computeClueState(C.compileClue(vols), { facts: f.facts, knowledge: [], tables: t, problems: [] }, C.emptyClueProgress(), binding).nodeStates[0];
  };
  assert.notEqual(at('2026-03-16 02:00', '').status, 'locked', 'global table time used');
  assert.equal(at('2026-03-15 18:00', '2026-03-17 00:00').status, 'locked', 'global wins even if the old column says later');
  assert.notEqual(at('', '2026-03-16 08:00').status, 'locked', 'falls back to the control table when global is empty');
  assert.equal(at('', '').status, 'locked', 'neither filled → unknown → not opened');
  // single string still works
  assert.deepEqual(C.normalizeClue({ mode: 'clue', bindings: { time: { 路径: '控制表/M01/日期' } } }).bindings.time, { 路径: '控制表/M01/日期' });
});

test('pause op: anchored like other manual ops; rolls back when its floor is removed', () => {
  const chat = [{ is_user: true, mes: 'a', send_date: '1' }, { is_user: false, mes: 'b', send_date: '2', swipe_id: 0 }];
  let ops = C.addClueOp(C.normalizeClueOps({}), chat, { kind: 'pause', target: 'main', value: true });
  assert.equal(C.effectiveClueProgress(ops, chat).paused, true);
  const later = [...chat, { is_user: true, mes: 'c', send_date: '3' }, { is_user: false, mes: 'd', send_date: '4', swipe_id: 0 }];
  ops = C.addClueOp(ops, later, { kind: 'pause', target: 'main', value: '' });
  assert.equal(C.effectiveClueProgress(ops, later).paused, false, 'resumed');
  assert.equal(C.effectiveClueProgress(ops, chat).paused, true, 'deleting the resume floor brings the pause back');
  assert.equal(C.effectiveClueProgress(ops, chat.slice(0, 1)).paused, false, 'deleting the pause floor too → running');
});
