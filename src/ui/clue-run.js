import { catalogKnown, sceneCatalogCell, mainInProgress, aiFloorCount, START_MIN_AI } from '../core/lines.js';
import { ENDED_STATES, FOLD_AUTO_RELEASED } from '../core/fold.js';
import {
    discoveryList,
    clueText,
    tableCondChecks,
    prebuildPlan,
    prebuildDiff,
    nodeFactRefs,
    rowScope,
    nodeFrontier,
    startedLines,
    seedable,
    effectiveTables,
    condReads,
} from '../core/clue-project.js';
import {
    factLabelCheck,
    parseFactLabelReview,
    factLabelReviewMessages,
    factLabelSig,
    labelsToPrepare,
    labelBatches,
    labelBatchesBy,
    msgChars,
    reviewOutcome,
    factLineOf,
    factLabelContext,
    factLabelMessages,
    parseFactLabels,
} from '../core/fact-labels.js';

import { options, esc, confirmDialog, openDialog, menuDialog, promptDialog } from './dom.js';
import { readCell, findSheet, sheetRows, cellText, SEED_HOLD, SEED_OFF } from '../core/clue-tables.js';
import { stayState, normalizeClueOps, anchorValid } from '../core/clue-progress.js';

import { PLOT_MODES, isClueMode, normalizeClue } from '../core/clue-model.js';

import { stringifyYaml, parseYaml } from '../core/yaml.js';
import { acuApi } from '../app/clue-runtime.js';
import { NODE_STATUS_LABELS, AWAY_PREFIX, compileClue, computeClueState } from '../core/clue-rules.js';
import { ICONS, foldIcon } from './styles.js';
import { stageLabel, isPlainObject, lineShowName } from '../core/outline.js';
import { projectSecretNames } from '../core/store.js';
import { CLUE_SLOT } from '../core/progress.js';

import { estimateTokens } from '../core/tokens.js';
import { PACES } from '../core/inject.js';

import { chatMessages, ctx, toast, cardKey } from '../host/st.js';

import { importSecretNames } from '../core/long-import.js';

import { ask } from './ai.js';
import { progressHtml, startProgress, clearProgress } from './progress.js';

import { clueTplMismatch, synthesizeClueTemplate, clueTplHeader, findGlobalTable } from '../core/clue-template.js';

export const CLUE_STATUS_BADGE = { locked: '', available: 'is-accent', active: 'is-ok', done: 'is-dark' };

export const FOCUS_SOURCE = {
    manual: '手动选择',
    table: '按填表',
    auto: '唯一可进行',
    stale: '所选场景已不可进行',
    manualDone: '所选场景已完成，仅提供入口',
    none: '未确定',
    away: '主角不在任何剧情中，仅提供入口',
};

// inner：放在「运行设置」里时不单独成卡
export function modeCard(project, inner = !1) {
    let mode = project.clue ? project.clue.mode : 'outline',
        body = `<div class="pi-seg">${PLOT_MODES.map((item) => `<button type="button" class="pi-seg-btn${item.value === mode ? ' is-sel' : ''}" data-act="clue-mode" data-mode="${item.value}">${esc(item.label)}</button>`).join('')}</div>
        <p class="pi-hint">${mode === 'clue' ? '按主角实际获得的线索逐步开放剧情，进度随数据库填表更新。' : '按阶段顺序推进，每隔若干楼由AI检查当前阶段是否演完。'}</p>`;
    return inner ? `<div class="pi-run-sec"><div class="pi-run-sec-hd">推进方式</div>${body}</div>` : `<div class="pi-card"><h3>推进方式</h3>${body}</div>`;
}

export function bindingText(list) {
    return stringifyYaml(list).trim();
}

export function bindingCard(project, st7, tables = null, inner = !1) {
    let c = project.clue,
        b = c.bindings,
        open = st7.bindOpen,
        summary =
            [
                b.facts.length ? '事实表' : '',
                b.knowledge.length ? '知情表' : '',
                b.switch ? '主线开关' : '',
                b.scene ? '当前场景' : '',
                b.time ? '故事时间' : '',
            ]
                .filter(Boolean)
                .join('，') || '未绑定',
        path = b.scene && b.scene.路径,
        hasCatalog = !!(tables && path && catalogKnown(tables, path));
    return `<div class="${inner ? 'pi-run-sec' : 'pi-card'}"><${inner ? 'div class="pi-run-sec-hd"' : 'h3'}>表格绑定<span class="pi-meta">${esc(summary)}</span><span class="pi-spacer"></span>
        <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-bind-toggle">${open ? '收起' : '编辑'}</button></${inner ? 'div' : 'h3'}>
        ${
            open
                ? `<p class="pi-hint">指定插件从数据库的哪张表、哪一列读取线索。用「创建模板」建的表：点「填入示例」后「应用」；自建表：按示例修改表名和列名。</p>
        <textarea class="pi-ta is-mono is-tall" data-clue-bindings>${esc(bindingText(b))}</textarea>
        <div class="pi-tools is-c2 is-end"><button type="button" class="pi-btn is-sm" data-act="clue-bind-example">填入示例</button>
        <button type="button" class="pi-btn is-primary is-sm" data-act="clue-bind-apply">应用</button></div><p class="pi-status" data-clue-bind-status></p>`
                : ''
        }
        ${hasCatalog ? '' : '<div class="pi-tools is-c1"><button type="button" class="pi-btn is-sm is-wide" data-act="clue-catalog" title="手动贴场景目录：旧聊天的线索表没有「场景目录」列、又不想重新生成模板时用，复制一段对照文字，手动贴进表格说明">场景目录</button></div>'}</div>`;
}

export const BINDING_EXAMPLE = `facts:
  - {表: 关键事实表, 编号列: 编号, 状态列: 状态, 已核实值: 已核实, 说法值: 存疑, 内容列: 内容, 来源列: 依据}
knowledge:
  - {表: 知情表, 事实列: 事实, 角色列: 角色, 方式列: 获知方式, 可信度列: 可信度, 已核实值: 已核实, 来源列: 依据, 有效值: [亲见, 被告知, 听说, 推测]}
scene: {路径: 线索控制表/主线/当前场景, 离场值: 无}
time: {路径: [全局数据表/全局状态/当前时间, 线索控制表/主线/当前时间]}
`;

// 线索编号不给用户看：本次渲染里编号到名字的对照（标签，没有就用大纲里这条发现的文字）；取不到名字的写「一条线索」
let FACT_NAMES = new Map();
function buildFactNames(project, c) {
    let labels = isPlainObject(project.clue.labels) ? project.clue.labels : {},
        map = new Map();
    for (let s of c.state.nodeStates)
        for (let d of discoveryList(isPlainObject(s.node.item) ? s.node.item : {}))
            d.fact && !map.has(d.fact) && map.set(d.fact, (labels[d.fact] && labels[d.fact].label) || (d.text.length > 20 ? `${d.text.slice(0, 20)}…` : d.text));
    for (let k of Object.keys(labels)) labels[k] && labels[k].label && map.set(k, labels[k].label);
    return map;
}
export function factName(code) {
    return FACT_NAMES.get(code) || '';
}
// 编号列表缩成「名字、名字、名字等N条」；一个名字都取不到只说条数
export function factNamesText(codes) {
    let names = codes.map(factName).filter(Boolean);
    return names.length ? `${names.slice(0, 3).join('、')}${codes.length > 3 ? `等${codes.length}条` : ''}` : `${codes.length}条线索`;
}
function maskFacts(text) {
    let codes = [...FACT_NAMES.keys()].sort((a, b) => b.length - a.length);
    return codes.reduce((t, k) => t.split(k).join(`「${FACT_NAMES.get(k) || '一条线索'}」`), String(text));
}
export function reasonList(result) {
    return result && result.reasons && result.reasons.length
        ? result.reasons
              .slice(0, 4)
              .map((r) => `<li>${esc(maskFacts(r))}</li>`)
              .join('')
        : '';
}

export function nodeRow(s, focusUid, open) {
    let badge = CLUE_STATUS_BADGE[s.status],
        flags = [
            s.node.required ? '' : '可选',
            s.skipped ? '已跳过' : '',
            s.disabled ? '暂时停用' : '',
            s.manualOpen ? '手动开放' : '',
            s.done.manual ? '手动完成' : '',
        ]
            .filter(Boolean)
            .join('，'),
        why = s.status === 'locked' ? reasonList(s.open) : s.status !== 'done' ? reasonList(s.done) : '';
    return `<div class="pi-clue-node${s.node.uid === focusUid ? ' is-focus' : ''}">
        <div class="pi-clue-hd" data-act="clue-node-open" data-uid="${esc(s.node.uid)}">
            <span class="pi-badge ${badge}">${esc(NODE_STATUS_LABELS[s.status])}</span>
            <span class="pi-clue-name">${esc(s.node.name)}</span>
            ${flags ? `<span class="pi-meta">${esc(flags)}</span>` : ''}
            ${s.node.uid ? `<button type="button" class="pi-icon-btn" data-act="clue-node-menu" data-uid="${esc(s.node.uid)}" title="手动调整" aria-label="手动调整">${ICONS.more}</button>` : ''}</div>
        ${open || why ? `<ul class="pi-clue-why">${open ? reasonList(s.open) + reasonList(s.done) : why}</ul>` : ''}</div>`;
}

// 一个阶段：状态、还差哪些必需节点、进入 / 结束条件；节点默认写出没开放、没完成的原因。
// 线索执行页以合并前的本地设计为主（用户 2026-11-23）。lineName：多条线时写在阶段名前，分清是哪条线的。
export function stageBlock(unit, stage, nodes, focusUid, st7, lineName = '') {
    let live = stage.entered.v === 'true' && !stage.done,
        state = stage.done ? '已结束' : live ? '进行中' : '未进入',
        left = stage.requiredLeft.length && live ? `未完成的必需节点：${stage.requiredLeft.map((n) => n.name).join('、')}` : '',
        endWhy = live && !stage.requiredLeft.length && stage.end.v !== 'true' ? `结束条件：${maskFacts(stage.end.reasons.join('；'))}` : '',
        enterWhy = stage.entered.v !== 'true' ? maskFacts(stage.entered.reasons.join('；')) : '';
    return `<div class="pi-clue-stage is-${stage.done ? 'done' : live ? 'active' : 'todo'}">
        <div class="pi-tl-hd"><span class="pi-tl-name">${lineName ? `<span class="pi-clue-line">${esc(lineName)}</span>` : ''}${esc(stageLabel(unit.stage.key))}</span><span class="pi-tl-state">${state}</span></div>
        ${[left, endWhy, enterWhy]
            .filter(Boolean)
            .map((t) => `<p class="pi-hint">${esc(t)}</p>`)
            .join('')}
        ${nodes.map((s) => nodeRow(s, focusUid, st7.nodeOpen === s.node.uid)).join('')}</div>`;
}

export function mainlineCard(c, enabled = '') {
    let units = c.compiled.units,
        multi = (c.state.lineStates || []).length > 0,
        done = units.length > 0 && units.every((u) => (c.state.stageStates.get(u.id) || {}).done),
        leads = c.state.nodeStates.filter((s) => s.status === 'available' && !s.disabled).length,
        title2 = multi ? '剧情' : '主线';
    return c.prog.paused
        ? `<div class="pi-card"><h3>${title2}${enabled}<span class="pi-badge is-warn">已暂停</span><span class="pi-spacer"></span>
        <button type="button" class="pi-btn is-sm is-primary" data-act="clue-pause" data-value="">继续剧情</button></h3>
        <p class="pi-hint">暂停中：不注入线索，仅保留设定；进度保留，继续后从当前进度推进。</p></div>`
        : done && !multi
          ? `<div class="pi-card"><h3>主线${enabled}<span class="pi-badge is-ok">已全部完成</span><span class="pi-spacer"></span>
        <button type="button" class="pi-btn is-sm" data-act="clue-pause" data-value="1">暂停剧情</button>
        <button type="button" class="pi-btn is-sm is-primary" data-act="clue-next" title="开始下一段主线">下一段主线…</button></h3>
        <p class="pi-hint">${leads ? `尚有${leads}个未进行的非必需节点，会作为「可去做的事」提供给正文；不需要可暂停剧情。` : '没有可进行的线索事项。'}继续推进请点「开始下一段主线」新建主线。</p></div>`
          : `<div class="pi-card"><h3>${title2}${enabled}<span class="pi-badge is-ok">进行中</span><span class="pi-spacer"></span>
        ${multi ? pauseMenu(c) : '<button type="button" class="pi-btn is-sm" data-act="clue-pause" data-value="1" title="所有线索内容不再注入，进度保留">暂停剧情</button>'}</h3>${multi ? `<p class="pi-hint">${esc(lineSummary(c))}</p>` : ''}</div>`;
}

// 所有线进行中的阶段都展开；其余收在「其他阶段」里，点开再看
function nodeGroups(groups, st7) {
    if (!groups.length) return '';
    let live = groups.filter((g) => g.live),
        rest = groups.filter((g) => !g.live);
    if (!live.length || !rest.length) return groups.map((g) => g.html).join('');
    let open = !!st7.stagesOpen;
    return `${live.map((g) => g.html).join('')}<button type="button" class="pi-run-fold is-sub" data-act="run-fold" data-key="stagesOpen" aria-expanded="${open}">${foldIcon(open)}<span>其他阶段</span><span class="pi-fold-count">${rest.length}</span></button>${open ? rest.map((g) => g.html).join('') : ''}`;
}

