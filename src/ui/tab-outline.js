import {
    tableCondReport,
    clueIndexText,
    chatFactSets,
    checkClueDraft,
    restoreHistory,
    clueProgressText,
    historyGuard,
    discoveryList,
} from '../core/clue-project.js';
import {
    tableCatalogText,
    clueRewriteMessages,
    transcript,
    fixYamlMessages,
    outlineMessages,
    parseOutlineReply,
    rewriteRestMessages,
    stageOpMessages,
} from '../core/prompts.js';

import { acuApi } from '../app/clue-runtime.js';
import { cloneTables } from '../core/clue-tables.js';
import { prepareLabels } from './clue-run.js';

import { CLUE_STAGE_KEYS, reidConflicts, isClueMode, normalizeClue } from '../core/clue-model.js';
import { putVolume, prepareCommit, commitOutline, draftDiffers, targetStamp } from '../core/review-draft.js';
import { renderImport, importActions, importJobOf } from './long-import.js';
// 讨论页「打开审阅」用（经这里转一下，免得讨论页直接引 long-import 造成模块加载顺序问题）
export { openEditReview, showEditReview } from './long-import.js';
import { openEditReview, showEditReview } from './long-import.js';
import { reviewOnInput } from './import-review.js';
import { projectClueIssues, importJobKind } from '../core/long-import.js';
import { projectSecretNames } from '../core/store.js';

import { settingPiecesFromEntries, afterImport, classifyEntries, pickWorldbookEntries } from './wb-import.js';
import { stringifyYaml, parseYaml } from '../core/yaml.js';
import { ctx, downloadBlob, toast } from '../host/st.js';

import { resolveRefs, progressText, fitRefs } from './discuss-refs.js';

import { compileClue, parseCondition, conditionRefs, isRequired } from '../core/clue-rules.js';

import {
    isPlainObject,
    CHANGE_FIELD,
    NODE_FIELDS,
    nodeWord,
    changeLines,
    flattenUnits,
    mainNodeNames,
    makeId,
    moveItem,
    moveStageToVolume,
    nearestUnitId,
    outlineIssues,
    outlineToText,
    parseOutlineText,
    pushOutlineHistory,
    replaceRest,
    replaceStages,
    restoreOutline,
    stageLabel,
    stageNodes,
    stageToText,
    volumeName,
    volumeShowName,
    volumeToText,
} from '../core/outline.js';

import { outlineLinks, withAliases, withRenames } from '../core/align.js';
import { currentIndex, goTo, unitStates } from '../core/progress.js';

import { ask, runTask } from './ai.js';
import { choiceDialog, confirmDialog, esc, menuDialog, openDialog, options, pickFiles, promptDialog } from './dom.js';
import { genActions, genRefTexts, genRefsBar } from './gen-refs.js';
import { normalizeGenRefs } from '../core/store.js';
import { ICONS } from './styles.js';

import { hookSteps, migrateStageThreads, remapNodes, renameByPosition, renameNode } from '../core/threads.js';

const NODE_KEYS = {
    main: ['名称', '地点', '事件', '偏转'],
    side: ['名称', '地点', '事件', '触发', '偏转'],
    world: ['类型', '来源', '内容'],
};
const LONG_KEYS = new Set(['事件', '偏转', '内容', '触发']);
const NEW_NODE = {
    main: { 名称: '', 地点: '', 事件: '', 偏转: '' },
    side: { 名称: '', 地点: '', 事件: '', 触发: '' },
    world: { 类型: '', 来源: '', 内容: '' },
};

const st = (view) => view.tabState('outline');

