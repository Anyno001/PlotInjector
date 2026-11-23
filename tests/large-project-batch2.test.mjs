// 大型项目方案 第 2 批（2026-11-18）：表格只装正在进行的线。
// 一份范围规则（rowScope）：模板只建开局要用的行、自动补行只补开始了的线、缺行提示不报未来线、读条件时补虚拟初始行。
import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';
import { buildTemplate, BINDING_YAML } from '../templates/clue-tables/build-template.mjs';

const C = loadCore();
const tick = () => new Promise((r) => setTimeout(r, 20));
const node = (id, fact, extra = {}) => ({ id, 名称: id, 入口: `去${id}`, 地点: id, 发现: [{ 事实: fact, 内容: `${id}查到的`, 记录: `看到${id}时登记` }], 完成条件: { 事实: fact }, ...extra });

// M1 进行中；S20 要等 M1 完成并且「收到信」（开线事件，没有节点产出）；S9 只靠条件「M1 完成」；
// M2 接 M1，它的节点读 M1 的 F_m1a（跨线依赖）；S30 是表格计数条件：关键事实表里「未获得」的至多 0 条才开。
function volumes() {
  return [
    { id: 'vM1', key: '剧情_M1_街区', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 'sM1', key: '阶段1_街区', data: { 主线节点: [node('n_m1a', 'F_m1a'), node('n_m1b', 'F_m1b')] } }] },
    { id: 'vS20', key: '剧情_S20_来信', line: { 编号: 'S20', 类型: '支线', 开启条件: { 全部: [{ 线: 'M1 == 完成' }, { 事实: 'F_letter' }] } }, stages: [{ id: 'sS20', key: '阶段1_信', data: { 主线节点: [node('n_s20', 'F_s20')] } }] },
    { id: 'vS9', key: '剧情_S9_旧事', line: { 编号: 'S9', 类型: '支线', 开启条件: { 线: 'M1 == 完成' } }, stages: [{ id: 'sS9', key: '阶段1_旧事', data: { 主线节点: [node('n_s9', 'F_s9')] } }] },
    { id: 'vM2', key: '剧情_M2_码头', line: { 编号: 'M2', 类型: '主线', 接上一条: true }, stages: [{ id: 'sM2', key: '阶段1_码头', data: { 主线节点: [node('n_m2', 'F_m2', { 开放条件: { 事实: 'F_m1a' } })] } }] },
    { id: 'vS30', key: '剧情_S30_清点', line: { 编号: 'S30', 类型: '支线', 开启条件: { 计数: { 表: '关键事实表', 条件: '状态 == 未获得', 至多: 0 } } }, stages: [{ id: 'sS30', key: '阶段1_清点', data: { 主线节点: [node('n_s30', 'F_s30')] } }] },
  ];
}
const started = (ids) => new Set(ids);

// ---------- rowScope ----------
test('rowScope: playing M1 → M1\'s facts + the opening event F_letter; S20/S9/M2/S30 facts are future', () => {
  const sc = C.rowScope(C.compileClue(volumes()), started(['M1']));
  assert.deepEqual([...sc.facts].sort(), ['F_letter', 'F_m1a', 'F_m1b']);
  assert.deepEqual([...sc.future].sort(), ['F_m2', 'F_s20', 'F_s30', 'F_s9']);
});

test('rowScope: when M2 starts it brings its own facts and the M1 fact it reads (cross-line dependency) stays', () => {
  const sc = C.rowScope(C.compileClue(volumes()), started(['M1', 'M2']));
  assert.ok(sc.facts.has('F_m2') && sc.facts.has('F_m1a'));
  // even if M1 were not counted as started any more, M2 reading F_m1a keeps it in
  const only = C.rowScope(C.compileClue(volumes()), started(['M2']));
  assert.ok(only.facts.has('F_m1a'), 'read by a started line → kept');
  assert.ok(!only.facts.has('F_m1b'), 'not read by anyone started → future');
});

test('rowScope: null started (no line info yet) or an old book without 线: → everything, as before', () => {
  assert.equal(C.rowScope(C.compileClue(volumes()), null).future.size, 0);
  const plain = volumes().map(({ line, ...v }) => v);
  const sc = C.rowScope(C.compileClue(plain), started([]));
  assert.equal(sc.future.size, 0);
  assert.ok(sc.facts.has('F_s30'));
});

