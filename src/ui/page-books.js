import { cardName, downloadBlob } from '../host/st.js';
import { allBookNames, bookEntries, boundBookNames, deleteBook, deleteEntries, loadBook, setEntriesDisabled } from '../host/worldbook.js';
import { confirmDialog, esc } from './dom.js';

const st = view => view.tabState('books');

export function render(view) {
    const s = st(view);
    const fallback = allBookNames().filter(name => name.startsWith('剧情注入器·'));
    const books = [...boundBookNames(), ...fallback.filter(name => !boundBookNames().some(item => item.name === name)).map(name => ({ name, source: '专用' }))];
    const list = books.map(book => {
        const open = s.book === book.name;
        const entries = open && s.entries ? s.entries : null;
        return `<div class="pi-entry"><div class="pi-entry-hd" data-act="open-book" data-book="${esc(book.name)}">
            <span class="pi-etitle">${esc(book.name)}</span><span class="pi-badge">${esc(book.source)}</span>
            ${book.source === '专用' ? `<button type="button" class="pi-btn is-sm is-danger" data-act="delete-book" data-book="${esc(book.name)}">整本删除</button>` : ''}</div>
            ${entries ? `<div class="pi-entry-bd">${entries.map(entry => `<label class="pi-check${entry.disabled ? ' is-off' : ''}"><input type="checkbox" data-wb-pick="${esc(entry.key)}">
                <span>${esc(entry.title)} ${entry.constant ? '<span class="pi-badge">常驻</span>' : ''}${entry.disabled ? '<span class="pi-badge">已关闭</span>' : ''}</span></label>`).join('') || '<p class="pi-hint">没有条目</p>'}
                <div class="pi-row pi-acts"><button type="button" class="pi-btn is-sm" data-act="wb-disable">关闭所选</button>
                <button type="button" class="pi-btn is-sm" data-act="wb-enable">开启所选</button>
                <button type="button" class="pi-btn is-sm is-danger" data-act="wb-delete">删除所选</button></div></div>` : ''}</div>`;
    }).join('');
    return `<div class="pi-card"><h3>当前角色卡的世界书</h3>
        <p class="pi-hint">「${esc(cardName() || '未打开角色卡')}」关联的世界书。原先手写的剧情条目与注入内容重复时，可在此关闭或删除；删除前自动下载备份。</p>
        ${list || '<p class="pi-hint">没有关联的世界书。</p>'}</div>`;
}

async function selectedKeys(target) {
    return [...target.closest('.pi-entry').querySelectorAll('[data-wb-pick]:checked')].map(input => input.dataset.wbPick);
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
    async 'wb-disable'(view, target) {
        const keys = await selectedKeys(target);
        if (!keys.length) return;
        await setEntriesDisabled(st(view).book, keys, true);
        await reloadBook(view);
    },
    async 'wb-enable'(view, target) {
        const keys = await selectedKeys(target);
        if (!keys.length) return;
        await setEntriesDisabled(st(view).book, keys, false);
        await reloadBook(view);
    },
    async 'wb-delete'(view, target) {
        const keys = await selectedKeys(target);
        if (!keys.length) return;
        const titles = st(view).entries.filter(entry => keys.includes(entry.key)).map(entry => entry.title);
        if (!(await confirmDialog({ title: `从「${st(view).book}」删除条目`, body: '删除前会下载这些条目的备份。', list: titles, okLabel: '删除', danger: true }))) return;
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
