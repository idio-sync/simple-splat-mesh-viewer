import { Logger, notify } from './utilities.js';
import { ArchiveLoader } from './archive-loader.js';
import {
    loadSplatFromFile as loadSplatFromFileHandler,
    loadModelFromFile as loadModelFromFileHandler,
    loadSTLFile as loadSTLFileHandler,
    loadSplatFromUrl as loadSplatFromUrlHandler,
    loadModelFromUrl as loadModelFromUrlHandler,
    loadSTLFromUrlWithDeps as loadSTLFromUrlWithDepsHandler,
    loadPointcloudFromFile as loadPointcloudFromFileHandler,
    loadPointcloudFromUrl as loadPointcloudFromUrlHandler,
    loadDrawingFromFile as loadDrawingFromFileHandler,
    loadDrawingFromUrl as loadDrawingFromUrlHandler
} from './file-handlers.js';

const log = Logger.getLogger('file-input-handlers');

// ===== Dependency Interface =====

export interface FileInputDeps {
    validateUserUrl: (url: string, type: string) => { valid: boolean; url: string; error: string };
    state: any;
    sceneManager: any;
    tauriBridge: any;
    assets: any;
    createFileHandlerDeps: () => any;
    createPointcloudDeps: () => any;
    createArchivePipelineDeps: () => any;
    loadArchiveFromUrl: (url: string) => Promise<void>;
    processArchive: (archiveLoader: any, name: string) => Promise<void>;
    showLoading: (msg: string, progress?: boolean) => void;
    hideLoading: () => void;
    updateProgress: (percent: number, msg: string) => void;
    formatFileSize: (bytes: number) => string;
    updateSourceFilesUI: () => void;
}

// ===== Internal URL Loaders =====

async function loadSplatFromUrlInternal(url: string, deps: FileInputDeps) {
    deps.showLoading('Downloading Gaussian Splat...', true);
    try {
        await loadSplatFromUrlHandler(url, deps.createFileHandlerDeps(), (received: number, total: number) => {
            const percent = Math.round((received / total) * 90);
            deps.updateProgress(percent, `Downloading Gaussian Splat... ${deps.formatFileSize(received)} / ${deps.formatFileSize(total)}`);
        });
        const filename = url.split('/').pop() || 'URL';
        document.getElementById('splat-filename').textContent = filename;
        deps.hideLoading();
    } catch (error) {
        log.error('Error loading splat from URL:', error);
        deps.hideLoading();
    }
}

async function loadModelFromUrlInternal(url: string, deps: FileInputDeps) {
    deps.showLoading('Downloading 3D Model...', true);
    try {
        const loadedObject = await loadModelFromUrlHandler(url, deps.createFileHandlerDeps(), (received: number, total: number) => {
            const percent = Math.round((received / total) * 90);
            deps.updateProgress(percent, `Downloading 3D Model... ${deps.formatFileSize(received)} / ${deps.formatFileSize(total)}`);
        });
        if (loadedObject && deps.sceneManager) {
            deps.sceneManager.applyShadowProperties(loadedObject);
        }
        const filename = url.split('/').pop() || 'URL';
        document.getElementById('model-filename').textContent = filename;
        deps.hideLoading();
    } catch (error) {
        log.error('Error loading model from URL:', error);
        deps.hideLoading();
    }
}

async function loadPointcloudFromUrlInternal(url: string, deps: FileInputDeps) {
    deps.showLoading('Downloading Point Cloud...', true);

    try {
        log.info(' Fetching point cloud from URL:', url);
        await loadPointcloudFromUrlHandler(url, deps.createPointcloudDeps(), (received: number, total: number) => {
            const percent = Math.round((received / total) * 90);
            deps.updateProgress(percent, `Downloading Point Cloud... ${deps.formatFileSize(received)} / ${deps.formatFileSize(total)}`);
        });
        deps.state.currentPointcloudUrl = url;
        deps.hideLoading();
    } catch (error) {
        log.error('Error loading point cloud from URL:', error);
        deps.hideLoading();
        notify.error('Error loading point cloud: ' + error.message);
    }
}

