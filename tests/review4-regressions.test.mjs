// GPT review §11 (v0.2.0) V1–V4 — reproductions as regression tests, driven through the real panel where the
// review did. Each must fail on the pre-fix code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';
import { buildTemplate, BINDING_YAML } from '../templates/clue-tables/build-template.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const storyText = fs.readFileSync(path.join(here, '../templates/clue-tables/示例_小镇失窃案.yaml'), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 20));
const C = loadCore();
const SECRET = '测试秘密_XYZ';

function liveTables(t) {
  const out = JSON.parse(JSON.stringify(t));
  for (const [k, s] of Object.entries(out)) if (k.startsWith('sheet_')) s.content = s.content.map((row, i) => (i === 0 ? row : [i, ...row.slice(1)]));
  return out;
}
async function setup(mode, { names = ['小镇'] } = {}) {
  const tables = liveTables(buildTemplate({
    controlRow: ['主线', ''],
    factRows: ['F_box', 'F_ledger', 'F_seen', 'F_print', 'F_talk'].map((code) => ({ code, label: code })),
    knowRows: [{ fact: 'F_seen', actor: 'user' }, { fact: 'F_ledger', actor: 'user' }],
  }));
  const host = createHost({ tables });
  host.state.chatMetadata.world_info = '测试书';
  host.ctx.loadWorldInfo = async () => ({ entries: { 0: { uid: 0, comment: '资料', content: `公开开头〈<仅作者>内层</仅作者>〉尾部${SECRET}`, key: ['x'] } } });
  const inst = host.load();
  await inst.ready;
  const volumes = Object.entries(YAML.parse(storyText)).map(([key, stages], vi) => ({ id: `v${vi}`, key, stages: Object.entries(stages).map(([sk, data], si) => ({ id: `s${vi}_${si}`, key: sk, data })) }));
  const ids = [];
  for (const name of names) {
    const p = await inst.data.createProject(name);
    inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: JSON.parse(JSON.stringify(volumes)) }, clue: { mode, bindings: YAML.parse(BINDING_YAML) } }));
    ids.push(p.id);
  }
  await inst.runtime.switchProject(ids[0]);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  inst.open();
  await tick();
  const doc = host.w.document;
  const click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  const dlgBtn = async (label) => { const b = [...doc.querySelectorAll('.pi-dialog .pi-btn')].find((x) => x.textContent === label); assert.ok(b, `dialog button ${label}`); b.click(); await tick(); };
  const set = (sheet, key, col, v) => { const s = Object.values(tables).find((x) => x && x.name === sheet); s.content.find((r, i) => i > 0 && r[1] === key)[s.content[0].indexOf(col)] = v; };
  const commit = () => { host.db.setTables(tables); };
  await click(`[data-act="project"][data-id="${ids[0]}"]`);
  return { host, inst, doc, click, dlgBtn, set, commit, ids };
}
const injected = (inst) => inst.runtime.entries().map((e) => e.content).join('\n');

// ---------- V2: nested author blocks ----------
test('V2 core: nested <仅作者> is stripped as a whole; unclosed opener hides the rest; stray closer dropped', () => {
  assert.equal(C.stripAuthorBlocks('前<仅作者>a<仅作者>b</仅作者>尾秘密</仅作者>后'), '前后');
  assert.equal(C.stripAuthorBlocks('公开<仅作者>没闭合的秘密'), '公开');
  assert.equal(C.stripAuthorBlocks('公开</仅作者>继续'), '公开继续');
  assert.equal(C.stripAuthorBlocks('甲<仅作者>x</仅作者>乙<仅作者>y</仅作者>丙'), '甲乙丙');
  assert.equal(C.wrapAuthorText('前<仅作者>内</仅作者>尾'), '<仅作者>\n前内尾\n</仅作者>');
});

test('V2: outline mode — a legal author block inside a node 事件 is not injected; surrounding text kept', async () => {
  const { inst, ids } = await setup('outline');
  inst.data.updateProject(ids[0], (x) => {
    const vols = JSON.parse(JSON.stringify(x.outline.volumes));
    vols[0].stages[0].data.主线节点[0].事件 = `老板娘报案。<仅作者>${SECRET}</仅作者>主角答应帮忙。`;
    return { ...x, outline: { volumes: vols } };
  });
  inst.runtime.refresh();
  const text = injected(inst);
  assert.ok(!text.includes(SECRET), 'author block in node field not injected');
  assert.match(text, /老板娘报案。主角答应帮忙。/);
  await inst.destroy();
});

