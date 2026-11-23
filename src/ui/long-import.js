import {
    mergeLineIdentity,
    importLineIndexMessages,
    mainLinesText,
    importLineBatches,
    mergeImportByLine,
    importLineDraftMessages,
    lineIdsMissing,
    splitLongText,
    mergeImportIndex,
    importIndexMessages,
    importIndexMissing,
    importIndexRetryMessages,
    importIndexForPart,
    salvageImportIndex,
    fixImportIndexMessages,
    importDoneText,
    mergeImportParts,
    importDraftMessages,
    splitImportAuthorFields,
    checkImportDraft,
    importConflictText,
    importReachIssues,
    IMPORT_NEEDS_EXAMPLE,
    importJobKind,
    importSecretNames,
    reidLines,
} from '../core/long-import.js';
import { renderReview, renderAdopted, reviewOf, reviewActions, adoptPlan, reviewIssues, putUnit, lineTitle, lineLevelIssues, reviewUnits, sendableNotes } from './import-review.js';
import { prepareCommit, commitOutline, createReviewSession, sessionUnits, draftChanges, draftDiffers, editDraft, linesSessionOf, linesToAdopt, editedVolumes, targetStamp, incompleteTableLines, matchStages, stripReviewMarks } from '../core/review-draft.js';
import { normalizeClue } from '../core/clue-model.js';

import { lineReviewFromJob, adoptedLineOf } from './review-lines.js';

import { afterAdopt, currentTables, st } from './tab-outline.js';

import { tableCatalogText, extractYaml, fixYamlMessages, parseOutlineReply } from '../core/prompts.js';

import { isPlainObject, stageLabel, stageNodes, makeId, pushOutlineHistory } from '../core/outline.js';
import { stringifyYaml, parseYaml } from '../core/yaml.js';

import { ask, runTask } from './ai.js';

import { isClueMode, nodeUid, reidConflicts } from '../core/clue-model.js';

import { chatFactSets, checkClueDraft } from '../core/clue-project.js';

import { esc, options, pickFiles, confirmDialog, choiceDialog } from './dom.js';

import { toast, hostDocument } from '../host/st.js';
import { adoptKey } from '../app/import-store.js';

export const IMPORT_PART_CHARS = 8e3;

// 导入时正在生成的请求：jobId → Map(请求 → {label, chars})。独立接口流式时实时更新字数，
// 直接改进度行的文字，不整页重画（用户 2026-11-22：看不出进度）。
const liveImport = new Map();
let liveSeq = 0;
export function importLiveText(jobId) {
    let m = liveImport.get(jobId);
    return m && m.size ? `正在生成：${[...m.values()].map((x) => `${x.label}${x.chars ? `${x.chars}字` : ''}`).join('，')}` : '';
}
function paintLive(jobId) {
    let text = importLiveText(jobId);
    hostDocument()
        .querySelectorAll('[data-imp-live]')
        .forEach((el) => el.dataset.impLive === jobId && (el.textContent = text));
}
// 正在整理的导入任务 → 中止器（用户 2026-11-23：导入没有强制停止键）。停止时进行中的请求立即作废，已存下的段不动，点「继续」接着做。
const importStops = new Map();
export function stopImport(jobId) {
    let ctl = importStops.get(jobId);
    ctl && ctl.abort();
    return !!ctl;
}
async function askLive(view, jobId, label, messages) {
    let m = liveImport.get(jobId) || (liveImport.set(jobId, new Map()), liveImport.get(jobId)),
        key = ++liveSeq,
        last = 0,
        ctl = importStops.get(jobId);
    if (ctl && ctl.signal.aborted) {
        let error = new Error('已停止');
        throw ((error.name = 'AbortError'), error);
    }
    (m.set(key, { label, chars: 0 }), paintLive(jobId));
    try {
        return await ask(view, 'outline', messages, {
            signal: ctl ? ctl.signal : void 0,
            onText: (t) => {
                m.set(key, { label, chars: t.length });
                let now = Date.now();
                now - last > 400 && ((last = now), paintLive(jobId));
            },
        });
    } finally {
        (m.delete(key), m.size || liveImport.delete(jobId), paintLive(jobId));
    }
}

export const sti = (view) => {
    let all = view.tabState('import'),
        id = view.projectId || '';
    return (all[id] || (all[id] = {}), all[id]);
};

export function importJobIds(project) {
    return project && Array.isArray(project.imports) ? project.imports : [];
}

export function importJobOf(view, jobId) {
    let job = jobId ? view.data.imports.get(jobId) : null;
    return job && job.projectId === view.projectId && importJobIds(view.project()).includes(jobId) ? job : null;
}

export function projectAdopted(project) {
    return new Set(project && Array.isArray(project.importAdopted) ? project.importAdopted : []);
}

export async function runImportJob(view, jobId) {
    let ctl = new AbortController();
    importStops.set(jobId, ctl);
    try {
        return await runImportJobInner(view, jobId, ctl.signal);
    } finally {
        importStops.get(jobId) === ctl && importStops.delete(jobId);
        if (ctl.signal.aborted) {
            let error = new Error('已停止');
            throw ((error.name = 'AbortError'), error);
        }
    }
}

async function runImportJobInner(view, jobId, signal) {
    let store = view.data.imports,
        job = await store.load(jobId),
        text = await store.source(jobId),
        task = { projectId: view.projectId };
    if (!job) throw new Error('找不到这个导入任务');
    if (job.projectId !== task.projectId) throw new Error('这个导入任务不属于当前项目');
    let still = () => !signal.aborted && view.projectId === task.projectId && store.get(jobId),
        parts =
            job.parts && job.parts.length ? job.parts : splitLongText(text, { target: IMPORT_PART_CHARS }).map(({ text: _t, ...p }) => p);
    (job.parts && job.parts.length) || (await store.update(jobId, (j) => ({ ...j, parts, step: 'index' })));
    let partText = (p) => text.slice(Math.max(0, p.start - p.lead), p.end),
        ok = (x) => isPlainObject(x) && !x.error,
        local = [...(store.get(jobId).localIndex || [])],
        lines = job.mode === 'lines',
        // 按段的位置传（失败的段用空索引占位），「第几段」「段」才和原文段号对得上。
        okList = () => local.map((x) => (ok(x) ? x : {})),
        read = (t) => {
            let v = parseYaml(extractYaml(t));
            if (!isPlainObject(v)) throw new Error('没有读到索引内容');
            return v;
        },
        indexMsgs = (p) => {
            let prevIdx = local.some(ok)
                    ? {
                          ...mergeImportIndex(okList()),
                          ...(lines ? { 支线: mergeLineIdentity(okList()).lines.map(({ parts: _p, ...l }) => l) } : {}),
                      }
                    : null,
                base = importIndexMessages({ part: { ...p, text: partText(p) }, total: parts.length, prev: prevIdx ? stringifyYaml(prevIdx) : '', needs: job.needs });
            return lines ? importLineIndexMessages(base) : base;
        },
        sent = new Map(),
        readPart = async (p) => {
            if (!still() || ok(local[p.i])) return;
            let msgs = indexMsgs(p),
                reply2 = await askLive(view, jobId, `第${p.i + 1}段`, msgs),
                parsed = null;
            try {
                parsed = read(reply2);
            } catch (error) {
                // 格式坏了：先本地逐块抢救，只有文字块坏了就直接用；结构有丢失再请模型修一次，修不好仍用抢救结果。
                let raw = extractYaml(reply2),
                    saved = salvageImportIndex(raw),
                    good = saved.value && Object.keys(saved.value).length ? saved.value : null;
                if (good && !saved.lost) parsed = good;
                else
                    try {
                        parsed = read(await askLive(view, jobId, `第${p.i + 1}段`, fixImportIndexMessages(raw, error.message)));
                    } catch (error2) {
                        parsed = good || { error: `第${p.i + 1}段的索引读不出来：${error2.message}` };
                    }
            }
            if (!still()) return; // 修格式那一步被停止时别把「读不出来」存进去
            ok(parsed) && sent.set(p.i, { msgs, reply: reply2 });
            ((local[p.i] = parsed), await store.update(jobId, (j) => ({ ...j, localIndex: local, step: 'index' })), view.renderBody());
        };
    // 阅读（用户 2026-11-22：太慢）：第一段单独读，定下人物和事实编号；之后最多 IMPORT_CONCURRENCY 段同时读，
    // 每段带上开始时已经读完的索引（同一批的几段互相看不到，跨段重复的事实靠合并和整理时的「待确认」兜底）。
    let todo = parts.filter((p) => !ok(local[p.i]));
    todo.length && !local.some(ok) && (await readPart(todo.shift()));
    if (!still()) return;
    await runPool(todo.map((p) => () => readPart(p)), IMPORT_CONCURRENCY, still);
    if (!still()) return;
    // 缺「事实」的补问：原来每段缺了都整段重发一次，但开头、人物表、过渡章节本来就可能没有可查的事实。
    // 改为整份材料一条事实都没读出来时，才对缺事实的段补问。
    if (!mergeImportIndex(okList()).事实.length) {
        let retry = async (p) => {
            // 只补问这次刚读的段：材料本来就没有事实时，点「继续」不会每次都再问一遍。
            if (!still() || !sent.has(p.i) || !ok(local[p.i]) || !importIndexMissing(local[p.i]).length) return;
            let miss = importIndexMissing(local[p.i]),
                was = sent.get(p.i);
            try {
                let again = read(await askLive(view, jobId, `第${p.i + 1}段`, importIndexRetryMessages(was.msgs, was.reply, miss)));
                if (!(importIndexMissing(again).length < miss.length)) return;
                ((local[p.i] = again), await store.update(jobId, (j) => ({ ...j, localIndex: local, step: 'index' })), view.renderBody());
            } catch {}
        };
        await runPool(parts.map((p) => () => retry(p)), IMPORT_CONCURRENCY, still);
        if (!still()) return;
    }
    let index = mergeImportIndex(okList());
    if ((await store.update(jobId, (j) => ({ ...j, index, step: 'draft' })), job.mode === 'lines'))
        return runLineDrafts(
            view,
            jobId,
            parts,
            partText,
            local.map((x) => (ok(x) ? x : {})),
            index,
            still,
        );
    for (let p of parts) {
        if (!still()) return;
        let cur = store.get(jobId);
        if (cur.drafts[p.i] && !cur.drafts[p.i].error) continue;
        let good = Object.values(cur.drafts).filter((d) => !d.error),
            done = importDoneText(mergeImportParts(good.flatMap((d) => d.volumes || []))),
            prevTail =
                p.i && cur.drafts[p.i - 1] && !cur.drafts[p.i - 1].error
                    ? String(cur.drafts[p.i - 1].yaml || '')
                          .split(
                              `
`,
                          )
                          .slice(-25).join(`
`)
                    : '',
            reply2 = await askLive(
                view,
                jobId,
                `第${p.i + 1}段`,
                importDraftMessages({
                    part: { ...p, text: partText(p) },
                    index: stringifyYaml(importIndexForPart(index, p.i)),
                    prevTail,
                    mode: cur.mode,
                    needs: cur.needs,
                    done,
                    kind: importJobKind(cur),
                }),
            ),
            r = parseOutlineReply(reply2);
        (r.ok && r.volumes.length) ||
            (r = parseOutlineReply(await askLive(view, jobId, `第${p.i + 1}段`, fixYamlMessages(r.yaml, r.error || '没有读到任何阶段', cur.mode))));
        let entry =
            r.ok && r.volumes.length
                ? { yaml: r.yaml, volumes: r.volumes, notes: splitImportAuthorFields(r.volumes, p).notes }
                : { error: r.error || '没有读到任何阶段', yaml: r.yaml };
        (await store.update(jobId, (j) => ({ ...j, drafts: { ...j.drafts, [p.i]: entry } })), view.renderBody());
    }
    let fin = store.get(jobId),
        failed = importFailedParts(fin);
    (await store.update(jobId, (j) => ({ ...j, step: failed.length ? 'draft' : 'review' })), view.renderBody());
}

