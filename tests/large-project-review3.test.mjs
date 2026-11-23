// 大型项目第 1、2 批代码审阅（GPT，2026-11-18）的反例，以及自查发现的「视图丢掉模板初始行」。
// 每条在修之前都应失败。
import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';
import { buildTemplate, BINDING_YAML } from '../templates/clue-tables/build-template.mjs';

const C = loadCore();
const tick = () => new Promise((r) => setTimeout(r, 20));
const node = (id, fact, extra = {}) => ({ id, 名称: id, 入口: `去${id}`, 地点: id, 发现: [{ 事实: fact, 内容: `${id}查到的`, 记录: `看到${id}时登记` }], 完成条件: { 事实: fact }, ...extra });
const FB = [{ 表: '关键事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }];
const KB = [{ 表: '知情表', 事实列: '事实', 角色列: '角色', 方式列: '获知方式', 可信度列: '可信度', 已核实值: '已核实', 未知值: ['未知'] }];
const FACT_HEAD = [null, '编号', '标签', '登记口径', '状态', '内容', '依据'];
const KNOW_HEAD = [null, '键', '事实', '角色', '获知方式', '可信度', '依据'];
const realTables = (facts = [], knows = [], { seedFacts = null } = {}) => ({
  sheet_f: {
    name: '关键事实表',
    content: [FACT_HEAD, ...facts.map(([c, st], i) => [i + 1, c, '', '', st, '', ''])],
    ...(seedFacts ? { seedRows: seedFacts.map(([c, st]) => [null, c, '', '', st, '', '']) } : {}),
  },
  sheet_k: { name: '知情表', content: [KNOW_HEAD, ...knows.map(([f, a, w], i) => [i + 1, `${f}@${a}`, f, a, w, '未核实', ''])] },
});

// ---------- 自查：视图要和别处一样读模板初始行 ----------
test('effectiveTables: a fresh chat whose template pre-fills F_a=已核实 in seedRows keeps that value in the condition view (D21)', () => {
  const vols = [
    { id: 'v1', key: '剧情_M1_a', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 's1', key: '阶段1_a', data: { 主线节点: [node('n_a', 'F_a'), node('n_b', 'F_b')] } }] },
  ];
  const tables = realTables([], [], { seedFacts: [['F_a', '已核实']] });
  const view = C.effectiveTables(tables, { facts: FB, knowledge: KB }, C.prebuildPlan(vols));
  const f = C.readFacts(view, FB).facts;
  assert.equal(f.get('F_a').status, 'confirmed', 'the author\'s pre-filled value survives');
  assert.equal(f.get('F_b').status, 'unconfirmed', 'the missing row is padded as 未获得');
});

// ---------- 审阅 2：老绑定、混合绑定、同表双绑定、主角别名 ----------
const twoLines = () => [
  { id: 'vM', key: '剧情_M1_a', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 's1', key: '阶段1_a', data: { 主线节点: [node('n1', 'F1')] } }] },
  { id: 'vS', key: '剧情_S2_b', line: { 编号: 'S2', 类型: '支线', 开启条件: { 线: 'M1 == 完成' } }, stages: [{ id: 's2', key: '阶段1_b', data: { 主线节点: [node('n2', 'F2')] } }] },
];

test('condReads: a second, old-style binding on the same table does not read the padded rows as confirmed / known', () => {
  const vols = twoLines();
  const bindings = { facts: [FB[0], { 表: '关键事实表', 编号列: '编号' }], knowledge: [KB[0], { 表: '知情表', 事实列: '事实', 角色列: '角色' }] };
  const tables = realTables();
  const view = C.effectiveTables(tables, bindings, C.prebuildPlan(vols));
  const r = C.condReads(tables, view, bindings);
  assert.notEqual(r.facts.get('F1') && r.facts.get('F1').status, 'confirmed', 'padded 未获得 row is not 已核实 through the old binding');
  assert.equal(r.knowledge.length, 0, 'nobody knows anything from padded rows');
  // order swapped: the old binding first → nothing is padded at all, nothing confirmed
  const swapped = { facts: [bindings.facts[1], bindings.facts[0]], knowledge: [bindings.knowledge[1], bindings.knowledge[0]] };
  const v2 = C.effectiveTables(tables, swapped, C.prebuildPlan(vols));
  const r2 = C.condReads(tables, v2, swapped);
  assert.ok(!r2.facts.has('F1') || r2.facts.get('F1').status !== 'confirmed');
  assert.equal(r2.knowledge.length, 0);
});

