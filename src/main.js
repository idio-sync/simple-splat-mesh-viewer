// ES Module imports (these are hoisted - execute first before any other code)
import * as THREE from 'three';
import { SplatMesh } from '@sparkjsdev/spark';
import { ArchiveLoader, isArchiveFile } from './modules/archive-loader.js';
// hasAnyProxy moved to archive-pipeline.ts (Phase 2.2)
import { AnnotationSystem } from './modules/annotation-system.js';
import { ArchiveCreator, captureScreenshot, CRYPTO_AVAILABLE } from './modules/archive-creator.js';
import { CAMERA, TIMING, ASSET_STATE, MESH_LOD } from './modules/constants.js';
import { Logger, notify } from './modules/utilities.js';
import { FlyControls } from './modules/fly-controls.js';
import { getStore } from './modules/asset-store.js';
import { SceneManager } from './modules/scene-manager.js';
import {
    LandmarkAlignment,
    autoCenterAlign as autoCenterAlignHandler,
    fitToView as fitToViewHandler,
    resetAlignment as resetAlignmentHandler,
    resetCamera as resetCameraHandler,
    centerModelOnGrid,
    saveAlignment as saveAlignmentHandler,
    applyAlignmentData as applyAlignmentDataHandler,
    loadAlignment as loadAlignmentHandler,
    loadAlignmentFromUrl as loadAlignmentFromUrlHandler
} from './modules/alignment.js';
import {
    showLoading,
    hideLoading,
    updateProgress,
    addListener,
    showInlineLoading,
    hideInlineLoading,
    hideExportPanel,
    setDisplayMode as setDisplayModeHandler,
    updateVisibility as updateVisibilityHandler,
    updateTransformInputs as updateTransformInputsHandler,
    showExportPanel as showExportPanelHandler,
    applyControlsMode as applyControlsModeHandler,
    toggleControlsPanel as toggleControlsPanelHandler,
    applyControlsVisibility as applyControlsVisibilityHandler,
    ensureToolbarVisibility as ensureToolbarVisibilityHandler,
    applyViewerModeSettings as applyViewerModeSettingsHandler
} from './modules/ui-controller.js';
import {
    formatFileSize,
    switchEditTab,
    addProcessingSoftware,
    addRelatedObject,
    collectMetadata,
    hideMetadataSidebar,
    addVersionEntry,
    setupFieldValidation,
    showMetadataSidebar as showMetadataSidebarHandler,
    switchSidebarMode as switchSidebarModeHandler,
    toggleMetadataDisplay as toggleMetadataDisplayHandler,
    populateMetadataDisplay as populateMetadataDisplayHandler,
    updateMetadataStats as updateMetadataStatsHandler,
    updateAssetStatus as updateAssetStatusHandler,
    clearArchiveMetadata as clearArchiveMetadataHandler,
    showAnnotationPopup as showAnnotationPopupHandler,
    updateAnnotationPopupPosition as updateAnnotationPopupPositionHandler,
    hideAnnotationPopup as hideAnnotationPopupHandler,
    setupMetadataSidebar as setupMetadataSidebarHandler,
    prefillMetadataFromArchive as prefillMetadataFromArchiveHandler
} from './modules/metadata-manager.js';
import {
    loadSplatFromFile as loadSplatFromFileHandler,
    loadSplatFromUrl as loadSplatFromUrlHandler,
    loadModelFromFile as loadModelFromFileHandler,
    loadModelFromUrl as loadModelFromUrlHandler,
    loadPointcloudFromFile as loadPointcloudFromFileHandler,
    loadPointcloudFromUrl as loadPointcloudFromUrlHandler,
    getAssetTypesForMode,
    updateModelOpacity as updateModelOpacityFn,
    updateModelWireframe as updateModelWireframeFn,
    updateModelMatcap as updateModelMatcapFn,
    updateModelNormals as updateModelNormalsFn,
    updateModelRoughness as updateModelRoughnessFn,
    updateModelMetalness as updateModelMetalnessFn,
    updateModelSpecularF0 as updateModelSpecularF0Fn,
    loadSTLFile as loadSTLFileHandler,
    loadSTLFromUrlWithDeps as loadSTLFromUrlWithDepsHandler
} from './modules/file-handlers.js';
import {
    initShareDialog,
    showShareDialog
} from './modules/share-dialog.js';
import {
    captureScreenshotToList as captureScreenshotToListHandler,
    showViewfinder as showViewfinderHandler,
    hideViewfinder as hideViewfinderHandler,
    captureManualPreview as captureManualPreviewHandler,
    renderScreenshotsList as renderScreenshotsListHandler,
    removeScreenshot as removeScreenshotHandler
} from './modules/screenshot-manager.js';
import {
    setSelectedObject as setSelectedObjectHandler,
    syncBothObjects as syncBothObjectsHandler,
    storeLastPositions as storeLastPositionsHandler,
    setTransformMode as setTransformModeHandler
} from './modules/transform-controller.js';
import {
    getCurrentPopupAnnotationId,
    dismissPopup as dismissPopupHandler,
    onAnnotationPlaced as onAnnotationPlacedHandler,
    onAnnotationSelected as onAnnotationSelectedHandler,
    onPlacementModeChanged as onPlacementModeChangedHandler,
    toggleAnnotationMode as toggleAnnotationModeHandler,
    saveAnnotation as saveAnnotationHandler,
    cancelAnnotation as cancelAnnotationHandler,
    updateSelectedAnnotationCamera as updateSelectedAnnotationCameraHandler,
    deleteSelectedAnnotation as deleteSelectedAnnotationHandler,
    updateAnnotationsUI as updateAnnotationsUIHandler,
    updateSidebarAnnotationsList as updateSidebarAnnotationsListHandler,
    loadAnnotationsFromArchive as loadAnnotationsFromArchiveHandler
} from './modules/annotation-controller.js';
import {
    showExportPanel as showExportPanelCtrl,
    updateArchiveAssetCheckboxes as updateArchiveAssetCheckboxesCtrl,
    downloadArchive as downloadArchiveCtrl,
    downloadGenericViewer as downloadGenericViewerCtrl,
    exportMetadataManifest as exportMetadataManifestCtrl,
    importMetadataManifest as importMetadataManifestCtrl
} from './modules/export-controller.js';
import {
    handleArchiveFile as handleArchiveFileCtrl,
    loadArchiveFromUrl as loadArchiveFromUrlCtrl,
    ensureAssetLoaded as ensureAssetLoadedCtrl,
    processArchive as processArchiveCtrl,
    applyViewerSettings as applyViewerSettingsCtrl,
    clearArchiveMetadata as clearArchiveMetadataCtrl,
    switchQualityTier as switchQualityTierCtrl,
    handleLoadFullResMesh as handleLoadFullResMeshCtrl
} from './modules/archive-pipeline.js';
import {
    setupUIEvents as setupUIEventsCtrl
} from './modules/event-wiring.js';
// kiosk-viewer.js is loaded dynamically in downloadGenericViewer() to avoid
// blocking the main application if the module fails to load.

// Tauri desktop integration (lazy-loaded to avoid errors in browser)
let tauriBridge = null;
if (window.__TAURI__) {
    import('./modules/tauri-bridge.js').then(mod => {
        tauriBridge = mod;
        console.log('[main.js] Tauri bridge loaded — native dialogs available');
    }).catch(err => {
        console.warn('[main.js] Tauri bridge failed to load:', err);
    });
}

// Create logger for this module
const log = Logger.getLogger('main.js');

