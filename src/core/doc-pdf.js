// PDF 文字层 → 纯文本（跑团模式计划 §1）。纯函数，不碰 pdf.js：
// 输入 pages = [{ width, height, items: [{ str, x, y, w, h, font, eol }] }]（y 向上，pdf.js 原始坐标），
// 输出 { text, warnings, pages, chars }。
// 默认相信文字层的原始顺序（WPS、Word 导出的 PDF 本来就是阅读顺序）；顺序明显乱的页才按坐标分栏重排。

const CJK = '\\u3000-\\u303f\\u3400-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef\\u2018-\\u201f\\u2026\\u2014';
const CJK_SPACE = new RegExp(`([${CJK}])[ \\u00a0]+(?=[${CJK}])`, 'g');
// 项目符号：常见符号，或排版软件用的私有区字形（WPS 的 Wingdings 圆点会变成 U+F06C 之类）
const BULLET = /^(?:[\uE000-\uF8FF•●▪◆■□◇○·]|-\s)\s*/;
const SENT_END = /[。！？!?…」』”）)：:]$/;
const DOT_LEADER = /[.·…．]{6,}/;
// 标题行末尾不该是这些标点（括号结尾的「PC3：邪教徒（可自定义信仰）」仍算标题）
const HEAD_END = /[。！？!?…，,；;]$/;
// 列表、时间线的行首：17:30、1.、2、、（3）、第二章
const LIST_HEAD = /^(?:\d{1,2}[:：]\d{2}|\d{1,3}[.、．)）]|[（(]\d{1,3}[)）]|第[0-9一二三四五六七八九十百]+[章节条幕])/;

function isCjk(ch) {
    return !!ch && new RegExp(`[${CJK}]`).test(ch);
}

// 同一行里的条目拼起来；宽度只信高度不为 0 的条目（空格条目的宽度常常是乱的）。
function makeLine(items) {
    let solid = items.filter((it) => it.h > 0 && it.str.trim()),
        text = '';
    for (let it of items) text += it.str;
    text = text.replace(/\s+/g, ' ').trim();
    if (!text || !solid.length) return null;
    let x = Math.min(...solid.map((it) => it.x)),
        right = Math.max(...solid.map((it) => it.x + it.w)),
        h = Math.max(...solid.map((it) => it.h)),
        font = solid.reduce((a, b) => (b.str.length > a.str.length ? b : a)).font;
    return { text, x, right, y: solid[0].y, h, font, items: solid };
}

// 按原始顺序切行：遇到换行标记或 y 明显变化就换行。
export function streamLines(items) {
    let lines = [],
        cur = [],
        curY = null,
        flush = () => {
            let line = cur.length ? makeLine(cur) : null;
            (line && lines.push(line), (cur = []), (curY = null));
        };
    for (let it of items || []) {
        if (it.h > 0 && it.str.trim()) {
            if (curY !== null && Math.abs(it.y - curY) > it.h * 0.5) flush();
            curY === null && (curY = it.y);
        }
        cur.push(it);
        it.eol && flush();
    }
    return (flush(), lines);
}

// 原始顺序是否可信：阅读顺序里 y 往上跳只发生在换栏处，跳很多次说明是按别的顺序写的（Affinity 等排版软件）。
// 左右栏来回切换太多次也说明不是阅读顺序（同一高度先写右栏再写左栏）。
export function orderLooksBroken(lines, width = 0) {
    if (lines.length < 6) return !1;
    let jumps = 0,
        switches = 0;
    for (let i = 1; i < lines.length; i++) {
        lines[i].y - lines[i - 1].y > lines[i].h * 2 && jumps++;
        width && Math.abs(lines[i].x - lines[i - 1].x) > width * 0.3 && switches++;
    }
    return jumps > Math.max(3, lines.length * 0.12) || switches > Math.max(4, lines.length * 0.3);
}

