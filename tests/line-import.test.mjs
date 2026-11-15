// 多线第 B 步第三批：批量导入支线（线身份表、分组转写、按线合并、采用时避开已有编号）和审阅页（翻页、意见、不要这条、按意见修改、采用），
// 以及大纲页「剧情线…」（已采用的线：直接改字段、按意见修改先预览）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import { createHost } from './host-sim.mjs';

const C = loadCore();
const tick = () => new Promise((r) => setTimeout(r, 20));
const vol = (id, extra = {}, stages = 1) => ({ id: `v${id}`, key: `剧情_${id}_标题${id}`, line: { 编号: id, 类型: '支线', 简介: `${id}简介`, ...extra }, stages: Array.from({ length: stages }, (_, i) => ({ id: `s${id}${i}`, key: `阶段${i + 1}_经过`, data: { 主线节点: [{ id: `${id.toLowerCase()}_n${i}`, 名称: `${id}场景${i}`, 入口: `去${id}`, 发现: [{ 事实: `F_${id}_${i}`, 内容: 'x' }], 完成条件: { 事实: `F_${id}_${i}` } }] } })) });

// ---------- 解析：带「线」的卷不会被当成阶段 ----------
test('parse: a volume with 线 and a stray volume-level AI指令 stays a volume (the AI指令 moves into its first stage)', () => {
  const r = C.parseOutlineReply('```yaml\n剧情_S07_扣子:\n  线: {编号: S07, 类型: 支线}\n  AI指令: 卷上的说明\n  阶段1_试用:\n    主线节点:\n      - {id: s07_a, 名称: a, 入口: 去, 发现: [{事实: F1, 内容: x}], 完成条件: {事实: F1}}\n```');
  assert.equal(r.ok, true);
  assert.equal(r.volumes[0].line.编号, 'S07');
  assert.equal(r.volumes[0].stages.length, 1);
  assert.equal(r.volumes[0].stages[0].data.AI指令, '卷上的说明');
});

test('parse: a volume with 线 whose nodes sit directly under the volume (no stage layer) gets one stage', () => {
  const r = C.parseOutlineReply('```yaml\n剧情_S10_顺风车:\n  线: {编号: S10, 类型: 支线}\n  AI指令: 说明\n  主线节点:\n    - {id: s10_a, 名称: a, 入口: 去, 发现: [{事实: F1, 内容: x}], 完成条件: {事实: F1}}\n剧情_S11_游戏:\n  线: {编号: S11, 类型: 支线}\n  阶段1_一局:\n    主线节点:\n      - {id: s11_a, 名称: b, 入口: 去, 发现: [{事实: F2, 内容: y}], 完成条件: {事实: F2}}\n```');
  assert.equal(r.ok, true);
  assert.deepEqual(r.volumes.map((v) => [v.line.编号, v.stages.map((s) => s.key)]), [['S10', ['阶段1_经过']], ['S11', ['阶段1_一局']]]);
});

test('parse: nodes written as a map keyed by id become a list with that id', () => {
  const r = C.parseOutlineReply('```yaml\n剧情_S10_x:\n  线: {编号: S10, 类型: 支线}\n  阶段1_a:\n    主线节点:\n      n_s10_load:\n        名称: 上车\n        入口: 去\n        发现: [{事实: F1, 内容: x}]\n        完成条件: {事实: F1}\n      n_s10_drop: {id: s10_drop, 名称: 送到, 入口: 去, 发现: [{事实: F2, 内容: y}], 完成条件: {事实: F2}}\n```');
  const nodes = r.volumes[0].stages[0].data.主线节点;
  assert.deepEqual([...nodes.map((n) => n.id)], ['n_s10_load', 's10_drop']);
  assert.deepEqual([...C.compileClue(r.volumes).errors], []);
});

test('parse: one ```yaml block per line (DeepSeek bulk import) is read as one outline; duplicate top keys keep the old first-block behaviour', () => {
  const block = (id) => '```yaml\n' + `剧情_${id}_x:\n  线: {编号: ${id}, 类型: 支线}\n  阶段1_a:\n    主线节点:\n      - {id: ${id.toLowerCase()}_a, 名称: a, 入口: 去, 发现: [{事实: F_${id}, 内容: x}], 完成条件: {事实: F_${id}}}\n` + '```';
  const r = C.parseOutlineReply(`${block('S01')}\n\n${block('S02')}\n\n${block('S03')}`);
  assert.equal(r.ok, true);
  assert.deepEqual([...r.volumes.map((v) => v.line.编号)], ['S01', 'S02', 'S03']);
  const dup = C.parseOutlineReply(`${block('S01')}\n${block('S01')}`);
  assert.deepEqual([...dup.volumes.map((v) => v.line.编号)], ['S01']);
});

