// 多线方案第 A 步（2026-11-09）：卷上的「线」、线的状态、线:/计数: 条件、按线的阶段链、按线的人工操作。只算、只显示，不改注入。
// 验收场景来自 GPT 多线审阅 §9 和方案第八节。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCore } from './load.mjs';

const C = loadCore();
const srcDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '../src');
const S = C;

// 表格快照：关系表（姓名在第二列，第一列是行号，和默认模板的重要角色表一样）。
const sheet = (name, head, rows) => ({ name, content: [[null, ...head], ...rows.map((r, i) => [String(i + 1), ...r])] });
const tablesWith = (stage) => ({ sheet_rel: sheet('关系表', ['姓名', '阶段'], [['巴基', String(stage)], ['叶莲娜', '1'], ['沃克', '3']]) });
const facts = (list = {}) => new Map(Object.entries(list).map(([id, raw]) => [id, { id, status: raw === '已核实' ? 'confirmed' : 'unconfirmed', claimed: raw === '存疑', raw }]));
const snap = ({ stage = 1, f = {} } = {}) => ({ facts: facts(f), knowledge: [], tables: tablesWith(stage), problems: [] });
const prog = (extra = {}) => ({ focus: '', overrides: {}, factOverrides: {}, lines: {}, ...extra });
const node = (id, gives, extra = {}) => ({ id, 名称: id, 入口: `去${id}`, 发现: [{ 事实: gives, 内容: `${gives}的内容` }], 完成条件: { 事实: gives }, ...extra });

const VOLS = () => [
  { id: 'v1', key: '剧情_M1_非法设备', line: { 编号: 'M1', 类型: '主线', 简介: '街区里出现了非法设备。' }, stages: [
    { id: 's1', key: '阶段1_调查', data: { 主线节点: [node('m1a', 'F_m1a')] } },
    { id: 's2', key: '阶段2_收尾', data: { 主线节点: [node('m1b', 'F_m1b')] } },
  ] },
  { id: 'v2', key: '剧情_S07_电影院', line: { 编号: 'S07', 类型: '支线', 简介: '巴基想找回一家电影院。', 开启条件: { 全部: [{ 线: 'M1 == 开过' }, { 表: '关系表/巴基/阶段 >= 2' }] }, 开场事实: 'F_s07_open', 入口提示: '巴基总盯着旧海报。' }, stages: [
    { id: 's3', key: '阶段1_找线索', data: { 主线节点: [node('s7a', 'F_s7a')] } },
  ] },
  { id: 'v3', key: '剧情_S10_后续', line: { 编号: 'S10', 类型: '支线', 开启条件: { 线: 'S07 == 完成' } }, stages: [
    { id: 's4', key: '阶段1_后续', data: { 主线节点: [node('s10a', 'F_s10a')] } },
  ] },
];
const run = (s, p = prog(), vols = VOLS()) => {
  const compiled = C.compileClue(vols);
  const state = C.computeClueState(compiled, s, p, C.normalizeClue({ mode: 'clue' }));
  return { compiled, state, line: (id) => state.lineStates.find((x) => x.line.id === id), node: (id) => state.nodeStates.find((x) => x.node.uid === id) };
};

test('outline text: 线 is the volume\'s attributes, not a stage; it survives export and re-import', () => {
  const text = C.outlineToText(VOLS());
  assert.match(text, /剧情_S07_电影院:\n {2}线:\n {4}编号: S07/, 'line block is the first key of the volume');
  const back = C.parseOutlineText(text);
  assert.equal(back.length, 3);
  assert.deepEqual(back[1].stages.map((s) => s.key), ['阶段1_找线索'], '线 is not parsed as a stage');
  assert.equal(back[1].line.编号, 'S07');
  assert.equal(back[1].line.入口提示, '巴基总盯着旧海报。');
  // a volume without 线 is unchanged
  const plain = C.parseOutlineText('剧情_卷一:\n  阶段一:\n    主线节点: [a]\n');
  assert.equal(plain[0].line, undefined);
});

test('store: line attributes are kept through normalizeProject (save / reload / backup restore)', () => {
  const p = S.normalizeProject({ name: 'x', outline: { volumes: VOLS() } }, 'p1');
  assert.equal(p.outline.volumes[1].line.编号, 'S07');
  assert.equal(p.outline.volumes[0].line.类型, '主线');
});