// ---------- effectiveTables: fixed full reference (方案 二.3〔五〕) ----------
const FB = [{ 表: '关键事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }];
const KB = [{ 表: '知情表', 事实列: '事实', 角色列: '角色', 方式列: '获知方式', 可信度列: '可信度', 已核实值: '已核实', 未知值: ['未知'] }];
const realTables = (facts = [], knows = []) => ({
  sheet_f: { name: '关键事实表', content: [[null, '编号', '标签', '登记口径', '状态', '内容', '依据'], ...facts.map(([c, st], i) => [i + 1, c, '', '', st, '', ''])] },
  sheet_k: { name: '知情表', content: [[null, '键', '事实', '角色', '获知方式', '可信度', '依据'], ...knows.map(([f, a, w], i) => [i + 1, `${f}@${a}`, f, a, w, '未核实', ''])] },
});

test('effectiveTables: every row the full template would have is there (facts + (fact, actor) knows), with template defaults; real table untouched', () => {
  const plan = C.prebuildPlan(volumes());
  const real = realTables([['F_m1a', '已核实'], ['F_m1b', '已核实'], ['F_letter', '已核实']], [['F_m1a', 'user', '亲见']]);
  const view = C.effectiveTables(real, { facts: FB, knowledge: KB }, plan, { F_m2: { label: '码头', criterion: 'k' } });
  const f = C.readFacts(view, FB).facts;
  assert.equal(f.get('F_m1a').status, 'confirmed', 'real rows win');
  assert.equal(f.get('F_m2').status, 'unconfirmed', 'missing rows read as 未获得');
  assert.equal(C.readCell(view, '关键事实表/F_s9/状态').value, '未获得');
  const k = C.readKnowledge(view, KB);
  assert.ok(k.present.has('F_s30@user'), 'every planned (fact, actor) is present');
  assert.ok(!k.rows.some((r) => r.fact === 'F_s30'), 'template know rows are 未知 → not knowledge');
  assert.equal(real.sheet_f.content.length, 4, 'real fact table not changed');
  assert.equal(real.sheet_k.content.length, 2, 'real know table not changed');
  // count over the fact table: same as fully built
  const atom = C.parseCountAtom({ 表: '关键事实表', 条件: '状态 == 未获得', 至多: 0 }, []);
  assert.equal(C.evalAtom(atom, { tables: real, facts: new Map(), knowledge: [] }).v, 'true', 'real (pruned) table alone would wrongly open');
  assert.equal(C.evalAtom(atom, { tables: view, facts: new Map(), knowledge: [] }).v, 'false', 'view: same as all built');
  // count over the know table (知情表计数): planned @user rows are counted like the full template
  // every planned (fact, actor) except the one real 亲见 row is 未知 — exactly like the full template
  const n = plan.knows.length - 1;
  const kc = (k) => C.parseCountAtom({ 表: '知情表', 条件: '获知方式 == 未知', 等于: k }, []);
  assert.equal(C.evalAtom(kc(n), { tables: view, facts: new Map(), knowledge: [] }).v, 'true', `know count = ${n}`);
  assert.equal(C.evalAtom(kc(0), { tables: real, facts: new Map(), knowledge: [] }).v, 'true', 'real (pruned) table has none');
});

test('GPT 第四版反例: M1 opens on "at least 1 未获得", produces the only F1, real table only has a header → same result as the full template, computed once (no oscillation)', () => {
  const vols = [{ id: 'v1', key: '剧情_M1_a', line: { 编号: 'M1', 类型: '主线', 开启条件: { 计数: { 表: '关键事实表', 条件: '状态 == 未获得', 至少: 1 } } }, stages: [{ id: 's1', key: '阶段1_a', data: { 主线节点: [node('n1', 'F1')] } }] }];
  const compiled = C.compileClue(vols);
  const cfg = C.normalizeClue({ mode: 'clue', bindings: { facts: FB, knowledge: [] } });
  const run = (tables) => {
    const view = C.effectiveTables(tables, cfg.bindings, C.prebuildPlan(vols), {});
    return C.computeClueState(compiled, { facts: C.readFacts(view, FB).facts, knowledge: [], tables: view, problems: [] }, C.emptyClueProgress(), cfg).lineStates[0].state;
  };
  const empty = realTables();
  const results = [run(empty), run(empty), run(empty)];
  assert.deepEqual(results, ['进行中', '进行中', '进行中'], 'stable');
  const full = realTables([['F1', '未获得']]);
  assert.equal(C.computeClueState(compiled, { facts: C.readFacts(full, FB).facts, knowledge: [], tables: full, problems: [] }, C.emptyClueProgress(), cfg).lineStates[0].state, '进行中', 'full template gives the same');
});

test('GPT 第四版反例: a fact binding without a status column ("a row means confirmed") is never padded; neither is a know binding without 方式列', () => {
  const plan = C.prebuildPlan(volumes());
  const noStatus = [{ 表: '关键事实表', 编号列: '编号' }];
  const real = realTables();
  const view = C.effectiveTables(real, { facts: noStatus, knowledge: [{ 表: '知情表', 事实列: '事实', 角色列: '角色' }] }, plan, {});
  assert.equal(view, real, 'nothing padded');
  assert.equal(C.readFacts(view, noStatus).facts.size, 0, 'nothing becomes confirmed');
  assert.equal(C.canSeedFacts(noStatus[0]), false);
  assert.equal(C.canSeedFacts(FB[0]), true);
  assert.equal(C.canSeedKnows({ 表: '知情表', 事实列: '事实', 角色列: '角色' }), false);
  assert.equal(C.canSeedKnows(KB[0]), true);
});

test('condPathFacts: a 知情表 path condition (表/F@角色/列) of a started line keeps that fact in scope', () => {
  const vols = volumes();
  vols[0].stages[0].data.主线节点[0].开放条件 = { 表: '知情表/F_s9@user/获知方式 == 被告知' };
  const sc = C.rowScope(C.compileClue(vols), started(['M1']));
  assert.ok(sc.facts.has('F_s9'), 'read by M1 → in scope (row is built)');
});

test('legacy 开场事实 produced by the line\'s own node is built at the start, so the line can still open', () => {
  const vols = volumes();
  vols[2].line = { 编号: 'S9', 类型: '支线', 开场事实: 'F_s9' };
  const sc = C.rowScope(C.compileClue(vols), started(['M1']));
  assert.ok(sc.facts.has('F_s9'));
});

// ---------- prebuiltGaps ----------
test('prebuiltGaps: future facts are not reported as missing rows', () => {
  const compiled = C.compileClue(volumes());
  const snap = { facts: new Map([['F_m1a', {}], ['F_m1b', {}], ['F_letter', {}]]), knowPresent: null };
  const sc = C.rowScope(compiled, started(['M1']));
  assert.deepEqual(C.prebuiltGaps(compiled, snap, { skip: sc.future }), []);
  assert.match(C.prebuiltGaps(compiled, snap).join(''), /F_m1a|F_s20|F_m2/, 'without skip the old report would list them');
});

// ---------- scene catalog: no cap (多线第 B 步二.2–二.3) ----------
test('lineEntryPlan: the scene catalog lists every openable side line (it is the fill model\'s recognition list); only one is offered', () => {
  const lineStates = ['S1', 'S2', 'S3', 'S4', 'S5'].map((id) => ({ line: { id, kind: 'side', mode: 'enter', entryHint: '' }, state: '可开启', entries: [`n_${id}`], started: false, manual: {} }));
  const state = { lineStates, nodeStates: lineStates.map((s) => ({ node: { uid: s.entries[0], item: { 入口: `去${s.line.id}` }, unit: {} }, status: 'available' })) };
  const plan = C.lineEntryPlan(state, { lines: {} }, { limit: 1 });
  assert.equal(plan.catalog.length, 5);
  assert.equal(plan.offer.line, 'S1', 'only the first is offered to the story');
  assert.equal(C.normalizeClue({ recommendCap: 3 }).recommendCap, undefined, 'no such setting');
});

// ---------- label batches: one request unless too long (四.2; user 2026-11-17 "检查一次") ----------
test('labelBatches: short projects stay one batch even across many lines; only oversize is split, in outline order', () => {
  const codes = ['F_m1a', 'F_s9', 'F_m1b', 'F_letter', 'F_s20'];
  assert.deepEqual(C.labelBatches(codes, () => 1), [codes], 'one request');
  const long = C.labelBatches(Array.from({ length: 45 }, (_, i) => `x${i}`), () => 1);
  assert.deepEqual(long.map((x) => x.length), [40, 5]);
  assert.equal(C.factLineOf(volumes())('F_letter'), 'S20', 'line names still used in the pending hint');
});

// ---------- panel: a trigger-opened line gets its rows when it starts, not before ----------
function liveTables(t) {
  const out = JSON.parse(JSON.stringify(t));
  for (const [k, s] of Object.entries(out)) if (k.startsWith('sheet_')) s.content = s.content.map((row, i) => (i === 0 ? row : [i, ...row.slice(1)]));
  return out;
}
async function setup() {
  const tables = liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [], knowRows: [] }));
  const host = createHost({ tables });
  const inst = host.load();
  await inst.ready;
  const p = await inst.data.createProject('多线');
  const vols = volumes();
  const sig = Object.fromEntries(C.labelsToPrepare(vols, {}).map((x) => [x.code, x.sig]));
  const labels = Object.fromEntries(Object.entries(sig).map(([k, s]) => [k, { label: `标签${k}`, criterion: '看到时登记；没看到不算', sig: s }]));
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML), labels } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  return { host, inst, pid: p.id, tables };
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

