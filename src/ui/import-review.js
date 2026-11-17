// 逐页审阅（导入审阅与改大纲总方案第四节；界面见 开发/ui-preview/import-review.html，用户 2026-11-16 确认）。
// 一条剧情线：第 1 页「这条线」（线头：类型、简介、入口、什么时候开始），后面每个阶段一页。
// 审阅只改草稿（job.review），点「保存到大纲」才经 review-draft 的 prepareCommit 写进项目（GPT 审阅 R1 / R3；保存在 long-import.js）。
// 用在：导入「一条主线 / 一条支线」，以及旧的「线索推进的大纲」导入任务（没有线头时没有第 1 页）。
import {
    checkImportDraft,
    importReachIssues,
    importSecretNames,
    issueCommentLine,
    appendComment,
    issueQuestion,
    reviewReviseMessages,
    splitUnitReplies,
    parseUnitReply,
    sourceExcerpt,
    splitImportAuthorFields,
    importJobKind,
    mergeImportIndex,
    keepReasons,
    mergeSameIssues,
} from '../core/long-import.js';
import {
    createReviewSession,
    editDraft,
    undoDraft,
    unitKey,
    sessionUnits,
    unitValue,
    putStage,
    putLine,
    draftChanges,
    relatedGroups,
    groupContext,
    groupVerdict,
    refBreaks,
    draftDiffers,
    editedVolumes,
    newMissingRefs,
    stripReviewMarks,
    stableText,
} from '../core/review-draft.js';
import { isPlainObject, stageLabel, stageNodes, makeId, volumeLabel, VOLUME_LINE_KEY, volumeName, splitStageKey } from '../core/outline.js';
import { stringifyYaml } from '../core/yaml.js';
import { tableCatalogText } from '../core/prompts.js';
import { isClueMode, nodeUid, reidConflicts } from '../core/clue-model.js';
import { compileClue, parseCondition, confirmTierOrder, evalAtom, splitCompare } from '../core/clue-rules.js';
import { sheetList, sheetRows, tierNumberInNote } from '../core/clue-tables.js';
import { chatFactSets, discoveryList, clueText, cellCondCheck } from '../core/clue-project.js';
import { reidLines, mainLinesText } from '../core/long-import.js';
import { esc, openDialog, menuDialog } from './dom.js';
import { transcript } from '../core/prompts.js';
import { ask, runTask } from './ai.js';
import { toast, hostDocument } from '../host/st.js';
import { currentTables } from './tab-outline.js';
import { projectSecretNames } from '../core/store.js';
import { condWords, condNames, reviewCheck } from './review-lines.js';
import { ICONS } from './styles.js';

// ---------------- 会话（存在导入任务里：job.review）----------------
// 第一次打开时由 drafts 合成的候选建会话；之后以会话为准（「多条支线」旧任务的迁移见 review-draft.linesSessionOf）。
export function reviewOf(job, candidate) {
    if (job.review && Array.isArray(job.review.draft)) return job.review;
    // 主线默认排在前一条主线后面（用户 2026-11-16：默认前面的主线结束后才开始）；文档写了开始条件的，照文档。支线没写的要作者自己选。
    let headOf = (l) =>
            isPlainObject(l) && String(l.类型 || '').trim() === '主线' && (l.开启条件 == null || l.开启条件 === '') && !l.开启方式 && l.接上一条 == null ? { ...l, 接上一条: !0 } : l,
        vols = candidate.volumes.map((v) => ({ ...v, ...(isPlainObject(v.line) ? { line: headOf(v.line) } : {}), id: v.id || makeId('v'), stages: v.stages.map((s) => ({ ...s, id: s.id || makeId('s') })) }));
    return { ...createReviewSession({ source: 'import', projectId: job.projectId, jobId: job.id, volumes: vols }), at: 0, notes: candidate.notes || {}, mode: job.mode === 'outline' ? 'outline' : 'clue' };
}
// 这份审阅按哪种推进方式显示、检查、发请求（GPT 代码审阅 R7）：建审阅时记下的 mode 为准。
// 已有项目（重新审阅、审阅修改）按项目当前的推进方式；新导入按这次选的整理方式。不靠「有没有线头」猜（切换推进方式不删旧线头）。
// 旧审阅没记 mode：已有项目按项目，导入沿用原来的判断。
export function reviewIsClue(project, review) {
    if (review && (review.mode === 'clue' || review.mode === 'outline')) return review.mode === 'clue';
    if (review && review.source && review.source !== 'import') return isClueMode(project);
    return isClueMode(project) || !!(review && review.draft.some((v) => isPlainObject(v.line)));
}

// 审阅页的页：线头页只在线索推进里有（按阶段推进保留的旧线头不显示、不发给 AI）。
export function reviewUnits(project, review) {
    let clue = reviewIsClue(project, review);
    return sessionUnits(review).filter((u) => u.kind === 'stage' || (clue && isPlainObject(review.draft.find((v) => v.id === u.volumeId).line)));
}

// 这条线还能改吗：「好几条支线」导入里已经保存到大纲的线、本次不导入的线，不再发给 AI、不再编辑（GPT 第二轮 N5）。
// 改已有线的审阅（审阅修改）里，大纲里已经删掉的线也只读：草稿和意见留着可以看、复制，不会写回（GPT 第二轮 N6）。
export function lineLocked(review, volumeId, project = null) {
    if (review.lines) return !!((review.adoptedLines || {})[volumeId] || (review.dropped || []).includes(volumeId));
    return !!(project && review.source && review.source !== 'import' && !project.outline.volumes.some((v) => v.id === volumeId));
}
// 可以发给 AI 的意见：去掉已保存、不导入、大纲里已删掉的线上的。返回 [单位键…]。
export function sendableNotes(project, review) {
    return reviewUnits(project, review)
        .filter((u) => !lineLocked(review, u.volumeId, project) && String((review.comments || {})[u.key] || '').trim())
        .map((u) => u.key);
}
// 意见、问题的标题：多条线时带线名（GPT 第二轮 N3：不同的线都可能叫「阶段1 经过」）。
export function unitTitle(review, key) {
    let vol = review.draft.find((v) => v.id === key.split('/')[0]),
        own = key.endsWith('/line') ? '线（开头信息）' : stageLabel((unitValue(review.draft, key) || { key: '' }).key);
    return vol && review.draft.length > 1 ? `${lineTitle(vol)} / ${key.endsWith('/line') ? '线信息' : own}` : own;
}

// 这一份草稿现在的问题（按单位归好）。项目里已有的线作为背景参与可达性判断（只报这次的单位）。
export function reviewIssues(view, review, index) {
    let project = view.project(),
        clue = reviewIsClue(project, review),
        // 新导入的线还没有编号（采用时才分配）：检查时先给一个临时编号，免得报「缺少编号」
        draft = review.draft.map((v, i) => (isPlainObject(v.line) && !String(v.line.编号 || '').trim() ? { ...v, line: { ...v.line, 编号: `新${i + 1}` } } : v)),
        mine = new Set(draft.flatMap((v) => v.stages.map((s) => stageLabel(s.key)))),
        // 重新审阅 / 讨论里改已有的线：草稿就是项目里那一卷，背景里去掉它，免得算两遍；引用项目里别的线、别的节点不算「不存在」
        others = project.outline.volumes.filter((v) => !draft.some((d) => d.id === v.id)),
        known0 = compileClue(others),
        exists = new Set([...known0.nodes.map((n) => n.uid), ...known0.lines.map((l) => l.id)].filter(Boolean)),
        secrets = review.source && review.source !== 'import' ? projectSecretNames(project) || [] : null,
        shorts = reviewShorts(project, review),
        // 保密名字看「运行时正文能看到什么」，由项目的推进方式决定：按线索写的内容放进按阶段推进的项目，节点名称等也会交给正文
        runSecrets = clue && !isClueMode(project) ? checkImportDraft(draft, { index, secrets, mode: 'outline', ...shorts }).filter((x) => /^secret-/.test(x.kind || '')) : [],
        own0 = checkImportDraft(draft, { index, secrets, mode: clue ? 'clue' : 'outline', ...shorts }),
        own = [...own0, ...runSecrets.filter((x) => !own0.some((y) => y.kind === x.kind && y.name === x.name && y.stageId === x.stageId))].filter(
            (x) => !/^(route|reach|reach-unknown)$/.test(x.kind || '') && !/按大纲推演|替代途径/.test(x.text) && !((/引用了不存在的(?:节点|线)「([^」]+)」/.exec(x.text) || [])[1] && exists.has(/引用了不存在的(?:节点|线)「([^」]+)」/.exec(x.text)[1])),
        ),
        c = view.runtime.activeId() === view.projectId && isClueMode(project) ? view.runtime.clue.compute() : null,
        { known, claimed } = chatFactSets(c),
        reach = clue ? importReachIssues([...others, ...draft], { only: mine, knownFacts: known, claimedFacts: claimed }) : [],
        all = [...own, ...reach],
        dismissed = new Set(review.dismissed || []),
        by = {},
        stageOf = new Map(draft.flatMap((v) => v.stages.map((s) => [s.id, unitKey(v.id, s.id)]))),
        firstStage = draft[0] && draft[0].stages[0] ? unitKey(draft[0].id, draft[0].stages[0].id) : '';
    for (let x of all) {
        let key = (x.stageId && stageOf.get(x.stageId)) || (x.stageIds && x.stageIds.map((id) => stageOf.get(id)).find(Boolean)) || firstStage,
            id = `${x.kind || 'x'}|${x.name || ''}|${x.stageId || ''}|${(x.nodeIds || []).join(',')}`;
        dismissed.has(id) || (by[key] = [...(by[key] || []), { ...x, id }]);
    }
    for (let k of Object.keys(by)) by[k] = mergeSameIssues(by[k]);
    return by;
}

// 疑似短名的回答（用户 2026-11-17）：「是同一人」的当保密名字检查、发给 AI；「不是」的不再提示。
// 导入审阅记在这份审阅里，保存到大纲时写进项目的保密名单；审阅修改（已有的线）直接读项目的保密名单。
export function reviewShorts(project, review) {
    let own = (k) => (Array.isArray(review && review[k]) ? review[k] : []),
        lists = review && review.source && review.source !== 'import' ? Object.values((project && project.secretNames) || {}) : [],
        from = (k) => lists.flatMap((x) => x[k] || []);
    return { shortsSure: [...new Set([...own('shortsSure'), ...from('confirmed')])], shortsNot: [...new Set([...own('shortsNot'), ...from('denied')])] };
}