// 多条支线：一段分几批（每批几条线）并发整理，结果按批次位置存进 drafts[段].list[批]。
// 并发时后面的批次可能先写完，前面的位置暂时是空的（存盘后是 null）（GPT 第五轮 C1）。
// want：这一段预期几批；ok：成功了几批；bad：第一个失败的批次；left：还没成功的批数。
export function lineBatchState(job, p) {
    let ident = job.lineIdent && Array.isArray(job.lineIdent.lines) ? job.lineIdent.lines : null,
        list = (job.drafts && job.drafts[p.i] && job.drafts[p.i].list) || [],
        want = ident ? importLineBatches(ident, p.i).length : list.length,
        ok = Array.from({ length: want }, (_, g) => list[g] && !list[g].error).filter(Boolean).length;
    return { want, ok, left: want - ok, bad: list.find((x) => x && x.error) || null };
}
export function importFailedParts(job) {
    let parts = job.parts || [],
        local = job.localIndex || [],
        drafts = job.drafts || {},
        lines = job.mode === 'lines';
    return parts
        .map((p) => {
            let b = lines && drafts[p.i] && !drafts[p.i].error ? lineBatchState(job, p) : null,
                why =
                    local[p.i] && local[p.i].error
                        ? local[p.i].error
                        : drafts[p.i] && drafts[p.i].error
                          ? `第${p.i + 1}段转写失败：${drafts[p.i].error}`
                          : b && b.bad
                            ? `第${p.i + 1}段的${b.bad.only.join('、')}转写失败：${b.bad.error}`
                            : b && b.left
                              ? `第${p.i + 1}段有${b.left}批未完成，其他结果已保存`
                              : drafts[p.i]
                                ? ''
                                : `第${p.i + 1}段还没整理`;
            return why ? { i: p.i, title: p.title, why } : null;
        })
        .filter(Boolean);
}

export function importCandidate(job) {
    let good = Object.keys(job.drafts || {})
        .sort((a, b) => a - b)
        .map((k) => job.drafts[k])
        .filter((d) => d && !d.error);
    let merged = mergeImportParts(good.flatMap((d) => d.volumes || [])),
        vols = splitImportAuthorFields(merged).volumes,
        notes = Object.assign({}, ...good.map((d) => d.notes || {}));
    // 索引按各段的原始结果重新合并（合并规则更新后，旧任务也按新规则显示和检查）。
    let localOk = (job.localIndex || []).filter((x) => isPlainObject(x) && !x.error),
        index = localOk.length ? mergeImportIndex(localOk) : job.index;
    let issues = checkImportDraft(vols, { index, mode: job.mode === 'clue' ? 'clue' : 'outline' });
    issues.push(...(merged.conflicts || []).map((c) => ({ level: 'warn', text: importConflictText(c) })));
    return { volumes: vols, notes, issues, index };
}

export function importAdoptIssues(view, vol, take, index) {
    let project = view.project(),
        clue = isClueMode(project),
        issues = [],
        basis = '';
    let names = new Set(take.map((st) => stageLabel(st.key))),
        added = [{ ...vol, stages: take }],
        applied = [...project.outline.volumes, ...added];
    issues.push(...checkImportDraft(added, { index, mode: clue ? 'clue' : 'outline' }).filter((x) => !/按大纲推演|替代途径/.test(x.text)));
    if (!clue) return { issues, basis };
    let c = view.runtime.activeId() === view.projectId ? view.runtime.clue.compute() : null,
        { known, claimed } = chatFactSets(c);
    basis = c
        ? `按当前聊天的进度判断（已确认${known.length}个事实${claimed.length ? `，另有${claimed.length}个已出现的说法` : ''}）。`
        : '这个项目没有在当前聊天启用，按大纲本身判断（不计任何聊天的进度）。';
    issues.push(...importReachIssues(applied, { only: names, knownFacts: known, claimedFacts: claimed }));
    issues.push(
        ...checkClueDraft(added, project.outline.volumes, { isObtained: (id) => known.includes(id) })
            .filter((x) => /^事实编号 /.test(x))
            .map((text) => ({ level: 'warn', text })),
    );
    return { issues, basis };
}

const IMPORT_KINDS = [
    { value: 'main', label: '一条主线', note: '一段完整的主线剧情' },
    { value: 'side', label: '一条支线', note: '一段独立的支线剧情' },
    { value: 'lines', label: '多条支线', note: '多段支线剧情，逐条整理' },
];
const KIND_WORD = { main: '一条主线', side: '一条支线', lines: '多条支线', outline: '按阶段推进', legacy: '线索推进', edit: '审阅修改' };
const IMPORT_NEEDS_SIDE = '这是一条支线。写清它什么时候能开始、由什么引出（比如「主线进行到当铺之后，罗莎打电话来」）；开头的人物表只给我自己看。';
const IMPORT_NEEDS_LINES = '文档里每条支线用「## 1标题」「## 2标题」分开；每条写清什么时候能开始。开头的总说明只给我自己看。';
// 审阅修改只含大纲里已有的线。导入审阅完、还没保存到大纲的线不在这里（实测：从导入页切出去后找不到支线）：
// 列出这些导入，给一个回去的入口。只算从来没保存进大纲的：单条导入保存过（adoptedId）、之后点「继续修改」的不算（GPT 第五轮 U1）；
// 多条支线看还剩几条既没保存、也没设成不导入。打开审阅修改前已经把这个项目的导入记录都载入了。
function unsavedImports(view, project) {
    return importJobIds(project)
        .map((id) => view.data.imports.get(id))
        .filter((j) => {
            if (!j || importJobKind(j) === 'edit' || j.step !== 'review' || !j.review) return !1;
            if (j.mode === 'lines' && j.review.lines) return linesLeft(project, j) > 0;
            return !j.review.adoptedId && !projectAdopted(project).has(adoptKey(j.id, 'review', 0));
        });
}
function linesLeft(project, j) {
    let saved = adoptedLinesOf(project, j, j.review),
        drop = new Set(j.review.dropped || []);
    return j.review.draft.filter((v) => !saved[v.id] && !drop.has(v.id)).length;
}
function pendingImportNote(view, project) {
    let list = unsavedImports(view, project);
    return list.length
        ? `<div class="pi-rv-pending">${list
              .map((j) => {
                  let n = j.mode === 'lines' && j.review && j.review.lines ? linesLeft(project, j) : 0;
                  return `<p class="pi-hint">还有${n ? `${n}条支线` : `一条${KIND_WORD[importJobKind(j)].replace(/^一条/, '')}`}未保存到大纲。<button type="button" class="pi-rv-fillall pi-rv-pending-btn" data-act="import-open" data-id="${esc(j.id)}">打开审阅</button></p>`;
              })
              .join('')}</div>`
        : '';
}
function jobState(j) {
    if (importJobKind(j) === 'edit') return j.review && j.review.savedAt ? '保存过' : '待审阅';
    if (j.step !== 'review') return '整理中';
    if (j.review && j.review.adoptedId && !j.review.reopened) return '已采用';
    return '待审阅';
}
// 面包屑：大纲 › 导入 › 审阅（每一级都能点）。
function crumbs(at) {
    let items = [
        { label: '大纲', act: 'import-close' },
        { label: '导入', act: 'import-back' },
        { label: '审阅', act: '' },
    ];
    return `<div class="pi-imp-crumb">${items
        .slice(0, Math.max(at + 1, 2))
        .map((x, i) => (i === at || !x.act ? `<b>${x.label}</b>` : `<button type="button" class="pi-imp-crumb-a" data-act="${x.act}">${x.label}</button>`))
        .join('<span>›</span>')}</div>`;
}

