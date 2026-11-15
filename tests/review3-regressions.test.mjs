// Regression tests for review round 3 (R4–R8) and the follow-up notes on it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import { createHost } from './host-sim.mjs';

const C = loadCore();
const sheet = (name, head, rows) => ({ name, content: [[null, ...head], ...rows.map((r) => [null, ...r])] });
const BIND = { facts: [{ 表: '事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实', 内容列: '内容' }] };

// ---------- R8: multi-floor investigation ----------
function projectionFor(rows, prog = {}) {
  const vols = [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's', key: '阶段一_x', data: { 主线节点: [
    { id: 'n', 名称: '调查', 场景: '仓库', 发现: [{ 事实: 'F1', 内容: '找到编号' }, { 事实: 'F2', 内容: '核实来源' }], 完成条件: { 全部: [{ 事实: 'F1' }, { 事实: 'F2' }] } },
  ] } }] }];
  const t = { sheet_f: sheet('事实表', ['编号', '状态', '内容'], rows) };
  const f = C.readFacts(t, BIND.facts);
  const snap = { facts: f.facts, knowledge: [], tables: t };
  const p = { ...C.emptyClueProgress(), focus: 'n', ...prog };
  const state = C.computeClueState(C.compileClue(vols), snap, p, C.normalizeClue({ mode: 'clue' }));
  return C.buildClueProjection(state, snap, p, {});
}

test('R8: F1 obtained, F2 not → F1 listed only as obtained, F2 only as pending; node still in progress', () => {
  const out = projectionFor([['F1', '已核实', '已找到编号']]);
  const [pendingPart, gotPart] = out.content.split('本场景已经获得的发现');
  assert.match(pendingPart, /尚未发生/);
  assert.match(pendingPart, /核实来源/);
  assert.ok(!pendingPart.includes('找到编号'), 'F1 not listed as pending');
  // T6: the obtained line shows what the table recorded (what was actually revealed), not the author's full answer
  assert.match(gotPart, /已找到编号/);
  assert.equal(out.content.split('已找到编号').length - 1, 1, 'not duplicated again in the confirmed-facts list');
  assert.deepEqual(JSON.parse(JSON.stringify(out.used.candidates)), [{ fact: 'F2', record: '' }], 'only F2 remains a fill candidate');
});

test('R8: manual revoke of F1 puts it back to pending; manual confirm of F2 moves it to obtained', () => {
  let out = projectionFor([['F1', '已核实', '']], { factOverrides: { F1: { status: 'revoked' } } });
  assert.ok(!out.content.includes('已经获得的发现'));
  out = projectionFor([], { factOverrides: { F2: { status: 'confirmed' } } });
  const gotPart = out.content.split('本场景已经获得的发现')[1] || '';
  // V8: no recorded content → say so instead of printing the author's full answer
  assert.match(gotPart, /F2 已经确认，但表格没有记录具体内容/);
  assert.ok(!gotPart.includes('核实来源'));
  // with a manual-confirm note text, that text is shown
  out = projectionFor([], { factOverrides: { F2: { status: 'confirmed', text: '主角看到了出库单' } } });
  assert.match(out.content.split('本场景已经获得的发现')[1] || '', /主角看到了出库单/);
});

// ---------- R6 / R7: audit ----------
const AUDIT_VOLS = [{ id: 'v', key: '剧情_卷一', stages: [
  { id: 's1', key: '阶段一_x', AI指令: '', data: { AI指令: `公开指令<仅作者>阶段级秘密：幕后人是维恩先生</仅作者>`, 主线节点: [
    { id: 'nA', 名称: '查看档案记录', 场景: '档案室里灰尘很厚，柜子上贴着封条', 发现: [{ 事实: 'FA', 内容: '记录显示设备是从港口仓库运来的' }, { 事实: 'FA2', 内容: '记录背面写着一个电话号码' }] },
  ] } },
  { id: 's2', key: '阶段二_y', data: { 主线节点: [{ id: 'nB', 名称: 'B', 场景: '仓库深处有一扇暗门通往地下室' }] } },
] }];
const project = { setting: { text: '' }, outline: { volumes: AUDIT_VOLS } };

