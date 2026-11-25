import { buildProjectFile, parseProjectFile } from './project-file.js';
import { makeId, isPlainObject, pushOutlineHistory } from './outline.js';
import { pushHistory } from './setting.js';

// 剧情项目随角色卡分发：整个项目文件存进卡的 data.extensions.plot_injector。
// 只写这一项，卡里原有的正则、脚本、世界书都不动（酒馆按键合并）。
// 项目文件存成一个 JSON 字符串：酒馆合并时会逐层合并对象，存成对象的话，新版删掉的字段会残留。
export const CARD_PACK_KEY = 'plot_injector';
export const CARD_PACK_KIND = 'plot-injector-card';

// 写进卡的那一项。id 是这个项目在卡里的标识：作者再次写入沿用同一个，玩家那边据此认出「同一个剧情的新版本」。
export function buildCardPack(project, { id = '', personas = !0, setting = !0, version = '', now = Date.now() } = {}) {
    let file = buildProjectFile(project, { personas, setting, version });
    return { kind: CARD_PACK_KIND, version: 1, id: id || makeId('k'), name: file.project.name, savedAt: now, file: JSON.stringify(file) };
}

// 读卡里的那一项；格式不对返回 null（不报错：卡是别人做的，可能带着别的东西）。
export function readCardPack(card) {
    let ext = card && card.data && card.data.extensions,
        pack = ext && ext[CARD_PACK_KEY];
    if (!isPlainObject(pack) || pack.kind !== CARD_PACK_KIND || typeof pack.file != 'string' || !pack.id) return null;
    return { id: String(pack.id), name: String(pack.name || ''), savedAt: Number(pack.savedAt) || 0, file: pack.file, version: Number(pack.version) || 1 };
}

// 本机和卡里这一项的关系（links 存在设置里：{ 卡内id: { project, savedAt } }）：
// new：没导入过；update：导入过、卡里是更新的版本；same：已是最新；gone：导入过但那个项目已删掉，当作没导入过。
export function cardPackState(pack, links, projectIds) {
    if (!pack) return { kind: 'none' };
    let link = isPlainObject(links) ? links[pack.id] : null;
    if (!link || !projectIds.includes(link.project)) return { kind: 'new' };
    return { kind: pack.savedAt > (Number(link.savedAt) || 0) ? 'update' : 'same', project: link.project };
}

// 这个项目在哪张卡里用过的 id（作者再次写入时沿用）。
export function packIdOf(links, projectId) {
    let hit = Object.entries(isPlainObject(links) ? links : {}).find(([, v]) => v && v.project === projectId);
    return hit ? hit[0] : '';
}

// 用卡里的新版本更新本机已导入的项目：项目 id 不变，所以各聊天的进度（按项目存）照常接上。
// 线、阶段、节点的 id 跟着作者的项目走，没改的节点进度照旧；新增的按新大纲继续；删掉的不再出现。
// 换掉：大纲、线索设置和标签、保密名单、推进与注入设置；卡里带了人设、设定才换这两样。
// 保留：项目名和分组、导入任务、讨论记录、修改历史。旧大纲、旧设定各存一份进修改历史，可以从历史里找回。
export function applyCardUpdate(local, text, now = Date.now()) {
    let { project: next, summary } = parseProjectFile(text),
        label = '角色卡更新前',
        // 跑团、无限流、保密名单以卡里的为准：新版没有就去掉
        { trpg, infinite, secretNames, ...base } = local;
    return {
        summary,
        project: {
            ...base,
            mode: next.mode,
            clue: next.clue,
            defaults: next.defaults,
            threads: next.threads,
            outline: {
                ...local.outline,
                volumes: next.outline.volumes,
                renames: next.outline.renames,
                idAlias: next.outline.idAlias,
                history: pushOutlineHistory(local.outline && local.outline.history, local.outline && local.outline.volumes, label, now),
            },
            ...(next.secretNames ? { secretNames: next.secretNames } : {}),
            ...(next.trpg ? { trpg: next.trpg } : {}),
            ...(next.infinite ? { infinite: next.infinite } : {}),
            ...(summary.hasSetting
                ? {
                      setting: {
                          ...local.setting,
                          text: next.setting.text,
                          mute: next.setting.mute,
                          history: String(local.setting && local.setting.text || '').trim()
                              ? pushHistory(local.setting.history, local.setting.text, 10, now, label)
                              : (local.setting && local.setting.history) || [],
                      },
                  }
                : {}),
            ...(summary.hasPersonas ? { personas: next.personas } : {}),
        },
    };
}