test('compile: line ids, kinds, modes; errors for missing id, duplicate id, unknown line reference, 等开场 without an opening fact', () => {
  const { compiled } = run(snap());
  // 第 B 步：主线条件满足即开始，支线走进去才开始（旧写法「等开场」当成走进去才开始）。
  assert.deepEqual(compiled.lines.map((l) => [l.id, l.kind, l.mode]), [['M1', 'main', 'auto'], ['S07', 'side', 'enter'], ['S10', 'side', 'enter']]);
  assert.deepEqual(compiled.errors, []);
  const bad = VOLS();
  bad[1].line = { 类型: '支线' };
  bad[2].line = { 编号: 'M1', 开启条件: { 线: 'S99 == 完成' } };
  bad.push({ id: 'v4', key: '剧情_S11', line: { 编号: 'S11', 开启方式: '等开场' }, stages: [{ id: 's5', key: '阶段1', data: { 主线节点: [node('x1', 'F_x1')] } }] });
  const errs = C.compileClue(bad).errors.join('\n');
  assert.match(errs, /缺少编号/);
  assert.match(errs, /编号「M1」和别的线重复/);
  assert.doesNotMatch(errs, /没写开场事实/, '等开场 without an opening fact is just 走进去才开始 now');
  const ref = VOLS(); ref[2].line.开启条件 = { 线: 'S99 == 完成' };
  assert.match(C.compileClue(ref).errors.join(), /引用了不存在的线「S99」/);
});

test('conditions: 线 / 计数 parse; full-width ops and a pasted <if cell="…"> are accepted', () => {
  assert.equal(C.parseAtom('线: S07 == 完成').kind, 'line');
  assert.equal(C.parseAtom('线: S07 == 开过').state, '开过');
  // 导入审阅总方案 H / GPT 审阅 R6：「结束」= 完成或放弃，是合法的线状态
  assert.equal(C.parseAtom('线: S07 == 结束').state, '结束');
  assert.equal(C.parseAtom('线: S07 == 已结束').kind, 'bad');
  const pasted = C.parseAtom('<if cell="关系表/巴基/阶段 ≥ 2">');
  assert.deepEqual([pasted.kind, pasted.path, pasted.op, pasted.value], ['cell', '关系表/巴基/阶段', '>=', '2']);
  const full = C.parseAtom('表: 关系表/巴基/阶段 ＞＝ 2');
  assert.equal(full.op, '>=');
  const cnt = C.parseCondition({ 计数: { 表: '关系表', 条件: '阶段 >= 2', 至少: 2 } });
  assert.deepEqual([cnt.kind, cnt.table, cnt.column, cnt.op, cnt.value, cnt.cmp, cnt.n], ['count', '关系表', '阶段', '>=', '2', '至少', 2]);
  const errs = []; C.parseCondition({ 计数: { 表: '关系表', 条件: '阶段' } }, errs);
  assert.match(errs.join(), /计数条件缺少/);
});

test('cells: the row is found by the first column, else by any cell (like the database); swapped row/column is retried; missing stays unknown', () => {
  const t = { sheet_c: { name: '重要角色表', content: [[null, '姓名', '在场状态'], ['1', '巴基', '在场'], ['2', '沃克', '离场']] } };
  assert.equal(C.readCell(t, '重要角色表/巴基/在场状态').value, '在场');
  const byAny = { sheet_c: { name: '角色', content: [[null, '行号', '姓名', '阶段'], ['1', 'r1', '巴基', '2']] } };
  assert.equal(C.readCell(byAny, '角色/巴基/阶段').value, '2', 'name is not in the first column');
  assert.equal(C.readCell(t, '重要角色表/在场状态/巴基').value, '在场', 'row and column written the other way round');
  assert.match(C.readCell(t, '重要角色表/索尔/在场状态').reason, /没有行「索尔」/);
  assert.match(C.readCell(t, '关系表/巴基/阶段').reason, /缺少表「关系表」/);
});