// ---------------- 渲染 ----------------
const cut = (t, n = 26) => (String(t || '').length > n ? `${String(t).slice(0, n)}…` : String(t || ''));
function nodeLine(n, clue = !0) {
    let item = isPlainObject(n.item) ? n.item : {};
    if (!clue) {
        // 按阶段推进：地点，事件（支线带触发）
        let place = clueText(item.地点),
            what = clueText(item.事件 || item.内容 || item.场景),
            trig = n.kind === 'side' && item.触发 ? `触发：${cut(clueText(item.触发), 16)}` : '';
        return `<div class="pi-rv-node"><b>${esc(n.name)}</b><span>${esc([trig, place, cut(what, 40)].filter(Boolean).join('，') || '—')}</span></div>`;
    }
    let gets = discoveryList(item).map((d) => cut(d.text.replace(/[。；;]+$/, ''), 20)),
        req = item.必需 === !1 || item.必需 === 'false' || n.kind === 'side' ? '可选' : '必需';
    return `<div class="pi-rv-node"><b>${esc(n.name)}</b><span><i class="pi-rv-tag">${req}</i>${gets.length ? `获得：${esc(gets.join('、'))}` : ''}</span></div>`;
}
// 完整内容（不看 YAML 也能读完整剧情，GPT 界面审阅第六节）：一个场景的各字段用文字列出，作者备注单独一行。
const FULL_CLUE = [['入口', '入口'], ['地点', '地点'], ['场景', '场景'], ['开放条件', '开放'], ['提前条件', '提前'], ['完成条件', '完成']],
    FULL_OUTLINE = [['触发', '触发'], ['地点', '地点'], ['事件', '事件'], ['偏转', '偏转'], ['场景', '场景']];
function nodeFull(n, clue, names) {
    let item = isPlainObject(n.item) ? n.item : {},
        val = (k, v) => (/条件$/.test(k) && v && typeof v == 'object' ? condWords(parseCondition(v, []), names) || clueText(JSON.stringify(v)) : clueText(v)),
        rows = (clue ? FULL_CLUE : FULL_OUTLINE).filter(([k]) => item[k] != null && item[k] !== '').map(([k, label]) => [label, val(k, item[k])]),
        gets = clue ? discoveryList(item).map((d) => d.text.replace(/[。；;]+$/, '')) : [],
        req = clue ? (item.必需 === !1 || item.必需 === 'false' || n.kind === 'side' ? '可选' : '必需') : n.kind === 'side' ? '支线' : '',
        note = clueText(item.作者备注 || '');
    gets.length && rows.splice(rows.findIndex(([l]) => l === '完成') < 0 ? rows.length : rows.findIndex(([l]) => l === '完成'), 0, ['获得', `${gets.join('；')}。`]);
    return `<div class="pi-rv-full"><b>${esc(n.name)}</b>${req ? `<i class="pi-rv-tag">${req}</i>` : ''}<dl>${rows.map(([l, v]) => `<dt>${l}</dt><dd>${esc(v)}</dd>`).join('')}</dl>${note ? `<div class="pi-rv-auth">作者备注（正文看不到）：${esc(note)}</div>` : ''}</div>`;
}
function issueCard(x, unit, filled) {
    if (x.level === 'error')
        return `<div class="pi-rv-issue"><p>${esc(x.plain || x.text)}</p>${x.names ? `<ul class="pi-rv-names">${x.names.map((n) => `<li>${esc(n)}</li>`).join('')}</ul>` : ''}${x.fix ? `<span class="pi-rv-fix"><b>建议：</b>${esc(x.fix)}</span>` : ''}
            <div class="pi-row">${filled ? '<span class="pi-badge is-ok">已加入意见</span>' : `<button type="button" class="pi-btn is-sm" data-act="rv-fill" data-unit="${esc(unit)}" data-issue="${esc(x.id)}">加入意见</button>`}
            <details><summary class="pi-hint">详情</summary><p class="pi-hint pi-rv-tech">${esc(x.text)}</p></details></div></div>`;
    let { q, how } = issueQuestion(x),
        // 是不是同一个人：两个按钮直接回答（用户 2026-11-17）。揭晓的地方：确认后收起；不是的话写意见。
        acts =
            x.kind === 'secret-short'
                ? `<button type="button" class="pi-btn is-sm" data-act="rv-short" data-name="${esc(x.name)}" data-v="yes">是同一人</button><button type="button" class="pi-btn is-sm is-ghost" data-act="rv-short" data-name="${esc(x.name)}" data-v="no">不是</button>`
                : `<button type="button" class="pi-btn is-sm" data-act="rv-dismiss" data-issue="${esc(x.id)}">${x.kind === 'secret-reveal' ? '是，收起' : '没问题，收起'}</button>${filled ? '<span class="pi-badge is-ok">已加入意见</span>' : `<button type="button" class="pi-btn is-sm is-ghost" data-act="rv-fill" data-unit="${esc(unit)}" data-issue="${esc(x.id)}">加入意见</button>`}`;
    return `<div class="pi-rv-issue is-ask"><p>${esc(q)}</p>${how ? `<span class="pi-rv-fix">${esc(how)}</span>` : ''}
        <div class="pi-row">${acts}</div></div>`;
}
function whenText(line, volumes) {
    if (!isPlainObject(line)) return '';
    let errs = [],
        open = line.开启条件 != null && line.开启条件 !== '' ? parseCondition(line.开启条件, errs) : null,
        names = condNames(volumes),
        manual = String(line.开启方式 || '').trim() === '人工',
        after = line.接上一条 === !0 || line.接上一条 === '是';
    return [manual ? '手动开始' : '', after ? '前一条主线结束后' : '', open && !errs.length ? condWords(open, names) : open ? String(line.开启条件) : '']
        .filter(Boolean)
        .join('，并且') || (String(line.类型 || '').trim() === '主线' ? '' : '随时可以开始（遇到入口时）');
}
const WHEN = [
    { v: 'after', label: '前一条主线结束后', main: !0 },
    { v: 'any', label: '随时可以开始' },
    { v: 'manual', label: '手动开始' },
    { v: 'table', label: '按表格条件' },
    { v: 'keep', label: '保留现有条件' },
];
// 「按表格条件」（用户 2026-11-16）：一个条件「表/行/列 比较 值」，表、行、列从当前数据库读。复杂的组合仍写意见让 AI 改。
const TABLE_OPS = [
    { v: '==', label: '等于' },
    { v: '!=', label: '不等于' },
    { v: '>=', label: '≥' },
    { v: '>', label: '>' },
    { v: '<=', label: '≤' },
    { v: '<', label: '<' },
    { v: '包含', label: '包含' },
    { v: '不包含', label: '不包含' },
];
// 开启条件是不是一条简单的表格条件：是就拆成 { table, row, col, op, value }，表单能显示和编辑。
export function simpleTableCond(cond) {
    let raw = isPlainObject(cond) && Object.keys(cond).length === 1 && typeof cond.表 === 'string' ? cond.表 : null,
        m = raw && splitCompare(raw, /^\s*([^/]+)\/([^/]+)\/(.+?)\s*(==|!=|>=|<=|不包含|包含|>|<)\s*(.*)$/);
    return m ? { table: m[1].trim(), row: m[2].trim(), col: m[3].trim(), op: m[4], value: m[5].trim() } : null;
}
// 表单编辑不了的开启条件（几个条件组合、线的状态等）：「保留现有条件」选项给它用
const complexCond = (c) => c != null && c !== '' && !simpleTableCond(c);
const tableCondOf = (t) => ({ 表: `${t.table}/${t.row}/${t.col} ${t.op} ${t.value}` });
function whenPick(line) {
    if (!isPlainObject(line)) return '';
    if (String(line.开启方式 || '').trim() === '人工') return 'manual';
    if (line.接上一条 === !0 || line.接上一条 === '是') return 'after';
    if (line.开启条件 != null && line.开启条件 !== '') return simpleTableCond(line.开启条件) || line.开始方式表格 ? 'table' : 'keep';
    return line.开始方式表格 ? 'table' : line.开始时机已选 ? 'any' : '';
}

