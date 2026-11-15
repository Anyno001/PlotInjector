// 事实标签和登记口径的自动填写（雾港实测 2026-11-08：手写看不懂、写宽了登记偏早）。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadCore } from './load.mjs';
import { createHost } from './host-sim.mjs';

const C = loadCore();
const here = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/shujuku-default-template-spv8.9.2.json'), 'utf8'));
const tick = () => new Promise((r) => setTimeout(r, 20));
// the real 旧码头 shape, plus the messy cases: a vague discovery with no entry, and a fact used in a condition that no node produces
const VOLS = () => [{ id: 'v1', key: '剧情_卷1_旧码头', stages: [
  { id: 's1', key: '阶段1_证词', data: { 结束条件: { 任一: [{ 事实: 'F_han' }, { 事实: 'F_mark' }] }, 主线节点: [
    { id: 'n_han', 名称: '夜班看守老韩', 入口: '可以找看守问问那晚的事', 发现: [{ 事实: 'F_han', 内容: '老韩说看见周先生提着帆布包从后门出去', 记录: '老韩说出周先生和帆布包才算' }], 完成条件: { 事实: 'F_han' } },
    { id: 'n_mark', 名称: '后门', 必需: false, 发现: [{ 事实: 'F_mark', 内容: '好像有点什么' }], 完成条件: { 事实: 'F_mark' } },
  ] } },
  { id: 's2', key: '阶段2_账房', data: { 主线节点: [
    { id: 'n_desk', 名称: '账房', 入口: '去账房看看', 开放条件: { 事实: 'F_key' }, 发现: [{ 事实: 'F_doc', 内容: '出货单是白天签的，签字的是仓库主管' }], 完成条件: { 核实: 'F_doc' } },
  ] } },
] }];
const yamlReply = (lines) => ['```yaml', ...lines, '```'].join('\n');

test('context: each fact gets its node, entry, answer, record and the conditions that use it; orphan facts are included and flagged', () => {
  const ctx = new Map(C.factLabelContext(VOLS()).map((x) => [x.code, x]));
  assert.equal(ctx.get('F_han').nodeName, '夜班看守老韩');
  assert.match(ctx.get('F_han').answer, /帆布包/);
  assert.match(ctx.get('F_han').usedBy.join(), /阶段1 证词的结束条件（事实）/);
  assert.match(ctx.get('F_doc').usedBy.join(), /n_desk的完成条件（核实）/);
  assert.equal(ctx.get('F_key').orphan, true, 'used by a condition, produced by no node');
  assert.equal(ctx.get('F_mark').entry, '', 'vague discovery: no entry, passed through as is');
});

test('prompt: answers are marked as answers; secrets listed; asks for conservative wording and an unsure note instead of guessing', () => {
  const m = C.factLabelMessages(C.factLabelContext(VOLS()), { secrets: ['仓库主管的侄子'] });
  assert.match(m[0].content, /不一定严丝合缝/);
  assert.match(m[0].content, /宁可登记得晚，不要登记得早/);
  assert.match(m[0].content, /unsure/);
  assert.match(m[0].content, /仓库主管的侄子/);
  assert.match(m[1].content, /发现内容（答案，不能写进标签和口径）: 老韩说看见周先生/);
  assert.match(m[1].content, /注意：大纲里没有节点产出这个事实/);
});

