// 多线第 B 步第二批：表格条件适配。一格好几样只取一项、文字档位、AI 样例核对、缺行提示、读不出来不放宽、改成人工开启。
// 用例的写法来自手头真实卡模板（2026-11-14 子代理收集：默认模板人际关系、恋爱表、霍格沃茨卡、彼得帕克卡、PaddockDiary、COC）。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';

const C = loadCore();
const sheet = (name, head, rows, note = '', freq = -1) => ({ name, content: [['row_id', ...head], ...rows.map((r, i) => [String(i + 1), ...r])], sourceData: { note }, updateConfig: { updateFrequency: freq } });
const env = (tables) => ({ facts: new Map(), knowledge: [], tables, nodeDone: () => undefined });
const ev = (cond, tables) => {
  const errs = [], atom = C.parseCondition(cond, errs);
  return { errs, atom, r: C.evalCondition(atom, env(tables)) };
};

// ---------- 取值器：按条目认名字 ----------
test('pickEntry: real formats from card templates', () => {
  const ok = (text, key, want) => assert.deepEqual(C.pickEntry(text, key), { state: 'ok', value: want }, `${text} / ${key}`);
  ok('主角:认识;艾莉丝:室友兼闺蜜', '艾莉丝', '室友兼闺蜜');
  ok('主角:旧识,旧情人;艾莉丝:监护人;神田:旧部下', '主角', '旧识,旧情人');
  ok('爱丽丝:同学; 木下:未婚妻关系', '木下', '未婚妻关系');
  ok('健康=60；力量=78；敏捷=80', '力量', '78');
  ok('变形 入门｜飞行 尚可｜其余 入门', '飞行', '尚可');
  ok('力量+5,敏捷-3', '敏捷', '-3');
  ok('好感:-5', '好感', '-5');
  ok('侦查70;聆听60', '聆听', '60');
  ok('与彼得的关系：暧昧', '彼得', '暧昧');
  ok('彼得(好感 30)|玛丽(敌对)', '彼得', '好感 30');
  ok('<user>:邻居;梅:姨妈', '主角', '邻居');
});

test('pickEntry: wrong-but-common writings the default template forbids are still read the intended way', () => {
  // 「不同角色用了逗号」：逗号后面紧跟「名字:」才切
  assert.equal(C.pickEntry('主角:旧识,艾莉丝:室友', '艾莉丝').value, '室友');
  assert.equal(C.pickEntry('主角:旧识,艾莉丝:室友', '主角').value, '旧识');
  // 「同一角色的标签用了分号」：认不出名字的碎片接回前一项
  assert.equal(C.pickEntry('主角:曾帮其修过自行车;旧识', '主角').value, '曾帮其修过自行车,旧识');
});

test('pickEntry: never looks inside someone else\'s value; exact names only; ambiguity and free text are unknown', () => {
  const unk = (text, key, re) => {
    const r = C.pickEntry(text, key);
    assert.equal(r.state, 'unknown', `${text} / ${key}`);
    re && assert.match(r.reason, re);
  };
  unk('玛丽:听说彼得:很怪', '彼得', /还没有「彼得」/);
  unk('彼得·帕克:朋友;玛丽:同学', '彼得', /还没有/);
  unk('彼得:朋友;彼得:敌人', '彼得', /出现了2次/);
  unk('和爱丽丝关系不好', '爱丽丝', /不是按「名字:内容」分条写的/);
  // 括号里的分号不切
  assert.equal(C.pickEntry('事情（瞒着谁；谁知道）；另一件（a；b）', '事情').value, '瞒着谁；谁知道');
  // 同名同值出现两次不算分不清
  assert.equal(C.pickEntry('彼得:朋友;彼得:朋友', '彼得').value, '朋友');
});

// ---------- 档位 ----------
test('tiers: the cell may be the tier word, "number + tier", or "tier：detail"; longest match wins; unknown words are unknown', () => {
  assert.equal(C.tierIndex('2 熟悉', ['陌生', '相识', '熟悉']), 2);
  assert.equal(C.tierIndex('暧昧：银石雨夜共撑一把伞', ['无', '有好感', '暧昧']), 2);
  assert.equal(C.tierIndex('有好感', ['好感', '有好感']), 1);
  assert.equal(C.tierIndex('不熟悉', ['熟悉']), -1);
  assert.equal(C.tierIndex('熟悉的人', ['熟悉']), -1, 'a word that merely starts with a tier is not that tier');
});

