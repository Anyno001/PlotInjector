// 跑团模式（core/trpg.js、core/doc-pdf.js）与「不干扰线索模式」的回归测试。样本全部自造，不含任何模组原文。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import * as T from '../src/core/trpg.js';
import * as P from '../src/core/doc-pdf.js';

const C = loadCore();

// ---------- PDF 版式还原 ----------

// 造一页：lines = [[x, y, text, { h, font, w }]]，每行一个条目并带换行标记（和 WPS 导出的文字层一样）
function page(lines, { width = 595, height = 842 } = {}) {
    return {
        width,
        height,
        items: lines.map(([x, y, str, o = {}]) => ({ str, x, y, w: o.w ?? str.length * (o.h || 12), h: o.h || 12, font: o.font || 'body', eol: !0 })),
    };
}

test('pdf: 段落合并、标题分级、项目符号、跨栏接续', () => {
    let r = P.pdfPagesToText([
        page([
            [36, 780, '第一章', { h: 18, font: 'bold' }],
            [36, 740, '甲乙丙丁戊己庚辛壬癸甲乙丙丁戊己庚辛壬癸'],
            [36, 720, '短句结束。'],
            [36, 680, '小节标题', { font: 'bold' }],
            [36, 640, '\uF06C 第一项内容'],
            [36, 620, '\uF06C 第二项内容'],
            [36, 580, '甲乙丙丁戊己庚辛壬癸甲乙丙丁戊己庚辛壬癸'],
            [36, 560, '左栏最后一行写满了甲乙丙丁戊己庚辛壬'],
            [308, 780, '右栏接着写完。'],
        ]),
    ]);
    assert.equal(
        r.text,
        ['# 第一章', '甲乙丙丁戊己庚辛壬癸甲乙丙丁戊己庚辛壬癸短句结束。', '## 小节标题', '- 第一项内容', '- 第二项内容', '甲乙丙丁戊己庚辛壬癸甲乙丙丁戊己庚辛壬癸左栏最后一行写满了甲乙丙丁戊己庚辛壬右栏接着写完。'].join('\n\n'),
    );
});

test('pdf: 目录页略过、空白页提示、两端对齐的字间空格去掉', () => {
    let r = P.pdfPagesToText([
        page([]),
        page([
            [36, 780, '黑幕 .................................... 3'],
            [36, 760, '导入 .................................... 8'],
            [36, 740, '结局 .................................... 15'],
        ]),
        page([[36, 780, '卫 生 间 ， 誓 死 捍 卫 。']]),
    ]);
    assert.equal(r.text, '卫生间，誓死捍卫。');
    assert.equal(r.warnings.length, 2);
    assert.match(r.warnings[0], /第1页没有文字层/);
    assert.match(r.warnings[1], /第2页像是目录/);
});

test('pdf: 编号列挂到条目名前；时间线一行一条', () => {
    let r = P.pdfPagesToText([
        page([
            [56, 736, '1', { w: 6 }],
            [83, 766, '黑石：'],
            [83, 746, '一块黑色石头。'],
            [56, 650, '2', { w: 6 }],
            [83, 680, '铜钟：'],
            [83, 660, '一口小钟。'],
            [36, 560, '17:30 入场'],
            [36, 540, '18:00 宣布活动开始并说明规则'],
        ]),
    ]);
    assert.equal(r.text, ['1. 黑石：', '一块黑色石头。', '2. 铜钟：', '一口小钟。', '17:30 入场', '18:00 宣布活动开始并说明规则'].join('\n\n'));
});

test('pdf: 绕图排版的窄行（右端对齐）不拆段；括号放不下提前换行不拆段', () => {
    let full = '甲乙丙丁戊己庚辛壬癸甲乙丙丁戊己庚辛壬癸';
    let r = P.pdfPagesToText([
        page([
            [36, 780, full],
            [36, 760, '甲乙丙丁戊', { w: 60 }],
            [36, 740, '己庚辛壬癸', { w: 60 }],
            [36, 720, '收尾。', { w: 36 }],
            [36, 680, '甲乙丙丁戊己庚辛壬癸甲乙丙丁戊己庚'],
            [36, 660, '（Raathal）这一存在。'],
        ]),
    ]);
    assert.equal(r.text, `${full}甲乙丙丁戊己庚辛壬癸收尾。\n\n甲乙丙丁戊己庚辛壬癸甲乙丙丁戊己庚（Raathal）这一存在。`);
});

