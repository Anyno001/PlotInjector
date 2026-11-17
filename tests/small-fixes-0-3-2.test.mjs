// v0.3.2 小修复（用户 2026-11-17 酒馆实测）：疑似短名可以直接回答、待确认可以收起、表格条件的档位名换成数字、
// 「3 信任」== 3、导入后能改线索标签、导入页推进方式提示改对。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';

const C = loadCore();
const tick = () => new Promise((r) => setTimeout(r, 20));
const sheet = (name, head, rows, note = '') => ({ name, content: [['row_id', ...head], ...rows.map((r, i) => [String(i + 1), ...r])], sourceData: { note }, updateConfig: { updateFrequency: -1 } });
const env = (tables) => ({ facts: new Map(), knowledge: [], tables, nodeDone: () => undefined });
const ev = (cond, tables) => C.evalCondition(C.parseCondition(cond, []), env(tables)).v;

// ---------- 核心 ----------
const idx = { secretFlag: true, 人物: [{ 名称: '埃利奥特·维恩', 名字保密: true }] };
const VOLS = [{ id: 'v', key: '剧情_M1', stages: [{ id: 's7', key: '阶段7_拦截', data: { 主线节点: [{ id: 'n7', 名称: '查资料', 入口: '查', 发现: [{ 事实: 'F7', 内容: '查出维恩组织了交易', 记录: '正文出现维恩组织交易时登记' }], 完成条件: { 事实: 'F7' } }] } }] }];

test('short names: "same person" turns the hit into a fix-it error; "not" silences it', () => {
  const ask = C.checkImportDraft(VOLS, { index: idx }).filter((x) => /^secret-/.test(x.kind || ''));
  assert.deepEqual(ask.map((x) => [x.kind, x.level, x.name]), [['secret-short', 'warn', '维恩']]);
  const sure = C.checkImportDraft(VOLS, { index: idx, shortsSure: ['维恩'] }).filter((x) => /^secret-/.test(x.kind || ''));
  const fillHit = sure.find((x) => x.kind === 'secret-fill');
  assert.deepEqual(sure.map((x) => [x.kind, x.level, x.name]).sort(), [['secret-fill', 'error', '维恩'], ['secret-reveal', 'warn', '维恩']], 'the 记录 hit is an error with a fix; the 内容 standing alone asks for the reveal place (R4)');
  assert.match(fillHit.fix, /换成不点名的身份称呼/);
  const not = C.checkImportDraft(VOLS, { index: idx, shortsNot: ['维恩'] }).filter((x) => /^secret-/.test(x.kind || ''));
  assert.deepEqual(not, []);
  // 写入意见的那一行带上改法
  assert.match(C.issueCommentLine(fillHit), /换成不点名的身份称呼/);
});

test('R4: a confirmed short name revealed earlier on its own is still asked about; next to the full name it is not asked twice', () => {
  const v = (data1, data2) => [{ id: 'v', key: '剧情_M1', stages: [
    { id: 's1', key: '阶段1_初访', data: { 主线节点: [{ id: 'n1', 名称: '初访', 入口: '去', 发现: [{ 事实: 'F1', 内容: data1, 记录: '读到记录' }], 完成条件: { 事实: 'F1' } }] } },
    { id: 's2', key: '阶段2_揭晓', data: { 主线节点: [{ id: 'n2', 名称: '查明', 入口: '去', 发现: [{ 事实: 'F2', 内容: data2, 记录: '读到身份文件' }], 完成条件: { 事实: 'F2' } }] } },
  ] }];
  const reveals = (vols) => C.checkImportDraft(vols, { index: idx, shortsSure: ['维恩'] }).filter((x) => x.kind === 'secret-reveal').map((x) => [x.name, x.stageId]).sort();
  assert.deepEqual(reveals(v('维恩在幕后安排了交易', '埃利奥特·维恩的全名和身份')), [['埃利奥特·维恩', 's2'], ['维恩', 's1']].sort(), 'the early stage is still checked');
  assert.deepEqual(reveals(v('普通的线索', '查到埃利奥特·维恩，也就是维恩本人')), [['埃利奥特·维恩', 's2'], ['维恩', 's2']], 'standing alone in the same text: asked');
  assert.deepEqual(reveals(v('普通的线索', '查到埃利奥特·维恩的身份')), [['埃利奥特·维恩', 's2']], 'only inside the full name: not asked twice');
  assert.deepEqual(C.checkImportDraft(v('维恩在幕后', '埃利奥特·维恩'), { index: idx, shortsNot: ['维恩'] }).filter((x) => x.name === '维恩'), [], 'denied: never reported');
});

