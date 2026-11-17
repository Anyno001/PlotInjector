// 审阅修改（导入审阅总方案第五节 J，第三版，用户 2026-11-16）：
// 讨论页只聊天；「审阅修改」选一条线 → 逐页审阅（和导入同一个页面）→ 各页写意见 →「预览意见」（可改、加整体意见、附带讨论记录）
// → 一次请求 → 改过的页标出 →「保存到大纲」统一保存。按阶段推进的项目也能用。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';

const tick = () => new Promise((r) => setTimeout(r, 20));
const node = (id, gives, extra = {}) => ({ id, 名称: `${id}名`, 入口: `去${id}`, 发现: [{ 事实: gives, 内容: `${gives}内容` }], 完成条件: { 事实: gives }, ...extra });
const clueVols = () => [
  { id: 'v1', key: '剧情_M1_案子', line: { 编号: 'M1', 类型: '主线', 简介: '旧简介' }, stages: [
    { id: 's1', key: '阶段1_开头', data: { 主线节点: [node('n1', 'F1')] } },
    { id: 's2', key: '阶段2_中段', data: { 主线节点: [node('n2', 'F2')] } },
    { id: 's3', key: '阶段3_收尾', data: { 主线节点: [node('n3', 'F3')] } },
  ] },
  { id: 'vS', key: '剧情_S01_小事', line: { 编号: 'S01', 类型: '支线', 开启条件: { 线: 'M1 == 完成' } }, stages: [{ id: 'sS', key: '阶段1_x', data: { 主线节点: [node('ns', 'Fs', { 开放条件: { 节点: 'n3' } })] } }] },
];
const outlineVols = () => [
  { id: 'o1', key: '剧情_卷一_小镇', stages: [
    { id: 'os1', key: '阶段一_报案', data: { 时间范围: '第一天', 主线节点: [{ 名称: '接受报案', 地点: '杂货店', 事件: '老板娘报案' }] } },
    { id: 'os2', key: '阶段二_调查', data: { 时间范围: '第二天', 主线节点: [{ 名称: '查账本', 地点: '后屋', 事件: '发现撕掉的一页' }], 支线事件: [{ 名称: '流浪猫', 触发: '去后巷时', 事件: '猫叼着纽扣' }] } },
  ] },
];

async function boot(vols, mode = 'clue', talk = true) {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('审阅改');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { ...x.outline, volumes: vols }, ...(mode === 'clue' ? { clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } } : {}) }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.data.updateSettings({ tourState: { revision: 99, done: ['core', 'outline', 'run', 'discuss', 'setting'] } });
  if (talk) { const chat = await inst.data.loadChat(p.id); await inst.data.saveChat(p.id, { ...chat, messages: [{ id: 'm1', role: 'user', content: '旁证应该是码头的老水手', at: 1 }] }); }
  inst.open(); await tick();
  const doc = host.w.document;
  const click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  const blur = async (sel, value) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.value = value; el.dispatchEvent(new host.w.FocusEvent('focusout', { bubbles: true })); await tick(); };
  const dlgBtn = async (label) => { const b = [...doc.querySelectorAll('.pi-dialog .pi-btn')].find((x) => x.textContent === label); assert.ok(b, `missing dialog button ${label}`); b.click(); await tick(); await tick(); };
  await click(`[data-act="project"][data-id="${p.id}"]`);
  await click('[data-act="tab"][data-tab="discuss"]');
  return { host, inst, doc, click, blur, dlgBtn, pid: p.id };
}
async function openReview(t, volId) {
  await t.click('[data-act="review-pick"]');
  const item = t.doc.querySelector(`.pi-dialog [data-dlg-value="${volId}"]`);
  assert.ok(item, 'the line list shows this line');
  item.click();
  for (let i = 0; i < 30 && !t.doc.querySelector('.pi-rv'); i++) await tick();
  assert.ok(t.doc.querySelector('.pi-rv'), 'review page opened');
}
// 第 i 页（当前这条线里的第几页；第二批起页码只列当前线的页）
const goPage = async (t, i) => { const dots = t.doc.querySelectorAll('.pi-rv-dots [data-act="rv-go"]'); assert.ok(dots[i], `page ${i}`); dots[i].click(); await tick(); };

const REPLY = [
  '【单位：v1/s2】',
  '```yaml',
  '阶段2_中段:',
  '  主线节点:',
  '    - {id: n2, 名称: n2名, 入口: 去n2, 发现: [{事实: F2, 内容: F2内容}], 完成条件: {事实: F2}}',
  '    - {id: n2b, 名称: 老水手, 入口: 去码头找老水手, 必需: false, 发现: [{事实: F2b, 内容: 旁证内容}], 完成条件: {事实: F2b}}',
  '```',
  '【单位：v1/s3】',
  '```yaml',
  '阶段3_收尾:',
  '  主线节点:',
  '    - {id: n3, 名称: n3名, 入口: 去码头找n3, 发现: [{事实: F3, 内容: F3内容}], 完成条件: {事实: F3}}',
  '```',
].join('\n');
const S3_ONLY = REPLY.slice(REPLY.indexOf('【单位：v1/s3】'));

