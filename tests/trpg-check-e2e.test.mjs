// 跑团机械判定，发布包 + 模拟酒馆走完整一轮（用户 11-22）：
// 正文写检定请求时看不到线索 → 用户消息带骰点 → 同一轮拼提示词时插件按 CoC 规则判成败 → 成功才把线索交给正文。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';

const CLUE = '浴缸里躺着一具打扮成僵尸的尸体_唯一测试串';
const OUTLINE = [{
    id: 'v1', key: '剧情_卷一_别墅', stages: [
        { id: 's1', key: '阶段一_卫生间', data: { 主线节点: [
            { id: 'nA', 名称: '卫生间', 入口: '去卫生间', 场景: '浴帘拉着，后面好像有东西', 发现: [{ 事实: 'FA', 内容: CLUE, 判定: { 技能: '侦查', 难度: '困难' } }], 完成条件: { 事实: 'FA' } },
        ] } },
    ],
}];
const BINDINGS = { facts: [{ 表: '事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实', 内容列: '内容' }] };
const TABLES = { sheet_f: { name: '事实表', content: [[null, '编号', '状态', '内容']] } };
const REQUEST = '你伸手去拉浴帘。\n【检定】{{user}}：侦查 60（困难）#FA';

async function setup() {
    const host = createHost({ tables: TABLES });
    const inst = host.load();
    await inst.ready;
    inst.data.updateSettings({ trpgAutoCheck: false }); // 这两条只测机械判定，不让每轮 KP 检测调模型
    const project = await inst.data.createProject('别墅');
    inst.data.updateProject(project.id, (p) => ({ ...p, outline: { volumes: OUTLINE }, clue: { mode: 'clue', inject: 'worldbook', bindings: BINDINGS }, trpg: { on: true } }));
    await inst.runtime.switchProject(project.id);
    await host.eventSource.emit(host.eventTypes.CHAT_CHANGED, 'chat-1');
    await host.settle();
    return { host, inst };
}

