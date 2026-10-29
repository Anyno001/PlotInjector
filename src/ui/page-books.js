import { cardName, downloadBlob } from '../host/st.js';
import { allBookNames, bookEntries, boundBookNames, deleteBook, deleteEntries, loadBook, setEntriesDisabled } from '../host/worldbook.js';
import { confirmDialog, esc } from './dom.js';
import { ICONS } from './styles.js';

const st = view => view.tabState('books');

// 勾选框即开关：勾上为开启，取消为关闭。开启与已关闭分两区显示。
function entryRow(entry) {
    return `<div class="pi-wb-row${entry.disabled ? ' is-off' : ''}">
        <input type="checkbox" data-wb-toggle="${esc(entry.key)}" title="${entry.disabled ? '开启' : '关闭'}"${entry.disabled ? '' : ' checked'}>
        <span class="pi-wb-title" title="${esc(entry.title)}">${esc(entry.title)}</span>
        ${entry.constant ? '<span class="pi-badge">常驻</span>' : ''}
        <button type="button" class="pi-icon-btn is-danger" data-act="wb-delete" data-key="${esc(entry.key)}" title="删除">${ICONS.trash}</button></div>`;
}

function section(title, entries, empty) {
    return `<div class="pi-wb-sec"><div class="pi-wb-sec-hd">${title}<small>${entries.length}</small></div>
        ${entries.map(entryRow).join('') || `<p class="pi-hint">${empty}</p>`}</div>`;
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
            ${entries ? `<div class="pi-entry-bd">${entries.length ? `${section('已开启', entries.filter(entry => !entry.disabled), '没有开启的条目')}
                ${section('已关闭', entries.filter(entry => entry.disabled), '没有关闭的条目')}` : '<p class="pi-hint">没有条目</p>'}</div>` : ''}</div>`;
    }).join('');
    return `<div class="pi-card pi-wb"><h3>当前角色卡的世界书</h3>
        <p class="pi-hint">「${esc(cardName() || '未打开角色卡')}」关联的世界书。原先手写的剧情条目与注入内容重复时，取消勾选即可关闭；删除前自动下载备份。</p>
        ${list || '<p class="pi-hint">没有关联的世界书。</p>'}</div>`;
}

export async function onChange(view, target) {
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