test('count: rows matching a column test; a missing table or column is unknown, not zero', () => {
  const env = (tables) => ({ facts: new Map(), knowledge: [], tables, nodeDone: () => false });
  const at = (n) => C.parseCondition({ 计数: { 表: '关系表', 条件: '阶段 >= 2', 至少: n } });
  assert.equal(C.evalCondition(at(2), env(tablesWith(2))).v, C.TRI.t, '巴基 2, 沃克 3');
  assert.equal(C.evalCondition(at(3), env(tablesWith(2))).v, C.TRI.f);
  assert.match(C.evalCondition(at(3), env(tablesWith(2))).reasons.join(), /有2行/);
  assert.equal(C.evalCondition(at(1), env({})).v, C.TRI.u, 'no table: unknown');
  assert.equal(C.evalCondition(C.parseCondition({ 计数: { 表: '关系表', 条件: '好感 >= 2', 至少: 1 } }), env(tablesWith(2))).v, C.TRI.u, 'no column: unknown');
});

test('threshold reached but no opening yet: the side line is only 可开启; its nodes are not usable', () => {
  const r = run(snap({ stage: 2 }));
  assert.equal(r.line('M1').state, '进行中', 'main line without conditions starts by itself');
  assert.equal(r.line('S07').state, '可开启');
  assert.equal(r.node('s7a').status, 'locked');
  assert.match(r.node('s7a').open.reasons.join(), /所在的线 S07 可开启/);
  assert.equal(r.line('S10').state, '未触发');
  // below the threshold: 未触发, and the reason says what it waits for
  const low = run(snap({ stage: 1 }));
  assert.equal(low.line('S07').state, '未触发');
  assert.match(low.line('S07').cond.reasons.join(), /关系表\/巴基\/阶段 = 1/);
});

test('the opening fact (even 存疑) starts the line; it stays started when the relationship drops afterwards', () => {
  const r = run(snap({ stage: 2, f: { F_s07_open: '存疑' } }));
  assert.equal(r.line('S07').state, '进行中');
  assert.match(r.line('S07').why, /开场事实F_s07_open已出现/);
  assert.equal(r.node('s7a').status, 'available');
  const dropped = run(snap({ stage: 1, f: { F_s07_open: '存疑' } }));
  assert.equal(dropped.line('S07').state, '进行中', 'condition changed afterwards: not undone');
});

test('a manual start (anchored to a floor) starts the line even without the opening fact; rolling the floor back undoes it', () => {
  const chat = [{ is_user: false, mes: 'a', swipe_id: 0, send_date: 't0' }, { is_user: false, mes: 'b', swipe_id: 0, send_date: 't1' }];
  const ops = C.addClueOp({ ops: [] }, chat, { kind: 'line', target: 'S07', value: 'start' });
  let p = C.effectiveClueProgress(ops, chat);
  assert.equal(p.lines.S07.started, true);
  assert.equal(p.lines.S07.startAt, 1, 'the start remembers its floor');
  assert.equal(run(snap({ stage: 1 }), { ...prog(), ...p }).line('S07').state, '进行中', 'manual start ignores the threshold');
  p = C.effectiveClueProgress(ops, chat.slice(0, 1));
  assert.deepEqual(p.lines, {}, 'the floor holding the start was deleted');
  assert.equal(run(snap({ stage: 1 }), { ...prog(), ...p }).line('S07').state, '未触发');
  // start, then pause on the same floor: both kept (the start is not compacted away)
  const both = C.addClueOp(ops, chat, { kind: 'line', target: 'S07', value: 'pause' });
  const bp = C.effectiveClueProgress(both, chat).lines.S07;
  assert.deepEqual([bp.started, bp.state], [true, 'pause']);
  const resumed = C.effectiveClueProgress(C.addClueOp(both, chat, { kind: 'line', target: 'S07', value: 'resume' }), chat);
  assert.deepEqual([resumed.lines.S07.started, resumed.lines.S07.state], [true, undefined]);
});

test('paused / done / abandoned lines: nodes unusable; manual open cannot bypass a line that is not in progress', () => {
  const s = snap({ stage: 2, f: { F_s07_open: '存疑' } });
  for (const [v, label] of [['pause', '暂停'], ['done', '完成'], ['abandon', '放弃']]) {
    const r = run(s, prog({ lines: { S07: { started: true, state: v } } }));
    assert.equal(r.line('S07').state, label);
    assert.equal(r.node('s7a').status, 'locked', label);
  }
  const forced = run(snap({ stage: 1 }), prog({ overrides: { s7a: { open: 'force' } } }));
  assert.equal(forced.node('s7a').status, 'locked', 'manual open on a line that has not started');
});

