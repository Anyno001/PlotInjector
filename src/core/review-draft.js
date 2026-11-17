// 审阅草稿与统一保存（导入审阅与改大纲总方案第十节：GPT 审阅 R1 / R2 / R3 / R4）。
// 只有纯函数，不碰界面和存储。导入审阅、重新审阅刚导入的线、「审阅修改」已有大纲三条路共用：
//   1. 审阅过程只改草稿（session.draft），点「采用 / 保存」才由 prepareCommit 合成要写进项目的大纲；
//   2. 身份由程序固定：卷 id、阶段 id、线编号、没要求改的线头字段，不靠模型照抄（R2）；
//   3. 关联修改按实际引用成组（R4），一组里有一个单位失败整组不应用；
//   4. 保存前对已有线跑 historyGuard 并真正执行 restoreHistory，摘要按最终内容生成（R1）。
import { isPlainObject, makeId, stageLabel, stageNodes, pushOutlineHistory } from './outline.js';
import { nodeUid, NODE_COND_KEYS, STAGE_COND_KEYS } from './clue-model.js';
import { conditionRefs, parseCondition } from './clue-rules.js';
import { discoveryList, historyGuard, restoreHistory } from './clue-project.js';

const clone = (x) => (x === undefined ? x : JSON.parse(JSON.stringify(x)));
// 比较内容：对象键的顺序不算（YAML 解析、模型回复会打乱键序），数组顺序算（节点、阶段的先后是大纲语义）。
export const stableText = (x) =>
    x === undefined || x === null
        ? 'null'
        : Array.isArray(x)
          ? `[${x.map(stableText).join(',')}]`
          : typeof x == 'object'
            ? `{${Object.keys(x)
                  .filter((k) => x[k] !== undefined)
                  .sort()
                  .map((k) => `${JSON.stringify(k)}:${stableText(x[k])}`)
                  .join(',')}}`
            : JSON.stringify(x);
const same = (a, b) => stableText(a) === stableText(b);

// ---- 草稿会话 ----
// source：'import'（导入任务）/ 'project'（导入后重新审阅已采用的线）/ 'proposal'（「审阅修改」已有大纲；名字沿用旧设计，openEditReview 仍在建，不要删）。
// volumes：这次审阅的剧情线（卷），保持原来的卷 id、阶段 id。base 是打开时的样子，撤回只回到它，不碰项目里别处的改动。
export function createReviewSession({ source, projectId, jobId = '', volumes }) {
    return {
        version: 1,
        id: makeId('rv'),
        source,
        projectId,
        jobId,
        createdAt: Date.now(),
        base: clone(volumes),
        draft: clone(volumes),
        comments: {},
        history: [],
    };
}

// 草稿单位：线头（kind 'line'）或阶段（kind 'stage'）。键用 卷id / 阶段id，不用「阶段1」这种名字（不同的线都有阶段1）。
export const unitKey = (volumeId, stageId = '') => (stageId ? `${volumeId}/${stageId}` : `${volumeId}/line`);
export function sessionUnits(session) {
    let out = [];
    for (let v of session.draft)
        (out.push({ key: unitKey(v.id), kind: 'line', volumeId: v.id, stageId: '' }),
            v.stages.forEach((s) => out.push({ key: unitKey(v.id, s.id), kind: 'stage', volumeId: v.id, stageId: s.id })));
    return out;
}
export function unitValue(volumes, key) {
    let [vid, sid] = key.split('/'),
        v = (volumes || []).find((x) => x.id === vid);
    if (!v) return null;
    return sid === 'line' ? (isPlainObject(v.line) ? v.line : null) : v.stages.find((s) => s.id === sid) || null;
}

