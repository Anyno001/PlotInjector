import { catalogKnown, sceneCatalogCell, mainInProgress } from '../core/lines.js';
import { discoveryList, clueText, tableCondChecks, prebuildPlan, prebuildDiff, nodeFactRefs } from './trpg-clue-project.js';
import {
    factLabelCheck,
    parseFactLabelReview,
    factLabelReviewMessages,
    factLabelSig,
    labelsToPrepare,
    factLabelContext,
    factLabelMessages,
    parseFactLabels,
} from '../core/fact-labels.js';

import { options, esc, confirmDialog, openDialog, menuDialog, promptDialog } from '../ui/dom.js';
import { readCell, findSheet, sheetRows, cellText } from './trpg-clue-tables.js';
import { stayState, normalizeClueOps, anchorValid } from './trpg-clue-progress.js';

import { PLOT_MODES, isClueMode, normalizeClue } from './trpg-clue-model.js';

import { stringifyYaml, parseYaml } from '../core/yaml.js';
import { acuApi } from './trpg-clue-runtime.js';
import { isTrpg } from './trpg.js';
import { kpCard } from './trpg-kp-card.js';import { sceneHintHtml } from './trpg-steer.js';
import { trpgWantFacts, trpgRowFilter } from './trpg-rows.js';
import { NODE_STATUS_LABELS, AWAY_PREFIX } from './trpg-clue-rules.js';
import { ICONS } from '../ui/styles.js';
import { stageLabel, isPlainObject } from '../core/outline.js';
import { projectSecretNames } from '../core/store.js';
import { CLUE_SLOT } from '../core/progress.js';

import { estimateTokens } from '../core/tokens.js';
import { PACES } from '../core/inject.js';

import { chatMessages, ctx, toast, cardKey } from '../host/st.js';

import { importSecretNames } from './trpg-long-import.js';

import { ask } from '../ui/ai.js';
import { progressHtml, startProgress, clearProgress } from '../ui/progress.js';

import { clueTplMismatch, synthesizeClueTemplate, clueTplHeader, findGlobalTable } from './trpg-clue-template.js';

export const CLUE_STATUS_BADGE = { locked: '', available: 'is-accent', active: 'is-ok', done: 'is-dark' };

export const FOCUS_SOURCE = {
    manual: '你选的',
    table: '按填表',
    auto: '只有这一件可做',
    stale: '你选的场景已经不能进行',
    manualDone: '你选的场景已完成，只给入口',
    none: '还没确定',
    away: '主角眼下没在任何一段剧情里，只给入口',
};

// inner：放在「运行设置」里时不单独成卡
// 跑团项目：模板的初始行只放眼前要用的线索（core/trpg-rows.js），其余标签照样存进项目，推进时自动补行。普通项目原样全给。
function trpgSeedRows(project, c, factRows, knowRows) {
    if (!isTrpg(project) || !c) return { factRows, knowRows };
    let keep = trpgRowFilter(c.compiled, trpgWantFacts(c.compiled, c.state, c.snap, c.prog, project.clue));
    return { factRows: factRows.filter((f) => keep(f.code)), knowRows: knowRows.filter((k) => keep(k.fact)) };
}

