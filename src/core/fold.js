import { isPlainObject } from './outline.js';
import { discoveryList, volumeUses } from './clue-project.js';
import { findSheet, cellText, knowKey } from './clue-tables.js';
import { FILL_SOURCES, frameEvents } from './lines.js';
import { anchorValid } from './clue-progress.js';

// 收起已结束的线（大型项目方案 三）。这里只计算，不写表、不存记录。

export const ENDED_STATES = ['完成', '放弃'];

// 自动收起按存储模式放行（方案 三.7）。用户 2026-11-23 决定线索模式默认开启，两种存储都放开；三.7 的验收项并进本地酒馆实测，
// 哪种存储没通过就把它改回 !1（只剩手动收起）。新版模板生成的聊天默认收起，其余聊天在「已结束」页问一次（三.3）。
export const FOLD_AUTO_RELEASED = { native: !0, sqlite: !0 };

// 自动收起要等表格安静 FOLD_QUIET.ms 毫秒、且不在填表中：数据库分组填表时每组填完都发一次更新，中途收会抢在后面几组前面（实测问题 18）
export const FOLD_QUIET = { ms: 3e4 };

// 单条暂停的线满多少个有效回合可以收起（方案 三.8）
export const FOLD_PAUSE_ROUNDS = 3;

// 单条暂停的有效回合（方案 三.8〔五〕）：回放带楼层锚点的操作，从这条线最近一次单条暂停那一楼之后的 AI 回复开始数，
// 同一楼只算一次；对这条线生效的全局暂停（暂停剧情、暂停全部主线 / 支线）期间的楼不算。删楼后自然少算。
// 只有这条线最后一次状态操作是「暂停」才算。返回 { rounds, floor: 第 need 个有效回合所在楼（不足为 -1） }。
export function pauseRounds(ops, chat, line, need = FOLD_PAUSE_ROUNDS) {
    let list = Array.isArray(chat) ? chat : [],
        valid = (ops || []).filter((op) => anchorValid(op.at, list)),
        mine = valid.filter((op) => op.kind === 'line' && op.target === line.id && !['start', 'deny', 'skip'].includes(op.value)),
        last = mine[mine.length - 1];
    if (!last || last.value !== 'pause') return { rounds: 0, floor: -1 };
    let since = last.at ? last.at.i : -1,
        globals = valid.filter((op) => op.kind === 'pause' && (op.target === 'side' ? line.kind === 'side' : op.target === 'mains' ? line.kind === 'main' : !0)),
        rounds = 0,
        floor = -1;
    for (let i = since + 1; i < list.length; i++) {
        if (!list[i] || list[i].is_user) continue;
        // 「暂停剧情」和「暂停全部主线 / 支线」各自记，任一生效这一楼就不算
        let all = !1,
            kind = !1;
        for (let op of globals) op.at && op.at.i < i && (op.target === 'side' || op.target === 'mains' ? (kind = !!op.value) : (all = !!op.value));
        if (all || kind) continue;
        rounds++;
        rounds === need && (floor = i);
    }
    return { rounds, floor };
}

