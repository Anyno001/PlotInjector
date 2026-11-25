// 跑团模组原文切片库（纯逻辑）。计划见 特殊文件/剧情注入器/跑团切片库计划.md。
// 导入 PDF 模组时，从原文里原样截下 NPC 台词、场景描写、伏笔、暂不说破的内容，存进 project.trpg.slices；
// 注入时按当前场景给几条（口吻参考、场景描写、伏笔提示），伏笔写没写出来并进每轮 KP 检测，不额外请求。
import { isPlainObject } from '../core/outline.js';
import { sayKey, effectiveFact } from './trpg-clue-rules.js';
import { discoveryList } from './trpg-clue-project.js';
import { clueNodes } from './trpg-clue-model.js';

export const SLICE_KINDS = { line: '台词', scene: '场景描写', seed: '伏笔', taboo: '暂不说破' };
export const SLICE_TEXT_MAX = 400;
export const SLICE_HINT_MAX = 80;
export const SLICE_PER_PART = 8;
export const SLICE_STORE_MAX = 240;
const MIN_KEY = 8;
export const SEED_ROUNDS = 3;
export const SCENE_ROUNDS = 2;
export const PICK_MAX = 5;
export const PICK_CHARS = 1500;
const LINE_MAX = 2;

const isCjkEnd = (ch) => /[一-鿿，。！？、；：”）」』…—]/.test(ch || '');
const textOf = (v) => String(v ?? '').trim();

// ---------------- 原文定位 ----------------

// 去掉空白和标点后的文字，以及每个字在原文里的起止位置（按 UTF-16 下标）
function keyIndex(src) {
    let key = '',
        at = [],
        endAt = [],
        pos = 0;
    for (let ch of String(src || '')) {
        if (!/[\s\p{P}\p{S}]/u.test(ch)) {
            key += ch;
            for (let k = 0; k < ch.length; k += 1) (at.push(pos), endAt.push(pos + ch.length));
        }
        pos += ch.length;
    }
    return { key, at, endAt };
}

// 引用必须是原文里的一段（去空白标点后）；找到就返回原文里对应的原始子串，找不到返回 ''
export function extractOriginal(src, quote, min = MIN_KEY) {
    let q = sayKey(quote);
    if (q.length < min) return '';
    let { key, at, endAt } = keyIndex(src),
        i = key.indexOf(q);
    return i < 0 ? '' : String(src).slice(at[i], endAt[i + q.length - 1]);
}

// PDF 的硬换行压掉；汉字后面接着的换行直接接上，其余换成一个空格
export function tidySliceText(text, max = SLICE_TEXT_MAX) {
    let t = String(text || '')
        .replace(/\r\n?/g, '\n')
        .replace(/\s*\n\s*/g, (m, off, str) => (isCjkEnd(str[off - 1]) ? '' : ' '))
        .trim();
    if (t.length <= max) return t;
    let cut = t.slice(0, max),
        end = Math.max(cut.lastIndexOf('。'), cut.lastIndexOf('！'), cut.lastIndexOf('？'), cut.lastIndexOf('」'));
    return end > max * 0.4 ? cut.slice(0, end + 1) : cut;
}

function grams(key, n) {
    let out = new Set();
    for (let i = 0; i + n <= key.length; i += 1) out.add(key.slice(i, i + n));
    return out;
}

// a、b 去空白标点后有没有 n 字以上的公共片段
export function sharesRun(a, b, n = 6) {
    let ka = sayKey(a),
        kb = sayKey(b);
    if (ka.length < n || kb.length < n) return false;
    let set = grams(ka.length <= kb.length ? ka : kb, n),
        other = ka.length <= kb.length ? kb : ka;
    for (let i = 0; i + n <= other.length; i += 1) if (set.has(other.slice(i, i + n))) return !0;
    return !1;
}

// ---------------- 导入：让 AI 挑片段 ----------------

