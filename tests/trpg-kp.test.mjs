// 跑团 KP（core/trpg-kp.js）行为测试。样本自造。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import * as K from '../src/core/trpg-kp.js';

const C = loadCore();
const VOLS = [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's1', key: '阶段一_x', data: { 主线节点: [
  { id: 'nA', 名称: '搜书房', 入口: '去书房', 地点: '书房', 发现: [{ 事实: 'F01', 内容: '抽屉里有一把钥匙', 判定: { 技能: '侦查', 失败: '什么也没找到' } }], 完成条件: { 事实: 'F01' } },
] } }] }];

function setup() {
  const compiled = C.compileClue(VOLS);
  const snap = { facts: new Map(), knowledge: [], tables: {}, problems: [] };
  const prog = C.emptyClueProgress();
  const state = C.computeClueState(compiled, snap, prog, C.normalizeClue({ mode: 'clue' }));
  return { compiled, snap, prog, state };
}

test('kp: 判定失败且没补救时体检提示主线卡住，补救成功后恢复', () => {
  const { snap, prog, state } = setup();
  const fail = { F01: { ok: !1, tier: '失败', die: 90, value: 60, skill: '侦查' } };
  let r = K.trpgHealth({ volumes: VOLS, state, snap, prog, checks: fail });
  assert.equal(r.level, 'bad');
  assert.ok(r.spoil.some((t) => t.includes('F01')));
  r = K.trpgHealth({ volumes: VOLS, state, snap, prog, checks: { ...fail, 'F01-KP': { ok: !0, tier: '成功', skill: '灵感' } } });
  assert.notEqual(r.level, 'bad');
});

test('kp: 推一把选中焦点节点未获得的发现', () => {
  const { snap, prog, state } = setup();
  const t = K.kpPushTarget(state, snap, prog);
  assert.equal(t && t.fact, 'F01');
});

test('kp: 暗示不写内容，直接给写内容，补救检定按结果分支', () => {
  const { snap, prog, state } = setup();
  const t = K.kpPushTarget(state, snap, prog), st = { tagName: '剧情参考' };
  const s1 = K.kpPushLines({ fact: 'F01', level: 1 }, t.discovery, t.node, null, st);
  assert.ok(!s1.reveal && !s1.lines.join('').includes('抽屉里有一把钥匙'));
  const s3 = K.kpPushLines({ fact: 'F01', level: 3 }, t.discovery, t.node, null, st);
  assert.ok(s3.reveal && s3.lines.join('').includes('抽屉里有一把钥匙'));
  const ok = K.kpPushLines({ fact: 'F01', level: 2 }, t.discovery, t.node, { 'F01-KP': { ok: !0, tier: '成功', skill: '灵感' } }, st);
  const no = K.kpPushLines({ fact: 'F01', level: 2 }, t.discovery, t.node, { 'F01-KP': { ok: !1, tier: '失败', skill: '灵感' } }, st);
  assert.ok(ok.reveal && !no.reveal);
});

test('kp: 推一把只在楼数对得上时并进投影，揭示时登记候选', () => {
  const { snap, prog, state } = setup();
  const base = () => ({ content: '', used: { candidates: [] } });
  const args = { state, snap, prog, checks: {}, settings: { tagName: '剧情参考' }, push: { fact: 'F01', level: 3, floor: 2 } };
  let out = K.kpInject(base(), { ...args, floors: 2 });
  assert.ok(out.content.startsWith('<剧情参考>') && out.content.endsWith('</剧情参考>'));
  assert.equal(out.used.candidates[0].fact, 'F01');
  out = K.kpInject(base(), { ...args, floors: 3 });
  assert.equal(out.content, '');
});

test('kp: 取NPC小节正文，IGS 结果转成人话', () => {
  const text = 'KP规则:\n（说明）\n【时间线】\n- 8点 开门\n【NPC与敌人数据】\n- 老张 STR 50 HP 10\n- 食尸鬼 HP 12\n【结局条件】\n- 逃出去';
  assert.equal(K.kpSectionText(text, 'NPC与敌人数据'), '老张 STR 50 HP 10\n食尸鬼 HP 12');
  assert.equal(K.kpSectionText(text, '预设调查员'), '');
  assert.equal(K.npcImportMessage({ ok: !0, created: ['老张', '食尸鬼'], skipped: [{ name: '路人', reason: '没有数值' }] }), '已建立2个NPC档：老张、食尸鬼。跳过：路人（没有数值）。');
  assert.equal(K.npcImportMessage({ ok: !1, reason: 'ruleset' }), 'IGS的数值规则不是CoC第七版。');
  assert.equal(K.npcImportMessage({ ok: !1, reason: 'no-model' }), 'IGS没有配置可用的模型。');
  assert.equal(K.npcImportMessage({ ok: !1, reason: '超时' }), '失败：超时');
});
