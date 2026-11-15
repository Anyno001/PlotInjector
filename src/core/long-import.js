import { CLUE_LINE_RULES, CLUE_OUTLINE_RULES_WITH_LINES, CLUE_OUTLINE_RULES, OUTLINE_RULES } from './prompts.js';
import { discoveryList, clueText, clueAlternativeRoutes, clueReachability } from './clue-project.js';
import {
    volumeLabel,
    splitStageKey,
    isPlainObject,
    STAGE_HINT_KEYS,
    NODE_FIELDS,
    stageLabel,
    flattenUnits,
    stageNodes,
} from './outline.js';
import { conditionRefs, parseCondition, compileClue } from './clue-rules.js';

import { CLUE_STAGE_KEYS, CLUE_NODE_KEYS, nodeUid, stripAuthorDeep, outlineStageData } from './clue-model.js';

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
    '  - {名称: 常用称呼, 别名: [只属于这个人的其他称呼], 同一人: 前面索引里已有的名称（只有原文明说是同一个人时才写）, 公开身份: 别人眼里他是谁, 真实身份: 只有作者知道的（没有就省略）, 名字保密: 揭示之前正文不能出现这个名字时写 true（只是身份或所做的事保密、名字本身公开的，不写）, 首次登场: 本段 / 之前}',
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
                '材料里的写作规则、提醒和限制（如「不能一次检查就解决全部问题」「只说合作不产生成果」「彼得会逐渐愿意让别人分担」「结局可以不完全成功」）**不是事实**，写进「作者资料」。',
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

export function importDraftMessages({ part, index, prevTail = '', mode = 'clue', needs = '', actors = '', done = '' }) {
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
                    '最稳妥的写法：把 X 和 Y 放进**同一个阶段**，X 写「必需: false」，Y 不写开放条件（雾港实测：模型把「可以跳过老韩直接查账房」写成了先后两个阶段，第二阶段要等第一阶段的事实，结果跳过的路走不通）。只有 X 和 Y 之间确实隔着时间或地点的大转场，才分成两个阶段，这时后一阶段的进入条件要留出不走 X 的路。',
                ),
                onlyClue(
                    '节点的完成条件写成它自己产出的事实（如 {事实: F_mateo_absent}），**不能**写成 {节点: 自己的 id}：「自己完成了才算完成」永远不会成立。',
                ),
                '要求正文「不要提某人的名字 / 某个真相」时，AI指令和入口里**不能写出那个名字或真相本身**（写出来就已经告诉正文了）。改成「幕后的人此时没有名字，只称『发号施令的人』」这样的写法；具体名字只放在作者备注的 <仅作者> 里，或者等揭示它的那个发现的「内容」里。',
                actors && `角色对应：${actors}`,
                needs && `作者的要求：${needs}`,
                rules,
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