// Mark module as loaded (for pre-module error detection)
window.moduleLoaded = true;
log.info('Module loaded successfully, THREE:', !!THREE, 'SplatMesh:', !!SplatMesh);

// Expose THREE globally for debugging and potential library compatibility
window.THREE = THREE;
log.debug('THREE.REVISION:', THREE.REVISION);

// Expose notify for use by dynamically loaded modules (share dialog, etc.)
window.notify = notify;

// Global error handler for runtime errors
window.onerror = function(message, source, lineno, colno, error) {
    log.error(' Runtime error:', message, 'at', source, 'line', lineno);
    return false;
};

// Get configuration from window (set by config.js)
const config = window.APP_CONFIG || {
    defaultArchiveUrl: '',
    defaultSplatUrl: '',
    defaultModelUrl: '',
    defaultPointcloudUrl: '',
    defaultAlignmentUrl: '',
    inlineAlignment: null,
    showControls: true,
    showToolbar: true, // Default to showing toolbar
    controlsMode: 'full', // full, minimal, none
    initialViewMode: 'both' // splat, model, both, split
};

// =============================================================================
// URL VALIDATION - Security measure for user-provided URLs
// =============================================================================

// Allowed external domains — reads from APP_CONFIG (set by config.js / Docker env var)
// Falls back to empty array for local dev without config.js
const ALLOWED_EXTERNAL_DOMAINS = window.APP_CONFIG?.allowedDomains || [];

/**
 * Validates a URL to prevent loading from untrusted sources.
 * Used for URLs entered by users via prompt dialogs.
 *
 * @param {string} urlString - The URL string to validate
 * @param {string} resourceType - Type of resource (for error messages)
 * @returns {{valid: boolean, url: string, error: string}} - Validation result
 */
function validateUserUrl(urlString, resourceType) {
    if (!urlString || urlString.trim() === '') {
        return { valid: false, url: '', error: 'URL is empty' };
    }

    try {
        // Parse the URL (relative URLs resolved against current origin)
        const url = new URL(urlString.trim(), window.location.origin);

        // Block dangerous protocols
        const allowedProtocols = ['http:', 'https:'];
        if (!allowedProtocols.includes(url.protocol)) {
            return {
                valid: false,
                url: '',
                error: `Unsafe protocol "${url.protocol}" is not allowed. Use http: or https:`
            };
        }

        // Check if same-origin
        const isSameOrigin = url.origin === window.location.origin;

        // Check if domain is in allowed list
        const isAllowedExternal = ALLOWED_EXTERNAL_DOMAINS.some(domain => {
            if (domain.startsWith('*.')) {
                const baseDomain = domain.slice(2);
                return url.hostname === baseDomain || url.hostname.endsWith('.' + baseDomain);
            }
            return url.hostname === domain;
        });

        if (!isSameOrigin && !isAllowedExternal) {
            return {
                valid: false,
                url: '',
                error: `External domain "${url.hostname}" is not allowed.\n\nOnly same-origin URLs are permitted by default. Contact the administrator to allow this domain.`
            };
        }

        // Enforce HTTPS for external URLs when page is served over HTTPS
        if (!isSameOrigin && window.location.protocol === 'https:' && url.protocol !== 'https:') {
            return {
                valid: false,
                url: '',
                error: 'External URLs must use HTTPS when the viewer is served over HTTPS.'
            };
        }

        console.info(`[main.js] Validated ${resourceType} URL:`, url.href);
        return { valid: true, url: url.href, error: '' };

    } catch (e) {
        return {
            valid: false,
            url: '',
            error: `Invalid URL format: ${e.message}`
        };
    }
}

// Global state
const state = {
    displayMode: config.initialViewMode || 'model', // 'splat', 'model', 'pointcloud', 'both', 'split'
    selectedObject: 'none', // 'splat', 'model', 'both', 'none'
    transformMode: 'translate', // 'translate', 'rotate', 'scale'
    splatLoaded: false,
    modelLoaded: false,
    pointcloudLoaded: false,
    stlLoaded: false,
    modelOpacity: 1,
    modelWireframe: false,
    modelMatcap: false,
    matcapStyle: 'clay',
    modelNormals: false,
    modelRoughness: false,
    modelMetalness: false,
    modelSpecularF0: false,
    pointcloudPointSize: 0.01,
    pointcloudOpacity: 1,
    controlsVisible: config.showControls,
    currentSplatUrl: config.defaultSplatUrl || null,
    currentModelUrl: config.defaultModelUrl || null,
    currentPointcloudUrl: config.defaultPointcloudUrl || null,
    // Archive state
    archiveLoaded: false,
    archiveManifest: null,
    archiveFileName: null,
    currentArchiveUrl: config.defaultArchiveUrl || null,
    archiveLoader: null,
    // Per-asset loading state for lazy archive extraction
    assetStates: { splat: ASSET_STATE.UNLOADED, mesh: ASSET_STATE.UNLOADED, pointcloud: ASSET_STATE.UNLOADED },
    // Whether the currently displayed mesh is a proxy (display-quality LOD)
    viewingProxy: false,
    // Quality tier (main app defaults to HD — authoring tool)
    qualityTier: 'hd',
    qualityResolved: 'hd',
    // Embedded images for annotation/description markdown
    imageAssets: new Map(),
    // Screenshot captures for archive export
    screenshots: [],          // Array of { id, blob, dataUrl, timestamp }
    manualPreviewBlob: null   // If set, overrides auto-capture during export
};

// Scene manager instance (handles scene, camera, renderer, controls, lighting)
let sceneManager = null;

// Three.js objects - Main view (references extracted from SceneManager for backward compatibility)
let scene, camera, renderer, controls, transformControls;
let flyControls = null;
let splatMesh = null;
let modelGroup = null;
let pointcloudGroup = null;
let stlGroup = null;
let ambientLight, hemisphereLight, directionalLight1, directionalLight2;

// Annotation, alignment, and archive creation
let annotationSystem = null;
let landmarkAlignment = null;
let archiveCreator = null;

// Asset blob store (ES module singleton — shared with archive-pipeline, export-controller, etc.)
const assets = getStore();

// Dynamic getter object for mutable Three.js references — prevents stale-reference bugs
// when splatMesh/modelGroup etc. are reassigned after loading new files.
// Pass to extracted modules instead of individual objects.
const sceneRefs = {
    get scene() { return scene; },
    get camera() { return camera; },
    get renderer() { return renderer; },
    get controls() { return controls; },
    get transformControls() { return transformControls; },
    get splatMesh() { return splatMesh; },
    get modelGroup() { return modelGroup; },
    get pointcloudGroup() { return pointcloudGroup; },
    get stlGroup() { return stlGroup; },
    get flyControls() { return flyControls; },
    get annotationSystem() { return annotationSystem; },
    get archiveCreator() { return archiveCreator; },
    get landmarkAlignment() { return landmarkAlignment; },
    get ambientLight() { return ambientLight; },
    get hemisphereLight() { return hemisphereLight; },
    get directionalLight1() { return directionalLight1; },
    get directionalLight2() { return directionalLight2; }
};

// Three.js objects - Split view (right side)
let rendererRight = null;
let controlsRight = null;

// DOM elements (with null checks for debugging)
const canvas = document.getElementById('viewer-canvas');
const canvasRight = document.getElementById('viewer-canvas-right');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

log.info(' DOM elements found:', {
    canvas: !!canvas,
    canvasRight: !!canvasRight,
    loadingOverlay: !!loadingOverlay,
    loadingText: !!loadingText
});