export function modeCard(project, inner = !1) {
    let mode = project.clue ? project.clue.mode : 'outline',
        body = `<div class="pi-seg">${PLOT_MODES.map((item) => `<button type="button" class="pi-seg-btn${item.value === mode ? ' is-sel' : ''}" data-act="clue-mode" data-mode="${item.value}">${esc(item.label)}</button>`).join('')}</div>`;
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
                .join('，') || '还没有绑定',
        path = b.scene && b.scene.路径,
        hasCatalog = !!(tables && path && catalogKnown(tables, path));
    return `<div class="${inner ? 'pi-run-sec' : 'pi-card'}"><${inner ? 'div class="pi-run-sec-hd"' : 'h3'}>表格绑定<span class="pi-meta">${esc(summary)}</span><span class="pi-spacer"></span>
        <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-bind-toggle">${open ? '收起' : '编辑'}</button></${inner ? 'div' : 'h3'}>
        ${
            open
                ? `<textarea class="pi-ta is-mono is-tall" data-clue-bindings>${esc(bindingText(b))}</textarea>
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
        ${open ? `<ul class="pi-clue-why">${reasonList(s.open) + reasonList(s.done)}</ul>` : ''}</div>`;
}

export function stageBlock(unit, stage, nodes, focusUid, st7, { next = !1, expand = !1 } = {}) {
    let live = stage.entered.v === 'true' && !stage.done,
        key = `st:${unit.id}`,
        open = live || expand || !!st7[key],
        state = stage.done ? '已结束' : live ? '进行中' : next ? '下一个' : '',
        left = stage.requiredLeft.length && live ? `还差${stage.requiredLeft.length}个` : '',
        endWhy = live && !stage.requiredLeft.length && stage.end.v !== 'true' ? `结束条件：${stage.end.reasons.join('；')}` : '',
        enterWhy = !live && !stage.done ? stage.entered.reasons.join('；') : '',
        cls = stage.done ? 'done' : live ? 'active' : next ? 'next' : 'todo',
        hand = stage.entered.manual,
        head = `<span class="pi-tl-name">${esc(stageLabel(unit.stage.key))}</span>${left ? `<span class="pi-tl-state is-left">${left}</span>` : ''}${state ? `<span class="pi-tl-state">${state}${hand ? '（手动）' : ''}</span>` : ''}<button type="button" class="pi-icon-btn" data-act="clue-stage-menu" data-id="${esc(unit.id)}" title="手动调整阶段" aria-label="手动调整阶段">${ICONS.more}</button>`;
    return `<div class="pi-tl-item is-${cls}"><span class="pi-tl-dot"></span><div class="pi-tl-box">
        ${live ? `<div class="pi-tl-hd">${head}</div>` : `<div class="pi-tl-hd is-fold" data-act="run-fold" data-key="${esc(key)}" role="button" aria-expanded="${open}">${head}<span class="pi-tl-state">${open ? '▾' : '▸'}</span></div>`}
        ${open ? `${[endWhy, enterWhy].filter(Boolean).map((t) => `<p class="pi-hint">${esc(t)}</p>`).join('')}<div class="pi-tl-nodes">${nodes.map((s) => nodeRow(s, focusUid, st7.nodeOpen === s.node.uid)).join('')}</div>` : ''}</div></div>`;
}

// 线的显示名：编号 + 名称，名称里已带编号的不重复；不用「·」（用户 2026-11-16）
export function lineDisplayName(l) {
    let name = String(l.name || '').replace(/·/g, ' ');
    // 有编号时去掉卷名里的「卷N」（实测 2026-11-17：几次导入都叫卷1）
    l.id && (name = name.replace(/^卷[^\s]*\s+/, ''));
    return l.id && !name.startsWith(l.id) ? `${l.id} ${name}` : name;
}
// 剧情卡上的一句：几条主线、支线在进行
function lineSummary(c) {
    let list = c.state.lineStates || [],
        on = (k) => list.filter((s) => s.line.kind === k && s.state === '进行中').length,
        sides = list.filter((s) => s.line.kind === 'side').length,
        limit = c.plan ? c.plan.slots.limit : 1;
    return `主线${on('main')}条进行中${sides ? `；支线${on('side')} / ${limit}条` : ''}${c.prog.mainPaused ? '；主线已全部暂停' : ''}${c.prog.sidePaused ? '；支线已全部暂停' : ''}`;
}
// 「暂停」菜单：全部 / 只主线 / 只支线（三种暂停的区别保留）
function pauseMenu(c) {
    let list = c.state.lineStates || [],
        mains = list.filter((s) => s.line.kind === 'main').length,
        sides = list.filter((s) => s.line.kind === 'side').length;
    return `<details class="pi-line-more pi-pause-menu"><summary class="pi-btn is-sm">暂停 ▾</summary><div class="pi-line-menu">
        <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-pause" data-value="1" title="去玩日常：所有线索内容都不注入，进度保留">暂停全部剧情</button>
        ${mains ? `<button type="button" class="pi-btn is-sm is-ghost" data-act="clue-pause-mains" data-value="${c.prog.mainPaused ? '' : '1'}" title="${c.prog.mainPaused ? '主线恢复注入；原来进行中的主线接着演' : '所有主线都不推进、不注入；支线照常'}">${c.prog.mainPaused ? '继续主线' : '只暂停主线'}</button>` : ''}
        ${sides ? `<button type="button" class="pi-btn is-sm is-ghost" data-act="clue-pause-side" data-value="${c.prog.sidePaused ? '' : '1'}" title="${c.prog.sidePaused ? '支线恢复注入和提示；原来进行中的支线接着演' : '所有支线都不注入、不提示新的；主线照常，进度和名额都保留'}">${c.prog.sidePaused ? '继续支线' : '只暂停支线'}</button>` : ''}</div></details>`;
}
// 剧情线选项（同时进行的支线、自动开始提示）：放在运行设置里
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
          <label class="pi-check"><input type="checkbox" data-clue-linetoast${project.clue.lineToast !== !1 ? ' checked' : ''}><span>剧情线自动开始时在顶端提示</span></label></div>`;
}
export function renderClueRun(view, project, st7) {
    let { runtime } = view,
        clue = runtime.clue,
        c = clue.compute(),
        d = clue.diagnose();
    if (!c) return modeCard(project);
    FACT_NAMES = buildFactNames(project, c);
    let lines0 = c.state.lineStates || [],
        multi0 = lines0.length > 0,
        problems = [...c.snap.problems, ...c.compiled.errors, ...c.state.cycles.map((u) => `节点${u}条件循环引用`)],
        focus = c.state.focus,
        focusNode = c.state.nodeStates.find((s) => s.node.uid === focus.uid),
        entries = runtime.entries(),
        clueEntry = entries.find((e) => e.slotId === CLUE_SLOT),
        enabled = c.snap.enabled === !1 ? '<span class="pi-badge is-warn">主线关闭</span>' : '',
        paused = c.prog.paused ? '<span class="pi-badge is-warn">已暂停</span>' : '',
        mainLine = multi0 ? lines0.find((x) => x.line.kind === 'main' && x.state === '进行中') || lines0.find((x) => x.line.kind === 'main') : null,
        shownUnits = (mainLine && c.compiled.units.filter((u) => u.line && u.line.id === mainLine.line.id)) || [],
        tlUnits = shownUnits.length ? shownUnits : c.compiled.units,
        anyLive = tlUnits.some((u) => {
            let st = c.state.stageStates.get(u.id);
            return st.entered.v === 'true' && !st.done;
        }),
        nextDone = !1,
        groups = [];
    for (let unit of tlUnits) {
        let stage = c.state.stageStates.get(unit.id),
            live = stage.entered.v === 'true' && !stage.done,
            next = !live && !stage.done && !nextDone && (nextDone = !0);
        groups.push(stageBlock(unit, stage, c.state.nodeStates.filter((s) => s.node.unit === unit), focus.uid, st7, { next, expand: !anyLive }));
    }
    let last = clue.lastInjected();
    let b0 = project.clue.bindings,
        unbound = !(b0.facts.length || b0.knowledge.length),
        setOpen = st7.setOpen !== void 0 ? st7.setOpen : unbound || !c.snap.api,
        mode0 = (PLOT_MODES.find((m) => m.value === project.clue.mode) || PLOT_MODES[0]).label,
        opN = clueOpCount(runtime),
        setSummary = [mode0, unbound ? '表格未绑定' : '表格已绑定', `推进速度${(PACES.find((x) => x.value === runtime.progress().pace) || PACES[1]).label}`, ...(opN ? [`记录${opN}条`] : [])].join('，'),
        advOpen = !!st7.advOpen,
        settings = `<div class="pi-card pi-run-set"><h3><button type="button" class="pi-run-fold" data-act="run-set-toggle" aria-expanded="${setOpen}">${setOpen ? '▾' : '▸'}设置与记录</button>${setOpen ? '' : `<span class="pi-meta">${esc(setSummary)}</span>`}</h3>
        ${
            setOpen
                ? `<div class="pi-rl-sec"><div class="pi-run-sec-hd">线索表格</div><div class="pi-tools is-c3"><button type="button" class="pi-btn is-sm" data-act="clue-prebuild" title="按模组补表格行：表已经建好、模组后来又加了线索时用，把缺的行补进关键事实表、知情表；已有的行不动">补全表格…</button><button type="button" class="pi-btn is-sm" data-act="clue-labels-edit" title="修改线索标签：修改关键事实表里已有线索的标签和登记口径">修改线索…</button><button type="button" class="pi-btn is-sm" data-act="clue-gen-template" title="生成线索模板：在当前聊天的表格上加入三张线索表（带上模组要用的行），并调整默认表的规则；先预览，确认后才写入">创建模板</button></div></div>
        <div class="pi-rl-sec"><div class="pi-run-sec-hd">推进</div><div class="pi-pace"><span class="pi-pace-label">推进速度</span><div class="pi-seg">${PACES.map((pace) => `<button type="button" class="pi-seg-btn${pace.value === runtime.progress().pace ? ' is-sel' : ''}" data-act="pace" data-pace="${pace.value}">${pace.label}</button>`).join('')}</div></div>${lineOpts(c, project)}</div>
        <div class="pi-rl-sec"><button type="button" class="pi-run-fold" data-act="run-fold" data-key="advOpen" aria-expanded="${advOpen}">${advOpen ? '▾' : '▸'}高级</button>${advOpen ? `${modeCard(project, !0)}${bindingCard(project, st7, c.snap.api ? c.snap.tables : null, !0)}` : ''}</div>
        ${clueLogCard(runtime, st7)}`
                : ''
        }</div>`;
    // 需要处理（第四批）：数据库没连上只在这里完整说一次（写明进度不受影响）；线索标签没准备好也合进来，带「现在准备」
    let labelRow = (c.state.lineStates || []).length ? labelsPendingHtml(project, c) : '',
        noDb = !c.snap.api,
        // 换到新聊天时线索表还没建：缺表的几行合成一行，直接带「创建模板」（用户 11-22：按钮藏在运行设置里太深）
        lack = noDb ? [] : problems.filter((p) => /^缺少表「/.test(p)),
        lackRow = lack.length
            ? `<div class="pi-row is-todo"><p class="pi-hint is-warn">当前聊天还没有线索表（${esc(lack.map((p) => p.replace(/^缺少表/, '')).join('、'))}）。</p><button type="button" class="pi-btn is-sm is-primary" data-act="clue-gen-template">创建模板</button></div>`
            : '',
        // 补行 / 表结构出问题时旁边带「重新创建模板」（用户 2026-11-23：出了问题要重建模板，原来藏在设置与记录→高级里）
        rowBtn = (text, act, label, tip = '', remake = !1) => `<div class="pi-row is-todo"><p class="pi-hint is-warn"${tip ? ` title="${esc(tip)}"` : ''}>${esc(text)}</p><button type="button" class="pi-btn is-sm" data-act="${act}">${label}</button>${remake ? '<button type="button" class="pi-btn is-sm is-ghost" data-act="clue-gen-template" title="表格出了问题时用：按模组重新生成线索模板写入当前聊天，先预览，确认后才写入">重新创建模板</button>' : ''}</div>`,
        gapHit = !1,
        // 每行问题带上能解决它的按钮：缺行 → 补全表格；表结构不对 → 打开表格绑定；其余只说明
        problemRows = problems.filter((p) => !lack.includes(p)).map((p) => {
            let gap = /^事实表里没有这些编号的行：(.+?)（/.exec(p);
            if (gap) return ((gapHit = !0), rowBtn(`关键事实表里还没有这些线索的行：${factNamesText(gap[1].split('、').filter(Boolean))}。`, 'clue-prebuild', '补全表格', gap[1], !0));
            if (/^表「.*缺少.*列|已核实值|方式列/.test(p)) return rowBtn(p, 'run-set-open', '打开表格绑定', '', !0);
            return `<p class="pi-hint is-warn">${esc(noDb && p === c.snap.problems[0] ? '没有检测到数据库插件（shujuku），当前无法注入。剧情线的进度不受影响，装好并开启数据库插件后接着用。' : p)}</p>`;
        }),
        // 表和标签都准备好了、大纲里仍有线索没有行：单独一行（已有「事实表里没有…」那一行时不重复）
        newRow = '';
    if (!noDb && !lack.length && !gapHit && c.snap.facts instanceof Map) {
        let notReady = new Set(labelsToPrepare(project.outline.volumes, project.clue.labels).filter((x) => !c.snap.facts.has(x.code)).map((x) => x.code)),
            miss = prebuildPlan(project.outline.volumes).facts.filter((f) => !c.snap.facts.has(f.code) && !notReady.has(f.code));
        miss.length && (newRow = rowBtn(`模组里有${miss.length}条线索在表格里还没有行。`, 'clue-prebuild', '补全表格', '', !0));
    }
    let todo = [...(lackRow ? [lackRow] : []), ...problemRows, ...(newRow ? [newRow] : []), ...(labelRow ? [labelRow] : [])];
    let multi = (c.state.lineStates || []).length > 0,
        units = c.compiled.units,
        allDone = units.length > 0 && units.every((u) => (c.state.stageStates.get(u.id) || {}).done),
        ellip = `<button type="button" class="pi-icon-btn" data-act="run-cur-menu" title="更多" aria-label="更多">${ICONS.more}</button>`,
        statusRow = `<div class="pi-row pi-rl-status"><b>${multi ? '剧情' : '主线'}</b>${enabled}${
            c.prog.paused ? '<span class="pi-badge is-warn">已暂停</span>' : allDone && !multi ? '<span class="pi-badge is-ok">已全部完成</span>' : '<span class="pi-badge is-accent">进行中</span>'
        }<span class="pi-meta pi-grow">${multi && !c.prog.paused ? esc(lineSummary(c)) : ''}</span>${
            c.prog.paused
                ? '<button type="button" class="pi-btn is-sm is-primary" data-act="clue-pause" data-value="">继续剧情</button>'
                : allDone && !multi
                  ? '<button type="button" class="pi-btn is-sm is-primary" data-act="clue-next">开始下一段主线…</button>'
                  : multi
                    ? pauseMenu(c)
                    : '<button type="button" class="pi-btn is-sm" data-act="clue-pause" data-value="1" title="去玩日常：所有线索内容都不注入，进度保留">暂停</button>'
        }${ellip}</div>`,
        focusLabel = [hereText(c), focusNode ? esc(focusNode.node.name) : ''].filter(Boolean).join(' · ') || esc(FOCUS_SOURCE[focus.source]),
        hint = isTrpg(project) ? sceneHintHtml(c) : '',
        focusRow = hint
            ? `<div class="pi-rl-focus is-col">${hint}</div>`
            : `<div class="pi-rl-focus"><b class="pi-grow">${focusLabel}</b>${focusNode ? `<button type="button" class="pi-btn is-sm" data-act="clue-leave" data-uid="${esc(focusNode.node.uid)}" title="主角已经离开这件事：不再注入它的场景和发现，只给入口">已离开</button>` : ''}${c.prog.focus ? `<button type="button" class="pi-btn is-sm" data-act="clue-unfocus" title="回到按填表判断本轮场景">${c.prog.focus.startsWith(AWAY_PREFIX) ? '其实没离开' : '换场景'}</button>` : ''}</div>`,
        cur = `<div class="pi-card pi-rl-cur"><h3>当前</h3>
        ${progressHtml('prebuild')}${todo.length ? `<div class="pi-rl-stack">${todo.join('')}</div>` : ''}
        ${statusRow}${focusRow}
        ${stayNotice(view, c)}
        ${unofferedHtml(c, project)}
        ${(c.hints || []).map((h) => `<p class="pi-hint is-warn">两表核对：${esc(h)}</p>`).join('')}
        ${!c.prog.paused && d.plot && d.plot.items.length ? `<p class="pi-hint is-warn">数据库剧情推进预设「${esc(d.plot.preset)}」里启用了召回以外的任务：${esc(d.plot.items.map((x) => `「${x.task}」（输出${x.tags.join('、')}）`).join('、'))}。它们会替角色安排行动，可能和线索剧情抢方向。建议在数据库里先关掉，只留召回（插件不会替你改）。</p>` : ''}
        <p class="pi-meta pi-rl-foot">${clueEntry && clueEntry.content ? `本轮注入约${estimateTokens(clueEntry.content)} token` : `本轮注入内容为空${clueEntry && clueEntry.reason && c.snap.api ? `（${esc(clueEntry.reason)}）` : ''}`}${last ? ` · 上次注入${new Date(last.at).toLocaleTimeString('zh-CN', { hour12: !1 })}，${last.chars}字` : ''}${d.lastTableUpdate ? ` · 表格${new Date(d.lastTableUpdate).toLocaleTimeString('zh-CN', { hour12: !1 })}更新` : ''}</p></div>`,
        prog = `<div class="pi-card"><h3>进度<span class="pi-spacer"></span><button type="button" class="pi-icon-btn" data-act="run-prog-menu" title="更多" aria-label="更多">${ICONS.more}</button></h3>
        ${lineCard(c, project)}
        ${groups.length ? `<div class="pi-tl">${groups.join('')}</div>` : '<p class="pi-hint">模组为空。</p>'}</div>`;
    return `${cur}${isTrpg(project) ? kpCard(view, project, c, d) : ''}${prog}${settings}`;
}