// outline v0.1.23：单阶段 AI 草稿的标题、历史版本、检查与总览。
const STAGE_DRAFT = { 'stage-refine': '细化节点', 'stage-split': '拆成两段', 'stage-merge': '与下一段合并' };
const fmtTime = (time) => new Date(time).toLocaleString();

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
        ${list
            .map(
                (
                    item,
                    i,
                ) => `<div class="pi-hist"><span class="pi-grow">${item.label ? `${esc(item.label)}前` : '历史版本'}<span class="pi-meta pi-block">${esc(fmtTime(item.at))}</span></span>
            <span class="pi-meta pi-hist-n">${item.text.length} 字</span>
            <button type="button" class="pi-btn is-sm${i === at ? ' is-primary' : ''}" data-act="hist-view" data-i="${i}">预览</button>
            <button type="button" class="pi-btn is-sm" data-act="hist-restore" data-i="${i}">恢复</button></div>`,
            )
            .join('')}
        ${chosen ? `<pre class="pi-pre">${esc(chosen.text)}</pre>` : ''}</div>`;
}

// 叫法（导入审阅总方案第三节 I）：线索推进里「卷」叫「剧情线」，阶段推进照旧叫「卷」。YAML 键名不变。
// p：项目或 view（取 view.project()）。
export function vq(p, outline, clue) {
    let project = p && typeof p.project === 'function' ? p.project() : p;
    return project && isClueMode(project) ? clue : outline;
}

// 大纲检查。线索推进的项目：用和导入审阅同一套人话检查（走不通的地方、替代途径、拿不到的线索、保密名字），
// 每条可以点，跳到那个阶段；按阶段推进的项目：原来的格式检查（时间范围、主线节点、重名）。
// 审阅修改里有几条线改了还没保存（读审阅修改任务的草稿，不调 AI）
function editDraftCount(view, project) {
    let job = (project.imports || []).map((id) => view.data.imports.get(id)).find((j) => j && importJobKind(j) === 'edit' && j.review && Array.isArray(j.review.draft));
    if (!job) return 0;
    return job.review.draft.filter((v) => {
        let b = (job.review.base || []).find((x) => x.id === v.id),
            live = project.outline.volumes.find((x) => x.id === v.id);
        return b && live && draftDiffers([b], [v]) && draftDiffers([live], [v]);
    }).length;
}
// 检查按钮上的数字：要处理的问题数（大纲没变就用上次算的结果）
const checkCache = new WeakMap();
function checkErrorCount(view, project) {
    let key = project.outline.volumes,
        hit = checkCache.get(key);
    if (hit !== void 0) return hit;
    let n = 0;
    try {
        let clue = isClueMode(project);
        n = clue ? projectClueIssues(project.outline.volumes, { secrets: projectSecretNames(project) }).filter((x) => x.level === 'error').length : 0;
    } catch {}
    return (checkCache.set(key, n), n);
}
function checkHtml(view, project) {
    const clue = isClueMode(project),
        current = clue && view.runtime.activeId() === view.projectId ? view.runtime.clue.compute() : null,
        { known, claimed } = chatFactSets(current),
        base = outlineIssues(project.outline.volumes).filter((x) => !clue || x.kind !== 'no-time'),
        more = clue ? projectClueIssues(project.outline.volumes, { secrets: projectSecretNames(project), knownFacts: known, claimedFacts: claimed }) : [],
        errs = more.filter((x) => x.level === 'error'),
        asks = more.filter((x) => x.level !== 'error'),
        total = base.length + more.length,
        idOf = (x) => x.stageId || (x.stageIds && x.stageIds[0]) || x.volumeId || '',
        row = (x) => {
            let id = idOf(x),
                body = `<span class="pi-pname">${esc(x.plain || x.text)}</span>${x.fix ? `<span class="pi-hint pi-check-fix">怎么改：${esc(x.fix)}</span>` : ''}`;
            return id
                ? `<button type="button" class="pi-titem is-issue pi-check-item" data-act="issue-go" data-id="${esc(id)}">${body}</button>`
                : `<div class="pi-titem is-issue pi-check-item">${body}</div>`;
        };
    if (!total) return `<div class="pi-card"><h3>大纲检查</h3><p class="pi-hint">没有发现问题。${clue ? '（按线索推进检查了：走不走得通、拿不拿得到线索、替代途径。）' : ''}</p></div>`;
    return `<div class="pi-card"><h3>大纲检查<span class="pi-meta">${total} 项</span></h3>
        ${clue ? '<p class="pi-hint">点一条跳到那个阶段。想让 AI 改：点「审阅修改…」，在那条线的页上写意见。</p>' : ''}
        ${errs.length ? `<div class="pi-rv-sec">要处理的问题（${errs.length}）</div>${errs.map(row).join('')}` : ''}
        ${base.length ? `${clue ? `<div class="pi-rv-sec">格式（${base.length}）</div>` : ''}${base.map(row).join('')}` : ''}
        ${asks.length ? `<details><summary class="pi-hint">另有 ${asks.length} 项需确认</summary>${asks.map(row).join('')}</details>` : ''}</div>`;
}

function overviewHtml(view, project) {
    const { runtime } = view;
    const units = flattenUnits(project.outline.volumes);
    const live = runtime.activeId() === project.id;
    const states = live ? unitStates(units, runtime.progress()) : {};
    if (!units.length) return `<div class="pi-card"><p class="pi-hint">还没有${vq(project, '卷', '剧情线')}。</p></div>`;
    return project.outline.volumes
        .map(
            (volume) => `<div class="pi-card"><h3>${esc(volumeShowName(volume))}</h3>
        ${
            volume.stages
                .map((stage) => {
                    const names = mainNodeNames(stage.data);
                    return `<button type="button" class="pi-ov-stage${states[stage.id] === 'active' ? ' is-active' : ''}${states[stage.id] === 'done' ? ' is-done' : ''}" data-act="ov-go" data-id="${esc(stage.id)}">
            <span class="pi-ov-title">${esc(stageLabel(stage.key))}</span>
            ${names.map((name) => `<span class="pi-meta pi-ov-node">${esc(name)}</span>`).join('')}</button>`;
                })
                .join('') || '<p class="pi-hint">没有阶段</p>'
        }</div>`,
        )
        .join('');
}

function findSel(project, sel) {
    for (const volume of project.outline.volumes) {
        if (volume.id === sel) return { volume };
        const stage = volume.stages.find((item) => item.id === sel);
        if (stage) return { volume, stage };
    }
    return {};
}

function treeHtml(project, sel) {
    return (
        project.outline.volumes
            .map(
                (
                    volume,
                ) => `<button type="button" class="pi-titem is-vol${volume.id === sel ? ' is-sel' : ''}" data-act="sel" data-id="${esc(volume.id)}"><span class="pi-pname">${esc(volumeShowName(volume))}</span></button>
        ${volume.stages.map((stage) => `<button type="button" class="pi-titem is-stage${stage.id === sel ? ' is-sel' : ''}" data-act="sel" data-id="${esc(stage.id)}"><span class="pi-pname">${esc(stageLabel(stage.key))}</span></button>`).join('')}`,
            )
            .join('') || `<p class="pi-hint">还没有${vq(project, '卷', '剧情线')}。</p>`
    );
}

// threads v0.1.23：支线的钩子玩法、世界动态的进度钟，默认折叠在「玩法」里；空值不写进 YAML。
const PLAY_KEYS = { side: ['条件', '时限', '错过', '步骤'], world: ['进度钟', '前兆', '后果'] };
const PLAY_HINTS = {
    条件: '满足后才激活，如主角到过酒馆',
    时限: '激活后的楼数，或写「本卷」',
    错过: '过期未接时的后果',
    步骤: '每行一步，按顺序推进',
    进度钟: '总格数，如 4、6、8',
    前兆: '过半时透露的风声',
    后果: '发生后写进状态变化',
};
const PLAY_LONG = new Set(['错过', '步骤', '前兆', '后果']);
const PLAY_SHORT = new Set(['进度钟', '时限']);

function playEditor(meta, value, index) {
    const keys = PLAY_KEYS[meta.kind];
    if (!keys) return '';
    const shown = (key) => (key === '步骤' ? hookSteps(value).join('\n') : String(value[key] ?? ''));
    const attrs = (key) =>
        `data-node-field="${esc(meta.field)}" data-i="${index}" data-k="${esc(key)}" data-play placeholder="${esc(PLAY_HINTS[key])}"`;
    const used = keys.some((key) => shown(key).trim());
    return `<details class="pi-play"${used ? ' open' : ''}><summary>玩法</summary>
        ${keys
            .map((key) => {
                const field = `<label class="pi-field"><span>${esc(key)}</span>${
                    PLAY_LONG.has(key)
                        ? `<textarea class="pi-ta" rows="2" ${attrs(key)}>${esc(shown(key))}</textarea>`
                        : `<input class="pi-inp" ${key === '进度钟' ? 'type="number" min="2" max="12" ' : ''}${attrs(key)} value="${esc(shown(key))}">`
                }</label>`;
                return PLAY_SHORT.has(key) ? `<div class="pi-pair">${field}</div>` : field;
            })
            .join('')}</details>`;
}

// 玩法字段：进度钟、数字时限存成数字，步骤存成列表，空值删掉这个键。
function playValue(key, raw) {
    const text = String(raw ?? '').trim();
    if (key === '步骤') {
        const lines = text
            .split('\n')
            .map((line) => line.trim())
            .filter(Boolean);
        return lines.length ? lines : undefined;
    }
    if (!text) return undefined;
    if (key === '进度钟' || (key === '时限' && /^\d+$/.test(text))) return Number(text);
    return text;
}

// 节点的基本字段（第四批，用户 2026-11-16）：名称、地点并排；线索推进时「必需」是名称旁边的小标签，点一下切换必需 / 可选。
// 其余字段照旧；线索推进时事件、偏转、触发收进下面的「更多」（clueNodeFields 里），不常用。
function nodeBasics(meta, index, value, keys, clueOn) {
    let input = (key, ph = '') => `<input class="pi-inp" data-node-field="${esc(meta.field)}" data-i="${index}" data-k="${esc(key)}" value="${esc(value[key] ?? '')}"${ph ? ` placeholder="${esc(ph)}"` : ''}>`,
        area = (key) => `<textarea class="pi-ta pi-ta-auto" rows="2" data-node-field="${esc(meta.field)}" data-i="${index}" data-k="${esc(key)}">${esc(value[key] ?? '')}</textarea>`,
        req = isRequired({ item: value, kind: meta.kind }),
        pill = clueOn && meta.kind !== 'world' ? `<button type="button" class="pi-req${req ? ' is-on' : ''}" data-act="node-req" data-field="${esc(meta.field)}" data-i="${index}" title="点一下切换">${req ? '必需' : '可选'}</button>` : '',
        later = clueOn ? new Set(['事件', '偏转', '触发']) : new Set(),
        pairKeys = keys.includes('名称') && keys.includes('地点') ? ['名称', '地点'] : [],
        rest = keys.filter((k) => !pairKeys.includes(k) && !later.has(k));
    return `${pairKeys.length ? `<div class="pi-pair2"><label class="pi-field"><span class="pi-namehd">名称${pill}</span>${input('名称')}</label><label class="pi-field"><span>地点</span>${input('地点', '可写多个')}</label></div>` : ''}
        ${rest.map((key) => `<label class="pi-field"><span>${esc(key)}</span>${LONG_KEYS.has(key) ? area(key) : input(key)}</label>`).join('')}`;
}

function nodeEditor(stage, meta, clueOn = false) {
    const list = Array.isArray(stage.data[meta.field]) ? stage.data[meta.field] : [],
        items = list
            .map((item, index) => {
                const value = item && typeof item == 'object' ? item : { 内容: String(item ?? '') },
                    play = PLAY_KEYS[meta.kind] || [],
                    keys = [.../* @__PURE__ */ new Set([...NODE_KEYS[meta.kind], ...Object.keys(value)])].filter(
                        (key) => !play.includes(key) && key !== 'id' && !CLUE_TEXT_KEYS.includes(key) && !CLUE_YAML_KEYS.includes(key),
                    );
                return `<div class="pi-node"><div class="pi-node-hd"><span class="pi-badge">${esc(nodeWord(meta, clueOn))} ${index + 1}</span><span class="pi-grow"></span>
            <button type="button" class="pi-icon-btn" data-act="node-menu" data-field="${esc(meta.field)}" data-i="${index}" data-last="${index < list.length - 1 ? '' : '1'}" title="更多">${ICONS.more}</button></div>
            ${nodeBasics(meta, index, value, keys, clueOn)}
            ${playEditor(meta, value, index)}${clueOn ? clueNodeFields(meta, index, value) : ''}</div>`;
            })
            .join('');
    return `<div class="pi-card"><h3>${esc(clueOn ? nodeWord(meta, !0) : meta.field)}<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm" data-act="node-add" data-field="${esc(meta.field)}" data-kind="${meta.kind}">添加</button></h3>
        ${items || '<p class="pi-hint">无</p>'}</div>`;
}

// 节点按 主线 / 支线 / 世界动态 分开看，一次只展开一类，避免一长串。
function nodeTabs(stage, kind, clueOn = false) {
    const count = (meta) => (Array.isArray(stage.data[meta.field]) ? stage.data[meta.field].length : 0);
    return `<div class="pi-seg pi-node-seg">${NODE_FIELDS.map((meta) => `<button type="button" class="pi-seg-btn${meta.kind === kind ? ' is-sel' : ''}" data-act="node-kind" data-kind="${meta.kind}">${esc(nodeWord(meta, clueOn))} ${count(meta)}</button>`).join('')}</div>`;
}

// 阶段的进入 / 结束条件（第四批）：都没写时收起，标题后一句摘要；写了内容的展开
function condBrief(v) {
    if (v == null || v === '') return '';
    let errs = [],
        c = parseCondition(v, errs);
    return errs.length ? String(typeof v === 'string' ? v : JSON.stringify(v)).slice(0, 40) : condWordsShort(c);
}
function condWordsShort(c) {
    let r = conditionRefs(c);
    return [...r.facts].map((f) => `拿到 ${f}`).concat([...r.nodes].map((n) => `${n} 完成`), [...r.lines].map((l) => `${l} 完成`)).slice(0, 3).join('、') || '已写';
}
function stageCondFold(stage) {
    let keys = ['进入条件', '结束条件'],
        has = keys.filter((k) => stage.data[k] != null && stage.data[k] !== ''),
        brief = has.length ? has.map((k) => `${k.slice(0, 2)}：${condBrief(stage.data[k])}`).join('；') : '都没写',
        yamlOf = (k) => (stage.data[k] == null ? '' : typeof stage.data[k] === 'string' ? stage.data[k] : stringifyYaml(stage.data[k]).trim());
    return `<details class="pi-fold"${has.length ? ' open' : ''}><summary><b>进入 / 结束条件</b><span>${esc(brief)}</span></summary>
        ${keys.map((key) => `<label class="pi-field"><span>${key}</span><textarea class="pi-ta is-mono pi-ta-auto" rows="2" data-stage-yaml="${key}">${esc(yamlOf(key))}</textarea></label>`).join('')}<p class="pi-status" data-stage-yaml-status></p></details>`;
}

function stageEditor(volume, stage, raw, kind, clueOn = false) {
    const known = /* @__PURE__ */ new Set([
            '时间范围',
            'AI指令',
            CHANGE_FIELD,
            ...NODE_FIELDS.map((item) => item.field),
            ...CLUE_STAGE_KEYS,
        ]),
        extra = Object.keys(stage.data).filter((key) => !known.has(key)),
        // 第四批（用户 2026-11-16）：大纲编辑边输入边保存，去掉「保存」按钮，标题下一句说明
        head = `<div class="pi-card"><h3>阶段<span class="pi-spacer"></span><button type="button" class="pi-icon-btn" data-act="stage-menu" title="更多">${ICONS.more}</button></h3>
        <p class="pi-hint pi-ol-auto">${raw ? '改完点「应用」。' : '修改自动保存；条件填写后点别处生效。'}</p><p class="pi-hint">所属：${esc(volumeShowName(volume))}</p>`;
    return raw
        ? `${head}<textarea class="pi-ta is-mono is-tall" data-raw>${esc(stageToText(stage))}</textarea>
            <div class="pi-tools is-c1 is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="raw-apply">应用</button></div><p class="pi-status" data-raw-status></p></div>`
        : `${head}<div class="pi-pair2"><label class="pi-field"><span>阶段名</span><input class="pi-inp" data-stage-key value="${esc(stage.key)}" placeholder="阶段N_标题"></label>
        <label class="pi-field"><span>时间范围</span><input class="pi-inp" data-stage-field="时间范围" value="${esc(stage.data.时间范围 ?? '')}" placeholder="可空"></label></div>
        <label class="pi-field"><span>AI指令</span><textarea class="pi-ta pi-ta-auto" rows="2" data-stage-field="AI指令" placeholder="可空">${esc(stage.data.AI指令 ?? '')}</textarea></label>
        <label class="pi-field"><span>状态变化</span><textarea class="pi-ta pi-ta-auto" rows="2" data-stage-list="${CHANGE_FIELD}" placeholder="每行一条，本阶段演完后注入">${esc(
            changeLines(stage.data).join(`
`),
        )}</textarea></label>
        ${clueOn ? stageCondFold(stage) : ''}
${extra.length ? `<p class="pi-hint">另有字段：${esc(extra.join('、'))}（在 YAML 原文里编辑）</p>` : ''}</div>
        ${nodeTabs(stage, kind, clueOn)}${nodeEditor(
            stage,
            NODE_FIELDS.find((meta) => meta.kind === kind),
            clueOn,
        )}`;
}

function volumeEditor(volume, project = null) {
    return `<div class="pi-card"><h3>${vq(project, '卷', '剧情线')}<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm" data-act="review-open" data-id="${esc(volume.id)}">审阅修改</button><button type="button" class="pi-icon-btn" data-act="vol-menu" title="更多">${ICONS.more}</button></h3>
        <div class="pi-tools is-c1"><button type="button" class="pi-btn is-sm" data-act="stage-add">＋新阶段</button></div>
        <label class="pi-field"><span>${vq(project, '卷名（剧情_卷X_标题）', '剧情线名（YAML 里的顶层键，如 剧情_M1_标题）')}</span><input class="pi-inp" data-vol-key value="${esc(volume.key)}"></label>
        <p class="pi-hint">${volume.stages.length} 个阶段</p></div>`;
}

// 一次写多卷的草稿：合成一张卡，每卷一行，只有格式错误的卷展开编辑框；全部解析成功后才能追加。
function multiHtml(view, draft) {
    const busy = view.busy.outline;
    const good = draft.items.filter((item) => item.ok);
    const rows = draft.items
        .map((item, i) => {
            const head = `<div class="pi-vrow"><span class="pi-grow">第 ${draft.volumeNo + i} ${vq(view, '卷', '条')}${item.ok && item.volumes[0] ? ` <b>${esc(volumeName(item.volumes[0].key))}</b>` : ''}</span>
            <span class="pi-meta">${item.ok ? '已解析' : '格式错误'}</span>
            <button type="button" class="pi-icon-btn" data-act="multi-menu" data-i="${i}" title="更多">${ICONS.more}</button></div>`;
            if (item.ok) return `<div class="pi-vitem">${head}</div>`;
            return `<div class="pi-vitem">${head}${errHtml(item.error, item.line)}
            <textarea class="pi-ta is-mono" rows="${Math.min(14, Math.max(6, String(item.yaml).split('\n').length + 1))}" data-draft-yaml>${esc(item.yaml)}</textarea>
            <div class="pi-tools is-c1 is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="multi-fix" data-i="${i}"${busy ? ' disabled' : ''}>让 AI 修正格式</button></div></div>`;
        })
        .join('');
    const ready = good.length === draft.items.length && good.length > 0;
    const partial = draft.items.length < draft.n;
    let clueIssues = [];
    if (isClueMode(view.project())) {
        const current = view.runtime.activeId() === view.projectId ? view.runtime.clue.compute() : null;
        const { known, claimed } = chatFactSets(current);
        clueIssues = checkClueDraft(
            good.flatMap((item) => item.volumes),
            view.project().outline.volumes,
            { isObtained: (id) => known.includes(id), obtainedFacts: known, claimedFacts: claimed },
        );
    }
    return `<div class="pi-card"><h3>AI 写的大纲<span class="pi-meta">${good.length}/${draft.n} ${vq(view, '卷', '条')}</span></h3>
        ${draft.scope ? '<p class="pi-hint">' + esc(draft.scope) + '</p>' : ''}
        ${isClueMode(view.project()) ? '<details><summary>线索结构检查（' + clueIssues.length + '）</summary>' + clueIssues.map((issue) => '<p class="pi-hint is-warn">' + esc(issue) + '</p>').join('') + '</details>' : ''}
        ${rows}
        <div class="pi-tools is-c2 is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="multi-append"${ready && !busy ? '' : ' disabled'}>${partial ? `追加已写完的 ${good.length} ${vq(view, '卷', '条')}` : '追加'}</button>
        <button type="button" class="pi-btn is-sm" data-act="multi-drop"${busy ? ' disabled' : ''}>丢弃</button></div></div>`;
}

