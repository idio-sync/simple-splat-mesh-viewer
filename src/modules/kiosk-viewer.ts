/**
 * Generic Offline Viewer Generator
 *
 * Generates a self-contained HTML viewer that can open any .a3d/.a3z
 * archive. Instead of hardcoded templates, this generator fetches the
 * real application modules and CSS, then inlines everything into a
 * single offline HTML file with blob URL import rewriting.
 *
 * Architecture:
 * - CDN dependencies are fetched as ES module source text and base64-encoded
 * - Local application modules are fetched from same origin and base64-encoded
 * - The real index.html and styles.css are fetched and processed
 * - At runtime, the viewer decodes sources, creates blob URLs, rewrites
 *   all import specifiers (CDN + local) to blob URLs, then dynamically
 *   imports kiosk-main.js to start the viewer
 * - User opens an .a3d/.a3z archive via file picker or drag-and-drop
 */

import { Logger } from './utilities.js';

const log = Logger.getLogger('kiosk-viewer');

// =============================================================================
// CDN DEPENDENCIES
// =============================================================================

// Three.js core from jsDelivr (self-contained module, no sub-imports).
// Addons from esm.sh with ?external=three (bundled, only bare from "three").
// Spark.js from sparkjs.dev (bare from "three" import).
// fflate from jsDelivr (self-contained ESM browser build).
//
// Keys are the import specifiers as they appear in module import statements.
const CDN_DEPS: Record<string, string> = {
    'three':
        'https://cdn.jsdelivr.net/npm/three@0.170.0/build/three.module.js',
    'three/addons/controls/OrbitControls.js':
        'https://esm.sh/three@0.170.0/examples/jsm/controls/OrbitControls.js?external=three',
    'three/addons/controls/TransformControls.js':
        'https://esm.sh/three@0.170.0/examples/jsm/controls/TransformControls.js?external=three',
    'three/addons/loaders/GLTFLoader.js':
        'https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js?external=three',
    'three/addons/loaders/OBJLoader.js':
        'https://esm.sh/three@0.170.0/examples/jsm/loaders/OBJLoader.js?external=three',
    'three/addons/loaders/MTLLoader.js':
        'https://esm.sh/three@0.170.0/examples/jsm/loaders/MTLLoader.js?external=three',
    'three/addons/loaders/STLLoader.js':
        'https://esm.sh/three@0.170.0/examples/jsm/loaders/STLLoader.js?external=three',
    '@sparkjsdev/spark':
        'https://sparkjs.dev/releases/spark/0.1.10/spark.module.js',
    'fflate':
        'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js',
};

// =============================================================================
// LOCAL MODULES (in topological dependency order)
// =============================================================================

interface LocalModule {
    specifier: string;
    path: string;
}

// Each module's imports are rewritten BEFORE creating its blob URL, so
// dependencies must appear earlier in this list.
const LOCAL_MODULES: LocalModule[] = [
    { specifier: './constants.js',         path: 'constants.js' },
    { specifier: './logger.js',            path: 'logger.js' },
    { specifier: './utilities.js',         path: 'utilities.js' },
    { specifier: './archive-loader.js',    path: 'archive-loader.js' },
    { specifier: './ui-controller.js',     path: 'ui-controller.js' },
    { specifier: './scene-manager.js',     path: 'scene-manager.js' },
    { specifier: './fly-controls.js',      path: 'fly-controls.js' },
    { specifier: './annotation-system.js', path: 'annotation-system.js' },
    { specifier: './file-handlers.js',     path: 'file-handlers.js' },
    { specifier: './metadata-manager.js',  path: 'metadata-manager.js' },
    { specifier: './theme-loader.js',      path: 'theme-loader.js' },
    { specifier: './quality-tier.js',      path: 'quality-tier.js' },
    { specifier: './kiosk-main.js',        path: 'kiosk-main.js' },
];

// =============================================================================
// TYPES
// =============================================================================

