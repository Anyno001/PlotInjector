import { DEFAULT_PARAMS, PACES, POSITIONS, ROLES, buildIndexText, carriedNodes, positionLabel } from '../core/inject.js';
import { flattenUnits, stageLabel, stageNodes, volumeLabel } from '../core/outline.js';
import { STATE_LABELS, checkBase, goTo, offNodes, patchSlot, setNodeChecked, unitStates } from '../core/progress.js';
import { currentStage, fixedValue, groupLines, hasPersonas, mutePersona, personaEnv, releasePersona, setFixedValue, setPersonaStage } from '../core/personas.js';
import { clockPhase, isThreadNode, liveThreads, maskUnits, patchLive, threadSwitches } from '../core/threads.js';
import { estimateTokens } from '../core/tokens.js';
import { cardKey, cardName } from '../host/st.js';
import { esc, menuDialog, openDialog, options } from './dom.js';
import { ICONS } from './styles.js';
import { startRewrite } from './tab-outline.js';

// 位置、深度、角色、顺序改的是本项目的默认，所有阶段一起生效；只有启用开关按段记。
// checked=true 为恢复未演；勾回走完的支线链时停在最后一步，免得显示空步骤。
function toggleNode(view, unitId, nodeId, checked) {
    const unit = view.runtime.units().find(item => item.id === unitId);
    const node = unit && stageNodes(unit.stage.data).find(item => item.id === nodeId);
    let next = setNodeChecked(view.runtime.progress(), unitId, nodeId, checked, node ? node.name : '');
    const hook = checked && viewLive(view).hooks.find(item => item.key === `${unitId}:${nodeId}`);
    if (hook && hook.steps.length && hook.step >= hook.steps.length) next = patchLive(next, hook, { step: hook.steps.length - 1 });
    view.runtime.setProgress(next);
}

export function entryRow(entry, expanded) {
    const atDepth = entry.position === 4;
    const field = name => `data-kind="${entry.kind}" data-param="${name}"`;
    const body = expanded ? `<div class="pi-entry-bd">
        <div class="pi-pair ${atDepth ? 'is-c4' : ''}">
            <label class="pi-field"><span>位置</span><select class="pi-sel" ${field('position')}>${options(POSITIONS, entry.position)}</select></label>
            ${atDepth ? `<label class="pi-field"><span>深度</span><input class="pi-inp" type="number" min="0" ${field('depth')} value="${entry.depth}"></label>
            <label class="pi-field"><span>角色</span><select class="pi-sel" ${field('role')}>${options(ROLES, entry.role)}</select></label>` : ''}
            <label class="pi-field"><span>顺序</span><input class="pi-inp" type="number" ${field('order')} value="${entry.order}"></label>
        </div>
        <pre class="pi-pre">${esc(entry.content)}</pre></div>` : '';
    return `<div class="pi-entry${entry.enabled ? '' : ' is-off'}">
        <div class="pi-entry-hd" data-act="toggle-entry" data-slot="${esc(entry.slotId)}">
            <span class="pi-pos">${esc(positionLabel(entry))}</span>
            <span class="pi-etitle">${esc(entry.title)}</span>
            <span class="pi-meta">≈${estimateTokens(entry.content)}</span>
            <input type="checkbox" title="启用" data-slot="${esc(entry.slotId)}" data-slot-field="enabled"${entry.enabled ? ' checked' : ''}>
        </div>${body}</div>`;
}

// 阶段节点行：类型标签、名称、行尾状态字。未演继续注入，已演不再注入；整行灰色表示已演。
const nodeRow = (unitId, node, off, from = '', mark = '') => `<div class="pi-node-row${off ? ' is-off' : ''}"${from ? ` title="来自${esc(from)}"` : ''}>
        <span class="pi-node-name"><span class="pi-badge pi-kind is-${esc(node.kind)}">${esc(node.label)}</span> <span class="pi-node-txt">${esc(node.name)}</span></span>${mark || `<button type="button" class="pi-meta pi-meta-btn" data-act="node-toggle" data-node="${esc(node.id)}" data-unit="${esc(unitId)}">${off ? '已演' : '未演'}</button>`}</div>`;