test('condition: an empty {} 开启条件 means "no condition" (DeepSeek writes it for independent side lines)', () => {
  const errs = [];
  assert.equal(C.parseCondition({}, errs), null);
  assert.deepEqual(errs, []);
});

// ---------- 线身份表 ----------
test('line identity: merged by id across parts; parts only where the line has real content; one doc number with two ids is flagged', () => {
  const r = C.mergeLineIdentity([
    { 支线: [{ 编号: 'S01', 名称: '景点', 文档里的序号: '1', 本段有经过: true }, { 编号: 'S02', 名称: '搬家', 文档里的序号: '2', 本段有经过: false }] },
    { 支线: [{ 编号: 'S01', 名称: '景点', 主要人物: ['叶莲娜'], 本段有经过: false }, { 编号: 'S02', 名称: '搬家', 本段有经过: true }, { 编号: 'S09', 名称: '搬家', 文档里的序号: '2', 本段有经过: true }] },
    { 支线: [{ 编号: 'S03', 名称: '影院' }] },
  ]);
  assert.deepEqual(r.lines.map((l) => [l.编号, l.parts]), [['S01', [0]], ['S02', [1]], ['S09', [1]], ['S03', [2]]]);
  assert.deepEqual(r.lines[0].主要人物, ['叶莲娜'], 'later parts fill empty fields');
  assert.match(r.notes.join(), /第 2 条支线被编了两个编号（S02、S09）/);
  // a line marked "not here" everywhere falls back to every part it was listed in
  const r2 = C.mergeLineIdentity([{ 支线: [{ 编号: 'S05', 本段有经过: false }] }, { 支线: [{ 编号: 'S05', 本段有经过: false }] }]);
  assert.deepEqual(r2.lines[0].parts, [0, 1]);
});

test('batches: at most 3 lines per call, only lines with content in that part', () => {
  const lines = ['S01', 'S02', 'S03', 'S04', 'S05', 'S06', 'S07'].map((id, i) => ({ 编号: id, parts: i < 6 ? [0] : [1] }));
  assert.deepEqual(C.importLineBatches(lines, 0), [['S01', 'S02', 'S03'], ['S04', 'S05', 'S06']]);
  assert.deepEqual(C.importLineBatches(lines, 1), [['S07']]);
  assert.deepEqual(C.importLineBatches(lines, 2), []);
});

test('line draft prompt: identity table, only-these lines, line rules, main lines and table catalog are all sent', () => {
  const m = C.importLineDraftMessages({ part: { i: 0, title: 't', text: '原文' }, index: 'idx', lines: [{ 编号: 'S01', 名称: '景点', 开启条件原文: '独立' }], only: ['S01'], mainLines: '- M1「主线」阶段：调查', tableCatalog: '【当前数据库的表格】x' });
  assert.match(m[0].content, /编号\*\*必须\*\*用【线身份表】里的编号/);
  assert.match(m[0].content, /这一次\*\*只写\*\* S01/);
  assert.match(m[0].content, /不要编成「收到邀请」的事实条件/);
  assert.match(m[0].content, /不写开启条件，也不写开启时段/, 'independent lines: neither condition nor window');
  assert.doesNotMatch(m[0].content, /只写这一条线（一卷）/, 'the single-line rule is not in the shared rules any more (GPT 代码审阅 prompts §1)');
  assert.match(m[0].content, /开启时段/);
  assert.match(m[1].content, /S01「景点」 开启：独立/);
  assert.match(m[1].content, /M1「主线」/);
  assert.match(m[1].content, /当前数据库的表格/);
});

