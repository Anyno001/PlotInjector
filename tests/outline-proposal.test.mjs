// 讨论里的大纲改动提案（GPT §19.2）：首版只做插入和同阶段排序。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';

const C = loadCore();
const tick = () => new Promise((r) => setTimeout(r, 20));
const VOLS = () => [{ id: 'v1', key: '剧情_卷一_公寓', stages: [
  { id: 's1', key: '阶段一_楼里', data: { 时间范围: '第一周', 主线节点: [{ id: 'nLamp', 名称: '修灯', 事件: '换灯泡' }, { id: 'nTrash', 名称: '倒垃圾', 事件: '下楼' }], 支线事件: [{ id: 'nCat', 名称: '喂猫' }] } },
  { id: 's2', key: '阶段二_街上', data: { 主线节点: [{ id: 'nShop', 名称: '去店里' }] } },
] }];
const fence = (yaml) => ['好的，可以把收租放在修灯之前。', '```大纲改动', yaml, '```'].join('\n');
const INSERT = fence(['改动:', '  - 动作: 插入', '    阶段: s1', '    类别: 主线', '    位置: {之前: nLamp}', '    节点: {名称: 房东收租, 事件: 房东上门, id: ai-made-id}', '    理由: 先交租再修灯更顺'].join('\n'));

test('parse + apply: insert before an anchor by id; AI-written id is ignored; new id assigned by the plugin', () => {
  const p = C.parseOutlineProposal(INSERT);
  assert.equal(p.items.length, 1);
  const r = C.applyOutlineProposal(VOLS(), p.items, { idOf: () => 'nNew' });
  assert.ok(r.ok, r.errors.join());
  const list = r.volumes[0].stages[0].data.主线节点;
  assert.deepEqual(list.map((n) => n.名称), ['房东收租', '修灯', '倒垃圾']);
  assert.equal(list[0].id, 'nNew');
  assert.match(r.changes[0].text, /在阶段一 楼里·主线「nLamp」之前插入「房东收租」/);
});

test('reorder within a stage must list exactly the current nodes; cross-stage move is refused', () => {
  const ok = C.applyOutlineProposal(VOLS(), C.parseOutlineProposal(fence('改动:\n  - 动作: 排序\n    阶段: s1\n    类别: 主线\n    顺序: [nTrash, nLamp]')).items);
  assert.ok(ok.ok); assert.deepEqual(ok.volumes[0].stages[0].data.主线节点.map((n) => n.id), ['nTrash', 'nLamp']);
  const move = C.applyOutlineProposal(VOLS(), C.parseOutlineProposal(fence('改动:\n  - 动作: 排序\n    阶段: s1\n    类别: 主线\n    顺序: [nTrash, nLamp, nShop]')).items);
  assert.equal(move.ok, false); assert.match(move.errors.join(), /跨阶段移动这一版不支持/);
  const drop = C.applyOutlineProposal(VOLS(), C.parseOutlineProposal(fence('改动:\n  - 动作: 排序\n    阶段: s1\n    类别: 主线\n    顺序: [nTrash]')).items);
  assert.equal(drop.ok, false); assert.match(drop.errors.join(), /缺 nLamp/);
});

test('unsupported actions and bad targets are reported per item; one failure writes nothing', () => {
  const p = C.parseOutlineProposal(fence('改动:\n  - 动作: 删除\n    阶段: s1\n    类别: 主线\n  - 动作: 插入\n    阶段: s1\n    类别: 主线\n    位置: {之后: nGhost}\n    节点: {名称: 新}\n  - 动作: 插入\n    阶段: s9\n    类别: 主线\n    节点: {名称: 新}'));
  assert.match(p.items[0].error, /这一版还不支持/);
  const r = C.applyOutlineProposal(VOLS(), p.items);
  assert.equal(r.ok, false);
  assert.match(r.errors.join(), /找不到节点「nGhost」/);
  assert.match(r.errors.join(), /找不到阶段「s9」/);
  assert.deepEqual(r.volumes, VOLS(), 'nothing changed');
});

