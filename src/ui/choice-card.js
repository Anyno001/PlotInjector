import { hostDocument, chatMessages, chatId, toast } from '../host/st.js';
import { esc, isNight, openDialog } from './dom.js';
import { CUSTOM, TIERS, endingInputs, previewEnv, pickEnding } from '../core/choice.js';
import { compileClue, conditionRefs, evalCondition, parseCondition, TRI } from '../core/clue-rules.js';
import { isClueMode } from '../core/clue-model.js';

// 抉择卡片：贴在酒馆输入框上方；骰子小标：用户消息名字旁。数据都来自 runtime.clue.choice.view()。

const DIE =
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="4"/><circle cx="9" cy="9" r=".9" fill="currentColor"/><circle cx="12" cy="12" r=".9" fill="currentColor"/><circle cx="15" cy="15" r=".9" fill="currentColor"/></svg>';
const PIPS = {
    1: [[12, 12]],
    2: [[8.5, 8.5], [15.5, 15.5]],
    3: [[8, 8], [12, 12], [16, 16]],
    4: [[8.5, 8.5], [15.5, 8.5], [8.5, 15.5], [15.5, 15.5]],
    5: [[8, 8], [16, 8], [12, 12], [8, 16], [16, 16]],
    6: [[8.5, 7.5], [15.5, 7.5], [8.5, 12], [15.5, 12], [8.5, 16.5], [15.5, 16.5]],
};
const face = (n) =>
    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round"><rect x="3" y="3" width="18" height="18" rx="4.5"/>${(PIPS[n] || []).map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.55" fill="currentColor" stroke="none"/>`).join('')}</svg>`;
export const DIE_ICON = DIE;

export function dicePopHtml(rec) {
    let mods = (rec.mods || []).map((m) => `${m.name} ${m.value > 0 ? '+' : ''}${m.value}`).join('，');
    return `<div class="pi-dice-faces">${face(rec.dice[0])}${face(rec.dice[1])}</div><div>${mods ? `<span class="pi-dice-g">${esc(mods)}</span><br>` : ''}合计 ${rec.total}，<span class="pi-dice-tier">${esc(rec.tier)}</span></div>`;
}

