// 跑团模式（CoC 7 版）：线索模式之上的一层。计划见 特殊文件/剧情注入器/跑团模式计划.md。
// 项目上存 project.trpg = { on, rule }；线索模式的判断（clue.mode === 'clue'）不变，跑团只在这里加东西：
//   · 导入提示词追加判定规则（发现带「判定」字段）
//   · 注入时把「判定」说明附在发现后面
//   · 从模组原文整理「KP规则:」设定分块
// 线索模式项目没有 trpg、发现没有「判定」，下面这些函数都原样返回空，输出与原来逐字一致。
import { isPlainObject } from '../core/outline.js';

export const TRPG_RULES = [{ value: 'coc7', label: 'CoC 7 版' }];

export const KP_BLOCK = 'KP规则';

export function normalizeTrpg(value) {
    if (!isPlainObject(value)) return null;
    return { on: value.on !== !1, rule: TRPG_RULES.some((r) => r.value === value.rule) ? value.rule : 'coc7' };
}

export function isTrpg(project) {
    return !!(project && project.trpg && project.trpg.on);
}

const LEVELS = ['普通', '困难', '极难'];

// 发现里的「判定」：{ 技能: 侦查 | [侦查, 聆听] | "幸运/侦查", 难度, 暗骰, 失败 }，也接受一句话「侦查（困难）」。
export function normalizeCheck(value) {
    if (value == null || value === '' || value === !1) return null;
    if (typeof value == 'string') {
        let text = value.trim(),
            level = LEVELS.find((l) => text.includes(l)) || '普通',
            skills = text
                .replace(/[（(][^）)]*[）)]/g, '')
                .replace(new RegExp(`(${LEVELS.join('|')})|检定|判定|暗骰`, 'g'), '')
                .split(/[\/、,，或\s]+/)
                .map((s) => s.trim())
                .filter(Boolean);
        return skills.length ? { skills, level, hidden: /暗骰/.test(text), fail: '' } : null;
    }
    if (!isPlainObject(value)) return null;
    let raw = value.技能 ?? value.skill ?? '',
        skills = (Array.isArray(raw) ? raw : String(raw).split(/[\/、,，或]+/)).map((s) => String(s).trim()).filter(Boolean);
    if (!skills.length) return null;
    let level = String(value.难度 || '').trim();
    return {
        skills,
        level: LEVELS.includes(level) ? level : '普通',
        hidden: value.暗骰 === !0 || value.暗骰 === 'true' || value.暗骰 === '是',
        fail: String(value.失败 ?? '').trim(),
    };
}

// 场景材料里有带判定的发现时，追加的一条写作要求。掷骰交给用户（自己掷，或 IGS 论坛安科的 ROLL），正文不掷。
// settings.trpgCheck：'text'（默认，正文写一行【检定】）/ 'anke'（论坛安科标签，IGS 论坛里点 ROLL 掷）。
export const CHECK_MODES = [
    { value: 'text', label: '正文里写一行【检定】' },
    { value: 'anke', label: '论坛安科（IGS 论坛点 ROLL）' },
];
// 成败由插件按骰点算（checkLine），正文不自己判，也看不到没判过的发现内容。
const CHECK_RESULT =
    '成败由插件按骰点算好，写在本轮材料里：材料里写「判定成功」的，这一轮写出那条发现；写「判定失败」的，按失败写，不要写出也不要暗示那条发现；还是「待判定」的说明用户还没掷，不要自己判断成败，也不要猜测会发现什么。用户消息里的骰点不用你来算。用户说成功了、本轮材料里却没有对应的「判定成功」条目时，只写到判定成功、开始有所发现的那一刻，具体发现了什么留到下一轮，绝不要自己编。理智检定不受这条限制：用户掷完后按模组的理智损失结算。';
export const CHECK_RULE = `「待判定」的发现：玩家的行动到了这一步时，在正文末尾写出检定请求「【检定】谁：技能 技能值（难度）#编号」，如「【检定】{{user}}：侦查 60（困难）#F03」。技能从材料里写的技能中挑最合适的一个；技能值从调查员资料里取，查不到就不写；编号照抄材料里的 #编号。写到掷骰之前就停下，不替玩家掷骰，不写结果。暗骰同样写请求，只写技能，不说明在查什么。${CHECK_RESULT}`;
export const CHECK_RULE_ANKE = `「待判定」的发现：玩家的行动到了这一步时，在正文最末另起一行写一个检定安科 [igs-anke:检定|问题|对象|技能|技能值|难度|编号]：问题用楼主的口吻对网友说；对象写真正去做这件事的人（楼主、角色名或 {{user}}）；技能从材料里写的技能中挑最合适的一个；技能值从调查员资料里取，查不到写 50；难度写 普通、困难或极难；编号照抄材料里的 #编号（不带 #）。理智检定也用它，技能写「理智」、技能值写当前理智值、编号写 SAN。写到掷骰之前就停下，不替玩家掷骰，不写结果。${CHECK_RESULT}`;

