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
// WINDOW AUGMENTATION
// ============================================================

interface TauriDialogFilter {
    name: string;
    extensions: string[];
}

interface TauriAPI {
    dialog: {
        open: (options: {
            title?: string;
            filters?: TauriDialogFilter[];
            multiple?: boolean;
        }) => Promise<string | string[] | null>;
        save: (options: {
            title?: string;
            defaultPath?: string;
            filters?: TauriDialogFilter[];
        }) => Promise<string | null>;
    };
    fs: {
        readFile: (path: string) => Promise<Uint8Array>;
        writeFile: (path: string, contents: Uint8Array) => Promise<void>;
    };
    shell: {
        open: (url: string) => Promise<void>;
    };
}

declare global {
    interface Window {
        __TAURI__?: TauriAPI;
    }
}

// ============================================================
// DETECTION
// ============================================================

/** Whether we are running inside a Tauri webview */
export function isTauri(): boolean {
    return !!window.__TAURI__;
}

// ============================================================
// FILE FILTER DEFINITIONS
// ============================================================

const FILE_FILTERS: Record<string, TauriDialogFilter> = {
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
// FILE OBJECT WITH TAURI PATH
// ============================================================

interface TauriFile extends File {
    _tauriPath?: string;
}

// ============================================================
// NATIVE FILE OPEN DIALOG
// ============================================================

/**
 * Open a native file dialog and return File object(s).
 */
export async function openFileDialog(options: {
    filterKey?: string;
    multiple?: boolean;
    /** Called immediately after the OS dialog closes (file selected) but before reading file contents. Use to show a loading indicator. */
    onDialogClose?: () => void;
} = {}): Promise<TauriFile[] | null> {
    const { filterKey = 'all', multiple = false } = options;

    if (!isTauri()) return null;

    const { open } = window.__TAURI__!.dialog;
    const { readFile } = window.__TAURI__!.fs;

    const filter = FILE_FILTERS[filterKey] || FILE_FILTERS.all;

    const selected = await open({
        title: `Open ${filter.name}`,
        filters: [filter, { name: 'All Files', extensions: ['*'] }],
        multiple,
    });

    if (!selected) return null;

    // Notify caller that the dialog is closed and file reading is about to begin.
    // This is the right moment to show a loading indicator — the user has chosen
    // a file but readFile() hasn't started yet (can be several seconds for large files).
    options.onDialogClose?.();

    const paths = Array.isArray(selected) ? selected : [selected];

    // Read each file into a File object (Tauri dialog returns paths, not Files)
    const files = await Promise.all(paths.map(async (filePath): Promise<TauriFile> => {
        const contents = await readFile(filePath);
        const name = filePath.split(/[\\/]/).pop()!;
        const file = new File([contents as BlobPart], name) as TauriFile;
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
 */
export async function saveFileDialog(
    blob: Blob,
    defaultFilename: string,
    filter?: TauriDialogFilter
): Promise<boolean> {
    if (!isTauri()) return false;

    try {
        const { save } = window.__TAURI__!.dialog;
        const { writeFile } = window.__TAURI__!.fs;

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
        log.warn('Native save dialog failed:', (err as Error).message);
        return false;
    }
}

// ============================================================
// DOWNLOAD HELPER (native save with browser fallback)
// ============================================================

/**
 * Download a blob: tries native save dialog first, falls back to anchor-click.
 */
export async function download(
    blob: Blob,
    filename: string,
    filter?: TauriDialogFilter
): Promise<void> {
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
// FILE HANDLER CALLBACKS
// ============================================================

interface FileHandlers {
    onSplatFiles?: (files: File[]) => Promise<void>;
    onModelFiles?: (files: File[]) => Promise<void>;
    onArchiveFiles?: (files: File[]) => Promise<void>;
    onPointcloudFiles?: (files: File[]) => Promise<void>;
    onSTLFiles?: (files: File[]) => Promise<void>;
    onProxyMeshFiles?: (files: File[]) => Promise<void>;
    onSourceFiles?: (files: File[]) => Promise<void>;
    onBgImageFiles?: (files: File[]) => Promise<void>;
    onHdrFiles?: (files: File[]) => Promise<void>;
}

// ============================================================
// NATIVE FILE INPUT WIRING
// ============================================================

/**
 * Replace browser file inputs with native Tauri OS dialogs.
 * Accepts a handlers map so callers keep their business logic.
 */
export function wireNativeFileDialogs(handlers: FileHandlers): void {
    if (!isTauri()) return;
    log.info('Wiring native file dialogs for Tauri');

    function wireInput(
        inputId: string,
        filterKey: string,
        multiple: boolean,
        onFiles?: (files: File[]) => Promise<void>
    ): void {
        if (!onFiles) return;

        const label = document.querySelector<HTMLLabelElement>(`label[for="${inputId}"]`);
        if (!label) return;
        label.removeAttribute('for');
        label.style.cursor = 'pointer';
        label.addEventListener('click', async (e: MouseEvent) => {
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
 */
export async function openExternal(url: string): Promise<void> {
    if (isTauri()) {
        try {
            await window.__TAURI__!.shell.open(url);
            return;
        } catch (err) {
            log.warn('shell.open failed:', (err as Error).message);
        }
    }
    window.open(url, '_blank');
}
