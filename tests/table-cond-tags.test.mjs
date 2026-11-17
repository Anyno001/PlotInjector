// 2026-11-17 酒馆实测：列名带 <user>（「对<user>阶段」）时，条件里的 < > 被当成比较符号，列名被截成「对」。
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadCore } from './load.mjs';

const C = loadCore();
await import(new URL('../src/ui/app.js', import.meta.url).href).catch(() => null);
const UIR = await import(new URL('../src/ui/import-review.js', import.meta.url).href);

const sheet = (name, head, rows, note = '') => ({ name, content: [['row_id', ...head], ...rows.map((r, i) => [String(i + 1), ...r])], sourceData: { note }, updateConfig: { updateFrequency: -1 } });
const env = (tables) => ({ facts: new Map(), knowledge: [], tables, nodeDone: () => undefined });
const ev = (cond, tables) => {
  const errs = [], atom = C.parseCondition(cond, errs);
  return { errs, atom, v: C.evalCondition(atom, env(tables)).v };
};
const T = { sheet_r: sheet('重要角色表', ['姓名', '对<user>阶段', '对彼得阶段'], [['彼得·帕克', '3 信任', '无'], ['叶莲娜', '1 相识', '2 熟悉']], '对<user>阶段：\n0 陌生\n1 相识\n2 熟悉\n3 信任\n4 亲密') };
const TIERS = ['陌生', '相识', '熟悉', '信任', '亲密'];

test('table condition: a column named 对<user>阶段 keeps its name; the operator after it is the real one', () => {
  const a = C.parseAtom('表: 重要角色表/彼得·帕克/对<user>阶段 >= 信任');
  assert.equal(a.kind, 'cell');
  assert.equal(a.path, '重要角色表/彼得·帕克/对<user>阶段');
  assert.equal(a.op, '>=');
  assert.equal(a.value, '信任');
  // 不带空格、用 == 、全角符号也一样
  assert.deepEqual([C.parseAtom('表: 重要角色表/叶莲娜/对<user>阶段==1 相识')].map((x) => [x.path, x.op, x.value]), [['重要角色表/叶莲娜/对<user>阶段', '==', '1 相识']]);
  assert.deepEqual([C.parseAtom('表: 重要角色表/叶莲娜/对<user>阶段 ＜ 熟悉')].map((x) => [x.path, x.op, x.value]), [['重要角色表/叶莲娜/对<user>阶段', '<', '熟悉']]);
  // 值里也可以有标签
  assert.equal(C.parseAtom('表: 重要角色表/彼得·帕克/备注 包含 <user>').value, '<user>');
  // 没有标签的写法不受影响
  assert.deepEqual([C.parseAtom('表: 重要角色表/巴基/关系 >= 2')].map((x) => [x.path, x.op, x.value]), [['重要角色表/巴基/关系', '>=', '2']]);
});

test('table condition with 对<user>阶段 reads the right cell at run time', () => {
  assert.equal(ev({ 表: '重要角色表/彼得·帕克/对<user>阶段 >= 信任', 档位: TIERS }, T).v, 'true');
  assert.equal(ev({ 表: '重要角色表/叶莲娜/对<user>阶段 >= 信任', 档位: TIERS }, T).v, 'false');
  assert.equal(ev('表: 重要角色表/叶莲娜/对<user>阶段 == 1 相识', T).v, 'true');
});

test('count condition: a column with <user> in its name', () => {
  const errs = [], a = C.parseCondition({ 计数: { 表: '重要角色表', 条件: '对<user>阶段 == 3 信任', 至少: 1 } }, errs);
  assert.deepEqual(errs, []);
  assert.equal(a.column, '对<user>阶段');
  assert.equal(a.op, '==');
  assert.equal(a.value, '3 信任');
});

test('review form: simpleTableCond splits 对<user>阶段 into table / row / column / op / value', () => {
  assert.deepEqual({ ...UIR.simpleTableCond({ 表: '重要角色表/彼得·帕克/对<user>阶段 >= 信任' }) }, { table: '重要角色表', row: '彼得·帕克', col: '对<user>阶段', op: '>=', value: '信任' });
  assert.deepEqual({ ...UIR.simpleTableCond({ 表: '重要角色表/巴基/关系 < 3' }) }, { table: '重要角色表', row: '巴基', col: '关系', op: '<', value: '3' });
});