function draftHtml(view, draft) {
    if (!draft) return '';
    if (draft.mode === 'multi') return multiHtml(view, draft);
    const title = STAGE_DRAFT[draft.mode] || (draft.mode === 'rewrite' ? '改写后续阶段' : 'AI 写的大纲');
    if (!draft.ok)
        return `<div class="pi-card"><h3>${title}<span class="pi-badge is-danger">格式错误</span></h3>
            ${errHtml(draft.error, draft.line)}
            <textarea class="pi-ta is-mono is-tall" data-draft-yaml>${esc(draft.yaml)}</textarea>
            <div class="pi-tools is-c3 is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="draft-fix"${view.busy.outline ? ' disabled' : ''}>让 AI 修正格式</button>
            <button type="button" class="pi-btn is-sm" data-act="draft-reparse">重新解析</button>
            <button type="button" class="pi-btn is-sm is-danger" data-act="draft-drop">丢弃</button></div></div>`;
    let issues = draft.issues || [],
        conds = draft.tableConds || [],
        summary =
            draft.volumes
                .map(
                    (volume) =>
                        `<p class="pi-hint"><b>${esc(volumeName(volume.key))}</b>：${volume.stages.map((stage) => esc(stageLabel(stage.key))).join('、')}</p>`,
                )
                .join('') +
            (draft.scope ? `<p class="pi-hint">${esc(draft.scope)}</p>` : '') +
            (conds.length
                ? `<p class="pi-hint">读表格的条件：</p>${conds.map((x) => `<p class="pi-hint${x.level === 'ok' ? '' : ' is-warn'}">${esc(x.where)}：${esc(x.raw)}　现在：${esc(x.now || '（读不到）')}${x.level === 'ok' ? ' ✓' : ''}</p>`).join('')}`
                : '') +
            (issues.length
                ? `<p class="pi-hint is-warn">线索结构检查（${issues.length}）：</p>${issues.map((i) => `<p class="pi-hint is-warn">${esc(i)}</p>`).join('')}`
                : draft.clue
                  ? '<p class="pi-hint">线索结构检查：没有发现问题。</p>'
                  : ''),
        single = !!STAGE_DRAFT[draft.mode],
        buttons = single
            ? '<button type="button" class="pi-btn is-primary is-sm" data-act="draft-stage">替换</button>'
            : draft.mode === 'rewrite'
              ? '<button type="button" class="pi-btn is-primary is-sm" data-act="draft-rest">替换剩余阶段</button>'
              : `<button type="button" class="pi-btn is-primary is-sm" data-act="draft-new">${draft.volumes.length > 1 ? `全部追加 ${draft.volumes.length} ${vq(view, '卷', '条')}` : vq(view, '存为新卷', '存为新剧情线')}</button>
           <button type="button" class="pi-btn is-sm" data-act="draft-replace">${vq(view, '替换选中卷', '替换选中的剧情线')}</button>
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
    if (st(view).importing === view.projectId) return renderImport(view);
    const project = view.project(),
        s = st(view);
    syncDraft(view, s);
    const { volume, stage } = findSel(project, s.sel),
        busy = view.busy.outline,
        kind = NODE_FIELDS.some((meta) => meta.kind === s.nodeKind) ? s.nodeKind : NODE_FIELDS[0].kind,
        editor = stage
            ? stageEditor(volume, stage, s.raw, kind, isClueMode(project))
            : volume
              ? volumeEditor(volume, project)
              : `<div class="pi-card"><p class="pi-hint">从左边选${vq(project, '一卷', '一条剧情线')}或一个阶段编辑。</p></div>`;
    // 顶部（第三批，用户 2026-11-16 选 A）：「AI 写新剧情线」占一行；下面审阅修改、导入长文、检查三个等宽；总览、历史收进「⋯」；参考移进 AI 写的弹框
    const writing = s.multi && s.multi.projectId === view.projectId,
        hasVols = project.outline.volumes.length > 0,
        dirtyN = hasVols ? editDraftCount(view, project) : 0,
        errN = hasVols ? checkErrorCount(view, project) : 0;
    return `<div class="pi-card"><h3>大纲<span class="pi-spacer"></span><button type="button" class="pi-icon-btn" data-act="outline-menu" title="更多">${ICONS.more}</button></h3>
        ${writing ? `<button type="button" class="pi-btn is-primary pi-ol-write" data-act="multi-stop"><span class="pi-spin"></span>写作中 ${s.multi.k}/${s.multi.n}，点击停止</button>` : `<button type="button" class="pi-btn is-primary pi-ol-write" data-act="ai-volume"${busy ? ' disabled' : ''}>${busy ? '<span class="pi-spin"></span>写作中' : vq(project, `AI 写第 ${project.outline.volumes.length + 1} 卷`, 'AI 写新剧情线')}</button>`}
        <div class="pi-ol-tools"><button type="button" class="pi-btn is-sm" data-act="review-open"${hasVols ? '' : ' disabled'} title="逐页查看各条线，在对应页写意见后一次发给 AI，确认后保存到大纲">审阅修改${dirtyN ? `<span class="pi-badge is-warn">${dirtyN}</span>` : ''}</button>
            <button type="button" class="pi-btn is-sm" data-act="import-open-panel">导入长文</button>
            <button type="button" class="pi-btn is-sm${s.check ? ' is-primary' : ''}" data-act="check-toggle">检查${errN ? `<span class="pi-badge is-warn">${errN}</span>` : ''}</button></div>
        </div>
        ${draftHtml(view, s.draft)}
        ${s.check ? checkHtml(view, project) : ''}
        ${s.history ? historyHtml(project, s.historyAt) : ''}
        ${
            s.overview
                ? overviewHtml(view, project)
                : `<div class="pi-tree"><div class="pi-tree-list">${treeHtml(project, s.sel)}
            <button type="button" class="pi-btn is-sm is-ghost is-block" data-act="vol-add">${vq(project, '＋新卷', '＋新剧情线')}</button></div>
            <div>${editor}</div></div>`
        }`;
}

// 进度按「阶段id:前缀+序号」记节点；当前聊天在用这个项目时，节点挪动或删除后同步重排已取消勾选的节点与钟、钩子。
function liveProgress(view) {
    return view.runtime.activeId() === view.projectId ? view.runtime.progress() : null;
}

// progress 为改大纲之前取的进度：改完再取时已按名称归位过，再按位置重排会排反。
function remapProgress(view, progress, stageId, field, mapIndex) {
    const meta = NODE_FIELDS.find((item) => item.field === field);
    if (!meta || !progress) return;
    const next = remapNodes(progress, stageId, meta.prefix, mapIndex);
    if (next !== progress) view.runtime.setProgress(next);
}

const swapIndex = (a, b) => (i) => (i === a ? b : i === b ? a : i);

// label 非空时，改动前的大纲先入历史版本。
// alias：改动附带写进对照表的阶段 id 别名（[[旧id, 新id]]，见 core/align.js），其他聊天读进度时按它对回。
function update(view, fn, label = '', { alias = [] } = {}) {
    return view.data.updateProject(view.projectId, (project) => ({
        ...project,
        outline: withAliases(
            {
                ...project.outline,
                volumes: fn(project.outline.volumes),
                ...(label ? { history: pushOutlineHistory(project.outline.history, project.outline.volumes, label) } : {}),
            },
            alias,
        ),
    }));
}

function updateStage(view, stageId, fn, label = '') {
    update(
        view,
        (volumes) =>
            volumes.map((volume) =>
                volume.stages.some((stage) => stage.id === stageId)
                    ? { ...volume, stages: volume.stages.map((stage) => (stage.id === stageId ? fn(stage) : stage)) }
                    : volume,
            ),
        label,
    );
}

function updateVolume(view, volumeId, fn, label = '') {
    update(view, (volumes) => volumes.map((volume) => (volume.id === volumeId ? fn(volume) : volume)), label);
}

function moveUp(list, index) {
    if (index <= 0) return list;
    const out = [...list];
    [out[index - 1], out[index]] = [out[index], out[index - 1]];
    return out;
}

function addVolumes(view, incoming, label = '导入') {
    let project = view.project(),
        existing = new Set(project.outline.volumes.map((volume) => volume.key)),
        [reid, renamed] = reidConflicts(incoming, project.outline.volumes),
        fresh = reid.map((volume) =>
            existing.has(volume.key) ? { ...volume, key: `${volume.key}_导入${Date.now().toString(36).slice(-3)}` } : volume,
        );
    return (
        renamed.length &&
            toast(
                'warning',
                `导入内容有 ${renamed.length} 个节点 ID 与现有节点重复，已换成新 ID：${renamed.slice(0, 5).join('、')}${renamed.length > 5 ? '……' : ''}。引用这些 ID 的条件需要检查。`,
            ),
        update(view, (volumes) => [...volumes, ...fresh], label),
        (st(view).sel = fresh[0] && fresh[0].id),
        view.runtime.refresh(),
        fresh
    );
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
    if (added.length) toast('success', `已导入 ${added.length} ${vq(view, '卷', '条剧情线')}。`);
    view.renderBody();
    if (failed.length) {
        await openDialog({
            title: '导入失败',
            html: failed.map((item) => `<p class="pi-hint"><b>${esc(item.name)}</b></p>${errHtml(item.error)}`).join(''),
            actions: [{ label: '关闭', value: true, primary: true }],
        });
    }
}

// all：多卷相关的入口（讨论页送来的 YAML、多卷写作）合并所有 yaml 代码块，其余只取第一个块。
function setDraft(view, mode, reply, extra = {}, { all = !1 } = {}) {
    const task = extra.task || taskContext(view);
    if (!taskStillValid(view, task)) return staleTaskNotice(view, task);
    const project = view.project(),
        draft = { mode, ...parseOutlineReply(reply, void 0, { all }), projectId: view.projectId, ...extra, task };
    if (draft.ok && isClueMode(project)) {
        const units = flattenUnits(project.outline.volumes);
        let replaced = [],
            applied = [...project.outline.volumes, ...draft.volumes];
        if (mode === 'rewrite' && draft.fromUnitId) {
            const from = units.findIndex((u) => u.id === draft.fromUnitId);
            from >= 0 &&
                ((replaced = units.slice(from)), (applied = replaceRest(project.outline.volumes, draft.fromUnitId, draft.volumes)));
        } else if (STAGE_DRAFT[mode]) {
            const ids = new Set([draft.stageId, draft.nextId].filter(Boolean));
            ((replaced = units.filter((u) => ids.has(u.id))),
                replaced.length &&
                    (applied = replaceStages(
                        project.outline.volumes,
                        replaced[0].volume.id,
                        [...ids],
                        draft.volumes.flatMap((v) => v.stages),
                    ).volumes));
        }
        const replacedIds = new Set(replaced.map((u) => u.id)),
            base = project.outline.volumes.map((v) => ({ ...v, stages: v.stages.filter((s) => !replacedIds.has(s.id)) })),
            keepIds = compileClue(replaced.map((u) => ({ ...u.volume, stages: [u.stage] })))
                .nodes.map((n) => n.uid)
                .filter(Boolean),
            current = view.runtime.activeId() === view.projectId ? view.runtime.clue.compute() : null,
            { known: obtained, claimed } = chatFactSets(current),
            tables = currentTables();
        if (
            ((draft.clue = !0),
            (draft.issues = checkClueDraft(draft.volumes, base, {
                keepIds,
                isObtained: (id) => obtained.includes(id),
                obtainedFacts: obtained,
                claimedFacts: claimed,
                applied,
                tables,
            })),
            (draft.tableConds = tables ? tableCondReport(draft.volumes, tables) : []),
            current && replaced.length)
        ) {
            const guard = historyGuard(project.outline.volumes, applied, current.snap, current.prog, project.clue, {
                scope: new Set(keepIds),
            });
            draft.issues.unshift(...guard.diffs, ...guard.notes);
        }
    }
    (putDraft(view, task.projectId, draft), view.renderBody());
}

export function showDraft(view, reply) {
    setDraft(view, 'volume', reply, {}, { all: true });
}

// 执行页偏转时调用：带着最近正文改写当前及之后的阶段。
export async function startRewrite(view) {
    const project = view.project(),
        units = flattenUnits(project.outline.volumes);
    if (!units.length) return;
    let clueCur = isClueMode(project) && view.runtime.activeId() === view.projectId ? view.runtime.clue.compute() : null,
        clueFrom = clueCur
            ? units.findIndex((u) =>
                  clueCur.state.current ? u.id === clueCur.state.current.id : !clueCur.state.stageStates.get(u.id).done,
              )
            : -1;
    if (isClueMode(project) && clueCur && clueFrom < 0)
        return (toast('info', '所有阶段都已结束，没有剩余阶段可以改写。要继续剧情，请用大纲页的「AI 写新剧情线」另起一条。'), void 0);
    let task = taskContext(view),
        from = isClueMode(project) ? Math.max(0, clueFrom) : Math.max(0, currentIndex(units, view.runtime.progress())),
        reason = await promptDialog({ title: '让 AI 改写后续阶段', label: '偏转说明（可空）：剧情哪里和大纲不一样了', multiline: !0 });
    if (reason == null) return;
    if (!taskStillValid(view, task)) return staleTaskNotice(view, task);
    view.go('outline');
    let material = isClueMode(project) ? await generationMaterial(view, { task: 'rewrite' }) : null,
        recent = material
            ? material.recent
            : view.runtime.recentFloors(6).map((floor) => floor.text).join(`

`);
    if (!taskStillValid(view, task)) return staleTaskNotice(view, task);
    let reply2 = await runTask(view, 'outline', () =>
        ask(
            view,
            'outline',
            material
                ? clueRewriteMessages({
                      setting: project.setting.text,
                      volumes: project.outline.volumes,
                      fromUnitIndex: from,
                      units,
                      recent,
                      reason,
                      progress: material.progress,
                      refs: material.refs,
                      talk: material.talk,
                  })
                : rewriteRestMessages({
                      setting: project.setting.text,
                      volumes: project.outline.volumes,
                      fromUnitIndex: from,
                      units,
                      recent,
                      reason,
                  }),
        ),
    );
    reply2 && setDraft(view, 'rewrite', reply2, { fromUnitId: units[from].id, scope: material ? material.scope : '', task });
}

function applyRest(view, draft, guard = rewriteGuardNow(view, draft)) {
    let project = view.project(),
        unit = flattenUnits(project.outline.volumes).find((item) => item.id === draft.fromUnitId);
    if (!unit) throw new Error(`原来的阶段已不存在，改用「${vq(view, '存为新卷', '存为新剧情线')}」。`);
    let incoming = draft.volumes;
    guard &&
        (guard.keepDone.size || guard.reinsert.size) &&
        ((incoming = restoreHistory(incoming, guard)),
        toast(
            'info',
            `已保留已经完成的节点：${[...guard.keepDone.keys(), ...guard.reinsert.keys()].join('、')}（完成条件不变，节点里的其他改动照常应用）`,
        ));
    let volumes = replaceRest(project.outline.volumes, unit.stage.id, incoming);
    if ((update(view, () => volumes, '改写后续阶段'), isClueMode(project))) return (view.runtime.clue.invalidate(), void 0);
    let first = draft.volumes[0] && draft.volumes[0].stages[0];
    const from = first ? flattenUnits(volumes).findIndex((item) => item.id === first.id) : 0;
    first &&
        view.runtime.activeId() === view.projectId &&
        view.runtime.setProgress(goTo(view.runtime.progress(), flattenUnits(volumes), first.id));
    return from;
}

// 「AI 写第 N 卷」弹窗：卷数 1 到 5 + 整体要求；写作按卷顺序逐卷请求。
const MAX_VOLUMES = 5;

async function writeDialog(view) {
    const picked = await openDialog({
        title: vq(view, 'AI 写新卷', 'AI 写新剧情线'),
        html: `<label class="pi-field"><span>${vq(view, '卷数', '写几条')}</span><select class="pi-sel" data-wv-n>${options(
            Array.from({ length: MAX_VOLUMES }, (_, i) => ({ value: i + 1, label: `${i + 1} ${vq(view, '卷', '条')}` })),
            1,
        )}</select></label>
            <label class="pi-field"><span>整体要求（可空）</span><textarea class="pi-ta" rows="4" data-wv-request>${esc(st(view).request || '')}</textarea></label>
            <div class="pi-field"><span>参考</span>${genRefsBar(view, 'outline', () => {}, { label: !1 })}</div>`,
        onMount: (root) => {
            // 参考按钮在弹框里点：改了以后只重画这一块（不关弹框）
            root.addEventListener('click', async (e) => {
                let b = e.target.closest('[data-act="gen-talk"],[data-act="gen-wb"]');
                if (!b) return;
                e.stopPropagation();
                await genActions[b.dataset.act](view);
                // 世界书条数是异步算的：算好后再画一次这一块
                let redraw = () => {
                    let bar = root.isConnected && root.querySelector('.pi-refs');
                    bar && (bar.outerHTML = genRefsBar(view, 'outline', redraw, { label: !1 }));
                };
                redraw();
            }, true);
        },
        actions: [
            { label: '取消', value: null },
            {
                label: '开始写作',
                primary: true,
                value: (root) => ({
                    n: Number(root.querySelector('[data-wv-n]').value) || 1,
                    request: root.querySelector('[data-wv-request]').value.trim(),
                }),
            },
        ],
    });
    if (picked) st(view).request = picked.request;
    return picked;
}

// 从讨论页进入时自动勾上讨论记录参考。
function setTalkRef(view) {
    view.data.updateProject(view.projectId, (project) => ({ ...project, genRefs: { ...normalizeGenRefs(project.genRefs), talk: true } }));
}

// 第 k 卷的请求：volumes 带已有卷和本轮前面已写好的卷。
function volumeRequest({ project, talk, wb, material, extra = [], no, k, n, request, tableCatalog }) {
    const volumes = [...project.outline.volumes, ...extra];
    return outlineMessages({
        setting: project.setting.text,
        talk,
        refs: wb,
        volumes,
        volumeNo: no,
        request: n > 1 ? `共写 ${n} ${vq(project, '卷', '条剧情线')}，这是第 ${k} ${vq(project, '卷', '条')}。${request || ''}` : request,
        mode: isClueMode(project) ? 'clue' : 'outline',
        clueIndex: isClueMode(project) ? clueIndexText(volumes) : '',
        progress: material?.progress || '',
        recent: material?.recent || '',
        tableCatalog: tableCatalog ?? (isClueMode(project) ? tableCatalogText(currentTables()) : ''),
    });
}

function setMultiItem(view, index, parsed) {
    const draft = st(view).draft;
    if (!draft || draft.mode !== 'multi') return;
    draft.items = draft.items.map((item, i) => (i === index ? parsed : item));
    view.renderBody();
}

// onConfirmed：写卷弹窗与覆盖草稿的确认都通过、开始写作前调用。
async function writeVolumes(view, n, request, onConfirmed = null) {
    const task = taskContext(view),
        id = view.projectId;
    const pending = st(view).draft && st(view).draft.projectId === id ? st(view).draft : parkedDrafts.get(id);
    if (
        pending &&
        !(await confirmDialog({
            title: '覆盖草稿',
            body: '草稿区还有未处理的 AI 结果，开始写作后会被新草稿替换。',
            okLabel: '开始写作',
            danger: true,
        }))
    )
        return;
    if (!taskStillValid(view, task)) return staleTaskNotice(view, task);
    // 讨论记录参考开关在确认之后才打开，参考文字随后按新开关取。
    if (onConfirmed) onConfirmed();
    const project = view.project();
    const material = await generationMaterial(view);
    if (!taskStillValid(view, task)) return staleTaskNotice(view, task);
    const { talk, refs: wb } = material;
    if (!project.setting.text.trim() && !talk.trim() && !wb.length)
        throw new Error('没有可参考的内容：在讨论页聊一聊，或点「世界书」选择条目。');
    const base = project.outline.volumes.length + 1;
    if (n <= 1) {
        const reply = await runTask(view, 'outline', () =>
            ask(view, 'outline', volumeRequest({ project, talk, wb, material, no: base, k: 1, n: 1, request })),
        );
        if (reply) setDraft(view, 'volume', reply, { task, scope: material.scope });
        return;
    }
    const controller = new AbortController();
    const draft = {
        mode: 'multi',
        items: [],
        n,
        volumeNo: base,
        request,
        projectId: project.id,
        task,
        scope: material.scope,
        clue: isClueMode(project),
    };
    st(view).draft = draft;
    st(view).multi = { k: 1, n, controller, projectId: project.id };
    try {
        await runTask(view, 'outline', async () => {
            for (let k = 1; k <= n; k += 1) {
                if (isClueMode(project) && !taskStillValid(view, task)) {
                    staleTaskNotice(view, task);
                    break;
                }
                st(view).multi.k = k;
                view.renderBody();
                let reply;
                try {
                    reply = await ask(
                        view,
                        'outline',
                        volumeRequest({
                            project,
                            talk,
                            wb,
                            material,
                            extra: draft.items.flatMap((item) => item.volumes || []),
                            no: base + k - 1,
                            k,
                            n,
                            request,
                        }),
                        { signal: controller.signal },
                    );
                } catch (error) {
                    if (!controller.signal.aborted)
                        toast('error', `第 ${k} ${vq(view, '卷', '条')}写作失败：${error.message}。已写好的 ${draft.items.length} ${vq(view, '卷', '条')}保留在草稿里。`);
                    break;
                }
                if (controller.signal.aborted) break;
                if (isClueMode(project) && !taskStillValid(view, task)) {
                    staleTaskNotice(view, task);
                    break;
                }
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
    ...importActions,
    // 审阅修改（第二批，用户 2026-11-16）：大纲页顶部「审阅修改…」打开所有线（从选中的线或第一条开始）；选中一条线时的按钮直接打开这一条
    async 'review-open'(view, target) {
        const project = view.project();
        if (!project.outline.volumes.length) return toast('info', '大纲里还没有内容。');
        const pick = (target && target.dataset.id) || findSel(project, st(view).sel).volume?.id || project.outline.volumes[0].id,
            jobId = await openEditReview(view, pick, {}, { note: isClueMode(project) ? '剧情线' : '卷' });
        (showEditReview(view, jobId), view.renderBody());
    },
    // 节点「必需 / 可选」小标签（第四批）：点一下切换。主线节点默认必需，可选写 必需: false；支线事件默认可选
    'node-req'(view, target) {
        const { stage } = findSel(view.project(), st(view).sel);
        if (!stage) return;
        const field = target.dataset.field,
            index = Number(target.dataset.i);
        (updateStage(view, stage.id, (item) => {
            const list = [...(item.data[field] || [])],
                node = list[index] && typeof list[index] == 'object' ? { ...list[index] } : null;
            if (!node) return item;
            const kind = field === '主线节点' ? 'main' : 'side',
                req = isRequired({ item: node, kind });
            // 切到和默认一样时去掉这个键（主线默认必需、支线默认可选），否则写明
            req === (kind !== 'main') ? delete node.必需 : (node.必需 = !req);
            list[index] = node;
            return { ...item, data: { ...item.data, [field]: list } };
        }),
            view.runtime.refresh(),
            view.renderBody());
    },
    'node-kind'(view, target) {
        ((st(view).nodeKind = target.dataset.kind), view.renderBody());
    },
    sel(view, target) {
        ((st(view).sel = target.dataset.id), (st(view).raw = !1), view.renderBody());
    },
    'vol-add'(view) {
        const project = view.project(),
            volume = {
                id: makeId('v'),
                key: `剧情_卷${project.outline.volumes.length + 1}_新卷`,
                stages: [{ id: makeId('s'), key: '阶段一_新阶段', data: { 时间范围: '', AI指令: '', 主线节点: [] } }],
            };
        (update(view, (volumes) => [...volumes, volume]), (st(view).sel = volume.id), view.renderBody());
    },
    'vol-up'(view) {
        (update(view, (volumes) =>
            moveUp(
                volumes,
                volumes.findIndex((volume) => volume.id === st(view).sel),
            ),
        ),
            view.runtime.refresh(),
            view.renderBody());
    },
    'vol-down'(view) {
        (update(view, (volumes) =>
            moveItem(
                volumes,
                volumes.findIndex((volume) => volume.id === st(view).sel),
                1,
            ),
        ),
            view.runtime.refresh(),
            view.renderBody());
    },
    async 'vol-menu'(view) {
        const pick = await menuDialog({
            title: vq(view, '卷', '剧情线'),
            items: [
                { label: '上移', value: 'vol-up' },
                { label: '下移', value: 'vol-down' },
                { label: vq(view, '导出本卷', '导出这条剧情线'), value: 'vol-export' },
                { label: vq(view, '删除卷', '删除这条剧情线'), value: 'vol-del', danger: !0 },
            ],
        });
        pick && (await actions[pick](view));
    },
    'vol-export'(view) {
        const { volume } = findSel(view.project(), st(view).sel);
        volume && downloadBlob(`${volume.key}.yaml`, volumeToText(volume), 'text/yaml');
    },
    async 'vol-del'(view) {
        const { volume } = findSel(view.project(), st(view).sel);
        !volume ||
            !(await confirmDialog({
                title: `删除「${volumeName(volume.key)}」`,
                body: `连同 ${volume.stages.length} 个阶段一起删除，不能撤销。想留一份的话先点「导出」。`,
                okLabel: '删除',
                danger: !0,
            })) ||
            (update(view, (volumes) => volumes.filter((item) => item.id !== volume.id), '删除卷'),
            (st(view).sel = ''),
            view.runtime.refresh(),
            view.renderBody());
    },
    'stage-add'(view) {
        const { volume } = findSel(view.project(), st(view).sel);
        if (!volume) return;
        const stage = { id: makeId('s'), key: `阶段${volume.stages.length + 1}_新阶段`, data: { 时间范围: '', AI指令: '', 主线节点: [] } };
        (updateVolume(view, volume.id, (item) => ({ ...item, stages: [...item.stages, stage] })),
            (st(view).sel = stage.id),
            view.renderBody());
    },
    'stage-up'(view) {
        const { volume, stage } = findSel(view.project(), st(view).sel);
        stage &&
            (updateVolume(view, volume.id, (item) => ({ ...item, stages: moveUp(item.stages, item.stages.indexOf(stage)) })),
            view.runtime.refresh(),
            view.renderBody());
    },
    'stage-down'(view) {
        const { volume, stage } = findSel(view.project(), st(view).sel);
        stage &&
            (updateVolume(view, volume.id, (item) => ({
                ...item,
                stages: moveItem(
                    item.stages,
                    item.stages.findIndex((entry) => entry.id === stage.id),
                    1,
                ),
            })),
            view.runtime.refresh(),
            view.renderBody());
    },
    async 'stage-menu'(view) {
        const { volume, stage } = findSel(view.project(), st(view).sel);
        if (!stage) return;
        const last = volume.stages[volume.stages.length - 1] === stage,
            pick = await menuDialog({
                title: stageLabel(stage.key),
                items: [
                    { label: '细化节点', value: 'stage-refine' },
                    { label: '拆成两段', value: 'stage-split' },
                    ...(last ? [] : [{ label: '与下一段合并', value: 'stage-merge' }]),
                    { label: '上移', value: 'stage-up' },
                    { label: '下移', value: 'stage-down' },
                    { label: '移到…', value: 'stage-move' },
                    { label: st(view).raw ? '表单编辑' : 'YAML 原文', value: 'raw' },
                    { label: '删除阶段', value: 'stage-del', danger: !0 },
                ],
            });
        pick && (STAGE_DRAFT[pick] ? await stageOp(view, pick.slice(6)) : await actions[pick](view));
    },
    async 'stage-move'(view) {
        const { volume, stage } = findSel(view.project(), st(view).sel),
            others = view.project().outline.volumes.filter((item) => item.id !== volume.id);
        if (!stage || !others.length) return toast('info', vq(view, '没有其他卷可移动。', '没有别的剧情线可以移过去。'));
        const to = await menuDialog({ title: '移到…', items: others.map((item) => ({ label: volumeName(item.key), value: item.id })) });
        to && (update(view, (volumes) => moveStageToVolume(volumes, stage.id, to)), view.runtime.refresh(), view.renderBody());
    },
    async 'stage-del'(view) {
        const { volume, stage } = findSel(view.project(), st(view).sel);
        !stage ||
            !(await confirmDialog({
                title: `删除「${stageLabel(stage.key)}」`,
                body: `连同里面的 ${stageNodes(stage.data).length} 个场景一起删除，删除前会保存到大纲历史。`,
                okLabel: '删除',
                danger: !0,
            })) ||
            (updateVolume(
                view,
                volume.id,
                (item) => ({ ...item, stages: item.stages.filter((entry) => entry.id !== stage.id) }),
                '删除阶段',
            ),
            (st(view).sel = volume.id),
            view.runtime.refresh(),
            view.renderBody());
    },
    raw(view) {
        ((st(view).raw = !st(view).raw), view.renderBody());
    },
    // 手动保存：把编辑框里的内容再写一遍、立即落盘，并刷新注入内容（不用等失焦）。
    'raw-apply'(view, target) {
        const { stage } = findSel(view.project(), st(view).sel),
            box = target.closest('.pi-card'),
            status = box.querySelector('[data-raw-status]');
        try {
            const parsed = parseOutlineText(box.querySelector('[data-raw]').value),
                next = parsed[0] && parsed[0].stages[0];
            if (!next || parsed.length > 1 || parsed[0].stages.length > 1) throw new Error('原文里只能有一个阶段');
            (updateStage(view, stage.id, (item) => ({ ...item, key: next.key, data: next.data }), 'YAML 原文应用'),
                view.runtime.refresh(),
                (st(view).raw = !1),
                view.renderBody());
        } catch (error) {
            ((status.innerHTML = errHtml(error, 0, 'span')), status.classList.add('is-err'));
        }
    },
    'node-add'(view, target) {
        const { stage } = findSel(view.project(), st(view).sel),
            field = target.dataset.field;
        (updateStage(view, stage.id, (item) => ({
            ...item,
            data: {
                ...item.data,
                [field]: [...(Array.isArray(item.data[field]) ? item.data[field] : []), { ...NEW_NODE[target.dataset.kind] }],
            },
        })),
            view.renderBody());
    },
    'node-up'(view, target) {
        const { stage } = findSel(view.project(), st(view).sel),
            field = target.dataset.field,
            index = Number(target.dataset.i);
        if (index <= 0) return;
        const before = liveProgress(view);
        (updateStage(view, stage.id, (item) => ({ ...item, data: { ...item.data, [field]: moveUp(item.data[field], index) } })),
            remapProgress(view, before, stage.id, field, swapIndex(index - 1, index)),
            view.runtime.refresh(),
            view.renderBody());
    },
    'node-down'(view, target) {
        const { stage } = findSel(view.project(), st(view).sel),
            field = target.dataset.field,
            index = Number(target.dataset.i);
        if (index >= (stage.data[field] || []).length - 1) return;
        const before = liveProgress(view);
        (updateStage(view, stage.id, (item) => ({ ...item, data: { ...item.data, [field]: moveItem(item.data[field], index, 1) } })),
            remapProgress(view, before, stage.id, field, swapIndex(index, index + 1)),
            view.runtime.refresh(),
            view.renderBody());
    },
    async 'node-menu'(view, target) {
        const index = Number(target.dataset.i),
            pick = await menuDialog({
                title: `${target.dataset.field} ${index + 1}`,
                items: [
                    { label: '上移', value: 'node-up', disabled: index <= 0 },
                    { label: '下移', value: 'node-down', disabled: !!target.dataset.last },
                    { label: '删除', value: 'node-del', danger: !0 },
                ],
            });
        pick && (await actions[pick](view, target));
    },
    async 'node-del'(view, target) {
        const { stage } = findSel(view.project(), st(view).sel),
            field = target.dataset.field,
            index = Number(target.dataset.i),
            node = stage.data[field][index];
        if (
            !(await confirmDialog({
                title: `删除「${(node && (node.名称 || node.类型)) || '节点'}」`,
                body: '删除场景后会重新对齐进度。',
                okLabel: '删除',
                danger: !0,
            }))
        )
            return;
        const before = liveProgress(view);
        (updateStage(view, stage.id, (item) => {
            const list = item.data[field].filter((_, i) => i !== index),
                data = { ...item.data, [field]: list };
            return (!list.length && field !== '主线节点' && delete data[field], { ...item, data });
        }),
            remapProgress(view, before, stage.id, field, (i) => (i === index ? null : i > index ? i - 1 : i)),
            view.runtime.refresh(),
            view.renderBody());
    },
    async 'outline-menu'(view) {
        const pick = await menuDialog({
            title: '大纲',
            items: [
                { label: st(view).overview ? '收起总览' : '总览', value: 'overview-toggle' },
                { label: `${st(view).history ? '收起历史' : '历史'}（${view.project().outline.history.length}）`, value: 'history' },
                { label: '导入 YAML', value: 'import-file' },
                { label: '粘贴 YAML', value: 'import-paste' },
                { label: '从世界书导入', value: 'import-wb' },
                { label: '导出', value: 'export', disabled: !view.project().outline.volumes.length },
            ],
        });
        pick && (await actions[pick](view));
    },
    async 'import-file'(view) {
        const files = await pickFiles({ accept: '.yaml,.yml,.txt', multiple: !0 });
        files.length &&
            (await importTexts(
                view,
                await Promise.all(
                    files
                        .sort((a, b) => a.name.localeCompare(b.name, 'zh'))
                        .map(async (file) => ({ name: file.name, text: await file.text() })),
                ),
            ));
    },
    async 'import-paste'(view) {
        const text = await promptDialog({
            title: '粘贴剧情 YAML',
            multiline: !0,
            placeholder: `剧情_卷一_标题:
  阶段一_标题:
    时间范围: …`,
        });
        text && (await importTexts(view, [{ name: '粘贴内容', text }]));
    },
    async 'import-wb'(view) {
        const picked = await pickWorldbookEntries('从世界书导入大纲或设定');
        if (!picked.length) return;
        let projectId = view.projectId,
            { outline, setting } = classifyEntries(picked),
            chosen = await settingPiecesFromEntries(setting);
        if (chosen === null || view.projectId !== projectId) return;
        let authorCount = chosen.authorCount;
        (outline.length &&
            addVolumes(
                view,
                outline.flatMap((item) => item.volumes),
            ),
            chosen.pieces.length &&
                view.data.updateProject(projectId, (project) => {
                    let text = [project.setting.text, ...chosen.pieces].filter(Boolean).join(`

`);
                    return { ...project, setting: { ...project.setting, text } };
                }),
            toast(
                'success',
                `${outline.length} 条进大纲，${setting.length - authorCount} 条进公开设定，${authorCount} 条作为仅作者资料（不注入）。`,
            ),
            view.runtime.refresh(),
            view.renderBody(),
            await afterImport(picked, { authorCount }));
    },
    async export(view) {
        const project = view.project(),
            choice = await choiceDialog({
                title: '导出大纲',
                choices: [
                    { label: '取消', value: null },
                    { label: vq(project, '每卷一个文件', '每条剧情线一个文件'), value: 'each' },
                    { label: '合成一个文件', value: 'one', primary: !0 },
                ],
            });
        (choice === 'one' && downloadBlob(`${project.name}-大纲.yaml`, outlineToText(project.outline.volumes), 'text/yaml'),
            choice === 'each' &&
                project.outline.volumes.forEach((volume, i) =>
                    downloadBlob(`${String(i + 1).padStart(2, '0')}-${volume.key}.yaml`, volumeToText(volume), 'text/yaml'),
                ));
    },
    async 'ai-volume'(view, target, { withTalk = !1 } = {}) {
        if (view.busy.outline) return;
        const picked = await writeDialog(view);
        picked && (await writeVolumes(view, picked.n, picked.request, withTalk ? () => setTalkRef(view) : null));
    },
    'multi-stop'(view) {
        const multi = st(view).multi;
        multi && multi.controller.abort();
    },
    async 'multi-fix'(view, target) {
        const draft = st(view).draft,
            i = Number(target.dataset.i),
            box = target.closest('.pi-vitem')?.querySelector('[data-draft-yaml]'),
            text = box ? box.value : draft.items[i].yaml,
            reply = await runTask(view, 'outline', () =>
                ask(view, 'outline', fixYamlMessages(text, draft.items[i].error, isClueMode(view.project()) ? 'clue' : 'outline')),
            );
        reply && setMultiItem(view, i, parseOutlineReply(reply, void 0, { all: !0 }));
    },
    async 'multi-menu'(view, target) {
        const draft = st(view).draft,
            i = Number(target.dataset.i),
            item = draft && draft.items[i];
        if (!item) return;
        const busy = view.busy.outline,
            pick = await menuDialog({
                title: `第 ${draft.volumeNo + i} ${vq(view, '卷', '条')}`,
                items: [
                    ...(item.ok ? [{ label: 'YAML 原文', value: 'multi-yaml' }] : []),
                    { label: vq(view, '重写这一卷', '重写这一条'), value: 'multi-redo', disabled: busy },
                    ...(item.ok
                        ? []
                        : [
                              { label: '修正格式', value: 'multi-fix', disabled: busy },
                              { label: '重新解析', value: 'multi-reparse' },
                          ]),
                ],
            });
        pick && (await actions[pick](view, target));
    },
    async 'multi-yaml'(view, target) {
        const item = st(view).draft.items[Number(target.dataset.i)];
        await openDialog({
            title: 'YAML 原文',
            html: `<pre class="pi-pre">${esc(item.yaml)}</pre>`,
            actions: [{ label: '关闭', value: !0, primary: !0 }],
        });
    },
    async 'multi-drop'(view) {
        (await confirmDialog({ title: '丢弃草稿', body: vq(view, '已写好的卷不会保存。', '已写好的剧情线不会保存。'), okLabel: '丢弃', danger: !0 })) &&
            ((st(view).draft = null), view.renderBody());
    },
    'multi-reparse'(view, target) {
        const i = Number(target.dataset.i),
            yaml = target.closest('.pi-vitem').querySelector('[data-draft-yaml]').value;
        setMultiItem(
            view,
            i,
            parseOutlineReply(`\`\`\`yaml
${yaml}
\`\`\``),
        );
    },
    async 'multi-redo'(view, target) {
        const draft = st(view).draft,
            i = Number(target.dataset.i),
            project = view.project(),
            material = await generationMaterial(view),
            { talk, refs: wb } = material,
            before = draft.items.filter((item, index) => index !== i && item.ok).flatMap((item) => item.volumes),
            reply = await runTask(view, 'outline', () =>
                ask(
                    view,
                    'outline',
                    volumeRequest({
                        project,
                        talk,
                        wb,
                        material,
                        extra: before,
                        no: draft.volumeNo + i,
                        k: i + 1,
                        n: draft.n,
                        request: draft.request,
                        tableCatalog: isClueMode(project) ? tableCatalogText(currentTables()) : '',
                    }),
                ),
            );
        reply && setMultiItem(view, i, parseOutlineReply(reply, void 0, { all: !0 }));
    },
    'multi-append'(view) {
        const draft = st(view).draft;
        if (!draft || draft.items.some((item) => !item.ok)) return;
        if (!taskStillValid(view, draft.task)) return staleTaskNotice(view, draft.task);
        const volumes = draft.items.flatMap((item) => item.volumes);
        (addVolumes(view, volumes, 'AI 追加多卷'), (st(view).draft = null), view.renderBody());
    },
    // 修格式 / 重新解析沿用草稿原来的身份（15.2-1）：先核对、修正请求返回后再核对，不会把草稿改绑到当前聊天。
    async 'draft-fix'(view, target) {
        const draft = st(view).draft;
        if (!taskStillValid(view, draft.task)) return staleTaskNotice(view, draft.task);
        const box = target.closest('.pi-card').querySelector('[data-draft-yaml]'),
            text = box ? box.value : draft.yaml,
            reply = await runTask(view, 'outline', () =>
                ask(view, 'outline', fixYamlMessages(text, draft.error, isClueMode(view.project()) ? 'clue' : 'outline')),
            );
        reply &&
            setDraft(view, draft.mode, reply, {
                fromUnitId: draft.fromUnitId,
                reason: draft.reason,
                stageId: draft.stageId,
                nextId: draft.nextId,
                task: draft.task,
                scope: draft.scope,
            });
    },
    'draft-reparse'(view, target) {
        const draft = st(view).draft;
        if (!taskStillValid(view, draft.task)) return staleTaskNotice(view, draft.task);
        const yaml = target.closest('.pi-card').querySelector('[data-draft-yaml]').value;
        setDraft(
            view,
            draft.mode,
            `\`\`\`yaml
${yaml}
\`\`\``,
            {
                fromUnitId: draft.fromUnitId,
                reason: draft.reason,
                stageId: draft.stageId,
                nextId: draft.nextId,
                task: draft.task,
                scope: draft.scope,
            },
        );
    },
    'draft-drop'(view) {
        (putDraft(view, view.projectId, null), view.renderBody());
    },
    'draft-new'(view) {
        (addVolumes(view, st(view).draft.volumes, 'AI 新建卷'), putDraft(view, view.projectId, null), view.renderBody(), afterAdopt(view));
    },
    async 'draft-replace'(view) {
        const { volume } = findSel(view.project(), st(view).sel);
        if (!volume) throw new Error(vq(view, '先在左边选中要替换的卷', '先在左边选中要替换的剧情线'));
        const incoming = st(view).draft.volumes,
            projectId = view.projectId;
        // 剧情线（带「线」的卷）：只换阶段，编号、类型、开启条件这些线头由程序保留；阶段按名称 / 共有节点对应保留 id
        // （导入审阅总方案 P12 / GPT 审阅 R2）。AI 一次写了好几卷时，只拿第一卷换进来，其余的仍按原来追加在后面。
        // 写入走统一保存：先按这个聊天的进度准备好最终内容，确认框写出改动和对进度的影响（GPT 代码审阅 R8），先记大纲历史（R1）。
        if (isPlainObject(volume.line) && incoming.length) {
            const head = incoming[0],
                { volumes: put } = putVolume([volume], volume.id, { ...head, key: volume.key, line: undefined }, { allowLine: [] }),
                prepare = () => {
                    const p = view.project(),
                        cur = isClueMode(p) && view.runtime.activeId() === projectId ? view.runtime.clue.compute() : null;
                    return prepareCommit(p, [put[0]], { clue: cur ? { snap: cur.snap, prog: cur.prog, config: normalizeClue(p.clue) } : null, label: 'AI 替换剧情线' });
                },
                effects = (pr) => [...(pr.guard ? [...pr.guard.diffs, ...pr.guard.notes] : []), ...(pr.restored.length ? [`已经完成的节点会保留：${pr.restored.join('、')}（完成条件不变）`] : [])];
            let prep = prepare();
            const shown = effects(prep),
                // 确认期间这条线在大纲里被改过或删掉 → 不替换（GPT 第二轮 N1）
                stamp0 = targetStamp(view.project(), [volume.id]);
            if (
                !(await confirmDialog({
                    title: `替换「${volumeName(volume.key)}」`,
                    body: `这条剧情线的阶段换成 AI 写的内容（编号和线头保留）${shown.length ? '；按这个聊天的进度：' : '。'}`,
                    list: [...prep.changes.flatMap((c) => c.changes).slice(0, 12), ...shown],
                    okLabel: '替换',
                    danger: !0,
                }))
            )
                return;
            if (view.projectId !== projectId) return toast('warning', '确认期间切换了项目，没有替换。');
            if (targetStamp(view.project(), [volume.id]) !== stamp0) return toast('warning', '确认期间这条剧情线又被改过（或删掉了），没有替换。请再点一次核对。');
            const again = prepare();
            if (JSON.stringify(effects(again)) !== JSON.stringify(shown)) return toast('warning', '确认期间剧情进度变了，对进度的影响和刚才显示的不同，没有替换。请再点一次核对。');
            prep = again;
            let written = !1;
            view.data.updateProject(projectId, (p) => {
                const w = commitOutline(p, prep);
                if (!w.ok) return p;
                written = !0;
                const at = w.outline.volumes.findIndex((v) => v.id === volume.id),
                    rest = incoming.slice(1);
                return { ...p, outline: { ...w.outline, volumes: [...w.outline.volumes.slice(0, at + 1), ...rest, ...w.outline.volumes.slice(at + 1)] } };
            });
            if (!written) return toast('warning', '大纲刚刚又被改过了，没有替换。请再点一次。');
            prep.restored.length && toast('info', `已保留已经完成的节点：${prep.restored.join('、')}（完成条件不变）。`);
            return ((st(view).draft = null), (st(view).sel = volume.id), view.runtime.refresh(), view.renderBody(), afterAdopt(view));
        }
        if (
            !(await confirmDialog({
                title: `替换「${volumeName(volume.key)}」`,
                body: vq(view, '该卷原有阶段全部换成 AI 写的内容。', '这条剧情线原有的阶段全部换成 AI 写的内容。'),
                okLabel: '替换',
                danger: !0,
            }))
        )
            return;
        (update(view, (volumes) => volumes.flatMap((item) => (item.id === volume.id ? incoming : [item])), 'AI 替换整卷'),
            (st(view).draft = null),
            (st(view).sel = incoming[0].id),
            view.runtime.refresh(),
            view.renderBody(),
            afterAdopt(view));
    },
    'draft-append'(view) {
        const { volume } = findSel(view.project(), st(view).sel);
        if (!volume) throw new Error(vq(view, '先在左边选中要追加到的卷', '先在左边选中要追加到的剧情线'));
        const stages = st(view).draft.volumes.flatMap((item) => item.stages);
        (updateVolume(view, volume.id, (item) => ({ ...item, stages: [...item.stages, ...stages] }), 'AI 追加阶段'),
            (st(view).draft = null),
            view.runtime.refresh(),
            view.renderBody(),
            afterAdopt(view));
    },
    async 'draft-rest'(view) {
        let draft = getDraft(view);
        if (draft && draft.task && !taskStillValid(view, draft.task))
            return toast(
                'warning',
                '这份改写草稿是在另一个聊天里生成的。历史保护要按那个聊天的进度计算，请回到原聊天应用，或丢弃后在这里重新生成。',
            );
        let guard = rewriteGuardNow(view, draft),
            items = guard ? [...guard.diffs, ...guard.notes] : [];
        if (
            !(await confirmDialog({
                title: '替换剩余阶段',
                body: items.length
                    ? '当前阶段和之后的阶段会换成改写后的内容，之前已经演完的阶段不动。按这个聊天现在的进度检查，这次替换会造成下面这些影响，确认可以接受再替换：'
                    : '当前阶段和之后的阶段会换成改写后的内容，之前已经演完的阶段不动。按这个聊天现在的进度检查，没有发现会让已经发生的事情倒退。',
                list: items,
                okLabel: '替换',
                danger: !0,
            }))
        )
            return;
        if (draft && draft.task && !taskStillValid(view, draft.task)) return toast('warning', '确认期间切换了聊天，没有应用。');
        let after = rewriteGuardNow(view, draft),
            seen = new Set(items),
            added = after ? [...after.diffs, ...after.notes].filter((x) => !seen.has(x)) : [];
        if (
            added.length &&
            !(await confirmDialog({
                title: '进度在确认期间变了',
                body: '刚才的确认框打开期间，表格又更新了。按现在的进度，这次改写还会造成：',
                list: added,
                okLabel: '仍然替换',
                danger: !0,
            }))
        )
            return;
        if (draft && draft.task && !taskStillValid(view, draft.task)) return toast('warning', '确认期间切换了聊天，没有应用。');
        const from = applyRest(view, draft, rewriteGuardNow(view, draft));
        (isClueMode(view.project()) ||
            (await runTask(view, 'outline', () => view.runtime.syncSetting(view.projectId, { from, reason: draft.reason }))),
            putDraft(view, view.projectId, null),
            afterAdopt(view),
            view.renderBody());
    },
    // outline v0.1.23：历史版本、检查、总览、单阶段草稿。
    history(view) {
        ((st(view).history = !st(view).history), (st(view).historyAt = void 0), view.renderBody());
    },
    'hist-view'(view, target) {
        ((st(view).historyAt = Number(target.dataset.i)), view.renderBody());
    },
    async 'hist-restore'(view, target) {
        const item = view.project().outline.history[Number(target.dataset.i)];
        if (!item || !(await confirmDialog({ title: '恢复大纲', body: '当前大纲会先存进历史版本，再换成这一版。' }))) return;
        const before = view.project().outline.volumes,
            progress = liveProgress(view),
            { volumes, alias } = restoreOutline(item.text, before);
        if ((update(view, () => volumes, '恢复历史版本', { alias }), progress)) {
            const units = flattenUnits(volumes),
                links = outlineLinks(view.project().outline, units);
            let next = renameByPosition(progress, units, links);
            const cur = flattenUnits(before)[currentIndex(flattenUnits(before), progress)]?.id,
                resolved = cur ? links.resolve(cur) : '',
                to =
                    resolved && units.some((unit) => unit.id === resolved)
                        ? resolved === cur
                            ? null
                            : resolved
                        : nearestUnitId(before, volumes, cur);
            (to && (next = goTo(next, units, to)), next !== progress && view.runtime.setProgress(next));
        }
        ((st(view).sel = ''), view.runtime.refresh(), view.renderBody());
    },
    'check-toggle'(view) {
        ((st(view).check = !st(view).check), view.renderBody());
    },
    'overview-toggle'(view) {
        ((st(view).overview = !st(view).overview), view.renderBody());
    },
    'issue-go'(view, target) {
        ((st(view).sel = target.dataset.id), (st(view).raw = !1), (st(view).overview = !1), view.renderBody());
    },
    'ov-go'(view, target) {
        ((st(view).sel = target.dataset.id), (st(view).raw = !1), (st(view).overview = !1), view.renderBody());
    },
    async 'draft-stage'(view) {
        const draft = st(view).draft,
            project = view.project(),
            volume = project.outline.volumes.find((item) => item.stages.some((stage) => stage.id === draft.stageId));
        if (!volume) throw new Error('原来的阶段已不存在，改用「丢弃」。');
        if (!taskStillValid(view, draft.task)) return staleTaskNotice(view, draft.task);
        let incoming = draft.volumes.flatMap((item) => item.stages);
        if (!incoming.length) throw new Error('结果里没有阶段。');
        const ids = [draft.stageId, ...(draft.nextId ? [draft.nextId] : [])],
            old = volume.stages.filter((stage) => ids.includes(stage.id));
        if (isClueMode(project) && view.runtime.activeId() === view.projectId) {
            const current = view.runtime.clue.compute(),
                preview = replaceStages(project.outline.volumes, volume.id, ids, incoming),
                guard = historyGuard(project.outline.volumes, preview.volumes, current.snap, current.prog, project.clue, {
                    scope: new Set(compileClue([{ ...volume, stages: old }]).nodes.map((n) => n.uid)),
                });
            incoming = restoreHistory([{ ...volume, stages: incoming }], guard).flatMap((v) => v.stages);
        }
        const { volumes, stages, keepId } = replaceStages(project.outline.volumes, volume.id, ids, incoming),
            progress = liveProgress(view);
        if (
            (update(view, () => volumes, STAGE_DRAFT[draft.mode], { alias: ids.filter((id) => id !== keepId).map((id) => [id, keepId]) }),
            progress)
        ) {
            const moved = migrateStageThreads(progress, old, stages, keepId);
            view.runtime.setProgress(ids.includes(progress.current) ? goTo(moved, flattenUnits(volumes), keepId) : moved);
        }
        ((st(view).draft = null), (st(view).sel = keepId), view.runtime.refresh(), view.renderBody());
    },
};

