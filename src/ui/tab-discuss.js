import { makeId } from '../core/outline.js';
import { chatRequest, discussSystemPrompt, foldCandidates, foldMessages, hasYamlBlock, needsFold } from '../core/prompts.js';
import { downloadBlob, toast } from '../host/st.js';
import { ask, guideText } from './ai.js';
import { choiceDialog, confirmDialog, esc, openDialog, promptDialog } from './dom.js';
import { ICONS } from './styles.js';
import { pickRefs, progressText, resolveRefs, wbSummary } from './discuss-refs.js';
import { renderMarkdown } from './markdown.js';
import * as outlineTab from './tab-outline.js';
import * as settingTab from './tab-setting.js';

const st = view => view.tabState('discuss');

export function render(view) {
    const chat = view.data.chat(view.projectId);
    if (!chat) {
        view.data.loadChat(view.projectId).then(() => view.renderBody()).catch(error => toast('error', `读取讨论记录失败：${error.message}`));
        return '<div class="pi-empty"><span class="pi-spin"></span> 正在读取讨论记录…</div>';
    }
    const busy = view.busy[`discuss:${view.projectId}`];
    const refs = chat.refs;
    const folded = chat.messages.filter(msg => msg.folded).length;
    const live = chat.messages.filter(msg => !msg.folded);
    const lastAi = [...live].reverse().find(msg => msg.role !== 'user');
    const wb = wbSummary(view, chat.refs, () => view.renderBody());
    const canProgress = Boolean(progressText(view));
    const chips = `<div class="pi-refs"><span class="pi-hint">附带参考：</span>
        <button type="button" class="pi-chip${refs.setting ? ' is-on' : ''}" data-act="ref" data-ref="setting">设定</button>
        <button type="button" class="pi-chip${refs.outline ? ' is-on' : ''}" data-act="ref" data-ref="outline">大纲</button>
        <button type="button" class="pi-chip${refs.progress && canProgress ? ' is-on' : ''}" data-act="ref" data-ref="progress"${canProgress ? '' : ' disabled title="本项目不是当前聊天启用的项目"'}>剧情进度</button>
        <button type="button" class="pi-chip${refs.floors ? ' is-on' : ''}" data-act="ref-floors">正文 ${refs.floors} 楼</button>
        <button type="button" class="pi-chip${wb && wb.count ? ' is-on' : ''}" data-act="ref-wb">世界书 ${wb ? `${wb.count} 条` : '…'}</button></div>`;
    const messages = live.map(msg => {
        const isUser = msg.role === 'user';
        const tools = `<div class="pi-msg-tools">
            <button type="button" class="pi-btn is-sm is-ghost" data-act="msg-edit" data-id="${esc(msg.id)}">编辑</button>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="msg-del" data-id="${esc(msg.id)}">删除</button>
            ${msg === lastAi && !busy ? '<button type="button" class="pi-btn is-sm is-ghost" data-act="regen">重新生成</button>' : ''}
            ${!isUser ? `<button type="button" class="pi-btn is-sm is-ghost" data-act="to-setting">整理成设定</button>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="to-outline">据此写大纲</button>
            ${hasYamlBlock(msg.content) ? `<button type="button" class="pi-btn is-sm is-ghost" data-act="use-yaml" data-id="${esc(msg.id)}">把 YAML 送到大纲</button>` : ''}` : ''}</div>`;
        return `<div class="pi-msg ${isUser ? 'is-user' : 'is-ai'}"><div class="pi-md">${renderMarkdown(msg.content)}</div>${tools}</div>`;
    }).join('');
    const empty = !chat.messages.length ? `<div class="pi-empty">说说这条 if 线的想法：原作、角色、类型、基调，一句话也行。<br>AI 会帮你把设定想清楚。</div>` : '';
    return `${chips}<div class="pi-chat">
        ${folded ? `<button type="button" class="pi-msg-fold" data-act="summary">更早的 ${folded} 条已折成摘要 · 查看</button>` : ''}
        ${empty}${messages}${busy ? '<div class="pi-msg is-ai"><span class="pi-spin"></span></div>' : ''}</div>
        <div class="pi-compose">${chat.messages.length ? `<button type="button" class="pi-compose-side" data-act="clear-talk" title="清空讨论">${ICONS.trash}</button>` : ''}<textarea class="pi-ta" data-compose placeholder="Ctrl+Enter 发送">${esc(st(view).draft || '')}</textarea>
        <button type="button" class="pi-send" data-act="send" title="发送（Ctrl+Enter）"${busy ? ' disabled' : ''}>${ICONS.send}</button></div>`;
}

// 讨论回复存回发起时的项目，中途切走项目也不丢。
async function reply(view) {
    const projectId = view.projectId;
    const key = `discuss:${projectId}`;
    if (view.busy[key]) return;
    view.setBusy(key, true);
    try {
        let chat = await view.data.loadChat(projectId);
        const project = await view.data.loadProject(projectId);
        if (needsFold(chat.messages)) {
            const fold = foldCandidates(chat.messages);
            const summary = await ask(view, 'discuss', foldMessages(chat.summary, fold));
            const ids = new Set(fold.map(msg => msg.id));
            chat = { ...view.data.chat(projectId), summary, messages: view.data.chat(projectId).messages.map(msg => (ids.has(msg.id) ? { ...msg, folded: true } : msg)) };
            view.data.saveChat(projectId, chat);
        }
        const system = discussSystemPrompt({ guide: guideText(view), refs: await resolveRefs(view, chat, project) });
        const text = await ask(view, 'discuss', chatRequest(system, chat.summary, chat.messages));
        const latest = view.data.chat(projectId);
        view.data.saveChat(projectId, { ...latest, messages: [...latest.messages, { id: makeId('m'), role: 'assistant', content: text, at: Date.now() }] });
    } catch (error) {
        toast('error', `讨论请求失败：${error.message}`);
    } finally {
        view.setBusy(key, false);
    }
}

