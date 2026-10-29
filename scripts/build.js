import fs from 'node:fs';
import path from 'node:path';
import * as esbuild from 'esbuild';

const root = path.resolve(import.meta.dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const version = pkg.version;
const SCRIPT_ID = 'c40c65aa-7e08-432f-9aec-f4e380791800';

const result = await esbuild.build({
    entryPoints: [path.join(root, 'src/index.js')],
    bundle: true,
    format: 'iife',
    target: 'es2022',
    charset: 'utf8',
    legalComments: 'none',
    minifySyntax: true,
    write: false,
    define: { __PI_VERSION__: JSON.stringify(version) },
    banner: { js: `// PlotInjector v${version}` },
});
const bundle = result.outputFiles[0].text.replace(/\r\n/g, '\n');
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist/plot-injector.js'), bundle);

function scriptJson(name, content, info) {
    return `${JSON.stringify({
        type: 'script',
        enabled: true,
        name,
        id: SCRIPT_ID,
        info,
        button: { enabled: true, buttons: [{ name: '剧情注入', visible: true }] },
        data: {},
        content,
    }, null, 2)}\n`;
}

const loaderSource = fs.readFileSync(path.join(root, 'loader/plot-injector.js'), 'utf8').replace(/\r\n/g, '\n');
if (!loaderSource.includes("const MIN_TAG = 'v0.0.0';")) throw new Error('加载器缺少 MIN_TAG 占位');
const loader = loaderSource.replace("const MIN_TAG = 'v0.0.0';", `const MIN_TAG = 'v${version}';`);
fs.writeFileSync(path.join(root, 'loader/plot-injector.json'), scriptJson('剧情注入器（自动更新）', loader, '从 GitHub 加载最新版剧情注入器。'));
fs.writeFileSync(path.join(root, 'dist/plot-injector-standalone.json'), scriptJson(`剧情注入器 v${version}（单文件）`, bundle, '内嵌完整程序，不联网更新，用于离线或测试。'));

console.log(`built v${version}: dist/plot-injector.js ${(bundle.length / 1024).toFixed(1)} KB`);
