// End-to-end on the BUILT script in a simulated host:
// one fact → one node → single injection → table commit → next round updated.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';

const SECRET = 'XYZZY_未来答案';
const OUTLINE_VOLUMES = [{
  id: 'v1', key: '剧情_卷一_测试', stages: [
    { id: 's1', key: '阶段一_开端', data: { 主线节点: [
      { id: 'nA', 名称: '查记录A', 入口: '去档案室查记录', 场景: '档案室里堆满旧档案', 发现: [{ 事实: 'FA', 内容: '记录显示设备来自仓库' }], 完成条件: { 事实: 'FA' } },
    ] } },
    { id: 's2', key: `阶段二_${SECRET}`, data: { 主线节点: [
      { id: 'nC', 名称: `对质${SECRET}`, 入口: '去仓库', 场景: `仓库里藏着${SECRET}`, 完成条件: { 事实: 'FC' } },
    ] } },
  ],
}];
const BINDINGS = { facts: [{ 表: '事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实', 内容列: '内容' }] };
const tablesWith = (rows) => ({ sheet_f: { name: '事实表', content: [[null, '编号', '状态', '内容'], ...rows.map((r) => [null, ...r])] } });

async function setup({ inject = 'worldbook', link = !process.env.PI_OFFICIAL, mode = 'clue', outline = OUTLINE_VOLUMES } = {}) {
  const host = createHost({ tables: tablesWith([]), link });
  const inst = host.load();
  await inst.ready;
  const project = await inst.data.createProject('测试项目');
  inst.data.updateProject(project.id, (p) => ({ ...p, setting: { ...p.setting, text: `公开设定<仅作者>${SECRET}</仅作者>` }, outline: { volumes: outline }, clue: { mode, inject, bindings: BINDINGS } }));
  await inst.runtime.switchProject(project.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED, 'chat-1');
  await host.settle();
  return { host, inst, project };
}
const allText = (x) => JSON.stringify(x);

test('minimal loop: fact → node → single temporary injection → commit → next round; nothing stored in chat', async () => {
  const { host, inst } = await setup();
  const LINK = !process.env.PI_OFFICIAL;
  assert.deepEqual(host.db.providers.size, LINK ? 1 : 0, LINK ? 'provider registered' : 'official database: no provider');

  // Round 1: node A available and auto-focused; clue material only via temporary world info.
  const r1 = await host.send('我想调查一下', { reply: '你在档案室翻到一份记录，显示设备来自仓库。' });
  assert.match(r1.text, /档案室里堆满旧档案/);
  assert.match(r1.text, /尚未发生/);
  if (LINK) {
    assert.ok(!r1.round.finalMessage.includes('档案室里堆满'), 'link does not append clue material to finalMessage (R4)');
    assert.match(r1.round.preContext, /去档案室查记录/);
    assert.ok(!r1.round.preContext.includes('设备来自仓库'), 'pre-task context has no discovery content');
  }
  for (const text of [allText(r1.lore), r1.round ? r1.round.finalMessage : '', r1.round ? r1.round.preContext : '']) assert.ok(!text.includes(SECRET), 'locked material leaked');
  assert.ok(r1.lore.some((e) => e.content.includes('公开设定')), 'setting still injected');
  assert.ok(!allText(host.state.chat).includes('档案室里堆满'), 'clue material is never written into chat history (R4)');

  // Fill runs and commits FA.
  host.db.fill('start');
  host.db.setTables(tablesWith([['FA', '已核实', '记录显示设备来自仓库']]));
  host.db.commit(1);
  host.db.fill('end', { success: true });

  // Round 2: A done → stage 1 ends → stage 2 opens → nC focused.
  const c = inst.runtime.clue.compute();
  const status = Object.fromEntries(c.state.nodeStates.map((s) => [s.node.uid, s.status]));
  assert.equal(status.nA, 'done');
  assert.equal(status.nC, 'active');
  const r2 = await host.send('去仓库');
  assert.match(r2.text, /仓库里藏着/, 'next stage scene now provided');
  assert.ok(!r2.text.includes('档案室里堆满'), 'previous scene material is gone from this request');

  // No model calls were made by the plugin during the loop.
  assert.equal(host.llmCalls.length, 0, 'no extra model calls');
  await inst.destroy();
  assert.equal(host.db.providers.size, 0, 'provider unregistered on destroy');
  assert.equal(host.db.tableCallbackCount(), 0, 'table callback unregistered on destroy');
});

test('R4: legacy inject=link projects also inject via temporary world info only, exactly once', async () => {
  const { host, inst } = await setup({ inject: 'link' });
  const r = await host.send('开始');
  const hits = r.lore.filter((e) => e.content.includes('档案室里堆满旧档案')).length;
  assert.equal(hits, 1);
  assert.ok(!r.round.finalMessage.includes('档案室里堆满旧档案'));
  await inst.destroy();
});

