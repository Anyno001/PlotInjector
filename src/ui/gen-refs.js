import { normalizeGenRefs } from '../core/store.js';
import { toast } from '../host/st.js';
import { talkText } from './ai.js';
import { pickRefs, wbRefTexts, wbSummary } from './discuss-refs.js';
import { esc } from './dom.js';

// 设定、大纲页让 AI 写作时带的参考：讨论记录、世界书条目。按项目保存，两页共用一份。
// 没在讨论页聊过也能直接用世界书写设定、写大纲。

const refsOf = project => normalizeGenRefs(project.genRefs);

export function genRefsBar(view, scope) {
    const project = view.project();
    const refs = refsOf(project);
    const chat = view.data.chat(view.projectId);
    if (!chat) view.data.loadChat(view.projectId).then(() => view.renderBody()).catch(() => {});
    const talks = chat ? chat.messages.length + (chat.summary ? 1 : 0) : 0;
    const wb = wbSummary(view, refs, () => view.renderBody(), `gen-${scope}`);
    return `<div class="pi-refs"><span class="pi-hint">参考：</span>
        <button type="button" class="pi-chip${refs.talk && talks ? ' is-on' : ''}" data-act="gen-talk"${talks ? '' : ' disabled title="讨论页还没有记录"'}>讨论记录</button>
        <button type="button" class="pi-chip${wb && wb.count ? ' is-on' : ''}" data-act="gen-wb">世界书 ${wb ? `${wb.count} 条` : '…'}</button></div>`;
}

export async function genRefTexts(view, limit) {
    const refs = refsOf(view.project());
    const talk = refs.talk ? await talkText(view, limit) : '';
    return { talk, wb: await wbRefTexts(refs.wb, refs.memo) };
}

function update(view, patch) {
    view.data.updateProject(view.projectId, project => ({ ...project, genRefs: { ...refsOf(project), ...patch } }));
}

export const genActions = {
    'gen-talk'(view) {
        update(view, { talk: !refsOf(view.project()).talk });
        view.renderBody();
    },
    async 'gen-wb'(view) {
        const result = await pickRefs(refsOf(view.project()), 'AI 写作参考的世界书条目');
        if (!result) return;
        if (result.none) return toast('info', '当前卡没有关联的世界书。');
        update(view, { wb: result.wb, memo: result.memo });
        view.renderBody();
    },
};

