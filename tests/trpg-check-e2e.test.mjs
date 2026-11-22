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

test('论坛安科写法的请求、IGS 填进来的结果行也能对上', async () => {
    const { host, inst } = await setup();
    await host.send('我去卫生间看看浴缸', { reply: '要不要拉开浴帘？\n[igs-anke:检定|拉不拉浴帘|{{user}}|侦查|60|困难|FA]' });
    const r2 = await host.send('【检定】{{user}} 侦查：1D100=12，困难线30，困难成功');
    assert.match(r2.text, /判定成功 #FA/);
    assert.ok(r2.text.includes(CLUE));
    await inst.destroy();
});
