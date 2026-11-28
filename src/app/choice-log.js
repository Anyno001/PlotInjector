import { readRecord } from '../core/choice.js';

// 抉择和结局记录写在用户消息上：message.extra.plot_injector.{choice|ending}。
// 删掉消息记录随之消失；重 roll、切换回复版本不动用户消息，记录不变。
export const MSG_KEY = 'plot_injector';

const isUser = (m) => !!m && m.is_user && !m.is_system;
const isReply = (m) => !!m && !m.is_user && !m.is_system;
const hasText = (m) => String((m && m.mes) || '').trim().length > 0;

// 唯一的读取口。enabled 为 false 时各处走原路径（带抉择的节点当普通节点）。
// generating：正在生成时，最后一条回复还没写完，不算「已演出」。
export function readChoiceLog(chat, projectId, { enabled = !1, generating = !1 } = {}) {
    let choices = new Map(),
        ending = null;
    if (!enabled || !Array.isArray(chat)) return { enabled: !!enabled, choices, ending, stateOf: () => null };
    let lastUser = -1;
    for (let i = chat.length - 1; i >= 0; i--)
        if (isUser(chat[i])) {
            lastUser = i;
            break;
        }
    for (let i = 0; i < chat.length; i++) {
        if (!isUser(chat[i])) continue;
        let box = chat[i].extra && chat[i].extra[MSG_KEY];
        if (!box) continue;
        let replies = [];
        for (let j = i + 1; j < chat.length && !isUser(chat[j]); j++) isReply(chat[j]) && replies.push(j);
        let shown = replies.some((j) => hasText(chat[j]) && !(generating && j === chat.length - 1)),
            // 记录所在的是最后一条用户消息，且后面至多一条回复：这次生成（新回复、重 roll、继续）要演出它
            performing = i === lastUser && replies.length <= 1,
            at = { index: i, shown, performing },
            c = readRecord(box.choice, projectId),
            e = readRecord(box.ending, projectId);
        c && c.kind !== 'ending' && choices.set(c.node, { rec: c, ...at });
        e && e.kind === 'ending' && (ending = { rec: e, ...at });
    }
    return { enabled: !0, choices, ending, stateOf: (uid) => choices.get(uid) || null };
}

// 写记录（发送那一刻调用）：只写当前这条用户消息上我们自己的键
export function writeRecord(message, key, rec) {
    if (!isUser(message)) return !1;
    message.extra = message.extra || {};
    message.extra[MSG_KEY] = { ...(message.extra[MSG_KEY] || {}), [key]: rec };
    return !0;
}
