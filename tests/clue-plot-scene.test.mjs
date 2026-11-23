// 借剧情推进判断本轮走进了哪个场景：推进预设复制成「原名（线索模式）」并加一段场景判断（只在 SQLite 模式），
// 注入时读最后一条用户消息上的推进原文，判断出的场景当轮给材料；<pi_scene> 行不进正文请求。
import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';
import { buildTemplate, BINDING_YAML } from '../templates/clue-tables/build-template.mjs';

const C = loadCore();
const tick = () => new Promise((r) => setTimeout(r, 20));
const wait = (ms) => new Promise((r) => setTimeout(r, ms));
const PRESET = {
  name: '时间召回',
  plotTasks: [{ id: 'defaultPlotTask', name: '默认任务', enabled: true, extractTags: 'recall', promptGroup: [
    { role: 'SYSTEM', content: '你是记忆召回助手', deletable: false },
    { role: 'USER', content: '本轮输入：$8', deletable: false },
    { role: 'assistant', content: '好的，', deletable: true },
  ] }],
};

test('core: the segment goes before the trailing assistant prefill of the first enabled task; stripping gives the original back', () => {
  const copy = C.withSceneTask(PRESET, '时间召回（线索模式）');
  const g = copy.plotTasks[0].promptGroup;
  assert.deepEqual(g.map((s) => s.role), ['SYSTEM', 'USER', 'USER', 'assistant']);
  assert.match(g[2].content, /SELECT 场景目录 FROM 线索控制表/);
  assert.equal(copy.name, '时间召回（线索模式）');
  assert.equal(JSON.stringify({ ...C.stripSceneTask(copy), name: '' }), JSON.stringify({ ...PRESET, name: '' }));
  assert.ok(C.sceneTaskCurrent(copy, PRESET));
  assert.ok(!C.sceneTaskCurrent(copy, { ...PRESET, plotTasks: [{ ...PRESET.plotTasks[0], extractTags: 'recall,x' }] }), 'original changed');
  assert.equal(C.withSceneTask({ name: 'x', plotTasks: [{ enabled: false, promptGroup: [] }] }, 'y'), null);
  assert.equal(C.readPlotScene('<recall>a</recall>\n<pi_scene> n_b </pi_scene>'), 'n_b');
  assert.equal(C.readPlotScene('<pi_scene>n_a</pi_scene>…<PI_SCENE>无</PI_SCENE>'), '无', 'last one wins');
  assert.equal(C.readPlotScene('nothing'), '');
  assert.equal(C.stripPlotScene('前文\n<pi_scene>n_b</pi_scene>\n后文'), '前文\n后文');
  assert.equal(C.plotOutputOf({ qrf_plot_tasks: { a: 'x', b: 'y' } }), 'x\ny');
  assert.equal(C.plotOutputOf({ qrf_plot: 'z' }), 'z');
});

const node = (id, fact) => ({ id, 名称: id, 入口: `去${id}`, 地点: `${id}处`, 场景: `${id}的店主罗莎在忙`, 发现: [{ 事实: fact, 内容: `${id}查到的`, 记录: `看到${id}时登记` }], 完成条件: { 事实: fact } });
const volumes = () => [
  { id: 'vM1', key: '剧情_M1_街区', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 'sM1', key: '阶段1_街区', data: { 主线节点: [node('n_a', 'F_a'), node('n_b', 'F_b')] } }] },
  { id: 'vS1', key: '剧情_S1_茶馆', line: { 编号: 'S1', 类型: '支线' }, stages: [{ id: 'sS1', key: '阶段1_茶馆', data: { 主线节点: [node('n_s', 'F_s')] } }] },
];
function liveTables(t) {
  const out = JSON.parse(JSON.stringify(t));
  for (const [k, s] of Object.entries(out)) if (k.startsWith('sheet_')) s.content = s.content.map((row, i) => (i === 0 ? row : [i, ...row.slice(1)]));
  return out;
}

