import { buildCheckMessages, cleanFloorText, parseCheckReply } from '../core/check.js';
import { buildEntries, buildIndexText, carriedNodes, toWorldInfoEntry } from '../core/inject.js';
import { parseOutlineReply, rewriteRestMessages, syncSettingMessages } from '../core/prompts.js';
import { changedBlockKeys, mergeBlocks, parseSettingReply, pushHistory, splitBlocks } from '../core/setting.js';
import { BUILTIN_GUIDE } from '../core/guide.js';
import { flattenUnits, replaceRest, stageLabel, stageNodes, volumeLabel } from '../core/outline.js';
import { advance, currentIndex, emptyProgress, goTo, isMuted, mute, patchSlot, uncheckByNames, unitStates } from '../core/progress.js';
import { createWorld, emptyInfinite, enterWorld, leaveWorld, reenterWorld, removeWorld, undoEnter, undoLeave, withTrigger } from '../core/infinite-flow.js';
import { decideTrigger, hashText, judgeTrigger, makeTrigger, parseTrainState } from '../core/infinite-state.js';
import { hubWordNames, normalizeInfinite, randomFloat, resolveHub, rollWorldDice, titleKey } from '../core/infinite.js';
import { buildWorldMessages, horrorTitle, parseWorldReply, worldSpecText } from '../core/infinite-world.js';
import { makeId, pushOutlineHistory } from '../core/outline.js';
import { resolveLlm } from '../core/store.js';
import { addPlayerThread, applyCheck, checkThreads, clampThreads, hasNodeNamed, ignoreThread, isThreadNode, liveThreads, maskUnits, threadState, threadSwitches } from '../core/threads.js';
import { requestLlm } from '../host/llm.js';
import { cardKey, cardName, chatMessages, ctx, hostWindow, toast } from '../host/st.js';
import { readEntryContent, writeFallbackBook } from '../host/worldbook.js';
import { bindChat, readChatState, readProgress, writeProgress } from './progress-store.js';

export const VIRTUAL_WORLD = '剧情注入器';

const LOG_MAX = 40;
// 主回复没结束时先挂起检测，最多等这么久。
const PENDING_MAX_MS = 30000;
// 检测请求失败后自动重试的次数与间隔，全部失败才弹提示。
const CHECK_RETRIES = 3;
const RETRY_GAP_MS = 2000;
// 造世界解析失败或请求失败时的重试次数。
const WORLD_RETRIES = 2;
// 档案还在生成时用户发了下一条，最多等这么久。
const WORLD_WAIT_MS = 90000;

const placeOf = unit => `${volumeLabel(unit.volume.key)}·${stageLabel(unit.stage.key)}`;

