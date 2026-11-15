// Regression tests for the 2026-11-07 external review findings (P1-1..P2-8).
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import { createHost } from './host-sim.mjs';

const C = loadCore();
const SECRET = 'XYZZY_秘密';
const sheet = (name, head, rows) => ({ name, content: [[null, ...head], ...rows.map((r) => [null, ...r])] });

test('P1-1a: configured credibility column missing → 核实 is unknown and reported, not passed', () => {
  const t = { sheet_k: sheet('知情表', ['事实', '持有人'], [['F', '甲']]) };
  const k = C.readKnowledge(t, [{ 表: '知情表', 事实列: '事实', 角色列: '持有人', 可信度列: '可信度', 已核实值: '已核实' }]);
  assert.ok(k.problems.some((p) => p.includes('缺少可信度列')));
  const env = { facts: new Map(), knowledge: k.rows, tables: t, nodeDone: () => false };
  assert.equal(C.evalCondition(C.parseCondition({ 核实: 'F@甲' }), env).v, 'unknown');
  assert.equal(C.evalCondition(C.parseCondition({ 知情: 'F@甲' }), env).v, 'true', '知情 still works');
});

test('P1-1b: credibility column without 已核实值, or no credibility binding → 核实 unknown', () => {
  const t = { sheet_k: sheet('知情表', ['事实', '持有人', '可信度'], [['F', '甲', '已核实']]) };
  for (const binding of [{ 可信度列: '可信度' }, {}]) {
    const k = C.readKnowledge(t, [{ 表: '知情表', 事实列: '事实', 角色列: '持有人', ...binding }]);
    const env = { facts: new Map(), knowledge: k.rows, tables: t, nodeDone: () => false };
    assert.equal(C.evalCondition(C.parseCondition({ 核实: 'F@甲' }), env).v, 'unknown', JSON.stringify(binding));
  }
});

test('P1-1c: state column without 已核实值 → facts pending (any non-empty state is NOT confirmed)', () => {
  const t = { sheet_f: sheet('事实表', ['编号', '状态'], [['F', '传闻']]) };
  const f = C.readFacts(t, [{ 表: '事实表', 编号列: '编号', 状态列: '状态' }]);
  assert.equal(f.facts.get('F').status, 'pending');
  assert.ok(f.problems.some((p) => p.includes('已核实值')));
  const env = { facts: f.facts, knowledge: [], tables: t, nodeDone: () => false };
  assert.equal(C.evalCondition(C.parseCondition({ 事实: 'F' }), env).v, 'unknown');
});

function projectWith(factRows, prog) {
  const vols = [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's', key: '阶段一_x', data: { 主线节点: [
    { id: 'n', 名称: 'n', 场景: '场景', 相关事实: ['F'], 完成条件: { 事实: 'Z' } },
  ] } }] }];
  const t = { sheet_f: sheet('事实表', ['编号', '状态', '内容'], factRows) };
  const f = C.readFacts(t, [{ 表: '事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实', 内容列: '内容' }]);
  const snap = { facts: f.facts, knowledge: [], tables: t };
  const p = { ...C.emptyClueProgress(), focus: 'n', ...prog };
  const state = C.computeClueState(C.compileClue(vols), snap, p, C.normalizeClue({ mode: 'clue' }));
  return C.buildClueProjection(state, snap, p, {}).content;
}

test('P1-2a: manually revoked fact is not projected as confirmed', () => {
  assert.match(projectWith([['F', '已核实', '事实内容']], {}), /事实内容/);
  const out = projectWith([['F', '已核实', '事实内容']], { factOverrides: { F: { status: 'revoked' } } });
  assert.ok(!out.includes('事实内容'));
});

test('P1-2b: <仅作者> in table fact text and knowledge rows is stripped', () => {
  const out = projectWith([['F', '已核实', `公开部分<仅作者>${SECRET}</仅作者>`]], {});
  assert.match(out, /公开部分/);
  assert.ok(!out.includes(SECRET));
});

