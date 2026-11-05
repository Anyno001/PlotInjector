import { POSITIONS, ROLES } from '../core/inject.js';
import { acuField, groupByField } from '../core/acu.js';
import { estimateTokens } from '../core/tokens.js';
import { buildPattern, healthCheck, orderPlan, punctPlan, regexPlan, sortEntries, triggerTest } from '../core/wbtools.js';
import { chatMessages, countTokens, downloadBlob, hostDocument, toast } from '../host/st.js';
import { addEntries, allBookNames, bookEntries, globalBookNames, boundBookNames, createBook, deleteEntries, duplicateBook, loadBook, patchEntries, removeBook, renameBook, restoreEntries, setEntriesDisabled, snapshotEntries, transferEntries, updateEntry } from '../host/worldbook.js';
import { confirmDialog, esc, menuDialog, openDialog, options, pickFiles, promptDialog } from './dom.js';
import { ICONS } from './styles.js';

const st = view => view.tabState('books');

// 直接管理当前角色卡关联的世界书：勾选框即世界书里的开关，改动写进世界书文件。
// 手写条目可展开编辑位置、深度、顺序、触发方式、关键词和内容；
// TavernDB-ACU 数据库条目由数据库插件维护，按字段折叠，只给开关。
const GROUPS = {
    on: entries => entries.filter(entry => !acuField(entry.title) && !entry.disabled),
    off: entries => entries.filter(entry => !acuField(entry.title) && entry.disabled),
};

// 开关做成滑块，和批量选择的勾选框区分开：圆点在右是开启，在左是关闭。
const toggle = entry => `<button type="button" class="pi-switch${entry.disabled ? '' : ' is-on'}" role="switch" aria-checked="${entry.disabled ? 'false' : 'true'}" data-act="wb-toggle" data-wb-toggle="${esc(entry.key)}" title="${entry.disabled ? '已关闭，点击开启' : '已开启，点击关闭'}"></button>`;
// 搜索：不分大小写，条目按标题、关键词、内容找，世界书按名字找。
const norm = text => String(text || '').trim().toLowerCase();
const entryHit = (entry, q) => !q || [entry.title, entry.content, ...entry.keys, ...entry.keysSecondary].some(text => String(text).toLowerCase().includes(q));
// 搜索框平时收起：世界书搜索从页面「更多」打开，条目搜索从工具条「搜索」打开，同一时间只开一个，× 关闭并清空。
const searchBox = (key, value, placeholder) => `<div class="pi-psearch is-wb">${ICONS.search}<input class="pi-inp" data-search="${key}" placeholder="${placeholder}" value="${esc(value || '')}">
    <button type="button" class="pi-icon-btn pi-search-x" data-act="search-close" title="关闭搜索">${ICONS.close}</button></div>`;

const title = entry =>`<span class="pi-wb-title" title="${esc(entry.title)}">${esc(entry.title)}</span>`;

const num = value => (value ? value : '');

function advanced(entry, key, open) {
    const field = (f, label, value, attrs = 'type="number" min="0"') => `<label class="pi-field"><span>${label}</span><input class="pi-inp" ${attrs} data-wb-edit="${key}" data-f="${f}" value="${esc(value)}"></label>`;
    const check = (f, label, on) => `<label class="pi-check"><input type="checkbox" data-wb-edit="${key}" data-f="${f}"${on ? ' checked' : ''}><span>${label}</span></label>`;
    return `<button type="button" class="pi-wb-adv" data-act="wb-adv" data-key="${key}">${open ? ICONS.caretDown : ICONS.caret}<span>高级</span></button>
        ${open ? `<div class="pi-wb-adv-bd"><div class="pi-pair">${field('probability', '概率（0-100）', entry.probability, 'type="number" min="0" max="100"')}${field('groupWeight', '组权重', entry.groupWeight)}</div>
        ${field('group', '分组', entry.group, 'type="text"')}
        <div class="pi-pair is-c3">${field('sticky', '粘性', num(entry.sticky))}${field('cooldown', '冷却', num(entry.cooldown))}${field('delay', '延迟', num(entry.delay))}</div>
        <div class="pi-pair">${check('excludeRecursion', '不可被递归触发', entry.excludeRecursion)}${check('preventRecursion', '阻止进一步递归', entry.preventRecursion)}</div></div>` : ''}`;
}

function editor(entry, adv) {
    const atDepth = entry.position === 4;
    const key = esc(entry.key);
    return `<div class="pi-wb-edit">
        <label class="pi-field"><span>标题</span><input class="pi-inp" data-wb-edit="${key}" data-f="comment" value="${esc(entry.comment)}"></label>
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
        ${advanced(entry, key, adv)}
    </div>`;
}