let igsView = null;
export function setIgsView(v) {
    igsView = v || null;
}
function igsSkillValue(skill) {
    try {
        let inv = igsView?.IGS?.stats?.investigator?.(),
            v = inv && inv.sheet && inv.skills ? inv.skills[skill] : null;
        return typeof v === 'number' && Number.isFinite(v) ? v : null;
    } catch {
        return null;
    }
}

export function checkRule(settings, skills) {
    let rule = settings && settings.trpgCheck === 'anke' ? CHECK_RULE_ANKE : CHECK_RULE;
    if (!Array.isArray(skills)) return rule;
    let list = [...new Set(skills)].map((k) => [k, igsSkillValue(k)]).filter(([, v]) => v != null);
    return list.length ? `${rule}可用的技能值：${list.map(([k, v]) => `${k} ${v}`).join('、')}。` : rule;
}

export function hasChecks(list) {
    return (list || []).some((d) => d && d.check);
}

// ---------- 导入提示词 ----------

export const TRPG_IMPORT_RULES = [
    '【跑团模组（CoC 7 版）附加规则】',
    '这份材料是 CoC 7 版跑团模组，AI 会担任 KP。除上面的规则外：',
    '· 原文写了「××检定 / 成功的××可以 / 过一个××检定」才能得到的信息，写成带「判定」的发现：判定: {技能: 聆听, 难度: 普通, 失败: 失败时正文怎么写}。可以用多种技能之一的写「技能: [幸运, 侦查, 说服]」；难度只写 普通 / 困难 / 极难；原文说 KP 暗骰的加「暗骰: true」。原文没写失败结果的，「失败」省略。',
    '· 判定只放在「发现」里，不要放进开放条件、完成条件。',
    '· 不要因为判定卡死主线：一个必需节点如果只有一条途径、而它要的发现带判定，失败时必须还能往下走。原文写了失败后的替代办法（换人问、付出代价、晚一步）就写进「失败」；原文没写的，「失败」写「仍然得到，但要付出代价（耗时、被人注意或受伤）」，并在「待确认」里注明这是补写。',
    '· 成功程度不同得到的信息不同（大成功多知道一点）的，把多出来的部分拆成另一条发现、另一个事实编号；节点的完成条件只用基本的那一条。',
    '· 理智检定（如 sc0/1d3、0/1d3 的理智鉴定、损失 1D3/2D6 SAN）写在场景末尾的括号里，例如「（目睹尸体：理智检定 0/1d3）」，不要写成发现。',
    '· 战斗、对抗、伤害、计量（如「临界值 +1」「可用厕所 -1」）、按钟点发生的事件、随机表、NPC 和敌人的数值、法术，不要写成节点或发现；插件会把这些另外整理成 KP 规则。和某个节点相关的，在场景或「AI指令」里一句话点到即可（如「这里可能和教徒起冲突」）。',
    '· 模组里的「支线」「随机事件」是可以碰到也可以错过的，写进 支线事件:，「必需: false」。',
    '· 模组里写了时间推进的（某个钟点发生某件事），用阶段的进入条件写「时间 >= HH:MM」，同时并一条「情况: …」作为没绑定时间表时的后备，写成「任一」。例如：进入条件: {任一: [时间 >= 21:00, "情况: 宴会进入尾声，客人开始散去"]}。「情况」是一句话写的现场情况，由 KP 读正文判断；结束条件、开放条件、完成条件也可以这样写。',
    '· 场景要不要开启取决于现场情况、又没有对应线索的，开放条件直接写「情况: …」，不要硬编一个只为开门的事实编号。',
    '· 每个阶段写「状态变化」：本阶段结束时人物处境、NPC 态度、局势比之前变了什么。',
    '· 阶段的「AI指令」只写氛围和主持机制。幕后名称、后面的时间点、破局方法、结局一律写进作者备注，或者在 AI指令里用 <仅作者>…</仅作者> 包起来。不要写「不要揭示 X」这种否定句，这句话本身就把 X 告诉了正文。',
    '· 带判定的发现，「失败」里如果失败后仍能拿到，必须写「仍然得到」这几个字。被检定失败触发的坏结果（如被反锁）不能挂判定，改在发现的「记录」里写「检定失败才算」。',
    '· 必需节点不要只靠「拿到任意一件可选物品」来完成。可选的事情标「必需: false」，阶段结束条件再给出其他路线。',
].join('\n');

