import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { setYamlLib, parseYaml } from '../src/core/yaml.js';
import { flattenUnits, outlineToText, parseOutlineText, stageNodes, volumeLabel } from '../src/core/outline.js';
import { advance, emptyProgress, setNodeChecked, uncheckByNames, unitStates, patchSlot } from '../src/core/progress.js';
import { buildEntries, buildIndexText, toWorldInfoEntry } from '../src/core/inject.js';
import { buildCheckMessages, cleanFloorText, parseCheckReply } from '../src/core/check.js';
import { acuField, groupByField } from '../src/core/acu.js';
import { checkedSet, entryRefId, migrateOc, normalizeWbRule, ruleFromSelection } from '../src/core/refs.js';
import { normalizeChat } from '../src/core/store.js';
import { mergeBlocks, parseSettingReply, splitBlocks } from '../src/core/setting.js';
import { parseOutlineReply } from '../src/core/prompts.js';
import { normalizeSettings, newProject, resolveLlm } from '../src/core/store.js';
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
    assert.equal(entries[0].position, 4);
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

test('详细条目可改位置与深度', () => {
    const project = projectWith(MINI);
    const units = flattenUnits(project.outline.volumes);
    const progress = patchSlot(emptyProgress(project.id), units[0].id, { position: 1, depth: 2, role: 1 });
    const detail = buildEntries(project, progress, normalizeSettings({})).find(entry => entry.kind === 'detail');
    const wi = toWorldInfoEntry(detail, 0, 'PlotInjector');
    assert.deepEqual([wi.position, wi.depth, wi.role, wi.constant, wi.ignoreBudget], [1, 2, 1, true, true]);
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
    assert.deepEqual(result, { done: ['甲事件'], stageDone: true, offTrack: false, offReason: '', reason: '都演完了' });
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
});