// 操作记录条数（设置与记录里的一行）
function clueOpCount(runtime) {
    return normalizeClueOps(runtime.progress().clue).ops.length;
}

export function clueLogCard(runtime, st7) {
    let prog = runtime.progress(),
        allOps = normalizeClueOps(prog.clue).ops,
        ops = allOps.slice(-12).reverse(),
        open = !!st7.logOpen,
        chat = chatMessages();
    return ops.length
        ? `<div class="pi-rl-sec"><button type="button" class="pi-run-fold" data-act="run-fold" data-key="logOpen" aria-expanded="${open}">${open ? '▾' : '▸'}操作记录（${allOps.length}）</button>${open ? ops.map((op) => `<p class="pi-hint${anchorValid(op.at, chat) ? '' : ' is-off'}">${new Date(op.time).toLocaleString('zh-CN', { hour12: !1 })}　${esc(runtime.clue.opLabel(op))}${anchorValid(op.at, chat) ? '' : '（所在楼层已回退，未生效）'}</p>`).join('') : ''}</div>`
        : '';
}

// stored：项目里存着的标签（导入项目文件带来的、以前生成过的）。大纲里这条线索的内容没变（签名对得上）就直接填好，不用再生成。
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
          <div class="pi-fr-hd"><b>${esc(where || f.code)}</b><span class="pi-meta">${esc(f.code)}</span>${f.orphan || c.orphan ? '<span class="pi-badge is-warn">模组里没有节点产出它</span>' : ''}<span class="pi-badge pi-fr-st${have && have.label ? ' is-ok' : ''}" data-fr-st="${i}">${have && have.label ? '已填' : '待填'}</span></div>
          ${c.answer ? `<p class="pi-fr-answer">这条线索查到的是：${esc(c.answer)}<span class="pi-meta">（只给你看，不会写进表格）</span></p>` : ''}
          <label class="pi-field"><span>标签：给它起个不透露答案的名字</span><input class="pi-inp" data-${prefix}-label="${i}" value="${esc(have ? have.label : '')}"></label>
          <label class="pi-field"><span>正文写到哪一步，才算主角拿到了它</span><textarea class="pi-ta" rows="2" data-${prefix}-crit="${i}">${esc(have ? have.criterion : '')}</textarea></label>
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
          <div class="pi-fr-start"${intro ? '' : ' hidden'}><button type="button" class="pi-btn is-primary is-lg${filledN >= n ? ' is-done' : ''}" data-fr-auto>${startFace(filledN >= n ? '' : filledN ? `开始自动填写 · 还有${n - filledN}条` : `开始自动填写 · 共${n}条`)}</button>
          ${(clearProgress(`fr-${prefix}`), progressHtml(`fr-${prefix}`))}</div>
          <p class="pi-hint" data-fr-status>${intro ? (filledN >= n ? '已经按以前填过的内容填好了。想重新生成某条，先清空它的框再点上面的按钮。' : 'AI按模组写好标签和判定说明，你只需要检查标黄的地方。也可以自己填。') : '标黄的地方是插件检查出的问题，照着改框里的字就行。'}</p>
          <details class="pi-fr-intro"${intro ? '' : ' hidden'}><summary>这一步在做什么</summary>
          <p>每轮正文写完后，数据库的填表模型会对照这里的说明，判断主角有没有拿到某条线索；拿到了，后面的剧情才会开放。</p>
          <p>所以每条线索要两样东西：一个<b>标签</b>，让填表模型认出是哪一条；一句<b>「写到哪一步才算拿到」</b>。这句写得太宽，主角还没真正查到就会被算作拿到，剧情会提前推进。</p>
          <p>这两样每一轮都会发给填表模型，所以<b>不能写出答案</b>：写「打开抽屉、读到单据时」，不写单据上写了什么。</p>
          <p class="is-example">例　标签：抽屉里的单据　｜　写到哪一步：主角打开抽屉、读到单据内容时算拿到；只看到锁着的抽屉不算</p></details>
          ${facts.map(row).join('')}</div>`;
}

// 大按钮的字：空串 = 都填好了
const startFace = (text) => (text ? `${ICONS.spark}<span>${text}</span>` : `${ICONS.check}<span>已全部填好</span>`);

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
            // 导入任务里的人物索引 + 项目自己存的保密名单（导入的项目文件没有导入任务，只有后者）
            ((secrets = [...new Set([...jobs.filter(Boolean).flatMap((j) => importSecretNames(j.index) || []), ...(projectSecretNames(project) || [])])]),
                (secretsNote = missing ? `有${missing}份导入记录读不到，这次没有核对其中的保密名字。` : ''),
                secretsNote && (status.textContent = `${status.textContent} ${secretsNote}`),
                facts.forEach((_, i) => (field(i, 'label').value.trim() || field(i, 'crit').value.trim()) && check(i)));
        }),
        reviewed = /* @__PURE__ */ new Map(),
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
            startBtn && !running && (startBtn.classList.remove('is-busy'), startBtn.classList.toggle('is-done', !left), (startBtn.innerHTML = startFace(left ? `开始自动填写 · 还有${left}条` : '')));
        };
    sync();
    box.addEventListener('input', (event) => {
        let m = event.target.closest('[data-fr-row]');
        m && (unsure.delete(facts[Number(m.dataset.frRow)].code), check(Number(m.dataset.frRow)));
    });
    async function reviewRows(rows) {
        let todo = rows.filter(({ i }) => field(i, 'label').value.trim() || field(i, 'crit').value.trim());
        if (!todo.length) return 0;
        let items = todo.map(({ f, i }) => {
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
            }),
            map = parseFactLabelReview(
                await ask(view, 'outline', factLabelReviewMessages(items)),
                items.map((x) => x.code),
            ),
            fixed = 0;
        for (let [k, { f, i }] of todo.entries()) {
            let v = map.get(f.code),
                sent = items[k];
            !v ||
                v.leak === null ||
                field(i, 'label').value.trim() !== sent.label ||
                field(i, 'crit').value.trim() !== sent.criterion ||
                (v.leak && (v.label || v.criterion)
                    ? (v.label && (field(i, 'label').value = v.label),
                      v.criterion && (field(i, 'crit').value = v.criterion),
                      fixed++,
                      reviewed.set(f.code, {
                          label: field(i, 'label').value.trim(),
                          criterion: field(i, 'crit').value.trim(),
                          leak: !1,
                          fixed: !0,
                          what: v.what,
                      }))
                    : reviewed.set(f.code, { label: sent.label, criterion: sent.criterion, leak: v.leak, what: v.what }));
        }
        return fixed;
    }
    box.querySelector('[data-fr-auto]').addEventListener('click', async (event) => {
        let btn = event.currentTarget,
            todo = facts.map((f, i) => ({ f, i })).filter(({ i }) => !field(i, 'label').value.trim() || !field(i, 'crit').value.trim());
        if (!todo.length) return (status.textContent = '都已经填好了。要重新生成，先清空对应的框。');
        let prog = startProgress(`fr-${prefix}`).step(`第1步：AI写标签（共${todo.length}条）`, 70, 20000 + todo.length * 4000);
        ((running = !0), (btn.disabled = !0), btn.classList.add('is-busy'), (btn.innerHTML = '<span class="pi-spin"></span><span>正在自动填写</span>'), (status.textContent = '生成期间可以先往下翻着看，写好后会一起填进框里。'), sync());
        for (let { i } of todo) {
            let b = box.querySelector(`[data-fr-st="${i}"]`);
            b && ((b.className = 'pi-badge pi-fr-st is-accent'), (b.textContent = '生成中'));
        }
        try {
            await secretsReady;
            let items = todo.map(({ f }) => ctx.get(f.code) || { code: f.code, usedBy: [], orphan: !0 }),
                // 流式时按回复里已经出现的编号算条数（只有独立接口流式；酒馆接口按用时估）
                reply = await ask(view, 'outline', factLabelMessages(items, { secrets }), {
                    onText: (t) => {
                        let got = items.filter((x) => t.includes(x.code)).length;
                        prog.real((got / items.length) * 70, `已写${got}/${items.length}条`);
                    },
                }),
                r = parseFactLabels(
                    reply,
                    items.map((x) => x.code),
                );
            for (let { f, i } of todo) {
                let got = r.items.get(f.code);
                got &&
                    (field(i, 'label').value.trim() || (field(i, 'label').value = got.label),
                    field(i, 'crit').value.trim() || (field(i, 'crit').value = got.criterion),
                    got.unsure && unsure.set(f.code, got.unsure));
            }
            todo.forEach(({ i }) => check(i));
            prog.step('第2步：检查有没有透露答案', 97, 25000);
            let fixed = 0,
                reviewFailed = '';
            try {
                fixed = await reviewRows(todo);
            } catch (error) {
                reviewFailed = `检查没完成（${error.message}），下面按字面比对标出了可能透露答案的地方。`;
            }
            let warned = facts.reduce((n, _, i) => n + (check(i) ? 1 : 0), 0),
                got2 = todo.filter(({ i }) => field(i, 'label').value.trim()).length;
            prog.done(`完成：已填好${got2}/${todo.length}条${warned ? `，${warned}条标黄` : ''}`);
            keep &&
                got2 &&
                keepLabels(
                    view,
                    facts.map((f, i) => ({ code: f.code, label: field(i, 'label').value.trim(), criterion: field(i, 'crit').value.trim() })),
                );
            status.textContent = `${secretsNote}${reviewFailed}已填好${todo.length - r.missing.length}条${r.missing.length ? `，${r.missing.length}条没生成（${r.missing.join('、')}），可以再点一次或自己填` : ''}。${fixed ? `${fixed}条原来的写法会透露答案，已经自动改好。` : ''}${warned ? `${warned}条标黄：黄字说明了原因，照着改一下框里的字就行，改完黄色会消失。觉得没问题也可以不改，标黄不会挡住导入。` : '没有发现问题，可以直接确认。'}`;
        } catch (error) {
            (prog.fail(), (status.textContent = `生成失败：${error.message}。可以再试一次，或者自己填。`));
        } finally {
            ((running = !1), (btn.disabled = !1), facts.forEach((_, i) => rowState(i, box.querySelector(`[data-fr-row="${i}"]`).classList.contains('is-warn'))), sync());
        }
    });
}

export function prebuildScope(view) {
    let c = ctx(),
        chatId = c && typeof c.getCurrentChatId == 'function' ? String(c.getCurrentChatId() ?? '') : '';
    return {
        chatId,
        chatLabel: chatId,
        projectId: view.projectId,
        active: view.runtime.activeId(),
        mode: isClueMode(view.project()) ? 'clue' : 'outline',
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
    return now.chatId === s.chatId && now.projectId === s.projectId && now.active === s.active && now.mode === s.mode;
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
                    body: '线索推进按主角实际查到了什么来推进：数据库填表时记下拿到的线索，插件据此开放下一步。不再用AI判断「这一阶段演完了没有」，也不再一次把整个阶段交给正文。',
                    list: [
                        '模组推进的进度会保留，切回来就恢复。',
                        '模组要写「发现」和「完成条件」，节点才会自动完成；没写的只能在执行页手动标记。',
                        '切换后，点下面「表格绑定」里的「创建模板」，给这个聊天加上记录线索的表格。',
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
    'run-set-open'(view) {
        let st7 = view.tabState('run');
        ((st7.setOpen = !0), (st7.advOpen = !0), view.renderBody());
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
    // 重新读表：也安排一次同步（写场景目录、补缺的行），作为「还在准备」的手动重试（GPT 实测前审阅 R5）。
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
                            ? '这条线不再注入、不再提示。想回来，点这条线上的「还原」。'
                            : '不再等表格判断，直接算这条线完成。想回来，点这条线上的「还原」。',
                    okLabel: v === 'abandon' ? '放弃' : '标记完成',
                    danger: v === 'abandon',
                }))
            )
                return;
        }
        // 主线一次只能有一条在进行：进入 / 继续另一条主线时，先说清楚正在进行的那条会被暂停（一次操作，取消就两条都不变）
        if (v === 'enter' || v === 'resume') {
            let c0 = view.runtime.clue.compute(),
                me = c0 && c0.state.lineStates.find((x) => x.line.id === target.dataset.id),
                other = me && me.line.kind === 'main' ? mainInProgress(c0.state.lineStates, me.line.id) : null;
            if (
                other &&
                !(await confirmDialog({
                    title: `换成「${me.line.name}」？`,
                    body: `主线一次只进行一条。「${other.line.name}」会先暂停，进度都保留，之后点它的「继续」就能回来。`,
                    okLabel: '换过去',
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
                ((uid = await menuDialog({ title: '走进的是哪一件事', items: s.entries.map((u) => ({ value: u, label: name(u) })) })), !uid)
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
            title: `「${name}」改成手动开始`,
            body: '不再自动判断开启条件，原来的要求留着给你看。之后想玩这条线时，在这里点「进入」。改的是模组，所有聊天都一样。',
            okLabel: '改成手动开始',
        })) &&
            (view.runtime.clue.lineToManual(id)
                ? toast('success', `「${name}」已改成手动开始。`)
                : toast('info', '这条线已经是人工开启了。'),
            view.renderBody());
    },
    'clue-tiers'(view, target) {
        let tiers = JSON.parse(target.dataset.tiers || '[]');
        (view.runtime.clue.confirmTiers(tiers)
            ? toast('success', `档位顺序已确认：${tiers.join(' < ')}`)
            : toast('info', '没有要确认的条件。'),
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
    'clue-line-move'(view, target) {
        (view.runtime.clue.moveLine(target.dataset.id, Number(target.dataset.dir)), view.renderBody());
    },
    // 开始下一段主线：去大纲页写新一卷；写好后回到这里补预建行、更新场景编号对照。
    async 'clue-next'(view) {
        (await confirmDialog({
            title: '开始下一段主线',
            body: '下一段主线写成一条新的剧情线，放在现有模组后面。前面的主线结束后，它的第一阶段会自动开始。',
            list: [
                '1. 到模组页用「AI写新剧情线」或自己写一条（会附上已用过的编号，避免撞号）',
                '2. 回到执行页，在「表格绑定」里点「按模组补表格行…」，给新事实建行',
                '3. 旧聊天先点一次「创建模板」，让新剧情线的场景能被认出来',
                '写新剧情线期间想先玩日常，可以先暂停剧情',
            ],
            okLabel: '去写新剧情线',
        })) &&
            view.switchTab &&
            view.switchTab('outline');
    },
    'clue-unfocus'(view) {
        (view.runtime.clue.setFocus(''), view.renderBody());
    },
    // 改线索标签（用户 2026-11-17）：导入后发现口径写宽了，在这里改。读关键事实表里现在的标签和口径，改完写回表格。
    // 写表（GPT 第六轮 R1 / R2）：
    // · 作用域连同数据隔离一起核对（clue.opScope），弹窗期间或写入途中换了聊天、项目、推进方式、隔离就停；
    // · 一条线索的标签和口径用官方 updateRow 一次写入；每条写之前按编号重新找行号，写完按编号回读核对；
    // · 只有回读对上的条目才存进项目（下次新聊天建表、导出项目用它）；没写进去的保留输入，下次打开直接带出来重试。
    async 'clue-labels-edit'(view) {
        let c = view.runtime.clue.compute(),
            project = view.project(),
            api = acuApi(),
            fb = project && (project.clue.bindings.facts || [])[0];
        if (!c || !c.snap.api || !api || (typeof api.updateRow != 'function' && typeof api.updateCell != 'function'))
            return toast('warning', '没有检测到数据库插件，改不了表格里的标签。');
        if (!fb) return toast('warning', '还没有绑定事实表。');
        let found = findSheet(c.snap.tables || {}, fb.表);
        if (found.error) return toast('warning', `当前聊天没有「${fb.表}」。`);
        let { col, rows } = sheetRows(found.sheet),
            ci = { code: col(fb.编号列), label: col('标签'), crit: col('登记口径') },
            // 新聊天还没填过表：表格里只有模板带的初始行（seedRows），没有真正的行可写。这时只存进项目，
            // 等数据库第一次填表、初始行变成真正的行以后再写表格（用户 2026-11-17 实测：6 条全报「没写进表格」）
            seedOnly = !found.sheet.content.slice(1).some(Array.isArray) && rows.length > 0;
        if (ci.code < 0 || ci.label < 0 || ci.crit < 0) return toast('warning', `「${fb.表}」缺少编号、标签或登记口径列，改不了。`);
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
                    // 项目里存的版本和这个聊天的表格不一样（没填过表时先存进了项目、刷新后草稿没了；或这个聊天的表是旧版）：带出项目的版本
                    let stored = storedLabel(project.clue.labels, f.code, labelCtx.get(f.code)),
                        fromProject = !drafts[f.code] && stored && (stored.label !== f.table.label || stored.criterion !== f.table.criterion) ? { label: stored.label, criterion: stored.criterion } : null,
                        pend = drafts[f.code] || fromProject;
                    return { ...f, now: pend || f.table, retry: !!drafts[f.code], newer: !!fromProject, draft: pend || null };
                });
        if (!facts.length) return toast('info', '表格里还没有这个项目的线索行。先用「创建模板」或「补全表格」建好。');
        let retry = facts.filter((f) => f.retry).length,
            newer = facts.filter((f) => f.newer).length,
            picked = await openDialog({
                title: '修改线索标签',
                html: `<p class="pi-hint">改的是当前聊天「${esc(fb.表)}」里的标签和登记口径。改宽了，主角还没查到就可能被算作拿到。</p>${seedOnly ? '<p class="pi-hint is-warn">这个聊天还没填过表，表格里现在是模板的初始行。改动先存进项目；聊一轮、数据库第一次填表后，再打开这里点保存，写进表格。</p>' : ''}${retry ? `<p class="pi-hint is-warn">上次有${retry}条没写进表格，下面是你当时填的内容，点保存再试一次。</p>` : ''}${newer && !seedOnly ? `<p class="pi-hint is-warn">有${newer}条和项目里存的不一样，下面填的是项目里的版本，点保存写进这个聊天的表格。</p>` : ''}${factRowsHtml(facts, 'le', project.outline.volumes, {}, { intro: !1 })}`,
                onMount: (root) => mountFactRows(view, root, facts, 'le', project.outline.volumes),
                actions: [
                    { label: '取消', value: null },
                    {
                        label: '保存',
                        primary: !0,
                        value: (root) =>
                            facts.map((f, i) => ({
                                code: f.code,
                                label: root.querySelector(`[data-le-label="${i}"]`).value.trim(),
                                criterion: root.querySelector(`[data-le-crit="${i}"]`).value.trim(),
                                table: f.table,
                                draft: f.draft,
                            })),
                    },
                ],
            });
        if (!picked) return;
        let empty = picked.filter((f) => !f.label);
        if (empty.length) return toast('warning', `标签不能为空：${empty.map((f) => f.code).join('、')}`);
        let live = () => prebuildScopeValid(view, scope) && view.runtime.clue.opScope().iso === s0.iso,
            pid = project.id,
            // 和表格现值比：上次没写进去的条目，表格还是旧值，会算作改动
            changed = picked.filter((f) => f.label !== f.table.label || f.criterion !== f.table.criterion),
            // 上次的结果没核实（写表途中切走了），回来一看表格已经是草稿的值：表格不用再写，只补存进项目（GPT 第六轮复核 F3）
            synced = picked.filter((f) => !changed.includes(f) && f.draft && f.draft.label === f.label && f.draft.criterion === f.criterion);
        if (!live()) return toast('warning', '确认期间切换了聊天、项目、推进方式或数据隔离，没有写入。请回到原聊天重新操作。');
        if (seedOnly && changed.length) {
            // 不碰表格（官方 updateRow 会按行号补出空行，把初始行盖掉）；存进项目，输入留作这个聊天的草稿，填表后带出来写表
            keepLabels(view, changed, pid);
            labelDrafts.set(dkey, { ...(labelDrafts.get(dkey) || {}), ...Object.fromEntries(changed.map((f) => [f.code, { label: f.label, criterion: f.criterion }])) });
            view.renderBody();
            return toast('info', `已存进项目${changed.length}条。这个聊天还没填过表，表格要等第一次填表后再写：到时打开「修改线索」点保存。`);
        }
        synced.length && keepLabels(view, synced, pid);
        // 没改动的条目：表格已经是这个值，残留的草稿清掉
        dropLabelDrafts(dkey, picked.filter((f) => !changed.includes(f)).map((f) => f.code));
        if (!changed.length) return toast(synced.length ? 'success' : 'info', synced.length ? `表格里已经是新的值，已同步${synced.length}条到项目。` : '没有改动。');
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
                // 写了但没法核实（切走了）：留作草稿，回原聊天时会核对表格，必要时只补同步
                stopped = !0;
                unsure.push(f);
                break;
            }
            let back = readBack(f.code);
            back && back.label === f.label && back.criterion === f.criterion ? done.push(f) : failed.push(f);
        }
        // 只有写进表格、回读对上的，才存进开始时的那个项目；其余留作这个聊天、隔离、表的草稿，下次打开带出来
        let saved = done.length ? keepLabels(view, done, pid) : !0;
        dropLabelDrafts(dkey, done.map((f) => f.code));
        let notWritten = [...failed, ...changed.filter((f) => !done.includes(f) && !failed.includes(f) && !unsure.includes(f))],
            left = [...notWritten, ...unsure];
        left.length && labelDrafts.set(dkey, { ...(labelDrafts.get(dkey) || {}), ...Object.fromEntries(left.map((f) => [f.code, { label: f.label, criterion: f.criterion }])) });
        (view.runtime.clue.invalidate(), view.renderBody());
        let parts = [
            `已改${done.length}条`,
            notWritten.length ? `${notWritten.length}条没写进表格：${notWritten.map((f) => f.code).join('、')}` : '',
            unsure.length ? `${unsure.map((f) => f.code).join('、')}写入途中切换了聊天、项目或数据隔离，结果待核实` : '',
            saved ? '' : '原项目已经不在了，没有存进项目',
        ].filter(Boolean);
        !left.length && saved
            ? toast('success', `已改${done.length}条线索的标签和口径。`)
            : toast(
                  stopped || !saved ? 'warning' : 'error',
                  `${parts.join('；')}。${left.length ? '你填的内容已保留，回到原聊天再打开「修改线索」，点保存重试。' : ''}`,
              );
    },
    // 按大纲补表格行：预览 → 作者逐条确认标签和登记口径 → 通过官方 insertRow 只插入缺的行（已有行不动，不覆盖已演进度）。
    // W1：点击时记下聊天 / 项目 / 模式，确认后按当前表重新算缺哪些行，每插入一行前核对一次，变了就停下并说明已写入哪些。
    // 登记口径不直接拿「记录」预填（GPT §14.2-3，记录常含答案）：作者自己写，或点「自动填写」由模型参考记录写出不含答案的版本，插件再检查。
    async 'clue-prebuild'(view) {
        let c = view.runtime.clue.compute(),
            project = view.project(),
            api = acuApi();
        if (!c || !c.snap.api || !api || typeof api.insertRow != 'function')
            return toast('warning', '没有检测到数据库插件，无法补表格行。');
        let scope = prebuildScope(view),
            plan = prebuildPlan(project.outline.volumes),
            diff = prebuildDiff(plan, c.snap, project.clue.bindings),
            targetPrint = prebuildTargetPrint(c.snap.tables, project.clue.bindings);
        if (!diff.factTable) return toast('warning', '还没有绑定事实表。');
        let colErr = prebuildColumnProblems(c.snap.tables, project.clue.bindings, diff);
        if (colErr.length) return toast('error', `表格结构和配套模板不一致，没有写入：${colErr.join('；')}`);
        if (!diff.newFacts.length && !diff.newKnows.length)
            return toast(
                'info',
                `表格行已经齐全（已有${diff.kept.length}个事实）。${diff.stale.length ? `表里有模组已不再使用的编号：${diff.stale.join('、')}，不会自动删除。` : ''}`,
            );
        let html = `<div class="pi-fr-intro"><p>模组里新增了线索，但<b>当前聊天</b>的线索表里还没有它们。这一步把缺的补上，已有的行一律不动，不影响已经玩到的进度。</p></div>
          ${diff.stale.length ? `<p class="pi-hint is-warn">表里有模组已不再使用的编号：${esc(diff.stale.join('、'))}（不会删除）</p>` : ''}
          <details class="pi-fr-more"><summary class="pi-hint">写入细节</summary>
          <p class="pi-hint">目标聊天：${esc(scope.chatLabel || '当前聊天')}</p>
          ${diff.newKnows.length && diff.knowTable ? `<p class="pi-hint">「${esc(diff.knowTable)}」新增${diff.newKnows.length}行：${esc(diff.newKnows.map((k) => k.key).join('、'))}</p>` : ''}
          ${diff.kept.length ? `<p class="pi-hint">已有、不改动：${esc(diff.kept.join('、'))}</p>` : ''}
          <p class="pi-hint">确认时会再核对一次，表格在这期间变了就不写入。补完以后如果对线索表重新「手动填表」，补的行可能被清掉，请检查一次。</p></details>
          ${diff.newFacts.length ? `<h4 class="pi-fr-title">要补的线索：${diff.newFacts.length}条</h4>${factRowsHtml(diff.newFacts, 'pb', project.outline.volumes, project.clue.labels)}` : ''}`,
            picked = await openDialog({
                title: '按模组补表格行',
                html,
                onMount: (root) => mountFactRows(view, root, diff.newFacts, 'pb', project.outline.volumes, { gate: '写入当前聊天', keep: !0 }),
                actions: [
                    { label: '取消', value: null },
                    {
                        label: '写入当前聊天',
                        primary: !0,
                        value: (root) =>
                            diff.newFacts.map((f, i) => ({
                                ...f,
                                label: root.querySelector(`[data-pb-label="${i}"]`).value.trim(),
                                criterion: root.querySelector(`[data-pb-crit="${i}"]`).value.trim(),
                            })),
                    },
                ],
            });
        if (!picked) return;
        let empty = picked.filter((f) => !f.label);
        if (empty.length) return toast('warning', `请给这些事实填上中性标签：${empty.map((f) => f.code).join('、')}`);
        if ((keepLabels(view, picked), !prebuildScopeValid(view, scope)))
            return toast('warning', '确认期间切换了聊天、项目或推进方式，没有写入。请回到原聊天重新操作。');
        let now = view.runtime.clue.compute(),
            fresh = prebuildDiff(plan, now.snap, project.clue.bindings),
            labels = new Map(picked.map((f) => [f.code, f])),
            previewKnows = new Set(diff.newKnows.map((k) => k.key)),
            vanished = diff.kept.filter((code) => !(now.snap.facts && now.snap.facts.has(code)));
        if (vanished.length)
            return toast('warning', `确认期间表格变了（预览时已有的${vanished.join('、')}现在不见了），没有写入。请重新点一次。`);
        if (!prebuildTargetSame(targetPrint, prebuildTargetPrint(now.snap.tables, project.clue.bindings)))
            return toast('warning', '确认期间表格变了（可能刚填过表），没有写入。请重新打开「补全表格」，按现在的表格再确认一次。');
        let want = fresh.newFacts.map((f) => f.code).filter((code) => labels.has(code)),
            knowsToWrite = fresh.newKnows.filter((k) => previewKnows.has(k.key)),
            fb = project.clue.bindings.facts[0],
            kb = project.clue.bindings.knowledge[0],
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
                stopped = '写入过程中切换了聊天';
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
                    stopped = '写入过程中切换了聊天';
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
            ? toast('warning', `${msg}。${stopped}，后面的行没有写；回到原聊天再点一次，会只补剩下的。`)
            : failed.length
              ? toast(
                    'error',
                    `${msg}；${failed.length}行失败：${failed.slice(0, 6).join('、')}。当前聊天至少要有一楼AI回复，数据库才能保存表格；失败事实的知情行也没有写。`,
                )
              : toast('success', `${msg}。`);
    },
    // 场景编号对照：只有编号、入口、地点（和正文看到的入口同级）；作者粘贴进线索控制表的说明（官方填表只展开目标表，放在控制表自己的说明里才看得到）。
    // 生成线索模板（GPT §17.2）：读当前聊天的真实模板 → 和运行表交叉核对 → 合成 → 预览 → 明确用 seed 导入当前聊天
    // → 重新读表核对 → 成功才写绑定。已有线索表时不在模板里追加行（官方 seed 不会落进非空表），新事实用「补全表格」。
    async 'clue-gen-template'(view) {
        let api = acuApi(),
            project = view.project(),
            c = view.runtime.clue.compute();
        if (!api || typeof api.getTableTemplate != 'function' || typeof api.importTemplateFromData != 'function')
            return toast('warning', '没有检测到数据库的模板接口（需要官方SP·数据库8.9以上），无法生成。');
        if (!cardKey()) return toast('warning', '请先打开要使用的聊天。');
        let scope = prebuildScope(view),
            base = null;
        try {
            base = api.getTableTemplate({ scope: 'chat' });
        } catch {}
        if (!isPlainObject(base) || !Object.keys(base).some((k) => k.startsWith('sheet_')))
            return toast('warning', '读不到当前聊天的表格模板，没有生成。请先在数据库里确认这个聊天有表格。');
        let live = (c && c.snap.tables) || {},
            tplNames = Object.values(base)
                .filter((x) => x && x.name)
                .map((x) => x.name),
            mismatch = clueTplMismatch(base, live);
        if (mismatch.length)
            return openDialog({
                title: '没有生成线索模板',
                html: `<p class="pi-hint">读到的模板和当前聊天正在用的表格对不上。直接导入可能新增或隐藏表格，所以没有生成：</p><ul>${mismatch.map((x) => `<li>${esc(x)}</li>`).join('')}</ul><p class="pi-hint">可以先在数据库里把这个聊天的模板和表格对齐（比如重新读表、确认用的是这个聊天的模板），再来生成。</p>`,
                actions: [{ label: '关闭', value: !0, primary: !0 }],
            });
        let plan = prebuildPlan(project.outline.volumes),
            hasFacts = tplNames.includes('关键事实表'),
            preview = synthesizeClueTemplate(base, { clue: { scenes: plan.scenes } });
        if (preview.blocked.length)
            return toast(
                'warning',
                `模板里有不止一张「${preview.blocked.join('」「')}」，无法确定该用哪一张。没有生成；请先在数据库里删掉或改名多余的表。`,
            );
        let html = `<div class="pi-fr-intro"><p>给<b>当前这个聊天</b>的数据库加上线索推进要用的三张表，用来记录主角查到了什么、谁知道了什么、现在在哪个场景。</p>
          <p>原有的表和数据都会保留，不会删除任何东西，也不影响别的聊天。</p></div>
          ${preview.problems.length ? `<p class="pi-hint is-warn"><b>需要你注意：</b></p><ul>${preview.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          <details class="pi-fr-more"><summary class="pi-hint">具体会改哪些地方（${preview.changes.length}处）</summary><p class="pi-hint">目标聊天：${esc(scope.chatLabel || '当前聊天')}</p><ul>${preview.changes.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>没有需要改动的地方</li>'}</ul></details>
          ${hasFacts ? '<p class="pi-hint">这个聊天已经有关键事实表，不在模板里追加行。写入后如果模组里有表里还没有的线索，会接着打开「补全表格」补上。</p>' : plan.facts.length ? `<h4 class="pi-fr-title">这份模组里有${plan.facts.length}条要追踪的线索</h4>${factRowsHtml(plan.facts, 'gt', project.outline.volumes, project.clue.labels)}` : '<p class="pi-hint">模组里还没有线索编号，线索表先建成空表。</p>'}`,
            picked = await openDialog({
                title: '生成线索模板',
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
                                    k = root.querySelector(`[data-gt-crit="${i}"]`);
                                return { code: f.code, label: l ? l.value.trim() : '', criterion: k ? k.value.trim() : '' };
                            }),
                    },
                ],
            });
        if (!picked) return;
        if (!hasFacts) {
            let empty = picked.filter((f) => !f.label);
            if (empty.length) return toast('warning', `请给这些事实填上中性标签：${empty.map((f) => f.code).join('、')}`);
        }
        if (!prebuildScopeValid(view, scope))
            return toast('warning', '确认期间切换了聊天、项目或推进方式，没有导入。请回到原聊天重新操作。');
        let again = null;
        try {
            again = api.getTableTemplate({ scope: 'chat' });
        } catch {}
        if (JSON.stringify(again) !== JSON.stringify(base))
            return toast('warning', '确认期间这个聊天的表格模板变了，没有导入。请重新点「创建模板」。');
        view.runtime.clue.invalidate();
        let liveNow = view.runtime.clue.compute(),
            again2 = clueTplMismatch(base, (liveNow && liveNow.snap.tables) || {});
        if (again2.length) return toast('warning', `确认期间当前聊天的表格变了，没有导入：${again2[0]}。请重新点「创建模板」。`);
        let catalogNow = liveNow ? sceneCatalogCell(liveNow.state, liveNow.plan || { recognize: [] }, liveNow.prog) : '',
            gen = synthesizeClueTemplate(base, {
                clue: hasFacts
                    ? { scenes: plan.scenes }
                    : { controlRow: ['主线', '', catalogNow], ...trpgSeedRows(project, liveNow, picked, plan.knows), scenes: plan.scenes },
            }),
            res = null;
        try {
            res = await api.importTemplateFromData(gen.template, { scope: 'chat', dataMode: 'seed' });
        } catch (error) {
            res = { success: !1, message: (error && error.message) || String(error) };
        }
        if (!res || !res.success)
            return toast('error', `导入失败，表格和绑定都没有改动：${(res && (res.message || res.error)) || '数据库没有返回结果'}`);
        if (!prebuildScopeValid(view, scope))
            return toast(
                'warning',
                '模板已经导入，但导入期间切换了聊天，没有写插件绑定。请回到原聊天，在「表格绑定」里点「填入示例 → 应用」。',
            );
        (view.data.updateProject(view.projectId, (p) => ({
            ...p,
            clue: normalizeClue({ ...p.clue, bindings: { ...p.clue.bindings, ...gen.binding, switch: null } }),
        })),
            hasFacts || keepLabels(view, picked),
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
        if ((view.renderBody(), gone.length))
            return toast(
                'error',
                `模板已经导入，但原来的这些表格内容现在读不到了：${gone.slice(0, 6).join('、')}。请到数据库的模板 / 数据管理里检查（可能被隐藏了），不要重复导入。`,
            );
        res.runtimeReady === !1
            ? toast('warning', '模板已经保存，但数据库提示表格还没就绪。请先点「重新读表」，不要重复导入。')
            : lost.length
              ? toast(
                    'warning',
                    `模板已经导入，但现在读表还看不到：${lost.join('、')}。请点「重新读表」，或等一楼自动填表后再看；不要重复导入。`,
                )
              : toast(
                    'success',
                    `已导入。${gen.changes.length}处改动${gen.problems.length ? `，${gen.problems.length}处需要注意（见预览）` : ''}。插件绑定已更新。`,
                );
        // 已有线索表：模板只更新场景等，缺的线索行接着补（用户 2026-11-23：分不清什么时候用「补全表格」）
        if (hasFacts && res.runtimeReady !== !1 && !lost.length && after) {
            let p2 = view.project(),
                d2 = prebuildDiff(prebuildPlan(p2.outline.volumes), after.snap, p2.clue.bindings);
            d2.factTable && (d2.newFacts.length || d2.newKnows.length) && (await clueActions['clue-prebuild'](view));
        }
    },
    async 'clue-catalog'(view) {
        let plan = prebuildPlan(view.project().outline.volumes),
            text = plan.scenes.length
                ? [
                      '【场景编号对照】（只用于对号；不表示已经开放或已经发生）',
                      ...plan.scenes.map((s) => `- ${s.uid}：${[s.entry, s.place && `地点：${s.place}`].filter(Boolean).join('；')}`),
                  ].join(`
`)
                : '';
        if (!text) return toast('info', '模组里没有带入口的节点。');
        await openDialog({
            title: '场景编号对照',
            html: `<p class="pi-hint">复制下面的文字，粘贴到数据库「线索控制表」说明（note）的末尾。只包含入口和地点，不含发现。长主线建议只放当前几个阶段的节点。</p><textarea class="pi-ta is-mono is-tall" readonly>${esc(text)}</textarea>`,
            actions: [{ label: '关闭', value: !0, primary: !0 }],
        });
    },
    'clue-fact-keep'(view, target) {
        (view.runtime.clue.act({ kind: 'fact', target: target.dataset.id, value: 'confirmed', note: '玩家保留' }), view.renderBody());
    },
    // 手机上没有悬停说明：第一次作废先确认一句（之后同一次打开不再问）。
    // 票据在点按钮时就取：确认框开着时切了聊天、项目或模式，确认后什么都不做（GPT 实测返修审阅 R1）。
    async 'clue-fact-void'(view, target) {
        let s0 = view.runtime.clue.opScope(),
            id = target.dataset.id;
        if (
            !voidAsked &&
            !(await confirmDialog({
                title: '当作没发生？',
                body: '插件按没拿到算，相关表格改回未获得；之后可以重新查。已经写出的正文不会删除。',
                okLabel: '作废',
            }))
        )
            return;
        voidAsked = !0;
        let r = await view.runtime.clue.voidFact(id, s0);
        (view.renderBody(),
            !r || !r.done
                ? toast('info', (r && r.why) || '这次作废没有执行')
                : r.table === 'ok'
                  ? toast('success', '已作废，表格也改回了未获得。')
                  : toast(
                        'warning',
                        `已作废，插件按没拿到算；但${r.table === 'partial' ? '表格只改了一部分' : '表格没改'}：${r.why || '原因不明'}`,
                    ));
    },
    'clue-fact-restore'(view, target) {
        let eff = view.runtime.clue.restoreFact(target.dataset.id);
        (view.renderBody(),
            toast(
                'info',
                eff && eff.confirmed
                    ? '已解除作废：表格里记的是已获得，按已获得算。'
                    : '已解除作废：表格里现在没记它，按没拿到算。作废时清掉的记录不会改回去。',
            ));
    },
    'clue-leave'(view, target) {
        (view.runtime.clue.leaveScene(target.dataset.uid),
            toast('info', '已记下主角离开了这件事：不再注入它的场景，只给入口。'),
            view.renderBody());
    },
    // 阶段「⋯」：手动设进行中 / 已结束 / 改回按条件判断
    async 'clue-stage-menu'(view, target) {
        let clue = view.runtime.clue,
            c = clue.compute(),
            id = target.dataset.id,
            s = c && c.state.stageStates.get(id);
        if (!s) return;
        let hand = (c.prog.stages || {})[id] || '',
            live = s.entered.v === 'true' && !s.done,
            pick = await menuDialog({
                title: stageLabel(s.unit.stage.key),
                items: [
                    ...(live && hand !== 'enter' ? [] : [{ label: '设为进行中', value: 'enter' }]),
                    ...(s.done && hand === 'done' ? [] : [{ label: '标记为已结束', value: 'done' }]),
                    ...(hand ? [{ label: '改回按条件判断', value: '' }] : []),
                ],
            });
        if (pick === null || pick === void 0) return;
        let note = pick ? await promptDialog({ title: '记录原因（可空）', label: '为什么手动处理' }) : '';
        note !== null && (clue.act({ kind: 'stage', target: id, value: pick, note }), view.renderBody());
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
                ...(c.state.focus.uid === uid ? [{ label: '主角已离开（只给入口）', value: 'leave' }] : []),
                ...(s.status === 'locked' && !s.manualOpen ? [{ label: '手动开放（不算拿到线索）', value: 'open:force' }] : []),
                ...(over.open
                    ? [{ label: over.open === 'force' ? '取消手动开放' : '取消停用', value: 'open:' }]
                    : [{ label: '暂时停用这个节点', value: 'open:block' }]),
                ...(s.status !== 'done'
                    ? [{ label: '手动标记完成', value: 'done:force' }]
                    : over.done !== 'force'
                      ? [{ label: '算作没完成（不管表格）', value: 'done:undo' }]
                      : []),
                ...(over.done ? [{ label: '完成与否改回按表格判断', value: 'done:' }] : []),
                ...(s.node.required
                    ? [{ label: over.skip ? '取消跳过' : '跳过（不挡这一阶段，也不算完成）', value: over.skip ? 'skip:' : 'skip:true' }]
                    : []),
                { label: '手动确认或作废一条线索…', value: 'fact' },
            ],
            pick = await menuDialog({ title: s.node.name, items });
        if (!pick) return;
        if (pick === 'focus') return (clue.setFocus(uid), view.renderBody());
        if (pick === 'leave') return (clue.leaveScene(uid), view.renderBody());
        if (pick === 'fact') return factDialog(view, s);
        let [kind, value] = pick.split(':'),
            note =
                (kind === 'open' && value === 'force') || (kind === 'done' && value === 'force')
                    ? await promptDialog({ title: '记录原因（可空）', label: '为什么手动处理' })
                    : '';
        note !== null && (clue.act({ kind, target: uid, value: value === 'true' ? !0 : value, note }), view.renderBody());
    },
};

