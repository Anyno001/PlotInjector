import { importJobOf, projectAdopted } from './long-import.js';
import { isPlainObject, volumeLabel, stageLabel, stageNodes, splitStageKey, volumeToText, makeId } from '../core/outline.js';
import { currentTables, st, afterAdopt } from './tab-outline.js';
import { compileClue, confirmTierOrder } from '../core/clue-rules.js';
import {
    droppedLineRefs,
    importLineIssues,
    mergeImportIndex,
    inventedOpenIssue,
    mainLinesText,
    mergeImportByLine,
    splitImportAuthorFields,
    importConflictText,
    lineReviseMessages,
    pickRevised,
    lineChangeText,
    reidLines,
} from '../core/long-import.js';
import { checkClueDraft, chatFactSets, tableCondChecks, discoveryList, clueText, historyGuard } from '../core/clue-project.js';

import { adoptKey } from '../app/import-store.js';
import { esc, options, confirmDialog, choiceDialog, menuDialog } from './dom.js';

import { tableCatalogText, parseOutlineReply, fixYamlMessages } from '../core/prompts.js';

import { ask, runTask } from './ai.js';

import { toast, hostDocument } from '../host/st.js';

import { reidConflicts } from '../core/clue-model.js';

export const rsOf = (view) => {
    let all = view.tabState('lineReview'),
        id = view.projectId || '';
    return (all[id] || (all[id] = {}), all[id]);
};

export function reviewItems(view) {
    let rs = rsOf(view),
        project = view.project();
    if (rs.src === 'import') {
        let job = importJobOf(view, rs.jobId),
            lr = job && job.lineReview;
        return lr ? lr.order.map((id) => ({ id, ...lr.items[id] })) : [];
    }
    let saved = rs.items || (rs.items = {});
    return project.outline.volumes
        .filter((v) => isPlainObject(v.line))
        .map((v) => {
            let id = String(v.line.编号 || '').trim();
            return { id, vol: v, ...(saved[id] || {}) };
        });
}

export function reviewCheck(view, items) {
    let project = view.project(),
        rs = rsOf(view),
        tables = currentTables(),
        kept = items.filter((x) => !x.dropped),
        base =
            rs.src === 'import'
                ? project.outline.volumes
                : project.outline.volumes.filter((v) => !isPlainObject(v.line) || !kept.some((x) => x.vol.id === v.id)),
        all = [...base, ...kept.map((x) => x.vol)],
        comp = compileClue(all),
        dropped = items.filter((x) => x.dropped).map((x) => x.id),
        depends = droppedLineRefs(
            kept.map((x) => x.vol),
            dropped,
            base,
        ),
        draftIssues = checkClueDraft(
            kept.map((x) => x.vol),
            base,
        ).filter((t) => /^线 [A-Za-z]+\d+ 要等的/.test(t)),
        job0 = rs.src === 'import' ? importJobOf(view, rs.jobId) : null,
        more = {};
    if (job0) {
        let c = view.runtime.activeId() === view.projectId ? view.runtime.clue.compute() : null,
            { known, claimed } = chatFactSets(c),
            localOk = (job0.localIndex || []).filter((y) => isPlainObject(y) && !y.error),
            adoptedIds = new Set(kept.filter((y) => adoptedLineOf(project, rs.jobId, y.id)).map((y) => y.id));
        more = importLineIssues(
            kept.filter((y) => !adoptedIds.has(y.id)).map((y) => y.vol),
            base,
            { index: localOk.length ? mergeImportIndex(localOk) : job0.index, known, claimed },
        );
    }
    let out = {};
    for (let x of items) {
        let issues = [],
            line = comp.lines.find((l) => l.id === x.id),
            mine = (t) =>
                t.includes(`线 ${x.id}`) ||
                t.includes(`卷「${volumeLabel(x.vol.key)}」`) ||
                x.vol.stages.some((s) => t.includes(stageLabel(s.key)));
        if (x.dropped) out[x.id] = { issues: [], conds: [], line };
        else {
            (comp.errors.filter(mine).forEach((t) => issues.push({ level: 'error', text: t })),
                depends.filter((t) => t.startsWith(`线 ${x.id}`)).forEach((t) => issues.push({ level: 'error', text: t })),
                draftIssues
                    .filter((t) => t.startsWith(`线 ${x.id} `))
                    .forEach((t) => issues.push({ level: 'error', text: t, fix: 'drop-open' })));
            let conds = tables && line ? tableCondChecks(line.open, tables, '开启条件') : [];
            (conds
                .filter((c) => c.level !== 'ok')
                .forEach((c) =>
                    issues.push({
                        level: c.stuck ? 'error' : 'warn',
                        text: `${c.raw}：${c.notes.join('；')}`,
                        ...(c.tierPending ? { fix: 'tiers', tiers: c.tierPending } : {}),
                    }),
                ),
                line &&
                    line.mode === 'manual' &&
                    line.origCond &&
                    issues.push({ level: 'info', text: `人工开启。原来的要求：${line.origCond}` }));
            let empty = x.vol.stages.filter((s) => !stageNodes(s.data).length).map((s) => stageLabel(s.key));
            empty.length &&
                issues.push({
                    level: 'error',
                    text: `这些阶段没有读到任何场景（节点）：${empty.join('、')}。可能是 AI 把场景写在了不认识的字段下，写意见让 AI 重写这一条`,
                });
            let job = rs.src === 'import' ? importJobOf(view, rs.jobId) : null,
                inv =
                    job && job.lineIdent
                        ? inventedOpenIssue(
                              x.vol,
                              job.lineIdent.lines,
                              comp.lines.filter((l) => l.kind === 'main'),
                          )
                        : null;
            (inv && issues.push({ level: inv.level, text: inv.text, ...(inv.canDrop ? { fix: 'drop-open' } : {}) }),
                (more[x.id] || []).forEach((i) => issues.push(i)),
                (out[x.id] = { issues, conds, line }));
        }
    }
    return out;
}

