import { isPlainObject } from './outline.js';

// 抉择、风险骰与收尾（实验功能，默认关）。只放纯函数：读大纲字段、掷骰、材料文字、挑结局。
// 记录写在用户消息上（app/choice-log.js），条件求值走 clue-rules。

export const CHOICE_V = 1;
export const TIERS = ['顺利', '有代价', '失败'];
export const CUSTOM = '自定义';
const DIFF = { 容易: 1, 普通: 0, 困难: -1 };
const MOD_CAP = 3;
const text = (v) => String(v ?? '').trim();
const list = (v) => (Array.isArray(v) ? v : v == null || v === '' ? [] : [v]);

// 节点的「抉择」字段；不是对象或没有可用的行动时返回 null（errors 收集写法问题）
export function readChoice(raw, errors = []) {
    if (!isPlainObject(raw)) return (raw != null && raw !== '' && errors.push('「抉择」应写成对象（情境、选项）'), null);
    let seen = new Set(),
        options = list(raw.选项)
            .filter(isPlainObject)
            .map((o, i) => {
                let id = text(o.id) || `o${i + 1}`,
                    action = text(o.行动),
                    risk = text(o.风险),
                    res = isPlainObject(o.结果) ? o.结果 : {},
                    results = Object.fromEntries(TIERS.map((t) => [t, text(res[t])]));
                seen.has(id) ? errors.push(`选项编号「${id}」重复`) : seen.add(id);
                action || errors.push(`选项「${id}」缺少「行动」`);
                risk && !(risk in DIFF) && errors.push(`选项「${id}」的风险只能写 容易 / 普通 / 困难`);
                risk && TIERS.some((t) => !results[t]) && errors.push(`选项「${id}」有风险，三档结果（${TIERS.join(' / ')}）都要写`);
                return { id, action, direction: text(o.方向) || action, risk: risk in DIFF ? risk : '', attr: text(o.用), pro: list(o.有利), con: list(o.不利), when: o.条件 ?? null, results };
            })
            .filter((o) => o.action);
    // 只有一个行动时，它必须有风险（一次检定）；否则算不上选择
    options.length < 2 && !(options.length === 1 && options[0].risk) && errors.push('「抉择」至少要有两个行动；只有一个行动时要写「风险」（一次检定）');
    options.length && options.every((o) => o.when != null) && errors.push('「抉择」的每个行动都有出现条件，可能一个都不出现；留一个不写条件的当兜底');
    return options.length ? { situation: text(raw.情境), options, final: ['是', 'true', true, 1, '1'].includes(raw.不可回头) } : null;
}

// 节点的「收尾」字段：结局按顺序，最后一个通常是不写条件的默认；尾声分段，每段按顺序挑一个版本
export function readEnding(raw, errors = []) {
    if (!isPlainObject(raw)) return (raw != null && raw !== '' && errors.push('「收尾」应写成对象（结局、尾声）'), null);
    let endings = list(raw.结局)
            .filter(isPlainObject)
            .map((e) => ({ name: text(e.名称), when: e.条件 ?? null, point: text(e.要点) }))
            .filter((e) => e.name),
        segments = Object.entries(isPlainObject(raw.尾声) ? raw.尾声 : {}).map(([name, vs]) => ({
            name: text(name),
            versions: list(vs)
                .filter(isPlainObject)
                .map((v) => ({ when: v.条件 ?? null, point: text(v.要点) }))
                .filter((v) => v.point),
        }));
    endings.length || errors.push('「收尾」至少要有一个结局');
    endings.length && endings[endings.length - 1].when != null && errors.push('最后一个结局应不写条件（默认结局）');
    for (let s of segments) s.versions.length && s.versions[s.versions.length - 1].when != null && errors.push(`尾声「${s.name}」最后一个版本应不写条件（默认）`);
    return endings.length ? { endings, segments: segments.filter((s) => s.versions.length) } : null;
}

export function rollDice(rand = cryptoRand) {
    return [1 + Math.floor(rand() * 6), 1 + Math.floor(rand() * 6)];
}
function cryptoRand() {
    let c = globalThis.crypto;
    if (!c || typeof c.getRandomValues !== 'function') return Math.random();
    let a = new Uint32Array(1);
    return (c.getRandomValues(a), a[0] / 4294967296);
}

export function tierOf(total) {
    return total >= 10 ? TIERS[0] : total >= 7 ? TIERS[1] : TIERS[2];
}

