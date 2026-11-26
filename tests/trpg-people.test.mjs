import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeImportIndex } from '../src/trpg/trpg-long-import.js';
import { peopleLines } from '../src/trpg/trpg-people.js';
import { lineTriggered } from '../src/core/personas.js';

test('人物档案：多段合并、跳过保密人物、名字出现才触发、不补回已处理的人', () => {
    let idx = mergeImportIndex([
        { 人物: [{ 名称: '林婶', 别名: ['婶子'], 公开身份: '房东', 性格: '嘴硬心软', 口吻: '爱用「哎哟」开头', 台词: '哎哟，又是你' }, { 名称: '黑衣人', 名字保密: true, 性格: '阴沉' }] },
        { 人物: [{ 名称: '林婶', 性格: '爱占小便宜', 底线: '绝不报警', 真实身份: '线人' }, { 名称: '路人甲', 公开身份: '路人' }] },
    ]);
    let r = peopleLines(idx, [], []);
    assert.deepEqual(r.names, ['林婶']);
    let line = r.lines[0],
        text = line.stages[0].text;
    assert.ok(text.includes('嘴硬心软') && text.includes('爱占小便宜') && text.includes('绝不报警'));
    assert.ok(!text.includes('线人'));
    assert.equal(line.constant, false);
    assert.equal(lineTriggered(line, '今天去找婶子聊聊'), true);
    assert.equal(lineTriggered(line, '今天没人'), false);
    assert.deepEqual(peopleLines(idx, [], ['林婶']).names, []);
});