export const OP_WORD = { '==': '是', '!=': '不是', '>=': '≥', '<=': '≤', '>': '>', '<': '<', 包含: '里有', 不包含: '里没有' };

export function condWords(c, names = {}) {
    if (!c) return '';
    let fact = (id) => (names.facts && names.facts[id] ? `「${names.facts[id]}」` : id),
        node = (id) => (names.nodes && names.nodes[id] ? `「${names.nodes[id]}」` : id),
        line = (id) => (names.lines && names.lines[id] ? `「${names.lines[id]}」` : `线 ${id}`);
    if (c.kind === 'group')
        return c.items
            .map((x) => condWords(x, names))
            .filter(Boolean)
            .join(c.mode === 'any' ? '，或者' : '，并且');
    if (c.kind === 'cell') {
        let [t, row, col] = String(c.path)
            .split('/')
            .map((x) => x.trim());
        return `（${t}）${row}的${col}${c.pick ? `里「${c.pick}」那一项` : ''} ${OP_WORD[c.op] || c.op} ${c.value}${c.tiers ? `（${c.tiers.join(' < ')}）` : ''}`;
    }
    return c.kind === 'line'
        ? `${line(c.line)} ${c.state === '开过' ? (c.op === '==' ? '开始过' : '还没开始过') : c.state === '开着' ? (c.op === '==' ? '正在进行' : '不在进行中') : `${c.op === '==' ? '是' : '不是'}「${c.state}」`}`
        : c.kind === 'fact'
          ? `正文里发生了${fact(c.fact)}`
          : c.kind === 'count'
            ? `${c.table}里 ${c.column} ${OP_WORD[c.op] || c.op} ${c.value} 的${c.cmp}${c.n}行`
            : c.kind === 'know'
              ? `${c.actor === 'user' ? '主角' : c.actor}知道${fact(c.fact)}`
              : c.kind === 'node'
                ? `场景${node(c.node)}完成`
                : c.raw || '';
}

export function condText(line, names) {
    return line
        ? line.mode === 'manual'
            ? '手动开始（想玩时点「进入」）'
            : line.open
              ? condWords(line.open, names)
              : '随时可以开始'
        : '（读不出来）';
}

export function condNames(volumes) {
    let comp = compileClue(volumes || []),
        facts = {},
        nodes = {},
        lines = {};
    for (let n of comp.nodes) {
        n.uid && (nodes[n.uid] = n.name);
        for (let d of discoveryList(isPlainObject(n.item) ? n.item : {}))
            d.fact && !facts[d.fact] && d.text && (facts[d.fact] = d.text.length > 24 ? `${d.text.slice(0, 24)}…` : d.text);
    }
    for (let l of comp.lines || []) lines[l.id] = l.name;
    return { facts, nodes, lines };
}