test('stale wording is gone: no 「点『不是』」 advice, ask cards have no "说一声" filler', () => {
  const w = C.checkImportDraft(VOLS, { index: idx }).find((x) => x.kind === 'secret-short');
  assert.doesNotMatch(w.fix, /点「不是」/);
  assert.equal(C.issueQuestion(w).how, '');
});

test('"== 3" matches a cell "3 信任"; "!= 3" does not; plain numbers and dates are unchanged', () => {
  const T = { sheet_r: sheet('重要角色表', ['姓名', '对<user>阶段', '好感', '日期'], [['彼得·帕克', '3 信任', '30', '2000-1-12']]) };
  assert.equal(ev('表: 重要角色表/彼得·帕克/对<user>阶段 == 3', T), 'true');
  assert.equal(ev('表: 重要角色表/彼得·帕克/对<user>阶段 != 3', T), 'false');
  assert.equal(ev('表: 重要角色表/彼得·帕克/对<user>阶段 == 2', T), 'false');
  assert.equal(ev('表: 重要角色表/彼得·帕克/对<user>阶段 == 3 信任', T), 'true', 'exact text still matches');
  assert.equal(ev('表: 重要角色表/彼得·帕克/好感 == 30', T), 'true');
  assert.equal(ev('表: 重要角色表/彼得·帕克/日期 == 2000', T), 'false', 'a date is not "2000 + word"');
});

test('R5: only "integer, space, tier name" uses the leading number; real numbers and dates keep exact meaning', () => {
  const eq = (c, w) => C.applyOp('==', c, w), ne = (c, w) => C.applyOp('!=', c, w);
  assert.ok(eq('3 信任', '3') && !ne('3 信任', '3'));
  assert.ok(eq('10 亲密：很近', '10'));
  assert.ok(eq('1e3', '1000') && !eq('1e3', '1') && ne('1e3', '1'));
  assert.ok(!eq('3,000', '3') && ne('3,000', '3'));
  assert.ok(!eq('2026年11月17日', '2026') && !eq('2026-11-17', '2026'));
  assert.ok(!eq('3 信任', '3.0'), 'the condition must be an integer');
});

test('tierNumberInNote reads "3 信任：…" from the note; unknown words, numbers and ambiguous notes give null', () => {
  const note = '【关系阶段】\r\n0 陌生：不认识\r\n1 相识：说过话\r\n3 信任：说过不轻易说的事\r\n5 相恋：确定了关系';
  assert.equal(C.tierNumberInNote(note, '信任'), 3);
  assert.equal(C.tierNumberInNote(note, '陌生'), 0);
  assert.equal(C.tierNumberInNote(note, '亲近'), null);
  assert.equal(C.tierNumberInNote(note, '3'), null);
  assert.equal(C.tierNumberInNote(`${note}\n4 信任：重复`, '信任'), null, 'two numbers for one word: not guessed');
});

test('R3: the project file carries no local world-book import records; persona stages still point at the outline; __proto__ label keys stay plain', async () => {
  const PF = await import(new URL('../src/core/project-file.js', import.meta.url).href);
  const p = C.normalizeProject({ ...C.newProject('x', 1), outline: { volumes: [{ id: 'v1', key: '剧情_M1', stages: [{ id: 's1', key: '阶段1', data: {} }] }] },
    personas: { imported: [{ book: '本机私有世界书', uid: '314', key: '314', title: '本机条目标题' }], lines: [{ id: 'pl1', name: '彼得', group: '', stages: [{ id: 'ps1', name: '初识', unitId: 's1', text: 'x' }], defaultStage: 'ps1', source: { book: '本机私有世界书' }, sources: ['本机私有世界书'] }] } }, 'p1');
  const text = JSON.stringify(PF.buildProjectFile(p));
  for (const k of ['本机私有世界书', '本机条目标题', '"314"']) assert.ok(!text.includes(k), `${k} not exported`);
  // 手工文件 / 旧文件带着转入记录，导入时也去掉
  const dirty = JSON.parse(text); dirty.project.personas.imported = [{ book: '别人的书', uid: '9', key: '9', title: 't' }];
  const got = PF.parseProjectFile(JSON.stringify(dirty)).project;
  assert.deepEqual([...got.personas.imported], []);
  assert.equal(got.personas.lines[0].stages[0].unitId, 's1');
  const proto = PF.parseProjectFile('{"kind":"plot-injector-project","version":1,"project":{"name":"t","setting":{"text":"a"},"clue":{"labels":{"__proto__":{"label":"L","criterion":"c","sig":"s"}}}}}').project;
  assert.equal(Object.getPrototypeOf(proto.clue.labels), Object.prototype, 'prototype untouched');
  assert.deepEqual(Object.keys(proto.clue.labels), ['__proto__'], 'kept as an own key');
  assert.equal(({}).label, undefined);
});

