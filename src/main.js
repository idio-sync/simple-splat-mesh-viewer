// ES Module imports (these are hoisted - execute first before any other code)
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { SplatMesh } from '@sparkjsdev/spark';
import { ArchiveLoader, isArchiveFile } from './modules/archive-loader.js';
import { AnnotationSystem } from './modules/annotation-system.js';
import { ArchiveCreator, captureScreenshot } from './modules/archive-creator.js';
import { CAMERA, TIMING } from './modules/constants.js';
import { Logger, notify, processMeshMaterials, computeMeshFaceCount, computeMeshVertexCount, disposeObject, parseMarkdown, fetchWithProgress } from './modules/utilities.js';
import { FlyControls } from './modules/fly-controls.js';
import { SceneManager } from './modules/scene-manager.js';
import {
    icpAlignObjects as icpAlignObjectsHandler,
    autoAlignObjects as autoAlignObjectsHandler,
    fitToView as fitToViewHandler,
    resetAlignment as resetAlignmentHandler,
    resetCamera as resetCameraHandler,
    centerModelOnGrid
} from './modules/alignment.js';
import {
    showLoading,
    hideLoading,
    updateProgress,
    addListener
} from './modules/ui-controller.js';
import {
    formatFileSize,
    switchEditTab,
    addCustomField,
    addProcessingSoftware,
    addRelatedObject,
    collectMetadata,
    setupLicenseField,
    hideMetadataSidebar
} from './modules/metadata-manager.js';
import {
    loadSplatFromFile as loadSplatFromFileHandler,
    loadSplatFromUrl as loadSplatFromUrlHandler,
    loadModelFromFile as loadModelFromFileHandler,
    loadModelFromUrl as loadModelFromUrlHandler
} from './modules/file-handlers.js';
import {
    initShareDialog,
    showShareDialog
} from './modules/share-dialog.js';

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

// Allowed external domains for URL loading (same as config.js)
// Add trusted CDN/API domains here
const ALLOWED_EXTERNAL_DOMAINS = [
    // 'trusted-cdn.example.com',
    // 'assets.mycompany.com',
];

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
    displayMode: config.initialViewMode || 'both', // 'splat', 'model', 'both', 'split'
    selectedObject: 'none', // 'splat', 'model', 'both', 'none'
    transformMode: 'translate', // 'translate', 'rotate', 'scale'
    splatLoaded: false,
    modelLoaded: false,
    modelOpacity: 1,
    modelWireframe: false,
    controlsVisible: config.showControls,
    currentSplatUrl: config.defaultSplatUrl || null,
    currentModelUrl: config.defaultModelUrl || null,
    // Archive state
    archiveLoaded: false,
    archiveManifest: null,
    archiveFileName: null,
    currentArchiveUrl: config.defaultArchiveUrl || null,
    archiveLoader: null
};

// Scene manager instance (handles scene, camera, renderer, controls, lighting)
let sceneManager = null;

// Three.js objects - Main view (references extracted from SceneManager for backward compatibility)
let scene, camera, renderer, controls, transformControls;
let flyControls = null;
let splatMesh = null;
let modelGroup = null;
let gridHelper = null;
let ambientLight, hemisphereLight, directionalLight1, directionalLight2;

// Annotation and archive creation
let annotationSystem = null;
let archiveCreator = null;

// Blob data for archive export (stored when loading files)
let currentSplatBlob = null;
let currentMeshBlob = null;
let currentPopupAnnotationId = null; // Track which annotation's popup is shown

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
        getSplatMesh: () => splatMesh,
        setSplatMesh: (mesh) => { splatMesh = mesh; },
        getModelGroup: () => modelGroup,
        state,
        archiveCreator,
        callbacks: {
            onSplatLoaded: (mesh, file) => {
                updateVisibility();
                updateTransformInputs();
                storeLastPositions();
                currentSplatBlob = file;
                document.getElementById('splat-vertices').textContent = 'Loaded';
                // Auto-align if model is already loaded
                if (state.modelLoaded) {
                    setTimeout(() => autoAlignObjects(), TIMING.AUTO_ALIGN_DELAY);
                }
                clearArchiveMetadata();
            },
            onModelLoaded: (object, file, faceCount) => {
                updateModelOpacity();
                updateModelWireframe();
                updateVisibility();
                updateTransformInputs();
                storeLastPositions();
                currentMeshBlob = file;
                document.getElementById('model-faces').textContent = (faceCount || 0).toLocaleString();
                // Auto-align if splat is already loaded, otherwise center on grid
                if (state.splatLoaded) {
                    setTimeout(() => autoAlignObjects(), TIMING.AUTO_ALIGN_DELAY);
                } else {
                    // Center model on grid when loaded standalone
                    setTimeout(() => centerModelOnGrid(modelGroup), TIMING.AUTO_ALIGN_DELAY);
                }
                clearArchiveMetadata();
            }
        }
    };
}

