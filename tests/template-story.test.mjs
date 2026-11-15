// End-to-end on the shipped clue-table template + binding + sample story (built script, simulated host).
// Covers acceptance scenarios: new NPC table discipline is the fill model's job (not testable here),
// multi-floor investigation, claim vs verified, knowledge difference, leave scene, rollback, original mode untouched.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { buildTemplate, BINDING_YAML } from '../templates/clue-tables/build-template.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const storyText = fs.readFileSync(path.join(here, '../templates/clue-tables/示例_小镇失窃案.yaml'), 'utf8');
const SECRET = '真正的小偷是老板娘的侄子阿伟';
// Tests of the experimental plot-link fill-candidate hook ($L): skipped when running against the official-API host (PI_OFFICIAL=1).
const LINK_ONLY = { skip: process.env.PI_OFFICIAL ? 'experimental plot-link only' : false };

// Simulate the database's live table data after importing the template: row_id assigned, rows as content.
function liveTables(t) {
  const out = JSON.parse(JSON.stringify(t));
  for (const [k, s] of Object.entries(out)) if (k.startsWith('sheet_')) s.content = s.content.map((row, i) => (i === 0 ? row : [i, ...row.slice(1)]));
  return out;
}
const base = () => buildTemplate({
  controlRow: ['主线', ''],
  factRows: [{ code: 'F_box', label: '钱箱撬痕' }, { code: 'F_ledger', label: '撕掉的账页' }, { code: 'F_seen', label: '邻居目击' }, { code: 'F_print', label: '后门门闩' }, { code: 'F_talk', label: '修车铺对话' }],
  knowRows: [{ fact: 'F_seen', actor: 'user' }, { fact: 'F_seen', actor: '老板娘' }, { fact: 'F_ledger', actor: 'user' }, { fact: 'F_ledger', actor: '老板娘' }],
});
// Fill-model simulation helpers: change cells by row key, like the SQL examples in the template notes.
function setCell(t, sheetName, key, col, value) {
  const s = Object.values(t).find((x) => x && x.name === sheetName);
  const ci = s.content[0].indexOf(col);
  const row = s.content.find((r, i) => i > 0 && r[1] === key);
  row[ci] = value;
}

async function setup() {
  const tables = liveTables(base());
  const host = createHost({ tables });
  const inst = host.load();
  await inst.ready;
  const p = await inst.data.createProject('小镇失窃案');
  const volumes = Object.entries(YAML.parse(storyText)).map(([key, stages], vi) => ({ id: `v${vi}`, key, stages: Object.entries(stages).map(([sk, data], si) => ({ id: `s${vi}_${si}`, key: sk, data })) }));
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML) } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  return { host, inst, tables, pid: p.id };
}
const statusOf = (inst) => Object.fromEntries(inst.runtime.clue.compute().state.nodeStates.map((s) => [s.node.uid, s.status]));
const commit = (host, tables) => { host.db.setTables(tables); host.db.commit(host.state.chat.length - 1); };

test('template + binding: no binding problems, first node active, secret never injected', async () => {
  const { host, inst } = await setup();
  const c = inst.runtime.clue.compute();
  assert.deepEqual(JSON.parse(JSON.stringify(c.snap.problems)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(c.compiled.errors)), []);
  assert.equal(statusOf(inst).n_report, 'active');
  const r = await host.send('去杂货店');
  assert.match(r.text, /钱箱被撬开/);
  assert.ok(!r.text.includes(SECRET) && !r.round.preContext.includes(SECRET));
  await inst.destroy();
});

