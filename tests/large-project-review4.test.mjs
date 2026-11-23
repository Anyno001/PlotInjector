// 大型项目第 1、2 批返修复核（GPT，2026-11-18）的反例。每条在修之前都应失败。
import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';
import { buildTemplate, BINDING_YAML } from '../templates/clue-tables/build-template.mjs';

const C = loadCore();
const tick = () => new Promise((r) => setTimeout(r, 20));
const node = (id, fact, extra = {}) => ({ id, 名称: id, 入口: `去${id}`, 地点: id, 发现: [{ 事实: fact, 内容: `${id}查到的`, 记录: `看到${id}时登记` }], 完成条件: { 事实: fact }, ...extra });
const FB = { 表: '关键事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实', 说法值: '存疑' };
const KB = { 表: '知情表', 事实列: '事实', 角色列: '角色', 方式列: '获知方式', 可信度列: '可信度', 已核实值: '已核实', 未知值: ['未知'] };
const FACT_HEAD = [null, '编号', '标签', '登记口径', '状态', '内容', '依据'];
const KNOW_HEAD = [null, '键', '事实', '角色', '获知方式', '可信度', '依据'];
const isoTag = (key = '') => ({ TavernDB_ACU_IsolatedData: { [key]: { storageFrame: { version: 2, logEntries: [] } } } });

// ---------- 复核 3：模板初始行只在数据库还用它们的时候算数 ----------
test('seedRowsState: follows the official gate (exactly one user message; no floor with sheet data for this isolation)', () => {
  assert.equal(C.seedRowsState([], ''), 'pending', 'no user message yet: not registered, do not fill');
  assert.equal(C.seedRowsState([{ is_user: false, mes: '开场白' }], ''), 'pending');
  assert.equal(C.seedRowsState([{ is_user: false }, { is_user: true }], ''), 'live', 'one user message, no table data');
  assert.equal(C.seedRowsState([{ is_user: true }, { is_user: false }, { is_user: true }], ''), 'off', 'two user messages');
  assert.equal(C.seedRowsState([{ is_user: true }, { is_user: false, ...isoTag('') }], ''), 'live', 'an empty V2 frame is not table data (official)');
  assert.equal(C.seedRowsState([{ is_user: true }, { is_user: false, TavernDB_ACU_IsolatedData: { '': { independentData: { sheet_x: {} } } } }], ''), 'off', 'sheet data in this isolation');
  assert.equal(C.seedRowsState([{ is_user: true }, { is_user: false, TavernDB_ACU_IsolatedData: { B: { independentData: { sheet_x: {} } } } }], ''), 'live', 'another isolation does not count');
  assert.equal(C.seedRowsState([{ is_user: true }, { is_user: false, TavernDB_ACU_IndependentData: { sheet_x: {} } }], ''), 'off', 'legacy data, no identity, isolation off');
  assert.equal(C.seedRowsState([{ is_user: true }, { is_user: false, TavernDB_ACU_IndependentData: { sheet_x: {} }, TavernDB_ACU_Identity: 'B' }], 'A'), 'live', 'legacy data of another identity');
  assert.equal(C.seedRowsState([{ is_user: true }, { is_user: false, TavernDB_ACU_IndependentData: { sheet_x: {} }, TavernDB_ACU_Identity: 'A' }], 'A'), 'off');
});

test('withSeedGate: past the gate, seed rows are not read; before it they are (D21)', () => {
  const t = { sheet_f: { name: '关键事实表', content: [FACT_HEAD], seedRows: [[null, 'F1', '', '', '已核实', '', '']] } };
  assert.equal(C.readFacts(C.withSeedGate(t, 'live'), [FB]).facts.get('F1').status, 'confirmed');
  assert.equal(C.readFacts(C.withSeedGate(t, 'off'), [FB]).facts.size, 0);
  assert.equal(C.readFacts(C.withSeedGate(t, 'pending'), [FB]).facts.size, 0, 'pending: not registered either');
  assert.ok(Object.values(C.withSeedGate(t, 'pending'))[0][C.SEED_HOLD], 'pending + seed-only table: hold filling');
  assert.ok(!Object.values(C.withSeedGate(t, 'off'))[0][C.SEED_HOLD], 'off: fill normally');
  assert.equal(C.readFacts(t, [FB]).facts.get('F1').status, 'confirmed', 'tables never gated (preview, template) read seeds as before');
});

