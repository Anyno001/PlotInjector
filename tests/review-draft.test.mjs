// 审阅草稿与统一保存（导入审阅总方案第十节；GPT 总方案审阅第六节验收场景 1–6、11）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';

const C = loadCore();
const N = (id, gives, extra = {}) => ({ id, 名称: `节点${id}`, 入口: `去${id}`, 发现: gives.map((f) => ({ 事实: f, 内容: `${f}的内容` })), 完成条件: gives.length ? { 事实: gives[0] } : undefined, ...extra });
const vol = (vid, key, line, stages) => ({ id: vid, key, ...(line ? { line } : {}), stages: stages.map(([sid, skey, data]) => ({ id: sid, key: skey, data })) });
const M1 = () => vol('v1', '剧情_M1_街区', { 编号: 'M1', 类型: '主线', 简介: '街区的案子', 入口提示: '路灯坏了' }, [
  ['s1', '阶段1_灯', { 主线节点: [N('n1', ['F1'])] }],
  ['s2', '阶段2_当铺', { 主线节点: [N('n2', ['F2'])] }],
  ['s3', '阶段3_零件', { 进入条件: { 事实: 'F2' }, 主线节点: [N('n3', ['F3'])] }],
]);
const project = (volumes) => ({ id: 'p', outline: { volumes, history: [] } });
// 一个聊天的进度：F1 已核实 → n1 已完成
const clueAt = (facts) => ({
  snap: { facts: new Map(facts.map((f) => [f, { id: f, status: 'confirmed', text: '', raw: '已核实' }])), knowledge: [], tables: {}, problems: [] },
  prog: C.emptyClueProgress(),
  config: C.normalizeClue({ mode: 'clue' }),
});

// ---------- 场景 1：已完成节点被 AI 漏掉，保存后确实还在；大纲历史可恢复 ----------
test('1: a done node the AI dropped is really put back on save, and the old outline goes into history', () => {
  const p = project([M1()]);
  const s = C.createReviewSession({ source: 'project', projectId: 'p', volumes: [M1()] });
  const edited = C.editDraft(s, 'AI 修改', (d) => C.putStage(d, 'v1', 's1', { key: '阶段1_灯', data: { 主线节点: [N('n9', ['F9'])] } }));
  const prep = C.prepareCommit(p, edited.draft, { clue: clueAt(['F1']) });
  assert.deepEqual(prep.restored, ['n1']);
  const s1 = prep.volumes[0].stages.find((x) => x.id === 's1');
  assert.ok(s1.data.主线节点.some((n) => n.id === 'n1'), 'n1 is back in stage 1');
  assert.equal(prep.history.length, 1);
  assert.match(prep.history[0].text, /n1/, 'history holds the old outline');
  const w = C.commitOutline(p, prep);
  assert.ok(w.ok);
  assert.ok(w.outline.volumes[0].stages[0].data.主线节点.some((n) => n.id === 'n1'));
});

// ---------- 场景 2：在原阶段前插新阶段、重排、改名：原阶段 id 保住 ----------
test('2: inserting a stage in front, reordering and renaming keep every old stage its own id (no positional backfill)', () => {
  const old = M1();
  const incoming = { key: old.key, line: old.line, stages: [
    { key: '阶段0_序章', data: { 主线节点: [N('n0', ['F0'])] } },
    { key: '阶段1_灯', data: { 主线节点: [N('n1', ['F1'])] } },
    { key: '阶段3_零件检查', data: { 进入条件: { 事实: 'F2' }, 主线节点: [N('n3', ['F3'])] } },
    { key: '阶段2_当铺', data: { 主线节点: [N('n2', ['F2'])] } },
  ] };
  const { volumes, match } = C.putVolume([old], 'v1', incoming);
  const byKey = Object.fromEntries(volumes[0].stages.map((s) => [s.key, s.id]));
  assert.equal(byKey['阶段1_灯'], 's1');
  assert.equal(byKey['阶段2_当铺'], 's2');
  assert.equal(byKey['阶段3_零件检查'], 's3', 'renamed stage matched by its node ids');
  assert.ok(!['s1', 's2', 's3'].includes(byKey['阶段0_序章']), 'the new stage gets a new id');
  assert.deepEqual(match.removed, []);
  // 人设绑定的 unitId 仍指向同一件事
  const stageIds = Object.fromEntries(C.flattenUnits(volumes).map((u) => [u.id, `${u.volume.id}:${u.stage.key}`]));
  assert.equal(stageIds['s2'], 'v1:阶段2_当铺');
});