test('main paused → no clue material; scene cell drives focus', async () => {
  const { host, inst, tables } = await setup();
  inst.runtime.clue.setPaused(true);
  assert.ok(!(await host.send('x')).text.includes('钱箱'));
  inst.runtime.clue.setPaused(false);
  setCell(tables, '关键事实表', 'F_box', '状态', '已核实'); commit(host, tables);
  // stage 2: two parallel nodes, no scene yet → no focus (no keyword guessing)
  assert.equal(inst.runtime.clue.compute().state.focus.uid, '');
  // the scene cell (filled by the fill model when the player actually enters) picks the focus
  setCell(tables, '线索控制表', '主线', '当前场景', 'n_witness'); commit(host, tables);
  const c = inst.runtime.clue.compute();
  assert.equal(c.state.focus.uid, 'n_witness');
  assert.equal(c.state.focus.source, 'table');
  await inst.destroy();
});

test('claim vs verified + knowledge difference: 存疑 is not 已核实; user knows, 老板娘 does not; stage 3 opens on user knowledge only', async () => {
  const { host, inst, tables } = await setup();
  setCell(tables, '关键事实表', 'F_box', '状态', '已核实');
  setCell(tables, '关键事实表', 'F_ledger', '状态', '已核实');
  // the old neighbour SAYS he saw someone → claim, not verified
  setCell(tables, '关键事实表', 'F_seen', '状态', '存疑');
  commit(host, tables);
  let st = statusOf(inst);
  assert.notEqual(st.n_witness, 'done', 'F_seen only 存疑 → node not done by fact');
  assert.equal(st.n_confront, 'locked');
  // user heard it from the neighbour (被告知, 未核实) → 知情 satisfied; 老板娘 still 未知
  setCell(tables, '知情表', 'F_seen@user', '获知方式', '被告知');
  commit(host, tables);
  st = statusOf(inst);
  assert.equal(st.n_witness, 'done', '完成条件 任一: 知情 F_seen@user');
  assert.notEqual(st.n_confront, 'locked', 'stage 3 entered: ledger fact + user knows the sighting');
  const c = inst.runtime.clue.compute();
  const env = { facts: c.snap.facts, knowledge: c.snap.knowledge, tables: c.snap.tables, nodeDone: () => false };
  const loadCore = (await import('./load.mjs')).loadCore();
  assert.notEqual(loadCore.evalCondition(loadCore.parseCondition({ 知情: 'F_seen@老板娘' }), env).v, 'true', '老板娘 未知 → not propagated (pre-built 未知 row is not a knowledge record)');
  assert.equal(loadCore.evalCondition(loadCore.parseCondition({ 核实: 'F_seen@user' }), env).v, 'false', 'told ≠ verified');
  await inst.destroy();
});

test('rollback: deleting the floor whose fill set F_box restores the earlier table → node back to active', async () => {
  const { host, inst, tables } = await setup();
  await host.send('去杂货店', { reply: '你仔细看了钱箱，锁是从里面撬开的。' });
  const before = JSON.parse(JSON.stringify(tables));
  setCell(tables, '关键事实表', 'F_box', '状态', '已核实'); commit(host, tables);
  assert.equal(statusOf(inst).n_report, 'done');
  // database replays frames on delete → tables back to before; plugin recomputes
  host.state.chat.pop();
  host.db.setTables(before);
  await host.eventSource.emit(host.eventTypes.MESSAGE_DELETED, 1);
  assert.equal(statusOf(inst).n_report, 'active');
  await inst.destroy();
});

test('fill candidates for the sample: record rules reach the fill request; answers do not', LINK_ONLY, async () => {
  const { host, inst } = await setup();
  await host.send('去杂货店', { reply: '你和老板娘聊了几句。' });
  const cand = host.db.fillCandidates([1]);
  assert.match(cand, /F_box：主角亲自查看钱箱并看出撬痕方向时，记 F_box 为已核实/);
  assert.ok(!cand.includes('从里面被撬开'), 'discovery answer text is not repeated in the fill request');
  await inst.destroy();
});

