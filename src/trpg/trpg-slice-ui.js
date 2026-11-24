// 跑团「原文切片」管理（模组页「⋯」里进入）：开关、查看与启停、改挂靠、给导入过的模组补全原文。逻辑在 trpg-slices.js。
import { esc, menuDialog, openDialog } from '../ui/dom.js';
import { toast } from '../host/st.js';
import { clueNodes } from './trpg-clue-model.js';
import { SLICE_KINDS, ALIGN_BATCH, attachSlices, alignNodes, alignMessages, parseAlign, alignChanges } from './trpg-slices.js';
import { ask, runTask } from '../ui/ai.js';
import { splitStageKey } from '../core/outline.js';

const slicesOf = (project) => (project.trpg && project.trpg.slices) || [];

function save(view, fn) {
    view.data.updateProject(view.projectId, (p) => (p.trpg ? { ...p, trpg: { ...p.trpg, ...fn(p.trpg) } } : p));
}

function listHtml(project) {
    let nodes = clueNodes(project.outline.volumes).filter((n) => n.uid),
        name = (uid) => (nodes.find((n) => n.uid === uid) || {}).name || '',
        opt = (cur) => `<option value="">未挂靠</option>${nodes.map((n) => `<option value="${esc(n.uid)}"${n.uid === cur ? ' selected' : ''}>${esc(n.name)}</option>`).join('')}`,
        row = (s) => `<div class="pi-sl-row" data-sl="${esc(s.id)}"><label class="pi-check"><input type="checkbox" data-sl-on${s.off ? '' : ' checked'}><span>${esc(s.who ? `${s.who}：` : '')}${esc(s.kind === 'seed' || s.kind === 'taboo' ? `${s.hint}（原文：${s.text}）` : s.text)}</span></label>
            <select class="pi-inp" data-sl-node>${opt(s.node)}</select></div>`;
    return Object.entries(SLICE_KINDS)
        .map(([kind, label]) => {
            let list = slicesOf(project).filter((s) => s.kind === kind);
            return list.length ? `<h5>${esc(label)}（${list.length}）</h5>${list.map(row).join('')}` : '';
        })
        .join('') || '<p class="pi-hint">还没有切片。</p>';
}

async function showList(view) {
    let project = view.project();
    if (!slicesOf(project).length) return toast('info', '还没有切片。可以先「补全原文」。');
    let got = await openDialog({
        title: '原文切片',
        html: `<p class="pi-hint">取消勾选的不再注入。切片挂在哪个节点，只有那个节点进行中才会给出。原文不能改。</p>${listHtml(project)}`,
        actions: [
            { label: '取消', value: null },
            {
                label: '保存',
                primary: !0,
                value: (root) => [...root.querySelectorAll('[data-sl]')].map((r) => ({ id: r.dataset.sl, off: !r.querySelector('[data-sl-on]').checked, node: r.querySelector('[data-sl-node]').value })),
            },
        ],
    });
    if (!got) return;
    let by = new Map(got.map((x) => [x.id, x])),
        nodes = clueNodes(project.outline.volumes);
    save(view, (t) => ({
        slices: (t.slices || []).map((s) => {
            let x = by.get(s.id);
            return x ? { ...s, off: x.off, node: x.node, stage: x.node ? (nodes.find((n) => n.uid === x.node) || { unit: { id: '' } }).unit.id : '' } : s;
        }),
    }));
    toast('success', '已保存。');
}

