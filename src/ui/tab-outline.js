import { CHANGE_FIELD, NODE_FIELDS, changeLines, flattenUnits, mainNodeNames, makeId, moveItem, moveStageToVolume, nearestUnitId, outlineIssues, outlineToText, parseOutlineText, pushOutlineHistory, replaceRest, replaceStages, restoreOutline, stageLabel, stageNodes, stageToText, volumeLabel, volumeToText } from '../core/outline.js';
import { outlineLinks, withAliases, withRenames } from '../core/align.js';
import { currentIndex, goTo, unitStates } from '../core/progress.js';
import { fixYamlMessages, outlineMessages, parseOutlineReply, rewriteRestMessages, stageOpMessages } from '../core/prompts.js';
import { downloadBlob, toast } from '../host/st.js';
import { ask, runTask } from './ai.js';
import { choiceDialog, confirmDialog, esc, menuDialog, openDialog, options, pickFiles, promptDialog } from './dom.js';
import { genActions, genRefTexts, genRefsBar } from './gen-refs.js';
import { normalizeGenRefs } from '../core/store.js';
import { ICONS } from './styles.js';
import { afterImport, classifyEntries, pickWorldbookEntries } from './wb-import.js';
import { hookSteps, migrateStageThreads, remapNodes, renameByPosition, renameNode } from '../core/threads.js';

const NODE_KEYS = {
    main: ['名称', '地点', '事件', '偏转'],
    side: ['名称', '地点', '事件', '触发', '偏转'],
    world: ['类型', '来源', '内容'],
};
const LONG_KEYS = new Set(['事件', '偏转', '内容', '触发']);
const NEW_NODE = { main: { 名称: '', 地点: '', 事件: '', 偏转: '' }, side: { 名称: '', 地点: '', 事件: '', 触发: '' }, world: { 类型: '', 来源: '', 内容: '' } };

const st = view => view.tabState('outline');

// outline v0.1.23：单阶段 AI 草稿的标题、历史版本、检查与总览。
const STAGE_DRAFT = { 'stage-refine': '细化节点', 'stage-split': '拆成两段', 'stage-merge': '与下一段合并' };
const fmtTime = time => new Date(time).toLocaleString();

// YAML 解析错误：中文只写「第 N 行格式有误」，英文原文收进「错误详情」。
const ERR_PREFIX = /^(?:YAML 格式错误(?:（第 \d+ 行）)?|第 \d+ 行)[：:]\s*/;
function errParts(error, line) {
    const text = String((error && error.message) || error || '');
    const no = line || (error && error.line) || Number((/第 (\d+) 行/.exec(text) || [])[1]) || 0;
    const detail = text.replace(ERR_PREFIX, '').trim();
    const yaml = Boolean(no) || (/^YAML 格式错误/.test(text) && !/[一-鿿]/.test(detail));
    return { no, detail, yaml };
}

function errHtml(error, line, tag = 'p') {
    const { no, detail, yaml } = errParts(error, line);
    if (!yaml) return `<${tag} class="pi-hint">${esc(detail)}</${tag}>`;
    return `<${tag} class="pi-hint">${no ? `第 ${no} 行格式有误` : '格式有误'}</${tag}>${detail ? `<details class="pi-err"><summary>错误详情</summary><div class="pi-meta">${esc(detail)}</div></details>` : ''}`;
}

function historyHtml(project, at) {
    const list = project.outline.history;
    if (!list.length) return '<div class="pi-card"><h3>历史版本</h3><p class="pi-hint">还没有历史版本。</p></div>';
    const chosen = list[at];
    return `<div class="pi-card"><h3>历史版本</h3>
        ${list.map((item, i) => `<div class="pi-hist"><span class="pi-grow">${item.label ? `${esc(item.label)}前` : '历史版本'}<span class="pi-meta pi-block">${esc(fmtTime(item.at))}</span></span>
            <span class="pi-meta pi-hist-n">${item.text.length} 字</span>
            <button type="button" class="pi-btn is-sm${i === at ? ' is-primary' : ''}" data-act="hist-view" data-i="${i}">预览</button>
            <button type="button" class="pi-btn is-sm" data-act="hist-restore" data-i="${i}">恢复</button></div>`).join('')}
        ${chosen ? `<pre class="pi-pre">${esc(chosen.text)}</pre>` : ''}</div>`;
}

function checkHtml(project) {
    const issues = outlineIssues(project.outline.volumes);
    if (!issues.length) return '<div class="pi-card"><h3>大纲检查</h3><p class="pi-hint">没有发现问题。</p></div>';
    return `<div class="pi-card"><h3>大纲检查<span class="pi-meta">${issues.length} 项</span></h3>
        ${issues.map(item => `<button type="button" class="pi-titem is-issue" data-act="issue-go" data-id="${esc(item.stageId || item.volumeId)}"><span class="pi-pname">${esc(item.text)}</span></button>`).join('')}</div>`;
}

function overviewHtml(view, project) {
    const { runtime } = view;
    const units = flattenUnits(project.outline.volumes);
    const live = runtime.activeId() === project.id;
    const states = live ? unitStates(units, runtime.progress()) : {};
    if (!units.length) return '<div class="pi-card"><p class="pi-hint">还没有卷。</p></div>';
    return project.outline.volumes.map(volume => `<div class="pi-card"><h3>${esc(volumeLabel(volume.key))}</h3>
        ${volume.stages.map(stage => {
        const names = mainNodeNames(stage.data);
        return `<button type="button" class="pi-ov-stage${states[stage.id] === 'active' ? ' is-active' : ''}${states[stage.id] === 'done' ? ' is-done' : ''}" data-act="ov-go" data-id="${esc(stage.id)}">
            <span class="pi-ov-title">${esc(stageLabel(stage.key))}</span>
            ${names.map(name => `<span class="pi-meta pi-ov-node">${esc(name)}</span>`).join('')}</button>`;
    }).join('') || '<p class="pi-hint">没有阶段</p>'}</div>`).join('');
}

function findSel(project, sel) {
    for (const volume of project.outline.volumes) {
        if (volume.id === sel) return { volume };
        const stage = volume.stages.find(item => item.id === sel);
        if (stage) return { volume, stage };
    }
    return {};
}

function treeHtml(project, sel) {
    return project.outline.volumes.map(volume => `<button type="button" class="pi-titem is-vol${volume.id === sel ? ' is-sel' : ''}" data-act="sel" data-id="${esc(volume.id)}"><span class="pi-pname">${esc(volumeLabel(volume.key))}</span></button>
        ${volume.stages.map(stage => `<button type="button" class="pi-titem is-stage${stage.id === sel ? ' is-sel' : ''}" data-act="sel" data-id="${esc(stage.id)}"><span class="pi-pname">${esc(stageLabel(stage.key))}</span></button>`).join('')}`).join('')
        || '<p class="pi-hint">还没有卷。</p>';
}

