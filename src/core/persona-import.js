import { makeId } from './outline.js';
import { newStage } from './personas.js';

// 从世界书转入人设：解析条目里的 <if cell="表/行/列 == 值">…</if>，按变量拆成人设线，纯逻辑，不碰酒馆。
// 条件写法：cell="路径 == 值"、cond="cell:路径 >= 21 & cell:路径 <= 40"（& 为并且）、cond="cell:路径 == 甲, cell:路径 == 乙"（逗号为或者）。
// 句中短 if、嵌套在阶段里的 if 的变量不拆阶段，转入时按预览里选的值「写死」：只保留选中值那段文字。

const TAG = /<if\s+(cell|cond)\s*=\s*(?:"([^"]*)"|'([^']*)')\s*>|<\/if\s*>/gi;
const TERM = /^(?:cell:)?\s*(.+?)\s*(==|!=|<=|>=|<|>)\s*(.+?)\s*$/;

export const hasIf = content => /<if\s/i.test(String(content || ''));

function isNumber(value) {
    return value !== '' && Number.isFinite(Number(value));
}

// ---------- 条件 ----------

// 返回 { vars: Set(路径), terms: [{ path, op, value }], or: boolean } 或 { error }。
export function parseCond(raw) {
    const text = String(raw || '').trim();
    if (!text) return { error: '条件为空' };
    const hasAnd = text.includes('&');
    const parts = text.split(hasAnd ? '&' : /[,，]/).map(item => item.trim()).filter(Boolean);
    const terms = [];
    for (const part of parts) {
        const match = TERM.exec(part);
        if (!match) return { error: `无法解析条件「${part}」` };
        if (!['==', '<=', '>='].includes(match[2])) return { error: `不支持的比较符「${match[2]}」` };
        terms.push({ path: match[1].trim(), op: match[2], value: match[3].trim() });
    }
    if (!terms.length) return { error: '条件为空' };
    return { vars: new Set(terms.map(term => term.path)), terms, or: !hasAnd && terms.length > 1 };
}

// ---------- 解析成树 ----------

// 夹在一句话中间的 if：前一个兄弟是文字且最后一行有字，或前一个兄弟本身是这样的 if（相邻 if 连成一串）。
function isInline(siblings) {
    const last = siblings[siblings.length - 1];
    if (!last) return false;
    if (last.type === 'if') return last.inline;
    return last.text.slice(last.text.lastIndexOf('\n') + 1).trim() !== '';
}

// 返回 { nodes, issues }。节点：{ type: 'text', text } 或 { type: 'if', cond, raw, parsed, children, depth, inline }。
export function parseEntry(content) {
    const source = String(content || '');
    const root = { children: [] };
    const stack = [root];
    const issues = [];
    let last = 0;
    let open = 0;
    const push = node => stack[stack.length - 1].children.push(node);
    const pushText = text => { if (text) push({ type: 'text', text }); };
    for (const match of source.matchAll(TAG)) {
        pushText(source.slice(last, match.index));
        last = match.index + match[0].length;
        if (match[0][1] === '/') {
            if (stack.length === 1) {
                issues.push({ level: 'error', text: '多出一个 </if>，没有对应的开头' });
            } else {
                stack.pop();
            }
            continue;
        }
        open += 1;
        const cond = match[2] ?? match[3] ?? '';
        const node = { type: 'if', cond, raw: match[0], parsed: parseCond(cond), children: [], depth: stack.length - 1, inline: isInline(stack[stack.length - 1].children) };
        push(node);
        stack.push(node);
    }
    pushText(source.slice(last));
    if (stack.length > 1) issues.push({ level: 'error', text: `有 ${stack.length - 1} 个 <if> 没有写 </if>` });
    const found = (source.match(/<if\b/gi) || []).length;
    if (found !== open) issues.push({ level: 'error', text: `有 ${found - open} 个 <if> 标签写法无法识别（只支持 cell= 与 cond=）` });
    return { nodes: root.children, issues };
}

