import { POSITIONS, ROLES } from '../core/inject.js';
import { flattenUnits, makeId, stageLabel, volumeLabel } from '../core/outline.js';
import { PERSONA_MODES, currentStage, groupLines, newLine, newStage, personaEnv } from '../core/personas.js';
import { emptyProgress } from '../core/progress.js';
import { estimateTokens } from '../core/tokens.js';
import { confirmDialog, esc, options } from './dom.js';
import { ICONS } from './styles.js';
import { openImport, restoreImported } from './persona-import.js';

// 人设页签：按角色折叠，每条线一张卡，展开后编辑注入参数、公共文字与阶段列表。
const st = view => view.tabState('persona');
const modeLabel = value => (PERSONA_MODES.find(item => item.value === value) || PERSONA_MODES[0]).label;
const SOURCE_NOTE = { manual: '手动', check: '', outline: '', fame: '' };

function personas(view) {
    return view.project().personas;
}

function patchPersonas(view, fn) {
    view.data.updateProject(view.projectId, project => ({ ...project, personas: fn(project.personas) }));
    view.runtime.refresh();
}

function patchLine(view, lineId, fn) {
    patchPersonas(view, all => ({ ...all, lines: all.lines.map(line => (line.id === lineId ? fn(line) : line)) }));
}

function patchStage(view, lineId, stageId, fn) {
    patchLine(view, lineId, line => ({ ...line, stages: line.stages.map(stage => (stage.id === stageId ? fn(stage) : stage)) }));
}

// 当前聊天没在用本项目时，进度当作空白，不读声望。
export function stageInfo(view, line) {
    const project = view.project();
    const active = view.runtime.activeId() === view.projectId;
    const progress = active ? view.runtime.progress() : emptyProgress(view.projectId);
    return currentStage(line, progress, personaEnv(project, progress, active ? view.runtime.fame() : []));
}

const keyText = line => line.keys.join('，');
const splitKeys = value => String(value || '').split(/[,，、\n]/).map(item => item.trim()).filter(Boolean);
const field = (label, body) => `<label class="pi-field"><span>${label}</span>${body}</label>`;
const input = (attrs, value, extra = '') => `<input class="pi-inp" ${attrs} value="${esc(value)}"${extra}>`;

function stageHtml(view, line, stage, index, current, units) {
    const attrs = name => `data-pl="${esc(line.id)}" data-ps="${esc(stage.id)}" data-f="${name}"`;
    const act = (name, icon, title, disabled = false) => `<button type="button" class="pi-icon-btn${name === 'ps-del' ? ' is-danger' : ''}" data-act="${name}" data-line="${esc(line.id)}" data-stage="${esc(stage.id)}" title="${title}"${disabled ? ' disabled' : ''}>${icon}</button>`;
    const extra = line.mode === 'check' ? field('进入条件', input(attrs('cond'), stage.cond, ' placeholder="如：主角出手帮了她，她开始动摇"')) : line.mode === 'outline'
        ? field('跟随大纲阶段', `<select class="pi-sel" ${attrs('unitId')}>${options([{ value: '', label: '不绑定（跳过）' }, ...units.map(unit => ({ value: unit.id, label: `${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}` }))], stage.unitId)}</select>`)
        : line.mode === 'fame' ? `<div class="pi-pair">${field('声望下限', input(`${attrs('min')} type="number"`, stage.range.min ?? ''))}${field('声望上限', input(`${attrs('max')} type="number"`, stage.range.max ?? ''))}</div>` : '';
    return `<div class="pi-node pi-ps">
        <div class="pi-node-hd">${index === current ? '<span class="pi-badge is-accent">当前</span>' : ''}${input(attrs('name'), stage.name)}
            ${act('ps-up', ICONS.arrowUp, '上移', index === 0)}${act('ps-down', ICONS.arrowDown, '下移', index === line.stages.length - 1)}${act('ps-del', ICONS.trash, '删除阶段', line.stages.length <= 1)}</div>
        ${extra}
        ${field(`人设内容 ≈${estimateTokens(stage.text)}`, `<textarea class="pi-ta" rows="6" ${attrs('text')}>${esc(stage.text)}</textarea>`)}</div>`;
}

