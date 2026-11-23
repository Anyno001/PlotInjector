// 大型项目第 3 批：收起已结束的线，检查模式（只计算，不写表）。
import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';
import { BINDING_YAML } from '../templates/clue-tables/build-template.mjs';

const C = loadCore();
const tick = () => new Promise((r) => setTimeout(r, 20));
const node = (id, facts, extra = {}) => ({ id, 名称: id, 入口: `去${id}`, 地点: id, 发现: facts.map((f) => ({ 事实: f, 内容: `${f}的内容`, 记录: `看到${f}时登记` })), 完成条件: { 事实: facts[0] }, ...extra });
const vol = (id, kind, nodes, line = {}) => ({ id: `v${id}`, key: `剧情_${id}_x`, line: { 编号: id, 类型: kind, ...line }, stages: [{ id: `s${id}`, key: '阶段1_x', data: { 主线节点: nodes } }] });
const FACT_HEAD = [null, '编号', '标签', '登记口径', '状态', '内容', '依据'];
const KNOW_HEAD = [null, '键', '事实', '角色', '获知方式', '可信度', '依据'];
const fill = (keys, source = 'auto_fill', extra = {}) => ({ TavernDB_ACU_IsolatedData: { '': { storageFrame: { version: 2, logEntries: [{ seq: 1, source, filledSheetKeys: keys, ...extra }] } } } });
const states = (map) => Object.entries(map).map(([id, state]) => ({ line: { id }, state }));
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);

test('foldPlan: only facts of ended lines that no unfinished line produces or reads; the 不收 list is kept', () => {
  const vols = [
    vol('M1', '主线', [node('a', ['F1', 'F2', 'F3', 'F4', 'F5'])]),
    vol('M2', '主线', [node('b', ['F9'], { 相关事实: ['F2'] })], { 开启条件: { 事实: 'F9' } }),
    vol('S1', '支线', [node('c', ['F3'])]),
    vol('S2', '支线', [node('d', ['F1', 'F6'])]),
    { id: 'vold', key: '剧情_老', stages: [{ id: 'so', key: '阶段1_老', data: { 主线节点: [node('e', ['F7'], { 完成条件: { 事实: 'F5' } })] } }] },
  ];
  const plan = C.foldPlan(C.compileClue(vols), states({ M1: '完成', M2: '进行中', S1: '可开启', S2: '放弃' }), { keep: ['F4'] });
  assert.deepEqual(plan.map((x) => x.line.id), ['M1', 'S2'], 'only ended lines');
  const m1 = plan[0];
  assert.deepEqual(m1.facts, ['F1'], 'F1: produced only by ended lines, read by nobody');
  const why = Object.fromEntries(m1.kept.map((k) => [k.fact, [k.why, k.by.join()]]));
  assert.deepEqual(why.F2, ['read', 'M2'], 'M2 (unfinished) reads F2 through 相关事实');
  assert.deepEqual(why.F3, ['produce', 'S1'], 'S1 has not ended and also produces F3');
  assert.deepEqual(why.F4, ['keep', ''], 'author asked to keep F4');
  assert.deepEqual(why.F5, ['read', 'M3'], 'the volume without a line head counts as its own unfinished line');
  assert.deepEqual(plan[1].facts, ['F6'], 'F1 is counted under M1 only');
  // M2 ends too: F2 is no longer read by an unfinished line
  const later = C.foldPlan(C.compileClue(vols), states({ M1: '完成', M2: '完成', S1: '完成', S2: '放弃' }));
  assert.deepEqual(later[0].facts, ['F1', 'F2', 'F3', 'F4'], 'nothing unfinished reads them any more (F5 still read by the old stage)');
});

test('foldRows: counts real rows only (template seed rows never count); knowledge rows of any actor', () => {
  const tables = {
    sheet_f: { name: '关键事实表', content: [FACT_HEAD, [1, 'F1', '', '', '已核实', '', ''], [2, 'F2', '', '', '未获得', '', '']], seedRows: [[null, 'F3', '', '', '未获得', '', '']] },
    sheet_k: { name: '知情表', content: [KNOW_HEAD, [1, 'F1@user', 'F1', 'user', '亲见', '已核实', ''], [2, 'F1@老韩', 'F1', '老韩', '听说', '未核实', '']] },
  };
  const b = YAML.parse(BINDING_YAML);
  const r = C.foldRows(tables, b, ['F1', 'F3']);
  assert.deepEqual(r.facts, { F1: 1 }, 'F3 is only a seed row');
  assert.deepEqual(r.knows, { F1: 2 });
  assert.equal(r.factKey, 'sheet_f');
  assert.equal(r.knowKey, 'sheet_k');
  assert.match(C.foldRows({}, b, ['F1']).problems.join(), /缺少表「关键事实表」/);
});

