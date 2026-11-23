// v0.3.14 发布前审阅（GPT，2026-11-23）R1–R8 的回归测试。
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
const FB = [{ 表: '关键事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }];
const KB = [{ 表: '知情表', 事实列: '事实', 角色列: '角色', 方式列: '获知方式', 可信度列: '可信度', 已核实值: '已核实', 未知值: ['未知'] }];

// ---------- 核心：R4 R5 R7 ----------
const line = (stages) => [{ id: 'vM1', key: '剧情_M1_街区', line: { 编号: 'M1', 类型: '主线' }, stages }];
const factTable = (rows) => ({ key: 'sheet_f', name: '关键事实表', content: [[null, '编号', '状态'], ...rows.map(([c, s], i) => [i + 1, c, s])] });
const knowTable = (rows) => ({ key: 'sheet_k', name: '知情表', content: [[null, '键', '事实', '角色', '获知方式', '可信度'], ...rows.map((r, i) => [i + 1, `${r[0]}@${r[1]}`, ...r])] });
const snapOf = (tables, confirmed = [], knowledge = []) => ({ tables, facts: new Map(confirmed.map((c) => [c, { id: c, status: 'confirmed', raw: '已核实' }])), knowledge, problems: [] });

test('R4: the lookahead sees the same assumed state in a direct table / count condition as in a fact condition', () => {
  for (const open of [{ 事实: 'F_a' }, { 表: '关键事实表/F_a/状态 == 已核实' }, { 计数: { 表: '关键事实表', 条件: '状态 == 已核实', 至少: 1 } }]) {
    const vols = line([{ id: 's1', key: '阶段1_甲', data: { 主线节点: [node('n_a', 'F_a'), node('n_b', 'F_b', { 开放条件: open })] } }]);
    const compiled = C.compileClue(vols), prog = C.emptyClueProgress(), cfg = { mode: 'clue', bindings: { facts: FB, knowledge: KB } };
    const snap = snapOf({ sheet_f: factTable([['F_a', '未获得'], ['F_b', '未获得']]) });
    const state = C.computeClueState(compiled, snap, prog, cfg);
    const fr = C.nodeFrontier(compiled, state, snap, prog, cfg);
    same([...fr].map((n) => n.uid).sort(), ['n_a', 'n_b'], JSON.stringify(open));
  }
});

test('R4: a held registration also loses its credibility cell, so a direct credibility condition cannot unlock the next step', () => {
  const vols = line([
    { id: 's1', key: '阶段1_甲', data: { 主线节点: [node('n_a', 'F_a'), node('n_b', 'F_b', { 开放条件: { 事实: 'F_a' } }), node('n_c', 'F_c', { 开放条件: { 表: '知情表/F_b@彼得/可信度 == 已核实' } })] } },
  ]);
  const tables = { sheet_f: factTable([['F_a', '未获得'], ['F_b', '已核实'], ['F_c', '已核实']]), sheet_k: knowTable([['F_b', '彼得', '未知', '已核实']]) };
  const r = C.admitRegistrations(C.compileClue(vols), snapOf(tables, ['F_b', 'F_c']), C.emptyClueProgress(), { mode: 'clue', bindings: { facts: FB, knowledge: KB } }, new Set());
  same([...r.held].sort(), ['F_b', 'F_c']);
  assert.equal(tables.sheet_k.content[1][5], '已核实', 'real table untouched');
});

test('R7: a node marked done through another condition is not proof that its own open condition holds', () => {
  const vols = line([{ id: 's1', key: '阶段1_甲', data: {
    主线节点: [node('n_a', 'F_a')],
    支线事件: [node('n_b', 'F_c', { 必需: false, 开放条件: { 事实: 'F_b' }, 完成条件: { 事实: 'F_a' } })],
  } }]);
  const r = C.admitRegistrations(C.compileClue(vols), snapOf({}, ['F_a', 'F_c']), C.emptyClueProgress(), { mode: 'clue', bindings: { facts: FB, knowledge: [] } }, new Set(['F_a']));
  same([...r.held], ['F_c']);
});

test('R5: 前提 carries only the earlier step\'s public entrance, never the author\'s node title; no entrance → nothing', () => {
  const vols = line([
    { id: 's1', key: '阶段1_甲', data: { 结束条件: { 事实: 'F_a' }, 主线节点: [
      { id: 'n_a', 名称: '馆长就是纵火真凶', 入口: '查阅封存档案', 发现: [{ 事实: 'F_a', 内容: '馆长纵火' }] },
      { id: 'n_q', 名称: '无入口的步骤', 发现: [{ 事实: 'F_q', 内容: '秘密' }] },
    ] } },
    { id: 's2', key: '阶段2_乙', data: { 主线节点: [
      { id: 'n_b', 名称: '旧宅', 入口: '去旧宅', 发现: [{ 事实: 'F_b', 内容: '留言' }] },
      { id: 'n_r', 名称: '后续', 入口: '再看看', 开放条件: { 事实: 'F_q' }, 发现: [{ 事实: 'F_r', 内容: 'x' }] },
    ] } },
  ]);
  const ctx = new Map(C.factLabelContext(vols).map((x) => [x.code, x]));
  same(ctx.get('F_b').before, ['查阅封存档案']);
  same(ctx.get('F_r').before, [], 'the only earlier step has no entrance: nothing, not its title');
  assert.ok(!/馆长就是纵火真凶/.test(C.factLabelMessages([ctx.get('F_b')])[1].content));
});

// ---------- 宿主：R1 R2 R3 R6 R8 ----------
function liveTables(t) {
  const out = JSON.parse(JSON.stringify(t));
  for (const [k, s] of Object.entries(out)) if (k.startsWith('sheet_')) s.content = s.content.map((row, i) => (i === 0 ? row : [i, ...row.slice(1)]));
  return out;
}
const chain = () => line([
  { id: 's1', key: '阶段1_甲', data: { 结束条件: { 事实: 'F_a' }, 主线节点: [node('n_a', 'F_a')] } },
  { id: 's2', key: '阶段2_乙', data: { 结束条件: { 事实: 'F_b' }, 主线节点: [node('n_b', 'F_b', { 开放条件: { 核实: 'F_a@彼得' } })] } },
  { id: 's3', key: '阶段3_结局', data: { 结束条件: { 事实: 'F_c' }, 主线节点: [node('n_c', 'F_c')] } },
]);
async function setup({ factRows = [], knowRows = [], trpg = false } = {}) {
  const host = createHost({ tables: liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: factRows.map((code) => ({ code, label: `标签${code}` })), knowRows })) });
  const inst = host.load();
  await inst.ready;
  const p = await inst.data.createProject('审阅');
  const vols = chain();
  const labels = Object.fromEntries(C.labelsToPrepare(vols, {}).map((x) => [x.code, { label: `标签${x.code}`, criterion: '看到时登记；没看到不算', sig: x.sig }]));
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML), labels }, ...(trpg ? { trpg: { on: true, rule: 'coc7' } } : {}) }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  await host.addMessage('一', true);
  await sync(host, inst, '开始。');
  return { host, inst, pid: p.id, clue: inst.runtime.clue, api: host.w.AutoCardUpdaterAPI };
}
async function sync(host, inst, text) {
  await host.addMessage(text, false);
  await host.settle(); inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines(); await tick();
}
const sheet = (host, name) => Object.values(host.w.AutoCardUpdaterAPI.exportTableAsJson()).find((x) => x && x.name === name);
const statusOf = (host, code) => {
  const s = sheet(host, '关键事实表'), row = s.content.find((r, i) => i > 0 && r[s.content[0].indexOf('编号')] === code);
  return row ? row[s.content[0].indexOf('状态')] : null;
};
const knowOf = (host, fact, actor) => {
  const s = sheet(host, '知情表'), h = s.content[0], row = s.content.find((r, i) => i > 0 && r[h.indexOf('事实')] === fact && r[h.indexOf('角色')] === actor);
  return row ? `${row[h.indexOf('获知方式')]}/${row[h.indexOf('可信度')]}` : null;
};
const setCells = (host, edits) => {
  const t = JSON.parse(JSON.stringify(host.w.AutoCardUpdaterAPI.exportTableAsJson()));
  for (const [name, match, col, v] of edits) {
    const s = Object.values(t).find((x) => x && x.name === name), h = s.content[0];
    s.content.find((r, i) => i > 0 && match(r, h))[h.indexOf(col)] = v;
  }
  host.db.setTables(t);
};
const byCode = (code) => (r, h) => r[h.indexOf('编号')] === code;
const byKnow = (f, a) => (r, h) => r[h.indexOf('事实')] === f && r[h.indexOf('角色')] === a;
const nodeStatus = (clue, uid) => clue.compute().state.nodeStates.find((x) => x.node.uid === uid).status;