export function renderLineReview(view) {
    let rs = rsOf(view),
        project = view.project(),
        items = reviewItems(view),
        busy = view.busy[`line-review:${view.projectId}`];
    if (!items.length)
        return '<div class="pi-card"><h3>剧情线<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="lr-close">返回</button></h3><p class="pi-hint">还没有剧情线。</p></div>';
    let checks = reviewCheck(view, items),
        flag = (x2) =>
            x2.dropped
                ? '✕'
                : checks[x2.id].issues.some((i) => i.level !== 'info')
                  ? '⚠'
                  : x2.comment
                    ? '✎'
                    : x2.changed && x2.changed.length
                      ? '✓'
                      : '',
        problem = items.filter((x2) => flag(x2) === '⚠'),
        list = rs.only ? problem : items;
    list.length || ((rs.only = !1), (list = items));
    let at = Math.max(
            0,
            Math.min(
                list.length - 1,
                list.findIndex((x2) => x2.id === rs.at),
            ),
        ),
        x = list[at < 0 ? 0 : at],
        c = checks[x.id],
        v = x.vol,
        l = isPlainObject(v.line) ? v.line : {};
    rs.at = x.id;
    let mainOpts = mainLinesText(project.outline.volumes)
            ? compileClue(project.outline.volumes).lines.filter((m) => m.kind === 'main')
            : [],
        win = isPlainObject(l.开启时段) ? l.开启时段 : {},
        curMain = mainOpts.find((m) => m.id === String(win.主线 || '').trim()),
        stageOpts = (m) => [
            { value: '', label: '不限' },
            ...(m
                ? m.units.map((u) => ({
                      value: splitStageKey(u.stage.key).short || stageLabel(u.stage.key),
                      label: stageLabel(u.stage.key),
                  }))
                : []),
        ],
        nodes = v.stages.reduce((n, s) => n + stageNodes(s.data).length, 0),
        pending = items.filter((y) => y.comment && !y.dropped),
        isImport = rs.src === 'import',
        went = isImport
            ? adoptedLineOf(project, rs.jobId, x.id) ||
              (projectAdopted(project).has(adoptKey(rs.jobId, 'line', x.id)) ? { id: '', name: '' } : null)
            : null;
    if (went)
        return `<div class="pi-card pi-lr"><h3>导入的支线 · ${items.length} 条<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="lr-close">返回</button></h3>
        <div class="pi-row pi-lr-nav"><button type="button" class="pi-btn" data-act="lr-go" data-dir="-1"${at <= 0 ? ' disabled' : ''}>‹ 上一条</button><span class="pi-spacer"></span>
          <button type="button" class="pi-btn is-ghost" data-act="lr-list">${at + 1} / ${list.length} ▾</button><span class="pi-spacer"></span>
          <button type="button" class="pi-btn" data-act="lr-go" data-dir="1"${at >= list.length - 1 ? ' disabled' : ''}>下一条 ›</button></div>
        <div class="pi-lr-item"><div class="pi-row"><b>${esc(volumeLabel(v.key).startsWith(x.id) ? volumeLabel(v.key) : `${x.id} ${volumeLabel(v.key)}`)}</b></div>
          <p class="pi-hint">${went.id ? `已采用为 <b>${esc(went.id)}</b>「${esc(went.name)}」` : '已采用（项目里那一卷已经删掉或改过编号）'}。这里是导入时的草稿，改了不会进大纲；要改请到大纲页「剧情线…」。</p>
          <div class="pi-tools is-end"><button type="button" class="pi-btn is-sm" data-act="lines-open">到「剧情线…」去改</button></div></div>
        <div class="pi-tools is-c2"><span></span><button type="button" class="pi-btn is-primary" data-act="lr-adopt"${busy ? ' disabled' : ''}>采用其余的</button></div></div>`;
    let field = (k, label, ph = '') =>
            `<label class="pi-field"><span>${label}</span><input class="pi-inp" data-lr-field="${k}" value="${esc(clueText(l[k]))}" placeholder="${esc(ph)}"></label>`,
        now = c.conds
            .map(
                (q) =>
                    `<p class="pi-hint${q.level === 'ok' ? '' : ' is-warn'}">现在：${esc(q.now || '（读不到）')}${q.level === 'ok' ? ' · ✓ 表格里有' : ''}</p>`,
            )
            .join('');
    return `<div class="pi-card pi-lr"><h3>${isImport ? `导入的支线 · ${items.length} 条` : '剧情线'}<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="lr-close">返回</button></h3>
        ${problem.length ? `<p class="pi-hint is-warn">⚠ ${problem.length} 条需要看一下 <button type="button" class="pi-btn is-sm is-ghost" data-act="lr-only">${rs.only ? '看全部' : `只看这 ${problem.length} 条`}</button></p>` : ''}
        ${isImport ? '<p class="pi-hint">没问题的可以直接点「采用」；想改哪条就在那条下面写意见，写完一起发送。</p>' : ''}
        <div class="pi-row pi-lr-nav"><button type="button" class="pi-btn" data-act="lr-go" data-dir="-1"${at <= 0 ? ' disabled' : ''}>‹ 上一条</button><span class="pi-spacer"></span>
          <button type="button" class="pi-btn is-ghost" data-act="lr-list">${at + 1} / ${list.length} ▾</button><span class="pi-spacer"></span>
          <button type="button" class="pi-btn" data-act="lr-go" data-dir="1"${at >= list.length - 1 ? ' disabled' : ''}>下一条 ›</button></div>
        <div class="pi-lr-item${x.dropped ? ' is-dropped' : ''}">
          <div class="pi-row"><b>${esc(volumeLabel(v.key).startsWith(x.id) ? volumeLabel(v.key) : `${x.id} ${volumeLabel(v.key)}`)}</b><span class="pi-spacer"></span>
            <select class="pi-sel is-sm" data-lr-field="类型">${options(
                [
                    { value: '支线', label: '支线' },
                    { value: '主线', label: '主线' },
                ],
                String(l.类型 || '支线').trim() === '主线' ? '主线' : '支线',
            )}</select></div>
          ${x.dropped ? '<p class="pi-hint is-warn">这条不要了，采用时不会加进大纲。</p>' : ''}
          ${field('简介', '简介', '一句话，正文看得到，不含答案')}${field('入口提示', '入口', '线可以开始时给正文的由头')}
          <div class="pi-field"><span>开启</span><p class="pi-hint">${esc(condText(c.line, condNames([...project.outline.volumes, ...items.map((y) => y.vol)])))}</p>${now}</div>
          ${
              mainOpts.length && String(l.类型 || '').trim() !== '主线'
                  ? `<div class="pi-field"><span>时段</span><div class="pi-row pi-lr-win"><select class="pi-sel is-sm" data-lr-win="主线">${options([{ value: '', label: '不限' }, ...mainOpts.map((m) => ({ value: m.id, label: `${m.id} ${m.name}` }))], curMain ? curMain.id : '')}</select>
            ${curMain ? `从 <select class="pi-sel is-sm" data-lr-win="从">${options(stageOpts(curMain), String(win.从 || ''))}</select> 到 <select class="pi-sel is-sm" data-lr-win="到">${options(stageOpts(curMain), String(win.到 || ''))}</select>` : ''}</div></div>`
                  : ''
          }
          <details><summary class="pi-hint">内容：${v.stages.length} 个阶段 · ${nodes} 个场景（展开）</summary>${v.stages
              .map(
                  (s) =>
                      `<p class="pi-hint"><b>${esc(stageLabel(s.key))}</b>：${
                          stageNodes(s.data)
                              .map((n) => esc(n.name))
                              .join('、') || '（无）'
                      }</p>`,
              )
              .join('')}<pre class="pi-pre is-full">${esc(volumeToText(v))}</pre></details>
          ${c.issues.map((i) => `<p class="pi-hint${i.level === 'info' ? '' : ' is-warn'}">${i.level === 'info' ? '' : '⚠ '}${esc(i.text)}${i.fix === 'drop-open' ? ' <button type="button" class="pi-btn is-sm" data-act="lr-drop-open" title="删掉整条开启条件和开启时段（不是只删多出来的那一项）">去掉开启条件和时段</button>' : ''}${i.fix === 'tiers' ? ` <button type="button" class="pi-btn is-sm" data-act="lr-tiers" data-tiers="${esc(JSON.stringify(i.tiers))}">顺序对，确认</button>` : ''}</p>`).join('')}
          ${x.changed && x.changed.length ? `<p class="pi-hint">✓ 已改过：${esc(x.changed.join('；'))}</p>` : ''}
          <label class="pi-field"><span>意见</span><textarea class="pi-ta" rows="2" data-lr-comment placeholder="例：改成巴基主动来找主角；开启改成主线一结束以后">${esc(x.comment || '')}</textarea></label>
          <div class="pi-row"><span class="pi-hint" data-lr-saved>${x.comment ? '已保存 ✓' : ''}</span>${x.lastComment ? `<span class="pi-hint pi-lr-last">上次的意见：${esc(x.lastComment)}</span>` : ''}<span class="pi-spacer"></span>
            ${isImport ? `<button type="button" class="pi-btn is-sm is-ghost${x.dropped ? '' : ' is-danger'}" data-act="lr-drop">${x.dropped ? '还是要这条' : '不要这条'}</button>` : ''}</div>
        </div>
        <div class="pi-tools is-c2"><button type="button" class="pi-btn" data-act="lr-revise"${pending.length && !busy ? '' : ' disabled'}>${busy ? '<span class="pi-spin"></span>修改中' : `按意见修改（${pending.length} 条）`}</button>
          ${isImport ? `<button type="button" class="pi-btn is-primary" data-act="lr-adopt"${busy ? ' disabled' : ''}>采用</button>` : '<button type="button" class="pi-btn is-ghost" data-act="lr-close">完成</button>'}</div></div>`;
}