// Helper function to create dependencies object for alignment.js
function createAlignmentDeps() {
    return {
        splatMesh,
        modelGroup,
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

    // Initialize archive creator
    archiveCreator = new ArchiveCreator();

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
        controls.enabled = true;
        if (controlsRight) controlsRight.enabled = true;
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
        if (controlsRight) controlsRight.enabled = false;
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
    addListener('btn-both', 'click', () => setDisplayMode('both'));
    addListener('btn-split', 'click', () => setDisplayMode('split'));

    // File inputs
    addListener('splat-input', 'change', handleSplatFile);
    addListener('model-input', 'change', handleModelFile);
    addListener('archive-input', 'change', handleArchiveFile);
    addListener('btn-load-archive-url', 'click', handleLoadArchiveFromUrlPrompt);

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
        updateModelWireframe();
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

    // Alignment buttons
    addListener('btn-reset-alignment', 'click', resetAlignment);

    // Share button
    addListener('btn-share', 'click', copyShareLink);

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

    // Auto align button
    addListener('btn-auto-align', 'click', autoAlignObjects);

    // ICP align button
    addListener('btn-icp-align', 'click', icpAlignObjects);

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

    // Export/archive creation controls
    addListener('btn-export-archive', 'click', showExportPanel);
    addListener('btn-export-cancel', 'click', hideExportPanel);
    addListener('btn-export-download', 'click', downloadArchive);

    // Metadata panel controls
    addListener('btn-close-sidebar', 'click', hideMetadataPanel);
    addListener('btn-add-custom-field', 'click', addCustomField);
    setupMetadataTabs();
    setupLicenseField();

    // Metadata display toggle (toolbar button)
    addListener('btn-metadata', 'click', toggleMetadataDisplay);

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
        });
    });

    // Scene settings - Custom background color
    addListener('bg-color-picker', 'input', (e) => {
        setBackgroundColor(e.target.value);
        // Remove active from presets
        document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
    });

    // Close annotation popup when clicking outside
    document.addEventListener('click', (e) => {
        const popup = document.getElementById('annotation-info-popup');
        if (popup && !popup.classList.contains('hidden')) {
            // Check if click was outside popup and not on an annotation marker
            if (!popup.contains(e.target) && !e.target.closest('.annotation-marker')) {
                hideAnnotationPopup();
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
            hideAnnotationPopup();
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
    state.displayMode = mode;

    // Update button states
    ['splat', 'model', 'both', 'split'].forEach(m => {
        const btn = document.getElementById(`btn-${m}`);
        if (btn) btn.classList.toggle('active', m === mode);
    });

    // Handle split view
    const container = document.getElementById('viewer-container');
    const splitLabels = document.getElementById('split-labels');

    if (mode === 'split') {
        if (container) container.classList.add('split-view');
        if (canvasRight) canvasRight.classList.remove('hidden');
        if (splitLabels) splitLabels.classList.remove('hidden');
    } else {
        if (container) container.classList.remove('split-view');
        if (canvasRight) canvasRight.classList.add('hidden');
        if (splitLabels) splitLabels.classList.add('hidden');
    }

    // Use requestAnimationFrame to ensure CSS changes are applied before resize
    requestAnimationFrame(() => {
        onWindowResize();
    });

    updateVisibility();
}

// Toggle gridlines visibility
function toggleGridlines(show) {
    if (sceneManager) {
        sceneManager.toggleGrid(show);
        gridHelper = sceneManager.gridHelper; // Keep reference in sync
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
    const mode = state.displayMode;

    if (mode === 'split') {
        // In split mode, both are visible but rendered in separate views
        if (splatMesh) splatMesh.visible = true;
        if (modelGroup) modelGroup.visible = true;
    } else {
        const showSplat = mode === 'splat' || mode === 'both';
        const showModel = mode === 'model' || mode === 'both';

        if (splatMesh) {
            splatMesh.visible = showSplat;
        }

        if (modelGroup) {
            modelGroup.visible = showModel;
        }
    }
}

function updateTransformInputs() {
    // Helper to safely set input value
    const setInputValue = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.value = value;
    };
    const setTextContent = (id, value) => {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    };

    // Update splat inputs
    if (splatMesh) {
        setInputValue('splat-pos-x', splatMesh.position.x.toFixed(2));
        setInputValue('splat-pos-y', splatMesh.position.y.toFixed(2));
        setInputValue('splat-pos-z', splatMesh.position.z.toFixed(2));
        setInputValue('splat-rot-x', THREE.MathUtils.radToDeg(splatMesh.rotation.x).toFixed(1));
        setInputValue('splat-rot-y', THREE.MathUtils.radToDeg(splatMesh.rotation.y).toFixed(1));
        setInputValue('splat-rot-z', THREE.MathUtils.radToDeg(splatMesh.rotation.z).toFixed(1));
        setInputValue('splat-scale', splatMesh.scale.x);
        setTextContent('splat-scale-value', splatMesh.scale.x.toFixed(1));
    }

    // Update model inputs
    if (modelGroup) {
        setInputValue('model-pos-x', modelGroup.position.x.toFixed(2));
        setInputValue('model-pos-y', modelGroup.position.y.toFixed(2));
        setInputValue('model-pos-z', modelGroup.position.z.toFixed(2));
        setInputValue('model-rot-x', THREE.MathUtils.radToDeg(modelGroup.rotation.x).toFixed(1));
        setInputValue('model-rot-y', THREE.MathUtils.radToDeg(modelGroup.rotation.y).toFixed(1));
        setInputValue('model-rot-z', THREE.MathUtils.radToDeg(modelGroup.rotation.z).toFixed(1));
        setInputValue('model-scale', modelGroup.scale.x);
        setTextContent('model-scale-value', modelGroup.scale.x.toFixed(1));
    }
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

// Process loaded archive - extract and load splat/mesh
async function processArchive(archiveLoader, archiveName) {
    showLoading('Parsing manifest...');

    try {
        const manifest = await archiveLoader.parseManifest();
        log.info(' Archive manifest:', manifest);

        state.archiveLoader = archiveLoader;
        state.archiveManifest = manifest;
        state.archiveFileName = archiveName;
        state.archiveLoaded = true;

        // Prefill metadata panel from loaded archive
        prefillMetadataFromArchive(manifest);

        const contentInfo = archiveLoader.getContentInfo();
        const errors = [];
        let loadedSplat = false;
        let loadedMesh = false;

        // Load splat (scene_0) if present
        const sceneEntry = archiveLoader.getSceneEntry();
        if (sceneEntry && contentInfo.hasSplat) {
            try {
                showLoading('Loading splat from archive...');
                const splatData = await archiveLoader.extractFile(sceneEntry.file_name);
                if (splatData) {
                    await loadSplatFromBlobUrl(splatData.url, sceneEntry.file_name);
                    loadedSplat = true;

                    // Apply transform from entry parameters if present
                    const transform = archiveLoader.getEntryTransform(sceneEntry);
                    if (splatMesh && (transform.position.some(v => v !== 0) ||
                                      transform.rotation.some(v => v !== 0) ||
                                      transform.scale !== 1)) {
                        splatMesh.position.fromArray(transform.position);
                        splatMesh.rotation.set(...transform.rotation);
                        splatMesh.scale.setScalar(transform.scale);
                    }
                }
            } catch (e) {
                errors.push(`Failed to load splat: ${e.message}`);
                log.error(' Error loading splat from archive:', e);
            }
        }

        // Load mesh (mesh_0) if present
        const meshEntry = archiveLoader.getMeshEntry();
        if (meshEntry && contentInfo.hasMesh) {
            try {
                showLoading('Loading mesh from archive...');
                const meshData = await archiveLoader.extractFile(meshEntry.file_name);
                if (meshData) {
                    await loadModelFromBlobUrl(meshData.url, meshEntry.file_name);
                    loadedMesh = true;

                    // Apply transform from entry parameters if present
                    const transform = archiveLoader.getEntryTransform(meshEntry);
                    if (modelGroup && (transform.position.some(v => v !== 0) ||
                                       transform.rotation.some(v => v !== 0) ||
                                       transform.scale !== 1)) {
                        modelGroup.position.fromArray(transform.position);
                        modelGroup.rotation.set(...transform.rotation);
                        modelGroup.scale.setScalar(transform.scale);
                    }
                }
            } catch (e) {
                errors.push(`Failed to load mesh: ${e.message}`);
                log.error(' Error loading mesh from archive:', e);
            }
        }

        // Check for global alignment data
        const globalAlignment = archiveLoader.getGlobalAlignment();
        if (globalAlignment) {
            applyAlignmentData(globalAlignment);
        }

        // Update UI
        updateTransformInputs();
        storeLastPositions();
        updateArchiveMetadataUI(manifest, archiveLoader);

        // Load annotations from archive
        const annotations = archiveLoader.getAnnotations();
        if (annotations && annotations.length > 0) {
            loadAnnotationsFromArchive(annotations);
        }

        // Store blobs for potential export
        if (loadedSplat && sceneEntry) {
            const splatData = await archiveLoader.extractFile(sceneEntry.file_name);
            if (splatData) {
                currentSplatBlob = splatData.blob;
            }
        }
        if (loadedMesh && meshEntry) {
            const meshData = await archiveLoader.extractFile(meshEntry.file_name);
            if (meshData) {
                currentMeshBlob = meshData.blob;
            }
        }

        // Show warning if there were partial errors
        if (errors.length > 0 && (loadedSplat || loadedMesh)) {
            log.warn(' Archive loaded with warnings:', errors);
        }

        // Alert if no viewable content
        if (!loadedSplat && !loadedMesh) {
            hideLoading();
            notify.warning('Archive does not contain any viewable splat or mesh files.');
            return;
        }

        hideLoading();
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
        loadedObject = await loadGLTFFromBlobUrl(blobUrl);
    } else if (extension === 'obj') {
        loadedObject = await loadOBJFromBlobUrl(blobUrl);
    }

    if (loadedObject) {
        modelGroup.add(loadedObject);
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

// Load GLTF from blob URL
function loadGLTFFromBlobUrl(blobUrl) {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();

        loader.load(
            blobUrl,
            (gltf) => {
                // Process materials and normals for proper lighting
                processMeshMaterials(gltf.scene);
                resolve(gltf.scene);
            },
            undefined,
            (error) => {
                reject(error);
            }
        );
    });
}

// Load OBJ from blob URL
function loadOBJFromBlobUrl(blobUrl) {
    return new Promise((resolve, reject) => {
        const loader = new OBJLoader();

        loader.load(
            blobUrl,
            (object) => {
                // OBJ without MTL - use default material
                processMeshMaterials(object, { forceDefaultMaterial: true });
                resolve(object);
            },
            undefined,
            (error) => {
                reject(error);
            }
        );
    });
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

    const section = document.getElementById('archive-metadata-section');
    if (section) section.style.display = 'none';

    document.getElementById('archive-filename').textContent = 'No archive loaded';
}

// ==================== Annotation Functions ====================

// Called when user places an annotation (clicks on model in placement mode)
function onAnnotationPlaced(position, cameraState) {
    log.info(' Annotation placed at:', position);

    // Show annotation panel for details entry
    const panel = document.getElementById('annotation-panel');
    if (panel) panel.classList.remove('hidden');

    // Pre-fill position display
    const posDisplay = document.getElementById('anno-pos-display');
    if (posDisplay) {
        posDisplay.textContent = `${position.x.toFixed(2)}, ${position.y.toFixed(2)}, ${position.z.toFixed(2)}`;
    }

    // Generate auto-ID
    const count = annotationSystem ? annotationSystem.getCount() + 1 : 1;
    const idInput = document.getElementById('anno-id');
    if (idInput) idInput.value = `anno_${count}`;

    // Focus title input
    const titleInput = document.getElementById('anno-title');
    if (titleInput) titleInput.focus();
}

// Called when an annotation is selected
function onAnnotationSelected(annotation) {
    log.info(' Annotation selected:', annotation.id);

    // Update annotations list highlighting
    const items = document.querySelectorAll('.annotation-item');
    items.forEach(item => {
        item.classList.toggle('selected', item.dataset.annoId === annotation.id);
    });

    // Update annotation chips
    const chips = document.querySelectorAll('.annotation-chip');
    chips.forEach(chip => {
        chip.classList.toggle('active', chip.dataset.annoId === annotation.id);
    });

    // Show editor panel (in controls - legacy)
    const editor = document.getElementById('selected-annotation-editor');
    if (editor) {
        editor.classList.remove('hidden');

        const titleInput = document.getElementById('edit-anno-title');
        const bodyInput = document.getElementById('edit-anno-body');
        if (titleInput) titleInput.value = annotation.title || '';
        if (bodyInput) bodyInput.value = annotation.body || '';
    }

    // Update sidebar annotation editor
    showSidebarAnnotationEditor(annotation);

    // Update sidebar list selection
    const sidebarItems = document.querySelectorAll('#sidebar-annotations-list .annotation-item');
    sidebarItems.forEach(item => {
        item.classList.toggle('selected', item.dataset.annoId === annotation.id);
    });

    // Show annotation info popup near the marker
    showAnnotationPopup(annotation);
}

// Called when placement mode changes
function onPlacementModeChanged(active) {
    log.info(' Placement mode:', active);

    const indicator = document.getElementById('annotation-mode-indicator');
    const btn = document.getElementById('btn-annotate');

    if (indicator) indicator.classList.toggle('hidden', !active);
    if (btn) btn.classList.toggle('active', active);
}

// Toggle annotation placement mode
function toggleAnnotationMode() {
    log.info(' toggleAnnotationMode called, annotationSystem:', !!annotationSystem);
    if (annotationSystem) {
        annotationSystem.togglePlacementMode();
    } else {
        log.error(' annotationSystem is not initialized!');
    }
}

// Save the pending annotation
function saveAnnotation() {
    if (!annotationSystem) return;

    const id = document.getElementById('anno-id')?.value || '';
    const title = document.getElementById('anno-title')?.value || '';
    const body = document.getElementById('anno-body')?.value || '';

    const annotation = annotationSystem.confirmAnnotation(id, title, body);
    if (annotation) {
        log.info(' Annotation saved:', annotation);
        updateAnnotationsUI();
    }

    // Hide panel and clear inputs
    const panel = document.getElementById('annotation-panel');
    if (panel) panel.classList.add('hidden');

    document.getElementById('anno-id').value = '';
    document.getElementById('anno-title').value = '';
    document.getElementById('anno-body').value = '';

    // Disable placement mode after saving
    annotationSystem.disablePlacementMode();
}

// Cancel annotation placement
function cancelAnnotation() {
    if (annotationSystem) {
        annotationSystem.cancelAnnotation();
    }

    const panel = document.getElementById('annotation-panel');
    if (panel) panel.classList.add('hidden');

    document.getElementById('anno-id').value = '';
    document.getElementById('anno-title').value = '';
    document.getElementById('anno-body').value = '';
}

// Update camera for selected annotation
function updateSelectedAnnotationCamera() {
    if (!annotationSystem || !annotationSystem.selectedAnnotation) return;

    annotationSystem.updateAnnotationCamera(annotationSystem.selectedAnnotation.id);
    log.info(' Updated camera for annotation:', annotationSystem.selectedAnnotation.id);
}

// Delete selected annotation
function deleteSelectedAnnotation() {
    if (!annotationSystem || !annotationSystem.selectedAnnotation) return;

    const id = annotationSystem.selectedAnnotation.id;
    if (confirm(`Delete annotation "${annotationSystem.selectedAnnotation.title}"?`)) {
        annotationSystem.deleteAnnotation(id);
        updateAnnotationsUI();

        // Hide editor (legacy)
        const editor = document.getElementById('selected-annotation-editor');
        if (editor) editor.classList.add('hidden');

        // Hide sidebar editor
        const sidebarEditor = document.getElementById('sidebar-annotation-editor');
        if (sidebarEditor) sidebarEditor.classList.add('hidden');
    }
}

// Update annotations UI (list and bar)
function updateAnnotationsUI() {
    if (!annotationSystem) return;

    const annotations = annotationSystem.getAnnotations();
    const count = annotations.length;

    // Update count badge
    const badge = document.getElementById('annotation-count-badge');
    if (badge) {
        badge.textContent = count;
        badge.classList.toggle('hidden', count === 0);
    }

    // Update annotations list
    const list = document.getElementById('annotations-list');
    if (list) {
        list.replaceChildren(); // Clear safely without innerHTML

        if (count === 0) {
            const noAnno = document.createElement('p');
            noAnno.className = 'no-annotations';
            noAnno.textContent = 'No annotations yet. Click "Add Annotation" to create one.';
            list.appendChild(noAnno);
        } else {
            annotations.forEach((anno, index) => {
                const item = document.createElement('div');
                item.className = 'annotation-item';
                item.dataset.annoId = anno.id;

                const number = document.createElement('span');
                number.className = 'annotation-number';
                number.textContent = index + 1;

                const title = document.createElement('span');
                title.className = 'annotation-title';
                title.textContent = anno.title || 'Untitled';

                item.appendChild(number);
                item.appendChild(title);

                item.addEventListener('click', () => {
                    annotationSystem.goToAnnotation(anno.id);
                });

                list.appendChild(item);
            });
        }
    }

    // Update annotation bar
    const bar = document.getElementById('annotation-bar');
    const chips = document.getElementById('annotation-chips');
    if (bar && chips) {
        bar.classList.toggle('hidden', count === 0);
        chips.replaceChildren(); // Clear safely without innerHTML

        annotations.forEach((anno, index) => {
            const chip = document.createElement('button');
            chip.className = 'annotation-chip';
            chip.dataset.annoId = anno.id;
            chip.textContent = index + 1;
            chip.title = anno.title || 'Untitled';

            chip.addEventListener('click', () => {
                annotationSystem.goToAnnotation(anno.id);
            });

            chips.appendChild(chip);
        });
    }

    // Also update sidebar annotations list
    updateSidebarAnnotationsList();
}

// Update sidebar annotations list
function updateSidebarAnnotationsList() {
    if (!annotationSystem) return;

    const annotations = annotationSystem.getAnnotations();
    const list = document.getElementById('sidebar-annotations-list');
    const editor = document.getElementById('sidebar-annotation-editor');
    const selectedAnno = annotationSystem.selectedAnnotation;

    if (!list) return;

    list.replaceChildren(); // Clear safely without innerHTML

    if (annotations.length === 0) {
        const noAnno = document.createElement('p');
        noAnno.className = 'no-annotations';
        noAnno.textContent = 'No annotations yet. Click "Add Annotation" to place a new marker.';
        list.appendChild(noAnno);
        if (editor) editor.classList.add('hidden');
    } else {
        annotations.forEach((anno, index) => {
            const item = document.createElement('div');
            item.className = 'annotation-item';
            item.dataset.annoId = anno.id;

            if (selectedAnno && selectedAnno.id === anno.id) {
                item.classList.add('selected');
            }

            const number = document.createElement('span');
            number.className = 'annotation-number';
            number.textContent = index + 1;

            const title = document.createElement('span');
            title.className = 'annotation-title';
            title.textContent = anno.title || 'Untitled';

            item.appendChild(number);
            item.appendChild(title);

            item.addEventListener('click', () => {
                annotationSystem.goToAnnotation(anno.id);
                // Update selection state
                list.querySelectorAll('.annotation-item').forEach(el => el.classList.remove('selected'));
                item.classList.add('selected');
                // Show editor with selected annotation data
                showSidebarAnnotationEditor(anno);
            });

            list.appendChild(item);
        });

        // Show editor if there's a selection
        if (selectedAnno) {
            showSidebarAnnotationEditor(selectedAnno);
        } else if (editor) {
            editor.classList.add('hidden');
        }
    }
}

// Show sidebar annotation editor with annotation data
function showSidebarAnnotationEditor(annotation) {
    const editor = document.getElementById('sidebar-annotation-editor');
    const titleInput = document.getElementById('sidebar-edit-anno-title');
    const bodyInput = document.getElementById('sidebar-edit-anno-body');

    if (!editor) return;

    if (titleInput) titleInput.value = annotation.title || '';
    if (bodyInput) bodyInput.value = annotation.body || '';

    editor.classList.remove('hidden');
}

// Load annotations from archive
function loadAnnotationsFromArchive(annotations) {
    if (!annotationSystem || !annotations || !Array.isArray(annotations)) return;

    log.info(' Loading', annotations.length, 'annotations from archive');
    annotationSystem.setAnnotations(annotations);
    updateAnnotationsUI();
    updateSidebarAnnotationsList();
}

// ==================== Export/Archive Creation Functions ====================

// Show export panel
function showExportPanel() {
    log.info(' showExportPanel called');
    const panel = document.getElementById('export-panel');
    if (panel) {
        log.info(' export-panel found, removing hidden class');
        panel.classList.remove('hidden');
    }
}

// Hide export panel
function hideExportPanel() {
    const panel = document.getElementById('export-panel');
    if (panel) panel.classList.add('hidden');
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

    // Apply custom fields
    if (Object.keys(metadata.customFields).length > 0) {
        log.info(' Setting custom fields');
        archiveCreator.setCustomFields(metadata.customFields);
    }

    // Add splat if loaded
    log.info(' Checking splat:', { currentSplatBlob: !!currentSplatBlob, splatLoaded: state.splatLoaded });
    if (currentSplatBlob && state.splatLoaded) {
        const fileName = document.getElementById('splat-filename')?.textContent || 'scene.ply';
        const position = splatMesh ? [splatMesh.position.x, splatMesh.position.y, splatMesh.position.z] : [0, 0, 0];
        const rotation = splatMesh ? [splatMesh.rotation.x, splatMesh.rotation.y, splatMesh.rotation.z] : [0, 0, 0];
        const scale = splatMesh ? splatMesh.scale.x : 1;

        log.info(' Adding scene:', { fileName, position, rotation, scale });
        archiveCreator.addScene(currentSplatBlob, fileName, {
            position, rotation, scale,
            created_by: metadata.splatMetadata.createdBy || 'unknown',
            created_by_version: metadata.splatMetadata.version || '',
            source_notes: metadata.splatMetadata.sourceNotes || ''
        });
    }

    // Add mesh if loaded
    log.info(' Checking mesh:', { currentMeshBlob: !!currentMeshBlob, modelLoaded: state.modelLoaded });
    if (currentMeshBlob && state.modelLoaded) {
        const fileName = document.getElementById('model-filename')?.textContent || 'mesh.glb';
        const position = modelGroup ? [modelGroup.position.x, modelGroup.position.y, modelGroup.position.z] : [0, 0, 0];
        const rotation = modelGroup ? [modelGroup.rotation.x, modelGroup.rotation.y, modelGroup.rotation.z] : [0, 0, 0];
        const scale = modelGroup ? modelGroup.scale.x : 1;

        log.info(' Adding mesh:', { fileName, position, rotation, scale });
        archiveCreator.addMesh(currentMeshBlob, fileName, {
            position, rotation, scale,
            created_by: metadata.meshMetadata.createdBy || 'unknown',
            created_by_version: metadata.meshMetadata.version || '',
            source_notes: metadata.meshMetadata.sourceNotes || ''
        });
    }

    // Add annotations
    if (annotationSystem && annotationSystem.hasAnnotations()) {
        log.info(' Adding annotations');
        archiveCreator.setAnnotations(annotationSystem.toJSON());
    }

    // Set quality stats
    log.info(' Setting quality stats');
    archiveCreator.setQualityStats({
        splatCount: state.splatLoaded ? parseInt(document.getElementById('splat-vertices')?.textContent) || 0 : 0,
        meshPolys: state.modelLoaded ? parseInt(document.getElementById('model-faces')?.textContent) || 0 : 0,
        meshVerts: state.modelLoaded ? (state.meshVertexCount || 0) : 0,
        splatFileSize: currentSplatBlob?.size || 0,
        meshFileSize: currentMeshBlob?.size || 0
    });

    // Add preview/thumbnail
    if (includePreview && renderer) {
        log.info(' Capturing preview screenshot');
        try {
            // Force a render to ensure canvas has current content
            // WebGL canvases clear after each frame unless preserveDrawingBuffer is set
            renderer.render(scene, camera);

            const canvas = renderer.domElement;
            const previewBlob = await captureScreenshot(canvas, { width: 512, height: 512 });
            if (previewBlob) {
                log.info(' Preview captured, adding thumbnail');
                archiveCreator.addThumbnail(previewBlob, 'preview.jpg');
            }
        } catch (e) {
            log.warn(' Failed to capture preview:', e);
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

// ==================== Metadata Sidebar Functions ====================

// Show metadata sidebar
function showMetadataSidebar(mode = 'view') {
    const sidebar = document.getElementById('metadata-sidebar');
    if (!sidebar) return;

    sidebar.classList.remove('hidden');

    // Switch to the requested mode
    switchSidebarMode(mode);

    // Update displays
    if (mode === 'view') {
        populateMetadataDisplay();
    } else if (mode === 'edit') {
        updateMetadataStats();
        updateAssetStatus();
    } else if (mode === 'annotations') {
        updateSidebarAnnotationsList();
    }

    // Update toolbar button state
    const btn = document.getElementById('btn-metadata');
    if (btn) btn.classList.add('active');

    // Resize the 3D view after sidebar transition completes
    setTimeout(onWindowResize, 300);
}

// Switch sidebar mode (view/edit/annotations)
function switchSidebarMode(mode) {
    // Update tab buttons
    const tabs = document.querySelectorAll('.sidebar-mode-tab');
    tabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.mode === mode);
    });

    // Update content sections
    const contents = document.querySelectorAll('.sidebar-mode-content');
    contents.forEach(content => {
        content.classList.toggle('active', content.id === `sidebar-${mode}`);
    });

    // Refresh content for the selected mode
    if (mode === 'view') {
        populateMetadataDisplay();
    } else if (mode === 'annotations') {
        updateSidebarAnnotationsList();
    }
}

// Legacy function names for compatibility
function showMetadataPanel() {
    showMetadataSidebar('edit');
}

function hideMetadataPanel() {
    hideMetadataSidebar();
}

// Setup metadata tab switching (legacy - kept for compatibility)
function setupMetadataTabs() {
    const tabs = document.querySelectorAll('.metadata-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update active content
            const tabContents = document.querySelectorAll('.metadata-tab-content');
            tabContents.forEach(content => content.classList.remove('active'));

            const tabId = tab.dataset.tab;
            const targetContent = document.getElementById(`tab-${tabId}`);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });
}

// Setup metadata sidebar event handlers
function setupMetadataSidebar() {
    // Mode tabs (View/Edit/Annotations)
    const modeTabs = document.querySelectorAll('.sidebar-mode-tab');
    modeTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const mode = tab.dataset.mode;
            switchSidebarMode(mode);
        });
    });

    // Edit sub-tabs
    const editTabs = document.querySelectorAll('.edit-tab');
    editTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            switchEditTab(tabName);
        });
    });

    // Close button
    addListener('btn-close-sidebar', 'click', hideMetadataSidebar);

    // Sidebar Add Annotation button
    addListener('btn-sidebar-add-annotation', 'click', () => {
        hideMetadataSidebar();
        toggleAnnotationMode();
    });

    // Sidebar annotation editor buttons
    addListener('btn-sidebar-update-anno-camera', 'click', updateSelectedAnnotationCamera);
    addListener('btn-sidebar-delete-anno', 'click', deleteSelectedAnnotation);

    // Sidebar annotation title/body change handlers
    const annoTitleInput = document.getElementById('sidebar-edit-anno-title');
    const annoBodyInput = document.getElementById('sidebar-edit-anno-body');

    if (annoTitleInput) {
        annoTitleInput.addEventListener('change', () => {
            const selectedAnno = annotationSystem?.selectedAnnotation;
            if (selectedAnno) {
                annotationSystem.updateAnnotation(selectedAnno.id, {
                    title: annoTitleInput.value
                });
                updateAnnotationsUI();
                updateSidebarAnnotationsList();
            }
        });
    }

    if (annoBodyInput) {
        annoBodyInput.addEventListener('change', () => {
            const selectedAnno = annotationSystem?.selectedAnnotation;
            if (selectedAnno) {
                annotationSystem.updateAnnotation(selectedAnno.id, {
                    body: annoBodyInput.value
                });
            }
        });
    }

    // Dynamic list add buttons (Related Objects / Processing Software)
    const addSoftwareBtn = document.getElementById('btn-add-processing-software');
    if (addSoftwareBtn) {
        addSoftwareBtn.addEventListener('click', addProcessingSoftware);
    }

    const addRelatedBtn = document.getElementById('btn-add-related-object');
    if (addRelatedBtn) {
        addRelatedBtn.addEventListener('click', addRelatedObject);
    }
}

