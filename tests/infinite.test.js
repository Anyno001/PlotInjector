import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_CONFIG, DEFAULT_HUB, blankedWordKeys, normalizeInfinite, normalizeWorld, poolToText, putWorld, randomFloat, rollPool, rollWorldDice, textToPool, titleKey } from '../src/core/infinite.js';
import { addLog, buildInfiniteDetail, createWorld, emptyInfinite, enterWorld, leaveWorld, normalizeInfiniteProgress, reenterWorld, removeWorld, undoEnter, undoLeave, withTrigger } from '../src/core/infinite-flow.js';
import { decideTrigger, describeRead, hashText, judgeTrigger, makeTrigger, parseTrainState, trainStates } from '../src/core/infinite-state.js';
import { DEFAULT_WORLD_SPEC, buildWorldMessages, horrorTitle, parseWorldReply, worldSpecText } from '../src/core/infinite-world.js';
import { buildEntries } from '../src/core/inject.js';
import { emptyProgress, normalizeProgress } from '../src/core/progress.js';
import { newProject, normalizeProject, normalizeSettings } from '../src/core/store.js';

const dice = { horror: '规则怪谈', cycle: '三天', client: '守夜的老人', lust: '轻' };
const parsed = { title: '雾渡口', body: '外观：渡口起雾。\n站台：石阶下的灯笼，起雾时出现。\n真相：船夫是上一任。' };
const fixed = value => () => value;
const mk = (id = 'w1') => createWorld({ id, dice, parsed });

test('普通项目不受影响：mode 默认 normal，不带 infinite，注入条目不变', () => {
    const project = newProject('普通');
    assert.equal(project.mode, 'normal');
    assert.equal('infinite' in project, false);
    assert.equal(normalizeProject(project, project.id).mode, 'normal');
    assert.equal('infinite' in normalizeProject(project, project.id), false);
    assert.equal('infinite' in normalizeProgress({}, 'x'), false);
    assert.deepEqual(buildEntries(project, emptyProgress(project.id), normalizeSettings({})), []);
});

test('无限流项目模板只剩骰池、造世界规范、写法条目前缀', () => {
    const project = newProject('末班车', 1, 'infinite');
    assert.equal(project.mode, 'infinite');
    const inf = normalizeProject(project, project.id).infinite;
    assert.deepEqual(Object.keys(inf).sort(), ['config', 'pools', 'spec']);
    assert.deepEqual(Object.keys(inf.config), ['horrorPrefix', 'hubName', 'blockTag', 'fieldNames', 'words']);
    assert.deepEqual({ hubName: inf.config.hubName, blockTag: inf.config.blockTag, fieldNames: inf.config.fieldNames, words: inf.config.words }, DEFAULT_HUB, '默认主空间配置等于原来写死的末班车');
    assert.equal(inf.config.horrorPrefix, '🎭 恐怖类型：');
    assert.deepEqual(inf.pools.lust.map(item => item.weight), [70, 25, 5]);
    assert.deepEqual(inf.pools.cycle.map(item => item.label), ['一晚', '三天', '一个月', '一年', '超过一生']);
    assert.deepEqual(textToPool(poolToText(inf.pools.horror)), inf.pools.horror);
    assert.deepEqual(textToPool('a|2\n\nb'), [{ label: 'a', weight: 2 }, { label: 'b', weight: 1 }]);
    const legacy = normalizeInfinite({ pools: { horror: [] }, config: { ringSize: 0, tempRate: 1, horrorPrefix: '恐怖：' }, worlds: [mk()], milestones: [{ title: 'x' }], levelText: ['a'] });
    assert.ok(legacy.pools.horror.length > 0, '空骰池回退默认');
    assert.deepEqual(Object.keys(legacy).sort(), ['config', 'pools', 'spec'], '多余字段不保留');
    assert.deepEqual(legacy.config, { horrorPrefix: '恐怖：', ...DEFAULT_HUB });
    assert.equal(normalizeInfinite({ config: { horrorPrefix: '' } }).config.horrorPrefix, '', '允许清空前缀');
    assert.equal(DEFAULT_CONFIG.horrorPrefix, '🎭 恐怖类型：');
});

