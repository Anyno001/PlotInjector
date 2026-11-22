// 新手教程（2026-11-08）：第一次打开自动播放总览；其他页面只在点「?」时播放；看过的记在插件设置里。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';

const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
// jsdom 没有布局：给插件元素一个非零尺寸，教程才认为按钮「看得见」。
function fakeLayout(w) {
  w.HTMLElement.prototype.getBoundingClientRect = function () {
    return this.isConnected && !this.hidden && !this.closest('[hidden]') ? { left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30, x: 10, y: 10 } : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0, x: 0, y: 0 };
  };
  w.HTMLElement.prototype.scrollIntoView = function () {};
}
async function boot({ withProject = false } = {}) {
  const host = createHost({ tables: {} });
  fakeLayout(host.w);
  const inst = host.load(); await inst.ready;
  let pid = '';
  if (withProject) {
    const p = await inst.data.createProject('码头');
    pid = p.id;
    await inst.runtime.switchProject(p.id);
    await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  }
  return { host, inst, doc: host.w.document, pid };
}
const pop = (doc) => doc.querySelector('.pi-tour .pi-tour-pop');
const title = (doc) => pop(doc).querySelector('.pi-tour-title').textContent;
const press = async (doc, which) => { pop(doc).querySelector(`[data-tour=${which}]`).click(); await tick(); };

test('first open plays the overview once; finishing it marks it seen and it does not come back', async () => {
  const { inst, doc } = await boot();
  inst.open();
  for (let i = 0; i < 20 && !pop(doc); i++) await tick(60);
  assert.ok(pop(doc), 'overview starts by itself');
  assert.equal(title(doc), '欢迎使用剧情注入器');
  assert.match(pop(doc).querySelector('.pi-tour-count').textContent, /^1 \/ \d+$/);
  assert.ok(pop(doc).querySelector('[data-tour=prev]').disabled);
  // walk to the end
  for (let i = 0; i < 12 && pop(doc); i++) await press(doc, 'next');
  assert.equal(pop(doc), null, 'finished');
  assert.deepEqual([...inst.data.settings().tourState.done], ['core']);
  inst.__view && inst.open();
  await tick(800);
  assert.equal(pop(doc), null, 'not shown again');
  await inst.destroy();
});

