// 大型项目方案 第 1 批（作者侧，2026-11-18）：改写只改选中的线、标签分批与「已审过」、大纲历史软上限。
// 每条都对应方案 四.1–四.3 的验收；改写在真实面板里跑。
import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';
import { buildTemplate, BINDING_YAML } from '../templates/clue-tables/build-template.mjs';

const C = loadCore();
const tick = () => new Promise((r) => setTimeout(r, 20));
const keys = (v) => JSON.parse(JSON.stringify(v.stages.map((s) => s.key)));

// 三条线：M1 正在玩；S3 没开始，产出 F_s3a、F_s3b；M2 的节点完成条件要用 F_s3a。
const node = (id, fact, extra = {}) => ({ id, 名称: id, 入口: `去${id}`, 发现: [{ 事实: fact, 内容: `${id}查到的`, 记录: `看到${id}时登记` }], 完成条件: { 事实: fact }, ...extra });
function volumes() {
  return [
    { id: 'vM1', key: '剧情_M1_街区', line: { 编号: 'M1', 类型: '主线' }, stages: [
      { id: 'sM1a', key: '阶段1_开场', data: { 主线节点: [node('n_m1a', 'F_m1a')] } },
      { id: 'sM1b', key: '阶段2_追查', data: { 主线节点: [node('n_m1b', 'F_m1b')] } },
    ] },
    { id: 'vS3', key: '剧情_S3_旧仓库', line: { 编号: 'S3', 类型: '支线', 简介: '旧仓库里的货' }, stages: [
      { id: 'sS3a', key: '阶段1_仓库', data: { 主线节点: [node('n_s3a', 'F_s3a'), node('n_s3b', 'F_s3b')] } },
      { id: 'sS3b', key: '阶段2_收尾', data: { 主线节点: [node('n_s3c', 'F_s3c')] } },
    ] },
    { id: 'vM2', key: '剧情_M2_码头', line: { 编号: 'M2', 类型: '主线', 接上一条: true }, stages: [
      { id: 'sM2a', key: '阶段1_码头', data: { 主线节点: [node('n_m2a', 'F_m2a', { 完成条件: { 全部: [{ 事实: 'F_m2a' }, { 事实: 'F_s3a' }] } })] } },
    ] },
  ];
}

// ---------- core ----------
test('replaceLineRest: only the target line changes; other lines (and edits made meanwhile) stay; extra volumes in the reply are ignored', () => {
  const vols = volumes();
  vols[2].stages[0].data.AI指令 = '请求期间作者改的 M2';
  const incoming = [
    { key: '剧情_S3_旧仓库', stages: [{ id: 'new1', key: '阶段1_新仓库', data: { 主线节点: [node('n_s3a', 'F_s3a')] } }] },
    { key: '剧情_M2_码头', stages: [{ id: 'bad', key: '阶段1_被AI顺手改了', data: {} }] },
  ];
  const next = C.replaceLineRest(vols, 'sS3a', incoming);
  assert.deepEqual(next.map((v) => v.id), ['vM1', 'vS3', 'vM2']);
  assert.deepEqual(next[1].stages.map((s) => s.key), ['阶段1_新仓库'], 'S3 from its first stage is replaced');
  assert.equal(next[2].stages[0].key, '阶段1_码头', 'M2 untouched even though the reply had it');
  assert.equal(next[2].stages[0].data.AI指令, '请求期间作者改的 M2', 'edit made during the request kept');
  assert.equal(next[0], vols[0], 'M1 is the same object');
  // from a later stage: earlier stages of the same line kept
  const mid = C.replaceLineRest(vols, 'sS3b', [{ key: '剧情_S3_旧仓库', stages: [{ id: 'x', key: '阶段2_改', data: {} }] }]);
  assert.deepEqual(mid[1].stages.map((s) => s.key), ['阶段1_仓库', '阶段2_改']);
  assert.equal(C.replaceLineRest(vols, 'gone', incoming), null);
  // a single-volume reply under another key still belongs to the target line
  assert.deepEqual(C.pickLineIncoming(vols[1], [{ key: '剧情_改名了', stages: [{ id: 'y' }] }]).stages.map((s) => s.id), ['y']);
});

test('rewriteByLine: only multi-volume projects with 线: are rewritten per line; old sequential books keep the whole-book rewrite', () => {
  assert.equal(C.rewriteByLine(volumes()), true);
  assert.equal(C.rewriteByLine(volumes().map(({ line, ...v }) => v)), false, 'no 线: → sequential');
  assert.equal(C.rewriteByLine([volumes()[0]]), false, 'one volume');
});

