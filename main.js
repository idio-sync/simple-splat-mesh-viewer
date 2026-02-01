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

// Mark module as loaded (for pre-module error detection)
window.moduleLoaded = true;
console.log('[main.js] Module loaded successfully, THREE:', !!THREE, 'SplatMesh:', !!SplatMesh);

// Expose THREE globally for debugging and potential library compatibility
window.THREE = THREE;
console.log('[main.js] THREE.REVISION:', THREE.REVISION);

// Global error handler for runtime errors
window.onerror = function(message, source, lineno, colno, error) {
    console.error('[main.js] Runtime error:', message, 'at', source, 'line', lineno);
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
let ambientLight, hemisphereLight, directionalLight1, directionalLight2;

// Annotation and archive creation
let annotationSystem = null;
let archiveCreator = null;

// Blob data for archive export (stored when loading files)
let currentSplatBlob = null;
let currentMeshBlob = null;

// Three.js objects - Split view (right side)
let rendererRight = null;
let controlsRight = null;

// DOM elements (with null checks for debugging)
const canvas = document.getElementById('viewer-canvas');
const canvasRight = document.getElementById('viewer-canvas-right');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

console.log('[main.js] DOM elements found:', {
    canvas: !!canvas,
    canvasRight: !!canvasRight,
    loadingOverlay: !!loadingOverlay,
    loadingText: !!loadingText
});

// Initialize the scene
function init() {
    console.log('[main.js] init() starting...');

    // Verify required DOM elements
    if (!canvas) {
        console.error('[main.js] FATAL: viewer-canvas not found!');
        return;
    }
    if (!canvasRight) {
        console.error('[main.js] FATAL: viewer-canvas-right not found!');
        return;
    }

    // Scene
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0x1a1a2e);

    // Camera
    camera = new THREE.PerspectiveCamera(
        60,
        canvas.clientWidth / canvas.clientHeight,
        0.1,
        1000
    );
    camera.position.set(0, 1, 3);

    // Renderer - Main (left in split mode)
    renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true
    });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Renderer - Right (for split view)
    rendererRight = new THREE.WebGLRenderer({
        canvas: canvasRight,
        antialias: true
    });
    rendererRight.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    rendererRight.outputColorSpace = THREE.SRGBColorSpace;

    // Orbit Controls - Main
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.1;
    controls.maxDistance = 100;

    // Orbit Controls - Right (synced with main)
    // Note: Both controls share the same camera, so they naturally stay in sync
    // We just need both to be able to receive input
    controlsRight = new OrbitControls(camera, rendererRight.domElement);
    controlsRight.enableDamping = true;
    controlsRight.dampingFactor = 0.05;
    controlsRight.screenSpacePanning = true;
    controlsRight.minDistance = 0.1;
    controlsRight.maxDistance = 100;

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
    console.log('[main.js] TransformControls instanceof THREE.Object3D:', transformControls instanceof THREE.Object3D);
    if (!(transformControls instanceof THREE.Object3D)) {
        console.error('[main.js] WARNING: TransformControls is NOT an instance of THREE.Object3D!');
        console.error('[main.js] This indicates THREE.js is loaded multiple times (import map issue).');
        console.error('[main.js] TransformControls constructor:', transformControls.constructor?.name);
        console.error('[main.js] THREE.Object3D:', THREE.Object3D?.name);
        // Try to add anyway - it may work partially
    }
    try {
        scene.add(transformControls);
        console.log('[main.js] TransformControls added to scene successfully');
    } catch (tcError) {
        console.error('[main.js] Failed to add TransformControls to scene:', tcError);
        console.error('[main.js] Transform gizmos will not be visible, but app should still work');
    }

    // Lighting - Enhanced for better mesh visibility
    ambientLight = new THREE.AmbientLight(0xffffff, 0.8);
    scene.add(ambientLight);

    // Hemisphere light for better color graduation
    hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x444444, 0.6);
    scene.add(hemisphereLight);

    directionalLight1 = new THREE.DirectionalLight(0xffffff, 1.5);
    directionalLight1.position.set(5, 5, 5);
    scene.add(directionalLight1);

    directionalLight2 = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight2.position.set(-5, 3, -5);
    scene.add(directionalLight2);

    // Grid helper
    const gridHelper = new THREE.GridHelper(10, 10, 0x4a4a6a, 0x2a2a4a);
    scene.add(gridHelper);

    // Model group
    modelGroup = new THREE.Group();
    modelGroup.name = 'modelGroup';
    scene.add(modelGroup);

    // Initialize annotation system
    annotationSystem = new AnnotationSystem(scene, camera, renderer, controls);
    annotationSystem.onAnnotationCreated = onAnnotationPlaced;
    annotationSystem.onAnnotationSelected = onAnnotationSelected;
    annotationSystem.onPlacementModeChanged = onPlacementModeChanged;

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

    console.log('[main.js] init() completed successfully');
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

// Helper function to safely add event listeners with null checks
function addListener(id, event, handler) {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener(event, handler);
        return true;
    } else {
        console.warn(`[main.js] Element not found: ${id}`);
        return false;
    }
}