export function createChoiceCard(runtime) {
    const doc = hostDocument();
    let box = null,
        collapsed = new Set(),
        target = '',
        scope = '';
    const view = () => {
        try {
            return runtime.clue && runtime.clue.choice ? runtime.clue.choice.view() : null;
        } catch {
            return null;
        }
    };
    const input = () => doc.querySelector('#send_textarea');
    function mount() {
        let form = doc.querySelector('#send_form');
        if (!form || !form.parentNode) return null;
        if (!box || !box.isConnected) ((box = doc.createElement('div')), (box.className = 'pi-root pi-choice-slot'), form.parentNode.insertBefore(box, form));
        box.classList.toggle('is-night', isNight());
        return box;
    }
    function clear() {
        box && (box.innerHTML = '');
    }
    // 回复写完了：最后一条是有正文的回复
    function replyReady() {
        let chat = chatMessages(),
            last = chat[chat.length - 1];
        return !!last && !last.is_user && !last.is_system && String(last.mes || '').trim().length > 0;
    }
    function update() {
        let v = view();
        decorate(v);
        if (!v) return ((target = ''), (lastSentence = ''), clear());
        let key = `${chatId()}|${runtime.activeId ? runtime.activeId() : ''}`;
        key !== scope && ((scope = key), collapsed.clear(), (target = ''), (lastSentence = ''));
        let slot = mount();
        if (!slot) return;
        if (v.pending) return void (slot.innerHTML = pickedHtml(v));
        if (v.busy || !replyReady()) return clear();
        // 执行页点了「打开」的那一个优先；已经不可做了就忘掉它
        let want = target && v.open.find((o) => o.uid === target);
        target && !want && !(v.endingNode && v.endingNode.uid === target) && (target = '');
        let cur = want || (!target && v.open.find((o) => o.focus && !collapsed.has(o.uid)));
        if (cur) return void (slot.innerHTML = cardHtml(cur));
        let endOk = v.endingNode && v.endingCheck && !v.endingCheck.blocked,
            end = endOk && !v.filling && (target === v.endingNode.uid || !collapsed.has(`end:${v.endingNode.uid}`)) ? v.endingNode : null;
        slot.innerHTML = end ? endHtml(end) : '';
    }
    function cardHtml(o) {
        return `<div class="pi-choice" data-uid="${esc(o.uid)}">${o.choice.situation ? `<div class="pi-choice-sit">${esc(o.choice.situation)}</div>` : ''}${o.choice.options
            .map((x) => `<button type="button" class="pi-choice-opt" data-pick="${esc(x.id)}"><i>›</i>${esc(x.action)}</button>`)
            .join('')}<button type="button" class="pi-choice-opt is-own" data-pick="${CUSTOM}"><i>›</i>我有别的打算</button><div class="pi-choice-foot">${o.choice.final ? '<span class="pi-choice-final">做了决定就不能回头</span>' : ''}<button type="button" class="pi-choice-link" data-fold="${esc(o.uid)}">收起</button></div></div>`;
    }
    function endHtml(node) {
        return `<div class="pi-choice" data-end="${esc(node.uid)}"><div class="pi-choice-sit">这一切似乎快结束了……</div><button type="button" class="pi-choice-opt" data-arm-end="1"><i>›</i>结束这段故事</button><button type="button" class="pi-choice-opt is-own" data-fold="end:${esc(node.uid)}"><i>›</i>再待一会儿</button></div>`;
    }
    function pickedHtml(v) {
        let p = v.pending,
            o = p.kind === 'choice' && v.open.find((x) => x.uid === p.node),
            label = p.kind === 'ending' ? '结束这段故事' : p.option === CUSTOM ? '我有别的打算' : ((o && o.choice.options.find((x) => x.id === p.option)) || {}).action || '';
        return `<div class="pi-choice-picked">已选：<b>${esc(label)}</b><button type="button" class="pi-choice-link" data-cancel="1">取消</button></div>`;
    }
    let lastSentence = '';
    // 往输入框末尾追加一句（不覆盖玩家已写的）；取消时把这句去掉
    function fill(sentence) {
        let ta = input();
        lastSentence = typeof sentence === 'string' ? sentence : '';
        lastSentence && ta && ((ta.value = ta.value.trim() ? `${ta.value.replace(/\s+$/, '')}${lastSentence}` : lastSentence), ta.dispatchEvent(new ta.ownerDocument.defaultView.Event('input', { bubbles: !0 })), ta.focus());
    }
    function onClick(event) {
        let t = event.target.closest('[data-pick],[data-fold],[data-cancel],[data-arm-end]');
        if (!t || !box || !box.contains(t)) return;
        let c = runtime.clue.choice;
        if (t.dataset.fold) return (collapsed.add(t.dataset.fold), (target = ''), update());
        if (t.dataset.cancel) {
            let ta = input();
            (ta && lastSentence && ta.value.endsWith(lastSentence) && ((ta.value = ta.value.slice(0, -lastSentence.length).replace(/\s+$/, '')), ta.dispatchEvent(new ta.ownerDocument.defaultView.Event('input', { bubbles: !0 }))),
                (lastSentence = ''),
                c.cancel(),
                (target = ''));
            return update();
        }
        if (t.dataset.armEnd) return (fill(c.armEnding(!1)), update());
        fill(c.pick(t.closest('[data-uid]').dataset.uid, t.dataset.pick));
        update();
    }
    doc.addEventListener('click', onClick, !0);

    // 用户消息名字旁的骰子小标；点开在这条消息下面显示骰面和加值
    function decorate(v) {
        let want = new Map();
        v && v.done.forEach((x) => x.rec.dice && want.set(String(x.index), x.rec));
        for (let tag of doc.querySelectorAll('#chat .pi-dice-tag')) {
            let mes = tag.closest('.mes');
            (mes && want.has(mes.getAttribute('mesid'))) || (tag.remove(), mes && mes.querySelector('.pi-dice-pop')?.remove());
        }
        for (let [id, rec] of want) {
            let mes = doc.querySelector(`#chat .mes[mesid="${id}"]`),
                name = mes && mes.querySelector('.name_text');
            if (!name || mes.querySelector('.pi-dice-tag')) continue;
            let tag = doc.createElement('button');
            ((tag.type = 'button'), (tag.className = 'pi-dice-tag'), (tag.title = '查看这次行动的骰子'), (tag.innerHTML = DIE), name.after(tag));
            tag.addEventListener('click', (e) => {
                e.stopPropagation();
                let pop = mes.querySelector('.pi-dice-pop');
                if (pop) return pop.remove();
                pop = doc.createElement('div');
                ((pop.className = `pi-root pi-dice-pop${isNight() ? ' is-night' : ''}`), (pop.innerHTML = dicePopHtml(rec)));
                (mes.querySelector('.mes_text') || mes).after(pop);
            });
        }
    }
    function openCard(uid) {
        ((target = uid), collapsed.delete(uid), collapsed.delete(`end:${uid}`), update());
        mount() && box.firstElementChild ? box.scrollIntoView?.({ block: 'nearest' }) : toast('info', '回复生成完后，卡片会出现在输入框上方');
    }
    function destroy() {
        (doc.removeEventListener('click', onClick, !0), box && box.remove(), (box = null));
        for (let el of doc.querySelectorAll('#chat .pi-dice-tag, #chat .pi-dice-pop')) el.remove();
    }
    return { update, openCard, destroy, fill };
}

