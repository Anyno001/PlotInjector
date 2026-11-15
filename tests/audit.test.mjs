// Final-request audit (I01/I08): read-only check of the actual outgoing request.
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import { createHost } from './host-sim.mjs';

const C = loadCore();
const VOLS = [{ id: 'v', key: '剧情_卷一', stages: [
  { id: 's1', key: '阶段一_x', data: { 主线节点: [
    { id: 'nA', 名称: '查看档案记录', 入口: '去档案室', 场景: '档案室里灰尘很厚，柜子上贴着封条', 发现: [{ 事实: 'FA', 内容: '记录显示设备是从港口仓库运来的' }], 完成条件: { 事实: 'FA' } },
  ] } },
  { id: 's2', key: '阶段二_y', data: { 主线节点: [
    { id: 'nB', 名称: '幕后黑手现身', 场景: '仓库深处站着真正的幕后操纵者维恩', 作者备注: '维恩其实是委托人的哥哥', 完成条件: { 事实: 'FB' } },
  ] } },
] }];
const SETTING = '公开设定：城市很大。<仅作者>委托人在说谎，她认识维恩很多年</仅作者>';

test('audit core: clean request, leak via other source, duplicate projection', () => {
  const state = { focus: { uid: 'nA' } };
  const project = { setting: { text: SETTING }, outline: { volumes: VOLS } };
  const proj = '<剧情参考>\n场景：档案室里灰尘很厚，柜子上贴着封条\n- 记录显示设备是从港口仓库运来的\n</剧情参考>';
  let r = C.auditRequest(`系统提示\n公开设定：城市很大。\n${proj}\n用户：去档案室`, project, state, proj);
  assert.deepEqual(r.leaks, [], 'focused scene in projection is not a leak');
  assert.equal(r.projectionCount, 1);
  r = C.auditRequest(`其他世界书：仓库深处站着真正的幕后操纵者维恩。\n${proj}`, project, state, proj);
  assert.ok(r.leaks.some((l) => l.source.includes('幕后黑手现身·场景')));
  r = C.auditRequest('某条目：委托人在说谎，她认识维恩很多年', project, state, '');
  assert.ok(r.leaks.some((l) => l.source.includes('设定·<仅作者>')));
  r = C.auditRequest('提到节点名：幕后黑手现身', project, state, '');
  assert.ok(r.leaks.some((l) => l.source.includes('名称')));
  r = C.auditRequest(`${proj}\n${proj}`, project, state, proj);
  assert.equal(r.duplicated, true);
  // focused scene appearing OUTSIDE the projection (e.g. copied elsewhere) is fine (it's allowed this round)
  r = C.auditRequest('档案室里灰尘很厚，柜子上贴着封条', project, state, '');
  assert.ok(!r.leaks.some((l) => l.source.includes('查看档案记录·场景')));
});

test('audit core: requestToText handles chat array, multipart, text prompt', () => {
  assert.equal(C.requestToText([{ role: 'system', content: 'a' }, { role: 'user', content: [{ type: 'text', text: 'b' }] }]), 'a\nb');
  assert.equal(C.requestToText({ chat: [{ content: 'x' }] }), 'x');
  assert.equal(C.requestToText({ prompt: 'p' }), 'p');
});