// Helper function to create dependencies object for file-handlers.js
function createFileHandlerDeps() {
    return {
        scene,
        modelGroup,
        stlGroup,
        getSplatMesh: () => splatMesh,
        setSplatMesh: (mesh) => { splatMesh = mesh; },
        getModelGroup: () => modelGroup,
        state,
        archiveCreator,
        callbacks: {
            onSplatLoaded: (mesh, file) => {
                // Auto-switch display mode to show the newly loaded splat
                if (state.modelLoaded && state.displayMode === 'model') {
                    setDisplayMode('both');
                } else if (!state.modelLoaded && state.displayMode !== 'splat') {
                    setDisplayMode('splat');
                }
                updateVisibility();
                updateTransformInputs();
                storeLastPositions();
                assets.splatBlob = file;
                document.getElementById('splat-vertices').textContent = 'Loaded';
                // Auto center-align if model is already loaded
                if (state.modelLoaded) {
                    setTimeout(() => autoCenterAlign(), TIMING.AUTO_ALIGN_DELAY);
                }
                clearArchiveMetadata();
            },
            onModelLoaded: (object, file, faceCount) => {
                // Auto-switch display mode to show the newly loaded model
                if (state.splatLoaded && state.displayMode === 'splat') {
                    setDisplayMode('both');
                } else if (!state.splatLoaded && state.displayMode !== 'model') {
                    setDisplayMode('model');
                }
                updateModelOpacity();
                updateModelWireframe();
                updateVisibility();
                updateTransformInputs();
                storeLastPositions();
                assets.meshBlob = file;
                document.getElementById('model-faces').textContent = (faceCount || 0).toLocaleString();
                // Advisory face count warnings
                if (faceCount > MESH_LOD.DESKTOP_WARNING_FACES) {
                    notify.warning(`Mesh has ${faceCount.toLocaleString()} faces. A display proxy is recommended for broad device support.`);
                } else if (faceCount > MESH_LOD.MOBILE_WARNING_FACES) {
                    notify.info(`Mesh has ${faceCount.toLocaleString()} faces — may not display on mobile/tablet. Consider adding a display proxy.`);
                }
                // Auto center-align if splat is already loaded, otherwise center on grid
                if (state.splatLoaded) {
                    setTimeout(() => autoCenterAlign(), TIMING.AUTO_ALIGN_DELAY);
                } else {
                    // Center model on grid when loaded standalone
                    setTimeout(() => centerModelOnGrid(modelGroup), TIMING.AUTO_ALIGN_DELAY);
                }
                clearArchiveMetadata();
            },
            onSTLLoaded: (object, file, faceCount) => {
                // Switch to STL display mode
                setDisplayMode('stl');
                updateVisibility();
                updateTransformInputs();
                storeLastPositions();
                const filenameEl = document.getElementById('stl-filename');
                if (filenameEl) filenameEl.textContent = file.name || 'STL loaded';
                // Center STL on grid
                setTimeout(() => centerModelOnGrid(stlGroup), TIMING.AUTO_ALIGN_DELAY);
            }
        }
    };
}

// Helper function to create dependencies object for alignment.js
function createAlignmentDeps() {
    return {
        splatMesh,
        modelGroup,
        pointcloudGroup,
        camera,
        controls,
        state,
        showLoading,
        hideLoading,
        updateTransformInputs,
        storeLastPositions,
        initialPosition: CAMERA.INITIAL_POSITION
    };
}

// Helper function to create dependencies object for annotation-controller.js
function createAnnotationControllerDeps() {
    return {
        annotationSystem,
        showAnnotationPopup: (annotation) => {
            const id = showAnnotationPopupHandler(annotation, state.imageAssets);
            updateAnnotationPopupPositionHandler(id);
            return id;
        },
        hideAnnotationPopup: () => {
            hideAnnotationPopupHandler();
        }
    };
}

// Helper function to create dependencies object for metadata-manager.js
function createMetadataDeps() {
    return {
        state,
        annotationSystem,
        imageAssets: state.imageAssets,
        currentSplatBlob: assets.splatBlob,
        currentMeshBlob: assets.meshBlob,
        currentPointcloudBlob: assets.pointcloudBlob,
        updateAnnotationsList: updateSidebarAnnotationsList,
        onAddAnnotation: toggleAnnotationMode,
        onUpdateAnnotationCamera: updateSelectedAnnotationCamera,
        onDeleteAnnotation: deleteSelectedAnnotation,
        onAnnotationUpdated: () => { updateAnnotationsUI(); updateSidebarAnnotationsList(); }
    };
}

// Helper function to create dependencies object for export-controller.ts
function createExportDeps() {
    return {
        sceneRefs,
        state,
        tauriBridge,
        ui: {
            showLoading,
            hideLoading,
            updateProgress,
            hideExportPanel,
            showExportPanelHandler,
            showMetadataPanel
        },
        metadata: {
            collectMetadata,
            prefillMetadataFromArchive,
            populateMetadataDisplay,
            loadAnnotationsFromArchive
        }
    };
}

// Helper function to create dependencies object for archive-pipeline.ts
function createArchivePipelineDeps() {
    return {
        sceneRefs,
        state,
        sceneManager,
        setSplatMesh: (mesh) => { splatMesh = mesh; },
        createFileHandlerDeps,
        ui: {
            showLoading,
            hideLoading,
            showInlineLoading,
            hideInlineLoading,
            updateVisibility,
            updateTransformInputs,
            updateModelOpacity,
            updateModelWireframe
        },
        alignment: {
            applyAlignmentData,
            storeLastPositions
        },
        annotations: {
            loadAnnotationsFromArchive
        },
        metadata: {
            prefillMetadataFromArchive,
            clearArchiveMetadataHandler
        },
        sourceFiles: {
            updateSourceFilesUI
        }
    };
}

// Helper function to create dependencies object for event-wiring.ts
function createEventWiringDeps() {
    return {
        sceneRefs,
        state,
        sceneManager,
        files: {
            handleSplatFile, handleModelFile, handleArchiveFile,
            handlePointcloudFile, handleProxyMeshFile, handleProxySplatFile,
            handleSTLFile, handleSourceFilesInput,
            handleLoadSplatFromUrlPrompt, handleLoadModelFromUrlPrompt,
            handleLoadPointcloudFromUrlPrompt, handleLoadArchiveFromUrlPrompt,
            handleLoadSTLFromUrlPrompt, handleLoadFullResMesh, switchQualityTier
        },
        display: {
            setDisplayMode, updateModelOpacity, updateModelWireframe,
            updateModelMatcap, updateModelNormals, updateModelRoughnessView,
            updateModelMetalnessView, updateModelSpecularF0View,
            toggleGridlines, setBackgroundColor
        },
        camera: { resetCamera, fitToView, toggleFlyMode },
        alignment: { resetAlignment, toggleAlignment },
        annotations: {
            toggleAnnotationMode, saveAnnotation, cancelAnnotation,
            updateSelectedAnnotationCamera, deleteSelectedAnnotation,
            dismissPopup: () => dismissPopupHandler(createAnnotationControllerDeps())
        },
        export: { showExportPanel, downloadArchive, downloadGenericViewer },
        screenshots: { captureScreenshotToList, showViewfinder, captureManualPreview, hideViewfinder },
        metadata: { hideMetadataPanel, toggleMetadataDisplay, setupMetadataSidebar },
        share: { copyShareLink },
        controls: { toggleControlsPanel },
        tauri: {
            wireNativeDialogsIfAvailable: () => {
                if (window.__TAURI__ && tauriBridge) {
                    wireNativeFileDialogs();
                } else if (window.__TAURI__) {
                    import('./modules/tauri-bridge.js').then(mod => {
                        tauriBridge = mod;
                        wireNativeFileDialogs();
                    }).catch(() => {});
                }
            }
        }
    };
}

