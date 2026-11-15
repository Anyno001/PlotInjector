import { PLOT_MODES, isClueMode, normalizeClue } from '../core/clue-model.js';
import { esc, confirmDialog, openDialog, menuDialog, promptDialog } from './dom.js';
import { stringifyYaml, parseYaml } from '../core/yaml.js';
import { acuApi } from '../app/clue-runtime.js';
import { NODE_STATUS_LABELS, AWAY_PREFIX } from '../core/clue-rules.js';
import { ICONS } from './styles.js';
import { stageLabel, isPlainObject } from '../core/outline.js';
import { CLUE_SLOT } from '../core/progress.js';

import { estimateTokens } from '../core/tokens.js';
import { PACES } from '../core/inject.js';
import { normalizeClueOps, anchorValid } from '../core/clue-progress.js';
import { chatMessages, ctx, toast, cardKey } from '../host/st.js';

import { factLabelContext, factLabelWarnings, factLabelMessages, parseFactLabels } from '../core/fact-labels.js';
import { importSecretNames } from '../core/long-import.js';

import { ask } from './ai.js';

import { findSheet, sheetRows, cellText } from '../core/clue-tables.js';

import { prebuildPlan, prebuildDiff, nodeFactRefs } from '../core/clue-project.js';

import { clueTplMismatch, synthesizeClueTemplate, clueTplHeader } from '../core/clue-template.js';

export const CLUE_STATUS_BADGE = { locked: '', available: 'is-accent', active: 'is-ok', done: 'is-dark' };

export const FOCUS_SOURCE = {
    manual: '人工选择',
    table: '表格场景',
    auto: '唯一可进行',
    stale: '人工选择已失效',
    manualDone: '人工选择的场景已完成，只给入口',
    none: '未选择',
    away: '已离开调查，只给入口',
};

export function modeCard(project) {
    let mode = project.clue ? project.clue.mode : 'outline';
    return `<div class="pi-card"><h3>推进方式</h3>
        <div class="pi-seg">${PLOT_MODES.map((item) => `<button type="button" class="pi-seg-btn${item.value === mode ? ' is-sel' : ''}" data-act="clue-mode" data-mode="${item.value}">${esc(item.label)}</button>`).join('')}</div>
        <p class="pi-hint">${mode === 'clue' ? '按表格里已确认的事实开放节点。不做自动 AI 检测，不注入整阶段内容；进度随填表结果更新。' : '按阶段顺序推进，原有检测与注入方式。'}</p></div>`;
}

export function bindingText(list) {
    return stringifyYaml(list).trim();
}

export function hasLinkApi() {
    let api = acuApi();
    return !!(api && typeof api.registerPlotLinkProvider == 'function');
}

export function bindingCard(project, st7) {
    let c = project.clue,
        b = c.bindings,
        open = st7.bindOpen,
        summary = [
            `事实表 ${b.facts.length}`,
            `知情表 ${b.knowledge.length}`,
            b.switch ? '主线开关' : '',
            b.scene ? '场景单元格' : '',
            b.time ? '故事时间' : '',
        ]
            .filter(Boolean)
            .join(' · ');
    return `<div class="pi-card"><h3>表格绑定<span class="pi-meta">${esc(summary)}</span><span class="pi-spacer"></span>
        <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-bind-toggle">${open ? '收起' : '编辑'}</button></h3>
        ${hasLinkApi() ? `<label class="pi-check"><input type="checkbox" data-clue-waitfill${c.waitFill !== !1 ? ' checked' : ''}><span>（实验联动接口）上一轮填表未完成时，等它提交后再开始本轮</span></label>` : ''}
        ${
            open
                ? `<p class="pi-hint">YAML 格式。表名、列名按本卡数据库填写；行标识对应表的第一列。</p>
        <textarea class="pi-ta is-mono is-tall" data-clue-bindings>${esc(bindingText(b))}</textarea>
        <div class="pi-tools is-c2 is-end"><button type="button" class="pi-btn is-sm" data-act="clue-bind-example">填入示例</button>
        <button type="button" class="pi-btn is-primary is-sm" data-act="clue-bind-apply">应用</button></div><p class="pi-status" data-clue-bind-status></p>`
                : ''
        }
        <div class="pi-tools"><button type="button" class="pi-btn is-sm is-primary is-wide" data-act="clue-gen-template" title="在当前聊天的表格上加入三张线索表（带预建行），并调整默认表的规则；先预览，确认后才导入">生成线索模板…</button></div>
        <div class="pi-tools is-c2"><button type="button" class="pi-btn is-sm" data-act="clue-prebuild" title="按大纲给关键事实表、知情表补上缺的预建行；已有的行不动">按大纲补预建行…</button>
        <button type="button" class="pi-btn is-sm" data-act="clue-catalog" title="生成场景编号对照，粘贴到线索控制表的说明里">场景编号对照…</button></div></div>`;
}

export const BINDING_EXAMPLE = `facts:
  - {表: 关键事实表, 编号列: 编号, 状态列: 状态, 已核实值: 已核实, 说法值: 存疑, 内容列: 内容, 来源列: 依据}
knowledge:
  - {表: 知情表, 事实列: 事实, 角色列: 角色, 方式列: 获知方式, 可信度列: 可信度, 已核实值: 已核实, 来源列: 依据, 有效值: [亲见, 被告知, 听说, 推测]}
scene: {路径: 线索控制表/主线/当前场景, 离场值: 离场}
time: {路径: [全局数据表/全局状态/当前时间, 线索控制表/主线/当前时间]}
`;