test('crossLineLoss: removing a fact another line still uses is reported before writing', () => {
  const vols = volumes();
  const next = C.replaceLineRest(vols, 'sS3a', [{ key: '剧情_S3_旧仓库', stages: [{ id: 'n', key: '阶段1_x', data: { 主线节点: [node('n_s3b', 'F_s3b')] } }] }]);
  const lost = C.crossLineLoss(vols, next, 'vS3');
  assert.equal(lost.length, 1);
  assert.match(lost[0], /M2 码头.*F_s3a/);
  assert.deepEqual(C.crossLineLoss(vols, C.replaceLineRest(vols, 'sS3a', [{ key: '剧情_S3_旧仓库', stages: vols[1].stages }]), 'vS3'), []);
});

test('otherLinesText: a compact reference (ids, facts, what uses the target) — not the other lines\' text', () => {
  const t = C.otherLinesText(volumes(), 'vS3');
  assert.match(t, /M1 街区/);
  assert.match(t, /M2 码头[\s\S]*用到这条线的：F_s3a/);
  assert.ok(!t.includes('S3旧仓库') && !t.includes('S3 '), 'the target line itself is not listed');
  assert.ok(!t.includes('查到的'), 'no discovery text of other lines');
});

test('rewrite prompts: per-line mode sends only the target line\'s rest plus the reference', () => {
  const vols = volumes(), units = C.flattenUnits(vols);
  const rest = units.filter((u) => u.volume.id === 'vS3');
  const [sys, user] = C.rewriteRestMessages({ setting: '', volumes: vols, fromUnitIndex: 2, units, recent: '', reason: '', rest, others: C.otherLinesText(vols, 'vS3') });
  assert.match(sys.content, /只改写【需要改写的剩余阶段】里的这一条剧情线/);
  assert.match(user.content, /【需要改写的剩余阶段】\n剧情_S3_旧仓库/);
  assert.ok(!/【需要改写的剩余阶段】[\s\S]*剧情_M2_码头:/.test(user.content), 'M2 is not in the rest');
  assert.match(user.content, /【其他剧情线（只作参考，不能改动）】/);
  const [, cu] = C.clueRewriteMessages({ setting: '', volumes: vols, fromUnitIndex: 2, units, recent: '', reason: '', rest, others: 'REF' });
  assert.match(cu.content, /剧情_S3_旧仓库/);
  assert.ok(!cu.content.includes('剧情_M2_码头:'));
  // old behaviour unchanged without rest
  const [, old] = C.rewriteRestMessages({ setting: '', volumes: vols, fromUnitIndex: 2, units, recent: '', reason: '' });
  assert.match(old.content, /剧情_M2_码头:/);
});

// ---------- labels ----------
test('labels: four sources kept apart — old (no field), user, gen (to review), ai; only gen comes back, as review-only', () => {
  const vols = volumes();
  const first = C.labelsToPrepare(vols, {});
  const sig = Object.fromEntries(first.map((x) => [x.code, x.sig]));
  const stored = C.normalizeClue({ labels: {
    F_m1a: { label: 'a', criterion: 'c', sig: sig.F_m1a },
    F_m1b: { label: 'b', criterion: 'c', sig: sig.F_m1b, src: 'gen' },
    F_m2a: { label: 'm', criterion: 'c', sig: sig.F_m2a, src: 'ai' },
    F_s3c: { label: 'u', criterion: 'c', sig: sig.F_s3c, src: 'user' },
    F_s3b: { label: 'x', criterion: 'c', sig: sig.F_s3b, rv: false },
  } }).labels;
  assert.equal(stored.F_m1a.src, undefined, 'old labels: no field (旧标签沿用)');
  assert.equal(stored.F_m2a.src, 'ai');
  assert.equal(stored.F_s3c.src, 'user');
  assert.equal(stored.F_s3b.src, 'gen', 'older rv:false is read as gen');
  const todo = C.labelsToPrepare(vols, stored);
  for (const c of ['F_m1a', 'F_m2a', 'F_s3c']) assert.ok(!todo.some((x) => x.code === c), `${c} is not re-processed`);
  const b = todo.find((x) => x.code === 'F_m1b');
  assert.deepEqual(b.review, { label: 'b', criterion: 'c' }, 'only review is left, no regeneration');
  assert.ok(todo.find((x) => x.code === 'F_s3a') && !todo.find((x) => x.code === 'F_s3a').review, 'labels are by project, not by what this chat plays');
});