test('parse + warnings: missing codes reported; answer overlap, secret names, unsure notes and vague criteria are flagged', () => {
  const codes = ['F_han', 'F_mark', 'F_doc', 'F_key'];
  const reply = yamlReply([
    '- {编号: F_han, 标签: 看守的证词, 口径: 看守当面说出那晚看到了什么时登记，记为存疑；推托没开口不算}',
    '- {编号: F_mark, 标签: 后门外的痕迹, 口径: 主角看清后门外地上是什么痕迹时登记；只看到有痕迹、还没看清不算, unsure: 原文对这条发现写得很含糊，看不出具体是什么}',
    '- {编号: F_doc, 标签: 抽屉里的单据, 口径: 读到单据写着白天签的、签字的是仓库主管时登记}',
    '- {编号: F_ghost, 标签: 不该出现, 口径: x}',
  ]);
  const r = C.parseFactLabels(reply, codes);
  assert.deepEqual([...r.missing], ['F_key']);
  assert.ok(!r.items.has('F_ghost'), 'codes not asked for are ignored');
  const ctx = new Map(C.factLabelContext(VOLS()).map((x) => [x.code, x]));
  assert.deepEqual([...C.factLabelWarnings(r.items.get('F_han'), ctx.get('F_han'))], []);
  assert.match(C.factLabelWarnings(r.items.get('F_mark'), ctx.get('F_mark')).join(), /模型拿不准：原文对这条发现写得很含糊/);
  assert.match(C.factLabelWarnings(r.items.get('F_doc'), ctx.get('F_doc')).join(), /口径里有答案的片段/);
  assert.match(C.factLabelWarnings({ label: '侄子的单据', criterion: '读到时登记，没读到不算' }, {}, { secrets: ['侄子'] }).join(), /保密的名字「侄子」/);
  assert.match(C.factLabelWarnings({ label: '痕迹', criterion: '看到痕迹时登记' }, {}).join(), /没写清楚什么情况不算/);
  assert.match(C.factLabelWarnings({ label: '', criterion: '' }, { orphan: true }).join(), /还没有标签.*还没有登记口径.*没有节点产出/);
});

test('dialog: 自动填写 fills only empty boxes, flags rows that need a look, and the import writes what the author sees', async () => {
  const host = createHost({ tables: JSON.parse(JSON.stringify(DEFAULT)) });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('旧码头');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: VOLS() }, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  doc.querySelector('[data-act="clue-gen-template"]').click(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  assert.match(dlg.textContent, /这份大纲里有 4 条要追踪的线索/);
  // the dialog says what this step is for, and each row says which clue it is (stage, node, the answer — shown to the author only)
  assert.match(dlg.textContent, /这一步在做什么/);
  assert.match(dlg.textContent, /拿到了，后面的剧情才会开放/);
  const firstRow = dlg.querySelector('[data-fr-row]');
  assert.match(firstRow.textContent, /阶段1 证词 · 夜班看守老韩/);
  assert.match(firstRow.textContent, /这条线索查到的是：老韩说看见周先生/);
  assert.match(firstRow.textContent, /只给你看，不会写进表格/);
  // the technical change list is folded
  assert.ok(dlg.querySelector('details.pi-fr-more'), 'change list folded');
  const idx = (code) => [...dlg.querySelectorAll('[data-fr-row]')].findIndex((r) => r.querySelector('.pi-fr-hd .pi-meta').textContent === code);
  // the author already typed one label: auto-fill must not overwrite it
  dlg.querySelector(`[data-gt-label="${idx('F_han')}"]`).value = '我自己写的';
  host.llm.reply = undefined;
  // first call writes the labels; the second call reviews every auto-filled row, and rewrites the leaking one
  const reviewed = [];
  host.llm.respond = (body) => {
    if (/有没有剧透/.test(body)) {
      reviewed.push(body);
      return yamlReply(['- {编号: F_doc, 透露: 是, 透露了什么: 写出了出货的时间, 改成口径: 主角打开抽屉、读到出货单时登记；只看到锁着的抽屉不算}']);
    }
    assert.match(body, /发现内容（答案/);
    return yamlReply([
      '- {编号: F_han, 标签: 看守的证词, 口径: 看守当面说出那晚看到了什么时登记，记为存疑；推托没开口不算}',
      '- {编号: F_mark, 标签: 后门外的痕迹, 口径: 看清痕迹时登记；没看清不算, unsure: 发现写得含糊}',
      '- {编号: F_doc, 标签: 抽屉里的单据, 口径: 读到出货单是白天签的时登记}',
    ]);
  };
  dlg.querySelector('[data-fr-auto]').click();
  for (let i = 0; i < 30 && !/已填好/.test(dlg.querySelector('[data-fr-status]').textContent); i++) await tick();
  assert.match(dlg.querySelector('[data-fr-status]').textContent, /已填好 3 条，1 条没生成（F_key）/);
  assert.match(dlg.querySelector('[data-fr-status]').textContent, /1 条原来的写法会透露答案，已经自动改好/);
  assert.equal(reviewed.length, 1, 'one review call');
  assert.match(reviewed[0], /F_doc/);
  assert.match(reviewed[0], /F_mark/, 'every auto-filled row is reviewed, not only the ones the script flagged');
  assert.match(reviewed[0], /编号: F_han/, 'F_han had its criterion auto-filled, so it is reviewed (with the label the author typed)');
  assert.equal(dlg.querySelector(`[data-gt-label="${idx('F_han')}"]`).value, '我自己写的', 'author text kept');
  assert.match(dlg.querySelector(`[data-gt-crit="${idx('F_han')}"]`).value, /推托没开口不算/, 'empty criterion filled');
  const warnOf = (code) => dlg.querySelector(`[data-fr-warn="${idx(code)}"] .pi-warn-line`)?.textContent || '';
  const noteOf = (code) => [...dlg.querySelectorAll(`[data-fr-warn="${idx(code)}"] .pi-note-line`)].map((x) => x.textContent).join();
  assert.equal(dlg.querySelector(`[data-gt-crit="${idx('F_doc')}"]`).value, '主角打开抽屉、读到出货单时登记；只看到锁着的抽屉不算', 'leaking criterion rewritten');
  assert.equal(warnOf('F_doc'), '');
  assert.match(noteOf('F_doc'), /已自动改写/);
  // the model's own advice is a grey note, not a yellow warning
  assert.equal(warnOf('F_mark'), '');
  assert.match(noteOf('F_mark'), /发现写得含糊/);
  assert.ok(!dlg.querySelector(`[data-fr-row="${idx('F_mark')}"]`).classList.contains('is-warn'));
  assert.equal(warnOf('F_han'), '');
  assert.match(warnOf('F_key'), /还没有标签/);
  // editing a row by hand re-checks it with the script only (no model call); a literal overlap is yellow again
  const crit = dlg.querySelector(`[data-gt-crit="${idx('F_doc')}"]`);
  crit.value = '读到出货单是白天签的时登记；没读到不算';
  crit.dispatchEvent(new host.w.Event('input', { bubbles: true }));
  assert.match(warnOf('F_doc'), /口径里有答案的片段/);
  crit.value = '主角打开抽屉、读到单据内容时登记；只看到锁着的抽屉不算';
  crit.dispatchEvent(new host.w.Event('input', { bubbles: true }));
  assert.equal(warnOf('F_doc'), '');
  dlg.querySelector(`[data-gt-label="${idx('F_key')}"]`).value = '钥匙';
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '导入到当前聊天').click(); await tick(); await tick();
  const facts = Object.values(host.db.tables).find((s) => s && s.name === '关键事实表').content.slice(1);
  const byCode = Object.fromEntries(facts.map((r) => [r[1], r]));
  assert.equal(byCode.F_han[2], '我自己写的');
  assert.equal(byCode.F_doc[3], '主角打开抽屉、读到单据内容时登记；只看到锁着的抽屉不算');
  assert.equal(host.llmCalls.length, 2, 'one call to write, one to review the flagged rows');
  await inst.destroy();
});

