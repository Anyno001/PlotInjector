import { INDEX_FILE, chatFile, emptyChat, emptyIndex, newProject, normalizeChat, normalizeIndex, normalizeProject, normalizeSettings, projectFile } from '../core/store.js';
import { createWriter, deleteFile, readJsonFile, writeJsonFile } from '../host/files.js';
import { cardKey } from '../host/st.js';

// 数据层：索引常驻内存；项目、讨论按需读。读出的对象共享只读，改动一律浅拷后整体替换。
export function createDataStore({ onChange = () => {}, onError = () => {} } = {}) {
    let index = emptyIndex();
    let ready = false;
    const projects = new Map();
    const chats = new Map();
    const loading = new Map();
    const failed = new Set();

    const writer = createWriter({
        onSaved(name, bytes) {
            failed.delete(name);
            if (name === INDEX_FILE) return;
            const id = /^pi-[pc]-(.+)\.json$/.exec(name)?.[1];
            const meta = index.projects.find(item => item.id === id);
            const kind = name.startsWith('pi-p-') ? 'project' : 'chat';
            const knownFile = index.files.includes(name);
            if (meta && meta.bytes[kind] !== bytes) {
                index = { ...index, projects: index.projects.map(item => (item === meta ? { ...item, bytes: { ...item.bytes, [kind]: bytes } } : item)) };
            }
            if (!knownFile) index = { ...index, files: [...index.files, name] };
            if (!knownFile || (meta && meta.bytes[kind] !== bytes)) writer.schedule(INDEX_FILE, index);
            onChange('saved');
        },
        onError(name, error) {
            failed.add(name);
            onError(error);
            onChange('save-failed');
        },
    });

    function setIndex(next) {
        index = next;
        writer.schedule(INDEX_FILE, index);
        onChange('index');
    }

    async function init() {
        const file = await readJsonFile(INDEX_FILE);
        index = normalizeIndex(file && file.value);
        if (!index.files.includes(INDEX_FILE)) index = { ...index, files: [INDEX_FILE, ...index.files] };
        ready = true;
        onChange('index');
    }

    async function loadProject(id) {
        if (projects.has(id)) return projects.get(id);
        if (loading.has(`p:${id}`)) return loading.get(`p:${id}`);
        const job = (async () => {
            const file = await readJsonFile(projectFile(id));
            const project = file ? normalizeProject(file.value, id) : null;
            if (project) projects.set(id, project);
            return project;
        })().finally(() => loading.delete(`p:${id}`));
        loading.set(`p:${id}`, job);
        return job;
    }

    function touch(id, patch = {}) {
        setIndex({ ...index, projects: index.projects.map(item => (item.id === id ? { ...item, ...patch, updatedAt: Date.now() } : item)) });
    }

    function saveProject(project) {
        projects.set(project.id, project);
        writer.schedule(projectFile(project.id), project);
        touch(project.id, { name: project.name });
        onChange('project', project.id);
    }

    function updateProject(id, fn) {
        const current = projects.get(id);
        if (!current) throw new Error('项目尚未载入');
        const next = fn(current);
        if (next && next !== current) saveProject(next);
        return next;
    }

    async function createProject(name, group = '') {
        const project = newProject(name);
        projects.set(project.id, project);
        const bytes = await writeJsonFile(projectFile(project.id), project);
        index = {
            ...index,
            projects: [...index.projects, { id: project.id, name: project.name, group, updatedAt: Date.now(), bytes: { project: bytes } }],
            files: index.files.includes(projectFile(project.id)) ? index.files : [...index.files, projectFile(project.id)],
        };
        writer.schedule(INDEX_FILE, index);
        onChange('index');
        return project;
    }

    async function deleteProject(id) {
        writer.cancel(projectFile(id));
        writer.cancel(chatFile(id));
        await deleteFile(projectFile(id));
        await deleteFile(chatFile(id));
        projects.delete(id);
        chats.delete(id);
        const active = { ...index.active };
        for (const key of Object.keys(active)) if (active[key] === id) delete active[key];
        setIndex({
            ...index,
            active,
            projects: index.projects.filter(item => item.id !== id),
            files: index.files.filter(name => name !== projectFile(id) && name !== chatFile(id)),
        });
    }

    async function loadChat(id) {
        if (chats.has(id)) return chats.get(id);
        const file = await readJsonFile(chatFile(id));
        const chat = normalizeChat(file && file.value);
        chats.set(id, chat);
        return chat;
    }

    function saveChat(id, chat) {
        chats.set(id, chat);
        writer.schedule(chatFile(id), chat);
        onChange('chat', id);
    }

    async function clearChat(id) {
        writer.cancel(chatFile(id));
        await deleteFile(chatFile(id));
        chats.set(id, emptyChat());
        const meta = index.projects.find(item => item.id === id);
        setIndex({
            ...index,
            files: index.files.filter(name => name !== chatFile(id)),
            projects: index.projects.map(item => (item === meta ? { ...item, bytes: { ...item.bytes, chat: 0 } } : item)),
        });
    }

    function activeIdFor(key = cardKey()) {
        const id = key ? index.active[key] : '';
        return id && index.projects.some(item => item.id === id) ? id : '';
    }

    function setActive(id, key = cardKey()) {
        if (!key) throw new Error('请先打开一张角色卡');
        const active = { ...index.active };
        if (id) active[key] = id;
        else delete active[key];
        setIndex({ ...index, active });
        if (id) touch(id);
    }

    function updateSettings(patch) {
        setIndex({ ...index, settings: normalizeSettings({ ...index.settings, ...patch }) });
    }

    function forgetFiles(names) {
        const drop = new Set(names);
        setIndex({ ...index, files: index.files.filter(name => !drop.has(name)) });
    }

    function resetAll() {
        for (const name of [...index.files]) writer.cancel(name);
        projects.clear();
        chats.clear();
        index = emptyIndex();
        onChange('index');
    }

    return {
        init,
        isReady: () => ready,
        index: () => index,
        settings: () => index.settings,
        project: id => projects.get(id) || null,
        loadProject,
        saveProject,
        updateProject,
        createProject,
        deleteProject,
        renameProject: (id, name, group) => {
            const project = projects.get(id);
            if (project && name && project.name !== name) saveProject({ ...project, name });
            touch(id, { ...(name ? { name } : {}), ...(group !== undefined ? { group } : {}) });
        },
        loadChat,
        chat: id => chats.get(id) || null,
        saveChat,
        clearChat,
        activeIdFor,
        setActive,
        updateSettings,
        forgetFiles,
        resetAll,
        failedFiles: () => [...failed],
        retryFailed: () => writer.flush(),
        flush: () => writer.flush(),
    };
}
