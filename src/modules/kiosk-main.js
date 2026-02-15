/**
 * Kiosk Main Module
 *
 * Slim viewer entry point for kiosk/offline mode.
 * Imports from real application modules so that visual and functional
 * changes propagate automatically — no hardcoded templates.
 *
 * Viewer-only: no archive creation, no metadata editing, no alignment tools.
 */

import * as THREE from 'three';
import { SceneManager } from './scene-manager.js';
import { FlyControls } from './fly-controls.js';
import { AnnotationSystem } from './annotation-system.js';
import { CAMERA, ASSET_STATE, QUALITY_TIER } from './constants.js';
import { resolveQualityTier, hasAnyProxy } from './quality-tier.js';
import { Logger, notify, parseMarkdown, resolveAssetRefs, fetchWithProgress, downloadBlob } from './utilities.js';
import {
    showLoading, hideLoading, updateProgress,
    setDisplayMode, setupCollapsibles, addListener,
    setupKeyboardShortcuts,
    showInlineLoading, hideInlineLoading
} from './ui-controller.js';
import {
    loadArchiveFromFile, processArchive,
    processArchivePhase1, loadArchiveAsset,
    getAssetTypesForMode, getPrimaryAssetType,
    updateModelOpacity, updateModelWireframe, updateModelTextures, updateModelMatcap, updateModelNormals,
    updateModelRoughness, updateModelMetalness, updateModelSpecularF0,
    updatePointcloudPointSize, updatePointcloudOpacity,
    loadSplatFromFile, loadSplatFromUrl,
    loadModelFromFile, loadModelFromUrl,
    loadPointcloudFromFile, loadPointcloudFromUrl,
    loadArchiveFullResMesh, loadArchiveFullResSplat,
    loadArchiveProxyMesh, loadArchiveProxySplat
} from './file-handlers.js';
import {
    showMetadataSidebar, hideMetadataSidebar, switchSidebarMode,
    setupMetadataSidebar, prefillMetadataFromArchive,
    populateMetadataDisplay, updateArchiveMetadataUI,
    showAnnotationPopup, hideAnnotationPopup, updateAnnotationPopupPosition
} from './metadata-manager.js';
import { loadTheme } from './theme-loader.js';
import { ArchiveLoader } from './archive-loader.js';

const log = Logger.getLogger('kiosk-main');

// =============================================================================
// MANIFEST NORMALIZATION
// =============================================================================

/** Convert a camelCase string to snake_case */
function camelToSnake(str) {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/** Recursively convert all object keys from camelCase to snake_case */
function deepSnakeKeys(obj) {
    if (Array.isArray(obj)) return obj.map(deepSnakeKeys);
    if (obj !== null && typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[camelToSnake(key)] = deepSnakeKeys(value);
        }
        return result;
    }
    return obj;
}

/**
 * Normalize a manifest to canonical snake_case keys and lift common fields.
 * Handles manifests created with either camelCase or snake_case conventions.
 */
function normalizeManifest(raw) {
    const m = deepSnakeKeys(raw);
    // Lift project fields to top level for convenient access
    if (m.project) {
        if (m.project.title && !m.title) m.title = m.project.title;
        if (m.project.description && !m.description) m.description = m.project.description;
        if (m.project.license && !m.license) m.license = m.project.license;
    }
    return m;
}

// =============================================================================
// MODULE STATE
// =============================================================================

let sceneManager = null;
let scene, camera, renderer, controls, modelGroup, pointcloudGroup;
let flyControls = null;
let annotationSystem = null;
let splatMesh = null;
let fpsElement = null;
let currentPopupAnnotationId = null;
let annotationLineEl = null;
let entryTransitionActive = false;
let currentSheetSnap = 'peek'; // 'peek' | 'half' | 'full'

const state = {
    displayMode: 'both',
    controlsVisible: false,
    splatLoaded: false,
    modelLoaded: false,
    pointcloudLoaded: false,
    archiveLoaded: false,
    archiveLoader: null,
    archiveManifest: null,
    archiveFileName: null,
    currentArchiveUrl: null,
    currentSplatUrl: null,
    currentModelUrl: null,
    flyModeActive: false,
    annotationsVisible: true,
    assetStates: { splat: ASSET_STATE.UNLOADED, mesh: ASSET_STATE.UNLOADED, pointcloud: ASSET_STATE.UNLOADED },
    imageAssets: new Map(),
    qualityTier: QUALITY_TIER.AUTO,
    qualityResolved: QUALITY_TIER.HD
};

// =============================================================================
// FILE FORMAT CLASSIFICATION
// =============================================================================

const FILE_CATEGORIES = {
    archive:    ['.a3d', '.a3z'],
    model:      ['.glb', '.gltf', '.obj', '.stl'],
    splat:      ['.ply', '.splat', '.ksplat', '.spz', '.sog'],
    pointcloud: ['.e57']
};
const ALL_SUPPORTED_EXTENSIONS = Object.values(FILE_CATEGORIES).flat();

/**
 * Classify a filename into its asset category.
 * @param {string} filename
 * @returns {'splat'|'model'|'pointcloud'|'archive'|null}
 */
function classifyFile(filename) {
    const ext = '.' + filename.split('.').pop().toLowerCase();
    for (const [category, extensions] of Object.entries(FILE_CATEGORIES)) {
        if (extensions.includes(ext)) return category;
    }
    return null;
}

// =============================================================================
// INITIALIZATION
// =============================================================================

export async function init() {
    log.info('Kiosk viewer initializing...');
    document.body.classList.add('kiosk-mode');

    const canvas = document.getElementById('viewer-canvas');
    const canvasRight = document.getElementById('viewer-canvas-right');

    sceneManager = new SceneManager();
    if (!sceneManager.init(canvas, canvasRight)) {
        log.error('Scene initialization failed');
        return;
    }

    // Extract scene objects for local use
    scene = sceneManager.scene;
    camera = sceneManager.camera;
    renderer = sceneManager.renderer;
    controls = sceneManager.controls;
    modelGroup = sceneManager.modelGroup;
    pointcloudGroup = sceneManager.pointcloudGroup;
    fpsElement = document.getElementById('fps-counter');

    // Disable transform controls (viewer only)
    sceneManager.detachTransformControls();

    // Create fly controls
    flyControls = new FlyControls(camera, renderer.domElement);

    // Create annotation system
    annotationSystem = new AnnotationSystem(scene, camera, renderer, controls);
    annotationSystem.onAnnotationSelected = (annotation) => {
        if (currentPopupAnnotationId === annotation.id) {
            if (isMobileKiosk()) {
                hideMobileAnnotationDetail();
                setSheetSnap('peek');
            } else {
                hideAnnotationPopup();
                hideAnnotationLine();
            }
            currentPopupAnnotationId = null;
            annotationSystem.selectedAnnotation = null;
            document.querySelectorAll('.annotation-marker.selected').forEach(m => m.classList.remove('selected'));
            document.querySelectorAll('.kiosk-anno-item.active').forEach(c => c.classList.remove('active'));
            // Clear editorial sequence highlight
            document.querySelectorAll('.editorial-anno-seq-num.active').forEach(n => n.classList.remove('active'));
            return;
        }
        // Highlight the corresponding sidebar item
        document.querySelectorAll('.kiosk-anno-item.active').forEach(c => c.classList.remove('active'));
        const item = document.querySelector(`.kiosk-anno-item[data-anno-id="${annotation.id}"]`);
        if (item) item.classList.add('active');

        // Highlight editorial sequence number
        document.querySelectorAll('.editorial-anno-seq-num.active').forEach(n => n.classList.remove('active'));
        const seqNum = document.querySelector(`.editorial-anno-seq-num[data-anno-id="${annotation.id}"]`);
        if (seqNum) seqNum.classList.add('active');

        if (isMobileKiosk()) {
            currentPopupAnnotationId = annotation.id;
            showMobileAnnotationInSheet(annotation.id);
        } else {
            currentPopupAnnotationId = showAnnotationPopup(annotation, state.imageAssets);
        }
    };

    // Load theme and determine layout
    const config = window.APP_CONFIG || {};
    const themeMeta = await loadTheme(config.theme, { layoutOverride: config.layout || undefined });

    // ?layout= overrides theme's @layout; theme overrides default 'sidebar'
    const requestedLayout = config.layout || themeMeta.layout || 'sidebar';

    // Only commit to editorial if the layout module is actually available
    const hasEditorialModule = requestedLayout === 'editorial' && themeMeta.layoutModule;
    const layoutStyle = hasEditorialModule ? 'editorial' : (requestedLayout === 'editorial' ? 'sidebar' : requestedLayout);
    const isEditorial = layoutStyle === 'editorial';

    // Store resolved layout for other code paths
    config._resolvedLayout = layoutStyle;
    config._themeMeta = themeMeta;

    if (isEditorial) {
        document.body.classList.add('kiosk-editorial');
        log.info('Editorial layout enabled');

        // Let editorial layout customize loading screen before any archive loading
        if (themeMeta.layoutModule?.initLoadingScreen) {
            const overlay = document.getElementById('loading-overlay');
            if (overlay) {
                themeMeta.layoutModule.initLoadingScreen(overlay, {
                    themeAssets: themeMeta.themeAssets || {},
                    themeBaseUrl: `themes/${config.theme}/`
                });
            }
        }

        // Let editorial layout customize click gate
        if (themeMeta.layoutModule?.initClickGate) {
            const gate = document.getElementById('kiosk-click-gate');
            if (gate) {
                themeMeta.layoutModule.initClickGate(gate, {
                    themeAssets: themeMeta.themeAssets || {},
                    themeBaseUrl: `themes/${config.theme}/`
                });
            }
        }
        // Let editorial layout customize file picker
        if (themeMeta.layoutModule?.initFilePicker) {
            const picker = document.getElementById('kiosk-file-picker');
            if (picker) {
                themeMeta.layoutModule.initFilePicker(picker, {
                    themeAssets: themeMeta.themeAssets || {},
                    themeBaseUrl: `themes/${config.theme}/`
                });
            }
        }
    } else if (requestedLayout === 'editorial' && !hasEditorialModule) {
        log.warn('Editorial layout requested but no layout module available — using sidebar');
    }

    // Wire up UI
    setupViewerUI();
    // Always set up sidebar (editorial hides it via CSS but needs it as mobile fallback)
    setupMetadataSidebar({ state, annotationSystem, imageAssets: state.imageAssets });
    setupCollapsibles();
    setupViewerKeyboardShortcuts();

    // Apply initial display mode from config
    if (config.initialViewMode) {
        state.displayMode = config.initialViewMode;
    }
    setDisplayMode(state.displayMode, createDisplayModeDeps());

    // Hide editor-only UI
    hideEditorOnlyUI();

    // Handle window resize
    window.addEventListener('resize', onWindowResize);

    // Setup mobile bottom sheet drag (always — editorial uses sidebar as mobile fallback)
    setupBottomSheetDrag();
    if (isMobileKiosk()) setSheetSnap('peek');

    // Start render loop
    animate();

    // Show file picker overlay
    setupFilePicker();

    log.info('Kiosk viewer ready');
}

// =============================================================================
// FILE PICKER
// =============================================================================

function setupFilePicker() {
    const picker = document.getElementById('kiosk-file-picker');

    // Check for URL-based archive loading (e.g. ?kiosk=true&archive=URL)
    const config = window.APP_CONFIG || {};
    if (config.defaultArchiveUrl) {
        if (config.autoload === false) {
            showClickGate(config.defaultArchiveUrl);
            return;
        }

        // In Tauri, read local archive directly from filesystem (no HTTP fetch)
        if (window.__TAURI__) {
            log.info('Tauri: loading archive directly from filesystem:', config.defaultArchiveUrl);
            loadArchiveFromTauri(config.defaultArchiveUrl);
            return;
        }

        log.info('Loading archive from URL:', config.defaultArchiveUrl);
        loadArchiveFromUrl(config.defaultArchiveUrl);
        return;
    }

    // Check for direct file URL params (e.g. ?kiosk=true&splat=URL or ?model=URL)
    const hasDirectUrl = config.defaultSplatUrl || config.defaultModelUrl || config.defaultPointcloudUrl;
    if (hasDirectUrl) {
        log.info('Loading direct files from URL params');
        loadDirectFilesFromUrls(config);
        return;
    }

    if (picker) picker.classList.remove('hidden');

    const btn = document.getElementById('kiosk-picker-btn');
    const input = document.getElementById('kiosk-picker-input');
    const dropZone = document.getElementById('kiosk-drop-zone');

    if (btn && input) {
        // In Tauri, use native OS file dialog instead of browser file input
        if (window.__TAURI__) {
            btn.addEventListener('click', async () => {
                try {
                    const { openFileDialog } = await import('./tauri-bridge.js');
                    const files = await openFileDialog({ filterKey: 'all', multiple: false });
                    if (files && files.length > 0) {
                        handlePickedFiles(files, picker);
                    }
                } catch (err) {
                    log.warn('Native file dialog failed, falling back to browser input:', err.message);
                    input.click();
                }
            });
        } else {
            btn.addEventListener('click', () => input.click());
        }
        // Browser file input still needed as fallback
        input.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                handlePickedFiles(e.target.files, picker);
            }
        });
    }

    if (dropZone) {
        dropZone.addEventListener('dragover', (e) => {
            e.preventDefault();
            dropZone.classList.add('drag-over');
        });
        dropZone.addEventListener('dragleave', () => {
            dropZone.classList.remove('drag-over');
        });
        dropZone.addEventListener('drop', (e) => {
            e.preventDefault();
            dropZone.classList.remove('drag-over');
            if (e.dataTransfer.files.length > 0) {
                handlePickedFiles(e.dataTransfer.files, picker);
            }
        });
    }

    function hidePicker() {
        if (picker) picker.classList.add('hidden');
    }
}

// =============================================================================
// DIRECT FILE LOADING (non-archive)
// =============================================================================