test('R1: the run page does not report later steps as missing rows; it does once a row that should be there is missing', async () => {
  const { host, inst, pid } = await setup();
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${pid}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  assert.ok(!/在表格里还没有行/.test(doc.querySelector('.pi-body').textContent), 'C is a later step, not missing');
  await inst.destroy();
});

// 跑团项目走 src/trpg 自己的运行时（v0.3.16 起），线索模式的提前登记撤回不进跑团
test('R2: a 跑团 project keeps its old behaviour — an out-of-order registration is not withdrawn', async () => {
  const { host, inst } = await setup({ factRows: ['F_a', 'F_b', 'F_c'], trpg: true });
  setCells(host, [['关键事实表', byCode('F_c'), '状态', '已核实']]);
  await sync(host, inst, '结局先登记了。');
  assert.equal(statusOf(host, 'F_c'), '已核实', 'the table is not written back');
  await inst.destroy();
});

test('R3: 作废 then 手动标记完成 with the clue → the void is lifted and the next step opens on the table', async () => {
  const { host, inst, clue } = await setup({ factRows: ['F_a', 'F_b'] });
  setCells(host, [['关键事实表', byCode('F_a'), '状态', '已核实']]);
  await sync(host, inst, '甲。');
  await clue.voidFact('F_a');
  const r = await clue.markNodeDone('n_a', [{ f: 'F_a', status: '已核实' }], [{ fact: 'F_a', actor: '彼得', verified: true }], '');
  assert.ok(r.done);
  // 作废解除：换成「保留线索」，照表格判断（执行页界面审阅 R1）
  assert.equal(((clue.compute().prog.factOverrides || {}).F_a || {}).status, 'kept', 'void lifted (now kept, judged by the table)');
  assert.notEqual(nodeStatus(clue, 'n_b'), 'locked', 'stage 2 entered and 彼得 verified → B opens');
  await inst.destroy();
});

