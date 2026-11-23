import { FOLD_AUTO_RELEASED } from '../core/fold.js';
import { resolveLlm } from '../core/store.js';
import { cardName, ctx, hostDocument, hostWindow, toast } from '../host/st.js';
import { esc } from './dom.js';

// 诊断：只读运行时状态；每个修复按钮对应一种已知原因。
const NEED = ['CHAT_CHANGED', 'MESSAGE_RECEIVED'];
const EVENT_LABELS = {
    WORLDINFO_ENTRIES_LOADED: '条目加载（注入）',
    CHAT_CHANGED: '切换聊天',
    MESSAGE_RECEIVED: '收到回复（触发检测）',
    MESSAGE_UPDATED: '编辑楼层',
    MESSAGE_DELETED: '删除楼层',
    MESSAGE_SWIPED: '切换回复',
    GENERATION_STARTED: '开始生成',
    GENERATION_ENDED: '生成结束',
    GENERATION_STOPPED: '停止生成',
    CHAT_COMPLETION_PROMPT_READY: '请求就绪（线索核验）',
    GENERATE_AFTER_COMBINE_PROMPTS: '文本请求就绪（线索核验）',
};

const time = (at) => (at ? new Date(at).toLocaleTimeString('zh-CN', { hour12: false }) : '—');

function collect(view) {
    const { data, runtime } = view,
        d = runtime.diagnose(),
        settings = data.settings(),
        id = runtime.activeId(),
        meta = data.index().projects.find((item) => item.id === id),
        progress = id ? runtime.progress() : null,
        llm = resolveLlm(settings, 'check'),
        c = ctx();
    return {
        ...d,
        mode: runtime.clue.diagnose().mode,
        settings,
        id,
        name: meta ? meta.name : '',
        progress,
        llm,
        units: id ? runtime.units().length : 0,
        card: cardName(),
        chatId: (c && typeof c.getCurrentChatId == 'function' && c.getCurrentChatId()) || '',
        version: view.version,
    };
}

// 每条问题带一个修复动作（可为空）。
function problems(info) {
    const out = [];
    if (!info.hasContext || !info.hasEventSource) out.push({ text: '无法读取酒馆事件接口，酒馆版本可能过旧。', fix: '' });
    const missing = info.events.filter((item) => NEED.includes(item.key) && !item.name);
    if (missing.length) out.push({ text: `酒馆未提供事件：${missing.map((item) => item.key).join('、')}。`, fix: '' });
    const unbound = info.events.filter((item) => NEED.includes(item.key) && item.name && !item.bound);
    if (unbound.length) out.push({ text: '检测所需事件未绑定。', fix: 'rebind' });
    if (!info.cardKey) out.push({ text: '未打开角色卡聊天。', fix: '' });
    else if (!info.id) out.push({ text: `「${info.card}」未启用项目，自动检测不运行。`, fix: '' });
    else if (!info.units) out.push({ text: '启用项目的大纲为空，无可检测阶段。', fix: '' });
    if (info.progress && Number(info.progress.lastFailFloor) > info.floors)
        out.push({ text: `上次检测失败楼层（${info.progress.lastFailFloor}）超过当前楼数（${info.floors}）。`, fix: 'reset-base' });
    if (info.progress && info.progress.lastCheckFloor > info.floors)
        out.push({ text: `上次检测楼层（${info.progress.lastCheckFloor}）超过当前楼数（${info.floors}）。`, fix: 'reset-base' });
    if (info.llm.source === 'custom' && !String(info.llm.model || '').trim())
        out.push({ text: '进度检测使用独立接口，未选择模型。', fix: '' });
    const received = info.events.find((item) => item.key === 'MESSAGE_RECEIVED');
    // 打开聊天后楼数涨了两楼以上（一问一答）却一次没收到，才说明事件没传到插件。
    if (received && received.bound && !received.count && info.floors - info.chatStartFloors >= 2)
        out.push({ text: '打开聊天后已有新回复，但未收到「收到回复」事件。', fix: 'rebind' });
    return out;
}

function nextText(info) {
    if (!info.progress) return '—';
    const gap = info.floors - Math.max(info.progress.lastCheckFloor, Number(info.progress.lastFailFloor) || 0);
    const left = info.settings.checkEvery - gap;
    return left > 0 ? `还需${left}楼` : '下一条回复后检测';
}