test('prebuildDiff / prebuiltGaps: 主角 / 玩家 / {{user}} in the table count as the planned F1@user (D47); no duplicate row planned', () => {
  for (const actor of ['主角', '玩家', '{{user}}', '<user>', 'user']) {
    const k = C.readKnowledge(realTables([['F1', '未获得']], [['F1', actor, '未知']]), KB);
    const plan = { facts: [{ code: 'F1' }], knows: [{ key: 'F1@user', fact: 'F1', actor: 'user' }, { key: 'F1@主角', fact: 'F1', actor: '主角' }] };
    const diff = C.prebuildDiff(plan, { facts: new Map([['F1', {}]]), knowPresent: k.present }, { facts: FB, knowledge: KB });
    assert.equal(diff.newKnows.length, 0, `${actor} → nothing missing`);
    const gaps = C.prebuiltGaps(C.compileClue([{ id: 'v', key: '剧情_卷1_a', stages: [{ id: 's', key: '阶段1_a', data: { 主线节点: [node('n', 'F9', { 开放条件: { 知情: 'F1@user' } })] } }] }]), { facts: new Map([['F1', {}], ['F9', {}]]), knowPresent: k.present });
    assert.ok(!gaps.some((g) => /F1@user/.test(g)), `${actor} → no missing-know report`);
  }
  // the plan itself lists the player twice (explicit 主角 + default user) → one row
  const diff = C.prebuildDiff({ facts: [], knows: [{ key: 'F1@user', fact: 'F1', actor: 'user' }, { key: 'F1@主角', fact: 'F1', actor: '主角' }] }, { facts: new Map(), knowPresent: new Set() }, { facts: FB, knowledge: KB });
  assert.equal(diff.newKnows.length, 1);
});

test('prebuiltGaps: checkFacts / checkKnowledge false → that kind of row is not reported missing', () => {
  const comp = C.compileClue([{ id: 'v', key: '剧情_卷1_a', stages: [{ id: 's', key: '阶段1_a', data: { 主线节点: [node('n', 'F1', { 开放条件: { 知情: 'F2@user' } })] } }] }]);
  const snap = { facts: new Map(), knowPresent: new Set() };
  assert.ok(C.prebuiltGaps(comp, snap).length >= 1);
  assert.deepEqual(C.prebuiltGaps(comp, snap, { checkFacts: false, checkKnowledge: false }), []);
});

// ---------- 审阅 3：已开始的线自己的开线条件 ----------
test('rowScope: a started line\'s own open condition keeps the outside fact it reads (F2 produced only by unstarted S2)', () => {
  const vols = [
    { id: 'vM', key: '剧情_M1_a', line: { 编号: 'M1', 类型: '主线', 开启条件: { 事实: 'F2' } }, stages: [{ id: 's1', key: '阶段1_a', data: { 主线节点: [node('n1', 'F1')] } }] },
    { id: 'vS', key: '剧情_S2_b', line: { 编号: 'S2', 类型: '支线' }, stages: [{ id: 's2', key: '阶段1_b', data: { 主线节点: [node('n2', 'F2'), node('n3', 'F3')] } }] },
  ];
  const sc = C.rowScope(C.compileClue(vols), new Set(['M1']));
  assert.ok(sc.facts.has('F2'), 'F2 is kept');
  assert.ok(sc.future.has('F3'), 'the rest of S2 is still future');
});