test('panel: two user messages, only seedRows (F1 未获得, F1@user 未知) → F1 is still held back, its secret not sent to the story model', async () => {
  const vols = [{ id: 'v', key: '剧情_M1_a', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 's', key: '阶段1_a', data: { 主线节点: [{ ...node('n1', 'F1'), 发现: [{ 事实: 'F1', 内容: '红夹层里是明日的暗号', 记录: '看到夹层时登记' }] }] } }] }];
  const tables = {
    sheet_ctrl: { name: '线索控制表', content: [[null, '标识', '当前场景', '场景目录'], [1, '主线', 'n1', '']] },
    sheet_f: { name: '关键事实表', content: [FACT_HEAD], seedRows: [[null, 'F1', '', '', '未获得', '', '']] },
    sheet_k: { name: '知情表', content: [KNOW_HEAD], seedRows: [[null, 'F1@user', 'F1', 'user', '未知', '未核实', '']] },
  };
  const host = createHost({ tables });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('种子');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML) } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  host.state.chat.push({ is_user: true, mes: '一' }, { is_user: false, mes: '回' }, { is_user: true, mes: '二' });
  inst.runtime.clue.invalidate();
  const c = inst.runtime.clue.compute();
  assert.equal(c.snap.facts.size, 0, 'seed rows past the gate are not registered rows');
  assert.ok(c.notReady.has('F1'), 'F1 held back until a real row exists');
  await inst.destroy();
});

// ---------- 复核 4：多绑定 ----------
test('condReads: another table holds the real 存疑 claim for F1 → the padded 未获得 of the first table does not hide it', () => {
  const tables = {
    sheet_f: { name: '关键事实表', content: [FACT_HEAD] },
    sheet_i: { name: '线人表', content: [[null, '编号', '状态'], [1, 'F1', '存疑']] },
    sheet_k: { name: '知情表', content: [KNOW_HEAD] },
  };
  const bindings = { facts: [FB, { 表: '线人表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实', 说法值: '存疑' }], knowledge: [KB] };
  const vols = [{ id: 'v', key: '剧情_M1_a', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 's', key: '阶段1_a', data: { 主线节点: [node('n1', 'F1')] } }] }];
  const view = C.effectiveTables(tables, bindings, C.prebuildPlan(vols));
  const r = C.condReads(tables, view, bindings);
  assert.equal(r.facts.get('F1').claimed, true, 'the claim from the second table stays');
  // the target table still lacks F1: the diff reports it
  const diff = C.prebuildDiff(C.prebuildPlan(vols), { facts: C.readFacts(tables, bindings.facts).facts, knowPresent: new Set(), tables }, bindings);
  assert.deepEqual(diff.newFacts.map((f) => f.code), ['F1'], 'missing in the target table even though another table has it');
});

test('seedable: an old binding on the same table blocks that kind of placeholder; on another table it does not', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(C.seedable({ facts: [FB, { 表: '关键事实表', 编号列: '编号' }], knowledge: [KB] }))), { facts: false, knows: true });
  assert.deepEqual(JSON.parse(JSON.stringify(C.seedable({ facts: [FB], knowledge: [KB, { 表: '知情表', 事实列: '事实', 角色列: '角色' }] }))), { facts: true, knows: false });
  assert.deepEqual(JSON.parse(JSON.stringify(C.seedable({ facts: [FB, { 表: '线人表', 编号列: '编号' }], knowledge: [KB] }))), { facts: true, knows: true });
});

function liveTables(t) {
  const out = JSON.parse(JSON.stringify(t));
  for (const [k, s] of Object.entries(out)) if (k.startsWith('sheet_')) s.content = s.content.map((row, i) => (i === 0 ? row : [i, ...row.slice(1)]));
  return out;
}

test('panel: old fact binding with F1 registered + standard know table → F1@user is filled in and F1 is not held back', async () => {
  const vols = [{ id: 'v', key: '剧情_M1_a', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 's', key: '阶段1_a', data: { 主线节点: [node('n1', 'F1'), node('n2', 'F2')] } }] }];
  const host = createHost({ tables: liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [], knowRows: [] })) });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('旧事实表');
  const b = YAML.parse(BINDING_YAML);
  b.facts = [{ 表: '关键事实表', 编号列: '编号' }];
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: b } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  await host.addMessage('一', true); await host.addMessage('开始。', false); await host.settle();
  await host.w.AutoCardUpdaterAPI.insertRow({ tableName: '关键事实表', data: { 编号: 'F1' } });
  for (let i = 0; i < 2; i++) { inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines(); }
  inst.runtime.clue.invalidate();
  const c = inst.runtime.clue.compute();
  const ins = host.w.AutoCardUpdaterAPI.inserted;
  assert.ok(ins.some((x) => x.tableName === '知情表' && x.data.事实 === 'F1'), 'F1@user written');
  assert.ok(!ins.some((x) => x.tableName === '知情表' && x.data.事实 === 'F2'), 'no know row for an unregistered fact');
  assert.ok(!ins.some((x) => x.tableName === '关键事实表' && x.data.编号 === 'F2'), 'no fact placeholder in the old table');
  assert.ok(!c.notReady.has('F1') && !c.notReady.has('F2'), 'nothing held back');
  await inst.destroy();
});

