import { hostDocument, hostWindow } from '../host/st.js';
import { el, esc } from './dom.js';

// 同 id 只留一张，新的替换旧的。
export function createNotices() {
    const doc = hostDocument(),
        view = hostWindow();
    let box = null;
    const timers = /* @__PURE__ */ new Map();
    function container() {
        return ((!box || !box.isConnected) && ((box = el('<div class="pi-root pi-notices"></div>')), doc.body.appendChild(box)), box);
    }
    function hide(id) {
        (view.clearTimeout(timers.get(id)), timers.delete(id), box?.querySelector(`[data-notice="${id}"]`)?.remove());
    }
    function show({ id, title, body = '', actions = [], timeout = 0 }) {
        hide(id);
        const card = el(`<div class="pi-notice" data-notice="${esc(id)}"><b>${esc(title)}</b>${body ? `<p>${esc(body)}</p>` : ''}
            <div class="pi-row">${actions.map((action, index) => `<button type="button" class="pi-btn is-sm${action.primary ? ' is-primary' : ''}" data-act="${index}">${esc(action.label)}</button>`).join('')}</div></div>`);
        (card.addEventListener('click', (event) => {
            const button = event.target.closest('[data-act]');
            if (button) {
                hide(id);
                try {
                    actions[Number(button.dataset.act)].run();
                } catch (error) {
                    console.error('[剧情注入器]', error);
                }
            }
        }),
            container().appendChild(card),
            timeout &&
                timers.set(
                    id,
                    view.setTimeout(() => hide(id), timeout),
                ));
    }
    let bar = null;
    function hideBar() {
        (bar?.remove(), (bar = null));
    }
    function topBar({ tag = '', text, action = '', run = null, confirm = true }) {
        hideBar();
        let top = doc.querySelector('#top-bar, #top-settings-holder'),
            offset = top ? Math.max(0, Math.round(top.getBoundingClientRect().bottom)) : 0;
        ((bar = el(
            `<div class="pi-root pi-topbar" role="status" style="top:calc(${offset}px + env(safe-area-inset-top, 0px))"><span class="pi-topbar-dot"></span><div class="pi-topbar-body"><span class="pi-topbar-text" title="${esc(text)}">${esc(text)}</span>${tag ? `<span class="pi-topbar-tag">${esc(tag)}</span>` : ''}</div><div class="pi-topbar-acts">${action ? `<button type="button" class="pi-btn is-sm pi-topbar-act">${esc(action)}</button>` : ''}<button type="button" class="pi-btn is-sm is-primary pi-topbar-ok">确认</button></div></div>`,
        )),
            doc.body.appendChild(bar));
        let armed = 0,
            btn = bar.querySelector('.pi-topbar-act'),
            y0 = null,
            self = bar;
        (bar.querySelector('.pi-topbar-ok').addEventListener('click', () => bar === self && hideBar()),
            btn &&
                btn.addEventListener('click', () => {
                    if (confirm && !armed) {
                        ((btn.textContent = '再点'),
                            btn.classList.add('is-armed'),
                            (armed = view.setTimeout(() => {
                                ((armed = 0), (btn.textContent = action), btn.classList.remove('is-armed'));
                            }, 3e3)));
                        return;
                    }
                    (view.clearTimeout(armed), hideBar());
                    try {
                        run && run();
                    } catch (error) {
                        console.error('[剧情注入器]', error);
                    }
                }),
            bar.addEventListener(
                'touchstart',
                (e) => {
                    y0 = e.touches[0].clientY;
                },
                { passive: !0 },
            ),
            bar.addEventListener(
                'touchmove',
                (e) => {
                    y0 !== null && y0 - e.touches[0].clientY > 24 && bar === self && hideBar();
                },
                { passive: !0 },
            ));
    }
    function destroy() {
        for (let timer of timers.values()) view.clearTimeout(timer);
        (timers.clear(), box?.remove(), (box = null), hideBar());
    }
    return { show, hide, destroy, topBar, hideBar };
}