// 草稿的一次修改：记一笔撤回点（只撤这次），返回新会话。fn 收到草稿的副本。
export function editDraft(session, label, fn) {
    let before = clone(session.draft),
        next = fn(clone(session.draft));
    return same(before, next) ? session : { ...session, draft: next, history: [...session.history, { label, at: Date.now(), draft: before }].slice(-20) };
}
export function undoDraft(session) {
    let last = session.history[session.history.length - 1];
    return last ? { ...session, draft: last.draft, history: session.history.slice(0, -1) } : session;
}
// ---- 把模型给回来的内容放回草稿：身份由程序定（R2）----
// 单阶段：回写到插件记下的那个阶段 id；阶段名可以改，id 不变。
export function putStage(volumes, volumeId, stageId, incoming) {
    return volumes.map((v) =>
        v.id !== volumeId ? v : { ...v, stages: v.stages.map((s) => (s.id === stageId ? { ...s, key: incoming.key || s.key, data: incoming.data } : s)) },
    );
}
// 线头：编号由程序保留；allow 之外的字段（用户没要求改的）保留原值。allow 为空 = 都可以改（除了编号）。
export function putLine(volumes, volumeId, incomingLine, allow = null) {
    return volumes.map((v) => {
        if (v.id !== volumeId) return v;
        let old = isPlainObject(v.line) ? v.line : {},
            next = { ...old };
        // 编号、类型（已有时）永远用原来的：类型只在新建时选（用户 2026-11-16），改了会牵动主线互斥、接上一条、开启时段、支线名额
        let fixed = (k) => k === '编号' || (k === '类型' && String(old.类型 || '').trim() !== '');
        for (let [k, val] of Object.entries(isPlainObject(incomingLine) ? incomingLine : {})) !fixed(k) && (!allow || allow.includes(k)) && (next[k] = val);
        if (allow) for (let k of allow) !fixed(k) && !(isPlainObject(incomingLine) && k in incomingLine) && delete next[k];
        return { ...v, line: next };
    });
}
// 整条线：模型给回一卷，按「原阶段 → 新阶段」对应保留阶段 id。不按下标回填（GPT R2：前面插一个阶段，后面全错位）。
// 对应依据，依次：
//   1. 阶段名相同；
//   2. 共有节点 id 最多（同一件事沿用原节点 id 是提示词里的硬规则）；
// 对不上的新阶段拿新 id；原阶段在新内容里找不到的，列进 removed，由调用方提示（不悄悄丢）。
export function matchStages(oldStages, newStages, idOf = () => makeId('s')) {
    let ids = (s) => new Set(stageNodes(s.data).map((n) => nodeUid(n.item)).filter(Boolean)),
        used = new Set(),
        out = newStages.map(() => null);
    newStages.forEach((ns, i) => {
        let hit = oldStages.find((os) => !used.has(os.id) && os.key === ns.key);
        hit && (used.add(hit.id), (out[i] = hit.id));
    });
    newStages.forEach((ns, i) => {
        if (out[i]) return;
        let mine = ids(ns),
            best = null,
            score = 0;
        for (let os of oldStages) {
            if (used.has(os.id)) continue;
            let n = [...ids(os)].filter((x) => mine.has(x)).length;
            n > score && ((score = n), (best = os));
        }
        best && (used.add(best.id), (out[i] = best.id));
    });
    return {
        stages: newStages.map((ns, i) => ({ ...ns, id: out[i] || idOf() })),
        kept: out.filter(Boolean),
        added: newStages.filter((_, i) => !out[i]).map((s) => s.key),
        removed: oldStages.filter((os) => !used.has(os.id)).map((os) => ({ id: os.id, key: os.key })),
    };
}
export function putVolume(volumes, volumeId, incoming, { allowLine = [] } = {}) {
    let old = volumes.find((v) => v.id === volumeId);
    if (!old) return { volumes, match: null };
    let match = matchStages(old.stages, incoming.stages || []),
        next = { ...old, key: incoming.key || old.key, stages: match.stages };
    return { volumes: putLine(volumes.map((v) => (v.id === volumeId ? next : v)), volumeId, incoming.line, allowLine), match };
}

