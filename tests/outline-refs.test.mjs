// 大型项目方案 四.4：写卷、讨论的大纲参考。多线项目按选的线附完整内容，其余附简介；单线、老项目照旧整份。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';

const C = loadCore();
const tick = () => new Promise((r) => setTimeout(r, 20));
const node = (id, fact, extra = {}) => ({ id, 名称: id, 入口: `去${id}`, 发现: [{ 事实: fact, 内容: `${id}查到的`, 记录: `看到${id}时登记` }], 完成条件: { 事实: fact }, ...extra });

function volumes() {
  return [
    { id: 'vM1', key: '剧情_M1_街区', line: { 编号: 'M1', 类型: '主线', 简介: '街区出事' }, stages: [{ id: 's1', key: '阶段1_巷口', data: { AI指令: 'M1正文标记', 主线节点: [node('n_m1', 'F_m1')] } }] },
    { id: 'vM2', key: '剧情_M2_码头', line: { 编号: 'M2', 类型: '主线', 简介: '码头换货', 接上一条: true }, stages: [{ id: 's2', key: '阶段1_码头', data: { AI指令: 'M2正文标记', 主线节点: [node('n_m2', 'F_m2', { 相关事实: ['F_m1'] })] } }] },
    { id: 'vS1', key: '剧情_S01_仓库', line: { 编号: 'S01', 类型: '支线', 简介: '旧仓库' }, stages: [{ id: 's3', key: '阶段1_仓库', data: { AI指令: 'S01正文标记', 主线节点: [node('n_s1', 'F_s1')] } }] },
  ];
}

test('outlineRefText: chosen lines in full, the rest brief (summary, stages, node ids, facts, what they use from the full lines)', () => {
  const r = C.outlineRefText(volumes(), ['vM1']);
  assert.match(r.text, /M1正文标记/);
  assert.ok(!/M2正文标记|S01正文标记/.test(r.text), 'other lines not in full');
  assert.match(r.text, /- M2 码头：码头换货/);
  assert.match(r.text, /节点 id：n_m2/);
  assert.match(r.text, /产出事实：F_m2/);
  assert.match(r.text, /用到上面完整附带的线：F_m1/);
  assert.deepEqual(r.full, ['M1 街区']);
  assert.equal(r.brief, 2);
  const none = C.outlineRefText(volumes(), []);
  assert.ok(!/正文标记/.test(none.text));
  assert.equal(none.brief, 3);
});

