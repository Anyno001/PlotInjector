// 跑团原文切片库（trpg-slices.js）的行为测试。样本全部自造。
import test from 'node:test';
import assert from 'node:assert/strict';
import * as S from '../src/trpg/trpg-slices.js';
import * as T from '../src/trpg/trpg.js';
import * as K from '../src/trpg/trpg-kp-check.js';

const SRC = '老周把茶碗推到桌角，低声说：\n“那口井，三十年前就封了，\n你们最好别问。”\n\n阁楼里积着厚厚的灰，窗边挂着一只停摆的铜钟，指针停在三点十分。';

test('切片只认原文里真有的句子，入库的是原文里的原始子串，并压掉硬换行', () => {
    let out = S.verifySlices(
        [
            { kind: 'line', who: '老周', where: '茶馆', quote: '那口井三十年前就封了你们最好别问' },
            { kind: 'scene', where: '阁楼', quote: '阁楼里积着厚厚的灰，窗边挂着一只停摆的铜钟' },
            { kind: 'line', who: '老周', quote: '这句原文里根本没有的话编出来的' },
            { kind: 'seed', where: '阁楼', quote: '指针停在三点十分', hint: '' },
        ],
        SRC,
        0,
    );
    assert.equal(out.length, 2);
    assert.equal(out[0].text, '那口井，三十年前就封了，你们最好别问');
    assert.ok(SRC.replace(/\n/g, '').includes(out[1].text));
});

test('normalizeTrpg 保留切片，老项目不带切片键', () => {
    assert.deepEqual(T.normalizeTrpg({ on: !0, rule: 'coc7' }), { on: !0, rule: 'coc7' });
    let t = T.normalizeTrpg({ on: !0, rule: 'coc7', slices: [{ id: 'sl0', kind: 'line', who: '老周', text: '那口井三十年前就封了' }] });
    assert.equal(t.slices.length, 1);
});

const list = [
    { id: 'a', kind: 'line', who: '老周', text: '那口井，三十年前就封了，你们最好别问。', node: 'n1' },
    { id: 'b', kind: 'seed', hint: '窗边停摆的铜钟', text: '窗边挂着一只停摆的铜钟', node: 'n1' },
    { id: 'c', kind: 'scene', text: '阁楼里积着厚厚的灰，窗边挂着一只停摆的铜钟。', node: 'n2' },
    { id: 'd', kind: 'line', who: '别人', text: '这是另一个场景里的台词，不该出现在这里。', node: 'n2' },
];
const ctx = (o = {}) => ({ sceneUid: 'n1', activeUids: new Set(['n1', 'n2']), held: new Set(), planted: new Set(), counts: new Map(), ...o });

test('注入：只给当前场景的台词，伏笔只给提示不给原文，埋过的和注入满 3 轮的不再给', () => {
    let lines = S.sliceLines(S.pickSlices(list, ctx())).join('\n');
    assert.match(lines, /老周：那口井/);
    assert.match(lines, /窗边停摆的铜钟/);
    assert.ok(!lines.includes('另一个场景'));
    assert.ok(!lines.includes('窗边挂着一只'));
    assert.ok(!S.pickSlices(list, ctx({ planted: new Set(['b']) })).some((x) => x.id === 'b'));
    assert.ok(!S.pickSlices(list, ctx({ counts: new Map([['b', 3]]) })).some((x) => x.id === 'b'));
    assert.deepEqual(S.pickSlices(list, ctx({ sceneUid: '' })).map((x) => x.kind), ['seed']);
});

test('和还没拿到的线索有 6 字公共片段的切片被扣住', () => {
    let held = S.heldSlices(list, ['井底下埋着三十年前就封了的那口箱子']);
    assert.ok(held.has('a'));
    assert.ok(!held.has('c'));
    assert.ok(!S.pickSlices(list, ctx({ held })).some((x) => x.id === 'a'));
});

