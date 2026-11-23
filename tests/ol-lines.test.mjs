// 大型项目第 5 批 5a：大纲推进按线（方案 五）。几条线预先写好，按条件分别开始，同一时间只演一条。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';

const tick = () => new Promise((r) => setTimeout(r, 20));
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const st = (id, key, mark) => ({ id, key, data: { AI指令: `${mark}的指令`, 主线节点: [{ id: `${id}n`, 名称: `${mark}节点`, 事件: `${mark}事件。` }], 支线事件: [{ 名称: `${mark}可选`, 事件: `${mark}可选事件。` }] } });
const vols = () => [
  { id: 'vM1', key: '剧情_卷1_雾港', line: { 编号: 'M1', 类型: '主线', 简介: '旧案' }, stages: [st('a1', '阶段1_灯', 'A1'), st('a2', '阶段2_当铺', 'A2')] },
  { id: 'vM2', key: '剧情_卷2_码头', line: { 编号: 'M2', 类型: '主线', 接上一条: true }, stages: [st('b1', '阶段1_样品', 'B1')] },
  { id: 'vS1', key: '剧情_卷3_景点', line: { 编号: 'S01', 类型: '支线', 开启条件: { 线: 'M1 == 进行中' } }, stages: [st('c1', '阶段1_景点', 'C1')] },
];

async function setup(v = vols(), { progress = null } = {}) {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('多线');
  inst.data.updateProject(p.id, (x) => ({ ...x, setting: { ...x.setting, text: '设定' }, outline: { volumes: v } }));
  if (progress) host.state.chatMetadata.plotInjector = { projectId: p.id, byProject: { [p.id]: { projectId: p.id, slots: {}, muted: [], offMuted: [], lastCheckFloor: 0, pace: 'normal', ...progress } } };
  // 老聊天自己绑着项目：打开聊天时迁移（和真实顺序一样）；新聊天先绑定项目
  progress || (await inst.runtime.switchProject(p.id));
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  const text = () => inst.runtime.entries().map((e) => e.content).join('\n');
  const states = () => inst.runtime.olInfo().ls.map((s) => [s.line.id, s.state]);
  return { host, inst, pid: p.id, text, states };
}

test('a book without 线: heads is unchanged: no by-line view, the same entries as before', async () => {
  const old = vols().map(({ line, ...v }) => v);
  const { inst, text } = await setup(old);
  assert.equal(inst.runtime.olInfo(), null);
  assert.match(text(), /A1的指令/);
  inst.runtime.openNext(); inst.runtime.openNext();
  assert.match(text(), /B1的指令/, 'sequential across volumes as before');
  await inst.destroy();
});

test('new chat: the first line starts by itself; only its stage is injected; S01 can start while M1 runs', async () => {
  const { inst, text, states } = await setup();
  same(states(), [['M1', '进行中'], ['M2', '未触发'], ['S01', '可开启']]);
  const t = text();
  assert.match(t, /A1的指令/);
  assert.ok(!/B1的指令|C1的指令/.test(t), 'other lines are not injected');
  await inst.destroy();
});

test('M1 last stage done → M1 完成, M2 (接上一条) starts and becomes the current stage; state changes of M1 still sent', async () => {
  const v = vols();
  v[0].stages[0].data.状态变化 = ['守卫允许主角进城'];
  const { inst, text, states } = await setup(v);
  inst.runtime.openNext();
  assert.equal(inst.runtime.progress().current, 'a2');
  inst.runtime.openNext();
  same(states(), [['M1', '完成'], ['M2', '进行中'], ['S01', '未触发']]);
  assert.equal(inst.runtime.progress().current, 'b1');
  assert.match(text(), /B1的指令/);
  assert.match(text(), /守卫允许主角进城/, 'done stages of finished lines keep their state changes');
  await inst.destroy();
});

test('start S01 while M1 runs: M1 pauses at its stage, S01 plays; 继续 M1 returns to the same stage with its node marks', async () => {
  const { inst, text, states } = await setup();
  inst.runtime.openNext();
  inst.runtime.setProgress({ ...inst.runtime.progress(), slots: { ...inst.runtime.progress().slots, a2: { off: ['m0'] } } });
  inst.runtime.olAct('S01', 'start');
  same(states(), [['M1', '暂停'], ['M2', '未触发'], ['S01', '进行中']]);
  assert.equal(inst.runtime.progress().current, 'c1');
  assert.match(text(), /C1的指令/);
  inst.runtime.olAct('M1', 'resume');
  same(states(), [['M1', '进行中'], ['M2', '未触发'], ['S01', '暂停']]);
  assert.equal(inst.runtime.progress().current, 'a2', 'back to the stage where M1 paused');
  same(inst.runtime.progress().slots.a2.off, ['m0'], 'node marks kept');
  await inst.destroy();
});

