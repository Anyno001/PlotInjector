import { importSrcFile, importJobFile } from '../app/import-store.js';

import { INDEX_FILE, chatFile, formatBytes, projectFile } from '../core/store.js';
import { buildZip } from '../core/zip.js';
import { buildPersonaFile } from '../core/persona-file.js';
import { chatHasFoldedRows, clearChatProgress } from '../app/progress-store.js';
import { deleteFile, readRawFile, verifyFiles } from '../host/files.js';
import { downloadBlob, hostWindow, toast } from '../host/st.js';
import { compareVersions, fetchLatestVersion } from '../host/update.js';
import { confirmDialog, esc, openDialog, options } from './dom.js';
import { buildProjectFile, projectSummary, PROJECT_FILE_EXT } from '../core/project-file.js';
import { outlineToText } from '../core/outline.js';
import { labelsToPrepare } from '../core/fact-labels.js';
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
            done: newer ? `最新版本v${esc(latest.version)}，可以更新。` : '已是最新版本。',
            error: `检测失败：${esc(latest.error)}`,
        }[latest.state] || '';
    const pinned = settings.loaderRef;
    let note = '';
    if (newer && !viaLoader()) note = '当前是单文件版，需重新导入新版JSON才能更新。';
    else if (newer && pinned) note = `已指定${esc(pinned)}，清空指定版本后才会更新。`;
    const updateBtn =
        newer && viaLoader()
            ? `<button type="button" class="pi-btn is-sm is-primary" data-act="update-now">更新到v${esc(latest.version)}</button>`
            : '';
    return `<div class="pi-card"><h3>版本更新</h3>
        <p class="pi-hint">当前版本v${esc(view.version)}。${status}</p>
        ${note ? `<p class="pi-hint is-warn">${note}</p>` : ''}
        <div class="pi-tools ${updateBtn ? 'is-c2' : 'is-c1'} pi-acts"><button type="button" class="pi-btn is-sm" data-act="check-update"${latest.state === 'checking' ? ' disabled' : ''}>检查更新</button>${updateBtn}</div>
        <label class="pi-field"><span>指定版本</span><input class="pi-inp" data-set="loaderRef" value="${esc(settings.loaderRef)}" placeholder="留空跟随最新版本，可填v0.1.0或main"></label></div>`;
}

function referenced(index) {
    let names = /* @__PURE__ */ new Set([INDEX_FILE]);
    for (let item of index.projects) {
        (names.add(projectFile(item.id)), names.add(chatFile(item.id)));
        for (let id of item.imports || []) (names.add(importSrcFile(id)), names.add(importJobFile(id)));
    }
    return names;
}

function fileCell(view, label, name, bytes) {
    const verified = st(view).verified;
    const missing = verified && verified[name] === false;
    const known = view.data.index().files.includes(name);
    if (!known && !bytes) return `<div class="pi-file-row"><span class="pi-file-k">${label}</span><span class="pi-meta pi-grow">—</span></div>`;
    return `<div class="pi-file-row"><span class="pi-file-k">${label}</span><span class="pi-meta pi-grow${missing ? ' is-missing' : ''}">${missing ? '已丢失' : formatBytes(bytes)}</span>
        ${missing ? '' : `<button type="button" class="pi-btn is-sm is-ghost" data-act="export-file" data-name="${esc(name)}">导出</button>`}
        <button type="button" class="pi-btn is-sm is-ghost is-danger" data-act="delete-file" data-name="${esc(name)}">删除</button></div>`;
}

