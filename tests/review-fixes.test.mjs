// GPT 代码审阅（2026-11-16，R1–R8）的回归测试：都写成「正确行为」。
// 复现场景改自 GPT 的诊断脚本（开发/审阅意见/验证_导入审阅与改大纲_2026-11-16/review-probes.mjs）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import fs from 'node:fs';

// 借用两份界面测试文件里第一条 test 之前的辅助函数（不连带跑它们的测试）
async function helpers(name, names) {
  let text = fs.readFileSync(new URL(name, import.meta.url), 'utf8').split('\ntest(')[0];
  text = text.replace("'./host-sim.mjs'", JSON.stringify(new URL('./host-sim.mjs', import.meta.url).href));
  return import(`data:text/javascript,${encodeURIComponent(`${text}\nexport { ${names} };`)}`);
}
const DE = await helpers('./discuss-edit.test.mjs', 'boot, openReview, goPage, clueVols, outlineVols, REPLY, S3_ONLY');
const IR = await helpers('./import-review-ui.test.mjs', 'boot, importMain, answer, jobOf, sendRevise, DRAFT');

const C = loadCore();
const tick = () => new Promise((r) => setTimeout(r, 30));
const job = (t) => t.inst.data.imports.get(t.inst.data.project(t.pid).imports.at(-1));
const live = (t) => t.inst.data.project(t.pid).outline.volumes;
function observe(t) {
  const toasts = [];
  for (const k of ['info', 'success', 'warning', 'error']) t.host.w.toastr[k] = (m) => toasts.push(`${k}:${m}`);
  return toasts;
}
async function done(t) { for (let i = 0; i < 100 && t.inst.__view.busy[`review:${t.pid}`]; i++) await tick(); await tick(); }
const editYaml = async (t, from, to) => {
  const box = t.doc.querySelector('[data-rv-yaml]');
  assert.ok(from instanceof RegExp ? from.test(box.value) : box.value.includes(from), `yaml has ${from}`);
  box.value = box.value.replace(from, to);
  await t.click('[data-act="rv-yaml-save"]');
};

// ---------- R1：是否有改动按完整内容判断，摘要只是给人看的 ----------
test('R1: changes the summary does not name (事件 / 偏转 / 触发 / 时间范围 / 状态变化 / 世界动态 / 卷名 / 顺序) are listed and detected; untouched = no change', () => {
  const st = (data) => ({ id: 's', key: '阶段一_报案', data });
  const base = { 时间范围: '第一天', 主线节点: [{ 名称: '甲', 事件: '报案' }, { 名称: '乙', 事件: '询问' }], 支线事件: [{ 名称: '猫', 触发: '去后巷' }] };
  const cases = [
    [{ ...base, 主线节点: [{ 名称: '甲', 事件: '撤回报案' }, base.主线节点[1]] }, /「甲」的事件改了/],
    [{ ...base, 主线节点: [{ 名称: '甲', 事件: '报案', 偏转: '有人插手' }, base.主线节点[1]] }, /「甲」的偏转改了/],
    [{ ...base, 支线事件: [{ 名称: '猫', 触发: '去码头' }] }, /「猫」的触发改了/],
    [{ ...base, 时间范围: '第二天' }, /时间范围改了/],
    [{ ...base, 状态变化: ['店被封'] }, /状态变化改了/],
    [{ ...base, 世界动态: ['下雨'] }, /世界动态改了/],
    [{ ...base, 主线节点: [base.主线节点[1], base.主线节点[0]] }, /节点顺序改了/],
  ];
  for (const [data, want] of cases) {
    const ch = C.stageChanges(st(base), st(data));
    assert.ok(ch.some((x) => want.test(x)), `${want} in ${JSON.stringify(ch)}`);
  }
  // 键顺序不同不算改动
  assert.deepEqual(C.stageChanges(st(base), st({ 主线节点: base.主线节点.map((n) => ({ 事件: n.事件, 名称: n.名称 })), 时间范围: '第一天', 支线事件: base.支线事件 })), []);
  // 卷名、阶段顺序
  const v = { id: 'v', key: '剧情_卷一_小镇', stages: [{ id: 'a', key: 'A', data: {} }, { id: 'b', key: 'B', data: {} }] };
  assert.ok(C.draftChanges([v], [{ ...v, key: '剧情_卷一_大城' }])[0].changes.some((x) => /名称/.test(x)));
  assert.ok(C.draftChanges([v], [{ ...v, stages: [v.stages[1], v.stages[0]] }])[0].changes.includes('阶段顺序改了'));
  assert.equal(C.draftDiffers([v], [JSON.parse(JSON.stringify(v))]), false);
  assert.equal(C.draftDiffers([v], [{ ...v, stages: [v.stages[1], v.stages[0]] }]), true);
});