// 运行时：注入、每 N 楼检测、偏离大纲时提醒或自动改写。UI 关着也在跑。
// askReason 由入口传入（弹输入框），运行时本身不依赖界面。
export function createRuntime({ data, notice, emit, askReason = async () => '' }) {
    const view = hostWindow();
    let progress = null;
    let progressFor = '';
    let checking = false;
    let fallbackTimer = 0;
    let generating = false;
    let chatStartFloors = 0;
    let pendingCheck = false;
    let pendingTimer = 0;
    let opening = false;
    let openGen = 0;
    let openPromise = Promise.resolve(null);
    let pendingTrigger = null;
    let lastRead = null;
    const listeners = [];
    const stats = {};
    const logs = [];

    // 诊断页用：最近的事件与检测判断。
    function log(text) {
        logs.push({ at: Date.now(), text });
        if (logs.length > LOG_MAX) logs.shift();
    }

    // 聊天自己记的项目优先，没有（或项目已删）再用本卡默认。
    function chatBoundId() {
        const id = readChatState().projectId;
        return id && data.index().projects.some(item => item.id === id) ? id : '';
    }

    function activeId() {
        return chatBoundId() || data.activeIdFor(cardKey());
    }

    function activeProject() {
        const id = activeId();
        return id ? data.project(id) : null;
    }

    function currentProgress() {
        const id = activeId();
        if (!id) return null;
        if (!progress || progressFor !== id) {
            progress = readProgress(id);
            progressFor = id;
        }
        const project = data.project(id);
        if (project && project.mode === 'infinite' && !progress.infinite) {
            progress = { ...progress, infinite: emptyInfinite() };
            writeProgress(progress);
        }
        return progress;
    }

    const isInfinite = project => Boolean(project && project.mode === 'infinite');


    function units() {
        const project = activeProject();
        return project ? flattenUnits(project.outline.volumes) : [];
    }

    // 进行中阶段换了：在新阶段的槽位记下楼数，没写条件的支线钩子从这里开始计时。
    function stampActive(prev, next) {
        if (!next || next.infinite) return next;
        const list = units();
        if (!list.length) return next;
        const activeOf = prog => {
            const states = unitStates(list, prog);
            const found = list.find(unit => states[unit.id] === 'active');
            return found ? found.id : '';
        };
        const now = activeOf(next);
        if (!now) return next;
        const changed = !prev || prev.projectId !== next.projectId || activeOf(prev) !== now;
        const slot = next.slots[now] || {};
        if (!changed && slot.since) return next;
        if (!prev && slot.since) return next;
        return patchSlot(next, now, { since: floorCount() });
    }

    function setProgress(next, reason = 'progress') {
        next = stampActive(progress && progressFor === next.projectId ? progress : null, next);
        progress = next;
        progressFor = next.projectId;
        writeProgress(next);
        scheduleFallback();
        emit(reason);
    }

    function entries() {
        const project = activeProject();
        const prog = currentProgress();
        return project && prog ? buildEntries(project, prog, data.settings()) : [];
    }

    function virtualEntries() {
        return entries().filter(entry => entry.enabled && entry.content).map((entry, index) => toWorldInfoEntry(entry, index, VIRTUAL_WORLD));
    }

    function eventTypes() {
        const c = ctx();
        return (c && c.eventTypes) || {};
    }

    function hasEntriesEvent() {
        return Boolean(eventTypes().WORLDINFO_ENTRIES_LOADED);
    }

    async function onEntriesLoaded(payload) {
        if (!payload || !Array.isArray(payload.chatLore)) return;
        if (opening) await waitOpening();
        try {
            payload.chatLore.push(...virtualEntries());
        } catch (error) {
            console.error('[剧情注入器] 注入失败', error);
        }
    }

    // 回退方案 D：没有条目加载事件的旧酒馆，把同样的条目写进专用世界书。
    function scheduleFallback() {
        if (hasEntriesEvent()) return;
        view.clearTimeout(fallbackTimer);
        fallbackTimer = view.setTimeout(async () => {
            const name = `剧情注入器·${cardName() || '未命名'}`;
            try {
                const result = await writeFallbackBook(name, virtualEntries());
                if (result.conflict) toast('warning', `聊天已绑定世界书「${result.conflict}」，剧情注入器的条目写在「${name}」，需要手动启用。`);
            } catch (error) {
                toast('error', `写入专用世界书失败：${error.message}`);
            }
        }, 1000);
    }

    // 隐藏楼（/hide、记忆类插件）也是 is_system，旧算法会把楼数算小、检测永远不到点；楼数直接取聊天长度。
    const isNote = msg => !msg || (msg.is_system && msg.extra && msg.extra.type);

    function floorCount() {
        return chatMessages().length;
    }

    function activeUnit() {
        const list = units();
        const prog = currentProgress();
        if (!list.length || !prog) return null;
        const states = unitStates(list, prog);
        return list.find(unit => states[unit.id] === 'active') || list[currentIndex(list, prog)];
    }

    function openNext({ silent = false } = {}) {
        const prog = currentProgress();
        const step = prog && advance(prog, units());
        if (!step) {
            if (!silent) toast('info', '已经是最后一段。');
            return null;
        }
        setProgress(step.progress);
        notice.hide('advance');
        return step;
    }

    function backTo(unitId) {
        const prog = currentProgress();
        if (!prog) return;
        setProgress(goTo(prog, units(), unitId));
    }

    function proposeAdvance({ unit, reason = '' }) {
        const settings = data.settings();
        const prog = currentProgress();
        if (!prog || isMuted(prog, unit.id)) return;
        if (settings.handleMode === 'nodes') return;
        const step = advance(prog, units());
        if (!step) return;
        if (settings.handleMode === 'auto') {
            setProgress(step.progress);
            notice.show({
                id: 'advance',
                title: `已切到 ${placeOf(step.to)}`,
                body: reason || '检测判断本阶段已演完。',
                actions: [{ label: '撤销', run: () => backTo(unit.id) }],
                timeout: 12000,
            });
            return;
        }
        notice.show({
            id: 'advance',
            title: `${placeOf(unit)} 已演完`,
            body: reason || '检测判断本阶段已演完。',
            actions: [
                { label: '打开下一段', primary: true, run: () => openNext() },
                { label: '暂不', run: () => notice.hide('advance') },
                { label: '本阶段不再提醒', run: () => setProgress(mute(currentProgress(), unit.id)) },
            ],
        });
    }

    // 大纲改了以后按大纲校对设定：只替换有改动的分块，旧版进历史版本。返回改动的分块标题，没改返回空数组。
    async function syncSetting(projectId, { from = 0, reason = '' } = {}) {
        const project = data.project(projectId);
        const text = project && project.setting.text.trim();
        if (!text) return [];
        const list = flattenUnits(project.outline.volumes);
        const guide = String(data.settings().guide || '').trim() || BUILTIN_GUIDE;
        const reply = await requestLlm(syncSettingMessages({ guide, setting: text, units: list, fromUnitIndex: from, reason }), resolveLlm(data.settings(), 'outline'));
        const body = parseSettingReply(reply).body;
        const keys = body ? changedBlockKeys(text, body) : [];
        if (!keys.length) return [];
        const next = mergeBlocks(text, body, keys);
        data.updateProject(projectId, current => ({ ...current, setting: { ...current.setting, text: next, history: pushHistory(pushHistory(current.setting.history, current.setting.text), next) } }));
        const titles = new Map(splitBlocks(text).map(block => [block.key, block.title]));
        return keys.map(key => titles.get(key) || key);
    }

    // 按最近正文改写当前段及之后的阶段，直接替换并把进度移到改写后的第一段；返回撤销用的快照。
    async function rewriteRest(reason) {
        const project = activeProject();
        const prog = currentProgress();
        const unit = activeUnit();
        if (!project || !prog || !unit) throw new Error('当前卡没有启用的项目');
        const list = units();
        const from = list.findIndex(item => item.id === unit.id);
        const recent = recentFloors(6).map(floor => floor.text).join('\n\n');
        const reply = await requestLlm(rewriteRestMessages({ setting: project.setting.text, volumes: project.outline.volumes, fromUnitIndex: from, units: list, recent, reason }), resolveLlm(data.settings(), 'outline'));
        const parsed = parseOutlineReply(reply);
        if (!parsed.ok) throw new Error(`改写结果格式有误：${parsed.error}`);
        const before = { volumes: project.outline.volumes, progress: prog, setting: project.setting.text };
        const volumes = replaceRest(project.outline.volumes, unit.stage.id, parsed.volumes);
        data.updateProject(project.id, current => ({ ...current, outline: { ...current.outline, volumes, history: pushOutlineHistory(current.outline.history, current.outline.volumes, '偏离改写') } }));
        const first = parsed.volumes[0] && parsed.volumes[0].stages[0];
        if (first) setProgress(goTo(currentProgress(), flattenUnits(volumes), first.id));
        return before;
    }

    function undoRewrite(projectId, before) {
        data.updateProject(projectId, current => ({
            ...current,
            outline: { ...current.outline, volumes: before.volumes },
            setting: { ...current.setting, text: before.setting, history: pushHistory(current.setting.history, before.setting) },
        }));
        setProgress(before.progress);
        toast('info', '已撤销改写，恢复原来的大纲、设定和进度。');
    }

    async function runRewrite(reason, { auto = false } = {}) {
        const projectId = activeId();
        notice.show({ id: 'offtrack', title: '正在改写后续阶段…', body: reason });
        try {
            const before = await rewriteRest(reason);
            let synced = '';
            try {
                notice.show({ id: 'offtrack', title: '正在按新大纲校对设定…', body: reason });
                const titles = await syncSetting(projectId, { from: currentIndex(units(), currentProgress()), reason });
                synced = titles.length ? `\n设定已同步修改：${titles.join('、')}。` : '';
            } catch (error) {
                synced = `\n设定校对失败：${error.message}`;
            }
            notice.show({
                id: 'offtrack',
                title: auto ? '剧情偏离大纲，已自动改写后续阶段' : '已改写后续阶段',
                body: `${reason}${synced}`,
                actions: [{ label: '撤销', run: () => undoRewrite(projectId, before) }],
                timeout: 20000,
            });
        } catch (error) {
            notice.hide('offtrack');
            toast('error', `改写失败：${error.message}`);
        }
    }

    function handleOffTrack(unit, reason) {
        notice.hide('advance');
        if (data.settings().offTrackMode === 'auto') {
            runRewrite(reason, { auto: true });
            return;
        }
        notice.show({
            id: 'offtrack',
            title: `${placeOf(unit)} 偏离大纲`,
            body: `${reason || '正文走向与后续阶段冲突。'}后续阶段可能接不上，建议改写。`,
            actions: [
                { label: '改写后续阶段', primary: true, run: async () => {
                    const note = await askReason(reason);
                    if (note != null) runRewrite(note.trim() || reason);
                } },
                { label: '暂不', run: () => notice.hide('offtrack') },
                { label: '本阶段不再提醒', run: () => {
                    const prog = currentProgress();
                    if (prog && !prog.offMuted.includes(unit.id)) setProgress({ ...prog, offMuted: [...prog.offMuted, unit.id] });
                } },
            ],
        });
    }

    function threadEventText(event) {
        const map = {
            'clock-tick': `进度钟「${event.name}」推进到 ${event.filled}/${event.total}`,
            'clock-due': `进度钟「${event.name}」已满格，本段必须发生`,
            'clock-done': `世界动态「${event.name}」已发生`,
            'hook-on': `支线「${event.name}」条件满足，已激活`,
            'chain-step': `支线链「${event.name}」进入第 ${event.step + 1}/${event.total} 步`,
            'hook-done': `支线「${event.name}」已演完`,
            'hook-expired': `支线「${event.name}」超过时限，已过期`,
        };
        return map[event.type] || event.type;
    }

    // 玩家自开的线收录为当前阶段的支线；有大纲历史时先入栈。
    function adoptThread(projectId, stageId, thread) {
        data.updateProject(projectId, current => ({
            ...current,
            outline: {
                ...current.outline,
                volumes: addPlayerThread(current.outline.volumes, stageId, thread),
                history: pushOutlineHistory(current.outline.history, current.outline.volumes, '收录支线'),
            },
        }));
        log(`收录玩家自开的线「${thread.name}」为支线`);
        scheduleFallback();
        emit('progress');
    }

    function offerThread(unit, thread) {
        const settings = data.settings();
        const project = activeProject();
        const prog = currentProgress();
        if (settings.newThreadMode === 'off' || !project || !prog || !threadSwitches(project).sideOn) return;
        if (threadState(prog).ignored.includes(thread.name) || hasNodeNamed(units(), thread.name)) return;
        if (settings.newThreadMode === 'auto') {
            adoptThread(project.id, unit.stage.id, thread);
            notice.show({ id: 'thread', title: `已收录支线「${thread.name}」`, body: thread.summary, timeout: 10000 });
            return;
        }
        notice.show({
            id: 'thread',
            title: `正文开了一条新线「${thread.name}」`,
            body: thread.summary || '大纲里没有这条线。',
            actions: [
                { label: '收录为支线', primary: true, run: () => adoptThread(project.id, unit.stage.id, thread) },
                { label: '忽略', run: () => setProgress(ignoreThread(currentProgress(), thread.name)) },
            ],
        });
    }

    function recentFloors(count) {
        const out = [];
        const chat = chatMessages();
        for (let i = chat.length - 1; i >= 0 && out.length < count; i -= 1) {
            const msg = chat[i];
            if (isNote(msg)) continue;
            const text = cleanFloorText(msg.mes);
            if (text) out.unshift({ index: i, text: `${msg.is_user ? '（用户）' : ''}${text}` });
        }
        return out;
    }

    // ---------- 无限流 ----------
    // 注入器只在「开副本」「关副本」两个时刻动作：检测只判断是否出发/是否回到主空间，副本进行中什么都不管。

    function infState() {
        const project = activeProject();
        const prog = currentProgress();
        if (!isInfinite(project) || !prog || !prog.infinite) return null;
        return { project, prog, infinite: normalizeInfinite(project.infinite), inf: prog.infinite };
    }

    function setInf(inf, reason = 'progress') {
        setProgress({ ...currentProgress(), infinite: inf }, reason);
    }

    // 最新一条 AI 楼层（非用户、非系统）。
    function latestAiFloor() {
        const chat = chatMessages();
        for (let i = chat.length - 1; i >= 0; i -= 1) {
            const msg = chat[i];
            if (!msg || msg.is_user || msg.is_system) continue;
            return { floor: i, text: String(msg.mes || '') };
        }
        return null;
    }

    // 当前项目的主空间配置（标签、栏名、四组词）。
    function hubConfig() {
        const project = activeProject();
        return project && project.infinite ? normalizeInfinite(project.infinite).config : undefined;
    }

    function refreshRead() {
        const found = latestAiFloor();
        lastRead = found ? { floor: found.floor, state: parseTrainState(found.text, hubConfig()) } : null;
        return found;
    }

    // 放弃进行中的开副本（切聊天、切项目、触发楼被撤销）：结果作废，不写进任何进度。
    function abandonOpening() {
        if (!opening) return;
        openGen += 1;
        opening = false;
        pendingTrigger = null;
        emit('opened');
    }

    // 触发楼被 swipe、编辑或删除后：不再带触发值就撤销；仍带就不重复生成，只更新哈希。
    function revalidateTrigger() {
        const state = infState();
        if (!state) return;
        const pending = opening && pendingTrigger ? pendingTrigger : null;
        const trig = pending || state.inf.trigger;
        if (!trig) return;
        const msg = chatMessages()[trig.floor];
        const text = msg && !msg.is_user && !msg.is_system ? String(msg.mes || '') : null;
        // swipe 重新生成时酒馆先把这一楼清空，等新文字写回再判断，免得白白撤销又重造。
        if (text !== null && !text.trim()) return;
        const cfg = state.infinite.config;
        const names = hubWordNames(cfg);
        const word = trig.kind === 'enter' ? names.depart : names.back;
        const verdict = judgeTrigger(trig, text, cfg);
        if (verdict === 'none' || verdict === 'same') return;
        if (verdict === 'keep') {
            const next = { ...trig, hash: hashText(text) };
            if (pending) pendingTrigger = next;
            else setInf(withTrigger(state.inf, next));
            log(`第 ${trig.floor} 楼文字变了，仍是「${word}」，不重复处理`);
            return;
        }
        if (pending) {
            log(`第 ${trig.floor} 楼不再是「${names.depart}」，取消正在生成的世界档案`);
            abandonOpening();
        } else if (trig.kind === 'enter') {
            log(`第 ${trig.floor} 楼不再是「${names.depart}」，撤销开副本，删掉刚生成的档案`);
            setInf(undoEnter(state.inf, `第 ${trig.floor} 楼不再是「${names.depart}」，撤销开副本`));
        } else {
            log(`第 ${trig.floor} 楼不再是「${names.back}」，撤销关副本`);
            setInf(undoLeave(state.inf, `第 ${trig.floor} 楼不再是「${names.back}」，撤销关副本`));
        }
        notice.show({ id: 'inf-undo', title: '触发楼已改动', body: trig.kind === 'enter' ? `这一楼不再是「${names.depart}」，已撤销开副本并删掉刚生成的档案。` : `这一楼不再是「${names.back}」，已重新打开那份档案。`, timeout: 10000 });
    }

    // AI 回复完成：只读最新一条 AI 楼层的状态块。
    function onInfiniteReceived() {
        const found = refreshRead();
        revalidateTrigger();
        const state = infState();
        if (!state || !found) {
            if (!found) log('收到回复：没有 AI 楼层可读');
            emit('floor');
            return;
        }
        const train = lastRead.state;
        log(`读状态块：第 ${found.floor} 楼 ${train ? `${resolveHub(state.infinite.config).hubName}：${train}` : '没有状态块'}`);
        const kind = decideTrigger(state.inf.phase, train, state.infinite.config);
        if (kind === 'enter') {
            openWorld({ floor: found.floor, text: found.text });
        } else if (kind === 'leave') {
            const trigger = makeTrigger({ kind: 'leave', floor: found.floor, text: found.text, worldId: state.inf.worldId });
            setInf(withTrigger(leaveWorld(state.inf, `第 ${found.floor} 楼读到「${hubWordNames(state.infinite.config).back}」，关副本`), trigger));
        }
        emit('floor');
    }

    // 档案还在生成时用户发了下一条：酒馆会等这个事件，最多等 WORLD_WAIT_MS。
    async function waitOpening() {
        const promise = openPromise;
        let timer = 0;
        let timedOut = false;
        const timeout = new Promise(resolve => {
            timer = view.setTimeout(() => { timedOut = true; resolve(); }, WORLD_WAIT_MS);
        });
        log('世界档案还在生成，先等它完成');
        await Promise.race([promise.catch(() => null), timeout]);
        view.clearTimeout(timer);
        if (timedOut && opening) {
            log(`等待世界档案超过 ${WORLD_WAIT_MS / 1000} 秒，本次回复先不带档案`);
            notice.show({ id: 'inf-wait', title: '世界档案还没生成完', body: `已等待 ${WORLD_WAIT_MS / 1000} 秒，本次回复先不带档案，生成完成后从下一次回复起带上。`, timeout: 12000 });
        }
    }
    // 开副本：掷四个骰子，读恐怖类型写法条目，调生成模型写档案，进入这个世界。之后档案原样不动。
    // trigger：正文状态块触发时传入（{ floor, text }），手动按钮不传。
    function openWorld(trigger = null) {
        if (opening) return openPromise;
        const state = infState();
        if (!state) return Promise.resolve(null);
        if (state.inf.phase !== 'train') {
            toast('info', `只有在${resolveHub(state.infinite.config).hubName}时才能进入新世界。`);
            return Promise.resolve(null);
        }
        opening = true;
        openGen += 1;
        const gen = openGen;
        pendingTrigger = trigger ? { kind: 'enter', floor: trigger.floor, hash: hashText(trigger.text), worldId: '' } : null;
        openPromise = runOpen(state, gen).finally(() => {
            if (gen !== openGen) return;
            opening = false;
            pendingTrigger = null;
            emit('opened');
        });
        return openPromise;
    }

    async function runOpen(state, gen) {
        const projectId = state.project.id;
        emit('opening');
        try {
            const dice = rollWorldDice(state.infinite, randomFloat);
            log(`开副本掷骰：${dice.horror}｜${dice.cycle}｜${dice.client}｜情欲${dice.lust}`);
            const spec = worldSpecText(state.infinite);
            const titles = state.inf.worlds.map(world => world.title);
            // 恐怖类型写法：卡里同标题条目（默认关闭也读得到），只给造世界用，不进正文注入。
            const guideTitle = horrorTitle(state.infinite.config.horrorPrefix, dice.horror);
            let horrorGuide = '';
            try {
                horrorGuide = await readEntryContent(guideTitle, (a, b) => titleKey(a) === titleKey(b));
            } catch (error) {
                log(`读取恐怖类型写法失败：${error.message}`);
            }
            if (!horrorGuide) log(`卡里没找到「${guideTitle}」，造世界时不带恐怖类型写法`);
            let parsed = null;
            let hint = '';
            for (let attempt = 0; ; attempt += 1) {
                try {
                    const messages = buildWorldMessages({ spec, dice, setting: state.project.setting.text, titles, hint, horrorGuide });
                    parsed = parseWorldReply(await requestLlm(messages, resolveLlm(data.settings(), 'outline'), { timeoutMs: 180000 }));
                    break;
                } catch (error) {
                    if (attempt >= WORLD_RETRIES) throw error;
                    hint = error.message;
                    log(`造世界失败：${error.message}，第 ${attempt + 1} 次重试`);
                }
            }
            const now = infState();
            if (gen !== openGen || !now || now.project.id !== projectId || now.inf.phase !== 'train') {
                log('造世界结果作废：开副本期间状态已变');
                return null;
            }
            const world = createWorld({ id: makeId('w'), dice, parsed });
            const trig = pendingTrigger ? { ...pendingTrigger, worldId: world.id } : null;
            setInf(withTrigger(enterWorld(now.inf, world), trig));
            notice.show({ id: 'inf-stop', title: `进入新世界「${world.title}」`, body: `${dice.horror}｜${dice.client}`, timeout: 12000 });
            return world;
        } catch (error) {
            if (gen !== openGen) return null;
            log(`开副本失败：${error.message}`);
            notice.show({
                id: 'inf-stop',
                title: '开副本失败',
                body: error.message,
                actions: [{ label: '重试', primary: true, run: () => openWorld() }, { label: '关闭', run: () => {} }],
            });
            return null;
        }
    }

    // 手动「回到主空间」：关副本，档案留在世界库里。
    function returnToTrain() {
        const state = infState();
        if (!state || state.inf.phase !== 'world') return;
        setInf(leaveWorld(state.inf, `手动回到${resolveHub(state.infinite.config).hubName}`));
    }

    // 世界库里手动「重新打开」某份档案，直接进入那个世界。
    function reopenWorld(worldId) {
        const state = infState();
        if (!state) return;
        if (state.inf.phase !== 'train') {
            toast('info', `先回到${resolveHub(state.infinite.config).hubName}，再重新打开档案。`);
            return;
        }
        setInf(reenterWorld(state.inf, worldId));
    }

    function deleteWorld(worldId) {
        const state = infState();
        if (state) setInf(removeWorld(state.inf, worldId, state.infinite.config));
    }

    async function checkNow({ manual = false } = {}) {
        if (isInfinite(activeProject())) {
            log('无限流项目不使用检测模型');
            return null;
        }
        if (checking) {
            log('跳过检测：上一次检测还没结束');
            return null;
        }
        const project = activeProject();
        const prog = currentProgress();
        const settings = data.settings();
        if (!project || !prog) {
            log('跳过检测：当前卡没有启用的项目');
            if (manual) toast('info', '当前卡没有启用的项目。');
            return null;
        }
        const sw = threadSwitches(project);
        const unit = activeUnit() && maskUnits([activeUnit()], sw)[0];
        if (!unit) {
            log('跳过检测：大纲为空');
            return null;
        }
        const floors = recentFloors(settings.checkFloors);
        if (!floors.length) {
            log('跳过检测：没有可检测的正文');
            if (manual) toast('info', '还没有可检测的正文。');
            return null;
        }
        checking = true;
        log(`开始检测：${placeOf(unit)}，读最近 ${floors.length} 楼${manual ? '（手动）' : ''}`);
        emit('checking');
        try {
            const list = maskUnits(units(), sw);
            const states = unitStates(list, prog);
            const index = buildIndexText(list, states, prog, { carryOver: settings.carryOver, hookCap: settings.hookCap });
            const threadInfo = checkThreads(liveThreads(list, states, prog, { carryOver: settings.carryOver, hookCap: settings.hookCap }), {
                newThreadMode: sw.sideOn ? settings.newThreadMode : 'off', ignored: threadState(prog).ignored, readTo: prog.lastCheckFloor,
            });
            const messages = buildCheckMessages(unit, index, floors, threadInfo);
            let result = null;
            for (let attempt = 0; ; attempt += 1) {
                try {
                    result = parseCheckReply(await requestLlm(messages, resolveLlm(settings, 'check'), { timeoutMs: 120000 }));
                    break;
                } catch (error) {
                    if (attempt >= CHECK_RETRIES) throw error;
                    log(`检测请求失败：${error.message}，${RETRY_GAP_MS / 1000} 秒后第 ${attempt + 1} 次重试`);
                    await new Promise(resolve => view.setTimeout(resolve, RETRY_GAP_MS));
                }
            }
            notice.hide('checkfail');
            let next = currentProgress();
            // 钩子与支线链由 applyCheck 处理（链要走完最后一步才算演完）。
            next = uncheckByNames(next, unit.id, stageNodes(unit.stage.data).filter(node => !isThreadNode(node)), result.done);
            if (settings.carryOver) for (const item of carriedNodes(list, states, prog)) next = uncheckByNames(next, item.unit.id, [item.node], result.done);
            const merged = applyCheck(next, liveThreads(list, unitStates(list, next), next, { carryOver: settings.carryOver, hookCap: settings.hookCap }), result, { floor: floorCount() });
            next = { ...merged.progress, lastCheckFloor: floorCount() };
            setProgress(next);
            for (const event of merged.events) log(threadEventText(event));
            log(`检测完成：已演 ${result.done.length} 个节点${result.stageDone ? '，本阶段已演完' : ''}${result.offTrack ? '，偏离大纲' : ''}`);
            if (result.offTrack && settings.offTrackMode !== 'off' && !next.offMuted.includes(unit.id)) {
                handleOffTrack(unit, result.offReason || result.reason);
            } else if (result.stageDone) {
                proposeAdvance({ unit, reason: result.reason });
            } else if (manual) {
                toast('info', result.reason || '本阶段尚未演完。');
            }
            if (result.newThread && sw.sideOn) offerThread(unit, result.newThread);
            return result;
        } catch (error) {
            setProgress({ ...currentProgress(), lastCheckFloor: floorCount() });
            log(`检测失败：${error.message}`);
            notice.show({
                id: 'checkfail',
                title: '进度检测失败',
                body: `已自动重试 ${CHECK_RETRIES} 次：${error.message}`,
                actions: [
                    { label: '重试', primary: true, run: () => checkNow({ manual }) },
                    { label: '关闭', run: () => {} },
                ],
            });
            return null;
        } finally {
            checking = false;
            emit('checked');
        }
    }

    // 上次检测楼层比现有楼数还大（删楼、开分支、换了存档），以现有楼数重新起算，否则要等楼数追上才会再检测。
    function clampBase() {
        const prog = currentProgress();
        if (!prog) return null;
        const floors = floorCount();
        // 支线钩子、进度钟记下的楼数也一并夹到现有楼数。
        const threads = clampThreads(prog, floors);
        if (prog.lastCheckFloor <= floors && threads === prog) return prog;
        if (prog.lastCheckFloor > floors) log(`上次检测楼层 ${prog.lastCheckFloor} 大于当前楼数 ${floors}，已改为 ${floors}`);
        if (threads !== prog) log(`支线与进度钟记下的楼数大于当前楼数 ${floors}，已改为 ${floors}`);
        const next = { ...threads, lastCheckFloor: Math.min(prog.lastCheckFloor, floors) };
        setProgress(next, 'floor');
        return next;
    }

    function resetBase() {
        const prog = currentProgress();
        if (!prog) return;
        log(`手动重设检测起点为第 ${floorCount()} 楼`);
        setProgress({ ...prog, lastCheckFloor: floorCount() }, 'floor');
    }

    function runPending() {
        view.clearTimeout(pendingTimer);
        if (!pendingCheck) return;
        pendingCheck = false;
        checkNow();
    }

    // 主回复还在生成（流式、后续插件处理）时先不发检测请求，等生成结束再发，避免和主回复抢接口。
    function queueCheck() {
        if (!generating) {
            view.setTimeout(() => checkNow(), 0);
            return;
        }
        if (pendingCheck) return;
        pendingCheck = true;
        log('主回复仍在生成，生成结束后检测');
        view.clearTimeout(pendingTimer);
        pendingTimer = view.setTimeout(() => {
            if (!pendingCheck) return;
            log('等待生成结束超时，直接检测');
            generating = false;
            runPending();
        }, PENDING_MAX_MS);
    }

    function onGenerationStarted(type, options, dryRun) {
        if (dryRun) return;
        generating = true;
    }

    function onGenerationEnded() {
        generating = false;
        runPending();
    }

    function onMessageReceived(messageId) {
        const floors = floorCount();
        const project = activeProject();
        if (!project) {
            log(`收到第 ${messageId} 楼：当前卡没有启用的项目，不检测`);
            emit('floor');
            return;
        }
        if (isInfinite(project)) {
            onInfiniteReceived();
            return;
        }
        const settings = data.settings();
        const prog = clampBase() || currentProgress();
        const gap = floors - prog.lastCheckFloor;
        if (gap >= settings.checkEvery) {
            log(`收到第 ${messageId} 楼：距上次检测 ${gap} 楼，触发检测`);
            queueCheck();
        } else {
            log(`收到第 ${messageId} 楼：距上次检测 ${gap} 楼，还差 ${settings.checkEvery - gap} 楼`);
        }
        emit('floor');
    }

    function onMessageChanged() {
        if (isInfinite(activeProject())) {
            refreshRead();
            revalidateTrigger();
            emit('floor');
            return;
        }
        if (!clampBase()) return;
        emit('floor');
    }

    async function onChatChanged() {
        progress = null;
        progressFor = '';
        abandonOpening();
        lastRead = null;
        pendingCheck = false;
        view.clearTimeout(pendingTimer);
        chatStartFloors = floorCount();
        notice.hide('advance');
        notice.hide('offtrack');
        notice.hide('thread');
        const id = activeId();
        if (id) {
            try {
                await data.loadProject(id);
            } catch (error) {
                toast('error', `读取项目失败：${error.message}`);
            }
        }
        log(`切换聊天：${floorCount()} 楼，${id ? `启用项目「${(data.index().projects.find(item => item.id === id) || {}).name || id}」` : '本卡没有启用项目'}`);
        if (id) clampBase();
        refreshRead();
        scheduleFallback();
        emit('chat');
    }

    // scope='chat'：只改当前聊天，本卡还没有默认时顺带设为默认；没打开聊天时改本卡默认。
    // scope='card'：改本卡默认（之后没记过项目的聊天都用它），当前聊天也跟着换。
    async function switchProject(id, scope = 'chat') {
        if (id) await data.loadProject(id);
        abandonOpening();
        const bound = bindChat(id);
        if (scope === 'card' || !bound || !data.activeIdFor(cardKey())) data.setActive(id);
        progress = null;
        progressFor = '';
        scheduleFallback();
        emit('switch');
    }

    // key 是事件在 eventTypes 里的名字，诊断页按它显示是否绑上、收到过几次。
    const BINDINGS = [
        ['WORLDINFO_ENTRIES_LOADED', onEntriesLoaded],
        ['CHAT_CHANGED', onChatChanged],
        ['MESSAGE_RECEIVED', onMessageReceived],
        ['MESSAGE_UPDATED', onMessageChanged],
        ['MESSAGE_DELETED', onMessageChanged],
        ['MESSAGE_SWIPED', onMessageChanged],
        ['GENERATION_STARTED', onGenerationStarted],
        ['GENERATION_ENDED', onGenerationEnded],
        ['GENERATION_STOPPED', onGenerationEnded],
    ];

    function bind() {
        const c = ctx();
        const types = eventTypes();
        if (!c || !c.eventSource) return;
        for (const [key, handler] of BINDINGS) {
            const name = types[key];
            if (!name) continue;
            const wrapped = (...args) => {
                const stat = stats[key] || (stats[key] = { count: 0, at: 0 });
                stat.count += 1;
                stat.at = Date.now();
                return handler(...args);
            };
            c.eventSource.on(name, wrapped);
            listeners.push([key, name, wrapped]);
        }
    }

    function unbind() {
        const c = ctx();
        for (const [, name, handler] of listeners.splice(0)) {
            try { c.eventSource.removeListener(name, handler); } catch { /* 酒馆已卸载 */ }
        }
    }

    function start() {
        unbind();
        bind();
        log(`已绑定 ${listeners.length} 个酒馆事件`);
        onChatChanged();
    }

    function stop() {
        unbind();
        view.clearTimeout(fallbackTimer);
        view.clearTimeout(pendingTimer);
    }

    function diagnose() {
        const types = eventTypes();
        const bound = new Set(listeners.map(item => item[0]));
        return {
            hasContext: Boolean(ctx()),
            hasEventSource: Boolean(ctx() && ctx().eventSource),
            events: BINDINGS.map(([key]) => ({ key, name: types[key] || '', bound: bound.has(key), count: (stats[key] || {}).count || 0, at: (stats[key] || {}).at || 0 })),
            cardKey: cardKey(),
            chatLength: chatMessages().length,
            floors: floorCount(),
            chatStartFloors,
            generating,
            pending: pendingCheck,
            checking,
            logs: logs.slice(),
        };
    }

    return {
        start,
        stop,
        activeId,
        activeProject,
        progress: () => currentProgress() || emptyProgress(''),
        setProgress,
        units,
        entries,
        openNext,
        backTo,
        checkNow,
        isChecking: () => checking,
        switchProject,
        floorCount,
        recentFloors,
        rewriteRest,
        syncSetting,
        diagnose,
        isInfinite: () => isInfinite(activeProject()),
        infState,
        openWorld,
        isOpening: () => opening,
        lastRead: () => lastRead,
        returnToTrain,
        reopenWorld,
        deleteWorld,
        note: log,
        resetBase,
        rebind: start,
        injectMode: () => (hasEntriesEvent() ? 'virtual' : 'book'),
        refresh: () => { scheduleFallback(); emit('progress'); },
    };
}