// ---------- 按线合并 ----------
test('merge by line: the same line from two parts is merged inside itself; different lines never merge; line fields: first kept, conflicts reported', () => {
  const a = vol('S01', { 简介: '前一段' }), b = { ...vol('S01', { 简介: '后一段', 入口提示: '由头' }), stages: [{ id: 'x', key: '阶段2_后来', data: { 主线节点: [{ id: 's01_late', 名称: '后来', 入口: '去', 发现: [{ 事实: 'F_late', 内容: 'x' }], 完成条件: { 事实: 'F_late' } }] } }] };
  const out = C.mergeImportByLine([a, vol('S02'), b]);
  assert.deepEqual(out.map((v) => v.line.编号), ['S01', 'S02']);
  assert.deepEqual(out[0].stages.map((s) => s.key), ['阶段1_经过', '阶段2_后来']);
  assert.equal(out[0].line.简介, '前一段');
  assert.equal(out[0].line.入口提示, '由头', 'empty fields filled');
  assert.ok(out.conflicts.some((c) => c.field === '简介'));
  // same stage name in two different lines is NOT merged
  assert.equal(out[1].stages.length, 1);
});

// ---------- 采用时避开已有编号 ----------
test('reidLines: ids taken by the project get the next free number; references inside the batch follow', () => {
  const existing = [vol('S01'), vol('S02')];
  const drafts = [vol('S01'), vol('S03', { 开启条件: { 线: 'S01 == 完成' } }), vol('S02', { 开启条件: { 全部: [{ 线: 'S01 == 完成' }, '线: S02 == 开过'] } })];
  const [out, map] = C.reidLines(drafts, existing);
  assert.deepEqual(map, { S01: 'S04', S02: 'S05' });
  assert.deepEqual(out.map((v) => v.line.编号), ['S04', 'S03', 'S05']);
  assert.equal(out[1].line.开启条件.线, 'S04 == 完成');
  assert.deepEqual(out[2].line.开启条件, { 全部: [{ 线: 'S04 == 完成' }, '线: S05 == 开过'] });
  assert.match(out[0].key, /S04/);
  // 节点 id 撞号由采用时的 reidConflicts 处理（和长文导入同一套）
  const [fixed] = C.reidConflicts(out, existing);
  assert.deepEqual(C.compileClue([...existing, ...fixed]).errors, []);
});

test('droppedLineRefs: dropping a line that another kept line waits on is reported', () => {
  const kept = [vol('S10', { 开启条件: { 线: 'S08 == 完成' } }), vol('S11')];
  const r = C.droppedLineRefs(kept, ['S08']);
  assert.equal(r.length, 1);
  assert.match(r[0], /S10.*要等 S08，但 S08 不要了/);
});

// ---------- 按意见修改 ----------
test('revise: prompt carries only the targets with comments; reply is filtered to target ids; change text says what changed', () => {
  const m = C.lineReviseMessages({ targets: [{ id: 'S03', yaml: 'yaml', comment: '改成巴基主动来找' }], context: '- S04「护送」' });
  assert.match(m[0].content, /只改列出的这几条/);
  assert.match(m[1].content, /【要改的线 S03】\n意见：改成巴基主动来找/);
  assert.match(m[1].content, /其他线（只读）/);
  const { got, missing } = C.pickRevised([vol('S03', { 开启条件: { 线: 'M1 == 完成' } }), vol('S99')], ['S03', 'S04']);
  assert.deepEqual(Object.keys(got), ['S03']);
  assert.deepEqual(missing, ['S04']);
  const t = C.lineChangeText(vol('S03'), vol('S03', { 开启条件: { 线: 'M1 == 完成' } }, 2));
  assert.match(t.join('；'), /开启：（无） → \{线:M1 == 完成\}/);
  assert.match(t.join('；'), /内容：1 个阶段 · 1 个场景 → 2 个阶段 · 2 个场景/);
});

