import { INDEX_FILE, chatFile, formatBytes, projectFile } from '../core/store.js';
import { buildZip } from '../core/zip.js';
import { clearChatProgress } from '../app/progress-store.js';
import { deleteFile, readRawFile, verifyFiles } from '../host/files.js';
import { cardName, downloadBlob, toast } from '../host/st.js';
import { allBookNames, bookEntries, boundBookNames, deleteBook, deleteEntries, loadBook, setEntriesDisabled } from '../host/worldbook.js';
import { confirmDialog, esc } from './dom.js';

const st = view => view.tabState('data');

function referenced(index) {
    const names = new Set([INDEX_FILE]);
    for (const item of index.projects) { names.add(projectFile(item.id)); names.add(chatFile(item.id)); }
    return names;
}

function fileCell(view, name, bytes) {
    const verified = st(view).verified;
    const missing = verified && verified[name] === false;
    const known = view.data.index().files.includes(name);
    if (!known && !bytes) return '<td class="pi-hint">—</td>';
    return `<td class="${missing ? 'is-missing' : ''}">${missing ? '已丢失' : formatBytes(bytes)}
        ${missing ? '' : `<button type="button" class="pi-btn is-sm is-ghost" data-act="export-file" data-name="${esc(name)}">导出</button>`}
        <button type="button" class="pi-btn is-sm is-ghost is-danger" data-act="delete-file" data-name="${esc(name)}">删除</button></td>`;
}

function filesTable(view) {
    const index = view.data.index();
    const rows = index.projects.map(item => `<tr><td>${esc(item.group ? `${item.group}／` : '')}${esc(item.name)}</td>
        ${fileCell(view, projectFile(item.id), item.bytes.project)}${fileCell(view, chatFile(item.id), item.bytes.chat)}</tr>`).join('');
    return `<table class="pi-files"><thead><tr><th>项目</th><th>设定+大纲</th><th>讨论记录</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="pi-hint">没有项目</td></tr>'}</tbody></table>`;
}

function bookCard(view) {
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
                <div class="pi-row"><button type="button" class="pi-btn is-sm" data-act="wb-disable">关闭勾选</button>
                <button type="button" class="pi-btn is-sm" data-act="wb-enable">重新打开勾选</button>
                <button type="button" class="pi-btn is-sm is-danger" data-act="wb-delete">删除勾选</button></div></div>` : ''}</div>`;
    }).join('');
    return `<div class="pi-card"><h3>世界书条目</h3>
        <p class="pi-hint">「${esc(cardName() || '未打开角色卡')}」关联的世界书。原来手改的剧情设定条目可在这里关闭或删除；删除前自动下载备份。</p>
        ${list || '<p class="pi-hint">没有关联的世界书。</p>'}</div>`;
}

export function render(view) {
    const s = st(view);
    if (!s.verified && !s.verifying) verify(view);
    const orphans = s.verified ? Object.keys(s.verified).filter(name => !referenced(view.data.index()).has(name)) : [];
    return `<div class="pi-card"><h3>本地文件<span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm" data-act="verify">${s.verifying ? '<span class="pi-spin"></span>' : ''}重新核对</button></h3>
        <p class="pi-hint">全部存在酒馆服务器 user/files/pi-*；浏览器只记界面状态（pi-ui）。</p>
        ${filesTable(view)}
        <div class="pi-row"><button type="button" class="pi-btn is-sm" data-act="orphans"${orphans.length ? '' : ' disabled'}>清理孤立文件${orphans.length ? `（${orphans.length}）` : ''}</button>
            <button type="button" class="pi-btn is-sm" data-act="clear-chats">清空所有讨论记录</button></div></div>
        ${bookCard(view)}
        <div class="pi-card"><h3>全部清除</h3>
        <p class="pi-hint">先下载一份 zip 备份，再删除全部 pi-* 文件和当前聊天里的进度。其他聊天里的进度不动。</p>
        <button type="button" class="pi-btn is-sm is-danger" data-act="wipe">全部清除</button></div>`;
}

async function verify(view) {
    const s = st(view);
    s.verifying = true;
    try {
        const names = [...new Set([...view.data.index().files, ...referenced(view.data.index())])];
        s.verified = await verifyFiles(names);
    } catch (error) {
        toast('error', error.message);
        s.verified = {};
    } finally {
        s.verifying = false;
        view.renderBody();
    }
}

async function selectedKeys(target) {
    return [...target.closest('.pi-entry').querySelectorAll('[data-wb-pick]:checked')].map(input => input.dataset.wbPick);
}

async function reloadBook(view) {
    st(view).entries = bookEntries(await loadBook(st(view).book));
    view.renderBody();
}

export const actions = {
    verify(view) {
        st(view).verified = null;
        return verify(view);
    },
    async 'export-file'(view, target) {
        const text = await readRawFile(target.dataset.name);
        if (text == null) throw new Error('文件读取失败');
        downloadBlob(target.dataset.name, text);
    },
    async 'delete-file'(view, target) {
        const name = target.dataset.name;
        if (!(await confirmDialog({ title: '删除文件', list: [name], body: name.startsWith('pi-p-') ? '这是项目的设定和大纲，删除后项目无法打开。' : '', okLabel: '删除', danger: true }))) return;
        const id = /^pi-[pc]-(.+)\.json$/.exec(name)?.[1];
        if (name.startsWith('pi-c-')) await view.data.clearChat(id);
        else if (name.startsWith('pi-p-')) await view.data.deleteProject(id);
        st(view).verified = null;
        view.render();
    },
    async orphans(view) {
        const names = Object.keys(st(view).verified || {}).filter(name => !referenced(view.data.index()).has(name) && st(view).verified[name]);
        const gone = Object.keys(st(view).verified || {}).filter(name => !referenced(view.data.index()).has(name) && !st(view).verified[name]);
        if (!names.length && gone.length) {
            view.data.forgetFiles(gone);
            st(view).verified = null;
            return view.renderBody();
        }
        if (!(await confirmDialog({ title: '清理孤立文件', body: '这些文件不属于任何项目：', list: names, okLabel: '删除', danger: true }))) return;
        for (const name of names) await deleteFile(name);
        view.data.forgetFiles([...names, ...gone]);
        st(view).verified = null;
        view.renderBody();
    },
    async 'clear-chats'(view) {
        const ids = view.data.index().projects.map(item => item.id);
        if (!(await confirmDialog({ title: '清空所有讨论记录', list: ids.map(chatFile), okLabel: '清空', danger: true }))) return;
        for (const id of ids) await view.data.clearChat(id);
        st(view).verified = null;
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
    async wipe(view) {
        const index = view.data.index();
        const names = [...new Set([...index.files, ...referenced(index)])];
        const files = [];
        for (const name of names) {
            const text = await readRawFile(name);
            if (text != null) files.push({ name, data: text });
        }
        if (!files.length) throw new Error('没有可清除的文件');
        downloadBlob(`剧情注入器备份-${new Date().toISOString().slice(0, 10)}.zip`, buildZip(files), 'application/zip');
        const ok = await confirmDialog({ title: '全部清除', body: '备份已下载。确认后删除以下文件和当前聊天的进度，无法撤销。', list: files.map(file => file.name), okLabel: '全部删除', danger: true });
        if (!ok) return;
        for (const file of files) await deleteFile(file.name);
        await clearChatProgress();
        view.data.resetAll();
        view.projectId = '';
        st(view).verified = null;
        view.runtime.refresh();
        view.render();
        toast('success', '已全部清除。');
    },
};

export const refreshOn = ['index'];
