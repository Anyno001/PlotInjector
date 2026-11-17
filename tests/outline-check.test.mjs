// 大纲页「检查」：线索推进的项目用和导入审阅同一套人话检查，点一条跳到那个阶段（导入审阅总方案剩余第 2 条）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import { createHost } from './host-sim.mjs';

const C = loadCore();
const tick = () => new Promise((r) => setTimeout(r, 20));
const node = (id, gives, extra = {}) => ({ id, 名称: `${id}名`, 入口: `去${id}`, 发现: [{ 事实: gives, 内容: `${gives}内容` }], 完成条件: { 事实: gives }, ...extra });
// 阶段 2：只走 a 的话，还有必需的 c 做不了（替代途径走不通）；阶段 3 的 AI指令写了保密名字
const vols = () => [
  {
    id: 'v1', key: '剧情_M1_案子', line: { 编号: 'M1', 类型: '主线' },
    stages: [
      { id: 's1', key: '阶段1_开头', data: { 主线节点: [node('n1', 'F1')] } },
      { id: 's2', key: '阶段2_两条线', data: { 结束条件: { 任一: [{ 事实: 'Fa' }, { 事实: 'Fb' }] }, 主线节点: [node('na', 'Fa', { 必需: false }), node('nb', 'Fb', { 必需: false }), node('nc', 'Fc', { 开放条件: { 全部: [{ 事实: 'Fa' }, { 事实: 'Fb' }] } })] } },
      { id: 's3', key: '阶段3_收尾', data: { AI指令: '查出埃利奥特·维恩是幕后', 主线节点: [node('n3', 'F3')] } },
    ],
  },
];

test('projectClueIssues: route problem lands on its stage; secret names only when the project has a name list', () => {
  const none = C.projectClueIssues(vols());
  assert.ok(none.some((x) => x.kind === 'route' && x.stageId === 's2'), JSON.stringify(none.map((x) => [x.kind, x.stageId])));
  assert.ok(!none.some((x) => /^secret-/.test(x.kind || '')), 'no list: no secret check, and no "not checked" nag');
  const withList = C.projectClueIssues(vols(), { secrets: ['埃利奥特·维恩'] });
  const sec = withList.find((x) => x.kind === 'secret-body');
  assert.ok(sec && sec.stageId === 's3' && /正文每一轮都会看到/.test(sec.plain));
  // 条件用到没人产出的事实 → 结构错误，带上阶段
  const bad = vols(); bad[0].stages[0].data.进入条件 = { 事实: 'F_nobody' };
  const orphan = C.projectClueIssues(bad).find((x) => /没有任何节点产出的事实/.test(x.text));
  assert.ok(orphan && orphan.level === 'error');
  // 编译错误：从文字里认出是哪个阶段，点了能跳过去
  const broken = vols(); broken[0].stages[1].data.进入条件 = '乱写的 ==';
  const ce = C.projectClueIssues(broken).find((x) => x.kind === 'compile');
  assert.ok(ce && ce.stageId === 's2', JSON.stringify(ce));
});

test('UI: outline 检查 shows plain-language clue issues (no 时间范围 nag in clue mode) and clicking one opens that stage', async () => {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('检查');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { ...x.outline, volumes: vols() }, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } }, secretNames: { v1: { names: ['埃利奥特·维恩'], confirmed: [], denied: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.data.updateSettings({ tourState: { revision: 99, done: ['core', 'outline', 'run', 'discuss', 'setting'] } });
  inst.open(); await tick();
  const doc = host.w.document, click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  await click(`[data-act="project"][data-id="${p.id}"]`);
  await click('[data-act="tab"][data-tab="outline"]');
  await click('[data-act="check-toggle"]');
  const card = [...doc.querySelectorAll('.pi-card')].find((c) => /大纲检查/.test(c.textContent));
  assert.ok(card);
  assert.match(card.textContent, /要处理的问题/);
  assert.match(card.textContent, /玩家只做「na名」的话/);
  assert.match(card.textContent, /AI指令写了「埃利奥特·维恩」/);
  assert.doesNotMatch(card.textContent, /没有写时间范围/, 'clue outlines do not use 时间范围');
  const go = [...card.querySelectorAll('[data-act="issue-go"]')].find((b) => /埃利奥特/.test(b.textContent));
  assert.equal(go.dataset.id, 's3');
  go.click(); await tick();
  assert.match(doc.querySelector('.pi-tree .is-sel').textContent, /阶段3/);
  await inst.destroy();
});