test('reviewOutcome: missing code, no verdict, or leak without a fix are not reviewed', () => {
  const sent = { label: 'L', criterion: 'K' };
  assert.equal(C.reviewOutcome(undefined, sent).ok, false);
  assert.equal(C.reviewOutcome({ leak: null }, sent).ok, false);
  assert.equal(C.reviewOutcome({ leak: true, label: '', criterion: '' }, sent).ok, false);
  assert.deepEqual(C.reviewOutcome({ leak: false }, sent), { ok: true, label: 'L', criterion: 'K' });
  assert.deepEqual(C.reviewOutcome({ leak: true, label: '', criterion: '新口径' }, sent), { ok: true, label: 'L', criterion: '新口径' });
});

test('labelBatches: split by count and by size; a single oversized item gets its own batch', () => {
  const items = Array.from({ length: 95 }, (_, i) => ({ n: i }));
  assert.deepEqual(C.labelBatches(items, () => 10).map((b) => b.length), [40, 40, 15]);
  assert.deepEqual(C.labelBatches([1, 2, 3, 4], (x) => (x === 2 ? 1e6 : 10), { maxChars: 100 }).map((b) => b), [[1], [2], [3, 4]]);
  assert.deepEqual(C.labelBatches([], () => 1), []);
});

// ---------- history ----------
test('outline history: soft cap drops the oldest above the limit but keeps the latest 3', () => {
  const big = (n) => ({ at: n, text: 'x'.repeat(8e5) });
  const list = C.trimOutlineHistory([big(1), big(2), big(3), big(4), big(5)]);
  assert.equal(list.length, 3, 'over 2M → down to 3');
  assert.deepEqual(list.map((x) => x.at), [1, 2, 3], 'the newest (front) are kept');
  const small = Array.from({ length: 10 }, (_, i) => ({ at: i, text: 'y' }));
  assert.equal(C.trimOutlineHistory(small).length, 10, 'under the limit nothing is dropped');
  const huge = [{ at: 1, text: 'z'.repeat(3e6) }, { at: 2, text: 'z'.repeat(3e6) }];
  assert.equal(C.trimOutlineHistory(huge).length, 2, 'never below 3 even when it stays over the limit');
});

