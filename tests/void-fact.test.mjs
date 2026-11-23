// GPT 实测返修审阅（f938b9e）R1–R3：「作废」的写回、知情条件、解除入口。
// R1：作废改表按事实编号（官方 executeSqlMutation），每一笔前核对票据和隔离标识；途中重排、切聊天、切项目、切隔离都不能写错对象。
// R2：作废后知情 / 角色核实条件也不算，表格被重新填回也一样。
// R3：作废后重新调查（插件正常给出这条发现）时，解除入口仍在；立即解除时的结果与表格一致。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';
import { buildTemplate, BINDING_YAML } from '../templates/clue-tables/build-template.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const C = loadCore();
const storyText = fs.readFileSync(path.join(here, '../templates/clue-tables/示例_小镇失窃案.yaml'), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 30));

function liveTables(t) {
  const out = JSON.parse(JSON.stringify(t));
  for (const [k, s] of Object.entries(out)) if (k.startsWith('sheet_')) s.content = s.content.map((row, i) => (i === 0 ? row : [i, ...row.slice(1)]));
  return out;
}
const base = () => buildTemplate({
  controlRow: ['主线', ''],
  factRows: [{ code: 'F_box', label: '钱箱撬痕' }, { code: 'F_ledger', label: '撕掉的账页' }, { code: 'F_seen', label: '邻居目击' }, { code: 'F_print', label: '后门门闩' }, { code: 'F_talk', label: '修车铺对话' }],
  knowRows: [{ fact: 'F_seen', actor: 'user' }, { fact: 'F_seen', actor: '老板娘' }, { fact: 'F_ledger', actor: 'user' }, { fact: 'F_ledger', actor: '老板娘' }],
});
const sheetOf = (t, name) => Object.values(t).find((x) => x && x.name === name);
function setCell(t, sheetName, key, col, value) {
  const s = sheetOf(t, sheetName), ci = s.content[0].indexOf(col), row = s.content.find((r, i) => i > 0 && r[1] === key);
  row[ci] = value;
}
const cell = (t, sheetName, key, col) => { const s = sheetOf(t, sheetName); return s.content.find((r, i) => i > 0 && r[1] === key)[s.content[0].indexOf(col)]; };

async function setup() {
  const tables = liveTables(base());
  // F_seen 被正文自己编出来：事实表存疑，user 被告知 / 已核实；另一条 F_ledger 是正常拿到的，作废 F_seen 时不能碰它。
  setCell(tables, '关键事实表', 'F_seen', '状态', '存疑'); setCell(tables, '关键事实表', 'F_seen', '内容', '那晚有人从后门出来');
  setCell(tables, '知情表', 'F_seen@user', '获知方式', '被告知'); setCell(tables, '知情表', 'F_seen@user', '可信度', '已核实');
  setCell(tables, '关键事实表', 'F_ledger', '状态', '已核实');
  setCell(tables, '知情表', 'F_ledger@user', '获知方式', '亲见'); setCell(tables, '知情表', 'F_ledger@user', '可信度', '已核实');
  const host = createHost({ tables });
  const inst = host.load();
  await inst.ready;
  const p = await inst.data.createProject('小镇失窃案');
  const volumes = Object.entries(YAML.parse(storyText)).map(([key, stages], vi) => ({ id: `v${vi}`, key, stages: Object.entries(stages).map(([sk, data], si) => ({ id: `s${vi}_${si}`, key: sk, data })) }));
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML) } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  return { host, inst, pid: p.id };
}
const eff = (inst, id) => { const c = inst.runtime.clue.compute(); return C.effectiveFact(id, c.snap, c.prog); };

test('R1 void: writes by fact code — both tables back to 未获得 / 未知 / 未核实, other facts untouched, result reported', async () => {
  const { host, inst } = await setup();
  const r = await inst.runtime.clue.voidFact('F_seen');
  assert.equal(r.done, true); assert.equal(r.table, 'ok', r.why);
  const t = host.db.tables;
  assert.equal(cell(t, '关键事实表', 'F_seen', '状态'), '未获得');
  assert.equal(cell(t, '知情表', 'F_seen@user', '获知方式'), '未知');
  assert.equal(cell(t, '知情表', 'F_seen@user', '可信度'), '未核实');
  assert.equal(cell(t, '关键事实表', 'F_ledger', '状态'), '已核实', 'other fact untouched');
  assert.equal(cell(t, '知情表', 'F_ledger@user', '获知方式'), '亲见', 'other knowledge row untouched');
  // parameterized: the fact code travels as a param, never inside the SQL text
  assert.ok(host.db && host.w.AutoCardUpdaterAPI.sqlCalls.every((x) => !x.sql.includes('F_seen') && x.params.includes('F_seen')));
  assert.equal(host.w.AutoCardUpdaterAPI.updated.length, 0, 'no row-index updateCell any more');
  await inst.destroy();
});

