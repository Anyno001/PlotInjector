// GPT 第二轮代码审阅（2026-11-16，N1–N8）的回归测试：都写成「正确行为」。
// 复现场景改自 GPT 的诊断脚本（开发/审阅意见/验证_审阅修复与界面整理_第二轮_2026-11-16/second-round-probes.mjs）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import fs from 'node:fs';

// 借用界面测试文件里第一条 test 之前的辅助函数（不连带跑它们的测试）
async function helpers(name, names, extra = (s) => s) {
  let text = extra(fs.readFileSync(new URL(name, import.meta.url), 'utf8'));
  text = text.replace("'./host-sim.mjs'", JSON.stringify(new URL('./host-sim.mjs', import.meta.url).href)).replace("'./load.mjs'", JSON.stringify(new URL('./load.mjs', import.meta.url).href));
  return import(`data:text/javascript,${encodeURIComponent(`${text}\nexport { ${names} };`)}`);
}
const DE = await helpers('./discuss-edit.test.mjs', 'boot, openReview, goPage, clueVols', (s) => s.split('\ntest(')[0]);
const IR = await helpers('./import-review-ui.test.mjs', 'boot, importMain, answer, jobOf', (s) => s.split('\ntest(')[0]);
// line-import：第一条 test 之前的部分 + 中间的 boot / openJob 等辅助函数
const LI = await helpers('./line-import.test.mjs', 'boot, openJob, vol, gotoLine, dlg, blur, lineJob, volOf, rvWait, curLine', (s) => {
  const head = s.split('\ntest(')[0];
  const mid = s.slice(s.indexOf('async function boot('), s.indexOf("test('UI: bulk side import"));
  const job = s.slice(s.indexOf('async function openJob('), s.indexOf("test('UI: save S01 alone"));
  return head + '\n' + mid + '\n' + job;
});

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
  assert.ok(from.test(box.value), `yaml has ${from}`);
  box.value = box.value.replace(from, to);
  await t.click('[data-act="rv-yaml-save"]');
};
const setLive = (t, id, fn) => t.inst.data.updateProject(t.pid, (p) => ({ ...p, outline: { ...p.outline, volumes: p.outline.volumes.map((v) => (v.id === id ? fn(v) : v)) } }));
const lastDialog = (t) => [...t.doc.querySelectorAll('.pi-dialog')].pop();
const waitDialog = async (t) => { for (let i = 0; i < 30 && !lastDialog(t); i++) await tick(); return lastDialog(t); };

// ---------- N1：保存、同步、撤销都只看用户实际改过的线 ----------
test('N1: saving A does not list or roll back B that was only changed elsewhere; the count ignores B', async () => {
  const t = await DE.boot(DE.clueVols(), 'clue', false);
  try {
    await DE.openReview(t, 'v1');
    await t.blur('[data-rv-line="简介"]', 'A 的新简介');
    setLive(t, 'vS', (v) => ({ ...v, line: { ...v.line, 简介: 'B 在大纲里的新简介' } }));
    t.inst.__view.renderBody(); await tick();
    assert.match(t.doc.querySelector('.pi-rv-state').textContent, /本项目2条线，1条待保存/, 'B is not counted');
    await t.click('.pi-rv-foot [data-act="import-adopt"]');
    const d0 = lastDialog(t);
    assert.equal(d0, undefined, 'B is not an overwrite target: no confirm for a plain edit ' + (d0 ? d0.textContent : ''));
    assert.equal(live(t)[0].line.简介, 'A 的新简介');
    assert.equal(live(t)[1].line.简介, 'B 在大纲里的新简介', 'B keeps the newer outline value');
  } finally { await t.inst.destroy(); }
});

test('N1: the target line changing (or being deleted) while the save confirmation is open is not overwritten; drafts stay', async () => {
  for (const kind of ['change', 'delete']) {
    const t = await DE.boot(DE.clueVols(), 'clue', false); const toasts = observe(t);
    try {
      // 保存确认只在有确定的问题（或会改动已玩进度）时才弹（11-23）：让 S01 的开启条件指向不存在的线，制造一个问题
      setLive(t, 'vS', (v) => ({ ...v, line: { ...v.line, 开启条件: { 线: 'M404 == 完成' } } }));
      await DE.openReview(t, 'v1');
      await t.blur('[data-rv-line="简介"]', 'A 草稿');
      await t.click('.pi-rv-foot [data-act="import-adopt"]');
      const dlg = await waitDialog(t);
      assert.ok(dlg, 'confirmation shown when there are problems');
      kind === 'change'
        ? setLive(t, 'v1', (v) => ({ ...v, line: { ...v.line, 简介: '确认期间别处改的' } }))
        : t.inst.data.updateProject(t.pid, (p) => ({ ...p, outline: { ...p.outline, volumes: p.outline.volumes.filter((v) => v.id !== 'v1') } }));
      await t.dlgBtn('保存');
      if (kind === 'change') assert.equal(live(t).find((v) => v.id === 'v1').line.简介, '确认期间别处改的', 'newer value not overwritten');
      else assert.ok(!live(t).some((v) => v.id === 'v1'), 'deleted line not brought back');
      assert.ok(toasts.some((x) => /确认期间大纲中这些线已被修改或删除/.test(x)), toasts.join('|'));
      assert.equal(job(t).review.draft.find((v) => v.id === 'v1').line.简介, 'A 草稿', 'draft kept');
    } finally { await t.inst.destroy(); }
  }
});

