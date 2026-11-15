// GPT 第四轮完整审阅（cab1732）R1–R13 的反例：每条按审阅里描述的复现构造。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const C = loadCore();
const DEFAULT = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/shujuku-default-template-spv8.9.2.json'), 'utf8'));
const byName = (t, name) => Object.values(t).find((s) => s && s.name === name);
const tick = () => new Promise((r) => setTimeout(r, 20));
const vol = (stages) => [{ id: 'v', key: '剧情_卷一', stages: stages.map((data, i) => ({ id: `s${i}`, key: `阶段${i + 1}_x`, data })) }];
const N = (id, gives, extra = {}) => ({ id, 名称: id, 入口: `去${id}`, 发现: gives.map((f) => ({ 事实: f, 内容: `${f}内容` })), 完成条件: gives.length ? { 事实: gives[0] } : undefined, ...extra });
const texts = (xs) => xs.map((x) => x.text).join('\n');

// ---------- R1 保密检查按运行时可见字段 ----------
test('R1: a secret name in a node scene (sent to the body on arrival) is an error; the outline view no longer hides it', () => {
  const SENT = '蓝色海盐哨兵';
  const index = { 人物: [{ 名称: SENT, 公开身份: '路人', 真实身份: '幕后', 名字保密: true }] };
  const vols = vol([{ 主线节点: [{ ...N('n1', ['F1']), 场景: `门口站着${SENT}` }] }]);
  const issues = C.checkImportDraft(vols, { index });
  assert.match(texts(issues.filter((x) => x.level === 'error')), new RegExp(`「${SENT}」出现在正文每楼都可能看到的字段`));
  // and the same in an outline-mode import (previously skipped entirely)
  const ov = vol([{ 主线节点: [{ id: 'n1', 名称: '门口', 事件: `${SENT}出现` }] }]);
  assert.match(texts(C.checkImportDraft(ov, { index, mode: 'outline' })), new RegExp(SENT));
});
test('R1: public names are not secrets (马特奥, 蜘蛛侠); old indexes without the flag skip the name check and say so', () => {
  const index = { 人物: [
    { 名称: '彼得·帕克', 别名: ['蜘蛛侠'], 公开身份: '邻居、蜘蛛侠', 真实身份: '蜘蛛侠' },
    { 名称: '马特奥', 公开身份: '维修工', 真实身份: '关键证人', 名字保密: false },
    { 名称: '维恩', 公开身份: '掮客', 真实身份: '幕后', 名字保密: true },
  ] };
  assert.deepEqual(C.importSecretNames(index), ['维恩']);
  const legacy = { 人物: index.人物.map(({ 名字保密, ...p }) => p) };
  assert.equal(C.importSecretNames(legacy), null);
  assert.match(texts(C.checkImportDraft(vol([{ 主线节点: [N('n1', ['F1'])] }]), { index: legacy })), /没有标出哪些名字需要保密/);
  const vols = vol([{ AI指令: '马特奥在店里，蜘蛛侠路过', 主线节点: [N('n1', ['F1'])] }]);
  assert.deepEqual(C.checkImportDraft(vols, { index }).filter((x) => /保密的名字/.test(x.text)), []);
});
test('R1: the draft prompt no longer claims discoveries reach the body only after being revealed', () => {
  const sys = C.importDraftMessages({ part: { i: 0, title: 't', text: 'x' }, index: '' })[0].content;
  assert.ok(!/揭示之后才会给正文/.test(sys));
  assert.match(sys, /玩家到场时它会作为「可能的发现」交给正文/);
  assert.match(C.importIndexMessages({ part: { i: 0, title: 't', text: 'x' }, total: 1 })[0].content, /名字保密/);
});

