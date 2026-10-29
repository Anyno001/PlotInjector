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
import { acuBlocked, acuField, filterAcuLore, normalizeAcu, setAcuEntry, setAcuField } from '../src/core/acu.js';
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

test('数据库条目屏蔽：按字段分组 + 单条覆盖，同字段新条目跟随；扫描前从候选里去掉', () => {
    assert.equal(acuField('TavernDB-ACU-CustomExport-人物档案-1'), '人物档案');
    assert.equal(acuField('TavernDB-ACU-CustomExport-人物档案-12'), '人物档案');
    assert.equal(acuField('TavernDB-ACU-CustomExport-物品栏-包裹'), '物品栏');
    assert.equal(acuField('TavernDB-ACU-CustomExport-剧情纪要-上'), '剧情纪要');
    assert.equal(acuField('TavernDB-ACU-CustomExport-剧情纪要-下'), '剧情纪要');
    assert.equal(acuField('TavernDB-ACU-CustomExport-世界观'), '世界观');
    assert.equal(acuField('TavernDB-ACU-ImportantPersonsIndex'), '英文字段');
    assert.equal(acuField('TavernDB-ACU-CustomExport-Summary'), '英文字段');
    assert.equal(acuField('手写剧情'), '');
    let acu = setAcuField(normalizeAcu({}), '剧情纪要', true);
    assert.ok(acuBlocked(acu, 'TavernDB-ACU-CustomExport-剧情纪要-上'));
    assert.ok(acuBlocked(acu, 'TavernDB-ACU-CustomExport-剧情纪要-9'), '同字段新增条目跟随');
    assert.ok(!acuBlocked(acu, 'TavernDB-ACU-CustomExport-人物档案-1'), '其他字段不受影响');
    acu = setAcuEntry(acu, 'TavernDB-ACU-CustomExport-剧情纪要-上', false);
    assert.ok(!acuBlocked(acu, 'TavernDB-ACU-CustomExport-剧情纪要-上'));
    acu = setAcuEntry(acu, 'TavernDB-ACU-CustomExport-剧情纪要-上', true);
    assert.deepEqual(acu.overrides, {});
    acu = setAcuEntry(setAcuField(acu, '剧情纪要', false), 'TavernDB-ACU-CustomExport-人物档案-1', true);
    assert.deepEqual(acu.fields, {});
    const payload = { globalLore: [{ comment: '手写剧情' }], characterLore: [{ comment: 'TavernDB-ACU-CustomExport-人物档案-1' }, { comment: 'TavernDB-ACU-CustomExport-人物档案-2' }], chatLore: [], personaLore: [] };
    assert.equal(filterAcuLore(acu, payload), 1);
    assert.deepEqual(payload.characterLore.map(item => item.comment), ['TavernDB-ACU-CustomExport-人物档案-2']);
    assert.deepEqual(normalizeAcu(JSON.parse(JSON.stringify(acu))), acu);
});
