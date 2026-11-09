import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { setYamlLib } from '../src/core/yaml.js';
import { parseOutlineText } from '../src/core/outline.js';
import { advance, emptyProgress, normalizeProgress } from '../src/core/progress.js';
import { buildEntries } from '../src/core/inject.js';
import { buildCheckMessages, buildPersonaCheckMessages, parseCheckReply } from '../src/core/check.js';
import { newProject, normalizeProject, normalizeSettings } from '../src/core/store.js';
import { flattenUnits } from '../src/core/outline.js';
import { applyFixed, applyMoves, alignPersonaProgress, buildPersonaEntries, checkItems, currentStage, emptyPersonas, fixedValue, newLine, newStage, normalizePersonas, resolveMoves, setFixedValue, setPersonaStage, syncPersonas, undoMoves, unsetFixed } from '../src/core/personas.js';
import { applyPlan, buildPlan, parseCond, parseEntry, releaseImported } from '../src/core/persona-import.js';
import { flattenUnits as flat } from '../src/core/outline.js';

setYamlLib(YAML);

const card = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures/persona-card.json'), 'utf8'));
const entry = uid => {
    const raw = card.entries[uid];
    return { book: '示例世界书', key: String(uid), uid: String(uid), title: raw.comment, content: raw.content, keys: raw.key, constant: raw.constant, position: raw.position, depth: raw.depth, role: raw.role ?? 0, order: raw.order };
};

const OUTLINE = `剧情_卷一_测试:
  阶段一_开端:
    主线节点:
      - 名称: 甲事件
  阶段二_发展:
    主线节点:
      - 名称: 乙事件
  阶段三_结局:
    主线节点:
      - 名称: 丙事件
`;

function projectWith(line, extra = {}) {
    const project = newProject('测试');
    return { ...project, outline: { ...project.outline, volumes: parseOutlineText(OUTLINE) }, personas: { ...emptyPersonas(), lines: [line], ...extra } };
}

function lineOf(mode, stages, extra = {}) {
    return { ...newLine('对顾小川', '柳云岚'), mode, stages: stages.map(([name, text, more = {}]) => ({ ...newStage(name), text, ...more })), ...extra };
}

// ---------- 数据结构与旧项目 ----------

test('旧项目没有 personas 字段时补空结构，人设相关设置有默认值', () => {
    const project = normalizeProject({ id: 'p', name: 'x' }, 'p');
    assert.deepEqual(project.personas, { lines: [], fixed: [], imported: [] });
    assert.deepEqual(newProject('x').personas, { lines: [], fixed: [], imported: [] });
    assert.equal(normalizeSettings({}).personaMode, 'ask');
    assert.equal(normalizeSettings({ personaMode: 'bad' }).personaMode, 'ask');
    assert.equal(normalizeSettings({ personaMode: 'auto' }).personaMode, 'auto');
});

test('旧进度不带 personas 字段时不凭空多出来', () => {
    const progress = normalizeProgress({ projectId: 'p', current: 'a' }, 'p');
    assert.equal('personas' in progress, false);
    const withP = normalizeProgress({ projectId: 'p', personas: { l1: 's1', fixed: { f: '他' } } }, 'p');
    assert.deepEqual(withP.personas, { l1: 's1', fixed: { f: '他' }, muted: [], manual: [], auto: {}, names: {} });
});

test('没有人设线时 buildEntries 与旧输出一致（不多条目）', () => {
    const project = normalizeProject(JSON.parse(JSON.stringify(newProject('x'))), 'p');
    const progress = emptyProgress(project.id);
    assert.deepEqual(buildEntries(project, progress, normalizeSettings({})), []);
});

test('normalizePersonas 补默认值、补一个阶段、丢掉空名固定选项', () => {
    const out = normalizePersonas({ lines: [{ name: ' 甲 ', mode: 'bad', stages: [] }], fixed: [{ name: '', options: ['他'] }, { name: '性别', options: ['他', '他', '她'] }] });
    assert.equal(out.lines[0].name, '甲');
    assert.equal(out.lines[0].mode, 'check');
    assert.equal(out.lines[0].stages.length, 1);
    assert.equal(out.lines[0].constant, true);
    assert.deepEqual(out.fixed.map(item => [item.name, item.options]), [['性别', ['他', '她']]]);
});