// Update quality stats display in metadata panel
function updateMetadataStats() {
    // Splat count
    const splatCountEl = document.getElementById('meta-splat-count');
    if (splatCountEl) {
        splatCountEl.textContent = state.splatLoaded
            ? (document.getElementById('splat-vertices')?.textContent || '-')
            : '-';
    }

    // Mesh polygons and vertices
    const meshPolysEl = document.getElementById('meta-mesh-polys');
    const meshVertsEl = document.getElementById('meta-mesh-verts');
    if (meshPolysEl) {
        meshPolysEl.textContent = state.modelLoaded
            ? (document.getElementById('model-faces')?.textContent || '-')
            : '-';
    }
    if (meshVertsEl) {
        meshVertsEl.textContent = state.modelLoaded
            ? (state.meshVertexCount || '-')
            : '-';
    }

    // Annotation count
    const annoCountEl = document.getElementById('meta-anno-count');
    if (annoCountEl && annotationSystem) {
        annoCountEl.textContent = annotationSystem.getCount().toString();
    }

    // File sizes
    const splatSizeEl = document.getElementById('meta-splat-size');
    const meshSizeEl = document.getElementById('meta-mesh-size');
    const archiveSizeEl = document.getElementById('meta-archive-size');

    if (splatSizeEl && currentSplatBlob) {
        splatSizeEl.textContent = formatFileSize(currentSplatBlob.size);
    } else if (splatSizeEl) {
        splatSizeEl.textContent = '-';
    }

    if (meshSizeEl && currentMeshBlob) {
        meshSizeEl.textContent = formatFileSize(currentMeshBlob.size);
    } else if (meshSizeEl) {
        meshSizeEl.textContent = '-';
    }

    if (archiveSizeEl) {
        let totalSize = 0;
        if (currentSplatBlob) totalSize += currentSplatBlob.size;
        if (currentMeshBlob) totalSize += currentMeshBlob.size;
        archiveSizeEl.textContent = totalSize > 0 ? '~' + formatFileSize(totalSize) : '-';
    }
}