test('掷骰前正文看不到线索；带骰点的消息发出后，同一个请求里就有线索', async () => {
    const { host, inst } = await setup();
    const r1 = await host.send('我去卫生间看看浴缸', { reply: REQUEST });
    assert.match(r1.text, /待判定 #FA：侦查（困难）/);
    assert.ok(!r1.text.includes(CLUE), '掷骰前线索不能给正文');
    const r2 = await host.send('侦查 1D100=23');
    assert.match(r2.text, /判定成功 #FA（侦查 1D100=23／60，困难成功）/);
    assert.ok(r2.text.includes(CLUE), '成功后线索在这一轮的请求里');
    assert.ok(r2.text.includes('侦查 1D100=23'), '用户的骰点和线索在同一个请求里');
    assert.equal(host.llmCalls.length, 0, '判定不调模型');
    await inst.destroy();
});

test('困难没过：只给失败，线索不给；之后再掷也不改判', async () => {
    const { host, inst } = await setup();
    await host.send('我去卫生间看看浴缸', { reply: REQUEST });
    const r2 = await host.send('1D100=45', { reply: '你什么也没看清。' });
    assert.match(r2.text, /判定失败 #FA（侦查 1D100=45／60，成功）/);
    assert.ok(!r2.text.includes(CLUE));
    const r3 = await host.send('我再看一次 1D100=05');
    assert.match(r3.text, /判定失败 #FA/, '同一个检定不重掷');
    assert.ok(!r3.text.includes(CLUE));
    await inst.destroy();
});


// KP 每轮自动检测（11-23 计划 P2/P3）：原句核对、「情况」条件推进阶段
const KP_OUTLINE = [{
    id: 'v1', key: '剧情_卷一_别墅', stages: [
        { id: 's1', key: '阶段一_卫生间', data: { 结束条件: '情况: 主角们到达花园', 主线节点: [
            { id: 'nA', 名称: '卫生间', 入口: '去卫生间', 场景: '浴帘拉着', 发现: [{ 事实: 'FA', 内容: CLUE, 记录: '必须看到浴缸里的尸体' }], 完成条件: { 事实: 'FA' } },
        ] } },
        { id: 's2', key: '阶段二_花园', data: { 主线节点: [{ id: 'nB', 名称: '花园', 入口: '去花园', 场景: '花园里有雾', 完成条件: { 事实: 'FB' } }] } },
    ],
}];
const REPLY = '你拉开浴帘，浴缸里躺着一具僵尸打扮的尸体。随后大家走进了花园。';

async function kpRound(quote, { tables = TABLES, bindings = BINDINGS } = {}) {
    const host = createHost({ tables });
    const inst = host.load();
    await inst.ready;
    const project = await inst.data.createProject('别墅');
    inst.data.updateProject(project.id, (p) => ({ ...p, outline: { volumes: KP_OUTLINE }, clue: { mode: 'clue', inject: 'worldbook', bindings }, trpg: { on: true } }));
    await inst.runtime.switchProject(project.id);
    await host.eventSource.emit(host.eventTypes.CHAT_CHANGED, 'chat-1');
    await host.settle();
    host.llm.reply = JSON.stringify({
        facts: [{ id: 'FA', pass: true, quote, why: '看到了' }, { id: 'FZ', pass: true, quote, why: '不在候选里' }],
        conds: [{ text: '主角们到达花园', pass: true, quote: '随后大家走进了花园' }],
        scene: '', offTrack: false,
    });
    await host.send('我去卫生间看看浴缸', { reply: REPLY });
    await host.settle();
    return { host, inst, c: inst.runtime.clue.compute() };
}

test('KP 检测：有原句支撑的线索记为已拿到，「情况」条件成立后阶段推进', async () => {
    const { inst, c } = await kpRound('浴缸里躺着一具僵尸打扮的尸体');
    assert.equal(c.prog.factOverrides.FA.by, 'kp');
    assert.ok(!c.prog.factOverrides.FZ, '候选以外的编号一律忽略');
    const status = Object.fromEntries(c.state.nodeStates.map((s) => [s.node.uid, s.status]));
    assert.equal(status.nA, 'done');
    assert.ok(c.state.stageStates.get('s1').done, '一句话条件判成立后第一阶段结束');
    assert.ok(['available', 'active'].includes(status.nB));
    await inst.destroy();
});

test('KP 检测：原句是编的，线索不算拿到', async () => {
    const { inst, c } = await kpRound('浴缸里藏着一根金条');
    assert.ok(!c.prog.factOverrides.FA);
    const log = inst.runtime.progress().trpgKp.log;
    assert.equal(log[log.length - 1].facts[0].ok, false);
    await inst.destroy();
});

test('KP 检测：通过的线索写回事实表和知情表，没有对应行的不建行', async () => {
    const tables = {
        sheet_f: { name: '事实表', content: [[null, '编号', '状态', '内容'], [null, 'FA', '未获得', '']] },
        sheet_k: { name: '知情表', content: [[null, '键', '事实', '角色', '获知方式', '可信度'], [null, 'FA@user', 'FA', 'user', '未知', '未核实'], [null, 'FA@老板', 'FA', '老板', '未知', '未核实']] },
    };
    const bindings = {
        facts: BINDINGS.facts,
        knowledge: [{ 表: '知情表', 事实列: '事实', 角色列: '角色', 方式列: '获知方式', 可信度列: '可信度', 已核实值: '已核实', 有效值: ['亲见', '被告知'] }],
    };
    const { host, inst, c } = await kpRound('浴缸里躺着一具僵尸打扮的尸体', { tables, bindings });
    assert.equal(c.prog.factOverrides.FA.by, 'kp');
    const f = host.db.tables.sheet_f.content, k = host.db.tables.sheet_k.content;
    assert.deepEqual(f[1].slice(1), ['FA', '已核实', CLUE]);
    assert.deepEqual(k[1].slice(4), ['亲见', '已核实'], '主角那一行标知道');
    assert.deepEqual(k[2].slice(4), ['未知', '未核实'], '别的角色不动');
    assert.equal(f.length, 2, '不新建行');
    await inst.destroy();
    // 表里没有这一行：只记日志，不建行，判断照样生效
    const r = await kpRound('浴缸里躺着一具僵尸打扮的尸体');
    assert.equal(r.host.db.tables.sheet_f.content.length, 1);
    assert.equal(r.c.prog.factOverrides.FA.by, 'kp');
    assert.match(JSON.stringify(r.inst.runtime.progress().trpgKp.log.at(-1).tables), /没写/);
    await r.inst.destroy();
});