export function renderImport(view) {
    let s = sti(view),
        project = view.project(),
        ids = importJobIds(project),
        busy = view.busy[`import:${view.projectId}`];
    if ((s.jobId && !importJobOf(view, s.jobId) && view.data.imports.get(s.jobId) && (s.jobId = ''), !s.jobId)) {
        let missing = ids.filter((id) => !view.data.imports.get(id) && !(s.unreadable || []).includes(id));
        if (missing.length && !s.loadingList)
            return (
                (s.loadingList = !0),
                Promise.all(missing.map((id) => view.data.imports.load(id).catch(() => null)))
                    .then((got) => {
                        s.unreadable = [.../* @__PURE__ */ new Set([...(s.unreadable || []), ...missing.filter((_, k) => !got[k])])];
                    })
                    .finally(() => ((s.loadingList = !1), view.renderBody())),
                '<div class="pi-empty"><span class="pi-spin"></span> 正在读取导入记录…</div>'
            );
        let list = ids.map((id) => view.data.imports.get(id)).filter(Boolean),
            lost = (s.unreadable || []).filter((id) => ids.includes(id));
        let clue0 = s.mode ? s.mode === 'clue' : isClueMode(project),
            kind0 = clue0 ? s.kind || 'main' : 'outline';
        return `${crumbs(0)}<div class="pi-card"><h3>导入长文<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="import-close">回到大纲</button></h3>
        <label class="pi-field"><span>原文</span><textarea class="pi-ta pi-imp-text" data-imp-text placeholder="粘贴剧情方案，或选择txt / md文件">${esc(s.text || '')}</textarea></label>
        <div class="pi-row pi-imp-file"><button type="button" class="pi-btn is-sm" data-act="import-pick-file">选择文件…</button></div>
        ${s.file ? `<div class="pi-imp-chip"><span class="pi-imp-chip-name">${esc(s.file.name)}</span><span class="pi-imp-chip-sub">${s.file.chars >= 1e4 ? `${(s.file.chars / 1e4).toFixed(1)}万字` : `${s.file.chars}字`}</span></div>` : ''}
        <label class="pi-field"><span>推进方式</span><select class="pi-sel" data-imp-modesel>${options(
            [
                { value: 'clue', label: '线索推进' },
                { value: 'outline', label: '按阶段推进' },
            ],
            clue0 ? 'clue' : 'outline',
        )}</select><span class="pi-hint">${clue0 ? '按查到的线索推进剧情。' : '按时间顺序一段段推进，整份文档整理成一卷。'}${clue0 === isClueMode(project) ? '' : '和项目现在的推进方式不同。保存后到执行页切换推进方式，剧情才会按这种方式推进。'}</span></label>
        ${
            clue0
                ? `<div class="pi-field"><span>文档内容</span><div class="pi-imp-kind">${IMPORT_KINDS.map((k) => `<button type="button" class="pi-imp-kind-btn${kind0 === k.value ? ' is-sel' : ''}" data-act="import-kind" data-kind="${k.value}"><b>${k.label}</b><span>${k.note}</span></button>`).join('')}</div></div>`
                : ''
        }
        ${clue0 && !currentTables() ? '<p class="pi-hint is-warn">当前聊天读不到数据库表格。依赖表格的开始条件会先按手动开始整理；也可以到有表格的聊天里导入。</p>' : ''}
        <label class="pi-field"><span>要求（可空）</span><textarea class="pi-ta" rows="3" data-imp-needs placeholder="${esc(kind0 === 'side' ? IMPORT_NEEDS_SIDE : kind0 === 'lines' ? IMPORT_NEEDS_LINES : IMPORT_NEEDS_EXAMPLE)}">${esc(s.needs || '')}</textarea></label>
        <input type="hidden" data-imp-mode value="${clue0 ? (kind0 === 'lines' ? 'lines' : 'clue') : 'outline'}"><input type="hidden" data-imp-kind value="${kind0}">
        <div class="pi-tools is-end is-c1"><button type="button" class="pi-btn is-primary" data-act="import-start">开始整理</button></div></div>
        ${list.length || lost.length ? `<div class="pi-card"><h3>之前的导入</h3>${list.map((j) => `<div class="pi-set-row"><span>${esc(new Date(j.createdAt).toLocaleString('zh-CN', { hour12: !1 }))}，${j.chars}字，${KIND_WORD[importJobKind(j)]}，${jobState(j)}</span><span class="pi-spacer"></span><button type="button" class="pi-btn is-sm" data-act="import-open" data-id="${esc(j.id)}">打开</button><button type="button" class="pi-btn is-sm is-ghost is-danger" data-act="import-drop" data-id="${esc(j.id)}">删除</button></div>`).join('')}${lost.map((id) => `<div class="pi-set-row"><span class="is-warn">读不到这条导入记录的文件</span><span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost is-danger" data-act="import-drop" data-id="${esc(id)}">移除</button></div>`).join('')}</div>` : ''}`;
    }
    let job = importJobOf(view, s.jobId);
    if (!job)
        return (
            s.loadingJob ||
                ((s.loadingJob = !0),
                view.data.imports
                    .load(s.jobId)
                    .catch(() => null)
                    .then((j) => {
                        (j && j.projectId === view.projectId) || ((s.jobId = ''), toast('warning', '读不到这个导入任务。'));
                    })
                    .finally(() => ((s.loadingJob = !1), view.renderBody()))),
            '<div class="pi-empty"><span class="pi-spin"></span> 正在读取导入任务…</div>'
        );
    if (importJobKind(job) === 'edit') {
        if (!job.review) return '<div class="pi-empty">这次修改的内容读不出来。</div>';
        // 顶上那行路径写当前位置（大纲里）；从讨论页来的，右边另给「返回讨论」（GPT 界面审阅第 3 条）
        let back = `<div class="pi-imp-crumb"><button type="button" class="pi-imp-crumb-a" data-act="import-close">大纲</button><span>›</span><b>审阅修改</b><button type="button" class="pi-imp-crumb-a pi-imp-crumb-end" data-act="edit-back-discuss">返回讨论</button></div>`;
        return renderReview(view, job, job.review, null, back + pendingImportNote(view, project));
    }
    let parts = job.parts || [],
        indexed = (job.localIndex || []).filter((x) => isPlainObject(x) && !x.error).length,
        lines = job.mode === 'lines',
        whole = (p) => job.drafts && job.drafts[p.i] && !job.drafts[p.i].error && (!lines || !lineBatchState(job, p).left),
        drafted = parts.filter(whole).length,
        total = parts.length,
        // 正在整理时，未完成的批次是「还在等」，不算失败
        failed = importFailedParts(job).filter((f) => !/还没整理/.test(f.why) && !(busy && /批未完成/.test(f.why))),
        doing = busy && lines && parts.find((p) => !whole(p) && job.drafts && job.drafts[p.i]),
        bs = doing ? lineBatchState(job, doing) : null,
        progress = `<p class="pi-hint">共${total || '?'}段，已读${indexed}段，已整理${drafted}段${job.step === 'review' ? '，已完成' : ''}</p>${bs ? `<p class="pi-hint">正在整理第${doing.i + 1}段，已完成${bs.ok} / ${bs.want}批。</p>` : ''}${busy ? `<p class="pi-hint" data-imp-live="${esc(job.id)}">${esc(importLiveText(job.id))}</p>` : ''}${failed.map((f) => `<p class="pi-hint is-warn">${esc(f.why)}</p>`).join('')}`;
    if (job.step !== 'review')
        return `${crumbs(1)}<div class="pi-card"><h3>导入长文<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="import-close">回到大纲</button></h3>${progress}
        <div class="pi-tools is-end">${busy ? '<button type="button" class="pi-btn is-sm is-danger" data-act="import-stop">停止</button>' : ''}<button type="button" class="pi-btn is-primary is-sm" data-act="import-run"${busy ? ' disabled' : ''}>${busy ? '<span class="pi-spin"></span>整理中' : failed.length ? '重试失败的段' : drafted || indexed ? '继续' : '开始'}</button></div></div>`;
    // 好几条支线（第二批 b）：和导入一条线同一个审阅页，多一行选线。旧任务的逐条审阅数据迁进会话（linesSessionOf）。
    if (job.mode === 'lines') {
        if (!job.review || !job.review.lines) {
            // 旧任务：逐条数据（job.lineReview）迁进审阅会话；新任务从整理结果建会话。之后只写会话，不再写 lineReview（GPT 第三轮清理 B3）
            let lr = job.lineReview || lineReviewFromJob(job);
            return (
                view.data.imports.update(job.id, (j) => (j.review && j.review.lines ? j : { ...j, review: linesSessionOf({ ...j, lineReview: j.lineReview || lr }) })).then(() => view.renderBody()),
                '<div class="pi-empty"><span class="pi-spin"></span> 正在准备审阅…</div>'
            );
        }
        let notes = [...(job.review.conflicts || []), ...((job.lineIdent && job.lineIdent.notes) || [])],
            had = job.review.adoptedLines || {},
            now = adoptedLinesOf(view.project(), job, job.review);
        if (Object.keys(now).length !== Object.keys(had).length)
            return (view.data.imports.update(job.id, (j) => ({ ...j, review: { ...j.review, adoptedLines: adoptedLinesOf(view.project(), j, j.review) } })).then(() => view.renderBody()), '<div class="pi-empty"><span class="pi-spin"></span> 正在准备审阅…</div>');
        return renderReview(view, job, job.review, importCandidate(job).index, crumbs(2), notes);
    }
    if (importJobKind(job) !== 'outline') {
        let cand0 = importCandidate(job);
        if (!job.review)
            return (
                view.data.imports.update(job.id, (j) => (j.review ? j : { ...j, review: reviewOf(j, cand0) })).then(() => view.renderBody()),
                '<div class="pi-empty"><span class="pi-spin"></span> 正在准备审阅…</div>'
            );
        return job.review.adoptedId && !job.review.reopened ? renderAdopted(view, job, job.review, crumbs(2)) : renderReview(view, job, job.review, cand0.index, crumbs(2));
    }
    let cand = importCandidate(job),
        adopted = projectAdopted(project),
        stages = cand.volumes[0] ? cand.volumes[0].stages : [],
        errs = cand.issues.filter((x) => x.level === 'error'),
        warns = cand.issues.filter((x) => x.level !== 'error'),
        pending = (cand.index && cand.index.待确认) || [];
    return `<div class="pi-card"><h3>审阅导入结果<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="import-back">返回</button></h3>${progress}
        ${errs.length ? `<p class="pi-hint is-warn"><b>需要处理（${errs.length}）</b></p>${errs.map((x) => `<p class="pi-hint is-warn">${esc(x.text)}</p>`).join('')}` : '<p class="pi-hint">整份草稿的检查：没有发现必须处理的问题。采用时会按项目现有大纲和勾选的阶段再查一次。</p>'}
        ${warns.map((x) => `<p class="pi-hint">${esc(x.text)}</p>`).join('')}
        ${pending.length ? `<p class="pi-hint"><b>请确认</b></p>${pending.map((x) => `<p class="pi-hint">${esc(x)}</p>`).join('')}` : ''}
        ${stages
            .map((st) => {
                let key = adoptKey(job.id, 0, st.key),
                    nodes = stageNodes(st.data),
                    done = adopted.has(key);
                return `<div class="pi-imp-stage"><div class="pi-set-row"><b>${esc(stageLabel(st.key))}</b><span class="pi-hint">　${nodes.length}个节点</span><span class="pi-spacer"></span>${done ? '<span class="pi-badge is-ok">已采用</span>' : `<label class="pi-check"><input type="checkbox" data-imp-pick="${esc(st.key)}" checked><span>采用</span></label>`}</div>
            ${nodes
                .map((n) => {
                    let note = cand.notes[nodeUid(n.item)] || {};
                    return `<p class="pi-hint">${esc(n.name)}${note.段 ? `<span class="pi-meta">　第${note.段}段</span>` : ''}${note.待确认 ? `<br><span class="is-warn">待确认：${esc(note.待确认)}</span>` : ''}</p>`;
                })
                .join('')}
            <details><summary class="pi-hint">YAML</summary><pre class="pi-pre is-full">${esc(stringifyYaml({ [st.key]: st.data }))}</pre></details></div>`;
            })
            .join('')}
        <div class="pi-tools is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="import-adopt">把勾选的阶段追加为新卷</button></div>
        ${cand.index ? `<details><summary class="pi-hint">作者索引（只给作者看）</summary><pre class="pi-pre is-full">${esc(stringifyYaml(Object.fromEntries(Object.entries(cand.index).filter(([k]) => k !== 'secretFlag'))))}</pre></details>` : ''}</div>`;
}

