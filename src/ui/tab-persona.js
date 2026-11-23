import { POSITIONS, ROLES } from '../core/inject.js';
import { flattenUnits, stageLabel, volumeName } from '../core/outline.js';
import { FAVOR_DIMS, PERSONA_MODES, currentStage, fameReading, groupLines, newLine, newStage, personaEnv, personaNote } from '../core/personas.js';
import { emptyProgress } from '../core/progress.js';
import { estimateTokens } from '../core/tokens.js';
import { buildPersonaFile, mergePersonaLines, parsePersonaFile } from '../core/persona-file.js';
import { downloadBlob, toast } from '../host/st.js';
import { choiceDialog, confirmDialog, esc, menuDialog, options, pickFiles } from './dom.js';
import { ICONS } from './styles.js';
import { openImport, restoreImported } from './persona-import.js';

// 人设页签：按角色折叠，每条线一张卡，展开后编辑注入参数、公共文字与阶段列表。
const st = view => view.tabState('persona');
const modeLabel = value => (PERSONA_MODES.find(item => item.value === value) || PERSONA_MODES[0]).label;

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
    const info = currentStage(line, progress, personaEnv(project, progress, active ? view.runtime.fame() : [], active ? view.runtime.personaStates() : null));
    return { ...info, active, note: active ? personaNote(line, progress, info) : '' };
}

const keyText = line => line.keys.join('，');
import { splitKeys } from '../core/wbtools.js';
const field = (label, body) => `<label class="pi-field"><span>${label}</span>${body}</label>`;
const input = (attrs, value, extra = '') => `<input class="pi-inp" ${attrs} value="${esc(value)}"${extra}>`;

// 附加数值条件：同时满足才进该阶段；只在读角色关系数值时可用。
function extraHtml(attrs, line, stage) {
    if (line.fame.source !== 'favor') return '';
    const rows = (stage.extra || []).map((item, i) => `<div class="pi-extra">${field('同时要求', `<select class="pi-sel" ${attrs('extraDim')} data-i="${i}">${options(FAVOR_DIMS.map(value => ({ value, label: value })), item.dim)}</select>`)}${field(`${item.dim}下限`, input(`${attrs('extraMin')} data-i="${i}" type="number"`, item.min ?? ''))}${field(`${item.dim}上限`, input(`${attrs('extraMax')} data-i="${i}" type="number"`, item.max ?? ''))}<button type="button" class="pi-icon-btn is-danger" data-act="extra-del" data-line="${esc(line.id)}" data-stage="${esc(stage.id)}" data-i="${i}" title="删除这条">${ICONS.trash}</button></div>`).join('');
    return `${rows}<div class="pi-tools is-c1"><button type="button" class="pi-btn is-sm" data-act="extra-add" data-line="${esc(line.id)}" data-stage="${esc(stage.id)}">${ICONS.plus}同时满足另一项数值</button></div>`;
}

function stageHtml(view, line, stage, index, current, units) {
    const attrs = name => `data-pl="${esc(line.id)}" data-ps="${esc(stage.id)}" data-f="${name}"`;
    const act = (name, icon, title, disabled = false) => `<button type="button" class="pi-icon-btn${name === 'ps-del' ? ' is-danger' : ''}" data-act="${name}" data-line="${esc(line.id)}" data-stage="${esc(stage.id)}" title="${title}"${disabled ? ' disabled' : ''}>${icon}</button>`;
    const extra = line.mode === 'check' ? field('进入条件', input(attrs('cond'), stage.cond, ' placeholder="如：主角出手帮了她，她开始动摇"')) : line.mode === 'outline'
        ? field('跟随大纲阶段', `<select class="pi-sel" ${attrs('unitId')}>${options([{ value: '', label: '不绑定（跳过）' }, ...units.map(unit => ({ value: unit.id, label: `${volumeName(unit.volume.key)} ${stageLabel(unit.stage.key)}` }))], stage.unitId)}</select>`)
        : line.mode === 'fame' ? `<div class="pi-pair">${field(line.fame.source === 'favor' ? `${line.fame.dim}下限` : '声望下限', input(`${attrs('min')} type="number"`, stage.range.min ?? ''))}${field(line.fame.source === 'favor' ? `${line.fame.dim}上限` : '声望上限', input(`${attrs('max')} type="number"`, stage.range.max ?? ''))}</div>${extraHtml(attrs, line, stage)}${field('进入条件（可空，写了要检测确认后才进）', input(attrs('cond'), stage.cond, ' placeholder="如：已经发生过表白"'))}` : '';
    return `<div class="pi-node pi-ps">
        <div class="pi-node-hd">${index === current ? '<span class="pi-badge is-accent">当前</span>' : ''}${input(attrs('name'), stage.name)}
            ${act('ps-up', ICONS.arrowUp, '上移', index === 0)}${act('ps-down', ICONS.arrowDown, '下移', index === line.stages.length - 1)}${act('ps-del', ICONS.trash, '删除阶段', line.stages.length <= 1)}</div>
        ${extra}
        ${field(`人设内容 ≈${estimateTokens(stage.text)}`, `<textarea class="pi-ta" rows="6" ${attrs('text')}>${esc(stage.text)}</textarea>`)}</div>`;
}

