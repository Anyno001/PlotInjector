import { compileClue } from '../core/clue-rules.js';
import { outlineRefText } from '../core/clue-project.js';
import { outlineToText, volumeShowName } from '../core/outline.js';
import { currentIndex } from '../core/progress.js';
import { esc, openDialog } from './dom.js';

// 大纲参考：讨论页参考栏和「AI 写新剧情线」弹窗共用 refs.outline / refs.lines。
// 单线、没写「线:」的老项目：「大纲」照旧是开关，附整份大纲。
// 多线项目：点「大纲」打开选线框；勾选的线附完整内容，其余只附简介、节点编号和事实编号。

export function outlineMulti(project) {
    let vols = (project && project.outline.volumes) || [];
    return vols.length > 1 && compileClue(vols).lines.length > 0;
}

// 还没选过时默认正在玩的线（当前聊天启用的就是这个项目时）。
export function defaultLines(view, project) {
    if (view.runtime.activeId() !== view.projectId) return [];
    let c = view.runtime.clue && view.runtime.clue.compute ? view.runtime.clue.compute() : null,
        on = c && c.state && c.state.lineStates ? c.state.lineStates.filter((s) => s.state === '进行中').map((s) => s.line.volume && s.line.volume.id) : [];
    on = on.filter(Boolean);
    if (on.length) return on;
    // 大纲模式：当前段所在的卷
    let list = view.runtime.units ? view.runtime.units() : [],
        i = list.length ? currentIndex(list, view.runtime.progress()) : -1;
    return i >= 0 && list[i].volume && list[i].volume.id ? [list[i].volume.id] : [];
}

export function chosenLines(view, project, refs) {
    let ids = new Set(project.outline.volumes.map((v) => v.id)),
        pick = Array.isArray(refs.lines) ? refs.lines : defaultLines(view, project);
    return pick.filter((id) => ids.has(id));
}

// 按钮文字：没开「大纲」／「大纲 M1」／「大纲 M1、M2」／「大纲 M1 等 3 条」／「大纲 只附简介」
export function outlineChipLabel(view, project, refs) {
    if (!refs.outline || !outlineMulti(project)) return '大纲';
    let names = chosenLines(view, project, refs).map((id) => lineShort(project.outline.volumes.find((v) => v.id === id)));
    return names.length ? `大纲${names.length > 2 ? `${names[0]}等${names.length}条` : names.join('、')}` : '大纲 只附简介';
}

function lineShort(v) {
    let id = v && v.line && String(v.line.编号 || '').trim();
    return id || volumeShowName(v);
}

const STATE_BADGE = { 进行中: 'is-ok', 完成: '', 可开启: 'is-accent' };

// 选线框：返回 { outline, lines } 或 null（取消）
export async function pickOutlineLines(view, project, refs) {
    let vols = project.outline.volumes,
        c = view.runtime.activeId() === view.projectId && view.runtime.clue && view.runtime.clue.compute ? view.runtime.clue.compute() : null,
        stateOf = new Map(((c && c.state && c.state.lineStates) || []).map((s) => [s.line.volume && s.line.volume.id, s.state])),
        size = new Map(vols.map((v) => [v.id, outlineToText([v]).length])),
        picked = new Set(chosenLines(view, project, refs)),
        k = (n) => (n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n)),
        rows = vols
            .map((v) => {
                let st = stateOf.get(v.id) || '';
                return `<label class="pi-wb-row pi-ol-row"><input type="checkbox" data-ol-id="${esc(v.id)}"${picked.has(v.id) ? ' checked' : ''}>
                <span class="pi-wb-title">${esc(volumeShowName(v))}</span>${st ? `<span class="pi-badge ${STATE_BADGE[st] || ''}">${esc(st)}</span>` : ''}<span class="pi-meta">${k(size.get(v.id))}字</span></label>`;
            })
            .join('');
    return openDialog({
        title: '附带大纲',
        html: `<div class="pi-pace-cell pi-ol-sw"><span>附带大纲</span><button type="button" class="pi-switch${refs.outline ? ' is-on' : ''}" role="switch" aria-checked="${!!refs.outline}" data-ol-on></button></div>
            <div class="pi-ref-top"><span class="pi-hint">完整内容</span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-ol-all="1">全选</button><button type="button" class="pi-btn is-sm is-ghost" data-ol-all="0">全不选</button></div>
            <div class="pi-ref-list" data-ol-list>${rows}</div>
            <div class="pi-ol-foot"><span class="pi-hint">未勾选的线仅附简介、节点编号和事实编号</span><span class="pi-hint" data-ol-sum></span></div>`,
        actions: [
            { label: '取消', value: null },
            {
                label: '确定',
                primary: !0,
                value: (box) => ({
                    outline: box.querySelector('[data-ol-on]').classList.contains('is-on'),
                    lines: [...box.querySelectorAll('[data-ol-id]:checked')].map((x) => x.dataset.olId),
                }),
            },
        ],
        onMount(box) {
            let sum = () => {
                let on = box.querySelector('[data-ol-on]').classList.contains('is-on'),
                    ids = [...box.querySelectorAll('[data-ol-id]:checked')].map((x) => x.dataset.olId),
                    n = on ? outlineRefText(vols, ids).text.length : 0;
                box.querySelector('[data-ol-list]').classList.toggle('is-off', !on);
                box.querySelector('[data-ol-sum]').textContent = on ? `约${n >= 1e4 ? `${(n / 1e4).toFixed(1)}万` : n}字` : '不附带';
            };
            box.addEventListener('click', (e) => {
                let sw = e.target.closest('[data-ol-on]');
                if (sw) {
                    let on = !sw.classList.contains('is-on');
                    (sw.classList.toggle('is-on', on), sw.setAttribute('aria-checked', String(on)), sum());
                    return;
                }
                let all = e.target.closest('[data-ol-all]');
                if (all) {
                    box.querySelectorAll('[data-ol-id]').forEach((x) => (x.checked = all.dataset.olAll === '1'));
                    sum();
                }
            });
            box.addEventListener('change', sum);
            sum();
        },
    });
}

// 发给模型的大纲参考：{ title, text, note }。没开「大纲」返回 null。
export function outlineRef(view, project, refs) {
    if (!refs.outline || !project.outline.volumes.length) return null;
    if (!outlineMulti(project)) return { title: '当前大纲', text: outlineToText(project.outline.volumes), note: '' };
    let r = outlineRefText(project.outline.volumes, chosenLines(view, project, refs));
    return {
        title: '当前大纲',
        text: r.text,
        note: `${r.full.length ? `完整附带${r.full.join('、')}` : '无完整附带的线'}${r.brief ? `，其余${r.brief}条附简介` : ''}`,
    };
}