test('parallel nodes, no focus: fill request lists scene ids so the fill model can write 当前场景 (regression)', LINK_ONLY, async () => {
  const { host, inst, tables } = await setup();
  setCell(tables, '关键事实表', 'F_box', '状态', '已核实'); commit(host, tables);
  assert.equal(inst.runtime.clue.compute().state.focus.uid, '', 'two parallel nodes, nobody chose → no focus');
  const r = await host.send('先去隔壁问问', { reply: '你走进裁缝铺，老人抬起头。' });
  assert.match(r.text, /去问问隔壁裁缝铺的邻居/);
  const idx = host.state.chat.length - 1;
  const cand = host.db.fillCandidates([idx]);
  assert.match(cand, /只能照抄下面列出的编号/);
  assert.match(cand, /明确离开调查、转去做无关的事，填「离场」/);
  assert.match(cand, /n_witness：去问问隔壁裁缝铺的邻居；地点：裁缝铺/);
  assert.match(cand, /n_ledger：翻一翻店里的账本/);
  assert.ok(!cand.includes('年轻人') && !cand.includes('赊账') && !cand.includes('问邻居'), 'no discovery text, no node titles');
  // fill model copies the id → focus follows
  setCell(tables, '线索控制表', '主线', '当前场景', 'n_witness'); commit(host, tables);
  assert.equal(inst.runtime.clue.compute().state.focus.uid, 'n_witness');
  await inst.destroy();
});

test('no scene binding → no scene ids in the fill request', LINK_ONLY, async () => {
  const { host, inst, tables, pid } = await setup();
  const b = YAML.parse(BINDING_YAML); delete b.scene;
  inst.data.updateProject(pid, (x) => ({ ...x, clue: { ...x.clue, bindings: b } }));
  setCell(tables, '关键事实表', 'F_box', '状态', '已核实'); commit(host, tables);
  await host.send('先去隔壁问问', { reply: '你走进裁缝铺。' });
  assert.equal(host.db.fillCandidates([host.state.chat.length - 1]), '', 'only leads, no scene cell to fill → nothing to say');
  await inst.destroy();
});

// ---------- GPT review §10 (T1–T9) ----------
test('T1: bound 方式列 missing → that knowledge table is skipped and reported, pre-built 未知 rows are NOT knowledge', async () => {
  const { host, inst, tables, pid } = await setup();
  const b = YAML.parse(BINDING_YAML); b.knowledge[0].方式列 = '获知途径';
  inst.data.updateProject(pid, (x) => ({ ...x, clue: { ...x.clue, bindings: b } }));
  setCell(tables, '关键事实表', 'F_box', '状态', '已核实'); commit(host, tables);
  const c = inst.runtime.clue.compute();
  assert.equal(c.snap.knowledge.length, 0);
  assert.ok(c.snap.problems.some((p) => p.includes('缺少方式列「获知途径」')));
  assert.notEqual(statusOf(inst).n_witness, 'done', 'old neighbour has not spoken');
  await inst.destroy();
});

test('T1: unknown way word (JSON mode, no CHECK) is not a knowledge record and is reported', async () => {
  const { host, inst, tables } = await setup();
  setCell(tables, '知情表', 'F_seen@user', '获知方式', '不知情'); commit(host, tables);
  const c = inst.runtime.clue.compute();
  assert.equal(c.snap.knowledge.length, 0);
  assert.ok(c.snap.problems.some((p) => p.includes('「不知情」')));
  await inst.destroy();
});

test('T4: an aborted generation does not leave its candidates for the next floor', async () => {
  const { host, inst, tables } = await setup();
  setCell(tables, '关键事实表', 'F_box', '状态', '已核实');
  setCell(tables, '线索控制表', '主线', '当前场景', 'n_witness'); commit(host, tables);
  // assemble a request with F_seen candidates, then the user stops it — no reply
  await host.addMessage('问老人', true);
  await host.eventSource.emit(host.eventTypes.GENERATION_STARTED, 'normal', {}, false);
  assert.match((await host.worldInfo()).map((e) => e.content).join(''), /年轻人/);
  await host.eventSource.emit(host.eventTypes.GENERATION_STOPPED);
  // main paused, then a normal floor: no clue material → no candidates for this floor
  inst.runtime.clue.setPaused(true);
  const r = await host.send('随便聊聊', { reply: '你们聊了天气。' });
  assert.ok(!r.text.includes('年轻人'));
  assert.equal(host.db.fillCandidates([host.state.chat.length - 1]), '');
  await inst.destroy();
});