// 对象：只有这条声望按搭档分别记、且已有搭档记录时才出现，直接从 IGS 已记下的搭档里选；留空读整体（取数值最高的一对）。
function partnerField(attrs, line, bar) {
    if (!bar || !Array.isArray(bar.pairs)) return '';
    const names = bar.pairs.map(pair => pair.partner);
    if (line.fame.partner && !names.includes(line.fame.partner)) names.push(line.fame.partner);
    if (!names.length) return '';
    const list = [{ value: '', label: '整体（取数值最高的一对）' }, ...names.map(name => ({ value: name, label: name }))];
    return field('搭档', `<select class="pi-sel" ${attrs('famePartner')}>${options(list, line.fame.partner)}</select>`);
}

// 读声望线的状态说明：读到几、落在哪、没读到该查什么。
function fameHint(view, line, info, bar) {
    if (!info.active) return '当前聊天未使用本项目，不读取声望。';
    if (info.lost) return `未读取到这条${line.fame.source === 'favor' ? '角色数据' : '声望'}，请检查名称是否与IGS中一致。读取失败时沿用手动选择的阶段。`;
    const value = fameReading(line, view.runtime.fame());
    const base = value === null ? '' : `当前读到的数值：${value}。`;
    if (info.miss) return `${base}这个数值不在任何阶段的区间内，当前显示「${info.stage.name}」。请为每个阶段填写上下限。`;
    const noPairs = line.fame.source !== 'favor' && bar && Array.isArray(bar.pairs) && !bar.pairs.length ? '这条声望暂无搭档记录，按整体读取。' : '';
    return `${base}${noPairs}`.trim();
}