test('warnings: words the body already sees (entry, place, scene) are not treated as answer leaks; the real answer still is', () => {
  // 真实「旧码头」大纲里，「上锁的抽屉」写在场景里（正文到场就能看到），是取得动作，不是答案。
  const ctx = { nodeName: '账房里上锁的抽屉', entry: '可以进账房看看', scene: '桌边的抽屉上锁的抽屉锁着', answer: '打开上锁的抽屉，里面是出货单原件：那批货是在白天正常出库的' };
  assert.deepEqual([...C.factLabelWarnings({ label: '抽屉里的单据', criterion: '主角亲手打开上锁的抽屉、读到原件内容时登记；只看到锁着的抽屉不算' }, ctx)], []);
  assert.match(C.factLabelWarnings({ label: '抽屉里的单据', criterion: '读到白天正常出库时登记；没读到不算' }, ctx).join(), /口径里有答案的片段/);
});
test('第五轮 3b: the author-only node name is not public text, so an answer copied from it is still caught', () => {
  const ctx = { nodeName: '密令藏在钟楼', entry: '去城里打听', answer: '密令藏在钟楼' };
  assert.match(C.factLabelWarnings({ label: '密令藏在钟楼', criterion: '读到密令时登记；没读到不算' }, ctx).join(), /标签里有答案的片段/);
});
test('第五轮 3c: only explicit negatives count as "says what does not count"', () => {
  const w = (c) => C.factLabelWarnings({ label: '原件', criterion: c }, {}).join();
  assert.match(w('到仓库门口才算'), /没写清楚什么情况不算/);
  assert.ok(!/没写清楚什么情况不算/.test(w('读到原件时登记，仅仅路过不计入')));
  assert.ok(!/没写清楚什么情况不算/.test(w('读到原件时登记；只看到锁着的抽屉不算')));
});
test('第五轮 5: a fact produced by two nodes sends both ways of getting it to the model, and checks both answers', () => {
  const vols = [{ id: 'v', key: '剧情_卷一', stages: [{ id: 's', key: '阶段1_x', data: { 主线节点: [
    { id: 'nLog', 名称: '物流单', 入口: '去调度室翻单子', 发现: [{ 事实: 'F_addr', 内容: '冷库在红钩17号', 记录: '读到单子上的地址' }], 完成条件: { 事实: 'F_addr' } },
    { id: 'nWit', 名称: '证人', 入口: '去找马特奥', 发现: [{ 事实: 'F_addr', 内容: '马特奥说货送去了城东旧冰厂', 记录: '马特奥当面说出地址' }], 完成条件: { 事实: 'F_addr' } },
  ] } }] }];
  const [ctx] = C.factLabelContext(vols);
  assert.equal(ctx.routes.length, 1);
  const body = C.factLabelMessages([ctx])[1].content;
  assert.match(body, /物流单/); assert.match(body, /另一种取得方式 1: 阶段1 x · 证人/); assert.match(body, /马特奥当面说出地址/);
  assert.match(C.factLabelMessages([ctx])[0].content, /口径要把每种方式都包括进去/);
  assert.match(C.factLabelWarnings({ label: '地址', criterion: '听到城东旧冰厂时登记；没听到不算' }, ctx).join(), /口径里有答案的片段/, 'second route answer is checked too');
});

