import { isPlainObject, NODE_FIELDS, nodeProgressId, makeId, STABLE_PREFIX, flattenUnits, stageNodes } from './outline.js';

export const SCHEMA_VERSION = 2;

export const PLOT_MODES = [
    { value: 'outline', label: '大纲推进' },
    { value: 'clue', label: '线索推进' },
];

export const CLUE_INJECT_MODES = [
    { value: 'worldbook', label: '临时世界书' },
    { value: 'link', label: '（旧选项，已统一为临时世界书）' },
];

export const CLUE_NODE_KEYS = ['id', '必需', '开放条件', '提前条件', '完成条件', '入口', '场景', '发现', '场景值', '作者备注', '相关事实'];

export const CLUE_STAGE_KEYS = ['进入条件', '结束条件', '作者备注'];

export const AUTHOR_TAG = /<(\/?)仅作者>/g;

export function stripAuthorBlocks(text) {
    let src = String(text || ''),
        out = '',
        depth = 0,
        last = 0,
        m;
    AUTHOR_TAG.lastIndex = 0;
    for (; (m = AUTHOR_TAG.exec(src));) {
        (depth === 0 && (out += src.slice(last, m.index)),
            m[1] ? (depth = Math.max(0, depth - 1)) : depth++,
            (last = AUTHOR_TAG.lastIndex));
    }
    return (depth === 0 && (out += src.slice(last)), out.replace(/\n{3,}/g, '\n\n').trim());
}

export function authorSegments(text) {
    let src = String(text || ''),
        segs = [],
        depth = 0,
        start = 0,
        m;
    AUTHOR_TAG.lastIndex = 0;
    for (; (m = AUTHOR_TAG.exec(src));) {
        if (m[1]) {
            if (depth === 0) continue;
            (depth--, depth === 0 && segs.push(src.slice(start, m.index)));
        } else depth++ === 0 && (start = AUTHOR_TAG.lastIndex);
    }
    return (depth > 0 && segs.push(src.slice(start)), segs.map((x) => x.replace(AUTHOR_TAG, '').trim()).filter(Boolean));
}

export function wrapAuthorText(text) {
    let body = String(text || '')
        .replace(AUTHOR_TAG, '')
        .trim();
    return body
        ? `<仅作者>
${body}
</仅作者>`
        : '';
}

export function stripAuthorDeep(value) {
    if (typeof value == 'string') return hasAuthorBlocks(value) || /<\/仅作者>/.test(value) ? stripAuthorBlocks(value) : value;
    if (Array.isArray(value)) return value.map(stripAuthorDeep);
    if (isPlainObject(value)) {
        // 键名也剥离（W2）：整个键名都是作者块的，连同它的值一起丢掉。
        // 剥离后重名时，原名本来就是这个名字的公开字段优先（15.3）；用只看自身键的方式判重，「constructor」等键名不会被误判。
        let out = {},
            own = (o, k) => Object.prototype.hasOwnProperty.call(o, k),
            exact = new Set(Object.keys(value).filter((k) => !/<\/?仅作者>/.test(k)));
        for (let [k, v] of Object.entries(value)) {
            let key = stripAuthorDeep(k);
            if (!key) continue;
            let isExact = k === key;
            if (!isExact && exact.has(key)) continue;
            own(out, key) || Object.defineProperty(out, key, { value: stripAuthorDeep(v), enumerable: !0, writable: !0, configurable: !0 });
        }
        return out;
    }
    return value;
}

export function hasAuthorBlocks(text) {
    return /<仅作者>/.test(String(text || ''));
}

export function nodeUid(item) {
    return isPlainObject(item) && typeof item.id == 'string' && item.id.trim() ? item.id.trim() : '';
}

