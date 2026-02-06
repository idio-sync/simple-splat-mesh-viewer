/**
 * Kiosk Viewer Generator
 *
 * Generates a self-contained HTML file that embeds a read-only 3D viewer.
 * The generated file is a polyglot: valid HTML that also contains ZIP data
 * appended after </html>. The viewer reads itself, extracts the ZIP portion,
 * and renders the 3D assets offline.
 *
 * Architecture:
 * - Dependencies are fetched from CDN at export time as ES module source text
 * - Sources are base64-encoded and embedded in the HTML
 * - At runtime, the kiosk HTML decodes sources, creates blob URLs, rewrites
 *   internal `from "three"` imports to use the Three.js blob URL, then
 *   dynamically imports everything — ensuring a single shared Three.js instance
 * - fflate is used to extract the appended ZIP data containing 3D assets
 */

import { Logger } from './utilities.js';

const log = Logger.getLogger('kiosk-viewer');

// CDN URLs for dependencies to fetch and inline.
// Three.js core uses ?bundle to produce a standalone module.
// Addons use ?external=three so their `from "three"` imports can be rewritten
// to point at the Three.js blob URL at runtime.
const CDN_DEPS = {
    three: 'https://esm.sh/three@0.170.0?bundle',
    threeGLTFLoader: 'https://esm.sh/three@0.170.0/examples/jsm/loaders/GLTFLoader.js?external=three',
    threeOBJLoader: 'https://esm.sh/three@0.170.0/examples/jsm/loaders/OBJLoader.js?external=three',
    threeOrbitControls: 'https://esm.sh/three@0.170.0/examples/jsm/controls/OrbitControls.js?external=three',
    spark: 'https://sparkjs.dev/releases/spark/0.1.10/spark.module.js',
    fflate: 'https://esm.sh/fflate@0.8.2?bundle'
};

/**
 * Fetch a CDN URL as text with one retry.
 */
