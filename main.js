// ES Module imports (these are hoisted - execute first before any other code)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { SplatMesh } from '@sparkjsdev/spark';
import { ArchiveLoader, isArchiveFile } from './archive-loader.js';
import { AnnotationSystem } from './annotation-system.js';
import { ArchiveCreator, captureScreenshot } from './archive-creator.js';
import { CAMERA, ORBIT_CONTROLS, RENDERER, LIGHTING, GRID, COLORS, TIMING, MATERIAL } from './constants.js';
import { Logger, notify, processMeshMaterials, computeMeshFaceCount, computeMeshVertexCount, disposeObject } from './utilities.js';
import {
    KDTree,
    extractSplatPositions,
    extractMeshVertices,
    computeCentroid,
    computeOptimalRotation,
    computeSplatBoundsFromPositions
} from './alignment.js';
import {
    showLoading,
    hideLoading,
    updateProgress,
    addListener
} from './ui-controller.js';
import {
    formatFileSize,
    switchEditTab,
    addCustomField,
    collectMetadata,
    setupLicenseField,
    hideMetadataSidebar
} from './metadata-manager.js';

// Create logger for this module
const log = Logger.getLogger('main.js');

// Mark module as loaded (for pre-module error detection)
window.moduleLoaded = true;
log.info('Module loaded successfully, THREE:', !!THREE, 'SplatMesh:', !!SplatMesh);

// Expose THREE globally for debugging and potential library compatibility
window.THREE = THREE;
log.debug('THREE.REVISION:', THREE.REVISION);

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

// Three.js objects - Main view
let scene, camera, renderer, controls, transformControls;
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

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(COLORS.SCENE_BACKGROUND);

    // Camera
    camera = new THREE.PerspectiveCamera(
        CAMERA.FOV,
        canvas.clientWidth / canvas.clientHeight,
        CAMERA.NEAR,
        CAMERA.FAR
    );
    camera.position.set(CAMERA.INITIAL_POSITION.x, CAMERA.INITIAL_POSITION.y, CAMERA.INITIAL_POSITION.z);

    // Renderer - Main (left in split mode)
    renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true
    });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, RENDERER.MAX_PIXEL_RATIO));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Renderer - Right (for split view)
    rendererRight = new THREE.WebGLRenderer({
        canvas: canvasRight,
        antialias: true
    });
    rendererRight.setPixelRatio(Math.min(window.devicePixelRatio, RENDERER.MAX_PIXEL_RATIO));
    rendererRight.outputColorSpace = THREE.SRGBColorSpace;

    // Orbit Controls - Main
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = ORBIT_CONTROLS.DAMPING_FACTOR;
    controls.screenSpacePanning = true;
    controls.minDistance = ORBIT_CONTROLS.MIN_DISTANCE;
    controls.maxDistance = ORBIT_CONTROLS.MAX_DISTANCE;

    // Orbit Controls - Right (synced with main)
    // Note: Both controls share the same camera, so they naturally stay in sync
    // We just need both to be able to receive input
    controlsRight = new OrbitControls(camera, rendererRight.domElement);
    controlsRight.enableDamping = true;
    controlsRight.dampingFactor = ORBIT_CONTROLS.DAMPING_FACTOR;
    controlsRight.screenSpacePanning = true;
    controlsRight.minDistance = ORBIT_CONTROLS.MIN_DISTANCE;
    controlsRight.maxDistance = ORBIT_CONTROLS.MAX_DISTANCE;

    // Transform Controls
    transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.addEventListener('dragging-changed', (event) => {
        controls.enabled = !event.value;
        controlsRight.enabled = !event.value;
    });
    transformControls.addEventListener('objectChange', () => {
        updateTransformInputs();
        // If both selected, sync the other object
        if (state.selectedObject === 'both') {
            syncBothObjects();
        }
    });

    // Add TransformControls to scene with instance check
    log.info(' TransformControls instanceof THREE.Object3D:', transformControls instanceof THREE.Object3D);
    if (!(transformControls instanceof THREE.Object3D)) {
        log.error(' WARNING: TransformControls is NOT an instance of THREE.Object3D!');
        log.error(' This indicates THREE.js is loaded multiple times (import map issue).');
        log.error(' TransformControls constructor:', transformControls.constructor?.name);
        log.error(' THREE.Object3D:', THREE.Object3D?.name);
        // Try to add anyway - it may work partially
    }
    try {
        scene.add(transformControls);
        log.info(' TransformControls added to scene successfully');
    } catch (tcError) {
        log.error(' Failed to add TransformControls to scene:', tcError);
        log.error(' Transform gizmos will not be visible, but app should still work');
    }

    // Lighting - Enhanced for better mesh visibility
    ambientLight = new THREE.AmbientLight(LIGHTING.AMBIENT.COLOR, LIGHTING.AMBIENT.INTENSITY);
    scene.add(ambientLight);

    // Hemisphere light for better color graduation
    hemisphereLight = new THREE.HemisphereLight(
        LIGHTING.HEMISPHERE.SKY_COLOR,
        LIGHTING.HEMISPHERE.GROUND_COLOR,
        LIGHTING.HEMISPHERE.INTENSITY
    );
    scene.add(hemisphereLight);

    directionalLight1 = new THREE.DirectionalLight(LIGHTING.DIRECTIONAL_1.COLOR, LIGHTING.DIRECTIONAL_1.INTENSITY);
    directionalLight1.position.set(
        LIGHTING.DIRECTIONAL_1.POSITION.x,
        LIGHTING.DIRECTIONAL_1.POSITION.y,
        LIGHTING.DIRECTIONAL_1.POSITION.z
    );
    scene.add(directionalLight1);

    directionalLight2 = new THREE.DirectionalLight(LIGHTING.DIRECTIONAL_2.COLOR, LIGHTING.DIRECTIONAL_2.INTENSITY);
    directionalLight2.position.set(
        LIGHTING.DIRECTIONAL_2.POSITION.x,
        LIGHTING.DIRECTIONAL_2.POSITION.y,
        LIGHTING.DIRECTIONAL_2.POSITION.z
    );
    scene.add(directionalLight2);

    // Grid helper - not shown by default, controlled by toggle
    // gridHelper is declared globally and managed by toggleGridlines()

    // Model group
    modelGroup = new THREE.Group();
    modelGroup.name = 'modelGroup';
    scene.add(modelGroup);

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

    // Apply initial controls visibility and mode
    applyControlsVisibility();
    applyControlsMode();

    // Set initial display mode from config
    setDisplayMode(state.displayMode);

    // Load default files if configured
    loadDefaultFiles();

    // Start render loop
    animate();

    log.info(' init() completed successfully');
}