// 哪些线索可以收起：产出它的线都已结束，没有未结束的线（含无线的老单元）读到它，也不在「不收」名单里。
// 返回 [{ line, state, facts: [编号], kept: [{ fact, by: [线编号], why }] }]，按大纲顺序，只列已结束的线。
// 几条已结束的线产出同一条线索时，算在第一条名下。
// paused：单条暂停满回合、和已结束一样处理的线（它自己以后才会读的内部引用不挡它自己，方案 三.8〔五〕）。
export function foldPlan(compiled, lineStates, { keep = [], paused = null } = {}) {
    let stateOf = new Map((lineStates || []).map((s) => [s.line.id, s.state])),
        ended = (id) => ENDED_STATES.includes(stateOf.get(id)) || (!!paused && paused.has(id)),
        noFold = new Set((keep || []).map(cellText).filter(Boolean)),
        producers = new Map(),
        readers = new Map(),
        add = (map, f, who) => (map.get(f) || map.set(f, []).get(f)).includes(who) || map.get(f).push(who);
    for (let n of compiled.nodes || [])
        for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) d.fact && add(producers, d.fact, n.unit.line ? n.unit.line.id : '');
    let vols = [...new Set((compiled.units || []).map((u) => u.volume))];
    for (let v of vols) {
        let line = (compiled.lines || []).find((l) => l.volume === v);
        if (line && ended(line.id)) continue;
        for (let f of volumeUses(compiled, v).facts) add(readers, f, line ? line.id : '');
    }
    let taken = new Set(),
        out = [];
    for (let l of compiled.lines || []) {
        if (!ended(l.id)) continue;
        let facts = [],
            kept = [],
            mine = [];
        for (let n of compiled.nodes || [])
            if (n.unit.line === l) for (let d of discoveryList(isPlainObject(n.item) ? n.item : {})) d.fact && !mine.includes(d.fact) && mine.push(d.fact);
        for (let f of mine) {
            if (taken.has(f)) continue;
            taken.add(f);
            let open = (producers.get(f) || []).filter((id) => id === '' || !ended(id)),
                by = readers.get(f) || [];
            open.length
                ? kept.push({ fact: f, by: open, why: 'produce' })
                : by.length
                  ? kept.push({ fact: f, by, why: 'read' })
                  : noFold.has(f)
                    ? kept.push({ fact: f, by: [], why: 'keep' })
                    : facts.push(f);
        }
        out.push({ line: l, state: stateOf.get(l.id), facts, kept });
    }
    return out;
}

// 表里实际存在、可以收起的行：只看真正的行（不拿模板初始行充数），只看项目绑定的第一张事实表、知情表。
// 返回 { facts: { 编号: 行数 }, knows: { 编号: 行数 }, factKey, knowKey, problems }
export function foldRows(tables, bindings, codes) {
    let want = new Set(codes || []),
        out = { facts: {}, knows: {}, factKey: '', knowKey: '', problems: [] },
        scan = (b, idCol, into, keyName) => {
            if (!b || !b.表) return;
            let found = findSheet(tables || {}, b.表);
            if (found.error) return void out.problems.push(found.error);
            let sheet = found.sheet,
                head = Array.isArray(sheet.content && sheet.content[0]) ? sheet.content[0] : [],
                ci = head.findIndex((cell, i) => i > 0 && cellText(cell) === cellText(b[idCol]));
            if (ci < 0) return void out.problems.push(`表「${b.表}」缺少列「${b[idCol]}」`);
            out[keyName] = sheet.key || '';
            for (let row of (sheet.content || []).slice(1)) {
                let code = Array.isArray(row) ? cellText(row[ci]) : '';
                want.has(code) && (into[code] = (into[code] || 0) + 1);
            }
        };
    scan(((bindings && bindings.facts) || [])[0], '编号列', out.facts, 'factKey');
    scan(((bindings && bindings.knowledge) || [])[0], '事实列', out.knows, 'knowKey');
    return out;
}

// 结束那一楼之后的真正填表记录（方案 三.2）：来源是自动、手动、分组填表，没有报错，同一个数据库隔离；
// 关键事实表和知情表都处理过（可以在不同楼、不同记录里）。导入、恢复写的检查点不算。
// keys：{ facts: 表编号, knows: 表编号或空（没绑知情表） }。返回 { ok, floor, sources } 或 { ok: false, why }。
export function foldFill(chat, endFloor, keys, isoKey = null) {
    let list = Array.isArray(chat) ? chat : [];
    if (!keys || !keys.facts) return { ok: !1, why: 'table' };
    if (!Number.isInteger(endFloor) || endFloor < 0) return { ok: !1, why: 'end' };
    let need = [keys.facts, ...(keys.knows ? [keys.knows] : [])],
        seen = new Map(),
        sources = new Set();
    for (let i = endFloor + 1; i < list.length; i++) {
        let msg = list[i];
        if (!msg || msg.is_user) continue;
        let events = frameEvents(msg, isoKey);
        if (!events) continue;
        for (let e of events) {
            if (!FILL_SOURCES.includes(e.source) || e.error) continue;
            for (let k of need) e.filled.includes(k) && !seen.has(k) && (seen.set(k, i), sources.add(e.source));
        }
        if (need.every((k) => seen.has(k))) return { ok: !0, floor: i, sources: [...sources] };
    }
    return { ok: !1, why: 'wait' };
}

