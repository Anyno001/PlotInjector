// Upgrade from v0.1.13 data (checklist F01): a project file written by the old version (no `clue` field, nodes
// without ids, old progress in chat metadata) loads in v0.2.0 as an outline-mode project with nothing lost, injects
// the same outline text as before. Stable node ids are added on first use (GPT §18) but never reach the injected text.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';

const OLD_PROJECT = {
  version: 1, id: 'pold1', name: '旧项目', group: '旧分组', createdAt: 1, updatedAt: 2,
  setting: { text: '旧设定正文', history: [{ at: 1, text: '更早的设定' }], check: '', fixes: [] },
  outline: { volumes: [{ id: 'v1', key: '剧情_卷一_旧卷', stages: [
    { id: 's1', key: '阶段一_开端', data: { 时间范围: '第一天', AI指令: '慢慢来', 主线节点: [{ 名称: '相遇', 地点: '车站', 事件: '主角在车站遇见旧友', 偏转: '若错过则改在咖啡馆' }], 支线事件: [{ 名称: '小插曲', 事件: '下雨', 触发: '出门时' }] } },
    { id: 's2', key: '阶段二_发展', data: { 时间范围: '第二天', 主线节点: [{ 名称: '谈心', 事件: '两人聊起往事' }] } },
  ] }] },
  defaults: {},
};
const OLD_INDEX = { version: 1, active: {}, projects: [{ id: 'pold1', name: '旧项目', group: '旧分组', updatedAt: 2, bytes: {} }], files: ['pi-index.json', 'pi-p-pold1.json'], settings: {} };

async function boot() {
  const host = createHost({ tables: {} });
  host.files.set('pi-index.json', JSON.stringify(OLD_INDEX));
  host.files.set('pi-p-pold1.json', JSON.stringify(OLD_PROJECT));
  const inst = host.load();
  await inst.ready;
  await inst.data.loadProject?.('pold1');
  return { host, inst };
}

test('v0.1.13 project loads in v0.2.0: outline mode, data intact; ids added on use but injected text unchanged', async () => {
  const { host, inst } = await boot();
  const p = await (inst.data.loadProject ? inst.data.loadProject('pold1') : inst.data.project('pold1'));
  const proj = inst.data.project('pold1') || p;
  assert.equal(proj.name, '旧项目');
  assert.equal(proj.clue.mode, 'outline', 'old projects default to outline mode');
  assert.equal(proj.setting.text, '旧设定正文');
  assert.equal(proj.setting.history.length, 1);
  const node = proj.outline.volumes[0].stages[0].data.主线节点[0];
  assert.deepEqual(JSON.parse(JSON.stringify(node)), OLD_PROJECT.outline.volumes[0].stages[0].data.主线节点[0], 'node unchanged on load');
  await inst.runtime.switchProject('pold1');
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  const text = inst.runtime.entries().map((e) => e.content).join('\n');
  assert.match(text, /旧设定正文/);
  assert.match(text, /主角在车站遇见旧友/);
  await host.settle();
  const saved = host.files.get('pi-p-pold1.json');
  void saved;
  const savedNode = JSON.parse(JSON.stringify(inst.data.project('pold1').outline.volumes[0].stages[0].data.主线节点[0]));
  assert.ok(savedNode.id, 'stable id persisted (GPT §18)');
  const { id, ...rest } = savedNode;
  assert.deepEqual(rest, OLD_PROJECT.outline.volumes[0].stages[0].data.主线节点[0], 'content unchanged');
  assert.ok(!text.includes(id), 'id not in the injected text');
  await inst.destroy();
});

test('switching the old project to clue mode adds ids only where missing; switching back keeps outline progress', async () => {
  const { host, inst } = await boot();
  if (inst.data.loadProject) await inst.data.loadProject('pold1');
  await inst.runtime.switchProject('pold1');
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  const before = JSON.parse(JSON.stringify(inst.runtime.progress()));
  inst.data.updateProject('pold1', (x) => ({ ...x, clue: { ...x.clue, mode: 'clue' } }));
  inst.runtime.clue.invalidate();
  inst.runtime.clue.compute();
  const nodes = inst.data.project('pold1').outline.volumes[0].stages.flatMap((s) => s.data.主线节点);
  assert.ok(nodes.every((n) => typeof n.id === 'string' && n.id), 'ids added in clue mode');
  assert.equal(nodes[0].事件, '主角在车站遇见旧友', 'content unchanged');
  inst.data.updateProject('pold1', (x) => ({ ...x, clue: { ...x.clue, mode: 'outline' } }));
  assert.deepEqual(JSON.parse(JSON.stringify(inst.runtime.progress())).slots, before.slots, 'outline progress kept');
  await inst.destroy();
});

