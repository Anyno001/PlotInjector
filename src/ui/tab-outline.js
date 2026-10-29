import { NODE_FIELDS, flattenUnits, makeId, outlineToText, parseOutlineText, replaceRest, stageLabel, stageToText, volumeLabel, volumeToText } from '../core/outline.js';
import { currentIndex, goTo } from '../core/progress.js';
import { fixYamlMessages, outlineMessages, parseOutlineReply, rewriteRestMessages } from '../core/prompts.js';
import { downloadBlob, toast } from '../host/st.js';
import { ask, runTask, talkText } from './ai.js';
import { choiceDialog, confirmDialog, esc, pickFiles, promptDialog } from './dom.js';
import { afterImport, classifyEntries, pickWorldbookEntries } from './wb-import.js';

const NODE_KEYS = {
    main: ['名称', '地点', '事件', '偏转'],
    side: ['名称', '地点', '事件', '触发', '偏转'],
    world: ['类型', '来源', '内容'],
};
const LONG_KEYS = new Set(['事件', '偏转', '内容', '触发']);
const NEW_NODE = { main: { 名称: '', 地点: '', 事件: '', 偏转: '' }, side: { 名称: '', 地点: '', 事件: '', 触发: '' }, world: { 类型: '', 来源: '', 内容: '' } };

const st = view => view.tabState('outline');

function findSel(project, sel) {
    for (const volume of project.outline.volumes) {
        if (volume.id === sel) return { volume };
        const stage = volume.stages.find(item => item.id === sel);
        if (stage) return { volume, stage };
    }
    return {};
}

function treeHtml(project, sel) {
    return project.outline.volumes.map(volume => `<button type="button" class="pi-titem is-vol${volume.id === sel ? ' is-sel' : ''}" data-act="sel" data-id="${esc(volume.id)}"><span class="pi-pname">${esc(volumeLabel(volume.key))}</span></button>
        ${volume.stages.map(stage => `<button type="button" class="pi-titem is-stage${stage.id === sel ? ' is-sel' : ''}" data-act="sel" data-id="${esc(stage.id)}"><span class="pi-pname">${esc(stageLabel(stage.key))}</span></button>`).join('')}`).join('')
        || '<p class="pi-hint">还没有卷。</p>';
}

function nodeEditor(stage, meta) {
    const list = Array.isArray(stage.data[meta.field]) ? stage.data[meta.field] : [];
    const items = list.map((item, index) => {
        const value = item && typeof item === 'object' ? item : { 内容: String(item ?? '') };
        const keys = [...new Set([...NODE_KEYS[meta.kind], ...Object.keys(value)])];
        return `<div class="pi-node"><div class="pi-node-hd"><span class="pi-badge">${esc(meta.label)} ${index + 1}</span><span class="pi-grow"></span>
            <button type="button" class="pi-btn is-sm" data-act="node-up" data-field="${esc(meta.field)}" data-i="${index}"${index ? '' : ' disabled'}>上移</button>
            <button type="button" class="pi-btn is-sm is-danger" data-act="node-del" data-field="${esc(meta.field)}" data-i="${index}">删除</button></div>
            ${keys.map(key => `<label class="pi-field"><span>${esc(key)}</span>${LONG_KEYS.has(key)
                ? `<textarea class="pi-ta" rows="2" data-node-field="${esc(meta.field)}" data-i="${index}" data-k="${esc(key)}">${esc(value[key] ?? '')}</textarea>`
                : `<input class="pi-inp" data-node-field="${esc(meta.field)}" data-i="${index}" data-k="${esc(key)}" value="${esc(value[key] ?? '')}">`}</label>`).join('')}</div>`;
    }).join('');
    return `<div class="pi-card"><h3>${esc(meta.field)}<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm" data-act="node-add" data-field="${esc(meta.field)}" data-kind="${meta.kind}">添加</button></h3>
        ${items || '<p class="pi-hint">无</p>'}</div>`;
}

// 节点按 主线 / 支线 / 世界动态 分开看，一次只展开一类，避免一长串。
function nodeTabs(stage, kind) {
    const count = meta => (Array.isArray(stage.data[meta.field]) ? stage.data[meta.field].length : 0);
    return `<div class="pi-seg pi-node-seg">${NODE_FIELDS.map(meta => `<button type="button" class="pi-seg-btn${meta.kind === kind ? ' is-sel' : ''}" data-act="node-kind" data-kind="${meta.kind}">${esc(meta.label)} ${count(meta)}</button>`).join('')}</div>`;
}