// 线的显示名：编号 + 名称（名称里已带编号的不重复）。
export function lineTitle(v) {
    let name = volumeName(v.key),
        id = isPlainObject(v.line) ? String(v.line.编号 || '').trim() : '';
    return id && !name.startsWith(id) ? `${id} ${name}` : name;
}
// 待保存的线：这次审阅里实际改过（打开时的样子 → 草稿）、并且和大纲现在的不一样的（GPT 第二轮 N1：别处改了、这里没动过的线不算）。
export function changedLines(project, review) {
    return editedVolumes(review).filter((v) => {
        let live = project.outline.volumes.find((x) => x.id === v.id);
        return !live || draftDiffers([live], [v]);
    }).map((v) => v.id);
}
// 线级问题卡：「重新整理」「去掉开启条件和时段」「顺序对，确认」这些一键处理照旧页保留。
function lineIssueCard(x, volId) {
    let btn =
        x.fix === 'redraft'
            ? x.lines.map((id) => `<button type="button" class="pi-btn is-sm" data-act="rv-redraft" data-line="${esc(id)}">重新整理 ${esc(id)}</button>`).join('')
            : x.fix === 'drop-open'
              ? `<button type="button" class="pi-btn is-sm" data-act="rv-drop-open" data-vol="${esc(volId)}" title="删掉整条开启条件和开启时段（不是只删多出来的那一项）">去掉开启条件和时段</button>`
              : x.fix === 'tiers'
                ? `<button type="button" class="pi-btn is-sm" data-act="rv-tiers" data-vol="${esc(volId)}" data-tiers="${esc(JSON.stringify(x.tiers))}">顺序对，确认</button>`
                : '';
    return `<div class="pi-rv-issue${x.level === 'error' ? '' : ' is-ask'}"><p>${esc(x.text)}</p>${btn ? `<div class="pi-row">${btn}</div>` : ''}</div>`;
}
// 表格条件表单：表、行、列下拉（从当前数据库读）；读不到表格时换成输入框。下面一行显示这一格现在的值和是否满足。
function tableForm(vol, locked = !1) {
    let l = vol.line || {},
        t = (isPlainObject(l.表格条件草稿) ? { op: '>=', ...l.表格条件草稿 } : null) || simpleTableCond(l.开启条件) || { table: '', row: '', col: '', op: '>=', value: '' },
        tables = currentTables(),
        sheets = tables ? sheetList(tables) : [],
        attr = (k) => `data-rv-vol="${esc(vol.id)}" data-rv-tbl="${k}"${locked ? ' disabled' : ''}`,
        opt = (list, val) => list.map((o) => `<option value="${esc(o.v)}"${o.v === val ? ' selected' : ''}>${esc(o.label)}</option>`).join(''),
        pickOf = (list, val, ph) => opt([{ v: '', label: ph }, ...(val && !list.includes(val) ? [val] : []), ...list].map((x) => (typeof x == 'string' ? { v: x, label: x } : x)), val),
        sheet = sheets.find((x) => x.name === t.table),
        sr = sheet ? sheetRows(sheet) : null,
        cols = sr ? sr.head.slice(1).map((c) => String(c ?? '').trim()).filter(Boolean) : [],
        rows = sr ? sr.rows.map((r) => String(r[1] ?? '').trim()).filter(Boolean) : [],
        field = (k, list, ph) =>
            tables ? `<select class="pi-sel is-sm" ${attr(k)}>${pickOf(list, t[k], ph)}</select>` : `<input class="pi-inp is-sm" ${attr(k)} value="${esc(t[k])}" placeholder="${ph}">`,
        status = '',
        badge = '',
        tierFix = null;
    if (t.table && t.row && t.col) {
        if (!tables) status = '读不到当前的表格（数据库没打开或这张卡没绑表格），保存后到执行页核对。';
        else {
            let errs = [],
                c = t.value !== '' ? parseCondition(tableCondOf(t), errs) : null,
                r = !errs.length && c ? cellCondCheck(c, tables) : null,
                v = r && r.now ? evalAtom(c, { tables }).v : '';
            // 填了档位名、比的是大小，而表格说明给档位编了号：提示改成数字（用户 2026-11-17：「≥ 信任」→「≥ 3」）
            let num = ['>=', '<=', '>', '<'].includes(t.op) ? tierNumberInNote(sheet ? sheet.note : '', t.value) : null;
            num != null && (tierFix = { vol: vol.id, value: String(num) });
            status =
                t.value === ''
                    ? '填上比较的值。'
                    : r
                      ? `${r.now ? `现在：${r.now}` : '现在：表里还没有这一格的值'}${num != null ? `。表格说明里「${t.value}」是 ${num}，比大小请填数字` : r.notes.length ? `。${r.notes[0]}` : ''}`
                      : errs.join('；');
            // 满足 / 未满足：胶囊小标签（用户 2026-11-16：中性表述，带背景色）
            badge = v === 'true' ? '<span class="pi-badge is-ok">已满足</span>' : v === 'false' ? '<span class="pi-badge is-warn">未满足</span>' : '';
        }
    }
    return `<div class="pi-rv-tbl">
      ${field('table', sheets.map((x) => x.name), '选择表')}
      <div class="pi-row pi-rv-tbl-row">${field('row', rows, '选择行')}${field('col', cols, '选择列')}</div>
      <div class="pi-row pi-rv-tbl-row is-cmp"><select class="pi-sel is-sm" ${attr('op')}>${opt(TABLE_OPS, t.op)}</select><input class="pi-inp is-sm" ${attr('value')} value="${esc(t.value)}" placeholder="值，如 2 或 熟悉"></div>
      ${isPlainObject(l.表格条件草稿) ? '<p class="pi-hint is-warn">条件还没填完，保存前要补全。</p>' : ''}${status ? `<p class="pi-hint pi-rv-tbl-now">${esc(status)}${badge}</p>` : '<p class="pi-hint">选好表、行、列，填比较的值。</p>'}${tierFix && !locked ? `<div class="pi-row"><button type="button" class="pi-btn is-sm" data-act="rv-tbl-num" data-vol="${esc(tierFix.vol)}" data-value="${esc(tierFix.value)}">改成 ${esc(tierFix.value)}</button></div>` : ''}
    </div>`;
}
// 开启时段（只给支线）：限定在某条主线的某几个阶段里才能开始。
function windowField(project, vol, locked = !1) {
    let l = vol.line || {},
        mains = compileClue(project.outline.volumes).lines.filter((m) => m.kind === 'main');
    if (!mains.length) return '';
    let win = isPlainObject(l.开启时段) ? l.开启时段 : {},
        cur = mains.find((m) => m.id === String(win.主线 || '').trim()),
        opt = (list, val) => list.map((o) => `<option value="${esc(o.value)}"${o.value === val ? ' selected' : ''}>${esc(o.label)}</option>`).join(''),
        stages = (m) => [{ value: '', label: '不限' }, ...m.units.map((u) => ({ value: splitStageKey(u.stage.key).short || stageLabel(u.stage.key), label: stageLabel(u.stage.key) }))];
    return `<div class="pi-field"><span>时段</span><div class="pi-row pi-rv-win${locked ? ' is-locked' : ''}"><select class="pi-sel is-sm" data-rv-vol="${esc(vol.id)}" data-rv-win="主线"${locked ? ' disabled' : ''}>${opt([{ value: '', label: '不限' }, ...mains.map((m) => ({ value: m.id, label: lineTitle(m.volume) }))], cur ? cur.id : '')}</select>
      ${cur ? `从 <select class="pi-sel is-sm" data-rv-vol="${esc(vol.id)}" data-rv-win="从">${opt(stages(cur), String(win.从 || ''))}</select> 到 <select class="pi-sel is-sm" data-rv-vol="${esc(vol.id)}" data-rv-win="到">${opt(stages(cur), String(win.到 || ''))}</select>` : ''}</div></div>`;
}
// 「好几条支线」导入的线级检查（和旧逐条审阅页同一套：依赖不导入的线、开启条件和表格、编出来的开启条件、重复内容、没读到场景）。
// 返回 { 卷 id: [问题…] }，问题放在这条线的线页上。
export function lineLevelIssues(view, job, review) {
    if (!review.lines) return {};
    let ids = review.lineIds || {},
        drop = new Set(review.dropped || []),
        project = view.project(),
        adoptedSet = new Set(Object.keys(review.adoptedLines || {})),
        items = review.draft.map((v) => ({ id: ids[v.id] || String((v.line || {}).编号 || ''), vol: v, dropped: drop.has(v.id) })),
        checks = reviewCheck(view, items, { src: 'import', jobId: job.id }),
        out = {};
    for (let x of items) {
        if (x.dropped || adoptedSet.has(x.vol.id) || !checks[x.id]) continue;
        // 编号和项目里已有的线撞了：保存时会自动换号（reidLines），这里不算问题
        out[x.vol.id] = checks[x.id].issues.filter((i) => !/编号「[^」]+」和别的线重复/.test(i.text));
    }
    return out;
}
// 保存按钮写明范围（GPT 第二轮界面审阅）：改已有线时数改过的线；「好几条支线」导入时数还要保存的线（不导入、已保存的不算）。
// 审阅页顶部的灰字状态（第四批）：项目级审阅写明几条线、几条待保存
function stateLine(review, dirtyIds, dirty) {
    let edit = review.source !== 'import' || review.reopened;
    if (edit && review.draft.length > 1) return `本项目 ${review.draft.length} 条线，${dirtyIds.length ? `${dirtyIds.length} 条待保存` : '和大纲一致'}`;
    if (review.lines) return `导入的支线 ${review.draft.length} 条，${saveCount(review)} 条待保存`;
    return dirty ? '草稿已保存，未应用到大纲' : '和大纲一致';
}
function saveCount(review, dirtyIds = []) {
    return review.lines ? review.draft.filter((v) => !lineLocked(review, v.id)).length : (review.source !== 'import' || review.reopened) && review.draft.length > 1 ? dirtyIds.length : 0;
}
function saveLabel(review, dirtyIds) {
    let n = saveCount(review, dirtyIds);
    return n ? `保存到大纲（${n} 条线）` : '保存到大纲';
}
// 发送意见按钮（用户 2026-11-16：按钮要写明会发送）。点了先弹预览框，可改意见、加整体意见。
const sendLabel = (n) => (n ? `发送意见（${n} 页）` : '发送意见');
export function renderReview(view, job, review, index, crumb, notes = []) {
    let units = reviewUnits(view.project(), review),
        issues = reviewIssues(view, review, index),
        changed = new Set(draftChanges(review.base, review.draft).map((c) => c.key)),
        at = Math.max(0, Math.min(units.length - 1, review.at || 0)),
        u = units[at],
        vol = review.draft.find((v) => v.id === u.volumeId),
        busy = view.busy[`review:${view.projectId}`],
        errCount = Object.values(issues).flat().filter((x) => x.level === 'error').length,
        askCount = Object.values(issues).flat().filter((x) => x.level !== 'error').length,
        pending = sendableNotes(view.project(), review).length,
        last = (review.lastChanges || {})[u.key],
        // 多条线（用户 2026-11-16 第二批）：页码只列当前这条线的页；上面一行选线
        mineUnits = units.map((x, i) => ({ ...x, i })).filter((x) => x.volumeId === u.volumeId),
        lineFirst = mineUnits[0] && mineUnits[0].kind === 'line',
        dot = (x, n) => {
            let i = x.i,
                has = (issues[x.key] || []).some((y) => y.level === 'error'),
                cls = (i === at ? ' is-cur' : has ? ' is-err' : changed.has(x.key) && review.revised ? ' is-chg' : '') + (String((review.comments || {})[x.key] || '').trim() ? ' is-note' : '');
            // 页签（第四批，用户 2026-11-16）：线信息 / 阶段名，代替数字圆点；多了横向滑动
            void n;
            return `<button type="button" class="pi-rv-dot${cls}" data-act="rv-go" data-i="${i}">${x.kind === 'line' ? '线信息' : esc(stageLabel(unitValue(review.draft, x.key).key))}</button>`;
        },
        vols = review.draft,
        vi = vols.findIndex((v) => v.id === vol.id),
        dropSet = new Set(review.dropped || []),
        isDrop = dropSet.has(vol.id),
        adoptedHere = review.lines && (review.adoptedLines || {})[vol.id],
        goneHere = !review.lines && lineLocked(review, vol.id, view.project()),
        locked = lineLocked(review, vol.id, view.project()),
        ro = locked ? ' disabled' : '',
        lineIssues = review.lines ? lineLevelIssues(view, job, review)[vol.id] || [] : [],
        firstOf = (v) => units.findIndex((x) => x.volumeId === v.id),
        picker =
            vols.length > 1
                ? `<div class="pi-rv-line"><button type="button" class="pi-rv-arr" data-act="rv-go" data-i="${vi > 0 ? firstOf(vols[vi - 1]) : at}"${vi > 0 ? '' : ' disabled'} title="上一条">‹</button><button type="button" class="pi-rv-lname" data-act="rv-lines" title="选择其他线"><b${isDrop ? ' class="is-drop"' : ''}>${esc(lineTitle(vol))}</b><span>${vi + 1} / ${vols.length}${isDrop ? '，不导入' : adoptedHere ? '，已保存' : ''}</span></button><button type="button" class="pi-rv-arr" data-act="rv-go" data-i="${vi < vols.length - 1 ? firstOf(vols[vi + 1]) : at}"${vi < vols.length - 1 ? '' : ' disabled'} title="下一条">›</button></div>`
                : '',
        comment = (review.comments || {})[u.key] || '',
        mine = issues[u.key] || [],
        filled = (x) => comment.includes(issueCommentLine(x).trim()),
        isEdit = review.source === 'proposal',
        dirtyIds = changedLines(view.project(), review),
        dirty = !(isEdit || review.reopened) || dirtyIds.length > 0,
        full = !!review.fullOpen,
        clueOn = reviewIsClue(view.project(), review),
        // 问题标题旁的「全部加入意见」（第四批：从底部挪上来）
        fillAll = `<button type="button" class="pi-rv-fillall" data-act="rv-fill-all">全部加入意见</button>`,
        // 改已有线、和大纲一致：保存按钮变灰（第四批）
        synced = !dirty && (isEdit || review.reopened),
        // 顶部（第四批）：标题一行，问题数在右；下面一句灰字说明范围和状态（项目级审阅写明几条线、几条待保存）
        stateText = stateLine(review, dirtyIds, dirty),
        head = `<h3>${isEdit ? '审阅修改' : '审阅'}${vols.length > 1 ? (review.lines ? '：导入的支线' : '') : `：${esc(volumeName(vol.key))}`}<span class="pi-rv-end">${errCount ? `<button type="button" class="pi-badge is-warn pi-rv-issues" data-act="rv-first-issue" title="跳到有问题的页">问题 ${errCount} ›</button>` : review.revised ? '<span class="pi-badge is-ok">检查通过</span>' : ''}</span></h3><div class="pi-rv-state${dirty ? ' is-draft' : ''}">${stateText}</div>${picker}`,
        nav = `<div class="pi-rv-nav"><div class="pi-rv-dots">${mineUnits.map(dot).join('')}</div></div>`,
        body = '';
    if (u.kind === 'line') {
        let l = vol.line,
            main = String(l.类型 || '').trim() === '主线',
            pick = whenPick(l),
            raw = clueText(l.开始时机原文);
        body = `<div class="pi-rv-title"><b>线</b><span class="pi-badge is-accent">${main ? '主线' : '支线'}${l.编号 ? ` ${esc(l.编号)}` : ''}</span>${review.lines && !adoptedHere ? `<button type="button" class="pi-icon-btn pi-rv-end" data-act="rv-line-menu" data-vol="${esc(vol.id)}" title="更多">${ICONS.more}</button>` : ''}</div>
          ${isDrop ? '<p class="pi-hint is-warn">这条本次不导入，保存时不会加进大纲。可以在右上角「更多」里撤回。</p>' : ''}
          ${adoptedHere ? `<div class="pi-rv-locked"><p class="pi-hint">这条已经保存到大纲（${esc(adoptedHere)}），这里只读。</p><button type="button" class="pi-btn is-sm" data-act="rv-edit-saved" data-vol="${esc(vol.id)}">到大纲审阅修改</button></div>` : ''}
          ${goneHere ? '<p class="pi-hint is-warn">这条线在大纲里已经删掉了。这里的草稿和意见只读，不会写回大纲。</p>' : ''}
          ${lineIssues.length ? `<div class="pi-rv-sec">问题（${lineIssues.length}）${errCount + askCount && !locked ? fillAll : ''}</div>${lineIssues.map((x) => lineIssueCard(x, vol.id)).join('')}` : ''}
          <label class="pi-field"><span>简介</span><input class="pi-inp pi-rv-inp" data-rv-vol="${esc(vol.id)}" data-rv-line="简介" value="${esc(clueText(l.简介))}"${ro}><span class="pi-hint">供作者识别这条线，在执行页显示。</span></label>
          <label class="pi-field"><span>剧情入口</span><input class="pi-inp pi-rv-inp" data-rv-vol="${esc(vol.id)}" data-rv-line="入口提示" value="${esc(clueText(l.入口提示))}" placeholder="例：叶莲娜发来消息，说烘焙铺有人需要帮忙"${ro}><span class="pi-hint">可开启时给正文的由头，不代表事情已经发生。</span></label>
          <div class="pi-field"><span>开始条件</span>
            ${pick || review.source !== 'import' ? `<div class="pi-rv-when">${esc(whenText(l, review.draft) || '无额外条件')}${raw ? `<br><span class="pi-hint">原文：「${esc(raw)}」</span>` : ''}</div>` : `<div class="pi-rv-when is-warn">文档未写开始条件，请选择。${raw ? `<br><span class="pi-hint">原文：「${esc(raw)}」</span>` : ''}</div>`}
            <div class="pi-rv-opts">${WHEN.filter((w) => (w.v !== 'after' || main) && (w.v !== 'keep' || complexCond(l.开启条件) || complexCond(l.保留条件)))
                .map((w) => `<label class="pi-check"><input type="radio" name="rv-when" data-rv-vol="${esc(vol.id)}" data-rv-when="${w.v}"${pick === w.v ? ' checked' : ''}${ro}><span>${w.label}</span></label>`)
                .join('')}</div>${pick === 'table' ? tableForm(vol, locked) : ''}</div>
          ${review.lines && !main ? windowField(view.project(), vol, locked) : ''}`;
    } else {
        let s = unitValue(review.draft, u.key),
            nodes = stageNodes(s.data).filter((n) => n.kind !== 'world'),
            errs = mine.filter((x) => x.level === 'error'),
            asks = mine.filter((x) => x.level !== 'error'),
            answered = (review.dismissed || []).length + (review.shortsSure || []).length + (review.shortsNot || []).length;
        let main = nodes.filter((n) => n.kind === 'main'),
            side = nodes.filter((n) => n.kind !== 'main'),
            time = !clueOn && clueText(s.data && s.data.时间范围);
        body = `<div class="pi-rv-title"><b>${esc(stageLabel(s.key))}</b><span class="pi-meta">${time ? `时间：${esc(cut(time, 20))}` : `${nodes.length} 个场景`}</span>${changed.has(u.key) && review.revised ? '<span class="pi-badge is-accent">已修改</span>' : ''}${nodes.length ? `<button type="button" class="pi-btn is-sm is-ghost pi-rv-fulltg pi-rv-end" data-act="rv-full">${full ? '收起完整内容' : '展开完整内容'}</button>` : ''}</div>
          ${(() => {
              let names = condNames([...view.project().outline.volumes, ...review.draft]),
                  one = (n) => (full ? nodeFull(n, clueOn, names) : nodeLine(n, clueOn));
              return clueOn ? nodes.map(one).join('') : main.map(one).join('') + (side.length ? `<div class="pi-rv-sec">支线</div>${side.map(one).join('')}` : '');
          })()}
          ${nodes.length ? '' : '<p class="pi-hint is-warn">本阶段没有读到节点。</p>'}
          ${last && last.length ? `<div class="pi-rv-sec">本次修改</div>${last.map((t) => `<div class="pi-rv-chg">${esc(t)}</div>`).join('')}` : ''}
          ${errs.length ? `<div class="pi-rv-sec">问题（${errs.length}）${fillAll}</div>${errs.map((x) => issueCard(x, u.key, filled(x))).join('')}` : ''}
          ${asks.length ? `<div class="pi-rv-sec">待确认（${asks.length}）${errs.length ? '' : fillAll}</div>${asks.map((x) => issueCard(x, u.key, filled(x))).join('')}` : ''}
          ${answered ? `<div class="pi-row pi-rv-answered"><span class="pi-hint">已确认 ${answered} 项</span><button type="button" class="pi-btn is-sm is-ghost" data-act="rv-undismiss">撤回</button></div>` : ''}`;
    }
    let yamlText = u.kind === 'line' ? stringifyYaml({ [VOLUME_LINE_KEY]: vol.line }) : stringifyYaml({ [unitValue(review.draft, u.key).key]: unitValue(review.draft, u.key).data }),
        canUndo = review.history && review.history.length;
    let topNotes = notes.length ? `<details class="pi-rv-notes"><summary class="pi-hint">整理时的提示（${notes.length}）</summary>${notes.map((t) => `<p class="pi-hint">${esc(t)}</p>`).join('')}</details>` : '';
    return `${crumb}<div class="pi-card pi-rv${isDrop ? ' is-drop' : ''}">${head}${topNotes}${nav}${body}
        ${canUndo ? `<div class="pi-row pi-rv-undo"><button type="button" class="pi-btn is-sm is-ghost" data-act="rv-undo">撤销上次修改</button><span class="pi-hint">（${esc(review.history[review.history.length - 1].label)}）</span></div>` : ''}
        ${
             locked
                 ? `${comment.trim() ? `<div class="pi-field"><span>意见（未发送，只读）</span><textarea class="pi-ta" rows="3" readonly>${esc(comment)}</textarea></div>` : ''}<details><summary class="pi-hint">YAML</summary><pre class="pi-pre is-full">${esc(yamlText)}</pre></details>`
                 : `<label class="pi-field"><span>意见</span><textarea class="pi-ta" rows="3" data-rv-comment="${esc(u.key)}" placeholder="对这一页的修改意见">${esc(comment)}</textarea></label>
        <details${review.yamlOpen === u.key ? ' open' : ''}><summary class="pi-hint">编辑 YAML</summary><textarea class="pi-ta is-mono pi-rv-yaml" data-rv-yaml="${esc(u.key)}">${esc(yamlText)}</textarea>
          <div class="pi-tools is-c1"><button type="button" class="pi-btn is-sm" data-act="rv-yaml-save" data-unit="${esc(u.key)}">保存并检查</button></div><p class="pi-status" data-rv-yaml-status></p></details>`
         }
        <div class="pi-rv-foot"><button type="button" class="pi-btn${pending ? ' is-primary' : ''}" data-act="rv-preview"${busy ? ' disabled' : ''}>${busy ? '<span class="pi-spin"></span>修改中' : sendLabel(pending)}</button>${
            synced
                ? '<button type="button" class="pi-btn" data-act="import-adopt" disabled>已与大纲一致</button>'
                : `<button type="button" class="pi-btn${pending ? '' : ' is-primary'}" data-act="import-adopt">${saveLabel(review, dirtyIds)}</button>`
        }</div></div>`;
}