test('review: a literal overlap the review clears stays grey; a failed review falls back to the script warning', async () => {
  const host = createHost({ tables: JSON.parse(JSON.stringify(DEFAULT)) });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('旧码头');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: VOLS() }, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  const open = async () => { doc.querySelector('[data-act="clue-gen-template"]').click(); await tick(); return doc.querySelector('.pi-dialog'); };
  const write = yamlReply([
    '- {编号: F_han, 标签: 看守的证词, 口径: 看守当面说出那晚看到了什么时登记，记为存疑；推托没开口不算}',
    '- {编号: F_mark, 标签: 后门外的痕迹, 口径: 看清痕迹时登记；没看清不算}',
    '- {编号: F_doc, 标签: 抽屉里的单据, 口径: 读到出货单是白天签的时登记；没读到不算}',
    '- {编号: F_key, 标签: 钥匙, 口径: 拿到钥匙时登记；没拿到不算}',
  ]);
  let dlg = await open();
  const idx = (code) => [...dlg.querySelectorAll('[data-fr-row]')].findIndex((r) => r.querySelector('.pi-fr-hd .pi-meta').textContent === code);
  host.llm.respond = (body) => (/有没有剧透/.test(body) ? yamlReply(['- {编号: F_doc, 透露: 否}']) : write);
  dlg.querySelector('[data-fr-auto]').click();
  for (let i = 0; i < 30 && !/已填好/.test(dlg.querySelector('[data-fr-status]').textContent); i++) await tick();
  const row = dlg.querySelector(`[data-fr-row="${idx('F_doc')}"]`);
  assert.equal(row.querySelector('.pi-warn-line'), null, 'review said no leak: no yellow');
  assert.ok(!row.classList.contains('is-warn'));
  assert.match(dlg.querySelector('[data-fr-status]').textContent, /1 条标黄/, 'only F_key (no node produces it) stays yellow');
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '取消').click(); await tick();
  // the review call fails: the script's literal overlap is shown in yellow, and the status says the check did not finish
  dlg = await open();
  host.llm.respond = (body) => { if (/有没有剧透/.test(body)) throw new Error('超时'); return write; };
  dlg.querySelector('[data-fr-auto]').click();
  for (let i = 0; i < 30 && !/已填好/.test(dlg.querySelector('[data-fr-status]').textContent); i++) await tick();
  assert.match(dlg.querySelector('[data-fr-status]').textContent, /检查没完成（超时）/);
  assert.match(dlg.querySelector(`[data-fr-row="${idx('F_doc')}"] .pi-warn-line`).textContent, /口径里有答案的片段/);
  await inst.destroy();
});