test('N1: after re-sync, undoing the A edit does not roll B back to the stale copy', async () => {
  const t = await DE.boot(DE.clueVols(), 'clue', false);
  try {
    await DE.openReview(t, 'v1');
    await t.blur('[data-rv-line="简介"]', 'A 草稿');
    await t.click('.pi-imp-crumb [data-act="import-close"]');
    setLive(t, 'vS', (v) => ({ ...v, line: { ...v.line, 简介: 'B 新稿' } }));
    await t.click('[data-act="review-open"]');
    const r = job(t).review;
    assert.equal(r.draft.find((v) => v.id === 'vS').line.简介, 'B 新稿');
    await t.click('[data-act="rv-undo"]');
    const r2 = job(t).review;
    assert.equal(r2.draft.find((v) => v.id === 'v1').line.简介, '旧简介', 'A undone');
    assert.equal(r2.draft.find((v) => v.id === 'vS').line.简介, 'B 新稿', 'B not rolled back');
    assert.equal(C.editedVolumes(r2).length, 0, 'nothing left to save');
  } finally { await t.inst.destroy(); }
});

test('N1: AI 替换剧情线 is not written when the line changed while its confirmation was open', async () => {
  const t = await DE.boot(DE.clueVols(), 'clue', true); const toasts = observe(t);
  try {
    await t.click('[data-act="tab"][data-tab="outline"]');
    await t.click('[data-act="sel"][data-id="v1"]');
    t.host.llm.reply = '```yaml\n剧情_M9_新写的:\n  线: {编号: M9, 类型: 支线}\n  阶段3_收尾:\n    主线节点:\n      - {id: n3, 名称: 收尾, 入口: 去, 发现: [{事实: F3, 内容: y}], 完成条件: {事实: F3}}\n```';
    await t.click('[data-act="ai-volume"]');
    await t.click('.pi-dialog .is-primary');
    for (let i = 0; i < 60 && !t.doc.querySelector('[data-act="draft-replace"]'); i++) await tick();
    await t.click('[data-act="draft-replace"]');
    assert.match((await waitDialog(t)).textContent, /替换/);
    setLive(t, 'v1', (x) => ({ ...x, line: { ...x.line, 简介: '确认期间改的' } }));
    await t.dlgBtn('替换');
    assert.equal(live(t)[0].line.简介, '确认期间改的');
    assert.equal(live(t)[0].stages.length, 3, 'stages not replaced');
    assert.ok(toasts.some((x) => /确认期间这条剧情线已被修改或删除/.test(x)), toasts.join('|'));
  } finally { await t.inst.destroy(); }
});

// ---------- N2：表格条件 ----------
test('N2: an incomplete table form never saves as "no condition"; > / < / 不包含 survive a value edit', async () => {
  const { inst, doc, click, pid } = await LI.boot([]);
  try {
    const cond = (op) => ({ 表: `重要角色表/巴基/阶段 ${op} 2` });
    await LI.openJob(inst, doc, click, pid, [LI.vol('S01', { 开启条件: cond('>') })]);
    assert.ok(doc.querySelector('[data-rv-when="table"]').checked, 'simple condition opens in the form');
    assert.equal(doc.querySelector('select[data-rv-tbl="op"]').value, '>', '> is offered and selected');
    await LI.blur(doc, doc.querySelector('input[data-rv-tbl="value"]'), '3');
    assert.equal(JSON.stringify(LI.lineJob(inst, pid).review.draft[0].line.开启条件), JSON.stringify({ 表: '重要角色表/巴基/阶段 > 3' }), 'operator kept');
    // 清空值：原来那条完整条件不动，保存被拦下
    await LI.blur(doc, doc.querySelector('input[data-rv-tbl="value"]'), '');
    const r = LI.lineJob(inst, pid).review;
    assert.equal(JSON.stringify(r.draft[0].line.开启条件), JSON.stringify({ 表: '重要角色表/巴基/阶段 > 3' }), 'last complete condition kept');
    assert.match(doc.querySelector('.pi-rv-tbl').textContent, /未填完/);
    const n = inst.data.project(pid).outline.volumes.length;
    await click('[data-act="import-adopt"]'); await tick();
    assert.equal(inst.data.project(pid).outline.volumes.length, n, 'not saved');
    assert.ok(!doc.querySelector('.pi-dialog'), 'no save dialog');
    for (const op of ['<', '不包含']) {
      assert.ok([...doc.querySelectorAll('select[data-rv-tbl="op"] option')].some((o) => o.value === op), `${op} offered`);
    }
  } finally { await inst.destroy(); }
});