export async function lrUpdate(view, id, fn, to = null) {
    let rs = to || rsOf(view);
    if (rs.src === 'import') {
        let job = importJobOf(view, rs.jobId);
        if (!job || !job.lineReview || !job.lineReview.items[id] || adoptedLineOf(view.project(), rs.jobId, id)) return;
        await view.data.imports.update(rs.jobId, (j) => ({
            ...j,
            lineReview: { ...j.lineReview, items: { ...j.lineReview.items, [id]: fn(j.lineReview.items[id]) } },
        }));
        return;
    }
    let p = view.project(),
        vol = p.outline.volumes.find((v) => isPlainObject(v.line) && String(v.line.编号 || '').trim() === id),
        cur = { vol, ...((rs.items || {})[id] || {}) },
        next = fn(cur);
    ((rs.items = { ...(rs.items || {}), [id]: { comment: next.comment, lastComment: next.lastComment, changed: next.changed } }),
        next.vol !== vol &&
            view.data.updateProject(p.id, (q) => ({
                ...q,
                outline: { ...q.outline, volumes: q.outline.volumes.map((v) => (v.id === vol.id ? { ...next.vol, id: v.id } : v)) },
            })),
        next.vol !== vol && view.runtime.refresh && view.runtime.refresh());
}

export function setLineField(vol, key, value) {
    let line = { ...vol.line };
    return (value === '' || value == null ? delete line[key] : (line[key] = value), { ...vol, line });
}

