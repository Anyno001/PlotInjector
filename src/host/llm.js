import { ctx, helper, hostWindow, requestHeaders } from './st.js';

// 两种来源：酒馆当前 API（generateRaw，静默）；独立 OpenAI 兼容接口，经酒馆后端转发避开跨域。
function apiBase(endpoint) {
    const base = String(endpoint || '')
        .trim()
        .replace(/\/+$/, '');
    if (!base) throw new Error('请先填写接口地址');
    let parsed;
    try {
        parsed = new URL(base);
    } catch {
        throw new Error('接口地址无效');
    }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('接口地址需以http:// 或https:// 开头');
    const root = base.replace(/\/(?:chat\/completions|models)$/i, '');
    return /\/v\d+$/i.test(root) ? root : `${root}/v1`;
}

export function safeDetail(value, apiKey) {
    let text = String(value || '');
    const key = String(apiKey || '').trim();
    if (key) text = text.split(key).join('[已隐藏]');
    return text
        .replace(/<[^>]*>/g, '')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 160);
}

function connection(llm) {
    const key = String(llm.apiKey || '').trim();
    return {
        chat_completion_source: 'custom',
        custom_url: apiBase(llm.endpoint),
        custom_include_headers: JSON.stringify({ Authorization: key ? `Bearer ${key}` : '' }),
    };
}

// 有的接口无视 stream:false 硬回 SSE：把 data: 块拼回一条普通回复
function sseToJson(text) {
    let content = '',
        seen = false;
    for (const line of String(text || '').split('\n')) {
        const m = /^data:\s?(.*)$/.exec(line.trim());
        if (!m || m[1] === '[DONE]') continue;
        let chunk;
        try {
            chunk = JSON.parse(m[1]);
        } catch {
            continue;
        }
        seen = true;
        if (chunk && chunk.error) return { error: chunk.error };
        const delta = chunk && chunk.choices && chunk.choices[0] && (chunk.choices[0].delta || chunk.choices[0].message);
        if (delta && typeof delta.content === 'string') content += delta.content;
    }
    return seen ? { choices: [{ message: { content } }] } : null;
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
    try {
        data = JSON.parse(text);
    } catch {
        data = res.ok ? sseToJson(text) : null;
    }
    if (!res.ok || (data && data.error)) {
        const detail = safeDetail((data && data.error && (data.error.message || data.error)) || (data && data.message) || text, llm.apiKey);
        throw new Error(`接口请求失败${res.ok ? '' : `（HTTP ${res.status}）`}${detail ? `：${detail}` : ''}`);
    }
    if (!data) throw new Error(`接口返回的不是JSON${text ? `：${safeDetail(text, llm.apiKey)}` : ''}`);
    return data;
}

export function stripThinking(text) {
    let out = String(text || '');
    out = out.replace(/^\s*<(think|thinking)>[\s\S]*?<\/\1>\s*/i, '');
    return out.trim();
}

async function viaTavern(messages) {
    let mark = `[剧情注入器后台任务 ${Math.random().toString(36).slice(2, 10)}，与正文无关]`,
        i = messages.findIndex((m) => m && m.role === 'system'),
        tagged =
            i >= 0
                ? messages.map((m, k) => (k === i ? { ...m, content: `${m.content}\n\n${mark}` } : m))
                : [{ role: 'system', content: mark }, ...messages];
    backgroundMarks.add(mark);
    try {
        return await viaTavernRaw(tagged);
    } finally {
        backgroundMarks.delete(mark);
    }
}

