// ES Module imports (these are hoisted - execute first before any other code)
import * as THREE from 'three';
import { SplatMesh } from '@sparkjsdev/spark';
import { ArchiveLoader, isArchiveFile } from './modules/archive-loader.js';
import { AnnotationSystem } from './modules/annotation-system.js';
import { ArchiveCreator, captureScreenshot, CRYPTO_AVAILABLE } from './modules/archive-creator.js';
import { CAMERA, TIMING, ASSET_STATE, MESH_LOD, ENVIRONMENT } from './modules/constants.js';
import { Logger, notify, computeMeshFaceCount, computeMeshVertexCount, disposeObject, fetchWithProgress } from './modules/utilities.js';
import { FlyControls } from './modules/fly-controls.js';
import { SceneManager } from './modules/scene-manager.js';
import {
    LandmarkAlignment,
    autoCenterAlign as autoCenterAlignHandler,
    fitToView as fitToViewHandler,
    resetAlignment as resetAlignmentHandler,
    resetCamera as resetCameraHandler,
    centerModelOnGrid
} from './modules/alignment.js';
import {
    showLoading,
    hideLoading,
    updateProgress,
    addListener,
    showInlineLoading,
    hideInlineLoading,
    setupCollapsibles,
    hideExportPanel,
    setDisplayMode as setDisplayModeHandler,
    updateVisibility as updateVisibilityHandler,
    updateTransformInputs as updateTransformInputsHandler,
    showExportPanel as showExportPanelHandler,
    applyControlsMode as applyControlsModeHandler
} from './modules/ui-controller.js';
import {
    formatFileSize,
    switchEditTab,
    addCustomField,
    addProcessingSoftware,
    addRelatedObject,
    collectMetadata,
    setupLicenseField,
    hideMetadataSidebar,
    addVersionEntry,
    setupFieldValidation,
    showMetadataSidebar as showMetadataSidebarHandler,
    switchSidebarMode as switchSidebarModeHandler,
    setupMetadataTabs,
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
    loadPointcloudFromBlobUrl as loadPointcloudFromBlobUrlHandler,
    loadArchiveFullResMesh,
    updatePointcloudPointSize,
    updatePointcloudOpacity,
    updateModelTextures,
    getAssetTypesForMode,
    getPrimaryAssetType,
    updateModelOpacity as updateModelOpacityFn,
    updateModelWireframe as updateModelWireframeFn,
    updateModelMatcap as updateModelMatcapFn,
    updateModelNormals as updateModelNormalsFn,
    loadGLTF,
    loadOBJFromUrl as loadOBJFromUrlFn,
    loadSTLFile as loadSTLFileHandler,
    loadSTLFromUrlWithDeps as loadSTLFromUrlWithDepsHandler
} from './modules/file-handlers.js';
import {
    initShareDialog,
    showShareDialog
} from './modules/share-dialog.js';
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
// kiosk-viewer.js is loaded dynamically in downloadGenericViewer() to avoid
// blocking the main application if the module fails to load.

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

// Blob data for archive export (stored when loading files)
let currentSplatBlob = null;
let currentMeshBlob = null;
let currentProxyMeshBlob = null;
let currentPointcloudBlob = null;
let sourceFiles = []; // Array of { file: File|null, name: string, size: number, category: string, fromArchive: boolean }

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
                currentSplatBlob = file;
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
                currentMeshBlob = file;
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
        currentSplatBlob,
        currentMeshBlob,
        currentPointcloudBlob,
        updateAnnotationsList: updateSidebarAnnotationsList,
        onAddAnnotation: toggleAnnotationMode,
        onUpdateAnnotationCamera: updateSelectedAnnotationCamera,
        onDeleteAnnotation: deleteSelectedAnnotation,
        onAnnotationUpdated: () => { updateAnnotationsUI(); updateSidebarAnnotationsList(); }
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

    // Setup UI events
    setupUIEvents();

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