export function renderAdopted(view, job, review, crumb) {
    let vol = review.draft[0],
        project = view.project(),
        live = project.outline.volumes.find((v) => v.id === (review.adoptedId || vol.id)),
        l = live && isPlainObject(live.line) ? live.line : null,
        when = l ? whenText(l, project.outline.volumes) : '',
        unsent = Object.values(review.comments || {}).filter((t) => String(t || '').trim()).length,
        unsentNote = unsent ? `<p class="pi-hint">还有 ${unsent} 页意见没发送，点「继续修改」可以接着看和发送。</p>` : '';
    if (review.source === 'proposal')
        return `${crumb}<div class="pi-card pi-rv"><h3>审阅修改：${esc(volumeName(vol.key))}<span class="pi-spacer"></span></h3>
        <div class="pi-rv-ok">✓ 已保存到大纲：${esc(l && l.编号 ? `${l.编号} ` : '')}${esc(volumeName((live || vol).key))}</div>${unsentNote}
        <div class="pi-tools is-c2 is-end"><button type="button" class="pi-btn" data-act="rv-reopen">继续修改</button><button type="button" class="pi-btn is-primary" data-act="rv-to-outline">查看大纲</button></div></div>`;
    return `${crumb}<div class="pi-card pi-rv"><h3>审阅：${esc(volumeName(vol.key))}<span class="pi-spacer"></span></h3>
        <div class="pi-rv-ok">✓ 已保存到大纲：${esc(l && l.编号 ? `${l.编号} ` : '')}${esc(volumeName((live || vol).key))}（${(live || vol).stages.length} 个阶段）</div>
        ${when ? `<p class="pi-hint">开始时机：${esc(when)}。</p>` : ''}${unsentNote}
        <div class="pi-tools is-c2 is-end"><button type="button" class="pi-btn" data-act="rv-reopen">继续修改</button><button type="button" class="pi-btn is-primary" data-act="rv-to-outline">查看大纲</button></div></div>`;
}

