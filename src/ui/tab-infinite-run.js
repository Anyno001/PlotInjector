import { PHASE_LABELS, findWorld } from '../core/infinite.js';
import { describeRead } from '../core/infinite-state.js';
import { estimateTokens } from '../core/tokens.js';
import { confirmDialog, esc } from './dom.js';
import { actions as runActions, activateCard, entryRow, onChange } from './tab-run.js';

// 无限流项目的「执行」页签：当前在车上还是在世界里，两个手动按钮（兜底，平时由正文状态块触发），以及和普通项目同样的注入条目。
export function render(view) {
    const { runtime } = view;
    const project = view.project();
    const st = view.tabState('run');
    const notActive = activateCard(view, project);
    if (notActive) return notActive;
    const state = runtime.infState();
    if (!state) return '<div class="pi-empty"><span class="pi-spin"></span> 正在读取进度…</div>';
    const { inf } = state;
    const world = inf.phase === 'world' ? findWorld(inf.worlds, inf.worldId) : null;
    const entries = runtime.entries();
    const total = entries.filter(entry => entry.enabled).reduce((sum, entry) => sum + estimateTokens(entry.content), 0);
    const opening = runtime.isOpening();
    const book = runtime.injectMode() === 'virtual' ? '' : '<span class="pi-badge is-warn">专用世界书</span>';
    const meta = describeRead(runtime.lastRead());
    return `<div class="pi-card"><h3>当前状态<span class="pi-meta">${esc(meta)}</span></h3>
        <div class="pi-row"><span class="pi-badge is-accent">${PHASE_LABELS[inf.phase]}</span>${world ? `<span class="pi-badge">${esc(world.title)}</span>` : ''}
            <span class="pi-badge">世界库 ${inf.worlds.length} 份</span></div>
        <div class="pi-tools is-c2">
            <button type="button" class="pi-btn is-primary is-sm" data-act="inf-enter"${inf.phase !== 'train' || opening ? ' disabled' : ''}>${opening ? '<span class="pi-spin"></span>造世界' : '进入新世界'}</button>
            <button type="button" class="pi-btn is-sm" data-act="inf-return"${inf.phase !== 'world' ? ' disabled' : ''}>回到列车</button></div></div>
        <div class="pi-card"><h3>注入条目${book}<span class="pi-meta">≈${total} token</span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="preview">预览</button></h3>
        ${entries.length ? entries.map(entry => entryRow(entry, st.open === entry.slotId)).join('') : '<p class="pi-hint">设定和世界库都为空，没有可注入的内容。</p>'}</div>
        ${inf.log.length ? `<div class="pi-card"><h3>近期记录</h3><pre class="pi-pre">${esc(inf.log.slice().reverse().join('\n'))}</pre></div>` : ''}`;
}

export const actions = {
    ...runActions,
    'inf-enter': view => view.runtime.openWorld(),
    async 'inf-return'(view) {
        const ok = await confirmDialog({ title: '回到列车', body: '撤掉当前世界档案的注入，档案留在世界库里。', okLabel: '回到列车' });
        if (!ok) return;
        view.runtime.returnToTrain();
        view.renderBody();
    },
};

export { onChange };
