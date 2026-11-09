import { NO_LINKS, outlineLinks } from './align.js';
import { flattenUnits, makeId } from './outline.js';
import { unitStates } from './progress.js';
import { normalizePersonaProgress } from './persona-progress.js';
import { matchesAny } from './wbtools.js';

// 分阶段人设：写在注入器里的人设线，一条线若干阶段，按四种方式之一决定当前阶段。数据结构见计划文档第 1 节。
// 所有函数返回新对象，不改传入的项目与进度。
export const PERSONA_MODES = [
    { value: 'check', label: '条件检测' },
    { value: 'outline', label: '跟随大纲' },
    { value: 'fame', label: '读声望' },
    { value: 'manual', label: '手动' },
];
const MODE_KEYS = PERSONA_MODES.map(item => item.value);
export const PERSONA_SLOT_PREFIX = '@persona:';

const isObj = value => Boolean(value) && typeof value === 'object' && !Array.isArray(value);
const text = value => String(value ?? '');
const escapeRe = value => text(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const intOr = (value, fallback) => (Number.isFinite(Number(value)) && value !== '' && value !== null ? Math.round(Number(value)) : fallback);
const num = value => (value === undefined || value === null || value === '' || !Number.isFinite(Number(value)) ? undefined : Number(value));

export function emptyPersonas() {
    return { lines: [], fixed: [], imported: [] };
}

export function newStage(name = '新阶段') {
    return { id: makeId('ps'), name, cond: '', unitId: '', range: {}, text: '' };
}

export function newLine(name = '新人设', group = '') {
    return {
        id: makeId('pl'), group, name, keys: [], constant: true, position: 0, depth: 4, role: 0, order: 100, enabled: true,
        common: '', mode: 'manual', fame: { bar: '', partner: '' }, stages: [newStage('阶段一')], source: null,
    };
}

function normalizeStage(value) {
    const src = isObj(value) ? value : {};
    const range = isObj(src.range) ? src.range : {};
    const min = num(range.min);
    const max = num(range.max);
    return { id: text(src.id) || makeId('ps'), name: text(src.name).trim() || '阶段', cond: text(src.cond), unitId: text(src.unitId), range: { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) }, text: text(src.text) };
}

function normalizeLine(value) {
    const src = isObj(value) ? value : {};
    const fame = isObj(src.fame) ? src.fame : {};
    const source = isObj(src.source) ? src.source : null;
    return {
        id: text(src.id) || makeId('pl'),
        group: text(src.group).trim(),
        name: text(src.name).trim() || '未命名',
        keys: (Array.isArray(src.keys) ? src.keys : []).map(item => text(item).trim()).filter(Boolean),
        constant: src.constant !== false,
        position: intOr(src.position, 0),
        depth: Math.max(0, intOr(src.depth, 4)),
        role: intOr(src.role, 0),
        order: intOr(src.order, 100),
        enabled: src.enabled !== false,
        common: text(src.common),
        mode: MODE_KEYS.includes(src.mode) ? src.mode : 'check',
        fame: { bar: text(fame.bar).trim(), partner: text(fame.partner).trim() },
        stages: (Array.isArray(src.stages) ? src.stages : []).filter(isObj).map(normalizeStage),
        source: source ? { book: text(source.book), uid: text(source.uid), varPath: text(source.varPath) } : null,
        // 一条线可能由几个条目的片段合并而成，恢复原条目时按它找回（比计划多存的字段）。
        sources: (Array.isArray(src.sources) ? src.sources : []).filter(isObj).map(item => ({ book: text(item.book), uid: text(item.uid), key: text(item.key ?? item.uid) })),
    };
}

function normalizeFixed(value) {
    const src = isObj(value) ? value : {};
    return {
        id: text(src.id) || makeId('pf'),
        name: text(src.name).trim(),
        options: [...new Set((Array.isArray(src.options) ? src.options : []).map(item => text(item).trim()).filter(Boolean))],
        varPath: text(src.varPath),
    };
}

// 旧项目没有 personas 字段时补空结构；线没有阶段时补一个，免得界面与注入处处判空。
export function normalizePersonas(value) {
    const src = isObj(value) ? value : {};
    return {
        lines: (Array.isArray(src.lines) ? src.lines : []).filter(isObj).map(normalizeLine).map(line => (line.stages.length ? line : { ...line, stages: [newStage('阶段一')] })),
        fixed: (Array.isArray(src.fixed) ? src.fixed : []).filter(isObj).map(normalizeFixed).filter(item => item.name),
        imported: (Array.isArray(src.imported) ? src.imported : []).filter(isObj).map(item => ({ book: text(item.book), uid: text(item.uid), key: text(item.key ?? item.uid), title: text(item.title) })),
    };
}

