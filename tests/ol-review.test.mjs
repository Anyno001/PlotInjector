// GPT 总体审阅（2026-11-22）对第 5 批按线推进的 11 条反例；每条在修之前都会失败。
import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { BINDING_YAML } from '../templates/clue-tables/build-template.mjs';

const tick = () => new Promise((r) => setTimeout(r, 20));
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const st = (id, key, mark, extra = {}) => ({ id, key, data: { AI指令: `${mark}的指令`, 主线节点: [{ id: `${id}n`, 名称: `${mark}节点`, 事件: `${mark}事件。` }], ...extra } });
const vols = (m1 = null) => [
  { id: 'vM1', key: '剧情_卷1_雾港', line: { 编号: 'M1', 类型: '主线' }, stages: m1 || [st('a1', '阶段1_灯', 'A1'), st('a2', '阶段2_当铺', 'A2', { 状态变化: ['未来事实标记_掌柜已死亡'] })] },
  { id: 'vM2', key: '剧情_卷2_码头', line: { 编号: 'M2', 类型: '主线', 接上一条: true }, stages: [st('b1', '阶段1_样品', 'B1')] },
  { id: 'vS1', key: '剧情_卷3_景点', line: { 编号: 'S01', 类型: '支线' }, stages: [st('c1', '阶段1_景点', 'C1')] },
];

