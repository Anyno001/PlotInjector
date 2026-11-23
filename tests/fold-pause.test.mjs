// 大型项目第 4 批：单条暂停满 3 个有效回合收起（方案 三.8；原为 10，用户改成 3）。
import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';
import { BINDING_YAML } from '../templates/clue-tables/build-template.mjs';

const C = loadCore();
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const node = (id, facts, extra = {}) => ({ id, 名称: id, 入口: `去${id}`, 地点: id, 发现: facts.map((f) => ({ 事实: f, 内容: `${f}的内容`, 记录: `看到${f}时登记` })), 完成条件: { 事实: facts[0] }, ...extra });
const vol = (id, kind, nodes, line = {}) => ({ id: `v${id}`, key: `剧情_${id}_x`, line: { 编号: id, 类型: kind, ...line }, stages: [{ id: `s${id}`, key: '阶段1_x', data: { 主线节点: nodes } }] });
const FACT_HEAD = [null, '编号', '标签', '登记口径', '状态', '内容', '依据'];
const KNOW_HEAD = [null, '键', '事实', '角色', '获知方式', '可信度', '依据'];
const fill = (keys) => ({ TavernDB_ACU_IsolatedData: { '': { storageFrame: { version: 2, logEntries: [{ seq: 1, source: 'auto_fill', filledSheetKeys: keys }] } } } });

// ---------- 有效回合 ----------
const msg = (i, user = false) => ({ is_user: user, mes: String(i), send_date: `d${i}`, swipe_id: 0 });
const at = (i) => ({ i, swipe: 0, stamp: `d${i}` });
const chatOf = (n) => Array.from({ length: n }, (_, i) => msg(i, i % 2 === 0));

test('pauseRounds: AI replies after the single pause, each floor once; floors under a global pause do not count', () => {
  const S1 = { id: 'S1', kind: 'side' };
  const pause = { kind: 'line', target: 'S1', value: 'pause', at: at(1) };
  const chat = chatOf(12); // AI floors 1,3,5,7,9,11
  same(C.pauseRounds([pause], chat, S1), { rounds: 5, floor: 7 }, 'floors 3,5,7,9,11; the 3rd is floor 7');
  // 暂停全部支线 from floor 4 to floor 6: floor 5 does not count
  const ops = [pause, { kind: 'pause', target: 'side', value: true, at: at(4) }, { kind: 'pause', target: 'side', value: '', at: at(6) }];
  same(C.pauseRounds(ops, chat, S1), { rounds: 4, floor: 9 });
  // GPT 审阅 2：只点「继续剧情」不解除仍生效的「暂停全部支线」
  const mixed = [pause, { kind: 'pause', target: 'side', value: true, at: at(2) }, { kind: 'pause', target: 'main', value: true, at: at(4) }, { kind: 'pause', target: 'main', value: '', at: at(6) }];
  same(C.pauseRounds(mixed, chatOf(12), S1).rounds, 0, 'still under 暂停全部支线');
  same(C.pauseRounds([...mixed, { kind: 'pause', target: 'side', value: '', at: at(12) }], chatOf(18), S1), { rounds: 3, floor: 17 }, 'counts again after 继续全部支线');
  // a pause of all main lines does not affect a side line
  same(C.pauseRounds([pause, { kind: 'pause', target: 'mains', value: true, at: at(2) }], chat, S1).rounds, 5);
  // 暂停全部剧情 counts against every line
  same(C.pauseRounds([pause, { kind: 'pause', target: 'main', value: true, at: at(2) }], chat, S1).rounds, 0);
  // resumed afterwards: not paused any more
  same(C.pauseRounds([pause, { kind: 'line', target: 'S1', value: 'resume', at: at(5) }], chat, S1).rounds, 0);
  // the pause floor was regenerated: the pause no longer exists on this branch
  same(C.pauseRounds([{ ...pause, at: { ...at(1), stamp: 'old' } }], chat, S1).rounds, 0);
  // deleting a reply lowers the count
  same(C.pauseRounds([pause], chat.slice(0, 8), S1), { rounds: 3, floor: 7 });
  same(C.pauseRounds([pause], chat.slice(0, 6), S1), { rounds: 2, floor: -1 });
});

test("foldPlan: a paused line's own references do not block it; another unfinished line reading its fact does", () => {
  const vols = [
    vol('M1', '主线', [node('a', ['F1'], { 相关事实: ['F6'] })]),
    vol('S1', '支线', [node('b', ['F5', 'F6'], { 完成条件: { 事实: 'F5' } })]),
  ];
  const plan = C.foldPlan(C.compileClue(vols), [{ line: { id: 'M1' }, state: '进行中' }, { line: { id: 'S1' }, state: '暂停' }], { paused: new Set(['S1']) });
  same(plan.map((x) => [x.line.id, x.facts, x.kept.map((k) => k.fact)]), [['S1', ['F5'], ['F6']]], 'F5 (read only by S1 itself) can go; F6 is read by M1');
  same(C.foldPlan(C.compileClue(vols), [{ line: { id: 'S1' }, state: '暂停' }]).length, 0, 'not ready yet: nothing');
});

