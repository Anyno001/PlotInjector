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
        content: String(entry.content || ''),
        disabled: Boolean(entry.disable),
        constant: Boolean(entry.constant),
    }));
}

async function saveBook(name, data) {
    const c = ctx();
    if (!c || typeof c.saveWorldInfo !== 'function') throw new Error('当前酒馆不支持保存世界书');
    await c.saveWorldInfo(name, data, true);
    if (typeof c.reloadWorldInfoEditor === 'function') c.reloadWorldInfoEditor(name);
}

const clone = value => hostWindow().structuredClone ? hostWindow().structuredClone(value) : JSON.parse(JSON.stringify(value));

export async function setEntriesDisabled(name, keys, disabled) {
    const data = clone(await loadBook(name));
    for (const key of keys) if (data.entries[key]) data.entries[key].disable = disabled;
    await saveBook(name, data);
}

// 删除前返回被删条目组成的世界书 json，供调用方下载备份。
export async function deleteEntries(name, keys) {
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
