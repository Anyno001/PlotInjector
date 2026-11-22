// 剧情承接（方案_剧情注入的承接与离开_2026-11-09，含 GPT 审阅修订）：逐楼记录、分档、状态块、离开就停、人工焦点被表格覆盖。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';

const C = loadCore();
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
// 聊天：交替的用户 / AI 消息。n 条 AI 回复（AI 在奇数楼）。
const chatOf = (n) => { const out = [{ is_user: false, mes: '开场', swipe_id: 0, send_date: 's0' }]; for (let k = 0; k < n; k++) out.push({ is_user: true, mes: 'u' }, { is_user: false, mes: `a${k}`, swipe_id: 0, send_date: `t${k}` }); return out; };
const rec = (chat, rows) => rows.reduce((list, [i, info]) => C.addStay(list, C.stayEntry(chat, i, info)), []);

test('bands: 1-3 nothing, 4-6 有一阵了, 7+ 写了很久; numbers in brackets; idle wording describes the data only', () => {
  const chat = chatOf(8);
  const ai = chat.map((m, i) => (m.is_user ? -1 : i)).filter((i) => i > 0);
  const stays = (k, score = () => 0) => rec(chat, ai.slice(-k).map((i, n) => [i, { key: 'n1', score: score(n) }]));
  assert.equal(C.stayText(C.stayState(stays(2), chat, { key: 'n1' }), 'clue'), '', 'third reply: nothing');
  const four = C.stayText(C.stayState(stays(3), chat, { key: 'n1' }), 'clue');
  assert.match(four, /【这一场到现在】\n- 写了多久：有一阵了（从第 12 楼开始，这是这一场的第 4 条回复）/);
  assert.match(four, /- 发现：最近几轮没有新的（连续 4 条回复没有新增或核实的发现）/);
  assert.match(four, /如果环境和人物前面已经交代过/);
  assert.match(four, /如果用户最近在聊别的、做别的/);
  assert.doesNotMatch(four, /停住|不要替用户/, 'no judgement words');
  const seven = C.stayText(C.stayState(stays(6), chat, { key: 'n1' }), 'clue');
  assert.match(seven, /写了很久（从第 6 楼开始，这是这一场的第 7 条回复）/);
  assert.match(seven, /很久没有新的（连续 7 条回复/);
  // a discovery two replies ago (score went up between the 2nd and 3rd of the last 4 replies): recent progress
  const got = C.stayText(C.stayState(stays(4, (n) => (n >= 2 ? 1 : 0)), chat, { key: 'n1', score: 1 }), 'clue');
  assert.match(got, /最近一直有新的（最近几条回复里有新增或核实的发现）/);
  assert.doesNotMatch(got, /聊别的/);
  // 存疑 → 核实 (1 → 2) counts as progress
  const verified = C.stayState(stays(4, () => 1), chat, { key: 'n1', score: 2 });
  assert.equal(verified.idle, 0);
});

test('outline wording: only how long, no discovery line; stage-scoped', () => {
  const chat = chatOf(6);
  const ai = chat.map((m, i) => (m.is_user ? -1 : i)).filter((i) => i > 0);
  const stays = rec(chat, ai.slice(-5).map((i) => [i, { key: 's2' }]));
  const t = C.stayText(C.stayState(stays, chat, { key: 's2' }), 'outline');
  assert.match(t, /【这一段到现在】\n- 写了多久：有一阵了（.*这是这一段的第 6 条回复）\n结合前文接着写。如果场景和人物前面已经交代过，就不必再铺陈；已经写过的事件，不要再写一遍。/);
  assert.doesNotMatch(t, /发现/);
  assert.equal(C.stayText(C.stayState(stays, chat, { key: 's3' }), 'outline'), '', 'a new stage starts from 1');
});

test('resume after pause: shown once on the first reply after; counted from the paused replies', () => {
  const chat = chatOf(6);
  const ai = chat.map((m, i) => (m.is_user ? -1 : i)).filter((i) => i > 0);
  const stays = rec(chat, [...ai.slice(0, 2).map((i) => [i, { key: 'n1' }]), ...ai.slice(2).map((i) => [i, { key: '', paused: true }])]);
  const st = C.stayState(stays, chat, { key: 'n1' });
  assert.deepEqual(st.resumed, { rounds: 4 });
  assert.match(C.stayText(st, 'clue'), /- 刚恢复：停了一阵（暂停了 4 条回复）\n结合前文，以及本次提供的过去记忆（如果有）接着写。/);
  assert.equal(C.stayState(stays, chat, { key: '', paused: true }).resumed, null, 'still paused: nothing');
});