// ---------- 审阅 5：改写采用 ----------
const vol3 = () => [
  { id: 'vM1', key: '剧情_M1_街区', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 'sM1', key: '阶段1_街区', data: { 主线节点: [node('n_m1', 'F1')] } }] },
  { id: 'vS2', key: '剧情_S2_仓库', line: { 编号: 'S2', 类型: '支线', 开启条件: { 事实: 'F1' } }, stages: [{ id: 'sS2', key: '阶段1_仓库', data: { 主线节点: [node('n_s2', 'F2')] } }] },
];

test('pickLineIncoming: a volume with M1\'s name but 线.编号 S2 is not taken for M1', () => {
  const vols = vol3();
  const got = C.pickLineIncoming(vols[0], [{ key: '剧情_M1_街区', line: { 编号: 'S2' }, stages: [{ id: 'x', key: '阶段1_x', data: {} }] }]);
  assert.equal(got.hit, null);
  // a second volume with the right id but a new name is still taken
  const ok = C.pickLineIncoming(vols[0], [
    { key: '剧情_S3_别的', line: { 编号: 'S3' }, stages: [] },
    { key: '剧情_M1_新名', line: { 编号: 'M1' }, stages: [{ id: 'y', key: '阶段1_y', data: {} }] },
  ]);
  assert.equal(ok.hit.key, '剧情_M1_新名');
});

test('crossLineLoss: S2 opens on F1, M1 stops producing F1 → reported (S2\'s own condition does not count as a source)', () => {
  const vols = vol3();
  const next = [{ ...vols[0], stages: [{ id: 'sM1', key: '阶段1_街区', data: { 主线节点: [node('n_m1', 'F9')] } }] }, vols[1]];
  const lost = C.crossLineLoss(vols, next, 'vM1');
  assert.equal(lost.length, 1);
  assert.match(lost[0], /F1/);
  // a pure opening event (no node ever produced it) is not "lost"
  const ev = [vols[0], { ...vols[1], line: { ...vols[1].line, 开启条件: { 事实: 'F_event' } } }];
  assert.deepEqual(C.crossLineLoss(ev, ev, 'vM1'), []);
  // 相关事实 and table path conditions are consumers too
  const rel = [vols[0], { ...vols[1], line: { 编号: 'S2', 类型: '支线' }, stages: [{ id: 'sS2', key: '阶段1_仓库', data: { 主线节点: [node('n_s2', 'F2', { 相关事实: ['F1'] })] } }] }];
  assert.equal(C.crossLineLoss(rel, [next[0], rel[1]], 'vM1').length, 1);
});

// ---------- 审阅 7：请求内容 ----------
test('rewrite prompt (per line): format sample and done-stage changes come from the target line only', () => {
  const vols = [
    { id: 'vM1', key: '剧情_M1_街区', line: { 编号: 'M1' }, stages: [{ id: 'sM1', key: '阶段1_街区', data: { AI指令: 'M1正文标记', 状态变化: ['M1变化标记'], 主线节点: [] } }] },
    { id: 'vS3', key: '剧情_S3_仓库', line: { 编号: 'S3' }, stages: [
      { id: 'sS3a', key: '阶段1_旧', data: { 状态变化: ['S3变化'], 主线节点: [] } },
      { id: 'sS3b', key: '阶段2_仓库', data: { AI指令: 'S3正文', 主线节点: [] } },
    ] },
  ];
  const units = C.flattenUnits(vols), from = units.findIndex((u) => u.id === 'sS3b');
  const msgs = C.rewriteRestMessages({ setting: '', volumes: vols, fromUnitIndex: from, units, recent: '', reason: '', rest: units.slice(from).filter((u) => u.volume.id === 'vS3'), others: '' });
  const all = msgs.map((m) => m.content).join('\n');
  assert.ok(!/M1正文标记/.test(all), 'no M1 text in the sample');
  assert.ok(!/M1变化标记/.test(all), 'no M1 changes');
  assert.match(all, /S3变化/);
  const sync = C.syncSettingMessages({ guide: 'g', setting: 's', units, fromUnitIndex: from, rest: units.slice(from).filter((u) => u.volume.id === 'vS3') });
  assert.ok(!/M1变化标记/.test(sync.map((m) => m.content).join('\n')));
});

