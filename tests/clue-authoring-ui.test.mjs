// UI wiring for GPT 6.2/6.3, driven through the real panel in jsdom:
// "AI 写第 N 卷" in clue mode sends clue rules + checked discussion refs + clue progress, and the draft shows the
// material scope and the structure check; outline mode keeps the original prompt. Run page "改写后续" in clue mode
// uses the clue rewrite prompt from the clue current stage, and replacing does not touch outline-mode progress.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { buildTemplate, BINDING_YAML } from '../templates/clue-tables/build-template.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const storyText = fs.readFileSync(path.join(here, '../templates/clue-tables/示例_小镇失窃案.yaml'), 'utf8');
const tick = () => new Promise((r) => setTimeout(r, 20));

function liveTables(t) {
  const out = JSON.parse(JSON.stringify(t));
  for (const [k, s] of Object.entries(out)) if (k.startsWith('sheet_')) s.content = s.content.map((row, i) => (i === 0 ? row : [i, ...row.slice(1)]));
  return out;
}

async function setup(mode) {
  const tables = liveTables(buildTemplate({
    controlRow: ['主线', ''],
    factRows: [{ code: 'F_box', label: 'a' }, { code: 'F_ledger', label: 'b' }, { code: 'F_seen', label: 'c' }, { code: 'F_print', label: 'e' }, { code: 'F_talk', label: 'd' }],
    knowRows: [{ fact: 'F_seen', actor: 'user' }, { fact: 'F_ledger', actor: 'user' }],
  }));
  const host = createHost({ tables });
  // a bound chat worldbook with one entry the user checked in the discussion tab
  host.state.chatMetadata.world_info = '测试书';
  host.ctx.loadWorldInfo = async (name) => (name === '测试书' ? { entries: { 0: { uid: 0, comment: '人物·周老人', content: '裁缝铺的周老人耳背但记性好。', key: ['周老人'] } } } : null);
  const inst = host.load();
  await inst.ready;
  const p = await inst.data.createProject('小镇');
  const volumes = Object.entries(YAML.parse(storyText)).map(([key, stages], vi) => ({ id: `v${vi}`, key, stages: Object.entries(stages).map(([sk, data], si) => ({ id: `s${vi}_${si}`, key: sk, data })) }));
  inst.data.updateProject(p.id, (x) => ({ ...x, setting: { ...x.setting, text: '小镇设定' }, outline: { volumes }, clue: { mode, bindings: YAML.parse(BINDING_YAML) } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  const chat = await inst.data.loadChat(p.id);
  await inst.data.saveChat(p.id, { ...chat, messages: [{ id: 'm1', role: 'user', content: '想让第二卷围绕修车铺展开', at: 1 }], refs: { ...chat.refs, wb: { fields: {}, picks: { '测试书|k:0': true } } } });
  await host.settle();
  inst.open();
  await tick();
  const doc = host.w.document;
  const click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  // select the project and go to the outline tab
  await click(`[data-act="project"][data-id="${p.id}"]`);
  return { host, inst, tables, doc, click, pid: p.id };
}
const lastPrompt = (host) => { const a = host.llmCalls.at(-1).args; return [{ content: a.systemPrompt }, { content: a.prompt }]; };

const DRAFT = '```yaml\n剧情_卷二_修车铺:\n  阶段一_追查:\n    AI指令: 慢慢来\n    主线节点:\n      - id: n_garage\n        名称: 修车铺\n        入口: 去修车铺转转\n        发现: [{事实: F_tool, 内容: 扳手上有漆, 记录: 实际看到时记}]\n        完成条件: {事实: F_ghost}\n```';

test('clue mode: AI volume prompt carries clue rules, checked worldbook ref, clue progress; draft shows scope + check', async () => {
  const { host, inst, doc, click } = await setup('clue');
  await click('[data-act="tab"][data-tab="outline"]');
  host.llm.reply = DRAFT;
  await click('[data-act="ai-volume"]');
  await click('.pi-dialog .is-primary'); await tick();
  const [sys, user] = lastPrompt(host);
  assert.match(sys.content, /线索推进模式的剧情大纲/);
  assert.match(user.content, /【参考·人物·周老人】\n裁缝铺的周老人耳背但记性好。/);
  assert.match(user.content, /【线索进度（作者视角/);
  assert.match(user.content, /n_report「接受报案」/);
  assert.match(user.content, /想让第二卷围绕修车铺展开/);
  assert.equal((user.content.match(/小镇设定/g) || []).length, 1, 'setting not duplicated through refs');
  const body = doc.querySelector('.pi-body').textContent;
  assert.match(body, /本次附带的材料：讨论记录（\d+ 字）、人物·周老人（\d+ 字）、线索进度（当前聊天）/);
  assert.match(body, /线索结构检查（\d+）/);
  assert.match(body, /没有任何节点产出的事实：F_ghost/);
  await inst.destroy();
});

test('outline mode: AI volume keeps the original prompt; refs are now passed through too', async () => {
  const { host, inst, click } = await setup('outline');
  await click('[data-act="tab"][data-tab="outline"]');
  host.llm.reply = '```yaml\n剧情_卷二_x:\n  阶段一_a:\n    时间范围: t\n    主线节点:\n      - {名称: a, 事件: b}\n```';
  await click('[data-act="ai-volume"]');
  await click('.pi-dialog .is-primary'); await tick();
  const [sys, user] = lastPrompt(host);
  assert.match(sys.content, /每个阶段 2 到 4 个主线节点/);
  assert.ok(!sys.content.includes('拿到什么才能往下走'), 'no clue rules (format sample still comes from the first existing stage, as before)');
  assert.match(user.content, /【参考·人物·周老人】/);
  assert.ok(!user.content.includes('线索进度'));
  await inst.destroy();
});

test('clue mode: run page 改写后续 uses the clue rewrite prompt from the clue current stage', async () => {
  const { host, inst, tables, doc, click } = await setup('clue');
  // stage 1 done → current stage is 阶段二
  const s = Object.values(tables).find((x) => x && x.name === '关键事实表');
  s.content.find((r, i) => i > 0 && r[1] === 'F_box')[s.content[0].indexOf('状态')] = '已核实';
  host.db.setTables(tables); host.db.commit(0);
  await click('[data-act="tab"][data-tab="run"]');
  host.llm.reply = '```yaml\n剧情_卷一_小镇失窃案:\n  阶段二_调查:\n    主线节点:\n      - {id: n_ledger, 名称: 查账本, 入口: 翻账本, 发现: [{事实: F_ledger, 内容: c}], 完成条件: {事实: F_ledger}}\n```';
  // the rewrite asks for a reason through a prompt dialog → answer it
  doc.querySelector('[data-act="rewrite"]').click();
  await tick();
  const dlgInput = doc.querySelector('.pi-dialog textarea, .pi-dialog input');
  assert.ok(dlgInput, 'reason dialog');
  dlgInput.value = '玩家先去了裁缝铺';
  doc.querySelector('.pi-dialog [data-value="ok"], .pi-dialog .is-primary').click();
  await tick(); await tick();
  const [sys, user] = lastPrompt(host);
  assert.match(sys.content, /已完成节点、已确认事实是已经发生的历史/);
  assert.match(user.content, /【需要改写的剩余阶段】\n剧情_卷一_小镇失窃案:\n  阶段二_调查/);
  assert.ok(!user.content.includes('阶段一_报案:'), 'stage 1 is history, not rewritten');
  assert.match(user.content, /玩家先去了裁缝铺/);
  assert.match(doc.querySelector('.pi-body').textContent, /删掉了已完成的节点|线索结构检查/);
  await inst.destroy();
});

// GPT 6.4 minimal guard: worldbook import asks per non-outline entry whether it is public setting or author-only.
test('worldbook import: entries default to author-only (wrapped, not injected); public ones are injected', async () => {
  const { host, inst, doc, click, pid } = await setup('outline');
  host.ctx.loadWorldInfo = async () => ({ entries: {
    0: { uid: 0, comment: '公开·小镇概况', content: '小镇有一条主街。', key: ['小镇'] },
    1: { uid: 1, comment: '作者·真相', content: '真正的小偷是阿伟，他欠了赌债。', key: ['真相'] },
  } });
  await click('[data-act="tab"][data-tab="outline"]');
  await click('[data-act="outline-menu"]'); await click('[data-dlg-value="import-wb"]');
  // picker: check both entries
  doc.querySelectorAll('.pi-dialog [data-pick]').forEach((el) => { el.checked = true; });
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick();
  // kind dialog: both default to author-only; switch the first to public
  const radios = doc.querySelectorAll('.pi-dialog [data-kind]');
  assert.equal(radios.length, 4);
  assert.ok([...radios].filter((r) => r.checked).every((r) => r.value === 'author'), 'default is author-only');
  doc.querySelector('.pi-dialog [data-kind="0"][value="public"]').checked = true;
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick();
  // original-entry dialog mentions author-only entries; keep them
  assert.match(doc.querySelector('.pi-dialog').textContent, /1 条导入为仅作者资料/);
  [...doc.querySelectorAll('.pi-dialog .pi-btn')].find((b) => b.textContent === '保留').click(); await tick();
  const text = inst.data.project(pid).setting.text;
  assert.match(text, /小镇有一条主街。/);
  assert.match(text, /<仅作者>\n真正的小偷是阿伟，他欠了赌债。\n<\/仅作者>/);
  const injected = inst.runtime.entries().map((e) => e.content).join('\n');
  assert.match(injected, /小镇有一条主街/);
  assert.ok(!injected.includes('真正的小偷'), 'author-only material is not injected');
  await inst.destroy();
});

test('worldbook import: cancelling the kind dialog imports nothing', async () => {
  const { host, inst, doc, click, pid } = await setup('outline');
  host.ctx.loadWorldInfo = async () => ({ entries: { 0: { uid: 0, comment: '作者·真相', content: '秘密', key: ['x'] } } });
  await click('[data-act="tab"][data-tab="outline"]');
  const before = inst.data.project(pid).setting.text;
  await click('[data-act="outline-menu"]'); await click('[data-dlg-value="import-wb"]');
  doc.querySelectorAll('.pi-dialog [data-pick]').forEach((el) => { el.checked = true; });
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick();
  [...doc.querySelectorAll('.pi-dialog .pi-btn')].find((b) => b.textContent === '取消').click(); await tick();
  assert.equal(inst.data.project(pid).setting.text, before);
  await inst.destroy();
});


// ---------- V6: what is ticked, what the draft lists, and what the request contains must agree ----------
async function setRefs(inst, pid, patch) {
  const chat = await inst.data.loadChat(pid);
  await inst.data.saveChat(pid, { ...chat, refs: { ...chat.refs, ...patch } });
}

test('V6 volume: ticking 当前大纲 sends its text (incl. an author note) and the list says so; unticking 剧情进度 sends no progress', async () => {
  const { host, inst, doc, click } = await setup('clue');
  const id = [...doc.querySelectorAll('[data-act="project"]')][0].dataset.id;
  await setRefs(inst, id, { outline: true, progress: false, floors: 0 });
  await click('[data-act="tab"][data-tab="outline"]');
  host.llm.reply = DRAFT;
  await click('[data-act="ai-volume"]');
  await click('.pi-dialog .is-primary'); await tick();
  const [, user] = lastPrompt(host);
  assert.match(user.content, /【参考·当前大纲】[\s\S]*钱箱的锁是从里面被撬开的/, 'outline body sent, not just titles');
  assert.ok(!user.content.includes('线索进度（作者视角'), 'progress unticked → not sent');
  assert.ok(!user.content.includes('【最近正文】'), '0 floors → no recent text');
  const body = doc.querySelector('.pi-body').textContent;
  assert.match(body, /当前大纲（\d+ 字）/);
  assert.ok(!/线索进度（当前聊天）/.test(body), 'list does not claim progress');
  assert.ok(!/最近 \d+ 楼正文/.test(body));
  await inst.destroy();
});

test('V6 rewrite: the discussion record listed is actually in the request; 0 floors sends no recent text', async () => {
  const { host, inst, doc, click, ...rest } = await setup('clue');
  const id = [...doc.querySelectorAll('[data-act="project"]')][0].dataset.id;
  await setRefs(inst, id, { floors: 0 });
  await host.addMessage('用户说了一句', true);
  await host.addMessage('正文：主角走进杂货店', false);
  await click('[data-act="tab"][data-tab="run"]');
  host.llm.reply = '```yaml\n剧情_卷一_小镇失窃案:\n  阶段一_报案:\n    主线节点:\n      - {id: n_report, 名称: a, 入口: e, 发现: [{事实: F_box, 内容: c}], 完成条件: {事实: F_box}}\n```';
  doc.querySelector('[data-act="rewrite"]').click(); await tick();
  doc.querySelector('.pi-dialog textarea, .pi-dialog input').value = 'x';
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick(); await tick();
  const [, user] = lastPrompt(host);
  assert.match(user.content, /【讨论摘要】[\s\S]*想让第二卷围绕修车铺展开/, 'discussion actually sent');
  assert.ok(!user.content.includes('【最近正文】'), '0 floors → none');
  const body = doc.querySelector('.pi-body').textContent;
  assert.match(body, /讨论记录（\d+ 字）/);
  assert.match(body, /最近正文：讨论区勾选的楼数为 0，没有附带/);
  // with floors ticked, recent text is sent and listed
  await setRefs(inst, id, { floors: 2 });
  doc.querySelector('[data-act="draft-drop"]').click(); await tick();
  await click('[data-act="tab"][data-tab="run"]');
  doc.querySelector('[data-act="rewrite"]').click(); await tick();
  doc.querySelector('.pi-dialog textarea, .pi-dialog input').value = 'x';
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick(); await tick();
  assert.match(lastPrompt(host)[1].content, /【最近正文】[\s\S]*主角走进杂货店/);
  assert.match(doc.querySelector('.pi-body').textContent, /最近 2 楼正文/);
  await inst.destroy();
});