// ---------- V1: setting-tab import goes through the kind choice; V2 nested on import ----------
for (const tab of ['setting', 'outline']) {
  test(`V1/V2: ${tab} tab worldbook import defaults to author-only; nested inner block does not leak the tail`, async () => {
    const { inst, doc, click, dlgBtn, ids } = await setup('outline');
    await click(`[data-act="tab"][data-tab="${tab}"]`);
    if(tab==='outline'){await click('[data-act="outline-menu"]');await click('[data-dlg-value="import-wb"]');}else if(tab==='outline'){await click('[data-act="outline-menu"]');await click('[data-dlg-value="import-wb"]');}else await click('[data-act="import-wb"]');
    doc.querySelectorAll('.pi-dialog [data-pick]').forEach((el) => { el.checked = true; });
    doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick();
    assert.equal(doc.querySelectorAll('.pi-dialog [data-kind]').length, 2, 'kind choice shown');
    doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick(); // default: author-only
    await dlgBtn('保留');
    assert.match(inst.data.project(ids[0]).setting.text, new RegExp(SECRET), 'kept as author material');
    assert.ok(!injected(inst).includes(SECRET), 'not injected');
    assert.ok(!injected(inst).includes('公开开头'), 'whole entry is author-only');
    await inst.destroy();
  });

  test(`V1: ${tab} tab import — choosing public injects it; cancel imports nothing`, async () => {
    const { inst, doc, click, dlgBtn, ids } = await setup('outline');
    await click(`[data-act="tab"][data-tab="${tab}"]`);
    const before = inst.data.project(ids[0]).setting.text;
    if(tab==='outline'){await click('[data-act="outline-menu"]');await click('[data-dlg-value="import-wb"]');}else await click('[data-act="import-wb"]');
    doc.querySelectorAll('.pi-dialog [data-pick]').forEach((el) => { el.checked = true; });
    doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick();
    await dlgBtn('取消');
    assert.equal(inst.data.project(ids[0]).setting.text, before, 'cancel imports nothing');
    if(tab==='outline'){await click('[data-act="outline-menu"]');await click('[data-dlg-value="import-wb"]');}else await click('[data-act="import-wb"]');
    doc.querySelectorAll('.pi-dialog [data-pick]').forEach((el) => { el.checked = true; });
    doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick();
    doc.querySelector('.pi-dialog [data-kind="0"][value="public"]').checked = true;
    doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick();
    await dlgBtn('保留');
    assert.match(injected(inst), /公开开头/);
    assert.ok(!injected(inst).includes('内层'), 'inner author block of a public entry still stripped');
    await inst.destroy();
  });
}

// ---------- V3: rewrite must not reopen done nodes ----------
const REWRITE_BAD = '```yaml\n剧情_卷一_小镇失窃案:\n  阶段二_调查:\n    主线节点:\n      - id: n_ledger\n        名称: 查账本\n        入口: 翻账本\n        发现: [{事实: F_ledger, 内容: 改过的答案}]\n        完成条件: {事实: F_talk}\n      - id: n_witness\n        名称: 问邻居\n        入口: 去裁缝铺\n        发现: [{事实: F_seen, 内容: c}]\n        完成条件: {知情: F_seen@user}\n```';

test('V3: rewrite draft that changes a done node is flagged; applying keeps the original node → still done', async () => {
  const { host, inst, doc, click, dlgBtn, set, commit, ids } = await setup('clue');
  set('关键事实表', 'F_box', '状态', '已核实'); set('关键事实表', 'F_ledger', '状态', '已核实'); commit();
  const status = () => Object.fromEntries(inst.runtime.clue.compute().state.nodeStates.map((s) => [s.node.uid, s.status]));
  assert.equal(status().n_ledger, 'done');
  await click('[data-act="tab"][data-tab="run"]');
  host.llm.reply = REWRITE_BAD;
  doc.querySelector('[data-act="rewrite"]').click(); await tick();
  doc.querySelector('.pi-dialog textarea, .pi-dialog input').value = 'x';
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick(); await tick();
  const body = doc.querySelector('.pi-body').textContent;
  assert.match(body, /n_ledger「查账本」已完成，改写后会变回「可进行」；应用时会保留它原来的完成条件/);
  assert.ok(!/线索结构检查：没有发现问题/.test(body));
  await click('[data-act="draft-rest"]');
  await dlgBtn('替换');
  assert.equal(status().n_ledger, 'done', 'done node not reopened');
  const node = inst.data.project(ids[0]).outline.volumes[0].stages[1].data.主线节点.find((n) => n.id === 'n_ledger');
  assert.deepEqual(JSON.parse(JSON.stringify(node.完成条件)), { 事实: 'F_ledger' }, 'original done condition kept');
  // only the done condition is restored; the author's other edits to the node apply (no whole-node rollback)
  assert.equal(node.入口, '翻账本', 'other edits kept');
  assert.equal(node.发现[0].内容, '改过的答案', 'discovery text edit kept (narrator sees the recorded table text anyway)');
  await inst.destroy();
});