function rows(info) {
    let clueOn = info.mode === 'clue',
        state = info.checking ? '检测中' : info.pending ? '等待主回复生成结束' : info.generating ? '主回复生成中' : '空闲',
        llm = info.llm.source === 'custom' ? `独立接口${info.llm.model || '（未选模型）'}` : '酒馆当前连接';
    return [
        ['版本', `v${info.version}`],
        ['角色卡', info.card || '—'],
        ['聊天', info.chatId || '—'],
        ['启用项目', info.name || '—'],
        ['当前楼数', String(info.floors)],
        ...(clueOn
            ? []
            : [
                  ['上次检测楼层', info.progress ? String(info.progress.lastCheckFloor) : '—'],
                  ...(info.progress && info.progress.lastFailFloor ? [['上次检测失败楼层', String(info.progress.lastFailFloor)]] : []),
                  ['检测间隔', `每${info.settings.checkEvery}楼`],
                  ['下次检测', nextText(info)],
              ]),
        ['检测接口', llm],
        ['状态', state],
    ];
}

function plainText(info) {
    const lines = ['【剧情注入器诊断】', ...rows(info).map(([k, v]) => `${k}：${v}`), '', '【事件】'];
    for (const item of info.events)
        lines.push(
            `${item.key}（${item.name || '酒馆未提供'}）：${item.bound ? `已绑定，收到${item.count}次，最近${time(item.at)}` : '未绑定'}`,
        );
    const list = problems(info);
    lines.push('', '【问题】', ...(list.length ? list.map((item) => `- ${item.text}`) : ['无']));
    lines.push('', '【最近记录】', ...(info.logs.length ? info.logs.map((item) => `${time(item.at)} ${item.text}`) : ['无']));
    return lines.join('\n');
}