async function setup(v = vols(), extra = {}) {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('多线');
  inst.data.updateProject(p.id, (x) => ({ ...x, setting: { ...x.setting, text: '设定' }, outline: { volumes: v }, ...extra }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  const text = () => inst.runtime.entries().map((e) => e.content).join('\n');
  const ls = () => inst.runtime.olInfo().ls.map((s) => [s.line.id, s.state]);
  return { host, inst, pid: p.id, text, ls };
}

test('1: an early 标记完成 does not send the state changes of stages never played; a natural finish does', async () => {
  const a = await setup();
  a.inst.runtime.olAct('M1', 'done');
  same(a.ls().slice(0, 2), [['M1', '完成'], ['M2', '进行中']], '接上一条 still fires');
  assert.ok(!/掌柜已死亡/.test(a.text()), 'stage 2 never happened');
  await a.inst.destroy();
  const b = await setup();
  b.inst.runtime.openNext(); b.inst.runtime.openNext();
  same(b.ls().slice(0, 2), [['M1', '完成'], ['M2', '进行中']]);
  assert.match(b.text(), /掌柜已死亡/, 'played to the end: the last stage counts');
  await b.inst.destroy();
});

test('2: a persona following the outline does not jump ahead when another line starts; a stage reached and then paused is kept', async () => {
  const persona = { id: 'p', name: '人', mode: 'outline', constant: true, enabled: true, stages: [{ id: 'ps1', name: '初识', unitId: 'a1', text: 'PERSONA_FIRST' }, { id: 'ps2', name: '信任', unitId: 'a2', text: 'PERSONA_FUTURE' }] };
  const { inst, text } = await setup(vols(), { personas: { lines: [persona] } });
  assert.match(text(), /PERSONA_FIRST/);
  inst.runtime.olAct('S01', 'start');
  assert.match(text(), /PERSONA_FIRST/, 'M1 never reached stage 2');
  assert.ok(!/PERSONA_FUTURE/.test(text()));
  inst.runtime.olAct('M1', 'resume'); inst.runtime.openNext();
  inst.runtime.olAct('S01', 'resume');
  assert.match(text(), /PERSONA_FUTURE/, 'stage 2 was reached before pausing');
  await inst.destroy();
});

test('3: a stage hand-marked 进行中 on a line that gets paused is not injected', async () => {
  const { inst } = await setup();
  inst.runtime.setProgress({ ...inst.runtime.progress(), slots: { ...inst.runtime.progress().slots, a1: { state: 'active' } } });
  inst.runtime.olAct('S01', 'start');
  same(inst.runtime.entries().filter((e) => e.kind === 'detail').map((e) => e.slotId), ['c1']);
  assert.equal(inst.runtime.progress().slots.a1.state, 'active', 'the mark is kept for later');
  await inst.destroy();
});

test('4: hooks and clocks of a paused line stay out of injection and the check; an empty check does not expire them', async () => {
  const m1 = [
    st('a1', '阶段1_灯', 'A1', { 支线事件: [{ 名称: '酒馆密谈', 事件: '有人约主角密谈。', 条件: '主角到过酒馆', 时限: '本卷', 错过: '港口联络人永久离城' }], 世界动态: [{ 类型: '叛军逼近', 进度钟: 4, 前兆: '城外传来烽火', 后果: '城门被攻破', 内容: '叛军攻城' }] }),
    st('a2', '阶段2_当铺', 'A2'),
  ];
  const { host, inst, text } = await setup(vols(m1));
  inst.runtime.openNext();
  const key = 'a1:s0';
  inst.runtime.setProgress({ ...inst.runtime.progress(), threads: { hooks: { [key]: { name: '酒馆密谈', at: 1 } }, clocks: { 'a1:w0': { name: '叛军逼近', filled: 2 } } } });
  inst.runtime.olAct('S01', 'start');
  assert.ok(!/有人约主角密谈|城外传来烽火/.test(text()), 'paused line materials not in the story');
  host.addMessage({ is_user: true, mes: '一' }); host.addMessage({ is_user: false, mes: '景点。' });
  host.llm.reply = '{"done":[],"stageDone":false,"offTrack":false,"reason":"x"}';
  await inst.runtime.checkNow({ manual: true });
  assert.ok(!/酒馆密谈/.test(host.llmCalls.at(-1).body), 'not in the check');
  assert.ok(!/\\"hooks\\"|【支线钩子】/.test(host.llmCalls.at(-1).body), 'no hook rules for a line that has none');
  const hook = inst.runtime.progress().threads.hooks[key];
  assert.ok(!hook.expired, 'switching lines does not end M1');
  assert.ok(!/港口联络人永久离城/.test(text()));
  await inst.destroy();
});

test('5: a check started before switching lines does not move the new line', async () => {
  const { host, inst, ls } = await setup();
  host.addMessage({ is_user: true, mes: '一' }); host.addMessage({ is_user: false, mes: '回' });
  inst.data.updateSettings({ handleMode: 'auto' });
  let release;
  host.llm.respond = () => new Promise((r) => (release = r));
  const p = inst.runtime.checkNow({ manual: true });
  await tick();
  inst.runtime.olAct('S01', 'start');
  release('{"done":["A1节点"],"stageDone":true,"offTrack":false,"reason":"x"}');
  await p; await tick();
  same(ls()[2], ['S01', '进行中'], 'S01 not finished by an old M1 result');
  assert.equal(inst.runtime.progress().current, 'c1');
  await inst.destroy();
});

test('6: 撤销 on an automatic finish returns to the last stage of the old line and undoes the follow-up start', async () => {
  const { host, inst, ls } = await setup();
  inst.runtime.openNext();
  inst.data.updateSettings({ handleMode: 'auto' });
  inst.runtime.setProgress({ ...inst.runtime.progress(), slots: { ...inst.runtime.progress().slots, a2: { off: ['m0'] } } });
  host.addMessage({ is_user: true, mes: '一' }); host.addMessage({ is_user: false, mes: '回' });
  host.llm.reply = '{"done":[],"stageDone":true,"offTrack":false,"reason":"演完"}';
  await inst.runtime.checkNow({ manual: true }); await tick();
  same(ls().slice(0, 2), [['M1', '完成'], ['M2', '进行中']]);
  const card = host.w.document.querySelector('[data-notice="advance"]');
  [...card.querySelectorAll('[data-act]')].find((b) => /撤销/.test(b.textContent)).click(); await tick();
  same(ls().slice(0, 2), [['M1', '进行中'], ['M2', '未触发']]);
  assert.equal(inst.runtime.progress().current, 'a2');
  same(inst.runtime.progress().slots.a2.off, ['m0'], 'node marks kept');
  await inst.destroy();
});

test('7: a switch undone by regenerating its floor: 打开下一段 continues from the restored stage', async () => {
  const m1 = [st('a1', '阶段1_灯', 'A1'), st('a2', '阶段2_当铺', 'A2'), st('a3', '阶段3_仓库', 'A3')];
  const { host, inst } = await setup(vols(m1));
  inst.runtime.openNext();
  host.addMessage({ is_user: true, mes: '一' }); host.addMessage({ is_user: false, mes: '回' });
  inst.runtime.olAct('S01', 'start');
  host.state.chat[1] = { ...host.state.chat[1], send_date: 'regen' };
  await host.eventSource.emit(host.eventTypes.MESSAGE_SWIPED, 1); await tick();
  inst.runtime.openNext();
  assert.equal(inst.runtime.progress().current, 'a3');
  await inst.destroy();
});

test('8: merging the stage a paused line stopped on: 继续 lands on the merged stage, not on stage 1', async () => {
  const m1 = [st('a1', '阶段1_灯', 'A1'), st('a2', '阶段2_当铺', 'A2'), st('a3', '阶段3_仓库', 'A3')];
  const { inst, pid } = await setup(vols(m1));
  inst.runtime.openNext(); inst.runtime.openNext();
  inst.runtime.olAct('S01', 'start');
  inst.data.updateProject(pid, (x) => ({ ...x, outline: { ...x.outline, volumes: x.outline.volumes.map((v) => (v.id === 'vM1' ? { ...v, stages: v.stages.filter((s) => s.id !== 'a3') } : v)), idAlias: { a3: 'a2' } } }));
  inst.runtime.olAct('M1', 'resume');
  assert.equal(inst.runtime.progress().current, 'a2');
  await inst.destroy();
});

test('10: in outline mode an opening window may point at any line (type is ignored)', async () => {
  const v = vols();
  v.push({ id: 'vS2', key: '剧情_卷4_电影院', line: { 编号: 'S02', 类型: '支线', 开启时段: { 主线: 'S01', 从: '阶段1_景点', 到: '阶段1_景点' } }, stages: [st('d1', '阶段1_放映厅', 'D1')] });
  const { inst, ls } = await setup(v);
  inst.runtime.olAct('S01', 'start');
  same(ls()[3], ['S02', '可开启']);
  await inst.destroy();
});

test('11: a line opened by the first manual check after entering the chat gets its top-bar notice once', async () => {
  const v = vols();
  v[2].line.开启条件 = { 事实: 'F_letter' };
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('多线');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: v }, clue: { ...x.clue, labels: { F_letter: { label: '信', criterion: '主角读到信时登记' } } } }));
  host.state.chat.push({ is_user: true, mes: '一', send_date: 'a0' }, { is_user: false, mes: '你读了叶莲娜的信。', send_date: 'a1', swipe_id: 0 });
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  host.llm.reply = '{"done":[],"stageDone":false,"offTrack":false,"reason":"x","facts":[{"id":"F_letter","floor":1}]}';
  await inst.runtime.checkNow({ manual: true }); await tick();
  const bar = host.w.document.querySelector('.pi-topbar');
  assert.ok(bar && /S01 景点可以开始了/.test(bar.textContent), bar && bar.textContent);
  await inst.destroy();
});

