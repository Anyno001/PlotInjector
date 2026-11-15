import { compileClue } from './clue-rules.js';
import { isPlainObject, stageLabel } from './outline.js';
import { discoveryList, clueText, answerOverlap } from './clue-project.js';

import { parseYaml } from './yaml.js';
import { extractYaml } from './prompts.js';

export function factLabelContext(volumes, codes = null) {
    let compiled = compileClue(volumes || []),
        want = codes ? new Set(codes) : null,
        out = new Map();
    for (let node of compiled.nodes) {
        let item = isPlainObject(node.item) ? node.item : {};
        for (let d of discoveryList(item)) {
            if (!d.fact || (want && !want.has(d.fact))) continue;
            let route = {
                stage: stageLabel(node.unit.stage.key),
                nodeName: clueText(item.名称) || node.name || '',
                entry: clueText(item.入口),
                place: clueText(item.地点),
                scene: clueText(item.场景),
                answer: d.text,
                record: d.record,
            };
            if (out.has(d.fact)) {
                out.get(d.fact).routes.push(route);
                continue;
            }
            out.set(d.fact, { code: d.fact, node: node.uid || '', ...route, routes: [], usedBy: [] });
        }
    }
    // 条件里引用了、却没有节点产出的事实：也给出来（作者大纲不完整的常见情况），标成 orphan。
    let note = (cond, where) => {
        if (!cond) return;
        if (cond.kind === 'group') return cond.items.forEach((x) => note(x, where));
        if (cond.kind !== 'fact' && cond.kind !== 'know') return;
        if (want && !want.has(cond.fact)) return;
        out.has(cond.fact) ||
            out.set(cond.fact, {
                code: cond.fact,
                node: '',
                nodeName: '',
                entry: '',
                place: '',
                scene: '',
                answer: '',
                record: '',
                stage: '',
                routes: [],
                usedBy: [],
                orphan: !0,
            });
        out.get(cond.fact).usedBy.push(
            `${where}（${cond.kind === 'know' ? `${cond.verified ? '核实' : '知情'}@${cond.actor}` : cond.verified ? '核实' : '事实'}）`,
        );
    };
    for (let u of compiled.units)
        u.clue && (note(u.clue.enter, `${stageLabel(u.stage.key)}的进入条件`), note(u.clue.end, `${stageLabel(u.stage.key)}的结束条件`));
    for (let n of compiled.nodes)
        [
            [n.open, '开放条件'],
            [n.done, '完成条件'],
            [n.early, '提前条件'],
        ].forEach(([c, k]) => note(c, `${n.uid || n.name}的${k}`));
    return [...(codes || out.keys())].map(
        (code) =>
            out.get(code) || {
                code,
                node: '',
                nodeName: '',
                entry: '',
                place: '',
                scene: '',
                answer: '',
                record: '',
                stage: '',
                routes: [],
                usedBy: [],
                orphan: !0,
            },
    );
}