async function loadSTLFromUrlInternal(url: string, deps: FileInputDeps) {
    deps.showLoading('Downloading STL Model...', true);

    try {
        await loadSTLFromUrlWithDepsHandler(url, deps.createFileHandlerDeps());
        deps.hideLoading();
    } catch (error) {
        log.error('Error loading STL from URL:', error);
        deps.hideLoading();
        notify.error('Error loading STL: ' + error.message);
    }
}

async function loadDrawingFromUrlInternal(url: string, deps: FileInputDeps) {
    deps.showLoading('Downloading DXF Drawing...', true);

    try {
        await loadDrawingFromUrlHandler(url, deps.createFileHandlerDeps(), (received: number, total: number) => {
            const percent = Math.round((received / total) * 90);
            deps.updateProgress(percent, `Downloading DXF Drawing... ${deps.formatFileSize(received)} / ${deps.formatFileSize(total)}`);
        });
        deps.hideLoading();
    } catch (error) {
        log.error('Error loading DXF from URL:', error);
        deps.hideLoading();
        notify.error('Error loading DXF drawing: ' + error.message);
    }
}

// ===== URL Prompt Handlers =====

export function handleLoadSplatFromUrlPrompt(deps: FileInputDeps) {
    log.info(' handleLoadSplatFromUrlPrompt called');
    const url = prompt('Enter Gaussian Splat URL:');
    log.info(' User entered:', url);
    if (!url) return;

    const validation = deps.validateUserUrl(url, 'splat');
    if (!validation.valid) {
        notify.error('Cannot load splat: ' + validation.error);
        return;
    }

    loadSplatFromUrlInternal(validation.url, deps);
}

export function handleLoadModelFromUrlPrompt(deps: FileInputDeps) {
    log.info(' handleLoadModelFromUrlPrompt called');
    const url = prompt('Enter 3D Model URL (.glb, .gltf, .obj):');
    log.info(' User entered:', url);
    if (!url) return;

    const validation = deps.validateUserUrl(url, 'model');
    if (!validation.valid) {
        notify.error('Cannot load model: ' + validation.error);
        return;
    }

    loadModelFromUrlInternal(validation.url, deps);
}

export function handleLoadPointcloudFromUrlPrompt(deps: FileInputDeps) {
    log.info(' handleLoadPointcloudFromUrlPrompt called');
    const url = prompt('Enter E57 Point Cloud URL (.e57):');
    log.info(' User entered:', url);
    if (!url) return;

    const validation = deps.validateUserUrl(url, 'pointcloud');
    if (!validation.valid) {
        notify.error('Cannot load point cloud: ' + validation.error);
        return;
    }

    loadPointcloudFromUrlInternal(validation.url, deps);
}

export function handleLoadArchiveFromUrlPrompt(deps: FileInputDeps) {
    log.info(' handleLoadArchiveFromUrlPrompt called');
    const url = prompt('Enter Archive URL (.a3d, .a3z):');
    log.info(' User entered:', url);
    if (!url) return;

    const validation = deps.validateUserUrl(url, 'archive');
    if (!validation.valid) {
        notify.error('Cannot load archive: ' + validation.error);
        return;
    }

    deps.loadArchiveFromUrl(validation.url);
}

export function handleLoadSTLFromUrlPrompt(deps: FileInputDeps) {
    log.info(' handleLoadSTLFromUrlPrompt called');
    const url = prompt('Enter STL Model URL (.stl):');
    log.info(' User entered:', url);
    if (!url) return;

    const validation = deps.validateUserUrl(url, 'stl');
    if (!validation.valid) {
        notify.error('Cannot load STL: ' + validation.error);
        return;
    }

    loadSTLFromUrlInternal(validation.url, deps);
}

export function handleLoadDrawingFromUrlPrompt(deps: FileInputDeps) {
    log.info(' handleLoadDrawingFromUrlPrompt called');
    const url = prompt('Enter DXF Drawing URL (.dxf):');
    log.info(' User entered:', url);
    if (!url) return;

    const validation = deps.validateUserUrl(url, 'drawing');
    if (!validation.valid) {
        notify.error('Cannot load DXF: ' + validation.error);
        return;
    }

    loadDrawingFromUrlInternal(validation.url, deps);
}

// ===== File Input Handlers =====