function setupUIEvents() {
    log.info(' Setting up UI events...');

    // Controls panel toggle
    const toggleBtn = document.getElementById('btn-toggle-controls');
    log.info(' Toggle button found:', !!toggleBtn);
    if (toggleBtn) {
        toggleBtn.onclick = function(e) {
            log.info(' Toggle button clicked');
            e.preventDefault();
            e.stopPropagation();
            try {
                toggleControlsPanel();
            } catch (err) {
                log.error(' Error in toggleControlsPanel:', err);
                // Fallback: use class-based toggle (no inline display styles)
                const panel = document.getElementById('controls-panel');
                if (panel) {
                    const isHidden = panel.classList.contains('panel-hidden');
                    if (isHidden) {
                        panel.classList.remove('panel-hidden');
                    } else {
                        panel.classList.add('panel-hidden');
                    }
                    state.controlsVisible = !isHidden;
                }
            }
        };
    }

    // Display mode toggles
    addListener('btn-splat', 'click', () => setDisplayMode('splat'));
    addListener('btn-model', 'click', () => setDisplayMode('model'));
    addListener('btn-pointcloud', 'click', () => setDisplayMode('pointcloud'));
    addListener('btn-both', 'click', () => setDisplayMode('both'));
    addListener('btn-split', 'click', () => setDisplayMode('split'));
    addListener('btn-stl', 'click', () => setDisplayMode('stl'));

    // File inputs
    addListener('splat-input', 'change', handleSplatFile);
    addListener('model-input', 'change', handleModelFile);
    addListener('archive-input', 'change', handleArchiveFile);
    addListener('pointcloud-input', 'change', handlePointcloudFile);
    addListener('proxy-mesh-input', 'change', handleProxyMeshFile);
    addListener('stl-input', 'change', handleSTLFile);
    addListener('btn-load-stl-url', 'click', handleLoadSTLFromUrlPrompt);
    addListener('source-files-input', 'change', handleSourceFilesInput);
    addListener('btn-load-pointcloud-url', 'click', handleLoadPointcloudFromUrlPrompt);
    addListener('btn-load-archive-url', 'click', handleLoadArchiveFromUrlPrompt);
    addListener('btn-load-full-res', 'click', handleLoadFullResMesh);
    addListener('proxy-load-full-link', 'click', (e) => { e.preventDefault(); handleLoadFullResMesh(); });

    // URL load buttons (using prompt)
    const splatUrlBtn = document.getElementById('btn-load-splat-url');
    const modelUrlBtn = document.getElementById('btn-load-model-url');
    log.info(' URL buttons found - splat:', !!splatUrlBtn, 'model:', !!modelUrlBtn);

    if (splatUrlBtn) {
        splatUrlBtn.addEventListener('click', handleLoadSplatFromUrlPrompt);
    }
    if (modelUrlBtn) {
        modelUrlBtn.addEventListener('click', handleLoadModelFromUrlPrompt);
    }

    // Splat settings
    addListener('splat-scale', 'input', (e) => {
        const scale = parseFloat(e.target.value);
        const valueEl = document.getElementById('splat-scale-value');
        if (valueEl) valueEl.textContent = scale.toFixed(1);
        if (splatMesh) {
            splatMesh.scale.setScalar(scale);
        }
    });

    // Splat position inputs
    ['x', 'y', 'z'].forEach(axis => {
        addListener(`splat-pos-${axis}`, 'change', (e) => {
            if (splatMesh) {
                splatMesh.position[axis] = parseFloat(e.target.value) || 0;
            }
        });
        addListener(`splat-rot-${axis}`, 'change', (e) => {
            if (splatMesh) {
                splatMesh.rotation[axis] = THREE.MathUtils.degToRad(parseFloat(e.target.value) || 0);
            }
        });
    });

    // Model settings
    addListener('model-scale', 'input', (e) => {
        const scale = parseFloat(e.target.value);
        const valueEl = document.getElementById('model-scale-value');
        if (valueEl) valueEl.textContent = scale.toFixed(1);
        if (modelGroup) {
            modelGroup.scale.setScalar(scale);
        }
    });

    addListener('model-opacity', 'input', (e) => {
        state.modelOpacity = parseFloat(e.target.value);
        const valueEl = document.getElementById('model-opacity-value');
        if (valueEl) valueEl.textContent = state.modelOpacity.toFixed(2);
        updateModelOpacity();
    });

    addListener('model-wireframe', 'change', (e) => {
        state.modelWireframe = e.target.checked;
        if (e.target.checked) {
            if (state.modelMatcap) {
                state.modelMatcap = false;
                const matcapCb = document.getElementById('model-matcap');
                if (matcapCb) matcapCb.checked = false;
                const styleGroup = document.getElementById('matcap-style-group');
                if (styleGroup) styleGroup.style.display = 'none';
                updateModelMatcap();
            }
            if (state.modelNormals) {
                state.modelNormals = false;
                const normalsCb = document.getElementById('model-normals');
                if (normalsCb) normalsCb.checked = false;
                updateModelNormals();
            }
        }
        updateModelWireframe();
    });

    addListener('model-matcap', 'change', (e) => {
        state.modelMatcap = e.target.checked;
        const styleGroup = document.getElementById('matcap-style-group');
        if (styleGroup) styleGroup.style.display = e.target.checked ? '' : 'none';
        if (e.target.checked) {
            if (state.modelWireframe) {
                state.modelWireframe = false;
                const wireCb = document.getElementById('model-wireframe');
                if (wireCb) wireCb.checked = false;
                updateModelWireframe();
            }
            if (state.modelNormals) {
                state.modelNormals = false;
                const normalsCb = document.getElementById('model-normals');
                if (normalsCb) normalsCb.checked = false;
                updateModelNormals();
            }
        }
        updateModelMatcap();
    });

    addListener('matcap-style', 'change', (e) => {
        state.matcapStyle = e.target.value;
        if (state.modelMatcap) updateModelMatcap();
    });

    addListener('model-normals', 'change', (e) => {
        state.modelNormals = e.target.checked;
        if (e.target.checked) {
            // Turn off matcap
            if (state.modelMatcap) {
                state.modelMatcap = false;
                const matcapCb = document.getElementById('model-matcap');
                if (matcapCb) matcapCb.checked = false;
                const styleGroup = document.getElementById('matcap-style-group');
                if (styleGroup) styleGroup.style.display = 'none';
                updateModelMatcap();
            }
            // Turn off wireframe
            if (state.modelWireframe) {
                state.modelWireframe = false;
                const wireCb = document.getElementById('model-wireframe');
                if (wireCb) wireCb.checked = false;
                updateModelWireframe();
            }
        }
        updateModelNormals();
    });

    addListener('model-no-texture', 'change', (e) => {
        updateModelTextures(modelGroup, !e.target.checked);
    });

    // Model position inputs
    ['x', 'y', 'z'].forEach(axis => {
        addListener(`model-pos-${axis}`, 'change', (e) => {
            if (modelGroup) {
                modelGroup.position[axis] = parseFloat(e.target.value) || 0;
            }
        });
        addListener(`model-rot-${axis}`, 'change', (e) => {
            if (modelGroup) {
                modelGroup.rotation[axis] = THREE.MathUtils.degToRad(parseFloat(e.target.value) || 0);
            }
        });
    });

    // Point cloud settings
    addListener('pointcloud-scale', 'input', (e) => {
        const scale = parseFloat(e.target.value);
        const valueEl = document.getElementById('pointcloud-scale-value');
        if (valueEl) valueEl.textContent = scale.toFixed(1);
        if (pointcloudGroup) {
            pointcloudGroup.scale.setScalar(scale);
        }
    });

    addListener('pointcloud-point-size', 'input', (e) => {
        state.pointcloudPointSize = parseFloat(e.target.value);
        const valueEl = document.getElementById('pointcloud-point-size-value');
        if (valueEl) valueEl.textContent = state.pointcloudPointSize.toFixed(3);
        updatePointcloudPointSize(pointcloudGroup, state.pointcloudPointSize);
    });

    addListener('pointcloud-opacity', 'input', (e) => {
        state.pointcloudOpacity = parseFloat(e.target.value);
        const valueEl = document.getElementById('pointcloud-opacity-value');
        if (valueEl) valueEl.textContent = state.pointcloudOpacity.toFixed(2);
        updatePointcloudOpacity(pointcloudGroup, state.pointcloudOpacity);
    });

    // Point cloud position inputs
    ['x', 'y', 'z'].forEach(axis => {
        addListener(`pointcloud-pos-${axis}`, 'change', (e) => {
            if (pointcloudGroup) {
                pointcloudGroup.position[axis] = parseFloat(e.target.value) || 0;
            }
        });
        addListener(`pointcloud-rot-${axis}`, 'change', (e) => {
            if (pointcloudGroup) {
                pointcloudGroup.rotation[axis] = THREE.MathUtils.degToRad(parseFloat(e.target.value) || 0);
            }
        });
    });

    // Alignment buttons
    addListener('btn-reset-alignment', 'click', resetAlignment);

    // Share button
    addListener('btn-share', 'click', copyShareLink);

    // Preview kiosk mode in new tab
    addListener('btn-preview-kiosk', 'click', () => {
        const url = new URL(window.location.href);
        url.searchParams.set('kiosk', 'true');
        window.open(url.toString(), '_blank');
    });

    // Camera buttons
    addListener('btn-reset-camera', 'click', resetCamera);
    addListener('btn-fit-view', 'click', fitToView);

    // Lighting controls
    addListener('ambient-intensity', 'input', (e) => {
        const intensity = parseFloat(e.target.value);
        const valueEl = document.getElementById('ambient-intensity-value');
        if (valueEl) valueEl.textContent = intensity.toFixed(1);
        if (ambientLight) ambientLight.intensity = intensity;
    });

    addListener('hemisphere-intensity', 'input', (e) => {
        const intensity = parseFloat(e.target.value);
        const valueEl = document.getElementById('hemisphere-intensity-value');
        if (valueEl) valueEl.textContent = intensity.toFixed(1);
        if (hemisphereLight) hemisphereLight.intensity = intensity;
    });

    addListener('directional1-intensity', 'input', (e) => {
        const intensity = parseFloat(e.target.value);
        const valueEl = document.getElementById('directional1-intensity-value');
        if (valueEl) valueEl.textContent = intensity.toFixed(1);
        if (directionalLight1) directionalLight1.intensity = intensity;
    });

    addListener('directional2-intensity', 'input', (e) => {
        const intensity = parseFloat(e.target.value);
        const valueEl = document.getElementById('directional2-intensity-value');
        if (valueEl) valueEl.textContent = intensity.toFixed(1);
        if (directionalLight2) directionalLight2.intensity = intensity;
    });

    // Align objects button (landmark alignment toggle)
    addListener('btn-align', 'click', toggleAlignment);

    // Annotation controls
    const annoBtn = addListener('btn-annotate', 'click', toggleAnnotationMode);
    const addAnnoBtn = addListener('btn-sidebar-add-annotation', 'click', toggleAnnotationMode);
    log.info(' Annotation buttons attached:', { annoBtn, addAnnoBtn });
    addListener('btn-anno-save', 'click', saveAnnotation);
    addListener('btn-anno-cancel', 'click', cancelAnnotation);
    addListener('btn-sidebar-update-anno-camera', 'click', updateSelectedAnnotationCamera);
    addListener('btn-sidebar-delete-anno', 'click', deleteSelectedAnnotation);

    // Fly camera mode toggle
    addListener('btn-fly-mode', 'click', toggleFlyMode);

    // Auto-rotate toggle
    addListener('btn-auto-rotate', 'click', () => {
        controls.autoRotate = !controls.autoRotate;
        const btn = document.getElementById('btn-auto-rotate');
        if (btn) btn.classList.toggle('active', controls.autoRotate);
    });

    // Export/archive creation controls
    addListener('btn-export-archive', 'click', showExportPanel);
    addListener('btn-export-cancel', 'click', hideExportPanel);
    addListener('btn-export-download', 'click', downloadArchive);

    // Generic viewer download button
    addListener('btn-download-viewer', 'click', downloadGenericViewer);

    // Screenshot controls
    addListener('btn-capture-screenshot', 'click', captureScreenshotToList);
    addListener('btn-set-preview', 'click', showViewfinder);
    addListener('btn-capture-preview', 'click', captureManualPreview);
    addListener('btn-cancel-preview', 'click', hideViewfinder);
    addListener('btn-clear-manual-preview', 'click', () => {
        state.manualPreviewBlob = null;
        const status = document.getElementById('manual-preview-status');
        if (status) status.style.display = 'none';
        notify.success('Manual preview cleared');
    });

    // Metadata panel controls
    addListener('btn-close-sidebar', 'click', hideMetadataPanel);
    addListener('btn-add-custom-field', 'click', addCustomField);
    setupMetadataTabs();
    setupLicenseField();

    // Metadata display toggle (toolbar button)
    addListener('btn-metadata', 'click', toggleMetadataDisplay);

    // Scene settings - Camera FOV
    addListener('camera-fov', 'input', (e) => {
        const fov = parseInt(e.target.value, 10);
        const valueEl = document.getElementById('camera-fov-value');
        if (valueEl) valueEl.textContent = fov;
        if (camera) {
            camera.fov = fov;
            camera.updateProjectionMatrix();
        }
    });

    // Scene settings - Gridlines
    addListener('toggle-gridlines', 'change', (e) => {
        toggleGridlines(e.target.checked);
    });

    // Scene settings - Background color presets
    document.querySelectorAll('.color-preset').forEach(btn => {
        btn.addEventListener('click', () => {
            const color = btn.dataset.color;
            setBackgroundColor(color);
            // Update active state
            document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Update color picker
            const picker = document.getElementById('bg-color-picker');
            if (picker) picker.value = color;
            // Uncheck env-as-background
            const envBgToggle = document.getElementById('toggle-env-background');
            if (envBgToggle) envBgToggle.checked = false;
        });
    });

    // Scene settings - Custom background color
    addListener('bg-color-picker', 'input', (e) => {
        setBackgroundColor(e.target.value);
        // Remove active from presets
        document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
        // Uncheck env-as-background
        const envBgToggle = document.getElementById('toggle-env-background');
        if (envBgToggle) envBgToggle.checked = false;
    });

    // Scene settings - Background image
    addListener('bg-image-input', 'change', async (e) => {
        const file = e.target.files[0];
        if (!file || !sceneManager) return;
        try {
            await sceneManager.loadBackgroundImageFromFile(file);
            const filenameEl = document.getElementById('bg-image-filename');
            if (filenameEl) { filenameEl.textContent = file.name; filenameEl.style.display = ''; }
            const envBgToggle = document.getElementById('toggle-env-background');
            if (envBgToggle) envBgToggle.checked = false;
            document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
            const clearBtn = document.getElementById('btn-clear-bg-image');
            if (clearBtn) clearBtn.style.display = '';
        } catch (err) {
            notify.error('Failed to load background image: ' + err.message);
        }
    });

    addListener('btn-load-bg-image-url', 'click', async () => {
        const url = prompt('Enter background image URL:');
        if (!url || !sceneManager) return;
        try {
            await sceneManager.loadBackgroundImage(url);
            const envBgToggle = document.getElementById('toggle-env-background');
            if (envBgToggle) envBgToggle.checked = false;
            document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
            const clearBtn = document.getElementById('btn-clear-bg-image');
            if (clearBtn) clearBtn.style.display = '';
        } catch (err) {
            notify.error('Failed to load background image: ' + err.message);
        }
    });

    addListener('btn-clear-bg-image', 'click', () => {
        if (!sceneManager) return;
        sceneManager.clearBackgroundImage();
        sceneManager.setBackgroundColor(
            '#' + (sceneManager.savedBackgroundColor || new THREE.Color(0x1a1a2e)).getHexString()
        );
        const filenameEl = document.getElementById('bg-image-filename');
        if (filenameEl) filenameEl.style.display = 'none';
        const clearBtn = document.getElementById('btn-clear-bg-image');
        if (clearBtn) clearBtn.style.display = 'none';
    });

    // Scene settings - Tone mapping
    addListener('tone-mapping-select', 'change', (e) => {
        if (sceneManager) sceneManager.setToneMapping(e.target.value);
    });

    addListener('tone-mapping-exposure', 'input', (e) => {
        const val = parseFloat(e.target.value);
        document.getElementById('tone-mapping-exposure-value').textContent = val.toFixed(1);
        if (sceneManager) sceneManager.setToneMappingExposure(val);
    });

    // Scene settings - Environment map (IBL)
    addListener('env-map-select', 'change', async (e) => {
        const value = e.target.value;
        if (!value) {
            if (sceneManager) sceneManager.clearEnvironment();
            return;
        }
        if (value.startsWith('preset:')) {
            const index = parseInt(value.split(':')[1]);
            const presets = ENVIRONMENT.PRESETS.filter(p => p.url);
            if (presets[index]) {
                showLoading('Loading HDR environment...');
                try {
                    await sceneManager.loadHDREnvironment(presets[index].url);
                    notify.success('Environment loaded');
                } catch (err) {
                    notify.error('Failed to load environment: ' + err.message);
                } finally {
                    hideLoading();
                }
            }
        }
    });

    addListener('hdr-file-input', 'change', async (e) => {
        const file = e.target.files[0];
        if (!file) return;
        showLoading('Loading HDR environment...');
        try {
            await sceneManager.loadHDREnvironmentFromFile(file);
            const filenameEl = document.getElementById('hdr-filename');
            if (filenameEl) { filenameEl.textContent = file.name; filenameEl.style.display = ''; }
            const select = document.getElementById('env-map-select');
            if (select) select.value = '';
            notify.success('Environment loaded from file');
        } catch (err) {
            notify.error('Failed to load HDR: ' + err.message);
        } finally {
            hideLoading();
        }
    });

    addListener('btn-load-hdr-url', 'click', async () => {
        const url = prompt('Enter HDR file URL (.hdr):');
        if (!url) return;
        showLoading('Loading HDR environment...');
        try {
            await sceneManager.loadHDREnvironment(url);
            const select = document.getElementById('env-map-select');
            if (select) select.value = '';
            notify.success('Environment loaded from URL');
        } catch (err) {
            notify.error('Failed to load HDR: ' + err.message);
        } finally {
            hideLoading();
        }
    });

    // Scene settings - Environment as background
    addListener('toggle-env-background', 'change', (e) => {
        if (sceneManager) sceneManager.setEnvironmentAsBackground(e.target.checked);
    });

    // Scene settings - Shadows
    addListener('toggle-shadows', 'change', (e) => {
        if (sceneManager) sceneManager.enableShadows(e.target.checked);
        const opacityGroup = document.getElementById('shadow-opacity-group');
        if (opacityGroup) opacityGroup.style.display = e.target.checked ? '' : 'none';
    });

    addListener('shadow-opacity', 'input', (e) => {
        const val = parseFloat(e.target.value);
        document.getElementById('shadow-opacity-value').textContent = val.toFixed(2);
        if (sceneManager) sceneManager.setShadowCatcherOpacity(val);
    });

    // Close annotation popup when clicking outside
    document.addEventListener('click', (e) => {
        const popup = document.getElementById('annotation-info-popup');
        if (popup && !popup.classList.contains('hidden')) {
            // Check if click was outside popup and not on an annotation marker
            if (!popup.contains(e.target) && !e.target.closest('.annotation-marker')) {
                dismissPopupHandler(createAnnotationControllerDeps());
            }
        }
    });

    // Keyboard shortcuts
    window.addEventListener('keydown', (e) => {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
            return; // Don't trigger if typing in input
        }

        // In fly mode, only allow F (toggle out) and Escape
        if (flyControls && flyControls.enabled) {
            if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
                toggleFlyMode();
            }
            return;
        }

        if (e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey) {
            toggleAnnotationMode();
        } else if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) {
            toggleMetadataDisplay();
        } else if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
            toggleFlyMode();
        } else if (e.key === 'Escape') {
            dismissPopupHandler(createAnnotationControllerDeps());
            hideMetadataDisplay();
        }
    });

    // Setup collapsible sections
    setupCollapsibles();

    // Metadata sidebar event handlers
    setupMetadataSidebar();

    log.info(' UI events setup complete');
}

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