function entryRow(entry, open, adv) {
    return `<div class="pi-wb-item"><div class="pi-wb-row${entry.disabled ? ' is-off' : ''}">${toggle(entry)}
        <button type="button" class="pi-wb-name" data-act="wb-open" data-key="${esc(entry.key)}">${open ? ICONS.caretDown : ICONS.caret}${title(entry)}</button>
        ${entry.constant ? '<span class="pi-badge">常驻</span>' : ''}
        <button type="button" class="pi-icon-btn" data-act="wb-dup" data-key="${esc(entry.key)}" title="复制条目">${ICONS.copy}</button>
        <button type="button" class="pi-icon-btn is-danger" data-act="wb-delete" data-key="${esc(entry.key)}" title="删除">${ICONS.trash}</button></div>
        ${open ? editor(entry, adv) : ''}</div>`;
}

// 批量选择时勾选框改为「选中」，不再是开关；顺序值放在行尾，排序前后好对照。
function pickRow(entry, picked) {
    return `<label class="pi-wb-row${entry.disabled ? ' is-off' : ''}"><input type="checkbox" data-wb-pick="${esc(entry.key)}"${picked.has(entry.key) ? ' checked' : ''}>
        ${title(entry)}<span class="pi-badge">顺序 ${entry.order}</span></label>`;
}

const bulkBtn = (attrs, label, disabled) => `<button type="button" class="pi-btn is-sm is-ghost" ${attrs}${disabled ? ' disabled' : ''}>${label}</button>`;

function section(name, entries, empty, bulk, openKey, picked, advOpen) {
    const rows = entries.map(entry => (picked ? pickRow(entry, picked) : entryRow(entry, entry.key === openKey, Boolean(advOpen && advOpen.has(entry.key))))).join('');
    return `<div class="pi-wb-sec"><div class="pi-wb-sec-hd">${name}<small>${entries.length}</small>${entries.length ? `<span class="pi-wb-bulk">${bulk}</span>` : ''}</div>
        ${rows || `<p class="pi-hint">${empty}</p>`}</div>`;
}

function tokenText(s) {
    if (!s.tokens) return '<span class="pi-meta">统计中…</span>';
    const mark = s.tokens.exact ? '' : '≈';
    return `<span class="pi-meta">开启 ${mark}${s.tokens.on} · 全部 ${mark}${s.tokens.all} token</span>`;
}

// 工具条：小图标 + 短名横排成一行色块，次要操作收进「更多」。
const tbtn = (act, icon, label, { danger = false, disabled = false } = {}) => `<button type="button" class="pi-tbtn${danger ? ' is-danger' : ''}" data-act="${act}"${disabled ? ' disabled' : ''}>${ICONS[icon]}<span>${label}</span></button>`;
const moreBtn = act => `<button type="button" class="pi-tbtn is-more" data-act="${act}" title="更多">${ICONS.more}</button>`;

// 平时是整本世界书的操作；批量选择时换成针对选中条目的操作。
function bookBar(s, entries) {
    if (!s.picking) {
        const none = !handwritten(entries).length;
        return `<div class="pi-tbar">${tbtn('wb-add', 'entryPlus', '新建条目')}${tbtn('wb-picking', 'checks', '批量', { disabled: none })}
            ${tbtn('wb-regex', 'replace', '替换', { disabled: none })}${tbtn('wb-search', 'search', '搜索', { disabled: !entries.length })}${tbtn('wb-undo', 'undo', '撤销', { disabled: !undoStack(s.book).length })}${moreBtn('book-more')}</div>`;
    }
    const none = !s.picked.size;
    return `<div class="pi-tbar">${tbtn('wb-move', 'move', '迁移', { disabled: none })}${tbtn('wb-order', 'sort', '重排', { disabled: none })}
        ${tbtn('wb-regex', 'replace', '替换', { disabled: none })}${tbtn('wb-pick-delete', 'trash', '删除', { danger: true, disabled: none })}${moreBtn('pick-more')}</div>`;
}

const SORTS = [{ value: '', label: '原顺序' }, { value: 'order', label: '顺序值' }, { value: 'tokens', label: 'token 从大到小' }, { value: 'title', label: '标题' }];
const tokenOf = s => entry => (s.tokenMap && s.tokenMap.has(entry.key) ? s.tokenMap.get(entry.key) : estimateTokens(entry.content));
const sortList = (s, list) => sortEntries(list, s.sort, tokenOf(s));

