
import { guideInfo, ask } from './ai.js';

import { isClueMode } from '../core/clue-model.js';

import { makeId, isPlainObject, volumeName } from '../core/outline.js';

import { chatRequest, discussSystemPrompt, foldCandidates, foldMessages, hasYamlBlock, needsFold } from '../core/prompts.js';
import { downloadBlob, toast } from '../host/st.js';

import { choiceDialog, confirmDialog, esc, openDialog, promptDialog, menuDialog } from './dom.js';
import { ICONS } from './styles.js';
import { pickRefs, progressText, resolveRefs, wbSummary } from './discuss-refs.js';
import { renderMarkdown } from './markdown.js';
import * as outlineTab from './tab-outline.js';
import * as settingTab from './tab-setting.js';

const st = (view) => view.tabState('discuss');

export function render(view) {
    const chat = view.data.chat(view.projectId);
    if (!chat)
        return (
            view.data
                .loadChat(view.projectId)
                .then(() => view.renderBody())
                .catch((error) => toast('error', `读取讨论记录失败：${error.message}`)),
            '<div class="pi-empty"><span class="pi-spin"></span> 正在读取讨论记录…</div>'
        );
    const busy = view.busy[`discuss:${view.projectId}`],
        refs = chat.refs,
        folded = chat.messages.filter((msg) => msg.folded).length,
        live = chat.messages.filter((msg) => !msg.folded),
        clueWord = isClueMode(view.project()),
        unanswered = live.length && live[live.length - 1].role === 'user' ? live[live.length - 1] : null,
        wb = wbSummary(view, chat.refs, () => view.renderBody()),
        canProgress = !!progressText(view),
        persona = view.data.settings().persona.trim(),
        refsOn = [refs.setting && '设定', refs.outline && '大纲', refs.progress && canProgress && '剧情进度', refs.floors && `正文 ${refs.floors} 楼`, wb && wb.count && `世界书 ${wb.count} 条`].filter(Boolean),
        open = !!st(view).refsOpen,
        chips = `<div class="pi-dc-bar"><button type="button" class="pi-dc-refs" data-act="refs-toggle" aria-expanded="${open}">参考 <i>${refsOn.length}</i><small>${esc(refsOn.join('、') || '无')}</small><span class="pi-dc-caret">${open ? '▴' : '▾'}</span></button>
        <button type="button" class="pi-dc-act" data-act="review-pick" title="选一条剧情线，逐页查看各阶段，在对应页填写意见后统一发送">${ICONS.pencil}<span>审阅修改</span></button></div>
        ${open ? `<div class="pi-dc-refs-open">
        <button type="button" class="pi-chip${persona ? ' is-on' : ''}" data-act="persona" title="${esc(persona || '指定 AI 讨论时的说话人格')}">人格${persona ? '' : '：未设置'}</button>
        <button type="button" class="pi-chip${refs.setting ? ' is-on' : ''}" data-act="ref" data-ref="setting">设定</button>
        <button type="button" class="pi-chip${refs.outline ? ' is-on' : ''}" data-act="ref" data-ref="outline">大纲</button>
        <button type="button" class="pi-chip${refs.progress && canProgress ? ' is-on' : ''}" data-act="ref" data-ref="progress"${canProgress ? '' : ' disabled title="本项目不是当前聊天启用的项目"'}>剧情进度</button>
        <button type="button" class="pi-chip${refs.floors ? ' is-on' : ''}" data-act="ref-floors">正文 ${refs.floors} 楼</button>
        <button type="button" class="pi-chip${wb && wb.count ? ' is-on' : ''}" data-act="ref-wb">世界书 ${wb ? `${wb.count} 条` : '…'}</button></div>` : ''}`,
        messages = live
            .map((msg) => {
                let isUser = msg.role === 'user',
                    // 回复下的按钮排成一行（用户 2026-11-16 选 B）：常用的放外面，编辑、删除此条消息、重新生成收进「⋯」
                    tools = `<div class="pi-msg-tools">${
                        isUser
                            ? ''
                            : `<button type="button" class="pi-btn is-sm is-ghost" data-act="to-setting">整理成设定</button>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="to-outline">${clueWord ? '写新剧情线' : '写新卷'}</button>`
                    }${msg === unanswered && !busy ? '<button type="button" class="pi-btn is-sm is-ghost" data-act="resend">重新发送</button>' : ''}<span class="pi-msg-gap"></span><button type="button" class="pi-icon-btn pi-msg-more" data-act="msg-more" data-id="${esc(msg.id)}" title="更多">⋯</button></div>`;
                return `<div class="pi-msg ${isUser ? 'is-user' : 'is-ai'}"><div class="pi-md">${renderMarkdown(msg.content)}</div>${tools}</div>`;
            })
            .join(''),
        empty = chat.messages.length
            ? ''
            : '<div class="pi-empty">说说你想写的剧情或设定，一句话也行。<br>AI 会帮你把世界观、人物和剧情走向想清楚；想好了，可以在 AI 的回复下面点「写新剧情线」。</div>';
    return `${chips}<div class="pi-chat">
        ${folded ? `<button type="button" class="pi-msg-fold" data-act="summary">更早的 ${folded} 条已折成摘要，查看</button>` : ''}
        ${empty}${messages}${busy ? '<div class="pi-msg is-ai"><span class="pi-spin"></span></div>' : ''}</div>
        <div class="pi-compose">${chat.messages.length ? `<button type="button" class="pi-compose-side" data-act="clear-talk" title="清空讨论">${ICONS.trash}</button>` : ''}<textarea class="pi-ta" data-compose placeholder="Ctrl+Enter 发送">${esc(st(view).draft || '')}</textarea>
        ${busy ? `<button type="button" class="pi-send" data-act="stop" title="停止回复">${ICONS.close}</button>` : `<button type="button" class="pi-send" data-act="send" title="发送（Ctrl+Enter）">${ICONS.send}</button>`}</div>`;
}

