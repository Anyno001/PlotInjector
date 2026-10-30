import { ctx, helper, hostWindow, requestHeaders } from './st.js';

// 当前卡关联的世界书：聊天世界书、角色主/附加世界书。读写走酒馆的 loadWorldInfo/saveWorldInfo，不直接改文件。
export function boundBookNames() {
    const c = ctx();
    const names = [];
    const add = (name, source) => {
        const value = typeof name === 'string' ? name.trim() : '';
        if (value && !names.some(item => item.name === value)) names.push({ name: value, source });
    };
    if (!c) return names;
    add(c.chatMetadata && c.chatMetadata.world_info, '聊天');
    const card = c.characterId != null && Array.isArray(c.characters) ? c.characters[c.characterId] : null;
    add(card && card.data && card.data.extensions && card.data.extensions.world, '角色');
    try {
        const h = helper();
        const bound = h && typeof h.getCharWorldbookNames === 'function' ? h.getCharWorldbookNames('current') : null;
        if (bound) {
            add(bound.primary, '角色');
            (Array.isArray(bound.additional) ? bound.additional : []).forEach(name => add(name, '附加'));
        }
    } catch { /* 读不到附加世界书只列主书 */ }
    return names;
}

export function allBookNames() {
    const c = ctx();
    return c && typeof c.getWorldInfoNames === 'function' ? c.getWorldInfoNames() : [];
}

export async function loadBook(name) {
    const c = ctx();
    if (!c || typeof c.loadWorldInfo !== 'function') throw new Error('当前酒馆不支持读取世界书');
    const data = await c.loadWorldInfo(name);
    if (!data || !data.entries) throw new Error(`世界书「${name}」读取失败`);
    return data;
}

export function bookEntries(data) {
    return Object.entries(data.entries).map(([key, entry]) => ({
        uid: String(entry.uid ?? key),
        key,
        title: String(entry.comment || '').trim() || [].concat(entry.key || []).slice(0, 3).join('、') || `条目 ${entry.uid ?? key}`,
        comment: String(entry.comment || ''),
        content: String(entry.content || ''),
        disabled: Boolean(entry.disable),
        constant: Boolean(entry.constant),
        keys: [].concat(entry.key || []).map(String),
        keysSecondary: [].concat(entry.keysecondary || []).map(String),
        position: Number(entry.position) || 0,
        depth: Number(entry.depth ?? 4),
        role: Number(entry.role) || 0,
        order: Number(entry.order ?? 100),
    }));
}

async function saveBook(name, data) {
    const c = ctx();
    if (!c || typeof c.saveWorldInfo !== 'function') throw new Error('当前酒馆不支持保存世界书');
    await c.saveWorldInfo(name, data, true);
    if (typeof c.reloadWorldInfoEditor === 'function') c.reloadWorldInfoEditor(name);
}

// 同一本世界书的改动排队执行：连续改两个字段时，后一次读取要等前一次写完，否则后写的会把前一次改动盖掉。
const queues = new Map();
function queued(name, job) {
    const run = (queues.get(name) || Promise.resolve()).catch(() => {}).then(job);
    queues.set(name, run);
    return run;
}

const clone = value => hostWindow().structuredClone ? hostWindow().structuredClone(value) : JSON.parse(JSON.stringify(value));

export function setEntriesDisabled(name, keys, disabled) {
    return queued(name, async () => {
        const data = clone(await loadBook(name));
        for (const key of keys) if (data.entries[key]) data.entries[key].disable = disabled;
        await saveBook(name, data);
    });
}

// 改一条的触发与位置：constant 常驻 / 关键词触发，key 主要关键词，keysecondary 次要关键词，position/depth/role/order 与酒馆一致。
const ENTRY_FIELDS = ['comment', 'constant', 'key', 'keysecondary', 'position', 'depth', 'role', 'order', 'content'];

