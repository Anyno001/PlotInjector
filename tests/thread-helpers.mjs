// 测试用：直接改进度里的进度钟 / 钩子（原来在 src/core/threads.js，插件本身不用，GPT 第三轮清理 D4 挪到测试里）。
// patch 为 null 时删掉这一项（重置）；值为 undefined 的字段删掉。
import { threadState } from '../src/core/threads.js';

function patchMap(progress, field, key, patch) {
    const state = threadState(progress),
        map = state[field];
    if (patch === null) {
        const { [key]: _drop, ...rest } = map;
        return { ...progress, threads: { ...state, [field]: rest } };
    }
    const next = { ...(map[key] || {}), ...patch };
    for (const name of Object.keys(next)) if (next[name] === undefined) delete next[name];
    return { ...progress, threads: { ...state, [field]: { ...map, [key]: next } } };
}
export const patchClock = (progress, key, patch) => patchMap(progress, 'clocks', key, patch);
export const patchHook = (progress, key, patch) => patchMap(progress, 'hooks', key, patch);
