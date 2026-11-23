import { createTour, tourState, tourScopeOf, TOUR_REVISION } from './tour.js';

import { normalizeInfinite } from '../core/infinite.js';
import { isTrpg } from '../trpg/trpg.js';
import { groupProjects } from '../core/store.js';
import { cardKey, cardName, hostDocument, hostWindow, toast } from '../host/st.js';
import { confirmDialog, el, ensureStyle, esc, isNight, layerParent, menuDialog, openDialog, options, pickFiles, setNight } from './dom.js';
import { parseProjectFile, importedName, missingBoundTables } from '../core/project-file.js';
import { ICONS } from './styles.js';
import * as discuss from './tab-discuss.js';
import * as setting from './tab-setting.js';
import * as outline from './tab-outline.js';
import * as persona from './tab-persona.js';
import * as run from './tab-run.js';
import * as worlds from './tab-worlds.js';
import * as infiniteRun from './tab-infinite-run.js';
import * as settings from './page-settings.js';
import * as dataPage from './page-data.js';
import * as books from './page-books.js';
import * as diag from './page-diag.js';

const TABS = [
    { key: 'discuss', label: '讨论', mod: discuss },
    { key: 'setting', label: '设定', mod: setting },
    { key: 'persona', label: '人设', mod: persona },
    { key: 'outline', label: '大纲', mod: outline },
    { key: 'run', label: '执行', mod: run },
];
// 无限流项目：大纲页签换成世界库，执行页签换成状态页。
const INFINITE_TABS = { outline: { label: '世界库', mod: worlds }, run: { mod: infiniteRun } };
// 跑团项目：设定叫公共设定，大纲叫模组，人设页签不显示。
const TRPG_TABS = { setting: { label: '公共设定' }, outline: { label: '模组' }, persona: { hidden: !0 } };
const PAGES = {
    books: { label: '世界书管理', icon: 'book', mod: books },
    data: { label: '数据管理', icon: 'box', mod: dataPage },
    diag: { label: '诊断', icon: 'pulse', mod: diag },
    settings: { label: '设置', icon: 'gear', mod: settings },
};
const UI_KEY = 'pi-ui';
const SEARCH_FROM = 6;
const LONG_PRESS_MS = 500;

function readUi() {
    try {
        return JSON.parse(hostWindow().localStorage.getItem(UI_KEY) || '{}') || {};
    } catch {
        return {};
    }
}

// 文本框随内容变高：最多到 320px，再多就在框里滚动
function growBox(box) {
    if (!box || !box.style) return;
    box.style.height = 'auto';
    let h = box.scrollHeight;
    h > 0 && (box.style.height = `${Math.min(h + 2, 320)}px`);
}

export function writeUi(patch) {
    try {
        hostWindow().localStorage.setItem(UI_KEY, JSON.stringify({ ...readUi(), ...patch }));
    } catch {
        /* 存储不可用就不记 */
    }
}