// ---------- 界面 ----------
const INDEX = '```yaml\n梗概: x\n人物:\n  - {名称: 埃利奥特·维恩, 名字保密: true}\n事实:\n  - {编号: F7, 内容: 查出维恩组织了交易, 性质: 实物}\n```';
const DRAFT = [
  '```yaml',
  '剧情_街区:',
  '  线: {类型: 主线, 简介: 街区里的案子, 入口提示: 路灯又闪了一下, 开始时机原文: 彼得认识主角以后}',
  '  阶段7_拦截:',
  '    主线节点:',
  '      - {id: n7, 名称: 查资料, 入口: 去查, 发现: [{事实: F7, 内容: 查出埃利奥特·维恩组织了交易, 记录: 正文出现维恩组织交易时登记}], 完成条件: {事实: F7}}',
  '```',
].join('\n');
const ROLE_NOTE = '【关系阶段】\n0 陌生：不认识\n1 相识：说过话\n2 熟悉：常聊天\n3 信任：说过不轻易说的事';

async function boot(tables = {}) {
  const host = createHost({ tables });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('P');
  inst.data.updateProject(p.id, (x) => ({ ...x, clue: { mode: 'clue', bindings: { facts: [{ 表: '关键事实表', 编号列: '编号', 状态列: '状态' }], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  const $ = (sel) => doc.querySelector(sel);
  const $$ = (sel) => [...doc.querySelectorAll(sel)];
  const click = async (sel) => { const el = $(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); await tick(); };
  await click(`[data-act="project"][data-id="${p.id}"]`);
  return { host, inst, doc, $, $$, click, pid: p.id };
}
async function importMain(ctx) {
  ctx.host.llm.reply = undefined;
  ctx.host.llm.respond = (body) => (/整理作者索引/.test(body) ? INDEX : DRAFT);
  await ctx.click('[data-act="tab"][data-tab="outline"]');
  await ctx.click('[data-act="import-open-panel"]');
  ctx.$('[data-imp-text]').value = '## 第七阶段\n内容。';
  await ctx.click('[data-act="import-start"]');
  for (let i = 0; i < 80 && !ctx.$('.pi-rv'); i++) await tick();
  assert.ok(ctx.$('.pi-rv'), 'review page');
}
const fire = async (ctx, el, type) => { el.dispatchEvent(new ctx.host.w.Event(type, { bubbles: true })); await tick(); await tick(); };
const dlg = async (ctx, label) => {
  for (let i = 0; i < 40 && !ctx.$('.pi-dialog .pi-btn'); i++) await tick();
  const b = ctx.$$('.pi-dialog .pi-btn').find((x) => x.textContent.trim() === label);
  assert.ok(b, `dialog button ${label}`); b.click(); await tick(); await tick();
};
const job = (ctx) => ctx.inst.data.imports.get(ctx.inst.data.project(ctx.pid).imports[0]);
const goStage = async (ctx) => { const d = ctx.$$('.pi-rv-dot').find((x) => /阶段7/.test(x.textContent)); d.click(); await tick(); await tick(); };

test('review: 是同一人 → the short name becomes a problem with 加入意见, goes into the secret list sent to the model, and is saved with the line', async () => {
  const ctx = await boot();
  await importMain(ctx);
  await goStage(ctx);
  const yes = ctx.$('[data-act="rv-short"][data-v="yes"]');
  assert.ok(yes, 'answer buttons on the short-name card');
  assert.ok(ctx.$('[data-act="rv-short"][data-v="no"]'));
  yes.click(); await tick(); await tick();
  assert.deepEqual([...job(ctx).review.shortsSure], ['维恩']);
  assert.ok(!ctx.$('[data-act="rv-short"]'), 'the question is answered');
  assert.match(ctx.$('.pi-rv').textContent, /登记标准（记录）写了「维恩」/, 'now listed as a problem');
  assert.match(ctx.$('.pi-rv-answered').textContent, /已确认 1 项/);
  // 发给 AI 的保密名单带上短名
  await ctx.click('[data-act="rv-fill-all"]');
  ctx.host.llm.respond = () => '【单位：x】\n```yaml\n阶段7_拦截: {}\n```';
  const calls0 = ctx.host.llmCalls.length;
  await ctx.click('[data-act="rv-preview"]');
  const send = ctx.$$('.pi-dialog .pi-btn').find((b) => b.textContent === '发送');
  send.click(); for (let i = 0; i < 20; i++) await tick();
  const req = JSON.stringify(ctx.host.llmCalls.slice(calls0));
  const list = (/保密名字（揭示之前正文不能出现）：([^。]*)。/.exec(req) || [])[1] || '';
  assert.deepEqual(list.split('、'), ['埃利奥特·维恩', '维恩'], 'the short name is its own entry in the list');
  await ctx.inst.destroy();
});

test('review: 不是 silences the card; 收起 hides a reveal question; 撤回 brings both back', async () => {
  const ctx = await boot();
  await importMain(ctx);
  await goStage(ctx);
  const reveal = ctx.$('[data-act="rv-dismiss"]');
  assert.ok(reveal && /是，收起/.test(reveal.textContent), 'reveal question can be confirmed');
  reveal.click(); await tick(); await tick();
  await ctx.click('[data-act="rv-short"][data-v="no"]');
  assert.ok(!ctx.$('[data-act="rv-dismiss"]') && !ctx.$('[data-act="rv-short"]'), 'nothing left to confirm');
  assert.match(ctx.$('.pi-rv-answered').textContent, /已确认 2 项/);
  await ctx.click('[data-act="rv-undismiss"]');
  assert.ok(ctx.$('[data-act="rv-dismiss"]') && ctx.$('[data-act="rv-short"]'), 'both back after 撤回');
  await ctx.inst.destroy();
});

test('adopt: answered short names are written into the project secret list for that line', async () => {
  const ctx = await boot();
  await importMain(ctx);
  await goStage(ctx);
  await ctx.click('[data-act="rv-short"][data-v="no"]');
  ctx.$$('.pi-rv-dot')[0].click(); await tick(); await tick();
  const r = ctx.$('[data-rv-when="manual"]'); r.checked = true; await fire(ctx, r, 'input');
  await ctx.click('[data-act="import-adopt"]');
  for (let i = 0; i < 20 && !Object.keys(ctx.inst.data.project(ctx.pid).secretNames || {}).length; i++) {
    const b = ctx.$$('.pi-dialog .pi-btn').find((x) => /保存/.test(x.textContent));
    b ? (b.click(), await tick(), await tick()) : await tick();
  }
  const p = ctx.inst.data.project(ctx.pid);
  const sec = Object.values(p.secretNames || {})[0];
  assert.ok(sec, 'secret list saved');
  assert.deepEqual([...sec.denied], ['维恩']);
  await ctx.inst.destroy();
});

test('table form: a tier word with a numbered note offers 改成 3, which rewrites the condition value', async () => {
  const tables = { sheet_r: sheet('重要角色表', ['姓名', '对<user>阶段'], [['彼得·帕克', '1 相识']], ROLE_NOTE) };
  const ctx = await boot(tables);
  await importMain(ctx);
  const radio = ctx.$('[data-rv-when="table"]'); radio.checked = true; await fire(ctx, radio, 'input');
  const set = async (k, v) => { const el = ctx.$(`[data-rv-tbl="${k}"]`); assert.ok(el, `form ${k}`); el.value = v; await fire(ctx, el, el.tagName === 'SELECT' ? 'input' : 'focusout'); };
  await set('table', '重要角色表'); await set('row', '彼得·帕克'); await set('col', '对<user>阶段'); await set('value', '信任');
  assert.match(ctx.$('.pi-rv-tbl-now').textContent, /表格说明里「信任」是 3，比大小请填数字/);
  await ctx.click('[data-act="rv-tbl-num"]');
  assert.equal(job(ctx).review.draft[0].line.开启条件.表, '重要角色表/彼得·帕克/对<user>阶段 >= 3');
  assert.match(ctx.$('.pi-rv-tbl-now').textContent, /现在：1 相识/);
  assert.match(ctx.$('.pi-rv-tbl-now').textContent, /未满足/);
  await ctx.inst.destroy();
});

test('run page: 改线索标签 edits label and criterion in the fact table and in the project; unchanged rows are not written', async () => {
  const facts = sheet('关键事实表', ['编号', '状态', '标签', '登记口径'], [['F7', '未获得', '订单', '读到订单才算'], ['F8', '未获得', '标签B', '口径B']]);
  const ctx = await boot({ sheet_f: facts });
  ctx.inst.data.updateProject(ctx.pid, (x) => ({ ...x, outline: { ...x.outline, volumes: [{ id: 'v', key: '剧情_M1_案子', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 's1', key: '阶段1', data: { 主线节点: [{ id: 'n1', 名称: 'a', 入口: 'a', 发现: [{ 事实: 'F7', 内容: '甲' }, { 事实: 'F8', 内容: '乙' }], 完成条件: { 事实: 'F7' } }] } }] }] } }));
  ctx.inst.runtime.clue.invalidate();
  await ctx.click('[data-act="tab"][data-tab="run"]');
  for (const sel of ['[data-act="run-set-toggle"][aria-expanded="false"]', '[data-act="clue-bind-toggle"]'])
    !ctx.$('[data-act="clue-labels-edit"]') && ctx.$(sel) && (ctx.$(sel).click(), await tick(), await tick());
  await ctx.click('[data-act="clue-labels-edit"]');
  const dlg = ctx.$('.pi-dialog');
  assert.equal(dlg.querySelector('[data-le-label="0"]').value, '订单', 'current table values are filled in');
  assert.equal(dlg.querySelector('[data-le-crit="1"]').value, '口径B');
  dlg.querySelector('[data-le-crit="0"]').value = '彼得读到订单内容时登记';
  const save = [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '保存');
  save.click(); for (let i = 0; i < 10; i++) await tick();
  const api = ctx.host.w.AutoCardUpdaterAPI;
  const live = Object.values(api.exportTableAsJson()).find((t) => t && t.name === '关键事实表').content;
  assert.equal(live.find((r) => r[1] === 'F7')[4], '彼得读到订单内容时登记', 'written to the table');
  assert.equal(live.find((r) => r[1] === 'F8')[4], '口径B');
  assert.deepEqual(api.updated.map((u) => [u.rowIndex, u.row]), [[1, { 标签: '订单', 登记口径: '彼得读到订单内容时登记' }]], 'one row update for the changed fact only');
  assert.equal(ctx.inst.data.project(ctx.pid).clue.labels.F7.criterion, '彼得读到订单内容时登记', 'and to the project');
  assert.ok(!ctx.inst.data.project(ctx.pid).clue.labels.F8, 'unchanged rows are left alone');
  await ctx.inst.destroy();
});

// ---------- GPT 第六轮 R1 / R2：改线索标签写错目标、失败后丢输入 ----------
const meta = (code) => ({ __userscripts: { shujuku_v120__userscript_settings_v1: { shujuku_v120_globalMeta_v1: JSON.stringify({ activeIsolationCode: code }) } } });
const factSheet = (tag) => sheet('关键事实表', ['编号', '状态', '标签', '登记口径'], [['F7', '未获得', `${tag}标签7`, `${tag}口径7`], ['F8', '未获得', `${tag}标签8`, `${tag}口径8`]]);
async function bootLabels() {
  const ctx = await boot({ sheet_f: factSheet('A') });
  ctx.host.ctx.extensionSettings = meta('A');
  ctx.inst.data.updateProject(ctx.pid, (x) => ({ ...x, outline: { ...x.outline, volumes: [{ id: 'v', key: '剧情_M1_案子', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 's1', key: '阶段1', data: { 主线节点: [{ id: 'n1', 名称: 'a', 入口: 'a', 发现: [{ 事实: 'F7', 内容: '甲' }, { 事实: 'F8', 内容: '乙' }], 完成条件: { 事实: 'F7' } }] } }] }] } }));
  ctx.inst.runtime.clue.invalidate();
  await ctx.click('[data-act="tab"][data-tab="run"]');
  for (const sel of ['[data-act="run-set-toggle"][aria-expanded="false"]', '[data-act="clue-bind-toggle"]'])
    !ctx.$('[data-act="clue-labels-edit"]') && ctx.$(sel) && (ctx.$(sel).click(), await tick(), await tick());
  const msgs = [];
  for (const level of ['info', 'success', 'warning', 'error']) ctx.host.w.toastr[level] = (text) => msgs.push({ level, text });
  const api = ctx.host.w.AutoCardUpdaterAPI;
  const rows = () => Object.values(api.exportTableAsJson()).find((t) => t && t.name === '关键事实表').content;
  const open = () => ctx.click('[data-act="clue-labels-edit"]');
  const fill = (label, crit) => { ctx.$('[data-le-label="0"]').value = label; ctx.$('[data-le-crit="0"]').value = crit; };
  const save = async () => { const b = ctx.$$('.pi-dialog .pi-btn').find((x) => x.textContent === '保存'); b.click(); for (let i = 0; i < 10; i++) await tick(); };
  return { ...ctx, api, rows, open, fill, save, msgs };
}

test('R1: switching the database isolation while the dialog is open writes nothing to the other isolation', async () => {
  const x = await bootLabels();
  await x.open(); x.fill('新标签7', '新口径7');
  x.host.ctx.extensionSettings = meta('B'); x.host.db.setTables({ sheet_f: factSheet('B') }); x.inst.runtime.clue.invalidate();
  await x.save();
  assert.equal(x.rows().find((r) => r[1] === 'F7')[3], 'B标签7', 'B untouched');
  assert.deepEqual(x.api.updated, []);
  assert.match(x.msgs.at(-1).text, /数据隔离/);
  assert.ok(!x.inst.data.project(x.pid).clue.labels.F7, 'project not updated either');
  await x.inst.destroy();
});

test('R1: label and criterion go in one row update; a reorder before the write still targets F7 by its code', async () => {
  const x = await bootLabels();
  await x.open(); x.fill('新标签7', '新口径7');
  const t = JSON.parse(JSON.stringify(x.api.exportTableAsJson()));
  [t.sheet_f.content[1], t.sheet_f.content[2]] = [t.sheet_f.content[2], t.sheet_f.content[1]];
  x.host.db.setTables(t);
  await x.save();
  const r = x.rows();
  assert.deepEqual(r.find((row) => row[1] === 'F7').slice(3), ['新标签7', '新口径7']);
  assert.deepEqual(r.find((row) => row[1] === 'F8').slice(3), ['A标签8', 'A口径8'], 'F8 not touched');
  assert.equal(x.api.updated.length, 1);
  await x.inst.destroy();
});

test('R2: a failed write keeps the project unchanged and the input for retry; retrying after the fault succeeds', async () => {
  const x = await bootLabels();
  const real = x.api.updateRow;
  x.api.updateRow = async () => false;
  await x.open(); x.fill('新标签7', '新口径7');
  await x.save();
  assert.deepEqual(x.rows().find((r) => r[1] === 'F7').slice(3), ['A标签7', 'A口径7']);
  assert.ok(!x.inst.data.project(x.pid).clue.labels.F7, 'project keeps the synced value only');
  assert.equal(x.msgs.at(-1).level, 'error');
  assert.match(x.msgs.at(-1).text, /F7/);
  assert.match(x.msgs.at(-1).text, /内容已保留/);
  // 故障修好：重新打开，带出上次的输入，直接保存
  x.api.updateRow = real;
  await x.open();
  assert.equal(x.$('[data-le-label="0"]').value, '新标签7');
  assert.equal(x.$('[data-le-crit="0"]').value, '新口径7');
  assert.match(x.$('.pi-dialog').textContent, /上次有 1 条没写进表格/);
  await x.save();
  assert.deepEqual(x.rows().find((r) => r[1] === 'F7').slice(3), ['新标签7', '新口径7']);
  assert.equal(x.inst.data.project(x.pid).clue.labels.F7.criterion, '新口径7');
  assert.equal(x.msgs.at(-1).level, 'success');
  // 再打开：草稿已清，显示表格现值
  await x.open();
  assert.doesNotMatch(x.$('.pi-dialog').textContent, /上次有/);
  await x.inst.destroy();
});

test('R2: a write that reports success but reads back different is treated as failed', async () => {
  const x = await bootLabels();
  x.api.updateRow = async (name, at, data) => { const sh = Object.values(x.api.exportTableAsJson()).find((t) => t.name === name); sh.content[at][3] = data.标签; return true; };
  await x.open(); x.fill('新标签7', '新口径7');
  await x.save();
  assert.equal(x.msgs.at(-1).level, 'error', 'criterion did not land: not reported as success');
  assert.ok(!x.inst.data.project(x.pid).clue.labels.F7);
  await x.inst.destroy();
});

// ---------- GPT 第六轮复核 F1–F3：写表途中被打断后的收尾 ----------
const fill2 = (x, i, label, crit) => { x.$(`[data-le-label="${i}"]`).value = label; x.$(`[data-le-crit="${i}"]`).value = crit; };

test('F1: switching to another project while F8 is being written saves only F7, and only into the original project', async () => {
  const x = await bootLabels();
  const q = await x.inst.data.createProject('B');
  x.inst.data.updateProject(q.id, (p) => ({ ...p, clue: { ...p.clue, mode: 'clue', labels: { F7: { label: 'B原标签', criterion: 'B原口径', sig: 'x' } } } }));
  await tick();
  const real = x.api.updateRow; let n = 0;
  x.api.updateRow = async (...a) => { const ok = await real(...a); if (++n === 2) { const el = x.$(`[data-act="project"][data-id="${q.id}"]`); el.click(); await tick(); await tick(); } return ok; };
  await x.open(); fill2(x, 0, '新标签7', '新口径7'); fill2(x, 1, '新标签8', '新口径8');
  await x.save();
  assert.equal(x.inst.data.project(x.pid).clue.labels.F7.label, '新标签7', 'F7 saved into the original project');
  assert.ok(!x.inst.data.project(x.pid).clue.labels.F8, 'F8 unverified: not saved');
  assert.deepEqual({ ...x.inst.data.project(q.id).clue.labels.F7 }, { label: 'B原标签', criterion: 'B原口径', sig: 'x' }, 'the other project is untouched');
  assert.match(x.msgs.at(-1).text, /F8 写入途中切换了聊天、项目或数据隔离，结果待核实/);
  await x.inst.destroy();
});

test('F2: a failed draft from isolation A is not offered in isolation B; back in A it is still there', async () => {
  const x = await bootLabels();
  const real = x.api.updateRow;
  x.api.updateRow = async () => false;
  await x.open(); x.fill('新标签7', '新口径7'); await x.save();
  x.api.updateRow = real;
  const aTables = JSON.parse(JSON.stringify(x.api.exportTableAsJson()));
  x.host.ctx.extensionSettings = meta('B'); x.host.db.setTables({ sheet_f: factSheet('B') }); x.inst.runtime.clue.invalidate();
  await x.open();
  assert.equal(x.$('[data-le-label="0"]').value, 'B标签7', 'B shows its own table value');
  assert.doesNotMatch(x.$('.pi-dialog').textContent, /上次有/);
  x.$$('.pi-dialog .pi-btn').find((b) => b.textContent === '取消').click(); await tick();
  x.host.ctx.extensionSettings = meta('A'); x.host.db.setTables(aTables); x.inst.runtime.clue.invalidate();
  await x.open();
  assert.equal(x.$('[data-le-label="0"]').value, '新标签7', 'back in A: the draft is offered again');
  await x.save();
  assert.deepEqual(x.rows().find((r) => r[1] === 'F7').slice(3), ['新标签7', '新口径7']);
  await x.inst.destroy();
});

test('F3: the write landed but the scope changed before the read-back; retrying in A syncs the project without writing again', async () => {
  const x = await bootLabels();
  x.inst.data.updateProject(x.pid, (p) => ({ ...p, clue: { ...p.clue, labels: { F7: { label: 'A标签7', criterion: 'A口径7', sig: 'x' } } } }));
  const real = x.api.updateRow;
  const snap = () => JSON.parse(JSON.stringify(x.api.exportTableAsJson()));
  let saved = null;
  x.api.updateRow = async (...a) => { const ok = await real(...a); saved = snap(); x.host.ctx.extensionSettings = meta('B'); x.host.db.setTables({ sheet_f: factSheet('B') }); x.inst.runtime.clue.invalidate(); return ok; };
  await x.open(); x.fill('新标签7', '新口径7'); await x.save();
  assert.match(x.msgs.at(-1).text, /结果待核实/);
  assert.equal(x.inst.data.project(x.pid).clue.labels.F7.label, 'A标签7', 'not saved while unverified');
  x.api.updateRow = real;
  x.host.ctx.extensionSettings = meta('A'); x.host.db.setTables(saved); x.inst.runtime.clue.invalidate();
  const writes0 = x.api.updated.length;
  await x.open();
  assert.match(x.$('.pi-dialog').textContent, /上次有 1 条/);
  await x.save();
  assert.equal(x.api.updated.length, writes0, 'the table is not written again');
  assert.equal(x.inst.data.project(x.pid).clue.labels.F7.label, '新标签7', 'project synced');
  assert.equal(x.inst.data.project(x.pid).clue.labels.F7.criterion, '新口径7');
  assert.match(x.msgs.at(-1).text, /已同步 1 条到项目/);
  await x.open();
  assert.doesNotMatch(x.$('.pi-dialog').textContent, /上次有/, 'draft cleared');
  await x.inst.destroy();
});

// ---------- 实测 2026-11-17：新聊天还没填过表，表格只有模板初始行（seedRows） ----------
test('fresh chat with only seed rows: edits go into the project, the table is not touched; after the first fill they are offered and written', async () => {
  const seedSheet = { name: '关键事实表', content: [['row_id', '编号', '状态', '标签', '登记口径']], seedRows: [['1', 'F7', '未获得', 'A标签7', 'A口径7'], ['2', 'F8', '未获得', 'A标签8', 'A口径8']] };
  const ctx = await boot({ sheet_f: seedSheet });
  ctx.inst.data.updateProject(ctx.pid, (x) => ({ ...x, outline: { ...x.outline, volumes: [{ id: 'v', key: '剧情_M1_案子', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 's1', key: '阶段1', data: { 主线节点: [{ id: 'n1', 名称: 'a', 入口: 'a', 发现: [{ 事实: 'F7', 内容: '甲' }, { 事实: 'F8', 内容: '乙' }], 完成条件: { 事实: 'F7' } }] } }] }] } }));
  ctx.inst.runtime.clue.invalidate();
  await ctx.click('[data-act="tab"][data-tab="run"]');
  for (const sel of ['[data-act="run-set-toggle"][aria-expanded="false"]', '[data-act="clue-bind-toggle"]'])
    !ctx.$('[data-act="clue-labels-edit"]') && ctx.$(sel) && (ctx.$(sel).click(), await tick(), await tick());
  const msgs = [];
  for (const level of ['info', 'success', 'warning', 'error']) ctx.host.w.toastr[level] = (text) => msgs.push({ level, text });
  const api = ctx.host.w.AutoCardUpdaterAPI;
  await ctx.click('[data-act="clue-labels-edit"]');
  assert.equal(ctx.$('[data-le-label="0"]').value, 'A标签7', 'seed rows are shown');
  assert.match(ctx.$('.pi-dialog').textContent, /这个聊天还没填过表/);
  ctx.$('[data-le-crit="0"]').value = '新口径7';
  ctx.$$('.pi-dialog .pi-btn').find((b) => b.textContent === '保存').click(); for (let i = 0; i < 8; i++) await tick();
  assert.deepEqual(api.updated, [], 'the table is not written');
  assert.equal(ctx.inst.data.project(ctx.pid).clue.labels.F7.criterion, '新口径7', 'saved into the project');
  assert.equal(msgs.at(-1).level, 'info');
  assert.match(msgs.at(-1).text, /已存进项目 1 条/);
  // 第一次填表：初始行变成真正的行
  ctx.host.db.setTables({ sheet_f: { name: '关键事实表', content: [['row_id', '编号', '状态', '标签', '登记口径'], ['1', 'F7', '未获得', 'A标签7', 'A口径7'], ['2', 'F8', '未获得', 'A标签8', 'A口径8']] } });
  ctx.inst.runtime.clue.invalidate();
  await ctx.click('[data-act="clue-labels-edit"]');
  assert.equal(ctx.$('[data-le-crit="0"]').value, '新口径7', 'the pending edit is offered');
  ctx.$$('.pi-dialog .pi-btn').find((b) => b.textContent === '保存').click(); for (let i = 0; i < 8; i++) await tick();
  const live = Object.values(api.exportTableAsJson()).find((t) => t.name === '关键事实表').content;
  assert.deepEqual(live.find((r) => r[1] === 'F7').slice(3), ['A标签7', '新口径7']);
  assert.deepEqual(live.find((r) => r[1] === 'F8').slice(3), ['A标签8', 'A口径8']);
  assert.equal(msgs.at(-1).level, 'success');
  await ctx.inst.destroy();
});