test('N2 core: incompleteTableLines finds table-picked lines that are half filled', () => {
  const v = (line) => ({ id: 'v', key: 'k', line, stages: [] });
  assert.equal(C.incompleteTableLines([v({ 开始方式表格: true, 表格条件草稿: { table: 't' } , 开启条件: { 表: 'a/b/c >= 1' } })]).length, 1);
  assert.equal(C.incompleteTableLines([v({ 开始方式表格: true })]).length, 1);
  assert.equal(C.incompleteTableLines([v({ 开始方式表格: true, 开启条件: { 表: 'a/b/c >= 1' } })]).length, 0);
  assert.equal(C.incompleteTableLines([v({ 开启条件: { 表: 'a/b/c >= 1' } })]).length, 0);
});

// ---------- N3：整体意见只改当前这条线 ----------
test('N3: the overall comment on M1 sends M1 only, is labelled with the line, and a reply for S01 is not applied', async () => {
  const t = await DE.boot(DE.clueVols(), 'clue', false);
  try {
    await DE.openReview(t, 'v1');
    await t.click('[data-act="rv-preview"]');
    const dlg = await waitDialog(t);
    assert.match(dlg.textContent, /对M1 案子的整体意见/);
    assert.match(dlg.textContent, /只修改M1 案子[\s\S]*3个阶段/);
    dlg.querySelector('[data-rv-overall]').value = '语气轻一点';
    t.host.llm.reply = ['【单位：vS/line】', '```yaml', '线:', '  简介: 被改了', '```'].join('\n');
    const calls = t.host.llmCalls.length;
    await t.dlgBtn('发送'); await done(t);
    const body = t.host.llmCalls.slice(calls).map((c) => c.body).join('');
    assert.ok(!body.includes('vS/line') && !body.includes('vS/sS'), 'S01 is not a target');
    assert.match(body, /整体意见适用/);
    assert.equal(live(t)[1].line.简介, undefined);
    assert.equal(job(t).review.draft.find((v) => v.id === 'vS').line.简介, undefined, 'S01 untouched');
  } finally { await t.inst.destroy(); }
});

test('N3: per-page comments on other lines still go in the same request (one call), titled with the line name', async () => {
  const t = await DE.boot(DE.clueVols(), 'clue', false);
  try {
    await DE.openReview(t, 'v1');
    await DE.goPage(t, 1);
    await t.blur('[data-rv-comment]', 'M1 第一阶段的意见');
    await t.click('.pi-rv-line [title="下一条"]');
    await DE.goPage(t, 1);
    await t.blur('[data-rv-comment]', 'S01 阶段的意见');
    await t.click('[data-act="rv-preview"]');
    const dlg = await waitDialog(t);
    const titles = [...dlg.querySelectorAll('.pi-rv-q-go')].map((b) => b.textContent);
    assert.deepEqual(titles.map((x) => x.replace(/\s*›$/, '')), ['M1 案子 / 阶段1 开头', 'S01 小事 / 阶段1 x']);
    t.host.llm.reply = '好的';
    const calls = t.host.llmCalls.length;
    await t.dlgBtn('发送'); await done(t);
    assert.equal(t.host.llmCalls.length - calls, 1, 'one request');
  } finally { await t.inst.destroy(); }
});

// ---------- N4：没标记的回复、名字重复时不猜 ----------
test('N4: an unmarked block whose name matches two units is not assigned; a unique name still is', () => {
  const units = [{ key: 'vA/sA', name: '阶段1_经过' }, { key: 'vB/sB', name: '阶段1_经过' }, { key: 'vC/sC', name: '阶段2_收尾' }];
  const reply = '```yaml\n阶段1_经过:\n  AI指令: 应该是 B\n```\n```yaml\n阶段2_收尾:\n  AI指令: C\n```';
  const out = C.splitUnitReplies(reply, units);
  assert.ok(!('vA/sA' in out) && !('vB/sB' in out), 'ambiguous name not guessed');
  assert.match(out['vC/sC'], /AI指令: C/);
  // 两个线头都叫「线」
  const heads = C.splitUnitReplies('```yaml\n线:\n  简介: x\n```', [{ key: 'vA/line', name: '线' }, { key: 'vB/line', name: '线' }]);
  assert.deepEqual(Object.keys(heads), []);
  // 有标记的照常；只有一个单位时唯一的块照常
  const marked = C.splitUnitReplies('【单位：vB/sB】\n```yaml\n阶段1_经过:\n  AI指令: B\n```', units);
  assert.deepEqual(Object.keys(marked), ['vB/sB']);
  assert.deepEqual(Object.keys(C.splitUnitReplies('```yaml\n阶段1_经过: {}\n```', [units[0]])), ['vA/sA']);
  // 两个同名块（只一个单位叫这个名字）也不猜
  assert.deepEqual(Object.keys(C.splitUnitReplies('```yaml\n阶段2_收尾: {a: 1}\n```\n```yaml\n阶段2_收尾: {a: 2}\n```', units)), []);
});