function setSelectedObject(selection) {
    state.selectedObject = selection;

    // Update button states
    ['splat', 'model', 'both', 'none'].forEach(s => {
        const btn = document.getElementById(`btn-select-${s}`);
        if (btn) btn.classList.toggle('active', s === selection);
    });

    // Attach transform controls with error handling
    try {
        transformControls.detach();
    } catch (e) {
        log.warn(' Error detaching transform controls:', e);
    }

    try {
        if (selection === 'splat' && splatMesh) {
            transformControls.attach(splatMesh);
        } else if (selection === 'model' && modelGroup && modelGroup.children.length > 0) {
            transformControls.attach(modelGroup);
        } else if (selection === 'both') {
            // For both, attach to splat and sync model
            if (splatMesh) {
                transformControls.attach(splatMesh);
            } else if (modelGroup && modelGroup.children.length > 0) {
                transformControls.attach(modelGroup);
            }
        }
    } catch (attachError) {
        log.error(' Error attaching transform controls:', attachError);
        log.error(' This may be due to THREE.js instance mismatch.');
        // Don't re-throw - allow the rest of the application to continue
    }
}

// Sync both objects when moving in "both" mode
let lastSplatPosition = new THREE.Vector3();
let lastSplatRotation = new THREE.Euler();
let lastSplatScale = new THREE.Vector3(1, 1, 1);
let lastModelPosition = new THREE.Vector3();
let lastModelRotation = new THREE.Euler();
let lastModelScale = new THREE.Vector3(1, 1, 1);
let lastPointcloudPosition = new THREE.Vector3();
let lastPointcloudRotation = new THREE.Euler();
let lastPointcloudScale = new THREE.Vector3(1, 1, 1);

function syncBothObjects() {
    if (!splatMesh || !modelGroup) return;

    // Calculate the delta movement based on which object is attached
    if (transformControls.object === splatMesh) {
        const deltaPos = new THREE.Vector3().subVectors(splatMesh.position, lastSplatPosition);
        const deltaRot = new THREE.Euler(
            splatMesh.rotation.x - lastSplatRotation.x,
            splatMesh.rotation.y - lastSplatRotation.y,
            splatMesh.rotation.z - lastSplatRotation.z
        );
        // Calculate scale ratio to apply proportionally
        const scaleRatio = lastSplatScale.x !== 0 ? splatMesh.scale.x / lastSplatScale.x : 1;

        modelGroup.position.add(deltaPos);
        modelGroup.rotation.x += deltaRot.x;
        modelGroup.rotation.y += deltaRot.y;
        modelGroup.rotation.z += deltaRot.z;
        modelGroup.scale.multiplyScalar(scaleRatio);

        if (pointcloudGroup) {
            pointcloudGroup.position.add(deltaPos);
            pointcloudGroup.rotation.x += deltaRot.x;
            pointcloudGroup.rotation.y += deltaRot.y;
            pointcloudGroup.rotation.z += deltaRot.z;
            pointcloudGroup.scale.multiplyScalar(scaleRatio);
        }
    } else if (transformControls.object === modelGroup) {
        const deltaPos = new THREE.Vector3().subVectors(modelGroup.position, lastModelPosition);
        const deltaRot = new THREE.Euler(
            modelGroup.rotation.x - lastModelRotation.x,
            modelGroup.rotation.y - lastModelRotation.y,
            modelGroup.rotation.z - lastModelRotation.z
        );
        // Calculate scale ratio to apply proportionally
        const scaleRatio = lastModelScale.x !== 0 ? modelGroup.scale.x / lastModelScale.x : 1;

        splatMesh.position.add(deltaPos);
        splatMesh.rotation.x += deltaRot.x;
        splatMesh.rotation.y += deltaRot.y;
        splatMesh.rotation.z += deltaRot.z;
        splatMesh.scale.multiplyScalar(scaleRatio);

        if (pointcloudGroup) {
            pointcloudGroup.position.add(deltaPos);
            pointcloudGroup.rotation.x += deltaRot.x;
            pointcloudGroup.rotation.y += deltaRot.y;
            pointcloudGroup.rotation.z += deltaRot.z;
            pointcloudGroup.scale.multiplyScalar(scaleRatio);
        }
    }

    // Update last positions and scales
    if (splatMesh) {
        lastSplatPosition.copy(splatMesh.position);
        lastSplatRotation.copy(splatMesh.rotation);
        lastSplatScale.copy(splatMesh.scale);
    }
    if (modelGroup) {
        lastModelPosition.copy(modelGroup.position);
        lastModelRotation.copy(modelGroup.rotation);
        lastModelScale.copy(modelGroup.scale);
    }
    if (pointcloudGroup) {
        lastPointcloudPosition.copy(pointcloudGroup.position);
        lastPointcloudRotation.copy(pointcloudGroup.rotation);
        lastPointcloudScale.copy(pointcloudGroup.scale);
    }
}

// Store last positions, rotations, and scales when selection changes
function storeLastPositions() {
    if (splatMesh) {
        lastSplatPosition.copy(splatMesh.position);
        lastSplatRotation.copy(splatMesh.rotation);
        lastSplatScale.copy(splatMesh.scale);
    }
    if (modelGroup) {
        lastModelPosition.copy(modelGroup.position);
        lastModelRotation.copy(modelGroup.rotation);
        lastModelScale.copy(modelGroup.scale);
    }
    if (pointcloudGroup) {
        lastPointcloudPosition.copy(pointcloudGroup.position);
        lastPointcloudRotation.copy(pointcloudGroup.rotation);
        lastPointcloudScale.copy(pointcloudGroup.scale);
    }
}