// 保留条件：切到别的开始方式时，暂存切换前那条复杂的开启条件，选回「保留现有条件」时恢复（GPT 第三轮 C1）
const REVIEW_ONLY_LINE_KEYS = ['开始时机已选', '开始方式表格', '表格条件草稿', '保留条件'];
// ---- 改动摘要：写实质变化，不笼统说「内容有改动」（R2 末条）----
const nodeList = (stage) => stageNodes(stage && stage.data).filter((n) => n.kind !== 'world');
const condText = (c) => (c == null || c === '' ? '（无）' : typeof c == 'string' ? c : JSON.stringify(c).replace(/"/g, ''));
const LINE_WORDS = { 类型: '类型', 简介: '简介', 开启条件: '开始条件', 开启方式: '开始方式', 开启时段: '开启时段', 入口提示: '入口', 接上一条: '排在前一条主线后面' };
export function stageChanges(before, after) {
    let out = [],
        a = before && before.data ? before.data : {},
        b = after && after.data ? after.data : {};
    before && after && before.key !== after.key && out.push(`阶段改名：「${stageLabel(before.key)}」→「${stageLabel(after.key)}」`);
    for (let k of ['AI指令', ...STAGE_COND_KEYS]) !same(a[k], b[k]) && out.push(k === 'AI指令' ? 'AI指令改了' : `${k}：${condText(a[k])} → ${condText(b[k])}`);
    let na = new Map(nodeList(before).map((n) => [nodeUid(n.item) || n.name, n])),
        nb = new Map(nodeList(after).map((n) => [nodeUid(n.item) || n.name, n]));
    for (let [id, n] of nb) if (!na.has(id)) out.push(`新增节点「${n.name}」`);
    for (let [id, n] of na) if (!nb.has(id)) out.push(`删除节点「${n.name}」`);
    for (let [id, n] of nb) {
        let o = na.get(id);
        if (!o) continue;
        let oi = isPlainObject(o.item) ? o.item : {},
            ni = isPlainObject(n.item) ? n.item : {};
        o.name !== n.name && out.push(`节点改名：「${o.name}」→「${n.name}」`);
        for (let k of NODE_COND_KEYS) !same(oi[k], ni[k]) && out.push(`「${n.name}」的${k}：${condText(oi[k])} → ${condText(ni[k])}`);
        !same(oi.必需, ni.必需) && out.push(`「${n.name}」改成${ni.必需 === !1 || ni.必需 === 'false' ? '可选' : '必需'}`);
        let fa = discoveryList(oi).map((d) => d.fact).filter(Boolean),
            fb = discoveryList(ni).map((d) => d.fact).filter(Boolean),
            gone = fa.filter((f) => !fb.includes(f)),
            added = fb.filter((f) => !fa.includes(f));
        (gone.length || added.length) && out.push(`「${n.name}」的发现：${[...added.map((f) => `+${f}`), ...gone.map((f) => `−${f}`)].join(' ')}`);
        for (let k of ['入口', '场景', '地点']) !same(oi[k], ni[k]) && out.push(`「${n.name}」的${k}改了`);
        !same(discoveryList(oi), discoveryList(ni)) && !gone.length && !added.length && out.push(`「${n.name}」的发现内容改了`);
        // 上面没单独写到的字段（事件、偏转、触发……）：列出字段名，不让改动被漏掉（GPT 代码审阅 R1）
        let named = new Set(['id', '名称', '必需', '发现', '入口', '场景', '地点', ...NODE_COND_KEYS]),
            rest = [...new Set([...Object.keys(oi), ...Object.keys(ni)])].filter((k) => !named.has(k) && !same(oi[k], ni[k]));
        rest.length && out.push(`「${n.name}」的${rest.join('、')}改了`);
        !isPlainObject(o.item) && !isPlainObject(n.item) && o.name === n.name && !same(o.item, n.item) && out.push(`「${n.name}」改了`);
    }
    let order = (list) => list.map((n) => nodeUid(n.item) || n.name),
        oa = order(nodeList(before)).filter((id) => nb.has(id)),
        ob = order(nodeList(after)).filter((id) => na.has(id));
    !same(oa, ob) && out.push('节点顺序改了');
    // 阶段的其他字段（时间范围、状态变化、世界动态……）
    let skip = new Set(['AI指令', ...STAGE_COND_KEYS, '主线节点', '支线事件']);
    for (let k of [...new Set([...Object.keys(a), ...Object.keys(b)])]) !skip.has(k) && !same(a[k], b[k]) && out.push(`${k}改了`);
    // 兜底：内容确实不同、上面却一条都没写出来
    !out.length && before && after && !same(before.data, after.data) && out.push('内容改了');
    return out;
}
export function lineChanges(before, after) {
    let a = isPlainObject(before) ? before : {},
        b = isPlainObject(after) ? after : {};
    return Object.keys({ ...LINE_WORDS, ...a, ...b })
        .filter((k) => k !== '编号' && !same(a[k], b[k]))
        .map((k) => `${LINE_WORDS[k] || k}：${condText(a[k])} → ${condText(b[k])}`);
}
// 草稿和基准比：每个单位的改动摘要（按卷 id、阶段 id 对应）。
export function draftChanges(base, draft) {
    [base, draft] = [stripReviewMarks(base), stripReviewMarks(draft)];
    let out = [];
    for (let v of draft) {
        let o = base.find((x) => x.id === v.id);
        if (!o) {
            out.push({ key: unitKey(v.id), changes: ['新增这条剧情线'] });
            continue;
        }
        let lc = lineChanges(o.line, v.line);
        o.key !== v.key && lc.unshift(`名称：「${stageLabel(o.key)}」→「${stageLabel(v.key)}」`);
        let keep = o.stages.map((x) => x.id).filter((id) => v.stages.some((y) => y.id === id)),
            now = v.stages.map((x) => x.id).filter((id) => keep.includes(id));
        !same(keep, now) && lc.push('阶段顺序改了');
        lc.length && out.push({ key: unitKey(v.id), changes: lc });
        for (let s of v.stages) {
            let os = o.stages.find((x) => x.id === s.id),
                c = os ? stageChanges(os, s) : ['新增阶段'];
            c.length && out.push({ key: unitKey(v.id, s.id), changes: c });
        }
        for (let os of o.stages) v.stages.some((x) => x.id === os.id) || out.push({ key: unitKey(v.id, os.id), changes: [`删除阶段「${stageLabel(os.key)}」`] });
    }
    return out;
}

// 用户在这次审阅里实际改过的线（打开时的样子 → 草稿）：保存、计数、对齐都只看这些（GPT 第二轮 N1）。
// 大纲里别处改了、这里没动过的线不算，不能拿旧草稿去盖。
export function editedVolumes(review) {
    let base = (review && review.base) || [];
    return ((review && review.draft) || []).filter((v) => {
        let b = base.find((x) => x.id === v.id);
        return !b || draftDiffers([b], [v]);
    });
}
// 保存前后核对的目标：这几条线在大纲里现在的样子（删掉的记 null）。确认框弹出期间目标线变了或被删 → 不写（N1）。
export function targetStamp(project, ids) {
    let vols = (project && project.outline && project.outline.volumes) || [];
    return stableText(ids.map((id) => vols.find((v) => v.id === id) || null));
}

// 有没有要保存的改动：比完整内容，不看摘要（摘要只是给人看的，GPT 代码审阅 R1）。
export function draftDiffers(base, draft) {
    [base, draft] = [stripReviewMarks(base), stripReviewMarks(draft)];
    let strip = (v) => (v ? { key: v.key, line: v.line, stages: v.stages } : null);
    return draft.some((v) => !same(strip(base.find((x) => x.id === v.id)), strip(v))) || base.some((o) => !draft.some((v) => v.id === o.id));
}

// 线头提供的外部事实来源（正文里发生、填表记下，不靠节点产出）：开启条件里的事实 + 旧写法「开场事实」。
// 和 checkClueDraft 的判断一致（GPT 第三轮 C2）：那边把线的开启条件事实和 legacyFact 都算作已有来源。
export function lineFactSources(line) {
    if (!isPlainObject(line)) return [];
    let out = [];
    line.开启条件 != null && line.开启条件 !== '' && out.push(...conditionRefs(parseCondition(line.开启条件, [])).facts);
    let legacy = String(line.开场事实 || '').trim();
    legacy && out.push(legacy);
    return out;
}

// ---- 关联分组（R4）：按实际引用把要一起改的单位编成组 ----
// 引用来源：阶段进入 / 结束条件、节点开放 / 提前 / 完成条件、线头开启条件里的事实与节点；事实由哪个阶段产出。
// 同一条线的相邻阶段（前一阶段的结束 ↔ 后一阶段的进入）在条件互相引用时也算关联。
function unitRefs(volumes) {
    let produce = new Map(),
        nodeHome = new Map(),
        uses = new Map(),
        lineFacts = new Set(),
        add = (key, cond) => {
            if (cond == null || cond === '') return;
            let r = conditionRefs(parseCondition(cond, []));
            uses.set(key, { facts: new Set([...(uses.get(key)?.facts || []), ...r.facts]), nodes: new Set([...(uses.get(key)?.nodes || []), ...r.nodes]) });
        };
    for (let v of volumes) {
        isPlainObject(v.line) && (add(unitKey(v.id), v.line.开启条件), lineFactSources(v.line).forEach((f) => lineFacts.add(f)));
        for (let s of v.stages) {
            let key = unitKey(v.id, s.id),
                d = isPlainObject(s.data) ? s.data : {};
            STAGE_COND_KEYS.forEach((k) => add(key, d[k]));
            for (let n of stageNodes(d)) {
                let item = isPlainObject(n.item) ? n.item : {};
                nodeUid(item) && nodeHome.set(nodeUid(item), key);
                NODE_COND_KEYS.forEach((k) => add(key, item[k]));
                discoveryList(item).forEach((x) => x.fact && produce.set(x.fact, [...(produce.get(x.fact) || []), key]));
            }
        }
    }
    return { produce, nodeHome, uses, lineFacts };
}
// want：想修改的单位键。返回 [[键…], …]：每组是要一起交给模型、一起应用的单位。
// 只把 want 里互相有引用的合成一组，不会把整个大纲都拉进来；被引用但不在 want 里的单位作为只读上下文（见 groupContext）。
export function relatedGroups(volumes, want) {
    let { produce, nodeHome, uses } = unitRefs(volumes),
        wanted = [...new Set(want)],
        parent = new Map(wanted.map((k) => [k, k])),
        find = (k) => (parent.get(k) === k ? k : (parent.set(k, find(parent.get(k))), parent.get(k))),
        join = (a, b) => parent.has(a) && parent.has(b) && parent.set(find(a), find(b));
    for (let k of wanted) {
        let u = uses.get(k);
        if (!u) continue;
        for (let f of u.facts) for (let p of produce.get(f) || []) p !== k && join(k, p);
        for (let n of u.nodes) nodeHome.has(n) && nodeHome.get(n) !== k && join(k, nodeHome.get(n));
    }
    let groups = new Map();
    for (let k of wanted) groups.set(find(k), [...(groups.get(find(k)) || []), k]);
    return [...groups.values()];
}
// 一组修改需要的只读上下文：组外、但和组内单位有引用关系的单位里的真实条件表达式和事实来源（R4：名称和概述不能替代条件本身）。
export function groupContext(volumes, group) {
    let { produce, nodeHome, uses } = unitRefs(volumes),
        inGroup = new Set(group),
        facts = new Set(),
        related = new Set();
    for (let k of group) {
        let u = uses.get(k);
        u && (u.facts.forEach((f) => facts.add(f)), u.nodes.forEach((n) => nodeHome.has(n) && related.add(nodeHome.get(n))));
        let val = unitValue(volumes, k);
        val && val.data && stageNodes(val.data).forEach((n) => discoveryList(isPlainObject(n.item) ? n.item : {}).forEach((d) => d.fact && facts.add(d.fact)));
    }
    for (let f of facts) (produce.get(f) || []).forEach((p) => related.add(p));
    for (let [k, u] of uses) [...u.facts].some((f) => facts.has(f)) && related.add(k);
    return { facts: [...facts], units: [...related].filter((k) => !inGroup.has(k)) };
}

// 一组修改会不会把组外的引用改断（GPT 代码审阅 R5）：组外的单位（含项目里别的线）引用的事实 / 节点，
// 改之前有产出 / 存在，改之后没了。返回 [{ key, refs }]。只看程序能验证的结构，不猜剧情意图；原来就断的不算。
// background：项目里别的线（不在 before / after 里的卷）。
export function refBreaks(before, after, group, background = []) {
    let A = unitRefs([...background, ...before]),
        B = unitRefs([...background, ...after]),
        inGroup = new Set(group),
        out = [];
    for (let [k, u] of B.uses) {
        if (inGroup.has(k)) continue;
        let lost = [...[...u.facts].filter((f) => A.produce.has(f) && !B.produce.has(f)), ...[...u.nodes].filter((n) => A.nodeHome.has(n) && !B.nodeHome.has(n))];
        lost.length && out.push({ key: k, refs: lost });
    }
    return out;
}

// 这次修改让组内的引用找不到了（GPT 第二轮 N8、第三轮 C3）：新写的节点 id 不存在、新写的事实没有来源；
// 或原来能找到的引用改完找不到了。事实来源：节点产出，或线头的外部来源（lineFactSources）。原来就断的不算。返回 [{ key, refs }]。
export function newMissingRefs(before, after, group, background = []) {
    let A = unitRefs([...background, ...before]),
        B = unitRefs([...background, ...after]),
        out = [];
    let hasFact = (R, f) => R.produce.has(f) || R.lineFacts.has(f);
    for (let k of group) {
        let now = B.uses.get(k),
            was = A.uses.get(k) || { facts: new Set(), nodes: new Set() };
        if (!now) continue;
        // 新写的引用找不到；或者原来就在用、原来有来源、这次改完没来源了（同组里把产出删了，GPT 第三轮 C3）。
        // 原来就找不到的旧问题不算，留给检查。来源挪到同组别处、仍找得到的照常放行。
        let bad = [
            ...[...now.nodes].filter((n) => !B.nodeHome.has(n) && (!was.nodes.has(n) || A.nodeHome.has(n))),
            ...[...now.facts].filter((f) => !hasFact(B, f) && (!was.facts.has(f) || hasFact(A, f))),
        ];
        bad.length && out.push({ key: k, refs: bad });
    }
    return out;
}

// 一组的结果是否能整组应用（R4）：每个单位都要拿到、解析成功、期间没被用户改过；模型多给的单位不算数。
// results：{ 键: 新值 }；snapshot：发请求时这几个单位的值（JSON 字符串）；current：现在的草稿。
export function groupVerdict(group, results, snapshot, current) {
    let missing = group.filter((k) => !(k in results)),
        touched = group.filter((k) => JSON.stringify(unitValue(current, k)) !== snapshot[k]),
        extra = Object.keys(results).filter((k) => !group.includes(k));
    return { ok: !missing.length && !touched.length, missing, touched, extra };
}

// ---- 统一保存入口（R1）----
// 合成要写进项目的大纲：项目现在的大纲里，按卷 id 换掉这次审阅的线（新线追加），别的不动。
// 对已有线跑 historyGuard，并真正执行 restoreHistory；对最终内容重新生成摘要和检查。
// clue：{ snap, prog, config } —— 当前聊天的进度（项目没在这个聊天启用时为 null，不做历史保护）。
// check：(volumes) => 问题列表（调用方传入，比如 importReachIssues + checkClueDraft）。
// 返回 { volumes, history, guard, restored, changes, issues, removedStages }；调用方确认后用 commitOutline 写入。
// 审阅页自己用的线头标记（开始时机已选、表格条件表单的状态），不写进大纲。
// 选了「按表格条件」但表单没填完的线（表、行、列、值缺一个）：不能保存成没有条件（GPT 第二轮 N2）。
export function incompleteTableLines(volumes) {
    return (volumes || []).filter((v) => isPlainObject(v.line) && v.line.开始方式表格 && (isPlainObject(v.line.表格条件草稿) || v.line.开启条件 == null || v.line.开启条件 === ''));
}
export function stripReviewMarks(volumes) {
    return volumes.map((v) => {
        if (!isPlainObject(v.line) || !REVIEW_ONLY_LINE_KEYS.some((k) => k in v.line)) return v;
        let line = { ...v.line };
        REVIEW_ONLY_LINE_KEYS.forEach((k) => delete line[k]);
        return { ...v, line };
    });
}
export function prepareCommit(project, draft, { clue = null, check = null, label = '审阅保存' } = {}) {
    draft = stripReviewMarks(draft);
    let current = project.outline.volumes,
        byId = new Map(draft.map((v) => [v.id, v])),
        merged = [...current.map((v) => byId.get(v.id) || v), ...draft.filter((v) => !current.some((c) => c.id === v.id))],
        guard = null,
        restored = [];
    if (clue && clue.snap) {
        guard = historyGuard(current, merged, clue.snap, clue.prog, clue.config);
        if (guard.keepDone.size || guard.reinsert.size)
            ((merged = restoreHistory(merged, guard)), (restored = [...guard.keepDone.keys(), ...guard.reinsert.keys()]));
    }
    let base = current.filter((v) => byId.has(v.id)),
        removedStages = base.flatMap((v) => v.stages.filter((s) => !merged.find((m) => m.id === v.id)?.stages.some((x) => x.id === s.id)).map((s) => s.id));
    return {
        volumes: merged,
        history: pushOutlineHistory(project.outline.history, current, label),
        guard,
        restored,
        changes: draftChanges(base, merged.filter((v) => byId.has(v.id))),
        issues: check ? check(merged) : [],
        removedStages,
        stamp: JSON.stringify(current),
    };
}
// 写入：确认期间大纲又变了（stamp 对不上）就不写，让调用方重新准备（R1 第 5 条）。
export function commitOutline(project, prepared) {
    if (JSON.stringify(project.outline.volumes) !== prepared.stamp) return { ok: !1, why: '确认期间大纲又被改过了，请重新检查后再保存' };
    return { ok: !0, outline: { ...project.outline, volumes: prepared.volumes, history: prepared.history } };
}

// ---- 「好几条支线」导入改用统一审阅页（第二批 b，用户 2026-11-16）----
// 旧任务的逐条审阅数据（job.lineReview.items）迁进审阅会话：当前改稿（作 base 和 draft）、意见（comment）、不导入、重新整理前的内容；
// 不从原始整理结果重建（GPT 界面审阅：迁移时保留已经审过的内容）。上次意见（lastComment）、改动列表不迁；旧 lineReview 原样留在任务里，不再写。
// 会话里额外记：dropped（本次不导入的线的卷 id）、prev（重新整理前的内容，按卷 id）、lineIds（卷 id → 文档里的线编号）。
// 一条线的意见（旧的按线意见）放到这条线的线页（unitKey(vol.id)）上。
export function linesSessionOf(job) {
    let lr = job && isPlainObject(job.lineReview) ? job.lineReview : null;
    if (!lr || !isPlainObject(lr.items)) return null;
    let order = (lr.order || Object.keys(lr.items)).filter((id) => lr.items[id] && lr.items[id].vol),
        vols = order.map((id) => {
            let v = lr.items[id].vol;
            return { ...v, id: v.id || makeId('v'), stages: (v.stages || []).map((s) => ({ ...s, id: s.id || makeId('s') })) };
        }),
        s = createReviewSession({ source: 'import', projectId: job.projectId, jobId: job.id, volumes: vols });
    let comments = {},
        dropped = [],
        prev = {},
        lineIds = {};
    order.forEach((id, i) => {
        let x = lr.items[id],
            v = vols[i];
        lineIds[v.id] = id;
        x.comment && String(x.comment).trim() && (comments[unitKey(v.id)] = x.comment);
        x.dropped && dropped.push(v.id);
        x.prev && (prev[v.id] = x.prev);
    });
    return { ...s, comments, dropped, prev, lineIds, conflicts: lr.conflicts || [], at: 0, mode: 'clue', lines: !0 };
}
// 一次导入里要写进大纲的线：去掉不导入的、已经采用过的（按线编号记在项目里）。
export function linesToAdopt(review, adoptedIds = new Set()) {
    let drop = new Set(review.dropped || []);
    return review.draft.filter((v) => !drop.has(v.id) && !adoptedIds.has((review.lineIds || {})[v.id] || String((v.line || {}).编号 || '')));
}
