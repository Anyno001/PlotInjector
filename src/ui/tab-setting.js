import { settingMessages, rewriteBlockMessages } from '../core/prompts.js';
import { diffLines, joinBlocks, mergeBlocks, parseSettingReply, pushHistory, splitBlocks } from '../core/setting.js';
import { estimateTokens } from '../core/tokens.js';
import { ask, guideText, runTask, talkText } from './ai.js';
import { confirmDialog, esc, openDialog, options } from './dom.js';
import { afterImport, pickWorldbookEntries } from './wb-import.js';

const st = view => view.tabState('setting');

function diffHtml(a, b) {
    return `<div class="pi-diff">${diffLines(a, b).map(line => `<div class="${line.op === '+' ? 'is-add' : line.op === '-' ? 'is-del' : ''}">${esc(line.text) || ' '}</div>`).join('')}</div>`;
}

function checkBadge(check) {
    if (!check) return '';
    return `<span class="pi-badge ${check === 'PASS' ? 'is-ok' : 'is-danger'}">速查 ${esc(check)}</span>`;
}

function fixesHtml(fixes, where) {
    if (!fixes.length) return '';
    return `<p class="pi-hint">补定（替你补齐的项，确认或修改）：</p>${fixes.map((fix, i) => `<div class="pi-row"><span class="pi-grow">· ${esc(fix)}</span>
        <button type="button" class="pi-btn is-sm is-ghost" data-act="fix-ok" data-where="${where}" data-i="${i}">确认</button>
        <button type="button" class="pi-btn is-sm" data-act="fix-edit" data-where="${where}" data-i="${i}">改</button></div>`).join('')}`;
}

function draftHtml(view, project, draft) {
    const oldBlocks = new Map(splitBlocks(project.setting.text).map(block => [block.key, block]));
    const rows = splitBlocks(draft.body).map(block => {
        const old = oldBlocks.get(block.key);
        const status = !old ? '<span class="pi-badge is-ok">新增</span>' : old.text === block.text ? '<span class="pi-badge">未变</span>' : '<span class="pi-badge is-warn">改动</span>';
        const open = st(view).openBlock === block.key;
        return `<div class="pi-entry"><div class="pi-entry-hd" data-act="draft-block" data-key="${esc(block.key)}">
            <input type="checkbox" data-pick-block="${esc(block.key)}"${draft.keys.includes(block.key) ? ' checked' : ''}>
            <span class="pi-etitle">${esc(block.title)}</span>${status}</div>
            ${open ? `<div class="pi-entry-bd">${diffHtml(old ? old.text : '', block.text)}</div>` : ''}</div>`;
    }).join('');
    return `<div class="pi-card"><h3>新稿对比 ${checkBadge(draft.check)}<span class="pi-spacer"></span>
        <button type="button" class="pi-btn is-sm is-ghost" data-act="draft-drop">丢弃</button>
        <button type="button" class="pi-btn is-sm" data-act="draft-pick">采用勾选的分块</button>
        <button type="button" class="pi-btn is-sm is-primary" data-act="draft-all">全部采用</button></h3>
        <p class="pi-hint">点分块看改动；勾选的分块替换旧稿，旧稿没有的追加到末尾。</p>${rows}
        ${fixesHtml(draft.fixes, 'draft')}</div>`;
}

function historyHtml(project, at) {
    const list = project.setting.history;
    if (!list.length) return '<div class="pi-card"><h3>历史版本</h3><p class="pi-hint">还没有历史版本。</p></div>';
    const fmt = time => new Date(time).toLocaleString();
    const chosen = list[at];
    return `<div class="pi-card"><h3>历史版本<span class="pi-spacer"></span><span class="pi-hint">保留最近 10 版</span></h3>
        ${list.map((item, i) => `<div class="pi-row"><span class="pi-grow">${esc(fmt(item.at))} · ${item.text.length} 字</span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="hist-diff" data-i="${i}">对比当前</button>
            <button type="button" class="pi-btn is-sm" data-act="hist-restore" data-i="${i}">回退到此版</button></div>`).join('')}
        ${chosen ? `<p class="pi-hint">${esc(fmt(chosen.at))} → 当前</p>${diffHtml(chosen.text, project.setting.text)}` : ''}</div>`;
}