function setTransformMode(mode) {
    state.transformMode = mode;
    transformControls.setMode(mode);

    // Update button states
    ['translate', 'rotate', 'scale'].forEach(m => {
        const btnId = m === 'translate' ? 'btn-translate' : m === 'rotate' ? 'btn-rotate' : 'btn-scale';
        const btn = document.getElementById(btnId);
        if (btn) btn.classList.toggle('active', m === mode);
    });

    // Store positions when changing mode
    storeLastPositions();
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

// Handle archive file input
async function handleArchiveFile(event) {
    const file = event.target.files[0];
    if (!file) return;

    document.getElementById('archive-filename').textContent = file.name;
    showLoading('Loading archive...');

    try {
        // Clean up previous archive if any
        if (state.archiveLoader) {
            state.archiveLoader.dispose();
        }

        const archiveLoader = new ArchiveLoader();
        await archiveLoader.loadFromFile(file);
        await processArchive(archiveLoader, file.name);

        state.currentArchiveUrl = null; // Local files cannot be shared
    } catch (error) {
        log.error('Error loading archive:', error);
        hideLoading();
        notify.error('Error loading archive: ' + error.message);
    }
}

// Load archive from URL
async function loadArchiveFromUrl(url) {
    showLoading('Downloading archive...');

    try {
        // Clean up previous archive if any
        if (state.archiveLoader) {
            state.archiveLoader.dispose();
        }

        const archiveLoader = new ArchiveLoader();
        await archiveLoader.loadFromUrl(url, (progress) => {
            showLoading(`Downloading archive... ${Math.round(progress * 100)}%`);
        });

        const fileName = url.split('/').pop() || 'archive.a3d';
        document.getElementById('archive-filename').textContent = fileName;

        state.currentArchiveUrl = url;
        await processArchive(archiveLoader, fileName);
    } catch (error) {
        log.error('Error loading archive from URL:', error);
        hideLoading();
        notify.error('Error loading archive from URL: ' + error.message);
    }
}

// Ensure a single archive asset type is loaded on demand.
// Returns true if the asset is loaded (or was already loaded), false otherwise.
async function ensureAssetLoaded(assetType) {
    if (!state.archiveLoader) return false;
    const archiveLoader = state.archiveLoader;

    // Already loaded
    if (state.assetStates[assetType] === ASSET_STATE.LOADED) return true;
    // Already errored — don't retry automatically
    if (state.assetStates[assetType] === ASSET_STATE.ERROR) return false;
    // Already loading — wait for it
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

    state.assetStates[assetType] = ASSET_STATE.LOADING;
    showInlineLoading(assetType);

    try {
        if (assetType === 'splat') {
            const sceneEntry = archiveLoader.getSceneEntry();
            const contentInfo = archiveLoader.getContentInfo();
            if (!sceneEntry || !contentInfo.hasSplat) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return false;
            }
            const splatData = await archiveLoader.extractFile(sceneEntry.file_name);
            if (!splatData) { state.assetStates[assetType] = ASSET_STATE.ERROR; return false; }
            await loadSplatFromBlobUrl(splatData.url, sceneEntry.file_name);
            // Apply transform
            const transform = archiveLoader.getEntryTransform(sceneEntry);
            if (splatMesh && (transform.position.some(v => v !== 0) || transform.rotation.some(v => v !== 0) || transform.scale !== 1)) {
                splatMesh.position.fromArray(transform.position);
                splatMesh.rotation.set(...transform.rotation);
                splatMesh.scale.setScalar(transform.scale);
            }
            currentSplatBlob = splatData.blob;
            state.assetStates[assetType] = ASSET_STATE.LOADED;
            return true;

        } else if (assetType === 'mesh') {
            const contentInfo = archiveLoader.getContentInfo();
            const meshEntry = archiveLoader.getMeshEntry();
            if (!meshEntry || !contentInfo.hasMesh) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return false;
            }
            // Prefer proxy mesh when available
            const proxyEntry = archiveLoader.getMeshProxyEntry();
            const useProxy = contentInfo.hasMeshProxy && proxyEntry;
            const entryToLoad = useProxy ? proxyEntry : meshEntry;

            const meshData = await archiveLoader.extractFile(entryToLoad.file_name);
            if (!meshData) { state.assetStates[assetType] = ASSET_STATE.ERROR; return false; }
            await loadModelFromBlobUrl(meshData.url, entryToLoad.file_name);
            // Apply transform from primary mesh entry
            const transform = archiveLoader.getEntryTransform(meshEntry);
            if (modelGroup && (transform.position.some(v => v !== 0) || transform.rotation.some(v => v !== 0) || transform.scale !== 1)) {
                modelGroup.position.fromArray(transform.position);
                modelGroup.rotation.set(...transform.rotation);
                modelGroup.scale.setScalar(transform.scale);
            }
            if (useProxy) {
                // Store the proxy blob for re-export, extract full-res blob in background
                currentProxyMeshBlob = meshData.blob;
                const proxyName = entryToLoad.file_name.split('/').pop();
                const proxyFilenameEl = document.getElementById('proxy-mesh-filename');
                if (proxyFilenameEl) proxyFilenameEl.textContent = proxyName;
                archiveLoader.extractFile(meshEntry.file_name).then(fullData => {
                    if (fullData) currentMeshBlob = fullData.blob;
                }).catch(() => {});
                state.viewingProxy = true;
                document.getElementById('proxy-mesh-indicator')?.classList.remove('hidden');
                const fullResBtn = document.getElementById('btn-load-full-res');
                if (fullResBtn) fullResBtn.style.display = '';
            } else {
                currentMeshBlob = meshData.blob;
            }
            state.assetStates[assetType] = ASSET_STATE.LOADED;
            return true;

        } else if (assetType === 'pointcloud') {
            const contentInfo = archiveLoader.getContentInfo();
            if (!contentInfo.hasPointcloud) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return false;
            }
            const pointcloudEntry = archiveLoader.getPointcloudEntry();
            if (!pointcloudEntry) { state.assetStates[assetType] = ASSET_STATE.UNLOADED; return false; }
            const pcData = await archiveLoader.extractFile(pointcloudEntry.file_name);
            if (!pcData) { state.assetStates[assetType] = ASSET_STATE.ERROR; return false; }
            const result = await loadPointcloudFromBlobUrlHandler(pcData.url, pointcloudEntry.file_name, { pointcloudGroup });
            state.pointcloudLoaded = true;
            // Apply transform
            const transform = archiveLoader.getEntryTransform(pointcloudEntry);
            if (pointcloudGroup && (transform.position.some(v => v !== 0) || transform.rotation.some(v => v !== 0) || transform.scale !== 1)) {
                pointcloudGroup.position.fromArray(transform.position);
                pointcloudGroup.rotation.set(...transform.rotation);
                pointcloudGroup.scale.setScalar(transform.scale);
            }
            document.getElementById('pointcloud-filename').textContent = pointcloudEntry.file_name.split('/').pop();
            document.getElementById('pointcloud-points').textContent = result.pointCount.toLocaleString();
            currentPointcloudBlob = pcData.blob;
            state.assetStates[assetType] = ASSET_STATE.LOADED;
            return true;
        }

        return false;
    } catch (e) {
        log.error(`Error loading ${assetType} from archive:`, e);
        state.assetStates[assetType] = ASSET_STATE.ERROR;
        return false;
    } finally {
        hideInlineLoading(assetType);
    }
}

// Process loaded archive - phased lazy loading
async function processArchive(archiveLoader, archiveName) {
    showLoading('Parsing manifest...');

    try {
        // === Phase 1: Manifest + metadata (fast, no 3D decompression) ===
        const manifest = await archiveLoader.parseManifest();
        log.info(' Archive manifest:', manifest);

        state.archiveLoader = archiveLoader;
        state.archiveManifest = manifest;
        state.archiveFileName = archiveName;
        state.archiveLoaded = true;
        // Reset asset states for new archive
        state.assetStates = { splat: ASSET_STATE.UNLOADED, mesh: ASSET_STATE.UNLOADED, pointcloud: ASSET_STATE.UNLOADED };

        // Prefill metadata panel from loaded archive
        prefillMetadataFromArchive(manifest);

        const contentInfo = archiveLoader.getContentInfo();

        // Update archive metadata UI
        updateArchiveMetadataUI(manifest, archiveLoader);

        // Check for global alignment data
        const globalAlignment = archiveLoader.getGlobalAlignment();

        // Load annotations from archive
        const annotations = archiveLoader.getAnnotations();

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
            log.info(` Extracted ${state.imageAssets.size} embedded images`);
        }

        // Populate source files list from archive manifest (metadata only).
        // Blobs are re-extracted on demand at export time via archiveLoader.extractFile().
        // releaseRawData() is skipped when source files exist so extraction stays possible.
        const archiveSourceEntries = archiveLoader.getSourceFileEntries();
        if (archiveSourceEntries.length > 0) {
            for (const { entry } of archiveSourceEntries) {
                sourceFiles.push({
                    file: null,
                    name: entry.original_name || entry.file_name.split('/').pop(),
                    size: entry.size_bytes || 0,
                    category: entry.source_category || '',
                    fromArchive: true
                });
            }
            updateSourceFilesUI();
            log.info(` Found ${archiveSourceEntries.length} source files in archive manifest`);
        }

        // === Phase 2: Load primary asset for current display mode ===
        const primaryType = getPrimaryAssetType(state.displayMode, contentInfo);
        showLoading(`Loading ${primaryType} from archive...`);
        const primaryLoaded = await ensureAssetLoaded(primaryType);

        if (!primaryLoaded) {
            // Try loading any available asset
            const fallbackTypes = ['splat', 'mesh', 'pointcloud'].filter(t => t !== primaryType);
            let anyLoaded = false;
            for (const type of fallbackTypes) {
                showLoading(`Loading ${type} from archive...`);
                if (await ensureAssetLoaded(type)) {
                    anyLoaded = true;
                    break;
                }
            }
            if (!anyLoaded) {
                hideLoading();
                notify.warning('Archive does not contain any viewable splat, mesh, or point cloud files.');
                return;
            }
        }

        // Apply global alignment after primary asset is loaded
        if (globalAlignment) {
            applyAlignmentData(globalAlignment);
        }

        // Update UI
        updateTransformInputs();
        storeLastPositions();

        // Load annotations
        if (annotations && annotations.length > 0) {
            loadAnnotationsFromArchive(annotations);
        }

        hideLoading();

        // === Phase 3: Background-load remaining assets ===
        const remainingTypes = ['splat', 'mesh', 'pointcloud'].filter(
            t => t !== primaryType && state.assetStates[t] === ASSET_STATE.UNLOADED
        );
        if (remainingTypes.length > 0) {
            setTimeout(async () => {
                for (const type of remainingTypes) {
                    const typeContentCheck = (type === 'splat' && contentInfo.hasSplat) ||
                                             (type === 'mesh' && contentInfo.hasMesh) ||
                                             (type === 'pointcloud' && contentInfo.hasPointcloud);
                    if (typeContentCheck) {
                        log.info(`Background loading: ${type}`);
                        await ensureAssetLoaded(type);
                        updateTransformInputs();
                    }
                }
                // Release raw ZIP data after all assets are extracted,
                // but keep it if archive has source files (needed for re-export).
                // For file-based archives, _file is just a File handle — no memory cost.
                if (!archiveLoader.hasSourceFiles()) {
                    archiveLoader.releaseRawData();
                    log.info('All archive assets loaded, raw data released');
                } else {
                    log.info('All archive assets loaded, raw data retained for source file re-export');
                }
            }, 100);
        } else {
            if (!archiveLoader.hasSourceFiles()) {
                archiveLoader.releaseRawData();
            } else {
                log.info('Raw data retained for source file re-export');
            }
        }
    } catch (error) {
        log.error(' Error processing archive:', error);
        hideLoading();
        notify.error('Error processing archive: ' + error.message);
    }
}

