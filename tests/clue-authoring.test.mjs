// Clue-mode authoring (GPT 6.2 / 6.3): clue outline prompts, draft structure check, author-view progress text,
// reference budget. Outline-mode prompts must stay byte-identical in content.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { loadCore } from './load.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
import * as referenceHelpers from "../src/ui/discuss-refs.js";
const core = loadCore();
// prompts / refs helpers are not in the core list; load them on top of the core scope
const extra = {...core, ...referenceHelpers};

const storyText = fs.readFileSync(path.join(here, '../templates/clue-tables/示例_小镇失窃案.yaml'), 'utf8');
const toVolumes = (text) => core.volumesFromValue(YAML.parse(text), (() => { let i = 0; return () => `x${i++}`; })());
const story = toVolumes(storyText);

test('outline mode prompt is unchanged (no clue rules, original sample/rules)', () => {
  const msgs = extra.outlineMessages({ setting: 'S', talk: 'T', volumes: [], volumeNo: 1, request: '' });
  assert.match(msgs[0].content, /每个阶段 2 到 4 个主线节点/);
  assert.ok(!msgs[0].content.includes('完成条件'));
  assert.equal(msgs[1].content, '【设定】\nS\n\n【讨论摘要】\nT\n\n只写第 1 卷。');
});

test('clue mode prompt: clue rules + clue sample + existing ids + refs + progress', () => {
  const msgs = extra.outlineMessages({ setting: 'S', talk: 'T', volumes: story, volumeNo: 2, mode: 'clue', refs: [{ title: '世界书·人物', text: '老人姓周' }], clueIndex: core.clueIndexText(story), progress: '【线索进度】x' });
  assert.match(msgs[0].content, /按「拿到什么才能往下走」组织剧情/);
  assert.match(msgs[0].content, /完成条件: \{事实: F01\}/);
  assert.match(msgs[0].content, /关键结论最好有两条获得途径/);
  assert.match(msgs[1].content, /【参考·世界书·人物】\n老人姓周/);
  assert.match(msgs[1].content, /n_witness「问邻居」 入口：去问问隔壁裁缝铺的邻居 · 产出 F_seen/);
  assert.match(msgs[1].content, /【线索进度】x/);
});

test('the clue sample itself parses, compiles and passes the draft check', () => {
  const vols = toVolumes(extra.CLUE_SAMPLE_STAGE);
  assert.deepEqual(core.compileClue(vols).errors, []);
  assert.deepEqual(core.checkClueDraft(vols, []), []);
});

test('the shipped sample story passes the draft check', () => {
  assert.deepEqual(core.checkClueDraft(story, []), []);
});

test('draft check: orphan facts, duplicate ids, missing done, bad node refs, bad conditions', () => {
  const draft = toVolumes(`剧情_卷二_x:
  阶段一_a:
    进入条件: {事实: F_nowhere}
    主线节点:
      - id: n_report
        名称: 重复
        入口: e
        发现: [{事实: F9, 内容: c}]
        完成条件: {事实: F9}
      - id: n_new
        名称: 无完成
        入口: e
        开放条件: {节点: n_ghost}
      - id: n_bad
        名称: 坏条件
        入口: e
        发现: [{事实: F8, 内容: c}]
        完成条件: {线索: F8}
`);
  const issues = core.checkClueDraft(draft, story).join('\n');
  assert.match(issues, /id 和已有节点重复.*n_report/);
  assert.match(issues, /没有任何节点产出的事实：F_nowhere/);
  assert.match(issues, /不存在的节点：n_ghost/);
  assert.match(issues, /没有完成条件.*n_new/);
  assert.match(issues, /没有「发现」.*n_new/);
  assert.match(issues, /坏条件/);
  // facts produced by existing volumes are fine to reference
  const ok = toVolumes(`剧情_卷二_y:
  阶段一_a:
    进入条件: {事实: F_ledger}
    主线节点:
      - {id: n_more, 名称: m, 入口: e, 发现: [{事实: F10, 内容: c}], 完成条件: {事实: F10}}
`);
  assert.deepEqual(core.checkClueDraft(ok, story), []);
});