test('P2-5: >200 later ops never drop a still-effective earlier op', () => {
  const chat = [{ mes: 'a', send_date: 't0', swipe_id: 0 }];
  let ops = C.addClueOp(C.normalizeClueOps({}), chat, { kind: 'done', target: 'A', value: 'force' });
  for (let i = 0; i < 250; i++) {
    chat.push({ mes: 'x', send_date: `t${i + 1}`, swipe_id: 0 });
    ops = C.addClueOp(ops, chat, { kind: 'focus', target: `N${i % 3}`, value: true });
  }
  const eff = C.effectiveClueProgress(C.normalizeClueOps(ops), chat);
  assert.equal(eff.overrides.A.done, 'force');
  assert.equal(eff.focus, 'N0'); // 249 % 3 = 0
});

test('P2-5b: compaction is lossless — earlier op on another floor revives after later floor deleted', () => {
  const chat = [{ mes: 'a', send_date: 't0', swipe_id: 0 }];
  let ops = C.addClueOp(C.normalizeClueOps({}), chat, { kind: 'done', target: 'A', value: 'force' });
  ops = C.addClueOp(ops, chat, { kind: 'done', target: 'A', value: 'undo' }); // same anchor → replaces
  ops = C.addClueOp(ops, chat, { kind: 'done', target: 'A', value: 'force' });
  assert.equal(ops.ops.filter((o) => o.target === 'A').length, 1, 'same-anchor ops on a slot collapse');
  chat.push({ mes: 'b', send_date: 't1', swipe_id: 0 });
  ops = C.addClueOp(ops, chat, { kind: 'done', target: 'A', value: 'undo' });
  assert.equal(C.effectiveClueProgress(ops, chat).overrides.A.done, 'undo');
  chat.pop();
  assert.equal(C.effectiveClueProgress(ops, chat).overrides.A.done, 'force', 'earlier op revives');
});

test('P2-6: import re-id also remaps 节点 references in the imported content; internal dup blocks import', () => {
  const existing = [{ id: 'v0', key: 'k0', stages: [{ id: 's0', key: '阶段一', data: { 主线节点: [{ id: 'A', 名称: '旧A' }] } }] }];
  const incoming = [{ id: 'v1', key: 'k1', stages: [
    { id: 's1', key: '阶段一', data: { 主线节点: [{ id: 'A', 名称: '新A' }, { id: 'B', 名称: 'B', 开放条件: { 节点: 'A' }, 完成条件: { 全部: ['节点: A', { 事实: 'F' }] } }] } },
    { id: 's2', key: '阶段二', data: { 进入条件: { 节点: 'A' }, 主线节点: [] } },
  ] }];
  const [out, renamed] = C.reidConflicts(incoming, existing);
  assert.deepEqual(renamed, ['A']);
  const newA = out[0].stages[0].data.主线节点[0].id;
  assert.notEqual(newA, 'A');
  const B = out[0].stages[0].data.主线节点[1];
  assert.equal(B.开放条件.节点, newA);
  assert.equal(B.完成条件.全部[0], `节点: ${newA}`);
  assert.deepEqual(B.完成条件.全部[1], { 事实: 'F' });
  assert.equal(out[0].stages[1].data.进入条件.节点, newA);
  const dupIncoming = [{ id: 'v', key: 'k', stages: [{ id: 's', key: '阶段一', data: { 主线节点: [{ id: 'X' }, { id: 'X' }] } }] }];
  assert.throws(() => C.reidConflicts(dupIncoming, existing), /重复/);
});

test('P2-7: explicit empty / null id gets a generated id', () => {
  let n = 0;
  const vols = [{ id: 'v', key: 'k', stages: [{ id: 's', key: '阶段一', data: { 主线节点: [{ id: '', 名称: 'a' }, { id: null, 名称: 'b' }, { id: '  ', 名称: 'c' }] } }] }];
  const out = C.withNodeIds(vols, () => `g${n++}`);
  assert.deepEqual(out[0].stages[0].data.主线节点.map((x) => x.id), ['g0', 'g1', 'g2']);
});