export function importVisibleText(volumes, mode = 'clue') {
    let out = [],
        stage = '',
        put = (layer, where, value, field = '') => {
            let t = clueText(typeof value == 'string' ? value : value == null ? '' : JSON.stringify(value));
            t && out.push({ layer, where, text: t, stage, field });
        };
    for (let vol of volumes || [])
        for (let st of vol.stages || []) {
            let where = stageLabel(st.key),
                data = isPlainObject(st.data) ? st.data : {};
            stage = st.key;
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

export function importSecretHits(volumes, names, mode = 'clue') {
    let out = {};
    for (let x of importVisibleText(volumes, mode)) {
        if (x.layer !== 'body' && x.layer !== 'fill') continue;
        for (let s of names || [])
            s &&
                s.length >= 2 &&
                x.text.includes(s) &&
                (out[x.stage] = [
                    ...(out[x.stage] || []),
                    `${x.field}「${x.text.length > 120 ? `${x.text.slice(0, 120)}…` : x.text}」里出现了「${s}」`,
                ]);
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

export function checkImportDraft(volumes, { index = null, secrets = null, mode = 'clue' } = {}) {
    let out = [],
        clue = mode === 'clue',
        compiled = clue ? compileClue(volumes || []) : { errors: [] };
    out.push(...compiled.errors.map((t) => ({ level: 'error', text: t })));
    // 秘密名字：按运行时可见层检查。正文层、填表层出现就报错；「可能的发现」里出现提醒作者确认它确实是这个节点当场揭示的。
    let names = secrets || importSecretNames(index),
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
            s && s.length >= 2 && x.text.includes(s) && hits.set(`${x.layer}|${s}`, [...(hits.get(`${x.layer}|${s}`) || []), x.where]);
    }
    for (let [k, w] of hits) {
        let [layer, s] = k.split('|'),
            list = [...new Set(w)].join('、');
        layer === 'reveal'
            ? out.push({
                  level: 'warn',
                  text: `保密的名字「${s}」写在「可能的发现」里（${list}）：玩家到场时正文就会拿到它（标明尚未发生）。确认这是这个节点当场就能揭示的；不是的话移到作者备注的 <仅作者> 里`,
              })
            : out.push({
                  level: 'error',
                  text: `保密的名字「${s}」出现在${IMPORT_LAYER_TEXT[layer]}里（${list}）；只能写在揭示它的那个发现的「内容」或作者备注的 <仅作者> 里`,
              });
    }
    // 作者侧字段残留：只查主线、支线节点（世界动态的「来源」是正常字段）。
    let left = /* @__PURE__ */ new Set();
    for (let vol of volumes || [])
        for (let st of vol.stages || [])
            for (let { field, kind } of NODE_FIELDS)
                if (kind !== 'world')
                    for (let n of Array.isArray(st.data && st.data[field]) ? st.data[field] : [])
                        isPlainObject(n) && IMPORT_AUTHOR_KEYS.forEach((k) => k in n && left.add(k));
    for (let k of left) out.push({ level: 'error', text: `正式大纲里还留着只给作者看的字段「${k}」` });
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

export function importReachIssues(applied, { only = null, knownFacts = [], claimedFacts = [] } = {}) {
    let out = [],
        mine = (x) => !only || only.has(x.stage);
    for (let r of clueAlternativeRoutes(applied, { knownFacts, claimedFacts })) {
        if (!mine(r)) continue;
        r.verdict === 'blocked'
            ? out.push({
                  level: 'error',
                  text: `替代途径走不通：${r.stage}·${r.node} 单独走完时，${r.why}。常见原因：这条线产出的事实不在阶段结束条件 / 下一阶段进入条件的「任一」里`,
              })
            : r.verdict === 'unknown' &&
              out.push({ level: 'warn', text: `替代途径要到运行时才能确认：${r.stage}·${r.node} 单独走完时，${r.why}` });
    }
    let reach = clueReachability(applied, { knownFacts, claimedFacts }),
        stuck = [...reach.stuckStages, ...reach.stuckNodes].filter(mine);
    stuck.length &&
        reach.verdict === 'blocked' &&
        out.push({
            level: 'error',
            text: `按大纲推演走不通：${stuck
                .slice(0, 6)
                .map((x) => `${x.stage}${x.node ? `·${x.node}` : ''}（${x.why}）`)
                .join('；')}`,
        });
    stuck.length &&
        reach.verdict === 'unknown' &&
        out.push({
            level: 'warn',
            text: `有些地方取决于时间、知情或表格的值：${stuck
                .slice(0, 4)
                .map((x) => `${x.stage}${x.node ? `·${x.node}` : ''}`)
                .join('、')}`,
        });
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

export function importRepairMessages({ yaml, issues, mode = 'clue', spots = [] }) {
    let fence = '```';
    return [
        {
            role: 'system',
            content: [
                `下面的大纲草稿检查出了问题。只修改列出的问题，其余内容原样保留，输出完整的修改后大纲（一个 ${fence}yaml 代码块）。`,
                '幕后人物的名字或真相出现在 AI指令、入口、场景、名称、记录这些字段里时：改成不点名的写法（如「发号施令的人」「改装器材的技术员」），名字只留在揭示它的那个发现的「内容」里，或作者备注的 <仅作者> 里。',
                '「记录」是给填表模型看的登记标准，也不能写名字：写成「正文出现订单或付款记录指向幕后组织者时登记」这样，不要写「此时才出现某某这个名字」。',
                spots.length ? '【必须改的位置】里列出的每一句都要改，改完这些字段里不能再有那个名字。' : '',
                '重复的节点 id：保留一个，另一个合并进去或改成新 id。',
                '替代途径走不通：把那条线产出的关键事实，加进本阶段结束条件和下一阶段进入条件的「任一」里。',
                mode === 'clue' ? CLUE_OUTLINE_RULES : OUTLINE_RULES,
            ]
                .filter(Boolean)
                .join('\n'),
        },
        {
            role: 'user',
            content: `【问题】\n${issues.map((x) => `- ${x}`).join('\n')}${spots.length ? `\n\n【必须改的位置】\n${spots.map((x) => `- ${x}`).join('\n')}` : ''}\n\n【草稿】\n${fence}yaml\n${yaml}\n${fence}`,
        },
    ];
}

export function mergeImportParts(vols) {
    let stages = [],
        conflicts = [],
        asList = (x) => (Array.isArray(x) ? x : isPlainObject(x) ? [x] : []),
        same = (a, b) => JSON.stringify(a) === JSON.stringify(b),
        empty = (v) => v == null || v === '' || (Array.isArray(v) && !v.length),
        mergeFields = (into, from, skip, where) => {
            for (let [k, v] of Object.entries(from))
                skip.includes(k) ||
                    empty(v) ||
                    (empty(into[k]) ? (into[k] = v) : same(into[k], v) || conflicts.push({ ...where, field: k, kept: into[k], other: v }));
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
    for (let v of vols || [])
        for (let st0 of v.stages || []) {
            let st = JSON.parse(JSON.stringify(st0)),
                hit = stages.find((x) => x.key === st.key);
            if (!hit) {
                stages.push(st);
                continue;
            }
            let where = { stage: stageLabel(st.key) },
                nodeKeys = NODE_FIELDS.map((f) => f.field);
            isPlainObject(st.data) && isPlainObject(hit.data) && mergeFields(hit.data, st.data, nodeKeys, where);
            for (let { field } of NODE_FIELDS)
                for (let n of asList(st.data && st.data[field])) {
                    let list = Array.isArray(hit.data[field]) ? hit.data[field] : (hit.data[field] = asList(hit.data[field])),
                        k = list.findIndex((x) => isPlainObject(x) && isPlainObject(n) && x.id && x.id === n.id);
                    k >= 0 ? mergeNode(list[k], n, { ...where, node: n.id }) : list.push(n);
                }
        }
    let lineIds = [...new Set((vols || []).map((v) => (isPlainObject(v.line) ? String(v.line.编号 || '').trim() : '')).filter(Boolean))];
    lineIds.length > 1 &&
        conflicts.push({ stage: '（整份草稿）', field: '线', kept: lineIds[0], other: lineIds.slice(1).join('、'), lines: lineIds });
    let first = vols && vols.length ? vols[0] : null,
        keepLine = (vols || []).map((v) => v.line).find((l) => isPlainObject(l)),
        out = first ? [{ ...first, ...(keepLine ? { line: keepLine } : {}), stages }] : [];
    return Object.defineProperty(out, 'conflicts', { value: conflicts, enumerable: !1 });
}

export function importConflictText(c) {
    if (c.lines)
        return `草稿里写了好几条剧情线（${c.lines.join('、')}），长文导入暂时只能合成一条：保留了「${c.lines[0]}」，其余几条的阶段并进了这一条，它们的线编号和开启条件没有保留。要分开成几条线，采用后在大纲页让 AI 另写新卷`;
    let s = (v) => (typeof v == 'string' ? v : JSON.stringify(v)).slice(0, 80);
    return `${c.stage}${c.node ? `·${c.node}` : ''} 的「${c.field}」两段写得不一样：保留了前一段的「${s(c.kept)}」，后一段是「${s(c.other)}」。需要的话在采用后手动改`;
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
这份文档是好几条分别成卷的支线，不要合并成一条连续的剧情。先在「支线」里列出本段出现的每一条支线（一条支线被切成两段时，后一段沿用前一段的编号，不要另建）。
每条支线有没有开启前提，逐条照原文抄进「开启条件原文」「关系」：「分别成卷」不等于「没有前提」，原文写了「默认在 8 之后」就照抄；原文明说「独立」也照抄「独立」；原文没写就省略。`,
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
                    ? notes.push(`文档里第 ${no} 条支线被编了两个编号（${byNo.get(no)}、${id}），请确认是不是同一条`)
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
这份材料是好几条分别成卷的支线：
· 本段里的**每一条**支线写成单独的一卷，卷的第一个键写「线」，类型写「支线」，编号**必须**用【线身份表】里的编号；卷名写「剧情_编号_标题」。不要把两条支线写进同一卷，也不要写主线。
· 一条支线从上一段延续过来时，用同一个编号、同一个卷名，只写新增的阶段或节点。
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

export function importLineIssues(drafts, existing, { index = null, known = [], claimed = [] } = {}) {
    let out = {},
        idOf = (v) => (isPlainObject(v.line) ? String(v.line.编号 || '').trim() : ''),
        add = (id, x) => (out[id] = out[id] || []).push(x);
    for (let v of drafts || []) {
        let id = idOf(v);
        if (id)
            for (let x of checkImportDraft([v], { index, mode: 'clue' }))
                /没有做名字保密检查/.test(x.text) ||
                    x.text.startsWith('按大纲推演') ||
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
                    text: `线索编号 ${d.fact} 项目里已经有了（「${old.node}」：${old.text}），这条线的「${n.name}」又用它表示「${d.text}」。${got ? '这个聊天里它已经拿到了，采用后这条线会被当成已经查到。' : ''}如果是同一件事的另一条查法可以保留；不是同一件事的话，写意见让 AI 换一个编号`,
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
                    text: `这条线走不通：${say(hard)}。常见原因是阶段的进入条件要等本阶段自己才能查到的线索，写意见让 AI 改`,
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
            merged = mergeImportParts(list),
            line = {};
        for (let v of list)
            if (isPlainObject(v.line))
                for (let [k, val] of Object.entries(v.line))
                    line[k] == null || line[k] === ''
                        ? (line[k] = val)
                        : JSON.stringify(line[k]) !== JSON.stringify(val) &&
                          conflicts.push({ stage: `线 ${key}`, field: k, kept: line[k], other: val });
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
        unbacked.length && problems.push(`要等 ${unbacked.join('、')}，但文档没提到${unbacked.length > 1 ? '它们' : '它'}`),
        stance === 'free' && others.length && problems.push(`多了 ${others.map((a) => a.raw || a.kind).join('、')}`),
        stance !== 'free' &&
            lineAtoms.length > unbacked.length &&
            others.length &&
            problems.push(`除了等线，还多了 ${others.map((a) => a.raw || a.kind).join('、')}，请核对原文有没有这一项`),
        stance === 'free' && win && problems.push(`加了开启时段（${String(win.主线).trim()}）`),
        stance === 'stated' &&
            !lineAtoms.length &&
            others.length &&
            problems.push(`是 ${others.map((a) => a.raw || a.kind).join('、')}，请核对原文是不是这个意思`),
        problems.length
            ? {
                  text: `${stance === 'free' ? `文档里这条是独立的（${said}）` : stance === 'stated' ? `文档写的是：${said}` : '文档没写这条的开启前提'}；AI 写的开启条件${problems.join('；')}`,
                  level: stance === 'free' || unbacked.length ? 'error' : 'warn',
                  canDrop: stance === 'free',
              }
            : stance === 'silent' && hasCond && !lineAtoms.length
              ? { text: '文档没写这条的开启前提，AI 写了开启条件，请核对原文', level: 'warn', canDrop: !1 }
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
                    `线 ${l.id}「${l.name}」的开启条件要等 ${id}，但 ${id} 不要了：${l.id} 会一直开不了，可以写意见让 AI 改条件，或者一起不要`,
                );
    for (let l of comp.lines || []) l.window && gone.has(l.window.main) && out.push(`线 ${l.id} 的开启时段引用了 ${l.window.main}`);
    return out;
}

export function lineReviseMessages({ targets, context = '', tableCatalog = '', mainLines = '' }) {
    let fence = '```';
    return [
        {
            role: 'system',
            content: [
                `下面几条剧情线（每条是一卷）各带一句作者意见。按意见修改这几条，输出修改后的这几卷（一个 ${fence}yaml 代码块，顶层键是卷名，卷的第一个键是「线」）。`,
                '· 只改列出的这几条，每条都要输出；线的编号不能改；没提到的部分原样保留。',
                '· 别的线只是给你参考，不要输出、不要改。',
                '· 改开启条件时按下面线的写法。意见说「主线到某个阶段以后 / 期间才能开」的，在线下面写单独的字段「开启时段: {主线: M1, 从: 阶段短名}」（要关的话加 到），旧的开启条件去掉（没有别的要求就整个不写）；不要写进开启条件，也不要为它另编一个事实。',
                '· 改剧情内容时，还是同一件事的节点必须沿用原来的 id（哪怕改了名称、入口），新加的事才用新 id。',
                CLUE_OUTLINE_RULES_WITH_LINES,
            ].join(`
`),
        },
        {
            role: 'user',
            content: [
                mainLines &&
                    `【项目里已有的主线】
${mainLines}`,
                context &&
                    `【其他线（只读）】
${context}`,
                tableCatalog,
                ...targets.map(
                    (t) => `【要改的线 ${t.id}】
意见：${t.comment}
${fence}yaml
${t.yaml}
${fence}`,
                ),
            ].filter(Boolean).join(`

`),
        },
    ];
}

export function pickRevised(volumes, ids) {
    let got = {};
    for (let v of volumes || []) {
        let id = isPlainObject(v.line) ? String(v.line.编号 || '').trim() : '';
        id && ids.includes(id) && !got[id] && (got[id] = v);
    }
    return { got, missing: ids.filter((id) => !got[id]) };
}

export function lineChangeText(before, after) {
    let out = [],
        show = (v) => (v == null || v === '' ? '（无）' : (typeof v == 'string' ? v : JSON.stringify(v).replace(/"/g, '')).slice(0, 60)),
        a = isPlainObject(before.line) ? before.line : {},
        b = isPlainObject(after.line) ? after.line : {};
    for (let [k, label] of [
        ['类型', '类型'],
        ['简介', '简介'],
        ['开启条件', '开启'],
        ['开启方式', '开启方式'],
        ['开启时段', '时段'],
        ['入口提示', '入口'],
    ])
        JSON.stringify(a[k] ?? null) !== JSON.stringify(b[k] ?? null) && out.push(`${label}：${show(a[k])} → ${show(b[k])}`);
    let count = (v) => `${v.stages.length} 个阶段 · ${v.stages.reduce((n, s) => n + stageNodes(s.data).length, 0)} 个场景`;
    return (
        count(before) !== count(after)
            ? out.push(`内容：${count(before)} → ${count(after)}`)
            : JSON.stringify(before.stages.map((s) => s.data)) !== JSON.stringify(after.stages.map((s) => s.data)) &&
              out.push('内容有改动'),
        out
    );
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