// ---------- N5：已保存 / 不导入的线只读，不发给 AI；旧任务的已保存状态恢复 ----------
test('N5: a saved bulk line is read-only and its comment is never sent; drop lines too', async () => {
  const { host, inst, doc, click, pid } = await LI.boot([]);
  try {
    await LI.openJob(inst, doc, click, pid, [LI.vol('S01'), LI.vol('S02')]);
    await LI.gotoLine(doc, 'S02');
    await click('[data-act="rv-line-menu"]'); await LI.dlg(doc, 'drop');
    await click('.pi-rv-foot [data-act="import-adopt"]');
    assert.ok(!doc.querySelector('.pi-dialog'), 'no error-level issue: bulk save has no confirm');
    await LI.gotoLine(doc, 'S01');
    assert.match(doc.querySelector('.pi-rv').textContent, /已保存到大纲（S01），这里只读/);
    assert.ok(doc.querySelector('[data-act="rv-edit-saved"]'), '到大纲审阅修改');
    assert.ok(doc.querySelector('[data-rv-line="简介"]').disabled, 'inputs disabled');
    assert.ok(!doc.querySelector('[data-rv-comment]'), 'no comment box');
    assert.ok(!doc.querySelector('[data-rv-yaml]'), 'no yaml editor');
    // 就算有人塞了意见（旧数据），也不发送
    const j = LI.lineJob(inst, pid), v1 = LI.volOf(j, 'S01'), v2 = LI.volOf(j, 'S02');
    await inst.data.imports.update(j.id, (x) => ({ ...x, review: { ...x.review, comments: { [`${v1}/line`]: '旧意见', [`${v2}/line`]: '不导入线的意见' } } }));
    inst.__view.renderBody(); await tick();
    assert.equal(doc.querySelector('[data-act="rv-send"]').textContent.trim(), '发送意见', 'nothing to send');
    assert.ok(!doc.querySelector('[data-act="rv-preview"]'), 'no overall-comment entry on a saved (locked) line');
    const calls = host.llmCalls.length, said = [];
    host.w.toastr.info = (m) => said.push(m);
    await click('[data-act="rv-send"]');
    assert.match(said.join('|'), /各页还没有意见/);
    assert.ok(!doc.querySelector('.pi-dialog'), 'no dialog');
    assert.equal(host.llmCalls.length, calls, 'no API call');
    // 到大纲审阅修改：打开项目的审阅修改，定位到 S01
    await click('[data-act="rv-edit-saved"]');
    for (let i = 0; i < 20 && !/审阅修改/.test(doc.querySelector('.pi-rv h3')?.textContent || ''); i++) await tick();
    assert.match(doc.querySelector('.pi-rv h3').textContent, /审阅修改/, 'project 审阅修改 opened');
    assert.match(doc.querySelector('.pi-rv').textContent, /S01/);
  } finally { await inst.destroy(); }
});

test('N5: an old bulk job whose S01 was adopted (importLineMap only) shows S01 as saved after migration', async () => {
  const { inst, doc, click, pid } = await LI.boot([]);
  try {
    const j = await inst.data.imports.create({ projectId: pid, text: 'x', mode: 'lines', needs: '' });
    const s01 = { ...LI.vol('S01'), id: 'vLive' };
    inst.data.updateProject(pid, (p) => ({ ...p, outline: { ...p.outline, volumes: [s01] }, importLineMap: { [`${j.id}:S01`]: 'vLive' }, imports: [...(p.imports || []), j.id] }));
    await inst.data.imports.update(j.id, (x) => ({ ...x, step: 'review', lineReview: { order: ['S01', 'S02'], conflicts: [], items: { S01: { vol: LI.vol('S01'), comment: '' }, S02: { vol: LI.vol('S02'), comment: '' } } } }));
    await click('[data-act="import-open-panel"]');
    await click(`[data-act="import-open"][data-id="${j.id}"]`);
    await LI.rvWait(doc);
    for (let i = 0; i < 20 && !Object.keys(LI.lineJob(inst, pid).review.adoptedLines || {}).length; i++) await tick();
    await LI.gotoLine(doc, 'S01');
    assert.match(doc.querySelector('.pi-rv-lname').textContent, /已保存/);
    assert.match(doc.querySelector('.pi-rv-foot [data-act="import-adopt"]').textContent, /（1条线）/, 'only S02 left to save');
  } finally { await inst.destroy(); }
});

// ---------- N6：意见不丢 ----------
test('N6: edits typed in the send dialog survive clicking a page title', async () => {
  const t = await DE.boot(DE.clueVols(), 'clue', false);
  try {
    await DE.openReview(t, 'v1');
    await DE.goPage(t, 1);
    await t.blur('[data-rv-comment]', '原意见');
    await t.click('[data-act="rv-preview"]');
    const dlg = await waitDialog(t);
    dlg.querySelector('[data-rv-q]').value = '弹框里改过的意见';
    dlg.querySelector('[data-rv-overall]').value = '补的整体意见';
    dlg.querySelector('.pi-rv-q-go').click(); await tick(); await tick();
    const r = job(t).review;
    assert.equal(Object.values(r.comments).find((x) => x), '弹框里改过的意见');
    assert.equal(r.overall, '补的整体意见');
  } finally { await t.inst.destroy(); }
});