async function setup() {
  const host = createHost({ tables: { sheet_f: { name: '事实表', content: [[null, '编号', '状态']] } } });
  const inst = host.load();
  await inst.ready;
  const p = await inst.data.createProject('P');
  inst.data.updateProject(p.id, (x) => ({ ...x, setting: { ...x.setting, text: SETTING }, outline: { volumes: VOLS }, clue: { mode: 'clue', inject: 'link', waitFill: false, bindings: { facts: [{ 表: '事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  return { host, inst };
}

test('audit runtime: real round passes; a leak from another worldbook is reported; dryRun ignored', async () => {
  const { host, inst } = await setup();
  const lore = await host.generate();
  const round = await host.db.runPlotRound('去档案室');
  const chat = [{ role: 'system', content: lore.map((e) => e.content).join('\n') }, { role: 'user', content: round.finalMessage }];
  await host.promptReady(chat);
  let a = inst.runtime.clue.diagnose().lastAudit;
  assert.ok(a, 'audit recorded');
  assert.deepEqual(JSON.parse(JSON.stringify(a.leaks)), []);
  assert.equal(a.projectionCount, 1);
  chat.push({ role: 'system', content: '【某世界书】维恩其实是委托人的哥哥' });
  await host.promptReady(chat);
  a = inst.runtime.clue.diagnose().lastAudit;
  assert.ok(a.leaks.some((l) => l.source.includes('作者备注')));
  const before = inst.runtime.clue.diagnose().lastAudit.at;
  await host.eventSource.emit(host.eventTypes.CHAT_COMPLETION_PROMPT_READY, { chat: [{ content: '维恩其实是委托人的哥哥' }], dryRun: true });
  assert.equal(inst.runtime.clue.diagnose().lastAudit.at, before, 'dryRun not audited');
  await inst.destroy();
});

// 大纲模式的最终请求核验（2026-11-08 补上）：作者材料 + 还没到的阶段；当前阶段（本轮注入的）不算。
const OUT_VOLS = [{ id: 'v', key: '剧情_卷一', stages: [
  { id: 'o1', key: '阶段一_报案', data: { AI指令: '节奏平缓，以日常对话为主。', 主线节点: [{ id: 'm1', 名称: '接受委托', 事件: '码头货栈的东家私下托主角调查一批丢失的货物' }] } },
  { id: 'o2', key: '阶段二_真相', data: { 主线节点: [{ id: 'm2', 名称: '揭穿真凶', 事件: '主角在账房里发现仓库主管的侄子偷运了这批货', 偏转: '若主角先去找主管则主管会销毁出货单' }] } },
] }];
const OUT_SETTING = '公开设定：雾港。<仅作者>东家其实早就知道侄子的事情</仅作者>';
test('outline audit core: a later stage or an author block brought in by another source is flagged; the injected current stage is not', () => {
  const project = { setting: { text: OUT_SETTING }, outline: { volumes: OUT_VOLS } };
  const states = { o1: 'active', o2: 'next' };
  const proj = '公开设定：雾港。\n<剧情参考>节奏平缓，以日常对话为主。码头货栈的东家私下托主角调查一批丢失的货物</剧情参考>';
  let r = C.auditOutlineRequest(`系统\n${proj}\n用户：去码头`, project, states, proj);
  assert.deepEqual([...r.leaks], [], 'current stage injected by the plugin is fine');
  assert.equal(r.projectionCount, 1);
  r = C.auditOutlineRequest(`某世界书：主角在账房里发现仓库主管的侄子偷运了这批货。\n${proj}`, project, states, proj);
  assert.ok(r.leaks.some((l) => /还没到的阶段二 真相·揭穿真凶·事件/.test(l.source)), JSON.stringify(r.leaks));
  r = C.auditOutlineRequest(`预设：若主角先去找主管则主管会销毁出货单\n${proj}`, project, states, proj);
  assert.ok(r.leaks.some((l) => /偏转/.test(l.source)));
  r = C.auditOutlineRequest(`条目：东家其实早就知道侄子的事情\n${proj}`, project, states, proj);
  assert.ok(r.leaks.some((l) => /设定·<仅作者>/.test(l.source)));
  // a stage that is already done is not restricted
  r = C.auditOutlineRequest(`前情：主角在账房里发现仓库主管的侄子偷运了这批货`, project, { o1: 'done', o2: 'done' }, '');
  assert.ok(!r.leaks.some((l) => /揭穿真凶/.test(l.source)));
  // text the AI already wrote in this chat is not a leak
  // (the chat history goes into the request verbatim, so it is stripped as a whole before checking)
  const past = '雾很大。主角在账房里发现仓库主管的侄子偷运了这批货。他没有声张。';
  r = C.auditOutlineRequest(`系统\n${past}\n用户：继续`, project, states, '', { history: [past] });
  assert.deepEqual([...r.leaks], []);
});
test('audit runtime: outline mode now audits the final request (author blocks and stages not reached yet) and shows it on the diag page', async () => {
  const host = createHost({});
  const inst = host.load();
  await inst.ready;
  const p = await inst.data.createProject('P');
  inst.data.updateProject(p.id, (x) => ({ ...x, setting: { ...x.setting, text: OUT_SETTING }, outline: { volumes: OUT_VOLS } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.promptReady([{ content: '其他条目：主角在账房里发现仓库主管的侄子偷运了这批货' }]);
  const a = inst.runtime.diagnose().lastOutlineAudit;
  assert.ok(a, 'audited');
  assert.ok(a.leaks.some((l) => /揭穿真凶/.test(l.source)));
  assert.equal(inst.runtime.clue.diagnose().lastAudit, null, 'clue audit untouched in outline mode');
  // a clean request: what the plugin itself injects is not flagged
  const injected = inst.runtime.entries().map((e) => e.content).join('\n');
  await host.promptReady([{ content: `系统提示\n${injected}\n用户：去码头` }]);
  assert.deepEqual([...inst.runtime.diagnose().lastOutlineAudit.leaks], []);
  // dry runs (previews, token counts) are not audited
  const before = inst.runtime.diagnose().lastOutlineAudit.at;
  await new Promise((r) => setTimeout(r, 5));
  await host.eventSource.emit(host.eventTypes.CHAT_COMPLETION_PROMPT_READY, { chat: [{ content: 'x' }], dryRun: true });
  assert.equal(inst.runtime.diagnose().lastOutlineAudit.at, before);
  await inst.destroy();
});
