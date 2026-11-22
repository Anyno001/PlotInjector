import { isPlainObject } from './outline.js';
import { clueText } from './clue-project.js';
import { findSheet, sheetRows, findRow, cellText } from './clue-tables.js';

export const LINE_SKIP_AFTER = 3;

export function sideSlots(lineStates, limit = 1) {
    let used = (lineStates || []).filter((s) => s.line.kind === 'side' && s.state === '进行中');
    return { used: used.map((s) => s.line.id), limit, full: used.length >= limit };
}

export function lineAwayInfo(rows, lineId, uidLine, placeOf) {
    let away = 0;
    for (let x of rows || []) {
        if (!x) return null;
        let uid = x.scene || '';
        if (uid && uidLine.get(uid) === lineId) return away ? { rounds: away, place: placeOf.get(uid) || '' } : null;
        away++;
    }
    return null;
}

export function sideQueue(lineStates, clueProg) {
    let lines = (clueProg && clueProg.lines) || {},
        list = (lineStates || []).filter(
            (s) => s.line.kind === 'side' && s.line.mode !== 'manual' && s.state === '可开启' && s.entries.length,
        ),
        order = (s) => {
            let at = lines[s.line.id] && lines[s.line.id].skipAt;
            return at === void 0 ? -1 : at;
        };
    return list
        .map((s, k) => ({ s, k, at: order(s) }))
        .sort((a, b) => a.at - b.at || a.k - b.k)
        .map((x) => x.s);
}

export function offerCount(offers, lineId, sinceFloor = -1) {
    return new Set((offers || []).filter((x) => x && x.line === lineId && x.i > sinceFloor).map((x) => x.i)).size;
}

export function lineEntryPlan(
    state,
    clueProg,
    { limit = 1, offers = [], round = 0, firstOffer = /* @__PURE__ */ new Set(), known = null } = {},
) {
    let lineStates = state.lineStates || [],
        byUid = new Map(state.nodeStates.filter((s) => s.node.uid).map((s) => [s.node.uid, s.node])),
        item = (uid) => {
            let n = byUid.get(uid),
                it = n && isPlainObject(n.item) ? n.item : {};
            return { uid, entry: clueText(it.入口), place: clueText(it.地点) };
        },
        paused = !!(clueProg && clueProg.paused),
        sidePaused = !!(clueProg && clueProg.sidePaused),
        slots = sideSlots(lineStates, limit),
        unsynced = /* @__PURE__ */ new Set(),
        ok = (uid) => !known || known.has(uid) || (unsynced.add(uid), !1),
        mainNow = paused || (clueProg && clueProg.mainPaused) ? null : lineStates.find((s) => s.line.kind === 'main' && s.state === '进行中') || null,
        mainUids = mainNow
            ? state.nodeStates
                  .filter((s) => s.node.uid && s.status === 'available' && !s.disabled && s.node.unit.line === mainNow.line)
                  .map((s) => s.node.uid)
            : [],
        queue = sidePaused ? [] : sideQueue(lineStates, clueProg),
        catalog = paused ? [] : queue.flatMap((s) => s.entries.map((uid) => ({ ...item(uid), line: s.line.id }))),
        recognize = catalog.filter((r) => ok(r.uid)),
        due = '',
        head = slots.full ? null : queue[0] || null;
    if (head) {
        let lines = (clueProg && clueProg.lines) || {},
            since = lines[head.line.id] && lines[head.line.id].skipFloor !== void 0 ? lines[head.line.id].skipFloor : -1;
        offerCount(offers, head.line.id, since) >= LINE_SKIP_AFTER && queue.length > 1 && (due = head.line.id);
    }
    let pick = [],
        mainItems = mainUids.filter(ok).map(item),
        headItems = head ? head.entries.filter(ok).map(item) : [];
    paused ||
        (mainItems.length && pick.push({ s: mainNow, items: mainItems, hint: '' }),
        headItems.length && pick.push({ s: head, items: headItems, hint: head.line.entryHint }));
    let fresh = pick.find((x) => x.s.line.kind === 'main' && !firstOffer.has(x.s.line.id)),
        chosen = fresh || pick[pick.length ? round % pick.length : 0] || null,
        offer = chosen ? { line: chosen.s.line.id, kind: chosen.s.line.kind, hint: chosen.hint, items: chosen.items } : null;
    return {
        recognize,
        catalog,
        offer,
        due,
        waiting: slots.full && !sidePaused ? sideQueue(lineStates, clueProg).map((s) => s.line.id) : [],
        slots,
        unsynced: [...unsynced],
        known,
    };
}

// 主线位置：同时只有一条主线「进行中」。暂停的主线不占位置（导入审阅总方案 H / GPT 审阅 R6）。
export function mainSlotTaken(lineStates, id) {
    let other = (lineStates || []).find((s) => s.line.kind === 'main' && s.line.id !== id && s.state === '进行中');
    return other ? `主线${other.line.id}还在进行` : '';
}
// 正在占着主线位置的那条（继续一条暂停的主线时，要先把它暂停）。
export function mainInProgress(lineStates, id = '') {
    return (lineStates || []).find((s) => s.line.kind === 'main' && s.line.id !== id && s.state === '进行中') || null;
}

export function catalogKnown(tables, scenePath) {
    let [table, row] = String(scenePath || '')
            .split('/')
            .map((x) => x.trim()),
        found = table ? findSheet(tables || {}, table) : { error: 'x' };
    if (found.error) return null;
    let { col, rows } = sheetRows(found.sheet),
        ci = col(LINE_CATALOG_COL),
        hits = ci < 0 ? [] : findRow(rows, row);
    return hits.length !== 1
        ? null
        : new Set(
              cellText(hits[0][ci])
                  .split(/\n|。/)
                  .map((x) => x.split(/[:：]/)[0].trim())
                  .filter(Boolean),
          );
}

