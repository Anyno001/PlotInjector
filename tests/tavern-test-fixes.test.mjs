// 2026-11-17 酒馆实测（导入审阅）后的修改：标点、线的显示名、并发整理、未保存导入的入口、提示词规则。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { loadCore } from './load.mjs';

const C = loadCore();
await import(new URL('../src/ui/app.js', import.meta.url).href).catch(() => null);
const UI = await import(new URL('../src/ui/long-import.js', import.meta.url).href);
const UIR = await import(new URL('../src/ui/import-review.js', import.meta.url).href);
const tick = () => new Promise((r) => setTimeout(r, 30));

// 借用 line-import 测试里的辅助函数（不连带跑它们的测试）
async function helpers(name, names, extra) {
  let text = extra(fs.readFileSync(new URL(name, import.meta.url), 'utf8'));
  text = text.replace("'./host-sim.mjs'", JSON.stringify(new URL('./host-sim.mjs', import.meta.url).href)).replace("'./load.mjs'", JSON.stringify(new URL('./load.mjs', import.meta.url).href));
  return import(`data:text/javascript,${encodeURIComponent(`${text}\nexport { ${names} };`)}`);
}
const LI = await helpers('./line-import.test.mjs', 'boot, rvWait, dlg, lineJob, IDX, linesYaml, vol', (s) => {
  const head = s.split('\ntest(')[0];
  const mid = s.slice(s.indexOf('// ---------- UI：批量导入'), s.indexOf("test('UI: bulk side import"));
  return head + '\n' + mid;
});
const SRC6 = ['# 支线方案', ...[1, 2, 3, 4, 5, 6].map((n) => [`## ${n} 支线${n}`, ...Array.from({ length: 30 }, () => `第${n}条支线的经过。`.repeat(8))].join('\n\n'))].join('\n\n');
const IDX6 = '```yaml\n梗概: x\n支线:\n' + [1, 2, 3, 4, 5, 6].map((n) => `  - {编号: S0${n}, 名称: 线${n}, 文档里的序号: "${n}", 本段有经过: true}`).join('\n') + '\n事实:\n  - {编号: F_a, 内容: x, 性质: 实物}\n```';

// ---------- 3：「获得」一行不出现「。；」 ----------
test('full node view: discoveries ending in 。 are joined without 「。；」', async () => {
  const { inst, doc, click, pid } = await LI.boot([]);
  try {
    const v = LI.vol('S01');
    v.stages[0].data.主线节点[0].发现 = [{ 事实: 'F_1', 内容: '老韩说看见了周先生。' }, { 事实: 'F_2', 内容: '老韩承认那晚雾大。' }];
    const job = await inst.data.imports.create({ projectId: pid, text: 'x', mode: 'lines', needs: '' });
    await inst.data.imports.update(job.id, (j) => ({ ...j, step: 'review', lineReview: { items: { S01: { vol: v, comment: '', lastComment: '', changed: [], dropped: false } }, order: ['S01'], conflicts: [] } }));
    inst.data.updateProject(pid, (p) => ({ ...p, imports: [...(p.imports || []), job.id] }));
    await click('[data-act="import-open-panel"]');
    await click(`[data-act="import-open"][data-id="${job.id}"]`);
    await LI.rvWait(doc);
    doc.querySelectorAll('.pi-rv-dots [data-act="rv-go"]')[1].click(); await tick();
    const full = doc.querySelector('[data-act="rv-full"]');
    full && (full.click(), await tick());
    const text = doc.querySelector('.pi-rv').textContent;
    assert.doesNotMatch(text, /。；/);
    assert.match(text, /老韩说看见了周先生；老韩承认那晚雾大。/);
  } finally { await inst.destroy(); }
});

// ---------- 5：线的显示名 ----------
test('volumeShowName: 编号 replaces 卷N; a key that already starts with the id is not doubled; no id falls back to the key', () => {
  assert.equal(C.volumeShowName({ key: '剧情_卷1_旧码头的账本', line: { 编号: 'M1' } }), 'M1 旧码头的账本');
  assert.equal(C.volumeShowName({ key: '剧情_S01_只看一个景点', line: { 编号: 'S01' } }), 'S01 只看一个景点');
  assert.equal(C.volumeShowName({ key: '剧情_第二部_旧案', line: { 编号: 'M2' } }), 'M2 第二部 旧案');
  assert.equal(C.volumeShowName({ key: '剧情_卷1_旧码头的账本' }), '卷1 旧码头的账本');
});