// ---------- UI：批量导入 → 审阅页 → 采用 ----------
const SRC = ['# 支线方案', '## 支线总览', '| 1 | 景点 | 独立 |', ...[1, 2, 3, 4].map((n) => [`## ${n} 支线${n}`, ...Array.from({ length: 30 }, () => `第${n}条支线的经过。`.repeat(8))].join('\n\n'))].join('\n\n');
const IDX = '```yaml\n梗概: x\n支线:\n  - {编号: S01, 名称: 景点, 文档里的序号: "1", 本段有经过: true}\n  - {编号: S02, 名称: 搬家, 文档里的序号: "2", 本段有经过: true}\n  - {编号: S03, 名称: 影院, 文档里的序号: "3", 本段有经过: true}\n  - {编号: S04, 名称: 护送, 文档里的序号: "4", 关系: 默认在 3 之后, 本段有经过: true}\n事实:\n  - {编号: F_a, 内容: x, 性质: 实物}\n```';
const linesYaml = (ids) => '```yaml\n' + ids.map((id) => `剧情_${id}_标题:\n  线:\n    编号: ${id}\n    类型: 支线\n    简介: ${id}的简介\n${id === 'S04' ? '    开启条件: {线: S03 == 完成}\n' : ''}  阶段1_经过:\n    主线节点:\n      - id: ${id.toLowerCase()}_a\n        名称: ${id}场景\n        入口: 去做${id}的事\n        发现: [{事实: F_${id.toLowerCase()}, 内容: x}]\n        完成条件: {事实: F_${id.toLowerCase()}}\n        原文出处: 原文`).join('\n') + '\n```';
async function boot(vols = []) {
  const host = createHost({ tables: { sheet_r: { name: '重要角色表', content: [['row_id', '姓名', '阶段'], ['1', '巴基', '1']] } } });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('支线');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.data.updateSettings({ tourState: { revision: 2, done: ['core'] } });
  inst.open(); await tick();
  const doc = host.w.document;
  const click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  await click(`[data-act="project"][data-id="${p.id}"]`);
  await click('[data-act="tab"][data-tab="outline"]');
  return { host, inst, doc, click, pid: p.id };
}
const blur = async (doc, el, value) => { el.value = value; el.dispatchEvent(new doc.defaultView.FocusEvent('focusout', { bubbles: true })); await tick(); };

test('UI: bulk side import → one page per line → comment saved → 不要这条 warns dependents → revise only commented → adopt all kept, ids avoid existing', async () => {
  const main = { id: 'vM', key: '剧情_M1_主线', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 'sm', key: '阶段1_调查', data: { 主线节点: [{ id: 'm1', 名称: 'm1', 入口: '去', 发现: [{ 事实: 'Fm', 内容: 'x' }], 完成条件: { 事实: 'Fm' } }] } }] };
  const { host, inst, doc, click, pid } = await boot([main, vol('S01')]);
  let revised = 0;
  host.llm.reply = undefined;
  host.llm.respond = (body) => {
    if (/整理作者索引/.test(body)) return IDX;
    if (/按意见修改这几条/.test(body)) { revised++; assert.ok(/要改的线 S02/.test(body) && !/要改的线 S03/.test(body), 'only commented lines are sent'); return linesYaml(['S02']).replace('S02的简介', 'S02改过的简介'); }
    const only = /这一次\*\*只写\*\* ([S0-9、]+) 这几条/.exec(body);
    return linesYaml(only ? only[1].split('、') : ['S01']);
  };
  await click('[data-act="import-open-panel"]');
  doc.querySelector('[data-imp-text]').value = SRC;
  const mode = doc.querySelector('[data-imp-mode]'); mode.value = 'lines';
  await click('[data-act="import-start"]');
  for (let i = 0; i < 60 && !doc.querySelector('.pi-lr'); i++) await tick();
  assert.ok(doc.querySelector('.pi-lr'), 'review page opened after the run');
  assert.match(doc.querySelector('.pi-lr h3').textContent, /导入的支线 · 4 条/);
  assert.match(doc.querySelector('.pi-lr').textContent, /1 \/ 4/);
  // 写意见（失焦保存）
  await click('[data-act="lr-go"][data-dir="1"]');
  assert.match(doc.querySelector('.pi-lr-item b').textContent, /S02/);
  await blur(doc, doc.querySelector('[data-lr-comment]'), '改成巴基主动来找');
  assert.match(doc.querySelector('[data-lr-saved]').textContent, /已保存/);
  // 直接改字段
  await blur(doc, doc.querySelector('[data-lr-field="入口提示"]'), '巴基打来电话');
  // 第三条不要了 → 第四条（要等 S03）提示
  await click('[data-act="lr-go"][data-dir="1"]');
  await click('[data-act="lr-drop"]');
  await click('[data-act="lr-go"][data-dir="1"]');
  assert.match(doc.querySelector('.pi-lr').textContent, /S04.*要等 S03，但 S03 不要了/);
  // 按意见修改：只发 S02
  await click('[data-act="lr-revise"]');
  for (let i = 0; i < 30 && !revised; i++) await tick();
  await tick();
  assert.equal(revised, 1);
  const job = inst.data.imports.get(Object.values(inst.data.project(pid).imports)[0]);
  assert.equal(job.lineReview.items.S02.vol.line.简介, 'S02改过的简介');
  assert.equal(job.lineReview.items.S02.comment, '');
  assert.equal(job.lineReview.items.S02.lastComment, '改成巴基主动来找');
  // 采用：S03 不要了；S01 和已有的撞号 → 换号
  const toasts = []; for (const k of ['info', 'success', 'warning', 'error']) host.w.toastr[k] = (m) => toasts.push(`${k}:${m}`);
  await click('[data-act="lr-adopt"]');
  const dlg = doc.querySelector('.pi-dialog .pi-btn.is-danger, .pi-dialog .pi-btn.is-primary'); dlg && dlg.click(); await tick();
  const ids = [...inst.data.project(pid).outline.volumes.map((v) => v.line && v.line.编号)];
  assert.deepEqual(ids, ['M1', 'S01', 'S05', 'S02', 'S04'], 'S01 clashes → S05 (S03 is dropped but still referenced, so it is not reused)');
  assert.ok(!ids.includes('S03'), 'dropped line not adopted');
  const outline = JSON.stringify(inst.data.project(pid).outline);
  assert.ok(!outline.includes('原文出处'), 'author-only fields stay out');
  // 再点一次采用：不重复
  await click('[data-act="tab"][data-tab="outline"]');
  await inst.destroy();
});

