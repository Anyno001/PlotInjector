// 第 5 批 5b：大纲推进按线时，定期检测顺带确认开线条件里的事实和一句话条件（方案 五.4）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';

const C = loadCore();
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const st = (id, key, mark) => ({ id, key, data: { AI指令: `${mark}的指令`, 主线节点: [{ id: `${id}n`, 名称: `${mark}节点`, 事件: `${mark}事件。` }] } });

test('check prompt: no pending facts → unchanged; with facts → a 【待确认的事】 block and a facts key; replies are parsed', () => {
  const floors = [{ index: 3, text: '正文' }];
  const plain = C.buildCheckMessages(null, '索引', floors, null, null);
  same(C.buildCheckMessages(null, '索引', floors, null, null, []), plain, 'empty list: same prompt as before');
  const m = C.buildCheckMessages(null, '索引', floors, null, null, [{ id: 'F_letter', text: '主角收到并读了叶莲娜的信' }]);
  assert.match(m[0].content, /"facts":\[\{"id":"编号","floor"/);
  assert.match(m[0].content, /只是提到、计划、猜测、角色以为的都不算/);
  assert.match(m[1].content, /【待确认的事】\n- F_letter：主角收到并读了叶莲娜的信/);
  same(C.parseCheckReply('{"done":[],"facts":[{"id":"F_letter","floor":3},"句：x",{"id":""}]}').facts, [{ id: 'F_letter', floor: 3 }, { id: '句：x', floor: 0 }]);
  const only = C.buildPersonaCheckMessages([], floors, [{ id: 'F_fire', text: '码头起火' }]);
  assert.match(only[0].content, /判断下列事情是否已经在正文中发生/);
  assert.ok(!/personas/.test(only[0].content), 'no persona key when there are no persona lines');
});

const vols = (open) => [
  { id: 'vM1', key: '剧情_卷1_雾港', line: { 编号: 'M1', 类型: '主线' }, stages: [st('a1', '阶段1_灯', 'A1'), st('a2', '阶段2_当铺', 'A2')] },
  { id: 'vS1', key: '剧情_卷2_电影院', line: { 编号: 'S01', 类型: '支线', 开启条件: open, 开始时机原文: '收到叶莲娜的信以后' }, stages: [st('c1', '阶段1_放映厅', 'C1')] },
];

test('olPendingFacts: unstarted lines\' unrecorded facts with a public description, sentence conditions as they are; confirmed and started ones left out', () => {
  const v = vols({ 全部: [{ 事实: 'F_letter' }, '主角答应帮老韩找儿子'] });
  const lines = C.olLines(v);
  const ls = C.olLineStates(lines, { slots: {} }, []);
  const items = C.olPendingFacts(lines, ls, { slots: {} }, [], {}, { labels: { F_letter: { label: '信', criterion: '主角读到叶莲娜的信时登记' } } });
  same(items.map((x) => [x.id, x.text]), [['F_letter', '主角读到叶莲娜的信时登记'], ['句：主角答应帮老韩找儿子', '主角答应帮老韩找儿子']]);
  // without a label the line's start-time text is the description
  same(C.olPendingFacts(lines, ls, { slots: {} }, [], {}).map((x) => x.text)[0], '（S01的开启时机）收到叶莲娜的信以后');
  // confirmed by an earlier check: not asked again
  const prog = { slots: {}, olOps: { ops: [{ kind: 'fact', target: 'F_letter', value: 'confirmed', at: { i: -1 } }] } };
  same(C.olPendingFacts(lines, C.olLineStates(lines, prog, []), prog, [], {}).map((x) => x.id), ['句：主角答应帮老韩找儿子']);
  // at most `limit` per check, rotating
  const many = Array.from({ length: 12 }, (_, i) => ({ 事实: `F${i}` }));
  const v2 = vols({ 全部: many });
  const l2 = C.olLines(v2), s2 = C.olLineStates(l2, { slots: {} }, []);
  const labels = Object.fromEntries(many.map((_, i) => [`F${i}`, { criterion: `第${i}件事` }]));
  const a = C.olPendingFacts(l2, s2, { slots: {} }, [], {}, { labels, turn: 0 }), b = C.olPendingFacts(l2, s2, { slots: {} }, [], {}, { labels, turn: 1 });
  same([a.length, b.length], [10, 10]);
  assert.ok(b.some((x) => !a.find((y) => y.id === x.id)), 'the next check asks the ones left over');
});

async function setup(open) {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('多线');
  inst.data.updateProject(p.id, (x) => ({ ...x, setting: { ...x.setting, text: '设定' }, outline: { volumes: vols(open) }, clue: { ...x.clue, labels: { F_letter: { label: '信', criterion: '主角读到叶莲娜的信时登记' } } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  const s01 = () => inst.runtime.olInfo().ls.find((s) => s.line.id === 'S01');
  return { host, inst, s01 };
}

test('a fact condition without a table: waits for the check; the check confirms it on its floor → S01 can start; deleting that floor undoes it', async () => {
  const { host, inst, s01 } = await setup({ 事实: 'F_letter' });
  same([s01().state, s01().why], ['未触发', 'F_letter，等待检测确认']);
  host.addMessage({ is_user: true, mes: '一' });
  host.addMessage({ is_user: false, mes: '邮差递来叶莲娜的信，你拆开读了。' });
  host.llm.reply = '{"done":[],"stageDone":false,"offTrack":false,"reason":"x","facts":[{"id":"F_letter","floor":1}]}';
  await inst.runtime.checkNow({ manual: true });
  const req = host.llmCalls.at(-1).body;
  assert.match(req, /【待确认的事】/);
  assert.match(req, /F_letter：主角读到叶莲娜的信时登记/);
  assert.equal(s01().state, '可开启');
  // the floor the check pointed at is regenerated: the confirmation goes with it
  host.state.chat[1] = { ...host.state.chat[1], send_date: 'regen' };
  assert.equal(s01().state, '未触发');
  await inst.destroy();
});

test('a sentence condition goes to the check as written; a hit that was never asked is ignored', async () => {
  const { host, inst, s01 } = await setup('主角答应帮老韩找儿子');
  assert.equal(s01().state, '未触发');
  assert.match(s01().why, /主角答应帮老韩找儿子，等待检测确认/);
  host.addMessage({ is_user: true, mes: '一' });
  host.addMessage({ is_user: false, mes: '你点头：“好，我帮你找。”' });
  host.llm.reply = '{"done":[],"stageDone":false,"offTrack":false,"reason":"x","facts":[{"id":"句：主角答应帮老韩找儿子","floor":1},{"id":"F_made_up","floor":1}]}';
  await inst.runtime.checkNow({ manual: true });
  assert.equal(s01().state, '可开启');
  const ops = JSON.stringify(inst.runtime.progress().olOps);
  assert.ok(!/F_made_up/.test(ops), 'only facts that were sent can be confirmed');
  await inst.destroy();
});

test('the confirmation sits on the floor the check names (regenerating a later floor keeps it); facts with no public description are not sent', async () => {
  const { host, inst, s01 } = await setup({ 事实: 'F_letter' });
  host.addMessage({ is_user: true, mes: '一' });
  host.addMessage({ is_user: false, mes: '你拆开叶莲娜的信读了。' });
  host.addMessage({ is_user: true, mes: '二' });
  host.addMessage({ is_user: false, mes: '你去了当铺。' });
  host.llm.reply = '{"done":[],"stageDone":false,"offTrack":false,"reason":"x","facts":[{"id":"F_letter","floor":1}]}';
  await inst.runtime.checkNow({ manual: true });
  assert.equal(s01().state, '可开启');
  host.state.chat[3] = { ...host.state.chat[3], send_date: 'regen' };
  assert.equal(s01().state, '可开启', 'anchored on floor 1, not on the last floor');
  await inst.destroy();
  // no label, no discovery record, no start-time text: nothing to describe it with → not asked
  const bare = vols({ 事实: 'F_secret' });
  delete bare[1].line.开始时机原文;
  const lines = C.olLines(bare);
  same(C.olPendingFacts(lines, C.olLineStates(lines, { slots: {} }, []), { slots: {} }, [], {}), []);
});
