import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { JSDOM } from 'jsdom';

// 执行发布的加载器 loader/plot-injector.json：假 GitHub、jsDelivr 和酒馆文件，检查「指定版本」写错时能否退回最新版。
const root = path.resolve(import.meta.dirname, '..');
const loader = JSON.parse(fs.readFileSync(path.join(root, 'loader/plot-injector.json'), 'utf8')).content;
const LATEST = 'v9.9.9';

function makeHost(pinned) {
    const dom = new JSDOM('<!doctype html><html><head></head><body></body></html>', { url: 'http://localhost:8000/', runScripts: 'outside-only' });
    const win = dom.window;
    const requested = [];
    const toasts = [];
    win.toastr = Object.fromEntries(['info', 'success', 'warning', 'error'].map(kind => [kind, msg => toasts.push(`${kind}:${msg}`)]));
    const respond = (status, body) => ({ ok: status < 400, status, text: async () => body, json: async () => JSON.parse(body) });
    win.fetch = async url => {
        const u = String(url);
        requested.push(u);
        if (u.startsWith('/user/files/pi-index.json')) return respond(200, JSON.stringify({ projects: [], settings: { loaderRef: pinned, checkEvery: 3 } }));
        if (u.startsWith('https://api.github.com/')) return respond(200, JSON.stringify([{ name: 'v0.1.0' }, { name: LATEST }]));
        const ref = /@([^/]+)\/dist|PlotInjector\/([^/]+)\/dist/.exec(u);
        const name = ref && (ref[1] || ref[2]);
        if (name === LATEST || name === 'v0.1.0') return respond(200, `// PlotInjector ${name}\nwindow.parent.__plotInjector = { open() {}, version: '${name}' };`);
        return respond(404, '');
    };
    // jsdom 不执行 blob 脚本：拦下加载器插入的 <script>，按记下的内容直接执行。
    const blobs = new Map();
    win.URL.createObjectURL = blob => { const id = `blob:${blobs.size}`; blobs.set(id, blob); return id; };
    win.URL.revokeObjectURL = () => {};
    const append = win.document.head.appendChild.bind(win.document.head);
    win.document.head.appendChild = node => {
        if (node.tagName === 'SCRIPT' && blobs.has(node.src)) {
            blobs.get(node.src).text().then(code => { win.eval(code); node.onload(); });
            return node;
        }
        return append(node);
    };
    return { win, requested, toasts };
}

async function boot(pinned) {
    const host = makeHost(pinned);
    host.win.eval(loader);
    for (let i = 0; i < 50 && !host.win.__plotInjector && host.win.__plotInjectorLoader.stage !== '失败'; i += 1) await new Promise(resolve => setTimeout(resolve, 10));
    return host;
}

test('加载器：指定版本可用时就用它', async () => {
    const host = await boot('v0.1.0');
    assert.equal(host.win.__plotInjector.version, 'v0.1.0');
    assert.ok(!host.requested.some(url => url.includes('api.github.com')), '不必再查最新版本');
});

test('加载器：指定版本不存在时退回最新版本并提示，不再打不开', async () => {
    const host = await boot('v0.1.99');
    assert.equal(host.win.__plotInjector.version, LATEST);
    assert.ok(host.toasts.some(msg => /warning:指定版本「v0.1.99」加载失败/.test(msg)));
});

test('加载器：指定版本格式不对（只填了半截）时直接用最新版本', async () => {
    const host = await boot('v0.1');
    assert.equal(host.win.__plotInjector.version, LATEST);
    assert.ok(!host.requested.some(url => url.includes('@v0.1/')), '不去下载半截版本');
    assert.ok(host.toasts.some(msg => /格式不对/.test(msg)));
});

test('加载器：指定了能下载但打开后看不见的旧版本时，点按钮弹出诊断框，可一键清空指定版本', async () => {
    const host = makeHost('v0.1.0');
    const uploads = [];
    const fetch = host.win.fetch;
    host.win.fetch = async (url, init = {}) => {
        if (String(url) === '/api/files/upload') {
            const body = JSON.parse(init.body);
            uploads.push(JSON.parse(Buffer.from(body.data, 'base64').toString('utf8')));
            return { ok: true, status: 200, text: async () => '{}' };
        }
        return fetch(url, init);
    };
    host.win.SillyTavern = { getContext: () => ({ getRequestHeaders: () => ({ 'X-CSRF-Token': 't' }) }) };
    let click = null;
    host.win.eventOn = (name, fn) => { click = fn; return { stop() {} }; };
    host.win.getButtonEvent = name => name;
    host.win.eval(loader);
    for (let i = 0; i < 50 && !host.win.__plotInjector; i += 1) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(host.toasts.some(msg => /正在使用指定版本 v0.1.0/.test(msg)));
    click();
    await new Promise(resolve => setTimeout(resolve, 500));
    const panel = host.win.document.getElementById('pi-loader-diag');
    assert.ok(panel, 'jsdom 里面板没有尺寸，按看不见处理，应弹出诊断框');
    assert.match(panel.querySelector('b').textContent, /没有正常显示/);
    const unpin = panel.querySelector('[data-a="unpin"]');
    assert.equal(unpin.hidden, false);
    unpin.click();
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(uploads.length, 1);
    assert.equal(uploads[0].settings.loaderRef, '');
    assert.equal(uploads[0].settings.checkEvery, 3, '其他设置原样保留');
});