test('single-line import: the saved key uses the assigned line id instead of 卷1', async () => {
  const { inst, doc, click, pid, host } = await LI.boot([{ id: 'vM1', key: '剧情_卷1_第一案', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 's1', key: '阶段1_x', data: { 主线节点: [{ id: 'm1', 名称: 'm1', 入口: '去', 发现: [{ 事实: 'F1', 内容: 'x' }], 完成条件: { 事实: 'F1' } }] } }] }]);
  try {
    host.llm.reply = undefined;
    host.llm.respond = (body) => {
      if (/整理作者索引/.test(body)) return '```yaml\n梗概: x\n事实:\n  - {编号: F_b, 内容: y, 性质: 实物}\n```';
      return '```yaml\n剧情_卷1_第二案:\n  线:\n    类型: 主线\n    简介: 第二案\n    入口提示: 有人来找\n  阶段1_查:\n    主线节点:\n      - {id: n_b, 名称: 查, 入口: 去查, 发现: [{事实: F_b, 内容: y}], 完成条件: {事实: F_b}}\n```';
    };
    await click('[data-act="import-open-panel"]');
    doc.querySelector('[data-imp-text]').value = '第二案的原文。'.repeat(50);
    await click('[data-act="import-start"]');
    await LI.rvWait(doc);
    await click('[data-act="import-adopt"]');
    for (let i = 0; i < 3; i++) {
      const d = [...doc.querySelectorAll('.pi-dialog')].pop();
      const b = d && [...d.querySelectorAll('.pi-btn')].find((x) => ['仍然保存', '保存'].includes(x.textContent.trim()));
      if (!b) break;
      b.click(); await tick(); await tick();
    }
    const keys = inst.data.project(pid).outline.volumes.map((v) => v.key);
    assert.deepEqual([...keys], ['剧情_卷1_第一案', '剧情_M2_第二案']);
  } finally { await inst.destroy(); }
});

// ---------- 6：多条支线并发整理，最多 3 个 ----------
test('bulk import: batches inside one part run concurrently, never more than 3 at once; all lines arrive', async () => {
  const { host, inst, doc, click } = await LI.boot([]);
  try {
    let running = 0, peak = 0, drafts = 0;
    host.llm.reply = undefined;
    host.llm.respond = async (body) => {
      if (/整理作者索引/.test(body)) return IDX6;
      const only = /这一次\*\*只写\*\* ([S0-9、]+) 这几条/.exec(body), ids = only ? only[1].split('、') : ['S01'];
      running++; peak = Math.max(peak, running); drafts++;
      await new Promise((r) => setTimeout(r, 60));
      running--;
      return LI.linesYaml(ids);
    };
    const batches = C.importLineBatches(C.mergeLineIdentity([C.parseYaml(C.extractYaml(IDX6))]).lines, 0);
    assert.equal(batches.length, 2, 'six lines → two batches of three');
    await click('[data-act="import-open-panel"]');
    doc.querySelector('[data-imp-text]').value = SRC6;
    doc.querySelector('[data-imp-mode]').value = 'lines';
    await click('[data-act="import-start"]');
    await LI.rvWait(doc);
    assert.ok(peak >= 2, `batches overlap (peak ${peak})`);
    assert.ok(peak <= 3, `at most 3 at once (peak ${peak})`);
    assert.match(doc.querySelector('.pi-rv-state').textContent, /6 条/);
  } finally { await inst.destroy(); }
});

test('runPool limit is 3 in the source (user 2026-11-17)', () => {
  const src = fs.readFileSync(new URL('../src/ui/long-import.js', import.meta.url), 'utf8');
  assert.match(src, /const IMPORT_CONCURRENCY = 3;/);
});