export function reasonList(result) {
    return result && result.reasons && result.reasons.length
        ? result.reasons
              .slice(0, 4)
              .map((r) => `<li>${esc(r)}</li>`)
              .join('')
        : '';
}

export function nodeRow(s, focusUid, open) {
    let badge = CLUE_STATUS_BADGE[s.status],
        flags = [
            s.node.required ? '' : '可选',
            s.skipped ? '已跳过' : '',
            s.disabled ? '暂禁' : '',
            s.manualOpen ? '人工开放' : '',
            s.done.manual ? '人工' : '',
        ]
            .filter(Boolean)
            .join(' · '),
        why = s.status === 'locked' ? reasonList(s.open) : s.status !== 'done' ? reasonList(s.done) : '';
    return `<div class="pi-clue-node${s.node.uid === focusUid ? ' is-focus' : ''}">
        <div class="pi-clue-hd" data-act="clue-node-open" data-uid="${esc(s.node.uid)}">
            <span class="pi-badge ${badge}">${esc(NODE_STATUS_LABELS[s.status])}</span>
            <span class="pi-clue-name">${esc(s.node.name)}</span>
            ${flags ? `<span class="pi-meta">${esc(flags)}</span>` : ''}
            ${s.node.uid ? `<button type="button" class="pi-icon-btn" data-act="clue-node-menu" data-uid="${esc(s.node.uid)}" title="人工维护">${ICONS.more}</button>` : ''}</div>
        ${open || why ? `<ul class="pi-clue-why">${open ? reasonList(s.open) + reasonList(s.done) : why}</ul>` : ''}</div>`;
}

export function stageBlock(unit, stage, nodes, focusUid, st7) {
    let state = stage.done ? '已结束' : stage.entered.v === 'true' ? '进行中' : '未进入',
        left =
            stage.requiredLeft.length && stage.entered.v === 'true'
                ? `还差必需节点：${stage.requiredLeft.map((n) => n.name).join('、')}`
                : '',
        endWhy =
            stage.entered.v === 'true' && !stage.done && !stage.requiredLeft.length && stage.end.v !== 'true'
                ? `结束条件：${stage.end.reasons.join('；')}`
                : '',
        enterWhy = stage.entered.v !== 'true' ? stage.entered.reasons.join('；') : '';
    return `<div class="pi-clue-stage is-${stage.done ? 'done' : stage.entered.v === 'true' ? 'active' : 'todo'}">
        <div class="pi-tl-hd"><span class="pi-tl-name">${esc(stageLabel(unit.stage.key))}</span><span class="pi-tl-state">${esc(state)}</span></div>
        ${[left, endWhy, enterWhy]
            .filter(Boolean)
            .map((t) => `<p class="pi-hint">${esc(t)}</p>`)
            .join('')}
        ${nodes.map((s) => nodeRow(s, focusUid, st7.nodeOpen === s.node.uid)).join('')}</div>`;
}

export function mainlineCard(c) {
    let units = c.compiled.units,
        done = units.length > 0 && units.every((u) => (c.state.stageStates.get(u.id) || {}).done),
        leads = c.state.nodeStates.filter((s) => s.status === 'available' && !s.disabled).length;
    if (c.prog.paused)
        return `<div class="pi-card"><h3>主线<span class="pi-badge is-warn">已暂停</span><span class="pi-spacer"></span>
        <button type="button" class="pi-btn is-sm is-primary" data-act="clue-pause" data-value="">继续主线</button></h3>
        <p class="pi-hint">日常游玩中：不注入线索场景和可去做的事，只保留设定。节点进度、表格和人工记录都保留；继续后从现在的进度接着推。</p></div>`;
    if (done)
        return `<div class="pi-card"><h3>主线<span class="pi-badge is-ok">已全部完成</span><span class="pi-spacer"></span>
        <button type="button" class="pi-btn is-sm" data-act="clue-pause" data-value="1">暂停主线</button>
        <button type="button" class="pi-btn is-sm is-primary" data-act="clue-next">开始下一段主线…</button></h3>
        <p class="pi-hint">${leads ? `还有 ${leads} 个没走过的可选节点会作为「可以去做的事」提供给正文；不想要就暂停主线。` : '已经没有可去做的线索事项。'}下一段主线写成新的一卷，接在后面自动开始；已有事实和知情记录都可以在新卷的条件里引用。</p></div>`;
    return `<div class="pi-card"><h3>主线<span class="pi-badge is-ok">进行中</span><span class="pi-spacer"></span>
        <button type="button" class="pi-btn is-sm" data-act="clue-pause" data-value="1" title="去玩日常：不注入线索内容，进度保留">暂停主线</button></h3></div>`;
}

