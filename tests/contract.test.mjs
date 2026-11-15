// Contract: the BUILT plugin against shujuku's REAL plot-link registry (bundled from TS source).
// Uses the same simulated host, but swaps the fake provider registry for the real one.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';
import * as real from './contract/plot-link-provider.real.mjs';

const VOLS = [{ id: 'v1', key: '剧情_卷一', stages: [
  { id: 's1', key: '阶段一_开端', data: { 主线节点: [{ id: 'nA', 名称: '查A', 入口: '去档案室', 场景: '档案室场景', 发现: [{ 事实: 'FA', 内容: '发现A', 记录: '取得档案时记录 FA' }], 完成条件: { 事实: 'FA' } }] } },
  { id: 's2', key: '阶段二_秘密', data: { 主线节点: [{ id: 'nB', 名称: '秘密节点', 场景: 'SECRET_B', 完成条件: { 事实: 'FB' } }] } },
] }];
const tables = (rows) => ({ sheet_f: { name: '事实表', content: [[null, '编号', '状态', '内容'], ...rows.map((r) => [null, ...r])] } });

test('contract: plugin with real registry — ready/context/queue signals/commit/fill candidates', async () => {
  real.resetPlotLinkRegistryForTest_ACU();
  const host = createHost({ tables: tables([]), link: false });
  Object.assign(host.w.AutoCardUpdaterAPI, {
    plotLinkVersion: 4,
    registerPlotLinkProvider: real.registerPlotLinkProvider,
    unregisterPlotLinkProvider: real.unregisterPlotLinkProvider,
    listPlotLinkProviders: real.listPlotLinkProviders,
    getPlotLinkDiagnostics: real.getPlotLinkDiagnostics,
  });
  // shujuku chat ids are file names without .jsonl; ST getCurrentChatId may include it.
  host.state.chatId = '测试卡 - 2026-11-06@12h00m00s.jsonl';
  const inst = host.load();
  await inst.ready;
  const p = await inst.data.createProject('契约');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: VOLS }, clue: { mode: 'clue', bindings: { facts: [{ 表: '事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实', 内容列: '内容' }] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  assert.deepEqual(real.listPlotLinkProviders(), ['plot-injector']);

  const scope = { chatId: '测试卡 - 2026-11-06@12h00m00s', characterId: '0', isolationKey: '', roundId: 'r1', userInput: '去调查' };
  const chatKey = scope.chatId;

  // Round 1: ready (nothing pending) → $P context
  assert.equal((await real.awaitPlotLinkReady_ACU(scope)).notReady.length, 0);
  const ctxText = await real.collectPlotLinkContext_ACU(scope);
  assert.match(ctxText, /去档案室/);
  assert.ok(!ctxText.includes('发现A') && !ctxText.includes('SECRET_B'));
  // R4: finalize no longer appends anything (clue material goes via temporary world info)
  assert.equal(await real.applyPlotLinkFinalize_ACU(scope, '基础推进结果'), '基础推进结果');
  // the generation itself: world info carries the scene, reply lands on floor 1 → candidates bound to that reply
  await host.addMessage('去调查', true);
  await host.eventSource.emit(host.eventTypes.GENERATION_STARTED, 'normal', {}, false);
  const lore = (await host.worldInfo()).map((e) => e.content).join('\n');
  assert.match(lore, /档案室场景/);
  await host.addMessage('你进了档案室，翻了翻，但什么也没找到就离开了。', false);
  await host.eventSource.emit(host.eventTypes.GENERATION_ENDED);

  // wrong chat → nothing contributed
  assert.equal(await real.collectPlotLinkContext_ACU({ ...scope, chatId: '别的聊天' }), '');
  assert.equal(real.collectPlotLinkFillCandidates_ACU({ ...scope, chatId: '别的聊天' }, [1]), '');

  // Fill for floor 1 gets the candidates actually offered for that reply, with the "only if actually written" rule.
  const cand = real.collectPlotLinkFillCandidates_ACU({ ...scope, roundId: '' }, [0, 1]);
  assert.match(cand, /FA：取得档案时记录 FA/);
  assert.match(cand, /只用于匹配编号，不代表已经发生/);
  assert.match(cand, /正文没写出来/);
  assert.ok(!cand.includes('SECRET_B') && !cand.includes('发现A'), 'candidates carry ids and record rules only, not answers');
  // swipe floor 1 to another version → candidates no longer apply to it
  host.state.chat[1].swipe_id = 1;
  assert.equal(real.collectPlotLinkFillCandidates_ACU(scope, [1]), '');
  host.state.chat[1].swipe_id = 0;

  // v3 queue signals: queued → ready waits; settled → released
  real.emitPlotLinkFillEvent_ACU({ phase: 'queued', source: 'auto', pipelineId: 'q1', chatKey, isolationKey: '' });
  let released = false;
  const waiting = real.awaitPlotLinkReady_ACU({ ...scope, roundId: 'r2' }).then((r) => { released = true; return r; });
  await new Promise((r) => setTimeout(r, 40));
  assert.equal(released, false, 'real registry awaits the plugin while a fill pipeline is pending');
  real.emitPlotLinkFillEvent_ACU({ phase: 'start', source: 'auto', chatKey, isolationKey: '' });
  host.db.setTables(tables([['FA', '已核实', '发现A']]));
  real.emitPlotLinkCommit_ACU({ chatKey, isolationKey: '', messageIndex: 1, saved: true });
  real.emitPlotLinkFillEvent_ACU({ phase: 'end', source: 'auto', chatKey, isolationKey: '', success: true });
  await new Promise((r) => setTimeout(r, 20));
  assert.equal(released, false, 'still pending until the pipeline settles');
  real.emitPlotLinkFillEvent_ACU({ phase: 'settled', source: 'auto', pipelineId: 'q1', outcome: 'done', chatKey, isolationKey: '' });
  assert.equal((await waiting).notReady.length, 0);
  assert.equal(inst.runtime.clue.isFilling(), false);
  // next round: stage 2 now open
  await host.eventSource.emit(host.eventTypes.GENERATION_STARTED, 'normal', {}, false);
  assert.match((await host.worldInfo()).map((e) => e.content).join('\n'), /SECRET_B/);
  await host.eventSource.emit(host.eventTypes.GENERATION_ENDED);

  // fill event from another chat is ignored
  real.emitPlotLinkFillEvent_ACU({ phase: 'queued', source: 'auto', pipelineId: 'other', chatKey: '别的聊天', isolationKey: '' });
  assert.equal(inst.runtime.clue.isFilling(), false);

  assert.ok(real.getPlotLinkDiagnostics().every((d) => d.ok), 'no provider errors recorded');
  await inst.destroy();
  assert.deepEqual(real.listPlotLinkProviders(), []);
});
