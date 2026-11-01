import { makeId } from './outline.js';

// 无限流模式：注入器只在「开副本」「关副本」两个时刻动作，副本进行中什么都不管。
// 项目侧 project.infinite 只放模板（骰池、造世界规范、写法条目前缀）；世界库随聊天存在 progress.infinite.worlds。
// 所有函数返回新对象，不原地改。随机数由调用方传入 rng（默认 crypto 真随机）。
export const INFINITE_SLOT = '@infinite';
export const PHASES = ['train', 'world'];
export const PHASE_LABELS = { train: '在列车上', world: '在世界里' };

export const DEFAULT_POOLS = {
    horror: [
        { label: '中式民俗', weight: 3 }, { label: '规则怪谈', weight: 3 }, { label: '心理恐怖', weight: 2 },
        { label: '都市传说', weight: 2 }, { label: '克苏鲁式不可名状', weight: 1 }, { label: '诡异的温情', weight: 1 },
    ],
    cycle: [
        { label: '一晚', weight: 2 }, { label: '三天', weight: 3 }, { label: '一个月', weight: 3 },
        { label: '一年', weight: 2 }, { label: '超过一生', weight: 1 },
    ],
    client: [
        { label: '守夜的老人', weight: 2 }, { label: '失约的新娘', weight: 2 }, { label: '迷路的孩子', weight: 2 },
        { label: '最后一个乘客', weight: 2 }, { label: '看不见脸的店家', weight: 1 }, { label: '已经死去的同行', weight: 1 },
    ],
    lust: [{ label: '无', weight: 70 }, { label: '轻', weight: 25 }, { label: '重', weight: 5 }],
};
export const POOL_KEYS = ['horror', 'cycle', 'client', 'lust'];
export const POOL_LABELS = { horror: '恐怖类型', cycle: '重置周期', client: '委托人身份', lust: '情欲浓度' };

// horrorPrefix：恐怖类型写法条目的标题前缀，条目标题 = 前缀 + 掷出的恐怖类型。
export const DEFAULT_CONFIG = { horrorPrefix: '🎭 恐怖类型：' };

// ---------- 骰池 ----------

function normalizePool(value, fallback) {
    const list = Array.isArray(value) ? value : fallback;
    const out = list.filter(item => item && String(item.label || '').trim())
        .map(item => ({ label: String(item.label).trim(), weight: Math.max(0, Number(item.weight)) || 0 }))
        .filter(item => item.weight > 0);
    return out.length ? out : fallback.map(item => ({ ...item }));
}

// 编辑框文本 <-> 骰池。每行「名称|权重」。
export function poolToText(pool) {
    return pool.map(item => `${item.label}|${item.weight}`).join('\n');
}

export function textToPool(text) {
    const out = [];
    for (const raw of String(text || '').split('\n')) {
        const cells = raw.split(/[|｜]/).map(cell => cell.trim());
        if (cells[0]) out.push({ label: cells[0], weight: Number(cells[1]) || 1 });
    }
    return out;
}

// ---------- 随机 ----------

// 真随机 [0,1)。取 32 位整数除以 2^32，不用 Math.random。
export function randomFloat() {
    const g = globalThis.crypto;
    if (!g || typeof g.getRandomValues !== 'function') throw new Error('当前环境没有 crypto 真随机');
    const buf = new Uint32Array(1);
    g.getRandomValues(buf);
    return buf[0] / 4294967296;
}

export function rollPool(pool, rng = randomFloat) {
    const total = pool.reduce((sum, item) => sum + Math.max(0, item.weight), 0);
    if (!(total > 0)) return pool[0];
    let hit = rng() * total;
    for (const item of pool) {
        hit -= Math.max(0, item.weight);
        if (hit < 0) return item;
    }
    return pool[pool.length - 1];
}

// 开副本时一次掷四个骰子，结果直接写进世界档案，生成模型不能改。
export function rollWorldDice(infinite, rng = randomFloat) {
    return Object.fromEntries(POOL_KEYS.map(key => [key, rollPool(infinite.pools[key], rng).label]));
}

// ---------- 数据 ----------

export function normalizeWorld(value) {
    const src = value && typeof value === 'object' ? value : {};
    const dice = src.dice && typeof src.dice === 'object' ? src.dice : {};
    return {
        id: String(src.id || makeId('w')),
        title: String(src.title || '无名之站'),
        dice: Object.fromEntries(POOL_KEYS.map(key => [key, String(dice[key] || '')])),
        body: String(src.body || ''),
    };
}

export function normalizeInfinite(value) {
    const src = value && typeof value === 'object' ? value : {};
    const cfg = src.config && typeof src.config === 'object' ? src.config : {};
    const pools = src.pools && typeof src.pools === 'object' ? src.pools : {};
    return {
        pools: Object.fromEntries(POOL_KEYS.map(key => [key, normalizePool(pools[key], DEFAULT_POOLS[key])])),
        spec: String(src.spec || ''),
        config: { horrorPrefix: typeof cfg.horrorPrefix === 'string' ? cfg.horrorPrefix : DEFAULT_CONFIG.horrorPrefix },
    };
}

export function findWorld(worlds, id) {
    return worlds.find(world => world.id === id) || null;
}

export function putWorld(worlds, world) {
    return worlds.some(item => item.id === world.id) ? worlds.map(item => (item.id === world.id ? world : item)) : [...worlds, world];
}

// 标题比较时忽略空白、大小写和 emoji 变体选择符。
export function titleKey(title) {
    return String(title || '').replace(/[\uFE0E\uFE0F\s]+/g, '').toLowerCase();
}