// Load splat from a blob URL (used by archive loader)
async function loadSplatFromBlobUrl(blobUrl, fileName) {
    // Remove existing splat
    if (splatMesh) {
        scene.remove(splatMesh);
        if (splatMesh.dispose) splatMesh.dispose();
        splatMesh = null;
    }

    // Create SplatMesh using Spark
    splatMesh = new SplatMesh({ url: blobUrl });

    // Apply default rotation to correct upside-down orientation
    splatMesh.rotation.x = Math.PI;

    // Verify SplatMesh is a valid THREE.Object3D
    if (!(splatMesh instanceof THREE.Object3D)) {
        log.warn(' WARNING: SplatMesh is not an instance of THREE.Object3D!');
    }

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, TIMING.SPLAT_LOAD_DELAY));

    try {
        scene.add(splatMesh);
    } catch (addError) {
        log.error(' Error adding splatMesh to scene:', addError);
        throw addError;
    }

    state.splatLoaded = true;
    updateVisibility();

    // Update UI
    document.getElementById('splat-filename').textContent = fileName;
    document.getElementById('splat-vertices').textContent = 'Loaded';
}

// Load model from a blob URL (used by archive loader)
async function loadModelFromBlobUrl(blobUrl, fileName) {
    // Clear existing model
    while (modelGroup.children.length > 0) {
        const child = modelGroup.children[0];
        disposeObject(child);
        modelGroup.remove(child);
    }

    const extension = fileName.split('.').pop().toLowerCase();
    let loadedObject;

    if (extension === 'glb' || extension === 'gltf') {
        loadedObject = await loadGLTF(blobUrl);
    } else if (extension === 'obj') {
        loadedObject = await loadOBJFromUrlFn(blobUrl);
    }

    if (loadedObject) {
        modelGroup.add(loadedObject);
        if (sceneManager) sceneManager.applyShadowProperties(loadedObject);
        state.modelLoaded = true;
        updateModelOpacity();
        updateModelWireframe();
        updateVisibility();

        // Center model on grid if no splat is loaded
        // (Archives with alignment data will override this later)
        if (!state.splatLoaded) {
            centerModelOnGrid(modelGroup);
        }

        // Count faces and update UI
        const faceCount = computeMeshFaceCount(loadedObject);
        document.getElementById('model-filename').textContent = fileName;
        document.getElementById('model-faces').textContent = faceCount.toLocaleString();
    }
}

// Update archive metadata UI panel
function updateArchiveMetadataUI(manifest, archiveLoader) {
    const section = document.getElementById('archive-metadata-section');
    if (!section) return;

    section.style.display = '';

    const metadata = archiveLoader.getMetadata();

    // Update basic info
    document.getElementById('archive-version').textContent = metadata.version || '-';

    const packerText = metadata.packerVersion
        ? `${metadata.packer} v${metadata.packerVersion}`
        : metadata.packer;
    document.getElementById('archive-packer').textContent = packerText;

    document.getElementById('archive-created').textContent =
        metadata.createdAt ? new Date(metadata.createdAt).toLocaleString() : '-';

    // Populate entries list
    const entriesList = document.getElementById('archive-entries-list');
    entriesList.replaceChildren(); // Clear existing content safely
    const header = document.createElement('p');
    header.className = 'entries-header';
    header.textContent = 'Contents:';
    entriesList.appendChild(header);

    const entries = archiveLoader.getEntryList();
    for (const entry of entries) {
        const entryDiv = document.createElement('div');
        entryDiv.className = 'archive-entry';

        // Determine entry type for styling
        let entryType = 'other';
        if (entry.key.startsWith('scene_')) entryType = 'scene';
        else if (entry.key.startsWith('mesh_')) entryType = 'mesh';
        else if (entry.key.startsWith('thumbnail_')) entryType = 'thumbnail';

        const typeSpan = document.createElement('span');
        typeSpan.className = `archive-entry-type ${entryType}`;
        typeSpan.textContent = entryType;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'archive-entry-name';
        nameSpan.textContent = entry.fileName;

        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'archive-entry-details';
        detailsDiv.textContent = entry.createdBy ? `Created by: ${entry.createdBy}` : '';

        entryDiv.appendChild(typeSpan);
        entryDiv.appendChild(nameSpan);
        entryDiv.appendChild(detailsDiv);
        entriesList.appendChild(entryDiv);
    }
}

// Clear archive metadata when loading new files
function clearArchiveMetadata() {
    state.archiveLoaded = false;
    state.archiveManifest = null;
    state.archiveFileName = null;
    state.currentArchiveUrl = null;

    if (state.archiveLoader) {
        state.archiveLoader.dispose();
        state.archiveLoader = null;
    }

    // Delegate DOM cleanup to metadata-manager.js
    clearArchiveMetadataHandler();

    const section = document.getElementById('archive-metadata-section');
    if (section) section.style.display = 'none';

    // Clear source files from previous archive
    sourceFiles = [];
    updateSourceFilesUI();
}

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

// ==================== Export/Archive Creation Functions ====================

// Show export panel
function showExportPanel() {
    showExportPanelHandler();
    updateArchiveAssetCheckboxes();
}

// Update archive asset checkboxes based on loaded state
function updateArchiveAssetCheckboxes() {
    const assets = [
        { id: 'archive-include-splat', loaded: state.splatLoaded },
        { id: 'archive-include-model', loaded: state.modelLoaded },
        { id: 'archive-include-pointcloud', loaded: state.pointcloudLoaded },
        { id: 'archive-include-annotations', loaded: annotationSystem && annotationSystem.hasAnnotations() }
    ];
    assets.forEach(({ id, loaded }) => {
        const el = document.getElementById(id);
        if (el) {
            el.checked = !!loaded;
            el.disabled = !loaded;
        }
    });
}

// =============================================================================
// SCREENSHOT FUNCTIONS
// =============================================================================

async function captureScreenshotToList() {
    if (!renderer) {
        notify.error('Renderer not ready');
        return;
    }
    try {
        renderer.render(scene, camera);
        const blob = await captureScreenshot(renderer.domElement, { width: 1024, height: 1024 });
        if (!blob) {
            notify.error('Screenshot capture failed');
            return;
        }
        const dataUrl = await new Promise((resolve) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result);
            reader.readAsDataURL(blob);
        });
        state.screenshots.push({
            id: Date.now(),
            blob,
            dataUrl,
            timestamp: new Date().toISOString()
        });
        renderScreenshotsList();
        notify.success('Screenshot captured');
    } catch (e) {
        log.error('Screenshot capture error:', e);
        notify.error('Failed to capture screenshot');
    }
}

function showViewfinder() {
    if (!renderer) return;
    const overlay = document.getElementById('viewfinder-overlay');
    const frame = document.getElementById('viewfinder-frame');
    const controls = document.getElementById('viewfinder-controls');
    const dim = document.getElementById('viewfinder-dim');
    if (!overlay || !frame || !controls) return;

    const container = document.getElementById('viewer-container');
    const rect = container.getBoundingClientRect();
    const cw = rect.width;
    const ch = rect.height;
    const size = Math.min(cw, ch) * 0.8;
    const left = (cw - size) / 2;
    const top = (ch - size) / 2;

    // Hide the dim layer — the frame's box-shadow creates the dimming effect
    if (dim) dim.style.display = 'none';

    frame.style.left = left + 'px';
    frame.style.top = top + 'px';
    frame.style.width = size + 'px';
    frame.style.height = size + 'px';

    controls.style.top = (top + size + 15) + 'px';

    overlay.classList.remove('hidden');
}

function hideViewfinder() {
    const overlay = document.getElementById('viewfinder-overlay');
    if (overlay) overlay.classList.add('hidden');
}

async function captureManualPreview() {
    if (!renderer) return;
    try {
        renderer.render(scene, camera);
        const blob = await captureScreenshot(renderer.domElement, { width: 512, height: 512 });
        if (blob) {
            state.manualPreviewBlob = blob;
            hideViewfinder();
            const status = document.getElementById('manual-preview-status');
            if (status) status.style.display = '';
            notify.success('Manual preview captured');
        }
    } catch (e) {
        log.error('Manual preview capture error:', e);
        notify.error('Failed to capture preview');
    }
}