test('review prompt and parser: three-step rule, pieces passed in; 是/否 parsed, unknown values are null', () => {
  const m = C.factLabelReviewMessages([{ code: 'F_a', label: '抽屉里的单据', criterion: '读到时登记', answer: '签字的是主管', entry: '去账房', scene: '', pieces: ['签字的是'] }]);
  assert.match(m[0].content, /拆成具体的信息点/);
  assert.match(m[0].content, /缩小了范围/);
  assert.match(m[1].content, /和答案字面重合的片段: 签字的是/);
  const r = C.parseFactLabelReview(yamlReply(['- {编号: F_a, 透露: 是, 透露了什么: 写出签字人, 改成标签: 单据}', '- {编号: F_b, 透露: 否}', '- {编号: F_c, 透露: 也许}', '- {编号: F_x, 透露: 是}']), ['F_a', 'F_b', 'F_c']);
  assert.deepEqual({ ...r.get('F_a') }, { leak: true, what: '写出签字人', label: '单据', criterion: '' });
  assert.equal(r.get('F_b').leak, false);
  assert.equal(r.get('F_c').leak, null);
  assert.equal(r.has('F_x'), false, 'unknown codes ignored');
});

// ---------- GPT 代码审阅（9c4e216）R5：复审结果只用在送审时那份文字上 ----------
test('R5: editing a row while the review is pending keeps the edit; the old verdict neither clears the warning nor overwrites the text', async () => {
  const host = createHost({ tables: JSON.parse(JSON.stringify(DEFAULT)) });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('旧码头');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: VOLS() }, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  doc.querySelector('[data-act="clue-gen-template"]').click(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  const idx = (code) => [...dlg.querySelectorAll('[data-fr-row]')].findIndex((r) => r.querySelector('.pi-fr-hd .pi-meta').textContent === code);
  let release;
  const gate = new Promise((r) => { release = r; });
  host.llm.respond = async (body) => {
    if (/有没有剧透/.test(body)) {
      await gate;
      return yamlReply(['- {编号: F_doc, 透露: 否}', '- {编号: F_han, 透露: 是, 透露了什么: x, 改成口径: 改写后的口径；没说不算}']);
    }
    return yamlReply([
      '- {编号: F_han, 标签: 看守的证词, 口径: 看守当面说出那晚看到了什么时登记；推托没开口不算}',
      '- {编号: F_mark, 标签: 后门外的痕迹, 口径: 看清痕迹时登记；没看清不算}',
      '- {编号: F_doc, 标签: 抽屉里的单据, 口径: 读到单据时登记；没读到不算}',
      '- {编号: F_key, 标签: 钥匙, 口径: 拿到钥匙时登记；没拿到不算}',
    ]);
  };
  dlg.querySelector('[data-fr-auto]').click();
  for (let i = 0; i < 30 && !/正在检查/.test(dlg.querySelector('[data-fr-status]').textContent); i++) await tick();
  // while the review is pending, the author edits two rows
  const crit = (code) => dlg.querySelector(`[data-gt-crit="${idx(code)}"]`);
  crit('F_doc').value = '读到出货单是白天签的时登记；没读到不算';
  crit('F_doc').dispatchEvent(new host.w.Event('input', { bubbles: true }));
  crit('F_han').value = '我自己改的口径；没说不算';
  crit('F_han').dispatchEvent(new host.w.Event('input', { bubbles: true }));
  release();
  for (let i = 0; i < 30 && !/已填好/.test(dlg.querySelector('[data-fr-status]').textContent); i++) await tick();
  assert.match(dlg.querySelector(`[data-fr-row="${idx('F_doc')}"] .pi-warn-line`)?.textContent || '', /口径里有答案的片段/, 'the old 透露:否 does not clear the new text');
  assert.equal(crit('F_han').value, '我自己改的口径；没说不算', 'the old rewrite does not overwrite the edit');
  await inst.destroy();
});
