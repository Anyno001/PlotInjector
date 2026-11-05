// 世界书批量工具的纯计算：关键词标点修复、正则替换、顺序重排。只算出改动，写入交给 host/worldbook.js。

// 酒馆把 /…/flags 形式的关键词当正则，里面的逗号不能拆。
const isRegexKey = key => /^\/.+\/[a-z]*$/i.test(key);
const SPLIT = /[,，、;；\n]/;
const TRIM = /^[\s　。，、；：！？,.;:!?]+|[\s　。，、；：！？,.;:!?]+$/g;

export function fixKeys(keys) {
    const out = [];
    for (const raw of keys) {
        const parts = isRegexKey(String(raw).trim()) ? [String(raw).trim()] : String(raw).split(SPLIT).map(part => part.replace(TRIM, ''));
        for (const part of parts) if (part && !out.includes(part)) out.push(part);
    }
    return out;
}

const sameList = (a, b) => a.length === b.length && a.every((item, index) => item === b[index]);

// 返回 [{ key, title, patch, before, after }]，只列真正有变化的条目。
export function punctPlan(entries) {
    const out = [];
    for (const entry of entries) {
        const key = fixKeys(entry.keys);
        const second = fixKeys(entry.keysSecondary);
        const patch = {};
        if (!sameList(key, entry.keys)) patch.key = key;
        if (!sameList(second, entry.keysSecondary)) patch.keysecondary = second;
        if (!Object.keys(patch).length) continue;
        out.push({ key: entry.key, title: entry.title, patch, before: [...entry.keys, ...entry.keysSecondary].join(' | '), after: [...key, ...second].join(' | ') });
    }
    return out;
}

export function buildPattern(find, { regex = false, ignoreCase = false } = {}) {
    if (!find) throw new Error('请填写要查找的内容');
    const source = regex ? find : find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    try {
        return new RegExp(source, ignoreCase ? 'gi' : 'g');
    } catch (error) {
        throw new Error(`正则写法有误：${error.message}`);
    }
}

const countIn = (text, pattern) => (String(text).match(pattern) || []).length;

// fields: content 内容、comment 标题、keys 主次关键词。替换文字里可用 $1 引用分组（仅正则模式）。
export function regexPlan(entries, pattern, replace, fields) {
    const sub = text => String(text).replace(pattern, replace);
    const out = [];
    for (const entry of entries) {
        const patch = {};
        let hits = 0;
        if (fields.content && countIn(entry.content, pattern)) {
            hits += countIn(entry.content, pattern);
            patch.content = sub(entry.content);
        }
        if (fields.comment && entry.comment && countIn(entry.comment, pattern)) {
            hits += countIn(entry.comment, pattern);
            patch.comment = sub(entry.comment);
        }
        if (fields.keys) {
            for (const [from, field] of [[entry.keys, 'key'], [entry.keysSecondary, 'keysecondary']]) {
                const n = from.reduce((sum, key) => sum + countIn(key, pattern), 0);
                if (!n) continue;
                hits += n;
                patch[field] = from.map(sub).map(key => key.trim()).filter(Boolean);
            }
        }
        if (hits) out.push({ key: entry.key, title: entry.title, patch, hits });
    }
    return out;
}

// by: list 按列表里的先后，order 按原有顺序值（相同时保持列表先后）。
export function orderPlan(entries, { start, step, by = 'list' }) {
    const begin = Math.round(Number(start));
    const gap = Math.round(Number(step));
    if (!Number.isFinite(begin) || begin < 0) throw new Error('起始数字需为不小于 0 的整数');
    if (!Number.isFinite(gap) || gap < 1) throw new Error('间隔需为不小于 1 的整数');
    const list = by === 'order' ? entries.map((entry, index) => ({ entry, index })).sort((a, b) => a.entry.order - b.entry.order || a.index - b.index).map(item => item.entry) : entries;
    return list.map((entry, index) => ({ key: entry.key, title: entry.title, from: entry.order, to: begin + index * gap }));
}

// 触发测试：按酒馆规则模拟一段文字会命中哪些条目。不计递归、概率、分组、扫描深度。
// /正则/flags 形式按正则（沿用所写 flags）。普通关键词默认不分大小写；条目 caseSensitive 为 true 时区分，null 跟随全局，按不区分处理。
// matchWholeWords 为 true 时，单个英文词按单词边界匹配；含非拉丁字符或含空格的关键词仍按包含匹配，与酒馆一致。
const escapeRegex = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

function keyMatcher(key, { caseSensitive = null, matchWholeWords = null } = {}) {
    const text = String(key).trim();
    const regex = text.match(/^\/(.+)\/([a-z]*)$/i);
    if (regex) {
        try {
            const pattern = new RegExp(regex[1], regex[2].replace(/[gy]/g, ''));
            return haystack => pattern.test(haystack);
        } catch {
            return () => false;
        }
    }
    if (text === '') return () => false;
    const sensitive = caseSensitive === true;
    const needle = sensitive ? text : text.toLowerCase();
    const fold = haystack => (sensitive ? haystack : haystack.toLowerCase());
    const latinWord = !/\s/.test(text) && !/[^\u0000-\u007FÀ-ɏ]/.test(text);
    if (matchWholeWords === true && latinWord) {
        const pattern = new RegExp(`(?:^|[^\\p{L}\\p{N}_])${escapeRegex(needle)}(?:$|[^\\p{L}\\p{N}_])`, 'u');
        return haystack => pattern.test(fold(haystack));
    }
    return haystack => fold(haystack).includes(needle);
}