export async function factDialog(view, s) {
    let refs = nodeFactRefs(s.node),
        id = await promptDialog({
            title: '线索编号',
            label: refs.length ? `这个节点用到的线索：${refs.join('、')}` : '填线索编号（模组「发现」里的「事实」）',
            value: refs[0] || '',
        });
    if (!id || !id.trim()) return;
    let pick = await menuDialog({
        title: `线索${id.trim()}`,
        items: [
            { label: '手动确认拿到了（表格没记上时用）', value: 'confirmed' },
            { label: '当作没拿到（只改插件判断，不改表格）', value: 'revoked' },
            { label: '改回按表格判断', value: '' },
        ],
    });
    if (pick === null) return;
    let note = await promptDialog({ title: '记录原因', label: '依据 / 来源（建议填写）' });
    note !== null && (view.runtime.clue.act({ kind: 'fact', target: id.trim(), value: pick, note }), view.renderBody());
}

export function clueOnChange(view, target) {
    return target.dataset.clueSidelimit !== void 0
        ? (view.data.updateProject(view.projectId, (p) => ({ ...p, clue: normalizeClue({ ...p.clue, sideLimit: Number(target.value) }) })),
          view.runtime.clue.invalidate('line-limit'),
          view.runtime.clue.scheduleSync(),
          view.renderBody(),
          !0)
        : target.dataset.clueLinetoast !== void 0
          ? (view.data.updateProject(view.projectId, (p) => ({ ...p, clue: normalizeClue({ ...p.clue, lineToast: target.checked }) })),
            view.renderBody(),
            !0)
          : !1;
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
        .replace(/尚无记录/g, '还没发生')
        .replace(/\b(?:线 |节点 )?([A-Za-z][\w-]*)\b/g, (all, id) => (names.has(id) ? names.get(id) : all));
}