interface ModuleData {
    specifier: string;
    b64: string;
}

interface BundleData {
    cdn: Record<string, string>;
    modules: ModuleData[];
}

interface ThemeAssets {
    [key: string]: string;
}

export interface FetchDependenciesResult {
    indexHTML: string;
    stylesCSS: string;
    preModuleJS: string;
    themeCSS: string | null;
    layoutCSS: string | null;
    layoutJS: string | null;
    themeAssets: ThemeAssets;
    themeName: string;
    bundleData: BundleData;
}

export type ProgressCallback = (message: string) => void;

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Fetch a URL as text with one retry.
 */
async function fetchText(url: string): Promise<string> {
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`HTTP ${resp.status} for ${url}`);
            return await resp.text();
        } catch (err) {
            if (attempt === 1) throw err;
            await new Promise(r => setTimeout(r, 1000));
        }
    }
    // TypeScript needs this even though the loop always returns or throws
    throw new Error('Unreachable');
}

/**
 * Fetch a URL as text, following esm.sh re-export wrappers.
 * esm.sh returns tiny wrappers like: export * from "/three@0.170.0/X-.../Module.mjs"
 * The actual bundled module is at that internal path on the same origin.
 */
async function fetchResolved(url: string): Promise<string> {
    const src = await fetchText(url);
    if (src.length < 500) {
        const match = src.match(/export\s*\*\s*from\s*["'](\/[^"']+)["']/);
        if (match) {
            const origin = new URL(url).origin;
            log.info(`Following esm.sh redirect: ${match[1]}`);
            return await fetchText(origin + match[1]);
        }
    }
    return src;
}

/**
 * Base64-encode a UTF-8 string.
 */
function toBase64(str: string): string {
    return btoa(unescape(encodeURIComponent(str)));
}

/**
 * Convert a Blob to a data: URL.
 */
function blobToDataUrl(blob: Blob): Promise<string> {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
}

// =============================================================================
// FETCH DEPENDENCIES
// =============================================================================

/**
 * Fetch all dependencies (CDN + local modules + HTML/CSS/JS).
 */
