// 「生成线索模板」核心：当前模板 + 三张线索表 + 默认表规则调整（设计决定 D22、D23，GPT §17）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { loadCore } from './load.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const C = loadCore();
const DEFAULT = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/shujuku-default-template-spv8.9.2.json'), 'utf8'));
const byName = (t, name) => Object.values(t).find((s) => s && s.name === name);
const head = (s) => s.content[0].slice(1);
const CLUE = {
  controlRow: ['主线', ''],
  factRows: [{ code: 'F1', label: '甲', criterion: '口径甲' }, { code: 'F2', label: '乙', criterion: '' }],
  knowRows: [{ fact: 'F1', actor: 'user' }, { fact: 'F2', actor: 'user' }],
  scenes: [{ uid: 'n1', entry: '去甲处', place: '甲地' }],
};

test('default template: 3 clue tables added with seed rows; nothing removed; input untouched', () => {
  const before = JSON.stringify(DEFAULT);
  const r = C.synthesizeClueTemplate(DEFAULT, { clue: CLUE });
  assert.equal(JSON.stringify(DEFAULT), before, 'input not mutated');
  assert.deepEqual(r.created, ['线索控制表', '关键事实表', '知情表']);
  for (const [k, s] of Object.entries(DEFAULT)) if (k.startsWith('sheet_')) {
    const now = r.template[k];
    assert.ok(now, `${s.name} kept under the same key`);
    assert.equal(now.uid, s.uid);
    for (const col of head(s)) assert.ok(head(now).includes(col), `${s.name}.${col} kept`);
  }
  assert.equal(byName(r.template, '关键事实表').content.length, 3);
  assert.equal(byName(r.template, '知情表').content.length, 3);
  assert.match(byName(r.template, '线索控制表').sourceData.note, /【场景编号对照】[\s\S]*n1：去甲处；地点：甲地/);
  assert.deepEqual(JSON.parse(JSON.stringify(r.problems)), [], 'default template is fully recognised');
});

test('default template: 全局数据表 + clue tables realtime in one group; other tables keep their schedule', () => {
  const r = C.synthesizeClueTemplate(DEFAULT, { clue: CLUE });
  for (const name of ['全局数据表', '线索控制表', '关键事实表', '知情表']) {
    const u = byName(r.template, name).updateConfig;
    assert.equal(u.updateFrequency, 1, name); assert.equal(u.skipFloors, 0, name); assert.equal(u.groupId, 0, name);
  }
  for (const name of ['重要角色表', '纪要表', '背包物品表', '主角信息表']) assert.deepEqual(byName(r.template, name).updateConfig, byName(DEFAULT, name).updateConfig, name);
});

test('重要角色表: two nullable columns appended to header and DDL; no 来源 column', () => {
  const r = C.synthesizeClueTemplate(DEFAULT, { clue: CLUE });
  const s = byName(r.template, '重要角色表');
  assert.deepEqual(head(s).slice(-2), ['剧情身份', '当前动向']);
  assert.ok(!head(s).includes('来源'));
  assert.match(s.sourceData.ddl, /interaction_options TEXT, -- 交互选项\n  plot_identity TEXT, -- 剧情身份\n  current_intent TEXT -- 当前动向\n\);/);
  // export (by-name detail + index) unchanged
  assert.deepEqual(s.exportConfig, byName(DEFAULT, '重要角色表').exportConfig);
});

test('conflicting default trigger sentences replaced; rules appended once; other rule text unchanged', () => {
  const r = C.synthesizeClueTemplate(DEFAULT, { clue: CLUE });
  const ch = byName(r.template, '重要角色表'), q = byName(r.template, '任务与事件表'), o = byName(r.template, '选项表');
  assert.ok(!ch.sourceData.initNode.includes('故事开始时为当前已知的重要角色分别插入条目。'));
  assert.match(ch.sourceData.initNode, /只为开场正文里实际登场/);
  assert.ok(ch.sourceData.initNode.includes('relation_text 必须写'), 'format constraint kept');
  assert.match(q.sourceData.initNode, /不要根据设定预写主线任务/);
  for (const s of [ch, q, o]) {
    assert.equal(s.sourceData.note.split('【线索主线附加规则·剧情注入器】').length, 2, `${s.name} one block`);
    assert.ok(s.sourceData.note.startsWith(byName(DEFAULT, s.name).sourceData.note), `${s.name} original note kept as prefix`);
    for (const f of ['updateNode', 'deleteNode']) assert.equal(s.sourceData[f], byName(DEFAULT, s.name).sourceData[f], `${s.name}.${f} unchanged`);
  }
  for (const name of ['主角信息表', '主角技能表', '背包物品表', '纪要表', '全局数据表']) assert.deepEqual(byName(r.template, name).sourceData, byName(DEFAULT, name).sourceData, `${name} rules untouched`);
});

test('idempotent: generating twice gives the same template; existing clue rows are not re-seeded', () => {
  const once = C.synthesizeClueTemplate(DEFAULT, { clue: CLUE }).template;
  const twice = C.synthesizeClueTemplate(once, { clue: CLUE });
  assert.deepEqual(twice.template, once);
  assert.deepEqual(JSON.parse(JSON.stringify(twice.created)), []);
  assert.deepEqual(JSON.parse(JSON.stringify(twice.changes)), [], 'nothing to change the second time');
  // second mainline: more facts in the outline → template does NOT append rows to an existing clue table
  const more = C.synthesizeClueTemplate(once, { clue: { ...CLUE, factRows: [...CLUE.factRows, { code: 'F3', label: '丙' }], scenes: [...CLUE.scenes, { uid: 'n2', entry: '去乙处' }] } });
  assert.equal(byName(more.template, '关键事实表').content.length, 3, 'no new rows via template');
  assert.match(byName(more.template, '线索控制表').sourceData.note, /n2：去乙处/, 'scene catalog refreshed');
  assert.equal(byName(more.template, '线索控制表').sourceData.note.split('\n【场景编号对照】（只用于对号').length, 2, 'catalog not duplicated');
});

