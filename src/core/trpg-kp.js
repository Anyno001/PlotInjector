// 跑团模式的「KP」：体检、「我卡住了」推一把、察觉卡关。纯逻辑，不碰界面和宿主。
import { discoveryList, clueReachability, chatFactSets } from './clue-project.js';
import { effectiveFact, conditionRefs } from './clue-rules.js';
import { checkRule, GOT_ANYWAY } from './trpg.js';
import { isPlainObject } from './outline.js';
import { timelineStep } from './trpg-timeline.js';
import { splitBlocks } from './setting.js';
import { KP_BLOCK } from './trpg.js';

export const KP_LEVELS = [
    { level: 1, label: '给点暗示' },
    { level: 2, label: '再给一次检定' },
    { level: 3, label: '直接给线索' },
];
export const KP_STUCK_ROUNDS = 4;

// 每轮固定附在 KP 段末尾：跑团里「由用户选择，不要强行引导」改成 KP 的口径
export const KP_HOST_RULE = [
    'KP 主持口径：你是本模组的 KP，上面「由用户选择，不要强行引导」在跑团里按下面执行：',
    '- 玩家偏离模组时，通过在场 NPC、环境变化或时间线事件，把注意力自然引回当前场景或上面列出的入口；不替玩家行动，不强制。',
    '- 不要新增模组里没有的重要人物、地点、线索或事件。',
    '- 玩家坚持做别的事，就写合理的后果，不为他编新剧情。',
].join('\n');

// 场景没定下来的来源（正文只拿到入口）
export const KP_UNSET_SOURCES = ['none', 'away', 'stale', 'manualDone'];
export const KP_UNSET_HINT = '本轮场景还没确定，正文只拿到入口，容易自由发挥。';

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