test('foldFill: a real fill after the end floor covering both tables; checkpoints, errors, other isolations and earlier floors do not count', () => {
  const keys = { facts: 'sheet_f', knows: 'sheet_k' };
  const u = { is_user: true }, ai = (x = {}) => ({ is_user: false, ...x });
  assert.equal(C.foldFill([u, ai(fill(['sheet_f', 'sheet_k']))], 1, keys, '').why, 'wait', 'the fill on the end floor itself does not count');
  assert.equal(C.foldFill([u, ai(), u, ai(fill(['sheet_f', 'sheet_k']))], -1, keys, '').why, 'end', 'end floor unknown');
  const ok = C.foldFill([u, ai(), u, ai(fill(['sheet_f', 'sheet_k']))], 1, keys, '');
  assert.deepEqual([ok.ok, ok.floor, ok.sources], [true, 3, ['auto_fill']]);
  const split = C.foldFill([u, ai(), u, ai(fill(['sheet_f'], 'group_fill')), u, ai(fill(['sheet_k'], 'group_fill'))], 1, keys, '');
  assert.deepEqual([split.ok, split.floor], [true, 5], 'the two tables can be filled on different floors');
  const cp = { is_user: false, TavernDB_ACU_IsolatedData: { '': { storageFrame: { checkpoint: { event: { filledSheetKeys: ['sheet_f', 'sheet_k'] } } } } } };
  assert.equal(C.foldFill([u, ai(), u, cp], 1, keys, '').ok, false, 'import / restore checkpoints are not a fill');
  assert.equal(C.foldFill([u, ai(), u, ai(fill(['sheet_f', 'sheet_k'], 'auto_fill', { error: 'x' }))], 1, keys, '').ok, false, 'errored record');
  assert.equal(C.foldFill([u, ai(), u, ai(fill(['sheet_f', 'sheet_k'], 'manual_crud'))], 1, keys, '').ok, false, 'the plugin\'s own writes are not a fill');
  const other = { is_user: false, TavernDB_ACU_IsolatedData: { B: { storageFrame: { logEntries: [{ source: 'auto_fill', filledSheetKeys: ['sheet_f', 'sheet_k'] }] } } } };
  assert.equal(C.foldFill([u, ai(), u, other], 1, keys, '').ok, false, 'another isolation');
  const two = { is_user: false, TavernDB_ACU_IsolatedData: { A: { storageFrame: { logEntries: [{ source: 'auto_fill', filledSheetKeys: ['sheet_f', 'sheet_k'] }] } }, B: { storageFrame: { logEntries: [] } } } };
  assert.equal(C.foldFill([u, ai(), u, two], 1, keys, null).ok, false, 'isolation unknown and several records on the floor: not sure, wait');
  assert.equal(C.foldFill([u, ai(), u, ai(fill(['sheet_f']))], 1, { facts: 'sheet_f', knows: '' }, '').ok, true, 'no knowledge binding: the fact table is enough');
});

// ---------- 执行页、诊断页 ----------
async function setup() {
  const vols = [vol('M1', '主线', [node('a', ['F1', 'F2'])]), vol('M2', '主线', [node('b', ['F9'])], { 开启方式: '人工', 开启条件: { 事实: 'F2' } }), vol('S1', '支线', [node('c', ['F5'])], { 开启条件: { 事实: 'F8' } })];
  const tables = {
    sheet_ctrl: { name: '线索控制表', content: [[null, '标识', '当前场景', '场景目录'], [1, '主线', 'a', '']] },
    sheet_f: { name: '关键事实表', content: [FACT_HEAD, [1, 'F1', '', '', '已核实', '', ''], [2, 'F2', '', '', '已核实', '', '']] },
    sheet_k: { name: '知情表', content: [KNOW_HEAD, [1, 'F1@user', 'F1', 'user', '亲见', '已核实', ''], [2, 'F2@user', 'F2', 'user', '亲见', '已核实', '']] },
  };
  const host = createHost({ tables });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('收起');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML) } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  host.state.chat.push({ is_user: true, mes: '一', send_date: 'a0' }, { is_user: false, mes: '回', send_date: 'a1', swipe_id: 0, ...fill(['sheet_f', 'sheet_k']) });
  inst.runtime.clue.invalidate();
  return { host, inst, pid: p.id };
}