// ---------- checklist gaps found while mapping 03_验收与交付清单 ----------
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { buildTemplate, BINDING_YAML } from '../templates/clue-tables/build-template.mjs';
const here2 = path.dirname(fileURLToPath(import.meta.url));
const story2 = fs.readFileSync(path.join(here2, '../templates/clue-tables/示例_小镇失窃案.yaml'), 'utf8');
function live(t) {
  const out = JSON.parse(JSON.stringify(t));
  for (const [k, s] of Object.entries(out)) if (k.startsWith('sheet_')) s.content = s.content.map((row, i) => (i === 0 ? row : [i, ...row.slice(1)]));
  return out;
}
async function clueSetup() {
  const tables = live(buildTemplate({ controlRow: ['主线', ''], factRows: ['F_box', 'F_ledger', 'F_seen', 'F_print', 'F_talk'].map((code) => ({ code, label: code })), knowRows: [{ fact: 'F_seen', actor: 'user' }] }));
  const host = createHost({ tables });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('t');
  const volumes = Object.entries(YAML.parse(story2)).map(([key, stages], vi) => ({ id: `v${vi}`, key, stages: Object.entries(stages).map(([sk, data], si) => ({ id: `s${vi}_${si}`, key: sk, data })) }));
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML) } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  const set = (sheet, key, col, v) => { const s = Object.values(tables).find((x) => x && x.name === sheet); s.content.find((r, i) => i > 0 && r[1] === key)[s.content[0].indexOf(col)] = v; };
  const commit = () => { host.db.setTables(tables); };
  const status = () => Object.fromEntries(inst.runtime.clue.compute().state.nodeStates.map((s) => [s.node.uid, s.status]));
  return { host, inst, pid: p.id, set, commit, status };
}

test('F02: reorder, rename and insert nodes → node status and condition results unchanged', async () => {
  const { inst, pid, set, commit, status } = await clueSetup();
  set('关键事实表', 'F_box', '状态', '已核实'); set('关键事实表', 'F_ledger', '状态', '已核实'); commit();
  inst.runtime.clue.setFocus('n_witness');
  const before = status();
  inst.data.updateProject(pid, (x) => {
    const vols = JSON.parse(JSON.stringify(x.outline.volumes));
    const st2 = vols[0].stages[1].data;
    st2.主线节点 = [{ id: 'n_extra', 名称: '新插入', 入口: '随便看看', 发现: [{ 事实: 'F_x', 内容: 'x' }], 完成条件: { 事实: 'F_x' }, 必需: false }, st2.主线节点[1], st2.主线节点[0]];
    st2.主线节点.find((n) => n.id === 'n_ledger').名称 = '翻旧账（改名）';
    return { ...x, outline: { volumes: vols } };
  });
  inst.runtime.clue.invalidate();
  const after = status();
  for (const id of Object.keys(before)) assert.equal(after[id], before[id], `${id} unchanged`);
  assert.equal(inst.runtime.clue.compute().state.focus.uid, 'n_witness', 'manual focus survives reorder');
  await inst.destroy();
});

test('F08: main paused → no injection, but facts and manual ops are kept; resuming restores', async () => {
  const { host, inst, set, commit, status } = await clueSetup();
  set('关键事实表', 'F_box', '状态', '已核实'); commit();
  inst.runtime.clue.setFocus('n_ledger');
  const before = status();
  inst.runtime.clue.setPaused(true);
  const r = await host.send('闲聊', { reply: '聊天气' });
  assert.equal(r.text.includes('账本'), false, 'paused: nothing injected');
  assert.deepEqual(status(), before, 'facts-derived status kept while paused');
  inst.runtime.clue.setPaused(false);
  assert.equal(inst.runtime.clue.compute().state.focus.uid, 'n_ledger', 'manual focus kept across pause');
  assert.match((await host.send('继续')).text, /翻一翻店里的账本|后屋/);
  await inst.destroy();
});

test('F08b: an old project with a table switch (启用 column) still honours it', async () => {
  const { host, inst, pid, commit } = await clueSetup();
  const p = inst.data.project(pid);
  inst.data.updateProject(pid, (x) => ({ ...x, clue: { ...x.clue, bindings: { ...x.clue.bindings, switch: { 路径: '线索控制表/主线/启用', 开启值: 1 } } } }));
  const t = JSON.parse(JSON.stringify(host.db.tables));
  const ctrl = Object.values(t).find((s) => s && s.name === '线索控制表');
  ctrl.content[0].push('启用'); ctrl.content[1].push(0);
  host.db.setTables(t); commit();
  inst.runtime.clue.invalidate();
  assert.equal(inst.runtime.clue.compute().snap.enabled, false);
  assert.equal(inst.runtime.clue.projection().reason, '主线开关未开启');
  void p;
  await inst.destroy();
});