function stageEditor(volume, stage, raw, kind) {
    const known = new Set(['时间范围', 'AI指令', ...NODE_FIELDS.map(item => item.field)]);
    const extra = Object.keys(stage.data).filter(key => !known.has(key));
    const head = `<div class="pi-card"><h3>阶段</h3>
        <p class="pi-hint">所属：${esc(volumeLabel(volume.key))}</p>
        <div class="pi-tools is-c3"><button type="button" class="pi-btn is-sm" data-act="stage-up">上移</button>
        <button type="button" class="pi-btn is-sm" data-act="raw">${raw ? '表单编辑' : 'YAML 原文'}</button>
        <button type="button" class="pi-btn is-sm is-danger" data-act="stage-del">删除阶段</button></div>`;
    if (raw) {
        return `${head}<textarea class="pi-ta is-mono is-tall" data-raw>${esc(stageToText(stage))}</textarea>
            <div class="pi-tools is-c1 is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="raw-apply">应用</button></div><p class="pi-status" data-raw-status></p></div>`;
    }
    return `${head}<label class="pi-field"><span>阶段名（阶段N_标题）</span><input class="pi-inp" data-stage-key value="${esc(stage.key)}"></label>
        <label class="pi-field"><span>时间范围（用来判断何时切到下一段）</span><input class="pi-inp" data-stage-field="时间范围" value="${esc(stage.data.时间范围 ?? '')}"></label>
        <label class="pi-field"><span>AI指令</span><textarea class="pi-ta" rows="2" data-stage-field="AI指令">${esc(stage.data.AI指令 ?? '')}</textarea></label>
        ${extra.length ? `<p class="pi-hint">另有字段：${esc(extra.join('、'))}（在 YAML 原文里编辑）</p>` : ''}</div>
        ${nodeTabs(stage, kind)}${nodeEditor(stage, NODE_FIELDS.find(meta => meta.kind === kind))}`;
}

function volumeEditor(volume) {
    return `<div class="pi-card"><h3>卷</h3>
        <div class="pi-tools is-c4"><button type="button" class="pi-btn is-sm" data-act="stage-add">＋新阶段</button>
        <button type="button" class="pi-btn is-sm" data-act="vol-up">上移</button>
        <button type="button" class="pi-btn is-sm" data-act="vol-export">导出本卷</button>
        <button type="button" class="pi-btn is-sm is-danger" data-act="vol-del">删除卷</button></div>
        <label class="pi-field"><span>卷名（剧情_卷X_标题）</span><input class="pi-inp" data-vol-key value="${esc(volume.key)}"></label>
        <p class="pi-hint">${volume.stages.length} 个阶段</p></div>`;
}

function draftHtml(view, draft) {
    if (!draft) return '';
    const title = draft.mode === 'rewrite' ? '改写后续阶段' : 'AI 写的大纲';
    if (!draft.ok) {
        return `<div class="pi-card"><h3>${title}<span class="pi-badge is-danger">格式错误</span></h3>
            <p class="pi-hint">${esc(draft.error)}</p>
            <textarea class="pi-ta is-mono is-tall" data-draft-yaml>${esc(draft.yaml)}</textarea>
            <div class="pi-tools is-c3 is-end"><button type="button" class="pi-btn is-primary is-sm" data-act="draft-fix"${view.busy.outline ? ' disabled' : ''}>让 AI 修正格式</button>
            <button type="button" class="pi-btn is-sm" data-act="draft-reparse">重新解析</button>
            <button type="button" class="pi-btn is-sm is-danger" data-act="draft-drop">丢弃</button></div></div>`;
    }
    const summary = draft.volumes.map(volume => `<p class="pi-hint"><b>${esc(volumeLabel(volume.key))}</b>：${volume.stages.map(stage => esc(stageLabel(stage.key))).join('、')}</p>`).join('');
    const buttons = draft.mode === 'rewrite'
        ? '<button type="button" class="pi-btn is-primary is-sm" data-act="draft-rest">替换剩余阶段</button>'
        : `<button type="button" class="pi-btn is-primary is-sm" data-act="draft-new">存为新卷</button>
           <button type="button" class="pi-btn is-sm" data-act="draft-replace">替换选中卷</button>
           <button type="button" class="pi-btn is-sm" data-act="draft-append">追加为新阶段</button>`;
    return `<div class="pi-card"><h3>${title}<span class="pi-badge is-ok">已解析</span></h3>${summary}
        <details><summary class="pi-hint">YAML 原文</summary><pre class="pi-pre">${esc(draft.yaml)}</pre></details>
        <div class="pi-tools is-end ${draft.mode === 'rewrite' ? 'is-c2' : 'is-c4'}">${buttons}<button type="button" class="pi-btn is-sm is-danger" data-act="draft-drop">丢弃</button></div></div>`;
}

