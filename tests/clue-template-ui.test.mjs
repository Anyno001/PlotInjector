// 执行页「生成线索模板」按钮：读当前聊天模板 → 预览 → seed 导入 → 写绑定（GPT §17.2）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const storyText = fs.readFileSync(path.join(here, '../templates/clue-tables/示例_小镇失窃案.yaml'), 'utf8');
const DEFAULT = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/shujuku-default-template-spv8.9.2.json'), 'utf8'));
const tick = () => new Promise((r) => setTimeout(r, 20));
const byName = (t, name) => Object.values(t).find((s) => s && s.name === name);

// a chat that uses the official default tables; withDaily: rows already played (characters, inventory)
function dailyTables({ withDaily = false } = {}) {
  const t = JSON.parse(JSON.stringify(DEFAULT));
  if (withDaily) {
    const ch = byName(t, '重要角色表'); ch.content.push([1, '阿青', '女', '20', '茶馆伙计', '', '', '茶馆', '在场', '主角:熟人', '第2楼端茶', '']);
    const inv = byName(t, '背包物品表'); inv.content.push([1, '旧怀表', '1', '走时不准', '杂物']);
    const g = byName(t, '全局数据表'); g.content.push([1, '全局状态', '茶馆', '老街', '雾港', '', '0分', '2026-03-15 18:00']);
  }
  return t;
}
async function setup(tables) {
  const host = createHost({ tables });
  const inst = host.load();
  await inst.ready;
  const volumes = Object.entries(YAML.parse(storyText)).map(([key, stages], vi) => ({ id: `v${vi}`, key, stages: Object.entries(stages).map(([sk, data], si) => ({ id: `s${vi}_${si}`, key: sk, data })) }));
  const p = await inst.data.createProject('小镇');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes }, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  const click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  await click(`[data-act="project"][data-id="${p.id}"]`);
  await click('[data-act="tab"][data-tab="run"]');
  return { host, inst, doc, click, pid: p.id, api: host.w.AutoCardUpdaterAPI };
}
async function openGen(ctx) { (() => { const t = ctx.doc.querySelector('[data-act="run-set-toggle"][aria-expanded="false"]'); t && t.click(); })(); await tick(); ctx.doc.querySelector('[data-act="clue-gen-template"]').click(); await tick(); return ctx.doc.querySelector('.pi-dialog'); }
function fillLabels(dlg) { dlg.querySelectorAll('[data-gt-label]').forEach((el, i) => { el.value = `标签${i}`; el.dispatchEvent(new el.ownerDocument.defaultView.Event('input', { bubbles: true })); }); }
async function confirm(dlg) { [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '导入到当前聊天').click(); await tick(); await tick(); }

test('new chat on the default tables: preview lists the changes; import uses scope chat + seed; binding written; clue tables live', async () => {
  const ctx = await setup(dailyTables());
  const dlg = await openGen(ctx);
  const text = dlg.textContent;
  assert.match(text, /新增「关键事实表」/);
  assert.match(text, /「全局数据表」改为每楼更新/);
  assert.match(text, /「重要角色表」新增列：剧情身份、当前动向/);
  assert.match(text, /不会删除任何东西/);
  fillLabels(dlg); await confirm(dlg);
  assert.equal(ctx.api.templateCalls.length, 1);
  assert.deepEqual(ctx.api.templateCalls[0].options, { scope: 'chat', dataMode: 'seed' });
  const t = ctx.api.templateCalls[0].tpl;
  assert.equal(byName(t, '关键事实表').content.length - 1, 5, 'five facts from the sample outline');
  assert.equal(byName(t, '关键事实表').content[1][2], '标签0', 'author label used');
  const b = ctx.inst.data.project(ctx.pid).clue.bindings;
  assert.equal(b.facts[0].表, '关键事实表');
  assert.deepEqual([...b.time.路径], ['全局数据表/全局状态/当前时间', '线索控制表/主线/当前时间']);
  assert.equal(b.switch, null);
  const c = ctx.inst.runtime.clue.compute();
  assert.deepEqual([...c.snap.facts.keys()].sort(), ['F_box', 'F_ledger', 'F_print', 'F_seen', 'F_talk']);
  await ctx.inst.destroy();
});

