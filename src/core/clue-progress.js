import { isPlainObject, makeId } from './outline.js';

export const CLUE_OP_KINDS = ['open', 'done', 'skip', 'fact', 'focus', 'pause'];

export function anchorOf(chat) {
    let list = Array.isArray(chat) ? chat : [],
        i = list.length - 1,
        msg = list[i];
    return i < 0 || !msg ? { i: -1, swipe: 0, stamp: '' } : { i, swipe: Number(msg.swipe_id) || 0, stamp: String(msg.send_date ?? '') };
}

export function anchorValid(at, chat) {
    if (!at || at.i < 0) return !0;
    let msg = Array.isArray(chat) ? chat[at.i] : null;
    return !!msg && (Number(msg.swipe_id) || 0) === at.swipe && String(msg.send_date ?? '') === at.stamp;
}

export function normalizeClueOps(value) {
    let src = isPlainObject(value) ? value : {};
    return {
        // ops 是重建人工状态的依据，不截断；只做无损压缩（见 compactClueOps）。
        ops: (Array.isArray(src.ops) ? src.ops : []).filter(
            (op) => isPlainObject(op) && CLUE_OP_KINDS.includes(op.kind) && typeof op.target == 'string',
        ),
        log: Array.isArray(src.log) ? src.log.slice(-60) : [],
    };
}

export function effectiveClueProgress(clueOps, chat) {
    let out = { focus: '', paused: !1, overrides: {}, factOverrides: {}, log: [] },
        valid = (clueOps.ops || []).filter((op) => anchorValid(op.at, chat));
    for (let op of valid) {
        // 暂停主线：单一开关，最后一条有效的说了算。和其它人工操作一样锚定楼层，删楼 / 换回复版本后跟着回滚。
        if (op.kind === 'pause') {
            out.paused = !!op.value;
            continue;
        }
        // 焦点是单一寄存器：设焦点 / 清除人工焦点都是绝对写入，最后一条有效的说了算。
        if (op.kind === 'focus') {
            out.focus = op.value ? op.target : '';
            continue;
        }
        if (op.kind === 'fact') {
            op.value
                ? (out.factOverrides[op.target] = { status: op.value, text: String(op.text || '') })
                : delete out.factOverrides[op.target];
            continue;
        }
        let cur = { ...(out.overrides[op.target] || {}) };
        (op.kind === 'skip' ? (op.value ? (cur.skip = !0) : delete cur.skip) : op.value ? (cur[op.kind] = op.value) : delete cur[op.kind],
            Object.keys(cur).length ? (out.overrides[op.target] = cur) : delete out.overrides[op.target]);
    }
    return out;
}

export function addClueOp(clueOps, chat, op, now = Date.now()) {
    let entry = {
        id: makeId('o'),
        kind: op.kind,
        target: String(op.target),
        value: op.value ?? '',
        text: op.text ? String(op.text) : void 0,
        note: op.note ? String(op.note) : void 0,
        at: anchorOf(chat),
        time: now,
    };
    for (let key of Object.keys(entry)) entry[key] === void 0 && delete entry[key];
    return { ...clueOps, ops: compactClueOps([...(clueOps.ops || []), entry]) };
}

export function opSlot(op) {
    return op.kind === 'focus' || op.kind === 'pause' ? op.kind : `${op.kind}:${op.target}`;
}

export function sameAnchor(a, b) {
    return !!a && !!b && a.i === b.i && a.swipe === b.swipe && a.stamp === b.stamp;
}

export function compactClueOps(ops) {
    let out = [];
    for (let op of ops) {
        let slot = opSlot(op);
        ((out = out.filter((prev) => !(opSlot(prev) === slot && sameAnchor(prev.at, op.at)))), out.push(op));
    }
    return out;
}

export function diffClueStatus(prev, next) {
    let changes = [];
    for (let [uid, status] of Object.entries(next))
        prev && prev[uid] !== void 0 && prev[uid] !== status && changes.push({ uid, from: prev[uid], to: status });
    return changes;
}
