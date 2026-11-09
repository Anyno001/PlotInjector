import { acuField } from '../core/acu.js';
import { applyPlan, buildPlan, hasIf, releaseImported } from '../core/persona-import.js';
import { normalizePersonas } from '../core/personas.js';
import { estimateTokens } from '../core/tokens.js';
import { toast } from '../host/st.js';
import { bookEntries, boundBookNames, globalBookNames, loadBook, setEntriesDisabled } from '../host/worldbook.js';
import { esc, openDialog, options } from './dom.js';

// 世界书转入人设：只列启用世界书里含 <if cell> 的手写条目，默认全不勾；预览拆分结果后转入，原条目只关不删。

async function loadCandidates() {
    const names = [...new Set([...boundBookNames().map(item => item.name), ...globalBookNames()])];
    const books = [];
    for (const name of names) {
        try {
            const entries = bookEntries(await loadBook(name)).filter(entry => !entry.disabled && !acuField(entry.title) && hasIf(entry.content)).map(entry => ({ ...entry, book: name }));
            if (entries.length) books.push({ name, entries });
        } catch { /* 读不到的书跳过 */ }
    }
    return books;
}

const idOf = entry => `${entry.book}\u0000${entry.key}`;

function listHtml(books, picked) {
    if (!books.length) return '<p class="pi-hint">当前启用的世界书里没有含 if 条件的手写条目。</p>';
    return books.map(book => {
        const all = book.entries.every(entry => picked.has(idOf(entry)));
        return `<div class="pi-wb-sec"><div class="pi-wb-sec-hd">${esc(book.name)}<small>${book.entries.length}</small>
            <span class="pi-wb-bulk"><button type="button" class="pi-btn is-sm is-ghost" data-pi-all="${esc(book.name)}">${all ? '取消全选' : '全选'}</button></span></div>
            ${book.entries.map(entry => `<label class="pi-wb-row"><input type="checkbox" data-pi-pick="${esc(entry.key)}" data-pi-book="${esc(entry.book)}"${picked.has(idOf(entry)) ? ' checked' : ''}>
                <span class="pi-wb-title" title="${esc(entry.title)}">${esc(entry.title)}</span><span class="pi-meta">≈${estimateTokens(entry.content)}</span></label>`).join('')}</div>`;
    }).join('');
}

// 每个变量一个下拉：写死为某值（转入时只留这段文字）或拆成阶段（嵌套在别的阶段里的只能写死）。
function varChoices(item) {
    const fix = item.values.map(value => ({ value: `fix:${value}`, label: `写死为 ${value}` }));
    const line = item.canLine ? [{ value: 'line', label: '拆成阶段' }] : [];
    return item.kind === 'fixed' ? [...fix, ...line] : [...line, ...fix];
}

function previewHtml(plan) {
    const issues = plan.issues.map(issue => `<p class="pi-hint is-warn">${esc(issue.title)}：${esc(issue.text)}</p>`).join('');
    const lines = plan.lines.map(line => `<div class="pi-wb-hit"><span class="pi-wb-title">${esc(line.group ? `${line.group} · ` : '')}${esc(line.name)}</span>
        <span class="pi-meta">${line.mode === 'fame' ? '读声望' : line.mode === 'check' ? '条件检测' : '手动'} · ${line.stages.length} 阶段</span></div>`).join('');
    const vars = plan.vars.filter(item => item.kind !== 'num').map(item => `<div class="pi-wb-hit"><span class="pi-wb-title" title="${esc(item.path)}">${esc(item.name)}</span>
        <select class="pi-sel" data-pi-kind="${esc(item.path)}">${options(varChoices(item), item.kind === 'fixed' ? `fix:${item.pick}` : 'line')}</select></div>`).join('');
    return `${issues}
        <div class="pi-wb-sec-hd">人设线<small>${plan.lines.length}</small></div>${lines || '<p class="pi-hint">没有可转入的内容。</p>'}
        ${vars ? `<div class="pi-wb-sec-hd">变量识别（可改判）</div>${vars}` : ''}`;
}

