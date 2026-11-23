import { NO_LINKS, resolveOff } from './align.js';
import { normalizeInfiniteProgress } from './infinite-flow.js';
import { normalizePersonaProgress } from './persona-progress.js';

// 进度随聊天存在 chat_metadata.plotInjector；这里只做纯计算，所有函数返回新对象，不原地改。
export const SETTING_SLOT = '@setting';
export const STATES = ['done', 'active', 'next', 'todo'];
export const STATE_LABELS = { done: '已过', active: '进行中', next: '下一段', todo: '未到' };

export function emptyProgress(projectId) {
    return { projectId, current: null, slots: {}, lastCheckFloor: 0, muted: [], offMuted: [], pace: 'normal' };
}

export function normalizeProgress(value, projectId) {
    const base = emptyProgress(projectId);
    if (!value || typeof value !== 'object') return base;
    const infinite = value.infinite && typeof value.infinite === 'object' ? { infinite: normalizeInfiniteProgress(value.infinite) } : {};
    const out = {
        ...base,
        ...value,
        ...infinite,
        slots: value.slots && typeof value.slots === 'object' ? value.slots : {},
        muted: Array.isArray(value.muted) ? value.muted : [],
        offMuted: Array.isArray(value.offMuted) ? value.offMuted : [],
        lastCheckFloor: Number(value.lastCheckFloor) || 0,
        pace: ['slow', 'normal', 'fast'].includes(value.pace) ? value.pace : 'normal',
    };
    // 人设进度只在聊天里用过人设时才有这个字段，旧进度原样不动。
    if (value.personas && typeof value.personas === 'object') out.personas = normalizePersonaProgress(value.personas);
    // lastFailFloor：上次检测失败时的楼数，只用来控制重试间隔；成功检测后删掉。
    if (Number(out.lastFailFloor) > 0) out.lastFailFloor = Number(out.lastFailFloor);
    else delete out.lastFailFloor;
    return out;
}

// 距上次检测的楼数按这个起点算：成功检测的楼数与检测失败时的楼数取大的，失败后照样隔 N 楼再试。
export function checkBase(progress) {
    return Math.max(Number(progress && progress.lastCheckFloor) || 0, Number(progress && progress.lastFailFloor) || 0);
}

// links 见 core/align.js：current 是旧阶段 id（合并等操作换掉的）时沿别名表解析成新 id。
export function currentIndex(units, progress, links = NO_LINKS) {
    if (!units.length) return -1;
    const found = units.findIndex((unit) => unit.id === progress.current);
    if (found >= 0) return found;
    const to = progress.current ? links.resolve(progress.current) : '';
    const aliased = to ? units.findIndex((unit) => unit.id === to) : -1;
    return aliased >= 0 ? aliased : 0;
}

export function unitStates(units, progress, links = NO_LINKS) {
    const cur = currentIndex(units, progress, links);
    const states = {};
    units.forEach((unit, index) => {
        const derived = index < cur ? 'done' : index === cur ? 'active' : index === cur + 1 ? 'next' : 'todo';
        const manual = progress.slots[unit.id] && progress.slots[unit.id].state;
        states[unit.id] = STATES.includes(manual) ? manual : derived;
    });
    return states;
}

export function patchSlot(progress, slotId, patch) {
    const prev = progress.slots[slotId] || {};
    const next = { ...prev, ...patch };
    for (const key of Object.keys(next)) if (next[key] === undefined) delete next[key];
    return { ...progress, slots: { ...progress.slots, [slotId]: next } };
}

// 已演（取消勾选）的节点 id。所有读 slots.off 的地方都走这里：传入单元（带 stage）时按 offNames 记的节点名对回当前位置，
// 节点挪动、改名（links 带改名链）、阶段换 id 后照样对得上；只传阶段 id 时按位置原样读（只用于写入前取原列表）。
export function offNodes(progress, unit, links = NO_LINKS) {
    if (unit && typeof unit === 'object') return resolveOff(progress.slots, unit, links);
    const slot = progress.slots[unit];
    return slot && Array.isArray(slot.off) ? slot.off : [];
}

// name：节点名，写进 offNames，其他聊天按名称找回；不传时只记位置（旧行为）。
export function setNodeChecked(progress, unitId, nodeId, checked, name = '') {
    const slot = progress.slots[unitId] || {};
    const off = new Set(Array.isArray(slot.off) ? slot.off : []);
    const names = slot.offNames && typeof slot.offNames === 'object' ? { ...slot.offNames } : {};
    if (checked) {
        off.delete(nodeId);
        delete names[nodeId];
    } else {
        off.add(nodeId);
        if (name) names[nodeId] = name;
    }
    const keepNames = Object.keys(names).length || slot.offNames;
    return patchSlot(progress, unitId, { off: [...off], offNames: keepNames ? names : undefined });
}

