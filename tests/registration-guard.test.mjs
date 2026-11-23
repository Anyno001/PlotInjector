// 线索建行与登记方案 二.3（2026-11-23）：越序登记撤回。
// 只查还没认可的新登记；已认可的是起点，本批新登记按前提逐步纳入；暂停、正常结束的线不挡，没开始的线挡。
// 前提不成立的：SQLite 写回未获得（先备份），执行页「需要处理」可保留；升级后第一次只建底账，不撤回旧登记。
import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';
import { buildTemplate, BINDING_YAML } from '../templates/clue-tables/build-template.mjs';

const C = loadCore();
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const tick = () => new Promise((r) => setTimeout(r, 30));
const node = (id, fact, extra = {}) => ({ id, 名称: id, 入口: `去${id}`, 地点: id, 发现: [{ 事实: fact, 内容: `${id}查到的`, 记录: `看到${id}时登记` }], 完成条件: { 事实: fact }, ...extra });
// M1：甲 → 乙 → 结局（结局阶段另有一个可选节点）；S2：开线事件 F_call、走进入口才开始
function volumes() {
  return [
    { id: 'vM1', key: '剧情_M1_街区', line: { 编号: 'M1', 类型: '主线' }, stages: [
      { id: 's1', key: '阶段1_甲', data: { 结束条件: { 事实: 'F_a' }, 主线节点: [node('n_a', 'F_a')] } },
      { id: 's2', key: '阶段2_乙', data: { 结束条件: { 事实: 'F_b' }, 主线节点: [node('n_b', 'F_b')] } },
      { id: 's3', key: '阶段3_结局', data: { 结束条件: { 事实: 'F_c' }, 主线节点: [node('n_c', 'F_c')], 支线事件: [node('n_opt', 'F_opt', { 必需: false })] } },
    ] },
    { id: 'vS2', key: '剧情_S2_来电', line: { 编号: 'S2', 类型: '支线', 开启条件: { 事实: 'F_call' } }, stages: [
      { id: 'sS', key: '阶段1_来电', data: { 主线节点: [node('n_s2', 'F_s2')] } },
    ] },
  ];
}
const FB = [{ 表: '关键事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }];
const CFG = { mode: 'clue', bindings: { facts: FB, knowledge: [] } };
const snapOf = (codes) => ({ facts: new Map(codes.map((c) => [c, { id: c, status: 'confirmed', raw: '已核实' }])), knowledge: [], tables: {}, problems: [] });
const check = (registered, accepted, prog = C.emptyClueProgress(), vols = volumes()) => {
  const r = C.admitRegistrations(C.compileClue(vols), snapOf(registered), prog, CFG, new Set(accepted));
  return { admit: [...r.admit].sort(), held: [...r.held].sort() };
};

test('admit: a normal chain in one batch (A then B) is admitted step by step', () => {
  assert.deepEqual(check(['F_a', 'F_b'], []), { admit: ['F_a', 'F_b'], held: [] });
});

test('admit: the ending registered before its stage is reached is held; with the earlier steps already accepted it is admitted', () => {
  assert.deepEqual(check(['F_a', 'F_c'], ['F_a']), { admit: [], held: ['F_c'] }, 'B not registered: stage 3 not entered');
  assert.deepEqual(check(['F_a', 'F_b', 'F_c'], ['F_a', 'F_b']), { admit: ['F_c'], held: [] });
});

test('admit: a node of a line that has not started is held; an opening event (no producing node) is always admitted', () => {
  assert.deepEqual(check(['F_s2', 'F_call'], []), { admit: ['F_call'], held: ['F_s2'] }, 'S2 needs its entrance to start');
});

test('admit: a paused line and a line that already ended do not block new registrations', () => {
  const paused = { ...C.emptyClueProgress(), lines: { M1: { started: true, state: 'pause' } } };
  assert.deepEqual(check(['F_a', 'F_b'], ['F_a'], paused), { admit: ['F_b'], held: [] }, 'coming back to a paused case');
  const ended = check(['F_a', 'F_b', 'F_c', 'F_opt'], ['F_a', 'F_b', 'F_c']);
  assert.deepEqual(ended, { admit: ['F_opt'], held: [] }, 'an optional find after the line finished');
});

test('admit: a fact the player confirmed by hand is not checked again', () => {
  const prog = { ...C.emptyClueProgress(), factOverrides: { F_c: { status: 'confirmed' } } };
  assert.deepEqual(check(['F_c'], [], prog), { admit: [], held: [] });
});

test('withHeld: held facts read as not obtained in facts, knowledge and the table view', () => {
  const tables = {
    sheet_f: { key: 'sheet_f', name: '关键事实表', content: [[null, '编号', '状态'], [1, 'F_c', '已核实']] },
    sheet_k: { key: 'sheet_k', name: '知情表', content: [[null, '事实', '角色', '获知方式'], [1, 'F_c', 'user', '亲见']] },
  };
  const snap = { facts: new Map([['F_c', { id: 'F_c', status: 'confirmed' }]]), knowledge: [{ fact: 'F_c', actor: 'user' }], tables };
  const out = C.withHeld(snap, new Set(['F_c']), { facts: FB, knowledge: [{ 表: '知情表', 事实列: '事实', 角色列: '角色', 方式列: '获知方式', 未知值: ['未知'] }] });
  assert.equal(out.facts.get('F_c').status, 'unconfirmed');
  assert.deepEqual(out.knowledge, []);
  assert.equal(out.tables.sheet_f.content[1][2], '未获得');
  assert.equal(out.tables.sheet_k.content[1][3], '未知');
  assert.equal(tables.sheet_f.content[1][2], '已核实', 'real table untouched');
});

// ---------- panel ----------
function liveTables(t) {
  const out = JSON.parse(JSON.stringify(t));
  for (const [k, s] of Object.entries(out)) if (k.startsWith('sheet_')) s.content = s.content.map((row, i) => (i === 0 ? row : [i, ...row.slice(1)]));
  return out;
}
async function setup(pre = []) {
  const codes = ['F_a', 'F_b', 'F_c', 'F_opt', 'F_call'];
  const t = liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: codes.map((code) => ({ code, label: `标签${code}` })), knowRows: [{ fact: 'F_b', actor: 'user' }] }));
  const host = createHost({ tables: t });
  pre.forEach((c) => setStatusIn(t, c, '已核实'));
  host.db.setTables(t);
  const inst = host.load();
  await inst.ready;
  const p = await inst.data.createProject('越序');
  const vols = volumes();
  const labels = Object.fromEntries(C.labelsToPrepare(vols, {}).map((x) => [x.code, { label: `标签${x.code}`, criterion: '看到时登记；没看到不算', sig: x.sig }]));
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML), labels } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  return { host, inst, pid: p.id };
}
const factSheet = (t) => Object.values(t).find((x) => x && x.name === '关键事实表');
function setStatusIn(t, code, v) {
  const s = factSheet(t);
  s.content.find((r, i) => i > 0 && r[s.content[0].indexOf('编号')] === code)[s.content[0].indexOf('状态')] = v;
}
const statusOf = (host, code) => {
  const s = factSheet(host.w.AutoCardUpdaterAPI.exportTableAsJson());
  return s.content.find((r, i) => i > 0 && r[s.content[0].indexOf('编号')] === code)[s.content[0].indexOf('状态')];
};
const setStatus = (host, code, v) => {
  const t = JSON.parse(JSON.stringify(host.w.AutoCardUpdaterAPI.exportTableAsJson()));
  setStatusIn(t, code, v);
  host.db.setTables(t);
};
const knowWay = (host) => {
  const s = Object.values(host.w.AutoCardUpdaterAPI.exportTableAsJson()).find((x) => x && x.name === '知情表');
  return s.content.find((r, i) => i > 0 && r[s.content[0].indexOf('事实')] === 'F_b')[s.content[0].indexOf('获知方式')];
};
const sync = async (host, inst, text) => {
  await host.addMessage(text, false);
  await host.settle(); inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines(); await tick();
};

