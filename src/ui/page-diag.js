import { resolveLlm } from '../core/store.js';
import { cardName, ctx, hostDocument, hostWindow, toast } from '../host/st.js';
import { esc } from './dom.js';

// 诊断：自动检测为什么没跑。只读运行时状态，修复按钮各自对应一种已知原因。
const NEED = ['CHAT_CHANGED', 'MESSAGE_RECEIVED'];
const EVENT_LABELS = {
    WORLDINFO_ENTRIES_LOADED: '条目加载（注入）',
    CHAT_CHANGED: '切换聊天',
    MESSAGE_RECEIVED: '收到回复（触发检测）',
    MESSAGE_UPDATED: '编辑楼层',
    MESSAGE_DELETED: '删除楼层',
    MESSAGE_SWIPED: '切换回复',
    GENERATION_STARTED: '开始生成',
    GENERATION_ENDED: '生成结束',
    GENERATION_STOPPED: '停止生成',
};

const time = at => (at ? new Date(at).toLocaleTimeString('zh-CN', { hour12: false }) : '—');

function collect(view) {
    const { data, runtime } = view;
    const d = runtime.diagnose();
    const settings = data.settings();
    const id = runtime.activeId();
    const meta = data.index().projects.find(item => item.id === id);
    const progress = id ? runtime.progress() : null;
    const llm = resolveLlm(settings, 'check');
    const c = ctx();
    return { ...d, settings, id, name: meta ? meta.name : '', progress, llm, units: id ? runtime.units().length : 0, card: cardName(), chatId: c && typeof c.getCurrentChatId === 'function' ? c.getCurrentChatId() || '' : '', version: view.version };
}

// 每条问题带一个修复动作（可为空）。
function problems(info) {
    const out = [];
    if (!info.hasContext || !info.hasEventSource) out.push({ text: '读不到酒馆的事件接口，酒馆版本可能过旧。', fix: '' });
    const missing = info.events.filter(item => NEED.includes(item.key) && !item.name);
    if (missing.length) out.push({ text: `酒馆没有提供事件：${missing.map(item => item.key).join('、')}。`, fix: '' });
    const unbound = info.events.filter(item => NEED.includes(item.key) && item.name && !item.bound);
    if (unbound.length) out.push({ text: '检测所需的事件没有绑定。', fix: 'rebind' });
    if (!info.cardKey) out.push({ text: '当前没有打开角色卡聊天。', fix: '' });
    else if (!info.id) out.push({ text: `「${info.card}」没有启用项目，自动检测不会运行。`, fix: '' });
    else if (!info.units) out.push({ text: '启用项目的大纲为空，没有可检测的阶段。', fix: '' });
    if (info.progress && info.progress.lastCheckFloor > info.floors) out.push({ text: `上次检测记在第 ${info.progress.lastCheckFloor} 楼，当前只有 ${info.floors} 楼。`, fix: 'reset-base' });
    if (info.llm.source === 'custom' && !String(info.llm.model || '').trim()) out.push({ text: '进度检测用独立接口，但没有选择模型。', fix: '' });
    const received = info.events.find(item => item.key === 'MESSAGE_RECEIVED');
    if (received && received.bound && !received.count && info.floors > 1) out.push({ text: '本次加载后还没收到过「收到回复」事件。发一条消息后再看，仍为 0 次可点「重新绑定事件」。', fix: 'rebind' });
    return out;
}

function nextText(info) {
    if (!info.progress) return '—';
    const gap = info.floors - info.progress.lastCheckFloor;
    const left = info.settings.checkEvery - gap;
    return left > 0 ? `还差 ${left} 楼` : '下一条回复后检测';
}

function rows(info) {
    const state = info.checking ? '检测中' : info.pending ? '等待主回复生成结束' : info.generating ? '主回复生成中' : '空闲';
    const llm = info.llm.source === 'custom' ? `独立接口 ${info.llm.model || '（未选模型）'}` : '酒馆当前接口';
    return [
        ['版本', `v${info.version}`],
        ['角色卡', info.card || '—'],
        ['聊天', info.chatId || '—'],
        ['启用项目', info.name || '—'],
        ['当前楼数', String(info.floors)],
        ['上次检测楼层', info.progress ? String(info.progress.lastCheckFloor) : '—'],
        ['检测间隔', `每 ${info.settings.checkEvery} 楼`],
        ['下次检测', nextText(info)],
        ['检测接口', llm],
        ['状态', state],
    ];
}