async function viaCustom(messages, llm, signal, onText = null) {
    if (!String(llm.model || '').trim()) throw new Error('请先选择模型');
    const body = { ...connection(llm), model: llm.model, stream: false, messages };
    const temperature = Number(llm.temperature);
    if (llm.temperature !== '' && Number.isFinite(temperature)) body.temperature = temperature;
    if (onText) return viaCustomStream(body, llm, signal, onText);
    const data = await postBackend('generate', body, llm, signal);
    return String((data && data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '');
}

// 流式（用户 2026-11-22：导入长文时看不出进度）：经酒馆后端转发的 SSE，每收到一块就回调已生成的全文。
// 后端或接口不支持流式、直接回了 JSON 的，按非流式读。
async function viaCustomStream(body, llm, signal, onText) {
    const res = await hostWindow().fetch('/api/backends/chat-completions/generate', {
        method: 'POST',
        cache: 'no-cache',
        signal,
        headers: { ...requestHeaders(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...body, stream: true }),
    });
    // 不看 content-type：有的中转把 SSE 标成 text/plain 或 application/json（用户 2026-11-22 报错原文就是 keep-alive+data: 块）。
    // 按内容判断：出现 data: 行就当流读，一行都没有再按整段 JSON 读。
    if (!res.ok || !res.body) {
        const text = await res.text();
        let data = null;
        try {
            data = JSON.parse(text);
        } catch {
            /* 下面统一报错 */
        }
        if (!res.ok || !data || data.error) {
            const detail = safeDetail((data && data.error && (data.error.message || data.error)) || (data && data.message) || text, llm.apiKey);
            throw new Error(`接口请求失败${res.ok ? '' : `（HTTP ${res.status}）`}${detail ? `：${detail}` : ''}`);
        }
        return String((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '');
    }
    const reader = res.body.getReader(),
        decoder = new TextDecoder();
    let buf = '',
        raw = '',
        sawData = false,
        out = '';
    const take = (line) => {
        const m = /^data:\s?(.*)$/.exec(line.trim());
        if (!m) return;
        sawData = true;
        if (m[1] === '[DONE]') return;
        let data;
        try {
            data = JSON.parse(m[1]);
        } catch {
            return;
        }
        if (data && data.error) throw new Error(`接口请求失败：${safeDetail(data.error.message || data.error, llm.apiKey)}`);
        const delta = data && data.choices && data.choices[0] && (data.choices[0].delta || data.choices[0].message);
        const piece = delta && typeof delta.content === 'string' ? delta.content : '';
        // 思考模型先流 reasoning_content、content 为空：也回调一次，让超时从这里重新计时
        ((out += piece), onText(out));
    };
    for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        const chunk = decoder.decode(value, { stream: true });
        if (!sawData) raw += chunk;
        buf += chunk;
        const rows = buf.split('\n');
        buf = rows.pop();
        rows.forEach(take);
    }
    const tail = decoder.decode();
    if (!sawData) raw += tail;
    (buf += tail) && take(buf);
    if (sawData) return out;
    // 接口没按流式回，整段是普通 JSON
    let data = null;
    try {
        data = JSON.parse(raw);
    } catch {
        /* 下面统一报错 */
    }
    if (!data || data.error) {
        const detail = safeDetail((data && data.error && (data.error.message || data.error)) || (data && data.message) || raw, llm.apiKey);
        throw new Error(`接口请求失败${detail ? `：${detail}` : ''}`);
    }
    return String((data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content) || '');
}

// signal 中止时立即以 AbortError 结束。走酒馆当前 API 时底层请求取消不了，迟到的结果直接丢弃。
// onText：只有独立接口会流式回调已生成的文字；这时超时按「多久没收到新内容」算，长回复不会因为总时长被掐断。
export async function requestLlm(messages, llm, { timeoutMs = 180000, signal, onText } = {}) {
    const view = hostWindow();
    // 关了流式就收不到中途进度，超时只能按总时长算：调用方本想流式（长回复）的，放宽到 10 分钟
    if (onText && llm.source === 'custom' && llm.stream === 'off') ((onText = null), (timeoutMs = Math.max(timeoutMs, 600000)));
    const controller = new view.AbortController();
    let timer;
    let onAbort = null;
    let fail = null;
    const arm = () => {
        view.clearTimeout(timer);
        timer = view.setTimeout(() => {
            controller.abort();
            fail && fail(new Error('请求超时'));
        }, timeoutMs);
    };
    const timeout = new Promise((_, reject) => {
        fail = reject;
        arm();
    });
    const live = onText
        ? (text) => {
              arm();
              try {
                  onText(text);
              } catch {
                  /* 进度显示出错不影响请求 */
              }
          }
        : null;
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
        const job = llm.source === 'custom' ? viaCustom(messages, llm, controller.signal, live) : viaTavern(messages);
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
    const models = [
        ...new Set(
            (Array.isArray(list) ? list : [])
                .map((item) => (typeof item === 'string' ? item : item && (item.id || item.name)))
                .filter(Boolean),
        ),
    ];
    if (!models.length) throw new Error('接口没有返回模型列表');
    return models.sort();
}

export const backgroundMarks = /* @__PURE__ */ new Set();

export function isBackgroundRequest(text) {
    if (!backgroundMarks.size) return !1;
    let s = String(text || '');
    for (let mark of backgroundMarks) if (s.includes(mark)) return !0;
    return !1;
}

export async function viaTavernRaw(messages) {
    let h = helper();
    if (h && typeof h.generateRaw == 'function')
        return String((await h.generateRaw({ should_stream: !1, should_silence: !0, ordered_prompts: messages })) || '');
    let c = ctx();
    if (c && typeof c.generateRaw == 'function') {
        let system = messages.filter((msg) => msg.role === 'system').map((msg) => msg.content).join(`

`),
            rest = messages.filter((msg) => msg.role !== 'system').map((msg) => `${msg.role === 'user' ? '用户' : 'AI'}：${msg.content}`)
                .join(`

`);
        return String((await c.generateRaw({ systemPrompt: system, prompt: rest })) || '');
    }
    throw new Error('当前酒馆不支持后台生成，请改用独立接口');
}