const rvActions = reviewActions({
    jobOf: (view, jobId) => importJobOf(view, jobId),
    redraftLine: (...a) => redraftLine(...a),
    openSaved: async (view, volId) => {
        let jobId = await openEditReview(view, volId, {}, { note: '剧情线' });
        (showEditReview(view, jobId), view.renderBody());
    },
    crumbBack: (view, volId) => {
        ((st(view).importing = ''), (sti(view).jobId = ''), volId && (st(view).sel = volId), view.renderBody());
    },
});
// 开始页上的选择存在 sti(view)（切换选项时不丢正在填的原文）。
function keepStartInputs(view, target) {
    let card = target.closest('.pi-card'),
        s = sti(view);
    card && ((s.text = card.querySelector('[data-imp-text]').value), (s.needs = card.querySelector('[data-imp-needs]').value));
}
export const importActions = {
    ...rvActions,
    'import-kind'(view, target) {
        (keepStartInputs(view, target), (sti(view).kind = target.dataset.kind), view.renderBody());
    },
    'import-mode'(view, target, value) {
        keepStartInputs(view, target);
        let s = sti(view),
            clue = s.mode ? s.mode === 'clue' : isClueMode(view.project());
        ((s.mode = value === 'clue' || value === 'outline' ? value : clue ? 'outline' : 'clue'), view.renderBody());
    },
    'import-open-panel'(view) {
        ((st(view).importing = view.projectId), (sti(view).jobId = ''), view.renderBody());
    },
    'import-close'(view) {
        ((st(view).importing = ''), (sti(view).jobId = ''), view.renderBody());
    },
    'edit-back-discuss'(view) {
        ((st(view).importing = ''), (sti(view).jobId = ''), view.go('discuss'));
    },
    'import-back'(view) {
        ((sti(view).jobId = ''), view.renderBody());
    },
    async 'import-pick-file'(view, target) {
        let files = await pickFiles({ accept: '.txt,.md,.markdown,text/plain', multiple: !1 });
        if (!files || !files.length) return;
        let box = target.closest('.pi-card').querySelector('[data-imp-text]'),
            text = await files[0].text();
        box && (box.value = text);
        // 选了文件：记下文件名和字数，显示在原文框下面（第四批）
        keepStartInputs(view, target);
        ((sti(view).file = { name: files[0].name, chars: text.replace(/\s/g, '').length }), view.renderBody());
    },
    async 'import-start'(view, target) {
        let card = target.closest('.pi-card'),
            text = card.querySelector('[data-imp-text]').value,
            needs = card.querySelector('[data-imp-needs]').value.trim(),
            mode = card.querySelector('[data-imp-mode]').value,
            kindBox = card.querySelector('[data-imp-kind]'),
            kind = mode === 'outline' ? 'outline' : mode === 'lines' ? 'lines' : kindBox && ['main', 'side'].includes(kindBox.value) ? kindBox.value : 'main',
            projectId = view.projectId;
        if (!text.trim()) return toast('warning', '先粘贴原文，或选择一个文件。');
        let job = await view.data.imports.create({ projectId, text, mode, needs, kind });
        ((sti(view).text = ''), (sti(view).needs = ''), (sti(view).file = null));
        if ((view.data.updateProject(projectId, (p) => ({ ...p, imports: [...importJobIds(p), job.id] })), view.projectId !== projectId))
            return toast('info', '导入任务已建好，记在原来的项目里。');
        ((sti(view).jobId = job.id), view.renderBody(), importActions['import-run'](view));
    },
    async 'import-open'(view, target) {
        let id = target.dataset.id,
            projectId = view.projectId,
            job = await view.data.imports.load(id).catch(() => null);
        if (view.projectId === projectId) {
            if (!job || job.projectId !== projectId || !importJobIds(view.project()).includes(id))
                return toast('warning', '这个导入任务不属于当前项目。');
            ((sti(view).jobId = id), view.renderBody());
        }
    },
    async 'import-drop'(view, target) {
        if (
            !(await confirmDialog({
                title: '删除导入任务',
                body: '删除这次导入的原文和整理结果。已经采用进大纲的内容不受影响。',
                okLabel: '删除',
                danger: !0,
            }))
        )
            return;
        let id = target.dataset.id,
            projectId = view.projectId;
        importJobIds(view.project()).includes(id) &&
            (await view.data.imports.drop(id),
            view.data.updateProject(projectId, (p) => ({ ...p, imports: importJobIds(p).filter((x) => x !== id) })),
            view.renderBody());
    },
    async 'import-run'(view) {
        let jobId = sti(view).jobId;
        !jobId ||
            !importJobOf(view, jobId) ||
            (await runTask(view, `import:${view.projectId}`, () => runImportJob(view, jobId)).catch((error) =>
                error && error.name === 'AbortError'
                    ? toast('info', '已停止整理。已完成的段已保存，点「继续」接着做。')
                    : toast('error', `整理中断：${error.message}。已完成的部分已保存，点「继续」接着做。`),
            ),
            view.renderBody());
    },
    'import-stop'(view) {
        let jobId = sti(view).jobId;
        jobId && stopImport(jobId) ? view.renderBody() : toast('info', '没有正在进行的整理。');
    },
    // 采用：勾选的阶段合成一卷追加到大纲（R3）。
    //   1. 先按项目现有大纲 + 勾选阶段重算检查（R4），有问题先确认；
    //   2. 大纲和「已采用」标识在同一次项目写入里完成（标识以项目为准）；写入前校验失败（如节点编号重复）就什么都不写，可以重试；
    //   3. 之后把标识同步进任务文件（只是显示用；失败了也不影响，项目里的记录才算数）。
    // 每一步异步等待之后都核对：还是同一个项目、任务属于它（R2）。
    async 'import-adopt'(view, target) {
        let store = view.data.imports,
            jobId = sti(view).jobId,
            projectId = view.projectId,
            job = importJobOf(view, jobId);
        if (!job) return toast('warning', '这个导入任务不属于当前项目。');
        if (job.mode === 'lines') return adoptLinesReview(view, jobId);
        if (importJobKind(job) !== 'outline') return adoptReview(view, jobId);
        let same = () => view.projectId === projectId && importJobOf(view, jobId),
            picked = new Set(
                [...target.closest('.pi-card').querySelectorAll('[data-imp-pick]')].filter((x) => x.checked).map((x) => x.dataset.impPick),
            ),
            adopted = projectAdopted(view.project()),
            cand = importCandidate(job),
            vol = cand.volumes[0],
            take = vol ? vol.stages.filter((st2) => picked.has(st2.key) && !adopted.has(adoptKey(job.id, 0, st2.key))) : [];
        if (!take.length) return toast('info', '没有新勾选的阶段（已采用的不会重复写入）。');
        let { issues, basis } = importAdoptIssues(view, vol, take, cand.index),
            errs = issues.filter((x) => x.level === 'error'),
            warns = issues.filter((x) => x.level !== 'error');
        if (
            (errs.length || warns.length) &&
            !(await confirmDialog({
                title: errs.length ? '勾选的阶段有问题' : '请确认',
                body: `${basis}追加${take.length}个阶段后检查到：`,
                list: [...errs, ...warns].map((x) => x.text).slice(0, 10),
                okLabel: '仍然追加',
                danger: !!errs.length,
            }))
        )
            return;
        if (!same()) return toast('warning', '确认期间切换了项目，没有追加。');
        let keys = take.map((st2) => adoptKey(job.id, 0, st2.key)),
            project = view.project();
        if (keys.some((k) => projectAdopted(project).has(k))) return (toast('info', '这些阶段刚刚已经追加过了。'), view.renderBody());
        let incoming = [{ ...vol, id: makeId('v'), stages: take.map((st2) => ({ ...st2, id: makeId('s') })) }],
            fresh;
        try {
            let [reid, renamed] = reidConflicts(incoming, project.outline.volumes),
                existing = new Set(project.outline.volumes.map((v) => v.key));
            ((fresh = reid.map((v) => (existing.has(v.key) ? { ...v, key: `${v.key}_导入${Date.now().toString(36).slice(-3)}` } : v))),
                renamed.length &&
                    toast(
                        'warning',
                        `有${renamed.length}个节点ID与现有节点重复，已换成新ID：${renamed.slice(0, 5).join('、')}${renamed.length > 5 ? '……' : ''}。`,
                    ));
        } catch (error) {
            return toast('error', `没有追加：${error.message}`);
        }
        (view.data.updateProject(projectId, (p) => ({
            ...p,
            // 先记大纲历史（GPT 代码审阅：按阶段推进的追加也要能撤回）
            outline: { ...p.outline, volumes: [...p.outline.volumes, ...fresh], history: pushOutlineHistory(p.outline.history, p.outline.volumes, '导入追加阶段') },
            importAdopted: [...projectAdopted(p), ...keys],
        })),
            (st(view).sel = fresh[0] && fresh[0].id),
            view.runtime.refresh && view.runtime.refresh(),
            toast('success', `已追加${take.length}个阶段。`),
            view.renderBody(),
            afterAdopt(view),
            await store
                .update(jobId, (j) => ({ ...j, adopted: [.../* @__PURE__ */ new Set([...(j.adopted || []), ...keys])] }))
                .catch(() => {}));
    },
};