// ---------- 长文导入界面（R2 R3 R4 R7 R11） ----------
const DRAFT = (stages) => ['```yaml', '剧情_卷1_x:', ...stages.flatMap(([key, nodes, extra = []]) => [`  ${key}:`, ...extra.map((l) => `    ${l}`), '    主线节点:', ...nodes.flatMap(([id, fact, open]) => [`      - id: ${id}`, `        名称: 节点${id}`, `        入口: 去${id}`, `        发现: [{事实: ${fact}, 内容: c${id}}]`, `        完成条件: {事实: ${fact}}`, ...(open ? [`        开放条件: {事实: ${open}}`] : [])])]), '```'].join('\n');
const INDEX = '```yaml\n梗概: x\n人物: []\n```';
async function boot(names = ['A']) {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const ids = [];
  for (const n of names) {
    const p = await inst.data.createProject(n);
    inst.data.updateProject(p.id, (x) => ({ ...x, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
    ids.push(p.id);
  }
  await inst.runtime.switchProject(ids[0]);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  const click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  const goto = async (pid) => { await click(`[data-act="project"][data-id="${pid}"]`); await click('[data-act="tab"][data-tab="outline"]'); };
  await goto(ids[0]);
  return { host, inst, doc, click, goto, ids };
}
async function runImport({ host, doc, click }, draft) {
  host.llm.reply = undefined;
  host.llm.respond = (body) => (/整理作者索引/.test(body) ? INDEX : typeof draft === 'function' ? draft(body) : draft);
  await click('[data-act="import-open-panel"]');
  doc.querySelector('[data-imp-text]').value = '## 第一章\n一些内容。';
  await click('[data-act="import-start"]');
  for (let i = 0; i < 40 && !doc.querySelector('[data-act="import-adopt"], [data-act="import-run"]:not([disabled])'); i++) await tick();
}
// confirmDialog / openDialog: click the button with this label in the topmost dialog
async function answer(doc, label) {
  for (let i = 0; i < 20 && !doc.querySelector('.pi-dialog'); i++) await tick();
  const dlg = [...doc.querySelectorAll('.pi-dialog')].pop();
  assert.ok(dlg, 'dialog shown');
  const text = dlg.textContent;
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === label).click(); await tick(); await tick();
  return text;
}

test('R2: a draft opened in project A is not shown or adoptable in project B; adopting writes only to the job\'s own project', async () => {
  const ctx = await boot(['A', 'B']);
  const [A, B] = ctx.ids;
  await runImport(ctx, DRAFT([['阶段1_a', [['n1', 'F1']]]]));
  assert.ok(ctx.doc.querySelector('[data-act="import-adopt"]'), 'A has a draft');
  await ctx.inst.data.loadProject(B);
  await ctx.goto(B);
  assert.ok(!ctx.doc.querySelector('[data-act="import-adopt"]'), 'B does not show A\'s draft');
  assert.ok(!ctx.doc.body.textContent.includes('节点n1'));
  // even a forged click on B with A's job id does nothing
  const st = ctx.inst.__view.tabState('import');
  st[B] = { jobId: ctx.inst.data.project(A).imports[0] };
  const fake = ctx.doc.createElement('div'); fake.className = 'pi-card'; ctx.doc.body.append(fake);
  const btn = ctx.doc.createElement('button'); btn.dataset.act = 'import-adopt'; fake.append(btn);
  btn.click(); await tick();
  assert.equal(ctx.inst.data.project(B).outline.volumes.length, 0);
  assert.equal(ctx.inst.data.project(A).outline.volumes.length, 0);
  // back in A the draft is still there and adopts into A
  await ctx.goto(A);
  assert.ok(ctx.doc.querySelector('[data-act="import-adopt"]'));
  await ctx.click('[data-act="import-adopt"]');
  assert.equal(ctx.inst.data.project(A).outline.volumes.length, 1);
  assert.equal(ctx.inst.data.project(B).outline.volumes.length, 0);
  await ctx.inst.destroy();
});

test('R3: a failed adopt (duplicate node ids inside the import) leaves nothing marked adopted; after fixing it can be adopted', async () => {
  const ctx = await boot();
  const [A] = ctx.ids;
  // outline-mode import: two stages, each with node id "dup"
  ctx.host.llm.respond = (b) => (/整理作者索引/.test(b) ? INDEX : ['```yaml', '剧情_卷1_x:', '  阶段1_a:', '    主线节点:', '      - {id: dup, 名称: 甲, 事件: e}', '  阶段2_b:', '    主线节点:', '      - {id: dup, 名称: 乙, 事件: e}', '```'].join('\n'));
  await ctx.click('[data-act="import-open-panel"]');
  ctx.doc.querySelector('[data-imp-text]').value = '## 第一章\n内容。';
  ctx.doc.querySelector('[data-imp-mode]').value = 'outline';
  await ctx.click('[data-act="import-start"]');
  for (let i = 0; i < 40 && !ctx.doc.querySelector('[data-act="import-adopt"]'); i++) await tick();
  ctx.doc.querySelector('[data-act="import-adopt"]').click(); await tick();
  if (ctx.doc.querySelector('.pi-dialog')) await answer(ctx.doc, '仍然追加');
  assert.equal(ctx.inst.data.project(A).outline.volumes.length, 0, 'nothing written');
  assert.deepEqual([...(ctx.inst.data.project(A).importAdopted || [])], [], 'not marked adopted');
  assert.ok(ctx.doc.querySelector('[data-imp-pick]'), 'stages still selectable');
  await ctx.inst.destroy();
});

test('R3: adopted marks live in the project with the outline; a lost job-file write cannot make it adopt twice or lose the mark', async () => {
  const ctx = await boot();
  const [A] = ctx.ids;
  await runImport(ctx, DRAFT([['阶段1_a', [['n1', 'F1']]]]));
  const store = ctx.inst.data.imports, orig = store.update;
  store.update = () => Promise.reject(new Error('模拟任务文件写入失败'));
  await ctx.click('[data-act="import-adopt"]');
  store.update = orig;
  assert.equal(ctx.inst.data.project(A).outline.volumes.length, 1);
  assert.equal(ctx.inst.data.project(A).importAdopted.length, 1);
  await ctx.click('[data-act="import-adopt"]');
  assert.equal(ctx.inst.data.project(A).outline.volumes.length, 1, 'no second copy');
  assert.match(ctx.doc.body.textContent, /已采用/);
  await ctx.inst.destroy();
});

test('R3/R2: switching project while the adopt confirmation is open writes nothing anywhere', async () => {
  const ctx = await boot(['A', 'B']);
  const [A, B] = ctx.ids;
  // second stage needs a fact nobody produces → confirm dialog appears
  await runImport(ctx, DRAFT([['阶段1_a', [['n1', 'F1']]], ['阶段2_b', [['n2', 'F2', 'F_none']]]]));
  ctx.doc.querySelector('[data-act="import-adopt"]').click(); await tick();
  assert.ok(ctx.doc.querySelector('.pi-dialog'));
  await ctx.inst.data.loadProject(B);
  ctx.inst.__view.projectId = B;
  await answer(ctx.doc, '仍然追加');
  assert.equal(ctx.inst.data.project(A).outline.volumes.length, 0);
  assert.equal(ctx.inst.data.project(B).outline.volumes.length, 0);
  await ctx.inst.destroy();
});

test('R4: picking only the second stage (which needs the first stage\'s fact) asks for confirmation and names the missing fact', async () => {
  const ctx = await boot();
  const [A] = ctx.ids;
  await runImport(ctx, DRAFT([['阶段1_a', [['n1', 'FA']]], ['阶段2_b', [['n2', 'FB']], ['进入条件: {事实: FA}']]]));
  assert.match(ctx.doc.body.textContent, /没有发现必须处理的问题/, 'the full draft is fine');
  ctx.doc.querySelector('[data-imp-pick="阶段1_a"]').checked = false;
  ctx.doc.querySelector('[data-act="import-adopt"]').click(); await tick();
  const text = await answer(ctx.doc, '取消');
  assert.match(text, /按大纲推演走不通/);
  assert.match(text, /FA/);
  assert.match(text, /没有在当前聊天启用|按当前聊天的进度/);
  assert.equal(ctx.inst.data.project(A).outline.volumes.length, 0);
  await ctx.inst.destroy();
});

test('R4: the picked stage relying on a fact the project already produces is NOT flagged', async () => {
  const ctx = await boot();
  const [A] = ctx.ids;
  ctx.inst.data.updateProject(A, (p) => ({ ...p, outline: { volumes: vol([{ 主线节点: [N('old1', ['FA'])] }]) } }));
  await runImport(ctx, DRAFT([['阶段9_b', [['n2', 'FB']], ['进入条件: {事实: FA}']]]));
  await ctx.click('[data-act="import-adopt"]');
  assert.ok(!ctx.doc.querySelector('.pi-dialog'), 'no confirmation needed');
  assert.equal(ctx.inst.data.project(A).outline.volumes.length, 2);
  await ctx.inst.destroy();
});

test('R7: a part whose draft cannot be parsed is shown as failed (not "no problems"); retry redoes only that part', async () => {
  const ctx = await boot();
  const [A] = ctx.ids;
  let bad = true;
  await runImport(ctx, (body) => (bad && !/格式错误|没有读到/.test(body) ? 'not yaml: [' : bad ? 'still: [' : DRAFT([['阶段1_a', [['n1', 'F1']]]])));
  assert.ok(!ctx.doc.querySelector('[data-act="import-adopt"]'), 'not in review');
  assert.match(ctx.doc.body.textContent, /第 1 段转写失败/);
  assert.match(ctx.doc.querySelector('[data-act="import-run"]').textContent, /重试失败的段/);
  const job = ctx.inst.data.imports.get(ctx.inst.data.project(A).imports[0]);
  assert.ok(job.drafts[0].error);
  bad = false;
  const before = ctx.host.llmCalls.length;
  await ctx.click('[data-act="import-run"]');
  for (let i = 0; i < 40 && !ctx.doc.querySelector('[data-act="import-adopt"]'); i++) await tick();
  assert.ok(ctx.doc.querySelector('[data-act="import-adopt"]'));
  assert.equal(ctx.host.llmCalls.length - before, 1, 'only the failed part was requested again (index kept)');
  await ctx.inst.destroy();
});

test('R11: import files are in the index (backup/verify/orphan see them); a missing job file is read once, not in a loop', async () => {
  const ctx = await boot();
  const [A] = ctx.ids;
  await runImport(ctx, DRAFT([['阶段1_a', [['n1', 'F1']]]]));
  await ctx.inst.data.flush();
  const id = ctx.inst.data.project(A).imports[0];
  const idx = ctx.inst.data.index();
  assert.ok(idx.files.includes(`pi-i-${id}.json`) && idx.files.includes(`pi-i-${id}-src.json`));
  assert.deepEqual([...idx.projects.find((p) => p.id === A).imports], [id]);
  ctx.host.files.has(`pi-i-${id}.json`) || assert.fail('job file written');
  // delete the job file behind the plugin's back, reload
  ctx.host.files.delete(`pi-i-${id}.json`);
  await ctx.inst.data.flush(); await ctx.inst.destroy();
  const inst2 = ctx.host.load(); await inst2.ready; await inst2.data.loadProject(A); await inst2.runtime.switchProject(A);
  inst2.open(); await tick();
  const d = ctx.host.w.document;
  d.querySelector(`[data-act="project"][data-id="${A}"]`).click(); await tick();
  d.querySelector('[data-act="tab"][data-tab="outline"]').click(); await tick();
  const reads = () => ctx.host.llmCalls.length; void reads;
  let loads = 0; const orig = inst2.data.imports.load; inst2.data.imports.load = (x) => { loads++; return orig(x); };
  d.querySelector('[data-act="import-open-panel"]').click();
  for (let i = 0; i < 10; i++) await tick();
  assert.ok(loads <= 1, `read ${loads} times`);
  assert.match(d.body.textContent, /读不到这条导入记录的文件/);
  await inst2.destroy();
});

// ---------- R5 跨段合并 ----------
test('R5: the same node continued in the next part keeps both discoveries; the later stage end condition is merged in; successor still opens', () => {
  const p1 = vol([{ 主线节点: [N('n1', ['FA'])] }]);
  const p2 = vol([{ 结束条件: { 事实: 'FB' }, 主线节点: [{ id: 'n1', 发现: [{ 事实: 'FB', 内容: 'FB内容' }] }] }]);
  const p3 = [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's9', key: '阶段2_y', data: { 进入条件: { 事实: 'FA' }, 主线节点: [N('n2', ['FC'])] } }] }];
  const merged = C.mergeImportParts([...p1, ...p2, ...p3]);
  const st = merged[0].stages[0].data;
  assert.equal(st.主线节点.length, 1, 'still one node');
  assert.deepEqual(st.主线节点[0].发现.map((d) => d.事实), ['FA', 'FB'], 'both discoveries kept');
  assert.deepEqual(st.结束条件, { 事实: 'FB' }, 'new stage end condition kept');
  assert.equal(C.clueReachability(merged).verdict, 'ok', 'successor stage still opens on FA');
});
test('R5: conflicting fields across parts keep the earlier one and are reported for the author', () => {
  const a = vol([{ 主线节点: [N('n1', ['FA'])] }]), b = vol([{ 主线节点: [{ id: 'n1', 完成条件: { 事实: 'FZ' } }] }]);
  const merged = C.mergeImportParts([...a, ...b]);
  assert.deepEqual(merged[0].stages[0].data.主线节点[0].完成条件, { 事实: 'FA' });
  assert.equal(merged.conflicts.length, 1);
  assert.match(C.importConflictText(merged.conflicts[0]), /n1 的「完成条件」两段写得不一样/);
});