test('N6: a line deleted from the outline that only had a comment stays visible read-only; its comment is not sent', async () => {
  const t = await DE.boot(DE.clueVols(), 'clue', false);
  try {
    await DE.openReview(t, 'vS');
    await t.blur('[data-rv-comment]', 'S01 的意见');
    await t.click('.pi-imp-crumb [data-act="import-close"]');
    t.inst.data.updateProject(t.pid, (p) => ({ ...p, outline: { ...p.outline, volumes: p.outline.volumes.filter((v) => v.id !== 'vS') } }));
    await t.click('[data-act="review-open"]');
    const r = job(t).review;
    assert.ok(r.draft.some((v) => v.id === 'vS'), 'line kept in the session');
    await t.click('.pi-rv-line [title="下一条"]');
    const text = t.doc.querySelector('.pi-rv').textContent;
    assert.match(text, /已从大纲删除/);
    assert.match(text, /S01 的意见/);
    assert.equal(t.doc.querySelector('[data-act="rv-send"]').textContent.trim(), '发送意见', 'not counted for sending');
  } finally { await t.inst.destroy(); }
});

// ---------- N7：重新整理这一条 ----------
test('N7: a redraft reply that arrives after the line was edited is not applied; notes typed meanwhile stay; the type never changes', async () => {
  const { host, inst, doc, click, pid } = await LI.boot([]);
  try {
    await LI.openJob(inst, doc, click, pid, [LI.vol('S01'), LI.vol('S02')]);
    const j0 = LI.lineJob(inst, pid), vid = LI.volOf(j0, 'S01');
    let release;
    const gate = new Promise((r) => (release = r));
    const yaml = (type) => '```yaml\n剧情_S01_新:\n  线: {编号: S01, 类型: ' + type + ', 简介: AI 的简介}\n  阶段1_经过:\n    主线节点:\n      - {id: s01_n0, 名称: 新, 入口: 去, 发现: [{事实: F_S01_0, 内容: x}], 完成条件: {事实: F_S01_0}}\n```';
    host.llm.reply = undefined;
    host.llm.respond = async () => (await gate, yaml('主线'));
    await inst.data.imports.update(j0.id, (x) => ({ ...x, parts: [{ i: 0, start: 0, end: 1, lead: 0, title: 't' }] }));
    await LI.gotoLine(doc, 'S01');
    await click('[data-act="rv-line-menu"]');
    const p = LI.dlg(doc, 'redraft');
    await p;
    // 等待期间：改简介、写意见
    await inst.data.imports.update(j0.id, (x) => ({ ...x, review: { ...x.review, draft: x.review.draft.map((v) => (v.id === vid ? { ...v, line: { ...v.line, 简介: '等待时改的' } } : v)), comments: { [`${vid}/line`]: '等待时写的意见' } } }));
    release();
    for (let i = 0; i < 60 && inst.__view.busy[`review:${pid}`]; i++) await tick();
    await tick();
    let r = LI.lineJob(inst, pid).review;
    assert.equal(r.draft.find((v) => v.id === vid).line.简介, '等待时改的', 'newer draft not replaced');
    assert.equal(r.comments[`${vid}/line`], '等待时写的意见');
    // 不改的情况下重新整理：替换，但类型仍是支线
    host.llm.respond = async () => yaml('主线');
    await click('[data-act="rv-line-menu"]'); await LI.dlg(doc, 'redraft');
    for (let i = 0; i < 60 && inst.__view.busy[`review:${pid}`]; i++) await tick();
    await tick();
    r = LI.lineJob(inst, pid).review;
    const s01 = r.draft.find((v) => v.id === vid);
    assert.equal(s01.line.简介, 'AI 的简介', 'applied');
    assert.equal(s01.line.类型, '支线', 'type kept');
    assert.equal(r.comments[`${vid}/line`], '等待时写的意见', 'notes are kept (a redraft does not send them)');
    // 撤销回到重新整理前
    await click('[data-act="rv-undo"]');
    assert.equal(LI.lineJob(inst, pid).review.draft.find((v) => v.id === vid).line.简介, '等待时改的');
  } finally { await inst.destroy(); }
});

// ---------- N8：新引入的找不到的依赖 ----------
test('N8 core: newMissingRefs flags a new reference to a missing node / fact, not existing ones, line-open facts or valid cross-line refs', () => {
  const node = (id, fact, extra = {}) => ({ id, 名称: id, 入口: '去', 发现: [{ 事实: fact, 内容: 'x' }], 完成条件: { 事实: fact }, ...extra });
  const A = [{ id: 'v', key: 'k', line: { 编号: 'S01', 类型: '支线', 开启条件: { 事实: 'F_open' } }, stages: [{ id: 's', key: '阶段1_x', data: { 主线节点: [node('n1', 'F1')] } }] }];
  const bg = [{ id: 'o', key: 'o', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 'os', key: '阶段1_y', data: { 主线节点: [node('m1', 'Fm')] } }] }];
  const put = (extra) => [{ ...A[0], stages: [{ ...A[0].stages[0], data: { 主线节点: [node('n1', 'F1', extra)] } }] }];
  assert.deepEqual(C.newMissingRefs(A, put({ 开放条件: { 节点: 'node_does_not_exist' } }), ['v/s'], bg), [{ key: 'v/s', refs: ['node_does_not_exist'] }]);
  assert.deepEqual(C.newMissingRefs(A, put({ 开放条件: { 事实: 'F_nowhere' } }), ['v/s'], bg), [{ key: 'v/s', refs: ['F_nowhere'] }]);
  assert.deepEqual(C.newMissingRefs(A, put({ 开放条件: { 节点: 'm1' } }), ['v/s'], bg), [], 'cross-line node ok');
  assert.deepEqual(C.newMissingRefs(A, put({ 开放条件: { 事实: 'Fm' } }), ['v/s'], bg), [], 'cross-line fact ok');
  assert.deepEqual(C.newMissingRefs(A, put({ 开放条件: { 事实: 'F_open' } }), ['v/s'], bg), [], 'fact from a line open condition ok');
  // 原来就断的不算
  const broken = put({ 开放条件: { 节点: 'gone' } });
  assert.deepEqual(C.newMissingRefs(broken, broken, ['v/s'], bg), []);
});

