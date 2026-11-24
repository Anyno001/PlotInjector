// 执行页「判定」卡（用户 2026-11-24）：哪些在等判定、骰点、成败、线索有没有交给正文。计算在 trpg-check-board.js。
import { esc } from '../ui/dom.js';
import { ICONS } from '../ui/styles.js';
import { chatMessages } from '../host/st.js';
import { isPlainObject } from '../core/outline.js';
import { trpgCheckResults } from './trpg.js';
import { trpgCheckBoard, problemText } from './trpg-check-board.js';

const STATUS = {
    wait: ['', '待正文提出'],
    roll: ['is-accent', '待掷骰'],
    ok: ['is-ok', '成功'],
    fail: ['is-warn', '失败'],
    got: ['is-ok', '已获得'],
};
const CLUE = { confirmed: '线索已确认', offered: '线索已交由正文', pending: '线索待确认' };

// 行上的提醒（用户 2026-11-24）：每行最多一个文字按钮 + 一个「⋯」。编号只放在 data 里，不显示
function nudgeHtml(r) {
    if (r.nudge === 'norequest')
        return `<span class="pi-ck-nudge"><span class="pi-hint is-warn">正文已有两轮未提出这项检定</span><button type="button" class="pi-btn is-sm" data-act="kp-remind" data-skill="${esc(r.skill)}">下轮提醒检定</button></span>`;
    if (r.nudge === 'unconfirmed')
        return `<span class="pi-ck-nudge"><span class="pi-hint is-warn">${r.status === 'fail' && r.anyway ? '失败仍可获得线索，但尚未确认' : '判定已成功，线索尚未确认'}</span><button type="button" class="pi-btn is-sm" data-act="kp-verify">重新核实阶段</button><button type="button" class="pi-icon-btn" data-act="kp-fact-menu" data-fact="${esc(r.fact)}" title="更多" aria-label="更多">${ICONS.more}</button></span>`;
    return '';
}

function rowHtml(r) {
    let [cls, text] = STATUS[r.status],
        meta = [r.node, r.roll].filter(Boolean),
        tail = [];
    r.status === 'fail' && tail.push(r.kp ? `补救检定${r.kp.ok ? '成功' : '失败'}` : r.anyway ? '失败仍可获得线索' : '未获得线索');
    r.clue && tail.push(CLUE[r.clue]);
    return `<div class="pi-ck-row"><span class="pi-badge ${cls}">${text}</span><span class="pi-ck-what">${esc(r.what)}${r.hidden ? '<span class="pi-meta">暗骰</span>' : ''}</span><span class="pi-meta pi-ck-meta">${esc(meta.join(' · '))}</span>${
        r.label || tail.length ? `<span class="pi-meta pi-ck-tail">${esc([r.label ? `「${r.label}」` : '', ...tail].filter(Boolean).join('，'))}</span>` : ''
    }${nudgeHtml(r)}</div>`;
}

// 放在 KP 卡里的一段（用户 2026-11-24：判定和 KP 融在一起）
export function checkSection(project, c, raw) {
    let checks = trpgCheckResults(chatMessages()),
        labels = isPlainObject(project.clue.labels) ? project.clue.labels : {},
        board = trpgCheckBoard({ state: c.state, snap: c.snap, prog: c.prog, checks, labels, messages: chatMessages(), raw });
    if (!board.rows.length && !board.problems.length) return '';
    let live = board.rows.filter((r) => !r.done),
        done = board.rows.filter((r) => r.done);
    return `<div class="pi-ck"><div class="pi-ck-hd">判定</div>
        ${board.problems.map((p) => `<p class="pi-hint is-warn">${esc(problemText(p))}</p>`).join('')}
        ${live.map(rowHtml).join('') || (board.rows.length ? '<p class="pi-hint">目前没有待进行的判定。</p>' : '')}
        ${done.length ? `<details class="pi-fold"><summary><b>已完成（${done.length}）</b></summary>${done.map(rowHtml).join('')}</details>` : ''}</div>`;
}