/**
 * Route picked/dropped files to the correct loader.
 * Handles: archives, direct splats, models (with OBJ+MTL), point clouds.
 */
function handlePickedFiles(fileList, pickerElement) {
    const files = Array.from(fileList);
    const mainFile = files[0];
    const category = classifyFile(mainFile.name);

    if (!category) {
        const ext = mainFile.name.split('.').pop();
        notify.warning(`Unsupported file format: .${ext}`);
        return;
    }

    // Hide picker
    if (pickerElement) pickerElement.classList.add('hidden');

    if (category === 'archive') {
        state.archiveSourceUrl = null;
        handleArchiveFile(mainFile);
        return;
    }

    // Direct file loading
    handleDirectFile(mainFile, category, files);
}

/**
 * Load a single direct (non-archive) file into the kiosk viewer.
 * @param {File} mainFile - The primary file
 * @param {'splat'|'model'|'pointcloud'} category - Detected category
 * @param {File[]} allFiles - All dropped files (for OBJ+MTL pairs)
 */
async function handleDirectFile(mainFile, category, allFiles) {
    log.info(`Loading direct ${category} file:`, mainFile.name);
    showLoading(`Loading ${category}...`, true);

    try {
        updateProgress(20, `Loading ${mainFile.name}...`);

        if (category === 'splat') {
            await loadSplatFromFile(mainFile, createSplatDeps());
        } else if (category === 'model') {
            await loadModelFromFile(allFiles || [mainFile], createModelDeps());
        } else if (category === 'pointcloud') {
            await loadPointcloudFromFile(mainFile, createPointcloudDeps());
        }

        updateProgress(80, 'Finalizing...');
        onDirectFileLoaded(mainFile.name);
    } catch (err) {
        log.error(`Failed to load ${category}:`, err);
        hideLoading();
        notify.error(`Failed to load ${category}: ${err.message}`);
        // Show picker again for retry
        const picker = document.getElementById('kiosk-file-picker');
        if (picker) picker.classList.remove('hidden');
    }
}

/**
 * Load direct files from URL params (?splat=, ?model=, ?pointcloud=).
 */
async function loadDirectFilesFromUrls(config) {
    showLoading('Loading 3D data...', true);

    try {
        if (config.defaultSplatUrl) {
            updateProgress(10, 'Loading splat...');
            await loadSplatFromUrl(config.defaultSplatUrl, createSplatDeps(), (received, totalBytes) => {
                if (totalBytes > 0) {
                    const pct = Math.round((received / totalBytes) * 100);
                    updateProgress(pct * 0.3, `Downloading splat... ${(received / 1048576).toFixed(1)} MB`);
                }
            });
        }

        if (config.defaultModelUrl) {
            updateProgress(40, 'Loading model...');
            await loadModelFromUrl(config.defaultModelUrl, createModelDeps(), (received, totalBytes) => {
                if (totalBytes > 0) {
                    const pct = Math.round((received / totalBytes) * 100);
                    updateProgress(40 + pct * 0.3, `Downloading model... ${(received / 1048576).toFixed(1)} MB`);
                }
            });
        }

        if (config.defaultPointcloudUrl) {
            updateProgress(70, 'Loading point cloud...');
            await loadPointcloudFromUrl(config.defaultPointcloudUrl, createPointcloudDeps(), (received, totalBytes) => {
                if (totalBytes > 0) {
                    const pct = Math.round((received / totalBytes) * 100);
                    updateProgress(70 + pct * 0.2, `Downloading point cloud... ${(received / 1048576).toFixed(1)} MB`);
                }
            });
        }

        // Apply inline alignment if provided via URL params (?sp=, ?sr=, ?ss=, ?mp=, etc.)
        if (config.inlineAlignment) {
            const alignment = config.inlineAlignment;
            if (alignment.splat && splatMesh) {
                if (alignment.splat.position) splatMesh.position.fromArray(alignment.splat.position);
                if (alignment.splat.rotation) splatMesh.rotation.set(...alignment.splat.rotation);
                if (alignment.splat.scale != null) splatMesh.scale.setScalar(alignment.splat.scale);
            }
            if (alignment.model && modelGroup) {
                if (alignment.model.position) modelGroup.position.fromArray(alignment.model.position);
                if (alignment.model.rotation) modelGroup.rotation.set(...alignment.model.rotation);
                if (alignment.model.scale != null) modelGroup.scale.setScalar(alignment.model.scale);
            }
            if (alignment.pointcloud && pointcloudGroup) {
                if (alignment.pointcloud.position) pointcloudGroup.position.fromArray(alignment.pointcloud.position);
                if (alignment.pointcloud.rotation) pointcloudGroup.rotation.set(...alignment.pointcloud.rotation);
                if (alignment.pointcloud.scale != null) pointcloudGroup.scale.setScalar(alignment.pointcloud.scale);
            }
        }

        updateProgress(90, 'Finalizing...');
        onDirectFileLoaded(null);
    } catch (err) {
        log.error('Failed to load from URLs:', err);
        hideLoading();
        notify.error(`Failed to load: ${err.message}`);
        const picker = document.getElementById('kiosk-file-picker');
        if (picker) picker.classList.remove('hidden');
    }
}

/**
 * Post-load UI setup for direct (non-archive) file loading.
 * Simplified version of the post-archive flow — no manifest, no branded loading,
 * no annotations, no metadata.
 */
function onDirectFileLoaded(fileName) {
    // Set display mode based on what loaded
    if (state.modelLoaded) {
        state.displayMode = 'model';
    } else if (state.splatLoaded) {
        state.displayMode = 'splat';
    } else if (state.pointcloudLoaded) {
        state.displayMode = 'pointcloud';
    }
    setDisplayMode(state.displayMode, createDisplayModeDeps());

    // Show only relevant settings sections
    showRelevantSettings(state.splatLoaded, state.modelLoaded, state.pointcloudLoaded);

    // Fit camera to loaded content
    fitCameraToScene();

    // Enable shadows for models
    if (state.modelLoaded) {
        sceneManager.enableShadows(true);
        sceneManager.applyShadowProperties(modelGroup);
    }

    // Enable auto-rotate
    controls.autoRotate = true;
    const autoRotateBtn = document.getElementById('btn-auto-rotate');
    if (autoRotateBtn) autoRotateBtn.classList.add('active');

    // Branch UI setup based on resolved layout (theme + ?layout= override)
    const isEditorial = (window.APP_CONFIG || {})._resolvedLayout === 'editorial';

    if (isEditorial) {
        // Delegate to theme's layout module — it creates its own ribbon/toolbar
        const appConfig = window.APP_CONFIG || {};
        const layoutModule = appConfig._themeMeta && appConfig._themeMeta.layoutModule;
        if (layoutModule && layoutModule.setup) {
            layoutModule.setup(null, createLayoutDeps());
        }
        // View switcher as mobile fallback (hidden on desktop by editorial CSS)
        createViewSwitcher();
    } else {
        // Standard kiosk UI
        createViewSwitcher();

        // Show toolbar
        const toolbar = document.getElementById('left-toolbar');
        if (toolbar) toolbar.style.display = 'flex';
    }

    // Set filename as display title if available
    if (fileName) {
        const displayTitle = document.getElementById('display-title');
        if (displayTitle) displayTitle.textContent = fileName;
    }

    updateProgress(100, 'Complete');
    smoothTransitionIn();

    log.info('Direct file loaded:', fileName || '(from URL)');
    notify.success(`Loaded: ${fileName || 'file from URL'}`);
}

// =============================================================================
// CLICK GATE
// =============================================================================

/**
 * Show click-to-load overlay with poster extracted from archive via Range requests.
 * Only downloads the ZIP central directory + thumbnail (~100KB), not the full archive.
 */
async function showClickGate(archiveUrl) {
    const gate = document.getElementById('kiosk-click-gate');
    if (!gate) {
        log.warn('Click gate element not found, falling back to auto-load');
        loadArchiveFromUrl(archiveUrl);
        return;
    }

    // Try to extract poster and metadata from archive via Range requests
    try {
        const loader = new ArchiveLoader();
        await loader.loadRemoteIndex(archiveUrl);

        // Parse manifest for title + content types
        const manifest = await loader.parseManifest();
        const contentInfo = loader.getContentInfo();

        // Set title
        const titleEl = document.getElementById('kiosk-gate-title');
        const title = manifest?.project?.title || manifest?._meta?.title || '';
        if (titleEl && title) titleEl.textContent = title;

        // Extract thumbnail for poster
        const thumbEntry = loader.getThumbnailEntry();
        if (thumbEntry) {
            const thumbData = await loader.extractFile(thumbEntry.file_name);
            if (thumbData) {
                const posterImg = document.getElementById('kiosk-gate-poster');
                if (posterImg) posterImg.src = thumbData.url;
            }
        }

        // Show content types
        const typesEl = document.getElementById('kiosk-gate-types');
        const types = [];
        if (contentInfo.hasSplat) types.push('Gaussian Splat');
        if (contentInfo.hasMesh) types.push('Mesh');
        if (contentInfo.hasPointcloud) types.push('Point Cloud');
        if (typesEl && types.length) typesEl.textContent = types.join(' + ');

        loader.dispose();
    } catch (e) {
        log.warn('Could not extract poster via Range requests:', e.message);
        // Fallback: generic play button without poster (still functional)
    }

    gate.classList.remove('hidden');

    // Click anywhere on the gate to start full download
    gate.addEventListener('click', () => {
        gate.classList.add('hidden');
        log.info('Click gate dismissed, loading archive:', archiveUrl);
        loadArchiveFromUrl(archiveUrl);
    }, { once: true });
}

async function loadArchiveFromUrl(url) {
    showLoading('Downloading archive...', true);
    try {
        const blob = await fetchWithProgress(url, (received, total) => {
            if (total > 0) {
                const pct = Math.round((received / total) * 100);
                const mb = (received / (1024 * 1024)).toFixed(1);
                const totalMb = (total / (1024 * 1024)).toFixed(1);
                updateProgress(pct, `Downloading... ${mb} / ${totalMb} MB`);
            } else {
                const mb = (received / (1024 * 1024)).toFixed(1);
                updateProgress(0, `Downloading... ${mb} MB`);
            }
        });
        const fileName = url.split('/').pop().split('?')[0] || 'archive.a3d';
        const file = new File([blob], fileName, { type: blob.type });
        state.archiveSourceUrl = url;
        handleArchiveFile(file);
    } catch (err) {
        log.error('Failed to load archive from URL:', err);
        hideLoading();
        notify.error(`Failed to load archive: ${err.message}`);
        // Fall back to showing file picker
        const picker = document.getElementById('kiosk-file-picker');
        if (picker) picker.classList.remove('hidden');
    }
}

/**
 * Load an archive directly from the local filesystem via Tauri FS plugin.
 * Bypasses HTTP fetch entirely — no "Downloading..." phase.
 * @param {string} filePath - Local filesystem path to the archive
 */
async function loadArchiveFromTauri(filePath) {
    showLoading('Loading archive...', true);
    try {
        const { readFile } = window.__TAURI__.fs;
        updateProgress(5, 'Reading file...');
        const contents = await readFile(filePath);
        const fileName = filePath.split(/[\\/]/).pop() || 'archive.a3d';
        const file = new File([contents], fileName);
        state.archiveSourceUrl = null;
        handleArchiveFile(file);
    } catch (err) {
        log.error('Failed to load archive from filesystem:', err);
        hideLoading();
        notify.error(`Failed to load archive: ${err.message}`);
        const picker = document.getElementById('kiosk-file-picker');
        if (picker) picker.classList.remove('hidden');
    }
}

// =============================================================================
// ARCHIVE PROCESSING
// =============================================================================

// Ensure a single archive asset type is loaded on demand (kiosk version).
async function ensureAssetLoaded(assetType) {
    if (!state.archiveLoader) return false;

    if (state.assetStates[assetType] === ASSET_STATE.LOADED) return true;
    if (state.assetStates[assetType] === ASSET_STATE.ERROR) return false;
    if (state.assetStates[assetType] === ASSET_STATE.LOADING) {
        return new Promise(resolve => {
            const check = () => {
                if (state.assetStates[assetType] === ASSET_STATE.LOADED) resolve(true);
                else if (state.assetStates[assetType] === ASSET_STATE.ERROR) resolve(false);
                else setTimeout(check, 50);
            };
            check();
        });
    }

    showInlineLoading(assetType);
    try {
        const result = await loadArchiveAsset(state.archiveLoader, assetType, createArchiveDeps());
        if (result.loaded) {
            if (assetType === 'splat') state.splatLoaded = true;
            else if (assetType === 'mesh') state.modelLoaded = true;
            else if (assetType === 'pointcloud') state.pointcloudLoaded = true;
        }
        return result.loaded;
    } catch (e) {
        log.error(`Error loading ${assetType}:`, e);
        state.assetStates[assetType] = ASSET_STATE.ERROR;
        return false;
    } finally {
        hideInlineLoading(assetType);
    }
}

// Trigger lazy loading of assets needed for a display mode
function triggerLazyLoad(mode) {
    if (!state.archiveLoaded || !state.archiveLoader) return;
    const neededTypes = getAssetTypesForMode(mode);
    for (const type of neededTypes) {
        if (state.assetStates[type] === ASSET_STATE.UNLOADED) {
            ensureAssetLoaded(type).then(loaded => {
                if (loaded) {
                    const deps = createDisplayModeDeps();
                    if (deps.updateVisibility) deps.updateVisibility();
                }
            });
        }
    }
}

