// 跑团「模组」整份替换：按剧情线名、阶段名对应，保留原来的编号，只换内容；进度靠这些编号存，所以对得上的绝不换号。
import { isPlainObject, pushOutlineHistory, stageLabel, volumeName } from '../core/outline.js';
import { historyGuard, restoreHistory } from './trpg-clue-project.js';

function stable(value) {
    if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
    if (isPlainObject(value))
        return `{${Object.keys(value)
            .sort()
            .map((k) => `${JSON.stringify(k)}:${stable(value[k])}`)
            .join(',')}}`;
    return JSON.stringify(value === undefined ? null : value);
}

// 同名的按出现顺序依次对应，取过的不再给别人。
function takeBy(list) {
    const used = new Set();
    return (key) => {
        const hit = list.find((item) => item.key === key && !used.has(item));
        return (hit && used.add(hit), hit || null);
    };
}

// 返回：volumes 替换后的完整大纲；addedVolumes / removedVolumes 剧情线名；stages 逐阶段的 { vol, stage, kind: 'add' | 'remove' | 'change' }。
export function planReplace(oldVolumes, newVolumes) {
    const take = takeBy(oldVolumes),
        stages = [],
        volumes = [],
        addedVolumes = [],
        matched = new Set();
    for (const next of newVolumes) {
        const old = take(next.key);
        if (!old) {
            addedVolumes.push(next.key);
            volumes.push(next);
            continue;
        }
        matched.add(old);
        const takeStage = takeBy(old.stages),
            keptStages = new Set(),
            outStages = next.stages.map((s) => {
                const was = takeStage(s.key);
                if (!was) return (stages.push({ vol: old.key, stage: s.key, kind: 'add' }), s);
                keptStages.add(was);
                stable(was.data) !== stable(s.data) && stages.push({ vol: old.key, stage: s.key, kind: 'change' });
                return { ...s, id: was.id };
            });
        for (const s of old.stages) keptStages.has(s) || stages.push({ vol: old.key, stage: s.key, kind: 'remove' });
        const { line: _drop, ...rest } = old,
            out = { ...rest, stages: outStages };
        if (isPlainObject(next.line)) out.line = next.line;
        volumes.push(out);
    }
    const removedVolumes = oldVolumes.filter((v) => !matched.has(v)).map((v) => v.key);
    return { volumes, addedVolumes, removedVolumes, stages };
}

// 确认框要显示的行：新增 / 删除的剧情线，新增 / 删除 / 改动的阶段。
export function planLines(plan, word = '剧情线') {
    const kindLabel = { add: '新增阶段', remove: '删除阶段', change: '改动阶段' },
        stageLines = plan.stages.map((s) => `${kindLabel[s.kind]}：${volumeName(s.vol)} / ${stageLabel(s.stage)}`);
    return [
        ...plan.addedVolumes.map((k) => `新增${word}：${volumeName(k)}`),
        ...plan.removedVolumes.map((k) => `删除${word}：${volumeName(k)}`),
        ...stageLines,
    ];
}

// 和「AI替换剧情线」同一套：按这个聊天的进度做历史校验，已完成的节点保留。clue = { snap, prog, config } 或 null。
export function prepareReplace(project, newVolumes, { clue = null, label = '导入替换' } = {}) {
    const current = project.outline.volumes,
        plan = planReplace(current, newVolumes);
    let volumes = plan.volumes,
        guard = null,
        restored = [];
    if (clue && clue.snap) {
        guard = historyGuard(current, volumes, clue.snap, clue.prog, clue.config);
        if (guard.keepDone.size || guard.reinsert.size) {
            volumes = restoreHistory(volumes, guard);
            restored = [...guard.keepDone.keys(), ...guard.reinsert.keys()];
        }
    }
    return { volumes, plan, guard, restored, history: pushOutlineHistory(project.outline.history, current, label), stamp: JSON.stringify(current) };
}

export function commitReplace(project, prepared) {
    if (JSON.stringify(project.outline.volumes) !== prepared.stamp) return { ok: !1, why: '确认期间大纲又被改过了' };
    return { ok: !0, outline: { ...project.outline, volumes: prepared.volumes, history: prepared.history } };
}