function onWindowResize() {
    const container = document.getElementById('viewer-container');

    if (state.displayMode === 'split') {
        const halfWidth = container.clientWidth / 2;
        camera.aspect = halfWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(halfWidth, container.clientHeight);
        rendererRight.setSize(halfWidth, container.clientHeight);
    } else {
        camera.aspect = container.clientWidth / container.clientHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    }
}

function onKeyDown(event) {
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

    // Export/archive creation controls
    const exportBtn = addListener('btn-export-archive', 'click', showExportPanel);
    const openExportBtn = addListener('btn-open-export', 'click', showExportPanel);
    log.info(' Export buttons attached:', { exportBtn, openExportBtn });
    addListener('btn-export-cancel', 'click', hideExportPanel);
    addListener('btn-export-download', 'click', downloadArchive);

    // Metadata panel controls
    addListener('btn-open-metadata', 'click', showMetadataPanel);
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

        if (e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey) {
            toggleAnnotationMode();
        } else if (e.key.toLowerCase() === 'm' && !e.ctrlKey && !e.metaKey) {
            toggleMetadataDisplay();
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
    if (show && !gridHelper) {
        // Create grid using constants
        gridHelper = new THREE.GridHelper(GRID.SIZE, GRID.DIVISIONS, GRID.COLOR_PRIMARY, GRID.COLOR_SECONDARY);
        gridHelper.position.y = GRID.Y_OFFSET; // Slightly below origin to avoid z-fighting
        scene.add(gridHelper);
    } else if (!show && gridHelper) {
        scene.remove(gridHelper);
        gridHelper.dispose();
        gridHelper = null;
    }
}

// Set background color
function setBackgroundColor(hexColor) {
    const color = new THREE.Color(hexColor);
    scene.background = color;

    // Also update the CSS variable for UI elements that might need it
    document.documentElement.style.setProperty('--scene-bg-color', hexColor);
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
    const selectedAnno = annotationSystem.getSelectedAnnotation();

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
            const selectedAnno = annotationSystem?.getSelectedAnnotation();
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
            const selectedAnno = annotationSystem?.getSelectedAnnotation();
            if (selectedAnno) {
                annotationSystem.updateAnnotation(selectedAnno.id, {
                    body: annoBodyInput.value
                });
            }
        });
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

    // Description - hide if empty
    const descEl = document.getElementById('display-description');
    if (descEl) {
        if (metadata.project.description) {
            descEl.textContent = metadata.project.description;
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
    if (bodyEl) bodyEl.textContent = annotation.body || '';

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
        // Remove existing splat
        if (splatMesh) {
            scene.remove(splatMesh);
            if (splatMesh.dispose) splatMesh.dispose();
            splatMesh = null;
        }

        // Create object URL for the file
        const fileUrl = URL.createObjectURL(file);

        // Create SplatMesh using Spark
        splatMesh = new SplatMesh({ url: fileUrl });

        // Apply default rotation to correct upside-down orientation
        splatMesh.rotation.x = Math.PI;

        // Verify SplatMesh is a valid THREE.Object3D (detect instance conflicts)
        if (!(splatMesh instanceof THREE.Object3D)) {
            log.warn(' WARNING: SplatMesh is not an instance of THREE.Object3D!');
            log.warn(' This may indicate multiple THREE.js instances are loaded.');
            log.warn(' SplatMesh constructor:', splatMesh.constructor?.name);
            // Try to proceed anyway - some operations may still work
        }

        // Brief delay to allow SplatMesh initialization
        // Note: Spark library doesn't expose a ready callback, so we use a short delay
        await new Promise(resolve => setTimeout(resolve, TIMING.SPLAT_LOAD_DELAY));

        try {
            scene.add(splatMesh);
        } catch (addError) {
            log.error(' Error adding splatMesh to scene:', addError);
            log.error(' This is likely due to THREE.js instance mismatch with Spark library.');
            throw addError;
        }

        // Clean up URL after a delay
        setTimeout(() => URL.revokeObjectURL(fileUrl), TIMING.BLOB_REVOKE_DELAY);

        state.splatLoaded = true;
        state.currentSplatUrl = null; // Local files cannot be shared
        updateVisibility();
        updateTransformInputs();
        storeLastPositions();

        // Store blob for archive export
        currentSplatBlob = file;

        // Pre-compute hash in background for faster export later
        if (archiveCreator) {
            archiveCreator.precomputeHash(file).catch(e => {
                log.warn(' Background hash precompute failed:', e);
            });
        }

        // Update info - Spark doesn't expose count directly, show file name
        document.getElementById('splat-vertices').textContent = 'Loaded';

        // Auto-align if model is already loaded (wait for splat to fully initialize)
        if (state.modelLoaded) {
            setTimeout(() => autoAlignObjects(), TIMING.AUTO_ALIGN_DELAY);
        }

        // Clear existing archive state since we're loading individual files
        clearArchiveMetadata();

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
        // Clear existing model
        while (modelGroup.children.length > 0) {
            const child = modelGroup.children[0];
            disposeObject(child);
            modelGroup.remove(child);
        }

        const extension = mainFile.name.split('.').pop().toLowerCase();
        let loadedObject;

        if (extension === 'glb' || extension === 'gltf') {
            loadedObject = await loadGLTF(mainFile);
        } else if (extension === 'obj') {
            let mtlFile = null;
            for (const f of files) {
                if (f.name.toLowerCase().endsWith('.mtl')) {
                    mtlFile = f;
                    break;
                }
            }
            loadedObject = await loadOBJ(mainFile, mtlFile);
        }

        if (loadedObject) {
            modelGroup.add(loadedObject);
            state.modelLoaded = true;
            state.currentModelUrl = null; // Local files cannot be shared
            updateModelOpacity();
            updateModelWireframe();
            updateVisibility();
            updateTransformInputs();
            storeLastPositions();

            // Store blob for archive export
            currentMeshBlob = mainFile;

            // Pre-compute hash in background for faster export later
            if (archiveCreator) {
                archiveCreator.precomputeHash(mainFile).catch(e => {
                    log.warn(' Background hash precompute failed:', e);
                });
            }

            // Count faces and update UI
            const faceCount = computeMeshFaceCount(loadedObject);
            document.getElementById('model-faces').textContent = faceCount.toLocaleString();

            // Auto-align if splat is already loaded
            if (state.splatLoaded) {
                setTimeout(() => autoAlignObjects(), TIMING.AUTO_ALIGN_DELAY);
            }

            // Clear existing archive state since we're loading individual files
            clearArchiveMetadata();
        }

        hideLoading();
    } catch (error) {
        log.error('Error loading model:', error);
        hideLoading();
        notify.error('Error loading model: ' + error.message);
    }
}

