import { filterStageData, flattenUnits, splitStageKey, splitVolumeKey, stageLabel, stageNodes, volumeLabel } from './outline.js';
import { INDEX_SLOT, SETTING_SLOT, offNodes, unitStates } from './progress.js';
import { stringifyYaml } from './yaml.js';

// 位置编号与酒馆 world_info_position 一致。
export const POSITIONS = [
    { value: 0, label: '角色定义前', short: '↑Char' },
    { value: 1, label: '角色定义后', short: '↓Char' },
    { value: 2, label: '作者注释前', short: '↑AN' },
    { value: 3, label: '作者注释后', short: '↓AN' },
    { value: 5, label: '示例消息前', short: '↑EM' },
    { value: 6, label: '示例消息后', short: '↓EM' },
    { value: 4, label: '@D 深度', short: '@D' },
];
export const ROLES = [
    { value: 0, label: '系统' },
    { value: 1, label: '用户' },
    { value: 2, label: 'AI' },
];
export const SIGNAL_TAG = '<剧情推进/>';

export const DEFAULT_PARAMS = {
    setting: { position: 1, depth: 4, role: 0, order: 80, enabled: true },
    index: { position: 1, depth: 4, role: 0, order: 90, enabled: true },
    detail: { position: 4, depth: 4, role: 0, order: 100, enabled: true },
};

export function positionLabel(entry) {
    const pos = POSITIONS.find(item => item.value === Number(entry.position));
    if (!pos) return '?';
    if (pos.value !== 4) return pos.short;
    const role = ROLES.find(item => item.value === Number(entry.role));
    return `@D${Number(entry.depth) || 0}${role && role.value ? `·${role.label}` : ''}`;
}

function pickParams(base, slot) {
    const out = { ...base };
    for (const key of ['position', 'depth', 'role', 'order', 'enabled']) {
        if (slot && slot[key] !== undefined && slot[key] !== null && slot[key] !== '') out[key] = slot[key];
    }
    out.position = Number(out.position);
    out.depth = Math.max(0, Number(out.depth) || 0);
    out.role = Number(out.role) || 0;
    out.order = Number(out.order) || 0;
    out.enabled = out.enabled !== false;
    return out;
}

function stagePlace(unit) {
    return `${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}`;
}

function nodeNames(unit, off) {
    const hidden = new Set(off);
    return stageNodes(unit.stage.data).filter(node => node.kind === 'main' && !hidden.has(node.id)).map(node => node.name);
}

function rangeOf(unit) {
    const value = unit.stage.data && unit.stage.data.时间范围;
    return value ? String(value).trim() : '';
}

export function buildIndexText(units, states, progress, settings) {
    const keepDone = Math.max(0, Number(settings.keepDone ?? 2));
    const done = units.filter(unit => states[unit.id] === 'done');
    const active = units.filter(unit => states[unit.id] === 'active');
    const next = units.filter(unit => states[unit.id] === 'next');
    const lines = [];
    if (done.length) {
        const recent = keepDone ? done.slice(-keepDone) : [];
        const folded = done.slice(0, done.length - recent.length);
        const foldedVolumes = [...new Set(folded.map(unit => volumeLabel(unit.volume.key)))];
        const parts = [];
        if (foldedVolumes.length) parts.push(`${foldedVolumes.join('、')}（前情）`);
        for (const unit of recent) {
            const names = stageNodes(unit.stage.data).filter(node => node.kind === 'main').map(node => node.name);
            parts.push(`${stagePlace(unit)}${names.length ? `（${names.join('／')}）` : ''}`);
        }
        lines.push(`已过：${parts.join('；')}`);
    }
    for (const unit of active) {
        const range = rangeOf(unit);
        lines.push(`当前：${stagePlace(unit)}${range ? `｜时间范围：${range}` : ''}`);
    }
    const visibility = settings.nextVisibility || 'range';
    for (const unit of next) {
        const range = rangeOf(unit);
        let line = `下一段：${stagePlace(unit)}`;
        if (visibility !== 'name' && range) line += `｜时间范围：${range}`;
        const instr = unit.stage.data && unit.stage.data.AI指令;
        if (visibility === 'instr' && instr) line += `｜${String(instr).trim()}`;
        lines.push(line);
    }
    if (!lines.length) return '';
    if (next.length && settings.switchSource !== 'check') {
        lines.push(`当前阶段的主线节点都已发生、剧情进入下一段的时间范围时，在正文末尾单独一行输出 ${SIGNAL_TAG}。`);
    }
    return `<剧情索引>\n${lines.join('\n')}\n</剧情索引>`;
}