test('N8: a reply that adds a condition on a node that does not exist is held back and the comment stays', async () => {
  const t = await DE.boot(DE.clueVols(), 'clue', false); const toasts = observe(t);
  try {
    await DE.openReview(t, 'v1');
    await DE.goPage(t, 2);
    await t.blur('[data-rv-comment]', '加个前置');
    const before = JSON.stringify(job(t).review.draft);
    t.host.llm.reply = ['【单位：v1/s2】', '```yaml', '阶段2_中段:', '  主线节点:', '    - {id: n2, 名称: n2名, 入口: 去n2, 开放条件: {节点: node_does_not_exist}, 发现: [{事实: F2, 内容: F2内容}], 完成条件: {事实: F2}}', '```'].join('\n');
    await t.click('[data-act="rv-send"]'); await done(t);
    assert.equal(JSON.stringify(job(t).review.draft), before, 'not applied');
    assert.equal(job(t).review.comments['v1/s2'], '加个前置', 'comment kept');
    assert.ok(toasts.some((x) => /不存在的node_does_not_exist/.test(x)), toasts.join('|'));
  } finally { await t.inst.destroy(); }
});

// ---------- 文案 ----------
test('wording: existing line without a start condition shows 无额外条件, not a warning; 保留现有条件; field hints under the labels', async () => {
  const vols = DE.clueVols(); vols[1].line = { 编号: 'S01', 类型: '支线', 开启条件: { 任一: [{ 线: 'M1 == 完成' }, { 事实: 'F1' }] } };
  const t = await DE.boot(vols, 'clue', false);
  try {
    await DE.openReview(t, 'v1');
    const text = t.doc.querySelector('.pi-rv').textContent;
    assert.match(text, /无额外条件/);
    assert.doesNotMatch(text, /文档未写开始条件/);
    assert.match(text, /供作者识别这条线/);
    assert.match(text, /剧情入口/);
    assert.match(text, /不代表事件已发生/);
    await t.click('.pi-rv-line [title="下一条"]');
    assert.match(t.doc.querySelector('.pi-rv-opts').textContent, /保留现有条件/);
  } finally { await t.inst.destroy(); }
});

// ---------- 入口规则（GPT 第二轮）：主角已在现场时不另编邀约 ----------
test('entry rule: protagonist already on scene → write the change in front of him, not a new invitation; rule reaches the import / revise prompts', () => {
  assert.match(C.ENTRY_HINT_RULE, /原文中主角已经在现场，就写眼前使他继续参与的变化，不另编邀约/);
  assert.doesNotMatch(C.ENTRY_HINT_RULE, /写的是主角还没到场时/);
  const m = C.reviewReviseMessages({ units: [{ key: 'v/line', label: '线', yaml: '线: {}', comment: '' }], overall: '补全' });
  assert.match(m[0].content, /主角已经在现场/);
  assert.match(m[1].content, /整体意见适用/);
});

// ---------- 新手引导（GPT 第二轮界面审阅）：运行设置收起时也能看到入口；多条线时暂停指向「暂停 ▾」 ----------
test('tour: the run page has a 运行设置 step on the always-visible toggle before the template step; 暂停 targets the menu summary', async () => {
  const src = fs.readFileSync(new URL('../src/ui/tour.js', import.meta.url), 'utf8');
  const run = src.slice(src.indexOf('    run: ['), src.indexOf('\n    ],', src.indexOf('    run: [')));
  const iSet = run.indexOf("target: '[data-act=run-set-toggle]'"), iTpl = run.indexOf("target: '[data-act=clue-gen-template]'");
  assert.ok(iSet > 0 && iSet < iTpl, '运行设置 step comes first');
  assert.match(run, /target: '\.pi-pause-menu > summary, \[data-act=clue-pause\]'/);
});