// 执行页「当前抉择」区块
export function choiceRunBlock(runtime) {
    let v = runtime.clue && runtime.clue.choice ? runtime.clue.choice.view() : null;
    if (!v || !v.has) return '';
    let rows = [
        ...v.open.map(
            (o) =>
                `<div class="pi-row"><b>${esc(o.name)}</b><span class="pi-hint">待决定</span><span class="pi-spacer"></span><button type="button" class="pi-btn is-sm" data-act="choice-open" data-uid="${esc(o.uid)}">打开</button><button type="button" class="pi-btn is-sm" data-act="choice-handled" data-uid="${esc(o.uid)}">标为已处理</button></div>`,
        ),
        ...v.done.map(
            (x) =>
                `<div class="pi-row"><b>${esc(x.name)}</b><span class="pi-hint">${x.rec.kind === 'custom' ? '自己的办法' : `已选：${esc(x.rec.action)}`}${x.rec.tier ? ` <button type="button" class="pi-dice-tag" data-act="choice-dice" title="查看骰子">${DIE}</button> ${esc(x.rec.tier)}` : ''}</span></div>${x.rec.dice ? `<div class="pi-dice-pop" hidden>${dicePopHtml(x.rec)}</div>` : ''}`,
        ),
    ];
    if (v.ending) rows.push(`<div class="pi-row"><b>收尾</b><span class="pi-hint">已收尾：${esc(v.ending.rec.ending)}</span></div>`);
    else if (v.endingNode && v.endingCheck && v.endingCheck.blocked)
        rows.push(
            `<div class="pi-row"><b>收尾</b><span class="pi-hint is-warn">这些依据读不到：${esc(v.endingCheck.gaps.join('、'))}</span><span class="pi-spacer"></span><button type="button" class="pi-btn is-sm" data-act="choice-end-accept">按现有记录收尾</button></div>`,
        );
    else if (v.endingNode && v.filling) rows.push(`<div class="pi-row"><b>收尾</b><span class="pi-hint">等这一轮填完表</span></div>`);
    else if (v.endingNode) rows.push(`<div class="pi-row"><b>收尾</b><span class="pi-hint">可以收尾</span><span class="pi-spacer"></span><button type="button" class="pi-btn is-sm" data-act="choice-open" data-uid="${esc(v.endingNode.uid)}">打开</button></div>`);
    let attrs = v.attrs.length ? `<p class="pi-hint">属性：${v.attrs.map((a) => `${esc(a.name)} ${a.value == null ? `读不到（${esc(a.why || '')}）` : a.value > 0 ? `+${a.value}` : a.value}`).join('，')}</p>` : '';
    return `<div class="pi-card"><h3>当前抉择<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="choice-attrs">属性…</button></h3>${attrs}${rows.length ? `<div class="pi-rl-stack">${rows.join('')}</div>` : '<p class="pi-hint">现在没有待决定的抉择。</p>'}</div>`;
}

