// GPT review §17 (of 1af36e8) — reproductions as regression tests. Each must fail on the pre-fix code.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';
import { buildTemplate, BINDING_YAML } from '../templates/clue-tables/build-template.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const storyText = fs.readFileSync(path.join(here, '../templates/clue-tables/示例_小镇失窃案.yaml'), 'utf8');
const pluginSrc = fs.readFileSync(path.join(here, '../src/ui/clue-run.js'), 'utf8');
const templateSrc = fs.readFileSync(path.join(here, '../templates/clue-tables/build-template.mjs'), 'utf8');
const rulesSrc = fs.readFileSync(path.join(here, '../src/core/clue-template.js'), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 20));
const C = loadCore();

function liveTables(t) {
  const out = JSON.parse(JSON.stringify(t));
  for (const [k, s] of Object.entries(out)) if (k.startsWith('sheet_')) s.content = s.content.map((row, i) => (i === 0 ? row : [i, ...row.slice(1)]));
  return out;
}
const FACTS = ['F_box', 'F_ledger', 'F_seen', 'F_print', 'F_talk'];
async function setup({ tables: given } = {}) {
  const tables = given || liveTables(buildTemplate({
    controlRow: ['主线', ''],
    factRows: FACTS.map((code) => ({ code, label: code })),
    knowRows: [{ fact: 'F_seen', actor: 'user' }, { fact: 'F_ledger', actor: 'user' }],
  }));
  const host = createHost({ tables });
  const inst = host.load();
  await inst.ready;
  const volumes = Object.entries(YAML.parse(storyText)).map(([key, stages], vi) => ({ id: `v${vi}`, key, stages: Object.entries(stages).map(([sk, data], si) => ({ id: `s${vi}_${si}`, key: sk, data })) }));
  const p = await inst.data.createProject('小镇');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML) } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  const click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  const set = (sheet, key, col, v) => { const s = Object.values(tables).find((x) => x && x.name === sheet); s.content.find((r, i) => i > 0 && r[1] === key)[s.content[0].indexOf(col)] = v; };
  const commit = () => { host.db.setTables(tables); };
  await click(`[data-act="project"][data-id="${p.id}"]`);
  return { host, inst, doc, click, set, commit, tables, pid: p.id };
}

// ---------- 17.1 P1: 「填入示例 → 应用」 must not bring back the removed 启用 switch ----------
test('17.1 P1: the in-panel binding example equals the template binding (no 启用, time list)', () => {
  const m = /(?:export )?(?:var|const) BINDING_EXAMPLE = `([\s\S]*?)`;/.exec(pluginSrc);
  assert.ok(m, 'example found');
  const tpl = /export const BINDING_YAML = `([\s\S]*?)`;/.exec(templateSrc);
  const lf = (x) => x.split(String.fromCharCode(13)).join('');
  assert.equal(lf(m[1]), lf(tpl[1]), 'same text as BINDING_YAML');
  assert.ok(!/启用/.test(m[1]));
});

test('17.1 P1: clicking 填入示例 → 应用 keeps clue material flowing (no missing-column switch)', async () => {
  const { inst, click, doc, set, commit } = await setup();
  set('关键事实表', 'F_box', '状态', '已核实'); set('线索控制表', '主线', '当前场景', 'n_witness'); commit();
  await click('[data-act="tab"][data-tab="run"]');
  (() => { const t = doc.querySelector('[data-act="run-set-toggle"][aria-expanded="false"]'); t && t.click(); })(); await tick();
  await click('[data-act="clue-bind-toggle"]');
  await click('[data-act="clue-bind-example"]');
  await click('[data-act="clue-bind-apply"]');
  const problems = inst.runtime.clue.compute().snap.problems.join('\n');
  assert.ok(!/启用/.test(problems), `no 启用 problem: ${problems}`);
  assert.match(inst.runtime.clue.projection().content, /年轻人/, 'focus scene still injected');
  void doc;
  await inst.destroy();
});

// ---------- 17.1 P1: prebuild across isolated branches with the same codes ----------
test('17.1 P1: prebuild preview on branch A, confirm on branch B (same F_box code, different label) → nothing written', async () => {
  const branch = (label) => liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [{ code: 'F_box', label }], knowRows: [] }));
  const { host, inst, doc, click } = await setup({ tables: branch('A的标签') });
  await click('[data-act="tab"][data-tab="run"]');
  (() => { const t = doc.querySelector('[data-act="run-set-toggle"][aria-expanded="false"]'); t && t.click(); })(); await tick();
  doc.querySelector('[data-act="clue-prebuild"]').click(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  assert.ok(dlg, 'preview open');
  dlg.querySelectorAll('[data-pb-label]').forEach((el, i) => { el.value = `标签${i}`; });
  host.db.setTables(branch('B的标签')); // same code F_box, other branch
  dlg.querySelector('.pi-btn.is-primary').click(); await tick(); await tick();
  assert.equal(host.w.AutoCardUpdaterAPI.inserted.length, 0, 'nothing written into branch B');
  await inst.destroy();
});