// ---------------- 操作 ----------------
// 改会话：写进导入任务文件（草稿自动保存）。jobOf 由 long-import.js 传入（核对任务属于当前项目）。
export async function saveReview(view, jobId, fn) {
    await view.data.imports.update(jobId, (j) => ({ ...j, review: fn(j.review) }));
}

// 直接改 YAML：用户自己写的，只放一个阶段（或线头）；和模型回复用同一个读取函数。
function unitYamlParse(key, text, want = '') {
    return parseUnitReply(key, text, want);
}
// 回写一个单位（身份由程序定，GPT 审阅 R2）。线头只允许改这些字段，编号永远保留。
// 「类型」（主线 / 支线）不在里面：只在新建时选，之后程序固定（用户 2026-11-16，牵动主线互斥、接上一条、开启时段、支线名额）
const LINE_EDITABLE = ['简介', '入口提示', '开启条件', '开启方式', '开启时段', '接上一条', '开始时机原文', '开始时机已选'];
export function putUnit(volumes, key, parsed) {
    let [vid, sid] = key.split('/');
    if (sid !== 'line') return putStage(volumes, vid, sid, parsed.stage);
    let before = volumes.find((v) => v.id === vid),
        incoming = isPlainObject(parsed.line) ? parsed.line : {},
        // 「原开启条件」是开线事实的登记依据（给事实标签用）：这次明确写了就用新的；没写就保留旧的，不当成删掉（GPT 第五轮 C3）
        orig = '原开启条件' in incoming && incoming.原开启条件 != null && String(incoming.原开启条件).trim() !== '' ? incoming.原开启条件 : null;
    return putLine(volumes, vid, incoming, LINE_EDITABLE).map((v) =>
        v.id === vid ? { ...v, line: settleWhen(before && before.line, orig == null ? v.line : { ...v.line, 原开启条件: orig }) } : v,
    );
}
// YAML / AI 换了开始条件：表单状态以新条件为准（第四轮 N1）。条件没变（只改简介等）时不动，填到一半的表格还在。
const WHEN_KEYS = ['开启条件', '开启方式', '接上一条'];
function settleWhen(old, line) {
    if (!isPlainObject(line) || WHEN_KEYS.every((k) => stableText((old || {})[k]) === stableText(line[k]))) return line;
    let l = { ...line };
    delete l.表格条件草稿;
    simpleTableCond(l.开启条件) ? (l.开始方式表格 = !0) : delete l.开始方式表格;
    complexCond(l.开启条件) && delete l.保留条件;
    return l;
}

