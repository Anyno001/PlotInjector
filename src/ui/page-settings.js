import { BUILTIN_GUIDE } from '../core/guide.js';
import { LLM_ROLES } from '../core/store.js';
import { fetchModels } from '../host/llm.js';
import { toast } from '../host/st.js';
import { esc, options } from './dom.js';

const st = view => view.tabState('settings');

function llmCard(view, role, llm) {
    const models = st(view).models?.[role.key] || [];
    const custom = llm.source === 'custom';
    return `<div class="pi-card"><h3>接口 · ${esc(role.label)}</h3>
        <label class="pi-field"><span>来源</span><select class="pi-sel" data-llm="${role.key}" data-k="source">${options([{ value: 'tavern', label: '酒馆当前 API' }, { value: 'custom', label: '独立 OpenAI 兼容接口' }], llm.source)}</select></label>
        ${custom ? `<label class="pi-field"><span>地址</span><input class="pi-inp" data-llm="${role.key}" data-k="endpoint" value="${esc(llm.endpoint)}" placeholder="https://api.example.com/v1"></label>
        <label class="pi-field"><span>密钥（存在酒馆本地 pi-index.json）</span><input class="pi-inp" type="password" autocomplete="off" data-llm="${role.key}" data-k="apiKey" value="${esc(llm.apiKey)}"></label>
        <div class="pi-row"><label class="pi-field pi-grow"><span>模型</span><input class="pi-inp" data-llm="${role.key}" data-k="model" value="${esc(llm.model)}" list="pi-models-${role.key}"></label>
            <button type="button" class="pi-btn is-sm" data-act="models" data-role="${role.key}">拉取模型</button>
            <label class="pi-field"><span>温度</span><input class="pi-inp is-num" data-llm="${role.key}" data-k="temperature" value="${esc(llm.temperature)}" placeholder="默认"></label></div>
        <datalist id="pi-models-${role.key}">${models.map(model => `<option value="${esc(model)}">`).join('')}</datalist>`
        : `<p class="pi-hint">${role.key === 'check' ? '酒馆 API 会和主聊天抢队列，检测建议用独立接口的便宜模型。' : '使用酒馆当前连接的模型。'}</p>`}
        </div>`;
}

export function render(view) {
    const s = view.data.settings();
    const visibility = [{ value: 'name', label: '只名称' }, { value: 'range', label: '名称 + 时间范围' }, { value: 'instr', label: '名称 + 时间范围 + AI指令' }];
    const sources = [{ value: 'both', label: 'AI 报信 + 定期检测' }, { value: 'signal', label: '只用 AI 报信' }, { value: 'check', label: '只用定期检测' }];
    const modes = [{ value: 'ask', label: '询问' }, { value: 'auto', label: '自动切换（可撤销）' }, { value: 'nodes', label: '只勾节点，不切阶段' }];
    return `<div class="pi-card"><h3>注入</h3>
        <div class="pi-row">
            <label class="pi-field pi-grow"><span>详细条目标签名</span><input class="pi-inp" data-set="tagName" value="${esc(s.tagName)}"></label>
            <label class="pi-field"><span>「已过」保留阶段数</span><input class="pi-inp is-num" type="number" min="0" data-set="keepDone" value="${s.keepDone}"></label></div>
        <label class="pi-field"><span>索引里「下一段」露出</span><select class="pi-sel" data-set="nextVisibility">${options(visibility, s.nextVisibility)}</select></label>
        <label class="pi-check"><input type="checkbox" data-set="hideSignal"${s.hideSignal ? ' checked' : ''}><span>聊天里隐藏 &lt;剧情推进/&gt;（只隐藏显示，楼层原文不改）</span></label></div>
        <div class="pi-card"><h3>切换判定</h3>
        <label class="pi-field"><span>切换来源</span><select class="pi-sel" data-set="switchSource">${options(sources, s.switchSource)}</select></label>
        <label class="pi-field"><span>判定为演完时</span><select class="pi-sel" data-set="handleMode">${options(modes, s.handleMode)}</select></label>
        <div class="pi-row"><label class="pi-field"><span>每几楼检测一次</span><input class="pi-inp is-num" type="number" min="1" data-set="checkEvery" value="${s.checkEvery}"></label>
            <label class="pi-field"><span>检测读最近几楼</span><input class="pi-inp is-num" type="number" min="1" data-set="checkFloors" value="${s.checkFloors}"></label></div></div>
        ${LLM_ROLES.map(role => llmCard(view, role, s.llm[role.key])).join('')}
        <div class="pi-card"><h3>写作基准<span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm" data-act="guide-show">填入内置版本</button>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="guide-reset"${s.guide ? '' : ' disabled'}>恢复内置</button></h3>
        <p class="pi-hint">讨论和整理设定时用的《同人世界观速成》。留空使用内置版本。</p>
        <textarea class="pi-ta is-mono is-tall" data-set="guide" placeholder="（使用内置版本）">${esc(s.guide)}</textarea></div>
        <div class="pi-card"><h3>版本</h3>
        <p class="pi-hint">当前运行 v${esc(view.version)}。加载器默认读取仓库最新版本标签。</p>
        <label class="pi-field"><span>锁定版本（填 v0.1.0 这类标签；填 main 用最新提交；留空跟随最新标签）</span><input class="pi-inp" data-set="loaderRef" value="${esc(s.loaderRef)}"></label>
        <p class="pi-hint">修改后刷新酒馆页面生效。</p></div>`;
}

const NUMERIC = new Set(['keepDone', 'checkEvery', 'checkFloors']);

function readValue(target) {
    if (target.type === 'checkbox') return target.checked;
    return NUMERIC.has(target.dataset.set) ? Number(target.value) : target.value;
}

function applyLlm(view, target) {
    const role = target.dataset.llm;
    const llm = view.data.settings().llm;
    view.data.updateSettings({ llm: { ...llm, [role]: { ...llm[role], [target.dataset.k]: target.value.trim() } } });
}

export function onInput(view, target) {
    if (target.dataset.set && target.type !== 'checkbox' && target.tagName !== 'SELECT') view.data.updateSettings({ [target.dataset.set]: readValue(target) });
    if (target.dataset.llm && target.tagName === 'INPUT') applyLlm(view, target);
}

export function onChange(view, target) {
    if (target.dataset.set && (target.type === 'checkbox' || target.tagName === 'SELECT')) {
        view.data.updateSettings({ [target.dataset.set]: readValue(target) });
        view.runtime.refresh();
        view.renderBody();
    }
    if (target.dataset.llm && target.tagName === 'SELECT') {
        applyLlm(view, target);
        view.renderBody();
    }
    if (target.dataset.set && target.tagName !== 'SELECT' && target.type !== 'checkbox') view.runtime.refresh();
}

export const actions = {
    async models(view, target) {
        const role = target.dataset.role;
        target.disabled = true;
        try {
            const models = await fetchModels(view.data.settings().llm[role]);
            st(view).models = { ...st(view).models, [role]: models };
            toast('success', `拉到 ${models.length} 个模型。`);
            view.renderBody();
        } finally {
            target.disabled = false;
        }
    },
    'guide-show'(view) {
        view.data.updateSettings({ guide: BUILTIN_GUIDE });
        view.renderBody();
    },
    'guide-reset'(view) {
        view.data.updateSettings({ guide: '' });
        view.renderBody();
    },
};

export const refreshOn = [];
