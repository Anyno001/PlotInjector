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
        eventTypes: { WORLDINFO_ENTRIES_LOADED: 'worldinfo_entries_loaded', CHAT_CHANGED: 'chat_id_changed', MESSAGE_RECEIVED: 'message_received', MESSAGE_SWIPED: 'message_swiped', MESSAGE_UPDATED: 'message_updated', MESSAGE_DELETED: 'message_deleted' },
        getRequestHeaders: () => ({ 'X-CSRF-Token': 't' }),
        getCurrentChatId: () => 'chat-1',
        saveMetadataDebounced() {},
        async saveMetadata() {},
        getWorldInfoNames: () => [],
    };
    win.SillyTavern = { libs: { yaml: YAML }, getContext: () => context };
    win.toastr = { info() {}, success() {}, warning() {}, error(msg) { win.__errors.push(msg); } };
    win.__errors = [];
    win.TavernHelper = {
        async generateRaw({ ordered_prompts: prompts }) {
            llmCalls.push(prompts);
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
    instance.data.saveProject({ ...project, setting: { ...project.setting, text: '世界观声明:\n基于: 测试' }, outline: { volumes: volumes(OUTLINE) } });
    await instance.runtime.switchProject(project.id);
    return project;
}

async function entriesNow(eventSource) {
    const payload = { globalLore: [], characterLore: [], chatLore: [], personaLore: [] };
    await eventSource.emit('worldinfo_entries_loaded', payload);
    return payload.chatLore;
}

test('发布文件启动后，本卡项目的设定、索引、当前阶段详细作为常驻虚拟条目进入世界书管线', async () => {
    const host = await boot();
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await withProject(host);
    const lore = await entriesNow(host.eventSource);
    assert.deepEqual(lore.map(entry => entry.comment), ['剧情注入器·设定', '剧情注入器·剧情索引', '剧情注入器·卷一·测试·阶段一']);
    assert.ok(lore.every(entry => entry.constant && entry.ignoreBudget && !entry.disable && entry.world === '剧情注入器'));
    assert.deepEqual(lore.map(entry => entry.position), [1, 1, 4]);
    assert.doesNotMatch(lore[1].content, /undefined/);
    await host.instance.data.flush();
    const index = JSON.parse(host.files.get('pi-index.json'));
    assert.equal(index.projects.length, 1);
    assert.equal(index.active['char:test.png'], index.projects[0].id);
    assert.ok(host.files.has(`pi-p-${index.projects[0].id}.json`));
    assert.deepEqual(Object.keys(host.win.localStorage), []);
    await host.instance.destroy();
    assert.equal((await entriesNow(host.eventSource)).length, 0);
});

test('AI 正文带 <剧情推进/> 时询问；点「打开下一段」后详细换成下一阶段，进度写进聊天元数据', async () => {
    const host = await boot();
    await withProject(host);
    host.instance.data.updateSettings({ switchSource: 'signal' });
    host.context.chat.push({ is_user: true, mes: '你好' }, { is_user: false, mes: '甲发生了。\n<剧情推进/>' });
    await host.eventSource.emit('message_received', 1, 'normal');
    const card = host.win.document.querySelector('[data-notice="advance"]');
    assert.ok(card, '应弹出询问卡片');
    card.querySelector('[data-act="0"]').click();
    const lore = await entriesNow(host.eventSource);
    assert.match(lore[2].content, /阶段二_发展/);
    assert.match(lore[1].content, /已过：卷一·测试·阶段一 开端（甲事件）/);
    const meta = host.context.chatMetadata.plotInjector;
    assert.ok(meta.byProject[meta.projectId].current);
    await host.instance.destroy();
});

test('每 N 楼兜底检测：到点调用检测接口，取消已演节点并提示', async () => {
    const host = await boot();
    await withProject(host);
    host.instance.data.updateSettings({ switchSource: 'check', checkEvery: 2 });
    host.context.chat.push({ is_user: true, mes: '一' }, { is_user: false, mes: '<think>想</think>甲发生了。' });
    await host.eventSource.emit('message_received', 1, 'normal');
    await tick(10);
    assert.equal(host.llmCalls.length, 1);
    assert.doesNotMatch(host.llmCalls[0][1].content, /<think>|想/);
    assert.ok(host.win.document.querySelector('[data-notice="advance"]'));
    const lore = await entriesNow(host.eventSource);
    assert.doesNotMatch(lore[2].content, /甲事件/);
    await host.instance.destroy();
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
    for (const page of ['settings', 'data', 'books']) {
        doc.querySelector(`.pi-side [data-act="page"][data-page="${page}"]`).click();
        await tick(20);
        assert.ok(doc.querySelector('.pi-body').textContent.length > 20, page);
    }
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
    await host.instance.destroy();
    assert.equal(doc.querySelector('.pi-overlay'), null);
    assert.equal(doc.getElementById('pi-style'), null);
});

test('接口预设：获取模型后下拉选择，多个用途共用一个预设，删除后回到酒馆连接', async () => {
    const host = await boot();
    await withProject(host);
    host.click();
    await tick(10);
    const doc = host.win.document;
    const fire = (node, type) => node.dispatchEvent(new host.win.Event(type, { bubbles: true }));
    doc.querySelector('.pi-side [data-act="page"][data-page="settings"]').click();
    await tick(10);
    doc.querySelector('[data-act="preset-new"]').click();
    await tick(10);
    const dlg = doc.querySelector('.pi-dialog');
    dlg.querySelector('[data-f="name"]').value = '测试接口';
    dlg.querySelector('[data-f="endpoint"]').value = 'https://api.example.com/v1';
    dlg.querySelector('[data-fetch-models]').click();
    await tick(30);
    const pick = dlg.querySelector('select[data-f="model"]');
    assert.ok(pick, '获取后应出现模型下拉框');
    assert.deepEqual([...pick.options].filter(option => !option.disabled).map(option => option.value), ['model-a', 'model-b', '__manual']);
    pick.value = 'model-b';
    dlg.querySelector('.pi-dlg-acts .is-primary').click();
    await tick(10);
    const settings = () => host.instance.data.settings();
    assert.equal(settings().presets.length, 1);
    assert.equal(settings().presets[0].model, 'model-b');
    const id = settings().presets[0].id;
    for (const role of ['discuss', 'check']) {
        const select = doc.querySelector(`[data-role-pick="${role}"]`);
        select.value = `p:${id}`;
        fire(select, 'change');
    }
    for (const role of ['discuss', 'check']) assert.equal(`${settings().llm[role].source}:${settings().llm[role].presetId}`, `preset:${id}`);
    assert.equal(settings().llm.outline.source, 'tavern');
    doc.querySelector(`[data-act="preset-del"][data-id="${id}"]`).click();
    await tick(10);
    doc.querySelector('.pi-dialog .pi-dlg-acts .is-danger').click();
    await tick(10);
    assert.equal(settings().presets.length, 0);
    assert.equal(settings().llm.discuss.source, 'tavern');
    assert.equal(settings().llm.check.source, 'tavern');
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
    const sections = () => [...doc.querySelectorAll('.pi-wb-sec')].map(sec => [...sec.querySelectorAll('[data-wb-toggle]')].map(input => [input.dataset.wbToggle, input.checked]));
    assert.deepEqual(sections(), [[['0', true]], [['1', false]]]);
    const open = doc.querySelector('[data-wb-toggle="0"]');
    open.checked = false;
    fire(open, 'change');
    await tick(20);
    assert.equal(book.entries[0].disable, true);
    assert.deepEqual(sections(), [[], [['0', false], ['1', false]]]);
    assert.equal(host.win.__errors.length, 0, host.win.__errors.join('\n'));
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
    const box = doc.querySelector('[data-node="m0"]');
    box.checked = false;
    fire(box, 'change');
    let lore = await entriesNow(host.eventSource);
    assert.doesNotMatch(lore[2].content, /甲事件/);

    doc.querySelector('[data-act="tab"][data-tab="outline"]').click();
    [...doc.querySelectorAll('.pi-titem')].find(item => item.textContent.includes('阶段二')).click();
    const range = doc.querySelector('[data-stage-field="时间范围"]');
    range.value = '改过的时间';
    fire(range, 'input');
    lore = await entriesNow(host.eventSource);
    assert.match(lore[1].content, /下一段：.*改过的时间/);

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
