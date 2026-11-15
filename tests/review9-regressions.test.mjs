// GPT 内测前最终审阅（0cee864）的反例：每条按审阅里描述的复现构造。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const C = loadCore();
const DEFAULT = JSON.parse(fs.readFileSync(path.join(here, 'fixtures/shujuku-default-template-spv8.9.2.json'), 'utf8'));
const byName = (t, name) => Object.values(t).find((s) => s && s.name === name);
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const S = loadCore();
const vol = (stages) => [{ id: 'v', key: '剧情_卷一', stages: stages.map((data, i) => ({ id: `s${i}`, key: `阶段${i + 1}_x`, data })) }];
const N = (id, gives, extra = {}) => ({ id, 名称: id, 入口: `去${id}`, 发现: gives.map((f) => ({ 事实: f, 内容: `${f}内容` })), 完成条件: gives.length ? { 事实: gives[0] } : undefined, ...extra });

const SECRET = '账本的真正持有人一直都是渡船上的医生。';
const SETTING = ['港口：', '雾浓。', '<仅作者>', '幕后真相：', SECRET, '</仅作者>'].join('\n');

async function bootUi() {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  inst.data.updateSettings({ tourState: { revision: 2, done: ['core'] } });
  const a = await inst.data.createProject('A');
  const b = await inst.data.createProject('B');
  await inst.runtime.switchProject(a.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  const click = async (sel, ms) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(ms); };
  const openSetting = async (id) => { await click(`[data-act="project"][data-id="${id}"]`); await click('[data-act="tab"][data-tab="setting"]'); };
  return { host, inst, doc, click, openSetting, a: a.id, b: b.id };
}
async function talk(inst, id, content) {
  const chat = await inst.data.loadChat(id);
  inst.data.saveChat(id, { ...chat, messages: [...chat.messages, { role: 'user', content }] });
}
async function confirmTopDialog(doc) {
  const box = doc.querySelector('.pi-dialog');
  assert.ok(box, 'a confirm dialog is open');
  [...box.querySelectorAll('[data-dlg]')].pop().click();
  await tick();
}

// ---------- 1 设定分块不拆开 <仅作者> ----------
test('1: a heading inside <仅作者> does not split the author block; the whole block is one unit', () => {
  const blocks = S.splitBlocks(SETTING);
  assert.deepEqual(blocks.map((b) => b.title), ['港口', '仅作者资料']);
  assert.equal(S.stripAuthorBlocks(blocks[0].text), '港口：\n雾浓。');
  // deleting the public block leaves the author block paired → nothing public leaks
  const left = S.joinBlocks(blocks.filter((b) => b.title !== '港口'));
  assert.ok(!S.stripAuthorBlocks(left).includes('医生'), left);
  // an author block opened mid-block stays with its block, with both tags
  const mid = S.splitBlocks('港口：\n雾浓。<仅作者>\n幕后真相：\n医生\n</仅作者>\n街道：\n窄。');
  assert.deepEqual(mid.map((b) => b.title), ['港口', '街道']);
  assert.match(mid[0].text, /<仅作者>[\s\S]*<\/仅作者>/);
  // merging only some blocks from a draft keeps the author block paired
  const merged = S.mergeBlocks('港口：\n旧的。', SETTING, ['仅作者资料']);
  assert.ok(!S.stripAuthorBlocks(merged).includes('医生'), merged);
  // an unclosed opening tag swallows the rest (same rule as stripping)
  assert.deepEqual(S.splitBlocks('港口：\n雾。\n<仅作者>\n真相：\n医生').map((b) => b.title), ['港口', '仅作者资料']);
});

