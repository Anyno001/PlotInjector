// 大型项目第 3 批：真正收起、恢复（方案 三.3–三.5、十.5–十.7）。原生（deleteRow）和 SQLite（executeSqlMutation）各走一遍。
import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';
const C = loadCore();
import { BINDING_YAML } from '../templates/clue-tables/build-template.mjs';

const tick = () => new Promise((r) => setTimeout(r, 20));
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const node = (id, facts, extra = {}) => ({ id, 名称: id, 入口: `去${id}`, 地点: id, 发现: facts.map((f) => ({ 事实: f, 内容: `${f}的内容`, 记录: `看到${f}时登记` })), 完成条件: { 事实: facts[0] }, ...extra });
const vol = (id, kind, nodes, line = {}) => ({ id: `v${id}`, key: `剧情_${id}_x`, line: { 编号: id, 类型: kind, ...line }, stages: [{ id: `s${id}`, key: '阶段1_x', data: { 主线节点: nodes } }] });
const FACT_HEAD = [null, '编号', '标签', '登记口径', '状态', '内容', '依据'];
const KNOW_HEAD = [null, '键', '事实', '角色', '获知方式', '可信度', '依据'];
const fill = (keys) => ({ TavernDB_ACU_IsolatedData: { '': { storageFrame: { version: 2, logEntries: [{ seq: 1, source: 'auto_fill', filledSheetKeys: keys }] } } } });

// M1 结束（F1、F2 已核实）；M2 手动开始、开启条件读 F2，所以只有 F1 能收。
async function setup({ sqlite = true, laterFill = true } = {}) {
  const vols = [vol('M1', '主线', [node('a', ['F1', 'F2'])]), vol('M2', '主线', [node('b', ['F9'])], { 开启方式: '人工', 开启条件: { 事实: 'F2' } })];
  const tables = {
    sheet_ctrl: { name: '线索控制表', content: [[null, '标识', '当前场景', '场景目录'], [1, '主线', 'a', '']] },
    sheet_f: { name: '关键事实表', content: [FACT_HEAD, [1, 'F1', '账本', '读到账本时登记', '已核实', '账本上的名字', '第1楼'], [2, 'F2', '', '', '已核实', '', '']] },
    sheet_k: { name: '知情表', content: [KNOW_HEAD, [1, 'F1@user', 'F1', 'user', '亲见', '已核实', '第1楼'], [2, 'F2@user', 'F2', 'user', '亲见', '已核实', '']] },
  };
  const host = createHost({ tables });
  host.w.AutoCardUpdaterAPI.sqlite = sqlite;
  // shujuku 当前隔离：不隔离（空串）
  host.ctx.extensionSettings = { __userscripts: { shujuku_v120__userscript_settings_v1: { shujuku_v120_globalMeta_v1: JSON.stringify({ activeIsolationCode: '' }) } } };
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('收起');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML), labels: { F1: { label: '账本', criterion: '读到账本时登记' } } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  host.state.chat.push({ is_user: true, mes: '一', send_date: 'a0' }, { is_user: false, mes: '回', send_date: 'a1', swipe_id: 0, ...fill(['sheet_f', 'sheet_k']) });
  inst.runtime.clue.invalidate();
  await inst.runtime.clue.syncLines();
  host.state.chat.push({ is_user: true, mes: '二', send_date: 'a2' }, { is_user: false, mes: '回', send_date: 'a3', swipe_id: 0, ...(laterFill ? fill(['sheet_f', 'sheet_k']) : {}) });
  inst.runtime.clue.invalidate();
  await inst.runtime.clue.syncLines();
  const api = host.w.AutoCardUpdaterAPI;
  const codes = (sheet) => api.exportTableAsJson()[sheet].content.slice(1).map((r) => r[sheet === 'sheet_f' ? 1 : 1]);
  const state = (id) => inst.runtime.clue.compute().state.lineStates.find((s) => s.line.id === id).state;
  const check = () => inst.runtime.clue.foldCheck().lines.find((x) => x.id === 'M1');
  const folds = () => JSON.parse(JSON.stringify(inst.runtime.progress().folds || []));
  return { host, inst, api, codes, state, check, folds, pid: p.id };
}

