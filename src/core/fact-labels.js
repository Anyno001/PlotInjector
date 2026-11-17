import { lineTriggerFacts, compileClue } from './clue-rules.js';
import { prebuildPlan, discoveryList, clueText, answerOverlap } from './clue-project.js';

import { isPlainObject, stageLabel } from './outline.js';

import { parseYaml } from './yaml.js';
import { extractYaml } from './prompts.js';

export function factLabelContext(volumes, codes = null) {
    let compiled = compileClue(volumes || []),
        want = codes ? new Set(codes) : null,
        out = /* @__PURE__ */ new Map();
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
    let note = (cond, where) => {
            if (cond) {
                if (cond.kind === 'group') return cond.items.forEach((x) => note(x, where));
                (cond.kind !== 'fact' && cond.kind !== 'know') ||
                    (want && !want.has(cond.fact)) ||
                    (out.has(cond.fact) ||
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
                        }),
                    out
                        .get(cond.fact)
                        .usedBy.push(
                            `${where}（${cond.kind === 'know' ? `${cond.verified ? '核实' : '知情'}@${cond.actor}` : cond.verified ? '核实' : '事实'}）`,
                        ));
            }
        },
        byId = new Map((compiled.lines || []).map((l) => [l.id, l]));
    for (let [f, ids] of lineTriggerFacts(compiled)) {
        if ((want && !want.has(f)) || out.has(f)) continue;
        let l = byId.get(ids[0]);
        out.set(f, {
            code: f,
            node: '',
            nodeName: `线 ${ids.join('、')}「${l.name}」开启前要发生的事`,
            entry: l.entryHint,
            place: '',
            scene: l.brief,
            answer: '',
            // 作者对开启条件的原话（「原开启条件」）：这件事最直接的说明（实测：AI 新建的开启事实没有别的说明）
            record: l.origCond || '',
            stage: '',
            routes: [],
            usedBy: [`线 ${ids.join('、')} 的开启条件（正文里发生这件事时登记）`],
            opening: l.id,
        });
    }
    for (let u of compiled.units)
        u.clue && (note(u.clue.enter, `${stageLabel(u.stage.key)}的进入条件`), note(u.clue.end, `${stageLabel(u.stage.key)}的结束条件`));
    for (let l of compiled.lines || []) note(l.open, `线 ${l.id} 的开启条件`);
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
        block = items.map((x) =>
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
                    ].filter(Boolean).join(`
`),
                ),
                x.usedBy.length && `  被这些条件用到: ${x.usedBy.join('；')}`,
                x.orphan && '  注意：大纲里没有节点产出这个事实',
            ].filter(Boolean).join(`
`),
        ).join(`
`);
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
                '   · 表格的状态只有「已核实」「存疑」两种可写。材料里写的「传闻」「推测」「听说」「证词」，口径里一律写成「记为存疑」，不要写「记为传闻」「记为推测」。',
                '   · 判断、结论类的（如「证词被推翻」）：口径写「读到某样东西之后，正文里明确说出这个判断时登记」，不要把判断的具体内容写进去（不写推翻了谁、跟什么无关）。',
                '   · 一条事实有「另一种取得方式」的：口径要把每种方式都包括进去（如「读到物流单上的地址，或证人当面说出地址时登记」），不要只写一种，否则走另一条路的玩家永远登记不上。一种是说法、一种是实物时，可以写「先记为存疑，拿到实物后改为已核实」。',
                '   · 被条件用作「核实」的，口径要写到被证实的那一步；只用作「事实」的，写到正文里出现即可。',
                '   · 作者登记标准里只说形式、位置、不说内容的细节要保留（如「背面那行铅笔字」「信封上的邮戳」「抽屉最底层的单据」），口径才卡得准是哪一步；不要写成「亲眼看清时」这种看到什么都算的说法。',
                '   · 口径不能和大纲的取得方式冲突：大纲里是某人当面说出的，不要要求拆开、读到原件；东西在场景里本来就没打开的，不要把「没打开」写成不算。',
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
            ].filter(Boolean).join(`
`),
        },
        {
            role: 'user',
            content: `【事实】
${block}`,
        },
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