// disposeObject is now imported from utilities.js

function loadGLTF(file) {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        const url = URL.createObjectURL(file);

        loader.load(
            url,
            (gltf) => {
                URL.revokeObjectURL(url);
                // Process materials and normals for proper lighting
                processMeshMaterials(gltf.scene);
                resolve(gltf.scene);
            },
            undefined,
            (error) => {
                URL.revokeObjectURL(url);
                reject(error);
            }
        );
    });
}

function loadOBJ(objFile, mtlFile) {
    const objUrl = URL.createObjectURL(objFile);

    return new Promise((resolve, reject) => {
        const objLoader = new OBJLoader();

        if (mtlFile) {
            const mtlUrl = URL.createObjectURL(mtlFile);
            const mtlLoader = new MTLLoader();

            mtlLoader.load(
                mtlUrl,
                (materials) => {
                    materials.preload();
                    objLoader.setMaterials(materials);

                    objLoader.load(
                        objUrl,
                        (object) => {
                            URL.revokeObjectURL(objUrl);
                            URL.revokeObjectURL(mtlUrl);
                            // OBJ with MTL - upgrade materials to standard for consistent lighting
                            processMeshMaterials(object, { forceDefaultMaterial: true, preserveTextures: true });
                            resolve(object);
                        },
                        undefined,
                        (error) => {
                            URL.revokeObjectURL(objUrl);
                            URL.revokeObjectURL(mtlUrl);
                            reject(error);
                        }
                    );
                },
                undefined,
                () => {
                    URL.revokeObjectURL(mtlUrl);
                    loadOBJWithoutMaterials(objLoader, objUrl, resolve, reject);
                }
            );
        } else {
            loadOBJWithoutMaterials(objLoader, objUrl, resolve, reject);
        }
    });
}