// ---------- 复核 5：生成模板按「装好以后」算开局 ----------
test('panel: fresh default template, M1 opens on "关键事实表 has ≥1 未获得", M1 produces F1 → the template dialog offers F1', async () => {
  const fs = await import('node:fs');
  const tpl = JSON.parse(fs.readFileSync(new URL('./fixtures/shujuku-default-template-spv8.9.2.json', import.meta.url), 'utf8'));
  const vols = [
    { id: 'v', key: '剧情_M1_a', line: { 编号: 'M1', 类型: '主线', 开启条件: { 计数: { 表: '关键事实表', 条件: '状态 == 未获得', 至少: 1 } } }, stages: [{ id: 's', key: '阶段1_a', data: { 主线节点: [node('n1', 'F1')] } }] },
    { id: 'w', key: '剧情_S2_b', line: { 编号: 'S2', 类型: '支线', 开启条件: { 线: 'M1 == 完成' } }, stages: [{ id: 't', key: '阶段1_b', data: { 主线节点: [node('n2', 'F2')] } }] },
  ];
  const host = createHost({ tables: tpl });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('开局');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  (() => { const t = doc.querySelector('[data-act="run-set-toggle"][aria-expanded="false"]'); t && t.click(); })(); await tick(); (() => { const t = doc.querySelector('[data-act="run-fold"][data-key="advOpen"][aria-expanded="false"]'); t && t.click(); })(); await tick();
  doc.querySelector('[data-act="clue-gen-template"]').click(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  assert.match(dlg.textContent, /开局要用1条线索/);
  assert.equal(dlg.querySelectorAll('[data-gt-label]').length, 1);
  assert.match(dlg.textContent, /另有1条要等剧情推进到那一步/);
  await inst.destroy();
});

// ---------- 复核 6：主角别名贯穿条件、路径、模板 ----------
test('know condition: a row F1@主角 satisfies 知情 / 核实 F1@user and F1@玩家; another NPC is not merged', () => {
  const vols = (actor) => [{ id: 'v', key: '剧情_卷1_a', stages: [{ id: 's', key: '阶段1_a', data: { 主线节点: [node('n1', 'F9', { 开放条件: { 核实: `F1@${actor}` } })] } }] }];
  const knowledge = [{ fact: 'F1', actor: '主角', way: '亲见', verified: true }];
  for (const a of ['主角', 'user', '玩家', '{{user}}']) {
    const st = C.computeClueState(C.compileClue(vols(a)), { facts: new Map(), knowledge, tables: {} }, C.emptyClueProgress(), { bindings: {} });
    assert.notEqual(st.nodeStates.find((s) => s.node.uid === 'n1').status, 'locked', `${a} sees the player's row`);
  }
  const npc = C.computeClueState(C.compileClue(vols('老韩')), { facts: new Map(), knowledge, tables: {} }, C.emptyClueProgress(), { bindings: {} });
  assert.equal(npc.nodeStates.find((s) => s.node.uid === 'n1').status, 'locked', 'an NPC is not the player');
});

test('readCell: 知情表/F1@user/获知方式 finds the row keyed F1@主角; an exact key still wins', () => {
  const t = { sheet_k: { name: '知情表', content: [KNOW_HEAD, [1, 'F1@主角', 'F1', '主角', '亲见', '已核实', '']] } };
  assert.equal(C.readCell(t, '知情表/F1@user/获知方式').value, '亲见');
  assert.equal(C.readCell(t, '知情表/F1@老韩/获知方式').state, 'unknown', 'NPC not aliased');
});

test('prebuildPlan: F1 needs 主角 explicitly, default actor user → one F1 row for the player (template and view agree)', () => {
  const vols = [{ id: 'v', key: '剧情_卷1_a', stages: [{ id: 's', key: '阶段1_a', data: { 主线节点: [node('n1', 'F1'), node('n2', 'F2', { 开放条件: { 知情: 'F1@主角' } })] } }] }];
  const plan = C.prebuildPlan(vols);
  assert.deepEqual(plan.knows.map((k) => k.key).sort(), ['F1@主角', 'F2@user']);
  const gen = C.synthesizeClueTemplate({}, { clue: { factRows: plan.facts.map((f) => ({ code: f.code, label: 'x' })), knowRows: plan.knows } });
  const know = Object.values(gen.template).find((s) => s && s.name === '知情表');
  assert.equal(know.content.length - 1, 2, 'template has two know rows');
  const view = C.effectiveTables({ sheet_f: { name: '关键事实表', content: [FACT_HEAD] }, sheet_k: { name: '知情表', content: [KNOW_HEAD] } }, { facts: [FB], knowledge: [KB] }, plan);
  assert.equal(Object.values(view).find((s) => s.name === '知情表').content.length - 1, 2, 'view has the same two');
});

// ---------- 复核 2：别线参考和采用检查同一份 ----------
test('otherLinesText: S2 uses F1 only via 相关事实 → the reference tells the model, like the adopt check does', () => {
  const vols = [
    { id: 'vM1', key: '剧情_M1_a', line: { 编号: 'M1' }, stages: [{ id: 's1', key: '阶段1_a', data: { 主线节点: [node('n1', 'F1')] } }] },
    { id: 'vS2', key: '剧情_S2_b', line: { 编号: 'S2' }, stages: [{ id: 's2', key: '阶段1_b', data: { 主线节点: [node('n2', 'F2', { 相关事实: ['F1'] })] } }] },
  ];
  assert.match(C.otherLinesText(vols, 'vM1'), /用到这条线的：F1/);
});

test('pickLineIncoming: a same-name volume without id and a renamed volume that says 编号 M1 → the explicit M1 wins', () => {
  const vol = { id: 'vM1', key: '剧情_M1_a', line: { 编号: 'M1' }, stages: [] };
  const got = C.pickLineIncoming(vol, [
    { key: '剧情_M1_a', stages: [{ id: 'x', key: '阶段1_x', data: {} }] },
    { key: '剧情_M1_新名', line: { 编号: 'M1' }, stages: [{ id: 'y', key: '阶段1_y', data: {} }] },
  ]);
  assert.equal(got.hit.key, '剧情_M1_新名');
});

// ---------- 复核 1：撤销只认这笔写入、只在原聊天 ----------
async function offTrackSetup() {
  const vols = [{ id: 'vM1', key: '剧情_卷1_街区', stages: [
    { id: 's1', key: '阶段1_开场', data: { 主线节点: [{ id: 'n_a', 名称: '甲' }] } },
    { id: 's2', key: '阶段2_追查', data: { 主线节点: [] } },
  ] }];
  const host = createHost({ tables: buildTemplate({ controlRow: ['主线', ''], factRows: [], knowRows: [] }) });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('撤销');
  inst.data.updateProject(p.id, (x) => ({ ...x, setting: { ...x.setting, text: '设定' }, outline: { volumes: vols } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  return { host, inst, pid: p.id, doc: host.w.document };
}
async function triggerOffTrack(host, inst, settingReply) {
  host.llm.respond = (body) =>
    /偏离了大纲/.test(body)
      ? '```yaml\n剧情_卷1_街区:\n  阶段1_开场:\n    主线节点:\n      - {id: n_a, 名称: 甲}\n  阶段2_新追查:\n    主线节点: []\n```'
      : /剧情大纲已经调整/.test(body)
        ? settingReply()
        : '{"done":[],"stageDone":false,"offTrack":true,"offReason":"偏了","reason":"x"}';
  inst.data.updateSettings({ checkEvery: 1 });
  host.addMessage({ is_user: true, mes: '一' });
  host.addMessage({ is_user: false, mes: '剧情走偏了。' });
  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, 1, 'normal');
  await tick(); await tick(); await tick();
  host.w.document.querySelector('[data-notice="offtrack"] [data-act="0"]').click(); await tick();
  host.w.document.querySelector('.pi-dialog .pi-dlg-acts .is-primary').click();
}

test('off-track undo: the setting check was refused (author edited meanwhile) → undo keeps the author\'s setting', async () => {
  const { host, inst, pid, doc } = await offTrackSetup();
  await triggerOffTrack(host, inst, () => {
    inst.data.updateProject(pid, (p) => ({ ...p, setting: { ...p.setting, text: '作者保留稿' } }));
    return '世界观正文：\n校对稿\n\n速查：x';
  });
  for (let i = 0; i < 10 && !/撤销/.test(doc.querySelector('[data-notice="offtrack"]')?.textContent || ''); i++) await tick();
  host.llm.respond = () => '{}';
  [...doc.querySelectorAll('[data-notice="offtrack"] [data-act]')].find((b) => /撤销/.test(b.textContent)).click(); await tick();
  assert.equal(inst.data.project(pid).setting.text, '作者保留稿');
  assert.deepEqual(JSON.parse(JSON.stringify(inst.data.project(pid).outline.volumes[0].stages.map((s) => s.key))), ['阶段1_开场', '阶段2_追查'], 'outline undone');
  await inst.destroy();
});

test('off-track undo: a successful setting check is undone with it', async () => {
  const { host, inst, pid, doc } = await offTrackSetup();
  await triggerOffTrack(host, inst, () => '世界观正文：\n校对稿\n\n速查：x');
  for (let i = 0; i < 10 && !/撤销/.test(doc.querySelector('[data-notice="offtrack"]')?.textContent || ''); i++) await tick();
  assert.match(inst.data.project(pid).setting.text, /^校对稿/);
  host.llm.respond = () => '{}';
  [...doc.querySelectorAll('[data-notice="offtrack"] [data-act]')].find((b) => /撤销/.test(b.textContent)).click(); await tick();
  assert.equal(inst.data.project(pid).setting.text, '设定');
  await inst.destroy();
});

test('off-track: switching chat while the setting check runs → no undo offered in the other chat, the outline stays adopted', async () => {
  const { host, inst, pid, doc } = await offTrackSetup();
  let release;
  await triggerOffTrack(host, inst, () => new Promise((r) => { release = () => r('世界观正文：\n校对稿\n\n速查：x'); }));
  for (let i = 0; i < 20 && !release; i++) await tick();
  assert.ok(release, 'setting check started');
  host.state.chatId = 'chat-B'; await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await tick();
  release(); for (let i = 0; i < 5; i++) await tick();
  const card = doc.querySelector('[data-notice="offtrack"]');
  assert.ok(!card || ![...card.querySelectorAll('[data-act]')].some((b) => /撤销/.test(b.textContent)), 'no undo in chat B');
  assert.deepEqual(JSON.parse(JSON.stringify(inst.data.project(pid).outline.volumes[0].stages.map((s) => s.key))), ['阶段1_开场', '阶段2_新追查']);
  await inst.destroy();
});

// ---------- 复核 7：标签弹窗按「这一次检查的是哪一版字」 ----------
async function templateDialog(vols) {
  const fs = await import('node:fs');
  const tpl = JSON.parse(fs.readFileSync(new URL('./fixtures/shujuku-default-template-spv8.9.2.json', import.meta.url), 'utf8'));
  const host = createHost({ tables: tpl });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('标签');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  (() => { const t = doc.querySelector('[data-act="run-set-toggle"][aria-expanded="false"]'); t && t.click(); })(); await tick(); (() => { const t = doc.querySelector('[data-act="run-fold"][data-key="advOpen"][aria-expanded="false"]'); t && t.click(); })(); await tick();
  doc.querySelector('[data-act="clue-gen-template"]').click(); await tick();
  return { host, inst, doc, dlg: doc.querySelector('.pi-dialog'), pid: p.id };
}
const oneLine = () => [{ id: 'vA', key: '剧情_M1_a', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 'sA', key: '阶段1_a', data: { 主线节点: [node('n_a', 'F_a'), node('n_b', 'F_b')] } }] }];
const waitStatus = async (dlg) => { for (let i = 0; i < 40 && /正在/.test(dlg.querySelector('[data-fr-status]').textContent); i++) await tick(); };
const GEN2 = '```yaml\n- {编号: F_a, 标签: 甲的线索, 口径: 看到甲时登记；没看到不算}\n- {编号: F_b, 标签: 乙的线索, 口径: 看到乙时登记；没看到不算}\n```';

test('template dialog: the author fills one box, the model the other → saved as user (not ai), not auto-reviewed', async () => {
  const { host, inst, dlg, pid } = await templateDialog(oneLine());
  { const e = dlg.querySelector('[data-gt-label="0"]'); e.value = '作者写的标签'; e.dispatchEvent(new e.ownerDocument.defaultView.Event('input', { bubbles: true })); }
  host.llm.respond = (body) => (/有没有剧透/.test(body) ? '```yaml\n- {编号: F_a, 透露: 否}\n- {编号: F_b, 透露: 否}\n```' : GEN2);
  dlg.querySelector('[data-fr-auto]').click(); await tick(); await waitStatus(dlg);
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '写入当前聊天').click(); await tick(); await tick();
  const labels = inst.data.project(pid).clue.labels;
  assert.equal(labels.F_a.src, 'user');
  assert.equal(labels.F_b.src, 'ai');
  await inst.destroy();
});

