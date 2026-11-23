// 在已经聊了一阵的聊天里生成线索模板：数据库会把新表从第 1 楼起逐批补填，补完前新剧情记不进表。
// 插件导入后用官方手动填表让线索表从当前楼层开始记；没记上（数据库正忙、开始那一楼被重新生成）就等空闲再来，玩家取消则不再弹。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';

const C = loadCore();
const tick = () => new Promise((r) => setTimeout(r, 20));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const node = (id, fact) => ({ id, 名称: id, 入口: `去${id}`, 地点: id, 发现: [{ 事实: fact, 内容: `${id}查到的`, 记录: `看到${id}时登记` }], 完成条件: { 事实: fact } });
const volumes = () => [
  { id: 'vM1', key: '剧情_M1_街区', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 'sM1', key: '阶段1_街区', data: { 主线节点: [node('n_a', 'F_a'), node('n_b', 'F_b')] } }] },
];
const frame = (entries, extra = {}) => ({ TavernDB_ACU_IsolatedData: { '': { storageFrame: { version: 2, logEntries: entries, ...extra } } } });

test('trackedFillFloor: newest fill record of the sheet, by entry aiFloor or the floor it sits on; plugin inserts do not count', () => {
  const chat = [
    { is_user: false, mes: '开场' },
    { is_user: true, mes: '1' }, { is_user: false, mes: 'a', ...frame([{ source: 'group_fill', filledSheetKeys: ['sheet_c'] }]) },
    { is_user: true, mes: '2' }, { is_user: false, mes: 'b' },
    { is_user: true, mes: '3' }, { is_user: false, mes: 'c', ...frame([{ source: 'manual_crud', filledSheetKeys: [], operations: [{ sheetKey: 'sheet_c' }] }]) },
  ];
  assert.equal(C.trackedFillFloor(chat, 'sheet_c'), 2, 'floor of the record (second AI floor)');
  assert.equal(C.trackedFillFloor(chat, 'sheet_x'), 0, 'never filled');
  chat[4] = { ...chat[4], ...frame([{ source: 'group_fill', aiFloor: 1, groupKeys: ['sheet_c'] }]) };
  assert.equal(C.trackedFillFloor(chat, 'sheet_c'), 1, 'a backfill batch records the floor it covered (aiFloor), found first from the end');
  chat[6] = { ...chat[6], ...frame([], { perSheetCheckpoints: { sheet_c: { scheduleSummary: { lastFilledAiFloor: 4 } } } }) };
  assert.equal(C.trackedFillFloor(chat, 'sheet_c'), 4, 'checkpoint schedule summary');
  chat[6] = { ...chat[6], TavernDB_ACU_IsolatedData: { a: { storageFrame: {} }, b: { storageFrame: {} } } };
  assert.equal(C.trackedFillFloor(chat, 'sheet_c'), null, 'two isolation codes, none chosen → unknown');
  assert.equal(C.aiFloorCount(chat), 4);
});

const fast = (inst) => { inst.runtime.clue.startTiming.delay = 40; inst.runtime.clue.startTiming.quiet = 0; };
const settle = async (inst, host, api) => { host.db.setTables(api.exportTableAsJson()); await wait(1700); await inst.runtime.clue.syncLines(); await wait(200); await tick(); };

async function setup({ floors = 5, prevSel = null } = {}) {
  const tables = { mate: { type: 'chatSheets', version: 1 }, sheet_g: { uid: 'sheet_g', name: '全局数据表', orderNo: 0, sourceData: { note: 'x' }, content: [['row_id', '全局状态', '当前时间', '当前详细地点']], updateConfig: { updateFrequency: 3 }, exportConfig: {} } };
  const host = createHost({ tables });
  host.state.chat.push({ is_user: false, mes: '开场', send_date: 'g' });
  for (let i = 1; i < floors; i++) host.state.chat.push({ is_user: true, mes: `问${i}`, send_date: `u${i}` }, { is_user: false, mes: `答${i}`, send_date: `a${i}`, swipe_id: 0 });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('中途开线索');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: volumes() }, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  const api = host.w.AutoCardUpdaterAPI;
  prevSel && api.setManualSelectedTables(prevSel);
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  (() => { const t = doc.querySelector('[data-act="run-set-toggle"][aria-expanded="false"]'); t && t.click(); })(); await tick(); (() => { const t = doc.querySelector('[data-act="run-fold"][data-key="advOpen"][aria-expanded="false"]'); t && t.click(); })(); await tick();
  const gen = async () => {
    doc.querySelector('[data-act="clue-gen-template"]').click(); await tick();
    const dlg = doc.querySelector('.pi-dialog');
    dlg.querySelectorAll('[data-gt-label]').forEach((el, i) => { el.value = `标签${i}`; el.dispatchEvent(new el.ownerDocument.defaultView.Event('input', { bubbles: true })); });
    [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '写入当前聊天').click();
    for (let i = 0; i < 10; i++) await tick();
    await wait(1700); await inst.runtime.clue.syncLines();
  };
  const keyOf = (name) => Object.entries(api.exportTableAsJson()).find(([, s]) => s && s.name === name)[0];
  const codes = () => api.exportTableAsJson()[keyOf('关键事实表')].content.slice(1).map((r) => r[1]).sort();
  return { host, inst, api, gen, keyOf, codes };
}

