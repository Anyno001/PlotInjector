import { BUILTIN_GUIDE } from '../core/guide.js';
import { makeId } from '../core/outline.js';
import { LLM_ROLES } from '../core/store.js';
import { fetchModels } from '../host/llm.js';
import { toast } from '../host/st.js';
import { confirmDialog, esc, openDialog, options, promptDialog } from './dom.js';
import { ICONS } from './styles.js';

const st = view => view.tabState('settings');

const currentRole = view => (LLM_ROLES.some(item => item.key === st(view).role) ? st(view).role : LLM_ROLES[0].key);

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
    const role = currentRole(view);
    const llm = s.llm[role];
    const custom = llm.source === 'custom';
    const seg = LLM_ROLES.map(item => `<button type="button" class="pi-seg-btn${item.key === role ? ' is-sel' : ''}" data-act="llm-role" data-role="${item.key}">${esc(item.label)}</button>`).join('');
    return `<div class="pi-card"><h3>模型接口</h3>
        <div class="pi-seg">${seg}</div>
        <label class="pi-field"><span>接口来源</span><select class="pi-sel" data-llm="${role}" data-k="source">${options([{ value: 'tavern', label: '酒馆当前连接' }, { value: 'custom', label: '独立接口（OpenAI兼容）' }], llm.source)}</select></label>
        ${custom ? `<label class="pi-field"><span>接口地址</span><input class="pi-inp" data-llm="${role}" data-k="endpoint" value="${esc(llm.endpoint)}" placeholder="https://api.example.com/v1"></label>
        <label class="pi-field"><span>API密钥</span><input class="pi-inp" type="password" autocomplete="off" data-llm="${role}" data-k="apiKey" value="${esc(llm.apiKey)}"></label>
        ${modelField(view, role, llm)}
        <label class="pi-field"><span>温度</span><input class="pi-inp" data-llm="${role}" data-k="temperature" value="${esc(llm.temperature)}" placeholder="默认"></label>`
        : ''}
        <div class="pi-tools is-c2 is-end"><button type="button" class="pi-btn is-sm" data-act="preset-load"${s.presets.length ? '' : ' disabled'}>载入预设</button>
            <button type="button" class="pi-btn is-sm" data-act="preset-save"${custom ? '' : ' disabled'}>保存为预设</button></div>
        </div>`;
}

// 载入预设：列出全部预设，点名称载入，垃圾桶删除。
function pickPreset(presets) {
    const html = presets.map(preset => `<div class="pi-preset">
            <button type="button" class="pi-preset-pick" data-dlg-value="load:${esc(preset.id)}">
                <span class="pi-preset-name">${esc(preset.name)}</span><span class="pi-preset-model">${esc(preset.model || '未选模型')}</span></button>
            <button type="button" class="pi-icon-btn is-danger" data-dlg-value="del:${esc(preset.id)}" title="删除">${ICONS.trash}</button></div>`).join('');
    return openDialog({ title: '载入接口预设', html: `<div class="pi-presets">${html}</div>`, actions: [{ label: '取消', value: null }] });
}

// 编辑框里直接给出当前生效的全文（未自定义时就是内置版本），改了才存成自定义；改回与内置一致视为未自定义。
function guideCard(view, s) {
    const open = st(view).guideOpen;
    const status = s.guide ? '自定义版本' : '内置版本';
    return `<div class="pi-card"><h3>写作基准<span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="guide-toggle">${open ? '收起' : '编辑'}</button></h3>
        <p class="pi-hint">当前使用：${status}</p>
        ${open ? `<div class="pi-row pi-acts-top"><button type="button" class="pi-btn is-sm is-ghost" data-act="guide-reset"${s.guide ? '' : ' disabled'}>恢复内置版本</button></div>
        <textarea class="pi-ta is-mono is-tall" data-guide>${esc(s.guide || BUILTIN_GUIDE)}</textarea>` : ''}</div>`;
}

