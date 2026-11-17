import { resolveGuide } from '../core/guide.js';

import { transcript } from '../core/prompts.js';
import { resolveLlm } from '../core/store.js';
import { requestLlm } from '../host/llm.js';

export function ask(view, role, messages, { signal } = {}) {
    return requestLlm(messages, resolveLlm(view.data.settings(), role), { signal });
}

export function guideText(view) {
    return guideInfo(view).text;
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

export function guideInfo(view) {
    return resolveGuide(view.data.settings());
}