test('R1: outline-mode review that only changes a node 事件 saves to the outline (UI)', async () => {
  const t = await DE.boot(DE.outlineVols(), 'outline', false); const toasts = observe(t);
  try {
    await DE.openReview(t, 'o1');
    // 真的没改：保存按钮灰着，写「已与大纲一致」（第四批）
    assert.ok(t.doc.querySelector('[data-act="import-adopt"]').disabled);
    assert.match(t.doc.querySelector('[data-act="import-adopt"]').textContent, /已与大纲一致/);
    toasts.length = 0;
    await editYaml(t, '老板娘报案', '老板娘撤回报案');
    assert.equal(job(t).review.draft[0].stages[0].data.主线节点[0].事件, '老板娘撤回报案');
    await t.click('[data-act="import-adopt"]');
    const dlg = t.doc.querySelector('.pi-dialog');
    assert.ok(dlg, 'save confirmation shown');
    assert.match(dlg.textContent, /事件改了/);
    await t.dlgBtn('保存');
    assert.equal(live(t)[0].stages[0].data.主线节点[0].事件, '老板娘撤回报案');
    assert.ok(!toasts.some((x) => x.includes('没有要保存')));
  } finally { await t.inst.destroy(); }
});

// ---------- R2：改已有线时，打开审阅以后大纲里的新改动不能被悄悄盖掉（导入重新审阅、讨论审阅修改同一规则）----------
async function staleScenario(t, toasts) {
  const y = t.$('[data-rv-yaml]');
  y.value = y.value.replace('查出埃利奥特·维恩组织这笔交易', '查出是谁组织这笔交易');
  await t.click('[data-act="rv-yaml-save"]');
  t.inst.data.updateProject(t.pid, (p) => ({ ...p, outline: { ...p.outline, volumes: p.outline.volumes.map((v) => ({ ...v, line: { ...v.line, 简介: '大纲页刚刚手动更新的新简介' } })) } }));
  await t.click('[data-act="import-adopt"]');
  const text = await IR.answer(t.doc, '取消');
  assert.match(text, /已有新改动/);
  assert.match(text, /简介/, 'lists what changed elsewhere');
  assert.equal(live(t)[0].line.简介, '大纲页刚刚手动更新的新简介', 'cancel keeps the newer edit');
  assert.match(JSON.stringify(job(t).review.draft), /查出是谁组织这笔交易/, 'draft kept');
}
test('R2: reopened imported review does not silently overwrite a newer outline edit; other lines changing does not block', async () => {
  const t = await IR.boot(); const toasts = observe(t);
  try {
    await IR.importMain(t);
    const radio = t.$('[data-rv-when="any"]'); radio.checked = true; radio.dispatchEvent(new t.host.w.Event('input', { bubbles: true })); await tick();
    await t.click('[data-act="import-adopt"]'); if (t.doc.querySelector('.pi-dialog')) await IR.answer(t.doc, '仍然保存');
    await t.click('[data-act="rv-reopen"]'); await t.click('[data-act="rv-go"][data-i="2"]');
    await staleScenario(t, toasts);
    // 只有别的线变了：不拦
    t.inst.data.updateProject(t.pid, (p) => ({ ...p, outline: { ...p.outline, volumes: [...p.outline.volumes.map((v) => ({ ...v, line: { ...v.line, 简介: job(t).review.base[0].line.简介 } })), { id: 'other', key: '剧情_卷X', stages: [] }] } }));
    await t.click('[data-act="import-adopt"]');
    const txt = await IR.answer(t.doc, '保存');
    assert.doesNotMatch(txt, /已有新改动/);
    assert.match(JSON.stringify(live(t)[0]), /查出是谁组织这笔交易/);
  } finally { await t.inst.destroy(); }
});

