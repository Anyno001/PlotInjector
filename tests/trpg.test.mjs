// 跑团模式（core/trpg.js、core/doc-pdf.js）与「不干扰线索模式」的回归测试。样本全部自造，不含任何模组原文。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import * as T from '../src/trpg/trpg.js';
import * as P from '../src/core/doc-pdf.js';
import * as TR from '../src/trpg/trpg-clue-rules.js';
import * as TP from '../src/trpg/trpg-clue-project.js';

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
        state = TR.computeClueState(TR.compileClue(vols), snap, prog, C.normalizeClue({ mode: 'clue', bindings: { facts: bind }, autoFocusSingle: focus !== '' }));
    return TP.buildClueProjection(state, snap, prog, { tagName: '剧情参考', ...settings }, { checks }).content;
}



test('机械判定：CoC 规则', () => {
    assert.deepEqual(T.cocJudge(23, 60, '困难'), { tier: '困难成功', ok: true, need: 30 });
    assert.deepEqual(T.cocJudge(40, 60, '困难'), { tier: '成功', ok: false, need: 30 });
    assert.deepEqual(T.cocJudge(12, 60, '极难'), { tier: '极难成功', ok: true, need: 12 });
    assert.equal(T.cocJudge(5, 10, '极难').tier, '大成功', '≤5 大成功');
    assert.deepEqual(T.cocJudge(97, 40), { tier: '大失败', ok: false, need: 40 });
    assert.deepEqual(T.cocJudge(97, 60), { tier: '失败', ok: false, need: 60 });
    assert.equal(T.cocJudge(100, 99).tier, '大失败');
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




test('项目文件：跑团标记随完整项目导出、导入；普通项目不带', async () => {
    let PF = await import('../src/core/project-file.js');
    assert.ok(!('trpg' in PF.buildProjectFile({ id: 'p1', name: 'a' }).project));
    let file = PF.buildProjectFile({ id: 'p1', name: 'a', setting: { text: '背景:\n派对' }, trpg: { on: true } });
    assert.deepEqual(file.project.trpg, { on: !0, rule: 'coc7' });
    assert.deepEqual(PF.parseProjectFile(JSON.stringify(file)).project.trpg, { on: !0, rule: 'coc7' });
});




test('判定卡：状态、没认出的骰点、对不上的编号', async () => {
    let B = await import('../src/trpg/trpg-check-board.js'),
        chat = [
            { is_user: false, mes: '【检定】我：侦查（困难）#F01' },
            { is_user: true, mes: '1d100 23' },
            { is_user: true, mes: '1D100=23/60' },
            { is_user: false, mes: '【检定】我：聆听 #F99' },
        ],
        checks = T.trpgCheckResults(chat);
    assert.deepEqual(Object.keys(checks), ['F01']);
    assert.deepEqual(checks.problems.map((p) => [p.at, p.kind]), [[1, 'unparsed']]);
    let state = { nodeStates: [{ status: 'available', node: { name: '厕所', item: { 发现: [{ 事实: 'F01', 内容: '墙上有字', 判定: { 技能: '侦查', 难度: '困难' } }, { 事实: 'F02', 内容: '门后有人', 判定: '聆听' }] } } }] },
        board = B.trpgCheckBoard({ state, snap: { facts: new Map() }, prog: {}, checks });
    assert.deepEqual(board.rows.map((r) => [r.status, !!r.label]), [['ok', true], ['wait', false]]);
    assert.deepEqual(board.problems.map((p) => p.kind), ['badcode']);
});

test('机械判定：IGS 安科 ROLL 那一行照用 IGS 判的成败', () => {
    let chat = [
            { is_user: false, mes: '[igs-anke:检定|翻不翻|楼主|侦查|50|困难|F01]' },
            { is_user: true, mes: '【检定】楼主 侦查：1D100=40，困难线35，困难成功 #F01' },
        ],
        r = T.trpgCheckResults(chat).F01;
    assert.equal(r.ok, true);
    assert.equal(r.die, 40);
    chat[1].mes = '【检定】楼主 侦查：1D100=40，困难线30，成功（没达到难度） #F01';
    assert.equal(T.trpgCheckResults(chat).F01.ok, false);
});

test('导入检查：阶段衔接、跨阶段卡死能报出，一键修后不再报', async () => {
    let K = await import('../src/trpg/trpg-import-check.js'),
        L = await import('../src/trpg/trpg-long-import.js'),
        node = (id, name, extra) => ({ id, 名称: name, 入口: '入口', 地点: ['地点'], 场景: '场景', ...extra }),
        data = (a, b) => [
            { key: '阶段1 开场', data: { 结束条件: { 任一: ['时间 >= 18:00', { 事实: 'F_a' }] }, 主线节点: [node('n1', '入住', { 发现: [{ 事实: 'F_a', 内容: '甲', 记录: '甲' }], 完成条件: { 事实: 'F_a' } })] } },
            { key: '阶段2 中段', data: { 进入条件: { 任一: ['时间 >= 18:00', { 事实: 'F_a' }] }, 结束条件: { 事实: 'F_b' }, 主线节点: [node('n2', '深入', { 发现: [{ 事实: 'F_b', 内容: '乙', 记录: '乙' }], 完成条件: { 事实: 'F_b' } })] } },
            { key: '阶段3 收尾', data: { 进入条件: { 任一: ['时间 >= 21:00', { 事实: 'F_b' }] }, 主线节点: [node('n3', '收尾', { 开放条件: { 事实: 'F_b' }, 发现: [{ 事实: 'F_c', 内容: '丙', 记录: '丙' }], 完成条件: { 事实: 'F_c' } })] } },
        ].map((s, i) => ({ ...s, id: `s${i}` })),
        vols = [{ id: 'v1', key: '卷', stages: data() }],
        kinds = () => L.importReachIssues(vols).filter((x) => /^(gap|skip-stuck)$/.test(x.kind));
    assert.deepEqual(kinds().map((x) => x.kind).sort(), ['gap', 'gap', 'skip-stuck']);
    for (let i = 0; i < 6 && kinds().length; i++) K.applyImportFix(vols, kinds().find((x) => x.quick).quick.q);
    assert.deepEqual(kinds(), []);
    assert.equal(K.guessClock('晚上七点半'), '19:30');
});

test('判定提醒：两轮没出检定、判定成功线索没确认；阶段提醒', async () => {
    let B = await import('../src/trpg/trpg-check-board.js'),
        KC = await import('../src/trpg/trpg-kp-card.js'),
        ai = (mes) => ({ is_user: false, mes }),
        usr = (mes) => ({ is_user: true, mes }),
        node = { uid: 'n1', name: '厕所', item: { 发现: [{ 事实: 'F01', 内容: '墙上有字', 判定: '侦查' }] } },
        state = { nodeStates: [{ status: 'available', node }] },
        prog = { clueCandidates: [{ i: 0, scenes: [{ uid: 'n1', focus: !0 }], candidates: [] }] },
        rows = (chat) => B.trpgCheckBoard({ state, snap: { facts: new Map() }, prog, checks: T.trpgCheckResults(chat), messages: chat }).rows;
    assert.equal(rows([ai('a')])[0].nudge, '');
    assert.equal(rows([ai('a'), usr('x'), ai('b')])[0].nudge, 'norequest');
    let asked = [ai('a【检定】我：侦查 #F01'), usr('1D100=10/50'), ai('b'), usr('x')];
    assert.equal(rows(asked)[0].nudge, '');
    assert.equal(rows([...asked, ai('c')])[0].nudge, 'unconfirmed');
    let stage = (id, k, left, entered) => [id, { unit: { volIndex: 0, stage: { key: k } }, done: !1, requiredLeft: left, entered: { v: entered } }],
        lags = KC.stageLags({ stageStates: new Map([stage('a', '阶段1_开场', [node], 'true'), stage('b', '阶段2_中段', [], 'true')]), nodeStates: state.nodeStates });
    assert.deepEqual(lags.map((g) => [g.prev, g.next, g.left.length]), [['阶段1', '阶段2', 1]]);
    assert.equal(KC.stageLags({ stageStates: new Map([stage('a', '阶段1_开场', [node], 'true'), stage('b', '阶段2_中段', [], 'false')]), nodeStates: state.nodeStates }).length, 0);
});