// ---------- 注入 ----------

test('人设线注入：公共文字在阶段内容之前，当前阶段手动切换，固定选项按值替换', () => {
    const line = lineOf('manual', [['敌对', '她针对{{性别}}。'], ['动摇', '她动摇了。']], { common: '柳云岚是邻家歌手。' });
    const fixed = { id: 'pf1', name: '性别', options: ['他', '她'], varPath: '' };
    const project = projectWith(line, { fixed: [fixed] });
    let progress = emptyProgress(project.id);
    let entries = buildEntries(project, progress, normalizeSettings({}));
    const persona = entries.filter(item => item.kind === 'persona');
    assert.equal(persona.length, 1);
    assert.equal(persona[0].content, '柳云岚是邻家歌手。\n她针对他。', '未选固定选项时先用第一个');
    progress = setFixedValue(progress, 'pf1', '她');
    assert.equal(buildEntries(project, progress, normalizeSettings({})).find(item => item.kind === 'persona').content, '柳云岚是邻家歌手。\n她针对她。');
    progress = setPersonaStage(progress, project.personas.lines[0], project.personas.lines[0].stages[1].id);
    assert.equal(buildEntries(project, progress, normalizeSettings({})).find(item => item.kind === 'persona').content, '柳云岚是邻家歌手。\n她动摇了。');
    assert.equal(emptyProgress('p').personas, undefined, '原进度不被改');
});

test('注入参数沿用线上的位置、深度、顺序；关闭的线不注入；空内容不注入', () => {
    const line = lineOf('manual', [['甲', '内容']], { position: 4, depth: 2, role: 1, order: 77 });
    const project = projectWith(line);
    const [one] = buildPersonaEntries(project, emptyProgress(project.id));
    assert.deepEqual([one.position, one.depth, one.role, one.order, one.enabled], [4, 2, 1, 77, true]);
    assert.deepEqual(buildPersonaEntries(projectWith({ ...line, enabled: false }), emptyProgress('p')), []);
    assert.deepEqual(buildPersonaEntries(projectWith(lineOf('manual', [['甲', '']])), emptyProgress('p')), []);
});

test('关键词触发：常驻直接注入；有关键词的线在最近楼层命中才注入', () => {
    const line = lineOf('manual', [['甲', '内容']], { constant: false, keys: ['柳云岚', '/邻家/'] });
    const project = projectWith(line);
    const progress = emptyProgress(project.id);
    assert.equal(buildPersonaEntries(project, progress, { recentText: '今天天气不错' }).length, 0);
    assert.equal(buildPersonaEntries(project, progress, { recentText: '柳云岚来了' }).length, 1);
    assert.equal(buildPersonaEntries(project, progress, { recentText: '一个邻家歌手' }).length, 1, '正则关键词');
    assert.equal(buildPersonaEntries(project, progress).length, 1, '不给扫描文字时全部列出');
    const constant = projectWith({ ...line, constant: true });
    assert.equal(buildPersonaEntries(constant, progress, { recentText: '无关' }).length, 1);
    const noKeys = projectWith({ ...line, keys: [] });
    assert.equal(buildPersonaEntries(noKeys, progress, { recentText: '柳云岚' }).length, 0, '既不常驻又没关键词不注入');
});

test('固定选项：未选提醒、选后取值、选项被改掉后当作未选', () => {
    const fixed = { id: 'f', name: '性别', options: ['他', '她'], varPath: '' };
    const personas = { ...emptyPersonas(), fixed: [fixed] };
    assert.equal(unsetFixed(personas, emptyProgress('p')).length, 1);
    const progress = setFixedValue(emptyProgress('p'), 'f', '她');
    assert.equal(fixedValue(fixed, progress), '她');
    assert.equal(unsetFixed(personas, progress).length, 0);
    assert.equal(fixedValue({ ...fixed, options: ['男', '女'] }, progress), '');
});

test('固定选项整段块只在选中值时保留', () => {
    const personas = { ...emptyPersonas(), fixed: [{ id: 'f', name: '性别', options: ['他', '她'], varPath: '' }] };
    const content = '性别：\n{{性别=他}}男{{/性别}}{{性别=她}}女{{/性别}}\n称呼{{性别}}';
    assert.equal(applyFixed(content, personas, setFixedValue(emptyProgress('p'), 'f', '她')), '性别：\n女\n称呼她');
    assert.equal(applyFixed(content, personas, emptyProgress('p')), '性别：\n男\n称呼他');
});