// 单阶段 AI 操作：结果先进草稿区，点「替换」才落盘。
async function stageOp(view, op) {
    const task = taskContext(view),
        project = view.project();
    const unit = flattenUnits(project.outline.volumes).find((item) => item.id === st(view).sel);
    if (!unit) return;
    const next = op === 'merge' ? unit.volume.stages[unit.stageIndex + 1] : null;
    if (op === 'merge' && !next) throw new Error(vq(view, '本卷没有下一段可合并。', '这条剧情线没有下一段可合并。'));
    const material = await generationMaterial(view, { task: 'rewrite' });
    if (!taskStillValid(view, task)) return staleTaskNotice(view, task);
    const { talk, refs: wb } = material;
    const reply = await runTask(view, 'outline', () =>
        ask(
            view,
            'outline',
            stageOpMessages({
                setting: project.setting.text,
                talk,
                refs: wb,
                volumes: project.outline.volumes,
                unit,
                next,
                op,
                mode: isClueMode(project) ? 'clue' : 'outline',
                progress: material.progress,
            }),
        ),
    );
    if (reply) setDraft(view, `stage-${op}`, reply, { stageId: unit.stage.id, nextId: next ? next.id : '', task, scope: material.scope });
}

function renameInTree(target, id, label) {
    const item = target.closest('.pi-body')?.querySelector(`.pi-titem[data-id="${id}"] .pi-pname`);
    if (item) item.textContent = label;
}

