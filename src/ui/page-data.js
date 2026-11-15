import { importSrcFile, importJobFile } from '../app/import-store.js';

import { INDEX_FILE, chatFile, formatBytes, projectFile } from '../core/store.js';
import { buildZip } from '../core/zip.js';
import { buildPersonaFile } from '../core/persona-file.js';
import { clearChatProgress } from '../app/progress-store.js';
import { deleteFile, readRawFile, verifyFiles } from '../host/files.js';
import { downloadBlob, hostWindow, toast } from '../host/st.js';
import { compareVersions, fetchLatestVersion } from '../host/update.js';
import { confirmDialog, esc } from './dom.js';
import { writeUi } from './app.js';

const st = (view) => view.tabState('data');

// 最新版本每次打开页面只查一次，结果留到刷新酒馆页面为止。
const latest = { state: '', version: '', error: '' };
// 自动更新版由加载器启动，会留下 __plotInjectorLoader；单文件版没有，只能重新导入。
const viaLoader = () => Boolean(window.__plotInjectorLoader);

async function checkLatest(view) {
    latest.state = 'checking';
    view.renderBody();
    try {
        latest.version = await fetchLatestVersion();
        latest.state = 'done';
    } catch (error) {
        latest.error = error.message;
        latest.state = 'error';
    }
    view.renderBody();
}

function versionCard(view, settings) {
    if (!latest.state) checkLatest(view);
    const newer = latest.state === 'done' && compareVersions(latest.version, view.version) > 0;
    const status =
        {
            checking: '<span class="pi-spin"></span>正在检测最新版本…',
            done: newer ? `最新版本 v${esc(latest.version)}，可以更新。` : '已是最新版本。',
            error: `检测失败：${esc(latest.error)}`,
        }[latest.state] || '';
    const pinned = settings.loaderRef;
    let note = '';
    if (newer && !viaLoader()) note = '当前是单文件版，需重新导入新版 JSON 才能更新。';
    else if (newer && pinned) note = `已指定 ${esc(pinned)}，清空指定版本后才会更新。`;
    const updateBtn =
        newer && viaLoader()
            ? `<button type="button" class="pi-btn is-sm is-primary" data-act="update-now">更新到 v${esc(latest.version)}</button>`
            : '';
    return `<div class="pi-card"><h3>版本更新</h3>
        <p class="pi-hint">当前版本 v${esc(view.version)}。${status}</p>
        ${note ? `<p class="pi-hint is-warn">${note}</p>` : ''}
        <div class="pi-tools ${updateBtn ? 'is-c2' : 'is-c1'} pi-acts"><button type="button" class="pi-btn is-sm" data-act="check-update"${latest.state === 'checking' ? ' disabled' : ''}>检查更新</button>${updateBtn}</div>
        <label class="pi-field"><span>指定版本</span><input class="pi-inp" data-set="loaderRef" value="${esc(settings.loaderRef)}" placeholder="留空跟随最新版本，可填 v0.1.0 或 main"></label></div>`;
}

function referenced(index) {
    let names = /* @__PURE__ */ new Set([INDEX_FILE]);
    for (let item of index.projects) {
        (names.add(projectFile(item.id)), names.add(chatFile(item.id)));
        for (let id of item.imports || []) (names.add(importSrcFile(id)), names.add(importJobFile(id)));
    }
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
    const rows = index.projects
        .map(
            (item) => `<tr><td>${esc(item.group ? `${item.group}／` : '')}${esc(item.name)}</td>
        ${fileCell(view, projectFile(item.id), item.bytes.project)}${fileCell(view, chatFile(item.id), item.bytes.chat)}</tr>`,
        )
        .join('');
    return `<table class="pi-files"><thead><tr><th>项目</th><th>设定+大纲</th><th>讨论记录</th></tr></thead><tbody>${rows || '<tr><td colspan="3" class="pi-hint">没有项目</td></tr>'}</tbody></table>`;
}

export function render(view) {
    const s = st(view);
    if (!s.verified && !s.verifying) verify(view);
    const orphans = s.verified ? Object.keys(s.verified).filter((name) => !referenced(view.data.index()).has(name)) : [];
    const settings = view.data.settings();
    return `<div class="pi-card"><h3>本地文件</h3>
        ${filesTable(view)}
        <div class="pi-equal pi-acts"><button type="button" class="pi-btn is-sm" data-act="verify">${s.verifying ? '<span class="pi-spin"></span>' : ''}重新核对</button>
            <button type="button" class="pi-btn is-sm" data-act="orphans"${orphans.length ? '' : ' disabled'}>清理孤立文件${orphans.length ? `（${orphans.length}）` : ''}</button>
            <button type="button" class="pi-btn is-sm" data-act="clear-chats">清空全部讨论记录</button></div></div>
        <div class="pi-card"><h3>人设备份</h3>
        <p class="pi-hint">只导出各项目的人设线，不含大纲、设定和讨论。导入在项目的「人设」页。</p>
        <div class="pi-equal is-one pi-acts"><button type="button" class="pi-btn is-sm" data-act="export-personas">导出全部项目的人设</button></div></div>
        ${versionCard(view, settings)}
        <div class="pi-card"><h3>重置插件</h3>
        <p class="pi-hint">删除所有项目、讨论记录和当前聊天的进度，执行前自动下载备份。</p>
        <div class="pi-equal is-one pi-acts"><button type="button" class="pi-btn is-sm is-danger" data-act="wipe">备份并删除</button></div></div>`;
}

