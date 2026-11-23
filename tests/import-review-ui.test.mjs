// 逐页审阅（导入审阅总方案第四节，界面见 开发/ui-preview/import-review.html）：在模拟酒馆里走一遍。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';

const tick = () => new Promise((r) => setTimeout(r, 20));
const INDEX = '```yaml\n梗概: x\n人物:\n  - {名称: 埃利奥特·维恩, 名字保密: true}\n  - {名称: 彼得}\n事实:\n  - {编号: F_cross, 内容: 核对出同一批货, 性质: 实物}\n```';
// 一条主线：阶段 5 的「检测」单走结束不了；阶段 7 的 AI指令写了保密名字
const DRAFT = [
  '```yaml',
  '剧情_街区:',
  '  线: {类型: 主线, 简介: 街区里的案子, 入口提示: 路灯又闪了一下, 开始时机原文: 彼得先遇到伤害普通人的后果}',
  '  阶段5_两条线:',
  '    结束条件: {任一: [{事实: F_cross}, {事实: F_bill}]}',
  '    主线节点:',
  '      - {id: n_ye, 名称: 叶莲娜的半张图, 入口: 去见叶莲娜, 必需: false, 发现: [{事实: F_cross, 内容: 核对出同一批货}], 完成条件: {事实: F_cross}}',
  '      - {id: n_test, 名称: 借设备做一次检测, 入口: 借设备, 必需: false, 发现: [{事实: F_risk, 内容: 器材容易过热}], 完成条件: {事实: F_risk}}',
  '      - {id: n_ma, 名称: 见维修工, 入口: 去见马特奥, 必需: false, 发现: [{事实: F_bill, 内容: 交货单指向冷库}], 完成条件: {事实: F_bill}}',
  '  阶段7_拦截:',
  '    AI指令: 查出埃利奥特·维恩组织这笔交易',
  '    主线节点:',
  '      - {id: n7, 名称: 订单背后的人, 入口: 核对订单, 发现: [{事实: F_who, 内容: 埃利奥特·维恩组织了交易}], 完成条件: {事实: F_who}}',
  '```',
].join('\n');

