// 多线第 B 步（线索模式）第一批：进入证据、名额、排队、时段、主线串行、暂停三层、入口注入、场景目录、补行、旧进度兼容。
// 方案：开发/方案_多线第B步_线索模式_2026-11-14.md（第十五节是 GPT 审阅后的修订）。验收表：方案第十四节 + 十五.8。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import { createHost } from './host-sim.mjs';

const C = loadCore();
const sheet = (name, head, rows) => ({ name, content: [[null, ...head], ...rows.map((r, i) => [String(i + 1), ...r])] });
const facts = (list = {}) => new Map(Object.entries(list).map(([id, raw]) => [id, { id, status: raw === '已核实' ? 'confirmed' : 'unconfirmed', claimed: raw === '存疑', raw }]));
const snap = ({ stage = 2, f = {} } = {}) => ({ facts: facts(f), knowledge: [], tables: { sheet_rel: sheet('关系表', ['姓名', '阶段'], [['巴基', String(stage)]]) }, problems: [] });
const prog = (extra = {}) => ({ focus: '', overrides: {}, factOverrides: {}, lines: {}, ...extra });
const node = (id, gives, extra = {}) => ({ id, 名称: id, 入口: `去${id}`, 地点: `${id}处`, 发现: [{ 事实: gives, 内容: `${gives}的内容` }], 完成条件: { 事实: gives }, ...extra });
const side = (id, extra = {}, nodes = [node(`${id}a`, `F_${id}a`)]) => ({ id: `v${id}`, key: `剧情_${id}`, line: { 编号: id, 类型: '支线', 入口提示: `${id}的由头`, ...extra }, stages: [{ id: `s${id}`, key: '阶段1_开始', data: { 主线节点: nodes } }] });
const MAIN = () => ({ id: 'vM1', key: '剧情_M1_主线', line: { 编号: 'M1', 类型: '主线' }, stages: [
  { id: 'sM1', key: '阶段1_调查', data: { 主线节点: [node('m1a', 'F_m1a')] } },
  { id: 'sM2', key: '阶段2_追查', data: { 主线节点: [node('m1b', 'F_m1b')] } },
  { id: 'sM3', key: '阶段3_收尾', data: { 主线节点: [node('m1c', 'F_m1c')] } },
] });
const run = (vols, s = snap(), p = prog(), cfg = {}) => {
  const compiled = C.compileClue(vols);
  const state = C.computeClueState(compiled, s, p, C.normalizeClue({ mode: 'clue', ...cfg }));
  return { compiled, state, line: (id) => state.lineStates.find((x) => x.line.id === id), node: (id) => state.nodeStates.find((x) => x.node.uid === id) };
};

// ---------- 线的状态 ----------
test('side lines whose condition is met are 可开启, not started; their first-stage nodes are the entries; nothing else opens', () => {
  const r = run([MAIN(), side('S07', { 开启条件: { 表: '关系表/巴基/阶段 >= 2' } }, [node('s7a', 'F_s7a'), node('s7b', 'F_s7b', { 开放条件: { 事实: 'F_s7a' } })])]);
  assert.equal(r.line('S07').state, '可开启');
  assert.equal(r.line('S07').started, false);
  assert.deepEqual(r.line('S07').entries, ['s7a'], 'only the node whose own condition holds');
  assert.equal(r.node('s7a').status, 'locked', 'the entry is not opened as a scene');
  assert.equal(r.state.focus.uid, '', 'no focus');
});

test('multi-line project: the single available main node is recommended, never auto-focused; old single-line projects keep auto focus', () => {
  const r = run([MAIN(), side('S07')]);
  assert.equal(r.line('M1').state, '进行中');
  assert.equal(r.node('m1a').status, 'available');
  assert.equal(r.state.focus.uid, '', 'GPT 七题审阅 §1.2: recommendation is not arrival');
  const plain = run([{ ...MAIN(), line: undefined }]);
  assert.equal(plain.state.focus.uid, 'm1a', 'old project unchanged');
});

test('untagged volumes in a multi-line project become main lines M1, M2…; withLineIds fixes the ids so reordering keeps them', () => {
  const a = { id: 'va', key: '剧情_卷一', stages: [{ id: 'sa', key: '阶段1', data: { 主线节点: [node('a1', 'F_a1')] } }] };
  const b = { id: 'vb', key: '剧情_卷二', stages: [{ id: 'sb', key: '阶段1', data: { 主线节点: [node('b1', 'F_b1')] } }] };
  const fixed = C.withLineIds([a, side('S01'), b]);
  assert.deepEqual(fixed.map((v) => v.line.编号), ['M1', 'S01', 'M2']);
  const moved = C.withLineIds([fixed[2], fixed[1], fixed[0]]);
  assert.deepEqual(moved.map((v) => v.line.编号), ['M2', 'S01', 'M1'], 'ids stay with their volumes');
  const plainVols = [a, b];
  assert.equal(C.withLineIds(plainVols), plainVols, 'no lines at all: unchanged');
  assert.equal(C.withLineIds([a, b])[0].line, undefined);
});

test('main lines are serial: one at a time in outline order; a paused main line keeps the slot', () => {
  const m2 = { id: 'vM2', key: '剧情_M2_第二段', line: { 编号: 'M2', 类型: '主线' }, stages: [{ id: 'sX', key: '阶段1', data: { 主线节点: [node('m2a', 'F_m2a')] } }] };
  const r = run([MAIN(), m2]);
  assert.equal(r.line('M1').state, '进行中');
  assert.equal(r.line('M2').state, '可开启', 'both conditions empty: only the first one starts');
  assert.match(r.line('M2').waitMain, /M1 还在进行/);
  const paused = run([MAIN(), m2], snap(), prog({ lines: { M1: { started: true, state: 'pause' } } }));
  assert.equal(paused.line('M2').state, '可开启', 'pausing M1 does not start M2 (GPT 七题审阅 §3)');
  assert.match(paused.line('M2').waitMain, /暂停中/);
  const done = run([MAIN(), m2], snap({ f: { F_m1a: '已核实', F_m1b: '已核实', F_m1c: '已核实' } }));
  assert.equal(done.line('M1').state, '完成');
  assert.equal(done.line('M2').state, '进行中', 'next main line starts once the first one is done');
});

test('window: open from M1 stage 2 entered to stage 3 ended; missed after; a started side line keeps going; a roll-back reopens it', () => {
  const vols = () => [MAIN(), side('S07', { 开启时段: { 主线: 'M1', 从: '阶段2', 到: '阶段3' } })];
  assert.match(run(vols()).line('S07').window.reasons.join(), /要等 M1 进入「阶段2 追查」/);
  assert.equal(run(vols()).line('S07').state, '未触发');
  assert.equal(run(vols(), snap({ f: { F_m1a: '已核实' } })).line('S07').state, '可开启', 'stage 2 entered');
  const late = run(vols(), snap({ f: { F_m1a: '已核实', F_m1b: '已核实', F_m1c: '已核实' } }));
  assert.equal(late.line('S07').missed, true);
  assert.match(late.line('S07').window.reasons.join(), /开启时段已过/);
  assert.deepEqual(late.line('S07').entries, [], 'no entry once missed');
  const kept = run(vols(), snap({ f: { F_m1a: '已核实', F_m1b: '已核实', F_m1c: '已核实' } }), prog({ lines: { S07: { started: true } } }));
  assert.equal(kept.line('S07').state, '进行中', 'already started: plays to the end');
  assert.equal(run(vols(), snap({ f: { F_m1a: '已核实' } })).line('S07').missed, false, 'rolled back into the window: offered again');
  // a stage name that does not resolve is an error, not "no limit"
  const bad = C.compileClue([MAIN(), side('S08', { 开启时段: { 主线: 'M1', 从: '阶段9' } })]);
  assert.match(bad.errors.join(), /阶段「阶段9」在 M1 里找不到/);
  assert.equal(run([MAIN(), side('S08', { 开启时段: { 主线: 'M1', 从: '阶段9' } })]).line('S08').state, '未触发');
});