test('tiers: the note must state the order — a list on one line that says it is ordered, or numbered tier lines; a bare "only these values" is an enumeration (GPT 代码审阅 R6)', () => {
  assert.equal(C.tierOrderInNote('- 列3: 好感度状态 - 只能填 敌视/陌生/友好/亲密/相恋 之一。', ['敌视', '陌生', '友好', '亲密', '相恋']), false, 'enumeration only: no order stated');
  assert.equal(C.tierOrderInNote('- 好感度状态 从低到高：敌视/陌生/友好/亲密/相恋', ['敌视', '陌生', '友好', '亲密', '相恋']), true);
  assert.equal(C.tierOrderInNote('关系：陌生 → 熟悉 → 信任', ['陌生', '熟悉', '信任']), true);
  assert.equal(C.tierOrderInNote('阶段定义：\n0 陌生：不认识\n1 相识：说过话\n2 熟悉：有过\n3 信任：…', ['陌生', '相识', '熟悉', '信任']), true);
  assert.equal(C.tierOrderInNote('按大类写六档等级（未入门/入门/尚可/熟练/精通/出众）', ['入门', '尚可', '熟练']), false, '"等级" alone does not say which way (R4)');
  assert.equal(C.tierOrderInNote('先熟悉，再陌生的情况也可能发生', ['熟悉', '陌生']), false, 'a sentence that happens to mention them in this order');
  assert.equal(C.tierOrderInNote('- 列3: 好感度状态 - 只能填 敌视/陌生/友好 之一。\n  · 敌视：冲突。\n  · 从低到高排列。\n- 列4: 别的 - 依次填写', ['敌视', '陌生', '友好']), true, 'the direction is stated in an indented sub-item of the same column');
  assert.equal(C.tierOrderInNote('- 列3: 好感度状态 - 只能填 敌视/陌生/友好 之一。\n  · 变化规则：只逐级、不跳级。', ['敌视', '陌生', '友好']), false, '逐级 says it is graded, not which way');
  assert.equal(C.tierOrderInNote('- 列3: 好感度状态 - 只能填 敌视/陌生/友好 之一。\n- 列4: 从低到高 - 数字', ['敌视', '陌生', '友好']), false, 'another column\'s line does not count');
  assert.equal(C.tierOrderInNote('可以填 熟悉、陌生', ['陌生', '熟悉']), false, 'order in the note is the other way');
  assert.equal(C.tierOrderInNote('', ['陌生', '熟悉']), false);
});

test('tiers (GPT 实测前审阅 R4): "等级 / 依次" alone do not say which way; high-to-low lists only count when the tiers are reversed', () => {
  const H = ['亲密', '友好', '陌生'], L = ['陌生', '友好', '亲密'];
  assert.equal(C.tierOrderInNote('关系等级：只能填 亲密/友好/陌生 之一。', H), false, 'enumeration with 等级: not a direction');
  assert.equal(C.tierOrderInNote('从高到低依次是：亲密、友好、陌生。', H), false, 'high to low, tiers copied in that order: would compare backwards');
  assert.equal(C.tierOrderInNote('从高到低依次是：亲密、友好、陌生。', L), true, 'high to low, tiers reversed to low-to-high: right');
  assert.equal(C.tierOrderInNote('从低到高：陌生、友好、亲密', L), true);
  assert.equal(C.tierOrderInNote('关系：陌生 < 友好 < 亲密', L), true);
  assert.equal(C.tierOrderInNote('0 陌生\n1 友好\n2 亲密', L), true, 'increasing numbers');
  assert.equal(C.tierOrderInNote('2 陌生\n1 友好\n0 亲密', L), false, 'decreasing numbers');
  // == and != never need the order
  const t = { sheet_r: sheet('重要角色表', ['姓名', '关系'], [['巴基', '友好']], '关系等级：只能填 亲密/友好/陌生 之一。') };
  assert.equal(ev({ 表: '重要角色表/巴基/关系 == 友好', 档位: L }, t).r.v, 'true');
  assert.equal(ev({ 表: '重要角色表/巴基/关系 >= 友好', 档位: H }, t).r.v, 'unknown', 'the GPT case: 陌生 >= 友好 must not become true');
});