for (const sqlite of [true, false]) {
  const mode = sqlite ? 'SQLite' : 'native';
  test(`${mode}: manual collapse saves the record (read back from the server), deletes F1's rows, and the line stays 完成`, async () => {
    const { host, inst, api, codes, state, check, folds } = await setup({ sqlite });
    assert.equal(check().rows, 2);
    const r = await inst.runtime.clue.foldCollapse(['M1'], { manual: true });
    same([r.ok, r.rows, r.failed], [true, 2, 0], JSON.stringify(r));
    same(codes('sheet_f'), ['F2'], 'F1 fact row gone');
    same(codes('sheet_k'), ['F2@user'], 'F1@user gone');
    const rec = folds()[0];
    same(rec.rows.map((x) => [x.kind, x.code, x.st, x.del.i]), [['fact', 'F1', 'deleted', 3], ['know', 'F1', 'deleted', 3]], 'delete written on floor 3');
    assert.ok(JSON.stringify(host.state.server).includes(rec.id), 'the record is on the server copy');
    if (sqlite) assert.ok(api.sqlCalls.some((c) => /^DELETE FROM 关键事实表 WHERE row_id = \? AND 编号 = \?$/.test(c.sql)), 'parameterized delete by row id and code');
    else same(api.deleted.map((d) => [d.tableName, d.floor]), [['关键事实表', 3], ['知情表', 3]]);
    inst.runtime.clue.invalidate();
    assert.equal(state('M1'), '完成', 'the read view keeps the collapsed rows');
    const c = check();
    same([c.folded, c.rows], [2, 0]);
    // the next fill does not insert F1 back (it is collapsed, not missing)
    await inst.runtime.clue.syncLines();
    same(codes('sheet_f'), ['F2'], 'auto-fill skips collapsed facts');
    assert.ok(!api.inserted.some((x) => x.data.编号 === 'F1'));
    await inst.destroy();
  });
}

async function refresh(doc) { doc.querySelector('[data-act="clue-refresh"]').click(); await new Promise((r) => setTimeout(r, 30)); }
test('the record could not be confirmed on the server → nothing is deleted', async () => {
  const { host, inst, codes } = await setup();
  host.state.saveFails = true;
  const r = await inst.runtime.clue.foldCollapse(['M1'], { manual: true });
  assert.equal(r.ok, false);
  assert.match(r.why, /未能确认存盘/);
  same(codes('sheet_f'), ['F1', 'F2'], 'rows untouched');
  await inst.destroy();
});

test('a column changed after the record was saved → that row is not deleted, the new value stays', async () => {
  const { host, inst, api, codes } = await setup();
  const save = host.ctx.saveMetadata;
  let n = 0;
  host.ctx.saveMetadata = async () => { await save(); if (++n === 1) api.exportTableAsJson().sheet_f.content[1][6] = '有人改了依据'; };
  const r = await inst.runtime.clue.foldCollapse(['M1'], { manual: true });
  same([r.rows, r.failed], [1, 1], 'the knowledge row went, the edited fact row did not');
  same(codes('sheet_f'), ['F1', 'F2']);
  assert.equal(api.exportTableAsJson().sheet_f.content[1][6], '有人改了依据');
  await inst.destroy();
});

test('database filling (fill-start callback, no table update yet) → no write; the table update clears it', async () => {
  const { inst, api, codes } = await setup();
  api.fillStartCallbacks.forEach((fn) => fn());
  const r = await inst.runtime.clue.foldCollapse(['M1'], { manual: true });
  assert.match(r.why, /正在填表/);
  same(codes('sheet_f'), ['F1', 'F2']);
  await inst.destroy();
});

test('auto (non-manual) collapse waits for a fill after the end floor; a duplicated key is never picked', async () => {
  const { inst, api, codes } = await setup();
  api.exportTableAsJson().sheet_k.content.push([3, 'F1@主角', 'F1', '主角', '亲见', '已核实', '']);
  const r = await inst.runtime.clue.foldCollapse(['M1']);
  assert.equal(r.ok, false, 'F1@user and F1@主角 are the same key: F1 is skipped as a whole');
  same(codes('sheet_f'), ['F1', 'F2']);
  await inst.destroy();
});