// 状态一律灰色小字；已激活在字前加粉点。状态文字本身是按钮，点开手动菜单。
function hookRow(hook) {
    const chain = hook.steps.length && (hook.status === 'active' || hook.status === 'queue');
    const mark = hook.status === 'done' ? '已演' : chain ? `第 ${hook.step + 1}/${hook.steps.length} 步${hook.status === 'queue' ? ' · 排队' : ''}` : { wait: '待触发', active: '已激活', queue: '排队' }[hook.status];
    const markHtml = mark ? `<button type="button" class="pi-meta pi-meta-btn${hook.status === 'active' ? ' is-dot' : ''}" data-act="hook-menu" data-key="${esc(hook.key)}">${esc(mark)}</button>` : '';
    return nodeRow(hook.unit.id, hook.node, hook.status === 'done', hook.carried ? stageLabel(hook.unit.stage.key) : '', markHtml || '<span></span>');
}

// 已过期的支线收成一行，点开后列出，行尾「已过期」可点开菜单恢复。
function expiredRows(hooks, open) {
    if (!hooks.length) return '';
    const rows = open ? hooks.map(hook => `<div class="pi-hook is-quiet"><span class="pi-node-row is-quiet"><span class="pi-node-name">${esc(hook.node.name)}</span></span>
        <button type="button" class="pi-meta pi-meta-btn" data-act="hook-menu" data-key="${esc(hook.key)}">已过期</button></div>`).join('') : '';
    return `<p class="pi-hint"><button type="button" class="pi-meta pi-meta-btn" data-act="expired-toggle">已过期 ${hooks.length} 条</button></p>${rows}`;
}

// 世界进度钟：每钟一行，圆点按格数，深色为已填；点整行开手动菜单。
function worldRow(live) {
    if (!live.clocks.length) return '';
    const row = clock => {
        const phase = clockPhase(clock);
        const dots = Array.from({ length: clock.total }, (_, i) => `<i${i < clock.filled ? ' class="is-on"' : ''}></i>`).join('');
        const mark = phase === 'done' ? '已发生' : phase === 'due' ? '已满' : `${clock.filled}/${clock.total}`;
        return `<button type="button" class="pi-check pi-clock${phase === 'done' ? ' is-quiet' : ''}" data-act="clock-menu" data-key="${esc(clock.key)}" title="${esc(clock.event)}">
            <span class="pi-clock-name">${esc(clock.node.name)}</span><span class="pi-clock-dots">${dots}</span><span class="pi-meta">${mark}</span></button>`;
    };
    return `<p class="pi-hint">世界</p>${live.clocks.map(row).join('')}`;
}

// 支线、世界动态的项目开关：改动立即写进项目。
const switchCell = (key, label, on) => `<div class="pi-pace-cell"><span>${esc(label)}</span><button type="button" class="pi-switch${on ? ' is-on' : ''}" role="switch" aria-checked="${on}" data-act="thread-switch" data-key="${key}" title="${on ? '已开启' : '已关闭'}"></button></div>`;

function switchRow(sw) {
    return `<div class="pi-pace"><span class="pi-pace-label">启用</span><div class="pi-pair">${switchCell('sideOn', '支线', sw.sideOn)}${switchCell('worldOn', '世界动态', sw.worldOn)}</div></div>`;
}