test('after a reload the in-memory draft is gone, but a project label that differs from this chat is still offered', async () => {
  const facts = sheet('关键事实表', ['编号', '状态', '标签', '登记口径'], [['F7', '未获得', '旧标签7', '旧口径7'], ['F8', '未获得', '标签8', '口径8']]);
  const ctx = await boot({ sheet_f: facts });
  const vols = [{ id: 'v', key: '剧情_M1_案子', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 's1', key: '阶段1', data: { 主线节点: [{ id: 'n1', 名称: 'a', 入口: 'a', 发现: [{ 事实: 'F7', 内容: '甲' }, { 事实: 'F8', 内容: '乙' }], 完成条件: { 事实: 'F7' } }] } }] }];
  const sig = C.factLabelSig(C.factLabelContext(vols, ['F7'])[0]);
  ctx.inst.data.updateProject(ctx.pid, (x) => ({ ...x, outline: { ...x.outline, volumes: vols }, clue: { ...x.clue, labels: { F7: { label: '项目标签7', criterion: '项目口径7', sig } } } }));
  ctx.inst.runtime.clue.invalidate();
  await ctx.click('[data-act="tab"][data-tab="run"]');
  for (const sel of ['[data-act="run-set-toggle"][aria-expanded="false"]', '[data-act="clue-bind-toggle"]'])
    !ctx.$('[data-act="clue-labels-edit"]') && ctx.$(sel) && (ctx.$(sel).click(), await tick(), await tick());
  await ctx.click('[data-act="clue-labels-edit"]');
  assert.equal(ctx.$('[data-le-label="0"]').value, '项目标签7');
  assert.equal(ctx.$('[data-le-label="1"]').value, '标签8', 'rows without a project label show the table value');
  assert.match(ctx.$('.pi-dialog').textContent, /有 1 条和项目里存的不一样/);
  await ctx.inst.destroy();
});

// ---------- 实测 2026-11-17：口径写成「记为传闻 / 推测」，表格不认 ----------
test('label check flags status words the table does not have; the generation prompt says to write 存疑', () => {
  const w = (c) => C.factLabelCheck({ label: '标签', criterion: c }, {}).warns.filter((x) => /记为/.test(x));
  assert.match(w('老太太当面讲述时登记，记为传闻；只提到旧事不算。')[0], /「记为传闻」.*改成「记为存疑」/);
  assert.match(w('正文写出判断时登记，记为推测；只听到描述不算。')[0], /「记为推测」/);
  assert.deepEqual(w('对方当面说出时登记，记为存疑；没开口不算。'), []);
  assert.deepEqual(w('亲手读到时登记；没读到不算。'), []);
  assert.deepEqual(w('读到后记为“已核实”；没看到不算。'), []);
  const prompt = JSON.stringify(C.factLabelMessages([{ code: 'F1', answer: 'x', usedBy: [] }], {}));
  assert.match(prompt, /表格的状态只有「已核实」「存疑」两种可写/);
  assert.match(prompt, /不要写「记为传闻」「记为推测」/);
});