// 线的显示名：编号 + 名称，名称里已带编号的不重复；不用「·」（用户 2026-11-16）
export function lineDisplayName(l) {
    return lineShowName(l);
}
function lineSummary(c) {
    let list = c.state.lineStates || [],
        on = (k) => list.filter((s) => s.line.kind === k && s.state === '进行中').length,
        sides = list.filter((s) => s.line.kind === 'side').length,
        limit = c.plan ? c.plan.slots.limit : 1;
    return `主线${on('main')}条进行中${sides ? `；支线${on('side')}/${limit}条` : ''}${c.prog.mainPaused ? '；主线已全部暂停' : ''}${c.prog.sidePaused ? '；支线已全部暂停' : ''}`;
}
function pauseMenu(c) {
    let list = c.state.lineStates || [],
        mains = list.filter((s) => s.line.kind === 'main').length,
        sides = list.filter((s) => s.line.kind === 'side').length;
    return `<details class="pi-line-more pi-pause-menu"><summary class="pi-btn is-sm">暂停${ICONS.chevDown}</summary><div class="pi-line-menu">
        <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-pause" data-value="1" title="去玩日常：所有线索内容都不注入，进度保留">暂停全部剧情</button>
        ${mains ? `<button type="button" class="pi-btn is-sm is-ghost" data-act="clue-pause-mains" data-value="${c.prog.mainPaused ? '' : '1'}" title="${c.prog.mainPaused ? '主线恢复注入；原来进行中的主线接着演' : '所有主线都不推进、不注入；支线照常'}">${c.prog.mainPaused ? '继续主线' : '只暂停主线'}</button>` : ''}
        ${sides ? `<button type="button" class="pi-btn is-sm is-ghost" data-act="clue-pause-side" data-value="${c.prog.sidePaused ? '' : '1'}" title="${c.prog.sidePaused ? '支线恢复注入和提示；原来进行中的支线接着演' : '所有支线都不注入、不提示新的；主线照常，进度和名额都保留'}">${c.prog.sidePaused ? '继续支线' : '只暂停支线'}</button>` : ''}</div></details>`;
}
function lineOpts(c, project) {
    let list = c.state.lineStates || [],
        sides = list.filter((s) => s.line.kind === 'side');
    if (!sides.length) return '';
    let limit = c.plan ? c.plan.slots.limit : 1;
    return `<div class="pi-row pi-line-opts"><label class="pi-check"><span>同时进行的支线</span><select class="pi-sel is-sm" data-clue-sidelimit>${options(
        [
            { value: '1', label: '最多1条' },
            { value: '2', label: '最多2条' },
        ],
        String(limit),
    )}</select></label>
          <label class="pi-check"><input type="checkbox" data-clue-linetoast${project.clue.lineToast !== !1 ? ' checked' : ''}><span>剧情线变化时在顶端提示（自动开始、支线已满、收起）</span></label></div>`;
}
// 收起已结束的线：存储模式放行后才显示开关（方案 三.7、三.9）
function foldOpts(project, foldChat) {
    let api = acuApi(),
        storage = api && typeof api.querySql == 'function' ? 'sqlite' : 'native';
    if (!api || !FOLD_AUTO_RELEASED[storage]) return '';
    return `<div class="pi-row pi-line-opts"><label class="pi-check"><input type="checkbox" data-clue-foldauto${project.clue.foldAuto !== !1 ? ' checked' : ''}><span>收起已结束的线</span></label></div><p class="pi-hint">已结束剧情线的表格行移入插件记录并从表格删除，剧情判断不受影响。</p>`;
}
// 「提前登记已撤回」（线索建行与登记方案 二.3）：节点前提还没成立就被登记的线索，表格已改回未获得（原生存储只在插件里不算）。
// 作者顺序写错、玩家确实先查到了时点「保留这次登记」，按撤回前的原样恢复。
function withdrawnRows(clue, project) {
    let labels = isPlainObject(project.clue.labels) ? project.clue.labels : {};
    return clue.withdrawnList().map((w) => {
        let name = w.label || (labels[w.f] && labels[w.f].label) || factName(w.f) || '一条线索',
            was = [w.raw, w.text].filter(Boolean).join('：'),
            head = w.table === 'ok' ? '提前登记已撤回' : '提前登记，暂不算';
        return `<div class="pi-row is-todo"><p class="pi-hint is-warn" title="${esc(w.f)}">${esc(head)}：${esc(name)}${was ? `（原登记：${esc(was.length > 40 ? `${was.slice(0, 40)}…` : was)}）` : ''}。前面的剧情还没走到这一步。</p><button type="button" class="pi-btn is-sm" data-act="clue-wd-keep" data-id="${esc(w.f)}" title="确实已经查到：按原来的登记恢复">保留这次登记</button><button type="button" class="pi-btn is-sm is-ghost" data-act="clue-wd-drop" data-id="${esc(w.f)}" title="不恢复，只从这里移走">不保留</button></div>`;
    });
}
export function renderClueRun(view, project, st7) {
    let { runtime } = view,
        clue = runtime.clue,
        c = clue.compute(),
        d = clue.diagnose();
    if (!c) return modeCard(project);
    FACT_NAMES = buildFactNames(project, c);
    let multi = (c.state.lineStates || []).length > 0,
        problems = [...c.snap.problems, ...c.compiled.errors, ...c.state.cycles.map((u) => `节点${u}条件循环引用`)],
        focus = c.state.focus,
        focusNode = c.state.nodeStates.find((s) => s.node.uid === focus.uid),
        entries = runtime.entries(),
        clueEntry = entries.find((e) => e.slotId === CLUE_SLOT),
        enabled = c.snap.enabled === !1 ? '<span class="pi-badge is-warn">主线关闭</span>' : '',
        paused = c.prog.paused ? '<span class="pi-badge is-warn">已暂停</span>' : '',
        // 节点：所有线的阶段（进行中的展开，其余收起）；多条线时阶段名前写线名
        groups = c.compiled.units.map((unit) => {
            let stage = c.state.stageStates.get(unit.id);
            return {
                live: stage.entered.v === 'true' && !stage.done,
                html: stageBlock(unit, stage, c.state.nodeStates.filter((s) => s.node.unit === unit), focus.uid, st7, multi && unit.line ? lineDisplayName(unit.line) : ''),
            };
        }),
        last = clue.lastInjected();
    // 运行设置：没绑定或没连上数据库时自动展开；里面按「线索表格 / 推进 / 高级」分段
    let b0 = project.clue.bindings,
        unbound = !(b0.facts.length || b0.knowledge.length),
        setOpen = st7.setOpen !== void 0 ? st7.setOpen : unbound || !c.snap.api,
        mode0 = (PLOT_MODES.find((m) => m.value === project.clue.mode) || PLOT_MODES[0]).label,
        setSummary = [mode0, unbound ? '表格未绑定' : '表格已绑定', `推进速度${(PACES.find((x) => x.value === runtime.progress().pace) || PACES[1]).label}`].join('，'),
        settings = `<div class="pi-card pi-run-set"><h3><button type="button" class="pi-run-fold" data-act="run-set-toggle" aria-expanded="${setOpen}">${foldIcon(setOpen)}<span>运行设置</span></button>${setOpen ? '' : `<span class="pi-meta" title="${esc(setSummary)}">${esc(setSummary)}</span>`}</h3>
        ${
            setOpen
                ? `<div class="pi-rl-sec"><div class="pi-run-sec-hd">线索表格</div><div class="pi-tools is-c3"><button type="button" class="pi-btn is-sm" data-act="clue-prebuild" title="表已经建好、大纲后来又加了线索时用：把缺的行补进关键事实表、知情表；已有的行不动">补全表格…</button><button type="button" class="pi-btn is-sm" data-act="clue-labels-edit" title="修改关键事实表里已有线索的标签和登记口径">修改线索…</button><button type="button" class="pi-btn is-sm" data-act="clue-gen-template" title="在当前聊天的表格上加入三张线索表（带上大纲要用的行），并调整默认表的规则；先预览，确认后才写入">创建模板</button></div></div>
        <div class="pi-rl-sec"><div class="pi-run-sec-hd">推进</div><div class="pi-pace"><span class="pi-pace-label">推进速度</span><div class="pi-seg">${PACES.map((pace) => `<button type="button" class="pi-seg-btn${pace.value === runtime.progress().pace ? ' is-sel' : ''}" data-act="pace" data-pace="${pace.value}">${pace.label}</button>`).join('')}</div></div>${lineOpts(c, project)}${multi ? foldOpts(project, clue.foldChat()) : ''}</div>
        <div class="pi-rl-sec"><div class="pi-run-sec-hd">高级</div>${modeCard(project, !0)}${bindingCard(project, st7, c.snap.api ? c.snap.tables : null, !0)}</div>`
                : ''
        }</div>`;
    // 需要处理：每行带能解决它的按钮；数据库没连上只在这里完整说一次（写明进度不受影响）
    let labelRow = multi ? labelsPendingHtml(project, c) : '',
        noDb = !c.snap.api,
        // 换到新聊天时线索表还没建：缺表的几行合成一行，直接带「创建模板」
        lack = noDb ? [] : problems.filter((p) => /^缺少表「/.test(p)),
        lackRow = lack.length
            ? `<div class="pi-row is-todo"><p class="pi-hint is-warn">当前聊天还没有线索表（${esc(lack.map((p) => p.replace(/^缺少表/, '')).join('、'))}）。</p><button type="button" class="pi-btn is-sm is-primary" data-act="clue-gen-template">创建模板</button></div>`
            : '',
        // 补行 / 表结构出问题时旁边带「重新创建模板」
        rowBtn = (text, act, label, tip = '', remake = !1) => `<div class="pi-row is-todo"><p class="pi-hint is-warn"${tip ? ` title="${esc(tip)}"` : ''}>${esc(text)}</p><button type="button" class="pi-btn is-sm" data-act="${act}">${label}</button>${remake ? '<button type="button" class="pi-btn is-sm is-ghost" data-act="clue-gen-template" title="表格出了问题时用：按大纲重新生成线索模板写入当前聊天，先预览，确认后才写入">重新创建模板</button>' : ''}</div>`,
        gapHit = !1,
        problemRows = problems.filter((p) => !lack.includes(p)).map((p) => {
            let gap = /^事实表里没有这些编号的行：(.+?)（/.exec(p);
            if (gap) return ((gapHit = !0), rowBtn(`关键事实表里还没有这些线索的行：${factNamesText(gap[1].split('、').filter(Boolean))}。`, 'clue-prebuild', '补全表格', gap[1], !0));
            if (/^表「.*缺少.*列|已核实值|方式列/.test(p)) return rowBtn(p, 'run-set-open', '打开表格绑定', '', !0);
            return `<p class="pi-hint is-warn">${esc(noDb && p === c.snap.problems[0] ? '没有检测到数据库插件（shujuku），当前无法注入。剧情线的进度不受影响，装好并开启数据库插件后接着用。' : p)}</p>`;
        }),
        // 表和标签都准备好了、本轮该有的线索仍没有行：单独一行（已有「事实表里没有…」那一行时不重复）
        newRow = '';
    // 事实表绑定缺编号列 / 状态列时读不出事实，不从空表推出缺行（GPT 实测修复审阅 R2）
    if (!noDb && !lack.length && !gapHit && !c.snap.factsBroken && c.snap.facts instanceof Map) {
        let notReady = new Set(labelsToPrepare(project.outline.volumes, project.clue.labels).filter((x) => !c.snap.facts.has(x.code)).map((x) => x.code)),
            keep = c.snap.scope ? c.snap.scope.facts : null,
            pend = c.snap.seedPending || /* @__PURE__ */ new Set(),
            miss = prebuildPlan(project.outline.volumes).facts.filter((f) => (!keep || keep.has(f.code)) && !c.snap.facts.has(f.code) && !notReady.has(f.code) && !pend.has(f.code));
        miss.length && (newRow = rowBtn(`大纲里有${miss.length}条线索在表格里还没有行。`, 'clue-prebuild', '补全表格', '', !0));
    }
    let staleN = noDb || lack.length ? 0 : staleLabelCount(project, c),
        staleRow = staleN ? rowBtn(`有${staleN}条线索的口径改了，当前聊天的表格还是旧的。`, 'clue-labels-edit', '修改线索') : '',
        todo = [...(lackRow ? [lackRow] : []), ...problemRows, ...(newRow ? [newRow] : []), ...(labelRow ? [labelRow] : []), ...(staleRow ? [staleRow] : []), ...withdrawnRows(clue, project)],
        // 本场的线索还没准备好行时，这一轮不给正文（显示线索名，不显示编号）
        notReadyCodes =
            c.notReady && c.notReady.size && focusNode
                ? discoveryList(isPlainObject(focusNode.node.item) ? focusNode.node.item : {})
                      .filter((d2) => d2.fact && c.notReady.has(d2.fact))
                      .map((d2) => d2.fact)
                : [],
        sceneLine = `<p class="pi-hint">${hereText(c)}本轮场景：${focusNode ? `<b>${esc(focusNode.node.name)}</b>（${esc(FOCUS_SOURCE[focus.source])}）` : esc(FOCUS_SOURCE[focus.source])}${focusNode ? ` <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-leave" data-uid="${esc(focusNode.node.uid)}" title="主角已离开这件事：不再注入这件事的场景和发现，仅提供入口">已离开</button>` : ''}${c.prog.focus ? ` <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-unfocus" title="回到按填表判断本轮场景">${c.prog.focus.startsWith(AWAY_PREFIX) ? '未离开' : '取消手选'}</button>` : ''}</p>`;
    return `${progressHtml('prebuild')}${todo.length ? `<div class="pi-card"><h3>需要处理<span class="pi-badge is-warn">${todo.length}</span></h3><div class="pi-rl-stack">${todo.join('')}</div></div>` : ''}
        ${mainlineCard(c, enabled)}${lineCard(c, project, st7, multi ? clue.foldCheck() : null, view)}
        <div class="pi-card"><h3>本轮场景${paused}<span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-refresh">重新读表</button>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="preview">预览</button></h3>
        ${sceneLine}
        ${stayNotice(view, c)}
        ${unofferedHtml(c, project)}
        ${(c.hints || []).map((h) => `<p class="pi-hint is-warn">两表核对：${esc(h)}</p>`).join('')}
        ${notReadyCodes.length ? `<p class="pi-hint is-warn">本场有线索尚在准备，本轮暂不提供给正文：${esc(factNamesText(notReadyCodes))}。下次填表后自动补齐；长期没补齐可以用「补全表格」。</p>` : ''}
        ${!c.prog.paused && d.plot && d.plot.items.length ? `<p class="pi-hint is-warn">数据库剧情推进预设「${esc(d.plot.preset)}」里启用了召回以外的任务：${esc(d.plot.items.map((x) => `「${x.task}」（输出${x.tags.join('、')}）`).join('、'))}。它们会替角色安排行动，可能和线索剧情抢方向。建议在数据库里先关掉，只留召回（插件不会替你改）。</p>` : ''}
        <p class="pi-hint">本轮注入${clueEntry && clueEntry.content ? `约${estimateTokens(clueEntry.content)} token` : `内容为空${!c.snap.api ? '（数据库未连接）' : clueEntry && clueEntry.reason ? `（${esc(clueEntry.reason)}）` : ''}`}${last ? `；上次实际注入${new Date(last.at).toLocaleTimeString('zh-CN', { hour12: !1 })}，${last.chars}字` : ''}。</p>
        <p class="pi-hint">依据数据库最近一次填好的表格计算${d.lastTableUpdate ? `（表格${new Date(d.lastTableUpdate).toLocaleTimeString('zh-CN', { hour12: !1 })}更新）` : ''}。上一轮填表未完成就发送时，新线索晚一轮生效。</p>
        </div>
        <div class="pi-card"><h3>节点<span class="pi-meta">点节点查看条件，「⋯」手动调整</span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="rewrite" title="根据已发生的剧情和线索进度，由AI改写未结束的阶段；结果先存为草稿，不直接覆盖">改写后续</button></h3>
        ${nodeGroups(groups, st7) || '<p class="pi-hint">大纲为空。</p>'}</div>
        ${settings}
        ${clueLogCard(runtime, st7)}`;
}

export function clueLogCard(runtime, st7) {
    let prog = runtime.progress(),
        allOps = normalizeClueOps(prog.clue).ops,
        ops = allOps.slice(-12).reverse(),
        open = !!st7.logOpen,
        chat = chatMessages();
    return ops.length
        ? `<div class="pi-card pi-run-set"><h3><button type="button" class="pi-run-fold" data-act="run-fold" data-key="logOpen" aria-expanded="${open}">${foldIcon(open)}<span>操作记录</span></button><span class="pi-fold-count">${allOps.length}</span></h3>${open ? ops.map((op) => `<p class="pi-hint${anchorValid(op.at, chat) ? '' : ' is-off'}">${new Date(op.time).toLocaleString('zh-CN', { hour12: !1 })}　${esc(runtime.clue.opLabel(op))}${anchorValid(op.at, chat) ? '' : '（所在楼层已回退，未生效）'}</p>`).join('') : ''}</div>`
        : '';
}

// stored：项目已存标签；线索内容未变（签名一致）则直接沿用，不重新生成
export function factRowsHtml(facts, prefix, volumes, stored = {}, { intro = !0 } = {}) {
    let ctx = new Map(
        factLabelContext(
            volumes,
            facts.map((f) => f.code),
        ).map((x) => [x.code, x]),
    );
    let row = (f, i) => {
        let c = ctx.get(f.code) || {},
            have = f.now || storedLabel(stored, f.code, c),
            where = [c.stage, c.nodeName].filter(Boolean).join('，');
        return `<div class="pi-prebuild-row" data-fr-row="${i}">
          <div class="pi-fr-hd"><b>${esc(where || f.code)}</b><span class="pi-meta">${esc(f.code)}</span>${f.orphan || c.orphan ? '<span class="pi-badge is-warn">大纲里没有节点产出它</span>' : ''}<span class="pi-badge pi-fr-st${have && have.label ? ' is-ok' : ''}" data-fr-st="${i}">${have && have.label ? '已填' : '待填'}</span></div>
          ${c.answer ? `<p class="pi-fr-answer">这条线索查到的是：${esc(c.answer)}<span class="pi-meta">（只给你看，不会写进表格）</span></p>` : ''}
          <label class="pi-field"><span>标签：给它起个不透露答案的名字</span><input class="pi-inp" data-${prefix}-label="${i}" value="${esc(have ? have.label : '')}"></label>
          <label class="pi-field"><span>正文写到哪一步，才算拿到了它</span><textarea class="pi-ta" rows="2" data-${prefix}-crit="${i}">${esc(have ? have.criterion : '')}</textarea></label>
          <div class="pi-fr-warn" data-fr-warn="${i}"></div></div>`;
    };
    // 用户 2026-11-23：「自动填写」要一眼看到、点了知道开始了、看得到进度；说明收起，不挡按钮
    let n = facts.length,
        filledN = facts.filter((f) => {
            let c = ctx.get(f.code) || {},
                have = f.now || storedLabel(stored, f.code, c);
            return have && have.label;
        }).length;
    return `<div class="pi-fr" data-fr="${prefix}">
          <div class="pi-fr-start"${intro ? '' : ' hidden'}><button type="button" class="pi-btn is-primary is-lg${filledN >= n ? ' is-done' : ''}" data-fr-auto>${startFace(filledN >= n ? '' : filledN ? `开始自动填写（还有${n - filledN}条）` : `开始自动填写（共${n}条）`)}</button>
          ${(clearProgress(`fr-${prefix}`), progressHtml(`fr-${prefix}`))}</div>
          <p class="pi-hint" data-fr-status>${intro ? (filledN >= n ? '已经按以前填过的内容填好了。想重新生成某条，先清空它的框再点上面的按钮。' : 'AI按大纲写好标签和判定说明，你只需要检查标黄的地方。也可以自己填。') : '标黄的地方是插件检查出的问题，照着改框里的字就行。'}</p>
          <details class="pi-fr-intro"${intro ? '' : ' hidden'}><summary>这一步在做什么</summary>
          <p>每轮正文写完后，数据库的填表模型会对照这里的说明，判断主角有没有拿到某条线索；拿到了，后面的剧情才会开放。</p>
          <p>所以每条线索要两样东西：一个<b>标签</b>，让填表模型认出是哪一条；一句<b>「写到哪一步才算拿到」</b>。这句写得太宽，主角还没真正查到就会被算作拿到，剧情会提前推进。</p>
          <p>这两样每一轮都会发给填表模型，所以<b>不能写出答案</b>：写「打开抽屉、读到单据时」，不写单据上写了什么。</p>
          <p class="is-example">例　标签：抽屉里的单据　｜　写到哪一步：主角打开抽屉、读到单据内容时算拿到；只看到锁着的抽屉不算</p></details>
          <div class="pi-tools is-c1"${intro ? ' hidden' : ''}><button type="button" class="pi-btn is-sm" data-fr-check>检查</button></div>
          ${facts.map(row).join('')}</div>`;
}

// 大按钮的字：空串 = 都填好了
const startFace = (text) => (text ? `${ICONS.spark}<span>${text}</span>` : `${ICONS.check}<span>已全部填好</span>`);

// 项目里存的标签 / 口径和当前聊天表格里不一样的条数（大纲改完重新生成后，表格要到「修改线索」里保存才更新，实测问题 5）。
// 只看表里的正式行；只有模板初始行（还没填过表）时不算，那时「修改线索」先存进项目
function staleLabelCount(project, c) {
    let fb = (project.clue.bindings.facts || [])[0],
        found = fb && c.snap.tables ? findSheet(c.snap.tables, fb.表) : null;
    if (!found || found.error || !found.sheet || !Array.isArray(found.sheet.content)) return 0;
    let own = found.sheet.content.slice(1).filter(Array.isArray);
    if (!own.length) return 0;
    let { col } = sheetRows({ ...found.sheet, [SEED_OFF]: void 0 }),
        ci = { code: col(fb.编号列 || ''), label: col('标签'), crit: col('登记口径') };
    if (ci.code < 0 || ci.label < 0 || ci.crit < 0) return 0;
    let codes = own.map((r) => cellText(r[ci.code])).filter(Boolean),
        ctx = new Map(factLabelContext(project.outline.volumes, codes).map((x) => [x.code, x]));
    return own.filter((r) => {
        let code = cellText(r[ci.code]),
            s = code && storedLabel(project.clue.labels, code, ctx.get(code));
        return !!s && !!s.label && (s.label !== cellText(r[ci.label]) || s.criterion !== cellText(r[ci.crit]));
    }).length;
}
function storedLabel(stored, code, c) {
    let have = stored && stored[code];
    return have && have.label && have.sig === factLabelSig(c && c.code ? c : { code, usedBy: [] }) ? have : null;
}

