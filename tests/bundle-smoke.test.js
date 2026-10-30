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
    instance.data.saveProject({ ...project, setting: { ...project.setting, text: '世界观声明:\n基于: 测试' }, outline: { volumes: volumes(OUTLINE) } });
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
    assert.deepEqual(lore.map(entry => entry.position), [1, 4]);
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
        : REWRITE);
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
    const rewriteCall = host.llmCalls.at(-1);
    assert.match(rewriteCall[1].content, /【偏转说明】\n甲死了，改成丙线/);
    const stages = () => host.instance.data.project(project.id).outline.volumes[0].stages.map(stage => stage.key).join(',');
    assert.equal(stages(), '阶段一_新开端');
    let lore = await entriesNow(host.eventSource);
    assert.match(lore[1].content, /阶段一_新开端/);
    doc.querySelector('[data-notice="offtrack"] [data-act="0"]').click();
    await tick(10);
    assert.equal(stages(), '阶段一_开端,阶段二_发展');
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
        doc.querySelector(`.pi-side [data-act="page"][data-page="${page}"]`).click();
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
    doc.querySelector('.pi-side [data-act="page"][data-page="settings"]').click();
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
    const sections = () => [...doc.querySelectorAll('.pi-wb-sec')].map(sec => [...sec.querySelectorAll('[data-wb-toggle]')].map(input => [input.dataset.wbToggle, input.checked]));
    assert.deepEqual(sections(), [[['0', true]], [['1', false]]]);
    const open = doc.querySelector('[data-wb-toggle="0"]');
    open.checked = false;
    fire(open, 'change');
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
    assert.equal(doc.querySelectorAll('.pi-refs .pi-chip').length, 5, '顶栏不逐条列出条目');
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
    host.instance.data.updateProject(project.id, current => ({ ...current, setting: { ...current.setting, text: '世界观声明:\n基于: 测试\n\n铁则:\n- 甲\n\n人物档案:\n白墨' } }));
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
    assert.equal(setting.text, '世界观声明:\n基于: 测试\n\n人物档案:\n白墨');
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