export async function handleSplatFile(event: Event, deps: FileInputDeps) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    document.getElementById('splat-filename').textContent = file.name;
    deps.showLoading('Loading Gaussian Splat...');

    try {
        await loadSplatFromFileHandler(file, deps.createFileHandlerDeps());
        deps.hideLoading();
    } catch (error) {
        log.error('Error loading splat:', error);
        deps.hideLoading();
        notify.error('Error loading Gaussian Splat: ' + error.message);
    }
}

export async function handleModelFile(event: Event, deps: FileInputDeps) {
    const files = (event.target as HTMLInputElement).files;
    if (!files.length) return;

    const mainFile = files[0];
    document.getElementById('model-filename').textContent = mainFile.name;
    deps.showLoading('Loading 3D Model...');

    try {
        await loadModelFromFileHandler(files, deps.createFileHandlerDeps());
        deps.hideLoading();
    } catch (error) {
        log.error('Error loading model:', error);
        deps.hideLoading();
        notify.error('Error loading model: ' + error.message);
    }
}

export async function handleSTLFile(event: Event, deps: FileInputDeps) {
    const files = (event.target as HTMLInputElement).files;
    if (!files.length) return;

    const mainFile = files[0];
    document.getElementById('stl-filename').textContent = mainFile.name;
    deps.showLoading('Loading STL Model...');

    try {
        await loadSTLFileHandler(files, deps.createFileHandlerDeps());
        deps.hideLoading();
    } catch (error) {
        log.error('Error loading STL:', error);
        deps.hideLoading();
        notify.error('Error loading STL: ' + error.message);
    }
}

export async function handleDrawingFile(event: Event, deps: FileInputDeps) {
    const files = (event.target as HTMLInputElement).files;
    if (!files.length) return;

    const mainFile = files[0];
    document.getElementById('drawing-filename').textContent = mainFile.name;
    deps.showLoading('Loading DXF Drawing...');

    try {
        await loadDrawingFromFileHandler(files, deps.createFileHandlerDeps());
        deps.hideLoading();
    } catch (error) {
        log.error('Error loading DXF:', error);
        deps.hideLoading();
        notify.error('Error loading DXF drawing: ' + error.message);
    }
}

export async function handlePointcloudFile(event: Event, deps: FileInputDeps) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    document.getElementById('pointcloud-filename').textContent = file.name;
    deps.showLoading('Loading point cloud...');

    try {
        await loadPointcloudFromFileHandler(file, deps.createPointcloudDeps());
        deps.hideLoading();
    } catch (error) {
        log.error('Error loading point cloud:', error);
        deps.hideLoading();
        notify.error('Error loading point cloud: ' + error.message);
    }
}

export async function handleProxyMeshFile(event: Event, deps: FileInputDeps) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    deps.assets.proxyMeshBlob = file;
    document.getElementById('proxy-mesh-filename').textContent = file.name;
    notify.info(`Display proxy "${file.name}" ready — will be included in archive exports.`);
}

export async function handleProxySplatFile(event: Event, deps: FileInputDeps) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    deps.assets.proxySplatBlob = file;
    document.getElementById('proxy-splat-filename').textContent = file.name;
    notify.info(`Splat display proxy "${file.name}" ready — will be included in archive exports.`);
}

// ===== Exported URL Loaders (used by loadDefaultFiles in main.ts) =====

export async function loadSplatFromUrl(url: string, deps: FileInputDeps) {
    return loadSplatFromUrlInternal(url, deps);
}

export async function loadModelFromUrl(url: string, deps: FileInputDeps) {
    return loadModelFromUrlInternal(url, deps);
}

export async function loadPointcloudFromUrl(url: string, deps: FileInputDeps) {
    return loadPointcloudFromUrlInternal(url, deps);
}

export async function loadSTLFromUrl(url: string, deps: FileInputDeps) {
    return loadSTLFromUrlInternal(url, deps);
}

export async function loadDrawingFromUrl(url: string, deps: FileInputDeps) {
    return loadDrawingFromUrlInternal(url, deps);
}

// ===== Tauri Native Dialog Wiring =====

