/**
 * Tauri Bridge Module
 *
 * Provides native OS integration when running inside Tauri v2.
 * Falls back gracefully to browser APIs when running in a regular browser.
 *
 * Feature detection: window.__TAURI__ is available when app.withGlobalTauri
 * is true in tauri.conf.json. No npm dependency on @tauri-apps/api needed.
 */

import { Logger } from './utilities.js';

const log = Logger.getLogger('tauri-bridge');

// ============================================================
// DETECTION
// ============================================================

/** Whether we are running inside a Tauri webview */
export function isTauri() {
    return !!window.__TAURI__;
}

// ============================================================
// FILE FILTER DEFINITIONS
// ============================================================

const FILE_FILTERS = {
    splat:      { name: 'Gaussian Splats', extensions: ['ply', 'splat', 'ksplat', 'spz', 'sog'] },
    model:      { name: '3D Models', extensions: ['glb', 'gltf', 'obj'] },
    stl:        { name: 'STL Models', extensions: ['stl'] },
    pointcloud: { name: 'Point Clouds', extensions: ['e57'] },
    archive:    { name: '3D Archives', extensions: ['a3d', 'a3z'] },
    image:      { name: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp', 'gif'] },
    hdr:        { name: 'HDR Images', extensions: ['hdr'] },
    json:       { name: 'JSON Files', extensions: ['json'] },
    all:        { name: 'All Supported', extensions: ['a3d', 'a3z', 'glb', 'gltf', 'obj', 'stl', 'ply', 'splat', 'ksplat', 'spz', 'sog', 'e57'] },
};

// ============================================================
// NATIVE FILE OPEN DIALOG
// ============================================================

/**
 * Open a native file dialog and return File object(s).
 *
 * @param {Object} options
 * @param {string} options.filterKey - Key into FILE_FILTERS
 * @param {boolean} options.multiple - Allow multiple selection
 * @returns {Promise<File[]|null>} Array of File objects, or null if cancelled
 */
export async function openFileDialog({ filterKey = 'all', multiple = false } = {}) {
    if (!isTauri()) return null;

    const { open } = window.__TAURI__.dialog;
    const { readFile } = window.__TAURI__.fs;

    const filter = FILE_FILTERS[filterKey] || FILE_FILTERS.all;

    const selected = await open({
        title: `Open ${filter.name}`,
        filters: [filter, { name: 'All Files', extensions: ['*'] }],
        multiple,
    });

    if (!selected) return null;

    const paths = Array.isArray(selected) ? selected : [selected];

    // Read each file into a File object (Tauri dialog returns paths, not Files)
    const files = await Promise.all(paths.map(async (filePath) => {
        const contents = await readFile(filePath);
        const name = filePath.split(/[\\/]/).pop();
        const file = new File([contents], name);
        file._tauriPath = filePath; // Preserve native path for direct filesystem access
        return file;
    }));

    log.info(`Native dialog: ${files.length} file(s) selected via ${filterKey} filter`);
    return files;
}

// ============================================================
// NATIVE FILE SAVE DIALOG
// ============================================================

/**
 * Save a Blob/string using native save dialog.
 * Returns true if saved, false if cancelled or not in Tauri.
 *
 * @param {Blob} blob - The data to save
 * @param {string} defaultFilename - Suggested filename
 * @param {{ name: string, extensions: string[] }} [filter] - Optional file filter
 * @returns {Promise<boolean>}
 */
export async function saveFileDialog(blob, defaultFilename, filter) {
    if (!isTauri()) return false;

    try {
        const { save } = window.__TAURI__.dialog;
        const { writeFile } = window.__TAURI__.fs;

        const path = await save({
            title: 'Save As',
            defaultPath: defaultFilename,
            filters: filter ? [filter] : [],
        });

        if (!path) return false;

        const buffer = new Uint8Array(await blob.arrayBuffer());
        await writeFile(path, buffer);
        log.info(`Saved via native dialog: ${path}`);
        return true;
    } catch (err) {
        log.warn('Native save dialog failed:', err.message);
        return false;
    }
}

// ============================================================
// DOWNLOAD HELPER (native save with browser fallback)
// ============================================================

/**
 * Download a blob: tries native save dialog first, falls back to anchor-click.
 *
 * @param {Blob} blob - The data to download
 * @param {string} filename - Suggested filename
 * @param {{ name: string, extensions: string[] }} [filter] - Optional file filter
 */
export async function download(blob, filename, filter) {
    if (isTauri()) {
        const saved = await saveFileDialog(blob, filename, filter);
        if (saved) return;
        // User cancelled or save failed — fall through to browser download
    }

    // Browser fallback: anchor-click
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// ============================================================
// NATIVE FILE INPUT WIRING
// ============================================================

/**
 * Replace browser file inputs with native Tauri OS dialogs.
 * Accepts a handlers map so callers keep their business logic.
 *
 * @param {Object} handlers - Map of { onSplatFiles, onModelFiles, onArchiveFiles, ... }
 *   Each handler is an async function receiving File[].
 */
export function wireNativeFileDialogs(handlers) {
    if (!isTauri()) return;
    log.info('Wiring native file dialogs for Tauri');

    function wireInput(inputId, filterKey, multiple, onFiles) {
        const label = document.querySelector(`label[for="${inputId}"]`);
        if (!label) return;
        label.removeAttribute('for');
        label.style.cursor = 'pointer';
        label.addEventListener('click', async (e) => {
            e.preventDefault();
            const files = await openFileDialog({ filterKey, multiple });
            if (files && files.length) await onFiles(files);
        });
    }

    wireInput('splat-input', 'splat', false, handlers.onSplatFiles);
    wireInput('model-input', 'model', true, handlers.onModelFiles);
    wireInput('archive-input', 'archive', false, handlers.onArchiveFiles);
    wireInput('pointcloud-input', 'pointcloud', false, handlers.onPointcloudFiles);
    wireInput('stl-input', 'stl', false, handlers.onSTLFiles);
    wireInput('proxy-mesh-input', 'model', false, handlers.onProxyMeshFiles);
    wireInput('source-files-input', 'all', true, handlers.onSourceFiles);
    wireInput('bg-image-input', 'image', false, handlers.onBgImageFiles);
    wireInput('hdr-file-input', 'hdr', false, handlers.onHdrFiles);
}

// ============================================================
// OPEN EXTERNAL URL
// ============================================================

/**
 * Open a URL in the default external browser.
 * In Tauri, uses the shell plugin. In browser, uses window.open.
 *
 * @param {string} url
 */
export async function openExternal(url) {
    if (isTauri()) {
        try {
            await window.__TAURI__.shell.open(url);
            return;
        } catch (err) {
            log.warn('shell.open failed:', err.message);
        }
    }
    window.open(url, '_blank');
}
