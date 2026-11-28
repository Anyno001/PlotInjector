import { isPlainObject } from './outline.js';

// 借数据库「剧情推进」那次调用，判断玩家这一轮走进了哪个剧情场景，让场景材料当轮就给正文，不等下一轮填表。
// 做法：把聊天正在用的推进预设复制一份「原名（线索模式）」，在第一个启用的任务末尾（结尾的 assistant 预填之前）
// 插一段：用 SQL 读线索控制表的场景目录，要求输出最后写一行 <pi_scene>编号</pi_scene>。
// 只用 SQLite 模式：{[sql]} 在原生模式下原样留在提示词里。

export const PLOT_SUFFIX = '（线索模式）';
export const PLOT_SCENE_TAG = 'pi_scene';
export const PLOT_SCENE_MARK = '【剧情注入器：可去的剧情场景】';
export const PLOT_SCENE_NONE = '无';

export const PLOT_SCENE_TEXT = `${PLOT_SCENE_MARK}
下面是现在可以展开的剧情场景（编号：要做的事；地点）。只用来判断这一轮该展开哪一个，不要在其他输出里提到。
{[sql "SELECT 场景目录 FROM 线索控制表"]}

判断规则：
1. 要去的地方：用户这一轮人进了那里，才选它。只是打算、约定、托人去、聊起、拒绝、经过没进去，都不算。
2. 会找上门的事（附近传来动静、有人来找、突然出事；只用于这类场景）：用户这一轮人在外面（出门、在路上、在街上，正往家走也算），就算碰上了，选它，不用管离那个地点多远。人已经在家里或在室内忙别的，不算。
3. 都不是，或者场景列表为空、看不懂，选${PLOT_SCENE_NONE}。
在输出的最后单独写一行 <${PLOT_SCENE_TAG}>选中的编号或${PLOT_SCENE_NONE}</${PLOT_SCENE_TAG}>，这一行之外的输出照原来的要求写。`;

// 时间跳跃（大纲里有时间条件时才加，接在场景判断后面，同一次调用）：用户这一轮明确跳过一段时间时，多写一行 <pi_time>。
// 插件只在这一轮算条件时用（比表格时间晚才用），不写表；真实时间仍由填表写。自然流逝不判断，等填表。
export const PLOT_TIME_TAG = 'pi_time';
export function plotTimeText(table, column) {
    return `【剧情注入器：故事时间】
表格记录的当前时间：{[sql "SELECT ${column} FROM ${table}"]}
只有用户这一轮让故事时间明确跳过了一段，才判断跳到了什么时候。算跳过的：睡到第二天、等到晚上、几个小时后、几天后、直接说了要到哪天哪个时刻。
不算的：正常对话、走动、做事（哪怕做了一阵子）；回忆过去；约好以后再做；只是提到别的日子。上面的当前时间是空的，也不写。
算的话，跳到的时间照上面当前时间的写法写（同样的日期、钟点格式；只说了时段的，取那个时段常见的钟点），在 <${PLOT_SCENE_TAG}> 那一行之后再单独写一行 <${PLOT_TIME_TAG}>跳到的时间</${PLOT_TIME_TAG}>；不算就不写这一行。`;
}
// 插进推进任务的整段：场景判断，有时间判断时接在后面
export const plotTaskText = (timeText = '') => (timeText ? `${PLOT_SCENE_TEXT}\n\n${timeText}` : PLOT_SCENE_TEXT);

const clone = (x) => JSON.parse(JSON.stringify(x));
const isOurs = (seg) => isPlainObject(seg) && String(seg.content || '').startsWith(PLOT_SCENE_MARK);
const isAssistant = (seg) => isPlainObject(seg) && /^(assistant|ai)$/i.test(String(seg.role || ''));

// 去掉插件加的那段（比较原预设和复制品时用）
export function stripSceneTask(preset) {
    if (!isPlainObject(preset)) return preset;
    let out = clone(preset);
    for (let t of Array.isArray(out.plotTasks) ? out.plotTasks : []) isPlainObject(t) && Array.isArray(t.promptGroup) && (t.promptGroup = t.promptGroup.filter((s) => !isOurs(s)));
    return out;
}

// 复制品：第一个启用的任务里，结尾连续的 assistant 段（预填）之前插入那一段。没有可用任务返回 null。
export function withSceneTask(preset, name, timeText = '') {
    if (!isPlainObject(preset)) return null;
    let out = stripSceneTask(preset),
        tasks = Array.isArray(out.plotTasks) ? out.plotTasks : [],
        task = tasks.find((t) => isPlainObject(t) && t.enabled !== !1 && Array.isArray(t.promptGroup));
    if (!task) return null;
    let g = task.promptGroup,
        at = g.length;
    while (at > 0 && isAssistant(g[at - 1])) at--;
    g.splice(at, 0, { role: 'USER', content: plotTaskText(timeText), deletable: !0 });
    out.name = name;
    return out;
}

// 复制品是不是由这份原预设按当前这段文字（含不含时间判断）生成的
export function sceneTaskCurrent(copy, base, timeText = '') {
    if (!isPlainObject(copy) || !isPlainObject(base)) return !1;
    let text = plotTaskText(timeText),
        has = (Array.isArray(copy.plotTasks) ? copy.plotTasks : []).some(
            (t) => isPlainObject(t) && Array.isArray(t.promptGroup) && t.promptGroup.some((s) => isOurs(s) && s.content === text),
        ),
        bare = (p) => JSON.stringify({ ...stripSceneTask(p), name: '' });
    return has && bare(copy) === bare(base);
}

// 推进输出里最后一个 <pi_scene>…</pi_scene> 的内容；没有返回 ''
export function readPlotScene(text) {
    let re = new RegExp(`<${PLOT_SCENE_TAG}>\\s*([\\s\\S]*?)\\s*</${PLOT_SCENE_TAG}>`, 'gi'),
        m,
        last = '';
    while ((m = re.exec(String(text || '')))) last = m[1].trim();
    return last;
}

// 推进输出里最后一个 <pi_time>…</pi_time> 的内容；不带数字的（「三天后」这类没法比的）不算，返回 ''
export function readPlotTime(text) {
    let re = new RegExp(`<${PLOT_TIME_TAG}>\\s*([\\s\\S]*?)\\s*</${PLOT_TIME_TAG}>`, 'gi'),
        m,
        last = '';
    while ((m = re.exec(String(text || '')))) last = m[1].trim();
    return /\d/.test(last) ? last : '';
}

// 正文请求里不该出现这两行（推进没提取到任何标签时，数据库会把整段原文交给正文）
export function stripPlotScene(text) {
    return String(text).replace(new RegExp(`[ \\t]*<(${PLOT_SCENE_TAG}|${PLOT_TIME_TAG})>[\\s\\S]*?</\\1>[ \\t]*\\n?`, 'gi'), '');
}

// 一条消息上存的推进原文（每个任务一份，旧版只有 qrf_plot）
export function plotOutputOf(msg) {
    if (!isPlainObject(msg)) return '';
    let tasks = isPlainObject(msg.qrf_plot_tasks) ? Object.values(msg.qrf_plot_tasks).filter((x) => typeof x == 'string') : [];
    return tasks.length ? tasks.join('\n') : typeof msg.qrf_plot == 'string' ? msg.qrf_plot : '';
}