test('template dialog: the review says "leak" but gives no fix → gen; clicking 自动填写 again reviews again (no new generation)', async () => {
  const { host, inst, dlg, pid } = await templateDialog(oneLine());
  let gens = 0, reviews = 0;
  host.llm.respond = (body) => {
    if (/有没有剧透/.test(body)) { reviews++; return reviews === 1 ? '```yaml\n- {编号: F_a, 透露: 是, 透露了什么: 写出了答案}\n- {编号: F_b, 透露: 否}\n```' : '```yaml\n- {编号: F_a, 透露: 否}\n```'; }
    gens++; return GEN2;
  };
  dlg.querySelector('[data-fr-auto]').click(); await tick(); await waitStatus(dlg);
  assert.match(dlg.querySelector('[data-fr-warn="0"]').textContent, /会透露答案/);
  dlg.querySelector('[data-fr-auto]').click(); await tick(); await waitStatus(dlg);
  assert.equal(gens, 1);
  assert.equal(reviews, 2, 'the unfixed leak is reviewed again');
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '写入当前聊天').click(); await tick(); await tick();
  assert.equal(inst.data.project(pid).clue.labels.F_a.src, 'ai');
  await inst.destroy();
});

test('改线索标签: after an edit, an explicit check that misses F7 says so (an old result does not count)', async () => {
  const sheet = (rows) => ({ name: '关键事实表', content: [['row_id', '编号', '状态', '标签', '登记口径'], ...rows.map((r, i) => [String(i + 1), ...r])], sourceData: { note: '' }, updateConfig: { updateFrequency: -1 } });
  const host = createHost({ tables: { sheet_f: sheet([['F7', '未获得', '订单', '口径A'], ['F8', '未获得', '旧标签', '口径B']]) } });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('P');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: [{ id: 'v', key: '剧情_M1_案子', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 's1', key: '阶段1', data: { 主线节点: [{ id: 'n1', 名称: 'a', 入口: 'a', 发现: [{ 事实: 'F7', 内容: '甲' }, { 事实: 'F8', 内容: '乙' }], 完成条件: { 事实: 'F7' } }] } }] }] }, clue: { mode: 'clue', bindings: { facts: [{ 表: '关键事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document, $ = (s) => doc.querySelector(s);
  $(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  $('[data-act="tab"][data-tab="run"]').click(); await tick();
  for (const sel of ['[data-act="run-set-toggle"][aria-expanded="false"]', '[data-act="clue-bind-toggle"]'])
    !$('[data-act="clue-labels-edit"]') && $(sel) && ($(sel).click(), await tick(), await tick());
  $('[data-act="clue-labels-edit"]').click(); await tick(); await tick();
  const dlg = $('.pi-dialog'), btn = dlg.querySelector('[data-fr-check]');
  host.llm.respond = () => '```yaml\n- {编号: F7, 透露: 否}\n- {编号: F8, 透露: 否}\n```';
  btn.click(); await tick(); await waitStatus(dlg);
  const f7 = dlg.querySelector('[data-le-label="0"]');
  f7.value = '新订单'; f7.dispatchEvent(new host.w.Event('input', { bubbles: true }));
  host.llm.respond = () => '```yaml\n- {编号: F8, 透露: 否}\n```';
  btn.click(); await tick(); await waitStatus(dlg);
  const st = dlg.querySelector('[data-fr-status]').textContent;
  assert.match(st, /1条尚未检查/);
  assert.doesNotMatch(st, /没有发现问题/);
  await inst.destroy();
});

// ---------- 复核 8：按实际消息长度切批 ----------
test('labelBatchesBy: 40 items whose real message is under the limit go out once, even if a per-item estimate would split', () => {
  const items = Array.from({ length: 40 }, (_, i) => ({ code: `F${i}`, text: 'x'.repeat(500) }));
  const overhead = 2000;
  const measure = (batch) => overhead + batch.reduce((n, x) => n + x.text.length, 0);
  assert.equal(C.labelBatchesBy(items, measure).length, 1, '22,000 chars → one batch');
  assert.equal(C.labelBatchesBy([...items, { code: 'F40', text: 'x' }], measure).length, 2, '41 items → split by count');
  const big = Array.from({ length: 3 }, (_, i) => ({ code: `G${i}`, text: 'x'.repeat(15000) }));
  assert.deepEqual(C.labelBatchesBy(big, measure).map((b) => b.length), [1, 1, 1], 'each oversize alone');
  assert.equal(C.msgChars([{ role: 'system', content: 'ab' }, { role: 'user', content: 'cde' }]), 5);
});

test('off-track undo: a stale undo button clicked after switching chat does nothing (backstop)', async () => {
  const { host, inst, pid, doc } = await offTrackSetup();
  await triggerOffTrack(host, inst, () => '世界观正文：\n校对稿\n\n速查：x');
  for (let i = 0; i < 10 && !/撤销/.test(doc.querySelector('[data-notice="offtrack"]')?.textContent || ''); i++) await tick();
  const btn = [...doc.querySelectorAll('[data-notice="offtrack"] [data-act]')].find((b) => /撤销/.test(b.textContent));
  assert.ok(btn);
  host.llm.respond = () => '{}';
  host.state.chatId = 'chat-B'; await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await tick();
  btn.click(); await tick();
  assert.deepEqual(JSON.parse(JSON.stringify(inst.data.project(pid).outline.volumes[0].stages.map((s) => s.key))), ['阶段1_开场', '阶段2_新追查'], 'not undone from chat B');
  await inst.destroy();
});

// ==================== GPT 第二次返修复核（2026-11-19） ====================

test('panel (复核二 1): only the greeting, seed rows only → F1 is not registered, held back, not sent to the story model; no row filled', async () => {
  const vols = [{ id: 'v', key: '剧情_M1_a', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 's', key: '阶段1_a', data: { 主线节点: [{ ...node('n1', 'F1'), 发现: [{ 事实: 'F1', 内容: '红夹层里是明日的暗号', 记录: '看到夹层时登记' }] }] } }] }];
  const tables = {
    sheet_ctrl: { name: '线索控制表', content: [[null, '标识', '当前场景', '场景目录'], [1, '主线', 'n1', '']] },
    sheet_f: { name: '关键事实表', content: [FACT_HEAD], seedRows: [[null, 'F1', '', '', '未获得', '', '']] },
    sheet_k: { name: '知情表', content: [KNOW_HEAD], seedRows: [[null, 'F1@user', 'F1', 'user', '未知', '未核实', '']] },
  };
  const host = createHost({ tables });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('开场白');
  const sig = Object.fromEntries(C.labelsToPrepare(vols, {}).map((x) => [x.code, x.sig]));
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML), labels: { F1: { label: 'x', criterion: 'y', sig: sig.F1 } } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  host.state.chat.push({ is_user: false, mes: '开场白' });
  inst.runtime.clue.invalidate();
  const c = inst.runtime.clue.compute();
  assert.equal(c.snap.facts.size, 0);
  assert.ok(c.notReady.has('F1'));
  const lore = await host.generate('continue');
  assert.ok(!lore.map((e) => e.content).join('\n').includes('红夹层'), 'secret not sent');
  await inst.runtime.clue.syncLines();
  assert.equal(host.w.AutoCardUpdaterAPI.inserted.length, 0, 'seed-only tables are not filled while the seeds may still be used');
  await inst.destroy();
});

