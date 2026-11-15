import { hostDocument, hostWindow } from '../host/st.js';

import { el } from './dom.js';
import { ICONS } from './styles.js';
export const TOUR_REVISION = 1;

export const TOUR_STEPS = {
    core: [
        {
            title: '欢迎使用剧情注入器',
            body: '剧情注入器帮你把一段剧情按步骤交给正文模型：照大纲一段段推进，或者按主角查到了什么一步步开放。花一分钟认识一下各部分。',
        },
        {
            target: '.pi-side-hd [data-act=new-project]',
            title: '新建项目',
            body: '一个项目就是一段剧情，比如一条主线或一条 if 线。新建后会自动设为当前角色卡的项目。',
            side: 'right',
        },
        {
            target: ['.pi-plist .pi-pitem', '.pi-plist'],
            title: '项目列表',
            body: '你的项目都在这里，点一下打开。带小圆点的是当前角色卡正在用的那个。右键可以改名、分组或删除。',
            side: 'right',
        },
        {
            target: '.pi-tabs',
            title: '四个页签',
            body: '一般的顺序：在「讨论」里和 AI 把剧情想清楚，写成「大纲」，到「执行」页开始注入。「设定」页可选，给没有世界观的卡用。',
            side: 'bottom',
        },
        {
            target: '.pi-side-ft',
            title: '工具',
            body: '世界书管理用来整理当前卡的世界书；数据管理用来备份和清理插件文件；插件没反应时，先去诊断页看看。',
            side: 'right',
        },
        {
            target: '.pi-top-end [data-page=settings]',
            title: '设置',
            body: '模型接口、写作基准、注入方式都在这里。第一次用请先配好「模型接口」：讨论和写大纲都要用到 AI。',
            side: 'bottom',
        },
        {
            target: '.pi-top-end [data-act=tour]',
            title: '随时重播',
            body: '每个页面都有自己的说明。到了陌生的页面，点这个问号就会播放这一页的教程。',
            side: 'bottom',
        },
    ],
    discuss: [
        {
            target: '.pi-refs',
            title: '附带参考',
            body: '发给 AI 时一起附上的资料：设定、大纲、剧情进度、最近几楼正文、世界书条目。粉色是开着的，点一下切换。附得越多，AI 越了解情况，也越费 token。',
            side: 'bottom',
        },
        {
            target: '[data-act=edit-mode]',
            title: '改大纲',
            body: '打开后，你说想怎么改大纲，AI 会在回复末尾附上一份改动提案，回复下面出现「审阅并应用」，勾选后插进大纲。目前只能加节点、调整同一阶段里的顺序。只是聊天时关掉就行。',
            side: 'bottom',
        },
        {
            target: '.pi-compose',
            title: '和 AI 讨论',
            body: '说说你想写的剧情或设定，一句话也行。AI 回复下面有「整理成设定」「据此写大纲」，想清楚了就点它们。Ctrl+Enter 发送。',
            side: 'top',
        },
    ],
    setting: [
        {
            target: '[data-setting]',
            title: '这一页做什么',
            body: '给还没有世界观的卡用，比如没有世界书的 OC 卡。这里写的设定，开玩后每一轮都会交给正文模型。卡本身有世界书的话，留空就行。',
            side: 'top',
        },
        {
            target: '[data-act=from-talk]',
            title: '从讨论整理',
            body: 'AI 把讨论记录整理成一块块的设定，先给你看草稿，你勾选采用哪几块。勾上「只追加」就不会改动已有的内容。',
            side: 'bottom',
        },
        {
            target: '[data-act=import-wb]',
            title: '从世界书导入',
            body: '把现有世界书里的条目搬过来当设定。注意：世界书里那一条要自己关掉，否则正文会收到两份。',
            side: 'bottom',
        },
        { target: '[data-act=history]', title: '历史版本', body: '每次改动前的版本都留着，可以对比，也可以回退。', side: 'bottom' },
    ],
    outline: [
        {
            target: '[data-act=import-open-panel]',
            title: '导入长文',
            body: '已经有剧情方案或小说？贴进来，AI 逐段整理成大纲草稿，你按阶段审阅后再采用。中途关掉也能接着做。',
            side: 'bottom',
        },
        {
            target: ['[data-act=import-file]', '[data-act=import-paste]'],
            title: '其他导入方式',
            body: '手上已经有现成格式的大纲时，用「导入YAML」「粘贴」或「从世界书」。',
            side: 'bottom',
        },
        {
            target: ['[data-act=ai-volume]', '[data-ai-request]'],
            title: 'AI 写一卷',
            body: '在旁边的输入框里写要求，AI 会参考讨论和设定写一卷新大纲，先给你看草稿，确认后才写进大纲。',
            side: 'bottom',
        },
        {
            target: ['.pi-tree-list', '.pi-tree'],
            title: '大纲结构',
            body: '卷 → 阶段 → 节点。点一个阶段，在右边编辑它的内容。线索推进的阶段多一块「线索字段」，写开放条件、发现和完成条件。',
            side: 'right',
        },
    ],
    run: [
        {
            target: '[data-act=activate]',
            title: '启用项目',
            body: '一张角色卡同一时间只用一个项目，点这里在当前卡上启用它。启用后，这一页才会显示注入和推进的内容。',
            side: 'bottom',
        },
        {
            target: '.pi-seg:has([data-act=clue-mode])',
            title: '推进方式',
            body: '大纲推进由 AI 判断这一阶段演完没有，演完就推到下一阶段。线索推进按主角实际查到了什么来开放下一步，适合调查、解谜类剧情。两种的进度分开保存，可以随时切换。',
            side: 'bottom',
        },
        // 大纲推进
        {
            target: '.pi-entry-hd',
            title: '注入条目',
            body: '每一轮交给正文的内容：设定和当前阶段。可以单独关掉某一条，或者调整注入的位置。点「预览」能看到这一轮实际发出去了什么。',
            side: 'bottom',
        },
        { target: '.pi-pace', title: '推进速度', body: '告诉正文这一段该细写还是一笔带过。', side: 'bottom' },
        {
            target: ['[data-act=check]', '[data-act=rewrite]'],
            title: '检测与改写',
            body: '插件每隔几楼会让 AI 检查进度，也可以手动「立即检测」。剧情偏离大纲太多时，用「改写后续」让 AI 按现在的走向重写之后的阶段，已经演完的部分不动。',
            side: 'bottom',
        },
        { target: '.pi-tl-vol', title: '阶段时间线', body: '每个阶段的状态。点阶段右边的「⋯」可以手动设为当前、标为已完成。', side: 'top' },
        // 线索推进
        {
            target: '[data-act=clue-gen-template]',
            title: '生成线索模板',
            body: '线索推进靠数据库里的三张表记录主角查到了什么。第一次在一个聊天里用时，先点这里加上这三张表，原有的表和数据都不动。',
            side: 'bottom',
        },
        {
            target: '[data-act=clue-prebuild]',
            title: '按大纲补预建行',
            body: '大纲里新加了线索以后，用它把缺的部分补进表格，已有的不动。',
            side: 'bottom',
        },
        {
            target: '[data-act=clue-pause]',
            title: '暂停主线',
            body: '想先玩一段日常时暂停，不再注入线索内容，进度保留。主线走完后，这里会出现「开始下一段主线」。',
            side: 'bottom',
        },
        {
            target: '[data-act=clue-refresh]',
            title: '本轮场景',
            body: '这一轮主角在哪个调查、可能拿到什么。点「预览」看实际发给正文的内容；表格刚改过时点「重新读表」。',
            side: 'bottom',
        },
        {
            target: ['.pi-clue-hd', '.pi-clue-stage'],
            title: '节点',
            body: '每个调查当前的状态。点节点右边的菜单，可以手动开放、标记完成或确认一条线索，填表漏记时用。',
            side: 'top',
        },
    ],
    settings: [
        {
            target: '[data-act=llm-role]',
            title: '模型接口',
            body: '讨论、写设定与大纲、进度检测三种用途分开配置。可以直接用酒馆当前的连接，也可以单独填一个接口，比如让便宜的模型做进度检测。',
            side: 'bottom',
        },
        {
            target: '[data-guide-preset]',
            title: '写作基准',
            body: '讨论和整理设定时，AI 照这份基准来写。默认是通用版；写同人选「同人世界观速成」；也可以选「自定义」自己改。',
            side: 'top',
        },
        {
            target: '[data-set=bodyGuide]',
            title: '正文通用提示',
            body: '每一轮附在剧情材料前面的两段通用说明，比如「角色只知道自己亲历或听说的事」。一般保持开启。',
            side: 'bottom',
        },
        {
            target: '[data-set=checkEvery]',
            title: '阶段推进',
            body: '大纲推进时，每隔几楼让 AI 检查一次进度，以及演完、偏离时要不要先问你。',
            side: 'bottom',
        },
        { target: '[data-act=tour-reset]', title: '重新播放教程', body: '想从头再看一遍各页说明时点这里。', side: 'top' },
    ],
    books: [{ title: '世界书管理', body: '整理当前角色卡用到的世界书：开关条目、改关键词、批量替换、复制和删除。改动前会先下载备份。' }],
    data: [
        {
            title: '数据管理',
            body: '插件的项目、讨论记录、导入任务都存在酒馆的文件里。这里可以核对文件、导出、清理不属于任何项目的文件；「备份并删除」会先下载全部备份再重置插件。',
        },
    ],
    diag: [
        {
            title: '诊断',
            body: '插件没反应、注入内容不对时，先到这里看：自动检测会列出发现的问题，下面有酒馆事件和最近的记录。反馈问题时可以复制这一页的内容。',
        },
    ],
};

