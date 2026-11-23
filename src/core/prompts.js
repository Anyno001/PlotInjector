import {
    isPlainObject,
    changeLines,
    flattenUnits,
    outlineToText,
    stageLabel,
    stageToText,
    volumeLabel,
    volumesFromValue,
} from './outline.js';
import { CLUE_TPL_MARK_BEGIN, CLUE_TPL_MARK_END } from './clue-template.js';

import { sheetList, sheetRows } from './clue-tables.js';

import { parseYaml, yamlErrorLine } from './yaml.js';

export const SAMPLE_STAGE = `剧情_卷一_示例:
  阶段一_开端:
    时间范围: 故事开始至主角离开故乡
    AI指令: 推进主角得知变故并决定出发的事件。
    主线节点:
      - 名称: 主角得知变故
        地点: 故乡
        事件: 用一到三句话写清谁做了什么、结果如何。
      - 名称: 决定是否出发
        地点: 家中
        事件: 一到三句话。
        偏转: 主角选择留下时，后续如何调整（只有选择确实改变后续时才写这一项）。
    支线事件:
      - 名称: 旧友送行
        地点: 村口
        事件: 一句话事件。
        触发: 出现这种情况时发生。
      - 名称: 酒馆密谈
        事件: 一位陌生人约主角深夜密谈。
        条件: 主角到过镇上的酒馆
        时限: 20
        错过: 陌生人离开了小镇，线索中断。
    世界动态:
      - 类型: 传闻
        来源: 谁传出
        内容: 外界正在发生什么。
      - 类型: 山匪逼近
        内容: 山匪袭击村庄。
        进度钟: 6
        前兆: 邻村有人被抢，夜里山上能看到火光。
        后果: 村庄被洗劫，村民对官府失去信任。
    状态变化:
      - 本阶段结束时谁知道了什么、谁对谁的看法或关系变了。
`;

const FOLD_KEEP = 16;
const FOLD_CHARS = 24000;

// persona：用户在讨论页填的说话人格，只决定怎么说话，任务和回复结构不变。
export function discussSystemPrompt({ guide, refs, persona = '' }) {
    let g = typeof guide == 'string' ? { text: guide, title: '写作基准' } : guide || {},
        parts = [
            g.opener || '你在帮用户构思一个故事的设定和剧情：一起把世界观、人物处境、信息差和大纲方向想清楚。',
            '每次回复先回应用户的想法，再指出缺口或矛盾，最后给出两三个可选方向。不写小说正文。',
        ];
    if (persona.trim()) parts.push(`【说话人格】\n${persona.trim()}`);
    return (
        refs.length &&
            parts.push(
                ...refs.map(
                    (ref) => `【参考·${ref.title}】
${ref.text}`,
                ),
            ),
        g.text &&
            parts.push(`【${g.title || '写作基准'}】
${g.text}`),
        parts.join(`

`)
    );
}

export function needsFold(messages) {
    const live = messages.filter((msg) => !msg.folded);
    const chars = live.reduce((sum, msg) => sum + String(msg.content || '').length, 0);
    return live.length > FOLD_KEEP + 4 || chars > FOLD_CHARS;
}

export function foldCandidates(messages) {
    const live = messages.filter((msg) => !msg.folded);
    return live.slice(0, Math.max(0, live.length - FOLD_KEEP));
}

export function foldMessages(summary, messages) {
    const text = messages.map((msg) => `${msg.role === 'user' ? '用户' : 'AI'}：${msg.content}`).join('\n\n');
    return [
        {
            role: 'system',
            content:
                '把下面的讨论压缩成要点摘要：保留已经敲定的设定、人物关系、剧情走向和仍未决定的问题，删掉寒暄和被否掉的方案。只输出摘要。',
        },
        { role: 'user', content: `${summary ? `【已有摘要】\n${summary}\n\n` : ''}【新的讨论】\n${text}` },
    ];
}

export function chatRequest(system, summary, messages) {
    const out = [{ role: 'system', content: system }];
    if (summary) out.push({ role: 'system', content: `【之前讨论的摘要】\n${summary}` });
    for (const msg of messages.filter((item) => !item.folded))
        out.push({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content });
    return out;
}

export function transcript(summary, messages, limit = 30000) {
    const text = messages
        .filter((msg) => !msg.folded)
        .map((msg) => `${msg.role === 'user' ? '用户' : 'AI'}：${msg.content}`)
        .join('\n\n');
    const joined = `${summary ? `【摘要】\n${summary}\n\n` : ''}${text}`;
    return joined.length > limit ? joined.slice(-limit) : joined;
}

const refBlock = (refs) =>
    refs && refs.length ? `【世界书参考】\n${refs.map((ref) => `〔${ref.title}〕\n${ref.text}`).join('\n\n')}` : '';