export async function lrOnChange(view, target) {
    let id = rsOf(view).at;
    if (target.dataset.lrField !== void 0) {
        let k = target.dataset.lrField,
            val = target.value.trim();
        return (
            await lrUpdate(view, id, (x) => (clueText(x.vol.line[k]) === val ? x : { ...x, vol: setLineField(x.vol, k, val) })),
            k === '类型' && view.renderBody(),
            !0
        );
    }
    if (target.dataset.lrWin !== void 0) {
        let card = target.closest('.pi-lr'),
            get = (k) => card.querySelector(`[data-lr-win="${k}"]`)?.value || '',
            main = get('主线'),
            win = main
                ? {
                      主线: main,
                      ...(get('从') && target.dataset.lrWin !== '主线' ? { 从: get('从') } : {}),
                      ...(get('到') && target.dataset.lrWin !== '主线' ? { 到: get('到') } : {}),
                  }
                : '';
        return (await lrUpdate(view, id, (x) => ({ ...x, vol: setLineField(x.vol, '开启时段', win) })), view.renderBody(), !0);
    }
    if (target.dataset.lrComment !== void 0) {
        let text = target.value.trim();
        await lrUpdate(view, id, (x) => ({ ...x, comment: text }));
        let s = target.closest('.pi-lr-item')?.querySelector('[data-lr-saved]');
        s && (s.textContent = text ? '已保存 ✓' : '');
        let n = reviewItems(view).filter((y) => y.comment && !y.dropped).length,
            b = target.closest('.pi-lr')?.querySelector('[data-act="lr-revise"]');
        return (b && !view.busy[`line-review:${view.projectId}`] && ((b.textContent = `按意见修改（${n} 条）`), (b.disabled = !n)), !0);
    }
    return !1;
}

export function lineReviewFromJob(job) {
    let good = Object.keys(job.drafts || {})
            .sort((a, b) => a - b)
            .flatMap((k) =>
                (job.drafts[k] && !job.drafts[k].error ? job.drafts[k].list || [job.drafts[k]] : []).flatMap((d) => d.volumes || []),
            ),
        merged = mergeImportByLine(good),
        vols = splitImportAuthorFields(merged).volumes.filter((v) => isPlainObject(v.line)),
        items = {},
        order = [];
    for (let v of vols) {
        let id = String(v.line.编号 || '').trim();
        !id || items[id] || ((items[id] = { vol: v, comment: '', lastComment: '', changed: [], dropped: !1 }), order.push(id));
    }
    return {
        items,
        order,
        conflicts: merged.conflicts.map(importConflictText),
        loose: merged.filter((v) => !isPlainObject(v.line)).length,
    };
}