async function handleArchiveFile(file) {
    log.info('Loading archive:', file.name);
    showLoading('Loading archive...', true);

    try {
        // === Phase 1: Read file + index ZIP directory (no decompression) ===
        updateProgress(5, 'Reading archive...');
        const archiveLoader = await loadArchiveFromFile(file, { state });

        // Reset asset states for new archive
        state.assetStates = { splat: ASSET_STATE.UNLOADED, mesh: ASSET_STATE.UNLOADED, pointcloud: ASSET_STATE.UNLOADED };

        // Parse manifest + extract thumbnail (small files only)
        updateProgress(15, 'Reading metadata...');
        const phase1 = await processArchivePhase1(archiveLoader, file.name, { state });
        const { contentInfo } = phase1;
        const manifest = normalizeManifest(phase1.manifest);

        // Resolve quality tier based on device capabilities
        const glContext = renderer ? renderer.getContext() : null;
        state.qualityResolved = resolveQualityTier(state.qualityTier, glContext);
        log.info('Quality tier resolved:', state.qualityResolved);

        // Show branded loading screen with thumbnail, title, and content types
        await showBrandedLoading(archiveLoader);

        // === Phase 2: Load primary asset for initial display ===
        // Set intended display mode early so getPrimaryAssetType loads the right asset first
        if (contentInfo.hasMesh) {
            state.displayMode = 'model';
        } else if (contentInfo.hasSplat) {
            state.displayMode = 'splat';
        } else if (contentInfo.hasPointcloud) {
            state.displayMode = 'pointcloud';
        }
        updateProgress(30, 'Loading 3D data...');
        const primaryType = getPrimaryAssetType(state.displayMode, contentInfo);
        const primaryLoaded = await ensureAssetLoaded(primaryType);

        if (!primaryLoaded) {
            // Try any available type as fallback
            const fallbackTypes = ['splat', 'mesh', 'pointcloud'].filter(t => t !== primaryType);
            let anyLoaded = false;
            for (const type of fallbackTypes) {
                if (await ensureAssetLoaded(type)) { anyLoaded = true; break; }
            }
            if (!anyLoaded) {
                hideLoading();
                notify.warning('Archive does not contain any viewable content.');
                return;
            }
        }

        // Apply global alignment if present
        const globalAlignment = archiveLoader.getGlobalAlignment();
        if (globalAlignment) {
            applyGlobalAlignment(globalAlignment);
        }

        // Load annotations
        const annotations = archiveLoader.getAnnotations();
        if (annotations && annotations.length > 0) {
            annotationSystem.fromJSON(annotations);
            populateAnnotationList();
            log.info(`Loaded ${annotations.length} annotations`);
        }

        // Extract embedded images for markdown rendering
        state.imageAssets.clear();
        const imageEntries = archiveLoader.getImageEntries();
        for (const entry of imageEntries) {
            try {
                const data = await archiveLoader.extractFile(entry.file_name);
                if (data) {
                    state.imageAssets.set(entry.file_name, { blob: data.blob, url: data.url, name: entry.file_name });
                }
            } catch (e) {
                log.warn('Failed to extract image:', entry.file_name, e.message);
            }
        }
        if (imageEntries.length > 0) {
            log.info(`Extracted ${state.imageAssets.size} embedded images`);
        }

        // Update metadata display
        updateProgress(80, 'Loading metadata...');
        updateArchiveMetadataUI(manifest, archiveLoader);
        prefillMetadataFromArchive(manifest);
        populateMetadataDisplay({ state, annotationSystem, imageAssets: state.imageAssets });

        // In kiosk/offline mode the edit form fields (#meta-title etc.) are stripped,
        // so populateMetadataDisplay reads empty values from collectMetadata().
        // Override display fields directly from the manifest.
        const displayTitle = document.getElementById('display-title');
        if (displayTitle && manifest.project?.title) displayTitle.textContent = manifest.project.title;
        const displayDesc = document.getElementById('display-description');
        if (displayDesc && manifest.project?.description) {
            displayDesc.innerHTML = parseMarkdown(resolveAssetRefs(manifest.project.description, state.imageAssets));
            displayDesc.style.display = '';
        }
        const displayCreator = document.getElementById('display-creator');
        const displayCreatorRow = document.getElementById('display-creator-row');
        if (displayCreator && displayCreatorRow && manifest.provenance?.operator) {
            displayCreator.textContent = manifest.provenance.operator;
            displayCreatorRow.style.display = '';
        }
        const displayDate = document.getElementById('display-date');
        const displayDateRow = document.getElementById('display-date-row');
        if (displayDate && displayDateRow && manifest.provenance?.captureDate) {
            const d = new Date(manifest.provenance.captureDate);
            displayDate.textContent = isNaN(d.getTime()) ? manifest.provenance.captureDate : d.toLocaleDateString();
            displayDateRow.style.display = '';
        }
        const displayLocation = document.getElementById('display-location');
        const displayLocationRow = document.getElementById('display-location-row');
        if (displayLocation && displayLocationRow && manifest.provenance?.location) {
            displayLocation.textContent = manifest.provenance.location;
            displayLocationRow.style.display = '';
        }

        populateDetailedMetadata(manifest);
        populateSourceFilesList(archiveLoader);
        reorderKioskSidebar();

        // Set display mode: default to model, fall back to splat, then pointcloud
        updateProgress(90, 'Finalizing...');
        if (state.modelLoaded) {
            state.displayMode = 'model';
        } else if (state.splatLoaded) {
            state.displayMode = 'splat';
        } else if (state.pointcloudLoaded) {
            state.displayMode = 'pointcloud';
        }
        setDisplayMode(state.displayMode, createDisplayModeDeps());

        // Show only relevant settings
        showRelevantSettings(state.splatLoaded, state.modelLoaded, state.pointcloudLoaded);

        // Fit camera to loaded content
        fitCameraToScene();

        // Enable shadows in kiosk mode
        sceneManager.enableShadows(true);
        sceneManager.applyShadowProperties(modelGroup);

        // Enable auto-rotate by default in kiosk mode
        controls.autoRotate = true;
        const autoRotateBtn = document.getElementById('btn-auto-rotate');
        if (autoRotateBtn) autoRotateBtn.classList.add('active');

        // Branch UI setup based on resolved layout (theme + ?layout= override)
        const isEditorial = (window.APP_CONFIG || {})._resolvedLayout === 'editorial';

        if (isEditorial) {
            // Delegate to theme's layout module
            const appConfig = window.APP_CONFIG || {};
            const layoutModule = (appConfig._themeMeta && appConfig._themeMeta.layoutModule);
            layoutModule.setup(manifest, createLayoutDeps());

            // Also populate the sidebar content as a mobile fallback
            // (editorial CSS hides it on desktop, media query shows it on mobile)
            createViewSwitcher();
            updateInfoPanel();
        } else {
            // Sidebar layout: standard kiosk UI
            createViewSwitcher();
            updateInfoPanel();

            const archiveSection = document.getElementById('archive-metadata-section');
            if (archiveSection) archiveSection.style.display = '';
        }

        // Apply viewer settings from manifest (after theme, so these override theme defaults)
        if (manifest.viewer_settings) {
            if (manifest.viewer_settings.single_sided !== undefined) {
                const side = manifest.viewer_settings.single_sided ? THREE.FrontSide : THREE.DoubleSide;
                if (modelGroup) {
                    modelGroup.traverse(child => {
                        if (child.isMesh && child.material) {
                            const mats = Array.isArray(child.material) ? child.material : [child.material];
                            mats.forEach(m => { m.side = side; m.needsUpdate = true; });
                        }
                    });
                }
            }
            if (manifest.viewer_settings.background_color && scene) {
                scene.background = new THREE.Color(manifest.viewer_settings.background_color);
            }
            log.info('Applied viewer settings:', manifest.viewer_settings);
        }

        updateProgress(100, 'Complete');

        // Smooth entry transition: fade overlay + camera ease-in
        smoothTransitionIn();

        if (isEditorial) {
            // Populate sidebar content for mobile fallback (hidden on desktop by CSS)
            showMetadataSidebar('view', { state, annotationSystem, imageAssets: state.imageAssets });
            populateAnnotationList();
        } else {
            // Show toolbar now that archive is loaded
            const toolbar = document.getElementById('left-toolbar');
            if (toolbar) toolbar.style.display = 'flex';

            // Add export section to settings tab now that archive data is available
            createExportSection();

            // Show annotation toggle button if annotations exist, active by default
            if (annotationSystem.hasAnnotations()) {
                const annoBtn = document.getElementById('btn-toggle-annotations');
                if (annoBtn) {
                    annoBtn.style.display = '';
                    annoBtn.classList.add('active');
                }
                // Trigger intro glow on markers
                triggerMarkerGlowIntro();
            }

            // Open metadata sidebar by default
            showMetadataSidebar('view', { state, annotationSystem, imageAssets: state.imageAssets });
        }

        // Show quality toggle if archive has any proxies (editorial handles its own)
        if (hasAnyProxy(contentInfo) && !isEditorial) {
            showQualityToggle();
        }

        log.info('Archive loaded successfully:', file.name);
        notify.success(`Loaded: ${file.name}`);

        // === Phase 3: Background-load remaining assets ===
        const remainingTypes = ['splat', 'mesh', 'pointcloud'].filter(
            t => state.assetStates[t] === ASSET_STATE.UNLOADED
        );
        if (remainingTypes.length > 0) {
            setTimeout(async () => {
                for (const type of remainingTypes) {
                    const typeAvailable = (type === 'splat' && contentInfo.hasSplat) ||
                                          (type === 'mesh' && contentInfo.hasMesh) ||
                                          (type === 'pointcloud' && contentInfo.hasPointcloud);
                    if (typeAvailable) {
                        log.info(`Background loading: ${type}`);
                        await ensureAssetLoaded(type);
                        // Update settings visibility after background load
                        showRelevantSettings(state.splatLoaded, state.modelLoaded, state.pointcloudLoaded);
                        // Re-apply viewer settings to newly loaded meshes
                        if (type === 'mesh' && manifest.viewer_settings?.single_sided !== undefined) {
                            const side = manifest.viewer_settings.single_sided ? THREE.FrontSide : THREE.DoubleSide;
                            modelGroup.traverse(child => {
                                if (child.isMesh && child.material) {
                                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                                    mats.forEach(m => { m.side = side; m.needsUpdate = true; });
                                }
                            });
                        }
                    }
                }
                // Keep archive data available for export downloads
                log.info('All archive assets loaded, raw data retained for export');
            }, 100);
        } else {
            log.info('Archive data retained for export');
        }

    } catch (e) {
        log.error('Error loading archive:', e);
        hideLoading();
        notify.error(`Failed to load archive: ${e.message}`);
        // Show picker again so user can retry
        const picker = document.getElementById('kiosk-file-picker');
        if (picker) picker.classList.remove('hidden');
    }
}

// =============================================================================
// QUALITY TIER TOGGLE
// =============================================================================

/**
 * Show the SD/HD quality toggle. Uses existing HTML element if present,
 * otherwise creates one dynamically (for kiosk/editorial without index.html).
 */
function showQualityToggle() {
    let container = document.getElementById('quality-toggle-container');
    if (!container) {
        // Dynamically create toggle (kiosk offline HTML won't have it)
        container = document.createElement('div');
        container.id = 'quality-toggle-container';
        container.innerHTML = `
            <button class="quality-toggle-btn${state.qualityResolved === 'sd' ? ' active' : ''}" data-tier="sd">SD</button>
            <button class="quality-toggle-btn${state.qualityResolved === 'hd' ? ' active' : ''}" data-tier="hd">HD</button>
        `;
        document.body.appendChild(container);
    } else {
        container.classList.remove('hidden');
        // Set initial active state
        container.querySelectorAll('.quality-toggle-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.tier === state.qualityResolved);
        });
    }

    // Wire click handlers
    container.querySelectorAll('.quality-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => switchQualityTier(btn.dataset.tier));
    });
}

/**
 * Switch between SD and HD quality tiers, swapping proxy/full-res assets.
 */
async function switchQualityTier(newTier) {
    if (newTier === state.qualityResolved) return;
    state.qualityResolved = newTier;

    // Update button states
    document.querySelectorAll('.quality-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.tier === newTier);
        btn.classList.add('loading');
    });

    const archiveLoader = state.archiveLoader;
    if (!archiveLoader) return;

    const contentInfo = archiveLoader.getContentInfo();
    const deps = createArchiveDeps();

    try {
        // Switch splat if proxy exists
        if (contentInfo.hasSceneProxy) {
            if (newTier === 'hd') {
                await loadArchiveFullResSplat(archiveLoader, deps);
            } else {
                await loadArchiveProxySplat(archiveLoader, deps);
            }
        }
        // Switch mesh if proxy exists
        if (contentInfo.hasMeshProxy) {
            if (newTier === 'hd') {
                await loadArchiveFullResMesh(archiveLoader, deps);
            } else {
                await loadArchiveProxyMesh(archiveLoader, deps);
            }
        }
        log.info(`Quality tier switched to ${newTier}`);
    } catch (e) {
        log.error('Error switching quality tier:', e);
        notify.error(`Failed to switch quality: ${e.message}`);
    } finally {
        document.querySelectorAll('.quality-toggle-btn').forEach(btn => {
            btn.classList.remove('loading');
        });
    }
}

// =============================================================================
// DEPS BUILDERS (matching the deps pattern used by file-handlers.js)
// =============================================================================

function createArchiveDeps() {
    return {
        scene,
        modelGroup,
        pointcloudGroup,
        state,
        qualityTier: state.qualityResolved,
        getSplatMesh: () => splatMesh,
        setSplatMesh: (mesh) => { splatMesh = mesh; },
        callbacks: {
            onApplySplatTransform: (transform) => {
                if (!splatMesh || !transform) return;
                if (transform.position) {
                    splatMesh.position.set(transform.position[0], transform.position[1], transform.position[2]);
                }
                if (transform.rotation) {
                    splatMesh.rotation.set(transform.rotation[0], transform.rotation[1], transform.rotation[2]);
                }
                if (transform.scale != null) {
                    splatMesh.scale.setScalar(transform.scale);
                }
            },
            onApplyModelTransform: (transform) => {
                if (!modelGroup || !transform) return;
                if (transform.position) {
                    modelGroup.position.set(transform.position[0], transform.position[1], transform.position[2]);
                }
                if (transform.rotation) {
                    modelGroup.rotation.set(transform.rotation[0], transform.rotation[1], transform.rotation[2]);
                }
                if (transform.scale != null) {
                    modelGroup.scale.setScalar(transform.scale);
                }
            }
        }
    };
}