export function sliceMessages({ part, text, total }) {
    return [
        {
            role: 'system',
            content: [
                '你在帮作者整理跑团模组。下面是模组原文的一段，请挑出值得**原样保留**的片段，以后主持时用来保持原味。只挑，不改写，不续写。',
                '可挑四类：',
                '- line：NPC 的台词或说话口吻的例子（一两句话，带上说话的人）；',
                '- scene：读给玩家听的场景或物件描写（有气氛、有细节的那种）；',
                '- seed：伏笔，原文有意埋下、后面才会有用的细节；',
                '- taboo：此时玩家还不该知道的内容，主持时要注意不能说破。',
                `规则：1. quote 必须从原文里一字不差地抄下来，不要改写、不要拼接、不要省略；每条不超过 ${SLICE_TEXT_MAX} 字，最好一两句。2. 这一段里最多 ${SLICE_PER_PART} 条，没有值得挑的就返回空数组，不要凑数。3. line 要写 who（说话的人）；where 写这条发生的场景或地点，用原文里的称呼。4. seed 和 taboo 必须写 hint：一句话的表面提示，**只写玩家能看到、不揭晓真相**的样子（例如「桌上那只停摆的钟」），不要写真相、原因、结局。5. 材料里写给作者看的幕后真相、结局分支，只能作为 taboo 的依据，hint 里不要出现具体内容。`,
                '严格输出一个 JSON，不要写别的：',
                '{"slices":[{"kind":"line","who":"","where":"","quote":"原文原句","hint":""}]}',
            ].join('\n'),
        },
        { role: 'user', content: `【第 ${part.i + 1} / ${total} 段：${part.title}】\n${text}` },
    ];
}

export function parseSliceReply(text) {
    let raw = String(text || ''),
        a = raw.indexOf('{'),
        b = raw.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('切片结果不是 JSON');
    let v;
    try {
        v = JSON.parse(raw.slice(a, b + 1));
    } catch {
        throw new Error('切片结果 JSON 无法解析');
    }
    return (Array.isArray(v.slices) ? v.slices : [])
        .filter((x) => isPlainObject(x))
        .map((x) => ({ kind: textOf(x.kind), who: textOf(x.who), where: textOf(x.where), quote: textOf(x.quote), hint: textOf(x.hint) }));
}

// AI 的挑选 → 程序核对：引用必须在这一段原文里，入库的是原文里的原始子串；核对不过的丢掉
export function verifySlices(items, partText, partNo = 0) {
    let out = [];
    for (let x of items || []) {
        if (!Object.hasOwn(SLICE_KINDS, x.kind) || out.length >= SLICE_PER_PART) continue;
        let orig = extractOriginal(partText, x.quote);
        if (!orig) continue;
        let text = tidySliceText(orig);
        if (sayKey(text).length < MIN_KEY) continue;
        let hint = textOf(x.hint).slice(0, SLICE_HINT_MAX);
        if ((x.kind === 'seed' || x.kind === 'taboo') && !hint) continue;
        if (x.kind === 'line' && !textOf(x.who)) continue;
        out.push({ kind: x.kind, who: textOf(x.who).slice(0, 20), where: textOf(x.where).slice(0, 40), text, hint: x.kind === 'line' || x.kind === 'scene' ? '' : hint, part: partNo });
    }
    return out;
}

// ---------------- 存取与合并 ----------------

export function normalizeSlices(list) {
    if (!Array.isArray(list)) return [];
    let out = [],
        seen = new Set();
    for (let x of list) {
        if (!isPlainObject(x) || !Object.hasOwn(SLICE_KINDS, x.kind) || !textOf(x.text)) continue;
        let id = textOf(x.id) || `sl${out.length}`;
        if (seen.has(id)) continue;
        seen.add(id);
        out.push({
            id,
            kind: x.kind,
            who: textOf(x.who).slice(0, 20),
            where: textOf(x.where).slice(0, 40),
            text: textOf(x.text).slice(0, SLICE_TEXT_MAX * 2),
            hint: textOf(x.hint).slice(0, SLICE_HINT_MAX),
            node: textOf(x.node),
            stage: textOf(x.stage),
            part: Number.isFinite(Number(x.part)) ? Number(x.part) : -1,
            off: x.off === !0,
        });
        if (out.length >= SLICE_STORE_MAX) break;
    }
    return out;
}

const sameText = (a, b) => {
    let x = sayKey(a),
        y = sayKey(b);
    return !!x && !!y && (x.includes(y) || y.includes(x));
};