function* walkIfs(nodes) {
    for (const node of nodes) {
        if (node.type !== 'if') continue;
        yield node;
        yield* walkIfs(node.children);
    }
}

// ---------- 变量 ----------

const SUFFIX = /(?:状态|数值|信息|追踪|角色)?表$/;

// 表/行/列 → 角色名（分组）与线名。「主角状态表/主角状态/心境」→ 主角、心境；「重要角色表/林晚/对主角」→ 林晚、对主角。
export function pathNames(path) {
    const parts = String(path).split('/').map(item => item.trim());
    const column = parts[parts.length - 1] || path;
    if (parts.length < 3) return { group: parts.length === 2 ? parts[0] : '', name: column };
    const table = parts[0].replace(SUFFIX, '');
    const row = parts[1];
    return { group: table && row.includes(table) ? table : row, name: column };
}

// 条目标题可能带着数据库插件写的注释块：取第一行有字的，去掉开头的表情与方括号标签。
export const entryName = title => {
    const first = String(title || '').replace(/<!--[\s\S]*?-->/g, '').split('\n').map(line => line.trim()).find(Boolean) || '';
    return first.replace(/^[^\p{L}\p{N}[]+/u, '').replace(/^\[[^\]]*\]\s*/, '') || '未命名';
};

const loose = value => String(value).replace(/[\s　，。、；;：:！!？?·・.]/g, '').toLowerCase();

// 扫描所选条目，返回每个变量的出现情况：{ path, ops: Set, values: [按出现顺序], nested, inline, entries: Set(条目key) }。
function scanVars(parsedEntries) {
    const vars = new Map();
    const lostRefs = new Map();
    for (const { key, tree } of parsedEntries) {
        for (const node of walkIfs(tree.nodes)) {
            if (!node.parsed.vars) continue;
            // 多变量组合的条件整条会被拦下：只记下「这个变量还有被拦下的来源」，不参与分类。
            if (node.parsed.vars.size !== 1) {
                for (const path of node.parsed.vars) (lostRefs.get(path) || lostRefs.set(path, new Set()).get(path)).add(key);
                continue;
            }
            const [path] = node.parsed.vars;
            if (!vars.has(path)) vars.set(path, { path, ops: new Set(), values: [], nested: false, inline: false, entries: new Set() });
            const info = vars.get(path);
            info.entries.add(key);
            if (node.depth > 0) info.nested = true;
            if (node.inline) info.inline = true;
            for (const term of node.parsed.terms) {
                info.ops.add(term.op);
                if (term.op === '==' && !info.values.includes(term.value)) info.values.push(term.value);
            }
        }
    }
    for (const [path, keys] of lostRefs) if (vars.has(path)) vars.get(path).lost = keys;
    return vars;
}

// 变量分类：只用 == 比较，并且出现在别的 if 里面或夹在一句话中间的，默认写死为某值（嵌套的只能写死）；带 <=、>= 的是数值（读声望）；其余是枚举阶段。
export function classifyVar(info, override = '') {
    const numeric = info.ops.has('<=') || info.ops.has('>=');
    if (numeric) return 'num';
    if (info.nested) return 'fixed';
    if (override === 'fixed') return 'fixed';
    if (override === 'line') return 'enum';
    return info.inline ? 'fixed' : 'enum';
}

// ---------- 渲染成文字 ----------

const trimBlock = text => String(text).replace(/^[ \t]*\n/, '').replace(/\s+$/, '');
const stripComments = text => String(text).replace(/<!--[\s\S]*?-->/g, '');

// 写死的变量 if → 只保留选中值那段；其他 if（嵌套在阶段里的非写死变量）记问题后只保留内容。
function renderNodes(nodes, ctx) {
    let out = '';
    for (const node of nodes) {
        if (node.type === 'text') { out += node.text; continue; }
        const one = node.parsed.vars && node.parsed.vars.size === 1 ? [...node.parsed.vars][0] : '';
        const fixed = one && ctx.kinds.get(one) === 'fixed';
        const body = () => (node.inline ? renderNodes(node.children, ctx) : trimBlock(renderNodes(node.children, ctx)));
        if (fixed && node.parsed.terms.every(term => term.op === '==')) {
            const picked = ctx.picks.get(one);
            const hit = node.parsed.or ? node.parsed.terms.some(term => term.value === picked) : node.parsed.terms.every(term => term.value === picked);
            if (hit) out += body();
        } else {
            ctx.issue('error', `嵌套了无法拆分的 if「${node.cond.replace(/cell:/g, '')}」`);
            out += renderNodes(node.children, ctx);
        }
    }
    return out;
}

