// 跑团模式执行页的「KP」卡：卡住了吗（体检+推一把）、对照剧本、察觉卡关。逻辑在 core/trpg-kp.js。
import { esc, menuDialog } from './dom.js';
import { ICONS } from './styles.js';
import { chatMessages, toast } from '../host/st.js';
import { chatFactSets } from '../core/clue-project.js';
import { trpgCheckResults } from '../core/trpg.js';
import { steerActions, timelineHintHtml, steerResultHtml } from './trpg-steer.js';
import { readGameClock } from '../core/trpg-timeline.js';
import { trpgHealth, kpPushTarget, aiFloorCount, KP_LEVELS, KP_STUCK_ROUNDS } from '../core/trpg-kp.js';

// 体检结果只留在内存里，换项目就丢
let shown = null;

const BADGE = { ok: ['is-ok', '顺利进行'], warn: ['is-warn', '小心探索'], bad: ['is-warn', '卡住了'] };

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
        pushLabel = push ? (push.kind === 'steer' ? '按建议拉回' : (KP_LEVELS.find((x) => x.level === push.level) || {}).label) : '',
        busy = view.busy['kp-steer'],
        bind = project.clue.bindings.time;
    return `<div class="pi-card"><h3>KP<span class="pi-spacer"></span>
        <button type="button" class="pi-btn is-sm is-ghost" data-act="kp-health" title="推演凭已经拿到的线索，主线还能不能走通，并可以推一把；只给结论，展开才剧透">卡住了吗</button>
        ${busy ? '<span class="pi-spin"></span>' : `<button type="button" class="pi-icon-btn" data-act="kp-menu" title="更多" aria-label="更多">${ICONS.more}</button>`}</h3>
        ${timelineHintHtml(project, readGameClock(c.snap.tables, bind && bind.路径))}${steerResultHtml(project)}
        ${
            mine
                ? `<p class="pi-hint"><span class="pi-badge ${BADGE[mine.level][0]}">${BADGE[mine.level][1]}</span> ${esc(mine.lines.join('；'))}${
                      mine.spoil.length ? ` <button type="button" class="pi-btn is-sm is-ghost" data-act="kp-spoil">${mine.open ? '收起' : '展开（会剧透）'}</button>` : ''
                  }</p>${mine.open ? mine.spoil.map((t) => `<p class="pi-hint">${esc(t)}</p>`).join('') : ''}${
                      leaks ? `<p class="pi-hint is-warn">最近一次请求里疑似提前写出了${leaks}处线索</p>` : ''
                  }${
                      mine.fact && !push
                          ? `<div class="pi-tools is-c3">${KP_LEVELS.map((x) => `<button type="button" class="pi-btn is-sm" data-act="kp-push" data-level="${x.level}">${esc(x.label)}</button>`).join('')}</div>`
                          : mine.fact || push ? '' : '<p class="pi-hint">眼下没有能推的线索。</p>'
                  }`
                : ''
        }
        ${push ? `<p class="pi-hint">下一轮：${esc(pushLabel)} <button type="button" class="pi-btn is-sm is-ghost" data-act="kp-cancel">取消</button></p>` : ''}
        ${
            stuck >= KP_STUCK_ROUNDS && !push
                ? `<p class="pi-hint is-warn">已经${stuck}轮没拿到新线索。</p>`
                : ''
        }</div>`;
}

export const kpActions = {
    ...steerActions,
    async 'kp-menu'(view) {
        let pick = await menuDialog({ title: 'KP', items: [{ label: '对照剧本', value: 'kp-steer' }] });
        pick && kpActions[pick](view);
    },
    'kp-health'(view) {
        let c = view.runtime.clue.compute();
        if (!c) return;
        let r = trpgHealth({ volumes: c.outline.volumes, state: c.state, snap: c.snap, prog: c.prog, checks: trpgCheckResults(chatMessages()), focus: c.state.focus }),
            target = kpPushTarget(c.state, c.snap, c.prog);
        ((shown = { ...r, fact: target ? target.fact : '', projectId: view.projectId, open: !1 }), view.renderBody());
    },
    'kp-spoil'(view) {
        (shown && (shown.open = !shown.open), view.renderBody());
    },
    // 推的目标按点击时重新选（体检之后可能已经拿到了那条线索）
    'kp-push'(view, target) {
        let c = view.runtime.clue.compute();
        if (!c) return;
        let t = kpPushTarget(c.state, c.snap, c.prog);
        if (!t) return (toast('info', '眼下没有能推的线索。'), view.renderBody());
        (saveKp(view, { push: { fact: t.fact, level: Number(target.dataset.level), floor: aiFloorCount(chatMessages()) } }), view.renderBody());
    },
    'kp-cancel'(view) {
        (saveKp(view, { push: null }), view.renderBody());
    },
};
