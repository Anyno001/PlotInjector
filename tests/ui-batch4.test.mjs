// 第四批界面整理（用户 2026-11-16 确认预览 开发/ui-preview/batch4.html）：审阅页页签和底部、执行页剧情线两层、导入页、大纲编辑紧凑字段。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

async function helpers(name, names, extra = (s) => s.split('\ntest(')[0]) {
  let text = extra(fs.readFileSync(new URL(name, import.meta.url), 'utf8'));
  text = text.replace("'./host-sim.mjs'", JSON.stringify(new URL('./host-sim.mjs', import.meta.url).href)).replace("'./load.mjs'", JSON.stringify(new URL('./load.mjs', import.meta.url).href));
  return import(`data:text/javascript,${encodeURIComponent(`${text}\nexport { ${names} };`)}`);
}
const DE = await helpers('./discuss-edit.test.mjs', 'boot, openReview, goPage, clueVols');
const ML = await helpers('./multi-line-b.test.mjs', 'boot, MAIN, side', (s) => s.split('\ntest(')[0] + '\n' + s.slice(s.indexOf('const TB = '), s.indexOf('\ntest(', s.indexOf('const TB = '))));
const IR = await helpers('./import-review-ui.test.mjs', 'boot');

const tick = () => new Promise((r) => setTimeout(r, 30));
const job = (t) => t.inst.data.imports.get(t.inst.data.project(t.pid).imports.at(-1));

test('review page: page tabs name the pages; header says project scope; two fixed footer buttons, save greys out when in sync; 全部加入意见 sits by the issues', async () => {
  const t = await DE.boot(DE.clueVols(), 'clue', false);
  try {
    await DE.openReview(t, 'v1');
    const tabs = [...t.doc.querySelectorAll('.pi-rv-dots .pi-rv-dot')].map((b) => b.textContent);
    assert.deepEqual(tabs, ['线信息', '阶段1 开头', '阶段2 中段', '阶段3 收尾']);
    assert.ok(!t.doc.querySelector('.pi-rv-nav .pi-btn'), 'no prev / next buttons');
    assert.match(t.doc.querySelector('.pi-rv-state').textContent, /本项目2条线，和大纲一致/);
    const foot = [...t.doc.querySelectorAll('.pi-rv-foot .pi-btn')];
    assert.deepEqual(foot.map((b) => b.dataset.act), ['rv-send', 'import-adopt'], 'send left, save right');
    assert.ok(foot[1].disabled && /已与大纲一致/.test(foot[1].textContent));
    assert.ok(!t.doc.querySelector('.pi-rv-foot [data-act="rv-fill-all"]'), '全部加入意见 is not in the footer');
    // 改一处：保存变成主按钮，状态写待保存
    await t.blur('[data-rv-line="简介"]', '新简介');
    const save = t.doc.querySelector('[data-act="import-adopt"]');
    assert.ok(!save.disabled && save.classList.contains('is-primary'));
    assert.match(save.textContent, /保存到大纲（1条线）/);
    assert.match(t.doc.querySelector('.pi-rv-state').textContent, /1条待保存/);
    // 写了意见：发送是主按钮，位置不变
    await DE.goPage(t, 1);
    await t.blur('[data-rv-comment]', '意见');
    t.inst.__view.renderBody(); await tick();
    const foot2 = [...t.doc.querySelectorAll('.pi-rv-foot .pi-btn')];
    assert.deepEqual(foot2.map((b) => b.dataset.act), ['rv-send', 'import-adopt']);
    assert.ok(foot2[0].classList.contains('is-primary') && !foot2[1].classList.contains('is-primary'));
  } finally { await t.inst.destroy(); }
});

test('run page: each line is two rows (name + actions, then type / state); actions are right-aligned in their own box; ⋯ is grouped with 放弃 in red', async () => {
  const { host, inst } = await ML.boot(2, [ML.MAIN(), ML.side('S01'), ML.side('S02')]);
  try {
    inst.open(); await tick();
    const doc = host.w.document;
    doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
    const rows = [...doc.querySelectorAll('.pi-line-row')];
    assert.ok(rows.length >= 3);
    for (const r of rows) {
      assert.ok(r.querySelector('.pi-line-head > .pi-line-name') && r.querySelector('.pi-line-head > .pi-line-acts'), 'name + action box on the first row');
      assert.ok(r.querySelector('.pi-line-tags .pi-badge'), 'type / state on the second row');
      assert.ok(!r.querySelector('.pi-line-head .pi-badge'), 'no badges squeezed next to the name');
    }
    const m1 = rows.find((r) => r.dataset.lineRow === 'M1');
    const groups = [...m1.querySelectorAll('.pi-line-menu-g')];
    assert.ok(groups.length >= 2, 'menu has groups');
    const abandon = m1.querySelector('.pi-line-menu [data-value="abandon"]');
    abandon && assert.ok(abandon.classList.contains('is-danger'), '放弃 in red');
  } finally { await inst.destroy(); }
});

