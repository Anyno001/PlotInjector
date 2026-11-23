import { afterEach } from 'node:test';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';
import YAML from 'yaml';

const testWindows = new Set();
afterEach(async()=>{for(const w of testWindows){try{await w.__plotInjector?.destroy();}finally{w.close();}}testWindows.clear();});

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
    const win = dom.window; testWindows.add(win);
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


const REWRITE = '```yaml\n剧情_卷一_测试:\n  阶段一_新开端:\n    时间范围: 偏离之后\n    主线节点:\n      - 名称: 丙事件\n        事件: 丙发生。\n```';



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





// ---------- 分阶段人设 ----------

const personaLines = [
    {
        id: 'pl1', group: '柳云岚', name: '对顾小川', keys: [], constant: true, position: 0, depth: 4, role: 0, order: 100, enabled: true, common: '柳云岚是邻家歌手。',
        defaultStage: '', mode: 'check', fame: { source: 'fame', dim: '好感', bar: '', partner: '' }, source: null, sources: [],
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