test('R3: a hand-confirmed clue cleared by 标为未完成 really becomes not done', async () => {
  const { host, inst, clue } = await setup({ factRows: ['F_a', 'F_b'] });
  clue.act({ kind: 'fact', target: 'F_a', value: 'confirmed', note: '以前的人工确认' });
  setCells(host, [['关键事实表', byCode('F_a'), '状态', '已核实']]);
  await sync(host, inst, '甲。');
  const r = await clue.clearNodeDone('n_a');
  assert.ok(r.done && !r.stillDone, JSON.stringify(r));
  assert.notEqual(nodeStatus(clue, 'n_a'), 'done');
  await inst.destroy();
});

test('R6: withdrawal half-failed (knowledge write failed) → 保留 still restores from the backup and verifies; a failing restore keeps the record', async () => {
  const { host, inst, clue, api } = await setup({ factRows: ['F_a', 'F_b'], knowRows: [{ fact: 'F_b', actor: '彼得' }] });
  setCells(host, [['关键事实表', byCode('F_b'), '状态', '存疑'], ['知情表', byKnow('F_b', '彼得'), '获知方式', '被告知']]);
  const real = api.executeSqlMutation;
  let failKnow = 1;
  api.executeSqlMutation = async (q, p) => ((q.sql || q).includes('知情表') && failKnow-- > 0 ? { changes: 0, errors: ['busy'] } : real(q, p));
  await sync(host, inst, '乙先登记了。');
  const w = clue.withdrawnList();
  same([w.length, w[0] && w[0].table], [1, 'partial']);
  api.executeSqlMutation = async () => ({ changes: 0, errors: ['down'] });
  let r = await clue.settleWithdrawn('F_b', true);
  assert.ok(!r.done, 'restore failed: not kept');
  assert.equal(clue.withdrawnList().length, 1, 'record stays');
  api.executeSqlMutation = real;
  r = await clue.settleWithdrawn('F_b', true);
  assert.ok(r.done, JSON.stringify(r));
  assert.equal(statusOf(host, 'F_b'), '存疑', 'restored as it was');
  assert.equal(knowOf(host, 'F_b', '彼得').split('/')[0], '被告知');
  same(clue.withdrawnList(), []);
  await inst.destroy();
});