// threads v0.1.23：支线的钩子玩法、世界动态的进度钟，默认折叠在「玩法」里；空值不写进 YAML。
const PLAY_KEYS = { side: ['条件', '时限', '错过', '步骤'], world: ['进度钟', '前兆', '后果'] };
const PLAY_HINTS = { 条件: '满足后才激活，如主角到过酒馆', 时限: '激活后的楼数，或写「本卷」', 错过: '过期未接时的后果', 步骤: '每行一步，按顺序推进', 进度钟: '总格数，如 4、6、8', 前兆: '过半时透露的风声', 后果: '发生后写进状态变化' };
const PLAY_LONG = new Set(['错过', '步骤', '前兆', '后果']);
const PLAY_SHORT = new Set(['进度钟', '时限']);

function playEditor(meta, value, index) {
    const keys = PLAY_KEYS[meta.kind];
    if (!keys) return '';
    const shown = key => (key === '步骤' ? hookSteps(value).join('\n') : String(value[key] ?? ''));
    const attrs = key => `data-node-field="${esc(meta.field)}" data-i="${index}" data-k="${esc(key)}" data-play placeholder="${esc(PLAY_HINTS[key])}"`;
    const used = keys.some(key => shown(key).trim());
    return `<details class="pi-play"${used ? ' open' : ''}><summary>玩法</summary>
        ${keys.map(key => {
        const field = `<label class="pi-field"><span>${esc(key)}</span>${PLAY_LONG.has(key)
            ? `<textarea class="pi-ta" rows="2" ${attrs(key)}>${esc(shown(key))}</textarea>`
            : `<input class="pi-inp" ${key === '进度钟' ? 'type="number" min="2" max="12" ' : ''}${attrs(key)} value="${esc(shown(key))}">`}</label>`;
        return PLAY_SHORT.has(key) ? `<div class="pi-pair">${field}</div>` : field;
    }).join('')}</details>`;
}

// 玩法字段：进度钟、数字时限存成数字，步骤存成列表，空值删掉这个键。
function playValue(key, raw) {
    const text = String(raw ?? '').trim();
    if (key === '步骤') {
        const lines = text.split('\n').map(line => line.trim()).filter(Boolean);
        return lines.length ? lines : undefined;
    }
    if (!text) return undefined;
    if (key === '进度钟' || (key === '时限' && /^\d+$/.test(text))) return Number(text);
    return text;
}

function nodeEditor(stage, meta) {
    const list = Array.isArray(stage.data[meta.field]) ? stage.data[meta.field] : [];
    const items = list.map((item, index) => {
        const value = item && typeof item === 'object' ? item : { 内容: String(item ?? '') };
        const play = PLAY_KEYS[meta.kind] || [];
        const keys = [...new Set([...NODE_KEYS[meta.kind], ...Object.keys(value)])].filter(key => !play.includes(key));
        return `<div class="pi-node"><div class="pi-node-hd"><span class="pi-badge">${esc(meta.label)} ${index + 1}</span><span class="pi-grow"></span>
            <button type="button" class="pi-icon-btn" data-act="node-menu" data-field="${esc(meta.field)}" data-i="${index}" data-last="${index < list.length - 1 ? '' : '1'}" title="更多">${ICONS.more}</button></div>
            ${keys.map(key => `<label class="pi-field"><span>${esc(key)}</span>${LONG_KEYS.has(key)
                ? `<textarea class="pi-ta" rows="2" data-node-field="${esc(meta.field)}" data-i="${index}" data-k="${esc(key)}">${esc(value[key] ?? '')}</textarea>`
                : `<input class="pi-inp" data-node-field="${esc(meta.field)}" data-i="${index}" data-k="${esc(key)}" value="${esc(value[key] ?? '')}">`}</label>`).join('')}
            ${playEditor(meta, value, index)}</div>`;
    }).join('');
    return `<div class="pi-card"><h3>${esc(meta.field)}<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm" data-act="node-add" data-field="${esc(meta.field)}" data-kind="${meta.kind}">添加</button></h3>
        ${items || '<p class="pi-hint">无</p>'}</div>`;
}

// 节点按 主线 / 支线 / 世界动态 分开看，一次只展开一类，避免一长串。
function nodeTabs(stage, kind) {
    const count = meta => (Array.isArray(stage.data[meta.field]) ? stage.data[meta.field].length : 0);
    return `<div class="pi-seg pi-node-seg">${NODE_FIELDS.map(meta => `<button type="button" class="pi-seg-btn${meta.kind === kind ? ' is-sel' : ''}" data-act="node-kind" data-kind="${meta.kind}">${esc(meta.label)} ${count(meta)}</button>`).join('')}</div>`;
}

function stageEditor(volume, stage, raw, kind) {
    const known = new Set(['时间范围', 'AI指令', CHANGE_FIELD, ...NODE_FIELDS.map(item => item.field)]);
    const extra = Object.keys(stage.data).filter(key => !known.has(key));
    const head = `<div class="pi-card"><h3>阶段<span class="pi-spacer"></span><button type="button" class="pi-icon-btn" data-act="stage-menu" title="更多">${ICONS.more}</button></h3>
        <p class="pi-hint">所属：${esc(volumeLabel(volume.key))}</p>`;
    if (raw) {
        return `${head}<textarea class="pi-ta is-mono is-tall" data-raw>${esc(stageToText(stage))}</textarea>
            <div class="pi-tools is-c1 is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="raw-apply">应用</button></div><p class="pi-status" data-raw-status></p></div>`;
    }
    return `${head}<label class="pi-field"><span>阶段名（阶段N_标题）</span><input class="pi-inp" data-stage-key value="${esc(stage.key)}"></label>
        <label class="pi-field"><span>时间范围（用来判断何时切到下一段）</span><input class="pi-inp" data-stage-field="时间范围" value="${esc(stage.data.时间范围 ?? '')}"></label>
        <label class="pi-field"><span>AI指令</span><textarea class="pi-ta" rows="2" data-stage-field="AI指令">${esc(stage.data.AI指令 ?? '')}</textarea></label>
        <label class="pi-field"><span>状态变化（每行一条，本阶段演完后接在设定后面注入）</span><textarea class="pi-ta" rows="2" data-stage-list="${CHANGE_FIELD}" placeholder="例：她察觉到 A 对她不只是兄弟情">${esc(changeLines(stage.data).join('\n'))}</textarea></label>
        ${extra.length ? `<p class="pi-hint">另有字段：${esc(extra.join('、'))}（在 YAML 原文里编辑）</p>` : ''}</div>
        ${nodeTabs(stage, kind)}${nodeEditor(stage, NODE_FIELDS.find(meta => meta.kind === kind))}`;
}

function volumeEditor(volume) {
    return `<div class="pi-card"><h3>卷<span class="pi-spacer"></span><button type="button" class="pi-icon-btn" data-act="vol-menu" title="更多">${ICONS.more}</button></h3>
        <div class="pi-tools is-c1"><button type="button" class="pi-btn is-sm" data-act="stage-add">＋新阶段</button></div>
        <label class="pi-field"><span>卷名（剧情_卷X_标题）</span><input class="pi-inp" data-vol-key value="${esc(volume.key)}"></label>
        <p class="pi-hint">${volume.stages.length} 个阶段</p></div>`;
}

