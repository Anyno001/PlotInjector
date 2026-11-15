// 执行页「生成线索模板」按钮：读当前聊天模板 → 预览 → seed 导入 → 写绑定（GPT §17.2）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';

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
async function openGen(ctx) { ctx.doc.querySelector('[data-act="clue-gen-template"]').click(); await tick(); return ctx.doc.querySelector('.pi-dialog'); }
function fillLabels(dlg) { dlg.querySelectorAll('[data-gt-label]').forEach((el, i) => { el.value = `标签${i}`; }); }
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

test('second run (clue tables already exist): no fact rows in the template; points to 按大纲补预建行', async () => {
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
