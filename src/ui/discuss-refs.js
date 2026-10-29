import { acuField, groupByField } from '../core/acu.js';
import { buildIndexText } from '../core/inject.js';
import { flattenUnits, outlineToText, stageLabel, volumeLabel } from '../core/outline.js';
import { unitStates } from '../core/progress.js';
import { checkedSet, entryRefId, fieldChecked, isMemoField, ruleFromSelection } from '../core/refs.js';
import { estimateTokens } from '../core/tokens.js';
import { bookEntries, boundBookNames, loadBook } from '../host/worldbook.js';
import { esc, openDialog } from './dom.js';
import { ICONS } from './styles.js';

// 讨论页「附带参考」：设定、大纲、剧情进度、最近正文、世界书条目。
// 世界书条目按规则选（见 core/refs.js），顶栏只显示条数，不逐条铺开。

export async function loadBoundBooks() {
    const out = [];
    for (const book of boundBookNames()) {
        try {
            out.push({ name: book.name, source: book.source, entries: bookEntries(await loadBook(book.name)) });
        } catch {
            out.push({ name: book.name, source: book.source, entries: [], error: true });
        }
    }
    return out;
}

// 剧情进度只在本项目是当前聊天启用的项目时有意义（进度随聊天保存）。
export function progressText(view) {
    if (view.runtime.activeId() !== view.projectId) return '';
    const project = view.project();
    const units = flattenUnits(project.outline.volumes);
    if (!units.length) return '';
    const progress = view.runtime.progress();
    return buildIndexText(units, unitStates(units, progress), progress, { carryOver: view.data.settings().carryOver });
}

export function floorsText(view, count) {
    if (!count) return '';
    return view.runtime.recentFloors(count).map(floor => `【第 ${floor.index} 楼】\n${floor.text}`).join('\n\n');
}

export async function resolveRefs(view, chat, project) {
    const refs = [];
    const r = chat.refs;
    if (r.setting && project.setting.text.trim()) refs.push({ title: '当前设定', text: project.setting.text });
    if (r.outline && project.outline.volumes.length) {
        const text = outlineToText(project.outline.volumes);
        refs.push({ title: '当前大纲', text: text.length < 12000 ? text : flattenUnits(project.outline.volumes).map(unit => `${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}`).join('\n') });
    }
    if (r.progress) {
        const text = progressText(view);
        if (text) refs.push({ title: '剧情进度（已演、进行中与之后的阶段）', text });
    }
    const floors = floorsText(view, r.floors);
    if (floors) refs.push({ title: `最近 ${r.floors} 楼正文`, text: floors });
    const books = await loadBoundBooks();
    const checked = checkedSet(r.wb, books, r.memo);
    for (const book of books) {
        for (const entry of book.entries) if (checked.has(entryRefId(book.name, entry)) && entry.content.trim()) refs.push({ title: entry.title, text: entry.content });
    }
    return refs;
}

// 顶栏显示的世界书条数与 token，异步算好后缓存，规则变了才重算。
export function wbSummary(view, chat, rerender) {
    const s = view.tabState('discuss');
    const sig = JSON.stringify([view.projectId, chat.refs.wb, chat.refs.memo]);
    if (s.wbSig === sig) return s.wbSum;
    if (s.wbPending !== sig) {
        s.wbPending = sig;
        loadBoundBooks().then(books => {
            const checked = checkedSet(chat.refs.wb, books, chat.refs.memo);
            let count = 0;
            let tokens = 0;
            for (const book of books) for (const entry of book.entries) if (checked.has(entryRefId(book.name, entry))) { count += 1; tokens += estimateTokens(entry.content); }
            s.wbSig = sig;
            s.wbSum = { count, tokens, books: books.length };
            rerender();
        }).catch(() => {});
    }
    return s.wbSum || null;
}

const row = (id, entry, on, extra = '') => `<label class="pi-wb-row${entry.disabled ? ' is-off' : ''}"><input type="checkbox" data-ref-id="${esc(id)}"${extra}${on ? ' checked' : ''}>
    <span class="pi-wb-title" title="${esc(entry.title)}">${esc(entry.title)}</span>${entry.disabled ? '<span class="pi-badge">世界书已关闭</span>' : ''}</label>`;