export function outlineStageData(data, offIds = null) {
    if (!isPlainObject(data)) return data;
    let out = {},
        off = offIds ? new Set(offIds) : null;
    for (let [key, value] of Object.entries(data)) {
        if (CLUE_STAGE_KEYS.includes(key)) continue;
        let meta2 = NODE_FIELDS.find((item) => item.field === key);
        if (!meta2 || !Array.isArray(value)) {
            out[key] = value;
            continue;
        }
        let list = value
            .filter((item, index) => !off || !off.has(nodeProgressId(item, meta2.prefix, index)))
            .map((item) => {
                if (!isPlainObject(item)) return item;
                let copy = {};
                for (let [k, v] of Object.entries(item)) CLUE_NODE_KEYS.includes(k) || (copy[k] = v);
                let keys = Object.keys(copy);
                return keys.length === 1 && keys[0] === '名称' && typeof copy.名称 == 'string' && nodeUid(item) ? copy.名称 : copy;
            });
        (off && !list.length) || (out[key] = list);
    }
    return out;
}

export function outlineVolumesView(volumes) {
    let clean = (key, fallback) => stripAuthorDeep(String(key || '')) || fallback;
    return (volumes || []).map((volume, vi) => ({
        ...volume,
        key: clean(volume.key, `剧情_卷${vi + 1}`),
        stages: volume.stages.map((stage, si) => ({
            ...stage,
            key: clean(stage.key, `阶段${si + 1}`),
            data: keepNodeIds(stage.data, stripAuthorDeep(outlineStageData(stage.data))),
        })),
    }));
}

export function keepNodeIds(raw, view) {
    if (!isPlainObject(raw) || !isPlainObject(view)) return view;
    let out = { ...view };
    for (let { field } of NODE_FIELDS) {
        if (!Array.isArray(raw[field]) || !Array.isArray(view[field])) continue;
        out[field] = view[field].map((item, i) => {
            let id = nodeUid(raw[field][i]);
            return id ? (isPlainObject(item) ? { ...item, id } : { 名称: item, id }) : item;
        });
    }
    return out;
}

export function withNodeIds(volumes, idOf = () => makeId('n')) {
    let changed = !1,
        next = (volumes || []).map((volume) => {
            let volChanged = !1,
                stages = volume.stages.map((stage) => {
                    let data = stage.data,
                        stageChanged = !1;
                    if (!isPlainObject(data)) return stage;
                    let patch = {};
                    for (let { field } of NODE_FIELDS) {
                        if (!Array.isArray(data[field])) continue;
                        let listChanged = !1,
                            list = data[field].map((item) =>
                                isPlainObject(item) && !nodeUid(item) ? ((listChanged = !0), { ...item, id: idOf() }) : item,
                            );
                        listChanged && ((patch[field] = list), (stageChanged = !0));
                    }
                    return stageChanged ? ((volChanged = !0), { ...stage, data: { ...data, ...patch } }) : stage;
                });
            return volChanged ? ((changed = !0), { ...volume, stages }) : volume;
        });
    return changed ? next : volumes;
}

export function ensureOutlineIds(volumes, legacyMap, idOf = () => makeId('n')) {
    let map = isPlainObject(legacyMap) ? legacyMap : {},
        newMap = { ...map },
        changed = !1,
        mapChanged = !1;
    let next = (volumes || []).map((volume) => {
        let volChanged = !1,
            stages = volume.stages.map((stage) => {
                let data = stage.data;
                if (!isPlainObject(data)) return stage;
                let patch = {},
                    stageChanged = !1,
                    entries = {};
                for (let { field, prefix } of NODE_FIELDS) {
                    if (!Array.isArray(data[field])) continue;
                    let listChanged = !1,
                        list = data[field].map((item, index) => {
                            let old = `${prefix}${index}`;
                            if (isPlainObject(item) && nodeUid(item)) return ((entries[old] = nodeUid(item)), item);
                            if (item == null || (isPlainObject(item) === !1 && typeof item != 'string')) return item;
                            let id = idOf();
                            return (
                                (listChanged = !0),
                                (entries[old] = id),
                                isPlainObject(item) ? { ...item, id } : { 名称: String(item), id }
                            );
                        });
                    listChanged && ((patch[field] = list), (stageChanged = !0));
                }
                // 只在这个阶段第一次出现补 id 时记映射（已有映射的阶段不覆盖：映射代表最早的顺序）。
                stageChanged && !map[stage.id] && ((newMap[stage.id] = entries), (mapChanged = !0));
                return stageChanged ? ((volChanged = !0), { ...stage, data: { ...data, ...patch } }) : stage;
            });
        return volChanged ? ((changed = !0), { ...volume, stages }) : volume;
    });
    return { volumes: changed ? next : volumes, legacyMap: mapChanged ? newMap : map, changed: changed || mapChanged };
}