// ---------- panel ----------
function liveTables(t) {
  const out = JSON.parse(JSON.stringify(t));
  for (const [k, s] of Object.entries(out)) if (k.startsWith('sheet_')) s.content = s.content.map((row, i) => (i === 0 ? row : [i, ...row.slice(1)]));
  return out;
}

test('panel: old bindings (no status / no 方式列) → no missing-row report and the discovery is not held back', async () => {
  const host = createHost({ tables: liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [], knowRows: [] })) });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('老绑定');
  const b = YAML.parse(BINDING_YAML);
  b.facts = [{ 表: '关键事实表', 编号列: '编号' }];
  b.knowledge = [{ 表: '知情表', 事实列: '事实', 角色列: '角色' }];
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: twoLines() }, clue: { mode: 'clue', bindings: b } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.runtime.clue.invalidate();
  const c = inst.runtime.clue.compute();
  assert.ok(!c.snap.problems.some((x) => /没有这些编号的行|还没有这些「事实@角色」/.test(x)), c.snap.problems.join(' | '));
  assert.equal(c.notReady.size, 0, 'F1 not held back waiting for a row the plugin will never write');
  await inst.destroy();
});

test('panel: standard fact binding + know binding without 方式列 → F1 not held back by the know row', async () => {
  const host = createHost({ tables: liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [], knowRows: [] })) });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('混合');
  const b = YAML.parse(BINDING_YAML);
  b.knowledge = [{ 表: '知情表', 事实列: '事实', 角色列: '角色' }];
  const sig = Object.fromEntries(C.labelsToPrepare(twoLines(), {}).map((x) => [x.code, x.sig]));
  const labels = Object.fromEntries(Object.entries(sig).map(([k, s]) => [k, { label: `标签${k}`, criterion: 'k', sig: s }]));
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: twoLines() }, clue: { mode: 'clue', bindings: b, labels } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  await host.addMessage('一', true); await host.addMessage('开始。', false); await host.settle();
  for (let i = 0; i < 2; i++) { inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines(); }
  inst.runtime.clue.invalidate();
  const c = inst.runtime.clue.compute();
  assert.ok(c.snap.facts.has('F1'), 'F1 row written (standard fact binding)');
  assert.ok(!c.notReady.has('F1'), 'not held back by the know row the plugin will not write');
  assert.ok(!host.w.AutoCardUpdaterAPI.inserted.some((x) => x.tableName === '知情表'), 'no know row written');
  await inst.destroy();
});

test('panel: 按大纲补表格行 — isolation switched while the dialog is open → nothing written, no labels saved', async () => {
  const meta = (code) => ({ __userscripts: { shujuku_v120__userscript_settings_v1: { shujuku_v120_globalMeta_v1: JSON.stringify({ activeIsolationCode: code }) } } });
  const host = createHost({ tables: liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [], knowRows: [] })) });
  host.ctx.extensionSettings = meta('A');
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('隔离');
  const vols = twoLines().map(({ line, ...v }) => v);
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML) } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  await host.addMessage('一', true); await host.addMessage('开始。', false); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  (() => { const t = doc.querySelector('[data-act="run-set-toggle"][aria-expanded="false"]'); t && t.click(); })(); await tick();
  doc.querySelector('[data-act="clue-prebuild"]').click(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  assert.ok(dlg, 'dialog');
  dlg.querySelectorAll('[data-pb-label]').forEach((el, i) => { el.value = `标签${i}`; el.dispatchEvent(new el.ownerDocument.defaultView.Event('input', { bubbles: true })); });
  host.ctx.extensionSettings = meta('B');
  const before = host.w.AutoCardUpdaterAPI.inserted.length;
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '写入当前聊天').click(); await tick(); await tick();
  assert.equal(host.w.AutoCardUpdaterAPI.inserted.length, before, 'nothing written into isolation B');
  assert.deepEqual(Object.keys(inst.data.project(p.id).clue.labels || {}), [], 'no labels saved');
  await inst.destroy();
});

