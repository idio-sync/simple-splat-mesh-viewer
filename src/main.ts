// ES Module imports (these are hoisted - execute first before any other code)
import * as THREE from 'three';
import { SplatMesh, SparkRenderer } from '@sparkjsdev/spark';
import { ArchiveLoader } from './modules/archive-loader.js';
// hasAnyProxy moved to archive-pipeline.ts (Phase 2.2)
import { AnnotationSystem } from './modules/annotation-system.js';
import { CrossSectionTool } from './modules/cross-section.js';
import { MeasurementSystem } from './modules/measurement-system.js';
import { ArchiveCreator, CRYPTO_AVAILABLE } from './modules/archive-creator.js';
import { CAMERA, TIMING, ASSET_STATE, MESH_LOD } from './modules/constants.js';
import { Logger, notify } from './modules/utilities.js';
import { FlyControls } from './modules/fly-controls.js';
import { getStore } from './modules/asset-store.js';
import { validateUserUrl as validateUserUrlCore } from './modules/url-validation.js';
import { SceneManager } from './modules/scene-manager.js';
import {
    LandmarkAlignment,
    autoCenterAlign as autoCenterAlignHandler,
    fitToView as fitToViewHandler,
    resetAlignment as resetAlignmentHandler,
    resetCamera as resetCameraHandler,
    centerModelOnGrid,
    applyAlignmentData as applyAlignmentDataHandler,
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
    applyControlsVisibility as applyControlsVisibilityHandler,
    ensureToolbarVisibility as ensureToolbarVisibilityHandler,
    applyViewerModeSettings as applyViewerModeSettingsHandler,
    updateStatusBar,
    updateDisplayPill,
    updateTransformPaneSelection
} from './modules/ui-controller.js';
import {
    formatFileSize,
    collectMetadata,
    hideMetadataSidebar,
    showMetadataSidebar as showMetadataSidebarHandler,
    toggleMetadataDisplay as toggleMetadataDisplayHandler,
    populateMetadataDisplay as populateMetadataDisplayHandler,
    clearArchiveMetadata as clearArchiveMetadataHandler,
    showAnnotationPopup as showAnnotationPopupHandler,
    updateAnnotationPopupPosition as updateAnnotationPopupPositionHandler,
    hideAnnotationPopup as hideAnnotationPopupHandler,
    setupMetadataSidebar as setupMetadataSidebarHandler,
    prefillMetadataFromArchive as prefillMetadataFromArchiveHandler,
    updatePronomRegistry,
    invalidatePopupLayoutCache
} from './modules/metadata-manager.js';
import {
    loadSplatFromFile as loadSplatFromFileHandler,
    loadModelFromFile as loadModelFromFileHandler,
    loadPointcloudFromFile as loadPointcloudFromFileHandler,
    getAssetTypesForMode,
    updateModelOpacity as updateModelOpacityFn,
    updateModelWireframe as updateModelWireframeFn,
    updateModelMatcap as updateModelMatcapFn,
    updateModelNormals as updateModelNormalsFn,
    updateModelRoughness as updateModelRoughnessFn,
    updateModelMetalness as updateModelMetalnessFn,
    updateModelSpecularF0 as updateModelSpecularF0Fn,
    loadSTLFile as loadSTLFileHandler,
} from './modules/file-handlers.js';
import {
    handleLoadSplatFromUrlPrompt as handleLoadSplatFromUrlPromptCtrl,
    handleLoadModelFromUrlPrompt as handleLoadModelFromUrlPromptCtrl,
    handleLoadPointcloudFromUrlPrompt as handleLoadPointcloudFromUrlPromptCtrl,
    handleLoadArchiveFromUrlPrompt as handleLoadArchiveFromUrlPromptCtrl,
    handleLoadSTLFromUrlPrompt as handleLoadSTLFromUrlPromptCtrl,
    handleSplatFile as handleSplatFileCtrl,
    handleModelFile as handleModelFileCtrl,
    handleSTLFile as handleSTLFileCtrl,
    handlePointcloudFile as handlePointcloudFileCtrl,
    handleProxyMeshFile as handleProxyMeshFileCtrl,
    handleProxySplatFile as handleProxySplatFileCtrl,
    loadSplatFromUrl as loadSplatFromUrlCtrl,
    loadModelFromUrl as loadModelFromUrlCtrl,
    loadPointcloudFromUrl as loadPointcloudFromUrlCtrl
} from './modules/file-input-handlers.js';
import {
    captureScreenshotToList as captureScreenshotToListHandler,
    showViewfinder as showViewfinderHandler,
    hideViewfinder as hideViewfinderHandler,
    captureManualPreview as captureManualPreviewHandler
} from './modules/screenshot-manager.js';
import {
    setSelectedObject as setSelectedObjectHandler,
    syncBothObjects as syncBothObjectsHandler,
    storeLastPositions as storeLastPositionsHandler,
    setTransformMode as setTransformModeHandler,
    resetTransform as resetTransformHandler,
    applyPivotRotation as applyPivotRotationHandler,
    applyUniformScale as applyUniformScaleHandler,
    centerAtOrigin as centerAtOriginHandler
} from './modules/transform-controller.js';
import {
    handleSourceFilesInput,
    updateSourceFilesUI
} from './modules/source-files-manager.js';
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
    handleArchiveFile as handleArchiveFileCtrl,
    loadArchiveFromUrl as loadArchiveFromUrlCtrl,
    ensureAssetLoaded as ensureAssetLoadedCtrl,
    processArchive as processArchiveCtrl,
    clearArchiveMetadata as clearArchiveMetadataCtrl,
    switchQualityTier as switchQualityTierCtrl,
    handleLoadFullResMesh as handleLoadFullResMeshCtrl
} from './modules/archive-pipeline.js';
import {
    setupUIEvents as setupUIEventsCtrl
} from './modules/event-wiring.js';
import type { AppState, SceneRefs, ExportDeps, ArchivePipelineDeps, EventWiringDeps, DisplayMode, SelectedObject, TransformMode } from './types.js';
// kiosk-viewer.js is loaded dynamically in downloadGenericViewer() to avoid
// blocking the main application if the module fails to load.