test('UI: bulk side import — a call that leaves out a line gets one retry for just that line', async () => {
  const { host, inst, doc, click } = await boot([]);
  const asked = [];
  host.llm.reply = undefined;
  host.llm.respond = (body) => {
    if (/整理作者索引/.test(body)) return IDX;
    const only = /这一次\*\*只写\*\* ([S0-9、]+) 这几条/.exec(body), ids = only ? only[1].split('、') : ['S01'];
    asked.push(ids.join(','));
    return linesYaml(ids.length === 3 ? ids.slice(0, 1) : ids); // the 3-line call only writes the first one
  };
  await click('[data-act="import-open-panel"]');
  doc.querySelector('[data-imp-text]').value = SRC;
  doc.querySelector('[data-imp-mode]').value = 'lines';
  await click('[data-act="import-start"]');
  for (let i = 0; i < 60 && !doc.querySelector('.pi-lr'); i++) await tick();
  assert.ok(asked.includes('S02,S03'), `the missing two were asked for again: ${asked.join(' | ')}`);
  assert.match(doc.querySelector('.pi-lr h3').textContent, /4 条/);
  await inst.destroy();
});

test('UI: outline page 剧情线… edits an adopted line directly; revise by comment shows a preview and applies on confirm', async () => {
  const { host, inst, doc, click, pid } = await boot([vol('S01'), vol('S02')]);
  await click('[data-act="lines-open"]');
  assert.match(doc.querySelector('.pi-lr').textContent, /1 \/ 2/);
  assert.equal(doc.querySelector('[data-act="lr-drop"]'), null, 'no 不要这条 for adopted lines');
  await blur(doc, doc.querySelector('[data-lr-field="简介"]'), '新的简介');
  assert.equal(inst.data.project(pid).outline.volumes[0].line.简介, '新的简介', 'saved into the project');
  await blur(doc, doc.querySelector('[data-lr-comment]'), '加一个阶段');
  host.llm.reply = undefined;
  host.llm.respond = () => '```yaml\n剧情_S01_标题S01:\n  线: {编号: S01, 类型: 支线, 简介: 新的简介}\n  阶段1_经过:\n    主线节点:\n      - {id: s01_n0, 名称: S01场景0, 入口: 去S01, 发现: [{事实: F_S01_0, 内容: x}], 完成条件: {事实: F_S01_0}}\n  阶段2_后来:\n    主线节点:\n      - {id: s01_n1, 名称: 后来, 入口: 去, 发现: [{事实: F_S01_1, 内容: y}], 完成条件: {事实: F_S01_1}}\n```';
  await click('[data-act="lr-revise"]');
  for (let i = 0; i < 30 && !doc.querySelector('.pi-dialog'); i++) await tick();
  assert.match(doc.querySelector('.pi-dialog').textContent, /S01：内容：1 个阶段 · 1 个场景 → 2 个阶段 · 2 个场景/);
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick(); await tick();
  assert.equal(inst.data.project(pid).outline.volumes[0].stages.length, 2);
  assert.equal(inst.data.project(pid).outline.volumes[0].id, 'vS01', 'volume id kept');
  assert.match(doc.querySelector('.pi-lr').textContent, /已改过/);
  await inst.destroy();
});