test('R1 void: knowledge rows reordered between the two writes — still clears F_seen, never touches F_ledger', async () => {
  const { host, inst } = await setup();
  const api = host.w.AutoCardUpdaterAPI;
  let n = 0;
  api.beforeSql = async () => {
    if (++n !== 2) return;
    // a fill commits between our writes and moves rows around (the old code reused the row index from before)
    const t = JSON.parse(JSON.stringify(host.db.tables)), k = sheetOf(t, '知情表');
    k.content = [k.content[0], ...k.content.slice(1).reverse()];
    host.db.setTables(t);
  };
  const r = await inst.runtime.clue.voidFact('F_seen');
  assert.equal(r.table, 'ok', r.why);
  const t = host.db.tables;
  assert.equal(cell(t, '知情表', 'F_seen@user', '获知方式'), '未知');
  assert.equal(cell(t, '知情表', 'F_ledger@user', '获知方式'), '亲见', 'unrelated row not overwritten');
  assert.equal(cell(t, '知情表', 'F_ledger@user', '可信度'), '已核实');
  await inst.destroy();
});

test('R1 void: chat switched after the first write — nothing written into chat B, partial result reported honestly', async () => {
  const { host, inst } = await setup();
  const api = host.w.AutoCardUpdaterAPI;
  const real = api.executeSqlMutation;
  // first write lands, then (before it returns to the plugin) the user opens chat B, which has same-named tables
  api.executeSqlMutation = async (sql, params) => {
    const res = await real(sql, params);
    if (api.sqlCalls.length === 1) { host.state.chatId = 'chat-B'; await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); }
    return res;
  };
  const r = await inst.runtime.clue.voidFact('F_seen');
  assert.equal(r.done, true, 'local revoke recorded in chat A');
  assert.equal(r.table, 'partial');
  assert.match(r.why, /切换/);
  assert.ok(api.sqlCalls.every((x) => x.chat !== 'chat-B'), 'no SQL issued while chat B was open');
  assert.equal(api.sqlCalls.length, 1);
  await inst.destroy();
});

test('R1 void: project switched / isolation key changed between writes — stops; a stale confirm ticket does nothing', async () => {
  // project switch
  {
    const { host, inst } = await setup();
    const other = await inst.data.createProject('别的项目');
    let n = 0;
    host.w.AutoCardUpdaterAPI.beforeSql = async () => { if (++n === 1) await inst.runtime.switchProject(other.id); };
    const r = await inst.runtime.clue.voidFact('F_seen');
    assert.equal(r.table, 'partial'); assert.equal(host.w.AutoCardUpdaterAPI.sqlCalls.length, 1);
    await inst.destroy();
  }
  // isolation key switch (shujuku 数据隔离): read from the extension settings, same place the database keeps it
  {
    const { host, inst } = await setup();
    const meta = (code) => ({ __userscripts: { shujuku_v120__userscript_settings_v1: { shujuku_v120_globalMeta_v1: JSON.stringify({ activeIsolationCode: code }) } } });
    host.ctx.extensionSettings = meta('');
    let n = 0;
    host.w.AutoCardUpdaterAPI.beforeSql = async () => { if (++n === 1) host.ctx.extensionSettings = meta('分支B'); };
    const r = await inst.runtime.clue.voidFact('F_seen');
    assert.equal(r.table, 'partial'); assert.equal(host.w.AutoCardUpdaterAPI.sqlCalls.length, 1);
    await inst.destroy();
  }
  // a ticket taken when the (mobile) confirm opened: the project changed meanwhile → nothing at all
  {
    const { host, inst } = await setup();
    const s0 = inst.runtime.clue.opScope();
    const other = await inst.data.createProject('别的项目');
    await inst.runtime.switchProject(other.id);
    const r = await inst.runtime.clue.voidFact('F_seen', s0);
    assert.equal(r.done, false);
    assert.equal(host.w.AutoCardUpdaterAPI.sqlCalls.length, 0);
    await inst.destroy();
  }
});