export function openLineReview(view, src, jobId = '') {
    let rs = rsOf(view);
    ((rs.src = src),
        (rs.jobId = jobId),
        (rs.at = ''),
        (rs.only = !1),
        src === 'project' && (rs.items = {}),
        (st(view).lineReview = view.projectId),
        view.renderBody());
}

export async function reviseByComments(view) {
    let rs = rsOf(view),
        items = reviewItems(view),
        todo = items.filter((x) => x.comment && !x.dropped);
    if (!todo.length) return;
    let to = { src: rs.src, jobId: rs.jobId },
        sent = Object.fromEntries(todo.map((x) => [x.id, x.comment])),
        projectId = view.projectId,
        project = view.project(),
        tables = currentTables(),
        context = items
            .filter((x) => !todo.includes(x) && !x.dropped)
            .map((x) => `- ${x.id}「${volumeLabel(x.vol.key)}」${clueText(x.vol.line.简介)}`).join(`
`),
        snap = Object.fromEntries(todo.map((x) => [x.id, JSON.stringify(x.vol)])),
        msgs = lineReviseMessages({
            targets: todo.map((x) => ({ id: x.id, yaml: volumeToText(x.vol), comment: x.comment })),
            context,
            tableCatalog: tables ? tableCatalogText(tables) : '',
            mainLines: mainLinesText(project.outline.volumes),
        }),
        r = parseOutlineReply(await ask(view, 'outline', msgs));
    if (
        (r.ok || (r = parseOutlineReply(await ask(view, 'outline', fixYamlMessages(r.yaml, r.error || '格式错误', 'clue')))),
        view.projectId !== projectId)
    )
        return;
    if (!r.ok) throw new Error(`AI 的回复读不出来（${r.error}），意见都还在，可以再试一次`);
    let nowItems =
            rs.src === to.src && rs.jobId === to.jobId
                ? reviewItems(view)
                : (() => {
                      let saved = { src: rs.src, jobId: rs.jobId };
                      ((rs.src = to.src), (rs.jobId = to.jobId));
                      try {
                          return reviewItems(view);
                      } finally {
                          ((rs.src = saved.src), (rs.jobId = saved.jobId));
                      }
                  })(),
        gone = nowItems.filter((x) => x.dropped && sent[x.id] !== void 0).map((x) => x.id),
        { got, missing } = pickRevised(
            splitImportAuthorFields(r.volumes).volumes,
            todo.map((x) => x.id),
        ),
        skipped = [];
    for (let id of gone) delete got[id];
    let now = Object.fromEntries(nowItems.map((x) => [x.id, x])),
        after = (x, id) => ({ lastComment: sent[id], comment: (x.comment || '') === sent[id] ? '' : x.comment });
    if (to.src === 'project') {
        let next = project.outline.volumes;
        for (let [id, vol] of Object.entries(got)) {
            let cur = now[id];
            if (!cur || JSON.stringify(cur.vol) !== snap[id]) {
                skipped.push(id);
                continue;
            }
            next = next.map((v) =>
                v.id === cur.vol.id
                    ? { ...vol, id: v.id, stages: vol.stages.map((s, i) => ({ ...s, id: (v.stages[i] || {}).id || s.id })) }
                    : v,
            );
        }
        let c = view.runtime.activeId() === projectId ? view.runtime.clue.compute() : null,
            guard = c ? historyGuard(project.outline.volumes, next, c.snap, c.prog, project.clue) : null,
            warn = guard ? [...guard.diffs, ...guard.notes] : [],
            changes = Object.keys(got)
                .filter((id) => !skipped.includes(id))
                .map((id) => `${id}：${lineChangeText(now[id].vol, got[id]).join('；') || '没有变化'}`);
        if (!changes.length) return toast('info', '没有可以采用的修改。');
        if (
            !(await confirmDialog({
                title: '按意见修改',
                body: `改动如下${warn.length ? '；按这个聊天的进度检查到：' : '。'}`,
                list: [...changes, ...warn],
                okLabel: '采用修改',
                danger: !!guard && guard.diffs.length > 0,
            }))
        )
            return;
        if (view.projectId !== projectId || JSON.stringify(view.project().outline.volumes) !== JSON.stringify(project.outline.volumes))
            return toast('warning', '确认期间大纲又变了，没有采用，请再试一次。');
        (view.data.updateProject(projectId, (p) => ({ ...p, outline: { ...p.outline, volumes: next } })),
            view.runtime.refresh && view.runtime.refresh());
        let mem = rs.src === 'project' ? rs.items || (rs.items = {}) : {};
        for (let id of Object.keys(got))
            skipped.includes(id) || (mem[id] = { ...mem[id], ...after(mem[id] || {}, id), changed: lineChangeText(now[id].vol, got[id]) });
        afterAdopt(view);
    } else
        for (let [id, vol] of Object.entries(got)) {
            let cur = now[id];
            if (!cur || JSON.stringify(cur.vol) !== snap[id]) {
                skipped.push(id);
                continue;
            }
            await lrUpdate(
                view,
                id,
                (x) => ({ ...x, vol: { ...vol, id: x.vol.id }, ...after(x, id), changed: lineChangeText(x.vol, vol) }),
                to,
            );
        }
    let ok = Object.keys(got).length - skipped.length,
        fresh = Object.keys(got).filter(
            (id) => !skipped.includes(id) && now[id] && (now[id].comment || '') !== sent[id] && now[id].comment,
        );
    toast(
        missing.length || skipped.length || gone.length ? 'warning' : 'success',
        `改好 ${ok} 条${missing.length ? `；${missing.join('、')} 没改成，意见留着` : ''}${skipped.length ? `；${skipped.join('、')} 在修改期间被你改过，没有覆盖` : ''}${gone.length ? `；${gone.join('、')} 在修改期间标了不要，结果没用` : ''}${fresh.length ? `；${fresh.join('、')} 等待期间写的新意见还没发送` : ''}。`,
    );
}