// ---------- KP 规则整理 ----------

export const KP_SECTIONS = ['机制与计量', '时间线', '理智检定', '随机事件与随机表', 'NPC与敌人数据', '法术与道具效果', '结局条件', '预设调查员'];

export function kpRulesMessages({ part, total }) {
    return [
        {
            role: 'system',
            content: [
                `你在为 AI 主持人（KP）整理一份 CoC 7 版模组的规则资料。这是第 ${part.i + 1}/${total} 段材料。`,
                '只摘录主持跑团时要查的规则性内容，按下面的小标题分组（本段没有的小标题省略，不要写「无」）：',
                KP_SECTIONS.map((s) => `${s}:`).join('　'),
                '· 机制与计量：特殊机制、需要持续记录的数值（名称、记给谁、初始值、每一档的表现、什么情况加减多少、多久检定一次）。',
                '· 时间线：钟点和对应事件；写明「如果玩家做了什么，事件怎么变」。',
                '· 理智检定：在什么情况下、损失多少（照抄 0/1d3 这类写法）。',
                '· 随机事件与随机表：每一项的触发方式和效果；骰表保留编号。',
                '· NPC与敌人数据：属性、HP、MP、护甲、攻击、技能、闪避，照原文数值抄。',
                '· 法术与道具效果：消耗、用时、效果。',
                '· 结局条件：各结局怎么达成、奖励（如恢复理智）。',
                '· 预设调查员：职业、携带物、个人任务（玩家可以看到的部分）。',
                '数值、骰子表达式、技能名照原文，不换算、不补 CoC 常识；原文没写的不编。剧情叙述、场景描写、氛围文字不要摘。',
                '这份资料每轮都会交给写正文的模型。时间线、结局条件只写触发条件和结果，不写事件真相、幕后人物的真名和身份、凶手是谁；需要指代时用「幕后的人」「那件东西」这类称呼。',
                '每条一行，用「- 」开头，尽量短。只输出这些分组，不加说明。',
            ].join('\n'),
        },
        { role: 'user', content: `【材料：${part.title}】\n${part.text}` },
    ];
}

export function kpMergeMessages(pieces) {
    return [
        {
            role: 'system',
            content: [
                '下面是同一份 CoC 模组分段摘出的 KP 规则。合并成一份：同一小标题的内容放在一起，重复的只留一条，数值以原文为准，不新增内容。',
                `小标题顺序：${KP_SECTIONS.join('、')}。每个小标题单独一行、以冒号结尾，下面每条「- 」开头。只输出合并结果。`,
            ].join('\n'),
        },
        { role: 'user', content: pieces.map((p, i) => `【第 ${i + 1} 段】\n${p}`).join('\n\n') },
    ];
}