test('tiers: an order the note does not state is not used to compare until the user confirms it; == still works (GPT 代码审阅 R6)', () => {
  const t = { sheet_r: sheet('重要角色表', ['姓名', '好感度状态'], [['巴基', '友好']], '只能填 敌视/陌生/友好/亲密/相恋 之一') }, T = ['敌视', '陌生', '友好', '亲密', '相恋'];
  const r = ev({ 表: '重要角色表/巴基/好感度状态 >= 陌生', 档位: T }, t).r;
  assert.equal(r.v, 'unknown');
  assert.match(r.reasons[0], /还没确认/);
  assert.equal(ev({ 表: '重要角色表/巴基/好感度状态 == 友好', 档位: T }, t).r.v, 'true', 'equality does not need the order');
  assert.equal(ev({ 表: '重要角色表/巴基/好感度状态 >= 陌生', 档位: T, 顺序: '已确认' }, t).r.v, 'true', 'confirmed');
  const rep = C.tableCondReport(draft({ 表: '重要角色表/巴基/好感度状态 >= 陌生', 档位: T }), t)[0];
  assert.deepEqual([...rep.tierPending], T);
  // confirmTierOrder marks every condition with the same tiers in the outline
  const vols = draft({ 表: '重要角色表/巴基/好感度状态 >= 陌生', 档位: T });
  const next = C.confirmTierOrder(vols, T);
  assert.notEqual(next, vols);
  assert.equal(JSON.stringify(next).includes('"顺序":"已确认"'), true);
  assert.equal(C.tableCondReport(next, t)[0].tierPending, undefined);
  assert.equal(C.confirmTierOrder(next, T), next, 'nothing left to confirm: same array');
  assert.equal(C.confirmTierOrder(vols, ['敌视', '友好']), vols, 'other tiers are not touched');
});

// ---------- 条件写法和求值 ----------
const ROLE = () => ({ sheet_r: sheet('重要角色表', ['姓名', '人际关系', '好感度状态', '对彼得阶段'], [['巴基', '主角:旧识;彼得:朋友,搭档', '友好', '2 熟悉'], ['山姆', '彼得:恋人;玛丽:同学', '陌生', '']], '- 好感度状态 从低到高 只能填 敌视/陌生/友好/亲密/相恋 之一\n0 陌生\n1 相识\n2 熟悉\n3 信任') });

test('condition {表, 取}: reads only that person\'s entry; a missing entry is unknown, never the whole cell', () => {
  const t = ROLE();
  assert.equal(ev({ 表: '重要角色表/巴基/人际关系 包含 朋友', 取: '彼得' }, t).r.v, 'true');
  assert.equal(ev({ 表: '重要角色表/巴基/人际关系 包含 恋人', 取: '彼得' }, t).r.v, 'false');
  // 山姆的格子里「恋人」是彼得的，巴基的格子里没有「沃克」：不能整格包含
  const r = ev({ 表: '重要角色表/巴基/人际关系 包含 旧识', 取: '沃克' }, t).r;
  assert.equal(r.v, 'unknown');
  assert.match(r.reasons[0], /还没有「沃克」这一项/);
});

test('condition {表, 档位}: compares by position; a value outside the tiers is unknown; bad tier lists are rejected', () => {
  const t = ROLE(), T = ['敌视', '陌生', '友好', '亲密', '相恋'];
  assert.equal(ev({ 表: '重要角色表/巴基/好感度状态 >= 友好', 档位: T }, t).r.v, 'true');
  assert.equal(ev({ 表: '重要角色表/山姆/好感度状态 >= 友好', 档位: T }, t).r.v, 'false');
  assert.equal(ev({ 表: '重要角色表/巴基/对彼得阶段 >= 熟悉', 档位: ['陌生', '相识', '熟悉', '信任'] }, t).r.v, 'true', '"2 熟悉"');
  t.sheet_r.content[1][3] = '很要好';
  assert.equal(ev({ 表: '重要角色表/巴基/好感度状态 >= 友好', 档位: T }, t).r.v, 'unknown');
  assert.match(ev({ 表: '重要角色表/巴基/好感度状态 >= 喜欢', 档位: ['敌视', '陌生'] }, t).errs.join(), /不在档位/);
  assert.match(ev({ 表: '重要角色表/巴基/好感度状态 >= 友好', 档位: ['友好'] }, t).errs.join(), /至少两项/);
  // 没有档位时，文字比大小仍然是未知（原有行为）
  assert.equal(ev({ 表: '重要角色表/巴基/好感度状态 >= 友好' }, t).r.v, 'unknown');
});

