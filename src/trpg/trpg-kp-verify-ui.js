// 重新核实阶段的确认窗口（手动核实和每 N 层自动核实共用）：列出核实通过的线索和条件让用户勾选，确认才写入。
import { esc, openDialog } from '../ui/dom.js';
import { toast } from '../host/st.js';
import { stageLabel } from '../core/outline.js';

// 核实前后对比阶段：哪些阶段这次结束了，哪些还卡着、还差哪几个必需节点。compute = 线索运行时的 compute
function stageDoneSet(compute) {
    let c = compute();
    return new Set(c ? [...c.state.stageStates].filter(([, s]) => s.done).map(([id]) => id) : []);
}
function stageNote(compute, before) {
    let c = compute();
    if (!c) return '';
    let ended = [],
        stuck = [];
    for (let [id, s] of c.state.stageStates) {
        let name = s.unit && s.unit.stage ? stageLabel(s.unit.stage.key) : id;
        if (s.done && !before.has(id)) ended.push(name);
        else if (!s.done && s.entered.v === 'true')
            stuck.push(s.requiredLeft.length ? `${name}还差${s.requiredLeft.map((n) => `「${n.name || n.uid}」`).join('')}` : `${name}结束条件还没满足`);
    }
    return [ended.length ? `${ended.join('、')}已结束。` : '', stuck.length ? `${stuck.join('；')}（可在节点「⋯」里手动标完成）。` : ''].join('');
}

export const recheckHits = (r) => r.result.facts.filter((f) => f.ok).length + r.result.conds.filter((x) => x.ok).length;

// r = runner.recheck 的返回；kp = runner；compute = 线索运行时的 compute。返回是否写入了
export async function confirmRecheck(r, { kp, compute, title = '重新核实阶段' }) {
    let okFacts = r.result.facts.filter((f) => f.ok),
        okConds = r.result.conds.filter((x) => x.ok),
        miss = [...r.result.facts.filter((f) => !f.ok).map((f) => r.labelOf(f.id)), ...r.result.conds.filter((x) => !x.ok).map((x) => x.text)],
        quote = (q) => (q ? `<p class="pi-hint">「${esc(q)}」</p>` : ''),
        html = `<p class="pi-hint">读了第${r.from}–${r.to}楼。勾选的会写进进度和线索表格。</p>
        ${okFacts.map((f) => `<label class="pi-check"><input type="checkbox" data-kv-f="${esc(f.id)}" checked><span>线索：${esc(r.labelOf(f.id))}</span></label>${quote(f.quote)}`).join('')}
        ${okConds.map((x, i) => `<label class="pi-check"><input type="checkbox" data-kv-c="${i}" checked><span>条件成立：${esc(x.text)}</span></label>${quote(x.quote)}`).join('')}
        ${okFacts.length || okConds.length ? '' : '<p class="pi-hint">这几楼里没找到新拿到的线索或成立的条件。</p>'}
        ${miss.length ? `<details class="pi-fold"><summary>没找到的（${miss.length}，可能剧透）</summary>${miss.map((t) => `<p class="pi-hint">${esc(t)}</p>`).join('')}</details>` : ''}`,
        sel = await openDialog({
            title,
            html,
            actions:
                okFacts.length || okConds.length
                    ? [
                          { label: '取消', value: null },
                          {
                              label: '写入勾选的',
                              primary: !0,
                              value: (root) => ({
                                  facts: [...root.querySelectorAll('[data-kv-f]:checked')].map((b) => b.dataset.kvF),
                                  conds: [...root.querySelectorAll('[data-kv-c]:checked')].map((b) => okConds[Number(b.dataset.kvC)].text),
                              }),
                          },
                      ]
                    : [{ label: '关闭', value: null }],
        });
    if (!sel || (!sel.facts.length && !sel.conds.length)) return !1;
    let before = stageDoneSet(compute),
        done = await kp.applyRecheck(r, sel);
    if (!done) return (toast('info', '聊天或项目已切换，没有写入。'), !1);
    toast('success', `已写入${done.facts}条线索、${done.conds}个条件。${stageNote(compute, before)}`);
    return !0;
}