// ---------- R8 合法 YAML 不改 ----------
test('R8: valid YAML is returned untouched (3-space indent structure, full-width colons in block text, ZWJ emoji)', () => {
  const three = ['root:', '   alpha:', '      x: 1', '   beta: 2'].join('\n');
  assert.equal(C.extractYaml(three), three);
  assert.deepEqual(C.parseYaml(C.extractYaml(three)), { root: { alpha: { x: 1 }, beta: 2 } });
  const block = ['剧情_卷1_x:', '  阶段1_a:', '    AI指令: |', '      摘要： 一盏灯', '    主线节点: []'].join('\n');
  assert.match(C.extractYaml(block), /摘要： 一盏灯/);
  const emoji = 'a: 👩\u200d🔬 科学家';
  assert.equal(C.parseYaml(C.extractYaml(emoji)).a, '👩\u200d🔬 科学家');
  // still fixed: zero-width before a key, broken indent, full-width key colon (only when the original does not parse)
  const zw = ['```yaml', '剧情_卷1_x:', '  阶段1_a:', '   \u200b主线节点:', '      - {id: n1, 名称: 甲}', '```'].join('\n');
  assert.equal(C.parseOutlineReply(zw).volumes[0].stages[0].data.主线节点[0].名称, '甲');
  // full-width colon inside a block scalar stays even when other lines need fixing
  const mixed = ['剧情_卷1_x：', '  阶段1_a:', '    AI指令: |', '      摘要： 一盏灯', '    主线节点: []'].join('\n');
  assert.match(C.extractYaml(mixed), /摘要： 一盏灯/);
  assert.match(C.extractYaml(mixed), /^剧情_卷1_x:/);
});

