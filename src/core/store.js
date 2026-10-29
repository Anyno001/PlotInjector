import { DEFAULT_PARAMS } from './inject.js';
import { makeId } from './outline.js';
import { DEFAULT_ACU, normalizeAcu } from './acu.js';

export const INDEX_FILE = 'pi-index.json';
export const projectFile = id => `pi-p-${id}.json`;
export const chatFile = id => `pi-c-${id}.json`;
export const FILE_PREFIX = 'pi-';

export const LLM_ROLES = [
    { key: 'discuss', label: '讨论' },
    { key: 'outline', label: '写设定与大纲' },
    { key: 'check', label: '进度检测' },
];

// 每个用途各存一套连接（同 v0.1.4）。接口预设只是存下来的连接，载入时复制进某个用途，之后互不影响。
export const DEFAULT_LLM = { source: 'tavern', endpoint: '', apiKey: '', model: '', temperature: '' };
export const DEFAULT_PRESET = { id: '', name: '', endpoint: '', apiKey: '', model: '', temperature: '' };
const CONN_KEYS = ['endpoint', 'apiKey', 'model', 'temperature'];

function pickConn(src) {
    const out = {};
    for (const key of CONN_KEYS) out[key] = String(src && src[key] != null ? src[key] : '').trim();
    return out;
}

function normalizePreset(value) {
    const src = value && typeof value === 'object' ? value : {};
    return { id: String(src.id || '').trim(), name: String(src.name || '').trim(), ...pickConn(src) };
}

// v0.1.5 的用途存的是 { source: 'preset', presetId }，读入时展开回独立接口。
function normalizeLlm(src) {
    const presets = (Array.isArray(src.presets) ? src.presets : []).map(normalizePreset).filter(item => item.id);
    const llm = {};
    for (const { key } of LLM_ROLES) {
        const role = src.llm && src.llm[key] && typeof src.llm[key] === 'object' ? src.llm[key] : {};
        const linked = role.source === 'preset' && presets.find(item => item.id === role.presetId);
        if (linked) llm[key] = { source: 'custom', ...pickConn(linked) };
        else if (role.source === 'custom') llm[key] = { source: 'custom', ...pickConn(role) };
        else llm[key] = { ...DEFAULT_LLM, ...pickConn(role), source: 'tavern' };
    }
    return { llm, presets };
}

export function resolveLlm(settings, role) {
    const llm = settings.llm && settings.llm[role];
    return llm && llm.source === 'custom' ? { ...llm } : { source: 'tavern' };
}

export const DEFAULT_SETTINGS = {
    tagName: '剧情参考',
    offTrackMode: 'ask',
    handleMode: 'ask',
    checkEvery: 3,
    checkFloors: 3,
    guide: '',
    loaderRef: '',
    llm: { discuss: { ...DEFAULT_LLM }, outline: { ...DEFAULT_LLM }, check: { ...DEFAULT_LLM } },
    presets: [],
    acu: DEFAULT_ACU,
};

const HANDLE_MODES = ['ask', 'auto', 'nodes'];
const OFF_MODES = ['ask', 'auto', 'off'];

export function normalizeSettings(value) {
    const src = value && typeof value === 'object' ? value : {};
    const { llm, presets } = normalizeLlm(src);
    return {
        ...DEFAULT_SETTINGS,
        ...src,
        offTrackMode: OFF_MODES.includes(src.offTrackMode) ? src.offTrackMode : DEFAULT_SETTINGS.offTrackMode,
        handleMode: HANDLE_MODES.includes(src.handleMode) ? src.handleMode : DEFAULT_SETTINGS.handleMode,
        checkEvery: Math.max(1, Math.min(50, Number(src.checkEvery) || DEFAULT_SETTINGS.checkEvery)),
        checkFloors: Math.max(1, Math.min(20, Number(src.checkFloors) || DEFAULT_SETTINGS.checkFloors)),
        llm,
        presets,
        acu: normalizeAcu(src.acu),
    };
}

export function emptyIndex() {
    return { version: 1, active: {}, projects: [], files: [], settings: normalizeSettings({}) };
}

export function normalizeIndex(value) {
    const src = value && typeof value === 'object' ? value : {};
    const projects = Array.isArray(src.projects) ? src.projects.filter(item => item && typeof item.id === 'string') : [];
    return {
        version: 1,
        active: src.active && typeof src.active === 'object' ? src.active : {},
        projects: projects.map(item => ({ id: item.id, name: String(item.name || '未命名'), group: String(item.group || ''), updatedAt: Number(item.updatedAt) || 0, bytes: item.bytes && typeof item.bytes === 'object' ? item.bytes : {} })),
        files: Array.isArray(src.files) ? src.files.filter(name => typeof name === 'string' && name.startsWith(FILE_PREFIX)) : [],
        settings: normalizeSettings(src.settings),
    };
}

export function newProject(name, now = Date.now()) {
    return {
        version: 1,
        id: makeId('p'),
        name: String(name || '').trim() || '新项目',
        createdAt: now,
        setting: { text: '', history: [], check: '', fixes: [] },
        outline: { volumes: [] },
        defaults: JSON.parse(JSON.stringify(DEFAULT_PARAMS)),
    };
}

export function normalizeProject(value, id) {
    const src = value && typeof value === 'object' ? value : {};
    const setting = src.setting && typeof src.setting === 'object' ? src.setting : {};
    const volumes = src.outline && Array.isArray(src.outline.volumes) ? src.outline.volumes : [];
    return {
        version: 1,
        id: src.id || id,
        name: String(src.name || '未命名'),
        createdAt: Number(src.createdAt) || 0,
        setting: {
            text: String(setting.text || ''),
            history: Array.isArray(setting.history) ? setting.history : [],
            check: String(setting.check || ''),
            fixes: Array.isArray(setting.fixes) ? setting.fixes : [],
        },
        outline: {
            volumes: volumes.filter(vol => vol && Array.isArray(vol.stages)).map(vol => ({
                id: vol.id || makeId('v'),
                key: String(vol.key || '剧情_未命名'),
                stages: vol.stages.filter(stage => stage && stage.data && typeof stage.data === 'object').map(stage => ({ id: stage.id || makeId('s'), key: String(stage.key || '阶段'), data: stage.data })),
            })),
        },
        defaults: { ...JSON.parse(JSON.stringify(DEFAULT_PARAMS)), ...(src.defaults || {}) },
    };
}

export function emptyChat() {
    return { version: 1, summary: '', messages: [], refs: { oc: [], setting: true, outline: false } };
}

export function normalizeChat(value) {
    const src = value && typeof value === 'object' ? value : {};
    return {
        version: 1,
        summary: String(src.summary || ''),
        messages: Array.isArray(src.messages) ? src.messages.filter(msg => msg && typeof msg.content === 'string').map(msg => ({ id: msg.id || makeId('m'), role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content, at: Number(msg.at) || 0, folded: Boolean(msg.folded) })) : [],
        refs: { oc: [], setting: true, outline: false, ...(src.refs || {}) },
    };
}

// 项目列表：按分组折叠，组内按最近使用排序；无分组的排在最前。
export function groupProjects(projects) {
    const groups = new Map();
    for (const project of [...projects].sort((a, b) => b.updatedAt - a.updatedAt)) {
        const key = project.group || '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(project);
    }
    return [...groups.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'zh'))).map(([name, items]) => ({ name, items }));
}

export function byteLength(text) {
    return new TextEncoder().encode(String(text)).length;
}

export function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