export function render(view) {
    const project = view.project();
    const s = st(view);
    const { volume, stage } = findSel(project, s.sel);
    const busy = view.busy.outline;
    const kind = NODE_FIELDS.some(meta => meta.kind === s.nodeKind) ? s.nodeKind : NODE_FIELDS[0].kind;
    const editor = stage ? stageEditor(volume, stage, s.raw, kind) : volume ? volumeEditor(volume) : '<div class="pi-card"><p class="pi-hint">从左边选一卷或一个阶段编辑。</p></div>';
    return `<div class="pi-card"><h3>大纲</h3>
        <div class="pi-tools is-c4">
            <button type="button" class="pi-btn is-sm" data-act="import-file">导入YAML</button>
            <button type="button" class="pi-btn is-sm" data-act="import-paste">粘贴</button>
            <button type="button" class="pi-btn is-sm" data-act="import-wb">从世界书</button>
            <button type="button" class="pi-btn is-sm" data-act="export"${project.outline.volumes.length ? '' : ' disabled'}>导出</button></div>
        <div class="pi-inline"><input class="pi-inp" data-ai-request placeholder="给 AI 的额外要求（可空）" value="${esc(s.request || '')}">
            <button type="button" class="pi-btn is-accent is-sm is-wide" data-act="ai-volume"${busy ? ' disabled' : ''}>${busy ? '<span class="pi-spin"></span>写作中' : `AI 写第 ${project.outline.volumes.length + 1} 卷`}</button></div>
        </div>
        ${draftHtml(view, s.draft)}
        <div class="pi-tree"><div class="pi-tree-list">${treeHtml(project, s.sel)}
            <button type="button" class="pi-btn is-sm is-ghost is-block" data-act="vol-add">＋新卷</button></div>
            <div>${editor}</div></div>`;
}

function update(view, fn) {
    return view.data.updateProject(view.projectId, project => ({ ...project, outline: { ...project.outline, volumes: fn(project.outline.volumes) } }));
}

function updateStage(view, stageId, fn) {
    update(view, volumes => volumes.map(volume => (volume.stages.some(stage => stage.id === stageId)
        ? { ...volume, stages: volume.stages.map(stage => (stage.id === stageId ? fn(stage) : stage)) }
        : volume)));
}

function updateVolume(view, volumeId, fn) {
    update(view, volumes => volumes.map(volume => (volume.id === volumeId ? fn(volume) : volume)));
}

function moveUp(list, index) {
    if (index <= 0) return list;
    const out = [...list];
    [out[index - 1], out[index]] = [out[index], out[index - 1]];
    return out;
}

function addVolumes(view, incoming) {
    const project = view.project();
    const existing = new Set(project.outline.volumes.map(volume => volume.key));
    const fresh = incoming.map(volume => (existing.has(volume.key) ? { ...volume, key: `${volume.key}_导入${Date.now().toString(36).slice(-3)}` } : volume));
    update(view, volumes => [...volumes, ...fresh]);
    st(view).sel = fresh[0] && fresh[0].id;
    view.runtime.refresh();
    return fresh;
}

async function importTexts(view, texts) {
    const added = [];
    const failed = [];
    for (const { name, text } of texts) {
        try {
            added.push(...parseOutlineText(text));
        } catch (error) {
            failed.push(`${name}：${error.message}`);
        }
    }
    if (added.length) addVolumes(view, added);
    if (failed.length) toast('error', failed.join('\n'));
    else if (added.length) toast('success', `已导入 ${added.length} 卷。`);
    view.renderBody();
}

function setDraft(view, mode, reply, extra = {}) {
    st(view).draft = { mode, ...parseOutlineReply(reply), ...extra };
    view.renderBody();
}

export function showDraft(view, reply) {
    setDraft(view, 'volume', reply);
}

