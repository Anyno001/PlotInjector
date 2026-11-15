// GPT 内测前返修复审（f8c2e19）的反例：每条按复审里描述的复现构造。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const C = loadCore();
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const R = loadCore();

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
// 在「修改补定」对话框里选分块、写要求、提交。
async function rewrite(doc, block, text) {
  const dlg = doc.querySelector('.pi-dialog');
  assert.ok(dlg, 'fix dialog open');
  dlg.querySelector('[data-f=block]').value = block;
  dlg.querySelector('[data-f=text]').value = text;
  [...dlg.querySelectorAll('[data-dlg]')].pop().click();
  await tick(100);
}
const lore = async (host) => (await host.worldInfo()).map((e) => e.content).join('\n');

// ---------- P1 重写「仅作者资料」块，模型漏掉标签 ----------
test('P1: rewriting the 仅作者资料 block keeps it private even when the model drops the tags; a public block still rewrites', async () => {
  const { host, inst, doc, click, openSetting, a } = await bootUi();
  inst.data.updateProject(a, (x) => ({ ...x, setting: { ...x.setting, text: SETTING, fixes: ['医生的身份'] } }));
  await openSetting(a);
  host.llm.reply = '世界观正文：\n幕后真相：\n账本的真正持有人一直都是渡船上的医生，他每晚都在船上。\n补定：\n速查：PASS';
  await click('[data-act="fix-edit"]');
  await rewrite(doc, '仅作者资料', '补一句，仍然保密');
  assert.match((await inst.data.loadProject(a)).setting.text, /每晚都在船上/, 'rewrite saved');
  assert.ok(!(await lore(host)).includes('医生'));
  // a public block still rewrites normally
  inst.data.updateProject(a, (x) => ({ ...x, setting: { ...x.setting, fixes: ['港口的雾'] } }));
  inst.__view.renderBody(); await tick();
  host.llm.reply = '世界观正文：\n港口：\n雾很浓，入夜后看不清对岸。\n补定：\n速查：PASS';
  await click('[data-act="fix-edit"]');
  await rewrite(doc, '港口', '写得具体些');
  const after = await lore(host);
  assert.match(after, /看不清对岸/);
  assert.ok(!after.includes('医生'));
  await inst.destroy();
});

// ---------- P1 读讨论文件期间切项目 ----------
test('P1: switching project while 从讨论整理 is still reading the discussion drops the result instead of writing it into B', async () => {
  const { host, inst, doc, a, b } = await bootUi();
  inst.data.updateProject(b, (x) => ({ ...x, setting: { ...x.setting, text: 'B 的设定：\n只属于 B。' } }));
  await talk(inst, a, 'A 的讨论');
  await inst.data.flush?.();
  await tick(1500);
  await inst.destroy();
  // reload: A's discussion is not cached yet; its file is read slowly (only after the panel is up)
  const origFetch = host.w.fetch;
  let slowed = 0, slow = false;
  host.w.fetch = async (u, init) => { if (slow && String(u).startsWith('/user/files/pi-c-')) { slowed++; await tick(250); } return origFetch(u, init); };
  const inst2 = host.load(); await inst2.ready;
  inst2.data.updateSettings({ tourState: { revision: 2, done: ['core'] } });
  await inst2.runtime.switchProject(a);
  inst2.open(); await tick();
  host.llm.reply = '世界观正文：\nA 的设定：\n只属于 A。\n补定：\n速查：PASS';
  const go = async (sel) => { doc.querySelector(sel).click(); await tick(); };
  await go(`[data-act="project"][data-id="${a}"]`);
  await go('[data-act="tab"][data-tab="setting"]');
  slow = true;
  doc.querySelector('[data-act="from-talk"]').click();
  await go(`[data-act="project"][data-id="${b}"]`);
  await go('[data-act="tab"][data-tab="setting"]');
  await tick(500);
  assert.ok(slowed >= 1, 'the discussion file was read slowly');
  assert.equal(doc.querySelector('[data-act="draft-all"]'), null, 'no draft in B');
  assert.equal((await inst2.data.loadProject(b)).setting.text, 'B 的设定：\n只属于 B。');
  host.w.fetch = origFetch;
  await inst2.destroy();
});

// ---------- P2 作者块与相邻文字 ----------
test('P2: public text after a closing tag stays public; <仅作者>幕后真相： starts an author block', () => {
  const blocks = R.splitBlocks('港口：\n雾浓。\n<仅作者>\n医生\n</仅作者>\n每日六点，渡船对所有人开放');
  assert.deepEqual(blocks.map((b) => b.title), ['港口', '仅作者资料', '港口·续']);
  const left = R.joinBlocks(blocks.filter((b) => !b.author));
  assert.match(left, /每日六点/, 'deleting the author block keeps the public line');
  assert.ok(!R.stripAuthorBlocks(left).includes('医生'));
  const b2 = R.splitBlocks('港口：\n雾浓。\n<仅作者>幕后真相：\n医生\n</仅作者>');
  assert.deepEqual(b2.map((b) => b.title), ['港口', '仅作者资料']);
  assert.ok(b2[1].author);
  // a heading right after the closing tag still starts a normal block
  assert.deepEqual(R.splitBlocks('<仅作者>\n医生\n</仅作者>\n街道：\n窄。').map((b) => b.title), ['仅作者资料', '街道']);
});

