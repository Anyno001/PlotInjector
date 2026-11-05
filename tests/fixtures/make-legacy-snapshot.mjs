// 只在 v0.1.22 代码上跑一次：node tests/fixtures/make-legacy-snapshot.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { legacyOutputs } from './legacy-scenarios.js';

const out = {};
for (const [key, value] of Object.entries(legacyOutputs())) {
    out[key] = key.startsWith('mini/') ? value : crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
fs.writeFileSync(path.join(import.meta.dirname, 'legacy-snapshot.json'), `${JSON.stringify(out, null, 1)}\n`);
console.log(Object.keys(out).length);
