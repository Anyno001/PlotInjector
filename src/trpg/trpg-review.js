// 跑团模组导入的审阅页「AI 检查」（core/trpg.js）。只有带 trpg 的导入任务才显示按钮；
// 查出来的问题追加进各页「意见」，后面照旧由作者点「按意见修改」。
import { trpgReviewMessages, parseReviewReply, AI_CHECK_TAG } from './trpg.js';
import { appendComment, sourceExcerpt } from './trpg-long-import.js';
import { unitValue } from '../core/review-draft.js';
import { stageLabel, stageNodes } from '../core/outline.js';
import { nodeUid } from './trpg-clue-model.js';
import { stringifyYaml } from '../core/yaml.js';
import { ask } from '../ui/ai.js';
import { toast } from '../host/st.js';

const WHOLE_MAX = 3e4;

export function trpgReviewButton(view, job) {
    if (!job || !job.trpg) return '';
    let busy = view.busy[`trpg-check:${job.id}`];
    return `<div class="pi-tools is-c1"><button type="button" class="pi-btn is-sm" data-act="rv-ai-check"${busy ? ' disabled' : ''}>${busy ? '<span class="pi-spin"></span>AI检查中' : 'AI检查（对照模组原文）'}</button></div>`;
}

// current、saveReview、reviewUnits、lineLocked 由审阅页传进来，不在这里重写审阅的状态管理。
export function trpgReviewActions({ current, saveReview, reviewUnits, lineLocked }) {
    return {
        async 'rv-ai-check'(view) {
            let c = current(view);
            if (!c || !c.job.trpg) return;
            let key = `trpg-check:${c.job.id}`;
            if (view.busy[key]) return;
            view.busy[key] = !0;
            view.renderBody();
            try {
                let project = view.project(),
                    review = c.review,
                    notes = review.notes || {},
                    units = reviewUnits(project, review).filter((u) => u.kind !== 'line' && !lineLocked(review, u.volumeId, project)),
                    src = String((await view.data.imports.source(c.jobId).catch(() => '')) || ''),
                    whole = src.length <= WHOLE_MAX ? src : '',
                    list = units.map((u) => {
                        let v = unitValue(review.draft, u.key),
                            n = v && v.data ? stageNodes(v.data).map((x) => notes[nodeUid(x.item)]).find((x) => x && x.起 != null) : null;
                        return { key: u.key, label: v ? stageLabel(v.key) : u.key, yaml: v ? stringifyYaml({ [v.key]: v.data }) : '', source: !whole && n && src ? sourceExcerpt(src, n.起, n.止) : '' };
                    });
                if (!list.length) return toast('info', '没有可以检查的阶段。');
                let found = parseReviewReply(await ask(view, 'outline', trpgReviewMessages({ units: list, whole })), list.length),
                    pages = Object.keys(found).length,
                    lines = Object.values(found).flat().length;
                if (!lines) return toast('success', 'AI检查没有发现问题。');
                await saveReview(view, c.jobId, (r) => {
                    let comments = { ...r.comments };
                    for (let [i, items] of Object.entries(found)) for (let x of items) comments[list[i].key] = appendComment(comments[list[i].key], `${AI_CHECK_TAG}${x}`);
                    return { ...r, comments };
                });
                toast('info', `AI检查找到${lines}个问题（${pages}页），已加入各页意见。看过、删掉不同意的，再点「按意见修改」。`);
            } catch (error) {
                toast('error', `AI检查失败：${(error && error.message) || error}`);
            } finally {
                ((view.busy[key] = !1), view.renderBody());
            }
        },
    };
}
