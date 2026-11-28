import { LINE_CATALOG_COL } from './lines.js';
import { isPlainObject } from './outline.js';
// 「已核实」按各行口径写的取得者判断，不一律要求主角（用户扮演的角色）取得（查线索的常常是 char，不是用户扮演的角色）。
// 旧聊天的说明里还是旧句子，重新「创建模板」时换成这一句。
const FACT_VERIFIED_OLD = '已核实：正文里主角实际取得了这项结果，而且有可靠依据（亲眼看到实物、读到原件、得到明确验证）。';
const FACT_VERIFIED_RULE =
    '    · 已核实：正文里实际出现了这一行口径所说的结果（口径写了由谁取得，以那个人为准），而且有可靠依据（亲眼看到实物、读到原件、得到明确验证）。';
// 依据不写楼层号：数据库交给填表 AI 的对话不带楼层编号，它只能在本批里自己数（写出「第1楼」）。
// 旧聊天的事实表、知情表说明里还是旧句子，重新「创建模板」时按这张表逐句换掉。
const EVIDENCE_TEXT = '- 依据：写故事里的时间和情节，如「周一晚 码头仓库 看守交出账本」。时间照正文或全局表写，拿不准就只写情节。不写楼层号（你看到的对话没有楼层编号）。';
export const EVIDENCE_REWRITES = [
    ['- 依据：写明正文哪一楼、哪个情节。', EVIDENCE_TEXT],
    ['「；后续：<楼层 新情节>」。没有新信息、或同一楼的情节已经追加过，就不改。', '「；后续：<时间 新情节>」。没有新信息、或同一情节已经追加过，就不改。'],
    ['依据追加「；后续：第<N>楼 另一份收据上的签名相同」', '依据追加「；后续：次日 另一份收据上的签名相同」'],
    ['在依据里写明新证据和楼层', '在依据里追加新证据'],
    ["'第<N>楼 <情节>'", "'<时间> <情节>'"],
    ["'；后续：第<N>楼 <新情节>'", "'；后续：<时间> <新情节>'"],
    ["'；第<N>楼 <新证据>'", "'；<时间> <新证据>'"],
];
const rewriteEvidence = (text) => EVIDENCE_REWRITES.reduce((s, [from, to]) => s.split(from).join(to), String(text || ''));
export const CLUE_TPL_MARK_BEGIN = '【线索主线附加规则·剧情注入器】';

export const CLUE_TPL_MARK_END = '【附加规则结束】';

export const CLUE_TPL_PLACE = (depth, order, position = 'at_depth_as_system') => ({ position, depth, order });

export function clueTplExport(name, extra = {}) {
    return {
        enabled: !1,
        splitByRow: !1,
        entryName: name,
        entryType: 'constant',
        keywords: '',
        preventRecursion: !0,
        injectionTemplate: '',
        extraIndexEnabled: !1,
        extraIndexEntryName: `${name}-索引`,
        extraIndexColumns: [],
        extraIndexColumnModes: {},
        extraIndexInjectionTemplate: '',
        entryPlacement: CLUE_TPL_PLACE(2, 1e4),
        extraIndexPlacement: CLUE_TPL_PLACE(2, 10010),
        fixedEntryPlacement: CLUE_TPL_PLACE(2, 99990),
        fixedIndexPlacement: CLUE_TPL_PLACE(2, 99991),
        ...extra,
    };
}

export const CLUE_TPL_REALTIME = { uiSentinel: -1, contextDepth: -1, updateFrequency: 1, batchSize: -1, skipFloors: 0, groupId: 0 };

export const CLUE_TPL_EVIDENCE = [
    '【依据规则】只按 AI 回复（正文）里实际发生的事填写。用户消息里出现的计划、提议、打算、「准备去做」「预计会发现」都不算发生。',
    '    反例：用户消息写「去后屋找账本，会找到被撕掉的那页」，正文写主角翻了几本旧账、什么也没找到就离开了 → 不记录任何发现，状态保持原值。',
    '    拿不准正文有没有写出某项结果、某个角色有没有得知时，保持原值：宁可晚一批登记，不要提前登记。',
].join('\n');