function createSplatDeps() {
    return {
        scene,
        getSplatMesh: () => splatMesh,
        setSplatMesh: (mesh) => { splatMesh = mesh; },
        state,
        archiveCreator: null,
        callbacks: {}
    };
}

function createModelDeps() {
    return {
        modelGroup,
        state,
        archiveCreator: null,
        callbacks: {}
    };
}

function createPointcloudDeps() {
    return {
        pointcloudGroup,
        state,
        archiveCreator: null,
        callbacks: {}
    };
}

function createDisplayModeDeps() {
    const canvasRight = document.getElementById('viewer-canvas-right');
    return {
        state,
        canvasRight,
        onResize: () => onWindowResize(),
        updateVisibility: () => {
            const showSplat = state.displayMode === 'splat' || state.displayMode === 'both' || state.displayMode === 'split';
            const showModel = state.displayMode === 'model' || state.displayMode === 'both' || state.displayMode === 'split';
            const showPointcloud = state.displayMode === 'pointcloud' || state.displayMode === 'both' || state.displayMode === 'split';
            if (splatMesh) splatMesh.visible = showSplat;
            if (modelGroup) modelGroup.visible = showModel;
            if (pointcloudGroup) pointcloudGroup.visible = showPointcloud;
        }
    };
}

/**
 * Build the dependency object for theme layout modules.
 * Layout modules receive everything via this object — no ES imports.
 */
function createLayoutDeps() {
    return {
        Logger,
        escapeHtml,
        parseMarkdown,
        resolveAssetRefs,
        updateModelTextures,
        updateModelWireframe,
        updateModelMatcap,
        updateModelNormals,
        updateModelRoughness,
        updateModelMetalness,
        updateModelSpecularF0,
        sceneManager,
        state,
        annotationSystem,
        modelGroup,
        setDisplayMode,
        createDisplayModeDeps,
        triggerLazyLoad,
        showAnnotationPopup,
        hideAnnotationPopup,
        hideAnnotationLine,
        getCurrentPopupId: () => currentPopupAnnotationId,
        setCurrentPopupId: (id) => { currentPopupAnnotationId = id; },
        themeBaseUrl: (window.APP_CONFIG?.theme) ? `themes/${window.APP_CONFIG.theme}/` : '',
        themeAssets: window.__KIOSK_THEME_ASSETS__ || {},
        hasAnyProxy: hasAnyProxy(state.archiveLoader ? state.archiveLoader.getContentInfo() : {}),
        qualityResolved: state.qualityResolved,
        switchQualityTier
    };
}

// =============================================================================
// UI SETUP
// =============================================================================

function setupViewerUI() {
    // Display mode buttons (with lazy loading trigger)
    ['model', 'splat', 'pointcloud', 'both', 'split'].forEach(mode => {
        addListener(`btn-${mode}`, 'click', () => {
            state.displayMode = mode;
            setDisplayMode(mode, createDisplayModeDeps());
            // Lazy-load any needed assets not yet loaded
            if (state.archiveLoaded && state.archiveLoader) {
                const neededTypes = getAssetTypesForMode(mode);
                for (const type of neededTypes) {
                    if (state.assetStates[type] === ASSET_STATE.UNLOADED) {
                        ensureAssetLoaded(type).then(loaded => {
                            if (loaded) {
                                const deps = createDisplayModeDeps();
                                if (deps.updateVisibility) deps.updateVisibility();
                            }
                        });
                    }
                }
            }
        });
    });

    // Fly mode toggle
    addListener('btn-fly-mode', 'click', toggleFlyMode);

    // Auto-rotate toggle
    addListener('btn-auto-rotate', 'click', () => {
        controls.autoRotate = !controls.autoRotate;
        const btn = document.getElementById('btn-auto-rotate');
        if (btn) btn.classList.toggle('active', controls.autoRotate);
    });

    // Disable auto-rotate on manual interaction so users can inspect freely
    controls.addEventListener('start', () => {
        if (controls.autoRotate) {
            controls.autoRotate = false;
            const btn = document.getElementById('btn-auto-rotate');
            if (btn) btn.classList.remove('active');
        }
    });

    // Metadata sidebar toggle
    addListener('btn-metadata', 'click', () => {
        const sidebar = document.getElementById('metadata-sidebar');
        if (sidebar && !sidebar.classList.contains('hidden')) {
            hideMetadataSidebar();
        } else {
            showMetadataSidebar('view', { state, annotationSystem, imageAssets: state.imageAssets });
            if (isMobileKiosk()) setSheetSnap('half');
        }
    });

    // Grid toggle
    addListener('toggle-gridlines', 'change', (e) => {
        sceneManager.toggleGrid(e.target.checked);
    });

    // Background color presets
    document.querySelectorAll('.color-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const color = btn.dataset.color;
            sceneManager.setBackgroundColor(color);
            document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const picker = document.getElementById('bg-color-picker');
            if (picker) picker.value = color;
        });
    });

    // Custom background color
    addListener('bg-color-picker', 'input', (e) => {
        sceneManager.setBackgroundColor(e.target.value);
        document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
    });

    // Model settings
    addListener('model-scale', 'input', (e) => {
        const val = parseFloat(e.target.value);
        if (modelGroup) modelGroup.scale.setScalar(val);
        const label = document.getElementById('model-scale-value');
        if (label) label.textContent = val.toFixed(1);
    });
    addListener('model-opacity', 'input', (e) => {
        const val = parseFloat(e.target.value);
        updateModelOpacity(modelGroup, val);
        const label = document.getElementById('model-opacity-value');
        if (label) label.textContent = val.toFixed(1);
    });
    addListener('model-wireframe', 'change', (e) => {
        if (e.target.checked) {
            const matcapCb = document.getElementById('model-matcap');
            if (matcapCb?.checked) {
                matcapCb.checked = false;
                const styleGroup = document.getElementById('matcap-style-group');
                if (styleGroup) styleGroup.style.display = 'none';
                updateModelMatcap(modelGroup, false);
            }
            const normalsCb = document.getElementById('model-normals');
            if (normalsCb?.checked) {
                normalsCb.checked = false;
                updateModelNormals(modelGroup, false);
            }
            const roughCb = document.getElementById('model-roughness');
            if (roughCb?.checked) { roughCb.checked = false; updateModelRoughness(modelGroup, false); }
            const metalCb = document.getElementById('model-metalness');
            if (metalCb?.checked) { metalCb.checked = false; updateModelMetalness(modelGroup, false); }
            const f0Cb = document.getElementById('model-specular-f0');
            if (f0Cb?.checked) { f0Cb.checked = false; updateModelSpecularF0(modelGroup, false); }
        }
        updateModelWireframe(modelGroup, e.target.checked);
    });
    addListener('model-matcap', 'change', (e) => {
        const styleGroup = document.getElementById('matcap-style-group');
        if (styleGroup) styleGroup.style.display = e.target.checked ? '' : 'none';
        if (e.target.checked) {
            const wireCb = document.getElementById('model-wireframe');
            if (wireCb?.checked) {
                wireCb.checked = false;
                updateModelWireframe(modelGroup, false);
            }
            const normalsCb = document.getElementById('model-normals');
            if (normalsCb?.checked) {
                normalsCb.checked = false;
                updateModelNormals(modelGroup, false);
            }
            const roughCb = document.getElementById('model-roughness');
            if (roughCb?.checked) { roughCb.checked = false; updateModelRoughness(modelGroup, false); }
            const metalCb = document.getElementById('model-metalness');
            if (metalCb?.checked) { metalCb.checked = false; updateModelMetalness(modelGroup, false); }
            const f0Cb = document.getElementById('model-specular-f0');
            if (f0Cb?.checked) { f0Cb.checked = false; updateModelSpecularF0(modelGroup, false); }
        }
        updateModelMatcap(modelGroup, e.target.checked, document.getElementById('matcap-style')?.value || 'clay');
    });
    addListener('matcap-style', 'change', (e) => {
        const matcapCb = document.getElementById('model-matcap');
        if (matcapCb?.checked) {
            updateModelMatcap(modelGroup, true, e.target.value);
        }
    });
    addListener('model-normals', 'change', (e) => {
        if (e.target.checked) {
            const wireCb = document.getElementById('model-wireframe');
            if (wireCb?.checked) {
                wireCb.checked = false;
                updateModelWireframe(modelGroup, false);
            }
            const matcapCb = document.getElementById('model-matcap');
            if (matcapCb?.checked) {
                matcapCb.checked = false;
                const styleGroup = document.getElementById('matcap-style-group');
                if (styleGroup) styleGroup.style.display = 'none';
                updateModelMatcap(modelGroup, false);
            }
            const roughCb = document.getElementById('model-roughness');
            if (roughCb?.checked) { roughCb.checked = false; updateModelRoughness(modelGroup, false); }
            const metalCb = document.getElementById('model-metalness');
            if (metalCb?.checked) { metalCb.checked = false; updateModelMetalness(modelGroup, false); }
            const f0Cb = document.getElementById('model-specular-f0');
            if (f0Cb?.checked) { f0Cb.checked = false; updateModelSpecularF0(modelGroup, false); }
        }
        updateModelNormals(modelGroup, e.target.checked);
    });
    addListener('model-roughness', 'change', (e) => {
        if (e.target.checked) {
            const wireCb = document.getElementById('model-wireframe');
            if (wireCb?.checked) { wireCb.checked = false; updateModelWireframe(modelGroup, false); }
            const matcapCb = document.getElementById('model-matcap');
            if (matcapCb?.checked) {
                matcapCb.checked = false;
                const styleGroup = document.getElementById('matcap-style-group');
                if (styleGroup) styleGroup.style.display = 'none';
                updateModelMatcap(modelGroup, false);
            }
            const normalsCb = document.getElementById('model-normals');
            if (normalsCb?.checked) { normalsCb.checked = false; updateModelNormals(modelGroup, false); }
            const metalCb = document.getElementById('model-metalness');
            if (metalCb?.checked) { metalCb.checked = false; updateModelMetalness(modelGroup, false); }
            const f0Cb = document.getElementById('model-specular-f0');
            if (f0Cb?.checked) { f0Cb.checked = false; updateModelSpecularF0(modelGroup, false); }
        }
        updateModelRoughness(modelGroup, e.target.checked);
    });
    addListener('model-metalness', 'change', (e) => {
        if (e.target.checked) {
            const wireCb = document.getElementById('model-wireframe');
            if (wireCb?.checked) { wireCb.checked = false; updateModelWireframe(modelGroup, false); }
            const matcapCb = document.getElementById('model-matcap');
            if (matcapCb?.checked) {
                matcapCb.checked = false;
                const styleGroup = document.getElementById('matcap-style-group');
                if (styleGroup) styleGroup.style.display = 'none';
                updateModelMatcap(modelGroup, false);
            }
            const normalsCb = document.getElementById('model-normals');
            if (normalsCb?.checked) { normalsCb.checked = false; updateModelNormals(modelGroup, false); }
            const roughCb = document.getElementById('model-roughness');
            if (roughCb?.checked) { roughCb.checked = false; updateModelRoughness(modelGroup, false); }
            const f0Cb = document.getElementById('model-specular-f0');
            if (f0Cb?.checked) { f0Cb.checked = false; updateModelSpecularF0(modelGroup, false); }
        }
        updateModelMetalness(modelGroup, e.target.checked);
    });
    addListener('model-specular-f0', 'change', (e) => {
        if (e.target.checked) {
            const wireCb = document.getElementById('model-wireframe');
            if (wireCb?.checked) { wireCb.checked = false; updateModelWireframe(modelGroup, false); }
            const matcapCb = document.getElementById('model-matcap');
            if (matcapCb?.checked) {
                matcapCb.checked = false;
                const styleGroup = document.getElementById('matcap-style-group');
                if (styleGroup) styleGroup.style.display = 'none';
                updateModelMatcap(modelGroup, false);
            }
            const normalsCb = document.getElementById('model-normals');
            if (normalsCb?.checked) { normalsCb.checked = false; updateModelNormals(modelGroup, false); }
            const roughCb = document.getElementById('model-roughness');
            if (roughCb?.checked) { roughCb.checked = false; updateModelRoughness(modelGroup, false); }
            const metalCb = document.getElementById('model-metalness');
            if (metalCb?.checked) { metalCb.checked = false; updateModelMetalness(modelGroup, false); }
        }
        updateModelSpecularF0(modelGroup, e.target.checked);
    });
    addListener('model-no-texture', 'change', (e) => {
        updateModelTextures(modelGroup, !e.target.checked);
    });

    // Camera FOV
    addListener('camera-fov', 'input', (e) => {
        const fov = parseInt(e.target.value, 10);
        const valueEl = document.getElementById('camera-fov-value');
        if (valueEl) valueEl.textContent = fov;
        if (sceneManager && sceneManager.camera) {
            sceneManager.camera.fov = fov;
            sceneManager.camera.updateProjectionMatrix();
        }
    });

    // Lighting sliders
    const lightMap = {
        'ambient-intensity': 'ambient',
        'hemisphere-intensity': 'hemisphere',
        'directional1-intensity': 'directional1',
        'directional2-intensity': 'directional2'
    };
    Object.entries(lightMap).forEach(([id, type]) => {
        addListener(id, 'input', (e) => {
            const val = parseFloat(e.target.value);
            sceneManager.setLightIntensity(type, val);
            const label = document.getElementById(`${id}-value`);
            if (label) label.textContent = val.toFixed(1);
        });
    });

    // Point cloud settings
    addListener('pointcloud-scale', 'input', (e) => {
        const val = parseFloat(e.target.value);
        if (pointcloudGroup) pointcloudGroup.scale.setScalar(val);
        const label = document.getElementById('pointcloud-scale-value');
        if (label) label.textContent = val.toFixed(1);
    });
    addListener('pointcloud-point-size', 'input', (e) => {
        const val = parseFloat(e.target.value);
        updatePointcloudPointSize(pointcloudGroup, val);
        const label = document.getElementById('pointcloud-point-size-value');
        if (label) label.textContent = val.toFixed(3);
    });
    addListener('pointcloud-opacity', 'input', (e) => {
        const val = parseFloat(e.target.value);
        updatePointcloudOpacity(pointcloudGroup, val);
        const label = document.getElementById('pointcloud-opacity-value');
        if (label) label.textContent = val.toFixed(1);
    });

    // Splat settings
    addListener('splat-scale', 'input', (e) => {
        const val = parseFloat(e.target.value);
        if (splatMesh) splatMesh.scale.setScalar(val);
        const label = document.getElementById('splat-scale-value');
        if (label) label.textContent = val.toFixed(1);
    });

    // Camera
    addListener('btn-reset-camera', 'click', () => {
        camera.position.set(CAMERA.INITIAL_POSITION.x, CAMERA.INITIAL_POSITION.y, CAMERA.INITIAL_POSITION.z);
        controls.target.set(0, 0, 0);
        controls.update();
        if (state.flyModeActive) toggleFlyMode();
    });
    addListener('btn-fit-view', 'click', fitCameraToScene);

    // Annotation visibility toggle
    addListener('btn-toggle-annotations', 'click', () => {
        state.annotationsVisible = !state.annotationsVisible;
        const btn = document.getElementById('btn-toggle-annotations');
        const markersContainer = document.getElementById('annotation-markers');
        if (btn) btn.classList.toggle('active', state.annotationsVisible);
        if (markersContainer) {
            markersContainer.style.display = state.annotationsVisible ? '' : 'none';
        }
        // Hide popup when hiding all markers
        if (!state.annotationsVisible && currentPopupAnnotationId) {
            hideAnnotationPopup();
            currentPopupAnnotationId = null;
            annotationSystem.selectedAnnotation = null;
            hideAnnotationLine();
        }
    });

    // Create SVG overlay for annotation connecting lines
    const svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgOverlay.id = 'annotation-line-overlay';
    const svgLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    svgLine.style.display = 'none';
    svgOverlay.appendChild(svgLine);
    document.body.appendChild(svgOverlay);
    annotationLineEl = svgLine;

    // On mobile, move annotation toggle out of toolbar so position:fixed works
    // (backdrop-filter on toolbar creates a containing block that breaks fixed positioning)
    repositionAnnotationToggle();
}