// 执行页偏转时调用：带着最近正文改写当前及之后的阶段。
export async function startRewrite(view) {
    const project = view.project();
    const units = flattenUnits(project.outline.volumes);
    if (!units.length) return;
    const from = Math.max(0, currentIndex(units, view.runtime.progress()));
    const reason = await promptDialog({ title: '让 AI 改写后续阶段', label: '偏转说明（可空）：剧情哪里和大纲不一样了', multiline: true });
    if (reason == null) return;
    view.go('outline');
    const recent = view.runtime.recentFloors(6).map(floor => floor.text).join('\n\n');
    const reply = await runTask(view, 'outline', () => ask(view, 'outline', rewriteRestMessages({
        setting: project.setting.text, volumes: project.outline.volumes, fromUnitIndex: from, units, recent, reason,
    })));
    if (reply) setDraft(view, 'rewrite', reply, { fromUnitId: units[from].id });
}

function applyRest(view, draft) {
    const project = view.project();
    const unit = flattenUnits(project.outline.volumes).find(item => item.id === draft.fromUnitId);
    if (!unit) throw new Error('原来的阶段已不存在，改用「存为新卷」。');
    const volumes = replaceRest(project.outline.volumes, unit.stage.id, draft.volumes);
    update(view, () => volumes);
    const first = draft.volumes[0] && draft.volumes[0].stages[0];
    if (first && view.runtime.activeId() === view.projectId) view.runtime.setProgress(goTo(view.runtime.progress(), flattenUnits(volumes), first.id));
}