// 采用逐页审阅的草稿（导入审阅总方案 4.2 / GPT 审阅 R1）：
//   还有没发的意见 → 先问（先发送意见 / 保存到大纲，暂不发送意见 / 取消）；有确定的错误 → 列出来（取消 / 仍然保存）；只剩要确认的 → 不挡。
//   重新审阅已采用的线：按卷 id 换掉那一卷（prepareCommit 跑历史保护并真正放回已完成的节点）。
//   新导入：分配编号、节点 id 撞号换新，再经 prepareCommit 追加。都先记大纲历史；确认期间大纲变了就不写。
// 「好几条支线」导入里已经保存到大纲的线：会话记的（adoptedLines）+ 项目里的记录（importLineMap、按线已采用标记）。
// 旧任务迁进统一审阅页时会话里还没有记录，要从项目里恢复（GPT 第二轮 N5）。返回 { 卷 id: 大纲里的编号 }。
export function adoptedLinesOf(project, job, review) {
    let out = { ...((review && review.adoptedLines) || {}) },
        ids = (review && review.lineIds) || {},
        adopted = projectAdopted(project);
    for (let v of (review && review.draft) || []) {
        if (out[v.id]) continue;
        let id = ids[v.id] || String((v.line || {}).编号 || '').trim(),
            hit = id && adoptedLineOf(project, job.id, id);
        hit ? (out[v.id] = hit.id || id) : id && adopted.has(adoptKey(job.id, 'line', id)) && (out[v.id] = id);
    }
    return out;
}
// 表格条件没填完的线：不能当成没有条件保存（GPT 第二轮 N2）。跳到那条线的线页，提示补全。返回 true = 拦下了。
async function blockHalfTable(view, jobId, review, vols) {
    let half = incompleteTableLines(vols);
    if (!half.length) return !1;
    let i = reviewUnits(view.project(), review).findIndex((u) => u.volumeId === half[0].id && u.kind === 'line');
    i >= 0 && (await view.data.imports.update(jobId, (j) => ({ ...j, review: { ...j.review, at: i } })));
    view.renderBody();
    toast('warning', `${half.map(lineTitle).join('、')}的表格条件还没填完（表、行、列、值都要有），没有保存。也可以改选别的开始方式。`);
    return !0;
}
// 保存「好几条支线」导入（第二批 b）：规则和旧逐条审阅页的采用一样——
//   不导入的、已经保存过的线跳过；编号和项目里的线撞了就换号（本批内部、之前从这次导入保存过的线的引用一起改）；
//   卷 / 阶段拿新 id，节点 id 撞号换新；记 importLineMap（导入编号 → 卷 id）和按线的已采用标记；保密名单按线记。
//   先记大纲历史；准备和写入之间大纲变了就不写。保存后留在审阅页，保存过的线标「已保存」，可以接着处理其余的线。
async function adoptLinesReview(view, jobId) {
    let projectId = view.projectId,
        job = importJobOf(view, jobId),
        review = job && job.review;
    if (!review || !review.lines) return;
    let pending = sendableNotes(view.project(), review).length;
    if (pending) {
        let pick = await choiceDialog({
            title: '还有意见没发送',
            body: `有${pending}页意见还没用于修改草稿。保存后意见仍会保留。`,
            choices: [
                { label: '取消', value: null },
                { label: '保存到大纲，暂不发送意见', value: 'save' },
                { label: '先发送意见', value: 'send', primary: !0 },
            ],
        });
        if (pick === 'send') return rvActions['rv-send'](view);
        if (pick !== 'save') return;
        if (view.projectId !== projectId || !importJobOf(view, jobId)) return toast('warning', '确认期间切换了项目，没有保存。');
    }
    let project = view.project(),
        ids = review.lineIds || {},
        idOf = (v) => ids[v.id] || String((v.line || {}).编号 || '').trim(),
        adopted = projectAdopted(project),
        done = new Set(review.draft.filter((v) => adopted.has(adoptKey(jobId, 'line', idOf(v))) || adoptedLineOf(project, jobId, idOf(v))).map(idOf)),
        take = linesToAdopt(review, done);
    if (!take.length) return toast('info', '没有要保存的线（不导入的、已经保存过的不会再写）。');
    if (await blockHalfTable(view, jobId, review, take)) return;
    // 问题：线级检查（依赖、开启条件、重复内容……）+ 各页的问题
    let localOk = (job.localIndex || []).filter((x) => isPlainObject(x) && !x.error),
        index = localOk.length ? mergeImportIndex(localOk) : job.index || null,
        lineIssues = lineLevelIssues(view, job, review),
        pageIssues = reviewIssues(view, review, index),
        errs = take.flatMap((v) => [
            ...(lineIssues[v.id] || []).filter((x) => x.level === 'error').map((x) => `${idOf(v)}：${x.text}`),
            ...Object.entries(pageIssues)
                .filter(([k]) => k.split('/')[0] === v.id)
                .flatMap(([, list]) => list.filter((x) => x.level === 'error').map((x) => `${idOf(v)}：${x.plain || x.text}`)),
        ]);
    if (
        errs.length &&
        !(await confirmDialog({
            title: `保存${take.length}条支线到大纲`,
            body: errs.length ? `还有${errs.length}处问题，有问题的线可能一直开始不了。保存后也可以在大纲页「审阅修改…」里再改：` : `要保存：${take.map(idOf).join('、')}。`,
            list: errs.slice(0, 10),
            okLabel: errs.length ? '仍然保存' : '保存',
            danger: !!errs.length,
        }))
    )
        return;
    if (view.projectId !== projectId || !importJobOf(view, jobId)) return toast('warning', '确认期间切换了项目，没有保存。');
    project = view.project();
    let fresh, lineMap, map, renamed;
    try {
        let prior = Object.fromEntries(
                review.draft
                    .map((v) => [idOf(v), adoptedLineOf(project, jobId, idOf(v))])
                    .filter(([, l]) => l)
                    .map(([id, l]) => [id, l.id]),
            ),
            // 线编号用导入时的编号（审阅里线头编号不会被改，这里再确认一次）
            vols = take.map((v) => ({ ...v, line: { ...(v.line || {}), 编号: idOf(v) } })),
            byLine;
        [byLine, map] = reidLines(vols, project.outline.volumes, review.draft.map(idOf), prior);
        let reid;
        [reid, renamed] = reidConflicts(
            byLine.map((v) => ({ ...v, id: makeId('v'), stages: v.stages.map((st0) => ({ ...st0, id: makeId('s') })) })),
            project.outline.volumes,
        );
        let keys2 = new Set(project.outline.volumes.map((v) => v.key));
        fresh = stripReviewMarks(reid.map((v) => (keys2.has(v.key) ? { ...v, key: `${v.key}_导入${Date.now().toString(36).slice(-3)}` } : v)));
        lineMap = Object.fromEntries(take.map((v, i) => [`${jobId}:${idOf(v)}`, fresh[i].id]));
    } catch (error) {
        return toast('error', `没有保存：${error.message}`);
    }
    let keys = take.map((v) => adoptKey(jobId, 'line', idOf(v))),
        prep = prepareCommit(project, fresh, { label: '导入采用' }),
        secrets = importSecretNames(index),
        written = !1;
    view.data.updateProject(projectId, (p) => {
        let w = commitOutline(p, prep);
        if (!w.ok) return p;
        written = !0;
        let sec = withShortAnswers(
            secrets && secrets.length ? { ...(p.secretNames || {}), ...Object.fromEntries(fresh.map((v) => [v.id, { names: secrets, confirmed: [], denied: [] }])) } : p.secretNames,
            fresh.map((v) => v.id),
            review,
        );
        return { ...p, outline: w.outline, importAdopted: [...projectAdopted(p), ...keys], importLineMap: { ...(p.importLineMap || {}), ...lineMap }, ...(sec ? { secretNames: sec } : {}) };
    });
    if (!written) return toast('warning', '确认期间大纲又被改过了，没有写入。请再点一次「保存到大纲」。');
    Object.keys(map).length &&
        toast('warning', `有${Object.keys(map).length}条支线的编号和已有的线重复，已换成：${Object.entries(map).map(([a, b]) => `${a}→${b}`).join('、')}（本批内部的引用一起改了）。`);
    renamed.length && toast('warning', `有${renamed.length}个节点ID与现有节点重复，已换成新ID。`);
    // 会话里记下保存过的线（卷 id → 大纲里的编号）。这些线的意见留着只读（保存前说过「意见会留在页上」，GPT 第二轮 N6），不再发送
    let saved = Object.fromEntries(take.map((v, i) => [v.id, String((fresh[i].line || {}).编号 || idOf(v))]));
    await view.data.imports
        .update(jobId, (j) => ({
            ...j,
            review: {
                ...j.review,
                adoptedLines: { ...(j.review.adoptedLines || {}), ...saved },
            },
            adopted: [...new Set([...(j.adopted || []), ...keys])],
        }))
        .catch(() => {});
    (view.runtime.refresh && view.runtime.refresh(), toast('success', `已保存${take.length}条支线到大纲。`), view.renderBody(), afterAdopt(view));
}
// 审阅里回答过的疑似短名（是同一人 / 不是）写进这几条线的保密名单（用户 2026-11-17），以后审阅修改、检查、发给 AI 都按它。
function withShortAnswers(sec, ids, review) {
    let sure = (review && review.shortsSure) || [],
        not = (review && review.shortsNot) || [];
    if (!sure.length && !not.length) return sec;
    let out = { ...(sec || {}) };
    for (let id of ids) {
        let cur = out[id] || { names: [], confirmed: [], denied: [] };
        out[id] = {
            ...cur,
            confirmed: [...new Set([...(cur.confirmed || []).filter((n) => !not.includes(n)), ...sure])],
            denied: [...new Set([...(cur.denied || []).filter((n) => !sure.includes(n)), ...not])],
        };
    }
    return out;
}