export function onInput(view, target) {
    if (target.matches('[data-rv-when],[data-rv-win],select[data-rv-tbl]')) return void reviewOnInput(view, target, importJobOf);
    // 导入页「推进方式」下拉框（第四批：代替「整理成：… 改」）
    if (target.matches('[data-imp-modesel]')) return void importActions['import-mode'](view, target, target.value);
    let { stage, volume } = findSel(view.project(), st(view).sel);
    if (target.dataset.aiRequest !== void 0) {
        st(view).request = target.value;
        return;
    }
    if (target.dataset.volKey !== void 0 && volume) {
        const key = target.value.trim();
        key &&
            !view.project().outline.volumes.some((item) => item.key === key && item.id !== volume.id) &&
            (updateVolume(view, volume.id, (item) => ({ ...item, key })), renameInTree(target, volume.id, volumeName(key)));
        return;
    }
    if (stage) {
        if (target.dataset.stageKey !== void 0) {
            const key = target.value.trim();
            key &&
                !volume.stages.some((item) => item.key === key && item.id !== stage.id) &&
                (updateStage(view, stage.id, (item) => ({ ...item, key })), renameInTree(target, stage.id, stageLabel(key)));
            return;
        }
        if (target.dataset.stageField) {
            const field = target.dataset.stageField;
            updateStage(view, stage.id, (item) => ({ ...item, data: { ...item.data, [field]: target.value } }));
            return;
        }
        if (target.dataset.stageList) {
            const field = target.dataset.stageList,
                lines = target.value
                    .split(
                        `
`,
                    )
                    .map((line) => line.trim())
                    .filter(Boolean);
            updateStage(view, stage.id, (item) => {
                const data = { ...item.data, [field]: lines };
                return (lines.length || delete data[field], { ...item, data });
            });
            return;
        }
        if (target.dataset.nodeField) {
            const field = target.dataset.nodeField,
                index = Number(target.dataset.i),
                key = target.dataset.k,
                pending = nameKey(stage.id, field, index);
            if (['名称', '类型', '内容'].includes(key) && !pendingNames.has(pending)) {
                const node = nodeAt(stage, field, index);
                node && pendingNames.set(pending, node.name);
            }
            updateStage(view, stage.id, (item) => {
                const list = [...item.data[field]],
                    prev = list[index] && typeof list[index] == 'object' ? list[index] : {};
                if (((list[index] = { ...prev, [key]: target.value }), target.dataset.play !== void 0)) {
                    const value = playValue(key, target.value);
                    value === void 0 ? delete list[index][key] : (list[index][key] = value);
                }
                return { ...item, data: { ...item.data, [field]: list } };
            });
        }
    }
}