// 加值：属性值、有利 / 不利每满足一条 ±1、难度，总修正限在 ±3。test(条件原文) 返回 true 才算满足；
// attr(名) 返回 { value, why }：读不到时 value 为 null，按 0 算并写明原因（不悄悄当 0）
export function choiceMods(option, test, attr = () => null) {
    let a = option.attr ? attr(option.attr) : null,
        mods = [
        ...(option.attr ? [a && a.value != null ? { name: option.attr, value: a.value } : { name: `${option.attr}（${(a && a.why) || '没有这个属性'}，按0）`, value: 0 }] : []),
        ...option.pro.filter((c) => test(c) === !0).map((c) => ({ name: condLabel(c), value: 1 })),
        ...option.con.filter((c) => test(c) === !0).map((c) => ({ name: condLabel(c), value: -1 })),
    ];
    DIFF[option.risk] && mods.push({ name: `难度${option.risk}`, value: DIFF[option.risk] });
    let sum = mods.reduce((n, m) => n + m.value, 0);
    return { mods, bonus: Math.max(-MOD_CAP, Math.min(MOD_CAP, sum)) };
}
function condLabel(c) {
    if (Array.isArray(c)) return c.map(condLabel).join('；');
    if (!isPlainObject(c)) return text(c);
    return Object.entries(c)
        .map(([k, v]) => (k === '任一' || k === '全部' || k === '条件' ? `${k}（${condLabel(v)}）` : isPlainObject(v) || Array.isArray(v) ? `${k} ${condLabel(v)}` : `${k} ${text(v)}`))
        .join('，');
}

// 提交时的记录：存下当时采用的文字，之后重 roll 只读记录
export function choiceRecord({ projectId, node, choice, optionId, test, rand, attr }) {
    if (optionId === CUSTOM) return { v: CHOICE_V, projectId, node, kind: 'custom', action: '玩家采用自己的办法' };
    let o = choice.options.find((x) => x.id === optionId);
    if (!o) return null;
    let rec = { v: CHOICE_V, projectId, node, kind: 'option', option: o.id, action: o.action, direction: o.direction };
    if (!o.risk) return { ...rec, result: '' };
    let dice = rollDice(rand),
        { mods, bonus } = choiceMods(o, test, attr),
        total = dice[0] + dice[1] + bonus,
        tier = tierOf(total);
    return { ...rec, dice, mods, bonus, total, tier, result: o.results[tier] };
}

// 读消息里的记录：版本不认识、格式不对就当没有（不回写原消息）
export function readRecord(raw, projectId) {
    if (!isPlainObject(raw) || raw.projectId !== projectId || !text(raw.node)) return null;
    if (Number(raw.v) !== CHOICE_V) return null;
    return raw;
}

// 玩家点选后填进输入框的一句（自然句，不带标记）
export function pickSentence(choice, optionId) {
    let o = choice.options.find((x) => x.id === optionId);
    return o ? `我决定${o.action}。` : '';
}

export const CHOICE_TEXT = {
    pending: '这里是一个需要玩家做决定的时刻。呈现眼前的局面和玩家能看出的行动机会，停在需要玩家决定的位置；不替玩家选，不写出结果。',
    performing: '承接玩家这一轮的动作写出过程与下面这个结果；不重判成败，不替玩家执行下一步行动。',
    custom: '玩家采用自己的办法；按当前情境承接，不擅自把它记成某个预设的行动。',
    ending: '衔接前文细节，写出本次尾声；不改下面这些结论。',
    ended: '故事已收尾',
};

// 抉择节点的材料：pending 时不给发现内容，只给情境和行动意图；performing 时只给选中的行动和这一档结果
// visible(option)：这个行动现在出不出现（选项条件）；不传就都出现
export function choiceMaterial(choice, phase, rec, visible = () => !0) {
    if (phase === 'pending')
        return [CHOICE_TEXT.pending, ...(choice.situation ? [`局面：${choice.situation}`] : []), '玩家能看出的行动：', ...choice.options.filter(visible).map((o) => `- ${o.direction}`)];
    if (phase === 'performing' && rec)
        return rec.kind === 'custom'
            ? [CHOICE_TEXT.custom]
            : [CHOICE_TEXT.performing, `本轮确认的行动：${rec.direction || rec.action}`, ...(rec.result ? [`本次结果：${rec.tier ? `${rec.tier}——` : ''}${rec.result}`] : [])];
    return [];
}