// Update asset status in metadata panel
function updateAssetStatus() {
    // Splat asset
    const splatStatus = document.getElementById('splat-asset-status');
    const splatFields = document.getElementById('splat-asset-fields');
    if (splatStatus) {
        if (state.splatLoaded) {
            const fileName = document.getElementById('splat-filename')?.textContent || 'Scene loaded';
            splatStatus.textContent = fileName;
            splatStatus.classList.add('loaded');
            if (splatFields) splatFields.classList.remove('hidden');
        } else {
            splatStatus.textContent = 'No splat loaded';
            splatStatus.classList.remove('loaded');
            if (splatFields) splatFields.classList.add('hidden');
        }
    }

    // Mesh asset
    const meshStatus = document.getElementById('mesh-asset-status');
    const meshFields = document.getElementById('mesh-asset-fields');
    if (meshStatus) {
        if (state.modelLoaded) {
            const fileName = document.getElementById('model-filename')?.textContent || 'Mesh loaded';
            meshStatus.textContent = fileName;
            meshStatus.classList.add('loaded');
            if (meshFields) meshFields.classList.remove('hidden');
        } else {
            meshStatus.textContent = 'No mesh loaded';
            meshStatus.classList.remove('loaded');
            if (meshFields) meshFields.classList.add('hidden');
        }
    }
}