test('unknown / customised tables are left alone and reported, not rewritten', () => {
  const t = JSON.parse(JSON.stringify(DEFAULT));
  const q = byName(t, '任务与事件表'); q.content[0] = ['row_id', '任务', '状态']; // user-customised
  const ch = byName(t, '重要角色表'); ch.sourceData.initNode = '我自己的初始化规则';
  delete t[Object.keys(t).find((k) => t[k] && t[k].name === '全局数据表')];
  t.sheet_custom = { uid: 'sheet_custom', name: '我的表', content: [['row_id', '甲']], sourceData: { note: 'x' }, updateConfig: {}, exportConfig: {}, orderNo: 9 };
  const r = C.synthesizeClueTemplate(t, { clue: CLUE });
  assert.deepEqual(r.template.sheet_custom, t.sheet_custom);
  assert.deepEqual(byName(r.template, '任务与事件表'), q, 'customised quest table untouched');
  assert.equal(byName(r.template, '重要角色表').sourceData.initNode, '我自己的初始化规则');
  const p = r.problems.join('\n');
  assert.match(p, /没有「全局数据表」/);
  assert.match(p, /「任务与事件表」的列和数据库默认不一致/);
  assert.match(p, /「重要角色表」的初始化规则和数据库默认不同，没有替换/);
});

test('old five-table companion template (our previous one) → clue tables kept with their rows; no global table reported', () => {
  const old = {
    sheet_ClueFact01: { uid: 'sheet_ClueFact01', name: '关键事实表', content: [['row_id', '编号', '标签', '登记口径', '状态', '内容', '依据'], ['1', 'F1', '甲', '', '已核实', '找到了', '第2楼']], sourceData: { note: 'n' }, updateConfig: { updateFrequency: 1, skipFloors: 0, groupId: 0 }, exportConfig: {}, orderNo: 1 },
    sheet_ClueCtrl01: { uid: 'sheet_ClueCtrl01', name: '线索控制表', content: [['row_id', '标识', '启用', '当前场景', '当前时间'], ['1', '主线', '1', 'n1', '2026-03-15 18:00']], sourceData: { note: '旧说明\n【场景编号对照】（只用于对号；不表示已经开放或已经发生）\n- n0：旧' }, updateConfig: { updateFrequency: 1, skipFloors: 0, groupId: 0 }, exportConfig: {}, orderNo: 0 },
    mate: { type: 'chatSheets', version: 1 },
  };
  const r = C.synthesizeClueTemplate(old, { clue: CLUE });
  assert.deepEqual(byName(r.template, '关键事实表').content, old.sheet_ClueFact01.content, 'existing fact rows untouched');
  assert.deepEqual(head(byName(r.template, '线索控制表')), ['标识', '启用', '当前场景', '当前时间'], 'old control columns kept (no deletion)');
  assert.match(byName(r.template, '线索控制表').sourceData.note, /^旧说明\n【场景编号对照】[\s\S]*n1：去甲处/);
  assert.ok(!/n0：旧/.test(byName(r.template, '线索控制表').sourceData.note), 'old catalog replaced');
  assert.deepEqual(r.created, ['知情表']);
  assert.match(r.problems.join('\n'), /没有「全局数据表」/);
});

test('generated template: every DDL runs in SQLite together (11 tables), header matches DDL columns', () => {
  const r = C.synthesizeClueTemplate(DEFAULT, { clue: CLUE });
  const db = new DatabaseSync(':memory:');
  let n = 0;
  for (const [k, s] of Object.entries(r.template)) {
    if (!k.startsWith('sheet_')) continue;
    db.exec(s.sourceData.ddl); n++;
    const table = /CREATE TABLE\s+(\w+)/.exec(s.sourceData.ddl)[1];
    const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
    assert.equal(cols.length, s.content[0].length, `${s.name}: DDL columns = header width`);
  }
  assert.equal(n, 11);
  // seed rows insert cleanly into the clue tables
  db.exec("INSERT INTO clue_facts (code, label, criterion) VALUES ('F1', '甲', '口径甲')");
  db.exec("INSERT INTO important_non_romance (name, plot_identity, current_intent) VALUES ('某人', '第1楼自称商人', '已出发去车站')");
});

// ---------- plot preset compatibility hint (only recall is supported; others are flagged, never changed) ----------
const PRESETS = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/plot-presets.json'), 'utf8'));
test('plot preset: built-in 时间召回 is compatible (no hint)', () => {
  assert.deepEqual(JSON.parse(JSON.stringify(C.plotPresetConflicts(PRESETS.timeRecall))), []);
  assert.deepEqual(JSON.parse(JSON.stringify(C.plotPresetConflicts(null))), [], 'built-in default (no preset object) → no hint');
});
test('plot preset: a story-driving task (act/scene/dm_story) is flagged; its recall task is not', () => {
  const r = JSON.parse(JSON.stringify(C.plotPresetConflicts(PRESETS.huizhencheng)));
  assert.equal(r.length, 1);
  assert.equal(r[0].task, '推进');
  assert.deepEqual(r[0].tags, ['act', 'scene', 'inner', 'file', 'scene', 'dm_track', 'dm_story']);
  const off = JSON.parse(JSON.stringify(PRESETS.huizhencheng)); off.plotTasks[1].enabled = false;
  assert.deepEqual(JSON.parse(JSON.stringify(C.plotPresetConflicts(off))), [], 'disabled task → no hint');
});
