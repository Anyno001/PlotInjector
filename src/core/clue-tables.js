import { isPlainObject } from './outline.js';
export function cloneTables(raw) {
    if (!raw || typeof raw != 'object') return {};
    try {
        return JSON.parse(JSON.stringify(raw));
    } catch {
        return {};
    }
}

export function sheetList(tables) {
    return Object.entries(tables || {})
        .filter(([key, sheet]) => key.startsWith('sheet_') && sheet && Array.isArray(sheet.content))
        .map(([key, sheet]) => ({
            key,
            name: String(sheet.name || key),
            content: sheet.content,
            seedRows: sheet.seedRows,
            note: String((sheet.sourceData && sheet.sourceData.note) || ''),
            freq: sheet.updateConfig ? sheet.updateConfig.updateFrequency : void 0,
        }));
}

export function findSheet(tables, name) {
    let hits = sheetList(tables).filter((sheet) => sheet.name === name || sheet.key === name);
    return hits.length === 1
        ? { sheet: hits[0] }
        : hits.length
          ? { error: `表「${name}」重名 ${hits.length} 张` }
          : { error: `缺少表「${name}」` };
}

export function sheetRows(sheet) {
    let head = Array.isArray(sheet.content[0]) ? sheet.content[0] : [],
        own = sheet.content.slice(1).filter(Array.isArray),
        seeds = Array.isArray(sheet.seedRows) ? sheet.seedRows.filter(Array.isArray) : [],
        rows = own.length ? own : seeds;
    return {
        head,
        col: (name) => head.findIndex((cell, index) => index > 0 && String(cell ?? '').trim() === name),
        rows,
    };
}

export function cellText(value) {
    return value == null ? '' : String(value).trim();
}

export function valueSet(value) {
    return new Set((Array.isArray(value) ? value : value == null ? [] : [value]).map(cellText).filter(Boolean));
}

export function sameValue(cell, wanted) {
    let a = cellText(cell),
        b = cellText(wanted);
    if (a === b) return !0;
    let na = Number(a),
        nb = Number(b);
    return a !== '' && b !== '' && Number.isFinite(na) && Number.isFinite(nb) && na === nb;
}

export function readCell(tables, path) {
    let parts = String(path || '')
        .split('/')
        .map((part) => part.trim());
    if (parts.length !== 3 || parts.some((part) => !part)) return { state: 'unknown', reason: `路径「${path}」应为 表/行标识/列` };
    let [table, rowKey, column] = parts,
        found = findSheet(tables, table);
    if (found.error) return { state: 'unknown', reason: found.error };
    let { col, rows } = sheetRows(found.sheet),
        c = col(column),
        hits = c < 0 ? [] : findRow(rows, rowKey);
    if ((!hits.length && col(rowKey) >= 0 && findRow(rows, column).length && ((c = col(rowKey)), (hits = findRow(rows, column))), c < 0))
        return { state: 'unknown', reason: `表「${table}」缺少列「${column}」` };
    if (!hits.length) return { state: 'unknown', reason: `表「${table}」没有行「${rowKey}」` };
    if (hits.length > 1) return { state: 'unknown', reason: `表「${table}」行「${rowKey}」重复` };
    let value = hits[0][c];
    return cellText(value) === '' ? { state: 'unknown', reason: `「${path}」尚未填写` } : { state: 'ok', value };
}