function loadOBJWithoutMaterials(loader, url, resolve, reject) {
    loader.load(
        url,
        (object) => {
            URL.revokeObjectURL(url);
            // OBJ without MTL - use default material
            processMeshMaterials(object, { forceDefaultMaterial: true });
            resolve(object);
        },
        undefined,
        (error) => {
            URL.revokeObjectURL(url);
            reject(error);
        }
    );
}

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

// Copy a shareable link to the clipboard
function copyShareLink() {
    // Check if at least one URL is present
    if (!state.currentArchiveUrl && !state.currentSplatUrl && !state.currentModelUrl) {
        notify.warning('Cannot share: No files loaded from URL. Share links only work for files loaded via URL, not local uploads.');
        return;
    }

    // Construct the base URL
    const baseUrl = window.location.origin + window.location.pathname;
    const params = new URLSearchParams();

    // If archive URL is present, use it (takes priority)
    if (state.currentArchiveUrl) {
        params.set('archive', state.currentArchiveUrl);
        // Archive includes alignment data, so we don't need to add splat/model/alignment params
        // Just add display mode and controls
        params.set('mode', state.displayMode);

        if (!config.showControls) {
            params.set('controls', 'none');
        } else if (config.controlsMode && config.controlsMode !== 'full') {
            params.set('controls', config.controlsMode);
        }

        const shareUrl = baseUrl + '?' + params.toString();

        navigator.clipboard.writeText(shareUrl).then(() => {
            notify.success('Share link copied to clipboard!');
        }).catch((err) => {
            log.error(' Failed to copy share link:', err);
            notify.info('Share link: ' + shareUrl, { duration: 10000 });
        });
        return;
    }

    // Add splat URL if present
    if (state.currentSplatUrl) {
        params.set('splat', state.currentSplatUrl);
    }

    // Add model URL if present
    if (state.currentModelUrl) {
        params.set('model', state.currentModelUrl);
    }

    // Add display mode
    params.set('mode', state.displayMode);

    // Add controls mode
    if (!config.showControls) {
        params.set('controls', 'none');
    } else if (config.controlsMode && config.controlsMode !== 'full') {
        params.set('controls', config.controlsMode);
    }

    // Add inline alignment data (position, rotation, scale)
    // Helper to format vec3 as comma-separated string with reasonable precision
    const formatVec3 = (arr) => arr.map(n => parseFloat(n.toFixed(4))).join(',');

    if (splatMesh) {
        const pos = splatMesh.position;
        const rot = splatMesh.rotation;
        const scale = splatMesh.scale.x;

        // Only add non-default values to keep URL shorter
        if (pos.x !== 0 || pos.y !== 0 || pos.z !== 0) {
            params.set('sp', formatVec3([pos.x, pos.y, pos.z]));
        }
        if (rot.x !== 0 || rot.y !== 0 || rot.z !== 0) {
            params.set('sr', formatVec3([rot.x, rot.y, rot.z]));
        }
        if (scale !== 1) {
            params.set('ss', parseFloat(scale.toFixed(4)));
        }
    }

    if (modelGroup) {
        const pos = modelGroup.position;
        const rot = modelGroup.rotation;
        const scale = modelGroup.scale.x;

        if (pos.x !== 0 || pos.y !== 0 || pos.z !== 0) {
            params.set('mp', formatVec3([pos.x, pos.y, pos.z]));
        }
        if (rot.x !== 0 || rot.y !== 0 || rot.z !== 0) {
            params.set('mr', formatVec3([rot.x, rot.y, rot.z]));
        }
        if (scale !== 1) {
            params.set('ms', parseFloat(scale.toFixed(4)));
        }
    }

    // Build the full URL
    const shareUrl = baseUrl + '?' + params.toString();

    // Copy to clipboard
    navigator.clipboard.writeText(shareUrl).then(() => {
        notify.success('Share link copied to clipboard!');
    }).catch((err) => {
        log.error(' Failed to copy share link:', err);
        // Fallback: show the URL in a notification
        notify.info('Share link: ' + shareUrl, { duration: 10000 });
    });
}

