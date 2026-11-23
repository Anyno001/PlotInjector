// 主线顺序、暂停、开启条件（导入审阅总方案 H；GPT 总方案审阅 R6 与验收场景 8、9、10）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import { createHost } from './host-sim.mjs';

const C = loadCore();
const node = (id, gives) => ({ id, 名称: id, 入口: `去${id}`, 地点: `${id}处`, 发现: [{ 事实: gives, 内容: `${gives}的内容` }], 完成条件: { 事实: gives } });
const main = (id, extra = {}) => ({ id: `v${id}`, key: `剧情_${id}`, line: { 编号: id, 类型: '主线', ...extra }, stages: [{ id: `s${id}`, key: '阶段1_x', data: { 主线节点: [node(`${id}a`, `F_${id}a`)] } }] });
const side = (id) => ({ id: `v${id}`, key: `剧情_${id}`, line: { 编号: id, 类型: '支线' }, stages: [{ id: `s${id}`, key: '阶段1_x', data: { 主线节点: [node(`${id}a`, `F_${id}a`)] } }] });
const facts = (ok = []) => new Map(ok.map((f) => [f, { id: f, status: 'confirmed', text: '', raw: '已核实' }]));
const run = (vols, prog = {}, ok = []) => {
  const s = C.computeClueState(C.compileClue(vols), { facts: facts(ok), knowledge: [], tables: {}, problems: [] }, { ...C.emptyClueProgress(), ...prog }, C.normalizeClue({ mode: 'clue' }));
  return { s, of: (id) => s.lineStates.find((x) => x.line.id === id) };
};

// ---------- 接上一条：顺序 ≠ 条件 ----------
test('H: 接上一条 waits for the previous main line to END (done or abandoned); 完成 in a condition still means done', () => {
  const vols = () => [main('M1'), main('M2', { 接上一条: true }), main('M3', { 接上一条: true, 开启条件: { 线: 'M1 == 完成' } })];
  let r = run(vols());
  assert.equal(r.of('M1').state, '进行中');
  assert.match(r.of('M2').waitMain, /排在主线M1后面/);
  r = run(vols(), { lines: { M1: { started: true, state: 'abandon' } } });
  assert.equal(r.of('M2').state, '进行中', 'abandoning M1 lets M2 start (it is not stuck forever)');
  assert.notEqual(r.of('M3').state, '进行中', 'M3 also needs M1 done, and abandoned is not done');
  r = run(vols(), { lines: { M1: { started: true, state: 'pause' } } });
  assert.notEqual(r.of('M2').state, '进行中', 'pausing M1 does not start the next one by itself');
});

test('H: the first main line with 接上一条 has nothing before it; old main lines without the flag keep their old behaviour', () => {
  const r = run([main('M1', { 接上一条: true }), side('S01')]);
  assert.equal(r.of('M1').state, '进行中');
  const old = run([main('M1'), main('M2')]);
  assert.equal(old.of('M2').state, '可开启');
  assert.match(old.of('M2').waitMain, /M1 还在进行/, 'old lines: no new dependency is added');
});

test('H: reordering only changes which line waits for which; a line that already started is not locked back', () => {
  const a = [main('M1'), main('M2', { 接上一条: true }), main('M3', { 接上一条: true })];
  let r = run(a, {}, ['F_M1a']);
  assert.equal(r.of('M1').state, '完成');
  assert.equal(r.of('M2').state, '进行中');
  assert.match(r.of('M3').waitMain, /排在主线M2后面/);
  const swapped = [a[0], a[2], a[1]];
  r = run(swapped, {}, ['F_M1a']);
  assert.equal(r.of('M3').state, '进行中', 'M3 is now right after M1');
  assert.match(r.of('M2').waitMain, /排在主线M3后面/);
  r = run(swapped, { lines: { M2: { started: true } } }, ['F_M1a']);
  assert.equal(r.of('M2').state, '进行中', 'M2 had already started: moving it later does not lock it back');
});

// ---------- 场景 9：旧的暂停记录仍是暂停剧情；暂停全部主线是新目标 ----------
test('H (R6 / 9): an old pause op with target main still pauses the whole plot; target mains pauses only main lines', () => {
  const chat = [{ is_user: false, mes: 'x', swipe_id: 0, send_date: '1' }];
  const at = { i: 0, swipe: 0, stamp: '1' };
  const old = C.effectiveClueProgress({ ops: [{ kind: 'pause', target: 'main', value: true, at }] }, chat);
  assert.deepEqual([old.paused, old.mainPaused, old.sidePaused], [true, false, false]);
  const mains = C.effectiveClueProgress({ ops: [{ kind: 'pause', target: 'mains', value: true, at }] }, chat);
  assert.deepEqual([mains.paused, mains.mainPaused, mains.sidePaused], [false, true, false]);
  assert.notEqual(C.opSlot({ kind: 'pause', target: 'mains' }), C.opSlot({ kind: 'pause', target: 'main' }), 'the two do not overwrite each other');
  // 暂停全部主线：主线节点不开放、不进注入计划；支线照常
  const vols = [main('M1'), side('S01')];
  // M1 已经开始（进行中），再暂停全部主线：它的节点也要关上
  const r = run(vols, { mainPaused: true, lines: { M1: { started: true }, S01: { started: true } } });
  assert.equal(r.of('M1').state, '进行中', 'the line itself stays in progress (progress kept)');
  assert.equal(r.s.nodeStates.find((n) => n.node.uid === 'M1a').status, 'locked');
  assert.equal(r.s.nodeStates.find((n) => n.node.uid === 'S01a').status, 'available');
  const plan = C.lineEntryPlan(r.s, { mainPaused: true, lines: { M1: { started: true } } }, { round: 0 });
  assert.ok(!plan.offer || plan.offer.line !== 'M1', 'no main-line material while all main lines are paused');
});

