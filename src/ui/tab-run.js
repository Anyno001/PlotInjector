import { DEFAULT_PARAMS, PACES, POSITIONS, ROLES, buildIndexText, carriedNodes, positionLabel } from '../core/inject.js';
import { flattenUnits, stageLabel, stageNodes, volumeLabel } from '../core/outline.js';
import { STATE_LABELS, goTo, offNodes, patchSlot, setNodeChecked, unitStates } from '../core/progress.js';
import { estimateTokens } from '../core/tokens.js';
import { cardKey, cardName } from '../host/st.js';
import { esc, openDialog, options } from './dom.js';
import { startRewrite } from './tab-outline.js';

const STATE_BADGE = { done: '', active: 'is-accent', next: 'is-warn', todo: '' };

function entryRow(entry, expanded) {
    const tokens = estimateTokens(entry.content);
    const atDepth = entry.position === 4;
    const body = expanded ? `<div class="pi-entry-bd">
        <div class="pi-pair ${atDepth ? 'is-c4' : ''}">
            <label class="pi-field"><span>位置</span><select class="pi-sel" data-slot="${esc(entry.slotId)}" data-slot-field="position">${options(POSITIONS, entry.position)}</select></label>
            ${atDepth ? `<label class="pi-field"><span>深度</span><input class="pi-inp" type="number" min="0" data-slot="${esc(entry.slotId)}" data-slot-field="depth" value="${entry.depth}"></label>
            <label class="pi-field"><span>角色</span><select class="pi-sel" data-slot="${esc(entry.slotId)}" data-slot-field="role">${options(ROLES, entry.role)}</select></label>` : ''}
            <label class="pi-field"><span>顺序</span><input class="pi-inp" type="number" data-slot="${esc(entry.slotId)}" data-slot-field="order" value="${entry.order}"></label>
        </div>
        <div class="pi-tools is-c2">
            <button type="button" class="pi-btn is-sm" data-act="save-default" data-slot="${esc(entry.slotId)}" data-kind="${entry.kind}">设为本项目默认</button>
            <button type="button" class="pi-btn is-sm" data-act="reset-slot" data-slot="${esc(entry.slotId)}">恢复默认</button>
        </div>
        <pre class="pi-pre">${esc(entry.content)}</pre></div>` : '';
    return `<div class="pi-entry${entry.enabled ? '' : ' is-off'}">
        <div class="pi-entry-hd" data-act="toggle-entry" data-slot="${esc(entry.slotId)}">
            <span class="pi-badge is-dark">${esc(positionLabel(entry))}</span>
            <span class="pi-etitle">${esc(entry.title)}</span>
            <span class="pi-badge">顺序 ${entry.order}</span><span class="pi-badge">≈${tokens}</span>
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
    return `<div class="pi-card-sub">${nodes.map(node => nodeCheck(unit.id, node, off.has(node.id))).join('')}
        ${carried.length ? `<p class="pi-hint">延续自前面阶段</p>${carried.map(item => nodeCheck(item.unit.id, item.node, false, stageLabel(item.unit.stage.key))).join('')}` : ''}</div>`;
}

function unitList(units, states, progress, carried) {
    let lastVol = null;
    const stateOpts = [{ value: '', label: '自动' }, ...Object.entries(STATE_LABELS).map(([value, label]) => ({ value, label }))];
    return units.map(unit => {
        const head = unit.volume !== lastVol ? `<div class="pi-vol-hd">${esc(volumeLabel(unit.volume.key))}</div>` : '';
        lastVol = unit.volume;
        const state = states[unit.id];
        const manual = progress.slots[unit.id] && progress.slots[unit.id].state || '';
        const muted = progress.muted.includes(unit.id);
        const range = unit.stage.data && unit.stage.data.时间范围;
        return `${head}<div class="pi-unit${state === 'active' ? ' is-active' : ''}">
            <span class="pi-badge ${STATE_BADGE[state]}">${STATE_LABELS[state]}</span>
            <span class="pi-uname" title="${esc(range || '')}">${esc(stageLabel(unit.stage.key))}${muted ? ` <button type="button" class="pi-badge is-warn pi-unmute" data-act="unmute" data-unit="${esc(unit.id)}" title="点击恢复提醒">不再提醒</button>` : ''}</span>
            <select class="pi-sel" data-unit-state="${esc(unit.id)}" title="手动改状态">${options(stateOpts, manual)}</select>
            <span class="pi-unit-act">${state === 'active' ? '' : `<button type="button" class="pi-btn is-sm" data-act="goto" data-unit="${esc(unit.id)}">设为当前</button>`}</span>
        </div>${state === 'active' ? nodeList(unit, progress, carried) : ''}`;
    }).join('');
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
            <p class="pi-hint">「${esc(cardName())}」${other ? `当前启用的是「${esc(other.name)}」` : '还没有启用项目'}。</p>
            <button type="button" class="pi-btn is-primary" data-act="activate">设为本卡当前项目</button></div>`;
    }
    const progress = runtime.progress();
    const entries = runtime.entries();
    const units = flattenUnits(project.outline.volumes);
    const states = unitStates(units, progress);
    const total = entries.filter(entry => entry.enabled).reduce((sum, entry) => sum + estimateTokens(entry.content), 0);
    const mode = runtime.injectMode() === 'virtual' ? '<span class="pi-badge is-ok">虚拟条目</span>' : '<span class="pi-badge is-warn">专用世界书</span>';
    const settings = data.settings();
    const checking = runtime.isChecking();
    const checkInfo = `每 ${settings.checkEvery} 楼检测 · 上次第 ${progress.lastCheckFloor} 楼 · 当前 ${runtime.floorCount()} 楼`;
    return `<div class="pi-card"><h3>注入条目 ${mode}<span class="pi-spacer"></span><span class="pi-badge">共 ≈${total} token</span></h3>
        <div class="pi-tools is-c1"><button type="button" class="pi-btn is-sm" data-act="preview">预览最终注入</button></div>
        ${entries.length ? entries.map(entry => entryRow(entry, st.open === entry.slotId)).join('') : '<p class="pi-hint">设定和大纲都为空，没有可注入的内容。</p>'}
        </div>
        ${units.length ? `<div class="pi-card"><h3>剧情索引<span class="pi-badge">不注入正文</span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="index-toggle">${st.indexOpen ? '收起' : '查看'}</button></h3>
            ${st.indexOpen ? `<pre class="pi-pre">${esc(buildIndexText(units, states, progress, { carryOver: settings.carryOver }))}</pre>` : ''}</div>` : ''}
        <div class="pi-card"><h3>阶段<span class="pi-spacer"></span><span class="pi-hint">${esc(checkInfo)}</span></h3>
        ${units.length ? `<div class="pi-pace"><span class="pi-pace-label">推进速度</span><div class="pi-seg">${PACES.map(pace => `<button type="button" class="pi-seg-btn${pace.value === progress.pace ? ' is-sel' : ''}" data-act="pace" data-pace="${pace.value}">${pace.label}</button>`).join('')}</div></div>
        <div class="pi-tools is-c3">
            <button type="button" class="pi-btn is-primary is-sm" data-act="next">打开下一段</button>
            <button type="button" class="pi-btn is-sm" data-act="check"${checking ? ' disabled' : ''}>${checking ? '<span class="pi-spin"></span>检测中' : '立即检测'}</button>
            <button type="button" class="pi-btn is-sm" data-act="rewrite">让 AI 改写后续阶段</button></div>
            <div class="pi-units">${unitList(units, states, progress, settings.carryOver ? carriedNodes(units, states, progress) : [])}</div>` : '<p class="pi-hint">大纲为空。到「大纲」页导入剧情 YAML，或让 AI 写一卷。</p>'}
        </div>`;
}