export const hasPersonas = project => Boolean(project && project.personas && Array.isArray(project.personas.lines) && project.personas.lines.length);

// 角色分组：线按 group 折叠，没有分组的排在最前。返回 [{ name, lines }]。
export function groupLines(lines) {
    const groups = new Map();
    for (const line of lines) {
        const key = line.group || '';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(line);
    }
    return [...groups.entries()].sort(([a], [b]) => (a === '' ? -1 : b === '' ? 1 : 0)).map(([name, list]) => ({ name, lines: list }));
}

// 固定选项当前值：聊天里选过的优先，没选过（或选的值已不在选项里）为空串。
export function fixedValue(item, progress) {
    const picked = normalizePersonaProgress(progress && progress.personas).fixed[item.id];
    return item.options.includes(picked) ? picked : '';
}

export const unsetFixed = (personas, progress) => (personas ? personas.fixed.filter(item => item.options.length && !fixedValue(item, progress)) : []);

// 文中 {{选项名}} 按值替换；未选时先用第一个选项（注入前会弹窗让用户选）。
export function applyFixed(content, personas, progress) {
    let out = text(content);
    for (const item of personas.fixed) {
        if (!item.options.length) continue;
        const value = fixedValue(item, progress) || item.options[0];
        // 整段只在选中该值时保留：{{选项名=值}}…{{/选项名}}
        const block = new RegExp(`\\{\\{${escapeRe(item.name)}=([^}]*)\\}\\}([\\s\\S]*?)\\{\\{/${escapeRe(item.name)}\\}\\}`, 'g');
        out = out.replace(block, (all, v, body) => (v === value ? body : ''));
        out = out.split(`{{${item.name}}}`).join(value);
    }
    return out.replace(/\n{3,}/g, '\n\n');
}

// ---------- 当前阶段 ----------

export function rangeHas(range, value) {
    if (!Number.isFinite(value)) return false;
    return (range.min === undefined || value >= range.min) && (range.max === undefined || value <= range.max);
}

// 声望读数里找这条线绑定的条：名字对上；有对象时取 pairs 里对应的一项。读不到返回 null。
export function fameReading(line, fame) {
    const bar = (Array.isArray(fame) ? fame : []).find(item => item && item.name === line.fame.bar);
    if (!bar) return null;
    if (line.fame.partner) {
        const pair = (Array.isArray(bar.pairs) ? bar.pairs : []).find(item => item.partner === line.fame.partner);
        return pair ? Number(pair.value) : null;
    }
    return Number.isFinite(Number(bar.value)) ? Number(bar.value) : null;
}

const storedIndex = (line, pp) => Math.max(0, line.stages.findIndex(stage => stage.id === pp[line.id]));

// 跟随大纲：已到达（已过或进行中）的大纲阶段里，绑定得最靠后的那个人设阶段；都没到时用第一阶段。
export function outlineIndex(line, env) {
    const units = env.units || [];
    const links = env.links || NO_LINKS;
    const position = new Map(units.map((unit, i) => [unit.id, i]));
    let best = -1;
    let at = 0;
    line.stages.forEach((stage, i) => {
        if (!stage.unitId) return;
        const id = links.resolve(stage.unitId);
        const pos = position.get(id);
        if (pos === undefined || !['done', 'active'].includes(env.states && env.states[id])) return;
        if (pos >= best) { best = pos; at = i; }
    });
    return at;
}

export function fameIndex(line, env) {
    const value = fameReading(line, env.fame);
    if (value === null) return -1;
    return line.stages.findIndex(stage => rangeHas(stage.range, value));
}

// 返回 { stage, index, source, lost }：source 为 manual/check/outline/fame；lost 表示读声望读不到值、退回了手动值。
export function currentStage(line, progress, env = {}) {
    const pp = normalizePersonaProgress(progress && progress.personas);
    const manualHeld = pp.manual.includes(line.id);
    const stored = storedIndex(line, pp);
    const pick = (index, source, lost = false) => ({ stage: line.stages[index], index, source, lost });
    if (line.mode === 'outline' && !manualHeld) return pick(outlineIndex(line, env), 'outline');
    if (line.mode === 'fame' && !manualHeld) {
        const index = fameIndex(line, env);
        return index >= 0 ? pick(index, 'fame') : pick(stored, 'manual', fameReading(line, env.fame) === null);
    }
    return pick(stored, manualHeld ? 'manual' : line.mode === 'check' ? 'check' : 'manual');
}