test('panel: upgrading an old chat only takes a baseline — an early registration already in the table is kept', async () => {
  const { host, inst } = await setup(['F_c']);
  await host.addMessage('一', true);
  await sync(host, inst, '开始。');
  assert.equal(statusOf(host, 'F_c'), '已核实', 'not withdrawn');
  same(inst.runtime.clue.withdrawnList(), []);
  await inst.destroy();
});

test('panel: B registered before A → written back to 未获得 with a backup; 保留这次登记 restores it as it was and it is not checked again', async () => {
  const { host, inst, pid } = await setup();
  await host.addMessage('一', true);
  await sync(host, inst, '开始。'); // baseline (nothing registered)
  setStatus(host, 'F_b', '存疑');
  const t = JSON.parse(JSON.stringify(host.w.AutoCardUpdaterAPI.exportTableAsJson()));
  const k = Object.values(t).find((x) => x && x.name === '知情表');
  k.content.find((r, i) => i > 0 && r[k.content[0].indexOf('事实')] === 'F_b')[k.content[0].indexOf('获知方式')] = '被告知';
  host.db.setTables(t);
  await sync(host, inst, '乙那边先有人说了。');
  assert.equal(statusOf(host, 'F_b'), '未获得', 'withdrawn in the table');
  assert.equal(knowWay(host), '未知');
  const w = inst.runtime.clue.withdrawnList();
  assert.equal(w.length, 1);
  assert.equal(w[0].raw, '存疑');
  // run page row
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${pid}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  assert.match(doc.querySelector('.pi-body').textContent, /提前登记已撤回：标签F_b（原登记：存疑/);
  doc.querySelector('[data-act="clue-wd-keep"][data-id="F_b"]').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(statusOf(host, 'F_b'), '存疑', 'restored as it was, not upgraded');
  assert.equal(knowWay(host), '被告知');
  same(inst.runtime.clue.withdrawnList(), []);
  await sync(host, inst, '继续。');
  assert.equal(statusOf(host, 'F_b'), '存疑', 'kept: not withdrawn again');
  // 执行页界面审阅 R1：保留之后不再问「正文可能自行编造」
  assert.ok(!inst.runtime.clue.compute().unoffered.some((x) => x.id === 'F_b'), 'no second 保留 / 作废 question');
  assert.ok(!/正文可能自行编造[^。]*标签F_b/.test(doc.querySelector('.pi-body').textContent));
  await inst.destroy();
});

test('panel: a normal step is accepted, anchored on the floor it was registered on', async () => {
  const { host, inst } = await setup();
  await host.addMessage('一', true);
  await sync(host, inst, '开始。');
  setStatus(host, 'F_a', '已核实');
  await sync(host, inst, '甲查完了。');
  const acc = () => (inst.runtime.progress().clueAccept || []).map((e) => e.f);
  same(acc(), ['F_a']);
  assert.equal(statusOf(host, 'F_a'), '已核实');
  same(inst.runtime.clue.withdrawnList(), []);
  await inst.destroy();
});