// 撤销：每本书最多 10 步写前快照，只存在本次会话的内存里。
const UNDO_MAX = 10;
const undoStacks = new Map();
const undoStack = name => undoStacks.get(name) || [];

// merge 相同的连续操作（同一条目同一字段的连续编辑）只记第一步。
async function snap(view, label, merge = '') {
    const name = st(view).book;
    if (merge && undoStack(name).at(-1)?.merge === merge) return;
    const entries = await snapshotEntries(name);
    const stack = undoStack(name);
    if (merge && stack.at(-1)?.merge === merge) return;
    undoStacks.set(name, [...stack, { label, entries, merge }].slice(-UNDO_MAX));
    const btn = hostDocument().querySelector('.pi-root [data-act="wb-undo"]');
    if (btn) btn.disabled = false;
}

// 搜索时只列匹配的条目；整区开关、全选也只作用在列出来的条目上。
const shownEntries = s => (s.entries || []).filter(entry => entryHit(entry, norm(s.query)));

function bookBody(s, allEntries) {
    const picked = s.picking ? s.picked : null;
    const q = norm(s.query);
    const entries = shownEntries(s);
    const on = sortList(s, GROUPS.on(entries));
    const off = sortList(s, GROUPS.off(entries));
    const all = picked && handwritten(entries).length && handwritten(entries).every(entry => picked.has(entry.key));
    const info = picked
        ? `<div class="pi-wb-info is-pick"><span class="pi-wb-count">已选 ${picked.size} 条</span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="wb-pick-all">${all ? '取消全选' : '全选'}</button>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="wb-picking">完成</button></div>`
        : `<div class="pi-wb-info"><span class="pi-wb-tokens">${tokenText(s)}</span></div>`;
    const sorter = `<div class="pi-wb-sort"><span class="pi-meta">排序</span><select class="pi-sel" data-wb-sort>${options(SORTS, s.sort || '')}</select></div>`;
    const head = `${info}${bookBar(s, allEntries)}${s.search === 'entry' && allEntries.length ? searchBox('entry', s.query, '搜索条目标题、关键词、内容') : ''}${allEntries.length ? sorter : ''}`;
    if (!allEntries.length) return `${head}<p class="pi-hint">没有条目</p>`;
    if (!entries.length) return `${head}<p class="pi-hint">没有匹配的条目</p>`;
    if (picked) {
        return `${head}${section('已开启', on, '没有开启的条目', '', '', picked)}
            ${section('已关闭', off, '没有关闭的条目', '', '', picked)}`;
    }
    return `${head}${section('已开启', on, '没有开启的条目', bulkBtn('data-act="wb-bulk" data-group="on"', '全部关闭'), s.openKey, null, s.advOpen)}
        ${section('已关闭', off, '没有关闭的条目', bulkBtn('data-act="wb-bulk" data-group="off"', '全部开启'), s.openKey, null, s.advOpen)}
        ${acuSection(entries, s.openFields || new Set(), Boolean(q))}`;
}

// 数据库条目：每个字段默认收起，只显示字段名、开启数和一键开关。
function acuSection(entries, openFields, expandAll = false) {
    const fields = groupByField(entries);
    if (!fields.length) return '';
    const total = fields.reduce((sum, [, list]) => sum + list.length, 0);
    const sub = ([field, list]) => {
        const on = list.filter(entry => !entry.disabled).length;
        const bulk = bulkBtn(`data-act="acu-field" data-field="${esc(field)}" data-on="1"`, '一键开启', on === list.length)
            + bulkBtn(`data-act="acu-field" data-field="${esc(field)}" data-on="0"`, '一键关闭', !on);
        const open = expandAll || openFields.has(field);
        return `<div class="pi-wb-sub"><div class="pi-wb-sub-hd is-fold" data-act="acu-fold" data-field="${esc(field)}">${open ? ICONS.caretDown : ICONS.caret}<span class="pi-wb-field" title="${esc(field)}">${esc(field)}</span><small>${on}/${list.length}</small><span class="pi-wb-bulk">${bulk}</span></div>
            ${open ? list.map(entry => `<div class="pi-wb-row${entry.disabled ? ' is-off' : ''}">${toggle(entry)}${title(entry)}</div>`).join('') : ''}</div>`;
    };
    return `<div class="pi-wb-sec"><div class="pi-wb-sec-hd">数据库条目<small>${total}</small></div>${fields.map(sub).join('')}</div>`;
}