test('draft check on rewrite: replaced remaining nodes may keep their ids', () => {
  assert.deepEqual(core.checkClueDraft(story, story, { keepIds: ['n_report', 'n_ledger', 'n_witness', 'n_backdoor', 'n_confront'] }), []);
  assert.match(core.checkClueDraft(story, story).join(''), /重复/);
});

test('clue rewrite prompt: history is fixed, unfinished ids kept, conflicts listed', () => {
  const units = core.flattenUnits(story);
  const msgs = extra.clueRewriteMessages({ setting: '', volumes: story, fromUnitIndex: 1, units, recent: '正文', reason: '玩家先去了修车铺', progress: '【线索进度】y' });
  assert.match(msgs[0].content, /已完成节点、已确认事实是已经发生的历史，不能改写/);
  assert.match(msgs[0].content, /尚未完成的节点保留原来的 id/);
  assert.match(msgs[0].content, /原计划 → 调整/);
  assert.match(msgs[1].content, /阶段二_调查/);
  assert.ok(!msgs[1].content.includes('阶段一_报案'), 'only the remaining stages are rewritten');
  assert.match(msgs[1].content, /【线索进度】y/);
});

test('fix-YAML prompt follows the project mode', () => {
  assert.match(extra.fixYamlMessages('x', 'e', 'clue')[0].content, /完成条件必须写/);
  assert.match(extra.fixYamlMessages('x', 'e')[0].content, /每个阶段 2 到 4 个主线节点/);
});

test('author-view progress text: stages, node status with ids/names, confirmed facts with holders, claims, problems', () => {
  const compiled = core.compileClue(story);
  const facts = new Map([
    ['F_box', { id: 'F_box', status: 'confirmed', text: '锁从里面撬开', raw: '已核实' }],
    ['F_seen', { id: 'F_seen', status: 'unconfirmed', claimed: true, text: '老人说看见年轻人', raw: '存疑' }],
  ]);
  const snap = { facts, knowledge: [{ fact: 'F_seen', actor: 'user', way: '被告知', verified: false }], tables: {}, problems: ['表「x」缺列'] };
  const prog = core.emptyClueProgress();
  const state = core.computeClueState(compiled, snap, prog, core.normalizeClue({ mode: 'clue' }));
  const text = core.clueProgressText(state, snap, prog, { problems: snap.problems });
  assert.match(text, /作者视角/);
  assert.match(text, /\[已完成\] n_report 接受报案/);
  assert.match(text, /\[未开放\] n_confront 找阿伟/);
  assert.match(text, /F_box：锁从里面撬开/);
  assert.match(text, /尚未核实的说法：\n- F_seen：老人说看见年轻人｜听到：user·被告知/);
  assert.match(text, /表格问题：\n- 表「x」缺列/);
});

test('reference budget: kept in order, truncation reported honestly', () => {
  const { refs, report } = extra.fitRefs([{ title: 'A', text: 'a'.repeat(100) }, { title: 'B', text: 'b'.repeat(1000) }, { title: 'C', text: 'c'.repeat(50) }], 600);
  assert.equal(refs[0].text.length, 100);
  assert.match(refs[1].text, /以下 500 字因长度限制未附带/);
  assert.equal(refs.length, 2, 'C does not fit');
  assert.equal(report.length, 3, 'every reference is reported, kept or not');
  assert.deepEqual(report.map((r) => [r.title, r.chars, r.kept]), [['A', 100, 100], ['B', 1000, 500], ['C', 50, 0]], 'A kept whole, B cut, C not attached');
});

