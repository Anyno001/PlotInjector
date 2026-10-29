// TavernDB-ACU 数据库插件写入的世界书条目。条目会随游玩新增、重写，所以屏蔽不改世界书，
// 而是记在设置里，每轮世界书扫描前从候选条目中去掉。
// 规则：先看单条覆盖（按条目名），没有就按所属字段的默认值；同一字段新增的条目自动跟随。
export const ACU = /^TavernDB-ACU/i;
const CUSTOM = /^TavernDB-ACU-CustomExport-/i;
// 中文字段类：TavernDB-ACU-CustomExport-中文字段-数字/包裹/上下；去掉末尾那一段就是字段名
const TAIL = /-(?:\d+|包裹|上|下)$/;
const EN_FIELD = '英文字段';

export const DEFAULT_ACU = { fields: {}, overrides: {} };

// 中文字段返回字段名（如「剧情纪要」），其余数据库条目归入「英文字段」，非数据库条目返回空串。
export function acuField(title) {
    const name = String(title || '');
    if (!ACU.test(name)) return '';
    const rest = name.replace(CUSTOM, '');
    if (rest === name || !/^[一-鿿]/.test(rest)) return EN_FIELD;
    return rest.replace(TAIL, '') || rest;
}

export const isAcuCn = field => Boolean(field) && field !== EN_FIELD;
export { EN_FIELD };

export function normalizeAcu(value) {
    const src = value && typeof value === 'object' ? value : {};
    const fields = {};
    const overrides = {};
    if (src.fields && typeof src.fields === 'object') {
        for (const [name, blocked] of Object.entries(src.fields)) if (name && blocked === true) fields[name] = true;
    }
    if (src.overrides && typeof src.overrides === 'object') {
        for (const [name, blocked] of Object.entries(src.overrides)) if (acuField(name) && typeof blocked === 'boolean') overrides[name] = blocked;
    }
    return { fields, overrides };
}

export function acuBlocked(acu, title) {
    const field = acuField(title);
    if (!field) return false;
    const name = String(title);
    return Object.prototype.hasOwnProperty.call(acu.overrides, name) ? acu.overrides[name] : Boolean(acu.fields[field]);
}

// 单条改动：和字段默认一致就去掉覆盖，避免越积越多。
export function setAcuEntry(acu, title, blocked) {
    const field = acuField(title);
    if (!field) return acu;
    const overrides = { ...acu.overrides };
    if (Boolean(acu.fields[field]) === blocked) delete overrides[title];
    else overrides[title] = blocked;
    return { ...acu, overrides };
}

// 整个字段改动：设字段默认，并清掉这个字段的单条覆盖。
export function setAcuField(acu, field, blocked) {
    const fields = { ...acu.fields };
    if (blocked) fields[field] = true;
    else delete fields[field];
    const overrides = {};
    for (const [name, value] of Object.entries(acu.overrides)) if (acuField(name) !== field) overrides[name] = value;
    return { fields, overrides };
}

// 从世界书扫描候选里去掉被屏蔽的条目（原地改数组，酒馆随后用的就是这几个数组）。
export function filterAcuLore(acu, payload) {
    let removed = 0;
    for (const key of ['globalLore', 'characterLore', 'chatLore', 'personaLore']) {
        const list = payload && payload[key];
        if (!Array.isArray(list)) continue;
        for (let i = list.length - 1; i >= 0; i -= 1) {
            if (list[i] && acuBlocked(acu, list[i].comment)) { list.splice(i, 1); removed += 1; }
        }
    }
    return removed;
}
