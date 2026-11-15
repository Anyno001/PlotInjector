import { parseYaml, stringifyYaml } from './yaml.js';
import { isPlainObject, makeId, stageLabel, volumeLabel, NODE_FIELDS } from './outline.js';
import { clueText } from './clue-project.js';

import { compileClue } from './clue-rules.js';
import { outlineVolumesView } from './clue-model.js';

export const PROPOSAL_FENCE = /```\s*大纲改动\s*\n([\s\S]*?)```/;

export const PROPOSAL_KINDS = { 主线: '主线节点', 支线: '支线事件', 世界动态: '世界动态' };

export function hasOutlineProposal(text) {
    return PROPOSAL_FENCE.test(String(text || ''));
}

export function parseOutlineProposal(text) {
    let m = PROPOSAL_FENCE.exec(String(text || ''));
    if (!m) return { items: [], error: '回复里没有「大纲改动」代码块' };
    let data;
    try {
        data = parseYaml(m[1]);
    } catch (error) {
        return { items: [], error: `「大纲改动」不是合法的 YAML：${error.message}` };
    }
    let list = Array.isArray(data) ? data : isPlainObject(data) && Array.isArray(data.改动) ? data.改动 : null;
    if (!list) return { items: [], error: '「大纲改动」里应该是一个「改动」列表' };
    return {
        items: list.map((raw, i) => {
            let it = isPlainObject(raw) ? raw : {},
                action = String(it.动作 || '').trim(),
                field = PROPOSAL_KINDS[String(it.类别 || '主线').trim()] || '',
                pos = it.位置,
                out = {
                    i,
                    action,
                    stageId: String(it.阶段 || '').trim(),
                    field,
                    kind: String(it.类别 || '主线').trim(),
                    reason: clueText(it.理由),
                };
            if (!field) return { ...out, error: `类别「${it.类别}」不认识，只能是 主线 / 支线 / 世界动态` };
            if (!out.stageId) return { ...out, error: '没有写目标阶段的编号' };
            if (action === '插入') {
                if (!isPlainObject(it.节点) && typeof it.节点 != 'string') return { ...out, error: '插入缺少「节点」内容' };
                let where = 'end',
                    anchor = '';
                isPlainObject(pos)
                    ? pos.之前
                        ? ((where = 'before'), (anchor = String(pos.之前).trim()))
                        : pos.之后 && ((where = 'after'), (anchor = String(pos.之后).trim()))
                    : String(pos || '').trim() === '开头' && (where = 'start');
                return { ...out, where, anchor, node: it.节点 };
            }
            if (action === '排序')
                return Array.isArray(it.顺序)
                    ? { ...out, order: it.顺序.map((x) => String(x).trim()) }
                    : { ...out, error: '排序缺少「顺序」列表' };
            return { ...out, error: `动作「${action || '（空）'}」这一版还不支持，只能插入或同阶段排序` };
        }),
    };
}

export function proposalNodeRef(item) {
    return isPlainObject(item) && typeof item.id == 'string' ? item.id.trim() : '';
}

