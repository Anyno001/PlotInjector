import { normalizeFolds, foldTake, foldFind, foldSame, foldValues, foldStatus } from '../core/fold.js';
import { cloneTables, entityTables, findSheet, cellText } from '../core/clue-tables.js';
import { anchorOf, anchorValid } from '../core/clue-progress.js';
import { appendTargetFloor, isolatedTag } from '../core/lines.js';
import { isPlainObject, makeId } from '../core/outline.js';
import { chatMessages } from '../host/st.js';
import { persistChatNow } from './progress-store.js';

// 收起、恢复已结束剧情线的表格行（大型项目方案 三.3–三.5）。
// 顺序：先存记录并从服务器读回核对 → 删前逐行重新读表、比对所有列 → 删 → 回读确认不在了，记下删除写在哪一楼。
// 每一步前检查聊天、项目、数据库隔离；读不到隔离、数据库正在填表、聊天里还没有 AI 回复时不做。

const SQL_WORD = /^[A-Za-z_\u0080-￿][A-Za-z0-9_$\u0080-￿]*$/;
const FILL_BUSY_MS = 18e4;
const rowKey = (r) => `${r.kind}:${r.code}@${r.kind === 'know' ? cellText(r.actor) : ''}`;

export function createFoldOps(d) {
    let fillStartAt = 0;
    // 官方只有「开始填表」回调，没有「填表结束」：开始后到下一次表格更新之前算正在填表（最多 3 分钟）
    const busyFill = () => !!fillStartAt && Date.now() - fillStartAt < FILL_BUSY_MS;
    const rawTables = (api) => entityTables(cloneTables(api.exportTableAsJson()));
    const binding = (p, kind) => ((kind === 'fact' ? p.clue.bindings.facts : p.clue.bindings.knowledge) || [])[0] || null;

    function folds() {
        return normalizeFolds((d.getProgress() || {}).folds).map((r) => ({ ...r, rows: r.rows.map((x) => ({ ...x })) }));
    }
    const print = (list) => JSON.stringify(list.map((r) => [r.id, r.rows.map((x) => [rowKey(x), x.st, x.clr ? [x.clr.i, x.clr.stamp] : null])]));
    // 写进进度，并立即存盘、读回核对
    async function persist(list) {
        let prog = d.getProgress(),
            p = d.project();
        if (!prog || !p) return !1;
        d.setProgress({ ...prog, folds: list }, 'fold');
        let want = print(list);
        return persistChatNow((plug) => {
            let saved = plug && plug.byProject && plug.byProject[p.id];
            return print(normalizeFolds(saved && saved.folds)) === want;
        });
    }
    function gate(api) {
        if (!api || typeof api.exportTableAsJson != 'function') return '未检测到数据库插件';
        if (d.isoKey() === null) return '读不到数据库的隔离标识';
        if (busyFill()) return '数据库正在填表，请稍后再试';
        if (!chatMessages().some((m) => m && !m.is_user)) return '聊天里还没有AI回复';
        return '';
    }
    // 原生模式：删除记在哪一楼——找带这一行 row_delete 记录的楼（官方写在最新一个有表格记录的 AI 楼）
    function deleteFloor(chat, rid, iso) {
        for (let i = chat.length - 1; i >= 0; i--) {
            let msg = chat[i];
            if (!msg || msg.is_user) continue;
            let { tag } = isolatedTag(msg, iso),
                frame = tag && isPlainObject(tag.storageFrame) ? tag.storageFrame : null,
                logs = frame && Array.isArray(frame.logEntries) ? frame.logEntries : [];
            if (logs.some((e) => isPlainObject(e) && e.source === 'manual_crud' && Array.isArray(e.operations) && e.operations.some((o) => o && o.kind === 'row_delete' && String(o.rowId) === String(rid))))
                return i;
        }
        return -1;
    }
    async function deleteOne(api, p, row, iso) {
        let b = binding(p, row.kind),
            tables = rawTables(api),
            found = b ? findSheet(tables, b.表) : { error: 'x' },
            hits = found.error ? null : foldFind(tables, p.clue.bindings, row);
        if (!hits || hits.length !== 1 || !foldSame(row.cells, row.head, hits[0], found.sheet.content[0])) return { ok: !1, why: 'changed' };
        let rid = hits[0][0],
            idCol = row.kind === 'fact' ? b.编号列 : b.事实列,
            floor = -1,
            ok = !1;
        if (typeof api.querySql == 'function') {
            if (!SQL_WORD.test(b.表) || !SQL_WORD.test(idCol)) return { ok: !1, why: 'sql-name' };
            let res = await Promise.resolve(
                api.executeSqlMutation({ sql: `DELETE FROM ${b.表} WHERE row_id = ? AND ${idCol} = ?`, params: [rid, row.code], skipNotify: !0 }),
            ).catch(() => null);
            ok = !!res && !(res.errors || []).length && res.changes === 1 && res.saved !== !1;
            floor = res && Number.isInteger(res.messageIndex) ? res.messageIndex : -1;
        } else if (typeof api.deleteRow == 'function') {
            let index = found.sheet.content.indexOf(hits[0]);
            ok = !!(await Promise.resolve(api.deleteRow({ tableName: b.表, rowIndex: index, skipNotify: !0 })).catch(() => !1));
            floor = ok ? deleteFloor(chatMessages(), rid, iso) : -1;
        } else return { ok: !1, why: 'api' };
        let left = foldFind(rawTables(api), p.clue.bindings, row);
        if (!left || left.length) return { ok: !1, why: 'readback' };
        // 删掉了但找不到写在哪一楼：按官方规则（最新一个有表格记录的 AI 楼）记，标为推测
        return floor >= 0 ? { ok: !0, floor, rid } : { ok: !0, floor: appendTargetFloor(chatMessages(), iso), rid, guess: !0 };
    }

    // lineIds：要收起的线；manual：手动收起不等下一次填表，其余检查一样。
    async function collapse(lineIds, { manual = !1 } = {}) {
        let p = d.project(),
            api = d.api(),
            why = gate(api);
        if (!p) return { ok: !1, why: '当前项目不是线索模式' };
        if (why) return { ok: !1, why };
        let check = d.foldCheck();
        if (!check) return { ok: !1, why: '读不到剧情线状态' };
        if (check.blocked) return { ok: !1, why: check.blocked };
        let iso = d.isoKey(),
            t0 = d.ticket(),
            chat = chatMessages(),
            tables = rawTables(api),
            targets = check.lines.filter((x) => lineIds.includes(x.id) && x.facts.length && (manual || x.fill.ok)),
            recs = [];
        for (let x of targets) {
            let take = foldTake(tables, p.clue.bindings, x.facts);
            take.rows.length &&
                recs.push({
                    id: makeId('fold'),
                    line: x.id,
                    state: x.state,
                    end: x.endFloor >= 0 ? anchorOf(chat, x.endFloor) : anchorOf(chat),
                    iso,
                    time: Date.now(),
                    manual: !!manual,
                    rows: take.rows,
                    skipped: take.skipped,
                });
        }
        if (!recs.length) return { ok: !1, why: '没有可收起的行' };
        let keys = new Set(recs.flatMap((r) => r.rows.map(rowKey))),
            list = [...folds().map((r) => ({ ...r, rows: r.rows.filter((x) => !keys.has(rowKey(x))) })).filter((r) => r.rows.length), ...recs];
        if (!(await persist(list))) return { ok: !1, why: '收起记录未能确认存盘，没有删除表格行' };
        let done = 0,
            failed = 0,
            stopped = '';
        outer: for (let rec of recs)
            for (let row of rec.rows) {
                if (!d.ticketValid(t0) || d.isoKey() !== iso) {
                    stopped = '已切换聊天、项目或数据库隔离';
                    break outer;
                }
                if (busyFill()) {
                    stopped = '数据库开始填表';
                    break outer;
                }
                let r = await deleteOne(api, p, row, iso);
                r.ok ? ((row.st = 'deleted'), (row.del = anchorOf(chatMessages(), r.floor)), r.guess && (row.guess = !0), (row.rid = r.rid), done++) : failed++;
            }
        d.ticketValid(t0) && (await persist(list));
        d.invalidate('fold');
        d.note(`收起${recs.map((r) => r.line).join('、')}：删除${done}行${failed ? `，${failed}行未删` : ''}${stopped ? `（${stopped}，下次继续）` : ''}`);
        return { ok: !0, rows: done, failed, stopped, lines: recs.map((r) => r.line), recs: recs.map((r) => r.id) };
    }

    // 恢复：按记录把行插回表里（列按列名对应）。pick(rec, row, st) 选哪些行；auto：自动恢复不碰待核对的行。
    async function restore(pick, { auto = !1 } = {}) {
        let p = d.project(),
            api = d.api(),
            why = gate(api);
        if (!p) return { ok: !1, why: '当前项目不是线索模式' };
        if (why) return { ok: !1, why };
        if (typeof api.insertRow != 'function') return { ok: !1, why: '数据库不支持插入行' };
        let iso = d.isoKey(),
            t0 = d.ticket(),
            list = folds(),
            st = foldStatus(list, { tables: rawTables(api), bindings: p.clue.bindings, chat: chatMessages(), iso, anchorOk: anchorValid }),
            todo = st.filter((x) => pick(x.rec, x.row, x.st) && (x.st === 'folded' || x.st === 'lost' || (!auto && x.st === 'check'))),
            done = 0,
            failed = 0,
            missingCols = new Set();
        for (let x of todo) {
            if (!d.ticketValid(t0) || d.isoKey() !== iso || busyFill()) break;
            let row = list.find((r) => r.id === x.rec.id).rows.find((r) => rowKey(r) === rowKey(x.row)),
                b = binding(p, row.kind),
                tables = rawTables(api),
                found = b ? findSheet(tables, b.表) : { error: 'x' };
            if (found.error) {
                failed++;
                continue;
            }
            let head = found.sheet.content[0].map((h) => cellText(h)),
                have = foldFind(tables, p.clue.bindings, row);
            // 表里已有这一键：不重复插（以表为准）
            if (have && have.length) {
                ((row.st = 'restored'), (row.ins = anchorOf(chatMessages(), appendTargetFloor(chatMessages(), iso))));
                continue;
            }
            let vals = foldValues(row, p.clue.bindings, chatMessages(), anchorValid),
                data = {};
            row.head.forEach((name, i) => {
                if (i < 1 || !name) return;
                head.indexOf(name) > 0 ? (data[name] = vals[i]) : cellText(vals[i]) && missingCols.add(name);
            });
            let res = await Promise.resolve(api.insertRow({ tableName: b.表, data, skipNotify: !0 })).catch(() => -1),
                after = rawTables(api),
                back = foldFind(after, p.clue.bindings, row),
                sheet = findSheet(after, b.表);
            if (res >= 0 && back && back.length === 1 && !sheet.error && foldSame(vals.map((v, i) => (i > 0 && head.indexOf(row.head[i]) < 1 ? '' : v)), row.head, back[0], sheet.sheet.content[0])) {
                ((row.st = 'restored'), (row.ins = anchorOf(chatMessages(), appendTargetFloor(chatMessages(), iso))), done++);
            } else failed++;
        }
        d.ticketValid(t0) && (await persist(list));
        d.invalidate('fold');
        (done || failed) && d.note(`恢复${done}行${failed ? `，${failed}行未恢复` : ''}${missingCols.size ? `；表里已没有这些列：${[...missingCols].join('、')}` : ''}`);
        return { ok: !0, rows: done, failed, missingCols: [...missingCols] };
    }

    // 填表后自动维护：线不再是已结束、或有没结束的线要读，已收起的行恢复回表里（方案 三.4）。
    async function maintain(c) {
        let p = d.project();
        if (!p || !c || !c.snap.fold || !c.snap.fold.length) return null;
        let codes = d.needRestore(c, p);
        if (!codes.size) return null;
        return restore((rec, row) => codes.has(row.code), { auto: !0 });
    }

    // SQLite 下作废一条已收起的线索：记下清除（带楼层锚点），读视图和恢复都按清除后的值（方案 十.6）
    async function markCleared(code) {
        let list = folds(),
            at = anchorOf(chatMessages()),
            hit = 0;
        for (let r of list) for (let row of r.rows) row.code === code && row.st === 'deleted' && ((row.clr = at), hit++);
        if (!hit) return 0;
        let ok = await persist(list);
        return (d.invalidate('fold'), ok ? hit : 0);
    }

    return {
        collapse,
        restore,
        maintain,
        markCleared,
        folds,
        onFillStart() {
            fillStartAt = Date.now();
        },
        onTableUpdate() {
            fillStartAt = 0;
        },
        fillBusy: busyFill,
    };
}