test('body-preset entry refers to section headers the projection actually emits', () => {
  const preset = fs.readFileSync(path.join(here, '../templates/正文预设条目_线索推进.md'), 'utf8');
  const proj = fs.readFileSync(path.join(here, '../src/core/clue-project.js'), 'utf8');
  // trigger phrases (the entry only applies when these appear) + phrases the entry tells the model how to handle
  for (const phrase of ['本轮可演的场景材料', '目前可以去做的事', '可能获得的发现（尚未发生）', '已经获得的发现', '可以去做的事', '表格没有记录具体内容', '知情范围未记录']) {
    assert.ok(preset.includes(`「${phrase}」`), `preset mentions ${phrase}`);
    assert.ok(proj.includes(phrase), `projection still emits ${phrase}`);
  }
  assert.match(preset, /<剧情参考>/);
  // 11.3: the entry must not constrain outline mode — its trigger phrases never appear in outline-mode detail text
  const inject = fs.readFileSync(path.join(here, '../src/core/inject.js'), 'utf8');
  for (const trigger of ['本轮可演的场景材料', '目前可以去做的事']) assert.ok(!inject.includes(trigger), `outline mode never emits ${trigger}`);
  // 11.3: a clear single action may pay off in the same floor
  assert.match(preset, /就可以在这一楼写出观察结果/);
  assert.ok(!preset.includes('不要一楼里把整段调查写完'), 'the blanket "never finish in one floor" rule is gone');
});

// ---------- V5: creation sample gate + a real alternative path ----------
function sampleState(facts, knowledge = []) {
  const vols = toVolumes(extra.CLUE_SAMPLE_STAGE);
  const snap = { facts: new Map(Object.entries(facts).map(([id, status]) => [id, { id, status, text: '', raw: status === 'confirmed' ? '已核实' : '' }])), knowledge, tables: {} };
  const st = core.computeClueState(core.compileClue(vols), snap, core.emptyClueProgress(), core.normalizeClue({ mode: 'clue' }));
  return Object.fromEntries(st.nodeStates.map((s) => [s.node.uid, s.status]));
}

test('V5: creation sample — the user merely guessing does not pass the witness gate', () => {
  const st = sampleState({ F01: 'confirmed', F02: 'confirmed' }, [{ fact: 'F03', actor: 'user', way: '推测', verified: false }]);
  assert.notEqual(st.n03_witness, 'done');
  assert.equal(st.n04_confront, 'locked');
});

test('V5: creation sample — witness refuses, independent back-door evidence alone opens the confrontation', () => {
  const st = sampleState({ F01: 'confirmed', F02: 'confirmed', F05: 'confirmed' });
  assert.notEqual(st.n03_witness, 'done', 'witness path not taken');
  assert.notEqual(st.n04_confront, 'locked', 'one alternative path is enough');
  const st2 = sampleState({ F01: 'confirmed', F02: 'confirmed', F03: 'confirmed' });
  assert.notEqual(st2.n04_confront, 'locked', 'the testimony path also works');
  const st3 = sampleState({ F01: 'confirmed', F02: 'confirmed' });
  assert.equal(st3.n04_confront, 'locked', 'ledger alone is not enough');
});

test('V5: rules state what a code tracks, and that 知情 includes the user\'s own guesses', () => {
  assert.match(extra.CLUE_OUTLINE_RULES, /先明确这个编号追踪哪件事/);
  assert.match(extra.CLUE_OUTLINE_RULES, /「知情」连主角自己的推测也算/);
  // route checking moved to the plugin (2026-11-08); the rule now says how to write routes, not to verify them
  assert.match(extra.CLUE_OUTLINE_RULES, /各条途径产出的事实都写进下一步条件的「任一」里/);
});

// ---------- reachability (GPT §19.1) ----------
const vol = (stages) => [{ id: 'v', key: '剧情_卷一', stages: stages.map((data, i) => ({ id: `s${i}`, key: `阶段${i + 1}_x`, data })) }];
const N = (id, gives, extra = {}) => ({ id, 名称: id, 入口: `去${id}`, 发现: gives.map((f) => ({ 事实: f, 内容: `${f}内容` })), 完成条件: gives.length ? { 事实: gives[0] } : undefined, ...extra });