export function factLabelMessages(items, { secrets = [] } = {}) {
    let fence = '```',
        block = items
            .map((x) =>
                [
                    `- 编号: ${x.code}`,
                    x.stage && `  所在阶段: ${x.stage}`,
                    x.nodeName && `  所在节点: ${x.nodeName}`,
                    x.entry && `  入口（正文看得到）: ${x.entry}`,
                    x.place && `  地点: ${x.place}`,
                    x.scene && `  场景（正文看得到）: ${x.scene}`,
                    x.answer && `  发现内容（答案，不能写进标签和口径）: ${x.answer}`,
                    x.record && `  作者写的登记标准（可能含答案，只作参考）: ${x.record}`,
                    ...(x.routes || []).map((r, k) =>
                        [
                            `  另一种取得方式 ${k + 1}: ${[r.stage, r.nodeName].filter(Boolean).join(' · ')}`,
                            r.entry && `    入口: ${r.entry}`,
                            r.scene && `    场景: ${r.scene}`,
                            r.answer && `    这条路查到的（答案）: ${r.answer}`,
                            r.record && `    作者写的登记标准: ${r.record}`,
                        ]
                            .filter(Boolean)
                            .join('\n'),
                    ),
                    x.usedBy.length && `  被这些条件用到: ${x.usedBy.join('；')}`,
                    x.orphan && '  注意：大纲里没有节点产出这个事实',
                ]
                    .filter(Boolean)
                    .join('\n'),
            )
            .join('\n');
    return [
        {
            role: 'system',
            content: [
                '你在帮作者给剧情里的关键事实写两样东西。它们会写进数据库表格，填表模型每一楼都看得到，所以都不能透露答案。',
                '1. 标签：两到八个字的中性名字，只说「这是关于什么的」，不说「查到了什么」。例：「看守的证词」「抽屉里的单据」。不写人物真名、身份、动机、结论。',
                '2. 登记口径：一两句话，写清「正文里出现什么，才算主角拿到了这一条」。要卡在刚好那一步：',
                '   · 写取得的动作和看到的程度（当面听到、亲手打开读到、看清是什么），不写看到的内容本身。',
                '   · 写清什么不算：只是到了地方、看到上了锁、对方推托没开口、远远看见还没看清、主角自己猜的，都不算。',
                '   · 证词、传闻、某人的说法：写「对方当面说出时登记，记为存疑」。实物、痕迹、原件、亲眼验证：写「亲眼看清 / 读到时登记」，不写存疑——实物本身看不出是谁的、说明不了什么，也照样是亲眼看到的，不是存疑。',
                '   · 判断、结论类的（如「证词被推翻」）：口径写「读到某样东西之后，正文里明确说出这个判断时登记」，不要把判断的具体内容写进去（不写推翻了谁、跟什么无关）。',
                '   · 一条事实有「另一种取得方式」的：口径要把每种方式都包括进去（如「读到物流单上的地址，或证人当面说出地址时登记」），不要只写一种，否则走另一条路的玩家永远登记不上。一种是说法、一种是实物时，可以写「先记为存疑，拿到实物后改为已核实」。',
                '   · 被条件用作「核实」的，口径要写到被证实的那一步；只用作「事实」的，写到正文里出现即可。',
                '   · 例：「主角打开账房的抽屉、读到里面单据的内容时登记；只看到锁着的抽屉不算」。',
                secrets.length ? `这些名字在揭示之前不能出现在标签和口径里：${secrets.join('、')}。` : '',
                '作者给的材料不一定严丝合缝：节点信息可能缺，发现可能写得含糊，几条事实可能说的是同一件事，或者看不出靠什么行动取得。',
                '遇到这些情况不要硬编：照样尽量写一个保守的版本（宁可登记得晚，不要登记得早），并在 unsure 里用一句话说明哪里拿不准、建议作者补什么。没有问题就不写 unsure。',
                `只输出一个 ${fence}yaml 代码块，格式：`,
                `${fence}yaml`,
                '- 编号: F_xxx',
                '  标签: …',
                '  口径: …',
                '  unsure: …   # 可省略',
                fence,
                '每个编号都要输出，顺序和输入一致，编号原样照抄。',
            ]
                .filter(Boolean)
                .join('\n'),
        },
        { role: 'user', content: `【事实】\n${block}` },
    ];
}

export function parseFactLabels(text, codes) {
    let list = parseYaml(extractYaml(text)),
        map = /* @__PURE__ */ new Map();
    for (let x of Array.isArray(list) ? list : isPlainObject(list) && Array.isArray(list.事实) ? list.事实 : []) {
        if (!isPlainObject(x)) continue;
        let code = String(x.编号 || x.code || '').trim();
        code &&
            codes.includes(code) &&
            !map.has(code) &&
            map.set(code, {
                label: clueText(x.标签 || x.label || ''),
                criterion: clueText(x.口径 || x.登记口径 || x.criterion || ''),
                unsure: clueText(x.unsure || x.拿不准 || ''),
            });
    }
    return { items: map, missing: codes.filter((c) => !map.has(c)) };
}

export function answerMinusPublic(answer, publicText) {
    let a = String(answer || ''),
        pub = String(publicText || ''),
        mark = new Array(a.length).fill(!1);
    if (!pub) return a;
    for (let len = Math.min(12, a.length); len >= 4; len--)
        for (let i = 0; i + len <= a.length; i++) pub.includes(a.slice(i, i + len)) && mark.fill(!0, i, i + len);
    return [...a].map((ch, i) => (mark[i] ? '|' : ch)).join('');
}

export function factLabelWarnings({ label = '', criterion = '', unsure = '' }, ctx = {}, { secrets = [] } = {}) {
    // 每种取得方式的答案都要比对；公开文字取各条路自己的入口、地点、场景。
    let routes = [ctx, ...(ctx.routes || [])].filter((r) => r && r.answer),
        answers = routes.map((r) => answerMinusPublic(r.answer, [r.entry, r.place, r.scene].filter(Boolean).join('\n')));
    let out = [],
        hit = (t) => answers.map((a) => answerOverlap(t, a)).find(Boolean) || '';
    !label && out.push('还没有标签');
    !criterion && out.push('还没有登记口径');
    label && hit(label) && out.push(`标签里有答案的片段「${hit(label)}」`);
    criterion && hit(criterion) && out.push(`口径里有答案的片段「${hit(criterion)}」`);
    for (let s of secrets) s && s.length >= 2 && `${label} ${criterion}`.includes(s) && out.push(`出现了保密的名字「${s}」`);
    label && label.length > 12 && out.push('标签有点长，最好十个字以内');
    // 轻量提示（第五轮审阅 3c）：只认明确的否定说法；「才算」「之前」单独出现不算写清了什么不算。
    criterion &&
        !/不算|不计|不登记|不记|不能算|不能登记|没.{0,4}[开说读看到]|未.{0,2}[读看开]/.test(criterion) &&
        out.push('口径没写清楚什么情况不算（容易登记得太早）');
    unsure && out.push(`模型拿不准：${unsure}`);
    ctx.orphan && out.push('大纲里没有节点产出这个事实');
    return out;
}