// Prefill metadata panel from archive manifest
function prefillMetadataFromArchive(manifest) {
    if (!manifest) return;

    // Project info
    if (manifest.project) {
        if (manifest.project.title) {
            document.getElementById('meta-title').value = manifest.project.title;
        }
        if (manifest.project.id) {
            document.getElementById('meta-id').value = manifest.project.id;
        }
        if (manifest.project.description) {
            document.getElementById('meta-description').value = manifest.project.description;
        }
        if (manifest.project.license) {
            const licenseSelect = document.getElementById('meta-license');
            const standardLicenses = ['CC0', 'CC-BY 4.0', 'CC-BY-SA 4.0', 'CC-BY-NC 4.0', 'MIT', 'All Rights Reserved'];
            if (standardLicenses.includes(manifest.project.license)) {
                licenseSelect.value = manifest.project.license;
            } else {
                licenseSelect.value = 'custom';
                document.getElementById('custom-license-field').classList.remove('hidden');
                document.getElementById('meta-custom-license').value = manifest.project.license;
            }
        }
    }

    // Provenance
    if (manifest.provenance) {
        if (manifest.provenance.capture_date) {
            document.getElementById('meta-capture-date').value = manifest.provenance.capture_date;
        }
        if (manifest.provenance.capture_device) {
            document.getElementById('meta-capture-device').value = manifest.provenance.capture_device;
        }
        if (manifest.provenance.operator) {
            document.getElementById('meta-operator').value = manifest.provenance.operator;
        }
        if (manifest.provenance.location) {
            document.getElementById('meta-location').value = manifest.provenance.location;
        }
        if (manifest.provenance.convention_hints) {
            const hints = Array.isArray(manifest.provenance.convention_hints)
                ? manifest.provenance.convention_hints.join(', ')
                : manifest.provenance.convention_hints;
            document.getElementById('meta-conventions').value = hints;
        }
    }

    // Asset metadata from data_entries
    if (manifest.data_entries) {
        // Find scene entry
        const sceneKey = Object.keys(manifest.data_entries).find(k => k.startsWith('scene_'));
        if (sceneKey) {
            const scene = manifest.data_entries[sceneKey];
            if (scene.created_by) {
                document.getElementById('meta-splat-created-by').value = scene.created_by;
            }
            if (scene._created_by_version) {
                document.getElementById('meta-splat-version').value = scene._created_by_version;
            }
            if (scene._source_notes) {
                document.getElementById('meta-splat-notes').value = scene._source_notes;
            }
        }

        // Find mesh entry
        const meshKey = Object.keys(manifest.data_entries).find(k => k.startsWith('mesh_'));
        if (meshKey) {
            const mesh = manifest.data_entries[meshKey];
            if (mesh.created_by) {
                document.getElementById('meta-mesh-created-by').value = mesh.created_by;
            }
            if (mesh._created_by_version) {
                document.getElementById('meta-mesh-version').value = mesh._created_by_version;
            }
            if (mesh._source_notes) {
                document.getElementById('meta-mesh-notes').value = mesh._source_notes;
            }
        }
    }

    // Custom fields from _meta
    if (manifest._meta?.custom_fields) {
        const container = document.getElementById('custom-fields-list');
        container.replaceChildren(); // Clear safely without innerHTML
        for (const [key, value] of Object.entries(manifest._meta.custom_fields)) {
            addCustomField();
            const rows = container.querySelectorAll('.custom-field-row');
            const lastRow = rows[rows.length - 1];
            lastRow.querySelector('.custom-field-key').value = key;
            lastRow.querySelector('.custom-field-value').value = value;
        }
    }
}