test('voidFact (复核二 1): two user messages, only stale seed rows → the readback does not mistake them for table rows', async () => {
  const vols = [{ id: 'v', key: '剧情_M1_a', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 's', key: '阶段1_a', data: { 主线节点: [node('n1', 'F1')] } }] }];
  const tables = {
    sheet_f: { name: '关键事实表', content: [FACT_HEAD], seedRows: [[null, 'F1', '', '', '已核实', '', '']] },
    sheet_k: { name: '知情表', content: [KNOW_HEAD], seedRows: [[null, 'F1@user', 'F1', 'user', '亲见', '已核实', '']] },
  };
  const host = createHost({ tables });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('作废');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML) } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  host.state.chat.push({ is_user: true, mes: '一' }, { is_user: false, mes: '回' }, { is_user: true, mes: '二' });
  inst.runtime.clue.invalidate();
  const r = await inst.runtime.clue.voidFact('F1');
  assert.notEqual(r.table, 'none', r.why);
  assert.doesNotMatch(r.why || '', /还不是「未获得」|记着知道/);
  await inst.destroy();
});

test('readCell (复核二 4): player alias only in a know table, and the alias key comes before an any-cell match', () => {
  const acct = { sheet_a: { name: '账号表', content: [[null, '键', '状态'], [1, 'X@主角', '启用']] } };
  assert.equal(C.readCell(acct, '账号表/X@user/状态').state, 'unknown', 'not a know table: no alias');
  const know = { sheet_k: { name: '知情表', content: [KNOW_HEAD, [1, 'F1@主角', 'F1', '主角', '亲见', '已核实', ''], [2, 'F1@路人', 'F1', '路人', '未知', '未核实', 'F1@user']] } };
  assert.equal(C.readCell(know, '知情表/F1@user/获知方式').value, '亲见', 'alias row key wins over a note that happens to say F1@user');
});