test('掷骰：真随机在 [0,1)，按权重，不再按污染加权', () => {
    for (let i = 0; i < 50; i += 1) { const r = randomFloat(); assert.ok(r >= 0 && r < 1); }
    const pool = [{ label: 'a', weight: 1 }, { label: 'b', weight: 3 }];
    assert.equal(rollPool(pool, fixed(0)).label, 'a');
    assert.equal(rollPool(pool, fixed(0.3)).label, 'b');
    assert.equal(rollPool(pool, fixed(0.999999)).label, 'b');
    const inf = normalizeInfinite({});
    assert.equal(rollWorldDice(inf, fixed(0.69)).lust, '无');
    assert.equal(rollWorldDice(inf, fixed(0.71)).lust, '轻');
    assert.equal(rollWorldDice(inf, fixed(0.96)).lust, '重');
    const d = rollWorldDice(inf, fixed(0));
    assert.deepEqual(Object.keys(d).sort(), ['client', 'cycle', 'horror', 'lust']);
    assert.ok(Object.values(d).every(Boolean));
});

test('开副本、关副本：档案进世界库，关副本只撤注入不删档案', () => {
    let inf = emptyInfinite();
    assert.deepEqual([inf.phase, inf.worldId, inf.worlds.length], ['train', '', 0]);
    inf = enterWorld(inf, mk('w1'));
    assert.deepEqual([inf.phase, inf.worldId, inf.worlds.length], ['world', 'w1', 1]);
    assert.ok(inf.log.at(-1).includes('雾渡口'));
    inf = leaveWorld(inf);
    assert.deepEqual([inf.phase, inf.worldId, inf.worlds.length], ['train', '', 1], '档案留在世界库');
    inf = enterWorld(inf, mk('w2'));
    assert.equal(inf.worlds.length, 2);
    inf = reenterWorld(leaveWorld(inf), 'w1');
    assert.deepEqual([inf.phase, inf.worldId], ['world', 'w1'], '手动重新打开某份档案');
    assert.equal(inf.worlds.length, 2, '重新打开不新增档案');
    assert.throws(() => reenterWorld(emptyInfinite(), 'nope'), /不在世界库/);
});

test('删除档案：删的是当前世界就回到列车', () => {
    let inf = enterWorld(enterWorld(emptyInfinite(), mk('w1')), mk('w2'));
    const other = removeWorld(inf, 'w1');
    assert.deepEqual([other.phase, other.worldId, other.worlds.length], ['world', 'w2', 1]);
    const current = removeWorld(inf, 'w2');
    assert.deepEqual([current.phase, current.worldId, current.worlds.length], ['train', '', 1]);
});

test('注入：只有 <列车状态>，在世界里才多一个 <世界档案>，整份原样不动，情欲浓度由代码附在末尾', () => {
    const train = buildInfiniteDetail(enterWorld(emptyInfinite(), mk()).phase === 'world' ? leaveWorld(enterWorld(emptyInfinite(), mk())) : emptyInfinite());
    assert.ok(train.includes('<列车状态>') && train.includes('在列车，尚未出发'));
    assert.ok(!train.includes('<世界档案>') && !train.includes('渡口起雾'), '在列车上不带档案');
    const inf = enterWorld(emptyInfinite(), mk());
    const text = buildInfiniteDetail(inf);
    assert.ok(text.includes('在世界里「雾渡口」'));
    assert.ok(text.includes(`<世界档案>\n${parsed.body}\n\n情欲浓度：轻\n</世界档案>`), '整份档案原样注入');
    assert.ok(text.includes('船夫是上一任') && text.includes('站台：石阶下的灯笼'), '真相和站台都在档案里');
    assert.ok(!text.includes('<站台>'), '没有单独的站台标签');
    assert.equal(buildInfiniteDetail(inf), text, '副本期间档案原样不动');
    assert.equal(buildInfiniteDetail({ ...inf, log: ['别的日志'] }), text, '其他状态变化不影响注入');
    assert.equal((text.match(/<[^/>]+>/g) || []).length, 2, '只有两个标签块');
});

test('无限流项目的 buildEntries：常驻设定照旧加一条状态详细条目，世界取自聊天进度', () => {
    const project = { ...newProject('车', 1, 'infinite'), setting: { text: '列车规则', history: [], check: '', fixes: [] } };
    assert.equal('worlds' in project.infinite, false, '世界库不在项目模板里');
    const progress = { ...emptyProgress(project.id), infinite: enterWorld(emptyInfinite(), mk()) };
    const entries = buildEntries(project, progress, normalizeSettings({}));
    assert.deepEqual(entries.map(entry => entry.kind), ['setting', 'detail']);
    assert.ok(entries[1].content.includes('渡口起雾'));
    assert.equal(buildEntries(project, emptyProgress(project.id), normalizeSettings({})).length, 2, '进度里还没有 infinite 时按列车状态注入');
    const other = { ...emptyProgress('另一条聊天'), infinite: emptyInfinite() };
    assert.ok(!buildEntries(project, other, normalizeSettings({}))[1].content.includes('渡口起雾'), '另一条聊天看不到这条聊天的世界');
});