async function fetchDep(url) {
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
 * Fetch all CDN dependencies and return as base64-encoded strings.
 * @param {Function} onProgress - Progress callback (message string)
 * @returns {Object} Map of dependency name → base64-encoded source
 */
export async function fetchDependencies(onProgress) {
    const deps = {};
    const entries = Object.entries(CDN_DEPS);
    for (let i = 0; i < entries.length; i++) {
        const [name, url] = entries[i];
        if (onProgress) onProgress(`Fetching ${name} (${i + 1}/${entries.length})...`);
        log.info(`[Kiosk] Fetching ${name} from ${url}`);
        const src = await fetchDep(url);
        // Base64-encode to safely embed in HTML without escaping issues
        deps[name] = btoa(unescape(encodeURIComponent(src)));
        log.info(`[Kiosk] Fetched ${name}: ${(src.length / 1024).toFixed(1)} KB source → ${(deps[name].length / 1024).toFixed(1)} KB base64`);
    }
    return deps;
}

/**
 * Generate the self-contained kiosk viewer HTML string.
 *
 * @param {Object} options
 * @param {Object} options.deps - Base64-encoded dependency sources (from fetchDependencies)
 * @param {Object} options.manifest - The archive manifest.json object
 * @param {string} options.title - Project title for the page
 * @returns {string} Complete HTML string for the kiosk viewer
 */
export function generateKioskHTML({ deps, manifest, title }) {
    const safeTitle = (title || 'Offline Viewer').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Safely embed manifest JSON — escape </script> sequences
    const manifestJSON = JSON.stringify(manifest).replace(/<\//g, '<\\/');

    // Build the base64 deps object literal for embedding
    const depsLiteral = JSON.stringify(deps);

    return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>${safeTitle} - Offline Viewer</title>
<style>
${KIOSK_CSS}
</style>
</head>
<body>
<div id="loading">
    <div class="spinner"></div>
    <div id="loading-text">Initializing viewer...</div>
</div>
<div id="drop-overlay" class="hidden">
    <div class="drop-content">
        <div class="drop-icon">&#128194;</div>
        <p>Drop this file here to view</p>
        <p class="drop-hint">Your browser requires drag-and-drop for local files.</p>
        <p class="drop-hint">Drag this same .html file onto this page.</p>
    </div>
</div>
<div id="viewer" class="hidden">
    <canvas id="canvas"></canvas>
    <div id="info-panel">
        <h2 id="info-title"></h2>
        <p id="info-description"></p>
        <div id="info-details"></div>
    </div>
    <div id="controls-hint">Click and drag to rotate &middot; Scroll to zoom &middot; Right-click to pan</div>
</div>
<script>
// Embedded data
var __KIOSK_DEPS__ = ${depsLiteral};
var __KIOSK_MANIFEST__ = ${manifestJSON};

${KIOSK_BOOTSTRAP_JS}
<\/script>
</body>
</html>
<!-- KIOSK_ZIP_BOUNDARY -->`;
}

/**
 * Build the complete polyglot file (HTML + ZIP).
 *
 * @param {string} html - The kiosk HTML string (from generateKioskHTML)
 * @param {Uint8Array} zipData - The ZIP archive binary data
 * @returns {Blob} The polyglot file as a Blob
 */
export function buildPolyglotFile(html, zipData) {
    const encoder = new TextEncoder();
    const htmlBytes = encoder.encode(html);

    const combined = new Uint8Array(htmlBytes.length + zipData.length);
    combined.set(htmlBytes, 0);
    combined.set(zipData, htmlBytes.length);

    return new Blob([combined], { type: 'text/html' });
}

// =============================================================================
// KIOSK CSS (embedded in the generated HTML)
// =============================================================================

const KIOSK_CSS = `
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; overflow: hidden; background: #1a1a2e; color: #eee; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; }

#loading {
    position: fixed; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; background: #1a1a2e; z-index: 100;
}
.spinner {
    width: 48px; height: 48px; border: 4px solid #333;
    border-top-color: #4ecdc4; border-radius: 50%;
    animation: spin 0.8s linear infinite;
}
@keyframes spin { to { transform: rotate(360deg); } }
#loading-text { margin-top: 16px; color: #888; font-size: 14px; }

#drop-overlay {
    position: fixed; inset: 0; display: flex; align-items: center;
    justify-content: center; background: rgba(26, 26, 46, 0.95); z-index: 200;
}
#drop-overlay.hidden { display: none; }
.drop-content { text-align: center; padding: 40px; }
.drop-icon { font-size: 64px; margin-bottom: 16px; }
.drop-content p { font-size: 18px; margin-bottom: 8px; }
.drop-content .drop-hint { font-size: 13px; color: #888; }

#viewer { width: 100%; height: 100%; position: relative; }
#viewer.hidden { display: none; }
#canvas { width: 100%; height: 100%; display: block; }

#info-panel {
    position: fixed; top: 16px; left: 16px; max-width: 360px; padding: 16px 20px;
    background: rgba(26, 26, 46, 0.85); border: 1px solid #3a3a5a;
    border-radius: 10px; backdrop-filter: blur(8px); z-index: 10;
    transition: opacity 0.3s;
}
#info-panel h2 { font-size: 16px; color: #4ecdc4; margin-bottom: 6px; }
#info-panel p { font-size: 13px; color: #aaa; line-height: 1.4; }
#info-details { margin-top: 8px; font-size: 12px; color: #666; }
#info-details .row { display: flex; justify-content: space-between; padding: 2px 0; }
#info-details .row .label { color: #888; }
#info-details .row .value { color: #ccc; }

#controls-hint {
    position: fixed; bottom: 16px; left: 50%; transform: translateX(-50%);
    padding: 8px 16px; background: rgba(0,0,0,0.5); border-radius: 20px;
    font-size: 12px; color: #888; pointer-events: none; z-index: 10;
    opacity: 1; transition: opacity 2s;
}
#controls-hint.fade { opacity: 0; }