// opts.gate：弹窗主按钮原来的字。标签没填完时主按钮变灰、写明还差几条（用户 2026-11-23：以前能点，点了才说没填完，窗口还关了）。
// opts.keep：自动填写完就把标签存进项目，窗口关了再开不用重来（改已有标签的弹窗不传，那边有自己的保存）。
export function mountFactRows(view, root, facts, prefix, volumes, { gate = '', keep = !1 } = {}) {
    let box = root.querySelector(`[data-fr="${prefix}"]`);
    if (!box) return;
    let project = view.project(),
        ids = project && Array.isArray(project.imports) ? project.imports : [],
        secrets = [],
        secretsNote = '',
        ctx = new Map(
            factLabelContext(
                volumes,
                facts.map((f) => f.code),
            ).map((x) => [x.code, x]),
        ),
        unsure = /* @__PURE__ */ new Map(),
        field = (i, k) => box.querySelector(`[data-${prefix}-${k}="${i}"]`),
        status = box.querySelector('[data-fr-status]'),
        secretsReady = Promise.all(
            ids.map((id) =>
                view.data.imports.get(id) ? Promise.resolve(view.data.imports.get(id)) : view.data.imports.load(id).catch(() => null),
            ),
        ).then((jobs) => {
            let missing = jobs.filter((j) => !j).length;
            // 保密名单：导入任务的人物索引 + 项目自存名单（导入的项目文件只有后者）
            ((secrets = [...new Set([...jobs.filter(Boolean).flatMap((j) => importSecretNames(j.index) || []), ...(projectSecretNames(project) || [])])]),
                (secretsNote = missing ? `有${missing}份导入记录无法读取，未核对其中的保密名称。` : ''),
                secretsNote && (status.textContent = `${status.textContent} ${secretsNote}`),
                facts.forEach((_, i) => (field(i, 'label').value.trim() || field(i, 'crit').value.trim()) && check(i)));
        }),
        reviewed = /* @__PURE__ */ new Map(),
        // made：模型填过的行及其文字，框内未被改动才有效。whole＝两框均由模型写：只有 whole 行自动送检、自动替换、保存记 gen / ai；
        // 其余按用户写的处理（保存记 user，要检查点「检查」）。
        made = /* @__PURE__ */ new Map(),
        isMade = (code, label, criterion) => {
            let m = made.get(code);
            return !!m && m.label === label && m.criterion === criterion;
        },
        isWhole = (code, label, criterion) => isMade(code, label, criterion) && made.get(code).whole,
        check = (i) => {
            let f = facts[i],
                value = { label: field(i, 'label').value.trim(), criterion: field(i, 'crit').value.trim() },
                r = factLabelCheck({ ...value, unsure: unsure.get(f.code) || '' }, ctx.get(f.code) || {}, { secrets }),
                out = box.querySelector(`[data-fr-warn="${i}"]`),
                rv = reviewed.get(f.code),
                same = rv && rv.label === value.label && rv.criterion === value.criterion,
                warns = [...r.warns],
                notes = [...r.notes];
            if (same && rv.leak) warns.push(`会透露答案：${rv.what || '标签或口径里写出了查到的内容'}`);
            else if (!same) for (let s of r.suspects) warns.push(`${s.where}里有答案的片段「${s.piece}」`);
            return (
                same && rv.fixed && notes.push(`已自动改写，原来的写法会透露答案（${rv.what || '写出了查到的内容'}）`),
                (out.innerHTML = [
                    ...warns.map((x) => `<p class="pi-warn-line">${esc(x)}</p>`),
                    ...notes.map((x) => `<p class="pi-note-line">${esc(x)}</p>`),
                ].join('')),
                box.querySelector(`[data-fr-row="${i}"]`).classList.toggle('is-warn', warns.length > 0),
                rowState(i, warns.length > 0),
                warns.length
            );
        },
        rowState = (i, warn) => {
            let b = box.querySelector(`[data-fr-st="${i}"]`);
            if (!b) return;
            let has = !!field(i, 'label').value.trim();
            ((b.className = `pi-badge pi-fr-st${!has ? '' : warn ? ' is-warn' : ' is-ok'}`), (b.textContent = !has ? '待填' : warn ? '标黄' : '已填'), sync());
        },
        dlg = root.closest ? root.closest('.pi-dialog') || root : root,
        mainBtn = gate ? [...dlg.querySelectorAll('[data-dlg]')].find((b) => b.classList.contains('is-primary')) : null,
        startBtn = box.querySelector('[data-fr-auto]'),
        running = !1,
        sync = () => {
            let left = facts.filter((_, i) => !field(i, 'label').value.trim()).length;
            mainBtn && ((mainBtn.disabled = running || left > 0), (mainBtn.textContent = running ? '正在填写…' : left ? `还差${left}条没填` : gate));
            startBtn && !running && (startBtn.classList.remove('is-busy'), startBtn.classList.toggle('is-done', !left), (startBtn.innerHTML = startFace(left ? `开始自动填写（还有${left}条）` : '')));
        };
    sync();
    box.addEventListener('input', (event) => {
        let m = event.target.closest('[data-fr-row]');
        m && (unsure.delete(facts[Number(m.dataset.frRow)].code), check(Number(m.dataset.frRow)));
    });
    // 审阅按大小分批，最多 3 批并行；某批失败时抛出首个错误，其余批结果照常使用。
    // got：本次请求已收到结果的编号，漏回数据此计算。
    let got = /* @__PURE__ */ new Set();
    let reviewItem = ({ f, i }) => {
        let c = ctx.get(f.code) || {},
            label = field(i, 'label').value.trim(),
            criterion = field(i, 'crit').value.trim();
        return {
            code: f.code,
            label,
            criterion,
            answer: [c.answer, ...(c.routes || []).map((r) => r.answer)].filter(Boolean).join('；或者：'),
            entry: c.entry,
            scene: c.scene,
            record: [c.record, ...(c.routes || []).map((r) => r.record)].filter(Boolean).join('；或者：'),
            pieces: factLabelCheck({ label, criterion }, c, { secrets }).suspects.map((s) => s.piece),
        };
    };
    async function reviewRows(rows) {
        let todo = rows.filter(({ i }) => field(i, 'label').value.trim() || field(i, 'crit').value.trim()),
            fixed = 0,
            errs = [];
        got = /* @__PURE__ */ new Set();
        // 按实际消息长度切批；检查项只组一次，量长度和发送共用
        let rows2 = todo.map((r) => ({ ...r, item: reviewItem(r) }));
        await runLabelPool(
            labelBatchesBy(rows2, (batch) => msgChars(factLabelReviewMessages(batch.map((r) => r.item)))).map((batch) => async () => (fixed += await reviewBatch(batch))),
            (e) => errs.push(e),
        );
        if (errs.length) throw errs[0];
        return fixed;
    }
    async function reviewBatch(todo) {
        let items = todo.map((r) => r.item || reviewItem(r)),
            map = parseFactLabelReview(
                await ask(view, 'outline', factLabelReviewMessages(items)),
                items.map((x) => x.code),
            ),
            fixed = 0;
        // 结果按发出时的文字记录，框内已改动则丢弃；是否算检查过由 reviewOutcome 判定
        for (let [k, { f, i }] of todo.entries()) {
            let v = map.get(f.code),
                sent = items[k],
                o = reviewOutcome(v, sent);
            if (field(i, 'label').value.trim() !== sent.label || field(i, 'crit').value.trim() !== sent.criterion) continue;
            if (!v || v.leak === null || v.leak === void 0) continue;
            got.add(f.code);
            if (v.leak && o.ok && isWhole(f.code, sent.label, sent.criterion)) {
                // 模型所写且给出改法：自动替换并算已检查
                (field(i, 'label').value = o.label), (field(i, 'crit').value = o.criterion), fixed++;
                let now = { label: field(i, 'label').value.trim(), criterion: field(i, 'crit').value.trim() };
                made.set(f.code, { ...now, whole: !0 });
                reviewed.set(f.code, { ...now, leak: !1, fixed: !0, what: v.what });
            } else
                // 透露答案：只标出，不替换用户文字
                reviewed.set(f.code, { label: sent.label, criterion: sent.criterion, leak: !!v.leak, what: v.what });
        }
        return fixed;
    }
    // 来源判定：检查过且未透露 → ai；模型原样所写（未检或透露无改法）→ gen；其余 → ''（keepLabels 记 user）
    box.__srcOf = (code, label, criterion) => {
        let rv = reviewed.get(code);
        return rv && !rv.leak && rv.label === label && rv.criterion === criterion
            ? 'ai'
            : isWhole(code, label, criterion)
              ? 'gen'
              : '';
    };
    // 「检查」只送检当前文字，结果只标出，不替换
    let checkBtn = box.querySelector('[data-fr-check]');
    checkBtn &&
        checkBtn.addEventListener('click', async (event) => {
            let btn = event.currentTarget,
                rows = facts.map((f, i) => ({ f, i }));
            btn.disabled = !0;
            status.innerHTML = '<span class="pi-spin"></span> 正在检查是否透露答案…';
            try {
                await secretsReady;
                let sentRows = rows.filter(({ i }) => field(i, 'label').value.trim() || field(i, 'crit').value.trim());
                await reviewRows(sentRows);
                let missed = sentRows.filter(({ f }) => !got.has(f.code)).length,
                    warned = facts.reduce((n, _, i) => n + (check(i) ? 1 : 0), 0);
                status.textContent = `${secretsNote}${missed ? `${missed}条尚未检查，可再点一次。` : ''}${warned ? `${warned}条标黄，原因见黄字。` : missed ? '' : '未发现问题。'}`;
            } catch (error) {
                status.textContent = `检查未完成（${error.message}），下方按字面比对标出可能透露答案之处。`;
                facts.forEach((_, i) => check(i));
            } finally {
                btn.disabled = !1;
            }
        });
    box.querySelector('[data-fr-auto]').addEventListener('click', async (event) => {
        let btn = event.currentTarget,
            todo = facts.map((f, i) => ({ f, i })).filter(({ i }) => !field(i, 'label').value.trim() || !field(i, 'crit').value.trim());
        // 待检查：模型原样所写且当前版本未检查过（透露但无改法的也再查）
        let needReview = () =>
            facts
                .map((f, i) => ({ f, i }))
                .filter(({ f, i }) => {
                    let label = field(i, 'label').value.trim(),
                        criterion = field(i, 'crit').value.trim(),
                        rv = reviewed.get(f.code);
                    return isWhole(f.code, label, criterion) && !(rv && !rv.leak && rv.label === label && rv.criterion === criterion);
                });
        if (!todo.length && !needReview().length) return (status.textContent = '都已经填好了。要重新生成，先清空对应的框。');
        let prog = startProgress(`fr-${prefix}`);
        todo.length
            ? prog.step(`第1步：AI写标签（共${todo.length}条）`, 70, 20000 + todo.length * 4000)
            : prog.step('检查有没有透露答案', 97, 25000);
        ((running = !0), (btn.disabled = !0), btn.classList.add('is-busy'), (btn.innerHTML = '<span class="pi-spin"></span><span>正在自动填写</span>'), (status.textContent = '生成期间可以先往下翻着看，写好后会一起填进框里。'), sync());
        for (let { i } of todo) {
            let b = box.querySelector(`[data-fr-st="${i}"]`);
            b && ((b.className = 'pi-badge pi-fr-st is-accent'), (b.textContent = '生成中'));
        }
        try {
            await secretsReady;
            // 分批生成：每批返回即填入；失败批次留空，可再点只补空的
            let r = { missing: [] },
                genErrs = [],
                wrote = 0,
                batches = labelBatchesBy(todo, (batch) =>
                    msgChars(factLabelMessages(batch.map(({ f }) => ctx.get(f.code) || { code: f.code, usedBy: [], orphan: !0 }), { secrets })),
                );
            await runLabelPool(
                batches.map((batch) => async () => {
                    let items = batch.map(({ f }) => ctx.get(f.code) || { code: f.code, usedBy: [], orphan: !0 }),
                        got = parseFactLabels(
                            await ask(view, 'outline', factLabelMessages(items, { secrets })),
                            items.map((x) => x.code),
                        );
                    for (let { f, i } of batch) {
                        let v = got.items.get(f.code);
                        if (!v) {
                            r.missing.push(f.code);
                            continue;
                        }
                        // 只填空框
                        let lf = field(i, 'label'),
                            cf = field(i, 'crit'),
                            whole = !lf.value.trim() && !cf.value.trim();
                        (lf.value.trim() || (lf.value = v.label),
                            cf.value.trim() || (cf.value = v.criterion),
                            made.set(f.code, { label: lf.value.trim(), criterion: cf.value.trim(), whole }),
                            v.unsure && unsure.set(f.code, v.unsure));
                    }
                    batch.forEach(({ i }) => check(i));
                    wrote += batch.length;
                    prog.real((wrote / todo.length) * 70, `已写${wrote}/${todo.length}条`);
                }),
                (e) => genErrs.push(e),
            );
            if (genErrs.length && genErrs.length === batches.length) throw genErrs[0];
            for (let { f, i } of todo) !field(i, 'label').value.trim() && !r.missing.includes(f.code) && r.missing.push(f.code);
            todo.length && prog.step('第2步：检查有没有透露答案', 97, 25000);
            let fixed = 0,
                reviewFailed = '';
            // 再点「自动填写」只补检查，不重新生成；用户写的、半生成的不自动送检
            let toReview = needReview();
            try {
                fixed = toReview.length ? await reviewRows(toReview) : 0;
            } catch (error) {
                reviewFailed = `检查未完成（${error.message}），下方按字面比对标出可能透露答案之处。`;
            }
            let missed = toReview.filter(({ f }) => !got.has(f.code)).length,
                warned = facts.reduce((n, _, i) => n + (check(i) ? 1 : 0), 0),
                got2 = todo.filter(({ i }) => field(i, 'label').value.trim()).length;
            prog.done(`完成：已填好${got2}/${todo.length}条${warned ? `，${warned}条标黄` : ''}`);
            keep &&
                (got2 || fixed) &&
                keepLabels(
                    view,
                    facts.map((f, i) => {
                        let label = field(i, 'label').value.trim(),
                            criterion = field(i, 'crit').value.trim();
                        return { code: f.code, label, criterion, src: box.__srcOf(f.code, label, criterion) };
                    }),
                );
            status.textContent = `${secretsNote}${reviewFailed}已填写${todo.length - r.missing.length}条${r.missing.length ? `；${r.missing.length}条未生成（${r.missing.join('、')}），可再点一次或手动填写` : ''}。${fixed ? `${fixed}条原写法会透露答案，已自动改写。` : ''}${missed && !reviewFailed ? `${missed}条尚未检查，再点「开始自动填写」仅补检查；直接确认的话，以后可在「修改线索」中点「检查」。` : ''}${warned ? `${warned}条标黄，原因见黄字，按提示修改文字后黄色消失；不修改也可以，标黄不影响导入。` : missed || reviewFailed ? '' : '未发现问题，可直接确认。'}`;
        } catch (error) {
            (prog.fail(), (status.textContent = `生成失败：${error.message}。可重试或手动填写。`));
        } finally {
            ((running = !1), (btn.disabled = !1), facts.forEach((_, i) => rowState(i, box.querySelector(`[data-fr-row="${i}"]`).classList.contains('is-warn'))), sync());
        }
    });
}

// 开局要建的行：已开始的线 + 条件满足即开始的主线 + 开线事件。线状态按「装好后」在内存中算一次（不写库）。
// 无法计算（没有线或没装数据库）返回 null，建全部行。
// 普通项目按节点建（nodeFrontier），跑团按线。
export function openingScope(project, c, pending = null) {
    let compiled = compileClue(project.outline.volumes);
    if (!compiled.lines.length || !c || !c.state || !c.state.lineStates) return null;
    let state = c.state,
        snap0 = c.snap.cond || c.snap,
        cfg = project.clue;
    if (pending && pending.template && pending.binding) {
        // 已有表用聊天里的行和值，新装的线索表用待装结构（别的表的运行值不能被模板覆盖）
        let clue = { ...project.clue, bindings: { ...project.clue.bindings, ...pending.binding } },
            live = (c.snap && c.snap.tables) || {},
            liveNames = new Set(Object.values(live).filter((s) => s && s.name).map((s) => s.name)),
            tables = { ...live };
        for (let [k, s] of Object.entries(pending.template))
            k.startsWith('sheet_') && s && !liveNames.has(s.name) && !live[k] && (tables[k] = s);
        let view = effectiveTables(tables, clue.bindings, prebuildPlan(project.outline.volumes), clue.labels),
            r = condReads(tables, view, clue.bindings);
        ((snap0 = { ...c.snap, tables: view, facts: r.facts, knowledge: r.knowledge }), (cfg = clue));
        state = computeClueState(compiled, snap0, c.prog, clue);
    }
    let on = startedLines(state) || new Set();
    for (let s of state.lineStates) s.state === '进行中' && on.add(s.line.id);
    return rowScope(compiled, on, nodeFrontier(compiled, state, snap0, c.prog, cfg)).facts;
}

// 写表前后核对的作用域：聊天、项目、推进方式、数据库数据隔离（切换隔离会写到另一份表）。
export function prebuildScope(view) {
    let c = ctx(),
        chatId = c && typeof c.getCurrentChatId == 'function' ? String(c.getCurrentChatId() ?? '') : '',
        clue = view.runtime && view.runtime.clue,
        iso = clue && typeof clue.opScope == 'function' ? clue.opScope().iso : null;
    return {
        chatId,
        chatLabel: chatId,
        projectId: view.projectId,
        active: view.runtime.activeId(),
        mode: isClueMode(view.project()) ? 'clue' : 'outline',
        iso,
    };
}

export function prebuildTargetPrint(tables, bindings) {
    let out = {};
    for (let [b, keyCol, extraCol] of [
        [(bindings.facts || [])[0], '编号列', '标签'],
        [(bindings.knowledge || [])[0], '', '键'],
    ]) {
        if (!b) continue;
        let found = findSheet(tables || {}, b.表);
        if (found.error) {
            out[b.表] = null;
            continue;
        }
        let { head, rows, col } = sheetRows(found.sheet),
            ki = keyCol ? col(b[keyCol]) : col(extraCol),
            xi = col(extraCol);
        out[b.表] = {
            key: String(found.sheet.key || ''),
            head: head
                .slice(1)
                .map((x) => cellText(x))
                .join(','),
            rows: new Map(rows.map((r) => [cellText(r[ki]), cellText(r[xi])])),
        };
    }
    return out;
}

