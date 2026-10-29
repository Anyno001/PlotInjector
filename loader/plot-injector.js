(function () {
    'use strict';

    // 只负责从 GitHub 取业务代码；本文件很少改，只有它变了才需要重新导入 json。
    const REPOSITORY = 'Anyno001/PlotInjector';
    const BUNDLE = 'dist/plot-injector.js';
    const TAG_TTL = 6 * 60 * 60 * 1000;
    const UI_KEY = 'pi-ui';

    const host = (() => {
        try { if (window.parent && window.parent !== window && window.parent.document) return window.parent; } catch (error) { /* 跨域 */ }
        return window;
    })();

    function readUi() {
        try { return JSON.parse(host.localStorage.getItem(UI_KEY) || '{}') || {}; } catch (error) { return {}; }
    }

    function writeUi(patch) {
        try { host.localStorage.setItem(UI_KEY, JSON.stringify({ ...readUi(), ...patch })); } catch (error) { /* 存储不可用 */ }
    }

    function compareVersions(a, b) {
        const pa = a.replace(/^v/, '').split('.').map(Number);
        const pb = b.replace(/^v/, '').split('.').map(Number);
        for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
        return 0;
    }

    async function pinnedRef() {
        try {
            const res = await host.fetch(`/user/files/pi-index.json?t=${Date.now()}`, { cache: 'no-store' });
            if (!res.ok) return '';
            const index = await res.json();
            return String(index && index.settings && index.settings.loaderRef || '').trim();
        } catch (error) {
            return '';
        }
    }

    async function latestTag() {
        const cached = readUi().loader;
        if (cached && cached.tag && Date.now() - cached.at < TAG_TTL) return cached.tag;
        try {
            const res = await host.fetch(`https://api.github.com/repos/${REPOSITORY}/tags?per_page=100`, { cache: 'no-store' });
            if (!res.ok) throw new Error(`HTTP ${res.status}`);
            const tags = (await res.json()).map(item => item && item.name).filter(name => /^v\d+\.\d+\.\d+$/.test(name || ''));
            const tag = tags.sort(compareVersions).pop();
            if (tag) {
                writeUi({ loader: { tag, at: Date.now() } });
                return tag;
            }
        } catch (error) {
            console.warn('[剧情注入器] 读取最新版本失败，沿用缓存。', error);
        }
        return cached && cached.tag ? cached.tag : 'main';
    }

    async function fetchText(url) {
        const res = await host.fetch(url, { cache: url.includes('pi_t=') ? 'no-store' : 'default' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const text = await res.text();
        if (!/^\/\/ PlotInjector v\d+\.\d+\.\d+/.test(text)) throw new Error('返回的不是剧情注入器程序');
        return text;
    }

    function run(code, url) {
        const blob = new Blob([`${code}\n//# sourceURL=${url}`], { type: 'text/javascript' });
        const src = URL.createObjectURL(blob);
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
        const bust = ref === 'main' ? `?pi_t=${Math.floor(Date.now() / 60000)}` : '';
        const urls = [
            `https://cdn.jsdelivr.net/gh/${REPOSITORY}@${ref}/${BUNDLE}${bust}`,
            `https://raw.githubusercontent.com/${REPOSITORY}/${ref}/${BUNDLE}${bust || `?pi_t=${Date.now()}`}`,
        ];
        let lastError = null;
        for (const url of urls) {
            try {
                await run(await fetchText(url), url);
                return;
            } catch (error) {
                lastError = error;
                console.warn('[剧情注入器] 加载失败，换备用地址。', url, error);
            }
        }
        const message = `剧情注入器加载失败（${ref}）：${lastError && lastError.message}`;
        if (host.toastr) host.toastr.error(message);
        else console.error(message);
    }

    main();
})();