export function applyOutlineProposal(volumes, items, { picked = null, idOf = () => makeId('n'), isClue = !1 } = {}) {
    let use = items.filter((it) => !it.error && (!picked || picked.includes(it.i))),
        errors = [],
        changes = [],
        added = [];
    let next = JSON.parse(JSON.stringify(volumes || []));
    let stageOf = (id) => {
        for (let v of next) for (let s of v.stages) if (s.id === id) return { volume: v, stage: s };
        return null;
    };
    for (let it of use) {
        let hit = stageOf(it.stageId);
        if (!hit) {
            errors.push(`第 ${it.i + 1} 项：找不到阶段「${it.stageId}」（可能已被删除或移动）`);
            continue;
        }
        let data = isPlainObject(hit.stage.data) ? hit.stage.data : (hit.stage.data = {}),
            list = Array.isArray(data[it.field]) ? data[it.field] : (data[it.field] = []),
            place = `${stageLabel(hit.stage.key)}·${it.kind}`;
        if (it.action === '插入') {
            let node = isPlainObject(it.node) ? { ...it.node } : { 名称: String(it.node) };
            delete node.id;
            let id = idOf();
            ((node.id = id), added.push(id));
            let at = list.length;
            if (it.where === 'start') at = 0;
            else if (it.where !== 'end') {
                let k = list.findIndex((x) => proposalNodeRef(x) === it.anchor);
                if (k < 0) {
                    errors.push(`第 ${it.i + 1} 项：在${place}里找不到节点「${it.anchor}」`);
                    continue;
                }
                at = it.where === 'before' ? k : k + 1;
            }
            list.splice(at, 0, node);
            let name = clueText(node.名称) || clueText(node.内容) || id;
            changes.push({
                i: it.i,
                text: `在${place}${it.where === 'end' ? '末尾' : it.where === 'start' ? '开头' : `「${it.anchor}」${it.where === 'before' ? '之前' : '之后'}`}插入「${name}」`,
            });
            continue;
        }
        // 排序：顺序里必须恰好是这个列表现有的全部节点 id（不能借排序删节点或从别处搬节点）。
        let have = list.map(proposalNodeRef),
            missing = have.filter((x) => !it.order.includes(x)),
            extra = it.order.filter((x) => !have.includes(x));
        if (have.some((x) => !x)) {
            errors.push(`第 ${it.i + 1} 项：${place}里有还没有编号的节点，先打开一次执行页让插件补上编号再排序`);
            continue;
        }
        if (missing.length || extra.length || it.order.length !== have.length) {
            errors.push(
                `第 ${it.i + 1} 项：排序必须列出${place}现有的全部节点、不多不少${missing.length ? `（缺 ${missing.join('、')}）` : ''}${extra.length ? `（多了 ${extra.join('、')}，跨阶段移动这一版不支持）` : ''}`,
            );
            continue;
        }
        data[it.field] = it.order.map((id) => list[have.indexOf(id)]);
        changes.push({ i: it.i, text: `${place}重新排序：${it.order.join(' → ')}` });
    }
    // 线索模式：候选大纲要能编译、条件引用要能对上（勾选一部分时也要独立成立，GPT §19.2）。
    if (isClue && !errors.length) {
        let c = compileClue(next);
        errors.push(...c.errors.filter((e) => /引用了不存在的节点|条件/.test(e)));
    }
    return { ok: !errors.length && changes.length > 0, volumes: errors.length ? volumes : next, changes, errors, added };
}

export function outlineMapText(volumes, { focusStageId = '' } = {}) {
    let view = outlineVolumesView(volumes),
        lines = [];
    for (let v of view) {
        lines.push(`卷「${volumeLabel(v.key)}」`);
        for (let s of v.stages) {
            lines.push(`  阶段 ${s.id}「${stageLabel(s.key)}」`);
            for (let { field, label } of NODE_FIELDS) {
                let list = Array.isArray(s.data && s.data[field]) ? s.data[field] : [];
                list.length &&
                    lines.push(
                        `    ${label}：${list.map((x) => `${proposalNodeRef(x) || '（无编号）'}「${isPlainObject(x) ? clueText(x.名称 || x.内容) : clueText(x)}」`).join('、')}`,
                    );
            }
            if (s.id === focusStageId) {
                let shown = {};
                for (let [k, val] of Object.entries(s.data || {}))
                    shown[k] = Array.isArray(val) ? val.map((x) => (isPlainObject(x) ? (({ id, ...rest }) => rest)(x) : x)) : val;
                lines.push(
                    `    【这个阶段的完整内容】`,
                    ...stringifyYaml(shown)
                        .trimEnd()
                        .split('\n')
                        .map((l) => `    ${l}`),
                );
            }
        }
    }
    return lines.join('\n');
}

export function outlineStamp(volumes) {
    let s = JSON.stringify(volumes || []),
        h = 0;
    for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
    return `${s.length}:${(h >>> 0).toString(36)}`;
}