// 一次写多卷的草稿：合成一张卡，每卷一行，只有格式错误的卷展开编辑框；全部解析成功后才能追加。
function multiHtml(view, draft) {
    const busy = view.busy.outline;
    const good = draft.items.filter(item => item.ok);
    const rows = draft.items.map((item, i) => {
        const head = `<div class="pi-vrow"><span class="pi-grow">第 ${draft.volumeNo + i} 卷${item.ok && item.volumes[0] ? ` <b>${esc(volumeLabel(item.volumes[0].key))}</b>` : ''}</span>
            <span class="pi-meta">${item.ok ? '已解析' : '格式错误'}</span>
            <button type="button" class="pi-icon-btn" data-act="multi-menu" data-i="${i}" title="更多">${ICONS.more}</button></div>`;
        if (item.ok) return `<div class="pi-vitem">${head}</div>`;
        return `<div class="pi-vitem">${head}${errHtml(item.error, item.line)}
            <textarea class="pi-ta is-mono" rows="${Math.min(14, Math.max(6, String(item.yaml).split('\n').length + 1))}" data-draft-yaml>${esc(item.yaml)}</textarea>
            <div class="pi-tools is-c1 is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="multi-fix" data-i="${i}"${busy ? ' disabled' : ''}>让 AI 修正格式</button></div></div>`;
    }).join('');
    const ready = good.length === draft.items.length && good.length > 0;
    const partial = draft.items.length < draft.n;
    return `<div class="pi-card"><h3>AI 写的大纲<span class="pi-meta">${good.length}/${draft.n} 卷</span></h3>
        ${rows}
        <div class="pi-tools is-c2 is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="multi-append"${ready && !busy ? '' : ' disabled'}>${partial ? `追加已写完的 ${good.length} 卷` : '追加'}</button>
        <button type="button" class="pi-btn is-sm" data-act="multi-drop"${busy ? ' disabled' : ''}>丢弃</button></div></div>`;
}

function draftHtml(view, draft) {
    if (!draft) return '';
    if (draft.mode === 'multi') return multiHtml(view, draft);
    const title = STAGE_DRAFT[draft.mode] || (draft.mode === 'rewrite' ? '改写后续阶段' : 'AI 写的大纲');
    if (!draft.ok) {
        return `<div class="pi-card"><h3>${title}<span class="pi-badge is-danger">格式错误</span></h3>
            ${errHtml(draft.error, draft.line)}
            <textarea class="pi-ta is-mono is-tall" data-draft-yaml>${esc(draft.yaml)}</textarea>
            <div class="pi-tools is-c3 is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="draft-fix"${view.busy.outline ? ' disabled' : ''}>让 AI 修正格式</button>
            <button type="button" class="pi-btn is-sm" data-act="draft-reparse">重新解析</button>
            <button type="button" class="pi-btn is-sm" data-act="draft-drop">丢弃</button></div></div>`;
    }
    const summary = draft.volumes.map(volume => `<p class="pi-hint"><b>${esc(volumeLabel(volume.key))}</b>：${volume.stages.map(stage => esc(stageLabel(stage.key))).join('、')}</p>`).join('');
    const single = Boolean(STAGE_DRAFT[draft.mode]);
    const buttons = single
        ? '<button type="button" class="pi-btn is-primary is-sm" data-act="draft-stage">替换</button>'
        : draft.mode === 'rewrite'
            ? '<button type="button" class="pi-btn is-primary is-sm" data-act="draft-rest">替换剩余阶段</button>'
            : `<button type="button" class="pi-btn is-primary is-sm" data-act="draft-new">${draft.volumes.length > 1 ? `全部追加 ${draft.volumes.length} 卷` : '存为新卷'}</button>
           <button type="button" class="pi-btn is-sm" data-act="draft-replace">替换选中卷</button>
           <button type="button" class="pi-btn is-sm" data-act="draft-append">追加为新阶段</button>`;
    return `<div class="pi-card"><h3>${title}<span class="pi-badge is-ok">已解析</span></h3>${summary}
        <details><summary class="pi-hint">YAML 原文</summary><pre class="pi-pre">${esc(draft.yaml)}</pre></details>
        <div class="pi-tools is-end ${draft.mode === 'rewrite' || single ? 'is-c2' : 'is-c4'}">${buttons}<button type="button" class="pi-btn is-sm" data-act="draft-drop">丢弃</button></div></div>`;
}

// 多卷写作中途切走项目：已写好的草稿按项目收起，回到该项目时放回。
const parkedDrafts = new Map();
function syncDraft(view, s) {
    if (s.draft && s.draft.projectId && s.draft.projectId !== view.projectId) {
        parkedDrafts.set(s.draft.projectId, s.draft);
        s.draft = null;
    }
    if (!s.draft && parkedDrafts.has(view.projectId)) {
        s.draft = parkedDrafts.get(view.projectId);
        parkedDrafts.delete(view.projectId);
    }
}

export function render(view) {
    const project = view.project();
    const s = st(view);
    syncDraft(view, s);
    const { volume, stage } = findSel(project, s.sel);
    const busy = view.busy.outline;
    const kind = NODE_FIELDS.some(meta => meta.kind === s.nodeKind) ? s.nodeKind : NODE_FIELDS[0].kind;
    const editor = stage ? stageEditor(volume, stage, s.raw, kind) : volume ? volumeEditor(volume) : '<div class="pi-card"><p class="pi-hint">从左边选一卷或一个阶段编辑。</p></div>';
    return `<div class="pi-card"><h3>大纲<span class="pi-spacer"></span><button type="button" class="pi-icon-btn" data-act="outline-menu" title="更多">${ICONS.more}</button></h3>
        <div class="pi-tools is-c3">
            <button type="button" class="pi-btn is-sm${s.check ? ' is-primary' : ''}" data-act="check-toggle">检查</button>
            <button type="button" class="pi-btn is-sm${s.overview ? ' is-primary' : ''}" data-act="overview-toggle">总览</button>
            <button type="button" class="pi-btn is-sm${s.history ? ' is-primary' : ''}" data-act="history">历史 ${project.outline.history.length}</button></div>
        ${genRefsBar(view, 'outline')}
        <div class="pi-tools is-c1">${s.multi && s.multi.projectId === view.projectId
        ? `<button type="button" class="pi-btn is-primary is-sm" data-act="multi-stop"><span class="pi-spin"></span>写作中 ${s.multi.k}/${s.multi.n}，点击停止</button>`
        : `<button type="button" class="pi-btn is-primary is-sm" data-act="ai-volume"${busy ? ' disabled' : ''}>${busy ? '<span class="pi-spin"></span>写作中' : `AI 写第 ${project.outline.volumes.length + 1} 卷`}</button>`}</div>
        </div>
        ${draftHtml(view, s.draft)}
        ${s.check ? checkHtml(project) : ''}
        ${s.history ? historyHtml(project, s.historyAt) : ''}
        ${s.overview ? overviewHtml(view, project) : `<div class="pi-tree"><div class="pi-tree-list">${treeHtml(project, s.sel)}
            <button type="button" class="pi-btn is-sm is-ghost is-block" data-act="vol-add">＋新卷</button></div>
            <div>${editor}</div></div>`}`;
}