function lineBody(view, line, units) {
    const attrs = name => `data-pl="${esc(line.id)}" data-f="${name}"`;
    const atDepth = line.position === 4;
    const info = stageInfo(view, line);
    const isFavor = line.fame.source === 'favor';
    const fameBar = isFavor ? null : view.runtime.fame().find(bar => (bar.kind || 'fame') === 'fame' && bar.name === line.fame.bar);
    const hint = line.mode === 'fame' ? fameHint(view, line, info, fameBar) : '';
    const fameBody = line.mode === 'fame' ? `<datalist id="pi-fame-list">${view.runtime.fame().filter(bar => (bar.kind || 'fame') === (isFavor ? 'favor' : 'fame')).flatMap(bar => [bar.name, ...(isFavor && Array.isArray(bar.aliases) ? bar.aliases : [])]).map(name => `<option value="${esc(name)}"></option>`).join('')}</datalist>
        <label class="pi-field"><span>数据来源</span><select class="pi-sel" ${attrs('fameSource')}>${options([{ value: 'fame', label: '声望' }, { value: 'favor', label: '角色对主角的关系数值' }], line.fame.source)}</select></label>
        ${isFavor ? `<label class="pi-field"><span>读哪一项</span><select class="pi-sel" ${attrs('fameDim')}>${options(FAVOR_DIMS.map(value => ({ value, label: value })), line.fame.dim)}</select></label>` : ''}
        ${field(isFavor ? '角色名' : '声望条名称', input(`${attrs('fameBar')} list="pi-fame-list"`, line.fame.bar))}
        ${isFavor ? '' : partnerField(attrs, line, fameBar)}
        ${hint ? `<p class="pi-hint">${esc(hint)}</p>` : ''}
        ${isFavor ? '' : `<div class="pi-tools is-c1"><button type="button" class="pi-btn is-sm" data-act="ps-spread" data-line="${esc(line.id)}">按阶段数平均分配区间</button></div>`}` : '';
    const defaultStage = line.mode === 'fame' || line.mode === 'outline'
        ? `<label class="pi-field"><span>${line.mode === 'fame' ? '数值不在任何阶段区间时显示' : '还没到任何绑定的大纲阶段时显示'}</span><select class="pi-sel" ${attrs('defaultStage')}>${options(line.stages.map(stage => ({ value: stage.id, label: stage.name })), line.defaultStage || line.stages[0].id)}</select></label>` : '';
    return `<div class="pi-entry-bd">
        <div class="pi-pair">${field('线名', input(attrs('name'), line.name))}${field('角色（分组）', input(attrs('group'), line.group))}</div>
        <label class="pi-field"><span>切换方式</span><select class="pi-sel" ${attrs('mode')}>${options(PERSONA_MODES, line.mode)}</select></label>
        ${fameBody}
        ${defaultStage}
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
    const note = info.note;
    return `<div class="pi-entry${line.enabled ? '' : ' is-off'}">
        <div class="pi-entry-hd" data-act="pl-open" data-line="${esc(line.id)}">${open ? ICONS.caretDown : ICONS.caret}
            <span class="pi-etitle">${esc(line.name)}</span><span class="pi-badge">${esc(modeLabel(line.mode))}</span>
            <span class="pi-meta">${esc(info.stage ? info.stage.name : '')}${note ? `，${note}` : ''}</span>
            <input type="checkbox" title="启用" data-pl-on="${esc(line.id)}"${line.enabled ? ' checked' : ''}></div>${open ? lineBody(view, line, units) : ''}</div>`;
}

// 人设单独导出导入：文件只含人设线。
function importedCard(all) {
    const rows = all.imported.map((item, index) => `<div class="pi-wb-row"><span class="pi-wb-title" title="${esc(item.book)}">${esc(item.title || item.key)}<small> ${esc(item.book)}</small></span>
        <button type="button" class="pi-btn is-sm" data-act="imp-restore" data-i="${index}">恢复</button></div>`).join('');
    if (!rows) return '';
    return `<div class="pi-card"><h3>世界书转入</h3>
        ${rows}<p class="pi-hint">转入时关闭了原条目，点恢复可重新开启。</p></div>`;
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
    return `<div class="pi-card"><h3>人设<span class="pi-meta">${all.lines.length}条线</span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-primary" data-act="pl-add">${ICONS.plus}新建人设线</button><button type="button" class="pi-icon-btn" data-act="persona-menu" title="导出、导入与世界书转入">${ICONS.more}</button></h3>
        ${groups || '<p class="pi-hint">还没有人设线。新建一条，或从世界书转入。</p>'}</div>
        ${importedCard(all)}`;
}

const LINE_PATCH = {
    name: value => ({ name: value.trim() || '未命名' }),
    group: value => ({ group: value.trim() }),
    mode: value => ({ mode: value }),
    defaultStage: value => ({ defaultStage: value }),
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

function rangePatchOf(item, which, value) {
    const next = { ...item };
    if (String(value).trim() === '' || !Number.isFinite(Number(value))) delete next[which];
    else next[which] = Number(value);
    return next;
}

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
    if (!d.pl) return undefined;
    if (d.ps && (d.f === 'extraDim' || d.f === 'extraMin' || d.f === 'extraMax')) {
        const at = Number(d.i);
        patchStage(view, d.pl, d.ps, stage => ({ ...stage, extra: (stage.extra || []).map((item, i) => (i !== at ? item : d.f === 'extraDim' ? { ...item, dim: target.value } : rangePatchOf(item, d.f === 'extraMin' ? 'min' : 'max', target.value))) }));
    } else if (d.ps) {
        patchStage(view, d.pl, d.ps, stage => ({ ...stage, ...(d.f === 'min' || d.f === 'max' ? rangePatch(stage, d.f, target.value) : (STAGE_PATCH[d.f] || (() => ({})))(target.value)) }));
    } else if (d.f === 'fameBar' || d.f === 'famePartner' || d.f === 'fameSource' || d.f === 'fameDim') {
        const key = { fameBar: 'bar', famePartner: 'partner', fameSource: 'source', fameDim: 'dim' }[d.f];
        patchLine(view, d.pl, line => ({ ...line, fame: { ...line.fame, [key]: target.value.trim(), ...(d.f === 'fameSource' ? { bar: '', partner: '' } : {}) } }));
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
    async 'persona-menu'(view) {
        const pick = await menuDialog({
            title: '人设',
            items: [
                { label: '导出人设', value: 'pf-export', disabled: !personas(view).lines.length },
                { label: '导入人设', value: 'pf-import' },
                { label: '从世界书转入人设', value: 'imp-open' },
            ],
        });
        pick && (await actions[pick](view));
    },
    'pf-export'(view) {
        const project = view.project();
        downloadBlob(`人设-${project.name}-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(buildPersonaFile(personas(view), { project: project.name, version: view.version }), null, 2));
        toast('success', `已导出${personas(view).lines.length}条人设线。`);
    },
    async 'pf-import'(view) {
        const [file] = await pickFiles({ accept: '.json,application/json' });
        if (!file) return;
        const parsed = parsePersonaFile(await file.text());
        const same = parsed.lines.filter(line => personas(view).lines.some(item => item.group === line.group && item.name === line.name)).length;
        let mode = 'both';
        if (same) {
            mode = await choiceDialog({ title: `导入${parsed.lines.length}条人设线`, body: `其中${same}条与现有人设线同组同名，怎么处理？`, choices: [
                { label: '都保留（新的加「（导入）」）', value: 'both', primary: true }, { label: '替换同名', value: 'replace' }, { label: '跳过同名', value: 'skip' }, { label: '取消', value: null }] });
            if (!mode) return;
        } else if (!(await confirmDialog({ title: '导入人设', body: `会加入${parsed.lines.length}条人设线。跟随大纲的阶段绑定不会导入，需重新选择。`, okLabel: '导入' }))) return;
        const merged = mergePersonaLines(personas(view).lines, parsed.lines, mode);
        patchPersonas(view, all => ({ ...all, lines: merged.lines }));
        view.renderBody();
        toast('success', `导入完成：新增${merged.added}，替换${merged.replaced}，跳过${merged.skipped}。`);
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
        if (!line || !(await confirmDialog({ title: `删除「${line.name}」`, body: '这条人设线及其全部阶段会一并删除。', okLabel: '删除', danger: true }))) return;
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
    'extra-add'(view, target) {
        patchStage(view, target.dataset.line, target.dataset.stage, stage => ({ ...stage, extra: [...(stage.extra || []), { dim: '信任' }] }));
        view.renderBody();
    },
    'extra-del'(view, target) {
        patchStage(view, target.dataset.line, target.dataset.stage, stage => ({ ...stage, extra: (stage.extra || []).filter((_, i) => i !== Number(target.dataset.i)) }));
        view.renderBody();
    },
    async 'ps-spread'(view, target) {
        const line = personas(view).lines.find(item => item.id === target.dataset.line);
        if (!line) return;
        if (line.stages.some(stage => stage.range.min !== undefined || stage.range.max !== undefined)
            && !(await confirmDialog({ title: '平均分配区间', body: '会覆盖各阶段已填的声望下限和上限。', okLabel: '覆盖' }))) return;
        const count = line.stages.length;
        const edge = i => Math.round((i * 100) / count);
        patchLine(view, line.id, item => ({ ...item, stages: item.stages.map((stage, i) => ({ ...stage, range: { min: i === 0 ? 0 : edge(i) + 1, max: i === count - 1 ? 100 : edge(i + 1) } })) }));
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
};
