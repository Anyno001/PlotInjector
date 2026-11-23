// 跑团分流：外壳文件用这里的小工具，按项目选用 src/trpg 里的拷贝或线索模式的原文件。
// 判断一律是 isTrpg(project)；拷贝和原文件两边互不引用。
import { isTrpg } from './trpg.js';

// 界面层：view.project() 是当前页面对应的项目。
export function viewIsTrpg(view) {
    try {
        return isTrpg(view && typeof view.project == 'function' ? view.project() : null);
    } catch {
        return !1;
    }
}

// 跑团项目里「设定」叫「公共设定」、「大纲」叫「模组」；其他项目照旧。
export const outlineWord = (project) => (isTrpg(project) ? '模组' : '大纲');
export const settingWord = (project) => (isTrpg(project) ? '公共设定' : '设定');

// 处理函数表（第一个参数是 view）：每个键按当前项目转给拷贝或原文件。
export function routeActions(orig, copy) {
    const out = {};
    for (const key of new Set([...Object.keys(orig), ...Object.keys(copy)]))
        out[key] = (view, ...args) => {
            const side = viewIsTrpg(view) && copy[key] ? copy : orig;
            return (side[key] || orig[key] || copy[key])(view, ...args);
        };
    return out;
}

// 运行时：两套线索运行时同时存在，但每次只让当前项目对应的那套干活。
// 清理类的调用（停监听、清缓存、清状态）两套都做，避免切项目后留下旧的监听或缓存。
const BOTH = new Set(['stop', 'setLineBar', 'hideLineBar', 'onChatChanged', 'endRound', 'discardPendingCandidates']);

export function routeRuntime(orig, copy, useCopy) {
    const out = {};
    for (const key of Object.keys(orig))
        out[key] = (...args) => {
            const cur = useCopy() ? copy : orig,
                other = cur === copy ? orig : copy;
            if (key === 'register') return (other.stop(), cur.register(...args));
            if (key === 'invalidate') return (other.invalidate(), cur.invalidate(...args));
            if (BOTH.has(key)) return (other[key](...args), cur[key](...args));
            return cur[key](...args);
        };
    return out;
}