// ---------- R3：等回复期间新写的意见不被旧回复清掉 ----------
test('R3: a comment rewritten while waiting survives the old reply; an unchanged comment is cleared', async () => {
  const t = await DE.boot(DE.clueVols(), 'clue', false); const toasts = observe(t);
  try {
    await DE.openReview(t, 'v1'); await DE.goPage(t, 3);
    await t.blur('[data-rv-comment]', '入口改成码头');
    let release; t.host.llm.respond = () => new Promise((r) => (release = r));
    await t.click('[data-act="rv-preview"]'); await t.dlgBtn('发送');
    assert.ok(release, 'request in flight');
    await t.blur('[data-rv-comment]', '补充新意见：同时让船长在场');
    release(DE.S3_ONLY); await done(t);
    assert.match(job(t).review.draft[0].stages[2].data.主线节点[0].入口, /码头/, 'reply applied');
    assert.equal(job(t).review.comments['v1/s3'], '补充新意见：同时让船长在场', 'new comment kept');
    assert.ok(toasts.some((x) => /新写的意见，还没发送/.test(x)));
    // 意见没动：照常清掉
    await t.blur('[data-rv-comment]', '入口再改成码头');
    t.host.llm.respond = null; t.host.llm.reply = DE.S3_ONLY.replace('去码头找n3', '去码头仓库找n3');
    await t.click('[data-act="rv-preview"]'); await t.dlgBtn('发送'); await done(t);
    assert.equal(job(t).review.comments['v1/s3'], '');
  } finally { await t.inst.destroy(); }
});

// ---------- R4：整体意见没读到任何可用结果 → 不清意见、不报成功 ----------
test('R4: overall comment with an unusable reply (prose / empty / 保持原样) keeps the comment and is not reported as success', async () => {
  const t = await DE.boot(DE.clueVols(), 'clue', false); const toasts = observe(t);
  try {
    await DE.openReview(t, 'v1');
    const before = JSON.stringify(job(t).review.draft);
    for (const reply of ['好的，我已经修改了。', '', '保持原样：原文就是当铺\n【单位：v1/s3】\n```yaml\n阶段3_收尾: [坏格式\n```']) {
      toasts.length = 0;
      await t.click('[data-act="rv-preview"]');
      t.doc.querySelector('[data-rv-overall]').value = '把第三阶段的入口改为码头';
      t.host.llm.reply = reply;
      await t.dlgBtn('发送'); await done(t);
      assert.equal(job(t).review.overall, '把第三阶段的入口改为码头', `kept for ${JSON.stringify(reply)}`);
      assert.equal(JSON.stringify(job(t).review.draft), before);
      assert.ok(!toasts.some((x) => x.startsWith('success:')), toasts.join('|'));
      assert.ok(toasts.some((x) => /没有读到修改结果|修改中断/.test(x)), toasts.join('|'));
    }
  } finally { await t.inst.destroy(); }
});

// ---------- R5：整体意见只交回一页，把没交回的页的引用改断 → 不采用、说明要一起改 ----------
test('R5: an overall reply that renames a fact a returned-less page still uses is held back; an independent edit is accepted', async () => {
  const vols = DE.clueVols().slice(0, 1); vols[0].stages[1].data.进入条件 = { 事实: 'F1' };
  const t = await DE.boot(vols, 'clue', false); const toasts = observe(t);
  try {
    await DE.openReview(t, 'v1');
    const send = async (overall, reply) => {
      toasts.length = 0;
      await t.click('[data-act="rv-preview"]');
      t.doc.querySelector('[data-rv-overall]').value = overall;
      t.host.llm.reply = reply;
      await t.dlgBtn('发送'); await done(t);
    };
    await send('将 F1 统一改为 F_new，同时修改相关条件', '【单位：v1/s1】\n```yaml\n阶段1_开头:\n  主线节点:\n    - {id: n1, 名称: n1名, 入口: 去n1, 发现: [{事实: F_new, 内容: F1内容}], 完成条件: {事实: F_new}}\n```');
    const d = job(t).review.draft;
    assert.equal(d[0].stages[0].data.主线节点[0].发现[0].事实, 'F1', 'not applied');
    assert.equal(job(t).review.overall, '将 F1 统一改为 F_new，同时修改相关条件');
    assert.ok(toasts.some((x) => /阶段2[\s\S]*F1[\s\S]*一起改/.test(x)), toasts.join('|'));
    assert.ok(!toasts.some((x) => x.startsWith('success:')));
    // 只改入口文字，阶段 2 不用动：照常成功
    await send('第一阶段入口写得更具体', '【单位：v1/s1】\n```yaml\n阶段1_开头:\n  主线节点:\n    - {id: n1, 名称: n1名, 入口: 去n1的店铺后门, 发现: [{事实: F1, 内容: F1内容}], 完成条件: {事实: F1}}\n```');
    assert.equal(job(t).review.draft[0].stages[0].data.主线节点[0].入口, '去n1的店铺后门');
    assert.equal(job(t).review.overall, '');
    assert.ok(toasts.some((x) => x.startsWith('success:已修改 1 页')), toasts.join('|'));
  } finally { await t.inst.destroy(); }
});

