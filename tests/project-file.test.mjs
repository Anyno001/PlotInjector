// 打包整个项目（用户 2026-11-17）：数据管理页导出大纲 / 完整项目；「新项目」里从文件导入，建成新项目，重名加「（导入）」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';

const C = loadCore();
const PF = await import(new URL('../src/core/project-file.js', import.meta.url).href);
const tick = () => new Promise((r) => setTimeout(r, 30));

const VOL = {
  id: 'v1', key: '剧情_M1_案子',
  line: { 编号: 'M1', 类型: '主线', 简介: '一个案子', 开启条件: { 表: '重要角色表/彼得·帕克/对<user>阶段 >= 3' } },
  stages: [{ id: 's1', key: '阶段1_查', data: { AI指令: '查', 主线节点: [{ id: 'n1', 名称: '查', 入口: '去查', 发现: [{ 事实: 'F_a', 内容: '维恩组织了交易', 记录: '查到才算' }], 完成条件: { 事实: 'F_a' }, 作者备注: '<仅作者>幕后是维恩</仅作者>' }] } }],
};
function fullProject() {
  const p = C.newProject('街区', 1, 'normal');
  const sig = C.factLabelSig(C.factLabelContext([VOL], ['F_a'])[0]);
  return C.normalizeProject({
    ...p,
    clue: { mode: 'clue', sideLimit: 2, bindings: { facts: [{ 表: '关键事实表', 编号列: '编号' }], knowledge: [], scene: { 路径: '线索控制表/1/当前场景' } }, labels: { F_a: { label: '订单', criterion: '读到订单才算', sig } } },
    setting: { text: '纽约', history: [{ at: 1, text: '旧' }], check: 'x', fixes: [], mute: [] },
    outline: { volumes: [VOL], history: [{ at: 1, text: 'old' }], renames: [], idAlias: {} },
    secretNames: { v1: { names: ['埃利奥特·维恩'], confirmed: ['维恩'], denied: [] } },
    personas: { lines: [{ id: 'pl1', name: '彼得', group: '', stages: [{ id: 'ps1', name: '初识', unitId: 's1', text: 'x' }], defaultStage: 'ps1', source: { book: 'wb' }, sources: ['wb'] }] },
    imports: ['imp1'], importAdopted: ['imp1:review:0'],
    defaults: { setting: { position: 0, depth: 6, role: 0, order: 80, enabled: true } },
  }, p.id);
}

test('buildProjectFile: packs outline, labels, secret names, settings; never imports, history or chat', () => {
  const p = fullProject();
  const f = PF.buildProjectFile(p, { version: '0.3.2' });
  assert.equal(f.kind, 'plot-injector-project');
  assert.equal(f.app, '0.3.2');
  const b = f.project;
  assert.equal(b.outline.volumes[0].line.开启条件.表, '重要角色表/彼得·帕克/对<user>阶段 >= 3');
  assert.match(b.outline.volumes[0].stages[0].data.主线节点[0].作者备注, /仅作者/, 'author notes are kept (user 2026-11-17)');
  assert.equal(b.clue.labels.F_a.label, '订单');
  assert.equal(b.clue.sideLimit, 2);
  assert.deepEqual([...b.secretNames.v1.confirmed], ['维恩']);
  assert.equal(b.defaults.setting.depth, 6);
  assert.equal(b.setting.text, '纽约');
  assert.equal(b.personas.lines[0].source, null, 'world-book source is local, dropped');
  const text = JSON.stringify(f);
  for (const k of ['imports', 'importAdopted', '"history"', 'genRefs']) assert.ok(!text.includes(k), `${k} is not packed`);
  assert.deepEqual(Object.keys(b.setting).sort(), ['mute', 'text'], 'setting: text only, no review history or check notes');
  // 不勾人设、设定
  const lean = PF.buildProjectFile(p, { personas: false, setting: false }).project;
  assert.ok(!('personas' in lean) && !('setting' in lean));
});

