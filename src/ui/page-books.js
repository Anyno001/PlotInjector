import { cardName, downloadBlob } from '../host/st.js';
import { allBookNames, bookEntries, boundBookNames, deleteBook, deleteEntries, loadBook, setEntriesDisabled } from '../host/worldbook.js';
import { EN_FIELD, acuBlocked, acuField, setAcuEntry, setAcuField } from '../core/acu.js';
import { confirmDialog, esc } from './dom.js';
import { ICONS } from './styles.js';

const st = view => view.tabState('books');

// 手写条目：勾选框即世界书里的开关，勾上为开启，取消为关闭。
// TavernDB-ACU 数据库条目归到「临时屏蔽」区，按字段（剧情纪要、人物档案……）分组：
// 勾选状态记在插件设置里，每轮扫描前生效，不改世界书，所以数据库新增、重写条目后状态照旧；同字段的新条目跟随该字段。
const GROUPS = {
    on: entries => entries.filter(entry => !acuField(entry.title) && !entry.disabled),
    off: entries => entries.filter(entry => !acuField(entry.title) && entry.disabled),
};

const delBtn = entry => `<button type="button" class="pi-icon-btn is-danger" data-act="wb-delete" data-key="${esc(entry.key)}" title="删除">${ICONS.trash}</button>`;

function entryRow(entry) {
    return `<div class="pi-wb-row${entry.disabled ? ' is-off' : ''}">
        <input type="checkbox" data-wb-toggle="${esc(entry.key)}" title="${entry.disabled ? '开启' : '关闭'}"${entry.disabled ? '' : ' checked'}>
        <span class="pi-wb-title" title="${esc(entry.title)}">${esc(entry.title)}</span>
        ${entry.constant ? '<span class="pi-badge">常驻</span>' : ''}${delBtn(entry)}</div>`;
}

// 数据库条目：勾上为放行，取消为屏蔽。
function acuRow(acu, entry) {
    const blocked = acuBlocked(acu, entry.title);
    return `<div class="pi-wb-row${blocked ? ' is-off' : ''}">
        <input type="checkbox" data-acu-toggle="${esc(entry.title)}" title="${blocked ? '取消屏蔽' : '屏蔽'}"${blocked ? '' : ' checked'}>
        <span class="pi-wb-title" title="${esc(entry.title)}">${esc(entry.title)}</span>
        ${entry.disabled ? '<span class="pi-badge" title="世界书里本身已关闭，不会被触发">世界书已关闭</span>' : ''}${delBtn(entry)}</div>`;
}

const bulkBtn = (group, on, label, disabled) => `<button type="button" class="pi-btn is-sm is-ghost" data-act="wb-bulk" data-group="${group}" data-on="${on ? 1 : 0}"${disabled ? ' disabled' : ''}>${label}</button>`;
const fieldBtn = (field, on, label, disabled) => `<button type="button" class="pi-btn is-sm is-ghost" data-act="acu-field" data-field="${esc(field)}" data-on="${on ? 1 : 0}"${disabled ? ' disabled' : ''}>${label}</button>`;

function section(title, entries, empty, bulk = '') {
    return `<div class="pi-wb-sec"><div class="pi-wb-sec-hd">${title}<small>${entries.length}</small>${entries.length ? `<span class="pi-wb-bulk">${bulk}</span>` : ''}</div>
        ${entries.map(entryRow).join('') || `<p class="pi-hint">${empty}</p>`}</div>`;
}

// 按字段分组，中文字段按出现顺序在前，英文字段放最后。
function acuFields(entries) {
    const map = new Map();
    for (const entry of entries) {
        const field = acuField(entry.title);
        if (!field) continue;
        if (!map.has(field)) map.set(field, []);
        map.get(field).push(entry);
    }
    return [...map].sort(([a], [b]) => Number(a === EN_FIELD) - Number(b === EN_FIELD));
}

