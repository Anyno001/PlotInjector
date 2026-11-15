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
        .map(([key, sheet]) => ({ key, name: String(sheet.name || key), content: sheet.content, seedRows: sheet.seedRows }));
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
        c = col(column);
    if (c < 0) return { state: 'unknown', reason: `表「${table}」缺少列「${column}」` };
    let hits = rows.filter((row) => cellText(row[1]) === rowKey);
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