// carried：已过阶段里没演的支线与世界动态，标为已演即不再延续，灰色留在原处可恢复。
// units 已按开关遮罩，关掉的一类不会出现在这里，只留一行「已关闭」。
function nodeList(unit, progress, carried, live, sw, expiredOpen) {
    const off = new Set(offNodes(progress, unit));
    const nodes = stageNodes(unit.stage.data).filter(node => !isThreadNode(node));
    const alive = hook => hook.status !== 'expired';
    const own = live.hooks.filter(hook => !hook.carried && alive(hook));
    const later = live.hooks.filter(hook => hook.carried && alive(hook));
    const expired = live.hooks.filter(hook => !alive(hook));
    const closed = [...(sw.sideOn ? [] : ['支线']), ...(sw.worldOn ? [] : ['世界动态'])];
    if (!nodes.length && !carried.length && !live.hooks.length && !live.clocks.length && !closed.length) return '';
    return `<div class="pi-tl-nodes">${nodes.map(node => nodeRow(unit.id, node, off.has(node.id))).join('')}${own.map(hookRow).join('')}
        ${carried.length || later.length ? `<p class="pi-hint">延续自前面阶段</p>${carried.map(item => nodeRow(item.unit.id, item.node, item.off, stageLabel(item.unit.stage.key))).join('')}${later.map(hookRow).join('')}` : ''}
        ${expiredRows(expired, expiredOpen)}${worldRow(live)}${closed.map(label => `<p class="pi-hint">${label}已关闭</p>`).join('')}</div>`;
}

// 阶段时间线：每卷一条，粗环为阶段，已过的实心、走过的连线为实线，之后为虚线。
// 进行中只有圆点用强调色；手动改状态、设为当前、恢复提醒收进行尾的「⋯」。
function timeline(units, states, progress, carried, live, sw, expiredOpen) {
    const groups = [];
    for (const unit of units) {
        const last = groups[groups.length - 1];
        if (last && last.volume === unit.volume) last.units.push(unit);
        else groups.push({ volume: unit.volume, units: [unit] });
    }
    const item = unit => {
        const state = states[unit.id];
        const manual = progress.slots[unit.id] && progress.slots[unit.id].state;
        const muted = progress.muted.includes(unit.id);
        const range = unit.stage.data && unit.stage.data.时间范围;
        const label = state === 'done' || state === 'todo' ? '' : STATE_LABELS[state];
        const notes = [label, manual ? '手动' : '', muted ? '不提醒' : ''].filter(Boolean).join(' · ');
        return `<div class="pi-tl-item is-${state}"><span class="pi-tl-dot"></span><div class="pi-tl-box">
            <div class="pi-tl-hd"><span class="pi-tl-name" title="${esc(range || '')}">${esc(stageLabel(unit.stage.key))}</span>
                ${notes ? `<span class="pi-tl-state">${esc(notes)}</span>` : ''}
                <button type="button" class="pi-icon-btn" data-act="unit-menu" data-unit="${esc(unit.id)}" title="更多">${ICONS.more}</button></div>
            ${state === 'active' ? nodeList(unit, progress, carried, live, sw, expiredOpen) : ''}</div></div>`;
    };
    return groups.map(group => `<div class="pi-tl-vol">${esc(volumeLabel(group.volume.key))}</div><div class="pi-tl">${group.units.map(item).join('')}</div>`).join('');
}

// 当前聊天没在用这个项目时的启用卡；已在用返回空串。
export function activateCard(view, project) {
    const { data, runtime } = view;
    if (!cardKey()) return '<div class="pi-empty">先打开一张角色卡的聊天，再启用项目。</div>';
    const activeId = runtime.activeId();
    if (activeId === project.id) return '';
    const other = data.index().projects.find(item => item.id === activeId);
    return `<div class="pi-card"><h3>启用</h3>
            <p class="pi-hint">${other ? `当前聊天使用的是「${esc(other.name)}」` : `「${esc(cardName())}」还没有启用项目`}。</p>
            <div class="pi-tools is-c2">
                <button type="button" class="pi-btn is-primary" data-act="activate">设为当前聊天使用</button>
                <button type="button" class="pi-btn" data-act="activate-card">设为本卡默认</button></div></div>`;
}