// 失焦时同步注入内容；名字改动直接改树上的文字，不整页重画（避免吞掉紧接着的点击）。
export function onBlur(view, target) {
    if (target.matches('[data-rv-comment],[data-rv-line],input[data-rv-tbl]')) return reviewOnInput(view, target, importJobOf, { blur: !0 });
    if (target.dataset.nodeYaml !== void 0 || target.dataset.stageYaml !== void 0) return applyYamlField(view, target);
    (target.dataset.nodeField &&
        ['名称', '类型', '内容'].includes(target.dataset.k) &&
        syncNodeName(view, target.dataset.nodeField, Number(target.dataset.i)),
        target.matches('[data-stage-key],[data-vol-key],[data-stage-field],[data-stage-list],[data-node-field]') && view.runtime.refresh());
}

// 改了节点名：改名记进大纲的改名表（其他聊天按改名链找回记录），当前聊天同一位置的钟、钩子、已演标记跟着改名。
// 改名前的名称在第一次输入时记下（pendingNames），失焦时比对。
const pendingNames = new Map();
const nameKey = (stageId, field, index) => [stageId, field, index].join('|');

function nodeAt(stage, field, index) {
    return stage ? stageNodes(stage.data).find((item) => item.field === field && item.index === index) : null;
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
        view.data.updateProject(view.projectId, (project) => ({
            ...project,
            outline: withRenames(project.outline, [{ stageId: stage.id, field, from, to: node.name }]),
        }));
    }
    const progress = liveProgress(view);
    if (!progress) return;
    const next = renameNode(progress, { id: stage.id }, node);
    if (next !== progress) view.runtime.setProgress(next);
}