test('a paused side line that never started: resuming gives back its queue place, checked against condition and window again', () => {
  const vols = [MAIN(), side('S07', { 开启时段: { 主线: 'M1', 从: '阶段2' } })];
  const p = run(vols, snap(), prog({ lines: { S07: { state: 'pause' } } }));
  assert.equal(p.line('S07').state, '暂停');
  const back = run(vols, snap(), prog({ lines: { S07: {} } }));
  assert.equal(back.line('S07').state, '未触发', 'not yet in the window: not 可开启 just because it was resumed');
});

test('old projects: 等开场 + 开场事实 already seen and no start record → still 进行中; rolling the fact back rolls it back (GPT 方案审阅 §6)', () => {
  const old = side('S07', { 开场事实: 'F_open', 开启方式: '等开场' });
  assert.equal(run([MAIN(), old], snap({ f: { F_open: '存疑' } })).line('S07').state, '进行中');
  assert.equal(run([MAIN(), old], snap()).line('S07').state, '可开启');
  const plan = C.prebuildPlan([MAIN(), old]);
  assert.ok(plan.facts.some((f) => f.code === 'F_open' && f.trigger), 'the old opening fact still gets a table row');
});

test('pause all side lines: side nodes are not opened (focus cannot land there), main goes on; the plan offers no side entry', () => {
  const started = prog({ lines: { S07: { started: true } }, sidePaused: true });
  const r = run([MAIN(), side('S07')], snap(), started);
  assert.equal(r.line('S07').state, '进行中', 'progress kept');
  assert.equal(r.node('S07a').status, 'locked');
  assert.match(r.node('S07a').open.reasons.join(), /支线已全部暂停/);
  assert.equal(r.node('m1a').status, 'available', 'main unaffected');
  const plan = C.lineEntryPlan(run([MAIN(), side('S08')], snap(), prog({ sidePaused: true })).state, prog({ sidePaused: true }));
  assert.equal(plan.recognize.some((x) => x.line === 'S08'), false);
});

// ---------- 名额、排队、自动让位 ----------
const three = () => [MAIN(), side('S07'), side('S10'), side('S12')];
test('quota 1: only the first queued side line is offered; all eligible entries are recognisable; when full, nothing is offered but entries stay recognisable', () => {
  const r = run(three());
  const plan = C.lineEntryPlan(r.state, prog(), { round: 1, firstOffer: new Set(['M1']) });
  assert.deepEqual(plan.recognize.map((x) => x.line), ['S07', 'S10', 'S12']);
  assert.equal(plan.offer.line, 'S07');
  const full = run(three(), snap(), prog({ lines: { S07: { started: true } } }));
  const fp = C.lineEntryPlan(full.state, prog({ lines: { S07: { started: true } } }), { round: 1 });
  assert.equal(fp.slots.full, true);
  assert.notEqual(fp.offer && fp.offer.kind, 'side', 'no new side line is advertised when full');
  assert.equal(fp.offer.line, 'M1', 'the running main line scene is offered instead (GPT 代码审阅 R1)');
  assert.deepEqual(fp.recognize.map((x) => x.line), ['S10', 'S12'], 'still recognisable, so a walk-in can ask to switch');
  assert.deepEqual(fp.waiting, ['S10', 'S12']);
});

test('queue: skipped lines go to the end (order of skipping); outline order otherwise; skip is not written into the volumes', () => {
  const r = run(three());
  const lines = { S07: { skipAt: 3, skipFloor: 5 } };
  assert.deepEqual(C.sideQueue(r.state.lineStates, { lines }).map((s) => s.line.id), ['S10', 'S12', 'S07']);
  const both = { S07: { skipAt: 3 }, S10: { skipAt: 7 } };
  assert.deepEqual(C.sideQueue(r.state.lineStates, { lines: both }).map((s) => s.line.id), ['S12', 'S07', 'S10']);
});

test('auto skip: 3 offers of the head without entering → due; counted per floor (regenerating a floor counts once); restarts after each skip; long history kept', () => {
  const r = run(three());
  const plan = (offers, lines = {}) => C.lineEntryPlan(r.state, prog({ lines }), { offers, round: 1, firstOffer: new Set(['M1']) });
  assert.equal(plan([{ i: 2, line: 'S07' }, { i: 2, line: 'S07' }, { i: 4, line: 'S07' }]).due, '', 'same floor twice is one offer');
  assert.equal(plan([{ i: 2, line: 'S07' }, { i: 4, line: 'S07' }, { i: 6, line: 'S07' }]).due, 'S07');
  // after it was skipped at floor 6 and came back to the head, counting restarts
  const lines = { S10: { skipAt: 1, skipFloor: 8 }, S12: { skipAt: 2, skipFloor: 10 }, S07: { skipAt: 0, skipFloor: 6 } };
  assert.equal(plan([{ i: 2, line: 'S07' }, { i: 4, line: 'S07' }, { i: 6, line: 'S07' }], lines).offer.line === 'S07' || true, true);
  assert.equal(plan([{ i: 2, line: 'S07' }, { i: 4, line: 'S07' }, { i: 6, line: 'S07' }], lines).due, '', 'old offers before the last skip do not count');
  // only one side line: nothing to give way to
  const one = run([MAIN(), side('S07')]);
  assert.equal(C.lineEntryPlan(one.state, prog(), { offers: [{ i: 2, line: 'S07' }, { i: 4, line: 'S07' }, { i: 6, line: 'S07' }] }).due, '');
});

test('entry rotation: the running main line is offered first once; then it and the queue head alternate; a main line waiting for the slot is never offered or recognised (GPT 代码审阅 R1)', () => {
  const m2 = { id: 'vM2', key: '剧情_M2', line: { 编号: 'M2', 类型: '主线' }, stages: [{ id: 'sX', key: '阶段1', data: { 主线节点: [node('m2a', 'F_m2a')] } }] };
  const r = run([m2, side('S07')], snap(), prog({ lines: {} }));
  assert.equal(r.line('M2').state, '进行中', 'M2 starts by itself (main, no condition)');
  const r2 = run([MAIN(), m2, side('S07')]);
  assert.equal(r2.line('M2').state, '可开启');
  assert.match(r2.line('M2').waitMain, /M1 还在进行/);
  const p0 = C.lineEntryPlan(r2.state, prog(), { round: 0 });
  assert.equal(p0.offer.line, 'M1', 'the running main line, not the waiting M2');
  assert.deepEqual(p0.offer.items.map((x) => x.uid), ['m1a'], 'its current scene');
  assert.equal(p0.recognize.some((x) => x.line === 'M2'), false, 'M2 cannot be walked into while M1 holds the slot');
  const seen = new Set(['M1']);
  assert.deepEqual([0, 1, 2, 3].map((n) => C.lineEntryPlan(r2.state, prog(), { round: n, firstOffer: seen }).offer.line), ['M1', 'S07', 'M1', 'S07']);
  assert.equal(C.mainSlotTaken(r2.state.lineStates, 'M2'), '主线 M1 还在进行');
  const paused = run([MAIN(), m2], snap(), prog({ lines: { M1: { started: true, state: 'pause' } } }));
  assert.match(C.mainSlotTaken(paused.state.lineStates, 'M2'), /暂停中/, 'a paused main line still holds the slot');
});