function renderScreenshotsList() {
    const list = document.getElementById('screenshots-list');
    if (!list) return;
    list.innerHTML = '';

    if (state.screenshots.length === 0) return;

    state.screenshots.forEach((shot) => {
        const item = document.createElement('div');
        item.className = 'screenshot-item';

        const img = document.createElement('img');
        img.src = shot.dataUrl;
        img.alt = 'Screenshot';
        item.appendChild(img);

        const del = document.createElement('button');
        del.className = 'screenshot-delete';
        del.textContent = '\u00D7';
        del.title = 'Remove screenshot';
        del.addEventListener('click', (e) => {
            e.stopPropagation();
            removeScreenshot(shot.id);
        });
        item.appendChild(del);

        list.appendChild(item);
    });
}

function removeScreenshot(id) {
    state.screenshots = state.screenshots.filter(s => s.id !== id);
    renderScreenshotsList();
}

// Download archive
async function downloadArchive() {
    log.info(' downloadArchive called');
    if (!archiveCreator) {
        log.error(' archiveCreator is null');
        return;
    }

    // Reset creator
    log.info(' Resetting archive creator');
    archiveCreator.reset();

    // Get metadata from metadata panel
    log.info(' Collecting metadata');
    const metadata = collectMetadata();
    log.info(' Metadata collected:', metadata);

    // Get export options
    const formatRadio = document.querySelector('input[name="export-format"]:checked');
    const format = formatRadio?.value || 'a3d';
    // Preview image and integrity hashes are always included
    const includePreview = true;
    const includeHashes = true;
    log.info(' Export options:', { format, includePreview, includeHashes });

    // Validate title is set
    if (!metadata.project.title) {
        log.info(' No title set, showing metadata panel');
        notify.warning('Please enter a project title in the metadata panel before exporting.');
        showMetadataPanel();
        return;
    }

    // Apply project info
    log.info(' Setting project info');
    archiveCreator.setProjectInfo(metadata.project);

    // Apply provenance
    log.info(' Setting provenance');
    archiveCreator.setProvenance(metadata.provenance);

    // Apply relationships
    log.info(' Setting relationships');
    archiveCreator.setRelationships(metadata.relationships);

    // Apply quality metrics
    log.info(' Setting quality metrics');
    archiveCreator.setQualityMetrics(metadata.qualityMetrics);

    // Apply archival record
    log.info(' Setting archival record');
    archiveCreator.setArchivalRecord(metadata.archivalRecord);

    // Apply material standard
    log.info(' Setting material standard');
    archiveCreator.setMaterialStandard(metadata.materialStandard);

    // Apply preservation
    log.info(' Setting preservation');
    archiveCreator.setPreservation(metadata.preservation);

    // Apply custom fields
    if (Object.keys(metadata.customFields).length > 0) {
        log.info(' Setting custom fields');
        archiveCreator.setCustomFields(metadata.customFields);
    }

    // Apply version history
    if (metadata.versionHistory && metadata.versionHistory.length > 0) {
        log.info(' Setting version history');
        archiveCreator.setVersionHistory(metadata.versionHistory);
    }

    // Read which assets the user wants to include
    const includeSplat = document.getElementById('archive-include-splat')?.checked;
    const includeModel = document.getElementById('archive-include-model')?.checked;
    const includePointcloud = document.getElementById('archive-include-pointcloud')?.checked;
    const includeAnnotations = document.getElementById('archive-include-annotations')?.checked;

    // Add splat if loaded and selected
    log.info(' Checking splat:', { currentSplatBlob: !!currentSplatBlob, splatLoaded: state.splatLoaded });
    if (includeSplat && currentSplatBlob && state.splatLoaded) {
        const fileName = document.getElementById('splat-filename')?.textContent || 'scene.ply';
        const position = splatMesh ? [splatMesh.position.x, splatMesh.position.y, splatMesh.position.z] : [0, 0, 0];
        const rotation = splatMesh ? [splatMesh.rotation.x, splatMesh.rotation.y, splatMesh.rotation.z] : [0, 0, 0];
        const scale = splatMesh ? splatMesh.scale.x : 1;

        log.info(' Adding scene:', { fileName, position, rotation, scale });
        archiveCreator.addScene(currentSplatBlob, fileName, {
            position, rotation, scale,
            created_by: metadata.splatMetadata.createdBy || 'unknown',
            created_by_version: metadata.splatMetadata.version || '',
            source_notes: metadata.splatMetadata.sourceNotes || '',
            role: metadata.splatMetadata.role || ''
        });
    }

    // Add mesh if loaded and selected
    log.info(' Checking mesh:', { currentMeshBlob: !!currentMeshBlob, modelLoaded: state.modelLoaded });
    // If viewing a proxy and full-res blob hasn't been extracted yet, extract now
    if (includeModel && state.modelLoaded && !currentMeshBlob && state.viewingProxy && state.archiveLoader) {
        const meshEntry = state.archiveLoader.getMeshEntry();
        if (meshEntry) {
            const fullData = await state.archiveLoader.extractFile(meshEntry.file_name);
            if (fullData) currentMeshBlob = fullData.blob;
        }
    }
    if (includeModel && currentMeshBlob && state.modelLoaded) {
        const fileName = document.getElementById('model-filename')?.textContent || 'mesh.glb';
        const position = modelGroup ? [modelGroup.position.x, modelGroup.position.y, modelGroup.position.z] : [0, 0, 0];
        const rotation = modelGroup ? [modelGroup.rotation.x, modelGroup.rotation.y, modelGroup.rotation.z] : [0, 0, 0];
        const scale = modelGroup ? modelGroup.scale.x : 1;

        log.info(' Adding mesh:', { fileName, position, rotation, scale });
        archiveCreator.addMesh(currentMeshBlob, fileName, {
            position, rotation, scale,
            created_by: metadata.meshMetadata.createdBy || 'unknown',
            created_by_version: metadata.meshMetadata.version || '',
            source_notes: metadata.meshMetadata.sourceNotes || '',
            role: metadata.meshMetadata.role || ''
        });
    }

    // Add display proxy mesh if available
    if (includeModel && currentProxyMeshBlob) {
        const proxyFileName = document.getElementById('proxy-mesh-filename')?.textContent || 'mesh_proxy.glb';
        const position = modelGroup ? [modelGroup.position.x, modelGroup.position.y, modelGroup.position.z] : [0, 0, 0];
        const rotation = modelGroup ? [modelGroup.rotation.x, modelGroup.rotation.y, modelGroup.rotation.z] : [0, 0, 0];
        const scale = modelGroup ? modelGroup.scale.x : 1;

        log.info(' Adding mesh proxy:', { proxyFileName });
        archiveCreator.addMeshProxy(currentProxyMeshBlob, proxyFileName, {
            position, rotation, scale,
            derived_from: 'mesh_0'
        });
    }

    // Add point cloud if loaded and selected
    log.info(' Checking pointcloud:', { currentPointcloudBlob: !!currentPointcloudBlob, pointcloudLoaded: state.pointcloudLoaded });
    if (includePointcloud && currentPointcloudBlob && state.pointcloudLoaded) {
        const fileName = document.getElementById('pointcloud-filename')?.textContent || 'pointcloud.e57';
        const position = pointcloudGroup ? [pointcloudGroup.position.x, pointcloudGroup.position.y, pointcloudGroup.position.z] : [0, 0, 0];
        const rotation = pointcloudGroup ? [pointcloudGroup.rotation.x, pointcloudGroup.rotation.y, pointcloudGroup.rotation.z] : [0, 0, 0];
        const scale = pointcloudGroup ? pointcloudGroup.scale.x : 1;

        log.info(' Adding pointcloud:', { fileName, position, rotation, scale });
        archiveCreator.addPointcloud(currentPointcloudBlob, fileName, {
            position, rotation, scale,
            created_by: metadata.pointcloudMetadata?.createdBy || 'unknown',
            created_by_version: metadata.pointcloudMetadata?.version || '',
            source_notes: metadata.pointcloudMetadata?.sourceNotes || '',
            role: metadata.pointcloudMetadata?.role || ''
        });
    }

    // Add annotations if selected
    if (includeAnnotations && annotationSystem && annotationSystem.hasAnnotations()) {
        log.info(' Adding annotations');
        archiveCreator.setAnnotations(annotationSystem.toJSON());
    }

    // Add embedded images
    if (state.imageAssets.size > 0) {
        log.info(` Adding ${state.imageAssets.size} embedded images`);
        for (const [path, asset] of state.imageAssets) {
            archiveCreator.addImage(asset.blob, path);
        }
    }

    // Add user-added source files (have blobs, not from archive)
    const sourceFilesWithBlobs = sourceFiles.filter(sf => sf.file && !sf.fromArchive);
    if (sourceFilesWithBlobs.length > 0) {
        const totalSourceSize = sourceFilesWithBlobs.reduce((sum, sf) => sum + sf.size, 0);
        if (totalSourceSize > 2 * 1024 * 1024 * 1024) {
            notify.warning(`Source files total ${formatFileSize(totalSourceSize)}. Very large archives may fail in the browser. Consider adding files to the ZIP after export using external tools.`);
        }
        log.info(` Adding ${sourceFilesWithBlobs.length} source files (${formatFileSize(totalSourceSize)})`);
        for (const sf of sourceFilesWithBlobs) {
            archiveCreator.addSourceFile(sf.file, sf.name, { category: sf.category });
        }
    }

    // Re-extract source files from the loaded archive (raw data retained for this purpose)
    if (state.archiveLoader && state.archiveLoader.hasSourceFiles()) {
        const archiveSourceEntries = state.archiveLoader.getSourceFileEntries();
        for (const { entry } of archiveSourceEntries) {
            try {
                const data = await state.archiveLoader.extractFile(entry.file_name);
                if (data) {
                    archiveCreator.addSourceFile(data.blob, entry.original_name || entry.file_name.split('/').pop(), {
                        category: entry.source_category || ''
                    });
                }
            } catch (e) {
                log.warn('Failed to re-extract source file:', entry.file_name, e.message);
            }
        }
    }

    // Set quality stats
    log.info(' Setting quality stats');
    archiveCreator.setQualityStats({
        splatCount: (includeSplat && state.splatLoaded) ? parseInt(document.getElementById('splat-vertices')?.textContent) || 0 : 0,
        meshPolys: (includeModel && state.modelLoaded) ? parseInt(document.getElementById('model-faces')?.textContent) || 0 : 0,
        meshVerts: (includeModel && state.modelLoaded) ? (state.meshVertexCount || 0) : 0,
        splatFileSize: (includeSplat && currentSplatBlob) ? currentSplatBlob.size : 0,
        meshFileSize: (includeModel && currentMeshBlob) ? currentMeshBlob.size : 0,
        pointcloudPoints: (includePointcloud && state.pointcloudLoaded) ? parseInt(document.getElementById('pointcloud-points')?.textContent?.replace(/,/g, '')) || 0 : 0,
        pointcloudFileSize: (includePointcloud && currentPointcloudBlob) ? currentPointcloudBlob.size : 0
    });

    // Add preview/thumbnail
    if (includePreview && renderer) {
        try {
            let previewBlob;
            if (state.manualPreviewBlob) {
                log.info(' Using manual preview');
                previewBlob = state.manualPreviewBlob;
            } else {
                log.info(' Auto-capturing preview screenshot');
                renderer.render(scene, camera);
                previewBlob = await captureScreenshot(renderer.domElement, { width: 512, height: 512 });
            }
            if (previewBlob) {
                log.info(' Preview captured, adding thumbnail');
                archiveCreator.addThumbnail(previewBlob, 'preview.jpg');
            }
        } catch (e) {
            log.warn(' Failed to capture preview:', e);
        }
    }

    // Add screenshots
    if (state.screenshots.length > 0) {
        log.info(` Adding ${state.screenshots.length} screenshot(s) to archive`);
        for (const screenshot of state.screenshots) {
            try {
                archiveCreator.addScreenshot(screenshot.blob, `screenshot_${screenshot.id}.jpg`);
            } catch (e) {
                log.warn(' Failed to add screenshot:', e);
            }
        }
    }

    // Validate
    log.info(' Validating archive');
    const validation = archiveCreator.validate();
    log.info(' Validation result:', validation);
    if (!validation.valid) {
        notify.error('Cannot create archive: ' + validation.errors.join('; '));
        return;
    }

    // Create and download with progress
    log.info(' Starting archive creation');
    showLoading('Creating archive...', true); // Show with progress bar
    try {
        log.info(' Calling archiveCreator.downloadArchive');
        await archiveCreator.downloadArchive(
            {
                filename: metadata.project.id || 'archive',
                format: format,
                includeHashes: includeHashes
            },
            (percent, stage) => {
                // Progress callback
                updateProgress(percent, stage);
            }
        );
        log.info(' Archive download complete');
        hideLoading();
        hideExportPanel();
    } catch (e) {
        hideLoading();
        log.error(' Error creating archive:', e);
        notify.error('Error creating archive: ' + e.message);
    }
}

