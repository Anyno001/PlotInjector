// 人设进度随聊天存在 progress.personas：{ [线id]: 阶段id, fixed: { [选项id]: 值 }, muted: [线id], manual: [线id], auto: { [线id]: 自动判断的阶段id }, names: { [线id]: 阶段名 } }。
// 单独成文件：progress.js 与 personas.js 都要用，避免互相引用。
export const PERSONA_RESERVED = ['fixed', 'muted', 'manual', 'auto', 'names'];

const isObj = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const strMap = value => Object.fromEntries(Object.entries(isObj(value) ? value : {}).filter(([, item]) => typeof item === 'string'));
const strList = value => (Array.isArray(value) ? [...new Set(value.filter(item => typeof item === 'string'))] : []);

export function emptyPersonaProgress() {
    return { fixed: {}, muted: [], manual: [], auto: {}, names: {} };
}

export function normalizePersonaProgress(value) {
    const src = isObj(value) ? value : {};
    const out = emptyPersonaProgress();
    for (const [key, item] of Object.entries(src)) if (!PERSONA_RESERVED.includes(key) && typeof item === 'string') out[key] = item;
    out.fixed = strMap(src.fixed);
    out.muted = strList(src.muted);
    out.manual = strList(src.manual);
    out.auto = strMap(src.auto);
    out.names = strMap(src.names);
    return out;
}