test('carried optional events and the check index only cover the current line; other lines get one line each', async () => {
  const { host, inst } = await setup();
  inst.runtime.openNext();
  host.llm.reply = '{"done":[],"stageDone":false,"offTrack":false,"reason":"x"}';
  host.addMessage({ is_user: true, mes: '一' }); host.addMessage({ is_user: false, mes: '回' });
  await inst.runtime.checkNow({ manual: true });
  const body = host.llmCalls.at(-1).body;
  assert.match(body, /A1可选/, 'carried from M1 stage 1');
  assert.ok(!/B1的指令|C1可选|样品/.test(body), 'other lines not in the index (not even their stage names)');
  assert.match(body, /【其他剧情线】[\s\S]*M2[\s\S]*未开始[\s\S]*S01[\s\S]*可开始/);
  await inst.destroy();
});

test('old chat already playing a 线: book: migrated once (earlier volumes 已过, current line continues), top bar offers 改回 → 按顺序', async () => {
  const { host, inst, text, states } = await setup(vols(), { progress: { current: 'b1' } });
  same(states(), [['M1', '已过'], ['M2', '进行中'], ['S01', '未触发']]);
  assert.match(text(), /B1的指令/);
  const bar = host.w.document.querySelector('.pi-topbar');
  assert.ok(bar && /本聊天已改为按剧情线推进：M2从第1段继续，前1卷标为已过/.test(bar.textContent), bar && bar.textContent);
  const act = bar.querySelector('.pi-topbar-act'); act.click(); act.click(); await tick();
  assert.equal(inst.runtime.progress().lineFlow, 'seq');
  assert.equal(inst.runtime.olInfo(), null, '按顺序: the whole book is one line again');
  await inst.destroy();
});

test('a start recorded on a floor is undone when that floor is deleted', async () => {
  const { host, inst, states } = await setup();
  host.addMessage({ is_user: true, mes: '一' }); host.addMessage({ is_user: false, mes: '回' });
  inst.runtime.olAct('S01', 'start');
  same(states()[2], ['S01', '进行中']);
  host.state.chat[1] = { ...host.state.chat[1], send_date: 'regen' };
  same(states(), [['M1', '进行中'], ['M2', '未触发'], ['S01', '可开启']], 'the start op is gone with its floor; M1 still running (its start sits on the same floor but auto-starts again)');
  await inst.destroy();
});

test('run page: line card tabs; the timeline shows only the current line; 按顺序推进 asks first', async () => {
  const { host, inst, pid } = await setup();
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${pid}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  same([...doc.querySelectorAll('[data-act="ol-line-tab"]')].map((b) => b.textContent), ['进行中 1', '未进行 2', '已结束 0']);
  same([...doc.querySelectorAll('.pi-tl-vol')].map((h) => h.textContent), ['M1 雾港'], 'timeline: current line only');
  assert.ok(!/主线|支线/.test(doc.querySelector('.pi-line-card').textContent), 'no main / side labels');
  doc.querySelector('[data-act="ol-line-tab"][data-tab="idle"]').click(); await tick();
  assert.match(doc.querySelector('[data-line-grp="idle"]').textContent, /S01[\s\S]*可开始/);
  doc.querySelector('[data-act="ol-flow"]').click(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  assert.match(dlg.textContent, /改为按顺序推进：从M1 第1段往后依次推进/);
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '按顺序').click(); await tick();
  assert.equal(inst.runtime.progress().lineFlow, 'seq');
  assert.equal(doc.querySelector('.pi-line-card'), null);
  assert.ok(doc.querySelector('[data-act="ol-flow"][data-flow="line"]'), '改回按线 offered');
  await inst.destroy();
});

test('carried optional events come only from the current line, not from a paused line', async () => {
  const { inst, text } = await setup();
  inst.runtime.openNext();
  assert.match(text(), /A1可选/, 'M1 stage 2 carries the optional event of M1 stage 1');
  inst.runtime.olAct('S01', 'start');
  assert.ok(!/A1可选/.test(text()), 'S01 runs: M1 stage 1 events are not carried');
  await inst.destroy();
});
