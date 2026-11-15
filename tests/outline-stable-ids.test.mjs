// GPT §18 — outline mode keeps each chat's "已演" marks on the same events after insert / move / rename / delete.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';

const C = loadCore();
const tick = () => new Promise((r) => setTimeout(r, 20));
const stage = (nodes) => ({ id: 's1', key: '阶段一_楼里', data: { 时间范围: '第一周', 主线节点: nodes } });
const PROJECT = (nodes, extra = {}) => ({
  version: 1, id: 'pA', name: '公寓', createdAt: 1,
  setting: { text: '设定', history: [], check: '', fixes: [] },
  outline: { volumes: [{ id: 'v1', key: '剧情_卷一_公寓', stages: [stage(nodes)] }] },
  defaults: {}, ...extra,
});
const INDEX = { version: 1, projects: [{ id: 'pA', name: '公寓', group: '', updatedAt: 2, bytes: {} }], active: { 'char:card.png': 'pA' }, settings: {}, files: ['pi-p-pA.json'] };

async function boot(project, chats) {
  const host = createHost({ tables: {} });
  host.files.set('pi-index.json', JSON.stringify(INDEX));
  host.files.set('pi-p-pA.json', JSON.stringify(project));
  for (const [id, meta] of Object.entries(chats)) host.state.chatMetaById = { ...(host.state.chatMetaById || {}), [id]: meta };
  const inst = host.load();
  await inst.ready;
  await inst.data.loadProject('pA');
  return { host, inst };
}
// progress for one chat, keyed like the plugin stores it in chat metadata
const meta = (off) => ({ plotInjector: { projectId: 'pA', byProject: { pA: { projectId: 'pA', current: 's1', slots: { s1: { off } }, muted: [], offMuted: [], lastCheckFloor: 0 } } } });
async function openChat(host, inst, id) {
  host.state.chatId = id;
  host.state.chatMetadata = host.state.chatMetaById[id];
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await tick();
}
const offOf = (inst) => inst.runtime.progress().slots.s1.off;
const doneNames = (inst) => {
  const p = inst.data.project('pA'), off = new Set(offOf(inst));
  return C.stageNodes(p.outline.volumes[0].stages[0].data).filter((n) => off.has(n.id)).map((n) => n.name);
};
const editNodes = (inst, fn) => inst.data.updateProject('pA', (x) => {
  const vols = JSON.parse(JSON.stringify(x.outline.volumes));
  vols[0].stages[0].data.主线节点 = fn(vols[0].stages[0].data.主线节点);
  return { ...x, outline: { ...x.outline, volumes: vols } };
});

test('§18 acceptance: insert before, move and rename — A keeps only the renamed event done, B keeps none', async () => {
  // old save: nodes without ids, chat A marked m0 (修灯) done in v0.1.13 format, chat B nothing
  const { host, inst } = await boot(PROJECT([{ 名称: '修灯', 事件: '换楼道灯泡' }, { 名称: '倒垃圾', 事件: '把垃圾拿下楼' }]), { A: meta(['m0']), B: meta([]) });
  await openChat(host, inst, 'A');
  assert.deepEqual([...doneNames(inst)], ['修灯'], 'old m0 mapped to 修灯');
  // edit the shared outline: insert 房东收租 before, then move 修灯 to the end and rename it
  editNodes(inst, (list) => [{ 名称: '房东收租', 事件: '房东上门' }, ...list]);
  editNodes(inst, (list) => { const lamp = list.find((n) => n.名称 === '修灯'); return [...list.filter((n) => n !== lamp), { ...lamp, 名称: '修楼道灯' }]; });
  inst.runtime.refresh?.();
  await openChat(host, inst, 'B'); await openChat(host, inst, 'A');
  assert.deepEqual([...doneNames(inst)], ['修楼道灯']);
  await openChat(host, inst, 'B');
  assert.deepEqual([...doneNames(inst)], []);
  await inst.destroy();
});

test('§18: deleting a node does not pass its mark to the neighbour', async () => {
  const { host, inst } = await boot(PROJECT([{ 名称: '甲' }, { 名称: '乙' }, { 名称: '丙' }]), { A: meta(['m1']) });
  await openChat(host, inst, 'A');
  assert.deepEqual([...doneNames(inst)], ['乙']);
  editNodes(inst, (list) => list.filter((n) => n.名称 !== '乙'));
  await openChat(host, inst, 'A');
  assert.deepEqual([...doneNames(inst)], [], 'neither 甲 nor 丙 inherits');
  await inst.destroy();
});