export function lineWaitText(s, c, labels = {}) {
    let l = s.line,
        plan = c.plan;
    if (s.missed) return s.window.reasons.join('；');
    if (s.state === '未触发')
        return `等：${[...(s.cond.v === 'true' ? [] : s.cond.reasons), ...(s.window && s.window.v !== 'true' ? s.window.reasons : [])].map((r) => readableReason(r, c, labels)).join('；') || '开启条件'}`;
    if (s.state === '可开启')
        return l.kind === 'main'
            ? c.prog.mainPaused
                ? '主线已全部暂停。'
                : l.mode === 'manual'
                  ? '手动开始：点「进入」开始，正在进行的主线会先暂停。'
                : s.waitMain
                  ? `${s.waitMain}，轮到它时自动开始。`
                  : ''
            : plan && plan.unsynced && s.entries.length && s.entries.every((u) => plan.unsynced.includes(u))
              ? '还在准备，下一轮开始提示。'
              : l.mode === 'manual'
                ? '手动开始：不主动提示，点「进入」开始。'
                : c.prog.sidePaused
                  ? '支线已全部暂停。'
                  : plan && plan.slots.full
                    ? '同时进行的支线已满，正文暂时不提它；主角自己走进去时，顶端会出现「切换」。'
                    : plan && plan.offer && plan.offer.line === l.id
                      ? '正文会在空闲时提起入口，主角走进去就开始。'
                      : s.entries.length
                        ? '排在后面，轮到它时正文会提起入口；主角自己走进去也会开始。'
                        : '第一个阶段还没有能开始的场景。';
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

export function lineCard(c, project) {
    let list = c.state.lineStates || [];
    if (!list.length) return '';
    let sides = list.filter((s) => s.line.kind === 'side'),
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
                        ? btn('deny', '取消开启', ' is-ghost', '插件认错了：这条线回到可开启，同一次依据不再自动开启')
                        : s.manual.started || s.manual.state
                          ? btn('', '还原', ' is-ghost', '把你在这条线上点过的进入 / 暂停 / 完成 / 放弃还原，回到按条件自动判断')
                          : '',
                checks = !s.started && !s.manual.state && l.mode !== 'manual' ? tableCondChecks(l.open, c.snap.tables || {}) : [],
                stuck = checks.filter((x) => x.stuck),
                fix = stuck.length
                    ? `<p class="pi-hint is-warn">开启条件读不出来：${esc(stuck.flatMap((x) => x.notes).join('；'))}。这样它会一直开不了。 <button type="button" class="pi-btn is-sm" data-act="clue-line-manual" data-id="${esc(l.id)}" title="开启条件挪到「原开启条件」里留着看，不再自动判断；执行页出现「进入」按钮，玩家想玩时点它">改成手动开始</button></p>`
                    : '',
                orig = l.origCond ? `<p class="pi-hint">原来的开启要求（自己判断什么时候点「进入」）：${esc(l.origCond)}</p>` : '',
                tierBtns = checks
                    .filter((x) => x.tierPending)
                    .map(
                        (x) =>
                            `<p class="pi-hint is-warn">档位顺序是AI推断的：${esc(x.tierPending.join(' < '))}。确认前这个条件一直是未知。 <button type="button" class="pi-btn is-sm" data-act="clue-tiers" data-tiers="${esc(JSON.stringify(x.tierPending))}" title="模组里用同样档位的条件都算确认">从低到高没错</button> <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-line-manual" data-id="${esc(l.id)}">改成手动开始</button></p>`,
                    )
                    .join(''),
                group = l.kind === 'side' ? sides : mains,
                k = group.indexOf(s),
                arrows =
                    group.length > 1
                        ? `<button type="button" class="pi-btn is-sm is-ghost" data-act="clue-line-move" data-id="${esc(l.id)}" data-dir="-1"${k <= 0 ? ' disabled' : ''}>往前排</button><button type="button" class="pi-btn is-sm is-ghost" data-act="clue-line-move" data-id="${esc(l.id)}" data-dir="1"${k >= group.length - 1 ? ' disabled' : ''}>往后排</button>`
                        : '';
            let title = String(l.name || '').replace(/·/g, ' ').replace(/^卷[^\s]*\s+/, '').replace(l.id ? new RegExp(`^${l.id}\\s*`) : /^$/, '') || lineDisplayName(l),
                main0 = canEnter ? btn('enter', '进入', ' is-primary', l.mode === 'manual' ? '想玩这条线了：现在开始' : '主角已经开始做这件事了（填表没认出来时用），或者你现在就想开始') : s.state === '暂停' ? btn('resume', '继续', ' is-primary') : '',
                // 「⋯」分组（第四批）：暂停、排序 / 完成、跳过、放弃（放弃红字）/ 还原；只列这条线现在能用的
                g1 = [...(canEnter || s.state === '进行中' ? [btn('pause', '暂停', ' is-ghost')] : [])].join('') + arrows,
                g2 = [
                    ...(s.state === '进行中' ? [btn('done', '标记完成', ' is-ghost')] : []),
                    ...(canEnter && inQueue ? [btn('skip', '跳过', ' is-ghost')] : []),
                    ...(s.state === '进行中' || s.state === '暂停' ? [btn('abandon', '放弃', ' is-ghost is-danger')] : []),
                ].join(''),
                groups3 = [g1, g2, undo].filter(Boolean),
                more = groups3.length ? `<details class="pi-line-more"><summary class="pi-icon-btn" title="更多">${ICONS.more}</summary><div class="pi-line-menu">${groups3.map((g) => `<div class="pi-line-menu-g">${g}</div>`).join('')}</div></details>` : '';
            // 两层（第四批，用户 2026-11-16）：线名一行（最多两行），右边「进入 / 继续」和「⋯」，各条线右边对齐；第二行主线 / 支线和状态
            return `<div class="pi-line-row"><div class="pi-line-head"><b class="pi-line-name" title="${esc(l.id)}">${esc(title)}</b><span class="pi-kind pi-rl-kind">${l.kind === 'main' ? '主线' : '支线'}</span><span class="pi-badge ${s.missed ? '' : LINE_BADGE[s.state] || ''}">${esc(s.missed ? '已错过' : s.state)}</span>${l.kind === 'side' && c.prog.sidePaused && s.state === '进行中' ? '<span class="pi-meta">全部支线已暂停</span>' : ''}<div class="pi-line-acts">${main0}${more}</div></div>
          ${l.brief ? `<p class="pi-hint">${esc(l.brief)}</p>` : ''}${wait && /^已离开/.test(wait) ? `<p class="pi-hint">${esc(wait)}</p>` : ''}${orig}${fix}${tierBtns}</div>`;
        };
    return `<div class="pi-rl-lines">${list.map(row).join('')}</div>`;
}

