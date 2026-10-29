import { hostDocument, hostWindow } from '../host/st.js';
import { el, esc } from './dom.js';

// 右下角小卡片：同 id 只留一张，新的替换旧的。
export function createNotices() {
    const doc = hostDocument();
    const view = hostWindow();
    let box = null;
    const timers = new Map();

    function container() {
        if (!box || !box.isConnected) {
            box = el('<div class="pi-root pi-notices"></div>');
            doc.body.appendChild(box);
        }
        return box;
    }

    function hide(id) {
        view.clearTimeout(timers.get(id));
        timers.delete(id);
        box?.querySelector(`[data-notice="${id}"]`)?.remove();
    }

    function show({ id, title, body = '', actions = [], timeout = 0 }) {
        hide(id);
        const card = el(`<div class="pi-notice" data-notice="${esc(id)}"><b>${esc(title)}</b>${body ? `<p>${esc(body)}</p>` : ''}
            <div class="pi-row">${actions.map((action, index) => `<button type="button" class="pi-btn is-sm${action.primary ? ' is-primary' : ''}" data-act="${index}">${esc(action.label)}</button>`).join('')}</div></div>`);
        card.addEventListener('click', event => {
            const button = event.target.closest('[data-act]');
            if (!button) return;
            hide(id);
            try { actions[Number(button.dataset.act)].run(); } catch (error) { console.error('[剧情注入器]', error); }
        });
        container().appendChild(card);
        if (timeout) timers.set(id, view.setTimeout(() => hide(id), timeout));
    }

    function destroy() {
        for (const timer of timers.values()) view.clearTimeout(timer);
        timers.clear();
        box?.remove();
        box = null;
    }

    return { show, hide, destroy };
}

// 只隐藏显示：从已渲染楼层的文本节点里删掉 <剧情推进/>，楼层原文不动。
const SIGNAL_TEXT = /\s*<\s*剧情推进\s*\/?\s*>\s*/g;

export function createSignalHider(enabled) {
    const doc = hostDocument();
    const view = hostWindow();
    let observer = null;
    let frame = 0;
    const dirty = new Set();

    function scrub(root) {
        const walker = doc.createTreeWalker(root, view.NodeFilter.SHOW_TEXT);
        const hits = [];
        while (walker.nextNode()) if (walker.currentNode.nodeValue.includes('剧情推进')) hits.push(walker.currentNode);
        for (const node of hits) node.nodeValue = node.nodeValue.replace(SIGNAL_TEXT, ' ').replace(/^ $/, '');
    }

    function flush() {
        frame = 0;
        for (const node of dirty) if (node.isConnected) scrub(node);
        dirty.clear();
    }

    function start() {
        const chat = doc.getElementById('chat');
        if (!chat || observer) return;
        chat.querySelectorAll('.mes_text').forEach(scrub);
        observer = new view.MutationObserver(records => {
            if (!enabled()) return;
            for (const record of records) {
                const target = record.target.nodeType === 1 ? record.target : record.target.parentElement;
                const text = target && target.closest ? target.closest('.mes_text') : null;
                if (text) dirty.add(text);
                else for (const added of record.addedNodes) if (added.nodeType === 1) added.querySelectorAll?.('.mes_text').forEach(item => dirty.add(item));
            }
            if (dirty.size && !frame) frame = view.requestAnimationFrame(flush);
        });
        observer.observe(chat, { childList: true, subtree: true, characterData: true });
    }

    function stop() {
        observer?.disconnect();
        observer = null;
        if (frame) view.cancelAnimationFrame(frame);
        frame = 0;
        dirty.clear();
    }

    return { start, stop, rescan: () => doc.querySelectorAll('#chat .mes_text').forEach(scrub) };
}
