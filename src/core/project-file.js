import { normalizeProject } from './store.js';
import { makeId, isPlainObject } from './outline.js';
import { emptyPersonas } from './personas.js';

// 整个项目导出成一个文件、在别的酒馆导入（用户 2026-11-17：本地和云酒馆之间搬项目；卡作者把写好的剧情和角色卡一起发给玩家）。
// 打包：大纲、线索标签和口径、保密名单、推进方式和注入参数等设置；人设、设定可选（很多作者写在世界书里）。
// 不打包：导入任务和原文、讨论记录、聊天进度、修改历史、本机的世界书引用。
// 线、阶段、节点的 id 只在项目内部用，导入时原样保留（人设阶段绑定、保密名单、线索标签都按它们对上），只换项目 id。
export const PROJECT_FILE_KIND = 'plot-injector-project';
export const PROJECT_FILE_EXT = '.plotinjector.json';

export function buildProjectFile(project, { personas = !0, setting = !0, version = '' } = {}) {
    let p = normalizeProject(project, project && project.id),
        body = {
            name: p.name,
            mode: p.mode,
            ...(p.infinite ? { infinite: p.infinite } : {}),
            clue: p.clue,
            ...(p.trpg ? { trpg: p.trpg } : {}),
            defaults: p.defaults,
            threads: p.threads,
            outline: { volumes: p.outline.volumes, renames: p.outline.renames, idAlias: p.outline.idAlias },
            ...(p.secretNames ? { secretNames: p.secretNames } : {}),
            ...(setting ? { setting: { text: p.setting.text, mute: p.setting.mute } } : {}),
            ...(personas ? { personas: stripPersonaSources(p.personas) } : {}),
        };
    return { kind: PROJECT_FILE_KIND, version: 1, app: version, exportedAt: new Date().toISOString(), project: body };
}

// 人设里「从世界书转入」的记录只对本机有意义：每条线的 source / sources、顶层的 imported（GPT 第六轮 R3）。
// 导出、导入都去掉；人设正文、阶段 id、跟随大纲的 unitId 保留。
function stripPersonaSources(personas) {
    let src = isPlainObject(personas) ? personas : emptyPersonas();
    return { ...src, imported: [], lines: (Array.isArray(src.lines) ? src.lines : []).map((line) => ({ ...line, source: null, sources: [] })) };
}

// 读文件：格式不对抛错。返回规范化后的项目（新项目 id、没有导入任务和历史）和一份概要（给确认框用）。
export function parseProjectFile(text) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('文件不是有效的 JSON');
    }
    if (!isPlainObject(data) || data.kind !== PROJECT_FILE_KIND || !isPlainObject(data.project)) throw new Error('这不是剧情注入器导出的项目文件');
    if (Number(data.version) > 1) throw new Error('这个项目文件来自更新的插件版本，请先更新插件');
    let src = data.project,
        id = makeId('p'),
        project = normalizeProject(
            {
                ...src,
                id,
                createdAt: Date.now(),
                outline: { ...(isPlainObject(src.outline) ? src.outline : {}), history: [] },
                setting: { ...(isPlainObject(src.setting) ? src.setting : {}), history: [], check: '', fixes: [] },
                imports: [],
                importAdopted: [],
                ...(isPlainObject(src.personas) ? { personas: stripPersonaSources(src.personas) } : {}),
            },
            id,
        );
    if (!project.outline.volumes.length && !project.setting.text && !project.personas.lines.length) throw new Error('文件里没有大纲、设定或人设');
    return { project, summary: projectSummary(project, { app: String(data.app || ''), exportedAt: String(data.exportedAt || ''), hasPersonas: 'personas' in src, hasSetting: 'setting' in src }) };
}

// 概要：推进方式、剧情线数、标签数、人设线数、有没有设定；导入确认框和导出确认框共用。
export function projectSummary(project, extra = {}) {
    let p = project || {},
        volumes = (p.outline && p.outline.volumes) || [],
        labels = p.clue && p.clue.labels ? Object.keys(p.clue.labels).length : 0;
    return {
        name: p.name || '',
        clue: !!(p.clue && p.clue.mode === 'clue'),
        lines: volumes.length,
        labels,
        personas: p.personas && Array.isArray(p.personas.lines) ? p.personas.lines.length : 0,
        setting: !!(p.setting && String(p.setting.text || '').trim()),
        ...extra,
    };
}

// 导入时的名字：和已有项目重名就加「（导入）」，还重名再加序号。不覆盖原项目（用户 2026-11-17）。
export function importedName(name, taken) {
    let base = String(name || '').trim() || '导入的项目',
        names = new Set((taken || []).map(String));
    if (!names.has(base)) return base;
    let n = `${base}（导入）`;
    for (let i = 2; names.has(n); i++) n = `${base}（导入${i}）`;
    return n;
}

// 导入后核对当前聊天的数据库：项目绑定的表在不在。返回缺的表名（读不到表格时返回 null，界面另行提示）。
export function missingBoundTables(project, tables) {
    if (!project || !project.clue || project.clue.mode !== 'clue') return [];
    if (!tables) return null;
    let names = new Set(
            Object.values(tables)
                .filter((x) => x && x.name)
                .map((x) => x.name),
        ),
        b = project.clue.bindings || {},
        // 事实、知情绑定写表名；场景、开关、时间写「表/行/列」路径，取第一段
        fromPath = (x) => [].concat((x && x.路径) || []).map((p) => String(p).split('/')[0].trim()),
        want = [
            ...[...(b.facts || []), ...(b.knowledge || [])].map((x) => x && x.表),
            ...fromPath(b.scene),
            ...fromPath(b.switch),
            ...fromPath(b.time),
        ].filter(Boolean);
    return [...new Set(want)].filter((n) => !names.has(n));
}