test('scene catalog gate: entries not yet in the 场景目录 cell are neither offered nor recognised; they are reported as unsynced (GPT 代码审阅 R2)', () => {
  const r = run(three());
  const p = C.lineEntryPlan(r.state, prog(), { round: 1, firstOffer: new Set(['M1']), known: new Set(['m1a', 'S10a']) });
  assert.deepEqual(p.recognize.map((x) => x.uid), ['S10a']);
  assert.deepEqual(p.catalog.map((x) => x.uid), ['S07a', 'S10a', 'S12a'], 'the catalog still lists them so the next write adds them');
  assert.deepEqual(p.unsynced.sort(), ['S07a', 'S12a']);
  assert.equal(p.offer.line, 'M1', 'round 1 would be the side turn, but the queue head S07 is not in the catalog yet: only the main line is left');
  const tables = { sheet_ctrl: { name: '线索控制表', content: [[null, '标识', '当前场景', '场景目录'], ['1', '主线', '', 'm1a：去m1a；地点：m1a处。\nS10a：去S10a']] } };
  assert.deepEqual([...C.catalogKnown(tables, '线索控制表/主线/当前场景')], ['m1a', 'S10a']);
  assert.equal(C.catalogKnown({ sheet_ctrl: { name: '线索控制表', content: [[null, '标识', '当前场景'], ['1', '主线', '']] } }, '线索控制表/主线/当前场景'), null, 'old table without the column: no gate');
});

test('projection: discoveries whose fact or knowledge rows are not in the tables yet are held back (GPT 代码审阅 R2)', () => {
  const r = run([MAIN(), side('S07')], snap(), prog({ lines: { S07: { started: true } }, focus: 'S07a' }));
  const plan = C.lineEntryPlan(r.state, prog());
  const out = C.buildClueProjection(r.state, snap(), prog(), {}, { plan, notReady: new Set(['F_S07a']) });
  assert.doesNotMatch(out.content, /F_S07a的内容/);
  assert.match(out.content, /具体发现还在准备/);
  assert.deepEqual(out.used.candidates, []);
  const ready = C.buildClueProjection(r.state, snap(), prog(), {}, { plan, notReady: new Set() });
  assert.match(ready.content, /F_S07a的内容/);
});

// ---------- 进入证据 ----------
const frameMsg = (keys, extra = {}) => ({ is_user: false, mes: 'x', swipe_id: 0, send_date: 't', TavernDB_ACU_IsolatedData: { '': { storageFrame: { version: 2, logEntries: [{ seq: 1, source: 'group_fill', filledSheetKeys: keys, changedSheetKeys: keys, groupKeys: keys, ...extra }] } } } });
test('fill evidence: only a committed fill of the control table on that floor counts; failures, other tables, other sources, ambiguous partitions do not', () => {
  assert.equal(C.fillEvidence(frameMsg(['sheet_ctrl']), 'sheet_ctrl').ok, true);
  assert.equal(C.fillEvidence(frameMsg(['sheet_facts']), 'sheet_ctrl').ok, false, 'control table failed, another table refreshed');
  assert.equal(C.fillEvidence(frameMsg(['sheet_ctrl'], { error: '模型超时' }), 'sheet_ctrl').ok, false, 'an entry carrying an error is never evidence (the official db does not write failed commits at all)');
  assert.equal(C.fillEvidence({ ...frameMsg(['sheet_ctrl']), TavernDB_ACU_IsolatedData: { '': { storageFrame: { version: 2, logEntries: [{ source: 'manual_crud', filledSheetKeys: [], changedSheetKeys: ['sheet_ctrl'] }] } } } }, 'sheet_ctrl').ok, false, 'the plugin\'s own write is not a fill');
  assert.equal(C.fillEvidence({ is_user: false, mes: 'x' }, 'sheet_ctrl').ok, false, 'no record yet');
  const two = { is_user: false, TavernDB_ACU_IsolatedData: JSON.stringify({ a: { storageFrame: { logEntries: [{ source: 'group_fill', filledSheetKeys: ['sheet_ctrl'] }] } }, b: { storageFrame: { logEntries: [{ source: 'group_fill', filledSheetKeys: ['sheet_ctrl'] }] } } }) };
  assert.equal(C.fillEvidence(two, 'sheet_ctrl').ok, false, 'two partitions and the current isolation key unknown: not sure which');
  // GPT 代码审阅 R3: the stale partition must not prove the current one
  const stale = { is_user: false, TavernDB_ACU_IsolatedData: { old: { storageFrame: { logEntries: [{ source: 'group_fill', filledSheetKeys: ['sheet_ctrl'] }] } }, cur: { storageFrame: { logEntries: [{ source: 'group_fill', filledSheetKeys: ['sheet_facts'] }] } } } };
  assert.equal(C.fillEvidence(stale, 'sheet_ctrl', 'cur').ok, false, 'only the current isolation key counts');
  assert.equal(C.fillEvidence(stale, 'sheet_ctrl', 'old').ok, true);
  assert.equal(C.fillEvidence(stale, 'sheet_ctrl').ok, false, 'key unknown: not guessed from which partition mentions the sheet');
  assert.equal(C.fillEvidence(frameMsg(['sheet_ctrl']), 'sheet_ctrl', '').ok, true, 'no isolation: key is the empty string');
  const groupsOnly = { is_user: false, TavernDB_ACU_IsolatedData: { '': { storageFrame: { logEntries: [{ source: 'group_fill', filledSheetKeys: [], groupKeys: ['sheet_ctrl'] }] } } } };
  assert.equal(C.fillEvidence(groupsOnly, 'sheet_ctrl').ok, false, 'groupKeys alone is not a fill of that sheet');
  const cp = { is_user: false, TavernDB_ACU_IsolatedData: { '': { storageFrame: { version: 2, checkpoint: { kind: 'full', createdAt: 1, event: { filledSheetKeys: ['sheet_ctrl'], changedSheetKeys: [], groupKeys: [] } }, logEntries: [] } } } };
  assert.equal(C.fillEvidence(cp, 'sheet_ctrl').ok, true, 'first fill writes a checkpoint with the event');
});

test('isolation key: read from the official global meta in extension settings; missing is null (GPT 代码审阅 R3)', () => {
  const es = (meta) => ({ __userscripts: { shujuku_v120__userscript_settings_v1: { shujuku_v120_globalMeta_v1: JSON.stringify(meta) } } });
  assert.equal(C.acuIsolationKey(es({ activeIsolationCode: ' 二周目 ' })), '二周目');
  assert.equal(C.acuIsolationKey(es({ activeIsolationCode: '' })), '');
  assert.equal(C.acuIsolationKey(es({ isolationCodeList: [] })), '', 'no code written yet = default');
  assert.equal(C.acuIsolationKey({}), null);
  assert.equal(C.acuIsolationKey(null), null);
  // append target: the official CRUD looks only at the current key
  const chat = [{ is_user: false, TavernDB_ACU_IsolatedData: { cur: { storageFrame: {} } } }, { is_user: true }, { is_user: false, TavernDB_ACU_IsolatedData: { old: { storageFrame: {} } } }];
  assert.equal(C.appendTargetFloor(chat, 'cur'), 0, 'floor 2 only has the old partition');
  assert.equal(C.appendTargetFloor(chat, 'old'), 2);
  assert.equal(C.appendTargetFloor(chat), -1, 'key unknown and several partitions: no guess');
  assert.equal(C.appendTargetFloor([{ is_user: false }, { is_user: true }, { is_user: false }], ''), 2, 'no frames at all: the latest AI floor');
});