export function updateEntry(name, key, patch) {
    return queued(name, async () => {
        const data = clone(await loadBook(name));
        const entry = data.entries[key];
        if (!entry) throw new Error('条目已不存在');
        for (const field of ENTRY_FIELDS) if (Object.prototype.hasOwnProperty.call(patch, field)) entry[field] = patch[field];
        if (Object.prototype.hasOwnProperty.call(patch, 'keysecondary')) entry.selective = patch.keysecondary.length > 0;
        await saveBook(name, data);
    });
}

// 批量改多条：patches = [{ key, patch }]，一次读一次写。返回改动前的条目，供调用方下载备份。
export function patchEntries(name, patches) {
    return queued(name, async () => {
        const data = clone(await loadBook(name));
        const backup = { entries: {} };
        for (const { key, patch } of patches) {
            const entry = data.entries[key];
            if (!entry) continue;
            backup.entries[key] = clone(entry);
            for (const field of ENTRY_FIELDS) if (Object.prototype.hasOwnProperty.call(patch, field)) entry[field] = patch[field];
            if (Object.prototype.hasOwnProperty.call(patch, 'keysecondary')) entry.selective = patch.keysecondary.length > 0;
        }
        await saveBook(name, data);
        return backup;
    });
}

// 把条目复制或移动到另一本世界书；目标不存在时新建。uid 在目标书里重新编号，其余字段原样带过去。
export async function transferEntries(from, to, keys, { move = false } = {}) {
    if (!to || to === from) throw new Error('目标世界书不能和当前世界书相同');
    const source = await queued(from, () => loadBook(from));
    const exists = allBookNames().includes(to);
    let copied = 0;
    await queued(to, async () => {
        const data = exists ? clone(await loadBook(to)) : { entries: {} };
        let uid = Object.values(data.entries).reduce((max, entry) => Math.max(max, Number(entry.uid) || 0), -1);
        for (const key of keys) {
            const entry = source.entries[key];
            if (!entry) continue;
            uid += 1;
            data.entries[uid] = { ...clone(entry), uid, displayIndex: uid };
            copied += 1;
        }
        await saveBook(to, data);
    });
    const c = ctx();
    if (!exists && c && typeof c.updateWorldInfoList === 'function') await c.updateWorldInfoList();
    if (move && copied) await deleteEntries(from, keys);
    return { copied, created: !exists };
}

// 删除前返回被删条目组成的世界书 json，供调用方下载备份。
export function deleteEntries(name, keys) {
    return queued(name, () => deleteNow(name, keys));
}

async function deleteNow(name, keys) {
    const source = await loadBook(name);
    const backup = { entries: {} };
    const data = clone(source);
    for (const key of keys) {
        if (!data.entries[key]) continue;
        backup.entries[key] = data.entries[key];
        delete data.entries[key];
    }
    await saveBook(name, data);
    return backup;
}

export async function deleteBook(name) {
    const res = await hostWindow().fetch('/api/worldinfo/delete', {
        method: 'POST',
        headers: { ...requestHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ name }),
    });
    if (!res.ok) throw new Error(`删除世界书失败（HTTP ${res.status}）`);
    const c = ctx();
    if (c && typeof c.updateWorldInfoList === 'function') await c.updateWorldInfoList();
}

// 新条目的默认字段与酒馆新建条目一致：关键词触发、角色定义之后、顺序 100。
const BLANK_ENTRY = {
    key: [], keysecondary: [], comment: '新条目', content: '', constant: false, selective: true, selectiveLogic: 0,
    addMemo: true, order: 100, position: 1, disable: false, excludeRecursion: false, preventRecursion: false,
    probability: 100, useProbability: true, depth: 4, group: '', groupOverride: false, groupWeight: 100,
    scanDepth: null, caseSensitive: null, matchWholeWords: null, useGroupScoring: null, automationId: '', role: null,
};

const nextUid = data => Object.values(data.entries).reduce((max, entry) => Math.max(max, Number(entry.uid) || 0), -1) + 1;