// ---------- 四种切换方式 ----------

test('跟随大纲：取已到达的大纲阶段里绑定最靠后的；没绑定的跳过；还没到任何绑定阶段用第一阶段', () => {
    const units = flat(parseOutlineText(OUTLINE));
    const line = lineOf('outline', [['初见', 'a', { unitId: units[0].id }], ['空', 'b'], ['熟络', 'c', { unitId: units[1].id }], ['决裂', 'd', { unitId: units[2].id }]]);
    const project = projectWith(line);
    const lines = project.personas.lines;
    const units2 = flattenUnits(project.outline.volumes);
    const bound = { ...lines[0], stages: lines[0].stages.map((stage, i) => ({ ...stage, unitId: [units2[0].id, '', units2[1].id, units2[2].id][i] })) };
    const p2 = { ...project, personas: { ...project.personas, lines: [bound] } };
    const at = progress => currentStage(bound, progress, { ...personaEnvOf(p2, progress) }).stage.name;
    let progress = emptyProgress(p2.id);
    assert.equal(at(progress), '初见');
    progress = advance(progress, units2).progress;
    assert.equal(at(progress), '熟络');
    progress = advance(progress, units2).progress;
    assert.equal(at(progress), '决裂');
    const unbound = { ...bound, stages: bound.stages.map((stage, i) => (i === 0 ? { ...stage, unitId: units2[1].id } : { ...stage, unitId: '' })) };
    assert.equal(currentStage(unbound, emptyProgress('p'), personaEnvOf({ ...p2, personas: { ...p2.personas, lines: [unbound] } }, emptyProgress('p'))).stage.name, '初见', '还没到绑定阶段用第一阶段');
});

function personaEnvOf(project, progress) {
    return { units: flattenUnits(project.outline.volumes), links: undefined, states: Object.fromEntries(flattenUnits(project.outline.volumes).map((unit, i, all) => {
        const cur = all.findIndex(item => item.id === (progress.current || all[0].id));
        return [unit.id, i < cur ? 'done' : i === cur ? 'active' : 'todo'];
    })) };
}

test('读声望：按区间取阶段，读不到值退回手动值并标 lost，手动改后到下次自动变化才恢复', () => {
    const line = lineOf('fame', [['低', 'a', { range: { max: 20 } }], ['中', 'b', { range: { min: 21, max: 65 } }], ['高', 'c', { range: { min: 66 } }]], { fame: { bar: '节目组态度', partner: '' } });
    const project = projectWith(line);
    const l = project.personas.lines[0];
    const fame = value => [{ name: '节目组态度', owner: '顾小川', cls: '口碑', value, tier: '' }];
    assert.equal(currentStage(l, emptyProgress('p'), { fame: fame(10) }).stage.name, '低');
    assert.equal(currentStage(l, emptyProgress('p'), { fame: fame(40) }).stage.name, '中');
    assert.equal(currentStage(l, emptyProgress('p'), { fame: fame(90) }).stage.name, '高');
    const lost = currentStage(l, emptyProgress('p'), { fame: [] });
    assert.equal(lost.lost, true);
    assert.equal(lost.stage.name, '低', '没有手动值时用第一阶段');
    let progress = setPersonaStage(emptyProgress('p'), l, l.stages[1].id);
    assert.equal(currentStage(l, progress, { fame: [] }).stage.name, '中', '读不到时沿用手动值');
    assert.equal(currentStage(l, progress, { fame: fame(90) }).stage.name, '中', '手动改后保持手动');
    assert.equal(currentStage(l, progress, { fame: fame(90) }).source, 'manual');
    progress = syncPersonas(project, progress, fame(90));
    progress = syncPersonas(project, progress, fame(10));
    assert.equal(currentStage(l, progress, { fame: fame(10) }).stage.name, '低', '自动判断变了，恢复自动');
    const pair = { ...l, fame: { bar: '组合热度', partner: '林北' } };
    assert.equal(currentStage(pair, emptyProgress('p'), { fame: [{ name: '组合热度', value: 5, pairs: [{ partner: '林北', value: 70 }] }] }).stage.name, '高');
});