// 输完离开输入框或按回车才保存，避免存下「v0.1」这类半截版本号；只填数字时自动补 v。
export function onChange(view, target) {
    if (target.dataset.set !== 'loaderRef') return;
    let ref = target.value.trim();
    if (/^\d+\.\d+\.\d+$/.test(ref)) ref = `v${ref}`;
    if (ref && ref !== 'main' && !/^v\d+\.\d+\.\d+$/.test(ref)) {
        toast('warning', '版本号格式应为 v0.1.0 这样的三段数字，或填 main；未保存。');
        target.value = view.data.settings().loaderRef;
        return;
    }
    target.value = ref;
    view.data.updateSettings({ loaderRef: ref });
    toast('success', ref ? `已指定 ${ref}，刷新酒馆页面生效。` : '已改为跟随最新版本，刷新酒馆页面生效。');
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
    'check-update'(view) {
        return checkLatest(view);
    },
    // 加载器把最新版本号缓存 30 分钟；清掉缓存再刷新，才会马上取到新版。
    async 'update-now'(view) {
        const pinned = view.data.settings().loaderRef,
            body = pinned ? `将清空指定版本（${pinned}），改为跟随最新版本，然后刷新酒馆页面。` : '将刷新酒馆页面，载入最新版本。';
        (await confirmDialog({ title: `更新到 v${latest.version}`, body, okLabel: '更新并刷新' })) &&
            (pinned && (view.data.updateSettings({ loaderRef: '' }), await view.data.flush()),
            writeUi({ loader: null }),
            hostWindow().location.reload());
    },
    verify(view) {
        return ((st(view).verified = null), verify(view));
    },
    async 'export-file'(view, target) {
        await view.data.flush().catch(() => {});
        let text = await readRawFile(target.dataset.name);
        if (text == null) throw new Error('文件读取失败');
        downloadBlob(target.dataset.name, text);
    },
    async 'export-personas'(view) {
        const files = [];
        for (const item of view.data.index().projects) {
            const project = view.data.project(item.id) || (await view.data.loadProject(item.id));
            !project ||
                !project.personas ||
                !project.personas.lines.length ||
                files.push({
                    name: `人设-${item.group ? `${item.group}-` : ''}${item.name}.json`,
                    data: JSON.stringify(buildPersonaFile(project.personas, { project: item.name, version: view.version }), null, 2),
                });
        }
        if (!files.length) throw new Error('没有可导出的人设（项目里还没有人设线，或项目尚未载入）');
        (files.length === 1
            ? downloadBlob(files[0].name, files[0].data)
            : downloadBlob(
                  `剧情注入器人设-${/* @__PURE__ */ new Date().toISOString().slice(0, 10)}.zip`,
                  buildZip(files),
                  'application/zip',
              ),
            toast('success', `已导出 ${files.length} 个项目的人设。`));
    },
    async 'delete-file'(view, target) {
        const name = target.dataset.name;
        if (
            !(await confirmDialog({
                title: '删除文件',
                list: [name],
                body: name.startsWith('pi-p-') ? '这是项目的设定和大纲，删除后项目无法打开。' : '',
                okLabel: '删除',
                danger: !0,
            }))
        )
            return;
        const id = /^pi-[pc]-(.+)\.json$/.exec(name)?.[1];
        (name.startsWith('pi-c-') ? await view.data.clearChat(id) : name.startsWith('pi-p-') && (await view.data.deleteProject(id)),
            (st(view).verified = null),
            view.render());
    },
    async orphans(view) {
        const names = Object.keys(st(view).verified || {}).filter(
                (name) => !referenced(view.data.index()).has(name) && st(view).verified[name],
            ),
            gone = Object.keys(st(view).verified || {}).filter(
                (name) => !referenced(view.data.index()).has(name) && !st(view).verified[name],
            );
        if (!names.length && gone.length) return (view.data.forgetFiles(gone), (st(view).verified = null), view.renderBody());
        if (await confirmDialog({ title: '清理孤立文件', body: '这些文件不属于任何项目：', list: names, okLabel: '删除', danger: !0 })) {
            for (const name of names) await deleteFile(name);
            (view.data.forgetFiles([...names, ...gone]), (st(view).verified = null), view.renderBody());
        }
    },
    async 'clear-chats'(view) {
        const ids = view.data.index().projects.map((item) => item.id);
        if (await confirmDialog({ title: '清空全部讨论记录', list: ids.map(chatFile), okLabel: '清空', danger: !0 })) {
            for (const id of ids) await view.data.clearChat(id);
            ((st(view).verified = null), view.renderBody());
        }
    },
    async wipe(view) {
        await view.data.flush().catch(() => {});
        let index = view.data.index(),
            names = [.../* @__PURE__ */ new Set([...index.files, ...referenced(index)])],
            files = [];
        for (const name of names) {
            const text = await readRawFile(name);
            text != null && files.push({ name, data: text });
        }
        if (!files.length) throw new Error('没有可清除的文件');
        if (
            (downloadBlob(
                `剧情注入器备份-${/* @__PURE__ */ new Date().toISOString().slice(0, 10)}.zip`,
                buildZip(files),
                'application/zip',
            ),
            !!(await confirmDialog({
                title: '重置插件',
                body: '备份已下载。确认后删除以下文件和当前聊天的进度，无法撤销。',
                list: files.map((file) => file.name),
                okLabel: '全部删除',
                danger: !0,
            })))
        ) {
            for (const file of files) await deleteFile(file.name);
            (await clearChatProgress(),
                view.data.resetAll(),
                (view.projectId = ''),
                (st(view).verified = null),
                view.runtime.refresh(),
                view.render(),
                toast('success', '已全部清除。'));
        }
    },
};

export const refreshOn = ['index'];