export function prebuildTargetSame(before, after) {
    for (let [name, a] of Object.entries(before)) {
        let b = after[name];
        if (!a || !b) {
            if (a !== b) return !1;
            continue;
        }
        if (a.key !== b.key || a.head !== b.head) return !1;
        for (let [code, label] of a.rows) if (!b.rows.has(code) || b.rows.get(code) !== label) return !1;
    }
    return !0;
}

export function prebuildScopeValid(view, s) {
    let now = prebuildScope(view);
    return now.chatId === s.chatId && now.projectId === s.projectId && now.active === s.active && now.mode === s.mode && now.iso === s.iso;
}

export function prebuildColumnProblems(tables, bindings, diff) {
    let out = [],
        head = (name) => {
            let f = findSheet(tables, name);
            return f.sheet ? sheetRows(f.sheet).head.map((h) => String(h ?? '').trim()) : null;
        },
        fb = (bindings.facts || [])[0],
        kb = (bindings.knowledge || [])[0];
    if (fb && diff.newFacts.length) {
        let h = head(fb.表);
        h
            ? ['标签', '登记口径', fb.编号列, fb.状态列]
                  .filter(Boolean)
                  .forEach((c2) => h.includes(c2) || out.push(`「${fb.表}」缺少列「${c2}」`))
            : out.push(`没有表「${fb.表}」`);
    }
    if (kb && diff.newKnows.length) {
        let h = head(kb.表);
        h
            ? ['键', kb.事实列, kb.角色列, kb.方式列, kb.可信度列]
                  .filter(Boolean)
                  .forEach((c2) => h.includes(c2) || out.push(`「${kb.表}」缺少列「${c2}」`))
            : out.push(`没有表「${kb.表}」`);
    }
    return out;
}