// 大纲模式面板（改写在大纲页）
async function outlineSetup(vols) {
  const host = createHost({ tables: buildTemplate({ controlRow: ['主线', ''], factRows: [], knowRows: [] }) });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('多线');
  inst.data.updateProject(p.id, (x) => ({ ...x, setting: { ...x.setting, text: '设定' }, outline: { volumes: vols } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  const click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  const dlgBtn = async (label) => { const b = [...doc.querySelectorAll('.pi-dialog .pi-btn')].find((x) => x.textContent === label); assert.ok(b, `dialog button ${label}`); b.click(); await tick(); };
  await click(`[data-act="project"][data-id="${p.id}"]`);
  return { host, inst, doc, click, dlgBtn, pid: p.id };
}

test('panel: the target line comes second in the reply → adopted and the setting is checked exactly once, from the target line', async () => {
  const vols = [
    { id: 'vM1', key: '剧情_M1_街区', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 'sM1', key: '阶段1_街区', data: { 主线节点: [node('n_m1', 'F_m1')] } }] },
    { id: 'vS3', key: '剧情_S3_旧仓库', line: { 编号: 'S3', 类型: '支线' }, stages: [{ id: 'sS3', key: '阶段1_仓库', data: { 主线节点: [node('n_s3', 'F_s3')] } }] },
  ];
  const { host, inst, doc, click, dlgBtn, pid } = await outlineSetup(vols);
  await click('[data-act="tab"][data-tab="run"]');
  host.llm.respond = (body) =>
    /偏离了大纲|只改写/.test(body)
      ? '```yaml\n剧情_M1_街区:\n  阶段1_不该要:\n    主线节点: []\n剧情_S3_旧仓库:\n  阶段1_新仓库:\n    主线节点: []\n```'
      : /剧情大纲已经调整/.test(body)
        ? '世界观正文：\n设定\n\n速查：x'
        : '{}';
  doc.querySelector('[data-act="rewrite"]').click(); await tick();
  doc.querySelector('.pi-dialog [data-rw-line]').value = 'vS3';
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick(); await tick();
  const calls = host.llmCalls.length;
  await click('[data-act="draft-rest"]');
  await dlgBtn('替换');
  for (let i = 0; i < 5; i++) await tick();
  const out = inst.data.project(pid).outline.volumes;
  assert.deepEqual(JSON.parse(JSON.stringify(out.find((v) => v.id === 'vS3').stages.map((s) => s.key))), ['阶段1_新仓库']);
  assert.equal(out.find((v) => v.id === 'vM1').stages[0].key, '阶段1_街区', 'M1 untouched');
  const syncs = host.llmCalls.slice(calls).filter((c) => /剧情大纲已经调整/.test(c.body));
  assert.equal(syncs.length, 1, 'setting checked once');
  assert.match(syncs[0].args.prompt, /阶段1_新仓库/);
  await inst.destroy();
});

test('setting check: the author edits the setting while the check runs → the late result is not applied', async () => {
  const vols = [{ id: 'vM1', key: '剧情_卷1_a', stages: [{ id: 's1', key: '阶段1_a', data: { 主线节点: [] } }] }];
  const { host, inst, pid } = await outlineSetup(vols);
  let release;
  host.llm.respond = () => new Promise((r) => { release = () => r('世界观正文：\n校对稿\n\n速查：x'); });
  const job = inst.runtime.syncSetting(pid, { from: 0 }).then(() => 'applied', (e) => String(e && e.message));
  await tick();
  inst.data.updateProject(pid, (p) => ({ ...p, setting: { ...p.setting, text: '作者刚改的设定' } }));
  release();
  const r = await job;
  assert.match(r, /校对期间设定已被修改/, 'reported');
  assert.equal(inst.data.project(pid).setting.text, '作者刚改的设定', 'not overwritten');
  await inst.destroy();
});

// ---------- 审阅 6：撤销保留之后的操作 ----------
test('off-track rewrite (sequential): a node checked off and another stage set by hand after the rewrite survive undo', async () => {
  const vols = [
    { id: 'vM1', key: '剧情_卷1_街区', stages: [
      { id: 's1', key: '阶段1_开场', data: { 主线节点: [{ id: 'n_a', 名称: '甲' }] } },
      { id: 's2', key: '阶段2_追查', data: { 主线节点: [{ id: 'n_b', 名称: '乙' }] } },
    ] },
    { id: 'vM2', key: '剧情_卷2_码头', stages: [{ id: 's3', key: '阶段1_码头', data: { 主线节点: [] } }] },
  ];
  const { host, inst, pid } = await outlineSetup(vols);
  host.llm.respond = (body) =>
    /偏离了大纲/.test(body)
      ? '```yaml\n剧情_卷1_街区:\n  阶段1_开场:\n    主线节点:\n      - {id: n_a, 名称: 甲}\n  阶段2_新追查:\n    主线节点: []\n```'
      : /剧情大纲已经调整/.test(body)
        ? '世界观正文：\n设定\n\n速查：x'
        : '{"done":[],"stageDone":false,"offTrack":true,"offReason":"偏了","reason":"x"}';
  inst.data.updateSettings({ checkEvery: 1 });
  host.addMessage({ is_user: true, mes: '一' });
  host.addMessage({ is_user: false, mes: '剧情走偏了。' });
  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, 1, 'normal');
  await tick(); await tick(); await tick();
  const doc = host.w.document;
  doc.querySelector('[data-notice="offtrack"] [data-act="0"]').click(); await tick();
  doc.querySelector('.pi-dialog .pi-dlg-acts .is-primary').click();
  for (let i = 0; i < 10 && !/撤销/.test(doc.querySelector('[data-notice="offtrack"]')?.textContent || ''); i++) await tick();
  host.llm.respond = () => '{}';
  // after the rewrite: the player checks off n_a and marks 卷2 done by hand
  let prog = inst.runtime.progress();
  const s1 = C.flattenUnits(inst.data.project(pid).outline.volumes)[0];
  prog = C.setNodeChecked(prog, s1.id, 'n_a', false, '甲');
  prog = C.patchSlot(prog, 's3', { state: 'done' });
  inst.runtime.setProgress(prog);
  [...doc.querySelectorAll('[data-notice="offtrack"] [data-act]')].find((b) => /撤销/.test(b.textContent)).click(); await tick();
  const after = inst.runtime.progress();
  // the rewritten 阶段1 maps back to the original s1 (same volume, same stage name) — GPT 第二次复核 6
  assert.ok((after.slots.s1.off || []).some((x) => String(x).startsWith('n_a')), 'checked-off node kept, on the original stage');
  assert.equal(after.slots.s3.state, 'done', 'hand-set stage state kept');
  assert.deepEqual(JSON.parse(JSON.stringify(inst.data.project(pid).outline.volumes[0].stages.map((s) => s.key))), ['阶段1_开场', '阶段2_追查'], 'outline undone');
  await inst.destroy();
});