function lineBody(view, line, units) {
    const attrs = name => `data-pl="${esc(line.id)}" data-f="${name}"`;
    const atDepth = line.position === 4;
    const info = stageInfo(view, line);
    const fameBody = line.mode === 'fame' ? `<datalist id="pi-fame-list">${view.runtime.fame().map(bar => `<option value="${esc(bar.name)}"></option>`).join('')}</datalist>
        <div class="pi-pair">${field('声望条名称', input(`${attrs('fameBar')} list="pi-fame-list"`, line.fame.bar))}${field('对象（可空）', input(attrs('famePartner'), line.fame.partner))}</div>
        <p class="pi-hint">读不到声望值时沿用手动选择的阶段。</p>` : '';
    return `<div class="pi-entry-bd">
        <div class="pi-pair">${field('线名', input(attrs('name'), line.name))}${field('角色（分组）', input(attrs('group'), line.group))}</div>
        <label class="pi-field"><span>切换方式</span><select class="pi-sel" ${attrs('mode')}>${options(PERSONA_MODES, line.mode)}</select></label>
        ${fameBody}
        <div class="pi-pair">${field('触发方式', `<select class="pi-sel" ${attrs('constant')}>${options([{ value: '1', label: '常驻' }, { value: '0', label: '关键词触发' }], line.constant ? '1' : '0')}</select>`)}
            ${line.constant ? '' : field('关键词（逗号分隔）', input(attrs('keys'), keyText(line)))}</div>
        <div class="pi-pair ${atDepth ? 'is-c4' : ''}">
            ${field('位置', `<select class="pi-sel" ${attrs('position')}>${options(POSITIONS, line.position)}</select>`)}
            ${atDepth ? `${field('深度', input(`${attrs('depth')} type="number" min="0"`, line.depth))}${field('角色', `<select class="pi-sel" ${attrs('role')}>${options(ROLES, line.role)}</select>`)}` : ''}
            ${field('顺序', input(`${attrs('order')} type="number"`, line.order))}</div>
        ${field(`公共文字（在阶段内容之前）≈${estimateTokens(line.common)}`, `<textarea class="pi-ta" rows="4" ${attrs('common')}>${esc(line.common)}</textarea>`)}
        <div class="pi-wb-sec-hd">阶段<small>${line.stages.length}</small></div>
        ${line.stages.map((stage, index) => stageHtml(view, line, stage, index, info.index, units)).join('')}
        <div class="pi-tools is-c2 is-end"><button type="button" class="pi-btn is-sm" data-act="ps-add" data-line="${esc(line.id)}">${ICONS.plus}添加阶段</button>
            <button type="button" class="pi-btn is-sm is-danger" data-act="pl-del" data-line="${esc(line.id)}">删除这条线</button></div></div>`;
}

function lineRow(view, line, open, units) {
    const info = stageInfo(view, line);
    const note = info.source === 'manual' && line.mode !== 'manual' ? '手动' : SOURCE_NOTE[info.source] || '';
    return `<div class="pi-entry${line.enabled ? '' : ' is-off'}">
        <div class="pi-entry-hd" data-act="pl-open" data-line="${esc(line.id)}">${open ? ICONS.caretDown : ICONS.caret}
            <span class="pi-etitle">${esc(line.name)}</span><span class="pi-badge">${esc(modeLabel(line.mode))}</span>
            <span class="pi-meta">${esc(info.stage ? info.stage.name : '')}${note ? ` · ${note}` : ''}</span>
            <input type="checkbox" title="启用" data-pl-on="${esc(line.id)}"${line.enabled ? ' checked' : ''}></div>${open ? lineBody(view, line, units) : ''}</div>`;
}