// ---------- 执行页：暂停 → 收起 → 继续 → 恢复 ----------
async function setup() {
  const vols = [vol('M1', '主线', [node('a', ['F1'])]), vol('S1', '支线', [node('b', ['F5'])])];
  const tables = {
    sheet_ctrl: { name: '线索控制表', content: [[null, '标识', '当前场景', '场景目录'], [1, '主线', '', '']] },
    sheet_f: { name: '关键事实表', content: [FACT_HEAD, [1, 'F1', '', '', '未获得', '', ''], [2, 'F5', '旧仓库', '进仓库时登记', '未获得', '', '']] },
    sheet_k: { name: '知情表', content: [KNOW_HEAD, [1, 'F5@user', 'F5', 'user', '未知', '未核实', '']] },
  };
  const host = createHost({ tables });
  host.ctx.extensionSettings = { __userscripts: { shujuku_v120__userscript_settings_v1: { shujuku_v120_globalMeta_v1: JSON.stringify({ activeIsolationCode: '' }) } } };
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('暂停');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML), labels: { F5: { label: '旧仓库', criterion: '进仓库时登记' } } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  let n = 0;
  const round = async () => {
    host.state.chat.push({ is_user: true, mes: 'u', send_date: `u${n}` }, { is_user: false, mes: 'a', send_date: `a${n}`, swipe_id: 0, ...fill(['sheet_f', 'sheet_k']) });
    n++;
    inst.runtime.clue.invalidate();
    await inst.runtime.clue.syncLines();
  };
  await round();
  const s1 = () => inst.runtime.clue.foldCheck().lines.find((x) => x.id === 'S1');
  const codes = () => host.w.AutoCardUpdaterAPI.exportTableAsJson().sheet_f.content.slice(1).map((r) => r[1]);
  return { host, inst, round, s1, codes };
}

test('S1 paused: not foldable until 3 effective rounds; then a fill later it can be collapsed; 继续 restores it before discoveries are given', async () => {
  const { inst, round, s1, codes } = await setup();
  inst.runtime.clue.lineAct('S1', 'enter');
  inst.runtime.clue.lineAct('S1', 'pause');
  inst.runtime.clue.invalidate();
  assert.equal(s1(), undefined, 'paused just now: not a candidate');
  await round(); await round();
  assert.equal(s1(), undefined, '2 rounds');
  await round();
  let x = s1();
  same([x.state, x.rows, x.fill.ok], ['暂停', 2, false], 'ready after the 3rd round; waits for a later fill');
  await round();
  assert.equal(s1().fill.ok, true);
  const r = await inst.runtime.clue.foldCollapse(['S1'], { manual: true });
  assert.equal(r.rows, 2);
  same(codes(), ['F1'], 'F5 collapsed');
  // 继续: before the sync restores the rows, F5 is "not ready" (no discoveries for the story)
  inst.runtime.clue.lineAct('S1', 'resume');
  inst.runtime.clue.invalidate();
  assert.ok(inst.runtime.clue.compute().notReady.has('F5'), 'held until restored');
  await inst.runtime.clue.syncLines();
  inst.runtime.clue.invalidate();
  same(codes().sort(), ['F1', 'F5'], 'restored by the sync');
  assert.ok(!inst.runtime.clue.compute().notReady.has('F5'), 'ready again');
  assert.equal(inst.runtime.clue.compute().state.lineStates.find((s) => s.line.id === 'S1').state, '进行中', 'progress kept');
  await inst.destroy();
});

test('global pauses do not start the count and their floors are not counted', async () => {
  const { inst, round, s1 } = await setup();
  inst.runtime.clue.lineAct('S1', 'enter');
  inst.runtime.clue.setPaused(true, 'side');
  await round(); await round(); await round(); await round();
  assert.equal(s1(), undefined, '暂停全部支线 alone never collapses a line');
  inst.runtime.clue.lineAct('S1', 'pause');
  await round(); await round();
  inst.runtime.clue.invalidate();
  assert.equal(s1(), undefined, 'still under the global pause: rounds do not count');
  inst.runtime.clue.setPaused(false, 'side');
  await round(); await round(); await round();
  assert.equal(s1().state, '暂停', '3 rounds after the global pause ended');
  await inst.destroy();
});