export function clueControlSheet() {
    return {
        uid: 'sheet_ClueCtrl01',
        name: '线索控制表',
        sourceData: {
            note: [
                '主角眼下正在做哪一段剧情的事。此表有且仅有一行，「标识」固定为「主线」（代表全局的当前剧情活动）。',
                '- 标识：固定写「主线」，不要修改。',
                '- 场景目录：由剧情注入器维护，填表时不要修改。列的是现在可以去做的剧情的编号、要做的事和地点；只用于对号，不表示那件事已经发生。',
                '- 当前场景：以本批最后一楼结束时，主角实际在做的事为准。叙述跟着主角走，这一列记的不是主角在不在场，而是他在不在做某一段剧情的事。只能写「场景目录」里的编号，或者写「无」。',
                '    · 主角开始做「场景目录」里某一件事：照抄那一件的编号。开始做的那一楼就写，不用等事情有结果。',
                '    · 别人只是提起、主角没有去做，不算；路过不算。',
                '      看的是主角在为什么而忙，不是具体动作，也不是站在哪：为了同一个目的换个做法、换个地方继续（边走边接着谈、到隔壁房间找能打开那把锁的钥匙、去别处取查这件事要用的东西），都还是这一段，仍写原来的编号。地点只用来帮助对号（列了几个地点时任何一处都算）。',
                '    · 这件事已经结束、搁置，或者主角转去做别的事了：写「无」，人还在原地、对面还是同一个人也一样（和同一个人聊起了不相干的事，也算转去做别的）。',
                '      例：在值夜棚问完话，改成和老韩吃饭闲聊 → 写「无」。离开仓库去车站，路上经过邮局没进去 → 写「无」（旧的那件事已经不做了，邮局也没开始）。',
                '    · 只是说要走、约好、打算，实际还没动：保持原值。',
                '    · 看到、记下、指给别人看、路过、远远听见，都不算开始做新的那件事。',
                '    · 同一楼里做了几件事：以最后实际在做的那件事为准。以本批正文为准，全局表里还没更新的地点不能否定正文里已经发生的转场。',
                '    · 不得自造编号；「场景目录」里没有的场景不要写。',
                CLUE_TPL_EVIDENCE,
            ].join(`
`),
            initNode: '已有「主线」行就沿用，不要再插入。只有表里没有任何行时才插入一行：标识=主线，当前场景留空。',
            deleteNode: '禁止删除。',
            updateNode: `只更新「当前场景」，不改「场景目录」。例：主角走进裁缝铺开始问话 → 当前场景改为场景目录里裁缝铺对应的编号；主角说「先回家睡觉」并离开 → 当前场景改为「无」。
SQL示例: UPDATE clue_control SET cur_scene = '<场景编号>' WHERE tag = '主线';`,
            insertNode: '禁止插入（只有一行）。',
            ddl: `CREATE TABLE clue_control ( -- 线索控制表
  row_id INTEGER PRIMARY KEY, -- 行号
  tag TEXT NOT NULL UNIQUE, -- 标识
  cur_scene TEXT, -- 当前场景
  scene_catalog TEXT -- 场景目录
);`,
        },
        content: [['row_id', '标识', '当前场景', '场景目录']],
        updateConfig: { ...CLUE_TPL_REALTIME },
        exportConfig: clueTplExport('线索控制表', { injectIntoWorldbook: !1 }),
        orderNo: 0,
    };
}

export function clueFactSheet() {
    return {
        uid: 'sheet_ClueFact01',
        name: '关键事实表',
        sourceData: {
            note: [
                '剧情需要追踪的关键发现。每行一条，由卡作者预先建好；填表时只改「状态」「内容」「依据」，不新增、不删除，不改「编号」「标签」「登记口径」。',
                '- 编号：事实编号，不要修改。',
                '- 标签：中性的简短名称，不要修改，也不要据此推断答案。',
                '- 登记口径：正文里出现什么才算取得这一项（不含答案）。不要修改。',
                '- 状态：只能是 未获得 / 已核实 / 存疑。',
                FACT_VERIFIED_RULE,
                '    · 存疑：正文里确实出现了这项内容，但来源只是某人的说法、传闻或推测，还没有可靠依据。「内容」要写明是谁说的。拿不准正文有没有写出这项内容时不要记为存疑，保持原值。',
                '    · 未获得：其余情况。到达地点、尝试调查、对方答应提供、中途离开，都仍是未获得。',
                '- 内容：一句话写出正文里实际出现的内容，只写正文写出来的部分，不补充正文没有的细节。例：只承认拿了钱、没说原因，就只写拿了钱。',
                '- 依据：写故事里的时间和情节，如「周一晚 码头仓库 看守交出账本」。时间照正文或全局表写，拿不准就只写情节。不写楼层号（你看到的对话没有楼层编号）。',
                '怎么找编号：',
                '    · 首次获得：按各行的「登记口径」判断正文写出的结果对应哪个编号、是否已经取得。附有【线索编号对照】时也可以参考。口径和对照都只用于对号，不代表已经发生。',
                '    · 维护已有记录：已经是已核实或存疑的行，正文出现新证据推翻或证实它时，可以按这一行已有的「内容」匹配并更新。无法确定是哪一行时保持原值。',
                '    · 已有记录又出现佐证（不推翻、也不改变状态）：「内容」保持不变；只有带来新信息时，才在「依据」原文后面追加「；后续：<时间 新情节>」。没有新信息、或同一情节已经追加过，就不改。不要用新情节覆盖第一次取得时的内容和依据。',
                '      例：之前已核实「第一次签收的回执」，这一楼主角在另一份收据上看到同样的签名 → 内容不变，依据追加「；后续：次日 另一份收据上的签名相同」。',
                '    · 正文没写出对应结果时，不要改任何行。',
                CLUE_TPL_EVIDENCE,
            ].join('\n'),
            initNode: '保留模板里预先建好的行，不要清空、不要新增。',
            deleteNode: '禁止删除。',
            updateNode:
                "只有正文明确写出结果时，才把对应编号的状态改为已核实或存疑，并填写内容和依据。已核实的事实后来被正文推翻时改为存疑，在依据里追加新证据；存疑的说法后来得到可靠证实时改为已核实。\nSQL示例(首次登记说法): UPDATE clue_facts SET status = '存疑', content = '<谁>说<正文里的原意>', evidence = '<时间> <情节>' WHERE code = '<编号>';\nSQL示例(纯佐证，只追加依据): UPDATE clue_facts SET evidence = evidence || '；后续：<时间> <新情节>' WHERE code = '<编号>';\nSQL示例(原说法被推翻或证实): UPDATE clue_facts SET status = '<已核实或存疑>', evidence = evidence || '；<时间> <新证据>' WHERE code = '<编号>';",
            insertNode: '禁止插入。只修改已有行。',
            ddl: "CREATE TABLE clue_facts ( -- 关键事实表\n  row_id INTEGER PRIMARY KEY, -- 行号\n  code TEXT NOT NULL UNIQUE, -- 编号\n  label TEXT NOT NULL, -- 标签\n  criterion TEXT, -- 登记口径\n  status TEXT NOT NULL DEFAULT '未获得' CHECK(status IN ('未获得', '已核实', '存疑')), -- 状态\n  content TEXT, -- 内容\n  evidence TEXT -- 依据\n);",
        },
        content: [['row_id', '编号', '标签', '登记口径', '状态', '内容', '依据']],
        updateConfig: { ...CLUE_TPL_REALTIME },
        // 不导出到正文世界书：已获得的事实由剧情注入器按知情范围投影。
        exportConfig: clueTplExport('关键事实表', { injectIntoWorldbook: !1 }),
        orderNo: 1,
    };
}

