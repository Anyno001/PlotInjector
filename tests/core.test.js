import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { setYamlLib, parseYaml } from '../src/core/yaml.js';
import { flattenUnits, moveItem, moveStageToVolume, outlineIssues, outlineToText, parseOutlineText, pushOutlineHistory, replaceStages, stageNodes, volumeLabel, volumesFromHistory } from '../src/core/outline.js';
import { advance, emptyProgress, setNodeChecked, uncheckByNames, unitStates, patchSlot } from '../src/core/progress.js';
import { buildEntries, buildIndexText, carriedNodes, toWorldInfoEntry } from '../src/core/inject.js';
import { buildCheckMessages, cleanFloorText, parseCheckReply } from '../src/core/check.js';
import { acuField, groupByField } from '../src/core/acu.js';
import { buildPattern, fixKeys, healthCheck, orderPlan, punctPlan, regexPlan, sortEntries, triggerTest } from '../src/core/wbtools.js';
import { checkedSet, entryRefId, migrateOc, normalizeWbRule, ruleFromSelection } from '../src/core/refs.js';
import { normalizeChat } from '../src/core/store.js';
import { changedBlockKeys, mergeBlocks, parseSettingReply, splitBlocks } from '../src/core/setting.js';
import { parseOutlineReply } from '../src/core/prompts.js';
import { normalizeProject, normalizeSettings, newProject, resolveLlm } from '../src/core/store.js';
import { buildZip, crc32 } from '../src/core/zip.js';

setYamlLib(YAML);

const SAMPLE_DIR = path.resolve(import.meta.dirname, '../../特殊文件/剧情整理');
const sampleFiles = fs.existsSync(SAMPLE_DIR) ? fs.readdirSync(SAMPLE_DIR).filter(name => name.endsWith('.yaml')).sort() : [];

let seq = 0;
const idOf = prefix => `${prefix}${++seq}`;

const MINI = `剧情_卷一_测试:
  阶段一_开端:
    时间范围: 开始时
    AI指令: 推进开端。
    主线节点:
      - 名称: 甲事件
        地点: 甲地
        事件: 甲发生。
        偏转: 若不发生则改。
      - 名称: 乙事件
        地点: 乙地
        事件: 乙发生。
        偏转: 无。
  阶段二_发展:
    时间范围: 开端之后
    AI指令: 推进发展。
    主线节点:
      - 名称: 丙事件
        地点: 丙地
        事件: 丙发生。
        偏转: 无。
剧情_卷二_续:
  阶段一_转折:
    时间范围: 发展之后
    主线节点:
      - 名称: 丁事件
        地点: 丁地
        事件: 丁发生。
        偏转: 无。
`;

function projectWith(text) {
    const project = newProject('测试');
    project.outline.volumes = parseOutlineText(text, idOf);
    return project;
}

test('8 卷样例逐个导入后导出，数据与原文件一致', { skip: !sampleFiles.length && '没有样例目录' }, () => {
    const volumes = [];
    for (const name of sampleFiles) {
        const text = fs.readFileSync(path.join(SAMPLE_DIR, name), 'utf8');
        const parsed = parseOutlineText(text, idOf);
        assert.deepEqual(parseYaml(outlineToText(parsed)), YAML.parse(text), name);
        volumes.push(...parsed);
    }
    assert.equal(volumes.length, 8);
    const merged = parseOutlineText(outlineToText(volumes), idOf);
    assert.deepEqual(merged.map(vol => vol.key), volumes.map(vol => vol.key));
    assert.ok(flattenUnits(volumes).length > 20);
});

test('卷名显示为「卷一·标题」，无前缀时原样显示', () => {
    assert.equal(volumeLabel('剧情_卷一_杀神坠命'), '卷一·杀神坠命');
    assert.equal(volumeLabel('番外'), '番外');
});

test('只有阶段没有卷时自动包成一卷', () => {
    const volumes = parseOutlineText('阶段一_x:\n  时间范围: t\n  主线节点: []\n', idOf);
    assert.equal(volumes.length, 1);
    assert.equal(volumes[0].stages[0].key, '阶段一_x');
});

test('YAML 格式错误报出行号', () => {
    assert.throws(() => parseOutlineText('a:\n  b: [\n  c: d\n', idOf), error => error.line > 0 && /第 \d+ 行/.test(error.message));
});

test('正文只注入设定与当前阶段详细；详细标明是尚未发生的规划；剧情索引给检测用、写得详细', () => {
    const project = projectWith(MINI);
    const progress = emptyProgress(project.id);
    const entries = buildEntries(project, progress, normalizeSettings({}));
    assert.deepEqual(entries.map(entry => entry.kind), ['detail']);
    assert.match(entries[0].content, /^<剧情参考 卷="卷一" 阶段="阶段一_开端">\n以下是当前正在进行、尚未演完的剧情规划/);
    assert.equal(entries[0].position, 0);
    const units = flattenUnits(project.outline.volumes);
    const index = buildIndexText(units, unitStates(units, progress), progress);
    assert.match(index, /【当前】\n- 卷一·测试·阶段一 开端｜时间范围：开始时/);
    assert.match(index, /\[未演\] 主线｜甲事件：甲发生。/);
    assert.match(index, /【下一段】\n- 卷一·测试·阶段二 发展｜时间范围：开端之后/);
    assert.match(index, /【之后】\n- 卷二·续·/);
    const off = setNodeChecked(progress, units[0].id, 'm0', false);
    assert.match(buildIndexText(units, unitStates(units, off), off), /\[已演\] 主线｜甲事件/);
});

test('打开下一段跨卷连续，已过阶段列节点名', () => {
    const project = projectWith(MINI);
    const units = flattenUnits(project.outline.volumes);
    let progress = emptyProgress(project.id);
    progress = advance(progress, units).progress;
    const step = advance(progress, units);
    assert.equal(step.to.volume.key, '剧情_卷二_续');
    progress = step.progress;
    assert.equal(advance(progress, units), null);
    const states = unitStates(units, progress);
    assert.deepEqual(Object.values(states), ['done', 'done', 'active']);
    const index = buildIndexText(units, states, progress);
    assert.match(index, /【已过】\n- 卷一·测试·阶段一 开端（甲事件／乙事件）/);
    assert.doesNotMatch(index, /【下一段】/);
});

test('取消勾选的节点不进详细；按检测结果的节点名取消勾选', () => {
    const project = projectWith(MINI);
    const units = flattenUnits(project.outline.volumes);
    let progress = setNodeChecked(emptyProgress(project.id), units[0].id, 'm0', false);
    let detail = buildEntries(project, progress, normalizeSettings({})).find(entry => entry.kind === 'detail');
    assert.doesNotMatch(detail.content, /甲事件/);
    assert.match(detail.content, /乙事件/);
    progress = uncheckByNames(emptyProgress(project.id), units[0].id, stageNodes(units[0].stage.data), ['乙事件', '不存在']);
    detail = buildEntries(project, progress, normalizeSettings({})).find(entry => entry.kind === 'detail');
    assert.doesNotMatch(detail.content, /乙事件/);
});

test('已演完阶段的状态变化接在设定后面；设为不注入的分块不进正文', () => {
    const project = projectWith(MINI);
    const units = flattenUnits(project.outline.volumes);
    units[0].stage.data.状态变化 = ['她察觉到 A 不只是兄弟'];
    project.setting = { ...project.setting, text: '铁则:\n- 甲\n\n钩子库:\n- 乙', mute: ['钩子库'] };
    let setting = buildEntries(project, emptyProgress(project.id), normalizeSettings({})).find(entry => entry.kind === 'setting');
    assert.equal(setting.content, '铁则:\n- 甲', '当前段还没演完，变化不注入');
    const progress = advance(emptyProgress(project.id), units).progress;
    setting = buildEntries(project, progress, normalizeSettings({})).find(entry => entry.kind === 'setting');
    assert.match(setting.content, /以这里为准）：\n- 她察觉到 A 不只是兄弟（卷一·测试·阶段一 开端）$/);
    assert.equal(changedBlockKeys('铁则:\n- 甲\n\n钩子库:\n- 乙', '铁则:\n- 丙\n\n新块:\n- 丁').join(), '铁则');
});

test('注入位置只认项目默认：两条默认都在角色定义前，改一次所有阶段都生效；旧项目未改过的默认自动换新', () => {
    const project = projectWith(MINI);
    const units = flattenUnits(project.outline.volumes);
    const stale = patchSlot(emptyProgress(project.id), units[0].id, { position: 4, depth: 2, enabled: false });
    const detail = buildEntries(project, stale, normalizeSettings({})).find(entry => entry.kind === 'detail');
    assert.deepEqual([detail.position, detail.enabled], [0, false], '单段旧的位置覆盖不再生效，启用开关仍按段记');
    project.defaults = { ...project.defaults, detail: { ...project.defaults.detail, position: 4, depth: 2, role: 1 } };
    const next = advance(emptyProgress(project.id), units).progress;
    const wi = toWorldInfoEntry(buildEntries(project, next, normalizeSettings({})).find(entry => entry.kind === 'detail'), 0, 'PlotInjector');
    assert.deepEqual([wi.position, wi.depth, wi.role, wi.constant, wi.ignoreBudget], [4, 2, 1, true, true], '下一段沿用项目默认');
    const migrated = normalizeProject({ ...project, defaults: { setting: { position: 1, depth: 4, role: 0, order: 80, enabled: true }, detail: { position: 4, depth: 4, role: 0, order: 100, enabled: false } } }, project.id);
    assert.deepEqual([migrated.defaults.setting.position, migrated.defaults.detail.position, migrated.defaults.detail.enabled], [0, 0, false]);
    const kept = normalizeProject({ ...project, defaults: { detail: { position: 2, depth: 4, role: 0, order: 100 } } }, project.id);
    assert.equal(kept.defaults.detail.position, 2, '改过的保留');
});

test('检测提示带剧情索引，回复里的偏离判断能读出来', () => {
    const project = projectWith(MINI);
    const units = flattenUnits(project.outline.volumes);
    const progress = emptyProgress(project.id);
    const messages = buildCheckMessages(units[0], buildIndexText(units, unitStates(units, progress), progress), [{ index: 3, text: '正文' }]);
    assert.match(messages[0].content, /offTrack/);
    assert.match(messages[1].content, /【剧情索引】\n【当前】/);
    assert.match(messages[1].content, /【第 3 楼】\n正文/);
    const result = parseCheckReply('{"done":[],"stageDone":false,"offTrack":true,"offReason":"甲已死","reason":"x"}');
    assert.deepEqual([result.offTrack, result.offReason], [true, '甲已死']);
    assert.equal(parseCheckReply('{"done":[],"stageDone":false,"reason":"x"}').offTrack, false);
});

test('设定常驻且排在详细前', () => {
    const project = projectWith(MINI);
    project.setting.text = '世界观声明:\n基于: 测试';
    const entries = buildEntries(project, emptyProgress(project.id), normalizeSettings({}));
    assert.equal(entries[0].kind, 'setting');
    assert.ok(entries[0].order < entries[1].order);
});

test('检测前的正文清理', () => {
    assert.equal(cleanFloorText('<think>想</think>正文<status>HP</status>\n<剧情推进/>'), '正文');
});

