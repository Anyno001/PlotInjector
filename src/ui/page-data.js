import { INDEX_FILE, chatFile, formatBytes, projectFile } from '../core/store.js';
import { buildZip } from '../core/zip.js';
import { clearChatProgress } from '../app/progress-store.js';
import { deleteFile, readRawFile, verifyFiles } from '../host/files.js';
import { downloadBlob, toast } from '../host/st.js';
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

export function render(view) {
    const s = st(view);
    if (!s.verified && !s.verifying) verify(view);
    const orphans = s.verified ? Object.keys(s.verified).filter(name => !referenced(view.data.index()).has(name)) : [];
    const settings = view.data.settings();
    return `<div class="pi-card"><h3>本地文件</h3>
        <p class="pi-hint">项目数据保存在酒馆服务器的 user/files/pi-* 文件中，浏览器仅保存界面状态。</p>
        ${filesTable(view)}
        <div class="pi-equal pi-acts"><button type="button" class="pi-btn is-sm" data-act="verify">${s.verifying ? '<span class="pi-spin"></span>' : ''}重新核对</button>
            <button type="button" class="pi-btn is-sm" data-act="orphans"${orphans.length ? '' : ' disabled'}>清理孤立文件${orphans.length ? `（${orphans.length}）` : ''}</button>
            <button type="button" class="pi-btn is-sm" data-act="clear-chats">清空全部讨论记录</button></div></div>
        <div class="pi-card"><h3>版本更新</h3>
        <p class="pi-hint">当前版本 v${esc(view.version)}。默认自动使用最新发布版本。</p>
        <label class="pi-field"><span>指定版本</span><input class="pi-inp" data-set="loaderRef" value="${esc(settings.loaderRef)}" placeholder="留空跟随最新版本"></label>
        <p class="pi-hint">填写 v0.1.0 等版本号可固定版本，填写 main 使用开发中的最新代码。修改后刷新酒馆页面生效。</p></div>
        <div class="pi-card"><h3>重置插件</h3>
        <p class="pi-hint">删除所有项目、讨论记录和当前聊天的进度，其他聊天的进度保留。执行前自动下载zip备份，确认后无法撤销。</p>
        <button type="button" class="pi-btn is-sm is-danger" data-act="wipe">备份并删除</button></div>`;
}

export function onInput(view, target) {
    if (target.dataset.set === 'loaderRef') view.data.updateSettings({ loaderRef: target.value.trim() });
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
        if (!(await confirmDialog({ title: '清空全部讨论记录', list: ids.map(chatFile), okLabel: '清空', danger: true }))) return;
        for (const id of ids) await view.data.clearChat(id);
        st(view).verified = null;
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
        const ok = await confirmDialog({ title: '重置插件', body: '备份已下载。确认后删除以下文件和当前聊天的进度，无法撤销。', list: files.map(file => file.name), okLabel: '全部删除', danger: true });
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