declare global {
    interface Window {
        APP_CONFIG?: any;
        moduleLoaded?: boolean;
        THREE?: typeof THREE;
        notify?: typeof notify;
    }
}

// Tauri desktop integration (lazy-loaded to avoid errors in browser)
let tauriBridge: any = null;
if (window.__TAURI__) {
    import('./modules/tauri-bridge.js').then((mod: any) => {
        tauriBridge = mod;
        console.log('[main] Tauri bridge loaded — native dialogs available');
    }).catch((err: any) => {
        console.warn('[main] Tauri bridge failed to load:', err);
    });
}

// Create logger for this module
const log = Logger.getLogger('main');

// Mark module as loaded (for pre-module error detection)
window.moduleLoaded = true;
log.info('Module loaded successfully, THREE:', !!THREE, 'SplatMesh:', !!SplatMesh);

// Expose THREE globally for debugging and potential library compatibility
window.THREE = THREE;
log.debug('THREE.REVISION:', THREE.REVISION);

// Expose notify for use by dynamically loaded modules (share dialog, etc.)
window.notify = notify;

// Global error handler for runtime errors
window.onerror = function(message: string | Event, source?: string, lineno?: number, _colno?: number, _error?: Error) {
    log.error(' Runtime error:', message, 'at', source, 'line', lineno);
    return false;
};