export function hereText(c) {
    let g = findGlobalTable(Object.values(c.snap.tables || {})),
        cell = g && g.place ? readCell(c.snap.tables || {}, `${g.name}/${g.row}/${g.place}`) : { state: 'unknown' },
        here = cell.state === 'ok' ? cellText(cell.value) : '',
        focus = c.state.nodeStates.find((s) => s.node.uid && s.node.uid === c.state.focus.uid),
        place = focus ? clueText(isPlainObject(focus.node.item) ? focus.node.item.地点 : '') : '';
    return esc(here || place);
}

export function stayNotice(view, c) {
    let info = view.runtime.clue.stayInfo(),
        st = info && info.key ? stayState(view.runtime.progress().stays, chatMessages(), info) : null;
    return st && st.idle >= 7
        ? `<p class="pi-hint is-warn">这一场很久没有新的发现了（连续${st.idle}条回复）。想换个地方，可以让主角离开，或者点「离开这个调查」；想先玩日常，可以暂停剧情。也可能只是填表漏记了，可以对照正文看看。</p>`
        : '';
}

// pid：写到哪个项目。改线索标签写表途中用户可能切去看别的项目，收尾时必须写回开始时的项目（GPT 第六轮复核 F1）
export function keepLabels(view, picked, pid = view.projectId) {
    let p = pid ? view.data.project(pid) : null;
    if (!p) return !1;
    let ctx = new Map(
            factLabelContext(
                p.outline.volumes,
                picked.map((f) => f.code),
            ).map((x) => [x.code, x]),
        ),
        add = {};
    for (let f of picked)
        f.label && (add[f.code] = { label: f.label, criterion: f.criterion || '', sig: factLabelSig(ctx.get(f.code) || { usedBy: [] }) });
    Object.keys(add).length &&
        view.data.updateProject(p.id, (cur) => ({
            ...cur,
            clue: normalizeClue({ ...cur.clue, labels: { ...(cur.clue.labels || {}), ...add } }),
        }));
    return !0;
}