test('J3: discussion page has only chat + 参考 + 审阅修改 (no 改大纲 toggle, no proposals); the line list opens the page-by-page review', async () => {
  const t = await boot(clueVols());
  const { doc, inst, pid } = t;
  assert.equal(doc.querySelector('[data-act="edit-mode"]'), null, 'old toggle gone');
  assert.match(doc.querySelector('.pi-dc-refs').textContent, /参考 \d.*设定/);
  await t.click('[data-act="refs-toggle"]');
  assert.ok(doc.querySelector('[data-act="ref"][data-ref="setting"]'), 'refs expand');
  const before = JSON.stringify(inst.data.project(pid).outline.volumes);
  await openReview(t, 'v1');
  const rv = doc.querySelector('.pi-rv');
  assert.match(rv.querySelector('.pi-rv-lname').textContent, /M1/, 'line picker shows the chosen line');
  assert.match(rv.textContent, /和大纲一致/, 'nothing changed yet');
  assert.equal(rv.querySelectorAll('.pi-rv-dot').length, 4, 'line page + 3 stages');
  assert.equal(JSON.stringify(inst.data.project(pid).outline.volumes), before);
  // opening the same line again reuses the unsaved session
  const n = inst.data.project(pid).imports.length;
  await t.click('[data-act="tab"][data-tab="discuss"]');
  await openReview(t, 'v1');
  assert.equal(inst.data.project(pid).imports.length, n, 'no duplicate job');
  await inst.destroy();
});