test('V3: draft stays while the story advances one more floor → apply re-checks against the new state', async () => {
  const { host, inst, doc, click, dlgBtn, set, commit, ids } = await setup('clue');
  set('关键事实表', 'F_box', '状态', '已核实'); commit();
  await click('[data-act="tab"][data-tab="run"]');
  host.llm.reply = REWRITE_BAD;
  doc.querySelector('[data-act="rewrite"]').click(); await tick();
  doc.querySelector('.pi-dialog textarea, .pi-dialog input').value = 'x';
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick(); await tick();
  // at draft time n_ledger was not done → no history warning; now the ledger gets found
  set('关键事实表', 'F_ledger', '状态', '已核实'); commit();
  await click('[data-act="draft-rest"]');
  await dlgBtn('替换');
  const node = inst.data.project(ids[0]).outline.volumes[0].stages[1].data.主线节点.find((n) => n.id === 'n_ledger');
  assert.deepEqual(JSON.parse(JSON.stringify(node.完成条件)), { 事实: 'F_ledger' });
  await inst.destroy();
});

test('V3: all stages finished → 改写后续 says there is nothing left, sends no request', async () => {
  const { host, inst, doc, click, set, commit } = await setup('clue');
  for (const f of ['F_box', 'F_ledger', 'F_talk']) set('关键事实表', f, '状态', '已核实');
  set('知情表', 'F_seen@user', '获知方式', '被告知'); commit();
  assert.equal(inst.runtime.clue.compute().state.current, null, 'story finished');
  await click('[data-act="tab"][data-tab="run"]');
  const calls = host.llmCalls.length;
  doc.querySelector('[data-act="rewrite"]').click(); await tick();
  assert.equal(doc.querySelector('.pi-dialog'), null, 'no reason dialog');
  assert.equal(host.llmCalls.length, calls, 'no model call');
  await inst.destroy();
});

// ---------- V4: drafts are per project ----------
const VOL = '```yaml\n剧情_卷二_甲:\n  阶段一_a:\n    主线节点:\n      - {id: n_new1, 名称: a, 入口: e, 发现: [{事实: F9, 内容: c}], 完成条件: {事实: F9}}\n```';

test('V4: a draft shown for project A does not appear in, and cannot be saved into, project B (same name)', async () => {
  const { host, inst, doc, click, ids } = await setup('clue', { names: ['同名', '同名'] });
  await click('[data-act="tab"][data-tab="outline"]');
  host.llm.reply = VOL;
  await click('[data-act="ai-volume"]'); await click('.pi-dialog .is-primary'); await tick();
  assert.ok(doc.querySelector('[data-act="draft-new"]'), 'A shows its draft');
  await click(`[data-act="project"][data-id="${ids[1]}"]`);
  await click('[data-act="tab"][data-tab="outline"]');
  assert.equal(doc.querySelector('[data-act="draft-new"]'), null, 'B does not show A draft');
  assert.equal(inst.data.project(ids[1]).outline.volumes.length, 1);
  await click(`[data-act="project"][data-id="${ids[0]}"]`);
  await click('[data-act="tab"][data-tab="outline"]');
  await click('[data-act="draft-new"]');
  assert.equal(inst.data.project(ids[0]).outline.volumes.length, 2, 'A can still save its own draft');
  assert.equal(inst.data.project(ids[1]).outline.volumes.length, 1);
  await inst.destroy();
});

