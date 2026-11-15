// Self-check for the official-API run (tools/test-official.mjs, PI_OFFICIAL=1): the simulated database must expose only
// the official public API — no plot-link interface, no provider registered — otherwise the run would not prove anything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHost } from './host-sim.mjs';

test('official run: no plot-link interface on the database, no provider registered after a full round', { skip: !process.env.PI_OFFICIAL && 'only in the official-API run' }, async () => {
  const host = createHost({ tables: {} });
  const api = host.w.AutoCardUpdaterAPI;
  assert.ok(api && typeof api.exportTableAsJson === 'function' && typeof api.insertRow === 'function', 'official API present');
  for (const k of ['registerPlotLinkProvider', 'unregisterPlotLinkProvider', 'plotLinkVersion']) assert.equal(api[k], undefined, `${k} must be absent`);
  const inst = host.load();
  await inst.ready;
  await host.eventSource.emit(host.eventTypes.CHAT_CHANGED);
  await host.send('x', { plot: false });
  assert.equal(host.db.providers.size, 0, 'no provider registered');
  await inst.destroy();
});