// 改线索标签没写进表格的输入（按项目、按编号）：下次打开弹窗带出来重试（GPT 第六轮 R2）。只在本次页面里保留。
// 键是来源：项目、聊天、数据隔离、事实表。换了聊天、隔离或表绑定，就不把别处的输入当成这里的重试（GPT 第六轮复核 F2）。
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
              try {
                  let ids = Array.isArray(project.imports) ? project.imports : [],
                      jobs = await Promise.all(
                          ids.map((id) =>
                              view.data.imports.get(id)
                                  ? Promise.resolve(view.data.imports.get(id))
                                  : view.data.imports.load(id).catch(() => null),
                          ),
                      ),
                      secrets = [...new Set(jobs.filter(Boolean).flatMap((j) => importSecretNames(j.index) || []))],
                      items = todo.map((x) => x.ctx),
                      r = parseFactLabels(
                          await ask(view, 'outline', factLabelMessages(items, { secrets })),
                          todo.map((x) => x.code),
                      ),
                      got = /* @__PURE__ */ new Map();
                  for (let x of todo) {
                      let v = r.items.get(x.code);
                      v && v.label && got.set(x.code, { label: v.label, criterion: v.criterion, sig: x.sig });
                  }
                  try {
                      let rv = [...got].map(([code, v]) => {
                              let c = todo.find((x) => x.code === code).ctx;
                              return {
                                  code,
                                  label: v.label,
                                  criterion: v.criterion,
                                  answer: [c.answer, ...(c.routes || []).map((q) => q.answer)].filter(Boolean).join('；或者：'),
                                  entry: c.entry,
                                  scene: c.scene,
                                  record: [c.record, ...(c.routes || []).map((q) => q.record)].filter(Boolean).join('；或者：'),
                                  pieces: factLabelCheck({ label: v.label, criterion: v.criterion }, c, { secrets }).suspects.map(
                                      (s) => s.piece,
                                  ),
                              };
                          }),
                          map = rv.length
                              ? parseFactLabelReview(
                                    await ask(view, 'outline', factLabelReviewMessages(rv)),
                                    rv.map((x) => x.code),
                                )
                              : /* @__PURE__ */ new Map();
                      for (let [code, v] of map)
                          v &&
                              v.leak &&
                              got.has(code) &&
                              got.set(code, {
                                  ...got.get(code),
                                  label: v.label || got.get(code).label,
                                  criterion: v.criterion || got.get(code).criterion,
                              });
                  } catch {}
                  view.data.project(pid) &&
                      view.data.updateProject(pid, (p) => ({
                          ...p,
                          clue: normalizeClue({ ...p.clue, labels: { ...(p.clue.labels || {}), ...Object.fromEntries(got) } }),
                      }));
                  let missing = todo.filter((x) => !got.has(x.code)).map((x) => x.code);
                  return (
                      quiet ||
                          (missing.length
                              ? toast(
                                    'warning',
                                    `线索标签准备好了${got.size}条，${missing.length}条没生成（${missing.slice(0, 5).join('、')}）。可以到执行页重试。`,
                                )
                              : toast('success', `已为${got.size}条线索准备好标签。`)),
                      view.runtime.clue.scheduleSync(),
                      { done: got.size, missing }
                  );
              } catch (error) {
                  return (
                      quiet || toast('warning', `线索标签没准备好：${error.message}。模组已经采用；可以到执行页重试。`),
                      { done: 0, missing: todo.map((x) => x.code), error: error.message }
                  );
              } finally {
                  ((labelJob = null), view.renderBody && view.renderBody());
              }
          })()),
          labelJob)
        : { done: 0, missing: [] };
}