test('records follow the chat: regenerate / swipe count once, deleted floors drop out, gaps break the run', () => {
  const chat = chatOf(5);
  const ai = chat.map((m, i) => (m.is_user ? -1 : i)).filter((i) => i > 0);
  let stays = rec(chat, ai.map((i) => [i, { key: 'n1' }]));
  assert.equal(C.stayState(stays, chat, { key: 'n1' }).rounds, 6);
  // the same floor written again (another swipe) replaces, not adds
  stays = C.addStay(stays, C.stayEntry(chat, ai[4], { key: 'n1' }));
  assert.equal(stays.length, 5);
  // swipe changed on the last floor: that record no longer counts
  const swiped = chat.map((m, i) => (i === ai[4] ? { ...m, swipe_id: 1, send_date: 'x' } : m));
  assert.equal(C.stayState(stays, swiped, { key: 'n1' }).rounds, 1, 'the run is broken at the swiped reply');
  // last two floors deleted
  assert.equal(C.stayState(stays, chat.slice(0, ai[3]), { key: 'n1' }).rounds, 4);
  // a reply with no record in the middle breaks the run
  const holed = stays.filter((x) => x.i !== ai[2]);
  assert.equal(C.stayState(holed, chat, { key: 'n1' }).rounds, 3);
  // kept to the last 60
  let many = []; const big = chatOf(80);
  big.forEach((m, i) => { if (!m.is_user && i) many = C.addStay(many, C.stayEntry(big, i, { key: 'n1' })); });
  assert.equal(many.length, 60);
});

test('focus: 无 / 离场 / a configured value all mean none; empty does not; manual focus yields once the table moves on', () => {
  const nodeStates = [{ node: { uid: 'n1', kind: 'main', unit: null }, status: 'available' }, { node: { uid: 'n2', kind: 'main', unit: null }, status: 'available' }];
  const single = [nodeStates[0]];
  const tables = (v) => ({ sheet_c: { name: '线索控制表', content: [[null, '标识', '当前场景'], ['1', '主线', v]] } });
  const cfg = (extra = {}) => ({ autoFocusSingle: true, bindings: { scene: { 路径: '线索控制表/主线/当前场景', ...extra } } });
  const pick = (ns, v, prog = {}, c = cfg()) => C.pickFocus(ns, { focus: '', ...prog }, c, { tables: tables(v) });
  for (const v of ['无', '离场']) assert.equal(pick(single, v).source, 'away', v);
  assert.equal(pick(single, '不在', {}, cfg({ 离场值: '不在' })).source, 'away', 'configured value');
  assert.equal(pick(single, '').source, 'auto', 'empty cell is not 无');
  // manual focus on n1 set while the table said n1; the table later says 无 → the table wins
  assert.equal(pick(nodeStates, 'n1', { focus: 'n1', focusSceneAt: 'n1' }).uid, 'n1');
  assert.equal(pick(nodeStates, '无', { focus: 'n1', focusSceneAt: 'n1' }).source, 'away');
  // manual focus set while the table still had an old value: kept until the table changes
  assert.equal(pick(nodeStates, 'n2', { focus: 'n1', focusSceneAt: 'n2' }).uid, 'n1');
  // manual leave while the table still said n1: stays away; the table later writes n1 again after a real return → back
  assert.equal(pick(single, 'n1', { focus: '@away:n1', focusSceneAt: 'n1' }).source, 'away');
  assert.equal(pick(single, '无', { focus: '@away:n1', focusSceneAt: 'n1' }).source, 'away');
  assert.equal(pick(single, 'n1', { focus: '@away:n1', focusSceneAt: '无' }).uid, 'n1', 'returned after the leave');
  // old records without focusSceneAt keep the old behaviour
  assert.equal(pick(nodeStates, '无', { focus: 'n1' }).uid, 'n1');
});

