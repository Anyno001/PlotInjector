import { BUILTIN_GUIDE } from '../core/guide.js';
import { transcript } from '../core/prompts.js';
import { requestLlm } from '../host/llm.js';

export function ask(view, role, messages) {
    return requestLlm(messages, view.data.settings().llm[role]);
}

export function guideText(view) {
    return String(view.data.settings().guide || '').trim() || BUILTIN_GUIDE;
}

export async function talkText(view, limit = 30000) {
    const chat = await view.data.loadChat(view.projectId);
    return transcript(chat.summary, chat.messages, limit);
}

// 同一时刻一类任务只跑一个；结果回来时项目已切走就丢弃。
export async function runTask(view, key, job) {
    if (view.busy[key]) return null;
    const projectId = view.projectId;
    view.setBusy(key, true);
    try {
        const result = await job();
        return view.projectId === projectId ? result : null;
    } finally {
        view.setBusy(key, false);
    }
}