export function render(view) {
    const project = view.project();
    const s = st(view);
    const text = project.setting.text;
    const blocks = splitBlocks(text).filter(block => block.title !== '开头');
    const busy = view.busy.setting;
    return `${s.draft ? draftHtml(view, project, s.draft) : ''}
        <div class="pi-card"><h3>设定 ${checkBadge(project.setting.check)}<span class="pi-spacer"></span>
            <label class="pi-check"><input type="checkbox" data-append${s.append ? ' checked' : ''}>只追加</label>
            <button type="button" class="pi-btn is-sm is-accent" data-act="from-talk"${busy ? ' disabled' : ''}>${busy ? '<span class="pi-spin"></span>整理中' : '从讨论整理'}</button>
            <button type="button" class="pi-btn is-sm" data-act="import-wb">从世界书导入</button>
            <button type="button" class="pi-btn is-sm${s.history ? ' is-primary' : ''}" data-act="history">历史 ${project.setting.history.length}</button></h3>
        ${blocks.length ? `<div class="pi-toc">${blocks.map(block => `<button type="button" class="pi-chip" data-act="jump" data-key="${esc(block.key)}">${esc(block.title)}</button>`).join('')}</div>` : ''}
        <textarea class="pi-ta is-tall" data-setting placeholder="世界观正文。执行时作为常驻条目注入（角色定义后），取代世界书里手改的剧情设定条目。">${esc(text)}</textarea>
        <div class="pi-row"><span class="pi-hint pi-grow">≈<span data-tokens>${estimateTokens(text)}</span> token</span><span class="pi-status" data-save-status></span></div>
        ${fixesHtml(project.setting.fixes, 'saved')}</div>
        ${s.history ? historyHtml(project, s.historyAt) : ''}`;
}

function setSetting(view, patch) {
    view.data.updateProject(view.projectId, project => ({ ...project, setting: { ...project.setting, ...patch } }));
}

function commit(view, text, extra = {}) {
    const project = view.project();
    let history = pushHistory(project.setting.history, project.setting.text);
    history = pushHistory(history, text);
    setSetting(view, { text, history, ...extra });
    view.runtime.refresh();
}

async function editFix(view, where, index) {
    const s = st(view);
    const project = view.project();
    const fixes = where === 'draft' ? s.draft.fixes : project.setting.fixes;
    const source = where === 'draft' ? s.draft.body : project.setting.text;
    const blocks = splitBlocks(source);
    const result = await openDialog({
        title: '修改补定',
        html: `<p class="pi-hint">${esc(fixes[index])}</p>
            <label class="pi-field"><span>改哪个分块</span><select class="pi-sel" data-f="block">${options(blocks.map(block => ({ value: block.key, label: block.title })), blocks[0] && blocks[0].key)}</select></label>
            <label class="pi-field"><span>怎么改</span><textarea class="pi-ta" data-f="text"></textarea></label>`,
        actions: [{ label: '取消', value: null }, { label: '让 AI 重写该分块', primary: true, value: box => ({ key: box.querySelector('[data-f=block]').value, text: box.querySelector('[data-f=text]').value.trim() }) }],
    });
    if (!result || !result.text) return;
    const block = blocks.find(item => item.key === result.key);
    const reply = await runTask(view, 'setting', () => ask(view, 'outline', rewriteBlockMessages({ guide: guideText(view), current: source, blockText: block.text, fixes: `${fixes[index]}\n改为：${result.text}` })));
    if (!reply) return;
    const rewritten = splitBlocks(parseSettingReply(reply).body)[0];
    if (!rewritten) throw new Error('AI 没有返回分块内容');
    const merged = joinBlocks(blocks.map(item => (item.key === block.key ? { ...item, text: rewritten.text } : item)));
    const rest = fixes.filter((_, i) => i !== index);
    if (where === 'draft') s.draft = { ...s.draft, body: merged, fixes: rest };
    else commit(view, merged, { fixes: rest });
    view.renderBody();
}

