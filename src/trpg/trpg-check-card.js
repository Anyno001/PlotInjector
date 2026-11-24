// 执行页「判定」卡（用户 2026-11-24）：哪些在等判定、骰点、成败、线索有没有交给正文。计算在 trpg-check-board.js。
import { esc } from '../ui/dom.js';
import { chatMessages } from '../host/st.js';
import { isPlainObject } from '../core/outline.js';
import { trpgCheckResults } from './trpg.js';
import { trpgCheckBoard, problemText } from './trpg-check-board.js';

const STATUS = {
    wait: ['', '等正文出检定'],
    roll: ['is-accent', '等你掷骰'],
    ok: ['is-ok', '成功'],
    fail: ['is-warn', '失败'],
    got: ['is-ok', '已拿到'],
};
const CLUE = { confirmed: '线索已确认', offered: '已交给正文', pending: '线索还没确认' };

function rowHtml(r) {
    let [cls, text] = STATUS[r.status],
        meta = [r.node, r.roll].filter(Boolean),
        tail = [];
    r.status === 'fail' && tail.push(r.kp ? `补救检定${r.kp.ok ? '成功' : '失败'}` : r.anyway ? '失败也能拿到线索' : '这次没拿到线索');
    r.clue && tail.push(CLUE[r.clue]);
    return `<div class="pi-ck-row"><span class="pi-badge ${cls}">${text}</span><span class="pi-ck-what">${esc(r.what)}${r.hidden ? '<span class="pi-meta">暗骰</span>' : ''}</span><span class="pi-meta pi-ck-meta">${esc(meta.join(' · '))}</span>${
        r.label || tail.length ? `<span class="pi-meta pi-ck-tail">${esc([r.label ? `「${r.label}」` : '', ...tail].filter(Boolean).join('，'))}</span>` : ''
    }</div>`;
}

// 放在 KP 卡里的一段（用户 2026-11-24：判定和 KP 融在一起）
export function checkSection(project, c) {
    let checks = trpgCheckResults(chatMessages()),
        labels = isPlainObject(project.clue.labels) ? project.clue.labels : {},
        board = trpgCheckBoard({ state: c.state, snap: c.snap, prog: c.prog, checks, labels });
    if (!board.rows.length && !board.problems.length) return '';
    let live = board.rows.filter((r) => !r.done),
        done = board.rows.filter((r) => r.done);
    return `<div class="pi-ck"><div class="pi-ck-hd">判定</div>
        ${board.problems.map((p) => `<p class="pi-hint is-warn">${esc(problemText(p))}</p>`).join('')}
        ${live.map(rowHtml).join('') || (board.rows.length ? '<p class="pi-hint">眼下没有等着的判定。</p>' : '')}
        ${done.length ? `<details class="pi-fold"><summary><b>已完成（${done.length}）</b></summary>${done.map(rowHtml).join('')}</details>` : ''}</div>`;
}
