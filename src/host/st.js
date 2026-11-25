// 脚本跑在酒馆助手的 iframe 里；酒馆本体、事件、DOM 都在父窗口。
export function hostWindow() {
    try {
        if (window.parent && window.parent !== window && window.parent.document) return window.parent;
    } catch { /* 跨域父窗口不可用 */ }
    return window;
}

export function hostDocument() {
    return hostWindow().document;
}

export function ctx() {
    const st = hostWindow().SillyTavern;
    if (st && typeof st.getContext === 'function') return st.getContext();
    return st || null;
}

export function libs() {
    const st = hostWindow().SillyTavern;
    return (st && st.libs) || {};
}

export function helper() {
    const w = hostWindow();
    if (typeof TavernHelper !== 'undefined') return TavernHelper;
    return w.TavernHelper || null;
}

export function requestHeaders() {
    const c = ctx();
    if (!c || typeof c.getRequestHeaders !== 'function') throw new Error('酒馆连接尚未就绪');
    return c.getRequestHeaders();
}

export function toast(kind, message, title = '剧情注入器') {
    const t = hostWindow().toastr;
    if (t && typeof t[kind] === 'function') t[kind](message, title);
    else console.info(`[剧情注入器] ${message}`);
}

// 一张卡一个当前项目：单聊用角色头像文件名，群聊用群 id。
export function cardKey() {
    const c = ctx();
    if (!c) return '';
    if (c.groupId) return `group:${c.groupId}`;
    const card = c.characterId != null && Array.isArray(c.characters) ? c.characters[c.characterId] : null;
    return card && card.avatar ? `char:${card.avatar}` : '';
}

// 当前单聊的角色卡对象（群聊、没开卡时为 null）。
export function currentCard() {
    const c = ctx();
    if (!c || c.groupId || c.characterId == null || !Array.isArray(c.characters)) return null;
    return c.characters[c.characterId] || null;
}

// 往当前角色卡的 data.extensions 写一项（酒馆的 writeExtensionField：只合并这一个键，并存回卡文件）。
export async function writeCardExtension(key, value) {
    const c = ctx();
    if (!c || typeof c.writeExtensionField !== 'function') throw new Error('当前酒馆版本不支持往角色卡写数据');
    if (!currentCard()) throw new Error('请先打开一张角色卡（群聊不支持）');
    await c.writeExtensionField(c.characterId, key, value);
}

export function cardName() {
    const c = ctx();
    if (!c) return '';
    if (c.groupId && Array.isArray(c.groups)) {
        const group = c.groups.find(item => item.id === c.groupId);
        return group ? group.name : '群聊';
    }
    const card = c.characterId != null && Array.isArray(c.characters) ? c.characters[c.characterId] : null;
    return card ? card.name : '';
}

export function chatMessages() {
    const c = ctx();
    return c && Array.isArray(c.chat) ? c.chat : [];
}

export function chatId() {
    const c = ctx();
    return c && typeof c.getCurrentChatId === 'function' ? c.getCurrentChatId() || '' : '';
}

export async function countTokens(text) {
    const c = ctx();
    try {
        if (c && typeof c.getTokenCountAsync === 'function') return await c.getTokenCountAsync(String(text || ''));
    } catch { /* 退回粗估 */ }
    return null;
}

export function downloadBlob(name, data, type = 'application/json') {
    const doc = hostDocument();
    const view = hostWindow();
    const url = view.URL.createObjectURL(new view.Blob([data], { type }));
    const anchor = doc.createElement('a');
    anchor.href = url;
    anchor.download = name;
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    view.setTimeout(() => view.URL.revokeObjectURL(url), 2000);
}

// 从服务器读回当前聊天文件的 chat_metadata（saveMetadata 出错、超时都不报，只有读回才能确认存下来了）。
// 单聊 /api/chats/get，群聊 /api/chats/group/get；读不到返回 null。
export async function savedChatMetadata() {
    try {
        const c = ctx(),
            id = chatId();
        if (!c || !id) return null;
        let body;
        if (c.groupId) body = { id };
        else {
            const card = c.characterId != null && Array.isArray(c.characters) ? c.characters[c.characterId] : null;
            if (!card || !card.avatar) return null;
            body = { ch_name: card.name, file_name: String(id).replace(/\.jsonl$/, ''), avatar_url: card.avatar };
        }
        const res = await hostWindow().fetch(c.groupId ? '/api/chats/group/get' : '/api/chats/get', {
            method: 'POST',
            headers: requestHeaders(),
            body: JSON.stringify(body),
        });
        if (!res.ok) return null;
        const data = await res.json();
        return Array.isArray(data) && data[0] && data[0].chat_metadata && typeof data[0].chat_metadata === 'object' ? data[0].chat_metadata : null;
    } catch {
        return null;
    }
}