test('R6: revealed discovery appearing in the request is not a leak; unrevealed one from the same node still is', () => {
  const state = { focus: { uid: 'nB' } };
  const isRevealed = (id) => id === 'FA';
  let r = C.auditRequest('前情：记录显示设备是从港口仓库运来的。', project, state, '', { isRevealed });
  assert.deepEqual(r.leaks.filter((l) => l.level === 'leak'), []);
  r = C.auditRequest('某世界书：记录背面写着一个电话号码。', project, state, '', { isRevealed });
  assert.ok(r.leaks.some((l) => l.level === 'leak' && l.source.includes('发现')), 'FA2 not obtained → still a leak');
});

test('R6: material already shown in the AI history of this chat/swipe is not a leak; elsewhere it is', () => {
  const state = { focus: { uid: 'nB' } };
  const history = ['你推开门，档案室里灰尘很厚，柜子上贴着封条。'];
  let r = C.auditRequest(`历史：${history[0]}`, project, state, '', { history });
  assert.ok(!r.leaks.some((l) => l.level === 'leak' && l.source.includes('场景')));
  r = C.auditRequest('其他条目：档案室里灰尘很厚，柜子上贴着封条', project, state, '', { history: [] });
  assert.ok(r.leaks.some((l) => l.level === 'leak' && l.source.includes('场景')), 'no permanent "was focused once" exemption');
});

test('R6: node names are hint-level, not leak-level', () => {
  const r = C.auditRequest('我想查看档案记录', project, { focus: { uid: '' } }, '');
  assert.ok(r.leaks.some((l) => l.level === 'hint' && l.source.includes('名称')));
  assert.ok(!r.leaks.some((l) => l.level === 'leak' && l.source.includes('名称')));
});

test('R7: stage-level <仅作者> blocks are scanned', () => {
  const r = C.auditRequest('外部条目：阶段级秘密：幕后人是维恩先生', project, { focus: { uid: 'nA' } }, '');
  assert.ok(r.leaks.some((l) => l.source.includes('AI指令·<仅作者>')));
});

test('R7: multi-line author text — a secret line alone is detected', () => {
  const p = { setting: { text: '<仅作者>这是一段很普通的背景描述文字\n真正的秘密是钥匙藏在钟楼顶上</仅作者>' }, outline: { volumes: [] } };
  const r = C.auditRequest('某条目：真正的秘密是钥匙藏在钟楼顶上', p, { focus: { uid: '' } }, '');
  assert.ok(r.leaks.some((l) => l.source.includes('设定·<仅作者>')));
});

// ---------- R5 ----------
test('R5: outline check fails after project switch → new project progress untouched', async () => {
  const host = createHost({ tables: {} });
  const inst = host.load();
  await inst.ready;
  const vols = [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's', key: '阶段一_x', data: { 主线节点: [{ 名称: '甲' }] } }] }];
  const a = await inst.data.createProject('A'), b = await inst.data.createProject('B');
  inst.data.updateProject(a.id, (x) => ({ ...x, outline: { volumes: vols } }));
  inst.data.updateProject(b.id, (x) => ({ ...x, outline: { volumes: vols } }));
  await inst.runtime.switchProject(a.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.addMessage('u', true); await host.addMessage('a', false); await host.addMessage('a2', false);
  let fail;
  host.ctx.generateRaw = () => new Promise((_, rej) => { fail = rej; });
  const pending = inst.runtime.checkNow({ manual: true });
  await host.settle();
  await inst.runtime.switchProject(b.id);
  const before = inst.runtime.progress().lastCheckFloor;
  fail(new Error('network'));
  assert.equal(await pending, null);
  assert.equal(inst.runtime.progress().lastCheckFloor, before, 'B lastCheckFloor unchanged');
  await inst.destroy();
});

