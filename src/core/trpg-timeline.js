// 跑团模式的模组时间线：从设定里的「KP规则:」读出带钟点的事件，按游戏内时间推进，到点提醒正文。纯逻辑。
import { splitBlocks } from './setting.js';
import { KP_BLOCK } from './trpg.js';
import { readCell } from './clue-tables.js';

const PERIOD = '凌晨|清晨|早上|早晨|上午|中午|下午|傍晚|晚上|夜里|夜晚|深夜';
const CLOCK_SRC = `(${PERIOD})?\\s*(\\d{1,2})(?:[:：](\\d{2})|点(半|(\\d{1,2})分?)?|时)`;

function toMinutes(period, h, m) {
    h = Number(h);
    m = Number(m) || 0;
    if (h > 24 || m > 59) return null;
    if (/下午|傍晚|晚上|夜里|夜晚/.test(period || '') && h < 12) h += 12;
    else if (period === '深夜' && h >= 6 && h < 12) h += 12;
    else if (period === '凌晨' && h === 12) h = 0;
    return (h % 24) * 60 + m;
}

function minutesOf(match) {
    let [, period, h, hm, half, dm] = match;
    return toMinutes(period, h, hm != null ? hm : half === '半' ? 30 : dm || 0);
}

export function clockText(minutes) {
    let t = ((minutes % 1440) + 1440) % 1440;
    return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

// 表格里的时间值 → 当天分钟数；取最后一个钟点
export function readClock(value) {
    let text = (Array.isArray(value) ? value.join(' ') : value == null ? '' : String(value)).trim(),
        last = null;
    for (let m of text.matchAll(new RegExp(CLOCK_SRC, 'g'))) {
        let v = minutesOf(m);
        v != null && (last = v);
    }
    return last;
}

// 按绑定的时间路径（字符串或数组）读表格；读不到返回 null
export function readGameClock(tables, paths) {
    for (let path of [].concat(paths || []).filter(Boolean)) {
        let cell = readCell(tables || {}, path);
        if (cell.state === 'ok') {
            let v = readClock(cell.value);
            if (v != null) return v;
        }
    }
    return null;
}

// 设定文字 → [{ minutes, clock, text }]；minutes 跨午夜后继续递增（可能 >= 1440）
export function parseTimeline(settingText) {
    let block = splitBlocks(settingText).find((b) => b.title === KP_BLOCK && !b.cont),
        out = [];
    if (!block) return out;
    let inSection = !1,
        day = 0,
        last = -1;
    for (let line of block.text.split('\n')) {
        let head = /^\s*【([^】]+)】\s*$/.exec(line);
        if (head) {
            inSection = head[1].trim() === '时间线';
            continue;
        }
        if (!inSection) continue;
        let m = new RegExp(`^\\s*-\\s*${CLOCK_SRC}`).exec(line);
        if (!m) continue;
        let base = minutesOf(m);
        if (base == null) continue;
        let minutes = base + day * 1440;
        while (minutes < last) ((day += 1), (minutes += 1440));
        last = minutes;
        out.push({ minutes, clock: clockText(minutes), text: line.slice(m[0].length).replace(/^[\s:：,，、\-—]+/, '').trim() });
    }
    return out.filter((e) => e.text);
}

// 已经到点的事件：(prev, now]；时间往回跳（重掷、改表）不算到点，越过午夜按顺延算
export function dueEvents(events, prev, now) {
    if (!events.length || prev == null || now == null) return [];
    let end = now;
    if (end < prev) {
        if (prev - end < 720) return [];
        end += 1440;
    }
    let hit = (t) => t > prev && t <= end;
    return events.filter((e) => hit(e.minutes) || (e.minutes >= 1440 && hit(e.minutes - 1440)) || hit(e.minutes + 1440));
}

export function timelineLines(due, now) {
    return due.length
        ? [
              `模组时间线：现在 ${clockText(now)}。以下事件已经到点，这一轮或下一轮要让它发生（写法可以随玩家行动调整，不能取消）：`,
              ...due.map((e) => `- ${e.clock} ${e.text}`),
          ]
        : [];
}

// 每次投影调用：返回 { lines, next }；next 是该写进 progress 的新时钟（没变化为 null）。
// clock = { floor, minutes, from }：floor 楼首次看到的时间 minutes，from 是上一楼的时间；同一楼重复投影（重掷）区间不变。
export function timelineStep({ events, now, clock, floors }) {
    if (!events.length || now == null) return { lines: [], next: null };
    let c = clock && Number.isFinite(clock.minutes) ? clock : null,
        from = !c ? null : c.floor < floors ? c.minutes : c.floor === floors ? (c.from ?? null) : null;
    return {
        lines: timelineLines(dueEvents(events, from, now), now),
        next: !c || c.floor !== floors ? { floor: floors, minutes: now, from } : null,
    };
}
