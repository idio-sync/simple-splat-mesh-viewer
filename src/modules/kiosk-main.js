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
import { CAMERA, ASSET_STATE } from './constants.js';
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
    updateModelOpacity, updateModelWireframe, updateModelTextures,
    updatePointcloudPointSize, updatePointcloudOpacity
} from './file-handlers.js';
import {
    showMetadataSidebar, hideMetadataSidebar, switchSidebarMode,
    setupMetadataSidebar, prefillMetadataFromArchive,
    populateMetadataDisplay, updateArchiveMetadataUI,
    showAnnotationPopup, hideAnnotationPopup, updateAnnotationPopupPosition
} from './metadata-manager.js';

const log = Logger.getLogger('kiosk-main');

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
    imageAssets: new Map()
};

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
            return;
        }
        // Highlight the corresponding sidebar item
        document.querySelectorAll('.kiosk-anno-item.active').forEach(c => c.classList.remove('active'));
        const item = document.querySelector(`.kiosk-anno-item[data-anno-id="${annotation.id}"]`);
        if (item) item.classList.add('active');

        if (isMobileKiosk()) {
            currentPopupAnnotationId = annotation.id;
            showMobileAnnotationInSheet(annotation.id);
        } else {
            currentPopupAnnotationId = showAnnotationPopup(annotation, state.imageAssets);
        }
    };

    // Wire up UI
    setupViewerUI();
    setupMetadataSidebar({ state, annotationSystem, imageAssets: state.imageAssets });
    setupCollapsibles();
    setupViewerKeyboardShortcuts();

    // Apply initial display mode from config
    const config = window.APP_CONFIG || {};
    if (config.initialViewMode) {
        state.displayMode = config.initialViewMode;
    }
    setDisplayMode(state.displayMode, createDisplayModeDeps());

    // Hide editor-only UI
    hideEditorOnlyUI();

    // Handle window resize
    window.addEventListener('resize', onWindowResize);

    // Setup mobile bottom sheet drag
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
        log.info('Loading archive from URL:', config.defaultArchiveUrl);
        loadArchiveFromUrl(config.defaultArchiveUrl);
        return;
    }

    if (picker) picker.classList.remove('hidden');

    const btn = document.getElementById('kiosk-picker-btn');
    const input = document.getElementById('kiosk-picker-input');
    const dropZone = document.getElementById('kiosk-drop-zone');

    if (btn && input) {
        btn.addEventListener('click', () => input.click());
        input.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                hidePicker();
                state.archiveSourceUrl = null;
                handleArchiveFile(e.target.files[0]);
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
            const file = e.dataTransfer.files[0];
            if (file && /\.(a3d|a3z)$/i.test(file.name)) {
                hidePicker();
                state.archiveSourceUrl = null;
                handleArchiveFile(file);
            } else {
                notify.warning('Please select an .a3d or .a3z archive file.');
            }
        });
    }

    function hidePicker() {
        if (picker) picker.classList.add('hidden');
    }
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
        const { manifest, contentInfo } = phase1;

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

        // Create view switcher pill (only if 2+ asset types)
        createViewSwitcher();

        // Fit camera to loaded content
        fitCameraToScene();

        // Update info panel
        updateInfoPanel();

        // Show archive info section
        const archiveSection = document.getElementById('archive-metadata-section');
        if (archiveSection) archiveSection.style.display = '';

        updateProgress(100, 'Complete');

        // Smooth entry transition: fade overlay + camera ease-in
        smoothTransitionIn();

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
// DEPS BUILDERS (matching the deps pattern used by file-handlers.js)
// =============================================================================

function createArchiveDeps() {
    return {
        scene,
        modelGroup,
        pointcloudGroup,
        state,
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
        updateModelWireframe(modelGroup, e.target.checked);
    });
    addListener('model-no-texture', 'change', (e) => {
        updateModelTextures(modelGroup, !e.target.checked);
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

function setupViewerKeyboardShortcuts() {
    setupKeyboardShortcuts({
        'f': () => toggleFlyMode(),
        'm': () => {
            const sidebar = document.getElementById('metadata-sidebar');
            if (sidebar && !sidebar.classList.contains('hidden')) {
                hideMetadataSidebar();
            } else {
                showMetadataSidebar('view', { state, annotationSystem, imageAssets: state.imageAssets });
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

    // Update active button state
    document.querySelectorAll('.kiosk-view-btn').forEach(btn => {
        btn.classList.toggle('active', btn.dataset.mode === mode);
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

    // Connect to the nearest edge of the popup
    let px, py;
    if (popupRect.left > mx) {
        // Popup is to the right of marker
        px = popupRect.left;
        py = Math.max(popupRect.top, Math.min(my, popupRect.bottom));
    } else {
        // Popup is to the left of marker
        px = popupRect.right;
        py = Math.max(popupRect.top, Math.min(my, popupRect.bottom));
    }

    annotationLineEl.setAttribute('x1', mx);
    annotationLineEl.setAttribute('y1', my);
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