// Initialize the scene
function init() {
    log.info(' init() starting...');

    // Verify required DOM elements
    if (!canvas) {
        log.error(' FATAL: viewer-canvas not found!');
        return;
    }
    if (!canvasRight) {
        log.error(' FATAL: viewer-canvas-right not found!');
        return;
    }

    // Create and initialize SceneManager
    sceneManager = new SceneManager();
    if (!sceneManager.init(canvas, canvasRight)) {
        log.error(' FATAL: SceneManager initialization failed!');
        return;
    }

    // Extract objects to global variables for backward compatibility
    scene = sceneManager.scene;
    camera = sceneManager.camera;
    renderer = sceneManager.renderer;
    rendererRight = sceneManager.rendererRight;
    controls = sceneManager.controls;
    controlsRight = sceneManager.controlsRight;
    transformControls = sceneManager.transformControls;
    ambientLight = sceneManager.ambientLight;
    hemisphereLight = sceneManager.hemisphereLight;
    directionalLight1 = sceneManager.directionalLight1;
    directionalLight2 = sceneManager.directionalLight2;
    modelGroup = sceneManager.modelGroup;
    pointcloudGroup = sceneManager.pointcloudGroup;
    stlGroup = sceneManager.stlGroup;

    // Initialize fly camera controls (disabled by default, orbit mode is default)
    flyControls = new FlyControls(camera, renderer.domElement);

    // Set up SceneManager callbacks for transform controls
    sceneManager.onTransformChange = () => {
        updateTransformInputs();
        // If both selected, sync the other object
        if (state.selectedObject === 'both') {
            syncBothObjects();
        }
    };

    // Initialize annotation system
    annotationSystem = new AnnotationSystem(scene, camera, renderer, controls);
    annotationSystem.onAnnotationCreated = onAnnotationPlaced;
    annotationSystem.onAnnotationSelected = onAnnotationSelected;
    annotationSystem.onPlacementModeChanged = onPlacementModeChanged;
    log.info(' Annotation system initialized:', !!annotationSystem);

    // Initialize landmark alignment system
    landmarkAlignment = new LandmarkAlignment({
        scene, camera, renderer, controls,
        splatMesh, modelGroup,
        updateTransformInputs, storeLastPositions
    });
    addListener('btn-alignment-cancel', 'click', () => {
        if (landmarkAlignment.isActive()) {
            landmarkAlignment.cancel();
            notify.info('Alignment cancelled');
        }
    });

    // Initialize archive creator
    archiveCreator = new ArchiveCreator();

    // Check crypto availability and warn user
    if (!CRYPTO_AVAILABLE) {
        notify.warning('SHA-256 hashing is unavailable (requires HTTPS). Archives will be created without integrity verification.');
        const banner = document.getElementById('crypto-warning-banner');
        if (banner) banner.classList.remove('hidden');
    }

    // Handle resize
    window.addEventListener('resize', onWindowResize);

    // Keyboard shortcuts
    window.addEventListener('keydown', onKeyDown);

    // Setup UI events (delegated to event-wiring.ts)
    setupUIEventsCtrl(createEventWiringDeps());

    // Initialize share dialog
    initShareDialog();

    // Apply initial controls visibility and mode
    applyControlsVisibility();
    applyControlsMode();

    // Show grid by default
    toggleGridlines(true);

    // Apply viewer mode settings (toolbar visibility, sidebar state)
    applyViewerModeSettings();

    // Set initial display mode from config
    setDisplayMode(state.displayMode);

    // Load default files if configured
    loadDefaultFiles();

    // Start render loop
    animate();

    // Ensure toolbar visibility is maintained after all initialization
    // This safeguard addresses potential race conditions with async file loading
    ensureToolbarVisibility();

    log.info(' init() completed successfully');
}

function onWindowResize() {
    const container = document.getElementById('viewer-container');
    if (sceneManager) {
        sceneManager.onWindowResize(state.displayMode, container);
    }
}

function onKeyDown(event) {
    // Don't handle transform shortcuts when fly mode is active
    // (WASD/Q/E are used for camera movement in fly mode)
    if (flyControls && flyControls.enabled) {
        if (event.key === 'Escape') {
            toggleFlyMode(); // ESC exits fly mode
        }
        return;
    }

    switch (event.key.toLowerCase()) {
        case 'w':
            setTransformMode('translate');
            break;
        case 'e':
            setTransformMode('rotate');
            break;
        case 'r':
            setTransformMode('scale');
            break;
        case 'escape':
            setSelectedObject('none');
            break;
    }
}

// ==================== Fly Camera Mode ====================

function toggleFlyMode() {
    if (!flyControls) return;

    const btn = document.getElementById('btn-fly-mode');
    const hint = document.getElementById('fly-mode-hint');
    const isActive = flyControls.enabled;

    if (isActive) {
        // Disable fly mode, re-enable orbit
        flyControls.disable();
        controls.connect();
        controls.enabled = true;
        if (controlsRight) { controlsRight.connect(); controlsRight.enabled = true; }
        // Re-sync orbit controls target to where camera is looking
        const dir = new THREE.Vector3();
        camera.getWorldDirection(dir);
        controls.target.copy(camera.position).add(dir.multiplyScalar(5));
        controls.update();
        if (btn) btn.classList.remove('active');
        if (hint) hint.classList.add('hidden');
        log.info('Switched to Orbit camera mode');
    } else {
        // Enable fly mode, disable orbit
        controls.enabled = false;
        controls.disconnect();
        if (controlsRight) { controlsRight.enabled = false; controlsRight.disconnect(); }
        flyControls.enable();
        if (btn) btn.classList.add('active');
        if (hint) hint.classList.remove('hidden');
        log.info('Switched to Fly camera mode');
    }
}

// setupUIEvents extracted to event-wiring.ts (Phase 2, Step 2.5)

function setDisplayMode(mode) {
    setDisplayModeHandler(mode, {
        state,
        canvasRight,
        onResize: onWindowResize,
        updateVisibility
    });

    // Lazy-load any archive assets needed for this mode that aren't loaded yet
    if (state.archiveLoaded && state.archiveLoader) {
        const neededTypes = getAssetTypesForMode(mode);
        for (const type of neededTypes) {
            if (state.assetStates[type] === ASSET_STATE.UNLOADED) {
                ensureAssetLoaded(type).then(loaded => {
                    if (loaded) {
                        updateVisibility();
                        updateTransformInputs();
                    }
                });
            }
        }
    }
}

// Toggle gridlines visibility
function toggleGridlines(show) {
    if (sceneManager) {
        sceneManager.toggleGrid(show);
    }
}

// Set background color
function setBackgroundColor(hexColor) {
    if (sceneManager) {
        sceneManager.setBackgroundColor(hexColor);
    }
}

// Transform controls (delegated to transform-controller.js)
function setSelectedObject(selection) {
    setSelectedObjectHandler(selection, { transformControls, splatMesh, modelGroup, state });
}

function syncBothObjects() {
    syncBothObjectsHandler({ transformControls, splatMesh, modelGroup, pointcloudGroup });
}

function storeLastPositions() {
    storeLastPositionsHandler({ splatMesh, modelGroup, pointcloudGroup });
}

function setTransformMode(mode) {
    setTransformModeHandler(mode, { transformControls, state, splatMesh, modelGroup, pointcloudGroup });
}

function updateVisibility() {
    updateVisibilityHandler(state.displayMode, splatMesh, modelGroup, pointcloudGroup, stlGroup);
}