.anno-marker {
    background: rgba(78, 205, 196, 0.9); color: #fff; padding: 4px 10px;
    border-radius: 12px; font-size: 11px; white-space: nowrap;
    pointer-events: auto; cursor: pointer; border: 1px solid rgba(255,255,255,0.2);
}
.anno-popup {
    position: fixed; padding: 12px 16px; background: rgba(26, 26, 46, 0.95);
    border: 1px solid #4ecdc4; border-radius: 8px; max-width: 280px;
    z-index: 50; font-size: 13px;
}
.anno-popup h4 { color: #4ecdc4; margin-bottom: 4px; }
.anno-popup p { color: #bbb; line-height: 1.4; }
`;

// =============================================================================
// KIOSK BOOTSTRAP JS
//
// This is the module script embedded in the generated HTML. It:
// 1. Decodes base64 dependency sources
// 2. Creates blob URLs, rewriting internal `from "three"` to the Three.js blob
// 3. Dynamically imports all deps (single Three.js instance)
// 4. Reads itself to extract the appended ZIP data
// 5. Extracts assets and renders in a read-only viewer
// =============================================================================

const KIOSK_BOOTSTRAP_JS = `
console.log('[Kiosk] Script executing');

(async function() {
    var loadingText = document.getElementById('loading-text');
    function setStatus(msg) {
        console.log('[Kiosk] ' + msg);
        if (loadingText) loadingText.textContent = msg;
    }

    try {
        // =====================================================================
        // PHASE 1: Load dependencies from embedded base64 sources
        // =====================================================================
        setStatus('Loading libraries...');

        var deps = __KIOSK_DEPS__;
        if (!deps || !deps.three) throw new Error('Embedded dependency data is missing');

        function decode(b64) { return decodeURIComponent(escape(atob(b64))); }
        function makeBlob(src) { return URL.createObjectURL(new Blob([src], { type: 'application/javascript' })); }

        // Rewrite imports from "three" (bare specifier) to use the Three.js blob URL.
        // Also handles esm.sh internal URLs that reference three.
        function rewriteThreeImports(src, threeUrl) {
            return src
                .replace(/from\\s*["']three["']/g, 'from "' + threeUrl + '"')
                .replace(/from\\s*["']\\/v\\d+\\/three@[^"']*["']/g, 'from "' + threeUrl + '"')
                .replace(/from\\s*["']https?:\\/\\/esm\\.sh\\/[^"']*three@[^"']*["']/g, 'from "' + threeUrl + '"');
        }

        // 1. Three.js core (standalone bundle, no external imports)
        setStatus('Loading Three.js...');
        var threeSrc = decode(deps.three);
        var threeUrl = makeBlob(threeSrc);
        console.log('[Kiosk] Three.js blob URL created, importing...');
        var THREE = await import(threeUrl);
        console.log('[Kiosk] Three.js loaded, exports: ' + Object.keys(THREE).length + ' symbols');

        // 2. Addons (rewrite their "three" imports to our blob URL)
        setStatus('Loading controls and loaders...');
        var orbitSrc = rewriteThreeImports(decode(deps.threeOrbitControls), threeUrl);
        var OrbitControls = (await import(makeBlob(orbitSrc))).OrbitControls;
        console.log('[Kiosk] OrbitControls loaded');

        var gltfSrc = rewriteThreeImports(decode(deps.threeGLTFLoader), threeUrl);
        var GLTFLoader = (await import(makeBlob(gltfSrc))).GLTFLoader;
        console.log('[Kiosk] GLTFLoader loaded');

        var objSrc = rewriteThreeImports(decode(deps.threeOBJLoader), threeUrl);
        var OBJLoader = (await import(makeBlob(objSrc))).OBJLoader;
        console.log('[Kiosk] OBJLoader loaded');

        // 3. Spark.js (rewrite three imports if present)
        var SplatMesh = null;
        try {
            setStatus('Loading Spark.js...');
            var sparkSrc = rewriteThreeImports(decode(deps.spark), threeUrl);
            var sparkMod = await import(makeBlob(sparkSrc));
            SplatMesh = sparkMod.SplatMesh;
            console.log('[Kiosk] Spark.js loaded, SplatMesh:', !!SplatMesh);
        } catch (e) {
            console.warn('[Kiosk] Spark.js failed to load (splats will not render):', e.message);
        }

        // 4. fflate (standalone, no three dependency)
        setStatus('Loading decompression library...');
        var fflateSrc = decode(deps.fflate);
        var fflate = await import(makeBlob(fflateSrc));
        console.log('[Kiosk] fflate loaded');

        // =====================================================================
        // PHASE 2: Read ourselves and extract ZIP data
        // =====================================================================
        setStatus('Reading archive data...');
        var fileBytes = null;

        try {
            var resp = await fetch(window.location.href);
            if (resp.ok) {
                fileBytes = new Uint8Array(await resp.arrayBuffer());
                console.log('[Kiosk] Self-read complete: ' + fileBytes.length + ' bytes');
            }
        } catch (e) {
            console.warn('[Kiosk] fetch(self) failed (expected on file://):', e.message);
        }

        if (!fileBytes) {
            setStatus('Waiting for file...');
            document.getElementById('loading').style.display = 'none';
            fileBytes = await waitForFileDrop();
            document.getElementById('loading').style.display = '';
            setStatus('Extracting assets...');
        }

        // Find the ZIP boundary
        var zipStart = findZipBoundary(fileBytes);
        console.log('[Kiosk] ZIP boundary at byte: ' + zipStart);
        if (zipStart === -1) {
            throw new Error('No archive data found in this file. File size: ' + fileBytes.length);
        }

        var zipData = fileBytes.slice(zipStart);
        console.log('[Kiosk] ZIP data size: ' + zipData.length + ' bytes');
        var files = fflate.unzipSync(zipData);
        var fileNames = Object.keys(files);
        console.log('[Kiosk] Extracted ' + fileNames.length + ' files: ' + fileNames.join(', '));
        var decoder = new TextDecoder();

        // Parse manifest (prefer embedded in ZIP, fall back to inline)
        var manifest = __KIOSK_MANIFEST__;
        if (files['manifest.json']) {
            manifest = JSON.parse(decoder.decode(files['manifest.json']));
            console.log('[Kiosk] Using manifest from ZIP');
        }
        if (!manifest) throw new Error('No manifest found in archive.');

        // =====================================================================
        // PHASE 3: Initialize viewer and load assets
        // =====================================================================
        setStatus('Loading 3D content...');

        var canvas = document.getElementById('canvas');
        var renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true });
        renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        renderer.setSize(window.innerWidth, window.innerHeight);
        renderer.outputColorSpace = THREE.SRGBColorSpace;

        var scene = new THREE.Scene();
        scene.background = new THREE.Color(0x1a1a2e);

        var camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.01, 1000);
        camera.position.set(0, 1, 3);

        var controls = new OrbitControls(camera, renderer.domElement);
        controls.enableDamping = true;
        controls.dampingFactor = 0.1;

        // Lighting
        scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        var dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
        dirLight.position.set(5, 10, 7);
        scene.add(dirLight);

        // Grid
        scene.add(new THREE.GridHelper(10, 10, 0x3a3a5a, 0x2a2a3a));

        // Load assets
        var entries = manifest.data_entries || {};
        var boundingBox = new THREE.Box3();
        var hasContent = false;

        var entryKeys = Object.keys(entries);
        for (var i = 0; i < entryKeys.length; i++) {
            var key = entryKeys[i];
            var entry = entries[key];
            var filePath = entry.file_name;
            var fileData = files[filePath];
            if (!fileData) {
                console.warn('[Kiosk] File not found in archive: ' + filePath);
                continue;
            }

            var assetBlob = new Blob([fileData]);
            var assetUrl = URL.createObjectURL(assetBlob);
            var params = entry._parameters || {};

            try {
                if (key.indexOf('scene_') === 0 && SplatMesh) {
                    console.log('[Kiosk] Loading splat: ' + filePath);
                    var splatMesh = new SplatMesh({ url: assetUrl });
                    splatMesh.rotation.x = Math.PI;
                    applyTransform(splatMesh, params);
                    scene.add(splatMesh);
                    hasContent = true;

                } else if (key.indexOf('mesh_') === 0) {
                    console.log('[Kiosk] Loading mesh: ' + filePath);
                    var ext = filePath.split('.').pop().toLowerCase();
                    var object = null;

                    if (ext === 'glb' || ext === 'gltf') {
                        var gltfLoader = new GLTFLoader();
                        var gltf = await new Promise(function(res, rej) { gltfLoader.load(assetUrl, res, undefined, rej); });
                        object = gltf.scene;
                    } else if (ext === 'obj') {
                        var objLoader = new OBJLoader();
                        object = await new Promise(function(res, rej) { objLoader.load(assetUrl, res, undefined, rej); });
                    }

                    if (object) {
                        applyTransform(object, params);
                        scene.add(object);
                        hasContent = true;
                        boundingBox.expandByObject(object);
                        console.log('[Kiosk] Mesh loaded: ' + filePath);
                    }

                } else if (key.indexOf('pointcloud_') === 0) {
                    console.warn('[Kiosk] Point cloud display requires E57 WASM (not available offline)');
                }
            } catch (err) {
                console.warn('[Kiosk] Failed to load ' + key + ':', err);
            }
        }

        // Fit camera to content
        if (!boundingBox.isEmpty()) {
            var center = boundingBox.getCenter(new THREE.Vector3());
            var size = boundingBox.getSize(new THREE.Vector3());
            var maxDim = Math.max(size.x, size.y, size.z);
            camera.position.copy(center);
            camera.position.z += maxDim * 1.5;
            camera.position.y += maxDim * 0.5;
            controls.target.copy(center);
        }

        // Load annotations
        var annotations = manifest.annotations || [];
        var annoSprites = [];
        for (var a = 0; a < annotations.length; a++) {
            var anno = annotations[a];
            if (!anno.position) continue;
            var el = document.createElement('div');
            el.className = 'anno-marker';
            el.textContent = anno.title || anno.id || 'Note';
            el.addEventListener('click', showAnnoPopup.bind(null, anno, el));
            document.body.appendChild(el);
            annoSprites.push({
                pos: new THREE.Vector3(anno.position[0], anno.position[1], anno.position[2]),
                el: el
            });
        }

        // Populate info panel
        populateInfo(manifest);

        // Show viewer
        document.getElementById('loading').style.display = 'none';
        document.getElementById('viewer').classList.remove('hidden');
        console.log('[Kiosk] Viewer ready, content loaded: ' + hasContent);
        setTimeout(function() {
            var hint = document.getElementById('controls-hint');
            if (hint) hint.classList.add('fade');
        }, 5000);

        // Resize
        window.addEventListener('resize', function() {
            camera.aspect = window.innerWidth / window.innerHeight;
            camera.updateProjectionMatrix();
            renderer.setSize(window.innerWidth, window.innerHeight);
        });

        // Render loop
        (function animate() {
            requestAnimationFrame(animate);
            controls.update();

            for (var s = 0; s < annoSprites.length; s++) {
                var sp = annoSprites[s].pos.clone().project(camera);
                var ael = annoSprites[s].el;
                if (sp.z > 1) { ael.style.display = 'none'; continue; }
                ael.style.display = '';
                ael.style.position = 'fixed';
                ael.style.left = ((sp.x * 0.5 + 0.5) * window.innerWidth) + 'px';
                ael.style.top = ((-sp.y * 0.5 + 0.5) * window.innerHeight) + 'px';
                ael.style.transform = 'translate(-50%, -50%)';
                ael.style.zIndex = '20';
            }

            renderer.render(scene, camera);
        })();

    } catch (err) {
        setStatus('Error: ' + err.message);
        console.error('[Kiosk Viewer] Fatal error:', err);
    }
})();

// =========================================================================
// Helper functions
// =========================================================================

function findZipBoundary(bytes) {
    // Search for the boundary marker comment
    var marker = [60,33,45,45,32,75,73,79,83,75,95,90,73,80,95,66,79,85,78,68,65,82,89,32,45,45,62];
    var pos = -1;

    for (var i = 0; i < bytes.length - marker.length; i++) {
        var match = true;
        for (var j = 0; j < marker.length; j++) {
            if (bytes[i + j] !== marker[j]) { match = false; break; }
        }
        if (match) { pos = i + marker.length; break; }
    }

    if (pos !== -1) {
        // Skip whitespace after marker
        while (pos < bytes.length && (bytes[pos] === 10 || bytes[pos] === 13 || bytes[pos] === 32)) pos++;
        // Verify ZIP local file header magic (PK 03 04)
        if (pos + 3 < bytes.length && bytes[pos] === 0x50 && bytes[pos+1] === 0x4B && bytes[pos+2] === 0x03 && bytes[pos+3] === 0x04) {
            return pos;
        }
        console.warn('[Kiosk] Found boundary marker but no ZIP magic after it at offset ' + pos);
    }

    // Fallback: scan for first PK local file header after end-of-central-directory
    console.log('[Kiosk] Boundary marker not found, scanning for ZIP signatures...');
    for (var i2 = bytes.length - 22; i2 >= 0; i2--) {
        if (bytes[i2] === 0x50 && bytes[i2+1] === 0x4B && bytes[i2+2] === 0x05 && bytes[i2+3] === 0x06) {
            console.log('[Kiosk] Found EOCD at offset ' + i2);
            for (var j2 = 0; j2 < i2; j2++) {
                if (bytes[j2] === 0x50 && bytes[j2+1] === 0x4B && bytes[j2+2] === 0x03 && bytes[j2+3] === 0x04) {
                    console.log('[Kiosk] Found first local file header at offset ' + j2);
                    return j2;
                }
            }
        }
    }
    return -1;
}

function waitForFileDrop() {
    return new Promise(function(resolve) {
        var overlay = document.getElementById('drop-overlay');
        overlay.classList.remove('hidden');

        function handleDrop(e) {
            e.preventDefault();
            overlay.classList.add('hidden');
            var file = e.dataTransfer.files[0];
            if (!file) return;
            var reader = new FileReader();
            reader.onload = function() { resolve(new Uint8Array(reader.result)); };
            reader.readAsArrayBuffer(file);
        }

        document.addEventListener('dragover', function(e) { e.preventDefault(); });
        document.addEventListener('drop', handleDrop);
    });
}

function applyTransform(object, params) {
    if (params.position) object.position.set(params.position[0] || 0, params.position[1] || 0, params.position[2] || 0);
    if (params.rotation) object.rotation.set(params.rotation[0] || 0, params.rotation[1] || 0, params.rotation[2] || 0);
    if (params.scale !== undefined) {
        var s = typeof params.scale === 'number' ? params.scale : 1;
        object.scale.set(s, s, s);
    }
}

function showAnnoPopup(anno, marker) {
    var old = document.querySelector('.anno-popup');
    if (old) old.remove();

    var popup = document.createElement('div');
    popup.className = 'anno-popup';
    var title = (anno.title || 'Annotation').replace(/</g, '&lt;');
    var body = (anno.body || anno.description || '').replace(/</g, '&lt;');
    popup.innerHTML = '<h4>' + title + '</h4><p>' + body + '</p>';

    var rect = marker.getBoundingClientRect();
    popup.style.left = (rect.right + 8) + 'px';
    popup.style.top = rect.top + 'px';
    document.body.appendChild(popup);

    setTimeout(function() {
        document.addEventListener('click', function handler(e) {
            if (!popup.contains(e.target) && e.target !== marker) {
                popup.remove();
                document.removeEventListener('click', handler);
            }
        });
    }, 10);
}

function populateInfo(manifest) {
    var titleEl = document.getElementById('info-title');
    var descEl = document.getElementById('info-description');
    var detailsEl = document.getElementById('info-details');

    if (titleEl) titleEl.textContent = manifest.project && manifest.project.title ? manifest.project.title : 'Untitled';
    if (descEl) {
        var desc = manifest.project && manifest.project.description ? manifest.project.description : '';
        descEl.textContent = desc;
        if (!desc) descEl.style.display = 'none';
    }
    if (detailsEl) {
        var rows = [];
        if (manifest.provenance && manifest.provenance.operator) rows.push(['Creator', manifest.provenance.operator]);
        if (manifest.provenance && manifest.provenance.capture_date) {
            rows.push(['Captured', new Date(manifest.provenance.capture_date).toLocaleDateString()]);
        }
        if (manifest.provenance && manifest.provenance.location) rows.push(['Location', manifest.provenance.location]);
        if (manifest.project && manifest.project.license) rows.push(['License', manifest.project.license]);
        var ac = (manifest.annotations || []).length;
        if (ac > 0) rows.push(['Annotations', ac.toString()]);

        detailsEl.innerHTML = rows.map(function(r) {
            return '<div class="row"><span class="label">' + r[0] + '</span><span class="value">' + r[1] + '</span></div>';
        }).join('');
        if (!rows.length) detailsEl.style.display = 'none';
    }
}
`;
