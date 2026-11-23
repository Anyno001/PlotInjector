// 导入审阅与改大纲（总方案第十节，GPT 审阅 R5 / A / C）：检查器的跨线误报、结构化问题、短名候选。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';

const C = loadCore();
const N = (id, gives, extra = {}) => ({ id, 名称: `节点${id}`, 入口: `去${id}`, 发现: gives.map((f) => ({ 事实: f, 内容: `${f}的内容` })), 完成条件: gives.length ? { 事实: gives[0] } : undefined, ...extra });
const line = (vid, key, lineHead, stages) => ({ id: vid, key, line: lineHead, stages: stages.map((data, i) => ({ id: `${vid}s${i}`, key: `阶段${i + 1}_x`, data })) });

// M1 的最后一个阶段有两条替代途径，任一条都能结束 M1；M2 是手动开启的另一条线。
const m1 = () => line('v1', '剧情_M1_街区', { 编号: 'M1', 类型: '主线' }, [
  { 主线节点: [N('a0', ['F0'])] },
  { 结束条件: { 任一: [{ 事实: 'FA' }, { 事实: 'FB' }] }, 主线节点: [N('nA', ['FA'], { 必需: false }), N('nB', ['FB'], { 必需: false })] },
]);
const m2 = () => line('v2', '剧情_M2_下一案', { 编号: 'M2', 类型: '主线', 开启方式: '人工' }, [{ 主线节点: [N('b0', ['FX'])] }]);

test('R5: the last stage of one line is not checked against the first stage of the next line', () => {
  const alone = C.clueAlternativeRoutes([m1()]);
  assert.deepEqual(alone.map((r) => r.verdict), ['ok', 'ok'], JSON.stringify(alone));
  const both = C.clueAlternativeRoutes([m1(), m2()]);
  assert.deepEqual(both.map((r) => r.verdict), ['ok', 'ok'], `M2 waiting for a manual start is not a dead end: ${JSON.stringify(both)}`);
  const issues = C.importReachIssues([m1(), m2()]).filter((x) => x.level === 'error');
  assert.deepEqual(issues, [], JSON.stringify(issues));
});

test('R5: inside one line the next stage is still checked (a real dead end is still reported)', () => {
  const v = line('v1', '剧情_M1_街区', { 编号: 'M1', 类型: '主线' }, [
    { 结束条件: { 任一: [{ 事实: 'FA' }, { 事实: 'FB' }] }, 主线节点: [N('nA', ['FA'], { 必需: false }), N('nB', ['FB'], { 必需: false })] },
    { 进入条件: { 事实: 'FA' }, 主线节点: [N('c0', ['FC'])] },
  ]);
  const r = C.clueAlternativeRoutes([v, m2()]);
  assert.deepEqual(r.map((x) => [x.node, x.verdict]), [['nA', 'ok'], ['nB', 'blocked']], JSON.stringify(r));
});

test('R5: without any line metadata (one plain volume after another) the old behaviour is kept', () => {
  const plain = (vid, stages) => ({ id: vid, key: `剧情_${vid}`, stages: stages.map((data, i) => ({ id: `${vid}s${i}`, key: `阶段${i + 1}_x`, data })) });
  const a = plain('va', [{ 结束条件: { 任一: [{ 事实: 'FA' }, { 事实: 'FB' }] }, 主线节点: [N('nA', ['FA'], { 必需: false }), N('nB', ['FB'], { 必需: false })] }]);
  const b = plain('vb', [{ 进入条件: { 事实: 'FA' }, 主线节点: [N('c0', ['FC'])] }]);
  const r = C.clueAlternativeRoutes([a, b]);
  assert.deepEqual(r.map((x) => [x.node, x.verdict]), [['nA', 'ok'], ['nB', 'blocked']], 'plain volumes are one chain, as before');
});

