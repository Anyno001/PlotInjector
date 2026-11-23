// 线索建行与登记方案 二.4（2026-11-23）：手动纠错同步改表（SQLite）。
// 手动标记完成：只补表里还缺的线索（已核实 / 存疑 / 没拿到），后面的条件缺某人知情时顺带写知情行；写进认可名单，不会被越序检查撤回。
// 标为未完成（一次性）：清掉这一步的登记，之后按表格重新判断；完成条件不靠这些线索时如实说。确认线索可选已核实 / 存疑。原生存储只改插件判断。
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
// 阶段1：甲（n_a），旁边一件可选事件 n_x 的完成条件读的是 F_a；阶段2：乙要等彼得知道 F_a；阶段3：结局
function volumes() {
  return [{ id: 'vM1', key: '剧情_M1_街区', line: { 编号: 'M1', 类型: '主线' }, stages: [
    { id: 's1', key: '阶段1_甲', data: { 结束条件: { 事实: 'F_a' }, 主线节点: [node('n_a', 'F_a')], 支线事件: [node('n_x', 'F_x', { 必需: false, 完成条件: { 事实: 'F_a' } })] } },
    { id: 's2', key: '阶段2_乙', data: { 结束条件: { 事实: 'F_b' }, 主线节点: [node('n_b', 'F_b', { 开放条件: { 知情: 'F_a@彼得' } })] } },
    { id: 's3', key: '阶段3_结局', data: { 结束条件: { 事实: 'F_c' }, 主线节点: [node('n_c', 'F_c')] } },
  ] }];
}
function liveTables(t) {
  const out = JSON.parse(JSON.stringify(t));
  for (const [k, s] of Object.entries(out)) if (k.startsWith('sheet_')) s.content = s.content.map((row, i) => (i === 0 ? row : [i, ...row.slice(1)]));
  return out;
}
async function setup({ sqlite = true } = {}) {
  const t = liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: ['F_a', 'F_x', 'F_b'].map((code) => ({ code, label: `标签${code}` })), knowRows: [] }));
  const host = createHost({ tables: t });
  host.w.AutoCardUpdaterAPI.sqlite = sqlite;
  const inst = host.load();
  await inst.ready;
  const p = await inst.data.createProject('手动');
  const vols = volumes();
  const labels = Object.fromEntries(C.labelsToPrepare(vols, {}).map((x) => [x.code, { label: `标签${x.code}`, criterion: '看到时登记；没看到不算', sig: x.sig }]));
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML), labels } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  await host.addMessage('一', true);
  await sync(host, inst, '开始。');
  return { host, inst, pid: p.id, clue: inst.runtime.clue };
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
const setStatus = (host, code, v) => {
  const t = JSON.parse(JSON.stringify(host.w.AutoCardUpdaterAPI.exportTableAsJson()));
  const s = Object.values(t).find((x) => x && x.name === '关键事实表');
  s.content.find((r, i) => i > 0 && r[s.content[0].indexOf('编号')] === code)[s.content[0].indexOf('状态')] = v;
  host.db.setTables(t);
};
async function sync(host, inst, text) {
  await host.addMessage(text, false);
  await host.settle(); inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines(); await tick();
}
const accepted = (inst) => (inst.runtime.progress().clueAccept || []).map((e) => e.f).sort();
const nodeStatus = (clue, uid) => clue.compute().state.nodeStates.find((x) => x.node.uid === uid).status;

test('panel: 手动标记完成 lists the missing clue with 已核实 / 存疑 / 没拿到 and the 彼得 knowledge the next step needs; writes both into the tables', async () => {
  const { host, inst, pid, clue } = await setup();
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${pid}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  doc.querySelector('[data-act="clue-node-menu"][data-uid="n_a"]').click(); await tick();
  doc.querySelector('[data-dlg-value="done:fill"]').click(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  assert.match(dlg.textContent, /标记完成：n_a/);
  assert.match(dlg.textContent, /标签F_a/);
  assert.equal(dlg.querySelector('input[name="pi-fi-0"]:checked').value, '已核实', 'default 已核实 (not a testimony)');
  assert.match(dlg.textContent, /彼得已获知「标签F_a」（后面的条件要用）/);
  dlg.querySelector('[data-fi-know="0"]').click();
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '标记完成').click();
  for (let i = 0; i < 6; i++) await tick();
  assert.equal(statusOf(host, 'F_a'), '已核实');
  assert.equal(knowOf(host, 'F_a', '彼得'), '被告知/未核实', 'knowledge row added for the gate');
  same(accepted(inst), ['F_a']);
  assert.equal(nodeStatus(clue, 'n_a'), 'done');
  assert.notEqual(nodeStatus(clue, 'n_b'), 'locked', 'the next step opens');
  await inst.destroy();
});

test('runtime: marking a still-locked ending done (testimony → 存疑) adds the row, accepts it, and the guard does not withdraw it', async () => {
  const { host, inst, clue } = await setup();
  const r = await clue.markNodeDone('n_c', [{ f: 'F_c', status: '存疑' }], [], '作者顺序写错');
  assert.ok(r.done && r.table === 'ok');
  assert.equal(statusOf(host, 'F_c'), '存疑', 'row inserted (it had none yet) and kept as 存疑, not upgraded');
  await sync(host, inst, '继续。');
  assert.equal(statusOf(host, 'F_c'), '存疑', 'not withdrawn');
  same(inst.runtime.clue.withdrawnList(), []);
  assert.equal(nodeStatus(clue, 'n_c'), 'done');
  await inst.destroy();
});