test('1 (UI): adopt all, delete the 港口 block, the injected setting entry still has no secret', async () => {
  const { host, inst, doc, click, openSetting, a } = await bootUi();
  host.llm.reply = `世界观正文：\n${SETTING}\n补定：\n速查：PASS`;
  await talk(inst, a, '雾港的设定');
  await openSetting(a);
  await click('[data-act="from-talk"]', 80);
  await click('[data-act="draft-all"]');
  let lore = await host.worldInfo();
  assert.ok(!lore.map((e) => e.content).join('\n').includes('医生'), 'secret not injected after adopting');
  const del = [...doc.querySelectorAll('[data-act="block-del"]')].find((b) => b.dataset.key === '港口');
  assert.ok(del, 'delete button for 港口');
  del.click(); await tick();
  await confirmTopDialog(doc);
  assert.ok(!inst.runtime.entries().some((e) => /港口/.test(e.content)), '港口 deleted');
  lore = await host.worldInfo();
  assert.ok(!lore.map((e) => e.content).join('\n').includes('医生'), lore.map((e) => e.content).join('\n'));
  await inst.destroy();
});

// ---------- 2 设定草稿按项目 ----------
test('2: project A\'s setting draft is not shown in, nor adoptable into, project B; it is still there back in A', async () => {
  const { host, inst, doc, click, openSetting, a, b } = await bootUi();
  inst.data.updateProject(b, (x) => ({ ...x, setting: { ...x.setting, text: 'B 的设定：\n只属于 B。' } }));
  host.llm.reply = '世界观正文：\nA 的设定：\n只属于 A。\n补定：\n速查：PASS';
  await talk(inst, a, 'A 的讨论');
  await openSetting(a);
  await click('[data-act="from-talk"]', 80);
  assert.ok(doc.querySelector('[data-act="draft-all"]'), 'A has a draft');
  await openSetting(b);
  assert.equal(doc.querySelector('[data-act="draft-all"]'), null, 'B does not see A\'s draft');
  assert.equal((await inst.data.loadProject(b)).setting.text, 'B 的设定：\n只属于 B。');
  await openSetting(a);
  assert.ok(doc.querySelector('[data-act="draft-all"]'), 'A\'s draft is still waiting');
  await inst.destroy();
});

// ---------- 3 「采用勾选的分块」的勾选能取消 ----------
test('3: unticking a draft block really unticks it; 采用勾选的分块 adopts only the other one', async () => {
  const { host, inst, doc, click, openSetting, a } = await bootUi();
  host.llm.reply = '世界观正文：\n港口：\n雾浓。\n\n街道：\n很窄。\n补定：\n速查：PASS';
  await talk(inst, a, '讨论');
  await openSetting(a);
  await click('[data-act="from-talk"]', 80);
  const box = doc.querySelector('[data-pick-block="港口"]');
  assert.ok(box.checked);
  box.click(); await tick();
  assert.equal(doc.querySelector('[data-pick-block="港口"]').checked, false, 'checkbox unticked');
  await click('[data-act="draft-pick"]');
  const text = (await inst.data.loadProject(a)).setting.text;
  assert.match(text, /街道/);
  assert.doesNotMatch(text, /港口/);
  // clicking the title still opens the diff
  await click('[data-act="from-talk"]', 80);
  await click('[data-act="draft-block"] .pi-etitle');
  assert.ok(doc.querySelector('.pi-entry-bd'), 'title click opens the block');
  await inst.destroy();
});

// ---------- 4 插件自己的后台请求不当正文核验 ----------
test('4: the plugin\'s own background request through the tavern connection is not audited; a story request still is', async () => {
  const { host, inst, click, openSetting, a } = await bootUi();
  inst.data.updateProject(a, (x) => ({ ...x, setting: { ...x.setting, text: SETTING } }));
  await talk(inst, a, '讨论');
  // the host's generateRaw emits prompt-ready with the plugin's own prompt (which carries the author material)
  host.llm.respond = async (body) => {
    const args = JSON.parse(body);
    await host.promptReady([{ role: 'system', content: args.systemPrompt }, { role: 'user', content: args.prompt }]);
    return `世界观正文：\n${SETTING}\n补定：\n速查：PASS`;
  };
  await openSetting(a);
  await click('[data-act="from-talk"]', 120);
  assert.ok(host.llmCalls.length >= 1);
  assert.equal(inst.runtime.diagnose().lastOutlineAudit, null, 'background request not audited');
  // a story request carrying the secret is still flagged
  host.llm.respond = null;
  await host.promptReady([{ content: `某条目：${SECRET}` }]);
  assert.ok(inst.runtime.diagnose().lastOutlineAudit.leaks.length, 'story request audited');
  await inst.destroy();
});

