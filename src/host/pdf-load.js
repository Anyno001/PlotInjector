// 选 PDF 时才加载 pdf.js（Mozilla，Apache-2.0），不打进主包。读文字层，版式还原交给 core/doc-pdf.js。
import { pdfPagesToText } from '../core/doc-pdf.js';

export const PDFJS_VERSION = '4.10.38';
const BASES = [
    `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/legacy/build/`,
    `https://unpkg.com/pdfjs-dist@${PDFJS_VERSION}/legacy/build/`,
];

let loading = null;

// 动态 import 的地址用变量传，esbuild 不会去打包它。
const importUrl = (url) => import(/* @vite-ignore */ url);

export function loadPdfJs() {
    if (loading) return loading;
    loading = (async () => {
        let errors = [];
        for (let base of BASES) {
            try {
                let lib = await importUrl(`${base}pdf.min.mjs`);
                lib.GlobalWorkerOptions.workerSrc = `${base}pdf.worker.min.mjs`;
                return { lib, base: base.replace(/legacy\/build\/$/, '') };
            } catch (error) {
                errors.push(error && error.message ? error.message : String(error));
            }
        }
        throw new Error(`PDF 组件下载失败（${errors[errors.length - 1] || '网络不通'}）`);
    })();
    loading.catch(() => (loading = null));
    return loading;
}

export function isPdfFile(file) {
    return !!file && (/\.pdf$/i.test(file.name || '') || file.type === 'application/pdf');
}

// file → { text, warnings, pages, chars }。onProgress(已读页, 总页数)。
export async function pdfFileToText(file, { onProgress = () => {}, load = loadPdfJs } = {}) {
    let { lib, base } = await load(),
        data = new Uint8Array(await file.arrayBuffer()),
        doc = await lib.getDocument({ data, cMapUrl: `${base}cmaps/`, cMapPacked: !0, standardFontDataUrl: `${base}standard_fonts/`, verbosity: 0 }).promise,
        pages = [];
    try {
        for (let n = 1; n <= doc.numPages; n++) {
            onProgress(n, doc.numPages);
            let page = await doc.getPage(n),
                vp = page.getViewport({ scale: 1 }),
                content = await page.getTextContent();
            pages.push({
                width: vp.width,
                height: vp.height,
                items: (content.items || [])
                    .filter((it) => typeof it.str == 'string')
                    .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width, h: it.height, font: it.fontName, eol: !!it.hasEOL })),
            });
            page.cleanup && page.cleanup();
        }
    } finally {
        doc.destroy && doc.destroy();
    }
    return pdfPagesToText(pages);
}
