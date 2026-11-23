import { isPlainObject, makeId } from './outline.js';

export const CLUE_OP_KINDS = ['open', 'done', 'skip', 'fact', 'focus', 'pause', 'line'];

export function anchorOf(chat, index) {
    let list = Array.isArray(chat) ? chat : [],
        i = Number.isInteger(index) && index >= 0 && index < list.length ? index : list.length - 1,
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
    let out = { focus: '', paused: !1, sidePaused: !1, mainPaused: !1, overrides: {}, factOverrides: {}, lines: {}, log: [] },
        valid = (clueOps.ops || []).filter((op) => anchorValid(op.at, chat));
    for (let [seq, op] of valid.entries()) {
        if (op.kind === 'line') {
            let cur2 = { ...(out.lines[op.target] || {}) };
            (op.value === 'start'
                ? ((cur2.started = !0),
                  (cur2.evidence = String(op.text || '')),
                  (cur2.how = String(op.note || '')),
                  (cur2.startAt = op.at ? op.at.i : -1),
                  delete cur2.state)
                : op.value === 'deny'
                  ? ((cur2.denied = [...(cur2.denied || []), String(op.text || '')]),
                    cur2.started &&
                        cur2.evidence === String(op.text || '') &&
                        (delete cur2.started, delete cur2.evidence, delete cur2.how, delete cur2.startAt))
                  : op.value === 'skip'
                    ? ((cur2.skipAt = seq), (cur2.skipFloor = op.at ? op.at.i : -1))
                    : op.value === 'resume'
                      ? delete cur2.state
                      : op.value
                        ? (cur2.state = op.value)
                        : (delete cur2.state, delete cur2.started, delete cur2.evidence, delete cur2.how, delete cur2.startAt),
                Object.keys(cur2).length ? (out.lines[op.target] = cur2) : delete out.lines[op.target]);
            continue;
        }
        if (op.kind === 'pause') {
            // target：side 暂停全部支线；mains 暂停全部主线；其他（含旧记录的 main）暂停整个剧情
            op.target === 'side' ? (out.sidePaused = !!op.value) : op.target === 'mains' ? (out.mainPaused = !!op.value) : (out.paused = !!op.value);
            continue;
        }
        if (op.kind === 'focus') {
            ((out.focus = op.value ? op.target : ''),
                (out.focusSceneAt = op.value && op.sceneAt !== void 0 ? String(op.sceneAt) : void 0),
                (out.focusAt = op.value ? op.at : null));
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
        sceneAt: op.sceneAt !== void 0 ? String(op.sceneAt) : void 0,
        at: anchorOf(chat, op.atIndex),
        time: now,
    };
    for (let key of Object.keys(entry)) entry[key] === void 0 && delete entry[key];
    return { ...clueOps, ops: compactClueOps([...(clueOps.ops || []), entry]) };
}

export function opSlot(op) {
    return op.kind === 'focus'
        ? op.kind
        : op.kind === 'pause'
          ? `pause:${op.target === 'side' ? 'side' : op.target === 'mains' ? 'mains' : 'main'}`
          : op.kind === 'line'
            ? `line:${op.target}:${['start', 'deny', 'skip'].includes(op.value) ? op.value : 'state'}`
            : `${op.kind}:${op.target}`;
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

export const STAY_KEEP = 60;

export function stayEntry(chat, index, info) {
    let msg = chat[index];
    return msg && !msg.is_user
        ? {
              i: index,
              swipe: Number(msg.swipe_id) || 0,
              stamp: String(msg.send_date ?? ''),
              key: String(info.key || ''),
              score: Number(info.score) || 0,
              paused: !!info.paused,
              ...(info.scene !== void 0 ? { scene: String(info.scene) } : {}),
          }
        : null;
}

export function focusTakenOver(clueProg, stays, chat, cellNow) {
    if (!clueProg.focus || clueProg.focusSceneAt === void 0) return !1;
    let at = clueProg.focusAt ? clueProg.focusAt.i : -1,
        was = clueProg.focusSceneAt;
    return cellNow !== void 0 && cellNow !== was
        ? !0
        : validStays(stays, chat).some((x) => x && x.i > at && x.scene !== void 0 && x.scene !== was);
}

export function addStay(list, entry) {
    return entry
        ? [...(Array.isArray(list) ? list : []).filter((x) => x.i !== entry.i || x.swipe !== entry.swipe), entry]
              .sort((a, b) => a.i - b.i)
              .slice(-STAY_KEEP)
        : Array.isArray(list)
          ? list
          : [];
}

export function validStays(list, chat) {
    let by = /* @__PURE__ */ new Map();
    for (let x of Array.isArray(list) ? list : []) {
        let msg = chat[x.i];
        msg && !msg.is_user && (Number(msg.swipe_id) || 0) === x.swipe && String(msg.send_date ?? '') === x.stamp && by.set(x.i, x);
    }
    let out = [];
    for (let i = chat.length - 1; i >= 0; i--) {
        let msg = chat[i];
        if (!(!msg || msg.is_user)) {
            if (!by.has(i)) {
                out.push(null);
                continue;
            }
            out.push(by.get(i));
        }
    }
    return out;
}

export function stayState(list, chat, { key, score = 0, paused = !1 }) {
    let rows = validStays(list, chat),
        out = { rounds: 1, since: -1, idle: 0, resumed: null };
    if (paused) return out;
    let p = 0;
    for (let x of rows) {
        if (!x || !x.paused) break;
        p++;
    }
    if ((p && (out.resumed = { rounds: p }), !key)) return out;
    let later = score,
        progressed = !1;
    out.idle = 1;
    for (let x of rows.slice(p)) {
        if (!x || x.key !== key || x.paused) break;
        (out.rounds++, (out.since = x.i), progressed || (x.score < later ? (progressed = !0) : out.idle++), (later = x.score));
    }
    return (rows[p] && rows[p].key === key && rows[p].score < score && (out.idle = 0), out);
}

export function stayBand(n) {
    return n >= 7 ? 2 : n >= 4 ? 1 : 0;
}

export const STAY_WORDS = {
    long: ['', '有一阵了', '写了很久'],
    idle: ['最近一直有新的', '最近几轮没有新的', '很久没有新的'],
    paused: ['停了一会儿', '停了一阵', '停了很久'],
};

export function stayText(st, kind) {
    if (!st) return '';
    let lines = [],
        ask = [],
        long = stayBand(st.rounds),
        from = st.since >= 0 ? `从第 ${st.since} 楼开始，` : '';
    if (st.resumed) {
        let b = stayBand(st.resumed.rounds);
        (lines.push(`- 刚恢复：${STAY_WORDS.paused[b]}（暂停了 ${st.resumed.rounds} 条回复）`),
            ask.push(
                `结合前文，以及本次提供的过去记忆（如果有）接着写。暂停期间发生的事照常算；${kind === 'clue' ? '这一场' : '剧情'}按现在的情况自然接上，不用急着补回来。`,
            ));
    }
    if (long)
        if (
            (lines.push(`- 写了多久：${STAY_WORDS.long[long]}（${from}这是这一${kind === 'clue' ? '场' : '段'}的第 ${st.rounds} 条回复）`),
            kind === 'clue')
        ) {
            let ib = st.idle >= 7 ? 2 : st.idle >= 4 ? 1 : 0;
            (lines.push(
                `- 发现：${STAY_WORDS.idle[ib]}（${ib ? `连续 ${st.idle} 条回复没有新增或核实的发现` : '最近几条回复里有新增或核实的发现'}）`,
            ),
                ask.push(
                    st.resumed ? '' : '结合前文接着写。',
                    `如果环境和人物前面已经交代过，就不必从头再写；说过的话、发生过的事，不要再写一遍。${ib ? '如果用户最近在聊别的、做别的，就跟着用户写，不必每轮把话题引回下面的发现；人物可以带着这件事做别的。等用户提起或采取相应的行动，再接着写。' : ''}`,
                ));
        } else ask.push(st.resumed ? '' : '结合前文接着写。', '如果场景和人物前面已经交代过，就不必再铺陈；已经写过的事件，不要再写一遍。');
    return lines.length
        ? [`【这一${kind === 'clue' ? '场' : '段'}到现在】`, ...lines, ask.filter(Boolean).join('')].join(`
`)
        : '';
}
