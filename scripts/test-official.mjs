// Runs the sample-story / UI suites against a host that only has the OFFICIAL shujuku public API
// (no plot-link interface), which is what real users run. Link-only tests skip themselves.
import { spawnSync } from 'node:child_process';
// tests/official-guard.test.mjs runs first: it fails the whole run if the host still exposes the plot-link interface.
const files = ['tests/official-guard.test.mjs', 'tests/template-story.test.mjs', 'tests/review4-regressions.test.mjs', 'tests/clue-authoring-ui.test.mjs', 'tests/upgrade.test.mjs', 'tests/e2e-loop.test.mjs', 'tests/audit.test.mjs'];
const r = spawnSync(process.execPath, ['--test', '--test-concurrency=3', ...files], { stdio: 'inherit', env: { ...process.env, PI_OFFICIAL: '1' } });
process.exit(r.status ?? 1);