async function setup({ sqlite = true, trpg = false } = {}) {
  const host = createHost({ tables: liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [], knowRows: [] })) });
  const api = host.w.AutoCardUpdaterAPI;
  api.sqlite = sqlite;
  api.plotPresets['时间召回'] = JSON.parse(JSON.stringify(PRESET)); api.plotBinding = '时间召回';
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('推进判断');
  const labels = { F_a: { label: 'a', criterion: 'a' }, F_b: { label: 'b', criterion: 'b' }, F_s: { label: 's', criterion: 's' } };
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: volumes() }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML), labels }, ...(trpg ? { trpg: { on: true } } : {}) }));
  await inst.runtime.switchProject(p.id);
  host.state.chat.push({ is_user: false, mes: '开场', send_date: 'g' });
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines(); await tick();
  // 本轮：用户消息先进聊天，推进原文由数据库稍后写上（delay 毫秒；null = 这一轮没有推进结果）
  const send = async (input, plot, delay = 0) => {
    const msg = { is_user: true, mes: input, send_date: `u${host.state.chat.length}` };
    host.state.chat.push(msg);
    if (plot != null) delay ? setTimeout(() => { msg.qrf_plot_tasks = { defaultPlotTask: plot }; }, delay) : (msg.qrf_plot_tasks = { defaultPlotTask: plot });
    const lore = await host.generate();
    return lore.map((e) => e.content).join('\n');
  };
  return { host, inst, api, send };
}

test('SQLite: the chat is switched to a copy with the scene step; the original stays; no rebuild while nothing changed', async () => {
  const { inst, api } = await setup();
  assert.equal(api.plotBinding, '时间召回（线索模式）');
  assert.deepEqual(api.plotPresets['时间召回'], PRESET, 'original untouched');
  assert.ok(C.sceneTaskCurrent(api.plotPresets['时间召回（线索模式）'], PRESET));
  const n = api.plotImports;
  await inst.runtime.clue.syncPlotPreset({ force: true });
  assert.equal(api.plotImports, n, 'up to date: not imported again');
  // the user edits the original → the copy follows
  api.plotPresets['时间召回'].plotTasks[0].promptGroup[0].content = '新的系统提示';
  await inst.runtime.clue.syncPlotPreset({ force: true });
  assert.equal(api.plotImports, n + 1);
  assert.equal(api.plotPresets['时间召回（线索模式）'].plotTasks[0].promptGroup[0].content, '新的系统提示');
  await inst.destroy();
});

test('the database was not ready when the chat opened: the copy is made when a message is sent, before the plot runs', async () => {
  const host = createHost({ tables: liveTables(buildTemplate({ controlRow: ['主线', ''], factRows: [], knowRows: [] })) });
  const api = host.w.AutoCardUpdaterAPI;
  api.sqlite = true;
  api.plotPresets['时间召回'] = JSON.parse(JSON.stringify(PRESET)); api.plotBinding = '';
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('推进判断');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: volumes() }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML), labels: {} } }));
  await inst.runtime.switchProject(p.id);
  host.state.chat.push({ is_user: false, mes: '开场', send_date: 'g' });
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines(); await tick();
  assert.equal(api.plotImports, 0, 'nothing to copy yet');
  api.plotBinding = '时间召回';
  let seen = '';
  host.eventSource.on(host.eventTypes.GENERATION_AFTER_COMMANDS || 'generation_after_commands', () => { seen = api.plotBinding; });
  host.state.chat.push({ is_user: true, mes: '去', send_date: 'u1' });
  await host.eventSource.emit(host.eventTypes.GENERATION_STARTED, 'normal', {}, false);
  assert.equal(api.plotBinding, '时间召回（线索模式）', 'switched before the plot step');
  await inst.destroy();
});

test('native mode: no copy, nothing switched', async () => {
  const { inst, api } = await setup({ sqlite: false });
  assert.equal(api.plotBinding, '时间召回');
  assert.equal(api.plotImports, 0);
  await inst.destroy();
});

