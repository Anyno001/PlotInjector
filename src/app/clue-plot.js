import { PLOT_SUFFIX, PLOT_SCENE_NONE, withSceneTask, sceneTaskCurrent, readPlotScene, plotOutputOf } from '../core/plot-scene.js';
import { chatMessages, hostWindow } from '../host/st.js';

// 推进预设的复制品和每轮的场景判断（见 core/plot-scene.js）。
// 复制品按聊天绑定（官方 switchPlotPreset 只改当前聊天），原预设改了就重新生成；手改复制品会被覆盖。
// 只给线索模式：d.off() 为真（跑团项目）时不复制、不切换、不读场景（用户 2026-11-23）。
export const PLOT_WAIT = { ms: 2e3, step: 100 };
const SYNC_GAP_MS = 2e4;
const API_FNS = ['getCurrentPlotPreset', 'getPlotPresetDetails', 'importPlotPresetFromData', 'switchPlotPreset'];

export function createPlotOps(d) {
    let lastSync = 0,
        builtFor = {},
        scene = null;
    const usable = (api) => !!api && API_FNS.every((k) => typeof api[k] == 'function') && !(d.off && d.off());
    const current = (api) => {
        try {
            return String(api.getCurrentPlotPreset() || '');
        } catch {
            return '';
        }
    };
    // 线索模式、SQLite 模式下：确保这个聊天用的是带场景判断的复制品
    async function syncPreset({ force = !1 } = {}) {
        let api = d.api();
        if (!usable(api) || typeof api.querySql != 'function') return;
        if (!force && Date.now() - lastSync < SYNC_GAP_MS) return;
        let cur = current(api);
        // 数据库还没准备好（刚打开酒馆时常见）读不到预设：不算查过，下次照样查
        if (!cur) return;
        lastSync = Date.now();
        let src = cur.endsWith(PLOT_SUFFIX) ? cur.slice(0, -PLOT_SUFFIX.length) : cur,
            name = src + PLOT_SUFFIX,
            base = api.getPlotPresetDetails(src);
        if (!base) return;
        let want = withSceneTask(base, name);
        if (!want) return;
        let have = api.getPlotPresetDetails(name),
            key = JSON.stringify(base);
        if (!have || (!sceneTaskCurrent(have, base) && builtFor[name] !== key)) {
            let r = await api.importPlotPresetFromData(want, { overwrite: !0 });
            if (!r || !r.success) return void d.note(`推进预设复制失败：${(r && r.message) || '数据库未返回结果'}`);
            ((builtFor[name] = key), d.note(`已按「${src}」生成推进预设「${name}」`));
        }
        cur !== name && api.switchPlotPreset(name) && d.note(`本聊天的推进预设换成「${name}」`);
    }
    // 本轮的推进结果：最后一条用户消息上存的原文。正常发送时数据库稍后才写上，最多等 PLOT_WAIT.ms。
    async function awaitScene() {
        scene = null;
        let api = d.api();
        if (!usable(api) || !current(api).endsWith(PLOT_SUFFIX)) return;
        let chat = chatMessages(),
            i = chat.length - 1;
        while (i >= 0 && chat[i] && chat[i].is_system) i--;
        if (i < 0 || !chat[i] || !chat[i].is_user) return;
        let msg = chat[i],
            end = Date.now() + PLOT_WAIT.ms,
            text = plotOutputOf(msg);
        while (!text && Date.now() < end) (await new Promise((r) => hostWindow().setTimeout(r, PLOT_WAIT.step)), (text = plotOutputOf(msg)));
        if (!text) return void d.note('本轮没读到剧情推进的结果，场景按填表结果走');
        let uid = readPlotScene(text);
        scene = { msg, uid: uid && uid !== PLOT_SCENE_NONE ? uid : '' };
        d.note(uid ? `剧情推进判断本轮${scene.uid ? `进入场景${scene.uid}` : '没有进入新场景'}` : '剧情推进的结果里没有场景判断');
    }
    // 本轮判断出的场景（只认这一轮那条用户消息仍是最后一条用户消息时）
    function roundScene() {
        if (!scene || !scene.uid || (d.off && d.off())) return '';
        let chat = chatMessages();
        for (let i = chat.length - 1; i >= 0; i--) if (chat[i] && chat[i].is_user) return chat[i] === scene.msg ? scene.uid : '';
        return '';
    }
    return { syncPreset, awaitScene, roundScene, clear: () => ((scene = null), (lastSync = 0)) };
}