test('chat with daily data: existing rows survive the import; only new columns padded', async () => {
  const ctx = await setup(dailyTables({ withDaily: true }));
  const dlg = await openGen(ctx); fillLabels(dlg); await confirm(ctx.doc.querySelector('.pi-dialog'));
  const live = ctx.api.exportTableAsJson();
  const ch = byName(live, '重要角色表');
  assert.equal(ch.content.length, 2);
  assert.equal(ch.content[1][1], '阿青'); assert.equal(ch.content[1][10], '第2楼端茶');
  assert.deepEqual(ch.content[0].slice(-2), ['剧情身份', '当前动向']);
  assert.equal(byName(live, '背包物品表').content[1][1], '旧怀表');
  assert.equal(byName(live, '全局数据表').content[1][7], '2026-03-15 18:00');
  await ctx.inst.destroy();
});

test('second run (clue tables already exist): no fact rows in the template; points to 按大纲补表格行', async () => {
  const ctx = await setup(dailyTables());
  let dlg = await openGen(ctx); fillLabels(dlg); await confirm(dlg);
  dlg = await openGen(ctx);
  assert.match(dlg.textContent, /已经有关键事实表，不在模板里追加行/);
  assert.equal(dlg.querySelectorAll('[data-gt-label]').length, 0);
  await confirm(dlg);
  // the chat template keeps its original data rows as they were imported (real ST: getTableTemplate returns them);
  // the second run must not add rows and must not copy runtime progress into the template
  const first = ctx.api.templateCalls[0].tpl, t = ctx.api.templateCalls[1].tpl;
  assert.deepEqual(byName(t, '关键事实表').content, byName(first, '关键事实表').content, 'same template rows as the first import, nothing added');
  assert.ok(byName(t, '关键事实表').content.every((r) => r[4] === undefined || r[4] === '未获得' || r[4] === '状态'), 'no runtime status copied');
  await ctx.inst.destroy();
});

test('import failure: binding untouched; template read failure / mismatch: nothing imported', async () => {
  let ctx = await setup(dailyTables());
  ctx.api.importFails = '模拟失败';
  let dlg = await openGen(ctx); fillLabels(dlg); await confirm(dlg);
  assert.deepEqual(JSON.parse(JSON.stringify(ctx.inst.data.project(ctx.pid).clue.bindings.facts)), [], 'no binding written');
  await ctx.inst.destroy();

  ctx = await setup(dailyTables());
  ctx.api.templateUnavailable = true;
  assert.equal(await openGen(ctx), null, 'no dialog when the template cannot be read');
  assert.equal(ctx.api.templateCalls.length, 0);
  ctx.api.templateUnavailable = false;
  // a template that does not match the running tables (e.g. global fallback) → refused
  const orig = ctx.api.getTableTemplate;
  ctx.api.getTableTemplate = () => ({ ...orig(), sheet_other: { uid: 'sheet_other', name: '别的模板的表', content: [['row_id', 'x']], sourceData: {}, updateConfig: {}, exportConfig: {} } });
  let d = await openGen(ctx);
  assert.match(d.textContent, /没有生成线索模板[\s\S]*模板里有、当前聊天没有：别的模板的表/);
  assert.ok(![...d.querySelectorAll('.pi-btn')].some((b) => b.textContent === '导入到当前聊天'), 'no import button');
  [...d.querySelectorAll('.pi-btn')].find((b) => b.textContent === '关闭').click(); await tick();
  assert.equal(ctx.api.templateCalls.length, 0);
  await ctx.inst.destroy();
});