function fixedCard(view, all) {
    const rows = all.fixed.map(item => `<div class="pi-node"><div class="pi-node-hd">${input(`data-pf="${esc(item.id)}" data-f="name"`, item.name, ' placeholder="选项名，正文里写成 {{选项名}}"')}
        <button type="button" class="pi-icon-btn is-danger" data-act="fx-del" data-fixed="${esc(item.id)}" title="删除">${ICONS.trash}</button></div>
        ${field('可选值（逗号分隔）', input(`data-pf="${esc(item.id)}" data-f="options"`, item.options.join('，')))}</div>`).join('');
    return `<div class="pi-card"><h3>固定选项<span class="pi-meta">每个聊天选一次</span><span class="pi-spacer"></span>
        <button type="button" class="pi-btn is-sm is-ghost" data-act="fx-add">${ICONS.plus}添加</button></h3>
        ${rows || '<p class="pi-hint">没有固定选项。主角性别这类整段文字替换的选择写在这里，文中用 {{选项名}} 引用。</p>'}</div>`;
}

function importedCard(all) {
    const rows = all.imported.map((item, index) => `<div class="pi-wb-row"><span class="pi-wb-title" title="${esc(item.book)}">${esc(item.title || item.key)}<small> ${esc(item.book)}</small></span>
        <button type="button" class="pi-btn is-sm" data-act="imp-restore" data-i="${index}">恢复</button></div>`).join('');
    return `<div class="pi-card"><h3>世界书转入<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm" data-act="imp-open">转入人设</button></h3>
        ${rows || '<p class="pi-hint">还没有从世界书转入过条目。</p>'}${rows ? '<p class="pi-hint">转入时关闭了原条目，点恢复可重新开启。</p>' : ''}</div>`;
}

export function render(view) {
    const project = view.project();
    const all = personas(view);
    const s = st(view);
    const units = flattenUnits(project.outline.volumes);
    const collapsed = new Set(s.collapsed || []);
    const groups = groupLines(all.lines).map(group => {
        const key = group.name || '::none';
        const shut = collapsed.has(key);
        const head = `<button type="button" class="pi-group-hd" data-act="pg-fold" data-group="${esc(key)}">${shut ? ICONS.caret : ICONS.caretDown}${esc(group.name || '未分组')}<small>${group.lines.length}</small></button>`;
        return `<div class="pi-group${shut ? ' is-collapsed' : ''}">${head}${shut ? '' : group.lines.map(line => lineRow(view, line, s.open === line.id, units)).join('')}</div>`;
    }).join('');
    return `<div class="pi-card"><h3>人设<span class="pi-meta">${all.lines.length} 条线</span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-primary" data-act="pl-add">${ICONS.plus}新建人设线</button></h3>
        ${groups || '<p class="pi-hint">还没有人设线。新建一条，或从世界书转入。</p>'}</div>
        ${fixedCard(view, all)}
        ${importedCard(all)}`;
}

const LINE_PATCH = {
    name: value => ({ name: value.trim() || '未命名' }),
    group: value => ({ group: value.trim() }),
    mode: value => ({ mode: value }),
    constant: value => ({ constant: value === '1' }),
    keys: value => ({ keys: splitKeys(value) }),
    position: value => ({ position: Number(value) }),
    role: value => ({ role: Number(value) }),
    depth: value => ({ depth: Math.max(0, Math.round(Number(value) || 0)) }),
    order: value => ({ order: Math.round(Number(value) || 0) }),
    common: value => ({ common: value }),
};

const STAGE_PATCH = {
    name: value => ({ name: value.trim() || '阶段' }),
    cond: value => ({ cond: value }),
    unitId: value => ({ unitId: value }),
    text: value => ({ text: value }),
};

function rangePatch(stage, which, value) {
    const range = { ...stage.range };
    if (String(value).trim() === '' || !Number.isFinite(Number(value))) delete range[which];
    else range[which] = Number(value);
    return { range };
}