test('sync records where a computed ending happened; the check waits for a later fill, then counts the rows; nothing is written to the tables', async () => {
  const { host, inst, pid } = await setup();
  const clueRows = () => { const t = host.w.AutoCardUpdaterAPI.exportTableAsJson(); return JSON.stringify([t.sheet_f, t.sheet_k]); };
  const before = clueRows();
  await inst.runtime.clue.syncLines();
  const lineState = (id) => inst.runtime.clue.compute().state.lineStates.find((s) => s.line.id === id).state;
  assert.equal(lineState('M1'), '完成');
  assert.equal(inst.runtime.progress().lineEnds.M1.i, 1, 'anchored on the last AI floor of this sync');
  let f = inst.runtime.clue.foldCheck();
  let m1 = f.lines.find((x) => x.id === 'M1');
  same(m1.facts, ['F1'], 'F2 is read by M2, which has not ended');
  assert.equal(m1.rows, 2, 'F1 fact row + F1@user');
  assert.equal(m1.fill.ok, false, 'the fill on the ending floor itself does not count');
  // next round: a real fill on a later floor
  host.state.chat.push({ is_user: true, mes: '二', send_date: 'a2' }, { is_user: false, mes: '回', send_date: 'a3', swipe_id: 0, ...fill(['sheet_f', 'sheet_k']) });
  inst.runtime.clue.invalidate();
  await inst.runtime.clue.syncLines();
  assert.equal(inst.runtime.progress().lineEnds.M1.i, 1, 'a later sync keeps the original end floor');
  f = inst.runtime.clue.foldCheck();
  m1 = f.lines.find((x) => x.id === 'M1');
  same([m1.fill.ok, m1.fill.floor], [true, 3]);
  assert.equal(f.storage, 'sqlite', 'host-sim exposes the SQL API, which the database only does in SQLite mode');
  // run page: 已结束 tab shows the check result and the kept fact (as if this storage were not released: manual only)
  inst.runtime.clue.foldRelease.sqlite = false;
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${pid}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  const card = doc.querySelector('.pi-line-card');
  same([...card.querySelectorAll('[data-act="clue-line-tab"]')].map((b) => b.textContent), ['进行中（0）', '未进行（2）', '已结束（1）']);
  assert.ok(card.querySelector('[data-line-grp="end"]').hidden, 'only the selected tab is shown');
  card.querySelector('[data-act="clue-line-tab"][data-tab="end"]').click(); await tick();
  const end = doc.querySelector('[data-line-grp="end"]');
  assert.ok(!end.hidden);
  assert.match(end.textContent, /可在「⋯」里手动收起/);
  assert.match(end.textContent, /可收起2行/);
  assert.match(end.textContent, /F2 被M2引用，保留在表中/);
  assert.equal(clueRows(), before, 'check mode never writes the clue tables');
  // diagnostics
  doc.querySelector('[data-act="drawer"]') && doc.querySelector('[data-act="drawer"]').click(); await tick();
  doc.querySelector('[data-act="page"][data-page="diag"]').click(); await tick();
  const diag = doc.querySelector('.pi-body').textContent;
  assert.match(diag, /收起已结束的线/);
  assert.match(diag, /可收起1条，待填表0条/);
  assert.match(diag, /M1：第3楼的自动填表符合条件/);
  await inst.destroy();
});

test('a manual 标记完成 ends at the floor of the click; reopening the line drops the recorded end', async () => {
  const { host, inst } = await setup();
  // make M1 unfinished from the table's point of view
  host.w.AutoCardUpdaterAPI.exportTableAsJson().sheet_f.content[1][4] = '未获得';
  inst.runtime.clue.invalidate();
  await inst.runtime.clue.syncLines();
  const st = (id) => inst.runtime.clue.compute().state.lineStates.find((s) => s.line.id === id);
  assert.equal(st('M1').state, '进行中');
  inst.runtime.clue.lineAct('M1', 'done');
  inst.runtime.clue.invalidate();
  assert.equal(st('M1').state, '完成');
  let m1 = inst.runtime.clue.foldCheck().lines.find((x) => x.id === 'M1');
  assert.equal(m1.endFloor, 1, 'the click is anchored on the last message');
  host.state.chat.push({ is_user: true, mes: '二', send_date: 'a2' }, { is_user: false, mes: '回', send_date: 'a3', swipe_id: 0, ...fill(['sheet_f', 'sheet_k']) });
  inst.runtime.clue.invalidate();
  m1 = inst.runtime.clue.foldCheck().lines.find((x) => x.id === 'M1');
  assert.equal(m1.fill.ok, true);
  // 还原: no longer ended → sync removes the recorded end
  await inst.runtime.clue.syncLines();
  inst.runtime.clue.lineAct('M1', '');
  await inst.runtime.clue.syncLines();
  assert.equal(st('M1').state, '进行中');
  assert.ok(!(inst.runtime.progress().lineEnds || {}).M1, 'end record dropped');
  await inst.destroy();
});