// ---------- panel: outline mode rewrite of a line that is not being played ----------
async function setup() {
  const tables = buildTemplate({ controlRow: ['主线', ''], factRows: [], knowRows: [] });
  const host = createHost({ tables });
  const inst = host.load();
  await inst.ready;
  const p = await inst.data.createProject('多线');
  inst.data.updateProject(p.id, (x) => ({ ...x, setting: { ...x.setting, text: '设定' }, outline: { volumes: volumes() } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  inst.open();
  await tick();
  const doc = host.w.document;
  const click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  const dlgBtn = async (label) => { const b = [...doc.querySelectorAll('.pi-dialog .pi-btn')].find((x) => x.textContent === label); assert.ok(b, `dialog button ${label}`); b.click(); await tick(); };
  await click(`[data-act="project"][data-id="${p.id}"]`);
  return { host, inst, doc, click, dlgBtn, pid: p.id };
}

test('panel: playing M1, rewrite S3 — prompt only has S3; edits to M2 meanwhile survive; chat stays on M1; setting check only sees S3', async () => {
  const { host, inst, doc, click, dlgBtn, pid } = await setup();
  await click('[data-act="tab"][data-tab="run"]');
  const active = () => { const u = C.flattenUnits(inst.data.project(pid).outline.volumes); const st = C.unitStates(u, inst.runtime.progress()); return u.find((x) => st[x.id] === 'active').id; };
  assert.equal(active(), 'sM1a');
  host.llm.reply = '```yaml\n剧情_S3_旧仓库:\n  阶段1_新仓库:\n    主线节点:\n      - {id: n_s3a, 名称: 新仓库, 入口: 去新仓库, 发现: [{事实: F_s3a, 内容: 新的}], 完成条件: {事实: F_s3a}}\n剧情_M2_码头:\n  阶段1_被改:\n    主线节点: []\n```';
  doc.querySelector('[data-act="rewrite"]').click(); await tick();
  const sel = doc.querySelector('.pi-dialog [data-rw-line]');
  assert.ok(sel, 'line picker');
  assert.equal(sel.value, 'vM1', 'defaults to the line being played');
  sel.value = 'vS3';
  doc.querySelector('.pi-dialog [data-dlg-input]').value = '仓库换了地方';
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick(); await tick();
  const user = host.llmCalls.at(-1).args.prompt;
  assert.match(user, /【需要改写的剩余阶段】\n剧情_S3_旧仓库/);
  assert.ok(!/剧情_M1_街区:/.test(user) && !/剧情_M2_码头:/.test(user), 'other lines are not sent as YAML');
  assert.match(user, /仓库换了地方/);
  // meanwhile the author edits M2
  inst.data.updateProject(pid, (p) => ({ ...p, outline: { ...p.outline, volumes: p.outline.volumes.map((v) => (v.id === 'vM2' ? { ...v, stages: [{ ...v.stages[0], data: { ...v.stages[0].data, AI指令: '作者刚改的' } }] } : v)) } }));
  const calls = host.llmCalls.length;
  await click('[data-act="draft-rest"]');
  await dlgBtn('替换');
  const vols = inst.data.project(pid).outline.volumes;
  assert.deepEqual(keys(vols.find((v) => v.id === 'vS3')), ['阶段1_新仓库']);
  assert.equal(vols.find((v) => v.id === 'vM2').stages[0].key, '阶段1_码头', 'M2 from the reply not adopted');
  assert.equal(vols.find((v) => v.id === 'vM2').stages[0].data.AI指令, '作者刚改的', 'M2 edit made during the request kept');
  assert.equal(active(), 'sM1a', 'chat stays on M1');
  const sync = host.llmCalls.slice(calls).find((c) => /剧情大纲已经调整/.test(c.body));
  assert.ok(sync, 'the setting is checked against the new S3');
  assert.match(sync.args.prompt, /剧情_S3_旧仓库/);
  assert.ok(!/剧情_M1_街区|剧情_M2_码头/.test(sync.args.prompt), 'only the rewritten line is sent for the setting check');
  await inst.destroy();
});

test('panel: a rewrite that drops a fact M2 still uses is stopped before writing', async () => {
  const { host, inst, doc, click, pid } = await setup();
  await click('[data-act="tab"][data-tab="run"]');
  host.llm.reply = '```yaml\n剧情_S3_旧仓库:\n  阶段1_新仓库:\n    主线节点:\n      - {id: n_s3b, 名称: b, 入口: 去b, 发现: [{事实: F_s3b, 内容: x}], 完成条件: {事实: F_s3b}}\n```';
  doc.querySelector('[data-act="rewrite"]').click(); await tick();
  doc.querySelector('.pi-dialog [data-rw-line]').value = 'vS3';
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick(); await tick();
  const before = JSON.stringify(inst.data.project(pid).outline.volumes);
  await click('[data-act="draft-rest"]');
  assert.match(doc.querySelector('.pi-dialog').textContent, /M2 码头.*F_s3a/);
  assert.equal(JSON.stringify(inst.data.project(pid).outline.volumes), before, 'nothing written');
  await inst.destroy();
});

test('panel: the line was changed after the draft was generated → not adopted', async () => {
  const { host, inst, doc, click, pid } = await setup();
  await click('[data-act="tab"][data-tab="run"]');
  host.llm.reply = '```yaml\n剧情_S3_旧仓库:\n  阶段1_新仓库:\n    主线节点: []\n```';
  doc.querySelector('[data-act="rewrite"]').click(); await tick();
  doc.querySelector('.pi-dialog [data-rw-line]').value = 'vS3';
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick(); await tick();
  inst.data.updateProject(pid, (p) => ({ ...p, outline: { ...p.outline, volumes: p.outline.volumes.map((v) => (v.id === 'vS3' ? { ...v, stages: v.stages.slice(0, 1) } : v)) } }));
  const before = JSON.stringify(inst.data.project(pid).outline.volumes);
  await click('[data-act="draft-rest"]');
  assert.equal(doc.querySelector('.pi-dialog'), null, 'no confirm dialog');
  assert.equal(JSON.stringify(inst.data.project(pid).outline.volumes), before);
  await inst.destroy();
});

// 检测报偏离 → 点提醒卡上的「改写后续阶段」→ 偏转说明弹窗点确定
async function offTrack(host, inst) {
  const respond = host.llm.respond;
  host.llm.respond = (body) => (/剧情进度核对员/.test(body) ? '{"done":[],"stageDone":false,"offTrack":true,"offReason":"偏了","reason":"x"}' : respond(body));
  inst.data.updateSettings({ checkEvery: 1 });
  host.addMessage({ is_user: true, mes: '一' });
  host.addMessage({ is_user: false, mes: '剧情走偏了。' });
  await host.eventSource.emit(host.eventTypes.MESSAGE_RECEIVED, 1, 'normal');
  await tick(); await tick(); await tick();
  const doc = host.w.document;
  const card = doc.querySelector('[data-notice="offtrack"]');
  assert.ok(card, 'off-track notice');
  card.querySelector('[data-act="0"]').click(); await tick();
  doc.querySelector('.pi-dialog .pi-dlg-acts .is-primary').click();
  for (let i = 0; i < 10 && !/撤销/.test(doc.querySelector('[data-notice="offtrack"]')?.textContent || ''); i++) await tick();
  host.llm.respond = respond;
}

// ---------- runtime: off-track rewrite follows this chat's progression (方案 四.1〔五〕): sequential chats keep the whole-book rewrite ----------
test('off-track rewrite in a chat switched to 按顺序: the old whole-book rewrite, even though the book has 线:', async () => {
  const { host, inst, pid } = await setup();
  inst.runtime.olSetFlow('seq');
  host.llm.respond = (body) =>
    /偏离了大纲/.test(body)
      ? '```yaml\n剧情_M1_街区:\n  阶段1_新开场:\n    主线节点: []\n```'
      : /剧情大纲已经调整/.test(body)
        ? '世界观正文：\n设定改过\n\n速查：x'
        : '{"done":[],"stageDone":false,"offTrack":false,"reason":"x"}';
  await offTrack(host, inst);
  const rw = host.llmCalls.find((c) => /偏离了大纲/.test(c.body)).args.prompt;
  assert.match(rw, /剧情_S3_旧仓库:/, 'the old prompt: everything after the current stage');
  assert.ok(!/只改写【需要改写的剩余阶段】里的这一条剧情线/.test(host.llmCalls.find((c) => /偏离了大纲/.test(c.body)).args.systemPrompt), 'no per-line rule');
  // undo after a later setting edit keeps the new setting
  inst.data.updateProject(pid, (p) => ({ ...p, setting: { ...p.setting, text: '作者后来又改的设定' } }));
  [...host.w.document.querySelectorAll('[data-notice="offtrack"] [data-act]')].find((b) => /撤销/.test(b.textContent)).click(); await tick();
  const vols = inst.data.project(pid).outline.volumes;
  assert.deepEqual(keys(vols.find((v) => v.id === 'vM1')), ['阶段1_开场', '阶段2_追查'], 'outline undone');
  assert.equal(inst.data.project(pid).setting.text, '作者后来又改的设定', 'later setting edit kept');
  await inst.destroy();
});

test('off-track rewrite in a by-line chat (default for a 线: book): only the current line is rewritten', async () => {
  const { host, inst, pid } = await setup();
  host.llm.respond = (body) =>
    /偏离了大纲/.test(body)
      ? '```yaml\n剧情_M1_街区:\n  阶段1_新开场:\n    主线节点: []\n```'
      : /剧情大纲已经调整/.test(body)
        ? '世界观正文：\n设定改过\n\n速查：x'
        : '{"done":[],"stageDone":false,"offTrack":false,"reason":"x"}';
  await offTrack(host, inst);
  const call = host.llmCalls.find((c) => /偏离了大纲/.test(c.body));
  assert.match(call.args.systemPrompt, /只改写【需要改写的剩余阶段】里的这一条剧情线/, 'per-line rule');
  await inst.destroy();
});

test('off-track rewrite: undo after the outline was edited again does not overwrite it', async () => {
  const { host, inst, pid } = await setup();
  host.llm.respond = (body) =>
    /偏离了大纲/.test(body) ? '```yaml\n剧情_M1_街区:\n  阶段1_新开场:\n    主线节点: []\n```' : /剧情大纲已经调整/.test(body) ? '世界观正文：\n设定\n\n速查：x' : '{}';
  await offTrack(host, inst);
  inst.data.updateProject(pid, (p) => ({ ...p, outline: { ...p.outline, volumes: p.outline.volumes.map((v) => (v.id === 'vM1' ? { ...v, key: '剧情_M1_改名' } : v)) } }));
  [...host.w.document.querySelectorAll('[data-notice="offtrack"] [data-act]')].find((b) => /撤销/.test(b.textContent)).click(); await tick();
  const vols = inst.data.project(pid).outline.volumes;
  assert.equal(vols.find((v) => v.id === 'vM1').key, '剧情_M1_改名', 'later edit kept (not undone)');
  assert.equal(vols.find((v) => v.id === 'vM1').stages[0].key, '阶段1_新开场');
  await inst.destroy();
});

// ---------- GPT 第五版复核 / 第四版审阅的反例 ----------
test('pickLineIncoming: a single volume that names another line (编号: S2) is not taken for M1; no match → null, nothing deleted', () => {
  const vols = volumes();
  assert.equal(C.replaceLineRest(vols, 'sM1a', [{ key: '剧情_改名', line: { 编号: 'S3' }, stages: [{ id: 'x', key: 'k', data: {} }] }]), null);
  assert.equal(C.replaceLineRest(vols, 'sS3a', [{ key: '剧情_甲', stages: [] }, { key: '剧情_乙', stages: [] }]), null, 'two unmatched volumes → null (was: deleted S3)');
  const ok = C.replaceLineRest(vols, 'sM1a', [{ key: '剧情_随便', stages: [{ id: 'y', key: 'k', data: {} }] }]);
  assert.deepEqual(ok.find((v) => v.id === 'vM1').stages.map((s) => s.id), ['y'], 'a lone volume without another line id is still this line');
});

test('lineRestSig: changes when the stages to be replaced are edited (text), moved or renamed; not when another line is edited', () => {
  const vols = volumes();
  const sig = C.lineRestSig(vols, 'vS3', 'sS3a');
  const text = JSON.parse(JSON.stringify(vols)); text[1].stages[0].data.AI指令 = '作者刚改';
  assert.notEqual(C.lineRestSig(text, 'vS3', 'sS3a'), sig, 'text edit');
  const moved = [vols[1], vols[0], vols[2]];
  assert.notEqual(C.lineRestSig(moved, 'vS3', 'sS3a'), sig, 'moved');
  const other = JSON.parse(JSON.stringify(vols)); other[0].stages[0].data.AI指令 = '改了 M1';
  assert.equal(C.lineRestSig(other, 'vS3', 'sS3a'), sig, 'another line edited → still adoptable');
});

test('goToIn / undoGoToIn: only this line\'s manual states are cleared; undo restores only fields still at the written value', () => {
  const prog = { current: 'sM1a', slots: { sM1a: { state: 'done', off: ['n0'] }, sM1b: { state: 'next' }, sS3a: { state: 'done' } } };
  const r = C.goToIn(prog, 'sM1a', ['sM1a', 'sM1b']);
  assert.equal(r.next.slots.sS3a.state, 'done', 'S3 manual state untouched');
  assert.equal(r.next.slots.sM1a.state, undefined);
  assert.deepEqual(r.next.slots.sM1a.off, ['n0'], 'played nodes kept');
  // after the rewrite the player ticks a node and sets sM1b manually again
  const later = { ...r.next, slots: { ...r.next.slots, sM1a: { ...r.next.slots.sM1a, off: ['n0', 'n1'] }, sM1b: { state: 'done' } } };
  const back = C.undoGoToIn(later, r.changes);
  assert.equal(back.slots.sM1a.state, 'done', 'restored');
  assert.deepEqual(back.slots.sM1a.off, ['n0', 'n1'], 'new tick kept');
  assert.equal(back.slots.sM1b.state, 'done', 'changed later → kept');
});

test('panel: per-line draft keeps its line after 「重新解析」 — adopting does not wipe the other lines', async () => {
  const { host, inst, doc, click, dlgBtn, pid } = await setup();
  await click('[data-act="tab"][data-tab="run"]');
  host.llm.reply = '```yaml\n剧情_S3_旧仓库:\n  阶段1_新仓库:\n    主线节点:\n      - {id: n_s3a, 名称: 新, 入口: 去, 发现: [{事实: F_s3a, 内容: x}], 完成条件: {事实: F_s3a}}\n```';
  doc.querySelector('[data-act="rewrite"]').click(); await tick();
  doc.querySelector('.pi-dialog [data-rw-line]').value = 'vS3';
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick(); await tick();
  const ta = doc.querySelector('[data-draft-yaml]') || (() => { const d = doc.createElement('textarea'); d.setAttribute('data-draft-yaml', ''); return d; })();
  // open the YAML box: reparse reads it from the card
  const card = doc.querySelector('[data-act="draft-rest"]').closest('.pi-card');
  if (!card.querySelector('[data-draft-yaml]')) { ta.value = host.llm.reply.replace(/```yaml\n|```/g, ''); card.appendChild(ta); }
  card.querySelector('[data-draft-yaml]').value = host.llm.reply.replace(/```yaml\n|```/g, '');
  const btn = doc.createElement('button'); btn.setAttribute('data-act', 'draft-reparse'); card.appendChild(btn); btn.click(); await tick();
  await click('[data-act="draft-rest"]');
  await dlgBtn('替换');
  const vols = inst.data.project(pid).outline.volumes;
  assert.deepEqual(vols.map((v) => v.id), ['vM1', 'vS3', 'vM2'], 'other lines still there');
  assert.deepEqual(keys(vols.find((v) => v.id === 'vS3')), ['阶段1_新仓库']);
  await inst.destroy();
});

test('panel: the author edits the text of the stages being rewritten while waiting → the old draft is not adopted', async () => {
  const { host, inst, doc, click, pid } = await setup();
  await click('[data-act="tab"][data-tab="run"]');
  host.llm.reply = '```yaml\n剧情_S3_旧仓库:\n  阶段1_新仓库:\n    主线节点: []\n```';
  doc.querySelector('[data-act="rewrite"]').click(); await tick();
  doc.querySelector('.pi-dialog [data-rw-line]').value = 'vS3';
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick(); await tick();
  inst.data.updateProject(pid, (p) => ({ ...p, outline: { ...p.outline, volumes: p.outline.volumes.map((v) => (v.id === 'vS3' ? { ...v, stages: [{ ...v.stages[0], data: { ...v.stages[0].data, AI指令: '作者刚写的' } }, v.stages[1]] } : v)) } }));
  await click('[data-act="draft-rest"]');
  assert.equal(doc.querySelector('.pi-dialog'), null, 'no confirm dialog');
  assert.equal(inst.data.project(pid).outline.volumes.find((v) => v.id === 'vS3').stages[0].data.AI指令, '作者刚写的', 'author edit kept');
  await inst.destroy();
});

// ---------- panel: label preparation in batches; a failed review batch keeps the drafts, retry only reviews ----------
test('panel: 45 labels → 2 generate batches + 2 review batches; review batch 2 fails → its labels stay unreviewed; retry only reviews them', async () => {
  const many = Array.from({ length: 45 }, (_, i) => node(`n_x${i}`, `F_x${i}`));
  const vols = [
    { id: 'vA', key: '剧情_M1_大', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 'sA', key: '阶段1_大', data: { 主线节点: many } }] },
    { id: 'vB', key: '剧情_S1_小', line: { 编号: 'S1', 类型: '支线' }, stages: [{ id: 'sB', key: '阶段1_小', data: { 主线节点: [node('n_y', 'F_y')] } }] },
  ];
  const tables = buildTemplate({ controlRow: ['主线', ''], factRows: [], knowRows: [] });
  const host = createHost({ tables });
  const inst = host.load();
  await inst.ready;
  const p = await inst.data.createProject('大项目');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML) } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  const codesIn = (body) => [...new Set((body.match(/编号: (F_\w+)/g) || []).map((x) => x.slice(4)))];
  let failReview = 1;
  const seen = { gen: [], review: [] };
  host.llm.respond = (body) => {
    const codes = codesIn(JSON.parse(body).prompt || '');
    if (/检查剧情线索的「标签」和「登记口径」有没有剧透/.test(body)) {
      seen.review.push(codes.length);
      if (codes.includes('F_x44') && failReview) { failReview--; throw new Error('审阅超时'); }
      return '```yaml\n' + codes.map((c) => `- 编号: ${c}\n  透露: 否`).join('\n') + '\n```';
    }
    seen.gen.push(codes.length);
    return '```yaml\n' + codes.map((c) => `- 编号: ${c}\n  标签: 标签${c}\n  口径: 看到时登记；没看到不算`).join('\n') + '\n```';
  };
  const btn = () => doc.querySelector('[data-act="clue-labels"]');
  assert.match(doc.querySelector('.pi-labels-todo').textContent, /46条线索的标签未准备/);
  btn().click();
  for (let i = 0; i < 30 && doc.querySelector('[data-act="clue-labels"][disabled]'); i++) await tick();
  await tick();
  assert.ok(seen.gen.length >= 2 && Math.max(...seen.gen) <= 40, `generated in batches of ≤40: ${seen.gen}`);
  assert.equal(seen.gen.reduce((a, b) => a + b, 0), 46, 'every code generated once');
  const labels = inst.data.project(p.id).clue.labels;
  assert.equal(Object.keys(labels).length, 46, 'all generated labels saved');
  const unrev = Object.entries(labels).filter(([, v]) => v.src === 'gen').map(([k]) => k);
  assert.ok(unrev.includes('F_x44') && unrev.length > 0 && unrev.length < 46, 'the failed review batch stays unreviewed; the other batch is reviewed');
  assert.match(doc.querySelector('.pi-labels-todo').textContent, new RegExp(`${unrev.length}条已生成、尚未检查是否透露答案`));
  // retry: no generation, only review of what is left
  const genBefore = seen.gen.length;
  btn().click();
  for (let i = 0; i < 30 && doc.querySelector('[data-act="clue-labels"][disabled]'); i++) await tick();
  await tick();
  assert.equal(seen.gen.length, genBefore, 'retry does not regenerate');
  assert.equal(seen.review.at(-1), unrev.length, 'retry reviews only the unreviewed ones');
  assert.ok(Object.values(inst.data.project(p.id).clue.labels).every((v) => v.src === 'ai'), 'all model-reviewed now');
  assert.equal(doc.querySelector('.pi-labels-todo'), null);
  await inst.destroy();
});

