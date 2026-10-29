import { setYamlLib } from './core/yaml.js';
import { createDataStore } from './app/data.js';
import { createRuntime } from './app/runtime.js';
import { hostWindow, libs, toast } from './host/st.js';
import { createApp } from './ui/app.js';
import { ensureStyle, removeStyle } from './ui/dom.js';
import { createNotices, createSignalHider } from './ui/notice.js';

const VERSION = typeof __PI_VERSION__ === 'string' ? __PI_VERSION__ : 'dev';
const KEY = '__plotInjector';
const BUTTON = '剧情注入';

// 单例：重载先 destroy 旧实例，解绑事件、撤掉注入。
function boot() {
    const host = hostWindow();
    if (host[KEY] && typeof host[KEY].destroy === 'function') {
        try { host[KEY].destroy(); } catch (error) { console.warn('[剧情注入器] 旧实例销毁失败', error); }
    }
    const yaml = libs().yaml;
    if (!yaml) {
        toast('error', '当前酒馆没有提供 YAML 解析库（SillyTavern.libs.yaml），需要 1.13 以上版本。');
        return;
    }
    setYamlLib(yaml);
    ensureStyle();

    let app = null;
    const notice = createNotices();
    const data = createDataStore({
        onChange: reason => app && app.refresh(reason),
        onError: error => toast('error', `保存失败，内容仍在内存里：${error.message}`),
    });
    const runtime = createRuntime({ data, notice, emit: reason => app && app.refresh(reason) });
    app = createApp({ data, runtime, version: VERSION });
    const hider = createSignalHider(() => data.settings().hideSignal);

    let started = false;
    const ready = data.init().then(() => {
        runtime.start();
        if (data.settings().hideSignal) hider.start();
        started = true;
        app.refresh('index');
    }).catch(error => {
        toast('error', `读取本地数据失败：${error.message}`);
    });

    let subscription = null;
    // 自动更新版的加载器已经绑了按钮，这里只在单文件版里绑。
    const loaderBound = Boolean(window.__plotInjectorLoader && window.__plotInjectorLoader.bound);
    if (!loaderBound && typeof eventOn === 'function' && typeof getButtonEvent === 'function') {
        if (typeof appendInexistentScriptButtons === 'function') appendInexistentScriptButtons([{ name: BUTTON, visible: true }]);
        subscription = eventOn(getButtonEvent(BUTTON), () => app.open());
    }

    const instance = {
        version: VERSION,
        open: () => app.open(),
        ready,
        data,
        runtime,
        async destroy() {
            if (host[KEY] === instance) delete host[KEY];
            try { subscription && typeof subscription.stop === 'function' && subscription.stop(); } catch { /* 酒馆助手已卸载 */ }
            app.close();
            if (started) runtime.stop();
            hider.stop();
            notice.destroy();
            removeStyle();
            await data.flush().catch(() => {});
        },
    };
    host[KEY] = instance;
    window.addEventListener('pagehide', () => instance.destroy(), { once: true });
    console.info(`[剧情注入器] v${VERSION} 已加载`);
}

try {
    boot();
} catch (error) {
    console.error('[剧情注入器] 启动失败', error);
    toast('error', `启动失败：${error.message}`);
}