export const LEGACY_NODE_ID = /^[msw]\d+$/;

export function migrateOutlineProgress(progress, legacyMap) {
    let map = isPlainObject(legacyMap) ? legacyMap : {},
        slots = (progress && progress.slots) || {},
        out = {},
        migrated = 0,
        dropped = 0,
        touched = !1;
    for (let [unitId, slot] of Object.entries(slots)) {
        if (!slot || !Array.isArray(slot.off) || !slot.off.some((x) => LEGACY_NODE_ID.test(String(x)))) {
            out[unitId] = slot;
            continue;
        }
        touched = !0;
        let m = map[unitId] || {},
            off = [];
        for (let id of slot.off) {
            if (!LEGACY_NODE_ID.test(String(id))) {
                off.push(id);
                continue;
            }
            m[id] ? (off.push(`${STABLE_PREFIX}${m[id]}`), migrated++) : dropped++;
        }
        out[unitId] = { ...slot, off: [...new Set(off)] };
    }
    return touched
        ? { progress: { ...progress, slots: out, droppedLegacy: (Number(progress.droppedLegacy) || 0) + dropped }, migrated, dropped }
        : { progress, migrated: 0, dropped: 0 };
}

export function clueNodes(volumes) {
    let out = [];
    for (let unit of flattenUnits(volumes))
        for (let node of stageNodes(unit.stage.data)) out.push({ ...node, uid: nodeUid(node.item), unit });
    return out;
}

export function duplicateNodeIds(volumes) {
    let seen = /* @__PURE__ */ new Map(),
        dups = /* @__PURE__ */ new Map();
    for (let node of clueNodes(volumes)) {
        if (!node.uid) continue;
        seen.has(node.uid) ? dups.set(node.uid, [...(dups.get(node.uid) || [seen.get(node.uid)]), node]) : seen.set(node.uid, node);
    }
    return [...dups].map(([uid, nodes]) => ({ uid, nodes }));
}

export const NODE_COND_KEYS = ['开放条件', '提前条件', '完成条件'];

export const STAGE_COND_KEYS = ['进入条件', '结束条件'];

export function remapNodeRefs(value, map) {
    if (typeof value == 'string') {
        let m = /^(\s*节点\s*[:：]\s*)(\S+)(\s*)$/.exec(value);
        return m && map.has(m[2]) ? `${m[1]}${map.get(m[2])}${m[3]}` : value;
    }
    if (Array.isArray(value)) return value.map((item) => remapNodeRefs(item, map));
    if (isPlainObject(value)) {
        let out = {};
        for (let [k, v] of Object.entries(value))
            out[k] = k === '节点' && typeof v == 'string' && map.has(v.trim()) ? map.get(v.trim()) : remapNodeRefs(v, map);
        return out;
    }
    return value;
}

