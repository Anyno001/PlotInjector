import { POSITIONS, ROLES } from '../core/inject.js';
import { acuField, groupByField } from '../core/acu.js';
import { estimateTokens } from '../core/tokens.js';
import { buildPattern, orderPlan, punctPlan, regexPlan } from '../core/wbtools.js';
import { cardName, countTokens, downloadBlob, hostDocument, toast } from '../host/st.js';
import { allBookNames, bookEntries, boundBookNames, deleteBook, deleteEntries, loadBook, patchEntries, setEntriesDisabled, transferEntries, updateEntry } from '../host/worldbook.js';
import { confirmDialog, esc, openDialog, options } from './dom.js';
import { ICONS } from './styles.js';

const st = view => view.tabState('books');

// 直接管理当前角色卡关联的世界书：勾选框即世界书里的开关，改动写进世界书文件。
// 手写条目可展开编辑位置、深度、顺序、触发方式、关键词和内容；
// TavernDB-ACU 数据库条目由数据库插件维护，按字段折叠，只给开关。
const GROUPS = {
    on: entries => entries.filter(entry => !acuField(entry.title) && !entry.disabled),
    off: entries => entries.filter(entry => !acuField(entry.title) && entry.disabled),
};

const toggle = entry => `<input type="checkbox" data-wb-toggle="${esc(entry.key)}" title="${entry.disabled ? '开启' : '关闭'}"${entry.disabled ? '' : ' checked'}>`;
const title = entry => `<span class="pi-wb-title" title="${esc(entry.title)}">${esc(entry.title)}</span>`;

function editor(entry) {
    const atDepth = entry.position === 4;
    const key = esc(entry.key);
    return `<div class="pi-wb-edit">
        <div class="pi-pair ${atDepth ? 'is-c4' : ''}">
            <label class="pi-field"><span>位置</span><select class="pi-sel" data-wb-edit="${key}" data-f="position">${options(POSITIONS, entry.position)}</select></label>
            ${atDepth ? `<label class="pi-field"><span>深度</span><input class="pi-inp" type="number" min="0" data-wb-edit="${key}" data-f="depth" value="${entry.depth}"></label>
            <label class="pi-field"><span>角色</span><select class="pi-sel" data-wb-edit="${key}" data-f="role">${options(ROLES, entry.role)}</select></label>` : ''}
            <label class="pi-field"><span>顺序</span><input class="pi-inp" type="number" data-wb-edit="${key}" data-f="order" value="${entry.order}"></label>
        </div>
        <label class="pi-field"><span>触发方式</span><select class="pi-sel" data-wb-edit="${key}" data-f="constant">${options([{ value: '1', label: '常驻' }, { value: '0', label: '关键词触发' }], entry.constant ? '1' : '0')}</select></label>
        ${entry.constant ? '' : `<label class="pi-field"><span>主要关键词（逗号分隔）</span><input class="pi-inp" data-wb-edit="${key}" data-f="key" value="${esc(entry.keys.join('，'))}"></label>
        <label class="pi-field"><span>次要关键词（可空）</span><input class="pi-inp" data-wb-edit="${key}" data-f="keysecondary" value="${esc(entry.keysSecondary.join('，'))}"></label>`}
        <label class="pi-field"><span>内容</span><textarea class="pi-ta" rows="6" data-wb-edit="${key}" data-f="content">${esc(entry.content)}</textarea></label>
    </div>`;
}

function entryRow(entry, open) {
    return `<div class="pi-wb-item"><div class="pi-wb-row${entry.disabled ? ' is-off' : ''}">${toggle(entry)}
        <button type="button" class="pi-wb-name" data-act="wb-open" data-key="${esc(entry.key)}">${open ? ICONS.caretDown : ICONS.caret}${title(entry)}</button>
        ${entry.constant ? '<span class="pi-badge">常驻</span>' : ''}
        <button type="button" class="pi-icon-btn is-danger" data-act="wb-delete" data-key="${esc(entry.key)}" title="删除">${ICONS.trash}</button></div>
        ${open ? editor(entry) : ''}</div>`;
}