test('R1 void: write errors and native storage are reported, never claimed as done; the local revoke still holds', async () => {
  {
    const { host, inst } = await setup();
    host.w.AutoCardUpdaterAPI.sqlFails = 'SQL runtime 未就绪';
    const r = await inst.runtime.clue.voidFact('F_seen');
    assert.equal(r.done, true); assert.equal(r.table, 'none');
    assert.match(r.why, /SQL runtime 未就绪/);
    assert.equal(eff(inst, 'F_seen').v, C.TRI.f, 'plugin still treats it as not obtained');
    await inst.destroy();
  }
  {
    const { host, inst } = await setup();
    host.w.AutoCardUpdaterAPI.sqlite = false;
    const r = await inst.runtime.clue.voidFact('F_seen');
    assert.equal(r.table, 'none'); assert.match(r.why, /SQLite/);
    assert.equal(host.w.AutoCardUpdaterAPI.sqlCalls.length, 0, 'no fallback to row-index writes');
    assert.equal(host.w.AutoCardUpdaterAPI.updated.length, 0);
    await inst.destroy();
  }
  // the database says OK but the cell did not change (read-back): not claimed as ok
  {
    const { host, inst } = await setup();
    const api = host.w.AutoCardUpdaterAPI, real = api.executeSqlMutation;
    const seen = [];
    api.executeSqlMutation = async (arg, params) => { seen.push(arg); const sql = typeof arg === 'object' ? arg.sql : arg; return sql.includes('关键事实表') ? { changes: 1, errors: [] } : real(arg, params); };
    const r = await inst.runtime.clue.voidFact('F_seen');
    assert.equal(r.table, 'partial'); assert.match(r.why, /事实表中这条线索不是/);
    assert.ok(seen.every((x) => x && x.skipNotify === true), 'plugin writes skip the official update callback (D50 R9)');
    await inst.destroy();
  }
});

test('R2 void: knowledge / verified-knowledge conditions are suppressed too, even when both tables are refilled', () => {
  const env = (overrides) => ({ facts: new Map([['F_seen', { id: 'F_seen', status: 'confirmed', raw: '已核实' }]]), knowledge: [{ fact: 'F_seen', actor: 'user', way: '被告知', verified: true, credibility: '已核实' }], tables: {}, factOverrides: overrides });
  const know = { kind: 'know', fact: 'F_seen', actor: 'user', verified: false }, verified = { ...know, verified: true };
  assert.equal(C.evalAtom(know, env({})).v, C.TRI.t, 'baseline: user knows');
  assert.equal(C.evalAtom(verified, env({})).v, C.TRI.t);
  const revoked = env({ F_seen: { status: 'revoked', text: '' } });
  assert.equal(C.evalAtom(know, revoked).v, C.TRI.f, 'revoked: user does not know');
  assert.equal(C.evalAtom(verified, revoked).v, C.TRI.f, 'revoked: not verified');
  assert.equal(C.evalAtom({ kind: 'fact', fact: 'F_seen', verified: true }, revoked).v, C.TRI.f);
  assert.equal(C.evalAtom({ kind: 'fact', fact: 'F_seen', verified: false }, revoked).v, C.TRI.f);
  // a manual confirm does not make anyone know it
  const confirmedOnly = { ...env({ F_seen: { status: 'confirmed', text: '' } }), knowledge: [] };
  assert.equal(C.evalAtom(know, confirmedOnly).v, C.TRI.u);
});

test('R2 void (runtime): 核实@角色 stays false after void even when the fill writes both tables back; restore → table decides again', async () => {
  const { host, inst } = await setup();
  await inst.runtime.clue.voidFact('F_seen');
  // the fill re-derives it from the old prose: both tables say obtained again
  const t = JSON.parse(JSON.stringify(host.db.tables));
  setCell(t, '关键事实表', 'F_seen', '状态', '存疑'); setCell(t, '知情表', 'F_seen@user', '获知方式', '被告知'); setCell(t, '知情表', 'F_seen@user', '可信度', '已核实');
  host.db.setTables(t);
  const c = inst.runtime.clue.compute();
  assert.equal(C.evalAtom({ kind: 'know', fact: 'F_seen', actor: 'user', verified: true }, { facts: c.snap.facts, knowledge: c.snap.knowledge, tables: c.snap.tables, factOverrides: c.prog.factOverrides }).v, C.TRI.f);
  inst.runtime.clue.restoreFact('F_seen');
  const c2 = inst.runtime.clue.compute();
  assert.equal(C.evalAtom({ kind: 'know', fact: 'F_seen', actor: 'user', verified: true }, { facts: c2.snap.facts, knowledge: c2.snap.knowledge, tables: c2.snap.tables, factOverrides: c2.prog.factOverrides }).v, C.TRI.t, 'restored: table decides');
  await inst.destroy();
});