// =============================================================================
// EDITORIAL LAYOUT — Moved to src/themes/editorial/layout.js
// Layout CSS, JS, and color tokens are now part of the editorial theme package.
// See: themes/editorial/layout.css, layout.js, theme.css
// =============================================================================

function setupViewerKeyboardShortcuts() {
    const isEditorial = (window.APP_CONFIG || {})._resolvedLayout === 'editorial';
    setupKeyboardShortcuts({
        'f': () => toggleFlyMode(),
        'm': () => {
            if (isEditorial) {
                // Toggle editorial info overlay
                const panel = document.querySelector('.editorial-info-overlay');
                const detailsBtn = document.querySelector('.editorial-details-link');
                if (panel) {
                    const isOpen = panel.classList.toggle('open');
                    if (detailsBtn) detailsBtn.classList.toggle('active', isOpen);
                }
            } else {
                const sidebar = document.getElementById('metadata-sidebar');
                if (sidebar && !sidebar.classList.contains('hidden')) {
                    hideMetadataSidebar();
                } else {
                    showMetadataSidebar('view', { state, annotationSystem, imageAssets: state.imageAssets });
                }
            }
        },
        '1': () => switchViewMode('model'),
        '2': () => switchViewMode('splat'),
        '3': () => switchViewMode('pointcloud'),
        'g': () => {
            const cb = document.getElementById('toggle-gridlines');
            if (cb) { cb.checked = !cb.checked; sceneManager.toggleGrid(cb.checked); }
        },
        'escape': () => {
            if (isEditorial) {
                // Close info overlay and annotation popup
                const panel = document.querySelector('.editorial-info-overlay');
                const detailsBtn = document.querySelector('.editorial-details-link');
                if (panel && panel.classList.contains('open')) {
                    panel.classList.remove('open');
                    if (detailsBtn) detailsBtn.classList.remove('active');
                }
            }
            hideAnnotationPopup();
            currentPopupAnnotationId = null;
        }
    });
}

// =============================================================================
// VIEW SWITCHER
// =============================================================================

function switchViewMode(mode) {
    state.displayMode = mode;
    setDisplayMode(mode, createDisplayModeDeps());
    triggerLazyLoad(mode);

    // Update active button state (sidebar layout)
    document.querySelectorAll('.kiosk-view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
    });
    // Update active state (editorial layout)
    document.querySelectorAll('.editorial-view-mode-link').forEach(link => {
        link.classList.toggle('active', link.dataset.mode === mode);
    });
}

function createViewSwitcher() {
    // Remove existing switcher if recreating
    const existing = document.getElementById('kiosk-view-switcher');
    if (existing) existing.remove();

    // Use contentInfo from archive to know what types are available
    // (assets may not be loaded yet but will lazy-load on switch)
    const contentInfo = state.archiveLoader ? state.archiveLoader.getContentInfo() : null;
    const types = [];
    if (contentInfo) {
        if (contentInfo.hasMesh) types.push({ mode: 'model', label: 'Model' });
        if (contentInfo.hasSplat) types.push({ mode: 'splat', label: 'Splat' });
        if (contentInfo.hasPointcloud) types.push({ mode: 'pointcloud', label: 'Point Cloud' });
    } else {
        if (state.modelLoaded) types.push({ mode: 'model', label: 'Model' });
        if (state.splatLoaded) types.push({ mode: 'splat', label: 'Splat' });
        if (state.pointcloudLoaded) types.push({ mode: 'pointcloud', label: 'Point Cloud' });
    }

    // Only show if 2+ types available
    if (types.length < 2) return;

    const pill = document.createElement('div');
    pill.id = 'kiosk-view-switcher';
    pill.className = 'kiosk-view-switcher';

    types.forEach(({ mode, label }) => {
        const btn = document.createElement('button');
        btn.className = 'kiosk-view-btn';
        btn.dataset.mode = mode;
        btn.textContent = label;
        if (state.displayMode === mode) btn.classList.add('active');
        btn.addEventListener('click', () => switchViewMode(mode));
        pill.appendChild(btn);
    });

    // Desktop: append to document.body (position:fixed bottom-center)
    // Mobile: insert into #sidebar-drag-handle alongside the drag bar
    if (isMobileKiosk()) {
        const handle = document.getElementById('sidebar-drag-handle');
        if (handle) handle.appendChild(pill);
    } else {
        document.body.appendChild(pill);
    }
}

function repositionViewSwitcher() {
    const pill = document.getElementById('kiosk-view-switcher');
    if (!pill) return;

    const handle = document.getElementById('sidebar-drag-handle');
    if (isMobileKiosk()) {
        if (pill.parentElement !== handle && handle) handle.appendChild(pill);
    } else {
        if (pill.parentElement !== document.body) document.body.appendChild(pill);
    }
}

// =============================================================================
// VIEWER FEATURES
// =============================================================================

function toggleFlyMode() {
    state.flyModeActive = !state.flyModeActive;
    const hint = document.getElementById('fly-mode-hint');
    const btn = document.getElementById('btn-fly-mode');

    if (state.flyModeActive) {
        controls.enabled = false;
        controls.disconnect();
        flyControls.enable();
        if (hint) hint.classList.remove('hidden');
        if (btn) btn.classList.add('active');
    } else {
        flyControls.disable();
        controls.connect();
        controls.enabled = true;
        // Sync orbit controls target to current camera look direction
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        controls.target.copy(camera.position).add(dir.multiplyScalar(2));
        controls.update();
        if (hint) hint.classList.add('hidden');
        if (btn) btn.classList.remove('active');
    }
}

function fitCameraToScene() {
    const box = new THREE.Box3();
    let hasContent = false;

    if (splatMesh && splatMesh.visible) {
        box.expandByObject(splatMesh);
        hasContent = true;
    }
    if (modelGroup && modelGroup.children.length > 0) {
        box.expandByObject(modelGroup);
        hasContent = true;
    }
    if (pointcloudGroup && pointcloudGroup.children.length > 0) {
        box.expandByObject(pointcloudGroup);
        hasContent = true;
    }

    if (!hasContent) return;

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    // FOV-aware distance calculation to fill 90% of viewport
    const targetFill = 0.90;
    const fov = camera.fov * (Math.PI / 180);
    const aspect = camera.aspect;

    const verticalDist = (size.y / 2) / Math.tan(fov / 2) / targetFill;
    const horizontalDist = (size.x / 2) / Math.tan((fov * aspect) / 2) / targetFill;
    const distance = Math.max(verticalDist, horizontalDist, (size.z / 2) + 0.5);

    // Slight angle for a more interesting default view
    camera.position.set(
        center.x + distance * 0.3,
        center.y + distance * 0.2,
        center.z + distance * 0.9
    );
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
}

function applyGlobalAlignment(alignment) {
    if (!alignment) return;
    // Global alignment adjusts the orbit controls target and camera
    if (alignment.target) {
        controls.target.set(alignment.target[0], alignment.target[1], alignment.target[2]);
    }
    if (alignment.camera) {
        camera.position.set(alignment.camera[0], alignment.camera[1], alignment.camera[2]);
    }
    controls.update();
}

/**
 * Reorder the kiosk sidebar so the layout is:
 *   Title > Description > Annotations > Detail collapsibles > Creator/Date/Location/Device/License
 * Called after all sidebar sections have been populated.
 */
function reorderKioskSidebar() {
    const viewContent = document.querySelector('#sidebar-view .display-content');
    if (!viewContent) return;

    // Gather the sections we want to reorder
    const annoHeader = viewContent.querySelector('.kiosk-anno-header');
    const annoList = document.getElementById('kiosk-annotation-list');
    const detailSections = viewContent.querySelectorAll('.kiosk-detail-section');
    const details = viewContent.querySelector('.display-details');
    const license = document.getElementById('display-license-row');
    const stats = document.getElementById('display-stats');

    // Find all dividers (we'll re-add them as needed)
    const dividers = viewContent.querySelectorAll('.display-divider');

    // Remove dividers (we'll create fresh ones where needed)
    dividers.forEach(d => d.remove());

    // Move annotations right after description (remove first, then re-insert)
    const description = document.getElementById('display-description');
    const insertAfter = description || viewContent.querySelector('.display-title');
    if (!insertAfter) return;

    const addDivider = (beforeEl) => {
        const d = document.createElement('div');
        d.className = 'display-divider';
        viewContent.insertBefore(d, beforeEl);
    };

    // 1. Annotations block — right after description
    if (annoHeader && annoList) {
        const annoDiv = annoHeader.previousElementSibling;
        if (annoDiv && annoDiv.classList.contains('display-divider')) annoDiv.remove();

        // Insert after description
        const afterDesc = insertAfter.nextSibling;
        addDivider(afterDesc);
        viewContent.insertBefore(annoHeader, afterDesc);
        viewContent.insertBefore(annoList, afterDesc);
    }

    // 2. Detail collapsibles — after annotations (or after description if no annotations)
    if (detailSections.length > 0) {
        // Find the spot right before details/license/stats
        const refNode = details || license || stats;
        if (refNode) {
            addDivider(refNode);
            detailSections.forEach(s => viewContent.insertBefore(s, refNode));
        }
    }

    // 3. Details (Creator/Date/Location/Device), License, Stats — stay at the end
    // They're already at the end by default, just add a divider before them
    if (details && details.style.display !== 'none') {
        addDivider(details);
    }
}

