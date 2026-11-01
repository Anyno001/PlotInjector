// 无限流状态块：正文 AI 每次回复末尾写
//   <末班车状态>
//   列车：车上 / 停站 / 世界里 / 回到列车
//   污染：档名（数值）        ← 注入器不读
//   </末班车状态>
// 注入器只读「列车」一栏，在「停站」时开副本，在「回到列车」时关副本。纯函数，不改入参。

export const TRAIN_STATES = ['车上', '停站', '世界里', '回到列车'];

// 正文 AI 会自由发挥，所以读得宽松：
// - 标签：容许空格、属性、全角尖括号，缺了收尾标签就读到全文末尾
// - 栏名：列车/位置/状态/所在/车况都认；找不到栏名就读整块（去掉污染那一行）
// - 值：按同义词归到四个状态，前面紧挨着「未/没/不/尚未/还没」的不算
const OPEN_RE = /[<＜]\s*末班车状态[^>＞]*[>＞]/g;
const CLOSE_RE = /[<＜]\s*\/\s*末班车状态\s*[>＞]/;
const LINE_RE = /^[ \t　]*(?:列车|位置|状态|所在|车况)[^:：\n]{0,6}[:：](.*)$/m;
const POLLUTION_LINE = /^[ \t　]*污染[^\n]*$/gm;
const NEGATION = /(?:未|没|不|尚未|还没|还未)$/;

// 顺序即优先级：长的、更具体的在前（「回到车上」先于「车上」）。
const SYNONYMS = [
    ['回到列车', ['回到列车', '回列车', '返回列车', '回到车上', '回车上', '重新上车', '登上列车', '已上车', '上了车']],
    ['停站', ['停站', '到站', '进站', '靠站', '停靠', '下车']],
    ['世界里', ['世界里', '世界中', '在世界', '副本']],
    ['车上', ['列车上', '车上', '餐车', '行驶中']],
];

function hasWord(value, word) {
    let at = value.indexOf(word);
    while (at >= 0) {
        if (!NEGATION.test(value.slice(Math.max(0, at - 2), at))) return true;
        at = value.indexOf(word, at + 1);
    }
    return false;
}

// 按优先级逐组匹配，匹配到的词从文字里抹掉，免得「回到车上」又被「车上」算一次。
// 命中三组及以上，多半是照抄了「车上 / 停站 / 世界里 / 回到列车」模板，不认。
export function classifyTrainValue(value) {
    let text = String(value || '');
    const hits = [];
    for (const [state, words] of SYNONYMS) {
        let hit = false;
        for (const word of words) {
            if (hasWord(text, word)) hit = true;
            text = text.split(word).join('　');
        }
        if (hit) hits.push(state);
    }
    return hits.length && hits.length < 3 ? hits[0] : '';
}

// 取最后一个状态块，归到四个状态之一；读不出来返回 ''。
export function parseTrainState(text) {
    const src = String(text || '');
    const opens = [...src.matchAll(OPEN_RE)];
    if (!opens.length) return '';
    const last = opens[opens.length - 1];
    let body = src.slice(last.index + last[0].length);
    const close = CLOSE_RE.exec(body);
    if (close) body = body.slice(0, close.index);
    const line = LINE_RE.exec(body);
    return classifyTrainValue(line ? line[1] : body.replace(POLLUTION_LINE, ''));
}

// 漏写了中间那一步也认：车上直接写「世界里」算开副本，世界里直接写「车上」算关副本。
const ENTER_STATES = ['停站', '世界里'];
const LEAVE_STATES = ['回到列车', '车上'];

// FNV-1a 32 位，只用来判断「这一楼文字有没有变」。
export function hashText(text) {
    let h = 0x811c9dc5;
    const s = String(text || '');
    for (let i = 0; i < s.length; i += 1) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0');
}

// 该不该动作：车上读到「停站」或「世界里」开副本；世界里读到「回到列车」或「车上」关副本；其余不动。
export function decideTrigger(phase, state) {
    if (phase === 'train' && ENTER_STATES.includes(state)) return 'enter';
    if (phase === 'world' && LEAVE_STATES.includes(state)) return 'leave';
    return '';
}

// 触发记录：kind 是 enter/leave，floor 是触发楼序号，hash 是当时这一楼文字的哈希，worldId 是开/关的那份档案。
export function makeTrigger({ kind, floor, text, worldId = '' }) {
    return { kind, floor: Number(floor), hash: hashText(text), worldId: String(worldId || '') };
}

// 触发楼现在怎么样。text 为 null 表示这一楼已不存在（删楼）。
//   undo：触发楼没了或不再带触发值，需要撤销；
//   same：文字没变；
//   keep：文字变了但仍带触发值，不重复生成，只更新哈希。
export function judgeTrigger(trigger, text) {
    if (!trigger) return 'none';
    if (text == null) return 'undo';
    const want = trigger.kind === 'enter' ? ENTER_STATES : LEAVE_STATES;
    if (!want.includes(parseTrainState(text))) return 'undo';
    return hashText(text) === trigger.hash ? 'same' : 'keep';
}

export function describeRead(read) {
    if (!read) return '最新一楼没有状态块';
    return read.state ? `上次读到：第 ${read.floor} 楼 列车：${read.state}` : '最新一楼没有状态块';
}