test('long chat: after importing the template the clue tables start from the current floor, rows come after, the selection is restored', async () => {
  const { host, inst, api, gen, keyOf, codes } = await setup({ prevSel: ['sheet_g'] });
  // a real import takes a while: the table update it fires schedules a sync that runs before the import returns
  const orig = api.importTemplateFromData;
  // and in a chat with several user messages the database does not use the template's initial rows (seed off)
  api.importTemplateFromData = async (...a) => {
    const r = await orig(...a);
    for (const sh of Object.values(api.exportTableAsJson())) sh && /关键事实表|知情表/.test(sh.name) && (sh.content = [sh.content[0]]);
    await wait(1700);
    return r;
  };
  // the confirm dialog stays open a while: syncs scheduled meanwhile must not insert rows the fill then wipes
  api.confirmDelay = 1800;
  const mu = api.manualUpdate;
  api.manualUpdate = async () => { setTimeout(() => host.db.setTables(api.exportTableAsJson()), 50); return mu(); };
  await gen();
  for (let i = 0; i < 100 && !inst.runtime.progress().clueStart; i++) await wait(50);
  await wait(1700); await inst.runtime.clue.syncLines();
  assert.equal(api.manualCalls.length, 1);
  assert.deepEqual(api.manualCalls[0].keys.sort(), [keyOf('线索控制表'), keyOf('关键事实表'), keyOf('知情表')].sort());
  assert.equal(api.manualCalls[0].insertedBefore, 0, 'no clue row inserted before the fill (it would be wiped)');
  assert.deepEqual(codes(), ['F_a', 'F_b'], 'rows filled in after the fill');
  assert.equal(C.trackedFillFloor(host.state.chat, keyOf('线索控制表')), 5, 'recorded up to the current AI floor');
  assert.deepEqual(api.getManualSelectedTables(), { selectedTables: ['sheet_g'], hasManualSelection: true }, 'user selection back');
  assert.equal(inst.runtime.progress().clueStart.ai, 5);
  await inst.destroy();
});

test('SQLite: the new tables are not loaded right after the import → the database is asked to reload, then the start runs', async () => {
  const { host, inst, api, gen, keyOf } = await setup();
  api.hideNew = true;
  await gen();
  assert.equal(api.refreshCalls, 1);
  assert.equal(api.manualCalls.length, 1);
  assert.equal(C.trackedFillFloor(host.state.chat, keyOf('线索控制表')), 5);
  assert.ok(!host.toasts.some((t) => t.type === 'warning' && /没能从当前楼层开始记录/.test(t.msg)));
  await inst.destroy();
});

test('SQLite: still not loaded after the reload → no fill, no warning; it starts once the tables show up', async () => {
  const { host, inst, api, gen, keyOf } = await setup();
  fast(inst);
  api.hideNew = true; api.refreshNoop = true;
  await gen();
  assert.equal(api.manualCalls.length, 0, 'the fill is not run against tables the database cannot see');
  assert.equal(JSON.stringify(inst.runtime.progress().clueStart), JSON.stringify({ ai: 5, tries: 0 }));
  assert.ok(!host.toasts.some((t) => /没能从当前楼层开始记录|读表暂未读到|重新读表/.test(t.msg)), 'no warning, nothing for the player to click');
  assert.ok(host.toasts.some((t) => t.type === 'success' && /已导入/.test(t.msg)));
  api.refreshNoop = false; api.reveal();
  await wait(1700); await inst.runtime.clue.syncLines(); await wait(300); await tick();
  assert.equal(api.manualCalls.length, 1);
  assert.equal(C.trackedFillFloor(host.state.chat, keyOf('线索控制表')), 5);
  await inst.destroy();
});

test('SQLite: the reload only works on a later try (no other table event in between) → the plugin asks again by itself', async () => {
  const { host, inst, api, gen, keyOf } = await setup();
  fast(inst);
  api.hideNew = true; api.refreshNoop = true;
  await gen();
  assert.equal(api.manualCalls.length, 0);
  api.refreshNoop = false;
  for (let i = 0; i < 20 && !api.manualCalls.length; i++) await wait(50);
  assert.ok(api.refreshCalls >= 2, 'asked the database to reload again');
  assert.equal(api.manualCalls.length, 1);
  await wait(1700); await inst.runtime.clue.syncLines();
  assert.equal(C.trackedFillFloor(host.state.chat, keyOf('线索控制表')), 5);
  await inst.destroy();
});

