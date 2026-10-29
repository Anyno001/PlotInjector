import { makeId } from '../core/outline.js';
import { DEFAULT_PRESET, LLM_ROLES } from '../core/store.js';
import { fetchModels } from '../host/llm.js';
import { toast } from '../host/st.js';
import { confirmDialog, esc, openDialog, options } from './dom.js';
import { ICONS } from './styles.js';

const st = view => view.tabState('settings');

function modelInput(value) {
    return `<input class="pi-inp" data-f="model" value="${esc(value)}" placeholder="模型名称">`;
}

// 获取到列表后换成下拉框；列表里没有的模型选「手动输入…」切回输入框。
function modelSelect(models, value) {
    const extra = value && !models.includes(value) ? `<option value="${esc(value)}">${esc(value)}</option>` : '';
    const empty = value ? '' : '<option value="" selected disabled>选择模型</option>';
    return `<select class="pi-sel" data-f="model">${empty}${extra}${options(models.map(model => ({ value: model, label: model })), value)}<option value="__manual">手动输入…</option></select>`;
}

function readPreset(box) {
    const out = {};
    for (const key of ['name', 'endpoint', 'apiKey', 'model', 'temperature']) out[key] = box.querySelector(`[data-f="${key}"]`).value.trim();
    return out;
}

function editPreset(preset, isNew = false) {
    const html = `<label class="pi-field"><span>名称</span><input class="pi-inp" data-f="name" value="${esc(preset.name)}" placeholder="如：DeepSeek"></label>
        <label class="pi-field"><span>接口地址</span><input class="pi-inp" data-f="endpoint" value="${esc(preset.endpoint)}" placeholder="https://api.example.com/v1"></label>
        <label class="pi-field"><span>API密钥</span><input class="pi-inp" type="password" autocomplete="off" data-f="apiKey" value="${esc(preset.apiKey)}"></label>
        <div class="pi-field"><span>模型</span><div class="pi-inline"><span class="pi-grow" data-model-box>${modelInput(preset.model)}</span>
            <button type="button" class="pi-btn" data-fetch-models>获取列表</button></div></div>
        <label class="pi-field"><span>温度</span><input class="pi-inp is-num" data-f="temperature" value="${esc(preset.temperature)}" placeholder="默认"></label>
        <p class="pi-hint">兼容OpenAI格式的接口，经酒馆后端转发。密钥保存在酒馆服务器的 pi-index.json 中。</p>`;
    return openDialog({
        title: isNew ? '新建接口预设' : '编辑接口预设',
        html,
        actions: [
            { label: '取消', value: null },
            { label: '保存', primary: true, value: box => ({ ...preset, ...readPreset(box) }) },
        ],
        onMount(box) {
            const slot = box.querySelector('[data-model-box]');
            const button = box.querySelector('[data-fetch-models]');
            let models = [];
            button.addEventListener('click', async () => {
                const current = readPreset(box);
                button.disabled = true;
                button.innerHTML = '<span class="pi-spin"></span>获取列表';
                try {
                    models = await fetchModels(current);
                    slot.innerHTML = modelSelect(models, current.model);
                    toast('success', `获取到${models.length}个模型。`);
                } catch (error) {
                    toast('error', error.message);
                } finally {
                    button.disabled = false;
                    button.textContent = '获取列表';
                }
            });
            slot.addEventListener('change', event => {
                if (event.target.value === '__manual') {
                    slot.innerHTML = modelInput('');
                    slot.querySelector('input').focus();
                }
            });
        },
    });
}

function apiCard(s) {
    const presets = s.presets;
    const usedBy = id => LLM_ROLES.filter(role => s.llm[role.key].source === 'preset' && s.llm[role.key].presetId === id).map(role => role.label);
    const list = presets.map(preset => `<div class="pi-preset">
            <span class="pi-preset-name" title="${esc(preset.name)}">${esc(preset.name)}</span>
            <span class="pi-preset-model" title="${esc(preset.model)}">${esc(preset.model || '未选模型')}</span>
            ${usedBy(preset.id).length ? `<span class="pi-badge is-accent">${esc(usedBy(preset.id).join('、'))}</span>` : ''}
            <button type="button" class="pi-icon-btn" data-act="preset-edit" data-id="${esc(preset.id)}" title="编辑">${ICONS.pencil}</button>
            <button type="button" class="pi-icon-btn is-danger" data-act="preset-del" data-id="${esc(preset.id)}" title="删除">${ICONS.trash}</button></div>`).join('');
    const choices = [{ value: 'tavern', label: '酒馆当前连接' }, ...presets.map(preset => ({ value: `p:${preset.id}`, label: preset.name }))];
    const picks = LLM_ROLES.map(role => {
        const llm = s.llm[role.key];
        const value = llm.source === 'preset' ? `p:${llm.presetId}` : 'tavern';
        return `<label class="pi-field"><span>${esc(role.label)}</span><select class="pi-sel" data-role-pick="${role.key}">${options(choices, value)}</select></label>`;
    }).join('');
    return `<div class="pi-card"><h3>模型接口</h3>
        <p class="pi-hint">接口预设保存一套地址、密钥和模型，三个用途可共用同一个预设。</p>
        ${list ? `<div class="pi-presets">${list}</div>` : ''}
        <button type="button" class="pi-btn is-sm" data-act="preset-new">${ICONS.plus}新建接口预设</button>
        <div class="pi-roles">${picks}</div>
        <p class="pi-hint">与主聊天共用酒馆连接时需要排队，进度检测建议单独使用一个低价模型。</p></div>`;
}