test('condition 样例: the plugin re-extracts the sample; a mismatch makes the condition unknown (never loosened)', () => {
  const t = ROLE(), base = { 表: '重要角色表/巴基/人际关系 包含 朋友', 取: '彼得' };
  assert.equal(ev({ ...base, 样例: { 原文: '主角:认识;艾莉丝:室友兼闺蜜', 取: '艾莉丝', 得: '室友兼闺蜜' } }, t).r.v, 'true');
  // 只写了其中一个标签也算认对了这个人
  assert.equal(ev({ ...base, 样例: { 原文: '彼得:队友,有点别扭;山姆:老搭档', 取: '彼得', 得: '队友' } }, t).r.v, 'true');
  const bad = ev({ ...base, 样例: { 原文: '主角:认识;艾莉丝:室友兼闺蜜', 取: '艾莉丝', 得: '主角' } }, t).r;
  assert.equal(bad.v, 'unknown');
  assert.match(bad.reasons[0], /暂时读不出来/);
});

test('condition 样例: an unquoted YAML flow map split at commas is joined back (DeepSeek writes it this way)', () => {
  const errs = [], a = C.parseCondition({ 表: '重要角色表/山姆/人际关系 包含 朋友', 取: '彼得', 样例: { 原文: '彼得:队友', '有点别扭;山姆:老搭档': null, 取: '彼得', 得: '队友', 有点别扭: null } }, errs);
  assert.deepEqual(errs, []);
  assert.deepEqual(a.sample, { text: '彼得:队友,有点别扭;山姆:老搭档', key: '彼得', want: '队友,有点别扭' });
  assert.equal(C.sampleAgrees(a), true);
});

test('condition 包含 / 不包含 work on plain cells too', () => {
  const t = ROLE();
  assert.equal(ev('表: 重要角色表/巴基/人际关系 包含 搭档', t).r.v, 'true');
  assert.equal(ev('表: 重要角色表/巴基/人际关系 不包含 搭档', t).r.v, 'false');
});

// ---------- 核对（草稿检查、审阅显示） ----------
const draft = (open) => [{ id: 'v', key: '剧情_S01_试试', line: { 编号: 'S01', 类型: '支线', 开启条件: open }, stages: [{ id: 's', key: '阶段1_开始', data: { 主线节点: [{ id: 'n1', 名称: 'n1', 入口: '去', 发现: [{ 事实: 'F1', 内容: 'x' }], 完成条件: { 事实: 'F1' } }] } }] }];

test('report: missing table / column is "bad" (stuck); missing row is a hint that references other rows', () => {
  const t = ROLE();
  const noTable = C.tableCondReport(draft({ 表: '声望表/彼得/声望 >= 50' }), t)[0];
  assert.equal(noTable.level, 'bad'); assert.match(noTable.notes[0], /没有「声望表」这张表/);
  const noCol = C.tableCondReport(draft({ 表: '重要角色表/彼得/声望 >= 50' }), t)[0];
  assert.equal(noCol.level, 'bad'); assert.match(noCol.notes[0], /没有「声望」这一列/);
  const noRow = C.tableCondReport(draft({ 表: '重要角色表/沃克/好感度状态 >= 友好', 档位: ['敌视', '陌生', '友好', '亲密', '相恋'] }), t)[0];
  assert.equal(noRow.level, 'warn');
  assert.match(noRow.notes.join(), /还没有「沃克」这一行；同一列别的行已经有值（如「友好」），沃克出现在表里以后才开始判断/);
  assert.equal(C.tableCondChecks(C.parseCondition({ 表: '重要角色表/沃克/好感度状态 == 友好' }), t)[0].stuck, false, 'a missing row is not stuck');
});