// 兜底：按坐标重排。跨过中线的行是通栏，把页面切成若干横带，每条带里先左栏后右栏。
export function coordLines(items, width) {
    let rows = [];
    for (let it of items || []) {
        if (!(it.h > 0 && it.str.trim())) continue;
        let row = rows.find((r) => Math.abs(r.y - it.y) < it.h * 0.5);
        row || rows.push((row = { y: it.y, items: [] }));
        row.items.push(it);
    }
    let mid = width / 2,
        pieces = [];
    for (let row of rows) {
        row.items.sort((a, b) => a.x - b.x);
        let left = [],
            right = [],
            full = [];
        for (let it of row.items)
            it.x < mid - 10 && it.x + it.w > mid + 10 ? full.push(it) : it.x + it.w / 2 < mid ? left.push(it) : right.push(it);
        if (full.length) pieces.push({ y: row.y, col: 'full', items: [...left, ...full, ...right].sort((a, b) => a.x - b.x) });
        else {
            left.length && pieces.push({ y: row.y, col: 'L', items: left });
            right.length && pieces.push({ y: row.y, col: 'R', items: right });
        }
    }
    pieces.sort((a, b) => b.y - a.y);
    let out = [],
        band = [];
    let flushBand = () => {
        for (let col of ['L', 'R']) for (let p of band) p.col === col && out.push(p);
        band = [];
    };
    for (let p of pieces) p.col === 'full' ? (flushBand(), out.push(p)) : band.push(p);
    flushBand();
    return out.map((p) => makeLine(p.items)).filter(Boolean);
}

function norm(text) {
    return text.replace(/\d+/g, '#').replace(/\s+/g, '');
}

// 页眉页脚：在页面上下 8% 内、三页以上重复出现（数字算同一个）的行；以及边上单独的页码。
function marginKeys(pages) {
    let count = new Map();
    for (let p of pages)
        for (let line of new Set(p.lines.filter((l) => inMargin(l, p)).map((l) => norm(l.text))))
            count.set(line, (count.get(line) || 0) + 1);
    return new Set([...count].filter(([, n]) => n >= 3).map(([k]) => k));
}

function inMargin(line, page) {
    return line.y > page.height * 0.92 || line.y < page.height * 0.08;
}

function mode(values) {
    let c = new Map();
    for (let [v, n] of values) c.set(v, (c.get(v) || 0) + n);
    let best = null,
        bn = -1;
    for (let [v, n] of c) n > bn && ((best = v), (bn = n));
    return best;
}