export function trpgHealth({ volumes, state, snap, prog, checks, focus }) {
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
                ? `有${dead.length}条判定失败的线索，主线因此卡住，可以在下面推一把`
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
    focus && KP_UNSET_SOURCES.includes(focus.source) && lines.push(KP_UNSET_HINT);
    for (let n of reach.stuckNodes) spoil.push(`${n.nodeName}（${n.stage}）：${n.why}`);
    for (let d of dead) spoil.push(`判定失败 #${d.fact}（${d.node}）：${d.text}`);
    return { level: reach.verdict === 'blocked' ? 'bad' : reach.verdict === 'unknown' || dead.length ? 'warn' : 'ok', lines, spoil, deadFacts: deadSet };
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

function entryList(state) {
    return state.nodeStates
        .filter((ns) => ns.status === 'available' && !ns.disabled && ns.node.uid && textOf(itemOf(ns.node).入口))
        .map((ns) => textOf(itemOf(ns.node).入口));
}

// 钩子用：把 KP 的文字并进投影。out = buildClueProjection 的返回；返回新的 out
// 推一把、拉回、时间线到点、主持口径都从这里进；timeline = { events, now, clock, onClock }
export function kpInject(out, { state, snap, prog, checks, settings, push, floors, timeline }) {
    let lines = [],
        seen = /* @__PURE__ */ new Set(),
        add = (p) => {
            let hit = kpFind(state, p.fact);
            if (!hit || got(p.fact, snap, prog)) return;
            let r = kpPushLines(p, hit.discovery, hit.node, checks, settings);
            (lines.push(...r.lines), r.reveal && out.used.candidates.push({ fact: p.fact, record: hit.discovery.record }), seen.add(p.fact));
        };
    if (push && push.floor === floors) {
        if (push.kind === 'steer') textOf(push.text) && lines.push(`KP 拉回（只管这一轮）：${textOf(push.text)}`);
        else add(push);
    }
    for (let [code, r] of Object.entries(checks || {}))
        if (r.fresh && /-KP$/.test(code) && !seen.has(code.slice(0, -3))) add({ fact: code.slice(0, -3), level: 2 });
    if (timeline) {
        let step = timelineStep({ events: timeline.events || [], now: timeline.now, clock: timeline.clock, floors });
        (lines.push(...step.lines), step.next && timeline.onClock && timeline.onClock(step.next));
    }
    let entries = entryList(state),
        host = !!(out.content || entries.length);
    if (!lines.length && !host) return out;
    let tag = String(settings.tagName || '剧情参考').trim() || '剧情参考',
        close = `</${tag}>`,
        body = [...(lines.length ? ['KP 的安排（只管这一轮）：', ...lines] : []), ...(host ? [KP_HOST_RULE] : [])].join('\n');
    if (!out.content) {
        let list = entries.length ? `目前可以去做的事：\n${entries.map((t) => `- ${t}`).join('\n')}\n` : '';
        return { ...out, content: `<${tag}>\n${list}${body}\n${close}` };
    }
    let at = out.content.lastIndexOf(close);
    return at < 0 ? out : { ...out, content: `${out.content.slice(0, at)}${body}\n${out.content.slice(at)}` };
}

// ---------- 「卡住了吗」AI 判断 ----------
// 本地推演只看大纲图走不走得通；玩家在正文里是不是在原地打转，要 AI 读正文判断（用户 2026-11-23）。
export const STUCK_VERDICTS = ['顺利进行', '在打转', '卡住了'];
export const STUCK_ADVICE = ['不用推', ...KP_LEVELS.map((x) => x.label)];

// pending：眼前还没拿到的发现 [{ fact, node, text }]；health：本地推演的结论行
export function stuckMessages({ recent, stage, rules, facts, pending, health }) {
    return [
        {
            role: 'system',
            content: [
                '你是跑团模组的 KP 助手。读最近的正文，判断玩家（调查员）是不是卡住了：找不到下一步、在同一处反复打转、明显忘了或没注意到眼前的线索、一直在做和模组无关的事。只判断，不续写。',
                '只是在正常探索、刚换场景、刚拿到线索在消化，都算顺利。',
                '严格按下面格式输出，不要写别的：',
                '结论：顺利进行 / 在打转 / 卡住了（三选一）',
                '不剧透：',
                '- 用玩家能看的话说现在的状况（如：在同一个房间反复搜查、没有去问在场的人），不写线索内容、名字和真相',
                '剧透：',
                '- 玩家漏掉了哪条线索、本来该怎么拿到',
                '建议：不用推 / 给点暗示 / 再给一次检定 / 直接给线索（四选一）',
                '没卡住时「剧透」写「- 无」，建议写「不用推」。',
            ].join('\n'),
        },
        {
            role: 'user',
            content: [
                `【最近正文】\n${recent.map((m) => `${m.user ? '玩家' : '正文'}：${String(m.text || '').slice(0, 1500)}`).join('\n\n') || '（没有）'}`,
                `【当前阶段的模组内容（作者视角，含仅作者部分）】\n${stage || '（没有进行中的阶段）'}`,
                rules && `【KP规则】\n${rules}`,
                `【已确认的事实】\n${facts.length ? facts.map((f) => `- ${f}`).join('\n') : '（暂无）'}`,
                `【眼前还没拿到的线索】\n${pending.length ? pending.map((p) => `- #${p.fact}（${p.node}）：${p.text}`).join('\n') : '（没有）'}`,
                health && health.length ? `【插件推演】\n${health.map((t) => `- ${t}`).join('\n')}` : '',
            ]
                .filter(Boolean)
                .join('\n\n'),
        },
    ];
}

// 回复 → { verdict, plain[], spoil[], advice }；没认出时 verdict / advice 为 ''
export function parseStuckReply(text) {
    let out = { verdict: '', plain: [], spoil: [], advice: '' },
        sec = '',
        none = (t) => /^无[。.]?$/.test(t);
    for (let raw of String(text || '')
        .replace(/\r/g, '')
        .split('\n')) {
        let m = /^[\s#*>]*(结论|不剧透|剧透|建议)[*\s]*[:：]\s*\**\s*(.*)$/.exec(raw);
        if (m) {
            sec = m[1];
            let rest = m[2].trim();
            sec === '结论' && (out.verdict = STUCK_VERDICTS.find((v) => rest.includes(v)) || '');
            sec === '建议' && (out.advice = STUCK_ADVICE.find((v) => rest.includes(v)) || '');
            continue;
        }
        let item = /^\s*[-•]\s*(.+)$/.exec(raw);
        if (sec === '不剧透' && item) out.plain.push(item[1].trim());
        else if (sec === '剧透' && item) out.spoil.push(item[1].trim());
    }
    out.plain = out.plain.filter((t) => !none(t));
    out.spoil = out.spoil.filter((t) => !none(t));
    return out;
}

// 眼前（已开放/进行中节点）还没拿到、也没判定失败的发现
export function pendingDiscoveries(state, snap, prog, deadFacts = new Set()) {
    let out = [];
    for (let ns of state.nodeStates)
        if (ns.status === 'available' || ns.status === 'active')
            for (let d of discoveryList(itemOf(ns.node)))
                d.fact && !deadFacts.has(d.fact) && !got(d.fact, snap, prog) && out.push({ fact: d.fact, node: ns.node.name || ns.node.uid, text: d.text });
    return out;
}

// ---------- 「对照剧本」检查 ----------
export const STEER_VERDICTS = ['跟着剧本', '有点偏', '跑偏了'];

export function steerMessages({ recent, stage, rules, facts }) {
    return [
        {
            role: 'system',
            content: [
                '你是跑团模组的审稿人。对照模组内容，检查最近的正文有没有偏离剧本。只判断，不续写。',
                '重点看：编了模组里没有的人物、地点、线索或事件；跳过了当前该进行的场景；提前揭示了还没到时机的内容；该发生的事件（时间线）没有发生。',
                '严格按下面格式输出，不要写别的：',
                '结论：跟着剧本 / 有点偏 / 跑偏了（三选一）',
                '不剧透：',
                '- 只说偏在哪一类（如：编了模组外的人物、跳过了场景、提前揭示、该发生的事件没发生），不写名字和真相',
                '剧透：',
                '- 具体哪里编了、模组里本来该是什么',
                '拉回建议：',
                '一段给正文的 KP 指示：不含玩家不该知道的真相；可以写引回到哪个场景或入口、让哪个 NPC 出现。',
                '没偏的话「不剧透」「剧透」各写「- 无」，拉回建议写「无」。',
            ].join('\n'),
        },
        {
            role: 'user',
            content: [
                `【最近正文】\n${recent.map((m) => `${m.user ? '玩家' : '正文'}：${String(m.text || '').slice(0, 1500)}`).join('\n\n') || '（没有）'}`,
                `【当前阶段的模组内容（作者视角，含仅作者部分）】\n${stage || '（没有进行中的阶段）'}`,
                rules && `【KP规则】\n${rules}`,
                `【已确认的事实】\n${facts.length ? facts.map((f) => `- ${f}`).join('\n') : '（暂无）'}`,
            ]
                .filter(Boolean)
                .join('\n\n'),
        },
    ];
}

// 回复 → { verdict, plain[], spoil[], steer }；没认出结论时 verdict 为 ''
export function parseSteerReply(text) {
    let out = { verdict: '', plain: [], spoil: [], steer: '' },
        sec = '',
        steer = [],
        none = (t) => /^无[。.]?$/.test(t);
    for (let raw of String(text || '')
        .replace(/\r/g, '')
        .split('\n')) {
        let m = /^[\s#*>]*(结论|不剧透|剧透|拉回建议)[*\s]*[:：]\s*\**\s*(.*)$/.exec(raw);
        if (m) {
            sec = m[1];
            let rest = m[2].trim();
            if (sec === '结论') out.verdict = STEER_VERDICTS.find((v) => rest.includes(v)) || '';
            else if (sec === '拉回建议' && rest) steer.push(rest);
            continue;
        }
        let item = /^\s*[-•]\s*(.+)$/.exec(raw);
        if (sec === '不剧透' && item) out.plain.push(item[1].trim());
        else if (sec === '剧透' && item) out.spoil.push(item[1].trim());
        else if (sec === '拉回建议' && raw.trim()) steer.push(raw.trim());
    }
    out.plain = out.plain.filter((t) => !none(t));
    out.spoil = out.spoil.filter((t) => !none(t));
    out.steer = steer.join('\n').trim();
    none(out.steer) && (out.steer = '');
    return out;
}

// ---------- 把「NPC与敌人数据」交给 IGS 建档（只在装了 IGS 时才会用到） ----------

// 设定文字 → KP规则里某个小标题下的正文（去掉每行开头的「- 」）；没有就返回空串
export function kpSectionText(settingText, section) {
    let block = splitBlocks(settingText).find((b) => b.title === KP_BLOCK && !b.cont),
        out = [],
        inSection = !1;
    if (!block) return '';
    for (let line of block.text.split('\n')) {
        let head = /^\s*【([^】]+)】\s*$/.exec(line);
        if (head) {
            inSection = head[1].trim() === section;
            continue;
        }
        inSection && line.trim() && out.push(line.replace(/^\s*-\s*/, '').trimEnd());
    }
    return out.join('\n');
}

// IGS 返回的原因码 → 中文（没收录的原样显示）
const NPC_FAIL = { ruleset: 'IGS的数值规则不是CoC第七版。', 'no-model': 'IGS没有配置可用的模型。', empty: '没有可交给IGS的文字。', 'stats-inactive': '本聊天没有启用IGS的数值系统。', busy: 'IGS正在处理另一项调查员档任务，请稍后再试。', unavailable: 'IGS暂时无法处理。', 'stats-runtime-missing': 'IGS的数值系统尚未就绪。' },
    NPC_SKIP = { 'no-numbers': '没有数值', missing: '没有收到', name: '名字不合规' };

// IGS 返回的结果 → 一两句给人看的话
export function npcImportMessage(r) {
    if (!r || !r.ok) {
        let why = r && r.reason;
        return NPC_FAIL[why] || `失败：${why || '没有收到结果'}`;
    }
    let made = r.created || [],
        skipped = r.skipped || [],
        parts = [made.length ? `已建立${made.length}个NPC档：${made.join('、')}` : '没有建立新的NPC档'];
    skipped.length && parts.push(`跳过：${skipped.map((x) => `${x.name}（${NPC_SKIP[x.reason] || x.reason}）`).join('、')}`);
    return parts.join('。') + '。';
}