// 挑结局：test(条件) 返回 'yes' | 'no' | 'unknown'。前面的结局条件读不出来（unknown）时不往下挑，
// 除非玩家选了「按现有记录收尾」（accept），这时读不出来的按不满足处理并记进 gaps。
export function pickEnding(ending, test, accept = !1) {
    let gaps = [],
        firstOf = (items) => {
            for (let it of items) {
                if (it.when == null) return it;
                let r = test(it.when);
                if (r === 'yes') return it;
                if (r === 'unknown') {
                    gaps.push(condLabel(it.when));
                    if (!accept) return void 0;
                }
            }
            return null;
        },
        main = firstOf(ending.endings),
        segs = ending.segments.map((s) => ({ name: s.name, pick: firstOf(s.versions) }));
    if (main === void 0 || segs.some((s) => s.pick === void 0)) return { blocked: !0, gaps: [...new Set(gaps)] };
    return {
        blocked: !1,
        name: main ? main.name : '',
        point: main ? main.point : '',
        segments: segs.filter((s) => s.pick).map((s) => ({ name: s.name, point: s.pick.point })),
        gaps: [...new Set(gaps)],
    };
}

export function endingRecord({ projectId, node, pick, accepted }) {
    return { v: CHOICE_V, projectId, node, kind: 'ending', ending: pick.name, point: pick.point, segments: pick.segments, gaps: pick.gaps, ...(accepted ? { accepted: !0 } : {}) };
}

export function endingMaterial(rec, phase) {
    if (!rec) return [];
    if (phase !== 'performing') return [`${CHOICE_TEXT.ended}：${rec.ending}`];
    return [
        CHOICE_TEXT.ending,
        `结局：${rec.ending}${rec.point ? `——${rec.point}` : ''}`,
        ...(rec.segments.length ? ['尾声要点：', ...rec.segments.map((s) => `- ${s.name}：${s.point}`)] : []),
    ];
}

// 属性值：-1 到 +3 的整数；表格里的值按数字读，超出范围就截到范围内
export const ATTR_MIN = -1;
export const ATTR_MAX = 3;
export function attrValue(raw) {
    let t = String(raw ?? '').trim(),
        n = Math.round(Number(t.replace(/[^\d.+-]/g, '')));
    return !/\d/.test(t) || !Number.isFinite(n) ? null : Math.max(ATTR_MIN, Math.min(ATTR_MAX, n));
}

// ---------- 结局预览（作者用，不写聊天也不写表） ----------
// 收集一个收尾节点的结局 / 尾声条件里用到的东西，给预览表单列出来
export function endingInputs(node, conditionRefs) {
    let facts = new Set(),
        nodes = new Set(),
        choices = new Set(),
        cells = new Set(),
        walk = (c) => {
            if (!c) return;
            if (c.kind === 'group') return c.items.forEach(walk);
            c.kind === 'cell' || c.kind === 'time' ? cells.add(c.raw) : null;
        },
        conds = [...node.ending.endings, ...node.ending.segments.flatMap((s) => s.versions)].map((x) => x.cond).filter(Boolean);
    for (let c of conds) {
        let r = conditionRefs(c);
        (r.facts.forEach((f) => facts.add(f)), r.nodes.forEach((n) => nodes.add(n)), r.choices.forEach((x) => choices.add(x.node)), walk(c));
    }
    return { facts: [...facts], nodes: [...nodes], choices: [...choices], cells: [...cells] };
}
// assume：{ facts: Set, nodes: Set, choices: { uid: { option, tier } }, cells: { 原文: 'yes'|'no'|'unknown' } }
export function previewEnv(assume) {
    // 没勾的线索按「没拿到」算（正式运行时表里那一行是未获得），不算读不到
    let facts = { get: (f) => (assume.facts.has(f) ? { id: f, status: 'confirmed', raw: '已核实', text: '' } : { id: f, status: 'unconfirmed', raw: '未获得', text: '' }), has: () => !0 };
    return {
        facts,
        knowledge: [],
        tables: {},
        factOverrides: {},
        nodeDone: (uid) => assume.nodes.has(uid),
        lineState: () => null,
        lineStarted: () => !1,
        choices: {
            enabled: !0,
            stateOf: (uid) => {
                let c = assume.choices[uid];
                return c && c.option ? { rec: { kind: c.option === CUSTOM ? 'custom' : 'option', option: c.option, tier: c.option === CUSTOM ? undefined : c.tier || undefined, action: c.option } } : null;
            },
        },
        nodeForced: () => !1,
        choicesFinal: !0,
        assumeCell: (raw) => assume.cells[raw] || 'unknown',
    };
}