// ---------- A：问题带人话、怎么改、编号 ----------
const stage = (vid, sid, key, data) => ({ id: sid, key, data });
test('A: a blocked alternative route reads in plain words (names and fact contents, no F_ / node ids) and carries ids', () => {
  const vols = [{ id: 'v1', key: '剧情_M1', stages: [stage('v1', 's5', '阶段5_两条线', {
    结束条件: { 任一: [{ 事实: 'F_cross' }, { 事实: 'F_bill' }] },
    主线节点: [
      { id: 'n_ye', 名称: '叶莲娜的半张图', 发现: [{ 事实: 'F_cross', 内容: '两边核对批次后确认是同一批货' }], 完成条件: { 事实: 'F_cross' }, 必需: false },
      { id: 'n_test', 名称: '借设备做一次检测', 发现: [{ 事实: 'F_risk', 内容: '器材容易过热' }], 完成条件: { 事实: 'F_risk' }, 必需: false },
      { id: 'n_ma', 名称: '见维修工', 发现: [{ 事实: 'F_bill', 内容: '交货单指向冷库' }], 完成条件: { 事实: 'F_bill' }, 必需: false },
    ] })] }];
  const r = C.checkImportDraft(vols, { secrets: [] }).filter((x) => x.kind === 'route');
  assert.equal(r.length, 1, JSON.stringify(r.map((x) => x.text)));
  assert.equal(r[0].stageId, 's5');
  assert.deepEqual(r[0].nodeIds, ['n_test']);
  assert.match(r[0].plain, /「阶段5 两条线」：玩家只做「借设备做一次检测」的话，拿不到「两边核对批次后确认是同一批货」或「交货单指向冷库」/);
  assert.doesNotMatch(r[0].plain, /F_|n_test/);
  assert.ok(r[0].fix && r[0].text, 'fix and the original text are both kept');
});

test('A: a secret name in AI指令 says where and why in plain words, with the stage id', () => {
  const vols = [{ id: 'v1', key: '剧情_M1', stages: [stage('v1', 's7', '阶段7_拦截', { AI指令: '查出埃利奥特·维恩组织这笔交易', 主线节点: [N('n7', ['F7'])] })] }];
  const e = C.checkImportDraft(vols, { secrets: ['埃利奥特·维恩'] }).find((x) => x.kind === 'secret-body');
  assert.equal(e.stageId, 's7');
  assert.equal(e.plain, '「阶段7 拦截」的AI指令写了「埃利奥特·维恩」：正文每一轮都会看到这个名字，玩家还没查到就泄露了。');
});

test('A: a secret full name in a 记录 (fill layer) is an error pointing at that record; only in 内容 it is a reveal warning', () => {
  const node = (d) => ({ ...N('n8', []), 发现: [{ 事实: 'F8', 内容: '对峙', ...d }], 完成条件: { 事实: 'F8' } });
  const vols = (d) => [{ id: 'v1', key: '剧情_M1', stages: [stage('v1', 's8', '阶段8_对峙', { 主线节点: [node(d)] })] }];
  const secrets = ['埃利奥特·维恩'];
  const fill = C.checkImportDraft(vols({ 记录: '正文出现埃利奥特·维恩时登记' }), { secrets }).filter((x) => /^secret-/.test(x.kind));
  assert.deepEqual(fill.map((x) => [x.kind, x.level]), [['secret-fill', 'error']]);
  assert.deepEqual(fill[0].spots.map((x) => [x.stageId, x.field]), [['s8', 'n8.发现[F8].记录']]);
  const reveal = C.checkImportDraft(vols({ 内容: '对方就是埃利奥特·维恩' }), { secrets }).filter((x) => /^secret-/.test(x.kind));
  assert.deepEqual(reveal.map((x) => [x.kind, x.level]), [['secret-reveal', 'warn']], 'not reported as a fill error');
  assert.deepEqual(reveal[0].spots.map((x) => x.field), ['n8.发现[F8].内容']);
});

