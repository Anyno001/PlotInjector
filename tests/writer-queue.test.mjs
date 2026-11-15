// GPT 实测前审阅 R1：同一文件的保存排队。上一次上传还没结束时又改了内容，最新的内容一定最后落盘；flush 等正在写的也写完。
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createWriter } from '../src/host/files.js';
globalThis.window = globalThis;

// 可控的假上传：每次调用记一笔，由测试决定什么时候、以什么顺序完成。
function slowWrite() {
  const calls = [], landed = [];
  const write = (name, value) => new Promise((resolve, reject) => calls.push({ name, value, done: () => (landed.push(value), resolve(1)), fail: () => reject(new Error('网络错误')) }));
  return { write, calls, landed };
}
const tick = (ms = 5) => new Promise((r) => setTimeout(r, ms));

test('a second save while the first is still uploading waits; the newest value lands last', async () => {
  const w = slowWrite(), writer = createWriter({ delay: 1, write: w.write });
  writer.schedule('pi-p-a.json', 'v1');
  await tick();
  assert.equal(w.calls.length, 1, 'first upload started');
  writer.schedule('pi-p-a.json', 'v2');
  await tick();
  assert.equal(w.calls.length, 1, 'no second upload while the first is in flight');
  assert.equal(writer.hasPending(), true);
  w.calls[0].done();
  await tick();
  assert.equal(w.calls.length, 2, 'then the newest one is written');
  assert.equal(w.calls[1].value, 'v2');
  w.calls[1].done();
  await tick();
  assert.deepEqual(w.landed, ['v1', 'v2'], 'old never lands after new');
  assert.equal(writer.hasPending(), false);
});

test('flush waits for the in-flight upload and for what was scheduled meanwhile', async () => {
  const w = slowWrite(), writer = createWriter({ delay: 1000, write: w.write });
  writer.schedule('pi-c-a.json', 'v1');
  const f1 = writer.flush();
  await tick();
  writer.schedule('pi-c-a.json', 'v2');
  let flushed = false;
  const f2 = writer.flush().then(() => { flushed = true; });
  await tick();
  assert.equal(flushed, false, 'flush does not return while v1 is still uploading');
  w.calls[0].done();
  await tick();
  assert.equal(w.calls.length, 2);
  assert.equal(flushed, false, 'nor while v2 is uploading');
  w.calls[1].done();
  await f1; await f2;
  assert.equal(flushed, true);
  assert.deepEqual(w.landed, ['v1', 'v2']);
});

test('flush called while an upload is in flight (nothing pending) still waits for it', async () => {
  const w = slowWrite(), writer = createWriter({ delay: 1, write: w.write });
  writer.schedule('pi-index.json', 'v1');
  await tick();
  assert.equal(w.calls.length, 1, 'the timer already started the upload');
  let flushed = false;
  const f = writer.flush().then(() => { flushed = true; });
  await tick();
  assert.equal(flushed, false, 'GPT R1: flush used to return here with hasPending = false');
  assert.equal(writer.hasPending(), true);
  w.calls[0].done();
  await f;
  assert.equal(flushed, true);
});

test('a failed upload goes back to pending only if nothing newer arrived; retry writes the newest', async () => {
  const w = slowWrite(), errors = [], writer = createWriter({ delay: 1, write: w.write, onError: (n) => errors.push(n) });
  writer.schedule('pi-p-b.json', 'v1');
  await tick();
  writer.schedule('pi-p-b.json', 'v2');
  w.calls[0].fail();
  await tick();
  assert.deepEqual(errors, ['pi-p-b.json']);
  // v2 was scheduled with its own timer while v1 was uploading: it goes out once (newer content), the failed v1 is dropped
  assert.equal(w.calls.length, 2);
  assert.equal(w.calls[1].value, 'v2', 'the newer value is written, not the failed old one');
  w.calls[1].fail();
  await tick();
  assert.equal(w.calls.length, 2, 'no automatic loop after the second failure');
  assert.deepEqual(writer.failed(), ['pi-p-b.json']);
  const f = writer.flush();
  await tick();
  assert.equal(w.calls[2].value, 'v2', 'retry sends v2');
  w.calls[2].done();
  await f;
  assert.deepEqual(w.landed, ['v2']);
  assert.equal(writer.hasPending(), false);
});