// ---------- R6：引用了别的线的节点时，请求带上那个节点的真实条件（只读），别的无关内容不带 ----------
test('R6: reviewing a side line that depends on a main-line node sends that node (with its completion fact) read-only; unrelated stages are not sent; replies for it are ignored', async () => {
  const t = await DE.boot(DE.clueVols(), 'clue', false);
  try {
    await DE.openReview(t, 'vS'); await DE.goPage(t, 1);
    await t.blur('[data-rv-comment]', '核对和 n3 的衔接，保留前置要求');
    t.host.llm.reply = '【单位：v1/s3】\n```yaml\n阶段3_收尾:\n  主线节点:\n    - {id: n3, 名称: 被改了, 入口: x, 发现: [{事实: F3, 内容: y}], 完成条件: {事实: F3}}\n```';
    await t.click('[data-act="rv-preview"]'); await t.dlgBtn('发送'); await done(t);
    const prompt = t.host.llmCalls.at(-1).body;
    assert.match(prompt, /相关的其他部分（只读/);
    assert.match(prompt, /F3/, 'n3 completion fact included');
    assert.doesNotMatch(prompt, /n1名|阶段1_开头/, 'unrelated main-line stage not sent');
    assert.equal(live(t)[0].stages[2].data.主线节点[0].名称, 'n3名', 'other line never written');
  } finally { await t.inst.destroy(); }
});

// ---------- R7：按阶段推进的项目即使保留了旧线头，也按按阶段推进显示和发请求 ----------
test('R7: an outline-mode project with a leftover line head shows no line page and sends outline rules; clue projects keep the line page', async () => {
  const vols = DE.outlineVols(); vols[0].line = { 编号: 'M1', 类型: '主线', 简介: '保留旧线头' };
  const t = await DE.boot(vols, 'outline', false);
  try {
    await DE.openReview(t, 'o1');
    assert.equal(t.doc.querySelectorAll('.pi-rv-dot').length, 2, 'no line page');
    assert.equal(job(t).review.mode, 'outline');
    await DE.goPage(t, 0);
    await t.blur('[data-rv-comment]', '给报案事件补一句对话');
    t.host.llm.reply = '没有修改';
    await t.click('[data-act="rv-preview"]'); await t.dlgBtn('发送'); await done(t);
    const prompt = t.host.llmCalls.at(-1).body;
    assert.doesNotMatch(prompt, /完成条件必须写/);
    assert.doesNotMatch(prompt, /【单位：o1\/line】/);
    // 旧线头还在（切回线索推进时要用）
    assert.deepEqual(live(t)[0].line, { 编号: 'M1', 类型: '主线', 简介: '保留旧线头' });
  } finally { await t.inst.destroy(); }
  const t2 = await DE.boot(DE.clueVols(), 'clue', false);
  try {
    await DE.openReview(t2, 'v1');
    assert.equal(t2.doc.querySelectorAll('.pi-rv-dot').length, 4, 'line page + 3 stages');
    assert.equal(job(t2).review.mode, 'clue');
  } finally { await t2.inst.destroy(); }
});

test('keepReasons reads 保持原样 before the marker or between marker and block', () => {
  assert.deepEqual(C.keepReasons('保持原样：原文要求两样都到手\n【单位：v1/s2】\n```yaml\na: 1\n```\n【单位：v1/s3】保持原样：不需要改\n```yaml\nb: 1\n```'), { 'v1/s2': '原文要求两样都到手', 'v1/s3': '不需要改' });
  assert.deepEqual(C.keepReasons('【单位：v1/s2】\n```yaml\na: 1\n```'), {});
});