export const refreshOn = [];

export function getDraft(view) {
    syncDraft(view, st(view));
    return st(view).draft || null;
}

export function putDraft(view, projectId, draft) {
    if (projectId === view.projectId) st(view).draft = draft ? { ...draft, projectId } : null;
    else if (draft) parkedDrafts.set(projectId, { ...draft, projectId });
    else parkedDrafts.delete(projectId);
}

export const CLUE_TEXT_KEYS = ['入口', '场景', '作者备注'];

export const CLUE_YAML_KEYS = ['必需', '开放条件', '提前条件', '完成条件', '发现', '相关事实'];

// 线索推进的节点字段（第四批）：入口、场景直接显示；完成条件和发现收在「线索条件」里（写了就展开，收起时一句摘要）；
// 不常用的（事件、偏转、触发、作者备注、开放 / 提前条件、相关事实）收在「更多」里，写了内容的不藏。
export function clueNodeFields(meta2, index, value) {
    let yamlOf = (v) => (v === void 0 || v === null || v === '' ? '' : typeof v == 'string' ? v : stringifyYaml(v).trim()),
        has = (k) => value[k] !== void 0 && value[k] !== null && value[k] !== '',
        text = (key, hint = '') => `<label class="pi-field"><span>${esc(key)}</span><textarea class="pi-ta pi-ta-auto" rows="2" data-node-field="${esc(meta2.field)}" data-i="${index}" data-k="${esc(key)}"${hint ? ` placeholder="${esc(hint)}"` : ''}>${esc(value[key] ?? '')}</textarea></label>`,
        yaml = (key) => `<label class="pi-field"><span>${esc(key)}</span><textarea class="pi-ta is-mono pi-ta-auto" rows="2" data-node-yaml="${esc(meta2.field)}" data-i="${index}" data-k="${esc(key)}" placeholder="${esc(CLUE_PLACEHOLDER[key] || '')}">${esc(yamlOf(value[key]))}</textarea></label>`,
        gets = discoveryList(value).map((d) => d.fact).filter(Boolean),
        condSum = [has('完成条件') ? `完成：${condBrief(value.完成条件)}` : '', gets.length ? `获得 ${gets.join('、')}` : ''].filter(Boolean).join('；') || '都没写',
        moreKeys = ['事件', '偏转', '触发', '作者备注', '开放条件', '提前条件', '相关事实'].filter((k) => k in value || ['作者备注', '开放条件', '提前条件', '相关事实'].includes(k)),
        moreHas = moreKeys.filter(has),
        moreSum = moreHas.length ? `已写：${moreHas.join('、')}` : '都没写',
        moreField = (k) => (CLUE_YAML_KEYS.includes(k) ? yaml(k) : k === '作者备注' ? text(k, '只给作者看，不注入') : `<label class="pi-field"><span>${esc(k)}</span><textarea class="pi-ta pi-ta-auto" rows="2" data-node-field="${esc(meta2.field)}" data-i="${index}" data-k="${esc(k)}">${esc(value[k] ?? '')}</textarea></label>`);
    return `${text('入口', '开放后告诉正文可以去做')}${text('场景', '成为焦点时注入')}
        <details class="pi-fold"${has('完成条件') || gets.length ? ' open' : ''}><summary><b>线索条件</b><span>${esc(condSum)}</span></summary>${yaml('完成条件')}${yaml('发现')}</details>
        <details class="pi-fold"${moreHas.length ? ' open' : ''}><summary><b>更多</b><span>${esc(moreSum)}</span></summary>${moreKeys.map(moreField).join('')}<p class="pi-hint">ID ${esc(value.id || '保存后自动补')}</p></details>
        <p class="pi-status" data-node-yaml-status="${index}"></p>`;
}