// ---------- GPT 第三轮 C1–C3、U1–U2 ----------
test('C1: a complex start condition survives switching to 按表格条件 and back to 保留现有条件 (the current version, not the opened one)', async () => {
  const vols = DE.clueVols();
  const complex = { 全部: [{ 线: 'M1 == 完成' }, { 事实: 'F_OUTSIDE' }] };
  vols[1].line = { 编号: 'S01', 类型: '支线', 开启条件: complex };
  const t = await DE.boot(vols, 'clue', false);
  try {
    await DE.openReview(t, 'vS');
    const pick = async (v) => { const r = t.doc.querySelector(`[data-rv-when="${v}"]`); assert.ok(r, `option ${v}`); r.checked = true; r.dispatchEvent(new t.host.w.Event('input', { bubbles: true })); await tick(); await tick(); };
    const cond = () => job(t).review.draft.find((v) => v.id === 'vS').line.开启条件;
    assert.ok(t.doc.querySelector('[data-rv-when="keep"]').checked);
    await pick('table');
    assert.ok(t.doc.querySelector('[data-rv-when="keep"]'), '保留现有条件 still offered after switching');
    await pick('keep');
    assert.equal(JSON.stringify(cond()), JSON.stringify(complex));
    // 先改过（YAML）再切换：恢复改过的版本
    const edited = { 全部: [{ 线: 'M1 == 完成' }, { 事实: 'F_EDITED' }] };
    await t.inst.data.imports.update(job(t).id, (j) => ({ ...j, review: { ...j.review, draft: j.review.draft.map((v) => (v.id === 'vS' ? { ...v, line: { ...v.line, 开启条件: edited } } : v)) } }));
    t.inst.__view.renderBody(); await tick();
    await pick('manual');
    await pick('keep');
    assert.equal(JSON.stringify(cond()), JSON.stringify(edited), 'the edited condition comes back, not the opened one');
    assert.ok(!('保留条件' in job(t).review.draft.find((v) => v.id === 'vS').line), 'stash cleared after restoring');
    // 暂存字段不进大纲
    await pick('table');
    assert.ok(C.stripReviewMarks(job(t).review.draft).every((v) => !v.line || !('保留条件' in v.line)));
  } finally { await t.inst.destroy(); }
});

test('C2: a legacy 开场事实 counts as a fact source for the new-reference check (same rule as checkClueDraft)', () => {
  const node = (id, fact, extra = {}) => ({ id, 名称: id, 入口: '去', 发现: [{ 事实: fact, 内容: 'x' }], 完成条件: { 事实: fact }, ...extra });
  const A = [{ id: 'v', key: 'k', line: { 编号: 'S01', 类型: '支线', 开场事实: 'F_LEGACY' }, stages: [{ id: 's', key: '阶段1_x', data: { 主线节点: [node('n1', 'F1')] } }] }];
  const B = [{ ...A[0], stages: [{ ...A[0].stages[0], data: { 主线节点: [node('n1', 'F1', { 开放条件: { 事实: 'F_LEGACY' } })] } }] }];
  assert.deepEqual(C.newMissingRefs(A, B, ['v/s']), []);
  assert.deepEqual(C.lineFactSources({ 开启条件: { 事实: 'F_OPEN' }, 开场事实: 'F_LEGACY' }), ['F_OPEN', 'F_LEGACY']);
  // 真正没有来源的仍被拦
  const D = [{ ...A[0], stages: [{ ...A[0].stages[0], data: { 主线节点: [node('n1', 'F1', { 开放条件: { 事实: 'F_NOWHERE' } })] } }] }];
  assert.deepEqual(C.newMissingRefs(A, D, ['v/s']), [{ key: 'v/s', refs: ['F_NOWHERE'] }]);
});

test('C3: removing the only producer of a fact that another unit in the same group still uses is caught; moving the producer is fine', () => {
  const node = (id, fact, extra = {}) => ({ id, 名称: id, 入口: '去', 发现: fact ? [{ 事实: fact, 内容: 'x' }] : [], 完成条件: { 事实: fact || 'F_SELF' }, ...extra });
  const vol = (a, b) => [{ id: 'v', key: 'k', line: { 编号: 'S01', 类型: '支线' }, stages: [{ id: 'a', key: '阶段1_a', data: { 主线节点: a } }, { id: 'b', key: '阶段2_b', data: { 主线节点: b } }] }];
  const before = vol([node('na', 'F1')], [node('nb', 'F2', { 开放条件: { 事实: 'F1' } })]);
  // A 不再产出 F1，B 只改了入口，仍要 F1
  const broken = vol([node('na', 'F_OTHER')], [node('nb', 'F2', { 开放条件: { 事实: 'F1' }, 入口: '换个说法' })]);
  assert.deepEqual(C.newMissingRefs(before, broken, ['v/a', 'v/b']), [{ key: 'v/b', refs: ['F1'] }]);
  // F1 挪到 B 的另一个节点：仍有来源，放行
  const moved = vol([node('na', 'F_OTHER')], [node('nb', 'F2', { 开放条件: { 事实: 'F1' } }), node('nc', 'F1')]);
  assert.deepEqual(C.newMissingRefs(before, moved, ['v/a', 'v/b']), []);
  // 原来就没有来源的旧问题不拦
  const old = vol([node('na', 'F_X')], [node('nb', 'F2', { 开放条件: { 事实: 'F_GONE' } })]);
  assert.deepEqual(C.newMissingRefs(old, old, ['v/a', 'v/b']), []);
});