// ---------- 拆分 ----------

function rangeOfTerms(terms) {
    const range = {};
    for (const term of terms) {
        const value = Number(term.value);
        if (!Number.isFinite(value)) return null;
        if (term.op === '>=') range.min = range.min === undefined ? value : Math.max(range.min, value);
        else if (term.op === '<=') range.max = range.max === undefined ? value : Math.min(range.max, value);
        else { range.min = value; range.max = value; }
    }
    return range;
}

const rangeKey = range => `${range.min ?? ''}~${range.max ?? ''}`;
const rangeName = range => (range.min === undefined ? `≤${range.max}` : range.max === undefined ? `≥${range.min}` : range.min === range.max ? `${range.min}` : `${range.min}–${range.max}`);
const stateLine = text => {
    const match = /^[ \t]*状态[：:][ \t]*(.+)$/m.exec(String(text));
    return match ? match[1].trim() : '';
};
const join = (a, b) => [a, b].filter(item => String(item).trim()).join('\n');

// 数值阶段按下限从小到大排，相邻区间之间缺的补一个空阶段。
function numericStages(entries) {
    const sorted = [...entries].sort((a, b) => (a.range.min ?? -Infinity) - (b.range.min ?? -Infinity));
    const out = [];
    for (const item of sorted) {
        const prev = out[out.length - 1];
        const from = prev && prev.range.max !== undefined ? prev.range.max + 1 : undefined;
        if (prev && from !== undefined && item.range.min !== undefined && item.range.min > from) {
            out.push({ ...newStage('空档'), name: rangeName({ min: from, max: item.range.min - 1 }), range: { min: from, max: item.range.min - 1 }, text: '' });
        }
        out.push({ ...newStage(rangeName(item.range)), range: item.range, text: item.text, cond: '' });
    }
    return out;
}

