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
import { CAMERA } from './constants.js';
import { Logger, notify } from './utilities.js';
import {
    showLoading, hideLoading, updateProgress,
    setDisplayMode, setupCollapsibles, addListener,
    setupKeyboardShortcuts, applyControlsVisibility
} from './ui-controller.js';
import {
    loadArchiveFromFile, processArchive,
    updateModelOpacity, updateModelWireframe, updateModelTextures,
    updatePointcloudPointSize, updatePointcloudOpacity
} from './file-handlers.js';
import {
    showMetadataSidebar, hideMetadataSidebar,
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
    flyModeActive: false
};

// =============================================================================
// INITIALIZATION
// =============================================================================

export async function init() {
    log.info('Kiosk viewer initializing...');

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
            hideAnnotationPopup();
            currentPopupAnnotationId = null;
            annotationSystem.selectedAnnotation = null;
            document.querySelectorAll('.annotation-marker.selected').forEach(m => m.classList.remove('selected'));
            document.querySelectorAll('.annotation-chip.active').forEach(c => c.classList.remove('active'));
            return;
        }
        currentPopupAnnotationId = showAnnotationPopup(annotation);
    };

    // Wire up UI
    setupViewerUI();
    setupMetadataSidebar({});
    setupCollapsibles();
    setupViewerKeyboardShortcuts();

    // Apply initial display mode from config
    const config = window.APP_CONFIG || {};
    if (config.initialViewMode) {
        state.displayMode = config.initialViewMode;
    }
    setDisplayMode(state.displayMode, createDisplayModeDeps());

    // Show controls toggle button, start with panel hidden
    const toggleBtn = document.getElementById('btn-toggle-controls');
    if (toggleBtn) toggleBtn.style.display = '';
    applyControlsVisibility(false);

    // Hide editor-only UI
    hideEditorOnlyUI();

    // Handle window resize
    window.addEventListener('resize', onWindowResize);

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
    if (picker) picker.classList.remove('hidden');

    const btn = document.getElementById('kiosk-picker-btn');
    const input = document.getElementById('kiosk-picker-input');
    const dropZone = document.getElementById('kiosk-drop-zone');

    if (btn && input) {
        btn.addEventListener('click', () => input.click());
        input.addEventListener('change', (e) => {
            if (e.target.files.length > 0) {
                hidePicker();
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

// =============================================================================
// ARCHIVE PROCESSING
// =============================================================================

async function handleArchiveFile(file) {
    log.info('Loading archive:', file.name);
    showLoading('Loading archive...', true);

    try {
        updateProgress(10, 'Extracting archive...');
        const archiveLoader = await loadArchiveFromFile(file, { state });

        updateProgress(30, 'Loading 3D assets...');
        const result = await processArchive(archiveLoader, file.name, createArchiveDeps());

        // Apply global alignment if present
        if (result.globalAlignment) {
            applyGlobalAlignment(result.globalAlignment);
        }

        // Load annotations
        if (result.annotations && result.annotations.length > 0) {
            annotationSystem.fromJSON(result.annotations);
            populateAnnotationBar();
            log.info(`Loaded ${result.annotations.length} annotations`);
        }

        // Update metadata display
        updateProgress(80, 'Loading metadata...');
        updateArchiveMetadataUI(result.manifest, archiveLoader);
        prefillMetadataFromArchive(result.manifest);
        populateMetadataDisplay({ state, annotationSystem });

        // Set display mode based on what was loaded
        updateProgress(90, 'Finalizing...');
        if (result.loadedSplat && result.loadedMesh) {
            state.displayMode = 'both';
        } else if (result.loadedSplat) {
            state.displayMode = 'splat';
        } else if (result.loadedMesh) {
            state.displayMode = 'model';
        }
        setDisplayMode(state.displayMode, createDisplayModeDeps());

        // Update state flags and show only relevant settings
        state.splatLoaded = !!result.loadedSplat;
        state.modelLoaded = !!result.loadedMesh;
        state.pointcloudLoaded = pointcloudGroup && pointcloudGroup.children.length > 0;
        showRelevantSettings(state.splatLoaded, state.modelLoaded, state.pointcloudLoaded);

        // Fit camera to loaded content
        fitCameraToScene();

        // Update info panel
        updateInfoPanel();

        // Show archive info section
        const archiveSection = document.getElementById('archive-metadata-section');
        if (archiveSection) archiveSection.style.display = '';

        if (result.errors.length > 0) {
            result.errors.forEach(err => notify.warning(err));
        }

        updateProgress(100, 'Complete');
        hideLoading();

        // Show toolbar now that archive is loaded
        const toolbar = document.getElementById('left-toolbar');
        if (toolbar) toolbar.style.display = '';

        // Open metadata sidebar by default
        showMetadataSidebar('view');

        log.info('Archive loaded successfully:', file.name);
        notify.success(`Loaded: ${file.name}`);

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
            if (splatMesh) splatMesh.visible = showSplat;
            if (modelGroup) modelGroup.visible = showModel;
            if (pointcloudGroup) pointcloudGroup.visible = showModel;
        }
    };
}

// =============================================================================
// UI SETUP
// =============================================================================

function setupViewerUI() {
    // Toggle controls panel
    addListener('btn-toggle-controls', 'click', () => {
        state.controlsVisible = !state.controlsVisible;
        applyControlsVisibility(state.controlsVisible);
    });

    // Display mode buttons
    ['model', 'splat', 'pointcloud', 'both', 'split'].forEach(mode => {
        addListener(`btn-${mode}`, 'click', () => {
            state.displayMode = mode;
            setDisplayMode(mode, createDisplayModeDeps());
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
            showMetadataSidebar('view', { state, annotationSystem });
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
}

function setupViewerKeyboardShortcuts() {
    setupKeyboardShortcuts({
        'f': () => toggleFlyMode(),
        'm': () => {
            const sidebar = document.getElementById('metadata-sidebar');
            if (sidebar && !sidebar.classList.contains('hidden')) {
                hideMetadataSidebar();
            } else {
                showMetadataSidebar('view', { state, annotationSystem });
            }
        },
        '1': () => { state.displayMode = 'model'; setDisplayMode('model', createDisplayModeDeps()); },
        '2': () => { state.displayMode = 'splat'; setDisplayMode('splat', createDisplayModeDeps()); },
        '3': () => { state.displayMode = 'both'; setDisplayMode('both', createDisplayModeDeps()); },
        '4': () => { state.displayMode = 'split'; setDisplayMode('split', createDisplayModeDeps()); },
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
    const maxDim = Math.max(size.x, size.y, size.z);
    const distance = maxDim * 1.5;

    camera.position.copy(center);
    camera.position.z += distance;
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

function populateAnnotationBar() {
    const bar = document.getElementById('annotation-bar');
    const chips = document.getElementById('annotation-chips');
    if (!bar || !chips) return;

    const annotations = annotationSystem.getAnnotations();
    if (annotations.length === 0) return;

    chips.innerHTML = '';
    annotations.forEach((anno, i) => {
        const chip = document.createElement('button');
        chip.className = 'annotation-chip';
        chip.textContent = `${i + 1}. ${anno.title}`;
        chip.addEventListener('click', () => {
            if (currentPopupAnnotationId === anno.id) {
                hideAnnotationPopup();
                currentPopupAnnotationId = null;
                annotationSystem.selectedAnnotation = null;
                document.querySelectorAll('.annotation-marker.selected').forEach(m => m.classList.remove('selected'));
                document.querySelectorAll('.annotation-chip.active').forEach(c => c.classList.remove('active'));
            } else {
                annotationSystem.goToAnnotation(anno.id);
                currentPopupAnnotationId = showAnnotationPopup(anno);
            }
        });
        chips.appendChild(chip);
    });

    bar.classList.remove('hidden');
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

    // Hide editor-only toolbar buttons (stay hidden even after toolbar is shown)
    hideEl('btn-annotate');
    hideEl('btn-export-archive');

    // Hide editor-only control sections
    hideEl('load-files-section');

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

    // Rename View tab to Information
    const viewTab = document.querySelector('.sidebar-mode-tab[data-mode="view"]');
    if (viewTab) viewTab.textContent = 'Information';
}

function hideEl(id) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}

/**
 * Show only settings sections and display mode buttons relevant to the loaded data.
 */
function showRelevantSettings(hasSplat, hasMesh, hasPointcloud) {
    // Hide settings sections for absent data types (found by header text)
    const sections = document.querySelectorAll('#controls-panel .control-section.collapsible');
    sections.forEach(section => {
        const header = section.querySelector('h3');
        const text = header?.textContent?.trim().toLowerCase() || '';
        if (text.startsWith('model settings') && !hasMesh) section.style.display = 'none';
        if (text.startsWith('splat settings') && !hasSplat) section.style.display = 'none';
        if (text.startsWith('point cloud settings') && !hasPointcloud) section.style.display = 'none';
    });

    // Hide display mode buttons for absent data types
    if (!hasMesh) hideEl('btn-model');
    if (!hasSplat) hideEl('btn-splat');
    if (!hasPointcloud) hideEl('btn-pointcloud');
    if (!hasMesh || !hasSplat) { hideEl('btn-both'); hideEl('btn-split'); }

    // Hide entire Display Mode section if 0 or 1 button visible
    const displaySection = [...document.querySelectorAll('#controls-panel .control-section')]
        .find(s => s.querySelector('h3')?.textContent?.trim() === 'Display Mode');
    if (displaySection) {
        const visibleButtons = displaySection.querySelectorAll('.toggle-btn:not([style*="display: none"])');
        if (visibleButtons.length <= 1) displaySection.style.display = 'none';
    }
}

// =============================================================================
// WINDOW RESIZE
// =============================================================================

function onWindowResize() {
    const container = document.getElementById('viewer-container');
    if (!container) return;
    sceneManager.onWindowResize(state.displayMode, container);
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

        // Update annotation marker screen positions
        if (annotationSystem.hasAnnotations()) {
            annotationSystem.updateMarkerPositions();
            updateAnnotationPopupPosition(currentPopupAnnotationId);
        }

        sceneManager.updateFPS(fpsElement);
    } catch (e) {
        // Silently handle animation errors to keep the loop running
    }
}
