import { hostDocument } from '../host/st.js';
import { CSS } from './styles.js';

const STYLE_ID = 'pi-style';

export function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

export function ensureStyle() {
    const doc = hostDocument();
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style');
    style.id = STYLE_ID;
    style.textContent = CSS;
    doc.head.appendChild(style);
}

export function removeStyle() {
    hostDocument().getElementById(STYLE_ID)?.remove();
}

let night = false;

// 夜间配色挂在每个 .pi-root 上：主面板、对话框、提示卡各自是独立的根节点。
export function setNight(value) {
    night = Boolean(value);
    for (const node of hostDocument().querySelectorAll('.pi-root')) node.classList.toggle('is-night', night);
}

export const isNight = () => night;

export function el(html) {
    const box = hostDocument().createElement('div');
    box.innerHTML = html.trim();
    const node = box.firstElementChild;
    if (node && node.classList.contains('pi-root')) node.classList.toggle('is-night', night);
    return node;
}

export function options(list, value) {
    return list.map(item => `<option value="${esc(item.value)}"${String(item.value) === String(value) ? ' selected' : ''}>${esc(item.label)}</option>`).join('');
}

// 自绘对话框：叠在主面板之上。actions 的 value 原样返回；正文里带 data-dlg-value 的按钮直接以该值关闭；点遮罩或 Esc 返回 null。
export function openDialog({ title, html = '', actions = [{ label: '确定', value: true, primary: true }], onMount } = {}) {
    const doc = hostDocument();
    return new Promise(resolve => {
        const root = el(`<div class="pi-root pi-dialog"><div class="pi-dialog-box" role="dialog">
            ${title ? `<h4>${esc(title)}</h4>` : ''}<div class="pi-dlg-body">${html}</div>
            <div class="pi-dlg-acts">${actions.map((action, index) => `<button type="button" class="pi-btn${action.primary ? ' is-primary' : ''}${action.danger ? ' is-danger' : ''}" data-dlg="${index}">${esc(action.label)}</button>`).join('')}</div>
        </div></div>`);
        const finish = value => {
            doc.removeEventListener('keydown', onKey, true);
            root.remove();
            resolve(value);
        };
        const onKey = event => {
            if (event.key === 'Escape') { event.stopPropagation(); finish(null); }
        };
        root.addEventListener('click', event => {
            if (event.target === root) return finish(null);
            const pick = event.target.closest('[data-dlg-value]');
            if (pick) return finish(pick.dataset.dlgValue);
            const button = event.target.closest('[data-dlg]');
            if (!button) return;
            const action = actions[Number(button.dataset.dlg)];
            const value = typeof action.value === 'function' ? action.value(root) : action.value;
            if (value !== undefined) finish(value);
        });
        doc.addEventListener('keydown', onKey, true);
        doc.body.appendChild(root);
        if (onMount) onMount(root);
        root.querySelector('input,textarea,select')?.focus();
    });
}

export function confirmDialog({ title, body = '', list = [], okLabel = '确定', danger = false }) {
    const html = `${body ? `<p class="pi-hint">${esc(body)}</p>` : ''}${list.length ? `<ul>${list.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}`;
    return openDialog({ title, html, actions: [{ label: '取消', value: false }, { label: okLabel, value: true, primary: !danger, danger }] }).then(Boolean);
}

export function promptDialog({ title, label = '', value = '', multiline = false, placeholder = '' }) {
    const input = multiline
        ? `<textarea class="pi-ta is-mono is-tall" data-dlg-input placeholder="${esc(placeholder)}">${esc(value)}</textarea>`
        : `<input class="pi-inp" data-dlg-input value="${esc(value)}" placeholder="${esc(placeholder)}">`;
    return openDialog({
        title,
        html: `<label class="pi-field">${label ? `<span>${esc(label)}</span>` : ''}${input}</label>`,
        actions: [{ label: '取消', value: null }, { label: '确定', primary: true, value: root => root.querySelector('[data-dlg-input]').value }],
    });
}

// 竖排选项菜单：点一项即返回它的 value，点外面或「取消」返回 null。danger 项用红字。
export function menuDialog({ title, items }) {
    const html = `<div class="pi-menu-list">${items.map(item => `<button type="button" class="pi-menu-item${item.danger ? ' is-danger' : ''}" data-dlg-value="${esc(item.value)}">${item.icon || ''}<span>${esc(item.label)}</span></button>`).join('')}</div>`;
    return openDialog({ title, html, actions: [{ label: '取消', value: null }] });
}

export function choiceDialog({ title, body = '', choices }) {
    return openDialog({ title, html: body ? `<p class="pi-hint">${esc(body)}</p>` : '', actions: choices });
}

export function pickFiles({ accept = '', multiple = false } = {}) {
    const doc = hostDocument();
    return new Promise(resolve => {
        const input = doc.createElement('input');
        input.type = 'file';
        input.accept = accept;
        input.multiple = multiple;
        input.hidden = true;
        input.addEventListener('change', () => { resolve([...input.files]); input.remove(); });
        input.addEventListener('cancel', () => { resolve([]); input.remove(); });
        doc.body.appendChild(input);
        input.click();
    });
}