test('进度规范化：只剩 phase、worldId、worlds、log，非法值回退', () => {
    const p = normalizeProgress({ infinite: { phase: 'zzz', lap: 3, pollution: 5, ring: ['w1'], milestonesOn: ['x'], worlds: [mk(), null, 5], log: Array.from({ length: 30 }, (_, i) => `l${i}`) } }, 'x');
    assert.deepEqual(Object.keys(p.infinite).sort(), ['log', 'phase', 'worldId', 'worlds']);
    assert.equal(p.infinite.phase, 'train');
    assert.equal(p.infinite.log.length, 12);
    assert.equal(p.infinite.worlds.length, 1, '非对象的世界被丢弃');
    assert.equal(p.infinite.worlds[0].body, parsed.body);
    assert.deepEqual(Object.keys(p.infinite.worlds[0]).sort(), ['body', 'dice', 'id', 'title']);
    const ok = normalizeInfiniteProgress({ phase: 'world', worldId: 'w1', worlds: [mk()] });
    assert.deepEqual([ok.phase, ok.worldId], ['world', 'w1']);
    const orphan = normalizeInfiniteProgress({ phase: 'world', worldId: 'gone', worlds: [mk()] });
    assert.deepEqual([orphan.phase, orphan.worldId], ['train', ''], '档案不在了就回到列车');
    assert.equal(addLog(emptyInfinite(), 'a').log[0], 'a');
    assert.equal(normalizeWorld({}).title, '无名之站');
    assert.equal(putWorld([mk()], { ...mk(), title: '改' }).length, 1);
    assert.equal(titleKey('🗝️ 隐藏真相：前任店主'), titleKey('🗝隐藏真相：前任店主'), '忽略 emoji 变体选择符和空白');
});

test('造世界：规范不分公开隐藏，消息带骰子、写法条目和重试提示，解析【标题】【档案】', () => {
    assert.doesNotMatch(DEFAULT_WORLD_SPEC, /公开|隐藏|检测模型|检定/);
    for (const section of ['外观', '委托', '卡住的事', '因果', '线索', '离开这个世界的出口', '周期证据', '居民认知', '真相']) assert.ok(DEFAULT_WORLD_SPEC.includes(section), section);
    assert.ok(DEFAULT_WORLD_SPEC.includes('地点→实物→能证明什么'));
    assert.ok(DEFAULT_WORLD_SPEC.includes('样子、位置、出现条件、消失时机'));
    assert.equal(horrorTitle('🎭 恐怖类型：', '中式民俗'), '🎭 恐怖类型：中式民俗');
    const msgs = buildWorldMessages({ spec: worldSpecText({}), dice, titles: ['旧站'], hint: '缺少【档案】部分', horrorGuide: '写法：门后永远有人。' });
    assert.ok(msgs[0].content.includes('【档案】') && !msgs[0].content.includes('【隐藏】'));
    const user = msgs[1].content;
    assert.ok(user.includes('规则怪谈') && user.includes('旧站') && user.includes('缺少【档案】部分') && user.includes('情欲浓度：轻'));
    assert.ok(user.includes('【本世界恐怖类型写法】\n写法：门后永远有人。'));
    assert.ok(!buildWorldMessages({ spec: worldSpecText({}), dice })[1].content.includes('本世界恐怖类型写法'), '找不到条目就不出现这一段');
    assert.equal(worldSpecText({ spec: '自定义规范' }), '自定义规范');
    assert.deepEqual(parseWorldReply('前言\n【标题】雾渡口\n【档案】\n外观：起雾。\n第二行'), { title: '雾渡口', body: '外观：起雾。\n第二行' });
    assert.equal(parseWorldReply('### 【档案】 内容甲').body, '内容甲');
    assert.equal(parseWorldReply('【档案】\n只有档案').title, '无名之站');
    assert.throws(() => parseWorldReply('【标题】雾渡口'), /缺少【档案】/);
    assert.throws(() => parseWorldReply('乱写一通'), /缺少【档案】/);
});

const block = value => `正文。\n<末班车状态>\n列车：${value}\n污染：旧档（3）\n</末班车状态>`;