// 人设阶段卡：固定选项一行在顶部；每个角色一组，每条线一行阶段胶囊，粉色标当前，「⋯」里改提醒与自动判断。
function personaCard(view, project, progress, st) {
    if (!hasPersonas(project)) return '';
    const all = project.personas;
    const env = personaEnv(project, progress, view.runtime.fame());
    const muted = new Set((progress.personas && progress.personas.muted) || []);
    const fixed = all.fixed.filter(item => item.options.length).map(item => `<label class="pi-field"><span>${esc(item.name)}</span><select class="pi-sel" data-pfixed="${esc(item.id)}">${fixedValue(item, progress) ? '' : '<option value="" selected disabled>请选择</option>'}${options(item.options.map(value => ({ value, label: value })), fixedValue(item, progress))}</select></label>`).join('');
    const collapsed = new Set(st.personaFold || []);
    const line = item => {
        const info = currentStage(item, progress, env);
        const note = [info.source === 'manual' && item.mode !== 'manual' ? '手动' : '', info.lost ? '读不到声望' : '', muted.has(item.id) ? '不提醒' : ''].filter(Boolean).join(' · ');
        const caps = item.stages.map((stage, index) => `<button type="button" class="pi-chip${index === info.index ? ' is-on' : ''}" data-act="persona-pick" data-line="${esc(item.id)}" data-stage="${esc(stage.id)}">${esc(stage.name)}</button>`).join('');
        return `<div class="pi-pl-row${info.lost ? ' is-lost' : ''}"><div class="pi-pl-hd"><span class="pi-pl-name">${esc(item.name)}</span>${note ? `<span class="pi-tl-state">${esc(note)}</span>` : ''}
            <button type="button" class="pi-icon-btn" data-act="persona-menu" data-line="${esc(item.id)}" title="更多">${ICONS.more}</button></div><div class="pi-refs">${caps}</div></div>`;
    };
    const groups = groupLines(all.lines.filter(item => item.enabled)).map(group => {
        const key = group.name || '::none';
        const shut = collapsed.has(key);
        return `<div class="pi-group${shut ? ' is-collapsed' : ''}"><button type="button" class="pi-group-hd" data-act="persona-fold" data-group="${esc(key)}">${shut ? ICONS.caret : ICONS.caretDown}${esc(group.name || '未分组')}<small>${group.lines.length}</small></button>${shut ? '' : group.lines.map(line).join('')}</div>`;
    }).join('');
    return `<div class="pi-card"><h3>人设阶段</h3>${fixed ? `<div class="pi-pair">${fixed}</div>` : ''}${groups || '<p class="pi-hint">没有启用的人设线。</p>'}</div>`;
}

