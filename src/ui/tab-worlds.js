import { POOL_KEYS, POOL_LABELS, findWorld, normalizeInfinite, poolToText, textToPool } from '../core/infinite.js';
import { DEFAULT_WORLD_SPEC, worldSpecText } from '../core/infinite-world.js';
import { confirmDialog, esc } from './dom.js';

// 无限流项目的「大纲」页签：世界库。档案由生成模型写成，随聊天存（progress.infinite.worlds）；
// 骰池、造世界规范、写法条目前缀是项目模板，存在项目文件里。
const st = view => view.tabState('worlds');
const infOf = view => normalizeInfinite(view.project().infinite);

function save(view, fn) {
    view.data.updateProject(view.projectId, project => ({ ...project, infinite: fn(normalizeInfinite(project.infinite)) }));
    view.runtime.refresh();
}

function worldRow(world, open, currentId) {
    const badges = world.id === currentId ? '<span class="pi-badge is-ok">当前</span>' : '';
    const body = open ? `<div class="pi-entry-bd">
        <p class="pi-hint">${esc(world.dice.horror)}｜周期 ${esc(world.dice.cycle)}｜${esc(world.dice.client)}｜情欲${esc(world.dice.lust)}</p>
        <pre class="pi-pre">${esc(world.body)}</pre>
        <div class="pi-tools is-c2">
            <button type="button" class="pi-btn is-sm" data-act="world-reopen" data-id="${esc(world.id)}"${currentId ? ' disabled' : ''}>重新打开</button>
            <button type="button" class="pi-btn is-sm is-danger" data-act="world-del" data-id="${esc(world.id)}">删除</button></div></div>` : '';
    return `<div class="pi-entry">
        <div class="pi-entry-hd" data-act="world-open" data-id="${esc(world.id)}">
            <span class="pi-etitle">${esc(world.title)}</span>${badges}</div>${body}</div>`;
}

// 世界库只显示当前聊天的世界；当前聊天没在用这个项目时不读别的聊天的进度。
function libraryCard(view, s) {
    if (view.runtime.activeId() !== view.projectId) {
        return '<div class="pi-card"><h3>世界库</h3><p class="pi-hint">世界库随聊天保存。把这个项目设为当前聊天使用后，才能看到这条聊天里的世界。</p></div>';
    }
    const inf = view.runtime.progress().infinite;
    const worlds = inf ? inf.worlds : [];
    const currentId = inf && inf.phase === 'world' ? inf.worldId : '';
    return `<div class="pi-card"><h3>世界库<span class="pi-meta">${worlds.length} 份</span></h3>
        ${worlds.length ? [...worlds].reverse().map(world => worldRow(world, s.open === world.id, currentId)).join('') : '<p class="pi-hint">这条聊天里还没有世界。到「执行」页点「进入新世界」，或等检测到下车时自动写出档案。</p>'}</div>`;
}

export function render(view) {
    const infinite = infOf(view);
    const s = st(view);
    return `${libraryCard(view, s)}
        <div class="pi-card"><h3>骰池</h3>
        <p class="pi-hint">每行「名称|权重」。情欲浓度写进档案末尾，由代码决定。</p>
        ${POOL_KEYS.map(key => `<label class="pi-field"><span>${POOL_LABELS[key]}</span><textarea class="pi-ta is-mono" data-pool="${key}">${esc(poolToText(infinite.pools[key]))}</textarea></label>`).join('')}</div>
        <div class="pi-card"><h3>造世界规范<span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="spec-reset">恢复默认</button></h3>
        <textarea class="pi-ta is-mono is-tall" data-spec>${esc(worldSpecText(infinite))}</textarea></div>
        <div class="pi-card"><h3>恐怖类型写法</h3>
        <p class="pi-hint">开副本时按「前缀 + 恐怖类型」到角色卡世界书里找同标题的条目（关闭的也能读到），正文放进造世界提示，不进正文注入。</p>
        <label class="pi-field"><span>条目标题前缀</span><input class="pi-inp" data-prefix value="${esc(infinite.config.horrorPrefix)}"></label></div>`;
}

export const actions = {
    'world-open'(view, target) {
        const s = st(view);
        s.open = s.open === target.dataset.id ? '' : target.dataset.id;
        view.renderBody();
    },
    'world-reopen'(view, target) {
        view.runtime.reopenWorld(target.dataset.id);
        view.renderBody();
    },
    async 'world-del'(view, target) {
        const id = target.dataset.id;
        const world = findWorld(view.runtime.progress().infinite?.worlds || [], id);
        if (!world) return;
        const ok = await confirmDialog({ title: `删除「${world.title}」`, body: '档案删除后不能恢复。', okLabel: '删除', danger: true });
        if (!ok) return;
        view.runtime.deleteWorld(id);
        view.renderBody();
    },
    'spec-reset'(view) {
        save(view, infinite => ({ ...infinite, spec: '' }));
        view.renderBody();
    },
};

export function onChange(view, target) {
    if (target.dataset.pool) {
        const key = target.dataset.pool;
        const rows = textToPool(target.value);
        save(view, infinite => ({ ...infinite, pools: { ...infinite.pools, [key]: rows } }));
        view.renderBody();
        return;
    }
    if (target.dataset.spec !== undefined) {
        const text = target.value.trim() === DEFAULT_WORLD_SPEC.trim() ? '' : target.value;
        save(view, infinite => ({ ...infinite, spec: text }));
        return;
    }
    if (target.dataset.prefix !== undefined) {
        save(view, infinite => ({ ...infinite, config: { ...infinite.config, horrorPrefix: target.value } }));
    }
}

export const refreshOn = ['progress', 'project', 'chat', 'switch', 'opened'];
