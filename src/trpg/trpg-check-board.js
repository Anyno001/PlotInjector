// 执行页「判定」卡的纯计算（用户 2026-11-24：判定在后台是通的，界面上看不见）。界面在 trpg-check-card.js。
// 全部从聊天记录机械地算（trpgCheckResults），不发 AI 请求；「已确认」沿用 KP 每轮检测的结果（effectiveFact）。
// 不剧透：没成功的判定不给线索标签；暗骰不给骰点；界面不出现线索编号、节点编号。
import { discoveryList } from './trpg-clue-project.js';
import { effectiveFact } from './trpg-clue-rules.js';
import { GOT_ANYWAY } from './trpg.js';
import { kpFactLabel } from './trpg-kp-check.js';
import { isPlainObject } from '../core/outline.js';

const OPEN = ['available', 'active', 'done'];

// 「侦查（困难）」；多技能写「侦查/聆听」
export function checkWhat(skill, level) {
    return `${skill}${level && level !== '普通' ? `（${level}）` : ''}`;
}

function rollText(r, hidden) {
    if (hidden) return '已掷';
    return r.die != null ? `1D100=${r.die}${r.value ? `/${r.value}` : ''}` : r.tier;
}

// 提醒：节点开放后连着这么多个 AI 楼没出检定；判定成了之后连着这么多个 AI 楼线索没确认
export const NUDGE_FLOORS = 2;

// 从第 from 楼起（算不算 from 本身看 inclusive）有几个 AI 楼
export function aiFloorsSince(messages, from, inclusive) {
    let n = 0;
    for (let i = Math.max(0, from) + (inclusive ? 0 : 1); i < (messages || []).length; i += 1) {
        let m = messages[i];
        m && !m.is_user && !m.is_system && (n += 1);
    }
    return n;
}

// 这个节点第一次作为本轮场景注入的楼层（带判定的发现就是那一轮写成「待判定」的）；没有记录返回 -1。
// 候选记录只留最近 40 条，所以只会偏晚、不会偏早，提醒偏保守。
export function nodeOpenFloor(prog, uid, messages) {
    let at = -1;
    for (let x of (prog && Array.isArray(prog.clueCandidates) ? prog.clueCandidates : [])) {
        let m = (messages || [])[x.i];
        if (!uid || !m || m.is_user || !(x.scenes || []).some((s) => s.uid === uid && s.focus)) continue;
        (at < 0 || x.i < at) && (at = x.i);
    }
    return at;
}

// 一行的状态：wait 等正文出检定 / roll 等你掷骰 / ok 成功 / fail 失败
// clue：线索进度 confirmed 已确认 / offered 已交给正文 / pending 还没确认 / ''（还轮不到）
export function trpgCheckBoard({ state, snap, prog, checks, labels = {}, messages = null, raw = null }) {
    let rows = [],
        requests = (checks && checks.requests) || [],
        // clueOffered、clueCandidates 在原始进度里（不在 c.prog 里）
        stored = raw || prog,
        offered = new Set(Array.isArray(stored && stored.clueOffered) ? stored.clueOffered : []),
        known = new Set();
    for (let ns of state.nodeStates || []) {
        let item = isPlainObject(ns.node.item) ? ns.node.item : {};
        for (let d of discoveryList(item)) {
            if (!d.check || !d.fact) continue;
            known.add(d.fact);
            let r = checks ? checks[d.fact] : null,
                kp = checks ? checks[`${d.fact}-KP`] : null,
                asked = requests.some((q) => q.code === d.fact),
                got = effectiveFact(d.fact, snap, prog).confirmed;
            // 节点还没开放、也没有任何检定痕迹的不列（列出来就是剧透）
            if (!OPEN.includes(ns.status) && !r && !asked && !got) continue;
            let status = r ? (r.ok ? 'ok' : 'fail') : asked ? 'roll' : got ? 'got' : 'wait',
                anyway = !!(d.check.fail && GOT_ANYWAY.test(d.check.fail)),
                rescued = !!(kp && kp.ok),
                reveal = status === 'ok' || (status === 'fail' && (anyway || rescued)),
                clue = got ? 'confirmed' : reveal ? (offered.has(d.fact) ? 'offered' : 'pending') : '',
                skill = r ? r.skill : d.check.skills.join('/'),
                level = r ? r.level : d.check.level;
            let nudge = '';
            if (messages) {
                let openAt = status === 'wait' ? nodeOpenFloor(stored, ns.node.uid, messages) : -1,
                    rolledAt = r ? Math.max(r.at, rescued ? kp.at : -1) : -1;
                if (status === 'wait' && openAt >= 0 && aiFloorsSince(messages, openAt, true) >= NUDGE_FLOORS) nudge = 'norequest';
                else if (reveal && clue !== 'confirmed' && rolledAt >= 0 && aiFloorsSince(messages, rolledAt, false) >= NUDGE_FLOORS) nudge = 'unconfirmed';
            }
            rows.push({
                skill,
                nudge,
                fact: d.fact,
                node: ns.node.name || '',
                what: checkWhat(skill, level),
                hidden: !!d.check.hidden,
                status,
                roll: r ? rollText(r, d.check.hidden) : '',
                anyway,
                kp: kp ? { ok: kp.ok, roll: rollText(kp, d.check.hidden) } : null,
                // 标签只在拿到线索之后给
                label: got || status === 'ok' || rescued ? kpFactLabel(labels, d.fact, d.text) : '',
                clue,
                done: got && status !== 'wait' && status !== 'roll',
            });
        }
    }
    return { rows, problems: checkProblems(checks, known) };
}