test('clue projection: scene marked as the first-arrival look; the stay block sits inside the plot tag', () => {
  const vols = [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's', key: '阶段一', data: { 主线节点: [{ id: 'n1', 名称: '老韩', 入口: '去问老韩', 地点: '值夜棚', 场景: '老韩缩着肩', 发现: [{ 事实: 'F1', 内容: '看见周先生' }], 完成条件: { 事实: 'F1' } }] } }] }];
  const compiled = C.compileClue(vols);
  const state = C.computeClueState(compiled, { facts: new Map(), knowledge: [], tables: {}, problems: [] }, { focus: 'n1', overrides: {}, factOverrides: {}, lines: {} }, C.normalizeClue({ mode: 'clue' }));
  const out = C.buildClueProjection(state, { facts: new Map(), knowledge: [] }, {}, { tagName: '剧情参考' }, { stay: '【这一场到现在】\n- 写了多久：有一阵了（这是这一场的第 4 条回复）\n结合前文接着写。' });
  assert.match(out.content, /<剧情参考>[\s\S]*【这一场到现在】[\s\S]*场景（初次到达时的样子；人物态度和环境后来的变化以前文为准，不要重置）：老韩缩着肩[\s\S]*<\/剧情参考>/);
  assert.ok(out.content.indexOf('【这一场到现在】') < out.content.indexOf('场景（初次'), 'status first, then material');
});

test('runtime (outline): each AI reply is recorded; from the 4th reply the stage entry carries the block; no model calls', async () => {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('P');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's1', key: '阶段一_码头', data: { 主线节点: [{ 名称: '问老韩', 事件: '老韩说出那晚看到的事' }] } }] }] } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.data.updateSettings({ checkEvery: 99 });
  const stageText = () => inst.runtime.entries().find((e) => e.kind === 'detail').content;
  await host.addMessage('开场', false);
  for (let k = 0; k < 2; k++) { await host.addMessage('继续', true); await host.addMessage(`正文${k}`, false); }
  // three AI replies recorded (the opening + 2): the next one is the 4th → the block appears
  assert.match(stageText(), /写了多久：有一阵了（从第 0 楼开始，这是这一段的第 4 条回复）/);
  await host.state.chat.splice(3);
  inst.runtime.refresh && inst.runtime.refresh();
  assert.doesNotMatch(stageText(), /这一段到现在/, 'after deleting floors it is the 3rd again');
  for (let k = 0; k < 2; k++) { await host.addMessage('继续', true); await host.addMessage(`正文${k}`, false); }
  assert.match(stageText(), /<剧情参考 卷=[\s\S]*这一段到现在[\s\S]*<\/剧情参考>/);
  assert.equal(host.llmCalls.length, 0);
  await inst.destroy();
});

test('runtime (clue): the focus scene carries the block from its 4th reply; the table writing 无 stops the material', async () => {
  const facts = (st) => ({ sheet_f: { name: '事实表', content: [[null, '编号', '状态'], ['1', 'F1', st]] }, sheet_c: { name: '线索控制表', content: [[null, '标识', '当前场景'], ['1', '主线', 'n1']] } });
  const host = createHost({ tables: facts('未获得') });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('P');
  const vols = [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's', key: '阶段一', data: { 主线节点: [{ id: 'n1', 名称: '老韩', 入口: '去问老韩', 地点: '值夜棚', 场景: '老韩缩着肩', 发现: [{ 事实: 'F1', 内容: '看见周先生' }, { 事实: 'F3', 内容: '雾很大' }], 完成条件: { 全部: [{ 事实: 'F1' }, { 事实: 'F3' }] } }, { id: 'n2', 名称: '后门', 入口: '去后门看看', 必需: false, 发现: [{ 事实: 'F2', 内容: '鞋印' }], 完成条件: { 事实: 'F2' } }] } }] }];
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: { facts: [{ 表: '事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实', 说法值: '存疑' }], knowledge: [], scene: { 路径: '线索控制表/主线/当前场景', 离场值: '离场' } } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  const material = () => { inst.runtime.clue.invalidate(); return inst.runtime.clue.projection().content; };
  await host.addMessage('开场', false);
  for (let k = 0; k < 2; k++) { await host.addMessage('继续', true); await host.addMessage(`正文${k}`, false); }
  assert.match(material(), /这一场到现在[\s\S]*第 4 条回复[\s\S]*连续 4 条回复没有新增或核实的发现[\s\S]*场景（初次到达时的样子/);
  // a 存疑 discovery arrives: the next reply says recent progress
  host.db.setTables(facts('存疑'));
  assert.match(material(), /最近一直有新的/);
  // the table writes 无: the scene material stops; only entries remain
  const t = facts('存疑'); t.sheet_c.content[1][2] = '无'; host.db.setTables(t);
  const off = material();
  assert.doesNotMatch(off, /老韩缩着肩|这一场到现在/);
  assert.match(off, /由用户选择，不要强行引导/);
  assert.equal(host.llmCalls.length, 0);
  await inst.destroy();
});

