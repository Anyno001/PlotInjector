// 跑团模式的「KP」：体检、「我卡住了」推一把、察觉卡关。纯逻辑，不碰界面和宿主。
import { discoveryList, clueReachability, chatFactSets } from './clue-project.js';
import { effectiveFact, conditionRefs } from './clue-rules.js';
import { checkRule, GOT_ANYWAY } from './trpg.js';
import { isPlainObject } from './outline.js';

export const KP_LEVELS = [
    { level: 1, label: '给点暗示' },
    { level: 2, label: '再给一次检定' },
    { level: 3, label: '直接给线索' },
];
export const KP_STUCK_ROUNDS = 4;

export function aiFloorCount(messages) {
    return (messages || []).filter((m) => m && !m.is_user).length;
}

function itemOf(node) {
    return isPlainObject(node && node.item) ? node.item : {};
}
function textOf(v) {
    return Array.isArray(v) ? v.join('、') : v == null ? '' : String(v).trim();
}
const got = (fact, snap, prog) => effectiveFact(fact, snap, prog).confirmed;

// 判定失败、没有「仍然得到」、补救检定也没成功、事实也没拿到的发现
export function deadDiscoveries(state, snap, prog, checks) {
    let out = [];
    if (!checks) return out;
    for (let ns of state.nodeStates)
        for (let d of discoveryList(itemOf(ns.node))) {
            let r = d.check && d.fact ? checks[d.fact] : null,
                kp = d.fact ? checks[`${d.fact}-KP`] : null;
            if (!r || r.ok || (d.check.fail && GOT_ANYWAY.test(d.check.fail)) || (kp && kp.ok) || got(d.fact, snap, prog)) continue;
            out.push({ fact: d.fact, text: d.text, node: ns.node.name || ns.node.uid });
        }
    return out;
}

function stripFacts(value, dead) {
    if (Array.isArray(value)) return value.map((v) => stripFacts(v, dead));
    if (!isPlainObject(value)) return value;
    let out = {};
    for (let [k, v] of Object.entries(value))
        out[k] =
            k === '发现' && Array.isArray(v)
                ? v.filter((d) => !(isPlainObject(d) && dead.has(String(d.事实 || d.id || '').trim()))).map((d) => stripFacts(d, dead))
                : stripFacts(v, dead);
    return out;
}

export function trpgHealth({ volumes, state, snap, prog, checks }) {
    let { known, claimed } = chatFactSets({ snap, prog }),
        dead = deadDiscoveries(state, snap, prog, checks),
        deadSet = new Set(dead.map((d) => d.fact)),
        opts = { knownFacts: known, claimedFacts: claimed },
        reach = clueReachability(stripFacts(volumes || [], deadSet), opts),
        base = dead.length ? clueReachability(volumes || [], opts) : reach,
        lines = [],
        spoil = [];
    if (reach.verdict === 'ok') lines.push(dead.length ? `有${dead.length}条判定失败的线索，暂时不影响主线` : '主线走得通');
    else if (reach.verdict === 'blocked')
        lines.push(
            dead.length && base.verdict !== 'blocked'
                ? `有${dead.length}条判定失败的线索，主线因此卡住，可以用「我卡住了」补救`
                : '主线现在走不通，需要检查剧本或表格',
        );
    else lines.push('走不走得通要看表格或时间');
    let live = [...state.stageStates.values()].find((s) => s.entered.v === 'true' && !s.done);
    live && live.requiredLeft.length && lines.push(`当前阶段还差${live.requiredLeft.length}个必需节点`);
    let near = 0;
    for (let ns of state.nodeStates)
        if (ns.status === 'available' || ns.status === 'active')
            near += discoveryList(itemOf(ns.node)).filter((d) => d.fact && !deadSet.has(d.fact) && !got(d.fact, snap, prog)).length;
    near && lines.push(`眼前能拿到的线索${near}条`);
    for (let n of reach.stuckNodes) spoil.push(`${n.nodeName}（${n.stage}）：${n.why}`);
    for (let d of dead) spoil.push(`判定失败 #${d.fact}（${d.node}）：${d.text}`);
    return { level: reach.verdict === 'blocked' ? 'bad' : reach.verdict === 'unknown' || dead.length ? 'warn' : 'ok', lines, spoil };
}