// ---------- R9 替代途径 ----------
test('R9: A or B opens a shared C, but the stage end only accepts A → the B route is reported as blocked', () => {
  const vols = vol([
    { 结束条件: { 事实: 'FA' }, 主线节点: [
      N('nA', ['FA'], { 必需: false }), N('nB', ['FB'], { 必需: false }),
      N('nC', ['FC'], { 必需: false, 开放条件: { 任一: [{ 事实: 'FA' }, { 事实: 'FB' }] } }),
    ] },
    { 主线节点: [N('nD', ['FD'])] },
  ]);
  const r = C.clueAlternativeRoutes(vols);
  assert.equal(r.length, 2, JSON.stringify(r));
  assert.equal(r.find((x) => x.node.startsWith('nA')).verdict, 'ok');
  const b = r.find((x) => x.node.startsWith('nB'));
  assert.equal(b.verdict, 'blocked');
  assert.ok(b.node.includes('nC'), 'the shared successor is part of each route');
});
test('R9: a time condition on the next stage makes the result "unknown", not "blocked"', () => {
  const vols = vol([
    { 结束条件: { 任一: [{ 事实: 'FA' }, { 事实: 'FB' }] }, 主线节点: [N('nA', ['FA'], { 必需: false }), N('nB', ['FB'], { 必需: false })] },
    { 进入条件: { 时间: '>= 2026-03-16 08:00' }, 主线节点: [N('nD', ['FD'])] },
  ]);
  const r = C.clueAlternativeRoutes(vols);
  assert.deepEqual(r.map((x) => x.verdict), ['unknown', 'unknown'], JSON.stringify(r));
  assert.ok(r.every((x) => x.ok));
  assert.ok(!C.checkImportDraft(vols).some((x) => x.level === 'error' && /替代途径/.test(x.text)));
});
test('R9: the start set does not hand out a required fact that is not reachable', () => {
  // required node nR needs FX which nobody produces → its fact FR must not be granted to the routes
  const vols = vol([
    { 结束条件: { 全部: [{ 事实: 'FR' }, { 任一: [{ 事实: 'FA' }, { 事实: 'FB' }] }] }, 主线节点: [
      N('nR', ['FR'], { 开放条件: { 事实: 'FX' } }), N('nA', ['FA'], { 必需: false }), N('nB', ['FB'], { 必需: false }),
    ] },
  ]);
  const r = C.clueAlternativeRoutes(vols);
  assert.ok(r.every((x) => x.verdict === 'blocked'), JSON.stringify(r));
});

