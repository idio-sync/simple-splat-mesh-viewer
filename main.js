// ES Module imports (these are hoisted - execute first before any other code)
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { SplatMesh } from '@sparkjsdev/spark';

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
    defaultSplatUrl: '',
    defaultModelUrl: '',
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
    controlsVisible: config.showControls
};

// Three.js objects - Main view
let scene, camera, renderer, controls, transformControls;
let splatMesh = null;
let modelGroup = null;
let ambientLight, hemisphereLight, directionalLight1, directionalLight2;

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
        onWindowResize();
    } else {
        if (container) container.classList.remove('split-view');
        if (canvasRight) canvasRight.classList.add('hidden');
        if (splitLabels) splitLabels.classList.add('hidden');
        onWindowResize();
    }

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
        updateVisibility();
        updateTransformInputs();
        storeLastPositions();

        // Update info - Spark doesn't expose count directly, show file name
        document.getElementById('splat-vertices').textContent = 'Loaded';

        // Auto-align if model is already loaded (wait for splat to fully initialize)
        if (state.modelLoaded) {
            setTimeout(() => autoAlignObjects(), 500);
        }

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
            document.getElementById('model-faces').textContent = Math.round(faceCount).toLocaleString();

            // Auto-align if splat is already loaded
            if (state.splatLoaded) {
                setTimeout(() => autoAlignObjects(), 500);
            }
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

function loadAlignment(event) {
    const file = event.target.files[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (e) => {
        try {
            const alignment = JSON.parse(e.target.result);

            if (alignment.splat && splatMesh) {
                splatMesh.position.fromArray(alignment.splat.position);
                splatMesh.rotation.set(...alignment.splat.rotation);
                splatMesh.scale.setScalar(alignment.splat.scale);
            }

            if (alignment.model && modelGroup) {
                modelGroup.position.fromArray(alignment.model.position);
                modelGroup.rotation.set(...alignment.model.rotation);
                modelGroup.scale.setScalar(alignment.model.scale);
            }

            updateTransformInputs();
            storeLastPositions();
        } catch (error) {
            alert('Error loading alignment file: ' + error.message);
        }
    };
    reader.readAsText(file);

    // Reset input so same file can be loaded again
    event.target.value = '';
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
    if (config.defaultSplatUrl) {
        await loadSplatFromUrl(config.defaultSplatUrl);
    }

    if (config.defaultModelUrl) {
        await loadModelFromUrl(config.defaultModelUrl);
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

    // Get splat bounds - try multiple methods
    let splatBoundsFound = false;

    // Method 1: Check if splatMesh has a boundingBox property (some loaders set this)
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

    // Method 3: Try expandByObject (traverses children too)
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

    // Method 4: Check children of splatMesh
    if (!splatBoundsFound) {
        splatMesh.traverse((child) => {
            if (child.geometry) {
                try {
                    if (!child.geometry.boundingBox) {
                        child.geometry.computeBoundingBox();
                    }
                    if (child.geometry.boundingBox) {
                        const childBox = child.geometry.boundingBox.clone();
                        child.updateMatrixWorld(true);
                        childBox.applyMatrix4(child.matrixWorld);
                        splatBox.union(childBox);
                        splatBoundsFound = true;
                    }
                } catch (e) {}
            }
        });
    }

    // Final fallback: use splat position as center with reasonable default size
    if (!splatBoundsFound || splatBox.isEmpty()) {
        console.log('Using fallback splat bounds estimation');
        // Use a reasonable default size based on typical gaussian splat dimensions
        const size = 2.0 * Math.max(splatMesh.scale.x, splatMesh.scale.y, splatMesh.scale.z);
        splatBox.setFromCenterAndSize(
            splatMesh.position.clone(),
            new THREE.Vector3(size, size, size)
        );
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
