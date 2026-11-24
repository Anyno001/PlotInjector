// 跑团模式的 KP 自动检测（纯逻辑）：每轮回复之后，让检测模型对照正文判断
// 本轮给出去的候选线索拿到没有、几条「情况」一句话条件成立没有、场景换到哪、有没有偏离模组。
// 判断结果由程序再核对一遍（引用的原句必须真在正文里），核对不过的一律当不通过。
import { cleanFloorText } from '../core/check.js';
import { checkLine } from './trpg.js';
import { sayAtoms, sayKey } from './trpg-clue-rules.js';
import { kpFind } from './trpg-kp.js';
import { discoveryList } from './trpg-clue-project.js';
import { isPlainObject, stageLabel } from '../core/outline.js';

export const KP_LOG_MAX = 20;
// 写进线索操作的备注：用来在 factOverrides 里认出「这条是 KP 判的」
export const KP_NOTE = 'KP判定';
const QUOTE_MIN = 4;

// 偏离类型 → 给玩家看的固定说法（不写具体真相）；没有类型（含旧日志）用通用说法
export const KP_OFF_KINDS = {
    stray: '正文离开了当前场景，去做了模组外的事',
    invent: '正文里出现了模组里没有的人物、地点或线索',
    skip: '正文跳过了本该进行的内容',
    reveal: '正文提前说破了后面才该揭晓的内容',
};
export const KP_OFF_GENERIC = '正文走向和当前阶段的内容对不上';
export const kpOffText = (kind) => KP_OFF_KINDS[kind] || KP_OFF_GENERIC;

export const kpAutoOn = (settings) => !settings || settings.trpgAutoCheck !== !1;

// 最近两楼（一问一答）：[{ user, text }]，文字按检测的惯例清理
export function recentTwo(messages, limit = 4000) {
    let out = [];
    for (let i = (messages || []).length - 1; i >= 0 && out.length < 2; i -= 1) {
        let m = messages[i];
        if (!m || m.is_system) continue;
        let text = cleanFloorText(m.mes, limit);
        text && out.unshift({ user: !!m.is_user, text });
    }
    return out;
}

// 本轮（这一楼）给出去的候选事实：[{ fact, text, record }]。带判定的，没掷骰成功的不算。
export function kpCandidates({ prog, chat, floor, state, snap, effective, checks }) {
    let msg = chat && chat[floor];
    if (!msg || msg.is_user) return [];
    let entry = (Array.isArray(prog && prog.clueCandidates) ? prog.clueCandidates : []).find(
            (x) => x.i === floor && x.swipe === (Number(msg.swipe_id) || 0) && String(x.stamp ?? '') === String(msg.send_date ?? ''),
        ),
        out = [],
        seen = new Set();
    for (let c of (entry && entry.candidates) || []) {
        if (!c || !c.fact || seen.has(c.fact)) continue;
        let hit = kpFind(state, c.fact);
        if (!hit || effective(c.fact, snap).confirmed) continue;
        let d = hit.discovery,
            gate = d.check ? checkLine(d, checks) : null;
        if (gate && !gate.reveal) continue;
        seen.add(c.fact);
        out.push({ fact: c.fact, text: d.text, record: c.record || d.record || '' });
    }
    return out;
}

// 还没判成立的「情况」一句话：当前阶段的结束条件、下一阶段的进入条件、当前阶段各节点的开放和完成条件
export function kpPendingSays({ compiled, state, conds }) {
    let done = new Set(Object.keys(conds || {}).map(sayKey)),
        out = [],
        add = (cond) => sayAtoms(cond).forEach((t) => !done.has(sayKey(t)) && !out.includes(t) && out.push(t)),
        units = compiled.units || [];
    for (let [i, unit] of units.entries()) {
        let st = state.stageStates.get(unit.id);
        if (!st || st.entered.v !== 'true' || st.done) continue;
        add(unit.clue.end);
        let next = units[i + 1];
        next && next.clue && next.clue.hasEnter && add(next.clue.enter);
        for (let ns of state.nodeStates) {
            if (ns.node.unit !== unit || ns.skipped || ns.disabled) continue;
            ns.status === 'locked' && add(ns.node.open);
            (ns.status === 'available' || ns.status === 'active') && add(ns.node.done);
        }
    }
    return out;
}