// 下一行开头不可拆开的一段大约多宽：括号/引号整组、英文数字整词；中文按一个字算。
export function leadWidth(text, h) {
    let m = /^[（(“"《【「『][^）)”"》】」』]{0,20}[）)”"》】」』]/.exec(text) || /^[A-Za-z0-9/.%+\-]+/.exec(text),
        chunk = m ? m[0] : text.slice(0, 1);
    let w = 0;
    for (let ch of chunk) w += isCjk(ch) ? h : h * 0.55;
    return w;
}

function joinText(a, b) {
    if (!a) return b;
    let last = a[a.length - 1],
        first = b[0];
    if (/[A-Za-z]-$/.test(a) && /^[a-z]/.test(b)) return a.slice(0, -1) + b;
    return isCjk(last) || isCjk(first) ? a + b : `${a} ${b}`;
}

export function cleanText(text) {
    return text
        .replace(CJK_SPACE, '$1')
        .replace(CJK_SPACE, '$1')
        .replace(/([a-z])([.?!])(?=[A-Z])/g, '$1$2 ')
        .replace(/[ \t]+/g, ' ')
        .trim();
}

export function pdfPagesToText(input, { keepToc = !1 } = {}) {
    let warnings = [],
        pages = (input || []).map((p, i) => {
            let lines = streamLines(p.items);
            if (orderLooksBroken(lines, p.width)) lines = coordLines(p.items, p.width);
            return { no: i + 1, width: p.width, height: p.height, lines };
        });
    let empty = pages.filter((p) => !p.lines.length).map((p) => p.no);
    empty.length && warnings.push(`第 ${empty.join('、')} 页没有文字层（可能是图片或扫描页），没有转出文字。`);
    let toc = pages.filter((p) => p.lines.filter((l) => DOT_LEADER.test(l.text)).length >= 3);
    keepToc || toc.forEach((p) => (p.lines = []));
    let margins = marginKeys(pages);
    for (let p of pages)
        p.lines = p.lines.filter((l) => !(inMargin(l, p) && (margins.has(norm(l.text)) || /^[-—\s]*\d{1,3}[-—\s]*$/.test(l.text))) && !/^[.·…．\s]+$/.test(l.text));
    let all = pages.flatMap((p) => p.lines.map((l) => ({ ...l, page: p })));
    all.forEach((l, i) => (l.i = i));
    if (!all.length) return { text: '', warnings, pages: pages.length, chars: 0 };
    let body = mode(all.map((l) => [Math.round(l.h), l.text.length])),
        bodyFont = mode(all.filter((l) => Math.round(l.h) === body).map((l) => [l.font, l.text.length])),
        // 栏宽 = 同页同左边距最宽的一行
        pageRight = (l) => Math.max(...l.page.lines.filter((o) => Math.abs(o.x - l.x) < l.h * 1.5).map((o) => o.right)),
        lineGap = mode(
            all.slice(1).map((l, i) => {
                let prev = all[i];
                return [prev.page === l.page && prev.y > l.y ? Math.round(prev.y - l.y) : 0, 1];
            }).filter(([g]) => g > 0),
        ) || body * 1.6;
    let kindOf = (l) => {
        let t = l.text;
        if (Math.round(l.h) >= body * 1.3 && t.length <= 30) return 'h1';
        if (BULLET.test(t)) return 'bullet';
        if (/^\d{1,2}$/.test(t)) return 'index';
        if (l.font !== bodyFont && Math.round(l.h) >= body * 0.95 && t.length <= 24 && !HEAD_END.test(t)) return 'h2';
        return 'text';
    };
    let blocks = [],
        cur = null,
        pendingIndex = '',
        prev = null;
    let open = (kind, text, line) => {
        cur = { kind, x: line.x, text: pendingIndex && kind !== 'h1' ? `${pendingIndex}. ${text}` : text };
        pendingIndex = '';
        blocks.push(cur);
    };
    for (let l of all) {
        let kind = kindOf(l);
        if (kind === 'index') {
            pendingIndex = l.text;
            continue;
        }
        let breakHere = !cur || kind !== 'text' || cur.kind === 'h1' || cur.kind === 'h2';
        if (!breakHere && prev) {
            let samePage = prev.page === l.page,
                below = samePage && prev.y > l.y,
                room = pageRight(prev) - prev.right,
                // 绕图排版：栏临时变窄，但上下两行两端对齐（右端齐平），仍是同一段
                rightAligned = (a, b) => a && b && a.page === b.page && a.y > b.y && Math.abs(a.x - b.x) < b.h * 1.5 && Math.abs(a.right - b.right) < b.h * 0.6 && a.right - a.x > b.h * 3.5 && b.right - b.x > b.h * 3.5,
                // 上一行在一段右端对齐的窄行里（和下一行或上上一行对齐）：行尾的空是图片占的，不是作者换行
                justified = rightAligned(prev, l) || rightAligned(all[prev.i - 1], prev),
                short = room > prev.h * 1.5,
                // 行尾空出的位置连下一行开头那个词都放得下 = 作者有意换行（短标题、名单）；放不下才是排版自动折行
                deliberate = room > prev.h * 1.5 + leadWidth(l.text, l.h) && !justified,
                // 上下两行都远没写满、右端又参差不齐 = 一行一项的列表（属性块、名单）；绕图的窄行两端对齐，不算
                ragged = below && !justified && pageRight(prev) - prev.right > prev.h * 3 && pageRight(l) - l.right > l.h * 3 && Math.abs(prev.right - l.right) > l.h * 1.5;
            // 只在有把握时分段：字号变了、同栏段距明显大、上一行没写满且以句末标点结尾、
            // 或上一行没写满而这一行以时间/编号开头（时间线、编号列表）。
            // 「这一行比上一行长」不算：中文排版遇到放不下的括号、英文词会提前换行（如「拉特塔尔」/「（Raathal）」）。
            if (Math.round(prev.h) !== Math.round(l.h)) breakHere = !0;
            else if (below && Math.abs(prev.x - l.x) < l.h * 3 && prev.y - l.y > lineGap * 1.5) breakHere = !0;
            else if (short && SENT_END.test(prev.text)) breakHere = !0;
            else if (short && LIST_HEAD.test(l.text)) breakHere = !0;
            else if ((deliberate || ragged) && !/[，、,；;]$/.test(prev.text)) breakHere = !0;
        }
        // 项目符号的续行会缩进；不缩进的下一行是新段落
        !breakHere && cur.kind === 'bullet' && prev && prev.page === l.page && !(l.x > cur.x + l.h * 0.5) && (breakHere = !0);
        if (breakHere) open(kind, kind === 'bullet' ? l.text.replace(BULLET, '') : l.text, l);
        else cur.text = joinText(cur.text, l.text);
        prev = l;
    }
    let text = blocks
        .map((b) => {
            let t = cleanText(b.text);
            return b.kind === 'h1' ? `# ${t}` : b.kind === 'h2' ? `## ${t}` : b.kind === 'bullet' ? `- ${t}` : t;
        })
        .filter((t) => t.replace(/^[#-]+\s*/, ''))
        .join('\n\n');
    toc.length && !keepToc && warnings.push(`第 ${toc.map((p) => p.no).join('、')} 页像是目录，已略过。`);
    return { text, warnings, pages: pages.length, chars: text.replace(/\s/g, '').length };
}
