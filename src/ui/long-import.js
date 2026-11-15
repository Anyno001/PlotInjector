import {
    splitLongText,
    mergeImportIndex,
    importIndexMessages,
    importIndexMissing,
    importIndexRetryMessages,
    importDoneText,
    mergeImportParts,
    importDraftMessages,
    splitImportAuthorFields,
    checkImportDraft,
    importConflictText,
    importReachIssues,
    IMPORT_NEEDS_EXAMPLE,
} from '../core/long-import.js';
import { isPlainObject, stageLabel, stageNodes, makeId } from '../core/outline.js';
import { stringifyYaml, parseYaml } from '../core/yaml.js';

import { ask, runTask } from './ai.js';

import { extractYaml, fixYamlMessages, parseOutlineReply } from '../core/prompts.js';

import { isClueMode, nodeUid, reidConflicts } from '../core/clue-model.js';

import { chatFactSets, checkClueDraft } from '../core/clue-project.js';

import { esc, options, pickFiles, confirmDialog } from './dom.js';

import { toast } from '../host/st.js';
import { adoptKey } from '../app/import-store.js';

import { st } from './tab-outline.js';

export const IMPORT_PART_CHARS = 8e3;

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
    let store = view.data.imports,
        job = await store.load(jobId),
        text = await store.source(jobId),
        task = { projectId: view.projectId };
    if (!job) throw new Error('找不到这个导入任务');
    if (job.projectId !== task.projectId) throw new Error('这个导入任务不属于当前项目');
    let still = () => view.projectId === task.projectId && store.get(jobId);
    let parts =
        job.parts && job.parts.length ? job.parts : splitLongText(text, { target: IMPORT_PART_CHARS }).map(({ text: _t, ...p }) => p);
    (job.parts && job.parts.length) || (await store.update(jobId, (j) => ({ ...j, parts, step: 'index' })));
    let partText = (p) => text.slice(Math.max(0, p.start - p.lead), p.end),
        ok = (x) => isPlainObject(x) && !x.error,
        local = [...(store.get(jobId).localIndex || [])];
    // 1. 索引
    for (let p of parts) {
        if (!still()) return;
        if (ok(local[p.i])) continue;
        let prev = local.filter(ok).length ? stringifyYaml(mergeImportIndex(local.filter(ok))) : '',
            msgs = importIndexMessages({ part: { ...p, text: partText(p) }, total: parts.length, prev, needs: job.needs }),
            reply2 = await ask(view, 'outline', msgs),
            parsed = null;
        let read = (t) => {
            let v = parseYaml(extractYaml(t));
            if (!isPlainObject(v)) throw new Error('没有读到索引内容');
            return v;
        };
        try {
            parsed = read(reply2);
        } catch {
            try {
                parsed = read(await ask(view, 'outline', fixYamlMessages(extractYaml(reply2), '格式错误', 'outline')));
            } catch (error) {
                parsed = { error: `第 ${p.i + 1} 段的索引读不出来：${error.message}` };
            }
        }
        // 索引里一个事实都没有：补问一次（实测：短材料只有一段时模型会漏掉「事实」一节）。补问失败就用原来的。
        let miss = ok(parsed) ? importIndexMissing(parsed) : [];
        if (miss.length)
            try {
                let again = read(await ask(view, 'outline', importIndexRetryMessages(msgs, reply2, miss)));
                importIndexMissing(again).length < miss.length && (parsed = again);
            } catch {}
        ((local[p.i] = parsed), await store.update(jobId, (j) => ({ ...j, localIndex: local, step: 'index' })), view.renderBody());
    }
    let index = mergeImportIndex(local.filter(ok));
    await store.update(jobId, (j) => ({ ...j, index, step: 'draft' }));
    // 2. 转写
    for (let p of parts) {
        if (!still()) return;
        let cur = store.get(jobId);
        if (cur.drafts[p.i] && !cur.drafts[p.i].error) continue;
        let good = Object.values(cur.drafts).filter((d) => !d.error),
            done = importDoneText(mergeImportParts(good.flatMap((d) => d.volumes || []))),
            prevTail =
                p.i && cur.drafts[p.i - 1] && !cur.drafts[p.i - 1].error
                    ? String(cur.drafts[p.i - 1].yaml || '')
                          .split('\n')
                          .slice(-25)
                          .join('\n')
                    : '';
        let reply2 = await ask(
                view,
                'outline',
                importDraftMessages({
                    part: { ...p, text: partText(p) },
                    index: stringifyYaml(index),
                    prevTail,
                    mode: cur.mode,
                    needs: cur.needs,
                    done,
                }),
            ),
            r = parseOutlineReply(reply2);
        (r.ok && r.volumes.length) ||
            (r = parseOutlineReply(await ask(view, 'outline', fixYamlMessages(r.yaml, r.error || '没有读到任何阶段', cur.mode))));
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

export function importFailedParts(job) {
    let parts = job.parts || [],
        local = job.localIndex || [],
        drafts = job.drafts || {};
    return parts
        .map((p) => {
            let why =
                local[p.i] && local[p.i].error
                    ? local[p.i].error
                    : drafts[p.i] && drafts[p.i].error
                      ? `第 ${p.i + 1} 段转写失败：${drafts[p.i].error}`
                      : !drafts[p.i]
                        ? `第 ${p.i + 1} 段还没整理`
                        : '';
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
        ? `按当前聊天的进度判断（已确认 ${known.length} 个事实${claimed.length ? `，另有 ${claimed.length} 个已出现的说法` : ''}）。`
        : '这个项目没有在当前聊天启用，按大纲本身判断（不计任何聊天的进度）。';
    issues.push(...importReachIssues(applied, { only: names, knownFacts: known, claimedFacts: claimed }));
    issues.push(
        ...checkClueDraft(added, project.outline.volumes, { isObtained: (id) => known.includes(id) })
            .filter((x) => /^事实编号 /.test(x))
            .map((text) => ({ level: 'warn', text })),
    );
    return { issues, basis };
}

export function renderImport(view) {
    let s = sti(view),
        project = view.project(),
        ids = importJobIds(project),
        busy = view.busy[`import:${view.projectId}`];
    s.jobId && !importJobOf(view, s.jobId) && view.data.imports.get(s.jobId) && (s.jobId = '');
    if (!s.jobId) {
        // 重新打开酒馆后，之前的任务还没读进内存：先读一次再显示列表（实测：重载后列表是空的）。读不到的只读一次，不反复重试（R11）。
        let missing = ids.filter((id) => !view.data.imports.get(id) && !(s.unreadable || []).includes(id));
        if (missing.length && !s.loadingList)
            return (
                (s.loadingList = !0),
                Promise.all(missing.map((id) => view.data.imports.load(id).catch(() => null)))
                    .then((got) => {
                        s.unreadable = [...new Set([...(s.unreadable || []), ...missing.filter((_, k) => !got[k])])];
                    })
                    .finally(() => ((s.loadingList = !1), view.renderBody())),
                '<div class="pi-empty"><span class="pi-spin"></span> 正在读取导入记录…</div>'
            );
        let list = ids.map((id) => view.data.imports.get(id)).filter(Boolean),
            lost = (s.unreadable || []).filter((id) => ids.includes(id));
        return `<div class="pi-card"><h3>导入长文<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="import-close">返回大纲</button></h3>
        <label class="pi-field"><span>原文（粘贴，或选择 txt / md 文件）</span><textarea class="pi-ta is-tall" data-imp-text></textarea></label>
        <div class="pi-tools is-c1"><button type="button" class="pi-btn is-sm" data-act="import-pick-file">选择文件…</button></div>
        <label class="pi-field"><span>要求</span><textarea class="pi-ta" rows="4" data-imp-needs placeholder="${esc(IMPORT_NEEDS_EXAMPLE)}"></textarea></label>
        <label class="pi-field"><span>整理成</span><select class="pi-sel" data-imp-mode>${options(
            [
                { value: 'clue', label: '线索推进的大纲' },
                { value: 'outline', label: '按阶段推进的大纲' },
            ],
            isClueMode(project) ? 'clue' : 'outline',
        )}</select></label>
        <div class="pi-tools is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="import-start">开始整理</button></div></div>
        ${list.length || lost.length ? `<div class="pi-card"><h3>之前的导入</h3>${list.map((j) => `<div class="pi-set-row"><span>${esc(new Date(j.createdAt).toLocaleString('zh-CN', { hour12: !1 }))} · ${j.chars} 字 · ${j.step === 'review' ? '可以审阅' : '未完成'}</span><span class="pi-spacer"></span><button type="button" class="pi-btn is-sm" data-act="import-open" data-id="${esc(j.id)}">打开</button><button type="button" class="pi-btn is-sm is-ghost is-danger" data-act="import-drop" data-id="${esc(j.id)}">删除</button></div>`).join('')}${lost.map((id) => `<div class="pi-set-row"><span class="is-warn">读不到这条导入记录的文件</span><span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost is-danger" data-act="import-drop" data-id="${esc(id)}">移除</button></div>`).join('')}</div>` : ''}`;
    }
    let job = importJobOf(view, s.jobId);
    if (!job)
        return s.loadingJob
            ? '<div class="pi-empty"><span class="pi-spin"></span> 正在读取导入任务…</div>'
            : ((s.loadingJob = !0),
              view.data.imports
                  .load(s.jobId)
                  .catch(() => null)
                  .then((j) => {
                      (j && j.projectId === view.projectId) || ((s.jobId = ''), toast('warning', '读不到这个导入任务。'));
                  })
                  .finally(() => ((s.loadingJob = !1), view.renderBody())),
              '<div class="pi-empty"><span class="pi-spin"></span> 正在读取导入任务…</div>');
    let parts = job.parts || [],
        indexed = (job.localIndex || []).filter((x) => isPlainObject(x) && !x.error).length,
        drafted = Object.values(job.drafts || {}).filter((d) => !d.error).length,
        total = parts.length,
        failed = importFailedParts(job).filter((f) => !/还没整理/.test(f.why));
    let progress = `<p class="pi-hint">共 ${total || '?'} 段 · 已读 ${indexed} 段 · 已整理 ${drafted} 段${job.step === 'review' ? ' · 已完成' : ''}</p>${failed.map((f) => `<p class="pi-hint is-warn">· ${esc(f.why)}</p>`).join('')}`;
    if (job.step !== 'review')
        return `<div class="pi-card"><h3>导入长文<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="import-back">返回</button></h3>${progress}
        <div class="pi-tools is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="import-run"${busy ? ' disabled' : ''}>${busy ? '<span class="pi-spin"></span>整理中' : failed.length ? '重试失败的段' : drafted || indexed ? '继续' : '开始'}</button></div></div>`;
    let cand = importCandidate(job),
        adopted = projectAdopted(project),
        stages = cand.volumes[0] ? cand.volumes[0].stages : [];
    let errs = cand.issues.filter((x) => x.level === 'error'),
        warns = cand.issues.filter((x) => x.level !== 'error'),
        pending = (cand.index && cand.index.待确认) || [];
    return `<div class="pi-card"><h3>审阅导入结果<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="import-back">返回</button></h3>${progress}
        ${errs.length ? `<p class="pi-hint is-warn"><b>需要处理（${errs.length}）</b></p>${errs.map((x) => `<p class="pi-hint is-warn">· ${esc(x.text)}</p>`).join('')}` : '<p class="pi-hint">整份草稿的检查：没有发现必须处理的问题。采用时会按项目现有大纲和勾选的阶段再查一次。</p>'}
        ${warns.map((x) => `<p class="pi-hint">· ${esc(x.text)}</p>`).join('')}
        ${pending.length ? `<p class="pi-hint"><b>请确认</b></p>${pending.map((x) => `<p class="pi-hint">· ${esc(x)}</p>`).join('')}` : ''}
        ${stages
            .map((st) => {
                let key = adoptKey(job.id, 0, st.key),
                    nodes = stageNodes(st.data),
                    done = adopted.has(key);
                return `<div class="pi-imp-stage"><div class="pi-set-row"><b>${esc(stageLabel(st.key))}</b><span class="pi-hint">　${nodes.length} 个节点</span><span class="pi-spacer"></span>${done ? '<span class="pi-badge is-ok">已采用</span>' : `<label class="pi-check"><input type="checkbox" data-imp-pick="${esc(st.key)}" checked><span>采用</span></label>`}</div>
            ${nodes
                .map((n) => {
                    let note = cand.notes[nodeUid(n.item)] || {};
                    return `<p class="pi-hint">· ${esc(n.name)}${note.段 ? `<span class="pi-meta">　第 ${note.段} 段</span>` : ''}${note.待确认 ? `<br><span class="is-warn">待确认：${esc(note.待确认)}</span>` : ''}</p>`;
                })
                .join('')}
            <details><summary class="pi-hint">YAML</summary><pre class="pi-pre is-full">${esc(stringifyYaml({ [st.key]: st.data }))}</pre></details></div>`;
            })
            .join('')}
        <div class="pi-tools is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="import-adopt">把勾选的阶段追加为新卷</button></div>
        ${cand.index ? `<details><summary class="pi-hint">作者索引（只给作者看）</summary><pre class="pi-pre is-full">${esc(stringifyYaml(Object.fromEntries(Object.entries(cand.index).filter(([k]) => k !== 'secretFlag'))))}</pre></details>` : ''}</div>`;
}

export const importActions = {
    'import-open-panel'(view) {
        ((st(view).importing = view.projectId), (sti(view).jobId = ''), view.renderBody());
    },
    'import-close'(view) {
        ((st(view).importing = ''), view.renderBody());
    },
    'import-back'(view) {
        ((sti(view).jobId = ''), view.renderBody());
    },
    async 'import-pick-file'(view, target) {
        let files = await pickFiles({ accept: '.txt,.md,.markdown,text/plain', multiple: !1 });
        if (!files || !files.length) return;
        let box = target.closest('.pi-card').querySelector('[data-imp-text]');
        box && (box.value = await files[0].text());
    },
    async 'import-start'(view, target) {
        let card = target.closest('.pi-card'),
            text = card.querySelector('[data-imp-text]').value,
            needs = card.querySelector('[data-imp-needs]').value.trim(),
            mode = card.querySelector('[data-imp-mode]').value,
            projectId = view.projectId;
        if (!text.trim()) return toast('warning', '先粘贴原文，或选择一个文件。');
        let job = await view.data.imports.create({ projectId, text, mode, needs });
        // 创建期间切了项目：任务仍记在发起它的项目下。
        view.data.updateProject(projectId, (p) => ({ ...p, imports: [...importJobIds(p), job.id] }));
        if (view.projectId !== projectId) return toast('info', '导入任务已建好，记在原来的项目里。');
        ((sti(view).jobId = job.id), view.renderBody(), importActions['import-run'](view));
    },
    async 'import-open'(view, target) {
        let id = target.dataset.id,
            projectId = view.projectId,
            job = await view.data.imports.load(id).catch(() => null);
        if (view.projectId !== projectId) return;
        if (!job || job.projectId !== projectId || !importJobIds(view.project()).includes(id))
            return toast('warning', '这个导入任务不属于当前项目。');
        ((sti(view).jobId = id), view.renderBody());
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
        if (!importJobIds(view.project()).includes(id)) return;
        (await view.data.imports.drop(id),
            view.data.updateProject(projectId, (p) => ({ ...p, imports: importJobIds(p).filter((x) => x !== id) })),
            view.renderBody());
    },
    async 'import-run'(view) {
        let jobId = sti(view).jobId;
        if (!jobId || !importJobOf(view, jobId)) return;
        (await runTask(view, `import:${view.projectId}`, () => runImportJob(view, jobId)).catch((error) =>
            toast('error', `整理中断：${error.message}。已完成的部分已保存，点「继续」接着做。`),
        ),
            view.renderBody());
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
        let same = () => view.projectId === projectId && importJobOf(view, jobId);
        let picked = new Set(
                [...target.closest('.pi-card').querySelectorAll('[data-imp-pick]')].filter((x) => x.checked).map((x) => x.dataset.impPick),
            ),
            adopted = projectAdopted(view.project()),
            cand = importCandidate(job);
        let vol = cand.volumes[0],
            take = vol ? vol.stages.filter((st) => picked.has(st.key) && !adopted.has(adoptKey(job.id, 0, st.key))) : [];
        if (!take.length) return toast('info', '没有新勾选的阶段（已采用的不会重复写入）。');
        let { issues, basis } = importAdoptIssues(view, vol, take, cand.index),
            errs = issues.filter((x) => x.level === 'error'),
            warns = issues.filter((x) => x.level !== 'error');
        if (
            (errs.length || warns.length) &&
            !(await confirmDialog({
                title: errs.length ? '勾选的阶段有问题' : '请确认',
                body: `${basis}追加 ${take.length} 个阶段后检查到：`,
                list: [...errs, ...warns].map((x) => x.text).slice(0, 10),
                okLabel: '仍然追加',
                danger: !!errs.length,
            }))
        )
            return;
        if (!same()) return toast('warning', '确认期间切换了项目，没有追加。');
        let keys = take.map((st) => adoptKey(job.id, 0, st.key)),
            project = view.project();
        if (keys.some((k) => projectAdopted(project).has(k))) return (toast('info', '这些阶段刚刚已经采用过了。'), view.renderBody());
        let incoming = [{ ...vol, id: makeId('v'), stages: take.map((st) => ({ ...st, id: makeId('s') })) }],
            fresh;
        try {
            let [reid, renamed] = reidConflicts(incoming, project.outline.volumes),
                existing = new Set(project.outline.volumes.map((v) => v.key));
            fresh = reid.map((v) => (existing.has(v.key) ? { ...v, key: `${v.key}_导入${Date.now().toString(36).slice(-3)}` } : v));
            renamed.length &&
                toast(
                    'warning',
                    `有 ${renamed.length} 个节点 ID 与现有节点重复，已换成新 ID：${renamed.slice(0, 5).join('、')}${renamed.length > 5 ? '……' : ''}。`,
                );
        } catch (error) {
            return toast('error', `没有追加：${error.message}`);
        }
        view.data.updateProject(projectId, (p) => ({
            ...p,
            outline: { ...p.outline, volumes: [...p.outline.volumes, ...fresh] },
            importAdopted: [...projectAdopted(p), ...keys],
        }));
        ((st(view).sel = fresh[0] && fresh[0].id),
            view.runtime.refresh && view.runtime.refresh(),
            toast('success', `已追加 ${take.length} 个阶段。`),
            view.renderBody());
        await store
            .update(jobId, (j) => ({ ...j, adopted: [.../* @__PURE__ */ new Set([...(j.adopted || []), ...keys])] }))
            .catch(() => {});
    },
};