// 模型回复 → 设定里的「KP规则:」分块正文。小标题降一级写成「【机制与计量】」，不另起设定分块（设定分块认「标题:」行）。
export function kpBlockText(reply) {
    let body = String(reply || '')
        .replace(/^```[a-z]*\n?|```$/gim, '')
        .split('\n')
        .map((line) => {
            let m = /^\s*(?:#{1,4}\s*)?([^\s\-*#][^:：]{0,20})[:：]\s*$/.exec(line);
            return m ? `【${m[1].trim()}】` : line.replace(/\s+$/, '');
        })
        .join('\n')
        .replace(/\n{3,}/g, '\n\n')
        .trim();
    return body ? `${KP_BLOCK}:\n（KP 资料：主持时按这里裁定；具体数值和幕后信息不要直接告诉玩家，只描写表现。）\n${body}` : '';
}

// ---------- 审阅页「AI 检查」 ----------
// 对照模组原文看导入出来的大纲，只指出问题、不改写；结果按页追加进审阅意见，由作者删改后走原来的「按意见修改」。

export const AI_CHECK_TAG = 'AI 检查：';

// units = [{ label, yaml, source }]；whole = 整份原文（不太长时给整份，否则每页带自己的原文片段）
export function trpgReviewMessages({ units, whole = '' }) {
    return [
        {
            role: 'system',
            content: [
                '你在审稿：下面是从一份 CoC 7 版跑团模组导入的线索大纲（YAML），每一页是一个阶段。对照原文逐页检查，只指出问题，不要改写大纲。',
                '重点查这些：',
                '1. 原文写了「××检定 / 成功的××可以 / 过一个××检定」才能得到的信息，大纲的发现里没有写「判定」，或者技能、难度和原文对不上。',
                '2. 必需节点只有一条途径，它要的发现带判定，却没写「失败」时怎么办（失败就卡住主线）。',
                '3. 理智检定、战斗、伤害、计量（如临界值、可用厕所数）、按钟点发生的事件被写成了节点或发现；理智检定应写在场景末尾的括号里。',
                '4. 入口、场景里提前写出了调查结果、幕后真相或还没到揭示时机的答案。',
                '5. 发现的内容是原文里没有的（编出来的线索），或者原文里重要的线索、调查点漏了。',
                '6. 模组里可以错过的支线、随机事件被写成了必需的主线节点。',
                '每个问题写一行：「- 问题（建议：怎么改）」，指明是哪个节点，尽量短。没问题的页不写。',
                '输出格式：每页先写一行【页N】，下面列这一页的问题；全部没问题时只输出「没有发现问题」。',
            ].join('\n'),
        },
        {
            role: 'user',
            content: [
                whole && `【模组原文】\n${whole}`,
                ...units.map((u, i) => [`【页${i + 1}】${u.label}`, u.source && !whole ? `（对应原文）\n${u.source}` : '', `（大纲）\n${u.yaml}`].filter(Boolean).join('\n')),
            ]
                .filter(Boolean)
                .join('\n\n'),
        },
    ];
}

// 回复 → { 页序号(0 起): [问题行] }
export function parseReviewReply(text, count) {
    let out = {},
        cur = -1;
    for (let line of String(text || '').split('\n')) {
        let m = /^\s*[#*]*\s*【\s*页\s*(\d+)\s*】/.exec(line);
        if (m) {
            let n = Number(m[1]) - 1;
            cur = n >= 0 && n < count ? n : -1;
            continue;
        }
        let item = /^\s*(?:[-*•]|\d+[.、])\s*(.+?)\s*$/.exec(line);
        cur >= 0 && item && (out[cur] = [...(out[cur] || []), item[1]]);
    }
    return out;
}

// ---------- 机械判定（用户 11-22：线索在掷骰成功后才交给正文） ----------
// 正文写检定请求（带事实编号 #F..）→ 用户在自己的消息里给骰点 → 拼提示词时这里按 CoC 规则算成败 →
// 成功才把那条发现的内容放进本轮材料。结果不存储，每次从聊天记录算（删楼、重新生成跟着变）；同一编号第一次的结果为准，不重掷。

const LEVEL_OF = (text) => (/极难/.test(text || '') ? '极难' : /困难/.test(text || '') ? '困难' : '普通');
const CODE = /#\s*([A-Za-z][\w-]{0,40})/;

// AI 楼里的检定请求：【检定】谁：侦查 60（困难）#F_box ／ [igs-anke:检定|问题|对象|侦查|60|困难|F_box]
export function parseCheckRequests(text) {
    let out = [],
        src = String(text || '');
    for (let m of src.matchAll(/【检定】([^\n]*)/g)) {
        let line = m[1],
            code = CODE.exec(line),
            body = line.replace(/^[^：:]*[：:]/, ''),
            skill = /^\s*([^\s\d（(#]+)/.exec(body),
            value = /(\d{1,3})/.exec(body.replace(CODE, ''));
        code && skill && out.push({ code: code[1], skill: skill[1], value: value ? Number(value[1]) : null, level: LEVEL_OF(body) });
    }
    for (let m of src.matchAll(/[\[【［]\s*igs\s*-?\s*anke\s*[:：]\s*检定\s*[|｜]([^\]】］]*)[\]】］]/gi)) {
        let f = m[1].split(/[|｜]/).map((x) => x.trim()),
            code = f.find((x, i) => i >= 2 && /^#?[A-Za-z][\w-]*$/.test(x));
        f[2] && code && out.push({ code: code.replace(/^#/, ''), skill: f[2], value: /^\d{1,3}$/.test(f[3] || '') ? Number(f[3]) : null, level: LEVEL_OF(f.slice(4).join(' ')) });
    }
    return out;
}

// 用户楼里的骰点：1D100=23 / d100：23 / 侦查 23 / 23/60；没有数字时认「成功 / 失败」字样（自己算好的）。
const escapeRe = (t) => String(t).replace(/[.*+?^$()|[\]\\{}]/g, (c) => '\\' + c);

export function parseRoll(text, skill = '') {
    let src = String(text || ''),
        bySkill = skill ? new RegExp(escapeRe(skill) + '[^\\d\\n]{0,6}(\\d{1,3})').exec(src) : null,
        m = /\d*\s*[dD]\s*100\s*[=＝:：]\s*(\d{1,3})/.exec(src) || /🎲\s*(\d{1,3})/.exec(src) || bySkill || /(?:掷出|骰出|出目|结果)\D{0,3}(\d{1,3})/.exec(src),
        value = /(\d{1,3})\s*[\/／]\s*(\d{1,3})/.exec(src);
    if (m) return { die: Number(m[1]), value: value && Number(value[1]) === Number(m[1]) ? Number(value[2]) : null };
    let w = /(大成功|极难成功|困难成功|大失败|失败|成功)/.exec(src);
    return w ? { word: w[1] } : null;
}

// CoC 7 版：≤5 大成功；100（技能值不到 50 时 96 以上）大失败；≤1/5 极难、≤1/2 困难、≤技能值 成功。达到要求的难度才算过。
export function cocJudge(die, value, level = '普通') {
    let fumble = die >= 100 || (value < 50 && die >= 96),
        tier = die <= 5 ? '大成功' : fumble ? '大失败' : die <= Math.floor(value / 5) ? '极难成功' : die <= Math.floor(value / 2) ? '困难成功' : die <= value ? '成功' : '失败',
        need = level === '极难' ? Math.floor(value / 5) : level === '困难' ? Math.floor(value / 2) : value;
    return { tier, ok: die <= 5 || (!fumble && die <= need), need };
}

// messages = 酒馆聊天数组；返回 { 编号: { ok, tier, die, value, level, skill, at } }
// 用户消息像是在掷骰（用来判断「没认出骰点」要不要提示，普通回复不提示）
const LOOKS_ROLL = /[dD]\s*100|🎲|掷|骰|roll/i;
// IGS forum-anke-play.js ankeFillLine 的 coc 行：1D100=23，技能60 ／ 1D100=23，困难线30，困难成功（没达到难度）
const IGS_ROLL = /1D100=(\d{1,3})，(?:技能(\d{1,3})|(?:困难|极难)线(\d{1,3}))，(大成功|极难成功|困难成功|成功|大失败|失败)(（没达到难度）)?/;
const ANKE_PICK_LINE = /【(?:安价|多数决|征集)】[^\n]*/g;
const STRICT_ROLL = /[dD]\s*100\s*[=＝:：]?\s*\d{1,3}|🎲\s*\d{1,3}|(?:掷出|骰出|出目)\D{0,3}\d{1,3}/;

// 返回值另带两个不可枚举字段（遍历结果的老代码不受影响）：
//   problems：[{ at, kind, skill, code }]，kind = noreq（掷了骰但没有等着掷的检定）/ unparsed（没认出骰点）/ novalue（缺技能值）/ dup（这项已经掷过）
//   requests：[{ at, code, skill, level }]，正文里出现过的检定请求
export function trpgCheckResults(messages) {
    let open = [],
        out = {},
        problems = [],
        requests = [],
        dupes = [];
    (messages || []).forEach((msg, at) => {
        if (!msg || msg.is_system) return;
        let text = String(msg.mes || '');
        // 论坛安科的安价/多数决/征集行带「🎲1D6=3」这类点数，不是模组检定的骰点，先去掉再判
        msg.is_user && (text = text.replace(ANKE_PICK_LINE, ''));
        if (!msg.is_user) {
            dupes = [];
            for (let r of parseCheckRequests(text)) {
                requests.push({ at, code: r.code, skill: r.skill, level: r.level });
                out[r.code] ? dupes.push(r) : open.some((o) => o.code === r.code) || open.push(r);
            }
            return;
        }
        let named = CODE.exec(text),
            req = (named && open.find((o) => o.code === named[1])) || open[open.length - 1];
        if (!req) {
            let again = (named && out[named[1]] && { code: named[1], skill: out[named[1]].skill }) || dupes[dupes.length - 1];
            again && (named || STRICT_ROLL.test(text))
                ? problems.push({ at, kind: 'dup', skill: again.skill, code: again.code })
                : STRICT_ROLL.test(text) && !(IGS_ROLL.test(text) && !named) && problems.push({ at, kind: 'noreq', skill: '', code: named ? named[1] : '' });
            return;
        }
        // IGS 论坛安科点 ROLL 填的那一行：成败 IGS 已经按调查员档判好，照用（两边技能值可能不同）
        let igs = IGS_ROLL.exec(text);
        if (igs) {
            let need = igs[3] ? Number(igs[3]) : null,
                value = igs[2] ? Number(igs[2]) : null;
            out[req.code] = { tier: igs[4], ok: /成功/.test(igs[4]) && !igs[5], die: Number(igs[1]), need, value, level: req.level, skill: req.skill, at };
            open = open.filter((o) => o !== req);
            return;
        }
        let roll = parseRoll(text, req.skill);
        if (!roll) return (LOOKS_ROLL.test(text) && problems.push({ at, kind: 'unparsed', skill: req.skill, code: req.code }), void 0);
        let value = roll.value || req.value || igsSkillValue(req.skill),
            res = roll.die != null && value ? { ...cocJudge(roll.die, value, req.level), die: roll.die } : roll.word ? { tier: roll.word, ok: !/失败/.test(roll.word), die: null } : null;
        if (!res) return (problems.push({ at, kind: 'novalue', skill: req.skill, code: req.code }), void 0);
        ((out[req.code] = { ...res, value, level: req.level, skill: req.skill, at }), (open = open.filter((o) => o !== req)));
    });
    // fresh：用户最新一条消息里刚掷的（这一轮正文要接着写的）
    let last = -1;
    (messages || []).forEach((m, i) => m && m.is_user && !m.is_system && (last = i));
    for (let r of Object.values(out)) r.fresh = r.at === last;
    Object.defineProperty(out, 'problems', { value: problems, enumerable: !1 });
    Object.defineProperty(out, 'requests', { value: requests, enumerable: !1 });
    Object.defineProperty(out, 'lastUser', { value: last, enumerable: !1 });
    return out;
}

export const GOT_ANYWAY = /仍然?(?:能)?(?:得到|拿到|发现|找到)|也能(?:得到|拿到|发现|找到)|还是(?:得到|拿到|发现|找到)/;

// 场景材料里一条带判定的发现怎么写。没有判定返回 null（原样走线索模式）。
// reveal：这一轮要不要把内容交给正文（成功，或失败但「仍然得到」）。
export function checkLine(d, checks) {
    if (!d || !d.check) return null;
    let c = d.check,
        code = d.fact || '',
        what = `${c.skills.join(' / ')}${c.level === '普通' ? '' : `（${c.level}）`}`,
        r = code && checks ? checks[code] : null;
    if (!r) return { reveal: !1, line: `- 待判定 #${code}：${what}${c.hidden ? '，暗骰' : ''}。掷骰成功之前不知道会发现什么，不要写出调查结果。` };
    let how = `${r.skill}${r.die != null ? ` 1D100=${r.die}` : ''}${r.value ? `／${r.value}` : ''}，${r.tier}`;
    if (r.ok) return { reveal: !0, line: `- 判定成功 #${code}（${how}）：这一轮写出这条发现：${d.text}` };
    if (c.fail && GOT_ANYWAY.test(c.fail)) return { reveal: !0, line: `- 判定失败 #${code}（${how}）：${c.fail}。可以写出：${d.text}` };
    return { reveal: !1, line: `- 判定失败 #${code}（${how}）：${c.fail || '没有发现'}。不要写出这条发现，也不要暗示它是什么。` };
}

// 用户这一轮刚掷的检定，焦点场景里没有列出的（焦点换了、填表还没跟上），到全部节点里找到那条发现单独列出，
// 避免正文只看到「成功了」却没有内容、自己编。discoveriesOf = clue-project 的 discoveryList（避免循环引用）。
export function freshCheckLines(nodeStates, checks, { printed = [], isGot = () => !1, discoveriesOf, used = null } = {}) {
    if (!checks || !discoveriesOf) return [];
    let out = [];
    for (let [code, r] of Object.entries(checks)) {
        if (!r.fresh || printed.includes(code) || isGot(code)) continue;
        let d = null;
        for (let s of nodeStates || []) {
            d = discoveriesOf(s.node.item || {}).find((x) => x.fact === code && x.check);
            if (d) break;
        }
        let ck = d && checkLine(d, checks);
        if (!ck) continue;
        out.push(ck.line);
        ck.reveal && used && used.candidates.push({ fact: d.fact, record: d.record });
    }
    return out.length ? ['刚才的判定结果（用户这一轮掷的骰）：', ...out] : [];
}