// ---------- 场景 8：手动换主线，始终只有一条进行中 ----------
async function boot(vols) {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('H');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  await host.addMessage('开场白', false);
  return { host, inst, pid: p.id };
}
const lineOf = (inst, id) => (inst.runtime.clue.invalidate(), inst.runtime.clue.compute().state.lineStates.find((s) => s.line.id === id));
const running = (inst) => (inst.runtime.clue.invalidate(), [...inst.runtime.clue.compute().state.lineStates.filter((s) => s.line.kind === "main" && s.state === "进行中").map((s) => s.line.id)]);

test('H (8): pause M1, enter M3 by hand, resume M1 — never two main lines running; the paused one keeps its progress', async () => {
  const { inst } = await boot([main('M1'), main('M2', { 接上一条: true }), main('M3', { 开启方式: '人工' })]);
  assert.deepEqual(running(inst), ['M1']);
  inst.runtime.clue.lineAct('M1', 'pause');
  assert.deepEqual(running(inst), [], 'pausing M1 starts nothing by itself');
  assert.notEqual(lineOf(inst, 'M2').state, '进行中');
  inst.runtime.clue.lineAct('M3', 'enter');
  assert.deepEqual(running(inst), ['M3']);
  inst.runtime.clue.lineAct('M1', 'resume');
  assert.deepEqual(running(inst), ['M1'], 'resuming M1 pauses M3 in the same step');
  assert.equal(lineOf(inst, 'M3').state, '暂停');
  inst.runtime.clue.lineAct('M3', 'enter');
  assert.deepEqual(running(inst), ['M1'], 'M3 has started already: enter does nothing, resume is the way back');
  await inst.destroy();
});

test('H (8): switching main lines in the run page asks first; cancelling changes nothing', async () => {
  const { host, inst, pid } = await boot([main('M1'), main('M3', { 开启方式: '人工' })]);
  inst.open(); await new Promise((r) => setTimeout(r, 30));
  const doc = host.w.document, tick = () => new Promise((r) => setTimeout(r, 30));
  doc.querySelector(`[data-act="project"][data-id="${pid}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  doc.querySelector('[data-act="clue-line"][data-id="M3"][data-value="enter"]').click(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  assert.ok(dlg, 'a confirm appears');
  assert.match(dlg.textContent, /「剧情_M1」会先暂停|M1」会先暂停|会先暂停/);
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '取消').click(); await tick();
  assert.deepEqual(running(inst), ['M1'], 'cancel: nothing changed');
  doc.querySelector('[data-act="clue-line"][data-id="M3"][data-value="enter"]').click(); await tick();
  [...doc.querySelector('.pi-dialog').querySelectorAll('.pi-btn')].find((b) => b.textContent === '切换').click(); await tick();
  assert.deepEqual(running(inst), ['M3']);
  assert.equal(lineOf(inst, 'M1').state, '暂停');
  // 暂停全部主线的按钮在剧情线卡片上（有两条以上主线时）
  assert.ok(doc.querySelector('[data-act="clue-pause-mains"]'));
  await inst.destroy();
});

// ---------- 场景 10：调整顺序只影响还没开始的线 ----------
test('H (10): moving main lines up / down reorders only main lines, keeps their numbers, and leaves side lines in place', async () => {
  const { inst, pid } = await boot([main('M1'), side('S01'), main('M2', { 接上一条: true }), main('M3', { 接上一条: true })]);
  inst.runtime.clue.moveLine('M3', -1);
  const order = inst.data.project(pid).outline.volumes.map((v) => v.line.编号);
  assert.deepEqual(order, ['M1', 'S01', 'M3', 'M2']);
  inst.runtime.clue.moveLine('M3', -1);
  assert.deepEqual(inst.data.project(pid).outline.volumes.map((v) => v.line.编号), ['M3', 'S01', 'M1', 'M2'], 'skips over the side line');
  assert.equal(lineOf(inst, 'M1').state, '进行中', 'M1 had already started (auto, no 接上一条) and keeps running');
  await inst.destroy();
});