// ---------- 收纳记录（方案 三.3–三.6） ----------
// 记录放在本聊天、本项目的进度里：prog.folds = [{ id, line, state, end, iso, time, manual, rows }]
// row = { kind: 'fact' | 'know', code, actor, head: [列名], cells: [值], rid, st: 'saved' | 'deleted', del, clr }
//   saved：记录已存，表里还没删；deleted：删后回读确认不在了，del 是写入删除的那一楼的锚点；
//   clr：SQLite 下对已收起的行作废时，按清除后的值算（锚点失效就不算）。

export function normalizeFolds(value) {
    return (Array.isArray(value) ? value : [])
        .filter((r) => isPlainObject(r) && typeof r.line == 'string' && Array.isArray(r.rows))
        .map((r) => ({
            ...r,
            rows: r.rows.filter(
                (x) => isPlainObject(x) && (x.kind === 'fact' || x.kind === 'know') && typeof x.code == 'string' && Array.isArray(x.head) && Array.isArray(x.cells),
            ),
        }))
        .filter((r) => r.rows.length);
}

// 一张表里某行的键：事实行按编号，知情行按「编号@角色」（主角几种叫法归一，D47）。
function rowKeyOf(kind, code, actor) {
    return kind === 'fact' ? cellText(code) : knowKey(code, actor);
}

function bindingOf(bindings, kind) {
    return ((bindings && (kind === 'fact' ? bindings.facts : bindings.knowledge)) || [])[0] || null;
}

// 绑定的表：{ sheet, names: 列名, ci: 编号列, ai: 角色列 }，读不到返回 null。
function sheetOf(tables, bindings, kind) {
    let b = bindingOf(bindings, kind);
    if (!b || !b.表) return null;
    let found = findSheet(tables || {}, b.表);
    if (found.error) return null;
    let content = found.sheet.content || [],
        names = (Array.isArray(content[0]) ? content[0] : []).map((x) => cellText(x)),
        ci = names.findIndex((x, i) => i > 0 && x === cellText(kind === 'fact' ? b.编号列 : b.事实列)),
        ai = kind === 'know' ? names.findIndex((x, i) => i > 0 && x === cellText(b.角色列)) : -1;
    return ci < 0 || (kind === 'know' && ai < 0) ? null : { sheet: found.sheet, names, ci, ai, b };
}

// 从实表取要收起的行（只看真正的行）。同一个键对上几行时不任选，这条线索整条不收（方案 三.3〔五〕）。
// 返回 { rows: [记录行], skipped: [编号] }
export function foldTake(tables, bindings, codes) {
    let want = new Set(codes || []),
        out = [],
        skipped = new Set();
    for (let kind of ['fact', 'know']) {
        let t = sheetOf(tables, bindings, kind);
        if (!t) continue;
        let byKey = new Map();
        for (let row of (t.sheet.content || []).slice(1)) {
            if (!Array.isArray(row)) continue;
            let code = cellText(row[t.ci]);
            if (!want.has(code)) continue;
            let key = rowKeyOf(kind, code, t.ai >= 0 ? row[t.ai] : '');
            (byKey.get(key) || byKey.set(key, []).get(key)).push(row);
        }
        for (let [, rows] of byKey) {
            let row = rows[0],
                code = cellText(row[t.ci]);
            if (rows.length > 1) {
                skipped.add(code);
                continue;
            }
            out.push({
                kind,
                code,
                actor: t.ai >= 0 ? cellText(row[t.ai]) : '',
                head: t.names,
                cells: row.map((v) => (v == null ? '' : v)),
                rid: row[0] ?? null,
                st: 'saved',
                del: null,
                clr: null,
            });
        }
    }
    // 事实行有歧义时，它的知情行也不收（两边一起收、一起恢复）
    return { rows: out.filter((r) => !skipped.has(r.code)), skipped: [...skipped] };
}

// 表里这一键的真正的行（数组）；表或列读不到返回 null。
export function foldFind(tables, bindings, row) {
    let t = sheetOf(tables, bindings, row.kind);
    if (!t) return null;
    let key = rowKeyOf(row.kind, row.code, row.actor);
    return (t.sheet.content || []).slice(1).filter((r) => Array.isArray(r) && rowKeyOf(row.kind, r[t.ci], t.ai >= 0 ? r[t.ai] : '') === key);
}