// ==================== Museum-Style Metadata Display ====================

// Toggle metadata display visibility
function toggleMetadataDisplay() {
    const sidebar = document.getElementById('metadata-sidebar');
    if (!sidebar) return;

    if (sidebar.classList.contains('hidden')) {
        showMetadataDisplay();
    } else {
        hideMetadataDisplay();
    }
}

// Show museum-style metadata display (view mode in sidebar)
function showMetadataDisplay() {
    showMetadataSidebar('view');
}

// Hide museum-style metadata display
function hideMetadataDisplay() {
    hideMetadataSidebar();
}

// Populate the museum-style metadata display
function populateMetadataDisplay() {
    // Get metadata from form or archive
    const metadata = collectMetadata();

    // Track if sections have content
    let hasDetails = false;
    let hasStats = false;

    // Title - always show
    const titleEl = document.getElementById('display-title');
    if (titleEl) {
        titleEl.textContent = metadata.project.title || 'Untitled';
    }

    // Description - hide if empty, render as markdown
    const descEl = document.getElementById('display-description');
    if (descEl) {
        if (metadata.project.description) {
            descEl.innerHTML = parseMarkdown(metadata.project.description);
            descEl.style.display = '';
        } else {
            descEl.style.display = 'none';
        }
    }

    // Creator/Operator
    const creatorRow = document.getElementById('display-creator-row');
    const creatorEl = document.getElementById('display-creator');
    if (creatorRow && creatorEl) {
        if (metadata.provenance.operator) {
            creatorEl.textContent = metadata.provenance.operator;
            creatorRow.style.display = '';
            hasDetails = true;
        } else {
            creatorRow.style.display = 'none';
        }
    }

    // Capture Date
    const dateRow = document.getElementById('display-date-row');
    const dateEl = document.getElementById('display-date');
    if (dateRow && dateEl) {
        if (metadata.provenance.captureDate) {
            // Format date nicely
            const date = new Date(metadata.provenance.captureDate);
            dateEl.textContent = date.toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric'
            });
            dateRow.style.display = '';
            hasDetails = true;
        } else {
            dateRow.style.display = 'none';
        }
    }

    // Location
    const locationRow = document.getElementById('display-location-row');
    const locationEl = document.getElementById('display-location');
    if (locationRow && locationEl) {
        if (metadata.provenance.location) {
            locationEl.textContent = metadata.provenance.location;
            locationRow.style.display = '';
            hasDetails = true;
        } else {
            locationRow.style.display = 'none';
        }
    }

    // Device
    const deviceRow = document.getElementById('display-device-row');
    const deviceEl = document.getElementById('display-device');
    if (deviceRow && deviceEl) {
        if (metadata.provenance.captureDevice) {
            deviceEl.textContent = metadata.provenance.captureDevice;
            deviceRow.style.display = '';
            hasDetails = true;
        } else {
            deviceRow.style.display = 'none';
        }
    }

    // Hide the details section and divider if no details
    const detailsSection = document.querySelector('#sidebar-view .display-details');
    const divider = document.querySelector('#sidebar-view .display-divider');
    if (detailsSection) {
        detailsSection.style.display = hasDetails ? '' : 'none';
    }
    if (divider) {
        divider.style.display = hasDetails ? '' : 'none';
    }

    // License - hide if not set
    const licenseRow = document.getElementById('display-license-row');
    const licenseEl = document.getElementById('display-license');
    if (licenseRow && licenseEl) {
        const license = metadata.project.license;
        if (license && license !== 'custom' && license !== 'CC0') {
            // Show non-default licenses
            licenseEl.textContent = license;
            licenseRow.style.display = '';
        } else if (license === 'custom') {
            const customLicense = document.getElementById('meta-custom-license')?.value;
            if (customLicense) {
                licenseEl.textContent = customLicense;
                licenseRow.style.display = '';
            } else {
                licenseRow.style.display = 'none';
            }
        } else {
            // Hide CC0 (default) or empty
            licenseRow.style.display = 'none';
        }
    }

    // Stats - Splat count
    const splatStat = document.getElementById('display-splat-stat');
    const splatCountEl = document.getElementById('display-splat-count');
    if (splatStat && splatCountEl) {
        if (state.splatLoaded) {
            const count = document.getElementById('splat-vertices')?.textContent || '-';
            splatCountEl.textContent = count;
            splatStat.style.display = '';
            hasStats = true;
        } else {
            splatStat.style.display = 'none';
        }
    }

    // Stats - Mesh polygons
    const meshStat = document.getElementById('display-mesh-stat');
    const meshCountEl = document.getElementById('display-mesh-count');
    if (meshStat && meshCountEl) {
        if (state.modelLoaded) {
            const count = document.getElementById('model-faces')?.textContent || '-';
            meshCountEl.textContent = count;
            meshStat.style.display = '';
            hasStats = true;
        } else {
            meshStat.style.display = 'none';
        }
    }

    // Stats - Annotation count
    const annoStat = document.getElementById('display-anno-stat');
    const annoCountEl = document.getElementById('display-anno-count');
    if (annoStat && annoCountEl && annotationSystem) {
        const count = annotationSystem.getCount();
        if (count > 0) {
            annoCountEl.textContent = count.toString();
            annoStat.style.display = '';
            hasStats = true;
        } else {
            annoStat.style.display = 'none';
        }
    }

    // Hide the stats section if nothing to show
    const statsSection = document.getElementById('display-stats');
    if (statsSection) {
        statsSection.style.display = hasStats ? '' : 'none';
    }
}