export function buildDetailText(unit, off, settings) {
    const tag = String(settings.tagName || '剧情参考').trim() || '剧情参考';
    const data = filterStageData(unit.stage.data, off);
    const body = stringifyYaml({ [unit.stage.key]: data }).trimEnd();
    const vol = splitVolumeKey(unit.volume.key).short;
    return `<${tag} 卷="${vol}" 阶段="${unit.stage.key}">\n${body}\n</${tag}>`;
}

// 执行页与注入共用：返回本轮要注入的条目（含停用的，UI 需要显示），注入时只取 enabled。
export function buildEntries(project, progress, settings) {
    const defaults = { ...DEFAULT_PARAMS, ...(project && project.defaults) };
    const entries = [];
    if (!project) return entries;
    const settingText = String(project.setting && project.setting.text || '').trim();
    if (settingText) {
        entries.push({
            slotId: SETTING_SLOT, kind: 'setting', title: '设定',
            content: settingText, ...pickParams(defaults.setting, progress.slots[SETTING_SLOT]),
        });
    }
    const units = flattenUnits(project.outline && project.outline.volumes);
    if (units.length) {
        const states = unitStates(units, progress);
        const indexText = buildIndexText(units, states, progress, settings);
        if (indexText) {
            entries.push({
                slotId: INDEX_SLOT, kind: 'index', title: '剧情索引',
                content: indexText, ...pickParams(defaults.index, progress.slots[INDEX_SLOT]),
            });
        }
        for (const unit of units) {
            if (states[unit.id] !== 'active') continue;
            const off = offNodes(progress, unit.id);
            entries.push({
                slotId: unit.id, kind: 'detail', title: `${volumeLabel(unit.volume.key)}·${splitStageKey(unit.stage.key).short}`,
                unit, content: buildDetailText(unit, off, settings), ...pickParams(defaults.detail, progress.slots[unit.id]),
            });
        }
    }
    return entries;
}

export function stageMainNames(unit, progress) {
    return nodeNames(unit, offNodes(progress, unit.id));
}

const VIRTUAL_BASE_UID = 990000;

// 世界书管线要求的完整字段；constant + ignoreBudget，不进定时效果、不参与关键词。
export function toWorldInfoEntry(entry, index, world) {
    return {
        uid: VIRTUAL_BASE_UID + index,
        world,
        key: [],
        keysecondary: [],
        comment: `剧情注入器·${entry.title}`,
        content: entry.content,
        constant: true,
        vectorized: false,
        selective: false,
        selectiveLogic: 0,
        addMemo: true,
        order: entry.order,
        position: entry.position,
        disable: false,
        ignoreBudget: true,
        excludeRecursion: true,
        preventRecursion: false,
        matchPersonaDescription: false,
        matchCharacterDescription: false,
        matchCharacterPersonality: false,
        matchCharacterDepthPrompt: false,
        matchScenario: false,
        matchCreatorNotes: false,
        delayUntilRecursion: 0,
        probability: 100,
        useProbability: false,
        depth: entry.depth,
        outletName: '',
        group: '',
        groupOverride: false,
        groupWeight: 100,
        scanDepth: null,
        caseSensitive: null,
        matchWholeWords: null,
        useGroupScoring: null,
        automationId: '',
        role: entry.role,
        sticky: null,
        cooldown: null,
        delay: null,
        triggers: [],
    };
}