function guideCard(view, s) {
    const open = st(view).guideOpen;
    const status = s.guide ? '自定义版本' : '内置版本';
    return `<div class="pi-card"><h3>写作基准<span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="guide-toggle">${open ? '收起' : '编辑'}</button></h3>
        <p class="pi-hint">当前使用：${status}</p>
        ${open ? `<div class="pi-row pi-acts-top"><button type="button" class="pi-btn is-sm is-ghost" data-act="guide-reset"${s.guide ? '' : ' disabled'}>恢复内置版本</button></div>
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
        ${apiCard(s)}
        ${guideCard(view, s)}`;
}

const NUMERIC = new Set(['keepDone', 'checkEvery', 'checkFloors']);

function readValue(target) {
    if (target.type === 'checkbox') return target.checked;
    return NUMERIC.has(target.dataset.set) ? Number(target.value) : target.value;
}

export function onInput(view, target) {
    if (target.dataset.set && target.type !== 'checkbox' && target.tagName !== 'SELECT') view.data.updateSettings({ [target.dataset.set]: readValue(target) });
}

export function onChange(view, target) {
    if (target.dataset.set && (target.type === 'checkbox' || target.tagName === 'SELECT')) {
        view.data.updateSettings({ [target.dataset.set]: readValue(target) });
        view.runtime.refresh();
        view.renderBody();
    }
    if (target.dataset.rolePick) {
        const value = target.value;
        const pick = value.startsWith('p:') ? { source: 'preset', presetId: value.slice(2) } : { source: 'tavern', presetId: '' };
        view.data.updateSettings({ llm: { ...view.data.settings().llm, [target.dataset.rolePick]: pick } });
        view.renderBody();
    }
    if (target.dataset.set && target.tagName !== 'SELECT' && target.type !== 'checkbox') view.runtime.refresh();
}

function savePreset(view, preset) {
    const s = view.data.settings();
    const name = preset.name || preset.model || `接口${s.presets.length + 1}`;
    const next = { ...preset, name };
    const presets = s.presets.some(item => item.id === next.id) ? s.presets.map(item => (item.id === next.id ? next : item)) : [...s.presets, next];
    view.data.updateSettings({ presets });
}

export const actions = {
    async 'preset-new'(view) {
        const result = await editPreset({ ...DEFAULT_PRESET, id: makeId('api') }, true);
        if (!result) return;
        savePreset(view, result);
        view.renderBody();
    },
    async 'preset-edit'(view, target) {
        const preset = view.data.settings().presets.find(item => item.id === target.dataset.id);
        if (!preset) return;
        const result = await editPreset(preset);
        if (!result) return;
        savePreset(view, result);
        view.renderBody();
    },
    async 'preset-del'(view, target) {
        const s = view.data.settings();
        const preset = s.presets.find(item => item.id === target.dataset.id);
        if (!preset) return;
        const users = LLM_ROLES.filter(role => s.llm[role.key].presetId === preset.id).map(role => role.label);
        const body = users.length ? `${users.join('、')}正在使用这个预设，删除后改用酒馆当前连接。` : '';
        if (!(await confirmDialog({ title: `删除接口预设「${preset.name}」`, body, okLabel: '删除', danger: true }))) return;
        const llm = { ...s.llm };
        for (const role of LLM_ROLES) if (llm[role.key].presetId === preset.id) llm[role.key] = { source: 'tavern', presetId: '' };
        view.data.updateSettings({ presets: s.presets.filter(item => item.id !== preset.id), llm });
        view.renderBody();
    },
    'guide-toggle'(view) {
        st(view).guideOpen = !st(view).guideOpen;
        view.renderBody();
    },
    'guide-reset'(view) {
        view.data.updateSettings({ guide: '' });
        view.renderBody();
    },
};

export const refreshOn = [];