// 新建或复制条目：sources 为空时新建一条空白条目，否则逐条复制（标题加「副本」）。返回新条目的 key。
export function addEntries(name, sources = []) {
    return queued(name, async () => {
        const data = clone(await loadBook(name));
        const list = sources.length ? sources.map(key => data.entries[key]).filter(Boolean) : [BLANK_ENTRY];
        const keys = [];
        for (const entry of list) {
            const uid = nextUid(data);
            data.entries[uid] = { ...clone(entry), uid, displayIndex: uid, ...(sources.length ? { comment: `${entry.comment || ''}（副本）` } : {}) };
            keys.push(String(uid));
        }
        await saveBook(name, data);
        return keys;
    });
}

export async function createBook(name, data = { entries: {} }) {
    const value = String(name || '').trim();
    if (!value) throw new Error('请填写世界书名称');
    if (allBookNames().includes(value)) throw new Error(`已有名为「${value}」的世界书`);
    await saveBook(value, data);
    const c = ctx();
    if (c && typeof c.updateWorldInfoList === 'function') await c.updateWorldInfoList();
    return value;
}

// 把绑定从旧名字换到新名字：聊天世界书、当前角色的主/附加世界书、全局启用列表。返回没能改过去的位置。
async function rebind(from, to) {
    const c = ctx();
    const h = helper();
    const failed = [];
    const meta = c && c.chatMetadata;
    if (meta && meta.world_info === from) {
        if (to) meta.world_info = to;
        else delete meta.world_info;
        if (typeof c.saveMetadata === 'function') await c.saveMetadata();
    }
    try {
        const bound = h && typeof h.getCharWorldbookNames === 'function' ? h.getCharWorldbookNames('current') : null;
        const additional = bound && Array.isArray(bound.additional) ? bound.additional : [];
        if (bound && (bound.primary === from || additional.includes(from))) {
            if (typeof h.rebindCharWorldbooks !== 'function') throw new Error('no rebind');
            await h.rebindCharWorldbooks('current', {
                primary: bound.primary === from ? to || null : bound.primary,
                additional: additional.map(item => (item === from ? to : item)).filter(Boolean),
            });
        }
    } catch {
        failed.push('角色卡');
    }
    try {
        const global = h && typeof h.getGlobalWorldbookNames === 'function' ? h.getGlobalWorldbookNames() : null;
        if (Array.isArray(global) && global.includes(from) && typeof h.rebindGlobalWorldbooks === 'function') {
            await h.rebindGlobalWorldbooks(global.map(item => (item === from ? to : item)).filter(Boolean));
        }
    } catch {
        failed.push('全局');
    }
    return failed;
}

// 改名 = 另存为新名字 + 改绑定 + 删除旧书。绑定没改成功时保留旧书，避免角色卡指向不存在的世界书。
export async function renameBook(from, to) {
    const name = String(to || '').trim();
    if (!name || name === from) throw new Error('请填写新的名称');
    const data = await queued(from, () => loadBook(from));
    await createBook(name, clone(data));
    const failed = await rebind(from, name);
    if (!failed.length) await deleteBook(from);
    return { name, failed };
}

export async function duplicateBook(from, to) {
    return createBook(to, clone(await queued(from, () => loadBook(from))));
}

// 删除整本并解除聊天、角色卡、全局里对它的绑定。
export async function removeBook(name) {
    const failed = await rebind(name, '');
    await deleteBook(name);
    return { failed };
}

// 回退方案 D：专用世界书，条目全部常驻；只在聊天未绑世界书时自动绑定。
export async function writeFallbackBook(name, wiEntries) {
    const c = ctx();
    const data = { entries: {} };
    wiEntries.forEach((entry, index) => {
        const { world, ...rest } = entry;
        data.entries[index] = { ...rest, uid: index, displayIndex: index };
    });
    await saveBook(name, data);
    if (typeof c.updateWorldInfoList === 'function') await c.updateWorldInfoList();
    const meta = c.chatMetadata;
    if (meta && !meta.world_info) {
        meta.world_info = name;
        if (typeof c.saveMetadata === 'function') await c.saveMetadata();
        return { bound: true };
    }
    return { bound: meta && meta.world_info === name, conflict: meta && meta.world_info && meta.world_info !== name ? meta.world_info : '' };
}