// 把新切出来的并进已有的：文字互相包含的算重复（overlap 区会切到同一句）；新编号接在已有的后面
export function mergeSlices(existing, incoming) {
    let out = normalizeSlices(existing),
        next = out.reduce((m, x) => Math.max(m, Number(/^sl(\d+)$/.exec(x.id)?.[1] ?? -1)), -1) + 1;
    for (let x of incoming || []) {
        if (out.length >= SLICE_STORE_MAX) break;
        if (out.some((y) => y.kind === x.kind && sameText(y.text, x.text))) continue;
        out.push({ node: '', stage: '', off: !1, ...x, id: `sl${next++}` });
    }
    return out;
}

// ---------------- 挂靠到节点 ----------------

// 一条切片对一个节点的得分：地点称呼对上节点名 +3，说话人在节点文字里 +2，原文和节点文字有 4 字以上公共片段 +1
function scoreSlice(s, name, hay) {
    let wk = sayKey(s.where),
        sk = sayKey(s.who),
        nk = sayKey(name),
        score = 0;
    wk && nk && (wk.includes(nk) || nk.includes(wk)) && (score += 3);
    sk.length >= 2 && hay.includes(sk) && (score += 2);
    sharesRun(s.text || s.hint, hay, 4) && (score += 1);
    return score;
}
const hayOf = (name, item) => sayKey(`${name}${JSON.stringify(item || {})}`);

// 没挂靠的、或挂的节点已经不在了的，按名字和内容重新找节点，总分 ≥2 才挂。返回新数组，已经挂对的不动。
export function attachSlices(slices, volumes) {
    let nodes = clueNodes(volumes).filter((n) => n.uid),
        live = new Set(nodes.map((n) => n.uid)),
        hays = new Map(nodes.map((n) => [n.uid, hayOf(n.name, n.item)]));
    return normalizeSlices(slices).map((s) => {
        if (s.node && live.has(s.node)) return s;
        let best = null,
            top = 1;
        for (let n of nodes) {
            let score = scoreSlice(s, n.name, hays.get(n.uid));
            score > top && ((top = score), (best = n));
        }
        return best ? { ...s, node: best.uid, stage: best.unit.id } : { ...s, node: '', stage: '' };
    });
}

// 审阅页用：导入还没入库、草稿节点没有正式编号，只按名字和内容看每条切片对应这批节点里的哪一个。
// nodes = [{ key, name, item }]；返回 Map(key → 切片[])，得分不够的不放进去
export function matchSlices(slices, nodes) {
    let out = new Map(),
        hays = nodes.map((n) => hayOf(n.name, n.item));
    for (let s of slices || []) {
        let best = -1,
            top = 1;
        nodes.forEach((n, i) => {
            let score = scoreSlice(s, n.name, hays[i]);
            score > top && ((top = score), (best = i));
        });
        best >= 0 && out.set(nodes[best].key, [...(out.get(nodes[best].key) || []), s]);
    }
    return out;
}

// ---------------- 防泄露 ----------------

// 和还没拿到的线索（文字、记录）有 6 字以上公共片段的切片先扣住，等线索确认了再放出来
export function heldSlices(slices, secretTexts) {
    let set = new Set();
    for (let t of secretTexts || []) for (let g of grams(sayKey(t), 6)) set.add(g);
    let held = new Set();
    if (!set.size) return held;
    for (let s of slices || []) {
        let key = sayKey(s.text);
        for (let i = 0; i + 6 <= key.length; i += 1)
            if (set.has(key.slice(i, i + 6))) {
                held.add(s.id);
                break;
            }
    }
    return held;
}

// ---------------- 注入 ----------------

const FOOT = {
    line: 'NPC 口吻参考（可以化用原句，不要照抄成固定台词，不添加新信息）：',
    scene: '场景描写参考（可以改写，保留关键物件和气氛）：',
    seed: '伏笔（自然带过即可，不要点破、不要解释）：',
    taboo: '此刻不要说破：',
};
const ORDER = ['line', 'seed', 'scene', 'taboo'];