// ---------- R8：保存前的确认框写出对剧情进度的影响（按这个聊天的进度算好的最终结果）----------
test('R8: the save confirmation shows the progress effect (a node becomes done directly); cancel writes nothing', async () => {
  const t = await DE.boot(DE.clueVols().slice(0, 1), 'clue', false);
  try {
    const compute = t.inst.runtime.clue.compute;
    const snap = { facts: new Map([['F1', { id: 'F1', status: 'confirmed', text: '', raw: '已核实' }]]), knowledge: [], tables: {}, problems: [] };
    const prog = C.emptyClueProgress(), config = C.normalizeClue({ mode: 'clue' });
    t.inst.runtime.clue.compute = () => { const c = compute(); return { ...c, snap, prog, state: C.computeClueState(C.compileClue(live(t)), snap, prog, config) }; };
    await DE.openReview(t, 'v1'); await DE.goPage(t, 2);
    await editYaml(t, /(完成条件:\s*\n\s*事实:) F2/, '$1 F1');
    assert.equal(job(t).review.draft[0].stages[1].data.主线节点[0].完成条件.事实, 'F1');
    await t.click('[data-act="import-adopt"]');
    const text = [...t.doc.querySelectorAll('.pi-dialog')].pop().textContent;
    assert.match(text, /按这个聊天的进度/);
    assert.match(text, /直接变成已完成|调查会被跳过/);
    await t.dlgBtn('取消');
    assert.equal(live(t)[0].stages[1].data.主线节点[0].完成条件.事实, 'F2', 'cancel writes nothing');
    assert.equal(job(t).review.draft[0].stages[1].data.主线节点[0].完成条件.事实, 'F1', 'draft kept');
    await t.click('[data-act="import-adopt"]'); await t.dlgBtn('保存');
    assert.equal(live(t)[0].stages[1].data.主线节点[0].完成条件.事实, 'F1');
  } finally { await t.inst.destroy(); }
});

// ---------- 按阶段推进的导入追加：先记大纲历史 ----------
test('outline-mode import append writes outline history first', async () => {
  const t = await DE.boot(DE.outlineVols(), 'outline', false);
  try {
    await t.click('[data-act="tab"][data-tab="outline"]');
    t.host.llm.respond = (body) => (/整理作者索引/.test(body) ? '```yaml\n梗概: x\n人物: []\n```' : '```yaml\n剧情_卷二_港口:\n  阶段一_到港:\n    时间范围: 第三天\n    主线节点:\n      - {名称: 下船, 地点: 码头, 事件: 有人跟踪}\n```');
    await t.click('[data-act="import-open-panel"]');
    t.doc.querySelector('[data-imp-mode]').value = 'outline';
    t.doc.querySelector('[data-imp-text]').value = '## 第三天\n到港。';
    await t.click('[data-act="import-start"]');
    for (let i = 0; i < 60 && !t.doc.querySelector('[data-imp-pick]'); i++) await tick();
    assert.ok(t.doc.querySelector('[data-imp-pick]'), 'stage picker shown');
    await t.click('[data-act="import-adopt"]');
    if (t.doc.querySelector('.pi-dialog')) await t.dlgBtn('仍然追加');
    assert.equal(live(t).length, 2);
    assert.equal(t.inst.data.project(t.pid).outline.history.at(-1).label, '导入追加阶段');
  } finally { await t.inst.destroy(); }
});

// ---------- 界面审阅第 3 条：顶上那行路径写当前位置（大纲 › 审阅修改），右边「返回讨论」----------
test('UI: 审阅修改 opened from the discussion page shows 大纲 › 审阅修改 with a 返回讨论 button; both go where they say', async () => {
  const t = await DE.boot(DE.clueVols(), 'clue', false);
  try {
    await DE.openReview(t, 'v1');
    const crumb = t.doc.querySelector('.pi-imp-crumb');
    assert.match(crumb.textContent.replace(/\s+/g, ''), /^大纲›审阅修改返回讨论$/);
    assert.equal(t.doc.querySelector('.pi-tab.is-sel').dataset.tab, 'outline', 'the outline tab is lit, matching the path');
    const back = [...crumb.querySelectorAll('button')].find((b) => b.textContent === '返回讨论');
    back.click(); await tick();
    assert.ok(t.doc.querySelector('[data-act="review-pick"]'), 'back on the discussion page');
    await DE.openReview(t, 'v1');
    [...t.doc.querySelectorAll('.pi-imp-crumb button')].find((b) => b.textContent === '大纲').click(); await tick();
    assert.ok(!t.doc.querySelector('.pi-rv') && t.doc.querySelector('[data-act="import-open-panel"]'), 'back on the outline page');
  } finally { await t.inst.destroy(); }
});