// ---------- 7：审阅修改里提示还没保存的导入 ----------
test('edit review: an unsaved multi-line import is pointed to, with an 打开 button that opens it; once all its lines are saved the note goes away', async () => {
  const main = { id: 'vM', key: '剧情_M1_主线', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 'sm', key: '阶段1_调查', data: { 主线节点: [{ id: 'm1', 名称: 'm1', 入口: '去', 发现: [{ 事实: 'Fm', 内容: 'x' }], 完成条件: { 事实: 'Fm' } }] } }] };
  const { inst, doc, click, pid } = await LI.boot([main]);
  try {
    const job = await inst.data.imports.create({ projectId: pid, text: 'x', mode: 'lines', needs: '' });
    await inst.data.imports.update(job.id, (j) => ({ ...j, step: 'review', lineReview: { items: { S01: { vol: LI.vol('S01'), comment: '', lastComment: '', changed: [], dropped: false }, S02: { vol: LI.vol('S02'), comment: '', lastComment: '', changed: [], dropped: false } }, order: ['S01', 'S02'], conflicts: [] } }));
    inst.data.updateProject(pid, (p) => ({ ...p, imports: [...(p.imports || []), job.id] }));
    // 先打开一次让它建好审阅会话，再回到大纲
    await click('[data-act="import-open-panel"]');
    await click(`[data-act="import-open"][data-id="${job.id}"]`);
    await LI.rvWait(doc);
    await click('[data-act="import-close"]');
    await click('[data-act="review-open"]');
    for (let i = 0; i < 20 && !doc.querySelector('.pi-rv'); i++) await tick();
    const note = doc.querySelector('.pi-rv-pending');
    assert.ok(note, 'note shown on the edit review page');
    assert.match(note.textContent, /还有 2 条支线未保存到大纲。打开审阅/);
    note.querySelector('[data-act="import-open"]').click();
    for (let i = 0; i < 20 && !/导入的支线/.test(doc.querySelector('.pi-rv h3')?.textContent || ''); i++) await tick();
    assert.match(doc.querySelector('.pi-rv h3').textContent, /导入的支线/, 'opens the bulk import');
    // 全部保存后，提示消失
    await click('[data-act="import-adopt"]');
    await LI.dlg(doc, '保存');
    await click('[data-act="import-close"]');
    await click('[data-act="review-open"]');
    for (let i = 0; i < 20 && !doc.querySelector('.pi-rv'); i++) await tick();
    assert.ok(!doc.querySelector('.pi-rv-pending'), 'no note once every line is saved');
  } finally { await inst.destroy(); }
});

// ---------- 1 / 2 / 9：提示词规则 ----------
test('index prompt: name secrecy is judged by "can the narration call him this from the start", with general examples; no card-specific names', () => {
  const sys = C.importIndexMessages({ part: { i: 0, title: 't', text: 'x' }, total: 1 })[0].content;
  assert.match(sys, /故事一开始，叙述里能不能直接用这个名字称呼这个人/);
  assert.match(sys, /主角和主要同伴的名字（哪怕他有一重不让外人知道的身份）、公开使用的称号、代号、外号/);
  assert.doesNotMatch(sys, /蜘蛛侠|彼得·帕克/);
});

test('draft prompt: a node the text says can be skipped is 必需: false (necessary nodes block the stage end)', () => {
  const sys = C.importDraftMessages({ part: { i: 0, title: 't', text: 'x' }, index: '' })[0].content;
  assert.match(sys, /必需节点没完成，阶段就算满足了结束条件也不会结束/);
  assert.match(sys, /「可以不做」「可以跳过」「不经过也能继续」「没有它也行」的，这个节点一定写「必需: false」/);
});

test('line rules: a new line-opening fact gets a meaningful code with the line id and a sentence in 原开启条件; the label prompt sees that sentence', () => {
  const rules = C.CLUE_LINE_RULES.join('\n');
  assert.match(rules, /不要用 F30 这种流水号/);
  assert.match(rules, /把这件事写成一句话放进「原开启条件」/);
  const vols = [{ id: 'v', key: '剧情_S02_x', line: { 编号: 'S02', 类型: '支线', 开启条件: { 事实: 'F_s02_ask' }, 原开启条件: '玛雅通过叶莲娜请主角帮忙' }, stages: [{ id: 's', key: '阶段1_y', data: { 主线节点: [{ id: 'n', 名称: 'n', 入口: '去', 发现: [{ 事实: 'F_n', 内容: 'x' }], 完成条件: { 事实: 'F_n' } }] } }] }];
  const ctx = C.factLabelContext(vols).find((x) => x.code === 'F_s02_ask');
  assert.equal(ctx.record, '玛雅通过叶莲娜请主角帮忙');
  assert.match(C.factLabelMessages([ctx])[1].content, /玛雅通过叶莲娜请主角帮忙/);
});