export function render(view) {
    const s = view.data.settings();
    const modes = [{ value: 'ask', label: '弹出确认' }, { value: 'auto', label: '自动推进（可撤销）' }, { value: 'nodes', label: '仅勾选节点，不推进阶段' }];
    const offModes = [{ value: 'ask', label: '弹出提醒' }, { value: 'auto', label: '自动改写后续阶段（可撤销）' }, { value: 'off', label: '不检查偏离' }];
    return `<div class="pi-card"><h3>注入内容</h3>
        <label class="pi-field"><span>详细条目的标签名</span><input class="pi-inp" data-set="tagName" value="${esc(s.tagName)}"></label></div>
        <div class="pi-card"><h3>阶段推进</h3>
        <div class="pi-pair"><label class="pi-field"><span>检测间隔（楼）</span><input class="pi-inp" type="number" min="1" data-set="checkEvery" value="${s.checkEvery}"></label>
            <label class="pi-field"><span>每次读取楼数</span><input class="pi-inp" type="number" min="1" data-set="checkFloors" value="${s.checkFloors}"></label></div>
        <label class="pi-field"><span>判定阶段已演完后</span><select class="pi-sel" data-set="handleMode">${options(modes, s.handleMode)}</select></label>
        <label class="pi-field"><span>偏离大纲时</span><select class="pi-sel" data-set="offTrackMode">${options(offModes, s.offTrackMode)}</select></label></div>
        ${llmCard(view, s)}
        ${guideCard(view, s)}`;
}

const NUMERIC = new Set(['checkEvery', 'checkFloors']);

function readValue(target) {
    if (target.type === 'checkbox') return target.checked;
    return NUMERIC.has(target.dataset.set) ? Number(target.value) : target.value;
}

function setRole(view, role, patch) {
    const llm = view.data.settings().llm;
    view.data.updateSettings({ llm: { ...llm, [role]: { ...llm[role], ...patch } } });
}

export function onInput(view, target) {
    if (target.dataset.guide !== undefined) {
        const text = target.value;
        view.data.updateSettings({ guide: text.trim() === BUILTIN_GUIDE.trim() ? '' : text });
        return;
    }
    if (target.dataset.set && target.type !== 'checkbox' && target.tagName !== 'SELECT') view.data.updateSettings({ [target.dataset.set]: readValue(target) });
    if (target.dataset.llm && target.tagName === 'INPUT') setRole(view, target.dataset.llm, { [target.dataset.k]: target.value.trim() });
}

export function onChange(view, target) {
    if (target.dataset.set && (target.type === 'checkbox' || target.tagName === 'SELECT')) {
        view.data.updateSettings({ [target.dataset.set]: readValue(target) });
        view.runtime.refresh();
        view.renderBody();
    }
    if (target.dataset.llm && target.tagName === 'SELECT') {
        if (target.value === '__manual') st(view).manual = { ...st(view).manual, [target.dataset.llm]: true };
        else setRole(view, target.dataset.llm, { [target.dataset.k]: target.value });
        view.renderBody();
    }
    if (target.dataset.set && target.tagName !== 'SELECT' && target.type !== 'checkbox') view.runtime.refresh();
}

const CONN_KEYS = ['endpoint', 'apiKey', 'model', 'temperature'];

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
    // 同名预设直接覆盖，不同名新建一份。
    async 'preset-save'(view) {
        const s = view.data.settings();
        const llm = s.llm[currentRole(view)];
        if (!llm.endpoint) throw new Error('请先填写接口地址');
        const name = await promptDialog({ title: '保存为预设', label: '预设名称', value: llm.model, placeholder: '如：DeepSeek' });
        if (name == null || !name.trim()) return;
        const conn = Object.fromEntries(CONN_KEYS.map(key => [key, llm[key]]));
        const same = s.presets.find(item => item.name === name.trim());
        const presets = same ? s.presets.map(item => (item === same ? { ...item, ...conn } : item)) : [...s.presets, { id: makeId('api'), name: name.trim(), ...conn }];
        view.data.updateSettings({ presets });
        toast('success', same ? `已更新预设「${name.trim()}」。` : `已保存预设「${name.trim()}」。`);
        view.renderBody();
    },
    async 'preset-load'(view) {
        const role = currentRole(view);
        for (;;) {
            const presets = view.data.settings().presets;
            if (!presets.length) return view.renderBody();
            const result = await pickPreset(presets);
            if (!result) return;
            const [act, id] = [result.slice(0, result.indexOf(':')), result.slice(result.indexOf(':') + 1)];
            const preset = presets.find(item => item.id === id);
            if (!preset) return;
            if (act === 'del') {
                if (await confirmDialog({ title: `删除预设「${preset.name}」`, body: '已载入这个预设的用途不受影响。', okLabel: '删除', danger: true })) {
                    view.data.updateSettings({ presets: presets.filter(item => item.id !== id) });
                }
                continue;
            }
            setRole(view, role, { source: 'custom', ...Object.fromEntries(CONN_KEYS.map(key => [key, preset[key]])) });
            st(view).manual = { ...st(view).manual, [role]: false };
            toast('success', `已为「${LLM_ROLES.find(item => item.key === role).label}」载入预设「${preset.name}」。`);
            return view.renderBody();
        }
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