// 进度按「阶段id:前缀+序号」记节点；当前聊天在用这个项目时，节点挪动或删除后同步重排已取消勾选的节点与钟、钩子。
function liveProgress(view) {
    return view.runtime.activeId() === view.projectId ? view.runtime.progress() : null;
}

// progress 为改大纲之前取的进度：改完再取时已按名称归位过，再按位置重排会排反。
function remapProgress(view, progress, stageId, field, mapIndex) {
    const meta = NODE_FIELDS.find(item => item.field === field);
    if (!meta || !progress) return;
    const next = remapNodes(progress, stageId, meta.prefix, mapIndex);
    if (next !== progress) view.runtime.setProgress(next);
}

const swapIndex = (a, b) => i => (i === a ? b : i === b ? a : i);

// label 非空时，改动前的大纲先入历史版本。
// alias：改动附带写进对照表的阶段 id 别名（[[旧id, 新id]]，见 core/align.js），其他聊天读进度时按它对回。
function update(view, fn, label = '', { alias = [] } = {}) {
    return view.data.updateProject(view.projectId, project => ({
        ...project,
        outline: withAliases({
            ...project.outline,
            volumes: fn(project.outline.volumes),
            ...(label ? { history: pushOutlineHistory(project.outline.history, project.outline.volumes, label) } : {}),
        }, alias),
    }));
}

function updateStage(view, stageId, fn, label = '') {
    update(view, volumes => volumes.map(volume => (volume.stages.some(stage => stage.id === stageId)
        ? { ...volume, stages: volume.stages.map(stage => (stage.id === stageId ? fn(stage) : stage)) }
        : volume)), label);
}

function updateVolume(view, volumeId, fn, label = '') {
    update(view, volumes => volumes.map(volume => (volume.id === volumeId ? fn(volume) : volume)), label);
}

function moveUp(list, index) {
    if (index <= 0) return list;
    const out = [...list];
    [out[index - 1], out[index]] = [out[index], out[index - 1]];
    return out;
}

function addVolumes(view, incoming, label = '导入') {
    const project = view.project();
    const existing = new Set(project.outline.volumes.map(volume => volume.key));
    const fresh = incoming.map(volume => (existing.has(volume.key) ? { ...volume, key: `${volume.key}_导入${Date.now().toString(36).slice(-3)}` } : volume));
    update(view, volumes => [...volumes, ...fresh], label);
    st(view).sel = fresh[0] && fresh[0].id;
    view.runtime.refresh();
    return fresh;
}

async function importTexts(view, texts) {
    const added = [];
    const failed = [];
    for (const { name, text } of texts) {
        try {
            added.push(...parseOutlineText(text));
        } catch (error) {
            failed.push({ name, error });
        }
    }
    if (added.length) addVolumes(view, added);
    if (added.length) toast('success', `已导入 ${added.length} 卷。`);
    view.renderBody();
    if (failed.length) {
        await openDialog({ title: '导入失败', html: failed.map(item => `<p class="pi-hint"><b>${esc(item.name)}</b></p>${errHtml(item.error)}`).join(''), actions: [{ label: '关闭', value: true, primary: true }] });
    }
}

// all：多卷相关的入口（讨论页送来的 YAML、多卷写作）合并所有 yaml 代码块，其余只取第一个块。
function setDraft(view, mode, reply, extra = {}, { all = false } = {}) {
    st(view).draft = { mode, ...parseOutlineReply(reply, undefined, { all }), projectId: view.projectId, ...extra };
    view.renderBody();
}

export function showDraft(view, reply) {
    setDraft(view, 'volume', reply, {}, { all: true });
}

// 执行页偏转时调用：带着最近正文改写当前及之后的阶段。
export async function startRewrite(view) {
    const project = view.project();
    const units = flattenUnits(project.outline.volumes);
    if (!units.length) return;
    const from = Math.max(0, currentIndex(units, view.runtime.progress()));
    const reason = await promptDialog({ title: '让 AI 改写后续阶段', label: '偏转说明（可空）：剧情哪里和大纲不一样了', multiline: true });
    if (reason == null) return;
    view.go('outline');
    const recent = view.runtime.recentFloors(6).map(floor => floor.text).join('\n\n');
    const reply = await runTask(view, 'outline', () => ask(view, 'outline', rewriteRestMessages({
        setting: project.setting.text, volumes: project.outline.volumes, fromUnitIndex: from, units, recent, reason,
    })));
    if (reply) setDraft(view, 'rewrite', reply, { fromUnitId: units[from].id, reason });
}

function applyRest(view, draft) {
    const project = view.project();
    const unit = flattenUnits(project.outline.volumes).find(item => item.id === draft.fromUnitId);
    if (!unit) throw new Error('原来的阶段已不存在，改用「存为新卷」。');
    const volumes = replaceRest(project.outline.volumes, unit.stage.id, draft.volumes);
    update(view, () => volumes, '改写后续阶段');
    const first = draft.volumes[0] && draft.volumes[0].stages[0];
    if (first && view.runtime.activeId() === view.projectId) view.runtime.setProgress(goTo(view.runtime.progress(), flattenUnits(volumes), first.id));
    return first ? flattenUnits(volumes).findIndex(item => item.id === first.id) : 0;
}

// 「AI 写第 N 卷」弹窗：卷数 1 到 5 + 整体要求；写作按卷顺序逐卷请求。
const MAX_VOLUMES = 5;

async function writeDialog(view) {
    const picked = await openDialog({
        title: 'AI 写大纲',
        html: `<label class="pi-field"><span>卷数</span><select class="pi-sel" data-wv-n>${options(Array.from({ length: MAX_VOLUMES }, (_, i) => ({ value: i + 1, label: `${i + 1} 卷` })), 1)}</select></label>
            <label class="pi-field"><span>整体要求（可空）</span><textarea class="pi-ta" rows="4" data-wv-request>${esc(st(view).request || '')}</textarea></label>`,
        actions: [{ label: '取消', value: null }, { label: '开始写作', primary: true, value: root => ({ n: Number(root.querySelector('[data-wv-n]').value) || 1, request: root.querySelector('[data-wv-request]').value.trim() }) }],
    });
    if (picked) st(view).request = picked.request;
    return picked;
}

// 从讨论页进入时自动勾上讨论记录参考。
function setTalkRef(view) {
    view.data.updateProject(view.projectId, project => ({ ...project, genRefs: { ...normalizeGenRefs(project.genRefs), talk: true } }));
}

// 第 k 卷的请求：volumes 带已有卷和本轮前面已写好的卷。
function volumeRequest({ project, talk, wb, extra = [], no, k, n, request }) {
    const text = n > 1 ? `共写 ${n} 卷，这是第 ${k} 卷。${request || ''}` : request;
    return outlineMessages({ setting: project.setting.text, talk, refs: wb, volumes: [...project.outline.volumes, ...extra], volumeNo: no, request: text });
}

function setMultiItem(view, index, parsed) {
    const draft = st(view).draft;
    if (!draft || draft.mode !== 'multi') return;
    draft.items = draft.items.map((item, i) => (i === index ? parsed : item));
    view.renderBody();
}