export async function fetchDependencies(onProgress?: ProgressCallback): Promise<FetchDependenciesResult> {
    const cdnEntries = Object.entries(CDN_DEPS);
    const totalSteps = cdnEntries.length + LOCAL_MODULES.length + 3;
    let step = 0;

    function progress(msg: string): void {
        step++;
        if (onProgress) onProgress(`${msg} (${step}/${totalSteps})`);
    }

    // 1. Fetch CDN dependencies
    const cdn: Record<string, string> = {};
    for (const [specifier, url] of cdnEntries) {
        const shortName = specifier.split('/').pop()?.replace(/\.js.*$/, '') || specifier;
        progress(`Fetching ${shortName}...`);
        log.info(`Fetching CDN: ${specifier}`);
        const src = await fetchResolved(url);
        cdn[specifier] = toBase64(src);
        log.info(`Fetched ${specifier}: ${(src.length / 1024).toFixed(1)} KB`);
    }

    // 2. Fetch local modules from same origin
    // Use document location (not import.meta.url) so paths resolve correctly
    // whether served raw (dev) or from a Vite bundle chunk (production).
    const appBase = window.location.href.replace(/[^/]*$/, '');
    const modules: ModuleData[] = [];
    for (const mod of LOCAL_MODULES) {
        progress(`Fetching ${mod.path}...`);
        const url = appBase + 'modules/' + mod.path;
        log.info(`Fetching module: ${mod.path}`);
        const src = await fetchText(url);
        modules.push({ specifier: mod.specifier, b64: toBase64(src) });
        log.info(`Fetched ${mod.path}: ${(src.length / 1024).toFixed(1)} KB`);
    }

    // 3. Fetch HTML, CSS, and pre-module.js from same origin
    const baseUrl = appBase;

    progress('Fetching CSS...');
    const [mainCSS, kioskCSS] = await Promise.all([
        fetchText(new URL('styles.css', baseUrl).href),
        fetchText(new URL('kiosk.css', baseUrl).href)
    ]);
    const stylesCSS = mainCSS + '\n' + kioskCSS;

    progress('Fetching index.html...');
    const indexHTML = await fetchText(new URL('index.html', baseUrl).href);

    progress('Fetching pre-module.js...');
    const preModuleJS = await fetchText(new URL('pre-module.js', baseUrl).href);

    // 4. Fetch theme files if a theme is active
    const config = (window as any).APP_CONFIG || {};
    const themeName: string = config.theme || '';
    let themeCSS: string | null = null;
    let layoutCSS: string | null = null;
    let layoutJS: string | null = null;
    const themeAssets: ThemeAssets = {};
    if (themeName) {
        try {
            progress(`Fetching theme: ${themeName}...`);
            themeCSS = await fetchText(new URL(`themes/${themeName}/theme.css`, baseUrl).href);
            log.info(`Fetched theme CSS: ${themeName} (${(themeCSS.length / 1024).toFixed(1)} KB)`);
        } catch (err: any) {
            log.warn(`Theme "${themeName}" not found, skipping: ${err.message}`);
        }

        // Try to fetch layout.css and layout.js (optional — only custom layouts have these)
        if (themeCSS) {
            try {
                layoutCSS = await fetchText(new URL(`themes/${themeName}/layout.css`, baseUrl).href);
                log.info(`Fetched layout CSS: ${themeName} (${(layoutCSS.length / 1024).toFixed(1)} KB)`);
            } catch { /* no layout.css — fine */ }

            try {
                layoutJS = await fetchText(new URL(`themes/${themeName}/layout.js`, baseUrl).href);
                log.info(`Fetched layout JS: ${themeName} (${(layoutJS.length / 1024).toFixed(1)} KB)`);
            } catch { /* no layout.js — fine */ }

            // Try to fetch theme image assets (logo, etc.) as data URLs for offline use
            try {
                const logoResp = await fetch(new URL(`themes/${themeName}/logo.png`, baseUrl).href);
                if (logoResp.ok) {
                    const blob = await logoResp.blob();
                    themeAssets['logo.png'] = await blobToDataUrl(blob);
                    log.info(`Fetched theme logo: ${themeName}`);
                }
            } catch { /* no logo — fine */ }
        }
    }

    log.info('All dependencies fetched successfully');

    return {
        indexHTML,
        stylesCSS,
        preModuleJS,
        themeCSS,
        layoutCSS,
        layoutJS,
        themeAssets,
        themeName,
        bundleData: { cdn, modules }
    };
}

// =============================================================================
// KIOSK CONFIG (replaces config.js in the generated HTML)
// =============================================================================