// 可以设为本轮场景的节点（已开放、没停用）：[{ uid, name }]
export function kpScenes(state) {
    return state.nodeStates
        .filter((ns) => (ns.status === 'available' || ns.status === 'active') && !ns.disabled && ns.node.uid)
        .map((ns) => ({ uid: ns.node.uid, name: ns.node.name || ns.node.uid, entry: String((ns.node.item && ns.node.item.入口) || '') }));
}

export function kpCheckMessages({ recent, candidates, says, scenes, stage, rules, labelOf = (id) => id }) {
    return [
        {
            role: 'system',
            content: [
                '你是跑团模组的 KP 助手。读最近的正文，判断下面列出的条目有没有真的发生。只判断，不续写。',
                '规则：',
                '1. 只判断列出来的条目，不要判断别的，也不要补充没列出来的。',
                '2. pass 为 true 时，quote 必须是从正文里原样抄下来的一句话作为证据；抄不出原句，就判 false。',
                '3. 线索的「记录」是判断标准，不要放宽。正文只是暗示、猜测、路过、还没真正到手的，判 false。',
                '4. 条件按字面判断，正文里已经发生、已经成立才算。',
                '5. scene：这一轮故事主要发生的场景，填「场景」列表里的编号；不确定就留空。',
                '6. offTrack：正文明显偏离了当前阶段的模组内容才算 true；玩家做了计划外的小事不算。偏离时 offKind 必须从四种里选一种：stray（离开了当前场景，去做模组外的事）、invent（编了模组里没有的重要人物、地点、线索）、skip（跳过了该进行的内容）、reveal（提前说破了后面的真相）。offReason 用玩家看得到的话写，不写具体真相；pullBack 是给正文的一小段拉回建议。offReason 和 pullBack 只能引用最近正文里已经写出来的内容，不提作者视角里玩家还没拿到的东西。没偏离时 offKind、offReason、pullBack 留空。',
                '严格输出一个 JSON，不要写别的：',
                '{"facts":[{"id":"编号","pass":true,"quote":"正文原句","why":"一句话"}],"conds":[{"text":"条件原文","pass":true,"quote":"正文原句"}],"scene":"节点编号或空","offTrack":false,"offKind":"","offReason":"","pullBack":""}',
                '没有要判断的线索或条件时，facts、conds 写空数组。',
            ].join('\n'),
        },
        {
            role: 'user',
            content: [
                `【最近正文】\n${recent.map((m) => `${m.user ? '玩家' : '正文'}：${m.text}`).join('\n\n') || '（没有）'}`,
                candidates.length
                    ? `【要判断的线索】\n${candidates.map((c) => `- id ${c.fact}（${labelOf(c.fact)}）：${c.text}${c.record ? `\n  记录标准：${c.record}` : ''}`).join('\n')}`
                    : '【要判断的线索】\n（没有）',
                says.length ? `【要判断的条件】\n${says.map((t) => `- ${t}`).join('\n')}` : '【要判断的条件】\n（没有）',
                scenes.length ? `【场景】\n${scenes.map((s) => `- ${s.uid}：${s.name}${s.entry ? `（${s.entry}）` : ''}`).join('\n')}` : '',
                `【当前阶段的模组内容（作者视角）】\n${stage || '（没有进行中的阶段）'}`,
                rules && `【KP规则】\n${rules}`,
            ]
                .filter(Boolean)
                .join('\n\n'),
        },
    ];
}

const flag = (v) => v === !0 || v === 'true';
const str = (v) => String(v ?? '').trim();
const offKindOf = (v) => (Object.hasOwn(KP_OFF_KINDS, str(v)) ? str(v) : '');

// 回复 → { facts, conds, scene, offTrack, offKind, offReason, pullBack }；不是 JSON 就抛错（调用方会重试）
export function parseKpReply(text) {
    let raw = String(text || ''),
        a = raw.indexOf('{'),
        b = raw.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('检测结果不是 JSON');
    let v;
    try {
        v = JSON.parse(raw.slice(a, b + 1));
    } catch {
        throw new Error('检测结果 JSON 无法解析');
    }
    let list = (x) => (Array.isArray(x) ? x.filter((i) => i && typeof i === 'object') : []);
    return {
        facts: list(v.facts).map((x) => ({ id: str(x.id), pass: flag(x.pass), quote: str(x.quote), why: str(x.why) })),
        conds: list(v.conds).map((x) => ({ text: str(x.text), pass: flag(x.pass), quote: str(x.quote), why: str(x.why) })),
        scene: str(v.scene),
        offTrack: flag(v.offTrack),
        offKind: offKindOf(v.offKind),
        offReason: str(v.offReason),
        pullBack: str(v.pullBack),
    };
}