function updateChat(view, fn) {
    const chat = view.data.chat(view.projectId);
    view.data.saveChat(view.projectId, fn(chat));
}

function talkMarkdown(view, chat) {
    const name = view.project().name;
    const lines = [`# ${name} · 讨论记录`, ''];
    if (chat.summary) lines.push('## 早期摘要', '', chat.summary, '');
    for (const msg of chat.messages) lines.push(`## ${msg.role === 'user' ? '我' : 'AI'}`, '', msg.content, '');
    return lines.join('\n');
}

export const actions = {
    // 清空本项目的讨论，设定、大纲和附带参考都保留；可先导出一份。
    async 'clear-talk'(view) {
        const chat = view.data.chat(view.projectId);
        if (!chat || !chat.messages.length) return;
        const choice = await choiceDialog({
            title: '清空讨论',
            body: `删除这个项目的全部 ${chat.messages.length} 条讨论消息和摘要。设定、大纲和附带参考不受影响。`,
            choices: [{ label: '取消', value: null }, { label: '直接清空', value: 'clear', danger: true }, { label: '导出后清空', value: 'export', primary: true }],
        });
        if (!choice) return;
        if (choice === 'export') downloadBlob(`${view.project().name}-讨论记录-${new Date().toISOString().slice(0, 10)}.md`, talkMarkdown(view, chat), 'text/markdown');
        view.data.saveChat(view.projectId, { ...chat, summary: '', messages: [] });
        st(view).draft = '';
        view.renderBody();
    },
    send(view, target) {
        const box = target.closest('.pi-body').querySelector('[data-compose]');
        const text = box.value.trim();
        if (!text) return;
        updateChat(view, chat => ({ ...chat, messages: [...chat.messages, { id: makeId('m'), role: 'user', content: text, at: Date.now() }] }));
        st(view).draft = '';
        box.value = '';
        view.renderBody();
        return reply(view);
    },
    regen(view) {
        updateChat(view, chat => {
            const index = chat.messages.map(msg => msg.role).lastIndexOf('assistant');
            return index < 0 ? chat : { ...chat, messages: chat.messages.filter((_, i) => i !== index) };
        });
        view.renderBody();
        return reply(view);
    },
    async 'msg-edit'(view, target) {
        const msg = view.data.chat(view.projectId).messages.find(item => item.id === target.dataset.id);
        const text = await promptDialog({ title: '编辑消息', value: msg.content, multiline: true });
        if (text == null) return;
        updateChat(view, chat => ({ ...chat, messages: chat.messages.map(item => (item.id === msg.id ? { ...item, content: text } : item)) }));
        view.renderBody();
    },
    async 'msg-del'(view, target) {
        if (!(await confirmDialog({ title: '删除这条消息', okLabel: '删除', danger: true }))) return;
        updateChat(view, chat => ({ ...chat, messages: chat.messages.filter(item => item.id !== target.dataset.id) }));
        view.renderBody();
    },
    async summary(view) {
        const chat = view.data.chat(view.projectId);
        const result = await openDialog({
            title: '讨论摘要',
            html: `<p class="pi-hint">更早的消息只发送这份摘要，原文仍保存在文件里。</p><textarea class="pi-ta is-tall" data-f="summary">${esc(chat.summary)}</textarea>`,
            actions: [{ label: '展开全部原文', value: 'unfold' }, { label: '取消', value: null }, { label: '保存摘要', primary: true, value: box => box.querySelector('[data-f=summary]').value }],
        });
        if (result == null) return;
        if (result === 'unfold') updateChat(view, current => ({ ...current, summary: '', messages: current.messages.map(msg => ({ ...msg, folded: false })) }));
        else updateChat(view, current => ({ ...current, summary: result }));
        view.renderBody();
    },
    ref(view, target) {
        const key = target.dataset.ref;
        updateChat(view, chat => ({ ...chat, refs: { ...chat.refs, [key]: !chat.refs[key] } }));
        view.renderBody();
    },
    async 'ref-floors'(view) {
        const chat = view.data.chat(view.projectId);
        const value = await promptDialog({ title: '附带最近正文', label: '楼数（0 为不附带，最多 50）', value: String(chat.refs.floors) });
        if (value == null) return;
        const floors = Math.max(0, Math.min(50, Math.round(Number(value) || 0)));
        updateChat(view, current => ({ ...current, refs: { ...current.refs, floors } }));
        view.renderBody();
    },
    async 'ref-wb'(view) {
        const result = await pickRefs(view.data.chat(view.projectId).refs);
        if (!result) return;
        if (result.none) return toast('info', '当前卡没有关联的世界书。');
        updateChat(view, current => ({ ...current, refs: { ...current.refs, memo: result.memo, wb: result.wb } }));
        view.renderBody();
    },
    'to-setting'(view) {
        view.go('setting');
        return settingTab.actions['from-talk'](view);
    },
    'to-outline'(view) {
        view.go('outline');
        return outlineTab.actions['ai-volume'](view);
    },
    'use-yaml'(view, target) {
        const msg = view.data.chat(view.projectId).messages.find(item => item.id === target.dataset.id);
        view.go('outline');
        outlineTab.showDraft(view, msg.content);
    },
};

export function onInput(view, target) {
    if (target.dataset.compose !== undefined) st(view).draft = target.value;
}

export function onSubmit(view, target) {
    if (target.dataset.compose !== undefined) actions.send(view, target);
}

export const refreshOn = [];
