import { emptyProgress, normalizeProgress } from '../core/progress.js';
import { ctx } from '../host/st.js';

// chat_metadata.plotInjector = { projectId: 本聊天使用的项目, byProject: { [项目id]: 进度 } }。
// projectId 优先于本卡默认项目；同一聊天切换项目不丢各自进度；切聊天时 chat_metadata 整个换掉，所以每次都从上下文现取。
const KEY = 'plotInjector';

function meta() {
    const c = ctx();
    return c && c.chatMetadata ? c.chatMetadata : null;
}

export function readChatState() {
    const m = meta();
    const raw = m && m[KEY];
    if (!raw || typeof raw !== 'object') return { projectId: '', byProject: {} };
    if (raw.byProject && typeof raw.byProject === 'object') return { projectId: String(raw.projectId || ''), byProject: raw.byProject };
    return raw.projectId ? { projectId: raw.projectId, byProject: { [raw.projectId]: raw } } : { projectId: '', byProject: {} };
}

export function readProgress(projectId) {
    const state = readChatState();
    return normalizeProgress(state.byProject[projectId], projectId) || emptyProgress(projectId);
}

function save() {
    const c = ctx();
    if (typeof c.saveMetadataDebounced === 'function') c.saveMetadataDebounced();
    else if (typeof c.saveMetadata === 'function') c.saveMetadata();
}

export function writeProgress(progress) {
    const m = meta();
    if (!m) return false;
    const state = readChatState();
    m[KEY] = { projectId: progress.projectId, byProject: { ...state.byProject, [progress.projectId]: progress } };
    save();
    return true;
}

// 没打开聊天时返回 false，由调用方退回改本卡默认。
export function bindChat(projectId) {
    const m = meta();
    const c = ctx();
    if (!m || !c.chatId) return false;
    m[KEY] = { ...readChatState(), projectId };
    save();
    return true;
}

export function clearChatProgress() {
    const m = meta();
    if (!m || !m[KEY]) return;
    delete m[KEY];
    const c = ctx();
    if (typeof c.saveMetadata === 'function') return c.saveMetadata();
}