export function settingMessages({ guide, talk, current, append, refs = [] }) {
    const system = `${guide}

${SETTING_SECRET_RULE}

按上面的规则产出，只回「世界观正文」「补定」「速查」三段。`,
        user = [
            current
                ? `【已有世界观正文】
${current}`
                : '',
            append ? '已有正文不改动，只把新增事实写成一段 [追加]。' : '',
            talk
                ? `【讨论记录】
${talk}`
                : '',
            refBlock(refs),
        ].filter(Boolean).join(`

`);
    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

export function rewriteBlockMessages({ guide, current, blockText, fixes }) {
    return [
        {
            role: 'system',
            content: `${guide}

${SETTING_SECRET_RULE}

只重写用户指定的一个分块，保留分块标题行，只输出这个分块。`,
        },
        {
            role: 'user',
            content: `【完整正文】
${current}

【要重写的分块】
${blockText}

【用户的修改】
${fixes}`,
        },
    ];
}

function formatSample(volumes) {
    for (const volume of volumes || []) {
        const stage = volume.stages[0];
        if (stage) return `${volume.key}:\n${stageToText(stage).replace(/^/gm, '  ').trimEnd()}\n`;
    }
    return SAMPLE_STAGE;
}

const OUTLINE_RULES = [
    '只输出一个 ```yaml 代码块，不加说明。',
    '顶层键是卷名，写作「剧情_卷X_标题」；卷下是阶段，写作「阶段N_标题」；阶段字段为 时间范围、AI指令、主线节点、支线事件、世界动态、状态变化。',
    '节点字段：名称、地点、事件、偏转；支线事件多一个 触发；世界动态为 类型、来源、内容。',
    '支线事件可选条件、时限、错过和步骤；世界动态可选进度钟、前兆和后果。只有适用时填写。',
    '每个阶段 2 到 4 个主线节点，事件写已经发生的事实。',
    '偏转默认不写：只有用户的选择确实会改变后续时，才给那个节点写偏转，多数节点没有这一项。写的时候说明原计划里哪一步仍然成立、哪一步可以略过；已有其他途径达成同一目的时，沿那条途径继续；缺少必要条件时，允许这件事暂时悬着。',
    '事件只写这一阶段玩家能看到、经历到的事；幕后答案、真相写进 <仅作者>…</仅作者>，不要直接写进事件。',
    '时间范围写清本阶段从什么时候到什么时候，用来判断何时切到下一段。',
    '状态变化逐条写本阶段结束时人物关系、认知和信息差比开局变了什么，没有变化就省略。',
].join(`
`);

// 各阶段的状态变化按顺序列出，写后续大纲时接着这些变化往下写。
function changesBlock(units, title) {
    const lines = units.flatMap((unit) => changeLines(unit.stage.data).map((text) => `- ${stageLabel(unit.stage.key)}：${text}`));
    return lines.length ? `【${title}】\n${lines.join('\n')}` : '';
}

// rest：只改写这几段（按线改写时只有目标线的；不给就是从 from 到全书末尾）
function restText(units, from, rest = null) {
    const byVolume = new Map();
    for (const unit of rest || units.slice(from)) {
        if (!byVolume.has(unit.volume)) byVolume.set(unit.volume, []);
        byVolume.get(unit.volume).push(unit.stage);
    }
    return outlineToText([...byVolume.entries()].map(([volume, stages]) => ({ ...volume, stages })));
}

export function outlineMessages({
    setting,
    talk,
    volumes,
    volumeNo,
    request,
    mode = 'outline',
    refs = [],
    clueIndex = '',
    progress = '',
    recent = '',
    tableCatalog = '',
}) {
    let clue = mode === 'clue',
        known = knownVolumesText(volumes),
        system = clue
            ? `你按用户的设定写线索推进模式的剧情大纲，格式必须与样例一致。
${CLUE_OUTLINE_RULES_WITH_LINES}

【格式样例】
${CLUE_SAMPLE_STAGE}`
            : `你按用户的设定写剧情大纲，格式必须与样例一致。
${OUTLINE_RULES}

【格式样例】
${formatSample(volumes)}`,
        user = [
            setting
                ? `【设定】
${setting}`
                : '',
            talk
                ? `【讨论摘要】
${talk}`
                : '',
            clue
                ? refsBlock(refs)
                : refs.length
                  ? `【世界书参考】
` + refsBlock(refs)
                  : '',
            ...(clue ? [] : [changesBlock(flattenUnits(volumes), '已有大纲中的状态变化')]),
            known.length
                ? `【已有的${clue ? '剧情线' : '卷'}】
${known.join(`
`)}`
                : '',
            clue && clueIndex
                ? `【已有节点与事实编号（新节点的 id 和事实编号不要与这些重复；可以引用其中已有的事实）】
${clueIndex}`
                : '',
            clue ? tableCatalog : '',
            progress,
            recent
                ? `【最近正文】
${recent}`
                : '',
            // 线索模式：请求放在一大段表格目录后面时，模型偶尔会忽略请求、接着写已有的主线。写明这一卷就是这个要求。
            clue && request
                ? `只写一条新的剧情线（YAML 里的第 ${volumeNo} 卷），它的内容就是下面这个要求（不要续写、重写、改动已有的剧情线，编号不要和已有的线重复）：
${request}`
                : `只写第 ${volumeNo} 卷。${request || ''}`,
        ].filter(Boolean).join(`

`);
    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

// 按线改写（大型项目方案 四.1）：只改这一条线，别的线只给紧凑参考。
export const ONE_LINE_RULE =
    '这次只改写【需要改写的剩余阶段】里的这一条剧情线：只输出这一条线（顶层键照抄），不要输出别的线。【其他剧情线】只作参考，不能改动；别的线用到的节点 id 和事实编号要保留。';

export function rewriteRestMessages({ setting, volumes, fromUnitIndex, units, recent, reason, rest = null, others = '' }) {
    // 按线改写：格式样例取目标线、已演完的状态变化也只取目标线，别的线的正文不进请求（方案 四.1）
    const own = rest && rest.length ? rest[0].volume : null,
        sample = own ? [own] : volumes,
        done = units.slice(0, fromUnitIndex).filter((u) => !own || u.volume === own);
    const system = `剧情在执行中偏离了大纲。按已经发生的正文改写剩余阶段，保持卷名与阶段名格式。${rest ? `\n${ONE_LINE_RULE}` : ''}\n${OUTLINE_RULES}\n\n【格式样例】\n${formatSample(sample)}`;
    const user = [
        setting ? `【设定】\n${setting}` : '',
        changesBlock(done, '已演完阶段的状态变化'),
        `【需要改写的剩余阶段】\n${restText(units, fromUnitIndex, rest)}`,
        others,
        reason ? `【偏转说明】\n${reason}` : '',
        `【最近正文】\n${recent}`,
    ]
        .filter(Boolean)
        .join('\n\n');
    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

// 大纲调整后按大纲校对设定：只改与大纲冲突、或把会变的关系与认知写死的句子。
export function syncSettingMessages({ guide, setting, units, fromUnitIndex = 0, reason = '', rest = null }) {
    const system = [
        guide,
        '剧情大纲已经调整。对照【剧情大纲】校对【已有世界观正文】：找出与大纲冲突的句子，以及把人物关系、认知、信息差、人物走向写成永远不变的句子，只改这些句子，改写成开局状态或留白；同一件事在几个分块里重复出现时，只留在最合适的一处；其余文字逐字保留，分块标题不变。',
        '原有 <仅作者> 区块必须保持仅作者属性，标签完整保留。不能把其中的真相、未来发展、作者备注写到公开分块里。',
        '只回「世界观正文」「速查」两段。世界观正文输出改好后的完整全文；没有需要改的句子时原样输出。',
    ].join('\n\n');
    const own = rest && rest.length ? rest[0].volume : null;
    const user = [
        `【已有世界观正文】\n${setting}`,
        changesBlock(
            units.slice(0, fromUnitIndex).filter((u) => !own || u.volume === own),
            '已演完阶段的状态变化',
        ),
        `【剧情大纲】\n${restText(units, fromUnitIndex, rest)}`,
        reason ? `【调整原因】\n${reason}` : '',
    ]
        .filter(Boolean)
        .join('\n\n');
    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

export function fixYamlMessages(text, error, mode = 'outline') {
    return [
        {
            role: 'system',
            content: `修正下面 YAML 的格式错误，内容不变。
${mode === 'clue' ? CLUE_OUTLINE_RULES : OUTLINE_RULES}`,
        },
        {
            role: 'user',
            content: `【错误】${error}

${text}`,
        },
    ];
}

// 从回复里取 YAML：优先 ```yaml 代码块，其次任意代码块，最后整篇。
// 多个合法且顶层键不同的 YAML 块自动合并，避免丢卷。all=true 时严格解析所有块，坏块报错。
export function extractYaml(text, { all = !1 } = {}) {
    if (all) {
        const blocks = [...String(text || '').matchAll(/```ya?ml\s*\n([\s\S]*?)```/gi)].map((m) => extractYaml(m[1]));
        if (blocks.length)
            return blocks.join(`

`);
    }
    let raw = String(text || ''),
        fenced = /```ya?ml\s*\n([\s\S]*?)```/i.exec(raw) || /```\s*\n([\s\S]*?)```/.exec(raw),
        blocks = [...raw.matchAll(/```ya?ml\s*\n([\s\S]*?)```/gi)].map((m) => m[1].replace(/^﻿/, '').trim()).filter(Boolean);
    if (blocks.length > 1)
        try {
            let keys = [];
            if (
                blocks.every((b) => {
                    let v = parseYaml(b);
                    return isPlainObject(v) && (keys.push(...Object.keys(v)), !0);
                }) &&
                new Set(keys).size === keys.length
            )
                return blocks.join(`
`);
        } catch {}
    let body = (fenced ? fenced[1] : raw)
        .replace(/^﻿/, '')
        .replace(/^([ \t]*(?:- )?)[​-‍⁠﻿]+/gm, '$1')
        .trim();
    try {
        return (parseYaml(body), body);
    } catch {}
    return fixOffByOneKeys(fixFullWidthKeys(body));
}

export function hasYamlBlock(text) {
    return /```ya?ml\s*\n[\s\S]*?```/i.test(String(text || ''));
}

export function parseOutlineReply(text, idOf, { all = false } = {}) {
    const yaml = extractYaml(text, { all });
    try {
        return { ok: true, yaml, volumes: volumesFromValue(parseYaml(yaml), idOf) };
    } catch (error) {
        const line = yamlErrorLine(error);
        return { ok: false, yaml, line, error: `${line ? `第 ${line} 行：` : ''}${String(error.message || error).split('\n')[0]}` };
    }
}

// outline v0.1.23：单阶段 AI 操作（细化节点 / 拆成两段 / 与下一段合并）。
const STAGE_OPS = {
    refine: '细化节点：保持阶段名不变，把现有节点写得更具体（事件写清谁做了什么、结果如何，偏转写清分支），必要时补充缺少的节点，不改变阶段的整体走向与时间范围。只输出这一个阶段。',
    split: '拆成两段：把这个阶段按剧情先后拆成两个阶段，阶段名沿用「阶段N_标题」格式，两段的时间范围首尾相接且不重叠，节点、支线事件、世界动态按发生时间分到两段，状态变化归入对应的段。输出两个阶段。',
    merge: '与下一段合并：把「当前阶段」和「下一阶段」合成一个阶段，阶段名取能概括两段的标题，时间范围覆盖两段，节点、支线事件、世界动态按时间顺序合并并去掉重复，状态变化全部保留。输出一个阶段。',
};

export function stageOpMessages({ setting, talk = '', refs = [], volumes, unit, next, op, request, mode = 'outline', progress = '' }) {
    const rule = mode === 'clue' ? STAGE_OPS[op] && STAGE_OPS[op].replace('节点、支线事件、世界动态', '剧情节点、可选事件、世界动态') : STAGE_OPS[op];
    if (!rule) throw new Error('不支持的阶段操作');
    const system = [
        '你在调整剧情大纲中的单个阶段，格式必须与样例一致。',
        mode === 'clue' ? CLUE_OUTLINE_RULES : OUTLINE_RULES,
        ...(mode === 'clue'
            ? [
                  '保留已有节点的 id、发现里的事实编号和完成条件。已完成节点、已确认事实是已经发生的历史，不能改写或删掉。拆分阶段时，同一个节点只放在其中一个阶段。',
              ]
            : []),
        '阶段里的字段（时间范围、AI指令、主线节点、支线事件、世界动态、状态变化，以及其他任何键）原样保留或合理改写，不要丢键。',
        `顶层键只写所属${mode === 'clue' ? '剧情线' : '卷'}的名字「${unit.volume.key}」，下面只放结果阶段。`,
        rule,
        `【格式样例】\n${formatSample(volumes)}`,
    ].join('\n');
    const units = flattenUnits(volumes);
    const before = units.slice(
        0,
        units.findIndex((item) => item.id === unit.id),
    );
    const user = [
        setting ? `【设定】\n${setting}` : '',
        talk ? `【讨论摘要】\n${talk}` : '',
        refBlock(refs),
        changesBlock(before, '此前阶段的状态变化'),
        `【当前阶段】\n${volumeStageText(unit.volume, unit.stage)}`,
        next ? `【下一阶段】\n${volumeStageText(unit.volume, next)}` : '',
        progress,
        request ? `【额外要求】\n${request}` : '',
    ]
        .filter(Boolean)
        .join('\n\n');
    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

function volumeStageText(volume, stage) {
    return outlineToText([{ ...volume, stages: [stage] }]);
}

export const SETTING_SECRET_RULE = [
    '【保密规则，优先于上面的基准】这份设定每一轮都会交给正文模型。',
    '用户明确说过暂时不揭示的内容（幕后真相、真实身份、谁是真凶、结局安排），完整写进一段 <仅作者>…</仅作者>，放在世界观正文的最后，插件不会把它交给正文。这一段必须写，不能因为要保密就省略：作者以后写大纲还要用。',
    '<仅作者> 以外的所有分块（声明、铁则、信息差、人物、核心矛盾、说明……）都不能出现秘密里的人名和关系：不写「真相只有某某知道」「某某是经手人」这类句子。',
    '要写知情差时，写成「有人知道货的真实去向，主角和沈砚都不知道」，不点出是谁。',
].join('\n');

export const CLUE_SAMPLE_STAGE = `剧情_卷一_示例:
  阶段一_报案:
    AI指令: 节奏平缓，以日常对话为主。
    主线节点:
      - id: n01_report
        名称: 接受报案
        入口: 去杂货店看看出了什么事
        地点: 杂货店
        场景: 老板娘神色慌张，柜台后的钱箱被撬开了。
        发现:
          - 事实: F01
            内容: 钱箱的锁是从里面被撬开的。
            记录: 主角亲自查看钱箱并看出撬痕方向时，记 F01 为已核实。
        完成条件: {事实: F01}
        作者备注: <仅作者>真正的小偷是老板娘的侄子。</仅作者>
  阶段二_调查:
    AI指令: 允许玩家自由选择先查哪条线。
    # 账本是必需节点；另外证词和后门手印任有一样，本阶段才结束（证人拒绝作证时，凭手印也能继续）。
    结束条件: {任一: [{事实: F03}, {事实: F05}]}
    主线节点:
      - id: n02_ledger
        名称: 查账本
        入口: 翻一翻店里的账本
        地点: 杂货店后屋
        场景: 后屋堆着几年的账本，最近一本有被撕掉的页。
        发现:
          - 事实: F02
            内容: 被撕掉的那页记着一笔给侄子的赊账。
            记录: 主角实际读到这页内容时，记 F02 为已核实。
        完成条件: {事实: F02}
      # 下面两个节点是「对质」的两条替代途径：任走一条就能继续，所以都不是必需节点。
      - id: n03_witness
        名称: 问邻居
        入口: 去问问隔壁裁缝铺的邻居
        地点: 裁缝铺
        场景: 裁缝铺的老人耳背，但记性很好。
        必需: false
        发现:
          # F03 追踪的是「老人对主角说了这件事」这个发言本身，主角亲耳听见即可确认；说的内容是否属实是另一回事。
          - 事实: F03
            内容: 老人说案发当晚看见有个年轻人从后门出来。
            记录: 老人当面对主角讲出案发当晚看到的情况时，记 F03 为已核实（核实的是他说过这话，不是内容属实）。
        完成条件: {事实: F03}
      - id: n05_backdoor
        名称: 查后门
        入口: 去看看杂货店的后门
        地点: 杂货店后门
        场景: 后门对着一条窄巷，门闩有些松动。
        必需: false
        发现:
          - 事实: F05
            内容: 门闩上有新鲜的黑色机油手印。
            记录: 主角亲自查看门闩并看到手印时，记 F05 为已核实。
        完成条件: {事实: F05}
  阶段三_对质:
    主线节点:
      - id: n04_confront
        名称: 找侄子
        入口: 去找老板娘的侄子谈谈
        地点: 镇口修车铺
        场景: 侄子在修车铺打零工，看到主角时手里的扳手掉在了地上。
        发现:
          - 事实: F04
            内容: 他承认拿了钱。
            记录: 正文写出他亲口承认拿钱时，记 F04 为已核实；内容只写他实际说出的部分。
        完成条件: {事实: F04}
        相关事实: [F02, F03, F05]
`;

export const CLUE_OUTLINE_RULES = [
    '只输出一个 ```yaml 代码块，不加说明。',
    '顶层键是剧情线的名字「剧情_卷X_标题」（YAML 里照旧叫卷），下面是阶段「阶段N_标题」。阶段字段：AI指令、主线节点、支线事件，可选 进入条件、结束条件。不写时间范围。',
    '· 叫法对照：作者界面上说的「剧情线」= YAML 顶层的一卷；「剧情节点」= 阶段里的 主线节点:；「可选事件」= 阶段里的 支线事件:。输出时只用 YAML 键名（主线节点、支线事件），不要写成「剧情节点:」「可选事件:」。',
    '线索模式按「拿到什么才能往下走」组织剧情，不按时间排事件。每个节点是一处可以调查、交谈或行动的场景，可以持续多楼，允许失败、离开、再回来。不要为走路、寒暄这类动作单独建节点。',
    '节点字段：id、名称、入口、地点、场景、发现、完成条件，可选 开放条件、提前条件、相关事实、必需、作者备注。',
    '· id：英文字母开头的稳定编号（如 n05_archive），全大纲唯一。已有节点的 id 不要改。',
    '· 名称、作者备注只给作者看；入口是节点开放后告诉正文「可以去做这件事」的一句话，不能含答案。',
    '· 地点写具体的地方（如「码头仓库值夜棚」），不写「附近」「街上」。一段剧情要用到几个地方时都列出来：地点: [码头仓库, 值夜棚]。',
    '· 场景写进入时看到的情况，不写调查结果。',
    '· 发现：列表，每项是 {事实, 内容, 记录}。事实是事实编号（如 F05）；内容是查到时可以揭示的结果；记录是给填表模型的判断标准，写清「正文出现什么才算拿到」，不要复述答案。',
    '· 一个事实编号只记一件能单独揭示的事；能分开知道的两件事拆成两个编号。',
    '· 先明确这个编号追踪哪件事。「老人确实对主角说了这句话」可以由主角亲耳听见来确认；「老人所说的事情是真的」仍需独立证据，要用另一个编号。门槛要求「取得证词」时，用追踪发言的那个编号，不要用「知情」（「知情」连主角自己的推测也算）。',
    '· 只是传闻、推测或未经证实的说法，记录里写「记为存疑」；只有可靠实物、明确验证或亲耳听到的发言本身，才记为已核实。',
    '条件写法（YAML 对象，最多两层组合）：{事实: F01}（正文里已经出现：已核实，或证词、传闻已经说出口记为存疑都算）、{核实: F01}（必须已核实，说法不算）、{知情: F01@角色}（该角色有任何知情记录，含传闻和自己的推测）、{核实: F01@角色}、{节点: n01}（节点已完成）、{全部: [...]}、{任一: [...]}。主角写作 user。',
    '· 门槛只要求「听到了这番话」「拿到了这份证词」时用 {事实}；要求「这件事被证实」时才用 {核实}。证词、传闻类的发现在填表时记为存疑，如果用 {核实} 去等它，节点永远完不成。',
    '· 完成条件必须写，并且只依赖本节点自己的发现，或正文中可以确定的知情。',
    '· 开放条件 / 进入条件依赖之前节点的发现。同一阶段的多个节点尽量互不依赖，让玩家可以自选顺序。',
    '· 关键结论最好有两条获得途径（用「任一」），避免某个角色不配合就永远卡住。替代途径上的节点写「必需: false」，各条途径产出的事实都写进下一步条件的「任一」里。能不能走通由插件按条件检查。',
    '· 只引用大纲里确实有节点产出的事实编号。',
    '真相、幕后安排等不能提前给正文的内容，写在作者备注里，用 <仅作者>…</仅作者> 包住。',
    '每个阶段 1 到 4 个剧情节点（主线节点:）。可选事件（支线事件:）可以不写，写法与剧情节点相同，默认不阻塞阶段。',
].join(`
`);

export function knownVolumesText(volumes) {
    return (volumes || []).map((volume) => `${volumeLabel(volume.key)}：${volume.stages.map((stage) => stageLabel(stage.key)).join('、')}`);
}

export function refsBlock(refs) {
    return (refs || [])
        .filter((ref) => ref && String(ref.text || '').trim())
        .map(
            (ref) => `【参考·${ref.title}】
${ref.text}`,
        ).join(`

`);
}

export function clueRewriteMessages({
    setting,
    volumes,
    fromUnitIndex,
    units,
    recent,
    reason,
    progress = '',
    refs = [],
    talk = '',
    rest: only = null,
    others = '',
}) {
    let rest = only || units.slice(fromUnitIndex),
        byVolume = /* @__PURE__ */ new Map();
    for (let unit of rest) (byVolume.has(unit.volume) || byVolume.set(unit.volume, []), byVolume.get(unit.volume).push(unit.stage));
    let restText = outlineToText([...byVolume.entries()].map(([volume, stages]) => ({ ...volume, stages }))),
        system = `剧情在执行中偏离了大纲。按已经发生的正文和线索进度，改写线索推进模式的剩余阶段，保持剧情线名（顶层键）与阶段名格式。${only ? `\n${ONE_LINE_RULE}` : ''}
${CLUE_OUTLINE_RULES}
改写时另外遵守：
· 已完成节点、已确认事实是已经发生的历史，不能改写、不能删除，后面的条件可以继续引用它们。
· 尚未完成的节点保留原来的 id；内容可以调整。新增节点用新的 id。
· 和已发生剧情冲突的地方，在相关节点的作者备注里用 <仅作者> 写出「原计划 → 调整」，不要默默改掉。

【格式样例】
${CLUE_SAMPLE_STAGE}`,
        user = [
            setting
                ? `【设定】
${setting}`
                : '',
            talk
                ? `【讨论摘要】
${talk}`
                : '',
            refsBlock(refs),
            progress,
            `【需要改写的剩余阶段】
${restText}`,
            others,
            reason
                ? `【偏转说明】
${reason}`
                : '',
            recent
                ? `【最近正文】
${recent}`
                : '',
        ].filter(Boolean).join(`

`);
    return [
        { role: 'system', content: system },
        { role: 'user', content: user },
    ];
}

export const YAML_BLOCK_HEAD = /^ *(?:- )?[^\s#][^:：]*[:：]\s*[|>][-+0-9]*\s*$/;

export function yamlBlockLines(lines) {
    let inBlock = /* @__PURE__ */ new Set(),
        head = -1,
        body = -1;
    lines.forEach((line, i) => {
        let ind = /^( *)/.exec(line)[1].length;
        if (head >= 0) {
            if (!line.trim()) return inBlock.add(i);
            if (body < 0 && ind > head) body = ind;
            if (body >= 0 && ind >= body) return inBlock.add(i);
        }
        ((head = YAML_BLOCK_HEAD.test(line) ? ind : -1), (body = -1));
    });
    return inBlock;
}

export function fixOffByOneKeys(yaml) {
    let lines = yaml.split('\n'),
        inBlock = yamlBlockLines(lines);
    for (let i = 1; i < lines.length; i++) {
        if (inBlock.has(i)) continue;
        let m = /^( +)([^\s#-][^:]*):(\s.*)?$/.exec(lines[i]);
        if (!m || m[1].length % 2 === 0) continue;
        // 往上找缩进不超过「本行 + 1」的最近一个字段名行。它比本行多 1 格：本行少了一格，补上；
        // 它比本行少 1 格、而且自己带着值（不是开出子映射的「键:」）：它是同级，本行多了一格，去掉。
        let n = m[1].length,
            prev = lines
                .slice(0, i)
                .map((l, k) => (inBlock.has(k) ? '' : l))
                .reverse()
                .find((l) => /^( *)[^\s#-][^:]*:/.test(l) && /^( *)/.exec(l)[1].length <= n + 1);
        if (!prev) continue;
        let p = /^( *)/.exec(prev)[1].length,
            opensMap = /:\s*$/.test(prev);
        p === n + 1 ? (lines[i] = ' ' + lines[i]) : p === n - 1 && !opensMap && (lines[i] = lines[i].slice(1));
    }
    return lines.join('\n');
}

export function fixFullWidthKeys(yaml) {
    let lines = yaml.split('\n'),
        inBlock = yamlBlockLines(lines);
    return lines
        .map((line, i) => (inBlock.has(i) ? line : line.replace(/^( *(?:- )?)([^\s:：#-][^\s:：]*)：(?=\s|$)/, '$1$2:')))
        .join('\n');
}

export { OUTLINE_RULES };

// 入口提示：线可以开始、主角还没去做时，插件把它作为「可以去做的事」的由头交给正文（lines.js 的 offer.hint）。
// 要 AI 顺手写好，不让作者自己想。对比见 开发/import-lab/entry-check.mjs。
export const BRIEF_RULE = [
    '· 简介（每条线都必须写）：一句话说这条线讲的是什么事，给作者在执行页、审阅页一眼认出这条线用。',
    '  - 写成「谁 + 遇到什么事 + 主角要做什么」，具体到人和事，十五到三十字。',
    '  - 只写开头的处境和要做的事：不写结局，不写后面才揭开的真相（谁在背后、东西从哪来、为什么），保密的名字用称呼代替；不写开始条件。',
    '  - 和入口提示分开写：入口是事情怎么找上主角，简介是这条线整体要处理什么。',
].join('\n');
export const ENTRY_HINT_RULE = [
    '· 入口提示（每条线都必须写）：一句话，写这条线可以开始以后，主角在日常里会碰到的一个具体由头。插件会在这条线能开始、但主角还没去做的时候，把它作为「可以去做的事」提示给正文；正文只在主角的行动自然碰到时才接入。',
    '  - 写成一件主角能看到、听到或收到的事：一条消息、一个人的请求、路过时注意到的东西、一则新闻。具体到人、地点或物件。',
    '  - 写主角开始参与这条线时能感知到的具体由头，优先沿用原文。原文中主角已经在现场，就写眼前使他继续参与的变化，不另编邀约，也不让他重新到场。只写开始参与前或当下可见的信息，不是第一个场景本身；主角不在的地方发生的事不要写成由头。',
    '  - 原文写了由谁、因为什么找上主角，就照那个写；原文没写，按第一个场景合理地编一个最轻的由头，但不改写原文明确的开始时机。',
    '  - 只写钩子，不写后面会发生什么、不写调查结果和真相；不写「你可以去」「是否前往」这类对玩家说的话；不写开始条件（那是程序判断的）。',
    '  - 一句话，二三十字左右，像正文里会出现的一句叙述，用第三人称（主角的名字或称呼），不用「你」。',
    '  - 主角的称呼跟着这条线里的人走：这条线里的人只知道他的某个称号、代号或化名时，入口里也用那个称呼；原文这一段一直怎么叫他，就照原文叫。',
].join('\n');

export const CLUE_LINE_RULES = [
    'YAML 里的每一卷就是一条剧情线（主线或支线）：在它的第一个键写「线」，其余键照旧是阶段。多条线可以同时进行，各自推进。',
    '· 线的字段：编号（M1、S07 这样，全大纲唯一）、类型（主线 / 支线）、简介（见下）、开启条件、开启时段（可选）、入口提示（见下）。',
    BRIEF_RULE,
    ENTRY_HINT_RULE,
    '· 线怎么开始：主线的开启条件满足就开始（同一时间只有一条主线，按顺序）；支线的开启条件满足后，正文会在空闲时提一句入口，玩家走进第一个阶段的场景才开始。所以支线第一个阶段要有一个不需要别的条件就能开始的节点，它的入口写成玩家能主动去做的事。',
    '· 开启时段：支线只在某条主线的某几个阶段里能开时写，{主线: M1, 从: 阶段2, 到: 阶段3}（阶段写短名）。过了还没开始就不再出现。不限就不写。它是线的一个单独字段「开启时段:」，和「开启条件:」并列，不要写进开启条件里。',
    '· 开启方式（可选，一般不写）：要求没法用条件写准时（表里没有能代表它的列，如「和大家一起出过任务」「单独来往过」），写「开启方式: 人工」，开启条件不写，把原来的要求写成一句话放在「原开启条件」里；玩家自己点「进入」开始。能用条件写准的不要写人工。',
    '· 开启条件用上面的条件写法，另外可以用：{线: S07 == 完成}（另一条线的状态：未触发 / 可开启 / 进行中 / 暂停 / 完成 / 放弃，或「开过」「开着」）、{表: 表名/行/列 >= 2}（读数据库表格的一格，和数据库剧情推进的写法一样）、{计数: {表: 表名, 条件: 列 >= 2, 至少: 3}}（满足条件的行数）。',
    '· 「某条线做完以后再开」写 {线: 编号 == 完成}，不要写成那条线里某个节点的条件（那条线以后可能还会加阶段）。',
    '· 开启条件保持要求的原意：表里有对应的列，用表格条件；要求本身就是正文里会发生的一件事（「收到报社的信」），写 {事实: 新编号}；两样都写不准（例：要求「声望到 50」，表里没有声望），不要换成别的门槛（别的列、自己想的一件事），按上面写「开启方式: 人工」并保留原要求。',
    '· 读表格的条件：表名、列名必须是【当前数据库的表格】里列出的；要读的那个人暂时没有行可以照写（有了行才开始判断），但不能拿别人的行代替。',
    '· 开启条件里的事实可以不由任何节点产出：插件会把它作为一条线索加进表格，正文里发生了就由填表记下。但不能由这条线自己的节点产出（线没开始，它的节点都打不开，会互相等）。',
    '· 这样新建的事实，编号要看得出是什么事，带上线的编号（如 F_s02_asked_for_help），不要用 F30 这种流水号；同时把这件事写成一句话放进「原开启条件」（如「委托人通过同伴请主角帮忙」），填表时按这句话判断它有没有发生。',
];

export const CLUE_OUTLINE_RULES_WITH_LINES = `${CLUE_OUTLINE_RULES}
${CLUE_LINE_RULES.join(`
`)}
· 上面说的「只引用有节点产出的事实编号」，线的开启条件例外：它里面的事实可以不需要节点产出。
· 【当前数据库的表格】里已经有某个地方时（地点表、全局表的当前地点、角色表的所在地点），节点的地点用表里已有的叫法。`;

export const CATALOG_NOTE_HINT = /只能|格式|阶段|档|等级|顺序|分隔|→|升|降|之一|[^\s/]\s*\/\s*[^\s/]/;

export const CLUE_OWN_SHEETS = ['线索控制表', '关键事实表', '知情表'];

export function catalogNote(note, head, cap = 900) {
    let text = String(note || '').replace(new RegExp(`${CLUE_TPL_MARK_BEGIN}[\\s\\S]*?${CLUE_TPL_MARK_END}`, 'g'), ''),
        out = [],
        used = 0;
    for (let line of text
        .split(/\r?\n/)
        .map((l) => l.trim())
        .filter(Boolean)) {
        if (
            /^[×✗❌]/.test(line) ||
            !(head.some((h) => h.length > 1 && line.includes(h)) || CATALOG_NOTE_HINT.test(line) || /^\d+\s*\S/.test(line))
        )
            continue;
        let l = line.length > 160 ? `${line.slice(0, 160)}…` : line;
        if (used + l.length > cap) {
            out.push('……');
            break;
        }
        (out.push(l), (used += l.length));
    }
    return out;
}

export function tableCatalogText(tables) {
    let list = sheetList(tables || {}).map((s) => {
        let all = /地点/.test(s.name),
            limit = all ? 200 : 8,
            head = (Array.isArray(s.content[0]) ? s.content[0] : [])
                .slice(1)
                .map((c) => String(c ?? '').trim())
                .filter(Boolean),
            data = sheetRows(s),
            rows = data.rows
                .map((r) => String(r[1] ?? '').trim())
                .filter(Boolean)
                .slice(0, limit),
            line = `- ${s.name}：列 ${head.join('、') || '（无）'}${rows.length ? `；现有行 ${rows.join('、')}${data.rows.length > limit ? '……' : ''}` : ''}`;
        if (all || CLUE_OWN_SHEETS.includes(s.name)) return line;
        let samples = head
                .map((h) => {
                    let c = data.col(h),
                        vals = c < 0 ? [] : [...new Set(data.rows.map((r) => String(r[c] ?? '').trim()).filter(Boolean))].slice(0, 2);
                    return vals.length ? `  · ${h}：${vals.map((v) => `「${v.length > 40 ? `${v.slice(0, 40)}…` : v}」`).join(' ')}` : '';
                })
                .filter(Boolean),
            note = catalogNote(s.note, head);
        return [
            line,
            ...(samples.length ? ['  现有的值：', ...samples] : []),
            ...(note.length ? ['  表格说明（摘录）：', ...note.map((x) => `    ${x}`)] : []),
        ].join(`
`);
    });
    return list.length
        ? `【当前数据库的表格（读表格的条件只能用这些表名、列名和现有的行）】
${list.join(`
`)}
写 {表: …} 或 {计数: …} 之前先核对：要求里说的那个数值（关系、声望、金钱……），上面的表里真的有这一列吗？没有就不要用表格条件，也不要拿意思不同的列（比如用关系阶段代替声望）凑数，也不要自己换成等某件事——写「开启方式: 人工」，原要求放进「原开启条件」。
这个人暂时没有行时，可以照同一列别的行的写法写（有了行才开始判断）；不能拿别人的行代替。
文字列照表格说明里规定的词写（说明里写了「只能填 …」就只用那几个词），不要自己造词。
一格里写了好几个人（如「甲:认识;乙:室友」）时，必须加「取: 名字」只读那个人的那一项，例：{表: 角色表/某人/人际关系 包含 朋友, 取: 主角名}。不要写成「包含 主角名:朋友」（那样「主角名:队友,朋友」就对不上）。
上面「现有的值」或表格说明里**有**这一列真实的、写了好几个人的一格时，再加一个样例，原文照抄那一格：样例: {原文: "照抄的那一格", 取: 那格里的一个名字, 得: 这个名字冒号后面的全部内容}（原文和得用英文双引号括起来）。**没有**这样的真实内容时，不写样例：编出来的样例会让插件把这个条件当成读不懂。
要比「到某一档以上」时写：{表: 表/行/列 >= 友好, 档位: [敌视, 陌生, 友好, 亲密, 相恋]}，档位一律从低到高写全（说明里是从高到低列的，要反过来）。说明里没写先后时也这样写，按常理从低到高排：插件会请玩家确认一次顺序。不要因为没写先后就改成 == 某一档，也不要换成等别的事。
说明里规定的格式是「数字 + 阶段名」（如「2 熟悉」）时，也用档位写法，档位写阶段名。
要数好几个人时：表里有能数的列，就用 {计数: …}，例：「至少三个人关系到 2 以上」、关系表有「阶段」列 → {计数: {表: 关系表, 条件: 阶段 >= 2, 至少: 3}}，这种不要写成人工。表里没有能代表它的列（如「和几个人单独来往过」，表里没有记单独来往的列），不要硬凑，开启条件不写，写「开启方式: 人工」，把原来的要求写进「原开启条件」（一句话）。`
        : '';
}