async function adoptReview(view, jobId) {
    let projectId = view.projectId,
        job = importJobOf(view, jobId),
        review = job && job.review;
    if (!review) return;
    let isEdit = importJobKind(job) === 'edit',
        line0 = review.draft[0] && review.draft[0].line;
    if (await blockHalfTable(view, jobId, review, isEdit || review.reopened ? editedVolumes(review) : review.draft)) return;
    if (!isEdit && isPlainObject(line0) && !line0.编号 && !line0.开启条件 && !line0.开始时机已选 && !line0.开启方式 && !line0.接上一条) {
        (await view.data.imports.update(jobId, (j) => ({ ...j, review: { ...j.review, at: 0 } })), view.renderBody());
        return toast('warning', '先在第1页选这条线什么时候开始。');
    }
    let pending = Object.values(review.comments || {}).filter((c) => String(c || '').trim()).length,
        localOk = (job.localIndex || []).filter((x) => isPlainObject(x) && !x.error),
        index = localOk.length ? mergeImportIndex(localOk) : job.index || null,
        all = Object.values(reviewIssues(view, review, index)).flat(),
        errs = all.filter((x) => x.level === 'error'),
        asks = all.filter((x) => x.level !== 'error'),
        lines = [
            errs.length ? `还有${errs.length}个问题没解决：${errs.slice(0, 3).map((x) => x.plain || x.text).join('；')}` : '',
            asks.length ? `另有${asks.length}个问题你没回答，按原样保留。` : '',
        ].filter(Boolean);
    // 还有意见没发给 AI（用户 2026-11-16：流程要闭合，提示要能直接去发送）
    if (pending) {
        let pick = await choiceDialog({
            title: '还有意见没发送',
            body: `有${pending}页意见还没用于修改草稿。保存后意见仍会保留。`,
            choices: [
                { label: '取消', value: null },
                { label: '保存到大纲，暂不发送意见', value: 'save' },
                { label: '先发送意见', value: 'send', primary: !0 },
            ],
        });
        if (pick === 'send') return rvActions['rv-send'](view);
        if (pick !== 'save') return;
        if (view.projectId !== projectId || !importJobOf(view, jobId)) return toast('warning', '确认期间切换了项目，没有保存。');
    }
    let project = view.project(),
        reopen = isEdit ? review.draft.some((v) => project.outline.volumes.some((x) => x.id === v.id)) : !!(review.reopened && review.adoptedId && project.outline.volumes.some((v) => v.id === review.adoptedId)),
        draft = review.draft,
        renamed = [],
        savedIds = [];
    if (isEdit && !reopen) return toast('warning', '大纲里找不到这些线了（可能删掉了），没有保存。');
    // 改已有的线（审阅修改、导入后重新审阅）：只写有修改的线（第二批：一次审阅可以有好几条线）。
    // 打开审阅以后，某条线在大纲里又被别处改过 → 先列出别处的改动，用户确认才拿草稿覆盖。基准是打开时的样子（review.base），各条线分别核对（GPT 代码审阅 R2）。
    if (reopen) {
        // 只保存这次审阅里实际改过的线（打开时的样子 → 草稿）；没动过、但大纲里别处改了的线不碰（GPT 第二轮 N1）
        let live = (id) => project.outline.volumes.find((v) => v.id === id),
            mine = editedVolumes(review),
            gone = mine.filter((v) => !live(v.id)).map(lineTitle);
        draft = mine.filter((v) => live(v.id) && draftDiffers([live(v.id)], [v]));
        gone.length && toast('warning', `${gone.join('、')}在大纲里已经删掉了，这些线的修改没有保存。`);
        if (!draft.length) return toast('info', '和大纲里现在的一样，没有要保存的。');
        let elsewhere = draft.flatMap((v) => {
            let opened = (review.base || []).find((x) => x.id === v.id),
                now = live(v.id);
            return opened && now && draftDiffers([opened], [now]) ? draftChanges([opened], [now]).flatMap((c) => c.changes).map((t) => (draft.length > 1 || review.draft.length > 1 ? `${lineTitle(v)}：${t}` : t)) : [];
        });
        if (elsewhere.length) {
            if (
                !(await confirmDialog({
                    title: '大纲里已有新改动',
                    body: '打开审阅以后，大纲里这些内容又被改过。保存草稿会覆盖下面这些改动（大纲历史里可以找回）。草稿和意见都还在，可以先取消，核对后再保存。',
                    list: elsewhere.slice(0, 12),
                    okLabel: '仍然保存草稿',
                    danger: !0,
                }))
            )
                return;
            if (view.projectId !== projectId || !importJobOf(view, jobId)) return toast('warning', '确认期间切换了项目，没有保存。');
            project = view.project();
        }
        savedIds = draft.map((v) => v.id);
    } else {
        if (projectAdopted(project).has(adoptKey(jobId, 'review', 0)) || review.adoptedId) return (toast('info', '这条线已经保存到大纲了。'), view.renderBody());
        try {
            let plan = adoptPlan(view, job, review);
            ((draft = plan.vols), (renamed = plan.renamed));
        } catch (error) {
            return toast('error', `没有采用：${error.message}`);
        }
    }
    // 先按这个聊天的进度准备最终要写的内容（放回已完成的节点），确认框里写的是最终结果和对进度的影响（GPT 代码审阅 R8）
    let label = isEdit ? '审阅修改' : reopen ? '重新审阅保存' : '导入采用',
        prepare = () => {
            let p = view.project(),
                c = reopen && view.runtime.activeId() === projectId && isClueMode(p) ? view.runtime.clue.compute() : null;
            return prepareCommit(p, draft, { clue: c ? { snap: c.snap, prog: c.prog, config: normalizeClue(p.clue) } : null, label });
        },
        effects = (pr) => [...(pr.guard ? [...pr.guard.diffs, ...pr.guard.notes] : []), ...(pr.restored.length ? [`已经完成的节点会保留：${pr.restored.join('、')}（完成条件不变）`] : [])],
        prep = prepare(),
        shown = effects(prep),
        // 确认框弹出时目标线在大纲里的样子：确认期间被改过或删掉就不写（GPT 第二轮 N1：重算进度可以，不能顺手接受新的大纲内容）
        stamp0 = reopen ? targetStamp(view.project(), savedIds) : '';
    if (reopen && (errs.length || (prep.guard && prep.guard.diffs.length))) {
        let titleOf = (key) => lineTitle(draft.find((v) => v.id === key.split('/')[0]) || { key: '' }),
            changes = prep.changes.flatMap((c) => (draft.length > 1 ? c.changes.map((t) => `${titleOf(c.key)}：${t}`) : c.changes));
        if (
            !(await confirmDialog({
                title: '保存到大纲',
                body: [`改动如下${shown.length ? '；按这个聊天的进度：' : '。'}`, ...lines].join('\n'),
                list: [...changes.slice(0, 12), ...shown],
                okLabel: '保存',
                danger: !!errs.length || !!(prep.guard && prep.guard.diffs.length),
            }))
        )
            return;
    } else if (!reopen && errs.length && !(await confirmDialog({ title: `保存「${volumeLabelOf(review)}」到大纲`, body: lines.join('\n'), okLabel: '仍然保存', danger: !!errs.length }))) return;
    if (view.projectId !== projectId || !importJobOf(view, jobId)) return toast('warning', '确认期间切换了项目，没有保存。');
    if (reopen && targetStamp(view.project(), savedIds) !== stamp0) return toast('warning', '确认期间大纲里这些线又被改过（或删掉了），没有保存。草稿和意见都还在，请再点一次核对。');
    // 确认期间聊天进度变了（比如又推进了一楼）：按新进度重算；影响和刚才显示的不一样就不写，请用户再核对
    let again = prepare();
    if (JSON.stringify(effects(again)) !== JSON.stringify(shown)) return toast('warning', '确认期间剧情进度变了，对进度的影响和刚才显示的不同，没有保存。请再点一次核对。');
    prep = again;
    let secretNames = isEdit ? null : importSecretNames(index),
        written = null;
    view.data.updateProject(projectId, (p) => {
        let w = commitOutline(p, prep);
        if (!w.ok) return p;
        written = w;
        let keys = reopen || isEdit ? [] : [adoptKey(jobId, 'review', 0), ...draft[0].stages.map((st0) => adoptKey(jobId, 0, st0.key))],
            sec = withShortAnswers(
                secretNames && secretNames.length ? { ...(p.secretNames || {}), [draft[0].id]: { names: secretNames, confirmed: [], denied: [] } } : p.secretNames,
                draft.map((v) => v.id),
                review,
            );
        return { ...p, outline: w.outline, importAdopted: [...projectAdopted(p), ...keys], ...(sec ? { secretNames: sec } : {}) };
    });
    if (!written) return toast('warning', '确认期间大纲又被改过了，没有写入。请再点一次「保存到大纲」。');
    prep.restored.length && toast('info', `已保留已经完成的节点：${prep.restored.join('、')}（完成条件不变）。`);
    renamed.length && toast('warning', `有${renamed.length}个节点ID与现有节点重复，已换成新ID。`);
    if (isEdit) {
        // 审阅修改（项目里的线）：保存过的线以大纲为新基准，留在审阅页；没发送的意见留着（保存时说过「意见会留在页上」）
        let byId = new Map(prep.volumes.filter((v) => savedIds.includes(v.id)).map((v) => [v.id, v]));
        await view.data.imports
            .update(jobId, (j) => ({
                ...j,
                review: {
                    ...j.review,
                    draft: j.review.draft.map((v) => byId.get(v.id) || v),
                    base: j.review.base.map((v) => byId.get(v.id) || v),
                    history: [],
                    lastChanges: {},
                    revised: !1,
                    savedAt: Date.now(),
                },
            }))
            .catch(() => {});
        return (view.runtime.refresh && view.runtime.refresh(), toast('success', `已保存到大纲${byId.size > 1 ? `（${byId.size}条）` : ''}。`), view.renderBody(), afterAdopt(view));
    }
    let saved = prep.volumes.find((v) => v.id === draft[0].id) || draft[0];
    await view.data.imports
        .update(jobId, (j) => ({
            ...j,
            review: { ...j.review, draft: [saved], base: [saved], adoptedId: saved.id, reopened: !1, history: [], lastChanges: {}, revised: !1 },
            adopted: [...new Set([...(j.adopted || []), adoptKey(jobId, 'review', 0)])],
        }))
        .catch(() => {});
    (view.runtime.refresh && view.runtime.refresh(), toast('success', reopen ? '已保存到大纲。' : `已保存到大纲：${volumeLabelOf(review)}。`), view.renderBody(), afterAdopt(view));
}