export function reviewActions({ jobOf, crumbBack, redraftLine, openSaved = null }) {
    let current = (view) => {
            let jobId = view.tabState('import')[view.projectId]?.jobId,
                job = jobOf(view, jobId);
            return job && job.review ? { jobId, job, review: job.review } : null;
        },
        indexOf = (job) => {
            let ok = (job.localIndex || []).filter((x) => isPlainObject(x) && !x.error);
            return ok.length ? mergeImportIndex(ok) : job.index;
        };
    let actions = {
        async 'rv-go'(view, target) {
            let c = current(view);
            c && (await saveReview(view, c.jobId, (r) => ({ ...r, at: Number(target.dataset.i) || 0 })), view.renderBody());
        },
        async 'rv-fill'(view, target) {
            let c = current(view);
            if (!c) return;
            let key = target.dataset.unit,
                x = (reviewIssues(view, c.review, indexOf(c.job))[key] || []).find((y) => y.id === target.dataset.issue);
            x && (await saveReview(view, c.jobId, (r) => ({ ...r, comments: { ...r.comments, [key]: appendComment(r.comments[key], issueCommentLine(x)) } })), view.renderBody());
            let box = [...hostDocument().querySelectorAll('[data-rv-comment]')].find((b) => b.dataset.rvComment === key);
            box && x && x.level !== 'error' && (box.focus(), box.setSelectionRange(box.value.length, box.value.length));
        },
        // 疑似短名：是同一人 → 当保密名字（下一次检查报成要改的问题）；不是 → 不再提示。都可以在「已确认」里撤回。
        async 'rv-short'(view, target) {
            let c = current(view);
            if (!c) return;
            let name = target.dataset.name,
                yes = target.dataset.v === 'yes';
            await saveReview(view, c.jobId, (r) => ({
                ...r,
                shortsSure: yes ? [...new Set([...(r.shortsSure || []), name])] : (r.shortsSure || []).filter((n) => n !== name),
                shortsNot: yes ? (r.shortsNot || []).filter((n) => n !== name) : [...new Set([...(r.shortsNot || []), name])],
            }));
            view.renderBody();
            yes && toast('info', `「${name}」按保密名字检查，出现的地方会列进问题，可以一键加入意见。`);
        },
        // 待确认收起（用户 2026-11-17）：记在这份审阅里，「已确认」里可以撤回
        async 'rv-dismiss'(view, target) {
            let c = current(view);
            c && (await saveReview(view, c.jobId, (r) => ({ ...r, dismissed: [...new Set([...(r.dismissed || []), target.dataset.issue])] })), view.renderBody());
        },
        async 'rv-undismiss'(view) {
            let c = current(view);
            c && (await saveReview(view, c.jobId, (r) => ({ ...r, dismissed: [], shortsSure: [], shortsNot: [] })), view.renderBody());
        },
        // 表格条件的档位名换成说明里的数字（只改值，表、行、列、比较方式不动）
        async 'rv-tbl-num'(view, target) {
            let c = current(view);
            if (!c) return;
            let vid = target.dataset.vol,
                value = target.dataset.value;
            await saveReview(view, c.jobId, (r) =>
                editDraft(r, '改表格条件', (d) =>
                    d.map((v) => {
                        if (v.id !== vid) return v;
                        let line = { ...(v.line || {}) },
                            t = isPlainObject(line.表格条件草稿) ? { op: '>=', ...line.表格条件草稿 } : simpleTableCond(line.开启条件);
                        if (!t) return v;
                        t = { ...t, value };
                        t.table && t.row && t.col ? ((line.开启条件 = tableCondOf(t)), delete line.表格条件草稿) : (line.表格条件草稿 = t);
                        return { ...v, line };
                    }),
                ),
            );
            view.renderBody();
        },
        // 标题上的「问题 N」：跳到下一个有问题的页（从当前页往后找，到底再从头）
        async 'rv-first-issue'(view) {
            let c = current(view);
            if (!c) return;
            let units = reviewUnits(view.project(), c.review),
                issues = reviewIssues(view, c.review, indexOf(c.job)),
                at = c.review.at || 0,
                bad = units.map((u, i) => ((issues[u.key] || []).some((x) => x.level === 'error') ? i : -1)).filter((i) => i >= 0),
                next = bad.find((i) => i > at) ?? bad[0];
            next != null && (await saveReview(view, c.jobId, (r) => ({ ...r, at: next })), view.renderBody());
        },
        async 'rv-fill-all'(view) {
            let c = current(view);
            if (!c) return;
            let all = reviewIssues(view, c.review, indexOf(c.job));
            await saveReview(view, c.jobId, (r) => {
                let comments = { ...r.comments };
                for (let [key, list] of Object.entries(all)) for (let x of list) x.level === 'error' && !lineLocked(r, key.split('/')[0], view.project()) && (comments[key] = appendComment(comments[key], issueCommentLine(x)));
                return { ...r, comments };
            });
            view.renderBody();
            toast('info', '各页的问题已加入意见。待确认的问题需要在意见里填写回答。');
        },
        // 点线名：列出所有线和状态（问题几个、有意见、已修改），选一条跳过去
        async 'rv-lines'(view) {
            let c = current(view);
            if (!c) return;
            let review = c.review,
                project = view.project(),
                units = reviewUnits(project, review),
                issues = reviewIssues(view, review, indexOf(c.job)),
                dirty = new Set(changedLines(project, review)),
                edit = review.source && review.source !== 'import',
                mark = (v) => {
                    let keys = units.filter((u) => u.volumeId === v.id).map((u) => u.key),
                        errs = keys.reduce((n, k) => n + (issues[k] || []).filter((x) => x.level === 'error').length, 0),
                        notes = keys.filter((k) => String((review.comments || {})[k] || '').trim()).length;
                    return [errs ? `问题 ${errs}` : '', notes ? `意见 ${notes} 页` : '', edit && dirty.has(v.id) ? '已修改' : ''].filter(Boolean).join('，');
                },
                pick = await menuDialog({
                    title: reviewIsClue(project, review) ? '选择剧情线' : '选择卷',
                    items: review.draft.map((v) => ({ value: v.id, label: `${lineTitle(v)}　${v.stages.length} 个阶段${mark(v) ? `（${mark(v)}）` : ''}` })),
                });
            if (!pick) return;
            let i = units.findIndex((u) => u.volumeId === pick);
            i >= 0 && (await saveReview(view, c.jobId, (r) => ({ ...r, at: i })), view.renderBody());
        },
        // 「好几条支线」导入：线页右上角「更多」——本次不导入 / 撤回、重新整理这一条
        async 'rv-line-menu'(view, target) {
            let c = current(view);
            if (!c) return;
            let vid = target.dataset.vol,
                review = c.review,
                id = (review.lineIds || {})[vid],
                dropped = (review.dropped || []).includes(vid),
                pick = await menuDialog({
                    title: id || '这条线',
                    items: [
                        { value: 'redraft', label: '重新整理这一条' },
                        dropped ? { value: 'undrop', label: '撤回：这条要导入' } : { value: 'drop', label: '本次不导入这一条', danger: !0 },
                    ],
                });
            if (!pick) return;
            if (pick === 'redraft') return actions['rv-redraft'](view, { dataset: { line: id } });
            await saveReview(view, c.jobId, (r) => ({ ...r, dropped: pick === 'drop' ? [...new Set([...(r.dropped || []), vid])] : (r.dropped || []).filter((x) => x !== vid) }));
            view.renderBody();
        },
        async 'rv-redraft'(view, target) {
            let c = current(view);
            if (!c) return;
            let id = target.dataset.line,
                res = null;
            await runTask(view, `review:${view.projectId}`, async () => (res = await redraftLine(view, c.jobId, id))).catch((error) => toast('error', `重新整理中断：${error.message}`));
            if (res && res.ok) {
                let r = view.data.imports.get(c.jobId).review,
                    vid = Object.keys(r.lineIds || {}).find((k) => r.lineIds[k] === id),
                    i = reviewUnits(view.project(), r).findIndex((u) => u.volumeId === vid);
                i >= 0 && (await saveReview(view, c.jobId, (x) => ({ ...x, at: i })));
            }
            res && toast(res.ok ? 'success' : 'warning', res.ok ? `已重新整理 ${id}，原来的内容可以在线页下面展开对照。` : `没有重新整理 ${id}：${res.why}。`);
            view.renderBody();
        },
        async 'rv-drop-open'(view, target) {
            let c = current(view),
                vid = target.dataset.vol;
            c && (await saveReview(view, c.jobId, (r) => editDraft(r, '去掉开启条件和时段', (d) => d.map((v) => (v.id === vid ? { ...v, line: Object.fromEntries(Object.entries(v.line || {}).filter(([k]) => k !== '开启条件' && k !== '开启时段')) } : v)))), view.renderBody());
        },
        async 'rv-tiers'(view, target) {
            let c = current(view),
                vid = target.dataset.vol,
                tiers = JSON.parse(target.dataset.tiers || '[]');
            c && (await saveReview(view, c.jobId, (r) => editDraft(r, `确认档位顺序 ${tiers.join(' < ')}`, (d) => d.map((v) => (v.id === vid ? confirmTierOrder([v], tiers)[0] : v)))), view.renderBody());
        },
        // 已保存的线：到大纲的审阅修改里接着改（打开项目的审阅修改，定位到这条线）
        async 'rv-edit-saved'(view, target) {
            let c = current(view);
            if (!c) return;
            let id = (c.review.adoptedLines || {})[target.dataset.vol],
                live = id && view.project().outline.volumes.find((v) => isPlainObject(v.line) && String(v.line.编号 || '').trim() === id);
            if (!live) return toast('warning', '大纲里找不到这条线了（可能删掉了或改了编号）。');
            openSaved && (await openSaved(view, live.id));
        },
        async 'rv-full'(view) {
            let c = current(view);
            c && (await saveReview(view, c.jobId, (r) => ({ ...r, fullOpen: !r.fullOpen })), view.renderBody());
        },
        async 'rv-undo'(view) {
            let c = current(view);
            c && (await saveReview(view, c.jobId, (r) => ({ ...undoDraft(r), lastChanges: {} })), view.renderBody());
        },
        async 'rv-yaml-save'(view, target) {
            let c = current(view);
            if (!c) return;
            if (lineLocked(c.review, String(target.dataset.unit || '').split('/')[0], view.project())) return toast('info', '这条线只读。');
            let key = target.dataset.unit,
                box = target.closest('details').querySelector('[data-rv-yaml]'),
                status = target.closest('details').querySelector('[data-rv-yaml-status]'),
                parsed;
            try {
                parsed = unitYamlParse(key, box.value);
            } catch (error) {
                return ((status.textContent = `没有保存：${error.message}`), status.classList.add('is-err'));
            }
            await saveReview(view, c.jobId, (r) => ({ ...editDraft(r, '直接改 YAML', (d) => putUnit(d, key, parsed)), yamlOpen: key }));
            view.renderBody();
        },
        // 预览意见（用户 2026-11-16）：各页意见汇总可改，加整体意见、附带讨论记录，一次发送。
        async 'rv-preview'(view) {
            let box0 = hostDocument().querySelector('.pi-rv [data-rv-comment]');
            box0 && (await reviewOnInput(view, box0, jobOf, { blur: !0 }));
            let c = current(view);
            if (!c) return;
            let review = c.review,
                units = reviewUnits(view.project(), review),
                labelOf = (key) => unitTitle(review, key),
                sendKeys = new Set(sendableNotes(view.project(), review)),
                list = units.filter((u) => sendKeys.has(u.key)),
                // 整体意见只改当前这条线（用户 2026-11-16，GPT 第二轮 N3）
                curVol = review.draft.find((v) => v.id === (units[Math.max(0, Math.min(units.length - 1, review.at || 0))] || units[0]).volumeId),
                curLocked = !curVol || lineLocked(review, curVol.id, view.project()),
                chat = await view.data.loadChat(view.projectId).catch(() => null),
                hasTalk = !!(chat && (chat.summary || (chat.messages || []).length)),
                stages = curVol ? curVol.stages.length : 0,
                curName = curVol ? (review.draft.length > 1 ? lineTitle(curVol) : reviewIsClue(view.project(), review) ? '这条线' : '这一卷') : '',
                html = `<p class="pi-hint">以下意见一次发给 AI，改完的内容先进草稿，确认后再保存到大纲。可在此修改；点标题返回对应页。</p>
                ${list.map((u) => `<div class="pi-rv-q"><button type="button" class="pi-rv-q-go" data-dlg-value="go:${esc(u.key)}">${esc(labelOf(u.key))} ›</button><textarea class="pi-ta" rows="2" data-rv-q="${esc(u.key)}">${esc(review.comments[u.key])}</textarea></div>`).join('') || '<p class="pi-hint">各页还没有意见。</p>'}
                ${
                     curLocked
                         ? ''
                         : `<label class="pi-field"><span>对 ${esc(curName)} 的整体意见（可选）</span><textarea class="pi-ta" rows="2" data-rv-overall placeholder="例：人名统一；入口语气更轻松">${esc(review.overall || '')}</textarea></label>
                <p class="pi-hint">整体意见只改${esc(curName)}，会发送它的全部内容（${stages} 个阶段），请求较长。别的线请在对应页写意见。</p>`
                 }
                ${hasTalk ? `<label class="pi-check"><input type="checkbox" data-rv-talk${review.noTalk ? '' : ' checked'}><span>附带讨论记录</span></label>` : ''}`,
                read = (root) => ({
                    comments: Object.fromEntries([...root.querySelectorAll('[data-rv-q]')].map((b) => [b.dataset.rvQ, b.value])),
                    overall: root.querySelector('[data-rv-overall]') ? root.querySelector('[data-rv-overall]').value : '',
                    talk: hasTalk ? root.querySelector('[data-rv-talk]').checked : !1,
                }),
                typed = null,
                pick = await openDialog({
                    title: '发送意见',
                    html,
                    // 点标题回到那一页之前，先记下框里改过的内容（GPT 第二轮 N6）
                    onMount: (root) => root.addEventListener('click', (e) => e.target.closest('[data-dlg-value]') && (typed = read(root)), !0),
                    actions: [
                        { label: '返回', value: (root) => ({ ...read(root), act: 'back' }) },
                        { label: '发送', primary: !0, value: (root) => ({ ...read(root), act: 'send' }) },
                    ],
                });
            if (!pick) return;
            let goKey = typeof pick === 'string' && pick.startsWith('go:') ? pick.slice(3) : '';
            if (goKey) {
                let i = units.findIndex((u) => u.key === goKey);
                return (
                    await saveReview(view, c.jobId, (r) => ({ ...r, ...(typed ? { comments: { ...r.comments, ...typed.comments }, overall: typed.overall, noTalk: hasTalk && !typed.talk } : {}), at: i < 0 ? r.at : i })),
                    view.renderBody()
                );
            }
            await saveReview(view, c.jobId, (r) => ({ ...r, comments: { ...r.comments, ...pick.comments }, overall: pick.overall, noTalk: hasTalk && !pick.talk }));
            if (pick.act !== 'send') return view.renderBody();
            let c2 = current(view);
            if (!sendableNotes(view.project(), c2.review).length && !String(pick.overall || '').trim()) return toast('info', '没有要发送的意见。');
            let talk = pick.talk && chat ? transcript(chat.summary, chat.messages, 8e3) : '',
                projectId = view.projectId;
            await runTask(view, `review:${projectId}`, () => reviseUnits(view, c2.jobId, c2, indexOf(c2.job), jobOf, { overall: curLocked ? '' : pick.overall, overallVol: curVol && curVol.id, talk })).catch((e) => toast('error', `修改中断：${e.message}。意见保留，可重试。`));
            view.renderBody();
        },

        async 'rv-reopen'(view) {
            let c = current(view);
            if (!c) return;
            let project = view.project(),
                live = project.outline.volumes.find((v) => v.id === c.review.adoptedId);
            if (!live) return toast('warning', '大纲里找不到这条线了（可能删掉了）。');
            let edit = c.review.source === 'proposal';
            // 保存时没发送的意见带过来（GPT 第二轮 N6）：保存后卷 id 换成了大纲里的，阶段 id 不变，按阶段 id 对回去
            let carry = Object.fromEntries(
                    Object.entries(c.review.comments || {})
                        .filter(([, t]) => String(t || '').trim())
                        .map(([k, t]) => {
                            let sid = k.split('/')[1];
                            return [sid === 'line' || live.stages.some((s) => s.id === sid) ? `${live.id}/${sid}` : '', t];
                        })
                        .filter(([k]) => k),
                );
            await saveReview(view, c.jobId, () => ({ ...createReviewSession({ source: edit ? 'proposal' : 'project', projectId: project.id, jobId: c.jobId, volumes: [live] }), comments: carry, at: 0, reopened: !0, adoptedId: live.id, mode: isClueMode(project) ? 'clue' : 'outline', ...(edit ? { liveAt: JSON.stringify(live) } : {}) }));
            view.renderBody();
        },
        'rv-to-outline'(view) {
            let c = current(view);
            crumbBack(view, c && c.review && c.review.adoptedId);
        },
    };
    return actions;
}

