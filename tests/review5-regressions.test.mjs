// GPT review §15 (of 0468157) — reproductions as regression tests. Each must fail on the pre-fix code.
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

function liveTables(t) {
  const out = JSON.parse(JSON.stringify(t));
  for (const [k, s] of Object.entries(out)) if (k.startsWith('sheet_')) s.content = s.content.map((row, i) => (i === 0 ? row : [i, ...row.slice(1)]));
  return out;
}
async function setup({ names = ['小镇'] } = {}) {
  const tables = liveTables(buildTemplate({
    controlRow: ['主线', ''],
    factRows: ['F_box', 'F_ledger', 'F_seen', 'F_print', 'F_talk'].map((code) => ({ code, label: code })),
    knowRows: [{ fact: 'F_seen', actor: 'user' }, { fact: 'F_ledger', actor: 'user' }],
  }));
  const host = createHost({ tables });
  const inst = host.load();
  await inst.ready;
  const volumes = Object.entries(YAML.parse(storyText)).map(([key, stages], vi) => ({ id: `v${vi}`, key, stages: Object.entries(stages).map(([sk, data], si) => ({ id: `s${vi}_${si}`, key: sk, data })) }));
  const ids = [];
  for (const name of names) {
    const p = await inst.data.createProject(name);
    inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: JSON.parse(JSON.stringify(volumes)) }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML) } }));
    ids.push(p.id);
  }
  await inst.runtime.switchProject(ids[0]);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  inst.open();
  await tick();
  const doc = host.w.document;
  const click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  const set = (sheet, key, col, v) => { const s = Object.values(tables).find((x) => x && x.name === sheet); s.content.find((r, i) => i > 0 && r[1] === key)[s.content[0].indexOf(col)] = v; };
  const commit = () => { host.db.setTables(tables); };
  await click(`[data-act="project"][data-id="${ids[0]}"]`);
  return { host, inst, doc, click, set, commit, ids };
}
const switchChat = async (host, id) => { host.state.chatId = id; await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await tick(); };
const fence = (body) => ['```yaml', body, '```'].join('\n');
const REWRITE_BAD = fence([
  '剧情_卷一_小镇失窃案:',
  '  阶段二_调查:',
  '    主线节点:',
  '      - id: n_ledger',
  '        名称: 查账本',
  '        入口: 翻账本',
  '        发现: [{事实: F_ledger, 内容: 改过的答案}]',
  '        完成条件: {事实: F_talk}',
].join('\n'));
const BROKEN = fence(['剧情_卷一_小镇失窃案:', '  阶段二_调查:', '    主线节点:', '      - id: n_ledger', '        完成条件: {事实: F_talk'].join('\n'));
async function makeRewriteDraft(ctx, reply) {
  const { host, doc, click } = ctx;
  await click('[data-act="tab"][data-tab="run"]');
  host.llm.reply = reply;
  doc.querySelector('[data-act="rewrite"]').click(); await tick();
  doc.querySelector('.pi-dialog textarea, .pi-dialog input').value = 'x';
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick(); await tick();
  await click('[data-act="tab"][data-tab="outline"]');
}
const ledgerDone = (inst, id) => JSON.parse(JSON.stringify(inst.data.project(id).outline.volumes[0].stages[1].data.主线节点.find((n) => n.id === 'n_ledger').完成条件));