export function render(view) {
    let info = collect(view),
        list = problems(info),
        fixes = { rebind: '重新绑定事件', 'reset-base': '从当前楼重新计数' },
        problemHtml = list.length
            ? list
                  .map(
                      (item) =>
                          `<div class="pi-diag-row"><span class="pi-badge is-warn">问题</span><span class="pi-diag-text">${esc(item.text)}</span>${item.fix ? `<button type="button" class="pi-btn is-sm" data-act="${item.fix}">${fixes[item.fix]}</button>` : ''}</div>`,
                  )
                  .join('')
            : '<p class="pi-hint">没有发现问题。</p>',
        events = info.events
            .map(
                (item) => `<tr><td>${esc(EVENT_LABELS[item.key] || item.key)}</td>
        <td>${item.name ? (item.bound ? '<span class="pi-badge is-ok">已绑定</span>' : '<span class="pi-badge is-warn">未绑定</span>') : '<span class="pi-badge is-danger">酒馆未提供</span>'}</td>
        <td>${item.count}次</td><td>${time(item.at)}</td></tr>`,
            )
            .join(''),
        logs = info.logs.length
            ? info.logs
                  .slice()
                  .reverse()
                  .map((item) => `${time(item.at)}  ${item.text}`).join(`
`)
            : '暂无记录';
    return `<div class="pi-card"><h3>自动检测${list.length ? `<span class="pi-badge is-warn">${list.length}个问题</span>` : '<span class="pi-badge is-ok">正常</span>'}</h3>
        <table class="pi-files"><tbody>${rows(info)
            .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`)
            .join('')}</tbody></table>
        <div class="pi-tools is-c4 is-end">
            <button type="button" class="pi-btn is-sm is-primary" data-act="check"${info.checking ? ' disabled' : ''} title="${info.mode === 'clue' ? 'AI判断本轮场景是否演完，仅给出建议，不改变进度' : 'AI检查当前阶段的进度'}">立即检测</button>
            ${info.mode === 'clue' ? '' : `<button type="button" class="pi-btn is-sm" data-act="reset-base"${info.progress ? '' : ' disabled'} title="下次检测从当前楼开始计数">从当前楼重新计数</button>`}
            <button type="button" class="pi-btn is-sm" data-act="rebind" title="收不到酒馆事件时使用，重新注册监听">重新绑定事件</button>
            <button type="button" class="pi-btn is-sm" data-act="copy">复制诊断</button></div></div>
        <div class="pi-card"><h3>问题</h3>${problemHtml}</div>
        ${clueDiagCard(view)}
        ${view.runtime.clue.diagnose().mode === 'clue' ? '' : `<div class="pi-card"><h3>最终请求核验</h3><p class="pi-hint">发送前检查请求中是否含有不应出现的剧情（标为「仅作者」的内容、未到的阶段），只检查不修改。</p>${auditHtml(info.lastOutlineAudit, '剧情内容')}</div>`}
        <div class="pi-card"><h3>酒馆事件</h3>
        <table class="pi-files"><thead><tr><th>事件</th><th>状态</th><th>收到</th><th>最近</th></tr></thead><tbody>${events}</tbody></table></div>
        <div class="pi-card"><h3>最近记录</h3><pre class="pi-pre">${esc(logs)}</pre></div>`;
}

async function copyText(text) {
    const doc = hostDocument();
    try {
        await hostWindow().navigator.clipboard.writeText(text);
        return true;
    } catch {
        const box = doc.createElement('textarea');
        box.value = text;
        box.className = 'pi-copy-box';
        doc.body.appendChild(box);
        box.select();
        const ok = Boolean(doc.execCommand && doc.execCommand('copy'));
        box.remove();
        return ok;
    }
}

export const actions = {
    async check(view) {
        await view.runtime.checkNow({ manual: true });
        view.renderBody();
    },
    'reset-base'(view) {
        view.runtime.resetBase();
        toast('success', '已从当前楼重新计数。');
        view.renderBody();
    },
    rebind(view) {
        view.runtime.rebind();
        toast('success', '已重新绑定酒馆事件。');
        view.renderBody();
    },
    async copy(view) {
        const ok = await copyText(plainText(collect(view)));
        toast(ok ? 'success' : 'warning', ok ? '已复制诊断' : '复制失败，请手动选择文字复制');
    },
};

export function clueDiagCard(view) {
    let d = view.runtime.clue.diagnose();
    if (d.mode !== 'clue') return '';
    let yes = (v) => (v ? '<span class="pi-badge is-ok">是</span>' : '<span class="pi-badge is-warn">否</span>'),
        last = d.lastInjected;
    return `<div class="pi-card"><h3>线索</h3><table class="pi-files"><tbody>${[
        ['数据库插件', yes(d.api)],
        ['计算依据', '数据库最近一次填好的表格'],
        ['主线开关', d.enabled === null ? '—' : yes(d.enabled)],
        ['最近表格更新', d.lastTableUpdate ? `${time(d.lastTableUpdate)}（${Math.round(d.tableAgeMs / 1e3)}秒前）` : '本次打开后暂无'],
    ]
        .map(([k, v]) => `<tr><th>${esc(k)}</th><td>${v}</td></tr>`)
        .join('')}</tbody></table>
        ${d.problems.length ? d.problems.map((p) => `<p class="pi-hint is-warn">${esc(p)}</p>`).join('') : ''}
        ${sizeHtml(d.size)}
        ${foldHtml(view.runtime.clue.foldCheck())}
        ${auditHtml(d.lastAudit)}
        ${last ? `<p class="pi-hint">上次实际注入（${time(last.at)}）${last.facts.length ? `，涉及事实${esc(last.facts.join('、'))}` : ''}：</p><pre class="pi-pre">${esc(last.content || `（空：${last.reason}）`)}</pre>` : '<p class="pi-hint">本次打开后暂无注入记录。</p>'}
        ${
            d.events.length
                ? `<pre class="pi-pre">${esc(
                      d.events
                          .slice()
                          .reverse()
                          .map((e) => `${time(e.at)}  ${e.text}`).join(`
`),
                  )}</pre>`
                : ''
        }</div>`;
}

export function auditHtml(a, what = '线索内容') {
    if (!a) return '<p class="pi-hint">最终请求核验：本次打开后暂无正文请求。</p>';
    let head = `最终请求核验（${time(a.at)}，请求约${a.chars}字）：`;
    return !a.leaks.length && !a.duplicated
        ? `<p class="pi-hint">${head}<span class="pi-badge is-ok">未发现不应出现的剧情</span>${a.projectionCount === 1 ? `，${what}出现1次` : ''}</p>`
        : `<p class="pi-hint is-warn">${head}${a.duplicated ? `${what}出现${a.projectionCount}次（重复注入）。` : ''}${a.leaks.length ? `发现${a.leaks.length}处不应出现的剧情：` : ''}</p>${
              a.leaks.length
                  ? `<ul class="pi-clue-why">${a.leaks
                        .slice(0, 12)
                        .map((l) => `<li>${esc(l.source)}：「${esc(l.sample)}…」${l.where ? `<b>（在${l.where === 'setting' ? '设定' : '数据库表格'}里）</b>` : ''}</li>`)
                        .join('')}</ul>${leakFixHtml(a.leaks)}`
                  : ''
          }`;
}

// 按命中位置说怎么改（用户 2026-11-23：看完诊断不知道怎么修）
function leakFixHtml(leaks) {
    let has = (w) => leaks.some((l) => (l.where || '') === w),
        tips = [];
    has('setting') &&
        tips.push('在设定里：设定每轮都会发给正文AI，写在里面的线索答案等于提前剧透。到「设定」页找到这句删掉，或用「仅作者」框起来（只给你看、不注入），也可以把整个分块设成不注入。');
    has('table') &&
        tips.push('在数据库表格里：多半是填表模型把还没发生的事写进了表格（比如纪要）。到数据库里找到这行删掉或改掉。');
    has('') && tips.push('位置没认出来：可能在预设、角色卡描述、开场白或别的插件里。在酒馆「提示词查看」里搜引号里的这几个字，找到后删掉。');
    tips.push('如果这句其实是公开信息（主角一开始就知道），说明大纲把它写成了要查才知道的线索，到大纲里改掉这条发现就不会再报。');
    return tips.map((t) => `<p class="pi-hint">${esc(t)}</p>`).join('');
}

// 收起已结束的线（方案 三）：可收起、已收起、待核对的行，以及每条线等的是哪次填表。
const FILL_NAMES = { auto_fill: '自动填表', manual_fill: '手动填表', group_fill: '分组填表' };
export function foldHtml(f) {
    if (!f || !f.lines.length) return '';
    let ready = f.lines.filter((x) => x.rows && x.fill.ok),
        wait = f.lines.filter((x) => x.rows && !x.fill.ok),
        facts = f.lines.reduce((n, x) => n + x.factRows, 0),
        knows = f.lines.reduce((n, x) => n + x.knowRows, 0),
        kept = f.lines.flatMap((x) => x.kept),
        folded = f.status.filter((x) => x.st === 'folded' || x.st === 'lost').length,
        check = f.status.filter((x) => x.st === 'check').length,
        rows = [
            ['自动收起', FOLD_AUTO_RELEASED[f.storage] ? '已开放' : '尚未开放（可手动收起）'],
            ['已收起的行', `${folded}行${check ? `，${check}行待核对` : ''}`],
            ['已结束的线', `${f.lines.length}条（可收起${ready.length}条，待填表${wait.length}条）`],
            ['可收起的行', `关键事实表${facts}行，知情表${knows}行`],
            ['保留的线索', kept.length ? `${kept.length}条（${kept.slice(0, 6).map((k) => k.fact).join('、')}${kept.length > 6 ? '等' : ''}）` : '无'],
            ['存储模式', f.storage === 'sqlite' ? 'SQLite' : '原生'],
        ],
        notes = [
            ...(f.blocked ? [`${f.blocked}，不收起。`] : []),
            ...f.problems,
            ...ready.map((x) => `${x.id}：第${x.fill.floor}楼的${x.fill.sources.map((s) => FILL_NAMES[s] || s).join('、')}符合条件。`),
            ...wait.map((x) =>
                x.endFloor < 0
                    ? `${x.id}：结束楼层尚未记录，下次填表后记录。`
                    : x.fill.why === 'table'
                      ? `${x.id}：读不到关键事实表的编号。`
                      : `${x.id}：尚无有效填表记录（需在第${x.endFloor}楼之后，且关键事实表和知情表都已更新）。`,
            ),
        ];
    return `<p class="pi-hint"><b>收起已结束的线</b></p><table class="pi-files"><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>${notes.map((n) => `<p class="pi-hint">${esc(n)}</p>`).join('')}`;
}

// 本轮规模：列出每轮发出的、与当前剧情无关部分的实际大小。
function sizeHtml(z) {
    if (!z) return '';
    let rows = [
        ['线索表里的行', `关键事实${z.factRows}行，知情${z.knowRows}行`],
        ['线索表数据（估算）', `约${z.tableChars}字（三张线索表行文字的长度，非填表请求的实际长度）`],
        ['还没建行的线索', z.future ? `${z.future}条（属于未开始的线，开始后自动补行）` : '无'],
        ['剧情线', `进行中${z.running}条，可开启${z.openable}条`],
        ['场景目录', `${z.catalog}个入口`],
        ['上次插件注入正文', z.injected === null ? '本次打开后暂无' : `约${z.injected}字（不含检测请求）`],
    ];
    return `<p class="pi-hint"><b>本轮规模</b></p><table class="pi-files"><tbody>${rows.map(([k, v]) => `<tr><th>${esc(k)}</th><td>${esc(v)}</td></tr>`).join('')}</tbody></table>`;
}