// ==================== Annotation Info Popup ====================

// Show annotation popup near the selected marker
function showAnnotationPopup(annotation) {
    const popup = document.getElementById('annotation-info-popup');
    if (!popup) return;

    // Find the marker element
    const marker = document.querySelector(`.annotation-marker[data-annotation-id="${annotation.id}"]`);
    if (!marker) return;

    // Track which annotation is shown
    currentPopupAnnotationId = annotation.id;

    // Get annotation number from marker
    const number = marker.textContent;

    // Populate popup
    const numberEl = popup.querySelector('.annotation-info-number');
    const titleEl = popup.querySelector('.annotation-info-title');
    const bodyEl = popup.querySelector('.annotation-info-body');

    if (numberEl) numberEl.textContent = number;
    if (titleEl) titleEl.textContent = annotation.title || 'Untitled';
    if (bodyEl) bodyEl.innerHTML = parseMarkdown(annotation.body || '');

    // Position popup near the marker
    updateAnnotationPopupPosition();

    popup.classList.remove('hidden');
}

// Update annotation popup position to follow the marker
function updateAnnotationPopupPosition() {
    if (!currentPopupAnnotationId) return;

    const popup = document.getElementById('annotation-info-popup');
    if (!popup || popup.classList.contains('hidden')) return;

    const marker = document.querySelector(`.annotation-marker[data-annotation-id="${currentPopupAnnotationId}"]`);
    if (!marker) return;

    // Hide popup if marker is hidden (behind camera)
    if (marker.style.display === 'none') {
        popup.style.visibility = 'hidden';
        return;
    }
    popup.style.visibility = 'visible';

    const markerRect = marker.getBoundingClientRect();
    const popupWidth = 320;
    const padding = 15;

    // Try to position to the right of the marker
    let left = markerRect.right + padding;
    let top = markerRect.top - 10;

    // If it would go off the right edge, position to the left instead
    if (left + popupWidth > window.innerWidth - padding) {
        left = markerRect.left - popupWidth - padding;
    }

    // Keep it on screen vertically
    if (top < padding) top = padding;
    if (top + 200 > window.innerHeight) {
        top = window.innerHeight - 200 - padding;
    }

    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
}

// Hide annotation popup
function hideAnnotationPopup() {
    const popup = document.getElementById('annotation-info-popup');
    if (popup) popup.classList.add('hidden');
    currentPopupAnnotationId = null;
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

// loadGLTF, loadOBJ, and loadOBJWithoutMaterials moved to file-handlers.js

function updateModelOpacity() {
    if (modelGroup) {
        modelGroup.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    mat.transparent = state.modelOpacity < 1;
                    mat.opacity = state.modelOpacity;
                    mat.needsUpdate = true;
                });
            }
        });
    }
}

function updateModelWireframe() {
    if (modelGroup) {
        modelGroup.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    mat.wireframe = state.modelWireframe;
                    mat.needsUpdate = true;
                });
            }
        });
    }
}

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
        displayMode: state.displayMode,
        splatTransform: null,
        modelTransform: null
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
    const controlsPanel = document.getElementById('controls-panel');
    if (!controlsPanel) {
        log.error(' controls-panel not found!');
        return;
    }

    // Check hidden state via class (reliable with width-collapse approach)
    const isCurrentlyHidden = controlsPanel.classList.contains('panel-hidden');
    const shouldShow = isCurrentlyHidden;

    // Update state
    state.controlsVisible = shouldShow;

    // Apply visibility via class toggle
    applyControlsVisibilityDirect(controlsPanel, shouldShow);
}

function applyControlsVisibilityDirect(controlsPanel, shouldShow) {
    const toggleBtn = document.getElementById('btn-toggle-controls');

    // DIAGNOSTIC: Log state before changes
    log.debug('[DIAG] === applyControlsVisibilityDirect ===');
    log.debug('[DIAG] shouldShow:', shouldShow);
    log.debug('[DIAG] BEFORE - classList:', controlsPanel.className);
    log.debug('[DIAG] BEFORE - inline style:', controlsPanel.style.cssText);
    const beforeComputed = window.getComputedStyle(controlsPanel);
    log.debug('[DIAG] BEFORE - computed width:', beforeComputed.width);
    log.debug('[DIAG] BEFORE - computed minWidth:', beforeComputed.minWidth);
    log.debug('[DIAG] BEFORE - computed padding:', beforeComputed.padding);

    // Check controls mode
    let mode = 'full';
    try {
        mode = config.controlsMode || 'full';
    } catch (e) {
        log.warn(' Could not read config.controlsMode:', e);
    }
    log.debug('[DIAG] mode:', mode);

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
        log.debug('[DIAG] Attempting to SHOW panel...');

        // Remove hidden class
        controlsPanel.classList.remove('panel-hidden', 'hidden');
        log.debug('[DIAG] After classList.remove - className:', controlsPanel.className);

        // Force explicit inline styles to override any CSS issues
        const targetWidth = (mode === 'minimal') ? '200px' : '280px';
        controlsPanel.style.width = targetWidth;
        controlsPanel.style.minWidth = targetWidth;
        controlsPanel.style.padding = '20px';
        controlsPanel.style.overflow = 'visible';
        controlsPanel.style.overflowY = 'auto';
        controlsPanel.style.borderLeftWidth = '1px';
        controlsPanel.style.pointerEvents = 'auto';
        log.debug('[DIAG] After setting inline styles - style.cssText:', controlsPanel.style.cssText);

        if (toggleBtn) toggleBtn.classList.remove('controls-hidden');
    } else {
        log.debug('[DIAG] Attempting to HIDE panel...');
        controlsPanel.classList.add('panel-hidden');
        log.debug('[DIAG] After classList.add - className:', controlsPanel.className);

        if (toggleBtn) toggleBtn.classList.add('controls-hidden');
    }

    // DIAGNOSTIC: Log state after changes (immediate)
    log.debug('[DIAG] AFTER (immediate) - classList:', controlsPanel.className);
    log.debug('[DIAG] AFTER (immediate) - inline style:', controlsPanel.style.cssText);
    const afterComputed = window.getComputedStyle(controlsPanel);
    log.debug('[DIAG] AFTER (immediate) - computed width:', afterComputed.width);
    log.debug('[DIAG] AFTER (immediate) - computed minWidth:', afterComputed.minWidth);
    log.debug('[DIAG] AFTER (immediate) - computed padding:', afterComputed.padding);
    log.debug('[DIAG] AFTER (immediate) - offsetWidth:', controlsPanel.offsetWidth);

    // Update annotation bar position based on panel visibility
    const annotationBar = document.getElementById('annotation-bar');
    if (annotationBar) {
        annotationBar.style.left = shouldShow ? '280px' : '0';
    }

    // DIAGNOSTIC: Check again after a delay (after potential transition)
    setTimeout(() => {
        const delayedComputed = window.getComputedStyle(controlsPanel);
        log.debug('[DIAG] AFTER (200ms) - classList:', controlsPanel.className);
        log.debug('[DIAG] AFTER (200ms) - computed width:', delayedComputed.width);
        log.debug('[DIAG] AFTER (200ms) - offsetWidth:', controlsPanel.offsetWidth);
        log.debug('[DIAG] === END ===');

        try {
            if (typeof onWindowResize === 'function') onWindowResize();
        } catch (e) { /* ignore */ }
    }, 200);
}

