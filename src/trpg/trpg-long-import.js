import { CLUE_LINE_RULES, CLUE_OUTLINE_RULES_WITH_LINES, CLUE_OUTLINE_RULES, OUTLINE_RULES, ENTRY_HINT_RULE, BRIEF_RULE } from '../core/prompts.js';
import { discoveryList, clueText, clueAlternativeRoutes, clueReachability, checkClueDraft } from './trpg-clue-project.js';
import {
    volumeLabel,
    splitStageKey,
    isPlainObject,
    STAGE_HINT_KEYS,
    NODE_FIELDS,
    stageLabel,
    flattenUnits,
    stageNodes,
    nodeMapsToLists,
    VOLUME_LINE_KEY,
} from '../core/outline.js';
import { parseYaml } from '../core/yaml.js';
import { conditionRefs, parseCondition, compileClue } from './trpg-clue-rules.js';

import { CLUE_STAGE_KEYS, CLUE_NODE_KEYS, nodeUid, stripAuthorDeep, outlineStageData } from './trpg-clue-model.js';
import { TRPG_IMPORT_RULES } from './trpg.js';
import { importFlowIssues } from './trpg-import-check.js';

export const CHAPTER_HEAD =
    /^(?:#{1,4}\s+.+|第[0-9一二三四五六七八九十百零〇两]+[章回节幕部卷].*|Chapter\s+\d+.*|[一二三四五六七八九十]+、.+)$/i;

export function splitLongText(text, { target = 8e3, overlap = 300 } = {}) {
    let src = String(text || '').replace(/\r\n?/g, '\n'),
        lines = src.split('\n'),
        heads = [];
    for (let i = 0, pos = 0; i < lines.length; pos += lines[i].length + 1, i++)
        CHAPTER_HEAD.test(lines[i].trim()) && heads.push({ pos, title: lines[i].trim().replace(/^#+\s*/, '') });
    // 按章节切成初段；没有章节时整篇一段。
    let parts = [];
    if (!heads.length || heads[0].pos > 0)
        parts.push({ title: heads.length ? '开头' : '全文', start: 0, end: heads.length ? heads[0].pos : src.length });
    heads.forEach((h, k) => parts.push({ title: h.title, start: h.pos, end: k + 1 < heads.length ? heads[k + 1].pos : src.length }));
    parts = parts.filter((p) => src.slice(p.start, p.end).trim());
    // 太长的段在段落边界再切；太短的相邻段合并。
    let out = [];
    for (let p of parts) {
        if (p.end - p.start <= target * 1.4) {
            out.push(p);
            continue;
        }
        let at = p.start,
            n = 1;
        for (; at < p.end;) {
            let cut = Math.min(p.end, at + target),
                para = src.lastIndexOf('\n\n', cut);
            cut < p.end && para > at + target * 0.5 && (cut = para);
            (out.push({ title: `${p.title}（${n++}）`, start: at, end: cut }), (at = cut));
        }
    }
    // 合并：相邻小段攒到接近目标长度为止；标题显示「首 … 末」。
    let merged = [];
    for (let p of out) {
        let last = merged[merged.length - 1];
        last && last.end - last.start + (p.end - p.start) <= target
            ? ((last.end = p.end), (last.last = p.title))
            : merged.push({ ...p, first: p.title, last: p.title });
    }
    merged.forEach((p) => (p.title = p.first === p.last ? p.first : `${p.first} … ${p.last}`));
    return merged.map((p, i) => ({
        i,
        title: p.title,
        start: p.start,
        end: p.end,
        text: src.slice(Math.max(0, p.start - (i ? overlap : 0)), p.end),
        lead: i ? Math.min(overlap, p.start) : 0,
    }));
}

export const IMPORT_INDEX_FORMAT = [
    '```yaml',
    '梗概: 这一段讲了什么（两三句）',
    '人物:',
    '  - {名称: 常用称呼, 别名: [只属于这个人的其他称呼], 同一人: 前面索引里已有的名称（只有原文明说是同一个人时才写）, 公开身份: 别人眼里他是谁, 真实身份: 只有作者知道的（没有就省略）, 名字保密: 按上面的判断方法，需要时写 true（不需要就省略）, 首次登场: 本段 / 之前}',
    '  # 「维修工」「老板」这类很多人都能叫的泛称不要写进别名；同一个人的化名、绰号才写。',
    '地点:',
    '  - {名称: …, 说明: 一句话}',
    '事实:   # 剧情里需要被「查到 / 听到 / 看到」的关键信息',
    '  - {编号: F_拼音或英文短词, 内容: 一句话, 性质: 真相 / 证词 / 实物 / 传闻 / 推测, 谁说的: 证词和传闻写来源, 玩家怎么能知道: 本段里通过什么行动取得（没写就留空）}',
    '门槛:   # 原文写的「要先拿到什么，才能做下一步」',
    '  - {需要: [事实编号…], 才能: 下一步做什么}',
    '并行:   # 原文明确说可以先后不限的几条线',
    '  - [线A的简称, 线B的简称]',
    '作者资料: 原文里只给作者看的部分（幕后真相、人物动机、写作说明、结局分支）的要点',
    '```',
].join('\n');

export function importIndexMessages({ part, total, prev = '', needs = '' }) {
    return [
        {
            role: 'system',
            content: [
                '你在帮作者把一份长剧情材料整理成可以游玩的大纲。这一步只读材料、整理作者索引，不写大纲。',
                '材料可能是小说正文，也可能是写给作者的剧情方案。方案里的「真相」「人物表」「分支说明」「人物弧线」属于作者资料；「调查如何继续」这类段落是推进条件，不是新事件。',
                '区分三件事：原书里的真相（作者知道）；角色说的话（证词、传闻，不一定是真的）；玩家通过什么行动才能知道。',
                '只写材料里有的，不要补写。拿不准的写在「作者资料」里并注明「待确认」。',
                '「事实」只收**玩家在游戏里通过某个行动能拿到的具体信息或实物**：看到的东西、听到的话、读到的记录、确认的地点。一段材料通常只有几条。',
                '材料里的写作规则、提醒和限制（如「不能一次检查就解决全部问题」「只说合作不产生成果」「主角会逐渐愿意让别人分担」「结局可以不完全成功」）**不是事实**，写进「作者资料」。',
                '「名字保密」怎么判断：问自己「故事一开始，叙述里能不能直接用这个名字称呼这个人？」能，就不写；不能、要等剧情揭晓以后才能出现，才写 true。',
                '  - 要写 true 的，例如：幕后主使的真名、真凶是谁、化名者的本名、整个故事要查出来的那个人。',
                '  - 不写的，例如：主角和主要同伴的名字（哪怕他有一重不让外人知道的身份）、公开使用的称号、代号、外号。',
                '  - 两种称呼本身都可以在正文里出现、只是它们指同一个人这件事保密的，把这层对应写进「真实身份」，不标名字保密；某个称呼本身也要等剧情揭晓才能出现的，那个称呼仍按上面的办法标。',
                `输出格式（只输出这一个代码块）：\n${IMPORT_INDEX_FORMAT}`,
            ].join('\n'),
        },
        {
            role: 'user',
            content: [
                needs && `【作者的要求】\n${needs}`,
                prev && `【前面几段已经整理出的索引（编号沿用，不要重复建）】\n${prev}`,
                `【第 ${part.i + 1} / ${total} 段：${part.title}】\n${part.text}`,
            ]
                .filter(Boolean)
                .join('\n\n'),
        },
    ];
}

// 索引 YAML 格式坏了时修格式用（原来借用大纲的修格式提示，规则对不上，修完常常还是坏的）。
export function fixImportIndexMessages(text, error) {
    return [
        {
            role: 'system',
            content: `修正下面作者索引 YAML 的格式错误，内容一字不改，只改缩进、冒号、引号。含冒号、方括号、尖括号的文字整句加引号；列表里的每一条要么是一句文字，要么是 {键: 值} 对象，不要在文字下面再挂子列表。\n格式：\n${IMPORT_INDEX_FORMAT}`,
        },
        { role: 'user', content: `【错误】${error}\n\n${text}` },
    ];
}

// 本地逐块抢救坏掉的索引 YAML（用户 2026-11-22：第4段一处缩进错，整份索引读不出，后面的段都卡住）。
// 按顶层键切块，各块单独解析；坏块是列表的逐条解析，坏条和坏掉的文字块原样收进「作者资料」，不丢内容。
// 返回 { value, lost }：lost 是原样保留下来的坏条数（0 = 只有文字块坏了、结构没丢）。
const INDEX_LIST_KEYS = new Set(['人物', '地点', '事实', '门槛', '并行', '支线']);
export function salvageImportIndex(text) {
    let lines = String(text || '').replace(/\r\n?/g, '\n').split('\n'),
        secs = [],
        cur = null;
    for (let line of lines) {
        let m = /^([^\s#\-][^:：]*?)\s*[:：](.*)$/.exec(line);
        m ? secs.push((cur = { key: m[1].trim(), head: m[2], body: [] })) : cur && cur.body.push(line);
    }
    let value = {},
        keep = [],
        lost = 0,
        dedent = (ls) => {
            let n = Math.min(...ls.filter((l) => l.trim()).map((l) => /^ */.exec(l)[0].length));
            return ls.map((l) => l.slice(Number.isFinite(n) ? n : 0));
        },
        plain = (ls) => ls.map((l) => l.trim().replace(/^#.*$/, '')).filter(Boolean).join('\n');
    for (let s of secs) {
        let src = `${s.key}:${s.head}\n${s.body.join('\n')}`;
        try {
            let v = parseYaml(src);
            if (isPlainObject(v)) {
                value[s.key] = v[s.key];
                continue;
            }
        } catch {}
        if (!INDEX_LIST_KEYS.has(s.key)) {
            keep.push(`${s.key}：${plain([s.head, ...s.body])}`);
            continue;
        }
        // 列表块：按最外层的「- 」切条，逐条解析。
        let body = dedent(s.body.filter((l) => l.trim() && !/^\s*#/.test(l))),
            items = [],
            list = [];
        for (let l of body) /^- /.test(l) || !items.length ? items.push([l]) : items[items.length - 1].push(l);
        for (let it of items) {
            try {
                let v = parseYaml(it.join('\n'));
                if (Array.isArray(v)) {
                    list.push(...v);
                    continue;
                }
            } catch {}
            (lost++, keep.push(`${s.key}（格式有误，原样保留）：${plain(it)}`));
        }
        value[s.key] = list;
    }
    keep.length && (value.作者资料 = [].concat(value.作者资料 == null ? [] : value.作者资料, keep));
    return { value: secs.length ? value : null, lost };
}

// 整理第 partNo 段（从 0 起）时给模型看的作者索引（用户 2026-11-22：越往后请求越长）。
// 本段和前后各一段读出的事实照原样给；更远的段只留编号、内容、性质（条件引用编号要用），
// 「谁说的」「玩家怎么能知道」那几段已经整理过，不再每段重复。人物、地点、门槛、作者资料不动。
export function importIndexForPart(index, partNo) {
    if (!isPlainObject(index) || !Array.isArray(index.事实)) return index;
    let here = Number(partNo) + 1;
    return {
        ...index,
        事实: index.事实.map((f) =>
            !isPlainObject(f) || !Number.isFinite(Number(f.段)) || Math.abs(Number(f.段) - here) <= 1
                ? f
                : Object.fromEntries(['编号', '内容', '性质', '段'].filter((k) => f[k] != null && f[k] !== '').map((k) => [k, f[k]])),
        ),
    };
}

export function mergeImportIndex(list) {
    let out = { 梗概: [], 人物: [], 地点: [], 事实: [], 门槛: [], 并行: [], 作者资料: [], 待确认: [] },
        people = /* @__PURE__ */ new Map(),
        byName = /* @__PURE__ */ new Map(),
        aliasOwner = /* @__PURE__ */ new Map(),
        places = /* @__PURE__ */ new Set(),
        facts = /* @__PURE__ */ new Map();
    for (let [k, idx] of (list || []).entries()) {
        if (!isPlainObject(idx)) continue;
        // 模型有时把「梗概」「作者资料」写成列表：逐条拼成一段，每条一行（实测：直接 String(数组) 会变成逗号连着的一串）。
        let joinText = (v) =>
            Array.isArray(v)
                ? v
                      .map((x) => clueText(typeof x == 'string' ? x : JSON.stringify(x)))
                      .filter(Boolean)
                      .join('\n')
                : clueText(v);
        idx.梗概 && out.梗概.push(`第${k + 1}段：${joinText(idx.梗概)}`);
        // 人物合并（GPT §20.3）：只按「名称」合并，或者原文明示是同一人（本段把对方的名称列为别名，或用「同一人」字段指明）。
        // 只是共用一个泛称（「维修工」「老板」）不合并；两个人都用同一个别名时，标出来请作者确认。
        for (let p of Array.isArray(idx.人物) ? idx.人物 : []) {
            if (!isPlainObject(p) || !p.名称) continue;
            let name = String(p.名称),
                aliases = (Array.isArray(p.别名) ? p.别名 : []).map(String),
                same = [].concat(p.同一人 || []).map(String);
            let hit = people.get(name) || [...same, ...aliases].map((n) => byName.get(n)).find(Boolean);
            if (hit) {
                for (let [f, v] of Object.entries(p))
                    f === '名称' ||
                        f === '同一人' ||
                        (hit[f] == null || hit[f] === ''
                            ? (hit[f] = v)
                            : f === '别名' && (hit.别名 = [.../* @__PURE__ */ new Set([...(hit.别名 || []), ...(v || [])])]));
                (hit.名称 !== name && (hit.别名 = [.../* @__PURE__ */ new Set([...(hit.别名 || []), name])]), people.set(name, hit));
            } else {
                let entry = { ...p };
                (delete entry.同一人, out.人物.push(entry), people.set(name, entry), byName.set(name, entry));
            }
            for (let a of aliases) {
                let owner = aliasOwner.get(a),
                    me = people.get(name);
                owner && owner !== me
                    ? out.待确认.push(`「${owner.名称}」和「${me.名称}」都被称作「${a}」，按两个人分开记录；如果其实是同一个人，请合并`)
                    : aliasOwner.set(a, me);
            }
        }
        for (let l of Array.isArray(idx.地点) ? idx.地点 : [])
            isPlainObject(l) && l.名称 && !places.has(l.名称) && (places.add(l.名称), out.地点.push(l));
        for (let f of Array.isArray(idx.事实) ? idx.事实 : []) {
            if (!isPlainObject(f) || !f.编号) continue;
            let hit = facts.get(f.编号);
            hit
                ? Object.entries(f).forEach(([kk, v]) => (hit[kk] == null || hit[kk] === '') && (hit[kk] = v))
                : (facts.set(f.编号, { ...f, 段: k + 1 }), out.事实.push(facts.get(f.编号)));
        }
        (out.门槛.push(...(Array.isArray(idx.门槛) ? idx.门槛 : [])),
            out.并行.push(...(Array.isArray(idx.并行) ? idx.并行 : [])),
            idx.作者资料 && out.作者资料.push(`第${k + 1}段：\n${joinText(idx.作者资料)}`));
    }
    // 这份索引是按带「名字保密」字段的提示词整理的（没写这个字段的人 = 不需要保密）。
    return ((out.secretFlag = !0), out);
}

export const IMPORT_AUTHOR_KEYS = ['原文出处', '来源', '待确认', '补写'];

export function importDraftMessages({ part, index, prevTail = '', mode = 'clue', needs = '', actors = '', done = '', kind = '', trpg = !1 }) {
    let clue = mode === 'clue',
        rules = clue ? CLUE_OUTLINE_RULES : OUTLINE_RULES,
        onlyClue = (x) => (clue ? x : '');
    return [
        {
            role: 'system',
            content: [
                '你在把一段剧情材料转写成可以游玩的大纲。只写这一段材料对应的部分；前面几段已经写过的，不要重复。',
                '本段材料里**每一个**玩家要经历的剧情段落（包括开头的日常入口）都要写进大纲，按材料里的先后顺序，不能跳过。材料开头的真相、人物表、写作说明属于作者资料，读完后接着写后面的剧情段落，不要因此跳过本段里的前几个阶段。',
                '同一个调查如果从上一段延续到这一段，接着写在同一个节点里（沿用上一段的节点 id），不要另建。',
                '【已经写出的阶段和节点】列出的阶段：本段材料是在继续其中某个阶段时，用**完全相同的阶段名**写，只写新增或需要补充的节点（插件会按阶段名和节点 id 合并）；不要为同一段剧情另起一个名字不同的阶段。已经写完的阶段不要重复输出。',
                '人物称呼、事实编号一律用【作者索引】里的；索引里没有、确实需要新建的，用新编号并在该节点的「待确认」里说明。',
                '每个节点额外写三个只给作者看的字段（插件会把它们移出正式大纲）：',
                '  原文出处: 材料里对应的原句或小标题（一句话）',
                '  待确认: 拿不准的地方（没有就省略）',
                '  补写: true（只有这个节点不是材料里的、是你为了可玩性加的才写）',
                clue
                    ? '信息放在哪里（GPT §20.3）：'
                    : '信息放在哪里：节点的名称、地点、事件、偏转都会交给正文，只写玩家此时能经历到的事；幕后真相、真名、还没到揭示时机的答案只写在 <仅作者>…</仅作者> 里。世界动态的「来源」写故事里是谁传出的消息，不写原文出处。',
                onlyClue(
                    '  · 入口、地点、场景：只写玩家此时就能看到、知道的东西。入口在节点开放时就会给正文，场景在玩家到场时给正文，都不能含调查结果。',
                ),
                onlyClue(
                    '  · 发现的「内容」：这个节点经过调查当场就能揭示的结果。玩家到场时它会作为「可能的发现」交给正文（标明尚未发生），所以只写本节点当场可以揭示的，不写之后才该知道的。',
                ),
                onlyClue('  · 更远的真相、幕后人物的真名、还没到揭示时机的答案：只写在作者备注的 <仅作者>…</仅作者> 里。'),
                onlyClue('  · 名称、记录、节点和事实编号也会给作者以外的环节看到，同样不要含幕后真名和答案。'),
                onlyClue(
                    '  · 原文写了「怎么取得、当时能看见什么、后来能推到哪里、有没有替代途径」的，按这个分层放：例如照片能看见维修标签（场景或发现），内部结构要实物检验才知道（另一条发现，条件是拿到实物）。',
                ),
                onlyClue(
                    '取得条件和替代路线以原文为准：原文明确写了的才整理成开放条件、「任一」和「必需: false」；原文没写取得条件的节点，开放条件留空；原文没写替代路线就只写一条，不要为了「多一条路」自己编。下面通用规则里「最好有两条获得途径」是从零写大纲时的建议，导入时不适用。节点能不能开放、几条路是否都走得通，由插件按条件检查，你不用推演。',
                ),
                onlyClue(
                    '材料里说「几条线先后不限、任一条完成即可继续」的（比如标题写成「第五阶段 a / 第五阶段 b」），把这几条线的节点放进**同一个阶段**（阶段名写成「阶段5_两条线」这样），各自写「必需: false」，阶段的结束条件用「任一」列出各条线的关键事实。**不要**写成「阶段5a」「阶段5b」两个阶段：阶段是先后进行的，后一个要等前一个结束才开放，两条线就都变成必须的了。',
                ),
                onlyClue(
                    '发现只记**玩家通过行动能拿到的具体信息或实物**（看到的东西、听到的话、读到的记录）。材料里的写作规则和提醒（如「看见发号施令的人不等于知道名字」「只说合作不产生成果」）不是发现，写进 AI指令 或作者备注；能放进条件的写进条件。',
                ),
                onlyClue(
                    '完成条件、开放条件优先用 {事实: 编号}（证词、传闻说出口记为存疑也算满足）；材料明确要求「被证实」时才用 {核实: 编号}；只有材料明确要求「某个角色知道」时才用 {知情 / 核实: 编号@角色}。',
                ),
                onlyClue(
                    '阶段的进入条件只能用**前面阶段**产出的事实；本阶段节点才产出的事实不能写进本阶段的进入条件（否则这个阶段永远进不去）。',
                ),
                onlyClue(
                    '材料写了「没有 X 也可以做 Y」「不经过 X 也能到 Y」「Y 不依赖 X」的，Y 的开放条件和它所在阶段的进入条件都**不能**要求 X；前一阶段的结束条件也要允许不走 X（用「任一」把另一条路写进去，或把 X 所在节点写成「必需: false」）。',
                ),
                onlyClue(
                    '最稳妥的写法：把 X 和 Y 放进**同一个阶段**，X 写「必需: false」，Y 不写开放条件（例：原文说「可以跳过问话，直接去查记录」，就不要写成先后两个阶段，否则第二阶段要等第一阶段的事实，跳过的路走不通）。只有 X 和 Y 之间确实隔着时间或地点的大转场，才分成两个阶段，这时后一阶段的进入条件要留出不走 X 的路。',
                ),
                onlyClue(
                    '「必需」的意思：必需节点没完成，阶段就算满足了结束条件也不会结束。所以材料说某件事「可以不做」「可以跳过」「不经过也能继续」「没有它也行」的，这个节点一定写「必需: false」；只有材料要求必须做到的，才保持必需。',
                ),
                onlyClue(
                    '节点的完成条件写成它自己产出的事实（如 {事实: F_mateo_absent}），**不能**写成 {节点: 自己的 id}：「自己完成了才算完成」永远不会成立。',
                ),
                '要求正文「不要提某人的名字 / 某个真相」时，AI指令和入口里**不能写出那个名字或真相本身**（写出来就已经告诉正文了）。改成「幕后的人此时没有名字，只称『发号施令的人』」这样的写法；具体名字只放在作者备注的 <仅作者> 里，或者等揭示它的那个发现的「内容」里。',
                clue && (kind === 'main' || kind === 'side') ? importLineHeadRule(kind, part) : '',
                actors && `角色对应：${actors}`,
                needs && `作者的要求：${needs}`,
                rules,
                // 跑团模组导入（core/trpg.js）：只在导入任务带 trpg 时追加
                clue && trpg ? TRPG_IMPORT_RULES : '',
            ]
                .filter(Boolean)
                .join('\n'),
        },
        {
            role: 'user',
            content: [
                `【作者索引】\n${index}`,
                done && `【已经写出的阶段和节点】\n${done}`,
                prevTail && `【上一段转写的结尾（衔接用）】\n${prevTail}`,
                `【本段材料：${part.title}】\n${part.text}`,
            ]
                .filter(Boolean)
                .join('\n\n'),
        },
    ];
}

// 导入「一条主线 / 一条支线」（导入审阅总方案 F / H）：整份文档成一条剧情线，卷的第一个键写「线」。
// 编号由插件分配（采用时排在已有的线后面），模型不用写；开始时机照原文抄，原文没写就不写开启条件，由作者在审阅页选。
export function importLineHeadRule(kind, part = null) {
    let main = kind === 'main';
    return [
        `这份文档是**一条${main ? '主线' : '支线'}**：整份文档写成一条剧情线（YAML 里的一卷），它的第一个键写「线」（只在第一段写；后面几段沿用同一个顶层键名，不再写「线」）。`,
        `  线: {类型: ${main ? '主线' : '支线'}, 简介: 一句话（必须写，规则见下）, 入口提示: 一句由头（必须写，规则见下）, 开始时机原文: 文档里写的这条线什么时候、因为什么开始（照抄原句；没写就省略）}`,
        BRIEF_RULE,
        ENTRY_HINT_RULE,
        '  · 不写「编号」，插件会分配。',
        `  · 文档明确写了开始的前提（如「拿到某某之后」「某条线结束后」），再写「开启条件」（用条件写法）；没写就**不要**写开启条件，作者会在审阅页自己选。${main ? '主线默认排在前一条主线后面，不用为此写条件。' : ''}`,
        part && part.i > 0 ? '  · 这一段不是第一段：不要再写「线」。' : '',
    ]
        .filter(Boolean)
        .join('\n');
}

// 导入任务的文档类型（kind）：main（一条主线）/ side（一条支线）/ lines（好几条支线）/ outline（按阶段推进，不分线）。
// 旧任务没有 kind：mode lines → lines；mode outline → outline；mode clue → 旧的「线索推进的大纲」，没有线头（legacy）。
export function importJobKind(job) {
    let k = job && job.kind;
    return k === 'main' || k === 'side' || k === 'lines' || k === 'outline' || k === 'edit' ? k : job && job.mode === 'lines' ? 'lines' : job && job.mode === 'outline' ? 'outline' : 'legacy';
}

// 「按意见修改」的请求（导入审阅总方案 4.3 / GPT 审阅 R4）：一组单位一次请求。
// units：[{ key, kind: 'line' | 'stage', label, yaml, comment, source }]（source：这个单位对应的原文片段，只附这一段）。
// context：组外有关的单位的真实条件表达式和事实来源（只读）。secrets：保密名字（必须改的位置用）。
// 输出格式：每个单位一个代码块，代码块前一行写「【单位：<key>】」，插件按 key 回写，不靠模型照抄名字定位。
// overall：整体意见（用户 2026-11-16：只对当前这条线）——这时 units 里有这条线的所有部分（u.overall 不为 false），
//   别的线上写了意见的部分也可能在里面（u.overall = false，只按它自己的意见改）；只输出真要改的。
// talk：讨论记录（作为参考）；mode：'outline' 时用按阶段推进的规则（不加线索字段）。
export function reviewReviseMessages({ units, context = '', secrets = [], tableCatalog = '', mainLines = '', overall = '', talk = '', mode = 'clue' }) {
    let fence = '```',
        clue = mode !== 'outline';
    return [
        {
            role: 'system',
            content: [
                overall
                    ? '下面是一条剧情线的全部部分（线头和各阶段），可能还有别的线上带意见的部分。【整体意见】只用于标了「整体意见适用」的部分；其他部分只按它自己的意见改。'
                    : '下面是剧情线里的几个部分（线头或阶段），每个部分带一句作者意见。按意见修改这几个部分。',
                `输出：每个部分一个 ${fence}yaml 代码块；**每个代码块的前一行必须单独写一行「【单位：编号】」**（编号照抄下面每个部分开头给的，例如「【单位：v1/s5】」），然后才是代码块。${overall ? '只输出真正改动了的部分，没改的不要输出。' : '只输出列出的部分，别的不要输出。'}`,
                '· 阶段：输出这个阶段（顶层键是阶段名，下面是阶段字段）。线头：输出「线:」下面的字段。',
                '· 只按意见改，没提到的地方原样保留：节点 id、事实编号、条件不要顺手改。还是同一件事的节点必须沿用原来的 id（哪怕改了名称、入口），新加的事才用新 id、新事实编号。',
                '· 意见是在问问题或说明情况时（比如「这里就是揭晓真名的地方」「是同一个人，换成称呼」），按它的意思改；拿不准的保持原样。',
                '· 修条件问题时，按【原文】的意思选改法：比如「补一个产出」和「推迟开放」都能让阶段走通，但剧情含义不同，要看原文怎么写的。原文没写的门槛不要新加，原文写了的门槛不要去掉。',
                talk ? '· 【讨论记录】是作者和 AI 之前的讨论，只作参考：作者在讨论里明确定下的，按它理解意见；还在商量的不算数。意见和讨论冲突时以意见为准。' : '',
                '· 意见指出的问题必须改掉，不能原样交回。常见改法：原文写了「任意一路查到足够材料也可以继续」这类替代路线的，把那条路写进结束条件的「任一」，或者把只在某条路上才需要的节点改成「必需: false」；原文写了必须两样都到手的，就保留门槛，在意见里说明原因（输出时把这个阶段原样给出，并在代码块前一行写「保持原样：原因」）。',
                '· 线头的编号、类型（主线 / 支线）不能改。线头的「简介」「入口提示」是空的，就按下面的规则顺手补上。',
                clue ? `${BRIEF_RULE}\n${ENTRY_HINT_RULE}` : '',
                secrets.length ? `· 保密名字（揭示之前正文不能出现）：${secrets.join('、')}。它们只能写在揭示它的那条发现的「内容」或作者备注的 <仅作者> 里；其他字段用身份称呼代替。` : '',
                clue && tableCatalog && `【当前数据库的表格】\n${tableCatalog}`,
                clue && mainLines && `【已有的主线】\n${mainLines}`,
                // 大纲规则第一句「只输出一个代码块」和上面的按部分输出冲突，去掉
                (clue ? CLUE_OUTLINE_RULES_WITH_LINES : OUTLINE_RULES).split('\n').filter((l) => !/^只输出一个 ```yaml 代码块/.test(l)).join('\n'),
            ]
                .filter(Boolean)
                .join('\n'),
        },
        {
            role: 'user',
            content: [
                overall && `【整体意见】（只对标了「整体意见适用」的部分）\n${overall}`,
                ...units.map((u) =>
                    [
                        `【单位：${u.key}】${u.label}${overall && u.overall !== !1 ? '（整体意见适用）' : ''}`,
                        u.comment ? `意见：${u.comment}` : overall && u.overall !== !1 ? '意见：（这一部分没有单独的意见，只按整体意见改；不需要改就不要输出）' : '',
                        u.source && `【原文】\n${u.source}`,
                        `${fence}yaml\n${u.yaml}\n${fence}`,
                    ]
                        .filter(Boolean)
                        .join('\n'),
                ),
                context && `【相关的其他部分（只读，不要输出）】\n${context}`,
                talk && `【讨论记录】（参考）\n${talk}`,
            ]
                .filter(Boolean)
                .join('\n\n'),
        },
    ];
}
// 拆回复：「【单位：key】」后面紧跟的第一个代码块。返回 { key: 代码块文字 }；没有标记的代码块不认。
// 模型常漏写标记（DeepSeek 实测：两次都只给了代码块）。补救只在不会认错时用：
//   units = [{ key, name }]（name：阶段名或「线」）。只有一个单位时，唯一的代码块就是它；
//   有几个时，按代码块顶层键 = 请求里的阶段名对应（只认这次请求里的名字，对不上的不用）。
//   名字有重复（两条线都有「阶段1_经过」、几个线头都叫「线」）时不猜：同名的块和单位都不补，意见保留（GPT 第二轮 N4）。
export function splitUnitReplies(text, units = []) {
    let out = {},
        t = String(text || ''),
        re = /【单位：([^】\s]+)】[^\n]*\n[\s\S]*?```(?:yaml)?\s*\n([\s\S]*?)```/g,
        m;
    while ((m = re.exec(t))) m[1] in out || (out[m[1]] = m[2]);
    if (!units.length) return out;
    // 有标记的块已经认了；剩下没标记的块（DeepSeek 实测：几个块里漏写其中一个的标记）按阶段名补上
    let blocks = [...t.matchAll(/```(?:yaml)?\s*\n([\s\S]*?)```/g)].map((x) => x[1]).filter((b) => !Object.values(out).includes(b));
    if (units.length === 1 && !Object.keys(out).length && blocks.length === 1) return { [units[0].key]: blocks[0] };
    let topOf = (b) => ((/^([^\s:#][^:\n]*):/m.exec(b) || [])[1] || '').trim(),
        tops = blocks.map(topOf);
    for (let [i, b] of blocks.entries()) {
        let top = tops[i],
            cands = top ? units.filter((u) => u.name === top && !(u.key in out)) : [];
        // 只有一个候选、并且没有别的同名块时才补
        cands.length === 1 && units.filter((u) => u.name === top).length === 1 && tops.filter((t) => t === top).length === 1 && (out[cands[0].key] = b);
    }
    return out;
}

// 模型说明「保持原样：原因」的单位（提示词要求它这样写）：{ 单位键: 原因 }。原因写在标记前一行或标记和代码块之间都认。
export function keepReasons(text) {
    let t = String(text || ''),
        out = {};
    for (let m of t.matchAll(/【单位：([^】\s]+)】/g)) {
        let p = m.index,
            prev = t.lastIndexOf('```', p - 1),
            from = prev < 0 ? 0 : prev + 3,
            next = t.indexOf('```', p),
            win = t.slice(from, next < 0 ? t.length : next),
            r = /保持原样[:：]\s*([^\n]+)/.exec(win);
        r && !(m[1] in out) && (out[m[1]] = r[1].replace(/【单位：[^】]*】/g, '').trim());
    }
    return out;
}

// 读出一个单位的修改结果（模型给的格式不总一样）：
//   阶段：{阶段名: 字段} 最好；包了一层卷名（{卷名: {线, 阶段名: 字段}}，DeepSeek 实测）时，按请求的阶段名取出那一个阶段；
//         都对不上时不认（不把整卷当成一个阶段，免得清空节点）。
//   线头：{线: {...}}、{卷名: {线: {...}}} 或直接字段。
// want：请求时的阶段名（或「线」）；oldNodes：原来的节点数——原来有节点、改完一个都没有的，视为模型给错了格式，不认。
export function parseUnitReply(key, text, want, oldNodes = 0) {
    let v = parseYaml(text);
    if (!isPlainObject(v)) throw new Error('格式不对：应该是「名字: 内容」');
    if (String(key).endsWith('/line')) {
        let l = isPlainObject(v[VOLUME_LINE_KEY]) ? v[VOLUME_LINE_KEY] : Object.values(v).map((x) => isPlainObject(x) && x[VOLUME_LINE_KEY]).find(isPlainObject) || v;
        return { line: l };
    }
    let looks = (x) => isPlainObject(x) && (NODE_FIELDS.some(({ field }) => field in x) || 'AI指令' in x || '进入条件' in x || '结束条件' in x),
        pick = null;
    if (want && looks(v[want])) pick = [want, v[want]];
    else
        for (let [, inner] of Object.entries(v))
            if (isPlainObject(inner) && want && looks(inner[want])) pick = [want, inner[want]];
    if (!pick) {
        let entries = Object.entries(v).filter(([k, x]) => k !== VOLUME_LINE_KEY && looks(x));
        entries.length === 1 && (pick = entries[0]);
    }
    if (!pick) throw new Error('回复里找不到这个阶段');
    let nodes = NODE_FIELDS.reduce((n, { field }) => n + (Array.isArray(pick[1][field]) ? pick[1][field].length : 0), 0);
    if (oldNodes && !nodes) throw new Error('回复里这个阶段一个场景都没有（可能格式给错了），没有采用');
    return { stage: { key: pick[0], data: nodeMapsToLists(pick[1]) } };
}

// 按意见修改时附的原文（GPT 审阅 R4：改条件要看原文依据）。导入记录的是这个节点来自原文的哪一段（起 / 止，一段可能有几千字），
// 整段太长；优先取讲推进、门槛、替代路线的小节（「推进条件」「调查如何继续」「走不通时」「合流」「进入条件」），
// 再补开头，合计不超过 max 字。没有这类小节时取开头。
const SOURCE_KEYS = /推进条件|调查如何继续|如何继续|走不通|合流|进入条件|结束条件|先后不限|任一|任意一/;
export function sourceExcerpt(src, from, to, max = 2400) {
    let text = String(src || '').slice(Math.max(0, from || 0), Math.min(String(src || '').length, to || 0));
    if (text.length <= max) return text;
    let parts = text.split(/\n(?=#{2,4}\s)/),
        head = parts[0],
        keyed = parts.slice(1).filter((p) => SOURCE_KEYS.test(p.split('\n')[0]) || SOURCE_KEYS.test(p.slice(0, 200))),
        out = [];
    let room = max;
    for (let p of keyed) if (p.length <= room) (out.push(p), (room -= p.length + 1));
    let start = head.slice(0, Math.max(0, Math.min(head.length, room)));
    return [start, ...out].filter(Boolean).join('\n…\n');
}

// 问题 → 追加进意见的一句话（「把所有问题填进意见」/「填进意见」）。不覆盖作者原话，同一句不重复加（GPT 审阅 R4 末条）。
// 需要确认的（warn）只填问题的开头，由作者接着写回答，不替作者回答。
// 同一页里原因相同的问题合成一条（目前：几个节点都「一直开不了」）。合并后的条目带 parts（原来的几条），加入意见时一句话说全。
export function mergeSameIssues(list) {
    let out = [],
        groups = new Map();
    for (let x of list || []) {
        let k = x.same && x.level === 'error' ? `${x.same.key}|${x.same.stage}` : '';
        if (!k) {
            out.push(x);
            continue;
        }
        groups.has(k) ? groups.get(k).parts.push(x) : (groups.set(k, { ...x, parts: [x] }), out.push(groups.get(k)));
    }
    return out.map((x) => {
        if (!x.parts || x.parts.length < 2) return x.parts ? x.parts[0] : x;
        let names = x.parts.map((y) => y.same.node);
        return {
            ...x,
            id: x.parts.map((y) => y.id).join('+'),
            plain: `「${x.same.stage}」：下面${names.length}个节点一直开不了（它们的开放条件要的线索，前面拿不到），这几条路走不通。`,
            names,
            fix: '看看它们的开放条件：要的线索是不是写错了，或者前面阶段漏了产出这条线索的地方。',
            text: x.parts.map((y) => y.text).join('\n'),
        };
    });
}
export function issueCommentLine(x) {
    if (x.level === 'error') return `${x.plain || x.text}${x.names ? `：${x.names.map((n) => `「${n}」`).join('、')}` : ''}${x.fix ? `（${x.fix}）` : ''}`;
    return x.kind === 'secret-short' ? `关于${(x.spots && x.spots[0] && `「${x.spots[0].where}」里的`) || ''}「${x.name}」：` : x.kind === 'secret-reveal' ? `关于揭晓「${x.name}」的地方：` : `关于「${(x.plain || x.text).slice(0, 20)}…」：`;
}
export function appendComment(comment, line) {
    let cur = String(comment || ''),
        add = String(line || '').trim();
    return !add || cur.split('\n').some((l) => l.trim() === add || l.trim().startsWith(add)) ? cur : cur.trim() ? `${cur.replace(/\s+$/, '')}\n${add}` : add;
}
// 要确认的问题写成一个问句（审阅页用；不做选项按钮，回答写进意见）。
export function issueQuestion(x) {
    if (x.kind === 'secret-reveal') return { q: `${x.plain.replace(/查到时会揭晓/, '查到时，正文会拿到').replace(/。$/, '这个名字。')}这里就是揭晓真名的地方吗？`, how: '不是的话，在意见里写明在哪里揭晓。' };
    if (x.kind === 'secret-short') return { q: `${x.plain.replace(/。$/, '')}。是同一个人吗？`, how: '' };
    return { q: x.plain || x.text, how: x.fix || '要改的话，在意见里写明。' };
}

export const IMPORT_STAGE_KEYS = [...STAGE_HINT_KEYS, ...CLUE_STAGE_KEYS];

export const IMPORT_NODE_KEYS = ['名称', '地点', '事件', '偏转', '触发', '类型', '来源', '内容', ...CLUE_NODE_KEYS];

export function splitImportAuthorFields(volumes, part = null) {
    let notes = {},
        clean = (volumes || []).map((v) => ({
            ...v,
            stages: v.stages.map((s) => {
                if (!isPlainObject(s.data)) return s;
                let data = Object.fromEntries(Object.entries(s.data).filter(([k]) => IMPORT_STAGE_KEYS.includes(k)));
                for (let { field, kind } of NODE_FIELDS)
                    Array.isArray(data[field]) &&
                        (data[field] = data[field].map((n) => {
                            if (!isPlainObject(n)) return n;
                            // 世界动态本来就有「来源」字段（谁传出的），它不是作者侧出处，留在大纲里。
                            let keep = {},
                                note = {},
                                authorKey = (k) => IMPORT_AUTHOR_KEYS.includes(k) && !(kind === 'world' && k === '来源');
                            for (let [k, v] of Object.entries(n))
                                authorKey(k) ? (note[k] = v) : IMPORT_NODE_KEYS.includes(k) && (keep[k] = v);
                            return (
                                nodeUid(n) &&
                                    (Object.keys(note).length || part) &&
                                    (notes[nodeUid(n)] = {
                                        ...(part ? { 段: part.i + 1, 段标题: part.title, 起: part.start, 止: part.end } : {}),
                                        ...note,
                                    }),
                                keep
                            );
                        }));
                return { ...s, data };
            }),
        }));
    return { volumes: clean, notes };
}

export function importSecretNames(index) {
    let people = index && Array.isArray(index.人物) ? index.人物 : [];
    if (people.length && !(index && index.secretFlag) && !people.some((p) => isPlainObject(p) && '名字保密' in p)) return null;
    let pick = people.filter((p) => isPlainObject(p) && (p.名字保密 === !0 || p.名字保密 === 'true' || p.名字保密 === '是'));
    return [
        ...new Set(
            pick
                .flatMap((p) => [p.名称, ...(Array.isArray(p.别名) ? p.别名 : [])])
                .map((n) => String(n || '').trim())
                .filter((n) => n.length >= 2),
        ),
    ];
}

// 疑似短名（总方案 C / GPT 审阅 R7）：保密全名按「·」「•」、空格拆开的每一段（≥2 字）。只是候选：
// 命中时报「需确认」，不当成确定的泄密；作者确认后才当保密别名用。
// 不收：本来就是全名或别名的；是某个不保密人物的名称 / 别名（或其中一段）的；常见泛称。
export const SECRET_SHORT_STOP = ['先生', '小姐', '女士', '老板', '医生', '博士', '队长', '警官', '老师', '师傅'];
export function importSecretShorts(index, names = importSecretNames(index)) {
    if (!names || !names.length) return [];
    let people = index && Array.isArray(index.人物) ? index.人物.filter(isPlainObject) : [],
        open = people
            .filter((p) => !(p.名字保密 === !0 || p.名字保密 === 'true' || p.名字保密 === '是'))
            .flatMap((p) => [p.名称, ...(Array.isArray(p.别名) ? p.别名 : [])])
            .map((n) => String(n || '').trim())
            .filter(Boolean),
        openParts = new Set(open.flatMap((n) => [n, ...n.split(/[·•\s]+/)])),
        out = new Map();
    for (let full of names)
        for (let part of String(full).split(/[·•\s]+/).map((x) => x.trim()))
            part.length >= 2 && part !== full && !names.includes(part) && !openParts.has(part) && !SECRET_SHORT_STOP.includes(part) && !out.has(part) && out.set(part, full);
    return [...out].map(([short, full]) => ({ short, full }));
}

export function importVisibleText(volumes, mode = 'clue') {
    let out = [],
        stage = '',
        stageId = '',
        put = (layer, where, value, field = '') => {
            let t = clueText(typeof value == 'string' ? value : value == null ? '' : JSON.stringify(value));
            t && out.push({ layer, where, text: t, stage, stageId, field });
        };
    for (let vol of volumes || [])
        for (let st of vol.stages || []) {
            let where = stageLabel(st.key),
                data = isPlainObject(st.data) ? st.data : {};
            ((stage = st.key), (stageId = st.id || ''));
            put('body', where, stripAuthorDeep(String(st.key || '')), '阶段名');
            if (mode !== 'clue') {
                for (let [k, v] of Object.entries(outlineStageData(data))) put('body', where, v, k);
                continue;
            }
            (put('body', where, data.AI指令, 'AI指令'), put('body', where, data.时间范围, '时间范围'));
            for (let { field } of NODE_FIELDS)
                for (let n of Array.isArray(data[field]) ? data[field] : []) {
                    if (!isPlainObject(n)) {
                        put('author', where, n);
                        continue;
                    }
                    let at = `${where}·${clueText(n.名称) || nodeUid(n) || '?'}`,
                        id = nodeUid(n) || clueText(n.名称) || '?';
                    (put('body', at, n.入口, `${id}.入口`), put('body', at, n.地点, `${id}.地点`), put('body', at, n.场景, `${id}.场景`));
                    put('fill', at, nodeUid(n), `${id}.id`);
                    for (let d of Array.isArray(n.发现) ? n.发现 : n.发现 ? [n.发现] : [])
                        isPlainObject(d)
                            ? (put('reveal', at, d.内容, `${id}.发现[${d.事实 || '?'}].内容`),
                              put('fill', at, d.记录, `${id}.发现[${d.事实 || '?'}].记录`),
                              put('fill', at, d.事实, `${id}.发现[${d.事实 || '?'}].事实`))
                            : put('reveal', at, d, `${id}.发现`);
                }
        }
    return out;
}

export function importIndexMissing(idx) {
    let miss = [];
    isPlainObject(idx) || miss.push('整个索引');
    isPlainObject(idx) && !(Array.isArray(idx.事实) && idx.事实.some((f) => isPlainObject(f) && f.编号)) && miss.push('事实');
    return miss;
}

export function importIndexRetryMessages(base, reply, missing) {
    return [
        ...base,
        { role: 'assistant', content: String(reply || '') },
        {
            role: 'user',
            content: `上面的索引缺少「${missing.join('、')}」。材料里玩家能通过行动查到、听到、看到的关键信息都要列进「事实」（每条一个编号）。请补上，输出完整的索引（同样只输出这一个代码块）。`,
        },
    ];
}

export const IMPORT_LAYER_TEXT = {
    body: '正文每楼都可能看到的字段（阶段名、AI指令、入口、地点、场景）',
    fill: '填表模型看到的字段（编号、记录）',
    reveal: '到场就交给正文的「可能的发现」',
};

export function checkImportDraft(volumes, { index = null, secrets = null, mode = 'clue', shortsSure = [], shortsNot = [] } = {}) {
    let out = [],
        clue = mode === 'clue',
        compiled = clue ? compileClue(volumes || []) : { errors: [] };
    out.push(...compiled.errors.map((t) => ({ level: 'error', text: t })));
    // 秘密名字：按运行时可见层检查。正文层、填表层出现就报错；「可能的发现」里出现提醒作者确认它确实是这个节点当场揭示的。
    // shortsSure：作者在审阅页点了「是同一人」的短名，当作保密名字检查（会报成要改的问题）；shortsNot：点了「不是」的，不再提示
    let base = secrets || importSecretNames(index),
        names = base && [...new Set([...base, ...shortsSure])],
        fullsOf = new Map(shortsSure.map((sh) => [sh, (base || []).filter((f) => f !== sh && f.includes(sh))])),
        bare = (sh, t) => (fullsOf.get(sh) || []).reduce((acc, f) => acc.split(f).join(''), t),
        hits = /* @__PURE__ */ new Map();
    names ||
        ((names = []),
        out.push({
            level: 'warn',
            text: '这次导入的作者索引没有标出哪些名字需要保密（旧版本整理的），没有做名字保密检查。请自己看一下阶段名、AI指令、入口、场景里有没有不该出现的名字',
        }));
    for (let x of importVisibleText(volumes, mode)) {
        if (x.layer === 'author') continue;
        for (let s of names)
            s &&
                s.length >= 2 &&
                // 确认过的短名：先去掉包含它的全名再找，只有单独出现才算。同一处写了全名，全名那条已经报过；
                // 别的地方单独写了短名（比如更早的阶段），照样报（GPT 第六轮 R4）
                bare(s, x.text).includes(s) &&
                hits.set(`${x.layer}|${s}`, [...(hits.get(`${x.layer}|${s}`) || []), x]);
    }
    // 同一个名字出现在几个阶段：每个阶段各报一条（每条落在自己那一页，按意见修改时各阶段都收到意见）。
    for (let [k, all] of hits)
        for (let w of [...new Set(all.map((x) => x.stageId))].map((id) => all.filter((x) => x.stageId === id))) {
        let [layer, s] = k.split('|'),
            list = [...new Set(w.map((x) => x.where))].join('、');
        layer === 'reveal'
            ? out.push({
                  level: 'warn',
                  kind: 'secret-reveal',
                  name: s,
                  stageId: w[0].stageId,
                  spots: w.map(spotOf),
                  text: `保密的名字「${s}」写在「可能的发现」里（${list}）：玩家到场时正文就会拿到它（标明尚未发生）。确认这是这个节点当场就能揭示的；不是的话移到作者备注的 <仅作者> 里`,
                  plain: `${[...new Set(w.map((x) => `「${x.where}」`))].join('、')}查到时会揭晓「${s}」。`,
                  fix: '如果这里就是揭晓这个名字的地方，不用改；如果不是，把名字换成身份称呼，比如「店主」「那名技术员」。',
              })
            : out.push({
                  level: 'error',
                  kind: layer === 'fill' ? 'secret-fill' : 'secret-body',
                  name: s,
                  stageId: w[0].stageId,
                  spots: w.map(spotOf),
                  text: `保密的名字「${s}」出现在${IMPORT_LAYER_TEXT[layer]}里（${list}）；只能写在揭示它的那个发现的「内容」或作者备注的 <仅作者> 里`,
                  plain:
                      layer === 'fill'
                          ? `${placeText(w)}写了「${s}」：填表的模型会看到这个名字，可能提前把它记进表格。`
                          : `${placeText(w)}写了「${s}」：正文每一轮都会看到这个名字，玩家还没查到就泄露了。`,
                  fix: `把「${s}」换成不点名的身份称呼，比如「店主」「那名技术员」。名字只留在揭晓它的那条发现的内容里。`,
              });
        }
    let shorts = secrets ? [] : importSecretShorts(index, base).filter((x) => !shortsSure.includes(x.short) && !shortsNot.includes(x.short)),
        shortHits = new Map();
    for (let x of importVisibleText(volumes, mode)) {
        if (x.layer !== 'body' && x.layer !== 'fill') continue;
        for (let { short, full } of shorts)
            x.text.includes(short) && !x.text.includes(full) && shortHits.set(short, [...(shortHits.get(short) || []), { ...x, full }]);
    }
    for (let [short, w] of shortHits)
        out.push({
            level: 'warn',
            kind: 'secret-short',
            name: short,
            full: w[0].full,
            stageId: w[0].stageId,
            spots: w.map(spotOf),
            text: `疑似保密名字「${short}」（「${w[0].full}」的一部分）出现在${[...new Set(w.map((x) => IMPORT_LAYER_TEXT[x.layer]))].join('、')}里（${[...new Set(w.map((x) => x.where))].join('、')}）`,
            plain: `${placeText(w)}出现了「${short}」，它可能就是保密的「${w[0].full}」。`,
            fix: `是同一个人的话，按保密名字处理，换成称呼；只是碰巧同字，比如别的人物、普通词，就不用改。`,
        });
    // 作者侧字段残留：只查主线、支线节点（世界动态的「来源」是正常字段）。
    let left = /* @__PURE__ */ new Set();
    for (let vol of volumes || [])
        for (let st of vol.stages || [])
            for (let { field, kind } of NODE_FIELDS)
                if (kind !== 'world')
                    for (let n of Array.isArray(st.data && st.data[field]) ? st.data[field] : [])
                        isPlainObject(n) && IMPORT_AUTHOR_KEYS.forEach((k) => k in n && left.add(k));
    for (let k of left) out.push({ level: 'error', text: `正式模组里还留着只给作者看的字段「${k}」` });
    if (!clue) return out;
    // 并行线被写成先后两个阶段（实测常见：「阶段5a」「阶段5b」）：阶段按顺序进行，两条线都成了必须的。
    let units = flattenUnits(volumes || []);
    for (let k = 1; k < units.length; k++) {
        let a = /^阶段\s*(\d+)\s*([a-zA-Z])/.exec(units[k - 1].stage.key),
            b = /^阶段\s*(\d+)\s*([a-zA-Z])/.exec(units[k].stage.key);
        a &&
            b &&
            a[1] === b[1] &&
            out.push({
                level: 'error',
                text: `「${stageLabel(units[k - 1].stage.key)}」和「${stageLabel(units[k].stage.key)}」看起来是并行的几条线，却写成了先后两个阶段：后一个要等前一个结束才开放，两条线都变成了必须走的。应合成一个阶段，各条线的节点写「必需: false」，结束条件用「任一」`,
            });
    }
    out.push(...importReachIssues(volumes || []));
    return out;
}

// ---- 问题的人话（总方案 A）：事实编号换成内容、节点编号换成名称；原来的 text 保留，界面放进「详细」里。----
const shortText = (t, n = 20) => {
    let x = String(t || '').trim().replace(/[。；，、.!！]+$/, '');
    return x.length > n ? `${x.slice(0, n)}…` : x;
};
function factTexts(volumes) {
    let out = new Map();
    for (let u of flattenUnits(volumes || []))
        for (let n of stageNodes(u.stage.data))
            for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) d.fact && !out.has(d.fact) && out.set(d.fact, d.text);
    return out;
}
// 「阶段7 收尾」的AI指令、入口 —— 字段名去掉节点编号和发现编号。
function placeText(spots) {
    let byStage = new Map();
    for (let x of spots) {
        let f = String(x.field || ''),
            what = /^(AI指令|阶段名|时间范围)$/.test(f) ? f : FIELD_WORDS[f.replace(/^[^.]+\./, '').replace(/\[[^\]]*\]/g, '')] || f;
        byStage.set(x.where, [...new Set([...(byStage.get(x.where) || []), what])]);
    }
    return [...byStage].map(([w, fs]) => `「${w}」的${fs.join('、')}`).join('，');
}
const FIELD_WORDS = { 入口: '入口', 地点: '地点', 场景: '场景', id: '编号', 发现: '发现', '发现.内容': '发现', '发现.记录': '登记标准（记录）', '发现.事实': '事实编号', 主线节点: '剧情节点', 支线事件: '可选事件', 世界动态: '世界动态' };
function spotOf(x) {
    return { stageId: x.stageId, where: x.where, field: x.field, excerpt: shortText(x.text, 60) };
}
function routePlain(r, facts) {
    let path = r.nodeNames.map((n) => `「${n}」`).join('、然后'),
        need = r.needs.map((f) => `「${shortText(facts.get(f) || f)}」`).join('或');
    // 这条路的起点自己就开不了（开放条件要的线索前面拿不到）：先说这个，比「拿不到结束的线索」更准
    if (!r.gets.length && r.at !== 'next')
        return {
            plain: `「${r.stage}」：「${r.nodeNames[0]}」一直开不了（它的开放条件要的线索，前面拿不到），这条路走不通。`,
            fix: '看看它的开放条件：要的线索是不是写错了，或者前面阶段漏了产出这条线索的地方。',
            // 同一阶段里几个节点都因为这个原因开不了：界面合成一张卡（GPT 界面审阅第 9 条）
            same: { key: 'open-never', stage: r.stage, node: r.nodeNames[0] },
        };
    if (r.at === 'next')
        return {
            plain: `「${r.stage}」：玩家只做${path}的话，这一阶段能结束，但下一阶段进不去${need ? `，下一阶段要${need}` : ''}。`,
            fix: '让下一阶段的进入条件也认这条路拿到的线索（用「任一」），或者让这条路也能拿到下一阶段要的线索。',
        };
    if (r.at === 'required')
        return {
            plain: `「${r.stage}」：玩家只做${path}的话，还有必须完成的「${r.left.join('、')}」做不了，这一阶段结束不了。`,
            fix: '看看那个必须完成的节点什么时候开放；如果它其实是可选的，改成「必需: false」。',
        };
    return {
        plain: `「${r.stage}」：玩家只做${path}的话，拿不到${need || '结束这一阶段要的线索'}，这一阶段结束不了。`,
        fix: '让这个节点也产出能结束本阶段的线索；或者改成做完别的节点之后才开放它，这样它就不算单独的一条路。选哪种看原文的意思。',
    };
}

// 大纲页「检查」用的线索结构检查（导入审阅总方案第 2 条剩余项）：和导入审阅同一套人话问题。
//   编译错误、条件里拿不到的事实 / 不存在的节点和线、走不通的地方、替代途径；
//   保密名字：项目存过名单（导入时的作者索引）才查，没有名单不报「没做保密检查」（项目里的线多半不是导入的）。
// 每条带 stageId / volumeId，界面用来跳到那个阶段。
export function projectClueIssues(volumes, { secrets = null, knownFacts = [], claimedFacts = [] } = {}) {
    let out = [],
        units = flattenUnits(volumes || []),
        // 文字里提到的阶段（阶段名、阶段 key 或节点 id），用来跳转；长的先比，免得「阶段1」吃掉「阶段12」
        marks = units
            .flatMap((u) => [stageLabel(u.stage.key), u.stage.key, ...stageNodes(u.stage.data).map((n) => nodeUid(n.item)).filter(Boolean)].map((t) => [t, u.stage.id]))
            .sort((a, b) => b[0].length - a[0].length),
        hint = (text) => (marks.find(([t]) => t && text.includes(t)) || [])[1] || '';
    for (let t of compileClue(volumes || []).errors) out.push({ level: 'error', kind: 'compile', text: t, plain: t, stageId: hint(t) });
    let list = checkClueDraft(volumes || [], [], { obtainedFacts: knownFacts, claimedFacts }).filter((t) => !/^这些(主线|剧情)节点没有/.test(t));
    for (let t of list)
        out.some((x) => x.text === t) ||
            out.push({
                level: /没有任何节点产出|不存在的节点|不存在的线|会一直开不了|编号和已有的线重复/.test(t) ? 'error' : 'warn',
                kind: 'struct',
                text: t,
                plain: t,
                stageId: hint(t),
            });
    if (secrets && secrets.length)
        out.push(...checkImportDraft(volumes || [], { secrets, mode: 'clue' }).filter((x) => /^secret-/.test(x.kind || '')));
    out.push(...importReachIssues(volumes || [], { knownFacts, claimedFacts }));
    return out;
}

export function importReachIssues(applied, { only = null, knownFacts = [], claimedFacts = [] } = {}) {
    let out = [],
        mine = (x) => !only || only.has(x.stage);
    let facts = factTexts(applied);
    for (let r of clueAlternativeRoutes(applied, { knownFacts, claimedFacts })) {
        if (!mine(r)) continue;
        let base = { kind: 'route', lineId: r.lineId, volumeId: r.volumeId, stageId: r.stageId, nodeIds: r.nodeIds, at: r.at, nextStageId: r.nextStageId };
        r.verdict === 'blocked'
            ? out.push({
                  ...base,
                  level: 'error',
                  text: `替代途径走不通：${r.stage}·${r.node}单独走完时，${r.why}。常见原因：这条线产出的事实不在阶段结束条件 / 下一阶段进入条件的「任一」里`,
                  ...routePlain(r, facts),
              })
            : r.verdict === 'unknown' &&
              out.push({
                  ...base,
                  level: 'warn',
                  text: `替代途径要到运行时才能确认：${r.stage}·${r.node}单独走完时，${r.why}`,
                  plain: `「${r.stage}」：玩家只走${r.nodeNames.map((n) => `「${n}」`).join('、然后')}时能不能继续，要看游戏里表格、时间这些情况。`,
                  fix: '这条路能不能继续取决于表格里的值或谁知道什么；看看这一阶段的结束条件引用的格子是不是会有值。',
              });
    }
    // 推演第一遍：钟点和「情况」都当作还没到（玩家走得慢，线索都拿到了）。只靠「到点就放行」才走得通的地方不报：
    // 钟点已到时就不再卡住的，交给第二遍（被跳过的阶段拿不到发现，在 importFlowIssues 里）。
    let late = clueReachability(applied, { knownFacts, claimedFacts, clock: 'reached' }),
        stuckLate = new Set([...late.stuckStages.map((x) => `s${x.stageId}`), ...late.stuckNodes.map((x) => `n${x.node}`)]),
        clocky = (x) => !stuckLate.has(x.node ? `n${x.node}` : `s${x.stageId}`),
        reach = clueReachability(applied, { knownFacts, claimedFacts, clock: 'early' }),
        all = [...reach.stuckStages, ...reach.stuckNodes].filter(mine).filter((x) => !clocky(x)),
        routed = new Set(out.filter((x) => x.kind === 'route' && x.level === 'error').map((x) => x.stageId)),
        follow = (x) => /上一阶段尚未结束|阶段未进入/.test(x.why),
        stuck = all.filter((x) => !follow(x) && !(routed.has(x.stageId) && !x.node && /^结束条件不满足|^必需节点做不完/.test(x.why))),
        after = all.filter(follow).length;
    !stuck.length && all.length && !routed.size && (stuck = all);
    stuck.length &&
        reach.verdict === 'blocked' &&
        out.push({
            level: 'error',
            kind: 'reach',
            stageIds: [...new Set(stuck.map((x) => x.stageId).filter(Boolean))],
            plain: `按现在的条件推下去，有地方永远走不到：${stuck
                .slice(0, 4)
                .map((x) => `「${x.stage}${x.node ? `·${x.nodeName || x.node}` : ''}」`)
                .join('、')}${after ? `，以及后面${after}处因此走不到` : ''}。`,
            fix: '看看这些地方的进入条件或开放条件：要的线索是不是前面根本拿不到。',
            text: `按模组推演走不通：${stuck
                .slice(0, 6)
                .map((x) => `${x.stage}${x.node ? `·${x.node}` : ''}（${x.why}）`)
                .join('；')}`,
        });
    stuck.length &&
        reach.verdict === 'unknown' &&
        out.push({
            level: 'warn',
            kind: 'reach-unknown',
            stageIds: [...new Set(stuck.map((x) => x.stageId).filter(Boolean))],
            plain: `有些地方能不能走到，要看游戏里谁知道什么或表格里的值，导入时判断不了：${stuck
                .slice(0, 4)
                .map((x) => `「${x.stage}」`)
                .join('、')}。`,
            fix: '看看这些地方的条件引用的表格格子、知情记录是不是真的会出现；确实卡住时可以在执行页手动开放。',
            text: `有些地方取决于知情或表格的值：${stuck
                .slice(0, 4)
                .map((x) => `${x.stage}${x.node ? `·${x.node}` : ''}`)
                .join('、')}`,
        });
    // 推演第二遍：阶段衔接、跨阶段卡死（带一键修）
    out.push(...importFlowIssues(applied).filter(mine));
    return out;
}

export function importDoneText(volumes) {
    return flattenUnits(volumes || [])
        .map(
            (u) =>
                `${u.stage.key}：${
                    stageNodes(u.stage.data)
                        .map((n) => `${nodeUid(n.item) || '?'} ${n.name}`)
                        .join('、') || '（无节点）'
                }`,
        )
        .join('\n');
}

// rewrite：跨段时后面的段把前面已经写过的线头、阶段、节点又写了一遍（实测 2026-11-17：S07、S15 列出 35～45 条
// 「两段写得不一样」，还造出重复节点 id）。true 时前一段为准、空的才补、不列冲突；新阶段、新节点、新发现照常加。
// 「多条支线」按线合并时用 true，被略过的条数记在结果的 skipped 上，由调用方合成一句提示；
// 「一条主线 / 一条支线」导入仍用默认 false（逐条列出冲突），实测这类导入几乎没有重写。
export function mergeImportParts(vols, { rewrite = !1 } = {}) {
    let stages = [],
        conflicts = [],
        seen = /* @__PURE__ */ new Set(),
        skipped = 0,
        asList = (x) => (Array.isArray(x) ? x : isPlainObject(x) ? [x] : []),
        same = (a, b) => JSON.stringify(a) === JSON.stringify(b),
        empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length),
        mergeFields = (into, from, skip, where) => {
            for (let [k, v] of Object.entries(from))
                skip.includes(k) ||
                    empty(v) ||
                    (empty(into[k]) ? (into[k] = v) : same(into[k], v) || (rewrite ? skipped++ : conflicts.push({ ...where, field: k, kept: into[k], other: v })));
        },
        mergeNode = (a, b, where) => {
            let finds = asList(a.发现);
            for (let d of asList(b.发现)) {
                let f = isPlainObject(d) ? d.事实 : '',
                    k = f ? finds.findIndex((x) => isPlainObject(x) && x.事实 === f) : finds.findIndex((x) => same(x, d));
                k < 0
                    ? finds.push(d)
                    : isPlainObject(d) && isPlainObject(finds[k]) && mergeFields(finds[k], d, ['事实'], { ...where, field: `发现 ${f}` });
            }
            return (finds.length && (a.发现 = finds), mergeFields(a, b, ['id', '发现'], where), a);
        };
    // 已经出现过的节点 id（任何阶段）。跨段重写时，同一个节点出现在后一段的另一个阶段：
    // 新增的发现、原来空着的字段合进原来的节点（GPT 第五轮 C2：整个丢掉会连新发现一起丢），再去掉这个重复的位置；原来的位置不变。
    let idsOf = (st) => NODE_FIELDS.flatMap(({ field }) => asList(st.data && st.data[field]).map((n) => (isPlainObject(n) ? n.id : '')).filter(Boolean)),
        findNode = (id) => {
            for (let x of stages)
                for (let { field } of NODE_FIELDS) {
                    let n = asList(x.data && x.data[field]).find((m) => isPlainObject(m) && m.id === id);
                    if (n) return { node: n, stage: x };
                }
            return null;
        },
        foldMoved = (st, own) => {
            if (!rewrite || !isPlainObject(st.data)) return st;
            let data = { ...st.data };
            for (let { field } of NODE_FIELDS)
                Array.isArray(data[field]) &&
                    (data[field] = data[field].filter((n) => {
                        if (!(isPlainObject(n) && n.id && seen.has(n.id) && !own.has(n.id))) return !0;
                        let at = findNode(n.id);
                        return at ? (mergeNode(at.node, n, { stage: stageLabel(at.stage.key), node: n.id }), skipped++, !1) : !0;
                    }));
            return { ...st, data };
        };
    for (let v of vols || [])
        for (let st0 of v.stages || []) {
            let hit0 = stages.find((x) => x.key === st0.key),
                st = foldMoved(JSON.parse(JSON.stringify(st0)), new Set(hit0 ? idsOf(hit0) : [])),
                hit = hit0;
            if (!hit) {
                // 后一段重写的阶段：节点都是前面已有的（已合回原处），别的也只有重写的阶段字段时，整个阶段不加。
                // 还剩新内容（新节点、无 id 的世界动态）就加。阶段指令等字段是对这些重复节点的重写，不单独算。
                let fresh = NODE_FIELDS.some(({ field }) => asList(st.data && st.data[field]).length > 0);
                if (rewrite && idsOf(st0).length && !fresh) continue;
                (stages.push(st), idsOf(st).forEach((id) => seen.add(id)));
                continue;
            }
            let where = { stage: stageLabel(st.key) },
                nodeKeys = NODE_FIELDS.map((f) => f.field);
            isPlainObject(st.data) && isPlainObject(hit.data) && mergeFields(hit.data, st.data, nodeKeys, where);
            for (let { field } of NODE_FIELDS)
                for (let n of asList(st.data && st.data[field])) {
                    let list = Array.isArray(hit.data[field]) ? hit.data[field] : (hit.data[field] = asList(hit.data[field])),
                        k = list.findIndex((x) => isPlainObject(x) && isPlainObject(n) && x.id && x.id === n.id);
                    k >= 0 ? mergeNode(list[k], n, { ...where, node: n.id }) : (list.push(n), isPlainObject(n) && n.id && seen.add(n.id));
                }
        }
    let lineIds = [...new Set((vols || []).map((v) => (isPlainObject(v.line) ? String(v.line.编号 || '').trim() : '')).filter(Boolean))];
    lineIds.length > 1 &&
        conflicts.push({ stage: '（整份草稿）', field: '线', kept: lineIds[0], other: lineIds.slice(1).join('、'), lines: lineIds });
    let first = vols && vols.length ? vols[0] : null,
        keepLine = (vols || []).map((v) => v.line).find((l) => isPlainObject(l)),
        out = first ? [{ ...first, ...(keepLine ? { line: keepLine } : {}), stages }] : [];
    return Object.defineProperties(out, { conflicts: { value: conflicts, enumerable: !1 }, skipped: { value: skipped, enumerable: !1 } });
}

export function importConflictText(c) {
    if (c.rewrite) return `线${c.line}跨了几段，后面的段把前面已经写过的内容又写了一遍（${c.rewrite}处），以前一段为准，后面只补了新的阶段和场景。需要的话在审阅页对照原文改`;
    if (c.lines)
        return `草稿里写了好几条剧情线（${c.lines.join('、')}），长文导入暂时只能合成一条：保留了「${c.lines[0]}」，其余几条的阶段并进了这一条，它们的线编号和开启条件没有保留。要分开成几条线，采用后在模组页让AI另写新的剧情线`;
    let s = (v) => (typeof v == 'string' ? v : JSON.stringify(v)).slice(0, 80);
    return `${c.stage}${c.node ? `·${c.node}` : ''}的「${c.field}」两段写得不一样：保留了前一段的「${s(c.kept)}」，后一段是「${s(c.other)}」。需要的话在采用后手动改`;
}

export const IMPORT_NEEDS_EXAMPLE =
    '这是我写的剧情方案，开头的真相和人物表只给我自己看，不要放进剧情。调查部分想细一点玩，打斗和赶路带过就行。中间有两条调查线不分先后，走哪条都能继续。原作的反转保留，其他细节可以为了好玩改动。';

export const IMPORT_LINE_INDEX = [
    '支线:   # 这份文档里的每一条支线，按文档顺序。编号从 S01 起，整份文档统一（后面几段沿用前面已经编好的编号）',
    '  - {编号: S01, 名称: 支线的短标题, 主要人物: [..], 开启条件原文: 文档里写的开启时机或前提（没写就省略）, 关系: 和其他支线的关系原文（如「默认在 8 之后」，没写就省略）, 文档里的序号: 文档自己的编号（如「8」）, 本段有经过: 本段材料里有这条支线的具体经过写 true；只在总览表、目录里提到写 false}',
].join(`
`);

export function importLineIndexMessages(base) {
    return [
        {
            role: 'system',
            content: `${base[0].content.replace(
                /```yaml\n/,
                `\`\`\`yaml
${IMPORT_LINE_INDEX}
`,
            )}
这份文档是好几条各自独立成线的支线，不要合并成一条连续的剧情。先在「支线」里列出本段出现的每一条支线（一条支线被切成两段时，后一段沿用前一段的编号，不要另建）。
每条支线有没有开启前提，逐条照原文抄进「开启条件原文」「关系」：「各自成线」不等于「没有前提」，原文写了「默认在 8 之后」就照抄；原文明说「独立」也照抄「独立」；原文没写就省略。`,
        },
        base[1],
    ];
}

export function mergeLineIdentity(list) {
    let here = (l) => !(l.本段有经过 === !1 || l.本段有经过 === 'false' || l.本段有经过 === '否'),
        out = [],
        byId = /* @__PURE__ */ new Map(),
        byNo = /* @__PURE__ */ new Map(),
        notes = [];
    for (let [k, idx] of (list || []).entries())
        for (let l of isPlainObject(idx) && Array.isArray(idx.支线) ? idx.支线 : []) {
            if (!isPlainObject(l) || !l.编号) continue;
            let id = String(l.编号).trim(),
                hit = byId.get(id),
                no = String(l.文档里的序号 ?? '').trim();
            if (hit) {
                for (let [kk, v] of Object.entries(l)) (hit[kk] == null || hit[kk] === '') && (hit[kk] = v);
                here(l) && !hit.parts.includes(k) && hit.parts.push(k);
                continue;
            }
            let entry = { ...l, 编号: id, parts: here(l) ? [k] : [] };
            (out.push(entry),
                byId.set(id, entry),
                no && byNo.has(no) && byNo.get(no) !== id
                    ? notes.push(`文档里第${no}条支线被编了两个编号（${byNo.get(no)}、${id}），请确认是不是同一条`)
                    : no && byNo.set(no, id));
        }
    for (let l of out)
        l.parts.length ||
            (l.parts = (list || [])
                .map((idx, k) =>
                    isPlainObject(idx) &&
                    Array.isArray(idx.支线) &&
                    idx.支线.some((x) => isPlainObject(x) && String(x.编号 || '').trim() === l.编号)
                        ? k
                        : -1,
                )
                .filter((k) => k >= 0));
    return { lines: out, notes };
}

export function importLineTable(lines) {
    return (lines || []).map(
        (l) =>
            `- ${l.编号}「${clueText(l.名称)}」${l.文档里的序号 ? `（文档第 ${l.文档里的序号} 条）` : ''}${l.主要人物 ? ` 人物：${[].concat(l.主要人物).join('、')}` : ''}${l.开启条件原文 ? ` 开启：${clueText(l.开启条件原文)}` : ''}${l.关系 ? ` 关系：${clueText(l.关系)}` : ''}`,
    ).join(`
`);
}

export const IMPORT_LINES_PER_CALL = 3;

export function importLineBatches(lines, partNo) {
    let mine = (lines || []).filter((l) => !Array.isArray(l.parts) || l.parts.includes(partNo)).map((l) => l.编号),
        out = [];
    for (let i = 0; i < mine.length; i += IMPORT_LINES_PER_CALL) out.push(mine.slice(i, i + IMPORT_LINES_PER_CALL));
    return out;
}

export function importLineDraftMessages({
    part,
    index,
    lines,
    only = [],
    mainLines = '',
    tableCatalog = '',
    prevTail = '',
    needs = '',
    done = '',
}) {
    let base = importDraftMessages({ part, index, prevTail, mode: 'clue', needs, done }),
        sys = `${base[0].content}
${CLUE_LINE_RULES.join(`
`)}
· 上面说的「只引用有节点产出的事实编号」，线的开启条件例外：它里面的事实可以不需要节点产出。
这份材料是好几条各自独立成线的支线：
· 本段里的**每一条**支线写成单独的一条剧情线（YAML 里单独一卷），它的第一个键写「线」，类型写「支线」，编号**必须**用【线身份表】里的编号；顶层键写「剧情_编号_标题」。不要把两条支线写进同一卷，也不要写主线。
· 一条支线从上一段延续过来时（【已经写出的阶段和节点】里已经有它），用同一个编号、同一个卷名，只写新增的阶段或节点；「线」下面只写编号和类型，简介、入口提示、开启条件、原开启条件前面已经写过，不要重写。
· 每条支线的事实编号、节点 id 带上这条支线的编号（如 F_s03_poster、s03_cinema），免得不同支线撞号。
· 开启条件和开启时段只照【线身份表】里这条线自己的「开启」「关系」写，每条分开判断，不要照抄同一次写的别的线。三种情况：
  - 写的是「独立」或什么都没写：不写开启条件，也不写开启时段。邀请、碰面这类由头写成第一个节点的入口，不要编成「收到邀请」的事实条件。
  - 写的是「默认在 8 之后」：只写 {线: 文档第 8 条对应的编号 == 完成}，不要再加别的事实或门槛。写的是主线某一步之后：写开启时段或 {线: 主线编号 == …}。
  - 写的是表格和事件都表达不准的经历（「至少与三名队员有单独往来后」）：写「开启方式: 人工」，原话放进「原开启条件」。
· 篇幅默认每条 1～2 个阶段、每个阶段 1～3 个节点，作者备注只写要点；原文里必要的结果和依赖不要为了篇幅删掉。${
            only.length
                ? `
· 这一次**只写** ${only.join('、')} 这几条（本段里别的支线另外再写），每一条都要写。`
                : ''
        }`,
        mine = (lines || []).filter((l) => only.includes(l.编号)),
        said = (l) => [clueText(l.开启条件原文), clueText(l.关系)].filter(Boolean).join('；'),
        gate = mine.length
            ? `【这一次要写的线：文档对开启的说法】
${mine.map((l) => `- ${l.编号}：${said(l) || '（文档没写）'}`).join(`
`)}
照这里写开启条件：说法是「独立」或没写的，不写开启条件、不写开启时段，也不要加主线的条件；写了「在 N 之后」的，只等文档第 N 条对应的那条线；别的说法照原意写，写不准就人工。`
            : '',
        user = [
            `【线身份表（整份文档统一的支线编号，只能用这些）】
${importLineTable(lines)}`,
            mainLines &&
                `【项目里已有的主线（只有文档明确提到主线时才引用）】
${mainLines}`,
            tableCatalog,
            base[1].content,
            gate,
        ].filter(Boolean).join(`

`);
    return [
        { role: 'system', content: sys },
        { role: 'user', content: user },
    ];
}

// 「好几条支线」导入：同一批里两条线出现同一段内容（DeepSeek 实测：S07 名下是 S02 的整个阶段，四个节点 id 都重复）。
// 只报事实，不猜谁抄了谁：写出两边的线和阶段，由作者决定重新整理哪一条（GPT 代码审阅第 2 点）。
// 同一段 = 两个阶段共有节点 id，或阶段名和节点名完全一样。返回 [{ a: {id, stage}, b: {id, stage}, nodes: [id…], text }]。
export function importLineDuplicates(vols) {
    let idOf = (v) => (isPlainObject(v.line) ? String(v.line.编号 || '').trim() : ''),
        units = (vols || []).flatMap((v) =>
            (v.stages || []).map((s) => {
                let ns = stageNodes(s.data);
                return { id: idOf(v), stage: stageLabel(s.key), uids: ns.map((n) => nodeUid(n.item)).filter(Boolean), names: ns.map((n) => n.name).join('|'), key: s.key };
            }),
        ),
        out = [];
    for (let i = 0; i < units.length; i++)
        for (let j = i + 1; j < units.length; j++) {
            let a = units[i],
                b = units[j];
            if (!a.id || !b.id || a.id === b.id) continue;
            let shared = a.uids.filter((u) => b.uids.includes(u)),
                sameText = a.key === b.key && a.names && a.names === b.names;
            (shared.length || sameText) &&
                out.push({
                    a: { id: a.id, stage: a.stage },
                    b: { id: b.id, stage: b.stage },
                    nodes: shared,
                    text: `这段内容同时出现在${a.id}「${a.stage}」和${b.id}「${b.stage}」${shared.length ? `（重复的节点：${shared.slice(0, 4).join('、')}${shared.length > 4 ? '……' : ''}）` : ''}，请核对归属。可能是整理时放错了线，可以重新整理其中一条。`,
                });
        }
    return out;
}

export function importLineIssues(drafts, existing, { index = null, known = [], claimed = [] } = {}) {
    let out = {},
        idOf = (v) => (isPlainObject(v.line) ? String(v.line.编号 || '').trim() : ''),
        add = (id, x) => (out[id] = out[id] || []).push(x);
    for (let v of drafts || []) {
        let id = idOf(v);
        if (id)
            for (let x of checkImportDraft([v], { index, mode: 'clue' }))
                /没有做名字保密检查/.test(x.text) ||
                    x.text.startsWith('按模组推演') ||
                    x.text.startsWith('替代途径') ||
                    x.text.startsWith('有些地方取决于') ||
                    compileClue([v]).errors.includes(x.text) ||
                    add(id, x);
    }
    let oldGives = /* @__PURE__ */ new Map();
    for (let n of compileClue(existing || []).nodes)
        for (let d of discoveryList(isPlainObject(n.item) ? n.item : {}))
            d.fact && !oldGives.has(d.fact) && oldGives.set(d.fact, { node: n.name, text: d.text });
    for (let v of drafts || [])
        for (let n of compileClue([v]).nodes)
            for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) {
                let old = d.fact && oldGives.get(d.fact);
                if (!old || clueText(old.text) === clueText(d.text)) continue;
                let got = known.includes(d.fact);
                add(idOf(v), {
                    level: got ? 'error' : 'warn',
                    text: `线索编号${d.fact}项目里已经有了（「${old.node}」：${old.text}），这条线的「${n.name}」又用它表示「${d.text}」。${got ? '这个聊天里它已经拿到了，采用后这条线会被当成已经查到。' : ''}如果是同一件事的另一条查法可以保留；不是同一件事的话，写意见让AI换一个编号`,
                });
            }
    let all = [...(existing || []), ...(drafts || [])],
        mine = new Set((drafts || []).map(idOf)),
        reach = clueReachability(all, { knownFacts: known, claimedFacts: claimed });
    for (let id of mine) {
        let stuck = [...reach.stuckStages, ...reach.stuckNodes].filter((x) => x.line === id);
        if (!stuck.length) continue;
        let hard = stuck.filter((x) => !x.unknown),
            soft = stuck.filter((x) => x.unknown),
            say = (list) =>
                list
                    .slice(0, 4)
                    .map((x) => `${x.stage}${x.node ? `·${x.node}` : ''}（${x.why}）`)
                    .join('；');
        ((hard = hard.filter((x) => !/线 [A-Za-z]+\d+ (未触发|可开启)/.test(x.why))),
            hard.length &&
                add(id, {
                    level: 'error',
                    text: `这条线走不通：${say(hard)}。常见原因是阶段的进入条件要等本阶段自己才能查到的线索，写意见让AI改`,
                }),
            !hard.length &&
                soft.length &&
                add(id, { level: 'info', text: `有些地方要到玩的时候才知道能不能走通（取决于时间或表格）：${say(soft)}` }));
    }
    return out;
}

export function lineIdsMissing(volumes, only) {
    let got = new Set((volumes || []).map((v) => (isPlainObject(v.line) ? String(v.line.编号 || '').trim() : '')));
    return (only || []).filter((id) => !got.has(id));
}

export function mergeImportByLine(vols) {
    let groups = /* @__PURE__ */ new Map(),
        order = [],
        conflicts = [];
    for (let v of vols || []) {
        let id = isPlainObject(v.line) ? String(v.line.编号 || '').trim() : '',
            key = id || `?${v.key}`;
        (groups.has(key) || (groups.set(key, []), order.push(key)), groups.get(key).push(v));
    }
    let out = [];
    for (let key of order) {
        let list = groups.get(key),
            merged = mergeImportParts(list, { rewrite: !0 }),
            line = {};
        // 线头：前一段为准，空的才补（后面的段重写的简介、入口提示不逐条列冲突，实测 2026-11-17）
        let skippedHead = 0;
        for (let v of list)
            if (isPlainObject(v.line))
                for (let [k, val] of Object.entries(v.line))
                    line[k] == null || line[k] === '' ? (line[k] = val) : JSON.stringify(line[k]) !== JSON.stringify(val) && skippedHead++;
        merged.skipped + skippedHead && !key.startsWith('?') && conflicts.push({ line: key, rewrite: merged.skipped + skippedHead });
        (conflicts.push(...merged.conflicts.filter((c) => !c.lines)),
            key.startsWith('?') &&
                conflicts.push({ stage: volumeLabel(list[0].key), field: '线', kept: '（没写）', other: '', noLine: !0 }),
            merged[0] && out.push({ ...merged[0], ...(Object.keys(line).length ? { line } : {}) }));
    }
    return Object.defineProperty(out, 'conflicts', { value: conflicts, enumerable: !1 });
}

export function reidLines(drafts, existingVolumes, avoid = [], prior = {}) {
    let taken = new Set(
            (existingVolumes || []).map((v) => (isPlainObject(v.line) ? String(v.line.编号 || '').trim() : '')).filter(Boolean),
        ),
        map = {},
        refd = new Set(avoid);
    for (let l of compileClue(drafts || []).lines || []) for (let id of conditionRefs(l.open).lines) refd.add(id);
    let next = (id) => {
            let m = /^([A-Za-z]+)(\d+)$/.exec(id),
                p = m ? m[1] : 'S',
                n = m ? Number(m[2]) : 1,
                w = m ? m[2].length : 2;
            for (; taken.has(`${p}${String(n).padStart(w, '0')}`) || refd.has(`${p}${String(n).padStart(w, '0')}`);) n++;
            return `${p}${String(n).padStart(w, '0')}`;
        },
        own = (drafts || []).map((v) => (isPlainObject(v.line) ? String(v.line.编号 || '').trim() : '')).filter(Boolean),
        clash = new Set(own.filter((id) => taken.has(id)));
    for (let id of own) clash.has(id) || taken.add(id);
    for (let id of own) clash.has(id) && !map[id] && ((map[id] = next(id)), taken.add(map[id]));
    let report = { ...map };
    for (let [from, to] of Object.entries(prior || {})) !own.includes(from) && from !== to && (map[from] = to);
    if (!Object.keys(map).length) return [drafts, report];
    let fix = (value) =>
        typeof value == 'string'
            ? value.replace(/(线\s*[:：]\s*)([A-Za-z]+\d+)/g, (all, head, id) => (map[id] ? `${head}${map[id]}` : all))
            : Array.isArray(value)
              ? value.map(fix)
              : isPlainObject(value)
                ? Object.fromEntries(
                      Object.entries(value).map(([k, v]) => [
                          k,
                          k === '线' && typeof v == 'string' ? v.replace(/^\s*([A-Za-z]+\d+)/, (all, id) => map[id] || all) : fix(v),
                      ]),
                  )
                : value;
    return [
        drafts.map((v) => {
            let line = isPlainObject(v.line) ? fix({ ...v.line }) : v.line,
                id = line && String(v.line.编号 || '').trim();
            line && map[id] && (line.编号 = map[id]);
            let key = map[id] ? v.key.replace(id, map[id]) : v.key;
            return { ...v, key, ...(line ? { line } : {}), stages: v.stages.map((s) => ({ ...s, data: fix(s.data) })) };
        }),
        report,
    ];
}

export const LINE_FREE_WORDS = /独立|无前提|没有前提|不需要前提|随时/;

export function inventedOpenIssue(vol, ident, mains = []) {
    let line = isPlainObject(vol.line) ? vol.line : {},
        id = String(line.编号 || '').trim(),
        me = (ident || []).find((l) => l.编号 === id),
        cond = line.开启条件,
        win = isPlainObject(line.开启时段) && String(line.开启时段.主线 || '').trim() ? line.开启时段 : null,
        hasCond = !(cond == null || cond === '' || (isPlainObject(cond) && !Object.keys(cond).length));
    if (!me || (!hasCond && !win)) return null;
    let rel = clueText(me.关系),
        raw = clueText(me.开启条件原文),
        text = `${rel} ${raw}`.trim(),
        said = text || '没写开启前提',
        esc2 = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'),
        mentions = (rid) => {
            let t = (ident || []).find((l) => l.编号 === rid),
                m = (mains || []).find((l) => l.id === rid),
                no = t ? String(t.文档里的序号 ?? '').trim() : '';
            return [rid, no, t && clueText(t.名称), m && m.name]
                .filter(Boolean)
                .some((w) =>
                    w === no
                        ? new RegExp(`(^|[^0-9])${esc2(w)}(?![0-9])`).test(text) && !new RegExp(`与\\s*${esc2(w)}\\s*独立`).test(text)
                        : text.includes(w),
                );
        },
        otherIds = (ident || []).filter((l) => l.编号 !== id),
        refsAny = otherIds.some((l) => mentions(l.编号)) || (mains || []).some((m) => mentions(m.id)),
        free = !!text && LINE_FREE_WORDS.test(text) && !refsAny,
        stance = free ? 'free' : text ? 'stated' : 'silent',
        atoms = [],
        errs = [],
        parsed = hasCond ? parseCondition(cond, errs) : null,
        walk = (c) => c && (c.kind === 'group' ? c.items.forEach(walk) : atoms.push(c));
    walk(parsed);
    let lineAtoms = atoms.filter((a) => a.kind === 'line'),
        unbacked = lineAtoms.filter((a) => !mentions(a.line)).map((a) => a.line),
        others = atoms.filter((a) => a.kind !== 'line'),
        problems = [];
    return (
        unbacked.length && problems.push(`要等${unbacked.join('、')}，但文档没提到${unbacked.length > 1 ? '它们' : '它'}`),
        stance === 'free' && others.length && problems.push(`多了${others.map((a) => a.raw || a.kind).join('、')}`),
        stance !== 'free' &&
            lineAtoms.length > unbacked.length &&
            others.length &&
            problems.push(`除了等线，还多了${others.map((a) => a.raw || a.kind).join('、')}，请核对原文有没有这一项`),
        stance === 'free' && win && problems.push(`加了开启时段（${String(win.主线).trim()}）`),
        stance === 'stated' &&
            !lineAtoms.length &&
            others.length &&
            problems.push(`是${others.map((a) => a.raw || a.kind).join('、')}，请核对原文是不是这个意思`),
        problems.length
            ? {
                  text: `${stance === 'free' ? `文档里这条是独立的（${said}）` : stance === 'stated' ? `文档写的是：${said}` : '文档没写这条的开启前提'}；AI写的开启条件${problems.join('；')}`,
                  level: stance === 'free' || unbacked.length ? 'error' : 'warn',
                  canDrop: stance === 'free',
              }
            : stance === 'silent' && hasCond && !lineAtoms.length
              ? { text: '文档没写这条的开启前提，AI写了开启条件，请核对原文', level: 'warn', canDrop: !1 }
              : null
    );
}

export function droppedLineRefs(kept, dropped, existingVolumes = []) {
    let gone = new Set(dropped),
        out = [],
        comp = compileClue([...existingVolumes, ...kept]);
    for (let l of comp.lines || [])
        for (let id of conditionRefs(l.open).lines)
            gone.has(id) &&
                out.push(
                    `线 ${l.id}「${l.name}」的开启条件要等${id}，但${id}不要了：${l.id}会一直开不了，可以写意见让AI改条件，或者一起不要`,
                );
    for (let l of comp.lines || []) l.window && gone.has(l.window.main) && out.push(`线 ${l.id} 的开启时段引用了${l.window.main}`);
    return out;
}

export function mainLinesText(volumes) {
    return (compileClue(volumes || []).lines || [])
        .filter((l) => l.kind === 'main')
        .map(
            (l) =>
                `- ${l.id}「${l.name}」阶段：${l.units.map((u) => splitStageKey(u.stage.key).short || stageLabel(u.stage.key)).join('、')}`,
        ).join(`
`);
}