// ---------- 审阅 8：标签弹窗的来源 ----------
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

test('template dialog: the review misses F_a → status does not say "no problems"; clicking again only reviews (no new generation)', async () => {
  const { host, inst, dlg, pid } = await templateDialog(oneLine());
  let gens = 0, reviews = 0;
  host.llm.respond = (body) => {
    if (/有没有剧透/.test(body)) { reviews++; return reviews === 1 ? '```yaml\n- {编号: F_b, 透露: 否}\n```' : '```yaml\n- {编号: F_a, 透露: 否}\n```'; }
    gens++;
    return GEN2;
  };
  dlg.querySelector('[data-fr-auto]').click(); await tick(); await waitStatus(dlg);
  const st = dlg.querySelector('[data-fr-status]').textContent;
  assert.ok(!/没有发现问题/.test(st), st);
  assert.match(st, /1条尚未检查/);
  dlg.querySelector('[data-fr-auto]').click(); await tick(); await waitStatus(dlg);
  assert.equal(gens, 1, 'not generated again');
  assert.equal(reviews, 2);
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '写入当前聊天').click(); await tick(); await tick();
  const labels = inst.data.project(pid).clue.labels;
  assert.equal(labels.F_a.src, 'ai');
  assert.equal(labels.F_b.src, 'ai');
  await inst.destroy();
});

