import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { setYamlLib, parseYaml } from '../src/core/yaml.js';
import { flattenUnits, moveItem, moveStageToVolume, outlineIssues, outlineToText, parseOutlineText, pushOutlineHistory, replaceStages, stageNodes, volumeLabel } from '../src/core/outline.js';
import { restoreOutline as restoreOutlineAt } from '../src/core/outline.js';
const volumesFromHistory = (text, current) => restoreOutlineAt(text, current).volumes;
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




test('正文只注入设定与当前阶段详细；详细标明是尚未发生的规划；剧情索引给检测用、写得详细', () => {
    const project = projectWith(MINI);
    const progress = emptyProgress(project.id);
    const entries = buildEntries(project, progress, normalizeSettings({}));
    assert.deepEqual(entries.map(entry => entry.kind), ['detail']);
    assert.match(entries[0].content, /^<剧情参考 卷="卷一" 阶段="阶段一_开端">[\s\S]*以下是当前正在进行、尚未演完的剧情规划/);
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







test('设定按分块采用：只换选中块，新块追加', () => {
    const oldText = '世界观声明:\n基于: 旧\n\n铁则:\n- 旧铁则';
    const newText = '世界观声明:\n基于: 新\n\n铁则:\n- 新铁则\n\n场景库:\n- 新场景';
    assert.deepEqual(splitBlocks(oldText).map(block => block.key), ['世界观声明', '铁则']);
    const merged = mergeBlocks(oldText, newText, ['铁则', '场景库']);
    assert.match(merged, /基于: 旧/);
    assert.match(merged, /新铁则/);
    assert.match(merged, /场景库:\n- 新场景$/);
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
    assert.deepEqual(s.llm.discuss, { source: 'custom', endpoint: 'https://a.example/v1', apiKey: 'k', model: 'm1', temperature: '', stream: '' });
    assert.equal(s.llm.outline.source, 'tavern');
    assert.equal(s.llm.check.source, 'tavern');
    assert.equal(s.presets.length, 1);
    assert.deepEqual(normalizeSettings(s), s);
    const old = normalizeSettings({ llm: { check: { source: 'custom', endpoint: 'https://b/v1', apiKey: '', model: 'x', temperature: '0.3' } } });
    assert.deepEqual(resolveLlm(old, 'check'), { source: 'custom', endpoint: 'https://b/v1', apiKey: '', model: 'x', temperature: '0.3', stream: '' });
    assert.deepEqual(resolveLlm(old, 'discuss'), { source: 'tavern' });
    assert.deepEqual(old.presets, []);
});








const wbEntry = (key, over = {}) => ({ key, title: `条目${key}`, disabled: false, constant: false, keys: [], keysSecondary: [], selectiveLogic: 0, order: 100, content: '', ...over });






const mkStage = (id, key, data = {}) => ({ id, key, data: { 时间范围: '一天', 主线节点: [{ 名称: `${id}节点` }], ...data } });





// threads v0.1.23：进度钟、支线钩子、支线链、玩家自开的线。
import { legacyOutputs } from './fixtures/legacy-scenarios.js';
import { addPlayerThread, applyCheck, checkThreads, clockPhase, ignoreThread, liveThreads, maskUnits, threadState, threadSwitches } from '../src/core/threads.js';
import { patchClock, patchHook } from './thread-helpers.mjs';
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










// 验收修复：进度按名称兜底、单阶段替换迁移、历史恢复、重名、计时。
import { legacyProject } from './fixtures/legacy-scenarios.js';
import { clampThreads, migrateStageThreads, patchLive, remapNodes } from '../src/core/threads.js';
import { nearestUnitId } from '../src/core/outline.js';

const keyOf = (units, i, id) => `${units[i].id}:${id}`;




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