// ---------- 17.1 P1: a new volume reusing an obtained fact id as a NEW discovery ----------
test('17.1 P1: draft that re-produces an already-obtained fact under another meaning is flagged', () => {
  const old = [{ id: 'v1', key: '剧情_卷一_甲', stages: [{ id: 's1', key: '阶段一_a', data: { 主线节点: [{ id: 'n1', 名称: '接委托', 入口: 'e', 发现: [{ 事实: 'F01', 内容: '一张船票' }], 完成条件: { 事实: 'F01' } }] } }] }];
  const draft = [{ id: 'v2', key: '剧情_卷二_乙', stages: [{ id: 's2', key: '阶段一_b', data: { 主线节点: [{ id: 'n9', 名称: '查账', 入口: '去账房', 发现: [{ 事实: 'F01', 内容: '一本账册' }], 完成条件: { 事实: 'F01' } }] } }] }];
  const issues = C.checkClueDraft(draft, old, { isObtained: (id) => id === 'F01' }).join('\n');
  assert.match(issues, /F01 已经由 n1 使用（「一张船票」），本聊天里已经取得/);
  assert.match(issues, /保存后这个新节点会当即算完成/);
  // referencing the old fact in a condition is normal and not flagged
  const ref = [{ id: 'v2', key: '剧情_卷二_乙', stages: [{ id: 's2', key: '阶段一_b', data: { 进入条件: { 事实: 'F01' }, 主线节点: [{ id: 'n9', 名称: '查账', 入口: '去账房', 发现: [{ 事实: 'F20', 内容: '一本账册' }], 完成条件: { 事实: 'F20' } }] } }] }];
  assert.ok(!/已经由/.test(C.checkClueDraft(ref, old, { isObtained: () => true }).join('\n')));
});

// ---------- 17.1 P2: paused → the would-be focus is not exempt in the final-request audit ----------
test('17.1 P2: paused round: the focus scene text arriving by another path is reported', async () => {
  const { host, inst, set, commit } = await setup();
  set('关键事实表', 'F_box', '状态', '已核实'); set('线索控制表', '主线', '当前场景', 'n_witness'); commit();
  inst.runtime.clue.setPaused(true);
  await host.generate();
  await host.promptReady([{ role: 'system', content: '【别的世界书】案发当晚有个年轻人从杂货店后门出来。' }]);
  const a = inst.runtime.clue.diagnose().lastAudit;
  assert.ok(a.leaks.some((l) => l.level === 'leak' && /发现/.test(l.source)), JSON.stringify(a.leaks));
  await inst.destroy();
});

// ---------- 17.1 P2: rewrite confirm — progress changes while the dialog is open ----------
test('17.1 P2: a fact obtained while the rewrite confirm is open is shown before applying', async () => {
  const { host, inst, doc, click, set, commit, pid } = await setup();
  set('关键事实表', 'F_box', '状态', '已核实'); commit();
  await click('[data-act="tab"][data-tab="run"]');
  host.llm.reply = ['```yaml', '剧情_卷一_小镇失窃案:', '  阶段二_调查:', '    主线节点:', '      - id: n_ledger', '        名称: 查账本', '        入口: 翻账本', '        发现: [{事实: F_ledger, 内容: c}]', '        完成条件: {事实: F_talk}', '```'].join('\n');
  doc.querySelector('[data-act="rewrite"]').click(); await tick();
  doc.querySelector('.pi-dialog textarea, .pi-dialog input').value = 'x';
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick(); await tick();
  await click('[data-act="tab"][data-tab="outline"]');
  doc.querySelector('[data-act="draft-rest"]').click(); await tick();
  assert.ok(!/直接变成已完成/.test(doc.querySelector('.pi-dialog').textContent), 'not yet');
  set('关键事实表', 'F_talk', '状态', '已核实'); commit(); // happens while the dialog is open
  [...doc.querySelectorAll('.pi-dialog .pi-btn')].find((x) => x.textContent === '替换').click(); await tick();
  const second = doc.querySelector('.pi-dialog');
  assert.ok(second, 'second confirm shown');
  assert.match(second.textContent, /进度在确认期间变了/);
  assert.match(second.textContent, /直接变成已完成/);
  [...second.querySelectorAll('.pi-btn')].find((b) => b.textContent === '取消').click(); await tick();
  const done = inst.data.project(pid).outline.volumes[0].stages[1].data.主线节点.find((n) => n.id === 'n_ledger').完成条件;
  assert.deepEqual(JSON.parse(JSON.stringify(done)), { 事实: 'F_ledger' }, 'cancelled → outline unchanged');
  await inst.destroy();
});

// ---------- 17.1 P2: template examples must not carry the test story's answers ----------
test('17.1 P2: fill-rule examples in the companion template are case-neutral', () => {
  for (const w of ['窗台', '印泥', '当铺', '拖痕', '侧窗']) assert.ok(!rulesSrc.includes(w), `template example mentions ${w}`);
  assert.match(rulesSrc, /纯佐证，只追加依据/);
});