export function renderClueRun(view, project, st7) {
    let { runtime } = view,
        clue = runtime.clue,
        c = clue.compute(),
        d = clue.diagnose();
    if (!c) return modeCard(project);
    let problems = [...c.snap.problems, ...c.compiled.errors, ...c.state.cycles.map((u) => `节点 ${u} 条件循环引用`)],
        focus = c.state.focus,
        focusNode = c.state.nodeStates.find((s) => s.node.uid === focus.uid),
        entries = runtime.entries(),
        clueEntry = entries.find((e) => e.slotId === CLUE_SLOT),
        linkWarn = !d.linkApi
            ? ''
            : !d.queueSignals
              ? '数据库剧情联动版本较旧（低于 v3）：等待填表只能按回复后的短暂窗口估计。'
              : !d.registered
                ? '剧情联动尚未注册（打开聊天或发送一次后注册）。'
                : '',
        fill = clue.isFilling() ? '<span class="pi-badge is-warn">填表中</span>' : '',
        enabled = c.snap.enabled === !1 ? '<span class="pi-badge is-warn">主线关闭</span>' : '',
        paused = c.prog.paused ? '<span class="pi-badge is-warn">已暂停</span>' : '',
        groups = [];
    for (let unit of c.compiled.units)
        groups.push(
            stageBlock(
                unit,
                c.state.stageStates.get(unit.id),
                c.state.nodeStates.filter((s) => s.node.unit === unit),
                focus.uid,
                st7,
            ),
        );
    let last = clue.lastInjected();
    return `${modeCard(project)}${bindingCard(project, st7)}
        ${problems.length ? `<div class="pi-card"><h3>需要处理<span class="pi-badge is-warn">${problems.length}</span></h3>${problems.map((p) => `<p class="pi-hint is-warn">${esc(p)}</p>`).join('')}</div>` : ''}
        ${mainlineCard(c)}
        <div class="pi-card"><h3>本轮场景${enabled}${paused}${fill}<span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-refresh">重新读表</button>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="preview">预览</button></h3>
        <p class="pi-hint">焦点：${focusNode ? `<b>${esc(focusNode.node.name)}</b>（${esc(FOCUS_SOURCE[focus.source])}）` : esc(FOCUS_SOURCE[focus.source])}${focusNode ? ` <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-leave" data-uid="${esc(focusNode.node.uid)}" title="玩家已经离开这个调查：不再注入它的场景和发现，只给入口；填表写入新场景或人工选焦点后恢复">离开这个调查</button>` : ''}${c.prog.focus ? ` <button type="button" class="pi-btn is-sm is-ghost" data-act="clue-unfocus">${c.prog.focus.startsWith(AWAY_PREFIX) ? '撤销离开' : '取消人工焦点'}</button>` : ''}</p>
        ${(c.hints || []).map((h) => `<p class="pi-hint is-warn">两表核对：${esc(h)}</p>`).join('')}
        ${linkWarn ? `<p class="pi-hint is-warn">${esc(linkWarn)}</p>` : ''}
        ${!c.prog.paused && d.plot && d.plot.items.length ? `<p class="pi-hint is-warn">数据库剧情推进预设「${esc(d.plot.preset)}」里启用了召回以外的任务：${esc(d.plot.items.map((x) => `「${x.task}」（输出 ${x.tags.join('、')}）`).join('、'))}。这类任务会规划角色行动或剧情方向，并写回用户消息，可能和线索主线抢剧情方向。跑线索主线时建议在数据库里关掉它们，只留召回；暂停主线玩日常时可以再打开。插件不会替你改预设。</p>` : ''}
        <p class="pi-hint">注入方式：临时世界书条目（只对本次生成生效，不写进聊天记录）${clueEntry ? ` · 约 ${estimateTokens(clueEntry.content)} token` : ''}${clueEntry && !clueEntry.content ? ` · ${esc(clueEntry.reason || '无内容')}` : ''}</p>
        ${d.linkApi ? '<p class="pi-hint">（实验联动接口）前置任务想看到候选场景，需要在推进预设的任务提示词里写 <code>$P</code>。</p>' : ''}
        <p class="pi-hint">线索按数据库<b>最近一次已提交</b>的表格计算${d.lastTableUpdate ? `；表格最近更新于 ${new Date(d.lastTableUpdate).toLocaleTimeString('zh-CN', { hour12: !1 })}` : ''}。上一轮填表还没完成就发送时，这一轮用的是旧表，线索会晚一轮生效。</p>
        ${last ? `<p class="pi-hint">上次实际注入：${new Date(last.at).toLocaleTimeString('zh-CN', { hour12: !1 })} · ${last.chars} 字${last.focus ? ` · 焦点 ${esc(last.focus)}` : ''}${last.stale ? ' · 当时填表未完成' : ''}</p>` : ''}
        </div>
        <div class="pi-card"><h3>节点<span class="pi-meta">点节点看条件，「⋯」人工维护</span><span class="pi-spacer"></span>
            <button type="button" class="pi-btn is-sm is-ghost" data-act="rewrite" title="按已发生的剧情和线索进度，让 AI 改写未结束的阶段；结果先进草稿，不会直接覆盖">改写后续</button></h3>
        <div class="pi-pace"><span class="pi-pace-label">推进速度</span><div class="pi-seg">${PACES.map((pace) => `<button type="button" class="pi-seg-btn${pace.value === runtime.progress().pace ? ' is-sel' : ''}" data-act="pace" data-pace="${pace.value}">${pace.label}</button>`).join('')}</div></div>
        ${groups.join('') || '<p class="pi-hint">大纲为空。</p>'}</div>
        ${clueLogCard(runtime)}`;
}

export function clueLogCard(runtime) {
    let prog = runtime.progress(),
        ops = normalizeClueOps(prog.clue).ops.slice(-12).reverse(),
        chat = chatMessages();
    return ops.length
        ? `<div class="pi-card"><h3>人工操作记录</h3>${ops.map((op) => `<p class="pi-hint${anchorValid(op.at, chat) ? '' : ' is-off'}">${new Date(op.time).toLocaleString('zh-CN', { hour12: !1 })} · ${esc(op.kind)} ${esc(op.target)} ${esc(String(op.value))}${op.note ? `（${esc(op.note)}）` : ''}${anchorValid(op.at, chat) ? '' : ' · 所在楼层已回退，未生效'}</p>`).join('')}</div>`
        : '';
}

export function factRowsHtml(facts, prefix, volumes) {
    let ctx = new Map(
        factLabelContext(
            volumes,
            facts.map((f) => f.code),
        ).map((x) => [x.code, x]),
    );
    let row = (f, i) => {
        let c = ctx.get(f.code) || {},
            where = [c.stage, c.nodeName].filter(Boolean).join(' · ');
        return `<div class="pi-prebuild-row" data-fr-row="${i}">
          <div class="pi-fr-hd"><b>${esc(where || f.code)}</b><span class="pi-meta">${esc(f.code)}</span>${f.orphan || c.orphan ? '<span class="pi-badge is-warn">大纲里没有节点产出它</span>' : ''}</div>
          ${c.answer ? `<p class="pi-fr-answer">这条线索查到的是：${esc(c.answer)}<span class="pi-meta">（只给你看，不会写进表格）</span></p>` : ''}
          <label class="pi-field"><span>标签：给它起个不透露答案的名字</span><input class="pi-inp" data-${prefix}-label="${i}" value=""></label>
          <label class="pi-field"><span>正文写到哪一步，才算主角拿到了它</span><textarea class="pi-ta" rows="2" data-${prefix}-crit="${i}"></textarea></label>
          <div class="pi-fr-warn" data-fr-warn="${i}"></div></div>`;
    };
    return `<div class="pi-fr" data-fr="${prefix}">
          <div class="pi-fr-intro"><p><b>这一步在做什么</b></p>
          <p>每轮正文写完后，数据库的填表模型会对照这里的说明，判断主角有没有拿到某条线索；拿到了，后面的剧情才会开放。</p>
          <p>所以每条线索要两样东西：一个<b>标签</b>，让填表模型认出是哪一条；一句<b>「写到哪一步才算拿到」</b>。这句写得太宽，主角还没真正查到就会被算作拿到，剧情会提前推进。</p>
          <p>这两样每一轮都会发给填表模型，所以<b>不能写出答案</b>：写「打开抽屉、读到单据时」，不写单据上写了什么。</p>
          <p class="is-example">例　标签：抽屉里的单据　｜　写到哪一步：主角打开抽屉、读到单据内容时算拿到；只看到锁着的抽屉不算</p></div>
          <div class="pi-tools is-c1"><button type="button" class="pi-btn is-sm" data-fr-auto>自动填写</button></div>
          <p class="pi-hint" data-fr-status>建议先点「自动填写」，由 AI 按大纲写好，你只需要检查标黄的地方。也可以自己填。</p>
          ${facts.map(row).join('')}</div>`;
}

export function mountFactRows(view, root, facts, prefix, volumes) {
    let box = root.querySelector(`[data-fr="${prefix}"]`);
    if (!box) return;
    // 保密名字：本项目导入任务里标了「名字保密」的人。任务文件按 id 读进来（第五轮审阅 3a：原来只看已在内存里的任务，
    // 刷新后没打开过导入页就是空名单）。读不到的任务明说「没核对」；手写的大纲没有导入任务，就只查答案重合。
    let project = view.project(),
        ids = project && Array.isArray(project.imports) ? project.imports : [],
        secrets = [],
        secretsNote = '';
    let ctx = new Map(
            factLabelContext(
                volumes,
                facts.map((f) => f.code),
            ).map((x) => [x.code, x]),
        ),
        unsure = /* @__PURE__ */ new Map();
    let field = (i, k) => box.querySelector(`[data-${prefix}-${k}="${i}"]`),
        status = box.querySelector('[data-fr-status]');
    let secretsReady = Promise.all(
        ids.map((id) =>
            view.data.imports.get(id) ? Promise.resolve(view.data.imports.get(id)) : view.data.imports.load(id).catch(() => null),
        ),
    ).then((jobs) => {
        let missing = jobs.filter((j) => !j).length;
        secrets = [...new Set(jobs.filter(Boolean).flatMap((j) => importSecretNames(j.index) || []))];
        secretsNote = missing ? `有 ${missing} 份导入记录读不到，这次没有核对其中的保密名字。` : '';
        secretsNote && (status.textContent = `${status.textContent} ${secretsNote}`);
        facts.forEach((_, i) => (field(i, 'label').value.trim() || field(i, 'crit').value.trim()) && check(i));
    });
    let check = (i) => {
        let f = facts[i],
            w = factLabelWarnings(
                { label: field(i, 'label').value.trim(), criterion: field(i, 'crit').value.trim(), unsure: unsure.get(f.code) || '' },
                ctx.get(f.code) || {},
                { secrets },
            ),
            out = box.querySelector(`[data-fr-warn="${i}"]`);
        return (
            (out.innerHTML = w.map((x) => `<p class="pi-warn-line">${esc(x)}</p>`).join('')),
            box.querySelector(`[data-fr-row="${i}"]`).classList.toggle('is-warn', w.length > 0),
            w.length
        );
    };
    box.addEventListener('input', (event) => {
        let m = event.target.closest('[data-fr-row]');
        m && (unsure.delete(facts[Number(m.dataset.frRow)].code), check(Number(m.dataset.frRow)));
    });
    box.querySelector('[data-fr-auto]').addEventListener('click', async (event) => {
        let btn = event.currentTarget,
            todo = facts.map((f, i) => ({ f, i })).filter(({ i }) => !field(i, 'label').value.trim() || !field(i, 'crit').value.trim());
        if (!todo.length) return (status.textContent = '都已经填好了。要重新生成，先清空对应的框。');
        ((btn.disabled = !0), (status.innerHTML = '<span class="pi-spin"></span> 正在生成…'));
        try {
            await secretsReady;
            let items = todo.map(({ f }) => ctx.get(f.code) || { code: f.code, usedBy: [], orphan: !0 }),
                reply = await ask(view, 'outline', factLabelMessages(items, { secrets })),
                r = parseFactLabels(
                    reply,
                    items.map((x) => x.code),
                );
            for (let { f, i } of todo) {
                let got = r.items.get(f.code);
                if (!got) continue;
                (field(i, 'label').value.trim() || (field(i, 'label').value = got.label),
                    field(i, 'crit').value.trim() || (field(i, 'crit').value = got.criterion),
                    got.unsure && unsure.set(f.code, got.unsure));
            }
            let warned = facts.reduce((n, _, i) => n + (check(i) ? 1 : 0), 0);
            status.textContent = `${secretsNote}已填好 ${todo.length - r.missing.length} 条${r.missing.length ? `，${r.missing.length} 条没生成（${r.missing.join('、')}），可以再点一次或自己填` : ''}。${warned ? `${warned} 条标黄：黄字说明了原因，照着改一下框里的字就行，改完黄色会消失。觉得没问题也可以不改，标黄不会挡住导入。` : '没有发现问题，可以直接确认。'}`;
        } catch (error) {
            status.textContent = `生成失败：${error.message}。可以再试一次，或者自己填。`;
        } finally {
            btn.disabled = !1;
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
        if (!project || (project.clue && project.clue.mode === mode)) return;
        if (
            mode === 'clue' &&
            !(await confirmDialog({
                title: '切换到线索推进',
                body: '线索推进按主角实际查到了什么来推进：数据库填表时记下拿到的线索，插件据此开放下一步。不再用 AI 判断「这一阶段演完了没有」，也不再一次把整个阶段交给正文。',
                list: [
                    '大纲推进的进度会保留，切回来就恢复。',
                    '大纲要写「发现」和「完成条件」，节点才会自动完成；没写的只能在执行页手动标记。',
                    '切换后，到执行页点「生成线索模板」，给这个聊天加上记录线索的表格。',
                ],
                okLabel: '切换',
            }))
        )
            return;
        (view.runtime.bumpEpoch(),
            view.data.updateProject(view.projectId, (p) => ({ ...p, clue: normalizeClue({ ...p.clue, mode }) })),
            view.runtime.clue.invalidate(),
            view.runtime.refresh(),
            view.renderBody());
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
            if (!isPlainObject(value)) throw new Error('应是 switch / facts / knowledge / scene / time 的映射');
            (view.data.updateProject(view.projectId, (p) => ({ ...p, clue: normalizeClue({ ...p.clue, bindings: value }) })),
                view.runtime.clue.invalidate(),
                (view.tabState('run').bindOpen = !1),
                view.renderBody());
        } catch (error) {
            ((status.textContent = error.message), status.classList.add('is-err'));
        }
    },
    'clue-refresh'(view) {
        (view.runtime.clue.invalidate(), view.renderBody());
    },
    'clue-node-open'(view, target, event) {
        if (event.target.closest('button')) return;
        let st7 = view.tabState('run');
        ((st7.nodeOpen = st7.nodeOpen === target.dataset.uid ? '' : target.dataset.uid), view.renderBody());
    },
    'clue-pause'(view, target) {
        let on = !!target.dataset.value;
        (view.runtime.clue.setPaused(on),
            toast('success', on ? '主线已暂停：之后的回复不再注入线索内容。' : '主线已继续。'),
            view.renderBody());
    },
    // 开始下一段主线：去大纲页写新一卷；写好后回到这里补预建行、更新场景编号对照。
    async 'clue-next'(view) {
        let ok = await confirmDialog({
            title: '开始下一段主线',
            body: '下一段主线写成新的一卷，放在现有大纲后面。当前一卷全部结束后，新卷第一阶段会自动开始。',
            list: [
                '1. 到大纲页用「AI 写第 N 卷」或自己写新一卷（会附上已用过的编号，避免撞号）',
                '2. 回到执行页，在「表格绑定」里点「按大纲补预建行…」，给新事实建行',
                '3. 点「场景编号对照…」，把新场景的对照更新到线索控制表说明里',
                '写新卷期间想先玩日常，可以先暂停主线',
            ],
            okLabel: '去写新一卷',
        });
        ok && view.switchTab && view.switchTab('outline');
    },
    'clue-unfocus'(view) {
        (view.runtime.clue.setFocus(''), view.renderBody());
    },
    // 按大纲补预建行：预览 → 作者逐条确认标签和登记口径 → 通过官方 insertRow 只插入缺的行（已有行不动，不覆盖已演进度）。
    // W1：点击时记下聊天 / 项目 / 模式，确认后按当前表重新算缺哪些行，每插入一行前核对一次，变了就停下并说明已写入哪些。
    // 登记口径不直接拿「记录」预填（GPT §14.2-3，记录常含答案）：作者自己写，或点「自动填写」由模型参考记录写出不含答案的版本，插件再检查。
    async 'clue-prebuild'(view) {
        let c = view.runtime.clue.compute(),
            project = view.project(),
            api = acuApi();
        if (!c || !c.snap.api || !api || typeof api.insertRow != 'function')
            return toast('warning', '没有检测到数据库插件，无法写入预建行。');
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
                `预建行已经齐全（已有 ${diff.kept.length} 个事实）。${diff.stale.length ? `表里有大纲已不再使用的编号：${diff.stale.join('、')}，不会自动删除。` : ''}`,
            );
        // 白话开头说清这一步做什么；写入时的各种核对细节收进折叠。
        let html = `<div class="pi-fr-intro"><p>大纲里新增了线索，但<b>当前聊天</b>的线索表里还没有它们。这一步把缺的补上，已有的行一律不动，不影响已经玩到的进度。</p></div>
          ${diff.stale.length ? `<p class="pi-hint is-warn">表里有大纲已不再使用的编号：${esc(diff.stale.join('、'))}（不会删除）</p>` : ''}
          <details class="pi-fr-more"><summary class="pi-hint">写入细节</summary>
          <p class="pi-hint">目标聊天：${esc(scope.chatLabel || '当前聊天')}</p>
          ${diff.newKnows.length && diff.knowTable ? `<p class="pi-hint">「${esc(diff.knowTable)}」新增 ${diff.newKnows.length} 行：${esc(diff.newKnows.map((k) => k.key).join('、'))}</p>` : ''}
          ${diff.kept.length ? `<p class="pi-hint">已有、不改动：${esc(diff.kept.join('、'))}</p>` : ''}
          <p class="pi-hint">确认时会再核对一次：聊天、项目、目标表的结构，以及现在已有的行（编号和标签）都要不变，否则不写入；这期间填表新加的行不影响。同一聊天里两份内容完全相同的数据库分支无法区分，切换分支后请重新打开这个窗口。补的行写在当前这一楼上：之后几楼内对线索表做「手动填表」重填，可能会清掉它们，补完请检查一次。</p></details>
          ${diff.newFacts.length ? `<h4 class="pi-fr-title">要补的线索：${diff.newFacts.length} 条</h4>${factRowsHtml(diff.newFacts, 'pb', project.outline.volumes)}` : ''}`;
        let picked = await openDialog({
            title: '按大纲补预建行',
            html,
            onMount: (root) => mountFactRows(view, root, diff.newFacts, 'pb', project.outline.volumes),
            actions: [
                { label: '取消', value: null },
                {
                    label: '写入',
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
        if (!prebuildScopeValid(view, scope))
            return toast('warning', '确认期间切换了聊天、项目或推进方式，没有写入。请回到原聊天重新操作。');
        // 确认后按当前表重新算，只写「预览时作者看过、并且现在仍然缺」的行（15.2-3）；新出现的缺项留给下一次预览。
        // 预览时已有的行，现在却不见了：说明目标表换了（同一聊天切了数据库隔离分支、或表被重置），整次放弃，不往新目标里写。
        let now = view.runtime.clue.compute(),
            fresh = prebuildDiff(plan, now.snap, project.clue.bindings),
            labels = new Map(picked.map((f) => [f.code, f])),
            previewKnows = new Set(diff.newKnows.map((k) => k.key));
        let vanished = diff.kept.filter((code) => !(now.snap.facts && now.snap.facts.has(code)));
        if (vanished.length)
            return toast(
                'warning',
                `确认期间数据库表格变了（预览时已有的 ${vanished.join('、')} 现在不见了，可能切换了数据库隔离分支），没有写入。请在要写入的表格上重新点一次。`,
            );
        if (!prebuildTargetSame(targetPrint, prebuildTargetPrint(now.snap.tables, project.clue.bindings)))
            return toast(
                'warning',
                '确认期间目标表格的结构或已有行变了（可能切换了数据库隔离分支，或者填表改了这些行），没有写入。请重新打开「按大纲补预建行」，按现在的表格再确认一次。',
            );
        let want = fresh.newFacts.map((f) => f.code).filter((code) => labels.has(code)),
            knowsToWrite = fresh.newKnows.filter((k) => previewKnows.has(k.key));
        let fb = project.clue.bindings.facts[0],
            kb = project.clue.bindings.knowledge[0],
            done = [],
            failed = [],
            factOk = new Set(now.snap.facts ? now.snap.facts.keys() : []),
            stopped = '';
        for (let code of want) {
            if (!prebuildScopeValid(view, scope)) {
                stopped = '写入过程中切换了聊天';
                break;
            }
            let f = labels.get(code),
                data = { [fb.编号列]: code, 标签: f.label, 登记口径: f.criterion };
            fb.状态列 && (data[fb.状态列] = '未获得');
            let r = await api.insertRow({ tableName: fb.表, data, skipNotify: !0 }).catch(() => -1);
            r >= 0 ? (done.push(code), factOk.add(code)) : failed.push(code);
        }
        // 知情行只给已存在、或这次写成功的事实建；事实写失败就不建它的知情行。
        if (kb && !stopped)
            for (let k of knowsToWrite) {
                if (!factOk.has(k.fact)) continue;
                if (!prebuildScopeValid(view, scope)) {
                    stopped = '写入过程中切换了聊天';
                    break;
                }
                let data = { 键: k.key, [kb.事实列]: k.fact, [kb.角色列]: k.actor };
                kb.方式列 && (data[kb.方式列] = Array.isArray(kb.未知值) ? kb.未知值[0] : kb.未知值 || '未知');
                kb.可信度列 && (data[kb.可信度列] = '未核实');
                let r = await api.insertRow({ tableName: kb.表, data, skipNotify: !0 }).catch(() => -1);
                r >= 0 ? done.push(k.key) : failed.push(k.key);
            }
        (view.runtime.clue.invalidate(), view.renderBody());
        let msg = `已写入 ${done.length} 行${done.length ? `（${done.slice(0, 8).join('、')}${done.length > 8 ? '……' : ''}）` : ''}`;
        stopped
            ? toast('warning', `${msg}。${stopped}，后面的行没有写；回到原聊天再点一次，会只补剩下的。`)
            : failed.length
              ? toast(
                    'error',
                    `${msg}；${failed.length} 行失败：${failed.slice(0, 6).join('、')}。当前聊天至少要有一楼 AI 回复，数据库才能保存表格；失败事实的知情行也没有写。`,
                )
              : toast('success', `${msg}。`);
    },
    // 场景编号对照：只有编号、入口、地点（和正文看到的入口同级）；作者粘贴进线索控制表的说明（官方填表只展开目标表，放在控制表自己的说明里才看得到）。
    // 生成线索模板（GPT §17.2）：读当前聊天的真实模板 → 和运行表交叉核对 → 合成 → 预览 → 明确用 seed 导入当前聊天
    // → 重新读表核对 → 成功才写绑定。已有线索表时不在模板里追加行（官方 seed 不会落进非空表），新事实用「按大纲补预建行」。
    async 'clue-gen-template'(view) {
        let api = acuApi(),
            project = view.project(),
            c = view.runtime.clue.compute();
        if (!api || typeof api.getTableTemplate != 'function' || typeof api.importTemplateFromData != 'function')
            return toast('warning', '没有检测到数据库的模板接口（需要官方 SP·数据库 8.9 以上），无法生成。');
        if (!cardKey()) return toast('warning', '请先打开要使用的聊天。');
        let scope = prebuildScope(view),
            base = null;
        try {
            base = api.getTableTemplate({ scope: 'chat' });
        } catch {}
        if (!isPlainObject(base) || !Object.keys(base).some((k) => k.startsWith('sheet_')))
            return toast('warning', '读不到当前聊天的表格模板，没有生成。请先在数据库里确认这个聊天有表格。');
        // 模板接口取不到聊天模板时可能退回全局模板，结果不带来源：用运行中的表名交叉核对，对不上就不写。
        // 两个方向都核对（R6）：运行中有、模板里没有的表，导入后会被数据库隐藏。
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
            hasFacts = tplNames.includes('关键事实表');
        let preview = synthesizeClueTemplate(base, { clue: { scenes: plan.scenes } });
        if (preview.blocked.length)
            return toast(
                'warning',
                `模板里有不止一张「${preview.blocked.join('」「')}」，无法确定该用哪一张。没有生成；请先在数据库里删掉或改名多余的表。`,
            );
        // 先用一段白话说清这一步做什么；具体改了哪些规则收进折叠（作者想看再展开）。需要注意的问题始终显示。
        let html = `<div class="pi-fr-intro"><p>给<b>当前这个聊天</b>的数据库加上线索推进要用的三张表，用来记录主角查到了什么、谁知道了什么、现在在哪个场景。</p>
          <p>原有的表和数据都会保留，不会删除任何东西，也不影响别的聊天。</p></div>
          ${preview.problems.length ? `<p class="pi-hint is-warn"><b>需要你注意：</b></p><ul>${preview.problems.map((x) => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
          <details class="pi-fr-more"><summary class="pi-hint">具体会改哪些地方（${preview.changes.length} 处）</summary><p class="pi-hint">目标聊天：${esc(scope.chatLabel || '当前聊天')}</p><ul>${preview.changes.map((x) => `<li>${esc(x)}</li>`).join('') || '<li>没有需要改动的地方</li>'}</ul></details>
          ${hasFacts ? '<p class="pi-hint">这个聊天已经有关键事实表，不在模板里追加行。新线索请在导入后用「按大纲补预建行」。</p>' : plan.facts.length ? `<h4 class="pi-fr-title">这份大纲里有 ${plan.facts.length} 条要追踪的线索</h4>${factRowsHtml(plan.facts, 'gt', project.outline.volumes)}` : '<p class="pi-hint">大纲里还没有线索编号，线索表先建成空表。</p>'}`;
        let picked = await openDialog({
            title: '生成线索模板',
            html,
            onMount: (root) => hasFacts || mountFactRows(view, root, plan.facts, 'gt', project.outline.volumes),
            actions: [
                { label: '取消', value: null },
                {
                    label: '导入到当前聊天',
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
        // 确认后重新读模板：期间模板被别处改过就停下，按现在的模板重新预览。
        let again = null;
        try {
            again = api.getTableTemplate({ scope: 'chat' });
        } catch {}
        if (JSON.stringify(again) !== JSON.stringify(base))
            return toast('warning', '确认期间这个聊天的表格模板变了，没有导入。请重新点「生成线索模板」。');
        // 运行中的表也重读一次核对（期间可能填表新增了表或列）。
        view.runtime.clue.invalidate();
        let liveNow = view.runtime.clue.compute(),
            again2 = clueTplMismatch(base, (liveNow && liveNow.snap.tables) || {});
        if (again2.length) return toast('warning', `确认期间当前聊天的表格变了，没有导入：${again2[0]}。请重新点「生成线索模板」。`);
        let gen = synthesizeClueTemplate(base, {
            clue: hasFacts
                ? { scenes: plan.scenes }
                : { controlRow: ['主线', ''], factRows: picked, knowRows: plan.knows, scenes: plan.scenes },
        });
        let res = null;
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
            view.runtime.clue.invalidate());
        let after = view.runtime.clue.compute(),
            names = new Set(
                Object.values((after && after.snap.tables) || {})
                    .filter((x) => x && x.name)
                    .map((x) => x.name),
            ),
            lost = ['线索控制表', '关键事实表', '知情表'].filter((n) => !names.has(n));
        // 导入前就有的表和列都应当还在（R6）：缺了就明说，不报成功。
        let afterTables = (after && after.snap.tables) || {},
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
        view.renderBody();
        if (gone.length)
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
                    `已导入。${gen.changes.length} 处改动${gen.problems.length ? `，${gen.problems.length} 处需要注意（见预览）` : ''}。插件绑定已更新。`,
                );
    },
    async 'clue-catalog'(view) {
        let plan = prebuildPlan(view.project().outline.volumes),
            text = plan.scenes.length
                ? [
                      '【场景编号对照】（只用于对号；不表示已经开放或已经发生）',
                      ...plan.scenes.map((s) => `- ${s.uid}：${[s.entry, s.place && `地点：${s.place}`].filter(Boolean).join('；')}`),
                  ].join('\n')
                : '';
        if (!text) return toast('info', '大纲里没有带入口的节点。');
        await openDialog({
            title: '场景编号对照',
            html: `<p class="pi-hint">复制下面的文字，粘贴到数据库「线索控制表」说明（note）的末尾。只包含入口和地点，不含发现。长主线建议只放当前几个阶段的节点。</p><textarea class="pi-ta is-mono is-tall" readonly>${esc(text)}</textarea>`,
            actions: [{ label: '关闭', value: !0, primary: !0 }],
        });
    },
    'clue-leave'(view, target) {
        (view.runtime.clue.leaveScene(target.dataset.uid), view.renderBody());
    },
    async 'clue-node-menu'(view, target) {
        let clue = view.runtime.clue,
            c = clue.compute(),
            uid = target.dataset.uid,
            s = c && c.state.nodeStates.find((x) => x.node.uid === uid);
        if (!s) return;
        let over = c.prog.overrides[uid] || {},
            items = [
                ...(s.status === 'available' && c.state.focus.uid !== uid ? [{ label: '设为本轮焦点', value: 'focus' }] : []),
                ...(c.state.focus.uid === uid ? [{ label: '离开这个调查（只给入口）', value: 'leave' }] : []),
                ...(s.status === 'locked' && !s.manualOpen ? [{ label: '人工开放（不授予任何事实）', value: 'open:force' }] : []),
                ...(over.open
                    ? [{ label: over.open === 'force' ? '撤销人工开放' : '解除暂禁', value: 'open:' }]
                    : [{ label: '暂禁此节点', value: 'open:block' }]),
                ...(s.status !== 'done'
                    ? [{ label: '人工标记完成', value: 'done:force' }]
                    : over.done !== 'force'
                      ? [{ label: '撤销完成（覆盖表格判断）', value: 'done:undo' }]
                      : []),
                ...(over.done ? [{ label: '恢复程序判断完成', value: 'done:' }] : []),
                ...(s.node.required
                    ? [{ label: over.skip ? '取消跳过' : '跳过（不阻塞阶段，不算完成）', value: over.skip ? 'skip:' : 'skip:true' }]
                    : []),
                { label: '确认 / 撤销事实…', value: 'fact' },
            ],
            pick = await menuDialog({ title: s.node.name, items });
        if (!pick) return;
        if (pick === 'focus') return (clue.setFocus(uid), view.renderBody());
        if (pick === 'leave') return (clue.leaveScene(uid), view.renderBody());
        if (pick === 'fact') return factDialog(view, s);
        let [kind, value] = pick.split(':'),
            note =
                (kind === 'open' && value === 'force') || (kind === 'done' && value === 'force')
                    ? await promptDialog({ title: '记录原因（可空）', label: '为什么人工处理' })
                    : '';
        note !== null && (clue.act({ kind, target: uid, value: value === 'true' ? !0 : value, note }), view.renderBody());
    },
};

export async function factDialog(view, s) {
    let refs = nodeFactRefs(s.node),
        id = await promptDialog({
            title: '事实编号',
            label: refs.length ? `本节点涉及：${refs.join('、')}` : '填写事实编号',
            value: refs[0] || '',
        });
    if (!id || !id.trim()) return;
    let pick = await menuDialog({
        title: `事实 ${id.trim()}`,
        items: [
            { label: '人工确认（表格未记录时使用）', value: 'confirmed' },
            { label: '人工撤销（表格记录有误时使用）', value: 'revoked' },
            { label: '恢复按表格判断', value: '' },
        ],
    });
    if (pick === null) return;
    let note = await promptDialog({ title: '记录原因', label: '依据 / 来源（建议填写）' });
    note !== null && (view.runtime.clue.act({ kind: 'fact', target: id.trim(), value: pick, note }), view.renderBody());
}

export function clueOnChange(view, target) {
    if (target.dataset.clueWaitfill !== void 0)
        return (
            view.data.updateProject(view.projectId, (p) => ({ ...p, clue: normalizeClue({ ...p.clue, waitFill: target.checked }) })),
            view.renderBody(),
            !0
        );
    return !1;
}