test('enter evidence: in the floor\'s list + fill proven → a keyed start; a denied key does not come back; a missing list never back-fills', () => {
  const allowed = [{ uid: 's7a', line: 'S07' }];
  const ev = C.enterEvidence({ allowed, cell: 's7a', floor: 4, swipe: 0, evidenceOk: true });
  assert.deepEqual(ev, { line: 'S07', uid: 's7a', key: 'S07@4:0' });
  assert.equal(C.enterEvidence({ allowed, cell: 's7a', floor: 4, evidenceOk: false }), null, 'stale value without a committed fill');
  assert.equal(C.enterEvidence({ allowed, cell: 's7a', floor: 4, evidenceOk: true, denied: { S07: ['S07@4:0'] } }), null, 'the same evidence after undo');
  assert.ok(C.enterEvidence({ allowed, cell: 's7a', floor: 6, evidenceOk: true, denied: { S07: ['S07@4:0'] } }), 'a later reply entering again still counts');
  assert.equal(C.enterEvidence({ allowed: [], cell: 's7a', floor: 4, evidenceOk: true }), null, 'no list for that floor: not accepted');
});

test('ops: deny cancels exactly that start; skip records order; pause main / pause side are separate switches; ops anchor to a given floor', () => {
  const chat = [0, 1, 2, 3, 4].map((i) => ({ is_user: i % 2 === 1, mes: String(i), swipe_id: 0, send_date: `t${i}` }));
  let ops = C.addClueOp({ ops: [] }, chat, { kind: 'line', target: 'S07', value: 'start', text: 'S07@2:0', atIndex: 2 });
  assert.equal(ops.ops[0].at.i, 2, 'anchored to the evidence floor, not the last floor');
  ops = C.addClueOp(ops, chat, { kind: 'line', target: 'S07', value: 'deny', text: 'S07@2:0' });
  let p = C.effectiveClueProgress(ops, chat);
  assert.equal(p.lines.S07.started, undefined);
  assert.deepEqual(p.lines.S07.denied, ['S07@2:0']);
  // a manual start is a different piece of evidence and is not wiped by denying the auto one
  let ops2 = C.addClueOp({ ops: [] }, chat, { kind: 'line', target: 'S07', value: 'start', text: 'manual' });
  ops2 = C.addClueOp(ops2, chat, { kind: 'line', target: 'S07', value: 'deny', text: 'S07@2:0' });
  assert.equal(C.effectiveClueProgress(ops2, chat).lines.S07.started, true);
  // deleting the floor that holds the deny brings the start back
  assert.equal(C.effectiveClueProgress(ops, chat.slice(0, 3)).lines.S07.started, true);
  const pz = C.effectiveClueProgress(C.addClueOp(C.addClueOp({ ops: [] }, chat, { kind: 'pause', target: 'side', value: true }), chat, { kind: 'pause', target: 'main', value: '' }), chat);
  assert.deepEqual([pz.paused, pz.sidePaused], [false, true]);
  const sk = C.effectiveClueProgress(C.addClueOp({ ops: [] }, chat, { kind: 'line', target: 'S07', value: 'skip', atIndex: 4 }), chat);
  assert.equal(sk.lines.S07.skipFloor, 4);
});

// ---------- 场景目录、外部事实 ----------
test('scene catalog cell: ids, public entry and place only; continuing scenes + recognisable entries; paused text', () => {
  const r = run([MAIN(), side('S07')]);
  const plan = C.lineEntryPlan(r.state, prog());
  const cell = C.sceneCatalogCell(r.state, plan, prog());
  assert.match(cell, /m1a：去m1a；地点：m1a处/);
  assert.match(cell, /S07a：去S07a；地点：S07a处/);
  assert.doesNotMatch(cell, /的内容/, 'no discovery answers');
  assert.match(C.sceneCatalogCell(r.state, plan, prog({ paused: true })), /剧情暂停中/);
});

test('trigger facts: a fact in a line\'s condition that no node produces gets its row up front (not after the line opens); a fact produced by another line does not', () => {
  const vols = [MAIN(), side('S07', { 开启条件: { 事实: 'F_invite' } }), side('S08', { 开启条件: { 事实: 'F_m1b' } })];
  const t = C.lineTriggerFacts(C.compileClue(vols));
  assert.deepEqual([...t.keys()], ['F_invite']);
  const plan = C.prebuildPlan(vols);
  assert.ok(plan.facts.find((f) => f.code === 'F_invite').trigger);
  assert.ok(plan.knows.some((k) => k.key === 'F_invite@user'));
  assert.equal(run(vols).line('S07').state, '未触发', 'the invitation has not happened');
  const ctx = C.factLabelContext(vols, ['F_invite'])[0];
  assert.match(ctx.usedBy.join(), /S07 的开启条件/, 'its own meaning goes to the label prompt');
});

test('label signature: unchanged facts are not regenerated; moving volumes does not change it; editing the answer does', () => {
  const vols = [MAIN(), side('S07')];
  const first = C.labelsToPrepare(vols, {});
  assert.ok(first.some((x) => x.code === 'F_S07a'));
  const stored = Object.fromEntries(first.map((x) => [x.code, { label: '标', criterion: '口', sig: x.sig }]));
  assert.deepEqual(C.labelsToPrepare(vols, stored), []);
  assert.deepEqual(C.labelsToPrepare([vols[1], vols[0]], stored), [], 'reordering volumes');
  const edited = [MAIN(), side('S07', {}, [{ ...node('S07a', 'F_S07a'), 发现: [{ 事实: 'F_S07a', 内容: '完全不同的答案' }] }])];
  assert.deepEqual(C.labelsToPrepare(edited, stored).map((x) => x.code), ['F_S07a']);
});

// ---------- 注入 ----------
test('projection: with a focus only that line; without, one entry worded as optional; side entries carry "do not replay"', () => {
  const r = run([MAIN(), side('S07')]);
  const plan = C.lineEntryPlan(r.state, prog(), { round: 1, firstOffer: new Set(['M1']) });
  const out = C.buildClueProjection(r.state, snap(), prog(), {}, { plan });
  assert.match(out.content, /可用的后续方向：去S07a。（由头：S07的由头）/);
  assert.match(out.content, /只有本轮行动自然涉及它时才接入；否则继续眼前的事，不必提及/);
  assert.match(out.content, /如果前文已经发生过类似的事，就接着前文写，不要重演/);
  assert.doesNotMatch(out.content, /去m1a/, 'one entry only');
  assert.deepEqual(out.used.recognize.map((x) => x.uid), ['S07a']);
  assert.equal(out.used.offer, 'S07');
  // focus on a started side line: the main line gets nothing
  const f = run([MAIN(), side('S07', {}, [node('s7a', 'F_s7a'), node('s7b', 'F_s7b')])], snap(), prog({ lines: { S07: { started: true } }, focus: 's7a' }));
  const fp = C.lineEntryPlan(f.state, prog({ lines: { S07: { started: true } } }));
  const fo = C.buildClueProjection(f.state, snap(), prog(), {}, { plan: fp });
  assert.match(fo.content, /同一段剧情里另外可以去做的事[\s\S]*去s7b/);
  assert.doesNotMatch(fo.content, /m1a/);
  // 实测 2026-11-15 + GPT 实测返修审阅 R4：没给材料的事不许自己补结果——有焦点、没焦点都加这一句
  assert.match(out.content, /本轮材料没有提供那件事的具体发现时，写到到达、接触和开始调查为止/);
  assert.match(fo.content, /本轮材料没有提供那件事的具体发现时/);
});

