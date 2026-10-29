import { groupProjects } from '../core/store.js';
import { cardKey, cardName, hostDocument, hostWindow, toast } from '../host/st.js';
import { confirmDialog, el, ensureStyle, esc, openDialog, promptDialog } from './dom.js';
import { ICONS } from './styles.js';
import * as discuss from './tab-discuss.js';
import * as setting from './tab-setting.js';
import * as outline from './tab-outline.js';
import * as run from './tab-run.js';
import * as settings from './page-settings.js';
import * as dataPage from './page-data.js';

const TABS = [
    { key: 'discuss', label: '讨论', mod: discuss },
    { key: 'setting', label: '设定', mod: setting },
    { key: 'outline', label: '大纲', mod: outline },
    { key: 'run', label: '执行', mod: run },
];
const PAGES = { settings: { label: '设置', mod: settings }, data: { label: '数据管理', mod: dataPage } };
const UI_KEY = 'pi-ui';

function readUi() {
    try { return JSON.parse(hostWindow().localStorage.getItem(UI_KEY) || '{}') || {}; } catch { return {}; }
}

export function writeUi(patch) {
    try { hostWindow().localStorage.setItem(UI_KEY, JSON.stringify({ ...readUi(), ...patch })); } catch { /* 存储不可用就不记 */ }
}