async function setup(vols = volumes()) {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('多线');
  inst.data.updateProject(p.id, (x) => ({ ...x, setting: { ...x.setting, text: '设定' }, outline: { volumes: vols } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  const chat = await inst.data.loadChat(p.id);
  await inst.data.saveChat(p.id, { ...chat, messages: [{ id: 'm1', role: 'user', content: '想写新线', at: 1 }] });
  inst.open(); await tick();
  const doc = host.w.document;
  const click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  await click(`[data-act="project"][data-id="${p.id}"]`);
  return { host, inst, doc, click, pid: p.id };
}

test('discussion page: multi-line project → 大纲 opens the line picker; the chip names the chosen lines; the request has only them in full', async () => {
  const { host, inst, doc, click, pid } = await setup();
  await click('[data-act="tab"][data-tab="discuss"]');
  doc.querySelector('[data-act="refs-toggle"]') && (await click('[data-act="refs-toggle"]'));
  await click('[data-act="ref-outline"]');
  const dlg = doc.querySelector('.pi-dialog');
  assert.ok(dlg && /附带大纲/.test(dlg.textContent), 'picker opened');
  assert.equal(dlg.querySelectorAll('[data-ol-id]').length, 3);
  // default: the line being played (M1 in outline mode = the current unit's volume)
  assert.deepEqual([...dlg.querySelectorAll('[data-ol-id]:checked')].map((x) => x.dataset.olId), ['vM1']);
  dlg.querySelector('[data-ol-on]').click(); // turn on
  dlg.querySelector('[data-ol-id="vM2"]').checked = true;
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '确定').click(); await tick();
  const refs = inst.data.chat(pid).refs;
  assert.equal(refs.outline, true);
  assert.deepEqual(JSON.parse(JSON.stringify(refs.lines)), ['vM1', 'vM2']);
  assert.match(doc.querySelector('[data-act="ref-outline"]').textContent, /大纲M1、M2/);
  doc.querySelector('[data-compose]').value = '问一下';
  host.llm.reply = '好的';
  await click('[data-act="send"]'); await tick();
  const body = JSON.stringify(host.llmCalls.at(-1).args);
  assert.match(body, /M1正文标记/);
  assert.match(body, /M2正文标记/);
  assert.ok(!/S01正文标记/.test(body), 'S01 only brief');
  assert.match(body, /S01 仓库：旧仓库/);
  assert.ok(!/剧情_M1_街区·|M1街区·阶段/.test(body), 'not the stage-name fallback');
  await inst.destroy();
});

test('AI 写新剧情线: the dialog shows the same 大纲 chip; the request follows the chosen lines and the list says what was attached', async () => {
  const { host, inst, doc, click, pid } = await setup();
  const chat = inst.data.chat(pid) || (await inst.data.loadChat(pid));
  await inst.data.saveChat(pid, { ...chat, refs: { ...chat.refs, outline: true, lines: ['vS1'] } });
  await click('[data-act="tab"][data-tab="outline"]');
  await click('[data-act="ai-volume"]');
  const dlg = doc.querySelector('.pi-dialog');
  assert.match(dlg.textContent, /连续写几条|卷数/);
  const chip = dlg.querySelector('[data-act="gen-outline"]');
  assert.ok(chip, 'outline chip in the dialog');
  assert.match(chip.textContent, /大纲S01/);
  host.llm.reply = '```yaml\n剧情_卷4_新:\n  阶段1_新:\n    主线节点: []\n```';
  dlg.querySelector('.pi-btn.is-primary').click(); await tick(); await tick();
  const user = host.llmCalls.at(-1).args.prompt;
  assert.match(user, /S01正文标记/);
  // 只看附带的大纲这一块（剧情进度里本来就有下一段的提要，那是另一个参考）
  const ref = user.slice(user.indexOf('【参考·当前大纲】')).split(/\n【(?!其他剧情线)/)[0];
  for (const m of ['M1正文标记', 'M2正文标记']) assert.ok(!ref.includes(m), `${m} attached in full`);
  assert.match(user, /M1 街区：街区出事/);
  assert.match(doc.querySelector('.pi-body').textContent, /当前大纲（\d+字，完整附带S01 仓库，其余2条附简介）/);
  await inst.destroy();
});

test('single-line / old project: 大纲 stays a plain toggle and sends the whole outline', async () => {
  const old = [{ id: 'v1', key: '剧情_卷1_开场', stages: [{ id: 's1', key: '阶段1_a', data: { AI指令: '老项目正文' } }] }];
  const { host, inst, doc, click, pid } = await setup(old);
  await click('[data-act="tab"][data-tab="discuss"]');
  doc.querySelector('[data-act="refs-toggle"]') && (await click('[data-act="refs-toggle"]'));
  await click('[data-act="ref-outline"]');
  assert.equal(doc.querySelector('.pi-dialog'), null, 'no picker');
  assert.equal(inst.data.chat(pid).refs.outline, true, 'toggled on');
  assert.equal(doc.querySelector('[data-act="ref-outline"]').textContent.trim(), '大纲');
  doc.querySelector('[data-compose]').value = '问一下';
  host.llm.reply = '好的';
  await click('[data-act="send"]'); await tick();
  assert.match(JSON.stringify(host.llmCalls.at(-1).args), /老项目正文/);
  await inst.destroy();
});

test('discussion page: a long multi-line outline is not cut down to stage titles; the chosen line stays in full', async () => {
  // the chosen line itself is over 12k: it is what the author asked for, so it stays in full (the old cut only applies to single-line projects)
  const long = volumes().map((v) => (v.id !== 'vM1' ? v : { ...v, stages: v.stages.map((s) => ({ ...s, data: { ...s.data, 世界动态: [{ 类型: '背景', 来源: 'x', 内容: '长'.repeat(13000) }] } })) }));
  const { host, inst, doc, click, pid } = await setup(long);
  const chat = inst.data.chat(pid) || (await inst.data.loadChat(pid));
  await inst.data.saveChat(pid, { ...chat, refs: { ...chat.refs, outline: true, lines: ['vM1'] } });
  await click('[data-act="tab"][data-tab="discuss"]');
  doc.querySelector('[data-compose]').value = '问一下';
  host.llm.reply = '好的';
  await click('[data-act="send"]'); await tick();
  const body = JSON.stringify(host.llmCalls.at(-1).args);
  assert.match(body, /M1正文标记/, 'M1 in full even though the whole outline is over 12k');
  await inst.destroy();
});
