// 跑团模组导入时，在后台把模组原文整理成设定里的「KP规则:」分块（core/trpg.js）。
// 和线索大纲的导入任务并行、互不等待；结果合并进项目设定（只换 KP规则 这一块，其他分块不动）。
import { splitLongText } from './trpg-long-import.js';
import { mergeBlocks } from '../core/setting.js';
import { kpRulesMessages, kpMergeMessages, kpBlockText, KP_BLOCK } from './trpg.js';
import { ask } from '../ui/ai.js';
import { toast } from '../host/st.js';

const running = new Set();

export async function runKpRules(view, projectId, text) {
    if (running.has(projectId)) return toast('info', 'KP规则还在整理中。');
    running.add(projectId);
    try {
        let parts = splitLongText(text, { target: 12e3, overlap: 200 }),
            pieces = [];
        for (let part of parts) {
            let reply = String((await ask(view, 'setting', kpRulesMessages({ part, total: parts.length }))) || '').trim();
            reply && pieces.push(reply);
        }
        if (!pieces.length) return toast('warning', 'KP规则没有整理出内容，可以到设定页手动补。');
        let merged = pieces.length > 1 ? String((await ask(view, 'setting', kpMergeMessages(pieces))) || '').trim() || pieces.join('\n\n') : pieces[0],
            block = kpBlockText(merged);
        if (!block) return toast('warning', 'KP规则没有整理出内容，可以到设定页手动补。');
        view.data.updateProject(projectId, (p) => {
            let old = (p.setting && p.setting.text) || '';
            return { ...p, setting: { ...p.setting, text: old.trim() ? mergeBlocks(old, block, [KP_BLOCK]) : block } };
        });
        toast('success', 'KP规则已整理进设定（「KP规则」分块）。');
    } catch (error) {
        toast('error', `KP规则整理失败：${(error && error.message) || error}`);
    } finally {
        running.delete(projectId);
    }
}