function setSlot(view, slotId, patch) {
    const { runtime } = view;
    runtime.setProgress(patchSlot(runtime.progress(), slotId, patch));
}

export const actions = {
    activate: view => view.runtime.switchProject(view.projectId),
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
    'save-default'(view, target) {
        const entry = view.runtime.entries().find(item => item.slotId === target.dataset.slot);
        if (!entry) return;
        const kind = target.dataset.kind;
        const params = { position: entry.position, depth: entry.depth, role: entry.role, order: entry.order, enabled: entry.enabled };
        view.data.updateProject(view.projectId, project => ({ ...project, defaults: { ...DEFAULT_PARAMS, ...project.defaults, [kind]: params } }));
        actions['reset-slot'](view, target);
    },
    'reset-slot'(view, target) {
        setSlot(view, target.dataset.slot, { position: undefined, depth: undefined, role: undefined, order: undefined, enabled: undefined });
    },
    next: view => view.runtime.openNext(),
    check: view => view.runtime.checkNow({ manual: true }),
    goto(view, target) {
        const { runtime } = view;
        runtime.setProgress(goTo(runtime.progress(), runtime.units(), target.dataset.unit));
    },
    unmute(view, target) {
        const progress = view.runtime.progress();
        view.runtime.setProgress({ ...progress, muted: progress.muted.filter(id => id !== target.dataset.unit) });
    },
    rewrite: view => startRewrite(view),
    preview(view) {
        const entries = view.runtime.entries().filter(entry => entry.enabled);
        const html = entries.length ? POSITIONS.map(pos => {
            const list = entries.filter(entry => entry.position === pos.value).sort((a, b) => a.order - b.order);
            if (!list.length) return '';
            return list.map(entry => `<p class="pi-hint"><span class="pi-badge is-dark">${esc(positionLabel(entry))}</span> ${esc(entry.title)} · 顺序 ${entry.order}</p><pre class="pi-pre">${esc(entry.content)}</pre>`).join('');
        }).join('') : '<p class="pi-hint">没有启用的条目。</p>';
        return openDialog({ title: '最终注入预览', html: `${html}`, actions: [{ label: '关闭', value: true, primary: true }] });
    },
};

export function onChange(view, target) {
    const { runtime } = view;
    if (target.dataset.slotField) {
        const field = target.dataset.slotField;
        const value = field === 'enabled' ? target.checked : Number(target.value);
        if (field !== 'enabled' && !Number.isFinite(value)) return;
        setSlot(view, target.dataset.slot, { [field]: value });
        view.renderBody();
        return;
    }
    if (target.dataset.node) {
        runtime.setProgress(setNodeChecked(runtime.progress(), target.dataset.unit, target.dataset.node, target.checked));
        return;
    }
    if (target.dataset.unitState !== undefined) {
        setSlot(view, target.dataset.unitState, { state: target.value || undefined });
    }
}

