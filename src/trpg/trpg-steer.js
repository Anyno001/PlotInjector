// 跑团 KP 卡里的「场景没定」提醒和「对照剧本」检查。逻辑在 core/trpg-kp.js、core/trpg-timeline.js。
import { esc } from '../ui/dom.js';
import { chatMessages, toast } from '../host/st.js';
import { effectiveFact } from './trpg-clue-rules.js';
import { chatFactSets } from './trpg-clue-project.js';
import { splitBlocks } from '../core/setting.js';
import { stringifyYaml } from '../core/yaml.js';
import { KP_BLOCK } from './trpg.js';
import { KP_UNSET_SOURCES, KP_UNSET_HINT, steerMessages, parseSteerReply, aiFloorCount } from './trpg-kp.js';
import { parseTimeline } from './trpg-timeline.js';
import { ask, runTask } from '../ui/ai.js';

// 检查结果只留在内存里，换项目就丢
let result = null;

const VERDICT_BADGE = { 跟着剧本: 'is-ok', 有点偏: 'is-warn', 跑偏了: 'is-warn' };

function nodeName(ns) {
    return ns.node.name || ns.node.uid;
}

// 场景没定时的提醒 + 手动设场景
export function sceneHintHtml(c) {
    if (!c || !KP_UNSET_SOURCES.includes(c.state.focus.source)) return '';
    let nodes = c.state.nodeStates.filter((ns) => (ns.status === 'available' || ns.status === 'active') && !ns.disabled && ns.node.uid);
    return `<p class="pi-hint is-warn">${KP_UNSET_HINT}</p>${
        nodes.length
            ? `<div class="pi-row"><select class="pi-sel pi-grow" data-kp-scene>${nodes.map((ns) => `<option value="${esc(ns.node.uid)}">${esc(nodeName(ns))}</option>`).join('')}</select><button type="button" class="pi-btn is-sm" data-act="kp-scene">设为本轮场景</button></div>`
            : ''
    }`;
}

// 有时间线但没读到游戏内时间
export function timelineHintHtml(project, now) {
    return now == null && parseTimeline(project.setting && project.setting.text).length
        ? '<p class="pi-hint">没有读到游戏内时间，时间线不会自动推进。</p>'
        : '';
}

export function steerResultHtml(project) {
    let r = result && result.projectId === project.id ? result : null;
    if (!r) return '';
    return `<p class="pi-hint">${r.verdict ? `<span class="pi-badge ${VERDICT_BADGE[r.verdict]}">${esc(r.verdict)}</span>` : '没有认出结论，可以再检查一次。'} ${esc(r.plain.join('；'))}${
        r.spoil.length ? ` <button type="button" class="pi-btn is-sm is-ghost" data-act="kp-steer-spoil">${r.open ? '收起' : '展开（会剧透）'}</button>` : ''
    }</p>${r.open ? r.spoil.map((t) => `<p class="pi-hint">${esc(t)}</p>`).join('') : ''}${
        r.steer ? `<p class="pi-hint"><button type="button" class="pi-btn is-sm" data-act="kp-steer-apply">按建议拉回</button></p>` : ''
    }`;
}

// 多条线同时进行时，优先用本轮场景所在的阶段
function liveStage(c) {
    let focus = c.state.nodeStates.find((s) => s.node.uid && s.node.uid === c.state.focus.uid),
        own = focus && c.state.stageStates.get(focus.node.unit.id);
    return own || [...c.state.stageStates.values()].find((s) => s.entered.v === 'true' && !s.done);
}

function buildRequest(view, project, c) {
    return steerMessages(steerContext(project, c));
}

// 最近正文、当前阶段（作者视角）、KP规则、已确认事实：对照剧本和「卡住了吗」共用
export function steerContext(project, c) {
    let recent = chatMessages()
            .filter((m) => m && !m.is_system && String(m.mes || '').trim())
            .slice(-6)
            .map((m) => ({ user: !!m.is_user, text: m.mes })),
        live = liveStage(c),
        stage = live && live.unit.stage ? stringifyYaml({ [live.unit.stage.key || live.unit.id]: live.unit.stage.data }) : '',
        block = splitBlocks(project.setting && project.setting.text).find((b) => b.title === KP_BLOCK && !b.cont),
        facts = chatFactSets({ snap: c.snap, prog: c.prog }).known.map((id) => {
            let text = effectiveFact(id, c.snap, c.prog).text;
            return `${id}${text ? `：${Array.isArray(text) ? text.join('、') : text}` : ''}`;
        });
    return { recent, stage, rules: block ? block.text : '', facts };
}

export const steerActions = {
    'kp-scene'(view, target) {
        let sel = target.parentElement && target.parentElement.querySelector('[data-kp-scene]');
        if (!sel || !sel.value) return;
        try {
            view.runtime.clue.setFocus(sel.value);
        } catch (error) {
            toast('error', (error && error.message) || String(error));
        }
        view.renderBody();
    },
    'kp-steer-spoil'(view) {
        (result && (result.open = !result.open), view.renderBody());
    },
    async 'kp-steer'(view) {
        let c = view.runtime.clue.compute();
        if (!c) return;
        let project = view.project(),
            messages = buildRequest(view, project, c);
        try {
            let reply = await runTask(view, 'kp-steer', () => ask(view, 'outline', messages));
            if (reply == null) return;
            result = { ...parseSteerReply(reply), projectId: view.projectId, open: !1 };
        } catch (error) {
            toast('error', `对照剧本失败：${(error && error.message) || error}`);
        }
        view.renderBody();
    },
    // 这里不直接写进度：由 kpCard 的 saveKp 统一保存，见 trpg-kp-card.js
    'kp-steer-apply'(view) {
        if (!result || !result.steer) return;
        let prog = view.runtime.progress();
        view.runtime.setProgress(
            { ...prog, trpgKp: { ...(prog.trpgKp || {}), push: { kind: 'steer', text: result.steer, floor: aiFloorCount(chatMessages()) } } },
            'trpg-kp',
        );
        (toast('success', '下一轮会按建议拉回。'), view.renderBody());
    },
};