test('R06: repeated events and repeated panel opening are idempotent', async () => {
  const { host, inst, set, commit, status } = await clueSetup();
  set('关键事实表', 'F_box', '状态', '已核实');
  for (let i = 0; i < 3; i++) { commit(); await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); }
  const s1 = status();
  for (let i = 0; i < 3; i++) { inst.open(); await host.settle(); }
  const r = await host.send('x');
  assert.equal(r.lore.filter((e) => /后屋|裁缝铺/.test(e.content)).length, 1, 'injected exactly once');
  assert.deepEqual(status(), s1);
  await inst.destroy();
});

test('rollback: v0.1.13 (baseline script) opens a project saved by v0.2.0 in clue mode; outline content intact', async () => {
  // 1) v0.2.0 writes a clue-mode project with ids, clue fields and <仅作者> setting
  const { host, inst, pid } = await clueSetup();
  inst.data.updateProject(pid, (x) => ({ ...x, setting: { ...x.setting, text: '公开设定\n<仅作者>秘密</仅作者>' } }));
  inst.runtime.clue.compute();
  await inst.destroy();
  await host.settle();
  const saved = JSON.parse(host.files.get(`pi-p-${pid}.json`));
  assert.equal(saved.clue.mode, 'clue');
  // 2) a fresh host with the same files, running the ORIGINAL v0.1.13 script
  const old = createHost({ tables: {} });
  for (const [k, v] of host.files) old.files.set(k, v);
  const baseline = JSON.parse(fs.readFileSync(path.join(here2, './fixtures/v0.1.13.json'), 'utf8')).content;
  const oldInst = old.load(baseline);
  assert.ok(oldInst && oldInst.version === '0.1.13', 'baseline script loaded');
  await oldInst.ready;
  const p = await oldInst.data.loadProject(pid);
  assert.ok(p, 'project opens');
  const node = p.outline.volumes[0].stages[0].data.主线节点[0];
  assert.equal(node.id, 'n_report');
  assert.equal(node.入口, '去杂货店看看出了什么事', 'clue fields kept as plain node data');
  assert.equal(p.outline.volumes.length, saved.outline.volumes.length);
  assert.ok(!('clue' in p), 'v0.1.13 drops the clue config on normalize (re-entering clue mode needs the binding again)');
  await oldInst.destroy();
});

test('run page: pause / resume buttons; all-done card offers 开始下一段主线', async () => {
  const { host, inst, set, commit } = await clueSetup();
  inst.open(); await new Promise((r) => setTimeout(r, 20));
  const doc = host.w.document, tick = () => new Promise((r) => setTimeout(r, 20));
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  doc.querySelector('[data-act="clue-pause"][data-value="1"]').click(); await tick();
  assert.equal(inst.runtime.clue.diagnose().paused, true);
  assert.match(doc.body.textContent, /已暂停/);
  assert.equal(inst.runtime.clue.projection().reason, '剧情已暂停');
  doc.querySelector('[data-act="clue-pause"][data-value=""]').click(); await tick();
  assert.equal(inst.runtime.clue.diagnose().paused, false);
  for (const f of ['F_box', 'F_ledger', 'F_seen', 'F_print', 'F_talk']) set('关键事实表', f, '状态', '已核实');
  commit(); inst.runtime.clue.invalidate(); inst.open(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  assert.ok(doc.querySelector('[data-act="clue-next"]'), 'next-mainline button when every stage ended');
  await inst.destroy();
});

test('run page: plot preset with a story-driving task → warning; paused → no warning; recall-only → none', async () => {
  const P = JSON.parse(fs.readFileSync(new URL('./fixtures/plot-presets.json', import.meta.url), 'utf8'));
  const { host, inst } = await clueSetup();
  const api = host.w.AutoCardUpdaterAPI;
  let preset = P.huizhencheng;
  api.getCurrentPlotPreset = () => preset.name;
  api.getPlotPresetDetails = () => preset;
  inst.open(); await new Promise((r) => setTimeout(r, 20));
  const doc = host.w.document, tick = () => new Promise((r) => setTimeout(r, 20));
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  assert.match(doc.body.textContent, /启用了召回以外的任务：「推进」/);
  inst.runtime.clue.setPaused(true); doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  assert.ok(!/启用了召回以外的任务/.test(doc.body.textContent), 'no warning while paused');
  inst.runtime.clue.setPaused(false); preset = P.timeRecall; doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  assert.ok(!/启用了召回以外的任务/.test(doc.body.textContent), 'recall-only preset → no warning');
  await inst.destroy();
});