export function clueKnowSheet() {
    return {
        uid: 'sheet_ClueKnow01',
        name: '知情表',
        sourceData: {
            note: [
                '关键角色是否知道某条关键事实。每行是「一条事实 × 一个角色」，由卡作者预先建好；填表时只改「获知方式」「可信度」「依据」，不新增、不删除行。',
                '- 键 / 事实 / 角色：不要修改。主角按模板已有写法（如 user）。',
                '- 获知方式：只能是 未知 / 亲见 / 被告知 / 听说 / 推测。逐个角色判断：',
                '    · 亲见：这个角色自己看清了实物或原件内容。',
                '    · 被告知：有人明确把这件事告诉了这个角色本人，或者展示给他看。',
                '    · 听说：这个角色听到了转述、传闻。',
                '    · 推测：这个角色自己提出了猜想或怀疑，手里还没有证据。',
                '      这个角色亲眼看了实物或原件、再据此得出的判断（如读了单据后判断证词对不上），记为「亲见」，不是推测。推测不配「已核实」。',
                '    · 未知：其余情况。【在场不等于知道】：只是在场、没听清、别人私下得知时他在附近，都保持原值，除非正文写出他看到或听到了内容。',
                '- 可信度：只能是 已核实 / 未核实。跟着这个角色手里的证据走：亲见通常是已核实；被告知、听说、推测通常是未核实，除非正文写出他确认了真假。',
                '- 依据：写故事里的时间和情节，如「周一晚 码头仓库 看守交出账本」。时间照正文或全局表写，拿不准就只写情节。不写楼层号（你看到的对话没有楼层编号）。',
                '【先看事实表】某条事实在关键事实表里仍是「未获得」、本次也没有把它登记成已核实或存疑时，它的知情行全部保持原值。',
                '    知情的对象是关键事实表里那一行的「登记口径」所说的结果，不是标签字面上的东西。',
                '    例：口径是「在抽屉里找到那封信并读到内容」，正文只写主角看见了上锁的抽屉、没打开 → 事实表保持未获得，知情行也保持未知。',
                '获知方式只升级、不降级：已经是亲见的，不因旁人又提起改成听说。出现反证时，可以更新可信度和依据，但保留原来是怎么得知的。',
                '已有记录的「依据」不要覆盖：再次见到或听到时，在原文后面追加「；后续：<新情节>」。',
                CLUE_TPL_EVIDENCE,
            ].join('\n'),
            initNode: '保留模板里预先建好的行，不要清空、不要新增。',
            deleteNode: '禁止删除。',
            updateNode:
                "只有正文明确写出某个角色看到、被告知、听到、猜到某条事实时，才更新对应行。例：老人当面对主角说看见了人 → 主角那一行改为「被告知 / 未核实」；老板娘当时不在场 → 她那一行保持原值。\nSQL示例: UPDATE clue_knowledge SET way = '被告知', credibility = '未核实', evidence = '<时间> <情节>' WHERE key = '<事实编号>@<角色>';",
            insertNode: '禁止插入。只修改已有行。',
            ddl: "CREATE TABLE clue_knowledge ( -- 知情表\n  row_id INTEGER PRIMARY KEY, -- 行号\n  key TEXT NOT NULL UNIQUE, -- 键\n  fact TEXT NOT NULL, -- 事实\n  actor TEXT NOT NULL, -- 角色\n  way TEXT NOT NULL DEFAULT '未知' CHECK(way IN ('未知', '亲见', '被告知', '听说', '推测')), -- 获知方式\n  credibility TEXT NOT NULL DEFAULT '未核实' CHECK(credibility IN ('已核实', '未核实')), -- 可信度\n  evidence TEXT -- 依据\n);",
        },
        content: [['row_id', '键', '事实', '角色', '获知方式', '可信度', '依据']],
        updateConfig: { ...CLUE_TPL_REALTIME },
        exportConfig: clueTplExport('知情表', { injectIntoWorldbook: !1 }),
        orderNo: 2,
    };
}