export function readFacts(tables, bindings) {
    let facts = /* @__PURE__ */ new Map(),
        problems = [];
    for (let binding of bindings || []) {
        let found = findSheet(tables, binding.表);
        if (found.error) {
            problems.push(found.error);
            continue;
        }
        let { col, rows } = sheetRows(found.sheet),
            idCol = col(binding.编号列 || ''),
            stateCol = binding.状态列 ? col(binding.状态列) : -1,
            textCol = binding.内容列 ? col(binding.内容列) : -1,
            srcCol = binding.来源列 ? col(binding.来源列) : -1;
        if (idCol < 0) {
            problems.push(`表「${binding.表}」缺少编号列「${binding.编号列 || '（未设置）'}」`);
            continue;
        }
        if (binding.状态列 && stateCol < 0) {
            problems.push(`表「${binding.表}」缺少状态列「${binding.状态列}」`);
            continue;
        }
        // 配了状态列却没配已核实值：无法判断哪种状态算确认，整张表的事实都视为待确认（不默认通过）。
        let noVerifiedValue = stateCol >= 0 && (binding.已核实值 === void 0 || cellText(binding.已核实值) === '');
        noVerifiedValue && problems.push(`表「${binding.表}」配置了状态列但没有设置「已核实值」，事实一律按待确认处理`);
        // 说法值（可选，如「存疑」）：已经在正文里以说法 / 传闻出现、但未核实。条件判断仍按未确认；投影时可以带「说法，未核实」给出。
        let claimValues = valueSet(binding.说法值);
        for (let row of rows) {
            let id = cellText(row[idCol]);
            if (!id) continue;
            let raw = stateCol >= 0 ? row[stateCol] : '',
                status =
                    stateCol < 0
                        ? 'confirmed'
                        : cellText(raw) === '' || noVerifiedValue
                          ? 'pending'
                          : sameValue(raw, binding.已核实值)
                            ? 'confirmed'
                            : 'unconfirmed',
                prev = facts.get(id);
            if (prev && prev.status === 'confirmed') continue;
            facts.set(id, {
                id,
                status,
                claimed: status === 'unconfirmed' && claimValues.has(cellText(raw)),
                raw: cellText(raw),
                text: textCol >= 0 ? cellText(row[textCol]) : '',
                source: srcCol >= 0 ? cellText(row[srcCol]) : '',
                table: binding.表,
            });
        }
    }
    return { facts, problems };
}

export function readKnowledge(tables, bindings) {
    // present：表里存在的全部「事实@角色」组合（含「未知」预建行），用于检查预建行是否齐全。
    let rows = [],
        problems = [],
        present = /* @__PURE__ */ new Set();
    for (let binding of bindings || []) {
        let found = findSheet(tables, binding.表);
        if (found.error) {
            problems.push(found.error);
            continue;
        }
        let { col, rows: data } = sheetRows(found.sheet),
            factCol = col(binding.事实列 || ''),
            actorCol = col(binding.角色列 || ''),
            wayCol = binding.方式列 ? col(binding.方式列) : -1,
            credCol = binding.可信度列 ? col(binding.可信度列) : -1,
            srcCol = binding.来源列 ? col(binding.来源列) : -1;
        if (factCol < 0 || actorCol < 0) {
            problems.push(
                `表「${binding.表}」缺少${factCol < 0 ? `事实列「${binding.事实列 || '（未设置）'}」` : `角色列「${binding.角色列 || '（未设置）'}」`}`,
            );
            continue;
        }
        // 显式绑定了方式列却找不到：预建行全是「未知」，此时若照常读取，每一行都会被当成知情记录。整张表跳过。
        if (binding.方式列 && wayCol < 0) {
            problems.push(`表「${binding.表}」缺少方式列「${binding.方式列}」，这张知情表暂不读取（否则预建的「未知」行会被当成知情记录）`);
            continue;
        }
        // 核实判断：没配可信度列 → 无法核实（null = 未知）；配了列但表里没有 / 没配已核实值 → 同样未知，并报告。
        let credMissing = binding.可信度列 && credCol < 0,
            noVerifiedValue = credCol >= 0 && (binding.已核实值 === void 0 || cellText(binding.已核实值) === '');
        (credMissing && problems.push(`表「${binding.表}」缺少可信度列「${binding.可信度列}」，「核实」条件一律为未知`),
            noVerifiedValue && problems.push(`表「${binding.表}」配置了可信度列但没有设置「已核实值」，「核实」条件一律为未知`));
        // 预建行（事实 × 角色先建好、只改格子）：获知方式为空或等于「未知值」的行不算知情记录。
        let unknownWays = new Set((Array.isArray(binding.未知值) ? binding.未知值 : [binding.未知值 ?? '未知']).map(cellText).concat(['']));
        // 有效值（可选）：方式列只接受这些词。JSON 存储模式没有 CHECK 约束，填错的词（如「不知情」）不算知情记录并报告。
        let validWays = valueSet(binding.有效值),
            badWays = /* @__PURE__ */ new Set();
        for (let row of data) {
            let fact = cellText(row[factCol]),
                actor = cellText(row[actorCol]);
            fact && actor && present.add(`${fact}@${actor}`);
            if (wayCol >= 0 && unknownWays.has(cellText(row[wayCol]))) continue;
            if (wayCol >= 0 && validWays.size && !validWays.has(cellText(row[wayCol]))) {
                badWays.add(cellText(row[wayCol]));
                continue;
            }
            !fact ||
                !actor ||
                rows.push({
                    fact,
                    actor,
                    way: wayCol >= 0 ? cellText(row[wayCol]) : '',
                    credibility: credCol >= 0 ? cellText(row[credCol]) : '',
                    verified:
                        credCol < 0 || noVerifiedValue
                            ? null
                            : cellText(row[credCol]) === ''
                              ? null
                              : sameValue(row[credCol], binding.已核实值),
                    source: srcCol >= 0 ? cellText(row[srcCol]) : '',
                    table: binding.表,
                });
        }
        badWays.size &&
            problems.push(
                `表「${binding.表}」的方式列出现了不认识的值：${[...badWays].map((w) => `「${w}」`).join('、')}，这些行不算知情记录`,
            );
    }
    return { rows, problems, present };
}