test('reachability: mutual lock (A needs FB, B needs FA) is blocked, even though both facts have producers', () => {
  const r = core.clueReachability(vol([{ 主线节点: [N('nA', ['FA'], { 开放条件: { 事实: 'FB' } }), N('nB', ['FB'], { 开放条件: { 事实: 'FA' } })] }]));
  assert.equal(r.verdict, 'blocked');
  assert.deepEqual(r.stuckNodes.map((x) => x.node).sort(), ['nA', 'nB']);
});
test('reachability: two alternative address sources — optional nodes + 任一 end condition passes; both required fails', () => {
  const ok = core.clueReachability(vol([
    { 结束条件: { 任一: [{ 事实: 'F_addrA' }, { 事实: 'F_addrB' }] }, 主线节点: [N('nA', ['F_addrA'], { 必需: false }), N('nB', ['F_addrB'], { 必需: false })] },
    { 主线节点: [N('nC', ['F_end'])] },
  ]));
  assert.equal(ok.verdict, 'ok');
  // a node whose completion needs a fact nobody produces → blocked
  const bad = core.clueReachability(vol([{ 主线节点: [N('nW', ['F02'], { 完成条件: { 事实: 'F99' } })] }]));
  assert.equal(bad.verdict, 'blocked');
  assert.match(bad.stuckNodes[0].why, /打开了也完不成/);
});
test('reachability: a lock that depends on time / knowledge is reported as "unknown", not "blocked"', () => {
  const r = core.clueReachability(vol([{ 主线节点: [N('nT', ['F1'], { 开放条件: { 时间: '>= 2026-03-16' } })] }]));
  assert.equal(r.verdict, 'unknown');
  assert.ok(r.external.some((x) => x.startsWith('时间')));
});
test('reachability: the sample story is fully reachable', () => {
  const story = YAML.parse(fs.readFileSync(path.join(here, '../templates/clue-tables/示例_小镇失窃案.yaml'), 'utf8'));
  const vols = Object.entries(story).map(([key, stages], vi) => ({ id: `v${vi}`, key, stages: Object.entries(stages).map(([sk, data], si) => ({ id: `s${vi}_${si}`, key: sk, data })) }));
  const r = core.clueReachability(vols);
  assert.equal(r.verdict, 'ok', JSON.stringify(r.stuckStages.concat(r.stuckNodes)));
});
test('draft check: reachability of the outline as it will be after applying', () => {
  const lock = vol([{ 主线节点: [N('nA', ['FA'], { 开放条件: { 事实: 'FB' } }), N('nB', ['FB'], { 开放条件: { 事实: 'FA' } })] }]);
  assert.match(core.checkClueDraft(lock, [], { applied: lock }).join('\n'), /按大纲自身推演，有走不通的地方/);
  // a fact already obtained in this chat unlocks it
  assert.ok(!/走不通/.test(core.checkClueDraft(lock, [], { applied: lock, obtainedFacts: ['FA'] }).join('\n')));
});

test('parseOutlineReply tolerates zero-width chars before keys and a stage field indented one space short (seen with DeepSeek)', () => {
  const zw = '\u200b';
  const text = ['```yaml', '剧情_卷1_x:', '  阶段1_a:', '    AI指令: |', '      说明', `   ${zw}主线节点:`, '      - id: n1', `        ${zw}名称: 甲`, '        完成条件: {事实: F1}', '   支线事件: []', '  阶段2_b:', '    主线节点:', '      - {id: n2, 名称: 乙}', '```'].join('\n');
  const r = core.parseOutlineReply(text);
  assert.ok(r.ok, r.error);
  assert.equal(r.volumes[0].stages[0].data.主线节点[0].名称, '甲');
  assert.deepEqual(r.volumes[0].stages[0].data.支线事件, []);
  assert.equal(r.volumes[0].stages.length, 2);
  // a genuinely broken indent is still reported
  assert.equal(core.parseOutlineReply(['```yaml', '剧情_卷1_x:', '  阶段1_a:', '    主线节点:', '      - id: n1', '     名称: 坏', '```'].join('\n')).ok, false);
});

