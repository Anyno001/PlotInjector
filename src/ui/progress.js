// 进度条（用户 2026-11-23：AI 干活时要看得到走到哪一步、大概多少）。
// 界面会整块重画，所以不持有元素：每次刷新都按 key 找 [data-prog="key"]，重画后的新元素也能接上。
// 流式时按真实进度（条数、字数）走；收不到中途进度时按用时慢慢逼近这一步的上限，不会提前走满。
import { hostDocument, hostWindow } from '../host/st.js';
import { esc } from './dom.js';

const live = new Map();

export function progressHtml(key) {
    let s = live.get(key),
        pct = s ? Math.round(s.pct) : 0,
        text = s ? s.text : '';
    return `<div class="pi-prog" data-prog="${esc(key)}"${s ? '' : ' hidden'}><div class="pi-prog-bar"><i style="width:${pct}%"></i></div><p class="pi-prog-text">${esc(text)}</p></div>`;
}

function paint(key) {
    let s = live.get(key);
    if (!s) return;
    let now = Date.now(),
        // 逼近：from + (to-from)*(1-e^(-t/tau))；有真实进度时取二者较大
        t = now - s.stepAt,
        est = s.to > s.from ? s.from + (s.to - s.from) * (1 - Math.exp(-t / s.tau)) : s.from,
        pct = Math.min(100, Math.max(s.pct, est, s.real ?? 0));
    s.pct = pct;
    let sec = Math.round((now - s.t0) / 1000),
        text = `${s.label}${s.detail ? `　${s.detail}` : ''}${s.finished ? '' : `　${sec}秒`}`;
    s.text = text;
    for (let box of hostDocument().querySelectorAll(`[data-prog="${key}"]`)) {
        box.hidden = !1;
        let bar = box.querySelector('.pi-prog-bar > i'),
            p = box.querySelector('.pi-prog-text');
        bar && (bar.style.width = `${Math.round(pct)}%`);
        box.classList.toggle('is-done', !!s.finished);
        p && p.textContent !== text && (p.textContent = text);
    }
}

// 开始一个进度。返回 { step(label, to, tau), real(pct, detail), done(label), fail(label) }。
export function startProgress(key) {
    let w = hostWindow(),
        old = live.get(key);
    old && old.timer && w.clearInterval(old.timer);
    let s = { t0: Date.now(), stepAt: Date.now(), from: 0, to: 0, tau: 30000, pct: 0, real: null, label: '', detail: '', text: '', finished: !1 };
    live.set(key, s);
    s.timer = w.setInterval(() => paint(key), 500);
    let api = {
        // 进入下一步：进度从现在的位置开始，按用时逼近 to（0–100）
        step(label, to, tau = 30000) {
            Object.assign(s, { label, detail: '', from: s.pct, to, tau, stepAt: Date.now(), real: null });
            paint(key);
            return api;
        },
        // 真实进度（流式收到的条数等）：pct 是整体百分比
        real(pct, detail = '') {
            s.real = Math.min(s.to || 100, pct);
            s.detail = detail;
            paint(key);
            return api;
        },
        done(label) {
            w.clearInterval(s.timer);
            Object.assign(s, { label, detail: '', real: 100, pct: 100, finished: !0 });
            paint(key);
            return api;
        },
        // 失败：收起进度条（失败原因由调用方写在状态行里）
        fail() {
            w.clearInterval(s.timer);
            live.delete(key);
            for (let box of hostDocument().querySelectorAll(`[data-prog="${key}"]`)) box.hidden = !0;
        },
        clear() {
            api.fail();
        },
    };
    return api;
}

export function clearProgress(key) {
    let s = live.get(key);
    s && s.timer && hostWindow().clearInterval(s.timer);
    live.delete(key);
}