// Download generic offline viewer (standalone HTML that opens any .a3d/.a3z)
async function downloadGenericViewer() {
    log.info(' downloadGenericViewer called');
    showLoading('Building offline viewer...', true);

    try {
        updateProgress(1, 'Loading viewer module...');
        const { fetchDependencies: fetchViewerDeps, generateGenericViewer } =
            await import('./modules/kiosk-viewer.js');

        updateProgress(5, 'Fetching viewer libraries...');
        const deps = await fetchViewerDeps((msg) => {
            updateProgress(15, msg);
        });

        updateProgress(90, 'Assembling viewer...');
        const html = generateGenericViewer(deps);

        updateProgress(95, 'Starting download...');
        const blob = new Blob([html], { type: 'text/html' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'archive-viewer.html';
        a.click();
        URL.revokeObjectURL(url);

        log.info(`[Viewer] Generic viewer exported (${(blob.size / 1024).toFixed(0)} KB)`);
        updateProgress(100, 'Complete');
        hideLoading();
        notify.success('Offline viewer downloaded: archive-viewer.html');

    } catch (e) {
        hideLoading();
        log.error(' Error creating generic viewer:', e);
        notify.error('Error creating viewer: ' + e.message);
    }
}

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

function exportMetadataManifest() {
    const metadata = collectMetadata();
    const manifest = {
        container_version: '1.0',
        packer: 'simple-splat-mesh-viewer',
        packer_version: '1.0.0',
        _creation_date: new Date().toISOString(),
        ...metadata
    };

    // Include annotations if present
    if (annotationSystem && annotationSystem.hasAnnotations()) {
        manifest.annotations = annotationSystem.toJSON();
    }

    const json = JSON.stringify(manifest, null, 2);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'manifest.json';
    a.click();
    URL.revokeObjectURL(url);
    notify.success('Manifest exported');
}

function importMetadataManifest() {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const manifest = JSON.parse(event.target.result);
                prefillMetadataFromArchive(manifest);

                // Load annotations if present in manifest
                if (manifest.annotations && Array.isArray(manifest.annotations) && manifest.annotations.length > 0) {
                    loadAnnotationsFromArchive(manifest.annotations);
                }

                populateMetadataDisplay();
                notify.success('Manifest imported');
            } catch (err) {
                log.error('Failed to parse manifest:', err);
                notify.error('Invalid manifest file: ' + err.message);
            }
        };
        reader.readAsText(file);
    });
    input.click();
}

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

    currentProxyMeshBlob = file;
    document.getElementById('proxy-mesh-filename').textContent = file.name;
    notify.info(`Display proxy "${file.name}" ready — will be included in archive exports.`);
}

// ==================== Source Files ====================

function handleSourceFilesInput(event) {
    const files = event.target.files;
    if (!files || files.length === 0) return;

    const category = document.getElementById('source-files-category')?.value || '';

    for (const file of files) {
        sourceFiles.push({ file, name: file.name, size: file.size, category, fromArchive: false });
    }

    updateSourceFilesUI();
    notify.info(`Added ${files.length} source file(s) for archival.`);

    // Reset input so the same files can be re-added if needed
    event.target.value = '';
}

function removeSourceFile(index) {
    sourceFiles.splice(index, 1);
    updateSourceFilesUI();
}

