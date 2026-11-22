import { loadCore } from './load.mjs';
// 写作基准三选一（2026-11-08）：通用（默认）/ 同人世界观速成（原作者原版，保留）/ 自定义。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const G = loadCore();
G.setYamlLib(YAML);
const tick = () => new Promise((r) => setTimeout(r, 20));

test('default is the generic guide; the fan-fiction guide keeps its structure and output format (tuned in D39)', () => {
  const s = G.normalizeSettings({});
  assert.equal(s.guidePreset, 'generic');
  assert.equal(G.resolveGuide(s).text, G.GENERIC_GUIDE);
  assert.equal(G.resolveGuide({ guidePreset: 'fanfic' }).text, G.FANFIC_GUIDE);
});

test('an existing custom guide (saved before presets existed) becomes "custom"; an empty custom falls back to generic', () => {
  assert.equal(G.normalizeSettings({ guide: '我的基准' }).guidePreset, 'custom');
  assert.equal(G.resolveGuide(G.normalizeSettings({ guide: '我的基准' })).text, '我的基准');
  assert.equal(G.resolveGuide({ guidePreset: 'custom', guide: '  ' }).text, G.GENERIC_GUIDE);
  assert.equal(G.normalizeSettings({ guidePreset: 'nonsense' }).guidePreset, 'generic');
});

test('the discussion prompt follows the chosen guide: opener and section title are no longer hard-coded to fan fiction', () => {
  const generic = G.discussSystemPrompt({ guide: G.resolveGuide({}), refs: [] });
  assert.match(generic, /^你在帮用户构思一个故事的设定和剧情/);
  assert.match(generic, /【写作基准（通用）】/);
  assert.ok(!/同人/.test(generic.split('【写作基准')[0]), 'no fan-fiction wording before the guide');
  const fan = G.discussSystemPrompt({ guide: G.resolveGuide({ guidePreset: 'fanfic' }), refs: [] });
  assert.match(fan, /^你在帮用户构思一条同人 if 线/);
  assert.match(fan, /【写作基准：同人世界观速成】/);
  // old callers that pass plain text still work
  assert.match(G.discussSystemPrompt({ guide: 'X', refs: [] }), /【写作基准】\nX/);
});

test('generic guide output format still parses into blocks the setting page can edit', () => {
  const reply = ['世界观正文:', '声明:', '题材: 原创', '', '铁则:', '- 码头夜里不点灯', '', '信息差:', '- 老韩：不知道货的真正去向', '', '少提的旧事:', '- 罢工已经过去', '', '<仅作者>', '真相：主管的侄子偷运', '</仅作者>', '', '补定:', '- 舞台补为雾港', '速查：PASS'].join('\n');
  const r = G.parseSettingReply(reply);
  assert.equal(r.check, 'PASS');
  assert.deepEqual([...r.fixes], ['舞台补为雾港']);
  assert.deepEqual(G.splitBlocks(r.body).map((b) => b.title), ['声明', '铁则', '信息差', '少提的旧事', '仅作者资料']);
  assert.match(r.body, /<仅作者>/);
});

test('settings page: switch to 同人, then to 自定义 (seeded from the guide in use), edit it; the discussion request uses the right one', async () => {
  const host = createHost({ tables: {} });
  const inst = host.load(); await inst.ready;
  inst.open(); await tick();
  const doc = host.w.document;
  inst.__view.page = 'settings'; inst.__view.render(); await tick();
  const pick = () => doc.querySelector('[data-guide-preset]');
  assert.ok(pick(), 'preset select');
  assert.equal(pick().value, 'generic');
  assert.match(doc.body.textContent, /正文模型看不到它/);
  const choose = async (v) => { pick().value = v; pick().dispatchEvent(new host.w.Event('change', { bubbles: true })); await tick(); };
  await choose('fanfic');
  assert.equal(inst.data.settings().guidePreset, 'fanfic');
  await choose('custom');
  assert.equal(inst.data.settings().guidePreset, 'custom');
  assert.equal(inst.data.settings().guide, G.FANFIC_GUIDE, 'custom seeded from the fan-fiction guide that was in use');
  const box = doc.querySelector('[data-guide]');
  assert.ok(box, 'custom guide is editable');
  box.value = '# 我的基准\n只写现状。';
  box.dispatchEvent(new host.w.Event('input', { bubbles: true }));
  box.dispatchEvent(new host.w.FocusEvent('focusout', { bubbles: true }));
  await tick();
  assert.equal(G.resolveGuide(inst.data.settings()).text, '# 我的基准\n只写现状。');
  await inst.destroy();
});