export const CLUE_SCENE_CATALOG_HEAD = '\n【场景编号对照】（只用于对号';

export function clueSheets({ factRows = [], knowRows = [], controlRow = null, scenes = [], placeTables = [] } = {}) {
    let ctrl = clueControlSheet(),
        facts = clueFactSheet(),
        know = clueKnowSheet();
    (placeTables.length &&
        (ctrl.sourceData.note += `
地点名称以${placeTables.map((n) => `《${n}》`).join('、')}里的为准。`),
        controlRow && ctrl.content.push([null, ...controlRow, '', ''].slice(0, 4)));
    for (let r of factRows) facts.content.push([null, r.code, r.label, r.criterion || '', '未获得', '', '']);
    for (let r of knowRows) know.content.push([null, `${r.fact}@${r.actor}`, r.fact, r.actor, '未知', '未核实', '']);
    return [ctrl, facts, know];
}

// 全局表（记时间、地点的单行表）：卡作者常改名、加列。
// 按名字认：官方认的「全局数据表」「全局表」，常见的「全局状态表」；都没有就找名字带「全局」、有时间列的表。
// 列按名字找，列多列少都不影响；插件只改它的更新频率，读时间、地点两格，不增删列、不改它的填表规则。
export const GLOBAL_TABLE_NAMES = ['全局数据表', '全局表', '全局状态表'];
export const GLOBAL_TIME_COLS = ['当前时间', '时间', '当前日期时间', '游戏时间'];
export const GLOBAL_PLACE_COLS = ['当前详细地点', '主角当前所在地点', '当前位置', '当前地点', '所在地点', '地点'];
export function findGlobalTable(sheets) {
    let list = (sheets || []).filter((s) => s && s.name),
        head = (s) => clueTplHeader(s),
        byName = GLOBAL_TABLE_NAMES.map((n) => list.find((s) => String(s.name).trim() === n)).find(Boolean),
        sheet = byName || list.find((s) => /全局/.test(String(s.name)) && GLOBAL_TIME_COLS.some((c) => head(s).includes(c)));
    if (!sheet) return null;
    let h = head(sheet),
        rows = Array.isArray(sheet.content) ? sheet.content.slice(1).filter(Array.isArray) : [],
        seeds = Array.isArray(sheet.seedRows) ? sheet.seedRows.filter(Array.isArray) : [],
        first = (rows[0] || seeds[0] || [])[1],
        rowKey = String(first ?? '').trim() || '全局状态';
    return {
        sheet,
        name: String(sheet.name).trim(),
        // 行标识：单行表用「*」（唯一那一行）。官方全局表第一列是会变的地点，按第一格的值找，主角一换地方就找不到了。
        // 已经有多行时才按第一行第一列的值找（默认模板是「全局状态」）。
        row: Math.max(rows.length, seeds.length) > 1 ? rowKey : '*',
        rowKey,
        time: GLOBAL_TIME_COLS.find((c) => h.includes(c)) || '',
        place: GLOBAL_PLACE_COLS.find((c) => h.includes(c)) || '',
    };
}

export const CLUE_TPL_DEFAULTS = {
    全局数据表: ['全局状态', '当前详细地点', '当前次要地区', '当前主要地区', '上轮场景时间', '经过的时间', '当前时间'],
    重要角色表: ['姓名', '性别', '年龄', '一句话介绍', '外貌特征', '穿着打扮', '所在地点', '在场状态', '人际关系', '过往经历', '交互选项'],
    任务与事件表: ['任务名称', '任务类型', '发布者', '详细描述', '当前进度', '任务时限', '奖励', '惩罚'],
    选项表: ['选项一', '选项二', '选项三', '选项四'],
};