function populateAnnotationList() {
    const annotations = annotationSystem.getAnnotations();
    if (annotations.length === 0) return;

    const viewContent = document.querySelector('#sidebar-view .display-content');
    if (!viewContent) return;

    // Create annotation section in sidebar
    const divider = document.createElement('div');
    divider.className = 'display-divider';
    viewContent.appendChild(divider);

    const header = document.createElement('div');
    header.className = 'kiosk-anno-header';
    header.textContent = 'Annotations';
    viewContent.appendChild(header);

    const listContainer = document.createElement('div');
    listContainer.id = 'kiosk-annotation-list';
    viewContent.appendChild(listContainer);

    annotations.forEach((anno, i) => {
        const item = document.createElement('div');
        item.className = 'kiosk-anno-item';
        item.dataset.annoId = anno.id;

        const badge = document.createElement('span');
        badge.className = 'kiosk-anno-badge';
        badge.textContent = i + 1;
        item.appendChild(badge);

        const info = document.createElement('div');
        info.className = 'kiosk-anno-info';

        const title = document.createElement('span');
        title.className = 'kiosk-anno-title';
        title.textContent = anno.title || 'Untitled';
        info.appendChild(title);

        if (anno.body) {
            const preview = document.createElement('span');
            preview.className = 'kiosk-anno-preview';
            // Strip markdown-like formatting for preview
            const plainText = anno.body.replace(/[*_#\[\]()]/g, '');
            preview.textContent = plainText.substring(0, 80) + (plainText.length > 80 ? '...' : '');
            info.appendChild(preview);
        }

        item.appendChild(info);

        item.addEventListener('click', () => {
            if (currentPopupAnnotationId === anno.id) {
                if (isMobileKiosk()) {
                    hideMobileAnnotationDetail();
                    setSheetSnap('peek');
                } else {
                    hideAnnotationPopup();
                    hideAnnotationLine();
                }
                currentPopupAnnotationId = null;
                annotationSystem.selectedAnnotation = null;
                document.querySelectorAll('.annotation-marker.selected').forEach(m => m.classList.remove('selected'));
                document.querySelectorAll('.kiosk-anno-item.active').forEach(c => c.classList.remove('active'));
                // If annotations hidden globally, re-hide the single marker
                if (!state.annotationsVisible) {
                    hideSingleMarker();
                }
            } else {
                document.querySelectorAll('.kiosk-anno-item.active').forEach(c => c.classList.remove('active'));
                item.classList.add('active');
                // If annotations hidden globally, show only this marker
                if (!state.annotationsVisible) {
                    showSingleMarker(anno.id);
                }
                annotationSystem.goToAnnotation(anno.id);
                if (isMobileKiosk()) {
                    currentPopupAnnotationId = anno.id;
                    showMobileAnnotationDetail(anno);
                } else {
                    currentPopupAnnotationId = showAnnotationPopup(anno, state.imageAssets);
                }
            }
        });

        listContainer.appendChild(item);
    });
}

// --- Detailed metadata helpers ---

function hasValue(val) {
    if (val === null || val === undefined || val === '') return false;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') {
        return Object.keys(val).filter(k => !k.startsWith('_')).some(k => hasValue(val[k]));
    }
    return true;
}

function escapeHtml(str) {
    if (typeof str !== 'string') str = String(str);
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function createDetailSection(title) {
    const section = document.createElement('div');
    section.className = 'kiosk-detail-section';

    const header = document.createElement('div');
    header.className = 'kiosk-detail-header';
    header.innerHTML = `<span class="kiosk-detail-title">${escapeHtml(title)}</span><span class="kiosk-detail-chevron">&#9654;</span>`;

    const content = document.createElement('div');
    content.className = 'kiosk-detail-content';
    content.style.display = 'none';

    header.addEventListener('click', () => {
        const isOpen = header.classList.toggle('open');
        content.style.display = isOpen ? '' : 'none';
    });

    section.appendChild(header);
    section.appendChild(content);
    return { section, content };
}

function addDetailRow(container, label, value) {
    if (!hasValue(value)) return;
    const row = document.createElement('div');
    row.className = 'display-detail';
    const displayVal = typeof value === 'object' ? JSON.stringify(value) : String(value);
    row.innerHTML = `<span class="display-label">${escapeHtml(label)}</span><span class="display-value">${escapeHtml(displayVal)}</span>`;
    container.appendChild(row);
}

function populateDetailedMetadata(manifest) {
    if (!manifest) return;

    const viewContent = document.querySelector('#sidebar-view .display-content');
    if (!viewContent) return;

    const sections = [];

    // 1. Quality & Accuracy
    const qm = manifest.quality_metrics;
    if (hasValue(qm)) {
        const { section, content } = createDetailSection('Quality & Accuracy');
        addDetailRow(content, 'Tier', qm.tier);
        addDetailRow(content, 'Accuracy Grade', qm.accuracy_grade);
        if (hasValue(qm.capture_resolution)) {
            const cr = qm.capture_resolution;
            addDetailRow(content, 'Capture Resolution', cr.value != null ? `${cr.value} ${cr.unit || ''}`.trim() : cr);
        }
        if (hasValue(qm.alignment_error)) {
            const ae = qm.alignment_error;
            addDetailRow(content, 'Alignment Error', ae.value != null ? `${ae.value} ${ae.unit || ''} (${ae.method || 'unknown'})`.trim() : ae);
        }
        addDetailRow(content, 'Scale Verification', qm.scale_verification);
        if (hasValue(qm.data_quality)) {
            const dq = qm.data_quality;
            Object.keys(dq).forEach(k => addDetailRow(content, k.replace(/_/g, ' '), dq[k]));
        }
        if (content.children.length > 0) sections.push(section);
    }

    // 2. Processing Details
    const prov = manifest.provenance;
    if (hasValue(prov)) {
        const { section, content } = createDetailSection('Processing Details');
        addDetailRow(content, 'Device Serial', prov.device_serial);
        addDetailRow(content, 'Operator ORCID', prov.operator_orcid);
        if (Array.isArray(prov.processing_software)) {
            prov.processing_software.forEach(sw => {
                addDetailRow(content, 'Software', typeof sw === 'object' ? `${sw.name || ''} ${sw.version || ''}`.trim() : sw);
            });
        }
        addDetailRow(content, 'Processing Notes', prov.processing_notes);
        addDetailRow(content, 'Convention Hints', prov.convention_hints);
        if (content.children.length > 0) sections.push(section);
    }

    // 3. Data Assets
    const entries = manifest.data_entries;
    if (Array.isArray(entries) && entries.length > 0) {
        const { section, content } = createDetailSection('Data Assets');
        entries.forEach((entry, i) => {
            if (i > 0) {
                const sep = document.createElement('div');
                sep.style.borderTop = '1px solid rgba(78,205,196,0.06)';
                sep.style.margin = '6px 0';
                content.appendChild(sep);
            }
            addDetailRow(content, 'File', entry.file_name || entry.filename);
            addDetailRow(content, 'Role', entry.role);
            addDetailRow(content, 'Created By', entry.created_by);
            addDetailRow(content, 'Notes', entry._source_notes);
        });
        if (content.children.length > 0) sections.push(section);
    }

    // 4. Archival Record
    const ar = manifest.archival_record;
    if (hasValue(ar)) {
        const { section, content } = createDetailSection('Archival Record');
        addDetailRow(content, 'Standard', ar.standard);
        addDetailRow(content, 'Title', ar.title);
        if (Array.isArray(ar.alternate_titles) && ar.alternate_titles.length > 0) {
            addDetailRow(content, 'Alternate Titles', ar.alternate_titles.join(', '));
        }
        if (hasValue(ar.ids)) {
            Object.keys(ar.ids).forEach(k => addDetailRow(content, `ID (${k})`, ar.ids[k]));
        }
        if (hasValue(ar.creation)) {
            const c = ar.creation;
            addDetailRow(content, 'Creator', c.creator);
            addDetailRow(content, 'Date', c.date);
            addDetailRow(content, 'Place', c.place);
        }
        if (hasValue(ar.physical_description)) {
            const pd = ar.physical_description;
            Object.keys(pd).forEach(k => addDetailRow(content, k.replace(/_/g, ' '), pd[k]));
        }
        addDetailRow(content, 'Provenance', ar.provenance);
        if (hasValue(ar.rights)) {
            const r = ar.rights;
            addDetailRow(content, 'Rights', r.statement || r.license);
            addDetailRow(content, 'Holder', r.holder);
        }
        if (hasValue(ar.context)) {
            const ctx = ar.context;
            Object.keys(ctx).forEach(k => addDetailRow(content, k.replace(/_/g, ' '), ctx[k]));
        }
        if (hasValue(ar.coverage)) {
            if (hasValue(ar.coverage.spatial)) {
                const sp = ar.coverage.spatial;
                Object.keys(sp).forEach(k => addDetailRow(content, `Spatial ${k}`, sp[k]));
            }
            if (hasValue(ar.coverage.temporal)) {
                const t = ar.coverage.temporal;
                Object.keys(t).forEach(k => addDetailRow(content, `Temporal ${k}`, t[k]));
            }
        }
        if (content.children.length > 0) sections.push(section);
    }

    // 5. Material Properties
    const ms = manifest.material_standard;
    if (hasValue(ms)) {
        const { section, content } = createDetailSection('Material Properties');
        addDetailRow(content, 'Workflow', ms.workflow);
        addDetailRow(content, 'Color Space', ms.color_space);
        addDetailRow(content, 'Normal Space', ms.normal_space);
        addDetailRow(content, 'Occlusion Packed', ms.occlusion_packed);
        if (content.children.length > 0) sections.push(section);
    }

    // 6. Relationships
    const rel = manifest.relationships;
    if (hasValue(rel)) {
        const { section, content } = createDetailSection('Relationships');
        addDetailRow(content, 'Part Of', rel.part_of);
        addDetailRow(content, 'Derived From', rel.derived_from);
        addDetailRow(content, 'Replaces', rel.replaces);
        if (Array.isArray(rel.related_objects)) {
            rel.related_objects.forEach(obj => {
                addDetailRow(content, obj.relation || 'Related', obj.id || obj.title || JSON.stringify(obj));
            });
        }
        if (content.children.length > 0) sections.push(section);
    }

    // 7. Preservation
    const pres = manifest.preservation;
    if (hasValue(pres)) {
        const { section, content } = createDetailSection('Preservation');
        if (Array.isArray(pres.format_registry)) {
            pres.format_registry.forEach(fr => {
                addDetailRow(content, 'Format', typeof fr === 'object' ? `${fr.name || ''} (${fr.id || ''})`.trim() : fr);
            });
        }
        if (Array.isArray(pres.significant_properties)) {
            pres.significant_properties.forEach(sp => addDetailRow(content, 'Property', sp));
        }
        addDetailRow(content, 'Rendering Requirements', pres.rendering_requirements);
        addDetailRow(content, 'Rendering Notes', pres.rendering_notes);
        if (content.children.length > 0) sections.push(section);
    }

    // 8. Version History
    const vh = manifest.version_history;
    if (Array.isArray(vh) && vh.length > 0) {
        const { section, content } = createDetailSection('Version History');
        vh.forEach(entry => {
            const parts = [];
            if (entry.version) parts.push(`v${entry.version}`);
            if (entry.date) parts.push(entry.date);
            addDetailRow(content, parts.join(' — ') || 'Entry', entry.description || entry.notes || '');
        });
        if (content.children.length > 0) sections.push(section);
    }

    // 9. Custom Fields
    const cf = manifest._meta && manifest._meta.custom_fields;
    if (hasValue(cf)) {
        const { section, content } = createDetailSection('Custom Fields');
        Object.keys(cf).forEach(k => addDetailRow(content, k, cf[k]));
        if (content.children.length > 0) sections.push(section);
    }

    // 10. Integrity
    const integ = manifest.integrity;
    if (hasValue(integ)) {
        const { section, content } = createDetailSection('Integrity');
        addDetailRow(content, 'Algorithm', integ.algorithm);
        addDetailRow(content, 'Manifest Hash', integ.manifest_hash);
        if (hasValue(integ.assets)) {
            Object.keys(integ.assets).forEach(filename => {
                addDetailRow(content, filename, integ.assets[filename]);
            });
        }
        if (content.children.length > 0) sections.push(section);
    }

    if (sections.length === 0) return;

    // Insert before annotation section if it exists, otherwise append
    const annoHeader = viewContent.querySelector('.kiosk-anno-header');
    const annoDivider = annoHeader ? annoHeader.previousElementSibling : null;
    const insertBefore = (annoDivider && annoDivider.classList.contains('display-divider')) ? annoDivider : annoHeader;

    // Add a divider before the detail sections
    const divider = document.createElement('div');
    divider.className = 'display-divider';

    if (insertBefore) {
        viewContent.insertBefore(divider, insertBefore);
        sections.forEach(s => viewContent.insertBefore(s, insertBefore));
    } else {
        viewContent.appendChild(divider);
        sections.forEach(s => viewContent.appendChild(s));
    }

    log.info(`Populated ${sections.length} detailed metadata sections`);
}

function formatBytes(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function populateSourceFilesList(archiveLoader) {
    const sourceEntries = archiveLoader.getSourceFileEntries();
    if (sourceEntries.length === 0) return;

    const viewContent = document.querySelector('#sidebar-view .display-content');
    if (!viewContent) return;

    const categoryLabels = {
        raw_photography: 'Raw Photography',
        processing_report: 'Processing Report',
        ground_control: 'Ground Control Points',
        calibration: 'Calibration Data',
        project_file: 'Project File',
        reference: 'Reference Material',
        other: 'Other'
    };

    const { section, content } = createDetailSection(`Source Files (${sourceEntries.length})`);

    let totalSize = 0;
    sourceEntries.forEach(({ entry }) => {
        const name = entry.original_name || entry.file_name || 'Unknown';
        const size = entry.size_bytes || 0;
        totalSize += size;
        const cat = entry.source_category || '';
        const catLabel = cat ? categoryLabels[cat] || cat.replace(/_/g, ' ') : '';

        const row = document.createElement('div');
        row.className = 'display-detail';
        row.innerHTML =
            `<span class="display-label" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(name)}">${escapeHtml(name)}</span>` +
            `<span class="display-value">${escapeHtml(formatBytes(size))}${catLabel ? ' · ' + escapeHtml(catLabel) : ''}</span>`;
        content.appendChild(row);
    });

    // Total size summary
    if (sourceEntries.length > 1) {
        const summary = document.createElement('div');
        summary.style.cssText = 'font-size:0.75em;opacity:0.6;margin-top:6px;text-align:right;';
        summary.textContent = `Total: ${formatBytes(totalSize)}`;
        content.appendChild(summary);
    }

    // Guidance note
    const note = document.createElement('div');
    note.style.cssText = 'font-size:0.75em;opacity:0.5;margin-top:8px;font-style:italic;';
    note.textContent = 'Source files are included in the .a3d archive. Unpack to access.';
    content.appendChild(note);

    viewContent.appendChild(section);
    log.info(`Populated source files list: ${sourceEntries.length} files, ${formatBytes(totalSize)}`);
}

function updateInfoPanel() {
    const setInfo = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    if (splatMesh) {
        setInfo('splat-vertices', 'Loaded');
    }
    if (modelGroup && modelGroup.children.length > 0) {
        let faceCount = 0;
        modelGroup.traverse(child => {
            if (child.isMesh && child.geometry) {
                const idx = child.geometry.index;
                faceCount += idx ? idx.count / 3 : (child.geometry.getAttribute('position')?.count || 0) / 3;
            }
        });
        setInfo('model-faces', faceCount.toLocaleString());
    }
    if (pointcloudGroup && pointcloudGroup.children.length > 0) {
        let pointCount = 0;
        pointcloudGroup.traverse(child => {
            if (child.isPoints && child.geometry) {
                const pos = child.geometry.getAttribute('position');
                if (pos) pointCount += pos.count;
            }
        });
        setInfo('pointcloud-points', pointCount.toLocaleString());
    }
}

// =============================================================================
// HIDE EDITOR-ONLY UI
// =============================================================================

function hideEditorOnlyUI() {
    // Hide entire toolbar until archive is loaded
    hideEl('left-toolbar');

    // Hide bottom annotation bar (annotations shown in sidebar instead)
    hideEl('annotation-bar');

    // Hide editor-only toolbar buttons (stay hidden even after toolbar is shown)
    hideEl('btn-annotate');
    hideEl('btn-export-archive');
    hideEl('btn-toggle-controls'); // Settings now live in sidebar tab

    // Hide editor-only control sections
    hideEl('load-files-section');

    // Uncheck grid checkbox — grid is never created in kiosk mode
    const gridCb = document.getElementById('toggle-gridlines');
    if (gridCb) gridCb.checked = false;

    // Hide Alignment and Share sections (no IDs, find by header text)
    const sections = document.querySelectorAll('#controls-panel .control-section');
    sections.forEach(section => {
        const header = section.querySelector('h3');
        const text = header?.textContent?.trim().toLowerCase() || '';
        if (text.startsWith('alignment') || text.startsWith('share')) {
            section.style.display = 'none';
        }
    });

    // Hide editor-only sidebar tabs
    const editTab = document.querySelector('.sidebar-mode-tab[data-mode="edit"]');
    if (editTab) editTab.style.display = 'none';
    const annoTab = document.querySelector('.sidebar-mode-tab[data-mode="annotations"]');
    if (annoTab) annoTab.style.display = 'none';

    // Rename View tab to Info
    const viewTab = document.querySelector('.sidebar-mode-tab[data-mode="view"]');
    if (viewTab) viewTab.textContent = 'Info';

    // Move settings controls into sidebar as a tab
    moveSettingsToSidebar();
}

function hideEl(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}

/**
 * Move controls panel content into the metadata sidebar as a "Settings" tab.
 * Uses DOM appendChild which preserves all event listeners attached by
 * setupViewerUI() and setupCollapsibles().
 */
function moveSettingsToSidebar() {
    const sidebar = document.getElementById('metadata-sidebar');
    const controlsPanel = document.getElementById('controls-panel');
    if (!sidebar || !controlsPanel) return;

    // 1. Add "Settings" tab button
    const tabBar = sidebar.querySelector('.sidebar-mode-tabs');
    if (tabBar) {
        const settingsTab = document.createElement('button');
        settingsTab.className = 'sidebar-mode-tab';
        settingsTab.dataset.mode = 'settings';
        settingsTab.textContent = 'Settings';
        tabBar.appendChild(settingsTab);
        settingsTab.addEventListener('click', () => {
            switchSidebarMode('settings', {});
        });
    }

    // 2. Create sidebar content div for settings
    const settingsContent = document.createElement('div');
    settingsContent.className = 'sidebar-mode-content';
    settingsContent.id = 'sidebar-settings';

    // 3. Move .control-section elements from controls panel (preserves event listeners)
    const controlSections = Array.from(controlsPanel.querySelectorAll('.control-section'));
    controlSections.forEach(section => {
        settingsContent.appendChild(section);
    });

    // 4. Hide position/rotation inputs (editor-only repositioning)
    settingsContent.querySelectorAll('.position-inputs').forEach(el => {
        el.style.display = 'none';
    });

    // 5. Insert into sidebar before footer
    const footer = sidebar.querySelector('.sidebar-footer');
    if (footer) {
        sidebar.insertBefore(settingsContent, footer);
    } else {
        sidebar.appendChild(settingsContent);
    }

    // 6. Hide the now-empty controls panel
    controlsPanel.style.display = 'none';
    log.info('Settings controls moved into sidebar');
}

/**
 * Build the "Export" collapsible section and append it to the settings tab.
 * Called after archive is fully loaded so state.archiveLoader/archiveManifest are available.
 */
function createExportSection() {
    const settingsContainer = document.getElementById('sidebar-settings');
    if (!settingsContainer || !state.archiveLoader) return;

    // Remove existing export section if present (e.g. when loading a second archive)
    const existing = settingsContainer.querySelector('.export-section');
    if (existing) existing.remove();

    // Determine base filename from project title or archive filename
    const title = state.archiveManifest?.project?.title;
    const baseName = sanitizeFilename(title || stripExtension(state.archiveFileName || 'archive'));

    // Get content info
    const contentInfo = state.archiveLoader.getContentInfo();
    const sceneEntry = state.archiveLoader.getSceneEntry();
    const meshEntry = state.archiveLoader.getMeshEntry();
    const pcEntry = state.archiveLoader.getPointcloudEntry();

    // Build the collapsible section using the standard control-section pattern
    const section = document.createElement('div');
    section.className = 'control-section collapsible collapsed export-section';

    const header = document.createElement('h3');
    header.className = 'collapsible-header';
    header.innerHTML = 'Export <span class="collapse-icon">▶</span>';
    header.addEventListener('click', () => {
        section.classList.toggle('collapsed');
        const icon = header.querySelector('.collapse-icon');
        if (icon) icon.textContent = section.classList.contains('collapsed') ? '▶' : '▼';
    });

    const content = document.createElement('div');
    content.className = 'collapsible-content';

    // --- Full archive download (only when loaded from URL) ---
    if (state.archiveSourceUrl) {
        const archiveBtn = createExportButton(
            'Download Full Archive (.a3d)',
            `${baseName}.a3d`,
            async (btn) => {
                const a = document.createElement('a');
                a.href = state.archiveSourceUrl;
                a.download = `${baseName}.a3d`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                log.info(`Archive download initiated from source URL`);
            }
        );
        content.appendChild(archiveBtn);

        const archiveNote = document.createElement('p');
        archiveNote.className = 'export-note';
        archiveNote.textContent = 'Full archive includes metadata, annotations, version history, and source files if present.';
        content.appendChild(archiveNote);
    }

    // --- Individual assets ---
    const assets = [];
    if (contentInfo.hasMesh && meshEntry) {
        const ext = getFileExtension(meshEntry.file_name);
        assets.push({ label: `3D Model (${ext})`, entry: meshEntry, filename: `${baseName}${ext}` });
    }
    if (contentInfo.hasSplat && sceneEntry) {
        const ext = getFileExtension(sceneEntry.file_name);
        assets.push({ label: `Gaussian Splat (${ext})`, entry: sceneEntry, filename: `${baseName}${ext}` });
    }
    if (contentInfo.hasPointcloud && pcEntry) {
        const ext = getFileExtension(pcEntry.file_name);
        assets.push({ label: `Point Cloud (${ext})`, entry: pcEntry, filename: `${baseName}${ext}` });
    }

    if (assets.length > 0) {
        const subHeader = document.createElement('div');
        subHeader.className = 'export-individual-label';
        subHeader.textContent = 'Individual Assets';
        content.appendChild(subHeader);

        for (const asset of assets) {
            const btn = createExportButton(asset.label, asset.filename, async (btnEl) => {
                const result = await state.archiveLoader.extractFile(asset.entry.file_name);
                if (result) {
                    downloadBlob(result.blob, asset.filename);
                }
            });
            content.appendChild(btn);
        }
    }

    section.appendChild(header);
    section.appendChild(content);
    settingsContainer.appendChild(section);
    log.info('Export section added to settings');
}

/**
 * Create a styled export button with loading state handling.
 */
function createExportButton(label, filename, onClick) {
    const btn = document.createElement('button');
    btn.className = 'export-btn';
    btn.textContent = label;
    btn.addEventListener('click', async () => {
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Preparing download...';
        try {
            await onClick(btn);
        } catch (err) {
            log.error('Export failed:', err);
            notify.error(`Export failed: ${err.message}`);
        } finally {
            btn.disabled = false;
            btn.textContent = origText;
        }
    });
    return btn;
}

/** Sanitize a string for use as a filename */
function sanitizeFilename(name) {
    return name.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim() || 'archive';
}

/** Strip file extension from a filename */
function stripExtension(filename) {
    return filename.replace(/\.[^.]+$/, '');
}

/** Get file extension including the dot (e.g. ".glb") */
function getFileExtension(filename) {
    const match = filename.match(/\.[^.]+$/);
    return match ? match[0] : '';
}

/**
 * Show only settings sections and display mode buttons relevant to the loaded data.
 */
function showRelevantSettings(hasSplat, hasMesh, hasPointcloud) {
    // After DOM move, sections live in #sidebar-settings
    const container = document.getElementById('sidebar-settings')
                   || document.getElementById('controls-panel');

    const sections = container.querySelectorAll('.control-section.collapsible');
    sections.forEach(section => {
        const header = section.querySelector('h3');
        const text = header?.textContent?.trim().toLowerCase() || '';
        if (text.startsWith('model settings') && !hasMesh) section.style.display = 'none';
        if (text.startsWith('splat settings') && !hasSplat) section.style.display = 'none';
        if (text.startsWith('point cloud settings') && !hasPointcloud) section.style.display = 'none';
    });

    // In kiosk mode, hide editing controls (scale, opacity, position, rotation)
    // but keep visual controls (wireframe, hide textures, lighting)
    const hideByIds = [
        'model-scale', 'model-opacity', 'splat-scale',
        'pointcloud-scale', 'pointcloud-point-size', 'pointcloud-opacity'
    ];
    hideByIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) el.closest('.slider-group')?.style.setProperty('display', 'none');
    });
    // Hide all position/rotation inputs
    container.querySelectorAll('.position-inputs').forEach(el => {
        el.style.display = 'none';
    });
    // Hide entire splat and pointcloud settings (no useful kiosk controls remain)
    sections.forEach(section => {
        const header = section.querySelector('h3');
        const text = header?.textContent?.trim().toLowerCase() || '';
        if (text.startsWith('splat settings')) section.style.display = 'none';
        if (text.startsWith('point cloud settings')) section.style.display = 'none';
    });

    // Hide display mode buttons for absent data types
    if (!hasMesh) hideEl('btn-model');
    if (!hasSplat) hideEl('btn-splat');
    if (!hasPointcloud) hideEl('btn-pointcloud');
    if (!hasMesh || !hasSplat) { hideEl('btn-both'); hideEl('btn-split'); }

    // STL button only visible when the mesh is actually an STL file
    const meshEntry = state.archiveLoader ? state.archiveLoader.getMeshEntry() : null;
    const isSTL = meshEntry && meshEntry.file_name && meshEntry.file_name.toLowerCase().endsWith('.stl');
    if (!isSTL) hideEl('btn-stl');

    // Hide entire Display Mode section if 0 or 1 button visible
    const displaySection = [...container.querySelectorAll('.control-section')]
        .find(s => s.querySelector('h3')?.textContent?.trim() === 'Display Mode');
    if (displaySection) {
        const visibleButtons = displaySection.querySelectorAll('.toggle-btn:not([style*="display: none"])');
        if (visibleButtons.length <= 1) displaySection.style.display = 'none';
    }
}