function plainText(info) {
    const lines = ['【剧情注入器诊断】', ...rows(info).map(([k, v]) => `${k}：${v}`), '', '【事件】'];
    for (const item of info.events) lines.push(`${item.key}（${item.name || '酒馆未提供'}）：${item.bound ? `已绑定，收到 ${item.count} 次，最近 ${time(item.at)}` : '未绑定'}`);
    const list = problems(info);
    lines.push('', '【问题】', ...(list.length ? list.map(item => `- ${item.text}`) : ['无']));
    lines.push('', '【最近记录】', ...(info.logs.length ? info.logs.map(item => `${time(item.at)} ${item.text}`) : ['无']));
    return lines.join('\n');
}

export function render(view) {
    const info = collect(view);
    const list = problems(info);
    const fixes = { rebind: '重新绑定事件', 'reset-base': '从当前楼重新计数' };
    const problemHtml = list.length
        ? list.map(item => `<div class="pi-diag-row"><span class="pi-badge is-warn">问题</span><span class="pi-diag-text">${esc(item.text)}</span>${item.fix ? `<button type="button" class="pi-btn is-sm" data-act="${item.fix}">${fixes[item.fix]}</button>` : ''}</div>`).join('')
        : '<p class="pi-hint">没有发现问题。</p>';
    const events = info.events.map(item => `<tr><td>${esc(EVENT_LABELS[item.key] || item.key)}</td>
        <td>${!item.name ? '<span class="pi-badge is-danger">酒馆未提供</span>' : item.bound ? '<span class="pi-badge is-ok">已绑定</span>' : '<span class="pi-badge is-warn">未绑定</span>'}</td>
        <td>${item.count} 次</td><td>${time(item.at)}</td></tr>`).join('');
    const logs = info.logs.length ? info.logs.slice().reverse().map(item => `${time(item.at)}  ${item.text}`).join('\n') : '暂无记录';
    return `<div class="pi-card"><h3>自动检测${list.length ? `<span class="pi-badge is-warn">${list.length} 个问题</span>` : '<span class="pi-badge is-ok">正常</span>'}</h3>
        <table class="pi-files"><tbody>${rows(info).map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>
        <div class="pi-tools is-c4 is-end">
            <button type="button" class="pi-btn is-sm is-primary" data-act="check"${info.checking ? ' disabled' : ''}>立即检测</button>
            <button type="button" class="pi-btn is-sm" data-act="reset-base"${info.progress ? '' : ' disabled'}>从当前楼重新计数</button>
            <button type="button" class="pi-btn is-sm" data-act="rebind">重新绑定事件</button>
            <button type="button" class="pi-btn is-sm" data-act="copy">复制诊断</button></div></div>
        <div class="pi-card"><h3>问题</h3>${problemHtml}</div>
        <div class="pi-card"><h3>酒馆事件</h3>
        <table class="pi-files"><thead><tr><th>事件</th><th>状态</th><th>收到</th><th>最近</th></tr></thead><tbody>${events}</tbody></table></div>
        <div class="pi-card"><h3>最近记录</h3><pre class="pi-pre">${esc(logs)}</pre></div>`;
}

async function copyText(text) {
    const doc = hostDocument();
    try {
        await hostWindow().navigator.clipboard.writeText(text);
        return true;
    } catch {
        const box = doc.createElement('textarea');
        box.value = text;
        box.className = 'pi-copy-box';
        doc.body.appendChild(box);
        box.select();
        const ok = Boolean(doc.execCommand && doc.execCommand('copy'));
        box.remove();
        return ok;
    }
}

export const actions = {
    async check(view) {
        await view.runtime.checkNow({ manual: true });
        view.renderBody();
    },
    'reset-base'(view) {
        view.runtime.resetBase();
        toast('success', '已从当前楼重新计数。');
        view.renderBody();
    },
    rebind(view) {
        view.runtime.rebind();
        toast('success', '已重新绑定酒馆事件。');
        view.renderBody();
    },
    async copy(view) {
        const ok = await copyText(plainText(collect(view)));
        toast(ok ? 'success' : 'warning', ok ? '已复制诊断' : '复制失败，请手动选择文字复制');
    },
};