test('report: shows the current value; flags inferred tier order (待确认), unseen tiers, made-up samples, sentence columns, frequency 0', () => {
  const t = ROLE();
  const okTier = C.tableCondReport(draft({ 表: '重要角色表/巴基/好感度状态 >= 友好', 档位: ['敌视', '陌生', '友好', '亲密', '相恋'] }), t)[0];
  assert.equal(okTier.level, 'ok'); assert.equal(okTier.now, '友好');
  const guessed = C.tableCondReport(draft({ 表: '重要角色表/巴基/好感度状态 >= 友好', 档位: ['陌生', '友好', '死党'] }), t)[0];
  assert.match(guessed.notes.join(), /待确认/); assert.match(guessed.notes.join(), /「死党」在表格说明和现有数据里都没出现/);
  const pick = C.tableCondReport(draft({ 表: '重要角色表/巴基/人际关系 包含 朋友', 取: '彼得', 样例: { 原文: '主角:同学;小美:闺蜜', 取: '小美', 得: '闺蜜' } }), t)[0];
  assert.equal(pick.now, '彼得：朋友,搭档');
  assert.doesNotMatch(pick.notes.join(), /不是表里或说明里的真实内容/, 'the real cell already reads 彼得 → the sample no longer matters (实测 2026-11-15)');
  const pickNoRow = C.tableCondReport(draft({ 表: '重要角色表/沃克/人际关系 包含 朋友', 取: '彼得', 样例: { 原文: '主角:同学;小美:闺蜜', 取: '小美', 得: '闺蜜' } }), t)[0];
  assert.match(pickNoRow.notes.join(), /不是表里或说明里的真实内容/, 'no row yet → a made-up sample is still flagged');
  const words = C.tableCondReport(draft({ 表: '重要角色表/巴基/好感度状态 >= 好' }), t)[0];
  assert.match(words.notes.join(), /不是数字，比大小要写档位/);
  const longT = { sheet_r: sheet('重要角色表', ['姓名', '状况'], [['巴基', '在布鲁克林的旧公寓里修摩托车'], ['山姆', '去华盛顿开会了，周末才回来']]) };
  assert.match(C.tableCondReport(draft({ 表: '重要角色表/巴基/状况 == 开心' }), longT)[0].notes.join(), /每次填的是一句话/);
  const frozen = { sheet_r: sheet('重要角色表', ['姓名', '阶段'], [['巴基', '1']], '', 0) };
  assert.match(C.tableCondReport(draft({ 表: '重要角色表/巴基/阶段 >= 2' }), frozen)[0].notes.join(), /不自动更新/);
});

test('checkClueDraft: table hints are listed; a missing column says it stays unknown and suggests manual', () => {
  const t = ROLE();
  const issues = C.checkClueDraft(draft({ 表: '重要角色表/彼得/声望 >= 50' }), [], { tables: t }).join('\n');
  assert.match(issues, /没有「声望」这一列。这个条件会一直是未知.*改成手动开始/);
});

// ---------- 改成人工开启 ----------
test('lineToManual: the condition moves to 原开启条件, mode becomes 人工; the line then offers 进入 instead of waiting forever', () => {
  const vols = [{ id: 'vM', key: '剧情_M1', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 'sm', key: '阶段1_a', data: { 主线节点: [{ id: 'm1', 名称: 'm1', 入口: '去', 发现: [{ 事实: 'Fm', 内容: 'x' }], 完成条件: { 事实: 'Fm' } }] } }] }, ...draft({ 表: '声望表/彼得/声望 >= 50' })];
  const next = C.lineToManual(vols, 'S01');
  assert.notEqual(next, vols);
  assert.equal(next[1].line.开启方式, '人工');
  assert.equal(next[1].line.开启条件, undefined);
  assert.match(next[1].line.原开启条件, /声望表\/彼得\/声望 >= 50/);
  assert.equal(C.lineToManual(next, 'S01'), next, 'already manual → unchanged');
  const comp = C.compileClue(next), st = C.computeClueState(comp, { facts: new Map(), knowledge: [], tables: {}, problems: [] }, { focus: '', overrides: {}, factOverrides: {}, lines: {} }, C.normalizeClue({ mode: 'clue' }));
  const s = st.lineStates.find((x) => x.line.id === 'S01');
  assert.equal(s.line.mode, 'manual');
  assert.equal(s.line.origCond.includes('声望'), true);
  assert.equal(s.eligible, true, 'no condition → eligible, so the 进入 button shows');
  assert.equal(s.started, false, 'but it never starts by itself');
});

