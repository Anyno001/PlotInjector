import { importSrcFile, importJobFile, createImportStore } from './import-store.js';

import {
    INDEX_FILE,
    chatFile,
    emptyChat,
    emptyIndex,
    newProject,
    normalizeChat,
    normalizeIndex,
    normalizeProject,
    normalizeSettings,
    projectFile,
} from '../core/store.js';
import { createWriter, deleteFile, readJsonFile, writeJsonFile } from '../host/files.js';
import { cardKey } from '../host/st.js';

// 数据层：索引常驻内存；项目、讨论按需读。读出的对象共享只读，改动一律浅拷后整体替换。
export function createDataStore({ onChange = () => {}, onError = () => {} } = {}) {
    let index = emptyIndex(),
        ready = !1;
    const projects = /* @__PURE__ */ new Map(),
        chats = /* @__PURE__ */ new Map(),
        loading = /* @__PURE__ */ new Map(),
        failed = /* @__PURE__ */ new Set(),
        writer = createWriter({
            onSaved(name, bytes) {
                if ((failed.delete(name), name === INDEX_FILE)) return;
                const id = /^pi-[pc]-(.+)\.json$/.exec(name)?.[1],
                    meta = index.projects.find((item) => item.id === id),
                    kind = name.startsWith('pi-p-') ? 'project' : 'chat',
                    knownFile = index.files.includes(name);
                (meta &&
                    meta.bytes[kind] !== bytes &&
                    (index = {
                        ...index,
                        projects: index.projects.map((item) =>
                            item === meta ? { ...item, bytes: { ...item.bytes, [kind]: bytes } } : item,
                        ),
                    }),
                    knownFile || (index = { ...index, files: [...index.files, name] }),
                    (!knownFile || (meta && meta.bytes[kind] !== bytes)) && writer.schedule(INDEX_FILE, index),
                    onChange('saved'));
            },
            onError(name, error) {
                (failed.add(name), onError(error), onChange('save-failed'));
            },
        });
    function setIndex(next) {
        ((index = next), writer.schedule(INDEX_FILE, index), onChange('index'));
    }
    async function init() {
        const file = await readJsonFile(INDEX_FILE);
        ((index = normalizeIndex(file && file.value)),
            index.files.includes(INDEX_FILE) || (index = { ...index, files: [INDEX_FILE, ...index.files] }),
            (ready = !0),
            onChange('index'));
    }
    async function loadProject(id) {
        if (projects.has(id)) return projects.get(id);
        if (loading.has(`p:${id}`)) return loading.get(`p:${id}`);
        let job = (async () => {
            let file = await readJsonFile(projectFile(id)),
                project = file ? normalizeProject(file.value, id) : null;
            return (project && (projects.set(id, project), syncImportIndex(project)), project);
        })().finally(() => loading.delete(`p:${id}`));
        return (loading.set(`p:${id}`, job), job);
    }
    function syncImportIndex(project) {
        let ids = Array.isArray(project.imports) ? project.imports : [],
            meta2 = index.projects.find((item) => item.id === project.id);
        if (!meta2 || !ids.length) return;
        let names = ids.flatMap((x) => [importSrcFile(x), importJobFile(x)]),
            missingIds = ids.filter((x) => !(meta2.imports || []).includes(x)),
            missingFiles = names.filter((n) => !index.files.includes(n));
        (missingIds.length || missingFiles.length) &&
            setIndex({
                ...index,
                files: [...index.files, ...missingFiles],
                projects: index.projects.map((item) =>
                    item === meta2 ? { ...item, imports: [...(item.imports || []), ...missingIds] } : item,
                ),
            });
    }
    function touch(id, patch = {}) {
        setIndex({
            ...index,
            projects: index.projects.map((item) => (item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item)),
        });
    }
    function saveProject(project) {
        (projects.set(project.id, project),
            writer.schedule(projectFile(project.id), project),
            touch(project.id, { name: project.name }),
            onChange('project', project.id));
    }
    function updateProject(id, fn) {
        const current = projects.get(id);
        if (!current) throw new Error('项目尚未载入');
        const value = fn(current),
            next = value && value !== current ? normalizeProject(value, id) : value;
        return (next && next !== current && saveProject(next), next);
    }
    async function createProject(name, group = '', mode = 'normal') {
        return addProject(newProject(name, Date.now(), mode), group);
    }
    // 加入一个已经建好的项目（新建、从项目文件导入共用）。
    async function addProject(project, group = '') {
        projects.set(project.id, project);
        const bytes = await writeJsonFile(projectFile(project.id), project);
        return (
            (index = {
                ...index,
                projects: [
                    ...index.projects,
                    { id: project.id, name: project.name, group, updatedAt: Date.now(), bytes: { project: bytes } },
                ],
                files: index.files.includes(projectFile(project.id)) ? index.files : [...index.files, projectFile(project.id)],
            }),
            writer.schedule(INDEX_FILE, index),
            onChange('index'),
            project
        );
    }
    let imports = createImportStore(),
        rawCreate = imports.create,
        rawDrop = imports.drop;
    ((imports.create = async (opts) => {
        let job = await rawCreate(opts),
            names = [importSrcFile(job.id), importJobFile(job.id)];
        return (
            setIndex({
                ...index,
                files: [...index.files, ...names.filter((n) => !index.files.includes(n))],
                projects: index.projects.map((item) =>
                    item.id === job.projectId ? { ...item, imports: [...(item.imports || []), job.id] } : item,
                ),
            }),
            job
        );
    }),
        (imports.drop = async (id) => {
            await rawDrop(id);
            let names = /* @__PURE__ */ new Set([importSrcFile(id), importJobFile(id)]);
            setIndex({
                ...index,
                files: index.files.filter((n) => !names.has(n)),
                projects: index.projects.map((item) =>
                    item.imports && item.imports.includes(id) ? { ...item, imports: item.imports.filter((x) => x !== id) } : item,
                ),
            });
        }));
    async function deleteProject(id) {
        let p = projects.get(id) || (await loadProject(id).catch(() => null));
        for (let jobId of p && Array.isArray(p.imports) ? p.imports : []) await imports.drop(jobId).catch(() => {});
        (writer.cancel(projectFile(id)),
            writer.cancel(chatFile(id)),
            await deleteFile(projectFile(id)),
            await deleteFile(chatFile(id)),
            projects.delete(id),
            chats.delete(id));
        const active = { ...index.active };
        for (const key of Object.keys(active)) active[key] === id && delete active[key];
        setIndex({
            ...index,
            active,
            projects: index.projects.filter((item) => item.id !== id),
            files: index.files.filter((name) => name !== projectFile(id) && name !== chatFile(id)),
        });
    }
    async function loadChat(id) {
        if (chats.has(id)) return chats.get(id);
        const file = await readJsonFile(chatFile(id)),
            chat = normalizeChat(file && file.value);
        return (chats.set(id, chat), chat);
    }
    function saveChat(id, chat) {
        (chats.set(id, chat), writer.schedule(chatFile(id), chat), onChange('chat', id));
    }
    async function clearChat(id) {
        (writer.cancel(chatFile(id)), await deleteFile(chatFile(id)), chats.set(id, emptyChat()));
        const meta = index.projects.find((item) => item.id === id);
        setIndex({
            ...index,
            files: index.files.filter((name) => name !== chatFile(id)),
            projects: index.projects.map((item) => (item === meta ? { ...item, bytes: { ...item.bytes, chat: 0 } } : item)),
        });
    }
    function activeIdFor(key = cardKey()) {
        const id = key ? index.active[key] : '';
        return id && index.projects.some((item) => item.id === id) ? id : '';
    }
    function setActive(id, key = cardKey()) {
        if (!key) throw new Error('请先打开一张角色卡');
        const active = { ...index.active };
        (id ? (active[key] = id) : delete active[key], setIndex({ ...index, active }), id && touch(id));
    }
    function updateSettings(patch) {
        setIndex({ ...index, settings: normalizeSettings({ ...index.settings, ...patch }) });
    }
    function forgetFiles(names) {
        const drop = new Set(names);
        setIndex({ ...index, files: index.files.filter((name) => !drop.has(name)) });
    }
    function resetAll() {
        for (const name of [...index.files]) writer.cancel(name);
        (projects.clear(), chats.clear(), (index = emptyIndex()), onChange('index'));
    }
    return {
        init,
        isReady: () => ready,
        index: () => index,
        settings: () => index.settings,
        project: (id) => projects.get(id) || null,
        loadProject,
        saveProject,
        updateProject,
        createProject,
        addProject,
        deleteProject,
        renameProject: (id, name, group) => {
            const project = projects.get(id);
            (project && name && project.name !== name && saveProject({ ...project, name }),
                touch(id, { ...(name ? { name } : {}), ...(group !== void 0 ? { group } : {}) }));
        },
        loadChat,
        chat: (id) => chats.get(id) || null,
        saveChat,
        clearChat,
        activeIdFor,
        setActive,
        updateSettings,
        forgetFiles,
        resetAll,
        failedFiles: () => [...failed],
        retryFailed: async () => {
            await writer.flush();
            await imports.flush();
        },
        flush: async () => {
            (await writer.flush(), await imports.flush());
        },
        imports,
    };
}
