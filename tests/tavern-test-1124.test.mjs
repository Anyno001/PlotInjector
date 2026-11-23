// v0.3.14 本地酒馆实测（2026-11-23）发现的问题，测完一起改（开发/实测样稿/实测记录/实测问题_v0.3.14_2026-11-23.md）
import test from 'node:test';
import assert from 'node:assert/strict';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { loadCore } from './load.mjs';
import { BINDING_YAML } from '../templates/clue-tables/build-template.mjs';

const C = loadCore();
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const same = (a, b, m) => assert.equal(JSON.stringify(a), JSON.stringify(b), m);
const node = (id, facts, extra = {}) => ({ id, 名称: id, 入口: `去${id}`, 地点: id, 发现: facts.map((f) => ({ 事实: f, 内容: `${f}的内容`, 记录: `看到${f}时登记` })), 完成条件: { 事实: facts[0] }, ...extra });
const vol = (id, kind, nodes, line = {}) => ({ id: `v${id}`, key: `剧情_${id}_x`, line: { 编号: id, 类型: kind, ...line }, stages: [{ id: `s${id}`, key: '阶段1_x', data: { 主线节点: nodes } }] });
const FACT_HEAD = [null, '编号', '标签', '登记口径', '状态', '内容', '依据'];
const KNOW_HEAD = [null, '键', '事实', '角色', '获知方式', '可信度', '依据'];
const fill = (keys) => ({ TavernDB_ACU_IsolatedData: { '': { storageFrame: { version: 2, logEntries: [{ seq: 1, source: 'auto_fill', filledSheetKeys: keys }] } } } });