// onConfirmed：写卷弹窗与覆盖草稿的确认都通过、开始写作前调用。
async function writeVolumes(view, n, request, onConfirmed = null) {
    const id = view.projectId;
    const pending = st(view).draft && st(view).draft.projectId === id ? st(view).draft : parkedDrafts.get(id);
    if (pending && !(await confirmDialog({ title: '覆盖草稿', body: '草稿区还有未处理的 AI 结果，开始写作后会被新草稿替换。', okLabel: '开始写作', danger: true }))) return;
    // 讨论记录参考开关在确认之后才打开，参考文字随后按新开关取。
    if (onConfirmed) onConfirmed();
    const project = view.project();
    const { talk, wb } = await genRefTexts(view, 12000);
    if (!project.setting.text.trim() && !talk.trim() && !wb.length) throw new Error('没有可参考的内容：在讨论页聊一聊，或点「世界书」选择条目。');
    const base = project.outline.volumes.length + 1;
    if (n <= 1) {
        const reply = await runTask(view, 'outline', () => ask(view, 'outline', volumeRequest({ project, talk, wb, no: base, k: 1, n: 1, request })));
        if (reply) setDraft(view, 'volume', reply);
        return;
    }
    const controller = new AbortController();
    const draft = { mode: 'multi', items: [], n, volumeNo: base, request, projectId: project.id };
    st(view).draft = draft;
    st(view).multi = { k: 1, n, controller, projectId: project.id };
    try {
        await runTask(view, 'outline', async () => {
            for (let k = 1; k <= n; k += 1) {
                st(view).multi.k = k;
                view.renderBody();
                let reply;
                try {
                    reply = await ask(view, 'outline', volumeRequest({
                        project, talk, wb, extra: draft.items.flatMap(item => item.volumes || []), no: base + k - 1, k, n, request,
                    }), { signal: controller.signal });
                } catch (error) {
                    if (!controller.signal.aborted) toast('error', `第 ${k} 卷写作失败：${error.message}。已写好的 ${draft.items.length} 卷保留在草稿里。`);
                    break;
                }
                if (controller.signal.aborted) break;
                draft.items = [...draft.items, parseOutlineReply(reply, undefined, { all: true })];
            }
        });
    } finally {
        st(view).multi = null;
        if (!draft.items.length) {
            if (st(view).draft === draft) st(view).draft = null;
            if (parkedDrafts.get(project.id) === draft) parkedDrafts.delete(project.id);
        }
        view.renderBody();
    }
}