// 选一条要推的发现；返回 { fact, discovery, node } 或 null
export function kpPushTarget(state, snap, prog) {
    let pending = (ns) =>
            discoveryList(itemOf(ns.node))
                .filter((d) => d.fact && !got(d.fact, snap, prog))
                .map((d) => ({ fact: d.fact, discovery: d, node: ns.node })),
        focus = state.nodeStates.find((ns) => ns.node.uid && ns.node.uid === state.focus.uid),
        mine = focus ? pending(focus) : [],
        live = [...state.stageStates.values()].find((s) => s.entered.v === 'true' && !s.done),
        wanted = /* @__PURE__ */ new Set();
    for (let n of live ? live.requiredLeft : []) for (let cond of [n.open, n.done]) conditionRefs(cond).facts.forEach((f) => wanted.add(f));
    let open = (ns) => ns.status === 'available' || ns.status === 'active',
        others = state.nodeStates.filter((ns) => ns !== focus && open(ns));
    return (
        mine.find((x) => wanted.has(x.fact)) ||
        mine[0] ||
        others.filter((ns) => ns.node.required).flatMap(pending)[0] ||
        others.flatMap(pending)[0] ||
        null
    );
}

// 追加给正文的文字；reveal 为真时调用方把 { fact, record } 登记为候选
export function kpPushLines(push, discovery, node, checks, settings) {
    let { fact, level } = push,
        item = itemOf(node),
        where = [textOf(item.地点), textOf(item.入口)].filter(Boolean);
    if (level === 1)
        return {
            reveal: !1,
            lines: [
                `- KP 暗示 #${fact}：这一轮让环境或在场人物给出一点指向这件事的自然暗示（声音、痕迹、有人主动提起）${where.length ? `，可以借用：${where.join('；')}` : ''}。绝不写出发现的内容，不替用户行动。`,
            ],
        };
    if (level === 3)
        return {
            reveal: !0,
            lines: [`- KP 给出线索 #${fact}：这一轮通过合理的事件（有人找上门、东西被送来、意外撞见）让用户得到它，写出：${discovery.text}`],
        };
    let r = checks && checks[`${fact}-KP`];
    if (r) {
        let how = `${r.skill}${r.die != null ? ` 1D100=${r.die}` : ''}${r.value ? `／${r.value}` : ''}，${r.tier}`;
        return r.ok
            ? { reveal: !0, lines: [`- 补救检定成功 #${fact}-KP（${how}）：这一轮写出这条发现：${discovery.text}`] }
            : { reveal: !1, lines: [`- 补救检定失败 #${fact}-KP（${how}）：不要写出这条发现，也不要暗示它是什么。`] };
    }
    let skills = [...new Set(['灵感', '幸运', ...((discovery.check && discovery.check.skills) || [])])];
    return {
        reveal: !1,
        lines: [
            `- KP 补救检定 #${fact}-KP：这一轮在正文末尾写检定请求，技能从${skills.join('、')}里挑最合适的一个，编号写 #${fact}-KP。掷骰成功之前不要写出发现内容。`,
            checkRule(settings),
        ],
    };
}

export function kpFind(state, fact) {
    for (let ns of state.nodeStates) {
        let d = discoveryList(itemOf(ns.node)).find((x) => x.fact === fact);
        if (d) return { discovery: d, node: ns.node };
    }
    return null;
}

// 钩子用：把推一把的文字并进投影。out = buildClueProjection 的返回；返回新的 out
export function kpInject(out, { state, snap, prog, checks, settings, push, floors }) {
    let lines = [],
        seen = /* @__PURE__ */ new Set(),
        add = (p) => {
            let hit = kpFind(state, p.fact);
            if (!hit || got(p.fact, snap, prog)) return;
            let r = kpPushLines(p, hit.discovery, hit.node, checks, settings);
            (lines.push(...r.lines), r.reveal && out.used.candidates.push({ fact: p.fact, record: hit.discovery.record }), seen.add(p.fact));
        };
    push && push.floor === floors && add(push);
    for (let [code, r] of Object.entries(checks || {}))
        if (r.fresh && /-KP$/.test(code) && !seen.has(code.slice(0, -3))) add({ fact: code.slice(0, -3), level: 2 });
    if (!lines.length) return out;
    let tag = String(settings.tagName || '剧情参考').trim() || '剧情参考',
        close = `</${tag}>`,
        body = ['KP 的安排（只管这一轮）：', ...lines].join('\n');
    if (!out.content) return { ...out, content: `<${tag}>\n${body}\n${close}` };
    let at = out.content.lastIndexOf(close);
    return at < 0 ? out : { ...out, content: `${out.content.slice(0, at)}${body}\n${out.content.slice(at)}` };
}