// ---------- C：疑似短名 ----------
const idx = (people) => ({ secretFlag: true, 人物: people });
test('C: a part of a secret full name used alone in a visible field is a "needs checking" warning, not an error', () => {
  const index = idx([{ 名称: '埃利奥特·维恩', 名字保密: true }, { 名称: '彼得·帕克', 别名: ['蜘蛛侠'] }]);
  assert.deepEqual(C.importSecretShorts(index), [{ short: '埃利奥特', full: '埃利奥特·维恩' }, { short: '维恩', full: '埃利奥特·维恩' }]);
  const vols = [{ id: 'v', key: '剧情_M1', stages: [stage('v', 's6', '阶段6_现场', { 主线节点: [{ ...N('n6', ['F6']), 发现: [{ 事实: 'F6', 内容: '对峙', 记录: '正文出现维恩声称自己只是转手商时登记' }] }] })] }];
  const w = C.checkImportDraft(vols, { index }).filter((x) => x.kind === 'secret-short');
  assert.equal(w.length, 1);
  assert.equal(w[0].level, 'warn');
  assert.equal(w[0].name, '维恩');
  assert.match(w[0].plain, /可能就是保密的「埃利奥特·维恩」/);
});

test('C: parts that belong to a public character, generic words, or listed aliases are not candidates', () => {
  const index = idx([
    { 名称: '马特奥·维恩', 名字保密: false },
    { 名称: '埃利奥特·维恩', 名字保密: true },
    { 名称: '老板·梅森', 别名: ['梅森'], 名字保密: true },
  ]);
  assert.deepEqual(C.importSecretShorts(index), [{ short: '埃利奥特', full: '埃利奥特·维恩' }], '维恩 is also a public name part; 老板 is generic; 梅森 is already an alias');
});

test('C: the full name already reported is not reported again as a short-name candidate', () => {
  const index = idx([{ 名称: '埃利奥特·维恩', 名字保密: true }]);
  const vols = [{ id: 'v', key: '剧情_M1', stages: [stage('v', 's1', '阶段1_x', { AI指令: '埃利奥特·维恩在幕后', 主线节点: [N('n1', ['F1'])] })] }];
  const r = C.checkImportDraft(vols, { index });
  assert.equal(r.filter((x) => x.kind === 'secret-body').length, 1);
  assert.equal(r.filter((x) => x.kind === 'secret-short').length, 0);
});

// ---------- 去重：按同一根因，不整阶段隐藏 ----------
test('dedupe: a stage already explained by a blocked route is not repeated as "unreachable"; an independent dead end still is', () => {
  const s5 = { 结束条件: { 任一: [{ 事实: 'FA' }, { 事实: 'FB' }] }, 主线节点: [N('nT', ['FT'], { 必需: false }), N('nU', ['FU'], { 必需: false }), N('nB', ['FB'], { 必需: false, 开放条件: { 事实: 'F_never' } })] };
  const s6 = { 主线节点: [N('n6', ['F6'])] };
  const vols = [{ id: 'v', key: '剧情_M1', stages: [stage('v', 's5', '阶段5_x', s5), stage('v', 's6', '阶段6_y', s6)] }];
  const r = C.importReachIssues(vols);
  assert.equal(C.clueReachability(vols).verdict, 'blocked', 'the case really is a dead end');
  assert.ok(r.some((x) => x.kind === 'route' && x.stageId === 's5'), 'the route problem is reported');
  assert.ok(!r.some((x) => x.kind === 'reach'), `no second "unreachable" for the same cause: ${JSON.stringify(r.map((x) => x.plain))}`);
  // 另一个阶段有独立的死锁（进入条件要一个谁都不产出的事实）：照样报
  const s7 = { 进入条件: { 事实: 'F_nobody' }, 主线节点: [N('n7', ['F7'])] };
  const ok5 = { 主线节点: [N('n1', ['F1'])] };
  const r2 = C.importReachIssues([{ id: 'v', key: '剧情_M1', stages: [stage('v', 's1', '阶段1_a', ok5), stage('v', 's7', '阶段2_b', s7)] }]);
  assert.ok(r2.some((x) => x.kind === 'reach' && x.stageIds.includes('s7')), JSON.stringify(r2));
});