test('R3: after void, re-investigation (fact offered again, table refilled) keeps the 解除作废 line; immediate restore matches the table', async () => {
  const { host, inst } = await setup();
  await inst.runtime.clue.voidFact('F_seen');
  const line = () => inst.runtime.clue.compute().unoffered.find((x) => x.id === 'F_seen');
  assert.equal(line().revoked, true);
  // the plugin offers F_seen again (it ends up in clueOffered) and the fill writes it again
  const prog = inst.runtime.progress();
  inst.runtime.setProgress({ ...prog, clueOffered: [...(prog.clueOffered || []), 'F_seen'] });
  inst.runtime.clue.invalidate();
  const t = JSON.parse(JSON.stringify(host.db.tables)); setCell(t, '关键事实表', 'F_seen', '状态', '已核实'); host.db.setTables(t);
  assert.ok(line() && line().revoked, 'restore entry still there although F_seen was offered');
  assert.equal(line().text, '那晚有人从后门出来', 'text kept from the void op');
  // restore now: table says 已核实 → obtained
  assert.equal(inst.runtime.clue.restoreFact('F_seen').confirmed, true);
  assert.equal(line(), undefined, 'offered + not revoked → no line');
  await inst.destroy();
});

test('R3: void then restore right away — result follows the cleared table, UI says so (no "back to original progress")', async () => {
  const { host, inst } = await setup();
  inst.open(); await tick();
  const doc = host.w.document, click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  const toasts = []; for (const k of ['info', 'success', 'warning', 'error']) host.w.toastr[k] = (m) => toasts.push([k, String(m)]);
  await click('[data-act="tab"][data-tab="run"]');
  await click('[data-act="clue-fact-void"][data-id="F_seen"]');
  // 作废会改表格：先确认一次（桌面、手机都问）
  await click('.pi-dialog .pi-btn.is-primary');
  assert.ok(toasts.some(([k, m]) => k === 'success' && /表格已改回未获得/.test(m)), JSON.stringify(toasts));
  const btn = doc.querySelector('[data-act="clue-fact-restore"][data-id="F_seen"]');
  assert.equal(btn.textContent, '解除作废');
  assert.match(btn.title, /不恢复已清除的记录/);
  await click('[data-act="clue-fact-restore"][data-id="F_seen"]');
  assert.equal(eff(inst, 'F_seen').confirmed, false, 'table was cleared → still not obtained');
  assert.ok(toasts.some(([, m]) => /按未获得处理.*不会恢复/.test(m)), JSON.stringify(toasts));
  await inst.destroy();
});

test('R1 UI: mobile confirm is bound to the scope when it opened — switching project meanwhile makes 作废 do nothing', async () => {
  const { host, inst, pid } = await setup();
  host.w.matchMedia = () => ({ matches: true });
  inst.open(); await tick();
  const doc = host.w.document, click = async (el) => { assert.ok(el); el.click(); await tick(); };
  const toasts = []; for (const k of ['info', 'success', 'warning', 'error']) host.w.toastr[k] = (m) => toasts.push([k, String(m)]);
  await click(doc.querySelector('[data-act="tab"][data-tab="run"]'));
  await click(doc.querySelector('[data-act="clue-fact-void"][data-id="F_seen"]'));
  const dlg = doc.querySelector('.pi-dialog');
  assert.ok(dlg, 'confirm opens on touch');
  assert.doesNotMatch(dlg.textContent, /点错了可以点/, 'no unconditional "you can undo" promise');
  assert.match(dlg.textContent, /不删除/);
  // while the dialog is open the user switches to another clue project with the same fact codes (the dangerous case:
  // re-reading the old button against the new project would revoke F_seen there)
  const other = await inst.data.createProject('同款项目');
  const cur = inst.data.project(pid);
  inst.data.updateProject(other.id, (x) => ({ ...x, outline: cur.outline, clue: cur.clue }));
  await inst.runtime.switchProject(other.id);
  await click([...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '作废'));
  assert.equal(host.w.AutoCardUpdaterAPI.sqlCalls.length, 0, 'no table write');
  assert.equal(cell(host.db.tables, '关键事实表', 'F_seen', '状态'), '存疑');
  assert.ok(toasts.some(([, m]) => /切换/.test(m)), JSON.stringify(toasts));
  assert.ok(!inst.runtime.clue.compute().prog.factOverrides.F_seen, 'nothing revoked in the new project');
  await inst.destroy();
});

