// 跑团模式执行页的「KP」卡：卡住了吗（体检+推一把）、对照剧本、察觉卡关。逻辑在 core/trpg-kp.js。
import { confirmDialog, esc, menuDialog, promptDialog } from '../ui/dom.js';
import { ICONS } from '../ui/styles.js';
import { chatMessages, toast } from '../host/st.js';
import { chatFactSets } from './trpg-clue-project.js';
import { trpgCheckResults } from './trpg.js';
import { steerActions, timelineHintHtml, steerResultHtml, steerContext } from './trpg-steer.js';
import { readGameClock } from './trpg-timeline.js';
import { trpgHealth, kpPushTarget, aiFloorCount, KP_LEVELS, KP_STUCK_ROUNDS, kpSectionText, npcImportMessage, stuckMessages, parseStuckReply, pendingDiscoveries } from './trpg-kp.js';
import { ask, runTask } from '../ui/ai.js';
import { kpSummary, kpOffText, RECHECK_FLOORS, RECHECK_MAX, AUTO_VERIFY_STEPS } from './trpg-kp-check.js';
import { confirmRecheck } from './trpg-kp-verify-ui.js';
import { checkSection } from './trpg-check-card.js';

// 体检结果只留在内存里，换项目就丢
let shown = null;
// 交给 IGS 建 NPC 档：进行中 / 结果文字（只在内存，按项目记）
let npcImport = null;

function npcImportHtml(project) {
    if (typeof window === 'undefined' || typeof (window.IGS && window.IGS.stats && window.IGS.stats.importNpcCocText) !== 'function') return '';
    if (!kpSectionText(project.setting && project.setting.text, 'NPC与敌人数据')) return '';
    let mine = npcImport && npcImport.projectId === project.id ? npcImport : null;
    return `<div class="pi-tools"><button type="button" class="pi-btn is-sm" data-act="kp-npc-igs"${mine && mine.busy ? ' disabled' : ''} title="把剧本里的NPC和敌人数据交给IGS，建成调查员档">${mine && mine.busy ? '正在交给IGS…' : '交给IGS建立NPC档'}</button></div>${mine && mine.msg ? `<p class="pi-hint">${esc(mine.msg)}</p>` : ''}`;
}

const BADGE = { ok: ['is-ok', '顺利进行'], warn: ['is-warn', '小心探索'], loop: ['is-warn', '在打转'], bad: ['is-warn', '卡住了'] };
const AI_LEVEL = { 顺利进行: 'ok', 在打转: 'loop', 卡住了: 'bad' };

// 徽章：AI 读了正文就以 AI 为准；插件推演出「走不通」时始终显示卡住了
function shownLevel(mine) {
    if (mine.level === 'bad') return 'bad';
    return (mine.ai && AI_LEVEL[mine.ai.verdict]) || mine.level;
}

function kpState(view) {
    return (view.runtime.progress() || {}).trpgKp || {};
}

function saveKp(view, patch) {
    let prog = view.runtime.progress();
    view.runtime.setProgress({ ...prog, trpgKp: { ...(prog.trpgKp || {}), ...patch } }, 'trpg-kp');
}