// 列出：当前卡绑定的、全局启用的、剧情注入器专用的、本次打开过的其他世界书（只在本次会话里记住）。
function listedBooks(s) {
    const books = [...boundBookNames()];
    const add = (name, source) => { if (!books.some(item => item.name === name)) books.push({ name, source }); };
    const names = allBookNames();
    for (const name of globalBookNames()) if (names.includes(name)) add(name, '全局');
    for (const name of names) if (name.startsWith('剧情注入器·')) add(name, '专用');
    for (const name of s.extra || []) if (names.includes(name)) add(name, '其他');
    return books;
}

// 搜索世界书时，列表里的书按名字筛，再把名字匹配的其他世界书（未绑定、未全局启用的）接在后面，点开即可编辑。
function shownBooks(s) {
    const q = norm(s.bookQuery);
    const listed = listedBooks(s);
    if (!q) return listed;
    const hit = name => name.toLowerCase().includes(q);
    const others = allBookNames().filter(name => hit(name) && !listed.some(book => book.name === name)).map(name => ({ name, source: '其他' }));
    return [...listed.filter(book => hit(book.name)), ...others];
}

export function render(view) {
    const s = st(view);
    const list = shownBooks(s).map(book => {
        const open = s.book === book.name;
        const entries = open && s.entries ? s.entries : null;
        return `<div class="pi-book${open ? ' is-open' : ''}"><div class="pi-book-hd" data-act="open-book" data-book="${esc(book.name)}">
            ${open ? ICONS.caretDown : ICONS.caret}<span class="pi-etitle" title="${esc(book.name)}">${esc(book.name)}</span><span class="pi-meta">${esc(book.source)}</span></div>
            ${entries ? `<div class="pi-book-bd">${bookBody(s, entries)}</div>` : ''}</div>`;
    }).join('');
    return `<div class="pi-card pi-wb"><h3>世界书<span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="book-new">${ICONS.plus}新建</button>
            <button type="button" class="pi-icon-btn" data-act="page-more" title="更多">${ICONS.more}</button></h3>
        <p class="pi-hint is-warn">注意：这里的操作真的会修改你的世界书！</p>
        ${s.search === 'book' ? searchBox('book', s.bookQuery, '搜索所有世界书') : ''}
        ${list || `<p class="pi-hint">${norm(s.bookQuery) ? '没有匹配的世界书' : '没有关联或全局启用的世界书，可从「更多」搜索或打开其他世界书。'}</p>`}</div>`;
}

const splitKeys = text => String(text || '').split(/[,，、\n]/).map(item => item.trim()).filter(Boolean);

function editPatch(target) {
    const field = target.dataset.f;
    const value = target.value;
    if (field === 'constant') return { constant: value === '1' };
    if (field === 'key' || field === 'keysecondary') return { [field]: splitKeys(value) };
    if (field === 'position' || field === 'role') return { [field]: Number(value) };
    if (field === 'depth' || field === 'order') return { [field]: Math.max(0, Math.round(Number(value) || 0)) };
    if (field === 'content' || field === 'comment' || field === 'group') return { [field]: value };
    if (field === 'probability') {
        const n = String(value).trim() === '' ? 100 : Math.min(100, Math.max(0, Math.round(Number(value) || 0)));
        return { probability: n, useProbability: n < 100 };
    }
    if (field === 'groupWeight') return { groupWeight: String(value).trim() === '' ? 100 : Math.max(0, Math.round(Number(value) || 0)) };
    if (field === 'sticky' || field === 'cooldown' || field === 'delay') return { [field]: value === '' ? null : Math.max(0, Math.round(Number(value) || 0)) };
    if (field === 'excludeRecursion' || field === 'preventRecursion') return { [field]: Boolean(target.checked) };
    return null;
}

// change 事件：下拉框选完即触发；输入框和内容在离开时触发，所以不会每打一个字写一次世界书。
// 下拉框会改变编辑区结构（位置切到 @D 出现深度、触发方式切换关键词框），保存后重画。
async function saveEdit(view, target) {
    const key = target.dataset.wbEdit;
    const patch = editPatch(target);
    if (!patch || !(st(view).entries || []).some(item => item.key === key)) return;
    await snap(view, '编辑条目', `${key}:${target.dataset.f}`);
    await updateEntry(st(view).book, key, patch);
    st(view).entries = bookEntries(await loadBook(st(view).book));
    if (target.tagName === 'SELECT' || target.dataset.f === 'comment') view.renderBody();
}

// 每输入一个字重画一次列表（焦点和光标由 renderBody 保留）；输入法选字中不重画，选完由 compositionend 补一次。
export function onInput(view, target, event) {
    if (!target.dataset.search || event.isComposing) return;
    st(view)[target.dataset.search === 'book' ? 'bookQuery' : 'query'] = target.value;
    view.renderBody();
}