test('9: SQLite void of a collapsed fact whose clearing record cannot be confirmed is not reported as ok', async () => {
  const FACT_HEAD = [null, '编号', '标签', '登记口径', '状态', '内容', '依据'];
  const KNOW_HEAD = [null, '键', '事实', '角色', '获知方式', '可信度', '依据'];
  const fill = (keys) => ({ TavernDB_ACU_IsolatedData: { '': { storageFrame: { version: 2, logEntries: [{ seq: 1, source: 'auto_fill', filledSheetKeys: keys }] } } } });
  const node = (id, facts) => ({ id, 名称: id, 入口: `去${id}`, 发现: facts.map((f) => ({ 事实: f, 内容: `${f}的内容`, 记录: `看到${f}时登记` })), 完成条件: { 事实: facts[0] } });
  const cv = [
    { id: 'vM1', key: '剧情_M1_x', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 'sM1', key: '阶段1_x', data: { 主线节点: [node('a', ['F1'])] } }] },
  ];
  const host = createHost({ tables: { sheet_f: { name: '关键事实表', content: [FACT_HEAD, [1, 'F1', '', '', '已核实', '', '']] }, sheet_k: { name: '知情表', content: [KNOW_HEAD, [1, 'F1@user', 'F1', 'user', '亲见', '已核实', '']] } } });
  host.ctx.extensionSettings = { __userscripts: { shujuku_v120__userscript_settings_v1: { shujuku_v120_globalMeta_v1: JSON.stringify({ activeIsolationCode: '' }) } } };
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('收起');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: cv }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML) } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  host.state.chat.push({ is_user: true, mes: '一', send_date: 'a0' }, { is_user: false, mes: '回', send_date: 'a1', swipe_id: 0, ...fill(['sheet_f', 'sheet_k']) });
  inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines();
  const r0 = await inst.runtime.clue.foldCollapse(['M1'], { manual: true });
  assert.equal(r0.rows, 2);
  host.state.saveFails = true;
  const r = await inst.runtime.clue.voidFact('F1');
  assert.notEqual(r.table, 'ok', JSON.stringify(r));
  await inst.destroy();
});