export function reidConflicts(incoming, existingVolumes) {
    let taken = new Set(
            clueNodes(existingVolumes)
                .map((node) => node.uid)
                .filter(Boolean),
        ),
        own = clueNodes(incoming)
            .map((node) => node.uid)
            .filter(Boolean),
        dup = own.find((uid, i) => own.indexOf(uid) !== i);
    if (dup) throw new Error(`导入内容里节点 ID「${dup}」重复，无法确定条件引用指向哪个节点，请先修正`);
    let map = /* @__PURE__ */ new Map();
    for (let uid of own) taken.has(uid) && map.set(uid, makeId('n'));
    if (!map.size) return [incoming, []];
    let fixNode = (item) => {
        if (!isPlainObject(item)) return item;
        let out = { ...item },
            uid = nodeUid(item);
        uid && map.has(uid) && (out.id = map.get(uid));
        for (let key of NODE_COND_KEYS) key in out && (out[key] = remapNodeRefs(out[key], map));
        return out;
    };
    return [
        incoming.map((volume) => ({
            ...volume,
            stages: volume.stages.map((stage) => {
                if (!isPlainObject(stage.data)) return stage;
                let data = { ...stage.data };
                for (let key of STAGE_COND_KEYS) key in data && (data[key] = remapNodeRefs(data[key], map));
                for (let { field } of NODE_FIELDS) Array.isArray(data[field]) && (data[field] = data[field].map(fixNode));
                return { ...stage, data };
            }),
        })),
        [...map.keys()],
    ];
}

export const DEFAULT_CLUE = {
    mode: 'outline',
    inject: 'worldbook',
    autoFocusSingle: !0,
    bindings: { switch: null, facts: [], knowledge: [], scene: null, time: null },
    facts: [],
};

export function normalizeBinding(value, keys) {
    if (!isPlainObject(value)) return null;
    let out = {};
    for (let key of keys) value[key] !== void 0 && value[key] !== null && value[key] !== '' && (out[key] = value[key]);
    return Object.keys(out).length ? out : null;
}

export const FACT_BINDING_KEYS = ['表', '编号列', '状态列', '已核实值', '说法值', '内容列', '来源列'];

export const KNOW_BINDING_KEYS = ['表', '事实列', '角色列', '方式列', '可信度列', '已核实值', '来源列', '未知值', '有效值'];

export const CELL_BINDING_KEYS = ['路径', '开启值', '离场值'];

export function normalizeClue(value) {
    let src = isPlainObject(value) ? value : {},
        b = isPlainObject(src.bindings) ? src.bindings : {},
        list = (v, keys) =>
            (Array.isArray(v) ? v : v ? [v] : []).map((item) => normalizeBinding(item, keys)).filter((item) => item && item.表);
    return {
        mode: PLOT_MODES.some((item) => item.value === src.mode) ? src.mode : DEFAULT_CLUE.mode,
        inject: CLUE_INJECT_MODES.some((item) => item.value === src.inject) ? src.inject : DEFAULT_CLUE.inject,
        // 联动路径下，本轮开始前等待上一轮填表提交（默认开）。
        waitFill: src.waitFill !== !1,
        autoFocusSingle: src.autoFocusSingle !== !1,
        bindings: {
            switch: normalizeBinding(b.switch, CELL_BINDING_KEYS),
            facts: list(b.facts, FACT_BINDING_KEYS),
            knowledge: list(b.knowledge, KNOW_BINDING_KEYS),
            scene: normalizeBinding(b.scene, CELL_BINDING_KEYS),
            time: normalizeTimeBinding(b.time),
        },
        facts: (Array.isArray(src.facts) ? src.facts : [])
            .filter((item) => isPlainObject(item) && String(item.id || '').trim())
            .map((item) => ({ id: String(item.id).trim(), 说明: String(item.说明 || '') })),
    };
}

export function normalizeTimeBinding(value) {
    if (!isPlainObject(value)) return null;
    let paths = (Array.isArray(value.路径) ? value.路径 : [value.路径]).map((x) => String(x ?? '').trim()).filter(Boolean);
    return paths.length ? { 路径: paths.length === 1 ? paths[0] : paths } : null;
}

export function isClueMode(project) {
    return !!(project && project.clue && project.clue.mode === 'clue');
}