test('panel: a label the user edits while generation runs is not overwritten by the late result', async () => {
  const vols = [
    { id: 'vA', key: '剧情_M1_a', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 'sA', key: '阶段1_a', data: { 主线节点: [node('n_a', 'F_a')] } }] },
    { id: 'vB', key: '剧情_S1_b', line: { 编号: 'S1', 类型: '支线' }, stages: [{ id: 'sB', key: '阶段1_b', data: { 主线节点: [node('n_b', 'F_b')] } }] },
  ];
  const host = createHost({ tables: buildTemplate({ controlRow: ['主线', ''], factRows: [], knowRows: [] }) });
  const inst = host.load();
  await inst.ready;
  const p = await inst.data.createProject('改了');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML) } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  const sig = Object.fromEntries(C.labelsToPrepare(vols, {}).map((x) => [x.code, x.sig]));
  host.llm.respond = (body) => {
    if (/有没有剧透/.test(body)) return '```yaml\n- 编号: F_a\n  透露: 否\n- 编号: F_b\n  透露: 否\n```';
    // while the model "thinks", the user saves their own label for F_a
    inst.data.updateProject(p.id, (q) => ({ ...q, clue: { ...q.clue, labels: { ...q.clue.labels, F_a: { label: '我写的', criterion: '我写的口径', sig: sig.F_a } } } }));
    return '```yaml\n- 编号: F_a\n  标签: 模型的\n  口径: 模型的口径\n- 编号: F_b\n  标签: 模型的b\n  口径: 看到时登记；没看到不算\n```';
  };
  doc.querySelector('[data-act="clue-labels"]').click();
  for (let i = 0; i < 30 && doc.querySelector('[data-act="clue-labels"][disabled]'); i++) await tick();
  await tick();
  const labels = inst.data.project(p.id).clue.labels;
  assert.equal(labels.F_a.label, '我写的', 'user edit kept');
  assert.equal(labels.F_b.label, '模型的b');
  await inst.destroy();
});