// 上轮检测：一句话概览，点开看每条线索和条件的通过情况与理由
function lastCheckHtml(kp) {
    let log = Array.isArray(kp.log) ? kp.log : [],
        last = log[log.length - 1];
    if (!last) return '';
    let row = (ok, text, why) => `<p class="pi-hint"><span class="pi-badge ${ok ? 'is-ok' : 'is-warn'}">${ok ? '通过' : '没通过'}</span> ${esc(text)}${why ? `：${esc(why)}` : ''}</p>`,
        items = [...last.facts.map((x) => row(x.ok, x.label, x.why)), ...last.conds.map((x) => row(x.ok, x.text, x.why))];
    return `<details class="pi-fold"><summary><b>上轮检测</b><span>${esc(kpSummary(last))}</span></summary>${items.join('') || '<p class="pi-hint">这一轮没有要判断的线索和条件。</p>'}${
        last.off
            ? `<p class="pi-hint is-warn">${esc(kpOffText(last.offKind))}</p>${last.offReason ? `<details class="pi-fold"><summary>查看原因（可能剧透）</summary><p class="pi-hint">${esc(last.offReason)}</p></details>` : ''}`
            : ''
    }</details>`;
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
        busy = view.busy['kp-steer'] || view.busy['kp-health'] || view.busy['kp-verify'],
        thinking = !!view.busy['kp-health'],
        ai = mine && mine.ai,
        spoils = mine ? [...((ai && ai.spoil) || []), ...mine.spoil] : [],
        advice = ai && ai.advice,
        bind = project.clue.bindings.time;
    return `<div class="pi-card"><h3>KP<span class="pi-spacer"></span>
        <button type="button" class="pi-btn is-sm is-ghost" data-act="kp-health" title="推演凭已经拿到的线索，主线还能不能走通，并可以推一把；只给结论，展开才剧透">卡住了吗</button>
        ${busy ? '<span class="pi-spin"></span>' : `<button type="button" class="pi-icon-btn" data-act="kp-menu" title="更多" aria-label="更多">${ICONS.more}</button>`}</h3>
        ${checkSection(project, c)}${timelineHintHtml(project, readGameClock(c.snap.tables, bind && bind.路径))}${lastCheckHtml(kp)}${steerResultHtml(project)}
        ${
            mine
                ? `<p class="pi-hint">${thinking ? '<span class="pi-badge">判断中</span>' : `<span class="pi-badge ${BADGE[shownLevel(mine)][0]}">${BADGE[shownLevel(mine)][1]}</span>`} ${esc(
                      ai && ai.plain.length ? ai.plain.join('；') : thinking ? 'AI 正在读最近的正文…' : mine.aiError ? `AI 判断失败（${mine.aiError}），下面只是插件推演。` : ai ? 'AI 没有给出说明。' : '',
                  )}${
                      spoils.length && !thinking ? ` <button type="button" class="pi-btn is-sm is-ghost" data-act="kp-spoil">${mine.open ? '收起' : '展开（会剧透）'}</button>` : ''
                  }</p><p class="pi-hint">插件推演：${esc(mine.lines.join('；'))}</p>${mine.open && !thinking ? spoils.map((t) => `<p class="pi-hint">${esc(t)}</p>`).join('') : ''}${
                      leaks ? `<p class="pi-hint is-warn">最近一次请求里疑似提前写出了${leaks}处线索</p>` : ''
                  }${advice && advice !== '不用推' && !push ? `<p class="pi-hint">AI 建议：${esc(advice)}</p>` : ''}${
                      mine.fact && !push && !thinking
                          ? `<div class="pi-tools is-c3">${KP_LEVELS.map((x) => `<button type="button" class="pi-btn is-sm${advice === x.label ? ' is-primary' : ''}" data-act="kp-push" data-level="${x.level}">${esc(x.label)}</button>`).join('')}</div>`
                          : mine.fact || push ? '' : '<p class="pi-hint">眼下没有能推的线索。</p>'
                  }`
                : ''
        }
        ${push ? `<p class="pi-hint">下一轮：${esc(pushLabel)} <button type="button" class="pi-btn is-sm is-ghost" data-act="kp-cancel">取消</button></p>` : ''}
        ${
            stuck >= KP_STUCK_ROUNDS && !push
                ? `<p class="pi-hint is-warn">已经${stuck}轮没拿到新线索。</p>`
                : ''
        }${npcImportHtml(project)}</div>`;
}

