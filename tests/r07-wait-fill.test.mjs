// R07 / R1: if the previous round's table fill has not committed, the next round waits for it.
// v3 databases send queued/settled for the whole auto-fill pipeline (debounce, chat read, 2s floor delay, evaluation).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';

const VOLS = [{ id: 'v', key: '剧情_卷一', stages: [
  { id: 's1', key: '阶段一_x', data: { 主线节点: [{ id: 'nA', 名称: 'A', 场景: '场景A', 完成条件: { 事实: 'FA' } }] } },
  { id: 's2', key: '阶段二_y', data: { 主线节点: [{ id: 'nB', 名称: 'B', 场景: '场景B', 完成条件: { 事实: 'FB' } }] } },
] }];
const tables = (rows) => ({ sheet_f: { name: '事实表', content: [[null, '编号', '状态'], ...rows.map((r) => [null, ...r])] } });
const BIND = { facts: [{ 表: '事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }] };

async function setup(clue = {}, hostOpts = {}) {
  const host = createHost({ tables: tables([]), ...hostOpts });
  const inst = host.load();
  await inst.ready;
  const a = await inst.data.createProject('A');
  inst.data.updateProject(a.id, (x) => ({ ...x, outline: { volumes: VOLS }, clue: { mode: 'clue', bindings: BIND, ...clue } }));
  await inst.runtime.switchProject(a.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  return { host, inst, a };
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const readyOf = (r) => JSON.parse(JSON.stringify(r.ready));
// Clue text the plugin would inject right now (temporary world info).
async function injected(host) { return (await host.worldInfo()).map((e) => e.content).join('\n'); }

test('R07: round waits while fill is running, then uses the committed facts', async () => {
  const { host, inst } = await setup();
  host.db.queue('p1');
  host.db.fill('start');
  let finished = false;
  const round = host.db.runPlotRound('下一步').then((r) => { finished = true; return r; });
  await sleep(50);
  assert.equal(finished, false, 'round is waiting for the fill');
  host.db.setTables(tables([['FA', '已核实']]));
  host.db.commit(1);
  host.db.fill('end', { success: true });
  await sleep(30);
  assert.equal(finished, false, 'still waiting: pipeline not settled yet');
  host.db.settled('p1');
  assert.deepEqual(readyOf(await round), [{ ready: true, reason: '' }]);
  assert.match(await injected(host), /场景B/, 'uses the freshly committed fact');
  await inst.destroy();
});

test('R1: fill starts 2.6s after the reply (debounce + floor delay) → still waited for, not released early', async () => {
  const { host, inst } = await setup();
  await host.addMessage('u', true);
  host.db.queue('p1'); // database queues the auto-fill pipeline right when the reply arrives
  await host.addMessage('a', false);
  let finished = false;
  const round = host.db.runPlotRound('下一步').then((r) => { finished = true; return r; });
  await sleep(2600);
  assert.equal(finished, false, 'not released by a fixed grace window');
  host.db.fill('start');
  host.db.setTables(tables([['FA', '已核实']]));
  host.db.fill('end', { success: true });
  host.db.settled('p1');
  await round;
  assert.match(await injected(host), /场景B/);
  await inst.destroy();
});

test('R1: pipeline settles without filling (frequency skip) → released immediately', async () => {
  const { host, inst } = await setup();
  host.db.queue('p1');
  const t0 = Date.now();
  const round = host.db.runPlotRound('x');
  await sleep(40);
  host.db.settled('p1', 'skipped');
  assert.deepEqual(readyOf(await round), [{ ready: true, reason: '' }]);
  assert.ok(Date.now() - t0 < 500);
  await inst.destroy();
});

test('R1: superseded pipeline settles, the newer one is still awaited', async () => {
  const { host, inst } = await setup();
  host.db.queue('p1');
  let finished = false;
  const round = host.db.runPlotRound('x').then(() => { finished = true; });
  host.db.settled('p1', 'superseded');
  host.db.queue('p2');
  await sleep(40);
  assert.equal(finished, false);
  host.db.settled('p2');
  await round;
  await inst.destroy();
});

test('R1: no fill pending at all → no wait', async () => {
  const { host, inst } = await setup();
  await host.addMessage('u', true);
  await host.addMessage('a', false);
  const t0 = Date.now();
  await host.db.runPlotRound('x');
  assert.ok(Date.now() - t0 < 300, 'v3: no grace-window guessing');
  await inst.destroy();
});

test('R07 (old database without queue signals): falls back to the grace window', async () => {
  const { host, inst } = await setup({}, { linkVersion: 2 });
  await host.addMessage('u', true);
  await host.addMessage('a', false);
  const t0 = Date.now();
  await host.db.runPlotRound('x');
  const waited = Date.now() - t0;
  assert.ok(waited >= 2000 && waited < 4000, `waited ${waited}ms`);
  assert.equal(inst.runtime.clue.diagnose().queueSignals, false);
  await inst.destroy();
});

test('R07: fill failed → round proceeds, reports not ready, still on old facts', async () => {
  const { host, inst } = await setup();
  host.db.fill('start');
  const round = host.db.runPlotRound('x');
  await sleep(30);
  host.db.fill('end', { success: false, failedGroups: 1 });
  assert.deepEqual(readyOf(await round), [{ ready: false, reason: 'fill_failed' }]);
  assert.match(await injected(host), /场景A/);
  await inst.destroy();
});

test('R07: waitFill off → does not wait', async () => {
  const { host, inst } = await setup({ waitFill: false });
  host.db.fill('start');
  const t0 = Date.now();
  await host.db.runPlotRound('x');
  assert.ok(Date.now() - t0 < 500);
  await inst.destroy();
});

test('R07: chat switch while waiting releases the wait', async () => {
  const { host, inst } = await setup();
  host.db.fill('start');
  let finished = false;
  const round = host.db.runPlotRound('x').then(() => { finished = true; });
  await sleep(30);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await sleep(30);
  assert.equal(finished, true);
  await round;
  await inst.destroy();
});

test('R3: project switched while waiting → this round provides NO material (context and world info), not project B', async () => {
  const { host, inst } = await setup();
  const b = await inst.data.createProject('B');
  inst.data.updateProject(b.id, (x) => ({ ...x, outline: { volumes: [{ id: 'vb', key: '剧情_B', stages: [{ id: 'sb', key: '阶段一_b', data: { 主线节点: [{ id: 'nX', 名称: 'X', 入口: '项目B入口', 场景: '项目B场景' }] } }] }] }, clue: { mode: 'clue', bindings: BIND } }));
  host.db.queue('p1');
  await host.addMessage('A的输入', true);
  const round = host.db.runPlotRound('A的输入');
  await sleep(30);
  await inst.runtime.switchProject(b.id);
  host.db.settled('p1');
  const r = await round;
  assert.deepEqual(readyOf(r), [{ ready: false, reason: 'scope_changed' }]);
  assert.ok(!r.preContext.includes('项目B'), 'no project B context for project A request');
  // The same generation continues: GENERATION_STARTED → world info. Must not inject project B either.
  await host.eventSource.emit(host.eventTypes.GENERATION_STARTED, 'normal', {}, false);
  const text = await injected(host);
  assert.ok(!text.includes('项目B场景'), 'no project B scene in the stale request');
  await host.eventSource.emit(host.eventTypes.GENERATION_ENDED);
  // The next fresh round on B works normally.
  const next = await host.send('B的输入');
  assert.match(next.text, /项目B场景/);
  await inst.destroy();
});

test('R3: mode switched to outline while waiting → no clue material', async () => {
  const { host, inst, a } = await setup();
  host.db.queue('p1');
  const round = host.db.runPlotRound('x');
  await sleep(30);
  inst.data.updateProject(a.id, (x) => ({ ...x, clue: { ...x.clue, mode: 'outline' } }));
  inst.runtime.bumpEpoch();
  host.db.settled('p1');
  const r = await round;
  assert.equal(r.preContext, '');
  await inst.destroy();
});

test('generation without plot (regenerate / swipe / plot disabled) → own round, cannot wait, warns when fill pending', async () => {
  const { host, inst } = await setup();
  host.db.queue('p1');
  const lore = await host.generate('regenerate');
  assert.match(lore.map((e) => e.content).join('\n'), /场景A/, 'still injects (based on last committed tables)');
  assert.ok(inst.runtime.diagnose().logs.some((l) => /没有经过数据库剧情推进，无法等待/.test(l.text)));
  host.db.settled('p1');
  await inst.destroy();
});
