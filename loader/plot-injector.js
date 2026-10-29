(function () {
    'use strict';

    // 只负责从 GitHub 取业务代码；本文件很少改，只有它变了才需要重新导入 json。
    // QR 按钮先绑定：程序还在下载或下载失败时，点按钮能看到原因。
    const REPOSITORY = 'Anyno001/PlotInjector';
    const BUNDLE = 'dist/plot-injector.js';
    const BUTTON = '剧情注入';
    const TAG_TTL = 6 * 60 * 60 * 1000;
    const UI_KEY = 'pi-ui';

    const host = (() => {
        try { if (window.parent && window.parent !== window && window.parent.document) return window.parent; } catch (error) { /* 跨域 */ }
        return window;
    })();
    const status = { stage: '正在读取版本', error: '' };
    window.__plotInjectorLoader = status;

    function notify(kind, message) {
        const t = host.toastr || window.toastr;
        if (t && typeof t[kind] === 'function') t[kind](message, '剧情注入器');
        else console.info(`[剧情注入器] ${message}`);
    }

    function onButton() {
        const app = host.__plotInjector;
        if (app && typeof app.open === 'function') return app.open();
        if (status.error) notify('error', `${status.error}\n连不上 GitHub 时，可在酒馆助手里改为导入单文件版 plot-injector-standalone.json。`);
        else notify('info', `${status.stage}，请稍候再点。`);
    }

    if (typeof eventOn === 'function' && typeof getButtonEvent === 'function') {
        if (typeof appendInexistentScriptButtons === 'function') appendInexistentScriptButtons([{ name: BUTTON, visible: true }]);
        eventOn(getButtonEvent(BUTTON), onButton);
        status.bound = true;
    }

    function readUi() {
        try { return JSON.parse(host.localStorage.getItem(UI_KEY) || '{}') || {}; } catch (error) { return {}; }
    }

    function writeUi(patch) {
        try { host.localStorage.setItem(UI_KEY, JSON.stringify({ ...readUi(), ...patch })); } catch (error) { /* 存储不可用 */ }
    }

    async function get(url, ms, init = {}) {
        const controller = new AbortController();
        const timer = setTimeout(() => controller.abort(), ms);
        try {
            const res = await host.fetch(url, { ...init, signal: controller.signal });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            return res;
        } catch (error) {
            throw controller.signal.aborted ? new Error(`连接超时（${ms / 1000} 秒）`) : error;
        } finally {
            clearTimeout(timer);
        }
    }

    function compareVersions(a, b) {
        const pa = a.replace(/^v/, '').split('.').map(Number);
        const pb = b.replace(/^v/, '').split('.').map(Number);
        for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
        return 0;
    }

    async function pinnedRef() {
        try {
            const res = await get(`/user/files/pi-index.json?t=${Date.now()}`, 8000, { cache: 'no-store' });
            const index = await res.json();
            return String(index && index.settings && index.settings.loaderRef || '').trim();
        } catch (error) {
            return '';
        }
    }

    async function fromGithub() {
        const res = await get(`https://api.github.com/repos/${REPOSITORY}/tags?per_page=100`, 6000, { cache: 'no-store' });
        const tags = (await res.json()).map(item => item && item.name).filter(name => /^v\d+\.\d+\.\d+$/.test(name || ''));
        return tags.sort(compareVersions).pop() || '';
    }

    // 国内网络常连不上 api.github.com，改问 jsDelivr；它可能比刚推的标签慢几分钟。
    async function fromJsdelivr() {
        const res = await get(`https://data.jsdelivr.com/v1/packages/gh/${REPOSITORY}/resolved?specifier=latest`, 8000, { cache: 'no-store' });
        const data = await res.json();
        return data && /^\d+\.\d+\.\d+$/.test(data.version || '') ? `v${data.version}` : '';
    }

    async function latestTag() {
        const cached = readUi().loader;
        if (cached && cached.tag && Date.now() - cached.at < TAG_TTL) return cached.tag;
        for (const source of [fromGithub, fromJsdelivr]) {
            try {
                const tag = await source();
                if (tag) {
                    writeUi({ loader: { tag, at: Date.now() } });
                    return tag;
                }
            } catch (error) {
                console.warn('[剧情注入器] 读取最新版本失败', source.name, error);
            }
        }
        return cached && cached.tag ? cached.tag : 'main';
    }

    async function fetchBundle(url) {
        const res = await get(url, 20000, { cache: url.includes('pi_t=') ? 'no-store' : 'default' });
        const text = await res.text();
        if (!/^\/\/ PlotInjector v\d+\.\d+\.\d+/.test(text)) throw new Error('返回的不是剧情注入器程序');
        return text;
    }

    function run(code, url) {
        const src = URL.createObjectURL(new Blob([`${code}\n//# sourceURL=${url}`], { type: 'text/javascript' }));
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.onload = () => { URL.revokeObjectURL(src); resolve(); };
            script.onerror = () => { URL.revokeObjectURL(src); reject(new Error('程序执行失败')); };
            document.head.appendChild(script);
        });
    }

    async function main() {
        const ref = (await pinnedRef()) || (await latestTag());
        status.stage = `正在下载 ${ref}`;
        const bust = ref === 'main' ? `?pi_t=${Math.floor(Date.now() / 60000)}` : '';
        const urls = [
            `https://cdn.jsdelivr.net/gh/${REPOSITORY}@${ref}/${BUNDLE}${bust}`,
            `https://fastly.jsdelivr.net/gh/${REPOSITORY}@${ref}/${BUNDLE}${bust}`,
            `https://raw.githubusercontent.com/${REPOSITORY}/${ref}/${BUNDLE}${bust || `?pi_t=${Date.now()}`}`,
        ];
        const errors = [];
        for (const url of urls) {
            try {
                const code = await fetchBundle(url);
                status.stage = '正在启动';
                await run(code, url);
                if (!host.__plotInjector) throw new Error('程序已下载但没有启动，可能是酒馆版本过旧');
                status.stage = '已就绪';
                return;
            } catch (error) {
                errors.push(`${new URL(url).host}：${error.message}`);
                console.warn('[剧情注入器] 加载失败，换备用地址。', url, error);
            }
        }
        status.error = `剧情注入器加载失败（${ref}）。${errors.join('；')}`;
        notify('error', status.error);
    }

    main().catch(error => {
        status.error = `剧情注入器加载失败：${error && error.message}`;
        notify('error', status.error);
    });
})();