// 抉择与收尾的写法（给写大纲的 AI；只在开关打开时加进提示词）。格式部分三处共用，开头一句按用途不同。
const CHOICE_FORMAT = [
    '· 行动可以写「条件」：满足才出现（例如某个势力已经和你敌对，投靠它的那条路就不出现）。至少留一个不写条件的行动当兜底。',
    '· 只有一个行动、而且它可能失败时（一次检定，如说服某人），可以只写这一个行动，带上风险和三档结果。',
    '· 做完就不能回头的关键决定，在抉择里写「不可回头: 是」。',
    '写法示例（风险、有利、结果都写在选项里）：',
    '  - id: n_rescue',
    '    名称: 救人',
    '    入口: 去旧仓库把人带出来',
    '    场景: 前门有守卫，后门虚掩',
    '    抉择:',
    '      情境: 雨夜的仓库，前门有守卫，后门虚掩着',
    '      选项:',
    '        - id: sneak',
    '          行动: 绕到后门，找机会潜进去',
    '          方向: 等守卫换班，从后门摸进去',
    '          风险: 普通',
    '          有利: [{事实: F_shift}]',
    '          结果: {顺利: 悄悄带出了人, 有代价: 人带出来了，但被看清了脸, 失败: 被发现，人被连夜转走}',
    '        - id: deal',
    '          行动: 去找管事谈一笔交易',
    '          方向: 管事贪财，开价很高',
    '· 几种做法是**同一个抉择的几个选项**，写在**同一个节点**里；不要每种做法各建一个节点。几种做法在不同地点也一样：抉择节点放在玩家做决定的地方，选了之后到别处发生的剧情写成后续节点。',
    '· 行动用玩家的口吻写一个具体做法，不写后果、不写难度。',
    '· 只有可能失败的行动才写「风险」（困难 / 普通 / 容易）和三档「结果」：顺利；有代价（目标达成，但付出代价）；失败（目标没达成，写出接下来的处境）。不会失败的选项不写这两项。',
    '· 行动的几种结果**只写在「结果」里**：不要再写成这个节点的发现，也不要为每种结果另建一个节点去判断成败。',
    '· 带抉择的节点不写完成条件。上面通用规则里「完成条件必须写」「要有发现」只指普通节点；带抉择、带收尾的节点不写完成条件，也可以没有发现。',
    '· 选了某条路、出现某种结果之后才发生的剧情，写成后续的普通节点，开放条件写 {抉择: n_rescue, 选了: deal} 或 {抉择: n_rescue, 结果: 失败}。失败之后要有可以继续走的后续，不能让主线卡住；主线的必需节点和阶段条件不要只依赖某一档结果。',
    '· 有几种结局时，在最后一个阶段的主线节点里加一个收尾节点，「收尾」写在这个节点里（不写在阶段上）。结局按优先顺序列出，最后一个不写条件（默认结局）；收尾节点不写完成条件。主结局只写整体局势，某个人物的命运写在「尾声」里那个人物的一段：',
    '  - id: n_end',
    '    名称: 尾声',
    '    入口: 回到老周那里',
    '    收尾:',
    '      结局:',
    '        - {名称: 账本到手, 条件: {事实: F_ledger}, 要点: 老周把账本交了出来}',
    '        - {名称: 人没追回, 条件: {抉择: n_rescue, 结果: 失败}, 要点: 老周一夜没合眼}',
    '        - {名称: 暂时平息, 要点: 事情暂时没有结果}',
    '      尾声:',
    '        老周:',
    '          - {条件: {抉择: n_rescue, 选了: deal}, 要点: 老周欠下商会一笔人情}',
    '          - {要点: 老周回到码头，照旧骂骂咧咧}',
    '· 条件还可以写 {其中至少: 2, 条件: [{事实: F_a}, {事实: F_b}, {事实: F_c}]}（下面几条满足至少 2 条）。',
];

// 长文导入：只按原文写
export const CHOICE_DRAFT_RULE = [
    '抉择：原文明确写了「玩家在这里要做出选择」的地方，用「抉择」写；原文没写就不写。原文的一处选择只写一个抉择，不要拆成好几层选择，也不要在后续节点里再编新的选择。调查、问话、搜查不是抉择，照常写成发现。原文写了几种结局时才写收尾。',
    ...CHOICE_FORMAT,
].join('\n');

// 从头写大纲：在关键处放少量抉择
export const CHOICE_WRITE_RULE = [
    '抉择：在玩家要做关键决定、而且不同决定会改变后面走向的地方，用「抉择」写；一条线写 1～2 处就够，作者要求更多时照作者的。调查、问话、搜查、闲聊不是抉择，照常写成节点和发现。每个选项选了以后都要有后续剧情（后续节点、不同的支线或不同的结局），不要写只换一句话、后面完全一样的假选择。作者要求有结局时写收尾。',
    ...CHOICE_FORMAT,
].join('\n');

// 改写、审阅修改、修格式：已有的抉择和收尾原样保留
export const CHOICE_KEEP_RULE = [
    '大纲里已有的「抉择」「收尾」字段原样保留：选项的 id 不改，行动、结果、结局的文字在意见没有要求时不改；不要删掉这两个字段，也不要把它们改写成发现或作者备注。意见要求新增或修改抉择时，照下面的写法：',
    ...CHOICE_FORMAT,
].join('\n');
