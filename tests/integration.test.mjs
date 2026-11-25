import test from 'node:test';
import assert from 'node:assert/strict';
import { migrateStableProgress, stampNodeIds } from '../src/app/runtime.js';
import { replaceStages, flattenUnits } from '../src/core/outline.js';
import { alignProgress } from '../src/core/align.js';
import { stageOpMessages } from '../src/core/prompts.js';
import { setYamlLib } from '../src/core/yaml.js';
import YAML from 'yaml';

setYamlLib(YAML);
const stage = (id, nodes) => ({id,key:'阶段_'+id,data:{主线节点:nodes}});
const vols = stages => [{id:'v',key:'剧情_卷一_测试',stages}];

test('integration: v0.2.0 stable marks survive a rename and a move to another stage',()=>{
    const volumes=vols([stage('s1',[{id:'nNew',名称:'新事件'}]),stage('s2',[{id:'nLamp',名称:'修楼道灯'}])]);
    const progress={current:'s1',slots:{s1:{off:['@nLamp']}},muted:[],offMuted:[]};
    const aligned=alignProgress(migrateStableProgress(progress,volumes),{volumes});
    assert.deepEqual(aligned.slots.s1.off,[]);
    assert.deepEqual(aligned.slots.s2.off,['m0']);
    assert.equal(aligned.slots.s2.offNames.m0,'修楼道灯');
});

test('integration: a stage split retains IDs even when the authoring model omits them; another chat keeps its marks',()=>{
    const before=vols([stage('s1',[{id:'nLamp',名称:'修灯'},{id:'nRent',名称:'收租'}])]);
    const progress=stampNodeIds({current:'s1',slots:{s1:{off:['m1'],offNames:{m1:'收租'}}}},before);
    const result=replaceStages(before,'v',['s1'],[stage('newA',[{名称:'修灯'}]),stage('newB',[{名称:'收租'}])]);
    assert.equal(result.stages[1].data.主线节点[0].id,'nRent');
    const aligned=alignProgress(migrateStableProgress(progress,result.volumes),{volumes:result.volumes});
    assert.deepEqual(aligned.slots.newB.off,['m0']);
    assert.deepEqual(aligned.slots.s1.off,[]);
});