test('no link API in database: clue still injected via world info; no whole-stage fallback', async () => {
  const { host, inst } = await setup({ link: false });
  const r = await host.send('开始', { plot: false });
  assert.match(r.text, /档案室里堆满旧档案/);
  assert.ok(!r.lore.some((e) => /阶段一_开端|主线节点/.test(e.content)), 'no whole-stage fallback');
  assert.ok(inst.runtime.clue.diagnose().linkApi === false);
  await inst.destroy();
});

test('outline mode unchanged: whole-stage detail injected, clue fields stripped, author blocks stripped', async () => {
  const { host, inst } = await setup({ mode: 'outline' });
  await host.addMessage('开始', true);
  const lore = await host.generate();
  const detail = lore.find((e) => e.comment.includes('阶段一') || e.content.includes('阶段一_开端'));
  assert.ok(detail, 'outline mode injects current stage detail');
  assert.ok(!detail.content.includes('完成条件') && !detail.content.includes('场景:'), 'clue fields stripped in outline mode');
  assert.ok(!allText(lore).includes(SECRET), 'author block in setting stripped; next stage not injected');
  const round = await host.db.runPlotRound('开始');
  assert.ok(!round.finalMessage.includes('档案室'), 'outline mode does not use link');
  assert.equal(round.preContext, '', 'outline mode provides no pre-task context');
  await inst.destroy();
});

test('clue mode skips periodic AI check; outline mode still triggers it', async () => {
  let { host, inst } = await setup();
  for (let i = 0; i < 5; i++) { await host.addMessage('u', true); await host.addMessage('a', false); }
  await host.settle();
  assert.equal(host.llmCalls.length, 0, 'clue mode: no periodic check');
  await inst.destroy();
  ({ host, inst } = await setup({ mode: 'outline' }));
  for (let i = 0; i < 4; i++) { await host.addMessage('u', true); await host.addMessage('a', false); }
  await host.settle(); await host.settle();
  assert.ok(host.llmCalls.length >= 1, 'outline mode: periodic check still runs (original behavior)');
  await inst.destroy();
});

test('manual ops anchor to floor: deleting the floor reverts them; swipe back restores', async () => {
  const { host, inst } = await setup();
  await host.addMessage('u', true);
  await host.addMessage('a1', false);
  inst.runtime.clue.act({ kind: 'done', target: 'nA', value: 'force', note: '测试' });
  let st = inst.runtime.clue.compute().state.nodeStates.find((s) => s.node.uid === 'nA');
  assert.equal(st.status, 'done');
  // swipe floor 1 to a different variant
  const msg = host.state.chat[1];
  msg.swipe_id = 1; msg.mes = 'a1-alt';
  await host.eventSource.emit(host.eventTypes.MESSAGE_SWIPED, 1);
  st = inst.runtime.clue.compute().state.nodeStates.find((s) => s.node.uid === 'nA');
  assert.notEqual(st.status, 'done', 'manual op from another swipe does not apply');
  msg.swipe_id = 0;
  await host.eventSource.emit(host.eventTypes.MESSAGE_SWIPED, 1);
  st = inst.runtime.clue.compute().state.nodeStates.find((s) => s.node.uid === 'nA');
  assert.equal(st.status, 'done', 'swiping back restores it');
  host.state.chat.pop();
  await host.eventSource.emit(host.eventTypes.MESSAGE_DELETED, 1);
  st = inst.runtime.clue.compute().state.nodeStates.find((s) => s.node.uid === 'nA');
  assert.notEqual(st.status, 'done', 'deleted floor → op no longer applies');
  await inst.destroy();
});

test('focus: manual focus on a locked node is rejected', async () => {
  const { inst } = await setup();
  assert.throws(() => inst.runtime.clue.setFocus('nC'), /不可进行/);
  await inst.destroy();
});

test('scope: provider refuses context for a different chat', { skip: process.env.PI_OFFICIAL ? 'experimental plot-link only' : false }, async () => {
  const { host, inst } = await setup();
  const p = host.db.providers.get('plot-injector');
  assert.equal(p.provideContext({ chatId: 'other-chat' }), '');
  assert.equal(p.finalize, undefined, 'no finalize hook any more (R4)');
  assert.equal(p.fillCandidates({ chatId: 'other-chat' }, { messageIndices: [1] }), null);
  await inst.destroy();
});

test('reload: re-loading the script does not stack listeners or providers', async () => {
  const { host } = await setup();
  const before = host.eventSource.count(host.eventTypes.MESSAGE_RECEIVED);
  const inst2 = host.load();
  await inst2.ready;
  await host.settle();
  assert.equal(host.eventSource.count(host.eventTypes.MESSAGE_RECEIVED), before);
  assert.ok(host.db.providers.size <= 1);
  await inst2.destroy();
});