// 挑本轮要给的切片。
// ctx = { sceneUid, activeUids: Set（已开放、没停用的节点）, held: Set, planted: Set（已埋的伏笔）, counts: Map（id → 已注入过几轮） }
export function pickSlices(slices, ctx) {
    let rounds = { seed: SEED_ROUNDS, scene: SCENE_ROUNDS },
        pool = (slices || []).filter((s) => {
            if (s.off || !s.node || !ctx.activeUids.has(s.node) || ctx.held.has(s.id)) return !1;
            if (s.kind === 'seed' && ctx.planted.has(s.id)) return !1;
            if (rounds[s.kind] && (ctx.counts.get(s.id) || 0) >= rounds[s.kind]) return !1;
            // 没定场景时不给台词和场景描写，免得串戏
            return ctx.sceneUid ? ctx.sceneUid === s.node || s.kind === 'seed' || s.kind === 'taboo' : s.kind === 'seed' || s.kind === 'taboo';
        }),
        out = [],
        chars = 0;
    for (let kind of ORDER)
        for (let s of pool.filter((x) => x.kind === kind)) {
            let body = kind === 'seed' || kind === 'taboo' ? s.hint : s.text;
            if (!body || out.length >= PICK_MAX || (kind === 'line' && out.filter((x) => x.kind === 'line').length >= LINE_MAX)) continue;
            if (out.length && chars + body.length > PICK_CHARS) continue;
            chars += body.length;
            out.push({ id: s.id, kind, who: s.who, body });
        }
    return out;
}

export function sliceLines(picked) {
    let out = [];
    for (let kind of ORDER) {
        let list = picked.filter((x) => x.kind === kind);
        if (!list.length) continue;
        out.push(FOOT[kind], ...list.map((x) => (kind === 'line' ? `- ${x.who}：${x.body}` : `- ${x.body}`)));
    }
    return out;
}

// ---------------- 伏笔：随每轮检测一起判 ----------------

// 已埋下的伏笔：楼层还在、是 AI 写的、swipe 和发送时间对得上才算（重 roll 或删楼之后当没埋）
export function plantedSeeds(seeds, chat) {
    let out = new Set();
    for (let [id, r] of Object.entries(seeds || {})) {
        let m = chat && chat[r && r.floor];
        m && !m.is_user && (Number(m.swipe_id) || 0) === (r.swipe || 0) && String(m.send_date ?? '') === String(r.stamp ?? '') && out.add(id);
    }
    return out;
}

// 这一楼给出去的、还没埋下的伏笔：[{ id, hint, text }]
export function seedCandidates({ prog, chat, floor, slices, planted }) {
    let msg = chat && chat[floor];
    if (!msg || msg.is_user) return [];
    let entry = (Array.isArray(prog && prog.clueCandidates) ? prog.clueCandidates : []).find(
            (x) => x.i === floor && x.swipe === (Number(msg.swipe_id) || 0) && String(x.stamp ?? '') === String(msg.send_date ?? ''),
        ),
        ids = new Set((entry && entry.slices) || []);
    return (slices || []).filter((s) => s.kind === 'seed' && ids.has(s.id) && !planted.has(s.id)).map((s) => ({ id: s.id, hint: s.hint, text: s.text }));
}

// 每个切片已经注入过几轮（clueCandidates 每条记了当时给过哪些）
export function sliceCounts(prog) {
    let m = new Map();
    for (let e of Array.isArray(prog && prog.clueCandidates) ? prog.clueCandidates : [])
        for (let id of e.slices || []) m.set(id, (m.get(id) || 0) + 1);
    return m;
}

// 检测回复里的 seeds → 核对：引用必须在 AI 正文里，并且和这条伏笔的提示或原文有 4 字以上公共片段
export function verifySeeds(parsedSeeds, cands, aiText) {
    let all = [];
    for (let c of cands || []) {
        let r = (parsedSeeds || []).find((x) => x.id === c.id),
            ok = !!(r && r.pass && extractOriginal(aiText, r.quote, 4) && (sharesRun(r.quote, c.hint, 4) || sharesRun(r.quote, c.text, 4)));
        all.push({ id: c.id, ok, quote: r ? r.quote : '' });
    }
    return all;
}

// ---------------- 运行时：投影要用的数据 ----------------