export const actions = {
    ...genActions,
    'node-kind'(view, target) {
        st(view).nodeKind = target.dataset.kind;
        view.renderBody();
    },
    sel(view, target) {
        st(view).sel = target.dataset.id;
        st(view).raw = false;
        view.renderBody();
    },
    'vol-add'(view) {
        const project = view.project();
        const volume = { id: makeId('v'), key: `剧情_卷${project.outline.volumes.length + 1}_新卷`, stages: [{ id: makeId('s'), key: '阶段一_新阶段', data: { 时间范围: '', AI指令: '', 主线节点: [] } }] };
        update(view, volumes => [...volumes, volume]);
        st(view).sel = volume.id;
        view.renderBody();
    },
    'vol-up'(view) {
        update(view, volumes => moveUp(volumes, volumes.findIndex(volume => volume.id === st(view).sel)));
        view.runtime.refresh();
        view.renderBody();
    },
    'vol-down'(view) {
        update(view, volumes => moveItem(volumes, volumes.findIndex(volume => volume.id === st(view).sel), 1));
        view.runtime.refresh();
        view.renderBody();
    },
    async 'vol-menu'(view) {
        const pick = await menuDialog({ title: '卷', items: [
            { label: '上移', value: 'vol-up' }, { label: '下移', value: 'vol-down' }, { label: '导出本卷', value: 'vol-export' }, { label: '删除卷', value: 'vol-del', danger: true },
        ] });
        if (pick) await actions[pick](view);
    },
    'vol-export'(view) {
        const { volume } = findSel(view.project(), st(view).sel);
        if (volume) downloadBlob(`${volume.key}.yaml`, volumeToText(volume), 'text/yaml');
    },
    async 'vol-del'(view) {
        const { volume } = findSel(view.project(), st(view).sel);
        if (!volume || !(await confirmDialog({ title: `删除「${volumeLabel(volume.key)}」`, body: `连同 ${volume.stages.length} 个阶段一起删除。`, okLabel: '删除', danger: true }))) return;
        update(view, volumes => volumes.filter(item => item.id !== volume.id), '删除卷');
        st(view).sel = '';
        view.runtime.refresh();
        view.renderBody();
    },
    'stage-add'(view) {
        const { volume } = findSel(view.project(), st(view).sel);
        if (!volume) return;
        const stage = { id: makeId('s'), key: `阶段${volume.stages.length + 1}_新阶段`, data: { 时间范围: '', AI指令: '', 主线节点: [] } };
        updateVolume(view, volume.id, item => ({ ...item, stages: [...item.stages, stage] }));
        st(view).sel = stage.id;
        view.renderBody();
    },
    'stage-up'(view) {
        const { volume, stage } = findSel(view.project(), st(view).sel);
        if (!stage) return;
        updateVolume(view, volume.id, item => ({ ...item, stages: moveUp(item.stages, item.stages.indexOf(stage)) }));
        view.runtime.refresh();
        view.renderBody();
    },
    'stage-down'(view) {
        const { volume, stage } = findSel(view.project(), st(view).sel);
        if (!stage) return;
        updateVolume(view, volume.id, item => ({ ...item, stages: moveItem(item.stages, item.stages.findIndex(entry => entry.id === stage.id), 1) }));
        view.runtime.refresh();
        view.renderBody();
    },
    async 'stage-menu'(view) {
        const { volume, stage } = findSel(view.project(), st(view).sel);
        if (!stage) return;
        const last = volume.stages[volume.stages.length - 1] === stage;
        const pick = await menuDialog({ title: stageLabel(stage.key), items: [
            { label: '细化节点', value: 'stage-refine' },
            { label: '拆成两段', value: 'stage-split' },
            ...(last ? [] : [{ label: '与下一段合并', value: 'stage-merge' }]),
            { label: '上移', value: 'stage-up' },
            { label: '下移', value: 'stage-down' },
            { label: '移到…', value: 'stage-move' },
            { label: st(view).raw ? '表单编辑' : 'YAML 原文', value: 'raw' },
            { label: '删除阶段', value: 'stage-del', danger: true },
        ] });
        if (!pick) return;
        if (STAGE_DRAFT[pick]) await stageOp(view, pick.slice(6));
        else await actions[pick](view);
    },
    async 'stage-move'(view) {
        const { volume, stage } = findSel(view.project(), st(view).sel);
        const others = view.project().outline.volumes.filter(item => item.id !== volume.id);
        if (!stage || !others.length) return toast('info', '没有其他卷可移动。');
        const to = await menuDialog({ title: '移到…', items: others.map(item => ({ label: volumeLabel(item.key), value: item.id })) });
        if (!to) return;
        update(view, volumes => moveStageToVolume(volumes, stage.id, to));
        view.runtime.refresh();
        view.renderBody();
    },
    async 'stage-del'(view) {
        const { volume, stage } = findSel(view.project(), st(view).sel);
        if (!stage || !(await confirmDialog({ title: `删除「${stageLabel(stage.key)}」`, okLabel: '删除', danger: true }))) return;
        updateVolume(view, volume.id, item => ({ ...item, stages: item.stages.filter(entry => entry.id !== stage.id) }), '删除阶段');
        st(view).sel = volume.id;
        view.runtime.refresh();
        view.renderBody();
    },
    raw(view) {
        st(view).raw = !st(view).raw;
        view.renderBody();
    },
    'raw-apply'(view, target) {
        const { stage } = findSel(view.project(), st(view).sel);
        const box = target.closest('.pi-card');
        const status = box.querySelector('[data-raw-status]');
        try {
            const parsed = parseOutlineText(box.querySelector('[data-raw]').value);
            const next = parsed[0] && parsed[0].stages[0];
            if (!next || parsed.length > 1 || parsed[0].stages.length > 1) throw new Error('原文里只能有一个阶段');
            updateStage(view, stage.id, item => ({ ...item, key: next.key, data: next.data }), 'YAML 原文应用');
            view.runtime.refresh();
            st(view).raw = false;
            view.renderBody();
        } catch (error) {
            status.innerHTML = errHtml(error, 0, 'span');
            status.classList.add('is-err');
        }
    },
    'node-add'(view, target) {
        const { stage } = findSel(view.project(), st(view).sel);
        const field = target.dataset.field;
        updateStage(view, stage.id, item => ({ ...item, data: { ...item.data, [field]: [...(Array.isArray(item.data[field]) ? item.data[field] : []), { ...NEW_NODE[target.dataset.kind] }] } }));
        view.renderBody();
    },
    'node-up'(view, target) {
        const { stage } = findSel(view.project(), st(view).sel);
        const field = target.dataset.field;
        const index = Number(target.dataset.i);
        if (index <= 0) return;
        const before = liveProgress(view);
        updateStage(view, stage.id, item => ({ ...item, data: { ...item.data, [field]: moveUp(item.data[field], index) } }));
        remapProgress(view, before, stage.id, field, swapIndex(index - 1, index));
        view.runtime.refresh();
        view.renderBody();
    },
    'node-down'(view, target) {
        const { stage } = findSel(view.project(), st(view).sel);
        const field = target.dataset.field;
        const index = Number(target.dataset.i);
        if (index >= (stage.data[field] || []).length - 1) return;
        const before = liveProgress(view);
        updateStage(view, stage.id, item => ({ ...item, data: { ...item.data, [field]: moveItem(item.data[field], index, 1) } }));
        remapProgress(view, before, stage.id, field, swapIndex(index, index + 1));
        view.runtime.refresh();
        view.renderBody();
    },
    async 'node-menu'(view, target) {
        const index = Number(target.dataset.i);
        const pick = await menuDialog({ title: `${target.dataset.field} ${index + 1}`, items: [
            { label: '上移', value: 'node-up', disabled: index <= 0 },
            { label: '下移', value: 'node-down', disabled: Boolean(target.dataset.last) },
            { label: '删除', value: 'node-del', danger: true },
        ] });
        if (pick) await actions[pick](view, target);
    },
    async 'node-del'(view, target) {
        const { stage } = findSel(view.project(), st(view).sel);
        const field = target.dataset.field;
        const index = Number(target.dataset.i);
        const node = stage.data[field][index];
        if (!(await confirmDialog({ title: `删除「${(node && (node.名称 || node.类型)) || '节点'}」`, okLabel: '删除', danger: true }))) return;
        const before = liveProgress(view);
        updateStage(view, stage.id, item => {
            const list = item.data[field].filter((_, i) => i !== index);
            const data = { ...item.data, [field]: list };
            if (!list.length && field !== '主线节点') delete data[field];
            return { ...item, data };
        });
        remapProgress(view, before, stage.id, field, i => (i === index ? null : i > index ? i - 1 : i));
        view.runtime.refresh();
        view.renderBody();
    },
    async 'outline-menu'(view) {
        const pick = await menuDialog({ title: '大纲', items: [
            { label: '导入YAML', value: 'import-file' },
            { label: '粘贴', value: 'import-paste' },
            { label: '从世界书', value: 'import-wb' },
            { label: '导出', value: 'export', disabled: !view.project().outline.volumes.length },
        ] });
        if (pick) await actions[pick](view);
    },
    async 'import-file'(view) {
        const files = await pickFiles({ accept: '.yaml,.yml,.txt', multiple: true });
        if (!files.length) return;
        await importTexts(view, await Promise.all(files.sort((a, b) => a.name.localeCompare(b.name, 'zh')).map(async file => ({ name: file.name, text: await file.text() }))));
    },
    async 'import-paste'(view) {
        const text = await promptDialog({ title: '粘贴剧情 YAML', multiline: true, placeholder: '剧情_卷一_标题:\n  阶段一_标题:\n    时间范围: …' });
        if (text) await importTexts(view, [{ name: '粘贴内容', text }]);
    },
    async 'import-wb'(view) {
        const picked = await pickWorldbookEntries('从世界书导入大纲或设定');
        if (!picked.length) return;
        const { outline, setting } = classifyEntries(picked);
        if (outline.length) addVolumes(view, outline.flatMap(item => item.volumes));
        if (setting.length) {
            view.data.updateProject(view.projectId, project => {
                const text = [project.setting.text, ...setting.map(entry => entry.content)].filter(Boolean).join('\n\n');
                return { ...project, setting: { ...project.setting, text } };
            });
        }
        toast('success', `${outline.length} 条进大纲，${setting.length} 条进设定。`);
        view.runtime.refresh();
        view.renderBody();
        await afterImport(picked);
    },
    async export(view) {
        const project = view.project();
        const choice = await choiceDialog({ title: '导出大纲', choices: [{ label: '取消', value: null }, { label: '每卷一个文件', value: 'each' }, { label: '合成一个文件', value: 'one', primary: true }] });
        if (choice === 'one') downloadBlob(`${project.name}-大纲.yaml`, outlineToText(project.outline.volumes), 'text/yaml');
        if (choice === 'each') project.outline.volumes.forEach((volume, i) => downloadBlob(`${String(i + 1).padStart(2, '0')}-${volume.key}.yaml`, volumeToText(volume), 'text/yaml'));
    },
    async 'ai-volume'(view, target, { withTalk = false } = {}) {
        if (view.busy.outline) return;
        const picked = await writeDialog(view);
        if (!picked) return;
        await writeVolumes(view, picked.n, picked.request, withTalk ? () => setTalkRef(view) : null);
    },
    'multi-stop'(view) {
        const multi = st(view).multi;
        if (multi) multi.controller.abort();
    },
    async 'multi-fix'(view, target) {
        const draft = st(view).draft;
        const i = Number(target.dataset.i);
        const box = target.closest('.pi-vitem')?.querySelector('[data-draft-yaml]');
        const text = box ? box.value : draft.items[i].yaml;
        const reply = await runTask(view, 'outline', () => ask(view, 'outline', fixYamlMessages(text, draft.items[i].error)));
        if (reply) setMultiItem(view, i, parseOutlineReply(reply, undefined, { all: true }));
    },
    async 'multi-menu'(view, target) {
        const draft = st(view).draft;
        const i = Number(target.dataset.i);
        const item = draft && draft.items[i];
        if (!item) return;
        const busy = view.busy.outline;
        const pick = await menuDialog({ title: `第 ${draft.volumeNo + i} 卷`, items: [
            ...(item.ok ? [{ label: 'YAML 原文', value: 'multi-yaml' }] : []),
            { label: '重写这一卷', value: 'multi-redo', disabled: busy },
            ...(item.ok ? [] : [{ label: '修正格式', value: 'multi-fix', disabled: busy }, { label: '重新解析', value: 'multi-reparse' }]),
        ] });
        if (pick) await actions[pick](view, target);
    },
    async 'multi-yaml'(view, target) {
        const item = st(view).draft.items[Number(target.dataset.i)];
        await openDialog({ title: 'YAML 原文', html: `<pre class="pi-pre">${esc(item.yaml)}</pre>`, actions: [{ label: '关闭', value: true, primary: true }] });
    },
    async 'multi-drop'(view) {
        if (!(await confirmDialog({ title: '丢弃草稿', body: '已写好的卷不会保存。', okLabel: '丢弃', danger: true }))) return;
        st(view).draft = null;
        view.renderBody();
    },
    'multi-reparse'(view, target) {
        const i = Number(target.dataset.i);
        const yaml = target.closest('.pi-vitem').querySelector('[data-draft-yaml]').value;
        setMultiItem(view, i, parseOutlineReply(`\`\`\`yaml\n${yaml}\n\`\`\``));
    },
    async 'multi-redo'(view, target) {
        const draft = st(view).draft;
        const i = Number(target.dataset.i);
        const project = view.project();
        const { talk, wb } = await genRefTexts(view, 12000);
        const before = draft.items.filter((item, index) => index !== i && item.ok).flatMap(item => item.volumes);
        const reply = await runTask(view, 'outline', () => ask(view, 'outline', volumeRequest({
            project, talk, wb, extra: before, no: draft.volumeNo + i, k: i + 1, n: draft.n, request: draft.request,
        })));
        if (reply) setMultiItem(view, i, parseOutlineReply(reply, undefined, { all: true }));
    },
    'multi-append'(view) {
        const draft = st(view).draft;
        if (!draft || draft.items.some(item => !item.ok)) return;
        const volumes = draft.items.flatMap(item => item.volumes);
        addVolumes(view, volumes, 'AI 追加多卷');
        st(view).draft = null;
        view.renderBody();
    },
    async 'draft-fix'(view, target) {
        const draft = st(view).draft;
        const box = target.closest('.pi-card').querySelector('[data-draft-yaml]');
        const text = box ? box.value : draft.yaml;
        const reply = await runTask(view, 'outline', () => ask(view, 'outline', fixYamlMessages(text, draft.error)));
        if (reply) setDraft(view, draft.mode, reply, { fromUnitId: draft.fromUnitId, reason: draft.reason, stageId: draft.stageId, nextId: draft.nextId });
    },
    'draft-reparse'(view, target) {
        const draft = st(view).draft;
        const yaml = target.closest('.pi-card').querySelector('[data-draft-yaml]').value;
        setDraft(view, draft.mode, `\`\`\`yaml\n${yaml}\n\`\`\``, { fromUnitId: draft.fromUnitId, reason: draft.reason, stageId: draft.stageId, nextId: draft.nextId });
    },
    'draft-drop'(view) {
        st(view).draft = null;
        view.renderBody();
    },
    'draft-new'(view) {
        addVolumes(view, st(view).draft.volumes, 'AI 新建卷');
        st(view).draft = null;
        view.renderBody();
    },
    async 'draft-replace'(view) {
        const { volume } = findSel(view.project(), st(view).sel);
        if (!volume) throw new Error('先在左边选中要替换的卷');
        if (!(await confirmDialog({ title: `替换「${volumeLabel(volume.key)}」`, body: '该卷原有阶段全部换成 AI 写的内容。', okLabel: '替换', danger: true }))) return;
        const incoming = st(view).draft.volumes;
        update(view, volumes => volumes.flatMap(item => (item.id === volume.id ? incoming : [item])), 'AI 替换整卷');
        st(view).draft = null;
        st(view).sel = incoming[0].id;
        view.runtime.refresh();
        view.renderBody();
    },
    'draft-append'(view) {
        const { volume } = findSel(view.project(), st(view).sel);
        if (!volume) throw new Error('先在左边选中要追加到的卷');
        const stages = st(view).draft.volumes.flatMap(item => item.stages);
        updateVolume(view, volume.id, item => ({ ...item, stages: [...item.stages, ...stages] }), 'AI 追加阶段');
        st(view).draft = null;
        view.runtime.refresh();
        view.renderBody();
    },
    async 'draft-rest'(view) {
        if (!(await confirmDialog({ title: '替换剩余阶段', body: '当前阶段及之后的阶段会换成改写后的内容，进度跳到改写后的第一段。', okLabel: '替换', danger: true }))) return;
        const draft = st(view).draft;
        const from = applyRest(view, draft);
        st(view).draft = null;
        view.renderBody();
        const titles = await runTask(view, 'outline', () => view.runtime.syncSetting(view.projectId, { from, reason: draft.reason }));
        if (titles && titles.length) toast('success', `设定已按新大纲修改：${titles.join('、')}。可在设定页的历史版本里回退。`);
    },
    // outline v0.1.23：历史版本、检查、总览、单阶段草稿。
    history(view) {
        st(view).history = !st(view).history;
        st(view).historyAt = undefined;
        view.renderBody();
    },
    'hist-view'(view, target) {
        st(view).historyAt = Number(target.dataset.i);
        view.renderBody();
    },
    async 'hist-restore'(view, target) {
        const item = view.project().outline.history[Number(target.dataset.i)];
        if (!item || !(await confirmDialog({ title: '恢复大纲', body: '当前大纲会先存进历史版本，再换成这一版。' }))) return;
        const before = view.project().outline.volumes;
        const progress = liveProgress(view);
        const { volumes, alias } = restoreOutline(item.text, before);
        update(view, () => volumes, '恢复历史版本', { alias });
        // 当前聊天：先按位置补一次改名（节点名变回旧名），再看当前阶段是否还在；不在时沿别名表找，仍找不到取位置最接近的阶段。
        if (progress) {
            const units = flattenUnits(volumes);
            const links = outlineLinks(view.project().outline, units);
            let next = renameByPosition(progress, units, links);
            const cur = flattenUnits(before)[currentIndex(flattenUnits(before), progress)]?.id;
            const resolved = cur ? links.resolve(cur) : '';
            const alive = resolved && units.some(unit => unit.id === resolved);
            const to = alive ? (resolved === cur ? null : resolved) : nearestUnitId(before, volumes, cur);
            if (to) next = goTo(next, units, to);
            if (next !== progress) view.runtime.setProgress(next);
        }
        st(view).sel = '';
        view.runtime.refresh();
        view.renderBody();
    },
    'check-toggle'(view) {
        st(view).check = !st(view).check;
        view.renderBody();
    },
    'overview-toggle'(view) {
        st(view).overview = !st(view).overview;
        view.renderBody();
    },
    'issue-go'(view, target) {
        st(view).sel = target.dataset.id;
        st(view).raw = false;
        st(view).overview = false;
        view.renderBody();
    },
    'ov-go'(view, target) {
        st(view).sel = target.dataset.id;
        st(view).raw = false;
        st(view).overview = false;
        view.renderBody();
    },
    async 'draft-stage'(view) {
        const draft = st(view).draft;
        const project = view.project();
        const volume = project.outline.volumes.find(item => item.stages.some(stage => stage.id === draft.stageId));
        if (!volume) throw new Error('原来的阶段已不存在，改用「丢弃」。');
        const incoming = draft.volumes.flatMap(item => item.stages);
        if (!incoming.length) throw new Error('结果里没有阶段。');
        const ids = [draft.stageId, ...(draft.nextId ? [draft.nextId] : [])];
        const old = volume.stages.filter(stage => ids.includes(stage.id));
        const { volumes, stages, keepId } = replaceStages(project.outline.volumes, volume.id, ids, incoming);
        // 第一段沿用原阶段 id；钟、钩子、已取消勾选的节点按名称迁到新阶段，进度指向沿用 id 的那段。
        // 进度在改大纲之前取（之后取会先按别名表归位）；被换掉的 id 记进别名表，其他聊天打开时跟过来。
        const progress = liveProgress(view);
        update(view, () => volumes, STAGE_DRAFT[draft.mode], { alias: ids.filter(id => id !== keepId).map(id => [id, keepId]) });
        if (progress) {
            const moved = migrateStageThreads(progress, old, stages, keepId);
            view.runtime.setProgress(ids.includes(progress.current) ? goTo(moved, flattenUnits(volumes), keepId) : moved);
        }
        st(view).draft = null;
        st(view).sel = keepId;
        view.runtime.refresh();
        view.renderBody();
    },
};