test('T4: an empty projection also clears the pending candidates (no stop event)', async () => {
  const { host, inst, tables } = await setup();
  setCell(tables, '关键事实表', 'F_box', '状态', '已核实');
  setCell(tables, '线索控制表', '主线', '当前场景', 'n_witness'); commit(host, tables);
  await host.eventSource.emit(host.eventTypes.GENERATION_STARTED, 'normal', {}, false);
  await host.worldInfo();
  inst.runtime.clue.setPaused(true);
  await host.worldInfo(); // re-assembled, now empty
  await host.addMessage('回复', false);
  assert.equal(host.db.fillCandidates([host.state.chat.length - 1]), '');
  await inst.destroy();
});

test('T5: no floor list → nothing; outline mode → nothing', LINK_ONLY, async () => {
  const { host, inst, pid } = await setup();
  await host.send('去杂货店', { reply: '你和老板娘聊了几句。' });
  assert.match(host.db.fillCandidates([1]), /F_box/);
  assert.equal(host.db.fillCandidates([]), '');
  inst.data.updateProject(pid, (x) => ({ ...x, clue: { ...x.clue, mode: 'outline' } }));
  inst.runtime.clue.invalidate();
  assert.equal(host.db.fillCandidates([1]), '');
  await inst.destroy();
});

test('T6: obtained discovery shows the recorded text and its holders, not the author answer', async () => {
  const { host, inst, tables } = await setup();
  setCell(tables, '关键事实表', 'F_box', '状态', '已核实');
  setCell(tables, '关键事实表', 'F_box', '内容', '主角看见锁上有一道撬痕');
  commit(host, tables);
  // n_report is done now, so look at the projection directly through the core with the node as focus
  const c = inst.runtime.clue.compute();
  const core = (await import('./load.mjs')).loadCore();
  const state = { ...c.state, focus: { uid: 'n_report', source: 'manual' } };
  const out = core.buildClueProjection(state, c.snap, c.prog, {});
  assert.match(out.content, /主角看见锁上有一道撬痕｜知情范围未记录/);
  assert.ok(!out.content.includes('从里面被撬开'), 'author full answer is not printed as obtained');
  await inst.destroy();
});

test('T8: the sample requires the old man to tell the user; a mere guess does not open the confrontation', async () => {
  const { host, inst, tables } = await setup();
  setCell(tables, '关键事实表', 'F_box', '状态', '已核实');
  setCell(tables, '关键事实表', 'F_ledger', '状态', '已核实');
  setCell(tables, '知情表', 'F_seen@user', '获知方式', '推测'); commit(host, tables);
  let st = statusOf(inst);
  assert.notEqual(st.n_witness, 'done');
  assert.equal(st.n_confront, 'locked');
  setCell(tables, '知情表', 'F_seen@user', '获知方式', '被告知'); commit(host, tables);
  st = statusOf(inst);
  assert.equal(st.n_witness, 'done');
  assert.notEqual(st.n_confront, 'locked');
  await inst.destroy();
});

