import { normalizeClue } from './clue-model.js';
import { DEFAULT_PARAMS, OLD_DEFAULT_PARAMS } from './inject.js';
import { normalizeInfinite } from './infinite.js';
import { normalizeAlias, normalizeRenames } from './align.js';
import { makeId } from './outline.js';
import { emptyPersonas, normalizePersonas } from './personas.js';
import { DEFAULT_MEMO, DEFAULT_WB_RULE, migrateOc, normalizeWbRule } from './refs.js';

export const INDEX_FILE = 'pi-index.json';
export const projectFile = (id) => `pi-p-${id}.json`;
export const chatFile = (id) => `pi-c-${id}.json`;
export const FILE_PREFIX = 'pi-';

export const LLM_ROLES = [
    { key: 'discuss', label: '讨论' },
    { key: 'outline', label: '写设定与大纲' },
    { key: 'check', label: '进度检测' },
];

// 每个用途各存一套连接（同 v0.1.4）。接口预设只是存下来的连接，载入时复制进某个用途，之后互不影响。
export const DEFAULT_LLM = { source: 'tavern', endpoint: '', apiKey: '', model: '', temperature: '' };
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
    const presets = (Array.isArray(src.presets) ? src.presets : []).map(normalizePreset).filter((item) => item.id);
    const llm = {};
    for (const { key } of LLM_ROLES) {
        const role = src.llm && src.llm[key] && typeof src.llm[key] === 'object' ? src.llm[key] : {};
        const linked = role.source === 'preset' && presets.find((item) => item.id === role.presetId);
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
    // 正文通用提示（角色知情、剧情推进，GPT §20.1）：随本轮剧情材料注入一次；没有材料时不出现。
    bodyGuide: !0,
    bodyGuideText: '',
    offTrackMode: 'ask',
    personaMode: 'ask',
    carryOver: true,
    handleMode: 'ask',
    hookCap: 2,
    newThreadMode: 'ask',
    checkEvery: 3,
    checkFloors: 3,
    // 写作基准：generic（通用，默认）/ fanfic（同人世界观速成）/ custom（用 guide 里的自定义文本）。
    guidePreset: 'generic',
    // 新手教程看过哪些页（41a_ui_tour.js）：{ revision, done: [页名] }。revision 不等于 TOUR_REVISION 时视为都没看过。
    tourState: null,
    guide: '',
    persona: '',
    paceText: { slow: '', normal: '', fast: '' },
    loaderRef: '',
    llm: { discuss: { ...DEFAULT_LLM }, outline: { ...DEFAULT_LLM }, check: { ...DEFAULT_LLM } },
    presets: [],
};

const HANDLE_MODES = ['ask', 'auto', 'nodes'];
const OFF_MODES = ['ask', 'auto', 'off'];
const THREAD_MODES = ['ask', 'auto', 'off'];
const PERSONA_MODES = ['ask', 'auto', 'off'];

export function normalizeSettings(value) {
    const src = value && typeof value == 'object' ? value : {},
        { llm, presets } = normalizeLlm(src);
    return {
        ...DEFAULT_SETTINGS,
        ...src,
        offTrackMode: OFF_MODES.includes(src.offTrackMode) ? src.offTrackMode : DEFAULT_SETTINGS.offTrackMode,
        personaMode: PERSONA_MODES.includes(src.personaMode) ? src.personaMode : DEFAULT_SETTINGS.personaMode,
        carryOver: src.carryOver !== !1,
        bodyGuide: src.bodyGuide !== !1,
        bodyGuideText: String(src.bodyGuideText || ''),
        // 以前改过写作基准的（只有 guide、没有 guidePreset）算作自定义。
        guidePreset: ['generic', 'fanfic', 'custom'].includes(src.guidePreset)
            ? src.guidePreset
            : String(src.guide || '').trim()
              ? 'custom'
              : 'generic',
        guide: String(src.guide || ''),
        handleMode: HANDLE_MODES.includes(src.handleMode) ? src.handleMode : DEFAULT_SETTINGS.handleMode,
        hookCap: Math.max(1, Math.min(6, Math.round(Number(src.hookCap)) || DEFAULT_SETTINGS.hookCap)),
        newThreadMode: THREAD_MODES.includes(src.newThreadMode) ? src.newThreadMode : DEFAULT_SETTINGS.newThreadMode,
        checkEvery: Math.max(1, Math.min(50, Number(src.checkEvery) || DEFAULT_SETTINGS.checkEvery)),
        checkFloors: Math.max(1, Math.min(20, Number(src.checkFloors) || DEFAULT_SETTINGS.checkFloors)),
        persona: typeof src.persona == 'string' ? src.persona : '',
        paceText: Object.fromEntries(['slow', 'normal', 'fast'].map((key) => [key, String((src.paceText && src.paceText[key]) || '')])),
        llm,
        presets,
    };
}