// ---------- A / C / E：读不到表格的提醒、入口里主角的称呼、后面的段不重写线头 ----------
test('import page: when no database tables are readable, a note says table-based starts become manual', async () => {
  const { inst, doc, click, host } = await LI.boot([]);
  try {
    await click('[data-act="import-open-panel"]');
    assert.doesNotMatch(doc.body.textContent, /当前聊天读不到数据库表格/, 'tables readable → no note');
    host.w.AutoCardUpdaterAPI && (host.w.AutoCardUpdaterAPI.exportTableAsJson = () => { throw new Error('no db'); });
    inst.__view.renderBody(); await tick();
    assert.match(doc.body.textContent, /当前聊天读不到数据库表格。依赖表格的开始条件会先按手动开始整理/);
  } finally { await inst.destroy(); }
});

test('entry hint rule: the protagonist is called what the people in that line call him (title / code name / alias)', () => {
  assert.match(C.ENTRY_HINT_RULE, /主角的称呼跟着这条线里的人走：这条线里的人只知道他的某个称号、代号或化名时，入口里也用那个称呼/);
});

test('bulk import prompt: a line continued from an earlier part only adds stages; its head (brief, entry, start) is not rewritten', () => {
  const msgs = C.importLineDraftMessages({ part: { i: 1, title: 't', text: 'x' }, index: '', lines: [{ 编号: 'S01', 名称: 'a' }], only: ['S01'] });
  assert.match(msgs[0].content, /「线」下面只写编号和类型，简介、入口提示、开启条件、原开启条件前面已经写过，不要重写/);
});

// ---------- 跨段重写（实测 2026-11-17：S07 / S15 列出 35～45 条冲突、重复节点 id s07_final） ----------
test('bulk merge: a later part rewriting known nodes keeps the earlier text, lists one summary note, and a node moved into a new stage is not duplicated', () => {
  const node = (id, entry, gives) => ({ id, 名称: id, 入口: entry, 发现: [{ 事实: gives, 内容: `${gives}的内容` }], 完成条件: { 事实: gives } });
  const p1 = { id: 'a', key: '剧情_S07_扣子', line: { 编号: 'S07', 类型: '支线', 简介: '前一段的简介' }, stages: [{ id: 's1', key: '阶段1_样件', data: { AI指令: '前一段的指令', 主线节点: [node('s07_needs', '艾娃示范旧扣', 'F_needs'), node('s07_final', '第五天检查磨损', 'F_wear')] } }] };
  const p2 = { id: 'b', key: '剧情_S07_扣子', line: { 编号: 'S07', 类型: '支线', 简介: '后一段换了说法', 入口提示: '后一段才写的入口' }, stages: [
    { id: 's2', key: '阶段1_样件', data: { AI指令: '后一段重写的指令', 主线节点: [node('s07_needs', '艾娃把工具袋交给他', 'F_needs')] } },
    { id: 's3', key: '阶段2_收尾', data: { 主线节点: [node('s07_final', '另一种写法', 'F_wear'), node('s07_reply', '收到消息', 'F_reply')] } },
  ] };
  const out = C.mergeImportByLine([p1, p2]);
  const v = out[0];
  assert.equal(v.line.简介, '前一段的简介');
  assert.equal(v.line.入口提示, '后一段才写的入口', 'an empty head field is still filled');
  assert.equal(v.stages[0].data.AI指令, '前一段的指令');
  assert.equal(v.stages[0].data.主线节点.find((n) => n.id === 's07_needs').入口, '艾娃示范旧扣');
  const ids = v.stages.flatMap((s) => s.data.主线节点.map((n) => n.id));
  assert.deepEqual(ids, ['s07_needs', 's07_final', 's07_reply'], 'moved node kept once, in its first place; the new node is added');
  assert.equal(C.compileClue(out).errors.length, 0, 'no duplicate node id');
  assert.equal(out.conflicts.length, 1);
  assert.match(C.importConflictText(out.conflicts[0]), /线 S07 跨了几段.*（5 处）/, 'head 1 + stage AI指令 1 + same-stage 入口 1 + moved node (its 入口, the node itself) 2');
});

test('bulk merge: a later stage that only repeats known nodes is not added as an empty stage', () => {
  const node = (id, gives) => ({ id, 名称: id, 入口: '去', 发现: [{ 事实: gives, 内容: 'x' }], 完成条件: { 事实: gives } });
  const p1 = { id: 'a', key: '剧情_S15_饭', line: { 编号: 'S15', 类型: '支线' }, stages: [{ id: 's1', key: '阶段1_披萨', data: { 主线节点: [node('s15_a', 'F_a')] } }] };
  const p2 = { id: 'b', key: '剧情_S15_饭', line: { 编号: 'S15', 类型: '支线' }, stages: [{ id: 's2', key: '阶段1_披萨与节奏', data: { 主线节点: [node('s15_a', 'F_a')] } }] };
  const out = C.mergeImportByLine([p1, p2]);
  assert.deepEqual(out[0].stages.map((s) => s.key), ['阶段1_披萨']);
});