test('reidLines with prior: references to a line adopted earlier from the same job follow its new id (GPT 代码审阅 R4)', () => {
  const existing = [vol('S01'), vol('S03')];
  const [out, map] = C.reidLines([vol('S02', { 开启条件: { 线: 'S01 == 完成' } })], existing, ['S01', 'S02'], { S01: 'S03' });
  assert.equal(out[0].line.开启条件.线, 'S03 == 完成');
  assert.deepEqual(map, {}, 'the report lists only ids changed in this batch');
});

// 导入任务直接放进存储（审阅数据已建好），再从界面「之前的导入 · 打开 → 一条一条审阅」进去。
async function openJob(inst, doc, click, pid, items) {
  const job = await inst.data.imports.create({ projectId: pid, text: 'x', mode: 'lines', needs: '' });
  await inst.data.imports.update(job.id, (j) => ({ ...j, step: 'review', lineReview: { items: Object.fromEntries(items.map((v) => [v.line.编号, { vol: v, comment: '', lastComment: '', changed: [], dropped: false }])), order: items.map((v) => v.line.编号), conflicts: [] } }));
  inst.data.updateProject(pid, (p) => ({ ...p, imports: [...p.imports || [], job.id] }));
  await click('[data-act="import-open-panel"]');
  await click(`[data-act="import-open"][data-id="${job.id}"]`);
  await click('[data-act="import-lines-review"]');
  assert.ok(doc.querySelector('.pi-lr'), 'review page open');
  return job.id;
}
const confirmAll = async (doc) => { const b = doc.querySelector('.pi-dialog .pi-btn.is-danger, .pi-dialog .pi-btn.is-primary'); b && b.click(); await tick(); };

test('UI: adopt S01 alone (it clashes and is renumbered), reopen, adopt S03 that waits on S01 → it waits on the adopted line; the adopted item is read-only (GPT 代码审阅 R4)', async () => {
  const { inst, doc, click, pid } = await boot([vol('S01'), vol('S02')]);
  await openJob(inst, doc, click, pid, [vol('S01'), vol('S03', { 开启条件: { 线: 'S01 == 完成' } })]);
  // S03 not yet: drop it, adopt only S01
  await click('[data-act="lr-go"][data-dir="1"]');
  await click('[data-act="lr-drop"]');
  await click('[data-act="lr-adopt"]'); await confirmAll(doc);
  const ids = () => [...inst.data.project(pid).outline.volumes.map((v) => v.line.编号)];
  assert.deepEqual(ids(), ['S01', 'S02', 'S04'], 'S01 clashes → S04 (S03 is the batch\'s own id)');
  // reopen the same job: 剧情线 panel closed after adopting; the import panel shows the job card again
  await click('[data-act="import-open-panel"]');
  doc.querySelector('[data-act="import-lines-review"]') || await click('[data-act="import-open"]');
  await click('[data-act="import-lines-review"]');
  assert.match(doc.querySelector('.pi-lr').textContent, /已采用为 S04/, 'the adopted item says where it went');
  assert.equal(doc.querySelector('[data-lr-field]'), null, 'and cannot be edited here');
  await click('[data-act="lr-go"][data-dir="1"]');
  await click('[data-act="lr-drop"]'); // 还是要这条
  await click('[data-act="lr-adopt"]'); await confirmAll(doc);
  const vols = inst.data.project(pid).outline.volumes;
  assert.deepEqual(ids(), ['S01', 'S02', 'S04', 'S03']);
  assert.equal(vols[3].line.开启条件.线, 'S04 == 完成', 'waits on the line adopted earlier, not the project\'s own S01');
  await inst.destroy();
});