// 理智检定（编号 SAN）不对应发现；补救检定是「编号-KP」
export function isKnownCode(code, known) {
    return /^SAN$/i.test(code) || known.has(String(code).replace(/-KP$/, ''));
}

// 只提示用户最后一条消息里的问题，加上最新一条正文里对不上模组的检定编号
export function checkProblems(checks, known) {
    if (!checks) return [];
    let last = checks.lastUser ?? -1,
        out = (checks.problems || []).filter((p) => p.at === last),
        lastAi = Math.max(-1, ...(checks.requests || []).map((q) => q.at));
    known &&
        (checks.requests || [])
            .filter((q) => q.at === lastAi && !isKnownCode(q.code, known))
            .forEach((q) => out.push({ at: q.at, kind: 'badcode', skill: q.skill, code: q.code }));
    return out;
}

export function problemText(p) {
    switch (p.kind) {
        case 'unparsed':
            return '未能识别骰点，本次不计入判定。骰点可写作1D100=23。';
        case 'novalue':
            return `${p.skill || '该技能'}缺少技能值，无法判定成败。可写作23/60，或在IGS调查员档中补充。`;
        case 'badcode':
            return '正文中的检定编号与模组不符，无法对应到线索。';
        case 'dup':
            return `${p.skill || '该项'}此前已经掷过，结果以第一次为准。`;
        case 'noreq':
            return '这次掷骰前没有待进行的检定，骰点未计入判定。';
        default:
            return '';
    }
}

// 掷完弹的小卡：{ title, body, fail, canRescue }。hidden = 暗骰（不报骰点、不报成败）
export function rollNoticeText(r, { hidden = !1, rescue = !1, anyway = !1 } = {}) {
    let what = `${checkWhat(r.skill, r.level)}${rescue ? '补救检定' : '检定'}`;
    if (hidden) return { title: '暗骰已掷', body: `${what}为暗骰，结果将在正文中体现。`, fail: !1, canRescue: !1 };
    let roll = r.die != null ? `掷出${r.die}${r.value ? `（技能值${r.value}）` : ''}` : '',
        head = `${what}${roll}`;
    if (r.ok) return { title: '判定成功', body: `${head}，${r.tier && r.tier !== '成功' ? r.tier : '成功'}。相应线索将交由正文写出。`, fail: !1, canRescue: !1 };
    return {
        title: '判定失败',
        body: `${head}，${r.tier === '大失败' ? '大失败' : '失败'}。${anyway ? '按模组设定，失败后仍可获得这条线索。' : ''}`,
        fail: !0,
        canRescue: !rescue && !anyway,
    };
}