export const CLUE_TPL_CHAR_COLS = [
    { sql: 'plot_identity', label: '剧情身份' },
    { sql: 'current_intent', label: '当前动向' },
];

export const CLUE_TPL_RULES = {
    重要角色表: [
        '- 建行：本批正文中实际登场，或有人明确提到、且对当前事件有作用的人，才建行。沿用当时可辨认的称呼；姓名还没揭示就用正文里的称呼，以后确认是同一人时更新原行，不另建一行。',
        '- 背景设定里写了、但正文还没有展示的身份、关系、秘密和未来安排，不写进任何一列。关系和经历只补正文已经展示的部分。',
        '- 剧情身份：写成「什么场合下如何称呼或自述」，如「初到茶馆时自称本地商人」。之后被核实或推翻时，在后面追加证据和时间，不删原来的说法。不写楼层号（你看到的对话没有楼层编号）。',
        '- 当前动向：分清「说打算去」「已出发」「已到达」。正文没有交代新的动向就保持原值；离开场景后在做什么，正文写了才记。',
        '- 一句话介绍只写公开特征；交互选项只写主角目前有依据尝试的行动。',
    ].join('\n'),
    任务与事件表: [
        '- 从本批正文找主角已经接下的委托、已触发的差事，或主角明确立下的目标；当面交谈、书信和已经发生的行动都可以作依据。本批没有，就不新增。',
        '- 设定里写了、但正文还没有出现的目标、真相和幕后人物，不写进任何一列。主线剧情由剧情注入器按进度提供，不要预写主线任务。',
        '- 详细描述记已知的要求及其来源；当前进度只写实际完成的步骤。期限、奖励、后果只有正文明确时才填。完成、失败、过期沿用本表原有规则。',
    ].join('\n'),
    选项表: [
        '- 四个选项写主角基于此刻所见、所闻或已有记忆，下一步可以尝试的行动。保留本表原有的第三人称和四类选项的要求。',
        '- 允许提问、闲聊、暂时离开和继续日常。写「去档案室查有没有签收记录」这样的尝试，结果留给正文；即使知道某个地点，也不能预写那里一定有某项证据。',
        '- 不要提出主角在正文里还没听说过的地点、人物或真相。生成选项不会更新任务、事实或人物知情。',
    ].join('\n'),
};

export const CLUE_TPL_REPLACE = {
    重要角色表: {
        initNode: {
            from: '故事开始时为当前已知的重要角色分别插入条目。',
            // 数据库默认（spv8.9.2）的整段 initNode：只有和它完全相同时才替换开头那句。
            whole: `故事开始时为当前已知的重要角色分别插入条目。

【格式约束】
relation_text 必须写"角色名:关系描述"；同一角色多项描述用英文逗号 , 分隔；不同角色之间用英文分号 ; 分隔。

SQL示例: INSERT INTO important_non_romance (name, gender, age, brief_intro, appearance, outfit_text, location_name, presence_status, relation_text, past_experience, interaction_options) VALUES ('校长', '男', 60, '学院校长', '白发，手持手杖，目光深邃', '深灰立领风衣配黑皮手套', '校长室', '离场', '主角:曾帮其修过自行车,旧识;艾莉丝:监护人', '据说知晓学院的许多秘密，很少露面。', '向他打听失踪案线索');`,
            to: '故事开始时，只为开场正文里实际登场、或被明确提到且对当前事件有作用的重要角色插入条目；只写正文已经展示的内容。',
        },
    },
    任务与事件表: {
        initNode: {
            from: '游戏初始化时，根据剧情与设定添加一条主线剧情。',
            to: '游戏初始化时，只记录开场正文里主角已经接下的委托或明确立下的目标；没有就不添加。不要根据设定预写主线任务。',
        },
    },
};

export function clueTplHeader(sheet) {
    let head = Array.isArray(sheet && sheet.content) && Array.isArray(sheet.content[0]) ? sheet.content[0] : [];
    return head.slice(1).map((x) => String(x ?? '').trim());
}

export function clueTplMismatch(tpl, live) {
    let sheets = (o) =>
        Object.entries(o || {})
            .filter(([k, v]) => k.startsWith('sheet_') && isPlainObject(v) && v.name)
            .map(([, v]) => v);
    let t = sheets(tpl),
        l = sheets(live),
        out = [];
    if (!l.length) return out;
    let tn = t.map((s) => String(s.name).trim()),
        ln = l.map((s) => String(s.name).trim());
    let dup = (xs) => [...new Set(xs.filter((n, i) => xs.indexOf(n) !== i))];
    dup(tn).length && out.push(`模板里有重名的表：${dup(tn).join('、')}`);
    dup(ln).length && out.push(`当前聊天有重名的表：${dup(ln).join('、')}`);
    let onlyT = tn.filter((n) => !ln.includes(n)),
        onlyL = ln.filter((n) => !tn.includes(n));
    onlyT.length && out.push(`模板里有、当前聊天没有：${onlyT.join('、')}（可能读到的是全局模板）`);
    onlyL.length && out.push(`当前聊天有、模板里没有：${onlyL.join('、')}（导入后这些表会被数据库隐藏）`);
    for (let s of l) {
        let m = t.find((x) => String(x.name).trim() === String(s.name).trim());
        if (!m) continue;
        let lh = clueTplHeader(s),
            th = clueTplHeader(m),
            lost = lh.filter((c) => c && !th.includes(c));
        lost.length && out.push(`「${s.name}」当前聊天里的列「${lost.join('、')}」模板里没有`);
    }
    return out;
}