test('restore from 收起记录: rows go back with their old values; restoring twice does not duplicate', async () => {
  const { host, inst, codes, folds, pid } = await setup({ sqlite: false });
  await inst.runtime.clue.foldCollapse(['M1'], { manual: true });
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${pid}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  doc.querySelector('[data-act="clue-line-tab"][data-tab="end"]').click(); await tick();
  assert.match(doc.querySelector('[data-line-grp="end"]').textContent, /已收起2行/);
  doc.querySelector('[data-act="clue-fold-log"]').click(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  assert.match(dlg.textContent, /M1[\s\S]*2行，手动/);
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '全部恢复').click(); await tick(); await tick();
  same(codes('sheet_f'), ['F2', 'F1']);
  const row = host.w.AutoCardUpdaterAPI.exportTableAsJson().sheet_f.content.find((r) => r[1] === 'F1');
  same(row.slice(1), ['F1', '账本', '读到账本时登记', '已核实', '账本上的名字', '第1楼'], 'every column back by name');
  same(folds()[0].rows.map((x) => x.st), ['restored', 'restored']);
  const again = await inst.runtime.clue.foldRestore(() => true);
  assert.equal(again.rows, 0);
  same(codes('sheet_f'), ['F2', 'F1'], 'no duplicate');
  await inst.destroy();
});

test('the line is reopened (还原 标记完成) → the next sync restores its collapsed rows', async () => {
  const { inst, api, codes, state } = await setup();
  // end M1 by hand instead of by table
  api.exportTableAsJson().sheet_f.content[1][4] = '未获得';
  inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines();
  inst.runtime.clue.lineAct('M1', 'done');
  const r = await inst.runtime.clue.foldCollapse(['M1'], { manual: true });
  assert.equal(r.rows, 2);
  inst.runtime.clue.lineAct('M1', '');
  inst.runtime.clue.invalidate();
  await inst.runtime.clue.syncLines();
  assert.equal(state('M1'), '进行中');
  same(codes('sheet_f').sort(), ['F1', 'F2'], 'F1 restored');
  await inst.destroy();
});

test('floor checks: the delete floor removed and the row back → table wins; end floor removed → restored', async () => {
  const a = await setup();
  await a.inst.runtime.clue.foldCollapse(['M1'], { manual: true });
  // regenerate floor 3 (the delete floor); the database rebuilds the row
  a.host.state.chat[3] = { ...a.host.state.chat[3], send_date: 'a3-regen' };
  a.api.exportTableAsJson().sheet_f.content.push([9, 'F1', '账本', '读到账本时登记', '已核实', '账本上的名字', '第1楼']);
  a.inst.runtime.clue.invalidate();
  const st = a.inst.runtime.clue.foldCheck().status.find((x) => x.row.kind === 'fact');
  assert.equal(st.st, 'same', 'row back in the table, same content: the table wins');
  await a.inst.destroy();
  // end floor removed (floor 1) while rows are collapsed → lost → sync restores
  const b = await setup();
  await b.inst.runtime.clue.foldCollapse(['M1'], { manual: true });
  b.host.state.chat[1] = { ...b.host.state.chat[1], send_date: 'a1-regen' };
  b.inst.runtime.clue.invalidate();
  assert.ok(b.inst.runtime.clue.foldCheck().status.every((x) => x.st === 'lost'), 'end anchor gone');
  await b.inst.runtime.clue.syncLines();
  same(b.codes('sheet_f').sort(), ['F1', 'F2'], 'restored');
  await b.inst.destroy();
});

test('SQLite: voiding a collapsed fact records the clearing; the view and the restore use the cleared values', async () => {
  const { host, inst, api, folds } = await setup();
  await inst.runtime.clue.foldCollapse(['M1'], { manual: true });
  const r = await inst.runtime.clue.voidFact('F1');
  assert.equal(r.done, true);
  assert.ok(folds()[0].rows.every((x) => x.clr), 'clearing recorded on both rows');
  await inst.runtime.clue.foldRestore(() => true);
  const f = api.exportTableAsJson().sheet_f.content.find((x) => x[1] === 'F1'), k = api.exportTableAsJson().sheet_k.content.find((x) => x[2] === 'F1');
  same([f[4], k[4], k[5]], ['未获得', '未知', '未核实'], 'restored as cleared');
  assert.equal(folds()[0].rows[0].cells[4], '已核实', 'the record keeps the original value');
  await inst.destroy();
});

test('reset plugin is refused while this chat has collapsed rows', async () => {
  const { host, inst, pid } = await setup();
  await inst.runtime.clue.foldCollapse(['M1'], { manual: true });
  const toasts = [];
  host.w.toastr.warning = (m) => toasts.push(m);
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector('[data-act="drawer"]') && doc.querySelector('[data-act="drawer"]').click(); await tick();
  doc.querySelector('[data-act="page"][data-page="data"]').click(); await tick();
  doc.querySelector('[data-act="wipe"]').click(); await tick();
  assert.ok(toasts.some((m) => /已收起的表格行/.test(m)), toasts.join('|'));
  assert.ok(inst.data.project(pid), 'nothing wiped');
  await inst.destroy();
});