export async function onChange(view, target) {
    if (target.dataset.wbSort !== undefined) {
        st(view).sort = target.value;
        return view.renderBody();
    }
    if (target.dataset.wbPick) {
        const picked = st(view).picked;
        if (target.checked) picked.add(target.dataset.wbPick);
        else picked.delete(target.dataset.wbPick);
        return view.renderBody();
    }
    if (target.dataset.wbEdit) return saveEdit(view, target);
}

async function reloadBook(view) {
    const s = st(view);
    s.entries = bookEntries(await loadBook(s.book));
    const keys = new Set(s.entries.map(entry => entry.key));
    s.picked = new Set([...(s.picked || [])].filter(key => keys.has(key)));
    view.renderBody();
    countBook(view);
}

// 每条内容的 token 数按文字缓存：开关、编辑一条后只重算变了的那条，不必把整本书再送一遍分词器。
const tokenCache = new Map();
const TOKEN_CACHE_MAX = 3000;
// 同时最多发这么多个分词请求，大书第一次统计时不把酒馆后端一下子压满。
const TOKEN_BATCH = 8;

async function entryTokens(text) {
    if (tokenCache.has(text)) return tokenCache.get(text);
    const count = await countTokens(text);
    if (count == null) return null;
    if (tokenCache.size >= TOKEN_CACHE_MAX) tokenCache.delete(tokenCache.keys().next().value);
    tokenCache.set(text, count);
    return count;
}