// 审阅修改（讨论页、大纲页顶部「审阅修改…」、大纲页选中的线）：每个项目一个「审阅修改」任务，里面是项目里所有的线
// （存在导入记录里，关掉再打开还在），打开和导入同一个逐页审阅页，跳到选中的那条线。第二批（用户 2026-11-16）。
// 再次打开时和大纲对齐：大纲里新加的线补进来；没改过的线换成大纲现在的样子；大纲里删掉、草稿也没改过的线去掉。
// parts：{ 单位键: 解析结果 }，可空。返回任务 id。
export function syncEditSession(project, review) {
    let live = project.outline.volumes,
        base = review.base || [],
        edited = (v) => {
            let b = base.find((x) => x.id === v.id);
            return !b || draftDiffers([b], [v]);
        },
        // 只写过意见、还没改正文的线：大纲里删掉了也留着，意见才看得到（GPT 第二轮 N6）
        noted = (v) => Object.entries(review.comments || {}).some(([k, t]) => k.split('/')[0] === v.id && String(t || '').trim()),
        draft = [],
        nextBase = [],
        synced = new Set();
    for (let lv of live) {
        let d = review.draft.find((v) => v.id === lv.id);
        d && edited(d) ? (draft.push(d), nextBase.push(base.find((x) => x.id === lv.id) || lv)) : (draft.push(lv), nextBase.push(lv), synced.add(lv.id));
    }
    // 大纲里删掉了，但草稿里改过或写了意见：留着（保存时不会写回，提示已删除）
    for (let d of review.draft) !live.some((v) => v.id === d.id) && (edited(d) || noted(d)) && (draft.push(d), nextBase.push(base.find((x) => x.id === d.id) || d));
    // 撤销记录里没动过的线也换成大纲现在的样子：撤销只退回当时实际改的线，不把别处的新改动退掉（GPT 第二轮 N1）
    let history = (review.history || []).map((h) => ({ ...h, draft: draft.map((v) => (synced.has(v.id) ? v : (h.draft || []).find((x) => x.id === v.id) || v)) }));
    return { ...review, draft, base: nextBase, history };
}
export async function openEditReview(view, volumeId, parts = {}, { note = '' } = {}) {
    let project = view.project(),
        live = project.outline.volumes.find((v) => v.id === volumeId);
    if (!live) throw new Error('大纲里找不到这条线了（可能删掉了）');
    // 先把这个项目的导入记录都载入：找已有的审阅修改任务、提示还没保存的导入都要用（没载入的会被当成不存在）
    await Promise.all(importJobIds(project).filter((id) => !view.data.imports.get(id)).map((id) => view.data.imports.load(id).catch(() => null)));
    let mode = isClueMode(project) ? 'clue' : 'outline',
        unitsOf = (draft) => sessionUnits({ draft }).filter((u) => u.kind === 'stage' || (mode === 'clue' && isPlainObject(draft.find((v) => v.id === u.volumeId).line))),
        keys = Object.keys(parts),
        open = importJobIds(project)
            .map((id) => view.data.imports.get(id))
            .find((j) => j && importJobKind(j) === 'edit' && j.review && Array.isArray(j.review.draft));
    if (open) {
        await view.data.imports.update(open.id, (j) => {
            let r = { ...syncEditSession(project, j.review), mode };
            keys.length && (r = editDraft(r, '讨论里AI给的修改', (d) => keys.reduce((acc, k) => putUnit(acc, k, parts[k]), d)));
            let units = unitsOf(r.draft),
                at = keys.length ? units.findIndex((u) => keys.includes(u.key)) : units.findIndex((u) => u.volumeId === volumeId);
            return { ...j, review: { ...r, at: Math.max(0, at) } };
        });
        return open.id;
    }
    let session = createReviewSession({ source: 'proposal', projectId: project.id, volumes: project.outline.volumes }),
        draft = keys.reduce((acc, k) => putUnit(acc, k, parts[k]), session.draft),
        units = unitsOf(draft),
        at = keys.length ? units.findIndex((u) => keys.includes(u.key)) : units.findIndex((u) => u.volumeId === volumeId),
        ch = Object.fromEntries(draftChanges(session.base, draft).map((x) => [x.key, x.changes])),
        job = await view.data.imports.create({ projectId: project.id, text: note, mode, needs: '', kind: 'edit' });
    await view.data.imports.update(job.id, (j) => ({
        ...j,
        step: 'review',
        review: { ...session, mode, draft, at: Math.max(0, at), revised: keys.length > 0, lastChanges: ch, history: keys.length ? [{ label: '讨论里AI给的修改', at: Date.now(), draft: session.base }] : [] },
    }));
    view.data.updateProject(project.id, (p) => ({ ...p, imports: [...importJobIds(p), job.id] }));
    return job.id;
}
// 讨论页 →（大纲页）审阅修改：打开导入面板里的这个任务。
export function showEditReview(view, jobId) {
    ((st(view).importing = view.projectId), (sti(view).jobId = jobId));
}
function volumeLabelOf(review) {
    let v = review.draft[0];
    return v ? String(v.key || '').replace(/^剧情_/, '').replace(/^卷[^_]*_/, '') : '';
}