// 「记为 X」里 X 不是表格认的状态（已核实 / 存疑 / 未获得）
const STATUS_WORD = /记为[「“"]?(?!已核实|存疑|未获得)([一-鿿]{2,4}?)(?=[」”"，,。；;、）)]|$)/;
export function factLabelCheck({ label = '', criterion = '', unsure = '' }, ctx = {}, { secrets = [] } = {}) {
    let routes = [ctx, ...(ctx.routes || [])].filter((r) => r && r.answer),
        answers = routes.map((r) =>
            answerMinusPublic(
                r.answer,
                [r.entry, r.place, r.scene].filter(Boolean).join(`
`),
            ),
        ),
        warns = [],
        suspects = [],
        notes = [],
        hit = (t) => answers.map((a) => answerOverlap(t, a)).find(Boolean) || '';
    (!label && warns.push('还没有标签'),
        !criterion && warns.push('还没有登记口径'),
        label && hit(label) && suspects.push({ where: '标签', piece: hit(label) }),
        criterion && hit(criterion) && suspects.push({ where: '口径', piece: hit(criterion) }));
    for (let s of secrets) s && s.length >= 2 && `${label} ${criterion}`.includes(s) && warns.push(`出现了保密的名字「${s}」`);
    return (
        label && label.length > 12 && warns.push('标签有点长，最好十个字以内'),
        criterion &&
            !/不算|不计|不登记|不记|不能算|不能登记|没.{0,4}[开说读看到]|未.{0,2}[读看开]/.test(criterion) &&
            warns.push('口径没写清楚什么情况不算（容易登记得太早）'),
        // 表格的状态只有「未获得 / 已核实 / 存疑」：口径写成「记为传闻 / 推测」，填表模型可能写错或干脆不登记（用户 2026-11-17 实测）
        criterion &&
            (STATUS_WORD.exec(criterion) || [])[1] &&
            warns.push(`口径写了「记为${STATUS_WORD.exec(criterion)[1]}」，表格只有「已核实」「存疑」两种，请改成「记为存疑」`),
        unsure && notes.push(unsure),
        ctx.orphan && warns.push('大纲里没有节点产出这个事实'),
        { warns, suspects, notes }
    );
}

