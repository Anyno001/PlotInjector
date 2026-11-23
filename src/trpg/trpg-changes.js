// 跑团项目：已结束阶段的「状态变化」接在公共设定后面注入（复用大纲模式的 changesText）。
// c = 线索运行时的 compute() 结果；没有已结束的阶段、或阶段没写状态变化，返回空串。
import { changesText } from '../core/inject.js';

export function trpgChangesText(c) {
    if (!c || !c.compiled || !c.state) return '';
    const states = {};
    for (const [id, s] of c.state.stageStates) s && s.done && (states[id] = 'done');
    return changesText(c.compiled.units, states);
}