test('run page: no database → stated once in 需要处理 (progress kept); scene card only says 数据库未连接', async () => {
  const { host, inst } = await ML.boot(2, [ML.MAIN(), ML.side('S01')]);
  try {
    delete host.w.AutoCardUpdaterAPI;
    inst.runtime.clue.invalidate();
    inst.open(); await tick();
    const doc = host.w.document;
    doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
    const text = doc.querySelector('.pi-body').textContent;
    assert.match(text, /没有检测到数据库插件/, 'the no-database problem is shown');
    assert.equal((text.match(/没有检测到数据库插件/g) || []).length, 1, 'said once');
    assert.match(text, /剧情线的进度不受影响/);
    assert.match(text, /本轮注入内容为空/);
  } finally { await inst.destroy(); }
});

test('import page: 推进方式 is a select; 文档内容 uses 多条支线 with short neutral notes; text box is short', async () => {
  const ctx = await IR.boot();
  try {
    await ctx.click('[data-act="import-open-panel"]');
    const card = ctx.$('.pi-card');
    assert.ok(ctx.$('select[data-imp-modesel]'), '推进方式 select');
    assert.ok(!ctx.$('[data-act="import-mode"]'), 'no 改 toggle');
    assert.match(card.textContent, /文档内容/);
    assert.doesNotMatch(card.textContent, /这份文档是|这个项目现在用的|整理成/);
    const kinds = [...ctx.doc.querySelectorAll('.pi-imp-kind-btn')].map((b) => b.textContent);
    assert.deepEqual(kinds, ['一条主线一段完整的主线剧情', '一条支线一段独立的支线剧情', '多条支线多段支线剧情，逐条整理']);
    assert.ok(ctx.$('[data-imp-text]').classList.contains('pi-imp-text'));
    assert.ok(!ctx.$('[data-imp-text]').classList.contains('is-tall'));
  } finally { await ctx.inst.destroy(); }
});

test('outline editor: no 保存 button, no auto-save explanation; 阶段名 / 时间范围 and 名称 / 地点 side by side; 必需 pill toggles; empty conditions folded with a summary', async () => {
  const vols = DE.clueVols();
  const t = await DE.boot(vols, 'clue', false);
  try {
    await t.click('[data-act="tab"][data-tab="outline"]');
    await t.click('[data-act="sel"][data-id="s1"]');
    const body = t.doc.querySelector('.pi-body');
    assert.ok(!body.querySelector('[data-act="outline-save"]'), 'no 保存 button');
    assert.doesNotMatch(body.textContent, /修改自动保存/, 'auto-save explanation removed');
    assert.doesNotMatch(body.textContent, /（阶段N_标题）|（用来判断何时切到下一段）|（不注入）|（开放后告诉正文可以去做）/, 'no bracketed notes in labels');
    assert.ok(body.querySelector('[data-stage-key]'));
    const aiFold = body.querySelector('.pi-fold [data-stage-field="时间范围"]').closest('.pi-fold');
    assert.ok(!aiFold.open, 'empty AI指令 / 时间范围 folded');
    const fold = [...body.querySelectorAll('.pi-fold')].find((d) => /进入 \/ 结束条件/.test(d.textContent));
    assert.match(fold.textContent, /进入 \/ 结束条件都未填写/);
    assert.ok(!fold.open, 'empty conditions folded');
    assert.ok(body.querySelector('.pi-pair2 [data-k="名称"]') && body.querySelector('.pi-pair2 [data-k="地点"]'));
    const pill = body.querySelector('[data-act="node-req"]');
    assert.equal(pill.textContent, '必需');
    pill.click(); await tick();
    const node = () => t.inst.data.project(t.pid).outline.volumes[0].stages[0].data.主线节点[0];
    assert.equal(node().必需, false, 'main node → 可选 writes 必需: false');
    assert.equal(t.doc.querySelector('[data-act="node-req"]').textContent, '非必需');
    t.doc.querySelector('[data-act="node-req"]').click(); await tick();
    assert.ok(!('必需' in node()), 'back to default removes the key');
    // 线索条件：写了内容 → 展开并有摘要
    const cond = [...t.doc.querySelectorAll('.pi-node .pi-fold')].find((d) => /线索条件/.test(d.textContent));
    assert.ok(cond.open);
    assert.match(cond.querySelector('summary').textContent, /完成：拿到 ?F1；获得 ?F1/);
  } finally { await t.inst.destroy(); }
});
