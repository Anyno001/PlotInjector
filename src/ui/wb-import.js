import { parseOutlineText } from '../core/outline.js';
import { downloadBlob, toast } from '../host/st.js';
import { bookEntries, boundBookNames, deleteEntries, loadBook, setEntriesDisabled } from '../host/worldbook.js';
import { choiceDialog, esc, openDialog } from './dom.js';

// 从当前卡关联的世界书挑条目。返回 [{ book, key, title, content }]。
export async function pickWorldbookEntries(title = '从世界书导入') {
    const books = boundBookNames();
    if (!books.length) {
        toast('info', '当前卡没有关联的世界书。');
        return [];
    }
    const loaded = [];
    for (const book of books) {
        try {
            loaded.push({ ...book, entries: bookEntries(await loadBook(book.name)) });
        } catch (error) {
            loaded.push({ ...book, entries: [], error: error.message });
        }
    }
    const html = loaded.map((book, b) => `<p class="pi-hint"><b>${esc(book.name)}</b> <span class="pi-badge">${esc(book.source)}</span>${book.error ? ` <span class="pi-badge is-danger">${esc(book.error)}</span>` : ''}</p>
        ${book.entries.map((entry, e) => `<label class="pi-check${entry.disabled ? ' is-off' : ''}"><input type="checkbox" data-pick="${b}:${e}">
        <span>${esc(entry.title)} <span class="pi-badge">≈${entry.content.length} 字</span></span></label>`).join('')}`).join('');
    const picked = await openDialog({
        title,
        html: `<div class="pi-ref-top"><span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-pick-every="1">全选</button><button type="button" class="pi-btn is-sm is-ghost" data-pick-every="0">全不选</button></div>${html}`,
        actions: [{ label: '取消', value: null }, { label: '导入选中', primary: true, value: root => [...root.querySelectorAll('[data-pick]:checked')].map(input => input.dataset.pick) }],
        onMount(box) {
            box.addEventListener('click', event => {
                const every = event.target.closest('[data-pick-every]');
                if (every) box.querySelectorAll('[data-pick]').forEach(input => { input.checked = every.dataset.pickEvery === '1'; });
            });
        },
    });
    if (!picked || !picked.length) return [];
    return picked.map(code => {
        const [b, e] = code.split(':').map(Number);
        return { book: loaded[b].name, ...loaded[b].entries[e] };
    });
}

// 内容能按剧情 YAML 解析的进大纲，其余进设定。
export function classifyEntries(entries) {
    const outline = [];
    const setting = [];
    for (const entry of entries) {
        try {
            outline.push({ entry, volumes: parseOutlineText(entry.content) });
        } catch {
            setting.push(entry);
        }
    }
    return { outline, setting };
}

// 导入后三选一：保留 / 关闭（可恢复）/ 删除（先下载备份）。
export async function afterImport(entries) {
    if (!entries.length) return;
    const choice = await choiceDialog({
        title: '世界书里的原条目',
        body: '原条目和注入内容会重复。关闭只改「禁用」，可随时在世界书里重新打开。',
        choices: [{ label: '保留', value: 'keep' }, { label: '删除', value: 'delete', danger: true }, { label: '关闭', value: 'disable', primary: true }],
    });
    if (!choice || choice === 'keep') return;
    const byBook = new Map();
    for (const entry of entries) {
        if (!byBook.has(entry.book)) byBook.set(entry.book, []);
        byBook.get(entry.book).push(entry.key);
    }
    try {
        for (const [book, keys] of byBook) {
            if (choice === 'disable') await setEntriesDisabled(book, keys, true);
            else downloadBlob(`${book}-已删条目备份.json`, JSON.stringify(await deleteEntries(book, keys), null, 2));
        }
        toast('success', choice === 'disable' ? '已关闭原条目。' : '已删除原条目，备份已下载。');
    } catch (error) {
        toast('error', error.message);
    }
}