export const ACU_SETTINGS_NS = 'shujuku_v120__userscript_settings_v1';

export const ACU_GLOBAL_META = 'shujuku_v120_globalMeta_v1';

export function acuIsolationKey(extensionSettings) {
    try {
        let ns = extensionSettings && extensionSettings.__userscripts && extensionSettings.__userscripts[ACU_SETTINGS_NS],
            raw = ns && ns[ACU_GLOBAL_META];
        if (raw == null) return null;
        let meta = typeof raw == 'string' ? JSON.parse(raw) : raw;
        return isPlainObject(meta)
            ? meta.activeIsolationCode == null
                ? ''
                : typeof meta.activeIsolationCode == 'string'
                  ? meta.activeIsolationCode.trim()
                  : null
            : null;
    } catch {
        return null;
    }
}

export function enterEvidence({ allowed = [], cell = '', floor = -1, swipe = 0, evidenceOk = !1, denied = {} }) {
    let v = cellText(cell),
        hit = v && allowed.find((x) => x.uid === v);
    if (!hit || !evidenceOk || floor < 0) return null;
    let key = `${hit.line}@${floor}:${swipe}`;
    return (denied[hit.line] || []).includes(key) ? null : { line: hit.line, uid: hit.uid, key };
}

export const FILL_SOURCES = ['group_fill', 'auto_fill', 'manual_fill'];

export function isolatedTag(msg, isoKey = null) {
    let raw = msg && msg.TavernDB_ACU_IsolatedData;
    if (typeof raw == 'string')
        try {
            raw = JSON.parse(raw);
        } catch {
            raw = null;
        }
    if (!isPlainObject(raw)) return { sure: !0, tag: null };
    if (isoKey != null) return { sure: !0, tag: isPlainObject(raw[isoKey]) ? raw[isoKey] : null };
    let keys = Object.keys(raw).filter((k) => isPlainObject(raw[k]));
    return keys.length
        ? keys.length === 1 && keys[0] === ''
            ? { sure: !0, tag: raw[''] }
            : { sure: !1, tag: null }
        : { sure: !0, tag: null };
}

export function frameEvents(msg, isoKey = null) {
    let { sure, tag } = isolatedTag(msg, isoKey);
    if (!sure) return null;
    let frame = tag && isPlainObject(tag.storageFrame) ? tag.storageFrame : null;
    return frame
        ? [
              ...(isPlainObject(frame.checkpoint) && isPlainObject(frame.checkpoint.event)
                  ? [{ ...frame.checkpoint.event, source: 'checkpoint' }]
                  : []),
              ...(Array.isArray(frame.logEntries) ? frame.logEntries : []),
          ]
              .filter(isPlainObject)
              .map((e) => ({
                  source: String(e.source || ''),
                  filled: Array.isArray(e.filledSheetKeys) ? e.filledSheetKeys : [],
                  error: e.error ? String(e.error) : '',
              }))
        : [];
}

export function fillEvidence(msg, sheetKey, isoKey = null) {
    if (!msg || msg.is_user) return { ok: !1, reason: '不是AI回复' };
    if (!sheetKey) return { ok: !1, reason: '不知道线索控制表在数据库里的编号' };
    let events = frameEvents(msg, isoKey);
    return events === null
        ? { ok: !1, reason: '读不到数据库现在用的隔离标识，这一楼又有好几份记录，认不准是哪一份' }
        : events.length
          ? events.filter((e) => (FILL_SOURCES.includes(e.source) || e.source === 'checkpoint') && e.filled.includes(sheetKey) && !e.error)
                .length
              ? { ok: !0, reason: '' }
              : { ok: !1, reason: '这一楼的填表没有处理线索控制表' }
          : { ok: !1, reason: '这一楼还没有填表记录' };
}

export function appendTargetFloor(chat, isoKey = null) {
    let list = Array.isArray(chat) ? chat : [],
        last = -1;
    for (let i = list.length - 1; i >= 0; i--) {
        let msg = list[i];
        if (!msg || msg.is_user) continue;
        last < 0 && (last = i);
        let { sure, tag } = isolatedTag(msg, isoKey);
        if (!sure) return -1;
        if (
            tag &&
            (isPlainObject(tag.storageFrame) ||
                (isPlainObject(tag.independentData) && Object.keys(tag.independentData).some((k) => k.startsWith('sheet_'))))
        )
            return i;
    }
    return last;
}

export const LINE_CATALOG_COL = '场景目录';

export function sceneCatalogCell(state, plan, clueProg) {
    if (clueProg && clueProg.paused) return '（剧情暂停中，当前场景写「无」）';
    let lineOf = new Map((state.lineStates || []).map((s) => [s.line, s])),
        seen = /* @__PURE__ */ new Set(),
        rows = [],
        push = (uid, entry, place) => {
            !uid ||
                seen.has(uid) ||
                (seen.add(uid), rows.push(`${uid}：${[entry || '（没写入口）', place && `地点：${place}`].filter(Boolean).join('；')}`));
        };
    for (let s of state.nodeStates) {
        if (!s.node.uid || s.disabled || !(s.status === 'available' || s.status === 'active')) continue;
        let it = isPlainObject(s.node.item) ? s.node.item : {};
        push(s.node.uid, clueText(it.入口), clueText(it.地点));
    }
    for (let r of plan.catalog || plan.recognize || []) push(r.uid, r.entry, r.place);
    return rows.length
        ? rows.join(`。
`)
        : '（暂时没有可以去做的剧情，当前场景写「无」）';
}