// ---------- H：「结束」= 完成或放弃；原来的「完成」不变 ----------
test('H: {线: M1 == 结束} is met by done or abandoned; {线: M1 == 完成} still needs done', () => {
  const lineVol = (id, extra = {}) => ({ id: `v${id}`, key: `剧情_${id}`, line: { 编号: id, 类型: '主线', ...extra }, stages: [{ id: `s${id}`, key: '阶段1_x', data: { 主线节点: [N(`n${id}`, [`F${id}`])] } }] });
  const vols = [lineVol('M1'), { ...lineVol('M2', { 开启条件: { 线: 'M1 == 结束' } }) }, lineVol('M3', { 开启条件: { 线: 'M1 == 完成' } })];
  const compiled = C.compileClue(vols);
  const state = (m1) => C.computeClueState(compiled, { facts: new Map(), knowledge: [], tables: {}, problems: [] }, { ...C.emptyClueProgress(), lines: { M1: { started: true, state: m1 } } }, C.normalizeClue({ mode: 'clue' }));
  const of = (s, id) => s.lineStates.find((x) => x.line.id === id);
  const ab = state('abandon');
  assert.equal(of(ab, 'M1').state, '放弃');
  assert.equal(of(ab, 'M2').cond.v, 'true', 'abandoned counts as ended');
  assert.notEqual(of(ab, 'M3').cond.v, 'true', 'abandoned is not done');
  const dn = state('done');
  assert.equal(of(dn, 'M2').cond.v, 'true');
  assert.equal(of(dn, 'M3').cond.v, 'true');
});

// ---------- 按意见修改：回复拆分（DeepSeek 实测常漏写「【单位：…】」）----------
test('splitUnitReplies: marked blocks win; an unmarked single block maps to the only unit; several are matched only by the requested stage names', () => {
  const blk = (k, body) => `${k ? `【单位：${k}】\n` : ''}\`\`\`yaml\n${body}\n\`\`\``;
  assert.deepEqual(Object.keys(C.splitUnitReplies(`${blk('v/a', '阶段1_x:\n  a: 1')}\n${blk('v/b', '阶段2_y:\n  b: 1')}`)), ['v/a', 'v/b']);
  assert.deepEqual(Object.keys(C.splitUnitReplies(blk('', '阶段1_x:\n  a: 1'), [{ key: 'v/a', name: '阶段1_x' }])), ['v/a']);
  const two = [{ key: 'v/a', name: '阶段1_x' }, { key: 'v/b', name: '阶段2_y' }];
  assert.deepEqual(Object.keys(C.splitUnitReplies(`${blk('', '阶段2_y:\n  b: 1')}\n${blk('', '阶段1_x:\n  a: 1')}`, two)).sort(), ['v/a', 'v/b']);
  assert.deepEqual(C.splitUnitReplies(`${blk('', '阶段9_别的:\n  b: 1')}\n${blk('', '阶段1_x:\n  a: 1')}`, two), { 'v/a': '阶段1_x:\n  a: 1\n' }, 'a block for a stage that was not asked for is not used');
  assert.deepEqual(C.splitUnitReplies('好的，我改了。', two), {});
});

test('A: the same secret name in two stages is reported once per stage, so each stage page gets its own comment', () => {
  const vols = [{ id: 'v', key: '剧情_M1', stages: [
    stage('v', 's6', '阶段6_拦截', { AI指令: '维恩要求继续交货', 主线节点: [N('n6', ['F6'])] }),
    stage('v', 's7', '阶段7_收尾', { AI指令: '维恩被带走', 主线节点: [N('n7', ['F7'])] }),
  ] }];
  const e = C.checkImportDraft(vols, { secrets: ['维恩'] }).filter((x) => x.kind === 'secret-body');
  assert.deepEqual(e.map((x) => x.stageId), ['s6', 's7']);
  assert.match(e[1].plain, /^「阶段7 收尾」的AI指令写了「维恩」/);
});