test('V4: switching project while references are loading → A material is not sent for B, nothing lands in B', async () => {
  const { host, inst, doc, click, ids } = await setup('clue', { names: ['A', 'B'] });
  await click('[data-act="tab"][data-tab="outline"]');
  // make the worldbook load slow and switch project meanwhile
  let release;
  const gate = new Promise((r) => { release = r; });
  const slowLoad = host.ctx.loadWorldInfo;
  host.ctx.loadWorldInfo = async (n) => { await gate; return slowLoad(n); };
  const chat = await inst.data.loadChat(ids[0]);
  await inst.data.saveChat(ids[0], { ...chat, refs: { ...chat.refs, wb: { fields: {}, picks: { '测试书|k:0': true } } } });
  host.llm.reply = VOL;
  const calls = host.llmCalls.length;
  doc.querySelector('[data-act="ai-volume"]').click(); await tick();
  doc.querySelector('.pi-dialog .is-primary').click(); await tick();
  await click(`[data-act="project"][data-id="${ids[1]}"]`);
  release(); await tick(); await tick();
  assert.equal(host.llmCalls.length, calls, 'no request sent after the switch');
  await click('[data-act="tab"][data-tab="outline"]');
  assert.equal(doc.querySelector('[data-act="draft-new"]'), null, 'no draft in B');
  assert.equal(inst.data.project(ids[1]).outline.volumes.length, 1);
  await inst.destroy();
});

// ---------- V7: stage conditions referencing missing nodes ----------
test('V7: draft check and compile report a missing node in a stage enter/end condition', () => {
  const vols = [{ id: 'v', key: '剧情_卷二', stages: [{ id: 's', key: '阶段一_x', data: { 进入条件: { 节点: 'n_missing' }, 结束条件: { 节点: 'n_gone' }, 主线节点: [{ id: 'n1', 名称: 'a', 入口: 'e', 发现: [{ 事实: 'F1', 内容: 'c' }], 完成条件: { 事实: 'F1' } }] } }] }];
  const issues = C.checkClueDraft(vols, []).join('\n');
  assert.match(issues, /不存在的节点：n_missing、n_gone/);
  const errs = C.compileClue(vols).errors.join('\n');
  assert.match(errs, /阶段一_x·进入条件：引用了不存在的节点「n_missing」|进入条件：引用了不存在的节点「n_missing」/);
  assert.match(errs, /结束条件：引用了不存在的节点「n_gone」/);
});

// ---------- V8: projection of confirmed-without-content and already-voiced claims ----------
function v8Projection(rows, knowledge = []) {
  const sheet = (name, head, rs) => ({ name, content: [[null, ...head], ...rs.map((r) => [null, ...r])] });
  const vols = [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's', key: '阶段一_x', data: { 主线节点: [
    { id: 'n', 名称: '调查', 场景: '裁缝铺', 发现: [{ 事实: 'F1', 内容: '作者版：锁从里面撬开，不像外人砸开' }, { 事实: 'F2', 内容: '作者版：年轻人从后门出来' }, { 事实: 'F3', 内容: '还没查的' }], 完成条件: { 事实: 'F3' } },
  ] } }] }];
  const t = { sheet_f: sheet('事实表', ['编号', '状态', '内容', '依据'], rows), sheet_k: sheet('知情表', ['事实', '角色', '获知方式', '可信度'], knowledge) };
  const bind = { facts: [{ 表: '事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实', 说法值: '存疑', 内容列: '内容', 来源列: '依据' }], knowledge: [{ 表: '知情表', 事实列: '事实', 角色列: '角色', 方式列: '获知方式', 可信度列: '可信度', 已核实值: '已核实' }] };
  const f = C.readFacts(t, bind.facts), k = C.readKnowledge(t, bind.knowledge);
  const snap = { facts: f.facts, knowledge: k.rows, knowPresent: k.present, tables: t };
  const p = { ...C.emptyClueProgress(), focus: 'n' };
  const state = C.computeClueState(C.compileClue(vols), snap, p, C.normalizeClue({ mode: 'clue' }));
  return C.buildClueProjection(state, snap, p, {});
}

test('V8: confirmed with empty content → no author answer, explicit "no content recorded"', () => {
  const out = v8Projection([['F1', '已核实', '', ''], ['F2', '未获得', '', ''], ['F3', '未获得', '', '']]);
  assert.ok(!out.content.includes('锁从里面撬开'), 'author full answer not printed as obtained');
  assert.match(out.content, /F1 已经确认，但表格没有记录具体内容/);
});