// ---------- 界面整理第一批（用户 2026-11-16 看过预览）----------
test('batch1: same-cause issues on one page merge into one card listing the nodes; fill adds one line naming them all', () => {
  const issue = (node, id) => ({ level: 'error', kind: 'route', id, stageId: 's5', text: `t-${node}`, plain: `「阶段5」：「${node}」一直开不了`, fix: 'f', same: { key: 'open-never', stage: '阶段5', node } });
  const merged = C.mergeSameIssues([issue('甲', 'a'), issue('乙', 'b'), { level: 'error', kind: 'x', id: 'c', plain: '别的问题' }, issue('丙', 'd')]);
  assert.equal(merged.length, 2);
  assert.deepEqual(merged[0].names, ['甲', '乙', '丙']);
  assert.match(merged[0].plain, /下面 3 个节点一直开不了/);
  assert.match(C.issueCommentLine(merged[0]), /「甲」、「乙」、「丙」/);
  assert.equal(merged[1].plain, '别的问题');
  // 只有一条时不改
  assert.equal(C.mergeSameIssues([issue('甲', 'a')])[0].plain, '「阶段5」：「甲」一直开不了');
});

test('batch1: review page shows the draft state line and expands the full node content without YAML', async () => {
  const t = await DE.boot(DE.clueVols(), 'clue', false);
  try {
    await DE.openReview(t, 'v1');
    assert.match(t.doc.querySelector('.pi-rv-state').textContent, /和大纲一致/);
    await DE.goPage(t, 1);
    assert.ok(!t.doc.querySelector('.pi-rv-full'));
    await t.click('[data-act="rv-full"]');
    const full = t.doc.querySelector('.pi-rv-full');
    assert.ok(full, 'full content shown');
    assert.match(full.textContent, /入口[\s\S]*去n1[\s\S]*获得[\s\S]*F1内容[\s\S]*完成/);
    assert.match(t.doc.querySelector('[data-act="rv-full"]').textContent, /收起完整内容/);
    await editYaml(t, '去n1', '去n1的后门');
    assert.match(t.doc.querySelector('.pi-rv-state').textContent, /1 条待保存/);
    assert.ok(t.doc.querySelector('.pi-rv-full'), 'stays expanded across pages / edits');
    assert.doesNotMatch(t.doc.querySelector('.pi-rv').textContent, /·/, 'no middle dot on the review page');
  } finally { await t.inst.destroy(); }
});

test('batch1: discussion reply tools are one row (整理成设定 / 写新剧情线 / ⋯); ⋯ holds 编辑, 重新生成, 删除此条消息', async () => {
  const t = await DE.boot(DE.clueVols(), 'clue', false);
  try {
    const chat = await t.inst.data.loadChat(t.pid);
    await t.inst.data.saveChat(t.pid, { ...chat, messages: [{ id: 'u1', role: 'user', content: '问', at: 1 }, { id: 'a1', role: 'assistant', content: '答', at: 2 }] });
    await t.click('[data-act="tab"][data-tab="outline"]'); await t.click('[data-act="tab"][data-tab="discuss"]');
    const tools = [...t.doc.querySelectorAll('.pi-msg.is-ai .pi-msg-tools button')].map((b) => b.textContent.trim());
    assert.deepEqual(tools, ['整理成设定', '写新剧情线', '⋯']);
    await t.click('.pi-msg.is-ai [data-act="msg-more"]');
    const menu = [...t.doc.querySelectorAll('.pi-dialog .pi-menu-item')].map((b) => b.textContent.trim());
    assert.deepEqual(menu, ['编辑', '重新生成', '删除此条消息']);
    t.doc.querySelector('.pi-dialog [data-dlg-value="msg-del"]').click(); await tick();
    const dlg = [...t.doc.querySelectorAll('.pi-dialog')].pop();
    assert.match(dlg.textContent, /删除此条消息[\s\S]*只删这一条/);
    await t.dlgBtn('删除');
    assert.deepEqual((await t.inst.data.loadChat(t.pid)).messages.map((m) => m.id), ['u1'], 'only that message removed');
  } finally { await t.inst.destroy(); }
});