for (const how of ['draft-reparse', 'draft-fix']) {
  test(`15.2-1: a broken rewrite draft from chat A cannot be ${how === 'draft-fix' ? 'AI-fixed' : 're-parsed'} in chat B and then applied`, async () => {
    const ctx = await setup();
    const { host, inst, doc, set, commit, ids } = ctx;
    set('关键事实表', 'F_box', '状态', '已核实'); set('关键事实表', 'F_ledger', '状态', '已核实'); commit();
    await makeRewriteDraft(ctx, BROKEN);
    assert.ok(doc.querySelector('[data-act="draft-reparse"]'), 'format-error draft shown');
    await switchChat(host, 'chat-B');
    host.llm.reply = REWRITE_BAD;
    const calls = host.llmCalls.length;
    doc.querySelector('[data-draft-yaml]').value = REWRITE_BAD.split('\n').slice(1, -1).join('\n');
    doc.querySelector(`[data-act="${how}"]`).click(); await tick(); await tick();
    assert.equal(host.llmCalls.length, calls, 'no fix request from the wrong chat');
    const rest = doc.querySelector('[data-act="draft-rest"]');
    if (rest) { rest.click(); await tick(); }
    assert.equal(doc.querySelector('.pi-dialog'), null, 'no apply confirm in chat B');
    assert.deepEqual(ledgerDone(inst, ids[0]), { 事实: 'F_ledger' }, 'shared outline unchanged');
    await inst.destroy();
  });
}

test('15.2-1: making another project active and coming back cannot skip history protection', async () => {
  const ctx = await setup({ names: ['甲', '乙'] });
  const { inst, doc, set, commit, ids, click } = ctx;
  set('关键事实表', 'F_box', '状态', '已核实'); set('关键事实表', 'F_ledger', '状态', '已核实'); commit();
  await makeRewriteDraft(ctx, REWRITE_BAD);
  await inst.runtime.switchProject(ids[1]); await tick();
  await click(`[data-act="project"][data-id="${ids[0]}"]`);
  await click('[data-act="tab"][data-tab="outline"]');
  const rest = doc.querySelector('[data-act="draft-rest"]');
  if (rest) { rest.click(); await tick(); }
  assert.equal(doc.querySelector('.pi-dialog'), null, 'not applied while the project is not active for this chat');
  assert.deepEqual(ledgerDone(inst, ids[0]), { 事实: 'F_ledger' });
  await inst.destroy();
});

test('15.2-2: a rewrite turning an ended stage back to not-entered (locking the next stage) is flagged', () => {
  const vols = [{ id: 'v', key: '剧情_卷一', stages: [
    { id: 's1', key: '阶段一_a', data: { 主线节点: [{ id: 'n1', 名称: 'a', 入口: 'e', 发现: [{ 事实: 'F1', 内容: 'c' }], 完成条件: { 事实: 'F1' } }] } },
    { id: 's2', key: '阶段二_b', data: { 进入条件: { 事实: 'F1' }, 主线节点: [{ id: 'n2', 名称: 'b', 入口: 'e', 发现: [{ 事实: 'F2', 内容: 'c' }], 完成条件: { 事实: 'F2' } }] } },
    { id: 's3', key: '阶段三_c', data: { 主线节点: [{ id: 'n3', 名称: 'c', 入口: '去第三处', 发现: [{ 事实: 'F3', 内容: 'c' }], 完成条件: { 事实: 'F3' } }] } },
  ] }];
  const next = JSON.parse(JSON.stringify(vols));
  next[0].stages[1].data.进入条件 = { 事实: 'F3' };
  const snap = { facts: new Map(['F1', 'F2'].map((id) => [id, { id, status: 'confirmed', text: 'x', raw: '已核实' }])), knowledge: [], tables: {} };
  const g = C.historyGuard(vols, next, snap, C.emptyClueProgress(), C.normalizeClue({ mode: 'clue' }));
  const all = g.notes.join('\n');
  assert.match(all, /阶段「阶段二 b」原来已经结束，改写后会变回「未进入」/);
  assert.match(all, /n3「c」/, 'the lost entry of the next stage is named');
});