test('状态块解析：四选一，全角半角冒号都认，取最后一个块，读不到返回空', () => {
    for (const value of ['车上', '停站', '世界里', '回到列车']) assert.equal(parseTrainState(block(value)), value);
    assert.equal(parseTrainState('<末班车状态>\n列车: 停站\n</末班车状态>'), '停站', '半角冒号');
    assert.equal(parseTrainState('<末班车状态>\n  列车 ： 停站  \n</末班车状态>'), '停站', '前后空白');
    assert.equal(parseTrainState(`${block('车上')}\n${block('停站')}`), '停站', '取最后一个块');
    assert.equal(parseTrainState(`${block('停站')}\n${block('车上')}`), '车上');
    assert.equal(parseTrainState('没有状态块'), '');
    assert.equal(parseTrainState('列车：停站'), '', '块外的不算');
    assert.equal(parseTrainState('<末班车状态>\n污染：档（1）\n</末班车状态>'), '', '没有列车一栏');
    assert.equal(parseTrainState('<末班车状态>\n列车：减速中\n</末班车状态>'), '', '读不出状态');
    assert.equal(parseTrainState('<末班车状态>\n列车：进站中\n</末班车状态>'), '停站', '同义词：进站');
    assert.equal(parseTrainState('<末班车状态>\n列车：已到站，准备下车\n</末班车状态>'), '停站', '同义词：到站');
    assert.equal(parseTrainState('<末班车状态>\n列车：已回到车上\n</末班车状态>'), '回到列车', '回到车上不算成车上');
    assert.equal(parseTrainState('<末班车状态>\n列车：在副本中\n</末班车状态>'), '世界里', '同义词：副本');
    assert.equal(parseTrainState('<末班车状态>\n列车：车上，尚未停站\n</末班车状态>'), '车上', '否定词不算');
    assert.equal(parseTrainState('<末班车状态>\n位置：停站\n</末班车状态>'), '停站', '栏名写成位置');
    assert.equal(parseTrainState('<末班车状态>\n列车状态：停站\n</末班车状态>'), '停站', '栏名写成列车状态');
    assert.equal(parseTrainState('<末班车状态>\n停站\n污染：沾染（4）\n</末班车状态>'), '停站', '没写栏名');
    assert.equal(parseTrainState('<末班车状态>\n🚃 停站\n☣️ 污染：沾染（4）'), '停站', '缺收尾标签');
    assert.equal(parseTrainState('< 末班车状态 >\n列车：停站\n< /末班车状态 >'), '停站', '标签里有空格');
    assert.equal(parseTrainState('＜末班车状态＞\n列车：停站\n＜/末班车状态＞'), '停站', '全角尖括号');
    assert.equal(parseTrainState('<末班车状态>\n列车：车上\n污染：在副本里沾上的（4）\n</末班车状态>'), '车上', '污染栏里的词不算');
    assert.equal(parseTrainState('<末班车状态>\n列车：停站。\n</末班车状态>'), '停站', '带标点');
    assert.equal(parseTrainState('<末班车状态>\n列车：停站（列车减速）\n</末班车状态>'), '停站', '带括注');
    assert.equal(parseTrainState('<末班车状态>\n列车：车上 / 停站 / 世界里 / 回到列车（四选一）\n</末班车状态>'), '', '照抄模板不算');
    assert.equal(parseTrainState(null), '');
});

test('触发判断：车上读到停站开副本，世界里读到回到列车关副本，其余不动', () => {
    assert.equal(decideTrigger('train', '停站'), 'enter');
    assert.equal(decideTrigger('train', '回到列车'), '');
    assert.equal(decideTrigger('train', '车上'), '');
    assert.equal(decideTrigger('train', ''), '');
    assert.equal(decideTrigger('world', '回到列车'), 'leave');
    assert.equal(decideTrigger('world', '停站'), '');
    assert.equal(decideTrigger('world', '世界里'), '');
    assert.equal(decideTrigger('train', '世界里'), 'enter', '漏写停站，直接写世界里也开副本');
    assert.equal(decideTrigger('world', '车上'), 'leave', '漏写回到列车，直接写车上也关副本');
    assert.equal(decideTrigger('world', ''), '');
});

