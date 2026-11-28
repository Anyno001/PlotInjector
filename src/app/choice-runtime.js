import { choiceRecord, pickSentence, pickEnding, endingRecord, attrValue, CUSTOM } from '../core/choice.js';
import { readCell, cellText } from '../core/clue-tables.js';
import { evalCondition, parseCondition, TRI } from '../core/clue-rules.js';
import { writeRecord } from './choice-log.js';

// 抉择的运行时：待选（只在内存）、发送时提交、标为已处理、收尾。读取一律经 compute().snap.choices。
export const ENDING_SENTENCE = '这段故事就到这里吧。';

export function createChoiceOps({ compute, project, enabled, generating = () => !1, fillBusy = () => !1, chatMessages, chatId, act, invalidate, note, save, getProgress = () => null, setProgress = () => {} }) {
    let pending = null,
        // 本聊天这几轮给过「待决定」材料的抉择（剧情推进判断进场的那一轮，表格还没更新）
        cued = { key: '', set: new Set() };
    const scopeKey = () => `${chatId()}|${(project() || {}).id || ''}`;
    function cue(uid) {
        let k = scopeKey();
        cued.key !== k && (cued = { key: k, set: new Set() });
        cued.set.add(uid);
    }
    const isCued = (uid) => cued.key === scopeKey() && cued.set.has(uid);
    const own = () => {
        let p = project();
        return !!p && !!pending && pending.chatId === chatId() && pending.projectId === p.id;
    };
    const test = (env) => (raw) => evalCondition(parseCondition(raw), env).v === TRI.t;
    const tri = (env) => (cond) => {
        let v = evalCondition(cond, env).v;
        return v === TRI.t ? 'yes' : v === TRI.f ? 'no' : 'unknown';
    };

    // 属性：有路径读表格，没有就用本聊天设的值（存在本项目的进度里，默认 0）
    function attrs(c) {
        let p = project(),
            saved = ((getProgress() || {}).choiceAttrs) || {};
        return ((p && p.clue.attrs) || []).map((a) => {
            if (!a.路径) return { name: a.名, value: attrValue(saved[a.名]) ?? 0, path: '' };
            let cell = readCell((c && c.snap.tables) || {}, a.路径),
                v = cell.state === 'ok' ? attrValue(cellText(cell.value)) : null;
            return { name: a.名, value: v, path: a.路径, why: cell.state !== 'ok' ? cell.reason : v == null ? `「${cellText(cell.value)}」不是数字` : '' };
        });
    }
    function setAttr(name, value) {
        let prog = getProgress();
        if (!prog) return !1;
        let v = attrValue(value);
        setProgress({ ...prog, choiceAttrs: { ...(prog.choiceAttrs || {}), [name]: v ?? 0 } }, 'choice-attr');
        return (invalidate(), !0);
    }
    // 现在可做的抉择：功能开着、节点开放或进行中、还没有记录、没有被标为已处理
    function open(c) {
        if (!c || !c.snap.choices || !c.snap.choices.enabled) return [];
        return c.state.nodeStates
            .filter((s) => s.node.choice && s.node.uid && (s.status === 'active' || s.status === 'available') && !c.snap.choices.stateOf(s.node.uid))
            .map((s) => ({ uid: s.node.uid, name: s.node.name, choice: { ...s.node.choice, options: s.node.choice.options.filter((o) => !o.whenCond || evalCondition(o.whenCond, c.state.env).v === TRI.t) }, focus: s.status === 'active' || isCued(s.node.uid) }));
    }
    function view() {
        let c = compute();
        if (!c || !enabled()) return (enabled() || off(), null);
        let list = open(c),
            done = [...c.snap.choices.choices.values()].map((x) => ({ ...x, name: (c.state.nodeStates.find((s) => s.node.uid === x.rec.node) || { node: {} }).node.name || x.rec.node })),
            end = endingNode(c);
        own() || (pending = null);
        return { open: list, done, pending, busy: generating(), filling: fillBusy(), has: c.compiled.nodes.some((n) => n.choice || n.ending), attrs: attrs(c), ending: c.snap.choices.ending, endingNode: end, endingCheck: end ? endingPick(c, end, !1) : null };
    }
    // 点选：记下待选，返回填进输入框的一句
    function pick(uid, optionId) {
        let c = compute(),
            p = project(),
            o = open(c).find((x) => x.uid === uid);
        if (!o || !p) return '';
        pending = { chatId: chatId(), projectId: p.id, kind: 'choice', node: uid, option: optionId };
        return optionId === CUSTOM ? '' : pickSentence(o.choice, optionId);
    }
    function cancel() {
        pending = null;
    }
    function off() {
        ((pending = null), (cued = { key: '', set: new Set() }));
    }
    // 发送：真实用户消息入库后调用，写记录、存聊天
    function commit(index) {
        if (!enabled() || !own()) return ((pending = null), !1);
        let pick0 = pending,
            msg = chatMessages()[index];
        pending = null;
        if (!msg || !msg.is_user) return !1;
        invalidate();
        let c = compute(),
            p = project();
        if (pick0.kind === 'ending') {
            let node = endingNode(c);
            if (!node || node.uid !== pick0.node || c.snap.choices.ending) return !1;
            // 这一轮的表格还在填：用旧表定结局会错，这次不收尾
            if (fillBusy()) return (note('数据库还在填表，这次没有收尾；填完后再点「结束这段故事」'), !1);
            let r = endingPick(c, node, pick0.accept);
            if (r.blocked) return (note(`收尾依据读不到：${r.gaps.join('、')}`), !1);
            writeRecord(msg, 'ending', endingRecord({ projectId: p.id, node: node.uid, pick: r, accepted: pick0.accept }));
            return (save(), invalidate(), note(`收尾：${r.name}`), !0);
        }
        let s = open(c).find((x) => x.uid === pick0.node);
        if (!s) return !1;
        if (pick0.option !== CUSTOM && !s.choice.options.some((o) => o.id === pick0.option)) return (note(`这个行动现在已经不能选了：${pick0.option}`), !1);
        let list = attrs(c),
            attr = (name) => list.find((a) => a.name === name) || null,
            rec = choiceRecord({ projectId: p.id, node: s.uid, choice: s.choice, optionId: pick0.option, test: test(c.state.env), attr });
        if (!rec) return !1;
        writeRecord(msg, 'choice', rec);
        return (save(), invalidate(), note(`抉择 ${s.uid}：${rec.kind === 'custom' ? '自己的办法' : rec.action}${rec.tier ? `（${rec.tier}）` : ''}`), !0);
    }
    // 标为已处理：复用人工标记完成
    function handled(uid) {
        let c = compute();
        if (!open(c).some((x) => x.uid === uid)) return !1;
        pending && pending.node === uid && (pending = null);
        return (act({ kind: 'done', target: uid, value: 'force', note: '标为已处理' }), !0);
    }

    // 收尾节点：开放且还没收尾
    function endingNode(c) {
        if (!c || !c.snap.choices || !c.snap.choices.enabled || c.snap.choices.ending) return null;
        let s = c.state.nodeStates.find((x) => x.node.ending && x.node.uid && (x.status === 'active' || x.status === 'available'));
        return s ? s.node : null;
    }
    function endingPick(c, node, accept) {
        return pickEnding(node.ending, (when) => tri({ ...c.state.env, choicesFinal: !0 })(parseCondition(when)), accept);
    }
    function armEnding(accept = !1) {
        let c = compute(),
            p = project(),
            node = endingNode(c);
        if (!node || !p || fillBusy()) return !1;
        pending = { chatId: chatId(), projectId: p.id, kind: 'ending', node: node.uid, accept: !!accept };
        return ENDING_SENTENCE;
    }
    return { view, pick, cancel, off, commit, handled, armEnding, cue, setAttr };
}