// ---------- 5 投影逐条扣除 ----------
const OUT_VOLS = [{ id: 'v', key: '剧情_卷一', stages: [
  { id: 'o1', key: '阶段一_报案', data: { 主线节点: [{ id: 'm1', 名称: '接受委托', 事件: '码头货栈的东家私下托主角调查一批丢失的货物' }] } },
  { id: 'o2', key: '阶段二_真相', data: { 主线节点: [{ id: 'm2', 名称: '揭穿', 事件: '雾港的码头每晚十点准时熄灯封港' }] } },
] }];
test('5: injected entries separated by a character definition are still subtracted one by one; an extra copy is still caught', () => {
  const setting = '雾港的码头每晚十点准时熄灯封港。';
  const project = { setting: { text: setting }, outline: { volumes: OUT_VOLS } };
  const states = { o1: 'active', o2: 'next' };
  const entries = [setting, '<剧情参考>码头货栈的东家私下托主角调查一批丢失的货物</剧情参考>'];
  let r = C.auditOutlineRequest(`${entries[0]}\n角色定义：老韩是个夜班看守。\n${entries[1]}`, project, states, entries);
  assert.deepEqual([...r.leaks], [], JSON.stringify(r.leaks));
  r = C.auditOutlineRequest(`${entries[1]}\n角色定义\n${entries[0]}`, project, states, entries);
  assert.deepEqual([...r.leaks], [], 'reordered');
  assert.equal(r.projectionCount, 1);
  r = C.auditOutlineRequest(`${entries[0]}\n角色定义\n${entries[1]}\n外部条目：雾港的码头每晚十点准时熄灯封港`, project, states, entries);
  assert.ok(r.leaks.some((l) => /揭穿/.test(l.source)), 'a second copy from another entry is still checked');
});

// ---------- 6 只写一行字符串的节点 ----------
test('6: a later-stage node written as one sentence is checked by its name; a short title is not', () => {
  const vols = [{ id: 'v', key: '剧情_卷一', stages: [
    { id: 'o1', key: '阶段一_x', data: { 主线节点: ['到码头'] } },
    { id: 'o2', key: '阶段二_y', data: { 主线节点: [{ 名称: '封存船具时船长才会交出被扣下的真账本', id: 'n2' }, { 名称: '去码头问话', id: 'n3' }] } },
  ] }];
  const project = { setting: { text: '' }, outline: { volumes: vols } };
  let r = C.auditOutlineRequest('外部条目：封存船具时船长才会交出被扣下的真账本', project, { o1: 'active', o2: 'next' }, []);
  assert.ok(r.leaks.some((l) => /阶段二/.test(l.source)), JSON.stringify(r.leaks));
  r = C.auditOutlineRequest('用户：我们去码头问话吧，顺便看看船', project, { o1: 'active', o2: 'next' }, []);
  assert.deepEqual([...r.leaks], [], 'short titles are not fingerprinted');
});

// ---------- 7 替代路线：开放条件写成节点条件 ----------
test('7: a common successor opened by {任一:[{节点:A},{节点:B}]} gives two routes A→C and B→C, both ok', () => {
  const vols = vol([
    { 结束条件: { 事实: 'FC' }, 主线节点: [
      N('nA', ['FA'], { 必需: false }), N('nB', ['FB'], { 必需: false }),
      N('nC', ['FC'], { 必需: false, 开放条件: { 任一: [{ 节点: 'nA' }, { 节点: 'nB' }] } }),
    ] },
    { 主线节点: [N('nD', ['FD'])] },
  ]);
  const r = C.clueAlternativeRoutes(vols);
  assert.deepEqual(r.map((x) => [x.node, x.verdict]), [['nA → nC', 'ok'], ['nB → nC', 'ok']], JSON.stringify(r));
});