const matchedKeys = (keys, haystack, options) => keys.filter(key => String(key).trim() && keyMatcher(key, options)(haystack));

// 次要关键词逻辑：0 AND_ANY，1 NOT_ALL，2 NOT_ANY，3 AND_ALL。
function secondaryPass(logic, hit, total) {
    if (logic === 1) return hit < total;
    if (logic === 2) return hit === 0;
    if (logic === 3) return hit === total;
    return hit > 0;
}

export function triggerTest(entries, text, tokenOf = () => 0) {
    const haystack = String(text || '');
    const constant = [];
    const keyword = [];
    for (const entry of entries) {
        if (entry.disabled) continue;
        const options = { caseSensitive: entry.caseSensitive, matchWholeWords: entry.matchWholeWords };
        if (entry.constant) {
            constant.push({ key: entry.key, title: entry.title, tokens: tokenOf(entry) });
            continue;
        }
        const primary = matchedKeys(entry.keys, haystack, options);
        if (!primary.length) continue;
        let matched = primary;
        const secondary = entry.selective === false ? [] : entry.keysSecondary.filter(key => String(key).trim());
        if (secondary.length) {
            const logic = Number(entry.selectiveLogic) || 0;
            const hit = matchedKeys(secondary, haystack, options);
            if (!secondaryPass(logic, hit.length, secondary.length)) continue;
            if (logic === 0 || logic === 3) matched = [...primary, ...hit];
        }
        keyword.push({ key: entry.key, title: entry.title, matched, tokens: tokenOf(entry) });
    }
    const sum = list => list.reduce((total, item) => total + item.tokens, 0);
    return { constant, keyword, tokens: { constant: sum(constant), keyword: sum(keyword), total: sum(constant) + sum(keyword) } };
}

// 体检：只看手写条目（调用方先去掉数据库条目）。返回各类问题，空数组即无问题。
const HAN = /[\u4e00-\u9fff]/g;
const isShortKey = key => {
    const text = String(key).trim();
    if (!text || isRegexKey(text)) return false;
    return text.length <= 1 || /^[A-Za-z]{1,2}$/.test(text);
};

export function healthCheck(entries, tokenOf = () => 0) {
    const on = entries.filter(entry => !entry.disabled);
    const shortKeys = [];
    for (const entry of on) {
        if (entry.constant) continue;
        const words = entry.keys.filter(isShortKey);
        if (words.length) shortKeys.push({ key: entry.key, title: entry.title, words });
    }
    const noKeys = on.filter(entry => !entry.constant && !entry.keys.some(key => String(key).trim())).map(entry => ({ key: entry.key, title: entry.title }));
    const byWord = new Map();
    for (const entry of on) {
        if (entry.constant) continue;
        for (const word of new Set(entry.keys.map(key => String(key).trim()).filter(Boolean))) {
            const id = word.toLowerCase();
            if (!byWord.has(id)) byWord.set(id, { word, entries: [] });
            byWord.get(id).entries.push({ key: entry.key, title: entry.title });
        }
    }
    const shared = [...byWord.values()].filter(item => item.entries.length > 1);
    const byTitle = new Map();
    for (const entry of entries) {
        const id = String(entry.title).trim();
        if (!byTitle.has(id)) byTitle.set(id, { title: id, entries: [] });
        byTitle.get(id).entries.push({ key: entry.key, title: entry.title });
    }
    const dupTitles = [...byTitle.values()].filter(item => item.entries.length > 1);
    const constTokens = on.filter(entry => entry.constant).reduce((sum, entry) => sum + tokenOf(entry), 0);
    const total = on.reduce((sum, entry) => sum + tokenOf(entry), 0);
    const ratio = total ? constTokens / total : 0;
    return { shortKeys, noKeys, shared, dupTitles, constant: { count: on.filter(entry => entry.constant).length, tokens: constTokens, total, ratio, warn: ratio > 0.6 } };
}

// 条目排序：mode 为 order 顺序值、tokens 从大到小、title 标题；其他值保持原顺序。稳定排序。
export function sortEntries(entries, mode, tokenOf = () => 0) {
    const list = entries.map((entry, index) => ({ entry, index }));
    const by = {
        order: (a, b) => a.entry.order - b.entry.order,
        tokens: (a, b) => tokenOf(b.entry) - tokenOf(a.entry),
        title: (a, b) => String(a.entry.title).localeCompare(String(b.entry.title), 'zh'),
    }[mode];
    if (!by) return entries;
    return list.sort((a, b) => by(a, b) || a.index - b.index).map(item => item.entry);
}