test('panel: fresh chat → only M1 rows + the opening event are filled in; S20 and M2 rows come only when they start', async () => {
  const { host, inst } = await setup();
  await host.addMessage('一', true);
  await host.addMessage('M1 开始了。', false);
  await host.settle(); await inst.runtime.clue.syncLines();
  assert.deepEqual(factCodes(host), ['F_letter', 'F_m1a', 'F_m1b'], 'opening rows only');
  // the letter arrives early (during M1) — its row is already there, so it is recorded
  setStatus(host, 'F_letter', '已核实');
  inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines();
  assert.ok(!factCodes(host).includes('F_s20'), 'S20 not started yet (M1 not done)');
  // M1 finishes → S20 becomes openable (letter already recorded); M2 auto-starts and brings its rows
  setStatus(host, 'F_m1a', '已核实'); setStatus(host, 'F_m1b', '已核实');
  await host.addMessage('M1 结束。', false);
  await host.settle(); inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines();
  inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines();
  const c = inst.runtime.clue.compute();
  const st = Object.fromEntries(c.state.lineStates.map((s) => [s.line.id, s.state]));
  assert.equal(st.M1, '完成');
  assert.equal(st.S20, '可开启', 'the early letter still counts');
  assert.equal(st.M2, '进行中');
  assert.ok(factCodes(host).includes('F_m2'), 'M2 rows filled in when it started');
  assert.ok(!factCodes(host).includes('F_s20') && !factCodes(host).includes('F_s30'), 'S20 (not entered) and S30 still not built');
  // S30's count condition: 未获得 rows exist (F_m2 + virtual future rows) → not open
  assert.equal(st.S30, '未触发', 'the count condition did not flip open because rows were skipped');
  assert.ok(!c.snap.problems.some((x) => /F_s20|F_s30|F_s9/.test(x)), 'no missing-row problem for future lines');
  await inst.destroy();
});