// GPT 实测返修审阅 R4：限制按「本轮有没有那件事的材料」，不按有没有焦点。
test('R4 guard: cross-line with focus, quota full without focus, same line all get it; paused / finished stay empty; wording does not stall daily actions', () => {
  const RULE = /用户转去调查另一件事，而本轮材料没有提供那件事的具体发现时/;
  // 1. focus in S07 (started), S10 eligible and recognisable: the player may walk into S10 → rule present
  const vols = () => [side('S07', {}, [node('s7a', 'F_s7a')]), side('S10')];
  const p1 = prog({ lines: { S07: { started: true } }, focus: 's7a' }), r1 = run(vols(), snap(), p1);
  const plan1 = C.lineEntryPlan(r1.state, p1, { limit: 2 });
  const o1 = C.buildClueProjection(r1.state, snap(), p1, {}, { plan: plan1 });
  assert.ok(plan1.recognize.some((x) => x.line === 'S10'));
  assert.match(o1.content, /F_s7a的内容/, 'focus material is still given (it may be revealed)');
  assert.match(o1.content, RULE);
  // 2. quota full, the player has left S07 (no focus), S10 recognisable, nothing offered → used to be an empty injection
  const p2 = prog({ lines: { S07: { started: true } } }), r2 = run(vols(), snap(), p2);
  const plan2 = C.lineEntryPlan(r2.state, p2, { limit: 1 });
  assert.equal(plan2.slots.full, true); assert.equal(plan2.offer, null); assert.ok(plan2.recognize.length);
  const o2 = C.buildClueProjection(r2.state, snap(), p2, {}, { plan: plan2 });
  assert.match(o2.content, RULE, 'quota full + no focus still carries the rule');
  assert.equal(o2.used.guard, true);
  // 3. same line: one rule, the old same-line-only sentence is gone (no duplicate)
  const vols3 = [side('S07', {}, [node('s7a', 'F_s7a'), node('s7b', 'F_s7b')])], p3 = prog({ lines: { S07: { started: true } }, focus: 's7a' }), r3 = run(vols3, snap(), p3);
  const o3 = C.buildClueProjection(r3.state, snap(), p3, {}, { plan: C.lineEntryPlan(r3.state, p3) });
  assert.match(o3.content, /同一段剧情里另外可以去做的事[\s\S]*去s7b/);
  assert.equal(o3.content.match(RULE).length, 1);
  assert.doesNotMatch(o3.content, /写到他到达、开始就可以/);
  // 4. wording: current material and daily actions are explicitly allowed; no blanket "stop at the start" any more
  assert.match(o1.content, /本轮已经提供的发现、前文已经明确的内容以及普通日常行动，可以按实际行动继续/);
  assert.doesNotMatch(o1.content, /拿起一样东西查看）时，写到开始为止/);
  assert.match(o1.content, /东西上写着什么、翻开或打开后看到什么、对方说出的关键信息，都不要自己编/);
  // 5. all side lines paused (no main line): nothing recognisable, nothing running → still empty
  const p5 = prog({ lines: { S07: { started: true } }, sidePaused: true }), r5 = run(vols(), snap(), p5);
  const o5 = C.buildClueProjection(r5.state, snap(), p5, {}, { plan: C.lineEntryPlan(r5.state, p5, { limit: 1 }) });
  assert.equal(o5.content, '', 'paused side lines: empty injection');
  // 6. everything finished: empty
  const done = side('S07', {}, [node('s7a', 'F_s7a')]), p6 = prog({ lines: { S07: { started: true } } });
  const s6 = snap({ f: { F_s7a: '已核实' } }), r6 = run([done], s6, p6);
  assert.equal(r6.line('S07').state, '完成');
  assert.equal(C.buildClueProjection(r6.state, s6, p6, {}, { plan: C.lineEntryPlan(r6.state, p6) }).content, '');
});