export const RECALL_TAGS = ['recall', 'match', '记忆', '召回'];

export function plotPresetConflicts(preset) {
    if (!isPlainObject(preset)) return [];
    let tasks =
        Array.isArray(preset.plotTasks) && preset.plotTasks.length
            ? preset.plotTasks
            : [
                  {
                      name: preset.name || '默认任务',
                      enabled: !0,
                      extractTags: preset.extractTags,
                      extractInjectTags: preset.extractInjectTags,
                  },
              ];
    let out = [];
    for (let t of tasks) {
        if (!t || t.enabled === !1) continue;
        let tags = `${t.extractTags || ''},${t.extractInjectTags || ''}`
            .split(/[,，\s]+/)
            .map((x) => x.trim().toLowerCase())
            .filter(Boolean);
        let other = tags.filter((x) => !RECALL_TAGS.includes(x));
        other.length && out.push({ task: String(t.name || t.id || '未命名任务'), tags: other });
    }
    return out;
}

export function findRow(rows, rowKey) {
    let first = rows.filter((row) => cellText(row[1]) === rowKey);
    return first.length ? first : rows.filter((row) => row.slice(1).some((cell) => cellText(cell) === rowKey));
}

export const ENTRY_OPEN = '(（[【「『';

export const ENTRY_CLOSE = ')）]】」』';

export const ENTRY_SEP = `;；|｜
`;

export const ENTRY_COMMA = ',，、';

export const ENTRY_HEAD = /^\s*[^\s:：=,，、;；|｜()（）]{1,12}\s*[:：=]/;

export const SELF_KEYS = ['主角', 'user', '<user>', '{{user}}', '玩家'];

export function entryOf(key, value) {
    let k = String(key).trim(),
        m = /^(?:与|和|对|跟)\s*(.+?)\s*的(?:关系|好感度?|态度|印象|看法)$/.exec(k);
    return (
        (k = m ? m[1] : k.replace(/\s*的(?:关系|好感度?|态度|印象|看法)$/, '')),
        k && k.length <= 24
            ? {
                  key: k.trim(),
                  value: String(value)
                      .trim()
                      .replace(/^[−－]/, '-'),
              }
            : null
    );
}

