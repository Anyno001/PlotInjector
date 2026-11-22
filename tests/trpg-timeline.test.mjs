// 跑团防跑偏（core/trpg-timeline.js、trpg-kp.js 的主持口径 / 拉回 / 对照剧本解析）行为测试。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import * as K from '../src/core/trpg-kp.js';
import * as T from '../src/core/trpg-timeline.js';

const C = loadCore();
const SETTING = ['铁则:', '别剧透', '', 'KP规则:', '【时间线】', '- 22:00 教徒抵达仓库；如果玩家提前报警，改为封锁', '- 晚上11点半 仓库起火', '- 凌晨1点 警察赶到', '【机制与计量】', '- 临界值 3'].join('\n');
const VOLS = [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's1', key: '阶段一_x', data: { 主线节点: [{ id: 'nA', 名称: '搜书房', 入口: '去书房', 地点: '书房', 发现: [{ 事实: 'F01', 内容: '钥匙' }], 完成条件: { 事实: 'F01' } }] } }] }];

function setup() {
  const compiled = C.compileClue(VOLS), snap = { facts: new Map(), knowledge: [], tables: {}, problems: [] }, prog = C.emptyClueProgress();
  return { snap, prog, state: C.computeClueState(compiled, snap, prog, C.normalizeClue({ mode: 'clue' })) };
}

test('timeline: 解析钟点（含晚上/半/凌晨跨午夜），只读【时间线】小节', () => {
  const ev = T.parseTimeline(SETTING);
  assert.deepEqual(ev.map((e) => e.clock), ['22:00', '23:30', '01:00']);
  assert.ok(ev[2].minutes > ev[1].minutes && ev[0].text.startsWith('教徒抵达仓库'));
  assert.equal(T.readClock('2024年3月1日 星期五 21:45'), 21 * 60 + 45);
  assert.equal(T.readClock(['第一天', '下午3点半']), 15 * 60 + 30);
  assert.equal(T.readClock('不知道'), null);
});

test('timeline: 到点区间 (上次, 现在]，重掷同一楼不丢，没时间不注入', () => {
  const events = T.parseTimeline(SETTING), at = (h, m = 0) => h * 60 + m;
  let s = T.timelineStep({ events, now: at(22, 10), clock: { floor: 3, minutes: at(21, 0) }, floors: 4 });
  assert.ok(s.lines.join('').includes('教徒抵达仓库') && s.next.floor === 4 && s.next.from === at(21));
  s = T.timelineStep({ events, now: at(22, 10), clock: s.next, floors: 4 });
  assert.ok(s.lines.join('').includes('教徒抵达仓库') && s.next === null);
  assert.deepEqual(T.timelineStep({ events, now: at(22, 30), clock: { floor: 4, minutes: at(22, 10), from: at(22, 10) }, floors: 5 }).lines, []);
  assert.deepEqual(T.timelineStep({ events, now: null, clock: { floor: 3, minutes: 0 }, floors: 4 }).lines, []);
  s = T.timelineStep({ events, now: at(1, 10), clock: { floor: 5, minutes: at(23, 20) }, floors: 6 });
  assert.ok(s.lines.join('').includes('警察赶到'));
});

test('kp: 每轮带主持口径；投影为空但有入口时自己包标签并列出入口', () => {
  const { snap, prog, state } = setup(), base = (content) => ({ content, used: { candidates: [] } }), args = { state, snap, prog, checks: {}, settings: { tagName: '剧情参考' }, floors: 1 };
  let out = K.kpInject(base('<剧情参考>\n场景\n</剧情参考>'), args);
  assert.ok(out.content.includes(K.KP_HOST_RULE) && out.content.endsWith('</剧情参考>'));
  out = K.kpInject(base(''), { ...args, state: { ...state, nodeStates: [{ status: 'available', node: { uid: 'u1', item: { 入口: '去书房' } } }] } });
  assert.ok(out.content.startsWith('<剧情参考>') && out.content.includes('- 去书房') && out.content.includes(K.KP_HOST_RULE));
});

test('kp: 拉回只在楼数对得上时注入；时间线到点并进同一段', () => {
  const { snap, prog, state } = setup(), base = () => ({ content: '<剧情参考>\nx\n</剧情参考>', used: { candidates: [] } });
  const args = { state, snap, prog, checks: {}, settings: { tagName: '剧情参考' }, push: { kind: 'steer', text: '让守卫出现并问话', floor: 2 } };
  assert.ok(K.kpInject(base(), { ...args, floors: 2 }).content.includes('KP 拉回（只管这一轮）：让守卫出现并问话'));
  assert.ok(!K.kpInject(base(), { ...args, floors: 3 }).content.includes('KP 拉回'));
  let written = null;
  const out = K.kpInject(base(), { ...args, floors: 3, push: null, timeline: { events: T.parseTimeline(SETTING), now: 22 * 60 + 5, clock: { floor: 2, minutes: 21 * 60 }, onClock: (n) => (written = n) } });
  assert.ok(out.content.includes('模组时间线：现在 22:05') && written.floor === 3);
});

test('kp: 对照剧本回复解析（结论、不剧透、剧透、拉回建议）', () => {
  const r = K.parseSteerReply('结论：有点偏\n不剧透：\n- 编了模组外的人物\n- 跳过了场景\n剧透：\n- 凭空出现了管家，模组里没有\n拉回建议：\n让仓库门卫出现，\n引回书房。');
  assert.equal(r.verdict, '有点偏');
  assert.deepEqual(r.plain, ['编了模组外的人物', '跳过了场景']);
  assert.equal(r.spoil.length, 1);
  assert.equal(r.steer, '让仓库门卫出现，\n引回书房。');
  const ok = K.parseSteerReply('结论：跟着剧本\n不剧透：\n- 无\n剧透：\n- 无\n拉回建议：\n无');
  assert.equal(ok.verdict, '跟着剧本');
  assert.deepEqual([ok.plain, ok.spoil, ok.steer], [[], [], '']);
});