export function render(view) {
    const { data, runtime } = view;
    const project = view.project();
    const st = view.tabState('run');
    const notActive = activateCard(view, project);
    if (notActive) return notActive;
    const progress = runtime.progress();
    const entries = runtime.entries();
    const sw = threadSwitches(project);
    const units = maskUnits(flattenUnits(project.outline.volumes), sw);
    const states = unitStates(units, progress);
    const total = entries.filter(entry => entry.enabled).reduce((sum, entry) => sum + estimateTokens(entry.content), 0);
    const settings = data.settings();
    const checking = runtime.isChecking();
    const book = runtime.injectMode() === 'virtual' ? '' : '<span class="pi-badge is-warn">专用世界书</span>';
    const gap = settings.checkEvery - (runtime.floorCount() - checkBase(progress));
    return `<div class="pi-card"><h3>注入条目${book}<span class="pi-meta">≈${total} token</span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="preview">预览</button></h3>
        ${entries.filter(entry => entry.kind !== 'persona').length ? entries.filter(entry => entry.kind !== 'persona').map(entry => entryRow(entry, st.open === entry.slotId)).join('') : '<p class="pi-hint">设定和大纲都为空，没有可注入的内容。</p>'}
        </div>
        ${personaCard(view, project, progress, st)}
        <div class="pi-card"><h3>阶段<span class="pi-meta">${gap > 0 ? `${gap} 楼后检测` : '下一楼检测'}</span><span class="pi-spacer"></span>
            ${units.length ? `<button type="button" class="pi-btn is-sm is-ghost" data-act="index-toggle">${st.indexOpen ? '收起索引' : '剧情索引'}</button>` : ''}</h3>
        ${units.length ? `${st.indexOpen ? `<pre class="pi-pre pi-index">${esc(buildIndexText(units, states, progress, { carryOver: settings.carryOver, hookCap: settings.hookCap }))}</pre>` : ''}
        <div class="pi-pace"><span class="pi-pace-label">推进速度</span><div class="pi-seg">${PACES.map(pace => `<button type="button" class="pi-seg-btn${pace.value === progress.pace ? ' is-sel' : ''}" data-act="pace" data-pace="${pace.value}">${pace.label}</button>`).join('')}</div></div>
        ${switchRow(sw)}
        <div class="pi-tools is-c3">
            <button type="button" class="pi-btn is-primary is-sm" data-act="next">打开下一段</button>
            <button type="button" class="pi-btn is-sm" data-act="check"${checking ? ' disabled' : ''}>${checking ? '<span class="pi-spin"></span>检测中' : '立即检测'}</button>
            <button type="button" class="pi-btn is-sm" data-act="rewrite">改写后续</button></div>
        ${timeline(units, states, progress, settings.carryOver ? carriedNodes(units, states, progress, { withOff: true }) : [], liveOf(units, states, progress, settings), sw, st.expiredOpen)}` : '<p class="pi-hint">大纲为空。到「大纲」页导入剧情 YAML，或让 AI 写一卷。</p>'}
        </div>`;
}

function liveOf(units, states, progress, settings) {
    return liveThreads(units, states, progress, { carryOver: settings.carryOver, hookCap: settings.hookCap });
}

function viewLive(view) {
    const { runtime } = view;
    const units = maskUnits(runtime.units(), threadSwitches(view.project()));
    const progress = runtime.progress();
    return liveOf(units, unitStates(units, progress), progress, view.data.settings());
}

function setSlot(view, slotId, patch) {
    const { runtime } = view;
    runtime.setProgress(patchSlot(runtime.progress(), slotId, patch));
}