test('pdf: 原始顺序乱的页按坐标分栏重排', () => {
    // 左栏 4 行、右栏 4 行，原始顺序左右交替（Affinity 等排版软件的写法）
    let lines = [];
    for (let i = 0; i < 4; i++) {
        lines.push([308, 780 - i * 20, `右${i}甲乙丙丁戊己庚辛壬癸`]);
        lines.push([36, 780 - i * 20, `左${i}甲乙丙丁戊己庚辛壬癸`]);
    }
    let r = P.pdfPagesToText([page(lines)]);
    assert.ok(r.text.indexOf('左3') < r.text.indexOf('右0'), r.text);
});

// ---------- 判定 ----------

test('判定：对象、一句话两种写法', () => {
    assert.deepEqual(T.normalizeCheck({ 技能: '聆听', 难度: '困难', 失败: '只听到水声' }), { skills: ['聆听'], level: '困难', hidden: !1, fail: '只听到水声' });
    assert.deepEqual(T.normalizeCheck({ 技能: ['幸运', '侦查'], 暗骰: true }), { skills: ['幸运', '侦查'], level: '普通', hidden: !0, fail: '' });
    assert.deepEqual(T.normalizeCheck('侦查（困难）'), { skills: ['侦查'], level: '困难', hidden: !1, fail: '' });
    assert.deepEqual(T.normalizeCheck('幸运/侦查'), { skills: ['幸运', '侦查'], level: '普通', hidden: !1, fail: '' });
    assert.equal(T.normalizeCheck(null), null);
    assert.equal(T.normalizeCheck({ 难度: '困难' }), null);
});

// 和 clue-core 测试同样的最小样本：阶段一一个节点，焦点在它上面。
function projectionOf(discovery, settings = {}, checks = null, focus = 'n1') {
    let vols = [{ id: 'v1', key: '剧情_卷一_测试', stages: [{ id: 's1', key: '阶段一_开端', data: { 主线节点: [{ id: 'n1', 名称: '查房间', 入口: '去房间看看', 场景: '房间里很暗', 发现: [discovery], 完成条件: { 事实: 'F01' } }] } }] }];
    let bind = [{ 表: '事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实', 内容列: '内容' }],
        t = { sheet_f: { name: '事实表', content: [[null, '编号', '状态', '内容']] } },
        f = C.readFacts(t, bind),
        snap = { facts: f.facts, knowledge: [], tables: t, problems: f.problems },
        prog = { ...C.emptyClueProgress(), focus },
        state = C.computeClueState(C.compileClue(vols), snap, prog, C.normalizeClue({ mode: 'clue', bindings: { facts: bind }, autoFocusSingle: focus !== '' }));
    return C.buildClueProjection(state, snap, prog, { tagName: '剧情参考', ...settings }, { checks }).content;
}

test('不干扰线索模式：发现没有判定时，投影里没有任何跑团文字，与写 判定: null 完全相同', () => {
    let plain = projectionOf({ 事实: 'F01', 内容: '床下有一封信' }),
        nulled = projectionOf({ 事实: 'F01', 内容: '床下有一封信', 判定: null });
    assert.match(plain, /- 床下有一封信\n/);
    assert.equal(plain, nulled);
    assert.ok(!plain.includes('需要判定'));
    assert.ok(!plain.includes(T.CHECK_RULE));
    assert.deepEqual(C.discoveryList({ 发现: [{ 事实: 'F01', 内容: 'x', 记录: 'y' }] }), [{ fact: 'F01', text: 'x', record: 'y' }]);
});