test('T9: the confrontation scene carries the ledger fact and the (unverified) testimony with holders', async () => {
  const { host, inst, tables } = await setup();
  setCell(tables, '关键事实表', 'F_box', '状态', '已核实');
  setCell(tables, '关键事实表', 'F_ledger', '状态', '已核实');
  setCell(tables, '关键事实表', 'F_ledger', '内容', '残页上记着一笔给阿伟的赊账');
  setCell(tables, '知情表', 'F_ledger@user', '获知方式', '亲见');
  setCell(tables, '知情表', 'F_ledger@user', '可信度', '已核实');
  setCell(tables, '关键事实表', 'F_seen', '状态', '存疑');
  setCell(tables, '关键事实表', 'F_seen', '内容', '裁缝铺老人说案发当晚看见一个年轻人从后门出来');
  setCell(tables, '知情表', 'F_seen@user', '获知方式', '被告知');
  commit(host, tables);
  assert.equal(inst.runtime.clue.compute().state.focus.uid, 'n_confront');
  const r = await host.send('去修车铺');
  assert.match(r.text, /残页上记着一笔给阿伟的赊账｜知道的人：user/);
  assert.match(r.text, /尚未核实的说法[\s\S]*老人说案发当晚看见一个年轻人[\s\S]*知道的人：user（未核实）/);
  assert.ok(!r.text.includes('老板娘（'), '老板娘 is not listed as a holder');
  await inst.destroy();
});

test('T3: leaving the investigation suppresses auto focus on the single remaining node; rollback restores', async () => {
  const { host, inst, tables } = await setup();
  setCell(tables, '关键事实表', 'F_box', '状态', '已核实');
  setCell(tables, '关键事实表', 'F_ledger', '状态', '已核实'); commit(host, tables);
  await host.send('x', { reply: '账本查完了。' });
  assert.equal(inst.runtime.clue.compute().state.focus.uid, 'n_witness', 'only one main node left → auto focus');
  // via the table: fill model writes 离场
  setCell(tables, '线索控制表', '主线', '当前场景', '离场'); commit(host, tables);
  let c = inst.runtime.clue.compute();
  assert.equal(c.state.focus.uid, ''); assert.equal(c.state.focus.source, 'away');
  let r = await host.send('回家睡觉', { reply: '你回家睡了。' });
  assert.ok(!r.text.includes('年轻人'), 'no pending discovery of the left scene');
  assert.match(r.text, /去问问隔壁裁缝铺的邻居/, 'entry still offered');
  // via the run page: the scene cell was never cleared, user marks "离开这个调查"
  setCell(tables, '线索控制表', '主线', '当前场景', 'n_witness'); commit(host, tables);
  assert.equal(inst.runtime.clue.compute().state.focus.uid, 'n_witness');
  inst.runtime.clue.leaveScene('n_witness');
  c = inst.runtime.clue.compute();
  assert.equal(c.state.focus.source, 'away');
  // fill model later writes another scene → that wins; manual focus also clears the away mark
  inst.runtime.clue.setFocus('n_witness');
  assert.equal(inst.runtime.clue.compute().state.focus.source, 'manual');
  await inst.destroy();
});

test('prebuilt-row check: conditions that reference missing fact / knowledge rows are reported', async () => {
  const { host, inst } = await setup();
  const t = liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [{ code: 'F_box', label: 'x' }], knowRows: [] }));
  host.db.setTables(t); host.db.commit(0);
  const p = inst.runtime.clue.compute().snap.problems.join('\n');
  assert.match(p, /事实表里没有这些编号的行：.*F_ledger/);
  await inst.destroy();
  // 知情 / 核实 conditions → missing 事实@角色 rows are listed
  const core = (await import('./load.mjs')).loadCore();
  const vols = [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's', key: '阶段一_x', data: { 主线节点: [{ id: 'n1', 名称: 'a', 开放条件: { 知情: 'F1@甲' }, 完成条件: { 核实: 'F1@乙' } }] } }] }];
  const gaps = core.prebuiltGaps(core.compileClue(vols), { facts: new Map([['F1', {}]]), knowPresent: new Set(['F1@甲']) });
  assert.deepEqual(gaps, ['知情表里没有这些「事实@角色」的预建行：F1@乙']);
});