function setupUIEvents() {
    console.log('[main.js] Setting up UI events...');

    // Controls panel toggle
    const toggleBtn = document.getElementById('btn-toggle-controls');
    console.log('[main.js] Toggle button found:', !!toggleBtn);
    if (toggleBtn) {
        toggleBtn.onclick = function(e) {
            console.log('[main.js] Toggle button clicked');
            e.preventDefault();
            e.stopPropagation();
            try {
                toggleControlsPanel();
            } catch (err) {
                console.error('[main.js] Error in toggleControlsPanel:', err);
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

    // Selection toggles
    addListener('btn-select-splat', 'click', () => setSelectedObject('splat'));
    addListener('btn-select-model', 'click', () => setSelectedObject('model'));
    addListener('btn-select-both', 'click', () => setSelectedObject('both'));
    addListener('btn-select-none', 'click', () => setSelectedObject('none'));

    // Transform mode toggles
    addListener('btn-translate', 'click', () => setTransformMode('translate'));
    addListener('btn-rotate', 'click', () => setTransformMode('rotate'));
    addListener('btn-scale', 'click', () => setTransformMode('scale'));

    // File inputs
    addListener('splat-input', 'change', handleSplatFile);
    addListener('model-input', 'change', handleModelFile);
    addListener('archive-input', 'change', handleArchiveFile);
    addListener('btn-load-archive-url', 'click', handleLoadArchiveFromUrlPrompt);

    // URL load buttons (using prompt)
    const splatUrlBtn = document.getElementById('btn-load-splat-url');
    const modelUrlBtn = document.getElementById('btn-load-model-url');
    console.log('[main.js] URL buttons found - splat:', !!splatUrlBtn, 'model:', !!modelUrlBtn);

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
    addListener('btn-save-alignment', 'click', saveAlignment);
    addListener('btn-load-alignment', 'click', () => {
        const input = document.getElementById('alignment-input');
        if (input) input.click();
    });
    addListener('alignment-input', 'change', loadAlignment);
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
    addListener('btn-annotate', 'click', toggleAnnotationMode);
    addListener('btn-add-annotation', 'click', toggleAnnotationMode);
    addListener('btn-anno-save', 'click', saveAnnotation);
    addListener('btn-anno-cancel', 'click', cancelAnnotation);
    addListener('btn-update-anno-camera', 'click', updateSelectedAnnotationCamera);
    addListener('btn-delete-anno', 'click', deleteSelectedAnnotation);

    // Export/archive creation controls
    addListener('btn-export-archive', 'click', showExportPanel);
    addListener('btn-open-export', 'click', showExportPanel);
    addListener('btn-export-cancel', 'click', hideExportPanel);
    addListener('btn-export-download', 'click', downloadArchive);

    // Keyboard shortcut for annotation mode
    window.addEventListener('keydown', (e) => {
        if (e.key.toLowerCase() === 'a' && !e.ctrlKey && !e.metaKey) {
            const activeEl = document.activeElement;
            if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
                return; // Don't trigger if typing in input
            }
            toggleAnnotationMode();
        }
    });

    // Setup collapsible sections
    setupCollapsibles();

    console.log('[main.js] UI events setup complete');
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
        console.warn('[main.js] Error detaching transform controls:', e);
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
        console.error('[main.js] Error attaching transform controls:', attachError);
        console.error('[main.js] This may be due to THREE.js instance mismatch.');
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

function showLoading(text = 'Loading...') {
    loadingText.textContent = text;
    loadingOverlay.classList.remove('hidden');
}

function hideLoading() {
    loadingOverlay.classList.add('hidden');
}

// Handle loading splat from URL via prompt
function handleLoadSplatFromUrlPrompt() {
    console.log('[main.js] handleLoadSplatFromUrlPrompt called');
    const url = prompt('Enter Gaussian Splat URL:');
    console.log('[main.js] User entered:', url);
    if (!url) return; // User cancelled or entered empty string

    const trimmedUrl = url.trim();
    if (trimmedUrl.length < 2) {
        alert('Invalid URL');
        return;
    }

    loadSplatFromUrl(trimmedUrl);
}

// Handle loading model from URL via prompt
function handleLoadModelFromUrlPrompt() {
    console.log('[main.js] handleLoadModelFromUrlPrompt called');
    const url = prompt('Enter 3D Model URL (.glb, .gltf, .obj):');
    console.log('[main.js] User entered:', url);
    if (!url) return; // User cancelled or entered empty string

    const trimmedUrl = url.trim();
    if (trimmedUrl.length < 2) {
        alert('Invalid URL');
        return;
    }

    loadModelFromUrl(trimmedUrl);
}

// Handle loading archive from URL via prompt
function handleLoadArchiveFromUrlPrompt() {
    console.log('[main.js] handleLoadArchiveFromUrlPrompt called');
    const url = prompt('Enter Archive URL (.a3d, .a3z):');
    console.log('[main.js] User entered:', url);
    if (!url) return;

    const trimmedUrl = url.trim();
    if (trimmedUrl.length < 2) {
        alert('Invalid URL');
        return;
    }

    loadArchiveFromUrl(trimmedUrl);
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
        console.error('Error loading archive:', error);
        hideLoading();
        alert('Error loading archive: ' + error.message);
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
        console.error('Error loading archive from URL:', error);
        hideLoading();
        alert('Error loading archive from URL: ' + error.message);
    }
}

// Process loaded archive - extract and load splat/mesh
async function processArchive(archiveLoader, archiveName) {
    showLoading('Parsing manifest...');

    try {
        const manifest = await archiveLoader.parseManifest();
        console.log('[main.js] Archive manifest:', manifest);

        state.archiveLoader = archiveLoader;
        state.archiveManifest = manifest;
        state.archiveFileName = archiveName;
        state.archiveLoaded = true;

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
                console.error('[main.js] Error loading splat from archive:', e);
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
                console.error('[main.js] Error loading mesh from archive:', e);
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
            console.warn('[main.js] Archive loaded with warnings:', errors);
        }

        // Alert if no viewable content
        if (!loadedSplat && !loadedMesh) {
            hideLoading();
            alert('Archive does not contain any viewable splat or mesh files.');
            return;
        }

        hideLoading();
    } catch (error) {
        console.error('[main.js] Error processing archive:', error);
        hideLoading();
        alert('Error processing archive: ' + error.message);
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

    // Verify SplatMesh is a valid THREE.Object3D
    if (!(splatMesh instanceof THREE.Object3D)) {
        console.warn('[main.js] WARNING: SplatMesh is not an instance of THREE.Object3D!');
    }

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
        scene.add(splatMesh);
    } catch (addError) {
        console.error('[main.js] Error adding splatMesh to scene:', addError);
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

        // Count faces
        let faceCount = 0;
        loadedObject.traverse((child) => {
            if (child.isMesh && child.geometry) {
                const geo = child.geometry;
                if (geo.index) {
                    faceCount += geo.index.count / 3;
                } else if (geo.attributes.position) {
                    faceCount += geo.attributes.position.count / 3;
                }
            }
        });

        // Update UI
        document.getElementById('model-filename').textContent = fileName;
        document.getElementById('model-faces').textContent = Math.round(faceCount).toLocaleString();
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
                gltf.scene.traverse((child) => {
                    if (child.isMesh) {
                        if (child.geometry && !child.geometry.attributes.normal) {
                            child.geometry.computeVertexNormals();
                        }

                        if (child.material) {
                            const mat = child.material;
                            if (mat.isMeshBasicMaterial || mat.isLineBasicMaterial || mat.isPointsMaterial) {
                                const oldMaterial = mat;
                                child.material = new THREE.MeshStandardMaterial({
                                    color: oldMaterial.color || new THREE.Color(0x888888),
                                    map: oldMaterial.map,
                                    alphaMap: oldMaterial.alphaMap,
                                    transparent: oldMaterial.transparent || false,
                                    opacity: oldMaterial.opacity !== undefined ? oldMaterial.opacity : 1,
                                    side: oldMaterial.side || THREE.FrontSide,
                                    metalness: 0.1,
                                    roughness: 0.8
                                });
                                oldMaterial.dispose();
                            }
                        }
                    }
                });

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
                object.traverse((child) => {
                    if (child.isMesh) {
                        if (child.geometry && !child.geometry.attributes.normal) {
                            child.geometry.computeVertexNormals();
                        }

                        child.material = new THREE.MeshStandardMaterial({
                            color: 0x888888,
                            metalness: 0.1,
                            roughness: 0.8
                        });
                    }
                });
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
    entriesList.innerHTML = '<p class="entries-header">Contents:</p>';

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
    console.log('[main.js] Annotation placed at:', position);

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
    console.log('[main.js] Annotation selected:', annotation.id);

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

    // Show editor panel
    const editor = document.getElementById('selected-annotation-editor');
    if (editor) {
        editor.classList.remove('hidden');

        const titleInput = document.getElementById('edit-anno-title');
        const bodyInput = document.getElementById('edit-anno-body');
        if (titleInput) titleInput.value = annotation.title || '';
        if (bodyInput) bodyInput.value = annotation.body || '';
    }
}

// Called when placement mode changes
function onPlacementModeChanged(active) {
    console.log('[main.js] Placement mode:', active);

    const indicator = document.getElementById('annotation-mode-indicator');
    const btn = document.getElementById('btn-annotate');

    if (indicator) indicator.classList.toggle('hidden', !active);
    if (btn) btn.classList.toggle('active', active);
}

// Toggle annotation placement mode
function toggleAnnotationMode() {
    if (annotationSystem) {
        annotationSystem.togglePlacementMode();
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
        console.log('[main.js] Annotation saved:', annotation);
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
    console.log('[main.js] Updated camera for annotation:', annotationSystem.selectedAnnotation.id);
}

// Delete selected annotation
function deleteSelectedAnnotation() {
    if (!annotationSystem || !annotationSystem.selectedAnnotation) return;

    const id = annotationSystem.selectedAnnotation.id;
    if (confirm(`Delete annotation "${annotationSystem.selectedAnnotation.title}"?`)) {
        annotationSystem.deleteAnnotation(id);
        updateAnnotationsUI();

        // Hide editor
        const editor = document.getElementById('selected-annotation-editor');
        if (editor) editor.classList.add('hidden');
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
        list.innerHTML = '';

        if (count === 0) {
            list.innerHTML = '<p class="no-annotations">No annotations yet. Click "Add Annotation" to create one.</p>';
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
        chips.innerHTML = '';

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
}

// Load annotations from archive
function loadAnnotationsFromArchive(annotations) {
    if (!annotationSystem || !annotations || !Array.isArray(annotations)) return;

    console.log('[main.js] Loading', annotations.length, 'annotations from archive');
    annotationSystem.setAnnotations(annotations);
    updateAnnotationsUI();
}

// ==================== Export/Archive Creation Functions ====================

// Show export panel
function showExportPanel() {
    const panel = document.getElementById('export-panel');
    if (panel) {
        panel.classList.remove('hidden');

        // Pre-fill from archive manifest if available
        if (state.archiveManifest?.project) {
            const proj = state.archiveManifest.project;
            document.getElementById('export-title').value = proj.title || '';
            document.getElementById('export-id').value = proj.id || '';
            document.getElementById('export-description').value = proj.description || '';
            document.getElementById('export-license').value = proj.license || 'CC0';
        }
    }
}

// Hide export panel
function hideExportPanel() {
    const panel = document.getElementById('export-panel');
    if (panel) panel.classList.add('hidden');
}

// Download archive
async function downloadArchive() {
    if (!archiveCreator) return;

    // Reset creator
    archiveCreator.reset();

    // Get form values
    const title = document.getElementById('export-title')?.value || 'Untitled';
    const id = document.getElementById('export-id')?.value || 'project-' + Date.now();
    const description = document.getElementById('export-description')?.value || '';
    const license = document.getElementById('export-license')?.value || 'CC0';
    const formatRadio = document.querySelector('input[name="export-format"]:checked');
    const format = formatRadio?.value || 'a3d';
    const includePreview = document.getElementById('export-include-preview')?.checked || false;

    // Set project info
    archiveCreator.setProjectInfo({ title, id, license, description });

    // Add splat if loaded
    if (currentSplatBlob && state.splatLoaded) {
        const fileName = document.getElementById('splat-filename')?.textContent || 'scene.ply';
        const position = splatMesh ? [splatMesh.position.x, splatMesh.position.y, splatMesh.position.z] : [0, 0, 0];
        const rotation = splatMesh ? [splatMesh.rotation.x, splatMesh.rotation.y, splatMesh.rotation.z] : [0, 0, 0];
        const scale = splatMesh ? splatMesh.scale.x : 1;

        archiveCreator.addScene(currentSplatBlob, fileName, { position, rotation, scale });
    }

    // Add mesh if loaded
    if (currentMeshBlob && state.modelLoaded) {
        const fileName = document.getElementById('model-filename')?.textContent || 'mesh.glb';
        const position = modelGroup ? [modelGroup.position.x, modelGroup.position.y, modelGroup.position.z] : [0, 0, 0];
        const rotation = modelGroup ? [modelGroup.rotation.x, modelGroup.rotation.y, modelGroup.rotation.z] : [0, 0, 0];
        const scale = modelGroup ? modelGroup.scale.x : 1;

        archiveCreator.addMesh(currentMeshBlob, fileName, { position, rotation, scale });
    }

    // Add annotations
    if (annotationSystem && annotationSystem.hasAnnotations()) {
        archiveCreator.setAnnotations(annotationSystem.toJSON());
    }

    // Add preview/thumbnail
    if (includePreview && renderer) {
        try {
            const canvas = renderer.domElement;
            const previewBlob = await captureScreenshot(canvas, { width: 512, height: 512 });
            if (previewBlob) {
                archiveCreator.addThumbnail(previewBlob, 'preview.jpg');
            }
        } catch (e) {
            console.warn('[main.js] Failed to capture preview:', e);
        }
    }

    // Validate
    const validation = archiveCreator.validate();
    if (!validation.valid) {
        alert('Cannot create archive:\n' + validation.errors.join('\n'));
        return;
    }

    // Create and download
    showLoading('Creating archive...');
    try {
        await archiveCreator.downloadArchive({
            filename: id || 'archive',
            format: format
        });
        hideLoading();
        hideExportPanel();
    } catch (e) {
        hideLoading();
        console.error('[main.js] Error creating archive:', e);
        alert('Error creating archive: ' + e.message);
    }
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

        // Verify SplatMesh is a valid THREE.Object3D (detect instance conflicts)
        if (!(splatMesh instanceof THREE.Object3D)) {
            console.warn('[main.js] WARNING: SplatMesh is not an instance of THREE.Object3D!');
            console.warn('[main.js] This may indicate multiple THREE.js instances are loaded.');
            console.warn('[main.js] SplatMesh constructor:', splatMesh.constructor?.name);
            // Try to proceed anyway - some operations may still work
        }

        // Brief delay to allow SplatMesh initialization
        // Note: Spark library doesn't expose a ready callback, so we use a short delay
        await new Promise(resolve => setTimeout(resolve, 100));

        try {
            scene.add(splatMesh);
        } catch (addError) {
            console.error('[main.js] Error adding splatMesh to scene:', addError);
            console.error('[main.js] This is likely due to THREE.js instance mismatch with Spark library.');
            throw addError;
        }

        // Clean up URL after a delay
        setTimeout(() => URL.revokeObjectURL(fileUrl), 5000);

        state.splatLoaded = true;
        state.currentSplatUrl = null; // Local files cannot be shared
        updateVisibility();
        updateTransformInputs();
        storeLastPositions();

        // Store blob for archive export
        currentSplatBlob = file;

        // Update info - Spark doesn't expose count directly, show file name
        document.getElementById('splat-vertices').textContent = 'Loaded';

        // Auto-align if model is already loaded (wait for splat to fully initialize)
        if (state.modelLoaded) {
            setTimeout(() => autoAlignObjects(), 500);
        }

        // Clear existing archive state since we're loading individual files
        clearArchiveMetadata();

        hideLoading();
    } catch (error) {
        console.error('Error loading splat:', error);
        hideLoading();
        alert('Error loading Gaussian Splat: ' + error.message);
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

            // Count faces
            let faceCount = 0;
            loadedObject.traverse((child) => {
                if (child.isMesh && child.geometry) {
                    const geo = child.geometry;
                    if (geo.index) {
                        faceCount += geo.index.count / 3;
                    } else if (geo.attributes.position) {
                        faceCount += geo.attributes.position.count / 3;
                    }
                }
            });
            document.getElementById('model-faces').textContent = Math.round(faceCount).toLocaleString();

            // Auto-align if splat is already loaded
            if (state.splatLoaded) {
                setTimeout(() => autoAlignObjects(), 500);
            }

            // Clear existing archive state since we're loading individual files
            clearArchiveMetadata();
        }

        hideLoading();
    } catch (error) {
        console.error('Error loading model:', error);
        hideLoading();
        alert('Error loading model: ' + error.message);
    }
}

function disposeObject(obj) {
    obj.traverse((child) => {
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            if (Array.isArray(child.material)) {
                child.material.forEach(m => m.dispose());
            } else {
                child.material.dispose();
            }
        }
    });
}

function loadGLTF(file) {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        const url = URL.createObjectURL(file);

        loader.load(
            url,
            (gltf) => {
                URL.revokeObjectURL(url);

                // Process materials and normals for proper lighting
                gltf.scene.traverse((child) => {
                    if (child.isMesh) {
                        // Ensure normals exist for proper lighting
                        if (child.geometry && !child.geometry.attributes.normal) {
                            child.geometry.computeVertexNormals();
                        }

                        // Convert non-PBR materials to MeshStandardMaterial for lighting support
                        if (child.material) {
                            const mat = child.material;
                            if (mat.isMeshBasicMaterial || mat.isLineBasicMaterial || mat.isPointsMaterial) {
                                const oldMaterial = mat;
                                child.material = new THREE.MeshStandardMaterial({
                                    color: oldMaterial.color || new THREE.Color(0x888888),
                                    map: oldMaterial.map,
                                    alphaMap: oldMaterial.alphaMap,
                                    transparent: oldMaterial.transparent || false,
                                    opacity: oldMaterial.opacity !== undefined ? oldMaterial.opacity : 1,
                                    side: oldMaterial.side || THREE.FrontSide,
                                    metalness: 0.1,
                                    roughness: 0.8
                                });
                                oldMaterial.dispose();
                            }
                        }
                    }
                });

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

                            // Process materials and normals for proper lighting
                            object.traverse((child) => {
                                if (child.isMesh) {
                                    // Ensure normals exist for proper lighting
                                    if (child.geometry && !child.geometry.attributes.normal) {
                                        child.geometry.computeVertexNormals();
                                    }

                                    // Convert to MeshStandardMaterial for consistent PBR lighting
                                    if (child.material) {
                                        const oldMaterial = child.material;
                                        const color = oldMaterial.color?.clone() || new THREE.Color(0x888888);
                                        const map = oldMaterial.map || null;

                                        child.material = new THREE.MeshStandardMaterial({
                                            color: color,
                                            map: map,
                                            metalness: 0.1,
                                            roughness: 0.8
                                        });

                                        if (oldMaterial.dispose) {
                                            oldMaterial.dispose();
                                        }
                                    }
                                }
                            });

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
            object.traverse((child) => {
                if (child.isMesh) {
                    // Ensure normals exist for proper lighting
                    if (child.geometry && !child.geometry.attributes.normal) {
                        child.geometry.computeVertexNormals();
                    }

                    child.material = new THREE.MeshStandardMaterial({
                        color: 0x888888,
                        metalness: 0.1,
                        roughness: 0.8
                    });
                }
            });
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
            alert('Error loading alignment file: ' + error.message);
        }
    };
    reader.readAsText(file);

    // Reset input so same file can be loaded again
    event.target.value = '';
}

// Load alignment from a URL
async function loadAlignmentFromUrl(url) {
    try {
        console.log('[main.js] Loading alignment from URL:', url);
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        const alignment = await response.json();
        applyAlignmentData(alignment);
        console.log('[main.js] Alignment loaded successfully from URL');
        return true;
    } catch (error) {
        console.error('[main.js] Error loading alignment from URL:', error);
        return false;
    }
}

// Copy a shareable link to the clipboard
function copyShareLink() {
    // Check if at least one URL is present
    if (!state.currentArchiveUrl && !state.currentSplatUrl && !state.currentModelUrl) {
        alert('Cannot share: No files loaded from URL. Share links only work for files loaded via URL, not local uploads.');
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
            alert('Share link copied to clipboard!');
        }).catch((err) => {
            console.error('[main.js] Failed to copy share link:', err);
            alert('Share link:\n' + shareUrl);
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
        alert('Share link copied to clipboard!');
    }).catch((err) => {
        console.error('[main.js] Failed to copy share link:', err);
        // Fallback: show the URL in an alert
        alert('Share link:\n' + shareUrl);
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
        console.error('[main.js] controls-panel not found!');
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
    console.log('[DIAG] === applyControlsVisibilityDirect ===');
    console.log('[DIAG] shouldShow:', shouldShow);
    console.log('[DIAG] BEFORE - classList:', controlsPanel.className);
    console.log('[DIAG] BEFORE - inline style:', controlsPanel.style.cssText);
    const beforeComputed = window.getComputedStyle(controlsPanel);
    console.log('[DIAG] BEFORE - computed width:', beforeComputed.width);
    console.log('[DIAG] BEFORE - computed minWidth:', beforeComputed.minWidth);
    console.log('[DIAG] BEFORE - computed padding:', beforeComputed.padding);

    // Check controls mode
    let mode = 'full';
    try {
        mode = config.controlsMode || 'full';
    } catch (e) {
        console.warn('[main.js] Could not read config.controlsMode:', e);
    }
    console.log('[DIAG] mode:', mode);

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
        console.log('[DIAG] Attempting to SHOW panel...');

        // Remove hidden class
        controlsPanel.classList.remove('panel-hidden', 'hidden');
        console.log('[DIAG] After classList.remove - className:', controlsPanel.className);

        // Force explicit inline styles to override any CSS issues
        const targetWidth = (mode === 'minimal') ? '200px' : '280px';
        controlsPanel.style.width = targetWidth;
        controlsPanel.style.minWidth = targetWidth;
        controlsPanel.style.padding = '20px';
        controlsPanel.style.overflow = 'visible';
        controlsPanel.style.overflowY = 'auto';
        controlsPanel.style.borderLeftWidth = '1px';
        controlsPanel.style.pointerEvents = 'auto';
        console.log('[DIAG] After setting inline styles - style.cssText:', controlsPanel.style.cssText);

        if (toggleBtn) toggleBtn.classList.remove('controls-hidden');
    } else {
        console.log('[DIAG] Attempting to HIDE panel...');
        controlsPanel.classList.add('panel-hidden');
        console.log('[DIAG] After classList.add - className:', controlsPanel.className);

        if (toggleBtn) toggleBtn.classList.add('controls-hidden');
    }

    // DIAGNOSTIC: Log state after changes (immediate)
    console.log('[DIAG] AFTER (immediate) - classList:', controlsPanel.className);
    console.log('[DIAG] AFTER (immediate) - inline style:', controlsPanel.style.cssText);
    const afterComputed = window.getComputedStyle(controlsPanel);
    console.log('[DIAG] AFTER (immediate) - computed width:', afterComputed.width);
    console.log('[DIAG] AFTER (immediate) - computed minWidth:', afterComputed.minWidth);
    console.log('[DIAG] AFTER (immediate) - computed padding:', afterComputed.padding);
    console.log('[DIAG] AFTER (immediate) - offsetWidth:', controlsPanel.offsetWidth);

    // DIAGNOSTIC: Check again after a delay (after potential transition)
    setTimeout(() => {
        const delayedComputed = window.getComputedStyle(controlsPanel);
        console.log('[DIAG] AFTER (200ms) - classList:', controlsPanel.className);
        console.log('[DIAG] AFTER (200ms) - computed width:', delayedComputed.width);
        console.log('[DIAG] AFTER (200ms) - offsetWidth:', controlsPanel.offsetWidth);
        console.log('[DIAG] === END ===');

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
        console.warn('[main.js] Could not read state.controlsVisible:', e);
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
        console.log('[main.js] Loading archive from URL:', config.defaultArchiveUrl);
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
        await new Promise(resolve => setTimeout(resolve, 500));

        if (config.inlineAlignment) {
            // Apply inline alignment from URL params
            console.log('[main.js] Applying inline alignment from URL params...');
            applyAlignmentData(config.inlineAlignment);
        } else if (config.defaultAlignmentUrl) {
            // Load alignment from URL file
            const alignmentLoaded = await loadAlignmentFromUrl(config.defaultAlignmentUrl);
            if (!alignmentLoaded && state.splatLoaded && state.modelLoaded) {
                // Fallback to auto-align if alignment URL fetch failed
                console.log('[main.js] Alignment URL failed, falling back to auto-align...');
                autoAlignObjects();
            }
        } else if (state.splatLoaded && state.modelLoaded) {
            // No alignment provided, run auto-align
            console.log('Both files loaded from URL, running auto-align...');
            autoAlignObjects();
        }
    }
}

async function loadSplatFromUrl(url) {
    showLoading('Loading Gaussian Splat...');

    try {
        // Remove existing splat
        if (splatMesh) {
            scene.remove(splatMesh);
            if (splatMesh.dispose) splatMesh.dispose();
            splatMesh = null;
        }

        // Create SplatMesh using Spark
        splatMesh = new SplatMesh({ url: url });

        // Verify SplatMesh is a valid THREE.Object3D
        if (!(splatMesh instanceof THREE.Object3D)) {
            console.warn('[main.js] WARNING: SplatMesh is not an instance of THREE.Object3D!');
            console.warn('[main.js] This may indicate multiple THREE.js instances are loaded.');
        }

        // Wait a moment for initialization
        await new Promise(resolve => setTimeout(resolve, 100));

        try {
            scene.add(splatMesh);
        } catch (addError) {
            console.error('[main.js] Error adding splatMesh to scene:', addError);
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
        console.error('Error loading splat from URL:', error);
        hideLoading();
    }
}

async function loadModelFromUrl(url) {
    showLoading('Loading 3D Model...');

    try {
        // Clear existing model
        while (modelGroup.children.length > 0) {
            const child = modelGroup.children[0];
            disposeObject(child);
            modelGroup.remove(child);
        }

        const extension = url.split('.').pop().toLowerCase().split('?')[0];
        let loadedObject;

        if (extension === 'glb' || extension === 'gltf') {
            loadedObject = await loadGLTFFromUrl(url);
        } else if (extension === 'obj') {
            loadedObject = await loadOBJFromUrl(url);
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

            // Count faces
            let faceCount = 0;
            loadedObject.traverse((child) => {
                if (child.isMesh && child.geometry) {
                    const geo = child.geometry;
                    if (geo.index) {
                        faceCount += geo.index.count / 3;
                    } else if (geo.attributes.position) {
                        faceCount += geo.attributes.position.count / 3;
                    }
                }
            });

            // Update UI
            const filename = url.split('/').pop() || 'URL';
            document.getElementById('model-filename').textContent = filename;
            document.getElementById('model-faces').textContent = Math.round(faceCount).toLocaleString();
        }

        hideLoading();
    } catch (error) {
        console.error('Error loading model from URL:', error);
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
                gltf.scene.traverse((child) => {
                    if (child.isMesh) {
                        // Ensure normals exist for proper lighting
                        if (child.geometry && !child.geometry.attributes.normal) {
                            child.geometry.computeVertexNormals();
                        }

                        // Convert non-PBR materials to MeshStandardMaterial for lighting support
                        if (child.material) {
                            const mat = child.material;
                            if (mat.isMeshBasicMaterial || mat.isLineBasicMaterial || mat.isPointsMaterial) {
                                const oldMaterial = mat;
                                child.material = new THREE.MeshStandardMaterial({
                                    color: oldMaterial.color || new THREE.Color(0x888888),
                                    map: oldMaterial.map,
                                    alphaMap: oldMaterial.alphaMap,
                                    transparent: oldMaterial.transparent || false,
                                    opacity: oldMaterial.opacity !== undefined ? oldMaterial.opacity : 1,
                                    side: oldMaterial.side || THREE.FrontSide,
                                    metalness: 0.1,
                                    roughness: 0.8
                                });
                                oldMaterial.dispose();
                            }
                        }
                    }
                });

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
                object.traverse((child) => {
                    if (child.isMesh) {
                        // Ensure normals exist for proper lighting
                        if (child.geometry && !child.geometry.attributes.normal) {
                            child.geometry.computeVertexNormals();
                        }

                        // Convert any material to MeshStandardMaterial for consistent lighting
                        const oldMaterial = child.material;
                        const color = oldMaterial?.color?.clone() || new THREE.Color(0x888888);
                        const map = oldMaterial?.map || null;

                        child.material = new THREE.MeshStandardMaterial({
                            color: color,
                            map: map,
                            metalness: 0.1,
                            roughness: 0.8
                        });

                        if (oldMaterial && oldMaterial.dispose) {
                            oldMaterial.dispose();
                        }
                    }
                });
                resolve(object);
            },
            undefined,
            (error) => reject(error)
        );
    });
}

// ============================================================
// Helper function to compute splat bounds from actual positions
// ============================================================

function computeSplatBoundsFromPositions(splatMeshObj) {
    const bounds = {
        min: new THREE.Vector3(Infinity, Infinity, Infinity),
        max: new THREE.Vector3(-Infinity, -Infinity, -Infinity),
        center: new THREE.Vector3(),
        found: false
    };

    // Get splat's world matrix
    splatMeshObj.updateMatrixWorld(true);
    const worldMatrix = splatMeshObj.matrixWorld;

    // Try packedSplats API first
    if (splatMeshObj.packedSplats && typeof splatMeshObj.packedSplats.forEachSplat === 'function') {
        const splatCount = splatMeshObj.packedSplats.splatCount || 0;
        if (splatCount > 0) {
            let count = 0;
            const maxSamples = Math.min(splatCount, 1000); // Sample up to 1000 points for speed
            const stride = Math.max(1, Math.floor(splatCount / maxSamples));

            splatMeshObj.packedSplats.forEachSplat((index, center) => {
                if (index % stride === 0) {
                    const worldPos = new THREE.Vector3(center.x, center.y, center.z);
                    worldPos.applyMatrix4(worldMatrix);
                    bounds.min.min(worldPos);
                    bounds.max.max(worldPos);
                    count++;
                }
            });

            if (count > 0) {
                bounds.center.addVectors(bounds.min, bounds.max).multiplyScalar(0.5);
                bounds.found = true;
                console.log(`[SplatBounds] Computed from ${count} sampled positions`);
            }
        }
    }

    return bounds;
}

// ============================================================
// KD-Tree Implementation for efficient nearest neighbor search
// ============================================================

class KDTree {
    constructor(points) {
        // points is an array of {x, y, z, index}
        this.root = this.buildTree(points, 0);
    }

    buildTree(points, depth) {
        if (points.length === 0) return null;

        const axis = depth % 3; // 0=x, 1=y, 2=z
        const axisKey = ['x', 'y', 'z'][axis];

        // Sort points by the current axis
        points.sort((a, b) => a[axisKey] - b[axisKey]);

        const median = Math.floor(points.length / 2);

        return {
            point: points[median],
            axis: axis,
            left: this.buildTree(points.slice(0, median), depth + 1),
            right: this.buildTree(points.slice(median + 1), depth + 1)
        };
    }

    // Find nearest neighbor to target point
    nearestNeighbor(target) {
        let best = { point: null, distSq: Infinity };
        this.searchNearest(this.root, target, best);
        return best;
    }

    searchNearest(node, target, best) {
        if (node === null) return;

        const dx = target.x - node.point.x;
        const dy = target.y - node.point.y;
        const dz = target.z - node.point.z;
        const distSq = dx * dx + dy * dy + dz * dz;

        if (distSq < best.distSq) {
            best.point = node.point;
            best.distSq = distSq;
        }

        const axisKey = ['x', 'y', 'z'][node.axis];
        const diff = target[axisKey] - node.point[axisKey];

        // Search the closer side first
        const first = diff < 0 ? node.left : node.right;
        const second = diff < 0 ? node.right : node.left;

        this.searchNearest(first, target, best);

        // Only search the other side if it could contain a closer point
        if (diff * diff < best.distSq) {
            this.searchNearest(second, target, best);
        }
    }
}

// ============================================================
// ICP (Iterative Closest Point) Alignment
// ============================================================

// Extract positions from splat mesh (in world space)
function extractSplatPositions(splatMeshObj, maxPoints = 5000) {
    const positions = [];

    // Get splat's world matrix for transforming local positions to world space
    splatMeshObj.updateMatrixWorld(true);
    const worldMatrix = splatMeshObj.matrixWorld;

    // Debug: log available properties
    console.log('[extractSplatPositions] Checking available APIs...');
    console.log('[extractSplatPositions] packedSplats:', !!splatMeshObj.packedSplats);
    console.log('[extractSplatPositions] geometry:', !!splatMeshObj.geometry);

    // Try to access splat positions via Spark library's packedSplats API
    if (splatMeshObj.packedSplats && typeof splatMeshObj.packedSplats.forEachSplat === 'function') {
        let count = 0;
        const splatCount = splatMeshObj.packedSplats.splatCount || 0;
        console.log('[extractSplatPositions] splatCount:', splatCount);

        if (splatCount === 0) {
            console.warn('[extractSplatPositions] splatCount is 0, splat may still be loading');
        }

        const stride = Math.max(1, Math.floor(splatCount / maxPoints));

        try {
            splatMeshObj.packedSplats.forEachSplat((index, center) => {
                if (index % stride === 0 && count < maxPoints) {
                    // center is a reused Vector3, so clone and transform to world space
                    const worldPos = new THREE.Vector3(center.x, center.y, center.z);
                    worldPos.applyMatrix4(worldMatrix);
                    positions.push({
                        x: worldPos.x,
                        y: worldPos.y,
                        z: worldPos.z,
                        index: index
                    });
                    count++;
                }
            });
        } catch (e) {
            console.error('[extractSplatPositions] Error in forEachSplat:', e);
        }
        console.log(`[extractSplatPositions] Extracted ${positions.length} splat positions via forEachSplat (world space)`);
    } else if (splatMeshObj.geometry && splatMeshObj.geometry.attributes.position) {
        // Fallback: try to read from geometry
        const posAttr = splatMeshObj.geometry.attributes.position;
        console.log('[extractSplatPositions] geometry.position.count:', posAttr.count);
        const stride = Math.max(1, Math.floor(posAttr.count / maxPoints));
        for (let i = 0; i < posAttr.count && positions.length < maxPoints; i += stride) {
            const worldPos = new THREE.Vector3(
                posAttr.getX(i),
                posAttr.getY(i),
                posAttr.getZ(i)
            );
            worldPos.applyMatrix4(worldMatrix);
            positions.push({
                x: worldPos.x,
                y: worldPos.y,
                z: worldPos.z,
                index: i
            });
        }
        console.log(`[extractSplatPositions] Extracted ${positions.length} splat positions from geometry (world space)`);
    } else {
        console.warn('[extractSplatPositions] Could not find splat position data');
        console.log('[extractSplatPositions] Available splatMesh properties:', Object.keys(splatMeshObj));
        if (splatMeshObj.packedSplats) {
            console.log('[extractSplatPositions] Available packedSplats properties:', Object.keys(splatMeshObj.packedSplats));
        }
    }

    return positions;
}

// Extract vertex positions from model mesh
function extractMeshVertices(modelGroupObj, maxPoints = 10000) {
    const positions = [];
    const allVertices = [];

    // Collect all vertices from all meshes
    modelGroupObj.traverse((child) => {
        if (child.isMesh && child.geometry) {
            const geo = child.geometry;
            const posAttr = geo.attributes.position;
            if (!posAttr) return;

            // Get world matrix for this mesh
            child.updateMatrixWorld(true);
            const matrix = child.matrixWorld;

            for (let i = 0; i < posAttr.count; i++) {
                const v = new THREE.Vector3(
                    posAttr.getX(i),
                    posAttr.getY(i),
                    posAttr.getZ(i)
                );
                v.applyMatrix4(matrix);
                allVertices.push({ x: v.x, y: v.y, z: v.z, index: allVertices.length });
            }
        }
    });

    // Subsample if too many vertices
    const stride = Math.max(1, Math.floor(allVertices.length / maxPoints));
    for (let i = 0; i < allVertices.length && positions.length < maxPoints; i += stride) {
        positions.push(allVertices[i]);
    }

    console.log(`[ICP] Extracted ${positions.length} mesh vertices (from ${allVertices.length} total)`);
    return positions;
}

// Compute centroid of points
function computeCentroid(points) {
    let cx = 0, cy = 0, cz = 0;
    for (const p of points) {
        cx += p.x;
        cy += p.y;
        cz += p.z;
    }
    const n = points.length;
    return { x: cx / n, y: cy / n, z: cz / n };
}

// Compute optimal rotation using SVD-like approach (Kabsch algorithm simplified)
// Returns a rotation matrix that best aligns source to target
function computeOptimalRotation(sourcePoints, targetPoints, sourceCentroid, targetCentroid) {
    // Build the covariance matrix H
    // H = sum((source - sourceCentroid) * (target - targetCentroid)^T)
    let h = [
        [0, 0, 0],
        [0, 0, 0],
        [0, 0, 0]
    ];

    for (let i = 0; i < sourcePoints.length; i++) {
        const s = sourcePoints[i];
        const t = targetPoints[i];

        const sx = s.x - sourceCentroid.x;
        const sy = s.y - sourceCentroid.y;
        const sz = s.z - sourceCentroid.z;

        const tx = t.x - targetCentroid.x;
        const ty = t.y - targetCentroid.y;
        const tz = t.z - targetCentroid.z;

        h[0][0] += sx * tx;
        h[0][1] += sx * ty;
        h[0][2] += sx * tz;
        h[1][0] += sy * tx;
        h[1][1] += sy * ty;
        h[1][2] += sy * tz;
        h[2][0] += sz * tx;
        h[2][1] += sz * ty;
        h[2][2] += sz * tz;
    }

    // Compute SVD of H using power iteration (simplified for 3x3)
    // For robustness, we use a quaternion-based approach instead
    // This is the Horn's method using quaternion
    const n11 = h[0][0], n12 = h[0][1], n13 = h[0][2];
    const n21 = h[1][0], n22 = h[1][1], n23 = h[1][2];
    const n31 = h[2][0], n32 = h[2][1], n33 = h[2][2];

    // Build the 4x4 matrix for quaternion-based solution
    const n = [
        [n11 + n22 + n33, n23 - n32, n31 - n13, n12 - n21],
        [n23 - n32, n11 - n22 - n33, n12 + n21, n31 + n13],
        [n31 - n13, n12 + n21, -n11 + n22 - n33, n23 + n32],
        [n12 - n21, n31 + n13, n23 + n32, -n11 - n22 + n33]
    ];

    // Find largest eigenvalue/eigenvector using power iteration
    let q = [1, 0, 0, 0]; // Initial quaternion guess
    for (let iter = 0; iter < 50; iter++) {
        // Multiply n * q
        const newQ = [
            n[0][0] * q[0] + n[0][1] * q[1] + n[0][2] * q[2] + n[0][3] * q[3],
            n[1][0] * q[0] + n[1][1] * q[1] + n[1][2] * q[2] + n[1][3] * q[3],
            n[2][0] * q[0] + n[2][1] * q[1] + n[2][2] * q[2] + n[2][3] * q[3],
            n[3][0] * q[0] + n[3][1] * q[1] + n[3][2] * q[2] + n[3][3] * q[3]
        ];

        // Normalize
        const len = Math.sqrt(newQ[0] * newQ[0] + newQ[1] * newQ[1] + newQ[2] * newQ[2] + newQ[3] * newQ[3]);
        if (len < 1e-10) break;
        q = [newQ[0] / len, newQ[1] / len, newQ[2] / len, newQ[3] / len];
    }

    // Convert quaternion to rotation matrix
    const qw = q[0], qx = q[1], qy = q[2], qz = q[3];
    const rotMatrix = new THREE.Matrix4();
    rotMatrix.set(
        1 - 2 * qy * qy - 2 * qz * qz, 2 * qx * qy - 2 * qz * qw, 2 * qx * qz + 2 * qy * qw, 0,
        2 * qx * qy + 2 * qz * qw, 1 - 2 * qx * qx - 2 * qz * qz, 2 * qy * qz - 2 * qx * qw, 0,
        2 * qx * qz - 2 * qy * qw, 2 * qy * qz + 2 * qx * qw, 1 - 2 * qx * qx - 2 * qy * qy, 0,
        0, 0, 0, 1
    );

    return rotMatrix;
}

// ICP alignment function
async function icpAlignObjects() {
    console.log('[ICP] icpAlignObjects called');

    if (!splatMesh || !modelGroup || modelGroup.children.length === 0) {
        alert('Both splat and model must be loaded for ICP alignment');
        return;
    }

    // Debug: Check splat state
    console.log('[ICP] splatMesh exists:', !!splatMesh);
    console.log('[ICP] splatMesh.packedSplats:', !!splatMesh.packedSplats);
    if (splatMesh.packedSplats) {
        console.log('[ICP] packedSplats.splatCount:', splatMesh.packedSplats.splatCount);
        console.log('[ICP] packedSplats.forEachSplat:', typeof splatMesh.packedSplats.forEachSplat);
    }

    showLoading('Running ICP alignment...');

    // Allow UI to update
    await new Promise(resolve => setTimeout(resolve, 50));

    try {
        // Extract points
        console.log('[ICP] Extracting splat positions...');
        const splatPoints = extractSplatPositions(splatMesh, 3000);
        console.log('[ICP] Extracted splat points:', splatPoints.length);

        console.log('[ICP] Extracting mesh vertices...');
        const meshPoints = extractMeshVertices(modelGroup, 8000);
        console.log('[ICP] Extracted mesh points:', meshPoints.length);

        if (splatPoints.length < 10) {
            hideLoading();
            console.error('[ICP] Not enough splat points:', splatPoints.length);
            alert('Could not extract enough splat positions for ICP (' + splatPoints.length + ' found). The splat may not support position extraction or may still be loading.');
            return;
        }

        if (meshPoints.length < 10) {
            hideLoading();
            console.error('[ICP] Not enough mesh points:', meshPoints.length);
            alert('Could not extract enough mesh vertices for ICP (' + meshPoints.length + ' found).');
            return;
        }

        console.log(`[ICP] Starting ICP with ${splatPoints.length} splat points and ${meshPoints.length} mesh points`);

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
            console.log(`[ICP] Iteration ${iter + 1}: Mean squared error = ${meanError.toFixed(6)}`);

            // Check convergence
            if (Math.abs(prevMeanError - meanError) < convergenceThreshold) {
                console.log(`[ICP] Converged after ${iter + 1} iterations`);
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
            loadingText.textContent = `ICP iteration ${iter + 1}/${maxIterations}...`;
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

        console.log('[ICP] Alignment complete');
        hideLoading();

    } catch (error) {
        console.error('[ICP] Error during ICP alignment:', error);
        hideLoading();
        alert('Error during ICP alignment: ' + error.message);
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
        alert('Both splat and model must be loaded for auto-alignment');
        return;
    }

    const splatBox = new THREE.Box3();
    const modelBox = new THREE.Box3();

    // First, try to get accurate splat bounds from actual positions
    const actualBounds = computeSplatBoundsFromPositions(splatMesh);
    let splatBoundsFound = actualBounds.found;

    if (splatBoundsFound) {
        splatBox.set(actualBounds.min, actualBounds.max);
        console.log('[AutoAlign] Using bounds from actual splat positions:', {
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
                console.log('Could not get splat bounds from geometry:', e);
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
                console.log('Could not get splat bounds from setFromObject:', e);
            }
        }

        // Final fallback
        if (!splatBoundsFound || splatBox.isEmpty()) {
            console.log('[AutoAlign] Using fallback splat bounds estimation');
            const size = 2.0 * Math.max(splatMesh.scale.x, splatMesh.scale.y, splatMesh.scale.z);
            splatBox.setFromCenterAndSize(
                splatMesh.position.clone(),
                new THREE.Vector3(size, size, size)
            );
        }
    }

    // Underground auto-correction: detect if splat is upside down and underground
    // Check if splat is mostly below y=0 (max.y < 0.1 means entirely underground)
    console.log('[AutoAlign] Splat bounds Y: min=' + splatBox.min.y.toFixed(2) + ', max=' + splatBox.max.y.toFixed(2));

    if (splatBox.max.y < 0.1) {
        console.log('[AutoAlign] Detected splat is underground (max.y=' + splatBox.max.y.toFixed(2) + '). Flipping 180° on X axis...');
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
        console.log('[AutoAlign] After flip - Splat bounds Y: min=' + splatBox.min.y.toFixed(2) + ', max=' + splatBox.max.y.toFixed(2));
    }

    // Get model bounds with world transforms
    modelGroup.updateMatrixWorld(true);
    modelBox.setFromObject(modelGroup);

    if (modelBox.isEmpty()) {
        alert('Could not compute model bounds');
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

    console.log('Auto-align complete:', {
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

        updateFPS();

        // Reset error count on successful frame
        animationErrorCount = 0;
    } catch (e) {
        animationErrorCount++;
        if (animationErrorCount <= MAX_ANIMATION_ERRORS) {
            console.error('[main.js] Animation loop error:', e);
        }
        if (animationErrorCount === MAX_ANIMATION_ERRORS) {
            console.error('[main.js] Suppressing further animation errors...');
        }
    }
}

// Initialize when DOM is ready
console.log('[main.js] Setting up initialization, readyState:', document.readyState);
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        console.log('[main.js] DOMContentLoaded fired, calling init()');
        try {
            init();
        } catch (e) {
            console.error('[main.js] Init error:', e);
            console.error('[main.js] Stack:', e.stack);
        }
    });
} else {
    console.log('[main.js] DOM already ready, calling init()');
    try {
        init();
    } catch (e) {
        console.error('[main.js] Init error:', e);
        console.error('[main.js] Stack:', e.stack);
    }
}
