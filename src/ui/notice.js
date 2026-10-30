import { hostDocument, hostWindow } from '../host/st.js';
import { el, esc } from './dom.js';

// 右下角小卡片（手机在顶部）：同 id 只留一张，新的替换旧的。
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
