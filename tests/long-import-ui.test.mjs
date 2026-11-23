// 大纲页「导入长文…」：整理 → 中断后继续 → 审阅 → 采用；重复采用只写一次（GPT §19.3 准入测试 ④）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';

const tick = () => new Promise((r) => setTimeout(r, 20));
// three chapters of ~5000 chars each → three parts at the plugin's 8000-char target
const CH = (t, s) => [`## ${t}`, ...Array.from({ length: 40 }, () => s.repeat(10))].join('\n\n');
const SRC = ['# 旧码头', CH('第一章 证词', '老韩说看见周先生提着包出去。'), CH('第二章 原件', '抽屉里的出货单是白天签的。'), CH('第三章 收尾', '主角把账本交给了警察局。')].join('\n');
const INDEX_REPLY = '```yaml\n梗概: x\n人物:\n  - {名称: 老韩, 公开身份: 看守}\n事实:\n  - {编号: F_a, 内容: 证词, 性质: 证词}\n```';
const draft = (n) => ['```yaml', '剧情_卷1_旧码头:', `  阶段${n}_段${n}:`, '    主线节点:', `      - id: n${n}`, `        名称: 节点${n}`, `        入口: 去${n}`, `        发现: [{事实: F${n}, 内容: c${n}}]`, `        完成条件: {事实: F${n}}`, `        来源: 原文第${n}段`, '```'].join('\n');

