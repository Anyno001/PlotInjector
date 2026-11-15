import { makeId } from './outline.js';
import { normalizePersonas } from './personas.js';

// 人设单独导出导入：文件只含人设线（不含大纲、设定、进度、世界书转入记录）。
export const PERSONA_FILE_KIND = 'plot-injector-personas';

export function buildPersonaFile(personas, { project = '', version = '' } = {}) {
    const { lines } = normalizePersonas(personas);
    // 来源（世界书转入记录）只对本机有意义，导出时去掉。
    const clean = lines.map(line => ({ ...line, source: null, sources: [] }));
    return { kind: PERSONA_FILE_KIND, version: 1, app: version, project, exportedAt: new Date().toISOString(), lines: clean };
}

// 解析导入文件，返回 { lines }；格式不对抛错。线与阶段换新 id，跟随大纲的绑定在新项目里不一定有效，清空。
export function parsePersonaFile(text, { keepOutline = false } = {}) {
    let data;
    try {
        data = JSON.parse(text);
    } catch {
        throw new Error('文件不是有效的 JSON');
    }
    if (!data || data.kind !== PERSONA_FILE_KIND || !Array.isArray(data.lines)) throw new Error('这不是剧情注入器导出的人设文件');
    const { lines } = normalizePersonas({ lines: data.lines });
    if (!lines.length) throw new Error('文件里没有人设线');
    return { project: String(data.project || ''), lines: lines.map(line => reidLine(line, keepOutline)) };
}

function reidLine(line, keepOutline) {
    const ids = new Map();
    const stages = line.stages.map(stage => {
        const id = makeId('ps');
        ids.set(stage.id, id);
        return { ...stage, id, ...(keepOutline ? {} : { unitId: '' }) };
    });
    return { ...line, id: makeId('pl'), stages, defaultStage: ids.get(line.defaultStage) || '', source: null, sources: [] };
}

// 合并进已有人设：同组同名的线按 mode 处理——skip 跳过、replace 替换（保留原 id 让进度对得上）、both 都留（新线改名加「（导入）」）。
export function mergePersonaLines(existing, incoming, mode = 'both') {
    const out = [...existing];
    const key = line => `${line.group}\u0000${line.name}`;
    let added = 0;
    let replaced = 0;
    let skipped = 0;
    for (const line of incoming) {
        const at = out.findIndex(item => key(item) === key(line));
        if (at < 0) { out.push(line); added++; continue; }
        if (mode === 'skip') { skipped++; continue; }
        if (mode === 'replace') { out[at] = { ...line, id: out[at].id }; replaced++; continue; }
        out.push({ ...line, name: `${line.name}（导入）` });
        added++;
    }
    return { lines: out, added, replaced, skipped };
}