function resetAlignment() {
    if (splatMesh) {
        splatMesh.position.set(0, 0, 0);
        splatMesh.rotation.set(0, 0, 0);
        splatMesh.scale.setScalar(1);
    }

    if (modelGroup) {
        modelGroup.position.set(0, 0, 0);
        modelGroup.rotation.set(0, 0, 0);
        modelGroup.scale.setScalar(1);
    }

    updateTransformInputs();
    storeLastPositions();
}

function resetCamera() {
    camera.position.set(0, 1, 3);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
    controlsRight.target.set(0, 0, 0);
    controlsRight.update();
}

function fitToView() {
    const box = new THREE.Box3();
    let hasContent = false;

    if (modelGroup && modelGroup.children.length > 0 && modelGroup.visible) {
        modelGroup.traverse((child) => {
            if (child.isMesh) {
                box.expandByObject(child);
                hasContent = true;
            }
        });
    }

    // For splat, estimate bounds from position and scale
    if (splatMesh && splatMesh.visible) {
        const splatBounds = new THREE.Box3();
        const size = 2 * splatMesh.scale.x; // Estimate
        splatBounds.setFromCenterAndSize(
            splatMesh.position,
            new THREE.Vector3(size, size, size)
        );
        box.union(splatBounds);
        hasContent = true;
    }

    if (!hasContent) {
        box.setFromCenterAndSize(new THREE.Vector3(0, 0, 0), new THREE.Vector3(2, 2, 2));
    }

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const maxDim = Math.max(size.x, size.y, size.z);
    const fov = camera.fov * (Math.PI / 180);
    let cameraDistance = maxDim / (2 * Math.tan(fov / 2));
    cameraDistance *= 1.5;

    camera.position.set(
        center.x + cameraDistance * 0.5,
        center.y + cameraDistance * 0.3,
        center.z + cameraDistance
    );
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
    controlsRight.target.copy(center);
    controlsRight.update();
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

    // Update left toolbar position based on panel visibility
    const leftToolbar = document.getElementById('left-toolbar');
    if (leftToolbar) {
        leftToolbar.style.left = shouldShow ? '295px' : '15px';
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
    showLoading('Loading Gaussian Splat...');

    try {
        // Fetch the file as blob for archive creation
        log.info(' Fetching splat from URL:', url);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
        }
        const blob = await response.blob();
        currentSplatBlob = blob;
        log.info(' Splat blob stored, size:', blob.size);

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
    showLoading('Loading 3D Model...');

    try {
        // Fetch the file as blob for archive creation
        log.info(' Fetching model from URL:', url);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`Failed to fetch: ${response.status} ${response.statusText}`);
        }
        const blob = await response.blob();
        currentMeshBlob = blob;
        log.info(' Mesh blob stored, size:', blob.size);

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
// Alignment utilities imported from alignment.js:
// - KDTree (class)
// - extractSplatPositions, extractMeshVertices
// - computeCentroid, computeOptimalRotation
// - computeSplatBoundsFromPositions
// ============================================================

// ICP alignment function
async function icpAlignObjects() {
    log.debug('[ICP] icpAlignObjects called');

    if (!splatMesh || !modelGroup || modelGroup.children.length === 0) {
        notify.warning('Both splat and model must be loaded for ICP alignment');
        return;
    }

    // Debug: Check splat state
    log.debug('[ICP] splatMesh exists:', !!splatMesh);
    log.debug('[ICP] splatMesh.packedSplats:', !!splatMesh.packedSplats);
    if (splatMesh.packedSplats) {
        log.debug('[ICP] packedSplats.splatCount:', splatMesh.packedSplats.splatCount);
        log.debug('[ICP] packedSplats.forEachSplat:', typeof splatMesh.packedSplats.forEachSplat);
    }

    showLoading('Running ICP alignment...');

    // Allow UI to update
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
        // Extract points
        log.debug('[ICP] Extracting splat positions...');
        const splatPoints = extractSplatPositions(splatMesh, 3000);
        log.debug('[ICP] Extracted splat points:', splatPoints.length);

        log.debug('[ICP] Extracting mesh vertices...');
        const meshPoints = extractMeshVertices(modelGroup, 8000);
        log.debug('[ICP] Extracted mesh points:', meshPoints.length);

        if (splatPoints.length < 10) {
            hideLoading();
            log.error('[ICP] Not enough splat points:', splatPoints.length);
            notify.warning('Could not extract enough splat positions for ICP (' + splatPoints.length + ' found). The splat may not support position extraction or may still be loading.');
            return;
        }

        if (meshPoints.length < 10) {
            hideLoading();
            log.error('[ICP] Not enough mesh points:', meshPoints.length);
            notify.warning('Could not extract enough mesh vertices for ICP (' + meshPoints.length + ' found).');
            return;
        }

        log.debug(`[ICP] Starting ICP with ${splatPoints.length} splat points and ${meshPoints.length} mesh points`);

        // Build KD-tree from mesh points for fast nearest neighbor search
        const kdTree = new KDTree([...meshPoints]);

        // ICP parameters
        const maxIterations = 50;
        const convergenceThreshold = 1e-6;
        let prevMeanError = Infinity;

        // Working copy of splat points (we transform these during iteration)
        let currentPoints = splatPoints.map(p => ({ x: p.x, y: p.y, z: p.z, index: p.index }));

        // Cumulative transformation
        let cumulativeMatrix = new THREE.Matrix4();

        for (let iter = 0; iter < maxIterations; iter++) {
            // Step 1: Find correspondences (nearest neighbors)
            const correspondences = [];
            let totalError = 0;

            for (const srcPt of currentPoints) {
                const nearest = kdTree.nearestNeighbor(srcPt);
                if (nearest.point) {
                    correspondences.push({
                        source: srcPt,
                        target: nearest.point,
                        distSq: nearest.distSq
                    });
                    totalError += nearest.distSq;
                }
            }

            const meanError = totalError / correspondences.length;
            log.debug(`[ICP] Iteration ${iter + 1}: Mean squared error = ${meanError.toFixed(6)}`);

            // Check convergence
            if (Math.abs(prevMeanError - meanError) < convergenceThreshold) {
                log.debug(`[ICP] Converged after ${iter + 1} iterations`);
                break;
            }
            prevMeanError = meanError;

            // Step 2: Compute optimal transformation
            const sourceForAlign = correspondences.map(c => c.source);
            const targetForAlign = correspondences.map(c => c.target);

            const sourceCentroid = computeCentroid(sourceForAlign);
            const targetCentroid = computeCentroid(targetForAlign);

            // Compute rotation
            const rotMatrix = computeOptimalRotation(sourceForAlign, targetForAlign, sourceCentroid, targetCentroid);

            // Compute translation: t = targetCentroid - R * sourceCentroid
            const rotatedSourceCentroid = new THREE.Vector3(sourceCentroid.x, sourceCentroid.y, sourceCentroid.z);
            rotatedSourceCentroid.applyMatrix4(rotMatrix);

            const translation = new THREE.Vector3(
                targetCentroid.x - rotatedSourceCentroid.x,
                targetCentroid.y - rotatedSourceCentroid.y,
                targetCentroid.z - rotatedSourceCentroid.z
            );

            // Build transformation matrix: T = translate * rotate
            const iterMatrix = new THREE.Matrix4();
            iterMatrix.makeTranslation(translation.x, translation.y, translation.z);
            iterMatrix.multiply(rotMatrix);

            // Update cumulative transformation
            cumulativeMatrix.premultiply(iterMatrix);

            // Apply transformation to current points
            for (const pt of currentPoints) {
                const v = new THREE.Vector3(pt.x, pt.y, pt.z);
                v.applyMatrix4(iterMatrix);
                pt.x = v.x;
                pt.y = v.y;
                pt.z = v.z;
            }

            // Update loading text
            updateProgress((iter + 1) / maxIterations * 100, `ICP iteration ${iter + 1}/${maxIterations}...`);
            await new Promise(resolve => setTimeout(resolve, 10)); // Allow UI update
        }

        // Apply cumulative transformation to the splat mesh
        // We need to apply this as changes to position and rotation
        const position = new THREE.Vector3();
        const quaternion = new THREE.Quaternion();
        const scale = new THREE.Vector3();

        // Get current splat transform
        splatMesh.updateMatrixWorld(true);

        // Combine: newMatrix = cumulativeMatrix * currentMatrix
        const newMatrix = new THREE.Matrix4();
        newMatrix.copy(cumulativeMatrix);
        newMatrix.multiply(splatMesh.matrix);

        // Decompose the new matrix
        newMatrix.decompose(position, quaternion, scale);

        // Apply to splat mesh
        splatMesh.position.copy(position);
        splatMesh.quaternion.copy(quaternion);
        splatMesh.scale.copy(scale);
        splatMesh.updateMatrixWorld(true);

        updateTransformInputs();
        storeLastPositions();

        log.debug('[ICP] Alignment complete');
        hideLoading();

    } catch (error) {
        log.error('[ICP] Error during ICP alignment:', error);
        hideLoading();
        notify.error('Error during ICP alignment: ' + error.message);
    }
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

// Auto align objects - aligns model to splat by matching bounding box centers
function autoAlignObjects() {
    if (!splatMesh || !modelGroup || modelGroup.children.length === 0) {
        notify.warning('Both splat and model must be loaded for auto-alignment');
        return;
    }

    const splatBox = new THREE.Box3();
    const modelBox = new THREE.Box3();

    // First, try to get accurate splat bounds from actual positions
    const actualBounds = computeSplatBoundsFromPositions(splatMesh);
    let splatBoundsFound = actualBounds.found;

    if (splatBoundsFound) {
        splatBox.set(actualBounds.min, actualBounds.max);
        log.debug('[AutoAlign] Using bounds from actual splat positions:', {
            min: actualBounds.min.toArray(),
            max: actualBounds.max.toArray()
        });
    }

    // Fallback methods if packedSplats not available
    if (!splatBoundsFound) {
        // Method 1: Check if splatMesh has a boundingBox property
        if (splatMesh.boundingBox && !splatMesh.boundingBox.isEmpty()) {
            splatBox.copy(splatMesh.boundingBox);
            splatBox.applyMatrix4(splatMesh.matrixWorld);
            splatBoundsFound = true;
        }

        // Method 2: Try to get from geometry
        if (!splatBoundsFound && splatMesh.geometry) {
            try {
                if (!splatMesh.geometry.boundingBox) {
                    splatMesh.geometry.computeBoundingBox();
                }
                if (splatMesh.geometry.boundingBox && !splatMesh.geometry.boundingBox.isEmpty()) {
                    splatBox.copy(splatMesh.geometry.boundingBox);
                    splatMesh.updateMatrixWorld(true);
                    splatBox.applyMatrix4(splatMesh.matrixWorld);
                    splatBoundsFound = true;
                }
            } catch (e) {
                log.debug('Could not get splat bounds from geometry:', e);
            }
        }

        // Method 3: Try setFromObject
        if (!splatBoundsFound) {
            try {
                splatMesh.updateMatrixWorld(true);
                splatBox.setFromObject(splatMesh);
                if (!splatBox.isEmpty() && isFinite(splatBox.min.x) && isFinite(splatBox.max.x)) {
                    splatBoundsFound = true;
                }
            } catch (e) {
                log.debug('Could not get splat bounds from setFromObject:', e);
            }
        }

        // Final fallback
        if (!splatBoundsFound || splatBox.isEmpty()) {
            log.debug('[AutoAlign] Using fallback splat bounds estimation');
            const size = 2.0 * Math.max(splatMesh.scale.x, splatMesh.scale.y, splatMesh.scale.z);
            splatBox.setFromCenterAndSize(
                splatMesh.position.clone(),
                new THREE.Vector3(size, size, size)
            );
        }
    }

    // Underground auto-correction: detect if splat is upside down and underground
    // Check if splat is mostly below y=0 (max.y < 0.1 means entirely underground)
    log.debug('[AutoAlign] Splat bounds Y: min=' + splatBox.min.y.toFixed(2) + ', max=' + splatBox.max.y.toFixed(2));

    if (splatBox.max.y < 0.1) {
        log.debug('[AutoAlign] Detected splat is underground (max.y=' + splatBox.max.y.toFixed(2) + '). Flipping 180° on X axis...');
        splatMesh.rotation.x += Math.PI;
        splatMesh.updateMatrixWorld(true);

        // Re-calculate splatBox with the new orientation
        const newBounds = computeSplatBoundsFromPositions(splatMesh);
        if (newBounds.found) {
            splatBox.set(newBounds.min, newBounds.max);
            splatBoundsFound = true;
        } else {
            // Fallback recalculation
            splatBox.makeEmpty();
            if (splatMesh.boundingBox && !splatMesh.boundingBox.isEmpty()) {
                splatBox.copy(splatMesh.boundingBox);
                splatBox.applyMatrix4(splatMesh.matrixWorld);
            } else {
                try {
                    splatBox.setFromObject(splatMesh);
                } catch (e) {
                    const size = 2.0 * Math.max(splatMesh.scale.x, splatMesh.scale.y, splatMesh.scale.z);
                    splatBox.setFromCenterAndSize(splatMesh.position.clone(), new THREE.Vector3(size, size, size));
                }
            }
        }
        log.debug('[AutoAlign] After flip - Splat bounds Y: min=' + splatBox.min.y.toFixed(2) + ', max=' + splatBox.max.y.toFixed(2));
    }

    // Get model bounds with world transforms
    modelGroup.updateMatrixWorld(true);
    modelBox.setFromObject(modelGroup);

    if (modelBox.isEmpty()) {
        notify.warning('Could not compute model bounds');
        return;
    }

    // Get centers of bounding boxes
    const splatCenter = splatBox.getCenter(new THREE.Vector3());
    const modelCenter = modelBox.getCenter(new THREE.Vector3());

    // Align centers horizontally (X, Z) and align bottoms vertically (Y)
    const splatBottom = splatBox.min.y;
    const modelBottom = modelBox.min.y;

    // Calculate where the model should be positioned
    const targetX = splatCenter.x;
    const targetY = modelGroup.position.y + (splatBottom - modelBottom);
    const targetZ = splatCenter.z;

    // Calculate offset from current model center to target position
    const offsetX = targetX - modelCenter.x;
    const offsetZ = targetZ - modelCenter.z;

    // Apply the offset
    modelGroup.position.x += offsetX;
    modelGroup.position.y = targetY;
    modelGroup.position.z += offsetZ;
    modelGroup.updateMatrixWorld(true);

    updateTransformInputs();
    storeLastPositions();

    log.debug('Auto-align complete:', {
        splatBounds: { min: splatBox.min.toArray(), max: splatBox.max.toArray(), center: splatCenter.toArray() },
        modelBounds: { min: modelBox.min.toArray(), max: modelBox.max.toArray(), center: modelCenter.toArray() },
        modelPosition: modelGroup.position.toArray(),
        splatBoundsFound: splatBoundsFound
    });
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
        controls.update();
        controlsRight.update();

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