// 记录行和表里的行内容是否一样（按列名比所有列，不比 row_id）。
export function foldSame(cells, head, tableRow, tableHead) {
    let names = (tableHead || []).map((x) => cellText(x));
    for (let i = 1; i < head.length; i++) {
        let j = names.indexOf(head[i]);
        if (j < 1 ? cellText(cells[i]) !== '' : cellText(cells[i]) !== cellText(tableRow[j])) return !1;
    }
    for (let j = 1; j < names.length; j++) if (head.indexOf(names[j]) < 1 && cellText(tableRow[j]) !== '') return !1;
    return !0;
}

// 记录行在当前分支上应有的值（读视图和恢复共用）：有效的 SQLite 清除按清除后的值，原值不动。
export function foldValues(row, bindings, chat, anchorOk) {
    let cells = row.cells.slice();
    if (row.clr && anchorOk(row.clr, chat)) {
        let set = (col, v) => {
            let i = row.head.indexOf(cellText(col));
            i > 0 && (cells[i] = v);
        };
        let b = bindingOf(bindings, row.kind);
        if (!b) return cells;
        if (row.kind === 'fact') set(b.状态列, '未获得');
        else {
            b.方式列 && set(b.方式列, Array.isArray(b.未知值) ? b.未知值[0] : b.未知值 || '未知');
            b.可信度列 && set(b.可信度列, '未核实');
        }
    }
    return cells;
}

// 每一行现在算什么（方案 三.5）：
//   folded：已确认删除，删除那一楼和结束那一楼都在当前分支上，表里也确实没有这一键——补进读视图；
//   lost：同上，但结束那一楼不在了（线可能回到进行中）——补进读视图，等恢复；
//   same / back：表里又有这一键的行（删楼回退、手动重填），以表为准；same 是内容和记录一样；
//   check：记录说删了，但删除那一楼不在当前分支、表里也没有——待核对，不补进读视图，也不自动写回；
//   saved：记录已存，还没删（中断过）；
//   unknown：表或列读不到。
// 只认同一个数据库隔离的记录。
export function foldStatus(recs, { tables, bindings, chat, iso, anchorOk }) {
    let out = [];
    for (let rec of recs || []) {
        if (rec.iso !== iso) continue;
        let endOk = anchorOk(rec.end, chat);
        for (let row of rec.rows) {
            let t = sheetOf(tables, bindings, row.kind),
                found = t ? foldFind(tables, bindings, row) : null,
                st;
            if (found === null) st = 'unknown';
            else if (found.length) st = found.length === 1 && foldSame(foldValues(row, bindings, chat, anchorOk), row.head, found[0], t.sheet.content[0]) ? 'same' : 'back';
            // 恢复过的行：插入那一楼还在却不见了，待核对；那一楼不在了，回到收起时的判断
            else if (row.st === 'restored' && row.ins && anchorOk(row.ins, chat)) st = 'check';
            else if (row.st !== 'deleted' && row.st !== 'restored') st = 'saved';
            else if (!row.del || !anchorOk(row.del, chat)) st = 'check';
            else st = endOk ? 'folded' : 'lost';
            out.push({ rec, row, st });
        }
    }
    return out;
}

// 读视图：把 folded / lost 的行按列名放回原始表的副本（读条件、执行页显示用；写操作一律用原始表）。
export function foldView(tables, bindings, status, chat, anchorOk) {
    let rows = (status || []).filter((x) => x.st === 'folded' || x.st === 'lost');
    if (!rows.length || !tables) return tables;
    let out = { ...tables };
    for (let x of rows) {
        let t = sheetOf(out, bindings, x.row.kind);
        if (!t) continue;
        let key = t.sheet.key,
            vals = foldValues(x.row, bindings, chat, anchorOk),
            line = t.names.map((name, j) => {
                if (j === 0) return null;
                let i = x.row.head.indexOf(name);
                return i > 0 ? vals[i] : '';
            });
        out[key] = { ...out[key], content: [...out[key].content, line], seedRows: [] };
    }
    return out;
}

// 已收起或正在处理的线索编号（补行、缺行判断都要跳过它们，方案 十.1）。
export function foldBusyCodes(status) {
    return new Set((status || []).filter((x) => ['folded', 'lost', 'check', 'saved'].includes(x.st)).map((x) => x.row.code));
}