// 批量选择时勾选框改为「选中」，不再是开关；顺序值放在行尾，排序前后好对照。
function pickRow(entry, picked) {
    return `<label class="pi-wb-row${entry.disabled ? ' is-off' : ''}"><input type="checkbox" data-wb-pick="${esc(entry.key)}"${picked.has(entry.key) ? ' checked' : ''}>
        ${title(entry)}<span class="pi-badge">顺序 ${entry.order}</span></label>`;
}

const bulkBtn = (attrs, label, disabled) => `<button type="button" class="pi-btn is-sm is-ghost" ${attrs}${disabled ? ' disabled' : ''}>${label}</button>`;

function section(name, entries, empty, bulk, openKey, picked) {
    const rows = entries.map(entry => (picked ? pickRow(entry, picked) : entryRow(entry, entry.key === openKey))).join('');
    return `<div class="pi-wb-sec"><div class="pi-wb-sec-hd">${name}<small>${entries.length}</small>${entries.length ? `<span class="pi-wb-bulk">${bulk}</span>` : ''}</div>
        ${rows || `<p class="pi-hint">${empty}</p>`}</div>`;
}

function pickBulk(group, entries, picked) {
    const all = entries.length && entries.every(entry => picked.has(entry.key));
    return bulkBtn(`data-act="wb-pick-all" data-group="${group}" data-on="${all ? '0' : '1'}"`, all ? '取消全选' : '全选');
}

function tokenText(s) {
    if (!s.tokens) return '<span class="pi-badge">统计中…</span>';
    const mark = s.tokens.exact ? '' : '≈';
    return `<span class="pi-badge is-accent">开启 ${mark}${s.tokens.on} token</span><span class="pi-badge">全部 ${mark}${s.tokens.all} token</span>`;
}

function bookBody(s, entries) {
    if (!entries.length) return '<p class="pi-hint">没有条目</p>';
    const picked = s.picking ? s.picked : null;
    const on = GROUPS.on(entries);
    const off = GROUPS.off(entries);
    // 统计与已选数放同一行；按钮一行等宽，批量选择时整行换成针对选中条目的操作。
    const none = picked && !picked.size ? ' disabled' : '';
    const buttons = picked
        ? `<div class="pi-tools is-c4"><button type="button" class="pi-btn is-sm is-primary" data-act="wb-move"${none}>迁移到其他世界书</button>
            <button type="button" class="pi-btn is-sm" data-act="wb-order"${none}>顺序重排</button>
            <button type="button" class="pi-btn is-sm" data-act="wb-regex"${none}>正则替换</button>
            <button type="button" class="pi-btn is-sm" data-act="wb-picking">退出批量选择</button></div>`
        : `<div class="pi-tools is-c3"><button type="button" class="pi-btn is-sm" data-act="wb-picking">批量选择</button>
            <button type="button" class="pi-btn is-sm" data-act="wb-punct">修复关键词标点</button>
            <button type="button" class="pi-btn is-sm" data-act="wb-regex">正则替换</button></div>`;
    const tools = `<div class="pi-wb-info"><span class="pi-wb-tokens">${tokenText(s)}</span>${picked ? `<span class="pi-wb-count">已选 ${picked.size} 条</span>` : ''}</div>${buttons}`;
    if (picked) {
        return `${tools}${section('已开启', on, '没有开启的条目', pickBulk('on', on, picked), '', picked)}
            ${section('已关闭', off, '没有关闭的条目', pickBulk('off', off, picked), '', picked)}`;
    }
    return `${tools}${section('已开启', on, '没有开启的条目', bulkBtn('data-act="wb-bulk" data-group="on"', '全部关闭'), s.openKey)}
        ${section('已关闭', off, '没有关闭的条目', bulkBtn('data-act="wb-bulk" data-group="off"', '全部开启'), s.openKey)}
        ${acuSection(entries, s.openFields || new Set())}`;
}