test('panel: labels typed by the user in the template dialog are saved as 用户写的 (src user), not as model-reviewed', async () => {
  const vols = [{ id: 'vA', key: '剧情_M1_a', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 'sA', key: '阶段1_a', data: { 主线节点: [node('n_a', 'F_a')] } }] }];
  const fs = await import('node:fs');
  const tpl = JSON.parse(fs.readFileSync(new URL('./fixtures/shujuku-default-template-spv8.9.2.json', import.meta.url), 'utf8'));
  const host = createHost({ tables: tpl });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('手写');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  (() => { const t = doc.querySelector('[data-act="run-set-toggle"][aria-expanded="false"]'); t && t.click(); })(); await tick(); (() => { const t = doc.querySelector('[data-act="run-fold"][data-key="advOpen"][aria-expanded="false"]'); t && t.click(); })(); await tick();
  doc.querySelector('[data-act="clue-gen-template"]').click(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  { const e = dlg.querySelector('[data-gt-label="0"]'); e.value = '我写的标签'; e.dispatchEvent(new e.ownerDocument.defaultView.Event('input', { bubbles: true })); }
  { const e = dlg.querySelector('[data-gt-crit="0"]'); e.value = '我写的口径；没看到不算'; e.dispatchEvent(new e.ownerDocument.defaultView.Event('input', { bubbles: true })); }
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '写入当前聊天').click(); await tick(); await tick();
  assert.equal(inst.data.project(p.id).clue.labels.F_a.src, 'user');
  await inst.destroy();
});