test('syncPersonas 没有变化时原样返回同一对象；没有人设线时原样返回', () => {
    const progress = emptyProgress('p');
    assert.equal(syncPersonas(newProject('x'), progress, []), progress);
    const line = lineOf('fame', [['低', 'a', { range: { max: 20 } }], ['高', 'b', { range: { min: 21 } }]], { fame: { bar: '条', partner: '' } });
    const project = projectWith(line);
    const once = syncPersonas(project, progress, [{ name: '条', value: 5 }]);
    assert.notEqual(once, progress);
    assert.equal(syncPersonas(project, once, [{ name: '条', value: 5 }]), once);
});

test('手动选阶段：条件检测和跟随大纲标「手动」，手动方式不标', () => {
    const check = lineOf('check', [['敌对', 'a'], ['动摇', 'b']]);
    const manual = lineOf('manual', [['敌对', 'a'], ['动摇', 'b']]);
    const p1 = setPersonaStage(emptyProgress('p'), check, check.stages[1].id);
    assert.deepEqual(p1.personas.manual, [check.id]);
    assert.equal(currentStage(check, p1).source, 'manual');
    const p2 = setPersonaStage(emptyProgress('p'), manual, manual.stages[1].id);
    assert.deepEqual(p2.personas.manual, []);
    assert.equal(currentStage(manual, p2).stage.name, '动摇');
});

test('阶段改名、删除、线被删后进度对回：id 在则刷新名，id 没了按阶段名找回，都没有则清掉', () => {
    const line = lineOf('manual', [['敌对', 'a'], ['动摇', 'b']]);
    let progress = setPersonaStage(emptyProgress('p'), line, line.stages[1].id);
    const renamed = { ...emptyPersonas(), lines: [{ ...line, stages: line.stages.map(stage => (stage.name === '动摇' ? { ...stage, name: '松动' } : stage)) }] };
    const a = alignPersonaProgress(progress, renamed);
    assert.equal(a.personas.names[line.id], '松动');
    assert.equal(currentStage(renamed.lines[0], a).stage.name, '松动');
    const reId = { ...emptyPersonas(), lines: [{ ...line, stages: [{ ...line.stages[0] }, { ...line.stages[1], id: 'new' }] }] };
    const b = alignPersonaProgress(progress, reId);
    assert.equal(b.personas[line.id], 'new', '按阶段名对回新 id');
    const gone = { ...emptyPersonas(), lines: [{ ...line, stages: [line.stages[0]] }] };
    const c = alignPersonaProgress(progress, gone);
    assert.equal(c.personas[line.id], undefined);
    assert.equal(currentStage(gone.lines[0], c).stage.name, '敌对');
    const dead = alignPersonaProgress(progress, emptyPersonas());
    assert.equal(dead.personas[line.id], undefined);
    assert.equal(alignPersonaProgress(emptyProgress('p'), renamed).personas, undefined);
});

// ---------- 条件检测 ----------

