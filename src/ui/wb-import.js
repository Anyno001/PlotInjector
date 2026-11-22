import { wrapAuthorText } from '../core/clue-model.js';
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
    const html = loaded
        .map(
            (
                book,
                b,
            ) => `<p class="pi-hint"><b>${esc(book.name)}</b> <span class="pi-badge">${esc(book.source)}</span>${book.error ? ` <span class="pi-badge is-danger">${esc(book.error)}</span>` : ''}</p>
        ${book.entries
            .map(
                (entry, e) => `<label class="pi-check${entry.disabled ? ' is-off' : ''}"><input type="checkbox" data-pick="${b}:${e}">
        <span>${esc(entry.title)} <span class="pi-badge">≈${entry.content.length}字</span></span></label>`,
            )
            .join('')}`,
        )
        .join('');
    const picked = await openDialog({
        title,
        html: `<div class="pi-ref-top"><span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-pick-every="1">全选</button><button type="button" class="pi-btn is-sm is-ghost" data-pick-every="0">全不选</button></div>${html}`,
        actions: [
            { label: '取消', value: null },
            {
                label: '导入选中',
                primary: true,
                value: (root) => [...root.querySelectorAll('[data-pick]:checked')].map((input) => input.dataset.pick),
            },
        ],
        onMount(box) {
            box.addEventListener('click', (event) => {
                const every = event.target.closest('[data-pick-every]');
                if (every)
                    box.querySelectorAll('[data-pick]').forEach((input) => {
                        input.checked = every.dataset.pickEvery === '1';
                    });
            });
        },
    });
    if (!picked || !picked.length) return [];
    return picked.map((code) => {
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
export async function afterImport(entries, { authorCount = 0 } = {}) {
    if (!entries.length) return;
    let choice = await choiceDialog({
        title: '世界书里的原条目',
        body: `原条目和注入内容会重复。关闭只改「禁用」，可随时在世界书里重新打开。${authorCount ? `其中${authorCount}条导入为仅作者资料：原条目如果保持开启，世界书仍会把它注入正文，建议关闭。` : ''}`,
        choices: [
            { label: '保留', value: 'keep' },
            { label: '删除', value: 'delete', danger: !0 },
            { label: '关闭', value: 'disable', primary: !0 },
        ],
    });
    if (!choice || choice === 'keep') return;
    let byBook = /* @__PURE__ */ new Map();
    for (let entry of entries) (byBook.has(entry.book) || byBook.set(entry.book, []), byBook.get(entry.book).push(entry.key));
    try {
        for (let [book, keys] of byBook)
            choice === 'disable'
                ? await setEntriesDisabled(book, keys, !0)
                : downloadBlob(`${book}-已删条目备份.json`, JSON.stringify(await deleteEntries(book, keys), null, 2));
        toast('success', choice === 'disable' ? '已关闭原条目。' : '已删除原条目，备份已下载。');
    } catch (error) {
        toast('error', error.message);
    }
}

export async function chooseSettingKinds(entries) {
    if (!entries.length) return [];
    let html = `<p class="pi-hint">这些条目不是大纲格式，会放进「设定」。<b>公开设定</b>每轮都会注入正文；<b>仅作者资料</b>用 &lt;仅作者&gt; 包住，不注入，只在讨论和让AI写大纲时使用。剧情走向、真相、未来安排请选仅作者。</p>
        ${entries
            .map(
                (
                    entry,
                    i,
                ) => `<div class="pi-wbkind"><span>${esc(entry.title)} <span class="pi-badge">≈${entry.content.length}字</span></span>
        <label class="pi-check"><input type="radio" name="wbk${i}" value="author" data-kind="${i}" checked><span>仅作者</span></label>
        <label class="pi-check"><input type="radio" name="wbk${i}" value="public" data-kind="${i}"><span>公开设定</span></label></div>`,
            )
            .join('')}`;
    return (
        (await openDialog({
            title: '设定条目的用途',
            html,
            actions: [
                { label: '取消', value: null },
                {
                    label: '导入',
                    primary: !0,
                    value: (root) =>
                        entries.map((_, i) => {
                            let on = root.querySelector(`[data-kind="${i}"]:checked`);
                            return on ? on.value : 'author';
                        }),
                },
            ],
        })) || null
    );
}

export function wrapAuthor(text) {
    return wrapAuthorText(text);
}

export async function settingPiecesFromEntries(entries) {
    let kinds = await chooseSettingKinds(entries);
    if (kinds === null) return null;
    return {
        pieces: entries
            .map((entry, i) => (kinds[i] === 'author' ? wrapAuthor(entry.content) : String(entry.content || '').trim()))
            .filter(Boolean),
        authorCount: kinds.filter((k) => k === 'author').length,
    };
}