// 注入环境：大纲阶段与状态（跟随大纲用）、声望读数（读声望用）。
export function personaEnv(project, progress, fame = []) {
    const infinite = project && project.mode === 'infinite';
    const units = infinite || !project ? [] : flattenUnits(project.outline && project.outline.volumes);
    const links = infinite || !units.length ? NO_LINKS : outlineLinks(project.outline, units);
    return { units, links, states: units.length ? unitStates(units, progress, links) : {}, fame };
}

// ---------- 进度写入（均返回新进度） ----------

const withPersonas = (progress, patch) => ({ ...progress, personas: { ...normalizePersonaProgress(progress && progress.personas), ...patch } });
const without = (list, id) => list.filter(item => item !== id);

// 手动选阶段：条件检测、跟随大纲、读声望三种方式下标「手动」，直到下次自动判断推进；手动方式本身不用标。
export function setPersonaStage(progress, line, stageId, env = {}) {
    const pp = normalizePersonaProgress(progress && progress.personas);
    const manual = line.mode === 'manual' ? pp.manual : [...new Set([...pp.manual, line.id])];
    const stage = line.stages.find(item => item.id === stageId);
    return withPersonas(progress, {
        [line.id]: stageId, manual,
        names: { ...pp.names, ...(stage ? { [line.id]: stage.name } : {}) },
    });
}

// 回到自动判断：清掉「手动」标记。
export function releasePersona(progress, lineId) {
    const pp = normalizePersonaProgress(progress && progress.personas);
    return pp.manual.includes(lineId) ? withPersonas(progress, { manual: without(pp.manual, lineId) }) : progress;
}

export function setFixedValue(progress, fixedId, value) {
    const pp = normalizePersonaProgress(progress && progress.personas);
    return withPersonas(progress, { fixed: { ...pp.fixed, [fixedId]: value } });
}

export function mutePersona(progress, lineId, muted = true) {
    const pp = normalizePersonaProgress(progress && progress.personas);
    const list = muted ? [...new Set([...pp.muted, lineId])] : without(pp.muted, lineId);
    return list.length === pp.muted.length ? progress : withPersonas(progress, { muted: list });
}

// 跟随大纲、读声望：自动算出的阶段与上次记下的不同，说明自动判断又推进了，清掉「手动」；并把算出的阶段记进存档，手动改回时有据可查。
// 返回新进度，没变化时原样返回同一个对象。
export function syncPersonas(project, progress, fame = []) {
    if (!hasPersonas(project) || !progress) return progress;
    const pp = normalizePersonaProgress(progress.personas);
    const env = personaEnv(project, progress, fame);
    let next = pp;
    for (const line of project.personas.lines) {
        if (line.mode !== 'outline' && line.mode !== 'fame') continue;
        const index = line.mode === 'outline' ? outlineIndex(line, env) : fameIndex(line, env);
        if (index < 0) continue;
        const stage = line.stages[index];
        if (next.auto[line.id] === stage.id) continue;
        const wasSet = next.auto[line.id] !== undefined;
        next = { ...next, auto: { ...next.auto, [line.id]: stage.id }, manual: wasSet ? without(next.manual, line.id) : next.manual };
    }
    return next === pp ? progress : { ...progress, personas: next };
}

// 阶段改名或删除、线被删除后把进度对回当前人设：id 还在就刷新阶段名；id 没了按记下的阶段名找回；都找不到就清掉（用第一阶段）。
export function alignPersonaProgress(progress, personas) {
    if (!progress || !progress.personas || !personas) return progress;
    const pp = normalizePersonaProgress(progress.personas);
    const next = { ...pp, names: { ...pp.names }, auto: { ...pp.auto } };
    let changed = false;
    const alive = new Set(personas.lines.map(line => line.id));
    for (const line of personas.lines) {
        const id = pp[line.id];
        if (id === undefined) continue;
        const hit = line.stages.find(stage => stage.id === id);
        if (hit) {
            if (next.names[line.id] !== hit.name) { next.names[line.id] = hit.name; changed = true; }
            continue;
        }
        const byName = line.stages.find(stage => stage.name === pp.names[line.id]);
        if (byName) next[line.id] = byName.id;
        else { delete next[line.id]; delete next.names[line.id]; }
        changed = true;
    }
    for (const key of Object.keys(next)) {
        if (['fixed', 'muted', 'manual', 'auto', 'names'].includes(key) || alive.has(key)) continue;
        delete next[key];
        changed = true;
    }
    return changed ? { ...progress, personas: next } : progress;
}

// ---------- 注入 ----------

// 一条线的注入文字：公共文字 + 当前阶段内容，固定选项按值替换。
export function personaContent(line, stage, personas, progress) {
    return applyFixed([line.common, stage && stage.text].map(item => text(item).trim()).filter(Boolean).join('\n'), personas, progress);
}