test('parseProjectFile: new project id, inner ids kept, labels still match their facts; bad files are refused', () => {
  const p = fullProject();
  const { project, summary } = PF.parseProjectFile(JSON.stringify(PF.buildProjectFile(p)));
  assert.notEqual(project.id, p.id, 'a new project id');
  // 文件里带了旧 id（手改的、别的版本写的）也不用它，免得和本机已有项目撞上
  const withId = PF.buildProjectFile(p);
  withId.project.id = p.id;
  assert.notEqual(PF.parseProjectFile(JSON.stringify(withId)).project.id, p.id, 'an id inside the file is ignored');
  assert.equal(project.outline.volumes[0].id, 'v1', 'line ids are kept');
  assert.equal(project.outline.volumes[0].stages[0].id, 's1');
  assert.equal(project.personas.lines[0].stages[0].unitId, 's1', 'persona stage binding still points at the stage');
  assert.deepEqual([...project.imports], []);
  assert.deepEqual([...project.outline.history], []);
  assert.equal(C.labelsToPrepare(project.outline.volumes, project.clue.labels).length, 0, 'stored labels still valid: nothing to regenerate');
  assert.deepEqual({ ...summary, exportedAt: '' }, { name: '街区', clue: true, lines: 1, labels: 1, personas: 1, setting: true, app: '', exportedAt: '', hasPersonas: true, hasSetting: true });
  assert.throws(() => PF.parseProjectFile('not json'), /不是有效的JSON/);
  assert.throws(() => PF.parseProjectFile('{"kind":"plot-injector-personas","lines":[]}'), /不是剧情注入器导出的项目文件/);
  assert.throws(() => PF.parseProjectFile(JSON.stringify({ ...PF.buildProjectFile(p), version: 2 })), /更新的插件版本/);
  assert.throws(() => PF.parseProjectFile(JSON.stringify({ kind: 'plot-injector-project', version: 1, project: { name: 'x' } })), /没有大纲/);
});

test('importedName: same name gets 「（导入）」, then a number; missingBoundTables reads table names and paths', () => {
  assert.equal(PF.importedName('街区', ['别的']), '街区');
  assert.equal(PF.importedName('街区', ['街区']), '街区（导入）');
  assert.equal(PF.importedName('街区', ['街区', '街区（导入）']), '街区（导入2）');
  const p = fullProject();
  const sheet = (name) => ({ name, content: [['row_id', 'a']] });
  assert.deepEqual(PF.missingBoundTables(p, { sheet_a: sheet('关键事实表') }), ['线索控制表']);
  assert.deepEqual(PF.missingBoundTables(p, { sheet_a: sheet('关键事实表'), sheet_b: sheet('线索控制表') }), []);
  assert.equal(PF.missingBoundTables(p, null), null);
});

// ---------- 界面 ----------
async function boot() {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.addProject(fullProject());
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  const $ = (sel) => doc.querySelector(sel);
  const click = async (sel) => { const el = $(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  // 下载：拦截 <a download>；选文件：拦截 file input 的 click
  const downloads = [];
  const w = host.w;
  w.URL.createObjectURL = (blob) => { downloads.push({ blob }); return `blob:${downloads.length}`; };
  w.URL.revokeObjectURL = () => {};
  const origClick = w.HTMLAnchorElement.prototype.click;
  w.HTMLAnchorElement.prototype.click = function () { if (this.download) downloads[downloads.length - 1].name = this.download; else origClick.call(this); };
  let nextFile = null;
  const inputClick = w.HTMLInputElement.prototype.click;
  w.HTMLInputElement.prototype.click = function () {
    if (this.type !== 'file') return inputClick.call(this);
    Object.defineProperty(this, 'files', { value: nextFile ? [nextFile] : [] });
    this.dispatchEvent(new w.Event(nextFile ? 'change' : 'cancel'));
  };
  const giveFile = (text, name = 'x.json') => { nextFile = { name, text: async () => text }; };
  const dlgBtn = async (label) => {
    const b = [...doc.querySelectorAll('.pi-dialog .pi-btn')].find((x) => x.textContent.trim() === label);
    assert.ok(b, `dialog button ${label}`); b.click(); await tick();
  };
  return { host, inst, doc, $, click, downloads, giveFile, dlgBtn, pid: p.id };
}



