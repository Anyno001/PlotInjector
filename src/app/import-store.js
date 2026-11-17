import { readJsonFile, writeJsonFile, deleteFile } from '../host/files.js';

import { makeId, isPlainObject } from '../core/outline.js';

export const importSrcFile = (id) => `pi-i-${id}-src.json`;

export const importJobFile = (id) => `pi-i-${id}.json`;

export function createImportStore({ read = readJsonFile, write = writeJsonFile, remove = deleteFile } = {}) {
    let jobs = /* @__PURE__ */ new Map(),
        queues = /* @__PURE__ */ new Map(),
        saved = /* @__PURE__ */ new Map();
    // 同一文件的写入串行：后一次一定在前一次落盘之后才开始，旧状态不会覆盖新状态。
    function enqueue(name, fn) {
        let prev = queues.get(name) || Promise.resolve(),
            next = prev.catch(() => {}).then(fn);
        return (queues.set(name, next), next.finally(() => queues.get(name) === next && queues.delete(name)));
    }
    async function create({ projectId, text, mode, needs, kind = '' }) {
        let id = makeId('imp'),
            job = {
                version: 1,
                id,
                projectId,
                createdAt: Date.now(),
                mode,
                ...(kind ? { kind } : {}),
                needs: String(needs || ''),
                chars: String(text || '').length,
                step: 'split',
                parts: [],
                index: null,
                drafts: {},
                notes: {},
                adopted: [],
                rev: 0,
            };
        await write(importSrcFile(id), { text: String(text || '') });
        return (jobs.set(id, job), await save(job), job);
    }
    async function load(id) {
        if (jobs.has(id)) return jobs.get(id);
        let file = await read(importJobFile(id));
        return file && isPlainObject(file.value) ? (jobs.set(id, file.value), saved.set(id, file.value.rev || 0), file.value) : null;
    }
    async function source(id) {
        let file = await read(importSrcFile(id));
        return file && isPlainObject(file.value) ? String(file.value.text || '') : '';
    }
    // 更新任务：在内存里合成新状态并排队写入；返回写入完成（已确认落盘）的 Promise。
    function update(id, fn) {
        let cur = jobs.get(id);
        if (!cur) throw new Error('导入任务尚未载入');
        let next = { ...fn(cur), rev: (cur.rev || 0) + 1 };
        return (jobs.set(id, next), save(next));
    }
    function save(job) {
        return enqueue(importJobFile(job.id), async () => {
            (await write(importJobFile(job.id), job), saved.set(job.id, job.rev));
            return job;
        });
    }
    async function drop(id) {
        (jobs.delete(id),
            await enqueue(importJobFile(id), async () => {
                (await remove(importJobFile(id)).catch(() => !1), await remove(importSrcFile(id)).catch(() => !1));
            }));
    }
    // 所有排队的写入都完成后才返回。
    async function flush() {
        await Promise.all([...queues.values()].map((p) => p.catch(() => {})));
    }
    return { create, load, source, update, drop, flush, savedRev: (id) => saved.get(id) || 0, get: (id) => jobs.get(id) || null };
}

export function adoptKey(jobId, partNo, stageKey) {
    return `${jobId}:${partNo}:${stageKey}`;
}