async function boot(projectCount = 1) {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const ids = [];
  for (let k = 0; k < projectCount; k++) {
    const p = await inst.data.createProject(`P${k}`);
    inst.data.updateProject(p.id, (x) => ({ ...x, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
    ids.push(p.id);
  }
  await inst.runtime.switchProject(ids[0]);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  const $ = (sel) => doc.querySelector(sel);
  const click = async (sel) => { const el = $(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  await click(`[data-act="project"][data-id="${ids[0]}"]`);
  await click('[data-act="tab"][data-tab="outline"]');
  return { host, inst, doc, $, click, ids, pid: ids[0] };
}
async function importMain(ctx, kind = 'main', reply = DRAFT) {
  ctx.host.llm.reply = undefined;
  ctx.host.llm.respond = (body) => (/整理作者索引/.test(body) ? INDEX : reply);
  await ctx.click('[data-act="import-open-panel"]');
  kind !== 'main' && (await ctx.click(`[data-act="import-kind"][data-kind="${kind}"]`));
  ctx.$('[data-imp-text]').value = '## 第五阶段\n内容。\n## 第七阶段\n内容。';
  await ctx.click('[data-act="import-start"]');
  for (let i = 0; i < 60 && !ctx.$('.pi-rv'); i++) await tick();
  assert.ok(ctx.$('.pi-rv'), 'review page shown');
}
const jobOf = (ctx) => ctx.inst.data.imports.get(ctx.inst.data.project(ctx.pid).imports[0]);
// 按意见修改：打开「预览意见」，点「发送修改」（用户 2026-11-16：意见统一预览后一次发送）。
async function sendRevise(ctx) {
  await ctx.click('[data-act="rv-send"]');
  assert.equal(ctx.doc.querySelector('.pi-dialog'), null, 'sends immediately, no dialog');
}
async function answer(doc, label) {
  for (let i = 0; i < 20 && !doc.querySelector('.pi-dialog'); i++) await tick();
  const dlg = [...doc.querySelectorAll('.pi-dialog')].pop();
  assert.ok(dlg, 'dialog shown');
  const text = dlg.textContent;
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === label).click(); await tick(); await tick();
  return text;
}

test('start page: document type and plotting mode are separate; the job remembers the type and the draft asks for a line head', async () => {
  const ctx = await boot();
  await ctx.click('[data-act="import-open-panel"]');
  assert.equal(ctx.doc.querySelectorAll('[data-act="import-kind"]').length, 3);
  assert.equal(ctx.$('[data-imp-modesel]').value, 'clue', '推进方式 select shows the project mode');
  assert.match(ctx.$('.pi-imp-kind').textContent, /多条支线/);
  assert.doesNotMatch(ctx.$('.pi-imp-kind').textContent, /好几条|案子|##/);
  ctx.$('[data-imp-text]').value = '保留我写的字';
  await ctx.click('[data-act="import-kind"][data-kind="side"]');
  assert.equal(ctx.$('[data-imp-text]').value, '保留我写的字', 'switching the type keeps the pasted text');
  assert.match(ctx.$('[data-imp-needs]').getAttribute('placeholder'), /什么时候能开始/);
  const pickMode = async (v) => { const sel = ctx.$('[data-imp-modesel]'); sel.value = v; sel.dispatchEvent(new ctx.host.w.Event('input', { bubbles: true })); await tick(); };
  await pickMode('outline');
  assert.ok(!ctx.$('[data-act="import-kind"]'), 'stage-based import has no line types');
  assert.equal(ctx.$('[data-imp-modesel]').value, 'outline');
  assert.match(ctx.$('.pi-card').textContent, /与项目当前的推进方式不同；保存后需到执行页切换推进方式/);
  assert.equal(ctx.$('[data-imp-text]').value, '保留我写的字', 'switching the mode keeps the pasted text');
  await pickMode('clue');
  await ctx.click('[data-act="import-kind"][data-kind="side"]');
  ctx.host.llm.reply = undefined;
  ctx.host.llm.respond = (body) => (/整理作者索引/.test(body) ? INDEX : DRAFT.replace('类型: 主线', '类型: 支线'));
  await ctx.click('[data-act="import-start"]');
  for (let i = 0; i < 60 && !ctx.$('.pi-rv'); i++) await tick();
  assert.equal(jobOf(ctx).kind, 'side');
  const draftReq = ctx.host.llmCalls.find((c) => /转写成可以游玩的大纲/.test(JSON.stringify(c)));
  assert.match(JSON.stringify(draftReq), /这份文档是\*\*一条支线\*\*/);
  await ctx.inst.destroy();
});

test('review: page 1 is the line; stage pages show plain issues; nothing touches the project until adopt', async () => {
  const ctx = await boot();
  await importMain(ctx);
  assert.match(ctx.$('.pi-rv-title').textContent, /^线/);
  assert.match(ctx.$('.pi-rv-when').textContent, /前一条主线结束后/, 'a main line defaults to after the previous one');
  assert.match(ctx.$('.pi-rv-when').textContent, /彼得先遇到伤害普通人的后果/, 'the document wording is shown');
  assert.ok(ctx.$('[data-rv-when="after"]').checked);
  const dots = [...ctx.doc.querySelectorAll('.pi-rv-dot')];
  assert.deepEqual(dots.map((d) => d.textContent), ['线信息', '阶段5 两条线', '阶段7 拦截'], 'page tabs name the pages');
  assert.ok(dots[1].classList.contains('is-err') && dots[2].classList.contains('is-err'), 'both stages have problems');
  await ctx.click('[data-act="rv-go"][data-i="1"]');
  const page = ctx.$('.pi-rv').textContent;
  assert.match(page, /玩家只做「借设备做一次检测」的话，拿不到「核对出同一批货」或「交货单指向冷库」/);
  assert.doesNotMatch(page.split('详情')[0], /n_test|F_cross/, 'no ids in the plain part');
  assert.equal(ctx.inst.data.project(ctx.pid).outline.volumes.length, 0, 'nothing written yet');
  await ctx.inst.destroy();
});

test('fill / fill-all append to the comment without overwriting or duplicating; comments are kept in the job (reopen safe)', async () => {
  const ctx = await boot();
  await importMain(ctx);
  await ctx.click('[data-act="rv-go"][data-i="1"]');
  const box = ctx.$('[data-rv-comment]');
  box.value = '我自己写的意见';
  box.dispatchEvent(new ctx.host.w.FocusEvent('focusout', { bubbles: true })); await tick();
  await ctx.click('[data-act="rv-fill"]');
  let c = Object.values(jobOf(ctx).review.comments).find((x) => x.includes('我自己写的意见'));
  assert.match(c, /^我自己写的意见\n「阶段5 两条线」：玩家只做/);
  await ctx.click('[data-act="rv-fill-all"]');
  c = Object.values(jobOf(ctx).review.comments).find((x) => x.includes('我自己写的意见'));
  assert.equal(c.split('\n').length, 2, 'the same problem is not added twice');
  const all = Object.values(jobOf(ctx).review.comments).filter((x) => x.trim());
  assert.equal(all.length, 2, 'stage 7 got its own comment too');
  assert.match(ctx.$('[data-act="rv-send"]').textContent, /发送意见（2页）/);
  await ctx.inst.destroy();
});

test('revise: one request per related group; reply goes back to the same stage id; changes listed; undo restores', async () => {
  const ctx = await boot();
  await importMain(ctx);
  await ctx.click('[data-act="rv-go"][data-i="1"]');
  await ctx.click('[data-act="rv-fill"]');
  const before = jobOf(ctx).review.draft[0].stages.map((s) => s.id);
  ctx.host.llm.respond = (body) => {
    const key = [...body.matchAll(/【单位：([^】编]+\/[^】]+)】/g)].map((m) => m[1]).find((k) => k !== 'v1/s5');
    return `【单位：${key}】\n\`\`\`yaml\n阶段5_两条线:\n  结束条件: {任一: [{事实: F_cross}, {事实: F_bill}]}\n  主线节点:\n    - {id: n_ye, 名称: 叶莲娜的半张图, 入口: 去见叶莲娜, 必需: false, 发现: [{事实: F_cross, 内容: 核对出同一批货}], 完成条件: {事实: F_cross}}\n    - {id: n_test, 名称: 借设备做一次检测, 入口: 借设备, 必需: false, 开放条件: {事实: F_cross}, 发现: [{事实: F_risk, 内容: 器材容易过热}], 完成条件: {事实: F_risk}}\n    - {id: n_ma, 名称: 见维修工, 入口: 去见马特奥, 必需: false, 发现: [{事实: F_bill, 内容: 交货单指向冷库}], 完成条件: {事实: F_bill}}\n\`\`\``;
  };
  const calls = ctx.host.llmCalls.length;
  await sendRevise(ctx);
  for (let i = 0; i < 40 && ctx.inst.__view.busy[`review:${ctx.pid}`]; i++) await tick();
  assert.equal(ctx.host.llmCalls.length - calls, 1, 'one request');
  const req = JSON.stringify(ctx.host.llmCalls[ctx.host.llmCalls.length - 1]);
  assert.match(req, /【原文】|意见：/);
  const r = jobOf(ctx).review;
  assert.deepEqual(r.draft[0].stages.map((s) => s.id), before, 'stage ids kept');
  assert.deepEqual(r.draft[0].stages[0].data.主线节点[1].开放条件, { 事实: 'F_cross' });
  assert.match(ctx.$('.pi-rv').textContent, /「借设备做一次检测」的开放条件：（无） → \{事实:F_cross\}/);
  assert.ok(!ctx.$('.pi-rv-dot.is-cur').classList.contains('is-err'));
  assert.equal(Object.values(r.comments).filter((x) => x.trim()).length, 0, 'the sent comment is cleared');
  await ctx.click('[data-act="rv-undo"]');
  assert.equal(jobOf(ctx).review.draft[0].stages[0].data.主线节点[1].开放条件, undefined, 'undo goes back');
  await ctx.inst.destroy();
});

test('revise: related stages go out as one group; if the reply misses one of them, none is applied (no half group)', async () => {
  const ctx = await boot();
  const LINKED = DRAFT.replace('  阶段7_拦截:\n    AI指令', '  阶段7_拦截:\n    进入条件: {事实: F_cross}\n    AI指令');
  await importMain(ctx, 'main', LINKED);
  await ctx.click('[data-act="rv-first-issue"]');
  await ctx.click('[data-act="rv-fill-all"]');
  const before = JSON.stringify(jobOf(ctx).review.draft);
  ctx.host.llm.respond = (body) => {
    const keys = [...new Set([...body.matchAll(/【单位：([^】编]+\/[^】]+)】/g)].map((m) => m[1]).filter((k) => k !== 'v1/s5'))];
    assert.equal(new Set(keys).size, 2, 'both linked stages in one request');
    return `【单位：${keys[0]}】\n\`\`\`yaml\n阶段5_两条线:\n  主线节点:\n    - {id: n_ye, 名称: 叶莲娜的半张图, 入口: 去见叶莲娜}\n\`\`\``;
  };
  const calls = ctx.host.llmCalls.length, said = [];
  ctx.host.w.toastr.warning = (m) => said.push(m);
  await sendRevise(ctx);
  for (let i = 0; i < 40 && ctx.inst.__view.busy[`review:${ctx.pid}`]; i++) await tick();
  assert.equal(ctx.host.llmCalls.length - calls, 1);
  assert.equal(JSON.stringify(jobOf(ctx).review.draft), before, 'half a group is never applied');
  assert.match(said.join(' | '), /已修改0页。未返回「阶段7 拦截」/, 'the user is told which page came back missing');
  await ctx.inst.destroy();
});

test('revise: a reply missing the unit or a stage edited meanwhile is not applied; the comment stays', async () => {
  const ctx = await boot();
  await importMain(ctx);
  await ctx.click('[data-act="rv-go"][data-i="1"]');
  await ctx.click('[data-act="rv-fill"]');
  const before = JSON.stringify(jobOf(ctx).review.draft);
  ctx.host.llm.respond = () => '好的，我改了。';
  await sendRevise(ctx);
  for (let i = 0; i < 40 && ctx.inst.__view.busy[`review:${ctx.pid}`]; i++) await tick();
  assert.equal(JSON.stringify(jobOf(ctx).review.draft), before);
  assert.ok(Object.values(jobOf(ctx).review.comments).some((x) => x.trim()), 'comment kept');
  await ctx.inst.destroy();
});

test('adopt (side line): the start time must be chosen first; the page goes back to page 1', async () => {
  const ctx = await boot();
  await importMain(ctx, 'side', DRAFT.replace('类型: 主线', '类型: 支线'));
  assert.match(ctx.$('.pi-rv-when').textContent, /文档未写开始条件/);
  await ctx.click('[data-act="rv-go"][data-i="2"]');
  ctx.$('.pi-rv-foot [data-act="import-adopt"]').click(); await tick(); await tick();
  assert.ok(!ctx.doc.querySelector('.pi-dialog'), 'no confirm: it sends you back to choose first');
  assert.equal(ctx.inst.data.project(ctx.pid).outline.volumes.length, 0);
  assert.match(ctx.$('.pi-rv-title').textContent, /^线/, 'back on page 1');
  const radio = ctx.$('[data-rv-when="any"]');
  radio.checked = true; radio.dispatchEvent(new ctx.host.w.Event('input', { bubbles: true })); await tick(); await tick();
  ctx.$('.pi-rv-foot [data-act="import-adopt"]').click(); await tick();
  ctx.doc.querySelector('.pi-dialog') && (await answer(ctx.doc, '仍然保存'));
  const v = ctx.inst.data.project(ctx.pid).outline.volumes;
  assert.equal(v.length, 1);
  assert.equal(v[0].line.编号, 'S01');
  await ctx.inst.destroy();
});

test('adopt: a main line is numbered after existing lines and waits for the previous one by default; history kept, secret list stored; second adopt writes nothing', async () => {
  const ctx = await boot();
  ctx.inst.data.updateProject(ctx.pid, (p) => ({ ...p, outline: { ...p.outline, volumes: [{ id: 'vOld', key: '剧情_M1_旧案', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 'sOld', key: '阶段1_x', data: { 主线节点: [{ id: 'old1', 名称: '旧', 入口: '去', 发现: [{ 事实: 'F_old', 内容: 'x' }], 完成条件: { 事实: 'F_old' } }] } }] }] } }));
  await importMain(ctx);
  assert.match(ctx.$('.pi-rv-when').textContent, /前一条主线结束后/);
  ctx.$('.pi-rv-foot [data-act="import-adopt"]').click(); await tick();
  const text = await answer(ctx.doc, '仍然保存');
  assert.match(text, /还有2个问题没解决/);
  const p = ctx.inst.data.project(ctx.pid);
  assert.equal(p.outline.volumes.length, 2);
  const line = p.outline.volumes[1].line;
  assert.equal(line.编号, 'M2');
  assert.equal(line.接上一条, true);
  assert.ok(!('开始时机已选' in line), 'helper flag not saved');
  assert.ok(p.outline.history.length >= 1, 'old outline in history');
  assert.equal(p.outline.history[0].label, '导入采用');
  assert.match(p.outline.history[0].text, /剧情_M1_旧案/);
  assert.deepEqual([...Object.values(p.secretNames)[0].names], ['埃利奥特·维恩']);
  assert.match(ctx.doc.documentElement.textContent, /已保存到大纲：M2/);
  const fake = ctx.doc.createElement('div'); fake.className = 'pi-card'; ctx.doc.querySelector('.pi-body').append(fake); // 点击要落在插件里才会被处理
  const btn = ctx.doc.createElement('button'); btn.dataset.act = 'import-adopt'; fake.append(btn); btn.click(); await tick();
  assert.equal(ctx.inst.data.project(ctx.pid).outline.volumes.length, 2, 'no second copy');
  // 任务文件写入失败（「已采用」和改过的草稿都没存上，还是采用前那份）：以项目里的标记为准，仍然不写第二份
  await ctx.inst.data.imports.update(jobOf(ctx).id, (j) => ({ ...j, review: { ...j.review, adoptedId: '', reopened: false, draft: j.review.draft.map((v) => ({ ...v, id: 'vFresh', line: { ...v.line, 编号: undefined, 接上一条: true } })) } }));
  ctx.inst.__view.renderBody(); await tick();
  assert.ok(ctx.$('.pi-rv-foot [data-act="import-adopt"]'), 'the review page (with its adopt button) is back, as after a lost write');
  ctx.$('.pi-rv-foot [data-act="import-adopt"]').click(); await tick(); ctx.doc.querySelector('.pi-dialog') && (await answer(ctx.doc, '仍然保存'));
  assert.equal(ctx.inst.data.project(ctx.pid).outline.volumes.length, 2, 'project mark wins');
  await ctx.inst.destroy();
});

test('save with unsent comments: 取消 writes nothing; 先发送 sends straight away; 仍然保存 saves and keeps the comments', async () => {
  const ctx = await boot();
  await importMain(ctx);
  const radio = ctx.$('[data-rv-when="any"]');
  radio.checked = true; radio.dispatchEvent(new ctx.host.w.Event('input', { bubbles: true })); await tick(); await tick();
  // 第四批：「全部加入意见」在问题标题旁边；标题上的「问题 N」跳到有问题的页
  await ctx.click('[data-act="rv-first-issue"]');
  await ctx.click('[data-act="rv-fill-all"]');
  assert.match(ctx.$('[data-act="rv-send"]').textContent, /发送意见（2页）/);
  assert.ok(ctx.$('[data-act="rv-send"]').classList.contains('is-primary'), 'send is the main button while comments are pending');
  ctx.$('.pi-rv-foot [data-act="import-adopt"]').click(); await tick();
  let text = await answer(ctx.doc, '取消');
  assert.match(text, /有2页意见尚未用于修改草稿[\s\S]*仍然保存[\s\S]*先发送/);
  assert.equal(ctx.inst.data.project(ctx.pid).outline.volumes.length, 0);
  // 先发送 → 直接发送，不再弹发送框；发送期间不写大纲
  const calls = ctx.host.llmCalls.length;
  ctx.$('.pi-rv-foot [data-act="import-adopt"]').click(); await tick();
  await answer(ctx.doc, '先发送');
  for (let i = 0; i < 40 && ctx.host.llmCalls.length === calls; i++) await tick();
  assert.ok(ctx.host.llmCalls.length > calls, 'the request went out directly');
  for (let i = 0; i < 40 && ctx.inst.__view.busy[`review:${ctx.pid}`]; i++) await tick();
  assert.equal(ctx.doc.querySelector('.pi-dialog'), null, 'no dialog in between');
  assert.equal(ctx.inst.data.project(ctx.pid).outline.volumes.length, 0);
  // 仍然保存 → 再过一次问题确认 → 写进大纲；意见留着（GPT 第二轮 N6）
  ctx.$('.pi-rv-foot [data-act="import-adopt"]').click(); await tick();
  await answer(ctx.doc, '仍然保存');
  ctx.doc.querySelector('.pi-dialog') && (await answer(ctx.doc, '仍然保存'));
  assert.equal(ctx.inst.data.project(ctx.pid).outline.volumes.length, 1);
  const kept = jobOf(ctx).review.comments;
  assert.equal(Object.values(kept).filter((t) => String(t || '').trim()).length, 2, 'unsent notes survive the save');
  assert.match(ctx.$('.pi-rv').textContent, /有2页意见未发送/);
  // 继续修改：意见回到对应的页上
  await ctx.click('[data-act="rv-reopen"]');
  assert.match(ctx.$('[data-act="rv-send"]').textContent, /发送意见（2页）/);
  await ctx.inst.destroy();
});

test('reopen after adopt: edits stay in the draft until saved; saving keeps volume / stage ids and the line number', async () => {
  const ctx = await boot();
  await importMain(ctx);
  const radio = ctx.$('[data-rv-when="any"]');
  radio.checked = true; radio.dispatchEvent(new ctx.host.w.Event('input', { bubbles: true })); await tick(); await tick();
  ctx.$('.pi-rv-foot [data-act="import-adopt"]').click(); await tick();
  await answer(ctx.doc, '仍然保存');
  const live = ctx.inst.data.project(ctx.pid).outline.volumes[0];
  await ctx.click('[data-act="rv-reopen"]');
  await ctx.click('[data-act="rv-go"][data-i="2"]');
  const y = ctx.$('[data-rv-yaml]');
  y.value = y.value.replace('查出埃利奥特·维恩组织这笔交易', '查出是谁组织这笔交易');
  await ctx.click('[data-act="rv-yaml-save"]');
  assert.equal(ctx.inst.data.project(ctx.pid).outline.volumes[0].stages[1].data.AI指令, '查出埃利奥特·维恩组织这笔交易', 'project untouched while reviewing');
  ctx.$('.pi-rv-foot [data-act="import-adopt"]').click(); await tick();
  // 改已有的线：确认框列出最终改动（GPT 代码审阅 R8）
  assert.match(await answer(ctx.doc, '保存'), /保存到大纲[\s\S]*AI指令/);
  const after = ctx.inst.data.project(ctx.pid).outline.volumes;
  assert.equal(after.length, 1);
  assert.equal(after[0].id, live.id);
  assert.deepEqual(after[0].stages.map((s) => s.id), live.stages.map((s) => s.id));
  assert.equal(after[0].line.编号, live.line.编号);
  assert.equal(after[0].stages[1].data.AI指令, '查出是谁组织这笔交易');
  await ctx.inst.destroy();
});

test('breadcrumb: 大纲 goes straight back to the outline from the review page', async () => {
  const ctx = await boot();
  await importMain(ctx);
  await ctx.click('.pi-imp-crumb [data-act="import-close"]');
  assert.ok(ctx.$('[data-act="import-open-panel"]'), 'outline page');
  await ctx.inst.destroy();
});