// 单阶段 AI 操作：结果先进草稿区，点「替换」才落盘。
async function stageOp(view, op) {
    const project = view.project();
    const unit = flattenUnits(project.outline.volumes).find(item => item.id === st(view).sel);
    if (!unit) return;
    const next = op === 'merge' ? unit.volume.stages[unit.stageIndex + 1] : null;
    if (op === 'merge' && !next) throw new Error('本卷没有下一段可合并。');
    const { talk, wb } = await genRefTexts(view, 12000);
    const reply = await runTask(view, 'outline', () => ask(view, 'outline', stageOpMessages({
        setting: project.setting.text, talk, refs: wb, volumes: project.outline.volumes, unit, next, op,
    })));
    if (reply) setDraft(view, `stage-${op}`, reply, { stageId: unit.stage.id, nextId: next ? next.id : '' });
}

function renameInTree(target, id, label) {
    const item = target.closest('.pi-body')?.querySelector(`.pi-titem[data-id="${id}"] .pi-pname`);
    if (item) item.textContent = label;
}

export function onInput(view, target) {
    const { stage, volume } = findSel(view.project(), st(view).sel);
    if (target.dataset.aiRequest !== undefined) {
        st(view).request = target.value;
        return;
    }
    if (target.dataset.volKey !== undefined && volume) {
        const key = target.value.trim();
        if (key && !view.project().outline.volumes.some(item => item.key === key && item.id !== volume.id)) {
            updateVolume(view, volume.id, item => ({ ...item, key }));
            renameInTree(target, volume.id, volumeLabel(key));
        }
        return;
    }
    if (!stage) return;
    if (target.dataset.stageKey !== undefined) {
        const key = target.value.trim();
        if (key && !volume.stages.some(item => item.key === key && item.id !== stage.id)) {
            updateStage(view, stage.id, item => ({ ...item, key }));
            renameInTree(target, stage.id, stageLabel(key));
        }
        return;
    }
    if (target.dataset.stageField) {
        const field = target.dataset.stageField;
        updateStage(view, stage.id, item => ({ ...item, data: { ...item.data, [field]: target.value } }));
        return;
    }
    if (target.dataset.stageList) {
        const field = target.dataset.stageList;
        const lines = target.value.split('\n').map(line => line.trim()).filter(Boolean);
        updateStage(view, stage.id, item => {
            const data = { ...item.data, [field]: lines };
            if (!lines.length) delete data[field];
            return { ...item, data };
        });
        return;
    }
    if (target.dataset.nodeField) {
        const field = target.dataset.nodeField;
        const index = Number(target.dataset.i);
        const key = target.dataset.k;
        const pending = nameKey(stage.id, field, index);
        if (['名称', '类型', '内容'].includes(key) && !pendingNames.has(pending)) {
            const node = nodeAt(stage, field, index);
            if (node) pendingNames.set(pending, node.name);
        }
        updateStage(view, stage.id, item => {
            const list = [...item.data[field]];
            const prev = list[index] && typeof list[index] === 'object' ? list[index] : {};
            list[index] = { ...prev, [key]: target.value };
            if (target.dataset.play !== undefined) {
                const value = playValue(key, target.value);
                if (value === undefined) delete list[index][key];
                else list[index][key] = value;
            }
            return { ...item, data: { ...item.data, [field]: list } };
        });
    }
}