function pickerHtml(books, rule, memo) {
    const checked = checkedSet(rule, books, memo);
    return books.map(book => {
        const hand = book.entries.filter(entry => !acuField(entry.title));
        const fields = groupByField(book.entries);
        const handHtml = hand.length ? `<div class="pi-wb-sec"><div class="pi-wb-sec-hd">世界书条目<small>${hand.length}</small><span class="pi-wb-bulk">
                <button type="button" class="pi-btn is-sm is-ghost" data-ref-all="${esc(book.name)}" data-on="1">全选</button>
                <button type="button" class="pi-btn is-sm is-ghost" data-ref-all="${esc(book.name)}" data-on="0">全不选</button></span></div>
            ${hand.map(entry => row(entryRefId(book.name, entry), entry, checked.has(entryRefId(book.name, entry)), ` data-ref-hand="${esc(book.name)}"`)).join('')}</div>` : '';
        const acuHtml = fields.length ? `<div class="pi-wb-sec"><div class="pi-wb-sec-hd">数据库条目<small>${fields.reduce((sum, [, list]) => sum + list.length, 0)}</small></div>
            ${fields.map(([field, list]) => {
                const memoField = isMemoField(field);
                const lead = memoField ? '<span class="pi-wb-pad"></span>' : `<input type="checkbox" data-ref-field="${esc(field)}"${fieldChecked(rule, field) ? ' checked' : ''}>`;
                const memoBox = memoField ? `<span class="pi-wb-memo">最近<input class="pi-inp is-num" type="number" min="0" data-ref-memo value="${memo}">条</span>` : '';
                return `<div class="pi-wb-sub"><div class="pi-wb-sub-hd">${lead}<button type="button" class="pi-wb-name" data-ref-fold>${ICONS.caret}<span class="pi-wb-field">${esc(field)}</span><small>${list.length}</small></button>${memoBox}</div>
                    <div class="pi-wb-fold" hidden>${list.map(entry => row(entryRefId(book.name, entry), entry, checked.has(entryRefId(book.name, entry)), ` data-ref-of="${esc(field)}"${memoField ? ' data-ref-memo-row' : ''}`)).join('')}</div></div>`;
            }).join('')}</div>` : '';
        return `<div class="pi-ref-book"><p class="pi-hint"><b>${esc(book.name)}</b> <span class="pi-badge">${esc(book.source)}</span></p>${handHtml}${acuHtml || ''}${!hand.length && !fields.length ? '<p class="pi-hint">没有条目</p>' : ''}</div>`;
    }).join('');
}

// 弹窗：手写条目默认全选、可逐条去掉；数据库条目默认收起，纪要按「最近 N 条」，其他字段整体勾选。
export async function pickRefs(chat) {
    const books = await loadBoundBooks();
    if (!books.length) return { none: true };
    const memoRows = box => [...box.querySelectorAll('[data-ref-memo-row]')];
    const rowNo = input => Number((/-(\d+)$/.exec(input.closest('label').querySelector('.pi-wb-title').textContent) || [])[1] ?? -1);
    const result = await openDialog({
        title: '附带的世界书条目',
        html: `<p class="pi-hint" data-ref-sum></p><div class="pi-ref-list">${pickerHtml(books, chat.refs.wb, chat.refs.memo)}</div>`,
        actions: [{ label: '取消', value: null }, {
            label: '确定', primary: true, value: box => {
                const fields = {};
                box.querySelectorAll('[data-ref-field]').forEach(input => { fields[input.dataset.refField] = input.checked; });
                const memoInput = box.querySelector('[data-ref-memo]');
                const memo = memoInput ? Math.max(0, Math.round(Number(memoInput.value) || 0)) : chat.refs.memo;
                const checked = new Set([...box.querySelectorAll('[data-ref-id]:checked')].map(input => input.dataset.refId));
                return { memo, wb: ruleFromSelection(books, fields, checked, memo) };
            },
        }],
        onMount(box) {
            const byId = new Map();
            for (const book of books) for (const entry of book.entries) byId.set(entryRefId(book.name, entry), entry);
            const sum = () => {
                const ids = [...box.querySelectorAll('[data-ref-id]:checked')].map(input => input.dataset.refId);
                const tokens = ids.reduce((total, id) => total + estimateTokens(byId.get(id)?.content || ''), 0);
                box.querySelector('[data-ref-sum]').textContent = `已选 ${ids.length} 条，约 ${tokens} token`;
            };
            const applyMemo = () => {
                const n = Math.max(0, Math.round(Number(box.querySelector('[data-ref-memo]')?.value) || 0));
                // 每本世界书各取最新 n 条，与 core/refs.js 的默认规则一致
                for (const book of box.querySelectorAll('.pi-ref-book')) memoRows(book).sort((a, b) => rowNo(b) - rowNo(a)).forEach((input, i) => { input.checked = i < n; });
            };
            box.addEventListener('click', event => {
                const fold = event.target.closest('[data-ref-fold]');
                if (fold) {
                    const body = fold.closest('.pi-wb-sub').querySelector('.pi-wb-fold');
                    body.hidden = !body.hidden;
                    fold.querySelector('svg').outerHTML = body.hidden ? ICONS.caret : ICONS.caretDown;
                    return;
                }
                const all = event.target.closest('[data-ref-all]');
                if (all) {
                    [...box.querySelectorAll('[data-ref-hand]')].filter(input => input.dataset.refHand === all.dataset.refAll).forEach(input => { input.checked = all.dataset.on === '1'; });
                    sum();
                }
            });
            box.addEventListener('change', event => {
                const field = event.target.dataset.refField;
                if (field !== undefined) [...box.querySelectorAll('[data-ref-of]')].filter(input => input.dataset.refOf === field).forEach(input => { input.checked = event.target.checked; });
                sum();
            });
            box.addEventListener('input', event => {
                if (event.target.matches('[data-ref-memo]')) { applyMemo(); sum(); }
            });
            sum();
        },
    });
    return result;
}