// 程序核对：引用的原句去掉空白和标点后必须是正文的一段；事实只认 AI 写的正文，不认玩家自己说的
export function quoteIn(quote, hay) {
    let q = sayKey(quote);
    return q.length >= QUOTE_MIN && sayKey(hay).includes(q);
}

// parsed = parseKpReply 的结果；返回核对后的结果，每条带 ok（最终算不算通过）和 note（没通过的原因）
export function verifyKp(parsed, { candidates, says, scenes, recent }) {
    let all = recent.map((m) => m.text).join('\n'),
        ai = recent.filter((m) => !m.user).map((m) => m.text).join('\n'),
        facts = [];
    for (let c of candidates) {
        let r = parsed.facts.find((x) => x.id === c.fact);
        // 候选以外的 id 一律不看
        if (!r) {
            facts.push({ id: c.fact, ok: !1, why: '', note: '检测没有给出结论', quote: '' });
            continue;
        }
        let ok = r.pass && quoteIn(r.quote, ai);
        facts.push({ id: c.fact, ok, why: r.why, quote: r.quote, note: ok ? '' : r.pass ? '给出的原句在正文里找不到' : '正文里没有拿到' });
    }
    let conds = [];
    for (let text of says) {
        let r = parsed.conds.find((x) => sayKey(x.text) === sayKey(text));
        if (!r) {
            conds.push({ text, ok: !1, why: '', note: '检测没有给出结论', quote: '' });
            continue;
        }
        let ok = r.pass && quoteIn(r.quote, all);
        conds.push({ text, ok, why: r.why, quote: r.quote, note: ok ? '' : r.pass ? '给出的原句在正文里找不到' : '还没成立' });
    }
    let scene = scenes.find((s) => s.uid === parsed.scene);
    return {
        facts,
        conds,
        scene: scene ? scene.uid : '',
        sceneName: scene ? scene.name : '',
        offTrack: parsed.offTrack,
        offKind: parsed.offKind,
        offReason: parsed.offReason,
        pullBack: parsed.pullBack,
    };
}

// ---------------- 重新核实阶段（用户 2026-11-24） ----------------
// 每轮只核对最新一楼、只核对给出去的几条，漏判一次阶段就卡住。这里让 KP 回头读最近 N 楼，
// 把进行中阶段里还没完成的节点的线索、没成立的一句话条件重新判一遍；结果先给用户勾选确认才写入。
export const RECHECK_FLOORS = [10, 20, 30];
export const RECHECK_MAX = 60;
const RECHECK_FACT_MAX = 40;

// 最近 n 楼（玩家和正文都算）：[{ user, text, floor }]；从后往前取，总字数超了就停
export function recentFloors(messages, n, limit = 4000, total = 3e4) {
    let out = [],
        sum = 0;
    for (let i = (messages || []).length - 1; i >= 0 && out.length < n; i -= 1) {
        let m = messages[i];
        if (!m || m.is_system) continue;
        let text = cleanFloorText(m.mes, limit);
        if (!text) continue;
        if (out.length && sum + text.length > total) break;
        sum += text.length;
        out.unshift({ user: !!m.is_user, text, floor: i });
    }
    return out;
}

// 进行中阶段里没完成的节点给出的线索（还没确认的；带判定的要先掷成功）：[{ fact, text, record, stage, node }]
export function kpRecheckCandidates({ compiled, state, snap, effective, checks }) {
    let out = [],
        seen = new Set();
    for (let unit of compiled.units || []) {
        let st = state.stageStates.get(unit.id);
        if (!st || st.entered.v !== 'true' || st.done) continue;
        for (let ns of state.nodeStates) {
            if (ns.node.unit !== unit || ns.skipped || ns.disabled || ns.status === 'done') continue;
            for (let d of discoveryList(isPlainObject(ns.node.item) ? ns.node.item : {})) {
                if (!d.fact || seen.has(d.fact) || effective(d.fact, snap).confirmed) continue;
                let gate = d.check ? checkLine(d, checks) : null;
                if (gate && !gate.reveal) continue;
                seen.add(d.fact);
                out.push({ fact: d.fact, text: d.text, record: d.record || '', stage: unit.stage ? stageLabel(unit.stage.key) : '', node: ns.node.name || ns.node.uid || '' });
            }
        }
    }
    return out.slice(0, RECHECK_FACT_MAX);
}

