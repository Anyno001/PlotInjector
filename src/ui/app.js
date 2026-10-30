import { groupProjects } from '../core/store.js';
import { cardKey, cardName, hostDocument, hostWindow, toast } from '../host/st.js';
import { confirmDialog, el, ensureStyle, esc, isNight, openDialog, promptDialog, setNight } from './dom.js';
import { ICONS } from './styles.js';
import * as discuss from './tab-discuss.js';
import * as setting from './tab-setting.js';
import * as outline from './tab-outline.js';
import * as run from './tab-run.js';
import * as settings from './page-settings.js';
import * as dataPage from './page-data.js';
import * as books from './page-books.js';
import * as diag from './page-diag.js';

const TABS = [
    { key: 'discuss', label: '讨论', mod: discuss },
    { key: 'setting', label: '设定', mod: setting },
    { key: 'outline', label: '大纲', mod: outline },
    { key: 'run', label: '执行', mod: run },
];
const PAGES = {
    books: { label: '世界书管理', icon: 'book', mod: books },
    data: { label: '数据管理', icon: 'box', mod: dataPage },
    diag: { label: '诊断', icon: 'pulse', mod: diag },
    settings: { label: '设置', icon: 'gear', mod: settings },
};
const UI_KEY = 'pi-ui';
const SEARCH_FROM = 6;

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
    setNight(readUi().night);
    const view = {
        data,
        runtime,
        version,
        projectId: '',
        tab: 'run',
        page: '',
        drawer: false,
        search: '',
        collapsed: new Set(readUi().collapsed || []),
        state: {},
        busy: {},
        loadError: {},
        restored: false,
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
            const items = group.items.map(item => `<button type="button" class="pi-pitem${item.id === view.projectId && !view.page ? ' is-sel' : ''}" data-act="project" data-id="${esc(item.id)}" data-name="${esc(`${item.group} ${item.name}`.toLowerCase())}" title="右键编辑名称、分组">
                <span class="pi-pname">${esc(item.name)}</span>${item.id === activeId ? '<span class="pi-dot" title="本卡当前项目"></span>' : ''}</button>`).join('');
            const head = group.name ? `<button type="button" class="pi-group-hd" data-act="group" data-group="${esc(group.name)}">${collapsed ? ICONS.caret : ICONS.caretDown}${esc(group.name)}<small>${group.items.length}</small></button>` : '';
            return `<div class="pi-group${collapsed ? ' is-collapsed' : ''}">${head}${items}</div>`;
        }).join('');
        const page = key => `<button type="button" class="pi-btn is-ghost is-block${view.page === key ? ' is-sel' : ''}" data-act="page" data-page="${key}">${ICONS[PAGES[key].icon]}${PAGES[key].label}</button>`;
        return `<div class="pi-side-hd">剧情注入器 <small>v${esc(version)}</small><span class="pi-spacer"></span><button type="button" class="pi-icon-btn" data-act="new-project" title="新项目">${ICONS.plus}</button></div>
            ${index.projects.length > SEARCH_FROM ? `<div class="pi-psearch">${ICONS.search}<input class="pi-inp" data-psearch placeholder="搜索项目" value="${esc(view.search)}"></div>` : ''}
            <div class="pi-plist">${list || '<p class="pi-hint">还没有项目</p>'}</div>
            <div class="pi-side-ft">
                ${page('books')}${page('data')}${page('diag')}
            </div>`;
    }

    // 搜索时无视分组折叠，只留名称或分组名匹配的项目。
    function applySearch() {
        const listBox = root && root.querySelector('.pi-plist');
        if (!listBox) return;
        const q = view.search.trim().toLowerCase();
        listBox.classList.toggle('is-searching', Boolean(q));
        for (const group of listBox.querySelectorAll('.pi-group')) {
            let shown = 0;
            for (const item of group.querySelectorAll('.pi-pitem')) {
                const hit = !q || item.dataset.name.includes(q);
                item.hidden = !hit;
                if (hit) shown += 1;
            }
            group.hidden = Boolean(q) && !shown;
        }
    }

    function topHtml() {
        const project = view.project();
        const title = view.page ? PAGES[view.page].label : project ? project.name : '剧情注入器';
        const tabs = view.page || !project ? '' : `<div class="pi-tabs">${TABS.map(tab => `<button type="button" class="pi-tab${tab.key === view.tab ? ' is-sel' : ''}" data-act="tab" data-tab="${tab.key}">${tab.label}</button>`).join('')}</div>`;
        const rename = !view.page && project ? `<button type="button" class="pi-icon-btn" data-act="rename" title="编辑项目名称">${ICONS.pencil}</button>` : '';
        return `<div class="pi-top-lead"><button type="button" class="pi-icon-btn pi-menu" data-act="drawer" title="项目列表">${ICONS.menu}</button>
                <span class="pi-top-title">${esc(title)}</span>${rename}</div>${tabs}
            <div class="pi-top-end"><button type="button" class="pi-icon-btn${view.page === 'settings' ? ' is-on' : ''}" data-act="page" data-page="settings" title="设置">${ICONS.gear}</button><button type="button" class="pi-icon-btn" data-act="theme" title="${isNight() ? '日间配色' : '夜间配色'}">${isNight() ? ICONS.sun : ICONS.moon}</button>
            <button type="button" class="pi-close" data-act="close" title="关闭">${ICONS.close}</button></div>`;
    }

    function setDrawer(open) {
        view.drawer = open;
        root?.querySelector('.pi-panel').classList.toggle('is-drawer', open);
    }

    function bodyHtml() {
        if (!data.isReady()) return '<div class="pi-empty"><span class="pi-spin"></span> 正在读取酒馆本地数据…</div>';
        if (view.page) return current().render(view);
        const project = view.project();
        if (!view.projectId) {
            return `<div class="pi-empty">${data.index().projects.length ? '从项目列表选择一个项目。' : '一个项目就是一条 if 线：讨论 → 设定 → 大纲 → 执行。'}<br><br>
                <button type="button" class="pi-btn is-primary" data-act="new-project">${ICONS.plus}新项目</button></div>`;
        }
        if (!project) {
            const failed = view.loadError[view.projectId];
            if (failed) return `<div class="pi-empty">读取项目失败：${esc(failed)}<br><br><button type="button" class="pi-btn is-primary" data-act="retry-project">重试</button></div>`;
            return '<div class="pi-empty"><span class="pi-spin"></span> 正在读取项目…</div>';
        }
        return current().render(view);
    }

    // 某一页渲染出错时显示原因和重试，不留一片空白；错误同时记进诊断页。
    function safeBodyHtml() {
        try {
            return bodyHtml();
        } catch (error) {
            console.error('[剧情注入器] 页面渲染失败', error);
            runtime.note(`页面渲染失败（${view.page || view.tab}）：${error.message}`);
            return `<div class="pi-empty">这一页显示出错：${esc(error.message)}<br><br><button type="button" class="pi-btn is-primary" data-act="retry-render">重试</button></div>`;
        }
    }

    // 每次改设定、大纲都会更新索引并调到这里；内容没变就不重建侧栏和顶栏的节点。
    let lastSide = '';
    let lastTop = '';
    function renderSide() {
        if (!root) return;
        const side = sideHtml();
        const top = topHtml();
        if (side !== lastSide) {
            root.querySelector('.pi-side').innerHTML = side;
            lastSide = side;
            applySearch();
        }
        if (top !== lastTop) {
            root.querySelector('.pi-top').innerHTML = top;
            lastTop = top;
        }
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
        body.innerHTML = safeBodyHtml();
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

    // 读取失败时正文显示原因和重试按钮，不再一直转圈。
    async function selectProject(id, tab) {
        view.page = '';
        setDrawer(false);
        view.projectId = id;
        delete view.loadError[id];
        writeUi({ projectId: id, page: '' });
        render();
        if (!id) return;
        try {
            const project = await data.loadProject(id);
            if (view.projectId !== id) return;
            if (!project) {
                view.loadError[id] = '项目文件丢失，可在数据管理里查看';
                render();
                return;
            }
            view.tab = tab || (project.outline.volumes.length ? 'run' : 'discuss');
            writeUi({ tab: view.tab });
            render();
        } catch (error) {
            if (view.projectId !== id) return;
            view.loadError[id] = error.message;
            render();
        }
    }

    // 打开面板时定位到上次的位置：本卡当前项目优先，其次上次看的项目；设置等页面也记住。
    // 数据还没读完时先显示读取中，读完由 refresh('index') 再调一次。
    function restore() {
        const ui = readUi();
        const activeId = data.activeIdFor(cardKey());
        const remembered = data.index().projects.some(item => item.id === ui.projectId) ? ui.projectId : '';
        const id = activeId || remembered || (data.index().projects[0] && data.index().projects[0].id) || '';
        view.restored = true;
        render();
        const page = PAGES[ui.page] ? ui.page : '';
        if (id) selectProject(id, TABS.some(tab => tab.key === ui.tab) ? ui.tab : undefined);
        if (page) {
            view.page = page;
            writeUi({ page });
            render();
        }
    }

    function go(tab) {
        view.page = '';
        view.tab = tab;
        writeUi({ tab, page: '' });
        render();
    }

    async function newProject() {
        setDrawer(false);
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
            title: '编辑项目',
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
        if (act === 'page') { view.page = target.dataset.page; writeUi({ page: view.page }); setDrawer(false); return render(); }
        if (act === 'drawer') return setDrawer(!view.drawer);
        if (act === 'theme') {
            setNight(!isNight());
            writeUi({ night: isNight() });
            return renderSide();
        }
        if (act === 'rename') return projectMenu(view.projectId);
        if (act === 'retry-project') return selectProject(view.projectId, view.tab);
        if (act === 'retry-render') return render();
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
        if (target.dataset.psearch !== undefined) return;
        const handler = current().onChange;
        if (handler) Promise.resolve(handler(view, target, event)).catch(error => toast('error', error.message || String(error)));
    }

    function onInput(event) {
        if (event.target.dataset.psearch !== undefined) {
            view.search = event.target.value;
            return applySearch();
        }
        const handler = current().onInput;
        if (handler) handler(view, event.target, event);
    }

    function onKey(event) {
        if (event.key === 'Escape' && root && !doc.querySelector('.pi-dialog')) {
            event.stopPropagation();
            if (view.drawer) setDrawer(false);
            else close();
        }
        if (event.key === 'Enter' && (event.ctrlKey || event.metaKey)) current().onSubmit?.(view, event.target, event);
    }

    function open() {
        ensureStyle();
        if (root) return;
        view.drawer = false;
        lastSide = '';
        lastTop = '';
        root = el(`<div class="pi-root pi-overlay"><div class="pi-panel"><aside class="pi-side"></aside>
            <div class="pi-scrim" data-act="drawer"></div>
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
        view.restored = false;
        if (data.isReady()) restore();
        else render();
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
        if (!view.restored && data.isReady()) return restore();
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