export function factLabelReviewMessages(items) {
    let fence = '```',
        block = items.map((x) =>
            [
                `- 编号: ${x.code}`,
                x.entry && `  入口（正文本来就看得到）: ${x.entry}`,
                x.scene && `  场景（正文本来就看得到）: ${x.scene}`,
                `  答案（填表模型不该提前知道）: ${x.answer}`,
                x.record && `  作者写的登记标准（可能含答案，不能照抄；用来判断口径哪些门槛必须保留）: ${x.record}`,
                `  标签: ${x.label}`,
                `  口径: ${x.criterion}`,
                x.pieces && x.pieces.length && `  和答案字面重合的片段: ${x.pieces.join('、')}`,
            ].filter(Boolean).join(`
`),
        ).join(`
`);
    return [
        {
            role: 'system',
            content: [
                '你在检查剧情线索的「标签」和「登记口径」有没有剧透。它们每一楼都会发给填表模型，填表模型在主角查到之前，不该从这两样里知道答案。',
                '按这三步判断：',
                '1. 把答案拆成具体的信息点：谁、什么东西、什么状态、什么结论、什么关系、数字、地点。「A 和 B 有关系」本身就是一个信息点，哪怕没说是什么关系。',
                '2. 去掉入口、场景里本来就写明的信息点（正文看得到，不算秘密）。',
                '3. 剩下的信息点里，有没有任何一个出现在标签或口径里（原话、换个说法、或者说得更笼统但缩小了范围，都算）？有 → 透露了；没有 → 没透露。',
                '   「缩小了范围」：答案是「二少爷端的汤」，口径写「府上一位少爷端的」，虽然没点名，但把嫌疑从所有人缩到少爷们，算透露。只说「谁端的」不缩小范围。',
                '例：答案「柜台后的地板有一块是新换的，下面传出敲击声」，入口只说去当铺。信息点「新换的地板」「下面有敲击声」都不在入口里；口径写「发现新换的地板、听到敲击声时登记」→ 透露。标签写「当铺地窖」也透露（敲击声暗示下面有地窖）。',
                '例：答案「脚夫说林掌柜以前在永昌号上当过账房」，入口只说去茶馆。口径写「有人说出林掌柜和永昌号的旧关系时登记」→ 透露：把林掌柜和永昌号连在一起，就是答案的核心。改成「有人当面说起某位熟人的旧事时登记」。',
                '例：答案「原件推翻了老韩证词的指向——帆布包和这批货无关」。口径写「读到原件、正文里明确说出这个判断时登记」→ 没透露：「这个判断」是泛指，没说判断的内容。口径写「确认帆布包和货无关时登记」→ 透露。',
                '下面这些不是信息点，出现了也不算透露：',
                '· 取得的动作和场合：「当面问」「同一次问话里」「打开抽屉」「读到原件」「走到后门」；',
                '· 登记的门槛：「看清」「明确说出」「只看到锁着的抽屉不算」「没松口不算」；',
                '· 泛指的话题：「痕迹」「单据」「说法」「证词」「判断」「情形」「来历」「内容」——只说是关于什么，不说是什么；',
                '· 东西的形式和位置：「背面那行铅笔字」「信封上的字」「抽屉最底层」——只说字在哪里、是什么样子，不说写的是什么、指向谁；',
                '  但如果位置、形态本身就是要查出来的答案，它就是信息点：答案是「账本藏在抽屉底板下的夹层里」，口径写「发现抽屉底板下的夹层时登记」→ 透露，改成「发现抽屉里隐藏的地方时登记」；答案是「门上那片暗色其实是血迹」，口径写「认出那是血迹时」→ 透露，改成「辨认出门上那片痕迹是什么时」；',
                '· 入口、场景里本来就写着的东西：场景写了「手里捏着一封没拆的信」，「信」「没拆」就不是秘密。',
                '答案本身就是「看不清」「辨不出是谁的」这种否定的结果时（比如「鞋印模糊，看不出是谁的」），口径用它作为登记门槛不算透露：它没有给出指向任何人或事的新信息。',
                '透露了的，给一个改好的版本：只去掉答案内容，其余照原样保留——',
                '· 不改取得方式：原来是当面说出的，不要改成读到原件；有两条取得途径的（「读到单据，或证人说出」），两条都要留着；',
                '· 不删登记门槛：照片上有好几处字时，「背面那行铅笔字」就是区分「拿到」和「没拿到」的门槛，不能改成「看清上面的字」这种看到什么字都算的说法。作者登记标准里写到的位置、形式，只要不是答案本身，都要留；',
                '没透露的不用改。',
                `只输出一个 ${fence}yaml 代码块：`,
                `${fence}yaml`,
                '- 编号: F_xxx',
                '  透露: 否',
                '- 编号: F_yyy',
                '  透露: 是',
                '  透露了什么: 一句话',
                '  改成标签: …   # 标签没问题就省略',
                '  改成口径: …   # 口径没问题就省略',
                fence,
                '每个编号都要输出，编号原样照抄。',
            ].join(`
`),
        },
        {
            role: 'user',
            content: `【要检查的】
${block}`,
        },
    ];
}

export function parseFactLabelReview(text, codes) {
    let list;
    try {
        list = parseYaml(extractYaml(text));
    } catch {
        list = null;
    }
    let map = /* @__PURE__ */ new Map();
    for (let x of Array.isArray(list) ? list : []) {
        if (!isPlainObject(x)) continue;
        let code = String(x.编号 || '').trim(),
            v = String(x.透露 ?? '').trim();
        !code ||
            !codes.includes(code) ||
            map.has(code) ||
            map.set(code, {
                leak: /^(是|yes|true)$/i.test(v) ? !0 : /^(否|no|false)$/i.test(v) ? !1 : null,
                what: clueText(x.透露了什么 || ''),
                label: clueText(x.改成标签 || ''),
                criterion: clueText(x.改成口径 || ''),
            });
    }
    return map;
}

export function factLabelSig(x) {
    let s = [
            x.answer,
            x.record,
            x.entry,
            x.scene,
            ...(x.routes || []).map((r) => `${r.answer}|${r.record}|${r.entry}`),
            ...(x.usedBy || []).slice().sort(),
        ]
            .map((p) => String(p || ''))
            .join(''),
        h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0;
    return `${s.length}:${h.toString(36)}`;
}

export function labelsToPrepare(volumes, stored = {}) {
    let plan = prebuildPlan(volumes),
        ctx = new Map(
            factLabelContext(
                volumes,
                plan.facts.map((f) => f.code),
            ).map((x) => [x.code, x]),
        );
    return plan.facts
        .map((f) => {
            let c = ctx.get(f.code) || { code: f.code, usedBy: [], orphan: !0 },
                sig = factLabelSig(c),
                have = stored[f.code];
            return have && have.label && have.sig === sig ? null : { code: f.code, sig, ctx: c };
        })
        .filter(Boolean);
}