test('fact menu: 收起已结束的线时保留这条 adds the fact to the project 不收 list; the check keeps it', async () => {
  const { host, inst, pid } = await setup();
  inst.data.updateProject(pid, (p) => ({ ...p, clue: C.normalizeClue({ ...p.clue, noFold: ['F1', ' F1 ', ''] }) }));
  assert.equal(JSON.stringify(inst.data.project(pid).clue.noFold), '["F1"]', 'normalized');
  inst.runtime.clue.invalidate();
  await inst.runtime.clue.syncLines();
  const m1 = inst.runtime.clue.foldCheck().lines.find((x) => x.id === 'M1');
  same(m1.facts, []);
  same(m1.kept.map((k) => [k.fact, k.why]), [['F1', 'keep'], ['F2', 'read']]);
  await inst.destroy();
});

test('search: more than 8 lines shows a search box that filters across tabs without re-rendering', async () => {
  const many = Array.from({ length: 9 }, (_, i) => vol(`S${i + 1}`, '支线', [node(`n${i}`, [`F${i}`])], { 开启条件: { 事实: 'Fzz' } }));
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('多');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: many }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML) } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  const box = doc.querySelector('[data-clue-line-q]');
  assert.ok(box, 'search box');
  box.value = 's3';
  box.dispatchEvent(new host.w.Event('input', { bubbles: true })); await tick();
  const shown = [...doc.querySelectorAll('[data-line-row]')].filter((r) => !r.hidden && !r.closest('[data-line-grp]').hidden).map((r) => r.dataset.lineRow);
  same(shown, ['S3']);
  assert.equal(doc.querySelector('[data-clue-line-q]'), box, 'not re-rendered');
  await inst.destroy();
});

test('a main line that starts and finishes in the same fill keeps its start (the next main starting does not undo it)', async () => {
  const vols = [vol('M1', '主线', [node('a', ['F1'])]), vol('M2', '主线', [node('b', ['F2'])], { 接上一条: true }), vol('M3', '主线', [node('c', ['F3'])], { 接上一条: true })];
  const tables = {
    sheet_f: { name: '关键事实表', content: [FACT_HEAD, [1, 'F1', '', '', '已核实', '', ''], [2, 'F2', '', '', '已核实', '', '']] },
    sheet_k: { name: '知情表', content: [KNOW_HEAD] },
  };
  const host = createHost({ tables });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('连');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML) } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  host.state.chat.push({ is_user: true, mes: '一', send_date: 'a0' }, { is_user: false, mes: '回', send_date: 'a1', swipe_id: 0, ...fill(['sheet_f', 'sheet_k']) });
  inst.runtime.clue.invalidate();
  await inst.runtime.clue.syncLines();
  inst.runtime.clue.invalidate();
  const st = () => JSON.stringify(inst.runtime.clue.compute().state.lineStates.map((s) => [s.line.id, s.state]));
  assert.equal(st(), JSON.stringify([['M1', '完成'], ['M2', '完成'], ['M3', '进行中']]));
  await inst.runtime.clue.syncLines();
  inst.runtime.clue.invalidate();
  assert.equal(st(), JSON.stringify([['M1', '完成'], ['M2', '完成'], ['M3', '进行中']]), 'still ended after the next sync');
  await inst.destroy();
});

// 收起只给线索模式：跑团项目没有收起检查，执行页不出「收起」按钮（用户 2026-11-23）
// 跑团项目从 v0.3.16 起走 src/trpg 自己的运行时和执行页：线索模式的收起不进跑团，执行页、诊断页都不出收起，也不报错
test('TRPG projects get no fold check and no fold buttons (TRPG runs its own code)', async () => {
  const { host, inst, pid } = await setup();
  await inst.runtime.clue.syncLines();
  assert.ok(inst.runtime.clue.foldCheck(), 'clue mode: fold check available');
  inst.data.updateProject(pid, (x) => ({ ...x, trpg: { ...(x.trpg || {}), on: true } }));
  inst.runtime.clue.invalidate();
  inst.open(); await tick();
  host.w.document.querySelector('[data-act="drawer"]') && host.w.document.querySelector('[data-act="drawer"]').click(); await tick();
  host.w.document.querySelector('[data-act="page"][data-page="diag"]').click(); await tick();
  assert.ok(!/收起已结束的线/.test(host.w.document.documentElement.textContent), 'diagnostics: no fold section for TRPG');
  host.w.document.querySelector('[data-act="tab"][data-tab="run"]') || (host.w.document.querySelector('[data-act="project"][data-id="' + pid + '"]').click(), await tick());
  host.w.document.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  assert.equal(host.w.document.querySelector('[data-act="clue-fold"]'), null, 'no 收起 / 恢复 buttons');
  const t = host.w.document.querySelector('[data-act="run-set-toggle"][aria-expanded="false"]'); t && (t.click(), await tick());
  assert.equal(host.w.document.querySelector('[data-clue-foldauto]'), null, 'no auto-collapse switch in run settings');
  await inst.destroy();
});