function updateTransformInputs() {
    updateTransformInputsHandler(splatMesh, modelGroup, pointcloudGroup);
}

// Handle loading splat from URL via prompt
function handleLoadSplatFromUrlPrompt() {
    log.info(' handleLoadSplatFromUrlPrompt called');
    const url = prompt('Enter Gaussian Splat URL:');
    log.info(' User entered:', url);
    if (!url) return; // User cancelled or entered empty string

    // Validate URL before loading
    const validation = validateUserUrl(url, 'splat');
    if (!validation.valid) {
        notify.error('Cannot load splat: ' + validation.error);
        return;
    }

    loadSplatFromUrl(validation.url);
}

// Handle loading model from URL via prompt
function handleLoadModelFromUrlPrompt() {
    log.info(' handleLoadModelFromUrlPrompt called');
    const url = prompt('Enter 3D Model URL (.glb, .gltf, .obj):');
    log.info(' User entered:', url);
    if (!url) return; // User cancelled or entered empty string

    // Validate URL before loading
    const validation = validateUserUrl(url, 'model');
    if (!validation.valid) {
        notify.error('Cannot load model: ' + validation.error);
        return;
    }

    loadModelFromUrl(validation.url);
}

// Handle loading point cloud from URL via prompt
function handleLoadPointcloudFromUrlPrompt() {
    log.info(' handleLoadPointcloudFromUrlPrompt called');
    const url = prompt('Enter E57 Point Cloud URL (.e57):');
    log.info(' User entered:', url);
    if (!url) return;

    const validation = validateUserUrl(url, 'pointcloud');
    if (!validation.valid) {
        notify.error('Cannot load point cloud: ' + validation.error);
        return;
    }

    loadPointcloudFromUrl(validation.url);
}

// Handle loading archive from URL via prompt
function handleLoadArchiveFromUrlPrompt() {
    log.info(' handleLoadArchiveFromUrlPrompt called');
    const url = prompt('Enter Archive URL (.a3d, .a3z):');
    log.info(' User entered:', url);
    if (!url) return;

    // Validate URL before loading
    const validation = validateUserUrl(url, 'archive');
    if (!validation.valid) {
        notify.error('Cannot load archive: ' + validation.error);
        return;
    }

    loadArchiveFromUrl(validation.url);
}

// Handle point cloud file input
async function handlePointcloudFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    document.getElementById('pointcloud-filename').textContent = file.name;
    showLoading('Loading point cloud...');

    try {
        await loadPointcloudFromFileHandler(file, createPointcloudDeps());
        hideLoading();
    } catch (error) {
        log.error('Error loading point cloud:', error);
        hideLoading();
        notify.error('Error loading point cloud: ' + error.message);
    }
}

// Handle archive file input (delegated to archive-pipeline.ts)
async function handleArchiveFile(event) { return handleArchiveFileCtrl(event, createArchivePipelineDeps()); }

// Load archive from URL (delegated to archive-pipeline.ts)
async function loadArchiveFromUrl(url) { return loadArchiveFromUrlCtrl(url, createArchivePipelineDeps()); }

// Ensure archive asset loaded (delegated to archive-pipeline.ts)
async function ensureAssetLoaded(assetType) { return ensureAssetLoadedCtrl(assetType, createArchivePipelineDeps()); }

// Process loaded archive (delegated to archive-pipeline.ts)
async function processArchive(archiveLoader, archiveName) { return processArchiveCtrl(archiveLoader, archiveName, createArchivePipelineDeps()); }

// Apply viewer settings (delegated to archive-pipeline.ts)
function applyViewerSettings(settings) { applyViewerSettingsCtrl(settings, createArchivePipelineDeps()); }

// Clear archive metadata (delegated to archive-pipeline.ts)
function clearArchiveMetadata() { clearArchiveMetadataCtrl(createArchivePipelineDeps()); }

// ==================== Annotation Functions ====================

// Called when user places an annotation (clicks on model in placement mode)
function onAnnotationPlaced(position, cameraState) {
    onAnnotationPlacedHandler(position, cameraState, createAnnotationControllerDeps());
}

// Called when an annotation is selected
function onAnnotationSelected(annotation) {
    onAnnotationSelectedHandler(annotation, createAnnotationControllerDeps());
}

// Called when placement mode changes
function onPlacementModeChanged(active) {
    onPlacementModeChangedHandler(active);
}

// Toggle annotation placement mode
function toggleAnnotationMode() {
    toggleAnnotationModeHandler(createAnnotationControllerDeps());
}

// Save the pending annotation
function saveAnnotation() {
    saveAnnotationHandler(createAnnotationControllerDeps());
}

// Cancel annotation placement
function cancelAnnotation() {
    cancelAnnotationHandler(createAnnotationControllerDeps());
}

// Update camera for selected annotation
function updateSelectedAnnotationCamera() {
    updateSelectedAnnotationCameraHandler(createAnnotationControllerDeps());
}

// Delete selected annotation
function deleteSelectedAnnotation() {
    deleteSelectedAnnotationHandler(createAnnotationControllerDeps());
}

// Update annotations UI (list and bar)
function updateAnnotationsUI() {
    updateAnnotationsUIHandler(createAnnotationControllerDeps());
}

// Update sidebar annotations list - delegates to annotation-controller.js
function updateSidebarAnnotationsList() {
    updateSidebarAnnotationsListHandler(createAnnotationControllerDeps());
}

// Load annotations from archive - delegates to annotation-controller.js
function loadAnnotationsFromArchive(annotations) {
    loadAnnotationsFromArchiveHandler(annotations, createAnnotationControllerDeps());
}

// ==================== Export/Archive Creation Functions (delegated to export-controller.ts) ====================

function showExportPanel() { showExportPanelCtrl(createExportDeps()); }
function updateArchiveAssetCheckboxes() { updateArchiveAssetCheckboxesCtrl(createExportDeps()); }

// =============================================================================
// SCREENSHOT FUNCTIONS (delegated to screenshot-manager.js)
// =============================================================================

function captureScreenshotToList() {
    return captureScreenshotToListHandler({ renderer, scene, camera, state });
}

function showViewfinder() {
    showViewfinderHandler();
}

function hideViewfinder() {
    hideViewfinderHandler();
}

function captureManualPreview() {
    return captureManualPreviewHandler({ renderer, scene, camera, state });
}

function renderScreenshotsList() {
    renderScreenshotsListHandler(state);
}

function removeScreenshot(id) {
    removeScreenshotHandler(id, state);
}

// Download archive — delegated to export-controller.ts
async function downloadArchive() { return downloadArchiveCtrl(createExportDeps()); }

// Download generic offline viewer — delegated to export-controller.ts
async function downloadGenericViewer() { return downloadGenericViewerCtrl(createExportDeps()); }

// ==================== Metadata Sidebar Functions ====================

// Show metadata sidebar - delegates to metadata-manager.js
function showMetadataSidebar(mode = 'view') {
    showMetadataSidebarHandler(mode, createMetadataDeps());
    setTimeout(onWindowResize, 300);
}

// Switch sidebar mode - delegates to metadata-manager.js
function switchSidebarMode(mode) {
    switchSidebarModeHandler(mode, createMetadataDeps());
}

// Legacy function names for compatibility
function showMetadataPanel() {
    showMetadataSidebar('edit');
}

function hideMetadataPanel() {
    hideMetadataSidebar();
}

// Setup metadata sidebar - delegates to metadata-manager.js
function setupMetadataSidebar() {
    setupMetadataSidebarHandler({
        ...createMetadataDeps(),
        onExportMetadata: exportMetadataManifest,
        onImportMetadata: importMetadataManifest
    });
}

