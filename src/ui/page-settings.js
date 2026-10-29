import { BUILTIN_GUIDE } from '../core/guide.js';
import { LLM_ROLES } from '../core/store.js';
import { fetchModels } from '../host/llm.js';
import { toast } from '../host/st.js';
import { esc, options } from './dom.js';

const st = view => view.tabState('settings');

const ROLE_HINT = {
    discuss: '讨论页的对话。',
    outline: '整理设定、编写大纲时的生成。',
    check: '每隔数楼判断当前阶段是否已演完。',
};

// 拉到模型列表后用下拉框直接选；列表里没有的模型可切到手动输入。
function modelField(view, role, llm) {
    const s = st(view);
    const models = s.models?.[role] || [];
    const manual = !models.length || s.manual?.[role];
    const input = manual
        ? `<input class="pi-inp" data-llm="${role}" data-k="model" value="${esc(llm.model)}" placeholder="模型名称">`
        : `<select class="pi-sel" data-llm="${role}" data-k="model">${llm.model && !models.includes(llm.model) ? `<option value="${esc(llm.model)}" selected>${esc(llm.model)}</option>` : ''}
            ${!llm.model ? '<option value="" selected disabled>选择模型</option>' : ''}${options(models.map(model => ({ value: model, label: model })), llm.model)}
            <option value="__manual">手动输入…</option></select>`;
    return `<div class="pi-field"><span>模型</span><div class="pi-inline">${input}
        <button type="button" class="pi-btn" data-act="models" data-role="${role}">${s.loading === role ? '<span class="pi-spin"></span>' : ''}获取列表</button></div></div>`;
}

function llmCard(view, s) {
    const role = LLM_ROLES.some(item => item.key === st(view).role) ? st(view).role : LLM_ROLES[0].key;
    const llm = s.llm[role];
    const custom = llm.source === 'custom';
    const seg = LLM_ROLES.map(item => `<button type="button" class="pi-seg-btn${item.key === role ? ' is-sel' : ''}" data-act="llm-role" data-role="${item.key}">${esc(item.label)}</button>`).join('');
    return `<div class="pi-card"><h3>模型接口</h3>
        <div class="pi-seg">${seg}</div>
        <p class="pi-hint">${ROLE_HINT[role]}</p>
        <label class="pi-field"><span>接口来源</span><select class="pi-sel" data-llm="${role}" data-k="source">${options([{ value: 'tavern', label: '酒馆当前连接' }, { value: 'custom', label: '独立接口（OpenAI兼容）' }], llm.source)}</select></label>
        ${custom ? `<label class="pi-field"><span>接口地址</span><input class="pi-inp" data-llm="${role}" data-k="endpoint" value="${esc(llm.endpoint)}" placeholder="https://api.example.com/v1"></label>
        <label class="pi-field"><span>API密钥</span><input class="pi-inp" type="password" autocomplete="off" data-llm="${role}" data-k="apiKey" value="${esc(llm.apiKey)}"></label>
        ${modelField(view, role, llm)}
        <label class="pi-field"><span>温度</span><input class="pi-inp is-num" data-llm="${role}" data-k="temperature" value="${esc(llm.temperature)}" placeholder="默认"></label>
        <p class="pi-hint">密钥保存在酒馆服务器的 pi-index.json 中。</p>`
        : `<p class="pi-hint">${role === 'check' ? '与主聊天共用酒馆连接时需要排队，建议为进度检测单独配置一个低价模型。' : '使用酒馆当前连接的模型。'}</p>`}
        </div>`;
}

function guideCard(view, s) {
    const open = st(view).guideOpen;
    const status = s.guide ? `自定义文本，${s.guide.length}字` : '内置版本';
    return `<div class="pi-card"><h3>写作基准<span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="guide-toggle">${open ? '收起' : '编辑'}</button></h3>
        <p class="pi-hint">讨论与整理设定时参照的《同人世界观速成》。当前使用：${status}。</p>
        ${open ? `<div class="pi-row pi-acts-top"><button type="button" class="pi-btn is-sm" data-act="guide-show">载入内置文本</button>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="guide-reset"${s.guide ? '' : ' disabled'}>恢复内置版本</button></div>
        <textarea class="pi-ta is-mono is-tall" data-set="guide" placeholder="留空则使用内置版本">${esc(s.guide)}</textarea>` : ''}</div>`;
}