// 按意见修改（用户 2026-11-16：所有意见一次发送，只调一次 API）。
//   请求：有意见的单位 + 组外相关的只读上下文；写了整体意见时，整条线的所有单位都给（只输出改了的）。
//   应用：仍按实际引用分组判断（GPT 审阅 R4）——一组里有漏回、解析失败、期间被改过的，整组不用；互不相关的组分别应用。
//   opts：{ overall, talk }（整体意见、讨论记录）。
async function reviseUnits(view, jobId, c, index, jobOf, opts = {}) {
    let review = c.review,
        units = reviewUnits(view.project(), review),
        overall = String(opts.overall || '').trim(),
        commented = sendableNotes(view.project(), review),
        // 整体意见只改当前这条线（GPT 第二轮 N3）：它的所有部分 + 别的线上写了意见的页；别的线只按各页意见改
        overallVol = overall ? opts.overallVol || (units[0] && units[0].volumeId) : '',
        want = overall ? [...new Set([...units.filter((u) => u.volumeId === overallVol).map((u) => u.key), ...commented])] : commented;
    if (!want.length) return;
    let project = view.project(),
        clue = reviewIsClue(project, review),
        secrets = [...new Set([...((review.source && review.source !== 'import' ? projectSecretNames(project) : importSecretNames(index)) || []), ...reviewShorts(project, review).shortsSure])],
        notes = review.notes || {},
        src = await view.data.imports.source(jobId).catch(() => ''),
        sourceOf = (key) => {
            let v = unitValue(review.draft, key);
            if (!v || !v.data) return '';
            let n = stageNodes(v.data).map((x) => notes[nodeUid(x.item)]).find((x) => x && x.起 != null);
            return n && src ? sourceExcerpt(src, n.起, n.止) : '';
        },
        // 项目里别的线：查引用时一起算（GPT 代码审阅 R6），只把确有引用的部分作为只读上下文发出去；它们不会被写回
        background = project.outline.volumes.filter((v) => !review.draft.some((d) => d.id === v.id)),
        all = [...background, ...review.draft],
        yamlOf = (key) => {
            let v = unitValue(all, key);
            return key.endsWith('/line') ? stringifyYaml({ [VOLUME_LINE_KEY]: v }) : stringifyYaml({ [v.key]: v.data });
        },
        labelOf = (key) => {
            let mine = review.draft.some((v) => v.id === key.split('/')[0]),
                vol = all.find((v) => v.id === key.split('/')[0]),
                own = key.endsWith('/line') ? '线（开头信息）' : stageLabel(unitValue(all, key).key);
            return mine ? (review.draft.length > 1 ? unitTitle(review, key) : own) : `${volumeLabel(vol.key)} ${key.endsWith('/line') ? '线头' : own}`;
        },
        tables = clue ? currentTables() : null,
        ctx = groupContext(all, want),
        ctxText = ctx.units.filter((k) => !want.includes(k)).map((k) => `【${labelOf(k)}】\n${yamlOf(k)}`).join('\n'),
        snap = Object.fromEntries(want.map((k) => [k, JSON.stringify(unitValue(review.draft, k))])),
        sentComments = Object.fromEntries(commented.map((k) => [k, String((review.comments || {})[k] || '')])),
        reply = await ask(
            view,
            'outline',
            reviewReviseMessages({
                units: want.map((k) => ({ key: k, label: labelOf(k), yaml: yamlOf(k), comment: (review.comments || {})[k] || '', source: commented.includes(k) ? sourceOf(k) : '', overall: !overall || k.split('/')[0] === overallVol })),
                context: ctxText,
                secrets,
                tableCatalog: tables ? tableCatalogText(tables) : '',
                mainLines: clue ? mainLinesText(project.outline.volumes) : '',
                overall,
                talk: opts.talk || '',
                mode: clue ? 'clue' : 'outline',
            }),
        );
    if (view.projectId !== project.id || !jobOf(view, jobId)) return;
    let parts = splitUnitReplies(reply, want.map((k) => ({ key: k, name: k.endsWith('/line') ? VOLUME_LINE_KEY : unitValue(review.draft, k).key }))),
        reasons = keepReasons(reply),
        parsed = {},
        bad = [];
    for (let k of want)
        if (k in parts)
            try {
                let old = unitValue(review.draft, k),
                    p = parseUnitReply(k, parts[k], k.endsWith('/line') ? VOLUME_LINE_KEY : old.key, old && old.data ? stageNodes(old.data).length : 0);
                p.stage && (p.stage = splitImportAuthorFields([{ id: 'x', key: 'x', stages: [{ id: 'y', ...p.stage }] }]).volumes[0].stages[0]);
                parsed[k] = p;
            } catch {
                bad.push(k);
            }
    // 整体意见：没单独意见、也没交回的部分算「不用改」，不算失败；有意见的部分必须交回。
    // 但一个可用的部分都没读到，不算「整体意见改好了」（GPT 代码审阅 R4）：意见保留，提示可重试。
    if (overall && !Object.keys(parsed).length) {
        let why = Object.keys(reasons).length
            ? `AI 说明保持原样：${Object.entries(reasons).map(([k, r]) => `「${want.includes(k) ? labelOf(k) : k}」${r}`).join('；')}`
            : bad.length
              ? '回复格式无法读取'
              : '回复里没有修改内容';
        return toast('warning', `没有读到修改结果（${why}）。意见保留，可重试。`);
    }
    let need = overall ? [...new Set([...commented, ...Object.keys(parsed), ...bad])] : want,
        groups = relatedGroups(review.draft, need),
        cur = view.data.imports.get(jobId).review,
        curBackground = view.project().outline.volumes.filter((v) => !cur.draft.some((d) => d.id === v.id)),
        okKeys = [],
        failed = [],
        outside = [];
    for (let g of groups) {
        let verdict = groupVerdict(g, parsed, snap, cur.draft);
        if (!verdict.ok) {
            failed.push({ g, why: verdict.missing.length ? `未返回「${verdict.missing.map(labelOf).join('、')}」` : `「${verdict.touched.map(labelOf).join('、')}」在修改期间被改过` });
            continue;
        }
        // 改完会不会把没交回的页的引用改断（GPT 代码审阅 R5）：这条线里的 → 整组不用，说明要一起改的页；别的线里的 → 照用，提醒去改那条线
        let after = g.reduce((acc, k) => putUnit(acc, k, parsed[k]), cur.draft),
            breaks = refBreaks(cur.draft, after, g, curBackground),
            inner = breaks.filter((x) => cur.draft.some((v) => v.id === x.key.split('/')[0])),
            // 新写进去、但哪儿都找不到的节点 / 事实（GPT 第二轮 N8）：整组不用，意见保留
            missing = newMissingRefs(cur.draft, after, g, curBackground);
        if (missing.length) {
            failed.push({ g, why: `「${missing.map((x) => labelOf(x.key)).join('、')}」新写的条件用到了找不到的 ${[...new Set(missing.flatMap((x) => x.refs))].join('、')}` });
            continue;
        }
        if (inner.length) {
            failed.push({ g, why: `「${g.map(labelOf).join('、')}」改掉了「${inner.map((x) => labelOf(x.key)).join('、')}」还在用的 ${[...new Set(inner.flatMap((x) => x.refs))].join('、')}，需要一起改` });
            continue;
        }
        outside.push(...breaks);
        okKeys.push(...g);
    }
    let same = [],
        newer = [],
        changedKeys = [];
    okKeys.length &&
        (await saveReview(view, jobId, (r) => {
            let before = r.draft,
                next = editDraft(r, overall ? '按意见修改（含整体意见）' : `按意见修改：${okKeys.map(labelOf).join('、')}`, (d) => okKeys.reduce((acc, k) => putUnit(acc, k, parsed[k]), d)),
                ch = Object.fromEntries(draftChanges(before, next.draft).map((x) => [x.key, x.changes])),
                differs = (k) => JSON.stringify(unitValue(before, k)) !== JSON.stringify(unitValue(next.draft, k)),
                comments = { ...next.comments };
            // 原样交回（没改）的页：意见留着、不算改好（DeepSeek 实测：遗留物阶段 3 原样返回）
            // 等回复期间用户改了意见：只清掉发出去的那句，新写的留着（GPT 代码审阅 R3）
            for (let k of okKeys)
                differs(k)
                    ? (changedKeys.push(k), String(comments[k] || '') === (sentComments[k] || '') ? (comments[k] = '') : newer.push(k))
                    : commented.includes(k) && same.push(k);
            return {
                ...next,
                comments,
                revised: !0,
                lastChanges: {
                    ...(r.lastChanges || {}),
                    ...Object.fromEntries(
                        okKeys
                            .filter((k) => differs(k) || commented.includes(k))
                            .map((k) => [k, differs(k) ? ch[k] || ['内容改了'] : [reasons[k] ? `保持原样：${reasons[k]}` : '未修改，意见保留']]),
                    ),
                },
            };
        }));
    same.length && failed.push({ g: same, why: same.map((k) => (reasons[k] ? `「${labelOf(k)}」保持原样：${reasons[k]}` : `「${labelOf(k)}」原样返回`)).join('；') });
    let overallDone = overall && !failed.length;
    overallDone && (await saveReview(view, jobId, (r) => ({ ...r, overall: '' })));
    let tail = [
        failed.length ? `${failed.map((f) => f.why).join('；')}，相关意见保留。可写得更具体后重试` : '',
        newer.length ? `「${newer.map(labelOf).join('、')}」有新写的意见，还没发送` : '',
        outside.length ? `别的线还在用改掉的内容：${outside.map((x) => `「${labelOf(x.key)}」用 ${x.refs.join('、')}`).join('；')}，需要另外修改那条线` : '',
    ].filter(Boolean);
    toast(
        failed.length || outside.length ? 'warning' : 'success',
        `已修改 ${changedKeys.length} 页${changedKeys.length ? `：${changedKeys.map(labelOf).join('、')}` : ''}${tail.length ? `。${tail.join('。')}` : ''}。`,
    );
}