// Export/Import metadata manifest — delegated to export-controller.ts
async function exportMetadataManifest() { return exportMetadataManifestCtrl(createExportDeps()); }
function importMetadataManifest() { importMetadataManifestCtrl(createExportDeps()); }

// Update quality stats display - delegates to metadata-manager.js
function updateMetadataStats() { updateMetadataStatsHandler(createMetadataDeps()); }

// Update asset status - delegates to metadata-manager.js
function updateAssetStatus() { updateAssetStatusHandler(createMetadataDeps()); }

// Prefill metadata panel from archive manifest
// Prefill metadata - delegates to metadata-manager.js
function prefillMetadataFromArchive(manifest) {
    prefillMetadataFromArchiveHandler(manifest);
}

// ==================== Museum-Style Metadata Display ====================

// Toggle metadata display - delegates to metadata-manager.js
function toggleMetadataDisplay() { toggleMetadataDisplayHandler(createMetadataDeps()); }

// Populate the museum-style metadata display - delegates to metadata-manager.js
function populateMetadataDisplay() { populateMetadataDisplayHandler(createMetadataDeps()); }

// ==================== Annotation Info Popup ====================

// Update annotation popup position - delegates to metadata-manager.js
function updateAnnotationPopupPosition() {
    updateAnnotationPopupPositionHandler(getCurrentPopupAnnotationId());
}

// ==================== End Annotation/Export Functions ====================

// ==================== Tauri Native File Dialogs ====================

/**
 * Wire up native file dialogs for all file inputs when running in Tauri.
 * Overrides the <label for="..."> click to open a native OS dialog instead
 * of the browser's file picker, then feeds the result into the existing handler.
 */
// Wire native file dialogs (structural wiring delegated to tauri-bridge.js)
function wireNativeFileDialogs() {
    if (!tauriBridge || !tauriBridge.isTauri()) return;
    tauriBridge.wireNativeFileDialogs({
        onSplatFiles: async (files) => {
            document.getElementById('splat-filename').textContent = files[0].name;
            showLoading('Loading Gaussian Splat...');
            try { await loadSplatFromFileHandler(files[0], createFileHandlerDeps()); hideLoading(); }
            catch (e) { log.error('Error loading splat:', e); hideLoading(); notify.error('Error loading Gaussian Splat: ' + e.message); }
        },
        onModelFiles: async (files) => {
            document.getElementById('model-filename').textContent = files[0].name;
            showLoading('Loading 3D Model...');
            try { await loadModelFromFileHandler(files, createFileHandlerDeps()); hideLoading(); }
            catch (e) { log.error('Error loading model:', e); hideLoading(); notify.error('Error loading model: ' + e.message); }
        },
        onArchiveFiles: async (files) => {
            document.getElementById('archive-filename').textContent = files[0].name;
            showLoading('Loading archive...');
            try {
                if (state.archiveLoader) state.archiveLoader.dispose();
                const archiveLoader = new ArchiveLoader();
                await archiveLoader.loadFromFile(files[0]);
                await processArchive(archiveLoader, files[0].name);
                state.currentArchiveUrl = null;
            } catch (e) { log.error('Error loading archive:', e); hideLoading(); notify.error('Error loading archive: ' + e.message); }
        },
        onPointcloudFiles: async (files) => {
            document.getElementById('pointcloud-filename').textContent = files[0].name;
            showLoading('Loading point cloud...');
            try { await loadPointcloudFromFileHandler(files[0], createPointcloudDeps()); hideLoading(); }
            catch (e) { log.error('Error loading point cloud:', e); hideLoading(); notify.error('Error loading point cloud: ' + e.message); }
        },
        onSTLFiles: async (files) => {
            document.getElementById('stl-filename').textContent = files[0].name;
            showLoading('Loading STL Model...');
            try { await loadSTLFileHandler([files[0]], createFileHandlerDeps()); hideLoading(); }
            catch (e) { log.error('Error loading STL:', e); hideLoading(); notify.error('Error loading STL: ' + e.message); }
        },
        onProxyMeshFiles: async (files) => {
            assets.proxyMeshBlob = files[0];
            document.getElementById('proxy-mesh-filename').textContent = files[0].name;
            notify.info(`Display proxy "${files[0].name}" ready — will be included in archive exports.`);
        },
        onSourceFiles: async (files) => {
            const category = document.getElementById('source-files-category')?.value || '';
            for (const file of files) { assets.sourceFiles.push({ file, name: file.name, size: file.size, category, fromArchive: false }); }
            updateSourceFilesUI();
            notify.info(`Added ${files.length} source file(s) for archival.`);
        },
        onBgImageFiles: async (files) => {
            if (!sceneManager) return;
            try {
                await sceneManager.loadBackgroundImageFromFile(files[0]);
                const filenameEl = document.getElementById('bg-image-filename');
                if (filenameEl) { filenameEl.textContent = files[0].name; filenameEl.style.display = ''; }
                const envBgToggle = document.getElementById('toggle-env-background');
                if (envBgToggle) envBgToggle.checked = false;
                document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
                const clearBtn = document.getElementById('btn-clear-bg-image');
                if (clearBtn) clearBtn.style.display = '';
            } catch (err) { notify.error('Failed to load background image: ' + err.message); }
        },
        onHdrFiles: async (files) => {
            showLoading('Loading HDR environment...');
            try {
                await sceneManager.loadHDREnvironmentFromFile(files[0]);
                const filenameEl = document.getElementById('hdr-filename');
                if (filenameEl) { filenameEl.textContent = files[0].name; filenameEl.style.display = ''; }
                const select = document.getElementById('env-map-select');
                if (select) select.value = '';
                hideLoading();
                notify.success('HDR environment loaded');
            } catch (err) { hideLoading(); notify.error('Failed to load HDR: ' + err.message); }
        }
    });
}

async function handleSplatFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    document.getElementById('splat-filename').textContent = file.name;
    showLoading('Loading Gaussian Splat...');

    try {
        await loadSplatFromFileHandler(file, createFileHandlerDeps());
        hideLoading();
    } catch (error) {
        log.error('Error loading splat:', error);
        hideLoading();
        notify.error('Error loading Gaussian Splat: ' + error.message);
    }
}

async function handleModelFile(event) {
    const files = event.target.files;
    if (!files.length) return;

    const mainFile = files[0];
    document.getElementById('model-filename').textContent = mainFile.name;
    showLoading('Loading 3D Model...');

    try {
        await loadModelFromFileHandler(files, createFileHandlerDeps());
        hideLoading();
    } catch (error) {
        log.error('Error loading model:', error);
        hideLoading();
        notify.error('Error loading model: ' + error.message);
    }
}

async function handleSTLFile(event) {
    const files = event.target.files;
    if (!files.length) return;

    const mainFile = files[0];
    document.getElementById('stl-filename').textContent = mainFile.name;
    showLoading('Loading STL Model...');

    try {
        await loadSTLFileHandler(files, createFileHandlerDeps());
        hideLoading();
    } catch (error) {
        log.error('Error loading STL:', error);
        hideLoading();
        notify.error('Error loading STL: ' + error.message);
    }
}

function handleLoadSTLFromUrlPrompt() {
    log.info(' handleLoadSTLFromUrlPrompt called');
    const url = prompt('Enter STL Model URL (.stl):');
    log.info(' User entered:', url);
    if (!url) return;

    const validation = validateUserUrl(url, 'stl');
    if (!validation.valid) {
        notify.error('Cannot load STL: ' + validation.error);
        return;
    }

    loadSTLFromUrl(validation.url);
}