// ---------- R10 二改模板 ----------
test('R10: a character-table DDL with a table-level UNIQUE constraint is left alone (no invalid SQL); reported', () => {
  const t = JSON.parse(JSON.stringify(DEFAULT));
  const ch = byName(t, '重要角色表');
  ch.sourceData.ddl = ch.sourceData.ddl.replace(/interaction_options TEXT -- 交互选项\n\);/, 'interaction_options TEXT, -- 交互选项\n  UNIQUE (name)\n);');
  new DatabaseSync(':memory:').exec(ch.sourceData.ddl);
  const r = C.synthesizeClueTemplate(t, {});
  const out = byName(r.template, '重要角色表');
  new DatabaseSync(':memory:').exec(out.sourceData.ddl);
  assert.ok(!out.content[0].includes('剧情身份'), 'no column added');
  assert.match(r.problems.join('\n'), /表级约束.*没有加列/);
});
test('R10: a customised initNode that merely contains the default sentence is not rewritten', () => {
  const t = JSON.parse(JSON.stringify(DEFAULT));
  const ch = byName(t, '重要角色表');
  ch.sourceData.initNode = `作者前言：只记城里人。\n${ch.sourceData.initNode}`;
  const r = C.synthesizeClueTemplate(t, {});
  assert.equal(byName(r.template, '重要角色表').sourceData.initNode, ch.sourceData.initNode);
  assert.match(r.problems.join('\n'), /重要角色表」的初始化规则和数据库默认不同，没有替换/);
  // the untouched official default is still replaced
  const r2 = C.synthesizeClueTemplate(JSON.parse(JSON.stringify(DEFAULT)), {});
  assert.match(byName(r2.template, '重要角色表').sourceData.initNode, /只为开场正文里实际登场/);
});
test('R10: two existing 关键事实表 → no third one created; blocked', () => {
  const t = JSON.parse(JSON.stringify(DEFAULT));
  const base = C.synthesizeClueTemplate(t, { clue: {} }).template;
  const facts = byName(base, '关键事实表');
  base.sheet_dupfacts = { ...JSON.parse(JSON.stringify(facts)), uid: 'sheet_dupfacts' };
  const r = C.synthesizeClueTemplate(base, { clue: {} });
  assert.equal(Object.values(r.template).filter((s) => s && s.name === '关键事实表').length, 2);
  assert.deepEqual(r.blocked, ['关键事实表']);
});

