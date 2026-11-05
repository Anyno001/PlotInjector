// 旧大纲（不带进度钟、钩子等新键）的注入、索引、检测提示输出。快照在 v0.1.22 代码上生成，新版必须逐字一致。
import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { setYamlLib } from '../../src/core/yaml.js';
import { flattenUnits, parseOutlineText } from '../../src/core/outline.js';
import { advance, emptyProgress, setNodeChecked, unitStates } from '../../src/core/progress.js';
import { buildEntries, buildIndexText, changesText } from '../../src/core/inject.js';
import { buildCheckMessages } from '../../src/core/check.js';
import { newProject, normalizeSettings } from '../../src/core/store.js';

setYamlLib(YAML);

const TEXT = `剧情_卷一_测试:
  阶段一_开端:
    时间范围: 开始时
    AI指令: 推进开端。
    主线节点:
      - 名称: 甲事件
        地点: 甲地
        事件: 甲发生。
        偏转: 若不发生则改。
      - 乙事件
    支线事件:
      - 名称: 丙支线
        地点: 村口
        事件: 丙发生。
        触发: 有人提起时。
      - 字符串支线
    世界动态:
      - 类型: 丁传闻
        来源: 商人
        内容: 丁流传。
    状态变化:
      - 她察觉到甲。
  阶段二_发展:
    时间范围: 开端之后
    AI指令: 推进发展。
    主线节点:
      - 名称: 戊事件
        事件: 戊发生。
    支线事件:
      - 名称: 己支线
        事件: 己发生。
    世界动态:
      - 类型: 庚动态
        内容: 庚在变化。
剧情_卷二_续:
  阶段一_转折:
    时间范围: 发展之后
    主线节点:
      - 名称: 辛事件
        事件: 辛发生。
`;

export const SAMPLE_DIR = path.resolve(import.meta.dirname, '../../../特殊文件/剧情整理');

function outputs(project, progress, settings) {
    const units = flattenUnits(project.outline.volumes);
    const states = unitStates(units, progress);
    const index = buildIndexText(units, states, progress, { carryOver: settings.carryOver });
    const active = units.find(unit => states[unit.id] === 'active');
    return {
        entries: buildEntries(project, progress, settings).map(entry => `${entry.slotId === '@setting' ? 'setting' : entry.title}|${entry.content}`),
        index,
        indexNoCarry: buildIndexText(units, states, progress, { carryOver: false }),
        changes: changesText(units, states),
        check: active ? buildCheckMessages(active, index, [{ index: 5, text: '正文' }]).map(msg => msg.content) : [],
    };
}

// 与快照生成时同样的项目（id 按顺序编号）。
export function legacyProject(text = TEXT) {
    let seq = 0;
    const project = newProject('快照');
    project.id = 'p1';
    project.outline.volumes = parseOutlineText(text, prefix => `${prefix}${++seq}`);
    project.setting.text = '铁则:\n- 甲';
    return project;
}

function run(name, text) {
    const project = legacyProject(text);
    const units = flattenUnits(project.outline.volumes);
    const base = emptyProgress(project.id);
    const one = advance(base, units).progress;
    const progresses = {
        fresh: base,
        offs: setNodeChecked(setNodeChecked(base, units[0].id, 'm0', false), units[0].id, 's1', false),
        one,
        oneOff: setNodeChecked(one, units[0].id, 's0', false),
        two: units.length > 2 ? advance(one, units).progress : one,
        fast: { ...base, pace: 'fast' },
    };
    const out = {};
    for (const [key, progress] of Object.entries(progresses)) {
        out[`${name}/${key}`] = outputs(project, progress, normalizeSettings({}));
        out[`${name}/${key}/noCarry`] = outputs(project, progress, normalizeSettings({ carryOver: false }));
    }
    return out;
}

export function legacyOutputs({ samples = true } = {}) {
    const out = run('mini', TEXT);
    if (samples && fs.existsSync(SAMPLE_DIR)) {
        for (const file of fs.readdirSync(SAMPLE_DIR).filter(item => item.endsWith('.yaml')).sort()) {
            Object.assign(out, run(file, fs.readFileSync(path.join(SAMPLE_DIR, file), 'utf8')));
        }
    }
    return out;
}