test('触发楼判断：没变 same、文字变了仍带触发值 keep、不再带或楼没了 undo', () => {
    const enter = makeTrigger({ kind: 'enter', floor: 4, text: block('停站'), worldId: 'w1' });
    assert.equal(enter.hash, hashText(block('停站')));
    assert.equal(judgeTrigger(enter, block('停站')), 'same');
    assert.equal(judgeTrigger(enter, `${block('停站')}多一句`), 'keep');
    assert.equal(judgeTrigger(enter, block('车上')), 'undo');
    assert.equal(judgeTrigger(enter, '没有状态块'), 'undo');
    assert.equal(judgeTrigger(enter, null), 'undo', '触发楼被删');
    assert.equal(judgeTrigger(null, 'x'), 'none');
    const leave = makeTrigger({ kind: 'leave', floor: 9, text: block('回到列车'), worldId: 'w1' });
    assert.equal(judgeTrigger(leave, block('回到列车')), 'same');
    assert.equal(judgeTrigger(leave, block('世界里')), 'undo');
    assert.notEqual(hashText('a'), hashText('b'));
    assert.equal(describeRead({ floor: 6, state: '停站' }), '上次读到：第 6 楼 列车：停站');
    assert.equal(describeRead({ floor: 6, state: '' }), '最新一楼没有状态块');
    assert.equal(describeRead(null), '最新一楼没有状态块');
});

test('撤销开副本删档案退回列车，撤销关副本重开档案，都不改入参；手动操作清掉触发记录', () => {
    const entered = withTrigger(enterWorld(emptyInfinite(), mk()), { kind: 'enter', floor: 4, hash: 'h', worldId: 'w1' });
    const frozen = JSON.stringify(entered);
    const back = undoEnter(entered);
    assert.equal(JSON.stringify(entered), frozen, '入参不变');
    assert.deepEqual([back.phase, back.worldId, back.worlds.length, 'trigger' in back], ['train', '', 0, false]);
    const left = withTrigger(leaveWorld(entered), { kind: 'leave', floor: 9, hash: 'h', worldId: 'w1' });
    const reopened = undoLeave(left);
    assert.deepEqual([reopened.phase, reopened.worldId, reopened.worlds.length, 'trigger' in reopened], ['world', 'w1', 1, false]);
    const gone = undoLeave({ ...left, worlds: [] });
    assert.deepEqual([gone.phase, 'trigger' in gone], ['train', false], '档案已不在就只清记录');
    assert.equal('trigger' in leaveWorld(entered), false, '手动关副本清掉记录');
    assert.equal('trigger' in reenterWorld(left, 'w1'), false);
    assert.equal('trigger' in removeWorld(entered, 'w1'), false);
    const kept = normalizeInfiniteProgress(entered);
    assert.deepEqual(kept.trigger, { kind: 'enter', floor: 4, hash: 'h', worldId: 'w1' }, '触发记录随聊天存');
    assert.equal('trigger' in normalizeInfiniteProgress({ ...entered, trigger: { kind: 'x', floor: 1 } }), false);
    assert.equal('trigger' in normalizeInfiniteProgress({ ...entered, trigger: { kind: 'enter', floor: -1, worldId: 'w1' } }), false);
    assert.equal('trigger' in normalizeInfiniteProgress({ ...entered, trigger: { kind: 'enter', floor: 1, worldId: 'zz' } }), false, '档案不在则丢弃');
});

const APT = { hubName: '公寓', blockTag: '公寓状态', fieldNames: ['公寓', '位置'], words: { depart: ['出门', '下楼'], back: ['回公寓', '进门'], away: ['副本里'], hub: ['公寓里'] } };
const aptBlock = value => `正文。\n<公寓状态>\n公寓：${value}\n污染：旧档（3）\n</公寓状态>`;