// AI 核对挂靠：把切片和节点清单交给 AI，给每条选最合适的节点；和现在不同的列出来，勾选确认后才改。
async function alignCheck(view) {
    let project = view.project(),
        list = slicesOf(project).filter((s) => !s.off),
        nodes = alignNodes(project.outline.volumes, (key) => splitStageKey(key).short);
    if (!list.length || !nodes.length) return toast('info', list.length ? '模组里还没有可挂靠的节点。' : '还没有切片。');
    let items = [];
    try {
        await runTask(view, 'kp-slices', async () => {
            for (let i = 0; i < list.length; i += ALIGN_BATCH) {
                let reply = await ask(view, 'outline', alignMessages({ slices: list.slice(i, i + ALIGN_BATCH), nodes }));
                if (reply == null) throw new Error('已取消');
                items.push(...parseAlign(reply));
            }
        });
    } catch (error) {
        return toast('error', `核对失败：${error.message}`);
    }
    let changes = alignChanges(list, items, nodes);
    if (!changes.length) return toast('success', `已核对${list.length}条切片，挂靠都对得上。`);
    let nameOf = (uid) => (nodes.find((n) => n.uid === uid) || {}).name || '未挂靠',
        byId = new Map(list.map((s) => [s.id, s])),
        got = await openDialog({
            title: `核对结果：${changes.length}条建议调整`,
            html: `<p class="pi-hint">已核对${list.length}条，下面这些 AI 认为挂的节点不对。勾选的会改，不勾的保持不变。</p>${changes
                .map((c) => {
                    let s = byId.get(c.id);
                    return `<label class="pi-check"><input type="checkbox" data-al="${esc(c.id)}" checked><span>${esc(SLICE_KINDS[s.kind])}：${esc((s.who ? `${s.who}：` : '') + (s.kind === 'seed' || s.kind === 'taboo' ? s.hint : s.text).slice(0, 40))}<br>${esc(nameOf(c.from))} → ${esc(nameOf(c.to))}${c.why ? `（${esc(c.why)}）` : ''}</span></label>`;
                })
                .join('')}`,
            actions: [
                { label: '取消', value: null },
                { label: '应用勾选的', primary: !0, value: (root) => [...root.querySelectorAll('[data-al]:checked')].map((e) => e.dataset.al) },
            ],
        });
    if (!got || !got.length) return;
    let pick = new Map(changes.filter((c) => got.includes(c.id)).map((c) => [c.id, c.to])),
        stageOf = (uid) => (clueNodes(project.outline.volumes).find((n) => n.uid === uid) || { unit: { id: '' } }).unit.id;
    save(view, (t) => ({ slices: (t.slices || []).map((s) => (pick.has(s.id) ? { ...s, node: pick.get(s.id), stage: pick.get(s.id) ? stageOf(pick.get(s.id)) : '' } : s)) }));
    toast('success', `已调整${pick.size}条挂靠。`);
    view.renderBody();
}

export const sliceActions = {
    async 'kp-slices'(view) {
        let project = view.project(),
            list = slicesOf(project),
            off = !!(project.trpg && project.trpg.sliceOff),
            loose = list.filter((s) => !s.node).length,
            pick = await menuDialog({
                title: '原文切片',
                items: [
                    { label: off ? '使用原文切片：关（点这里打开）' : '使用原文切片：开（点这里关闭）', value: 'toggle' },
                    { label: `查看和调整切片（共${list.length}条${loose ? `，${loose}条未挂靠` : ''}）`, value: 'list' },
                    { label: '补全原文（读导入过的模组原文）', value: 'fill' },
                    { label: '重新挂靠未挂靠的', value: 'attach' },
                    { label: '让 AI 核对挂靠是否对准模组', value: 'align' },
                ],
            });
        if (pick === 'toggle') {
            save(view, (t) => (t.sliceOff ? { sliceOff: void 0 } : { sliceOff: !0 }));
            (toast('success', off ? '已打开原文切片。' : '已关闭原文切片，之后不再注入、不再检测伏笔。'), view.renderBody());
        } else if (pick === 'list') await showList(view);
        else if (pick === 'attach') {
            let fixed = attachSlices(list, project.outline.volumes);
            save(view, () => ({ slices: fixed }));
            toast('success', `已重新挂靠，还有${fixed.filter((s) => !s.node).length}条没找到对应节点。`);
        } else if (pick === 'align') await alignCheck(view);
        else if (pick === 'fill') {
            toast('info', '正在读取模组原文并补全，可能要一会儿…');
            let r = await import('./trpg-long-import-ui.js').then((m) => m.backfillSlices(view)).catch((e) => ({ error: e.message }));
            view.renderBody();
            if (r.error) return toast('error', `补全原文失败：${r.error}`);
            toast(r.jobs ? 'success' : 'warning', r.jobs ? `已读取${r.jobs}份模组原文，现在共有${r.slices}条切片。` : `没有找到可用的模组原文${r.gone ? '（导入任务的原文已被删除）' : '。只有用 PDF 导入过的跑团模组才能补全'}。`);
            // 补全之后接着让 AI 核对一遍挂靠，对不上的列出来确认
            r.jobs && r.slices && (await alignCheck(view));
        }
    },
};