// 每个项目一个进行中的请求，停止键中止它。
const controllers = new Map();

// 讨论回复存回发起时的项目，中途切走项目也不丢。被停止时不存、不报错，用户消息留着可「重新发送」。
async function reply(view) {
    const projectId = view.projectId,
        key = `discuss:${projectId}`;
    if (view.busy[key]) return;
    const controller = new AbortController();
    controllers.set(projectId, controller);
    const { signal } = controller;
    view.setBusy(key, !0);
    try {
        let chat = await view.data.loadChat(projectId);
        const project = await view.data.loadProject(projectId);
        if (needsFold(chat.messages)) {
            const fold = foldCandidates(chat.messages),
                summary = await ask(view, 'discuss', foldMessages(chat.summary, fold), { signal }),
                ids = new Set(fold.map((msg) => msg.id));
            ((chat = {
                ...view.data.chat(projectId),
                summary,
                messages: view.data.chat(projectId).messages.map((msg) => (ids.has(msg.id) ? { ...msg, folded: !0 } : msg)),
            }),
                view.data.saveChat(projectId, chat));
        }
        const system = discussSystemPrompt({
                guide: guideInfo(view),
                refs: await resolveRefs(view, chat, project),
                persona: view.data.settings().persona,
            }),
            text = await ask(view, 'discuss', chatRequest(system, chat.summary, chat.messages), { signal });
        if (signal.aborted) return;
        const latest = view.data.chat(projectId);
        view.data.saveChat(projectId, {
            ...latest,
            messages: [
                ...latest.messages,
                {
                    id: makeId('m'),
                    role: 'assistant',
                    content: text,
                    at: Date.now(),
                },
            ],
        });
    } catch (error) {
        signal.aborted || toast('error', `讨论请求失败：${error.message}`);
    } finally {
        (controllers.get(projectId) === controller && controllers.delete(projectId), view.setBusy(key, !1));
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
            choices: [
                { label: '取消', value: null },
                { label: '直接清空', value: 'clear', danger: !0 },
                { label: '导出后清空', value: 'export', primary: !0 },
            ],
        });
        choice &&
            (choice === 'export' &&
                downloadBlob(
                    `${view.project().name}-讨论记录-${/* @__PURE__ */ new Date().toISOString().slice(0, 10)}.md`,
                    talkMarkdown(view, chat),
                    'text/markdown',
                ),
            view.data.saveChat(view.projectId, { ...chat, summary: '', messages: [] }),
            (st(view).draft = ''),
            view.renderBody());
    },
    send(view, target) {
        const box = target.closest('.pi-body').querySelector('[data-compose]'),
            text = box.value.trim();
        if (text)
            return (
                updateChat(view, (chat) => ({
                    ...chat,
                    messages: [...chat.messages, { id: makeId('m'), role: 'user', content: text, at: Date.now() }],
                })),
                (st(view).draft = ''),
                (box.value = ''),
                view.renderBody(),
                reply(view)
            );
    },
    stop(view) {
        controllers.get(view.projectId)?.abort();
    },
    // 最后一条用户消息没有回复时，不重复添加，直接再请求一次。
    resend(view) {
        return reply(view);
    },
    regen(view) {
        return (
            updateChat(view, (chat) => {
                const index = chat.messages.map((msg) => msg.role).lastIndexOf('assistant');
                return index < 0 ? chat : { ...chat, messages: chat.messages.filter((_, i) => i !== index) };
            }),
            view.renderBody(),
            reply(view)
        );
    },
    async 'msg-more'(view, target) {
        const chat = view.data.chat(view.projectId),
            msg = chat.messages.find((item) => item.id === target.dataset.id);
        if (!msg) return;
        const live = chat.messages.filter((item) => !item.folded),
            lastAi = [...live].reverse().find((item) => item.role !== 'user'),
            busy = view.busy[`discuss:${view.projectId}`],
            items = [
                { value: 'msg-edit', label: '编辑' },
                ...(msg === lastAi && !busy ? [{ value: 'regen', label: '重新生成' }] : []),
                ...(msg.role !== 'user' && hasYamlBlock(msg.content) ? [{ value: 'use-yaml', label: '把 YAML 送到大纲' }] : []),
                { value: 'msg-del', label: '删除此条消息', danger: !0 },
            ],
            pick = await menuDialog({ title: '这条消息', items });
        pick && actions[pick](view, target);
    },
    async 'msg-edit'(view, target) {
        const msg = view.data.chat(view.projectId).messages.find((item) => item.id === target.dataset.id),
            text = await promptDialog({ title: '编辑消息', value: msg.content, multiline: !0 });
        text != null &&
            (updateChat(view, (chat) => ({
                ...chat,
                messages: chat.messages.map((item) => (item.id === msg.id ? { ...item, content: text } : item)),
            })),
            view.renderBody());
    },
    async 'msg-del'(view, target) {
        (await confirmDialog({ title: '删除此条消息', body: '只删这一条，其他消息不动。', okLabel: '删除', danger: !0 })) &&
            (updateChat(view, (chat) => ({ ...chat, messages: chat.messages.filter((item) => item.id !== target.dataset.id) })),
            view.renderBody());
    },
    async summary(view) {
        const chat = view.data.chat(view.projectId),
            result = await openDialog({
                title: '讨论摘要',
                html: `<p class="pi-hint">更早的消息只发送这份摘要，原文仍保存在文件里。</p><textarea class="pi-ta is-tall" data-f="summary">${esc(chat.summary)}</textarea>`,
                actions: [
                    { label: '展开全部原文', value: 'unfold' },
                    { label: '取消', value: null },
                    { label: '保存摘要', primary: !0, value: (box) => box.querySelector('[data-f=summary]').value },
                ],
            });
        result != null &&
            (result === 'unfold'
                ? updateChat(view, (current) => ({
                      ...current,
                      summary: '',
                      messages: current.messages.map((msg) => ({ ...msg, folded: !1 })),
                  }))
                : updateChat(view, (current) => ({ ...current, summary: result })),
            view.renderBody());
    },
    // 说话人格对所有项目的讨论生效，存在插件设置里；留空用默认口吻。
    async persona(view) {
        const value = await promptDialog({
            title: '说话人格',
            label: '讨论时 AI 以什么身份、什么风格回复，留空为默认',
            value: view.data.settings().persona,
            multiline: !0,
            placeholder: '例：你是一位熟悉原作的资深编辑，说话直接，敢于否定不合理的设定。',
        });
        value != null && (view.data.updateSettings({ persona: value.trim() }), view.renderBody());
    },
    ref(view, target) {
        const key = target.dataset.ref;
        (updateChat(view, (chat) => ({ ...chat, refs: { ...chat.refs, [key]: !chat.refs[key] } })), view.renderBody());
    },
    async 'ref-floors'(view) {
        const chat = view.data.chat(view.projectId),
            value = await promptDialog({ title: '附带最近正文', label: '楼数（0 为不附带，最多 50）', value: String(chat.refs.floors) });
        if (value == null) return;
        const floors = Math.max(0, Math.min(50, Math.round(Number(value) || 0)));
        (updateChat(view, (current) => ({ ...current, refs: { ...current.refs, floors } })), view.renderBody());
    },
    async 'ref-wb'(view) {
        const result = await pickRefs(view.data.chat(view.projectId).refs);
        if (result) {
            if (result.none) return toast('info', '当前卡没有关联的世界书。');
            (updateChat(view, (current) => ({ ...current, refs: { ...current.refs, memo: result.memo, wb: result.wb } })),
                view.renderBody());
        }
    },
    'to-setting'(view) {
        return (view.go('setting'), settingTab.actions['from-talk'](view));
    },
    'to-outline'(view) {
        return (view.go('outline'), outlineTab.actions['ai-volume'](view, null, { withTalk: !0 }));
    },
    'refs-toggle'(view) {
        ((st(view).refsOpen = !st(view).refsOpen), view.renderBody());
    },
    // 审阅修改（导入审阅总方案第五节 J，用户 2026-11-16 第三版）：选一条剧情线 → 逐页审阅（和导入同一个页面）。
    // 讨论只用来聊，不直接改大纲；讨论记录在审阅页发送意见时作为参考带上。
    async 'review-pick'(view) {
        let project = view.project();
        if (!project || !project.outline.volumes.length) return toast('info', '大纲里还没有内容。');
        let clue = isClueMode(project),
            name = (v) => (isPlainObject(v.line) && v.line.编号 && !volumeName(v.key).startsWith(v.line.编号) ? `${v.line.编号} ${volumeName(v.key)}` : volumeName(v.key)),
            id = await menuDialog({
                title: '审阅修改',
                items: project.outline.volumes.map((v) => ({ value: v.id, label: `${name(v)}　${v.stages.length} 个阶段` })),
            });
        if (!id || view.projectId !== project.id) return;
        let jobId = await outlineTab.openEditReview(view, id, {}, { note: clue ? '剧情线' : '卷' });
        (outlineTab.showEditReview(view, jobId), view.go('outline'));
    },
    'use-yaml'(view, target) {
        const msg = view.data.chat(view.projectId).messages.find((item) => item.id === target.dataset.id);
        (view.go('outline'), outlineTab.showDraft(view, msg.content));
    },
};

export function onInput(view, target) {
    if (target.dataset.compose !== undefined) st(view).draft = target.value;
}

export function onSubmit(view, target) {
    if (target.dataset.compose !== undefined) actions.send(view, target);
}

export const refreshOn = [];