test('auto collapse needs a real fill after the end floor; manual does not', async () => {
  const { inst, codes } = await setup({ laterFill: false });
  const r = await inst.runtime.clue.foldCollapse(['M1']);
  assert.equal(r.ok, false, 'no fill after floor 1 yet');
  same(codes('sheet_f'), ['F1', 'F2']);
  assert.equal((await inst.runtime.clue.foldCollapse(['M1'], { manual: true })).rows, 2, 'manual collapse does not wait');
  await inst.destroy();
});

test('the database isolation changes in the middle → it stops; the rest waits for next time', async () => {
  const { host, inst, api, codes, folds } = await setup();
  api.beforeSql = async () => { host.ctx.extensionSettings = { __userscripts: { shujuku_v120__userscript_settings_v1: { shujuku_v120_globalMeta_v1: JSON.stringify({ activeIsolationCode: '二周目' }) } } }; };
  const r = await inst.runtime.clue.foldCollapse(['M1'], { manual: true });
  same([r.rows, !!r.stopped], [1, true], JSON.stringify(r));
  same(codes('sheet_k'), ['F1@user', 'F2@user'], 'the second row was not touched');
  same(folds()[0].rows.map((x) => x.st), ['deleted', 'saved']);
  await inst.destroy();
});

// ---------- 自动收起（按存储模式放行；没放行时一律不自动收） ----------
// 用户 2026-11-23：线索模式默认开启自动收起，两种存储都放开
test('auto collapse is released for both storages by default', async () => {
  const { inst } = await setup();
  same([inst.runtime.clue.foldRelease.native, inst.runtime.clue.foldRelease.sqlite], [true, true]);
  await inst.destroy();
});

test('auto collapse: never while the storage is not released, even with the chat switched on', async () => {
  const { inst, codes } = await setup();
  inst.runtime.clue.foldRelease.sqlite = false;
  inst.runtime.clue.setFoldChat('on');
  await inst.runtime.clue.syncLines();
  same(codes('sheet_f'), ['F1', 'F2']);
  await inst.destroy();
});

test('auto collapse once released: the next sync collapses ready lines and shows one top-bar notice; 恢复 restores them', async () => {
  const { host, inst, codes } = await setup();
  inst.runtime.clue.foldRelease.sqlite = true;
  try {
    inst.open(); await tick();
    inst.runtime.clue.setFoldChat('on');
    await inst.runtime.clue.syncLines(); await tick();
    same(codes('sheet_f'), ['F2'], 'collapsed by the sync');
    const bar = host.w.document.querySelector('.pi-topbar');
    assert.ok(bar, 'top bar shown');
    // 实测问题 13：大字写发生了什么，小字写几条几行；17：「恢复」点一次就执行
    assert.equal(bar.querySelector('.pi-topbar-text').textContent, '已收起结束的剧情线');
    assert.equal(bar.querySelector('.pi-topbar-tag').textContent, '1条线，共2行');
    bar.querySelector('.pi-topbar-act').click(); await tick(); await tick();
    same(codes('sheet_f').sort(), ['F1', 'F2'], 'restored from the notice with one click');
    // 实测问题 16：玩家恢复过的线，自动收起不再动它
    same(inst.runtime.clue.foldKept(), ['M1']);
    inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines(); await tick();
    same(codes('sheet_f').sort(), ['F1', 'F2'], 'not collapsed again by the next sync');
    // 从「⋯」手动收起后记号清掉，之后照常
    await inst.runtime.clue.foldCollapse(['M1'], { manual: true });
    same(inst.runtime.clue.foldKept(), []);
  } finally { inst.runtime.clue.foldRelease.sqlite = false; await inst.destroy(); }
});

test('released but the chat has not chosen: no auto collapse; the 已结束 tab asks once; 收起 switches the chat on', async () => {
  const { host, inst, pid, codes } = await setup();
  inst.runtime.clue.foldRelease.sqlite = true;
  try {
    await inst.runtime.clue.syncLines();
    same(codes('sheet_f'), ['F1', 'F2'], 'the chat has not opted in');
    inst.open(); await tick();
    const doc = host.w.document;
    doc.querySelector(`[data-act="project"][data-id="${pid}"]`).click(); await tick();
    doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
    doc.querySelector('[data-act="clue-line-tab"][data-tab="end"]').click(); await tick();
    assert.match(doc.querySelector('[data-line-grp="end"]').textContent, /本聊天尚未开启自动收起/);
    doc.querySelector('[data-act="clue-fold-chat"]').click(); await tick();
    const dlg = doc.querySelector('.pi-dialog');
    assert.match(dlg.textContent, /本聊天有1条已结束的剧情线，共2行/);
    [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '收起').click(); await tick();
    assert.equal(inst.runtime.clue.foldChat(), 'on');
  } finally { inst.runtime.clue.foldRelease.sqlite = false; await inst.destroy(); }
});