export function kpRecheckMessages({ recent, candidates, says, stage, rules, labelOf = (id) => id }) {
    return [
        {
            role: 'system',
            content: [
                '你是跑团模组的 KP 助手。玩家觉得阶段推进卡住了，请回头读下面这几楼正文，逐条判断列出的线索和条件是不是已经在这段正文里发生过。只判断，不续写。',
                '规则：',
                '1. 只判断列出来的条目，不要判断别的，也不要补充没列出来的。',
                '2. pass 为 true 时，quote 必须是从正文里原样抄下来的一句话作为证据；抄不出原句，就判 false。',
                '3. 线索的「记录」是判断标准，不要放宽。正文只是暗示、猜测、路过、还没真正到手的，判 false。',
                '4. 条件按字面判断，正文里已经发生、已经成立才算。',
                '严格输出一个 JSON，不要写别的：',
                '{"facts":[{"id":"编号","pass":true,"quote":"正文原句","why":"一句话"}],"conds":[{"text":"条件原文","pass":true,"quote":"正文原句"}]}',
                '没有要判断的线索或条件时，facts、conds 写空数组。',
            ].join('\n'),
        },
        {
            role: 'user',
            content: [
                `【正文（第${recent.length ? recent[0].floor : 0}–${recent.length ? recent[recent.length - 1].floor : 0}楼）】\n${recent.map((m) => `[第${m.floor}楼] ${m.user ? '玩家' : '正文'}：${m.text}`).join('\n\n') || '（没有）'}`,
                candidates.length
                    ? `【要判断的线索】\n${candidates.map((c) => `- id ${c.fact}（${labelOf(c.fact)}，${c.stage}·${c.node}）：${c.text}${c.record ? `\n  记录标准：${c.record}` : ''}`).join('\n')}`
                    : '【要判断的线索】\n（没有）',
                says.length ? `【要判断的条件】\n${says.map((t) => `- ${t}`).join('\n')}` : '【要判断的条件】\n（没有）',
                `【进行中阶段的模组内容（作者视角）】\n${stage || '（没有）'}`,
                rules && `【KP规则】\n${rules}`,
            ]
                .filter(Boolean)
                .join('\n\n'),
        },
    ];
}

// 线索用标签，没有标签就用内容的前 12 个字，不露编号
export function kpFactLabel(labels, id, text) {
    let l = labels && labels[id] && labels[id].label;
    return l || (String(text || '').length > 12 ? `${String(text).slice(0, 12)}…` : String(text || '') || '一条线索');
}

// 存进 progress.trpgKp.log 的一条（只留最近 KP_LOG_MAX 条）
export function kpLogEntry({ floor, at = Date.now(), result, labelOf, scenes, off }) {
    return {
        at,
        floor,
        facts: result.facts.map((x) => ({ label: labelOf(x.id), ok: x.ok, why: x.ok ? x.why : x.note || x.why, quote: x.ok ? x.quote : '' })),
        conds: result.conds.map((x) => ({ text: x.text, ok: x.ok, why: x.ok ? x.why : x.note || x.why, quote: x.ok ? x.quote : '' })),
        scene: result.sceneName || '',
        off: !!off,
        offKind: result.offTrack ? result.offKind || '' : '',
        offReason: result.offTrack ? result.offReason : '',
    };
}

export function pushLog(log, entry) {
    return [...(Array.isArray(log) ? log : []), entry].slice(-KP_LOG_MAX);
}

// 执行页「上轮检测」那一行的文字
export function kpSummary(entry) {
    if (!entry) return '';
    let got = entry.facts.filter((x) => x.ok).length;
    if (entry.recheck != null) return `重新核实第${entry.recheck}–${entry.floor}楼 · 拿到${got}条线索 · ${entry.conds.filter((x) => x.ok).length}个条件成立`;
    return `拿到${got}条线索 · ${entry.scene ? `场景${entry.scene}` : '场景没变'} · ${entry.off ? '偏离了模组' : '未偏离'}`;
}