// ---------- R6 两个方向核对 ----------
test('R6: a template that lacks a table the chat is using (would be hidden by the database) is refused', () => {
  const live = JSON.parse(JSON.stringify(DEFAULT));
  const tpl = JSON.parse(JSON.stringify(DEFAULT));
  const key = Object.keys(tpl).find((k) => tpl[k] && tpl[k].name === '重要角色表');
  delete tpl[key];
  assert.match(C.clueTplMismatch(tpl, live).join('\n'), /当前聊天有、模板里没有：重要角色表（导入后这些表会被数据库隐藏）/);
  // a column the chat has that the template lacks
  const tpl2 = JSON.parse(JSON.stringify(DEFAULT));
  byName(live, '背包物品表').content[0].push('附魔');
  assert.match(C.clueTplMismatch(tpl2, live).join('\n'), /「背包物品表」当前聊天里的列「附魔」模板里没有/);
  assert.deepEqual(C.clueTplMismatch(DEFAULT, DEFAULT), []);
});

// ---------- R12 讨论插入撞号 ----------
test('R12: inserting a node via discussion that reuses an existing fact id warns before applying', async () => {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('船');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: [{ id: 'v1', key: '剧情_卷一', stages: [{ id: 's1', key: '阶段1_港口', data: { 主线节点: [{ id: 'nTicket', 名称: '取得船票', 入口: '去售票处', 发现: [{ 事实: 'F1', 内容: '船票' }], 完成条件: { 事实: 'F1' } }] } }] }] }, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  const reply = ['可以加一个查账册的节点。', '```大纲改动', '改动:', '  - 动作: 插入', '    阶段: s1', '    类别: 主线', '    位置: 末尾', '    节点: {名称: 取得账册, 入口: 去账房, 发现: [{事实: F1, 内容: 账册}], 完成条件: {事实: F1}}', '```'].join('\n');
  const chat = await inst.data.loadChat(p.id);
  inst.data.saveChat(p.id, { ...chat, messages: [...chat.messages, { id: 'm1', role: 'assistant', content: reply, outlineAt: '' }] });
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="discuss"]').click(); await tick();
  const btn = doc.querySelector('[data-act="proposal-apply"]');
  assert.ok(btn, 'proposal button');
  btn.click(); await tick();
  await answer(doc, '应用勾选的改动');
  const text = await answer(doc, '取消');
  assert.match(text, /事实编号 F1 已经由 nTicket 使用/);
  assert.equal(inst.data.project(p.id).outline.volumes[0].stages[0].data.主线节点.length, 1, 'not applied');
  await inst.destroy();
});

// ---------- R13 通用提示只注入一次 ----------
test('R13: two active stages in outline mode → the body guide appears once', () => {
  const vols = [{ id: 'v1', key: '剧情_卷一', stages: [{ id: 's1', key: '阶段1_a', data: { 主线节点: ['甲'] } }, { id: 's2', key: '阶段2_b', data: { 主线节点: ['乙'] } }] }];
  const progress = { cursor: 0, done: {}, slots: { s2: { state: 'active' } } };
  const proj = { outline: { volumes: vols }, setting: { text: '' }, defaults: {} };
  const units = C.flattenUnits(vols);
  const states = C.unitStates(units, progress);
  assert.deepEqual([states.s1, states.s2], ['active', 'active']);
  const all = C.buildEntries(proj, progress, {}).map((e) => e.content).join('\n');
  assert.equal(all.split('<knowledge>').length - 1, 1);
  assert.equal(all.split('<progression>').length - 1, 1);
});