// ---------- R4 + candidates bound to the reply ----------
const VOLS = [{ id: 'v', key: '剧情_卷一', stages: [
  { id: 's1', key: '阶段一_x', data: { 主线节点: [
    { id: 'nA', 名称: 'A', 入口: '去档案室', 场景: '档案室场景A', 发现: [{ 事实: 'FA', 内容: '档案里的答案A', 记录: '实际取得档案时记 FA' }], 完成条件: { 事实: 'FA' } },
    { id: 'nB', 名称: 'B', 入口: '去码头', 场景: '码头场景B', 发现: [{ 事实: 'FB', 内容: '码头的答案B' }], 完成条件: { 事实: 'FB' } },
  ] } },
] }];
async function setup(clue = {}) {
  const host = createHost({ tables: { sheet_f: sheet('事实表', ['编号', '状态', '内容'], []) } });
  const inst = host.load();
  await inst.ready;
  const p = await inst.data.createProject('P');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: VOLS }, clue: { mode: 'clue', bindings: BIND, ...clue } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  return { host, inst };
}

test('R4 scenario 5: enter A without finding, switch focus to B → the next full request has no trace of A\'s answers', async () => {
  // legacy inject=link project: still only temporary world info
  const { host, inst } = await setup({ inject: 'link' });
  inst.runtime.clue.setFocus('nA');
  const r1 = await host.send('去档案室', { reply: '你进了档案室，翻了一会儿没找到什么，就离开了。' });
  assert.match(r1.text, /档案里的答案A/);
  inst.runtime.clue.setFocus('nB');
  const r2 = await host.send('去码头');
  const fullRequest = JSON.stringify(host.state.chat) + '\n' + r2.text;
  assert.ok(!fullRequest.includes('档案里的答案A'), 'A pending answer is nowhere in history or this request');
  assert.match(r2.text, /码头的答案B/);
  await inst.destroy();
});

// 删实验联动接口第 2 步：原来断言实验 $L 文字，改成直接核对逐楼候选记录（正式功能「正文可能自己编了」靠它）。
test('candidates bound to the reply: floor 1 records A (with its record rule), not later focus B; another swipe has none of its own', async () => {
  const { host, inst } = await setup();
  inst.runtime.clue.setFocus('nA');
  await host.send('去档案室', { reply: '你进门聊了几句就离开了。' });
  const recs = () => JSON.parse(JSON.stringify(inst.runtime.progress().clueCandidates || []));
  const floor1 = recs().filter((x) => x.i === 1);
  assert.equal(floor1.length, 1);
  assert.equal(floor1[0].swipe, 0);
  assert.deepEqual(floor1[0].candidates, [{ fact: 'FA', record: '实际取得档案时记 FA' }]);
  assert.ok(!JSON.stringify(floor1).includes('档案里的答案A'), 'answer text not stored with the candidates');
  // later focus change must not rewrite what floor 1 was offered
  inst.runtime.clue.setFocus('nB');
  inst.runtime.clue.invalidate();
  assert.deepEqual(recs().filter((x) => x.i === 1)[0].candidates.map((c) => c.fact), ['FA']);
  // the floor generated again (swipe 1): the focus-B op was anchored on swipe 0 so it no longer applies; with focus B set
  // again for this swipe the new reply gets its own record, and the swipe-0 record is untouched
  host.state.chat[1].swipe_id = 1;
  await host.eventSource.emit(host.eventTypes.GENERATION_STARTED, 'swipe', {}, false);
  inst.runtime.clue.setFocus('nB');
  await host.worldInfo();
  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, 1);
  await host.eventSource.emit(host.eventTypes.GENERATION_ENDED);
  const both = recs().filter((x) => x.i === 1);
  assert.deepEqual(both.map((x) => [x.swipe, x.candidates.map((c) => c.fact).join()]).sort(), [[0, 'FA'], [1, 'FB']]);
  // FA still counts as offered in this chat (loose memory across swipes, GPT 实测返修审阅 §5 第 2 步)
  assert.ok((inst.runtime.progress().clueOffered || []).includes('FA'));
  await inst.destroy();
});

test('fill candidates are not leaked into world info / main request', async () => {
  const { host, inst } = await setup();
  inst.runtime.clue.setFocus('nA');
  const r = await host.send('去档案室', { reply: 'x' });
  assert.ok(!r.text.includes('线索编号对照'));
  assert.ok(!r.text.includes('实际取得档案时记'), 'record rule text is for the fill model only');
  await inst.destroy();
});