async function loadSTLFromUrl(url) {
    showLoading('Downloading STL Model...', true);

    try {
        await loadSTLFromUrlWithDepsHandler(url, createFileHandlerDeps());
        hideLoading();
    } catch (error) {
        log.error('Error loading STL from URL:', error);
        hideLoading();
        notify.error('Error loading STL: ' + error.message);
    }
}

async function handleProxyMeshFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    assets.proxyMeshBlob = file;
    document.getElementById('proxy-mesh-filename').textContent = file.name;
    notify.info(`Display proxy "${file.name}" ready — will be included in archive exports.`);
}

async function handleProxySplatFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    assets.proxySplatBlob = file;
    document.getElementById('proxy-splat-filename').textContent = file.name;
    notify.info(`Splat display proxy "${file.name}" ready — will be included in archive exports.`);
}

// Switch quality tier (delegated to archive-pipeline.ts)
async function switchQualityTier(newTier) { return switchQualityTierCtrl(newTier, createArchivePipelineDeps()); }

// ==================== Source Files ====================

function handleSourceFilesInput(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const category = document.getElementById('source-files-category')?.value || '';

    for (const file of files) {
        assets.sourceFiles.push({ file, name: file.name, size: file.size, category, fromArchive: false });
    }

    updateSourceFilesUI();
    notify.info(`Added ${files.length} source file(s) for archival.`);

    // Reset input so the same files can be re-added if needed
    event.target.value = '';
}

function removeSourceFile(index) {
    assets.sourceFiles.splice(index, 1);
    updateSourceFilesUI();
}

function updateSourceFilesUI() {
    const listEl = document.getElementById('source-files-list');
    const summaryEl = document.getElementById('source-files-summary');
    const countEl = document.getElementById('source-files-count');
    const sizeEl = document.getElementById('source-files-size');

    if (!listEl) return;

    listEl.innerHTML = '';

    assets.sourceFiles.forEach((sf, i) => {
        const item = document.createElement('div');
        item.className = 'source-file-item';
        item.innerHTML = `<span class="source-file-name" title="${sf.name}">${sf.name}</span>` +
            `<span class="source-file-size">${formatFileSize(sf.size)}</span>` +
            (sf.fromArchive ? '' : `<span class="source-file-remove" data-index="${i}" title="Remove">\u00d7</span>`);
        listEl.appendChild(item);
    });

    // Wire up remove buttons
    listEl.querySelectorAll('.source-file-remove').forEach(btn => {
        btn.addEventListener('click', () => removeSourceFile(parseInt(btn.dataset.index)));
    });

    const totalSize = assets.sourceFiles.reduce((sum, sf) => sum + sf.size, 0);

    if (summaryEl) {
        summaryEl.style.display = assets.sourceFiles.length > 0 ? '' : 'none';
    }
    if (countEl) countEl.textContent = assets.sourceFiles.length;
    if (sizeEl) sizeEl.textContent = formatFileSize(totalSize);
}

// Handle load full res mesh (delegated to archive-pipeline.ts)
async function handleLoadFullResMesh() { return handleLoadFullResMeshCtrl(createArchivePipelineDeps()); }

function updateModelOpacity() { updateModelOpacityFn(modelGroup, state.modelOpacity); }

function updateModelWireframe() { updateModelWireframeFn(modelGroup, state.modelWireframe); }

function updateModelMatcap() { updateModelMatcapFn(modelGroup, state.modelMatcap, state.matcapStyle); }

function updateModelNormals() { updateModelNormalsFn(modelGroup, state.modelNormals); }

function updateModelRoughnessView() { updateModelRoughnessFn(modelGroup, state.modelRoughness); }

function updateModelMetalnessView() { updateModelMetalnessFn(modelGroup, state.modelMetalness); }

function updateModelSpecularF0View() { updateModelSpecularF0Fn(modelGroup, state.modelSpecularF0); }

// Alignment I/O (delegated to alignment.js)
function createAlignmentIODeps() {
    return {
        splatMesh, modelGroup, pointcloudGroup, tauriBridge,
        updateTransformInputs, storeLastPositions
    };
}

function saveAlignment() {
    return saveAlignmentHandler(createAlignmentIODeps());
}

function applyAlignmentData(data) {
    applyAlignmentDataHandler(data, createAlignmentIODeps());
}

function loadAlignment(event) {
    loadAlignmentHandler(event, createAlignmentIODeps());
}

function loadAlignmentFromUrl(url) {
    return loadAlignmentFromUrlHandler(url, createAlignmentIODeps());
}

// Open share dialog with current state
function copyShareLink() {
    // Gather current state for the share dialog
    const shareState = {
        archiveUrl: state.currentArchiveUrl,
        splatUrl: state.currentSplatUrl,
        modelUrl: state.currentModelUrl,
        pointcloudUrl: state.currentPointcloudUrl,
        displayMode: state.displayMode,
        splatTransform: null,
        modelTransform: null,
        pointcloudTransform: null
    };

    // Add splat transform if available
    if (splatMesh) {
        shareState.splatTransform = {
            position: [splatMesh.position.x, splatMesh.position.y, splatMesh.position.z],
            rotation: [splatMesh.rotation.x, splatMesh.rotation.y, splatMesh.rotation.z],
            scale: splatMesh.scale.x
        };
    }

    // Add model transform if available
    if (modelGroup) {
        shareState.modelTransform = {
            position: [modelGroup.position.x, modelGroup.position.y, modelGroup.position.z],
            rotation: [modelGroup.rotation.x, modelGroup.rotation.y, modelGroup.rotation.z],
            scale: modelGroup.scale.x
        };
    }

    // Add pointcloud transform if available
    if (pointcloudGroup) {
        shareState.pointcloudTransform = {
            position: [pointcloudGroup.position.x, pointcloudGroup.position.y, pointcloudGroup.position.z],
            rotation: [pointcloudGroup.rotation.x, pointcloudGroup.rotation.y, pointcloudGroup.rotation.z],
            scale: pointcloudGroup.scale.x
        };
    }

    // Show the share dialog
    showShareDialog(shareState);
}

function resetAlignment() {
    resetAlignmentHandler(createAlignmentDeps());
}

function resetCamera() {
    resetCameraHandler(createAlignmentDeps());
    // Also update right controls for split view
    if (controlsRight) {
        controlsRight.target.set(0, 0, 0);
        controlsRight.update();
    }
}

function fitToView() {
    fitToViewHandler(createAlignmentDeps());
    // Also update right controls for split view
    if (controlsRight) {
        controlsRight.target.copy(controls.target);
        controlsRight.update();
    }
}

// Controls panel visibility (delegated to ui-controller.js)
function createControlsDeps() {
    return { state, config, onWindowResize };
}

function toggleControlsPanel() {
    toggleControlsPanelHandler(createControlsDeps());
}

function applyControlsVisibility(shouldShowOverride) {
    applyControlsVisibilityHandler(createControlsDeps(), shouldShowOverride);
}

function applyControlsMode() {
    applyControlsModeHandler(config.controlsMode || 'full');
}

function ensureToolbarVisibility() {
    ensureToolbarVisibilityHandler(config);
}

function applyViewerModeSettings() {
    applyViewerModeSettingsHandler(config);
}