// ---------- 叫法（总方案第三节 I）：线索推进显示「剧情线 / 剧情节点 / 可选事件」，YAML 键名不变 ----------
test('naming: clue outline page says 剧情线 / 剧情节点 / 可选事件; outline-mode page keeps 卷 / 主线 / 支线; the prompt maps words to YAML keys', async () => {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const mk = async (name, clue) => {
    const p = await inst.data.createProject(name);
    inst.data.updateProject(p.id, (x) => ({ ...x, outline: { ...x.outline, volumes: vols() }, ...(clue ? { clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } } : {}) }));
    return p.id;
  };
  const a = await mk('线索', true), b = await mk('阶段', false);
  await inst.runtime.switchProject(a);
  inst.data.updateSettings({ tourState: { revision: 99, done: ['core', 'outline', 'run', 'discuss', 'setting'] } });
  inst.open(); await tick();
  const doc = host.w.document, click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  const look = async (pid) => {
    await click(`[data-act="project"][data-id="${pid}"]`);
    await click('[data-act="tab"][data-tab="outline"]');
    doc.querySelector('[data-act="sel"][data-id="s2"], [data-id="s2"]').click(); await tick();
    return doc.querySelector('.pi-body').textContent;
  };
  const clueText = await look(a);
  assert.match(clueText, /＋新剧情线/);
  assert.match(clueText, /AI 写新剧情线/);
  assert.match(clueText, /剧情节点 3/);
  assert.match(clueText, /可选事件 0/);
  const oldText = await look(b);
  assert.match(oldText, /＋新卷/);
  assert.match(oldText, /主线 3/);
  assert.doesNotMatch(oldText, /剧情节点/);
  // YAML 键名不变
  assert.ok(inst.data.project(a).outline.volumes[0].stages[1].data.主线节点);
  await inst.destroy();
  const m = C.outlineMessages({ setting: 'S', volumes: [], volumeNo: 1, mode: 'clue', request: 'x' });
  assert.match(m[0].content, /「剧情节点」= 阶段里的 主线节点:/);
  assert.match(m[0].content, /输出时只用 YAML 键名/);
  assert.match(m[1].content, /只写一条新的剧情线/);
  const o = C.outlineMessages({ setting: 'S', volumes: [], volumeNo: 1, mode: 'outline' });
  assert.doesNotMatch(o[0].content + o[1].content, /剧情线|剧情节点/, 'outline mode prompt untouched');
});

// ---------- P12：AI 写的大纲「替换选中的剧情线」保留线头（编号、类型、开启条件），阶段 id 按名称对应 ----------
test('P12: replacing a plot line with an AI draft keeps 编号 / 类型 / 开启条件 and stage ids by name; outline history is recorded', async () => {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('替换');
  const v = vols(); v[0].line = { 编号: 'M1', 类型: '主线', 开启条件: { 线: 'S01 == 完成' }, 简介: '旧简介' };
  v.push({ id: 'vS', key: '剧情_S01_小事', line: { 编号: 'S01', 类型: '支线' }, stages: [{ id: 'sS', key: '阶段1_x', data: { 主线节点: [node('ns', 'Fs')] } }] });
  inst.data.updateProject(p.id, (x) => ({ ...x, setting: { ...x.setting, text: '街区设定' }, outline: { ...x.outline, volumes: v }, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.data.updateSettings({ tourState: { revision: 99, done: ['core', 'outline', 'run', 'discuss', 'setting'] } });
  inst.open(); await tick();
  const doc = host.w.document, click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  await click(`[data-act="project"][data-id="${p.id}"]`);
  await click('[data-act="tab"][data-tab="outline"]');
  await click('[data-act="sel"][data-id="v1"]');
  // AI 写的整条线：前面插了一个新阶段，没写线头（或写了别的编号）
  host.llm.reply = '```yaml\n剧情_M9_新写的:\n  线: {编号: M9, 类型: 支线}\n  阶段0_新开头:\n    主线节点:\n      - {id: n0, 名称: 新开头, 入口: 去, 发现: [{事实: F0, 内容: x}], 完成条件: {事实: F0}}\n  阶段3_收尾:\n    主线节点:\n      - {id: n3, 名称: 收尾, 入口: 去, 发现: [{事实: F3, 内容: y}], 完成条件: {事实: F3}}\n```';
  await click('[data-act="ai-volume"]');
  await click('.pi-dialog .is-primary');
  for (let i = 0; i < 30 && !doc.querySelector('[data-act="draft-replace"]'); i++) await tick();
  const hist0 = inst.data.project(p.id).outline.history.length;
  await click('[data-act="draft-replace"]');
  await click('.pi-dialog .pi-btn.is-danger');
  const vs = inst.data.project(p.id).outline.volumes, m1 = vs[0];
  assert.equal(vs.length, 2, 'replaced in place, nothing appended');
  assert.equal(m1.id, 'v1');
  assert.equal(m1.key, '剧情_M1_案子', 'name kept');
  assert.deepEqual({ ...m1.line }, { 编号: 'M1', 类型: '主线', 开启条件: { 线: 'S01 == 完成' }, 简介: '旧简介' }, 'line head kept as is');
  assert.deepEqual([...m1.stages.map((s) => s.key)], ['阶段0_新开头', '阶段3_收尾']);
  assert.equal(m1.stages[1].id, 's3', 'the stage with the same name keeps its id');
  assert.ok(!['s1', 's2', 's3'].includes(m1.stages[0].id), 'the new stage gets a new id');
  assert.equal(inst.data.project(p.id).outline.history.length, hist0 + 1);
  await inst.destroy();
});