test('panel: 生成线索模板 seeds only opening rows (M1 + the opening event); the dialog says the rest come later', async () => {
  const tables = { mate: { type: 'chatSheets', version: 1 }, sheet_g: { uid: 'sheet_g', name: '全局数据表', orderNo: 0, sourceData: { note: 'x' }, content: [['row_id', '全局状态', '当前时间', '当前详细地点']], updateConfig: { updateFrequency: 3 } } };
  const host = createHost({ tables });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('多线');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: volumes() }, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document, api = host.w.AutoCardUpdaterAPI;
  doc.querySelector(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  (() => { const t = doc.querySelector('[data-act="run-set-toggle"][aria-expanded="false"]'); t && t.click(); })(); await tick(); (() => { const t = doc.querySelector('[data-act="run-fold"][data-key="advOpen"][aria-expanded="false"]'); t && t.click(); })(); await tick();
  doc.querySelector('[data-act="clue-gen-template"]').click(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  assert.match(dlg.textContent, /开局要用3条线索/);
  assert.match(dlg.textContent, /另有4条要等剧情推进到那一步/);
  dlg.querySelectorAll('[data-gt-label]').forEach((el, i) => { el.value = `标签${i}`; el.dispatchEvent(new el.ownerDocument.defaultView.Event('input', { bubbles: true })); });
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '写入当前聊天').click(); await tick(); await tick();
  const sheet = Object.values(api.templateCalls[0].tpl).find((s) => s && s.name === '关键事实表');
  const rows = (sheet.seedRows && sheet.seedRows.length ? sheet.seedRows : sheet.content.slice(1)).map((r) => r[1]).sort();
  assert.deepEqual(rows, ['F_letter', 'F_m1a', 'F_m1b']);
  await inst.destroy();
});