test('places: a node may list several places; a card\'s own place table is named in the catalog (read-only); the table catalog lists all its names', () => {
  const vols = [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's', key: '阶段一', data: { 主线节点: [{ id: 'n1', 名称: '老韩', 入口: '去问老韩', 地点: ['码头仓库', '值夜棚'], 发现: [{ 事实: 'F1', 内容: 'x' }], 完成条件: { 事实: 'F1' } }] } }] }];
  const plan = C.prebuildPlan(vols);
  assert.equal(plan.scenes[0].place, '码头仓库、值夜棚');
  const base = { mate: { type: 'chatSheets', version: 1 }, sheet_place: { uid: 'sheet_place', name: '场景地点表', content: [[null, '地点名称', '场景描述'], ...Array.from({ length: 12 }, (_, i) => [String(i + 1), `地点${i + 1}`, ''])], sourceData: { note: '记录地点', ddl: '' } } };
  const r = C.synthesizeClueTemplate(base, { clue: { scenes: plan.scenes } });
  const ctrl = Object.values(r.template).find((s) => s && s.name === '线索控制表');
  assert.match(ctrl.sourceData.note, /地点名称以《场景地点表》里的为准。/);
  assert.deepEqual(Object.values(r.template).find((s) => s && s.name === '场景地点表').content.length, 13, 'the place table is not written to');
  const cat = C.tableCatalogText(base);
  assert.match(cat, /地点12/, 'all place names listed');
  const vm = C.outlineMessages({ setting: '', talk: '', volumes: [], volumeNo: 1, mode: 'clue' })[0].content;
  assert.match(vm, /地点写具体的地方/);
  assert.match(vm, /节点的地点用表里已有的叫法/);
});

// ---------- GPT 代码审阅（9c4e216）R1：人工焦点被表格接管后，表格写回原值不复活 ----------
test('R1: leave n1 → table 无 → player really returns → table n1 again: focus comes back; deleting the takeover floors restores the manual leave', async () => {
  const T = (scene) => ({ sheet_f: { name: '事实表', content: [[null, '编号', '状态'], ['1', 'F1', '未获得']] }, sheet_c: { name: '线索控制表', content: [[null, '标识', '当前场景'], ['1', '主线', scene]] } });
  const host = createHost({ tables: T('n1') });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('P');
  const vols = [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's', key: '阶段一', data: { 主线节点: [{ id: 'n1', 名称: '老韩', 入口: '去问老韩', 发现: [{ 事实: 'F1', 内容: 'x' }], 完成条件: { 事实: 'F1' } }, { id: 'n2', 名称: '后门', 入口: '去后门', 必需: false, 发现: [{ 事实: 'F2', 内容: 'y' }], 完成条件: { 事实: 'F2' } }] } }] }];
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: { facts: [{ 表: '事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }], knowledge: [], scene: { 路径: '线索控制表/主线/当前场景', 离场值: '无' } } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  const focus = () => { inst.runtime.clue.invalidate(); return inst.runtime.clue.compute().state.focus; };
  await host.addMessage('开场', false);
  await host.addMessage('去问老韩', true); await host.addMessage('老韩推说记不清', false);
  assert.equal(focus().uid, 'n1');
  inst.runtime.clue.leaveScene('n1');
  assert.equal(focus().source, 'away', 'manual leave while the table still says n1');
  // the player walks off; the fill writes 无 for that reply
  await host.addMessage('回报社', true); host.db.setTables(T('无')); await host.addMessage('你回到报社', false);
  assert.equal(focus().source, 'away');
  // the player really goes back; the fill writes n1 again
  await host.addMessage('再去找老韩', true); await host.addMessage('你又来到值夜棚', false); host.db.setTables(T('n1'));
  assert.equal(focus().uid, 'n1', 'the return is not blocked by the old manual leave');
  // a manual focus on n2 made while the table said n1 does not come back either after 无 → n1
  inst.runtime.clue.setFocus('n2');
  assert.equal(focus().uid, 'n2');
  await host.addMessage('走开', true); host.db.setTables(T('无')); await host.addMessage('离开', false);
  await host.addMessage('回来', true); await host.addMessage('回到值夜棚', false); host.db.setTables(T('n1'));
  assert.equal(focus().uid, 'n1', 'the old manual n2 does not revive');
  // deleting the floors after the manual choice (and the table rolls back) brings the manual choice back
  const keep = host.state.chat.length - 4;
  host.state.chat.splice(keep); host.db.setTables(T('n1'));
  assert.equal(focus().uid, 'n2', 'takeover floors deleted: the manual focus is in force again');
  await inst.destroy();
});