// ---------- 流程闭合（用户 2026-11-16）：写意见 → 发送意见 → AI 改完进草稿 → 保存到大纲 ----------
test('flow: comments on pages → 发送意见 → reply lands in the draft (pages marked, comments cleared) → 保存到大纲 writes it; nothing pending afterwards', async () => {
  const t = await DE.boot(DE.clueVols(), 'clue', false);
  try {
    await DE.openReview(t, 'v1');
    const send = () => t.doc.querySelector('[data-act="rv-preview"]');
    assert.equal(send().textContent.trim(), '发送意见', 'no comments yet: plain label');
    await DE.goPage(t, 2); await t.blur('[data-rv-comment]', '加一个码头的旁证');
    await DE.goPage(t, 3); await t.blur('[data-rv-comment]', '入口改到码头');
    assert.match(send().textContent, /发送意见（2 页）/);
    t.host.llm.reply = DE.REPLY;
    send().click(); await tick();
    const dlg = [...t.doc.querySelectorAll('.pi-dialog')].pop();
    assert.match(dlg.textContent, /发送意见[\s\S]*一次发给 AI[\s\S]*加一个码头的旁证[\s\S]*入口改到码头/);
    await t.dlgBtn('发送'); await done(t);
    const r = job(t).review;
    assert.match(JSON.stringify(r.draft), /老水手/);
    assert.match(JSON.stringify(r.draft), /去码头找n3/);
    assert.deepEqual(Object.values(r.comments).filter((x) => String(x).trim()), [], 'sent comments cleared');
    assert.equal(t.doc.querySelectorAll('.pi-rv-dot.is-chg').length + (t.doc.querySelector('.pi-rv-dot.is-cur') ? 1 : 0) >= 2, true, 'changed pages marked');
    assert.equal(send().textContent.trim(), '发送意见');
    assert.match(t.doc.querySelector('.pi-rv-state').textContent, /1 条待保存/);
    assert.equal(live(t)[0].stages[1].data.主线节点.length, 1, 'outline untouched before saving');
    await t.click('[data-act="import-adopt"]');
    const text = [...t.doc.querySelectorAll('.pi-dialog')].pop().textContent;
    assert.doesNotMatch(text, /还没发送/, 'no unsent-comment prompt');
    await t.dlgBtn('保存');
    assert.equal(live(t)[0].stages[1].data.主线节点.length, 2, 'saved into the outline');
    assert.match(t.doc.querySelector('.pi-rv-state').textContent, /和大纲一致/);
  } finally { await t.inst.destroy(); }
});

// ---------- 线的类型只在新建时选，之后程序固定（用户 2026-11-16）----------
test('type lock: AI cannot change 主线 / 支线 on an existing line (any path); a new line without a type can still get one', () => {
  const v = { id: 'v', key: '剧情_S01_x', line: { 编号: 'S01', 类型: '支线', 简介: '旧' }, stages: [] };
  // 不限字段（allow 为空）、限定字段、整条线回写，三条路都改不了
  assert.equal(C.putLine([v], 'v', { 类型: '主线', 简介: '新' })[0].line.类型, '支线');
  assert.equal(C.putLine([v], 'v', { 类型: '主线', 简介: '新' }, ['类型', '简介'])[0].line.类型, '支线');
  assert.equal(C.putLine([v], 'v', { 简介: '新' }, ['类型', '简介'])[0].line.类型, '支线', 'not deleted when the reply leaves it out');
  assert.equal(C.putVolume([v], 'v', { key: v.key, line: { 类型: '主线' }, stages: [] }).volumes[0].line.类型, '支线');
  assert.equal(C.putLine([v], 'v', { 类型: '主线', 简介: '新' })[0].line.简介, '新', 'other fields still change');
  // 新线还没有类型（导入时 AI 写出来）：可以写进去
  const fresh = { id: 'n', key: '剧情_x', line: { 简介: 'a' }, stages: [] };
  assert.equal(C.putLine([fresh], 'n', { 类型: '主线' })[0].line.类型, '主线');
  // 提示词写明不能改
  const msg = C.reviewReviseMessages({ units: [{ key: 'v/line', label: '线', yaml: 'x', comment: 'y' }] })[0].content;
  assert.match(msg, /编号、类型（主线 \/ 支线）不能改/);
});