test('splitUnitReplies: one marked block plus one unmarked block — the unmarked one is matched by its stage name', () => {
  const blk = (k, body) => `${k ? `【单位：${k}】\n` : ''}\`\`\`yaml\n${body}\n\`\`\``;
  const two = [{ key: 'v/a', name: '阶段6_拦截' }, { key: 'v/b', name: '阶段7_收尾' }];
  const r = C.splitUnitReplies(`${blk('', '阶段6_拦截:\n  a: 1')}\n${blk('v/b', '阶段7_收尾:\n  b: 1')}`, two);
  assert.deepEqual(Object.keys(r).sort(), ['v/a', 'v/b']);
  assert.match(r['v/a'], /^阶段6_拦截/);
});

// ---------- 按意见修改：读回复（DeepSeek 实测：把阶段包在卷名下面，连线头一起给）----------
test('parseUnitReply: a stage wrapped in a volume (with a line head) is unwrapped by the requested name; a whole volume is never taken as one stage', () => {
  const wrapped = '剧情_卷X_标题:\n  线: {编号: S3, 类型: 支线}\n  阶段3_两条记录:\n    AI指令: 新指令\n    主线节点:\n      - {id: n1, 名称: 甲}\n      - {id: n2, 名称: 乙}\n';
  const r = C.parseUnitReply('v/s3', wrapped, '阶段3_两条记录', 2);
  assert.equal(r.stage.key, '阶段3_两条记录');
  assert.equal(r.stage.data.主线节点.length, 2);
  assert.equal(r.stage.data.AI指令, '新指令');
  // 只要了阶段3，回复里是别的阶段名：不认
  assert.throws(() => C.parseUnitReply('v/s3', '剧情_卷X:\n  线: {编号: S3}\n  阶段9_别的:\n    主线节点: [{id: n1}]\n  阶段8_也不是:\n    主线节点: [{id: n2}]\n', '阶段3_两条记录', 2), /回复中没有这个阶段/);
  // 原来有节点、回复里一个都没有：不认（不清空）
  assert.throws(() => C.parseUnitReply('v/s3', '阶段3_两条记录:\n  AI指令: 只剩指令\n', '阶段3_两条记录', 3), /没有任何场景/);
  // 改了阶段名的单个阶段：照样认
  assert.equal(C.parseUnitReply('v/s3', '阶段3_两条记录与合流:\n  主线节点: [{id: n1, 名称: 甲}]\n', '阶段3_两条记录', 1).stage.key, '阶段3_两条记录与合流');
  // 线头：三种写法
  assert.deepEqual(C.parseUnitReply('v/line', '线: {简介: a}', '线').line, { 简介: 'a' });
  assert.deepEqual(C.parseUnitReply('v/line', '剧情_x:\n  线: {简介: b}\n', '线').line, { 简介: 'b' });
  assert.deepEqual(C.parseUnitReply('v/line', '简介: c', '线').line, { 简介: 'c' });
});

test('sourceExcerpt: a long source part keeps the advancing / gating sections, not just the first 2400 chars', () => {
  const filler = (t) => `### ${t}\n\n${'描写。'.repeat(400)}`;
  const src = ['## S3：两条记录', filler('S3A 实际经过'), filler('S3B 实际经过'), '### 推进条件\n\n任意一路先查到足够材料，也可以先联系露丝。', filler('防全知')].join('\n');
  const x = C.sourceExcerpt(src, 0, src.length, 1200);
  assert.ok(x.length <= 1300);
  assert.match(x, /任意一路先查到足够材料/);
  assert.match(x, /^## S3：两条记录/);
  assert.equal(C.sourceExcerpt('短原文', 0, 3), '短原文');
});