// Get configuration from window (set by config.js)
const config: any = window.APP_CONFIG || {
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
const ALLOWED_EXTERNAL_DOMAINS: string[] = window.APP_CONFIG?.allowedDomains || [];

/**
 * Validates a URL to prevent loading from untrusted sources.
 * Thin wrapper around url-validation.ts that provides browser context.
 *
 * @param {string} urlString - The URL string to validate
 * @param {string} resourceType - Type of resource (for error messages)
 * @returns {{valid: boolean, url: string, error: string}} - Validation result
 */
function validateUserUrl(urlString: string, resourceType: string) {
    const result = validateUserUrlCore(urlString, resourceType, {
        allowedDomains: ALLOWED_EXTERNAL_DOMAINS,
        currentOrigin: window.location.origin,
        currentProtocol: window.location.protocol
    });
    if (result.valid) {
        console.info(`[main] Validated ${resourceType} URL:`, result.url);
    }
    return result;
}

// Global state
const state: AppState = {
    displayMode: config.initialViewMode || 'model', // 'splat', 'model', 'pointcloud', 'both', 'split'
    selectedObject: 'none', // 'splat', 'model', 'both', 'none'
    transformMode: 'translate', // 'translate', 'rotate', 'scale'
    rotationPivot: 'object', // 'object' | 'origin'
    scaleLockProportions: true, // lock proportions when scaling
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
    manualPreviewBlob: null,  // If set, overrides auto-capture during export
    // Detected asset format extensions (set during file load)
    meshFormat: null,
    pointcloudFormat: null,
    splatFormat: null
};

// Scene manager instance (handles scene, camera, renderer, controls, lighting)
let sceneManager: any = null;

// Three.js objects - Main view (references extracted from SceneManager for backward compatibility)
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: any; // WebGLRenderer | WebGPURenderer — widened for auto-switching
let controls: any; // OrbitControls
let transformControls: any; // TransformControls
let flyControls: any = null; // FlyControls (custom)
let sparkRenderer: any = null; // SparkRenderer instance
let splatMesh: any = null; // SplatMesh from Spark
let modelGroup: THREE.Group;
let pointcloudGroup: THREE.Group;
let stlGroup: THREE.Group;
let ambientLight: THREE.AmbientLight;
let hemisphereLight: THREE.HemisphereLight;
let directionalLight1: THREE.DirectionalLight;
let directionalLight2: THREE.DirectionalLight;

// Annotation, alignment, archive creation, and measurement
let annotationSystem: any = null;
let measurementSystem: any = null;
let landmarkAlignment: any = null;
let archiveCreator: any = null;
let crossSection: CrossSectionTool | null = null;

// Asset blob store (ES module singleton — shared with archive-pipeline, export-controller, etc.)
const assets = getStore();

// Dynamic getter object for mutable Three.js references — prevents stale-reference bugs
// when splatMesh/modelGroup etc. are reassigned after loading new files.
// Pass to extracted modules instead of individual objects.
const sceneRefs: SceneRefs = {
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
let controlsRight: any = null;

// DOM elements (with null checks for debugging)
const canvas: HTMLElement | null = document.getElementById('viewer-canvas');
const canvasRight = document.getElementById('viewer-canvas-right') as HTMLCanvasElement | null;
const loadingOverlay: HTMLElement | null = document.getElementById('loading-overlay');
const loadingText: HTMLElement | null = document.getElementById('loading-text');

log.info(' DOM elements found:', {
    canvas: !!canvas,
    canvasRight: !!canvasRight,
    loadingOverlay: !!loadingOverlay,
    loadingText: !!loadingText
});

// Helper function to create dependencies object for file-handlers.js
function createFileHandlerDeps(): any {
    return {
        scene,
        modelGroup,
        stlGroup,
        getSplatMesh: () => splatMesh,
        setSplatMesh: (mesh: any) => { splatMesh = mesh; },
        getModelGroup: () => modelGroup,
        state,
        sceneManager,
        archiveCreator,
        callbacks: {
            onSplatLoaded: (mesh: any, file: any) => {
                // Detect splat format from filename
                const splatName = file?.name || '';
                const splatExt = splatName.split('.').pop()?.toLowerCase() || 'splat';
                state.splatFormat = splatExt;
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
                if (state.modelLoaded && !state.archiveLoaded) {
                    setTimeout(() => autoCenterAlign(), TIMING.AUTO_ALIGN_DELAY);
                }
                if (!state.archiveLoaded) {
                    clearArchiveMetadata();
                }
                updatePronomRegistry(state);
            },
            onModelLoaded: (object: any, file: any, faceCount: number) => {
                // Detect mesh format from filename
                const meshName = file?.name || '';
                const meshExt = meshName.split('.').pop()?.toLowerCase() || 'glb';
                state.meshFormat = meshExt;
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
                // Update texture info display
                if (state.meshTextureInfo) {
                    const texEl = document.getElementById('model-textures');
                    if (texEl && state.meshTextureInfo.count > 0) {
                        texEl.textContent = `${state.meshTextureInfo.count} × ${state.meshTextureInfo.maxResolution}²`;
                        const texRow = texEl.closest('.prop-row') as HTMLElement;
                        if (texRow) texRow.style.display = '';
                    }
                }
                // Advisory face count warnings
                if (faceCount > MESH_LOD.DESKTOP_WARNING_FACES) {
                    notify.warning(`Mesh has ${faceCount.toLocaleString()} faces. A display proxy is recommended for broad device support.`);
                } else if (faceCount > MESH_LOD.MOBILE_WARNING_FACES) {
                    notify.info(`Mesh has ${faceCount.toLocaleString()} faces — may not display on mobile/tablet. Consider adding a display proxy.`);
                }
                // Auto center-align if splat is already loaded, otherwise center on grid
                // Skip when loading from an archive — saved transforms must be preserved
                if (!state.archiveLoaded) {
                    if (state.splatLoaded) {
                        setTimeout(() => autoCenterAlign(), TIMING.AUTO_ALIGN_DELAY);
                    } else {
                        // Center model on grid when loaded standalone
                        setTimeout(() => centerModelOnGrid(modelGroup), TIMING.AUTO_ALIGN_DELAY);
                    }
                    clearArchiveMetadata();
                }
                updatePronomRegistry(state);
            },
            onSTLLoaded: (object: any, file: any, _faceCount: number) => {
                // Switch to STL display mode
                setDisplayMode('stl');
                updateVisibility();
                updateTransformInputs();
                storeLastPositions();
                const filenameEl = document.getElementById('stl-filename');
                if (filenameEl) filenameEl.textContent = file.name || 'STL loaded';
                // Center STL on grid
                setTimeout(() => centerModelOnGrid(stlGroup), TIMING.AUTO_ALIGN_DELAY);
                updatePronomRegistry(state);
            }
        }
    };
}

// Helper function to create dependencies object for alignment.js
function createAlignmentDeps(): any {
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
function createAnnotationControllerDeps(): any {
    return {
        annotationSystem,
        showAnnotationPopup: (annotation: any) => {
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
function createMetadataDeps(): any {
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
        onAnnotationUpdated: () => { updateAnnotationsUI(); updateSidebarAnnotationsList(); },
        getCameraState: () => ({
            position: {
                x: parseFloat(camera.position.x.toFixed(4)),
                y: parseFloat(camera.position.y.toFixed(4)),
                z: parseFloat(camera.position.z.toFixed(4))
            },
            target: {
                x: parseFloat(controls.target.x.toFixed(4)),
                y: parseFloat(controls.target.y.toFixed(4)),
                z: parseFloat(controls.target.z.toFixed(4))
            }
        }),
    };
}

// Helper function to create dependencies object for export-controller.ts
function createExportDeps(): ExportDeps {
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
function createArchivePipelineDeps(): ArchivePipelineDeps {
    return {
        sceneRefs,
        state,
        sceneManager,
        setSplatMesh: (mesh: any) => { splatMesh = mesh; },
        createFileHandlerDeps,
        ui: {
            showLoading,
            hideLoading,
            updateProgress,
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

// Helper function to create dependencies object for file-input-handlers.ts
function createFileInputDeps(): any {
    return {
        validateUserUrl, state, sceneManager, tauriBridge, assets,
        createFileHandlerDeps, createPointcloudDeps, createArchivePipelineDeps,
        loadArchiveFromUrl, processArchive,
        showLoading, hideLoading, updateProgress, formatFileSize, updateSourceFilesUI
    };
}

// Helper function to create dependencies object for event-wiring.ts
function createEventWiringDeps(): EventWiringDeps {
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
        alignment: { resetAlignment, toggleAlignment, centerAtOrigin },
        annotations: {
            toggleAnnotationMode, saveAnnotation, cancelAnnotation,
            updateSelectedAnnotationCamera, deleteSelectedAnnotation,
            dismissPopup: () => dismissPopupHandler(createAnnotationControllerDeps())
        },
        export: { showExportPanel, downloadArchive, downloadGenericViewer },
        screenshots: { captureScreenshotToList, showViewfinder, captureManualPreview, hideViewfinder },
        metadata: { hideMetadataPanel, toggleMetadataDisplay, setupMetadataSidebar },
        share: { copyShareLink },
        transform: { setSelectedObject, setTransformMode, resetTransform },
        crossSection: crossSection!,
        tauri: {
            wireNativeDialogsIfAvailable: () => {
                if (window.__TAURI__ && tauriBridge) {
                    wireNativeFileDialogs();
                } else if (window.__TAURI__) {
                    import('./modules/tauri-bridge.js').then((mod: any) => {
                        tauriBridge = mod;
                        wireNativeFileDialogs();
                    }).catch(() => {});
                }
            }
        }
    };
}

// Initialize the scene
async function init() {
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
    if (!await sceneManager.init(canvas as HTMLCanvasElement, canvasRight)) {
        log.error(' FATAL: SceneManager initialization failed!');
        return;
    }
    log.info('Renderer type:', sceneManager.rendererType);

    // Extract objects to global variables for backward compatibility
    scene = sceneManager.scene;
    camera = sceneManager.camera;
    renderer = sceneManager.renderer;
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

    // Create SparkRenderer only when starting with WebGL — Spark.js requires
    // WebGL context (uses .flush()). If starting with WebGPU, SparkRenderer
    // will be created in onRendererChanged when switching to WebGL for splat loading.
    if (sceneManager.rendererType === 'webgl') {
        sparkRenderer = new SparkRenderer({
            renderer: renderer,
            clipXY: 2.0,           // Prevent edge popping without excessive overdraw (default: 1.4)
            autoUpdate: true,
            minAlpha: 3 / 255,     // Cull near-invisible splats
            // LOD (Spark 2.0) — budget-based rendering caps splats per frame
            lodSplatCount: 1_500_000,   // HD budget; main app assumes capable device
            behindFoveate: 0.1,         // Aggressive behind-camera culling
        });
        scene.add(sparkRenderer);
        log.info('SparkRenderer created with clipXY=2.0, minAlpha=3/255, lodSplatCount=1.5M');
    } else {
        log.info('SparkRenderer deferred — will be created after WebGL switch');
    }

    // Register callback for renderer switches (WebGPU <-> WebGL)
    sceneManager.onRendererChanged = (newRenderer: any) => {
        renderer = newRenderer;
        controls = sceneManager.controls;
        controlsRight = sceneManager.controlsRight;
        transformControls = sceneManager.transformControls;
        if (annotationSystem) annotationSystem.updateRenderer(newRenderer);
        if (measurementSystem) measurementSystem.updateRenderer(newRenderer);
        if (flyControls) {
            flyControls.dispose();
            flyControls = new FlyControls(camera, newRenderer.domElement);
        }
        if (landmarkAlignment) {
            landmarkAlignment.updateRenderer(newRenderer);
        }
        // Recreate SparkRenderer only for WebGL — Spark.js requires WebGL context (.flush())
        if (sparkRenderer) {
            scene.remove(sparkRenderer);
            if (sparkRenderer.dispose) sparkRenderer.dispose();
            sparkRenderer = null;
        }
        if (sceneManager.rendererType === 'webgl') {
            sparkRenderer = new SparkRenderer({
                renderer: newRenderer,
                clipXY: 2.0,
                autoUpdate: true,
                minAlpha: 3 / 255,
                lodSplatCount: 1_500_000,
                behindFoveate: 0.1,
            });
            scene.add(sparkRenderer);
            log.info('Renderer changed, SparkRenderer recreated for WebGL');
        } else {
            log.info('Renderer changed to WebGPU, SparkRenderer removed');
        }
    };

    // Set up SceneManager callbacks for transform controls
    sceneManager.onTransformChange = () => {
        updateTransformInputs();
        _markersDirty = true; // Object moved — marker positions may be stale
        // If both selected, sync the other object
        if (state.selectedObject === 'both') {
            syncBothObjects();
        }
        // If rotating around world origin, adjust position to orbit around (0,0,0)
        applyPivotRotation();
        // If scale lock is on, enforce uniform scaling
        applyUniformScale();
    };

    // Initialize annotation system
    annotationSystem = new AnnotationSystem(scene, camera, renderer, controls);
    annotationSystem.onAnnotationCreated = onAnnotationPlaced;
    annotationSystem.onAnnotationSelected = onAnnotationSelected;
    annotationSystem.onPlacementModeChanged = onPlacementModeChanged;
    log.info(' Annotation system initialized:', !!annotationSystem);

    // Initialize measurement system
    measurementSystem = new MeasurementSystem(scene, camera, renderer, controls);
    _wireMeasurementControls();
    log.info(' Measurement system initialized:', !!measurementSystem);

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
    addListener('btn-alignment-apply', 'click', () => {
        if (landmarkAlignment?.isActive()) {
            landmarkAlignment.apply();
        }
    });
    addListener('btn-alignment-undo', 'click', () => {
        if (landmarkAlignment?.isActive()) {
            landmarkAlignment.undo();
        }
    });

    // Initialize archive creator
    archiveCreator = new ArchiveCreator();

    // Initialize cross-section tool
    crossSection = new CrossSectionTool(scene, camera, renderer, controls, modelGroup, pointcloudGroup, stlGroup);

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
    _markersDirty = true; // Viewport changed — marker screen positions are stale
    invalidatePopupLayoutCache(); // Viewer rect changed
}

function onKeyDown(event: KeyboardEvent) {
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
            setTransformMode('translate' as TransformMode);
            break;
        case 'e':
            setTransformMode('rotate' as TransformMode);
            break;
        case 'r':
            setTransformMode('scale' as TransformMode);
            break;
        case 'escape':
            setSelectedObject('none' as SelectedObject);
            break;
        case 'f11':
            event.preventDefault();
            if (!document.fullscreenElement) {
                document.documentElement.requestFullscreen();
            } else {
                document.exitFullscreen();
            }
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

function setDisplayMode(mode: DisplayMode) {
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
function toggleGridlines(show: boolean) {
    if (sceneManager) {
        sceneManager.toggleGrid(show);
    }
}

// Set background color
function setBackgroundColor(hexColor: string) {
    if (sceneManager) {
        sceneManager.setBackgroundColor(hexColor);
    }
}

// Transform controls (delegated to transform-controller.js)
function setSelectedObject(selection: SelectedObject) {
    setSelectedObjectHandler(selection, { transformControls, splatMesh, modelGroup, state });
    updateTransformPaneSelection(selection as string, splatMesh, modelGroup, pointcloudGroup);
}

function syncBothObjects() {
    syncBothObjectsHandler({ transformControls, splatMesh, modelGroup, pointcloudGroup });
}

function applyPivotRotation() {
    applyPivotRotationHandler({ transformControls, splatMesh, modelGroup, pointcloudGroup, state });
}

function applyUniformScale() {
    applyUniformScaleHandler({ transformControls, splatMesh, modelGroup, state });
}

function storeLastPositions() {
    storeLastPositionsHandler({ splatMesh, modelGroup, pointcloudGroup });
}

function setTransformMode(mode: TransformMode) {
    setTransformModeHandler(mode, { transformControls, state, splatMesh, modelGroup, pointcloudGroup });
}

function centerAtOrigin() {
    centerAtOriginHandler({ splatMesh, modelGroup, pointcloudGroup, camera, controls, state });
    updateTransformInputs();
}

function resetTransform() {
    resetTransformHandler({ splatMesh, modelGroup, pointcloudGroup, state });
    updateTransformInputs();
}

function updateVisibility() {
    updateVisibilityHandler(state.displayMode, splatMesh, modelGroup, pointcloudGroup, stlGroup);
    updateDisplayPill({
        splat: state.splatLoaded,
        model: state.modelLoaded,
        pointcloud: state.pointcloudLoaded,
        stl: state.stlLoaded
    });
}

function updateTransformInputs() {
    updateTransformInputsHandler(splatMesh, modelGroup, pointcloudGroup);
}

// Handle loading splat from URL via prompt
function handleLoadSplatFromUrlPrompt() {
    handleLoadSplatFromUrlPromptCtrl(createFileInputDeps());
}

// Handle loading model from URL via prompt
function handleLoadModelFromUrlPrompt() {
    handleLoadModelFromUrlPromptCtrl(createFileInputDeps());
}

// Handle loading point cloud from URL via prompt
function handleLoadPointcloudFromUrlPrompt() {
    handleLoadPointcloudFromUrlPromptCtrl(createFileInputDeps());
}

// Handle loading archive from URL via prompt
function handleLoadArchiveFromUrlPrompt() {
    handleLoadArchiveFromUrlPromptCtrl(createFileInputDeps());
}

// Handle point cloud file input
async function handlePointcloudFile(event: Event) {
    return handlePointcloudFileCtrl(event, createFileInputDeps());
}

// Handle archive file input (delegated to archive-pipeline.ts)
async function handleArchiveFile(event: Event) { return handleArchiveFileCtrl(event, createArchivePipelineDeps()); }

// Load archive from URL (delegated to archive-pipeline.ts)
async function loadArchiveFromUrl(url: string) { return loadArchiveFromUrlCtrl(url, createArchivePipelineDeps()); }

// Ensure archive asset loaded (delegated to archive-pipeline.ts)
async function ensureAssetLoaded(assetType: string) { return ensureAssetLoadedCtrl(assetType, createArchivePipelineDeps()); }

// Process loaded archive (delegated to archive-pipeline.ts)
async function processArchive(archiveLoader: any, archiveName: string) { return processArchiveCtrl(archiveLoader, archiveName, createArchivePipelineDeps()); }

// Clear archive metadata (delegated to archive-pipeline.ts)
function clearArchiveMetadata() { clearArchiveMetadataCtrl(createArchivePipelineDeps()); }

// ==================== Annotation Functions ====================

// Called when user places an annotation (clicks on model in placement mode)
function onAnnotationPlaced(position: any, cameraState: any) {
    onAnnotationPlacedHandler(position, cameraState, createAnnotationControllerDeps());
}

// Called when an annotation is selected
function onAnnotationSelected(annotation: any) {
    onAnnotationSelectedHandler(annotation, createAnnotationControllerDeps());
}

// Called when placement mode changes
function onPlacementModeChanged(active: boolean) {
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
function loadAnnotationsFromArchive(annotations: any[]) {
    loadAnnotationsFromArchiveHandler(annotations, createAnnotationControllerDeps());
}

// ==================== Export/Archive Creation Functions (delegated to export-controller.ts) ====================

async function showExportPanel() {
    const { showExportPanel: ctrl } = await import('./modules/export-controller.js');
    ctrl(createExportDeps());
}

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

// Download archive — delegated to export-controller.ts
async function downloadArchive() {
    const { downloadArchive: ctrl } = await import('./modules/export-controller.js');
    return ctrl(createExportDeps());
}

// Download generic offline viewer — delegated to export-controller.ts
async function downloadGenericViewer() {
    const { downloadGenericViewer: ctrl } = await import('./modules/export-controller.js');
    return ctrl(createExportDeps());
}

// ==================== Metadata Sidebar Functions ====================

// Show metadata sidebar - delegates to metadata-manager.js
function showMetadataSidebar(mode: 'view' | 'edit' | 'annotations' = 'view') {
    showMetadataSidebarHandler(mode, createMetadataDeps());
    setTimeout(onWindowResize, 300);
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
async function exportMetadataManifest() {
    const { exportMetadataManifest: ctrl } = await import('./modules/export-controller.js');
    return ctrl(createExportDeps());
}
async function importMetadataManifest() {
    const { importMetadataManifest: ctrl } = await import('./modules/export-controller.js');
    ctrl(createExportDeps());
}

// Prefill metadata panel from archive manifest
// Prefill metadata - delegates to metadata-manager.js
function prefillMetadataFromArchive(manifest: any) {
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
        onSplatFiles: async (files: any[]) => {
            document.getElementById('splat-filename').textContent = files[0].name;
            showLoading('Loading Gaussian Splat...');
            try { await loadSplatFromFileHandler(files[0], createFileHandlerDeps()); hideLoading(); }
            catch (e) { log.error('Error loading splat:', e); hideLoading(); notify.error('Error loading Gaussian Splat: ' + e.message); }
        },
        onModelFiles: async (files: any[]) => {
            document.getElementById('model-filename').textContent = files[0].name;
            showLoading('Loading 3D Model...');
            try { await loadModelFromFileHandler(files as any, createFileHandlerDeps()); hideLoading(); }
            catch (e) { log.error('Error loading model:', e); hideLoading(); notify.error('Error loading model: ' + e.message); }
        },
        onArchiveFiles: async (files: any[]) => {
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
        onPointcloudFiles: async (files: any[]) => {
            document.getElementById('pointcloud-filename').textContent = files[0].name;
            showLoading('Loading point cloud...');
            try { await loadPointcloudFromFileHandler(files[0], createPointcloudDeps()); hideLoading(); }
            catch (e) { log.error('Error loading point cloud:', e); hideLoading(); notify.error('Error loading point cloud: ' + e.message); }
        },
        onSTLFiles: async (files: any[]) => {
            document.getElementById('stl-filename').textContent = files[0].name;
            showLoading('Loading STL Model...');
            try { await loadSTLFileHandler([files[0]] as any, createFileHandlerDeps()); hideLoading(); }
            catch (e) { log.error('Error loading STL:', e); hideLoading(); notify.error('Error loading STL: ' + e.message); }
        },
        onProxyMeshFiles: async (files: any[]) => {
            assets.proxyMeshBlob = files[0];
            document.getElementById('proxy-mesh-filename').textContent = files[0].name;
            notify.info(`Display proxy "${files[0].name}" ready — will be included in archive exports.`);
        },
        onSourceFiles: async (files: any[]) => {
            const category = (document.getElementById('source-files-category') as HTMLInputElement)?.value || '';
            for (const file of files) { assets.sourceFiles.push({ file, name: file.name, size: file.size, category, fromArchive: false }); }
            updateSourceFilesUI();
            notify.info(`Added ${files.length} source file(s) for archival.`);
        },
        onBgImageFiles: async (files: any[]) => {
            if (!sceneManager) return;
            try {
                await sceneManager.loadBackgroundImageFromFile(files[0]);
                const filenameEl = document.getElementById('bg-image-filename');
                if (filenameEl) { filenameEl.textContent = files[0].name; filenameEl.style.display = ''; }
                const envBgToggle = document.getElementById('toggle-env-background') as HTMLInputElement | null;
                if (envBgToggle) envBgToggle.checked = false;
                document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
                const clearBtn = document.getElementById('btn-clear-bg-image');
                if (clearBtn) clearBtn.style.display = '';
            } catch (err) { notify.error('Failed to load background image: ' + err.message); }
        },
        onHdrFiles: async (files: any[]) => {
            showLoading('Loading HDR environment...');
            try {
                await sceneManager.loadHDREnvironmentFromFile(files[0]);
                const filenameEl = document.getElementById('hdr-filename');
                if (filenameEl) { filenameEl.textContent = files[0].name; filenameEl.style.display = ''; }
                const select = document.getElementById('env-map-select') as HTMLSelectElement | null;
                if (select) select.value = '';
                hideLoading();
                notify.success('HDR environment loaded');
            } catch (err) { hideLoading(); notify.error('Failed to load HDR: ' + err.message); }
        }
    });
}

async function handleSplatFile(event: Event) {
    return handleSplatFileCtrl(event, createFileInputDeps());
}

async function handleModelFile(event: Event) {
    return handleModelFileCtrl(event, createFileInputDeps());
}

async function handleSTLFile(event: Event) {
    return handleSTLFileCtrl(event, createFileInputDeps());
}

function handleLoadSTLFromUrlPrompt() {
    handleLoadSTLFromUrlPromptCtrl(createFileInputDeps());
}

async function handleProxyMeshFile(event: Event) {
    return handleProxyMeshFileCtrl(event, createFileInputDeps());
}

async function handleProxySplatFile(event: Event) {
    return handleProxySplatFileCtrl(event, createFileInputDeps());
}

// Switch quality tier (delegated to archive-pipeline.ts)
async function switchQualityTier(newTier: string) { return switchQualityTierCtrl(newTier, createArchivePipelineDeps()); }

// ==================== Source Files ====================
// Extracted to source-files-manager.ts

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
function createAlignmentIODeps(): any {
    return {
        splatMesh, modelGroup, pointcloudGroup, tauriBridge,
        updateTransformInputs, storeLastPositions
    };
}

function applyAlignmentData(data: any) {
    applyAlignmentDataHandler(data, createAlignmentIODeps());
}

function loadAlignmentFromUrl(url: string) {
    return loadAlignmentFromUrlHandler(url, createAlignmentIODeps());
}

// Open share dialog with current state
async function copyShareLink() {
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
    const { showShareDialog } = await import('./modules/share-dialog.js');
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
function createControlsDeps(): any {
    return { state, config, onWindowResize };
}

function applyControlsVisibility(shouldShowOverride?: boolean) {
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

function _wireMeasurementControls() {
    // Show the measure button (starts display:none in HTML)
    const measureBtn = document.getElementById('btn-measure');
    if (measureBtn) measureBtn.style.display = '';

    // Toggle measure mode on/off
    addListener('btn-measure', 'click', () => {
        if (!measurementSystem) return;
        const active = !measurementSystem.isActive;
        measurementSystem.setMeasureMode(active);
        const btn = document.getElementById('btn-measure');
        if (btn) btn.classList.toggle('active', active);
    });

    // Scale factor inputs
    let _scaleUnit = 'm';
    addListener('measure-scale-value', 'input', (e) => {
        const val = parseFloat((e as InputEvent & { target: HTMLInputElement }).target.value);
        if (measurementSystem && !isNaN(val) && val > 0) {
            measurementSystem.setScale(val, _scaleUnit);
        }
    });
    addListener('measure-scale-unit', 'change', (e) => {
        _scaleUnit = (e as Event & { target: HTMLSelectElement }).target.value;
        const valueInput = document.getElementById('measure-scale-value') as HTMLInputElement | null;
        const val = valueInput ? parseFloat(valueInput.value) : 1;
        if (measurementSystem && !isNaN(val) && val > 0) {
            measurementSystem.setScale(val, _scaleUnit);
        }
    });

    // Clear all measurements
    addListener('measure-clear-all', 'click', () => {
        if (measurementSystem) measurementSystem.clearAll();
    });
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
async function loadSplatFromUrl(url: string) {
    return loadSplatFromUrlCtrl(url, createFileInputDeps());
}

async function loadModelFromUrl(url: string) {
    return loadModelFromUrlCtrl(url, createFileInputDeps());
}

// ============================================================
// Point cloud loading - URL wrapper
// ============================================================

function createPointcloudDeps(): any {
    return {
        pointcloudGroup,
        state,
        archiveCreator,
        callbacks: {
            onPointcloudLoaded: (object: any, file: any, pointCount: number, blob: Blob) => {
                // Detect point cloud format from filename
                const pcName = typeof file === 'string' ? file : (file?.name || '');
                const pcExt = pcName.split('.').pop()?.toLowerCase() || 'e57';
                state.pointcloudFormat = pcExt;
                assets.pointcloudBlob = blob;
                updateVisibility();
                updateTransformInputs();
                storeLastPositions();

                // Update UI
                const fileName = file.name || file;
                document.getElementById('pointcloud-filename').textContent = fileName;
                document.getElementById('pointcloud-points').textContent = pointCount.toLocaleString();
                updatePronomRegistry(state);
            }
        }
    };
}

async function loadPointcloudFromUrl(url: string) {
    return loadPointcloudFromUrlCtrl(url, createFileInputDeps());
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

// Antialiasing toggle — enable AA when a model is on screen (meshes benefit
// from MSAA), disable when only a splat is displayed (no visual benefit, pure
// GPU cost).  Called at ~2 Hz from the status-bar update block.
let _antialiasUpdatePending = false;
function updateAntialias() {
    if (_antialiasUpdatePending || !sceneManager) return;
    const needsAA = state.modelLoaded;
    _antialiasUpdatePending = true;
    sceneManager.setAntialias(needsAA).finally(() => { _antialiasUpdatePending = false; });
}

// Animation loop
let animationErrorCount = 0;
const MAX_ANIMATION_ERRORS = 10;
const fpsElement = document.getElementById('fps-counter');
let _statusBarFrameCount = 0;

// Camera dirty tracking — skip marker DOM updates when camera is stationary
const _prevCamPos = new THREE.Vector3();
const _prevCamQuat = new THREE.Quaternion();
let _markersDirty = true; // Start dirty so first frame always updates

function animate() {
    requestAnimationFrame(animate);

    try {
        // Update active camera controls
        if (flyControls && flyControls.enabled) {
            flyControls.update();
        } else {
            controls.update();
            // Only sync right controls when in split view (avoids unnecessary math per frame)
            if (state.displayMode === 'split') {
                controlsRight.target.copy(controls.target);
                controlsRight.update();
            }
        }

        // Track orbit center line to current pivot point
        sceneManager.updateOrbitCenterLine(controls.target);

        // Render using scene manager (handles split view)
        sceneManager.render(state.displayMode, splatMesh, modelGroup, pointcloudGroup, stlGroup);

        // Update cross-section plane (syncs THREE.Plane with gizmo anchor each frame)
        if (crossSection) crossSection.updatePlane();

        // Check if camera moved since last frame (skip marker DOM updates when idle)
        const camMoved = _markersDirty
            || !camera.position.equals(_prevCamPos)
            || !camera.quaternion.equals(_prevCamQuat);
        if (camMoved) {
            _prevCamPos.copy(camera.position);
            _prevCamQuat.copy(camera.quaternion);
            _markersDirty = false;

            // Update annotation marker positions
            if (annotationSystem) {
                annotationSystem.updateMarkerPositions();
            }

            // Update measurement marker positions
            if (measurementSystem) {
                measurementSystem.updateMarkerPositions();
            }

            // Update alignment marker positions
            if (landmarkAlignment) {
                landmarkAlignment.updateMarkerPositions();
            }

            // Update annotation popup position to follow marker
            updateAnnotationPopupPosition();
        }

        sceneManager.updateFPS(fpsElement);

        // Update status bar (~2 Hz to avoid DOM thrashing)
        _statusBarFrameCount++;
        if (_statusBarFrameCount >= 30) {
            _statusBarFrameCount = 0;
            const ri = renderer?.info;
            updateStatusBar({
                fps: sceneManager.lastFPS ?? 0,
                renderer: sceneManager.rendererType ?? 'WebGL',
                tris: ri?.render?.triangles ?? 0,
                splats: splatMesh?.packedSplats?.splatCount ?? 0,
                cameraMode: (flyControls && flyControls.enabled) ? 'Fly' : 'Orbit',
                filename: state.archiveFileName ?? ''
            });
            // Toggle antialiasing based on content (model loaded → AA on)
            updateAntialias();
        }

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
            await kioskInit();
        } catch (e) {
            log.error(' Kiosk init error:', e);
            log.error(' Stack:', e.stack);
        }
        return;
    }

    try {
        await init();
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