// ---- runtime-level (built script in simulated host) ----
const VOLS = (tag) => [{ id: `v${tag}`, key: `剧情_${tag}`, stages: [{ id: `s${tag}`, key: '阶段一_x', data: { 主线节点: [
  { id: `n${tag}`, 名称: `n${tag}`, 入口: `入口${tag}`, 场景: `场景${tag}`, 发现: [{ 事实: 'F', 内容: `发现${tag}` }], 完成条件: { 事实: 'F' } },
] } }] }];
const BIND = { facts: [{ 表: '事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }] };

async function twoProjects() {
  const host = createHost({ tables: { sheet_f: sheet('事实表', ['编号', '状态'], []) } });
  const inst = host.load();
  await inst.ready;
  const a = await inst.data.createProject('A'), b = await inst.data.createProject('B');
  inst.data.updateProject(a.id, (p) => ({ ...p, outline: { volumes: VOLS('A') }, clue: { mode: 'clue', inject: 'link', bindings: BIND } }));
  inst.data.updateProject(b.id, (p) => ({ ...p, outline: { volumes: VOLS('B') }, clue: { mode: 'clue', inject: 'link', bindings: BIND } }));
  await inst.runtime.switchProject(a.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  return { host, inst, a, b };
}

// 删实验联动接口第 2 步：原来从实验 provider 的上下文开始；官方路径由 GENERATION_STARTED 建本轮票据。
test('P1-3a: project switched between generation start and world-info assembly → stale round injects nothing', async () => {
  const { host, inst, b } = await twoProjects();
  await host.eventSource.emit(host.eventTypes.GENERATION_STARTED, 'normal', {}, false);
  await inst.runtime.switchProject(b.id);
  const stale = (await host.worldInfo()).map((e) => e.content).join('\n');
  assert.ok(!stale.includes('场景B') && !stale.includes('场景A'), 'stale round gets no clue material');
  await host.eventSource.emit(host.eventTypes.GENERATION_ENDED);
  // a fresh round on B works
  const next = await host.send('B');
  assert.match(next.text, /场景B/);
  await inst.destroy();
});

test('P1-3b: mode switched while outline check awaits the model → outline progress untouched', async () => {
  const host = createHost({ tables: {} });
  const inst = host.load();
  await inst.ready;
  const pr = await inst.data.createProject('P');
  inst.data.updateProject(pr.id, (p) => ({ ...p, outline: { volumes: [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's', key: '阶段一_x', data: { 主线节点: [{ 名称: '甲' }] } }] }] } }));
  await inst.runtime.switchProject(pr.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.addMessage('u', true); await host.addMessage('a', false);
  let release;
  host.ctx.generateRaw = () => new Promise((r) => { release = r; });
  const before = JSON.stringify(inst.runtime.progress());
  const pending = inst.runtime.checkNow({ manual: true });
  await host.settle();
  inst.data.updateProject(pr.id, (p) => ({ ...p, clue: { ...p.clue, mode: 'clue' } }));
  inst.runtime.bumpEpoch();
  release('{"done":["甲"],"stageDone":true,"offTrack":false,"reason":"x"}');
  assert.equal(await pending, null);
  assert.equal(JSON.stringify(inst.runtime.progress()), before);
  await inst.destroy();
});

test('P2-8: clue-mode manual check sends the focused scene material (and nothing locked)', async () => {
  const host = createHost({ tables: { sheet_f: sheet('事实表', ['编号', '状态'], []) } });
  const inst = host.load();
  await inst.ready;
  const pr = await inst.data.createProject('P');
  inst.data.updateProject(pr.id, (p) => ({ ...p, outline: { volumes: [{ id: 'v', key: '剧情_卷一', stages: [
    { id: 's1', key: '阶段一_x', data: { 主线节点: [{ id: 'n1', 名称: '标题不发', 入口: '去档案室', 场景: '档案室', 发现: [{ 事实: 'F', 内容: '记录A' }], 完成条件: { 事实: 'F' } }] } },
    { id: 's2', key: '阶段二_y', data: { 主线节点: [{ id: 'n2', 名称: 'n2', 场景: SECRET, 完成条件: { 事实: 'G' } }] } },
  ] }] }, clue: { mode: 'clue', inject: 'worldbook', bindings: BIND } }));
  await inst.runtime.switchProject(pr.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.addMessage('u', true); await host.addMessage('a', false);
  await inst.runtime.checkNow({ manual: true });
  const call = host.llmCalls.find((c) => c.url === 'generateRaw');
  assert.ok(call, 'one manual model call');
  const body = JSON.parse(call.body);
  const text = JSON.stringify(body);
  assert.match(text, /档案室/);
  assert.match(text, /记录A/);
  assert.ok(!text.includes(SECRET));
  assert.ok(!text.includes('标题不发'));
  assert.equal(host.llmCalls.length, 1);
  await inst.destroy();
});