test('跑团：掷骰前只写待判定，不给线索内容；检定写法随设置', () => {
    let out = projectionOf({ 事实: 'F01', 内容: '床下有一封信', 判定: { 技能: '侦查', 失败: '只摸到灰' } });
    assert.match(out, /- 待判定 #F01：侦查。/);
    assert.ok(!out.includes('床下有一封信'), '掷骰前不能给内容');
    assert.ok(out.includes(T.CHECK_RULE));
    assert.ok(!out.includes('igs-anke'));
    let anke = projectionOf({ 事实: 'F01', 内容: '床下有一封信', 判定: { 技能: '侦查' } }, { trpgCheck: 'anke' });
    assert.ok(anke.includes(T.CHECK_RULE_ANKE));
    assert.ok(anke.includes('[igs-anke:检定|问题|对象|技能|技能值|难度|编号]'));
    // 没有判定时检定写法不起作用
    assert.equal(projectionOf({ 事实: 'F01', 内容: '床下有一封信' }, { trpgCheck: 'anke' }), projectionOf({ 事实: 'F01', 内容: '床下有一封信' }));
});

test('机械判定：CoC 规则', () => {
    assert.deepEqual(T.cocJudge(23, 60, '困难'), { tier: '困难成功', ok: true, need: 30 });
    assert.deepEqual(T.cocJudge(40, 60, '困难'), { tier: '成功', ok: false, need: 30 });
    assert.deepEqual(T.cocJudge(12, 60, '极难'), { tier: '极难成功', ok: true, need: 12 });
    assert.equal(T.cocJudge(5, 10, '极难').tier, '大成功', '≤5 大成功');
    assert.deepEqual(T.cocJudge(97, 40), { tier: '大失败', ok: false, need: 40 });
    assert.deepEqual(T.cocJudge(97, 60), { tier: '失败', ok: false, need: 60 });
    assert.equal(T.cocJudge(100, 99).tier, '大失败');
});

test('机械判定：请求和骰点的写法', () => {
    assert.deepEqual(T.parseCheckRequests('【检定】{{user}}：侦查 60（困难）#F_box'), [{ code: 'F_box', skill: '侦查', value: 60, level: '困难' }]);
    assert.deepEqual(T.parseCheckRequests('[igs-anke:检定|要掀开吗|{{user}}|聆听|50|普通|F_seen]'), [{ code: 'F_seen', skill: '聆听', value: 50, level: '普通' }]);
    assert.deepEqual(T.parseCheckRequests('【检定】{{user}}：侦查（困难）'), [], '没有编号的请求不认');
    assert.deepEqual(T.parseRoll('1D100=05'), { die: 5, value: null });
    assert.deepEqual(T.parseRoll('侦查 23', '侦查'), { die: 23, value: null });
    assert.deepEqual(T.parseRoll('掷出 23/60'), { die: 23, value: 60 });
    assert.deepEqual(T.parseRoll('过了，困难成功'), { word: '困难成功' });
    assert.equal(T.parseRoll('我去厨房'), null);
});

test('机械判定：从聊天记录算结果；没写技能值的请求用用户给的；第一次为准', () => {
    let chat = [
        { is_user: false, mes: '【检定】{{user}}：侦查（困难）#F01' },
        { is_user: true, mes: '侦查 1D100=23/60' },
        { is_user: false, mes: '……' },
        { is_user: true, mes: '1D100=99' },
    ];
    let r = T.trpgCheckResults(chat);
    assert.equal(r.F01.ok, true);
    assert.equal(r.F01.value, 60);
    assert.equal(r.F01.fresh, false, '不是最新一条用户消息里掷的');
    assert.equal(T.trpgCheckResults(chat.slice(0, 2)).F01.fresh, true);
    assert.deepEqual(T.trpgCheckResults([{ is_user: true, mes: '1D100=23' }]), {}, '没有请求的骰点不算');
});

function checksOf(chat) {
    return T.trpgCheckResults(chat);
}

test('机械判定：成功给内容，失败不给；失败但「仍然得到」也给', () => {
    let d = { 事实: 'F01', 内容: '床下有一封信', 判定: { 技能: '侦查', 难度: '困难' } },
        req = { is_user: false, mes: '【检定】{{user}}：侦查 60（困难）#F01' };
    let ok = projectionOf(d, {}, checksOf([req, { is_user: true, mes: '1D100=23' }]));
    assert.match(ok, /- 判定成功 #F01（侦查 1D100=23／60，困难成功）：这一轮写出这条发现：床下有一封信/);
    let no = projectionOf(d, {}, checksOf([req, { is_user: true, mes: '1D100=45' }]));
    assert.match(no, /- 判定失败 #F01（侦查 1D100=45／60，成功）：没有发现。不要写出这条发现/);
    assert.ok(!no.includes('床下有一封信'));
    let soft = projectionOf({ ...d, 判定: { ...d.判定, 失败: '仍然找到，但花了半小时' } }, {}, checksOf([req, { is_user: true, mes: '1D100=45' }]));
    assert.match(soft, /判定失败 #F01.*仍然找到，但花了半小时。可以写出：床下有一封信/);
});

test('机械判定：焦点不在那个节点时，刚掷的结果单独列出，正文不会只看到「成功了」', () => {
    let d = { 事实: 'F01', 内容: '床下有一封信', 判定: { 技能: '侦查' } },
        checks = checksOf([{ is_user: false, mes: '【检定】{{user}}：侦查 60 #F01' }, { is_user: true, mes: '1D100=10' }]),
        out = projectionOf(d, {}, checks, '');
    assert.match(out, /刚才的判定结果（用户这一轮掷的骰）：\n- 判定成功 #F01/);
    assert.ok(out.includes('床下有一封信'));
    assert.ok(T.CHECK_RULE.includes('绝不要自己编'));
});

test('不干扰线索模式：导入提示词只有跑团任务才追加规则', () => {
    let args = { part: { i: 0, title: '第一段', text: '材料' }, index: '人物: []', mode: 'clue' },
        base = C.importDraftMessages(args);
    assert.deepEqual(C.importDraftMessages({ ...args, trpg: !1 }), base);
    assert.ok(!base[0].content.includes('跑团模组'));
    assert.ok(C.importDraftMessages({ ...args, trpg: !0 })[0].content.includes(T.TRPG_IMPORT_RULES));
    // 按阶段推进的导入不受跑团标记影响
    let outline = { ...args, mode: 'outline' };
    assert.deepEqual(C.importDraftMessages({ ...outline, trpg: !0 }), C.importDraftMessages(outline));
});

test('项目：没开跑团的项目没有 trpg 键；开过的保留', () => {
    assert.ok(!('trpg' in C.normalizeProject({ name: 'a' }, 'p1')));
    assert.deepEqual(C.normalizeProject({ name: 'a', trpg: { on: true } }, 'p1').trpg, { on: !0, rule: 'coc7' });
});

test('项目文件：跑团标记随完整项目导出、导入；普通项目不带', async () => {
    let PF = await import('../src/core/project-file.js');
    assert.ok(!('trpg' in PF.buildProjectFile({ id: 'p1', name: 'a' }).project));
    let file = PF.buildProjectFile({ id: 'p1', name: 'a', setting: { text: '背景:\n派对' }, trpg: { on: true } });
    assert.deepEqual(file.project.trpg, { on: !0, rule: 'coc7' });
    assert.deepEqual(PF.parseProjectFile(JSON.stringify(file)).project.trpg, { on: !0, rule: 'coc7' });
});

test('pdf 读取：按页取文字层交给版式还原（假 pdf.js，不联网）', async () => {
    let { pdfFileToText, isPdfFile } = await import('../src/host/pdf-load.js'),
        item = (str, y) => ({ str, transform: [1, 0, 0, 1, 36, y], width: str.length * 12, height: 12, fontName: 'f', hasEOL: !0 }),
        pages = [[item('第一页的一句话。', 780)], []],
        seen = [],
        lib = {
            getDocument: (opts) => (seen.push(opts), {
                promise: Promise.resolve({
                    numPages: pages.length,
                    getPage: async (n) => ({ getViewport: () => ({ width: 595, height: 842 }), getTextContent: async () => ({ items: pages[n - 1] }) }),
                    destroy() {},
                }),
            }),
        },
        progress = [],
        file = { name: '模组.PDF', arrayBuffer: async () => new ArrayBuffer(4) };
    assert.ok(isPdfFile(file) && !isPdfFile({ name: 'a.txt', type: 'text/plain' }));
    let r = await pdfFileToText(file, { load: async () => ({ lib, base: 'https://x/' }), onProgress: (n, t) => progress.push(`${n}/${t}`) });
    assert.equal(r.text, '第一页的一句话。');
    assert.match(r.warnings[0], /第2页没有文字层/);
    assert.deepEqual(progress, ['1/2', '2/2']);
    assert.equal(seen[0].cMapUrl, 'https://x/cmaps/');
});

test('KP 规则：小标题降级、加上 KP 资料说明、成为一个设定分块', () => {
    let block = T.kpBlockText('机制与计量:\n- 每半小时体质检定，失败临界值+1\n\n理智检定：\n- 目睹尸体 0/1d3');
    assert.match(block, /^KP规则:\n（KP 资料/);
    assert.match(block, /【机制与计量】\n- 每半小时/);
    assert.match(block, /【理智检定】\n- 目睹尸体/);
    let blocks = C.splitBlocks(`背景:\n别墅派对\n\n${block}`);
    assert.deepEqual(blocks.map((b) => b.key), ['背景', 'KP规则']);
    assert.equal(T.kpBlockText(''), '');
});

test('IGS 技能值：用户只写骰点、请求没写技能值时，用 IGS 调查员档的技能值判；没有 IGS 时照旧', () => {
    const chat = [{ is_user: false, mes: '【检定】{{user}}：侦查（普通）#F09' }, { is_user: true, mes: '1D100=65' }];
    try {
        T.setIgsView({ IGS: { stats: { investigator: () => ({ sheet: true, skills: { 侦查: 70 } }) } } });
        const on = T.trpgCheckResults(chat).F09;
        assert.equal(on?.value, 70);
        assert.equal(on?.ok, true);
        T.setIgsView(null);
        assert.equal(T.trpgCheckResults(chat).F09, undefined);
    } finally {
        T.setIgsView(null);
    }
});