test('§18: a chat opened only after the outline was edited still maps by the original order', async () => {
  const { host, inst } = await boot(PROJECT([{ 名称: '修灯' }, { 名称: '倒垃圾' }]), { A: meta([]), B: meta(['m1']) });
  await openChat(host, inst, 'A'); // ids assigned now (map recorded in the original order)
  editNodes(inst, (list) => [{ 名称: '房东收租' }, ...list]);
  await openChat(host, inst, 'B'); // B's old "m1" = 倒垃圾 (original order), NOT 修灯 (current index 1)
  assert.deepEqual([...doneNames(inst)], ['倒垃圾']);
  await inst.destroy();
});

test('§18: legacy marks with no recorded order are dropped, not guessed by name', async () => {
  // project already has ids but no outlineIdMap (history lost); the chat still has an old positional mark
  const { host, inst } = await boot(PROJECT([{ 名称: '修灯', id: 'nX' }, { 名称: '倒垃圾', id: 'nY' }]), { A: meta(['m0']) });
  await openChat(host, inst, 'A');
  assert.deepEqual([...doneNames(inst)], []);
  assert.equal(inst.runtime.progress().droppedLegacy, 1);
  await inst.destroy();
});

test('§18: string nodes get ids but inject exactly as before; ids never reach the injected text', async () => {
  const { host, inst } = await boot(PROJECT(['修灯', '倒垃圾']), { A: meta(['m0']) });
  await openChat(host, inst, 'A');
  const saved = inst.data.project('pA').outline.volumes[0].stages[0].data.主线节点;
  assert.ok(saved.every((n) => typeof n === 'object' && n.id), 'ids assigned to string nodes');
  assert.deepEqual([...saved.map((n) => n.名称)], ['修灯', '倒垃圾']);
  assert.deepEqual([...doneNames(inst)], ['修灯']);
  const text = inst.runtime.entries().map((e) => e.content).join('\n');
  assert.match(text, /- 倒垃圾/, 'still a plain string in the injected YAML');
  assert.ok(!/修灯/.test(text.split('</')[0].split('主线节点')[1] || ''), '已演 node filtered out');
  assert.ok(!/\bid:|\bn[a-z0-9]{8,}/.test(text), 'no ids in the injected text');
  await inst.destroy();
});

test('§18 core: ensureOutlineIds is idempotent and records the map only once', () => {
  let n = 0; const idOf = () => `id${++n}`;
  const vols = [{ id: 'v', key: '卷', stages: [stage([{ 名称: '甲' }, '乙'])] }];
  const a = C.ensureOutlineIds(vols, undefined, idOf);
  assert.deepEqual(JSON.parse(JSON.stringify(a.legacyMap)), { s1: { m0: 'id1', m1: 'id2' } });
  const b = C.ensureOutlineIds(a.volumes, a.legacyMap, idOf);
  assert.equal(b.changed, false);
  // a node added later gets an id, but the map of that stage is not rewritten
  const later = JSON.parse(JSON.stringify(a.volumes)); later[0].stages[0].data.主线节点.unshift({ 名称: '新' });
  const c = C.ensureOutlineIds(later, a.legacyMap, idOf);
  assert.deepEqual(JSON.parse(JSON.stringify(c.legacyMap)), { s1: { m0: 'id1', m1: 'id2' } });
  assert.equal(c.volumes[0].stages[0].data.主线节点[0].id, 'id3');
});

test('§19.1: the outline-mode progress check request never contains <仅作者> text', async () => {
  const SECRET = '哨兵_幕后是房东本人';
  const { host, inst } = await boot(PROJECT([{ 名称: '修灯', 事件: `换楼道灯泡<仅作者>${SECRET}</仅作者>` }, { 名称: '收租', 作者备注: `<仅作者>${SECRET}二</仅作者>` }]), { A: meta([]) });
  await openChat(host, inst, 'A');
  host.state.chat.push({ is_user: false, mes: '他换好了灯泡。', send_date: '1', swipe_id: 0 });
  await inst.runtime.checkNow({ manual: true });
  const req = host.llmCalls.map((c) => c.body).join('\n');
  assert.ok(req.includes('换楼道灯泡'), 'public text still sent');
  assert.ok(!req.includes(SECRET), 'author-only text not in the check request');
  await inst.destroy();
});

test('§19.1: two nodes with the same name in a stage → the check result does not mark both', async () => {
  const { host, inst } = await boot(PROJECT([{ 名称: '夜访' }, { 名称: '夜访' }, { 名称: '修灯' }]), { A: meta([]) });
  await openChat(host, inst, 'A');
  host.state.chat.push({ is_user: false, mes: '夜里有人敲门，他也修好了灯。', send_date: '1', swipe_id: 0 });
  host.llm.reply = '{"done":["夜访","修灯"],"stageDone":false,"offTrack":false,"reason":"x"}';
  await inst.runtime.checkNow({ manual: true });
  assert.deepEqual([...doneNames(inst)], ['修灯'], 'ambiguous name skipped, unique one marked');
  await inst.destroy();
});