export function labelsPendingHtml(project, c) {
    let have = (c && c.snap.facts) || /* @__PURE__ */ new Map(),
        todo = labelsToPrepare(project.outline.volumes, project.clue.labels).filter((x) => !have.has(x.code));
    return todo.length
        ? `<div class="pi-row is-todo pi-labels-todo"><p class="pi-hint is-warn" title="${esc(todo.map((x) => x.code).join('、'))}">${todo.length}条线索的标签还没准备好。</p><button type="button" class="pi-btn is-sm" data-act="clue-labels">${labelJob ? '正在准备…' : '现在准备'}</button></div>`
        : '';
}

export function unofferedHtml(c, project) {
    return (c.unoffered || [])
        .map((x) => {
            let labels = project && isPlainObject(project.clue.labels) ? project.clue.labels : {},
                text = (labels[x.id] && labels[x.id].label) || clueText(x.text) || factName(x.id) || '一条线索',
                short = text.length > 40 ? `${text.slice(0, 40)}…` : text;
            return x.revoked
                ? `<p class="pi-hint pi-unoffered">已作废（按没拿到算）：<span title="${esc(`${x.id} ${text}`)}">${esc(short)}</span> <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-fact-restore" data-id="${esc(x.id)}" title="解除作废，重新按表格判断；不会还原被清掉的记录">解除作废</button></p>`
                : `<p class="pi-hint is-warn pi-unoffered">⚠ 正文可能自己编了：<span title="${esc(`${x.id} ${text}`)}">${esc(short)}</span> <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-fact-keep" data-id="${esc(x.id)}" title="保留：就当发生了，剧情照常走">保留</button><button type="button" class="pi-btn is-sm is-ghost" data-act="clue-fact-void" data-id="${esc(x.id)}" title="作废：当作没发生，之后可以重新查">作废</button></p>`;
        })
        .join('');
}