export const clueActions = {
    async 'clue-mode'(view, target) {
        let mode = target.dataset.mode,
            project = view.project();
        !project ||
            (project.clue && project.clue.mode === mode) ||
            (mode === 'clue' &&
                !(await confirmDialog({
                    title: '切换到线索推进',
                    body: '线索推进按主角实际获得的线索推进：数据库填表时记录已获得的线索，插件据此开放下一步。不再由AI判断阶段是否演完，也不再一次性把整个阶段交给正文。',
                    list: [
                        '大纲推进的进度保留，切回后恢复。',
                        '节点需在大纲中写明「发现」和「完成条件」才会自动完成，否则只能在执行页手动标记。',
                        '切换后，在执行页「需要处理」或「运行设置」中点「创建模板」，为本聊天添加线索表。',
                    ],
                    okLabel: '切换',
                }))) ||
            (view.runtime.bumpEpoch(),
            view.data.updateProject(view.projectId, (p) => ({ ...p, clue: normalizeClue({ ...p.clue, mode }) })),
            view.runtime.clue.hideLineBar(),
            view.runtime.clue.invalidate(),
            mode === 'clue' && view.runtime.clue.scheduleSync(),
            view.runtime.refresh(),
            view.renderBody());
    },
    'run-set-open'(view, target) {
        let st7 = view.tabState('run');
        // 连同表格绑定编辑区一起打开，并滚到那里（手机上看得出打开了哪里）
        ((st7.setOpen = !0), (st7.bindOpen = !0), view.renderBody());
        let box = target && target.ownerDocument && target.ownerDocument.querySelector('.pi-body [data-clue-bindings]');
        box && (box.scrollIntoView && box.scrollIntoView({ block: 'center' }), box.focus && box.focus());
    },
    'run-set-toggle'(view, target) {
        let st7 = view.tabState('run');
        ((st7.setOpen = !(target && target.getAttribute('aria-expanded') === 'true')), view.renderBody());
    },
    // 执行页各处折叠：data-key 是 tabState 里的键
    'run-fold'(view, target) {
        let st7 = view.tabState('run'),
            key = target.dataset.key;
        ((st7[key] = !st7[key]), view.renderBody());
    },
    'clue-bind-toggle'(view) {
        let st7 = view.tabState('run');
        ((st7.bindOpen = !st7.bindOpen), view.renderBody());
    },
    'clue-bind-example'(view, target) {
        let box = target.closest('.pi-card').querySelector('[data-clue-bindings]');
        box && (box.value = BINDING_EXAMPLE);
    },
    'clue-bind-apply'(view, target) {
        let card = target.closest('.pi-card'),
            status = card.querySelector('[data-clue-bind-status]');
        try {
            let value = parseYaml(card.querySelector('[data-clue-bindings]').value) || {};
            if (!isPlainObject(value)) throw new Error('应是switch / facts / knowledge / scene / time的映射');
            (view.data.updateProject(view.projectId, (p) => ({ ...p, clue: normalizeClue({ ...p.clue, bindings: value }) })),
                view.runtime.clue.invalidate(),
                (view.tabState('run').bindOpen = !1),
                view.renderBody());
        } catch (error) {
            ((status.textContent = error.message), status.classList.add('is-err'));
        }
    },
    // 重新读表同时安排一次同步（写场景目录、补缺行），可作为「准备中」的手动重试
    'clue-refresh'(view) {
        (view.runtime.clue.invalidate(), view.runtime.clue.scheduleSync(), view.renderBody());
    },
    'clue-node-open'(view, target, event) {
        if (event.target.closest('button')) return;
        let st7 = view.tabState('run');
        ((st7.nodeOpen = st7.nodeOpen === target.dataset.uid ? '' : target.dataset.uid), view.renderBody());
    },
    async 'clue-line'(view, target) {
        let v = target.dataset.value,
            s0 = view.runtime.clue.opScope();
        if (v === 'abandon' || v === 'done') {
            let ls = view.runtime.clue.compute()?.state.lineStates.find((s2) => s2.line.id === target.dataset.id),
                name = ls ? ls.line.name : target.dataset.id;
            if (
                !(await confirmDialog({
                    title: v === 'abandon' ? `放弃「${name}」？` : `把「${name}」标记完成？`,
                    body:
                        v === 'abandon'
                            ? '这条线停止注入和提示。可点这条线的「撤销手动操作」恢复。'
                            : '不再由表格判断，直接视为完成。可点这条线的「撤销手动操作」恢复。',
                    okLabel: v === 'abandon' ? '放弃' : '标记完成',
                    danger: v === 'abandon',
                }))
            )
                return;
        }
        // 主线同时只能进行一条：进入或继续另一条时先确认；取消则两条都不变
        if (v === 'enter' || v === 'resume') {
            let c0 = view.runtime.clue.compute(),
                me = c0 && c0.state.lineStates.find((x) => x.line.id === target.dataset.id),
                other = me && me.line.kind === 'main' ? mainInProgress(c0.state.lineStates, me.line.id) : null;
            if (
                other &&
                !(await confirmDialog({
                    title: `切换到「${me.line.name}」？`,
                    body: `主线同时只能进行一条。「${other.line.name}」会先暂停，进度保留，之后可点「继续」恢复。`,
                    okLabel: '切换',
                }))
            )
                return;
        }
        let uid = '',
            c = target.dataset.value === 'enter' ? view.runtime.clue.compute() : null,
            s = c && c.state.lineStates.find((x) => x.line.id === target.dataset.id);
        if (s && s.entries.length > 1) {
            let name = (u) => {
                let n = c.state.nodeStates.find((x) => x.node.uid === u);
                return n
                    ? `${n.node.name}${clueText(isPlainObject(n.node.item) ? n.node.item.入口 : '') ? `：${clueText(n.node.item.入口)}` : ''}`
                    : u;
            };
            if (
                ((uid = await menuDialog({ title: '选择进入的事件', items: s.entries.map((u) => ({ value: u, label: name(u) })) })), !uid)
            )
                return;
        }
        (view.runtime.clue.lineAct(target.dataset.id, target.dataset.value, uid, s0), view.renderBody());
    },
    'clue-pause'(view, target) {
        let on = !!target.dataset.value;
        (view.runtime.clue.setPaused(on),
            toast('success', on ? '剧情已暂停：之后的回复不再注入线索内容。' : '剧情已继续。'),
            view.renderBody());
    },
    async 'clue-line-manual'(view, target) {
        let id = target.dataset.id,
            name = (view.runtime.clue.compute()?.state.lineStates.find((s) => s.line.id === id) || { line: { name: id } }).line.name;
        (await confirmDialog({
            title: `「${name}」改为手动开始`,
            body: '不再自动判断开启条件，原条件保留供查看。需要开始时点「进入」。这个修改作用于大纲，所有聊天都一样。',
            okLabel: '改为手动',
        })) &&
            (view.runtime.clue.lineToManual(id)
                ? toast('success', `「${name}」已改为手动开始。`)
                : toast('info', '这条线已是手动开始。'),
            view.renderBody());
    },
    'clue-tiers'(view, target) {
        let tiers = JSON.parse(target.dataset.tiers || '[]');
        (view.runtime.clue.confirmTiers(tiers)
            ? toast('success', `档位顺序已确认：${tiers.join(' < ')}`)
            : toast('info', '无需确认的条件。'),
            view.renderBody());
    },
    async 'clue-labels'(view) {
        await prepareLabels(view);
    },
    'clue-pause-mains'(view, target) {
        let on = !!target.dataset.value;
        (view.runtime.clue.setPaused(on, 'mains'), toast('success', on ? '主线已全部暂停：支线照常。' : '主线已继续。'), view.renderBody());
    },
    'clue-pause-side'(view, target) {
        let on = !!target.dataset.value;
        (view.runtime.clue.setPaused(on, 'side'), toast('success', on ? '支线已全部暂停：主线照常。' : '支线已继续。'), view.renderBody());
    },
    async 'clue-fold'(view, target) {
        let clue = view.runtime.clue,
            id = target.dataset.id,
            f = clue.foldCheck(),
            x = f && f.lines.find((y) => y.id === id);
        if (!x) return toast('info', '这条线的状态已变化。');
        let s0 = clue.opScope();
        if (target.dataset.value === 'collapse') {
            let ok = await confirmDialog({
                title: `收起${lineDisplayName({ id, name: x.name })}`,
                body: `收起${x.rows}行：这些行存进插件记录并从表格删除，剧情判断不受影响，可随时恢复。手动收起不等待下次填表。`,
                list: x.kept.length ? [`${foldKeptText(x.kept)}，保留在表中。`] : [],
                okLabel: '收起',
            });
            if (!ok) return;
            if (!s0 || clue.opScope().iso !== s0.iso) return toast('info', '确认期间已切换聊天或数据库隔离，未收起。');
            let r = await clue.foldCollapse([id], { manual: !0 });
            return (
                view.renderBody(),
                r.ok
                    ? toast(r.failed || r.stopped ? 'warning' : 'success', `已收起${r.rows}行${r.failed ? `；${r.failed}行内容有变化，未删除` : ''}${r.stopped ? `；${r.stopped}，其余下次继续` : ''}。`)
                    : toast('info', `未收起：${r.why}。`)
            );
        }
        // 放回表格随时能再收，不再确认（实测问题 17）
        let r = await clue.foldRestore((rec) => rec.line === id);
        (view.renderBody(), foldRestoreToast(r));
    },
    async 'clue-fold-chat'(view) {
        let f = view.runtime.clue.foldCheck(),
            ready = f ? f.lines.filter((x) => x.rows) : [],
            rows = ready.reduce((n, x) => n + x.rows, 0),
            pick = await openDialog({
                title: '收起已结束的线',
                html: `<p class="pi-hint">本聊天有${ready.length}条已结束的剧情线，共${rows}行。收起后这些行移入插件记录并从表格删除，剧情判断不受影响，可随时恢复。</p>`,
                actions: [
                    { label: '不收', value: 'off' },
                    { label: '收起', value: 'on', primary: !0 },
                ],
            });
        if (!pick) return;
        (view.runtime.clue.setFoldChat(pick), view.renderBody(), pick === 'on' && view.runtime.clue.scheduleSync());
    },
    async 'clue-fold-log'(view) {
        let clue = view.runtime.clue,
            f = clue.foldCheck();
        if (!f) return;
        let count = (rec, sts) => f.status.filter((x) => x.rec.id === rec.id && sts.includes(x.st)).length,
            rows = f.records
                .slice()
                .reverse()
                .map((rec) => {
                    let folded = count(rec, ['folded', 'lost']),
                        check = count(rec, ['check']),
                        back = count(rec, ['same', 'back']),
                        when = new Date(rec.time).toLocaleString('zh-CN', { hour12: !1, month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }),
                        name = (clue.compute()?.state.lineStates.find((s) => s.line.id === rec.line) || { line: { id: rec.line, name: rec.line } }).line,
                        notes = [`${rec.rows.length}行`, rec.manual ? '手动' : '', folded && folded !== rec.rows.length ? `已收起${folded}行` : '', back ? `${back}行已在表中` : '', check ? `${check}行待核对` : ''].filter(Boolean);
                    return `<tr><td>${esc(when)}<br><span class="pi-meta">第${rec.end && rec.end.i >= 0 ? rec.end.i : '?'}楼</span></td><td>${esc(lineDisplayName(name))}<br><span class="pi-meta">${esc(notes.join('，'))}</span></td><td>${folded || check ? `<button type="button" class="pi-btn is-sm is-ghost" data-dlg-value="r:${esc(rec.id)}">恢复</button>` : ''}</td></tr>`;
                })
                .join(''),
            pick = await openDialog({
                title: '收起记录',
                html: `<table class="pi-files pi-fold-log"><tbody>${rows}</tbody></table><p class="pi-hint">恢复：按收起时的内容放回表格，不会重新开始这条线。</p>`,
                actions: [
                    { label: '全部恢复', value: 'all' },
                    { label: '关闭', value: null, primary: !0 },
                ],
            });
        if (!pick) return;
        let id = pick.startsWith('r:') ? pick.slice(2) : '',
            r = await clue.foldRestore((rec) => pick === 'all' || rec.id === id);
        (view.renderBody(), foldRestoreToast(r));
    },
    'clue-line-tab'(view, target) {
        let st = view.tabState('run');
        ((st.lineTab = target.dataset.tab), (st.lineQ = ''), view.renderBody());
    },
    'clue-line-move'(view, target) {
        (view.runtime.clue.moveLine(target.dataset.id, Number(target.dataset.dir)), view.renderBody());
    },
    // 去大纲页写新一卷，回来补预建行并更新场景编号对照
    async 'clue-next'(view) {
        (await confirmDialog({
            title: '开始下一段主线',
            body: '下一段主线作为新剧情线添加到现有大纲末尾。前面的主线结束后，它的第一阶段会自动开始。',
            list: [
                '1. 在大纲页用「AI写新剧情线」或手动编写（会附上已用编号，避免重号）',
                '2. 回到执行页，在「运行设置」点「补全表格…」，为新线索建行',
                '3. 旧聊天需先点一次「创建模板」，使新剧情线的场景可被识别',
                '编写期间可先暂停剧情',
            ],
            okLabel: '前往大纲',
        })) &&
            view.switchTab &&
            view.switchTab('outline');
    },
    'clue-unfocus'(view) {
        (view.runtime.clue.setFocus(''), view.renderBody());
    },
    // 改线索标签：读关键事实表当前标签和口径，改完写回。写表规则：作用域（含数据隔离）变化即停；每条用 updateRow 一次写入，
    // 写前按编号重新找行、写后回读核对；只有回读一致的才存进项目，未写入的保留输入供重试。
    async 'clue-labels-edit'(view) {
        let c = view.runtime.clue.compute(),
            project = view.project(),
            api = acuApi(),
            fb = project && (project.clue.bindings.facts || [])[0];
        if (!c || !c.snap.api || !api || (typeof api.updateRow != 'function' && typeof api.updateCell != 'function'))
            return toast('warning', '未检测到数据库插件，无法修改表格标签。');
        if (view.runtime.clue.foldFillBusy()) return toast('info', '数据库正在填表，请稍后再试。');
        if (!fb) return toast('warning', '未绑定事实表。');
        let found = findSheet(c.snap.tables || {}, fb.表);
        if (found.error) return toast('warning', `当前聊天无「${fb.表}」表。`);
        // 作者工具：模板初始行照常显示可改（D21）
        let { col, rows } = sheetRows({ ...found.sheet, [SEED_OFF]: void 0 }),
            ci = { code: col(fb.编号列), label: col('标签'), crit: col('登记口径') },
            // 新聊天未填过表时只有模板初始行（seedRows），无真实行可写：先存进项目，首次填表后再写表格
            seedOnly = !found.sheet.content.slice(1).some(Array.isArray) && rows.length > 0;
        if (ci.code < 0 || ci.label < 0 || ci.crit < 0) return toast('warning', `「${fb.表}」缺少编号、标签或登记口径列，无法修改。`);
        let scope = prebuildScope(view),
            s0 = view.runtime.clue.opScope(),
            dkey = draftKey(scope, s0.iso, fb.表),
            labelCtx = new Map(factLabelContext(project.outline.volumes, rows.map((r) => cellText(r[ci.code]))).map((x) => [x.code, x])),
            inPlan = new Set(prebuildPlan(project.outline.volumes).facts.map((f) => f.code)),
            drafts = labelDrafts.get(dkey) || {},
            facts = rows
                .map((r) => ({ code: cellText(r[ci.code]), table: { label: cellText(r[ci.label]), criterion: cellText(r[ci.crit]) } }))
                .filter((f) => f.code && inPlan.has(f.code))
                .map((f) => {
                    // 项目存的版本与聊天表格不同（先存进项目、草稿已丢失，或表为旧版）：带出项目版本
                    let stored = storedLabel(project.clue.labels, f.code, labelCtx.get(f.code)),
                        fromProject = !drafts[f.code] && stored && (stored.label !== f.table.label || stored.criterion !== f.table.criterion) ? { label: stored.label, criterion: stored.criterion } : null,
                        pend = drafts[f.code] || fromProject;
                    return { ...f, now: pend || f.table, retry: !!drafts[f.code], newer: !!fromProject, draft: pend || null };
                });
        if (!facts.length) return toast('info', '表格中暂无本项目的线索行。请先用「创建模板」或「补全表格」建立。');
        let retry = facts.filter((f) => f.retry).length,
            newer = facts.filter((f) => f.newer).length,
            picked = await openDialog({
                title: '修改线索标签',
                html: `<p class="pi-hint">修改当前聊天「${esc(fb.表)}」中的标签和登记口径。口径过宽会使未获得的线索被算作已获得。</p>${seedOnly ? '<p class="pi-hint is-warn">本聊天尚未填表，表格内目前是模板初始行。修改先保存到项目；数据库首次填表后，再打开这里点保存即可写入表格。</p>' : ''}${retry ? `<p class="pi-hint is-warn">上次有${retry}条未写入表格，下方为当时填写的内容，点保存重试。</p>` : ''}${newer && !seedOnly ? `<p class="pi-hint is-warn">有${newer}条与项目保存的不一致，下方为项目中的版本，点保存写入本聊天表格。</p>` : ''}${factRowsHtml(facts, 'le', project.outline.volumes, {}, { intro: !1 })}`,
                onMount: (root) => mountFactRows(view, root, facts, 'le', project.outline.volumes),
                actions: [
                    { label: '取消', value: null },
                    {
                        label: '保存',
                        primary: !0,
                        value: (root) =>
                            facts.map((f, i) => {
                                let label = root.querySelector(`[data-le-label="${i}"]`).value.trim(),
                                    criterion = root.querySelector(`[data-le-crit="${i}"]`).value.trim(),
                                    box = root.querySelector('[data-fr="le"]');
                                return { code: f.code, label, criterion, table: f.table, draft: f.draft, src: box && box.__srcOf ? box.__srcOf(f.code, label, criterion) : '' };
                            }),
                    },
                ],
            });
        if (!picked) return;
        let empty = picked.filter((f) => !f.label);
        if (empty.length) return toast('warning', `标签不能为空：${empty.map((f) => f.code).join('、')}`);
        let live = () => prebuildScopeValid(view, scope) && view.runtime.clue.opScope().iso === s0.iso,
            pid = project.id,
            // 与表格现值比较：上次未写入的条目仍是旧值，算作改动
            changed = picked.filter((f) => f.label !== f.table.label || f.criterion !== f.table.criterion),
            // 上次写表途中被切走、未核实，但表格已是草稿值：只补存进项目，不再写表
            synced = picked.filter((f) => !changed.includes(f) && f.draft && f.draft.label === f.label && f.draft.criterion === f.criterion);
        if (!live()) return toast('warning', '确认期间已切换聊天、项目、推进方式或数据隔离，未写入。请回原聊天重试。');
        // 文字未改但检查确认未透露的：只更新项目里的来源，不写表
        let checked = picked.filter((f) => !changed.includes(f) && !synced.includes(f) && f.src === 'ai');
        checked.length && keepLabels(view, checked, pid);
        if (seedOnly && changed.length) {
            // 不写表（updateRow 会按行号补空行，覆盖初始行）；存进项目并留作草稿，填表后再写
            keepLabels(view, changed, pid);
            labelDrafts.set(dkey, { ...(labelDrafts.get(dkey) || {}), ...Object.fromEntries(changed.map((f) => [f.code, { label: f.label, criterion: f.criterion }])) });
            view.renderBody();
            return toast('info', `已保存${changed.length}条到项目。本聊天尚未填表，待首次填表后再写入表格：届时打开「修改线索」点保存。`);
        }
        synced.length && keepLabels(view, synced, pid);
        // 没改动的条目：表格已经是这个值，残留的草稿清掉
        dropLabelDrafts(dkey, picked.filter((f) => !changed.includes(f)).map((f) => f.code));
        if (!changed.length) return toast(synced.length ? 'success' : 'info', synced.length ? `表格已是新值，已同步${synced.length}条到项目。` : '无改动。');
        let done = [],
            failed = [],
            unsure = [],
            stopped = !1,
            tableNow = () => {
                let now = view.runtime.clue.compute(),
                    sh = findSheet((now && now.snap.tables) || {}, fb.表);
                if (sh.error) return null;
                let r = sheetRows(sh.sheet);
                return { sheet: sh.sheet, col: r.col };
            },
            rowOf = (t, code) => (t ? t.sheet.content.findIndex((r, k) => k > 0 && cellText(r[t.col(fb.编号列)]) === code) : -1),
            readBack = (code) => {
                view.runtime.clue.invalidate();
                let t = tableNow(),
                    at = rowOf(t, code);
                return at < 1 ? null : { label: cellText(t.sheet.content[at][t.col('标签')]), criterion: cellText(t.sheet.content[at][t.col('登记口径')]) };
            };
        for (let f of changed) {
            if (!live()) {
                stopped = !0;
                break;
            }
            view.runtime.clue.invalidate();
            let t = tableNow(),
                at = rowOf(t, f.code);
            if (at < 1 || t.col('标签') < 0 || t.col('登记口径') < 0) {
                failed.push(f);
                continue;
            }
            let data = { 标签: f.label, 登记口径: f.criterion };
            if (typeof api.updateRow == 'function') await Promise.resolve(api.updateRow(fb.表, at, data)).catch(() => !1);
            else
                // 没有 updateRow 的旧版数据库：逐格写，每格之前重新核对作用域和行号
                for (let [k, v] of Object.entries(data)) {
                    if (!live()) break;
                    view.runtime.clue.invalidate();
                    let t2 = tableNow(),
                        at2 = rowOf(t2, f.code);
                    if (at2 < 1) break;
                    await Promise.resolve(api.updateCell({ tableName: fb.表, rowIndex: at2, colIdentifier: k, value: v, skipNotify: !0 })).catch(() => !1);
                }
            if (!live()) {
                // 已写但无法核实（已切走）：留作草稿，回原聊天时核对
                stopped = !0;
                unsure.push(f);
                break;
            }
            let back = readBack(f.code);
            back && back.label === f.label && back.criterion === f.criterion ? done.push(f) : failed.push(f);
        }
        // 仅回读一致的才存进原项目；其余留作草稿，下次打开带出
        let saved = done.length ? keepLabels(view, done, pid) : !0;
        dropLabelDrafts(dkey, done.map((f) => f.code));
        let notWritten = [...failed, ...changed.filter((f) => !done.includes(f) && !failed.includes(f) && !unsure.includes(f))],
            left = [...notWritten, ...unsure];
        left.length && labelDrafts.set(dkey, { ...(labelDrafts.get(dkey) || {}), ...Object.fromEntries(left.map((f) => [f.code, { label: f.label, criterion: f.criterion }])) });
        (view.runtime.clue.invalidate(), view.renderBody());
        let parts = [
            `已修改${done.length}条`,
            notWritten.length ? `${notWritten.length}条未写入表格：${notWritten.map((f) => f.code).join('、')}` : '',
            unsure.length ? `${unsure.map((f) => f.code).join('、')}写入途中切换了聊天、项目或数据隔离，结果待核实` : '',
            saved ? '' : '原项目已不存在，未保存到项目',
        ].filter(Boolean);
        !left.length && saved
            ? toast('success', `已修改${done.length}条线索的标签和口径。`)
            : toast(
                  stopped || !saved ? 'warning' : 'error',
                  `${parts.join('；')}。${left.length ? '填写内容已保留，请回原聊天打开「修改线索」点保存重试。' : ''}`,
              );
    },
    // 按大纲补表格行：预览 → 逐条确认标签和登记口径 → 用 insertRow 只插入缺的行（不动已有行）。点击时记下聊天 / 项目 / 模式，每插一行前核对，变了就停。
    // 登记口径不直接用「记录」预填（常含答案），由作者写或「自动填写」生成后再检查。
    async 'clue-prebuild'(view) {
        let c = view.runtime.clue.compute(),
            project = view.project(),
            api = acuApi();
        if (!c || !c.snap.api || !api || typeof api.insertRow != 'function')
            return toast('warning', '未检测到数据库插件，无法补表格行。');
        if (view.runtime.clue.foldFillBusy()) return toast('info', '数据库正在填表，请稍后再试。');
        let scope = prebuildScope(view),
            full = prebuildPlan(project.outline.volumes),
            // 只补现在要用的行（与自动补行同一范围规则）；未开始的线开始后自动补
            keep = c.snap.scope ? c.snap.scope.facts : null,
            plan = keep ? { ...full, facts: full.facts.filter((f) => keep.has(f.code)), knows: full.knows.filter((k) => keep.has(k.fact)) } : full,
            // 与自动补行同一资格（方案 十.1）：事实行、知情行各自判断，建不了的不列入预览
            can = seedable(project.clue.bindings),
            diff0 = prebuildDiff(plan, c.snap, project.clue.bindings),
            haveFact = new Set(c.snap.facts ? c.snap.facts.keys() : []),
            diff = {
                ...diff0,
                newFacts: can.facts ? diff0.newFacts : [],
                // 知情行只给表里已有、或这次会补的事实
                newKnows: can.knows ? diff0.newKnows.filter((k) => can.facts || haveFact.has(k.fact)) : [],
                stale: prebuildDiff(full, c.snap, project.clue.bindings).stale,
            },
            targetPrint = prebuildTargetPrint(c.snap.tables, project.clue.bindings);
        if (!diff.factTable) return toast('warning', '未绑定事实表。');
        // 只有模板初始行且数据库可能还要用的表：先不补（补一行会使其余初始行失效）
        let held = [diff.factTable, diff.knowTable].filter((name) => {
            let f = name && findSheet(c.snap.tables || {}, name);
            return !!(f && f.sheet && f.sheet[SEED_HOLD]) && (name === diff.factTable ? diff.newFacts.length : diff.newKnows.length);
        });
        if (held.length)
            return toast('info', `「${held.join('」「')}」目前只有模板初始行，首次填表后才会成为正式行。请先进行一轮，再补行。`);
        if (!can.facts && !can.knows)
            return toast('warning', '事实表未绑定状态列（及已核实值），无法预建「未获得」行（此类表有行即视为已核实）。请由填表模型正常登记，或在表格绑定中补充状态列。');
        let colErr = prebuildColumnProblems(c.snap.tables, project.clue.bindings, diff);
        if (colErr.length) return toast('error', `表格结构与配套模板不一致，未写入：${colErr.join('；')}`);
        if (!diff.newFacts.length && !diff.newKnows.length)
            return toast(
                'info',
                `表格行已齐全（已有${diff.kept.length}个事实）。${diff.stale.length ? `表中有大纲已不使用的编号：${diff.stale.join('、')}，不会自动删除。` : ''}`,
            );
        let html = `<div class="pi-fr-intro"><p>大纲新增的线索尚未出现在<b>当前聊天</b>的线索表中。这一步补入缺少的行，已有行不改动，不影响已有进度。</p></div>
          ${diff.stale.length ? `<p class="pi-hint is-warn">表中有大纲已不使用的编号：${esc(diff.stale.join('、'))}（不会删除）</p>` : ''}
          <details class="pi-fr-more"><summary class="pi-hint">写入细节</summary>
          <p class="pi-hint">目标聊天：${esc(scope.chatLabel || '当前聊天')}</p>
          ${diff.newKnows.length && diff.knowTable ? `<p class="pi-hint">「${esc(diff.knowTable)}」新增${diff.newKnows.length}行：${esc(diff.newKnows.map((k) => k.key).join('、'))}</p>` : ''}
          ${diff.kept.length ? `<p class="pi-hint">已有、不改动：${esc(diff.kept.join('、'))}</p>` : ''}
          <p class="pi-hint">确认时会再核对，期间表格有变化则不写入。补行后若对线索表重新「手动填表」，补入的行可能被清除，请检查。</p></details>
          ${diff.newFacts.length ? `<h4 class="pi-fr-title">要补的线索：${diff.newFacts.length}条</h4>${factRowsHtml(diff.newFacts, 'pb', project.outline.volumes, project.clue.labels)}` : ''}`,
            picked = await openDialog({
                title: '补全表格',
                html,
                onMount: (root) => mountFactRows(view, root, diff.newFacts, 'pb', project.outline.volumes, { gate: '写入当前聊天', keep: !0 }),
                actions: [
                    { label: '取消', value: null },
                    {
                        label: '写入当前聊天',
                        primary: !0,
                        value: (root) =>
                            diff.newFacts.map((f, i) => {
                                let label = root.querySelector(`[data-pb-label="${i}"]`).value.trim(),
                                    criterion = root.querySelector(`[data-pb-crit="${i}"]`).value.trim(),
                                    box = root.querySelector('[data-fr="pb"]');
                                return { ...f, label, criterion, src: box && box.__srcOf ? box.__srcOf(f.code, label, criterion) : '' };
                            }),
                    },
                ],
            });
        if (!picked) return;
        let empty = picked.filter((f) => !f.label);
        if (empty.length) return toast('warning', `请为这些线索填写不透露答案的标签：${empty.map((f) => f.code).join('、')}`);
        // 先核对作用域再存标签，避免存进切换后的项目
        if (!prebuildScopeValid(view, scope))
            return toast('warning', '确认期间已切换聊天、项目、推进方式或数据隔离，未写入。请回原聊天重试。');
        keepLabels(view, picked, scope.projectId);
        let now = view.runtime.clue.compute(),
            fresh = prebuildDiff(plan, now.snap, project.clue.bindings),
            labels = new Map(picked.map((f) => [f.code, f])),
            previewKnows = new Set(diff.newKnows.map((k) => k.key)),
            vanished = diff.kept.filter((code) => !(now.snap.facts && now.snap.facts.has(code)));
        if (vanished.length)
            return toast('warning', `确认期间表格有变化（预览时已有的${vanished.join('、')}现已缺失），未写入。请重试。`);
        if (!prebuildTargetSame(targetPrint, prebuildTargetPrint(now.snap.tables, project.clue.bindings)))
            return toast('warning', '确认期间表格有变化（可能刚填过表），未写入。请重新打开「补全表格」，按当前表格再确认。');
        let want = fresh.newFacts.map((f) => f.code).filter((code) => labels.has(code)),
            knowsToWrite = fresh.newKnows.filter((k) => previewKnows.has(k.key)),
            fb = project.clue.bindings.facts[0],
            kb0 = project.clue.bindings.knowledge[0],
            // 没配方式列的知情表插一行即等于「知道」，不预建
            kb = kb0 && can.knows ? kb0 : null,
            done = [],
            failed = [],
            factOk = new Set(now.snap.facts ? now.snap.facts.keys() : []),
            stopped = '',
            // 写入时在执行页显示进度（用户 2026-11-23：弹窗关掉后看不到正在写到第几行）
            total = want.length + (kb ? knowsToWrite.length : 0),
            prog = startProgress('prebuild').step('正在写入线索行', 100, 1e9),
            tick = (name) => prog.real(total ? ((done.length + failed.length) / total) * 100 : 100, `${done.length + failed.length}/${total}${name ? `　刚写完${name}` : ''}${failed.length ? `，失败${failed.length}` : ''}`);
        (tick(''), view.renderBody());
        for (let code of want) {
            if (!prebuildScopeValid(view, scope)) {
                stopped = '写入过程中切换了聊天、项目或数据隔离';
                break;
            }
            let f = labels.get(code),
                data = { [fb.编号列]: code, 标签: f.label, 登记口径: f.criterion };
            (fb.状态列 && (data[fb.状态列] = '未获得'),
                (await api.insertRow({ tableName: fb.表, data, skipNotify: !0 }).catch(() => -1)) >= 0
                    ? (done.push(code), factOk.add(code))
                    : failed.push(code));
            tick(code);
        }
        if (kb && !stopped)
            for (let k of knowsToWrite) {
                if (!factOk.has(k.fact)) continue;
                if (!prebuildScopeValid(view, scope)) {
                    stopped = '写入过程中切换了聊天、项目或数据隔离';
                    break;
                }
                let data = { 键: k.key, [kb.事实列]: k.fact, [kb.角色列]: k.actor };
                (kb.方式列 && (data[kb.方式列] = Array.isArray(kb.未知值) ? kb.未知值[0] : kb.未知值 || '未知'),
                    kb.可信度列 && (data[kb.可信度列] = '未核实'),
                    (await api.insertRow({ tableName: kb.表, data, skipNotify: !0 }).catch(() => -1)) >= 0
                        ? done.push(k.key)
                        : failed.push(k.key));
                tick(k.key);
            }
        prog.done(`写入完成：${done.length}/${total}${failed.length ? `，失败${failed.length}` : ''}${stopped ? `（${stopped}，已停下）` : ''}`);
        setTimeout(() => prog.clear(), 8000);
        (view.runtime.clue.invalidate(), view.renderBody());
        let msg = `已写入${done.length}行${done.length ? `（${done.slice(0, 8).join('、')}${done.length > 8 ? '……' : ''}）` : ''}`;
        stopped
            ? toast('warning', `${msg}。${stopped}，后续行未写入；回原聊天再点一次，只补剩余行。`)
            : failed.length
              ? toast(
                    'error',
                    `${msg}；${failed.length}行失败：${failed.slice(0, 6).join('、')}。当前聊天至少需有一楼AI回复，数据库才能保存表格；失败线索对应的知情行也未写入。`,
                )
              : toast('success', `${msg}。`);
    },
    // 场景编号对照：只有编号、入口、地点；作者粘贴进线索控制表的说明（官方填表只展开目标表，放在控制表自己的说明里才看得到）。
    // 创建模板：读聊天模板 → 与运行表核对 → 合成 → 预览 → 以seed导入 → 重新读表核对 → 成功才写绑定。
    // 已有线索表时不追加行（seed不会落进非空表），新事实用「补全表格」。
    async 'clue-gen-template'(view) {
        let api = acuApi(),
            project = view.project(),
            c = view.runtime.clue.compute();
        if (!api || typeof api.getTableTemplate != 'function' || typeof api.importTemplateFromData != 'function')
            return toast('warning', '未检测到数据库的模板接口（需官方SP·数据库8.9以上），无法生成。');
        if (!cardKey()) return toast('warning', '请先打开要使用的聊天。');
        let scope = prebuildScope(view),
            base = null;
        try {
            base = api.getTableTemplate({ scope: 'chat' });
        } catch {}
        if (!isPlainObject(base) || !Object.keys(base).some((k) => k.startsWith('sheet_')))
            return toast('warning', '无法读取当前聊天的表格模板，未生成。请先在数据库中确认本聊天有表格。');
        let live = (c && c.snap.tables) || {},
            tplNames = Object.values(base)
                .filter((x) => x && x.name)
                .map((x) => x.name),
            mismatch = clueTplMismatch(base, live);
        if (mismatch.length)
            return openDialog({
                title: '未创建模板',
                html: `<p class="pi-hint">读取到的模板与当前聊天的表格不一致。直接导入可能新增或隐藏表格，因此未生成：</p><ul>${mismatch.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="pi-hint">请先在数据库中使模板与表格一致（如重新读表、确认使用的是本聊天的模板），再生成。</p>`,
                actions: [{ label: '关闭', value: !0, primary: !0 }],
            });
        let full = prebuildPlan(project.outline.volumes),
            // 只建开局要用的行（已开始或条件已满足的线 + 开线事件），其余线开始后用项目存的标签自动补。
            // 先用不带线索行的待装模板算一次（只需结构和绑定）
            shape = !tplNames.includes('关键事实表') ? synthesizeClueTemplate(base, { clue: {} }) : null,
            opening = openingScope(project, c, shape && !shape.blocked.length ? shape : null),
            plan = opening ? { ...full, facts: full.facts.filter((f) => opening.has(f.code)), knows: full.knows.filter((k) => opening.has(k.fact)) } : full,
            later = full.facts.length - plan.facts.length,
            hasFacts = tplNames.includes('关键事实表'),
            preview = synthesizeClueTemplate(base, { clue: { scenes: plan.scenes } });
        if (preview.blocked.length)
            return toast(
                'warning',
                `模板中有多张「${preview.blocked.join('」「')}」，无法确定使用哪一张，未生成。请先在数据库中删除或重命名多余的表。`,
            );
        let html = `<div class="pi-fr-intro"><p>为<b>当前聊天</b>的数据库添加线索推进所需的三张表，记录主角获得的线索、各角色知情情况和当前场景。</p>
          <p>原有表和数据全部保留，不影响其他聊天。</p></div>
          ${preview.problems.length ? `<p class="pi-hint is-warn"><b>注意：</b></p><ul>${preview.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          <details class="pi-fr-more"><summary class="pi-hint">改动明细（${preview.changes.length}处）</summary><p class="pi-hint">目标聊天：${esc(scope.chatLabel || '当前聊天')}</p><ul>${preview.changes.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>无改动</li>'}</ul></details>
          ${hasFacts ? '<p class="pi-hint">本聊天已有关键事实表，模板不追加行。写入后如果大纲里有表里还没有的线索，会接着打开「补全表格」补上。</p>' : plan.facts.length ? `<h4 class="pi-fr-title">开局要用${plan.facts.length}条线索</h4>${later ? `<p class="pi-hint">另有${later}条要等剧情推进到那一步，到时自动补入表格。</p>` : ''}${factRowsHtml(plan.facts, 'gt', project.outline.volumes, project.clue.labels)}` : later ? `<p class="pi-hint">开局无需线索行，线索表先建为空表。${later}条要等剧情推进到那一步，到时自动补入表格。</p>` : '<p class="pi-hint">大纲中暂无线索编号，线索表先建为空表。</p>'}`,
            picked = await openDialog({
                title: '创建模板',
                html,
                onMount: (root) => hasFacts || mountFactRows(view, root, plan.facts, 'gt', project.outline.volumes, { gate: '写入当前聊天', keep: !0 }),
                actions: [
                    { label: '取消', value: null },
                    {
                        label: '写入当前聊天',
                        primary: !0,
                        value: (root) =>
                            plan.facts.map((f, i) => {
                                let l = root.querySelector(`[data-gt-label="${i}"]`),
                                    k = root.querySelector(`[data-gt-crit="${i}"]`),
                                    box = root.querySelector('[data-fr="gt"]'),
                                    label = l ? l.value.trim() : '',
                                    criterion = k ? k.value.trim() : '';
                                return { code: f.code, label, criterion, src: box && box.__srcOf ? box.__srcOf(f.code, label, criterion) : '' };
                            }),
                    },
                ],
            });
        if (!picked) return;
        if (!hasFacts) {
            let empty = picked.filter((f) => !f.label);
            if (empty.length) return toast('warning', `请为这些线索填写不透露答案的标签：${empty.map((f) => f.code).join('、')}`);
        }
        if (!prebuildScopeValid(view, scope))
            return toast('warning', '确认期间已切换聊天、项目、推进方式或数据隔离，未导入。请回原聊天重试。');
        let again = null;
        try {
            again = api.getTableTemplate({ scope: 'chat' });
        } catch {}
        if (JSON.stringify(again) !== JSON.stringify(base))
            return toast('warning', '确认期间本聊天的表格模板有变化，未导入。请重新点「创建模板」。');
        view.runtime.clue.invalidate();
        let liveNow = view.runtime.clue.compute(),
            again2 = clueTplMismatch(base, (liveNow && liveNow.snap.tables) || {});
        if (again2.length) return toast('warning', `确认期间当前聊天的表格有变化，未导入：${again2[0]}。请重新点「创建模板」。`);
        let catalogNow = liveNow ? sceneCatalogCell(liveNow.state, liveNow.plan || { recognize: [] }, liveNow.prog) : '',
            gen = synthesizeClueTemplate(base, {
                clue: hasFacts
                    ? { scenes: plan.scenes }
                    : { controlRow: ['主线', '', catalogNow], factRows: picked, knowRows: plan.knows, scenes: plan.scenes },
            }),
            res = null,
            // 已经聊了一阵的聊天：导入后让线索表从当前楼层开始记，否则数据库会先从第 1 楼逐批补填
            late = !hasFacts && aiFloorCount(chatMessages()) >= START_MIN_AI && view.runtime.clue.canStartFromNow();
        try {
            res = await api.importTemplateFromData(gen.template, { scope: 'chat', dataMode: 'seed' });
        } catch (error) {
            res = { success: !1, message: (error && error.message) || String(error) };
        }
        if (!res || !res.success)
            return toast('error', `导入失败，表格和绑定都未改动：${(res && (res.message || res.error)) || '数据库未返回结果'}`);
        if (!prebuildScopeValid(view, scope))
            return toast(
                'warning',
                '模板已导入，但导入期间切换了聊天，未写入插件绑定。请回原聊天，在「表格绑定」点「填入示例」再「应用」。',
            );
        (view.data.updateProject(view.projectId, (p) => ({
            ...p,
            clue: normalizeClue({ ...p.clue, bindings: { ...p.clue.bindings, ...gen.binding, switch: null } }),
        })),
            hasFacts || keepLabels(view, picked, scope.projectId),
            view.runtime.clue.invalidate());
        let after = view.runtime.clue.compute(),
            names = new Set(
                Object.values((after && after.snap.tables) || {})
                    .filter((x) => x && x.name)
                    .map((x) => x.name),
            ),
            lost = ['线索控制表', '关键事实表', '知情表'].filter((n) => !names.has(n)),
            afterTables = (after && after.snap.tables) || {},
            gone =
                res.runtimeReady === !1
                    ? []
                    : Object.values((liveNow && liveNow.snap.tables) || {})
                          .filter((s) => s && s.name)
                          .flatMap((s) => {
                              let now = Object.values(afterTables).find((x) => x && x.name === s.name);
                              if (!now) return [`表「${s.name}」`];
                              let have = clueTplHeader(now);
                              return clueTplHeader(s)
                                  .filter((h) => h && !have.includes(h))
                                  .map((h) => `「${s.name}」的列「${h}」`);
                          });
        // 新版模板生成的聊天默认开启收起（方案 三.3）
        res.runtimeReady !== !1 && view.runtime.clue.foldChat() === '' && view.runtime.clue.setFoldChat('on');
        if ((view.renderBody(), gone.length))
            return toast(
                'error',
                `模板已导入，但原有的下列表格内容现在无法读取：${gone.slice(0, 6).join('、')}。请到数据库的模板或数据管理中检查（可能被隐藏），不要重复导入。`,
            );
        // 新表数据库还没载入（SQLite 模式常见）：让它重新读取数据，不必让玩家去点「重新读表」；还没载入的，下次表格更新时插件再补行
        (res.runtimeReady === !1 || lost.length) &&
            typeof api.refreshDataAndWorldbook == 'function' &&
            (await Promise.resolve(api.refreshDataAndWorldbook()).catch(() => !1), view.runtime.clue.invalidate(), view.runtime.clue.scheduleSync());
        toast(
            'success',
            `已导入。${gen.changes.length}处改动${gen.problems.length ? `，${gen.problems.length}处需要注意（见预览）` : ''}。插件绑定已更新。`,
        );
        // 已有线索表：模板只更新场景等，缺的线索行接着补（用户 2026-11-23：分不清什么时候用「补全表格」）
        if (hasFacts && res.runtimeReady !== !1 && !lost.length && after) {
            let p2 = view.project(),
                d2 = prebuildDiff(prebuildPlan(p2.outline.volumes), after.snap, p2.clue.bindings);
            d2.factTable && (d2.newFacts.length || d2.newKnows.length) && (await clueActions['clue-prebuild'](view));
        }
        // 表暂时没读到也照样记下：数据库载入以后插件自己开始
        late && (await view.runtime.clue.wantStart());
    },
    // 场景编号对照：只含编号、入口、地点，供粘贴进线索控制表说明（官方填表只展开目标表）。
    async 'clue-catalog'(view) {
        let plan = prebuildPlan(view.project().outline.volumes),
            text = plan.scenes.length
                ? [
                      '【场景编号对照】（只用于对号；不表示已经开放或已经发生）',
                      ...plan.scenes.map((s) => `- ${s.uid}：${[s.entry, s.place && `地点：${s.place}`].filter(Boolean).join('；')}`),
                  ].join(`
`)
                : '';
        if (!text) return toast('info', '大纲中无带入口的节点。');
        await openDialog({
            title: '场景编号对照',
            html: `<p class="pi-hint">复制下面的文字，粘贴到数据库「线索控制表」说明（note）的末尾。只包含入口和地点，不含发现。长主线建议只放当前几个阶段的节点。</p><textarea class="pi-ta is-mono is-tall" readonly>${esc(text)}</textarea>`,
            actions: [{ label: '关闭', value: !0, primary: !0 }],
        });
    },
    async 'clue-wd-keep'(view, target) {
        let r = await view.runtime.clue.settleWithdrawn(target.dataset.id, !0);
        (view.renderBody(), r && r.done ? toast('success', '已保留这次登记。') : toast('warning', `没有恢复：${(r && r.why) || '原因未知'}`));
    },
    async 'clue-wd-drop'(view, target) {
        let r = await view.runtime.clue.settleWithdrawn(target.dataset.id, !1);
        (view.renderBody(), r && r.done || toast('info', (r && r.why) || '没有执行'));
    },
    'clue-fact-keep'(view, target) {
        (view.runtime.clue.act({ kind: 'fact', target: target.dataset.id, value: 'kept', note: '玩家保留：照表格判断' }), view.renderBody());
    },
    // 手机无悬停说明：首次作废先确认（同次打开不再问）。票据在点击时取，确认期间切换聊天、项目或模式则不执行。
    async 'clue-fact-void'(view, target) {
        let s0 = view.runtime.clue.opScope(),
            id = target.dataset.id;
        if (
            !voidAsked &&
            !(await confirmDialog({
                title: '作废这条线索？',
                body: '按未获得处理，相关表格改回未获得。以后正文里真的查到了，点「解除作废」恢复按表格判断。已生成的正文不删除。',
                okLabel: '作废',
            }))
        )
            return;
        voidAsked = !0;
        let r = await view.runtime.clue.voidFact(id, s0);
        (view.renderBody(),
            !r || !r.done
                ? toast('info', (r && r.why) || '未执行作废')
                : r.table === 'ok'
                  ? toast('success', '已作废，表格已改回未获得。')
                  : toast(
                        'warning',
                        `已作废（按未获得处理），但${r.table === 'partial' ? '表格仅部分改动' : '表格未改动'}：${r.why || '原因未知'}`,
                    ));
    },
    'clue-fact-restore'(view, target) {
        let eff = view.runtime.clue.restoreFact(target.dataset.id);
        (view.renderBody(),
            toast(
                'info',
                eff && eff.confirmed
                    ? '已解除作废：表格记录为已获得，按已获得处理。'
                    : '已解除作废：表格中没有这条记录，按未获得处理。作废时清除的记录不会恢复。',
            ));
    },
    'clue-leave'(view, target) {
        (view.runtime.clue.leaveScene(target.dataset.uid),
            toast('info', '已记录主角离开这件事：不再注入这件事的场景，仅提供入口。'),
            view.renderBody());
    },
    async 'clue-node-menu'(view, target) {
        let clue = view.runtime.clue,
            c = clue.compute(),
            uid = target.dataset.uid,
            s = c && c.state.nodeStates.find((x) => x.node.uid === uid);
        if (!s) return;
        let over = c.prog.overrides[uid] || {},
            items = [
                ...(s.status === 'available' && c.state.focus.uid !== uid ? [{ label: '设为本轮场景', value: 'focus' }] : []),
                ...(c.state.focus.uid === uid ? [{ label: '主角已离开（仅提供入口）', value: 'leave' }] : []),
                ...(s.status === 'locked' && !s.manualOpen ? [{ label: '手动开放（不计为获得线索）', value: 'open:force' }] : []),
                ...(over.open
                    ? [{ label: over.open === 'force' ? '取消手动开放' : '取消停用', value: 'open:' }]
                    : [{ label: '暂时停用这个节点', value: 'open:block' }]),
                ...(s.status !== 'done'
                    ? [{ label: '手动标记完成', value: 'done:fill' }]
                    : over.done !== 'force'
                      ? [
                            { label: '标为未完成（清掉这一步的登记，之后重新按表格判断）', value: 'done:clear' },
                            { label: '一直按未完成（忽略表格，直到改回按表格判断）', value: 'done:undo' },
                        ]
                      : []),
                ...(over.done ? [{ label: '完成状态改回按表格判断', value: 'done:' }] : []),
                ...(s.node.required
                    ? [{ label: over.skip ? '取消跳过' : '跳过（不阻塞本阶段，也不计为完成）', value: over.skip ? 'skip:' : 'skip:true' }]
                    : []),
                { label: '手动确认或作废一条线索…', value: 'fact' },
            ],
            pick = await menuDialog({ title: s.node.name, items });
        if (!pick) return;
        if (pick === 'focus') return (clue.setFocus(uid), view.renderBody());
        if (pick === 'leave') return (clue.leaveScene(uid), view.renderBody());
        if (pick === 'fact') return factDialog(view, s);
        if (pick === 'done:fill') return markDoneDialog(view, uid);
        if (pick === 'done:clear') return clearDone(view, uid);
        let [kind, value] = pick.split(':'),
            note =
                kind === 'open' && value === 'force'
                    ? await promptDialog({ title: '记录原因（可空）', label: '原因' })
                    : '';
        note !== null && (clue.act({ kind, target: uid, value: value === 'true' ? !0 : value, note }), view.renderBody());
    },
};

// 手动标记完成（线索建行与登记方案 二.4）：这个节点表里还没登记的线索，选实际拿到了没有（已核实 / 存疑 / 没拿到）；
// 后面的条件要求某人知道 / 核实、表里还没有的，顺带勾选。SQLite 写进表格，原生存储只改插件判断。
async function markDoneDialog(view, uid) {
    let clue = view.runtime.clue,
        s0 = clue.opScope(),
        info = clue.nodeFillIn(uid);
    if (!info) return;
    let fb = (view.project().clue.bindings.facts || [])[0] || {},
        yes = cellText(Array.isArray(fb.已核实值) ? fb.已核实值[0] : fb.已核实值) || '已核实',
        claim = cellText(Array.isArray(fb.说法值) ? fb.说法值[0] : fb.说法值) || '存疑',
        name = (x) => x.label || factName(x.f) || '一条线索',
        rows = info.missing
            .map(
                (x, i) => `<div class="pi-fi-row"><b>${esc(name(x))}</b><div class="pi-row">${[
                    [yes, '已核实'],
                    [claim, '存疑（只是说法）'],
                    ['', '没拿到'],
                ]
                    .map(([v, label]) => `<label class="pi-check"><input type="radio" name="pi-fi-${i}" value="${esc(v)}"${v === (x.claim ? claim : yes) ? ' checked' : ''}><span>${label}</span></label>`)
                    .join('')}</div></div>`,
            )
            .join(''),
        gates = info.gates
            .map((g, i) => `<label class="pi-check"><input type="checkbox" data-fi-know="${i}"><span>${esc(g.actor)}${g.verified ? '已核实' : '已获知'}「${esc(name({ f: g.fact, label: (info.missing.find((x) => x.f === g.fact) || {}).label }))}」（后面的条件要用）</span></label>`)
            .join(''),
        html = `${rows ? `<p class="pi-hint">这一步表里还没登记的线索，选实际情况：</p>${rows}` : ''}${gates ? `<p class="pi-hint">表里还没有、后面又要用的知情：</p>${gates}` : ''}${info.sql ? '' : '<p class="pi-hint is-warn">数据库不是 SQLite 存储模式：只改插件判断，不改表格。</p>'}<label class="pi-field"><span>原因（可空）</span><input class="pi-inp" data-fi-note></label>`,
        picked = await openDialog({
            title: `标记完成：${info.node.name}`,
            html,
            actions: [
                { label: '取消', value: null },
                {
                    label: '标记完成',
                    primary: !0,
                    value: (root) => ({
                        picks: info.missing.map((x, i) => ({ f: x.f, status: (root.querySelector(`input[name="pi-fi-${i}"]:checked`) || {}).value || '' })),
                        knows: info.gates.filter((g, i) => root.querySelector(`[data-fi-know="${i}"]`).checked),
                        note: root.querySelector('[data-fi-note]').value.trim(),
                    }),
                },
            ],
        });
    if (!picked) return;
    let r = await clue.markNodeDone(uid, picked.picks, picked.knows, picked.note, s0);
    (view.renderBody(),
        r.done ? toast('success', r.table === 'ok' ? '已标记完成，表格已同步。' : '已标记完成（只改插件判断，表格没改）。') : toast('warning', `没有标记：${r.why}`));
}
// 标为未完成（一次性）：清掉这一步的登记，之后按表格重新判断；完成条件不靠线索时，问要不要一直按未完成
async function clearDone(view, uid) {
    let clue = view.runtime.clue,
        r = await clue.clearNodeDone(uid);
    if (r.done && !r.stillDone) return (view.renderBody(), toast('success', r.cleared.length ? '已标为未完成，这一步的登记已清掉，之后重新按表格判断。' : '已标为未完成。'));
    let why = r.native ? '数据库不是 SQLite 存储模式，插件没法清掉表里的登记。' : r.stillDone ? `这一步的完成条件不只看线索（${r.why}），清掉登记后仍算完成。` : r.why;
    if (!r.done && !r.native) return toast('warning', `没有改：${why}`);
    (await confirmDialog({ title: '一直按未完成？', body: `${why}可以改成一直按未完成（忽略表格），以后在菜单里点「完成状态改回按表格判断」恢复。`, okLabel: '一直按未完成' })) &&
        clue.act({ kind: 'done', target: uid, value: 'undo', note: '一直按未完成' });
    view.renderBody();
}
export async function factDialog(view, s) {
    let refs = nodeFactRefs(s.node),
        id = await promptDialog({
            title: '线索编号',
            label: refs.length ? `这个节点用到的线索：${refs.join('、')}` : '填线索编号（大纲「发现」里的「事实」）',
            value: refs[0] || '',
        });
    if (!id || !id.trim()) return;
    let code = id.trim(),
        kept = view.project().clue.noFold.includes(code),
        pick = await menuDialog({
            title: `线索${code}`,
            items: [
                { label: '手动确认已获得（表格没记上时用）', value: 'confirmed' },
                { label: '作废（当作没拿到，表格改回未获得）', value: 'revoked' },
                { label: '改回按表格判断', value: '' },
                kept ? { label: '恢复为可收起', value: 'fold:on' } : { label: '收起已结束的线时保留这条', value: 'fold:off' },
            ],
        });
    if (pick === null) return;
    if (pick.startsWith('fold:')) {
        view.data.updateProject(view.projectId, (p) => ({
            ...p,
            clue: normalizeClue({ ...p.clue, noFold: pick === 'fold:off' ? [...p.clue.noFold, code] : p.clue.noFold.filter((x) => x !== code) }),
        }));
        return (toast('info', pick === 'fold:off' ? `${code}会保留在表中，不收起。` : `${code}恢复为可收起。`), view.renderBody());
    }
    // 确认：选已核实还是存疑，写进表格（原生存储只改插件判断）；作废：和「正文可能自行编造」那一行的作废一样改表
    if (pick === 'revoked') return clueActions['clue-fact-void'](view, { dataset: { id: code } });
    if (pick === 'confirmed') {
        let fb = (view.project().clue.bindings.facts || [])[0] || {},
            yes = cellText(Array.isArray(fb.已核实值) ? fb.已核实值[0] : fb.已核实值) || '已核实',
            claim = cellText(Array.isArray(fb.说法值) ? fb.说法值[0] : fb.说法值) || '存疑',
            status = await menuDialog({
                title: `确认${code}`,
                items: [
                    { label: '已核实（亲眼看到、读到原件、得到验证）', value: yes },
                    { label: '存疑（只是某人的说法）', value: claim },
                ],
            });
        if (!status) return;
        let r = await view.runtime.clue.confirmFact(code, status);
        return (
            view.renderBody(),
            r.done ? toast('success', r.table === 'ok' ? '已确认，表格已同步。' : '已确认（只改插件判断，表格没改）。') : toast('warning', `没有确认：${r.why}`)
        );
    }
    let note = await promptDialog({ title: '记录原因', label: '依据 / 来源（建议填写）' });
    note !== null && (view.runtime.clue.act({ kind: 'fact', target: code, value: pick, note }), view.renderBody());
}

export function clueOnChange(view, target) {
    return target.dataset.clueSidelimit !== void 0
        ? (view.data.updateProject(view.projectId, (p) => ({ ...p, clue: normalizeClue({ ...p.clue, sideLimit: Number(target.value) }) })),
          view.runtime.clue.invalidate('line-limit'),
          view.runtime.clue.scheduleSync(),
          view.renderBody(),
          !0)
        : target.dataset.clueFoldauto !== void 0
            ? (foldAutoToggle(view, target), !0)
            : target.dataset.clueLinetoast !== void 0
          ? (view.data.updateProject(view.projectId, (p) => ({ ...p, clue: normalizeClue({ ...p.clue, lineToast: target.checked }) })),
            view.renderBody(),
            !0)
          : !1;
}

// 剧情线搜索：只在页面上筛，不重画（输入框不丢焦点）；有字时跨段显示匹配的行。
export function clueOnInput(view, target) {
    if (target.dataset.clueLineQ === void 0) return !1;
    let st = view.tabState('run'),
        q = (st.lineQ = target.value).trim().toLowerCase(),
        card = target.closest('.pi-line-card'),
        c = view.runtime.clue.compute();
    if (!card || !c) return !0;
    let byId = new Map((c.state.lineStates || []).map((s) => [s.line.id, s])),
        tab = st.lineTab || 'now';
    card.querySelectorAll('[data-line-row]').forEach((row) => {
        let s = byId.get(row.dataset.lineRow);
        row.hidden = !!q && !(s && lineMatches(s, q));
    });
    card.querySelectorAll('[data-line-grp]').forEach((g) => (g.hidden = !q && g.dataset.lineGrp !== tab));
    card.querySelectorAll('[data-act="clue-line-tab"]').forEach((b) => b.classList.toggle('is-sel', !q && b.dataset.tab === tab));
    return !0;
}

// 关掉「收起已结束的线」：只停止以后的收起，已收起的要恢复才回到表格
async function foldAutoToggle(view, target) {
    let set = (on) => view.data.updateProject(view.projectId, (p) => ({ ...p, clue: normalizeClue({ ...p.clue, foldAuto: on }) }));
    if (target.checked) return (set(!0), view.renderBody());
    let f = view.runtime.clue.foldCheck(),
        n = f ? f.status.filter((x) => x.st === 'folded' || x.st === 'lost').length : 0;
    if (!n) return (set(!1), view.renderBody());
    let pick = await openDialog({
        title: '关闭收起',
        html: `<p class="pi-hint">仅停止之后的收起。已收起的${n}行不会自动恢复到表格。</p>`,
        actions: [
            { label: '取消', value: null },
            { label: '全部恢复并关闭', value: 'all' },
            { label: '仅关闭', value: 'off', primary: !0 },
        ],
    });
    if (!pick) return ((target.checked = !0), view.renderBody());
    set(!1);
    if (pick === 'all') foldRestoreToast(await view.runtime.clue.foldRestore(() => !0));
    view.renderBody();
}

function foldRestoreToast(r) {
    !r || !r.ok
        ? toast('info', `未恢复：${(r && r.why) || '原因未知'}。`)
        : toast(
              r.failed ? 'warning' : 'success',
              `已恢复${r.rows}行${r.failed ? `；${r.failed}行未恢复，可再试一次` : ''}${r.missingCols.length ? `；表中已没有这些列：${r.missingCols.join('、')}` : ''}。`,
          );
}

export const LINE_BADGE = { 未触发: '', 可开启: 'is-warn', 进行中: 'is-ok', 暂停: 'is-warn', 完成: 'is-ok', 放弃: '' };

export function readableReason(text, c, labels) {
    let names = /* @__PURE__ */ new Map();
    for (let n of c.compiled.nodes) {
        n.uid && names.set(n.uid, `「${n.name}」`);
        for (let d of discoveryList(isPlainObject(n.item) ? n.item : {}))
            d.fact &&
                !names.has(d.fact) &&
                names.set(
                    d.fact,
                    `「${(labels[d.fact] && labels[d.fact].label) || (d.text.length > 20 ? `${d.text.slice(0, 20)}…` : d.text)}」`,
                );
    }
    for (let l of c.compiled.lines || []) names.set(l.id, `「${l.name}」`);
    for (let [code, v] of Object.entries(labels)) names.has(code) || names.set(code, `「${v.label}」`);
    return String(text)
        .replace(/尚无记录/g, '尚未发生')
        .replace(/\b(?:线 |节点 )?([A-Za-z][\w-]*)\b/g, (all, id) => (names.has(id) ? names.get(id) : all));
}

export function lineWaitText(s, c, labels = {}) {
    let l = s.line,
        plan = c.plan;
    if (s.missed) return s.window.reasons.join('；');
    if (s.state === '未触发')
        return `等待：${[...(s.cond.v === 'true' ? [] : s.cond.reasons), ...(s.window && s.window.v !== 'true' ? s.window.reasons : [])].map((r) => readableReason(r, c, labels)).join('；') || '开启条件'}`;
    if (s.state === '可开启')
        return l.kind === 'main'
            ? c.prog.mainPaused
                ? '主线已全部暂停。'
                : l.mode === 'manual'
                  ? '手动开始：点「进入」，正在进行的主线会先暂停。'
                : s.waitMain
                  ? `${s.waitMain}，轮到它时自动开始。`
                  : ''
            : plan && plan.unsynced && s.entries.length && s.entries.every((u) => plan.unsynced.includes(u))
              ? '准备中，下一轮开始提示。'
              : l.mode === 'manual'
                ? '手动开始：不主动提示，点「进入」。'
                : c.prog.sidePaused
                  ? '支线已全部暂停。'
                  : plan && plan.slots.full
                    ? '同时进行的支线已满，正文暂不提及；主角自行进入时，顶端会出现「切换」。'
                    : plan && plan.offer && plan.offer.line === l.id
                      ? '正文会在合适时提供入口，主角进入后开始。'
                      : s.entries.length
                        ? '排队中，轮到时正文会提供入口；主角自行进入也会开始。'
                        : '第一阶段暂无可开始的场景。';
    if (s.state !== '进行中') return '';
    let away = c.away && c.away[l.id];
    return (
        away &&
            c.state.focus.uid &&
            c.state.nodeStates.some((n) => n.node.uid === c.state.focus.uid && n.node.unit.line && n.node.unit.line.id === l.id) &&
            (away = null),
        away ? `已离开${away.rounds}轮${away.place ? `，上次在${away.place}` : ''}` : s.why
    );
}

// 剧情线卡：两条以上时按「进行中 / 未进行 / 已结束」分段，一次显示一段；超过 8 条加搜索框（方案 三.9）。
// 其他段的行仍在页面里（hidden），搜索时跨段显示匹配的行。fold：收起检查结果（foldCheck）。
const LINE_TABS = [
    ['now', '进行中'],
    ['idle', '未进行'],
    ['end', '已结束'],
];
export function lineGroup(s) {
    return s.state === '进行中' ? 'now' : ENDED_STATES.includes(s.state) ? 'end' : 'idle';
}
function lineMatches(s, q) {
    let t = cellText(q).toLowerCase();
    return !t || `${s.line.id} ${lineDisplayName(s.line)}`.toLowerCase().includes(t);
}
const FOLD_WHY = { produce: '也由{by}产出', read: '被{by}引用', keep: '设为不收起' };
function foldKeptText(kept) {
    let groups = new Map();
    for (let k of kept) {
        let by = k.by.map((x) => x || '其他阶段').join('、'),
            key = FOLD_WHY[k.why].replace('{by}', by);
        (groups.get(key) || groups.set(key, []).get(key)).push(k.fact);
    }
    return [...groups].map(([why, facts]) => `${facts.join('、')} ${why}`).join('；');
}
function foldMeta(x, auto) {
    if (!x) return '';
    let kept = x.kept.length ? `<p class="pi-hint">${esc(foldKeptText(x.kept))}，保留在表中。</p>` : '',
        parts = [
            x.folded ? `已收起${x.folded}行` : '',
            x.rows ? (x.fill.ok || !auto ? `可收起${x.rows}行` : `${x.rows}行待下次填表后收起`) : '',
            x.checking ? `${x.checking}行待核对` : '',
        ].filter(Boolean);
    return { tag: parts.join('，') || (x.kept.length ? '无可收起的行' : '表中无对应的行'), kept };
}
export function lineCard(c, project, st7 = {}, fold = null, view0 = null) {
    let list = c.state.lineStates || [];
    if (!list.length) return '';
    let foldOf = new Map(((fold && fold.lines) || []).map((x) => [x.id, x])),
        autoFold = !!fold && !!FOLD_AUTO_RELEASED[fold.storage] && !fold.blocked,
        sides = list.filter((s) => s.line.kind === 'side'),
        mains = list.filter((s) => s.line.kind === 'main'),
        limit = c.plan ? c.plan.slots.limit : 1,
        used = c.plan ? c.plan.slots.used.length : 0,
        row = (s) => {
            let l = s.line,
                wait = lineWaitText(s, c, isPlainObject(project.clue.labels) ? project.clue.labels : {}),
                btn = (v, label, cls = '', tip = '') =>
                    `<button type="button" class="pi-btn is-sm${cls}" data-act="clue-line" data-id="${esc(l.id)}" data-value="${v}"${tip ? ` title="${esc(tip)}"` : ''}>${label}</button>`,
                canEnter = !s.started && !s.manual.state && s.eligible && (l.kind === 'main' ? !c.prog.mainPaused : !s.waitMain),
                inQueue =
                    l.kind === 'side' &&
                    l.mode !== 'manual' &&
                    s.state === '可开启' &&
                    s.entries.length &&
                    c.plan &&
                    !c.plan.slots.full &&
                    !c.prog.sidePaused,
                undo =
                    s.manual.evidence && s.manual.evidence !== 'manual' && !s.manual.evidence.startsWith('auto@') && s.state === '进行中'
                        ? btn('deny', '取消开启', ' is-ghost', '取消自动开启：这条线回到可开启，同一次依据不再自动开启')
                        : s.manual.started || s.manual.state
                          ? btn('', '撤销手动操作', ' is-ghost', '撤销这条线上的进入、暂停、完成、放弃操作，恢复按条件自动判断')
                          : '',
                checks = !s.started && !s.manual.state && l.mode !== 'manual' ? tableCondChecks(l.open, c.snap.tables || {}) : [],
                stuck = checks.filter((x) => x.stuck),
                fix = stuck.length
                    ? `<p class="pi-hint is-warn">开启条件读不出：${esc(stuck.flatMap((x) => x.notes).join('；'))}。这条线会一直无法开启。 <button type="button" class="pi-btn is-sm" data-act="clue-line-manual" data-id="${esc(l.id)}" title="开启条件移到「原开启条件」仅供查看，不再自动判断；执行页显示「进入」按钮，需要时点击">改为手动</button></p>`
                    : '',
                orig = l.origCond ? `<p class="pi-hint">原开启条件（自行判断何时点「进入」）：${esc(l.origCond)}</p>` : '',
                tierBtns = checks
                    .filter((x) => x.tierPending)
                    .map(
                        (x) =>
                            `<p class="pi-hint is-warn">档位顺序由AI推断：${esc(x.tierPending.join(' < '))}。确认前这个条件视为未知。 <button type="button" class="pi-btn is-sm" data-act="clue-tiers" data-tiers="${esc(JSON.stringify(x.tierPending))}" title="大纲中使用相同档位的条件都视为已确认">顺序正确</button> <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-line-manual" data-id="${esc(l.id)}">改为手动</button></p>`,
                    )
                    .join(''),
                group = l.kind === 'side' ? sides : mains,
                k = group.indexOf(s),
                arrows =
                    group.length > 1
                        ? `<button type="button" class="pi-btn is-sm is-ghost" data-act="clue-line-move" data-id="${esc(l.id)}" data-dir="-1"${k <= 0 ? ' disabled' : ''}>上移</button><button type="button" class="pi-btn is-sm is-ghost" data-act="clue-line-move" data-id="${esc(l.id)}" data-dir="1"${k >= group.length - 1 ? ' disabled' : ''}>下移</button>`
                        : '';
            let title = lineDisplayName(l),
                main0 = canEnter ? btn('enter', '进入', ' is-primary', l.mode === 'manual' ? '手动开始这条线' : '主角已开始这件事但填表未识别时使用，或需要立即开始') : s.state === '暂停' ? btn('resume', '继续', ' is-primary') : '',
                // 「⋯」菜单只列这条线当前可用的操作
                g1 = [...(canEnter || s.state === '进行中' ? [btn('pause', '暂停', ' is-ghost')] : [])].join('') + arrows,
                g2 = [
                    ...(s.state === '进行中' ? [btn('done', '标记完成', ' is-ghost')] : []),
                    ...(canEnter && inQueue ? [btn('skip', '跳过', ' is-ghost')] : []),
                    ...(s.state === '进行中' || s.state === '暂停' ? [btn('abandon', '放弃', ' is-ghost is-danger')] : []),
                ].join(''),
                fx = foldOf.get(l.id),
                foldBtn = (v, label) => `<button type="button" class="pi-btn is-sm is-ghost" data-act="clue-fold" data-id="${esc(l.id)}" data-value="${v}">${label}</button>`,
                g3 = fx && fold && !fold.blocked ? [fx.rows ? foldBtn('collapse', '收起') : '', fx.folded ? foldBtn('restore', '放回表格') : ''].join('') : '',
                groups3 = [g1, g2, g3, undo].filter(Boolean),
                more = groups3.length ? `<details class="pi-line-more"><summary class="pi-icon-btn" title="更多">${ICONS.more}</summary><div class="pi-line-menu">${groups3.map((g) => `<div class="pi-line-menu-g">${g}</div>`).join('')}</div></details>` : '';
            let fm = foldMeta(foldOf.get(l.id), autoFold);
            // 两层：线名和「进入 / 继续」「⋯」一行，第二行主线 / 支线和状态；下面是简介、在等什么、收起和条件提示
            return `<div class="pi-line-row" data-line-row="${esc(l.id)}"${lineMatches(s, st7.lineQ) ? '' : ' hidden'}><div class="pi-line-head"><b class="pi-line-name">${esc(title)}</b><div class="pi-line-acts">${main0}${more}</div></div>
          <div class="pi-line-tags"><span class="pi-badge">${l.kind === 'main' ? '主线' : '支线'}</span><span class="pi-badge ${s.missed ? '' : LINE_BADGE[s.state] || ''}">${esc(s.missed ? '已错过' : s.state)}</span>${l.kind === 'side' && c.prog.sidePaused && s.state === '进行中' ? '<span class="pi-meta">全部支线已暂停</span>' : ''}${fm ? `<span class="pi-meta">${esc(fm.tag)}</span>` : ''}</div>
          ${l.brief ? `<p class="pi-hint">${esc(l.brief)}</p>` : ''}${wait ? `<p class="pi-hint">${esc(maskFacts(wait))}</p>` : ''}${fm ? fm.kept : ''}${orig}${fix}${tierBtns}</div>`;
        },
        mainBtn =
            mains.length > 1 || c.prog.mainPaused
                ? `<button type="button" class="pi-btn is-sm${c.prog.mainPaused ? ' is-primary' : ''}" data-act="clue-pause-mains" data-value="${c.prog.mainPaused ? '' : '1'}" title="${c.prog.mainPaused ? '主线恢复注入，原进行中的主线继续' : '所有主线暂停推进与注入；支线照常'}">${c.prog.mainPaused ? '继续全部主线' : '暂停全部主线'}</button>`
                : '',
        sideBtn = sides.length
            ? `<button type="button" class="pi-btn is-sm${c.prog.sidePaused ? ' is-primary' : ''}" data-act="clue-pause-side" data-value="${c.prog.sidePaused ? '' : '1'}" title="${c.prog.sidePaused ? '支线恢复注入和提示，原进行中的支线继续' : '所有支线停止注入和新提示；主线照常，进度和名额保留'}">${c.prog.sidePaused ? '继续全部支线' : '暂停全部支线'}</button>`
            : '';
    // 收起说明、本聊天开启入口、收起记录：多条线时放在「已结束」页，只有一条线时放在这条线下面（GPT 实测修复审阅 R1）
    let endNote = fold
                ? fold.blocked
                    ? `<p class="pi-hint">${esc(fold.blocked)}，不收起。</p>`
                    : autoFold
                      ? ''
                      : '<p class="pi-hint">可在「⋯」里手动收起。</p>'
                : '',
            foldedRows = fold ? fold.status.filter((x) => x.st === 'folded' || x.st === 'lost').length : 0,
            chatFold = autoFold && project.clue.foldAuto !== !1 ? view0.runtime.clue.foldChat() : 'on',
            // 没选过的聊天问一次；询问时点过「不收」的聊天留一个入口能改回来（「本聊天不收起」勾选已去掉，实测问题 1）
            ask =
                chatFold === '' && fold.lines.some((x) => x.rows)
                    ? '<p class="pi-hint">本聊天尚未开启自动收起。 <button type="button" class="pi-btn is-sm" data-act="clue-fold-chat" data-value="ask">开启</button></p>'
                    : chatFold === 'off'
                      ? '<p class="pi-hint">本聊天不收起。 <button type="button" class="pi-btn is-sm" data-act="clue-fold-chat" data-value="ask">开启</button></p>'
                      : '',
            endFoot = fold && fold.records.length ? `<div class="pi-line-endfoot"><span class="pi-meta">${foldedRows ? `已收起${foldedRows}行` : ''}</span><span class="pi-spacer"></span><button type="button" class="pi-btn is-sm is-ghost" data-act="clue-fold-log">收起记录</button></div>` : '';
    let body = list.map(row).join('');
    list.length === 1 && (body += lineGroup(list[0]) === 'end' ? endNote + ask + endFoot : endFoot);
    // 线多时按 进行中 / 未进行 / 已结束 分页，超过 8 条加搜索；已结束页带收起说明和收起记录
    if (list.length > 1) {
        let q = cellText(st7.lineQ),
            tab = LINE_TABS.some(([k]) => k === st7.lineTab) ? st7.lineTab : 'now',
            of = (g) => list.filter((s) => lineGroup(s) === g),
            empty = { now: '暂无进行中的剧情线。', idle: '暂无未进行的剧情线。', end: '暂无已结束的剧情线。' };
        body = `<div class="pi-seg pi-line-seg">${LINE_TABS.map(([k, label]) => `<button type="button" class="pi-seg-btn${k === tab && !q ? ' is-sel' : ''}" data-act="clue-line-tab" data-tab="${k}">${label}（${of(k).length}）</button>`).join('')}</div>
        ${list.length > 8 ? `<input class="pi-inp pi-line-search" data-clue-line-q placeholder="搜索编号或名称" value="${esc(q)}">` : ''}
        ${LINE_TABS.map(([k]) => {
            let rows = of(k);
            return `<div class="pi-line-grp" data-line-grp="${k}"${q || k === tab ? '' : ' hidden'}>${k === 'end' && rows.length ? endNote + ask : ''}${rows.map(row).join('') || (q ? '' : `<p class="pi-hint">${empty[k]}</p>`)}${k === 'end' ? endFoot : ''}</div>`;
        }).join('')}`;
    }
    return `<div class="pi-card pi-line-card"><h3>剧情线${list.length > 1 ? `<span class="pi-meta">共${list.length}条</span>` : ''}${c.prog.mainPaused || c.prog.sidePaused ? `<span class="pi-spacer"></span>${c.prog.mainPaused ? mainBtn : ''}${c.prog.sidePaused ? sideBtn : ''}` : ''}</h3>
        ${body}
        <p class="pi-hint pi-line-foot">条件满足后，正文会适时提供入口，主角进入后才算开始。「进入」「跳过」「暂停」等操作记在当前楼，删楼或重新生成会一并撤销。</p></div>`;
}

export function hereText(c) {
    let g = findGlobalTable(Object.values(c.snap.tables || {})),
        cell = g && g.place ? readCell(c.snap.tables || {}, `${g.name}/${g.row}/${g.place}`) : { state: 'unknown' },
        here = cell.state === 'ok' ? cellText(cell.value) : '',
        focus = c.state.nodeStates.find((s) => s.node.uid && s.node.uid === c.state.focus.uid),
        place = focus ? clueText(isPlainObject(focus.node.item) ? focus.node.item.地点 : '') : '';
    return here || place ? `主角当前位置：${esc(here || '（表格未记录）')}${focus ? `；这一场的地点：${esc(place || '（大纲未写）')}` : ''}<br>` : '';
}

export function stayNotice(view, c) {
    let info = view.runtime.clue.stayInfo(),
        st = info && info.key ? stayState(view.runtime.progress().stays, chatMessages(), info) : null;
    return st && st.idle >= 7
        ? `<p class="pi-hint is-warn">本场已连续${st.idle}条回复未出现新发现。可让主角离开（点「已离开」）或暂停剧情；也可能是填表漏记，请对照正文检查。</p>`
        : '';
}

// pid：写入的项目；写表途中可能切换项目，须写回开始时的项目
export function keepLabels(view, picked, pid = view.projectId) {
    let p = pid ? view.data.project(pid) : null;
    if (!p) return !1;
    let ctx = new Map(
            factLabelContext(
                p.outline.volumes,
                picked.map((f) => f.code),
            ).map((x) => [x.code, x]),
        ),
        add = {},
        old = (p.clue && p.clue.labels) || {};
    // 来源：与项目存的一字不差则照旧；弹窗中模型写且当场检查过 → ai；模型写但未检查 → gen；其余 → user
    for (let f of picked) {
        if (!f.label) continue;
        let was = old[f.code],
            same = was && was.label === f.label && (was.criterion || '') === (f.criterion || ''),
            // 文字未变但检查过且未透露 → 升为 ai
            src = same ? (f.src === 'ai' ? 'ai' : was.src) : f.src === 'ai' || f.src === 'gen' ? f.src : 'user';
        add[f.code] = { label: f.label, criterion: f.criterion || '', sig: factLabelSig(ctx.get(f.code) || { usedBy: [] }), ...(src ? { src } : {}) };
    }
    Object.keys(add).length &&
        view.data.updateProject(p.id, (cur) => ({
            ...cur,
            clue: normalizeClue({ ...cur.clue, labels: { ...(cur.clue.labels || {}), ...add } }),
        }));
    return !0;
}

// 未写进表格的输入（按项目、按编号），下次打开弹窗带出重试，仅本次页面内保留。键含项目、聊天、数据隔离、事实表，换任一项就不当作这里的重试。
const labelDrafts = /* @__PURE__ */ new Map();
const draftKey = (scope, iso, table) => JSON.stringify([scope.projectId, scope.chatId, iso, table]);
function dropLabelDrafts(key, codes) {
    let d = { ...(labelDrafts.get(key) || {}) };
    for (let code of codes) delete d[code];
    Object.keys(d).length ? labelDrafts.set(key, d) : labelDrafts.delete(key);
}

let labelJob = null;

let voidAsked = !1;

export async function prepareLabels(view, { quiet = !1 } = {}) {
    let project = view.project();
    if (!project || !isClueMode(project) || labelJob) return labelJob || { done: 0, missing: [] };
    let pid = project.id,
        todo = labelsToPrepare(project.outline.volumes, project.clue.labels);
    return todo.length
        ? ((labelJob = (async () => {
              // 按请求大小分批生成、审阅，最多 3 个并行；每批结果即存（生成稿 gen，审过 ai），失败批不影响其他；重试只补缺的
              let state = { done: 0, total: todo.length },
                  errors = [];
              labelProgress = state;
              try {
                  let ids = Array.isArray(project.imports) ? project.imports : [],
                      jobs = await Promise.all(
                          ids.map((id) =>
                              view.data.imports.get(id)
                                  ? Promise.resolve(view.data.imports.get(id))
                                  : view.data.imports.load(id).catch(() => null),
                          ),
                      ),
                      secrets = [
                          ...new Set([
                              ...jobs.filter(Boolean).flatMap((j) => importSecretNames(j.index) || []),
                              ...(projectSecretNames(project) || []),
                          ]),
                      ],
                      // 只写签名仍一致且期间未被用户改过的条目
                      save = (list) => {
                          let p = view.data.project(pid);
                          if (!p || !list.length) return 0;
                          let now = p.clue.labels || {},
                              add = {};
                          for (let x of list) {
                              let cur = now[x.code],
                                  base = x.base;
                              (!cur || (base ? cur.label === base.label && cur.criterion === base.criterion : cur.sig !== x.sig || cur.src === 'gen')) &&
                                  (add[x.code] = { label: x.label, criterion: x.criterion, sig: x.sig, src: x.src });
                          }
                          return (
                              Object.keys(add).length &&
                                  view.data.updateProject(pid, (q) => ({
                                      ...q,
                                      clue: normalizeClue({ ...q.clue, labels: { ...(q.clue.labels || {}), ...add } }),
                                  })),
                              Object.keys(add).length
                          );
                      },
                      ctxOf = new Map(todo.map((x) => [x.code, x])),
                      gen = todo.filter((x) => !x.review),
                      fresh = /* @__PURE__ */ new Map(),
                      genTasks = labelBatchesBy(gen, (batch) => msgChars(factLabelMessages(batch.map((x) => x.ctx), { secrets }))).map((batch) => async () => {
                          let r = parseFactLabels(
                                  await ask(view, 'outline', factLabelMessages(batch.map((x) => x.ctx), { secrets })),
                                  batch.map((x) => x.code),
                              ),
                              list = [];
                          for (let x of batch) {
                              let v = r.items.get(x.code);
                              v && v.label && (fresh.set(x.code, v), list.push({ code: x.code, label: v.label, criterion: v.criterion, sig: x.sig, src: 'gen' }));
                          }
                          save(list);
                      });
                  await runLabelPool(genTasks, (e) => errors.push(e));
                  // 待审：新生成的 + 之前未审的
                  let toReview = [
                          ...[...fresh].map(([code, v]) => ({ code, label: v.label, criterion: v.criterion })),
                          ...todo.filter((x) => x.review).map((x) => ({ code: x.code, ...x.review })),
                      ],
                      itemOf = (b) => {
                          let c = ctxOf.get(b.code).ctx;
                          return {
                              code: b.code,
                              label: b.label,
                              criterion: b.criterion,
                              answer: [c.answer, ...(c.routes || []).map((q) => q.answer)].filter(Boolean).join('；或者：'),
                              entry: c.entry,
                              scene: c.scene,
                              record: [c.record, ...(c.routes || []).map((q) => q.record)].filter(Boolean).join('；或者：'),
                              pieces: factLabelCheck({ label: b.label, criterion: b.criterion }, c, { secrets }).suspects.map((s) => s.piece),
                          };
                      },
                      rvItems = new Map(toReview.map((b) => [b, itemOf(b)])),
                      rvTasks = labelBatchesBy(toReview, (batch) => msgChars(factLabelReviewMessages(batch.map((b) => rvItems.get(b))))).map(
                          (batch) => async () => {
                              let items = batch.map((b) => rvItems.get(b)),
                                  map = parseFactLabelReview(
                                      await ask(view, 'outline', factLabelReviewMessages(items)),
                                      items.map((x) => x.code),
                                  ),
                                  list = [];
                              for (let b of batch) {
                                  let o = reviewOutcome(map.get(b.code), b);
                                  o.ok && list.push({ code: b.code, label: o.label, criterion: o.criterion, sig: ctxOf.get(b.code).sig, base: b, src: 'ai' });
                              }
                              state.done += save(list);
                          },
                      );
                  await runLabelPool(rvTasks, (e) => errors.push(e));
                  let after = view.data.project(pid),
                      left = after ? labelsToPrepare(after.outline.volumes, after.clue.labels) : todo,
                      noLabel = left.filter((x) => !x.review).map((x) => x.code),
                      unreviewed = left.filter((x) => x.review).map((x) => x.code),
                      why = errors.length ? `（${errors[0].message}）` : '';
                  return (
                      quiet ||
                          (left.length
                              ? toast(
                                    'warning',
                                    `线索标签：${todo.length - left.length}条已准备好${noLabel.length ? `，${noLabel.length}条未生成（${noLabel.slice(0, 5).join('、')}）` : ''}${unreviewed.length ? `，${unreviewed.length}条已生成、尚未检查是否透露答案` : ''}${why}。可到执行页点「立即准备」，只补剩余的。`,
                                )
                              : toast('success', `已为${todo.length}条线索准备好标签。`)),
                      view.runtime.clue.scheduleSync(),
                      { done: todo.length - left.length, missing: noLabel, unreviewed, ...(errors.length ? { error: errors[0].message } : {}) }
                  );
              } catch (error) {
                  return (
                      quiet || toast('warning', `线索标签未准备好：${error.message}。大纲已采用，可到执行页重试。`),
                      { done: 0, missing: todo.map((x) => x.code), error: error.message }
                  );
              } finally {
                  ((labelJob = null), (labelProgress = null), view.renderBody && view.renderBody());
              }
          })()),
          labelJob)
        : { done: 0, missing: [] };
}

// 标签请求最多 3 个并行，避免触发模型服务频率限制；某批出错其余照常
const LABEL_CONCURRENCY = 3;
let labelProgress = null;
async function runLabelPool(tasks, onError) {
    let next = 0,
        worker = async () => {
            for (; next < tasks.length; ) {
                let k = next++;
                try {
                    await tasks[k]();
                } catch (error) {
                    onError(error);
                }
            }
        };
    await Promise.all(Array.from({ length: Math.min(LABEL_CONCURRENCY, tasks.length) }, worker));
}

// 待准备标签按项目算（发包前需备齐未玩到的线）；表里已有行的不提示；已生成未审的单独说明
export function labelsPendingHtml(project, c) {
    let have = (c && c.snap.facts) || /* @__PURE__ */ new Map(),
        folded = (c && c.snap.foldBusy) || new Set(),
        todo = labelsToPrepare(project.outline.volumes, project.clue.labels).filter((x) => !have.has(x.code) && !folded.has(x.code)),
        fresh = todo.filter((x) => !x.review).length,
        review = todo.length - fresh,
        // 按线汇总，如「S3、S5：3 条线索的标签未准备」
        lineOf = factLineOf(project.outline.volumes),
        lines = [...new Set(todo.map((x) => lineOf(x.code)).filter(Boolean))],
        who = lines.length ? `${lines.slice(0, 5).join('、')}${lines.length > 5 ? ` 等${lines.length}条线` : ''}：` : '',
        text = `${who}${[fresh && `${fresh}条线索的标签未准备`, review && `${review}条已生成、尚未检查是否透露答案`].filter(Boolean).join('，')}`,
        busy = labelJob ? (labelProgress ? `正在准备${labelProgress.done} / ${labelProgress.total}` : '正在准备…') : '立即准备';
    return todo.length
        ? `<div class="pi-row is-todo pi-labels-todo"><p class="pi-hint is-warn" title="${esc(todo.map((x) => x.code).join('、'))}">${text}。未准备好的线开始后无法补表格行。</p><button type="button" class="pi-btn is-sm" data-act="clue-labels"${labelJob ? ' disabled' : ''}>${busy}</button></div>`
        : '';
}

export function unofferedHtml(c, project) {
    return (c.unoffered || [])
        .map((x) => {
            let labels = project && isPlainObject(project.clue.labels) ? project.clue.labels : {},
                text = (labels[x.id] && labels[x.id].label) || clueText(x.text) || factName(x.id) || '一条线索',
                short = text.length > 40 ? `${text.slice(0, 40)}…` : text;
            return x.revoked
                ? `<p class="pi-hint pi-unoffered">已作废（按未获得处理）：<span title="${esc(`${x.id} ${text}`)}">${esc(short)}</span> <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-fact-restore" data-id="${esc(x.id)}" title="解除作废，恢复按表格判断；不恢复已清除的记录">解除作废</button></p>`
                : `<p class="pi-hint is-warn pi-unoffered">正文可能自行编造：<span title="${esc(`${x.id} ${text}`)}">${esc(short)}</span> <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-fact-keep" data-id="${esc(x.id)}" title="视为已发生，剧情照常推进">保留</button><button type="button" class="pi-btn is-sm is-ghost" data-act="clue-fact-void" data-id="${esc(x.id)}" title="视为未发生，表格改回未获得；以后查到了点「解除作废」">作废</button><span class="pi-unoffered-tip">保留：视为已发生；作废：视为未发生</span></p>`;
        })
        .join('');
}