// 同时请求的上限（用户 2026-11-17：最多 3 个，免得撞上模型服务的频率限制）。
const IMPORT_CONCURRENCY = 3;
// 按上限并发跑一组任务。某个任务出错时其余照常跑完（各自的结果已存进任务），最后抛出第一个错误，
// 界面上「继续」只会重跑没成功的批次。
async function runPool(tasks, limit, still = () => !0) {
    let next = 0,
        first = null;
    let worker = async () => {
        for (; next < tasks.length && still(); ) {
            let k = next++;
            try {
                await tasks[k]();
            } catch (error) {
                first || (first = error);
            }
        }
    };
    await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, worker));
    if (first) throw first;
}

export async function runLineDrafts(view, jobId, parts, partText, local, index, still) {
    let store = view.data.imports,
        ident = mergeLineIdentity(local),
        tables = currentTables(),
        catalog = tables ? tableCatalogText(tables) : '',
        mains = mainLinesText(view.project().outline.volumes);
    await store.update(jobId, (j) => ({ ...j, lineIdent: ident }));
    for (let p of parts) {
        let groups = importLineBatches(ident.lines, p.i);
        // 同一段里的几批线互不依赖（各写各的线），最多 IMPORT_CONCURRENCY 批同时请求（实测：15 条支线逐批等太慢）。
        // 段和段之间仍按顺序：后一段要接着前一段已经写出的同一条线（done）。
        await runPool(
            (groups.length ? groups : []).map((only, g) => () => draftBatch(p, g, only)),
            IMPORT_CONCURRENCY,
            still,
        );
        if (!still()) return;
        groups.length ||
            store.get(jobId).drafts[p.i] ||
            (await store.update(jobId, (j) => ({ ...j, drafts: { ...j.drafts, [p.i]: { list: [] } } })));
    }
    async function draftBatch(p, g, only) {
            if (!still()) return;
            let cur = store.get(jobId),
                slot = (cur.drafts[p.i] && cur.drafts[p.i].list) || [];
            if (slot[g] && !slot[g].error) return;
            let done = importDoneText(
                    mergeImportByLine(
                        Object.values(cur.drafts).flatMap((d) => (d.list || []).filter((x) => x && !x.error).flatMap((x) => x.volumes || [])),
                    ),
                ),
                draft = (ids) =>
                    askLive(
                        view,
                        jobId,
                        `第${p.i + 1}段第${g + 1}批`,
                        importLineDraftMessages({
                            part: { ...p, text: partText(p) },
                            index: stringifyYaml(importIndexForPart(index, p.i)),
                            lines: ident.lines,
                            only: ids,
                            mainLines: mains,
                            tableCatalog: catalog,
                            needs: cur.needs,
                            done,
                        }),
                    ),
                r = parseOutlineReply(await draft(only));
            (r.ok && r.volumes.length) ||
                (r = parseOutlineReply(await askLive(view, jobId, `第${p.i + 1}段第${g + 1}批`, fixYamlMessages(r.yaml, r.error || '没有读到任何剧情线（YAML 顶层的卷）', 'clue'))));
            let lost = r.ok ? lineIdsMissing(r.volumes, only) : [];
            if (lost.length && still()) {
                let r2 = parseOutlineReply(await draft(lost));
                (r2.ok &&
                    (r = {
                        ...r,
                        yaml: `${r.yaml}
${r2.yaml}`,
                        volumes: [...r.volumes, ...r2.volumes],
                    }),
                    (lost = lineIdsMissing(r.volumes, only)));
            }
            let entry =
                r.ok && r.volumes.length && !lost.length
                    ? { only, yaml: r.yaml, volumes: r.volumes, notes: splitImportAuthorFields(r.volumes, p).notes }
                    : { only, error: lost.length ? `AI没写${lost.join('、')}` : r.error || '没有读到任何剧情线', yaml: r.yaml };
            (await store.update(jobId, (j) => {
                let list = [...((j.drafts[p.i] && j.drafts[p.i].list) || [])];
                return ((list[g] = entry), { ...j, drafts: { ...j.drafts, [p.i]: { list } } });
            }),
                view.renderBody());
    }
    let fin = store.get(jobId);
    if (importFailedParts(fin).length) return void (await store.update(jobId, (j) => ({ ...j, step: 'draft' })));
    let lr = fin.lineReview || lineReviewFromJob(fin);
    (await store.update(jobId, (j) => ({ ...j, step: 'review', review: j.review && j.review.lines ? j.review : linesSessionOf({ ...j, lineReview: lr }) })), view.renderBody());
}

// 「好几条支线」导入：只重新整理一条线（GPT 代码审阅第 2 点：重复内容由作者选一条重新整理，别的线不重跑）。
// 用这条线出现过的各段原文、线身份表重新让 AI 只写这一条；结果替换审阅里这条线的草稿（卷 id、编号、类型保留，意见留着）。
// 原来的草稿记进这一条的 prev，可以对照。返回 { ok, why }。
export async function redraftLine(view, jobId, lineId) {
    let store = view.data.imports,
        job = importJobOf(view, jobId);
    let r0 = job && job.review && job.review.lines ? job.review : null,
        vid0 = r0 ? Object.keys(r0.lineIds || {}).find((k) => r0.lineIds[k] === lineId) : '';
    if (!vid0) return { ok: !1, why: '找不到这条线' };
    let text = await store.source(jobId),
        ident = job.lineIdent || mergeLineIdentity((job.localIndex || []).filter((x) => isPlainObject(x) && !x.error)),
        me = (ident.lines || []).find((l) => l.编号 === lineId),
        parts = (job.parts || []).filter((p) => !me || !Array.isArray(me.parts) || me.parts.includes(p.i)),
        partText = (p) => text.slice(Math.max(0, p.start - p.lead), p.end),
        // 别的线：审阅会话里的当前草稿
        others = r0.draft.filter((v) => v.id !== vid0),
        tables = currentTables(),
        got = [],
        // 发请求时这条线的草稿（GPT 第二轮 N7）：回复回来时草稿被改过 → 不替换
        snapVol = JSON.stringify(r0.draft.find((v) => v.id === vid0) || null);
    for (let p of parts) {
        let r = parseOutlineReply(
            await ask(
                view,
                'outline',
                importLineDraftMessages({
                    part: { ...p, text: partText(p) },
                    index: stringifyYaml(job.index || {}),
                    lines: ident.lines,
                    only: [lineId],
                    mainLines: mainLinesText(view.project().outline.volumes),
                    tableCatalog: tables ? tableCatalogText(tables) : '',
                    needs: job.needs,
                    // 别的线已经写好的内容：告诉 AI 这些属于别的线，不要再写进这一条
                    done: importDoneText([...others, ...got]),
                }),
            ),
        );
        r.ok || (r = parseOutlineReply(await ask(view, 'outline', fixYamlMessages(r.yaml, r.error || '格式错误', 'clue'))));
        r.ok && got.push(...r.volumes.filter((v) => isPlainObject(v.line) && String(v.line.编号 || '').trim() === lineId));
    }
    if (!importJobOf(view, jobId)) return { ok: !1, why: '确认期间切换了项目' };
    if (!got.length) return { ok: !1, why: 'AI没有写出这条线' };
    let merged = splitImportAuthorFields(mergeImportByLine(got)).volumes.find((v) => isPlainObject(v.line));
    if (!merged) return { ok: !1, why: 'AI没有写出这条线' };
    let touched = !1;
    await store.update(jobId, (j) => {
        let r = j.review && j.review.lines ? j.review : null,
            volId = vid0,
            cur = r && r.draft.find((v) => v.id === volId);
        if (!cur) return j;
        // 等回复期间这条线的草稿被改过：不替换（GPT 第二轮 N7）
        if (JSON.stringify(cur) !== snapVol) return ((touched = !0), j);
        // 阶段按名称 / 共有节点对应保留 id（matchStages）；编号、类型由程序保留（类型只在新建时选）
        let type0 = String(((cur && cur.line) || {}).类型 || '').trim(),
            vol = { ...merged, id: volId, line: { ...merged.line, 编号: lineId, ...(type0 ? { 类型: type0 } : {}) }, stages: matchStages(cur.stages, merged.stages).stages };
        // 审阅会话：换掉这条线的草稿（记一笔撤回点），记下重新整理前的内容。
        // 意见都留着：重新整理不带意见发给 AI，没有「处理过」的意见可清（GPT 第二轮 N7）；用户看过新稿后自己删或发送
        let next = editDraft(r, `重新整理${lineId}`, (d) => d.map((v) => (v.id === volId ? vol : v)));
        return { ...j, review: { ...next, prev: { ...(r.prev || {}), [volId]: cur } } };
    });
    if (touched) return { ok: !1, why: '等待期间这条线被改过，没有替换（你的修改和意见都还在），需要的话再点一次' };
    return { ok: !0 };
}