// 数据库条目：每个字段默认收起，只显示字段名、开启数和一键开关。
function acuSection(entries, openFields) {
    const fields = groupByField(entries);
    if (!fields.length) return '';
    const total = fields.reduce((sum, [, list]) => sum + list.length, 0);
    const sub = ([field, list]) => {
        const on = list.filter(entry => !entry.disabled).length;
        const bulk = bulkBtn(`data-act="acu-field" data-field="${esc(field)}" data-on="1"`, '一键开启', on === list.length)
            + bulkBtn(`data-act="acu-field" data-field="${esc(field)}" data-on="0"`, '一键关闭', !on);
        const open = openFields.has(field);
        return `<div class="pi-wb-sub"><div class="pi-wb-sub-hd is-fold" data-act="acu-fold" data-field="${esc(field)}">${open ? ICONS.caretDown : ICONS.caret}<span class="pi-wb-field" title="${esc(field)}">${esc(field)}</span><small>${on}/${list.length}</small><span class="pi-wb-bulk">${bulk}</span></div>
            ${open ? list.map(entry => `<div class="pi-wb-row${entry.disabled ? ' is-off' : ''}">${toggle(entry)}${title(entry)}</div>`).join('') : ''}</div>`;
    };
    return `<div class="pi-wb-sec"><div class="pi-wb-sec-hd">数据库条目<small>${total}</small></div>${fields.map(sub).join('')}</div>`;
}

export function render(view) {
    const s = st(view);
    const fallback = allBookNames().filter(name => name.startsWith('剧情注入器·'));
    const books = [...boundBookNames(), ...fallback.filter(name => !boundBookNames().some(item => item.name === name)).map(name => ({ name, source: '专用' }))];
    const list = books.map(book => {
        const open = s.book === book.name;
        const entries = open && s.entries ? s.entries : null;
        return `<div class="pi-entry"><div class="pi-entry-hd" data-act="open-book" data-book="${esc(book.name)}">
            ${open ? ICONS.caretDown : ICONS.caret}<span class="pi-etitle" title="${esc(book.name)}">${esc(book.name)}</span><span class="pi-badge">${esc(book.source)}</span>
            ${book.source === '专用' ? `<button type="button" class="pi-btn is-sm is-danger" data-act="delete-book" data-book="${esc(book.name)}">整本删除</button>` : ''}</div>
            ${entries ? `<div class="pi-entry-bd">${bookBody(s, entries)}</div>` : ''}</div>`;
    }).join('');
    return `<div class="pi-card pi-wb"><h3>当前角色卡的世界书</h3>
        <p class="pi-hint">「${esc(cardName() || '未打开角色卡')}」关联的世界书。</p>
        <p class="pi-hint is-warn">注意：这里的操作真的会修改你的世界书！</p>
        ${list || '<p class="pi-hint">没有关联的世界书。</p>'}</div>`;
}

const splitKeys = text => String(text || '').split(/[,，、\n]/).map(item => item.trim()).filter(Boolean);

function editPatch(target) {
    const field = target.dataset.f;
    const value = target.value;
    if (field === 'constant') return { constant: value === '1' };
    if (field === 'key' || field === 'keysecondary') return { [field]: splitKeys(value) };
    if (field === 'position' || field === 'role') return { [field]: Number(value) };
    if (field === 'depth' || field === 'order') return { [field]: Math.max(0, Math.round(Number(value) || 0)) };
    if (field === 'content') return { content: value };
    return null;
}

// change 事件：下拉框选完即触发；输入框和内容在离开时触发，所以不会每打一个字写一次世界书。
// 下拉框会改变编辑区结构（位置切到 @D 出现深度、触发方式切换关键词框），保存后重画。
async function saveEdit(view, target) {
    const key = target.dataset.wbEdit;
    const patch = editPatch(target);
    if (!patch || !(st(view).entries || []).some(item => item.key === key)) return;
    await updateEntry(st(view).book, key, patch);
    st(view).entries = bookEntries(await loadBook(st(view).book));
    if (target.tagName === 'SELECT') view.renderBody();
}

export async function onChange(view, target) {
    if (target.dataset.wbPick) {
        const picked = st(view).picked;
        if (target.checked) picked.add(target.dataset.wbPick);
        else picked.delete(target.dataset.wbPick);
        return view.renderBody();
    }
    if (target.dataset.wbEdit) return saveEdit(view, target);
    const key = target.dataset.wbToggle;
    if (!key) return;
    target.disabled = true;
    await setEntriesDisabled(st(view).book, [key], !target.checked);
    await reloadBook(view);
}