export const choiceRunActions = {
    'choice-dice'(view, target) {
        let pop = target.closest('.pi-row') && target.closest('.pi-row').nextElementSibling;
        pop && pop.classList.contains('pi-dice-pop') && (pop.hidden = !pop.hidden);
    },
    // 属性：名字和读表路径存在项目里；没填路径的，本聊天的值在这里设（-1 到 +3）
    async 'choice-attrs'(view) {
        let p = view.project(),
            v = view.runtime.clue.choice.view();
        if (!p || !v) return;
        let rows = [...p.clue.attrs, { 名: '', 路径: '' }],
            cur = Object.fromEntries(v.attrs.map((a) => [a.name, a.value])),
            sel = (name) => `<select class="pi-inp" data-attr-val="${esc(name)}">${[-1, 0, 1, 2, 3].map((n) => `<option value="${n}"${(cur[name] ?? 0) === n ? ' selected' : ''}>${n > 0 ? `+${n}` : n}</option>`).join('')}</select>`,
            picked = await openDialog({
                title: '属性',
                html: `<p class="pi-hint">行动写「用: 属性名」时，掷骰加上这个属性（-1 到 +3）。填了表格路径（如 属性表/主角/口才）就读表，没填就按本聊天设的值。最多 5 个。</p>
                ${rows.map((a, i) => `<div class="pi-row"><input class="pi-inp" data-attr-name="${i}" placeholder="属性名" value="${esc(a.名)}"><input class="pi-inp" data-attr-path="${i}" placeholder="表格路径（可空）" value="${esc(a.路径)}">${a.名 && !a.路径 ? sel(a.名) : ''}</div>`).join('')}`,
                actions: [
                    { label: '取消', value: null },
                    {
                        label: '保存',
                        primary: !0,
                        value: (root) => ({
                            list: rows.map((_, i) => ({ 名: root.querySelector(`[data-attr-name="${i}"]`).value.trim(), 路径: root.querySelector(`[data-attr-path="${i}"]`).value.trim() })).filter((a) => a.名),
                            vals: [...root.querySelectorAll('[data-attr-val]')].map((el) => [el.dataset.attrVal, el.value]),
                        }),
                    },
                ],
            });
        if (!picked) return;
        view.data.updateProject(p.id, (x) => ({ ...x, clue: { ...x.clue, attrs: picked.list } }));
        for (let [name, value] of picked.vals) view.runtime.clue.choice.setAttr(name, value);
        (view.runtime.clue.invalidate(), view.renderBody());
    },
    'choice-open'(view, target) {
        view.choiceCard && view.choiceCard.openCard(target.dataset.uid);
    },
    'choice-handled'(view, target) {
        view.runtime.clue.choice.handled(target.dataset.uid) ? (view.choiceCard && view.choiceCard.update(), view.renderBody()) : toast('info', '这个抉择已经有记录了');
    },
    'choice-end-accept'(view) {
        let s = view.runtime.clue.choice.armEnding(!0);
        if (!s) return toast('info', '数据库还在填表，填完再收尾');
        view.choiceCard && (view.choiceCard.fill(s), view.choiceCard.update());
    },
};