test('single-line import merge keeps listing conflicts one by one (unchanged)', () => {
  const a = { id: 'v', key: '剧情_卷一', stages: [{ id: 's', key: '阶段1_x', data: { 主线节点: [{ id: 'n1', 入口: '前', 发现: [{ 事实: 'F', 内容: 'x' }], 完成条件: { 事实: 'F' } }] } }] };
  const b = { id: 'v', key: '剧情_卷一', stages: [{ id: 's', key: '阶段1_x', data: { 主线节点: [{ id: 'n1', 入口: '后' }] } }] };
  const m = C.mergeImportParts([a, b]);
  assert.equal(m.conflicts.length, 1);
  assert.match(C.importConflictText(m.conflicts[0]), /n1 的「入口」两段写得不一样/);
});

test('run page line cards: 「卷1」 is dropped when the line has an id', async () => {
  const { lineDisplayName } = await import(new URL('../src/ui/clue-run.js', import.meta.url).href).catch(() => ({}));
  if (!lineDisplayName) return;
  assert.equal(lineDisplayName({ id: 'M1', name: '卷1·雾港旧案' }), 'M1 雾港旧案');
  assert.equal(lineDisplayName({ id: 'S01', name: 'S01·只看一个景点' }), 'S01 只看一个景点');
  assert.equal(lineDisplayName({ id: '', name: '卷1·雾港旧案' }), '卷1 雾港旧案');
});

// ---------- 第五轮 C1：前面的批次失败、后面的先写完，「继续」只重跑失败批次 ----------
const SRC12 = ['# 支线方案', ...Array.from({ length: 12 }, (_, k) => k + 1).map((n) => [`## ${n} 支线${n}`, ...Array.from({ length: 12 }, () => `第${n}条支线的经过。`.repeat(8))].join('\n\n'))].join('\n\n');
const ID = (n) => `S${String(n).padStart(2, '0')}`;
const IDX12 = '```yaml\n梗概: x\n支线:\n' + Array.from({ length: 12 }, (_, k) => `  - {编号: ${ID(k + 1)}, 名称: 线${k + 1}, 文档里的序号: "${k + 1}", 本段有经过: true}`).join('\n') + '\n事实:\n  - {编号: F_a, 内容: x, 性质: 实物}\n```';
async function firstBatchFails(env) {
  const { host, doc, click } = env;
  const asked = [];
  let running = 0, peak = 0, failOnce = true;
  host.llm.reply = undefined;
  host.llm.respond = async (body) => {
    if (/整理作者索引/.test(body)) return IDX12;
    const only = /这一次\*\*只写\*\* ([S0-9、]+) 这几条/.exec(body), ids = only ? only[1].split('、') : [];
    const part = /【本段材料：[^】]*】/.exec(body) && /## 1 支线1/.test(body) ? 1 : 2;
    asked.push(`${part}:${ids.join(',')}`);
    running++; peak = Math.max(peak, running);
    // 第一批晚一点、以失败告终；后面几批先写完
    await new Promise((r) => setTimeout(r, ids[0] === 'S01' ? 150 : 40));
    running--;
    if (ids[0] === 'S01' && failOnce) { failOnce = false; throw new Error('网络断了'); }
    return LI.linesYaml(ids);
  };
  await click('[data-act="import-open-panel"]');
  doc.querySelector('[data-imp-text]').value = SRC12;
  doc.querySelector('[data-imp-mode]').value = 'lines';
  await click('[data-act="import-start"]');
  for (let i = 0; i < 80 && !/转写失败|未完成/.test(doc.querySelector('.pi-card')?.textContent || ''); i++) await tick();
  return { asked, peak: () => peak };
}
test('round 5 C1: batch 1 fails after 2–4 finished → progress is honest; 继续 retries only batch 1 and all 12 lines arrive (same session)', async () => {
  const env = await LI.boot([]);
  const { inst, doc, click, pid } = env;
  try {
    const run = await firstBatchFails(env);
    const job = LI.lineJob(inst, pid);
    assert.equal(job.drafts[0].list.filter(Boolean).filter((x) => !x.error).length, 3, 'batches 2–4 kept');
    const card = doc.querySelector('.pi-card').textContent;
    assert.match(card, /已整理 0 段/, 'a part with a missing batch is not counted as done');
    assert.match(card, /第 1 段有 1 批未完成，其他结果已保存|S01、S02、S03 转写失败/);
    assert.ok(run.peak() <= 3);
    const before = run.asked.length;
    await click('[data-act="import-run"]');
    await LI.rvWait(doc);
    const again = run.asked.slice(before).filter((x) => x.startsWith('1:'));
    assert.deepEqual(again, ['1:S01,S02,S03'], `part 1: only the failed batch is asked again (${run.asked.slice(before).join(' | ')})`);
    assert.match(doc.querySelector('.pi-rv-state').textContent, /12 条/);
  } finally { await inst.destroy(); }
});