// Legacy function for initial setup - calls the new direct function
function applyControlsVisibility() {
    const controlsPanel = document.getElementById('controls-panel');
    if (!controlsPanel) return;

    let shouldShow = true;
    try {
        shouldShow = state.controlsVisible;
    } catch (e) {
        log.warn(' Could not read state.controlsVisible:', e);
    }

    applyControlsVisibilityDirect(controlsPanel, shouldShow);
}
// Apply controls mode (full, minimal, none)
function applyControlsMode() {
    const mode = config.controlsMode || 'full';
    const controlsPanel = document.getElementById('controls-panel');
    const toggleBtn = document.getElementById('btn-toggle-controls');

    if (mode === 'none') {
        // Hide everything
        if (controlsPanel) controlsPanel.style.display = 'none';
        if (toggleBtn) toggleBtn.style.display = 'none';
        return;
    }

    if (mode === 'minimal') {
        // Show only display mode toggle
        // Hide all other sections
        const sections = document.querySelectorAll('#controls-panel .control-section');
        sections.forEach((section, index) => {
            // Keep only the first section (Display Mode) and hide the rest
            if (index === 0) {
                section.style.display = '';
            } else {
                section.style.display = 'none';
            }
        });

        // Hide the main title
        const title = document.querySelector('#controls-panel h2');
        if (title) title.style.display = 'none';

        // Make the panel narrower for minimal mode
        if (controlsPanel) controlsPanel.style.width = '200px';
    }
    // 'full' mode shows everything (default)
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

    // Handle alignment priority:
    // 1. Inline alignment params (highest priority - encoded in URL)
    // 2. Alignment URL file
    // 3. Auto-align (fallback)
    if (state.splatLoaded || state.modelLoaded) {
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
                log.info(' Alignment URL failed, falling back to auto-align...');
                autoAlignObjects();
            }
        } else if (state.splatLoaded && state.modelLoaded) {
            // No alignment provided, run auto-align
            log.info('Both files loaded from URL, running auto-align...');
            autoAlignObjects();
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
            loadedObject = await loadGLTFFromUrl(blobUrl);
        } else if (extension === 'obj') {
            loadedObject = await loadOBJFromUrl(blobUrl);
        }

        if (loadedObject) {
            modelGroup.add(loadedObject);
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

function loadGLTFFromUrl(url) {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        loader.load(
            url,
            (gltf) => {
                // Process materials and normals for proper lighting
                processMeshMaterials(gltf.scene);
                resolve(gltf.scene);
            },
            undefined,
            (error) => reject(error)
        );
    });
}

function loadOBJFromUrl(url) {
    return new Promise((resolve, reject) => {
        const loader = new OBJLoader();
        loader.load(
            url,
            (object) => {
                // OBJ without MTL - use default material
                processMeshMaterials(object, { forceDefaultMaterial: true, preserveTextures: true });
                resolve(object);
            },
            undefined,
            (error) => reject(error)
        );
    });
}

// ============================================================
// Alignment functions - wrappers for alignment.js module
// ============================================================

// ICP alignment function - wrapper for alignment.js
async function icpAlignObjects() {
    await icpAlignObjectsHandler(createAlignmentDeps());
}

// Setup collapsible sections
function setupCollapsibles() {
    const collapsibleHeaders = document.querySelectorAll('.collapsible-header');
    collapsibleHeaders.forEach(header => {
        header.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const section = header.closest('.control-section.collapsible');
            if (section) {
                section.classList.toggle('collapsed');
                // Update icon
                const icon = header.querySelector('.collapse-icon');
                if (icon) {
                    icon.textContent = section.classList.contains('collapsed') ? '▶' : '▼';
                }
            }
        });
    });
}

// Auto align objects - wrapper for alignment.js
function autoAlignObjects() {
    autoAlignObjectsHandler(createAlignmentDeps());
}

// FPS counter
let frameCount = 0;
let lastTime = performance.now();

function updateFPS() {
    frameCount++;
    const currentTime = performance.now();
    if (currentTime - lastTime >= 1000) {
        document.getElementById('fps-counter').textContent = frameCount;
        frameCount = 0;
        lastTime = currentTime;
    }
}

// Animation loop
let animationErrorCount = 0;
const MAX_ANIMATION_ERRORS = 10;

function animate() {
    requestAnimationFrame(animate);

    try {
        // Update active camera controls
        if (flyControls && flyControls.enabled) {
            flyControls.update();
        } else {
            controls.update();
            controlsRight.update();
        }

        if (state.displayMode === 'split') {
            // Split view - render splat on left, model on right
            const splatVisible = splatMesh ? splatMesh.visible : false;
            const modelVisible = modelGroup ? modelGroup.visible : false;

            // Left view - splat only
            if (splatMesh) splatMesh.visible = true;
            if (modelGroup) modelGroup.visible = false;
            renderer.render(scene, camera);

            // Right view - model only
            if (splatMesh) splatMesh.visible = false;
            if (modelGroup) modelGroup.visible = true;
            rendererRight.render(scene, camera);

            // Restore visibility
            if (splatMesh) splatMesh.visible = splatVisible;
            if (modelGroup) modelGroup.visible = modelVisible;
        } else {
            // Normal view
            renderer.render(scene, camera);
        }

        // Update annotation marker positions
        if (annotationSystem) {
            annotationSystem.updateMarkerPositions();
        }

        // Update annotation popup position to follow marker
        updateAnnotationPopupPosition();

        updateFPS();

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
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        log.info(' DOMContentLoaded fired, calling init()');
        try {
            init();
        } catch (e) {
            log.error(' Init error:', e);
            log.error(' Stack:', e.stack);
        }
    });
} else {
    log.info(' DOM already ready, calling init()');
    try {
        init();
    } catch (e) {
        log.error(' Init error:', e);
        log.error(' Stack:', e.stack);
    }
}