// 用酒馆的分词器统计；酒馆不支持时按字数粗估。只换掉 token 那一行，不打断正在编辑的输入框。
async function countBook(view) {
    const s = st(view);
    const book = s.book;
    const entries = s.entries || [];
    const counts = [];
    for (let i = 0; i < entries.length; i += TOKEN_BATCH) {
        counts.push(...await Promise.all(entries.slice(i, i + TOKEN_BATCH).map(entry => (entry.content ? entryTokens(entry.content) : 0))));
        if (s.book !== book || s.entries !== entries) return;
    }
    const exact = counts.every(count => count != null);
    let on = 0;
    let all = 0;
    entries.forEach((entry, index) => {
        const n = exact ? counts[index] : estimateTokens(entry.content);
        all += n;
        if (!entry.disabled) on += n;
    });
    s.tokens = { on, all, exact };
    s.tokenMap = new Map(entries.map((entry, index) => [entry.key, exact ? counts[index] : estimateTokens(entry.content)]));
    if (s.sort === 'tokens') view.renderBody();
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
    await snap(view, label);
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
        const keys = pick(shownEntries(st(view))).map(entry => entry.key);
        if (!keys.length) return;
        target.disabled = true;
        await snap(view, '整区开关');
        await setEntriesDisabled(st(view).book, keys, group === 'on');
        await reloadBook(view);
    },
    async 'wb-toggle'(view, target) {
        const key = target.dataset.wbToggle;
        const entry = (st(view).entries || []).find(item => item.key === key);
        if (!entry) return;
        target.disabled = true;
        await snap(view, '开关条目');
        await setEntriesDisabled(st(view).book, [key], !entry.disabled);
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
        const keys = shownEntries(st(view)).filter(entry => acuField(entry.title) === target.dataset.field && entry.disabled === on).map(entry => entry.key);
        if (!keys.length) return;
        target.disabled = true;
        await snap(view, '数据库字段开关');
        await setEntriesDisabled(st(view).book, keys, !on);
        await reloadBook(view);
    },
    async 'open-book'(view, target, event) {
        if (event.target.closest('button,input')) return;
        const s = st(view);
        if (s.book === target.dataset.book) { s.book = ''; s.entries = null; return view.renderBody(); }
        await openBook(view, target.dataset.book);
    },
    async 'book-new'(view) {
        const name = await promptDialog({ title: '新建世界书', label: '名称' });
        if (name == null) return;
        await openBook(view, await createBook(name));
        toast('success', `已新建「${name.trim()}」。`);
    },
    // 导入酒馆导出的世界书 json（{ entries: {...} }），名字默认取文件名，重名时另起名字。
    async 'book-import'(view) {
        const [file] = await pickFiles({ accept: '.json,application/json' });
        if (!file) return;
        let data;
        try { data = JSON.parse(await file.text()); } catch { throw new Error('文件不是有效的 JSON'); }
        if (!data || typeof data.entries !== 'object' || Array.isArray(data.entries)) throw new Error('文件里没有世界书条目（entries）');
        let name = file.name.replace(/\.json$/i, '');
        if (allBookNames().includes(name)) {
            name = await promptDialog({ title: '导入世界书', label: `已有「${name}」，请换一个名字`, value: `${name}-导入` });
            if (name == null) return;
        }
        await openBook(view, await createBook(name, data));
        toast('success', `已导入「${name.trim()}」，${Object.keys(data.entries).length} 条。`);
    },
    async 'book-open'(view) {
        const shown = new Set(listedBooks(st(view)).map(book => book.name));
        const names = allBookNames().filter(name => !shown.has(name));
        if (!names.length) return toast('info', '没有其他世界书。');
        const name = await menuDialog({ title: '打开其他世界书', items: names.map(item => ({ label: item, value: item, icon: ICONS.book })) });
        if (name) await openBook(view, name);
    },
    async 'book-rename'(view) {
        const s = st(view);
        const from = s.book;
        const to = await promptDialog({ title: '重命名世界书', label: '新名称', value: from });
        if (to == null || to.trim() === from) return;
        const result = await renameBook(from, to);
        undoStacks.delete(from);
        if (result.failed.length) toast('warning', `已另存为「${result.name}」，但${result.failed.join('、')}的绑定没能改过去，旧书「${from}」保留，请在酒馆里手动改绑定后删除。`);
        else toast('success', `已重命名为「${result.name}」。`);
        await openBook(view, result.name);
    },
    async 'book-copy'(view) {
        const s = st(view);
        const to = await promptDialog({ title: '另存副本', label: '副本名称', value: `${s.book}-副本` });
        if (to == null) return;
        const name = await duplicateBook(s.book, to);
        s.extra = [...new Set([...(s.extra || []), name])];
        toast('success', `已另存为「${name}」。`);
        view.renderBody();
    },
    async 'book-export'(view) {
        const s = st(view);
        downloadBlob(`${s.book}.json`, JSON.stringify(await loadBook(s.book), null, 2));
    },
    async 'book-delete'(view) {
        const s = st(view);
        const name = s.book;
        const ok = await confirmDialog({ title: `删除世界书「${name}」`, body: '先下载整本备份，再删除并解除聊天、角色卡和全局的绑定，无法撤销。', list: [`${s.entries.length} 条条目`], okLabel: '删除', danger: true });
        if (!ok) return;
        downloadBlob(`${name}-备份.json`, JSON.stringify(await loadBook(name), null, 2));
        const result = await removeBook(name);
        undoStacks.delete(name);
        if (result.failed.length) toast('warning', `已删除，但${result.failed.join('、')}的绑定没能解除，请在酒馆里检查。`);
        else toast('success', `已删除「${name}」。`);
        s.book = '';
        s.entries = null;
        s.extra = (s.extra || []).filter(item => item !== name);
        view.renderBody();
    },
    'book-search'(view) { openSearch(view, 'book'); },
    'wb-search'(view) {
        if (st(view).search === 'entry') return actions['search-close'](view);
        openSearch(view, 'entry');
    },
    'search-close'(view) {
        const s = st(view);
        s.search = '';
        s.query = '';
        s.bookQuery = '';
        view.renderBody();
    },
    async 'wb-add'(view) {
        const s = st(view);
        await snap(view, '新建条目');
        const [key] = await addEntries(s.book);
        await reloadBook(view);
        s.openKey = key;
        view.renderBody();
    },
    async 'wb-dup'(view, target) {
        await snap(view, '复制条目');
        await addEntries(st(view).book, [target.dataset.key]);
        await reloadBook(view);
    },
    // 「更多」菜单：页面级、整本书级、选中条目级各一份，选中后转给对应的操作。
    async 'page-more'(view, target, event) {
        const pick = await menuDialog({ title: '世界书', items: [
            { label: '导入世界书', value: 'book-import', icon: ICONS.upload },
            { label: '搜索世界书', value: 'book-search', icon: ICONS.search },
            { label: '打开其他世界书', value: 'book-open', icon: ICONS.folder },
        ] });
        if (pick) return actions[pick](view, target, event);
    },
    async 'book-more'(view, target, event) {
        const pick = await menuDialog({ title: st(view).book, items: [
            { label: '触发测试', value: 'wb-trigger', icon: ICONS.search },
            { label: '体检', value: 'wb-health', icon: ICONS.pulse },
            { label: '重命名', value: 'book-rename', icon: ICONS.pencil },
            { label: '另存副本', value: 'book-copy', icon: ICONS.copy },
            { label: '导出', value: 'book-export', icon: ICONS.download },
            { label: '删除本书', value: 'book-delete', icon: ICONS.trash, danger: true },
        ] });
        if (pick) return actions[pick](view, target, event);
    },
    async 'pick-more'(view, target, event) {
        const pick = await menuDialog({ title: `已选 ${st(view).picked.size} 条`, items: [
            { label: '开启', value: 'wb-pick-on', icon: ICONS.eye },
            { label: '关闭', value: 'wb-pick-off', icon: ICONS.eyeOff },
        ] });
        if (pick) return actions[pick](view, target, event);
    },
    'wb-pick-on': view => setPicked(view, false),
    'wb-pick-off': view => setPicked(view, true),
    async 'wb-pick-delete'(view) {
        const s = st(view);
        const entries = pickedEntries(s);
        if (!(await confirmDialog({ title: `从「${s.book}」删除 ${entries.length} 条`, body: '删除前会下载这些条目的备份。', list: previewList(entries.map(entry => entry.title)), okLabel: '删除', danger: true }))) return;
        await snap(view, '批量删除');
        const backup = await deleteEntries(s.book, entries.map(entry => entry.key));
        downloadBlob(`${s.book}-已删条目备份.json`, JSON.stringify(backup, null, 2));
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
    'wb-pick-all'(view) {
        const s = st(view);
        const list = handwritten(shownEntries(s));
        const all = list.every(entry => s.picked.has(entry.key));
        const picked = new Set(s.picked);
        for (const entry of list) all ? picked.delete(entry.key) : picked.add(entry.key);
        s.picked = picked;
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
        if (input.move) await snap(view, '迁移（移动）');
        const result = await transferEntries(s.book, input.to, entries.map(entry => entry.key), { move: input.move });
        toast('success', `已${input.move ? '移动' : '复制'} ${result.copied} 条到「${input.to}」${result.created ? '（新建）' : ''}。`);
        s.picked = new Set();
        await reloadBook(view);
    },
    'wb-adv'(view, target) {
        const s = st(view);
        const open = new Set(s.advOpen || []);
        if (open.has(target.dataset.key)) open.delete(target.dataset.key);
        else open.add(target.dataset.key);
        s.advOpen = open;
        view.renderBody();
    },
    async 'wb-undo'(view) {
        const s = st(view);
        const stack = undoStack(s.book);
        const last = stack.at(-1);
        if (!last) return;
        if (!(await confirmDialog({ title: `撤销：${last.label}`, body: '整本世界书将写回该操作之前的状态。本书在这之后的其他改动也会一并撤回。', okLabel: '撤销', danger: true }))) return;
        await restoreEntries(s.book, last.entries);
        undoStacks.set(s.book, stack.slice(0, -1));
        toast('success', `已撤销：${last.label}`);
        await reloadBook(view);
    },
    // 触发测试：文本框可贴文字，也可取最近 N 楼；按酒馆规则模拟当前书的触发（不含递归、概率、分组）。
    async 'wb-trigger'(view) {
        const s = st(view);
        const entries = handwritten(s.entries || []);
        const tk = tokenOf(s);
        const row = (item, extra) => `<div class="pi-wb-hit"><span class="pi-wb-title" title="${esc(item.title)}">${esc(item.title)}</span><span class="pi-meta">${extra}${item.tokens} token</span></div>`;
        const group = (name, list, extra) => (list.length ? `<div class="pi-wb-sec-hd">${name}<small>${list.length}</small></div>${list.map(item => row(item, extra(item))).join('')}` : '');
        const run = box => {
            const text = box.querySelector('[data-f="text"]').value;
            const result = triggerTest(entries, text, tk);
            const body = group('常驻', result.constant, () => '') + group('关键词命中', result.keyword, item => `${esc(item.matched.join('、'))} · `);
            box.querySelector('[data-f="result"]').innerHTML = `${body || '<p class="pi-hint">没有命中的条目</p>'}
                <p class="pi-meta">合计 ${result.tokens.total} token（常驻 ${result.tokens.constant}，关键词 ${result.tokens.keyword}）</p>
                <p class="pi-meta">未计算递归、概率、分组与扫描深度</p>`;
        };
        await openDialog({
            title: '触发测试',
            html: `<label class="pi-field"><span>测试文字</span><textarea class="pi-ta" rows="5" data-f="text"></textarea></label>
                <div class="pi-pair"><label class="pi-field"><span>最近楼层数</span><input class="pi-inp" type="number" min="1" data-f="count" value="5"></label>
                <div class="pi-field"><span>&nbsp;</span><button type="button" class="pi-btn" data-f="fetch">取最近 N 楼</button></div></div>
                <div data-f="result"></div>`,
            actions: [{ label: '关闭', value: null }, { label: '测试', primary: true, value: box => { run(box); } }],
            onMount: box => box.querySelector('[data-f="fetch"]').addEventListener('click', () => {
                const n = Math.max(1, Math.round(Number(box.querySelector('[data-f="count"]').value) || 5));
                const floors = chatMessages().filter(msg => msg && !(msg.is_system && msg.extra && msg.extra.type) && String(msg.mes || '').trim()).slice(-n);
                box.querySelector('[data-f="text"]').value = floors.map(msg => String(msg.mes)).join('\n\n');
                run(box);
            }),
        });
    },
    // 体检：只看手写条目；问题按类列出，点条目跳转并展开。
    async 'wb-health'(view, target, event) {
        const s = st(view);
        const entries = handwritten(s.entries || []);
        const report = healthCheck(entries, tokenOf(s));
        const punct = punctPlan(entries);
        const item = (key, name, detail = '') => `<button type="button" class="pi-menu-item" data-dlg-value="${esc(key)}"><span>${esc(name)}</span>${detail ? `<span class="pi-meta">${esc(detail)}</span>` : ''}</button>`;
        const sec = (name, list, build) => (list.length ? `<div class="pi-wb-sec-hd">${name}<small>${list.length}</small></div><div class="pi-menu-list">${list.map(build).join('')}</div>` : '');
        const c = report.constant;
        const html = `${sec('过短的关键词', report.shortKeys, x => item(x.key, x.title, x.words.join('、')))}
            ${sec('没有主要关键词的开启条目', report.noKeys, x => item(x.key, x.title))}
            ${sec('多个条目共用的关键词', report.shared, x => item(x.entries[0].key, x.word, x.entries.map(e => e.title).join('、')))}
            ${sec('标题重复', report.dupTitles, x => item(x.entries[0].key, x.title, `${x.entries.length} 条`))}
            ${punct.length ? `<div class="pi-wb-sec-hd">关键词标点<small>${punct.length}</small></div><div class="pi-menu-list">${item('::punct', '修复关键词标点', `${punct.length} 条`)}</div>` : ''}
            <div class="pi-wb-sec-hd">常驻条目</div>
            <p class="${c.warn ? 'pi-hint is-warn' : 'pi-meta'}">${c.count} 条，${c.tokens} token，占开启条目 ${Math.round(c.ratio * 100)}%${c.warn ? '，占比偏高' : ''}</p>`;
        const pick = await openDialog({ title: '体检', html, actions: [{ label: '关闭', value: null }] });
        if (!pick) return;
        if (pick === '::punct') return actions['wb-punct'](view, target, event);
        s.picking = false;
        s.query = '';
        if (s.search === 'entry') s.search = '';
        s.openKey = pick;
        view.renderBody();
        [...hostDocument().querySelectorAll('.pi-root .pi-wb-name')].find(node => node.dataset.key === pick)?.scrollIntoView({ block: 'center' });
    },
    async 'wb-delete'(view, target) {
        const keys = [target.dataset.key];
        const titles = st(view).entries.filter(entry => keys.includes(entry.key)).map(entry => entry.title);
        if (!(await confirmDialog({ title: `从「${st(view).book}」删除条目`, body: '删除前会下载这个条目的备份。', list: titles, okLabel: '删除', danger: true }))) return;
        await snap(view, '删除条目');
        const backup = await deleteEntries(st(view).book, keys);
        downloadBlob(`${st(view).book}-已删条目备份.json`, JSON.stringify(backup, null, 2));
        await reloadBook(view);
    },
};

async function setPicked(view, disabled) {
    const s = st(view);
    await snap(view, disabled ? '批量关闭' : '批量开启');
    await setEntriesDisabled(s.book, [...s.picked], disabled);
    await reloadBook(view);
}

// 打开一个搜索框时收起另一个并清空它的关键词，然后把光标放进新框。
function openSearch(view, key) {
    const s = st(view);
    s.search = key;
    if (key === 'book') s.query = '';
    else s.bookQuery = '';
    view.renderBody();
    hostDocument().querySelector(`.pi-root [data-search="${key}"]`)?.focus();
}

// 打开一本书并记进本次会话的列表（非当前卡绑定的书也能留在列表里）。
async function openBook(view, name) {
    const s = st(view);
    if (!listedBooks(s).some(book => book.name === name)) s.extra = [...new Set([...(s.extra || []), name])];
    s.book = name;
    s.entries = null;
    s.openKey = '';
    s.query = '';
    if (s.search === 'entry') s.search = '';
    s.tokens = null;
    s.tokenMap = null;
    s.picking = false;
    s.picked = new Set();
    await reloadBook(view);
}

export const refreshOn = ['chat'];