// 关键词触发：常驻直接注入；有关键词的线，最近几楼文字命中才注入；既不常驻又没写关键词的线不注入。
export function lineTriggered(line, recentText, globals = {}) {
    if (line.constant) return true;
    return line.keys.length > 0 && matchesAny(line.keys, recentText, {}, globals);
}

export const personaSlotId = line => `${PERSONA_SLOT_PREFIX}${line.id}`;

// 虚拟条目：与设定、大纲条目同一路径注入。opts.recentText 为 undefined 时不做关键词过滤（执行页、预览用）。
export function buildPersonaEntries(project, progress, { recentText, globals, fame = [] } = {}) {
    if (!hasPersonas(project)) return [];
    const personas = project.personas;
    const env = personaEnv(project, progress, fame);
    const out = [];
    for (const line of personas.lines) {
        if (!line.enabled) continue;
        if (recentText !== undefined && !lineTriggered(line, recentText, globals)) continue;
        const { stage } = currentStage(line, progress, env);
        const content = personaContent(line, stage, personas, progress);
        if (!content) continue;
        out.push({
            slotId: personaSlotId(line), kind: 'persona', title: `人设·${line.group ? `${line.group}·` : ''}${line.name}`, lineId: line.id,
            content, position: line.position, depth: line.depth, role: line.role, order: line.order, enabled: true,
        });
    }
    return out;
}

// ---------- 条件检测 ----------

// 本次检测要带的人设线：方式为条件检测、启用、未设不提醒、窗口内触发过（常驻或关键词命中最近读取的正文）、还有下一阶段。
// 每条只带线名、当前阶段名、下一阶段名与进入条件，不带人设正文。
export function checkItems(project, progress, recentText, { globals = {}, fame = [] } = {}) {
    if (!hasPersonas(project) || !progress) return [];
    const pp = normalizePersonaProgress(progress.personas);
    const env = personaEnv(project, progress, fame);
    const out = [];
    for (const line of project.personas.lines) {
        if (!line.enabled || line.mode !== 'check' || pp.muted.includes(line.id)) continue;
        if (!lineTriggered(line, recentText, globals)) continue;
        const { stage, index } = currentStage(line, progress, env);
        const next = line.stages[index + 1];
        if (!next) continue;
        out.push({ lineId: line.id, group: line.group, name: line.name, from: stage.name, fromId: stage.id, to: next.name, toId: next.id, cond: next.cond.trim(), wasManual: pp.manual.includes(line.id) });
    }
    return out;
}

export const itemLabel = item => `${item.group ? `${item.group} · ` : ''}${item.name}`;

// 检测回复里的 personas 只认「线名对得上、to 正好是该线的下一阶段」的条目，其余忽略（只往前推一格）。
export function resolveMoves(items, moves) {
    const out = [];
    for (const move of Array.isArray(moves) ? moves : []) {
        const key = text(move && move.line).trim();
        const to = text(move && move.to).trim();
        const item = items.find(entry => entry.name === key || itemLabel(entry) === key || `${entry.group}·${entry.name}` === key || `${entry.group}${entry.name}` === key);
        if (!item || out.some(entry => entry.item === item) || (to !== item.to && to !== item.toId)) continue;
        out.push({ item, floor: Number(move.floor) > 0 ? Math.round(Number(move.floor)) : 0, reason: text(move.reason).trim() });
    }
    return out;
}

export const moveText = move => `${itemLabel(move.item)}：${move.item.from} → ${move.item.to}${move.floor || move.reason ? `（${move.floor ? `第 ${move.floor} 楼` : ''}${move.floor && move.reason ? '：' : ''}${move.reason}）` : ''}`;

// 采用：推到下一阶段，并清掉「手动」标记（自动判断又推进了）。返回新进度。
export function applyMoves(progress, project, moves) {
    let next = progress;
    for (const move of moves) {
        const line = project.personas.lines.find(item => item.id === move.item.lineId);
        if (!line) continue;
        next = releasePersona(setPersonaStage(next, line, move.item.toId), line.id);
    }
    return next;
}

// 撤销：每条线回到推进前的阶段与「手动」状态。
export function undoMoves(progress, project, moves) {
    let next = progress;
    for (const move of moves) {
        const line = project.personas.lines.find(item => item.id === move.item.lineId);
        if (!line) continue;
        const pp = normalizePersonaProgress(next.personas);
        const manual = move.item.wasManual ? [...new Set([...pp.manual, line.id])] : pp.manual.filter(id => id !== line.id);
        next = withPersonas(next, { [line.id]: move.item.fromId, manual, names: { ...pp.names, [line.id]: move.item.from } });
    }
    return next;
}