export const actions = {
    'node-kind'(view, target) {
        st(view).nodeKind = target.dataset.kind;
        view.renderBody();
    },
    sel(view, target) {
        st(view).sel = target.dataset.id;
        st(view).raw = false;
        view.renderBody();
    },
    'vol-add'(view) {
        const project = view.project();
        const volume = { id: makeId('v'), key: `剧情_卷${project.outline.volumes.length + 1}_新卷`, stages: [{ id: makeId('s'), key: '阶段一_新阶段', data: { 时间范围: '', AI指令: '', 主线节点: [] } }] };
        update(view, volumes => [...volumes, volume]);
        st(view).sel = volume.id;
        view.renderBody();
    },
    'vol-up'(view) {
        update(view, volumes => moveUp(volumes, volumes.findIndex(volume => volume.id === st(view).sel)));
        view.runtime.refresh();
        view.renderBody();
    },
    'vol-export'(view) {
        const { volume } = findSel(view.project(), st(view).sel);
        if (volume) downloadBlob(`${volume.key}.yaml`, volumeToText(volume), 'text/yaml');
    },
    async 'vol-del'(view) {
        const { volume } = findSel(view.project(), st(view).sel);
        if (!volume || !(await confirmDialog({ title: `删除「${volumeLabel(volume.key)}」`, body: `连同 ${volume.stages.length} 个阶段一起删除。`, okLabel: '删除', danger: true }))) return;
        update(view, volumes => volumes.filter(item => item.id !== volume.id));
        st(view).sel = '';
        view.runtime.refresh();
        view.renderBody();
    },
    'stage-add'(view) {
        const { volume } = findSel(view.project(), st(view).sel);
        if (!volume) return;
        const stage = { id: makeId('s'), key: `阶段${volume.stages.length + 1}_新阶段`, data: { 时间范围: '', AI指令: '', 主线节点: [] } };
        updateVolume(view, volume.id, item => ({ ...item, stages: [...item.stages, stage] }));
        st(view).sel = stage.id;
        view.renderBody();
    },
    'stage-up'(view) {
        const { volume, stage } = findSel(view.project(), st(view).sel);
        if (!stage) return;
        updateVolume(view, volume.id, item => ({ ...item, stages: moveUp(item.stages, item.stages.indexOf(stage)) }));
        view.runtime.refresh();
        view.renderBody();
    },
    async 'stage-del'(view) {
        const { volume, stage } = findSel(view.project(), st(view).sel);
        if (!stage || !(await confirmDialog({ title: `删除「${stageLabel(stage.key)}」`, okLabel: '删除', danger: true }))) return;
        updateVolume(view, volume.id, item => ({ ...item, stages: item.stages.filter(entry => entry.id !== stage.id) }));
        st(view).sel = volume.id;
        view.runtime.refresh();
        view.renderBody();
    },
    raw(view) {
        st(view).raw = !st(view).raw;
        view.renderBody();
    },
    'raw-apply'(view, target) {
        const { stage } = findSel(view.project(), st(view).sel);
        const box = target.closest('.pi-card');
        const status = box.querySelector('[data-raw-status]');
        try {
            const parsed = parseOutlineText(box.querySelector('[data-raw]').value);
            const next = parsed[0] && parsed[0].stages[0];
            if (!next || parsed.length > 1 || parsed[0].stages.length > 1) throw new Error('原文里只能有一个阶段');
            updateStage(view, stage.id, item => ({ ...item, key: next.key, data: next.data }));
            view.runtime.refresh();
            st(view).raw = false;
            view.renderBody();
        } catch (error) {
            status.textContent = error.message;
            status.classList.add('is-err');
        }
    },
    'node-add'(view, target) {
        const { stage } = findSel(view.project(), st(view).sel);
        const field = target.dataset.field;
        updateStage(view, stage.id, item => ({ ...item, data: { ...item.data, [field]: [...(Array.isArray(item.data[field]) ? item.data[field] : []), { ...NEW_NODE[target.dataset.kind] }] } }));
        view.renderBody();
    },
    'node-up'(view, target) {
        const { stage } = findSel(view.project(), st(view).sel);
        const field = target.dataset.field;
        updateStage(view, stage.id, item => ({ ...item, data: { ...item.data, [field]: moveUp(item.data[field], Number(target.dataset.i)) } }));
        view.runtime.refresh();
        view.renderBody();
    },
    async 'node-del'(view, target) {
        const { stage } = findSel(view.project(), st(view).sel);
        const field = target.dataset.field;
        const index = Number(target.dataset.i);
        const node = stage.data[field][index];
        if (!(await confirmDialog({ title: `删除「${(node && (node.名称 || node.类型)) || '节点'}」`, okLabel: '删除', danger: true }))) return;
        updateStage(view, stage.id, item => {
            const list = item.data[field].filter((_, i) => i !== index);
            const data = { ...item.data, [field]: list };
            if (!list.length && field !== '主线节点') delete data[field];
            return { ...item, data };
        });
        view.runtime.refresh();
        view.renderBody();
    },
    async 'import-file'(view) {
        const files = await pickFiles({ accept: '.yaml,.yml,.txt', multiple: true });
        if (!files.length) return;
        await importTexts(view, await Promise.all(files.sort((a, b) => a.name.localeCompare(b.name, 'zh')).map(async file => ({ name: file.name, text: await file.text() }))));
    },
    async 'import-paste'(view) {
        const text = await promptDialog({ title: '粘贴剧情 YAML', multiline: true, placeholder: '剧情_卷一_标题:\n  阶段一_标题:\n    时间范围: …' });
        if (text) await importTexts(view, [{ name: '粘贴内容', text }]);
    },
    async 'import-wb'(view) {
        const picked = await pickWorldbookEntries('从世界书导入大纲或设定');
        if (!picked.length) return;
        const { outline, setting } = classifyEntries(picked);
        if (outline.length) addVolumes(view, outline.flatMap(item => item.volumes));
        if (setting.length) {
            view.data.updateProject(view.projectId, project => {
                const text = [project.setting.text, ...setting.map(entry => entry.content)].filter(Boolean).join('\n\n');
                return { ...project, setting: { ...project.setting, text } };
            });
        }
        toast('success', `${outline.length} 条进大纲，${setting.length} 条进设定。`);
        view.runtime.refresh();
        view.renderBody();
        await afterImport(picked);
    },
    async export(view) {
        const project = view.project();
        const choice = await choiceDialog({ title: '导出大纲', choices: [{ label: '取消', value: null }, { label: '每卷一个文件', value: 'each' }, { label: '合成一个文件', value: 'one', primary: true }] });
        if (choice === 'one') downloadBlob(`${project.name}-大纲.yaml`, outlineToText(project.outline.volumes), 'text/yaml');
        if (choice === 'each') project.outline.volumes.forEach((volume, i) => downloadBlob(`${String(i + 1).padStart(2, '0')}-${volume.key}.yaml`, volumeToText(volume), 'text/yaml'));
    },
    async 'ai-volume'(view) {
        const project = view.project();
        const talk = await talkText(view, 12000);
        const reply = await runTask(view, 'outline', () => ask(view, 'outline', outlineMessages({
            setting: project.setting.text, talk, volumes: project.outline.volumes, volumeNo: project.outline.volumes.length + 1, request: st(view).request,
        })));
        if (reply) setDraft(view, 'volume', reply);
    },
    async 'draft-fix'(view, target) {
        const draft = st(view).draft;
        const box = target.closest('.pi-card').querySelector('[data-draft-yaml]');
        const text = box ? box.value : draft.yaml;
        const reply = await runTask(view, 'outline', () => ask(view, 'outline', fixYamlMessages(text, draft.error)));
        if (reply) setDraft(view, draft.mode, reply, { fromUnitId: draft.fromUnitId });
    },
    'draft-reparse'(view, target) {
        const draft = st(view).draft;
        const yaml = target.closest('.pi-card').querySelector('[data-draft-yaml]').value;
        setDraft(view, draft.mode, `\`\`\`yaml\n${yaml}\n\`\`\``, { fromUnitId: draft.fromUnitId });
    },
    'draft-drop'(view) {
        st(view).draft = null;
        view.renderBody();
    },
    'draft-new'(view) {
        addVolumes(view, st(view).draft.volumes);
        st(view).draft = null;
        view.renderBody();
    },
    async 'draft-replace'(view) {
        const { volume } = findSel(view.project(), st(view).sel);
        if (!volume) throw new Error('先在左边选中要替换的卷');
        if (!(await confirmDialog({ title: `替换「${volumeLabel(volume.key)}」`, body: '该卷原有阶段全部换成 AI 写的内容。', okLabel: '替换', danger: true }))) return;
        const incoming = st(view).draft.volumes;
        update(view, volumes => volumes.flatMap(item => (item.id === volume.id ? incoming : [item])));
        st(view).draft = null;
        st(view).sel = incoming[0].id;
        view.runtime.refresh();
        view.renderBody();
    },
    'draft-append'(view) {
        const { volume } = findSel(view.project(), st(view).sel);
        if (!volume) throw new Error('先在左边选中要追加到的卷');
        const stages = st(view).draft.volumes.flatMap(item => item.stages);
        updateVolume(view, volume.id, item => ({ ...item, stages: [...item.stages, ...stages] }));
        st(view).draft = null;
        view.runtime.refresh();
        view.renderBody();
    },
    async 'draft-rest'(view) {
        if (!(await confirmDialog({ title: '替换剩余阶段', body: '当前阶段及之后的阶段会换成改写后的内容，进度跳到改写后的第一段。', okLabel: '替换', danger: true }))) return;
        applyRest(view, st(view).draft);
        st(view).draft = null;
        view.renderBody();
    },
};

