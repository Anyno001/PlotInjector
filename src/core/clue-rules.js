import { countRows, pickEntry, tierCompare, findSheet, tierOrderInNote, cellText, sameValue, readCell, knowKey, knowKeyOf } from './clue-tables.js';

import { splitStageKey, volumeLabel, isPlainObject, flattenUnits, stageLabel, stageNodes } from './outline.js';

import { clueText, discoveryList } from './clue-project.js';

import { nodeUid, DEFAULT_CLUE } from './clue-model.js';

import { readChoice, readEnding, TIERS, CUSTOM } from './choice.js';

export const COND_MAX_DEPTH = 2;

// 时间条件只比钟点（evalAtom 用）：表格里的时间值 → 当天分钟数，取最后一个钟点；读不到返回 null
const CLOCK_PERIOD = '凌晨|清晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|夜晚|深夜';
const CLOCK_RE = new RegExp(`(${CLOCK_PERIOD})?\\s*(\\d{1,2})(?:[:：](\\d{2})|点(半|(\\d{1,2})分?)?|时)`, 'g');
export function clockOf(value) {
    let text = (Array.isArray(value) ? value.join(' ') : value == null ? '' : String(value)).trim(),
        last = null;
    for (let [, period, h, hm, half, dm] of text.matchAll(CLOCK_RE)) {
        let hh = Number(h),
            mm = Number(hm != null ? hm : half === '半' ? 30 : dm || 0) || 0;
        if (hh > 24 || mm > 59) continue;
        if (/下午|傍晚|晚上|夜里|夜晚/.test(period || '') && hh < 12) hh += 12;
        else if (period === '深夜' && hh >= 6 && hh < 12) hh += 12;
        else if (period === '凌晨' && hh === 12) hh = 0;
        last = (hh % 24) * 60 + mm;
    }
    return last;
}
function clockText(minutes) {
    let t = ((minutes % 1440) + 1440) % 1440;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}


export const ATOM_KEYS = ['事实', '知情', '核实', '节点', '表', '时间', '线'];

export const TRI = { t: 'true', f: 'false', u: 'unknown' };

// 作者检查推演时用：抉择、收尾节点都当作能完成，具体选了什么不知道
export const REACH_CHOICES = { enabled: !0, assumeAll: !0, choices: new Map(), ending: null, stateOf: () => null };

export function atomString(key, value) {
    let v = String(value ?? '').trim();
    return key === '时间' ? `时间 ${v}` : `${key}: ${v}`;
}

// 列名、行名里常有 <user> 这类标签：拆比较符号前先换成占位，免得其中的 < > 被当成比较符号
// （例：「表/行/对<user>阶段 >= 信任」会被拆成列「对」、值「user>阶段 >= 信任」）。
const TAG_RE = /<[A-Za-z_][\w-]*>/g;
export function splitCompare(text, re) {
    let tags = [],
        masked = String(text ?? '').replace(TAG_RE, (t) => (tags.push(t), `\u0000${tags.length - 1}\u0000`)),
        m = re.exec(masked);
    return m && [...m].map((x) => (x == null ? x : x.replace(/\u0000(\d+)\u0000/g, (_, i) => tags[+i])));
}

