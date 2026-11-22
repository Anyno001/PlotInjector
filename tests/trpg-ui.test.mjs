// 跑团模组导入（发布包 + 模拟酒馆）：勾选「跑团模组」后，逐段整理的请求带判定规则、项目记为跑团、后台整理出「KP规则」设定分块；
// 不勾时请求里没有任何跑团文字、项目没有 trpg 键。样本自造。
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';

const tick = () => new Promise((r) => setTimeout(r, 20));
const SRC = ['# 别墅', '## 第一章 后厨', '后厨里的人在往食物里喷液体。成功的聆听可以听见门后的呻吟。', '## 附录', '每半小时进行体质检定，失败则临界值+1。'].join('\n\n');
const INDEX_REPLY = '```yaml\n梗概: x\n人物:\n  - {名称: 厨师长, 公开身份: 厨师}\n事实:\n  - {编号: F_a, 内容: 液体, 性质: 实物}\n```';
const DRAFT = ['```yaml', '剧情_卷1_别墅:', '  阶段1_后厨:', '    主线节点:', '      - id: n1', '        名称: 后厨', '        入口: 去后厨看看', '        发现: [{事实: F1, 内容: 有人在喷液体, 判定: {技能: 侦查}}]', '        完成条件: {事实: F1}', '```'].join('\n');
const KP_REPLY = '机制与计量:\n- 每半小时体质检定，失败临界值+1';

async function boot({ trpg = !1 } = {}) {
    const host = createHost({ tables: {} });
    const inst = host.load();
    await inst.ready;
    const p = await inst.data.createProject('别墅');
    inst.data.updateProject(p.id, (x) => ({ ...x, clue: { mode: 'clue', bindings: { facts: [], knowledge: [] } }, ...(trpg ? { trpg: { on: true } } : {}) }));
    await inst.runtime.switchProject(p.id);
    await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
    await host.settle();
    inst.open();
    await tick();
    const doc = host.w.document;
    const click = async (sel) => {
        const el = doc.querySelector(sel);
        assert.ok(el, `missing ${sel}`);
        el.click();
        await tick();
    };
    await click(`[data-act="project"][data-id="${p.id}"]`);
    await click('[data-act="tab"][data-tab="outline"]');
    const bodies = [];
    host.llm.reply = undefined;
    host.llm.respond = (body) => {
        bodies.push(body);
        if (/整理作者索引/.test(body)) return INDEX_REPLY;
        if (/为 AI 主持人（KP）整理/.test(body)) return KP_REPLY;
        if (/你在审稿/.test(body)) return '【页1】\n- n1 的发现缺少失败时怎么办（建议：补「失败」）';
        return DRAFT;
    };
    return { host, inst, doc, click, pid: p.id, bodies };
}

async function runImport(env) {
    const { doc, click } = env;
    await click('[data-act="import-open-panel"]');
    doc.querySelector('[data-imp-text]').value = SRC;
    await click('[data-act="import-start"]');
    for (let i = 0; i < 60 && !doc.querySelector('[data-act="import-adopt"]'); i++) await tick();
    for (let i = 0; i < 20; i++) await tick();
}

test('跑团模组导入：请求带判定规则，项目记为跑团，设定里多出 KP规则 分块', async () => {
    const env = await boot({ trpg: !0 });
    assert.ok(env.doc.body.textContent.length);
    await env.click('[data-act="import-open-panel"]');
    const box0 = env.doc.querySelector('[data-imp-trpg]');
    assert.ok(box0 && box0.checked, '跑团项目的导入页有勾选框，默认勾上');
    assert.match(env.doc.querySelector('[data-imp-text]').getAttribute('placeholder'), /pdf/);
    await env.click('[data-act="import-close"]');
    await runImport(env);
    const drafts = env.bodies.filter((b) => /转写成可以游玩的大纲/.test(b));
    assert.ok(drafts.length >= 1);
    assert.ok(drafts.every((b) => b.includes('跑团模组（CoC 7 版）附加规则')));
    const project = env.inst.data.project(env.pid);
    assert.equal(JSON.stringify(project.trpg), JSON.stringify({ on: true, rule: 'coc7' }));
    assert.match(project.setting.text, /^KP规则:\n（KP 资料/);
    assert.match(project.setting.text, /【机制与计量】\n- 每半小时体质检定/);
    // 审阅页有「AI 检查」，查出的问题进意见框
    const btn = env.doc.querySelector('[data-act="rv-ai-check"]');
    assert.ok(btn, '跑团导入的审阅页有 AI 检查');
    btn.click();
    for (let i = 0; i < 20; i++) await tick();
    const check = env.bodies.find((b) => /你在审稿/.test(b));
    assert.ok(check && check.includes('每半小时进行体质检定'), '检查请求带模组原文');
    const note = env.doc.querySelector('[data-rv-comment]');
    assert.match(note.value, /AI 检查：n1 的发现缺少失败时怎么办/);
    // 再打开导入页，跑团项目默认勾上
    await env.click('[data-act="import-close"]');
    await env.click('[data-act="import-open-panel"]');
    const box = env.doc.querySelector('[data-imp-trpg]');
    assert.ok(box && box.checked);
});

test('普通线索项目：导入页看不到跑团勾选和 pdf，请求里没有跑团文字，项目没有 trpg 键', async () => {
    const env = await boot();
    await env.click('[data-act="import-open-panel"]');
    assert.equal(env.doc.querySelector('[data-imp-trpg]'), null);
    assert.ok(!/pdf/.test(env.doc.querySelector('[data-imp-text]').getAttribute('placeholder')));
    await env.click('[data-act="import-close"]');
    await runImport(env);
    assert.ok(env.bodies.length >= 2);
    assert.ok(env.bodies.every((b) => !b.includes('跑团模组') && !/为 AI 主持人（KP）整理/.test(b)));
    const project = env.inst.data.project(env.pid);
    assert.ok(!('trpg' in project));
    assert.equal(env.doc.querySelector('[data-act="rv-ai-check"]'), null, '普通导入的审阅页没有 AI 检查');
    assert.ok(!project.setting.text.includes('KP规则'));
});

test('实验功能：关着时新建项目弹窗没有跑团一行；打开后勾选新建即为跑团线索项目', async () => {
    const env = await boot();
    const { doc, inst } = env;
    const openNew = async () => {
        const btn = doc.querySelector('[data-act="new-project"]');
        assert.ok(btn, 'missing new-project button');
        btn.click();
        await tick();
    };
    await openNew();
    assert.ok(doc.querySelector('[data-f="name"]'), 'dialog open');
    assert.equal(doc.querySelector('[data-f="trpg"]'), null);
    [...doc.querySelectorAll('button')].find((b) => b.textContent === '取消').click();
    await tick();
    inst.data.updateSettings({ trpgLab: true });
    await openNew();
    const box = doc.querySelector('[data-f="trpg"]');
    assert.ok(box);
    box.checked = true;
    doc.querySelector('[data-f="name"]').value = '跑团测试';
    [...doc.querySelectorAll('button')].find((b) => b.textContent === '确定').click();
    for (let i = 0; i < 10; i++) await tick();
    const meta = inst.data.index().projects.find((p) => p.name === '跑团测试');
    assert.ok(meta);
    const project = inst.data.project(meta.id);
    assert.equal(JSON.stringify(project.trpg), JSON.stringify({ on: true, rule: 'coc7' }));
    assert.equal(project.clue.mode, 'clue');
});
