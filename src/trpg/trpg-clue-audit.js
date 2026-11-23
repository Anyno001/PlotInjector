import { authorSegments, nodeUid, stripAuthorBlocks, outlineStageData } from './trpg-clue-model.js';
import { isPlainObject, flattenUnits, stageLabel, NODE_FIELDS, stageNodes } from '../core/outline.js';

import { discoveryList } from './trpg-clue-project.js';

export const AUDIT_MIN = 8;

export const AUDIT_SAMPLE = 16;

export const AUDIT_MAX_PER_SOURCE = 6;

export function normText(text) {
    return String(text || '').replace(/\s+/g, '');
}

export function fingerprints(text) {
    let flat = normText(text);
    if (flat.length < AUDIT_MIN) return [];
    if (flat.length <= AUDIT_SAMPLE + 4) return [flat];
    let parts = String(text || '')
            .split(/[。！？!?；;\r\n]+/)
            .map(normText)
            .filter((s) => s.length >= AUDIT_MIN),
        out = [];
    for (let s of parts) {
        if (out.length >= AUDIT_MAX_PER_SOURCE) break;
        out.push(s.slice(0, AUDIT_SAMPLE));
    }
    return out.length ? out : [flat.slice(0, AUDIT_SAMPLE)];
}

export function authorBlocks(text) {
    return authorSegments(text);
}

export function fieldText(value) {
    return value == null ? '' : typeof value == 'string' ? value : JSON.stringify(value);
}

export function restrictedSources(project, state, isRevealed = () => !1) {
    let out = [],
        focusUid = state && state.focus ? state.focus.uid : '',
        add = (label, text, scope) => {
            let prints = fingerprints(text);
            prints.length && out.push({ label, prints, scope });
        };
    for (let block of authorBlocks(project.setting && project.setting.text)) add('设定·<仅作者>', block, 'author');
    // 卷名、阶段名、字段名上的作者块也建指纹（15.3）：它们被别的来源带进请求时也要报警。
    let keyBlocks = (obj, where) => {
        if (Array.isArray(obj)) return obj.forEach((x) => keyBlocks(x, where));
        if (!isPlainObject(obj)) return;
        for (let [k, v] of Object.entries(obj)) {
            for (let block of authorBlocks(k)) add(`${where}·字段名·<仅作者>`, block, 'author');
            keyBlocks(v, where);
        }
    };
    let seenVol = /* @__PURE__ */ new Set();
    for (let unit of flattenUnits(project.outline && project.outline.volumes)) {
        let data = isPlainObject(unit.stage.data) ? unit.stage.data : {},
            where = stageLabel(unit.stage.key);
        seenVol.has(unit.volume) ||
            (seenVol.add(unit.volume), authorBlocks(unit.volume.key).forEach((b) => add('卷名·<仅作者>', b, 'author')));
        for (let block of authorBlocks(unit.stage.key)) add(`${where}·阶段名·<仅作者>`, block, 'author');
        keyBlocks(data, where);
        add(`${where}·作者备注`, data.作者备注, 'author');
        for (let [key, value] of Object.entries(data))
            if (!NODE_FIELDS.some((f) => f.field === key))
                for (let block of authorBlocks(fieldText(value))) add(`${where}·${key}·<仅作者>`, block, 'author');
        for (let node of stageNodes(data)) {
            let item = isPlainObject(node.item) ? node.item : {},
                uid = nodeUid(item),
                place = `${where}·${node.name}`,
                isFocus = !!uid && uid === focusUid;
            add(`${place}·作者备注`, item.作者备注, 'author');
            for (let key of Object.keys(item))
                for (let block of authorBlocks(fieldText(item[key]))) add(`${place}·${key}·<仅作者>`, block, 'author');
            if (isFocus) continue;
            add(`${place}·场景`, stripAuthorBlocks(item.场景), 'unrevealed');
            for (let d of discoveryList(item)) (d.fact && isRevealed(d.fact)) || add(`${place}·发现`, d.text, 'unrevealed');
        }
    }
    return out;
}

export function restrictedNames(project) {
    let out = [];
    for (let unit of flattenUnits(project.outline && project.outline.volumes))
        for (let node of stageNodes(unit.stage.data)) {
            let name = normText(node.name);
            name.length >= 4 && out.push({ label: `${stageLabel(unit.stage.key)}·${node.name}·名称`, print: name });
        }
    return out;
}

export function countOccurrences(hay, needle) {
    if (!needle) return 0;
    let n = 0,
        at = 0;
    for (; (at = hay.indexOf(needle, at)) >= 0;) ((n += 1), (at += needle.length));
    return n;
}