test('two-table hint: fact recorded as 存疑 but nobody in the knowledge table knows it', async () => {
  const { host, inst, tables } = await setup();
  setCell(tables, '关键事实表', 'F_seen', '状态', '存疑'); commit(host, tables);
  assert.ok(inst.runtime.clue.compute().hints.some((h) => h.includes('F_seen') && h.includes('知情表')));
  await inst.destroy();
});

test('pre-built knowledge rows with 未知 are not knowledge records (regression)', async () => {
  const { inst } = await setup();
  const c = inst.runtime.clue.compute();
  assert.equal(c.snap.knowledge.length, 0, 'all pre-built rows are 未知 → no records');
  await inst.destroy();
});

test('V5: shipped sample — witness refuses (no 被告知), back-door print alone opens the confrontation', async () => {
  const { host, inst, tables } = await setup();
  setCell(tables, '关键事实表', 'F_box', '状态', '已核实');
  setCell(tables, '关键事实表', 'F_ledger', '状态', '已核实');
  setCell(tables, '知情表', 'F_seen@user', '获知方式', '推测');
  commit(host, tables);
  assert.equal(statusOf(inst).n_confront, 'locked', 'ledger + a guess is not enough');
  setCell(tables, '关键事实表', 'F_print', '状态', '已核实'); commit(host, tables);
  const st = statusOf(inst);
  assert.notEqual(st.n_witness, 'done', 'witness path not taken');
  assert.notEqual(st.n_confront, 'locked', 'independent evidence path works');
  await inst.destroy();
});

// ---------- Official shujuku adaptation (GPT §13.2): prebuild rows, 登记口径, scene catalog, evidence rule ----------
test('template: every clue table states the evidence rule (plans in user messages are not events) with the negative example', () => {
  const t = buildTemplate({});
  for (const name of ['线索控制表', '关键事实表', '知情表']) {
    const note = Object.values(t).find((s) => s && s.name === name).sourceData.note;
    assert.match(note, /用户消息里出现的计划、提议、打算/, name);
    assert.match(note, /什么也没找到就离开了 → 不记录任何发现/, name);
  }
});

test('template: 关键事实表 has a 登记口径 column; scene catalog goes into the control table note', () => {
  const t = buildTemplate({ factRows: [{ code: 'F1', label: '钱箱', criterion: '亲自查看时登记' }], scenes: [{ uid: 'n_a', entry: '去杂货店', place: '杂货店' }] });
  const f = Object.values(t).find((s) => s && s.name === '关键事实表');
  assert.deepEqual(f.content[0], ['row_id', '编号', '标签', '登记口径', '状态', '内容', '依据']);
  assert.deepEqual(f.content[1], [null, 'F1', '钱箱', '亲自查看时登记', '未获得', '', '']);
  assert.match(f.sourceData.ddl, /criterion TEXT, -- 登记口径/);
  const ctrl = Object.values(t).find((s) => s && s.name === '线索控制表');
  assert.match(ctrl.sourceData.note, /【场景编号对照】[\s\S]*- n_a：去杂货店；地点：杂货店/);
});

test('prebuild plan: facts from discoveries, knowledge rows from conditions (incl. cell conditions), risky criteria flagged', async () => {
  const core = (await import('./load.mjs')).loadCore();
  let i = 0;
  const vols = core.volumesFromValue(YAML.parse(storyText), () => `x${i++}`);
  const plan = core.prebuildPlan(vols);
  assert.deepEqual(plan.facts.map((f) => f.code), ['F_box', 'F_ledger', 'F_seen', 'F_print', 'F_talk']);
  assert.ok(plan.knows.some((k) => k.key === 'F_seen@user'), 'cell condition 知情表/F_seen@user/… creates the row');
  const seen = plan.facts.find((f) => f.code === 'F_seen');
  assert.equal(seen.risky, true, '记录 repeats part of the answer → flagged');
  assert.equal(seen.criterion, '', 'risky criterion is not prefilled');
  assert.equal(plan.facts.find((f) => f.code === 'F_box').risky, false);
  assert.deepEqual(plan.scenes.map((s) => s.uid), ['n_report', 'n_ledger', 'n_witness', 'n_backdoor', 'n_confront']);
});