function filesTable(view) {
    const index = view.data.index();
    const rows = index.projects
        .map(
            (item) => `<div class="pi-file"><div class="pi-file-name">${esc(item.group ? `${item.group}／` : '')}${esc(item.name)}</div>
        ${fileCell(view, '设定+大纲', projectFile(item.id), item.bytes.project)}${fileCell(view, '讨论记录', chatFile(item.id), item.bytes.chat)}</div>`,
        )
        .join('');
    return `<div class="pi-files">${rows || '<p class="pi-hint">没有项目</p>'}</div>`;
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
            <button type="button" class="pi-btn is-sm" data-act="clear-chats" title="清空全部项目的讨论记录">清空讨论记录</button></div></div>
        ${exportCard(view)}
        <div class="pi-card"><h3>人设备份</h3>
        <p class="pi-hint">只导出各项目的人设线，不含大纲、设定和讨论。导入在项目的「人设」页。</p>
        <div class="pi-equal is-one pi-acts"><button type="button" class="pi-btn is-sm" data-act="export-personas">导出全部项目的人设</button></div></div>
        ${versionCard(view, settings)}
        <div class="pi-card"><h3>重置插件</h3>
        <p class="pi-hint">删除所有项目、讨论记录和当前聊天的进度，执行前自动下载备份。</p>
        <div class="pi-equal is-one pi-acts"><button type="button" class="pi-btn is-sm is-danger" data-act="wipe">备份并删除</button></div></div>`;
}

// 导出：选一个项目，导出大纲或完整项目；导入完整项目在「新项目」里。
function exportCard(view) {
    const projects = view.data.index().projects;
    if (!projects.length) return '';
    const s = st(view),
        pick = projects.some((p) => p.id === s.exportId) ? s.exportId : projects.some((p) => p.id === view.projectId) ? view.projectId : projects[0].id;
    s.exportId = pick;
    return `<div class="pi-card"><h3>导出项目</h3>
        <label class="pi-field"><span>项目</span><select class="pi-sel" data-export-pick>${options(
            projects.map((p) => ({ value: p.id, label: `${p.group ? `${p.group}／` : ''}${p.name}` })),
            pick,
        )}</select></label>
        <p class="pi-hint">完整项目可在其他酒馆通过「新项目」导入，包含线索标签、保密名单和推进设置；不含讨论记录和聊天进度。</p>
        <div class="pi-tools is-c3 pi-acts"><button type="button" class="pi-btn is-sm" data-act="export-outline" title="只导出大纲">导出大纲</button><button type="button" class="pi-btn is-sm is-primary" data-act="export-project" title="导出完整项目：带上线索标签、保密名单和推进设置">导出项目</button><button type="button" class="pi-btn is-sm is-danger" data-act="delete-current" title="删除当前选中的项目">删除项目</button></div></div>`;
}

async function exportTarget(view) {
    const id = st(view).exportId;
    const project = view.data.project(id) || (await view.data.loadProject(id).catch(() => null));
    if (!project) throw new Error('无法读取这个项目的文件');
    return project;
}

// 输完离开输入框或按回车才保存，避免存下「v0.1」这类半截版本号；只填数字时自动补 v。
export function onChange(view, target) {
    if (target.matches('[data-export-pick]')) return void (st(view).exportId = target.value);
    if (target.dataset.set !== 'loaderRef') return;
    let ref = target.value.trim();
    if (/^\d+\.\d+\.\d+$/.test(ref)) ref = `v${ref}`;
    if (ref && ref !== 'main' && !/^v\d+\.\d+\.\d+$/.test(ref)) {
        toast('warning', '版本号格式应为v0.1.0（三段数字）或main；未保存。');
        target.value = view.data.settings().loaderRef;
        return;
    }
    target.value = ref;
    view.data.updateSettings({ loaderRef: ref });
    toast('success', ref ? `已指定${ref}，刷新酒馆页面生效。` : '已改为跟随最新版本，刷新酒馆页面生效。');
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
        (await confirmDialog({ title: `更新到v${latest.version}`, body, okLabel: '更新并刷新' })) &&
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
    async 'delete-current'(view) {
        const id = st(view).exportId,
            item = view.data.index().projects.find((p) => p.id === id);
        if (!item) return;
        if (
            !(await confirmDialog({
                title: `删除「${item.name}」`,
                body: '删除后不能恢复，建议先导出完整项目。聊天里记录的该项目进度保留。',
                okLabel: '删除',
                danger: !0,
            }))
        )
            return;
        (await view.data.deleteProject(id), view.projectId === id && (view.projectId = ''), view.runtime.refresh(), (st(view).verified = null), (st(view).exportId = ''), view.render());
    },
    async 'export-outline'(view) {
        const project = await exportTarget(view);
        if (!project.outline.volumes.length) throw new Error('这个项目的大纲为空');
        downloadBlob(`${project.name}-大纲.yaml`, outlineToText(project.outline.volumes), 'text/yaml');
    },
    async 'export-project'(view) {
        await view.data.flush().catch(() => {});
        const project = await exportTarget(view),
            sum = projectSummary(project),
            parts = [
                sum.lines ? `${sum.lines}条剧情线` : '',
                sum.labels ? `${sum.labels}条线索标签` : '',
                project.secretNames ? '保密名单' : '',
                `推进方式（${sum.clue ? '线索推进' : '大纲推进'}）和注入设置`,
            ].filter(Boolean),
            // 发包前提醒还没准备好的线索标签（方案 四.2）：没标签或没审过的，玩家开到那条线时还要再调用模型
            todoLabels = sum.clue ? labelsToPrepare(project.outline.volumes, project.clue.labels) : [],
            noLabel = todoLabels.filter((x) => !x.review).length,
            unreviewed = todoLabels.length - noLabel,
            // 四种来源分开说明：旧标签沿用、用户写的不算模型检查过。
            srcCount = (k) => Object.values((project.clue && project.clue.labels) || {}).filter((v) => (k ? v.src === k : !v.src)).length,
            byUser = sum.clue ? srcCount('user') : 0,
            legacy = sum.clue ? srcCount('') : 0,
            pick = await openDialog({
                title: `导出「${project.name}」`,
                html: `<p class="pi-hint">包含：${esc(parts.join('、'))}。</p>
                ${todoLabels.length ? `<p class="pi-hint is-warn">还有${[noLabel && `${noLabel}条线索没有标签`, unreviewed && `${unreviewed}条标签没检查是否透露答案`].filter(Boolean).join('，')}。可以先到执行页点「立即准备」补齐，再导出。</p>` : ''}
                ${byUser || legacy ? `<p class="pi-hint">${[byUser && `${byUser}条是手动写的标签`, legacy && `${legacy}条为沿用的旧标签`].filter(Boolean).join('，')}，没有经过模型检查是否透露答案。</p>` : ''}
                ${sum.personas ? `<label class="pi-check"><input type="checkbox" data-f="personas" checked><span>人设（${sum.personas}条）</span></label>` : ''}
                ${sum.setting ? '<label class="pi-check"><input type="checkbox" data-f="setting" checked><span>设定</span></label>' : ''}
                ${sum.personas || sum.setting ? '<p class="pi-hint">人设、设定已写入世界书的，可不勾选。</p>' : ''}
                <p class="pi-hint">不含讨论记录、聊天进度和导入草稿。</p>`,
                actions: [
                    { label: '取消', value: null },
                    {
                        label: '导出',
                        primary: !0,
                        value: (box) => ({
                            personas: !!(box.querySelector('[data-f=personas]') || {}).checked,
                            setting: !!(box.querySelector('[data-f=setting]') || {}).checked,
                        }),
                    },
                ],
            });
        if (!pick) return;
        downloadBlob(`${project.name}${PROJECT_FILE_EXT}`, JSON.stringify(buildProjectFile(project, { ...pick, version: view.version }), null, 2), 'application/json');
        toast('success', `已导出「${project.name}」。`);
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
            toast('success', `已导出${files.length}个项目的人设。`));
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
        if (chatHasFoldedRows())
            return toast('warning', '当前聊天有已收起的表格行，重置会清掉它们唯一的记录。请先到执行页「剧情线」的「已结束」里打开「收起记录」，点「全部恢复」。');
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