test('import check: secret names may appear only in the discovery that reveals them; author-only fields must be gone', () => {
  const vols = vol([{ AI指令: '正文不得出现维恩的名字', 主线节点: [N('n1', ['F1'])] }, { 主线节点: [{ ...N('n2', ['F2']), 发现: [{ 事实: 'F2', 内容: '维恩组织了这笔交易' }] }] }]);
  const issues = core.checkImportDraft(vols, { secrets: ['维恩'] });
  const errs = issues.filter((x) => x.level === 'error' && /「维恩」/.test(x.text));
  assert.equal(errs.length, 1);
  assert.match(errs[0].text, /阶段1 x/);
  // the discovery that reveals it: not an error, but the author is told the body gets it on arrival (GPT 4th round R1)
  assert.match(issues.find((x) => x.level === 'warn' && /「维恩」/.test(x.text)).text, /可能的发现.*阶段2/);
  const split = core.splitImportAuthorFields(vol([{ 主线节点: [{ ...N('n1', ['F1']), 来源: '原句', 补写: true }] }]));
  assert.deepEqual(JSON.parse(JSON.stringify(split.notes)), { n1: { 来源: '原句', 补写: true } });
  assert.ok(!('来源' in split.volumes[0].stages[0].data.主线节点[0]));
  assert.deepEqual(core.checkImportDraft(split.volumes, {}).filter((x) => x.level === 'error'), []);
});
test('splitLongText: chapters kept, long ones cut at paragraphs, small ones merged; overlap only as lead', () => {
  const para = (n) => Array.from({ length: n }, (_, i) => `第${i}句。`.repeat(20)).join('\n\n');
  const text = `第一章 开端\n${para(3)}\n第二章 长的\n${para(60)}\n第三章 短\n短。\n第四章 也短\n短。`;
  const parts = core.splitLongText(text, { target: 2000, overlap: 50 });
  assert.ok(parts.length >= 3);
  assert.ok(parts.every((p) => p.end - p.start <= 2000 * 1.4 + 10));
  assert.equal(parts[0].lead, 0);
  assert.ok(parts[1].lead > 0 && parts[1].text.length === parts[1].end - parts[1].start + parts[1].lead);
  assert.equal(parts.map((p) => text.slice(p.start, p.end)).join(''), text, 'parts cover the whole text exactly once');
});
test('parseOutlineReply: a stage field indented one space too far after a block scalar is fixed too', () => {
  const text = ['```yaml', '剧情_卷1_x:', '  阶段2_b:', '    AI指令: |', '      说明一行', '      说明二行', '     主线节点:', '      - {id: n2, 名称: 乙}', '```'].join('\n');
  const r = core.parseOutlineReply(text);
  assert.ok(r.ok, r.error);
  assert.equal(r.volumes[0].stages[0].data.主线节点[0].名称, '乙');
});
test('parseOutlineReply: full-width colons after keys are accepted; full-width colons inside values are kept', () => {
  const text = ['```yaml', '剧情_卷1_x：', '  阶段1_a：', '    AI指令: 说明：先这样', '    主线节点：', '      - {id: n1, 名称: 甲}', '```'].join('\n');
  const r = core.parseOutlineReply(text);
  assert.ok(r.ok, r.error);
  assert.equal(r.volumes[0].stages[0].data.AI指令, '说明：先这样');
  assert.equal(r.volumes[0].stages[0].data.主线节点[0].名称, '甲');
});
test('import check: parallel lines written as 阶段5a / 阶段5b (sequential stages) are flagged', () => {
  const vols = [{ id: 'v', key: '剧情_卷一', stages: [
    { id: 's1', key: '阶段5a_甲线', data: { 主线节点: [N('na', ['FA'])] } },
    { id: 's2', key: '阶段5b_乙线', data: { 主线节点: [N('nb', ['FB'])] } },
  ] }];
  assert.match(core.checkImportDraft(vols, {}).map((x) => x.text).join('\n'), /看起来是并行的几条线，却写成了先后两个阶段/);
});
test('compileClue flags a completion condition that refers to the node itself', () => {
  const c = core.compileClue(vol([{ 主线节点: [{ ...N('n1', ['F1']), 完成条件: { 节点: 'n1' } }] }]));
  assert.match(c.errors.join('\n'), /完成条件引用了节点自己（n1）/);
});
test('alternative routes: each optional line alone must end the stage and open the next (GPT §19.4 address case)', () => {
  const two = (endAny, nextEnter) => vol([
    { 结束条件: { 任一: endAny.map((f) => ({ 事实: f })) }, 主线节点: [N('nYelena', ['F_addrA'], { 必需: false }), N('nMateo', ['F_note'], { 必需: false })] },
    { 进入条件: { 任一: nextEnter.map((f) => ({ 事实: f })) }, 主线节点: [N('nCold', ['F_cold'])] },
  ]);
  const good = core.clueAlternativeRoutes(two(['F_addrA', 'F_note'], ['F_addrA', 'F_note']));
  assert.deepEqual(good.map((r) => r.ok), [true, true]);
  // the real-model output: the 马特奥 line yields F_note but both gates only accept F_addrA
  const bad = core.clueAlternativeRoutes(two(['F_addrA'], ['F_addrA']));
  assert.equal(bad.find((r) => r.node === 'nYelena').ok, true);
  assert.equal(bad.find((r) => r.node === 'nMateo').ok, false);
  assert.match(core.checkImportDraft(two(['F_addrA'], ['F_addrA'])).map((x) => x.text).join('\n'), /替代途径走不通：阶段1 x·nMateo/);
});