export function adoptedLineOf(project, jobId, id) {
    let volId = project && project.importLineMap && project.importLineMap[`${jobId}:${id}`],
        vol = volId && project.outline.volumes.find((v) => v.id === volId);
    return vol && isPlainObject(vol.line) ? { id: String(vol.line.编号 || '').trim(), name: volumeLabel(vol.key), volId } : null;
}

export async function adoptLineReview(view) {
    let rs = rsOf(view),
        projectId = view.projectId,
        jobId = rs.jobId,
        job = importJobOf(view, jobId);
    if (!job || !job.lineReview) return;
    let items = reviewItems(view),
        pending = items.filter((x) => x.comment && !x.dropped);
    if (pending.length) {
        let pick = await choiceDialog({
            title: '还有意见没让 AI 改',
            body: `${pending.length} 条线写了意见，还没让 AI 改。直接采用的话，这些线按现在的样子加进大纲，意见不生效。`,
            choices: [
                { label: '取消', value: null },
                { label: '不改，直接采用', value: 'adopt' },
                { label: '先让 AI 按意见改', value: 'send', primary: !0 },
            ],
        });
        if (pick === 'send') return lrActions['lr-revise'](view);
        if (pick !== 'adopt') return;
    }
    let project = view.project(),
        adopted = projectAdopted(project),
        take = items.filter((x) => !x.dropped && !adopted.has(adoptKey(jobId, 'line', x.id)) && !adoptedLineOf(project, jobId, x.id));
    if (!take.length) return toast('info', '没有要采用的支线（已采用的不会重复写入）。');
    let checks = reviewCheck(view, items),
        errs = take.flatMap((x) => checks[x.id].issues.filter((i) => i.level === 'error').map((i) => `${x.id}：${i.text}`));
    if (
        errs.length &&
        !(await confirmDialog({
            title: `${errs.length} 处问题`,
            body: '有问题的线可能一直开始不了。采用后也可以在大纲页「剧情线…」或执行页里再改：',
            list: errs.slice(0, 10),
            okLabel: '仍然采用',
            danger: !0,
        }))
    )
        return;
    if (view.projectId !== projectId || !importJobOf(view, jobId)) return toast('warning', '确认期间切换了项目，没有采用。');
    project = view.project();
    let fresh,
        lineMap = {};
    try {
        let prior = Object.fromEntries(
                items
                    .map((x) => [x.id, adoptedLineOf(project, jobId, x.id)])
                    .filter(([, l]) => l)
                    .map(([id, l]) => [id, l.id]),
            ),
            [byLine, map] = reidLines(
                take.map((x) => x.vol),
                project.outline.volumes,
                items.map((x) => x.id),
                prior,
            ),
            [reid, renamed] = reidConflicts(
                byLine.map((v) => ({ ...v, id: makeId('v'), stages: v.stages.map((s) => ({ ...s, id: makeId('s') })) })),
                project.outline.volumes,
            ),
            keys2 = new Set(project.outline.volumes.map((v) => v.key));
        ((fresh = reid.map((v) => (keys2.has(v.key) ? { ...v, key: `${v.key}_导入${Date.now().toString(36).slice(-3)}` } : v))),
            (lineMap = Object.fromEntries(take.map((x, i) => [`${jobId}:${x.id}`, fresh[i].id]))),
            Object.keys(map).length &&
                toast(
                    'warning',
                    `有 ${Object.keys(map).length} 条支线的编号和已有的线重复，已换成：${Object.entries(map)
                        .map(([a, b]) => `${a}→${b}`)
                        .join('、')}（本批内部的引用一起改了）。`,
                ),
            renamed.length && toast('warning', `有 ${renamed.length} 个节点 ID 与现有节点重复，已换成新 ID。`));
    } catch (error) {
        return toast('error', `没有采用：${error.message}`);
    }
    let keys = take.map((x) => adoptKey(jobId, 'line', x.id));
    (view.data.updateProject(projectId, (p) => ({
        ...p,
        outline: { ...p.outline, volumes: [...p.outline.volumes, ...fresh] },
        importAdopted: [...projectAdopted(p), ...keys],
        importLineMap: { ...(p.importLineMap || {}), ...lineMap },
    })),
        view.runtime.refresh && view.runtime.refresh(),
        toast('success', `已采用 ${take.length} 条支线。`),
        (st(view).lineReview = ''),
        (st(view).importing = ''),
        view.renderBody(),
        afterAdopt(view));
}