function renameInTree(target, id, label) {
    const item = target.closest('.pi-body')?.querySelector(`.pi-titem[data-id="${id}"] .pi-pname`);
    if (item) item.textContent = label;
}

export function onInput(view, target) {
    const { stage, volume } = findSel(view.project(), st(view).sel);
    if (target.dataset.aiRequest !== undefined) {
        st(view).request = target.value;
        return;
    }
    if (target.dataset.volKey !== undefined && volume) {
        const key = target.value.trim();
        if (key && !view.project().outline.volumes.some(item => item.key === key && item.id !== volume.id)) {
            updateVolume(view, volume.id, item => ({ ...item, key }));
            renameInTree(target, volume.id, volumeLabel(key));
        }
        return;
    }
    if (!stage) return;
    if (target.dataset.stageKey !== undefined) {
        const key = target.value.trim();
        if (key && !volume.stages.some(item => item.key === key && item.id !== stage.id)) {
            updateStage(view, stage.id, item => ({ ...item, key }));
            renameInTree(target, stage.id, stageLabel(key));
        }
        return;
    }
    if (target.dataset.stageField) {
        const field = target.dataset.stageField;
        updateStage(view, stage.id, item => ({ ...item, data: { ...item.data, [field]: target.value } }));
        return;
    }
    if (target.dataset.nodeField) {
        const field = target.dataset.nodeField;
        const index = Number(target.dataset.i);
        const key = target.dataset.k;
        updateStage(view, stage.id, item => {
            const list = [...item.data[field]];
            const prev = list[index] && typeof list[index] === 'object' ? list[index] : {};
            list[index] = { ...prev, [key]: target.value };
            return { ...item, data: { ...item.data, [field]: list } };
        });
    }
}

// 失焦时同步注入内容；名字改动直接改树上的文字，不整页重画（避免吞掉紧接着的点击）。
export function onBlur(view, target) {
    if (target.matches('[data-stage-key],[data-vol-key],[data-stage-field],[data-node-field]')) view.runtime.refresh();
}

export const refreshOn = [];