// ---------- GPT §20.3 ----------
test('import index merge: two people sharing a generic title stay separate (and are flagged); explicit same-person merges', () => {
  const m = core.mergeImportIndex([
    { 人物: [{ 名称: '甲', 别名: ['维修工'], 公开身份: '桥街雇员' }] },
    { 人物: [{ 名称: '乙', 别名: ['维修工'], 公开身份: '港区雇员' }] },
  ]);
  assert.deepEqual(m.人物.map((p) => [p.名称, p.公开身份]), [['甲', '桥街雇员'], ['乙', '港区雇员']]);
  assert.match(m.待确认.join('\n'), /「甲」和「乙」都被称作「维修工」/);
  const same = core.mergeImportIndex([
    { 人物: [{ 名称: '老林', 公开身份: '当铺掌柜' }] },
    { 人物: [{ 名称: '林永昌', 同一人: '老林', 真实身份: '走私中间人' }] },
  ]);
  assert.equal(same.人物.length, 1);
  assert.equal(same.人物[0].名称, '老林');
  assert.ok(same.人物[0].别名.includes('林永昌'));
  assert.equal(same.人物[0].真实身份, '走私中间人');
});
test('import draft prompt: placement rules — entry/place/scene only what is visible now; results in 发现; deeper truth author-only', () => {
  const sys = core.importDraftMessages({ part: { i: 0, title: 't', text: 'x' }, index: '' })[0].content;
  assert.match(sys, /入口、地点、场景：只写玩家此时就能看到/);
  assert.match(sys, /更远的真相、幕后人物的真名.*只写在作者备注/);
  assert.ok(!/以外的公开字段/.test(sys), 'old ambiguous wording gone');
});
test('alternative routes: a line can be a chain of several optional nodes (contact → testimony → delivery note)', () => {
  const chain = vol([
    { 结束条件: { 任一: [{ 事实: 'F_addr' }, { 事实: 'F_note' }] }, 主线节点: [
      N('nY1', ['F_addr'], { 必需: false }),
      N('nM1', ['F_terms'], { 必需: false }),
      N('nM2', ['F_note'], { 必需: false, 开放条件: { 事实: 'F_terms' } }),
    ] },
    { 进入条件: { 任一: [{ 事实: 'F_addr' }, { 事实: 'F_note' }] }, 主线节点: [N('nCold', ['F_cold'])] },
  ]);
  const r = core.clueAlternativeRoutes(chain);
  assert.equal(r.length, 2, 'two lines, not three nodes');
  assert.ok(r.every((x) => x.ok), JSON.stringify(r));
  assert.ok(r.some((x) => x.node === 'nM1 → nM2' || x.node === 'nM2 → nM1'));
});