test('template dialog: review missed and the author confirms anyway → gen (to be checked), not user', async () => {
  const { host, inst, dlg, pid } = await templateDialog(oneLine());
  host.llm.respond = (body) => (/有没有剧透/.test(body) ? '```yaml\n- {编号: F_b, 透露: 否}\n```' : GEN2);
  dlg.querySelector('[data-fr-auto]').click(); await tick(); await waitStatus(dlg);
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '写入当前聊天').click(); await tick(); await tick();
  const labels = inst.data.project(pid).clue.labels;
  assert.equal(labels.F_a.src, 'gen');
  assert.equal(labels.F_b.src, 'ai');
  await inst.destroy();
});

test('template dialog: the author types a label while generation runs → not auto-reviewed, never replaced; saved as user', async () => {
  const { host, inst, dlg, pid } = await templateDialog(oneLine());
  host.llm.respond = (body) => {
    if (/有没有剧透/.test(body)) return '```yaml\n- {编号: F_a, 透露: 是, 透露了什么: 写出了答案, 改成标签: 模型改的, 改成口径: 模型改的口径}\n- {编号: F_b, 透露: 否}\n```';
    { const e = dlg.querySelector('[data-gt-label="0"]'); e.value = '作者写的'; e.dispatchEvent(new e.ownerDocument.defaultView.Event('input', { bubbles: true })); }
    return GEN2;
  };
  dlg.querySelector('[data-fr-auto]').click(); await tick(); await waitStatus(dlg);
  assert.equal(dlg.querySelector('[data-gt-label="0"]').value, '作者写的', 'not replaced');
  const rv = host.llmCalls.filter((c) => /有没有剧透/.test(c.body));
  assert.equal(rv.length, 1);
  assert.doesNotMatch(rv[0].body, /编号: F_a/, 'the half-written row is not sent automatically');
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '写入当前聊天').click(); await tick(); await tick();
  assert.equal(inst.data.project(pid).clue.labels.F_a.src, 'user');
  await inst.destroy();
});

// ---------- 审阅 5：已完成节点要放回目标线 ----------
test('panel: a done node missing from the reply goes back into the target line even when the reply lists another line first', async () => {
  const vols = [
    { id: 'vM1', key: '剧情_M1_街区', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 'sM1', key: '阶段1_街区', data: { 主线节点: [node('n_done', 'F_done'), node('n_m1', 'F_m1')] } }] },
    { id: 'vS3', key: '剧情_S3_仓库', line: { 编号: 'S3', 类型: '支线' }, stages: [{ id: 'sS3', key: '阶段1_仓库', data: { 主线节点: [node('n_s3', 'F_s3')] } }] },
  ];
  const host = createHost({ tables: liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [], knowRows: [] })) });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('保留');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML) } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  // F_done recorded as 已核实 → n_done is done
  await host.w.AutoCardUpdaterAPI.insertRow({ tableName: '关键事实表', data: { 编号: 'F_done', 状态: '已核实' } });
  inst.runtime.clue.invalidate();
  const done = inst.runtime.clue.compute().state.nodeStates.find((s) => s.node.uid === 'n_done');
  assert.equal(done && done.status, 'done', 'precondition: n_done is done');
  inst.open(); await tick();
  const doc = host.w.document;
  const click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  await click(`[data-act="project"][data-id="${p.id}"]`);
  await click('[data-act="tab"][data-tab="run"]');
  host.llm.reply = '```yaml\n剧情_S3_仓库:\n  阶段1_x:\n    主线节点: []\n剧情_M1_新名:\n  线: {编号: M1, 类型: 主线}\n  阶段1_街区:\n    主线节点:\n      - {id: n_m1, 名称: n_m1, 入口: 去n_m1, 发现: [{事实: F_m1, 内容: x}], 完成条件: {事实: F_m1}}\n```';
  { const pm = doc.querySelector('[data-act="run-prog-menu"]'); if (pm) { pm.click(); await tick(); doc.querySelector('[data-dlg-value="rewrite"]').click(); } else doc.querySelector('[data-act="rewrite"]').click(); } await tick();
  const sel = doc.querySelector('.pi-dialog [data-rw-line]');
  if (sel) sel.value = 'vM1';
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick(); await tick();
  await click('[data-act="draft-rest"]');
  const ok = [...doc.querySelectorAll('.pi-dialog .pi-btn')].find((x) => x.textContent === '替换');
  assert.ok(ok, 'confirm dialog');
  ok.click(); await tick(); await tick();
  const out = inst.data.project(p.id).outline.volumes;
  const m1 = out.find((v) => v.id === 'vM1');
  const uids = m1.stages.flatMap((s) => (s.data.主线节点 || []).map((n) => n.id));
  assert.ok(uids.includes('n_done'), `done node back in M1: ${uids}`);
  assert.ok(!out.find((v) => v.id === 'vS3').stages.some((s) => s.key === '阶段1_x'), 'S3 untouched');
  await inst.destroy();
});