test('V8: a discovery recorded as 存疑 is not "not yet happened"; it is given as the actual claim with source and listeners', () => {
  const out = v8Projection(
    [['F1', '未获得', '', ''], ['F2', '存疑', '老人说案发当晚看见一个年轻人', '第5楼 裁缝铺'], ['F3', '未获得', '', '']],
    [['F2', 'user', '被告知', '未核实']],
  );
  const [pendingPart] = out.content.split('已经有人说出');
  assert.ok(!pendingPart.includes('年轻人从后门出来'), 'author version of the claim not listed as pending');
  assert.ok(!out.content.includes('作者版：年轻人'), 'author version not printed at all');
  assert.match(out.content, /已经有人说出、但尚未核实的内容[\s\S]*老人说案发当晚看见一个年轻人｜来源：第5楼 裁缝铺｜知道的人：user（未核实）/);
  assert.ok(out.used.candidates.some((c) => c.fact === 'F2'), 'F2 can still be verified later by the fill model');
  assert.match(pendingPart, /还没查的/, 'the untouched discovery stays pending');
});

// ================= GPT §14 (review of 5ce5b37..b405f5b) =================
const switchChat = async (host, inst, id) => { host.state.chatId = id; await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await tick(); };

test('W1: prebuild confirmed after switching to chat B writes nothing into B', async () => {
  const { host, inst, doc, set, commit } = await setup('clue');
  // A's tables: only F_box pre-built → prebuild offers the rest
  const t = liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [{ code: 'F_box', label: 'a' }], knowRows: [] }));
  host.db.setTables(t);
  await tick();
  (() => { const t = doc.querySelector('[data-act="run-set-toggle"][aria-expanded="false"]'); t && t.click(); })(); await tick();
  doc.querySelector('[data-act="clue-prebuild"]').click(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  assert.ok(dlg, 'prebuild dialog in A');
  dlg.querySelectorAll('[data-pb-label]').forEach((el, i) => { el.value = `标签${i}`; el.dispatchEvent(new el.ownerDocument.defaultView.Event('input', { bubbles: true })); });
  await switchChat(host, inst, 'chat-B');
  dlg.querySelector('.pi-dlg-acts .pi-btn.is-primary').click(); await tick(); await tick();
  assert.equal(host.db.inserted ? host.db.inserted.length : host.w.AutoCardUpdaterAPI.inserted.length, 0, 'nothing written after the chat changed');
  await inst.destroy();
});

test('W1/§14.3: a failed fact insert does not create its knowledge rows; columns are checked before the first write', async () => {
  const { host, inst, doc } = await setup('clue');
  const t = liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [{ code: 'F_box', label: 'a' }], knowRows: [] }));
  host.db.setTables(t);
  const api = host.w.AutoCardUpdaterAPI, orig = api.insertRow;
  api.insertRow = async (a, b) => ((typeof a === 'object' ? a.data : b)['编号'] === 'F_seen' ? -1 : orig(a, b));
  await tick();
  (() => { const t = doc.querySelector('[data-act="run-set-toggle"][aria-expanded="false"]'); t && t.click(); })(); await tick();
  doc.querySelector('[data-act="clue-prebuild"]').click(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  dlg.querySelectorAll('[data-pb-label]').forEach((el, i) => { el.value = `标签${i}`; el.dispatchEvent(new el.ownerDocument.defaultView.Event('input', { bubbles: true })); });
  dlg.querySelector('.pi-dlg-acts .pi-btn.is-primary').click(); await tick(); await tick();
  const keys = api.inserted.map((x) => x.data['键']).filter(Boolean);
  assert.ok(!keys.includes('F_seen@user'), 'no knowledge row for the failed fact');
  assert.ok(keys.includes('F_ledger@user'), 'other knowledge rows still written');
  api.insertRow = orig;
  // a table without the 登记口径 column: refuse before writing anything
  const bad = liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [], knowRows: [] }));
  const fs2 = Object.values(bad).find((x) => x && x.name === '关键事实表');
  const ci = fs2.content[0].indexOf('登记口径');
  fs2.content[0].splice(ci, 1);
  host.db.setTables(bad);
  const before = api.inserted.length;
  (() => { const t = doc.querySelector('[data-act="run-set-toggle"][aria-expanded="false"]'); t && t.click(); })(); await tick();
  doc.querySelector('[data-act="clue-prebuild"]').click(); await tick();
  assert.equal(doc.querySelector('.pi-dialog'), null, 'no dialog when the table structure does not match');
  assert.equal(api.inserted.length, before);
  await inst.destroy();
});