test('openingScope (复核二 3): M1 opens on a value in an existing table → the simulation keeps that table\'s live rows', async () => {
  const fs = await import('node:fs');
  const tpl = JSON.parse(fs.readFileSync(new URL('./fixtures/shujuku-default-template-spv8.9.2.json', import.meta.url), 'utf8'));
  const own = { name: '独立表', content: [[null, '名称', '状态']] };
  tpl.sheet_own = own;
  const live = JSON.parse(JSON.stringify(tpl));
  live.sheet_own = { ...own, content: [[null, '名称', '状态'], [1, '门', '已开']] };
  const vols = [
    { id: 'v', key: '剧情_M1_a', line: { 编号: 'M1', 类型: '主线', 开启条件: { 计数: { 表: '独立表', 条件: '状态 == 已开', 至少: 1 } } }, stages: [{ id: 's', key: '阶段1_a', data: { 主线节点: [node('n1', 'F1')] } }] },
    { id: 'w', key: '剧情_S2_b', line: { 编号: 'S2', 类型: '支线', 开启条件: { 线: 'M1 == 完成' } }, stages: [{ id: 't', key: '阶段1_b', data: { 主线节点: [node('n2', 'F2')] } }] },
  ];
  const host = createHost({ tables: live });
  host.w.AutoCardUpdaterAPI.getTableTemplate = () => JSON.parse(JSON.stringify(tpl));
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('独立表');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  (() => { const t = doc.querySelector('[data-act="run-set-toggle"][aria-expanded="false"]'); t && t.click(); })(); await tick(); (() => { const t = doc.querySelector('[data-act="run-fold"][data-key="advOpen"][aria-expanded="false"]'); t && t.click(); })(); await tick();
  doc.querySelector('[data-act="clue-gen-template"]').click(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  assert.equal(dlg.querySelectorAll('[data-gt-label]').length, 1, dlg.textContent.slice(0, 300));
  assert.match(dlg.textContent, /开局要用1条线索/);
  await inst.destroy();
});

test('remapStages (复核二 6): progress on a rewritten stage maps back to the original id when volume + stage name match once', () => {
  const before = [{ id: 'v', key: '卷', stages: [{ id: 's1', key: '阶段1_开场' }, { id: 's2', key: '阶段2_追查' }] }];
  const after = [{ id: 'v', key: '卷', stages: [{ id: 's1', key: '阶段1_开场' }, { id: 'n2', key: '阶段2_追查' }, { id: 'n3', key: '阶段3_新' }] }];
  const prog = { current: 'n2', slots: { n2: { state: 'done' }, n3: { state: 'active' } } };
  const out = C.remapStages(prog, C.flattenUnits(after), C.flattenUnits(before));
  assert.equal(out.current, 's2');
  assert.equal(out.slots.s2.state, 'done');
  assert.ok(out.slots.n3, 'a stage with no counterpart is not guessed');
});

test('off-track undo (复核二 6): the player opens the next stage while the setting check runs, then undoes → stays on that stage', async () => {
  const { host, inst, pid, doc } = await offTrackSetup();
  let release;
  host.llm.respond = (body) =>
    /偏离了大纲/.test(body)
      ? '```yaml\n剧情_卷1_街区:\n  阶段1_开场:\n    主线节点:\n      - {id: n_a, 名称: 甲}\n  阶段2_追查:\n    主线节点: []\n```'
      : /剧情大纲已经调整/.test(body)
        ? new Promise((r) => { release = () => r('世界观正文：\n设定\n\n速查：x'); })
        : '{"done":[],"stageDone":false,"offTrack":true,"offReason":"偏了","reason":"x"}';
  inst.data.updateSettings({ checkEvery: 1 });
  host.addMessage({ is_user: true, mes: '一' });
  host.addMessage({ is_user: false, mes: '剧情走偏了。' });
  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, 1, 'normal');
  await tick(); await tick(); await tick();
  doc.querySelector('[data-notice="offtrack"] [data-act="0"]').click(); await tick();
  doc.querySelector('.pi-dialog .pi-dlg-acts .is-primary').click();
  for (let i = 0; i < 20 && !release; i++) await tick();
  inst.runtime.openNext({ silent: true });
  const at = () => { const u = C.flattenUnits(inst.data.project(pid).outline.volumes); return C.currentIndex(u, inst.runtime.progress()); };
  assert.equal(at(), 1);
  release();
  for (let i = 0; i < 10 && !/撤销/.test(doc.querySelector('[data-notice="offtrack"]')?.textContent || ''); i++) await tick();
  host.llm.respond = () => '{}';
  [...doc.querySelectorAll('[data-notice="offtrack"] [data-act]')].find((b) => /撤销/.test(b.textContent)).click(); await tick();
  assert.equal(inst.runtime.progress().current, 's2', 'back on the original stage 2');
  assert.equal(at(), 1);
  await inst.destroy();
});