function updateSourceFilesUI() {
    const listEl = document.getElementById('source-files-list');
    const summaryEl = document.getElementById('source-files-summary');
    const countEl = document.getElementById('source-files-count');
    const sizeEl = document.getElementById('source-files-size');

    if (!listEl) return;

    listEl.innerHTML = '';

    sourceFiles.forEach((sf, i) => {
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

    const totalSize = sourceFiles.reduce((sum, sf) => sum + sf.size, 0);

    if (summaryEl) {
        summaryEl.style.display = sourceFiles.length > 0 ? '' : 'none';
    }
    if (countEl) countEl.textContent = sourceFiles.length;
    if (sizeEl) sizeEl.textContent = formatFileSize(totalSize);
}

async function handleLoadFullResMesh() {
    const archiveLoader = state.archiveLoader;
    if (!archiveLoader) {
        notify.error('No archive loaded');
        return;
    }

    showLoading('Loading full resolution mesh...');
    try {
        const result = await loadArchiveFullResMesh(archiveLoader, createFileHandlerDeps());
        if (result.loaded) {
            currentMeshBlob = result.blob;
            state.viewingProxy = false;
            document.getElementById('model-faces').textContent = (result.faceCount || 0).toLocaleString();
            // Hide proxy indicator and Load Full Res button
            document.getElementById('proxy-mesh-indicator')?.classList.add('hidden');
            const fullResBtn = document.getElementById('btn-load-full-res');
            if (fullResBtn) fullResBtn.style.display = 'none';
            updateModelOpacity();
            updateModelWireframe();
            updateVisibility();
            notify.success('Full resolution mesh loaded');
        } else {
            notify.error(result.error || 'Failed to load full resolution mesh');
        }
        hideLoading();
    } catch (error) {
        log.error('Error loading full resolution mesh:', error);
        hideLoading();
        notify.error('Error loading full resolution mesh: ' + error.message);
    }
}

function updateModelOpacity() { updateModelOpacityFn(modelGroup, state.modelOpacity); }

function updateModelWireframe() { updateModelWireframeFn(modelGroup, state.modelWireframe); }

function updateModelMatcap() { updateModelMatcapFn(modelGroup, state.modelMatcap, state.matcapStyle); }

function updateModelNormals() { updateModelNormalsFn(modelGroup, state.modelNormals); }

function saveAlignment() {
    const alignment = {
        version: 1,
        splat: splatMesh ? {
            position: splatMesh.position.toArray(),
            rotation: [splatMesh.rotation.x, splatMesh.rotation.y, splatMesh.rotation.z],
            scale: splatMesh.scale.x
        } : null,
        model: modelGroup ? {
            position: modelGroup.position.toArray(),
            rotation: [modelGroup.rotation.x, modelGroup.rotation.y, modelGroup.rotation.z],
            scale: modelGroup.scale.x
        } : null
    };

    const blob = new Blob([JSON.stringify(alignment, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'alignment.json';
    a.click();
    URL.revokeObjectURL(url);
}

// Apply alignment data to splat and model objects
function applyAlignmentData(data) {
    if (data.splat && splatMesh) {
        splatMesh.position.fromArray(data.splat.position);
        splatMesh.rotation.set(...data.splat.rotation);
        splatMesh.scale.setScalar(data.splat.scale);
    }

    if (data.model && modelGroup) {
        modelGroup.position.fromArray(data.model.position);
        modelGroup.rotation.set(...data.model.rotation);
        modelGroup.scale.setScalar(data.model.scale);
    }

    if (data.pointcloud && pointcloudGroup) {
        pointcloudGroup.position.fromArray(data.pointcloud.position);
        pointcloudGroup.rotation.set(...data.pointcloud.rotation);
        pointcloudGroup.scale.setScalar(data.pointcloud.scale);
    }

    updateTransformInputs();
    storeLastPositions();
}

function loadAlignment(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const alignment = JSON.parse(e.target.result);
            applyAlignmentData(alignment);
        } catch (error) {
            notify.error('Error loading alignment file: ' + error.message);
        }
    };
    reader.readAsText(file);

    // Reset input so same file can be loaded again
    event.target.value = '';
}

// Load alignment from a URL
async function loadAlignmentFromUrl(url) {
    try {
        log.info(' Loading alignment from URL:', url);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const alignment = await response.json();
        applyAlignmentData(alignment);
        log.info(' Alignment loaded successfully from URL');
        return true;
    } catch (error) {
        log.error(' Error loading alignment from URL:', error);
        return false;
    }
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

// Controls panel visibility
function toggleControlsPanel() {
    state.controlsVisible = !state.controlsVisible;
    applyControlsVisibility(state.controlsVisible);
}

function applyControlsVisibility(shouldShowOverride) {
    const controlsPanel = document.getElementById('controls-panel');
    if (!controlsPanel) return;

    const toggleBtn = document.getElementById('btn-toggle-controls');
    const shouldShow = shouldShowOverride !== undefined ? shouldShowOverride : state.controlsVisible;
    const mode = config.controlsMode || 'full';

    if (mode === 'none') {
        controlsPanel.style.display = 'none';
        if (toggleBtn) toggleBtn.style.display = 'none';
        return;
    }

    // Clear any inline display/visibility styles
    controlsPanel.style.display = '';
    controlsPanel.style.visibility = '';
    controlsPanel.style.opacity = '';

    if (shouldShow) {
        controlsPanel.classList.remove('panel-hidden', 'hidden');

        const targetWidth = (mode === 'minimal') ? '200px' : '280px';
        controlsPanel.style.width = targetWidth;
        controlsPanel.style.minWidth = targetWidth;
        controlsPanel.style.padding = '20px';
        controlsPanel.style.overflow = 'visible';
        controlsPanel.style.overflowY = 'auto';
        controlsPanel.style.borderLeftWidth = '1px';
        controlsPanel.style.pointerEvents = 'auto';

        if (toggleBtn) toggleBtn.classList.remove('controls-hidden');
    } else {
        controlsPanel.classList.add('panel-hidden');
        if (toggleBtn) toggleBtn.classList.add('controls-hidden');
    }

    setTimeout(() => {
        try { onWindowResize(); } catch (e) { /* ignore */ }
    }, 200);
}
function applyControlsMode() {
    applyControlsModeHandler(config.controlsMode || 'full');
}

// Ensure toolbar visibility is maintained (safeguard against race conditions)
function ensureToolbarVisibility() {
    // Only hide toolbar if explicitly set to false (not undefined)
    if (config.showToolbar === false) {
        return; // Toolbar intentionally hidden via URL parameter
    }

    const toolbar = document.getElementById('left-toolbar');
    if (!toolbar) {
        return;
    }

    // Force toolbar to be visible
    toolbar.style.display = 'flex';
    toolbar.style.visibility = 'visible';
    toolbar.style.zIndex = '10000';

    // Re-check after file loading completes (delayed checks)
    setTimeout(() => {
        const tb = document.getElementById('left-toolbar');
        if (tb && config.showToolbar !== false) {
            tb.style.display = 'flex';
            tb.style.visibility = 'visible';
            tb.style.zIndex = '10000';
        }
    }, 1000);

    setTimeout(() => {
        const tb = document.getElementById('left-toolbar');
        if (tb && config.showToolbar !== false) {
            tb.style.display = 'flex';
            tb.style.visibility = 'visible';
            tb.style.zIndex = '10000';
        }
    }, 3000);
}

// Apply viewer mode settings (toolbar visibility, sidebar state)
function applyViewerModeSettings() {
    // Apply toolbar visibility - only hide if explicitly set to false
    if (config.showToolbar === false) {
        const toolbar = document.getElementById('left-toolbar');
        if (toolbar) {
            toolbar.style.display = 'none';
            log.info('Toolbar hidden via URL parameter');
        }
    }

    // Apply sidebar state (after a short delay to ensure DOM is ready)
    if (config.sidebarMode && config.sidebarMode !== 'closed') {
        setTimeout(() => {
            const sidebar = document.getElementById('metadata-sidebar');
            if (sidebar) {
                sidebar.classList.remove('hidden');
                log.info('Metadata sidebar shown via URL parameter');

                // If view-only mode, hide the Edit tab
                if (config.sidebarMode === 'view') {
                    const editTab = document.querySelector('.sidebar-mode-tab[data-mode="edit"]');
                    if (editTab) {
                        editTab.style.display = 'none';
                        log.info('Edit tab hidden for view-only mode');
                    }

                    // Also hide the annotations tab if in pure view mode
                    const annotationsTab = document.querySelector('.sidebar-mode-tab[data-mode="annotations"]');
                    if (annotationsTab) {
                        annotationsTab.style.display = 'none';
                    }
                }

                // Activate View tab by default
                const viewTab = document.querySelector('.sidebar-mode-tab[data-mode="view"]');
                const viewContent = document.getElementById('sidebar-view');
                if (viewTab && viewContent) {
                    document.querySelectorAll('.sidebar-mode-tab').forEach(t => t.classList.remove('active'));
                    document.querySelectorAll('.sidebar-mode-content').forEach(c => c.classList.remove('active'));
                    viewTab.classList.add('active');
                    viewContent.classList.add('active');
                }
            }
        }, 100);
    }
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

async function loadSplatFromUrl(url) {
    showLoading('Downloading Gaussian Splat...', true);

    try {
        // Fetch the file as blob with progress tracking
        log.info(' Fetching splat from URL:', url);
        const blob = await fetchWithProgress(url, (received, total) => {
            const percent = Math.round((received / total) * 90); // 0-90% for download
            updateProgress(percent, `Downloading Gaussian Splat... ${formatFileSize(received)} / ${formatFileSize(total)}`);
        });
        currentSplatBlob = blob;
        log.info(' Splat blob stored, size:', blob.size);
        updateProgress(90, 'Processing Gaussian Splat...');

        // Pre-compute hash in background for faster export later
        if (archiveCreator) {
            archiveCreator.precomputeHash(blob).catch(e => {
                log.warn(' Background hash precompute failed:', e);
            });
        }

        // Create blob URL for loading
        const blobUrl = URL.createObjectURL(blob);

        // Remove existing splat
        if (splatMesh) {
            scene.remove(splatMesh);
            if (splatMesh.dispose) splatMesh.dispose();
            splatMesh = null;
        }

        // Create SplatMesh using Spark
        splatMesh = new SplatMesh({ url: blobUrl });

        // Apply default rotation to correct upside-down orientation
        // Many splat files use Z-up coordinate system; rotate to Y-up
        splatMesh.rotation.x = Math.PI; // 180 degrees on X-axis

        // Verify SplatMesh is a valid THREE.Object3D
        if (!(splatMesh instanceof THREE.Object3D)) {
            log.warn(' WARNING: SplatMesh is not an instance of THREE.Object3D!');
            log.warn(' This may indicate multiple THREE.js instances are loaded.');
        }

        // Wait a moment for initialization
        await new Promise(resolve => setTimeout(resolve, TIMING.SPLAT_LOAD_DELAY));

        try {
            scene.add(splatMesh);
        } catch (addError) {
            log.error(' Error adding splatMesh to scene:', addError);
            throw addError;
        }

        state.splatLoaded = true;
        state.currentSplatUrl = url;
        updateVisibility();
        updateTransformInputs();
        storeLastPositions();

        // Update UI
        const filename = url.split('/').pop() || 'URL';
        document.getElementById('splat-filename').textContent = filename;
        document.getElementById('splat-vertices').textContent = 'Loaded';

        hideLoading();
    } catch (error) {
        log.error('Error loading splat from URL:', error);
        hideLoading();
    }
}

async function loadModelFromUrl(url) {
    showLoading('Downloading 3D Model...', true);

    try {
        // Fetch the file as blob with progress tracking
        log.info(' Fetching model from URL:', url);
        const blob = await fetchWithProgress(url, (received, total) => {
            const percent = Math.round((received / total) * 90); // 0-90% for download
            updateProgress(percent, `Downloading 3D Model... ${formatFileSize(received)} / ${formatFileSize(total)}`);
        });
        currentMeshBlob = blob;
        log.info(' Mesh blob stored, size:', blob.size);
        updateProgress(90, 'Processing 3D Model...');

        // Pre-compute hash in background for faster export later
        if (archiveCreator) {
            archiveCreator.precomputeHash(blob).catch(e => {
                log.warn(' Background hash precompute failed:', e);
            });
        }

        // Create blob URL for loading
        const blobUrl = URL.createObjectURL(blob);

        // Clear existing model
        while (modelGroup.children.length > 0) {
            const child = modelGroup.children[0];
            disposeObject(child);
            modelGroup.remove(child);
        }

        const extension = url.split('.').pop().toLowerCase().split('?')[0];
        let loadedObject;

        if (extension === 'glb' || extension === 'gltf') {
            loadedObject = await loadGLTF(blobUrl);
        } else if (extension === 'obj') {
            loadedObject = await loadOBJFromUrlFn(blobUrl);
        }

        if (loadedObject) {
            modelGroup.add(loadedObject);
            if (sceneManager) sceneManager.applyShadowProperties(loadedObject);
            state.modelLoaded = true;
            state.currentModelUrl = url;
            updateModelOpacity();
            updateModelWireframe();
            updateVisibility();
            updateTransformInputs();
            storeLastPositions();

            // Center model on grid if no splat is loaded
            // (loadDefaultFiles will handle alignment if both are loaded)
            if (!state.splatLoaded) {
                centerModelOnGrid(modelGroup);
            }

            // Count faces and vertices using utilities
            const faceCount = computeMeshFaceCount(loadedObject);
            state.meshVertexCount = computeMeshVertexCount(loadedObject);

            // Update UI
            const filename = url.split('/').pop() || 'URL';
            document.getElementById('model-filename').textContent = filename;
            document.getElementById('model-faces').textContent = faceCount.toLocaleString();
        }

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
                currentPointcloudBlob = blob;
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