test('prebuild through the run page: only missing rows are inserted via the official insertRow; existing rows untouched', async () => {
  // start with only F_box pre-built and already 已核实 (story in progress)
  const tables = liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [{ code: 'F_box', label: '钱箱撬痕' }], knowRows: [] }));
  const s = Object.values(tables).find((x) => x && x.name === '关键事实表');
  s.content[1][s.content[0].indexOf('状态')] = '已核实';
  const host = createHost({ tables });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('小镇');
  const volumes = Object.entries(YAML.parse(storyText)).map(([key, stages], vi) => ({ id: `v${vi}`, key, stages: Object.entries(stages).map(([sk, data], si) => ({ id: `s${vi}_${si}`, key: sk, data })) }));
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML) } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  inst.open(); await new Promise((r) => setTimeout(r, 20));
  const doc = host.w.document, tick = () => new Promise((r) => setTimeout(r, 20));
  doc.querySelector(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  doc.querySelector('[data-act="clue-prebuild"]').click(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  assert.match(dlg.textContent, /每一轮都会发给填表模型/);
  assert.match(dlg.textContent, /已有、不改动：F_box/);
  // the record (may contain the answer) is no longer printed; the 自动填写 button writes a neutral version instead
  assert.ok(dlg.querySelector('[data-fr-auto]'), 'auto-fill button');
  assert.ok(!/仅供参考，可能含答案/.test(dlg.textContent));
  // author fills neutral labels; leaves criteria as proposed
  dlg.querySelectorAll('[data-pb-label]').forEach((el, i) => { el.value = `标签${i}`; });
  dlg.querySelector('[data-pb-crit="0"]').value = '主角亲自读到这页时登记';
  dlg.querySelector('.pi-btn.is-primary').click(); await tick(); await tick();
  const factRows = host.db.tables && Object.values(host.db.tables).find((x) => x && x.name === '关键事实表').content.slice(1);
  assert.deepEqual(factRows.map((r) => r[1]), ['F_box', 'F_ledger', 'F_seen', 'F_print', 'F_talk']);
  assert.equal(factRows[0][factRows[0].length - 3], '已核实', 'existing F_box progress untouched');
  const ledger = factRows.find((r) => r[1] === 'F_ledger');
  assert.equal(ledger[3], '主角亲自读到这页时登记', 'criterion is what the author typed');
  assert.equal(factRows.find((r) => r[1] === 'F_seen')[3], '', 'nothing prefilled from the outline record');
  const know = Object.values(host.db.tables).find((x) => x && x.name === '知情表').content.slice(1);
  assert.ok(know.some((r) => r[1] === 'F_seen@user' && r[4] === '未知'), 'knowledge row pre-built as 未知');
  assert.equal(inst.runtime.clue.compute().snap.problems.filter((x) => /没有这些编号的行|预建行/.test(x)).length, 0, 'no missing pre-built rows anymore');
  // running again: nothing to add
  doc.querySelector('[data-act="clue-prebuild"]').click(); await tick();
  assert.equal(doc.querySelector('.pi-dialog'), null, 'no dialog when complete');
  await inst.destroy();
});

