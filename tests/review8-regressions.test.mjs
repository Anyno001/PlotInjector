// GPT 第五轮审阅（4f6c5ab）的反例：每条按审阅里描述的复现构造。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const C = loadCore();
const DEFAULT = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/shujuku-default-template-spv8.9.2.json'), 'utf8'));
const byName = (t, name) => Object.values(t).find((s) => s && s.name === name);
const tick = () => new Promise((r) => setTimeout(r, 20));
const vol = (stages) => [{ id: 'v', key: '剧情_卷一', stages: stages.map((data, i) => ({ id: `s${i}`, key: `阶段${i + 1}_x`, data })) }];
const N = (id, gives, extra = {}) => ({ id, 名称: id, 入口: `去${id}`, 发现: gives.map((f) => ({ 事实: f, 内容: `${f}内容` })), 完成条件: gives.length ? { 事实: gives[0] } : undefined, ...extra });
const texts = (xs) => xs.map((x) => (typeof x === 'string' ? x : x.text)).join('\n');
const S = loadCore();
S.setYamlLib(YAML);

// ---------- 1a 采用时按当前项目模式、带上作者索引检查 ----------
async function boot(mode) {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('A');
  mode === 'clue' && inst.data.updateProject(p.id, (x) => ({ ...x, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  const click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  await click(`[data-act="project"][data-id="${p.id}"]`);
  await click('[data-act="tab"][data-tab="outline"]');
  return { host, inst, doc, click, pid: p.id };
}
test('1a: a clue draft whose node NAME holds a secret name, adopted into an outline-mode project, is caught at adopt time', async () => {
  const ctx = await boot('outline');
  const SECRET = '青石';
  ctx.host.llm.reply = undefined;
  ctx.host.llm.respond = (body) => (/整理作者索引/.test(body)
    ? `\`\`\`yaml\n梗概: x\n人物:\n  - {名称: ${SECRET}, 公开身份: 路人, 真实身份: 幕后, 名字保密: true}\n事实:\n  - {编号: F1, 内容: x, 性质: 实物}\n\`\`\``
    : ['```yaml', '剧情_卷1_x:', '  阶段1_a:', '    主线节点:', '      - id: n1', `        名称: 跟踪${SECRET}`, '        入口: 去码头', '        发现: [{事实: F1, 内容: 一张单子}]', '        完成条件: {事实: F1}', '```'].join('\n'));
  await ctx.click('[data-act="import-open-panel"]');
  ctx.doc.querySelector('[data-imp-text]').value = '## 第一章\n码头。';
  ctx.doc.querySelector('[data-imp-mode]').value = 'clue';
  await ctx.click('[data-act="import-start"]');
  for (let i = 0; i < 40 && !ctx.doc.querySelector('[data-act="import-adopt"]'); i++) await tick();
  ctx.doc.querySelector('[data-act="import-adopt"]').click(); await tick();
  const dlg = [...ctx.doc.querySelectorAll('.pi-dialog')].pop();
  assert.ok(dlg, 'adopt asks for confirmation');
  // 导入审阅总方案 A：确认框里是人话（哪一处写了名字、为什么不行），不再是技术说明
  assert.match(dlg.textContent, new RegExp(`写了「${SECRET}」：正文每一轮都会看到这个名字`));
  await ctx.inst.destroy();
});

// ---------- 1b 作者出处不再借用世界动态的「来源」 ----------
test('1b: the import asks for 原文出处 (not 来源); a world event keeps its story 来源, the author note is moved out; outline mode gets no clue-only rules', () => {
  const outlineSys = C.importDraftMessages({ part: { i: 0, title: 't', text: 'x' }, index: '', mode: 'outline' })[0].content;
  const clueSys = C.importDraftMessages({ part: { i: 0, title: 't', text: 'x' }, index: '', mode: 'clue' })[0].content;
  assert.match(outlineSys, /原文出处: 材料里对应的原句/);
  assert.ok(!/来源: 材料里对应的原句/.test(outlineSys));
  assert.match(outlineSys, /世界动态的「来源」写故事里是谁传出的消息/);
  for (const s of ['完成条件、开放条件优先用', '阶段的进入条件只能用', '必需: false']) {
    assert.ok(!outlineSys.includes(s), `outline mode should not get: ${s}`);
    assert.ok(clueSys.includes(s), `clue mode keeps: ${s}`);
  }
  const vols = [{ id: 'v', key: '剧情_卷1_x', stages: [{ id: 's', key: '阶段1_a', data: {
    主线节点: [{ id: 'n1', 名称: '甲', 事件: 'e', 原文出处: '第一章第三段' }],
    世界动态: [{ id: 'w1', 类型: '传闻', 来源: '码头脚夫', 内容: '夜里有人搬货', 原文出处: '原文出处：幕后经手的是主管的侄子' }],
  } }] }];
  const r = C.splitImportAuthorFields(vols);
  const d = r.volumes[0].stages[0].data;
  assert.equal(d.世界动态[0].来源, '码头脚夫');
  assert.ok(!('原文出处' in d.世界动态[0]) && !('原文出处' in d.主线节点[0]));
  assert.ok(!JSON.stringify(C.outlineVolumesView(r.volumes)).includes('侄子'), 'author note not in the outline view');
});

// ---------- 2 设定整理和改写带上固定的保密规则 ----------
test('2: setting organize / block rewrite always carry the secrecy rule, whichever writing guide is chosen; the guide text itself is unchanged', () => {
  for (const preset of ['generic', 'fanfic']) {
    const g = S.resolveGuide({ guidePreset: preset }).text;
    const org = S.settingMessages({ guide: g, talk: 't', current: '', append: false })[0].content;
    const rew = S.rewriteBlockMessages({ guide: g, current: 'c', blockText: 'b', fixes: 'f' })[0].content;
    for (const sys of [org, rew]) {
      assert.ok(sys.startsWith(g), 'guide comes first, unchanged');
      assert.ok(sys.includes(S.SETTING_SECRET_RULE));
    }
  }
  assert.match(S.SETTING_SECRET_RULE, /<仅作者>/);
  assert.match(S.SETTING_SECRET_RULE, /这一段必须写，不能因为要保密就省略/);
});

// ---------- 3a 刷新后标签弹窗仍能读到保密名单 ----------
test('3a: after a reload (import job not in memory), the fact-label dialog still loads the secret list and flags a secret name', async () => {
  const host = createHost({ tables: JSON.parse(JSON.stringify(DEFAULT)) });
  let inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('A');
  const job = await inst.data.imports.create({ projectId: p.id, text: 'x', mode: 'clue', needs: '' });
  await inst.data.imports.update(job.id, (j) => ({ ...j, index: { 人物: [{ 名称: '青石', 名字保密: true }], secretFlag: true } }));
  const VOLS = vol([{ 主线节点: [N('n1', ['F1'])] }]);
  inst.data.updateProject(p.id, (x) => ({ ...x, imports: [job.id], outline: { volumes: VOLS }, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  await inst.data.flush(); await inst.destroy();
  inst = host.load(); await inst.ready;
  await inst.data.loadProject(p.id); await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  assert.equal(inst.data.imports.get(job.id), null, 'job not in memory after reload');
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  (() => { const t = doc.querySelector('[data-act="run-set-toggle"][aria-expanded="false"]'); t && t.click(); })(); await tick();
  doc.querySelector('[data-act="clue-gen-template"]').click(); await tick(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  const label = dlg.querySelector('[data-gt-label="0"]');
  label.value = '青石的单据';
  label.dispatchEvent(new host.w.Event('input', { bubbles: true }));
  assert.match(dlg.querySelector('[data-fr-warn="0"]').textContent, /保密的名字「青石」/);
  await inst.destroy();
});

// ---------- 6a 采用前推演：本聊天已出现（存疑）的事实满足 {事实}、不满足 {核实} ----------
test('6a: a claimed fact from this chat lets {事实} through in the pre-adopt simulation, but not {核实}', () => {
  const later = vol([{ 进入条件: { 事实: 'F_say' }, 主线节点: [N('n2', ['F2'])] }]);
  assert.equal(C.clueReachability(later, { claimedFacts: ['F_say'] }).verdict, 'ok');
  assert.notEqual(C.clueReachability(later).verdict, 'ok', 'without it the stage cannot open');
  const strict = vol([{ 进入条件: { 核实: 'F_say' }, 主线节点: [N('n2', ['F2'])] }]);
  assert.notEqual(C.clueReachability(strict, { claimedFacts: ['F_say'] }).verdict, 'ok', '{核实} needs 已核实');
  assert.equal(C.clueReachability(strict, { knownFacts: ['F_say'] }).verdict, 'ok');
  // chatFactSets: confirmed vs claimed, a manual revoke removes a claim
  const snap = { facts: new Map([['A', { id: 'A', status: 'confirmed', raw: '已核实' }], ['B', { id: 'B', status: 'unconfirmed', claimed: true, raw: '存疑' }], ['R', { id: 'R', status: 'unconfirmed', claimed: true, raw: '存疑' }]]) };
  const sets = C.chatFactSets({ snap, prog: { factOverrides: { R: { status: 'revoked' } } } });
  assert.deepEqual([...sets.known], ['A']);
  assert.deepEqual([...sets.claimed], ['B']);
});

// ---------- 6b 替代路线：必需节点只认路线 B 时，单走 A 不可行 ----------
test('6b: a required node that needs route B makes route A alone blocked', () => {
  const vols = vol([
    { 主线节点: [
      N('nA', ['FA'], { 必需: false }), N('nB', ['FB'], { 必需: false }),
      N('nC', ['FC'], { 开放条件: { 事实: 'FB' } }),
    ] },
    { 主线节点: [N('nD', ['FD'])] },
  ]);
  const r = C.clueAlternativeRoutes(vols);
  assert.equal(r.find((x) => x.node.startsWith('nA')).verdict, 'blocked', JSON.stringify(r));
  assert.equal(r.find((x) => x.node.startsWith('nB')).verdict, 'ok');
  assert.ok(!r.some((x) => /nC/.test(x.node)), 'required nodes are not listed as part of a route');
});

// ---------- 7 单行建表语句里的表级约束 ----------
test('7: a one-line DDL with a table-level UNIQUE is left alone (no invalid SQL)', () => {
  const t = JSON.parse(JSON.stringify(DEFAULT));
  const ch = byName(t, '重要角色表');
  const cols = ch.sourceData.ddl.split('\n').slice(1, -1).map((l) => l.replace(/--.*$/, '').trim().replace(/,$/, '')).filter(Boolean);
  ch.sourceData.ddl = `CREATE TABLE important_non_romance (${cols.join(', ')}, UNIQUE(name));`;
  new DatabaseSync(':memory:').exec(ch.sourceData.ddl);
  const r = C.synthesizeClueTemplate(t, {});
  new DatabaseSync(':memory:').exec(byName(r.template, '重要角色表').sourceData.ddl);
  assert.match(r.problems.join('\n'), /表级约束.*没有加列/);
  // a comment that merely mentions UNIQUE does not block adding columns
  const ok = JSON.parse(JSON.stringify(DEFAULT));
  byName(ok, '重要角色表').sourceData.ddl = byName(ok, '重要角色表').sourceData.ddl.replace('-- 姓名', '-- 姓名（UNIQUE 不要求）');
  assert.ok(byName(C.synthesizeClueTemplate(ok, {}).template, '重要角色表').content[0].includes('剧情身份'));
});