// ---------- 审阅 8：「改线索标签」的「检查」按钮 ----------
test('改线索标签: the visible 检查 button reviews the current text, only flags a leak (never replaces), and a clean check is saved as ai', async () => {
  const sheet = (rows) => ({ name: '关键事实表', content: [['row_id', '编号', '状态', '标签', '登记口径'], ...rows.map((r, i) => [String(i + 1), ...r])], sourceData: { note: '' }, updateConfig: { updateFrequency: -1 } });
  const host = createHost({ tables: { sheet_f: sheet([['F7', '未获得', '订单', '口径A'], ['F8', '未获得', '旧标签', '口径B']]) } });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('P');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: [{ id: 'v', key: '剧情_M1_案子', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 's1', key: '阶段1', data: { 主线节点: [{ id: 'n1', 名称: 'a', 入口: 'a', 发现: [{ 事实: 'F7', 内容: '甲' }, { 事实: 'F8', 内容: '乙' }], 完成条件: { 事实: 'F7' } }] } }] }] }, clue: { mode: 'clue', bindings: { facts: [{ 表: '关键事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  const $ = (sel) => doc.querySelector(sel);
  $(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  $('[data-act="tab"][data-tab="run"]').click(); await tick();
  for (const sel of ['[data-act="run-set-toggle"][aria-expanded="false"]'])
    !$('[data-act="clue-labels-edit"]') && $(sel) && ($(sel).click(), await tick(), await tick());
  $('[data-act="clue-labels-edit"]').click(); await tick(); await tick();
  const dlg = $('.pi-dialog');
  const btn = dlg.querySelector('[data-fr-check]');
  assert.ok(btn && !btn.hidden, 'visible 检查 button');
  assert.ok(dlg.querySelector('[data-fr-auto]').closest('.pi-fr-start').hidden, '自动填写 stays hidden in this dialog');
  dlg.querySelector('[data-le-label="1"]').value = '甲写的新标签';
  const sent = [];
  host.llm.respond = (body) => {
    sent.push(body);
    return '```yaml\n- {编号: F7, 透露: 否}\n- {编号: F8, 透露: 是, 透露了什么: 写出了答案, 改成标签: 模型改的}\n```';
  };
  btn.click(); await tick();
  for (let i = 0; i < 30 && /正在/.test(dlg.querySelector('[data-fr-status]').textContent); i++) await tick();
  assert.equal(sent.length, 1);
  assert.match(sent[0], /甲写的新标签/, 'the current text is sent');
  assert.equal(dlg.querySelector('[data-le-label="1"]').value, '甲写的新标签', 'not replaced');
  assert.match(dlg.querySelector('[data-fr-warn="1"]').textContent, /会透露答案/);
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '保存').click();
  for (let i = 0; i < 10; i++) await tick();
  const labels = inst.data.project(p.id).clue.labels;
  assert.equal(labels.F7.src, 'ai', 'unchanged text, checked clean → ai');
  assert.equal(labels.F8.src, 'user', 'edited by hand → user');
  await inst.destroy();
});