test('P2 (UI): deleting 仅作者资料 keeps the public line after it', async () => {
  const { host, inst, doc, openSetting, a } = await bootUi();
  inst.data.updateProject(a, (x) => ({ ...x, setting: { ...x.setting, text: `${SETTING}\n每日六点，渡船对所有人开放` } }));
  await openSetting(a);
  [...doc.querySelectorAll('[data-act="block-del"]')].find((x) => x.dataset.key === '仅作者资料').click(); await tick();
  [...doc.querySelector('.pi-dialog').querySelectorAll('[data-dlg]')].pop().click(); await tick();
  const text = (await inst.data.loadProject(a)).setting.text;
  assert.match(text, /每日六点/);
  assert.doesNotMatch(text, /医生/);
  await inst.destroy();
});

test('P2 (UI): rewriting a public draft block that returns a new author block keeps the old author block ticked', async () => {
  const { host, inst, doc, click, openSetting, a } = await bootUi();
  host.llm.reply = '世界观正文：\n港口：\n雾浓。\n<仅作者>\n旧秘密：船长知道\n</仅作者>\n补定：\n- 港口的细节\n速查：PASS';
  await talk(inst, a, '讨论');
  await openSetting(a);
  await click('[data-act="from-talk"]', 80);
  host.llm.reply = '世界观正文：\n港口：\n雾很浓。\n<仅作者>幕后真相：\n新秘密：医生\n</仅作者>\n补定：\n速查：PASS';
  await click('[data-act="fix-edit"][data-where="draft"]');
  await rewrite(doc, '港口', '更具体');
  const boxes = [...doc.querySelectorAll('[data-pick-block]')];
  assert.equal(boxes.length, 3, boxes.map((x) => x.dataset.pickBlock).join());
  assert.ok(boxes.every((x) => x.checked), 'all blocks still ticked');
  await click('[data-act="draft-pick"]');
  const text = (await inst.data.loadProject(a)).setting.text;
  assert.match(text, /旧秘密/);
  assert.match(text, /新秘密/);
  assert.ok(!R.stripAuthorBlocks(text).includes('秘密'));
  await inst.destroy();
});

// ---------- P2 后台请求按标记认 ----------
test('P2: a background request is recognised by its own mark even after macro expansion; a story request sharing the guide text is still audited', async () => {
  const { host, inst, click, openSetting, a } = await bootUi();
  inst.data.updateProject(a, (x) => ({ ...x, setting: { ...x.setting, text: `{{user}}来到港口。\n${SETTING}` } }));
  await talk(inst, a, '港口');
  let during;
  host.llm.respond = async (body) => {
    const args = JSON.parse(body);
    // the host expands macros before emitting prompt-ready
    const exp = (s) => String(s).replace(/\{\{user\}\}/g, '旅人');
    await host.promptReady([{ role: 'system', content: exp(args.systemPrompt) }, { role: 'user', content: exp(args.prompt) }]);
    during = inst.runtime.diagnose().lastOutlineAudit;
    // a story request at the same time, sharing the guide text and carrying the secret
    await host.promptReady([{ content: `${String(args.systemPrompt).slice(0, 300)}\n某条目：${SECRET}` }]);
    return `世界观正文：\n${SETTING}\n补定：\n速查：PASS`;
  };
  await openSetting(a);
  await click('[data-act="from-talk"]', 150);
  assert.equal(during, null, 'the background request itself is skipped');
  const last = inst.runtime.diagnose().lastOutlineAudit;
  assert.ok(last && last.leaks.length, 'the parallel story request is audited');
  host.llm.respond = null;
  await inst.destroy();
});

// ---------- P2 设定包含在阶段条目里，换序 ----------
test('P2: setting text contained in the stage entry, sent in either order, is not a leak; an extra copy still is', () => {
  const common = '雾港的码头每晚十点准时熄灯封港';
  const vols = [{ id: 'v', key: '剧情_卷一', stages: [
    { id: 'o1', key: '阶段一_报案', data: { 主线节点: [{ id: 'm1', 名称: '接受委托', 事件: `${common}，东家私下托主角调查丢失的货物` }] } },
    { id: 'o2', key: '阶段二_真相', data: { 主线节点: [{ id: 'm2', 名称: '揭穿', 事件: common }] } },
  ] }];
  const project = { setting: { text: common }, outline: { volumes: vols } };
  const states = { o1: 'active', o2: 'next' };
  const entries = [common, `<剧情参考>${common}，东家私下托主角调查丢失的货物</剧情参考>`];
  for (const order of [[0, 1], [1, 0]]) {
    const r = C.auditOutlineRequest(order.map((i) => entries[i]).join('\n'), project, states, entries);
    assert.deepEqual([...r.leaks], [], `order ${order}`);
  }
  const r = C.auditOutlineRequest(`${entries[1]}\n${entries[0]}\n外部：${common}`, project, states, entries);
  assert.ok(r.leaks.some((l) => /揭穿/.test(l.source)), 'an extra copy is still caught');
});