export function emptyIndex() {
    return { version: 1, active: {}, projects: [], files: [], settings: normalizeSettings({}) };
}

export function normalizeIndex(value) {
    let src = value && typeof value == 'object' ? value : {},
        projects = Array.isArray(src.projects) ? src.projects.filter((item) => item && typeof item.id == 'string') : [];
    return {
        version: 1,
        active: src.active && typeof src.active == 'object' ? src.active : {},
        projects: projects.map((item) => ({
            id: item.id,
            name: String(item.name || '未命名'),
            group: String(item.group || ''),
            updatedAt: Number(item.updatedAt) || 0,
            bytes: item.bytes && typeof item.bytes == 'object' ? item.bytes : {},
            ...(Array.isArray(item.imports) ? { imports: item.imports.filter((x) => typeof x == 'string') } : {}),
        })),
        files: Array.isArray(src.files) ? src.files.filter((name) => typeof name == 'string' && name.startsWith(FILE_PREFIX)) : [],
        settings: normalizeSettings(src.settings),
    };
}

export function newProject(name, now = Date.now(), mode = 'normal') {
    return {
        version: 1,
        id: makeId('p'),
        name: String(name || '').trim() || '新项目',
        createdAt: now,
        clue: normalizeClue({}),
        setting: { text: '', history: [], check: '', fixes: [], mute: [] },
        outline: { volumes: [], history: [], renames: [], idAlias: {} },
        defaults: JSON.parse(JSON.stringify(DEFAULT_PARAMS)),
        genRefs: normalizeGenRefs(),
        personas: emptyPersonas(),
        mode: mode === 'infinite' ? 'infinite' : 'normal',
        ...(mode === 'infinite' ? { infinite: normalizeInfinite({}) } : {}),
    };
}

export function normalizeProject(value, id) {
    const src = value && typeof value == 'object' ? value : {},
        setting = src.setting && typeof src.setting == 'object' ? src.setting : {},
        volumes = src.outline && Array.isArray(src.outline.volumes) ? src.outline.volumes : [];
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
            mute: Array.isArray(setting.mute) ? setting.mute.map(String) : [],
        },
        outline: {
            history:
                src.outline && Array.isArray(src.outline.history)
                    ? src.outline.history.filter((item) => item && typeof item.text == 'string')
                    : [],
            // 跨聊天对照表（见 core/align.js）：节点改名最多 200 条，阶段 id 别名最多 300 条。
            renames: normalizeRenames(src.outline && src.outline.renames),
            idAlias: normalizeAlias(src.outline && src.outline.idAlias),
            volumes: volumes
                .filter((vol) => vol && Array.isArray(vol.stages))
                .map((vol) => ({
                    id: vol.id || makeId('v'),
                    key: String(vol.key || '剧情_未命名'),
                    ...(vol.line && typeof vol.line == 'object' && !Array.isArray(vol.line) ? { line: vol.line } : {}),
                    stages: vol.stages
                        .filter((stage) => stage && stage.data && typeof stage.data == 'object')
                        .map((stage) => ({ id: stage.id || makeId('s'), key: String(stage.key || '阶段'), data: stage.data })),
                })),
        },
        defaults: normalizeDefaults(src.defaults),
        clue: normalizeClue(src.clue),
        ...(src.outlineIdMap && typeof src.outlineIdMap == 'object' ? { outlineIdMap: src.outlineIdMap } : {}),
        imports: Array.isArray(src.imports) ? src.imports.filter((x) => typeof x == 'string') : [],
        importAdopted: Array.isArray(src.importAdopted) ? src.importAdopted.filter((x) => typeof x == 'string') : [],
        genRefs: normalizeGenRefs(src.genRefs),
        ...(src.secretNames && typeof src.secretNames == 'object' && !Array.isArray(src.secretNames) ? { secretNames: normalizeSecretNames(src.secretNames) } : {}),
        personas: normalizePersonas(src.personas),
        threads: { sideOn: !(src.threads && src.threads.sideOn === !1), worldOn: !(src.threads && src.threads.worldOn === !1) },
        mode: src.mode === 'infinite' ? 'infinite' : 'normal',
        ...(src.infinite && typeof src.infinite == 'object' ? { infinite: normalizeInfinite(src.infinite) } : {}),
        // 批量导入支线采用后的对应（GPT 代码审阅 R4）：{ "任务id:原编号": 卷id }。之后再采用同一任务的线，引用照这个改到实际的新编号。
        ...(src.importLineMap && typeof src.importLineMap == 'object' && !Array.isArray(src.importLineMap)
            ? { importLineMap: Object.fromEntries(Object.entries(src.importLineMap).filter(([, v]) => typeof v == 'string')) }
            : {}),
    };
}