// 返回 { lines, issues, blocked: Set(条目key), vars }。
// entries：[{ book, key, uid, title, content, keys, constant, position, depth, role, order }]；overrides：{ [路径]: 'fixed'（写死） | 'line' }；picks：{ [路径]: 写死时保留的值 }，缺省取第一个值。
export function buildPlan(entries, { overrides = {}, picks = {} } = {}) {
    const parsed = entries.map(entry => ({ entry, key: `${entry.book}\u0000${entry.key}`, tree: parseEntry(entry.content) }));
    const blocked = new Set();
    const issues = [];
    const report = (entry, level, text) => {
        issues.push({ book: entry.book, key: entry.key, title: entry.title, level, text });
        if (level === 'error') blocked.add(`${entry.book}\u0000${entry.key}`);
    };
    for (const item of parsed) for (const issue of item.tree.issues) report(item.entry, issue.level, issue.text);

    const info = scanVars(parsed);
    const kinds = new Map([...info.values()].map(item => [item.path, classifyVar(item, overrides[item.path])]));
    // 同一变量的值写法不一致（只差空白或标点）。
    for (const item of info.values()) {
        const seen = new Map();
        for (const value of item.values) {
            const norm = loose(value);
            if (seen.has(norm) && seen.get(norm) !== value) report(entries.find(entry => item.entries.has(`${entry.book}\u0000${entry.key}`)) || entries[0], 'warn', `变量「${pathNames(item.path).name}」的值写法不一致：「${seen.get(norm)}」与「${value}」`);
            else seen.set(norm, value);
        }
        if (kinds.get(item.path) === 'num' && item.values.some(value => !isNumber(value))) {
            for (const entry of entries) if (item.entries.has(`${entry.book}\u0000${entry.key}`)) report(entry, 'error', `变量「${pathNames(item.path).name}」同时用了数值与文字比较`);
        }
    }

    // 写死的变量：保留的值取预览里选的，缺省第一个。
    const pickMap = new Map();
    for (const item of info.values()) {
        if (kinds.get(item.path) !== 'fixed') continue;
        pickMap.set(item.path, item.values.includes(picks[item.path]) ? picks[item.path] : item.values[0]);
    }
    // 线按变量归并，条目顺序拼接。
    const lines = new Map();
    const lineFor = (path, kind, entry) => {
        if (!lines.has(path)) {
            const names = pathNames(path);
            lines.set(path, { kind, path, group: names.group, name: names.name, entry, common: '', stages: new Map(), sources: [] });
        }
        const line = lines.get(path);
        if (!line.sources.some(source => source.book === entry.book && source.uid === entry.uid)) line.sources.push({ book: entry.book, uid: String(entry.uid), key: String(entry.key) });
        return line;
    };
    const plainLines = [];

    for (const { entry, key, tree } of parsed) {
        if (blocked.has(key)) continue;
        const entryIssues = [];
        const ctx = { kinds, picks: pickMap, issue: (level, text) => entryIssues.push({ level, text }) };
        const outside = [];
        const staged = [];
        for (const node of tree.nodes) {
            const one = node.type === 'if' && node.parsed.vars && node.parsed.vars.size === 1 ? [...node.parsed.vars][0] : '';
            if (node.type === 'if' && !node.parsed.vars) { entryIssues.push({ level: 'error', text: `${node.parsed.error}：${node.cond}` }); continue; }
            if (node.type === 'if' && node.parsed.vars.size !== 1) { entryIssues.push({ level: 'error', text: `多个变量组合的条件暂不支持：${node.cond.replace(/cell:/g, '')}` }); continue; }
            if (node.type === 'if' && kinds.get(one) !== 'fixed') staged.push({ node, path: one, kind: kinds.get(one) });
            else outside.push({ at: staged.length, text: node.type === 'text' ? node.text : renderNodes([node], ctx) });
        }
        const tidy = text => stripComments(text);
        // 阶段内容先渲染：里面嵌套的、不能拆分的 if 在这里记问题。
        for (const part of staged) part.body = trimBlock(tidy(renderNodes(part.node.children, ctx)));
        for (const problem of entryIssues) report(entry, problem.level, problem.text);
        if (entryIssues.some(problem => problem.level === 'error')) continue;

        const piece = at => outside.filter(item => item.at === at).map(item => item.text).join('');
        if (!staged.length) {
            const body = tidy(outside.map(item => item.text).join('')).trim();
            plainLines.push({ entry, text: body });
            continue;
        }
        // 夹在阶段前后的文字：前后恰好是成对的外层标签就跟着每个阶段走，否则并进公共文字。
        const prefix = tidy(piece(0));
        const suffix = tidy(piece(staged.length));
        const between = staged.slice(1).map((_, i) => tidy(piece(i + 1))).join('');
        const tag = /^\s*<([^\s>/]+)>\s*$/.exec(prefix);
        const wrap = Boolean(tag) && suffix.trim() === `</${tag[1]}>` && !between.trim();
        const common = wrap ? '' : [prefix, between, suffix].map(item => item.trim()).filter(Boolean).join('\n');
        let first = true;
        for (const part of staged) {
            const line = lineFor(part.path, part.kind === 'num' ? 'num' : 'enum', entry);
            if (first && common) { line.common = join(line.common, common); first = false; }
            const body = part.body;
            const text = wrap ? `${prefix.trim()}\n${body}\n${suffix.trim()}` : body;
            if (part.kind === 'num') {
                const range = rangeOfTerms(part.node.parsed.terms);
                if (!range) { report(entry, 'error', `数值条件无法解析：${part.node.cond}`); continue; }
                const id = rangeKey(range);
                const old = line.stages.get(id);
                line.stages.set(id, { range, text: join(old ? old.text : '', text) });
            } else {
                for (const term of part.node.parsed.terms) {
                    if (term.op !== '==') { report(entry, 'error', `文字变量「${line.name}」用了 ${term.op}`); continue; }
                    const old = line.stages.get(term.value);
                    line.stages.set(term.value, { value: term.value, text: join(old ? old.text : '', text) });
                }
            }
        }
    }

    const out = [];
    for (const line of lines.values()) {
        if (!line.sources.some(source => !blocked.has(`${source.book}\u0000${source.key}`))) continue;
        const base = { group: line.group, name: line.name, keys: line.entry.keys, constant: line.entry.constant, position: line.entry.position, depth: line.entry.depth, role: line.entry.role, order: line.entry.order, common: line.common, source: { book: line.entry.book, uid: String(line.entry.uid), varPath: line.path }, sources: line.sources };
        if (line.kind === 'num') {
            out.push({ ...base, mode: 'fame', fame: { bar: line.name, partner: '' }, stages: numericStages([...line.stages.values()]) });
        } else {
            const stages = [...line.stages.values()].map(item => ({ ...newStage(item.value), cond: stateLine(item.text), text: item.text }));
            out.push({ ...base, mode: 'check', fame: { bar: '', partner: '' }, stages });
        }
    }
    // 没有阶段、只有写死替换的条目：一条手动线，一个阶段。
    for (const { entry, text } of plainLines) {
        if (!text) continue;
        out.push({ group: '', name: entryName(entry.title), keys: entry.keys, constant: entry.constant, position: entry.position, depth: entry.depth, role: entry.role, order: entry.order, common: '', mode: 'manual', fame: { bar: '', partner: '' }, stages: [{ ...newStage('默认'), text }], source: { book: entry.book, uid: String(entry.uid), varPath: '' }, sources: [{ book: entry.book, uid: String(entry.uid), key: String(entry.key) }] });
    }

    const varList = [...info.values()].map(item => ({ path: item.path, name: pathNames(item.path).name, group: pathNames(item.path).group, kind: kinds.get(item.path), values: item.values, pick: pickMap.get(item.path), entries: item.entries.size, canFix: !(item.ops.has('<=') || item.ops.has('>=')), canLine: !item.nested }));
    return { lines: out, issues, blocked, vars: varList };
}

