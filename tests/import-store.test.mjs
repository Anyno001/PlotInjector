// GPT §19.1: import job storage — source and state in their own files; ordered writes; the confirmed latest state wins.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), src = path.resolve(here, '../src');
import * as importStore from "../src/app/import-store.js";
const make = () => importStore;

// a slow, out-of-order file system: each write takes a random time; the LAST write to land is what's on disk
function slowFs() {
  const disk = new Map(), log = [];
  return {
    disk, log,
    read: async (name) => (disk.has(name) ? { value: JSON.parse(disk.get(name)) } : null),
    write: async (name, value) => { const body = JSON.stringify(value); await new Promise((r) => setTimeout(r, Math.random() * 30)); disk.set(name, body); log.push(name); return body.length; },
    remove: async (name) => { disk.delete(name); return true; },
  };
}

test('source and job state are separate files; the project file is not involved', async () => {
  const f = slowFs(), S = make(f.read, f.write, f.remove), store = S.createImportStore({ read: f.read, write: f.write, remove: f.remove });
  const job = await store.create({ projectId: 'p1', text: '很长的原文'.repeat(1000), mode: 'clue', needs: 'x' });
  assert.ok(f.disk.has(S.importSrcFile(job.id)));
  assert.ok(f.disk.has(S.importJobFile(job.id)));
  assert.ok(!f.disk.get(S.importJobFile(job.id)).includes('很长的原文'), 'job file does not carry the source text');
  assert.equal(await store.source(job.id), '很长的原文'.repeat(1000));
});

test('rapid updates land in order: after flush the file holds the newest state, never an older one', async () => {
  const f = slowFs(), S = make(f.read, f.write, f.remove), store = S.createImportStore({ read: f.read, write: f.write, remove: f.remove });
  const job = await store.create({ projectId: 'p1', text: 't', mode: 'clue' });
  for (let i = 1; i <= 20; i++) store.update(job.id, (j) => ({ ...j, step: `s${i}` }));
  await store.flush();
  const onDisk = JSON.parse(f.disk.get(S.importJobFile(job.id)));
  assert.equal(onDisk.step, 's20');
  assert.equal(onDisk.rev, 20);
  assert.equal(store.savedRev(job.id), 20);
  // a fresh store (reopen) loads the confirmed version
  const again = S.createImportStore({ read: f.read, write: f.write, remove: f.remove });
  assert.equal((await again.load(job.id)).step, 's20');
});

test('drop removes both files', async () => {
  const f = slowFs(), S = make(f.read, f.write, f.remove), store = S.createImportStore({ read: f.read, write: f.write, remove: f.remove });
  const job = await store.create({ projectId: 'p1', text: 't', mode: 'outline' });
  store.update(job.id, (j) => ({ ...j, step: 'index' }));
  await store.drop(job.id);
  assert.ok(!f.disk.has(S.importJobFile(job.id)) && !f.disk.has(S.importSrcFile(job.id)));
});

test('adoptKey is stable for the same job / part / stage', () => {
  const S = make(null, null, null);
  assert.equal(S.adoptKey('impA', 2, '阶段3_x'), S.adoptKey('impA', 2, '阶段3_x'));
  assert.notEqual(S.adoptKey('impA', 2, '阶段3_x'), S.adoptKey('impA', 3, '阶段3_x'));
});