export function tourScopeOf(view) {
    return view.page ? view.page : view.project() ? view.tab : 'core';
}

export function tourState(data) {
    let s = data.settings().tourState;
    return s && typeof s == 'object' && s.revision === TOUR_REVISION
        ? { revision: TOUR_REVISION, done: Array.isArray(s.done) ? s.done : [] }
        : { revision: TOUR_REVISION, done: [] };
}

export function markTourDone(data, scope) {
    let s = tourState(data);
    s.done.includes(scope) || data.updateSettings({ tourState: { ...s, done: [...s.done, scope] } });
}

export function createTour({ getRoot, data }) {
    let doc = hostDocument(),
        win = hostWindow(),
        layer = null,
        scope = '',
        steps = [],
        idx = 0,
        raf = 0;
    // 没有 requestAnimationFrame 的环境（少数内嵌浏览器、测试）退回定时器。
    let nextFrame = (fn) => (typeof win.requestAnimationFrame == 'function' ? win.requestAnimationFrame(fn) : win.setTimeout(fn, 16)),
        cancelFrame = (id) => (typeof win.cancelAnimationFrame == 'function' ? win.cancelAnimationFrame(id) : win.clearTimeout(id));
    let visible = (node) => {
        if (!node || !node.isConnected) return !1;
        let r = node.getBoundingClientRect(),
            cs = win.getComputedStyle(node);
        return r.width > 0 && r.height > 0 && cs.display !== 'none' && cs.visibility !== 'hidden';
    };
    let findTarget = (step) => {
        if (!step || !step.target) return null;
        let root = getRoot();
        if (!root) return null;
        for (let sel of [].concat(step.target)) {
            let hit;
            try {
                hit = [...root.querySelectorAll(sel)].find(visible);
            } catch {
                hit = null;
            }
            if (hit) return hit;
        }
        return null;
    };
    // 要播的步骤：居中步骤总是保留；指向按钮的步骤，按钮此刻在才保留。
    let available = () => steps.map((s, i) => ({ s, i })).filter(({ s }) => !s.target || findTarget(s));
    function layout() {
        raf = 0;
        if (!layer) return;
        let step = steps[idx],
            target = findTarget(step),
            vw = win.innerWidth,
            vh = win.innerHeight,
            pop = layer.querySelector('.pi-tour-pop'),
            hole = layer.querySelector('.pi-tour-hole'),
            mask = layer.querySelector('.pi-tour-mask path');
        let full = `M0 0H${vw}V${vh}H0Z`;
        if (!target) {
            (mask.setAttribute('d', full), (hole.hidden = !0));
            let pr = pop.getBoundingClientRect();
            return (
                (pop.style.left = `${Math.max(12, (vw - pr.width) / 2)}px`),
                (pop.style.top = `${Math.max(12, (vh - pr.height) / 2)}px`)
            );
        }
        let r = target.getBoundingClientRect(),
            pad = 6,
            x = r.left - pad,
            y = r.top - pad,
            w = r.width + pad * 2,
            h = r.height + pad * 2;
        (mask.setAttribute('d', `${full}M${x} ${y}H${x + w}V${y + h}H${x}Z`),
            (hole.hidden = !1),
            Object.assign(hole.style, { left: `${x}px`, top: `${y}px`, width: `${w}px`, height: `${h}px` }));
        let pr = pop.getBoundingClientRect(),
            gap = 14,
            edge = 12,
            fits = (p) => p.left >= edge && p.top >= edge && p.left + pr.width <= vw - edge && p.top + pr.height <= vh - edge;
        let at = {
            top: { left: r.left + r.width / 2 - pr.width / 2, top: y - gap - pr.height },
            bottom: { left: r.left + r.width / 2 - pr.width / 2, top: y + h + gap },
            left: { left: x - gap - pr.width, top: r.top + r.height / 2 - pr.height / 2 },
            right: { left: x + w + gap, top: r.top + r.height / 2 - pr.height / 2 },
        };
        let pick = [step.side || 'bottom', 'bottom', 'top', 'right', 'left'].map((k) => at[k]).find(fits) || at[step.side || 'bottom'];
        ((pop.style.left = `${Math.min(Math.max(edge, pick.left), vw - pr.width - edge)}px`),
            (pop.style.top = `${Math.min(Math.max(edge, pick.top), vh - pr.height - edge)}px`));
    }
    let relayout = () => raf || (raf = nextFrame(layout));
    function show(i) {
        let list = available();
        if (!list.length) return stop(!0);
        let k = list.findIndex((x) => x.i === i);
        k < 0 &&
            ((k = Math.max(
                0,
                list.findIndex((x) => x.i > i),
            )),
            list[k] || (k = list.length - 1));
        idx = list[k].i;
        let step = steps[idx],
            target = findTarget(step),
            pop = layer.querySelector('.pi-tour-pop'),
            last = k === list.length - 1;
        ((pop.querySelector('.pi-tour-title').textContent = step.title), (pop.querySelector('.pi-tour-body').textContent = step.body));
        pop.querySelector('.pi-tour-count').textContent = `${k + 1} / ${list.length}`;
        ((pop.querySelector('[data-tour=prev]').disabled = k === 0),
            (pop.querySelector('[data-tour=next]').textContent = last ? '完成' : '下一步'));
        // 按钮在可滚动区域里看不见时先滚过去，再定位。
        target && target.scrollIntoView && target.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        (layout(), nextFrame(() => nextFrame(layout)), pop.querySelector('[data-tour=next]').focus({ preventScroll: !0 }));
    }
    function step(dir) {
        let list = available(),
            k = list.findIndex((x) => x.i === idx);
        if (dir > 0 && k >= list.length - 1) return stop(!0);
        let next = list[Math.min(list.length - 1, Math.max(0, k + dir))];
        next && show(next.i);
    }
    let onKey = (event) => {
        if (!layer) return;
        // 上层还有插件弹窗时，按键归弹窗（内测前审阅）：右箭头不翻教程、Esc 只关弹窗。
        if (doc.querySelector('.pi-dialog')) return;
        // 焦点在教程的按钮上时，Enter 交给按钮本身（在「×」上按 Enter 是关闭，不是下一步）。
        if (event.key === 'Enter' && event.target && event.target.closest && event.target.closest('.pi-tour [data-tour]')) return;
        if (event.key === 'Escape') (event.stopPropagation(), event.preventDefault(), stop(!0));
        else if (event.key === 'ArrowRight' || event.key === 'Enter') (event.stopPropagation(), event.preventDefault(), step(1));
        else event.key === 'ArrowLeft' && (event.stopPropagation(), event.preventDefault(), step(-1));
    };
    function start(name, { auto = !1 } = {}) {
        stop(!1);
        if (!TOUR_STEPS[name]) return !1;
        if (auto && tourState(data).done.includes(name)) return !1;
        ((scope = name), (steps = TOUR_STEPS[name]));
        if (!available().length) return !1;
        layer = el(`<div class="pi-root pi-tour" role="presentation">
          <svg class="pi-tour-mask" aria-hidden="true"><path fill-rule="evenodd"></path></svg>
          <div class="pi-tour-hole" aria-hidden="true"></div>
          <div class="pi-tour-pop" role="dialog" aria-modal="true" aria-labelledby="pi-tour-title">
            <div class="pi-tour-hd"><span class="pi-tour-icon" aria-hidden="true">?</span><b class="pi-tour-title" id="pi-tour-title"></b><button type="button" class="pi-tour-x" data-tour="close" title="关闭教程" aria-label="关闭教程">${ICONS.close}</button></div>
            <p class="pi-tour-body"></p>
            <div class="pi-tour-ft"><span class="pi-tour-count"></span><span class="pi-spacer"></span><button type="button" class="pi-btn is-sm" data-tour="prev">上一步</button><button type="button" class="pi-btn is-sm is-primary" data-tour="next">下一步</button></div>
          </div></div>`);
        // 教程进行中不能点页面：遮罩层吃掉所有点击，只有气泡里的按钮能用。
        (layer.addEventListener('click', (event) => {
            let b = event.target.closest('[data-tour]');
            b && (b.dataset.tour === 'next' ? step(1) : b.dataset.tour === 'prev' ? step(-1) : stop(!0));
        }),
            doc.body.appendChild(layer),
            doc.addEventListener('keydown', onKey, !0),
            win.addEventListener('resize', relayout),
            win.addEventListener('scroll', relayout, !0));
        return (show(available()[0].i), !0);
    }
    // done：看完或关掉都算看过这一页；被打断（切页、关面板）不算。
    function stop(done) {
        if (!layer) return;
        (done && markTourDone(data, scope),
            doc.removeEventListener('keydown', onKey, !0),
            win.removeEventListener('resize', relayout),
            win.removeEventListener('scroll', relayout, !0),
            raf && cancelFrame(raf),
            (raf = 0),
            layer.remove(),
            (layer = null));
    }
    return { start, stop, isOpen: () => !!layer, relayout, scope: () => (layer ? scope : '') };
}