export const actions = {
    activate: view => view.runtime.switchProject(view.projectId, 'chat'),
    'activate-card': view => view.runtime.switchProject(view.projectId, 'card'),
    // 推进速度随聊天保存，改完立即换掉详细条目开头的说明。
    pace(view, target) {
        view.runtime.setProgress({ ...view.runtime.progress(), pace: target.dataset.pace });
        view.renderBody();
    },
    'index-toggle'(view) {
        const st = view.tabState('run');
        st.indexOpen = !st.indexOpen;
        view.renderBody();
    },
    'expired-toggle'(view) {
        const st = view.tabState('run');
        st.expiredOpen = !st.expiredOpen;
        view.renderBody();
    },
    'toggle-entry'(view, target, event) {
        if (event.target.closest('input,select')) return;
        const st = view.tabState('run');
        st.open = st.open === target.dataset.slot ? '' : target.dataset.slot;
        view.renderBody();
    },
    'persona-fold'(view, target) {
        const st = view.tabState('run');
        const set = new Set(st.personaFold || []);
        if (set.has(target.dataset.group)) set.delete(target.dataset.group);
        else set.add(target.dataset.group);
        st.personaFold = [...set];
        view.renderBody();
    },
    'persona-pick'(view, target) {
        const line = view.project().personas.lines.find(item => item.id === target.dataset.line);
        if (!line) return;
        view.runtime.setProgress(setPersonaStage(view.runtime.progress(), line, target.dataset.stage));
    },
    async 'persona-menu'(view, target) {
        const line = view.project().personas.lines.find(item => item.id === target.dataset.line);
        if (!line) return;
        const progress = view.runtime.progress();
        const pp = progress.personas || {};
        const muted = (pp.muted || []).includes(line.id);
        const manual = (pp.manual || []).includes(line.id);
        const items = [
            ...(line.mode !== 'manual' && manual ? [{ label: '恢复自动判断', value: 'release' }] : []),
            muted ? { label: '恢复提醒', value: 'unmute' } : { label: '不再提醒', value: 'mute' },
        ];
        const pick = await menuDialog({ title: line.name, items });
        if (!pick) return;
        view.runtime.setProgress(pick === 'release' ? releasePersona(progress, line.id) : mutePersona(progress, line.id, pick === 'mute'));
    },
    next: view => view.runtime.openNext(),
    check: view => view.runtime.checkNow({ manual: true }),
    // 行尾「⋯」：设为当前、手动改状态、恢复提醒。
    async 'unit-menu'(view, target) {
        const { runtime } = view;
        const id = target.dataset.unit;
        const unit = runtime.units().find(item => item.id === id);
        if (!unit) return;
        const progress = runtime.progress();
        const state = unitStates(runtime.units(), progress)[id];
        const manual = progress.slots[id] && progress.slots[id].state;
        const items = [
            ...(state === 'active' ? [] : [{ label: '设为当前', value: 'goto' }]),
            ...Object.entries(STATE_LABELS).filter(([value]) => value !== manual).map(([value, label]) => ({ label: `标为${label}`, value: `state:${value}` })),
            ...(manual ? [{ label: '恢复自动判断', value: 'state:' }] : []),
            ...(progress.muted.includes(id) ? [{ label: '恢复提醒', value: 'unmute' }] : []),
        ];
        const pick = await menuDialog({ title: stageLabel(unit.stage.key), items });
        if (!pick) return;
        if (pick === 'goto') return runtime.setProgress(goTo(progress, runtime.units(), id));
        if (pick === 'unmute') return runtime.setProgress({ ...progress, muted: progress.muted.filter(item => item !== id) });
        setSlot(view, id, { state: pick.slice(6) || undefined });
    },
    // 进度钟「⋯」：手动推进、倒退、标记已发生、重置。
    async 'clock-menu'(view, target) {
        const clock = viewLive(view).clocks.find(item => item.key === target.dataset.key);
        if (!clock) return;
        const items = clock.done ? [{ label: '重置', value: 'reset' }] : [
            ...(clock.filled < clock.total ? [{ label: '推进一格', value: 'up' }] : []),
            ...(clock.filled > 0 ? [{ label: '倒退一格', value: 'down' }] : []),
            { label: '标记已发生', value: 'done' },
            { label: '重置', value: 'reset' },
        ];
        const pick = await menuDialog({ title: `${clock.node.name} ${clock.filled}/${clock.total}`, items });
        if (!pick) return;
        const progress = view.runtime.progress();
        const patch = pick === 'reset' ? null : pick === 'done' ? { filled: clock.total, done: true } : { filled: Math.max(0, Math.min(clock.total, clock.filled + (pick === 'up' ? 1 : -1))) };
        view.runtime.setProgress(patchLive(progress, clock, patch));
    },
    // 支线钩子「⋯」：手动激活或退回待触发、支线链换步、恢复过期、标为过期。
    async 'hook-menu'(view, target) {
        const hook = viewLive(view).hooks.find(item => item.key === target.dataset.key);
        if (!hook) return;
        const open = hook.status === 'active' || hook.status === 'queue';
        const items = [
            ...(hook.status === 'wait' ? [{ label: '标为已激活', value: 'on' }] : []),
            ...(open && hook.pooled ? [{ label: '退回待触发', value: 'off' }] : []),
            ...(open && hook.step + 1 < hook.steps.length ? [{ label: '进入下一步', value: 'next' }] : []),
            ...(open && hook.step > 0 ? [{ label: '回到上一步', value: 'prev' }] : []),
            ...(hook.status === 'expired' ? [{ label: '恢复', value: 'restore' }] : []),
            ...(open && hook.limit ? [{ label: '标为过期', value: 'expire' }] : []),
            { label: hook.status === 'done' ? '恢复未演' : '标记已演', value: hook.status === 'done' ? 'unplay' : 'played' },
        ];
        if (!items.length) return;
        const pick = await menuDialog({ title: hook.carried ? `${hook.node.name}（来自${stageLabel(hook.unit.stage.key)}）` : hook.node.name, items });
        if (!pick) return;
        if (pick === 'played' || pick === 'unplay') return toggleNode(view, hook.unit.id, hook.node.id, pick === 'unplay');
        const floor = Math.max(1, view.runtime.floorCount());
        // 恢复：重新计时；条件钩子重新排进注入名额。「本卷」时限从恢复时所在的卷算到卷末。
        const restore = hook.pooled ? { at: floor, shownAt: undefined } : { since: floor };
        const patch = {
            on: { at: floor },
            off: { at: undefined, shownAt: undefined },
            next: { step: hook.step + 1 },
            prev: { step: hook.step - 1 },
            restore: { expired: undefined, ...restore, keepVol: hook.limit && hook.limit.volume ? viewLive(view).activeVol : undefined },
            expire: { expired: true },
        }[pick];
        view.runtime.setProgress(patchLive(view.runtime.progress(), hook, patch));
    },
    'node-toggle'(view, target) {
        const { unit, node } = target.dataset;
        const found = view.runtime.units().find(item => item.id === unit);
        toggleNode(view, unit, node, Boolean(found) && offNodes(view.runtime.progress(), found).includes(node));
    },
    'thread-switch'(view, target) {
        const key = target.dataset.key;
        view.data.updateProject(view.projectId, project => {
            const sw = threadSwitches(project);
            return { ...project, threads: { ...sw, [key]: !sw[key] } };
        });
        view.runtime.refresh();
        view.renderBody();
    },
    rewrite: view => startRewrite(view),
    preview(view) {
        const entries = view.runtime.entries().filter(entry => entry.enabled);
        const html = entries.length ? POSITIONS.map(pos => {
            const list = entries.filter(entry => entry.position === pos.value).sort((a, b) => a.order - b.order);
            if (!list.length) return '';
            return list.map(entry => `<p class="pi-hint">${esc(positionLabel(entry))} · ${esc(entry.title)} · 顺序 ${entry.order}</p><pre class="pi-pre">${esc(entry.content)}</pre>`).join('');
        }).join('') : '<p class="pi-hint">没有启用的条目。</p>';
        return openDialog({ title: '最终注入预览', html: `${html}`, actions: [{ label: '关闭', value: true, primary: true }] });
    },
};

export function onChange(view, target) {
    const { runtime } = view;
    if (target.dataset.pfixed) {
        runtime.setProgress(setFixedValue(runtime.progress(), target.dataset.pfixed, target.value));
        view.renderBody();
        return;
    }
    if (target.dataset.param) {
        const value = Math.round(Number(target.value));
        if (!Number.isFinite(value)) return;
        const { kind, param } = target.dataset;
        view.data.updateProject(view.projectId, project => ({ ...project, defaults: { ...DEFAULT_PARAMS, ...project.defaults, [kind]: { ...DEFAULT_PARAMS[kind], ...project.defaults[kind], [param]: param === 'depth' || param === 'order' ? Math.max(0, value) : value } } }));
        runtime.refresh();
        view.renderBody();
        return;
    }
    if (target.dataset.slotField === 'enabled') {
        setSlot(view, target.dataset.slot, { enabled: target.checked });
        view.renderBody();
        return;
    }
}
