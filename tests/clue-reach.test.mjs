// 线索模式的可达性检查：只拿依赖另一项的那一项，会报「走不通」。
// （原来是讨论页「改大纲」提案的测试；提案流程已删除（GPT 第三轮清理 D1），只保留这条仍有效的检查行为。）
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';

const C = loadCore();

test('clue mode: a node that depends on a fact no node produces is flagged as 走不通; with its producer it is fine', () => {
  const start = { id: 'n0', 名称: '起点', 入口: 'e', 发现: [{ 事实: 'F0', 内容: 'c' }], 完成条件: { 事实: 'F0' } };
  const witness = { id: 'nw', 名称: '证人', 入口: '找证人', 发现: [{ 事实: 'F_wit', 内容: '证词' }], 完成条件: { 事实: 'F_wit' } };
  const confront = { id: 'nc', 名称: '对质', 入口: '去对质', 开放条件: { 事实: 'F_wit' }, 发现: [{ 事实: 'F_end', 内容: '认罪' }], 完成条件: { 事实: 'F_end' } };
  const vol = (nodes) => [{ id: 'v1', key: '剧情_卷一_案', stages: [{ id: 's1', key: '阶段一_查', data: { 主线节点: nodes } }] }];
  assert.deepEqual(C.checkClueDraft([], [], { applied: vol([start, witness, confront]) }).filter((x) => /走不通/.test(x)), []);
  assert.match(C.checkClueDraft([], [], { applied: vol([start, confront]) }).join('\n'), /走不通/);
});