// ---------- 结局预览（大纲页，作者用）：假设各种情况，看会落到哪个结局；和正式收尾用同一套求值 ----------
export function endingPreviewable(view) {
    let p = view.project();
    return !!p && !!view.data.settings().choiceLab && isClueMode(p) && compileClue(p.outline.volumes).nodes.some((n) => n.ending);
}
export async function endingPreview(view) {
    let comp = compileClue(view.project().outline.volumes),
        ends = comp.nodes.filter((n) => n.ending),
        node = ends[0];
    if (!node) return toast('info', '大纲里没有带「收尾」的节点');
    let inp = endingInputs(node, conditionRefs),
        byUid = new Map(comp.nodes.map((n) => [n.uid, n])),
        tierSel = (uid) => `<select class="pi-inp" data-pv-tier="${esc(uid)}"><option value="">（不掷骰）</option>${TIERS.map((t) => `<option>${t}</option>`).join('')}</select>`,
        choiceRow = (uid) => {
            let n = byUid.get(uid);
            return n && n.choice
                ? `<div class="pi-row"><span>${esc(n.name)}</span><select class="pi-inp" data-pv-choice="${esc(uid)}"><option value="">还没做</option>${n.choice.options.map((o) => `<option value="${esc(o.id)}">${esc(o.action)}</option>`).join('')}<option value="${CUSTOM}">自己的办法</option></select>${tierSel(uid)}</div>`
                : '';
        },
        html = `<p class="pi-hint">勾选假设的情况，下面实时显示会落到哪个结局。只在这里算，不写进聊天和表格。</p>
        ${inp.choices.map(choiceRow).join('')}
        ${inp.facts.length ? `<p class="pi-hint">拿到的线索：</p>${inp.facts.map((f) => `<label class="pi-check"><input type="checkbox" data-pv-fact="${esc(f)}"><span>${esc(f)}</span></label>`).join('')}` : ''}
        ${inp.nodes.length ? `<p class="pi-hint">完成的节点：</p>${inp.nodes.map((u) => `<label class="pi-check"><input type="checkbox" data-pv-node="${esc(u)}"><span>${esc((byUid.get(u) || {}).name || u)}</span></label>`).join('')}` : ''}
        ${inp.cells.map((raw) => `<div class="pi-row"><span>${esc(raw)}</span><select class="pi-inp" data-pv-cell="${esc(raw)}"><option value="no">不满足</option><option value="yes">满足</option><option value="unknown">读不到</option></select></div>`).join('')}
        <div class="pi-card" data-pv-out></div>`,
        read = (root) => ({
            facts: new Set([...root.querySelectorAll('[data-pv-fact]:checked')].map((x) => x.dataset.pvFact)),
            nodes: new Set([...root.querySelectorAll('[data-pv-node]:checked')].map((x) => x.dataset.pvNode)),
            choices: Object.fromEntries(
                [...root.querySelectorAll('[data-pv-choice]')].map((x) => [x.dataset.pvChoice, { option: x.value, tier: root.querySelector(`[data-pv-tier="${x.dataset.pvChoice}"]`).value }]),
            ),
            cells: Object.fromEntries([...root.querySelectorAll('[data-pv-cell]')].map((x) => [x.dataset.pvCell, x.value])),
        }),
        show = (root) => {
            let env = previewEnv(read(root)),
                tri = (when) => {
                    let v = evalCondition(parseCondition(when), env).v;
                    return v === TRI.t ? 'yes' : v === TRI.f ? 'no' : 'unknown';
                },
                r = pickEnding(node.ending, tri, !1),
                out = root.querySelector('[data-pv-out]');
            out.innerHTML = r.blocked
                ? `<p class="pi-hint is-warn">有依据读不到（${esc(r.gaps.join('、'))}），正式收尾时会停下来，等玩家修好或选「按现有记录收尾」。</p>`
                : `<h3>${esc(r.name)}</h3>${r.point ? `<p>${esc(r.point)}</p>` : ''}${r.segments.map((x) => `<p class="pi-hint">${esc(x.name)}：${esc(x.point)}</p>`).join('')}`;
        };
    await openDialog({
        title: `结局预览：${node.name}`,
        html,
        onMount: (root) => (show(root), root.addEventListener('change', () => show(root))),
        actions: [{ label: '关闭', value: null, primary: !0 }],
    });
}

// 写大纲的 AI 要不要拿到抉择写法：实验开关打开、线索模式、不是跑团
export function choiceRules(view, project) {
    return !!view.data.settings().choiceLab && isClueMode(project) && !(project && project.trpg && project.trpg.on);
}