test('15.3: deleting a whole unfinished node that has a confirmed discovery is flagged', () => {
  const vols = [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's', key: '阶段一_a', data: { 主线节点: [
    { id: 'n1', 名称: '甲', 入口: 'e', 发现: [{ 事实: 'F1', 内容: 'c' }, { 事实: 'F2', 内容: 'c' }], 完成条件: { 全部: [{ 事实: 'F1' }, { 事实: 'F2' }] } },
    { id: 'n2', 名称: '乙', 入口: 'e', 发现: [{ 事实: 'F3', 内容: 'c' }], 完成条件: { 事实: 'F3' } },
  ] } }] }];
  const next = JSON.parse(JSON.stringify(vols));
  next[0].stages[0].data.主线节点 = [next[0].stages[0].data.主线节点[1]];
  const snap = { facts: new Map([['F1', { id: 'F1', status: 'confirmed', text: 'x', raw: '已核实' }]]), knowledge: [], tables: {} };
  const g = C.historyGuard(vols, next, snap, C.emptyClueProgress(), C.normalizeClue({ mode: 'clue' }));
  assert.match(g.notes.join('\n'), /n1「甲」（改写后被删除）中已经获得或已经说出的发现 F1/);
});

test('15.3: the final confirm lists outcomes computed NOW (fact confirmed while the draft waited)', async () => {
  const ctx = await setup();
  const { inst, doc, set, commit } = ctx;
  set('关键事实表', 'F_box', '状态', '已核实'); commit();
  const draftYaml = fence(['剧情_卷一_小镇失窃案:', '  阶段二_调查:', '    主线节点:', '      - id: n_ledger', '        名称: 查账本', '        入口: 翻账本', '        发现: [{事实: F_ledger, 内容: c}]', '        完成条件: {事实: F_talk}'].join('\n'));
  await makeRewriteDraft(ctx, draftYaml);
  set('关键事实表', 'F_talk', '状态', '已核实'); commit();
  doc.querySelector('[data-act="draft-rest"]').click(); await tick();
  assert.match(doc.querySelector('.pi-dialog').textContent, /这次改写会让 n_ledger「查账本」直接变成已完成/);
  await inst.destroy();
});

test('15.2-3: same chat, database switched to another branch between preview and confirm → nothing written', async () => {
  const { host, inst, doc } = await setup();
  host.db.setTables(liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [{ code: 'F_box', label: 'a' }], knowRows: [] }))); await tick();
  doc.querySelector('[data-act="clue-prebuild"]').click(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  dlg.querySelectorAll('[data-pb-label]').forEach((el, i) => { el.value = `标签${i}`; });
  host.db.setTables(liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [{ code: 'F_other', label: 'b' }], knowRows: [] })));
  dlg.querySelector('.pi-btn.is-primary').click(); await tick(); await tick();
  assert.equal(host.w.AutoCardUpdaterAPI.inserted.length, 0, 'nothing written into the other branch');
  await inst.destroy();
});

test('15.2-3 (P2): a previewed row that is already present again at confirm is skipped; nothing outside the preview is written', async () => {
  const { host, inst, doc } = await setup();
  const t = liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [{ code: 'F_box', label: 'a' }], knowRows: [] }));
  host.db.setTables(t); await tick();
  doc.querySelector('[data-act="clue-prebuild"]').click(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  dlg.querySelectorAll('[data-pb-label]').forEach((el, i) => { el.value = `标签${i}`; });
  // while the dialog is open, the fill model adds F_ledger itself → it must not be inserted twice
  const s2 = Object.values(t).find((x) => x && x.name === '关键事实表');
  s2.content.push([s2.content.length, 'F_ledger', '填表加的', '', '未获得', '', '']);
  host.db.setTables(t);
  dlg.querySelector('.pi-btn.is-primary').click(); await tick(); await tick();
  const codes = host.w.AutoCardUpdaterAPI.inserted.map((x) => x.data['编号']).filter(Boolean);
  assert.ok(!codes.includes('F_ledger'), 'already present → skipped');
  assert.ok(codes.length > 0 && codes.every((c) => ['F_seen', 'F_print', 'F_talk'].includes(c)), 'only previewed, still-missing rows');
  await inst.destroy();
});

