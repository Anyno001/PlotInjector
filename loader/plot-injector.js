(function () {
    'use strict';

    // 只负责从 GitHub 取业务代码；本文件很少改，只有它变了才需要重新导入 json。
    // QR 按钮先绑定：程序还在下载或下载失败时，点按钮能看到原因。
    const REPOSITORY = 'Anyno001/PlotInjector';
    const BUNDLE = 'dist/plot-injector.js';
    const BUTTON = '剧情注入';
    const TAG_TTL = 30 * 60 * 1000;
    // 构建时替换为当时的版本：jsDelivr 的「最新版本」可能滞后半天，不能比它更旧。
    const MIN_TAG = 'v0.0.0';
    const UI_KEY = 'pi-ui';

    const host = (() => {
        try { if (window.parent && window.parent !== window && window.parent.document) return window.parent; } catch (error) { /* 跨域 */ }
        return window;
    })();
    const LOADER_VERSION = '0.1.3';
    const status = { loader: LOADER_VERSION, stage: '正在读取版本', error: '', bound: [], attempts: [] };
    window.__plotInjectorLoader = status;
    const doc = host.document;

    function notify(kind, message) {
        const t = host.toastr || window.toastr;
        if (t && typeof t[kind] === 'function') t[kind](message, '剧情注入器');
        else console.info(`[剧情注入器] ${message}`);
    }

    async function diagnose() {
        const lines = [`加载器 v${LOADER_VERSION}`, `阶段：${status.stage}`];
        if (status.error) lines.push(`错误：${status.error}`);
        if (host.__plotInjectorBootError) lines.push(`程序启动失败：${host.__plotInjectorBootError}`);
        lines.push(`按钮绑定：${status.bound.join('、') || '无'}`);
        try {
            const res = await host.fetch('/version', { cache: 'no-store' });
            lines.push(`酒馆：${res.ok ? (await res.text()).slice(0, 160) : `HTTP ${res.status}`}`);
        } catch (error) { lines.push(`酒馆版本读取失败：${error.message}`); }
        try { lines.push(`酒馆助手：${typeof getTavernHelperVersion === 'function' ? await getTavernHelperVersion() : '没有 getTavernHelperVersion'}`); } catch (error) { lines.push(`酒馆助手版本读取失败：${error.message}`); }
        const st = host.SillyTavern;
        let c = null;
        try { c = st && st.getContext ? st.getContext() : null; } catch (error) { /* 下面照常报 */ }
        lines.push(`SillyTavern.libs.yaml：${st && st.libs && st.libs.yaml ? '有' : '无'}`);
        lines.push(`条目加载事件：${c && c.eventTypes && c.eventTypes.WORLDINFO_ENTRIES_LOADED ? '有' : '无'}`);
        lines.push(`浏览器：${host.navigator.userAgent}`);
        if (status.attempts.length) lines.push('', '网络：', ...status.attempts);
        return lines.join('\n');
    }

    // 程序没就绪时点按钮：弹出诊断面板，可复制给开发者。
    async function showDiagnosis() {
        let panel = doc.getElementById('pi-loader-diag');
        if (!panel) {
            if (!doc.getElementById('pi-loader-diag-style')) {
                const style = doc.createElement('style');
                style.id = 'pi-loader-diag-style';
                style.textContent = '#pi-loader-diag{position:fixed;left:10px;right:10px;top:10px;max-height:80vh;z-index:2147483000;background:#fff;color:#1e1e2e;border-radius:12px;box-shadow:0 8px 32px rgba(0,0,0,.3);display:flex;flex-direction:column;gap:8px;padding:12px;font:13px/1.5 sans-serif}#pi-loader-diag textarea{min-height:240px;flex:1;width:100%;box-sizing:border-box;font:12px/1.45 monospace;color:#1e1e2e;background:#f8f9fb;border:1px solid #ddd;border-radius:8px;padding:8px;resize:none}#pi-loader-diag div{display:flex;gap:8px}#pi-loader-diag button{padding:8px 16px;border-radius:18px;border:1px solid #ccc;background:#fff;color:#1e1e2e;font-size:13px}#pi-loader-diag button:first-child{background:#1e1e2e;color:#fff;border-color:#1e1e2e}';
                doc.head.appendChild(style);
            }
            panel = doc.createElement('section');
            panel.id = 'pi-loader-diag';
            panel.innerHTML = '<b>剧情注入器还没启动</b><span>把下面的文字复制给开发者。</span><textarea readonly></textarea><div><button data-a="copy">复制</button><button data-a="close">关闭</button></div>';
            panel.addEventListener('click', async event => {
                const action = event.target.dataset && event.target.dataset.a;
                if (action === 'close') panel.remove();
                if (action !== 'copy') return;
                const box = panel.querySelector('textarea');
                try {
                    await host.navigator.clipboard.writeText(box.value);
                    notify('success', '已复制');
                } catch (error) {
                    box.removeAttribute('readonly');
                    box.select();
                    const ok = doc.execCommand && doc.execCommand('copy');
                    box.setAttribute('readonly', '');
                    notify(ok ? 'success' : 'warning', ok ? '已复制' : '请长按文字手动全选复制');
                }
            });
            doc.body.appendChild(panel);
        }
        panel.querySelector('textarea').value = '读取中…';
        panel.querySelector('textarea').value = await diagnose();
    }

    function onButton() {
        const app = host.__plotInjector;
        if (app && typeof app.open === 'function') return app.open();
        showDiagnosis();
    }

    if (typeof eventOn === 'function' && typeof getButtonEvent === 'function') {
        if (typeof appendInexistentScriptButtons === 'function') appendInexistentScriptButtons([{ name: BUTTON, visible: true }]);
        eventOn(getButtonEvent(BUTTON), onButton);
        status.bound.push('酒馆助手按钮事件');
    }

    // 兜底：直接监听 QR 栏里文字为「剧情注入」的按钮；两种都触发时 open 与诊断面板都只出现一个。
    const onDomClick = event => {
        const button = event.target && event.target.closest && event.target.closest('.qr--button, .menu_button');
        if (button && String(button.textContent || '').trim() === BUTTON) host.setTimeout(onButton, 0);
    };
    doc.addEventListener('click', onDomClick, true);
    status.bound.push('页面点击');
    window.addEventListener('pagehide', () => doc.removeEventListener('click', onDomClick, true), { once: true });

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
        const atLeast = tag => (tag && tag !== 'main' && compareVersions(tag, MIN_TAG) >= 0 ? tag : MIN_TAG === 'v0.0.0' ? tag || 'main' : MIN_TAG);
        const cached = readUi().loader;
        if (cached && cached.tag && cached.by === LOADER_VERSION && Date.now() - cached.at < TAG_TTL) return atLeast(cached.tag);
        for (const source of [fromGithub, fromJsdelivr]) {
            try {
                const tag = atLeast(await source());
                if (tag && tag !== 'main') {
                    writeUi({ loader: { tag, at: Date.now(), by: LOADER_VERSION } });
                    return tag;
                }
            } catch (error) {
                status.attempts.push(`版本 ${source.name}：${error.message}`);
                console.warn('[剧情注入器] 读取最新版本失败', source.name, error);
            }
        }
        return atLeast(cached && cached.tag ? cached.tag : '');
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
                if (!host.__plotInjector) throw new Error(host.__plotInjectorBootError || '程序已下载但没有启动');
                status.stage = '已就绪';
                status.attempts.push(`${new URL(url).host}：成功`);
                return;
            } catch (error) {
                errors.push(`${new URL(url).host}：${error.message}`);
                status.attempts.push(`${new URL(url).host}：${error.message}`);
                console.warn('[剧情注入器] 加载失败，换备用地址。', url, error);
            }
        }
        status.stage = '失败';
        status.error = `剧情注入器加载失败（${ref}）。${errors.join('；')}`;
        notify('error', status.error);
    }

    main().catch(error => {
        status.error = `剧情注入器加载失败：${error && error.message}`;
        notify('error', status.error);
    });
})();
