import { POSITIONS, ROLES } from '../core/inject.js';
import { acuField, groupByField } from '../core/acu.js';
import { cardName, downloadBlob } from '../host/st.js';
import { allBookNames, bookEntries, boundBookNames, deleteBook, deleteEntries, loadBook, setEntriesDisabled, updateEntry } from '../host/worldbook.js';
import { confirmDialog, esc, options } from './dom.js';
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

const bulkBtn = (attrs, label, disabled) => `<button type="button" class="pi-btn is-sm is-ghost" ${attrs}${disabled ? ' disabled' : ''}>${label}</button>`;

function section(name, entries, empty, bulk, openKey) {
    return `<div class="pi-wb-sec"><div class="pi-wb-sec-hd">${name}<small>${entries.length}</small>${entries.length ? `<span class="pi-wb-bulk">${bulk}</span>` : ''}</div>
        ${entries.map(entry => entryRow(entry, entry.key === openKey)).join('') || `<p class="pi-hint">${empty}</p>`}</div>`;
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
            ${entries ? `<div class="pi-entry-bd">${entries.length ? `${section('已开启', GROUPS.on(entries), '没有开启的条目', bulkBtn('data-act="wb-bulk" data-group="on"', '全部关闭'), s.openKey)}
                ${section('已关闭', GROUPS.off(entries), '没有关闭的条目', bulkBtn('data-act="wb-bulk" data-group="off"', '全部开启'), s.openKey)}
                ${acuSection(entries, s.openFields || new Set())}` : '<p class="pi-hint">没有条目</p>'}</div>` : ''}</div>`;
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
    if (target.dataset.wbEdit) return saveEdit(view, target);
    const key = target.dataset.wbToggle;
    if (!key) return;
    target.disabled = true;
    await setEntriesDisabled(st(view).book, [key], !target.checked);
    await reloadBook(view);
}

async function reloadBook(view) {
    st(view).entries = bookEntries(await loadBook(st(view).book));
    view.renderBody();
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