export const CLUE_PLACEHOLDER = {
    必需: '主线默认必需；可选写 false',
    开放条件: '全部:\n  - 事实: F00',
    提前条件: '任一:\n  - 事实: F紧急',
    完成条件: '事实: FA',
    发现: '- 事实: FA\n  内容: 本场景可能获得的发现',
    相关事实: '[F00]',
};

export function taskContext(view) {
    let project = view.project(),
        c = ctx();
    return {
        projectId: view.projectId,
        mode: project && isClueMode(project) ? 'clue' : 'outline',
        chatId: c && typeof c.getCurrentChatId == 'function' ? String(c.getCurrentChatId() ?? '') : '',
        active: view.runtime.activeId() === view.projectId,
    };
}

export function taskStillValid(view, t) {
    if (!t) return !0;
    let now = taskContext(view);
    return now.projectId === t.projectId && now.mode === t.mode && (!t.active || (now.active && now.chatId === t.chatId));
}

export function staleTaskNotice(view, t) {
    toast(
        'warning',
        view.projectId !== t.projectId
            ? '生成期间切换了项目，结果已丢弃，没有写进当前项目。'
            : '生成期间切换了推进方式或聊天，结果已丢弃。',
    );
}

export async function generationMaterial(view, { talkLimit = 12e3, task = 'volume' } = {}) {
    let project = view.project(),
        chat = await view.data.loadChat(view.projectId),
        full = transcript(chat.summary, chat.messages, Infinity),
        talk = transcript(chat.summary, chat.messages, talkLimit),
        clue = isClueMode(project),
        r = chat.refs || {};
    const writing = await genRefTexts(view, talkLimit);
    talk = writing.talk;
    // 设定有专门位置，不重复；大纲、进度、楼数单独处理（下面），其余勾选项（世界书条目）走 resolveRefs。
    let refs = await resolveRefs(view, chat, project, { skip: ['setting', 'outline', 'progress', 'floors'] }),
        extra = [];
    // 勾选「当前大纲」：写新卷时按预算附正文（作者视角，含作者备注；只发给写大纲的模型，不进正文注入）。
    // 改写本身已经带了「需要改写的剩余阶段」，不再重复附整份大纲。
    r.outline &&
        project.outline.volumes.length &&
        task === 'volume' &&
        extra.push({ title: '当前大纲', text: outlineToText(project.outline.volumes) });
    let progress = '';
    if (r.progress) {
        let c = clue && view.runtime.activeId() === view.projectId ? view.runtime.clue.compute() : null;
        progress = c ? clueProgressText(c.state, c.snap, c.prog, { problems: c.snap.problems }) : clue ? '' : progressText(view);
    }
    let floorsN = Math.max(0, Number(r.floors) || 0),
        recent = floorsN
            ? view.runtime.recentFloors(floorsN).map(
                  (f) => `【第 ${f.index} 楼】
${f.text}`,
              ).join(`

`)
            : '';
    // 预算：先放勾选的大纲，再放世界书条目；进度、近期正文单独计入清单。
    const combined = [...extra, ...refs, ...writing.wb].filter(
        (ref, index, list) => list.findIndex((other) => other.title === ref.title && other.text === ref.text) === index,
    );
    let fitted = fitRefs(combined),
        parts = [];
    talk
        ? parts.push(`讨论记录（${full.length} 字${full.length > talk.length ? `，只附了最近 ${talk.length} 字` : ''}）`)
        : parts.push('讨论记录：没有');
    for (let rep of fitted.report)
        parts.push(
            rep.kept === rep.chars
                ? `${rep.title}（${rep.chars} 字）`
                : rep.kept
                  ? `${rep.title}（${rep.chars} 字，只附了前 ${rep.kept} 字）`
                  : `${rep.title}（${rep.chars} 字，超出预算未附带）`,
        );
    r.progress &&
        parts.push(
            progress
                ? clue
                    ? '线索进度（当前聊天）'
                    : '剧情进度'
                : clue
                  ? '线索进度：本项目不是当前聊天启用的项目，没有附带'
                  : '剧情进度：没有',
        );
    task === 'rewrite' &&
        parts.push(
            recent
                ? `最近 ${floorsN} 楼正文`
                : floorsN
                  ? `最近正文：勾选了 ${floorsN} 楼，但本聊天还没有可附的正文`
                  : '最近正文：讨论区勾选的楼数为 0，没有附带',
        );
    task === 'rewrite' && r.outline && parts.push('当前大纲：改写只附「需要改写的剩余阶段」，前面已经演过的阶段没有附带');
    task === 'volume' &&
        floorsN &&
        parts.push(recent ? `最近 ${floorsN} 楼正文` : `最近正文：勾选了 ${floorsN} 楼，但本聊天还没有可附的正文`);
    task === 'volume' && clue && parts.push('已有节点与事实编号索引（固定附带）');
    return { project, talk, refs: fitted.refs, progress, recent, clue, scope: `本次附带的材料：${parts.join('、')}` };
}

export function rewriteGuardNow(view, draft) {
    let project = view.project(),
        unit = flattenUnits(project.outline.volumes).find((item) => item.id === draft.fromUnitId);
    if (!unit || !isClueMode(project) || view.runtime.activeId() !== view.projectId) return null;
    let c = view.runtime.clue.compute(),
        units = flattenUnits(project.outline.volumes),
        from = units.findIndex((u) => u.id === draft.fromUnitId),
        restIds = new Set(
            compileClue(units.slice(from).map((u) => ({ ...u.volume, stages: [u.stage] })))
                .nodes.map((n) => n.uid)
                .filter(Boolean),
        );
    return c
        ? historyGuard(
              project.outline.volumes,
              replaceRest(project.outline.volumes, unit.stage.id, draft.volumes),
              c.snap,
              c.prog,
              project.clue,
              { scope: restIds },
          )
        : null;
}

export function applyYamlField(view, target) {
    let { stage } = findSel(view.project(), st(view).sel);
    if (!stage) return;
    let text = target.value.trim(),
        key = target.dataset.k || target.dataset.stageYaml,
        status = target
            .closest('.pi-card')
            .querySelector(
                target.dataset.stageYaml !== void 0 ? '[data-stage-yaml-status]' : `[data-node-yaml-status="${target.dataset.i}"]`,
            ),
        value;
    try {
        value = text === '' ? void 0 : parseYaml(text);
        let errs = [];
        ['开放条件', '提前条件', '完成条件', '进入条件', '结束条件'].includes(key) && parseCondition(value, errs);
        if (errs.length) throw new Error(errs.join('；'));
        status && ((status.textContent = ''), status.classList.remove('is-err'));
    } catch (error) {
        status && ((status.textContent = `${key}：${error.message}`), status.classList.add('is-err'));
        return;
    }
    let set = (obj) => {
        let out = { ...obj };
        return (value === void 0 ? delete out[key] : (out[key] = value), out);
    };
    (target.dataset.stageYaml !== void 0
        ? updateStage(view, stage.id, (item) => ({ ...item, data: set(item.data) }))
        : updateStage(view, stage.id, (item) => {
              let field = target.dataset.nodeYaml,
                  list = [...item.data[field]],
                  index = Number(target.dataset.i);
              return (
                  (list[index] = set(isPlainObject(list[index]) ? list[index] : {})),
                  { ...item, data: { ...item.data, [field]: list } }
              );
          }),
        view.runtime.clue.invalidate(),
        view.runtime.refresh());
}

export { st };

export function currentTables() {
    let api = acuApi();
    try {
        return api && typeof api.exportTableAsJson == 'function' ? cloneTables(api.exportTableAsJson()) : null;
    } catch {
        return null;
    }
}

export function afterAdopt(view) {
    let p = view.project();
    p && isClueMode(p) && compileClue(p.outline.volumes).lines.length && prepareLabels(view);
}