// 只按节点名取消勾选；未知名称忽略。
export function uncheckByNames(progress, unitId, nodes, names) {
    const wanted = new Set((names || []).map((name) => String(name).trim()).filter(Boolean));
    const counts = new Map();
    for (const node of nodes) counts.set(node.name, (counts.get(node.name) || 0) + 1);
    let next = progress;
    for (const node of nodes)
        if (wanted.has(node.name) && counts.get(node.name) === 1) next = setNodeChecked(next, unitId, node.id, false, node.name);
    return next;
}

// 按线改写用的跳段（大型项目方案 十.3）：只清 only 里这些阶段的手动状态，别的线不动；
// 返回 { next, changes }，changes 记下实际改过的字段（current，以及各 slots[阶段].state 的前后值，原来没有记 undefined），撤销只还原这些。
export function goToIn(progress, unitId, only) {
    const slots = { ...progress.slots },
        changes = { current: [progress.current, unitId], slots: {} };
    for (const id of only || []) {
        if (slots[id] && slots[id].state !== void 0) {
            const { state, ...rest } = slots[id];
            changes.slots[id] = [state, void 0];
            slots[id] = rest;
        }
    }
    return { next: { ...progress, current: unitId, slots }, changes };
}

// 撤销 goToIn 的改动：只有字段仍是当时写出的值才还原；之后又被改过的字段保留现在的。
export function undoGoToIn(progress, changes) {
    if (!changes) return progress;
    let next = progress;
    if (progress.current === changes.current[1]) next = { ...next, current: changes.current[0] };
    for (const [id, [was, wrote]] of Object.entries(changes.slots || {})) {
        const cur = next.slots && next.slots[id];
        if ((cur ? cur.state : void 0) !== wrote) continue;
        next = { ...next, slots: { ...next.slots, [id]: { ...(cur || {}), ...(was === void 0 ? {} : { state: was }) } } };
    }
    return next;
}

// 撤销改写时，改写后才有的阶段 id 对回原来的阶段：同一卷（卷 id）里阶段名相同、两边都只有一个，才算同一段。
// 当前段和各段的进度（手设状态、勾选）搬到原 id；对不上的（新增的段、同名多个）不猜，留在原处。原 id 上已有的字段不覆盖。
export function remapStages(progress, fromUnits, toUnits) {
    let keyOf = (u) => `${u.volume.id}\u0000${u.stage.key}`,
        count = (list) => list.reduce((m, u) => m.set(keyOf(u), (m.get(keyOf(u)) || 0) + 1), new Map()),
        nf = count(fromUnits || []),
        nt = count(toUnits || []),
        toIds = new Set((toUnits || []).map((u) => u.id)),
        byKey = new Map((toUnits || []).map((u) => [keyOf(u), u.id])),
        map = new Map();
    for (let u of fromUnits || []) {
        let k = keyOf(u);
        !toIds.has(u.id) && nf.get(k) === 1 && nt.get(k) === 1 && map.set(u.id, byKey.get(k));
    }
    if (!map.size) return progress;
    let slots = { ...progress.slots };
    for (let [from, to] of map) {
        if (!slots[from]) continue;
        slots[to] = { ...slots[from], ...(slots[to] || {}) };
        delete slots[from];
    }
    return { ...progress, current: map.get(progress.current) || progress.current, slots };
}

export function goTo(progress, units, unitId) {
    const slots = { ...progress.slots };
    for (const unit of units) {
        if (slots[unit.id] && slots[unit.id].state) {
            const { state, ...rest } = slots[unit.id];
            slots[unit.id] = rest;
        }
    }
    return { ...progress, current: unitId, slots };
}

// 打开下一段：当前转已过、下一段转进行中；本卷最后一段自动进入下一卷第一段（单元表本就跨卷连续）。
export function advance(progress, units) {
    const cur = currentIndex(units, progress);
    if (cur < 0 || cur >= units.length - 1) return null;
    const from = units[cur];
    const to = units[cur + 1];
    return { progress: goTo(progress, units, to.id), from, to };
}

export function isMuted(progress, unitId) {
    return progress.muted.includes(unitId);
}

export function mute(progress, unitId) {
    return isMuted(progress, unitId) ? progress : { ...progress, muted: [...progress.muted, unitId] };
}

export const CLUE_SLOT = '@clue';
