// 「多条支线」导入和统一审阅页共用的小工具：线级检查、条件的文字说法、名称表、旧任务的逐条数据、已采用的线。
// 从已删除的 line-review.js 迁来仍在使用的函数。
import { importJobOf } from './long-import.js';
import { isPlainObject, volumeLabel, stageLabel, stageNodes, volumeName } from '../core/outline.js';
import { currentTables } from './tab-outline.js';
import { compileClue } from '../core/clue-rules.js';
import {
    droppedLineRefs,
    importLineIssues,
    mergeImportIndex,
    inventedOpenIssue,
    mergeImportByLine,
    splitImportAuthorFields,
    importConflictText,
    importLineDuplicates,
} from '../core/long-import.js';
import { checkClueDraft, chatFactSets, tableCondChecks, discoveryList } from '../core/clue-project.js';

// 「多条支线」导入的线级检查（依赖不导入的线、开启条件和表格、编出来的开启条件、重复内容、没读到场景）。
// opts：{ src: 'import', jobId }。返回 { 编号: { issues, conds, line } }。
export function reviewCheck(view, items, opts = {}) {
    let project = view.project(),
        rs = opts || {},
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
        ).filter((t) => /^线 ?[A-Za-z]+\d+ ?要等的/.test(t)),
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
    let out = {},
        dups = rs.src === 'import' ? importLineDuplicates(kept.map((y) => y.vol)) : [];
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
            // 同一段内容出现在两条线里：写出双方，各给一个「重新整理」
            rs.src === 'import' &&
                dups
                    .filter((d) => d.a.id === x.id || d.b.id === x.id)
                    .forEach((d) => issues.push({ level: 'error', text: d.text, fix: 'redraft', lines: [d.a.id, d.b.id] }));
            let empty = x.vol.stages.filter((s) => !stageNodes(s.data).length).map((s) => stageLabel(s.key));
            empty.length &&
                issues.push({
                    level: 'error',
                    text: `以下阶段没有读到场景（节点）：${empty.join('、')}。可能是场景写在了无法识别的字段下，请写意见让AI重写这一条`,
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
        line = (id) => (names.lines && names.lines[id] ? `「${names.lines[id]}」` : `线${id}`);
    if (c.kind === 'group')
        return c.items
            .map((x) => condWords(x, names))
            .filter(Boolean)
            .join(c.mode === 'any' ? '，或' : '，并且');
    if (c.kind === 'cell') {
        let [t, row, col] = String(c.path)
            .split('/')
            .map((x) => x.trim());
        return `（${t}）${row}的${col}${c.pick ? `的「${c.pick}」项` : ''} ${OP_WORD[c.op] || c.op} ${c.value}${c.tiers ? `（${c.tiers.join(' < ')}）` : ''}`;
    }
    return c.kind === 'line'
        ? `${line(c.line)} ${c.state === '开过' ? (c.op === '==' ? '开始过' : '还没开始过') : c.state === '开着' ? (c.op === '==' ? '正在进行' : '不在进行中') : `${c.op === '==' ? '是' : '不是'}「${c.state}」`}`
        : c.kind === 'fact'
          ? `正文里发生了${fact(c.fact)}`
          : c.kind === 'count'
            ? `${c.table}里${c.column} ${OP_WORD[c.op] || c.op} ${c.value}的${c.cmp}${c.n}行`
            : c.kind === 'know'
              ? `${c.actor === 'user' ? '主角' : c.actor}知道${fact(c.fact)}`
              : c.kind === 'node'
                ? `场景${node(c.node)}完成`
                : c.raw || '';
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

export function lineReviewFromJob(job) {
    let good = Object.keys(job.drafts || {})
            .sort((a, b) => a - b)
            .flatMap((k) =>
                (job.drafts[k] && !job.drafts[k].error ? job.drafts[k].list || [job.drafts[k]] : []).filter((d) => d && !d.error).flatMap((d) => d.volumes || []),
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

export function adoptedLineOf(project, jobId, id) {
    let volId = project && project.importLineMap && project.importLineMap[`${jobId}:${id}`],
        vol = volId && project.outline.volumes.find((v) => v.id === volId);
    return vol && isPlainObject(vol.line) ? { id: String(vol.line.编号 || '').trim(), name: volumeName(vol.key), volId } : null;
}