// 设定、大纲页让 AI 写作时带的参考：讨论记录开关 + 世界书条目（规则与讨论页相同，见 core/refs.js）。
// 保密名单（导入审阅总方案 R7）：按来源剧情线（卷 id）分开存，再导入 / 重新审阅一条线不覆盖别的线。
// { 卷id: { names: [全名或别名…], confirmed: [确认过的短名…], denied: [确认不是的短名…] } }。没有这个字段 = 「未提供保密名单」。
export function normalizeSecretNames(value) {
    let list = (x) => (Array.isArray(x) ? [...new Set(x.map((n) => String(n || '').trim()).filter((n) => n.length >= 2))] : []);
    return Object.fromEntries(
        Object.entries(value || {})
            .filter(([k, v]) => k && v && typeof v == 'object' && !Array.isArray(v))
            .map(([k, v]) => [k, { names: list(v.names), confirmed: list(v.confirmed), denied: list(v.denied) }]),
    );
}
// 项目检查时用的合并名单：所有线的全名、别名和确认过的短名。返回 null 表示一条线都没有提供名单。
export function projectSecretNames(project) {
    let all = project && project.secretNames && typeof project.secretNames == 'object' ? Object.values(project.secretNames) : [];
    return all.length ? [...new Set(all.flatMap((x) => [...(x.names || []), ...(x.confirmed || [])]))] : null;
}

export function normalizeGenRefs(value) {
    const src = value && typeof value === 'object' ? value : {};
    const memo = Number(src.memo);
    return {
        talk: src.talk !== false,
        memo: Number.isFinite(memo) ? Math.max(0, Math.min(100, Math.round(memo))) : DEFAULT_MEMO,
        wb: src.wb ? normalizeWbRule(src.wb) : { ...DEFAULT_WB_RULE, fields: {}, picks: {} },
    };
}

// 旧项目文件里存着当时的默认位置；没改过的换成现在的默认，改过的保留。
function normalizeDefaults(value) {
    const out = JSON.parse(JSON.stringify(DEFAULT_PARAMS));
    for (const kind of Object.keys(out)) {
        const saved = value && value[kind];
        if (!saved || typeof saved !== 'object') continue;
        const old = OLD_DEFAULT_PARAMS[kind];
        const untouched = Object.keys(old).every((key) => Number(saved[key]) === old[key]);
        out[kind] = untouched ? { ...out[kind], enabled: saved.enabled !== false } : { ...out[kind], ...saved };
    }
    return out;
}

export function emptyChat() {
    return {
        version: 1,
        summary: '',
        messages: [],
        refs: { setting: true, outline: false, progress: true, floors: 10, memo: DEFAULT_MEMO, wb: DEFAULT_WB_RULE },
    };
}

// 讨论页附带参考：设定、大纲、剧情进度三个开关，正文楼数，世界书条目选择规则。
function normalizeRefs(value) {
    const src = value && typeof value === 'object' ? value : {};
    const floors = Number(src.floors);
    const memo = Number(src.memo);
    return {
        setting: src.setting !== false,
        outline: Boolean(src.outline),
        progress: src.progress !== false,
        floors: Number.isFinite(floors) ? Math.max(0, Math.min(50, Math.round(floors))) : 10,
        memo: Number.isFinite(memo) ? Math.max(0, Math.min(100, Math.round(memo))) : DEFAULT_MEMO,
        wb: src.wb ? normalizeWbRule(src.wb) : migrateOc(src.oc),
    };
}

export function normalizeChat(value) {
    const src = value && typeof value === 'object' ? value : {};
    return {
        version: 1,
        summary: String(src.summary || ''),
        messages: Array.isArray(src.messages)
            ? src.messages
                  .filter((msg) => msg && typeof msg.content === 'string')
                  .map((msg) => ({
                      id: msg.id || makeId('m'),
                      role: msg.role === 'user' ? 'user' : 'assistant',
                      content: msg.content,
                      at: Number(msg.at) || 0,
                      folded: Boolean(msg.folded),
                  }))
            : [],
        refs: normalizeRefs(src.refs),
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
    return [...groups.entries()]
        .sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : a.localeCompare(b, 'zh')))
        .map(([name, items]) => ({ name, items }));
}

export function formatBytes(bytes) {
    const n = Number(bytes) || 0;
    if (n < 1024) return `${n} B`;
    if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
    return `${(n / 1024 / 1024).toFixed(2)} MB`;
}