// 和 fold-collapse 一样：M1 结束（F1、F2 已核实），M2 读 F2，只有 F1 能收
async function foldSetup() {
  const vols = [vol('M1', '主线', [node('a', ['F1', 'F2'])]), vol('M2', '主线', [node('b', ['F9'])], { 开启方式: '人工', 开启条件: { 事实: 'F2' } })];
  const tables = {
    sheet_ctrl: { name: '线索控制表', content: [[null, '标识', '当前场景', '场景目录'], [1, '主线', 'a', '']] },
    sheet_f: { name: '关键事实表', content: [FACT_HEAD, [1, 'F1', '账本', '读到账本时登记', '已核实', '账本上的名字', '第1楼'], [2, 'F2', '', '', '已核实', '', '']] },
    sheet_k: { name: '知情表', content: [KNOW_HEAD, [1, 'F1@user', 'F1', 'user', '亲见', '已核实', '第1楼'], [2, 'F2@user', 'F2', 'user', '亲见', '已核实', '']] },
  };
  const host = createHost({ tables });
  host.w.AutoCardUpdaterAPI.sqlite = true;
  host.ctx.extensionSettings = { __userscripts: { shujuku_v120__userscript_settings_v1: { shujuku_v120_globalMeta_v1: JSON.stringify({ activeIsolationCode: '' }) } } };
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('收起');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML), labels: { F1: { label: '账本', criterion: '读到账本时登记' } } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  host.state.chat.push({ is_user: true, mes: '一', send_date: 'a0' }, { is_user: false, mes: '回', send_date: 'a1', swipe_id: 0, ...fill(['sheet_f', 'sheet_k']) });
  inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines();
  host.state.chat.push({ is_user: true, mes: '二', send_date: 'a2' }, { is_user: false, mes: '回', send_date: 'a3', swipe_id: 0, ...fill(['sheet_f', 'sheet_k']) });
  inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines();
  const api = host.w.AutoCardUpdaterAPI;
  const codes = (sheet) => api.exportTableAsJson()[sheet].content.slice(1).map((r) => r[1]);
  return { host, inst, api, codes, pid: p.id };
}
async function openRun(host, inst, pid) {
  inst.open(); await tick();
  const doc = host.w.document;
  doc.querySelector(`[data-act="project"][data-id="${pid}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  return doc;
}

test('18: auto collapse waits until the tables have been quiet (group fills update once per group)', async () => {
  const { host, inst, codes } = await foldSetup();
  inst.runtime.clue.setFoldChat('on');
  inst.runtime.clue.foldQuiet.ms = 2500;
  try {
    host.db.setTables(host.w.AutoCardUpdaterAPI.exportTableAsJson()); // 一组填完：表格刚更新（同步要等 1.5 秒）
    await host.settle(); await tick(1800);
    same(codes('sheet_f').sort(), ['F1', 'F2'], 'the sync after the update does not collapse yet');
    await tick(2800);
    same(codes('sheet_f'), ['F2'], 'collapsed once quiet');
  } finally { inst.runtime.clue.foldQuiet.ms = 3e4; await inst.destroy(); }
});

test('1 / 15 / 17: no 本聊天不收起 switch; 「⋯」 says 放回表格 and restores without a dialog; a chat set to 不收 can switch back on', async () => {
  const { host, inst, codes, pid } = await foldSetup();
  await inst.runtime.clue.foldCollapse(['M1'], { manual: true });
  const doc = await openRun(host, inst, pid);
  const t = doc.querySelector('[data-act="run-set-toggle"][aria-expanded="false"]'); t && (t.click(), await tick());
  assert.ok(doc.querySelector('[data-clue-foldauto]'), 'project switch still there');
  assert.equal(doc.querySelector('[data-clue-foldchat]'), null, 'chat switch removed');
  doc.querySelector('[data-act="clue-line-tab"][data-tab="end"]').click(); await tick();
  const btn = doc.querySelector('[data-act="clue-fold"][data-value="restore"]');
  assert.equal(btn.textContent, '放回表格');
  assert.ok(![...doc.querySelectorAll('.pi-line-menu .pi-btn')].some((b) => b.textContent === '还原'), 'no 还原 label');
  btn.click(); await tick(); await tick();
  assert.equal(doc.querySelector('.pi-dialog'), null, 'no confirm dialog');
  same(codes('sheet_f').sort(), ['F1', 'F2'], 'rows back');
  inst.runtime.clue.setFoldChat('off'); inst.runtime.clue.invalidate(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  doc.querySelector('[data-act="clue-line-tab"][data-tab="end"]').click(); await tick();
  assert.match(doc.querySelector('[data-line-grp="end"]').textContent, /本聊天不收起。/);
  assert.ok(doc.querySelector('[data-line-grp="end"] [data-act="clue-fold-chat"]'), 'an 开启 button to switch back');
  await inst.destroy();
});

// 只有开场白：模板初始行要等第一次填表才成正式行
async function seedSetup({ stateCol = '状态' } = {}) {
  const vols = [vol('M1', '主线', [node('a', ['F1']), node('b', ['F2'], { 开放条件: { 事实: 'F1' } })])];
  const tables = {
    sheet_ctrl: { name: '线索控制表', content: [[null, '标识', '当前场景', '场景目录']], seedRows: [[null, '主线', '', '']] },
    sheet_f: { name: '关键事实表', content: [FACT_HEAD], seedRows: [[null, 'F1', '账本', '读到账本时登记', '未获得', '', ''], [null, 'F2', '印章', '看到印章时登记', '未获得', '', '']] },
    sheet_k: { name: '知情表', content: [KNOW_HEAD] },
  };
  const host = createHost({ tables });
  host.w.AutoCardUpdaterAPI.sqlite = true;
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('初始行');
  const b = YAML.parse(BINDING_YAML); b.facts[0].状态列 = stateCol;
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: b, labels: { F1: { label: '账本', criterion: '读到账本时登记' }, F2: { label: '印章', criterion: '看到印章时登记' } } } }));
  await inst.runtime.switchProject(p.id);
  host.state.chat.push({ is_user: false, mes: '开场白', send_date: 'g' });
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.runtime.clue.invalidate();
  return { host, inst, pid: p.id };
}

test('9: greeting only — codes present in pending template rows are not reported as missing rows', async () => {
  const { inst } = await seedSetup();
  const c = inst.runtime.clue.compute();
  assert.ok(c.snap.seedPending.has('F1'), JSON.stringify([...c.snap.seedPending]));
  assert.ok(!c.snap.problems.some((p) => /事实表里没有这些编号的行/.test(p)), c.snap.problems.join(' | '));
  await inst.destroy();
});

test('11: when the fact table binding is broken, no extra missing-row report', async () => {
  const { inst, pid } = await foldSetup();
  inst.data.updateProject(pid, (x) => { const b = JSON.parse(JSON.stringify(x.clue.bindings)); b.facts[0].状态列 = '状态X'; return { ...x, clue: { ...x.clue, bindings: b } }; });
  inst.runtime.clue.invalidate();
  const p = inst.runtime.clue.compute().snap.problems;
  assert.ok(p.some((x) => /缺少状态列「状态X」/.test(x)), p.join(' | '));
  assert.ok(!p.some((x) => /事实表里没有这些编号的行/.test(x)), p.join(' | '));
  await inst.destroy();
});

test('10: 两表核对 skips clues the player added, confirmed or kept by hand', () => {
  const snap = { facts: new Map([['F1', { id: 'F1', status: 'confirmed', raw: '已核实' }]]), knowledge: [], knowPresent: new Set(['F1@user']) };
  assert.equal(C.tableConsistencyHints(snap).length, 1, 'filled by the fill model without knowledge: still reported');
  for (const status of ['kept', 'confirmed', 'claimed']) assert.equal(C.tableConsistencyHints(snap, { F1: { status } }).length, 0, status);
  assert.equal(C.tableConsistencyHints(snap, { F1: { status: 'revoked' } }).length, 1, 'a voided clue is not a manual confirmation');
});

test('12: line names in notices have no 「·」', () => {
  assert.equal(C.lineShowName({ id: 'S01', name: 'S01·茶馆的旧照片' }), 'S01 茶馆的旧照片');
  assert.equal(C.lineShowName({ id: 'M1', name: '卷1·雾港旧案' }), 'M1 雾港旧案');
  assert.equal(C.lineShowName({ id: '', name: '卷1·雾港旧案' }), '卷1 雾港旧案');
});

test('5: the project label changed but the chat table still has the old one → a 需要处理 row that opens 修改线索', async () => {
  const a = await foldSetup();
  const doc0 = await openRun(a.host, a.inst, a.pid);
  assert.ok(!/口径改了/.test(doc0.querySelector('.pi-body').textContent), 'same as the table: no row');
  await a.inst.destroy();
  const s = await foldSetup();
  const proj = s.inst.data.project(s.pid);
  const sig = C.factLabelSig(C.factLabelContext(proj.outline.volumes, ['F1'])[0]);
  s.inst.data.updateProject(s.pid, (x) => ({ ...x, clue: { ...x.clue, labels: { ...x.clue.labels, F1: { label: '账本', criterion: '亲手翻开账本、读到名字时登记', sig } } } }));
  const doc = await openRun(s.host, s.inst, s.pid);
  const row = [...doc.querySelectorAll('.pi-row.is-todo')].find((r) => /口径改了/.test(r.textContent));
  assert.ok(row, doc.querySelector('.pi-body').textContent.slice(0, 300));
  assert.match(row.textContent, /有1条线索的口径改了，当前聊天的表格还是旧的。/);
  assert.ok(row.querySelector('[data-act="clue-labels-edit"]'));
  await s.inst.destroy();
});

test('20: a clue with no recorded content is named by its label, not its code (no author answer filled in)', async () => {
  const vols = [vol('M1', '主线', [node('a', ['F1', 'F2'], { 完成条件: { 事实: 'F9' } })])];
  const tables = {
    sheet_ctrl: { name: '线索控制表', content: [[null, '标识', '当前场景', '场景目录'], [1, '主线', 'a', '']] },
    sheet_f: { name: '关键事实表', content: [FACT_HEAD, [1, 'F1', '账本', '读到账本时登记', '已核实', '', '第1楼'], [2, 'F2', '', '', '存疑', '', '第1楼'], [3, 'F9', '', '', '未获得', '', '']] },
    sheet_k: { name: '知情表', content: [KNOW_HEAD] },
  };
  const host = createHost({ tables });
  host.w.AutoCardUpdaterAPI.sqlite = true;
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('标签');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML), labels: {} } }));
  await inst.runtime.switchProject(p.id);
  host.state.chat.push({ is_user: true, mes: '一', send_date: 'a0' }, { is_user: false, mes: '回', send_date: 'a1', swipe_id: 0, ...fill(['sheet_f', 'sheet_k']) });
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines();
  host.state.chat.push({ is_user: true, mes: '看看', send_date: 'a2' });
  const text = (await host.generate()).map((e) => e.content).join('\n');
  assert.match(text, /「账本」 已经确认，但表格没有记录具体内容/, text.slice(0, 600));
  assert.ok(!/F1 已经/.test(text), 'the code is not shown when a label exists');
  assert.match(text, /F2 已经有人说出/, 'no label: falls back to the code');
  assert.ok(!/F1的内容|F2的内容/.test(text), 'the outline answer is not filled in');
  await inst.destroy();
});

// GPT 实测修复审阅 R2：绑定缺列时，执行页自己算的「大纲里有N条线索在表格里还没有行」也不出现；绑定正常、真缺行时照样提示
test('R2: broken fact binding → no missing-row rows on the run page; a real missing row still shows', async () => {
  const { host, inst, pid } = await foldSetup();
  const vols = inst.data.project(pid).outline.volumes;
  const labels = Object.fromEntries(C.factLabelContext(vols, ['F1', 'F2', 'F9']).map((x) => [x.code, { label: `标签${x.code}`, criterion: `${x.code}口径`, sig: C.factLabelSig(x) }]));
  inst.data.updateProject(pid, (x) => ({ ...x, clue: { ...x.clue, labels } }));
  const t = JSON.parse(JSON.stringify(host.w.AutoCardUpdaterAPI.exportTableAsJson()));
  t.sheet_f.content = t.sheet_f.content.filter((r, i) => i === 0 || r[1] !== 'F2');
  host.db.setTables(t); await host.settle();
  inst.runtime.clue.invalidate();
  const doc = await openRun(host, inst, pid);
  assert.match(doc.querySelector('.pi-body').textContent, /在表格里还没有行|还没有这些线索的行/, 'binding ok, F2 row really missing');
  inst.data.updateProject(pid, (x) => { const b = JSON.parse(JSON.stringify(x.clue.bindings)); b.facts[0].状态列 = '状态X'; return { ...x, clue: { ...x.clue, bindings: b } }; });
  inst.runtime.clue.invalidate();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  const body = doc.querySelector('.pi-body').textContent;
  assert.match(body, /缺少状态列「状态X」/);
  assert.ok(!/在表格里还没有行|还没有这些线索的行/.test(body), body.slice(0, 400));
  await inst.destroy();
});

// GPT 实测修复审阅 R1：只有一条剧情线时，也能开启自动收起、把「不收」改回来、打开收起记录
test('R1: a single-line project shows the fold notes, the 开启 entry and 收起记录 under its line', async () => {
  const vols = [vol('M1', '主线', [node('a', ['F1', 'F2'])])];
  const tables = {
    sheet_ctrl: { name: '线索控制表', content: [[null, '标识', '当前场景', '场景目录'], [1, '主线', 'a', '']] },
    sheet_f: { name: '关键事实表', content: [FACT_HEAD, [1, 'F1', '账本', '读到账本时登记', '已核实', '账本上的名字', '第1楼'], [2, 'F2', '', '', '已核实', '', '']] },
    sheet_k: { name: '知情表', content: [KNOW_HEAD, [1, 'F1@user', 'F1', 'user', '亲见', '已核实', '第1楼']] },
  };
  const host = createHost({ tables });
  host.w.AutoCardUpdaterAPI.sqlite = true;
  host.ctx.extensionSettings = { __userscripts: { shujuku_v120__userscript_settings_v1: { shujuku_v120_globalMeta_v1: JSON.stringify({ activeIsolationCode: '' }) } } };
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('单线');
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: vols }, clue: { mode: 'clue', bindings: YAML.parse(BINDING_YAML), labels: {} } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  host.state.chat.push({ is_user: true, mes: '一', send_date: 'a0' }, { is_user: false, mes: '回', send_date: 'a1', swipe_id: 0, ...fill(['sheet_f', 'sheet_k']) });
  inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines();
  host.state.chat.push({ is_user: true, mes: '二', send_date: 'a2' }, { is_user: false, mes: '回', send_date: 'a3', swipe_id: 0, ...fill(['sheet_f', 'sheet_k']) });
  inst.runtime.clue.invalidate(); await inst.runtime.clue.syncLines();
  assert.equal(inst.runtime.clue.compute().state.lineStates.length, 1);
  const doc = await openRun(host, inst, p.id);
  const card = () => doc.querySelector('.pi-line-card');
  assert.match(card().textContent, /本聊天尚未开启自动收起/);
  card().querySelector('[data-act="clue-fold-chat"]').click(); await tick();
  [...doc.querySelectorAll('.pi-dialog .pi-btn')].find((b) => b.textContent === '收起').click(); await tick();
  assert.equal(inst.runtime.clue.foldChat(), 'on', 'actually switched on');
  inst.runtime.clue.setFoldChat('off'); inst.runtime.clue.invalidate();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  assert.match(card().textContent, /本聊天不收起。/);
  assert.ok(card().querySelector('[data-act="clue-fold-chat"]'));
  await inst.runtime.clue.foldCollapse(['M1'], { manual: true });
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  assert.ok(card().querySelector('[data-act="clue-fold-log"]'), '收起记录 reachable');
  await inst.destroy();
});

// 时间条件只比钟点（跑团 v0.3.17 的修法搬到线索模式）：表格时间带年月日时，年份不再被当成小时
test('time conditions compare the clock only, even when the table time has a date', () => {
  const t = { sheet_g: { name: '全局数据表', content: [[null, '标识', '当前时间'], [1, '全局', '2026年10月31日 17:30']] } };
  const env = { facts: new Map(), knowledge: [], tables: t, nodeDone: () => false, timePath: '全局数据表/全局/当前时间' };
  const ev = (v) => C.evalCondition(C.parseCondition(v), env).v;
  assert.equal(ev('时间 >= 17:00'), 'true');
  assert.equal(ev('时间 >= 19:30'), 'false', 'used to be true: 2026 was read as the hour');
  assert.equal(ev('时间 < 18:00'), 'true');
  t.sheet_g.content[1][2] = '傍晚7点半';
  assert.equal(ev('时间 >= 19:30'), 'true', 'clock words like 傍晚7点半');
  t.sheet_g.content[1][2] = '第二天';
  assert.equal(ev('时间 >= 19:30'), 'unknown', 'no clock in the cell');
  assert.equal(C.clockOf('2026年10月31日 17:30'), 1050);
});