export function createApp({ data, runtime, version }) {
    const doc = hostDocument();
    let root = null,
        busyTimer = 0;
    setNight(readUi().night);
    const view = {
        data,
        runtime,
        version,
        projectId: '',
        tab: 'run',
        page: '',
        drawer: !1,
        search: '',
        collapsed: new Set(readUi().collapsed || []),
        state: {},
        busy: {},
        loadError: {},
        restored: !1,
        render,
        renderBody,
        renderSide,
        project: () => (view.projectId ? data.project(view.projectId) : null),
        setBusy(key, value) {
            ((view.busy = { ...view.busy, [key]: value }),
                hostWindow().clearTimeout(busyTimer),
                (busyTimer = hostWindow().setTimeout(renderBody, 0)));
        },
        selectProject,
        go,
    };
    function tabState(key) {
        return (view.state[key] || (view.state[key] = {}), view.state[key]);
    }
    view.tabState = tabState;
    const isInfinite = () => !!(view.project() && view.project().mode === 'infinite'),
        tabOf = (tab) => ({ ...tab, ...(isInfinite() ? INFINITE_TABS[tab.key] : isTrpg(view.project()) ? TRPG_TABS[tab.key] : null) }),
        // 当前页签；跑团项目里被藏起来的页签（人设）退回执行页
        tabKey = () => {
            const tab = TABS.find((item) => item.key === view.tab);
            return tab && tabOf(tab).hidden ? 'run' : view.tab;
        };
    function current() {
        if (view.page) return PAGES[view.page].mod;
        return tabOf(TABS.find((tab) => tab.key === tabKey()) || TABS.find((tab) => tab.key === 'run')).mod;
    }
    function sideHtml() {
        const index = data.index(),
            activeId = runtime.activeId(),
            list = groupProjects(index.projects)
                .map((group) => {
                    const collapsed = view.collapsed.has(group.name),
                        items = group.items
                            .map(
                                (
                                    item,
                                ) => `<button type="button" class="pi-pitem${item.id === view.projectId && !view.page ? ' is-sel' : ''}" data-act="project" data-id="${esc(item.id)}" data-name="${esc(`${item.group} ${item.name}`.toLowerCase())}" title="长按或右键：设为当前、编辑">
                <span class="pi-pname">${esc(item.name)}</span>${item.id === activeId ? '<span class="pi-dot" title="当前聊天使用"></span>' : ''}</button>`,
                            )
                            .join(''),
                        head = group.name
                            ? `<button type="button" class="pi-group-hd" data-act="group" data-group="${esc(group.name)}">${collapsed ? ICONS.caret : ICONS.caretDown}${esc(group.name)}<small>${group.items.length}</small></button>`
                            : '';
                    return `<div class="pi-group${collapsed ? ' is-collapsed' : ''}">${head}${items}</div>`;
                })
                .join(''),
            page = (key) =>
                `<button type="button" class="pi-btn is-ghost is-block${view.page === key ? ' is-sel' : ''}" data-act="page" data-page="${key}">${ICONS[PAGES[key].icon]}${PAGES[key].label}</button>`;
        return `<div class="pi-side-hd">剧情注入器 <small>v${esc(version)}</small><span class="pi-spacer"></span><button type="button" class="pi-icon-btn" data-act="new-project" title="新项目">${ICONS.plus}</button></div>
            ${index.projects.length > SEARCH_FROM ? `<div class="pi-psearch">${ICONS.search}<input class="pi-inp" data-psearch placeholder="搜索项目" value="${esc(view.search)}"></div>` : ''}
            <div class="pi-plist">${list || '<p class="pi-hint">还没有项目</p>'}</div>
            <div class="pi-side-ft">
                ${page('books')}${page('data')}${page('diag')}
            </div>`;
    }
    function applySearch() {
        const listBox = root && root.querySelector('.pi-plist');
        if (!listBox) return;
        const q = view.search.trim().toLowerCase();
        listBox.classList.toggle('is-searching', !!q);
        for (const group of listBox.querySelectorAll('.pi-group')) {
            let shown = 0;
            for (const item of group.querySelectorAll('.pi-pitem')) {
                const hit = !q || item.dataset.name.includes(q);
                ((item.hidden = !hit), hit && (shown += 1));
            }
            group.hidden = !!q && !shown;
        }
    }
    function topHtml() {
        const project = view.project(),
            title = view.page ? PAGES[view.page].label : project ? project.name : '剧情注入器',
            tabs =
                view.page || !project
                    ? ''
                    : `<div class="pi-tabs">${TABS.map(tabOf)
                          .filter((tab) => !tab.hidden)
                          .map(
                              (tab) =>
                                  `<button type="button" class="pi-tab${tab.key === tabKey() ? ' is-sel' : ''}" data-act="tab" data-tab="${tab.key}">${tab.label}</button>`,
                          )
                          .join('')}</div>`,
            rename =
                !view.page && project
                    ? `<button type="button" class="pi-icon-btn" data-act="rename" title="编辑项目名称">${ICONS.pencil}</button>`
                    : '';
        return `<div class="pi-top-lead"><button type="button" class="pi-icon-btn pi-menu" data-act="drawer" title="项目列表">${ICONS.menu}</button>
                <span class="pi-top-title">${esc(title)}</span>${rename}</div>${tabs}
            <div class="pi-top-end"><button type="button" class="pi-icon-btn" data-act="tour" title="当前页帮助">?</button><button type="button" class="pi-icon-btn${view.page === 'settings' ? ' is-on' : ''}" data-act="page" data-page="settings" title="设置">${ICONS.gear}</button><button type="button" class="pi-icon-btn" data-act="theme" title="${isNight() ? '日间配色' : '夜间配色'}">${isNight() ? ICONS.sun : ICONS.moon}</button>
            <button type="button" class="pi-close" data-act="close" title="关闭">${ICONS.close}</button></div>`;
    }
    function setDrawer(open2) {
        ((view.drawer = open2), root?.querySelector('.pi-panel').classList.toggle('is-drawer', open2));
    }
    function bodyHtml() {
        if (!data.isReady()) return '<div class="pi-empty"><span class="pi-spin"></span> 正在读取酒馆本地数据…</div>';
        if (view.page) return current().render(view);
        const project = view.project();
        if (!view.projectId)
            return `<div class="pi-empty">${data.index().projects.length ? '从项目列表选择一个项目。' : '一个项目保存一个故事的设定、人设、大纲和进度，绑定到角色卡和聊天使用。一般顺序：讨论、写大纲、执行。设定页和人设页可选。'}<br><br>
                <button type="button" class="pi-btn is-primary" data-act="new-project">${ICONS.plus}新项目</button></div>`;
        if (!project) {
            const failed = view.loadError[view.projectId];
            return failed
                ? `<div class="pi-empty">读取项目失败：${esc(failed)}<br><br><button type="button" class="pi-btn is-primary" data-act="retry-project">重试</button></div>`
                : '<div class="pi-empty"><span class="pi-spin"></span> 正在读取项目…</div>';
        }
        return current().render(view);
    }
    function safeBodyHtml() {
        try {
            return bodyHtml();
        } catch (error) {
            return (
                console.error('[剧情注入器] 页面渲染失败', error),
                runtime.note(`页面渲染失败（${view.page || view.tab}）：${error.message}`),
                `<div class="pi-empty">这一页显示出错：${esc(error.message)}<br><br><button type="button" class="pi-btn is-primary" data-act="retry-render">重试</button></div>`
            );
        }
    }
    let lastSide = '',
        lastTop = '';
    function renderSide() {
        if (!root) return;
        const side = sideHtml(),
            top = topHtml();
        (side !== lastSide && ((root.querySelector('.pi-side').innerHTML = side), (lastSide = side), applySearch()),
            top !== lastTop && ((root.querySelector('.pi-top').innerHTML = top), (lastTop = top)));
    }
    function renderBody() {
        if (!root) return;
        const body = root.querySelector('.pi-body'),
            keepScroll = body.scrollTop,
            chat = body.querySelector('.pi-chat'),
            chatScroll = chat ? chat.scrollTop : null,
            chatAtEnd = chat ? chat.scrollHeight - chat.scrollTop - chat.clientHeight < 30 : !0,
            focused = doc.activeElement && body.contains(doc.activeElement) ? doc.activeElement : null,
            compose =
                focused && focused.matches('[data-compose],[data-setting],[data-search]')
                    ? {
                          sel:
                              ['[data-compose]', '[data-setting]'].find((sel) => focused.matches(sel)) ||
                              `[data-search="${focused.dataset.search}"]`,
                          start: focused.selectionStart,
                          end: focused.selectionEnd,
                      }
                    : null;
        ((body.className = `pi-body${!view.page && view.tab === 'discuss' && view.project() ? ' is-chat' : ''}`),
            (body.innerHTML = safeBodyHtml()),
            (body.scrollTop = keepScroll));
        // 文本框随内容变高（第四批）：初始 2 行，内容多了再变高
        body.querySelectorAll('.pi-ta-auto').forEach(growBox);
        // 审阅页的页签横向滚动：重画后把当前页签滚到看得见的位置（只动页签栏，不动整页）
        const tabs = body.querySelector('.pi-rv-dots'),
            cur = tabs && tabs.querySelector('.pi-rv-dot.is-cur');
        if (tabs && cur) {
            const left = cur.offsetLeft - tabs.offsetLeft,
                right = left + cur.offsetWidth;
            (left < tabs.scrollLeft || right > tabs.scrollLeft + tabs.clientWidth) && (tabs.scrollLeft = Math.max(0, left - 24));
        }
        const nextChat = body.querySelector('.pi-chat');
        if ((nextChat && (nextChat.scrollTop = chatAtEnd || chatScroll == null ? nextChat.scrollHeight : chatScroll), compose)) {
            const box = body.querySelector(compose.sel);
            box && (box.focus(), box.setSelectionRange(compose.start, compose.end));
        }
    }
    function render() {
        (renderSide(), renderBody());
    }
    let tour = createTour({ getRoot: () => root, data });
    view.tour = tour;
    function startTour(scope, opts) {
        tour.start(scope, opts) || (opts && opts.auto) || toast('info', '这一页现在没有可以讲解的内容。');
    }
    function maybeAutoTour() {
        let tries = 0,
            tick = () => {
                if (!(!root || tour.isOpen() || tourState(data).done.includes('core'))) {
                    if (!data.isReady() || doc.querySelector('.pi-dialog')) return ++tries < 30 && hostWindow().setTimeout(tick, 200);
                    tour.start('core', { auto: !0 }) || (++tries < 30 && hostWindow().setTimeout(tick, 200));
                }
            };
        hostWindow().setTimeout(tick, 300);
    }
    async function selectProject(id, tab) {
        if (
            ((view.page = ''),
            setDrawer(!1),
            (view.projectId = id),
            delete view.loadError[id],
            writeUi({ projectId: id, page: '' }),
            render(),
            !!id)
        )
            try {
                const project = await data.loadProject(id);
                if (view.projectId !== id) return;
                if (!project) {
                    ((view.loadError[id] = '项目文件丢失，可在数据管理里查看'), render());
                    return;
                }
                ((view.tab = tab || (project.outline.volumes.length ? 'run' : 'discuss')), writeUi({ tab: view.tab }), render());
            } catch (error) {
                if (view.projectId !== id) return;
                ((view.loadError[id] = error.message), render());
            }
    }
    function restore() {
        const ui = readUi(),
            activeId = runtime.activeId(),
            remembered = data.index().projects.some((item) => item.id === ui.projectId) ? ui.projectId : '',
            id = activeId || remembered || (data.index().projects[0] && data.index().projects[0].id) || '';
        ((view.restored = !0), render());
        const page = PAGES[ui.page] ? ui.page : '';
        (id && selectProject(id, TABS.some((tab) => tab.key === ui.tab) ? ui.tab : void 0),
            page && ((view.page = page), writeUi({ page }), render()));
    }
    view.switchTab = go;
    function go(tab) {
        ((view.page = ''), (view.tab = tab), writeUi({ tab, page: '' }), render());
    }
    const NEW_GROUP = '::new';
    function groupField(preset) {
        const groups = [
                ...new Set(
                    data
                        .index()
                        .projects.map((item) => item.group)
                        .filter(Boolean),
                ),
            ],
            list = [
                { value: '', label: '不分组' },
                ...groups.map((name) => ({ value: name, label: name })),
                { value: NEW_GROUP, label: '新建分组' },
            ];
        return `<label class="pi-field"><span>分组</span><select class="pi-sel" data-f="group">${options(list, preset)}</select></label>
                <label class="pi-field" data-f="new-group-row" hidden><span>新分组名</span><input class="pi-inp" data-f="new-group" placeholder="如：龙宫篇"></label>`;
    }
    function mountGroupField(box) {
        const select = box.querySelector('[data-f=group]'),
            row = box.querySelector('[data-f=new-group-row]');
        select.addEventListener('change', () => {
            ((row.hidden = select.value !== NEW_GROUP), row.hidden || box.querySelector('[data-f=new-group]').focus());
        });
    }
    function readGroupField(box) {
        const picked = box.querySelector('[data-f=group]').value;
        return picked === NEW_GROUP ? box.querySelector('[data-f=new-group]').value.trim() : picked;
    }
    // 跑团模式（core/trpg.js）：设置页「实验功能」打开后，新建 / 编辑项目时才出现这一行；已经是跑团的项目编辑时总是显示。
    function trpgField(on) {
        return data.settings().trpgLab || on
            ? `<label class="pi-check"><input type="checkbox" data-f="trpg"${on ? ' checked' : ''}><span>跑团模式（CoC 7版，线索推进）</span></label>`
            : '';
    }
    function readTrpgField(box) {
        const el = box.querySelector('[data-f=trpg]');
        return el ? el.checked : null;
    }
    function setTrpg(id, on) {
        data.updateProject(id, (project) => {
            const { trpg, ...rest } = project;
            return on ? { ...rest, trpg: { ...(trpg || {}), on: !0, rule: 'coc7' }, clue: { ...project.clue, mode: 'clue' } } : rest;
        });
    }
    async function newProject() {
        setDrawer(!1);
        const current2 = data.index().projects.find((item) => item.id === view.projectId),
            result = await openDialog({
                title: '新项目',
                html: `<label class="pi-field"><span>项目名</span><input class="pi-inp" data-f="name" placeholder="如：龙宫温养"></label>
                <p class="pi-hint">一个项目保存一个故事的设定、人设、大纲和进度。每个聊天同时使用一个项目；当前聊天还没有项目时，会直接使用新项目。主线、支线都写在同一个项目的大纲里。</p>
                ${groupField(current2 && current2.group ? current2.group : '')}
                <label class="pi-check"><input type="checkbox" data-f="infinite"><span>无限流模式（主空间出发、世界库、污染）</span></label>
                ${trpgField(!1)}
                <div class="pi-row"><span class="pi-hint">已有导出的项目文件：</span><button type="button" class="pi-btn is-sm" data-dlg-value="import-file">从文件导入</button></div>`,
                onMount: mountGroupField,
                actions: [
                    { label: '取消', value: null },
                    {
                        label: '确定',
                        primary: !0,
                        value: (box) => ({
                            name: box.querySelector('[data-f=name]').value,
                            group: readGroupField(box),
                            mode: box.querySelector('[data-f=infinite]').checked ? 'infinite' : 'normal',
                            trpg: readTrpgField(box),
                        }),
                    },
                ],
            });
        if (!result) return;
        if (result === 'import-file') return importProjectFile(current2 && current2.group ? current2.group : '');
        const name = result.name;
        try {
            const project = await data.createProject(name, result.group, result.mode);
            result.trpg && result.mode !== 'infinite' && setTrpg(project.id, !0);
            (!runtime.activeId() && cardKey() && (await runtime.switchProject(project.id)), await selectProject(project.id, 'discuss'));
        } catch (error) {
            toast('error', `新建失败：${error.message}`);
        }
    }
    // 从项目文件导入（用户 2026-11-17）：总是建成新项目，重名加「（导入）」，不覆盖原项目。
    async function importProjectFile(group = '') {
        const [file] = await pickFiles({ accept: '.json,application/json' });
        if (!file) return;
        let parsed;
        try {
            parsed = parseProjectFile(await file.text());
        } catch (error) {
            return toast('error', `导入失败：${error.message}`);
        }
        const { project, summary } = parsed,
            name = importedName(project.name, data.index().projects.map((p) => p.name)),
            // 确认框只留要紧的：名字、里面有什么、要不要先建表（用户 2026-11-17：字太多，要简洁）
            what = [
                summary.clue ? '线索推进' : '按阶段推进',
                summary.lines ? `${summary.lines}条剧情线` : '',
                summary.labels ? `${summary.labels}条标签` : '',
                summary.personas ? `${summary.personas}条人设` : '',
                summary.setting ? (isTrpg(project) ? '公共设定' : '设定') : '',
            ].filter(Boolean),
            // 当前聊天读得到表格时，核对项目绑定的表在不在
            missing = summary.clue ? missingBoundTables(project, outline.currentTables()) : [],
            ok = await openDialog({
                // 排法 A（用户 2026-11-17 选定）：灰色小标题、大号项目名、一排小标签、细线下一句提示
                html: `<div><p class="pi-pf-imp-ttl">导入项目</p><p class="pi-pf-imp-name">${esc(name)}</p>
                <div class="pi-pf-imp-pills">${what.map((w) => `<span class="pi-badge">${esc(w)}</span>`).join('')}</div>
                ${summary.clue ? `<p class="pi-pf-imp-note${missing && missing.length ? ' is-warn' : ''}">${missing && missing.length ? `当前聊天缺少${esc(missing.join('、'))}。` : ''}游玩前在执行页点「创建模板」。</p>` : ''}</div>`,
                actions: [
                    { label: '取消', value: null },
                    { label: '导入', primary: !0, value: !0 },
                ],
            });
        if (!ok) return;
        try {
            const added = await data.addProject({ ...project, name }, group);
            (!runtime.activeId() && cardKey() && (await runtime.switchProject(added.id)), await selectProject(added.id, summary.clue ? 'run' : 'outline'));
            toast('success', `已导入「${name}」。`);
        } catch (error) {
            toast('error', `导入失败：${error.message}`);
        }
    }
    async function projectMenu(id) {
        const meta = data.index().projects.find((item) => item.id === id);
        if (!meta) return;
        const items = [];
        (cardKey() &&
            (runtime.activeId() !== id && items.push({ label: '设为当前聊天使用', value: 'chat', icon: ICONS.chat }),
            data.activeIdFor(cardKey()) !== id && items.push({ label: '设为本卡默认（新聊天也用）', value: 'card', icon: ICONS.card })),
            items.push({ label: '编辑名称、分组', value: 'edit', icon: ICONS.pencil }));
        const pick = await menuDialog({ title: meta.name, items });
        if (pick) {
            if (pick === 'edit') return editProject(id);
            try {
                (await runtime.switchProject(id, pick),
                    toast(
                        'success',
                        pick === 'card' ? `「${meta.name}」已设为本卡默认，当前聊天也已换用。` : `当前聊天改用「${meta.name}」。`,
                    ),
                    render());
            } catch (error) {
                toast('error', `切换失败：${error.message}`);
            }
        }
    }
    async function editProject(id) {
        const meta = data.index().projects.find((item) => item.id === id);
        if (!meta) return;
        data.project(id) || (await data.loadProject(id));
        const mode = data.project(id) ? data.project(id).mode : 'normal',
            result = await openDialog({
                title: '编辑项目',
                html: `<label class="pi-field"><span>名称</span><input class="pi-inp" data-f="name" value="${esc(meta.name)}"></label>
                ${groupField(meta.group || '')}
                <label class="pi-check"><input type="checkbox" data-f="infinite"${mode === 'infinite' ? ' checked' : ''}><span>无限流模式</span></label>
                ${trpgField(isTrpg(data.project(id)))}`,
                onMount: mountGroupField,
                actions: [
                    { label: '删除项目', danger: !0, value: 'delete' },
                    { label: '取消', value: null },
                    {
                        label: '保存',
                        primary: !0,
                        value: (box) => ({
                            name: box.querySelector('[data-f=name]').value.trim(),
                            group: readGroupField(box),
                            mode: box.querySelector('[data-f=infinite]').checked ? 'infinite' : 'normal',
                            trpg: readTrpgField(box),
                        }),
                    },
                ],
            });
        if (result) {
            if (result === 'delete') {
                if (
                    !(await confirmDialog({
                        title: `删除「${meta.name}」`,
                        body: '将删除以下文件，聊天里记录的该项目进度保留。',
                        list: [`pi-p-${id}.json`, `pi-c-${id}.json`],
                        okLabel: '删除',
                        danger: !0,
                    }))
                )
                    return;
                try {
                    (await data.deleteProject(id), view.projectId === id && (view.projectId = ''), runtime.refresh(), render());
                } catch (error) {
                    toast('error', `删除失败：${error.message}`);
                }
                return;
            }
            (data.project(id) || (await data.loadProject(id)),
                data.renameProject(id, result.name, result.group),
                result.mode !== mode &&
                    data.updateProject(id, (project) => ({ ...project, mode: result.mode, infinite: normalizeInfinite(project.infinite) })),
                result.trpg !== null && result.trpg !== isTrpg(data.project(id)) && setTrpg(id, result.trpg && result.mode !== 'infinite'),
                runtime.refresh(),
                render());
        }
    }
    function onClick(event) {
        if (event.target.closest('.pi-pitem') && swallowAfterPress(event)) return;
        const target = event.target.closest('[data-act]');
        if (!target || !root.contains(target)) return;
        const act = target.dataset.act;
        if (act === 'close') return close();
        if (act === 'tour') return startTour(tourScopeOf(view));
        if (act === 'tour-reset') return (data.updateSettings({ tourState: { revision: TOUR_REVISION, done: [] } }), startTour('core'));
        if (act === 'project') return selectProject(target.dataset.id);
        if (act === 'new-project') return newProject();
        if (act === 'tab') return go(target.dataset.tab);
        if (act === 'page') return ((view.page = target.dataset.page), writeUi({ page: view.page }), setDrawer(!1), render());
        if (act === 'drawer') return setDrawer(!view.drawer);
        if (act === 'theme') return (setNight(!isNight()), writeUi({ night: isNight() }), renderSide());
        if (act === 'rename') return editProject(view.projectId);
        if (act === 'retry-project') return selectProject(view.projectId, view.tab);
        if (act === 'retry-render') return render();
        if (act === 'group') {
            const name = target.dataset.group;
            return (
                view.collapsed.has(name) ? view.collapsed.delete(name) : view.collapsed.add(name),
                writeUi({ collapsed: [...view.collapsed] }),
                renderSide()
            );
        }
        let handler = current().actions?.[act],
            native = event.target.closest && event.target.closest('input,select,textarea,label');
        handler &&
            ((native && native !== target && target.contains(native)) || event.preventDefault(),
            Promise.resolve(handler(view, target, event)).catch((error) => toast('error', error.message || String(error))));
    }
    let press = null,
        pressedAt = 0;
    function cancelPress() {
        (press && hostWindow().clearTimeout(press.timer), (press = null));
    }
    function onPointerDown(event) {
        const item = event.target.closest('.pi-pitem');
        !item ||
            !root.contains(item) ||
            event.button > 0 ||
            (cancelPress(),
            (press = {
                x: event.clientX,
                y: event.clientY,
                timer: hostWindow().setTimeout(() => {
                    ((press = null), (pressedAt = Date.now()), projectMenu(item.dataset.id));
                }, LONG_PRESS_MS),
            }));
    }
    function onPointerMove(event) {
        press && Math.hypot(event.clientX - press.x, event.clientY - press.y) > 10 && cancelPress();
    }
    function swallowAfterPress(event) {
        return Date.now() - pressedAt > 800 ? !1 : (event.preventDefault(), event.stopPropagation(), !0);
    }
    function onContext(event) {
        const item = event.target.closest('.pi-pitem');
        !item || !root.contains(item) || (event.preventDefault(), cancelPress(), !swallowAfterPress(event) && projectMenu(item.dataset.id));
    }
    function onChange(event) {
        const target = event.target;
        if (target.dataset.psearch !== void 0) return;
        const handler = current().onChange;
        handler && Promise.resolve(handler(view, target, event)).catch((error) => toast('error', error.message || String(error)));
    }
    function onInput(event) {
        event.target.classList && event.target.classList.contains('pi-ta-auto') && growBox(event.target);
        if (event.target.dataset.psearch !== void 0) return ((view.search = event.target.value), applySearch());
        const handler = current().onInput;
        handler && handler(view, event.target, event);
    }
    function onKey(event) {
        tour.isOpen() ||
            (event.key === 'Escape' &&
                root &&
                !doc.querySelector('.pi-dialog') &&
                (event.stopPropagation(), view.drawer ? setDrawer(!1) : close()),
            event.key === 'Enter' && (event.ctrlKey || event.metaKey) && current().onSubmit?.(view, event.target, event));
    }
    function open() {
        (ensureStyle(),
            !root &&
                ((view.drawer = !1),
                (lastSide = ''),
                (lastTop = ''),
                (root = el(`<div class="pi-root pi-overlay"><div class="pi-panel"><aside class="pi-side"></aside>
            <div class="pi-scrim" data-act="drawer"></div>
            <section class="pi-main"><header class="pi-top"></header><div class="pi-body"></div></section></div></div>`)),
                root.addEventListener('click', onClick),
                root.addEventListener('contextmenu', onContext),
                root.addEventListener('pointerdown', onPointerDown),
                root.addEventListener('pointermove', onPointerMove),
                root.addEventListener('pointerup', cancelPress),
                root.addEventListener('pointercancel', cancelPress),
                root.addEventListener('scroll', cancelPress, !0),
                root.addEventListener('change', onChange),
                root.addEventListener('input', onInput),
                root.addEventListener('compositionend', (event) => {
                    event.target.dataset.search && onInput(event);
                }),
                root.addEventListener('focusout', (event) => current().onBlur?.(view, event.target, event)),
                root.addEventListener('mousedown', (event) => {
                    event.target === root && (root.dataset.down = '1');
                }),
                root.addEventListener('mouseup', (event) => {
                    (event.target === root && root.dataset.down && close(), delete root.dataset.down);
                }),
                doc.addEventListener('keydown', onKey, !0),
                layerParent(doc).appendChild(root),
                (view.restored = !1),
                data.isReady() ? restore() : render(),
                maybeAutoTour()));
    }
    function close() {
        (tour.stop(!1),
            root &&
                (current().unmount?.(view),
                doc.removeEventListener('keydown', onKey, !0),
                root.remove(),
                (root = null),
                data.flush().catch(() => {})));
    }
    function refresh(reason) {
        if (!root) return;
        if (!view.restored && data.isReady()) return restore();
        (reason === 'index' || reason === 'switch' || reason === 'chat') && renderSide();
        const focused = doc.activeElement,
            typing =
                focused &&
                root.contains(focused) &&
                (focused.tagName === 'TEXTAREA' ||
                    (focused.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(focused.type)));
        if (reason === 'saved' || reason === 'save-failed') return current().onStatus?.(view, root);
        const only = current().refreshOn;
        (only && !only.includes(reason)) || typing || renderBody();
    }
    return { open, close, refresh, isOpen: () => !!root, view, cardName };
}