test('round 5 C1: the saved job has null holes; after reloading the plugin 继续 still works', async () => {
  const env = await LI.boot([]);
  const { host, inst, pid } = env;
  let inst2;
  try {
    const run = await firstBatchFails(env);
    const jobId = LI.lineJob(inst, pid).id;
    await inst.data.imports.flush?.();
    const saved = JSON.parse(host.files.get(`pi-i-${jobId}.json`) || 'null');
    saved && saved.drafts[0].list[0] !== undefined && assert.ok(saved.drafts[0].list[0] === null || saved.drafts[0].list[0].error, 'batch 1 is a hole or an error on disk');
    await inst.destroy();
    inst2 = host.load(); await inst2.ready;
    inst2.open(); await tick();
    const doc = host.w.document;
    const click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
    await click(`[data-act="project"][data-id="${pid}"]`);
    await click('[data-act="tab"][data-tab="outline"]');
    await click('[data-act="import-open-panel"]');
    await click(`[data-act="import-open"][data-id="${jobId}"]`);
    const before = run.asked.length;
    await click('[data-act="import-run"]');
    await LI.rvWait(doc);
    const again = run.asked.slice(before).filter((x) => x.startsWith('1:'));
    assert.deepEqual(again, ['1:S01,S02,S03'], `part 1: only the failed batch is asked again (${run.asked.slice(before).join(' | ')})`);
    assert.match(doc.querySelector('.pi-rv-state').textContent, /12 条/);
  } finally { await (inst2 || inst).destroy(); }
});

test('round 5 C1 core: lineBatchState / importFailedParts read null holes and count against the expected batches', () => {
  const job = { mode: 'lines', parts: [{ i: 0, title: 't' }], lineIdent: { lines: Array.from({ length: 12 }, (_, k) => ({ 编号: ID(k + 1), parts: [0] })) }, drafts: { 0: { list: [null, { volumes: [] }, { volumes: [] }, { volumes: [] }] } } };
  const st = UI.lineBatchState(job, { i: 0 });
  assert.deepEqual([st.want, st.ok, st.left], [4, 3, 1]);
  assert.deepEqual([...UI.importFailedParts(job).map((f) => f.why)], ['第 1 段有 1 批未完成，其他结果已保存']);
  job.drafts[0].list[0] = { only: ['S01', 'S02', 'S03'], error: 'x' };
  assert.match(UI.importFailedParts(job)[0].why, /S01、S02、S03 转写失败/);
  job.drafts[0].list[0] = { volumes: [] };
  assert.equal(UI.importFailedParts(job).length, 0);
});

// ---------- 第五轮 C2：跨阶段去重不能丢掉后一段真正新增的内容 ----------
test('round 5 C2: a node repeated in another stage brings a new discovery → it is merged into the original node; a condition that uses it still has a source', () => {
  const node = (id, gives, extra = {}) => ({ id, 名称: id, 入口: '去', 发现: gives.map((f) => ({ 事实: f, 内容: `${f}的内容` })), 完成条件: { 事实: gives[0] }, ...extra });
  const p1 = { id: 'a', key: '剧情_S01_x', line: { 编号: 'S01', 类型: '支线' }, stages: [{ id: 's1', key: '阶段1_前', data: { 主线节点: [node('s01_n0', ['F_OLD'])] } }] };
  const p2 = { id: 'b', key: '剧情_S01_x', line: { 编号: 'S01', 类型: '支线' }, stages: [{ id: 's2', key: '阶段2_后', data: { 主线节点: [node('s01_n0', ['F_OLD', 'F_NEW']), node('s01_n1', ['F_LATE'], { 开放条件: { 事实: 'F_NEW' } })] } }] };
  const out = C.mergeImportByLine([p1, p2]);
  const n0 = out[0].stages[0].data.主线节点.find((n) => n.id === 's01_n0');
  assert.deepEqual(n0.发现.map((d) => d.事实), ['F_OLD', 'F_NEW'], 'new discovery merged into the original node');
  assert.deepEqual(out[0].stages.flatMap((s) => s.data.主线节点.map((n) => n.id)), ['s01_n0', 's01_n1'], 'no duplicate position');
  assert.equal(C.compileClue(out).errors.length, 0);
  const issues = C.checkClueDraft(out, [], { applied: out });
  assert.ok(!issues.some((x) => /F_NEW/.test(x)), issues.join(' | '));
});

