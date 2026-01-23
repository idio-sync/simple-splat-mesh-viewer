import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { SplatMesh } from '@sparkjsdev/spark';

// Get configuration from window (set by config.js)
const config = window.APP_CONFIG || {
    defaultSplatUrl: '',
    defaultModelUrl: '',
    showControls: true
};

// Global state
const state = {
    displayMode: 'both', // 'splat', 'model', 'both'
    selectedObject: 'none', // 'splat', 'model', 'none'
    transformMode: 'translate', // 'translate', 'rotate', 'scale'
    splatLoaded: false,
    modelLoaded: false,
    modelOpacity: 1,
    modelWireframe: false,
    controlsVisible: config.showControls
};

// Three.js objects
let scene, camera, renderer, controls, transformControls;
let splatMesh = null;
let modelGroup = null;
let ambientLight, hemisphereLight, directionalLight1, directionalLight2;

// DOM elements
const canvas = document.getElementById('viewer-canvas');
const loadingOverlay = document.getElementById('loading-overlay');
const loadingText = document.getElementById('loading-text');

// Initialize the scene
function init() {
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

    // Renderer
    renderer = new THREE.WebGLRenderer({
        canvas: canvas,
        antialias: true
    });
    renderer.setSize(canvas.clientWidth, canvas.clientHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    // Orbit Controls
    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.1;
    controls.maxDistance = 100;

    // Transform Controls
    transformControls = new TransformControls(camera, renderer.domElement);
    transformControls.addEventListener('dragging-changed', (event) => {
        controls.enabled = !event.value;
    });
    transformControls.addEventListener('objectChange', () => {
        updateTransformInputs();
    });
    scene.add(transformControls);

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

    // Apply initial controls visibility
    applyControlsVisibility();

    // Load default files if configured
    loadDefaultFiles();

    // Start render loop
    animate();
}

function onWindowResize() {
    const container = document.getElementById('viewer-container');
    camera.aspect = container.clientWidth / container.clientHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(container.clientWidth, container.clientHeight);
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
    // Controls panel toggle
    document.getElementById('btn-toggle-controls').addEventListener('click', toggleControlsPanel);

    // Display mode toggles
    document.getElementById('btn-splat').addEventListener('click', () => setDisplayMode('splat'));
    document.getElementById('btn-model').addEventListener('click', () => setDisplayMode('model'));
    document.getElementById('btn-both').addEventListener('click', () => setDisplayMode('both'));

    // Selection toggles
    document.getElementById('btn-select-splat').addEventListener('click', () => setSelectedObject('splat'));
    document.getElementById('btn-select-model').addEventListener('click', () => setSelectedObject('model'));
    document.getElementById('btn-select-none').addEventListener('click', () => setSelectedObject('none'));

    // Transform mode toggles
    document.getElementById('btn-translate').addEventListener('click', () => setTransformMode('translate'));
    document.getElementById('btn-rotate').addEventListener('click', () => setTransformMode('rotate'));
    document.getElementById('btn-scale').addEventListener('click', () => setTransformMode('scale'));

    // File inputs
    document.getElementById('splat-input').addEventListener('change', handleSplatFile);
    document.getElementById('model-input').addEventListener('change', handleModelFile);

    // Splat settings
    document.getElementById('splat-scale').addEventListener('input', (e) => {
        const scale = parseFloat(e.target.value);
        document.getElementById('splat-scale-value').textContent = scale.toFixed(1);
        if (splatMesh) {
            splatMesh.scale.setScalar(scale);
        }
    });

    // Splat position inputs
    ['x', 'y', 'z'].forEach(axis => {
        document.getElementById(`splat-pos-${axis}`).addEventListener('change', (e) => {
            if (splatMesh) {
                splatMesh.position[axis] = parseFloat(e.target.value) || 0;
            }
        });
        document.getElementById(`splat-rot-${axis}`).addEventListener('change', (e) => {
            if (splatMesh) {
                splatMesh.rotation[axis] = THREE.MathUtils.degToRad(parseFloat(e.target.value) || 0);
            }
        });
    });

    // Model settings
    document.getElementById('model-scale').addEventListener('input', (e) => {
        const scale = parseFloat(e.target.value);
        document.getElementById('model-scale-value').textContent = scale.toFixed(1);
        if (modelGroup) {
            modelGroup.scale.setScalar(scale);
        }
    });

    document.getElementById('model-opacity').addEventListener('input', (e) => {
        state.modelOpacity = parseFloat(e.target.value);
        document.getElementById('model-opacity-value').textContent = state.modelOpacity.toFixed(2);
        updateModelOpacity();
    });

    document.getElementById('model-wireframe').addEventListener('change', (e) => {
        state.modelWireframe = e.target.checked;
        updateModelWireframe();
    });

    // Model position inputs
    ['x', 'y', 'z'].forEach(axis => {
        document.getElementById(`model-pos-${axis}`).addEventListener('change', (e) => {
            if (modelGroup) {
                modelGroup.position[axis] = parseFloat(e.target.value) || 0;
            }
        });
        document.getElementById(`model-rot-${axis}`).addEventListener('change', (e) => {
            if (modelGroup) {
                modelGroup.rotation[axis] = THREE.MathUtils.degToRad(parseFloat(e.target.value) || 0);
            }
        });
    });

    // Alignment buttons
    document.getElementById('btn-save-alignment').addEventListener('click', saveAlignment);
    document.getElementById('btn-load-alignment').addEventListener('click', () => {
        document.getElementById('alignment-input').click();
    });
    document.getElementById('alignment-input').addEventListener('change', loadAlignment);
    document.getElementById('btn-reset-alignment').addEventListener('click', resetAlignment);

    // Camera buttons
    document.getElementById('btn-reset-camera').addEventListener('click', resetCamera);
    document.getElementById('btn-fit-view').addEventListener('click', fitToView);

    // Lighting controls
    document.getElementById('ambient-intensity').addEventListener('input', (e) => {
        const intensity = parseFloat(e.target.value);
        document.getElementById('ambient-intensity-value').textContent = intensity.toFixed(1);
        if (ambientLight) ambientLight.intensity = intensity;
    });

    document.getElementById('hemisphere-intensity').addEventListener('input', (e) => {
        const intensity = parseFloat(e.target.value);
        document.getElementById('hemisphere-intensity-value').textContent = intensity.toFixed(1);
        if (hemisphereLight) hemisphereLight.intensity = intensity;
    });

    document.getElementById('directional1-intensity').addEventListener('input', (e) => {
        const intensity = parseFloat(e.target.value);
        document.getElementById('directional1-intensity-value').textContent = intensity.toFixed(1);
        if (directionalLight1) directionalLight1.intensity = intensity;
    });

    document.getElementById('directional2-intensity').addEventListener('input', (e) => {
        const intensity = parseFloat(e.target.value);
        document.getElementById('directional2-intensity-value').textContent = intensity.toFixed(1);
        if (directionalLight2) directionalLight2.intensity = intensity;
    });

    // Auto align button
    document.getElementById('btn-auto-align').addEventListener('click', autoAlignObjects);

    // Setup collapsible sections
    setupCollapsibles();
}

function setDisplayMode(mode) {
    state.displayMode = mode;

    // Update button states
    ['splat', 'model', 'both'].forEach(m => {
        document.getElementById(`btn-${m}`).classList.toggle('active', m === mode);
    });

    updateVisibility();
}

function setSelectedObject(selection) {
    state.selectedObject = selection;

    // Update button states
    ['splat', 'model', 'none'].forEach(s => {
        document.getElementById(`btn-select-${s}`).classList.toggle('active', s === selection);
    });

    // Attach transform controls
    transformControls.detach();
    if (selection === 'splat' && splatMesh) {
        transformControls.attach(splatMesh);
    } else if (selection === 'model' && modelGroup && modelGroup.children.length > 0) {
        transformControls.attach(modelGroup);
    }
}

function setTransformMode(mode) {
    state.transformMode = mode;
    transformControls.setMode(mode);

    // Update button states
    ['translate', 'rotate', 'scale'].forEach(m => {
        const btnId = m === 'translate' ? 'btn-translate' : m === 'rotate' ? 'btn-rotate' : 'btn-scale';
        document.getElementById(btnId).classList.toggle('active', m === mode);
    });
}

function updateVisibility() {
    const showSplat = state.displayMode === 'splat' || state.displayMode === 'both';
    const showModel = state.displayMode === 'model' || state.displayMode === 'both';

    if (splatMesh) {
        splatMesh.visible = showSplat;
    }

    if (modelGroup) {
        modelGroup.visible = showModel;
    }
}

function updateTransformInputs() {
    // Update splat inputs
    if (splatMesh) {
        document.getElementById('splat-pos-x').value = splatMesh.position.x.toFixed(2);
        document.getElementById('splat-pos-y').value = splatMesh.position.y.toFixed(2);
        document.getElementById('splat-pos-z').value = splatMesh.position.z.toFixed(2);
        document.getElementById('splat-rot-x').value = THREE.MathUtils.radToDeg(splatMesh.rotation.x).toFixed(1);
        document.getElementById('splat-rot-y').value = THREE.MathUtils.radToDeg(splatMesh.rotation.y).toFixed(1);
        document.getElementById('splat-rot-z').value = THREE.MathUtils.radToDeg(splatMesh.rotation.z).toFixed(1);
        document.getElementById('splat-scale').value = splatMesh.scale.x;
        document.getElementById('splat-scale-value').textContent = splatMesh.scale.x.toFixed(1);
    }

    // Update model inputs
    if (modelGroup) {
        document.getElementById('model-pos-x').value = modelGroup.position.x.toFixed(2);
        document.getElementById('model-pos-y').value = modelGroup.position.y.toFixed(2);
        document.getElementById('model-pos-z').value = modelGroup.position.z.toFixed(2);
        document.getElementById('model-rot-x').value = THREE.MathUtils.radToDeg(modelGroup.rotation.x).toFixed(1);
        document.getElementById('model-rot-y').value = THREE.MathUtils.radToDeg(modelGroup.rotation.y).toFixed(1);
        document.getElementById('model-rot-z').value = THREE.MathUtils.radToDeg(modelGroup.rotation.z).toFixed(1);
        document.getElementById('model-scale').value = modelGroup.scale.x;
        document.getElementById('model-scale-value').textContent = modelGroup.scale.x.toFixed(1);
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

        // Wait for the splat to load
        await new Promise((resolve, reject) => {
            const checkLoaded = setInterval(() => {
                // SplatMesh should be ready when added to scene
                // We'll give it a moment to initialize
                clearInterval(checkLoaded);
                resolve();
            }, 100);

            // Timeout after 30 seconds
            setTimeout(() => {
                clearInterval(checkLoaded);
                resolve(); // Resolve anyway, splat might still load
            }, 30000);
        });

        scene.add(splatMesh);

        // Clean up URL after a delay
        setTimeout(() => URL.revokeObjectURL(fileUrl), 5000);

        state.splatLoaded = true;
        updateVisibility();
        updateTransformInputs();

        // Update info - Spark doesn't expose count directly, show file name
        document.getElementById('splat-vertices').textContent = 'Loaded';

        // Auto-align if model is already loaded
        if (state.modelLoaded) {
            setTimeout(() => autoAlignObjects(), 100);
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
                setTimeout(() => autoAlignObjects(), 100);
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

                        // Convert MeshBasicMaterial to MeshStandardMaterial for lighting support
                        if (child.material && child.material.isMeshBasicMaterial) {
                            const oldMaterial = child.material;
                            child.material = new THREE.MeshStandardMaterial({
                                color: oldMaterial.color,
                                map: oldMaterial.map,
                                alphaMap: oldMaterial.alphaMap,
                                transparent: oldMaterial.transparent,
                                opacity: oldMaterial.opacity,
                                side: oldMaterial.side,
                                metalness: 0.1,
                                roughness: 0.8
                            });
                            oldMaterial.dispose();
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
    return new Promise(async (resolve, reject) => {
        const objUrl = URL.createObjectURL(objFile);

        try {
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

                                // Ensure normals exist for proper lighting
                                object.traverse((child) => {
                                    if (child.isMesh && child.geometry && !child.geometry.attributes.normal) {
                                        child.geometry.computeVertexNormals();
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
        } catch (error) {
            URL.revokeObjectURL(objUrl);
            reject(error);
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
}

function resetCamera() {
    camera.position.set(0, 1, 3);
    camera.lookAt(0, 0, 0);
    controls.target.set(0, 0, 0);
    controls.update();
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
}

// Controls panel visibility
function toggleControlsPanel() {
    state.controlsVisible = !state.controlsVisible;
    applyControlsVisibility();
}

function applyControlsVisibility() {
    const controlsPanel = document.getElementById('controls-panel');
    const toggleBtn = document.getElementById('btn-toggle-controls');

    if (state.controlsVisible) {
        controlsPanel.classList.remove('hidden');
        toggleBtn.classList.remove('controls-hidden');
    } else {
        controlsPanel.classList.add('hidden');
        toggleBtn.classList.add('controls-hidden');
    }

    // Trigger resize to adjust canvas
    setTimeout(onWindowResize, 10);
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

        // Wait a moment for initialization
        await new Promise(resolve => setTimeout(resolve, 100));

        scene.add(splatMesh);

        state.splatLoaded = true;
        updateVisibility();
        updateTransformInputs();

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

                        // Convert MeshBasicMaterial to MeshStandardMaterial for lighting support
                        if (child.material && child.material.isMeshBasicMaterial) {
                            const oldMaterial = child.material;
                            child.material = new THREE.MeshStandardMaterial({
                                color: oldMaterial.color,
                                map: oldMaterial.map,
                                alphaMap: oldMaterial.alphaMap,
                                transparent: oldMaterial.transparent,
                                opacity: oldMaterial.opacity,
                                side: oldMaterial.side,
                                metalness: 0.1,
                                roughness: 0.8
                            });
                            oldMaterial.dispose();
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

                        if (!child.material) {
                            child.material = new THREE.MeshStandardMaterial({
                                color: 0x888888,
                                metalness: 0.1,
                                roughness: 0.8
                            });
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
        header.addEventListener('click', () => {
            const section = header.closest('.control-section');
            section.classList.toggle('collapsed');
        });
    });
}

// Auto align objects
function autoAlignObjects() {
    if (!splatMesh && !modelGroup) {
        alert('Load both a splat and a model first');
        return;
    }

    const splatBox = new THREE.Box3();
    const modelBox = new THREE.Box3();
    let hasSplat = false;
    let hasModel = false;

    // Get splat bounds
    if (splatMesh) {
        const size = 2 * splatMesh.scale.x;
        splatBox.setFromCenterAndSize(
            splatMesh.position,
            new THREE.Vector3(size, size, size)
        );
        hasSplat = true;
    }

    // Get model bounds
    if (modelGroup && modelGroup.children.length > 0) {
        modelGroup.traverse((child) => {
            if (child.isMesh) {
                modelBox.expandByObject(child);
                hasModel = true;
            }
        });
    }

    if (!hasSplat || !hasModel) {
        alert('Both splat and model must be loaded for auto-alignment');
        return;
    }

    // Calculate centers
    const splatCenter = splatBox.getCenter(new THREE.Vector3());
    const modelCenter = modelBox.getCenter(new THREE.Vector3());

    // Calculate offset needed to align centers
    const offset = new THREE.Vector3().subVectors(splatCenter, modelCenter);

    // Apply offset to model (keeping splat in place)
    modelGroup.position.add(offset);

    updateTransformInputs();
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
function animate() {
    requestAnimationFrame(animate);
    controls.update();
    renderer.render(scene, camera);
    updateFPS();
}

// Initialize when DOM is ready
init();