export const actions = {
    async 'from-talk'(view) {
        const project = view.project();
        const talk = await talkText(view);
        if (!talk.trim()) throw new Error('讨论记录是空的，先在「讨论」页聊一聊。');
        const append = Boolean(st(view).append && project.setting.text.trim());
        const reply = await runTask(view, 'setting', () => ask(view, 'outline', settingMessages({ guide: guideText(view), talk, current: project.setting.text, append })));
        if (!reply) return;
        const parsed = parseSettingReply(reply);
        if (!parsed.body) throw new Error('AI 回复里没有世界观正文');
        const body = append ? `${project.setting.text.trim()}\n\n${parsed.body}` : parsed.body;
        st(view).draft = { ...parsed, body, keys: splitBlocks(body).map(block => block.key) };
        view.renderBody();
    },
    'draft-block'(view, target, event) {
        if (event.target.closest('input')) return;
        st(view).openBlock = st(view).openBlock === target.dataset.key ? '' : target.dataset.key;
        view.renderBody();
    },
    'draft-drop'(view) {
        st(view).draft = null;
        view.renderBody();
    },
    'draft-all'(view) {
        const draft = st(view).draft;
        commit(view, draft.body, { check: draft.check, fixes: draft.fixes });
        st(view).draft = null;
        view.renderBody();
    },
    'draft-pick'(view) {
        const draft = st(view).draft;
        if (!draft.keys.length) throw new Error('没有勾选分块');
        commit(view, mergeBlocks(view.project().setting.text, draft.body, draft.keys), { check: draft.check, fixes: draft.fixes });
        st(view).draft = null;
        view.renderBody();
    },
    'fix-ok'(view, target) {
        const index = Number(target.dataset.i);
        if (target.dataset.where === 'draft') st(view).draft.fixes = st(view).draft.fixes.filter((_, i) => i !== index);
        else setSetting(view, { fixes: view.project().setting.fixes.filter((_, i) => i !== index) });
        view.renderBody();
    },
    'fix-edit': (view, target) => editFix(view, target.dataset.where, Number(target.dataset.i)),
    async 'import-wb'(view) {
        const picked = await pickWorldbookEntries('从世界书导入设定');
        if (!picked.length) return;
        const project = view.project();
        commit(view, [project.setting.text, ...picked.map(entry => entry.content)].filter(item => item.trim()).join('\n\n'));
        view.renderBody();
        await afterImport(picked);
    },
    history(view) {
        st(view).history = !st(view).history;
        st(view).historyAt = undefined;
        view.renderBody();
    },
    'hist-diff'(view, target) {
        st(view).historyAt = Number(target.dataset.i);
        view.renderBody();
    },
    async 'hist-restore'(view, target) {
        const item = view.project().setting.history[Number(target.dataset.i)];
        if (!item || !(await confirmDialog({ title: '回退设定', body: '当前正文会先存进历史，再换成这一版。' }))) return;
        commit(view, item.text);
        view.renderBody();
    },
    jump(view, target) {
        const box = target.closest('.pi-card').querySelector('[data-setting]');
        const block = splitBlocks(box.value).find(item => item.key === target.dataset.key);
        if (!block) return;
        const at = box.value.indexOf(block.text);
        box.focus();
        box.setSelectionRange(at, at);
        const line = box.value.slice(0, at).split('\n').length - 1;
        box.scrollTop = Math.max(0, line * parseFloat(getComputedStyle(box).lineHeight || '20') - 8);
    },
};

export function onInput(view, target) {
    if (target.dataset.setting !== undefined) {
        setSetting(view, { text: target.value });
        const tokens = target.closest('.pi-card').querySelector('[data-tokens]');
        if (tokens) tokens.textContent = String(estimateTokens(target.value));
    }
}

export function onChange(view, target) {
    if (target.dataset.append !== undefined) st(view).append = target.checked;
    if (target.dataset.pickBlock !== undefined) {
        const draft = st(view).draft;
        const keys = new Set(draft.keys);
        if (target.checked) keys.add(target.dataset.pickBlock);
        else keys.delete(target.dataset.pickBlock);
        draft.keys = [...keys];
    }
}

export function onBlur(view, target) {
    if (target.dataset.setting === undefined) return;
    const project = view.project();
    if (project.setting.history[0] && project.setting.history[0].text === project.setting.text) return;
    setSetting(view, { history: pushHistory(project.setting.history, project.setting.text) });
    view.runtime.refresh();
}

export function onStatus(view, root) {
    const status = root.querySelector('[data-save-status]');
    if (!status) return;
    const failed = view.data.failedFiles().length;
    status.textContent = failed ? '保存失败，内容仍在内存里' : '已保存';
    status.classList.toggle('is-err', Boolean(failed));
}

export const refreshOn = [];