test('自定义主空间配置：开、关、否定、照抄模板都按配置读', () => {
    assert.equal(parseTrainState(aptBlock('出门'), APT), '出门');
    assert.equal(parseTrainState(aptBlock('已经下楼了'), APT), '出门', '同组第二个词也认，显示名是第一个');
    assert.equal(parseTrainState(aptBlock('进门'), APT), '回公寓');
    assert.equal(parseTrainState(aptBlock('副本里'), APT), '副本里');
    assert.equal(parseTrainState(aptBlock('公寓里'), APT), '公寓里');
    assert.equal(parseTrainState(aptBlock('还没出门'), APT), '', '否定词不算');
    assert.equal(parseTrainState(aptBlock('公寓里 / 出门 / 副本里 / 回公寓（四选一）'), APT), '', '照抄模板不算');
    assert.equal(parseTrainState('<末班车状态>\n列车：停站\n</末班车状态>', APT), '', '旧标签不再认');
    assert.equal(parseTrainState('<公寓状态>\n位置：出门\n</公寓状态>', APT), '出门', '配置里的另一个栏名');
    assert.equal(parseTrainState('<公寓状态>\n列车：出门\n污染：无\n</公寓状态>', APT), '出门', '栏名不在配置里就读整块');
    assert.equal(decideTrigger('train', '出门', APT), 'enter');
    assert.equal(decideTrigger('train', '副本里', APT), 'enter', '漏写出发也认');
    assert.equal(decideTrigger('world', '回公寓', APT), 'leave');
    assert.equal(decideTrigger('world', '公寓里', APT), 'leave', '漏写返回也认');
    assert.equal(decideTrigger('train', '公寓里', APT), '');
    assert.equal(decideTrigger('train', '停站', APT), '', '默认词不再触发');
    const enter = makeTrigger({ kind: 'enter', floor: 3, text: aptBlock('出门'), worldId: 'w1' });
    assert.equal(judgeTrigger(enter, aptBlock('出门'), APT), 'same');
    assert.equal(judgeTrigger(enter, aptBlock('公寓里'), APT), 'undo');
    assert.equal(describeRead({ floor: 6, state: '出门' }, APT), '上次读到：第 6 楼 公寓：出门');
    assert.deepEqual(trainStates(APT), ['公寓里', '出门', '副本里', '回公寓']);
});

test('自定义配置：标签和栏名里的正则特殊字符先转义', () => {
    const cfg = { blockTag: '状态(主)+[1]', fieldNames: ['a.b', '位置*'] };
    assert.equal(parseTrainState('<状态(主)+[1]>\na.b：停站\n</状态(主)+[1]>', cfg), '停站');
    assert.equal(parseTrainState('<状态(主)+[1]>\n位置*：停站\n</状态(主)+[1]>', cfg), '停站');
    assert.equal(parseTrainState('<状态主主1>\na.b：停站\n</状态主主1>', cfg), '', '特殊字符不当正则用');
    assert.equal(parseTrainState('<状态(主)+[1]>\naxb：停站\n污染：无\n</状态(主)+[1]>', cfg), '停站', '点号不通配，退回读整块');
    assert.doesNotThrow(() => parseTrainState('x', { blockTag: '\\', fieldNames: ['('] }));
});

test('主空间配置补全：缺字段、类型不对用默认；词组清空退回默认并可查出', () => {
    const empty = normalizeInfinite({ config: { hubName: 5, blockTag: '  ', fieldNames: 'x', words: { back: 'x', depart: [], away: [' ', 7], hub: ['公寓里', '公寓里'] } } }).config;
    assert.equal(empty.hubName, '列车');
    assert.equal(empty.blockTag, '末班车状态');
    assert.deepEqual(empty.fieldNames, DEFAULT_HUB.fieldNames);
    assert.deepEqual(empty.words.back, DEFAULT_HUB.words.back, '类型不对退回默认');
    assert.deepEqual(empty.words.depart, [], '清空的词组保留空，取用时才退回');
    assert.deepEqual(empty.words.away, ['7']);
    assert.deepEqual(empty.words.hub, ['公寓里'], '去重');
    assert.deepEqual(blankedWordKeys(empty), ['depart']);
    assert.equal(parseTrainState('<末班车状态>\n列车：停站\n</末班车状态>', empty), '停站', '空组按默认词读');
    assert.equal(parseTrainState('<末班车状态>\n列车：停站\n</末班车状态>'), '停站', '不传配置用默认');
    assert.deepEqual(blankedWordKeys(undefined), []);
});

test('自定义配置的注入：标签和状态文字用主空间名称', () => {
    const text = buildInfiniteDetail(emptyInfinite(), APT);
    assert.ok(text.includes('<公寓状态>') && text.includes('</公寓状态>') && text.includes('在公寓'));
    assert.ok(!text.includes('列车'));
    const world = buildInfiniteDetail(enterWorld(emptyInfinite(), mk()), APT);
    assert.ok(world.includes('<世界档案>') && world.includes('<公寓状态>'));
    assert.ok(buildWorldMessages({ spec: 's', dice: { horror: 'a', cycle: 'b', client: 'c', lust: 'd' }, setting: '规则' })[1].content.includes('【主空间常驻规则】'));
    assert.ok(!DEFAULT_WORLD_SPEC.includes('列车'));
    assert.ok(removeWorld(enterWorld(emptyInfinite(), mk('w1')), 'w1', APT).log.at(-1).includes('回到公寓'));
});