// 没有切片、或用户关了就返回 null（注入文字与没有这个功能时逐字一致）。
// prog = 完整进度（clueCandidates、trpgKp），clueProg = 线索进度（factOverrides）
export function sliceContext({ project, state, snap, prog, clueProg, chat }) {
    let t = project && project.trpg;
    if (!t || t.sliceOff || !Array.isArray(t.slices) || !t.slices.length || !state) return null;
    let list = t.slices.filter((s) => !s.off),
        secrets = [];
    for (let ns of state.nodeStates)
        for (let d of discoveryList(isPlainObject(ns.node.item) ? ns.node.item : {}))
            d.fact && !effectiveFact(d.fact, snap, clueProg).confirmed && secrets.push(d.text, d.record);
    return {
        list,
        sceneUid: (state.focus && state.focus.uid) || '',
        activeUids: new Set(state.nodeStates.filter((ns) => (ns.status === 'available' || ns.status === 'active') && !ns.disabled && ns.node.uid).map((ns) => ns.node.uid)),
        held: heldSlices(list, secrets),
        planted: plantedSeeds(prog && prog.trpgKp && prog.trpgKp.seeds, chat),
        counts: sliceCounts(prog),
    };
}

// ---------------- AI 核对挂靠 ----------------

export const ALIGN_BATCH = 30;
const short = (t, n) => String(t || '').replace(/\s+/g, ' ').slice(0, n);

// 节点清单：[{ uid, name, stage, entry }]，stage 是阶段短名
export function alignNodes(volumes, stageName = (key) => key) {
    return clueNodes(volumes)
        .filter((n) => n.uid)
        .map((n) => ({ uid: n.uid, name: n.name, stage: stageName(n.unit.stage.key), entry: short(isPlainObject(n.item) ? n.item.入口 : '', 60) }));
}

export function alignMessages({ slices, nodes }) {
    return [
        {
            role: 'system',
            content: [
                '你在核对跑团模组的原文切片挂在哪个场景节点上。每条切片是从模组原文里摘出的台词、场景描写或伏笔，请判断它最适合挂在下面哪个节点（在这个节点进行时才会给出）。',
                '规则：1. node 只能填节点清单里的编号，不能自己编。2. 切片讲的场景、地点、人物明显不属于任何节点时，node 留空。3. 台词看说话人在哪个节点出场；场景描写看写的是哪个地点。4. why 一句话说明依据。',
                '严格输出一个 JSON，不要写别的：{"items":[{"id":"切片编号","node":"节点编号或空","why":"一句话"}]}',
            ].join('\n'),
        },
        {
            role: 'user',
            content: [
                `【节点清单】\n${nodes.map((n) => `- ${n.uid}：${n.name}（${n.stage}）${n.entry ? `入口：${n.entry}` : ''}`).join('\n')}`,
                `【切片】\n${slices.map((s) => `- ${s.id}（${SLICE_KINDS[s.kind]}${s.who ? `，${s.who}` : ''}${s.where ? `，原文地点：${s.where}` : ''}）：${short(s.kind === 'seed' || s.kind === 'taboo' ? `${s.hint}｜${s.text}` : s.text, 160)}`).join('\n')}`,
            ].join('\n\n'),
        },
    ];
}

export function parseAlign(text) {
    let raw = String(text || ''),
        a = raw.indexOf('{'),
        b = raw.lastIndexOf('}');
    if (a < 0 || b <= a) throw new Error('核对结果不是 JSON');
    let v;
    try {
        v = JSON.parse(raw.slice(a, b + 1));
    } catch {
        throw new Error('核对结果 JSON 无法解析');
    }
    return (Array.isArray(v.items) ? v.items : []).filter((x) => isPlainObject(x)).map((x) => ({ id: textOf(x.id), node: textOf(x.node), why: textOf(x.why) }));
}

// 和现在挂靠不同的建议：[{ id, from, to, why }]；AI 给的节点不在清单里一律当「都不对应」
export function alignChanges(slices, items, nodes) {
    let live = new Set(nodes.map((n) => n.uid)),
        by = new Map(items.map((x) => [x.id, x])),
        out = [];
    for (let s of slices) {
        let x = by.get(s.id);
        if (!x) continue;
        let to = live.has(x.node) ? x.node : '';
        to !== s.node && out.push({ id: s.id, from: s.node, to, why: x.why });
    }
    return out;
}