// 推进预设只给线索模式：跑团项目不复制、不切换，推进里的场景判断也不用（用户 2026-11-23）
// 跑团项目走 src/trpg 自己的运行时：线索模式的推进预设复制和场景判断不调用（runtime.js 的 clueOnly）
test('TRPG projects: no copy, nothing switched, the plot scene line is ignored', async () => {
  const { inst, api, send } = await setup({ trpg: true });
  assert.equal(api.plotBinding, '时间召回');
  assert.equal(api.plotImports, 0);
  const text = await send('我去n_b处找罗莎', '<recall>x</recall>\n<pi_scene>n_b</pi_scene>');
  assert.ok(!/用户这一轮刚到这里/.test(text), 'no early arrival from the plot judgement');
  assert.equal(api.plotBinding, '时间召回', 'still not switched after a message');
  await inst.destroy();
});

test('the plot judged n_b this round: its scene and discovery go out now, with the arrival rule', async () => {
  const { inst, send } = await setup();
  const text = await send('我去n_b处找罗莎', '<recall>x</recall>\n<pi_scene>n_b</pi_scene>');
  assert.match(text, /n_b的店主罗莎在忙/);
  assert.match(text, /n_b查到的/);
  assert.match(text, /用户这一轮刚到这里/);
  assert.ok(!/n_a的店主/.test(text));
  await inst.destroy();
});

test('the result is written a moment after the message appears: still read (waits up to 2 s)', async () => {
  const { inst, send } = await setup();
  const text = await send('我去n_b处', '<pi_scene>n_b</pi_scene>', 300);
  assert.match(text, /n_b查到的/);
  await inst.destroy();
});

test('无, an unknown code, no result, or a side line not started yet: nothing early (the table decides next round)', async () => {
  for (const [plot, why] of [['<pi_scene>无</pi_scene>', '无'], ['<pi_scene>n_x</pi_scene>', 'unknown'], [null, 'no result'], ['<pi_scene>n_s</pi_scene>', 'side not started']]) {
    const { inst, send } = await setup();
    const text = await send('随便聊聊', plot);
    assert.ok(!/查到的/.test(text) && !/用户这一轮刚到这里/.test(text), why);
    await inst.destroy();
  }
});

test('main lines paused (暂停全部主线): nothing early even if the plot says n_b', async () => {
  const { inst, send } = await setup();
  inst.runtime.clue.setPaused(true, 'mains');
  const text = await send('我去n_b处', '<pi_scene>n_b</pi_scene>');
  assert.ok(!/n_b查到的/.test(text));
  await inst.destroy();
});

test('the judgement belongs to its round: a later message without a plot result does not reuse it', async () => {
  const { host, inst, send } = await setup();
  assert.match(await send('我去n_b处', '<pi_scene>n_b</pi_scene>'), /n_b查到的/);
  host.state.chat.push({ is_user: false, mes: '到了n_b处。', send_date: 'a9' });
  // 执行页「预览」：新消息已经进了聊天、这一轮还没生成，不能沿用上一轮的判断
  host.state.chat.push({ is_user: true, mes: '随便聊聊', send_date: 'u10' });
  assert.ok(!/n_b查到的/.test(inst.runtime.clue.projection().content), 'preview before the round');
  host.state.chat.pop();
  const text = await send('随便聊聊', null);
  assert.ok(!/n_b查到的/.test(text), 'the table has not recorded n_b, and this round had no plot result');
  await inst.destroy();
});

test('the <pi_scene> line never reaches the story request', async () => {
  const { host, inst } = await setup();
  const chat = [{ role: 'user', content: '以下是用户的本轮输入\n<pi_scene>n_b</pi_scene>\n继续' }, { role: 'system', content: [{ type: 'text', text: 'a <pi_scene>无</pi_scene>' }] }];
  await host.promptReady(chat);
  assert.equal(chat[0].content, '以下是用户的本轮输入\n继续');
  assert.equal(chat[1].content[0].text, 'a');
  await inst.destroy();
});