test('hint: a fact confirmed without ever being offered as a candidate is flagged (GPT §13.2 F_talk case); offered ones are not', async () => {
  const { host, inst, tables } = await setup();
  // the reported mis-fill: future F_talk marked 已核实 out of nowhere
  setCell(tables, '关键事实表', 'F_talk', '状态', '已核实'); commit(host, tables);
  let hints = inst.runtime.clue.compute().hints.join('\n');
  assert.match(hints, /从没把它们作为可能发现给过正文：F_talk/);
  // F_box is offered in the first round (n_report focus) → after confirming it, no hint for F_box
  await host.send('去杂货店', { reply: '你仔细看了钱箱。' });
  setCell(tables, '关键事实表', 'F_box', '状态', '已核实'); commit(host, tables);
  hints = inst.runtime.clue.compute().hints.join('\n');
  assert.ok(!/给过正文：[^。]*F_box/.test(hints), 'offered candidate not flagged');
  // manual confirm silences it
  inst.runtime.clue.act({ kind: 'fact', target: 'F_talk', value: 'confirmed', note: '作者确认' });
  assert.ok(!inst.runtime.clue.compute().hints.some((h) => h.includes('F_talk')));
  await inst.destroy();
});

test('table freshness: the official table-update callback time is shown in diagnostics', async () => {
  const { host, inst, tables } = await setup();
  assert.equal(inst.runtime.clue.diagnose().lastTableUpdate, 0);
  setCell(tables, '关键事实表', 'F_box', '状态', '已核实'); host.db.setTables(tables);
  const d = inst.runtime.clue.diagnose();
  assert.ok(d.lastTableUpdate > 0 && d.tableAgeMs >= 0);
  await inst.destroy();
});

test('§14.2-4: a fact offered long ago (beyond the 40-floor record) is still remembered as offered', async () => {
  const { host, inst, tables } = await setup();
  await host.send('去杂货店', { reply: '你看了看。' });
  // move on: n_report is skipped-by-author (manually marked done) so later floors offer other candidates, then 42 more floors
  inst.runtime.clue.act({ kind: 'done', target: 'n_report', value: 'force' });
  for (let i = 0; i < 42; i++) await host.send(`闲聊${i}`, { reply: `回复${i}` });
  inst.runtime.clue.act({ kind: 'done', target: 'n_report', value: '' });
  setCell(tables, '关键事实表', 'F_box', '状态', '已核实'); commit(host, tables);
  const pr = inst.runtime.progress();
  assert.ok(!(pr.clueCandidates || []).some((x) => (x.candidates || []).some((c) => c.fact === 'F_box')), 'F_box has dropped out of the 40-entry per-floor record');
  assert.ok(!inst.runtime.clue.compute().hints.some((h) => /给过正文：[^。]*F_box/.test(h)), 'no false "never offered" hint');
  await inst.destroy();
});

test('§14.2-4: table update time is cleared on chat switch', async () => {
  const { host, inst, tables } = await setup();
  setCell(tables, '关键事实表', 'F_box', '状态', '已核实'); host.db.setTables(tables);
  assert.ok(inst.runtime.clue.diagnose().lastTableUpdate > 0);
  host.state.chatId = 'chat-2'; await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  assert.equal(inst.runtime.clue.diagnose().lastTableUpdate, 0);
  await inst.destroy();
});

test('template: clue tables + 全局数据表 update every AI reply (no skip, one group); character and summary tables keep the global setting', () => {
  const combined = JSON.parse(fs.readFileSync(path.join(here, '../templates/clue-tables/线索推进表格模板_含默认表.json'), 'utf8'));
  const cfg = (name) => Object.values(combined).find((s) => s && s.name === name).updateConfig;
  for (const n of ['线索控制表', '关键事实表', '知情表', '全局数据表']) {
    assert.equal(cfg(n).updateFrequency, 1, n); assert.equal(cfg(n).skipFloors, 0, n); assert.equal(cfg(n).groupId, 0, n);
  }
  assert.equal(cfg('重要角色表').updateFrequency, -1); assert.notEqual(cfg('重要角色表').groupId, 0, 'not in the realtime group');
  assert.equal(cfg('纪要表').updateFrequency, -1); assert.notEqual(cfg('纪要表').groupId, 0);
  // clue-only template: three tables, no default tables
  assert.deepEqual(Object.values(buildTemplate({})).filter((s) => s && s.name).map((s) => s.name), ['线索控制表', '关键事实表', '知情表']);
});