test('outline map lists stage and node ids with public names only (no <仅作者>)', () => {
  const v = VOLS(); v[0].stages[0].data.主线节点[0].事件 = '换灯泡<仅作者>其实是房东弄坏的</仅作者>';
  const map = C.outlineMapText(v, { focusStageId: 's1' });
  assert.match(map, /阶段 s1「阶段一 楼里」/);
  assert.match(map, /主线：nLamp「修灯」、nTrash「倒垃圾」/);
  assert.ok(!map.includes('房东弄坏'));
});

// ---------- UI: discussion → 审阅并应用 → outline updated, other chats' progress intact ----------
async function boot() {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('公寓');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: VOLS() } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.open(); await tick();
  const doc = host.w.document;
  const click = async (sel) => { const el = doc.querySelector(sel); assert.ok(el, `missing ${sel}`); el.click(); await tick(); };
  await click(`[data-act="project"][data-id="${p.id}"]`);
  return { host, inst, doc, click, pid: p.id };
}

test('UI: 改大纲 adds the outline map to the request; the reply gets 审阅并应用; applying inserts with a plugin id and keeps progress', async () => {
  const { host, inst, doc, click, pid } = await boot();
  // chat A already played 修灯
  inst.runtime.setProgress({ ...inst.runtime.progress(), current: 's1', slots: { s1: { off: ['@nLamp'] } } });
  await click('[data-act="tab"][data-tab="discuss"]');
  await click('[data-act="edit-mode"]');
  host.llm.reply = INSERT;
  doc.querySelector('[data-compose]').value = '在修灯前面加一个房东收租';
  await click('[data-act="send"]'); await tick(); await tick();
  const req = host.llmCalls.map((c) => c.body).join('\n');
  assert.match(req, /【大纲地图】/); assert.match(req, /nLamp/);
  await click('[data-act="proposal-apply"]');
  const dlg = doc.querySelector('.pi-dialog');
  assert.match(dlg.textContent, /在阶段一 楼里·主线「nLamp」之前插入「房东收租」/);
  [...dlg.querySelectorAll('.pi-btn')].find((b) => b.textContent === '应用勾选的改动').click(); await tick();
  const list = inst.data.project(pid).outline.volumes[0].stages[0].data.主线节点;
  assert.deepEqual([...list.map((n) => n.名称)], ['房东收租', '修灯', '倒垃圾']);
  assert.ok(list[0].id && list[0].id !== 'ai-made-id');
  const progress=inst.runtime.progress();
  assert.deepEqual(C.stageNodes(inst.data.project(pid).outline.volumes[0].stages[0].data).filter(n=>progress.slots.s1.off.includes(n.id)).map(n=>n.item.id), ['nLamp'], '修灯 still the one marked');
  await inst.destroy();
});

test('clue mode, partial pick: taking only the item that depends on the other is flagged by the reachability check', async () => {
  const vols = [{ id: 'v1', key: '剧情_卷一_案', stages: [{ id: 's1', key: '阶段一_查', data: { 主线节点: [{ id: 'n0', 名称: '起点', 入口: 'e', 发现: [{ 事实: 'F0', 内容: 'c' }], 完成条件: { 事实: 'F0' } }] } }] }];
  const text = fence([
    '改动:',
    '  - 动作: 插入', '    阶段: s1', '    类别: 主线', '    位置: 末尾',
    '    节点: {名称: 证人, 入口: 找证人, 发现: [{事实: F_wit, 内容: 证词}], 完成条件: {事实: F_wit}}',
    '  - 动作: 插入', '    阶段: s1', '    类别: 主线', '    位置: 末尾',
    '    节点: {名称: 对质, 入口: 去对质, 开放条件: {事实: F_wit}, 发现: [{事实: F_end, 内容: 认罪}], 完成条件: {事实: F_end}}',
  ].join('\n'));
  const items = C.parseOutlineProposal(text).items;
  const both = C.applyOutlineProposal(vols, items, { isClue: true });
  assert.ok(both.ok);
  assert.deepEqual(C.checkClueDraft([], [], { applied: both.volumes }).filter((x) => /走不通/.test(x)), []);
  const onlySecond = C.applyOutlineProposal(vols, items, { picked: [1], isClue: true });
  assert.ok(onlySecond.ok, 'structurally applies');
  assert.match(C.checkClueDraft([], [], { applied: onlySecond.volumes }).join('\n'), /走不通/);
});
