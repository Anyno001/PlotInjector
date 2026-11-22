import { hostWindow, requestHeaders } from './st.js';

// 酒馆本地文件：data/<用户>/user/files/<名>。读走静态路径，写/删/核对走 /api/files/*。
const fetchFn = () => hostWindow().fetch.bind(hostWindow());

function utf8Base64(text) {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return hostWindow().btoa(binary);
}

export const filePath = name => `user/files/${name}`;

// 手机网络卡住时请求可能一直不返回，读文件最多等这么久，超时报错让界面给出重试。
const READ_TIMEOUT_MS = 20000;

async function fetchWithTimeout(url, init) {
    const view = hostWindow();
    const controller = new view.AbortController();
    const timer = view.setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
    try {
        return await fetchFn()(url, { ...init, signal: controller.signal });
    } catch (error) {
        if (error && error.name === 'AbortError') throw new Error('读取超时，请检查网络');
        throw error;
    } finally {
        view.clearTimeout(timer);
    }
}

export async function readJsonFile(name) {
    const res = await fetchWithTimeout(`/${filePath(name)}?t=${Date.now()}`, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`读取${name}失败（HTTP ${res.status}）`);
    const text = await res.text();
    try {
        return { value: JSON.parse(text), bytes: new TextEncoder().encode(text).length };
    } catch {
        throw new Error(`${name}不是有效JSON`);
    }
}

export async function writeJsonFile(name, value) {
    const text = JSON.stringify(value);
    const res = await fetchFn()('/api/files/upload', {
        method: 'POST',
        headers: { ...requestHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, data: utf8Base64(text) }),
    });
    if (!res.ok) throw new Error(`写入${name}失败（HTTP ${res.status}）`);
    return new TextEncoder().encode(text).length;
}

export async function deleteFile(name) {
    const res = await fetchFn()('/api/files/delete', {
        method: 'POST',
        headers: { ...requestHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ path: filePath(name) }),
    });
    if (res.status === 404) return false;
    if (!res.ok) throw new Error(`删除${name}失败（HTTP ${res.status}）`);
    return true;
}

// 返回 { 文件名: 是否存在 }。
export async function verifyFiles(names) {
    if (!names.length) return {};
    const res = await fetchFn()('/api/files/verify', {
        method: 'POST',
        headers: { ...requestHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ urls: names.map(filePath) }),
    });
    if (!res.ok) throw new Error(`核对文件失败（HTTP ${res.status}）`);
    const data = await res.json();
    const out = {};
    for (const name of names) out[name] = Boolean(data[filePath(name)]);
    return out;
}

export async function readRawFile(name) {
    const res = await fetchFn()(`/${filePath(name)}?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) return null;
    return res.text();
}

// 防抖写入：同一文件 800ms 内只写最后一版；失败保留待写内容并回调，不静默丢。
export function createWriter({ delay = 800, write = writeJsonFile, onError = () => {}, onSaved = () => {} } = {}) {
    let pending = /* @__PURE__ */ new Map(),
        timers = /* @__PURE__ */ new Map(),
        running = /* @__PURE__ */ new Map(),
        view = hostWindow();
    function flushOne(name) {
        if ((timers.has(name) && view.clearTimeout(timers.get(name)), timers.delete(name), running.has(name))) return running.get(name);
        if (!pending.has(name)) return Promise.resolve();
        let value = pending.get(name);
        pending.delete(name);
        let job = (async () => {
            try {
                let bytes = await write(name, value);
                onSaved(name, bytes);
            } catch (error) {
                return (pending.has(name) || pending.set(name, value), onError(name, error), !1);
            }
            return !0;
        })().then(async (ok) => {
            (running.delete(name), ok && pending.has(name) && !timers.has(name) && (await flushOne(name)));
        });
        return (running.set(name, job), job);
    }
    return {
        schedule(name, value) {
            (pending.set(name, value),
                timers.has(name) && view.clearTimeout(timers.get(name)),
                timers.set(
                    name,
                    view.setTimeout(() => flushOne(name), delay),
                ));
        },
        // 等到所有待写和正在写的都结束（正在写的结束后，期间的新内容也会写完）。
        async flush() {
            for (let timer of timers.values()) view.clearTimeout(timer);
            timers.clear();
            for (let round = 0; round < 5 && (pending.size || running.size); round++) {
                let before = new Set(pending.keys());
                if (
                    (await Promise.all([.../* @__PURE__ */ new Set([...pending.keys(), ...running.keys()])].map(flushOne)),
                    [...pending.keys()].every((k) => before.has(k)) && !running.size && pending.size)
                )
                    break;
            }
        },
        cancel(name) {
            (timers.has(name) && view.clearTimeout(timers.get(name)), timers.delete(name), pending.delete(name));
        },
        hasPending: () => pending.size > 0 || running.size > 0,
        failed: () => [...pending.keys()].filter((name) => !timers.has(name)),
    };
}