export const kpActions = {
    ...steerActions,
    async 'kp-menu'(view) {
        let pick = await menuDialog({
            title: 'KP',
            items: [
                { label: '对照剧本', value: 'kp-steer' },
                { label: '重新检测最新一楼', value: 'kp-recheck' },
                { label: '重新核实阶段', value: 'kp-verify' },
                { label: '自动核实阶段…', value: 'kp-auto-verify' },
                { label: '清空KP记录', value: 'kp-clear', danger: !0 },
            ],
        });
        pick && kpActions[pick](view);
    },
    async 'kp-recheck'(view) {
        let r = await view.runtime.kp.run({ manual: !0 });
        r ? view.renderBody() : toast('info', '没有检测：最新一楼不是AI回复，或「跑团每轮自动检测」已关、数据库未就绪。');
    },
    // 重新核实阶段（用户 2026-11-24）：选楼层范围 → KP 读这几楼重判进行中阶段的线索和条件 → 列给用户勾选确认才写入
    async 'kp-verify'(view) {
        if (view.busy['kp-verify']) return;
        let pick = await menuDialog({
            title: '重新核实阶段：读最近几楼',
            items: [...RECHECK_FLOORS.map((n) => ({ label: `最近${n}楼`, value: String(n) })), { label: '自己填楼数', value: 'custom' }],
        });
        if (!pick) return;
        if (pick === 'custom') {
            let typed = await promptDialog({ title: '重新核实阶段', label: `读最近几楼（1–${RECHECK_MAX}）`, value: '15' });
            if (typed == null) return;
            pick = String(typed).trim();
        }
        let floors = Math.round(Number(pick));
        if (!(floors >= 1)) return toast('info', '楼数要填一个正整数。');
        floors = Math.min(floors, RECHECK_MAX);
        let r = await runTask(view, 'kp-verify', () => view.runtime.kp.recheck({ floors })).catch((e) => ({ error: `请求失败：${e.message}` }));
        if (!r) return;
        if (r.error) return toast('info', `没法核实：${r.error}。`);
        if (r.empty) return toast('info', '进行中的阶段没有待核实的线索和条件。');
        (await confirmRecheck(r, { kp: view.runtime.kp, compute: () => view.runtime.clue.compute() })) && view.renderBody();
    },
    // 每 N 层自动核实（用户 2026-11-24）：默认关，按聊天存；到点后台核实，有结果弹提示卡再确认
    async 'kp-auto-verify'(view) {
        let now = view.runtime.kp.autoVerifyEvery(),
            pick = await menuDialog({
                title: `自动核实阶段（现在：${now ? `每${now}层` : '关'}）`,
                items: [{ label: '关', value: '0' }, ...AUTO_VERIFY_STEPS.map((n) => ({ label: `每${n}层`, value: String(n) })), { label: '自己填层数', value: 'custom' }],
            });
        if (!pick) return;
        if (pick === 'custom') {
            let typed = await promptDialog({ title: '自动核实阶段', label: `每几层核实一次（1–${RECHECK_MAX}）`, value: String(now || 15) });
            if (typed == null) return;
            pick = String(typed).trim();
        }
        let every = Math.round(Number(pick));
        if (!(every >= 0)) return toast('info', '层数要填一个整数。');
        every = Math.min(every, RECHECK_MAX);
        view.runtime.kp.setAutoVerify(every);
        toast('success', every ? `已开启：每${every}层自动核实一次，有结果会弹提示。` : '已关闭自动核实。');
        view.renderBody();
    },
    async 'kp-clear'(view) {
        let ok = await confirmDialog({
            title: '清空KP记录',
            body: 'KP自动判定的线索会撤销，判过的一句话条件和检测记录会清掉，阶段按剩下的记录重新计算。你手动确认的线索不动；已写进数据库表格的内容不会改，删楼或重roll时表格会跟着退回。',
            okLabel: '清空',
            danger: !0,
        });
        if (!ok) return;
        let n = view.runtime.kp.clearKp();
        toast('success', `已清空，撤销了${n}条KP判定的线索。`);
        view.renderBody();
    },
    // 先出插件推演（立即），再让 AI 读最近正文判断是不是真卡住了
    async 'kp-health'(view) {
        if (view.busy['kp-health']) return;
        let c = view.runtime.clue.compute();
        if (!c) return;
        let project = view.project(),
            r = trpgHealth({ volumes: c.outline.volumes, state: c.state, snap: c.snap, prog: c.prog, checks: trpgCheckResults(chatMessages()), focus: c.state.focus }),
            target = kpPushTarget(c.state, c.snap, c.prog),
            mine = { ...r, fact: target ? target.fact : '', projectId: view.projectId, open: !1, ai: null, aiError: '' };
        shown = mine;
        let messages = stuckMessages({ ...steerContext(project, c), pending: pendingDiscoveries(c.state, c.snap, c.prog, r.deadFacts), health: r.lines });
        try {
            let reply = await runTask(view, 'kp-health', () => ask(view, 'outline', messages));
            if (reply == null || shown !== mine) return;
            mine.ai = parseStuckReply(reply);
            mine.ai.verdict || (mine.aiError = '没有认出结论');
        } catch (error) {
            shown === mine && (mine.aiError = (error && error.message) || String(error));
        }
        view.renderBody();
    },
    async 'kp-npc-igs'(view) {
        let project = view.project(),
            fn = window.IGS && window.IGS.stats && window.IGS.stats.importNpcCocText,
            text = kpSectionText(project.setting && project.setting.text, 'NPC与敌人数据');
        if (typeof fn !== 'function' || !text || (npcImport && npcImport.busy)) return;
        let mine = (npcImport = { projectId: view.projectId, busy: !0, msg: '' });
        view.renderBody();
        try {
            mine.msg = npcImportMessage(await fn(text));
        } catch (error) {
            mine.msg = npcImportMessage({ ok: !1, reason: (error && error.message) || String(error) });
        }
        mine.busy = !1;
        view.renderBody();
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
