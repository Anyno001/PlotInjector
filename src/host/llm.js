import { ctx, helper, hostWindow, requestHeaders } from './st.js';

// 两种来源：酒馆当前 API（generateRaw，静默）；独立 OpenAI 兼容接口，经酒馆后端转发避开跨域。
function apiBase(endpoint) {
    const base = String(endpoint || '').trim().replace(/\/+$/, '');
    if (!base) throw new Error('请先填写接口地址');
    let parsed;
    try { parsed = new URL(base); } catch { throw new Error('接口地址无效'); }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('接口地址需以 http:// 或 https:// 开头');
    const root = base.replace(/\/(?:chat\/completions|models)$/i, '');
    return /\/v\d+$/i.test(root) ? root : `${root}/v1`;
}

export function safeDetail(value, apiKey) {
    let text = String(value || '');
    const key = String(apiKey || '').trim();
    if (key) text = text.split(key).join('[已隐藏]');
    return text.replace(/<[^>]*>/g, '').replace(/\s+/g, ' ').trim().slice(0, 160);
}

function connection(llm) {
    const key = String(llm.apiKey || '').trim();
    return {
        chat_completion_source: 'custom',
        custom_url: apiBase(llm.endpoint),
        custom_include_headers: JSON.stringify({ Authorization: key ? `Bearer ${key}` : '' }),
    };
}

async function postBackend(route, body, llm, signal) {
    const res = await hostWindow().fetch(`/api/backends/chat-completions/${route}`, {
        method: 'POST',
        cache: 'no-cache',
        signal,
        headers: { ...requestHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* 下面统一报错 */ }
    if (!res.ok || (data && data.error)) {
        const detail = safeDetail((data && data.error && (data.error.message || data.error)) || (data && data.message) || text, llm.apiKey);
        throw new Error(`接口请求失败${res.ok ? '' : `（HTTP ${res.status}）`}${detail ? `：${detail}` : ''}`);
    }
    if (!data) throw new Error(`接口返回的不是 JSON${text ? `：${safeDetail(text, llm.apiKey)}` : ''}`);
    return data;
}

export function stripThinking(text) {
    let out = String(text || '');
    out = out.replace(/^\s*<(think|thinking)>[\s\S]*?<\/\1>\s*/i, '');
    return out.trim();
}

async function viaTavern(messages) {
    const h = helper();
    if (h && typeof h.generateRaw === 'function') {
        return String(await h.generateRaw({ should_stream: false, should_silence: true, ordered_prompts: messages }) || '');
    }
    const c = ctx();
    if (c && typeof c.generateRaw === 'function') {
        const system = messages.filter(msg => msg.role === 'system').map(msg => msg.content).join('\n\n');
        const rest = messages.filter(msg => msg.role !== 'system').map(msg => `${msg.role === 'user' ? '用户' : 'AI'}：${msg.content}`).join('\n\n');
        return String(await c.generateRaw({ systemPrompt: system, prompt: rest }) || '');
    }
    throw new Error('当前酒馆不支持后台生成，请改用独立接口');
}

async function viaCustom(messages, llm, signal) {
    if (!String(llm.model || '').trim()) throw new Error('请先选择模型');
    const body = { ...connection(llm), model: llm.model, stream: false, messages };
    const temperature = Number(llm.temperature);
    if (llm.temperature !== '' && Number.isFinite(temperature)) body.temperature = temperature;
    const data = await postBackend('generate', body, llm, signal);
    return String(data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content || '');
}

// signal 中止时立即以 AbortError 结束。走酒馆当前 API 时底层请求取消不了，迟到的结果直接丢弃。
export async function requestLlm(messages, llm, { timeoutMs = 180000, signal } = {}) {
    const view = hostWindow();
    const controller = new view.AbortController();
    let timer;
    let onAbort = null;
    const timeout = new Promise((_, reject) => {
        timer = view.setTimeout(() => { controller.abort(); reject(new Error('请求超时')); }, timeoutMs);
    });
    const stopped = new Promise((_, reject) => {
        if (!signal) return;
        onAbort = () => {
            controller.abort();
            const error = new Error('已停止');
            error.name = 'AbortError';
            reject(error);
        };
        if (signal.aborted) onAbort();
        else signal.addEventListener('abort', onAbort, { once: true });
    });
    try {
        const job = llm.source === 'custom' ? viaCustom(messages, llm, controller.signal) : viaTavern(messages);
        job.catch(() => {});
        const text = stripThinking(await Promise.race([job, timeout, stopped]));
        if (!text) throw new Error('模型没有返回内容');
        return text;
    } finally {
        view.clearTimeout(timer);
        if (signal && onAbort) signal.removeEventListener('abort', onAbort);
    }
}

export async function fetchModels(llm) {
    const data = await postBackend('status', connection(llm), llm);
    const list = Array.isArray(data && data.data) ? data.data : data && data.models;
    const models = [...new Set((Array.isArray(list) ? list : []).map(item => (typeof item === 'string' ? item : item && (item.id || item.name))).filter(Boolean))];
    if (!models.length) throw new Error('接口没有返回模型列表');
    return models.sort();
}