test('round 5 C2: a later stage with a repeated node and a new id-less world event keeps the world event', () => {
  const node = (id, f) => ({ id, 名称: id, 入口: '去', 发现: [{ 事实: f, 内容: 'x' }], 完成条件: { 事实: f } });
  const p1 = { id: 'a', key: '剧情_S01_x', line: { 编号: 'S01', 类型: '支线' }, stages: [{ id: 's1', key: '阶段1_前', data: { 主线节点: [node('s01_n0', 'F_A')] } }] };
  const p2 = { id: 'b', key: '剧情_S01_x', line: { 编号: 'S01', 类型: '支线' }, stages: [{ id: 's2', key: '阶段2_后', data: { 主线节点: [node('s01_n0', 'F_A')], 世界动态: ['城里传开了码头失火的消息'] } }] };
  const out = C.mergeImportByLine([p1, p2]);
  const later = out[0].stages.find((s) => s.key === '阶段2_后');
  assert.ok(later, 'the stage is kept because it has new content');
  assert.deepEqual(later.data.世界动态, ['城里传开了码头失火的消息']);
  assert.equal((later.data.主线节点 || []).length, 0, 'the repeated node is not duplicated');
});

// ---------- 第五轮 C3：AI / YAML 改开线事件时带回的新「原开启条件」要接住，标签模型拿新依据 ----------
test('round 5 C3: putUnit takes a new 原开启条件 when the reply gives one, keeps the old one when it does not; the label context follows', () => {
  const vols = [{ id: 'v', key: '剧情_S02_x', line: { 编号: 'S02', 类型: '支线', 开启条件: { 事实: 'F_letter' }, 原开启条件: '收到邮局通知' }, stages: [{ id: 's', key: '阶段1_y', data: { 主线节点: [{ id: 'n', 名称: 'n', 入口: '去', 发现: [{ 事实: 'F_n', 内容: 'x' }], 完成条件: { 事实: 'F_n' } }] } }] }];
  const changed = UIR.putUnit(vols, 'v/line', { line: { 编号: 'S02', 类型: '支线', 开启条件: { 事实: 'F_help' }, 原开启条件: '向导当面提出求助' } });
  assert.equal(changed[0].line.原开启条件, '向导当面提出求助');
  assert.equal(C.factLabelContext(changed, ['F_help'])[0].record, '向导当面提出求助');
  const kept = UIR.putUnit(vols, 'v/line', { line: { 编号: 'S02', 类型: '支线', 简介: '只改简介', 开启条件: { 事实: 'F_letter' } } });
  assert.equal(kept[0].line.原开启条件, '收到邮局通知', 'not provided → old basis kept');
  const locked = UIR.putUnit(vols, 'v/line', { line: { 编号: 'S99', 类型: '主线', 原开启条件: '新依据' } });
  assert.equal(locked[0].line.编号, 'S02'); assert.equal(locked[0].line.类型, '支线');
});