// ---------- 第四轮 N1：YAML / AI 换了开始条件，旧的表格表单状态让位 ----------
async function halfTable(env) {
  const { inst, doc, click, pid } = env;
  await LI.openJob(inst, doc, click, pid, [LI.vol('S01', { 开启条件: { 全部: [{ 事实: 'F_A' }, { 事实: 'F_X' }] } })]);
  const pick = async (sel, value) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.value = value; el.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true })); await tick(); await tick(); };
  const radio = doc.querySelector('[data-rv-when="table"]');
  radio.checked = true; radio.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true })); await tick(); await tick();
  await pick('select[data-rv-tbl="table"]', '重要角色表');
  const line = () => LI.lineJob(inst, pid).review.draft[0].line;
  assert.ok(line().表格条件草稿, 'half-filled table form');
  return line;
}
const NEW_COND = { 任一: [{ 事实: 'F_B' }, { 事实: 'F_C' }] };
const lineYaml = (extra) => ['线:', '  编号: S01', '  类型: 支线', '  简介: 已改为有效条件', ...extra].join('\n');
async function saveAll(doc, click, inst, pid) {
  await click('.pi-rv-foot [data-act="import-adopt"]');
  for (let i = 0; i < 4; i++) {
    const d = [...doc.querySelectorAll('.pi-dialog')].pop();
    if (!d) break;
    const b = [...d.querySelectorAll('.pi-btn, .pi-menu-item')].find((x) => ['仍然保存', '保存'].includes(x.textContent.trim()));
    if (!b) break;
    b.click(); await tick(); await tick();
  }
  return inst.data.project(pid).outline.volumes;
}

test('round 4 N1: table half filled → YAML sets a new complex condition → saving works and writes the new condition', async () => {
  const env = await LI.boot([]);
  const { inst, doc, click, pid } = env;
  try {
    const line = await halfTable(env);
    const y = doc.querySelector('[data-rv-yaml]');
    y.value = lineYaml(['  开启条件:', '    任一:', '      - 事实: F_B', '      - 事实: F_C']);
    await click('[data-act="rv-yaml-save"]');
    assert.equal(JSON.stringify(line().开启条件), JSON.stringify(NEW_COND));
    assert.ok(!('表格条件草稿' in line()) && !('开始方式表格' in line()), 'old table form state dropped');
    assert.ok(doc.querySelector('[data-rv-when="keep"]').checked, 'shows 保留现有条件 for the new condition');
    const saved = await saveAll(doc, click, inst, pid);
    assert.equal(saved.length, 1, 'saved');
    assert.equal(JSON.stringify(saved[0].line.开启条件), JSON.stringify(NEW_COND));
  } finally { await inst.destroy(); }
});

test('round 4 N1: table half filled → AI sets a new complex condition → saving works', async () => {
  const env = await LI.boot([]);
  const { host, inst, doc, click, pid } = env;
  try {
    const line = await halfTable(env);
    const vid = LI.lineJob(inst, pid).review.draft[0].id;
    await LI.blur(doc, doc.querySelector('[data-rv-comment]'), '开始条件改成 F_B 或 F_C');
    host.llm.reply = [`【单位：${vid}/line】`, '```yaml', lineYaml(['  开启条件:', '    任一:', '      - 事实: F_B', '      - 事实: F_C']), '```'].join('\n');
    await click('[data-act="rv-send"]');
    for (let i = 0; i < 60 && inst.__view.busy[`review:${pid}`]; i++) await tick();
    await tick();
    assert.equal(JSON.stringify(line().开启条件), JSON.stringify(NEW_COND), 'AI change applied');
    assert.ok(!('表格条件草稿' in line()), 'old table form state dropped');
    const saved = await saveAll(doc, click, inst, pid);
    assert.equal(saved.length, 1, 'saved');
    assert.equal(JSON.stringify(saved[0].line.开启条件), JSON.stringify(NEW_COND));
  } finally { await inst.destroy(); }
});

test('round 4 N1: a YAML edit that keeps the start condition (only 简介) leaves the half-filled table form alone; a simple table condition shows in the form', async () => {
  const env = await LI.boot([]);
  const { inst, doc, click } = env;
  try {
    const line = await halfTable(env);
    const draft0 = JSON.stringify(line().表格条件草稿);
    let y = doc.querySelector('[data-rv-yaml]');
    y.value = y.value.replace(/简介: .*/, '简介: 只改简介');
    await click('[data-act="rv-yaml-save"]');
    assert.equal(line().简介, '只改简介');
    assert.equal(JSON.stringify(line().表格条件草稿), draft0, 'table form state kept');
    assert.ok(doc.querySelector('[data-rv-when="table"]').checked);
    // 改成单格表格条件：表单直接显示它
    y = doc.querySelector('[data-rv-yaml]');
    y.value = lineYaml(['  开启条件:', '    表: 重要角色表/巴基/阶段 >= 2']);
    await click('[data-act="rv-yaml-save"]');
    assert.ok(!('表格条件草稿' in line()) && line().开始方式表格, 'form state follows the new simple condition');
    assert.ok(doc.querySelector('[data-rv-when="table"]').checked);
    assert.equal(doc.querySelector('input[data-rv-tbl="value"]').value, '2');
    // 原来暂存的复杂条件还在：选回「保留现有条件」能找回
    assert.ok(doc.querySelector('[data-rv-when="keep"]'), 'stashed complex condition still offered');
  } finally { await inst.destroy(); }
});
