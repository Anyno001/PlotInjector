import { PHASE_LABELS, findWorld, normalizeWorld, putWorld } from './infinite.js';

// 无限流状态机：progress.infinite（随聊天存）。纯函数，返回新对象。
//
//   train ──开副本（正文状态块读到「停站」，或手动「进入新世界」）──▶ world
//   world ──关副本（正文状态块读到「回到列车」，或手动「回到列车」）──▶ train
//   世界库里的档案可以手动「重新打开」，直接进入那个世界。
//
// 副本进行中注入器什么都不管：档案原样不动。

const LOG_MAX = 12;

export function emptyInfinite() {
    return { phase: 'train', worldId: '', worlds: [], log: [] };
}

export function normalizeInfiniteProgress(value) {
    const src = value && typeof value === 'object' ? value : {};
    const worlds = (Array.isArray(src.worlds) ? src.worlds : []).filter(item => item && typeof item === 'object').map(normalizeWorld);
    const worldId = String(src.worldId || '');
    const inWorld = src.phase === 'world' && Boolean(findWorld(worlds, worldId));
    const trig = normalizeTrigger(src.trigger, worlds);
    return {
        phase: inWorld ? 'world' : 'train',
        worldId: inWorld ? worldId : '',
        worlds,
        log: (Array.isArray(src.log) ? src.log : []).map(String).slice(-LOG_MAX),
        ...(trig ? { trigger: trig } : {}),
    };
}

// 触发记录只在有效时保留：kind 合法、楼层是非负整数。
function normalizeTrigger(value, worlds) {
    if (!value || typeof value !== 'object') return null;
    if (value.kind !== 'enter' && value.kind !== 'leave') return null;
    const floor = Number(value.floor);
    if (!Number.isInteger(floor) || floor < 0) return null;
    const worldId = String(value.worldId || '');
    if (!findWorld(worlds, worldId)) return null;
    return { kind: value.kind, floor, hash: String(value.hash || ''), worldId };
}

export function withTrigger(inf, trigger) {
    const { trigger: _old, ...rest } = inf;
    return trigger ? { ...rest, trigger } : rest;
}

// 撤销开副本：删掉触发时生成的档案，退回列车。
export function undoEnter(inf, note = '触发楼已改动，撤销开副本') {
    const id = inf.trigger ? inf.trigger.worldId : inf.worldId;
    const next = withTrigger({ ...inf, worlds: inf.worlds.filter(world => world.id !== id), phase: 'train', worldId: '' }, null);
    return addLog(next, note);
}

// 撤销关副本：重新打开刚关掉的那份档案，回到世界；档案已不在就只清掉记录。
export function undoLeave(inf, note = '触发楼已改动，撤销关副本') {
    const world = inf.trigger ? findWorld(inf.worlds, inf.trigger.worldId) : null;
    if (!world) return withTrigger(inf, null);
    return addLog(withTrigger({ ...inf, phase: 'world', worldId: world.id }, null), note);
}

export function addLog(inf, text) {
    return { ...inf, log: [...inf.log, text].slice(-LOG_MAX) };
}

export function createWorld({ id, dice, parsed }) {
    return normalizeWorld({ id, title: parsed.title, dice, body: parsed.body });
}

// 开副本：档案存进世界库并进入这个世界。
export function enterWorld(inf, world) {
    return addLog(withTrigger({ ...inf, phase: 'world', worldId: world.id, worlds: putWorld(inf.worlds, world) }, null), `进入世界「${world.title}」`);
}

// 重新打开世界库里的某份档案（手动回访）。
export function reenterWorld(inf, id) {
    const world = findWorld(inf.worlds, id);
    if (!world) throw new Error('这份档案已经不在世界库里');
    return addLog(withTrigger({ ...inf, phase: 'world', worldId: id }, null), `重新打开「${world.title}」`);
}

// 关副本：撤掉档案注入，档案留在世界库里。
export function leaveWorld(inf, note = '回到列车') {
    return addLog(withTrigger({ ...inf, phase: 'train', worldId: '' }, null), note);
}

export function removeWorld(inf, id) {
    const kept = { ...inf, worlds: inf.worlds.filter(world => world.id !== id) };
    const next = inf.trigger && inf.trigger.worldId === id ? withTrigger(kept, null) : kept;
    return next.worldId === id ? addLog({ ...next, phase: 'train', worldId: '' }, '当前世界的档案被删除，回到列车') : next;
}

// ---------- 注入 ----------

// 无限流项目的「详细」条目正文，只剩两个标签块：<列车状态>，以及仅在世界里出现的 <世界档案>。
// 档案整份原样注入，情欲浓度由代码写在末尾。
export function buildInfiniteDetail(inf) {
    const world = inf.phase === 'world' ? findWorld(inf.worlds, inf.worldId) : null;
    const status = world ? `当前状态：${PHASE_LABELS.world}「${world.title}」。` : `当前状态：${PHASE_LABELS.train}，尚未下车。下一站由列车报站，user 指挥不了广播。`;
    const blocks = [`<列车状态>\n${status}\n</列车状态>`];
    if (world) blocks.push(`<世界档案>\n${world.body}\n\n情欲浓度：${world.dice.lust}\n</世界档案>`);
    return blocks.join('\n');
}