// =============================================================================
// WINDOW RESIZE
// =============================================================================

function isMobileKiosk() {
    return window.innerWidth <= 768 && document.body.classList.contains('kiosk-mode');
}

function setSheetSnap(snap) {
    const sidebar = document.getElementById('metadata-sidebar');
    if (!sidebar) return;
    sidebar.classList.remove('sheet-peek', 'sheet-half', 'sheet-full');
    sidebar.classList.add('sheet-' + snap);
    currentSheetSnap = snap;
}

function setupBottomSheetDrag() {
    const handle = document.getElementById('sidebar-drag-handle');
    const sidebar = document.getElementById('metadata-sidebar');
    if (!handle || !sidebar) return;

    let isDragging = false;
    let startY = 0;
    let startTranslateY = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;

    const VELOCITY_THRESHOLD = 0.4; // px/ms

    function getCurrentTranslateY() {
        const style = getComputedStyle(sidebar);
        const matrix = new DOMMatrix(style.transform);
        return matrix.m42;
    }

    handle.addEventListener('pointerdown', (e) => {
        if (!isMobileKiosk()) return;
        isDragging = true;
        startY = e.clientY;
        startTranslateY = getCurrentTranslateY();
        lastY = e.clientY;
        lastTime = Date.now();
        velocity = 0;
        sidebar.classList.add('sheet-dragging');
        handle.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const deltaY = e.clientY - startY;
        const newTranslateY = Math.max(0, startTranslateY + deltaY);
        sidebar.style.transform = `translateY(${newTranslateY}px)`;

        // Track velocity
        const now = Date.now();
        const dt = now - lastTime;
        if (dt > 0) {
            velocity = (e.clientY - lastY) / dt;
        }
        lastY = e.clientY;
        lastTime = now;
    });

    const onPointerUp = () => {
        if (!isDragging) return;
        isDragging = false;
        sidebar.classList.remove('sheet-dragging');
        sidebar.style.transform = '';

        // Determine snap based on velocity or position
        if (Math.abs(velocity) > VELOCITY_THRESHOLD) {
            // Swipe direction: positive velocity = swipe down
            if (velocity > 0) {
                // Swiping down: go to next lower snap
                if (currentSheetSnap === 'full') setSheetSnap('half');
                else setSheetSnap('peek');
            } else {
                // Swiping up: go to next higher snap
                if (currentSheetSnap === 'peek') setSheetSnap('half');
                else setSheetSnap('full');
            }
        } else {
            // Snap to nearest based on current position
            const sidebarHeight = sidebar.offsetHeight;
            const currentY = getCurrentTranslateY();
            const visibleFraction = 1 - (currentY / sidebarHeight);

            if (visibleFraction < 0.2) setSheetSnap('peek');
            else if (visibleFraction < 0.65) setSheetSnap('half');
            else setSheetSnap('full');
        }
    };

    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);

    // Prevent touch scroll on the handle
    handle.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
}

