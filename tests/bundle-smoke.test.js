import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import YAML from 'yaml';

// 用假的酒馆环境执行真实发布文件 dist/plot-injector.js：启动、注入、报信、检测、各页签渲染。
const root = path.resolve(import.meta.dirname, '..');
const bundle = fs.readFileSync(path.join(root, 'dist/plot-injector.js'), 'utf8');
const OUTLINE = `剧情_卷一_测试:
  阶段一_开端:
    时间范围: 开始时
    AI指令: 推进开端。
    主线节点:
      - 名称: 甲事件
        地点: 甲地
        事件: 甲发生。
        偏转: 无。
  阶段二_发展:
    时间范围: 开端之后
    主线节点:
      - 名称: 乙事件
        地点: 乙地
        事件: 乙发生。
        偏转: 无。
`;

function makeHost() {
    const dom = new JSDOM('<!doctype html><html><head></head><body><div id="chat"></div></body></html>', { url: 'http://localhost:8000/', pretendToBeVisual: true, runScripts: 'outside-only' });
    const win = dom.window;
    const files = new Map();
    const listeners = new Map();
    const llmCalls = [];
    const eventSource = {
        on(name, fn) { if (!listeners.has(name)) listeners.set(name, []); listeners.get(name).push(fn); },
        removeListener(name, fn) { listeners.set(name, (listeners.get(name) || []).filter(item => item !== fn)); },
        async emit(name, ...args) { for (const fn of listeners.get(name) || []) await fn(...args); },
    };
    const context = {
        chat: [],
        characters: [{ name: '测试卡', avatar: 'test.png', data: { extensions: {} } }],
        characterId: 0,
        groupId: null,
        chatId: 'chat-1',
        chatMetadata: {},
        eventSource,
        eventTypes: { WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded', CHAT_CHANGED: 'chat_id_changed', MESSAGE_RECEIVED: 'message_received', MESSAGE_SWIPED: 'message_swiped', MESSAGE_UPDATED: 'message_updated', MESSAGE_DELETED: 'message_deleted', GENERATION_STARTED: 'generation_started', GENERATION_ENDED: 'generation_ended', GENERATION_STOPPED: 'generation_stopped' },
        getRequestHeaders: () => ({ 'X-CSRF-Token': 't' }),
        getCurrentChatId: () => 'chat-1',
        saveMetadataDebounced() {},
        async saveMetadata() {},
        getWorldInfoNames: () => [],
    };
    win.SillyTavern = { libs: { yaml: YAML }, getContext: () => context };
    win.toastr = { info() {}, success() {}, warning() {}, error(msg) { win.__errors.push(msg); } };
    win.__errors = [];
    win.URL.createObjectURL = () => 'blob:test';
    win.URL.revokeObjectURL = () => {};
    win.TavernHelper = {
        async generateRaw({ ordered_prompts: prompts }) {
            llmCalls.push(prompts);
            if (win.__reply) return win.__reply(prompts);
            return '{"done":["甲事件"],"stageDone":true,"reason":"甲已发生"}';
        },
    };
    let buttonHandler = null;
    win.eventOn = (name, fn) => { buttonHandler = fn; return { stop() {} }; };
    win.getButtonEvent = name => `btn:${name}`;
    const decode = data => Buffer.from(data, 'base64').toString('utf8');
    win.fetch = async (url, init = {}) => {
        const respond = (status, body) => ({ ok: status < 400, status, text: async () => body, json: async () => JSON.parse(body) });
        const u = String(url).split('?')[0];
        if (u.startsWith('/user/files/')) {
            const name = u.slice('/user/files/'.length);
            return files.has(name) ? respond(200, files.get(name)) : respond(404, '');
        }
        const body = init.body ? JSON.parse(init.body) : {};
        if (u === '/api/files/upload') { files.set(body.name, decode(body.data)); return respond(200, '{}'); }
        if (u === '/api/files/delete') { const name = body.path.replace('user/files/', ''); const had = files.delete(name); return respond(had ? 200 : 404, ''); }
        if (u === '/api/files/verify') return respond(200, JSON.stringify(Object.fromEntries(body.urls.map(item => [item, files.has(item.replace('user/files/', ''))]))));
        if (u === '/api/backends/chat-completions/status') return respond(200, JSON.stringify({ data: [{ id: 'model-b' }, { id: 'model-a' }] }));
        return respond(404, '');
    };
    return { win, context, files, eventSource, llmCalls, click: () => buttonHandler() };
}

const tick = (ms = 0) => new Promise(resolve => setTimeout(resolve, ms));

async function boot() {
    const host = makeHost();
    host.win.eval(bundle);
    const instance = host.win.__plotInjector;
    await instance.ready;
    return { ...host, instance };
}

async function withProject(host) {
    const { instance } = host;
    const project = await instance.data.createProject('龙宫线');
    const volumes = (await import('../src/core/outline.js')).parseOutlineText;
    const yamlMod = await import('../src/core/yaml.js');
    yamlMod.setYamlLib(YAML);
    instance.data.saveProject({ ...project, setting: { ...project.setting, text: '世界观声明:\n基于: 测试' }, outline: { ...project.outline, volumes: volumes(OUTLINE) } });
    await instance.runtime.switchProject(project.id);
    return project;
}

async function entriesNow(eventSource) {
    const payload = { globalLore: [], characterLore: [], chatLore: [], personaLore: [] };
    await eventSource.emit('worldinfo_entries_loaded', payload);
    return payload.chatLore;
}

test('发布文件启动后，本卡项目的设定和当前阶段详细作为常驻虚拟条目进入世界书管线，剧情索引不注入', async () => {
    const host = await boot();
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await withProject(host);
    const lore = await entriesNow(host.eventSource);
    assert.deepEqual(lore.map(entry => entry.comment), ['剧情注入器·设定', '剧情注入器·卷一·测试·阶段一']);
    assert.ok(lore.every(entry => entry.constant && entry.ignoreBudget && !entry.disable && entry.world === '剧情注入器'));
    assert.deepEqual(lore.map(entry => entry.position), [0, 0], '两条默认都在角色定义前');
    assert.doesNotMatch(lore[1].content, /undefined/);
    assert.match(lore[1].content, /尚未演完的剧情规划/);
    await host.instance.data.flush();
    const index = JSON.parse(host.files.get('pi-index.json'));
    assert.equal(index.projects.length, 1);
    assert.equal(index.active['char:test.png'], index.projects[0].id);
    assert.ok(host.files.has(`pi-p-${index.projects[0].id}.json`));
    assert.deepEqual(Object.keys(host.win.localStorage), []);
    await host.instance.destroy();
    assert.equal((await entriesNow(host.eventSource)).length, 0);
});

test('AI 正文里的 <剧情推进/> 不再触发推进；检测判定演完后询问，点「打开下一段」换详细', async () => {
    const host = await boot();
    await withProject(host);
    host.instance.data.updateSettings({ checkEvery: 99 });
    host.context.chat.push({ is_user: true, mes: '你好' }, { is_user: false, mes: '甲发生了。\n<剧情推进/>' });
    await host.eventSource.emit('message_received', 1, 'normal');
    assert.equal(host.win.document.querySelector('[data-notice="advance"]'), null);
    host.instance.data.updateSettings({ checkEvery: 1 });
    await host.eventSource.emit('message_received', 1, 'normal');
    await tick(10);
    const card = host.win.document.querySelector('[data-notice="advance"]');
    assert.ok(card, '检测判定演完后应弹出询问卡片');
    card.querySelector('[data-act="0"]').click();
    const lore = await entriesNow(host.eventSource);
    assert.match(lore[1].content, /阶段二_发展/);
    assert.ok(lore.every(entry => !/剧情推进/.test(entry.content)));
    const meta = host.context.chatMetadata.plotInjector;
    assert.ok(meta.byProject[meta.projectId].current);
    await host.instance.destroy();
});

test('每 N 楼兜底检测：到点调用检测接口，取消已演节点并提示', async () => {
    const host = await boot();
    await withProject(host);
    host.instance.data.updateSettings({ checkEvery: 2 });
    host.context.chat.push({ is_user: true, mes: '一' }, { is_user: false, mes: '<think>想</think>甲发生了。' });
    await host.eventSource.emit('message_received', 1, 'normal');
    await tick(10);
    assert.equal(host.llmCalls.length, 1);
    assert.doesNotMatch(host.llmCalls[0][1].content, /<think>|想/);
    assert.match(host.llmCalls[0][1].content, /【剧情索引】/);
    assert.ok(host.win.document.querySelector('[data-notice="advance"]'));
    const lore = await entriesNow(host.eventSource);
    assert.doesNotMatch(lore[1].content, /甲事件/);
    await host.instance.destroy();
});

const REWRITE = '```yaml\n剧情_卷一_测试:\n  阶段一_新开端:\n    时间范围: 偏离之后\n    主线节点:\n      - 名称: 丙事件\n        事件: 丙发生。\n```';

test('检测发现偏离大纲时弹提醒；改写后续阶段可填说明，改写后能撤销', async () => {
    const host = await boot();
    const project = await withProject(host);
    host.win.__reply = prompts => (/剧情进度核对员/.test(prompts[0].content)
        ? '{"done":[],"stageDone":true,"offTrack":true,"offReason":"甲已死，乙事件无法发生","reason":"x"}'
        : /剧情大纲已经调整/.test(prompts[0].content) ? '世界观正文：\n世界观声明:\n基于: 测试丙线\n\n速查：PASS。' : REWRITE);
    host.instance.data.updateSettings({ checkEvery: 1 });
    host.context.chat.push({ is_user: true, mes: '一' }, { is_user: false, mes: '甲死了。' });
    await host.eventSource.emit('message_received', 1, 'normal');
    await tick(10);
    const doc = host.win.document;
    const card = doc.querySelector('[data-notice="offtrack"]');
    assert.ok(card, '应弹出偏离提醒');
    assert.match(card.textContent, /甲已死，乙事件无法发生/);
    assert.equal(doc.querySelector('[data-notice="advance"]'), null, '偏离优先于推进');
    card.querySelector('[data-act="0"]').click();
    await tick(10);
    const input = doc.querySelector('.pi-dialog [data-dlg-input]');
    assert.equal(input.value, '甲已死，乙事件无法发生');
    input.value = '甲死了，改成丙线';
    doc.querySelector('.pi-dialog .pi-dlg-acts .is-primary').click();
    await tick(20);
    const rewriteCall = host.llmCalls.find(call => /偏离了大纲/.test(call[0].content));
    assert.match(rewriteCall[1].content, /【偏转说明】\n甲死了，改成丙线/);
    const settingText = () => host.instance.data.project(project.id).setting.text;
    assert.match(settingText(), /测试丙线/, '改写后按新大纲校对设定');
    assert.match(doc.querySelector('[data-notice="offtrack"]').textContent, /设定已同步修改：世界观声明/);
    const stages = () => host.instance.data.project(project.id).outline.volumes[0].stages.map(stage => stage.key).join(',');
    assert.equal(stages(), '阶段一_新开端');
    let lore = await entriesNow(host.eventSource);
    assert.match(lore[1].content, /阶段一_新开端/);
    doc.querySelector('[data-notice="offtrack"] [data-act="0"]').click();
    await tick(10);
    assert.equal(stages(), '阶段一_开端,阶段二_发展');
    assert.doesNotMatch(settingText(), /丙线/, '撤销时设定一起恢复');
    lore = await entriesNow(host.eventSource);
    assert.match(lore[1].content, /阶段一_开端/);
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await host.instance.destroy();
});

test('偏离设为自动改写时不询问直接改写；设为不检查时不提醒', async () => {
    const host = await boot();
    const project = await withProject(host);
    host.win.__reply = prompts => (/剧情进度核对员/.test(prompts[0].content)
        ? '{"done":[],"stageDone":false,"offTrack":true,"offReason":"走向冲突","reason":"x"}'
        : REWRITE);
    host.instance.data.updateSettings({ checkEvery: 1, offTrackMode: 'off' });
    host.context.chat.push({ is_user: true, mes: '一' }, { is_user: false, mes: '正文' });
    await host.eventSource.emit('message_received', 1, 'normal');
    await tick(10);
    assert.equal(host.win.document.querySelector('[data-notice="offtrack"]'), null);
    host.instance.data.updateSettings({ offTrackMode: 'auto' });
    host.context.chat.push({ is_user: true, mes: '二' }, { is_user: false, mes: '正文' });
    await host.eventSource.emit('message_received', 3, 'normal');
    await tick(20);
    assert.equal(host.win.document.querySelector('.pi-dialog'), null, '自动模式不弹输入框');
    assert.equal(host.instance.data.project(project.id).outline.volumes[0].stages.map(stage => stage.key).join(','), '阶段一_新开端');
    assert.match(host.win.document.querySelector('[data-notice="offtrack"]').textContent, /已自动改写/);
    await host.instance.destroy();
});

// 刷新后再启动一份实例：模拟用户刷新酒馆页面。
async function reboot(host, { patchFetch } = {}) {
    await host.instance.data.flush();
    await host.instance.destroy();
    const realFetch = host.win.fetch;
    if (patchFetch) host.win.fetch = (url, init) => patchFetch(url, init, realFetch);
    let click = null;
    host.win.eventOn = (name, fn) => { click = fn; return { stop() {} }; };
    host.win.eval(bundle);
    return { instance: host.win.__plotInjector, click: () => click() };
}

test('数据还没读完就打开面板：读完后自动打开本卡的当前项目，不停在空白的选择页', async () => {
    const host = await boot();
    await withProject(host);
    let release;
    const gate = new Promise(resolve => { release = resolve; });
    const next = await reboot(host, { patchFetch: async (url, init, real) => { if (String(url).includes('pi-index.json')) await gate; return real(url, init); } });
    next.click();
    await tick(10);
    const body = () => host.win.document.querySelector('.pi-body').textContent;
    assert.match(body(), /正在读取酒馆本地数据/);
    release();
    await next.instance.ready;
    await tick(40);
    assert.match(body(), /注入条目/);
    await next.instance.destroy();
});

test('项目按聊天记：长按项目名设为当前聊天使用，换聊天回到本卡默认，回来仍是自己的项目', async () => {
    const host = await boot();
    const a = await withProject(host);
    const { instance, context, eventSource } = host;
    const b = await instance.data.createProject('海岛线');
    const chatA = context.chatMetadata;
    host.click();
    await tick(20);
    const doc = host.win.document;
    const item = doc.querySelector(`.pi-pitem[data-id="${b.id}"]`);
    item.dispatchEvent(new host.win.MouseEvent('pointerdown', { bubbles: true, clientX: 5, clientY: 5 }));
    await tick(600);
    item.dispatchEvent(new host.win.MouseEvent('pointerup', { bubbles: true }));
    item.click();
    await tick(10);
    const pick = [...doc.querySelectorAll('.pi-menu-item')].find(btn => /设为当前聊天使用/.test(btn.textContent));
    assert.ok(pick, '长按弹出菜单');
    pick.click();
    await tick(20);
    assert.equal(instance.runtime.activeId(), b.id);
    assert.equal(chatA.plotInjector.projectId, b.id);
    assert.equal(instance.data.activeIdFor('char:test.png'), a.id, '本卡默认不变');
    context.chatMetadata = {};
    context.chatId = 'chat-2';
    await eventSource.emit('chat_id_changed');
    assert.equal(instance.runtime.activeId(), a.id, '新聊天用本卡默认');
    await instance.runtime.switchProject(b.id, 'card');
    assert.equal(instance.data.activeIdFor('char:test.png'), b.id);
    context.chatMetadata = { plotInjector: { projectId: a.id, byProject: {} } };
    await eventSource.emit('chat_id_changed');
    assert.equal(instance.runtime.activeId(), a.id, '聊天记过的项目优先于本卡默认');
    await instance.destroy();
});

test('项目文件读取失败时显示原因和重试；页面渲染出错时显示错误而不是空白', async () => {
    const host = await boot();
    const project = await withProject(host);
    let fail = true;
    const next = await reboot(host, { patchFetch: (url, init, real) => (fail && String(url).includes(`pi-p-${project.id}`) ? Promise.resolve({ ok: false, status: 502, text: async () => '' }) : real(url, init)) });
    await next.instance.ready;
    next.click();
    await tick(40);
    const doc = host.win.document;
    assert.match(doc.querySelector('.pi-body').textContent, /读取项目失败.*HTTP 502/);
    fail = false;
    doc.querySelector('[data-act="retry-project"]').click();
    await tick(40);
    assert.match(doc.querySelector('.pi-body').textContent, /注入条目/);
    const runtime = next.instance.runtime;
    runtime.setProgress({ ...runtime.progress(), muted: null });
    await tick(10);
    assert.match(doc.querySelector('.pi-body').textContent, /这一页显示出错/);
    assert.ok(runtime.diagnose().logs.some(item => /页面渲染失败/.test(item.text)));
    await next.instance.destroy();
});

test('打开界面后四个页签、设置页、数据管理页都能渲染', async () => {
    const host = await boot();
    await withProject(host);
    host.click();
    await tick(10);
    const doc = host.win.document;
    assert.ok(doc.querySelector('.pi-panel'));
    for (const tab of ['discuss', 'setting', 'outline', 'run']) {
        doc.querySelector(`[data-act="tab"][data-tab="${tab}"]`).click();
        await tick(10);
        assert.ok(doc.querySelector('.pi-body').textContent.trim().length > 0, tab);
    }
    assert.match(doc.querySelector('.pi-body').textContent, /剧情索引/);
    for (const page of ['settings', 'data', 'books', 'diag']) {
        doc.querySelector(`[data-act="page"][data-page="${page}"]`).click();
        await tick(20);
        assert.ok(doc.querySelector('.pi-body').textContent.length > 20, page);
    }
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await host.instance.destroy();
    assert.equal(doc.querySelector('.pi-overlay'), null);
    assert.equal(doc.getElementById('pi-style'), null);
});

test('隐藏楼也计入楼数；主回复生成中先挂起检测，生成结束再检测', async () => {
    const host = await boot();
    await withProject(host);
    host.instance.data.updateSettings({ checkEvery: 3 });
    host.context.chat.push({ is_user: true, mes: '一', is_system: true }, { is_user: false, mes: '甲', is_system: true }, { is_user: false, mes: '甲发生了。' });
    await host.eventSource.emit('generation_started', 'normal', {}, false);
    await host.eventSource.emit('message_received', 2, 'normal');
    await tick(10);
    assert.equal(host.llmCalls.length, 0, '生成结束前不检测');
    await host.eventSource.emit('generation_ended', 3);
    await tick(10);
    assert.equal(host.llmCalls.length, 1);
    assert.equal(host.instance.runtime.progress().lastCheckFloor, 3);
    await host.instance.destroy();
});

test('上次检测楼层大于现有楼数时自动回到现有楼数；诊断页能渲染并给出修复', async () => {
    const host = await boot();
    await withProject(host);
    const runtime = host.instance.runtime;
    runtime.setProgress({ ...runtime.progress(), lastCheckFloor: 50 });
    host.instance.data.updateSettings({ checkEvery: 1 });
    host.context.chat.push({ is_user: true, mes: '一' }, { is_user: false, mes: '甲发生了。' });
    await host.eventSource.emit('message_received', 1, 'normal');
    await tick(10);
    assert.equal(host.llmCalls.length, 0, '刚回到现有楼数，本次差 0 楼');
    assert.equal(runtime.progress().lastCheckFloor, 2);
    host.context.chat.push({ is_user: false, mes: '乙' });
    await host.eventSource.emit('message_received', 2, 'normal');
    await tick(10);
    assert.equal(host.llmCalls.length, 1);
    runtime.setProgress({ ...runtime.progress(), lastCheckFloor: 50 });
    host.click();
    await tick(10);
    const doc = host.win.document;
    doc.querySelector('.pi-side [data-act="page"][data-page="diag"]').click();
    await tick(10);
    const body = doc.querySelector('.pi-body');
    assert.match(body.textContent, /当前只有 3 楼/);
    assert.match(body.textContent, /收到回复/);
    body.querySelector('.pi-diag-row [data-act="reset-base"]').click();
    await tick(10);
    assert.equal(runtime.progress().lastCheckFloor, 3);
    assert.doesNotMatch(doc.querySelector('.pi-body').textContent, /当前只有/);
    doc.querySelector('.pi-body [data-act="rebind"]').click();
    await tick(10);
    assert.equal(runtime.diagnose().events.find(item => item.key === 'MESSAGE_RECEIVED').bound, true);
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await host.instance.destroy();
});

test('模型接口：获取列表后下拉选择；保存为预设后另一个用途一键载入', async () => {
    const host = await boot();
    await withProject(host);
    host.click();
    await tick(10);
    const doc = host.win.document;
    const fire = (node, type) => node.dispatchEvent(new host.win.Event(type, { bubbles: true }));
    const settings = () => host.instance.data.settings();
    doc.querySelector('.pi-top [data-act="page"][data-page="settings"]').click();
    await tick(10);
    const source = doc.querySelector('select[data-llm="discuss"][data-k="source"]');
    source.value = 'custom';
    fire(source, 'change');
    const endpoint = doc.querySelector('input[data-llm="discuss"][data-k="endpoint"]');
    endpoint.value = 'https://api.example.com/v1';
    fire(endpoint, 'input');
    doc.querySelector('[data-act="models"][data-role="discuss"]').click();
    await tick(30);
    const pick = doc.querySelector('select[data-llm="discuss"][data-k="model"]');
    assert.ok(pick, '获取后应出现模型下拉框');
    assert.deepEqual([...pick.options].filter(option => !option.disabled).map(option => option.value), ['model-a', 'model-b', '__manual']);
    pick.value = 'model-b';
    fire(pick, 'change');
    assert.equal(settings().llm.discuss.model, 'model-b');

    doc.querySelector('[data-act="preset-save"]').click();
    await tick(10);
    doc.querySelector('.pi-dialog [data-dlg-input]').value = '我的接口';
    doc.querySelector('.pi-dialog .pi-dlg-acts .is-primary').click();
    await tick(10);
    assert.equal(settings().presets.length, 1);
    assert.equal(settings().presets[0].name, '我的接口');

    doc.querySelector('[data-act="llm-role"][data-role="check"]').click();
    await tick(10);
    doc.querySelector('[data-act="preset-load"]').click();
    await tick(10);
    doc.querySelector('.pi-dialog .pi-preset-pick').click();
    await tick(10);
    const check = settings().llm.check;
    assert.equal(`${check.source}|${check.endpoint}|${check.model}`, 'custom|https://api.example.com/v1|model-b');
    assert.equal(doc.querySelector('input[data-llm="check"][data-k="endpoint"]').value, 'https://api.example.com/v1');
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await host.instance.destroy();
});

test('世界书条目页：开启与已关闭分两区，勾选框直接开关条目', async () => {
    const host = await boot();
    await withProject(host);
    const book = { entries: { 0: { uid: 0, comment: '很长很长的条目名'.repeat(6), content: 'a', disable: false }, 1: { uid: 1, comment: '旧剧情', content: 'b', disable: true } } };
    host.context.chatMetadata.world_info = '测试书';
    host.context.loadWorldInfo = async () => JSON.parse(JSON.stringify(book));
    host.context.saveWorldInfo = async (name, data) => { book.entries = data.entries; };
    host.click();
    await tick(10);
    const doc = host.win.document;
    const fire = (node, type) => node.dispatchEvent(new host.win.Event(type, { bubbles: true }));
    doc.querySelector('.pi-side [data-act="page"][data-page="books"]').click();
    await tick(10);
    doc.querySelector('[data-act="open-book"]').click();
    await tick(20);
    const sections = () => [...doc.querySelectorAll('.pi-wb-sec')].map(sec => [...sec.querySelectorAll('[data-wb-toggle]')].map(node => [node.dataset.wbToggle, node.getAttribute('aria-checked') === 'true']));
    assert.deepEqual(sections(), [[['0', true]], [['1', false]]]);
    doc.querySelector('[data-wb-toggle="0"]').click();
    await tick(20);
    assert.equal(book.entries[0].disable, true);
    assert.deepEqual(sections(), [[], [['0', false], ['1', false]]]);
    doc.querySelector('[data-act="wb-bulk"][data-group="off"]').click();
    await tick(20);
    assert.deepEqual(sections(), [[['0', true], ['1', true]], []]);
    assert.equal(book.entries[1].disable, false);
    doc.querySelector('[data-act="wb-bulk"][data-group="on"]').click();
    await tick(20);
    assert.deepEqual(sections(), [[], [['0', false], ['1', false]]]);
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await host.instance.destroy();
});

test('世界书管理：token 统计、修复关键词标点、批量选择后顺序重排与迁移到新世界书', async () => {
    const host = await boot();
    await withProject(host);
    const books = { 测试书: { entries: {
        0: { uid: 0, comment: '甲', content: '甲内容', key: ['甲，甲甲、甲乙'], keysecondary: [], disable: false, order: 5 },
        1: { uid: 1, comment: '乙', content: '乙内容', key: ['乙'], keysecondary: [], disable: false, order: 9 },
    } } };
    host.context.chatMetadata.world_info = '测试书';
    host.context.getWorldInfoNames = () => Object.keys(books);
    host.context.loadWorldInfo = async name => (books[name] ? JSON.parse(JSON.stringify(books[name])) : null);
    host.context.saveWorldInfo = async (name, data) => { books[name] = JSON.parse(JSON.stringify(data)); };
    host.context.getTokenCountAsync = async text => text.length;
    host.click();
    await tick(10);
    const doc = host.win.document;
    const fire = (node, type) => node.dispatchEvent(new host.win.Event(type, { bubbles: true }));
    const okDialog = async () => { await tick(10); doc.querySelector('.pi-dialog .pi-dlg-acts .is-primary, .pi-dialog .pi-dlg-acts .is-danger').click(); await tick(20); };
    doc.querySelector('.pi-side [data-act="page"][data-page="books"]').click();
    await tick(10);
    doc.querySelector('[data-act="open-book"]').click();
    await tick(30);
    assert.match(doc.querySelector('.pi-wb-tokens').textContent, /开启 6 · 全部/);

    doc.querySelector('[data-act="book-more"]').click();
    await tick(10);
    doc.querySelector('.pi-dialog [data-dlg-value="wb-health"]').click();
    await tick(20);
    doc.querySelector('.pi-dialog [data-dlg-value="::punct"]').click();
    await okDialog();
    assert.deepEqual(books.测试书.entries[0].key, ['甲', '甲甲', '甲乙']);

    doc.querySelector('[data-act="wb-picking"]').click();
    await tick(10);
    doc.querySelector('[data-act="wb-pick-all"]').click();
    await tick(10);
    doc.querySelector('[data-act="wb-order"]').click();
    await tick(10);
    doc.querySelector('.pi-dialog [data-f="start"]').value = '200';
    doc.querySelector('.pi-dialog [data-f="step"]').value = '10';
    doc.querySelector('.pi-dialog .pi-dlg-acts .is-primary').click();
    await okDialog();
    assert.deepEqual([books.测试书.entries[0].order, books.测试书.entries[1].order], [200, 210]);

    const pick = doc.querySelector('[data-wb-pick="1"]');
    pick.checked = false;
    fire(pick, 'change');
    await tick(10);
    doc.querySelector('[data-act="wb-move"]').click();
    await tick(10);
    doc.querySelector('.pi-dialog [data-f="name"]').value = '新书';
    doc.querySelector('.pi-dialog [data-f="mode"]').value = 'move';
    doc.querySelector('.pi-dialog .pi-dlg-acts .is-primary').click();
    await okDialog();
    assert.deepEqual(Object.values(books.新书.entries).map(entry => `${entry.uid}:${entry.comment}`), ['0:甲']);
    assert.deepEqual(Object.keys(books.测试书.entries), ['1']);
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await host.instance.destroy();
});

test('世界书工具栏：新建条目改标题、复制条目、批量关闭与删除、重命名改聊天绑定、删除本书解除绑定', async () => {
    const host = await boot();
    await withProject(host);
    const books = { 测试书: { entries: { 0: { uid: 0, comment: '甲', content: '甲内容', key: ['甲'], keysecondary: [], disable: false, order: 100 } } } };
    host.context.chatMetadata.world_info = '测试书';
    host.context.getWorldInfoNames = () => Object.keys(books);
    host.context.loadWorldInfo = async name => (books[name] ? JSON.parse(JSON.stringify(books[name])) : null);
    host.context.saveWorldInfo = async (name, data) => { books[name] = JSON.parse(JSON.stringify(data)); };
    const fetch = host.win.fetch;
    host.win.fetch = async (url, init = {}) => {
        if (String(url) === '/api/worldinfo/delete') { delete books[JSON.parse(init.body).name]; return { ok: true, status: 200, text: async () => '' }; }
        return fetch(url, init);
    };
    host.click();
    await tick(10);
    const doc = host.win.document;
    const fire = (node, type) => node.dispatchEvent(new host.win.Event(type, { bubbles: true }));
    const ok = async () => { await tick(10); doc.querySelector('.pi-dialog .pi-dlg-acts .is-primary, .pi-dialog .pi-dlg-acts .is-danger').click(); await tick(30); };
    const menu = async (more, value) => { doc.querySelector(`[data-act="${more}"]`).click(); await tick(10); doc.querySelector(`.pi-dialog [data-dlg-value="${value}"]`).click(); await tick(10); };
    doc.querySelector('.pi-side [data-act="page"][data-page="books"]').click();
    await tick(10);
    doc.querySelector('[data-act="open-book"]').click();
    await tick(30);

    doc.querySelector('[data-act="wb-add"]').click();
    await tick(30);
    const title = doc.querySelector('[data-wb-edit="1"][data-f="comment"]');
    assert.ok(title, '新建后展开新条目');
    title.value = '乙';
    fire(title, 'change');
    await tick(30);
    assert.equal(books.测试书.entries[1].comment, '乙');
    doc.querySelector('[data-act="wb-dup"][data-key="0"]').click();
    await tick(30);
    assert.equal(books.测试书.entries[2].comment, '甲（副本）');

    doc.querySelector('[data-act="wb-picking"]').click();
    await tick(10);
    doc.querySelector('[data-act="wb-pick-all"]').click();
    await tick(10);
    await menu('pick-more', 'wb-pick-off');
    await tick(30);
    assert.ok([0, 1, 2].every(i => books.测试书.entries[i].disable));
    const pick = doc.querySelector('[data-wb-pick="0"]');
    pick.checked = false;
    fire(pick, 'change');
    await tick(10);
    doc.querySelector('[data-act="wb-pick-delete"]').click();
    await ok();
    assert.deepEqual(Object.keys(books.测试书.entries), ['0']);

    doc.querySelector('[data-act="wb-picking"]').click();
    await tick(10);
    await menu('book-more', 'book-rename');
    await tick(10);
    doc.querySelector('.pi-dialog [data-dlg-input]').value = '改名书';
    await ok();
    assert.equal(books.测试书, undefined);
    assert.ok(books.改名书);
    assert.equal(host.context.chatMetadata.world_info, '改名书');

    await menu('book-more', 'book-delete');
    await ok();
    assert.equal(books.改名书, undefined);
    assert.equal(host.context.chatMetadata.world_info, undefined);
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await host.instance.destroy();
});

test('世界书条目页：手写条目可开关、编辑位置与关键词和内容；数据库条目按字段折叠，字段一键开关写进世界书', async () => {
    const host = await boot();
    await withProject(host);
    const titles = ['手写剧情', 'TavernDB-ACU-CustomExport-人物档案-1', 'TavernDB-ACU-CustomExport-纪要-1', 'TavernDB-ACU-CustomExport-人物档案-2', 'TavernDB-ACU-OutlineTable'];
    const book = { entries: Object.fromEntries(titles.map((comment, uid) => [uid, { uid, comment, content: '原内容', disable: false, key: ['甲'], position: 1, order: 100 }])) };
    host.context.chatMetadata.world_info = '测试书';
    host.context.loadWorldInfo = async () => JSON.parse(JSON.stringify(book));
    host.context.saveWorldInfo = async (name, data) => { book.entries = data.entries; };
    host.click();
    await tick(10);
    const doc = host.win.document;
    const fire = (node, type) => node.dispatchEvent(new host.win.Event(type, { bubbles: true }));
    doc.querySelector('.pi-side [data-act="page"][data-page="books"]').click();
    await tick(10);
    doc.querySelector('[data-act="open-book"]').click();
    await tick(20);
    const secs = [...doc.querySelectorAll('.pi-wb-sec')];
    assert.equal(secs.length, 3);
    assert.equal(secs[0].querySelectorAll('[data-wb-toggle]').length, 1, '已开启区只有手写条目');
    assert.equal(secs[2].querySelectorAll('[data-wb-toggle]').length, 0, '数据库字段默认收起');
    assert.deepEqual([...secs[2].querySelectorAll('.pi-wb-field')].map(node => node.textContent), ['人物档案', '纪要', '英文字段']);

    doc.querySelector('[data-act="wb-open"][data-key="0"]').click();
    await tick(10);
    const pos = doc.querySelector('[data-wb-edit="0"][data-f="position"]');
    pos.value = '4';
    fire(pos, 'change');
    await tick(20);
    assert.equal(book.entries[0].position, 4);
    assert.ok(doc.querySelector('[data-wb-edit="0"][data-f="depth"]'), '切到 @D 后出现深度');
    const keys = doc.querySelector('[data-wb-edit="0"][data-f="key"]');
    keys.value = '乙，丙';
    fire(keys, 'change');
    const content = doc.querySelector('[data-wb-edit="0"][data-f="content"]');
    content.value = '新内容';
    fire(content, 'change');
    await tick(20);
    assert.deepEqual([...book.entries[0].key], ['乙', '丙']);
    assert.equal(book.entries[0].content, '新内容');

    doc.querySelector('[data-act="acu-field"][data-field="人物档案"][data-on="0"]').click();
    await tick(20);
    assert.deepEqual([1, 2, 3, 4].map(i => book.entries[i].disable), [true, false, true, false]);
    const lore = await entriesNow(host.eventSource);
    assert.equal(lore.filter(entry => /TavernDB/.test(entry.comment)).length, 0, '插件不再从正文扫描里去掉数据库条目');
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await host.instance.destroy();
});

test('讨论页附带参考：世界书只显示条数；默认带手写条目、纪要索引和最新纪要，剧情进度与最近正文一起发给讨论 AI', async () => {
    const host = await boot();
    const project = await withProject(host);
    const book = { entries: {} };
    const add = (comment, extra = {}) => { const uid = Object.keys(book.entries).length; book.entries[uid] = { uid, comment, content: `【${comment}】`, disable: false, ...extra }; };
    add('手写设定');
    add('TavernDB-ACU-CustomExport-纪要索引');
    for (let n = 1; n <= 12; n += 1) add(`TavernDB-ACU-CustomExport-纪要-${n}`);
    add('TavernDB-ACU-CustomExport-人物档案-1');
    host.context.chatMetadata.world_info = '测试书';
    host.context.loadWorldInfo = async () => JSON.parse(JSON.stringify(book));
    host.context.chat.push({ is_user: true, mes: '第一句' }, { is_user: false, mes: '正文甲' });
    await host.instance.data.loadChat(project.id);
    host.click();
    await tick(10);
    const doc = host.win.document;
    doc.querySelector('[data-act="tab"][data-tab="discuss"]').click();
    await tick(30);
    assert.match(doc.querySelector('[data-act="ref-wb"]').textContent, /世界书 12 条/);
    assert.equal(doc.querySelectorAll('.pi-refs .pi-chip').length, 6, '顶栏不逐条列出条目（人格+五项参考）');
    doc.querySelector('[data-compose]').value = '接下来第三章怎么走';
    doc.querySelector('[data-act="send"]').click();
    await tick(40);
    const system = host.llmCalls.at(-1)[0].content;
    assert.match(system, /【手写设定】/);
    assert.match(system, /纪要索引】/);
    assert.match(system, /纪要-12】/);
    assert.match(system, /纪要-3】/);
    assert.doesNotMatch(system, /CustomExport-纪要-2】|CustomExport-人物档案-1/);
    assert.match(system, /【参考·剧情进度/);
    assert.match(system, /【参考·最近 10 楼正文】[\s\S]*正文甲/);
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await host.instance.destroy();
});

test('不走讨论直接写大纲：大纲页选世界书「全选」后，全部条目（含纪要和其他数据库字段）发给写大纲的 AI', async () => {
    const host = await boot();
    const project = await withProject(host);
    const book = { entries: {} };
    const add = comment => { const uid = Object.keys(book.entries).length; book.entries[uid] = { uid, comment, content: `【${comment}】`, disable: false }; };
    add('手写设定');
    for (let n = 1; n <= 12; n += 1) add(`TavernDB-ACU-CustomExport-纪要-${n}`);
    add('TavernDB-ACU-CustomExport-人物档案-1');
    host.context.chatMetadata.world_info = '测试书';
    host.context.loadWorldInfo = async () => JSON.parse(JSON.stringify(book));
    host.win.__reply = () => '```yaml\n剧情_卷二_新:\n  阶段一_起:\n    时间范围: 之后\n    主线节点:\n      - 名称: 丙\n        事件: 丙发生。\n```';
    await host.instance.data.loadChat(project.id);
    host.click();
    await tick(10);
    const doc = host.win.document;
    doc.querySelector('[data-act="tab"][data-tab="outline"]').click();
    await tick(30);
    assert.ok(doc.querySelector('[data-act="gen-talk"]').disabled, '没有讨论记录时讨论参考不可点');
    doc.querySelector('[data-act="gen-wb"]').click();
    await tick(30);
    doc.querySelector('.pi-dialog [data-ref-every="1"]').click();
    doc.querySelector('.pi-dialog .pi-dlg-acts .is-primary').click();
    await tick(30);
    assert.match(doc.querySelector('[data-act="gen-wb"]').textContent, /世界书 14 条/);
    doc.querySelector('[data-act="ai-volume"]').click();
    await tick(20);
    doc.querySelector('.pi-dialog .pi-dlg-acts .is-primary').click();
    await tick(40);
    const user = host.llmCalls.at(-1)[1].content;
    assert.match(user, /【世界书参考】/);
    for (const name of ['手写设定', '纪要-1】', '纪要-12】', '人物档案-1】']) assert.match(user, new RegExp(name));
    assert.doesNotMatch(user, /【讨论摘要】/);
    assert.ok(doc.querySelector('.pi-body').textContent.includes('卷二'), '写好的大纲进入待采用');
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await host.instance.destroy();
});

test('大纲页：阶段节点按主线/支线/世界动态切换显示', async () => {
    const host = await boot();
    await withProject(host);
    host.click();
    await tick(10);
    const doc = host.win.document;
    doc.querySelector('[data-act="tab"][data-tab="outline"]').click();
    [...doc.querySelectorAll('.pi-titem')].find(item => item.textContent.includes('阶段一')).click();
    await tick(10);
    const visible = () => [...doc.querySelectorAll('.pi-body .pi-card h3')].map(h => (h.textContent.match(/主线节点|支线事件|世界动态/) || [])[0]).filter(Boolean);
    assert.deepEqual(visible(), ['主线节点']);
    doc.querySelector('[data-act="node-kind"][data-kind="world"]').click();
    await tick(10);
    assert.deepEqual(visible(), ['世界动态']);
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await host.instance.destroy();
});

test('讨论页清空讨论：可先导出，设定和大纲不受影响', async () => {
    const host = await boot();
    const project = await withProject(host);
    await host.instance.data.loadChat(project.id);
    host.instance.data.saveChat(project.id, { ...host.instance.data.chat(project.id), summary: '早期', messages: [{ id: 'm1', role: 'user', content: '想法', at: 1 }] });
    const downloads = [];
    host.win.URL.createObjectURL = blob => { downloads.push(blob); return 'blob:x'; };
    host.win.URL.revokeObjectURL = () => {};
    host.click();
    await tick(10);
    const doc = host.win.document;
    doc.querySelector('[data-act="tab"][data-tab="discuss"]').click();
    await tick(10);
    doc.querySelector('[data-act="clear-talk"]').click();
    await tick(10);
    doc.querySelector('.pi-dialog .pi-dlg-acts .is-primary').click();
    await tick(10);
    assert.equal(downloads.length, 1);
    const chat = host.instance.data.chat(project.id);
    assert.equal(chat.messages.length, 0);
    assert.equal(chat.summary, '');
    assert.equal(chat.refs.setting, true);
    assert.equal(host.instance.data.project(project.id).setting.text, '世界观声明:\n基于: 测试');
    assert.equal(doc.querySelector('[data-act="clear-talk"]'), null);
    await host.instance.destroy();
});

test('设定页：分块标签上的删除键删掉整个分块，删前版本进历史', async () => {
    const host = await boot();
    const project = await withProject(host);
    host.instance.data.updateProject(project.id, current => ({ ...current, setting: { ...current.setting, text: '世界观声明:\n基于: 测试\n\n铁则:\n- 甲\n\n人物档案:\n林北' } }));
    host.click();
    await tick(10);
    const doc = host.win.document;
    doc.querySelector('[data-act="tab"][data-tab="setting"]').click();
    await tick(10);
    doc.querySelector('[data-act="block-del"][data-key="铁则"]').click();
    await tick(10);
    doc.querySelector('.pi-dialog .pi-dlg-acts .is-danger').click();
    await tick(10);
    const setting = host.instance.data.project(project.id).setting;
    assert.equal(setting.text, '世界观声明:\n基于: 测试\n\n人物档案:\n林北');
    assert.ok(setting.history.some(item => item.text.includes('铁则')));
    assert.equal(doc.querySelector('[data-act="block-del"][data-key="铁则"]'), null);
    await host.instance.destroy();
});

test('执行页切换推进速度：存进聊天进度，注入的详细条目立即换说明', async () => {
    const host = await boot();
    await withProject(host);
    host.click();
    await tick(10);
    const doc = host.win.document;
    doc.querySelector('[data-act="tab"][data-tab="run"]').click();
    await tick(10);
    doc.querySelector('[data-act="pace"][data-pace="fast"]').click();
    await tick(10);
    const lore = await entriesNow(host.eventSource);
    assert.match(lore[1].content, /节奏加快/);
    const meta = host.context.chatMetadata.plotInjector;
    assert.equal(meta.byProject[meta.projectId].pace, 'fast');
    assert.ok(doc.querySelector('[data-act="pace"][data-pace="fast"]').classList.contains('is-sel'));
    await host.instance.destroy();
});

test('关掉再打开时回到上次的页面或页签', async () => {
    const host = await boot();
    await withProject(host);
    host.click();
    await tick(10);
    const doc = host.win.document;
    doc.querySelector('.pi-side [data-act="page"][data-page="books"]').click();
    host.instance.open && doc.querySelector('[data-act="close"]').click();
    host.click();
    await tick(20);
    assert.equal(doc.querySelector('.pi-top-title').textContent, '世界书管理');
    doc.querySelector('.pi-side [data-act="project"]').click();
    await tick(10);
    doc.querySelector('[data-act="tab"][data-tab="outline"]').click();
    doc.querySelector('[data-act="close"]').click();
    host.click();
    await tick(20);
    assert.ok(doc.querySelector('[data-act="tab"][data-tab="outline"]').classList.contains('is-sel'));
    await host.instance.destroy();
});

test('讨论页：回复中发送键变成停止键，停止后不存回复也不报错；没回复的用户消息可重新发送', async () => {
    const host = await boot();
    await withProject(host);
    let release = null;
    host.win.__reply = () => new Promise(resolve => { release = resolve; });
    host.click();
    await tick(20);
    const doc = host.win.document;
    doc.querySelector('[data-act="tab"][data-tab="discuss"]').click();
    await tick(10);
    doc.querySelector('[data-compose]').value = '想写一条龙宫线';
    doc.querySelector('[data-act="send"]').click();
    await tick(20);
    assert.ok(doc.querySelector('[data-act="stop"]'), '回复中出现停止键');
    assert.equal(doc.querySelector('[data-act="send"]'), null);
    doc.querySelector('[data-act="stop"]').click();
    await tick(20);
    release('迟到的回复');
    await tick(20);
    assert.equal(doc.querySelectorAll('.pi-msg').length, 1, '停止后迟到的回复不存');
    assert.ok(doc.querySelector('[data-act="send"]'), '停止后恢复发送键');
    assert.equal(host.win.__errors.length, 0, '停止不算失败');
    host.win.__reply = () => '好的，先说原作。';
    doc.querySelector('[data-act="resend"]').click();
    await tick(30);
    const msgs = [...doc.querySelectorAll('.pi-msg')];
    assert.equal(msgs.length, 2, '重新发送不重复添加用户消息');
    assert.match(msgs[1].textContent, /先说原作/);
    assert.equal(doc.querySelector('[data-act="resend"]'), null, '有回复后不再显示重新发送');
    await host.instance.destroy();
});

test('讨论消息渲染 Markdown 且不放行 HTML', async () => {
    const host = await boot();
    const project = await withProject(host);
    await host.instance.data.loadChat(project.id);
    host.instance.data.saveChat(project.id, { ...host.instance.data.chat(project.id), messages: [{ id: 'm1', role: 'assistant', content: '## 标题\n**粗体** 与 `代码`\n- 条目\n<img src=x onerror=alert(1)>', at: 1 }] });
    host.click();
    await tick(10);
    const doc = host.win.document;
    doc.querySelector('[data-act="tab"][data-tab="discuss"]').click();
    await tick(10);
    const md = doc.querySelector('.pi-msg .pi-md');
    assert.equal(md.querySelector('.pi-md-h').textContent, '标题');
    assert.equal(md.querySelector('strong').textContent, '粗体');
    assert.equal(md.querySelector('code').textContent, '代码');
    assert.equal(md.querySelector('li').textContent, '条目');
    assert.equal(md.querySelector('img'), null);
    assert.match(md.textContent, /<img src=x/);
    await host.instance.destroy();
});

test('界面操作改动立即反映到注入内容与本地文件', async () => {
    const host = await boot();
    const project = await withProject(host);
    host.click();
    await tick(10);
    const doc = host.win.document;
    const fire = (node, type) => node.dispatchEvent(new host.win.Event(type, { bubbles: true }));

    doc.querySelector('[data-act="tab"][data-tab="run"]').click();
    doc.querySelector('[data-act="node-toggle"][data-node="m0"]').click();
    let lore = await entriesNow(host.eventSource);
    assert.doesNotMatch(lore[1].content, /甲事件/);

    doc.querySelector('[data-act="tab"][data-tab="outline"]').click();
    [...doc.querySelectorAll('.pi-titem')].find(item => item.textContent.includes('阶段二')).click();
    const range = doc.querySelector('[data-stage-field="时间范围"]');
    range.value = '改过的时间';
    fire(range, 'input');
    doc.querySelector('[data-act="tab"][data-tab="run"]').click();
    doc.querySelector('[data-act="index-toggle"]').click();
    assert.match(doc.querySelector('.pi-body .pi-pre').textContent, /【下一段】\n- 卷一·测试·阶段二 发展｜时间范围：改过的时间/);
    doc.querySelector('[data-act="tab"][data-tab="outline"]').click();

    doc.querySelector('[data-act="tab"][data-tab="setting"]').click();
    const setting = doc.querySelector('[data-setting]');
    setting.value = '铁则:\n- 新铁则';
    fire(setting, 'input');
    lore = await entriesNow(host.eventSource);
    assert.equal(lore[0].content, '铁则:\n- 新铁则');

    doc.querySelector('[data-act="tab"][data-tab="discuss"]').click();
    await tick(10);
    const compose = doc.querySelector('[data-compose]');
    compose.value = '想写一条龙宫线';
    doc.querySelector('[data-act="send"]').click();
    await tick(30);
    assert.equal(doc.querySelectorAll('.pi-msg').length, 2);

    await host.instance.data.flush();
    const saved = JSON.parse(host.files.get(`pi-p-${project.id}.json`));
    assert.equal(saved.setting.text, '铁则:\n- 新铁则');
    assert.equal(JSON.parse(host.files.get(`pi-c-${project.id}.json`)).messages.length, 2);
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await host.instance.destroy();
});

const WORLD_REPLY = '【标题】雾渡口\n【档案】\n外观：渡口起雾，船夫等人。\n站台：石阶下的灯笼，起雾时出现。\n真相：船夫是上一任店主。';
const isWorldCall = prompts => /世界设计师/.test(prompts[0].content);

const stateBlock = value => `正文。\n<末班车状态>\n列车：${value}\n污染：旧档（3）\n</末班车状态>`;

test('无限流项目：AI 楼层状态块「停站」开副本注入档案，swipe 掉就撤销，「回到列车」关副本，改掉或删掉就重开，档案没好时下一条等它', async () => {
    const host = await boot();
    const { instance } = host;
    const project = await instance.data.createProject('末班车', '', 'infinite');
    await instance.runtime.switchProject(project.id);
    instance.data.updateProject(project.id, current => ({ ...current, setting: { ...current.setting, text: '列车规则：广播只报站。' } }));
    host.click();
    await tick(10);
    const doc = host.win.document;
    doc.querySelector('[data-act="tab"][data-tab="run"]').click();
    await tick(10);
    const body = () => doc.querySelector('.pi-body').textContent;
    assert.match(body(), /进入新世界/);
    assert.match(body(), /回到列车/);
    assert.doesNotMatch(body(), /立即检测/, '无限流不再有检测按钮');
    assert.match(body(), /最新一楼没有状态块/);
    const infNow = () => instance.runtime.infState().inf;
    const lorePieces = async () => (await entriesNow(host.eventSource)).map(entry => entry.content).join('|');
    const worldCalls = () => host.llmCalls.filter(isWorldCall).length;
    let gate = null;
    host.win.__reply = async prompts => {
        if (isWorldCall(prompts)) {
            if (gate) await gate.promise;
            return WORLD_REPLY;
        }
        return '{}';
    };
    const settle = async cond => { for (let i = 0; i < 60 && !cond(); i += 1) await tick(10); };
    const aiSay = async (text, event = 'message_received') => {
        host.context.chat.push({ is_user: false, mes: text });
        await host.eventSource.emit(event, host.context.chat.length - 1, 'normal');
    };
    const rewrite = async (text, event) => {
        host.context.chat[host.context.chat.length - 1].mes = text;
        await host.eventSource.emit(event, host.context.chat.length - 1);
    };

    // 车上、没有状态块：什么都不做，只记下来。
    host.context.chat.push({ is_user: true, mes: '开车' });
    await aiSay('列车进站。');
    await tick(20);
    assert.equal(host.llmCalls.length, 0, '没有状态块不调模型');
    assert.equal(instance.runtime.lastRead().state, '');
    await aiSay(stateBlock('车上'));
    await tick(20);
    assert.equal(host.llmCalls.length, 0, '读到车上也不动');
    assert.equal(instance.runtime.lastRead().state, '车上');
    assert.doesNotMatch(await lorePieces(), /世界档案/);

    // 世界里的值在车上读到：也不动。
    await aiSay(stateBlock('回到列车'));
    await tick(20);
    assert.equal(infNow().phase, 'train');
    assert.equal(host.llmCalls.length, 0);

    // 读到「停站」：立即开副本，注入整份档案。
    host.context.chat.push({ is_user: true, mes: '下车' });
    await aiSay(stateBlock('停站'));
    await settle(() => infNow().phase === 'world');
    assert.equal(infNow().phase, 'world');
    assert.equal(worldCalls(), 1);
    const triggerFloor = host.context.chat.length - 1;
    assert.equal(infNow().trigger.floor, triggerFloor, '记下触发楼序号');
    assert.match(await lorePieces(), /<世界档案>[\s\S]*渡口起雾[\s\S]*<\/世界档案>/);

    // 世界里读到「停站」或「世界里」不重复开。
    host.context.chat.push({ is_user: true, mes: '走' });
    await aiSay(stateBlock('世界里'));
    await tick(20);
    assert.equal(worldCalls(), 1, '不重复生成');
    assert.equal(infNow().worlds.length, 1);
    host.context.chat.splice(triggerFloor + 1);

    // 触发楼 swipe 成仍带「停站」的新文字：不重复生成，只更新哈希。
    const oldHash = infNow().trigger.hash;
    await rewrite(`${stateBlock('停站')}\n又一版`, 'message_swiped');
    assert.equal(worldCalls(), 1);
    assert.equal(infNow().phase, 'world');
    assert.notEqual(infNow().trigger.hash, oldHash);

    // swipe 成不带「停站」：撤销开副本，档案删掉，退回列车。
    await rewrite(stateBlock('车上'), 'message_swiped');
    assert.equal(infNow().phase, 'train');
    assert.equal(infNow().worlds.length, 0, '刚生成的档案被删');
    assert.doesNotMatch(await lorePieces(), /世界档案|渡口起雾/);
    assert.ok(doc.querySelector('[data-notice="inf-undo"]'), '有撤销提示');

    // 重新生成又出现「停站」：再次开副本。
    await rewrite(stateBlock('停站'), 'message_received');
    await settle(() => infNow().phase === 'world');
    assert.equal(infNow().phase, 'world');
    assert.equal(worldCalls(), 2);

    // 删楼删到触发楼之前：同样撤销。
    host.context.chat.pop();
    await host.eventSource.emit('message_deleted', host.context.chat.length);
    assert.equal(infNow().phase, 'train');
    assert.equal(infNow().worlds.length, 0);

    // 再开一次，然后读到「回到列车」：关副本，档案留在世界库。
    await aiSay(stateBlock('停站'));
    await settle(() => infNow().phase === 'world');
    assert.equal(worldCalls(), 3);
    host.context.chat.push({ is_user: true, mes: '继续' });
    await aiSay(stateBlock('回到列车'));
    assert.equal(infNow().phase, 'train', '读到回到列车关副本');
    assert.equal(infNow().worlds.length, 1, '档案留在世界库');
    assert.equal(infNow().trigger.kind, 'leave');
    assert.doesNotMatch(await lorePieces(), /世界档案/);

    // 回到列车那一楼被改成「世界里」：重新打开那份档案。
    await rewrite(stateBlock('世界里'), 'message_swiped');
    assert.equal(infNow().phase, 'world');
    assert.match(await lorePieces(), /渡口起雾/);

    // 再次关副本后，删掉那一楼：也重新打开。
    await rewrite(stateBlock('回到列车'), 'message_received');
    assert.equal(infNow().phase, 'train');
    host.context.chat.pop();
    await host.eventSource.emit('message_deleted', host.context.chat.length);
    assert.equal(infNow().phase, 'world', '删掉触发关副本的楼，回到世界');
    assert.equal(worldCalls(), 3, '撤销关副本不重新生成');

    // 手动按钮兜底仍在：回到列车。
    instance.runtime.returnToTrain();
    assert.equal(infNow().phase, 'train');
    assert.equal('trigger' in infNow(), false, '手动操作清掉触发记录');
    assert.match(body(), /上次读到：第 \d+ 楼 列车：/);

    // 档案还没生成完用户就发下一条：酒馆的加载事件等它，生成完成后档案进入本次注入。
    let release = null;
    gate = { promise: new Promise(resolve => { release = resolve; }) };
    host.context.chat.push({ is_user: true, mes: '再来' });
    await aiSay(stateBlock('停站'));
    assert.equal(instance.runtime.isOpening(), true);
    let loaded = null;
    const pending = lorePieces().then(value => { loaded = value; });
    await tick(60);
    assert.equal(loaded, null, '生成没完，加载事件还在等');
    release();
    await pending;
    assert.match(loaded, /<世界档案>[\s\S]*渡口起雾/, '档案进入本次注入');
    assert.equal(infNow().phase, 'world');

    // 生成中触发楼被 swipe 掉：取消生成，不写档案。
    instance.runtime.returnToTrain();
    const worldsBefore = infNow().worlds.length;
    gate = { promise: new Promise(resolve => { release = resolve; }) };
    await aiSay(stateBlock('停站'));
    assert.equal(instance.runtime.isOpening(), true);
    await rewrite(stateBlock('车上'), 'message_swiped');
    assert.equal(instance.runtime.isOpening(), false);
    release();
    await tick(40);
    assert.equal(infNow().phase, 'train', '作废的生成不写进进度');
    assert.equal(infNow().worlds.length, worldsBefore, '作废的生成没有留下新档案');
    assert.doesNotMatch(await lorePieces(), /世界档案/);
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await instance.destroy();
});

test('无限流自定义主空间配置：状态块写「出门」开副本，注入标签是 <公寓状态>，执行页按主空间名称显示', async () => {
    const host = await boot();
    const { instance } = host;
    const project = await instance.data.createProject('公寓', '', 'infinite');
    await instance.runtime.switchProject(project.id);
    const words = { back: ['回公寓', '进门'], depart: ['出门', '下楼'], away: ['副本里'], hub: ['公寓里'] };
    instance.data.updateProject(project.id, current => ({ ...current, infinite: { ...current.infinite, config: { ...current.infinite.config, hubName: '公寓', blockTag: '公寓状态', fieldNames: ['公寓'], words } } }));
    host.win.__reply = async prompts => (isWorldCall(prompts) ? WORLD_REPLY : '{}');
    host.click();
    await tick(10);
    const doc = host.win.document;
    doc.querySelector('[data-act="tab"][data-tab="run"]').click();
    await tick(10);
    const body = () => doc.querySelector('.pi-body').textContent;
    assert.match(body(), /回到公寓/);
    assert.doesNotMatch(body(), /回到列车/);
    const infNow = () => instance.runtime.infState().inf;
    const aiSay = async text => {
        host.context.chat.push({ is_user: false, mes: text });
        await host.eventSource.emit('message_received', host.context.chat.length - 1, 'normal');
    };
    host.context.chat.push({ is_user: true, mes: '出门' });
    await aiSay('<末班车状态>\n列车：停站\n</末班车状态>');
    await tick(30);
    assert.equal(host.llmCalls.length, 0, '旧标签和旧词不再触发');
    await aiSay('正文。\n<公寓状态>\n公寓：出门\n</公寓状态>');
    for (let i = 0; i < 60 && infNow().phase !== 'world'; i += 1) await tick(10);
    assert.equal(infNow().phase, 'world', '状态块写「出门」开副本');
    assert.equal(instance.runtime.lastRead().state, '出门');
    const pieces = (await entriesNow(host.eventSource)).map(entry => entry.content).join('|');
    assert.match(pieces, /<公寓状态>[\s\S]*<世界档案>[\s\S]*渡口起雾/);
    assert.doesNotMatch(pieces, /列车/);
    await aiSay('<公寓状态>\n公寓：进门\n</公寓状态>');
    await tick(20);
    assert.equal(infNow().phase, 'train', '写「进门」关副本');
    assert.match(infNow().log.at(-1), /回公寓/);
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await instance.destroy();
});

test('无限流开副本：手动按钮，读取卡里（关闭的）恐怖类型写法条目放进提示，不进正文注入；找不到就跳过并记日志', async () => {
    const host = await boot();
    const { instance } = host;
    const project = await instance.data.createProject('末班车', '', 'infinite');
    await instance.runtime.switchProject(project.id);
    instance.data.updateProject(project.id, current => ({ ...current, infinite: { ...current.infinite, pools: { ...current.infinite.pools, horror: [{ label: '中式民俗', weight: 1 }] } } }));
    const prefix = instance.data.project(project.id).infinite.config.horrorPrefix;
    const book = { entries: {
        0: { uid: 0, comment: `${prefix}中式民俗`, content: '写法：不见鬼，只见规矩。', disable: true },
        1: { uid: 1, comment: `${prefix}规则怪谈`, content: '不该读到。', disable: true },
    } };
    host.context.chatMetadata.world_info = '测试书';
    host.context.loadWorldInfo = async () => JSON.parse(JSON.stringify(book));
    host.context.saveWorldInfo = async () => { throw new Error('不应写回世界书'); };
    host.context.chat.push({ is_user: true, mes: '开车' }, { is_user: false, mes: '列车进站。' });
    const prompts = [];
    let reply = WORLD_REPLY;
    host.win.__reply = messages => { prompts.push(messages); return reply; };
    host.click();
    await tick(10);
    const doc = host.win.document;
    doc.querySelector('[data-act="tab"][data-tab="run"]').click();
    await tick(10);
    doc.querySelector('[data-act="inf-enter"]').click();
    for (let i = 0; i < 40 && instance.runtime.infState().inf.phase !== 'world'; i += 1) await tick(10);
    assert.equal(instance.runtime.infState().inf.phase, 'world', '手动按钮开副本');
    const user = prompts[0][1].content;
    assert.ok(user.includes('【本世界恐怖类型写法】'), '提示里带上恐怖类型写法');
    assert.ok(user.includes('写法：不见鬼，只见规矩。'));
    assert.ok(!user.includes('不该读到'), '只读同标题的条目');
    const lore = await entriesNow(host.eventSource);
    assert.ok(!lore.map(entry => entry.content).join('|').includes('不见鬼，只见规矩'), '写法条目不进正文注入');
    const payload = { globalLore: [], characterLore: [{ uid: 0, comment: `${prefix}中式民俗`, content: 'x', disable: true }], chatLore: [], personaLore: [] };
    await host.eventSource.emit('worldinfo_entries_loaded', payload);
    assert.equal(payload.characterLore[0].disable, true, '加载时不放行任何条目');
    assert.equal(payload.characterLore[0].constant, undefined);

    // 解析失败：给出提示后重试；三次都失败弹出可重试的提示，不进入世界。
    instance.runtime.returnToTrain();
    book.entries = {};
    prompts.length = 0;
    reply = '乱写一通';
    assert.equal(await instance.runtime.openWorld(), null);
    assert.equal(prompts.length, 3, '解析失败共试 3 次');
    assert.ok(prompts[1][1].content.includes('缺少【档案】部分'), '重试时带上失败原因');
    assert.ok(!prompts[0][1].content.includes('本世界恐怖类型写法'), '找不到条目就不带');
    assert.equal(instance.runtime.infState().inf.phase, 'train');
    assert.ok(doc.querySelector('[data-notice="inf-stop"]'), '失败时有提示');
    const log = instance.runtime.diagnose().logs.map(item => item.text).join('|');
    assert.ok(log.includes(`卡里没找到「${prefix}中式民俗」`), '日志里记一笔');
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await instance.destroy();
});

test('多卷写作中途切换项目：已写好的卷收进原项目草稿，回到该项目可见并能全部追加', async () => {
    const host = await boot();
    const project = await withProject(host);
    const other = await host.instance.data.createProject('海岛线');
    let calls = 0;
    host.win.__reply = async () => {
        calls += 1;
        if (calls > 1) await tick(80);
        return `\`\`\`yaml\n剧情_卷${calls + 1}_新:\n  阶段一_起:\n    时间范围: 之后\n    主线节点:\n      - 名称: 丙${calls}\n        事件: 丙${calls}发生。\n\`\`\``;
    };
    host.click();
    await tick(10);
    const doc = host.win.document;
    doc.querySelector('[data-act="tab"][data-tab="outline"]').click();
    await tick(30);
    doc.querySelector('[data-act="ai-volume"]').click();
    await tick(20);
    doc.querySelector('.pi-dialog [data-wv-n]').value = '2';
    doc.querySelector('.pi-dialog .pi-dlg-acts .is-primary').click();
    await tick(30);
    doc.querySelector(`.pi-side [data-act="project"][data-id="${other.id}"]`).click();
    await tick(200);
    doc.querySelector('[data-act="tab"][data-tab="outline"]').click();
    await tick(30);
    assert.equal(doc.querySelector('[data-act="multi-append"]'), null, '别的项目不显示这份草稿');
    doc.querySelector(`.pi-side [data-act="project"][data-id="${project.id}"]`).click();
    await tick(40);
    doc.querySelector('[data-act="tab"][data-tab="outline"]').click();
    await tick(30);
    const append = doc.querySelector('[data-act="multi-append"]');
    assert.ok(append, '回到原项目能看到草稿');
    assert.equal(append.disabled, false);
    assert.equal(calls, 2, '两卷都已写完');
    append.click();
    await tick(30);
    assert.equal(host.instance.data.project(project.id).outline.volumes.length, 3, '全部追加进原项目');
    assert.equal(host.instance.data.project(other.id).outline.volumes.length, 0);
    await host.instance.destroy();
});

// ---------- 分阶段人设 ----------

const personaLines = [
    {
        id: 'pl1', group: '柳云岚', name: '对顾小川', keys: [], constant: true, position: 0, depth: 4, role: 0, order: 100, enabled: true, common: '柳云岚是邻家歌手。',
        mode: 'check', fame: { bar: '', partner: '' }, source: null, sources: [],
        stages: [{ id: 's1', name: '敌对', cond: '', unitId: '', range: {}, text: '她对他充满敌意。' }, { id: 's2', name: '动摇', cond: '顾小川帮了她', unitId: '', range: {}, text: '她动摇了。' }],
    },
    {
        id: 'pl2', group: '节目组', name: '节目组态度', keys: [], constant: true, position: 0, depth: 4, role: 0, order: 101, enabled: true, common: '',
        mode: 'fame', fame: { bar: '节目组态度', partner: '' }, source: null, sources: [],
        stages: [{ id: 'f1', name: '低', cond: '', unitId: '', range: { max: 20 }, text: '节目组恨不得换掉顾小川。' }, { id: 'f2', name: '高', cond: '', unitId: '', range: { min: 21 }, text: '节目组全力保护顾小川。' }],
    },
];

async function withPersonas(host, { lines = personaLines, withOutline = true } = {}) {
    const project = withOutline ? await withProject(host) : await host.instance.data.createProject('人设线');
    if (!withOutline) await host.instance.runtime.switchProject(project.id);
    host.instance.data.updateProject(project.id, current => ({ ...current, personas: { lines, fixed: [{ id: 'fx1', name: '性别', options: ['他', '她'], varPath: '' }], imported: [] } })); // 带旧数据的 fixed，读入时应被丢弃
    return project;
}

const clickText = (doc, selector, label) => [...doc.querySelectorAll(selector)].find(btn => btn.textContent.trim() === label).click();

test('分阶段人设：注入虚拟条目（旧数据带 fixed 读入不报错、不弹窗），执行页手动切换阶段', async () => {
    const host = await boot();
    await withPersonas(host);
    host.win.IGS = { stats: { fame: () => [{ name: '节目组态度', owner: '顾小川', cls: '口碑', value: 10, tier: '' }] } };
    const doc = host.win.document;
    const pending = entriesNow(host.eventSource);
    await tick(10);
    assert.equal(doc.querySelector('.pi-dialog'), null, '不再弹固定选项');
    let lore = await pending;
    const persona = lore.filter(entry => entry.comment.startsWith('剧情注入器·人设'));
    assert.deepEqual(persona.map(entry => entry.comment), ['剧情注入器·人设·柳云岚·对顾小川', '剧情注入器·人设·节目组·节目组态度']);
    assert.equal(persona[0].content, '柳云岚是邻家歌手。\n她对他充满敌意。');
    assert.equal(persona[1].content, '节目组恨不得换掉顾小川。');
    host.click();
    await tick(10);
    doc.querySelector('[data-act="tab"][data-tab="persona"]').click();
    await tick(10);
    assert.match(doc.querySelector('.pi-body').textContent, /对顾小川/);
    doc.querySelector('[data-act="tab"][data-tab="run"]').click();
    await tick(10);
    assert.match(doc.querySelector('.pi-body').textContent, /人设阶段/);
    assert.equal(doc.querySelector('[data-pfixed]'), null);
    doc.querySelector('[data-act="persona-pick"][data-line="pl1"][data-stage="s2"]').click();
    await tick(10);
    assert.ok(doc.querySelector('[data-act="persona-pick"][data-stage="s2"]').classList.contains('is-on'));
    assert.match(doc.querySelector('.pi-body').textContent, /手动/);
    lore = await entriesNow(host.eventSource);
    assert.match(lore.find(entry => entry.comment.endsWith('对顾小川')).content, /她动摇了/);
    const meta = host.context.chatMetadata.plotInjector;
    assert.equal(meta.byProject[meta.projectId].personas.pl1, 's2');
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await host.instance.destroy();
});

test('分阶段人设：读声望随 IGS 读数与 igs:stats-changed 事件变化，读不到值时标灰并退回手动值', async () => {
    const host = await boot();
    const project = await withPersonas(host, { lines: [personaLines[1]] });
    let value = 10;
    host.win.IGS = { stats: { fame: () => [{ name: '节目组态度', owner: '顾小川', cls: '口碑', value, tier: '' }] } };
    const text = async () => (await entriesNow(host.eventSource)).find(entry => entry.comment.endsWith('节目组态度')).content;
    assert.match(await text(), /换掉/);
    value = 50;
    host.win.dispatchEvent(new host.win.CustomEvent('igs:stats-changed', { detail: { reason: 'ledger' } }));
    await tick(10);
    assert.match(await text(), /全力保护/);
    host.win.IGS = undefined;
    assert.match(await text(), /换掉/, '读不到值退回手动值（未手动选过为第一阶段）');
    host.click();
    await tick(10);
    host.win.document.querySelector('[data-act="tab"][data-tab="run"]').click();
    await tick(10);
    assert.match(host.win.document.querySelector('.pi-body').textContent, /读不到声望/);
    await host.instance.destroy();
});

test('分阶段人设：条件检测并入定期检测请求，采用后推进一格；检测提示不带人设正文', async () => {
    const host = await boot();
    const project = await withPersonas(host, { lines: [personaLines[0]] });
    host.instance.data.updateSettings({ checkEvery: 2 });
    host.win.__reply = () => '{"done":[],"stageDone":false,"reason":"x","personas":[{"line":"柳云岚·对顾小川","to":"动摇","floor":1,"reason":"顾小川帮了她"}]}';
    host.context.chat.push({ is_user: true, mes: '一' }, { is_user: false, mes: '顾小川帮了柳云岚。' });
    await host.eventSource.emit('message_received', 1, 'normal');
    await tick(10);
    assert.equal(host.llmCalls.length, 1);
    assert.match(host.llmCalls[0][1].content, /【人设阶段】\n- 柳云岚·对顾小川：当前「敌对」；下一阶段「动摇」，进入条件：顾小川帮了她/);
    assert.doesNotMatch(host.llmCalls[0][0].content + host.llmCalls[0][1].content, /充满敌意|她动摇了/);
    const card = host.win.document.querySelector('[data-notice="persona"]');
    assert.ok(card);
    assert.match(card.textContent, /柳云岚 · 对顾小川：敌对 → 动摇（第 1 楼：顾小川帮了她）/);
    const stage = () => (host.instance.runtime.progress().personas || {}).pl1;
    assert.equal(stage(), undefined);
    clickText(host.win.document, '[data-notice="persona"] button', '采用');
    await tick(10);
    assert.equal(stage(), 's2');
    await host.instance.destroy();
});

test('分阶段人设：自动模式直接推进并可撤销；设为不检测时检测提示不带人设', async () => {
    const host = await boot();
    const project = await withPersonas(host, { lines: [personaLines[0]] });
    host.instance.data.updateSettings({ checkEvery: 2, personaMode: 'auto' });
    host.win.__reply = () => '{"done":[],"stageDone":false,"personas":[{"line":"对顾小川","to":"动摇"}]}';
    host.context.chat.push({ is_user: true, mes: '一' }, { is_user: false, mes: '正文。' });
    await host.eventSource.emit('message_received', 1, 'normal');
    await tick(10);
    assert.equal(host.instance.runtime.progress().personas.pl1, 's2');
    clickText(host.win.document, '[data-notice="persona"] button', '撤销');
    await tick(10);
    assert.equal(host.instance.runtime.progress().personas.pl1, 's1');
    host.instance.data.updateSettings({ personaMode: 'off' });
    host.context.chat.push({ is_user: true, mes: '二' }, { is_user: false, mes: '正文二。' });
    host.llmCalls.length = 0;
    await host.eventSource.emit('message_received', 3, 'normal');
    await tick(10);
    assert.equal(host.llmCalls.length, 1);
    assert.doesNotMatch(host.llmCalls[0][0].content + host.llmCalls[0][1].content, /personas|人设/);
    await host.instance.destroy();
});

test('分阶段人设：没有大纲时也能只检测人设阶段', async () => {
    const host = await boot();
    const project = await withPersonas(host, { lines: [personaLines[0]], withOutline: false });
    host.instance.data.updateSettings({ checkEvery: 2 });
    host.win.__reply = () => '{"personas":[{"line":"对顾小川","to":"动摇","floor":1,"reason":"帮了"}]}';
    host.context.chat.push({ is_user: true, mes: '一' }, { is_user: false, mes: '正文。' });
    await host.eventSource.emit('message_received', 1, 'normal');
    await tick(10);
    assert.equal(host.llmCalls.length, 1);
    assert.doesNotMatch(host.llmCalls[0][0].content, /剧情索引|stageDone/);
    assert.ok(host.win.document.querySelector('[data-notice="persona"]'));
    await host.instance.destroy();
});

test('分阶段人设：世界书转入，勾选预览后转入并关闭原条目，恢复后重新开启并可删除对应线', async () => {
    const host = await boot();
    const project = await withPersonas(host, { lines: [] });
    host.instance.data.updateProject(project.id, current => ({ ...current, personas: { lines: [], imported: [] } }));
    const card = JSON.parse(fs.readFileSync(path.join(root, 'tests/fixtures/persona-card.json'), 'utf8'));
    const book = { entries: JSON.parse(JSON.stringify(card.entries)) };
    book.entries[99] = { uid: 99, comment: '无 if 条目', content: '普通内容', disable: false, key: [], constant: true };
    host.context.chatMetadata.world_info = '示例世界书';
    host.context.getWorldInfoNames = () => ['示例世界书'];
    host.context.loadWorldInfo = async () => JSON.parse(JSON.stringify(book));
    host.context.saveWorldInfo = async (name, data) => { book.entries = data.entries; };
    host.click();
    await tick(10);
    const doc = host.win.document;
    doc.querySelector('[data-act="tab"][data-tab="persona"]').click();
    await tick(10);
    doc.querySelector('[data-act="imp-open"]').click();
    await tick(30);
    const rows = [...doc.querySelectorAll('.pi-dialog [data-pi-pick]')];
    assert.equal(rows.length, 5, '只列含 if 的条目');
    assert.ok(rows.every(row => !row.checked), '默认全不勾');
    const row = rows.find(item => item.dataset.piPick === '28');
    row.checked = true;
    row.dispatchEvent(new host.win.Event('change', { bubbles: true }));
    await tick(10);
    clickText(doc, '.pi-dialog [data-dlg]', '预览');
    await tick(10);
    assert.match(doc.querySelector('.pi-dialog').textContent, /对顾小川/);
    assert.match(doc.querySelector('.pi-dialog').textContent, /4 阶段/);
    clickText(doc, '.pi-dialog [data-dlg]', '转入');
    await tick(50);
    const now = host.instance.data.project(project.id);
    assert.equal(now.personas.lines.length, 1);
    assert.equal(now.personas.lines[0].stages.length, 4);
    assert.equal(now.personas.imported.map(item => item.key).join(), '28');
    assert.equal(book.entries[28].disable, true, '原条目只关不删');
    assert.equal(book.entries[7].disable, false, '没勾的不动');
    doc.querySelector('[data-act="imp-restore"]').click();
    await tick(20);
    clickText(doc, '.pi-dialog [data-dlg]', '恢复并删除对应人设线');
    await tick(50);
    assert.equal(book.entries[28].disable, false);
    const after = host.instance.data.project(project.id);
    assert.equal(after.personas.lines.length, 0);
    assert.equal(after.personas.imported.length, 0);
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await host.instance.destroy();
});