test('template changed while the preview was open → not imported', async () => {
  const ctx = await setup(dailyTables());
  const dlg = await openGen(ctx); fillLabels(dlg);
  const live = ctx.api.exportTableAsJson(); byName(live, '选项表').sourceData.note += '（用户刚改的）'; ctx.host.db.setTables(live);
  await confirm(dlg);
  assert.equal(ctx.api.templateCalls.length, 0);
  await ctx.inst.destroy();
});

// 实测 2026-11-15：导入后到第一次填表前，预建行还是数据库的种子行，插件改不了「场景目录」，第一轮正文拿不到入口；
// 生成模板时确认过的标签也没存进项目，执行页误报「标签还没准备好」。
test('multi-line outline: the scene catalog is written into the control seed row; confirmed labels are kept; no pending-label warning', async () => {
  const multiText = fs.readFileSync(path.join(here, './fixtures/雾港旧案_多线实测大纲.yaml'), 'utf8');
  const host = createHost({ tables: dailyTables() });
  const inst = host.load(); await inst.ready;
  const volumes = loadCore().parseOutlineText(multiText);
  const p = await inst.data.createProject('雾港多线');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes }, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document, api = host.w.AutoCardUpdaterAPI;
  doc.querySelector(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  const dlg = await openGen({ doc }); fillLabels(dlg); await confirm(dlg);
  const ctrl = byName(api.templateCalls[0].tpl, '线索控制表');
  assert.equal(ctrl.content.length, 2);
  const cat = ctrl.content[1][ctrl.content[0].indexOf('场景目录')];
  assert.match(cat, /m1_request：去报社门口见委托人/, 'running main line entry listed');
  assert.match(cat, /s01_photo：/, 'open side line entry listed');
  assert.doesNotMatch(cat, /s02_address|m2_pawnshop|m1_watchman/, 'nothing that is not open yet');
  const labels = inst.data.project(p.id).clue.labels;
  assert.equal(labels.F_ticket.label, '标签0');
  assert.equal(Object.keys(labels).length, 6);
  inst.runtime.clue.invalidate(); inst.renderBody ? inst.renderBody() : null; await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  assert.doesNotMatch(doc.body.textContent, /标签还没准备好/);
  await inst.destroy();
});

test('bound project, new chat without clue tables: 需要处理 has a 创建模板 button even with run settings folded', async () => {
  const ctx = await setup(dailyTables());
  ctx.inst.data.updateProject(ctx.pid, (x) => ({ ...x, clue: { ...x.clue, bindings: { facts: [{ 表: '关键事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }], knowledge: [] } } }));
  await ctx.host.eventSource.emit(ctx.host.eventTypes.CHAT_CHANGED);
  await ctx.host.settle(); await tick();
  await ctx.click('[data-act="tab"][data-tab="run"]');
  assert.ok(ctx.doc.querySelector('[data-act="run-set-toggle"][aria-expanded="false"]'), 'run settings folded');
  const btn = ctx.doc.querySelector('.pi-hint.is-warn [data-act="clue-gen-template"]');
  assert.ok(btn);
  btn.click(); await tick();
  assert.ok(ctx.doc.querySelector('.pi-dialog'), 'opens the template dialog');
  await ctx.inst.destroy();
});

// 跑团项目（用户 11-22）：模板只放眼前的线索行；标签全部存进项目。普通项目见第一条测试（5条全给）。
test('trpg project: template seeds only the near facts, all labels kept', async () => {
  const ctx = await setup(dailyTables());
  ctx.inst.data.updateProject(ctx.pid, (x) => ({ ...x, trpg: { on: true } }));
  ctx.inst.runtime.clue.invalidate();
  const dlg = await openGen(ctx); fillLabels(dlg); await confirm(dlg);
  const seeded = byName(ctx.api.templateCalls[0].tpl, '关键事实表').content.slice(1).map((r) => r[1]);
  assert.ok(seeded.length > 0 && seeded.length < 5, `seeded ${seeded}`);
  assert.equal(Object.keys(ctx.inst.data.project(ctx.pid).clue.labels).length, 5, 'all labels kept in the project');
  await ctx.inst.destroy();
});