// ---------- 第五轮 C4：实际发给模型的提示词里没有具体测试卡的人名、没有「实测」来历 ----------
test('round 5 C4: composed prompts (index, single-line, multi-line, revise, line rules) carry no test-card names or 实测 notes', () => {
  const NAMES = /彼得|蜘蛛侠|叶莲娜|巴基|沃克|艾娃|玛雅|鲍勃|阿列克谢|马特奥|罗莎|维恩|梅森|德沃尔夫|雾港|实测/;
  const part = { i: 0, title: 't', text: '原文' };
  const texts = [
    ...C.importIndexMessages({ part, total: 1 }),
    ...C.importLineIndexMessages(C.importIndexMessages({ part, total: 1 })),
    ...C.importDraftMessages({ part, index: '', kind: 'main' }),
    ...C.importLineDraftMessages({ part, index: '', lines: [{ 编号: 'S01', 名称: 'a' }], only: ['S01'] }),
    ...C.reviewReviseMessages({ units: [{ key: 'v/line', kind: 'line', label: '线', yaml: '线: {}', comment: '改' }] }),
  ].map((m) => m.content);
  texts.push(C.CLUE_LINE_RULES.join('\n'), C.ENTRY_HINT_RULE, C.CLUE_OUTLINE_RULES_WITH_LINES);
  for (const t of texts) assert.doesNotMatch(t, NAMES, t.match(NAMES)?.[0]);
});

test('round 5: name-secrecy rule is narrowed: a correspondence between two usable names goes to 真实身份; a name that itself must wait is still secret', () => {
  const sys = C.importIndexMessages({ part: { i: 0, title: 't', text: 'x' }, total: 1 })[0].content;
  assert.match(sys, /两种称呼本身都可以在正文里出现、只是它们指同一个人这件事保密的，把这层对应写进「真实身份」/);
  assert.match(sys, /某个称呼本身也要等剧情揭晓才能出现的，那个称呼仍按上面的办法标/);
});

// ---------- 第五轮 U1：保存过、点「继续修改」重新打开的单条导入，不再被说成没保存 ----------
test('round 5 U1: a single-line import saved and then reopened (no edits) is not listed as unsaved; a never-saved one is', async () => {
  const { inst, doc, click, pid, host } = await LI.boot([{ id: 'vM1', key: '剧情_M1_第一案', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 's1', key: '阶段1_x', data: { 主线节点: [{ id: 'm1', 名称: 'm1', 入口: '去', 发现: [{ 事实: 'F1', 内容: 'x' }], 完成条件: { 事实: 'F1' } }] } }] }]);
  try {
    host.llm.reply = undefined;
    host.llm.respond = (body) => (/整理作者索引/.test(body) ? '```yaml\n梗概: x\n事实:\n  - {编号: F_b, 内容: y, 性质: 实物}\n```' : '```yaml\n剧情_卷1_第二案:\n  线:\n    类型: 主线\n    简介: 第二案\n    入口提示: 有人来找\n  阶段1_查:\n    主线节点:\n      - {id: n_b, 名称: 查, 入口: 去查, 发现: [{事实: F_b, 内容: y}], 完成条件: {事实: F_b}}\n```');
    await click('[data-act="import-open-panel"]');
    doc.querySelector('[data-imp-text]').value = '第二案的原文。'.repeat(50);
    await click('[data-act="import-start"]');
    await LI.rvWait(doc);
    // 还没保存：审阅修改顶上有提示
    await click('[data-act="import-close"]');
    await click('[data-act="review-open"]');
    for (let i = 0; i < 20 && !doc.querySelector('.pi-rv'); i++) await tick();
    assert.match(doc.querySelector('.pi-rv-pending')?.textContent || '', /还有一条主线未保存到大纲/);
    // 打开、保存、点「继续修改」
    doc.querySelector('.pi-rv-pending [data-act="import-open"]').click();
    for (let i = 0; i < 20 && !doc.querySelector('[data-act="import-adopt"]'); i++) await tick();
    const r = doc.querySelector('[data-rv-when="after"]'); r.checked = true; r.dispatchEvent(new doc.defaultView.Event('input', { bubbles: true })); await tick(); await tick();
    await click('[data-act="import-adopt"]');
    for (let i = 0; i < 3; i++) { const d = [...doc.querySelectorAll('.pi-dialog')].pop(); const b = d && [...d.querySelectorAll('.pi-btn')].find((x) => ['仍然保存', '保存'].includes(x.textContent.trim())); if (!b) break; b.click(); await tick(); await tick(); }
    assert.equal(inst.data.project(pid).outline.volumes.length, 2, 'saved');
    await click('[data-act="rv-reopen"]');
    await click('[data-act="import-close"]');
    await click('[data-act="review-open"]');
    for (let i = 0; i < 20 && !doc.querySelector('.pi-rv'); i++) await tick();
    assert.ok(!doc.querySelector('.pi-rv-pending'), 'saved-then-reopened is not reported as unsaved');
  } finally { await inst.destroy(); }
});