export function createApp({ data, runtime, version }) {
    const doc = hostDocument();
    let root = null;
    let busyTimer = 0;
    const view = {
        data,
        runtime,
        version,
        projectId: '',
        tab: 'run',
        page: '',
        collapsed: new Set(readUi().collapsed || []),
        state: {},
        busy: {},
        render,
        renderBody,
        renderSide,
        project: () => (view.projectId ? data.project(view.projectId) : null),
        setBusy(key, value) {
            view.busy = { ...view.busy, [key]: value };
            hostWindow().clearTimeout(busyTimer);
            busyTimer = hostWindow().setTimeout(renderBody, 0);
        },
        selectProject,
        go,
    };

    function tabState(key) {
        if (!view.state[key]) view.state[key] = {};
        return view.state[key];
    }
    view.tabState = tabState;

    function current() {
        if (view.page) return PAGES[view.page].mod;
        return (TABS.find(tab => tab.key === view.tab) || TABS[3]).mod;
    }

    function sideHtml() {
        const index = data.index();
        const activeId = data.activeIdFor(cardKey());
        const groups = groupProjects(index.projects);
        const list = groups.map(group => {
            const collapsed = view.collapsed.has(group.name);
            const items = collapsed ? '' : group.items.map(item => `<button type="button" class="pi-pitem${item.id === view.projectId && !view.page ? ' is-sel' : ''}" data-act="project" data-id="${esc(item.id)}" title="右键改名、分组或删除">
                <span class="pi-pname">${esc(item.name)}</span>${item.id === activeId ? '<span class="pi-dot" title="本卡当前项目"></span>' : ''}</button>`).join('');
            const head = group.name ? `<button type="button" class="pi-group-hd" data-act="group" data-group="${esc(group.name)}">${collapsed ? ICONS.caret : ICONS.caretDown}${esc(group.name)}</button>` : '';
            return `<div class="pi-group">${head}${items}</div>`;
        }).join('');
        return `<div class="pi-side-hd">剧情注入器 <small>v${esc(version)}</small></div>
            <div class="pi-plist">${list || '<p class="pi-hint">还没有项目</p>'}</div>
            <div class="pi-side-ft">
                <button type="button" class="pi-btn is-ghost is-block" data-act="new-project">${ICONS.plus}新项目</button>
                <button type="button" class="pi-btn is-ghost is-block${view.page === 'settings' ? ' is-sel' : ''}" data-act="page" data-page="settings">${ICONS.gear}设置</button>
                <button type="button" class="pi-btn is-ghost is-block${view.page === 'data' ? ' is-sel' : ''}" data-act="page" data-page="data">${ICONS.box}数据管理</button>
            </div>`;
    }

    function pickerHtml() {
        const index = data.index();
        const opts = index.projects.map(item => `<option value="p:${esc(item.id)}"${!view.page && item.id === view.projectId ? ' selected' : ''}>${esc(item.group ? `${item.group}／` : '')}${esc(item.name)}</option>`).join('');
        return `<select class="pi-sel pi-picker" data-act-change="picker">
            <option value="" disabled${!view.projectId && !view.page ? ' selected' : ''}>选择项目</option>${opts}
            <option value="new">＋新项目</option>
            <option value="page:settings"${view.page === 'settings' ? ' selected' : ''}>设置</option>
            <option value="page:data"${view.page === 'data' ? ' selected' : ''}>数据管理</option></select>`;
    }

    function topHtml() {
        const project = view.project();
        const title = view.page ? PAGES[view.page].label : project ? project.name : '剧情注入器';
        const tabs = view.page || !project ? '' : TABS.map(tab => `<button type="button" class="pi-tab${tab.key === view.tab ? ' is-sel' : ''}" data-act="tab" data-tab="${tab.key}">${tab.label}</button>`).join('');
        return `${pickerHtml()}<div class="pi-top-title">${esc(title)}</div><div class="pi-tabs">${tabs}</div>
            <button type="button" class="pi-close" data-act="close" title="关闭">${ICONS.close}</button>`;
    }

    function bodyHtml() {
        if (!data.isReady()) return '<div class="pi-empty"><span class="pi-spin"></span> 正在读取酒馆本地数据…</div>';
        if (view.page) return current().render(view);
        const project = view.project();
        if (!view.projectId) {
            return `<div class="pi-empty">${data.index().projects.length ? '从左侧选择一个项目。' : '一个项目就是一条 if 线：讨论 → 设定 → 大纲 → 执行。'}<br><br>
                <button type="button" class="pi-btn is-primary" data-act="new-project">${ICONS.plus}新项目</button></div>`;
        }
        if (!project) return '<div class="pi-empty"><span class="pi-spin"></span> 正在读取项目…</div>';
        return current().render(view);
    }

    function renderSide() {
        if (!root) return;
        root.querySelector('.pi-side').innerHTML = sideHtml();
        root.querySelector('.pi-top').innerHTML = topHtml();
    }

    function renderBody() {
        if (!root) return;
        const body = root.querySelector('.pi-body');
        const keepScroll = body.scrollTop;
        const chat = body.querySelector('.pi-chat');
        const chatScroll = chat ? chat.scrollTop : null;
        const chatAtEnd = chat ? chat.scrollHeight - chat.scrollTop - chat.clientHeight < 30 : true;
        const focused = doc.activeElement && body.contains(doc.activeElement) ? doc.activeElement : null;
        const compose = focused && focused.matches('[data-compose],[data-setting]') ? { sel: focused.matches('[data-compose]') ? '[data-compose]' : '[data-setting]', start: focused.selectionStart, end: focused.selectionEnd } : null;
        body.className = `pi-body${!view.page && view.tab === 'discuss' && view.project() ? ' is-chat' : ''}`;
        body.innerHTML = bodyHtml();
        body.scrollTop = keepScroll;
        const nextChat = body.querySelector('.pi-chat');
        if (nextChat) nextChat.scrollTop = chatAtEnd || chatScroll == null ? nextChat.scrollHeight : chatScroll;
        if (compose) {
            const box = body.querySelector(compose.sel);
            if (box) { box.focus(); box.setSelectionRange(compose.start, compose.end); }
        }
    }

    function render() {
        renderSide();
        renderBody();
    }

    async function selectProject(id, tab) {
        view.page = '';
        view.projectId = id;
        writeUi({ projectId: id });
        render();
        if (!id) return;
        try {
            const project = await data.loadProject(id);
            if (!project) {
                toast('error', '项目文件丢失，可在数据管理里查看。');
                return;
            }
            if (view.projectId !== id) return;
            view.tab = tab || (project.outline.volumes.length ? 'run' : 'discuss');
            writeUi({ tab: view.tab });
            render();
        } catch (error) {
            toast('error', `读取项目失败：${error.message}`);
        }
    }

    function go(tab) {
        view.page = '';
        view.tab = tab;
        writeUi({ tab });
        render();
    }

    async function newProject() {
        const name = await promptDialog({ title: '新项目', label: '项目名（一条 if 线）', placeholder: '如：龙宫温养' });
        if (name == null) return;
        try {
            const project = await data.createProject(name);
            if (!data.activeIdFor(cardKey()) && cardKey()) await runtime.switchProject(project.id);
            await selectProject(project.id, 'discuss');
        } catch (error) {
            toast('error', `新建失败：${error.message}`);
        }
    }

    async function projectMenu(id) {
        const meta = data.index().projects.find(item => item.id === id);
        if (!meta) return;
        const groups = [...new Set(data.index().projects.map(item => item.group).filter(Boolean))];
        const result = await openDialog({
            title: '项目',
            html: `<label class="pi-field"><span>名称</span><input class="pi-inp" data-f="name" value="${esc(meta.name)}"></label>
                <label class="pi-field"><span>分组（留空不分组）</span><input class="pi-inp" data-f="group" value="${esc(meta.group)}" list="pi-groups"></label>
                <datalist id="pi-groups">${groups.map(name => `<option value="${esc(name)}">`).join('')}</datalist>`,
            actions: [
                { label: '删除项目', danger: true, value: 'delete' },
                { label: '取消', value: null },
                { label: '保存', primary: true, value: box => ({ name: box.querySelector('[data-f=name]').value.trim(), group: box.querySelector('[data-f=group]').value.trim() }) },
            ],
        });
        if (!result) return;
        if (result === 'delete') {
            const ok = await confirmDialog({ title: `删除「${meta.name}」`, body: '将删除以下文件，聊天里记录的该项目进度保留。', list: [`pi-p-${id}.json`, `pi-c-${id}.json`], okLabel: '删除', danger: true });
            if (!ok) return;
            try {
                await data.deleteProject(id);
                if (view.projectId === id) view.projectId = '';
                runtime.refresh();
                render();
            } catch (error) {
                toast('error', `删除失败：${error.message}`);
            }
            return;
        }
        if (!data.project(id)) await data.loadProject(id);
        data.renameProject(id, result.name, result.group);
        render();
    }

    function onClick(event) {
        const target = event.target.closest('[data-act]');
        if (!target || !root.contains(target)) return;
        const act = target.dataset.act;
        if (act === 'close') return close();
        if (act === 'project') return selectProject(target.dataset.id);
        if (act === 'new-project') return newProject();
        if (act === 'tab') return go(target.dataset.tab);
        if (act === 'page') { view.page = target.dataset.page; return render(); }
        if (act === 'group') {
            const name = target.dataset.group;
            if (view.collapsed.has(name)) view.collapsed.delete(name);
            else view.collapsed.add(name);
            writeUi({ collapsed: [...view.collapsed] });
            return renderSide();
        }
        const handler = current().actions?.[act];
        if (handler) {
            event.preventDefault();
            Promise.resolve(handler(view, target, event)).catch(error => toast('error', error.message || String(error)));
        }
    }

    function onContext(event) {
        const item = event.target.closest('.pi-pitem');
        if (!item || !root.contains(item)) return;
        event.preventDefault();
        projectMenu(item.dataset.id);
    }

    function onChange(event) {
        const target = event.target;
        if (target.dataset.actChange === 'picker') {
            const value = target.value;
            if (value === 'new') return newProject();
            if (value.startsWith('page:')) { view.page = value.slice(5); return render(); }
            return selectProject(value.slice(2));
        }
        const handler = current().onChange;
        if (handler) Promise.resolve(handler(view, target, event)).catch(error => toast('error', error.message || String(error)));
    }

    function onInput(event) {
        const handler = current().onInput;
        if (handler) handler(view, event.target, event);
    }

    function onKey(event) {
        if (event.key === 'Escape' && root && !doc.querySelector('.pi-dialog')) {
            event.stopPropagation();
            close();
        }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) current().onSubmit?.(view, event.target, event);
    }

    function open() {
        ensureStyle();
        if (root) return;
        const ui = readUi();
        root = el(`<div class="pi-root pi-overlay"><div class="pi-panel"><aside class="pi-side"></aside>
            <section class="pi-main"><header class="pi-top"></header><div class="pi-body"></div></section></div></div>`);
        root.addEventListener('click', onClick);
        root.addEventListener('contextmenu', onContext);
        root.addEventListener('change', onChange);
        root.addEventListener('input', onInput);
        root.addEventListener('focusout', event => current().onBlur?.(view, event.target, event));
        root.addEventListener('mousedown', event => { if (event.target === root) root.dataset.down = '1'; });
        root.addEventListener('mouseup', event => { if (event.target === root && root.dataset.down) close(); delete root.dataset.down; });
        doc.addEventListener('keydown', onKey, true);
        doc.body.appendChild(root);
        const activeId = data.activeIdFor(cardKey());
        const remembered = data.index().projects.some(item => item.id === ui.projectId) ? ui.projectId : '';
        const id = activeId || remembered || (data.index().projects[0] && data.index().projects[0].id) || '';
        render();
        if (id) selectProject(id, id === remembered && ui.tab ? ui.tab : undefined);
    }

    function close() {
        if (!root) return;
        current().unmount?.(view);
        doc.removeEventListener('keydown', onKey, true);
        root.remove();
        root = null;
        data.flush().catch(() => {});
    }

    // 外部变化（存盘、检测、换聊天）只在没有正在输入时重画正文，避免打断输入。
    function refresh(reason) {
        if (!root) return;
        if (reason === 'index' || reason === 'switch' || reason === 'chat') renderSide();
        const focused = doc.activeElement;
        const typing = focused && root.contains(focused) && (focused.tagName === 'TEXTAREA' || (focused.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(focused.type)));
        if (reason === 'saved' || reason === 'save-failed') return current().onStatus?.(view, root);
        const only = current().refreshOn;
        if (only && !only.includes(reason)) return;
        if (!typing) renderBody();
    }

    return { open, close, refresh, isOpen: () => Boolean(root), view, cardName };
}