async function boot() {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('码头');
  inst.data.updateProject(p.id, (x) => ({ ...x, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  const click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  await click(`[data-act="project"][data-id="${p.id}"]`);
  await click('[data-act="tab"][data-tab="outline"]');
  return { host, inst, doc, click, pid: p.id };
}
// the model replies: index for every index request, a numbered draft for every draft request
function scriptModel(host, { failOnDraft = 0 } = {}) {
  let drafts = 0;
  host.llm.reply = undefined;
  host.llm.respond = (body) => {
    if (/整理作者索引/.test(body)) return INDEX_REPLY;
    drafts += 1;
    if (failOnDraft && drafts === failOnDraft) throw new Error('模拟网络中断');
    const n = /第 (\d+) \//.exec(body) ? 0 : drafts;
    return draft(n || drafts);
  };
}
const waitIdle = async (host, inst) => { for (let i = 0; i < 60; i++) { await tick(); if (!Object.values(inst.__view?.busy || {}).some(Boolean)) break; } };

test('long import: paste → run → review → adopt appends one volume; author-only fields stay out; second adopt writes nothing', async () => {
  const { host, inst, doc, click, pid } = await boot();
  scriptModel(host);
  await click('[data-act="import-open-panel"]');
  assert.ok(doc.querySelector('[data-imp-needs]').getAttribute('placeholder').includes('调查部分想细一点玩'), 'example shown as placeholder');
  doc.querySelector('[data-imp-text]').value = SRC;
  await click('[data-act="import-start"]');
  for (let i = 0; i < 40 && !doc.querySelector('[data-act="import-adopt"]'); i++) await tick();
  assert.ok(doc.querySelector('[data-act="import-adopt"]'), 'review shown');
  assert.ok(doc.documentElement.textContent.includes('节点1'));
  await click('[data-act="import-adopt"]');
  let vols = inst.data.project(pid).outline.volumes;
  assert.equal(vols.length, 1);
  const nodes = vols[0].stages.flatMap((s) => s.data.主线节点);
  assert.ok(nodes.length >= 1);
  assert.ok(nodes.every((n) => !('来源' in n)), 'author-only 来源 not in the outline');
  // 采用后审阅页换成「已保存到大纲」（导入审阅总方案 E），没有第二个采用按钮；强行再触发一次采用也不写第二份
  assert.match(doc.documentElement.textContent, /已保存到大纲/);
  assert.ok(!doc.querySelector('[data-act="import-adopt"]'), 'no adopt button after adopting');
  const fake = doc.createElement('div'); fake.className = 'pi-card'; doc.querySelector('.pi-body').append(fake); // 点击要落在插件里才会被处理
  const btn = doc.createElement('button'); btn.dataset.act = 'import-adopt'; fake.append(btn); btn.click(); await tick();
  assert.equal(inst.data.project(pid).outline.volumes.length, 1, 'adopted only once');
  await inst.destroy();
});

test('long import: a failure mid-way keeps finished parts; 继续 resumes without redoing them', async () => {
  const { host, inst, doc, click } = await boot();
  scriptModel(host, { failOnDraft: 2 });
  await click('[data-act="import-open-panel"]');
  doc.querySelector('[data-imp-text]').value = SRC;
  await click('[data-act="import-start"]');
  for (let i = 0; i < 40 && !doc.querySelector('[data-act="import-run"]:not([disabled])'); i++) await tick();
  const jobId = inst.data.project(inst.data.index().projects[0].id).imports[0];
  const job = inst.data.imports.get(jobId);
  const doneBefore = Object.keys(job.drafts).length;
  assert.ok(doneBefore >= 1 && doneBefore < job.parts.length, `partial (${doneBefore}/${job.parts.length})`);
  const callsBefore = host.llmCalls.length;
  scriptModel(host);
  await click('[data-act="import-run"]');
  for (let i = 0; i < 40 && !doc.querySelector('[data-act="import-adopt"]'); i++) await tick();
  assert.ok(doc.querySelector('[data-act="import-adopt"]'), 'finished after resume');
  const newCalls = host.llmCalls.length - callsBefore;
  assert.equal(newCalls, job.parts.length - doneBefore, 'only the unfinished parts were requested again');
  await inst.destroy();
});

test('long import: adopt, reload the plugin (state read back from files), adopt again → still one volume', async () => {
  const { host, inst, doc, click, pid } = await boot();
  scriptModel(host);
  await click('[data-act="import-open-panel"]');
  doc.querySelector('[data-imp-text]').value = SRC;
  await click('[data-act="import-start"]');
  for (let i = 0; i < 40 && !doc.querySelector('[data-act="import-adopt"]'); i++) await tick();
  await click('[data-act="import-adopt"]');
  assert.equal(inst.data.project(pid).outline.volumes.length, 1);
  await inst.data.flush();
  const jobId = inst.data.project(pid).imports[0];
  await inst.destroy();
  // reopen: a fresh instance reads index, project and the import job from the files
  const inst2 = host.load(); await inst2.ready;
  await inst2.data.loadProject(pid);
  await inst2.runtime.switchProject(pid);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst2.open(); await tick();
  const doc2 = host.w.document;
  const click2 = async (sel) => { const el = doc2.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  await click2(`[data-act="project"][data-id="${pid}"]`);
  await click2('[data-act="tab"][data-tab="outline"]');
  await click2('[data-act="import-open-panel"]');
  for (let i = 0; i < 20 && !doc2.querySelector(`[data-act="import-open"][data-id="${jobId}"]`); i++) await tick();
  await click2(`[data-act="import-open"][data-id="${jobId}"]`);
  assert.match(doc2.documentElement.textContent, /已保存到大纲/);
  const fake = doc2.createElement('div'); fake.className = 'pi-card'; doc2.querySelector('.pi-body').append(fake); // 点击要落在插件里才会被处理
  const btn = doc2.createElement('button'); btn.dataset.act = 'import-adopt'; fake.append(btn); btn.click(); await tick();
  assert.equal(inst2.data.project(pid).outline.volumes.length, 1, 'no second copy after reload');
  await inst2.destroy();
});

test('long import: a sentinel secret in the source reaches the author index, never the body request after adopting', async () => {
  const { host, inst, doc, click, pid } = await boot();
  const SENT = '哨兵句_真正的经手人是主管侄子';
  host.llm.respond = (body) => /整理作者索引/.test(body)
    ? `\`\`\`yaml\n梗概: x\n作者资料: ${SENT}\n人物:\n  - {名称: 侄子, 真实身份: 经手人}\n\`\`\``
    : ['```yaml', '剧情_卷1_x:', '  阶段1_a:', '    主线节点:', '      - id: n1', '        名称: 查账', '        入口: 去账房', '        发现: [{事实: F1, 内容: 出货单是白天签的}]', '        完成条件: {事实: F1}', `        作者备注: <仅作者>${SENT}</仅作者>`, '```'].join('\n');
  await click('[data-act="import-open-panel"]');
  doc.querySelector('[data-imp-text]').value = `## 第一章\n账房。\n作者说明：${SENT}`;
  await click('[data-act="import-start"]');
  for (let i = 0; i < 40 && !doc.querySelector('[data-act="import-adopt"]'); i++) await tick();
  assert.match(doc.documentElement.textContent, new RegExp(SENT), 'author can see it in the index');
  await click('[data-act="import-adopt"]');
  inst.data.updateProject(pid, (x) => ({ ...x, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  inst.runtime.clue.invalidate();
  const injected = inst.runtime.entries().map((e) => e.content).join('\n');
  assert.ok(injected.includes('出货单是白天签的'), `adopted node is live: ${injected.slice(0, 300)}`);
  assert.ok(!injected.includes(SENT), 'sentinel not in the body material');
  await inst.destroy();
});