// GPT 返修与删联动审阅（4bebb3e）R2：确认框打开期间切了数据隔离，确认后整次不执行（没有 SQL，也不留作废记录）。
test('R2 void: isolation switched while the confirm was open → no SQL, no revoke op', async () => {
  const { host, inst } = await setup();
  const meta = (code) => ({ __userscripts: { shujuku_v120__userscript_settings_v1: { shujuku_v120_globalMeta_v1: JSON.stringify({ activeIsolationCode: code }) } } });
  host.ctx.extensionSettings = meta('A');
  const s0 = inst.runtime.clue.opScope();
  host.ctx.extensionSettings = meta('B');
  const r = await inst.runtime.clue.voidFact('F_seen', s0);
  assert.equal(r.done, false);
  assert.match(r.why, /数据隔离/);
  assert.equal(host.w.AutoCardUpdaterAPI.sqlCalls.length, 0, 'no SQL into branch B');
  assert.ok(!inst.runtime.clue.compute().prog.factOverrides.F_seen, 'no revoke recorded');
  await inst.destroy();
});

// GPT 返修与删联动审阅（4bebb3e）R3：读不到绑定的表 ≠ 已经清空；SQL 的错误要进结果，不能报「表格也改回了未获得」。
test('R3 void: unreadable tables or SQL errors are never reported as ok', async () => {
  const rename = (host, from, to) => { const t = JSON.parse(JSON.stringify(host.db.tables)); Object.values(t).find((x) => x && x.name === from).name = to; host.db.setTables(t); };
  // both tables renamed after the confirm opened: SQL fails, read-back finds nothing → not ok
  {
    const { host, inst } = await setup();
    const s0 = inst.runtime.clue.opScope();
    rename(host, '关键事实表', '事实表旧'); rename(host, '知情表', '知情表旧');
    // the database says the writes went through (e.g. it rebinds names differently), but the bound tables cannot be read back
    host.w.AutoCardUpdaterAPI.executeSqlMutation = async () => ({ changes: 1, errors: [] });
    const r = await inst.runtime.clue.voidFact('F_seen', s0);
    assert.equal(r.done, true, 'local revoke still recorded');
    assert.notEqual(r.table, 'ok');
    assert.match(r.why, /读不到/);
    await inst.destroy();
  }
  // fact table readable and cleared, knowledge table gone → partial, with the reason
  {
    const { host, inst } = await setup();
    const s0 = inst.runtime.clue.opScope();
    rename(host, '知情表', '知情表旧');
    const r = await inst.runtime.clue.voidFact('F_seen', s0);
    assert.equal(r.table, 'partial');
    assert.match(r.why, /知情表/);
    await inst.destroy();
  }
  // a SQL error is reported even when the read-back happens to look clean
  {
    const { host, inst } = await setup();
    const api = host.w.AutoCardUpdaterAPI, real = api.executeSqlMutation;
    api.executeSqlMutation = async (arg, params) => { const res = await real(arg, params); const sql = typeof arg === 'object' ? arg.sql : arg; return sql.includes('知情表') ? { ...res, errors: ['磁盘写入失败'] } : res; };
    const r = await inst.runtime.clue.voidFact('F_seen');
    assert.notEqual(r.table, 'ok');
    assert.match(r.why, /磁盘写入失败/);
    await inst.destroy();
  }
  // normal case: target table readable and the row really has no record → ok
  {
    const { inst } = await setup();
    assert.equal((await inst.runtime.clue.voidFact('F_box')).table, 'ok', 'F_box was never obtained: nothing to clear is fine');
    await inst.destroy();
  }
});