async function reloadBook(view) {
    const s = st(view);
    s.entries = bookEntries(await loadBook(s.book));
    const keys = new Set(s.entries.map(entry => entry.key));
    s.picked = new Set([...(s.picked || [])].filter(key => keys.has(key)));
    view.renderBody();
    countBook(view);
}

// 用酒馆的分词器统计；酒馆不支持时按字数粗估。只换掉 token 那一行，不打断正在编辑的输入框。
async function countBook(view) {
    const s = st(view);
    const book = s.book;
    const entries = s.entries || [];
    const on = entries.filter(entry => !entry.disabled).map(entry => entry.content).join('\n');
    const all = entries.map(entry => entry.content).join('\n');
    const [onCount, allCount] = await Promise.all([countTokens(on), countTokens(all)]);
    if (s.book !== book || s.entries !== entries) return;
    const exact = onCount != null && allCount != null;
    s.tokens = exact ? { on: onCount, all: allCount, exact } : { on: estimateTokens(on), all: estimateTokens(all), exact };
    const box = hostDocument().querySelector('.pi-wb-tokens');
    if (box) box.innerHTML = tokenText(s);
}

const handwritten = entries => entries.filter(entry => !acuField(entry.title));
const pickedEntries = s => handwritten(s.entries || []).filter(entry => s.picked.has(entry.key));

// 预览列表最多列这么多行，其余合并成「另有 N 条」。
const PREVIEW_MAX = 30;
const previewList = lines => (lines.length > PREVIEW_MAX ? [...lines.slice(0, PREVIEW_MAX), `另有 ${lines.length - PREVIEW_MAX} 条`] : lines);

async function applyPatches(view, plan, { label, backup = false }) {
    const s = st(view);
    const result = await patchEntries(s.book, plan.map(item => ({ key: item.key, patch: item.patch })));
    if (backup) downloadBlob(`${s.book}-${label}前备份.json`, JSON.stringify(result, null, 2));
    toast('success', `${label}：已修改 ${plan.length} 条。`);
    await reloadBook(view);
}

async function regexDialog(scope) {
    const check = (f, label, on = false) => `<label class="pi-check"><input type="checkbox" data-f="${f}"${on ? ' checked' : ''}><span>${label}</span></label>`;
    const html = `<label class="pi-field"><span>查找</span><input class="pi-inp is-mono" data-f="find" placeholder="如：旧名字 或 \\d+"></label>
        <label class="pi-field"><span>替换为</span><input class="pi-inp is-mono" data-f="replace" placeholder="留空即删除；正则可用 $1"></label>
        <div class="pi-field"><span>查找方式</span><div class="pi-pair is-c3">${check('regex', '正则表达式', true)}${check('ignoreCase', '忽略大小写')}</div></div>
        <div class="pi-field"><span>替换范围</span><div class="pi-pair is-c3">${check('content', '内容', true)}${check('comment', '标题')}${check('keys', '关键词')}</div></div>`;
    return openDialog({
        title: `正则替换（${scope}）`,
        html,
        actions: [{ label: '取消', value: null }, { label: '预览', primary: true, value: box => {
            const read = f => box.querySelector(`[data-f="${f}"]`);
            return { find: read('find').value, replace: read('replace').value, regex: read('regex').checked, ignoreCase: read('ignoreCase').checked, fields: { content: read('content').checked, comment: read('comment').checked, keys: read('keys').checked } };
        } }],
    });
}

function moveDialog(from, count) {
    const names = allBookNames().filter(name => name !== from);
    const html = `<label class="pi-field"><span>目标世界书</span><select class="pi-sel" data-f="book">${options([{ value: '', label: names.length ? '选择已有世界书' : '没有其他世界书' }, ...names.map(name => ({ value: name, label: name }))], '')}</select></label>
        <label class="pi-field"><span>或新建世界书</span><input class="pi-inp" data-f="name" placeholder="填写名字即新建，优先于上一项"></label>
        <label class="pi-field"><span>方式</span><select class="pi-sel" data-f="mode">${options([{ value: 'copy', label: '复制（原世界书保留）' }, { value: 'move', label: '移动（从原世界书删除）' }], 'copy')}</select></label>`;
    return openDialog({
        title: `迁移到其他世界书（已选 ${count} 条）`,
        html,
        actions: [{ label: '取消', value: null }, { label: '下一步', primary: true, value: box => ({ to: box.querySelector('[data-f="name"]').value.trim() || box.querySelector('[data-f="book"]').value, move: box.querySelector('[data-f="mode"]').value === 'move' }) }],
    });
}