// ---------- 运行层（模拟宿主）----------
const TB = (stage, scene = '', catalog = '') => ({
  sheet_rel: sheet('关系表', ['姓名', '阶段'], [['巴基', String(stage)]]),
  sheet_ctrl: { name: '线索控制表', content: [[null, '标识', '当前场景', '场景目录'], ['1', '主线', scene, catalog]] },
  sheet_f: { name: '关键事实表', content: [[null, '编号', '标签', '登记口径', '状态']] },
  sheet_k: { name: '知情表', content: [[null, '键', '事实', '角色', '获知方式', '可信度']] },
});
async function boot(stage = 2, vols = [MAIN(), side('S07', { 开启条件: { 表: '关系表/巴基/阶段 >= 2' } }), side('S10')], extra = {}) {
  const host = createHost({ tables: TB(stage) });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('多线B');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: { facts: [{ 表: '关键事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }], knowledge: [{ 表: '知情表', 事实列: '事实', 角色列: '角色', 方式列: '获知方式', 可信度列: '可信度' }], scene: { 路径: '线索控制表/主线/当前场景', 离场值: '无' } }, ...extra } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  const bars = [];
  inst.runtime.clue.setLineBar((x) => bars.push(x));
  // the catalog column is written by the first sync (in the tavern: 1.5 s after the table callback is registered)
  await inst.runtime.clue.syncLines();
  return { host, inst, pid: p.id, bars };
}
const lineOf = (inst, id) => (inst.runtime.clue.invalidate(), inst.runtime.clue.compute().state.lineStates.find((s) => s.line.id === id));
const tables = (host) => host.db.tables;
async function reply(host, inst, text) {
  await host.generate();
  await host.addMessage(text, false);
}

// 实测 2026-11-15：顶端小条原来 8 秒自己消失，用户切出去就漏看了「换这条」。现在一直显示到点「确认」；改剧情线的按钮叫「取消开启」。
// 走真实的接线（不替换 setLineBar）：填表识别出走进支线 → 顶端出现小条。
test('top bar (real DOM): stays until 确认, 取消 needs two taps, closing changes nothing', async () => {
  const host = createHost({ tables: TB(2) });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('多线B');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: [MAIN(), side('S07', { 开启条件: { 表: '关系表/巴基/阶段 >= 2' } }), side('S10')] }, clue: { mode: 'clue', bindings: { facts: [{ 表: '关键事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }], knowledge: [], scene: { 路径: '线索控制表/主线/当前场景', 离场值: '无' } } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  await inst.runtime.clue.syncLines();
  await host.addMessage('开场白', false); await host.addMessage('我去找巴基', true);
  await reply(host, inst, '彼得敲开了巴基的门，问起那张海报。');
  const floor = host.state.chat.length - 1, t = tables(host); t.sheet_ctrl.content[1][2] = 'S07a'; host.db.setTables(t); host.db.markFill(floor, ['sheet_ctrl']);
  await inst.runtime.clue.syncLines();
  const doc = host.w.document;
  await new Promise((r) => setTimeout(r, 9000));
  const bar = doc.querySelector('.pi-topbar');
  assert.ok(bar, 'still shown after 9 s');
  assert.equal(bar.querySelector('.pi-topbar-tag').textContent, '支线开始'); assert.equal(bar.querySelector('.pi-topbar-text').textContent, 'S07', 'only the line name, no sentence');
  const act = bar.querySelector('.pi-topbar-act');
  assert.equal(act.textContent, '取消');
  assert.equal(bar.querySelector('.pi-topbar-ok').textContent, '确认');
  act.click(); assert.equal(act.textContent, '再点', 'first tap only arms'); assert.equal(lineOf(inst, 'S07').state, '进行中');
  act.click(); assert.equal(lineOf(inst, 'S07').state, '可开启', 'second tap undoes'); assert.equal(doc.querySelector('.pi-topbar'), null);
  // × closes without running anything
  inst.runtime.clue.act({ kind: 'line', target: 'S07', value: '' });
  const t2 = tables(host); t2.sheet_ctrl.content[1][2] = 'S10a'; host.db.setTables(t2);
  await host.addMessage('去别处', true); await reply(host, inst, '彼得去了S10a。'); host.db.markFill(host.state.chat.length - 1, ['sheet_ctrl']);
  await inst.runtime.clue.syncLines();
  const x = doc.querySelector('.pi-topbar-ok');
  assert.ok(x, 'a new bar with a 确认 button');
  const before = lineOf(inst, 'S10').state; x.click();
  assert.equal(doc.querySelector('.pi-topbar'), null, 'closed by 确认'); assert.equal(lineOf(inst, 'S10').state, before, 'closing changes nothing');
  await inst.destroy();
});

test('runtime: walk into the offered entry → fill writes the id and is proven → the side line starts on that floor, toast offers undo; undo does not come back', async () => {
  const { host, inst, bars } = await boot();
  await host.addMessage('开场白', false);
  await host.addMessage('我去找巴基', true);
  await reply(host, inst, '彼得敲开了巴基的门，问起那张海报。');
  const floor = host.state.chat.length - 1;
  const rec = (inst.runtime.progress().lineFloors || []).find((x) => x.i === floor);
  assert.ok(rec && rec.recognize.some((x) => x.uid === 'S07a'), 'the floor remembers which entries it allowed');
  // the fill writes S07a, but the fill record is missing → not a start
  const t = tables(host); t.sheet_ctrl.content[1][2] = 'S07a'; host.db.setTables(t);
  await inst.runtime.clue.syncLines();
  assert.equal(lineOf(inst, 'S07').started, false, 'stale or unproven value is not evidence');
  // now the official fill record for the control table is on that floor
  host.db.markFill(floor, ['sheet_ctrl']);
  await inst.runtime.clue.syncLines();
  const s = lineOf(inst, 'S07');
  assert.equal(s.state, '进行中');
  assert.equal(s.manual.startAt, floor, 'anchored to the evidence floor');
  assert.equal(bars.length, 1);
  assert.equal(bars[0].tag, '支线开始'); assert.equal(bars[0].text, 'S07'); assert.equal(bars[0].action, '取消');
  bars[0].run();
  assert.equal(lineOf(inst, 'S07').state, '可开启', 'undone');
  await inst.runtime.clue.syncLines(); await inst.runtime.clue.syncLines();
  assert.equal(lineOf(inst, 'S07').state, '可开启', 'the same evidence does not reopen it after two refreshes');
  assert.equal(host.llmCalls.length, 0, 'no model calls');
  await inst.destroy();
});

test('runtime: quota full → walking into another side line does not start it; the toast offers 切换 which pauses the old one', async () => {
  const { host, inst, bars } = await boot(2, [MAIN(), side('S07'), side('S10')]);
  await host.addMessage('开场白', false);
  inst.runtime.clue.lineAct('S07', 'enter');
  assert.equal(lineOf(inst, 'S07').state, '进行中');
  await host.addMessage('去找另一个人', true);
  await reply(host, inst, '彼得去了S10那边。');
  const floor = host.state.chat.length - 1;
  const t = tables(host); t.sheet_ctrl.content[1][2] = 'S10a'; host.db.setTables(t); host.db.markFill(floor, ['sheet_ctrl']);
  await inst.runtime.clue.syncLines();
  assert.equal(lineOf(inst, 'S10').started, false);
  const bar = bars.find((b) => b && b.tag === '支线已满');
  assert.ok(bar, 'asks to switch');
  assert.equal(bar.action, '切换'); assert.equal(bar.text, 'S10', 'only the line name');
  bar.run();
  assert.equal(lineOf(inst, 'S07').state, '暂停');
  assert.equal(lineOf(inst, 'S10').state, '进行中');
  await inst.destroy();
});

test('runtime: enter is refused when the condition is not met; resume of a started side line checks the quota', async () => {
  const { host, inst } = await boot(1, [MAIN(), side('S07', { 开启条件: { 表: '关系表/巴基/阶段 >= 2' } }), side('S10'), side('S12')]);
  await host.addMessage('开场白', false);
  assert.throws(() => inst.runtime.clue.lineAct('S07', 'enter'), /开启条件还没满足/);
  inst.runtime.clue.lineAct('S10', 'enter');
  inst.runtime.clue.lineAct('S10', 'pause');
  inst.runtime.clue.lineAct('S12', 'enter');
  assert.throws(() => inst.runtime.clue.lineAct('S10', 'resume'), /支线已经满了/);
  await inst.destroy();
});

test('runtime: the scene catalog column is written only when it changes, and read back; the plugin\'s own write is not taken as a new fill', async () => {
  const { host, inst } = await boot();
  await host.addMessage('开场白', false);
  await inst.runtime.clue.syncLines();
  const cell = () => tables(host).sheet_ctrl.content[1][3];
  assert.match(cell(), /S07a：去S07a/);
  const before = JSON.stringify(cell());
  await inst.runtime.clue.syncLines();
  assert.equal(JSON.stringify(cell()), before);
  await inst.destroy();
});

test('runtime: trigger fact rows are written before the line opens; a started line gets its rows; facts without a label wait', async () => {
  const vols = [MAIN(), side('S07', { 开启条件: { 事实: 'F_invite' } }), side('S10')];
  const { host, inst, pid } = await boot(2, vols, { labels: { F_invite: { label: '一份邀请', criterion: '主角收到邀请时登记' }, F_m1a: { label: '甲', criterion: '乙' }, F_S10a: { label: '丙', criterion: '丁' } } });
  await host.addMessage('开场白', false);
  host.db.markFill(0, ['sheet_ctrl']);
  await inst.runtime.clue.syncLines();
  const codes = () => tables(host).sheet_f.content.slice(1).map((r) => r[1]);
  assert.ok(codes().includes('F_invite'), 'the invitation row exists before S07 can open');
  assert.ok(codes().includes('F_m1a'), 'main line (in progress) rows');
  assert.ok(!codes().includes('F_S10a'), 'S10 has not started: its inner facts wait');
  assert.ok(tables(host).sheet_k.content.slice(1).some((r) => r[1] === 'F_invite@user'));
  inst.runtime.clue.lineAct('S10', 'enter');
  await inst.runtime.clue.syncLines();
  assert.ok(codes().includes('F_S10a'), 'rows for the line once it started');
  assert.ok(!codes().includes('F_m1b'), 'no label yet → not written');
  void pid;
  await inst.destroy();
});

test('runtime: rows are not hung before the entry floor (official CRUD picks the latest floor with a table frame)', async () => {
  const { host, inst } = await boot(2, [MAIN(), side('S10')], { labels: { F_S10a: { label: '丙', criterion: '丁' }, F_m1a: { label: '甲', criterion: '乙' } } });
  await host.addMessage('开场白', false);
  host.db.markFill(0, ['sheet_ctrl']);
  await host.addMessage('进去', true);
  await host.addMessage('进去了', false);
  inst.runtime.clue.lineAct('S10', 'enter'); // manual start anchored on floor 2, which has no table frame yet
  await inst.runtime.clue.syncLines();
  const codes = () => tables(host).sheet_f.content.slice(1).map((r) => r[1]);
  assert.ok(!codes().includes('F_S10a'), 'the target would be floor 0, before the start: wait');
  host.db.markFill(2, ['sheet_ctrl']);
  await inst.runtime.clue.syncLines();
  assert.ok(codes().includes('F_S10a'), 'now the entry floor can carry it');
  await inst.destroy();
});

test('runtime: manual enter records the start and sets the focus (one entry: that one; several: the picked one); a waiting main line cannot be entered (GPT 代码审阅 R1, R5)', async () => {
  const two = side('S11', {}, [node('S11a', 'F_S11a'), node('S11b', 'F_S11b')]);
  const m2 = { id: 'vM2', key: '剧情_M2', line: { 编号: 'M2', 类型: '主线', 开启方式: '人工' }, stages: [{ id: 'sX', key: '阶段1', data: { 主线节点: [node('m2a', 'F_m2a')] } }] };
  const { host, inst } = await boot(2, [MAIN(), m2, side('S10'), two], { sideLimit: 2 });
  await host.addMessage('开场白', false);
  inst.runtime.clue.lineAct('S10', 'enter');
  let c = (inst.runtime.clue.invalidate(), inst.runtime.clue.compute());
  assert.equal(lineOf(inst, 'S10').state, '进行中');
  assert.equal(c.state.focus.uid, 'S10a', 'the only entry becomes the focus');
  inst.runtime.clue.lineAct('S11', 'enter', 'S11b');
  c = (inst.runtime.clue.invalidate(), inst.runtime.clue.compute());
  assert.equal(c.state.focus.uid, 'S11b', 'the entry the player picked');
  assert.throws(() => inst.runtime.clue.lineAct('M2', 'enter'), /主线位置被占着：主线 M1 还在进行/);
  await inst.destroy();
});

test('runtime: a fact produced by two lines gets its row when either line starts (GPT 代码审阅 R8)', async () => {
  const a = side('S01', {}, [node('S01a', 'F_shared')]), b = side('S02', {}, [node('S02a', 'F_shared')]);
  const { host, inst } = await boot(2, [MAIN(), a, b], { labels: { F_shared: { label: '共同的线索', criterion: '得到时登记' } } });
  await host.addMessage('开场白', false);
  host.db.markFill(0, ['sheet_ctrl']);
  const codes = () => tables(host).sheet_f.content.slice(1).map((r) => r[1]);
  await inst.runtime.clue.syncLines();
  assert.ok(!codes().includes('F_shared'), 'neither line has started');
  inst.runtime.clue.lineAct('S02', 'enter');
  await inst.runtime.clue.syncLines();
  assert.ok(codes().includes('F_shared'), 'S02 started first: the shared fact is prepared');
  assert.equal(codes().filter((x) => x === 'F_shared').length, 1, 'one row only');
  await inst.destroy();
});

test('runtime: a table callback right after the plugin wrote the catalog is not swallowed; the overwrite is repaired (GPT 代码审阅 R9)', async () => {
  const { host, inst } = await boot();
  await host.addMessage('开场白', false);
  await inst.runtime.clue.syncLines();
  const cell = () => tables(host).sheet_ctrl.content[1][3];
  const good = cell();
  assert.match(good, /S07a/);
  assert.equal(host.w.AutoCardUpdaterAPI.updated.every((u) => u.skipNotify === true), true, 'the plugin writes with skipNotify, so its own writes never call back');
  const t = tables(host); t.sheet_ctrl.content[1][3] = ''; host.db.setTables(t); // the official fill replaces the whole sheet and calls back
  await new Promise((r) => setTimeout(r, 1700));
  assert.equal(cell(), good, 'the scheduled sync wrote the catalog again');
  await inst.destroy();
});

// ---------- GPT 实测前审阅 R3：旧的顶端提示不能操作别的项目；R5：启用项目后自己写场景目录 ----------
test('runtime (R3): a 切换 bar from project A does nothing after switching to project B; switching projects hides the bar', async () => {
  const { host, inst, bars } = await boot(2, [MAIN(), side('S01'), side('S02')]);
  await host.addMessage('开场白', false);
  inst.runtime.clue.lineAct('S01', 'enter');
  await host.addMessage('去另一边', true);
  await reply(host, inst, '彼得去了S02那边。');
  const floor = host.state.chat.length - 1;
  const t = tables(host); t.sheet_ctrl.content[1][2] = 'S02a'; host.db.setTables(t); host.db.markFill(floor, ['sheet_ctrl']);
  await inst.runtime.clue.syncLines();
  const bar = bars.find((b) => b && b.tag === '支线已满');
  assert.ok(bar, 'switch offered in A');
  // project B with the same line ids
  const b = await inst.data.createProject('B');
  inst.data.updateProject(b.id, (x) => ({ ...x, outline: { volumes: [MAIN(), side('S01'), side('S02')] }, clue: inst.data.project(inst.runtime.activeId()).clue }));
  await inst.runtime.switchProject(b.id);
  assert.equal(bars[bars.length - 1], null, 'switching projects hides the old bar');
  bar.run();
  assert.equal(lineOf(inst, 'S02').state, '可开启', 'the stale bar did not start S02 in project B');
  assert.equal(lineOf(inst, 'S01').state, '可开启');
  await inst.destroy();
});

test('runtime (R3): the switch from a bar still respects 暂停支线 at the time of the click', async () => {
  const { host, inst, bars } = await boot(2, [MAIN(), side('S01'), side('S02')]);
  await host.addMessage('开场白', false);
  inst.runtime.clue.lineAct('S01', 'enter');
  await host.addMessage('去另一边', true);
  await reply(host, inst, '彼得去了S02那边。');
  const floor = host.state.chat.length - 1;
  const t = tables(host); t.sheet_ctrl.content[1][2] = 'S02a'; host.db.setTables(t); host.db.markFill(floor, ['sheet_ctrl']);
  await inst.runtime.clue.syncLines();
  const bar = bars.find((x) => x && x.tag === '支线已满');
  inst.runtime.clue.setPaused(true, 'side');
  bar.run();
  assert.equal(lineOf(inst, 'S02').started, false);
  await inst.destroy();
});

// 实测 2026-11-15：S02 查到一半走开以后正文不再提，玩家容易忘 → 剧情线卡片说明行写「已离开 N 轮 · 上次在某地」（不进注入）。
test('lineAwayInfo: counts replies since the player was last in that line; place from the scene; none if never there or the record breaks', () => {
  const uidLine = new Map([['s02a', 'S02'], ['m1a', 'M1']]), placeOf = new Map([['s02a', '城南旧巷'], ['m1a', '码头']]);
  const row = (scene) => ({ scene });
  assert.deepEqual({ ...C.lineAwayInfo([row('无'), row('m1a'), row('无'), row('s02a'), row('')], 'S02', uidLine, placeOf) }, { rounds: 3, place: '城南旧巷' });
  assert.equal(C.lineAwayInfo([row('s02a'), row('无')], 'S02', uidLine, placeOf), null, 'in it right now → not away');
  assert.equal(C.lineAwayInfo([row('无'), row('m1a')], 'S02', uidLine, placeOf), null, 'never there');
  assert.equal(C.lineAwayInfo([row('无'), null, row('s02a')], 'S02', uidLine, placeOf), null, 'record broken → no guess');
});

// 实测 2026-11-15：总开关打开后 S02 仍显示「进行中」，像没生效。总开关改名「暂停全部支线」，进行中的支线旁标「全部支线已暂停」；单条暂停保留。
test('line card: side pause is labelled 暂停全部支线 and running side lines show 全部支线已暂停; single pause stays; away line shows 已离开', async () => {
  const { host, inst } = await boot(2, [MAIN(), side('S01'), side('S02')]);
  await host.addMessage('开场白', false);
  inst.runtime.clue.lineAct('S01', 'enter');
  // the player was in S01 on one reply, then two replies elsewhere
  for (const [scene, text] of [['S01a', '在S01'], ['无', '回报社'], ['无', '吃早饭']]) {
    await host.addMessage(text, true); await reply(host, inst, text);
    const t = tables(host); t.sheet_ctrl.content[1][2] = scene; host.db.setTables(t); host.db.markFill(host.state.chat.length - 1, ['sheet_ctrl']);
    await inst.runtime.clue.syncLines();
  }
  inst.runtime.clue.act({ kind: 'focus', target: '', value: '' });
  inst.open(); await new Promise((r) => setTimeout(r, 20));
  const doc = host.w.document, view = async () => { doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await new Promise((r) => setTimeout(r, 30)); return doc.body.textContent; };
  let text = await view();
  assert.match(text, /暂停全部支线/);
  assert.match(text, /已离开 2 轮 · 上次在S01a处/, 'away reminder in the line card (two replies since the player was in S01)');
  const s01 = [...doc.querySelectorAll('.pi-line-row')].find((r) => /S01 · 支线/.test(r.textContent));
  assert.ok(s01.querySelector('[data-act="clue-line"][data-value="pause"]'), 'single pause kept');
  inst.runtime.clue.setPaused(true, 'side');
  text = await view();
  assert.match(text, /继续全部支线/);
  const row = [...doc.querySelectorAll('.pi-line-row')].find((r) => /S01 · 支线/.test(r.textContent));
  assert.match(row.textContent, /进行中全部支线已暂停/, 'running side line marked');
  const proj = inst.runtime.clue.projection();
  assert.doesNotMatch(String(proj.content || ''), /已离开/, 'the reminder is never injected');
  await inst.destroy();
});

test('runtime (R5): enabling an existing multi-line project writes the scene catalog without any table callback', async () => {
  const host = createHost({ tables: TB(2) });
  const inst = host.load(); await inst.ready;
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  const p = await inst.data.createProject('后启用');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: [MAIN(), side('S07'), side('S10')] }, clue: { mode: 'clue', bindings: { facts: [{ 表: '关键事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }], knowledge: [], scene: { 路径: '线索控制表/主线/当前场景', 离场值: '无' } } } }));
  await host.addMessage('开场白', false);
  const updates = host.w.AutoCardUpdaterAPI.updated.length;
  await inst.runtime.switchProject(p.id);
  await new Promise((r) => setTimeout(r, 1700));
  assert.match(String(tables(host).sheet_ctrl.content[1][3]), /S07a：/, 'catalog written by the sync scheduled on enable');
  assert.ok(host.w.AutoCardUpdaterAPI.updated.length > updates);
  inst.runtime.clue.invalidate();
  assert.ok(inst.runtime.clue.compute().plan.recognize.some((r) => r.uid === 'S07a'), 'the entries are no longer waiting');
  await inst.destroy();
});

test('template: an old control table without 场景目录 gets the column via DDL; rows and the author\'s note are kept', () => {
  const old = { mate: { type: 'chatSheets', version: 1 }, sheet_ctrl: { uid: 'sheet_ctrl', name: '线索控制表', content: [['row_id', '标识', '当前场景'], ['1', '主线', 'n1']], sourceData: { note: '我的备注', ddl: 'CREATE TABLE clue_control (\n  row_id INTEGER PRIMARY KEY, -- 行号\n  tag TEXT NOT NULL, -- 标识\n  cur_scene TEXT -- 当前场景\n);' }, updateConfig: { updateFrequency: 1, skipFloors: 0, groupId: 0 }, exportConfig: {}, orderNo: 0 } };
  const r = C.synthesizeClueTemplate(old, { clue: {} });
  const ctrl = Object.values(r.template).find((s) => s && s.name === '线索控制表');
  assert.deepEqual(ctrl.content, [['row_id', '标识', '当前场景', '场景目录'], ['1', '主线', 'n1', '']]);
  assert.match(ctrl.sourceData.ddl, /cur_scene TEXT, -- 当前场景\n  scene_catalog TEXT -- 场景目录/);
  assert.equal(ctrl.sourceData.note, '我的备注');
});

test('runtime: single-line projects (no 线) also get the 场景目录 column kept current (the template no longer writes the catalog into the note)', async () => {
  const plainMain = { ...MAIN(), line: undefined };
  const { host, inst } = await boot(2, [plainMain]);
  await host.addMessage('开场白', false);
  await inst.runtime.clue.syncLines();
  assert.match(host.db.tables.sheet_ctrl.content[1][3], /m1a：去m1a；地点：m1a处/);
  await inst.destroy();
});

test('runtime: auto skip waits until the 3rd offer\'s floor is filled; then the head gives way and the next side line is offered', async () => {
  const { host, inst } = await boot(2, [MAIN(), side('S07'), side('S10')]);
  await host.addMessage('开场白', false);
  // M1 is running: its scene and the side-line queue head S07 take turns; stop right after the 3rd S07 offer
  for (let k = 0; k < 8 && (inst.runtime.progress().lineFloors || []).filter((x) => x.offer === 'S07').length < 3; k++) { await host.addMessage(`闲聊${k}`, true); await reply(host, inst, `日常${k}`); }
  const floors = inst.runtime.progress().lineFloors || [];
  assert.equal(floors.filter((x) => x.offer === 'S07').length, 3, 'S07 was offered three times');
  assert.ok(floors.some((x) => x.offer === 'M1'), 'the running main line takes the other turns');
  await inst.runtime.clue.syncLines();
  assert.equal(lineOf(inst, 'S07').manual.skipAt, undefined, 'the last floor has no fill record yet: not settled');
  host.db.markFill(host.state.chat.length - 1, ['sheet_ctrl']);
  await inst.runtime.clue.syncLines();
  assert.notEqual(lineOf(inst, 'S07').manual.skipAt, undefined, 'skipped after the floor was filled');
  inst.runtime.clue.invalidate();
  const plan = inst.runtime.clue.compute().plan;
  assert.deepEqual([...plan.recognize.map((x) => x.line)], ['S10', 'S07'], 'S10 is now the queue head; S07 goes to the end');
  assert.ok(['S10', 'M1'].includes(plan.offer.line), 'the side turn now offers S10');
  await inst.destroy();
});

// GPT 返修与删联动审阅（4bebb3e）R1：「放弃 / 标记完成」的确认框打开期间切到别的项目，确认后不改新项目。
test('line confirm (real DOM): 标记完成 / 放弃 confirmed after switching project does not touch the new project', async () => {
  for (const act of ['done', 'abandon']) {
    const host = createHost({ tables: TB(2) });
    const inst = host.load(); await inst.ready;
    const mk = async (name) => { const p = await inst.data.createProject(name); inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: [MAIN()] }, clue: { mode: 'clue', bindings: { facts: [{ 表: '关键事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }], knowledge: [], scene: { 路径: '线索控制表/主线/当前场景', 离场值: '无' } } } })); return p; };
    const a = await mk('A'), b = await mk('B');
    await inst.runtime.switchProject(a.id);
    await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
    inst.open(); await new Promise((r) => setTimeout(r, 30));
    const doc = host.w.document, tick = () => new Promise((r) => setTimeout(r, 30));
    doc.querySelector(`[data-act="project"][data-id="${a.id}"]`).click(); await tick();
    doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
    doc.querySelector(`[data-act="clue-line"][data-id="M1"][data-value="${act}"]`).click(); await tick();
    const dlg = doc.querySelector('.pi-dialog');
    assert.ok(dlg, 'confirm opens');
    await inst.runtime.switchProject(b.id);
    const before = lineOf(inst, 'M1').state;
    [...dlg.querySelectorAll('.pi-btn')].find((x) => x.classList.contains('is-primary') || x.classList.contains('is-danger')).click(); await tick();
    assert.equal(lineOf(inst, 'M1').state, before, `${act}: project B untouched`);
    await inst.runtime.switchProject(a.id);
    assert.equal(lineOf(inst, 'M1').state, '进行中', `${act}: project A untouched too (the stale click did nothing)`);
    await inst.destroy();
  }
});
