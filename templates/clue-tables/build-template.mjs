// 「线索推进」配套表格模板的生成脚本。表格的定义只有一份：插件源码 src/core/clue-template.js
// （执行页「生成线索模板」按钮用的就是它）；这里加载那份核心代码来生成随包文件，避免两边不一致。
// 用法：node templates/clue-tables/build-template.mjs
//   → 线索推进表格模板.json          只有三张线索表（给已经有自己表格的聊天手动导入用）
//   → 线索推进表格模板_含默认表.json  官方数据库 spv8.9.2 默认 8 张表 + 三张线索表（新建聊天直接导入用）
//   → 插件绑定.yaml
//
// 设计原则（见 设计说明.md、设计决定 D22/D23）：
// - 只记已经在正文里发生 / 揭示的内容；作者秘密与未来安排不入表。
// - 关键事实表、知情表的行由卡作者预先建好（只写编号和中性标签，不写答案），填表只改格子。
// - 判断规则写成填表模型可以机械执行的形式；范例与任何具体剧情无关。
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
import * as core from "../../src/core/clue-template.js";

const MATE = {
  type: 'chatSheets',
  version: 1,
  updateConfigUiSentinel: -1,
  globalInjectionConfig: { readableEntryPlacement: { position: 'before_char', depth: 2, order: 99981 }, wrapperPlacement: { position: 'before_char', depth: 2, order: 99980 } },
};

// 只有三张线索表的模板（测试和「已有自己表格的聊天」用）。参数同 clueSheets。
export function buildTemplate(opts = {}) {
  const out = {};
  for (const sheet of core.clueSheets(opts)) out[sheet.uid] = sheet;
  out.mate = JSON.parse(JSON.stringify(MATE));
  return out;
}
// 官方默认 8 张表 + 三张线索表。defaultTemplate：官方默认模板对象（tests/fixtures 里冻结的 spv8.9.2 版本）。
export function buildCombinedTemplate(defaultTemplate, clue = {}) {
  return core.synthesizeClueTemplate(defaultTemplate, { clue });
}

// 插件「表格绑定」：与线索表的表名、列名一一对应。
// 必须与 src/ui/clue-run.js 的 BINDING_EXAMPLE 逐字一致（测试强制）。
// 主线开关不在表格里（执行页「暂停 / 继续主线」）；旧项目绑定的 switch 仍然有效。
// 故事时间先读官方默认的「全局数据表」，没有时退回旧模板的线索控制表时间列。
export const BINDING_YAML = `facts:
  - {表: 关键事实表, 编号列: 编号, 状态列: 状态, 已核实值: 已核实, 说法值: 存疑, 内容列: 内容, 来源列: 依据}
knowledge:
  - {表: 知情表, 事实列: 事实, 角色列: 角色, 方式列: 获知方式, 可信度列: 可信度, 已核实值: 已核实, 来源列: 依据, 有效值: [亲见, 被告知, 听说, 推测]}
scene: {路径: 线索控制表/主线/当前场景, 离场值: 无}
time: {路径: [全局数据表/全局状态/当前时间, 线索控制表/主线/当前时间]}
`;

if (process.argv[1] && process.argv[1].endsWith('build-template.mjs')) {
  const fixture = JSON.parse(fs.readFileSync(path.resolve(here, '../../tests/fixtures/shujuku-default-template-spv8.9.2.json'), 'utf8'));
  fs.writeFileSync(path.join(here, '线索推进表格模板.json'), JSON.stringify(buildTemplate({ controlRow: ['主线', ''] }), null, 2) + '\n');
  const combined = buildCombinedTemplate(fixture, { controlRow: ['主线', ''] });
  fs.writeFileSync(path.join(here, '线索推进表格模板_含默认表.json'), JSON.stringify(combined.template, null, 2) + '\n');
  fs.writeFileSync(path.join(here, '插件绑定.yaml'), BINDING_YAML);
  console.log('written: 线索推进表格模板.json, 线索推进表格模板_含默认表.json, 插件绑定.yaml');
  if (combined.problems.length) console.log('problems:', combined.problems);
}
