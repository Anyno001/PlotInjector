// 线索建行与登记方案 二.2（2026-11-23）：普通线索项目按节点建行。
// 一条线开始时只建已开放节点的线索，再往前多建一层空行；前一步登记了，再往后建。跑团、中途开线索补登照旧按线整条建。
import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';
import { buildTemplate, BINDING_YAML } from '../templates/clue-tables/build-template.mjs';

const C = loadCore();
const node = (id, fact, extra = {}) => ({ id, 名称: id, 入口: `去${id}`, 地点: id, 发现: [{ 事实: fact, 内容: `${id}查到的`, 记录: `看到${id}时登记` }], 完成条件: { 事实: fact }, ...extra });
// M1 三个阶段一步接一步（A → B → C，C 是结局）；S2 是还没开始的支线（开线事件 F_call）
function volumes() {
  return [
    { id: 'vM1', key: '剧情_M1_街区', line: { 编号: 'M1', 类型: '主线' }, stages: [
      { id: 's1', key: '阶段1_甲', data: { 结束条件: { 事实: 'F_a' }, 主线节点: [node('n_a', 'F_a')] } },
      { id: 's2', key: '阶段2_乙', data: { 结束条件: { 事实: 'F_b' }, 主线节点: [node('n_b', 'F_b')] } },
      { id: 's3', key: '阶段3_结局', data: { 结束条件: { 事实: 'F_c' }, 主线节点: [node('n_c', 'F_c')] } },
    ] },
    { id: 'vS2', key: '剧情_S2_来电', line: { 编号: 'S2', 类型: '支线', 开启条件: { 事实: 'F_call' } }, stages: [
      { id: 'sS', key: '阶段1_来电', data: { 主线节点: [node('n_s2', 'F_s2')] } },
    ] },
  ];
}
const FB = [{ 表: '关键事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }];
const snapOf = (confirmed = []) => ({ facts: new Map(confirmed.map((c) => [c, { id: c, status: 'confirmed', raw: '已核实' }])), knowledge: [], tables: {}, problems: [] });
const scopeAt = (confirmed, opts) => {
  const compiled = C.compileClue(volumes()),
    prog = C.emptyClueProgress(),
    cfg = { mode: 'clue', bindings: { facts: FB, knowledge: [] } },
    state = C.computeClueState(compiled, snapOf(confirmed), prog, cfg),
    frontier = C.nodeFrontier(compiled, state, snapOf(confirmed), prog, cfg, opts);
  return { sc: C.rowScope(compiled, C.startedLines(state), frontier), frontier, state };
};

test('frontier: at the start only A and the next step B get rows; the ending C waits; the unstarted side line only has its opening event', () => {
  const { sc } = scopeAt([]);
  assert.deepEqual([...sc.facts].sort(), ['F_a', 'F_b', 'F_call']);
  assert.ok(sc.future.has('F_c') && sc.future.has('F_s2'));
});

test('frontier: once A is registered, C (one step after B) gets its row', () => {
  assert.deepEqual([...scopeAt(['F_a']).sc.facts].sort(), ['F_a', 'F_b', 'F_c', 'F_call']);
});

test('frontier: lookahead is capped; without a frontier (跑团 / catch-up) the whole started line is built as before', () => {
  const capped = scopeAt([], { cap: 0 }).sc;
  assert.deepEqual([...capped.facts].sort(), ['F_a', 'F_call'], 'cap 0: no lookahead rows');
  const compiled = C.compileClue(volumes());
  const old = C.rowScope(compiled, new Set(['M1']));
  assert.ok(old.facts.has('F_c'), 'line-level path unchanged');
});

test('frontier: a lookahead that would start another line does not build that line\'s rows', () => {
  const vols = volumes();
  vols[0].stages[0].data.主线节点[0].发现.push({ 事实: 'F_call', 内容: '接到电话' });
  // 开场事实：这件事一出现线就算开始（不用走进入口），推演里假设拿到 F_call 时 S2 会开始
  vols[1].line = { 编号: 'S2', 类型: '支线', 开场事实: 'F_call' };
  const compiled = C.compileClue(vols),
    prog = C.emptyClueProgress(),
    cfg = { mode: 'clue', bindings: { facts: FB, knowledge: [] } },
    state = C.computeClueState(compiled, snapOf([]), prog, cfg),
    sc = C.rowScope(compiled, C.startedLines(state), C.nodeFrontier(compiled, state, snapOf([]), prog, cfg));
  assert.ok(!sc.facts.has('F_s2'), 'S2 has not started: its node rows wait even if F_call is assumed');
});

// ---------- panel: rows appear step by step ----------
function liveTables(t) {
  const out = JSON.parse(JSON.stringify(t));
  for (const [k, s] of Object.entries(out)) if (k.startsWith('sheet_')) s.content = s.content.map((row, i) => (i === 0 ? row : [i, ...row.slice(1)]));
  return out;
}
async function setup() {
  const host = createHost({ tables: liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [], knowRows: [] })) });
  const inst = host.load();
  await inst.ready;
  const p = await inst.data.createProject('按节点');
  const vols = volumes();
  const labels = Object.fromEntries(C.labelsToPrepare(vols, {}).map((x) => [x.code, { label: `标签${x.code}`, criterion: '看到时登记；没看到不算', sig: x.sig }]));
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML), labels } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  return { host, inst };
}
const factCodes = (host) => {
  const s = Object.values(host.w.AutoCardUpdaterAPI.exportTableAsJson()).find((x) => x && x.name === '关键事实表');
  return s.content.slice(1).map((r) => r[s.content[0].indexOf('编号')]).filter(Boolean).sort();
};
const setStatus = (host, code, v) => {
  const t = JSON.parse(JSON.stringify(host.w.AutoCardUpdaterAPI.exportTableAsJson()));
  const s = Object.values(t).find((x) => x && x.name === '关键事实表');
  s.content.find((r, i) => i > 0 && r[s.content[0].indexOf('编号')] === code)[s.content[0].indexOf('状态')] = v;
  host.db.setTables(t);
};

test('panel: auto row filling follows the progress — A and B first, C after A is registered; no missing-row problem for C', async () => {
  const { host, inst } = await setup();
  await host.addMessage('一', true);
  await host.addMessage('开始。', false);
  await host.settle(); await inst.runtime.clue.syncLines();
  assert.deepEqual(factCodes(host), ['F_a', 'F_b', 'F_call']);
  assert.ok(!inst.runtime.clue.compute().snap.problems.some((x) => /F_c/.test(x)), 'C is future, not a missing row');
  setStatus(host, 'F_a', '已核实');
  await host.addMessage('甲查完了。', false);
  await host.settle(); inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines();
  assert.deepEqual(factCodes(host), ['F_a', 'F_b', 'F_c', 'F_call']);
  await inst.destroy();
});