// Load default files from configuration
async function loadDefaultFiles() {
    // Archive URL takes priority over splat/model URLs
    if (config.defaultArchiveUrl) {
        log.info(' Loading archive from URL:', config.defaultArchiveUrl);
        await loadArchiveFromUrl(config.defaultArchiveUrl);
        return; // Archive handles everything including alignment
    }

    if (config.defaultSplatUrl) {
        await loadSplatFromUrl(config.defaultSplatUrl);
    }

    if (config.defaultModelUrl) {
        await loadModelFromUrl(config.defaultModelUrl);
    }

    if (config.defaultPointcloudUrl) {
        await loadPointcloudFromUrl(config.defaultPointcloudUrl);
    }

    // Handle alignment priority:
    // 1. Inline alignment params (highest priority - encoded in URL)
    // 2. Alignment URL file
    // 3. Auto-align (fallback)
    if (state.splatLoaded || state.modelLoaded || state.pointcloudLoaded) {
        // Wait a moment for objects to fully initialize
        await new Promise(resolve => setTimeout(resolve, TIMING.URL_MODEL_LOAD_DELAY));

        if (config.inlineAlignment) {
            // Apply inline alignment from URL params
            log.info(' Applying inline alignment from URL params...');
            applyAlignmentData(config.inlineAlignment);
        } else if (config.defaultAlignmentUrl) {
            // Load alignment from URL file
            const alignmentLoaded = await loadAlignmentFromUrl(config.defaultAlignmentUrl);
            if (!alignmentLoaded && state.splatLoaded && state.modelLoaded) {
                // Fallback to auto-align if alignment URL fetch failed
                log.info(' Alignment URL failed, falling back to auto-center-align...');
                autoCenterAlign();
            }
        } else if (state.splatLoaded && state.modelLoaded) {
            // No alignment provided, run auto-center-align
            log.info('Both files loaded from URL, running auto-center-align...');
            autoCenterAlign();
        }
    }
}

// URL loaders — thin wrappers around file-handlers.js with progress UI
async function loadSplatFromUrl(url) {
    showLoading('Downloading Gaussian Splat...', true);
    try {
        await loadSplatFromUrlHandler(url, createFileHandlerDeps(), (received, total) => {
            const percent = Math.round((received / total) * 90);
            updateProgress(percent, `Downloading Gaussian Splat... ${formatFileSize(received)} / ${formatFileSize(total)}`);
        });
        const filename = url.split('/').pop() || 'URL';
        document.getElementById('splat-filename').textContent = filename;
        hideLoading();
    } catch (error) {
        log.error('Error loading splat from URL:', error);
        hideLoading();
    }
}

async function loadModelFromUrl(url) {
    showLoading('Downloading 3D Model...', true);
    try {
        const loadedObject = await loadModelFromUrlHandler(url, createFileHandlerDeps(), (received, total) => {
            const percent = Math.round((received / total) * 90);
            updateProgress(percent, `Downloading 3D Model... ${formatFileSize(received)} / ${formatFileSize(total)}`);
        });
        if (loadedObject && sceneManager) {
            sceneManager.applyShadowProperties(loadedObject);
        }
        const filename = url.split('/').pop() || 'URL';
        document.getElementById('model-filename').textContent = filename;
        hideLoading();
    } catch (error) {
        log.error('Error loading model from URL:', error);
        hideLoading();
    }
}

// ============================================================
// Point cloud loading - URL wrapper
// ============================================================

function createPointcloudDeps() {
    return {
        pointcloudGroup,
        state,
        archiveCreator,
        callbacks: {
            onPointcloudLoaded: (object, file, pointCount, blob) => {
                assets.pointcloudBlob = blob;
                updateVisibility();
                updateTransformInputs();
                storeLastPositions();

                // Update UI
                const fileName = file.name || file;
                document.getElementById('pointcloud-filename').textContent = fileName;
                document.getElementById('pointcloud-points').textContent = pointCount.toLocaleString();
            }
        }
    };
}

async function loadPointcloudFromUrl(url) {
    showLoading('Downloading Point Cloud...', true);

    try {
        log.info(' Fetching point cloud from URL:', url);
        await loadPointcloudFromUrlHandler(url, createPointcloudDeps(), (received, total) => {
            const percent = Math.round((received / total) * 90);
            updateProgress(percent, `Downloading Point Cloud... ${formatFileSize(received)} / ${formatFileSize(total)}`);
        });
        state.currentPointcloudUrl = url;
        hideLoading();
    } catch (error) {
        log.error('Error loading point cloud from URL:', error);
        hideLoading();
        notify.error('Error loading point cloud: ' + error.message);
    }
}

// ============================================================
// Alignment functions - wrappers for alignment.js module
// ============================================================

// Toggle landmark alignment mode
function toggleAlignment() {
    if (!splatMesh || !modelGroup || modelGroup.children.length === 0) {
        notify.warning('Both splat and model must be loaded for alignment');
        return;
    }
    // Update refs in case assets loaded after init
    landmarkAlignment.updateRefs(splatMesh, modelGroup);
    if (landmarkAlignment.isActive()) {
        landmarkAlignment.cancel();
    } else {
        landmarkAlignment.start();
    }
}

// Auto center align - simple bounding-box center match on load
function autoCenterAlign() {
    autoCenterAlignHandler(createAlignmentDeps());
}

// Animation loop
let animationErrorCount = 0;
const MAX_ANIMATION_ERRORS = 10;
const fpsElement = document.getElementById('fps-counter');

function animate() {
    requestAnimationFrame(animate);

    try {
        // Update active camera controls
        if (flyControls && flyControls.enabled) {
            flyControls.update();
        } else {
            controls.update();
            // Sync right controls target so it doesn't override the main
            // camera orientation with a stale target after panning
            controlsRight.target.copy(controls.target);
            controlsRight.update();
        }

        // Render using scene manager (handles split view)
        sceneManager.render(state.displayMode, splatMesh, modelGroup, pointcloudGroup, stlGroup);

        // Update annotation marker positions
        if (annotationSystem) {
            annotationSystem.updateMarkerPositions();
        }

        // Update alignment marker positions
        if (landmarkAlignment) {
            landmarkAlignment.updateMarkerPositions();
        }

        // Update annotation popup position to follow marker
        updateAnnotationPopupPosition();

        sceneManager.updateFPS(fpsElement);

        // Reset error count on successful frame
        animationErrorCount = 0;
    } catch (e) {
        animationErrorCount++;
        if (animationErrorCount <= MAX_ANIMATION_ERRORS) {
            log.error(' Animation loop error:', e);
        }
        if (animationErrorCount === MAX_ANIMATION_ERRORS) {
            log.error(' Suppressing further animation errors...');
        }
    }
}

// Initialize when DOM is ready
log.info(' Setting up initialization, readyState:', document.readyState);

async function startApp() {
    // Belt-and-suspenders: if kioskLock is active server-side but kiosk flag
    // was somehow cleared (e.g., config tampering), force kiosk mode anyway
    if (window.APP_CONFIG?.kioskLock && !window.APP_CONFIG?.kiosk) {
        console.warn('[main] kioskLock active but kiosk flag was false — forcing kiosk mode');
        window.APP_CONFIG.kiosk = true;
    }

    // In kiosk mode, delegate to kiosk-main.js (slim viewer-only entry point)
    if (window.APP_CONFIG?.kiosk) {
        log.info(' Kiosk mode detected, loading kiosk-main.js');
        try {
            const { init: kioskInit } = await import('./modules/kiosk-main.js');
            kioskInit();
        } catch (e) {
            log.error(' Kiosk init error:', e);
            log.error(' Stack:', e.stack);
        }
        return;
    }

    try {
        init();
    } catch (e) {
        log.error(' Init error:', e);
        log.error(' Stack:', e.stack);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        log.info(' DOMContentLoaded fired');
        startApp();
    });
} else {
    log.info(' DOM already ready');
    startApp();
}