// ---------- 写入与恢复 ----------

const lineKeyOf = source => `${source.book}\u0000${source.key ?? source.uid}`;

// 把拆分结果并进项目人设，返回新的 personas；blocked 里的条目不转入、不记进 imported。
export function applyPlan(personas, plan, entries) {
    const ok = entries.filter(entry => !plan.blocked.has(`${entry.book}\u0000${entry.key}`));
    const lines = plan.lines.map(line => ({ id: makeId('pl'), enabled: true, ...line }));
    const imported = [...personas.imported.filter(item => !ok.some(entry => entry.book === item.book && String(entry.key) === String(item.key))), ...ok.map(entry => ({ book: entry.book, uid: String(entry.uid), key: String(entry.key), title: entry.title }))];
    return { ...personas, lines: [...personas.lines, ...lines], imported };
}

// 恢复一条原条目：从 imported 里去掉；removeLines 为真时一并删掉只来自这条的人设线（来自多条的线只去掉这一来源）。
export function releaseImported(personas, item, { removeLines = false } = {}) {
    const imported = personas.imported.filter(entry => !(entry.book === item.book && String(entry.key) === String(item.key)));
    if (!removeLines) return { ...personas, imported };
    const gone = lineKeyOf(item);
    const lines = personas.lines.flatMap(line => {
        const sources = Array.isArray(line.sources) && line.sources.length ? line.sources : line.source ? [{ book: line.source.book, uid: line.source.uid, key: line.source.uid }] : [];
        if (!sources.some(source => lineKeyOf(source) === gone)) return [line];
        const rest = sources.filter(source => lineKeyOf(source) !== gone);
        return rest.length ? [{ ...line, sources: rest }] : [];
    });
    return { ...personas, imported, lines };
}
