import { hostWindow } from './st.js';

// 查最新发布版本：和加载器同一套来源，先问 GitHub 标签，连不上再问 jsDelivr。
const REPOSITORY = 'Anyno001/PlotInjector';
const VERSION_RE = /^v?\d+\.\d+\.\d+$/;

export function compareVersions(a, b) {
    const pa = String(a).replace(/^v/, '').split('.').map(Number);
    const pb = String(b).replace(/^v/, '').split('.').map(Number);
    for (let i = 0; i < 3; i += 1) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
    return 0;
}

async function getJson(url, ms) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), ms);
    try {
        const res = await hostWindow().fetch(url, { cache: 'no-store', signal: controller.signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.json();
    } catch (error) {
        throw controller.signal.aborted ? new Error(`连接超时（${ms / 1000} 秒）`) : error;
    } finally {
        clearTimeout(timer);
    }
}

const highest = names => names.filter(name => VERSION_RE.test(name || '')).map(name => name.replace(/^v/, '')).sort(compareVersions).pop() || '';

const SOURCES = [
    async () => highest((await getJson(`https://api.github.com/repos/${REPOSITORY}/tags?per_page=100`, 6000)).map(item => item && item.name)),
    async () => highest((await getJson(`https://data.jsdelivr.com/v1/packages/gh/${REPOSITORY}`, 8000)).versions.map(item => (typeof item === 'string' ? item : item && item.version))),
];

// 返回不带 v 的版本号；所有来源都失败时抛出最后一个错误。
export async function fetchLatestVersion() {
    let last = null;
    for (const source of SOURCES) {
        try {
            const version = await source();
            if (version) return version;
        } catch (error) {
            last = error;
        }
    }
    throw last || new Error('没有找到发布版本');
}