test('J3: comments on two pages → 预览意见 lists them (editable) + talk → one request → changed pages → 保存到大纲 keeps ids and line head', async () => {
  const t = await boot(clueVols());
  const { doc, inst, host, pid } = t;
  await openReview(t, 'v1');
  await goPage(t, 2);
  await t.blur('[data-rv-comment]', '加一个旁证');
  await goPage(t, 3);
  await t.blur('[data-rv-comment]', '入口写清楚');
  assert.equal(doc.querySelectorAll('.pi-rv-dot.is-note').length, 2, 'pages with comments are marked');
  assert.match(doc.querySelector('[data-act="rv-preview"]').textContent, /发送意见（2 页）/);
  await t.click('[data-act="rv-preview"]');
  const dlg = doc.querySelector('.pi-dialog');
  assert.match(dlg.textContent, /发送意见/);
  assert.equal(dlg.querySelectorAll('[data-rv-q]').length, 2);
  assert.ok(dlg.querySelector('[data-rv-talk]').checked, 'talk attached by default');
  dlg.querySelector('[data-rv-q="v1/s3"]').value = '入口写清楚是码头';
  host.llm.reply = REPLY;
  const calls0 = host.llmCalls.length;
  await t.dlgBtn('发送');
  for (let i = 0; i < 30 && host.llmCalls.length === calls0; i++) await tick();
  await tick(); await tick();
  assert.equal(host.llmCalls.length - calls0, 1, 'one request');
  const req = host.llmCalls.at(-1).body;
  assert.match(req, /【单位：v1\/s2】/); assert.match(req, /【单位：v1\/s3】/);
  assert.match(req, /意见：入口写清楚是码头/, 'edited in the preview');
  assert.match(req, /【讨论记录】/); assert.match(req, /老水手/);
  assert.doesNotMatch(req, /只输出一个 ```yaml/);
  const rv = doc.querySelector('.pi-rv');
  assert.ok(rv.querySelectorAll('.pi-rv-dot.is-chg, .pi-rv-dot.is-cur').length >= 2);
  // 保存
  const hist0 = inst.data.project(pid).outline.history.length;
  await t.click('[data-act="import-adopt"]');
  assert.match(doc.querySelector('.pi-dialog').textContent, /新增节点「老水手」/);
  await t.dlgBtn('保存');
  const v1 = inst.data.project(pid).outline.volumes[0];
  assert.deepEqual([...v1.stages.map((s) => s.id)], ['s1', 's2', 's3']);
  assert.deepEqual({ ...v1.line }, { 编号: 'M1', 类型: '主线', 简介: '旧简介' });
  assert.equal(v1.stages[1].data.主线节点.length, 2);
  assert.equal(v1.stages[2].data.主线节点[0].入口, '去码头找n3');
  assert.equal(inst.data.project(pid).outline.history.length, hist0 + 1);
  assert.match(doc.querySelector('.pi-rv-state').textContent, /和大纲一致/, 'stays on the review page, now matching the outline');
  await inst.destroy();
});

test('J3: overall comment sends the whole line and accepts only the parts the AI changed; untouched pages are not failures', async () => {
  const t = await boot(clueVols(), 'clue', false);
  const { doc, inst, host } = t;
  await openReview(t, 'v1');
  await t.click('[data-act="rv-preview"]');
  const dlg = doc.querySelector('.pi-dialog');
  assert.equal(dlg.querySelector('[data-rv-talk]'), null, 'no talk checkbox when there is no discussion');
  dlg.querySelector('[data-rv-overall]').value = 'n3 的入口统一改成去码头';
  host.llm.reply = S3_ONLY;
  const toasts = []; for (const k of ['info', 'success', 'warning', 'error']) host.w.toastr[k] = (m) => toasts.push(`${k}:${m}`);
  await t.dlgBtn('发送');
  for (let i = 0; i < 30 && !toasts.length; i++) await tick();
  const req = host.llmCalls.at(-1).body;
  for (const k of ['v1/line', 'v1/s1', 'v1/s2', 'v1/s3']) assert.match(req, new RegExp(`【单位：${k.replace('/', '\\/')}】`), `whole line sent: ${k}`);
  assert.match(req, /【整体意见】/);
  assert.ok(toasts.some((x) => /^success:已修改 1 页/.test(x)), toasts.join(' | '));
  const job = inst.data.imports.get(inst.data.project(t.pid).imports.at(-1));
  assert.equal(job.review.draft[0].stages[2].data.主线节点[0].入口, '去码头找n3');
  await inst.destroy();
});

test('J3: an existing line does not report references to other lines as missing; a line changed elsewhere after opening is not overwritten', async () => {
  const t = await boot(clueVols());
  const { doc, inst, pid } = t;
  await openReview(t, 'vS');
  assert.doesNotMatch(doc.querySelector('.pi-rv').textContent, /不存在的节点|不存在的线|问题 \d/);
  await goPage(t, 1);
  const box = doc.querySelector('[data-rv-yaml]');
  box.value = box.value.replace('去ns', '去ns换个说法');
  await t.click('[data-act="rv-yaml-save"]');
  inst.data.updateProject(pid, (p) => ({ ...p, outline: { ...p.outline, volumes: p.outline.volumes.map((v) => (v.id === 'vS' ? { ...v, line: { ...v.line, 简介: '别处改的' } } : v)) } }));
  await t.click('[data-act="import-adopt"]');
  // 别处改过：列出别处的改动，由用户决定（GPT 代码审阅 R2）；这里取消
  assert.match([...doc.querySelectorAll('.pi-dialog')].pop().textContent, /已有新改动[\s\S]*简介/);
  await t.dlgBtn('取消');
  const vS = inst.data.project(pid).outline.volumes[1];
  assert.equal(vS.line.简介, '别处改的');
  assert.equal(vS.stages[0].data.主线节点[0].入口, '去ns', 'draft not saved over a changed line');
  await inst.destroy();
});

test('J3 outline mode: the review page has no line page, shows place / event and 支线, and the revise prompt uses the outline rules', async () => {
  const t = await boot(outlineVols(), 'outline');
  const { doc, inst, host } = t;
  await openReview(t, 'o1');
  const rv = doc.querySelector('.pi-rv');
  assert.equal(rv.querySelectorAll('.pi-rv-dot').length, 2, 'no line page');
  await goPage(t, 1);
  assert.match(doc.querySelector('.pi-rv').textContent, /后屋，发现撕掉的一页/);
  assert.match(doc.querySelector('.pi-rv').textContent, /支线[\s\S]*流浪猫[\s\S]*触发：去后巷时/);
  await t.blur('[data-rv-comment]', '加一段老板娘不配合的对话');
  host.llm.reply = '【单位：o1/os2】\n```yaml\n阶段二_调查:\n  时间范围: 第二天\n  主线节点:\n    - {名称: 查账本, 地点: 后屋, 事件: 发现撕掉的一页}\n    - {名称: 老板娘不配合, 地点: 柜台, 事件: 她推说记不清}\n```';
  await t.click('[data-act="rv-preview"]');
  await t.dlgBtn('发送');
  for (let i = 0; i < 30 && !/老板娘不配合/.test(doc.querySelector('.pi-rv').textContent); i++) await tick();
  const req = host.llmCalls.at(-1).body;
  assert.match(req, /每个阶段 2 到 4 个主线节点/, 'outline rules');
  assert.doesNotMatch(req, /完成条件必须写/, 'no clue rules');
  assert.match(doc.querySelector('.pi-rv').textContent, /老板娘不配合/);
  await inst.destroy();
});