// 字段默认收起，只显示字段名、放行数和一键按钮；条目多时不撑长页面。
function acuSection(acu, entries, openFields) {
    const fields = acuFields(entries);
    if (!fields.length) return '';
    const total = fields.reduce((sum, [, list]) => sum + list.length, 0);
    const sub = ([field, list]) => {
        const blocked = list.filter(entry => acuBlocked(acu, entry.title)).length;
        const bulk = fieldBtn(field, true, '一键勾选', !blocked) + fieldBtn(field, false, '一键取消', blocked === list.length);
        const open = openFields.has(field);
        return `<div class="pi-wb-sub"><div class="pi-wb-sub-hd is-fold" data-act="acu-fold" data-field="${esc(field)}">${open ? ICONS.caretDown : ICONS.caret}<span class="pi-wb-field" title="${esc(field)}">${esc(field)}</span><small>${list.length - blocked}/${list.length}</small><span class="pi-wb-bulk">${bulk}</span></div>
            ${open ? list.map(entry => acuRow(acu, entry)).join('') : ''}</div>`;
    };
    return `<div class="pi-wb-sec"><div class="pi-wb-sec-hd">临时屏蔽<small>${total}</small></div>
        <p class="pi-hint">取消勾选即屏蔽，不改动世界书；同字段的新条目跟随该字段。</p>
        ${fields.map(sub).join('')}</div>`;
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
            ${entries ? `<div class="pi-entry-bd">${entries.length ? `${section('已开启', GROUPS.on(entries), '没有开启的条目', bulkBtn('on', false, '全部取消勾选'))}
                ${section('已关闭', GROUPS.off(entries), '没有关闭的条目', bulkBtn('off', true, '全部勾选'))}
                ${acuSection(view.data.settings().acu, entries, s.openFields || new Set())}` : '<p class="pi-hint">没有条目</p>'}</div>` : ''}</div>`;
    }).join('');
    return `<div class="pi-card pi-wb"><h3>当前角色卡的世界书</h3>
        <p class="pi-hint">「${esc(cardName() || '未打开角色卡')}」关联的世界书。</p>
        ${list || '<p class="pi-hint">没有关联的世界书。</p>'}</div>`;
}

export async function onChange(view, target) {
    if (target.dataset.acuToggle) {
        const acu = view.data.settings().acu;
        view.data.updateSettings({ acu: setAcuEntry(acu, target.dataset.acuToggle, !target.checked) });
        return view.renderBody();
    }
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
    // 整组一次改完：data-group 指定哪一组，data-on=1 全部勾选，0 全部取消。数据库分组改的是屏蔽设置。
    async 'wb-bulk'(view, target) {
        const on = target.dataset.on === '1';
        const group = target.dataset.group;
        const pick = GROUPS[group];
        if (!pick) return;
        const keys = pick(st(view).entries || []).filter(entry => entry.disabled === on).map(entry => entry.key);
        if (!keys.length) return;
        target.disabled = true;
        await setEntriesDisabled(st(view).book, keys, !on);
        await reloadBook(view);
    },
    // 一个字段整体放行或屏蔽，同字段以后新增的条目也照此处理。
    'acu-fold'(view, target, event) {
        if (event.target.closest('button')) return;
        const s = st(view);
        const open = new Set(s.openFields || []);
        if (open.has(target.dataset.field)) open.delete(target.dataset.field);
        else open.add(target.dataset.field);
        s.openFields = open;
        view.renderBody();
    },
    'acu-field'(view, target) {
        const acu = view.data.settings().acu;
        view.data.updateSettings({ acu: setAcuField(acu, target.dataset.field, target.dataset.on !== '1') });
        view.renderBody();
    },
    async 'open-book'(view, target, event) {
        if (event.target.closest('button,input')) return;
        const s = st(view);
        if (s.book === target.dataset.book) { s.book = ''; s.entries = null; return view.renderBody(); }
        s.book = target.dataset.book;
        s.entries = null;
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
