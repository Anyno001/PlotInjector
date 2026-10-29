import { SIGNAL_TAG } from './inject.js';
import { stageLabel, stageNodes, volumeLabel } from './outline.js';

const SIGNAL_PATTERN = /<\s*剧情推进\s*\/?\s*>/;

export function hasSignal(text) {
    return SIGNAL_PATTERN.test(String(text || ''));
}

// 检测只看正文：去掉思维链、代码块、状态栏一类的标签块。
export function cleanFloorText(text, limit = 3000) {
    let out = String(text || '');
    out = out.replace(/<(think|thinking|reasoning|status|statusbar|状态栏|details)\b[^>]*>[\s\S]*?<\/\1>/gi, '');
    out = out.replace(/```[\s\S]*?```/g, '');
    out = out.replace(/<\s*剧情推进\s*\/?\s*>/g, '');
    out = out.replace(/<[^>\n]{1,80}>/g, '');
    out = out.replace(/\n{3,}/g, '\n\n').trim();
    return out.length > limit ? out.slice(-limit) : out;
}

export function buildCheckMessages(unit, offIds, floors) {
    const off = new Set(offIds || []);
    const nodes = stageNodes(unit.stage.data).filter(node => node.kind !== 'world');
    const list = nodes.map(node => `- [${off.has(node.id) ? '已演' : '未演'}] ${node.label}｜${node.name}${node.item && node.item.事件 ? `：${String(node.item.事件).slice(0, 160)}` : ''}`);
    const range = unit.stage.data && unit.stage.data.时间范围;
    const system = [
        '你是剧情进度核对员。根据最近的正文，判断当前阶段的哪些节点已经在正文中实际发生。',
        '只认正文里已经写出的事件，计划、预告、角色设想不算发生。',
        '若剧情走了某个节点的「偏转」分支，在 reason 里写明是哪个节点、怎么偏的。',
        '只输出一个 JSON 对象，不加说明：{"done":["节点名"],"stageDone":true或false,"reason":"一句话"}',
        'done 只填下方列表里出现过的节点名，原样照抄；stageDone 表示所有主线节点都已发生、剧情已进入下一段。',
    ].join('\n');
    const user = [
        `当前阶段：${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}`,
        range ? `时间范围：${range}` : '',
        '节点：',
        ...list,
        '',
        '最近正文：',
        ...floors.map(floor => `【第 ${floor.index} 楼】\n${floor.text}`),
    ].filter(line => line !== '').join('\n');
    return [{ role: 'system', content: system }, { role: 'user', content: user }];
}

export function parseCheckReply(text) {
    const raw = String(text || '');
    const start = raw.indexOf('{');
    const end = raw.lastIndexOf('}');
    if (start < 0 || end <= start) throw new Error('检测结果不是 JSON');
    let value;
    try {
        value = JSON.parse(raw.slice(start, end + 1));
    } catch {
        throw new Error('检测结果 JSON 无法解析');
    }
    const done = Array.isArray(value.done) ? value.done.map(item => String(item).trim()).filter(Boolean) : [];
    return { done, stageDone: value.stageDone === true || value.stageDone === 'true', reason: String(value.reason || '').trim() };
}

export { SIGNAL_TAG };