// ---------- 本地实验 2026-11-08 暴露的两个问题 ----------
test('lab: an index without any facts triggers one follow-up asking for the missing section; the fuller answer is used', async () => {
  const ctx = await boot();
  const [A] = ctx.ids;
  let asked = 0;
  ctx.host.llm.reply = undefined;
  ctx.host.llm.respond = (body) => {
    if (/上面的索引缺少「事实」/.test(body)) { asked++; return '```yaml\n梗概: x\n人物: []\n事实:\n  - {编号: F_lock, 内容: 锁被撬过, 性质: 实物}\n```'; }
    if (/整理作者索引/.test(body)) return INDEX;
    return DRAFT([['阶段1_a', [['n1', 'F_lock']]]]);
  };
  await ctx.click('[data-act="import-open-panel"]');
  ctx.doc.querySelector('[data-imp-text]').value = '## 第一章\n门锁。';
  await ctx.click('[data-act="import-start"]');
  for (let i = 0; i < 40 && !ctx.doc.querySelector('[data-act="import-adopt"]'); i++) await tick();
  assert.equal(asked, 1);
  const job = ctx.inst.data.imports.get(ctx.inst.data.project(A).imports[0]);
  assert.deepEqual([...job.index.事实.map((f) => f.编号)], ['F_lock']);
  await ctx.inst.destroy();
});
test('lab: repair requests name the exact field and sentence holding a secret name (e.g. a 记录 saying "此时才出现维恩这个名字")', () => {
  const vols = vol([{ 主线节点: [{ ...N('n7', []), 发现: [{ 事实: 'F7', 内容: '资料显示维恩组织交易', 记录: '正文出现付款记录才算拿到。此时才出现维恩这个名字。' }] }] }]);
  const hits = C.importSecretHits(vols, ['维恩']);
  assert.deepEqual(Object.keys(hits), ['阶段1_x']);
  assert.equal(hits['阶段1_x'].length, 1, 'the 内容 (reveal layer) is not listed');
  assert.match(hits['阶段1_x'][0], /^n7\.发现\[F7\]\.记录「.*此时才出现维恩这个名字.*」里出现了「维恩」$/);
  const m = C.importRepairMessages({ yaml: 'x', issues: ['p'], spots: hits['阶段1_x'] });
  assert.match(m[0].content, /「记录」是给填表模型看的登记标准，也不能写名字/);
  assert.match(m[1].content, /【必须改的位置】\n- n7\.发现\[F7\]\.记录/);
});

// ---------- 参考外部卡的四条建议（2026-11-08） ----------
test('prompts: import follows the source for conditions/routes; 偏转 optional with a sample node without it; fill rules keep the old value when unsure', () => {
  const sys = C.importDraftMessages({ part: { i: 0, title: 't', text: 'x' }, index: '' })[0].content;
  assert.match(sys, /取得条件和替代路线以原文为准/);
  assert.match(sys, /原文没写取得条件的节点，开放条件留空/);
  assert.match(sys, /导入时不适用/);
  assert.ok(!/并检查：只走其中一条时/.test(C.CLUE_OUTLINE_RULES), 'the model is no longer asked to verify routes itself');
  assert.match(C.OUTLINE_RULES, /偏转默认不写/);
  const sample = C.parseYaml(C.SAMPLE_STAGE);
  const nodes = Object.values(Object.values(sample)[0])[0].主线节点;
  assert.ok(nodes.some((n) => !('偏转' in n)) && nodes.some((n) => '偏转' in n), 'sample shows a node with and without 偏转');
  const tpl = C.synthesizeClueTemplate({}, { clue: {} }).template;
  const note = (name) => Object.values(tpl).find((s) => s && s.name === name).sourceData.note;
  for (const n of ['关键事实表', '知情表', '线索控制表']) assert.match(note(n), /拿不准.*保持原值/);
  assert.ok(!/或者证据不足/.test(note('关键事实表')));
});

// ---------- 雾港实测 2026-11-08：证词记为存疑，必需节点「完成条件: {事实: 证词}」永远完不成，下一阶段不开放 ----------
test('live: {事实} counts a claimed (存疑) fact as obtained; {核实} needs 已核实; a manual revoke still blocks both', () => {
  const st = (raw) => (raw === '已核实' ? { status: 'confirmed', raw } : raw === '存疑' ? { status: 'unconfirmed', claimed: true, raw } : { status: 'unconfirmed', raw });
  const snap = (vals) => ({ facts: new Map(Object.entries(vals).map(([id, raw]) => [id, { id, text: '', ...st(raw) }])), knowledge: [], tables: {}, problems: [] });
  const vols = vol([
    { 结束条件: { 任一: [{ 事实: 'F_say' }, { 事实: 'F_mark' }] }, 主线节点: [N('nHan', ['F_say']), N('nMark', ['F_mark'], { 必需: false })] },
    { 主线节点: [{ ...N('nDesk', ['F_doc']), 完成条件: { 核实: 'F_doc' } }] },
  ]);
  const cfg = C.normalizeClue({ mode: 'clue' });
  const run = (vals, prog = C.emptyClueProgress()) => C.computeClueState(C.compileClue(vols), snap(vals), prog, cfg);
  // the real chat: testimony 存疑, mark 已核实 → stage 1 done, desk opens
  let s = run({ F_say: '存疑', F_mark: '已核实', F_doc: '未获得' });
  assert.equal([...s.stageStates.values()][0].done, true, 'testimony told = obtained');
  assert.ok(['available', 'active'].includes(s.nodeStates.find((n) => n.node.uid === 'nDesk').status), 'desk opened');
  // {核实}: a claimed document is not enough
  s = run({ F_say: '存疑', F_mark: '已核实', F_doc: '存疑' });
  assert.notEqual(s.nodeStates.find((n) => n.node.uid === 'nDesk').status, 'done');
  s = run({ F_say: '存疑', F_mark: '已核实', F_doc: '已核实' });
  assert.equal(s.nodeStates.find((n) => n.node.uid === 'nDesk').status, 'done');
  // a manual revoke of a claimed fact blocks {事实}
  const prog = { ...C.emptyClueProgress(), factOverrides: { F_say: { status: 'revoked' } } };
  s = run({ F_say: '存疑', F_mark: '未获得', F_doc: '未获得' }, prog);
  assert.equal([...s.stageStates.values()][0].done, false);
  // the parser keeps {核实: F@角色} as a knowledge condition
  assert.equal(C.parseCondition({ 核实: 'F1@甲' }).kind, 'know');
  assert.equal(C.parseCondition({ 核实: 'F1' }).verified, true);
});
test('live: prompts explain {事实} vs {核实} so imports and AI-written outlines do not gate on testimony being 已核实', () => {
  assert.match(C.CLUE_OUTLINE_RULES, /\{核实: F01\}（必须已核实，说法不算）/);
  assert.match(C.CLUE_OUTLINE_RULES, /如果用 \{核实\} 去等它，节点永远完不成/);
  assert.match(C.importDraftMessages({ part: { i: 0, title: 't', text: 'x' }, index: '' })[0].content, /材料明确要求「被证实」时才用 \{核实: 编号\}/);
});