export const lrActions = {
    'lr-close'(view) {
        ((st(view).lineReview = ''), view.renderBody());
    },
    'lr-go'(view, target) {
        let rs = rsOf(view),
            items = reviewItems(view),
            checks = reviewCheck(view, items),
            list = rs.only ? items.filter((x) => checks[x.id].issues.some((i) => i.level !== 'info') && !x.dropped) : items,
            at = list.findIndex((x) => x.id === rs.at);
        ((rs.at = (list[Math.max(0, Math.min(list.length - 1, at + Number(target.dataset.dir)))] || {}).id || rs.at), view.renderBody());
    },
    'lr-only'(view) {
        let rs = rsOf(view);
        ((rs.only = !rs.only), view.renderBody());
    },
    async 'lr-list'(view) {
        let items = reviewItems(view),
            checks = reviewCheck(view, items),
            mark = (x) =>
                x.dropped
                    ? '✕ '
                    : checks[x.id].issues.some((i) => i.level !== 'info')
                      ? '⚠ '
                      : x.comment
                        ? '✎ '
                        : x.changed && x.changed.length
                          ? '✓ '
                          : '',
            sorted = [...items].sort((a, b) => (mark(b) === '⚠ ') - (mark(a) === '⚠ ')),
            id = await menuDialog({
                title: '跳到',
                items: sorted.map((x) => ({
                    value: x.id,
                    label: `${mark(x)}${volumeLabel(x.vol.key).startsWith(x.id) ? volumeLabel(x.vol.key) : `${x.id} ${volumeLabel(x.vol.key)}`}`,
                })),
            });
        id && ((rsOf(view).at = id), (rsOf(view).only = !1), view.renderBody());
    },
    async 'lr-tiers'(view, target) {
        let id = rsOf(view).at,
            tiers = JSON.parse(target.dataset.tiers || '[]');
        (await lrUpdate(view, id, (x) => {
            let [vol] = confirmTierOrder([x.vol], tiers);
            return vol === x.vol ? x : { ...x, vol, changed: [...(x.changed || []), `确认了档位顺序 ${tiers.join(' < ')}`] };
        }),
            view.renderBody());
    },
    async 'lr-drop-open'(view) {
        let id = rsOf(view).at;
        (await lrUpdate(view, id, (x) => ({
            ...x,
            vol: setLineField(setLineField(x.vol, '开启条件', ''), '开启时段', ''),
            changed: [...(x.changed || []), '去掉了开启条件和时段'],
        })),
            view.renderBody());
    },
    async 'lr-drop'(view) {
        let id = rsOf(view).at;
        (await lrUpdate(view, id, (x) => ({ ...x, dropped: !x.dropped })), view.renderBody());
    },
    async 'lr-revise'(view) {
        let box = hostDocument().querySelector('.pi-lr [data-lr-comment]');
        (box && (await lrOnChange(view, box)),
            await runTask(view, `line-review:${view.projectId}`, () => reviseByComments(view)).catch((error) =>
                toast('error', error.message),
            ),
            view.renderBody());
    },
    async 'lr-adopt'(view) {
        let box = hostDocument().querySelector('.pi-lr [data-lr-comment]');
        (box && (await lrOnChange(view, box)), await adoptLineReview(view));
    },
    'lines-open'(view) {
        let rs = rsOf(view),
            went = rs.src === 'import' ? adoptedLineOf(view.project(), rs.jobId, rs.at) : null;
        (openLineReview(view, 'project'), went && ((rsOf(view).at = went.id), view.renderBody()));
    },
};