test('reopening the chat (page reload) after the tables finally loaded: the start runs without waiting for a fill', async () => {
  const { host, inst, api, gen, keyOf } = await setup();
  fast(inst);
  api.hideNew = true; api.refreshNoop = true;
  await gen();
  for (let i = 0; i < 4; i++) { await wait(60); await tick(); }
  assert.equal(api.manualCalls.length, 0);
  // the reload: the database now has the tables (no table-update event), the chat is opened again
  Object.assign(api.exportTableAsJson(), api.pending); api.pending = null; api.refreshNoop = false;
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  for (let i = 0; i < 60 && !api.manualCalls.length; i++) await wait(50);
  assert.equal(api.manualCalls.length, 1, 'started after the chat was opened');
  await wait(1700); await inst.runtime.clue.syncLines();
  assert.equal(C.trackedFillFloor(host.state.chat, keyOf('线索控制表')), 5);
  await inst.destroy();
});

test('fresh chat (few AI floors): no extra fill', async () => {
  const { api, inst, gen } = await setup({ floors: 2 });
  await gen();
  assert.equal(api.manualCalls.length, 0);
  assert.equal(api.getManualSelectedTables().hasManualSelection, false);
  await inst.destroy();
});


test('the user cancels the database confirm: a warning, rows still filled in, never asked again', async () => {
  const { host, inst, api, gen, codes } = await setup();
  fast(inst);
  api.manualCancel = true;
  await gen();
  assert.equal(api.manualCalls.length, 1);
  assert.ok(host.toasts.some((t) => t.type === 'warning' && /没能从当前楼层开始记录/.test(t.msg)));
  assert.deepEqual(codes(), ['F_a', 'F_b']);
  assert.equal(inst.runtime.progress().clueStart.off, true);
  await settle(inst, host, api);
  assert.equal(api.manualCalls.length, 1, 'cancel is respected');
  await inst.destroy();
});

test('confirmed but the database was busy: tried again once it is idle, no warning', async () => {
  const { host, inst, api, gen, keyOf } = await setup();
  fast(inst);
  api.manualBusy = 1;
  await gen();
  await settle(inst, host, api);
  assert.equal(api.manualCalls.length, 2, 'retried');
  assert.equal(C.trackedFillFloor(host.state.chat, keyOf('线索控制表')), 5);
  assert.ok(!host.toasts.some((t) => t.type === 'warning' && /没能从当前楼层开始记录/.test(t.msg)));
  await settle(inst, host, api);
  assert.equal(api.manualCalls.length, 2, 'done, no more');
  await inst.destroy();
});

test('confirmed but failing every time: gives up after 3 tries with a warning', async () => {
  const { host, inst, api, gen } = await setup();
  fast(inst);
  api.manualBusy = 99;
  await gen();
  for (let i = 0; i < 4; i++) await settle(inst, host, api);
  assert.equal(api.manualCalls.length, 3);
  assert.equal(inst.runtime.progress().clueStart.off, true);
  assert.equal(host.toasts.filter((t) => t.type === 'warning' && /没能从当前楼层开始记录/.test(t.msg)).length, 1);
  await inst.destroy();
});

test('the start floor is regenerated (record and rows gone): once the database is idle it starts again, once', async () => {
  const { host, inst, api, gen, keyOf, codes } = await setup();
  await gen();
  fast(inst);
  const last = host.state.chat[host.state.chat.length - 1];
  delete last.TavernDB_ACU_IsolatedData; last.send_date = 'regen';
  const t = api.exportTableAsJson();
  for (const n of ['线索控制表', '关键事实表', '知情表']) t[keyOf(n)].content = [t[keyOf(n)].content[0]];
  host.db.setTables(t);
  await wait(1700); await inst.runtime.clue.syncLines(); await wait(150); await tick();
  assert.equal(api.manualCalls.length, 2, 'started again');
  await wait(1700); await inst.runtime.clue.syncLines();
  assert.equal(C.trackedFillFloor(host.state.chat, keyOf('线索控制表')), 5);
  assert.deepEqual(codes(), ['F_a', 'F_b']);
  await settle(inst, host, api);
  assert.equal(api.manualCalls.length, 2, 'no third fill');
  await inst.destroy();
});

test('a later failed fill (record stays at the start floor) does not trigger a new start', async () => {
  const { host, inst, api, gen } = await setup();
  await gen();
  fast(inst);
  host.state.chat.push({ is_user: true, mes: '再问', send_date: 'u9' }, { is_user: false, mes: '再答', send_date: 'a9', swipe_id: 0 });
  await settle(inst, host, api);
  assert.equal(api.manualCalls.length, 1);
  await inst.destroy();
});