test('R8: verifying a character keeps how they learned it — 被告知 stays 被告知, only credibility goes up', async () => {
  const { host, inst, clue } = await setup({ factRows: ['F_a', 'F_b'], knowRows: [{ fact: 'F_a', actor: '彼得' }] });
  setCells(host, [['知情表', byKnow('F_a', '彼得'), '获知方式', '被告知'], ['知情表', byKnow('F_a', '彼得'), '可信度', '未核实']]);
  await sync(host, inst, '彼得听说了。');
  await clue.markNodeDone('n_a', [{ f: 'F_a', status: '已核实' }], [{ fact: 'F_a', actor: '彼得', verified: true }], '');
  assert.equal(knowOf(host, 'F_a', '彼得'), '被告知/已核实');
  await inst.destroy();
});

// ---------- 清理与界面审阅 B1 B2 ----------
const atom = (clue, fact, verified = false) => {
  const c = clue.compute();
  return C.evalAtom({ kind: 'fact', fact, verified }, { facts: c.snap.cond.facts, factOverrides: c.prog.factOverrides, knowledge: [] }).v;
};

test('B1: 保留 on a 存疑 clue the story wrote by itself only accepts it — 事实 holds, 核实 does not until the table really verifies it', async () => {
  const { host, inst, pid, clue } = await setup({ factRows: ['F_a', 'F_b'] });
  setCells(host, [['关键事实表', byCode('F_a'), '状态', '存疑']]);
  await sync(host, inst, '有人说起了甲。');
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${pid}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  assert.match(doc.querySelector('.pi-body').textContent, /正文可能自行编造/);
  doc.querySelector('[data-act="clue-fact-keep"][data-id="F_a"]').click(); await tick();
  assert.ok(!/正文可能自行编造/.test(doc.querySelector('.pi-body').textContent), 'warning gone');
  assert.equal(atom(clue, 'F_a'), 'true', '事实 holds (it was said)');
  assert.equal(atom(clue, 'F_a', true), 'false', '核实 does not');
  assert.equal(statusOf(host, 'F_a'), '存疑', 'table untouched');
  setCells(host, [['关键事实表', byCode('F_a'), '状态', '已核实']]);
  await sync(host, inst, '后来证实了。');
  assert.equal(atom(clue, 'F_a', true), 'true', 'verified once the table says so');
  await inst.destroy();
});

test('B2: native storage honours 存疑 in 手动确认 and 手动标记完成 — 事实 holds, 核实 does not; 改回按表格判断 lifts it', async () => {
  const { host, inst, clue, api } = await setup({ factRows: ['F_a', 'F_b'] });
  api.sqlite = false;
  let r = await clue.confirmFact('F_a', '存疑');
  assert.equal(r.table, 'none');
  same([atom(clue, 'F_a'), atom(clue, 'F_a', true)], ['true', 'false']);
  clue.act({ kind: 'fact', target: 'F_a', value: '', note: '改回按表格判断' });
  assert.equal(atom(clue, 'F_a'), 'false', 'back to the table (row says 未获得)');
  r = await clue.markNodeDone('n_a', [{ f: 'F_a', status: '存疑' }], [], '');
  same([atom(clue, 'F_a'), atom(clue, 'F_a', true)], ['true', 'false']);
  assert.equal(statusOf(host, 'F_a'), '未获得', 'native: table untouched');
  await inst.destroy();
});