test('改线索标签 (复核二 7): seed rows only, F8 checked clean and unchanged → saved as ai in the project, table not written', async () => {
  const seedSheet = { name: '关键事实表', content: [['row_id', '编号', '状态', '标签', '登记口径']], seedRows: [['1', 'F7', '未获得', 'A标签7', 'A口径7'], ['2', 'F8', '未获得', 'A标签8', 'A口径8']] };
  const host = createHost({ tables: { sheet_f: seedSheet } });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('P');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: [{ id: 'v', key: '剧情_M1_案子', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 's1', key: '阶段1', data: { 主线节点: [{ id: 'n1', 名称: 'a', 入口: 'a', 发现: [{ 事实: 'F7', 内容: '甲' }, { 事实: 'F8', 内容: '乙' }], 完成条件: { 事实: 'F7' } }] } }] }] }, clue: { mode: 'clue', bindings: { facts: [{ 表: '关键事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document, $ = (s) => doc.querySelector(s);
  $(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  $('[data-act="tab"][data-tab="run"]').click(); await tick();
  for (const sel of ['[data-act="run-set-toggle"][aria-expanded="false"]', '[data-act="clue-bind-toggle"]'])
    !$('[data-act="clue-labels-edit"]') && $(sel) && ($(sel).click(), await tick(), await tick());
  $('[data-act="clue-labels-edit"]').click(); await tick(); await tick();
  const dlg = $('.pi-dialog');
  dlg.querySelector('[data-le-label="0"]').value = '新7';
  host.llm.respond = () => '```yaml\n- {编号: F7, 透露: 否}\n- {编号: F8, 透露: 否}\n```';
  dlg.querySelector('[data-fr-check]').click(); await tick(); await waitStatus(dlg);
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '保存').click();
  for (let i = 0; i < 8; i++) await tick();
  const labels = inst.data.project(p.id).clue.labels;
  assert.equal(labels.F8.src, 'ai');
  assert.equal(host.w.AutoCardUpdaterAPI.updated.length, 0, 'seed table not written');
  await inst.destroy();
});