test('runtime: 标为未完成 clears this step\'s registration once; playing it again later is accepted normally', async () => {
  const { host, inst, clue } = await setup();
  setStatus(host, 'F_a', '已核实');
  await sync(host, inst, '甲查完了。');
  same(accepted(inst), ['F_a']);
  const r = await clue.clearNodeDone('n_a');
  assert.ok(r.done && !r.stillDone);
  same(r.cleared, ['F_a']);
  assert.equal(statusOf(host, 'F_a'), '未获得');
  same(accepted(inst), []);
  assert.notEqual(nodeStatus(clue, 'n_a'), 'done');
  setStatus(host, 'F_a', '已核实');
  await sync(host, inst, '重新查到了。');
  same(accepted(inst), ['F_a'], 'no permanent block: registered again normally');
  await inst.destroy();
});

test('runtime: a node whose completion does not depend on its own clue stays done after clearing — the caller is told why', async () => {
  const { host, inst, clue } = await setup();
  setStatus(host, 'F_a', '已核实'); setStatus(host, 'F_x', '已核实');
  await sync(host, inst, '都查完了。');
  const r = await clue.clearNodeDone('n_x');
  assert.ok(r.done && r.stillDone, 'n_x completes on F_a, not on its own F_x');
  assert.equal(statusOf(host, 'F_x'), '未获得');
  assert.equal(statusOf(host, 'F_a'), '已核实', 'F_a is not this node\'s clue: untouched');
  await inst.destroy();
});

test('runtime: confirming a clue by hand can be 存疑; native storage only changes the plugin\'s judgement', async () => {
  const a = await setup();
  const r = await a.clue.confirmFact('F_b', '存疑');
  assert.ok(r.done && r.table === 'ok');
  assert.equal(statusOf(a.host, 'F_b'), '存疑');
  assert.ok(accepted(a.inst).includes('F_b'));
  await a.inst.destroy();
  const b = await setup({ sqlite: false });
  // nothing to fill in (n_x completes on F_a, which is not its clue): only a manual completion makes it done
  await b.clue.markNodeDone('n_x', [], [], '');
  assert.equal(nodeStatus(b.clue, 'n_x'), 'done');
  const r2 = await b.clue.markNodeDone('n_a', [{ f: 'F_a', status: '已核实' }], [], '');
  assert.equal(r2.table, 'none');
  assert.equal(statusOf(b.host, 'F_a'), '未获得', 'table untouched');
  assert.equal(nodeStatus(b.clue, 'n_a'), 'done');
  await b.inst.destroy();
});

// 执行页界面审阅 R1（2026-11-23）：SQLite 手动补记 / 手动确认 / 保留提前登记之后，记一条「保留线索」：
// 不再问「正文可能自行编造」，原因进操作记录，存疑不变成已核实；标为未完成会解除，之后照表格判断
test('runtime: a hand-written registration is not asked about again, keeps the reason, stays 存疑; clearing lifts it', async () => {
  const { host, inst, clue } = await setup();
  const unoffered = () => clue.compute().unoffered.map((x) => x.id);
  const over = (f) => (clue.compute().prog.factOverrides || {})[f];
  let r = await clue.markNodeDone('n_a', [{ f: 'F_a', status: '已核实' }], [], '玩家确认：这一幕已演完');
  assert.ok(r.done && r.table === 'ok');
  assert.equal(statusOf(host, 'F_a'), '已核实');
  assert.ok(!unoffered().includes('F_a'), 'not asked whether the story made it up');
  assert.equal(over('F_a').status, 'kept', 'judged by the table, not forced');
  assert.ok(((inst.runtime.progress().clue || {}).ops || []).some((op) => op.target === 'F_a' && /玩家确认：这一幕已演完/.test(op.note || '')), 'the reason is in the log');
  r = await clue.confirmFact('F_b', '存疑');
  assert.ok(r.done && r.table === 'ok');
  assert.ok(!unoffered().includes('F_b'));
  assert.equal(statusOf(host, 'F_b'), '存疑');
  assert.notEqual(clue.compute().snap.facts.get('F_b').status, 'confirmed', '存疑 is not upgraded');
  // a clue the story registered on its own is still asked about
  setStatus(host, 'F_x', '已核实');
  await sync(host, inst, '顺手也查到了。');
  assert.ok(unoffered().includes('F_x'), 'unconfirmed registrations keep the 保留 / 作废 question');
  r = await clue.clearNodeDone('n_a');
  assert.ok(r.done);
  assert.equal(over('F_a'), undefined, '标为未完成 lifts the keep');
  assert.equal(statusOf(host, 'F_a'), '未获得');
  assert.notEqual(nodeStatus(clue, 'n_a'), 'done', 'judged by the table again');
  await inst.destroy();
});

// 执行页界面审阅 R2：「需要处理」里的「打开表格绑定」连同绑定编辑区一起打开
test('panel: 打开表格绑定 opens the run settings and the binding editor itself', async () => {
  const { host, inst, pid } = await setup();
  inst.data.updateProject(pid, (x) => {
    const b = JSON.parse(JSON.stringify(x.clue.bindings));
    b.facts[0].状态列 = '状态X';
    return { ...x, clue: { ...x.clue, bindings: b } };
  });
  inst.runtime.clue.invalidate();
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${pid}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  const btn = doc.querySelector('[data-act="run-set-open"]');
  assert.ok(btn, doc.querySelector('.pi-body').textContent.slice(0, 300));
  assert.equal(doc.querySelector('[data-clue-bindings]'), null, 'editor closed before');
  btn.click(); await tick();
  assert.equal(doc.querySelector('[data-act="run-set-toggle"]').getAttribute('aria-expanded'), 'true');
  assert.ok(doc.querySelector('[data-clue-bindings]'), 'binding editor open');
  await inst.destroy();
});