test('UI: revise by comment — a comment written while the request is out is kept and not shown as done; the result goes back to the job it came from (GPT 代码审阅 R10)', async () => {
  const { host, inst, doc, click, pid } = await boot([]);
  const jobId = await openJob(inst, doc, click, pid, [vol('S01'), vol('S02')]);
  await blur(doc, doc.querySelector('[data-lr-comment]'), '旧意见');
  let release;
  host.llm.reply = undefined;
  host.llm.respond = () => new Promise((r) => { release = () => r(linesYaml(['S01']).replace('S01的简介', '改过的')); });
  const p = click('[data-act="lr-revise"]');
  for (let i = 0; i < 30 && !release; i++) await tick();
  // while waiting: the comment box still works
  await blur(doc, doc.querySelector('[data-lr-comment]'), '等待期间写下的新意见');
  release(); await p; for (let i = 0; i < 10; i++) await tick();
  const it = inst.data.imports.get(jobId).lineReview.items.S01;
  assert.equal(it.vol.line.简介, '改过的');
  assert.equal(it.comment, '等待期间写下的新意见', 'the new comment is kept');
  assert.equal(it.lastComment, '旧意见', 'lastComment is the one actually sent');
  await inst.destroy();
});

// ---------- GPT 实测前审阅 R2：逐线审阅接回普通导入的检查 ----------
test('importLineIssues: a reused fact code meaning something else is flagged (error if already obtained); a real second route is still allowed', () => {
  const existing = [{ ...vol('S01'), stages: [{ id: 's', key: '阶段1_经过', data: { 主线节点: [{ id: 'old_a', 名称: '翻账本', 入口: '去', 发现: [{ 事实: 'F_s01_result', 内容: '找到旧账本' }], 完成条件: { 事实: 'F_s01_result' } }] } }] }];
  const draft = (text) => [{ ...vol('S02'), stages: [{ id: 't', key: '阶段1_经过', data: { 主线节点: [{ id: 'new_a', 名称: '找钥匙', 入口: '去', 发现: [{ 事实: 'F_s01_result', 内容: text }], 完成条件: { 事实: 'F_s01_result' } }] } }] }];
  const r = C.importLineIssues(draft('找到新钥匙'), existing, { known: ['F_s01_result'] });
  assert.equal(r.S02[0].level, 'error');
  assert.match(r.S02[0].text, /F_s01_result 项目里已经有了（「翻账本」：找到旧账本）.*「找新钥匙」|找到新钥匙/);
  assert.match(r.S02[0].text, /已经拿到了/);
  assert.equal(C.importLineIssues(draft('找到新钥匙'), existing).S02[0].level, 'warn', 'not obtained yet: a warning');
  assert.equal(C.importLineIssues(draft('找到旧账本'), existing).S02, undefined, 'same content = another way to get the same thing: allowed');
});

test('importLineIssues: a stage whose entry waits on a fact only its own node produces is a deadlock (the real S07 draft); waiting on another line is not', () => {
  const s07 = { id: 'v7', key: '剧情_S07_扣具', line: { 编号: 'S07', 类型: '支线' }, stages: [{ id: 's7', key: '阶段1_扣具样件', data: { 进入条件: { 事实: 'F_ava_needs' }, 主线节点: [{ id: 's07_needs', 名称: '听需求', 入口: '去', 发现: [{ 事实: 'F_ava_needs', 内容: '四项需求' }], 完成条件: { 事实: 'F_ava_needs' } }] } }] };
  const s10 = vol('S10', { 开启条件: { 线: 'S07 == 完成' } });
  const r = C.importLineIssues([s07, s10], []);
  assert.equal(r.S07[0].level, 'error');
  assert.match(r.S07[0].text, /这条线走不通：阶段1 扣具样件（进不去：F_ava_needs/);
  assert.equal(r.S10, undefined, 'S10 only waits for S07 to finish: that is its open condition, not a structural deadlock');
});

test('importLineIssues: a name the index marks secret, written into an entry, is flagged', () => {
  const index = { 人物: [{ 名称: '沃克', 名字保密: false }, { 名称: '红色骷髅', 名字保密: true }] };
  const v = { ...vol('S03'), stages: [{ id: 's', key: '阶段1_经过', data: { 主线节点: [{ id: 's03_a', 名称: 'a', 入口: '去见红色骷髅', 发现: [{ 事实: 'F_s03', 内容: 'x' }], 完成条件: { 事实: 'F_s03' } }] } }] };
  const r = C.importLineIssues([v], [], { index });
  assert.ok(r.S03.some((x) => x.level === 'error' && /保密的名字「红色骷髅」/.test(x.text)));
});