test('two lines in parallel: the side line advances by its own stages while the main line is unfinished', () => {
  const r = run(snap({ stage: 2, f: { F_s07_open: '已核实', F_s7a: '已核实' } }));
  assert.equal(r.line('M1').state, '进行中');
  assert.equal(r.state.stageStates.get('s2').entered.v, C.TRI.f, 'main line stage 2 waits for its own stage 1');
  assert.equal(r.line('S07').state, '完成', 'last stage of S07 ended');
  assert.equal(r.line('S10').state, '可开启', 'S10 condition met (S07 完成); a side line waits for the player to walk in');
  assert.deepEqual(r.line('S10').entries, ['s10a'], 'its entry node is offered');
  assert.equal(r.node('s10a').status, 'locked');
});

test('线 conditions: 开过 counts paused/done/abandoned; a cycle between lines is reported and stays unknown', () => {
  const r = run(snap({ stage: 2, f: { F_s07_open: '存疑' } }), prog({ lines: { S07: { started: true, state: 'abandon' } } }));
  const env = { facts: new Map(), knowledge: [], tables: {}, nodeDone: () => false, lineState: (id) => r.line(id)?.state };
  assert.equal(C.evalCondition(C.parseCondition({ 线: 'S07 == 开过' }), env).v, C.TRI.t);
  assert.equal(C.evalCondition(C.parseCondition({ 线: 'S07 == 开着' }), env).v, C.TRI.f);
  const loop = VOLS();
  loop[1].line.开启条件 = { 线: 'S10 == 开过' };
  const cyc = run(snap({ stage: 2 }), prog(), loop);
  assert.ok(cyc.state.cycles.some((c) => /线 S/.test(c)), JSON.stringify(cyc.state.cycles));
  assert.equal(cyc.line('S07').state, '未触发');
});

test('old projects without 线: stage chain across volumes is unchanged', () => {
  const vols = VOLS().map(({ line, ...v }) => v);
  const r = run(snap({ f: { F_m1a: '已核实', F_m1b: '已核实' } }), prog(), vols);
  assert.deepEqual(r.state.lineStates, []);
  assert.equal(r.state.stageStates.get('s3').entered.v, C.TRI.t, 'next volume opens after the previous one ends');
  assert.equal(r.state.stageStates.get('s4').entered.v, C.TRI.f);
});