test('检测回复容忍前后多余文字', () => {
    const result = parseCheckReply('好的：\n{"done":["甲事件"],"stageDone":true,"reason":"都演完了"}\n');
    assert.deepEqual(result, { done: ['甲事件'], stageDone: true, offTrack: false, offReason: '', reason: '都演完了', clocks: [], hooks: [], newThread: null });
    assert.throws(() => parseCheckReply('没有'));
});

test('速成三段回复拆成正文、补定、速查', () => {
    const reply = '1. 世界观正文：\n世界观声明:\n基于: 甲\n\n铁则:\n- 一\n\n2. 补定：\n- 时代按现代补\n- 尺度按全年龄补\n\n3. 速查：PASS。';
    const parsed = parseSettingReply(reply);
    assert.match(parsed.body, /^世界观声明:/);
    assert.deepEqual(parsed.fixes, ['时代按现代补', '尺度按全年龄补']);
    assert.equal(parsed.check, 'PASS');
});

test('设定按分块采用：只换选中块，新块追加', () => {
    const oldText = '世界观声明:\n基于: 旧\n\n铁则:\n- 旧铁则';
    const newText = '世界观声明:\n基于: 新\n\n铁则:\n- 新铁则\n\n场景库:\n- 新场景';
    assert.deepEqual(splitBlocks(oldText).map(block => block.key), ['世界观声明', '铁则']);
    const merged = mergeBlocks(oldText, newText, ['铁则', '场景库']);
    assert.match(merged, /基于: 旧/);
    assert.match(merged, /新铁则/);
    assert.match(merged, /场景库:\n- 新场景$/);
});

test('AI 大纲回复取 yaml 代码块；坏格式给出行号', () => {
    const ok = parseOutlineReply(`说明\n\`\`\`yaml\n${MINI}\`\`\``, idOf);
    assert.ok(ok.ok);
    assert.equal(ok.volumes.length, 2);
    const bad = parseOutlineReply('```yaml\na:\n  - b\n  c: [\n```', idOf);
    assert.equal(bad.ok, false);
    assert.match(bad.error, /第 \d+ 行/);
});

test('zip 备份结构与 CRC 正确', () => {
    assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
    const zip = buildZip([{ name: 'pi-index.json', data: '{}' }, { name: '中文.json', data: '{"a":1}' }]);
    const view = new DataView(zip.buffer);
    assert.equal(view.getUint32(0, true), 0x04034b50);
    assert.equal(view.getUint32(zip.length - 22, true), 0x06054b50);
    assert.equal(view.getUint16(zip.length - 22 + 10, true), 2);
});

test('接口设置：v0.1.5 引用预设的用途展开回独立接口；预设只做存档', () => {
    const preset = { id: 'a1', name: 'DS', endpoint: 'https://a.example/v1', apiKey: 'k', model: 'm1', temperature: '' };
    const s = normalizeSettings({ presets: [preset], llm: { discuss: { source: 'preset', presetId: 'a1' }, outline: { source: 'preset', presetId: 'gone' } } });
    assert.deepEqual(s.llm.discuss, { source: 'custom', endpoint: 'https://a.example/v1', apiKey: 'k', model: 'm1', temperature: '' });
    assert.equal(s.llm.outline.source, 'tavern');
    assert.equal(s.llm.check.source, 'tavern');
    assert.equal(s.presets.length, 1);
    assert.deepEqual(normalizeSettings(s), s);
    const old = normalizeSettings({ llm: { check: { source: 'custom', endpoint: 'https://b/v1', apiKey: '', model: 'x', temperature: '0.3' } } });
    assert.deepEqual(resolveLlm(old, 'check'), { source: 'custom', endpoint: 'https://b/v1', apiKey: '', model: 'x', temperature: '0.3' });
    assert.deepEqual(resolveLlm(old, 'discuss'), { source: 'tavern' });
    assert.deepEqual(old.presets, []);
});

test('数据库条目按字段分组：去掉前缀与末尾编号得字段名', () => {
    assert.equal(acuField('TavernDB-ACU-CustomExport-人物档案-12'), '人物档案');
    assert.equal(acuField('TavernDB-ACU-CustomExport-物品栏-包裹'), '物品栏');
    assert.equal(acuField('TavernDB-ACU-CustomExport-剧情纪要-上'), '剧情纪要');
    assert.equal(acuField('TavernDB-ACU-CustomExport-纪要索引'), '纪要索引');
    assert.equal(acuField('TavernDB-ACU-ImportantPersonsIndex'), '英文字段');
    assert.equal(acuField('手写剧情'), '');
    const fields = groupByField([{ title: 'TavernDB-ACU-OutlineTable' }, { title: 'TavernDB-ACU-CustomExport-纪要-1' }, { title: '手写' }]);
    assert.deepEqual(fields.map(([name, list]) => [name, list.length]), [['纪要', 1], ['英文字段', 1]]);
});