export function onChange(view, target) {
    const d = target.dataset;
    if (d.plOn) {
        patchLine(view, d.plOn, line => ({ ...line, enabled: target.checked }));
        return view.renderBody();
    }
    if (d.pf) {
        const parse = d.f === 'options' ? { options: [...new Set(String(target.value).split(/[,，、\n]/).map(item => item.trim()).filter(Boolean))] } : { name: target.value.trim() };
        patchPersonas(view, all => ({ ...all, fixed: all.fixed.map(item => (item.id === d.pf ? { ...item, ...parse } : item)) }));
        return view.renderBody();
    }
    if (!d.pl) return undefined;
    if (d.ps) {
        patchStage(view, d.pl, d.ps, stage => ({ ...stage, ...(d.f === 'min' || d.f === 'max' ? rangePatch(stage, d.f, target.value) : (STAGE_PATCH[d.f] || (() => ({})))(target.value)) }));
    } else if (d.f === 'fameBar' || d.f === 'famePartner') {
        patchLine(view, d.pl, line => ({ ...line, fame: { ...line.fame, [d.f === 'fameBar' ? 'bar' : 'partner']: target.value.trim() } }));
    } else if (LINE_PATCH[d.f]) {
        patchLine(view, d.pl, line => ({ ...line, ...LINE_PATCH[d.f](target.value) }));
    }
    return view.renderBody();
}

function moveStage(view, lineId, stageId, step) {
    patchLine(view, lineId, line => {
        const from = line.stages.findIndex(stage => stage.id === stageId);
        const to = from + step;
        if (from < 0 || to < 0 || to >= line.stages.length) return line;
        const stages = [...line.stages];
        [stages[from], stages[to]] = [stages[to], stages[from]];
        return { ...line, stages };
    });
    view.renderBody();
}

export const actions = {
    'pl-open'(view, target, event) {
        if (event.target.closest('input')) return;
        const s = st(view);
        s.open = s.open === target.dataset.line ? '' : target.dataset.line;
        view.renderBody();
    },
    'pg-fold'(view, target) {
        const s = st(view);
        const set = new Set(s.collapsed || []);
        if (set.has(target.dataset.group)) set.delete(target.dataset.group);
        else set.add(target.dataset.group);
        s.collapsed = [...set];
        view.renderBody();
    },
    'pl-add'(view) {
        const line = newLine('新人设线', '');
        patchPersonas(view, all => ({ ...all, lines: [...all.lines, line] }));
        const s = st(view);
        s.open = line.id;
        s.collapsed = (s.collapsed || []).filter(key => key !== '::none');
        view.renderBody();
    },
    async 'pl-del'(view, target) {
        const line = personas(view).lines.find(item => item.id === target.dataset.line);
        if (!line || !(await confirmDialog({ title: `删除「${line.name}」`, body: '这条人设线连同全部阶段一并删除。', okLabel: '删除', danger: true }))) return;
        patchPersonas(view, all => ({ ...all, lines: all.lines.filter(item => item.id !== line.id) }));
        view.renderBody();
    },
    'ps-add'(view, target) {
        patchLine(view, target.dataset.line, line => ({ ...line, stages: [...line.stages, newStage(`阶段${line.stages.length + 1}`)] }));
        view.renderBody();
    },
    'ps-del'(view, target) {
        patchLine(view, target.dataset.line, line => ({ ...line, stages: line.stages.length > 1 ? line.stages.filter(stage => stage.id !== target.dataset.stage) : line.stages }));
        view.renderBody();
    },
    'ps-up': (view, target) => moveStage(view, target.dataset.line, target.dataset.stage, -1),
    'ps-down': (view, target) => moveStage(view, target.dataset.line, target.dataset.stage, 1),
    async 'imp-open'(view) {
        if (await openImport(view)) view.renderBody();
    },
    async 'imp-restore'(view, target) {
        const item = personas(view).imported[Number(target.dataset.i)];
        if (item && (await restoreImported(view, item))) view.renderBody();
    },
    'fx-add'(view) {
        patchPersonas(view, all => ({ ...all, fixed: [...all.fixed, { id: makeId('pf'), name: `选项${all.fixed.length + 1}`, options: ['甲', '乙'], varPath: '' }] }));
        view.renderBody();
    },
    'fx-del'(view, target) {
        patchPersonas(view, all => ({ ...all, fixed: all.fixed.filter(item => item.id !== target.dataset.fixed) }));
        view.renderBody();
    },
};
