// 本轮票据在官方数据库上的表现（删实验联动接口第 2 步，GPT 实测返修审阅第五节）：
// 原来 r07-wait-fill / review-regressions P1-3a 借实验 provider 的 awaitReady 测「等待中切项目」；官方路径没有等待，
// 本轮票据由 GENERATION_STARTED 建立。这里保住同样的保护：生成开始后切项目 / 模式，这次请求不带任何线索材料（旧项目、新项目都不带），
// 下一轮正常；重新生成 / 换回复版本照常按已提交的表格注入，并正常结束本轮。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';

const vols = (tag) => [{ id: `v${tag}`, key: `剧情_${tag}`, stages: [
  { id: `s${tag}1`, key: '阶段一_x', data: { 主线节点: [{ id: `n${tag}`, 名称: tag, 入口: `入口${tag}`, 场景: `场景${tag}`, 发现: [{ 事实: `F${tag}`, 内容: `发现${tag}` }], 完成条件: { 事实: `F${tag}` } }] } },
] }];
const tables = () => ({ sheet_f: { name: '事实表', content: [[null, '编号', '状态']] } });
const BIND = { facts: [{ 表: '事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }] };

async function setup() {
  const host = createHost({ tables: tables() });
  const inst = host.load();
  await inst.ready;
  const a = await inst.data.createProject('A'), b = await inst.data.createProject('B');
  inst.data.updateProject(a.id, (x) => ({ ...x, outline: { volumes: vols('A') }, clue: { mode: 'clue', bindings: BIND } }));
  inst.data.updateProject(b.id, (x) => ({ ...x, outline: { volumes: vols('B') }, clue: { mode: 'clue', bindings: BIND } }));
  await inst.runtime.switchProject(a.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  return { host, inst, a, b };
}
const text = (lore) => lore.map((e) => e.content).join('\n');

test('official round: project switched after GENERATION_STARTED → this request carries no clue material (neither A nor B); next round on B works', async () => {
  const { host, inst, b } = await setup();
  await host.addMessage('A的输入', true);
  await host.eventSource.emit(host.eventTypes.GENERATION_STARTED, 'normal', {}, false);
  await inst.runtime.switchProject(b.id);
  const stale = text(await host.worldInfo());
  assert.ok(!stale.includes('场景A') && !stale.includes('场景B'), `stale round injects nothing: ${stale}`);
  await host.addMessage('回复', false);
  await host.eventSource.emit(host.eventTypes.GENERATION_ENDED);
  assert.equal((inst.runtime.progress().clueCandidates || []).length, 0, 'no candidates bound from the stale round');
  const next = await host.send('B的输入');
  assert.match(next.text, /场景B/);
  await inst.destroy();
});

test('official round: mode switched to outline after GENERATION_STARTED → no clue material', async () => {
  const { host, inst, a } = await setup();
  await host.eventSource.emit(host.eventTypes.GENERATION_STARTED, 'normal', {}, false);
  inst.data.updateProject(a.id, (x) => ({ ...x, clue: { ...x.clue, mode: 'outline' } }));
  inst.runtime.bumpEpoch();
  assert.ok(!text(await host.worldInfo()).includes('场景A'));
  await host.eventSource.emit(host.eventTypes.GENERATION_ENDED);
  await inst.destroy();
});

test('official round: regenerate / swipe build their own round on the committed tables and end it; a later switch does not poison the next round', async () => {
  const { host, inst, b } = await setup();
  assert.match(text(await host.generate('regenerate')), /场景A/, 'regenerate still injects');
  assert.match(text(await host.generate('swipe')), /场景A/, 'swipe still injects');
  // the round ended with the generation: switching now and generating again uses B, not a stale A ticket
  await inst.runtime.switchProject(b.id);
  assert.match(text(await host.generate('normal')), /场景B/);
  await inst.destroy();
});

test('no experimental interface: even a database that offers the old plot-link registry gets no provider; reload / destroy do not stack listeners', async () => {
  const host = createHost({ tables: tables() });
  // a database that still offers the old registry (e.g. the early modified shujuku): the plugin must not use it
  const registered = [];
  host.w.AutoCardUpdaterAPI.plotLinkVersion = 4;
  host.w.AutoCardUpdaterAPI.registerPlotLinkProvider = (p) => { registered.push(p); return () => {}; };
  const inst = host.load();
  await inst.ready;
  const a = await inst.data.createProject('A');
  inst.data.updateProject(a.id, (x) => ({ ...x, outline: { volumes: vols('A') }, clue: { mode: 'clue', bindings: BIND } }));
  await inst.runtime.switchProject(a.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  assert.match((await host.send('x')).text, /场景A/);
  assert.equal(registered.length, 0, 'nothing registered on the plot-link registry');
  assert.equal(host.db.tableCallbackCount(), 1);
  const gen = host.eventSource.count(host.eventTypes.GENERATION_STARTED), wi = host.eventSource.count(host.eventTypes.WORLDINFO_ENTRIES_LOADED);
  const inst2 = host.load();
  await inst2.ready;
  await host.send('y');
  assert.equal(host.eventSource.count(host.eventTypes.GENERATION_STARTED), gen, 'reload does not stack generation listeners');
  assert.equal(host.eventSource.count(host.eventTypes.WORLDINFO_ENTRIES_LOADED), wi);
  assert.ok(host.db.tableCallbackCount() <= 1, 'reload does not stack table callbacks');
  await inst2.destroy();
  assert.equal(host.db.tableCallbackCount(), 0, 'destroy unregisters the table callback');
  assert.equal(host.eventSource.count(host.eventTypes.GENERATION_STARTED), 0);
});