// ---------- 8 人工确认的事实（还没有表格行）也算起点 ----------
test('8: a fact confirmed by hand before the table has its row counts as known; a revoked one does not', () => {
  const sets = C.chatFactSets({ snap: { facts: new Map() }, prog: { factOverrides: { FA: { status: 'confirmed', text: '人工' }, FR: { status: 'revoked' } } } });
  assert.deepEqual([...sets.known], ['FA']);
  assert.deepEqual([...sets.claimed], []);
  const later = vol([{ 进入条件: { 核实: 'FA' }, 主线节点: [N('n2', ['F2'])] }]);
  assert.equal(C.clueReachability(later, { knownFacts: sets.known }).verdict, 'ok');
});

// ---------- 9 表级 PRIMARY KEY ("name") ----------
test('9: a table-level PRIMARY KEY ("name") is detected; the DDL is left alone and still valid', () => {
  for (const pk of ['PRIMARY KEY ("name")', 'PRIMARY KEY( "name" )', 'primary key (name)']) {
    const t = JSON.parse(JSON.stringify(DEFAULT));
    const ch = byName(t, '重要角色表');
    const lines = ch.sourceData.ddl.replace('row_id INTEGER PRIMARY KEY', 'row_id INTEGER').split('\n');
    const last = lines.length - 2;
    lines[last] = `${lines[last].replace(/(\s*--.*)?$/, ',$1')}`;
    lines.splice(last + 1, 0, `  ${pk}`);
    ch.sourceData.ddl = lines.join('\n');
    new DatabaseSync(':memory:').exec(ch.sourceData.ddl);
    const r = C.synthesizeClueTemplate(t, {});
    new DatabaseSync(':memory:').exec(byName(r.template, '重要角色表').sourceData.ddl);
    assert.match(r.problems.join('\n'), /表级约束.*没有加列/, pk);
  }
  // the default template's column-level `row_id INTEGER PRIMARY KEY` still gets the columns
  const ok = JSON.parse(JSON.stringify(DEFAULT));
  assert.match(byName(ok, '重要角色表').sourceData.ddl, /row_id INTEGER PRIMARY KEY,/);
  assert.ok(byName(C.synthesizeClueTemplate(ok, {}).template, '重要角色表').content[0].includes('剧情身份'));
});

// ---------- 10 教程与上层弹窗的按键 ----------
test('10: with a plugin dialog above the tour, arrows and Esc belong to the dialog; Enter on the tour × closes, not advances', async () => {
  const host = createHost({ tables: {} });
  host.w.HTMLElement.prototype.getBoundingClientRect = function () { return this.isConnected ? { left: 10, top: 10, right: 110, bottom: 40, width: 100, height: 30, x: 10, y: 10 } : { left: 0, top: 0, right: 0, bottom: 0, width: 0, height: 0 }; };
  host.w.HTMLElement.prototype.scrollIntoView = function () {};
  const inst = host.load(); await inst.ready;
  inst.open();
  const doc = host.w.document, pop = () => doc.querySelector('.pi-tour .pi-tour-pop');
  for (let i = 0; i < 20 && !pop(); i++) await tick(60);
  const count = () => pop().querySelector('.pi-tour-count').textContent;
  const key = (target, k) => target.dispatchEvent(new host.w.KeyboardEvent('keydown', { key: k, bubbles: true }));
  assert.match(count(), /^1 \//);
  // a dialog opens above the tour (new project) with an input focused
  doc.querySelector('[data-act="new-project"]').click(); await tick();
  const dlg = doc.querySelector('.pi-dialog');
  assert.ok(dlg, 'dialog open');
  const input = dlg.querySelector('input');
  key(input || doc, 'ArrowRight'); await tick();
  assert.match(count(), /^1 \//, 'the tour did not advance');
  key(input || doc, 'Escape'); await tick();
  assert.equal(doc.querySelector('.pi-dialog'), null, 'dialog closed');
  assert.ok(pop(), 'tour still open');
  // Enter on × closes the tour
  const x = pop().querySelector('[data-tour=close]');
  x.focus();
  key(x, 'Enter'); await tick();
  assert.match(count(), /^1 \//, 'Enter on × does not advance');
  await inst.destroy();
});
