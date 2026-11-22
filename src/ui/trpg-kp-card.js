// 跑团模式执行页的「KP」卡：体检、我卡住了、察觉卡关。逻辑在 core/trpg-kp.js。
import { esc, menuDialog } from './dom.js';
import { chatMessages, toast } from '../host/st.js';
import { chatFactSets } from '../core/clue-project.js';
import { trpgCheckResults } from '../core/trpg.js';
import { trpgHealth, kpPushTarget, aiFloorCount, KP_LEVELS, KP_STUCK_ROUNDS } from '../core/trpg-kp.js';

// 体检结果只留在内存里，换项目就丢
let shown = null;

const BADGE = { ok: ['is-ok', '顺'], warn: ['is-warn', '要留意'], bad: ['is-warn', '卡住了'] };

function kpState(view) {
    return (view.runtime.progress() || {}).trpgKp || {};
}

function saveKp(view, patch) {
    let prog = view.runtime.progress();
    view.runtime.setProgress({ ...prog, trpgKp: { ...(prog.trpgKp || {}), ...patch } }, 'trpg-kp');
}

export function kpCard(view, project, c, d) {
    let floors = aiFloorCount(chatMessages()),
        kp = kpState(view),
        confirmed = chatFactSets({ snap: c.snap, prog: c.prog }).known.length;
    // 确认数变了（多了或少了）就重新计轮数；放到渲染之后再写，避免渲染中途触发重绘
    if (!kp.pulse || kp.pulse.facts !== confirmed)
        Promise.resolve().then(() => {
            let now = kpState(view).pulse;
            (!now || now.facts !== confirmed) && saveKp(view, { pulse: { facts: confirmed, floor: floors } });
        });
    let stuck = kp.pulse && kp.pulse.facts === confirmed ? floors - kp.pulse.floor : 0,
        push = kp.push && kp.push.floor === floors ? kp.push : null,
        mine = shown && shown.projectId === project.id ? shown : null,
        leaks = d && d.lastAudit ? (d.lastAudit.leaks || []).filter((l) => l.level === 'leak').length : 0,
        pushLabel = push ? (KP_LEVELS.find((x) => x.level === push.level) || {}).label : '';
    return `<div class="pi-card"><h3>KP<span class="pi-spacer"></span>
        <button type="button" class="pi-btn is-sm" data-act="kp-health">这局还顺吗</button>
        <button type="button" class="pi-btn is-sm" data-act="kp-stuck">我卡住了</button></h3>
        ${
            mine
                ? `<p class="pi-hint"><span class="pi-badge ${BADGE[mine.level][0]}">${BADGE[mine.level][1]}</span> ${esc(mine.lines.join('；'))}${
                      mine.spoil.length ? ` <button type="button" class="pi-btn is-sm is-ghost" data-act="kp-spoil">${mine.open ? '收起' : '展开（会剧透）'}</button>` : ''
                  }</p>${mine.open ? mine.spoil.map((t) => `<p class="pi-hint">${esc(t)}</p>`).join('') : ''}${
                      leaks ? `<p class="pi-hint is-warn">最近一次请求里疑似提前写出了${leaks}处线索</p>` : ''
                  }`
                : ''
        }
        ${push ? `<p class="pi-hint">下一轮：${esc(pushLabel)} <button type="button" class="pi-btn is-sm is-ghost" data-act="kp-cancel">取消</button></p>` : ''}
        ${
            stuck >= KP_STUCK_ROUNDS && !push
                ? `<p class="pi-hint is-warn">已经${stuck}轮没拿到新线索，要不要推一把？ <button type="button" class="pi-btn is-sm" data-act="kp-stuck">我卡住了</button></p>`
                : ''
        }</div>`;
}

export const kpActions = {
    'kp-health'(view) {
        let c = view.runtime.clue.compute();
        if (!c) return;
        let r = trpgHealth({ volumes: c.outline.volumes, state: c.state, snap: c.snap, prog: c.prog, checks: trpgCheckResults(chatMessages()) });
        ((shown = { ...r, projectId: view.projectId, open: !1 }), view.renderBody());
    },
    'kp-spoil'(view) {
        (shown && (shown.open = !shown.open), view.renderBody());
    },
    async 'kp-stuck'(view) {
        let c = view.runtime.clue.compute();
        if (!c) return;
        let target = kpPushTarget(c.state, c.snap, c.prog);
        if (!target) return toast('info', '眼下没有能推的线索。');
        let pick = await menuDialog({ title: '推一把', items: KP_LEVELS.map((x) => ({ label: x.label, value: String(x.level) })) });
        if (!pick) return;
        (saveKp(view, { push: { fact: target.fact, level: Number(pick), floor: aiFloorCount(chatMessages()) } }), view.renderBody());
    },
    'kp-cancel'(view) {
        (saveKp(view, { push: null }), view.renderBody());
    },
};