// ---------- 给 AI 的表格目录 ----------
test('tableCatalogText: carries current values and the relevant note lines (formats, tiers), skips ✗ examples and the plugin\'s own tables', () => {
  const t = { ...ROLE(), sheet_f: sheet('关键事实表', ['编号', '状态'], [['F1', '已核实']], '很长的说明') };
  t.sheet_r.sourceData.note += '\n× 主角:旧识,艾莉丝:室友   ← 不同角色用逗号\n随便写点什么无关的话';
  const cat = C.tableCatalogText(t);
  assert.match(cat, /· 人际关系：「主角:旧识;彼得:朋友,搭档」/);
  assert.match(cat, /只能填 敌视\/陌生\/友好\/亲密\/相恋 之一/);
  assert.match(cat, /0 陌生/);
  assert.doesNotMatch(cat, /× 主角/);
  assert.doesNotMatch(cat, /随便写点什么/);
  assert.doesNotMatch(cat, /很长的说明/);
  assert.match(cat, /档位: \[敌视, 陌生, 友好, 亲密, 相恋\]/);
  assert.match(cat, /取: 主角名/);
  // 实测 2026-11-17：读不到真实的多人格子时，AI 照抄了示例样例 → 没有真实内容就不写样例
  assert.match(cat, /\*\*没有\*\*这样的真实内容时，不写样例/);
  assert.doesNotMatch(cat, /艾莉丝:室友, 取: 艾莉丝/, 'no copyable fake sample in the rule');
});

// ---------- 执行页：读不出来的开启条件给「改成人工开启」 ----------
import { createHost } from './host-sim.mjs';
test('run page: a line whose table condition can never be read shows 改成人工开启; after confirming, 进入 appears and the original request is shown', async () => {
  const host = createHost({ tables: { sheet_r: sheet('重要角色表', ['姓名', '阶段'], [['巴基', '1']]) } });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('第二批');
  const main = { id: 'vM', key: '剧情_M1_主线', line: { 编号: 'M1', 类型: '主线' }, stages: [{ id: 'sm', key: '阶段1_a', data: { 主线节点: [{ id: 'm1', 名称: 'm1', 入口: '去', 发现: [{ 事实: 'Fm', 内容: 'x' }], 完成条件: { 事实: 'Fm' } }] } }] };
  inst.data.updateProject(p.id, (x) => ({ ...x, outline: { volumes: [main, ...draft({ 表: '重要角色表/彼得/声望 >= 50' })] }, clue: { mode: 'clue', bindings: { facts: [{ 表: '关键事实表', 编号列: '编号', 状态列: '状态', 已核实值: '已核实' }], knowledge: [], scene: null } } }));
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  await host.addMessage('开场白', false);
  inst.data.updateSettings({ tourState: { revision: 2, done: ['core'] } });
  inst.open(); await new Promise((r) => setTimeout(r, 20));
  const doc = host.w.document, tick = () => new Promise((r) => setTimeout(r, 20));
  doc.querySelector(`[data-act="project"][data-id="${p.id}"]`).click(); await tick();
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  const card = () => [...doc.querySelectorAll('.pi-card')].find((c) => /剧情线/.test(c.querySelector('h3')?.textContent || ''));
  assert.match(card().textContent, /开启条件读不出来：「重要角色表」没有「声望」这一列/);
  card().querySelector('[data-act="clue-line-manual"][data-id="S01"]').click(); await tick();
  doc.querySelector('.pi-dialog .pi-btn.is-primary').click(); await tick();
  const line = inst.data.project(p.id).outline.volumes.find((v) => v.line && v.line.编号 === 'S01').line;
  assert.equal(line.开启方式, '人工');
  assert.match(line.原开启条件, /声望/);
  doc.querySelector('[data-act="tab"][data-tab="run"]').click(); await tick();
  assert.doesNotMatch(card().textContent, /开启条件读不出来/);
  assert.match(card().textContent, /原来的开启要求.*声望/);
  assert.ok(card().querySelector('[data-act="clue-line"][data-id="S01"][data-value="enter"]'), '进入 is offered');
  assert.equal(host.llmCalls.length, 0, 'no model calls');
  await inst.destroy();
});
