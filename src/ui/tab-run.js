import { DEFAULT_PARAMS, PACES, POSITIONS, ROLES, buildIndexText, carriedNodes, positionLabel } from '../core/inject.js';
import { flattenUnits, stageLabel, stageNodes, volumeLabel } from '../core/outline.js';
import { STATE_LABELS, goTo, offNodes, patchSlot, setNodeChecked, unitStates } from '../core/progress.js';
import { estimateTokens } from '../core/tokens.js';
import { cardKey, cardName } from '../host/st.js';
import { esc, menuDialog, openDialog, options } from './dom.js';
import { ICONS } from './styles.js';
import { startRewrite } from './tab-outline.js';

// 位置、深度、角色、顺序改的是本项目的默认，所有阶段一起生效；只有启用开关按段记。
function entryRow(entry, expanded) {
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

const nodeCheck = (unitId, node, off, from = '') => `<label class="pi-check${off ? ' is-off' : ''}">
        <input type="checkbox" data-node="${esc(node.id)}" data-unit="${esc(unitId)}"${off ? '' : ' checked'}>
        <span><span class="pi-badge">${esc(node.label)}</span> ${esc(node.name)}${from ? ` <span class="pi-hint">来自${esc(from)}</span>` : ''}</span></label>`;

// carried：已过阶段里没演的支线与世界动态，取消勾选即不再延续。
function nodeList(unit, progress, carried) {
    const off = new Set(offNodes(progress, unit.id));
    const nodes = stageNodes(unit.stage.data);
    if (!nodes.length && !carried.length) return '';
    return `<div class="pi-tl-nodes">${nodes.map(node => nodeCheck(unit.id, node, off.has(node.id))).join('')}
        ${carried.length ? `<p class="pi-hint">延续自前面阶段</p>${carried.map(item => nodeCheck(item.unit.id, item.node, false, stageLabel(item.unit.stage.key))).join('')}` : ''}</div>`;
}

// 阶段时间线：每卷一条，粗环为阶段，已过的实心、走过的连线为实线，之后为虚线。
// 进行中只有圆点用强调色；手动改状态、设为当前、恢复提醒收进行尾的「⋯」。
function timeline(units, states, progress, carried) {
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
            ${state === 'active' ? nodeList(unit, progress, carried) : ''}</div></div>`;
    };
    return groups.map(group => `<div class="pi-tl-vol">${esc(volumeLabel(group.volume.key))}</div><div class="pi-tl">${group.units.map(item).join('')}</div>`).join('');
}

export function render(view) {
    const { data, runtime } = view;
    const project = view.project();
    const st = view.tabState('run');
    if (!cardKey()) return '<div class="pi-empty">先打开一张角色卡的聊天，再启用项目。</div>';
    const activeId = runtime.activeId();
    if (activeId !== project.id) {
        const other = data.index().projects.find(item => item.id === activeId);
        return `<div class="pi-card"><h3>启用</h3>
            <p class="pi-hint">${other ? `当前聊天使用的是「${esc(other.name)}」` : `「${esc(cardName())}」还没有启用项目`}。</p>
            <div class="pi-tools is-c2">
                <button type="button" class="pi-btn is-primary" data-act="activate">设为当前聊天使用</button>
                <button type="button" class="pi-btn" data-act="activate-card">设为本卡默认</button></div></div>`;
    }
    const progress = runtime.progress();
    const entries = runtime.entries();
    const units = flattenUnits(project.outline.volumes);
    const states = unitStates(units, progress);
    const total = entries.filter(entry => entry.enabled).reduce((sum, entry) => sum + estimateTokens(entry.content), 0);
    const settings = data.settings();
    const checking = runtime.isChecking();
    const book = runtime.injectMode() === 'virtual' ? '' : '<span class="pi-badge is-warn">专用世界书</span>';
    const gap = settings.checkEvery - (runtime.floorCount() - progress.lastCheckFloor);
    return `<div class="pi-card"><h3>注入条目${book}<span class="pi-meta">≈${total} token</span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="preview">预览</button></h3>
        ${entries.length ? entries.map(entry => entryRow(entry, st.open === entry.slotId)).join('') : '<p class="pi-hint">设定和大纲都为空，没有可注入的内容。</p>'}
        </div>
        <div class="pi-card"><h3>阶段<span class="pi-meta">${gap > 0 ? `${gap} 楼后检测` : '下一楼检测'}</span><span class="pi-spacer"></span>
            ${units.length ? `<button type="button" class="pi-btn is-sm is-ghost" data-act="index-toggle">${st.indexOpen ? '收起索引' : '剧情索引'}</button>` : ''}</h3>
        ${units.length ? `${st.indexOpen ? `<pre class="pi-pre pi-index">${esc(buildIndexText(units, states, progress, { carryOver: settings.carryOver }))}</pre>` : ''}
        <div class="pi-pace"><span class="pi-pace-label">推进速度</span><div class="pi-seg">${PACES.map(pace => `<button type="button" class="pi-seg-btn${pace.value === progress.pace ? ' is-sel' : ''}" data-act="pace" data-pace="${pace.value}">${pace.label}</button>`).join('')}</div></div>
        <div class="pi-tools is-c3">
            <button type="button" class="pi-btn is-primary is-sm" data-act="next">打开下一段</button>
            <button type="button" class="pi-btn is-sm" data-act="check"${checking ? ' disabled' : ''}>${checking ? '<span class="pi-spin"></span>检测中' : '立即检测'}</button>
            <button type="button" class="pi-btn is-sm" data-act="rewrite">改写后续</button></div>
        ${timeline(units, states, progress, settings.carryOver ? carriedNodes(units, states, progress) : [])}` : '<p class="pi-hint">大纲为空。到「大纲」页导入剧情 YAML，或让 AI 写一卷。</p>'}
        </div>`;
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
    'toggle-entry'(view, target, event) {
        if (event.target.closest('input,select')) return;
        const st = view.tabState('run');
        st.open = st.open === target.dataset.slot ? '' : target.dataset.slot;
        view.renderBody();
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
    if (target.dataset.node) {
        runtime.setProgress(setNodeChecked(runtime.progress(), target.dataset.unit, target.dataset.node, target.checked));
    }
}