test('UI (R2): the review page shows the deadlock on S07 instead of "no problems"', async () => {
  const { inst, doc, click, pid } = await boot([]);
  const s07 = { id: 'v7', key: '剧情_S07_扣具', line: { 编号: 'S07', 类型: '支线' }, stages: [{ id: 's7', key: '阶段1_扣具样件', data: { 进入条件: { 事实: 'F_ava_needs' }, 主线节点: [{ id: 's07_needs', 名称: '听需求', 入口: '去', 发现: [{ 事实: 'F_ava_needs', 内容: '四项需求' }], 完成条件: { 事实: 'F_ava_needs' } }] } }] };
  await openJob(inst, doc, click, pid, [s07, vol('S08')]);
  assert.match(doc.querySelector('.pi-lr').textContent, /这条线走不通/);
  assert.match(doc.querySelector('.pi-lr').textContent, /1 条需要看一下/);
  await inst.destroy();
});

test('inventedOpenIssue: a 线 condition needs the document to mention that line; "与8独立" does not count; independent lines must not get any condition', () => {
  const ident = [{ 编号: 'S03', 文档里的序号: '3' }, { 编号: 'S04', 文档里的序号: '4', 关系: '独立，可为后续认识律师米娅提供来源' }, { 编号: 'S07', 文档里的序号: '7' }, { 编号: 'S08', 文档里的序号: '8' }, { 编号: 'S10', 文档里的序号: '10', 关系: '默认在7完成后归还借用器材' }, { 编号: 'S12', 文档里的序号: '12', 关系: '与8独立，避免同一事故反复发生' }, { 编号: 'S13', 文档里的序号: '13', 关系: '默认发生在8之后' }];
  const v = (id, c, win) => ({ line: { 编号: id, 开启条件: c, ...win ? { 开启时段: win } : {} } });
  const mains = [{ id: 'M1', name: '遗留物' }];
  const t = (r) => r && r.text;
  assert.match(t(C.inventedOpenIssue(v('S04', { 线: 'S03 == 完成' }), ident, mains)), /要等 S03，但文档没提到它/);
  assert.equal(C.inventedOpenIssue(v('S10', { 线: 'S07 == 完成' }), ident, mains), null);
  assert.match(t(C.inventedOpenIssue(v('S12', { 线: 'S08 == 完成' }), ident, mains)), /要等 S08，但文档没提到它/);
  assert.equal(C.inventedOpenIssue(v('S13', { 线: 'S08 == 完成' }), ident, mains), null);
  assert.match(t(C.inventedOpenIssue(v('S04', { 事实: 'F_x' }), ident, mains)), /是独立的.*多了/);
  assert.equal(C.inventedOpenIssue(v('S04', {}), ident, mains), null);
  // GPT 代码审阅 R11 的三个漏报
  const m1 = C.inventedOpenIssue(v('S04', { 线: 'M1 == 完成' }), ident, mains);
  assert.match(t(m1), /要等 M1，但文档没提到它/, 'a main line not in the side identity table is not backed by default');
  assert.equal(m1.canDrop, true);
  const w = C.inventedOpenIssue(v('S04', undefined, { 主线: 'M1', 从: '调查' }), ident, mains);
  assert.match(t(w), /加了开启时段（M1）/, 'an independent line must not get a window either');
  const mix = C.inventedOpenIssue(v('S13', { 全部: [{ 线: 'S08 == 完成' }, { 事实: 'F_fake' }] }), ident, mains);
  assert.match(t(mix), /除了等线，还多了 事实: F_fake/, 'one backed line ref does not vouch for the whole compound condition');
  assert.equal(mix.canDrop, false, 'S13 really waits for S08: no one-click drop that would delete that too');
  // the document did not say anything: not "independent", only a soft hint, no drop button
  const silent = C.inventedOpenIssue(v('S07', { 事实: 'F_y' }), ident, mains);
  assert.equal(silent.level, 'warn');
  assert.equal(silent.canDrop, false);
  assert.doesNotMatch(silent.text, /是独立的/);
  // the document says something else and the AI wrote a table gate: a soft "check the wording" hint
  const gate = C.inventedOpenIssue(v('S30', { 表: '重要角色表/艾娃/阶段 >= 2' }), [{ 编号: 'S30', 关系: '可以与别的故事穿插' }], mains);
  assert.equal(gate.level, 'warn');
  assert.match(gate.text, /文档写的是：可以与别的故事穿插.*请核对原文/);
  // a main line the document names is backed
  assert.equal(C.inventedOpenIssue(v('S20', { 线: 'M1 == 完成' }), [{ 编号: 'S20', 关系: '遗留物主线结束后' }], mains), null);
});