export function render(view) {
    const s = view.data.settings();
    const visibility = [{ value: 'name', label: '仅名称' }, { value: 'range', label: '名称与时间范围' }, { value: 'instr', label: '名称、时间范围与AI指令' }];
    const sources = [{ value: 'both', label: 'AI标记与定期检测' }, { value: 'signal', label: '仅AI标记' }, { value: 'check', label: '仅定期检测' }];
    const modes = [{ value: 'ask', label: '弹出确认' }, { value: 'auto', label: '自动推进（可撤销）' }, { value: 'nodes', label: '仅勾选节点，不推进阶段' }];
    const checking = s.switchSource !== 'signal';
    return `<div class="pi-card"><h3>注入内容</h3>
        <div class="pi-row is-top">
            <label class="pi-field pi-grow"><span>详细条目的标签名</span><input class="pi-inp" data-set="tagName" value="${esc(s.tagName)}"></label>
            <label class="pi-field"><span>保留已完成阶段数</span><input class="pi-inp is-num" type="number" min="0" data-set="keepDone" value="${s.keepDone}"></label></div>
        <label class="pi-field"><span>索引中下一阶段的显示内容</span><select class="pi-sel" data-set="nextVisibility">${options(visibility, s.nextVisibility)}</select></label>
        <label class="pi-check"><input type="checkbox" data-set="hideSignal"${s.hideSignal ? ' checked' : ''}><span>在聊天中隐藏 &lt;剧情推进/&gt; 标记（仅隐藏显示，不修改楼层原文）</span></label></div>
        <div class="pi-card"><h3>阶段推进</h3>
        <label class="pi-field"><span>判断方式</span><select class="pi-sel" data-set="switchSource">${options(sources, s.switchSource)}</select></label>
        <label class="pi-field"><span>判定阶段已演完后</span><select class="pi-sel" data-set="handleMode">${options(modes, s.handleMode)}</select></label>
        ${checking ? `<div class="pi-row is-top"><label class="pi-field"><span>检测间隔（楼）</span><input class="pi-inp is-num" type="number" min="1" data-set="checkEvery" value="${s.checkEvery}"></label>
            <label class="pi-field"><span>每次读取楼数</span><input class="pi-inp is-num" type="number" min="1" data-set="checkFloors" value="${s.checkFloors}"></label></div>` : ''}</div>
        ${llmCard(view, s)}
        ${guideCard(view, s)}
        <div class="pi-card"><h3>版本更新</h3>
        <p class="pi-hint">当前版本 v${esc(view.version)}。默认自动使用最新发布版本。</p>
        <label class="pi-field"><span>指定版本</span><input class="pi-inp" data-set="loaderRef" value="${esc(s.loaderRef)}" placeholder="留空跟随最新版本"></label>
        <p class="pi-hint">填写 v0.1.0 等版本号可固定版本，填写 main 使用开发中的最新代码。修改后刷新酒馆页面生效。</p></div>`;
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
        if (target.value === '__manual') {
            st(view).manual = { ...st(view).manual, [target.dataset.llm]: true };
        } else {
            applyLlm(view, target);
        }
        view.renderBody();
    }
    if (target.dataset.set && target.tagName !== 'SELECT' && target.type !== 'checkbox') view.runtime.refresh();
}

export const actions = {
    async models(view, target) {
        const role = target.dataset.role;
        const s = st(view);
        if (s.loading) return;
        s.loading = role;
        view.renderBody();
        try {
            const models = await fetchModels(view.data.settings().llm[role]);
            s.models = { ...s.models, [role]: models };
            s.manual = { ...s.manual, [role]: false };
            toast('success', `获取到${models.length}个模型，可在下拉框中选择。`);
        } finally {
            s.loading = '';
            view.renderBody();
        }
    },
    'llm-role'(view, target) {
        st(view).role = target.dataset.role;
        view.renderBody();
    },
    'guide-toggle'(view) {
        st(view).guideOpen = !st(view).guideOpen;
        view.renderBody();
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