// places：{ setting, tables } 原文，用来说明命中的内容在哪（用户 2026-11-23：只说「不是注入器带进去的」，看完不知道怎么修）
export function auditRequest(requestText, project, state, projection, { history = [], isRevealed, places = {} } = {}) {
    let hay = normText(requestText),
        leaks = [],
        strip = (text, piece) => (piece && piece.length >= AUDIT_MIN ? text.split(piece).join('') : text);
    // 本轮投影里合法出现的内容不算泄露：先把投影从请求里抠掉再查（投影本身已经过白名单）。
    let projFlat = normText(projection || ''),
        scan = strip(hay, projFlat),
        scanNoHistory = scan;
    for (let text of history) scanNoHistory = strip(scanNoHistory, normText(text));
    for (let src of restrictedSources(project, state, isRevealed)) {
        let where = src.scope === 'author' ? scan : scanNoHistory,
            hit = src.prints.find((p) => where.includes(p));
        hit && leaks.push({ source: src.label, sample: hit, level: 'leak', where: leakPlace(hit, places) });
    }
    for (let n of restrictedNames(project))
        scanNoHistory.includes(n.print) && leaks.push({ source: n.label, sample: n.print, level: 'hint' });
    let projectionCount = projFlat ? countOccurrences(hay, projFlat) : 0;
    return { leaks, projectionCount, duplicated: projectionCount > 1, chars: hay.length };
}

export function leakPlace(hit, { setting = '', tables = '' } = {}) {
    return setting && normText(setting).includes(hit) ? 'setting' : tables && normText(tables).includes(hit) ? 'table' : '';
}

export function auditOutlineRequest(requestText, project, states, projection, { history = [] } = {}) {
    let hay = normText(requestText),
        leaks = [],
        strip = (text, piece) => (piece && piece.length >= AUDIT_MIN ? text.split(piece).join('') : text);
    // 从长到短扣（返修复审）：短条目（设定）可能正好是长条目（阶段）里的一句，先扣短的会把长条目截断，后面就扣不掉了。
    let pieces = (Array.isArray(projection) ? projection : [projection])
            .map(normText)
            .filter((p) => p.length >= AUDIT_MIN)
            .sort((a, b) => b.length - a.length),
        scan = hay;
    for (let p of pieces) {
        let at = scan.indexOf(p);
        at >= 0 && (scan = scan.slice(0, at) + '\n' + scan.slice(at + p.length));
    }
    let scanNoHistory = scan;
    for (let text of history) scanNoHistory = strip(scanNoHistory, normText(text));
    for (let src of restrictedSources(project, null).filter((s) => s.scope === 'author')) {
        let hit = src.prints.find((p) => scan.includes(p));
        hit && leaks.push({ source: src.label, sample: hit, level: 'leak' });
    }
    for (let unit of flattenUnits(project.outline && project.outline.volumes)) {
        let state = states && states[unit.id];
        if (state !== 'next' && state !== 'todo') continue;
        let where = stageLabel(unit.stage.key),
            view = outlineStageData(isPlainObject(unit.stage.data) ? unit.stage.data : {}),
            seen = /* @__PURE__ */ new Set();
        let add = (label, text) => {
            for (let p of fingerprints(stripAuthorBlocks(fieldText(text))))
                if (!seen.has(p) && scanNoHistory.includes(p))
                    return (seen.add(p), leaks.push({ source: `还没到的${where}·${label}`, sample: p, level: 'leak' }));
        };
        add('AI指令', view.AI指令);
        for (let node of stageNodes(view)) {
            let item = isPlainObject(node.item) ? node.item : { 名称: node.item },
                keys = ['事件', '偏转', '触发', '内容'];
            for (let k of keys) item[k] && add(`${node.name || '节点'}·${k}`, item[k]);
            // 只写了一行字符串的节点（保存后只剩名称和 id）：名称本身就是剧情句子，按名称查。一般短标题不查（内测前审阅）。
            keys.some((k) => item[k]) || normText(stripAuthorBlocks(node.name)).length < 12 || add('节点', node.name);
        }
    }
    let projectionCount = pieces.length ? Math.min(...pieces.map((p) => countOccurrences(hay, p))) : 0;
    return { leaks, projectionCount, duplicated: projectionCount > 1, chars: hay.length };
}

export function requestToText(payload) {
    if (payload == null) return '';
    if (typeof payload == 'string') return payload;
    if (Array.isArray(payload))
        return payload
            .map((m) =>
                typeof m == 'string'
                    ? m
                    : m && typeof m.content == 'string'
                      ? m.content
                      : Array.isArray(m && m.content)
                        ? m.content.map((p) => (p && p.text) || '').join('\n')
                        : '',
            )
            .join('\n');
    if (isPlainObject(payload)) return requestToText(payload.chat || payload.messages || payload.prompt || payload.finalPrompt || '');
    return '';
}