// ---------- 第二批：一个审阅修改任务里是项目所有的线（外层选线，内层翻页），保存只写有修改的线 ----------
test('batch2: 审阅修改 holds every line; the picker switches lines and pages are per line; saving writes only changed lines; outline page entries open the same session', async () => {
  const t = await DE.boot(DE.clueVols(), 'clue', false);
  try {
    await DE.openReview(t, 'v1');
    assert.equal(job(t).review.draft.length, 2, 'all lines in one session');
    assert.match(t.doc.querySelector('.pi-rv-lname').textContent, /M1[\s\S]*1 \/ 2/);
    assert.equal(t.doc.querySelectorAll('.pi-rv-dots .pi-rv-dot').length, 4, 'only M1 pages');
    // 换到 S01：页码只列 S01 的页
    await t.click('.pi-rv-line [title="下一条"]');
    assert.match(t.doc.querySelector('.pi-rv-lname').textContent, /S01[\s\S]*2 \/ 2/);
    assert.equal(t.doc.querySelectorAll('.pi-rv-dots .pi-rv-dot').length, 2, 'S01: line page + 1 stage');
    // S01 线页上改简介：写到 S01，不是 M1
    await t.blur('[data-rv-line="简介"]', 'S01 的新简介');
    assert.equal(job(t).review.draft[1].line.简介, 'S01 的新简介');
    assert.equal(job(t).review.draft[0].line.简介, '旧简介');
    assert.match(t.doc.querySelector('.pi-rv-state').textContent, /本项目 2 条线，1 条待保存/);
    assert.match(t.doc.querySelector('[data-act="import-adopt"]').textContent, /保存到大纲（1 条线）/);
    // 选线列表
    await t.click('[data-act="rv-lines"]');
    const items = [...t.doc.querySelectorAll('.pi-dialog .pi-menu-item')].map((b) => b.textContent);
    assert.equal(items.length, 2);
    assert.match(items[1], /S01[\s\S]*已修改/);
    t.doc.querySelector('.pi-dialog [data-dlg-value="v1"]').click(); await tick(); await tick();
    assert.match(t.doc.querySelector('.pi-rv-lname').textContent, /M1/);
    // 保存：只写 S01；M1 没动
    const m1 = JSON.stringify(live(t)[0]);
    await t.click('[data-act="import-adopt"]');
    const text = [...t.doc.querySelectorAll('.pi-dialog')].pop().textContent;
    assert.match(text, /简介/);
    await t.dlgBtn('保存');
    assert.equal(live(t)[1].line.简介, 'S01 的新简介');
    assert.equal(JSON.stringify(live(t)[0]), m1, 'unchanged line not rewritten');
    assert.match(t.doc.querySelector('.pi-rv-state').textContent, /和大纲一致/);
    // 大纲页的入口：顶部「审阅修改…」、选中线的「审阅修改」打开同一个任务
    await t.click('.pi-imp-crumb [data-act="import-close"]');
    assert.ok(t.doc.querySelector('[data-act="review-open"]'), 'outline top entry');
    assert.ok(!t.doc.querySelector('[data-act="lines-open"]'), 'old 剧情线… entry gone');
    const n = t.inst.data.project(t.pid).imports.length;
    await t.click('[data-act="review-open"]');
    assert.ok(t.doc.querySelector('.pi-rv'));
    assert.equal(t.inst.data.project(t.pid).imports.length, n, 'reuses the same 审阅修改 task');
  } finally { await t.inst.destroy(); }
});

test('batch2: a line changed elsewhere is listed with its name; other lines changing in the outline do not block; a line added to the outline later joins the session', async () => {
  const t = await DE.boot(DE.clueVols(), 'clue', false);
  try {
    await DE.openReview(t, 'vS');
    await t.blur('[data-rv-line="简介"]', 'S01 草稿简介');
    t.inst.data.updateProject(t.pid, (p) => ({ ...p, outline: { ...p.outline, volumes: p.outline.volumes.map((v) => (v.id === 'vS' ? { ...v, line: { ...v.line, 入口提示: '别处加的入口' } } : v)) } }));
    await t.click('[data-act="import-adopt"]');
    let text = [...t.doc.querySelectorAll('.pi-dialog')].pop().textContent;
    assert.match(text, /已有新改动[\s\S]*S01[\s\S]*入口/);
    await t.dlgBtn('取消');
    assert.equal(live(t)[1].line.入口提示, '别处加的入口');
    // 新加一条线，再打开：补进来
    t.inst.data.updateProject(t.pid, (p) => ({ ...p, outline: { ...p.outline, volumes: [...p.outline.volumes, { id: 'vN', key: '剧情_S02_新线', line: { 编号: 'S02', 类型: '支线' }, stages: [] }] } }));
    await t.click('.pi-imp-crumb [data-act="import-close"]');
    await t.click('[data-act="review-open"]');
    assert.equal(job(t).review.draft.length, 3);
    assert.equal(job(t).review.draft[1].line.简介, 'S01 草稿简介', 'the draft edit survives the re-sync');
  } finally { await t.inst.destroy(); }
});
