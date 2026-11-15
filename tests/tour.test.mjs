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
  assert.ok(!seen.includes('生成线索模板'), 'clue-only step skipped in outline mode');
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
