// 跑团「人物档案」页：人物出现在最近正文里（名字或别名命中）才注入，防止写偏。
// 存在项目的人设线里（沿用关键词触发与注入），这里只给一个精简的编辑界面。
import { confirmDialog, esc, options } from '../ui/dom.js';
import { ICONS } from '../ui/styles.js';
import { estimateTokens } from '../core/tokens.js';
import { newLine, newStage } from '../core/personas.js';
import { splitKeys } from '../core/wbtools.js';
import { PEOPLE_GROUP } from './trpg-people.js';

const st = (view) => view.tabState('persona');
const lines = (view) => (view.project().personas && view.project().personas.lines) || [];

function patchLines(view, fn) {
    view.data.updateProject(view.projectId, (p) => ({ ...p, personas: { ...p.personas, lines: fn((p.personas && p.personas.lines) || []) } }));
    view.runtime.refresh();
}
const patchLine = (view, id, fn) => patchLines(view, (all) => all.map((l) => (l.id === id ? fn(l) : l)));
const textOf = (line) => (line.stages[0] ? line.stages[0].text : '');
const field = (label, body) => `<label class="pi-field"><span>${label}</span>${body}</label>`;

function row(line, open) {
    let a = (f) => `data-tp="${esc(line.id)}" data-f="${f}"`,
        trig = line.constant ? '常驻' : '出场触发';
    return `<div class="pi-entry${line.enabled ? '' : ' is-off'}">
        <div class="pi-entry-hd" data-act="tp-open" data-line="${esc(line.id)}">${open ? ICONS.caretDown : ICONS.caret}
            <span class="pi-etitle">${esc(line.name)}</span><span class="pi-badge">${trig}</span>
            <span class="pi-meta">≈${estimateTokens(textOf(line))}</span>
            <input type="checkbox" title="启用" data-tp-on="${esc(line.id)}"${line.enabled ? ' checked' : ''}></div>
        ${
            open
                ? `<div class="pi-entry-bd">
            <div class="pi-pair">${field('名字', `<input class="pi-inp" ${a('name')} value="${esc(line.name)}">`)}
            ${field('触发方式', `<select class="pi-sel" ${a('constant')}>${options([{ value: '0', label: '名字出现在最近正文里才注入' }, { value: '1', label: '常驻' }], line.constant ? '1' : '0')}</select>`)}</div>
            ${line.constant ? '' : field('触发词（逗号分隔，写名字和别名）', `<input class="pi-inp" ${a('keys')} value="${esc(line.keys.join('，'))}">`)}
            ${field('档案', `<textarea class="pi-ta" rows="9" ${a('text')}>${esc(textOf(line))}</textarea>`)}
            <p class="pi-hint">只写玩家能看到的：外貌、性格、说话方式、对玩家的态度、底线。真实身份和动机放进 KP 规则，别写在这里。</p>
            <div class="pi-tools is-c1 is-end"><button type="button" class="pi-btn is-sm is-danger" data-act="tp-del" data-line="${esc(line.id)}">删除这个人物</button></div></div>`
                : ''
        }</div>`;
}

export function render(view) {
    let all = lines(view),
        open = st(view).open;
    return `<div class="pi-card"><h3>人物档案<span class="pi-meta">${all.length}人</span><span class="pi-spacer"></span>
        <button type="button" class="pi-btn is-sm is-primary" data-act="tp-add">${ICONS.plus}新建人物</button></h3>
        <p class="pi-hint">每个人物一份档案，名字出现在最近几楼正文里时才给写正文的模型，避免人物写偏。导入模组时会自动整理，也可以自己改、自己加。</p>
        ${all.map((l) => row(l, open === l.id)).join('') || '<p class="pi-hint">还没有人物档案。导入模组时会自动生成，也可以手动新建。</p>'}</div>`;
}

export function onChange(view, target) {
    let d = target.dataset;
    if (d.tpOn) {
        patchLine(view, d.tpOn, (l) => ({ ...l, enabled: target.checked }));
        return view.renderBody();
    }
    if (!d.tp) return void 0;
    let v = target.value;
    patchLine(view, d.tp, (l) =>
        d.f === 'name'
            ? { ...l, name: v.trim() || '未命名' }
            : d.f === 'constant'
              ? { ...l, constant: v === '1' }
              : d.f === 'keys'
                ? { ...l, keys: splitKeys(v) }
                : d.f === 'text'
                  ? { ...l, stages: [{ ...(l.stages[0] || newStage('档案')), text: v }, ...l.stages.slice(1)] }
                  : l,
    );
    return view.renderBody();
}

export const actions = {
    'tp-open'(view, target, event) {
        if (event && event.target.closest('input')) return;
        let s = st(view);
        ((s.open = s.open === target.dataset.line ? '' : target.dataset.line), view.renderBody());
    },
    'tp-add'(view) {
        let line = { ...newLine('新人物', PEOPLE_GROUP), constant: !1 };
        (patchLines(view, (all) => [...all, line]), (st(view).open = line.id), view.renderBody());
    },
    async 'tp-del'(view, target) {
        let line = lines(view).find((l) => l.id === target.dataset.line);
        if (!line || !(await confirmDialog({ title: `删除「${line.name}」？`, okLabel: '删除', danger: !0 }))) return;
        (patchLines(view, (all) => all.filter((l) => l.id !== line.id)), view.renderBody());
    },
};