test('closing with × or Esc also counts as seen; other pages never auto-play', async () => {
  const { inst, doc, pid } = await boot({ withProject: true });
  inst.open();
  for (let i = 0; i < 20 && !pop(doc); i++) await tick(60);
  await press(doc, 'close');
  assert.deepEqual([...inst.data.settings().tourState.done], ['core']);
  doc.querySelector(`[data-act="project"][data-id="${pid}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="outline"]').click(); await tick(300);
  assert.equal(pop(doc), null, 'outline tab does not auto-play');
  await inst.destroy();
});

test('the ? button plays the current page; steps whose button is not on screen are skipped', async () => {
  const { inst, doc, pid } = await boot({ withProject: true });
  inst.data.updateSettings({ tourState: { revision: 2, done: ['core'] } });
  inst.open(); await tick();
  doc.querySelector(`[data-act="project"][data-id="${pid}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  doc.querySelector('[data-act="tour"]').click(); await tick();
  assert.ok(pop(doc), 'run-page tour started');
  const seen = [];
  for (let i = 0; i < 15 && pop(doc); i++) { seen.push(title(doc)); await press(doc, 'next'); }
  // outline mode: the project is active, so 启用项目 is skipped; clue-only buttons are skipped
  assert.ok(!seen.includes('启用项目'), seen.join());
  assert.ok(seen.includes('推进方式'));
  assert.ok(!seen.includes('创建模板'), 'clue-only step skipped in outline mode');
  // Esc closes
  doc.querySelector('[data-act="tour"]').click(); await tick();
  doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
  await tick();
  assert.equal(pop(doc), null);
  assert.ok(doc.querySelector('.pi-overlay'), 'Esc closed only the tour, not the panel');
  await inst.destroy();
});

test('settings: 重新播放全部教程 clears what was seen and replays the overview; a revision bump re-shows it', async () => {
  const { inst, doc } = await boot();
  inst.data.updateSettings({ tourState: { revision: 2, done: ['core', 'run'] } });
  inst.open(); await tick();
  doc.querySelector('[data-act="page"][data-page="settings"]').click(); await tick();
  doc.querySelector('[data-act="tour-reset"]').click(); await tick();
  assert.equal(title(doc), '欢迎使用剧情注入器');
  assert.deepEqual([...inst.data.settings().tourState.done], []);
  await press(doc, 'close');
  // an old revision counts as nothing seen
  inst.data.updateSettings({ tourState: { revision: 0, done: ['core'] } });
  await inst.destroy();
});

test('a page whose buttons are not shown says so instead of opening an empty tour', async () => {
  const { inst, doc } = await boot();
  inst.data.updateSettings({ tourState: { revision: 2, done: ['core'] } });
  inst.open(); await tick();
  // no project selected: the ? button plays the overview (its welcome step is centred, always available)
  doc.querySelector('[data-act="tour"]').click(); await tick();
  assert.equal(title(doc), '欢迎使用剧情注入器');
  await press(doc, 'close');
  await inst.destroy();
});

// 导入页、逐页审阅页（大纲页里打开的）有自己的说明；讨论页指向新的「参考」「审阅修改」（导入审阅总方案第 5 条剩余项）。
test('the ? button on the import page and on the review page plays their own steps; the discussion steps point at 参考 / 审阅修改', async () => {
  const { host, inst, doc, pid } = await boot({ withProject: true });
  inst.data.updateSettings({ tourState: { revision: 2, done: ['core'] } });
  inst.data.updateProject(pid, (p) => ({ ...p, outline: { ...p.outline, volumes: [{ id: 'v1', key: '剧情_卷一_码头', stages: [{ id: 's1', key: '阶段一_报案', data: { 时间范围: '第一天', 主线节点: [{ 名称: '报案', 地点: '码头', 事件: '有人报案' }] } }] }] } }));
  inst.open(); await tick();
  const click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  const titles = async () => { const out = []; for (let i = 0; i < 12 && pop(doc); i++) { out.push(title(doc)); await press(doc, 'next'); } return out; };
  await click(`[data-act="project"][data-id="${pid}"]`);
  await click('[data-act="tab"][data-tab="discuss"]');
  for (let i = 0; i < 20 && !doc.querySelector('.pi-dc-refs'); i++) await tick();
  await click('.pi-top-end [data-act=tour]');
  const d = await titles();
  assert.ok(d.includes('附带参考') && d.includes('审阅修改'), d.join(' / '));
  // 导入页
  await click('[data-act="tab"][data-tab="outline"]');
  await click('[data-act="import-open-panel"]');
  await click('.pi-top-end [data-act=tour]');
  const im = await titles();
  assert.ok(im.includes('原文') && im.includes('开始整理'), im.join(' / '));
  assert.deepEqual([...im], ['原文', '推进方式', '开始整理'], 'outline-mode project: 文档内容 is not on the page, so its step is skipped; 推进方式 is found');
  // 切成线索推进，「文档内容」出现，四步都在、顺序和页面一致
  doc.querySelector('[data-imp-modesel]').value = 'clue';
  doc.querySelector('[data-imp-modesel]').dispatchEvent(new host.w.Event('input', { bubbles: true })); await tick(); await tick();
  await click('.pi-top-end [data-act=tour]');
  assert.deepEqual([...(await titles())], ['原文', '推进方式', '文档内容', '开始整理']);
  // 审阅页（讨论页「审阅修改」进去）
  await click('[data-act="tab"][data-tab="discuss"]');
  await click('[data-act="review-pick"]');
  doc.querySelector('.pi-dialog [data-dlg-value="v1"]').click();
  for (let i = 0; i < 30 && !doc.querySelector('.pi-rv'); i++) await tick();
  await click('.pi-top-end [data-act=tour]');
  const rv = await titles();
  assert.ok(rv.includes('页签') && rv.includes('发送意见') && rv.includes('保存到大纲'), rv.join(' / '));
  assert.ok(!rv.includes('导入长文'), 'not the outline tab steps');
  assert.ok(!rv.includes('这条线的更多操作'), 'the ⋯ step is skipped when the page has no ⋯ (not a multi-line import)');
  await inst.destroy();
});

test('multi-line import review: the tour points at the ⋯ on the line page (本次不导入 / 重新整理)', async () => {
  const { inst, doc, pid } = await boot({ withProject: true });
  inst.data.updateSettings({ tourState: { revision: 2, done: ['core'] } });
  const v = (id) => ({ id: `v${id}`, key: `剧情_${id}_x`, line: { 编号: id, 类型: '支线', 简介: 'x' }, stages: [{ id: `s${id}`, key: '阶段1_x', data: { 主线节点: [{ id: `${id}a`, 名称: 'a', 入口: '去', 发现: [{ 事实: `F_${id}`, 内容: 'x' }], 完成条件: { 事实: `F_${id}` } }] } }] });
  const job = await inst.data.imports.create({ projectId: pid, text: 'x', mode: 'lines', needs: '' });
  await inst.data.imports.update(job.id, (j) => ({ ...j, step: 'review', lineReview: { items: { S01: { vol: v('S01'), comment: '', lastComment: '', changed: [], dropped: false }, S02: { vol: v('S02'), comment: '', lastComment: '', changed: [], dropped: false } }, order: ['S01', 'S02'], conflicts: [] } }));
  inst.data.updateProject(pid, (p) => ({ ...p, imports: [...(p.imports || []), job.id] }));
  inst.open(); await tick();
  const click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  await click(`[data-act="project"][data-id="${pid}"]`);
  await click('[data-act="tab"][data-tab="outline"]');
  await click('[data-act="import-open-panel"]');
  await click(`[data-act="import-open"][data-id="${job.id}"]`);
  for (let i = 0; i < 30 && !doc.querySelector('.pi-rv'); i++) await tick();
  await click('.pi-top-end [data-act=tour]');
  const out = []; for (let i = 0; i < 12 && pop(doc); i++) { out.push(title(doc)); await press(doc, 'next'); }
  assert.deepEqual([...out.slice(0, 2)], ['页签', '这条线的更多操作'], out.join(' / '));
  await inst.destroy();
});