// 返回是否有转入。
export async function openImport(view) {
    const project = view.project();
    if (!project) { toast('info', '先选择一个项目。'); return false; }
    let books = [];
    try {
        books = await loadCandidates();
    } catch (error) {
        toast('error', `读取世界书失败：${error.message}`);
        return false;
    }
    const all = books.flatMap(book => book.entries);
    const picked = new Set();
    let overrides = {};
    let picks = {};
    let step = 'list';
    const chosen = () => all.filter(entry => picked.has(idOf(entry)));
    const plan = () => buildPlan(chosen(), { overrides, picks });
    const draw = box => {
        const body = box.querySelector('[data-f=body]');
        body.innerHTML = step === 'list' ? listHtml(books, picked) : previewHtml(plan());
        box.querySelector('[data-f=count]').textContent = step === 'list' ? `已选 ${picked.size} 条` : '预览';
        for (const btn of box.querySelectorAll('[data-dlg]')) {
            if (btn.textContent === '返回选择' || btn.textContent === '转入') btn.hidden = step === 'list';
            if (btn.textContent === '预览') btn.hidden = step !== 'list';
        }
    };
    const result = await openDialog({
        title: '从世界书转入人设',
        html: `<p class="pi-hint is-warn" data-f="count"></p><div data-f="body"></div>`,
        onMount: box => {
            draw(box);
            box.addEventListener('change', event => {
                const t = event.target;
                if (t.dataset.piPick) { const id = `${t.dataset.piBook}\u0000${t.dataset.piPick}`; if (t.checked) picked.add(id); else picked.delete(id); draw(box); }
                if (t.dataset.piKind) {
                    const path = t.dataset.piKind;
                    const fix = t.value.startsWith('fix:');
                    overrides = { ...overrides, [path]: fix ? 'fixed' : 'line' };
                    if (fix) picks = { ...picks, [path]: t.value.slice(4) };
                    draw(box);
                }
            });
            box.addEventListener('click', event => {
                const t = event.target.closest('[data-pi-all]');
                if (!t) return;
                const book = books.find(item => item.name === t.dataset.piAll);
                const every = book.entries.every(entry => picked.has(idOf(entry)));
                for (const entry of book.entries) if (every) picked.delete(idOf(entry)); else picked.add(idOf(entry));
                draw(box);
            });
        },
        actions: [
            { label: '取消', value: null },
            { label: '返回选择', value: box => { step = 'list'; draw(box); } },
            { label: '预览', primary: true, value: box => { if (!picked.size) toast('info', '先勾选要转入的条目。'); else { step = 'preview'; draw(box); } } },
            { label: '转入', primary: true, value: () => ({ entries: chosen(), plan: plan() }) },
        ],
    });
    if (!result) return false;
    return commit(view, result);
}

async function commit(view, { entries, plan }) {
    const ok = entries.filter(entry => !plan.blocked.has(idOf(entry)));
    if (!ok.length) { toast('warning', '勾选的条目都有错误，没有转入。'); return false; }
    view.data.updateProject(view.projectId, project => ({ ...project, personas: applyPlan(normalizePersonas(project.personas), plan, entries) }));
    const byBook = new Map();
    for (const entry of ok) byBook.set(entry.book, [...(byBook.get(entry.book) || []), entry.key]);
    for (const [book, keys] of byBook) await setEntriesDisabled(book, keys, true);
    view.runtime.refresh();
    toast('success', `已转入 ${plan.lines.length} 条人设线，关闭了 ${ok.length} 个原条目。`);
    return true;
}

// 恢复原条目：重新开启；可选删除对应的人设线。
export async function restoreImported(view, item) {
    const choice = await openDialog({
        title: `恢复「${item.title || item.key}」`,
        html: '<p class="pi-hint">重新开启这个原条目。</p>',
        actions: [{ label: '取消', value: null }, { label: '恢复并删除对应人设线', value: 'drop' }, { label: '只恢复', primary: true, value: 'keep' }],
    });
    if (!choice) return false;
    try {
        await setEntriesDisabled(item.book, [item.key], false);
    } catch (error) {
        toast('error', `恢复失败：${error.message}`);
        return false;
    }
    view.data.updateProject(view.projectId, project => ({ ...project, personas: releaseImported(normalizePersonas(project.personas), item, { removeLines: choice === 'drop' }) }));
    view.runtime.refresh();
    return true;
}