export function parseAtom(text) {
    let raw = String(text || '').trim(),
        m;
    if (
        ((m = /^<if\s+cell\s*=\s*["“]([^"”]+)["”]\s*>?/i.exec(raw)) && (raw = `表: ${m[1].trim()}`),
        (raw = normalizeOps(raw)),
        (m = /^事实\s*[:：]\s*(\S+)$/.exec(raw)))
    )
        return { kind: 'fact', fact: m[1], raw };
    if ((m = /^核实\s*[:：]\s*([^@\s]+)$/.exec(raw))) return { kind: 'fact', fact: m[1], verified: !0, raw };
    if ((m = /^(知情|核实)\s*[:：]\s*([^@\s]+)\s*@\s*(.+)$/.exec(raw)))
        return { kind: 'know', fact: m[2], actor: m[3].trim(), verified: m[1] === '核实', raw };
    if ((m = /^节点\s*[:：]\s*(\S+)$/.exec(raw))) return { kind: 'node', node: m[1], raw };
    if ((m = /^抉择\s*[:：]\s*(\S+)\s+(选了|结果)\s*[:：]?\s*(\S+)$/.exec(raw))) {
        let [, node, what, value] = m;
        return what === '结果' && !TIERS.includes(value)
            ? { kind: 'bad', raw, error: `抉择的结果只能写 ${TIERS.join(' / ')}` }
            : { kind: 'choice', node, what, value, raw };
    }
    if ((m = splitCompare(raw, /^表\s*[:：]\s*(.+?)\s*(==|!=|>=|<=|>|<|不包含|包含)\s*(.*)$/)))
        return { kind: 'cell', path: m[1].trim(), op: m[2], value: m[3].trim(), raw };
    if ((m = /^时间\s*(==|!=|>=|<=|>|<)\s*(.+)$/.exec(raw))) return { kind: 'time', op: m[1], value: m[2].trim(), raw };
    if ((m = /^线\s*[:：]\s*(\S+?)\s*(==|!=)\s*(\S+)$/.exec(raw))) {
        let state = m[3].trim();
        return LINE_STATES.includes(state) || LINE_STATE_ALIAS[state]
            ? { kind: 'line', line: m[1], op: m[2], state, raw }
            : {
                  kind: 'bad',
                  raw,
                  error: `线的状态「${state}」不认识，可以写：${[...LINE_STATES, ...Object.keys(LINE_STATE_ALIAS)].join('、')}`,
              };
    }
    return { kind: 'bad', raw, error: `无法识别的条件「${raw}」` };
}

export function parseCondition(value, errors = [], depth = 0) {
    if (value == null || value === '' || (Array.isArray(value) && !value.length) || (isPlainObject(value) && !Object.keys(value).length))
        return null;
    if (typeof value == 'string') {
        let atom = parseAtom(value);
        return (atom.kind === 'bad' && errors.push(atom.error), atom);
    }
    let mode = 'all',
        items;
    if (isPlainObject(value) && Object.keys(value).length === 1 && value.计数 !== void 0) return parseCountAtom(value.计数, errors);
    // {抉择: 节点id, 选了: 选项id | 自定义} / {抉择: 节点id, 结果: 顺利 | 有代价 | 失败}；两项都写就是「两项都满足」。
    // 多套了一层（{抉择: {抉择: …, 选了: …}}）也认。
    if (isPlainObject(value) && Object.keys(value).length === 1 && isPlainObject(value.抉择)) return parseCondition(value.抉择, errors, depth);
    if (isPlainObject(value) && value.抉择 !== void 0 && !isPlainObject(value.抉择) && (value.选了 !== void 0 || value.结果 !== void 0) && Object.keys(value).every((k) => ['抉择', '选了', '结果'].includes(k))) {
        let one = (what) => parseCondition(`抉择: ${String(value.抉择).trim()} ${what} ${String(value[what]).trim()}`, errors, depth),
            parts = ['选了', '结果'].filter((w) => value[w] !== void 0).map(one);
        return parts.length === 1 ? parts[0] : { kind: 'group', mode: 'all', items: parts };
    }
    if (
        isPlainObject(value) &&
        value.表 !== void 0 &&
        Object.keys(value).length > 1 &&
        Object.keys(value).every((k) => CELL_EXTRA_KEYS.includes(k))
    )
        return parseCellExtra(value, errors);
    if (isPlainObject(value)) {
        let keys = Object.keys(value),
            atoms = keys.filter((key) => ATOM_KEYS.includes(key));
        if (atoms.length && atoms.length === keys.length) {
            let list = atoms.map((key) => atomString(key, value[key]));
            if (list.length === 1) return parseCondition(list[0], errors, depth);
            value = list;
        }
    }
    if (Array.isArray(value)) items = value;
    else if (isPlainObject(value) && Array.isArray(value.全部) && Object.keys(value).length === 1) items = value.全部;
    else if (isPlainObject(value) && Array.isArray(value.任一) && Object.keys(value).length === 1) ((mode = 'any'), (items = value.任一));
    // {其中至少: N, 条件: [...]}：下面的条件满足至少 N 条
    else if (isPlainObject(value) && Array.isArray(value.条件) && Object.keys(value).length === 2 && value.其中至少 !== void 0) {
        let n = Math.round(Number(value.其中至少));
        if (!(n >= 1 && n <= value.条件.length))
            return (errors.push(`「其中至少」要写 1 到 ${value.条件.length} 之间的整数`), { kind: 'bad', raw: '', error: '数量错误' });
        return depth >= COND_MAX_DEPTH
            ? (errors.push('条件嵌套超过两层'), { kind: 'bad', raw: '', error: '嵌套过深' })
            : { kind: 'group', mode: 'atleast', n, items: value.条件.map((item) => parseCondition(item, errors, depth + 1)).filter(Boolean) };
    } else return (errors.push(`无法识别的条件结构：${JSON.stringify(value).slice(0, 60)}`), { kind: 'bad', raw: '', error: '结构错误' });
    return depth >= COND_MAX_DEPTH
        ? (errors.push('条件嵌套超过两层'), { kind: 'bad', raw: '', error: '嵌套过深' })
        : { kind: 'group', mode, items: items.map((item) => parseCondition(item, errors, depth + 1)).filter(Boolean) };
}

export function digitsOf(text) {
    return (String(text).match(/\d+/g) || []).map(Number);
}

// 时间值 → [日期里的数字…, 时, 分]。日期只取第一个钟点之前的部分；钟点按 clockOf 认（下午2:00 → 14:00）；「周3」「星期3」不算数字
const WEEKDAY_RE = /(周|星期|礼拜)\s*[\d一二三四五六日天]/g;
function timeDigits(text) {
    let t = cellText(text).replace(WEEKDAY_RE, ' '),
        m = new RegExp(CLOCK_RE.source).exec(t),
        clock = clockOf(t),
        date = digitsOf(m ? t.slice(0, m.index) : t);
    return clock == null ? date : [...date, Math.floor(clock / 60), clock % 60];
}
// 条件只写到日期（2008-05-10）而表格带钟点时，只比到日期：「<= 2008-05-10」当天任何时刻都成立，「> 2008-05-10」要到第二天
export function compareTime(cell, wanted) {
    let a = timeDigits(cell),
        b = timeDigits(wanted);
    if (!a.length || !b.length) return null;
    let n = a.length > b.length ? b.length : Math.max(a.length, b.length);
    for (let i = 0; i < n; i += 1) {
        let x = a[i] ?? 0,
            y = b[i] ?? 0;
        if (x !== y) return x - y;
    }
    return 0;
}
// 故事时间的绑定路径：每条再补一个「表/*/列」（单行表的唯一一行）。旧聊天存的绑定可能是按地点值找行的，主角换了地方就读不到
function withStarRows(paths) {
    let out = [...paths];
    for (let p of paths) {
        let s = String(p).split('/').map((x) => x.trim());
        s.length === 3 && s[1] !== '*' && out.push(`${s[0]}/*/${s[2]}`);
    }
    return out.filter((x, i, a) => a.indexOf(x) === i);
}

export function compareValues(a, b) {
    let na = Number(cellText(a)),
        nb = Number(cellText(b));
    if (cellText(a) !== '' && cellText(b) !== '' && Number.isFinite(na) && Number.isFinite(nb)) return na - nb;
    let da = digitsOf(a),
        db = digitsOf(b);
    if (!da.length || !db.length) return null;
    for (let i = 0; i < Math.max(da.length, db.length); i += 1) {
        let x = da[i] ?? 0,
            y = db[i] ?? 0;
        if (x !== y) return x - y;
    }
    return 0;
}

// 「编号 + 档位名」的格子（如「3 信任」「2 熟悉」）：条件写整数时按编号比，「== 3」成立。
// 只认「整数、空格、汉字开头的名字」这一种写法；本身就是数字的（1e3、3,000）和日期（如 2026年11月17日）不算。
const TIER_CELL = /^\s*(\d+)\s+[\u4e00-\u9fff][^\d]*$/;
function sameOrLead(cell, wanted) {
    if (sameValue(cell, wanted)) return !0;
    let w = cellText(wanted),
        m = TIER_CELL.exec(cellText(cell));
    return !!m && /^\d+$/.test(w) && Number(m[1]) === Number(w);
}
export function applyOp(op, cell, wanted) {
    if (op === '==') return sameOrLead(cell, wanted);
    if (op === '!=') return !sameOrLead(cell, wanted);
    let diff = compareValues(cell, wanted);
    return diff === null ? null : op === '>=' ? diff >= 0 : op === '<=' ? diff <= 0 : op === '>' ? diff > 0 : diff < 0;
}

// 人工记录：confirmed 已核实；revoked 作废；claimed 只是说法（满足「事实」不满足「核实」，见 evalAtom）；
// kept 玩家保留了「正文可能自行编造」那一行，只表示接受这笔登记，照表格判断。后两种在这里都按表格算。
export function effectiveFact(id, snapshot, clueProg) {
    let over = clueProg && clueProg.factOverrides && clueProg.factOverrides[id],
        fact = snapshot && snapshot.facts && snapshot.facts.get(id);
    if (over && over.status === 'revoked') return { v: TRI.f, confirmed: !1, text: '', why: `${id}已人工撤销` };
    if (over && over.status === 'confirmed')
        return { v: TRI.t, confirmed: !0, text: (fact && fact.text) || over.text || '', why: `${id}已人工确认` };
    if (!fact) return { v: TRI.u, confirmed: !1, text: '', why: `${id}尚无记录` };
    if (fact.status === 'confirmed') return { v: TRI.t, confirmed: !0, text: fact.text, why: `${id}已确认` };
    if (fact.status === 'pending') return { v: TRI.u, confirmed: !1, text: '', why: `${id}待确认` };
    return { v: TRI.f, confirmed: !1, text: '', why: `${id}未核实（${fact.raw || '空'}）` };
}

export function evalAtom(atom, env) {
    switch (atom.kind) {
        case 'fact': {
            let eff = effectiveFact(atom.fact, { facts: env.facts }, { factOverrides: env.factOverrides });
            if (atom.verified || eff.v !== TRI.f) return { v: eff.v, why: eff.why };
            let fact = env.facts && env.facts.get(atom.fact),
                over = env.factOverrides && env.factOverrides[atom.fact];
            return ((fact && fact.claimed) || (over && over.status === 'claimed')) && !(over && over.status === 'revoked')
                ? { v: TRI.t, why: `${atom.fact}已在正文出现（${fact.raw || '说法'}）` }
                : { v: eff.v, why: eff.why };
        }
        case 'know': {
            let over = env.factOverrides && env.factOverrides[atom.fact];
            if (over && over.status === 'revoked') return { v: TRI.f, why: `${atom.fact}已人工撤销` };
            // 主角的几种写法算同一人（D48）；别的角色名须完全一致
            let want = knowKey(atom.fact, atom.actor),
                rows = env.knowledge.filter((row) => row.fact === atom.fact && knowKey(row.fact, row.actor) === want);
            return rows.length
                ? atom.verified
                    ? rows.some((row) => row.verified === !0)
                        ? { v: TRI.t, why: `${atom.actor}已核实${atom.fact}` }
                        : rows.some((row) => row.verified === null)
                          ? { v: TRI.u, why: `无法判断${atom.actor}是否核实${atom.fact}（可信度未绑定或未填写）` }
                          : { v: TRI.f, why: `${atom.actor}对${atom.fact}仅为${rows[0].credibility || '未核实'}` }
                    : { v: TRI.t, why: `${atom.actor}知道${atom.fact}${rows[0].way ? `（${rows[0].way}）` : ''}` }
                : { v: TRI.u, why: `${atom.actor}没有${atom.fact}的知情记录` };
        }
        case 'line': {
            let st = env.lineState ? env.lineState(atom.line) : void 0;
            if (st === void 0) return { v: TRI.u, why: `没有编号为${atom.line}的线` };
            if (st === null)
                return atom.state === '开过' && env.lineStarted && env.lineStarted(atom.line)
                    ? { v: atom.op === '==' ? TRI.t : TRI.f, why: `线${atom.line}已经开始过` }
                    : { v: TRI.u, why: `线${atom.line}的状态还算不出来（开启条件未知，或线之间循环引用）` };
            let hit = (LINE_STATE_ALIAS[atom.state] || [atom.state]).includes(st);
            return { v: (atom.op === '==' ? hit : !hit) ? TRI.t : TRI.f, why: `线${atom.line}现在是「${st}」` };
        }
        case 'count': {
            let r = countRows(env.tables, atom.table, atom.column, atom.op, atom.value, applyOp);
            if (r.state !== 'ok') return { v: TRI.u, why: r.reason };
            let test = (n) => (atom.cmp === '至少' ? n >= atom.n : atom.cmp === '至多' ? n <= atom.n : n === atom.n),
                lo = test(r.count),
                hi = test(r.count + r.unsure),
                label = `${atom.table}里${atom.column} ${atom.op} ${atom.value}的有${r.count}行${r.unsure ? `，另有${r.unsure}行的值无法比较` : ''}`;
            return (
                atom.cmp === '等于' && (lo = hi = atom.n >= r.count && atom.n <= r.count + r.unsure && (!r.unsure || null)),
                lo === hi && lo !== null
                    ? lo
                        ? { v: TRI.t, why: label }
                        : { v: TRI.f, why: `${label}（要${atom.cmp} ${atom.n}行）` }
                    : { v: TRI.u, why: label }
            );
        }
        case 'choice': {
            let view = env.choices;
            if (!view || !view.enabled) return { v: TRI.u, why: '抉择功能未开启' };
            if (view.assumeAll) return { v: TRI.u, why: `取决于玩家在「${atom.node}」的选择` };
            let got = view.stateOf(atom.node);
            if (!got)
                return env.nodeForced && env.nodeForced(atom.node)
                    ? { v: TRI.f, why: `抉择${atom.node}已标为已处理` }
                    : env.choicesFinal
                      ? { v: TRI.f, why: `抉择${atom.node}没有做过` }
                      : { v: TRI.u, why: `抉择${atom.node}还没做` };
            let rec = got.rec,
                hit = atom.what === '选了' ? (atom.value === CUSTOM ? rec.kind === 'custom' : rec.option === atom.value) : rec.tier === atom.value;
            return { v: hit ? TRI.t : TRI.f, why: `抉择${atom.node}：${rec.kind === 'custom' ? '自己的办法' : rec.action}${rec.tier ? `，${rec.tier}` : ''}` };
        }
        case 'node': {
            let done = env.nodeDone(atom.node);
            return done === void 0
                ? { v: TRI.u, why: `节点${atom.node}不存在` }
                : done
                  ? { v: TRI.t, why: `节点${atom.node}已完成` }
                  : { v: TRI.f, why: `节点${atom.node}未完成` };
        }
        case 'cell':
        case 'time': {
            // 结局预览：作者假设这一格满足 / 不满足 / 读不到
            if (env.assumeCell) {
                let a = env.assumeCell(atom.raw);
                return { v: a === 'yes' ? TRI.t : a === 'no' ? TRI.f : TRI.u, why: `（假设）${atom.raw}` };
            }
            let paths = atom.kind === 'time' ? withStarRows([].concat(env.timePath || []).filter(Boolean)) : [atom.path];
            if (!paths.length) return { v: TRI.u, why: '未绑定故事时间' };
            let cell = null,
                misses = [];
            for (let path of paths) {
                let got = readCell(env.tables, path);
                if (got.state === 'ok') {
                    cell = got;
                    break;
                }
                misses.push(got.reason);
            }
            if (!cell) return { v: TRI.u, why: misses.join('；') };
            let label = atom.kind === 'time' ? '时间' : atom.path,
                value = cell.value;
            // 剧情推进判断用户这一轮跳到的时间：比表格里记的晚才用，只用于这一轮（不写表，填表后表格会追上）
            atom.kind === 'time' && env.roundTime && compareTime(env.roundTime, value) > 0 && ((value = env.roundTime), (label = '时间（本轮跳到）'));
            if (atom.sample && !sampleAgrees(atom))
                return { v: TRI.u, why: `${label}：这种写法插件暂时读不出来（样例核对没通过），可以改成手动开始` };
            if (atom.pick) {
                let got = pickEntry(value, atom.pick);
                if (got.state !== 'ok') return { v: TRI.u, why: `${label}：${got.reason}` };
                ((value = got.value), (label = `${label}里「${atom.pick}」那一项`));
            }
            if (atom.tiers && !['==', '!='].includes(atom.op) && !tierOrderKnown(atom, env.tables))
                return { v: TRI.u, why: `${label}：档位顺序「${atom.tiers.join(' < ')}」还没确认，确认前不比大小` };
            // 「时间 >= 19:30」只比钟点：表格时间常带年月日（2026年10月31日 17:30），整串逐个数字比会把 2026 当成小时（跑团 v0.3.17 同样的修法）
            if (atom.kind === 'time' && /^\d{1,2}[:：]\d{2}$/.test(String(atom.value).trim()) && !['包含', '不包含'].includes(atom.op)) {
                let now = clockOf(value),
                    want = clockOf(atom.value);
                if (now == null) return { v: TRI.u, why: `时间「${cellText(value)}」里读不出钟点` };
                let d = now - want,
                    hit = { '>=': d >= 0, '>': d > 0, '<=': d <= 0, '<': d < 0, '==': d === 0, '!=': d !== 0 }[atom.op];
                return { v: hit ? TRI.t : TRI.f, why: `时间 ${clockText(now)}${hit ? '已到' : '未到'} ${clockText(want)}` };
            }
            // 带日期的时间比先后：按条件写到的精度比（只写日期就按天），钟点认上午下午，星期不当数字
            if (atom.kind === 'time' && ['>=', '>', '<=', '<'].includes(atom.op)) {
                let d = compareTime(value, atom.value);
                if (d === null) return { v: TRI.u, why: `时间「${cellText(value)}」无法与「${atom.value}」比较` };
                let hit = { '>=': d >= 0, '>': d > 0, '<=': d <= 0, '<': d < 0 }[atom.op];
                return { v: hit ? TRI.t : TRI.f, why: `时间 = ${cellText(value)}` };
            }
            let ok =
                atom.op === '包含' || atom.op === '不包含'
                    ? cellText(value).includes(atom.value) === (atom.op === '包含')
                    : atom.tiers
                      ? tierCompare(atom.op, value, atom.value, atom.tiers)
                      : applyOp(atom.op, value, atom.value);
            return ok === null
                ? {
                      v: TRI.u,
                      why: atom.tiers
                          ? `${label}「${cellText(value)}」不是档位 ${atom.tiers.join('/')} 里的任何一档`
                          : `${label}「${cellText(value)}」无法与「${atom.value}」比较`,
                  }
                : { v: ok ? TRI.t : TRI.f, why: `${label} = ${cellText(value)}` };
        }
        default:
            return { v: TRI.u, why: atom.error || '条件错误' };
    }
}

export function evalCondition(cond, env) {
    if (!cond) return { v: TRI.t, reasons: [] };
    if (cond.kind !== 'group') {
        let r = evalAtom(cond, env);
        return { v: r.v, reasons: [r.why] };
    }
    let results = cond.items.map((item) => evalCondition(item, env));
    if (cond.mode === 'atleast') {
        let yes = results.filter((r) => r.v === TRI.t).length,
            maybe = results.filter((r) => r.v === TRI.u).length,
            head = `${cond.items.length}条里满足${yes}条（要至少${cond.n}条）`;
        return yes >= cond.n
            ? { v: TRI.t, reasons: [head] }
            : { v: yes + maybe < cond.n ? TRI.f : TRI.u, reasons: [head, ...results.filter((r) => r.v !== TRI.t).flatMap((r) => r.reasons)] };
    }
    if (cond.mode === 'all') {
        let bad = results.filter((r) => r.v !== TRI.t);
        return bad.length
            ? { v: bad.some((r) => r.v === TRI.f) ? TRI.f : TRI.u, reasons: bad.flatMap((r) => r.reasons) }
            : { v: TRI.t, reasons: results.flatMap((r) => r.reasons) };
    }
    let hit = results.find((r) => r.v === TRI.t);
    return hit
        ? { v: TRI.t, reasons: hit.reasons }
        : {
              v: results.some((r) => r.v === TRI.u) ? TRI.u : TRI.f,
              reasons: [`以下任一满足即可：${results.flatMap((r) => r.reasons).join('；')}`],
          };
}

export function conditionRefs(
    cond,
    out = {
        facts: /* @__PURE__ */ new Set(),
        nodes: /* @__PURE__ */ new Set(),
        knows: /* @__PURE__ */ new Set(),
        lines: /* @__PURE__ */ new Set(),
    },
) {
    return (
        out.knows || (out.knows = /* @__PURE__ */ new Set()),
        out.lines || (out.lines = /* @__PURE__ */ new Set()),
        out.choices || (out.choices = []),
        cond
            ? cond.kind === 'group'
                ? (cond.items.forEach((item) => conditionRefs(item, out)), out)
                : ((cond.kind === 'fact' || cond.kind === 'know') && out.facts.add(cond.fact),
                  cond.kind === 'know' && out.knows.add(`${cond.fact}@${cond.actor}`),
                  cond.kind === 'node' && out.nodes.add(cond.node),
                  cond.kind === 'line' && out.lines.add(cond.line),
                  cond.kind === 'choice' && (out.choices.push({ node: cond.node, what: cond.what, value: cond.value }), out.nodes.add(cond.node)),
                  out)
            : out
    );
}

// 大纲里有没有时间条件（阶段进入 / 结束、节点各条件、线的开启条件）：有才在推进里加时间判断
export function usesTimeCond(compiled) {
    let has = (c) => !!c && (c.kind === 'time' || (c.kind === 'group' && c.items.some(has)));
    return (
        compiled.units.some((u) => u.clue && (has(u.clue.enter) || has(u.clue.end))) ||
        compiled.nodes.some((n) => nodeConds(n).some(has)) ||
        (compiled.lines || []).some((l) => has(l.open))
    );
}

// 一个节点的全部条件（开放、提前、完成，以及抉择的有利 / 不利、收尾的结局 / 尾声条件）。
// 收集引用（建行、缺行、跨线）都用它；求值仍按各自的用途分开。
export function nodeConds(node) {
    let out = [node.open, node.early, node.done];
    node.choice && node.choice.options.forEach((o) => out.push(...(o.proCond || []), ...(o.conCond || []), o.whenCond));
    node.ending && [...node.ending.endings, ...node.ending.segments.flatMap((s) => s.versions)].forEach((x) => out.push(x.cond));
    return out.filter(Boolean);
}

// skip：还没开始的线的事实（大型项目第 2 批），暂不建行，不算缺。checkFacts / checkKnowledge：false 时不报这种表的缺行。
// 知情按 knowKeyOf 比（主角的几种写法算一个人，D47）。
export function prebuiltGaps(compiled, snapshot, { checkFacts = !0, checkKnowledge = !0, skip = null } = {}) {
    let refs = { facts: /* @__PURE__ */ new Set(), nodes: /* @__PURE__ */ new Set(), knows: /* @__PURE__ */ new Set() };
    for (let unit of compiled.units) unit.clue && (conditionRefs(unit.clue.enter, refs), conditionRefs(unit.clue.end, refs));
    for (let node of compiled.nodes) for (let cond of nodeConds(node)) conditionRefs(cond, refs);
    for (let l of compiled.lines || []) (conditionRefs(l.open, refs), l.legacyFact && refs.facts.add(l.legacyFact));
    if (skip && skip.size) {
        for (let id of skip) refs.facts.delete(id);
        for (let k of [...refs.knows]) skip.has(k.slice(0, k.lastIndexOf('@'))) && refs.knows.delete(k);
    }
    let out = [],
        missingFacts = checkFacts ? [...refs.facts].filter((id) => !(snapshot.facts && snapshot.facts.has(id))) : [],
        present = snapshot.knowPresent;
    if (
        (missingFacts.length && out.push(`事实表里没有这些编号的行：${missingFacts.join('、')}（条件会一直是「未知」）`),
        checkKnowledge && present)
    ) {
        let missingKnows = [...refs.knows].filter((k) => !present.has(knowKeyOf(k)));
        missingKnows.length && out.push(`知情表里还没有这些「事实@角色」的行：${missingKnows.join('、')}`);
    }
    return out;
}

// overrides：玩家手动补记、确认、保留过的线索（kept / confirmed / claimed）不报「知情表里没人知道」，那是插件自己只写了事实表
export function tableConsistencyHints(snapshot, overrides = null) {
    let hints = [],
        holders = /* @__PURE__ */ new Map();
    for (let row of snapshot.knowledge || []) holders.set(row.fact, [...(holders.get(row.fact) || []), row.actor]);
    for (let [id, fact] of snapshot.facts || []) {
        let who = holders.get(id) || [],
            over = overrides && overrides[id];
        (fact.status === 'confirmed' || fact.claimed) &&
            !who.length &&
            !(over && ['kept', 'confirmed', 'claimed'].includes(over.status)) &&
            snapshot.knowPresent &&
            [...snapshot.knowPresent].some((k) => k.startsWith(`${id}@`)) &&
            hints.push(
                `${id}在关键事实表里记为「${fact.raw || '已确认'}」，但知情表里没有任何角色知道它；如果正文里有角色亲见或听到，检查知情表是否漏填`,
            );
        fact.status === 'unconfirmed' &&
            !fact.claimed &&
            who.length &&
            hints.push(`知情表记录了${who.join('、')}知道${id}，但关键事实表仍是「${fact.raw}」；检查关键事实表是否漏填`);
    }
    return hints;
}

export const AWAY_PREFIX = '@away:';

export const NODE_STATUS_LABELS = { locked: '未开放', available: '可进行', active: '进行中', done: '已完成' };

export function emptyClueProgress() {
    return { focus: '', overrides: {}, factOverrides: {}, log: [] };
}

export function isRequired(node) {
    let flag = isPlainObject(node.item) ? node.item.必需 : void 0;
    return flag === void 0 || flag === null || flag === '' ? node.kind === 'main' : flag === !0 || flag === '是' || flag === 'true';
}

export function compileClue(volumes) {
    let errors = [],
        units = flattenUnits(volumes),
        nodes = [],
        ids = /* @__PURE__ */ new Set();
    for (let unit of units) {
        let data = isPlainObject(unit.stage.data) ? unit.stage.data : {},
            where = stageLabel(unit.stage.key),
            errs = [],
            enter = parseCondition(data.进入条件, errs),
            end = parseCondition(data.结束条件, errs);
        (errs.forEach((e) => errors.push(`${where}：${e}`)),
            (unit.clue = { enter, end, hasEnter: data.进入条件 != null && data.进入条件 !== '' }));
        for (let node of stageNodes(data)) {
            let item = isPlainObject(node.item) ? node.item : {},
                uid = nodeUid(item),
                nerrs = [],
                c = {
                    ...node,
                    uid,
                    unit,
                    required: isRequired(node),
                    open: parseCondition(item.开放条件, nerrs),
                    early: parseCondition(item.提前条件, nerrs),
                    done: parseCondition(item.完成条件, nerrs),
                    choice: readChoice(item.抉择, nerrs),
                    ending: readEnding(item.收尾, nerrs),
                };
            // 有利 / 不利、结局条件也走同一套条件解析，写法错误在这里报
            c.choice &&
                c.choice.options.forEach((o) => {
                    o.proCond = o.pro.map((x) => parseCondition(x, nerrs));
                    o.whenCond = o.when == null ? null : parseCondition(o.when, nerrs);
                    o.conCond = o.con.map((x) => parseCondition(x, nerrs));
                });
            c.ending &&
                [...c.ending.endings, ...c.ending.segments.flatMap((s) => s.versions)].forEach((x) => (x.cond = x.when == null ? null : parseCondition(x.when, nerrs)));
            (nerrs.forEach((e) => errors.push(`${where}·${node.name}：${e}`)),
                uid
                    ? ids.has(uid)
                        ? errors.push(`节点ID「${uid}」重复`)
                        : ids.add(uid)
                    : node.kind === 'main' && errors.push(`${where}·${node.name}：缺少稳定ID`),
                nodes.push(c));
        }
    }
    for (let node of nodes)
        for (let ref of conditionRefs(node.open).nodes)
            ids.has(ref) || errors.push(`${stageLabel(node.unit.stage.key)}·${node.name}：引用了不存在的节点「${ref}」`);
    for (let node of nodes)
        for (let cond of [node.early, node.done])
            for (let ref of conditionRefs(cond).nodes)
                ids.has(ref) || errors.push(`${stageLabel(node.unit.stage.key)}·${node.name}：引用了不存在的节点「${ref}」`);
    for (let node of nodes)
        node.uid &&
            conditionRefs(node.done).nodes.has(node.uid) &&
            errors.push(
                `${stageLabel(node.unit.stage.key)}·${node.name}：完成条件引用了节点自己（${node.uid}），永远不会完成；应写成它自己产出的事实`,
            );
    for (let unit of units)
        for (let [label, cond] of [
            ['进入条件', unit.clue.enter],
            ['结束条件', unit.clue.end],
        ])
            for (let ref of conditionRefs(cond).nodes)
                ids.has(ref) || errors.push(`${stageLabel(unit.stage.key)}·${label}：引用了不存在的节点「${ref}」`);
    let lines = compileLines(units, errors),
        lineIds = new Set(lines.map((l) => l.id)),
        refCheck = (cond, where) => {
            for (let ref of conditionRefs(cond).lines) lineIds.has(ref) || errors.push(`${where}：引用了不存在的线「${ref}」`);
        };
    for (let l of lines) refCheck(l.open, `线 ${l.id} 的开启条件`);
    for (let node of nodes)
        [node.open, node.early, node.done].forEach((c) => refCheck(c, `${stageLabel(node.unit.stage.key)}·${node.name}`));
    for (let unit of units) [unit.clue.enter, unit.clue.end].forEach((c) => refCheck(c, stageLabel(unit.stage.key)));
    // 抉择条件：引用的节点要有「抉择」，选项要存在
    let byUid = new Map(nodes.filter((n) => n.uid).map((n) => [n.uid, n])),
        choiceCheck = (cond, where) => {
            for (let ref of conditionRefs(cond).choices) {
                let n = byUid.get(ref.node);
                !n || !n.choice
                    ? errors.push(`${where}：引用的「${ref.node}」不是带抉择的节点`)
                    : ref.what === '选了' && ref.value !== CUSTOM && !n.choice.options.some((o) => o.id === ref.value) && errors.push(`${where}：抉择「${ref.node}」没有选项「${ref.value}」`);
            }
        };
    for (let l of lines) choiceCheck(l.open, `线 ${l.id} 的开启条件`);
    for (let node of nodes) {
        let where = `${stageLabel(node.unit.stage.key)}·${node.name}`;
        [node.open, node.early, node.done].forEach((c) => choiceCheck(c, where));
        node.ending && [...node.ending.endings, ...node.ending.segments.flatMap((s) => s.versions)].forEach((x) => choiceCheck(x.cond, `${where}·收尾`));
        node.choice && node.done && errors.push(`${where}：带抉择的节点由抉择完成，「完成条件」不会被使用`);
    }
    for (let unit of units) [unit.clue.enter, unit.clue.end].forEach((c) => choiceCheck(c, stageLabel(unit.stage.key)));
    // 失败会不会卡住主线：必需节点的开放条件、阶段的进入 / 结束条件，只能靠某个抉择的某一档才成立
    let warnings = [],
        // 能证明「只有某个抉择的某几档才成立」时返回 { node, values }；证明不了就返回 null（不下确定结论）
        mustTier = (cond) => {
        if (!cond) return null;
        if (cond.kind === 'choice') return cond.what === '结果' ? { node: cond.node, values: new Set([cond.value]) } : null;
        if (cond.kind !== 'group') return null;
        if (cond.mode === 'all') return cond.items.map(mustTier).find(Boolean) || null;
        let hits = cond.items.map(mustTier),
            merge = (xs) => {
                if (!xs.length || xs.some((x) => !x) || new Set(xs.map((x) => x.node)).size !== 1) return null;
                let values = new Set(xs.flatMap((x) => [...x.values]));
                return values.size >= TIERS.length ? null : { node: xs[0].node, values };
            };
        // 任一：每一项都只靠同一个抉择的某几档，合起来又没覆盖全部三档
        if (cond.mode === 'any') return merge(hits);
        // 其中至少 N 条：不靠档位的条目凑不够 N 条时，必须有档位条目成立
        let free = hits.filter((x) => !x).length;
        return free >= cond.n ? null : merge(hits.filter(Boolean));
    };
    for (let node of nodes) {
        let hit = node.required && mustTier(node.open);
        hit && warnings.push(`${stageLabel(node.unit.stage.key)}·${node.name}是必需节点，只在抉择「${hit.node}」${[...hit.values].join(' / ')}时开放；其他结果会卡住这一阶段，可以改成非必需或补一条别的路`);
    }
    for (let unit of units)
        for (let [label, cond] of [['进入条件', unit.clue.enter], ['结束条件', unit.clue.end]]) {
            let hit = mustTier(cond);
            hit && warnings.push(`${stageLabel(unit.stage.key)}的${label}只在抉择「${hit.node}」${[...hit.values].join(' / ')}时成立；其他结果会卡住，可以补一条别的路`);
        }
    return { units, nodes, errors, warnings, lines };
}

// opts.endedOpen：判断新登记合不合法时用（线索建行与登记方案 二.3）——正常结束的线，节点照常按条件判断开放。
export function computeClueState(compiled, snapshot, clueProg, config = DEFAULT_CLUE, opts = {}) {
    let { units, nodes } = compiled,
        lines = compiled.lines || [],
        byUid = new Map(nodes.filter((n) => n.uid).map((n) => [n.uid, n])),
        overrides = clueProg.overrides || {},
        doneMemo = /* @__PURE__ */ new Map(),
        visiting = /* @__PURE__ */ new Set(),
        cycles = [],
        lineMemo = /* @__PURE__ */ new Map(),
        lineVisiting = /* @__PURE__ */ new Set(),
        byLine = new Map(lines.map((l) => [l.id, l])),
        env = {
            facts: snapshot.facts || /* @__PURE__ */ new Map(),
            knowledge: snapshot.knowledge || [],
            tables: snapshot.tables || {},
            timePath: config.bindings && config.bindings.time && config.bindings.time.路径,
            roundTime: snapshot.roundTime || '',
            factOverrides: clueProg.factOverrides || {},
            nodeDone: (uid) => {
                let node = byUid.get(uid);
                return node ? nodeDone(node).v === TRI.t : void 0;
            },
            // 条件求值用的线状态：开启条件未知（含循环）时返回 null，不当作确定的「未触发」。
            lineState: (id) => {
                let l = byLine.get(id);
                if (!l) return;
                let s = lineStateOf(l);
                return s && !s.pending ? s.state : null;
            },
            lineStarted: (id) => {
                let l = byLine.get(id);
                return !!l && lineEvidence(l);
            },
            choices: snapshot.choices || null,
            nodeForced: (uid) => (overrides[uid] || {}).done === 'force',
        };
    // 已关闭：开放条件不成立，而且它读的抉择都已经做过了（再也不会成立）。只用于显示
    function choiceClosed(cond) {
        if (!choiceOn || !cond) return '';
        let refs = conditionRefs(cond).choices;
        if (!refs.length) return '';
        let made = refs.map((r) => ({ r, got: snapshot.choices.stateOf(r.node), forced: (overrides[r.node] || {}).done === 'force' }));
        if (!made.every((x) => x.got || x.forced)) return '';
        // 只读抉择的条件才算「已关闭」；混着事实、表格的，以后还可能成立
        let only = (c) => !c || (c.kind === 'group' ? c.items.every(only) : c.kind === 'choice');
        if (!only(cond)) return '';
        let x = made[0];
        return x.forced ? `抉择「${x.r.node}」已标为已处理` : `抉择「${x.r.node}」选了「${x.got.rec.kind === 'custom' ? '自己的办法' : x.got.rec.action}」${x.got.rec.tier ? `，${x.got.rec.tier}` : ''}`;
    }
    // 抉择功能开启时，带抉择的节点由抉择完成：有记录且已有回复；或者人工标记完成（「标为已处理」）
    let choiceOn = !!(snapshot.choices && snapshot.choices.enabled);
    function nodeDone(node) {
        if (node.uid && doneMemo.has(node.uid)) return doneMemo.get(node.uid);
        let over = (node.uid && overrides[node.uid]) || {},
            picked = choiceOn && node.choice ? snapshot.choices.stateOf(node.uid) : null,
            result;
        return (
            over.done === 'force'
                ? (result = { v: TRI.t, reasons: ['人工标记完成'], manual: !0 })
                : over.done === 'undo'
                  ? (result = { v: TRI.f, reasons: ['人工撤销完成'], manual: !0 })
                  : choiceOn && snapshot.choices.assumeAll && (node.choice || node.ending)
                    ? (result = { v: TRI.t, reasons: ['（推演）抉择或收尾会由玩家完成'] })
                  : choiceOn && node.choice
                    ? (result = picked && picked.shown ? { v: TRI.t, reasons: ['抉择已做'] } : { v: TRI.f, reasons: [picked ? '抉择结果还在演出' : '抉择待决定'] })
                    : choiceOn && node.ending && snapshot.choices.ending && snapshot.choices.ending.rec.node === node.uid && snapshot.choices.ending.shown
                      ? (result = { v: TRI.t, reasons: ['已收尾'] })
                      : node.done
                    ? node.uid && visiting.has(node.uid)
                        ? (cycles.push(node.uid), (result = { v: TRI.u, reasons: [`节点${node.uid}条件循环引用`] }))
                        : (node.uid && visiting.add(node.uid),
                          (result = evalCondition(node.done, env)),
                          node.uid && visiting.delete(node.uid))
                    : (result = { v: TRI.f, reasons: ['没有完成条件，需人工标记'] }),
            node.uid && doneMemo.set(node.uid, result),
            result
        );
    }
    let stageStates = /* @__PURE__ */ new Map();
    function stageChain(list, firstEntered) {
        let prevDone = !0;
        for (let [k, unit] of list.entries()) {
            let own = nodes.filter((n) => n.unit === unit),
                required = own.filter((n) => n.required),
                gate = k === 0 && firstEntered ? firstEntered() : null,
                entered =
                    gate && gate.v !== TRI.t
                        ? gate
                        : unit.clue.hasEnter
                          ? evalCondition(unit.clue.enter, env)
                          : prevDone
                            ? { v: TRI.t, reasons: [k === 0 && gate ? gate.reasons[0] : '上一阶段已结束'] }
                            : { v: TRI.f, reasons: ['上一阶段尚未结束'] },
                requiredLeft = required.filter((n) => !(overrides[n.uid] || {}).skip && nodeDone(n).v !== TRI.t),
                end = evalCondition(unit.clue.end, env),
                done = entered.v === TRI.t && !requiredLeft.length && end.v === TRI.t;
            (gate && gate.v !== TRI.t && (entered = gate),
                stageStates.set(unit.id, { unit, entered, end, requiredLeft, done: entered.v === TRI.t && done }),
                (prevDone = entered.v === TRI.t && done));
        }
    }
    function legacySeen(l) {
        return !!l.legacyFact && evalAtom({ kind: 'fact', fact: l.legacyFact }, env).v === TRI.t;
    }
    function lineEvidence(l) {
        return !!((clueProg.lines || {})[l.id] || {}).started || legacySeen(l);
    }
    function windowOf(l) {
        let w = l.window;
        if (!w) return { v: TRI.t, reasons: [] };
        if (w.bad) return { v: TRI.u, reasons: [`开启时段写得不对：${w.bad}`] };
        let main = byLine.get(w.main),
            ms = main ? lineStateOf(main) : null;
        if (!ms) return { v: TRI.u, reasons: [`主线${w.main}的状态还算不出来`] };
        if (ms.state === '完成' || ms.state === '放弃')
            return { v: TRI.f, missed: !0, reasons: [`开启时段已过（${w.main} ${ms.state === '完成' ? '已经完成' : '已经放弃'}）`] };
        if (!ms.started) return { v: TRI.f, reasons: [`要等主线${w.main}开始`] };
        let from = w.from ? stageStates.get(w.from) : null,
            to = w.to ? stageStates.get(w.to) : null;
        return from && from.entered.v !== TRI.t
            ? { v: from.entered.v === TRI.u ? TRI.u : TRI.f, reasons: [`要等${w.main}进入「${w.fromLabel}」`] }
            : to && to.done
              ? { v: TRI.f, missed: !0, reasons: [`开启时段已过（${w.main}的「${w.toLabel}」已经结束）`] }
              : { v: TRI.t, reasons: [`在${w.main}的开启时段内`] };
    }
    function mainBusy(l) {
        let at = lines.indexOf(l);
        for (let [k, o] of lines.entries()) {
            if (o === l || o.kind !== 'main' || (o.mode !== 'auto' && !lineEvidence(o)) || (!lineEvidence(o) && k > at)) continue;
            let s = lineStateOf(o);
            if (!s) return `主线${o.id}的状态还算不出来`;
            // 自动开始：暂停的主线也占位（暂停M1不会自动开M2）。
            // 手动进入看 mainSlotTaken，暂停的不占位；要先玩别的主线需手动进入。
            if (s.state === '进行中' || s.state === '暂停')
                return `主线${o.id} ${s.state === '暂停' ? '暂停中（想先玩这条，点「进入」）' : '还在进行'}`;
        }
        return '';
    }
    // 接上一条：大纲里排在它前面的那条主线（按卷的先后）结束了没有。第一条主线没有前序，视为满足。
    function prevMainDone(l) {
        if (!l.after) return { v: TRI.t, reasons: [] };
        let mains = lines.filter((x) => x.kind === 'main'),
            prev = mains[mains.indexOf(l) - 1];
        if (!prev) return { v: TRI.t, reasons: [] };
        let s = lineStateOf(prev);
        if (!s) return { v: TRI.u, reasons: [`主线${prev.id}的状态还算不出来`] };
        return s.state === '完成' || s.state === '放弃' ? { v: TRI.t, reasons: [] } : { v: TRI.f, reasons: [`排在主线${prev.id}后面，要等它结束`] };
    }
    function lineStateOf(l) {
        if (lineMemo.has(l.id)) return lineMemo.get(l.id);
        if (lineVisiting.has(l.id)) return (cycles.push(`线 ${l.id}`), null);
        lineVisiting.add(l.id);
        let man = (clueProg.lines || {})[l.id] || {},
            legacy = !man.started && legacySeen(l),
            evidence = !!man.started || legacy,
            settled = man.state && (evidence || man.state !== 'pause'),
            cond = settled ? { v: TRI.t, reasons: [] } : evalCondition(l.open, env),
            win = settled || evidence ? { v: TRI.t, reasons: [] } : windowOf(l),
            eligible = cond.v === TRI.t && win.v === TRI.t,
            started = evidence,
            why = man.started ? man.how || '已开始' : legacy ? `开场事实${l.legacyFact}已出现` : '',
            waitMain = '';
        let after = !evidence && !man.state && l.kind === 'main' ? prevMainDone(l) : { v: TRI.t, reasons: [] };
        !evidence &&
            !man.state &&
            eligible &&
            l.kind === 'main' &&
            l.mode === 'auto' &&
            ((waitMain = after.v !== TRI.t ? after.reasons.join('；') || '要等前一条主线结束' : clueProg.mainPaused ? '主线已全部暂停' : mainBusy(l)) ||
                ((started = !0), (why = '开启条件已满足')));
        let state =
                man.state === 'abandon'
                    ? '放弃'
                    : man.state === 'done'
                      ? '完成'
                      : man.state === 'pause'
                        ? '暂停'
                        : started
                          ? '进行中'
                          : eligible
                            ? '可开启'
                            : '未触发',
            result = {
                line: l,
                state,
                started,
                eligible,
                cond,
                window: win,
                missed: !started && !man.state && !!win.missed,
                why,
                waitMain,
                manual: man,
                entries: [],
                pending: !man.state && !started && (cond.v === TRI.u || win.v === TRI.u),
            };
        if (state === '进行中') {
            stageChain(l.units, () => ({ v: TRI.t, reasons: [`线${l.id}进行中（${why}）`] }));
            let last = stageStates.get(l.units[l.units.length - 1].id);
            last && last.done && ((result.state = '完成'), (result.why = '最后一个阶段已结束'));
        }
        return (lineVisiting.delete(l.id), lineMemo.set(l.id, result), result);
    }
    let free = units.filter((u) => !u.line);
    stageChain(free, null);
    let lineStates = lines.map(
        (l) =>
            lineStateOf(l) || {
                line: l,
                state: '未触发',
                started: !1,
                eligible: !1,
                cond: { v: TRI.u, reasons: ['线之间循环引用'] },
                window: { v: TRI.u, reasons: [] },
                missed: !1,
                why: '',
                waitMain: '',
                manual: {},
                entries: [],
                pending: !0,
            },
    );
    for (let s of lineStates) {
        if (s.state === '进行中' || (s.state === '完成' && s.started)) {
            stageStates.has(s.line.units[0].id) || stageChain(s.line.units, () => ({ v: TRI.t, reasons: [`线 ${s.line.id} ${s.state}`] }));
            continue;
        }
        let gate = {
            v: s.state === '可开启' ? TRI.f : s.pending ? TRI.u : TRI.f,
            reasons: [`线 ${s.line.id} ${s.missed ? '已错过' : s.state}${s.state === '可开启' ? '，还没开始' : ''}`],
        };
        for (let unit of s.line.units) {
            let own = nodes.filter((n) => n.unit === unit),
                required = own.filter((n) => n.required);
            stageStates.set(unit.id, {
                unit,
                entered: gate,
                end: evalCondition(unit.clue.end, env),
                requiredLeft: required.filter((n) => !(overrides[n.uid] || {}).skip && nodeDone(n).v !== TRI.t),
                done: !1,
            });
        }
    }
    for (let s of lineStates) {
        if (s.started || s.state !== '可开启') continue;
        let first = s.line.units[0];
        !first ||
            (first.clue.hasEnter && evalCondition(first.clue.enter, env).v !== TRI.t) ||
            (s.entries = nodes
                .filter(
                    (n) =>
                        n.unit === first &&
                        n.uid &&
                        (overrides[n.uid] || {}).open !== 'block' &&
                        nodeDone(n).v !== TRI.t &&
                        (!n.open || evalCondition(n.open, env).v === TRI.t),
                )
                .map((n) => n.uid));
    }
    let lineOf = new Map(lineStates.map((s) => [s.line, s])),
        nodeStates = nodes.map((node) => {
            let over = (node.uid && overrides[node.uid]) || {},
                stage = stageStates.get(node.unit.id),
                done = nodeDone(node),
                open,
                ls = node.unit.line && lineOf.get(node.unit.line);
            if (ls && ls.state !== '进行中' && !(opts.endedOpen && ls.state === '完成' && !ls.manual.state))
                open = { v: TRI.f, reasons: [`所在的线 ${ls.line.id} ${ls.missed ? '已错过' : ls.state}`] };
            else if (ls && ls.line.kind === 'side' && clueProg.sidePaused) open = { v: TRI.f, reasons: ['支线已全部暂停'] };
            else if (ls && ls.line.kind === 'main' && clueProg.mainPaused) open = { v: TRI.f, reasons: ['主线已全部暂停'] };
            else if (over.open === 'force') open = { v: TRI.t, reasons: ['人工开放'], manual: !0 };
            else if (over.open === 'block') open = { v: TRI.f, reasons: ['已手动停用'], manual: !0 };
            else {
                let normal =
                        stage.entered.v !== TRI.t
                            ? { v: stage.entered.v, reasons: [`阶段未进入：${stage.entered.reasons.join('；')}`] }
                            : evalCondition(node.open, env),
                    early = node.early ? evalCondition(node.early, env) : null;
                open =
                    normal.v === TRI.t
                        ? normal
                        : early && early.v === TRI.t
                          ? { v: TRI.t, reasons: ['提前条件满足', ...early.reasons] }
                          : normal;
            }
            let status = done.v === TRI.t ? 'done' : open.v === TRI.t ? 'available' : 'locked',
                closedBy = status === 'locked' && open.v === TRI.f ? choiceClosed(node.open) : '';
            return { node, status, open, done, skipped: !!over.skip, disabled: over.open === 'block', manualOpen: over.open === 'force', ...(closedBy ? { closedBy } : {}) };
        }),
        focus = pickFocus(nodeStates, clueProg, lines.length ? { ...config, autoFocusSingle: !1 } : config, snapshot, stageStates);
    for (let state of nodeStates)
        state.node.uid && state.node.uid === focus.uid && state.status === 'available' && (state.status = 'active');
    let current =
        units.find((unit) => {
            let s = stageStates.get(unit.id);
            return s.entered.v === TRI.t && !s.done;
        }) || null;
    return { nodeStates, stageStates, focus, current, lineStates, cycles: [...new Set(cycles)], problems: snapshot.problems || [], env };
}

export function pickFocus(nodeStates, clueProg, config, snapshot, stageStates) {
    let usable = (uid) => nodeStates.find((s) => s.node.uid === uid && s.status === 'available' && !s.disabled),
        manual = clueProg.focus || '',
        awayFrom = manual.startsWith(AWAY_PREFIX) ? manual.slice(AWAY_PREFIX.length) : '',
        sceneBinding = config.bindings && config.bindings.scene,
        scenePath = sceneBinding && sceneBinding.路径,
        cell = scenePath ? readCell(snapshot.tables || {}, scenePath) : null,
        cellValue = cell && cell.state === 'ok' ? cellText(cell.value) : '',
        tableMovedOn =
            !!manual &&
            clueProg.focusSceneAt !== void 0 &&
            (!!clueProg.focusTaken || (cell && cell.state === 'ok' && cellValue !== clueProg.focusSceneAt));
    if (manual && !awayFrom && !tableMovedOn && usable(manual)) return { uid: manual, source: 'manual' };
    let tableAway = !1;
    if (scenePath) {
        if (cell.state === 'ok' && (cellValue !== awayFrom || tableMovedOn) && usable(cellValue))
            return { uid: cellValue, source: 'table' };
        tableAway = cell.state === 'ok' && sceneIsNone(cell.value, sceneBinding);
    }
    if (config.autoFocusSingle !== !1 && !tableAway) {
        let stageDone = (s) => !!(stageStates && s.node.unit && (stageStates.get(s.node.unit.id) || {}).done),
            mains = nodeStates.filter(
                (s) => s.status === 'available' && s.node.kind === 'main' && s.node.uid && !s.disabled && !stageDone(s),
            );
        if (mains.length === 1 && mains[0].node.uid !== awayFrom) return { uid: mains[0].node.uid, source: 'auto' };
        if (mains.length === 1) return { uid: '', source: 'away' };
    }
    return tableAway || (awayFrom && !tableMovedOn)
        ? { uid: '', source: 'away' }
        : manual && !awayFrom && nodeStates.some((s) => s.node.uid === manual && s.status === 'done')
          ? { uid: '', source: 'manualDone' }
          : { uid: '', source: clueProg.focus ? 'stale' : 'none' };
}

export const LINE_STATES = ['未触发', '可开启', '进行中', '暂停', '完成', '放弃'];

// 结束 = 完成或放弃：前一条被放弃时，「前一条结束后再开」仍可触发；「完成」只表示完成。
export const LINE_STATE_ALIAS = { 开过: ['进行中', '暂停', '完成', '放弃'], 开着: ['进行中', '暂停'], 结束: ['完成', '放弃'] };

export function normalizeOps(text) {
    return String(text || '')
        .replace(/＞＝|≥/g, '>=')
        .replace(/＜＝|≤|≦/g, '<=')
        .replace(/！＝|≠/g, '!=')
        .replace(/＝＝/g, '==')
        .replace(/＞/g, '>')
        .replace(/＜/g, '<')
        .replace(/＝/g, '==')
        .replace(/(^|[^=!<>])=(?!=)/g, '$1==');
}

export function parseCountAtom(value, errors) {
    let raw = JSON.stringify(value);
    if (!isPlainObject(value))
        return (
            errors.push(`计数条件应写成 {表: 表名, 条件: 列 >= 值, 至少: N}：${raw.slice(0, 60)}`),
            { kind: 'bad', raw, error: '计数格式错误' }
        );
    let table = String(value.表 || '').trim(),
        m = splitCompare(normalizeOps(value.条件), /^(.+?)\s*(==|!=|>=|<=|>|<)\s*(.*)$/),
        cmp = ['至少', '至多', '等于'].find((k) => value[k] !== void 0 && value[k] !== ''),
        n = cmp ? Number(value[cmp]) : NaN;
    return !table || !m || !cmp || !Number.isFinite(n)
        ? (errors.push(`计数条件缺少表名、条件（列 运算 值）或数量（至少 / 至多 / 等于）：${raw.slice(0, 60)}`),
          { kind: 'bad', raw, error: '计数格式错误' })
        : {
              kind: 'count',
              table,
              column: m[1].trim(),
              op: m[2],
              value: m[3].trim(),
              cmp,
              n,
              raw: `计数: ${table} 中 ${m[1].trim()} ${m[2]} ${m[3].trim()} 的行数${cmp}${n}`,
          };
}

export const CELL_EXTRA_KEYS = ['表', '取', '档位', '样例', '顺序'];

export function parseCellExtra(value, errors) {
    let atom = parseAtom(`表: ${String(value.表 ?? '').trim()}`),
        raw = JSON.stringify(value).slice(0, 80);
    if (atom.kind !== 'cell') return (errors.push(atom.error), atom);
    if (value.取 !== void 0) {
        let key = String(value.取 ?? '').trim();
        if (!key) return (errors.push(`「取」没写名字：${raw}`), { kind: 'bad', raw, error: '取值格式错误' });
        atom.pick = key;
    }
    if (value.档位 !== void 0) {
        let tiers = Array.isArray(value.档位) ? value.档位.map((t) => String(t ?? '').trim()).filter(Boolean) : [];
        if (tiers.length < 2 || new Set(tiers).size !== tiers.length)
            return (errors.push(`档位要写成至少两项、不重复的列表，从低到高：${raw}`), { kind: 'bad', raw, error: '档位格式错误' });
        if (/包含/.test(atom.op)) return (errors.push(`「包含」不用写档位：${raw}`), { kind: 'bad', raw, error: '档位格式错误' });
        if (!tiers.includes(atom.value))
            return (
                errors.push(`条件里的「${atom.value}」不在档位${tiers.join('/')}里：${raw}`),
                { kind: 'bad', raw, error: '档位格式错误' }
            );
        ((atom.tiers = tiers), (atom.tierOk = String(value.顺序 ?? '').trim() === '已确认'));
    }
    if (value.样例 !== void 0) {
        let s = joinFlowSplit(value.样例, ['原文', '取', '得']);
        if (!isPlainObject(s) || s.原文 == null || s.得 == null)
            return (errors.push(`样例要写成 {原文: …, 取: …, 得: …}：${raw}`), { kind: 'bad', raw, error: '样例格式错误' });
        atom.sample = { text: String(s.原文), key: String(s.取 ?? atom.pick ?? '').trim(), want: String(s.得).trim() };
    }
    return (
        (atom.raw = `${atom.raw}${atom.pick ? `（取「${atom.pick}」）` : ''}${atom.tiers ? `（档位 ${atom.tiers.join('<')}）` : ''}`),
        atom
    );
}

export function joinFlowSplit(obj, keys) {
    if (!isPlainObject(obj)) return obj;
    let out = {},
        cur = '';
    for (let [k, v] of Object.entries(obj))
        if (keys.includes(k)) ((out[k] = v), (cur = k));
        else if (v == null && cur) out[cur] = `${out[cur] ?? ''},${k}`;
        else return obj;
    return out;
}

export function sampleAgrees(atom) {
    if (!atom.sample) return null;
    let s = atom.sample;
    if (!s.key) return cellText(s.text) === s.want;
    let got = pickEntry(s.text, s.key);
    return (
        got.state === 'ok' &&
        (got.value === s.want ||
            got.value
                .split(/[,，、]/)
                .map((x) => x.trim())
                .includes(s.want))
    );
}

export function tierOrderKnown(atom, tables) {
    if (atom.tierOk) return !0;
    let f = findSheet(
        tables || {},
        String(atom.path || '')
            .split('/')[0]
            .trim(),
    );
    return !f.error && tierOrderInNote(f.sheet.note, atom.tiers);
}

export function confirmTierOrder(volumes, tiers) {
    let want = (tiers || []).join(''),
        changed = !1,
        walk = (v) => {
            if (Array.isArray(v)) {
                let out2 = v.map(walk);
                return out2.some((x, i) => x !== v[i]) ? out2 : v;
            }
            if (!isPlainObject(v)) return v;
            let out = null;
            for (let [k, x] of Object.entries(v)) {
                let y = walk(x);
                y !== x && ((out = out || { ...v })[k] = y);
            }
            let cur = out || v;
            return cur.表 !== void 0 &&
                Array.isArray(cur.档位) &&
                cur.档位.map((t) => String(t ?? '').trim()).join('') === want &&
                String(cur.顺序 ?? '').trim() !== '已确认'
                ? ((changed = !0), { ...cur, 顺序: '已确认' })
                : cur;
        },
        next = (volumes || []).map((vol) => {
            let line = walk(vol.line),
                stages = walk(vol.stages);
            return line === vol.line && stages === vol.stages ? vol : { ...vol, ...(vol.line !== void 0 ? { line } : {}), stages };
        });
    return changed ? next : volumes;
}

export const LINE_MODES = { 条件满足即开始: 'auto', 走进去才开始: 'enter', 人工: 'manual', 等开场: 'enter' };

export function withLineIds(volumes) {
    let list = volumes || [];
    if (!list.some((v) => isPlainObject(v.line))) return list;
    let used = new Set(list.map((v) => (isPlainObject(v.line) ? String(v.line.编号 || '').trim() : '')).filter(Boolean)),
        n = 1,
        changed = !1,
        next = list.map((v) => {
            if (isPlainObject(v.line)) return v;
            for (; used.has(`M${n}`);) n++;
            return (used.add(`M${n}`), (changed = !0), { ...v, line: { 编号: `M${n}`, 类型: '主线' } });
        });
    return changed ? next : list;
}

export function resolveLineWindow(raw, lines, errs) {
    if (raw == null || raw === '') return null;
    if (!isPlainObject(raw)) return (errs.push('开启时段应写成 {主线: M1, 从: 阶段2, 到: 阶段3}'), { bad: '开启时段写法不对' });
    let mainId = String(raw.主线 || '').trim(),
        main = lines.find((l) => l.id === mainId);
    if (!main) return (errs.push(`开启时段引用了不存在的主线「${mainId}」`), { bad: `找不到主线${mainId}` });
    if (main.kind !== 'main') return (errs.push(`开启时段里的「${mainId}」不是主线`), { bad: `${mainId}不是主线` });
    let find = (ref) => {
            let r = String(ref ?? '').trim();
            if (!r) return { unit: null };
            let hits = main.units.filter((u) => {
                let { short, title: title2 } = splitStageKey(u.stage.key);
                return [u.stage.key, short, title2, stageLabel(u.stage.key)].map((x) => String(x || '').trim()).includes(r);
            });
            return hits.length === 1
                ? { unit: hits[0] }
                : {
                      error: hits.length
                          ? `开启时段里的「${r}」在${mainId}里有好几个同名阶段`
                          : `开启时段里的阶段「${r}」在${mainId}里找不到`,
                  };
        },
        from = find(raw.从),
        to = find(raw.到),
        bad = from.error || to.error;
    return bad
        ? (errs.push(bad), { bad })
        : {
              main: mainId,
              from: from.unit ? from.unit.id : '',
              to: to.unit ? to.unit.id : '',
              fromLabel: from.unit ? stageLabel(from.unit.stage.key) : '',
              toLabel: to.unit ? stageLabel(to.unit.stage.key) : '',
          };
}

export function compileLines(units, errors) {
    let vols = [...new Set(units.map((u) => u.volume))];
    if (!vols.some((v) => isPlainObject(v.line))) return [];
    let named = withLineIds(vols),
        lines = [],
        seen = /* @__PURE__ */ new Set(),
        pend = [];
    for (let [k, volume] of vols.entries()) {
        let own = units.filter((u) => u.volume === volume),
            raw = named[k].line,
            where = `卷「${volumeLabel(volume.key)}」的线`,
            id = String(raw.编号 || '').trim(),
            errs = [];
        if (!id) {
            errors.push(`${where}：缺少编号`);
            continue;
        }
        if (seen.has(id)) {
            errors.push(`${where}：编号「${id}」和别的线重复`);
            continue;
        }
        seen.add(id);
        let kind = String(raw.类型 || '').trim() === '主线' ? 'main' : 'side',
            open = parseCondition(raw.开启条件, errs),
            legacyFact = String(raw.开场事实 || '').trim(),
            modeText = String(raw.开启方式 || '').trim();
        modeText && !LINE_MODES[modeText] && errs.push(`开启方式「${modeText}」不认识，可以写：条件满足即开始、走进去才开始、人工`);
        let mode = LINE_MODES[modeText] === 'manual' ? 'manual' : kind === 'main' ? 'auto' : 'enter',
            line = {
                id,
                kind,
                name: volumeLabel(volume.key),
                brief: clueText(raw.简介),
                entryHint: clueText(raw.入口提示),
                open,
                legacyFact,
                mode,
                volume,
                units: own,
                synthetic: !isPlainObject(volume.line),
                window: null,
                origCond: clueText(raw.原开启条件),
                // 接上一条：排在前一条主线之后，其「结束」（完成或放弃）后自动开始。
                // 只管自动开始；手动进入可以跳过它，剧情条件照样要满足。
                after: kind === 'main' && (raw.接上一条 === !0 || raw.接上一条 === 'true' || raw.接上一条 === '是'),
            };
        (lines.push(line), pend.push([line, raw.开启时段, errs, where]));
    }
    for (let [l, w, errs, where] of pend)
        ((l.window = resolveLineWindow(w, lines, errs)), errs.forEach((e) => errors.push(`${where}：${e}`)));
    for (let l of lines) for (let u of l.units) u.line = l;
    return lines;
}

export function lineToManual(volumes, id) {
    let at = (volumes || []).findIndex((v) => isPlainObject(v.line) && String(v.line.编号 || '').trim() === id);
    if (at < 0) return volumes;
    let line = { ...volumes[at].line },
        cond = line.开启条件,
        text = cond == null || cond === '' ? '' : typeof cond == 'string' ? cond : JSON.stringify(cond).replace(/"/g, '');
    if (LINE_MODES[String(line.开启方式 || '').trim()] === 'manual' && !text) return volumes;
    (delete line.开启条件, (line.开启方式 = '人工'), text && (line.原开启条件 = line.原开启条件 ? `${line.原开启条件}；${text}` : text));
    let next = volumes.slice();
    return ((next[at] = { ...volumes[at], line }), next);
}

export function lineTriggerFacts(compiled) {
    let produced = /* @__PURE__ */ new Set(),
        out = /* @__PURE__ */ new Map();
    for (let n of compiled.nodes || []) for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) d.fact && produced.add(d.fact);
    for (let l of compiled.lines || [])
        for (let f of [...conditionRefs(l.open).facts, ...(l.legacyFact ? [l.legacyFact] : [])])
            produced.has(f) || out.set(f, [...(out.get(f) || []), l.id]);
    return out;
}

export function sceneIsNone(value, binding) {
    let v = cellText(value);
    return !!v && (v === '无' || v === '离场' || (!!binding && binding.离场值 != null && v === cellText(binding.离场值)));
}