// ---------------- 采用（统一保存入口，GPT 审阅 R1）----------------
// 编号：导入的线排在已有线后面（主线 M、支线 S），撞号换号；节点 id 撞号换新 id。
// 主线默认「接上一条」只在用户选了「前一条主线结束后」时写进线头。
export function adoptPlan(view, job, review) {
    let project = view.project(),
        kind = importJobKind(job),
        // 审阅页自用的线头标记先去掉（和 prepareCommit 同一个函数），编号分配看的是干净的线头
        vols = stripReviewMarks(review.draft);
    if (kind === 'main' || kind === 'side') {
        let prefix = kind === 'main' ? 'M' : 'S',
            taken = new Set(compileClue(project.outline.volumes).lines.map((l) => l.id));
        vols = vols.map((v) => {
            if (!isPlainObject(v.line) || v.line.编号) return v;
            let n = 1;
            for (; taken.has(`${prefix}${kind === 'side' ? String(n).padStart(2, '0') : n}`); ) n++;
            let id = `${prefix}${kind === 'side' ? String(n).padStart(2, '0') : n}`;
            return (taken.add(id), { ...v, line: { 编号: id, ...v.line } });
        });
        // 卷名里的「卷1」是整理时按这份文档自己的顺序起的，几次导入都会叫卷1（实测：执行页两个「卷1」）。换成线的编号，和多条支线导入的「剧情_S01_标题」一致
        vols = vols.map((v) => {
            let id = isPlainObject(v.line) ? String(v.line.编号 || '').trim() : '',
                m = /^剧情_卷[^_]*_(.+)$/.exec(String(v.key || ''));
            return id && m ? { ...v, key: `剧情_${id}_${m[1]}` } : v;
        });
        let [byLine] = reidLines(vols, project.outline.volumes, [], {});
        vols = byLine;
    }
    let [reid, renamed] = reidConflicts(vols, project.outline.volumes),
        keys = new Set(project.outline.volumes.map((v) => v.key));
    return { vols: reid.map((v) => (keys.has(v.key) ? { ...v, key: `${v.key}_导入${Date.now().toString(36).slice(-3)}` } : v)), renamed };
}

// ---------------- 输入（大纲页的 onInput / onBlur 转过来）----------------
// 意见框、线头字段：失焦时存草稿（自动保存，不重画整页，免得吞掉紧接着的点击）。「什么时候开始」：选了就存并重画。
export async function reviewOnInput(view, target, jobOf, { blur = false } = {}) {
    let jobId = view.tabState('import')[view.projectId]?.jobId,
        job = jobOf(view, jobId);
    if (!job || !job.review) return !1;
    // 只读的线（已保存、不导入、大纲里已删掉）：不写草稿（GPT 第二轮 N5）
    let vid0 = target.dataset.rvVol || (target.dataset.rvComment || target.dataset.rvYaml || '').split('/')[0];
    if (vid0 && lineLocked(job.review, vid0, view.project()) && (target.dataset.rvComment !== void 0 || target.dataset.rvLine !== void 0 || target.dataset.rvTbl !== void 0 || target.dataset.rvWin !== void 0 || target.dataset.rvWhen !== void 0)) return !0;
    if (target.dataset.rvComment !== void 0) {
        if (!blur) return !0;
        let key = target.dataset.rvComment,
            text = target.value;
        if ((job.review.comments || {})[key] === text) return !0;
        await saveReview(view, jobId, (r) => ({ ...r, comments: { ...r.comments, [key]: text } }));
        // 不重画整页：只改按钮上的页数、当前页码的小红点
        let n = Object.values(view.data.imports.get(jobId).review.comments).filter((c) => String(c || '').trim()).length,
            card = target.closest('.pi-rv'),
            b = card && card.querySelector('[data-act="rv-preview"]'),
            dot = card && card.querySelector('.pi-rv-dot.is-cur');
        b && !view.busy[`review:${view.projectId}`] && ((b.textContent = sendLabel(n)), b.classList.toggle('is-primary', n > 0));
        dot && dot.classList.toggle('is-note', !!String(text).trim());
        return !0;
    }
    if (target.dataset.rvLine !== void 0) {
        if (!blur) return !0;
        let k = target.dataset.rvLine,
            val = target.value.trim(),
            vid = target.dataset.rvVol || job.review.draft[0].id,
            vol = job.review.draft.find((v) => v.id === vid);
        if (!vol || clueText(vol.line && vol.line[k]) === val) return !0;
        await saveReview(view, jobId, (r) => editDraft(r, `改${k}`, (d) => putLine(d, vid, { [k]: val }, [k])));
        // 只更新状态行和保存按钮（不重画整页，免得打断正在填的下一个框）
        let card = target.closest('.pi-rv'),
            r1 = view.data.imports.get(jobId).review,
            ids = changedLines(view.project(), r1),
            edit = r1.source && r1.source !== 'import',
            stEl = card && card.querySelector('.pi-rv-state'),
            save = card && card.querySelector('[data-act="import-adopt"]');
        if (stEl && edit) {
            stEl.classList.toggle('is-draft', ids.length > 0);
            stEl.textContent = stateLine(r1, ids, ids.length > 0);
        }
        if (save && edit) {
            let hasNotes = !!card.querySelector('[data-act="rv-preview"].is-primary');
            save.disabled = !ids.length;
            save.textContent = ids.length ? saveLabel(r1, ids) : '已与大纲一致';
            save.classList.toggle('is-primary', ids.length > 0 && !hasNotes);
        }
        return !0;
    }
    if (target.dataset.rvTbl !== void 0) {
        if (target.tagName === 'INPUT' && !blur) return !0;
        let card = target.closest('.pi-rv'),
            vid = target.dataset.rvVol,
            get = (k) => String((card && card.querySelector(`[data-rv-tbl="${k}"]`)?.value) || '').trim(),
            t = { table: get('table'), row: get('row'), col: get('col'), op: get('op') || '>=', value: get('value') };
        // 换了表：行和列清空（另一张表里不一定有）
        target.dataset.rvTbl === 'table' && ((t.row = ''), (t.col = ''));
        let full = t.table && t.row && t.col && t.value !== '';
        await saveReview(view, jobId, (r) =>
            editDraft(r, '改表格条件', (d) =>
                d.map((v) => {
                    if (v.id !== vid) return v;
                    let line = { ...(v.line || {}), 开始方式表格: !0, 开始时机已选: !0 };
                    // 没填完：已选的部分暂存在线头里（表单重画时还在），原来那条完整的条件不动；保存时会拦下（GPT 第二轮 N2）
                    full ? ((line.开启条件 = tableCondOf(t)), delete line.表格条件草稿) : (line.表格条件草稿 = t);
                    return { ...v, line };
                }),
            ),
        );
        view.renderBody();
        return !0;
    }
    if (target.dataset.rvWin !== void 0) {
        let card = target.closest('.pi-rv'),
            vid = target.dataset.rvVol,
            get = (k) => (card && card.querySelector(`[data-rv-win="${k}"]`)?.value) || '',
            main = get('主线'),
            win = main ? { 主线: main, ...(get('从') && target.dataset.rvWin !== '主线' ? { 从: get('从') } : {}), ...(get('到') && target.dataset.rvWin !== '主线' ? { 到: get('到') } : {}) } : '';
        await saveReview(view, jobId, (r) =>
            editDraft(r, '改开启时段', (d) => d.map((v) => (v.id !== vid ? v : { ...v, line: win ? { ...v.line, 开启时段: win } : Object.fromEntries(Object.entries(v.line || {}).filter(([k]) => k !== '开启时段')) }))),
        );
        view.renderBody();
        return !0;
    }
    if (target.dataset.rvWhen !== void 0) {
        let v = target.dataset.rvWhen,
            vid = target.dataset.rvVol || job.review.draft[0].id,
            base0 = (job.review.base || []).find((x) => x.id === vid);
        await saveReview(view, jobId, (r) =>
            editDraft(r, '选开始时机', (d) => {
                let cur = d.find((x) => x.id === vid),
                    l = { ...((cur && cur.line) || {}) };
                // 切走之前先记下复杂条件（切到表格、随时、手动、接上一条都会去掉它）；选回「保留现有条件」用切换前的这一份
                complexCond(l.开启条件) && (l.保留条件 = l.开启条件);
                v === 'keep' && l.保留条件 != null && ((l.开启条件 = l.保留条件), delete l.保留条件);
                delete l.接上一条;
                delete l.开启方式;
                delete l.开始方式表格;
                delete l.表格条件草稿;
                v !== 'keep' && v !== 'table' && delete l.开启条件;
                v === 'table' && ((l.开始方式表格 = !0), simpleTableCond(l.开启条件) || delete l.开启条件);
                v === 'after' && (l.接上一条 = !0);
                v === 'manual' && (l.开启方式 = '人工');
                l.开始时机已选 = !0;
                return d.map((x) => (x.id === vid ? { ...x, line: l } : x));
            }),
        );
        // 没有暂存（比如一打开就是别的方式）时，才退回打开时的条件
        let now = view.data.imports.get(jobId).review.draft.find((x) => x.id === vid);
        if (v === 'keep' && !complexCond(now && now.line && now.line.开启条件) && base0 && base0.line && complexCond(base0.line.开启条件))
            await saveReview(view, jobId, (r) => ({ ...r, draft: r.draft.map((x) => (x.id === vid ? { ...x, line: { ...x.line, 开启条件: base0.line.开启条件 } } : x)) }));
        view.renderBody();
        return !0;
    }
    return !1;
}