export function wireNativeFileDialogs(deps: FileInputDeps) {
    if (!deps.tauriBridge || !deps.tauriBridge.isTauri()) return;
    deps.tauriBridge.wireNativeFileDialogs({
        onSplatFiles: async (files: any[]) => {
            document.getElementById('splat-filename').textContent = files[0].name;
            deps.showLoading('Loading Gaussian Splat...');
            try {
                await loadSplatFromFileHandler(files[0], deps.createFileHandlerDeps());
                deps.hideLoading();
            } catch (e) {
                log.error('Error loading splat:', e);
                deps.hideLoading();
                notify.error('Error loading Gaussian Splat: ' + e.message);
            }
        },
        onModelFiles: async (files: any[]) => {
            document.getElementById('model-filename').textContent = files[0].name;
            deps.showLoading('Loading 3D Model...');
            try {
                await loadModelFromFileHandler(files as any, deps.createFileHandlerDeps());
                deps.hideLoading();
            } catch (e) {
                log.error('Error loading model:', e);
                deps.hideLoading();
                notify.error('Error loading model: ' + e.message);
            }
        },
        onArchiveFiles: async (files: any[]) => {
            document.getElementById('archive-filename').textContent = files[0].name;
            deps.showLoading('Loading archive...');
            try {
                if (deps.state.archiveLoader) deps.state.archiveLoader.dispose();
                const archiveLoader = new ArchiveLoader();
                await archiveLoader.loadFromFile(files[0]);
                await deps.processArchive(archiveLoader, files[0].name);
                deps.state.currentArchiveUrl = null;
            } catch (e) {
                log.error('Error loading archive:', e);
                deps.hideLoading();
                notify.error('Error loading archive: ' + e.message);
            }
        },
        onPointcloudFiles: async (files: any[]) => {
            document.getElementById('pointcloud-filename').textContent = files[0].name;
            deps.showLoading('Loading point cloud...');
            try {
                await loadPointcloudFromFileHandler(files[0], deps.createPointcloudDeps());
                deps.hideLoading();
            } catch (e) {
                log.error('Error loading point cloud:', e);
                deps.hideLoading();
                notify.error('Error loading point cloud: ' + e.message);
            }
        },
        onSTLFiles: async (files: any[]) => {
            document.getElementById('stl-filename').textContent = files[0].name;
            deps.showLoading('Loading STL Model...');
            try {
                await loadSTLFileHandler([files[0]] as any, deps.createFileHandlerDeps());
                deps.hideLoading();
            } catch (e) {
                log.error('Error loading STL:', e);
                deps.hideLoading();
                notify.error('Error loading STL: ' + e.message);
            }
        },
        onProxyMeshFiles: async (files: any[]) => {
            deps.assets.proxyMeshBlob = files[0];
            document.getElementById('proxy-mesh-filename').textContent = files[0].name;
            notify.info(`Display proxy "${files[0].name}" ready — will be included in archive exports.`);
        },
        onSourceFiles: async (files: any[]) => {
            const category = (document.getElementById('source-files-category') as HTMLInputElement)?.value || '';
            for (const file of files) {
                deps.assets.sourceFiles.push({ file, name: file.name, size: file.size, category, fromArchive: false });
            }
            deps.updateSourceFilesUI();
            notify.info(`Added ${files.length} source file(s) for archival.`);
        },
        onBgImageFiles: async (files: any[]) => {
            if (!deps.sceneManager) return;
            try {
                await deps.sceneManager.loadBackgroundImageFromFile(files[0]);
                const filenameEl = document.getElementById('bg-image-filename');
                if (filenameEl) {
                    filenameEl.textContent = files[0].name;
                    filenameEl.style.display = '';
                }
                const envBgToggle = document.getElementById('toggle-env-background') as HTMLInputElement | null;
                if (envBgToggle) envBgToggle.checked = false;
                document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
                const clearBtn = document.getElementById('btn-clear-bg-image');
                if (clearBtn) clearBtn.style.display = '';
            } catch (err) {
                notify.error('Failed to load background image: ' + err.message);
            }
        },
        onHDRFiles: async (files: any[]) => {
            if (!deps.sceneManager) return;
            try {
                await deps.sceneManager.loadHDREnvironment(files[0]);
                const filenameEl = document.getElementById('hdr-filename');
                if (filenameEl) {
                    filenameEl.textContent = files[0].name;
                    filenameEl.style.display = '';
                }
                const select = document.getElementById('env-map-select') as HTMLSelectElement | null;
                if (select) select.value = '';
                deps.hideLoading();
                notify.success('HDR environment loaded');
            } catch (err) {
                deps.hideLoading();
                notify.error('Failed to load HDR: ' + err.message);
            }
        }
    });
}