test('2b: a stage the AI left out is reported as removed, not silently re-used for another one', () => {
  const old = M1();
  const { match } = C.putVolume([old], 'v1', { key: old.key, stages: [old.stages[0], old.stages[2]].map((s) => ({ key: s.key, data: s.data })) });
  assert.deepEqual(match.removed, [{ id: 's2', key: '阶段2_当铺' }]);
});

// ---------- 场景 3：只改线头的开始条件：其余都不变 ----------
test('3: changing only the start condition keeps nodes, stages, the line number and every other head field', () => {
  const old = M1();
  const next = C.putLine([old], 'v1', { 编号: 'M9', 类型: '支线', 开启条件: { 线: 'M0 == 完成' }, 简介: 'AI 顺手改的简介' }, ['开启条件']);
  const l = next[0].line;
  assert.equal(l.编号, 'M1', 'the number is kept by the program');
  assert.equal(l.类型, '主线', 'type not requested → kept');
  assert.equal(l.简介, '街区的案子', 'brief not requested → kept');
  assert.deepEqual(l.开启条件, { 线: 'M0 == 完成' });
  assert.deepEqual(next[0].stages, old.stages);
  assert.deepEqual(C.lineChanges(old.line, l), ['开始条件：（无） → {线:M0 == 完成}']);
  // 不限制字段（整条线改写）时，编号照样由程序保留
  const free = C.putLine([old], 'v1', { 编号: 'M9', 简介: '新简介' });
  assert.equal(free[0].line.编号, 'M1');
  assert.equal(free[0].line.简介, '新简介');
  assert.equal(C.putVolume([old], 'v1', { key: old.key, line: { 编号: 'M9', 类型: '主线' }, stages: old.stages.map((x) => ({ key: x.key, data: x.data })) }).volumes[0].line.编号, 'M1');
});

// ---------- 场景 4：关联修改成组；漏回或被改过的不应用半组，独立组照常 ----------
test('4: related units form one group; a group is applied only whole, an independent group still completes', () => {
  const v = vol('v1', '剧情_M1', { 编号: 'M1', 类型: '主线' }, [
    ['s2', '阶段2_a', { 主线节点: [N('n2', ['F2'])] }],
    ['s5', '阶段5_b', { 进入条件: { 事实: 'F2' }, 主线节点: [N('n5', ['F5'])] }],
    ['s8', '阶段8_c', { 主线节点: [N('n8', ['F8'])] }],
  ]);
  const groups = C.relatedGroups([v], ['v1/s2', 'v1/s5', 'v1/s8']);
  assert.deepEqual(groups.map((g) => g.sort()), [['v1/s2', 'v1/s5'], ['v1/s8']]);
  const snap = Object.fromEntries(['v1/s2', 'v1/s5', 'v1/s8'].map((k) => [k, JSON.stringify(C.unitValue([v], k))]));
  // 模型漏回 s5
  let r = C.groupVerdict(groups[0], { 'v1/s2': {} }, snap, [v]);
  assert.equal(r.ok, false);
  assert.deepEqual(r.missing, ['v1/s5']);
  // 用户期间改了 s5
  const touched = [{ ...v, stages: v.stages.map((s) => (s.id === 's5' ? { ...s, key: '阶段5_改过' } : s)) }];
  r = C.groupVerdict(groups[0], { 'v1/s2': {}, 'v1/s5': {} }, snap, touched);
  assert.deepEqual(r.touched, ['v1/s5']);
  // 独立的 s8 照常；模型多给的单位只列出来，不算
  r = C.groupVerdict(groups[1], { 'v1/s8': {}, 'v1/s2': {} }, snap, touched);
  assert.equal(r.ok, true);
  assert.deepEqual(r.extra, ['v1/s2']);
  // 组外但有引用的单位作为只读上下文
  const ctx = C.groupContext([v], ['v1/s5']);
  assert.ok(ctx.units.includes('v1/s2'), 's2 produces F2 that s5 needs');
});