function orderDialog(count) {
    const html = `<div class="pi-pair"><label class="pi-field"><span>起始数字</span><input class="pi-inp" type="number" min="0" data-f="start" value="100"></label>
            <label class="pi-field"><span>间隔</span><input class="pi-inp" type="number" min="1" data-f="step" value="1"></label></div>
        <label class="pi-field"><span>排列依据</span><select class="pi-sel" data-f="by">${options([{ value: 'list', label: '按列表中的先后' }, { value: 'order', label: '按原有顺序值（保持相对先后）' }], 'list')}</select></label>`;
    return openDialog({
        title: `顺序重排（已选 ${count} 条）`,
        html,
        actions: [{ label: '取消', value: null }, { label: '预览', primary: true, value: box => ({ start: box.querySelector('[data-f="start"]').value, step: box.querySelector('[data-f="step"]').value, by: box.querySelector('[data-f="by"]').value }) }],
    });
}

export const actions = {
    // 整区一次改完：「全部关闭」关已开启区，「全部开启」开已关闭区；数据库条目不在其中。
    async 'wb-bulk'(view, target) {
        const group = target.dataset.group;
        const pick = GROUPS[group];
        if (!pick) return;
        const keys = pick(st(view).entries || []).map(entry => entry.key);
        if (!keys.length) return;
        target.disabled = true;
        await setEntriesDisabled(st(view).book, keys, group === 'on');
        await reloadBook(view);
    },
    'wb-open'(view, target) {
        const s = st(view);
        s.openKey = s.openKey === target.dataset.key ? '' : target.dataset.key;
        view.renderBody();
    },
    'acu-fold'(view, target, event) {
        if (event.target.closest('button')) return;
        const s = st(view);
        const open = new Set(s.openFields || []);
        if (open.has(target.dataset.field)) open.delete(target.dataset.field);
        else open.add(target.dataset.field);
        s.openFields = open;
        view.renderBody();
    },
    // 一个字段的数据库条目整体开或关（写进世界书）。
    async 'acu-field'(view, target) {
        const on = target.dataset.on === '1';
        const keys = (st(view).entries || []).filter(entry => acuField(entry.title) === target.dataset.field && entry.disabled === on).map(entry => entry.key);
        if (!keys.length) return;
        target.disabled = true;
        await setEntriesDisabled(st(view).book, keys, !on);
        await reloadBook(view);
    },
    async 'open-book'(view, target, event) {
        if (event.target.closest('button,input')) return;
        const s = st(view);
        if (s.book === target.dataset.book) { s.book = ''; s.entries = null; return view.renderBody(); }
        s.book = target.dataset.book;
        s.entries = null;
        s.openKey = '';
        s.tokens = null;
        s.picking = false;
        s.picked = new Set();
        await reloadBook(view);
    },
    'wb-picking'(view) {
        const s = st(view);
        s.picking = !s.picking;
        s.picked = new Set();
        s.openKey = '';
        view.renderBody();
    },
    'wb-pick-all'(view, target) {
        const s = st(view);
        const list = GROUPS[target.dataset.group](s.entries || []);
        for (const entry of list) {
            if (target.dataset.on === '1') s.picked.add(entry.key);
            else s.picked.delete(entry.key);
        }
        view.renderBody();
    },
    // 关键词里写成「甲，乙、丙」的一整条拆成三个，去掉首尾标点与空格、重复项；/正则/ 形式的关键词不动。
    async 'wb-punct'(view) {
        const s = st(view);
        const plan = punctPlan(handwritten(s.entries || []));
        if (!plan.length) return toast('info', '关键词没有需要修复的标点。');
        const ok = await confirmDialog({ title: `修复关键词标点（${plan.length} 条）`, body: '以下条目的关键词将改为：', list: previewList(plan.map(item => `${item.title}：${item.before} → ${item.after}`)), okLabel: '修复' });
        if (ok) await applyPatches(view, plan, { label: '修复关键词标点' });
    },
    async 'wb-regex'(view) {
        const s = st(view);
        const usePicked = s.picking && s.picked.size;
        const entries = usePicked ? pickedEntries(s) : handwritten(s.entries || []);
        const input = await regexDialog(usePicked ? `已选 ${entries.length} 条` : `全部手写条目 ${entries.length} 条`);
        if (!input) return;
        if (!input.fields.content && !input.fields.comment && !input.fields.keys) throw new Error('请至少选择一个替换范围');
        const plan = regexPlan(entries, buildPattern(input.find, input), input.replace, input.fields);
        if (!plan.length) return toast('info', '没有匹配的内容。');
        const total = plan.reduce((sum, item) => sum + item.hits, 0);
        const ok = await confirmDialog({ title: `正则替换（${plan.length} 条，共 ${total} 处）`, body: '替换前会下载这些条目的备份。', list: previewList(plan.map(item => `${item.title}：${item.hits} 处`)), okLabel: '替换', danger: true });
        if (ok) await applyPatches(view, plan, { label: '正则替换', backup: true });
    },
    async 'wb-order'(view) {
        const s = st(view);
        const input = await orderDialog(s.picked.size);
        if (!input) return;
        const plan = orderPlan(pickedEntries(s), input);
        const ok = await confirmDialog({ title: `顺序重排（${plan.length} 条）`, list: previewList(plan.map(item => `${item.title}：${item.from} → ${item.to}`)), okLabel: '重排' });
        if (ok) await applyPatches(view, plan.map(item => ({ key: item.key, patch: { order: item.to } })), { label: '顺序重排' });
    },
    async 'wb-move'(view) {
        const s = st(view);
        const input = await moveDialog(s.book, s.picked.size);
        if (!input) return;
        if (!input.to) throw new Error('请选择或填写目标世界书');
        const entries = pickedEntries(s);
        const isNew = !allBookNames().includes(input.to);
        const ok = await confirmDialog({
            title: `${input.move ? '移动' : '复制'}到「${input.to}」${isNew ? '（新建）' : ''}`,
            body: input.move ? '移动后从当前世界书删除，删除前会下载这些条目的备份。' : '',
            list: previewList(entries.map(entry => entry.title)),
            okLabel: input.move ? '移动' : '复制',
            danger: input.move,
        });
        if (!ok) return;
        if (input.move) {
            const raw = await loadBook(s.book);
            downloadBlob(`${s.book}-迁移前备份.json`, JSON.stringify({ entries: Object.fromEntries(entries.map(entry => [entry.key, raw.entries[entry.key]])) }, null, 2));
        }
        const result = await transferEntries(s.book, input.to, entries.map(entry => entry.key), { move: input.move });
        toast('success', `已${input.move ? '移动' : '复制'} ${result.copied} 条到「${input.to}」${result.created ? '（新建）' : ''}。`);
        s.picked = new Set();
        await reloadBook(view);
    },
    async 'wb-delete'(view, target) {
        const keys = [target.dataset.key];
        const titles = st(view).entries.filter(entry => keys.includes(entry.key)).map(entry => entry.title);
        if (!(await confirmDialog({ title: `从「${st(view).book}」删除条目`, body: '删除前会下载这个条目的备份。', list: titles, okLabel: '删除', danger: true }))) return;
        const backup = await deleteEntries(st(view).book, keys);
        downloadBlob(`${st(view).book}-已删条目备份.json`, JSON.stringify(backup, null, 2));
        await reloadBook(view);
    },
    async 'delete-book'(view, target) {
        const name = target.dataset.book;
        if (!(await confirmDialog({ title: '删除专用世界书', list: [name], body: '先下载整本备份再删除。', okLabel: '删除', danger: true }))) return;
        downloadBlob(`${name}-备份.json`, JSON.stringify(await loadBook(name), null, 2));
        await deleteBook(name);
        st(view).book = '';
        view.renderBody();
    },
};

export const refreshOn = ['chat'];