function showMobileAnnotationInSheet(annotationId) {
    const sidebar = document.getElementById('metadata-sidebar');
    if (!sidebar) return;

    // Ensure sidebar is visible
    if (sidebar.classList.contains('hidden')) {
        showMetadataSidebar();
    }

    // Switch to Info tab
    switchSidebarMode('view');

    // Find the full annotation object
    const annotation = annotationSystem.getAnnotations().find(a => a.id === annotationId);
    if (annotation) {
        showMobileAnnotationDetail(annotation);
    }

    // Highlight the matching list item
    document.querySelectorAll('.kiosk-anno-item.active').forEach(c => c.classList.remove('active'));
    const item = document.querySelector(`.kiosk-anno-item[data-anno-id="${annotationId}"]`);
    if (item) item.classList.add('active');
}

function showMobileAnnotationDetail(annotation) {
    const sidebarView = document.getElementById('sidebar-view');
    if (!sidebarView) return;

    // Hide normal sidebar content
    const displayContent = sidebarView.querySelector('.display-content');
    if (displayContent) displayContent.style.display = 'none';

    // Create or reuse detail container
    let detail = document.getElementById('mobile-anno-detail');
    if (!detail) {
        detail = document.createElement('div');
        detail.id = 'mobile-anno-detail';
        sidebarView.appendChild(detail);
    }

    // Find annotation number from marker
    const marker = document.querySelector(`.annotation-marker[data-annotation-id="${annotation.id}"]`);
    const number = marker ? marker.textContent.trim() : '?';

    // Render full content
    const bodyHtml = parseMarkdown(resolveAssetRefs(annotation.body || '', state.imageAssets));

    // Determine prev/next availability
    const annotations = annotationSystem.getAnnotations();
    const currentIndex = annotations.findIndex(a => a.id === annotation.id);
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < annotations.length - 1;

    detail.innerHTML = `
        <div class="mobile-anno-nav">
            <button class="mobile-anno-nav-btn" id="mobile-anno-prev" ${hasPrev ? '' : 'disabled'}>&#8592; Prev</button>
            <button class="mobile-anno-nav-btn mobile-anno-return" id="mobile-anno-back">Return</button>
            <button class="mobile-anno-nav-btn" id="mobile-anno-next" ${hasNext ? '' : 'disabled'}>Next &#8594;</button>
        </div>
        <div class="mobile-anno-header">
            <span class="mobile-anno-number">${number}</span>
            <h2 class="mobile-anno-title">${annotation.title || 'Untitled'}</h2>
        </div>
        <div class="mobile-anno-body">${bodyHtml}</div>
    `;

    detail.style.display = 'flex';

    // Wire up nav buttons
    const backBtn = document.getElementById('mobile-anno-back');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            hideMobileAnnotationDetail();
        });
    }
    const prevBtn = document.getElementById('mobile-anno-prev');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => navigateAnnotation(-1));
    }
    const nextBtn = document.getElementById('mobile-anno-next');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => navigateAnnotation(1));
    }

    // Expand sheet to see content
    if (currentSheetSnap === 'peek') {
        setSheetSnap('half');
    }

    // Scroll to top of detail
    sidebarView.scrollTop = 0;
}

function hideMobileAnnotationDetail() {
    const detail = document.getElementById('mobile-anno-detail');
    if (detail) detail.style.display = 'none';

    // Show normal sidebar content again
    const displayContent = document.querySelector('#sidebar-view .display-content');
    if (displayContent) displayContent.style.display = '';

    // Re-render metadata to restore asset images (blob URLs may need re-resolving)
    populateMetadataDisplay({ state, annotationSystem, imageAssets: state.imageAssets });

    // Clear active annotation state
    currentPopupAnnotationId = null;
    annotationSystem.selectedAnnotation = null;
    document.querySelectorAll('.annotation-marker.selected').forEach(m => m.classList.remove('selected'));
    document.querySelectorAll('.kiosk-anno-item.active').forEach(c => c.classList.remove('active'));
}

function navigateAnnotation(direction) {
    const annotations = annotationSystem.getAnnotations();
    if (!annotations || annotations.length === 0) return;

    const currentIndex = annotations.findIndex(a => a.id === currentPopupAnnotationId);
    if (currentIndex === -1) return;

    const newIndex = currentIndex + direction;
    if (newIndex < 0 || newIndex >= annotations.length) return;

    const newAnno = annotations[newIndex];

    // Update sidebar list active state
    document.querySelectorAll('.kiosk-anno-item.active').forEach(c => c.classList.remove('active'));
    const item = document.querySelector(`.kiosk-anno-item[data-anno-id="${newAnno.id}"]`);
    if (item) item.classList.add('active');

    // Show single marker if annotations are globally hidden
    if (!state.annotationsVisible) {
        showSingleMarker(newAnno.id);
    }

    // Navigate camera and update detail view
    annotationSystem.goToAnnotation(newAnno.id);
    currentPopupAnnotationId = newAnno.id;
    showMobileAnnotationDetail(newAnno);
}

function repositionAnnotationToggle() {
    const annoBtn = document.getElementById('btn-toggle-annotations');
    if (!annoBtn) return;
    if (isMobileKiosk()) {
        // Move to body so position:fixed works (toolbar backdrop-filter creates containing block)
        if (annoBtn.parentElement !== document.body) {
            document.body.appendChild(annoBtn);
        }
    } else {
        // Return to toolbar on desktop
        const toolbar = document.getElementById('left-toolbar');
        if (toolbar && annoBtn.parentElement !== toolbar) {
            toolbar.appendChild(annoBtn);
        }
    }
}

function onWindowResize() {
    const container = document.getElementById('viewer-container');
    if (!container) return;
    sceneManager.onWindowResize(state.displayMode, container);

    // Move annotation toggle and view switcher based on viewport
    repositionAnnotationToggle();
    repositionViewSwitcher();

    // Reset sheet state when crossing mobile/desktop boundary
    const sidebar = document.getElementById('metadata-sidebar');
    if (!sidebar) return;
    if (isMobileKiosk()) {
        if (!sidebar.classList.contains('sheet-peek') &&
            !sidebar.classList.contains('sheet-half') &&
            !sidebar.classList.contains('sheet-full')) {
            setSheetSnap('peek');
        }
    } else {
        sidebar.classList.remove('sheet-peek', 'sheet-half', 'sheet-full', 'sheet-dragging');
        sidebar.style.transform = '';
    }
}

// =============================================================================
// VISUAL POLISH HELPERS
// =============================================================================

/**
 * Show branded loading screen with thumbnail, title, and content types.
 * Called after archive extraction but before 3D asset loading.
 */
async function showBrandedLoading(archiveLoader) {
    try {
        const manifest = await archiveLoader.parseManifest();
        const contentInfo = archiveLoader.getContentInfo();

        const brandEl = document.getElementById('loading-brand');
        const thumbEl = document.getElementById('loading-thumbnail');
        const titleEl = document.getElementById('loading-title');
        const typesEl = document.getElementById('loading-content-types');

        if (!brandEl) return;

        // Set title from manifest
        const title = manifest?.project?.title || manifest?._meta?.title || '';
        if (titleEl && title) {
            titleEl.textContent = title;
        } else if (titleEl) {
            titleEl.style.display = 'none';
        }

        // Set thumbnail from archive
        const thumbEntry = archiveLoader.getThumbnailEntry();
        if (thumbEntry && thumbEl) {
            const thumbData = await archiveLoader.extractFile(thumbEntry.file_name);
            if (thumbData) {
                thumbEl.src = thumbData.url;
            }
        }

        // Build content type labels
        const types = [];
        if (contentInfo.hasSplat) types.push('Gaussian Splat');
        if (contentInfo.hasMesh) types.push('Mesh');
        if (contentInfo.hasPointcloud) types.push('Point Cloud');
        if (typesEl && types.length > 0) {
            typesEl.textContent = types.join(' + ');
        } else if (typesEl) {
            typesEl.style.display = 'none';
        }

        // Show the branded section
        brandEl.classList.remove('hidden');

        updateProgress(20, 'Preparing scene...');
    } catch (e) {
        log.warn('Could not show branded loading:', e.message);
    }
}

/**
 * Smooth entry transition: fade out loading overlay while easing camera in.
 * Camera starts 15% further back than the fit position and eases to target.
 */
function smoothTransitionIn() {
    const overlay = document.getElementById('loading-overlay');
    const targetPos = camera.position.clone();
    const targetTarget = controls.target.clone();

    // Pull camera back 15% further for the ease-in start
    const direction = new THREE.Vector3().subVectors(targetPos, targetTarget).normalize();
    const pullback = targetPos.distanceTo(targetTarget) * 0.15;
    camera.position.add(direction.multiplyScalar(pullback));

    const startPos = camera.position.clone();
    const startTime = performance.now();
    const duration = 1200;
    entryTransitionActive = true;

    // Fade out the loading overlay with CSS transition
    if (overlay) {
        overlay.classList.add('fade-out');
        overlay.addEventListener('transitionend', () => {
            overlay.classList.add('hidden');
            overlay.classList.remove('fade-out');
        }, { once: true });
    }

    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    function animateEntry() {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = easeOutCubic(t);

        camera.position.lerpVectors(startPos, targetPos, eased);
        controls.update();

        if (t < 1) {
            requestAnimationFrame(animateEntry);
        } else {
            entryTransitionActive = false;
        }
    }

    requestAnimationFrame(animateEntry);
}

/**
 * Trigger the intro glow animation on all annotation markers.
 * Adds glow-intro class, removes it after the animation completes (~6s).
 */
function triggerMarkerGlowIntro() {
    const markers = document.querySelectorAll('.annotation-marker');
    markers.forEach(m => m.classList.add('glow-intro'));
    setTimeout(() => {
        markers.forEach(m => m.classList.remove('glow-intro'));
    }, 6500);
}

/**
 * Show only the marker for a specific annotation ID when annotations are globally hidden.
 */
function showSingleMarker(annotationId) {
    const markersContainer = document.getElementById('annotation-markers');
    if (!markersContainer) return;
    // Temporarily show the container
    markersContainer.style.display = '';
    // Hide all markers, then show only the target
    markersContainer.querySelectorAll('.annotation-marker').forEach(m => {
        m.style.display = 'none';
    });
    const target = markersContainer.querySelector(`.annotation-marker[data-annotation-id="${annotationId}"]`);
    if (target) target.style.display = 'flex';
}

/**
 * Re-hide markers container when in globally-hidden mode.
 */
function hideSingleMarker() {
    const markersContainer = document.getElementById('annotation-markers');
    if (markersContainer) {
        // Restore all markers to default display so toggle-on works correctly
        markersContainer.querySelectorAll('.annotation-marker').forEach(m => {
            m.style.display = '';
        });
        markersContainer.style.display = 'none';
    }
}

/**
 * Update the SVG connecting line from marker to popup.
 */
function updateAnnotationLine(annotationId) {
    if (!annotationLineEl || !annotationId) {
        hideAnnotationLine();
        return;
    }

    const marker = document.querySelector(`.annotation-marker[data-annotation-id="${annotationId}"]`);
    const popup = document.getElementById('annotation-info-popup');

    if (!marker || !popup || popup.classList.contains('hidden') ||
        marker.style.display === 'none') {
        hideAnnotationLine();
        return;
    }

    const markerRect = marker.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();

    const mx = markerRect.left + markerRect.width / 2;
    const my = markerRect.top + markerRect.height / 2;

    // Connect to the nearest edge of the popup with margin gap
    const lineMargin = 12; // gap between line end and marker/popup
    let px, py;
    let lx1, ly1; // line start (near marker)
    if (popupRect.left > mx) {
        // Popup is to the right of marker
        px = popupRect.left - lineMargin;
        py = Math.max(popupRect.top, Math.min(my, popupRect.bottom));
    } else {
        // Popup is to the left of marker
        px = popupRect.right + lineMargin;
        py = Math.max(popupRect.top, Math.min(my, popupRect.bottom));
    }

    // Offset line start away from marker center toward popup
    const dx = px - mx;
    const dy = py - my;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > lineMargin * 3) {
        const ratio = lineMargin / dist;
        lx1 = mx + dx * ratio;
        ly1 = my + dy * ratio;
    } else {
        lx1 = mx;
        ly1 = my;
    }

    annotationLineEl.setAttribute('x1', lx1);
    annotationLineEl.setAttribute('y1', ly1);
    annotationLineEl.setAttribute('x2', px);
    annotationLineEl.setAttribute('y2', py);
    annotationLineEl.style.display = '';
}

function hideAnnotationLine() {
    if (annotationLineEl) {
        annotationLineEl.style.display = 'none';
    }
}

// =============================================================================
// ANIMATION LOOP
// =============================================================================

function animate() {
    requestAnimationFrame(animate);

    try {
        if (state.flyModeActive) {
            flyControls.update();
        } else {
            controls.update();
        }

        sceneManager.render(state.displayMode, splatMesh, modelGroup, pointcloudGroup);

        // Update annotation marker screen positions (skip when globally hidden, unless single-marker is shown)
        if (annotationSystem.hasAnnotations()) {
            const markersContainer = document.getElementById('annotation-markers');
            const markersShown = !markersContainer || markersContainer.style.display !== 'none';
            if (markersShown) {
                annotationSystem.updateMarkerPositions();
            }
            updateAnnotationPopupPosition(currentPopupAnnotationId);
            updateAnnotationLine(currentPopupAnnotationId);
        }

        sceneManager.updateFPS(fpsElement);
    } catch (e) {
        // Silently handle animation errors to keep the loop running
    }
}