test('W2: author blocks in a stage title or a custom field NAME are not injected in outline mode', async () => {
  const { inst, ids } = await setup('outline');
  inst.data.updateProject(ids[0], (x) => {
    const vols = JSON.parse(JSON.stringify(x.outline.volumes));
    vols[0].stages[0].key = `阶段一_报案<仅作者>${SECRET}标题</仅作者>`;
    vols[0].stages[0].data[`<仅作者>${SECRET}键名</仅作者>`] = '这一整个字段都应丢弃';
    vols[0].stages[0].data[`备注<仅作者>${SECRET}半键</仅作者>`] = '公开值';
    return { ...x, outline: { volumes: vols } };
  });
  inst.runtime.refresh();
  const text = injected(inst) + inst.runtime.entries().map((e) => e.title).join('');
  assert.ok(!text.includes(SECRET), 'no author text from titles or keys');
  assert.ok(!text.includes('这一整个字段都应丢弃'), 'a fully-private key drops its value too');
  assert.match(text, /备注: 公开值|备注：公开值|备注/, 'partly-private key keeps its public part');
  assert.match(text, /阶段一_报案/, 'title public part kept');
  await inst.destroy();
});

test('W3: a rewrite draft generated in chat A cannot be applied in chat B (shared outline, A-history)', async () => {
  const { host, inst, doc, click, dlgBtn, set, commit, ids } = await setup('clue');
  set('关键事实表', 'F_box', '状态', '已核实'); set('关键事实表', 'F_ledger', '状态', '已核实'); commit();
  await click('[data-act="tab"][data-tab="run"]');
  host.llm.reply = REWRITE_BAD;
  doc.querySelector('[data-act="rewrite"]').click(); await tick();
  doc.querySelector('.pi-dialog textarea, .pi-dialog input').value = 'x';
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick(); await tick();
  await switchChat(host, inst, 'chat-B');
  await click('[data-act="tab"][data-tab="outline"]');
  const draftBtn = doc.querySelector('[data-act="draft-rest"]');
  if (draftBtn) { draftBtn.click(); await tick(); }
  assert.equal(doc.querySelector('.pi-dialog'), null, 'no confirm dialog in B');
  const node = inst.data.project(ids[0]).outline.volumes[0].stages[1].data.主线节点.find((n) => n.id === 'n_ledger');
  assert.deepEqual(JSON.parse(JSON.stringify(node.完成条件)), { 事实: 'F_ledger' }, 'outline unchanged');
  await inst.destroy();
});

test('V3 result-based: rewrite that would directly complete an in-progress node is flagged (not blocked)', async () => {
  const { host, inst, doc, click, set, commit } = await setup('clue');
  set('关键事实表', 'F_box', '状态', '已核实'); set('关键事实表', 'F_talk', '状态', '已核实'); commit();
  await click('[data-act="tab"][data-tab="run"]');
  host.llm.reply = '```yaml\n剧情_卷一_小镇失窃案:\n  阶段二_调查:\n    主线节点:\n      - id: n_ledger\n        名称: 查账本\n        入口: 翻账本\n        发现: [{事实: F_ledger, 内容: c}]\n        完成条件: {事实: F_talk}\n```';
  doc.querySelector('[data-act="rewrite"]').click(); await tick();
  doc.querySelector('.pi-dialog textarea, .pi-dialog input').value = 'x';
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick(); await tick();
  assert.match(doc.querySelector('.pi-body').textContent, /这次改写会让 n_ledger「查账本」直接变成已完成/);
  await inst.destroy();
});

test('§14.2-2: the audit uses the same tag scanner — a tail after a nested inner block is reported as author material', () => {
  assert.deepEqual(C.authorSegments('公开<仅作者>甲<仅作者>乙</仅作者>尾部秘密很长很长的一段</仅作者>后'), ['甲乙尾部秘密很长很长的一段']);
  assert.deepEqual(C.authorSegments('公开<仅作者>没闭合的秘密'), ['没闭合的秘密']);
});