test('检测只带条件检测型、已触发、未设不提醒、有下一阶段的线；每条只带名称与条件，不带人设正文', () => {
    const a = lineOf('check', [['敌对', '正文甲甲甲'], ['动摇', '正文乙乙乙', { cond: '顾小川帮了她' }]], { name: '对顾小川', group: '柳云岚' });
    const b = lineOf('check', [['x', ''], ['y', '']], { name: '关键词线', constant: false, keys: ['雷震子'] });
    const c = lineOf('outline', [['x', ''], ['y', '']], { name: '大纲线' });
    const d = lineOf('check', [['末', '']], { name: '已到末阶段' });
    const e = lineOf('check', [['x', ''], ['y', '']], { name: '不提醒' });
    const project = { ...newProject('x'), personas: { ...emptyPersonas(), lines: [a, b, c, d, e] } };
    let progress = setPersonaStage(emptyProgress(project.id), e, e.stages[0].id);
    progress = { ...progress, personas: { ...progress.personas, muted: [e.id] } };
    const items = checkItems(project, progress, '今天柳云岚来了');
    assert.deepEqual(items.map(item => [item.name, item.from, item.to, item.cond]), [['对顾小川', '敌对', '动摇', '顾小川帮了她']]);
    assert.equal(checkItems(project, progress, '雷震子来了且柳云岚来了').length, 2, '关键词命中后带上');
    const messages = buildCheckMessages(null, 'index', [{ index: 1, text: '正文' }], null, items);
    assert.match(messages[0].content, /"personas":\[/);
    assert.match(messages[1].content, /柳云岚·对顾小川：当前「敌对」；下一阶段「动摇」，进入条件：顾小川帮了她/);
    assert.doesNotMatch(messages[1].content, /正文甲甲甲|正文乙乙乙/);
});

test('没有条件检测型人设线被触发时，检测提示与回复解析和以前逐字一致', () => {
    const units = flattenUnits(parseOutlineText(OUTLINE));
    const before = buildCheckMessages(units[0], 'idx', [{ index: 1, text: 't' }]);
    assert.deepEqual(buildCheckMessages(units[0], 'idx', [{ index: 1, text: 't' }], null, []), before);
    assert.deepEqual(buildCheckMessages(units[0], 'idx', [{ index: 1, text: 't' }], null, null), before);
    assert.doesNotMatch(before[0].content + before[1].content, /personas|人设/);
    assert.equal('personas' in parseCheckReply('{"done":[]}'), false);
    assert.deepEqual(parseCheckReply('{"done":[],"personas":[{"line":"甲","to":"乙","floor":"5","reason":"r"},{"line":""}]}').personas, [{ line: '甲', to: '乙', floor: 5, reason: 'r' }]);
});

test('没有大纲时单独检测人设阶段的提示只带人设', () => {
    const items = [{ group: '柳云岚', name: '对顾小川', from: '敌对', to: '动摇', cond: '被帮助' }];
    const [system, user] = buildPersonaCheckMessages(items, [{ index: 3, text: '正文' }]);
    assert.match(system.content, /personas/);
    assert.doesNotMatch(system.content + user.content, /剧情索引|stageDone/);
    assert.match(user.content, /第 3 楼/);
});

test('检测结果只认下一阶段：线名对不上、to 不是下一阶段、重复的都忽略；采用推一格并清手动，撤销还原', () => {
    const line = lineOf('check', [['敌对', ''], ['动摇', ''], ['瓦解', '']], { name: '对顾小川', group: '柳云岚' });
    const project = { ...newProject('x'), personas: { ...emptyPersonas(), lines: [line] } };
    let progress = setPersonaStage(emptyProgress(project.id), line, line.stages[0].id);
    const items = checkItems(project, progress, '');
    assert.equal(items[0].wasManual, true);
    const moves = resolveMoves(items, [
        { line: '柳云岚·对顾小川', to: '瓦解', floor: 4, reason: '跳段' },
        { line: '不存在', to: '动摇' },
        { line: '对顾小川', to: '动摇', floor: 7, reason: '被帮助' },
        { line: '对顾小川', to: '动摇' },
    ]);
    assert.equal(moves.length, 1);
    assert.equal(moves[0].floor, 7);
    const adopted = applyMoves(progress, project, moves);
    assert.equal(currentStage(line, adopted).stage.name, '动摇');
    assert.deepEqual(adopted.personas.manual, []);
    const undone = undoMoves(adopted, project, moves);
    assert.equal(currentStage(line, undone).stage.name, '敌对');
    assert.deepEqual(undone.personas.manual, [line.id]);
    assert.equal(progress.personas.manual.length, 1, '原进度不被改');
});

// ---------- 世界书转入（示例 fixture） ----------

test('条件解析：== 、<= / >= 数值、cond 的 & 与逗号', () => {
    assert.deepEqual(parseCond('表/行/列 == 他').terms, [{ path: '表/行/列', op: '==', value: '他' }]);
    assert.deepEqual(parseCond('cell:表/行/列 >= 21 & cell:表/行/列 <= 40').terms.map(item => [item.op, item.value]), [['>=', '21'], ['<=', '40']]);
    const or = parseCond('cell:表/行/星期 == 星期一, cell:表/行/星期 == 星期二');
    assert.equal(or.or, true);
    assert.equal(or.terms.length, 2);
    assert.ok(parseCond('乱写一气').error);
    assert.ok(parseCond('表/行/列 != 他').error);
});

test('解析：嵌套、未闭合、多余 </if> 都被标出', () => {
    assert.equal(parseEntry('<if cell="a/b/c == 1">x</if>').issues.length, 0);
    assert.match(parseEntry('<if cell="a/b/c == 1">x').issues[0].text, /没有写 <\/if>/);
    assert.match(parseEntry('x</if>').issues[0].text, /多出一个/);
    assert.match(parseEntry('<if cell="a/b/c == 1"><if cell="a/b/d == 2">x</if></if>').nodes[0].children[0].depth.toString(), /1/);
    assert.match(parseEntry('<if foo="1">x</if>').issues.map(item => item.text).join(), /无法识别/);
});

test('拆分：柳云岚对顾小川 → 一条线按出现顺序成四个阶段，进入条件取「状态：」一行，主角性别成固定选项', () => {
    const plan = buildPlan([entry(28)]);
    assert.deepEqual(plan.issues, []);
    assert.equal(plan.lines.length, 1);
    const line = plan.lines[0];
    assert.equal(line.name, '对顾小川');
    assert.equal(line.group, '柳云岚');
    assert.equal(line.mode, 'check');
    assert.deepEqual(line.stages.map(stage => stage.name), ['轻视', '敌对', '动摇', '瓦解']);
    assert.match(line.stages[1].cond, /^沈听澜对顾小川的态度威胁到了柳云岚的目标/);
    assert.equal(line.constant, true);
    assert.deepEqual([line.position, line.depth, line.order], [0, 4, 135]);
    assert.deepEqual(line.keys, ['柳云岚', '邻家歌手', '银渐层', '选拔赛']);
    assert.deepEqual(line.source, { book: '示例世界书', uid: '28', varPath: '重要角色表/柳云岚/对顾小川' });
    assert.equal(plan.fixed.length, 1);
    assert.deepEqual([plan.fixed[0].name, plan.fixed[0].options], ['主角的客观性别', ['他', '她']]);
    assert.match(line.stages[0].text, /顾小川\{\{主角的客观性别=他\}\}弟弟\{\{\/主角的客观性别\}\}\{\{主角的客观性别=她\}\}妹妹\{\{\/主角的客观性别\}\}/);
    assert.doesNotMatch(line.stages.map(stage => stage.text).join(), /<if|<\/if>/);
    assert.ok(line.stages.every(stage => stage.text.startsWith('<追加_2>\n') && stage.text.endsWith('</追加_2>')), '外层的 <追加_2> 标签跟着每个阶段走');
    const personas = { ...emptyPersonas(), fixed: plan.fixed, lines: [{ ...newLine(), ...line }] };
    const text = applyFixed(line.stages[0].text, personas, setFixedValue(emptyProgress('p'), plan.fixed[0].id, '她'));
    assert.match(text, /顾小川妹妹/);
    assert.doesNotMatch(text, /弟弟|\{\{/);
});

test('拆分：整条线外面的文字、固定选项的整段块（顾小川履历）', () => {
    const plan = buildPlan([entry(13)]);
    assert.deepEqual(plan.issues, []);
    assert.equal(plan.lines.length, 1, '没有阶段的条目成一条手动线');
    const line = plan.lines[0];
    assert.equal(line.mode, 'manual');
    assert.equal(line.name, '顾小川');
    assert.equal(line.stages.length, 1);
    const personas = { ...emptyPersonas(), fixed: plan.fixed, lines: [] };
    const male = applyFixed(line.stages[0].text, personas, setFixedValue(emptyProgress('p'), plan.fixed[0].id, '他'));
    const female = applyFixed(line.stages[0].text, personas, setFixedValue(emptyProgress('p'), plan.fixed[0].id, '她'));
    assert.match(male, /性别：男/);
    assert.doesNotMatch(male, /性别：女|假小子/);
    assert.match(male, /这副嗓子比同龄人低一截/);
    assert.match(female, /性别：女/);
    assert.doesNotMatch(female, /性别：男|嗓音偏低沉/);
    assert.match(female, /这些年大家都说我像个假小子/);
    assert.match(male, /家里人大概还是嫌我太吵吧/, '块后面的文字保留');
    assert.match(male, /^<顾小川>\n\[履历\]/, '块外的文字原样保留');
});

test('拆分：<= / >= 数值条件 → 读声望，补空档阶段，区间取自条件（cond 写法与 cell 写法混用）', () => {
    const plan = buildPlan([entry(31)]);
    assert.deepEqual(plan.issues, []);
    const line = plan.lines[0];
    assert.equal(line.mode, 'fame');
    assert.equal(line.name, '节目组态度');
    assert.equal(line.fame.bar, '节目组态度');
    assert.deepEqual(line.stages.map(stage => stage.range), [{ max: 20 }, { min: 21, max: 40 }, { min: 41, max: 65 }, { min: 66 }]);
    assert.match(line.stages[0].text, /麻烦制造机/);
    assert.match(line.stages[3].text, /不可替代的灵魂人物/);
    assert.equal(plan.fixed.length, 0);
});

test('拆分：数值区间中间缺的补空阶段', () => {
    const content = '<if cell="a表/甲/值 <= 10">低</if>\n<if cell="a表/甲/值 >= 31">高</if>';
    const plan = buildPlan([{ book: 'b', key: '1', uid: '1', title: 't', content, keys: [], constant: true, position: 0, depth: 4, role: 0, order: 1 }]);
    assert.deepEqual(plan.lines[0].stages.map(stage => [stage.range, stage.text]), [[{ max: 10 }, '低'], [{ min: 11, max: 30 }, ''], [{ min: 31 }, '高']]);
});

test('拆分：多个变量拆成多条线共用条目的关键词与参数；条目外文字进公共文字', () => {
    const plan = buildPlan([entry(143)]);
    assert.deepEqual(plan.issues, []);
    assert.equal(plan.lines.length, 1);
    const line = plan.lines[0];
    assert.equal(line.name, '信赖程度');
    assert.deepEqual(line.stages.map(stage => stage.name), ['拘谨', '试探', '熟悉', '默契']);
    assert.match(line.stages[2].text, /\{\{主角的客观性别=他\}\}/);
    assert.match(line.stages[0].text, /^<追加_5>\n\[沈听澜的相处设定·拘谨\]/);
    const two = '<if cell="X表/甲/一 == a">A</if><if cell="X表/甲/二 == b">B</if>';
    const split = buildPlan([{ book: 'b', key: '1', uid: '1', title: 't', content: `前言\n${two}\n后记`, keys: ['k'], constant: false, position: 1, depth: 4, role: 0, order: 9 }]);
    assert.equal(split.lines.length, 2);
    assert.ok(split.lines.every(line => line.keys[0] === 'k' && line.constant === false && line.position === 1));
    assert.match(split.lines[0].common, /前言/);
});

test('拆分：同一变量出现在多个条目里合并成同一条线，按条目顺序拼接', () => {
    const a = { book: 'b', key: '1', uid: '1', title: 't1', content: '<if cell="X表/甲/态度 == 好">好A</if>', keys: [], constant: true, position: 0, depth: 4, role: 0, order: 1 };
    const b = { book: 'b', key: '2', uid: '2', title: 't2', content: '<if cell="X表/甲/态度 == 好">好B</if><if cell="X表/甲/态度 == 坏">坏B</if>', keys: [], constant: true, position: 0, depth: 4, role: 0, order: 2 };
    const plan = buildPlan([a, b]);
    assert.equal(plan.lines.length, 1);
    assert.deepEqual(plan.lines[0].stages.map(stage => [stage.name, stage.text]), [['好', '好A\n好B'], ['坏', '坏B']]);
    assert.equal(plan.lines[0].sources.length, 2);
});

test('预览问题：未闭合、嵌套无法拆分、无法解析的条件、值写法不一致都标出，错误条目不转入', () => {
    const base = { book: 'b', uid: '1', title: '坏条目', keys: [], constant: true, position: 0, depth: 4, role: 0, order: 1 };
    const open = buildPlan([{ ...base, key: '1', content: '<if cell="X表/甲/态度 == 好">好' }]);
    assert.ok(open.issues.some(issue => /没有写/.test(issue.text) && issue.level === 'error'));
    assert.equal(open.lines.length, 0);
    assert.ok(open.blocked.has('b\u00001'));
    const nested = buildPlan([{ ...base, key: '2', content: '<if cell="X表/甲/态度 == 好">好<if cell="X表/甲/热度 >= 5">乐</if></if>' }]);
    assert.ok(nested.issues.some(issue => /嵌套/.test(issue.text)));
    const bad = buildPlan([{ ...base, key: '3', content: '<if cell="乱写">x</if>' }]);
    assert.ok(bad.issues.some(issue => /无法解析/.test(issue.text)));
    const loose = buildPlan([{ ...base, key: '4', content: '<if cell="X表/甲/态度 == 好">a</if><if cell="X表/甲/态度 == 好 ">b</if><if cell="X表/甲/态度 == 好。">c</if>' }]);
    assert.ok(loose.issues.some(issue => issue.level === 'warn' && /写法不一致/.test(issue.text)));
    const ok = buildPlan([{ ...base, key: '5', content: '<if cell="X表/甲/态度 == 好">a</if>' }, { ...base, key: '6', content: '<if cell="X表/甲/态度 == 好">a' }]);
    assert.equal(ok.lines.length, 1, '好条目不受坏条目影响');
});

test('用户改判：把默认的阶段变量改成固定选项，或把固定选项改成阶段', () => {
    const content = '<if cell="X表/甲/态度 == 好">好</if><if cell="X表/甲/态度 == 坏">坏</if>';
    const item = { book: 'b', key: '1', uid: '1', title: 't', content, keys: [], constant: true, position: 0, depth: 4, role: 0, order: 1 };
    const asLine = buildPlan([item]);
    assert.equal(asLine.vars[0].kind, 'enum');
    const asFixed = buildPlan([item], { overrides: { 'X表/甲/态度': 'fixed' } });
    assert.equal(asFixed.fixed.length, 1);
    assert.equal(asFixed.lines.filter(line => line.mode === 'check').length, 0);
    const sex = buildPlan([entry(143)], { overrides: { '主角信息表/主角信息/主角的客观性别': 'line' } });
    assert.equal(sex.fixed.length, 0);
});

test('整卡五条 fixture 一起转入：人设线数量与固定选项合并为一个', () => {
    const plan = buildPlan([7, 13, 28, 31, 143].map(entry));
    assert.deepEqual(plan.issues, []);
    const names = plan.lines.map(line => `${line.group}/${line.name}`);
    assert.deepEqual(names.sort(), ['/顾小川', '顾小川/节目组态度', '沈听澜/信赖程度', '沈听澜/柳云岚对沈听澜', '柳云岚/对顾小川'].sort());
    assert.equal(plan.fixed.length, 1);
    assert.equal(plan.lines.length, 5);
});

test('转入写入：新对象、记 imported、固定选项同名合并；恢复可选删除对应线，多来源的线只去掉这一来源', () => {
    const entries = [entry(28), entry(143)];
    const plan = buildPlan(entries);
    const before = emptyPersonas();
    const after = applyPlan(before, plan, entries);
    assert.deepEqual(before, emptyPersonas(), '原对象不被改');
    assert.equal(after.lines.length, 2);
    assert.deepEqual(after.imported.map(item => item.key), ['28', '143']);
    assert.equal(after.fixed.length, 1);
    const again = buildPlan([entry(28)], { existing: after });
    assert.equal(again.fixed[0].id, after.fixed[0].id, '固定选项同名沿用');
    const kept = releaseImported(after, after.imported[0]);
    assert.deepEqual(kept.imported.map(item => item.key), ['143']);
    assert.equal(kept.lines.length, 2);
    const dropped = releaseImported(after, after.imported[0], { removeLines: true });
    assert.deepEqual(dropped.lines.map(line => line.name), ['信赖程度']);
    const a = { book: 'b', key: '1', uid: '1', title: 't1', content: '<if cell="X表/甲/态度 == 好">A</if>', keys: [], constant: true, position: 0, depth: 4, role: 0, order: 1 };
    const b = { ...a, key: '2', uid: '2', title: 't2', content: '<if cell="X表/甲/态度 == 好">B</if>' };
    const merged = applyPlan(emptyPersonas(), buildPlan([a, b]), [a, b]);
    const released = releaseImported(merged, merged.imported[0], { removeLines: true });
    assert.equal(released.lines.length, 1, '另一来源还在，线保留');
    assert.equal(released.lines[0].sources.length, 1);
});

test('转入的人设线经 normalize 往返不丢字段', () => {
    const entries = [entry(28)];
    const after = applyPlan(emptyPersonas(), buildPlan(entries), entries);
    const round = normalizePersonas(JSON.parse(JSON.stringify(after)));
    assert.deepEqual(round, after);
});