export function stripRuleBlock(text) {
    let s = String(text || ''),
        i = s.indexOf(CLUE_TPL_MARK_BEGIN);
    if (i < 0) return s;
    let j = s.indexOf(CLUE_TPL_MARK_END, i);
    return (s.slice(0, i) + (j < 0 ? '' : s.slice(j + CLUE_TPL_MARK_END.length))).replace(/\n{3,}/g, '\n\n').replace(/\s+$/, '');
}

export function withRuleBlock(text, rules) {
    let base = stripRuleBlock(text);
    return `${base}${base ? '\n\n' : ''}${CLUE_TPL_MARK_BEGIN}\n${rules}\n${CLUE_TPL_MARK_END}`;
}

export function ddlAddColumns(ddl, cols) {
    let src = String(ddl || '');
    if (!src.trim()) return { ok: !1, ddl: src };
    let close = src.lastIndexOf(')');
    if (close < 0) return { ok: !1, ddl: src };
    let body = src.slice(0, close).replace(/\s+$/, ''),
        tail = src.slice(close);
    // 表级约束（UNIQUE、PRIMARY KEY (...)、CHECK、FOREIGN KEY、CONSTRAINT）必须在所有列之后：有它们时不改 DDL，只报告。
    // 约束可能在行首，也可能和列写在同一行的逗号后面（单行建表语句）。先去掉 -- 注释，免得把注释里的词当成约束。
    let defs = body.slice(body.indexOf('(') + 1).replace(/--[^\n]*/g, '');
    // 单词边界放在关键字上：PRIMARY KEY ("name") 的括号后面是引号，原写法的 \b 不成立。
    if (/(?:^|,)\s*(?:(?:CONSTRAINT|UNIQUE|CHECK|FOREIGN\s+KEY)\b|PRIMARY\s+KEY\s*\()/im.test(defs))
        return { ok: !1, ddl: src, why: '表定义里有表级约束' };
    // 最后一列可能带行尾注释：逗号要加在注释之前。
    let lines = body.split('\n'),
        last = lines.length - 1;
    for (; last >= 0 && !lines[last].trim();) last--;
    let m = /^(.*?)(\s*--.*)?$/.exec(lines[last]);
    lines[last] = `${m[1].replace(/,\s*$/, '')},${m[2] || ''}`;
    let added = cols.map((c, i) => `  ${c.sql} TEXT${i < cols.length - 1 ? ',' : ''} -- ${c.label}`);
    return { ok: !0, ddl: `${lines.slice(0, last + 1).join('\n')}\n${added.join('\n')}\n${tail}` };
}

export function sheetEntries(tpl) {
    return Object.entries(tpl || {}).filter(([k, v]) => k.startsWith('sheet_') && isPlainObject(v));
}

export function synthesizeClueTemplate(base, { clue = {} } = {}) {
    let tpl = JSON.parse(JSON.stringify(isPlainObject(base) ? base : {})),
        changes = [],
        problems = [],
        created = [],
        blocked = [];
    isPlainObject(tpl.mate) || (tpl.mate = { type: 'chatSheets', version: 1 });
    let byName = /* @__PURE__ */ new Map(),
        dups = /* @__PURE__ */ new Set();
    for (let [key, sheet] of sheetEntries(tpl)) {
        let name = String(sheet.name || '').trim();
        byName.has(name) ? dups.add(name) : byName.set(name, { key, sheet });
    }
    for (let name of dups) (byName.delete(name), problems.push(`有两张以上的表都叫「${name}」，没有改动它们`));
    let maxOrder = Math.max(
            -1,
            ...sheetEntries(tpl)
                .map(([, s]) => Number(s.orderNo))
                .filter(Number.isFinite),
        ),
        placeTables = sheetEntries(tpl)
            .map(([, s]) => s)
            .filter((s) => /地点/.test(String(s.name || '')) && /(^|,)(地点名称|名称)(,|$)/.test(clueTplHeader(s).join(',')))
            .map((s) => String(s.name)),
        fresh = clueSheets({ ...clue, placeTables });
    for (let sheet of fresh) {
        if (dups.has(sheet.name)) {
            blocked.push(sheet.name);
            continue;
        }
        let have = byName.get(sheet.name);
        if (!have) {
            let key = sheet.uid;
            for (let n = 2; tpl[key]; n++) key = `${sheet.uid}_${n}`;
            ((sheet.uid = key), (sheet.orderNo = ++maxOrder), (tpl[key] = sheet), created.push(sheet.name));
            let rows = sheet.content.length - 1;
            changes.push(`新增「${sheet.name}」${rows ? `，带${rows}行预建数据` : ''}`);
            continue;
        }
        let wantHead = clueTplHeader(sheet),
            head = clueTplHeader(have.sheet),
            missing = wantHead.filter((c) => !head.includes(c));
        if (
            sheet.name === '线索控制表' &&
            missing.length === 1 &&
            missing[0] === LINE_CATALOG_COL &&
            head.includes('标识') &&
            head.includes('当前场景')
        ) {
            let oldDdl = String((have.sheet.sourceData && have.sheet.sourceData.ddl) || ''),
                ddl = oldDdl.trim() ? ddlAddColumns(oldDdl, [{ sql: 'scene_catalog', label: LINE_CATALOG_COL }]) : { ok: !0, ddl: '' };
            if (!ddl.ok) {
                problems.push(
                    `「线索控制表」的DDL ${ddl.why || '无法解析'}，没有加「${LINE_CATALOG_COL}」列；多线的场景目录写不进去，需要的话请在数据库里手动加`,
                );
                continue;
            }
            (ddl.ddl && (have.sheet.sourceData = { ...have.sheet.sourceData, ddl: ddl.ddl }), have.sheet.content[0].push(LINE_CATALOG_COL));
            for (let row of have.sheet.content.slice(1)) Array.isArray(row) && row.push('');
            (Array.isArray(have.sheet.seedRows) && have.sheet.seedRows.forEach((row) => Array.isArray(row) && row.push('')),
                changes.push(`「线索控制表」新增列：${LINE_CATALOG_COL}（由插件写入现在可去做的剧情；原有列和行不动）`),
                (missing.length = 0));
        }
        if (missing.length) {
            problems.push(`已有的「${sheet.name}」缺少列：${missing.join('、')}。没有改动这张表，请检查是否是别的用途的同名表`);
            continue;
        }
        if (sheet.name === '关键事实表') {
            let note = String((have.sheet.sourceData && have.sheet.sourceData.note) || '');
            note.includes(FACT_VERIFIED_OLD) &&
                ((have.sheet.sourceData = { ...have.sheet.sourceData, note: note.replace(`    · ${FACT_VERIFIED_OLD}`, FACT_VERIFIED_RULE).replace(FACT_VERIFIED_OLD, FACT_VERIFIED_RULE.trim()) }),
                changes.push('「关键事实表」说明：「已核实」改为按各行口径里的取得者判断，不一律要求主角取得'));
        }
        if (sheet.name === '关键事实表' || sheet.name === '知情表') {
            let sd = have.sheet.sourceData || {},
                note = rewriteEvidence(sd.note),
                upd = sd.updateNode == null ? sd.updateNode : rewriteEvidence(sd.updateNode);
            (note !== String(sd.note || '') || upd !== sd.updateNode) &&
                ((have.sheet.sourceData = { ...sd, note, updateNode: upd }),
                changes.push(`「${sheet.name}」说明：依据改为写故事时间和情节，不写楼层号`));
        }
        if (sheet.name === '线索控制表') {
            let note = String((have.sheet.sourceData && have.sheet.sourceData.note) || ''),
                i = note.lastIndexOf(CLUE_SCENE_CATALOG_HEAD),
                base0 = i < 0 ? note : note.slice(0, i).replace(/\s+$/, ''),
                fresh0 = clueControlSheet().sourceData,
                oldStart = base0.indexOf('主角眼下正在做哪一段剧情的事。'),
                oldEnd = base0.indexOf(CLUE_TPL_EVIDENCE),
                next =
                    oldStart >= 0 && oldEnd > oldStart
                        ? base0.slice(0, oldStart) + fresh0.note + base0.slice(oldEnd + CLUE_TPL_EVIDENCE.length)
                        : base0;
            next !== note &&
                ((have.sheet.sourceData = { ...have.sheet.sourceData, note: next, updateNode: fresh0.updateNode }),
                changes.push(
                    i >= 0
                        ? '「线索控制表」说明：去掉旧的场景编号对照（改由「场景目录」列提供），更新填表规则'
                        : '「线索控制表」说明：更新填表规则（只写当前场景、不改场景目录）',
                ));
        }
        sameRealtime(have.sheet.updateConfig) ||
            ((have.sheet.updateConfig = { ...(have.sheet.updateConfig || {}), ...CLUE_TPL_REALTIME }),
            changes.push(`「${sheet.name}」改为每楼更新（与全局表同组）`));
    }
    let g = findGlobalTable([...byName.values()].map((x) => x.sheet));
    return (
        g
            ? (sameRealtime(g.sheet.updateConfig) ||
                  ((g.sheet.updateConfig = { ...(g.sheet.updateConfig || {}), ...CLUE_TPL_REALTIME }),
                  changes.push(`「${g.name}」改为每楼更新（与线索表同组，时间、地点每楼都准；填表次数会相应变多）`)),
              g.time || problems.push(`「${g.name}」里没找到时间列（${GLOBAL_TIME_COLS.join('、')}）：时间条件会是未知，可以在表格绑定里把time指向记时间的那一格`))
            : problems.push('没找到记时间、地点的全局表：大纲里的时间条件会是未知。可以在表格绑定里把time指向记时间的那一格'),
        patchDefault('重要角色表', (sheet) => {
            let head = sheet.content[0],
                have = clueTplHeader(sheet),
                add = CLUE_TPL_CHAR_COLS.filter((c) => !have.includes(c.label));
            if (add.length) {
                let ddl = ddlAddColumns(sheet.sourceData && sheet.sourceData.ddl, add);
                if (!ddl.ok)
                    return problems.push(
                        `「重要角色表」的DDL ${ddl.why || '无法解析'}，没有加列（剧情身份、当前动向）；需要的话请在数据库里手动加`,
                    );
                ((sheet.sourceData = { ...sheet.sourceData, ddl: ddl.ddl }), head.push(...add.map((c) => c.label)));
                for (let row of sheet.content.slice(1)) Array.isArray(row) && row.push(...add.map(() => ''));
                (Array.isArray(sheet.seedRows) && sheet.seedRows.forEach((row) => Array.isArray(row) && row.push(...add.map(() => ''))),
                    changes.push(`「重要角色表」新增列：${add.map((c) => c.label).join('、')}（原有列不动）`));
            }
        }),
        patchDefault('任务与事件表'),
        patchDefault('选项表'),
        {
            template: tpl,
            changes,
            problems,
            created,
            // 线索三表有重名：不新建、不自动绑定，调用方应停止。
            blocked,
            binding: {
                facts: [
                    {
                        表: '关键事实表',
                        编号列: '编号',
                        状态列: '状态',
                        已核实值: '已核实',
                        说法值: '存疑',
                        内容列: '内容',
                        来源列: '依据',
                    },
                ],
                knowledge: [
                    {
                        表: '知情表',
                        事实列: '事实',
                        角色列: '角色',
                        方式列: '获知方式',
                        可信度列: '可信度',
                        已核实值: '已核实',
                        来源列: '依据',
                        有效值: ['亲见', '被告知', '听说', '推测'],
                    },
                ],
                scene: { 路径: '线索控制表/主线/当前场景', 离场值: '无' },
                time: { 路径: [...(g && g.time ? [`${g.name}/${g.row}/${g.time}`, `${g.name}/${g.rowKey}/${g.time}`] : []), '全局数据表/全局状态/当前时间', '线索控制表/主线/当前时间'].filter((x, i, a) => a.indexOf(x) === i) },
            },
        }
    );
    function sameRealtime(cfg) {
        return !!cfg && cfg.updateFrequency === 1 && cfg.skipFloors === 0 && cfg.groupId === 0;
    }
    function patchDefault(name, extra) {
        let hit = byName.get(name);
        if (!hit) return;
        let sheet = hit.sheet,
            head = clueTplHeader(sheet),
            want = CLUE_TPL_DEFAULTS[name];
        if (!want.every((c) => head.includes(c)))
            return problems.push(
                `「${name}」的列和数据库默认不一致（缺${want.filter((c) => !head.includes(c)).join('、')}），没有改它的规则；需要的话请手动加上防剧透要求`,
            );
        ((sheet.sourceData = { ...(sheet.sourceData || {}) }), extra && extra(sheet));
        for (let [field, rep] of Object.entries(CLUE_TPL_REPLACE[name] || {})) {
            let cur = String(sheet.sourceData[field] || '');
            if (cur.includes(rep.to)) continue;
            let official = rep.whole || rep.from,
                norm = (t) =>
                    t
                        .replace(
                            /\r\n?/g,
                            `
`,
                        )
                        .trim();
            norm(cur) === norm(official)
                ? ((sheet.sourceData[field] = cur.replace(rep.from, rep.to)),
                  changes.push(`「${name}」的${field === 'initNode' ? '初始化' : '新增'}规则：「${rep.from}」改为「${rep.to}」`))
                : problems.push(
                      `「${name}」的${field === 'initNode' ? '初始化' : '新增'}规则和数据库默认不同，没有替换；请确认它不会按设定预写内容`,
                  );
        }
        let note = String(sheet.sourceData.note || ''),
            next = withRuleBlock(note, CLUE_TPL_RULES[name]);
        next !== note &&
            ((sheet.sourceData.note = next),
            changes.push(`「${name}」说明末尾${note.includes(CLUE_TPL_MARK_BEGIN) ? '更新' : '追加'}一段线索主线附加规则（原规则不动）`));
    }
}
