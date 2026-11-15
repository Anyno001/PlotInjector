// GPT §20.1: the built-in body guide (角色知情 + 剧情推进) rides along with this round's plot material exactly once,
// in both modes; no material → no guide; it can be turned off in settings.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import YAML from 'yaml';
import { createHost } from './host-sim.mjs';
import { buildTemplate, BINDING_YAML } from '../templates/clue-tables/build-template.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const storyText = fs.readFileSync(path.join(here, '../templates/clue-tables/示例_小镇失窃案.yaml'), 'utf8');
const count = (s, w) => s.split(w).length - 1;
const live = (t) => { const o = JSON.parse(JSON.stringify(t)); for (const [k, s] of Object.entries(o)) if (k.startsWith('sheet_')) s.content = s.content.map((r, i) => (i ? [i, ...r.slice(1)] : r)); return o; };

async function boot(mode, { outline = true, settings = {} } = {}) {
  const tables = live(buildTemplate({ controlRow: ['主线', ''], factRows: ['F_box', 'F_ledger', 'F_seen', 'F_print', 'F_talk'].map((code) => ({ code, label: code })), knowRows: [] }));
  const host = createHost({ tables });
  const inst = host.load(); await inst.ready;
  const p = await inst.data.createProject('t');
  const volumes = outline ? Object.entries(YAML.parse(storyText)).map(([key, stages], vi) => ({ id: `v${vi}`, key, stages: Object.entries(stages).map(([sk, data], si) => ({ id: `s${vi}_${si}`, key: sk, data })) })) : [];
  inst.data.updateProject(p.id, (x) => ({ ...x, setting: { ...x.setting, text: '' }, outline: { volumes }, clue: { mode, bindings: YAML.parse(BINDING_YAML) } }));
  Object.keys(settings).length && inst.data.updateSettings(settings);
  await inst.runtime.switchProject(p.id);
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED); await host.settle();
  return { host, inst };
}
const text = (inst) => inst.runtime.entries().map((e) => e.content).join('\n');

for (const mode of ['clue', 'outline']) {
  test(`${mode} mode: guide appears exactly once, inside the plot material`, async () => {
    const { inst } = await boot(mode);
    const t = text(inst);
    assert.equal(count(t, '<knowledge>'), 1);
    assert.equal(count(t, '<progression>'), 1);
    assert.ok(/<剧情参考[^>]*>\n<knowledge>/.test(t), 'inside the outer plot tag');
    await inst.destroy();
  });
  test(`${mode} mode: no plot material → no guide`, async () => {
    const { inst } = await boot(mode, { outline: false });
    assert.ok(!text(inst).includes('<knowledge>'));
    await inst.destroy();
  });
  test(`${mode} mode: turned off in settings → not injected`, async () => {
    const { inst } = await boot(mode, { settings: { bodyGuide: false } });
    const t = text(inst);
    assert.ok(t.includes('<剧情参考'), 'material still there');
    assert.ok(!t.includes('<knowledge>'));
    await inst.destroy();
  });
}
test('clue mode: paused → no material and no guide', async () => {
  const { inst } = await boot('clue');
  inst.runtime.clue.setPaused(true);
  assert.ok(!text(inst).includes('<knowledge>'));
  await inst.destroy();
});
test('custom body guide text replaces the default; empty restores it', async () => {
  const { inst } = await boot('outline', { settings: { bodyGuideText: '<rules>只按亲历行动。</rules>' } });
  let t = text(inst);
  assert.ok(t.includes('<rules>只按亲历行动。</rules>'));
  assert.ok(!t.includes('<knowledge>'));
  inst.data.updateSettings({ bodyGuideText: '' }); inst.runtime.refresh();
  t = text(inst);
  assert.equal(count(t, '<knowledge>'), 1);
  await inst.destroy();
});