test('panel: every real row 已核实 but future lines still have rows to find → the count condition stays closed', async () => {
  const { host, inst } = await setup();
  await host.addMessage('一', true);
  await host.addMessage('M1 开始了。', false);
  await host.settle(); await inst.runtime.clue.syncLines();
  for (const f of ['F_letter', 'F_m1a', 'F_m1b']) setStatus(host, f, '已核实');
  inst.runtime.clue.invalidate();
  const c = inst.runtime.clue.compute();
  // M1 is done, M2 started (its F_m2 row may not be filled in yet in the real table) — S30 must not open either way
  const st = Object.fromEntries(c.state.lineStates.map((s) => [s.line.id, s.state]));
  assert.notEqual(st.S30, '进行中');
  assert.notEqual(st.S30, '可开启', 'S30 needs every clue found; future lines still have unfound clues');
  await inst.destroy();
});

// ---------- GPT 第五版复核 1：旧绑定（没配状态列 / 方式列）不预建占位行 ----------
test('panel: an old fact binding without a status column → auto row filling never writes placeholder rows (a row would mean 已核实)', async () => {
  const tables = liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [], knowRows: [] }));
  const host = createHost({ tables });
  const inst = host.load();
  await inst.ready;
  const p = await inst.data.createProject('旧绑定');
  const vols = volumes();
  const sig = Object.fromEntries(C.labelsToPrepare(vols, {}).map((x) => [x.code, x.sig]));
  const labels = Object.fromEntries(Object.entries(sig).map(([k, s]) => [k, { label: `标签${k}`, criterion: 'k', sig: s }]));
  const b = YAML.parse(BINDING_YAML);
  b.facts = [{ 表: '关键事实表', 编号列: '编号' }];
  b.knowledge = [{ 表: '知情表', 事实列: '事实', 角色列: '角色' }];
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: b, labels } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  await host.addMessage('一', true);
  await host.addMessage('开始。', false);
  await host.settle();
  for (let i = 0; i < 2; i++) { inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines(); }
  assert.deepEqual(factCodes(host), [], 'nothing written');
  const c = inst.runtime.clue.compute();
  assert.ok(!c.snap.facts.size, 'nothing confirmed out of thin air');
  await inst.destroy();
});

// ---------- 代码核对反例：「事实:」条件读未开始的线的事实，结果要和全部建好时一样 ----------
test('panel: S3 opens on 事实 F_s2 (produced by unstarted S2); S4 opens on 「S3 != 完成」 → same line states as when every row is built', async () => {
  const vols = [
    { id: 'vM', key: '剧情_M1_a', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 's1', key: '阶段1_a', data: { 主线节点: [node('n1', 'F_m1')] } }] },
    { id: 'vS', key: '剧情_S2_b', line: { 编号: 'S2', 类型: '支线' }, stages: [{ id: 's2', key: '阶段1_b', data: { 主线节点: [node('n2', 'F_s2')] } }] },
    { id: 'vT', key: '剧情_S3_c', line: { 编号: 'S3', 类型: '支线', 开启条件: { 事实: 'F_s2' } }, stages: [{ id: 's3', key: '阶段1_c', data: { 主线节点: [node('n3', 'F_s3')] } }] },
    { id: 'vU', key: '剧情_S4_d', line: { 编号: 'S4', 类型: '支线', 开启条件: { 线: 'S3 != 完成' } }, stages: [{ id: 's4', key: '阶段1_d', data: { 主线节点: [node('n4', 'F_s4')] } }] },
  ];
  const host = createHost({ tables: liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [], knowRows: [] })) });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('事实条件');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML) } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.runtime.clue.invalidate();
  const st = Object.fromEntries(inst.runtime.clue.compute().state.lineStates.map((s) => [s.line.id, s.state + (s.pending ? '(pending)' : '')]));
  assert.equal(st.S3, '未触发', 'F_s2 reads as 未获得 (false), not unknown');
  assert.equal(st.S4, '可开启', 'S4 is offered, like when every row is built');
  await inst.destroy();
});
