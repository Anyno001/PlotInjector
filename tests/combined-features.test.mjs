import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';
import { createHost } from './host-sim.mjs';

const C = loadCore();
const line = (extra = {}) => ({
    id: 'person', name: '信任变化', mode: 'check', constant: true, enabled: true,
    stages: [
        { id: 'p1', name: '戒备', text: '人设甲：保持戒备。' },
        { id: 'p2', name: '信任', text: '人设乙：愿意信任。', cond: '玩家帮了她' },
    ], ...extra,
});
const outline = () => [{ id: 'v', key: '剧情_调查', stages: [
    { id: 's1', key: '阶段1_入场', data: { 主线节点: [{ id: 'n1', 名称: '入场', 入口: '进门调查', 场景: '门内有一张桌子', 完成条件: { 事实: 'F1' } }] } },
    { id: 's2', key: '阶段2_后续', data: { 主线节点: [{ id: 'n2', 名称: '后续调查', 入口: '继续调查', 场景: '调查桌上的东西' }] } },
] }];
async function setup(t, mode = 'clue', extra = {}) {
    const host = createHost();
    const inst = host.load();
    await inst.ready;
    t.after(() => inst.destroy());
    const p = await inst.data.createProject('组合回归');
    inst.data.updateProject(p.id, x => ({ ...x, outline: { ...x.outline, volumes: outline() },
        clue: { ...x.clue, mode }, personas: { lines: [line(extra)] } }));
    inst.data.updateSettings({ checkEvery: 1, personaMode: 'auto' });
    await inst.runtime.switchProject(p.id);
    assert.equal(inst.runtime.activeId(), p.id);
    return { host, inst, id: p.id };
}

test('combined: outline continuation and persona options share buildEntries without losing either', () => {
    const p = C.normalizeProject({ id: 'p', outline: { volumes: outline() }, personas: { lines: [line()] } }, 'p');
    const progress = C.emptyProgress('p');
    const entries = C.buildEntries(p, progress, C.normalizeSettings({}), { stayOf: () => '承接标记', recentText: '' });
    assert.match(entries.find(e => e.kind === 'detail').content, /承接标记/);
    assert.match(entries.map(e => e.content).join('\n'), /人设甲/);
    assert.match(C.buildEntries(p, progress, C.normalizeSettings({}), () => '旧回调兼容').map(e => e.content).join('\n'), /旧回调兼容/);
});

test('combined: clue mode keeps keyword personas, records stays, and makes no automatic detector calls', async t => {
    const { host, inst } = await setup(t, 'clue', { constant: false, keys: ['向导'] });
    assert.doesNotMatch((await host.send('我推门进去', { reply: '门被推开。' })).text, /人设甲/);
    assert.match((await host.send('我看向向导', { reply: '向导点了点头。' })).text, /人设甲/);
    assert.ok(inst.runtime.progress().stays.length);
    assert.equal(host.llmCalls.length, 0);
});

test('combined: a persona following the outline uses clue stage facts without overwriting outline progress', async t => {
    const persona = line({ mode: 'outline' });
    persona.stages[0].unitId = 's1';
    persona.stages[1].unitId = 's2';
    const { host, inst } = await setup(t, 'clue', persona);
    assert.match((await host.worldInfo()).map(e => e.content).join('\n'), /人设甲/);
    inst.runtime.clue.act({ kind: 'fact', target: 'F1', value: 'confirmed' });
    const text = (await host.worldInfo()).map(e => e.content).join('\n');
    assert.match(text, /人设乙/);
    assert.doesNotMatch(text, /人设甲/);
    assert.notEqual(inst.runtime.progress().current, 's2', 'outline progress stays independent');
});

test('combined: manual clue check can advance a persona in the same request', async t => {
    const { host, inst } = await setup(t);
    await host.addMessage('玩家帮了她。', false);
    host.llm.reply = '{"done":[],"personas":[{"line":"信任变化","to":"信任","floor":0,"reason":"帮了她"}]}';
    await inst.runtime.checkNow({ manual: true });
    assert.equal(host.llmCalls.length, 1);
    assert.match(host.llmCalls[0].body, /人设阶段/);
    assert.equal(inst.runtime.progress().personas.person, 'p2');
});

test('combined: persona-only detector results cannot apply to another project', async t => {
    const { host, inst, id } = await setup(t, 'outline');
    inst.data.updateProject(id, p => ({ ...p, outline: { ...p.outline, volumes: [] } }));
    await host.addMessage('玩家帮了她。', true);
    let resolve;
    host.llm.respond = () => new Promise(r => { resolve = r; });
    const pending = inst.runtime.checkNow({ manual: true });
    for (let i = 0; !resolve && i < 30; i++) await host.settle();
    assert.equal(typeof resolve, 'function');
    const other = await inst.data.createProject('另一个项目');
    await inst.runtime.switchProject(other.id);
    resolve('{"personas":[{"line":"信任变化","to":"信任","floor":0}]}');
    await pending;
    assert.equal(inst.runtime.progress().projectId, other.id);
    assert.equal(inst.runtime.progress().personas, undefined);
    assert.equal(host.w.document.querySelector('[data-notice="persona"]'), null);
});

test('combined: line metadata, imports, and newer chat fields survive normalization and JSON round trips', () => {
    const volumes = outline();
    volumes[0].line = { 编号: 'S01', 类型: '支线', 开启方式: '人工' };
    const source = { id: 'p', outline: { volumes }, importLineMap: { 'job:S01': 'v' },
        clue: { mode: 'clue', inject: 'link', waitFill: false }, personas: { lines: [line()] } };
    const p = C.normalizeProject(JSON.parse(JSON.stringify(C.normalizeProject(source, 'p'))), 'p');
    assert.deepEqual(p.outline.volumes[0].line, volumes[0].line);
    assert.deepEqual(p.importLineMap, source.importLineMap);
    assert.equal(p.personas.lines.length, 1);
    assert.equal(p.clue.inject, 'worldbook');
    assert.equal('waitFill' in p.clue, false);
    assert.equal(p.clue.sideLimit, 1);
    const saved = { projectId: 'p', stays: [{ i: 2, key: 'n1' }], lineFloors: [{ i: 2, offer: 'S01' }], clue: { ops: [] } };
    const progress = C.normalizeProgress(JSON.parse(JSON.stringify(saved)), 'p');
    for (const key of ['stays', 'lineFloors', 'clue']) assert.deepEqual(progress[key], saved[key]);
});