export function parseEntry(e) {
    let depth = 0,
        at = -1,
        m;
    for (let i = 0; i < e.length; i++) {
        let ch = e[i];
        if (ENTRY_OPEN.includes(ch)) depth++;
        else if (ENTRY_CLOSE.includes(ch)) depth = Math.max(0, depth - 1);
        else if (depth === 0 && ':：='.includes(ch)) {
            at = i;
            break;
        }
    }
    return at > 0
        ? entryOf(e.slice(0, at), e.slice(at + 1).replace(/^[\s:：=]+/, ''))
        : (m = /^([^（(]{1,24}?)\s*[（(]([\s\S]*)[)）]$/.exec(e))
          ? entryOf(m[1], m[2])
          : (m = /^(\D{1,12}?)\s*([+\-−－]\s*\d+(?:\.\d+)?)$/.exec(e))
            ? entryOf(m[1], m[2].replace(/\s+/g, ''))
            : (m = /^(\S{1,12})\s+(\S[\s\S]*)$/.exec(e)) || (m = /^(\D{1,12}?)(\d+(?:\.\d+)?)$/.exec(e))
              ? entryOf(m[1], m[2])
              : null;
}

export function cellEntries(text) {
    let s = cellText(text),
        parts = [],
        cur = '',
        depth = 0,
        flush = () => {
            (cur.trim() && parts.push(cur.trim()), (cur = ''));
        };
    for (let i = 0; i < s.length; i++) {
        let ch = s[i];
        if (
            (ENTRY_OPEN.includes(ch) ? depth++ : ENTRY_CLOSE.includes(ch) && (depth = Math.max(0, depth - 1)),
            depth === 0 && ENTRY_SEP.includes(ch))
        ) {
            flush();
            continue;
        }
        if (depth === 0 && ENTRY_COMMA.includes(ch) && ENTRY_HEAD.test(cur) && ENTRY_HEAD.test(s.slice(i + 1))) {
            flush();
            continue;
        }
        cur += ch;
    }
    if ((flush(), parts.length === 1 && /[,，、]/.test(parts[0]))) {
        let bits = parts[0]
            .split(/[,，、]/)
            .map((x) => x.trim())
            .filter(Boolean);
        bits.length > 1 && bits.every((b) => /^\D{1,12}?\s*[+\-−－]?\s*\d+(?:\.\d+)?$/.test(b)) && (parts = bits);
    }
    let out = [];
    for (let p of parts) {
        let e = parseEntry(p);
        e ? out.push(e) : out.length && (out[out.length - 1] = { ...out[out.length - 1], value: `${out[out.length - 1].value},${p}` });
    }
    return out;
}

export function pickEntry(text, key) {
    let k = String(key ?? '').trim(),
        list = cellEntries(text),
        keys = SELF_KEYS.includes(k) ? SELF_KEYS : [k];
    if (!k) return { state: 'unknown', reason: '没写要取哪一项' };
    if (!list.length) return { state: 'unknown', reason: '这一格不是按「名字:内容」分条写的' };
    let hits = list.filter((e) => keys.includes(e.key)),
        vals = [...new Set(hits.map((e) => e.value))];
    return hits.length
        ? vals.length > 1
            ? { state: 'unknown', reason: `这一格里「${k}」出现了 ${hits.length} 次、写法不同，分不清取哪个` }
            : vals[0] === ''
              ? { state: 'unknown', reason: `「${k}」这一项是空的` }
              : { state: 'ok', value: vals[0] }
        : { state: 'unknown', reason: `这一格里还没有「${k}」这一项` };
}

export const TIER_EDGE = /[\s:：,，。.;；|｜(（\-—~～/／]/;

export function tierIndex(value, tiers) {
    let list = (tiers || []).map((t) => cellText(t)),
        v0 = cellText(value),
        find = (v) => {
            let hits = list.map((t, i) => ({ t, i })).filter(({ t }) => t && (v === t || (v.startsWith(t) && TIER_EDGE.test(v[t.length]))));
            if (!hits.length) return -1;
            let top = Math.max(...hits.map((h) => h.t.length)),
                best = hits.filter((h) => h.t.length === top);
            return best.length === 1 ? best[0].i : -1;
        },
        at = find(v0);
    return at >= 0 ? at : find(v0.replace(/^\d+\s*[.、:：)）]?\s*/, ''));
}

export function tierCompare(op, cell, wanted, tiers) {
    let a = tierIndex(cell, tiers),
        b = (tiers || []).map((t) => cellText(t)).indexOf(cellText(wanted));
    return a < 0 || b < 0
        ? null
        : op === '=='
          ? a === b
          : op === '!='
            ? a !== b
            : op === '>='
              ? a >= b
              : op === '<='
                ? a <= b
                : op === '>'
                  ? a > b
                  : a < b;
}

// 表格说明里给档位编了号（「0 陌生：…」「3 信任：…」）时，查一个档位名对应的数字；没写或写了不止一个数字就返回 null。
// 审阅页的表格条件用它：作者填「≥ 信任」，提示按说明改成「≥ 3」（用户 2026-11-17）。
export function tierNumberInNote(note, word) {
    let w = cellText(word);
    if (!w || Number.isFinite(Number(w))) return null;
    let re = new RegExp(`^\\s*[-·•*]?\\s*(\\d+)\\s*[.、:：)）]?\\s*${w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![^\\s:：（(，,。])`),
        nums = [...new Set(String(note || '').split(/\r?\n/).map((l) => re.exec(l)).filter(Boolean).map((m) => Number(m[1])))];
    return nums.length === 1 ? nums[0] : null;
}

export const TIER_UP_WORDS = /从低到高|由低到高|从弱到强|由弱到强|从浅到深|由浅入深|升序|[<＜→]|->/;

export const TIER_DOWN_WORDS = /从高到低|由高到低|从强到弱|由强到弱|从深到浅|降序|[>＞]/;

export function tierOrderInNote(note, tiers) {
    let list = (tiers || []).map((t) => cellText(t)).filter(Boolean),
        lines = String(note || '').split(/\r?\n/);
    if (list.length < 2) return !1;
    let inLine = (line, seq) => {
            let at = 0;
            for (let t of seq) {
                let i = line.indexOf(t, at);
                if (i < 0) return !1;
                at = i + t.length;
            }
            return !0;
        },
        stated = (k, words) => {
            if (words.test(lines[k])) return !0;
            for (let j = k + 1; j < lines.length && /^[\s·•\-*]/.test(lines[j]) && !/^\s*-\s*列\d/.test(lines[j]); j++)
                if (words.test(lines[j])) return !0;
            return !1;
        },
        down = [...list].reverse();
    if (
        lines.some((l, k) => inLine(l, list) && stated(k, TIER_UP_WORDS) && !TIER_DOWN_WORDS.test(l)) ||
        lines.some((l, k) => inLine(l, down) && stated(k, TIER_DOWN_WORDS) && !TIER_UP_WORDS.test(l))
    )
        return !0;
    let nums = list.map((t) => {
        let re = new RegExp(`^\\s*[-·•*]?\\s*(\\d+)\\s*[.、:：)）]?\\s*${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![^\\s:：（(，,。])`),
            hit = lines.map((l) => re.exec(l)).find(Boolean);
        return hit ? Number(hit[1]) : NaN;
    });
    return nums.every(Number.isFinite) && nums.every((n, i) => !i || n > nums[i - 1]);
}

export function countRows(tables, table, column, op, value, applyOp) {
    let found = findSheet(tables, table);
    if (found.error) return { state: 'unknown', reason: found.error };
    let { col, rows } = sheetRows(found.sheet),
        c = col(column);
    if (c < 0) return { state: 'unknown', reason: `表「${table}」缺少列「${column}」` };
    let n = 0,
        unsure = 0;
    for (let row of rows) {
        if (cellText(row[c]) === '') continue;
        let ok = applyOp(op, row[c], value);
        ok === null ? unsure++ : ok && n++;
    }
    return { state: 'ok', count: n, unsure };
}