test('讨论参考默认：手写条目全选（世界书里关闭的除外）、纪要索引 + 最新 N 条纪要，其他数据库字段不选；新条目按规则自动套用', () => {
    const e = (key, title, disabled = false) => ({ key, title, disabled, content: 'x' });
    const entries = [e('0', '手写剧情'), e('1', '已关闭的手写', true), e('2', 'TavernDB-ACU-CustomExport-纪要索引'), e('3', 'TavernDB-ACU-CustomExport-人物档案-1')];
    for (let n = 1; n <= 20; n += 1) entries.push(e(`m${n}`, `TavernDB-ACU-CustomExport-纪要-${n}`));
    const books = [{ name: '书', entries }];
    const ids = set => [...set].map(id => id.replace('书|', '')).sort();
    let chosen = checkedSet(normalizeWbRule({}), books, 10);
    const memoIds = [...chosen].filter(id => id.includes('纪要-')).map(id => Number(id.split('-').pop())).sort((x, y) => x - y);
    assert.deepEqual(memoIds, [11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    assert.ok(chosen.has('书|k:0') && !chosen.has('书|k:1'));
    assert.ok(chosen.has('书|t:TavernDB-ACU-CustomExport-纪要索引'));
    assert.ok(!chosen.has('书|t:TavernDB-ACU-CustomExport-人物档案-1'));
    const picked = new Set(chosen);
    picked.delete('书|k:0');
    picked.add('书|t:TavernDB-ACU-CustomExport-人物档案-1');
    const rule = ruleFromSelection(books, { 人物档案: true }, picked, 10);
    assert.deepEqual(rule, { fields: { 人物档案: true }, picks: { '书|k:0': false } });
    entries.push(e('4', 'TavernDB-ACU-CustomExport-人物档案-2'), e('5', '新手写条目'), e('m21', 'TavernDB-ACU-CustomExport-纪要-21'));
    chosen = checkedSet(rule, books, 10);
    assert.ok(chosen.has('书|t:TavernDB-ACU-CustomExport-人物档案-2'), '字段勾选后新条目跟随');
    assert.ok(chosen.has('书|k:5'), '新手写条目默认附带');
    assert.ok(chosen.has('书|t:TavernDB-ACU-CustomExport-纪要-21') && !chosen.has('书|t:TavernDB-ACU-CustomExport-纪要-11'), '纪要始终取最新 N 条');
    assert.equal(entryRefId('书', entries[0]), '书|k:0');
    assert.deepEqual(ids(checkedSet(normalizeWbRule({}), [{ name: '书', entries: [] }], 10)), []);
    assert.deepEqual(migrateOc([{ book: '书', key: '9', title: 'TavernDB-ACU-OutlineTable' }, { book: '书', key: '0', title: '手写' }]), { fields: {}, picks: { '书|t:TavernDB-ACU-OutlineTable': true } });
    const chat = normalizeChat({ refs: { oc: [], setting: false } });
    assert.deepEqual([chat.refs.setting, chat.refs.progress, chat.refs.floors, chat.refs.memo], [false, true, 10, 10]);
});


test('推进速度：慢速/正常/快速换详细条目开头的说明，快速附下一阶段，自定义文字优先', () => {
    const project = projectWith(MINI);
    const detail = (progress, settings = {}) => buildEntries(project, progress, normalizeSettings(settings)).find(entry => entry.kind === 'detail').content;
    const base = emptyProgress(project.id);
    assert.equal(base.pace, 'normal');
    assert.match(detail(base), /按正文进展自然推进/);
    assert.match(detail({ ...base, pace: 'slow' }), /节奏放慢/);
    const fast = detail({ ...base, pace: 'fast' });
    assert.match(fast, /节奏加快/);
    assert.match(fast, /下一阶段：卷一·测试·阶段二 发展（开端之后）/);
    assert.doesNotMatch(detail(base), /下一阶段：/);
    assert.match(detail({ ...base, pace: 'slow' }, { paceText: { slow: '自定义慢速' } }), /^<剧情参考[^>]*>\n自定义慢速\n/);
});

test('没演的支线与世界动态延续到后面的阶段；取消勾选或关闭开关后不再延续', () => {
    const text = '剧情_卷一_测试:\n  阶段一_开端:\n    时间范围: 开始时\n    主线节点:\n      - 名称: 甲事件\n    支线事件:\n      - 名称: 丙支线\n        事件: 丙发生。\n    世界动态:\n      - 类型: 丁传闻\n        内容: 丁流传。\n  阶段二_发展:\n    时间范围: 开端之后\n    主线节点:\n      - 名称: 乙事件\n';
    const project = projectWith(text);
    const units = flattenUnits(project.outline.volumes);
    const progress = advance(emptyProgress(project.id), units).progress;
    const detail = settings => buildEntries(project, progress, normalizeSettings(settings)).find(entry => entry.kind === 'detail').content;
    assert.match(detail({}), /延续自前面阶段[\s\S]*支线｜丙支线（来自阶段一）：丙发生。[\s\S]*世界动态｜丁传闻/);
    assert.match(buildIndexText(units, unitStates(units, progress), progress), /\[未演·延续\] 支线｜丙支线/);
    assert.doesNotMatch(detail({ carryOver: false }), /延续自前面阶段/);
    const played = setNodeChecked(progress, units[0].id, 's0', false);
    const after = buildEntries(project, played, normalizeSettings({})).find(entry => entry.kind === 'detail').content;
    assert.doesNotMatch(after, /丙支线/);
    assert.match(after, /丁传闻/);
    const states = unitStates(units, played);
    assert.deepEqual(carriedNodes(units, states, played).map(item => item.node.name), ['丁传闻']);
    assert.deepEqual(carriedNodes(units, states, played, { withOff: true }).map(item => [item.node.name, item.off]), [['丙支线', true], ['丁传闻', false]]);
    const back = setNodeChecked(played, units[0].id, 's0', true);
    assert.match(buildEntries(project, back, normalizeSettings({})).find(entry => entry.kind === 'detail').content, /丙支线/);
});

test('世界书工具：关键词按中文逗号顿号拆开去重，正则关键词不拆；正则替换计数；顺序重排', () => {
    assert.deepEqual(fixKeys(['甲，乙、丙', ' 乙。', '/a,b/i', '丁；戊']), ['甲', '乙', '丙', '/a,b/i', '丁', '戊']);
    const entries = [
        { key: '0', title: 'A', comment: 'A', content: '旧名来了，旧名走了', keys: ['旧名，甲'], keysSecondary: [], order: 30 },
        { key: '1', title: 'B', comment: 'B', content: '无关', keys: ['乙'], keysSecondary: [], order: 10 },
    ];
    const punct = punctPlan(entries);
    assert.equal(punct.length, 1);
    assert.deepEqual(punct[0].patch, { key: ['旧名', '甲'] });
    const plan = regexPlan(entries, buildPattern('旧(名)', { regex: true }), '新$1', { content: true, keys: true });
    assert.equal(plan.length, 1);
    assert.equal(plan[0].hits, 3);
    assert.equal(plan[0].patch.content, '新名来了，新名走了');
    assert.deepEqual(plan[0].patch.key, ['新名，甲']);
    assert.equal(regexPlan(entries, buildPattern('.', { regex: false }), '', { content: true }).length, 0, '非正则模式按原文查找');
    assert.throws(() => buildPattern('(', { regex: true }), /正则写法有误/);
    assert.deepEqual(orderPlan(entries, { start: 100, step: 10 }).map(item => item.to), [100, 110]);
    assert.deepEqual(orderPlan(entries, { start: 1, step: 1, by: 'order' }).map(item => `${item.key}:${item.to}`), ['1:1', '0:2']);
    assert.throws(() => orderPlan(entries, { start: 1, step: 0 }), /间隔/);
});

test('讨论说话人格：填了才进系统提示，任务说明保留', async () => {
    const { discussSystemPrompt } = await import('../src/core/prompts.js');
    const plain = discussSystemPrompt({ guide: '', refs: [] });
    assert.ok(!plain.includes('【说话人格】'));
    const withPersona = discussSystemPrompt({ guide: '', refs: [], persona: '  你是毒舌编辑。 ' });
    assert.ok(withPersona.includes('【说话人格】\n你是毒舌编辑。'));
    assert.ok(withPersona.startsWith('你在帮用户构思'));
});

const wbEntry = (key, over = {}) => ({ key, title: `条目${key}`, disabled: false, constant: false, keys: [], keysSecondary: [], selectiveLogic: 0, order: 100, content: '', ...over });

test('世界书触发测试：禁用不算、常驻必中、关键词不分大小写、支持正则', () => {
    const entries = [
        wbEntry('1', { constant: true }),
        wbEntry('2', { keys: ['Alice'] }),
        wbEntry('3', { keys: ['/dr.+n/i'] }),
        wbEntry('4', { keys: ['alice'], disabled: true }),
        wbEntry('5', { keys: ['龙'] }),
    ];
    const r = triggerTest(entries, 'alice meets DRAGON', () => 10);
    assert.deepEqual(r.constant.map(x => x.key), ['1']);
    assert.deepEqual(r.keyword.map(x => x.key), ['2', '3']);
    assert.equal(r.tokens.total, 30);
    assert.equal(r.tokens.constant, 10);
});

test('世界书触发测试：区分大小写与全词匹配照酒馆 matchKeys；条目为 null 时跟随全局设置', () => {
    const hit = (key, extra, text, globals) => triggerTest([wbEntry('1', { keys: [key], ...extra })], text, undefined, globals).keyword.length;
    assert.equal(hit('cat', {}, 'The CAT sat'), 1);
    assert.equal(hit('cat', { caseSensitive: null }, 'The CAT sat'), 1);
    assert.equal(hit('cat', { caseSensitive: true }, 'The CAT sat'), 0);
    assert.equal(hit('cat', { caseSensitive: true }, 'the cat sat'), 1);
    assert.equal(hit('cat', {}, 'concatenate'), 1);
    assert.equal(hit('cat', { matchWholeWords: true }, 'concatenate'), 0);
    assert.equal(hit('cat', { matchWholeWords: true }, 'a cat, sat'), 1);
    assert.equal(hit('cat', { matchWholeWords: true }, 'cat'), 1);
    // 酒馆的 \W 只认 ASCII 字母数字下划线，中文字算边界：单个中文词在中文正文里全词匹配照样命中。
    assert.equal(hit('龙', { matchWholeWords: true }, '巨龙来了'), 1);
    assert.equal(hit('龙', { matchWholeWords: true }, 'a龙b'), 0, '两侧是 ASCII 字母时不算全词');
    assert.equal(hit('龙', { matchWholeWords: true }, 'a 龙'), 1);
    // 不再区分拉丁字符：带重音的字母在 \W 看来也是边界。
    assert.equal(hit('cafe', { matchWholeWords: true }, 'écafeé'), 1);
    // 多个词按包含匹配。
    assert.equal(hit('big cat', { matchWholeWords: true }, 'abig catz'), 1);
    // 条目为 null 时跟随全局。
    assert.equal(hit('cat', {}, 'The CAT sat', { caseSensitive: true }), 0);
    assert.equal(hit('cat', { caseSensitive: false }, 'The CAT sat', { caseSensitive: true }), 1, '条目设置优先于全局');
    assert.equal(hit('cat', {}, 'concatenate', { matchWholeWords: true }), 0);
    assert.equal(hit('cat', { matchWholeWords: false }, 'concatenate', { matchWholeWords: true }), 1);
    // 正则：flags 限 gimsuy，写法不合法时当普通文字。
    assert.equal(hit('/c.t/', {}, 'cut'), 1);
    assert.equal(hit('/c.t/x', {}, '/c.t/x here'), 1, 'flags 不合法时按普通文字包含');
    assert.equal(hit('/C.T/', {}, 'cut', { caseSensitive: false }), 0, '正则不受大小写设置影响');
});

test('世界书触发测试：次要关键词四种逻辑', () => {
    const run = logic => triggerTest([wbEntry('1', { keys: ['a'], keysSecondary: ['x', 'y'], selectiveLogic: logic })], 'a x').keyword.length;
    assert.equal(run(0), 1);
    assert.equal(run(1), 1);
    assert.equal(run(2), 0);
    assert.equal(run(3), 0);
    assert.equal(triggerTest([wbEntry('1', { keys: ['a'], keysSecondary: ['x', 'y'], selectiveLogic: 3 })], 'a x y').keyword.length, 1);
    assert.equal(triggerTest([wbEntry('1', { keys: ['a'], keysSecondary: ['x'], selectiveLogic: 2 })], 'a').keyword.length, 1);
});

test('世界书体检：过短关键词、无关键词、共用关键词、重复标题、常驻占比', () => {
    const entries = [
        wbEntry('1', { keys: ['a', '他'], title: '甲' }),
        wbEntry('2', { keys: ['龙', '他'], title: '甲' }),
        wbEntry('3', { keys: [], title: '丙' }),
        wbEntry('4', { constant: true, title: '丁' }),
        wbEntry('5', { keys: ['x'], disabled: true, title: '戊' }),
    ];
    const r = healthCheck(entries, entry => (entry.constant ? 70 : 10));
    assert.deepEqual(r.shortKeys.map(x => x.key), ['1', '2']);
    assert.deepEqual(r.shortKeys[0].words, ['a', '他']);
    assert.deepEqual(r.noKeys.map(x => x.key), ['3']);
    assert.deepEqual(r.shared.map(x => x.word), ['他']);
    assert.deepEqual(r.dupTitles.map(x => x.title), ['甲']);
    assert.equal(r.constant.tokens, 70);
    assert.equal(r.constant.total, 100);
    assert.equal(r.constant.warn, true);
});

test('世界书条目排序：顺序值、token 从大到小、标题，默认保持原顺序', () => {
    const list = [wbEntry('1', { order: 5, title: 'b' }), wbEntry('2', { order: 1, title: 'a' }), wbEntry('3', { order: 5, title: 'c' })];
    const tok = { 1: 3, 2: 9, 3: 3 };
    assert.deepEqual(sortEntries(list, '').map(x => x.key), ['1', '2', '3']);
    assert.deepEqual(sortEntries(list, 'order').map(x => x.key), ['2', '1', '3']);
    assert.deepEqual(sortEntries(list, 'tokens', e => tok[e.key]).map(x => x.key), ['2', '1', '3']);
    assert.deepEqual(sortEntries(list, 'title').map(x => x.key), ['2', '1', '3']);
});

const mkStage = (id, key, data = {}) => ({ id, key, data: { 时间范围: '一天', 主线节点: [{ 名称: `${id}节点` }], ...data } });

test('大纲检查：缺时间、缺主线、同卷重名、空卷', () => {
    const volumes = [
        { id: 'v1', key: '剧情_卷一_甲', stages: [mkStage('a', '阶段一_甲'), mkStage('b', '阶段一_甲', { 时间范围: '' }), mkStage('c', '阶段二_乙', { 主线节点: [] })] },
        { id: 'v2', key: '剧情_卷二_乙', stages: [] },
    ];
    const kinds = outlineIssues(volumes).map(item => `${item.kind}:${item.stageId || item.volumeId}`);
    assert.deepEqual(kinds.sort(), ['dup-name:a', 'dup-name:b', 'empty-volume:v2', 'no-main:c', 'no-time:b'].sort());
    assert.deepEqual(outlineIssues([{ id: 'v', key: 'k', stages: [mkStage('a', '阶段一_甲')] }]), []);
});

test('大纲历史：入栈带标签、最多 10 版、空大纲不入栈、恢复沿用 id', () => {
    const volumes = [{ id: 'v1', key: '剧情_卷一_甲', stages: [mkStage('a', '阶段一_甲')] }];
    assert.deepEqual(pushOutlineHistory([], [], '删除卷'), []);
    let history = [];
    for (let i = 0; i < 12; i += 1) history = pushOutlineHistory(history, [{ ...volumes[0], key: `剧情_卷${i}_甲` }], '操作', i);
    assert.equal(history.length, 10);
    assert.equal(history[0].label, '操作');
    const restored = volumesFromHistory(history[0].text, [{ id: 'v9', key: '剧情_卷11_甲', stages: [mkStage('s9', '阶段一_甲')] }]);
    assert.equal(restored[0].id, 'v9');
    assert.equal(restored[0].stages[0].id, 's9');
});

test('移动与单阶段替换：id 不变，替换放在原位置', () => {
    assert.deepEqual(moveItem([1, 2, 3], 0, 1), [2, 1, 3]);
    assert.deepEqual(moveItem([1, 2, 3], 2, 1), [1, 2, 3]);
    const volumes = [
        { id: 'v1', key: 'k1', stages: [mkStage('a', '阶段一_甲'), mkStage('b', '阶段二_乙')] },
        { id: 'v2', key: 'k2', stages: [mkStage('c', '阶段一_丙')] },
    ];
    const moved = moveStageToVolume(volumes, 'a', 'v2');
    assert.deepEqual(moved.map(volume => volume.stages.map(stage => stage.id)), [['b'], ['c', 'a']]);
    const replaced = replaceStages(volumes, 'v1', ['a', 'b'], [mkStage('x', '阶段一_合并')]);
    assert.deepEqual(replaced.volumes[0].stages.map(stage => stage.id), ['a'], '合并时沿用前一段 id');
    assert.equal(replaced.keepId, 'a');
    assert.throws(() => replaceStages(volumes, 'v1', ['zz'], []));
});

test('normalizeProject 补 outline.history 默认值', () => {
    assert.deepEqual(normalizeProject({}, 'p').outline.history, []);
    assert.deepEqual(newProject('x').outline.history, []);
});

// threads v0.1.23：进度钟、支线钩子、支线链、玩家自开的线。
import { legacyOutputs } from './fixtures/legacy-scenarios.js';
import { addPlayerThread, applyCheck, checkThreads, clockPhase, ignoreThread, liveThreads, maskUnits, patchClock, patchHook, threadState, threadSwitches } from '../src/core/threads.js';
import crypto from 'node:crypto';

test('旧大纲（没有新键）的注入、剧情索引、状态变化、检测提示与 v0.1.22 逐字一致', () => {
    const snap = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures/legacy-snapshot.json'), 'utf8'));
    const now = legacyOutputs();
    for (const [key, want] of Object.entries(snap)) {
        if (!(key in now)) continue;
        const got = key.startsWith('mini/') ? now[key] : crypto.createHash('sha256').update(JSON.stringify(now[key])).digest('hex');
        assert.deepEqual(got, want, key);
    }
});

const THREADS = `剧情_卷一_测试:
  阶段一_开端:
    时间范围: 开始时
    主线节点:
      - 名称: 甲事件
    支线事件:
      - 名称: 旧支线
        事件: 旧的照常注入。
      - 名称: 酒馆密谈
        事件: 有人约主角密谈。
        条件: 主角到过酒馆
        时限: 10
        错过: 密谈的人离开了城镇。
      - 名称: 二号钩子
        条件: 下雨
      - 名称: 三号钩子
        条件: 夜里
      - 名称: 寻剑
        步骤:
          - 打听剑的下落
          - 进山取剑
    世界动态:
      - 类型: 叛军逼近
        进度钟: 4
        前兆: 城外村庄传来烽火。
        后果: 城门被叛军攻破。
        内容: 叛军攻城。
  阶段二_发展:
    时间范围: 之后
    主线节点:
      - 名称: 乙事件
剧情_卷二_续:
  阶段一_转折:
    时间范围: 更后
    主线节点:
      - 名称: 丙事件
`;

function threadSetup(settings = {}) {
    const project = projectWith(THREADS);
    const units = flattenUnits(project.outline.volumes);
    const s = normalizeSettings(settings);
    const live = progress => liveThreads(units, unitStates(units, progress), progress, { carryOver: s.carryOver, hookCap: s.hookCap });
    const detail = progress => buildEntries(project, progress, s).find(entry => entry.kind === 'detail').content;
    const setting = progress => (buildEntries(project, progress, s).find(entry => entry.kind === 'setting') || {}).content || '';
    return { project, units, s, live, detail, setting };
}

test('进度钟：不足一半不写正文只进索引，过半写前兆，剩一格迫在眉睫，满格本段必须发生；每次最多 +2，可倒退，夹在 0..总格', () => {
    const { units, live, detail } = threadSetup();
    let progress = emptyProgress('p');
    let floor = 5;
    assert.doesNotMatch(detail(progress), /叛军/, '0/4 不进正文，也不原样留在阶段 YAML');
    assert.match(buildIndexText(units, unitStates(units, progress), progress), /【世界进度钟】\n  - 叛军逼近 0\/4：叛军攻城。/);
    const step = (tick, happened = false) => { progress = applyCheck(progress, live(progress), parseCheckReply(JSON.stringify({ done: [], clocks: [{ name: '叛军逼近', tick, happened }] })), { floor: floor++ }).progress; };
    step(5);
    assert.equal(live(progress).clocks[0].filled, 2, '单次最多推进 2 格');
    assert.match(detail(progress), /叛军逼近：已有风声[^\n]*城外村庄传来烽火/);
    step(1);
    assert.equal(clockPhase(live(progress).clocks[0]), 'near');
    assert.match(detail(progress), /迫在眉睫/);
    step(-9);
    assert.equal(live(progress).clocks[0].filled, 0, '倒退夹在 0');
    step(2); step(2);
    assert.match(detail(progress), /叛军逼近：本段必须发生。叛军攻城。/);
    step(0, true);
    const clock = live(progress).clocks[0];
    assert.deepEqual([clock.done, clock.filled], [true, 4]);
    assert.doesNotMatch(detail(progress), /叛军/);
});

test('进度钟随世界走：已过阶段没发生的钟继续有效，不受 carryOver 关闭影响；发生后的后果接进状态变化并标明来源', () => {
    const { units, live, detail, setting } = threadSetup({ carryOver: false });
    let progress = patchClock(emptyProgress('p'), `${units[0].id}:w0`, { filled: 3 });
    progress = advance(progress, units).progress;
    assert.match(detail(progress), /叛军逼近：迫在眉睫/);
    assert.equal(live(progress).clocks[0].carried, true);
    progress = patchClock(progress, `${units[0].id}:w0`, { done: true });
    assert.match(setting(progress), /- 城门被叛军攻破。（世界动态「叛军逼近」）/);
});

test('支线钩子：有条件的进池子，激活后才注入，同时最多 hookCap 条、先激活的优先；没条件的照旧注入', () => {
    const { units, live, detail } = threadSetup();
    let progress = emptyProgress('p');
    assert.match(detail(progress), /旧的照常注入/);
    assert.doesNotMatch(detail(progress), /酒馆密谈|二号钩子|三号钩子/);
    const index = buildIndexText(units, unitStates(units, progress), progress);
    assert.match(index, /\[待触发\] 支线｜酒馆密谈：条件：主角到过酒馆/);
    progress = applyCheck(progress, live(progress), parseCheckReply('{"done":[],"hooks":["三号钩子"]}'), { floor: 3 }).progress;
    progress = applyCheck(progress, live(progress), parseCheckReply('{"done":[],"hooks":["酒馆密谈","二号钩子"]}'), { floor: 6 }).progress;
    const statuses = Object.fromEntries(live(progress).hooks.map(hook => [hook.node.name, hook.status]));
    assert.equal(statuses['三号钩子'], 'active');
    assert.equal([statuses['酒馆密谈'], statuses['二号钩子']].filter(item => item === 'queue').length, 1, '超出上限的排队');
    assert.match(detail(progress), /三号钩子/);
    const big = liveThreads(units, unitStates(units, progress), progress, { hookCap: 3 });
    assert.ok(big.hooks.filter(hook => hook.pooled).every(hook => hook.status === 'active'));
    progress = applyCheck(progress, live(progress), parseCheckReply('{"done":["三号钩子"]}'), { floor: 7 }).progress;
    assert.equal(live(progress).hooks.find(hook => hook.node.name === '三号钩子').status, 'done');
    assert.ok(live(progress).hooks.filter(hook => hook.pooled && hook.status === 'active').length === 2, '腾出名额后排队的补上');
});

test('支线钩子过期：激活后超过时限楼数未开始即过期，错过的后果进状态变化；手动恢复；「本卷」在卷结束时过期', () => {
    const { units, live, detail, setting } = threadSetup();
    let progress = applyCheck(emptyProgress('p'), live(emptyProgress('p')), parseCheckReply('{"done":[],"hooks":["酒馆密谈"]}'), { floor: 2 }).progress;
    let out = applyCheck(progress, live(progress), parseCheckReply('{"done":[]}'), { floor: 12 });
    assert.equal(out.events.some(event => event.type === 'hook-expired'), false, '刚好 10 楼不算超过');
    out = applyCheck(progress, live(progress), parseCheckReply('{"done":[]}'), { floor: 13 });
    assert.ok(out.events.some(event => event.type === 'hook-expired' && event.name === '酒馆密谈'));
    progress = out.progress;
    assert.equal(live(progress).hooks.find(hook => hook.node.name === '酒馆密谈').status, 'expired');
    assert.doesNotMatch(detail(progress), /酒馆密谈/);
    assert.match(setting(progress), /- 密谈的人离开了城镇。（错过支线「酒馆密谈」）/);
    const key = `${units[0].id}:s1`;
    progress = patchHook(progress, key, { expired: undefined, at: 13, shownAt: undefined, keepVol: 0 });
    assert.equal(live(progress).hooks.find(hook => hook.node.name === '酒馆密谈').status, 'active');
    units[0].stage.data.支线事件[2].时限 = '本卷';
    let vol = applyCheck(emptyProgress('p'), live(emptyProgress('p')), parseCheckReply('{"done":[],"hooks":["二号钩子"]}'), { floor: 1 }).progress;
    vol = advance(vol, units).progress;
    assert.equal(applyCheck(vol, live(vol), parseCheckReply('{"done":[]}'), { floor: 50 }).events.some(event => event.type === 'hook-expired'), false, '同卷不过期');
    vol = advance(vol, units).progress;
    assert.ok(applyCheck(vol, live(vol), parseCheckReply('{"done":[]}'), { floor: 60 }).events.some(event => event.type === 'hook-expired' && event.name === '二号钩子'));
});

test('支线链：只注入当前一步并标明第 k/n 步，命中后推进，走完才算演完；跨阶段延续', () => {
    const { units, live, detail } = threadSetup();
    let progress = emptyProgress('p');
    assert.match(detail(progress), /支线｜寻剑：第 1\/2 步：打听剑的下落/);
    assert.doesNotMatch(detail(progress), /进山取剑/);
    progress = applyCheck(progress, live(progress), parseCheckReply('{"done":["寻剑"]}'), { floor: 3 }).progress;
    progress = advance(progress, units).progress;
    assert.match(detail(progress), /支线｜寻剑（来自阶段一）：第 2\/2 步：进山取剑/);
    assert.match(buildIndexText(units, unitStates(units, progress), progress), /\[第 2\/2 步\] 支线｜寻剑（来自阶段一）：进山取剑/);
    progress = applyCheck(progress, live(progress), parseCheckReply('{"done":["寻剑"]}'), { floor: 9 }).progress;
    assert.equal(live(progress).hooks.find(hook => hook.node.name === '寻剑').status, 'done');
    assert.doesNotMatch(detail(progress), /寻剑/);
});

test('检测提示：有钟和钩子时才加说明；回复解析容错（缺字段为 0、映射写法、推进超过 2 截断、newThread 字符串或空）', () => {
    const { units, live } = threadSetup();
    const progress = emptyProgress('p');
    const index = buildIndexText(units, unitStates(units, progress), progress);
    const plain = buildCheckMessages(units[0], index, []);
    assert.doesNotMatch(plain[0].content, /clocks|newThread/);
    const rich = buildCheckMessages(units[0], index, [], checkThreads(live(progress), { newThreadMode: 'ask' }));
    assert.match(rich[0].content, /"clocks":\[/);
    assert.match(rich[0].content, /叛军逼近 0\/4/);
    assert.match(rich[0].content, /"newThread":/);
    assert.doesNotMatch(buildCheckMessages(units[0], index, [], checkThreads(live(progress), { newThreadMode: 'off' }))[0].content, /newThread/);
    const empty = parseCheckReply('{"done":[]}');
    assert.deepEqual([empty.clocks, empty.hooks, empty.newThread], [[], [], null]);
    assert.deepEqual(parseCheckReply('{"clocks":{"甲":5,"乙":{"tick":"-1"},"丙":{}}}').clocks, [{ name: '甲', tick: 2, happened: false }, { name: '乙', tick: -1, happened: false }, { name: '丙', tick: 0, happened: false }]);
    assert.deepEqual(parseCheckReply('{"clocks":[{"name":"甲","happened":"true"},{"tick":1},"x"]}').clocks, [{ name: '甲', tick: 0, happened: true }]);
    assert.deepEqual(parseCheckReply('{"newThread":"追查失踪案"}').newThread, { name: '追查失踪案', summary: '' });
    assert.deepEqual(parseCheckReply('{"newThread":{"name":" 护送商队 ","summary":"答应护送"}}').newThread, { name: '护送商队', summary: '答应护送' });
    assert.equal(parseCheckReply('{"newThread":{"name":""}}').newThread, null);
    assert.equal(parseCheckReply('{"newThread":5}').newThread, null);
});

test('玩家自开的线：收录为当前阶段的对象支线并标来源；忽略的名字记进进度', () => {
    const { project, units } = threadSetup();
    const volumes = addPlayerThread(project.outline.volumes, units[1].stage.id, { name: '护送商队', summary: '答应护送' });
    const added = flattenUnits(volumes)[1].stage.data.支线事件;
    assert.deepEqual(added, [{ 名称: '护送商队', 事件: '答应护送', 来源: '玩家' }]);
    assert.equal(units[1].stage.data.支线事件, undefined, '不改原大纲');
    const progress = ignoreThread(ignoreThread(emptyProgress('p'), '甲'), '甲');
    assert.deepEqual(threadState(progress).ignored, ['甲']);
    assert.deepEqual([normalizeSettings({}).hookCap, normalizeSettings({}).newThreadMode, normalizeSettings({ hookCap: 99, newThreadMode: 'x' }).hookCap], [2, 'ask', 6]);
});

test('AI 一次回多卷（all）：多个 yaml 代码块合并解析成多卷，默认只取第一块，坏块报错', () => {
    const block = key => `\`\`\`yaml\n${key}:\n  阶段一_甲:\n    时间范围: 一天\n    主线节点:\n      - 名称: 甲\n\`\`\``;
    const reply = `先写两卷\n${block('剧情_卷一_甲')}\n再写\n${block('剧情_卷二_乙')}`;
    const parsed = parseOutlineReply(reply, undefined, { all: true });
    assert.equal(parsed.ok, true);
    assert.deepEqual(parsed.volumes.map(volume => volume.key), ['剧情_卷一_甲', '剧情_卷二_乙']);
    assert.deepEqual(parseOutlineReply(reply).volumes.map(volume => volume.key), ['剧情_卷一_甲'], '默认只取第一个块（改写后续、修复格式、单阶段操作）');
    assert.equal(parseOutlineReply('```yaml\na: [\n```').ok, false);
});

test('支线、世界动态按项目开关：关闭后注入、剧情索引、检测提示都不带这一类，进度钟不推进，已产生的后果照常注入；两者都开时原样不变', () => {
    const project = projectWith(THREADS);
    const units = flattenUnits(project.outline.volumes);
    const s = normalizeSettings({});
    assert.deepEqual(normalizeProject({}, 'p').threads, { sideOn: true, worldOn: true });
    assert.deepEqual(normalizeProject({ threads: { sideOn: false } }, 'p').threads, { sideOn: false, worldOn: true });
    assert.equal(maskUnits(units, threadSwitches(project)), units, '都开时是同一个数组');
    let progress = applyCheck(emptyProgress('p'), liveThreads(units, unitStates(units, emptyProgress('p')), emptyProgress('p')), parseCheckReply('{"done":[],"hooks":["酒馆密谈"]}'), { floor: 1 }).progress;
    progress = patchHook(progress, `${units[0].id}:s1`, { expired: true });
    progress = patchClock(progress, `${units[0].id}:w0`, { done: true });
    progress = advance(progress, units).progress;
    const view = sw => {
        const p = { ...project, threads: sw };
        const masked = maskUnits(units, threadSwitches(p));
        const states = unitStates(masked, progress);
        const entries = buildEntries(p, progress, s);
        const index = buildIndexText(masked, states, progress);
        const live = liveThreads(masked, states, progress);
        const check = buildCheckMessages(masked[1], index, [], checkThreads(live, { newThreadMode: sw.sideOn ? 'ask' : 'off' }))[0].content;
        return { detail: entries.find(entry => entry.kind === 'detail').content, setting: (entries.find(entry => entry.kind === 'setting') || {}).content || '', index, check, live };
    };
    const open = view({ sideOn: true, worldOn: true });
    assert.match(open.detail, /寻剑/);
    assert.match(open.index, /【支线钩子】/);
    const noSide = view({ sideOn: false, worldOn: true });
    assert.doesNotMatch(noSide.detail, /支线|寻剑|旧支线|酒馆/);
    assert.doesNotMatch(noSide.index, /支线/);
    assert.doesNotMatch(noSide.check, /hooks|newThread/);
    assert.match(noSide.setting, /密谈的人离开了城镇/, '已产生的错过后果照常注入');
    const noWorld = view({ sideOn: true, worldOn: false });
    assert.doesNotMatch(noWorld.detail, /世界动态｜|叛军|正在酝酿/);
    assert.doesNotMatch(noWorld.index, /进度钟|叛军/);
    assert.doesNotMatch(noWorld.check, /clocks|叛军/);
    assert.match(noWorld.setting, /城门被叛军攻破/, '已发生的世界动态后果照常注入');
    const fresh = patchClock(progress, `${units[0].id}:w0`, null);
    const masked = maskUnits(units, { sideOn: true, worldOn: false });
    const merged = applyCheck(fresh, liveThreads(masked, unitStates(masked, fresh), fresh), parseCheckReply('{"clocks":[{"name":"叛军逼近","tick":2}]}'), { floor: 9 });
    assert.deepEqual(threadState(merged.progress).clocks, threadState(fresh).clocks, '关闭时钟不推进');
    assert.ok(units[0].stage.data.世界动态 && units[0].stage.data.支线事件, '大纲节点原样保留');
});

// 验收修复：进度按名称兜底、单阶段替换迁移、历史恢复、重名、计时。
import { legacyProject } from './fixtures/legacy-scenarios.js';
import { clampThreads, migrateStageThreads, patchLive, remapNodes } from '../src/core/threads.js';
import { nearestUnitId } from '../src/core/outline.js';

const keyOf = (units, i, id) => `${units[i].id}:${id}`;

test('节点上移、下移、删除后 slots.off 与钟、钩子的键跟着重排；位置对不上时按名称找回，找不到视为孤儿', () => {
    const { units, live } = threadSetup();
    let progress = applyCheck(emptyProgress('p'), live(emptyProgress('p')), parseCheckReply('{"done":[],"hooks":["酒馆密谈"]}'), { floor: 2 }).progress;
    progress = setNodeChecked(progress, units[0].id, 's0', false);
    assert.equal(threadState(progress).hooks[keyOf(units, 0, 's1')].name, '酒馆密谈', '写入时记下节点名');
    const swapped = remapNodes(progress, units[0].id, 's', i => (i === 0 ? 1 : i === 1 ? 0 : i));
    assert.deepEqual(swapped.slots[units[0].id].off, ['s1']);
    assert.ok(threadState(swapped).hooks[keyOf(units, 0, 's0')]);
    assert.equal(threadState(swapped).hooks[keyOf(units, 0, 's1')], undefined);
    const removed = remapNodes(progress, units[0].id, 's', i => (i === 0 ? null : i - 1));
    assert.deepEqual(removed.slots[units[0].id].off, []);
    assert.equal(threadState(removed).hooks[keyOf(units, 0, 's0')].name, '酒馆密谈');
    // 大纲里调换位置但进度没跟着改（例如恢复历史版本）：按名称找回，原位置的新节点不继承。
    const project = projectWith(THREADS);
    const moved = flattenUnits(project.outline.volumes);
    moved[0].stage.id = units[0].id;
    moved[0].id = units[0].id;
    const list = moved[0].stage.data.支线事件;
    [list[1], list[2]] = [list[2], list[1]];
    const view = prog => liveThreads(moved, unitStates(moved, prog), prog);
    const hooks = Object.fromEntries(view(progress).hooks.map(hook => [hook.node.name, hook]));
    assert.equal(hooks['酒馆密谈'].status, 'active');
    assert.equal(hooks['酒馆密谈'].savedKey, keyOf(units, 0, 's1'));
    assert.equal(hooks['二号钩子'].status, 'wait', '占了原位置的节点不继承别人的进度');
    const written = patchLive(progress, hooks['酒馆密谈'], { step: 0 });
    assert.equal(threadState(written).hooks[keyOf(units, 0, 's1')], undefined, '记录搬到新位置');
    assert.equal(threadState(written).hooks[keyOf(units, 0, 's2')].at, 2);
    list[2] = { 名称: '换了名字', 条件: '主角到过酒馆' };
    assert.equal(view(progress).hooks.find(hook => hook.node.name === '换了名字').status, 'wait', '名称对不上的记录视为孤儿');
});

test('单阶段拆分、合并：第一段沿用原 id，钟、钩子、已取消勾选的节点按名称迁到新阶段，进度指向沿用的那段', () => {
    const { units, live } = threadSetup();
    let progress = applyCheck(emptyProgress('p'), live(emptyProgress('p')), parseCheckReply('{"done":[],"hooks":["酒馆密谈"],"clocks":[{"name":"叛军逼近","tick":2}]}'), { floor: 2 }).progress;
    progress = setNodeChecked(progress, units[0].id, 'm0', false);
    progress = { ...progress, current: units[0].id };
    const old = units[0].stage;
    const first = { id: 'new1', key: '阶段一_上', data: { 时间范围: '上', 主线节点: [{ 名称: '甲事件' }], 支线事件: [{ 名称: '酒馆密谈', 条件: '主角到过酒馆', 时限: 10 }] } };
    const second = { id: 'new2', key: '阶段一_下', data: { 时间范围: '下', 主线节点: [{ 名称: '新事件' }], 世界动态: [{ 类型: '叛军逼近', 进度钟: 6 }] } };
    const { volumes, stages, keepId } = replaceStages([units[0].volume], units[0].volume.id, [old.id], [first, second]);
    assert.equal(keepId, old.id);
    assert.deepEqual(stages.map(stage => stage.id), [old.id, 'new2']);
    const moved = migrateStageThreads(progress, [old], stages, keepId);
    assert.equal(moved.current, old.id);
    assert.deepEqual(moved.slots[old.id].off, ['m0']);
    const state = threadState(moved);
    assert.equal(state.hooks[`${old.id}:s0`].at, 2, '钩子迁到新位置');
    assert.equal(state.hooks[`${old.id}:s1`], undefined);
    assert.equal(state.clocks['new2:w0'].filled, 2, '钟迁到拆出的第二段');
    assert.equal(state.clocks[`${old.id}:w0`], undefined);
    const after = flattenUnits(volumes);
    const view = liveThreads(after, unitStates(after, moved), moved);
    assert.equal(view.hooks.find(hook => hook.node.name === '酒馆密谈').status, 'active');
    // 合并：沿用前一段 id，后一段的进度迁进来，没对上的删掉。
    const extra = patchClock(progress, `${units[1].id}:w0`, { filled: 1, name: '不存在' });
    const merged = { id: 'm', key: '阶段一_合并', data: { 主线节点: [{ 名称: '甲事件' }, { 名称: '乙事件' }] } };
    const result = replaceStages([units[0].volume], units[0].volume.id, [units[0].id, units[1].id], [merged]);
    assert.equal(result.keepId, units[0].id);
    const mergedProgress = migrateStageThreads({ ...extra, current: units[1].id }, [units[0].stage, units[1].stage], result.stages, result.keepId);
    assert.equal(mergedProgress.current, units[0].id);
    assert.deepEqual(Object.keys(threadState(mergedProgress).clocks), [], '新阶段没有同名节点的记录删掉');
    assert.equal(mergedProgress.slots[units[1].id], undefined);
    assert.deepEqual(mergedProgress.slots[units[0].id].off, ['m0'], '主线已演的勾选按名称迁过来');
});

test('历史恢复：同名卷、同名阶段按出现顺序配对，用过的 id 不再复用；当前阶段不在了跳到位置最接近的阶段', () => {
    const current = [{ id: 'v1', key: '剧情_卷一_甲', stages: [mkStage('a', '阶段一_同名'), mkStage('b', '阶段一_同名'), mkStage('c', '阶段三_丙')] }];
    const text = outlineToText([{ id: 'x', key: '剧情_卷一_甲', stages: [mkStage('x1', '阶段一_同名'), mkStage('x2', '阶段二_新')] }]);
    const restored = volumesFromHistory(text, current);
    assert.equal(restored[0].stages[0].id, 'a');
    assert.ok(!['a', 'b', 'c'].includes(restored[0].stages[1].id));
    // 同名阶段在 YAML 里写不出两个，这里直接给两个同名的旧阶段，检查配对按顺序、不重复。
    const dup = [{ id: 'v1', key: 'k', stages: [mkStage('a', '阶段一_甲'), mkStage('b', '阶段一_甲')] }, { id: 'v2', key: 'k', stages: [] }];
    const once = volumesFromHistory(outlineToText([{ key: 'k', stages: [mkStage('s', '阶段一_甲')] }]), dup);
    assert.equal(once[0].id, 'v1');
    assert.equal(once[0].stages[0].id, 'a');
    assert.equal(nearestUnitId(current, restored, 'c'), restored[0].stages[1].id, '原第 3 段不在了，取新大纲末段');
    assert.equal(nearestUnitId(current, restored, 'a'), null, '还在就不动');
    assert.equal(nearestUnitId(current, restored, 'zz'), null);
});

const DUPS = `剧情_卷一_重名:
  阶段一_甲:
    时间范围: 一
    主线节点:
      - 名称: 甲
    支线事件:
      - 地点: 村口
        条件: 下雨
    世界动态:
      - 类型: 逼近
        进度钟: 4
  阶段二_乙:
    时间范围: 二
    主线节点:
      - 名称: 乙
    支线事件:
      - 地点: 城里
        条件: 夜里
    世界动态:
      - 类型: 逼近
        进度钟: 4
`;

test('钟、钩子重名：检测索引加来源后缀并按带后缀的名称解析；大纲检查提示重名', () => {
    const project = projectWith(DUPS);
    const units = flattenUnits(project.outline.volumes);
    const progress = advance(emptyProgress('p'), units).progress;
    const states = unitStates(units, progress);
    const live = liveThreads(units, states, progress);
    assert.deepEqual(live.clocks.map(clock => clock.label), ['逼近（阶段一）', '逼近（阶段二）']);
    assert.deepEqual(live.hooks.map(hook => hook.label), ['支线1（阶段一）', '支线1（阶段二）']);
    const index = buildIndexText(units, states, progress);
    assert.match(index, / {2}- 逼近（阶段二） 0\/4/);
    assert.match(index, /\[待触发\] 支线｜支线1（阶段一）：条件：下雨/);
    assert.deepEqual(checkThreads(live).clocks.map(clock => clock.name), ['逼近（阶段一）', '逼近（阶段二）']);
    const out = applyCheck(progress, live, parseCheckReply('{"done":[],"hooks":["支线1（阶段二）"],"clocks":[{"name":"逼近（阶段二）","tick":1},{"name":"逼近","tick":2}]}'), { floor: 4 });
    const state = threadState(out.progress);
    assert.equal(state.clocks[`${units[1].id}:w0`].filled, 1);
    assert.equal(state.clocks[`${units[0].id}:w0`], undefined, '不带后缀的重名不认');
    assert.equal(state.hooks[`${units[1].id}:s0`].at, 4);
    assert.equal(state.hooks[`${units[0].id}:s0`], undefined);
    const texts = outlineIssues(project.outline.volumes).filter(item => item.kind === 'dup-thread').map(item => item.text);
    assert.ok(texts.some(text => /支线「支线1」在 .+ 重名/.test(text)));
    assert.ok(texts.some(text => /进度钟「逼近」在 .+ 重名/.test(text)));
});

test('进度钟：同一批楼（楼数没增加）不重复推进；检测提示标出上次已读到哪一楼', () => {
    const { units, live } = threadSetup();
    const tick = '{"done":[],"clocks":[{"name":"叛军逼近","tick":1}]}';
    let progress = applyCheck(emptyProgress('p'), live(emptyProgress('p')), parseCheckReply(tick), { floor: 6 }).progress;
    assert.equal(threadState(progress).clocks[`${units[0].id}:w0`].lastTickFloor, 6);
    progress = applyCheck(progress, live(progress), parseCheckReply(tick), { floor: 6 }).progress;
    assert.equal(live(progress).clocks[0].filled, 1, '楼数没增加不再推进');
    progress = applyCheck(progress, live(progress), parseCheckReply(tick), { floor: 7 }).progress;
    assert.equal(live(progress).clocks[0].filled, 2);
    const index = buildIndexText(units, unitStates(units, progress), progress);
    const floors = [{ index: 4, text: '旧' }, { index: 6, text: '新' }];
    const messages = buildCheckMessages(units[0], index, floors, checkThreads(live(progress), { readTo: 5 }));
    assert.match(messages[1].content, /【第 4 楼·已读】\n旧/);
    assert.match(messages[1].content, /【第 6 楼】\n新/);
    assert.match(messages[0].content, /clocks 只按之后的新楼层推进/);
});

const ESCORT = `剧情_卷一_护送:
  阶段一_出发:
    时间范围: 一
    主线节点:
      - 名称: 甲
    支线事件:
      - 名称: 护送商队
        时限: 5
        错过: 商队独自上路。
  阶段二_路上:
    时间范围: 二
    主线节点:
      - 名称: 乙
`;

test('没写条件的钩子：不写 at，计时从所在阶段成为当前阶段起算；carryOver 关闭时没真正激活的不延续', () => {
    const project = projectWith(ESCORT);
    const units = flattenUnits(project.outline.volumes);
    const live = (progress, carryOver = true) => liveThreads(units, unitStates(units, progress), progress, { carryOver });
    let progress = patchSlot(emptyProgress('p'), units[0].id, { since: 3 });
    progress = applyCheck(progress, live(progress), parseCheckReply('{"done":[]}'), { floor: 6 }).progress;
    const saved = threadState(progress).hooks[`${units[0].id}:s0`];
    assert.equal(saved.at, undefined, '没写条件的钩子不写 at');
    assert.equal(saved.since, 3, '从阶段成为当前时起算');
    assert.equal(applyCheck(progress, live(progress), parseCheckReply('{"done":[]}'), { floor: 8 }).events.length, 0);
    assert.ok(applyCheck(progress, live(progress), parseCheckReply('{"done":[]}'), { floor: 9 }).events.some(event => event.type === 'hook-expired'));
    const next = advance(progress, units).progress;
    assert.equal(live(next, false).hooks.length, 0, 'carryOver 关闭时只计过时的不延续');
    assert.equal(live(next, true).hooks.length, 1);
    const legacy = patchHook(emptyProgress('p'), `${units[0].id}:s0`, { at: 2 });
    assert.equal(live(legacy).hooks[0].since, 2, '旧数据的 at 当作计时起点');
    assert.equal(live(advance(legacy, units).progress, false).hooks.length, 0, '旧数据的 at 不算激活');
});

test('排队的钩子不过期，时限从第一次进入注入名额起算；「本卷」恢复后只在本卷内有效', () => {
    const { units, live } = threadSetup();
    let progress = applyCheck(emptyProgress('p'), live(emptyProgress('p')), parseCheckReply('{"done":[],"hooks":["二号钩子","三号钩子"]}'), { floor: 2 }).progress;
    progress = applyCheck(progress, live(progress), parseCheckReply('{"done":[],"hooks":["酒馆密谈"]}'), { floor: 3 }).progress;
    const find = (prog, name) => live(prog).hooks.find(hook => hook.node.name === name);
    assert.equal(find(progress, '酒馆密谈').status, 'queue');
    assert.equal(find(progress, '二号钩子').shownAt, 2);
    let out = applyCheck(progress, live(progress), parseCheckReply('{"done":[]}'), { floor: 30 });
    assert.equal(out.events.some(event => event.type === 'hook-expired'), false, '排队中不过期');
    out = applyCheck(out.progress, live(out.progress), parseCheckReply('{"done":["二号钩子"]}'), { floor: 30 });
    progress = out.progress;
    assert.equal(find(progress, '酒馆密谈').status, 'active');
    assert.equal(find(progress, '酒馆密谈').shownAt, 30, '补进名额时记下楼数');
    assert.equal(applyCheck(progress, live(progress), parseCheckReply('{"done":[]}'), { floor: 40 }).events.some(event => event.type === 'hook-expired'), false);
    assert.ok(applyCheck(progress, live(progress), parseCheckReply('{"done":[]}'), { floor: 41 }).events.some(event => event.type === 'hook-expired' && event.name === '酒馆密谈'));
    // 「本卷」：恢复时记下当前卷，到下一卷才过期。
    units[0].stage.data.支线事件[2].时限 = '本卷';
    let vol = applyCheck(emptyProgress('p'), live(emptyProgress('p')), parseCheckReply('{"done":[],"hooks":["二号钩子"]}'), { floor: 1 }).progress;
    vol = advance(advance(vol, units).progress, units).progress;
    vol = patchHook(vol, `${units[0].id}:s2`, { expired: undefined, at: 5, keepVol: 1 });
    assert.equal(applyCheck(vol, live(vol), parseCheckReply('{"done":[]}'), { floor: 60 }).events.some(event => event.type === 'hook-expired'), false, '恢复所在的卷内不过期');
    const later = patchHook(vol, `${units[0].id}:s2`, { keepVol: 0 });
    assert.ok(applyCheck(later, live(later), parseCheckReply('{"done":[]}'), { floor: 60 }).events.some(event => event.type === 'hook-expired'));
});

test('删楼回退：at、shownAt、since、lastTickFloor 夹到当前楼数，没有超出的原样返回', () => {
    let progress = patchHook(emptyProgress('p'), 'u:s0', { at: 20, shownAt: 22, since: 3 });
    progress = patchClock(progress, 'u:w0', { lastTickFloor: 25 });
    progress = patchSlot(progress, 'u', { since: 30 });
    const out = clampThreads(progress, 10);
    assert.deepEqual(threadState(out).hooks['u:s0'], { at: 10, shownAt: 10, since: 3 });
    assert.equal(threadState(out).clocks['u:w0'].lastTickFloor, 10);
    assert.equal(out.slots.u.since, 10);
    assert.equal(clampThreads(out, 10), out);
    const plain = emptyProgress('p');
    assert.equal(clampThreads(plain, 0), plain);
});

test('检测提示：带钩子时 done 可填【支线钩子】里的名称；占位的 newThread 忽略；列出已忽略的线', () => {
    const { units, live } = threadSetup();
    const progress = emptyProgress('p');
    const index = buildIndexText(units, unitStates(units, progress), progress);
    const rich = buildCheckMessages(units[0], index, [], checkThreads(live(progress), { ignored: ['追查失踪案'] }))[0].content;
    assert.match(rich, /done 只填【当前】或【支线钩子】里出现过的节点名/);
    assert.match(rich, /以下线已被忽略，不要再填进 newThread：追查失踪案。/);
    assert.doesNotMatch(buildCheckMessages(units[0], index, [], checkThreads(live(progress), { newThreadMode: 'off', ignored: ['追查失踪案'] }))[0].content, /已被忽略/);
    for (const raw of ['"无"', '"暂无"', '"none"', '"null"', '{"name":"无","summary":"x"}', '{"name":"  空 "}']) {
        assert.equal(parseCheckReply(`{"newThread":${raw}}`).newThread, null, raw);
    }
});

test('支线文字接在第一个启用的进行中阶段条目上，都停用时不注入', () => {
    const { project, units, s } = threadSetup();
    let progress = patchSlot(emptyProgress('p'), units[1].id, { state: 'active' });
    const details = prog => buildEntries(project, prog, s).filter(entry => entry.kind === 'detail');
    assert.match(details(progress)[0].content, /寻剑/);
    progress = patchSlot(progress, units[0].id, { enabled: false });
    assert.doesNotMatch(details(progress)[0].content, /寻剑/);
    assert.match(details(progress)[1].content, /寻剑/, '第一个停用时接到下一个启用的条目');
    progress = patchSlot(progress, units[1].id, { enabled: false });
    assert.ok(details(progress).every(entry => !/寻剑/.test(entry.content)));
});

test('旧大纲按运行时的实际调用方式（带 threads 参数、newThreadMode=off）生成的检测提示与旧版逐字一致', () => {
    const snap = JSON.parse(fs.readFileSync(path.join(import.meta.dirname, 'fixtures/legacy-snapshot.json'), 'utf8'));
    const project = legacyProject();
    const all = flattenUnits(project.outline.volumes);
    const base = emptyProgress(project.id);
    const one = advance(base, all).progress;
    const cases = { fresh: base, one, two: advance(one, all).progress };
    for (const [name, prog] of Object.entries(cases)) {
        for (const carryOver of [true, false]) {
            const want = snap[`mini/${name}${carryOver ? '' : '/noCarry'}`];
            const list = maskUnits(all, threadSwitches(project));
            const states = unitStates(list, prog);
            const index = buildIndexText(list, states, prog, { carryOver });
            const active = list.find(unit => states[unit.id] === 'active');
            const threads = checkThreads(liveThreads(list, states, prog, { carryOver }), { newThreadMode: 'off', ignored: threadState(prog).ignored, readTo: 9 });
            const got = buildCheckMessages(active, index, [{ index: 5, text: '正文' }], threads).map(msg => msg.content);
            assert.deepEqual(got, want.check, `${name}/${carryOver}`);
        }
    }
});

// v0.1.24 复验修复：跨聊天对照表（改名表、阶段 id 别名表）、对调覆盖、已演标记名称兜底、检测失败楼数、占位新线名。
import { alignProgress, outlineLinks, withAliases, withRenames, RENAME_MAX, ALIAS_MAX } from '../src/core/align.js';
import { checkBase, currentIndex, goTo, normalizeProgress, offNodes } from '../src/core/progress.js';
import { restoreOutline } from '../src/core/outline.js';
import { renameByPosition, renameNode } from '../src/core/threads.js';
import { bookEntries } from '../src/host/worldbook.js';

const cloneOutline = project => JSON.parse(JSON.stringify(project.outline));
const unitsOf = outline => flattenUnits(outline.volumes);
const liveOf = (outline, progress) => {
    const units = unitsOf(outline);
    const links = outlineLinks(outline, units);
    return liveThreads(units, unitStates(units, progress, links), progress, { links });
};
const hookOf = (live, name) => live.hooks.find(hook => hook.node.name === name);

test('对调覆盖：两个钩子对调后只在另一个聊天的进度上写 B，A 的激活楼数保留', () => {
    const project = projectWith(THREADS);
    const before = cloneOutline(project);
    const sid = unitsOf(before)[0].id;
    // 聊天 B：在对调前激活了 A（酒馆密谈，s1），没激活二号钩子（s2）。
    let chatB = applyCheck(emptyProgress('p'), liveOf(before, emptyProgress('p')), parseCheckReply('{"done":[],"hooks":["酒馆密谈"]}'), { floor: 2 }).progress;
    assert.equal(threadState(chatB).hooks[`${sid}:s1`].name, '酒馆密谈');
    // 聊天 A 里对调了 s1、s2，只改了聊天 A 的进度；聊天 B 的进度原样。
    const after = cloneOutline(project);
    const list = after.volumes[0].stages[0].data.支线事件;
    [list[1], list[2]] = [list[2], list[1]];
    const live = liveOf(after, chatB);
    assert.equal(hookOf(live, '酒馆密谈').at, 2, '按名称读对了 A');
    assert.equal(hookOf(live, '酒馆密谈').savedKey, `${sid}:s1`);
    chatB = applyCheck(chatB, live, parseCheckReply('{"done":[],"hooks":["二号钩子"]}'), { floor: 5 }).progress;
    const again = liveOf(after, chatB);
    assert.equal(hookOf(again, '酒馆密谈').at, 2, 'A 的 at 保留');
    assert.equal(hookOf(again, '二号钩子').at, 5);
    const hooks = threadState(chatB).hooks;
    assert.equal(hooks[`${sid}:s1`].name, '二号钩子', 'B 写在它现在的位置');
    assert.equal(hooks[`${sid}:s2`].name, '酒馆密谈', 'A 搬到它按名称应在的位置');
    assert.equal(hooks[`${sid}:s2`].at, 2);
    // 手动菜单写入同样先归位。
    const manual = patchLive(chatB, hookOf(again, '二号钩子'), { at: 7 });
    assert.equal(hookOf(liveOf(after, manual), '酒馆密谈').at, 2, '手动菜单写入不盖掉别人的记录');
    assert.equal(hookOf(liveOf(after, manual), '二号钩子').at, 7);
});

test('已演标记按名称兜底：其他聊天的 slots.off 在节点对调、改名、删除后按 offNames 找回，旧的纯 id 数组照旧按位置读', () => {
    const project = projectWith(MINI);
    const before = cloneOutline(project);
    const unit0 = unitsOf(before)[0];
    let chatB = uncheckByNames(emptyProgress('p'), unit0.id, stageNodes(unit0.stage.data), ['甲事件']);
    assert.deepEqual(chatB.slots[unit0.id].off, ['m0']);
    assert.deepEqual(chatB.slots[unit0.id].offNames, { m0: '甲事件' }, '写 off 时记下节点名');
    const after = cloneOutline(project);
    const mains = after.volumes[0].stages[0].data.主线节点;
    [mains[0], mains[1]] = [mains[1], mains[0]];
    const unit = unitsOf(after)[0];
    assert.deepEqual(offNodes(chatB, unit), ['m1'], '位置变了按名称找回');
    const states = unitStates(unitsOf(after), chatB);
    assert.match(buildIndexText(unitsOf(after), states, chatB), /\[已演\] 主线｜甲事件[\s\S]*\[未演\] 主线｜乙事件|\[未演\] 主线｜乙事件[\s\S]*\[已演\] 主线｜甲事件/);
    const detail = buildEntries({ ...project, outline: after }, chatB, normalizeSettings({})).find(entry => entry.kind === 'detail').content;
    assert.doesNotMatch(detail, /甲事件/, '注入时已演的节点不写');
    assert.match(detail, /乙事件/);
    // 归位后写回现在的位置；再勾回按现在的位置清掉。
    const aligned = alignProgress(chatB, after);
    assert.deepEqual(aligned.slots[unit.id].off, ['m1']);
    assert.deepEqual(aligned.slots[unit.id].offNames, { m1: '甲事件' });
    assert.equal(alignProgress(aligned, after), aligned, '已归位的原样返回');
    assert.deepEqual(offNodes(setNodeChecked(aligned, unit.id, 'm1', true), unit), []);
    // 名称对不上又没有改名记录：不按位置误认给别的节点。
    mains[1] = { 名称: '换掉了' };
    assert.deepEqual(offNodes(chatB, unitsOf(after)[0]), []);
    // 旧数据（没有 offNames）照旧按位置读。
    const legacy = setNodeChecked(emptyProgress('p'), unit0.id, 'm0', false);
    assert.equal(legacy.slots[unit0.id].offNames, undefined);
    assert.deepEqual(offNodes(legacy, unit0), ['m0']);
    // 节点上移下移时 offNames 跟着重排。
    const moved = remapNodes(chatB, unit0.id, 'm', i => (i === 0 ? 1 : i === 1 ? 0 : i));
    assert.deepEqual(moved.slots[unit0.id].offNames, { m1: '甲事件' });
});

test('改名表：A 聊天改了节点名，B 聊天（进度没同步）按改名链读到原记录；改名后恢复历史，两个聊天都读得到', () => {
    const project = projectWith(THREADS);
    const before = cloneOutline(project);
    const sid = unitsOf(before)[0].id;
    let chatB = applyCheck(emptyProgress('p'), liveOf(before, emptyProgress('p')), parseCheckReply('{"done":[],"hooks":["酒馆密谈"]}'), { floor: 3 }).progress;
    chatB = uncheckByNames(chatB, sid, stageNodes(unitsOf(before)[0].stage.data), ['甲事件']);
    // 聊天 A：改名并记进改名表；聊天 A 自己的进度按位置跟着改。
    let chatA = chatB;
    const renamed = cloneOutline(project);
    renamed.volumes[0].stages[0].data.支线事件[1].名称 = '密谈改名';
    renamed.volumes[0].stages[0].data.主线节点[0].名称 = '甲改名';
    let outline = withRenames(renamed, [
        { stageId: sid, field: '支线事件', from: '酒馆密谈', to: '密谈改名' },
        { stageId: sid, field: '主线节点', from: '甲事件', to: '甲改名' },
    ]);
    for (const node of stageNodes(outline.volumes[0].stages[0].data)) chatA = renameNode(chatA, { id: sid }, node);
    assert.equal(hookOf(liveOf(outline, chatA), '密谈改名').at, 3);
    assert.equal(hookOf(liveOf(outline, chatB), '密谈改名').at, 3, 'B 聊天按改名链找回钩子');
    assert.deepEqual(offNodes(chatB, unitsOf(outline)[0], outlineLinks(outline)), ['m0'], 'B 聊天按改名链找回已演标记');
    const alignedB = alignProgress(chatB, outline);
    assert.equal(threadState(alignedB).hooks[`${sid}:s1`].name, '密谈改名', '归位时记录改成现名');
    // 恢复改名前的历史版本：节点名变回旧名。
    const restored = restoreOutline(outlineToText(before.volumes), outline.volumes);
    assert.equal(restored.volumes[0].stages[0].id, sid);
    outline = withAliases({ ...outline, volumes: restored.volumes }, restored.alias);
    const units = unitsOf(outline);
    const links = outlineLinks(outline, units);
    chatA = renameByPosition(chatA, units, links);
    assert.equal(hookOf(liveOf(outline, chatA), '酒馆密谈').at, 3, '当前聊天恢复后读得到');
    assert.equal(hookOf(liveOf(outline, alignedB), '酒馆密谈').at, 3, '已归位到新名的聊天反向走改名链读得到');
    assert.equal(hookOf(liveOf(outline, chatB), '酒馆密谈').at, 3, '没同步过的聊天原样读得到');
    assert.deepEqual(offNodes(alignedB, units[0], links), ['m0']);
});

const MERGE = `剧情_卷一_合并:
  阶段一_前:
    时间范围: 一
    主线节点:
      - 名称: 前事件
    世界动态:
      - 类型: 前钟
        进度钟: 4
  阶段二_后:
    时间范围: 二
    主线节点:
      - 名称: 后事件
    支线事件:
      - 名称: 后钩子
        条件: 下雨
    世界动态:
      - 类型: 后钟
        进度钟: 6
  阶段三_尾:
    时间范围: 三
    主线节点:
      - 名称: 尾事件
`;

test('阶段 id 别名表：B 聊天停在被合并掉的段，打开后 current 落在合并后的段，钟、钩子、已演标记也跟过来', () => {
    const project = projectWith(MERGE);
    const before = cloneOutline(project);
    const [first, second, third] = unitsOf(before);
    // 聊天 B 停在第二段：后钟 3/6、后钩子已激活、后事件已演。
    let chatB = goTo(emptyProgress('p'), unitsOf(before), second.id);
    chatB = applyCheck(chatB, liveOf(before, chatB), parseCheckReply('{"done":[],"hooks":["后钩子"],"clocks":[{"name":"后钟","tick":2},{"name":"前钟","tick":1}]}'), { floor: 4 }).progress;
    chatB = applyCheck(chatB, liveOf(before, chatB), parseCheckReply('{"done":[],"clocks":[{"name":"后钟","tick":1}]}'), { floor: 6 }).progress;
    chatB = uncheckByNames(chatB, second.id, stageNodes(second.stage.data), ['后事件']);
    // 聊天 A 里合并一、二段（沿用第一段 id），被换掉的 id 记进别名表。
    const merged = { key: '阶段一_合并', data: { 时间范围: '一到二', 主线节点: [{ 名称: '前事件' }, { 名称: '后事件' }], 支线事件: [{ 名称: '后钩子', 条件: '下雨' }], 世界动态: [{ 类型: '前钟', 进度钟: 4 }, { 类型: '后钟', 进度钟: 6 }] } };
    const result = replaceStages(before.volumes, before.volumes[0].id, [first.id, second.id], [merged]);
    const outline = withAliases({ ...before, volumes: result.volumes }, [[second.id, result.keepId]]);
    assert.deepEqual(outline.idAlias, { [second.id]: first.id });
    const units = unitsOf(outline);
    const links = outlineLinks(outline, units);
    assert.equal(currentIndex(units, chatB), 0, '不查别名表时退回第一段（旧行为）');
    assert.equal(units[currentIndex(units, chatB, links)].id, first.id, '查别名表落在合并后的段');
    assert.equal(currentIndex([...units.slice(1), units[0]], chatB, links), 1, '合并后的段不在第一位时同样找到');
    const aligned = alignProgress(chatB, outline);
    assert.equal(aligned.current, first.id);
    const live = liveOf(outline, aligned);
    assert.equal(live.clocks.find(clock => clock.node.name === '后钟').filled, 3, '钟跟过来');
    assert.equal(live.clocks.find(clock => clock.node.name === '前钟').filled, 1);
    assert.equal(hookOf(live, '后钩子').at, 4, '钩子跟过来');
    assert.deepEqual(offNodes(aligned, units[0]), ['m1'], '已演标记跟过来');
    assert.equal(aligned.slots[second.id], undefined, '旧 id 的槽位并进新 id');
    assert.ok(Object.keys(threadState(aligned).clocks).every(key => key.startsWith(`${first.id}:`)), '钟的键写回新 id');
    assert.equal(alignProgress(aligned, outline), aligned);
    // 未归位时直接读也能按别名对上。
    assert.equal(liveOf(outline, chatB).clocks.find(clock => clock.node.name === '后钟').filled, 3);
    assert.ok(units.some(unit => unit.id === third.id), '没参与合并的段不动');
});

test('别名表：链式解析、防环、旧 id 重新出现时以现存为准；normalizeProject 补默认值并限长', () => {
    const outline = withAliases(withAliases({ volumes: [{ id: 'v', key: 'k', stages: [mkStage('c', '阶段一_丙')] }] }, [['a', 'b']]), [['b', 'c']]);
    const links = outlineLinks(outline);
    assert.equal(links.resolve('a'), 'c', '链式解析');
    assert.equal(links.resolve('c'), 'c');
    assert.equal(links.resolve('zz'), 'zz');
    const loop = outlineLinks({ volumes: [], idAlias: { a: 'b', b: 'a' } });
    assert.equal(loop.resolve('a'), 'a', '成环时原样返回');
    assert.deepEqual(withAliases({ idAlias: { a: 'b' } }, [['b', 'a']]).idAlias, { b: 'a' }, '反向别名删掉');
    const old = normalizeProject({ outline: { volumes: [] } }, 'p');
    assert.deepEqual(old.outline.renames, []);
    assert.deepEqual(old.outline.idAlias, {});
    const big = normalizeProject({ outline: {
        volumes: [],
        renames: [...Array.from({ length: RENAME_MAX + 50 }, (_, i) => ({ stageId: 's', field: '支线事件', from: `a${i}`, to: `b${i}` })), null, { stageId: 's', field: '不认识', from: 'x', to: 'y' }, { stageId: 's', field: '支线事件', from: 'x', to: 'x' }],
        idAlias: Object.fromEntries(Array.from({ length: ALIAS_MAX + 20 }, (_, i) => [`o${i}`, `n${i}`]).concat([['self', 'self'], ['bad', 3]])),
    } }, 'p');
    assert.equal(big.outline.renames.length, RENAME_MAX);
    assert.equal(big.outline.renames.at(-1).from, `a${RENAME_MAX + 49}`, '只留最近的');
    assert.equal(Object.keys(big.outline.idAlias).length, ALIAS_MAX);
    assert.equal(big.outline.idAlias.self, undefined);
    assert.deepEqual(normalizeProject({ outline: { volumes: [], renames: 'x', idAlias: [1] } }, 'p').outline.renames, []);
    assert.deepEqual(newProject('x').outline.idAlias, {});
});

test('历史恢复：卷改过名时按阶段名在全书范围内配对，阶段 id 保持；配不上的给新 id 并记进别名表', () => {
    const current = [{ id: 'v1', key: '剧情_卷一_新名', stages: [mkStage('a', '阶段一_甲'), mkStage('b', '阶段二_乙'), mkStage('c', '阶段三_丙')] }];
    const text = outlineToText([{ key: '剧情_卷一_旧名', stages: [mkStage('x', '阶段一_甲'), mkStage('y', '阶段二_乙'), mkStage('z', '阶段三_改过')] }]);
    const { volumes, alias } = restoreOutline(text, current);
    assert.equal(volumes[0].id, 'v1', '卷 id 取阶段配到最多的旧卷');
    assert.deepEqual(volumes[0].stages.slice(0, 2).map(stage => stage.id), ['a', 'b']);
    const fresh = volumes[0].stages[2].id;
    assert.ok(!['a', 'b', 'c'].includes(fresh));
    assert.deepEqual(alias, [['c', fresh]], '同位置配不上的旧阶段记进别名表');
    assert.deepEqual(volumesFromHistory(text, current).map(volume => volume.stages.map(stage => stage.id).slice(0, 2)), [['a', 'b']]);
    // 阶段挪到了另一卷：全书范围内按名称配上。
    const two = [{ id: 'v1', key: 'k1', stages: [mkStage('a', '阶段一_甲')] }, { id: 'v2', key: 'k2', stages: [mkStage('b', '阶段一_乙')] }];
    const back = restoreOutline(outlineToText([{ key: 'k1', stages: [mkStage('x', '阶段一_甲'), mkStage('y', '阶段一_乙')] }]), two);
    assert.deepEqual(back.volumes[0].stages.map(stage => stage.id), ['a', 'b']);
    assert.deepEqual(back.alias, []);
});

test('检测失败只记 lastFailFloor 控制重试间隔，lastCheckFloor（readTo、「·已读」）不动', () => {
    const progress = normalizeProgress({ lastCheckFloor: 4, lastFailFloor: 9 }, 'p');
    assert.equal(progress.lastCheckFloor, 4);
    assert.equal(checkBase(progress), 9, '重试间隔从失败的楼数算');
    assert.equal(checkBase({ lastCheckFloor: 6 }), 6);
    assert.equal('lastFailFloor' in normalizeProgress({ lastCheckFloor: 4, lastFailFloor: 0 }, 'p'), false);
    assert.equal('lastFailFloor' in normalizeProgress({}, 'p'), false);
    const { units, live } = threadSetup();
    const index = buildIndexText(units, unitStates(units, progress), progress);
    const messages = buildCheckMessages(units[0], index, [{ index: 5, text: '没读过' }], checkThreads(live(progress), { readTo: progress.lastCheckFloor }));
    assert.match(messages[1].content, /【第 5 楼】\n没读过/, '失败那批楼不标已读');
});

test('newThread 占位名：去掉首尾空白与末尾标点后比对，新增没有新线、无新线、N/A、- 等写法', () => {
    for (const name of ['没有新线', '没有新的线。', '无新线！', 'N/A', 'n/a', '-', '  无。 ', '暂无；', 'None.', '没有新线，']) {
        assert.equal(parseCheckReply(JSON.stringify({ newThread: { name, summary: 'x' } })).newThread, null, name);
        assert.equal(parseCheckReply(JSON.stringify({ newThread: name })).newThread, null, name);
    }
    assert.equal(parseCheckReply('{"newThread":{"name":"追查失踪案。","summary":"x"}}').newThread.name, '追查失踪案。', '真名不受影响');
});

test('世界书条目读取：probability 为 null 或缺省时为 100，useProbability 关闭时显示 100', () => {
    const read = entry => bookEntries({ entries: { 0: { uid: 0, key: ['a'], ...entry } } })[0];
    assert.equal(read({ probability: null }).probability, 100);
    assert.equal(read({}).probability, 100);
    assert.equal(read({ probability: 30 }).probability, 30);
    assert.equal(read({ probability: 30 }).useProbability, true);
    assert.equal(read({ probability: 30, useProbability: false }).probability, 100);
    assert.equal(read({ probability: 30, useProbability: false }).useProbability, false);
    assert.equal(read({ probability: 0, useProbability: true }).probability, 0);
});