// 失焦时同步注入内容；名字改动直接改树上的文字，不整页重画（避免吞掉紧接着的点击）。
export function onBlur(view, target) {
    if (target.dataset.nodeField && ['名称', '类型', '内容'].includes(target.dataset.k)) syncNodeName(view, target.dataset.nodeField, Number(target.dataset.i));
    if (target.matches('[data-stage-key],[data-vol-key],[data-stage-field],[data-stage-list],[data-node-field]')) view.runtime.refresh();
}

// 改了节点名：改名记进大纲的改名表（其他聊天按改名链找回记录），当前聊天同一位置的钟、钩子、已演标记跟着改名。
// 改名前的名称在第一次输入时记下（pendingNames），失焦时比对。
const pendingNames = new Map();
const nameKey = (stageId, field, index) => [stageId, field, index].join('|');

function nodeAt(stage, field, index) {
    return stage ? stageNodes(stage.data).find(item => item.field === field && item.index === index) : null;
}

function syncNodeName(view, field, index) {
    const { stage } = findSel(view.project(), st(view).sel);
    if (!stage) return;
    const key = nameKey(stage.id, field, index);
    const from = pendingNames.get(key);
    pendingNames.delete(key);
    const node = nodeAt(stage, field, index);
    if (!node) return;
    if (from && from !== node.name) {
        view.data.updateProject(view.projectId, project => ({ ...project, outline: withRenames(project.outline, [{ stageId: stage.id, field, from, to: node.name }]) }));
    }
    const progress = liveProgress(view);
    if (!progress) return;
    const next = renameNode(progress, { id: stage.id }, node);
    if (next !== progress) view.runtime.setProgress(next);
}

export const refreshOn = [];