// ---------- runtime: auto start is recorded on the current floor; the run page shows each line ----------
import { createHost } from './host-sim.mjs';
const T = (stage, f = []) => ({
  sheet_rel: { name: '关系表', content: [[null, '姓名', '阶段'], ['1', '巴基', String(stage)]] },
  sheet_f: { name: '事实表', content: [[null, '编号', '状态'], ...f.map(([id, s], i) => [String(i + 1), id, s])] },
});
async function bootRuntime(stage) {
  const host = createHost({ tables: T(stage) });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('多线');
  const vols = VOLS();
  vols[1].line = { 编号: 'S07', 类型: '支线', 开启条件: { 表: '关系表/巴基/阶段 >= 2' }, 简介: '巴基想找回一家电影院。' };
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: { facts: [{ 表: '事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  return { host, inst, pid: p.id };
}
const lineOf = (inst, id) => inst.runtime.clue.compute().state.lineStates.find((s) => s.line.id === id);

test('runtime: a main line meeting its condition writes a start record on the current floor; a later drop does not undo it; deleting that floor does. A side line only becomes 可开启', async () => {
  const { host, inst, pid } = await bootRuntime(1);
  // M2 waits for the relationship; S07 (side) waits for the same thing
  inst.data.updateProject(pid, (x) => ({ ...x, outline: { volumes: [...x.outline.volumes, { id: 'v9', key: '剧情_M2_后续', line: { 编号: 'M2', 类型: '主线', 开启条件: { 表: '关系表/巴基/阶段 >= 2' } }, stages: [{ id: 's9', key: '阶段1', data: { 主线节点: [node('m2a', 'F_m2a')] } }] }] } }));
  inst.data.updateProject(pid, (x) => ({ ...x, outline: { volumes: x.outline.volumes.filter((v) => v.id !== 'v1') } }));
  await host.addMessage('开场白', false);
  assert.equal(lineOf(inst, 'M2').state, '未触发');
  await host.addMessage('我去找巴基', true);
  await host.addMessage('巴基说起了从前', false);
  host.db.setTables(T(2));
  inst.runtime.clue.invalidate();
  assert.equal(lineOf(inst, 'M2').state, '进行中');
  assert.equal(lineOf(inst, 'S07').state, '可开启', 'side lines do not start by themselves');
  await host.addMessage('继续', true);
  await inst.runtime.clue.syncLines();
  assert.equal(lineOf(inst, 'M2').manual.started, true, 'start recorded by the sync after the fill');
  assert.equal(lineOf(inst, 'M2').manual.startAt, 2, 'anchored on the AI floor that carried the fill, not the later user message (GPT 代码审阅 R7)');
  host.state.chat.splice(3);
  await host.eventSource.emit(host.eventTypes.MESSAGE_DELETED, 3);
  inst.runtime.clue.invalidate();
  assert.equal(lineOf(inst, 'M2').manual.started, true, 'deleting the later user message does not undo it');
  // the relationship drops afterwards: still in progress
  host.db.setTables(T(1));
  inst.runtime.clue.invalidate();
  assert.equal(lineOf(inst, 'M2').state, '进行中');
  // the floor that carried the start is deleted (regenerate) and the table rolls back too
  host.state.chat.splice(1);
  await host.eventSource.emit(host.eventTypes.MESSAGE_DELETED, 1);
  host.db.setTables(T(1));
  inst.runtime.clue.invalidate();
  assert.equal(lineOf(inst, 'M2').state, '未触发');
  await inst.destroy();
});

test('run page: the 剧情线 card lists lines with their state and what they wait for; 开启 / 暂停 buttons act on the line', async () => {
  const { host, inst, pid } = await bootRuntime(1);
  await host.addMessage('开场白', false);
  inst.data.updateSettings({ tourState: { revision: 2, done: ['core'] } });
  inst.open(); await new Promise((r) => setTimeout(r, 20));
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${pid}"]`).click(); await new Promise((r) => setTimeout(r, 20));
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await new Promise((r) => setTimeout(r, 20));
  const card = () => [...doc.querySelectorAll('.pi-card')].find((c) => /剧情线/.test(c.querySelector('h3')?.textContent || ''));
  assert.ok(card(), 'line card shown');
  assert.match(card().textContent, /非法设备[\s\S]*进行中/);
  assert.match(card().textContent, /电影院[\s\S]*未触发[\s\S]*关系表\/巴基\/阶段 = 1/);
  assert.equal(card().querySelector('[data-act="clue-line"][data-id="S07"][data-value="enter"]'), null, 'no early open while the condition is not met');
  host.db.setTables(T(2)); inst.runtime.clue.invalidate(); host.w.document.querySelector('[data-act="tab"][data-tab="run"]').click(); await new Promise((r) => setTimeout(r, 20));
  assert.match(card().textContent, /电影院[\s\S]*可开启/);
  card().querySelector('[data-act="clue-line"][data-id="S07"][data-value="enter"]').click(); await new Promise((r) => setTimeout(r, 20));
  assert.equal(lineOf(inst, 'S07').state, '进行中');
  assert.match(card().textContent, /电影院[\s\S]*进行中[\s\S]*人工进入/);
  card().querySelector('[data-act="clue-line"][data-id="S07"][data-value="pause"]').click(); await new Promise((r) => setTimeout(r, 20));
  assert.equal(lineOf(inst, 'S07').state, '暂停');
  assert.equal(host.llmCalls.length, 0, 'no model calls');
  await inst.destroy();
});

// ---------- AI 写新线：提示词带当前表格；草稿检查表和列、线编号；开场事实不需要节点产出 ----------
test('prompt + draft check: the table catalog is sent; a condition on a missing table/row is flagged in plain words; opening facts need no producing node', () => {
  const tables = { sheet_rel: { name: '关系表', content: [[null, '角色', '阶段'], ['1', '巴基', '1']] } };
  const cat = C.tableCatalogText(tables);
  assert.match(cat, /关系表：列 角色、阶段；现有行 巴基/);
  const m = C.outlineMessages({ setting: '', talk: '', volumes: [], volumeNo: 1, request: '加一条支线', mode: 'clue', tableCatalog: cat });
  assert.match(m[0].content, /第一个键写「线」/);
  assert.match(m[1].content, /当前数据库的表格/);
  const draft = C.parseOutlineText(`剧情_S01_采访:
  线:
    编号: S01
    类型: 支线
    开启条件: {表: 关系表/彼得/阶段 >= 50}
  阶段1_风声:
    主线节点:
      - id: n1
        名称: 记者
        入口: 有记者在打听
        发现: [{事实: F_a, 内容: 记者想采访, 记录: 当面说出时登记；没说不算}]
        完成条件: {事实: F_a}
`);
  const issues = C.checkClueDraft(draft, [], { applied: draft, tables }).join('\n');
  // 第二批：缺行改成提示（参考同一列别的行），不再当错误。
  assert.match(issues, /表里还没有「彼得」这一行；同一列别的行已经有值（如「1」），彼得出现在表里以后才开始判断/);
  const opening = C.parseOutlineText(`剧情_S02_报社:
  线:
    编号: S02
    类型: 支线
    开启条件: {事实: F_s02_open}
  阶段1_约见:
    主线节点:
      - id: n2
        名称: 约见
        入口: 去报社
        发现: [{事实: F_b, 内容: 编辑想做专访, 记录: 编辑当面说出时登记；没说不算}]
        完成条件: {事实: F_b}
`);
  const iss2 = C.checkClueDraft(opening, [], { applied: opening, tables }).join('\n');
  assert.doesNotMatch(iss2, /没有任何节点产出/);
  assert.doesNotMatch(iss2, /走不通/, 'the opening is assumed to happen in play');
  const plan = C.prebuildPlan(opening);
  const row = plan.facts.find((f) => f.code === 'F_s02_open');
  assert.ok(row && row.opening === 'S02' && row.trigger && !row.orphan, 'a trigger fact goes into the table plan, not flagged as orphan');
  const ctx = C.factLabelContext(opening, ['F_s02_open'])[0];
  assert.match(ctx.nodeName, /线 S02「S02·报社」开启前要发生的事/);
  assert.ok(!ctx.orphan);
});

// ---------- GPT 代码审阅（9c4e216）R2：线开启条件里的知情要进预建计划 ----------
test('R2: 知情 / 核实 / knowledge-cell conditions on a line\'s 开启条件 produce their knowledge rows; the gap check reads them too', () => {
  const line = (open) => [
    { id: 'va', key: '剧情_A', line: { 编号: 'A', 类型: '主线' }, stages: [{ id: 'sa', key: '阶段1', data: { 主线节点: [node('na', 'FA')] } }] },
    { id: 'vb', key: '剧情_B', line: { 编号: 'B', 类型: '支线', 开启条件: open }, stages: [{ id: 'sb', key: '阶段1', data: { 主线节点: [node('nb', 'FB')] } }] },
  ];
  for (const open of [{ 知情: 'FA@巴基' }, { 核实: 'FA@巴基' }, { 表: '知情表/FA@巴基/可信度 == 已核实' }]) {
    const keys = C.prebuildPlan(line(open)).knows.map((k) => k.key);
    assert.ok(keys.includes('FA@巴基'), JSON.stringify(open));
    assert.equal(keys.filter((k) => k === 'FA@巴基').length, 1, 'no duplicate');
  }
  const gaps = C.prebuiltGaps(C.compileClue(line({ 知情: 'FA@巴基' })), { facts: new Map([['FA', {}], ['FB', {}]]), knowPresent: new Set(['FA@user']) });
  assert.match(gaps.join(), /FA@巴基/);
});

// ---------- R3：长文导入不拿线的写法；写出了多条线时明说，不悄悄合并 ----------
test('R3: line rules go only to the new-volume request; long import gets the base rules; several lines in an import draft are reported', () => {
  const vol = C.outlineMessages({ setting: '', talk: '', volumes: [], volumeNo: 1, mode: 'clue' })[0].content;
  assert.match(vol, /第一个键写「线」/);
  const imp = C.importDraftMessages({ part: { i: 0, title: '一', text: '材料' }, index: '', mode: 'clue' })[0].content;
  assert.doesNotMatch(imp, /第一个键写「线」|当前数据库的表格/);
  assert.match(imp, /只引用大纲里确实有节点产出的事实编号/);
  // two different lines from the model: kept as one, reported, the first line's attributes kept
  const a = { id: 'a', key: '剧情_A', line: { 编号: 'A', 开启方式: '人工' }, stages: [{ id: 's1', key: '阶段1_调查', data: { 主线节点: [node('nA', 'FA')] } }] };
  const b = { id: 'b', key: '剧情_B', line: { 编号: 'B', 开启条件: { 知情: 'FA@巴基' } }, stages: [{ id: 's2', key: '阶段1_调查', data: { 主线节点: [node('nB', 'FB')] } }] };
  const merged = C.mergeImportParts([a, b]);
  assert.equal(merged[0].line.编号, 'A');
  const lineConflict = merged.conflicts.find((c) => c.lines);
  assert.ok(lineConflict, 'reported');
  assert.match(C.importConflictText(lineConflict), /写了好几条剧情线（A、B）/);
  // a single-line (or no-line) import is unchanged
  assert.ok(!C.mergeImportParts([a, { ...a, line: undefined }]).conflicts.some((c) => c.lines));
});

// ---------- R4：循环算不出来时，不按卷顺序随机开一条 ----------
test('R4: two lines waiting on each other give the same result in either order and neither auto-starts; a definite start still counts as 开过', () => {
  const N = (a) => node(`n${a}`, `F${a}`);
  const vol = (a, line, extra = {}) => ({ id: `v${a}`, key: `剧情_${a}`, line: { 编号: a, 类型: '支线', ...line }, stages: [{ id: `s${a}`, key: '阶段1', data: { 主线节点: [N(a)], ...extra } }] });
  const A = vol('A', { 开启条件: { 线: 'B != 进行中' } }), B = vol('B', { 开启条件: { 线: 'A != 进行中' } });
  const states = (vols, lines = {}) => run(snap(), prog({ lines }), vols).state.lineStates.map((s) => `${s.line.id}=${s.state}`).sort().join(',');
  assert.equal(states([A, B]), states([B, A]));
  assert.equal(states([A, B]), 'A=未触发,B=未触发');
  assert.ok(run(snap(), prog(), [A, B]).state.cycles.length, 'cycle reported');
  // A was started by hand; B opens once A 开过; A ends when B is done — no order dependence
  const A2 = vol('A', {}, { 结束条件: { 线: 'B == 完成' } }), B2 = vol('B', { 开启条件: { 线: 'A == 开过' } });
  assert.equal(states([A2, B2], { A: { started: true } }), states([B2, A2], { A: { started: true } }));
  assert.equal(states([A2, B2], { A: { started: true } }), 'A=进行中,B=可开启', 'B is a side line: its condition is met, it waits for the player');
});

// ---------- R6：计数里有比较不了的格子时，至多 / 等于按上下界判断 ----------
test('R6: with an uncomparable cell, 至少 1 is true, 至多 1 / 等于 1 unknown, 等于 3 false; all comparable keeps the old results', () => {
  const env = (rows) => ({ facts: new Map(), knowledge: [], tables: { sheet_r: { name: '关系表', content: [[null, '名', '阶段'], ...rows] } }, nodeDone: () => false });
  const v = (e, cmp, n) => C.evalCondition(C.parseCondition({ 计数: { 表: '关系表', 条件: '阶段 >= 2', [cmp]: n } }), e).v;
  const mixed = env([['1', '甲', '2'], ['2', '乙', '未统计']]);
  assert.equal(v(mixed, '至少', 1), C.TRI.t);
  assert.equal(v(mixed, '至多', 1), C.TRI.u);
  assert.equal(v(mixed, '等于', 1), C.TRI.u);
  assert.equal(v(mixed, '等于', 3), C.TRI.f);
  assert.equal(v(mixed, '至多', 2), C.TRI.t);
  const clean = env([['1', '甲', '2'], ['2', '乙', '1']]);
  assert.equal(v(clean, '至多', 1), C.TRI.t);
  assert.equal(v(clean, '等于', 1), C.TRI.t);
  assert.equal(v(clean, '至少', 2), C.TRI.f);
});