function makeKioskConfig(themeName: string): string {
    const escaped = (themeName || '').replace(/'/g, "\\'");
    return `(function() {
    var params = new URLSearchParams(window.location.search);
    window.APP_CONFIG = {
        kiosk: true,
        defaultArchiveUrl: '',
        defaultSplatUrl: '',
        defaultModelUrl: '',
        defaultPointcloudUrl: '',
        defaultAlignmentUrl: '',
        inlineAlignment: null,
        showControls: true,
        controlsMode: 'none',
        initialViewMode: params.get('initialViewMode') || undefined,
        showToolbar: true,
        sidebarMode: 'closed',
        theme: params.get('theme') || '${escaped}',
        layout: params.get('layout') || ''
    };
})();`;
}

// =============================================================================
// KIOSK BOOTSTRAP SCRIPT
// =============================================================================

// This script runs in the generated offline HTML. It decodes the embedded
// base64 dependency sources, creates blob URLs with all import specifiers
// rewritten to blob URLs, then imports kiosk-main.js to start the viewer.
//
// Uses split/join for import rewriting to avoid regex escaping complexity.
// CDN deps are processed first (three must be first so addons can reference it).
// Local modules are processed in dependency order so each module's blob URL
// exists before dependents reference it.
const KIOSK_BOOTSTRAP = `(async function() {
    console.log('[Kiosk] Bootstrap starting');

    try {
        var DEPS = window.__KIOSK_DEPS__;
        if (!DEPS || !DEPS.cdn || !DEPS.modules) {
            throw new Error('Embedded dependency data is missing');
        }

        function decode(b64) {
            return decodeURIComponent(escape(atob(b64)));
        }

        function makeBlob(src) {
            return URL.createObjectURL(new Blob([src], { type: 'application/javascript' }));
        }

        // Rewrite import specifiers to blob URLs using split/join.
        // Handles both quote styles, optional whitespace, and dynamic imports.
        function rewriteImports(src, blobMap) {
            for (var spec in blobMap) {
                if (!blobMap.hasOwnProperty(spec)) continue;
                var url = blobMap[spec];
                // Static imports: from 'spec' / from "spec"
                src = src.split("from '" + spec + "'").join('from "' + url + '"');
                src = src.split('from "' + spec + '"').join('from "' + url + '"');
                // No-space variants (minified): from'spec' / from"spec"
                src = src.split("from'" + spec + "'").join('from "' + url + '"');
                src = src.split('from"' + spec + '"').join('from "' + url + '"');
                // Dynamic imports: import('spec') / import("spec")
                src = src.split("import('" + spec + "')").join('import("' + url + '")');
                src = src.split('import("' + spec + '")').join('import("' + url + '")');
            }
            return src;
        }

        // Phase 1: Create blob URLs for CDN dependencies
        console.log('[Kiosk] Loading CDN dependencies...');
        var blobMap = {};
        var cdnKeys = Object.keys(DEPS.cdn);
        for (var i = 0; i < cdnKeys.length; i++) {
            var spec = cdnKeys[i];
            var src = decode(DEPS.cdn[spec]);
            // Rewrite imports in CDN deps (addons need three blob URL)
            if (spec !== 'three') {
                src = rewriteImports(src, blobMap);
            }
            blobMap[spec] = makeBlob(src);
            console.log('[Kiosk] CDN: ' + spec);
        }

        // Phase 2: Create blob URLs for local modules (in dependency order)
        console.log('[Kiosk] Loading application modules...');
        for (var m = 0; m < DEPS.modules.length; m++) {
            var mod = DEPS.modules[m];
            var modSrc = decode(mod.b64);
            // Rewrite all known specifiers (CDN + previously processed modules)
            modSrc = rewriteImports(modSrc, blobMap);
            blobMap[mod.specifier] = makeBlob(modSrc);
            console.log('[Kiosk] Module: ' + mod.specifier);
        }

        // Phase 2.5: Load layout module if present (self-registers on window.__KIOSK_LAYOUTS__)
        if (DEPS.layoutModule) {
            console.log('[Kiosk] Loading layout module...');
            var layoutSrc = decode(DEPS.layoutModule);
            var layoutBlob = makeBlob(layoutSrc);
            await import(layoutBlob);
            console.log('[Kiosk] Layout module registered');
        }

        // Phase 3: Import kiosk-main.js and start the viewer
        console.log('[Kiosk] Starting viewer...');
        var kioskModule = await import(blobMap['./kiosk-main.js']);
        await kioskModule.init();
        window.moduleLoaded = true;
        console.log('[Kiosk] Viewer initialized');

    } catch (err) {
        console.error('[Kiosk] Fatal error:', err);
        var overlay = document.getElementById('loading-overlay');
        var text = document.getElementById('loading-text');
        if (overlay) overlay.classList.remove('hidden');
        if (text) text.textContent = 'Error: ' + err.message;
    }
})();`;

// =============================================================================
// GENERATE VIEWER HTML
// =============================================================================

/**
 * Generate a generic offline viewer HTML string.
 *
 * Takes the real index.html, strips editor-only sections (KIOSK-STRIP markers),
 * inlines CSS and dependencies, and adds a bootstrap script that loads the
 * application modules via blob URLs with import rewriting.
 */
export function generateGenericViewer(deps: FetchDependenciesResult): string {
    let html = deps.indexHTML;

    // 1. Strip editor-only sections marked with KIOSK-STRIP comments
    html = html.replace(
        /<!--\s*KIOSK-STRIP-START\s*-->[\s\S]*?<!--\s*KIOSK-STRIP-END\s*-->/g,
        ''
    );

    // 2. Update page title
    html = html.replace(/<title>.*?<\/title>/, '<title>Vitrine3D</title>');

    // 3. Relax CSP for offline viewer (inline scripts + blob URLs)
    html = html.replace(
        /<meta\s+http-equiv="Content-Security-Policy"\s+content="[\s\S]*?">/,
        '<meta http-equiv="Content-Security-Policy" content="' +
        "default-src 'self' blob:; " +
        "script-src 'unsafe-inline' 'unsafe-eval' blob:; " +
        "style-src 'unsafe-inline'; " +
        "img-src 'self' blob: data: https://*.tile.openstreetmap.org; " +
        "connect-src 'self' blob: data:; " +
        "worker-src 'self' blob:; " +
        "font-src 'self'; " +
        "media-src 'self' blob:; " +
        "object-src 'none';" +
        '">'
    );

    // 4. Inline CSS (replace stylesheet link) + theme/layout CSS if present
    const themeBlock = deps.themeCSS
        ? '\n<style id="kiosk-theme">\n' + deps.themeCSS + '\n</style>'
        : '';
    const layoutBlock = deps.layoutCSS
        ? '\n<style id="kiosk-layout">\n' + deps.layoutCSS + '\n</style>'
        : '';
    html = html.replace(
        /<link\s+rel="stylesheet"\s+href="styles\.css"\s*\/?>[\s\S]*?<link\s+rel="stylesheet"\s+href="kiosk\.css"\s*\/?>/,
        '<style>\n' + deps.stylesCSS + '\n</style>' + themeBlock + layoutBlock
    );

    // 5. Inline kiosk config (replace config.js) + theme assets for offline use
    const themeAssetsScript = (deps.themeAssets && Object.keys(deps.themeAssets).length > 0)
        ? '\nwindow.__KIOSK_THEME_ASSETS__ = ' + JSON.stringify(deps.themeAssets) + ';\n'
        : '';
    html = html.replace(
        /<script\s+src="config\.js"\s*><\/script>/,
        '<script>\n' + makeKioskConfig(deps.themeName) + themeAssetsScript + '\n</script>'
    );

    // 6. Remove import map (blob URLs replace it)
    html = html.replace(/<script\s+type="importmap">[\s\S]*?<\/script>/, '');

    // 7. Inline pre-module.js
    html = html.replace(
        /<script\s+src="pre-module\.js"\s*><\/script>/,
        '<script>\n' + deps.preModuleJS + '\n</script>'
    );

    // 8. Replace main.js module with deps data + bootstrap script
    const bundlePayload: any = { ...deps.bundleData };
    if (deps.layoutJS) {
        bundlePayload.layoutModule = toBase64(deps.layoutJS);
    }
    const bundleJSON = JSON.stringify(bundlePayload);
    html = html.replace(
        /<script\s+type="module"\s+src="main\.js"\s*><\/script>/,
        '<script>\nwindow.__KIOSK_DEPS__ = ' + bundleJSON + ';\n</script>\n' +
        '<script type="module">\n' + KIOSK_BOOTSTRAP + '\n</script>'
    );

    log.info('Generated kiosk HTML: ' + (html.length / 1024).toFixed(0) + ' KB');
    return html;
}