test('15.3: audit fingerprints author blocks in stage names and field names', () => {
  const secret = '这是一段只放在阶段标题和字段名里的足够长的作者秘密文字内容';
  const project = { setting: { text: '' }, outline: { volumes: [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's', key: `阶段一_a<仅作者>${secret}</仅作者>`, data: { [`<仅作者>${secret}二号</仅作者>`]: 'x', 主线节点: [] } }] }] } };
  const state = { focus: { uid: '' }, nodeStates: [] };
  const sources = C.restrictedSources(project, state);
  assert.ok(sources.some((x) => /阶段名/.test(x.label)), 'stage name source');
  assert.ok(sources.some((x) => /字段名/.test(x.label)), 'field name source');
  const r = C.auditRequest(`另一本世界书带进来：${secret}`, project, state, '', {});
  assert.ok(r.leaks.length > 0, 'leak reported');
});

test('15.3 (P3): key collision keeps the exact public field; constructor/toString keys survive', () => {
  const out = C.stripAuthorDeep({ '地<仅作者>秘</仅作者>点': '私改', 地点: '公开地点', constructor: '甲', toString: '乙' });
  assert.equal(out.地点, '公开地点');
  assert.equal(Object.prototype.hasOwnProperty.call(out, 'constructor'), true);
  assert.equal(out.constructor, '甲');
  assert.equal(out.toString, '乙');
});

// ---------- found in the real-SillyTavern run ----------
test('real ST: after importing a template with data, rows sit in sheet.seedRows (content = header only) → plugin reads them', () => {
  const sheet = (name, head, seeds) => ({ name, content: [['row_id', ...head]], seedRows: seeds.map((r, i) => [String(i + 1), ...r]) });
  const t = {
    sheet_f: sheet('关键事实表', ['编号', '标签', '登记口径', '状态', '内容', '依据'], [['F1', 'x', '', '已核实', '找到了', ''], ['F2', 'y', '', '未获得', '', '']]),
    sheet_k: sheet('知情表', ['键', '事实', '角色', '获知方式', '可信度', '依据'], [['F1@user', 'F1', 'user', '亲见', '已核实', '']]),
    sheet_c: sheet('线索控制表', ['标识', '启用', '当前场景', '当前时间'], [['主线', '1', '', '2026-03-15 18:00']]),
  };
  const f = C.readFacts(t, [{ 表: '关键事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实', 内容列: '内容' }]);
  assert.deepEqual([...f.facts.keys()], ['F1', 'F2']);
  assert.equal(f.facts.get('F1').status, 'confirmed');
  const k = C.readKnowledge(t, [{ 表: '知情表', 事实列: '事实', 角色列: '角色', 方式列: '获知方式', 可信度列: '可信度', 已核实值: '已核实' }]);
  assert.equal(k.rows.length, 1);
  assert.equal(C.readCell(t, '线索控制表/主线/启用').value, '1');
  // once content has rows, content wins (seed rows are only the initial snapshot)
  t.sheet_f.content.push(['9', 'F1', 'x', '', '存疑', '', '']);
  assert.equal(C.readFacts(t, [{ 表: '关键事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }]).facts.get('F1').status, 'unconfirmed');
});

test('real ST: a fact first recorded as 存疑 without ever being offered is also flagged (F_gossip mis-fill)', async () => {
  const { host, inst } = await setup();
  const t = liveTables(buildTemplate({
    controlRow: ['主线', ''],
    factRows: ['F_box', 'F_ledger', 'F_seen', 'F_print', 'F_talk'].map((code) => ({ code, label: code })),
    knowRows: [{ fact: 'F_seen', actor: 'user' }],
  }));
  const s = Object.values(t).find((x) => x && x.name === '关键事实表');
  s.content.find((r, i) => i > 0 && r[1] === 'F_seen')[s.content[0].indexOf('状态')] = '存疑';
  host.db.setTables(t);
  assert.deepEqual(JSON.parse(JSON.stringify(inst.runtime.clue.compute().unoffered.map((x) => [x.id, x.raw]))), [['F_seen', '存疑']]);
  await inst.destroy();
});
