// 跑团人物档案：导入长文时整理出的人物（外貌、性格、口吻、态度、底线），按人设线存进项目，
// 关键词（名字、别名）出现在最近正文里才注入，防止人物写偏（OOC）。
// 只收玩家能看到的部分；真实身份、动机、名字保密的人一律不收，那些留在 KP 规则里。
import { isPlainObject } from '../core/outline.js';
import { newLine, newStage } from '../core/personas.js';

export const PEOPLE_GROUP = '人物档案';
export const PROFILE_KEYS = ['外貌', '性格', '口吻', '对玩家的态度', '底线', '台词'];

const profText = (v) =>
    (Array.isArray(v) ? v.map((x) => String(x ?? '').trim()).filter(Boolean).join('；') : String(v ?? '').trim()).replace(/\s*\n\s*/g, '；');
const isSecret = (p) => p.名字保密 === !0 || p.名字保密 === 'true' || p.名字保密 === '是';

// 多段里同一个人的同一项：不同的描述都留下（去重，限长）；台词最多留三句
export function mergeProfileField(key, old, add) {
    let a = profText(old),
        b = profText(add);
    if (!b || a === b) return a;
    if (!a) return b;
    let parts = [...new Set([...a.split('；'), ...b.split('；')].filter(Boolean))];
    return key === '台词' ? parts.slice(0, 3).join('；') : parts.join('；').slice(0, 240);
}

export function profileText(p) {
    let name = String(p.名称 || '').trim(),
        pick = (k) => profText(p[k]),
        parts = [
            pick('公开身份') && `公开身份：${pick('公开身份')}`,
            pick('外貌') && `外貌：${pick('外貌')}`,
            pick('性格') && `性格：${pick('性格')}`,
            pick('口吻') && `说话方式：${pick('口吻')}`,
            pick('对玩家的态度') && `对玩家的态度：${pick('对玩家的态度')}`,
            pick('底线') && `底线：${pick('底线')}`,
            pick('台词') && `台词示例：${pick('台词')}`,
        ].filter(Boolean);
    // 只有身份没有别的内容，不值得单独注入
    return parts.length > (pick('公开身份') ? 1 : 0) ? `【${name}】出场时按下面的档案写，性格、口吻和底线不要偏离。\n${parts.join('\n')}` : '';
}

export function peopleKeys(p) {
    return [...new Set([p.名称, ...(Array.isArray(p.别名) ? p.别名 : [])].map((x) => String(x || '').trim()).filter((x) => x.length >= 2))];
}

// 从导入索引生成人设线；seen 是之前处理过的名字（用户删掉的不会再回来）。返回 { lines, names }
export function peopleLines(index, existing = [], seen = []) {
    let people = index && Array.isArray(index.人物) ? index.人物 : [],
        have = new Set([...seen, ...existing.flatMap((l) => [l.name, ...(l.keys || [])])]),
        lines = [],
        names = [];
    for (let p of people) {
        if (!isPlainObject(p) || !p.名称 || isSecret(p)) continue;
        let name = String(p.名称).trim(),
            text = profileText(p),
            keys = peopleKeys(p);
        if (!text || !keys.length || have.has(name)) continue;
        let line = newLine(name, PEOPLE_GROUP);
        lines.push({ ...line, keys, constant: !1, stages: [{ ...newStage('档案'), text }] });
        names.push(name);
        have.add(name);
    }
    return { lines, names };
}