test('伏笔随检测一起判：原句要在 AI 正文里，并和提示有公共片段；提示词只在有伏笔时多一节', () => {
    let seeds = [{ id: 'b', hint: '窗边停摆的铜钟', text: '窗边挂着一只停摆的铜钟' }],
        recent = [{ user: !1, text: '她抬头看见窗边那只停摆的铜钟，指针一动不动。' }],
        parsed = K.parseKpReply(JSON.stringify({ facts: [], conds: [], seeds: [{ id: 'b', pass: !0, quote: '窗边那只停摆的铜钟' }] })),
        r = K.verifyKp(parsed, { candidates: [], says: [], scenes: [], recent, seeds });
    assert.equal(r.seeds[0].ok, !0);
    let fake = K.verifyKp(K.parseKpReply(JSON.stringify({ seeds: [{ id: 'b', pass: !0, quote: '墙上挂着一幅画' }] })), { candidates: [], says: [], scenes: [], recent, seeds });
    assert.equal(fake.seeds[0].ok, !1);
    let base = { recent, candidates: [], says: [], scenes: [], stage: '', rules: '' };
    assert.ok(!JSON.stringify(K.kpCheckMessages(base)).includes('伏笔'));
    assert.ok(JSON.stringify(K.kpCheckMessages({ ...base, seeds })).includes('要判断的伏笔'));
    assert.equal(K.verifyKp(parsed, { candidates: [], says: [], scenes: [], recent }).seeds, undefined);
});

test('重 roll 之后伏笔当没埋', () => {
    let chat = [{ is_user: !1, swipe_id: 0, send_date: 'x' }];
    assert.ok(S.plantedSeeds({ b: { floor: 0, swipe: 0, stamp: 'x' } }, chat).has('b'));
    assert.ok(!S.plantedSeeds({ b: { floor: 0, swipe: 1, stamp: 'x' } }, chat).has('b'));
    assert.ok(!S.plantedSeeds({ b: { floor: 3, swipe: 0, stamp: 'x' } }, chat).has('b'));
});

test('AI 核对挂靠：只采纳清单里的节点，清单外的当作都不对应，只列出和现在不同的', () => {
    let nodes = [{ uid: 'n1', name: '茶馆' }, { uid: 'n2', name: '阁楼' }],
        slices = [{ id: 'a', node: 'n1' }, { id: 'b', node: 'n1' }, { id: 'c', node: '' }, { id: 'd', node: 'n2' }],
        items = S.parseAlign(JSON.stringify({ items: [{ id: 'a', node: 'n1' }, { id: 'b', node: 'n2', why: '写的是阁楼' }, { id: 'c', node: 'n9' }, { id: 'd', node: '' }] })),
        out = S.alignChanges(slices, items, nodes);
    assert.deepEqual(out.map((x) => [x.id, x.from, x.to]), [['b', 'n1', 'n2'], ['d', 'n2', '']]);
    assert.ok(JSON.stringify(S.alignMessages({ slices: [{ id: 'a', kind: 'line', who: '老周', text: '那口井三十年前就封了' }], nodes: [{ uid: 'n1', name: '茶馆', stage: '阶段一', entry: '' }] })).includes('节点清单'));
});

test('审阅页：按名字和内容看切片对应本阶段哪个场景，得分不够的不放进去', () => {
    let nodes = [{ key: 'm0', name: '茶馆', item: { 入口: '老周在茶馆里擦桌子' } }, { key: 'm1', name: '阁楼', item: { 场景: '积灰的阁楼' } }],
        hit = S.matchSlices(
            [
                { id: 'a', kind: 'line', who: '老周', where: '茶馆', text: '那口井三十年前就封了你们最好别问' },
                { id: 'b', kind: 'scene', where: '阁楼', text: '阁楼里积着厚厚的灰窗边挂着一只停摆的铜钟' },
                { id: 'c', kind: 'scene', where: '地下室', text: '潮湿的墙壁上长满了青苔' },
            ],
            nodes,
        );
    assert.deepEqual([...hit].map(([k, v]) => [k, v.map((x) => x.id)]), [['m0', ['a']], ['m1', ['b']]]);
});
