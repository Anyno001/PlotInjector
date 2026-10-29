import { esc } from './dom.js';

// 讨论消息用的精简 Markdown：标题、粗斜体、删除线、行内代码、代码块、列表、引用、分割线、表格。
// 先整体转义再加标签，模型输出里的 HTML 一律按文本显示。

function inline(text) {
    const codes = [];
    let out = esc(text).replace(/`([^`]+)`/g, (_, code) => `\u0000${codes.push(code) - 1}\u0000`);
    out = out
        .replace(/\*\*(.+?)\*\*|__(.+?)__/g, (_, a, b) => `<strong>${a ?? b}</strong>`)
        .replace(/(^|[^*])\*(?!\s)(.+?)\*(?!\*)/g, '$1<em>$2</em>')
        .replace(/~~(.+?)~~/g, '<del>$1</del>');
    return out.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${codes[i]}</code>`);
}

const RE = {
    fence: /^\s*(```|~~~)/,
    heading: /^(#{1,6})\s+(.*?)\s*#*\s*$/,
    hr: /^\s*([-*_])(\s*\1){2,}\s*$/,
    quote: /^\s*>\s?/,
    ul: /^(\s*)[-*+]\s+(.*)$/,
    ol: /^(\s*)\d+[.)]\s+(.*)$/,
    tableSep: /^\s*\|?\s*:?-{2,}:?\s*(\|\s*:?-{2,}:?\s*)*\|?\s*$/,
};

const cells = line => line.trim().replace(/^\||\|$/g, '').split('|').map(cell => inline(cell.trim()));

export function renderMarkdown(src) {
    const lines = String(src ?? '').replace(/\r\n?/g, '\n').split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
        const line = lines[i];
        if (!line.trim()) { i += 1; continue; }
        if (RE.fence.test(line)) {
            const mark = line.trim().slice(0, 3);
            const body = [];
            i += 1;
            while (i < lines.length && !lines[i].trim().startsWith(mark)) body.push(lines[i++]);
            i += 1;
            out.push(`<pre class="pi-pre">${esc(body.join('\n'))}</pre>`);
            continue;
        }
        const heading = RE.heading.exec(line);
        if (heading) {
            out.push(`<div class="pi-md-h is-h${Math.min(heading[1].length, 4)}">${inline(heading[2])}</div>`);
            i += 1;
            continue;
        }
        if (RE.hr.test(line)) { out.push('<hr>'); i += 1; continue; }
        if (line.includes('|') && i + 1 < lines.length && RE.tableSep.test(lines[i + 1])) {
            const head = cells(line);
            i += 2;
            const rows = [];
            while (i < lines.length && lines[i].includes('|') && lines[i].trim()) rows.push(cells(lines[i++]));
            out.push(`<div class="pi-md-table"><table><thead><tr>${head.map(cell => `<th>${cell}</th>`).join('')}</tr></thead>
                <tbody>${rows.map(row => `<tr>${row.map(cell => `<td>${cell}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`);
            continue;
        }
        if (RE.quote.test(line)) {
            const body = [];
            while (i < lines.length && RE.quote.test(lines[i])) body.push(lines[i++].replace(RE.quote, ''));
            out.push(`<blockquote>${renderMarkdown(body.join('\n'))}</blockquote>`);
            continue;
        }
        const list = RE.ul.test(line) ? 'ul' : RE.ol.test(line) ? 'ol' : '';
        if (list) {
            const items = [];
            while (i < lines.length && RE[list].test(lines[i])) {
                const [, indent, text] = RE[list].exec(lines[i++]);
                items.push(`<li${indent.length >= 2 ? ' class="is-sub"' : ''}>${inline(text)}</li>`);
            }
            out.push(`<${list}>${items.join('')}</${list}>`);
            continue;
        }
        const para = [];
        while (i < lines.length && lines[i].trim() && !RE.fence.test(lines[i]) && !RE.heading.test(lines[i]) && !RE.hr.test(lines[i])
            && !RE.quote.test(lines[i]) && !RE.ul.test(lines[i]) && !RE.ol.test(lines[i])) para.push(inline(lines[i++]));
        out.push(`<p>${para.join('<br>')}</p>`);
    }
    return out.join('');
}
