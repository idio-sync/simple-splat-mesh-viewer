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
const CDN_DEPS = {
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
    '@sparkjsdev/spark':
        'https://sparkjs.dev/releases/spark/0.1.10/spark.module.js',
    'fflate':
        'https://cdn.jsdelivr.net/npm/fflate@0.8.2/esm/browser.js',
};

// =============================================================================
// LOCAL MODULES (in topological dependency order)
// =============================================================================

// Each module's imports are rewritten BEFORE creating its blob URL, so
// dependencies must appear earlier in this list.
const LOCAL_MODULES = [
    { specifier: './constants.js',         path: 'constants.js' },
    { specifier: './utilities.js',         path: 'utilities.js' },
    { specifier: './archive-loader.js',    path: 'archive-loader.js' },
    { specifier: './ui-controller.js',     path: 'ui-controller.js' },
    { specifier: './scene-manager.js',     path: 'scene-manager.js' },
    { specifier: './fly-controls.js',      path: 'fly-controls.js' },
    { specifier: './annotation-system.js', path: 'annotation-system.js' },
    { specifier: './file-handlers.js',     path: 'file-handlers.js' },
    { specifier: './metadata-manager.js',  path: 'metadata-manager.js' },
    { specifier: './kiosk-main.js',        path: 'kiosk-main.js' },
];

// =============================================================================
// HELPERS
// =============================================================================

/**
 * Fetch a URL as text with one retry.
 */
async function fetchText(url) {
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
}

/**
 * Fetch a URL as text, following esm.sh re-export wrappers.
 * esm.sh returns tiny wrappers like: export * from "/three@0.170.0/X-.../Module.mjs"
 * The actual bundled module is at that internal path on the same origin.
 */
async function fetchResolved(url) {
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
function toBase64(str) {
    return btoa(unescape(encodeURIComponent(str)));
}

// =============================================================================
// FETCH DEPENDENCIES
// =============================================================================

/**
 * Fetch all dependencies (CDN + local modules + HTML/CSS/JS).
 * @param {Function} onProgress - Progress callback (message string)
 * @returns {Object} Bundle data for generateGenericViewer
 */
export async function fetchDependencies(onProgress) {
    const cdnEntries = Object.entries(CDN_DEPS);
    const totalSteps = cdnEntries.length + LOCAL_MODULES.length + 3;
    let step = 0;

    function progress(msg) {
        step++;
        if (onProgress) onProgress(`${msg} (${step}/${totalSteps})`);
    }

    // 1. Fetch CDN dependencies
    const cdn = {};
    for (const [specifier, url] of cdnEntries) {
        const shortName = specifier.split('/').pop().replace(/\.js.*$/, '') || specifier;
        progress(`Fetching ${shortName}...`);
        log.info(`Fetching CDN: ${specifier}`);
        const src = await fetchResolved(url);
        cdn[specifier] = toBase64(src);
        log.info(`Fetched ${specifier}: ${(src.length / 1024).toFixed(1)} KB`);
    }

    // 2. Fetch local modules from same origin
    const modules = [];
    for (const mod of LOCAL_MODULES) {
        progress(`Fetching ${mod.path}...`);
        const url = new URL(`./${mod.path}`, import.meta.url).href;
        log.info(`Fetching module: ${mod.path}`);
        const src = await fetchText(url);
        modules.push({ specifier: mod.specifier, b64: toBase64(src) });
        log.info(`Fetched ${mod.path}: ${(src.length / 1024).toFixed(1)} KB`);
    }

    // 3. Fetch HTML, CSS, and pre-module.js from same origin
    const baseUrl = new URL('..', import.meta.url).href;

    progress('Fetching styles.css...');
    const stylesCSS = await fetchText(new URL('styles.css', baseUrl).href);

    progress('Fetching index.html...');
    const indexHTML = await fetchText(new URL('index.html', baseUrl).href);

    progress('Fetching pre-module.js...');
    const preModuleJS = await fetchText(new URL('pre-module.js', baseUrl).href);

    log.info('All dependencies fetched successfully');

    return {
        indexHTML,
        stylesCSS,
        preModuleJS,
        bundleData: { cdn, modules }
    };
}

// =============================================================================
// KIOSK CONFIG (replaces config.js in the generated HTML)
// =============================================================================

const KIOSK_CONFIG = `(function() {
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
        initialViewMode: 'both',
        showToolbar: true,
        sidebarMode: 'closed'
    };
})();`;

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
 *
 * @param {Object} deps - Bundle data from fetchDependencies
 * @returns {string} Complete HTML string for the offline viewer
 */
export function generateGenericViewer(deps) {
    let html = deps.indexHTML;

    // 1. Strip editor-only sections marked with KIOSK-STRIP comments
    html = html.replace(
        /<!--\s*KIOSK-STRIP-START\s*-->[\s\S]*?<!--\s*KIOSK-STRIP-END\s*-->/g,
        ''
    );

    // 2. Update page title
    html = html.replace(/<title>.*?<\/title>/, '<title>3D Archive Viewer</title>');

    // 3. Relax CSP for offline viewer (inline scripts + blob URLs)
    html = html.replace(
        /<meta\s+http-equiv="Content-Security-Policy"\s+content="[\s\S]*?">/,
        '<meta http-equiv="Content-Security-Policy" content="' +
        "default-src 'self' blob:; " +
        "script-src 'unsafe-inline' 'unsafe-eval' blob:; " +
        "style-src 'unsafe-inline'; " +
        "img-src 'self' blob: data:; " +
        "connect-src 'self' blob: data:; " +
        "worker-src 'self' blob:; " +
        "font-src 'self'; " +
        "media-src 'self' blob:; " +
        "object-src 'none';" +
        '">'
    );

    // 4. Inline CSS (replace stylesheet link)
    html = html.replace(
        /<link\s+rel="stylesheet"\s+href="styles\.css"\s*\/?>/,
        '<style>\n' + deps.stylesCSS + '\n</style>'
    );

    // 5. Inline kiosk config (replace config.js)
    html = html.replace(
        /<script\s+src="config\.js"\s*><\/script>/,
        '<script>\n' + KIOSK_CONFIG + '\n<\/script>'
    );

    // 6. Remove import map (blob URLs replace it)
    html = html.replace(/<script\s+type="importmap">[\s\S]*?<\/script>/, '');

    // 7. Inline pre-module.js
    html = html.replace(
        /<script\s+src="pre-module\.js"\s*><\/script>/,
        '<script>\n' + deps.preModuleJS + '\n<\/script>'
    );

    // 8. Replace main.js module with deps data + bootstrap script
    const bundleJSON = JSON.stringify(deps.bundleData);
    html = html.replace(
        /<script\s+type="module"\s+src="main\.js"\s*><\/script>/,
        '<script>\nwindow.__KIOSK_DEPS__ = ' + bundleJSON + ';\n<\/script>\n' +
        '<script type="module">\n' + KIOSK_BOOTSTRAP + '\n<\/script>'
    );

    log.info('Generated kiosk HTML: ' + (html.length / 1024).toFixed(0) + ' KB');
    return html;
}
