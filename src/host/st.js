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
