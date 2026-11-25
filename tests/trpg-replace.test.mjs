// 模组整份替换：对得上的剧情线 / 阶段保留编号，多的追加，少的删除。用样本模组自测。
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { loadCore } from './load.mjs';
const { parseOutlineText } = loadCore();
import { planReplace } from '../src/trpg/trpg-replace.js';

const stage = (key, data) => ({ id: `s_${key}`, key, data });

test('替换：对应保留编号，只换内容，多删少加', () => {
    const old = [
        { id: 'v1', key: '剧情_A', stages: [stage('阶段1_甲', { 时间范围: '一' }), stage('阶段2_乙', { 时间范围: '二' })] },
        { id: 'v2', key: '剧情_B', stages: [stage('阶段1_丙', { 时间范围: '三' })] },
    ];
    const next = [
        { id: 'n1', key: '剧情_A', stages: [stage('阶段1_甲', { 时间范围: '改' }), stage('阶段3_丁', { 时间范围: '新' })] },
        { id: 'n2', key: '剧情_C', stages: [stage('阶段1_戊', { 时间范围: '五' })] },
    ];
    const plan = planReplace(old, next);
    assert.equal(plan.volumes[0].id, 'v1');
    assert.equal(plan.volumes[0].stages[0].id, 's_阶段1_甲');
    assert.equal(plan.volumes[0].stages[0].data.时间范围, '改');
    assert.equal(plan.volumes[1].id, 'n2');
    assert.deepEqual(plan.removedVolumes, ['剧情_B']);
    assert.deepEqual(plan.addedVolumes, ['剧情_C']);
    assert.deepEqual(plan.stages.map((s) => s.kind).sort(), ['add', 'change', 'remove']);
});

const sample = new URL('../../厕所已满-模组(新格式).yaml', import.meta.url);
test('样本模组：改一个阶段，编号全保留，只报一处改动', { skip: !existsSync(sample) }, () => {
    const text = readFileSync(sample, 'utf8');
    const old = parseOutlineText(text);
    const next = parseOutlineText(text);
    next[0].stages[1].data = { ...next[0].stages[1].data, AI指令: '改过' };
    const plan = planReplace(old, next);
    assert.deepEqual(plan.volumes.map((v) => v.id), old.map((v) => v.id));
    assert.deepEqual(plan.volumes.flatMap((v) => v.stages.map((s) => s.id)), old.flatMap((v) => v.stages.map((s) => s.id)));
    assert.deepEqual(plan.stages.map((s) => s.kind), ['change']);
    assert.equal(plan.removedVolumes.length + plan.addedVolumes.length, 0);
});