// ---------- 雾港实测「旧码头」导入（2026-11-08）发现的四个问题 ----------
test('live import: nobody needs secrecy (model omitted 名字保密 for everyone) is not reported as a legacy index', () => {
  const idx = C.mergeImportIndex([{ 人物: [{ 名称: '老韩', 公开身份: '看守' }, { 名称: '周先生', 公开身份: '会计' }] }]);
  assert.deepEqual([...C.importSecretNames(idx)], []);
  assert.ok(!C.checkImportDraft(vol([{ 主线节点: [N('n1', ['F1'])] }]), { index: idx }).some((x) => /没有标出哪些名字需要保密/.test(x.text)));
  // an index saved by an older version (no flag, no field) still says the check was skipped
  assert.equal(C.importSecretNames({ 人物: [{ 名称: '老韩', 真实身份: 'x' }] }), null);
});
test('live import: list-valued 作者资料 / 梗概 become one line per item, not a comma-joined string', () => {
  const idx = C.mergeImportIndex([{ 梗概: ['甲。', '乙。'], 作者资料: ['老韩开口有条件。', '哨兵句：只给作者。'] }]);
  assert.equal(idx.作者资料[0], '第1段：\n老韩开口有条件。\n哨兵句：只给作者。');
  assert.equal(idx.梗概[0], '第1段：甲。\n乙。');
  assert.ok(!/。,/.test(idx.作者资料[0]));
});
test('live import: stray keys from the model (阶段下的「Ａ: {}」) are dropped; known stage/node fields and world-event 来源 are kept', () => {
  const vols = [{ id: 'v', key: '剧情_卷1_x', stages: [{ id: 's', key: '阶段1_a', data: {
    AI指令: 'x', 'Ａ': {}, 结束条件: { 事实: 'F1' },
    主线节点: [{ id: 'n1', 名称: '甲', 入口: '去', 发现: [{ 事实: 'F1', 内容: 'c' }], 完成条件: { 事实: 'F1' }, 来源: '原句', 乱字段: 1 }],
    世界动态: [{ 类型: '传闻', 来源: '码头脚夫', 内容: '有人夜里搬货' }],
  } }] }];
  const r = C.splitImportAuthorFields(vols, { i: 0, title: 't', start: 0, end: 1 });
  const d = r.volumes[0].stages[0].data;
  assert.ok(!('Ａ' in d));
  assert.deepEqual(Object.keys(d).sort(), ['AI指令', '世界动态', '主线节点', '结束条件'].sort());
  assert.ok(!('来源' in d.主线节点[0]) && !('乱字段' in d.主线节点[0]));
  assert.equal(r.notes.n1.来源, '原句');
  assert.equal(d.世界动态[0].来源, '码头脚夫', 'a world event keeps its 来源');
  assert.ok(!C.checkImportDraft(r.volumes, { mode: 'outline' }).some((x) => /只给作者看的字段/.test(x.text)));
});
test('live import: the draft prompt tells the model to keep "Y does not depend on X" in one stage', () => {
  const sys = C.importDraftMessages({ part: { i: 0, title: 't', text: 'x' }, index: '' })[0].content;
  assert.match(sys, /「Y 不依赖 X」/);
  assert.match(sys, /把 X 和 Y 放进\*\*同一个阶段\*\*/);
});
test('live fill: a judgment drawn after reading the original is 亲见, and 推测 never pairs with 已核实', () => {
  const tpl = C.synthesizeClueTemplate({}, { clue: {} }).template;
  const note = Object.values(tpl).find((s) => s && s.name === '知情表').sourceData.note;
  assert.match(note, /读了单据后判断证词对不上），记为「亲见」/);
  assert.match(note, /推测不配「已核实」/);
});