test('settings: the switches show only once released; turning it off with collapsed rows asks, 全部恢复并关闭 restores', async () => {
  const { host, inst, codes, pid } = await setup();
  inst.runtime.clue.foldRelease.sqlite = false;
  await inst.runtime.clue.foldCollapse(['M1'], { manual: true });
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${pid}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  const openSet = async () => { const t = doc.querySelector('[data-act="run-set-toggle"][aria-expanded="false"]'); t && (t.click(), await tick()); };
  await openSet();
  assert.equal(doc.querySelector('[data-clue-foldauto]'), null, 'not released: no switch');
  inst.runtime.clue.foldRelease.sqlite = true;
  try {
    inst.runtime.clue.invalidate(); await refresh(host.w.document); await openSet();
    const box = doc.querySelector('[data-clue-foldauto]');
    assert.ok(box && box.checked);
    box.checked = false; box.dispatchEvent(new host.w.Event('change', { bubbles: true })); await tick();
    const dlg = doc.querySelector('.pi-dialog');
    assert.match(dlg.textContent, /已收起的2行不会自动恢复/);
    [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '全部恢复并关闭').click(); await tick(); await tick();
    assert.equal(inst.data.project(pid).clue.foldAuto, false);
    same(codes('sheet_f').sort(), ['F1', 'F2']);
  } finally { inst.runtime.clue.foldRelease.sqlite = false; await inst.destroy(); }
});

// GPT 审阅 1、3、4
test('after collapse: the author progress text still lists F1 and who knows it; not-yet-found facts are not listed', async () => {
  const { inst } = await setup();
  const text = () => { const c = inst.runtime.clue.compute(); return C.clueProgressText(c.state, c.snap, c.prog); };
  assert.match(text(), /F1：账本上的名字｜知道：user/);
  await inst.runtime.clue.foldCollapse(['M1'], { manual: true });
  inst.runtime.clue.invalidate();
  const after = text();
  assert.match(after, /F1：账本上的名字｜知道：user/, 'collapsed fact kept in the author reference');
  assert.ok(!/F9/.test(after.split('已确认的事实')[1] || ''), 'F9 (template padding, not found yet) is not confirmed');
  await inst.destroy();
});

test('after collapse: F1 is not reported as a label to prepare; no auto-collapse wording before release', async () => {
  const { host, inst, pid } = await setup();
  const doc = host.w.document;
  const todo = () => { const el = doc.querySelector('.pi-labels-todo p'); return el ? el.title : ''; };
  inst.open(); await tick();
  doc.querySelector(`[data-act="project"][data-id="${pid}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  const before = todo();
  await inst.runtime.clue.foldCollapse(['M1'], { manual: true });
  inst.runtime.clue.invalidate();
  await refresh(host.w.document);
  assert.ok(!/(^|、)F1(、|$)/.test(todo()), `F1 not pending (before: ${before}, after: ${todo()})`);
  doc.querySelector('[data-act="clue-line-tab"][data-tab="end"]').click(); await tick();
  assert.ok(!/自动收起/.test(doc.querySelector('.pi-line-card').textContent), 'nothing about auto collapse');
  await inst.destroy();
});

test('SQLite: 标为未完成 on the node of a collapsed clue also clears the collapsed value (view and later restore read 未获得)', async () => {
  const { inst } = await setup({ sqlite: true });
  const r0 = await inst.runtime.clue.foldCollapse(['M1'], { manual: true });
  assert.ok(r0.ok);
  const before = inst.runtime.clue.compute().snap.cond.facts.get('F1');
  assert.equal(before && before.status, 'confirmed', 'collapsed F1 still reads as confirmed');
  const r = await inst.runtime.clue.clearNodeDone('a');
  assert.ok(r.done, JSON.stringify(r));
  const after = inst.runtime.clue.compute().snap.cond.facts.get('F1');
  assert.notEqual(after && after.status, 'confirmed', 'the collapsed value is cleared too');
  assert.ok(!r.stillDone, 'node a is no longer done');
  await inst.destroy();
});
