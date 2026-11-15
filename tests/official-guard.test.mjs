// Self-check: the simulated database exposes only the official public API (no plot-link interface), before and after a full
// round and a reload — otherwise the whole suite would not prove the plugin works on what real users run.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';

test('official host: no plot-link interface on the database, before and after a full round and a reload', async () => {
  const host = createHost({ tables: {} });
  const api = host.w.AutoCardUpdaterAPI;
  assert.ok(api && typeof api.exportTableAsJson === 'function' && typeof api.insertRow === 'function', 'official API present');
  for (const k of ['registerPlotLinkProvider', 'unregisterPlotLinkProvider', 'plotLinkVersion']) assert.equal(api[k], undefined, `${k} must be absent`);
  const inst = host.load();
  await inst.ready;
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.send('x');
  const again = host.load();
  await again.ready;
  await host.send('y');
  for (const k of ['registerPlotLinkProvider', 'unregisterPlotLinkProvider', 'plotLinkVersion']) assert.equal(api[k], undefined, `${k} still absent`);
  await again.destroy();
});