// ---------- 场景 5：审阅中编辑并关闭：正式大纲不变；保存后才应用 ----------
test('5: editing a review session never touches the project; only commit does; undo / reset only move the draft', () => {
  const p = project([M1()]);
  const before = JSON.stringify(p.outline.volumes);
  let s = C.createReviewSession({ source: 'project', projectId: 'p', volumes: p.outline.volumes });
  s = C.editDraft(s, '改 AI指令', (d) => C.putStage(d, 'v1', 's2', { key: '阶段2_当铺', data: { AI指令: '新', 主线节点: [N('n2', ['F2'])] } }));
  assert.equal(JSON.stringify(p.outline.volumes), before, 'project untouched while reviewing');
  const reopened = JSON.parse(JSON.stringify(s));
  assert.equal(reopened.draft[0].stages[1].data.AI指令, '新', 'the draft survives a save / reopen round trip');
  assert.deepEqual(C.draftChanges(s.base, s.draft), [{ key: 'v1/s2', changes: ['AI指令改了'] }]);
  assert.equal(JSON.stringify(C.undoDraft(s).draft), before);
  // 确认期间大纲被别处改了：不写
  const prep = C.prepareCommit(p, s.draft);
  const moved = { ...p, outline: { ...p.outline, volumes: [{ ...p.outline.volumes[0], key: '别处改了名' }] } };
  assert.equal(C.commitOutline(moved, prep).ok, false);
  assert.equal(C.commitOutline(p, prep).ok, true);
});

// ---------- 场景 6：旧任务已在 lineReview.items 改过：以改稿为准，不从 drafts 重建 ----------
test('6: an old multi-line job keeps the reviewed versions in lineReview.items; dropped lines stay dropped (migration into the review session)', () => {
  const reviewed = vol('vS1', '剧情_S01_改过', { 编号: 'S01', 类型: '支线' }, [['a', '阶段1_x', { 主线节点: [N('x1', ['X1'])] }]]);
  const other = vol('vS2', '剧情_S02_不要', { 编号: 'S02', 类型: '支线' }, [['b', '阶段1_y', { 主线节点: [N('y1', ['Y1'])] }]]);
  const job = { id: 'j1', projectId: 'p', lineReview: { order: ['S01', 'S02'], items: { S01: { vol: reviewed, comment: '入口写具体' }, S02: { vol: other, dropped: true } } }, drafts: { 0: { list: [] } } };
  const r = C.linesSessionOf(job);
  assert.deepEqual(r.draft.map((v) => v.key), ['剧情_S01_改过', '剧情_S02_不要'], 'reviewed versions, not rebuilt from drafts');
  assert.deepEqual([...r.dropped], ['vS2'], 'dropped stays dropped');
  assert.equal(r.comments['vS1/line'], '入口写具体');
  assert.deepEqual(C.linesToAdopt(r).map((v) => v.id), ['vS1']);
});

// ---------- 改动摘要写实质变化 ----------
test('changes list node adds / removes, condition and fact changes instead of "内容有改动"', () => {
  const a = { key: '阶段5_两条线', data: { 结束条件: { 事实: 'FA' }, 主线节点: [N('nA', ['FA']), N('nT', ['FT'], { 开放条件: { 事实: 'F_Q74' } })] } };
  const b = { key: '阶段5_两条线', data: { 结束条件: { 任一: [{ 事实: 'FA' }, { 事实: 'FB' }] }, 主线节点: [N('nT', ['FT'], { 开放条件: { 事实: 'F_yelena' } }), N('nB', ['FB'])] } };
  assert.deepEqual(C.stageChanges(a, b), [
    '结束条件：{事实:FA} → {任一:[{事实:FA},{事实:FB}]}',
    '新增节点「节点nB」',
    '删除节点「节点nA」',
    '「节点nT」的开放条件：{事实:F_Q74} → {事实:F_yelena}',
  ]);
});

// ---------- 场景 11：保密名单按线保存，重开还在；没有名单 ≠ 检查通过 ----------
test('11: secret names are kept per line through normalizeProject; no list at all is reported as missing (null)', () => {
  const raw = { id: 'p', name: 'x', outline: { volumes: [] }, secretNames: { v1: { names: ['埃利奥特·维恩', '维恩', 'x'], confirmed: ['梅森'] }, v2: { names: ['里德'] } } };
  const p = C.normalizeProject(JSON.parse(JSON.stringify(raw)), 'p');
  assert.deepEqual(p.secretNames, { v1: { names: ['埃利奥特·维恩', '维恩'], confirmed: ['梅森'], denied: [] }, v2: { names: ['里德'], confirmed: [], denied: [] } });
  assert.deepEqual(C.projectSecretNames(p).sort(), ['埃利奥特·维恩', '维恩', '梅森', '里德'].sort());
  assert.equal(C.projectSecretNames(C.normalizeProject({ id: 'q', outline: { volumes: [] } }, 'q')), null);
});
