/**
 * Event Wiring Module
 *
 * Extracted from main.js — contains setupUIEvents(), the central function
 * that binds all DOM elements to their event handlers.
 *
 * Phase 2, Step 2.5 of main.js refactor.
 */

import * as THREE from 'three';
import { Logger, notify } from './utilities.js';
import { ENVIRONMENT } from './constants.js';
import {
    addListener,
    setupCollapsibles,
    activateTool,
    hideExportPanel,
    showLoading,
    hideLoading
} from './ui-controller.js';
import {
    addCustomField,
    setupMetadataTabs,
    setupLicenseField
} from './metadata-manager.js';
import {
    updatePointcloudPointSize,
    updatePointcloudOpacity,
    updateModelTextures
} from './file-handlers.js';
import type { EventWiringDeps } from '@/types.js';

const log = Logger.getLogger('event-wiring');

// ============================================================
// MAIN EXPORT
// ============================================================

export function setupUIEvents(deps: EventWiringDeps): void {
    const { sceneRefs, state, sceneManager } = deps;

    log.info(' Setting up UI events...');

    // ─── Tool rail — pane switching ─────────────────────────
    document.querySelectorAll('#tool-rail .tool-btn[data-tool]').forEach(btn => {
        btn.addEventListener('click', () => {
            const tool = (btn as HTMLElement).dataset.tool;
            if (!tool) return;
            // Fullscreen is action-only — handled by setupFullscreen()
            if (tool === 'fullscreen') return;
            activateTool(tool);
            // Show/hide transform gizmo and orbit center line based on active tool
            if (sceneRefs.transformControls) {
                try {
                    sceneRefs.transformControls.getHelper().visible = (tool === 'transform');
                    sceneRefs.transformControls.enabled = (tool === 'transform');
                } catch { /* ignore */ }
            }
            if (tool === 'transform') {
                sceneManager.showOrbitCenterLine(sceneRefs.controls.target);
            } else {
                sceneManager.hideOrbitCenterLine();
            }
            // Auto-select first loaded object when opening transform pane with no selection
            if (tool === 'transform' && state.selectedObject === 'none') {
                if (sceneRefs.splatMesh) {
                    deps.transform.setSelectedObject('splat' as any);
                } else if (sceneRefs.modelGroup && sceneRefs.modelGroup.children.length > 0) {
                    deps.transform.setSelectedObject('model' as any);
                }
            }
            // Cross-section: activate when entering, deactivate when leaving
            if (tool === 'crosssection') {
                if (!deps.crossSection.active) {
                    const box = new THREE.Box3();
                    box.expandByObject(sceneRefs.modelGroup);
                    box.expandByObject(sceneRefs.pointcloudGroup);
                    const center = box.isEmpty() ? new THREE.Vector3() : new THREE.Vector3();
                    if (!box.isEmpty()) box.getCenter(center);
                    sceneManager.setLocalClippingEnabled(true);
                    deps.crossSection.start(center);
                }
            } else if (deps.crossSection.active) {
                deps.crossSection.stop();
                sceneManager.setLocalClippingEnabled(false);
            }
        });
    });

    // ─── Display mode toggles ────────────────────────────────
    addListener('btn-splat', 'click', () => deps.display.setDisplayMode('splat'));
    addListener('btn-model', 'click', () => deps.display.setDisplayMode('model'));
    addListener('btn-pointcloud', 'click', () => deps.display.setDisplayMode('pointcloud'));
    addListener('btn-both', 'click', () => deps.display.setDisplayMode('both'));
    addListener('btn-split', 'click', () => deps.display.setDisplayMode('split'));
    addListener('btn-stl', 'click', () => deps.display.setDisplayMode('stl'));

    // ─── File inputs ─────────────────────────────────────────
    addListener('splat-input', 'change', deps.files.handleSplatFile);
    addListener('model-input', 'change', deps.files.handleModelFile);
    addListener('archive-input', 'change', deps.files.handleArchiveFile);
    addListener('pointcloud-input', 'change', deps.files.handlePointcloudFile);
    addListener('proxy-mesh-input', 'change', deps.files.handleProxyMeshFile);
    addListener('proxy-splat-input', 'change', deps.files.handleProxySplatFile);
    addListener('stl-input', 'change', deps.files.handleSTLFile);
    addListener('btn-load-stl-url', 'click', deps.files.handleLoadSTLFromUrlPrompt);
    addListener('source-files-input', 'change', deps.files.handleSourceFilesInput);
    addListener('btn-load-pointcloud-url', 'click', deps.files.handleLoadPointcloudFromUrlPrompt);
    addListener('btn-load-archive-url', 'click', deps.files.handleLoadArchiveFromUrlPrompt);
    addListener('btn-load-full-res', 'click', deps.files.handleLoadFullResMesh);
    addListener('proxy-load-full-link', 'click', (e: Event) => { e.preventDefault(); deps.files.handleLoadFullResMesh(); });
    addListener('btn-quality-sd', 'click', () => deps.files.switchQualityTier('sd'));
    addListener('btn-quality-hd', 'click', () => deps.files.switchQualityTier('hd'));

    // ─── Tauri native file dialogs ───────────────────────────
    deps.tauri.wireNativeDialogsIfAvailable();

    // ─── URL load buttons ────────────────────────────────────
    const splatUrlBtn = document.getElementById('btn-load-splat-url');
    const modelUrlBtn = document.getElementById('btn-load-model-url');
    log.info(' URL buttons found - splat:', !!splatUrlBtn, 'model:', !!modelUrlBtn);

    if (splatUrlBtn) {
        splatUrlBtn.addEventListener('click', deps.files.handleLoadSplatFromUrlPrompt);
    }
    if (modelUrlBtn) {
        modelUrlBtn.addEventListener('click', deps.files.handleLoadModelFromUrlPrompt);
    }

    // ─── Splat settings ──────────────────────────────────────
    addListener('splat-scale', 'input', (e: Event) => {
        const scale = parseFloat((e.target as HTMLInputElement).value);
        const valueEl = document.getElementById('splat-scale-value');
        if (valueEl) valueEl.textContent = scale.toFixed(1);
        if (sceneRefs.splatMesh) {
            sceneRefs.splatMesh.scale.setScalar(scale);
        }
    });


    // ─── Model settings ──────────────────────────────────────
    addListener('model-scale', 'input', (e: Event) => {
        const scale = parseFloat((e.target as HTMLInputElement).value);
        const valueEl = document.getElementById('model-scale-value');
        if (valueEl) valueEl.textContent = scale.toFixed(1);
        if (sceneRefs.modelGroup) {
            sceneRefs.modelGroup.scale.setScalar(scale);
        }
    });

    addListener('model-opacity', 'input', (e: Event) => {
        state.modelOpacity = parseFloat((e.target as HTMLInputElement).value);
        const valueEl = document.getElementById('model-opacity-value');
        if (valueEl) valueEl.textContent = state.modelOpacity.toFixed(2);
        deps.display.updateModelOpacity();
    });

    // --- Debug view checkboxes with mutual exclusion ---

    addListener('model-wireframe', 'change', (e: Event) => {
        state.modelWireframe = (e.target as HTMLInputElement).checked;
        if ((e.target as HTMLInputElement).checked) {
            clearDebugViews(state, deps, 'wireframe');
        }
        deps.display.updateModelWireframe();
    });

    addListener('model-matcap', 'change', (e: Event) => {
        state.modelMatcap = (e.target as HTMLInputElement).checked;
        const styleGroup = document.getElementById('matcap-style-group');
        if (styleGroup) styleGroup.style.display = (e.target as HTMLInputElement).checked ? '' : 'none';
        if ((e.target as HTMLInputElement).checked) {
            clearDebugViews(state, deps, 'matcap');
        }
        deps.display.updateModelMatcap();
    });

    addListener('matcap-style', 'change', (e: Event) => {
        state.matcapStyle = (e.target as HTMLSelectElement).value;
        if (state.modelMatcap) deps.display.updateModelMatcap();
    });

    addListener('model-normals', 'change', (e: Event) => {
        state.modelNormals = (e.target as HTMLInputElement).checked;
        if ((e.target as HTMLInputElement).checked) {
            clearDebugViews(state, deps, 'normals');
        }
        deps.display.updateModelNormals();
    });

    addListener('model-roughness', 'change', (e: Event) => {
        state.modelRoughness = (e.target as HTMLInputElement).checked;
        if ((e.target as HTMLInputElement).checked) {
            clearDebugViews(state, deps, 'roughness');
        }
        deps.display.updateModelRoughnessView();
    });

    addListener('model-metalness', 'change', (e: Event) => {
        state.modelMetalness = (e.target as HTMLInputElement).checked;
        if ((e.target as HTMLInputElement).checked) {
            clearDebugViews(state, deps, 'metalness');
        }
        deps.display.updateModelMetalnessView();
    });

    addListener('model-specular-f0', 'change', (e: Event) => {
        state.modelSpecularF0 = (e.target as HTMLInputElement).checked;
        if ((e.target as HTMLInputElement).checked) {
            clearDebugViews(state, deps, 'specularF0');
        }
        deps.display.updateModelSpecularF0View();
    });

    addListener('model-no-texture', 'change', (e: Event) => {
        updateModelTextures(sceneRefs.modelGroup, !(e.target as HTMLInputElement).checked);
    });


    // ─── Point cloud settings ────────────────────────────────
    addListener('pointcloud-scale', 'input', (e: Event) => {
        const scale = parseFloat((e.target as HTMLInputElement).value);
        const valueEl = document.getElementById('pointcloud-scale-value');
        if (valueEl) valueEl.textContent = scale.toFixed(1);
        if (sceneRefs.pointcloudGroup) {
            sceneRefs.pointcloudGroup.scale.setScalar(scale);
        }
    });

    addListener('pointcloud-point-size', 'input', (e: Event) => {
        state.pointcloudPointSize = parseFloat((e.target as HTMLInputElement).value);
        const valueEl = document.getElementById('pointcloud-point-size-value');
        if (valueEl) valueEl.textContent = state.pointcloudPointSize.toFixed(3);
        updatePointcloudPointSize(sceneRefs.pointcloudGroup, state.pointcloudPointSize);
    });

    addListener('pointcloud-opacity', 'input', (e: Event) => {
        state.pointcloudOpacity = parseFloat((e.target as HTMLInputElement).value);
        const valueEl = document.getElementById('pointcloud-opacity-value');
        if (valueEl) valueEl.textContent = state.pointcloudOpacity.toFixed(2);
        updatePointcloudOpacity(sceneRefs.pointcloudGroup, state.pointcloudOpacity);
    });


    // ─── Alignment ───────────────────────────────────────────
    addListener('btn-center-at-origin', 'click', deps.alignment.centerAtOrigin);
    addListener('btn-reset-alignment', 'click', deps.alignment.resetAlignment);

    // ─── Share ───────────────────────────────────────────────
    addListener('btn-share', 'click', deps.share.copyShareLink);

    // ─── Preview kiosk mode ──────────────────────────────────
    addListener('btn-preview-kiosk', 'click', () => {
        const url = new URL(window.location.href);
        url.searchParams.set('kiosk', 'true');
        window.open(url.toString(), '_blank');
    });

    // ─── Camera buttons ──────────────────────────────────────
    addListener('btn-reset-camera', 'click', deps.camera.resetCamera);
    addListener('btn-fit-view', 'click', deps.camera.fitToView);

    // ─── Lighting controls ───────────────────────────────────
    addListener('ambient-intensity', 'input', (e: Event) => {
        const intensity = parseFloat((e.target as HTMLInputElement).value);
        const valueEl = document.getElementById('ambient-intensity-value');
        if (valueEl) valueEl.textContent = intensity.toFixed(1);
        if (sceneRefs.ambientLight) sceneRefs.ambientLight.intensity = intensity;
    });

    addListener('hemisphere-intensity', 'input', (e: Event) => {
        const intensity = parseFloat((e.target as HTMLInputElement).value);
        const valueEl = document.getElementById('hemisphere-intensity-value');
        if (valueEl) valueEl.textContent = intensity.toFixed(1);
        if (sceneRefs.hemisphereLight) sceneRefs.hemisphereLight.intensity = intensity;
    });

    addListener('directional1-intensity', 'input', (e: Event) => {
        const intensity = parseFloat((e.target as HTMLInputElement).value);
        const valueEl = document.getElementById('directional1-intensity-value');
        if (valueEl) valueEl.textContent = intensity.toFixed(1);
        if (sceneRefs.directionalLight1) sceneRefs.directionalLight1.intensity = intensity;
    });

    addListener('directional2-intensity', 'input', (e: Event) => {
        const intensity = parseFloat((e.target as HTMLInputElement).value);
        const valueEl = document.getElementById('directional2-intensity-value');
        if (valueEl) valueEl.textContent = intensity.toFixed(1);
        if (sceneRefs.directionalLight2) sceneRefs.directionalLight2.intensity = intensity;
    });

    // ─── Transform controls ─────────────────────────────────
    addListener('btn-select-none', 'click', () => deps.transform.setSelectedObject('none' as any));
    addListener('btn-select-splat', 'click', () => deps.transform.setSelectedObject('splat' as any));
    addListener('btn-select-model', 'click', () => deps.transform.setSelectedObject('model' as any));
    addListener('btn-select-both', 'click', () => deps.transform.setSelectedObject('both' as any));
    const pivotSection = document.getElementById('rotation-pivot-section');
    const scaleLockSection = document.getElementById('scale-lock-section');
    const showModeSection = (mode: string) => {
        if (pivotSection) pivotSection.style.display = mode === 'rotate' ? '' : 'none';
        if (scaleLockSection) scaleLockSection.style.display = mode === 'scale' ? '' : 'none';
    };
    addListener('btn-translate', 'click', () => { deps.transform.setTransformMode('translate' as any); showModeSection('translate'); });
    addListener('btn-rotate', 'click', () => { deps.transform.setTransformMode('rotate' as any); showModeSection('rotate'); });
    addListener('btn-scale', 'click', () => { deps.transform.setTransformMode('scale' as any); showModeSection('scale'); });

    // ─── Rotation pivot toggle ───────────────────────────────
    addListener('btn-pivot-object', 'click', () => {
        state.rotationPivot = 'object';
        document.getElementById('btn-pivot-object')?.classList.add('active');
        document.getElementById('btn-pivot-origin')?.classList.remove('active');
    });
    addListener('btn-pivot-origin', 'click', () => {
        state.rotationPivot = 'origin';
        document.getElementById('btn-pivot-origin')?.classList.add('active');
        document.getElementById('btn-pivot-object')?.classList.remove('active');
    });

    // ─── Scale lock proportions toggle ───────────────────────
    addListener('btn-scale-locked', 'click', () => {
        state.scaleLockProportions = true;
        document.getElementById('btn-scale-locked')?.classList.add('active');
        document.getElementById('btn-scale-free')?.classList.remove('active');
    });
    addListener('btn-scale-free', 'click', () => {
        state.scaleLockProportions = false;
        document.getElementById('btn-scale-free')?.classList.add('active');
        document.getElementById('btn-scale-locked')?.classList.remove('active');
    });

    // ─── Transform pane inputs ────────────────────────────────
    (['x', 'y', 'z'] as const).forEach(axis => {
        addListener(`transform-pos-${axis}`, 'change', (e: Event) => {
            const val = parseFloat((e.target as HTMLInputElement).value) || 0;
            const sel = state.selectedObject;
            if (sel === 'splat' && sceneRefs.splatMesh) {
                (sceneRefs.splatMesh as any).position[axis] = val;
            } else if (sel === 'model' && sceneRefs.modelGroup) {
                (sceneRefs.modelGroup as any).position[axis] = val;
            } else if (sel === 'both') {
                if (sceneRefs.splatMesh) (sceneRefs.splatMesh as any).position[axis] = val;
                if (sceneRefs.modelGroup) (sceneRefs.modelGroup as any).position[axis] = val;
                if (sceneRefs.pointcloudGroup) (sceneRefs.pointcloudGroup as any).position[axis] = val;
            }
        });
        addListener(`transform-rot-${axis}`, 'change', (e: Event) => {
            const val = parseFloat((e.target as HTMLInputElement).value) || 0;
            const rad = THREE.MathUtils.degToRad(val);
            const sel = state.selectedObject;
            if (sel === 'splat' && sceneRefs.splatMesh) {
                (sceneRefs.splatMesh as any).rotation[axis] = rad;
            } else if (sel === 'model' && sceneRefs.modelGroup) {
                (sceneRefs.modelGroup as any).rotation[axis] = rad;
            } else if (sel === 'both') {
                if (sceneRefs.splatMesh) (sceneRefs.splatMesh as any).rotation[axis] = rad;
                if (sceneRefs.modelGroup) (sceneRefs.modelGroup as any).rotation[axis] = rad;
                if (sceneRefs.pointcloudGroup) (sceneRefs.pointcloudGroup as any).rotation[axis] = rad;
            }
        });
    });

    // ─── Reset transform button ──────────────────────────────
    addListener('btn-reset-transform', 'click', deps.transform.resetTransform);

    // ─── Cross-section controls ──────────────────────────────
    addListener('cs-mode-translate', 'click', () => {
        deps.crossSection.setMode('translate');
        document.getElementById('cs-mode-translate')?.classList.add('active');
        document.getElementById('cs-mode-rotate')?.classList.remove('active');
    });
    addListener('cs-mode-rotate', 'click', () => {
        deps.crossSection.setMode('rotate');
        document.getElementById('cs-mode-rotate')?.classList.add('active');
        document.getElementById('cs-mode-translate')?.classList.remove('active');
    });
    addListener('cs-axis-x', 'click', () => deps.crossSection.setAxis('x'));
    addListener('cs-axis-y', 'click', () => deps.crossSection.setAxis('y'));
    addListener('cs-axis-z', 'click', () => deps.crossSection.setAxis('z'));
    addListener('cs-flip',   'click', () => deps.crossSection.flip());
    addListener('cs-reset',  'click', () => {
        const box = new THREE.Box3();
        box.expandByObject(sceneRefs.modelGroup);
        box.expandByObject(sceneRefs.pointcloudGroup);
        const center = new THREE.Vector3();
        if (!box.isEmpty()) box.getCenter(center);
        deps.crossSection.reset(center);
    });

    // ─── Alignment (landmark) ────────────────────────────────
    addListener('btn-align', 'click', deps.alignment.toggleAlignment);

    // ─── Annotation controls ─────────────────────────────────
    const annoBtn = addListener('btn-annotate', 'click', deps.annotations.toggleAnnotationMode);
    const addAnnoBtn = addListener('btn-sidebar-add-annotation', 'click', deps.annotations.toggleAnnotationMode);
    log.info(' Annotation buttons attached:', { annoBtn, addAnnoBtn });
    addListener('btn-anno-save', 'click', deps.annotations.saveAnnotation);
    addListener('btn-anno-cancel', 'click', deps.annotations.cancelAnnotation);
    addListener('btn-sidebar-update-anno-camera', 'click', deps.annotations.updateSelectedAnnotationCamera);
    addListener('btn-sidebar-delete-anno', 'click', deps.annotations.deleteSelectedAnnotation);

    // ─── Fly camera mode toggle ──────────────────────────────
    addListener('btn-fly-mode', 'click', deps.camera.toggleFlyMode);

    // ─── Auto-rotate toggle ──────────────────────────────────
    addListener('btn-auto-rotate', 'click', () => {
        sceneRefs.controls.autoRotate = !sceneRefs.controls.autoRotate;
        const btn = document.getElementById('btn-auto-rotate');
        if (btn) btn.classList.toggle('active', sceneRefs.controls.autoRotate);
    });

    // ─── Export/archive creation controls ─────────────────────
    // btn-export-archive is now a tool rail button — pane switching handled by activateTool()
    addListener('btn-export-cancel', 'click', hideExportPanel);
    addListener('btn-export-download', 'click', deps.export.downloadArchive);

    // Generic viewer download button
    addListener('btn-download-viewer', 'click', deps.export.downloadGenericViewer);

    // ─── Screenshot controls ─────────────────────────────────
    addListener('btn-capture-screenshot', 'click', deps.screenshots.captureScreenshotToList);
    addListener('btn-set-preview', 'click', deps.screenshots.showViewfinder);
    addListener('btn-capture-preview', 'click', deps.screenshots.captureManualPreview);
    addListener('btn-cancel-preview', 'click', deps.screenshots.hideViewfinder);
    addListener('btn-clear-manual-preview', 'click', () => {
        state.manualPreviewBlob = null;
        const status = document.getElementById('manual-preview-status');
        if (status) status.style.display = 'none';
        notify.success('Manual preview cleared');
    });

    // ─── Metadata panel controls ─────────────────────────────
    addListener('btn-close-sidebar', 'click', deps.metadata.hideMetadataPanel);
    addListener('btn-add-custom-field', 'click', addCustomField);
    setupMetadataTabs();
    setupLicenseField();

    // btn-metadata is now a tool rail button — pane switching handled by activateTool()

    // ─── Scene settings — Camera FOV ─────────────────────────
    addListener('camera-fov', 'input', (e: Event) => {
        const fov = parseInt((e.target as HTMLInputElement).value, 10);
        const valueEl = document.getElementById('camera-fov-value');
        if (valueEl) valueEl.textContent = String(fov);
        if (sceneRefs.camera) {
            sceneRefs.camera.fov = fov;
            sceneRefs.camera.updateProjectionMatrix();
        }
    });

    // ─── Scene settings — Gridlines ──────────────────────────
    addListener('toggle-gridlines', 'change', (e: Event) => {
        deps.display.toggleGridlines((e.target as HTMLInputElement).checked);
    });

    // ─── Scene settings — Background color presets ───────────
    document.querySelectorAll('.swatch[data-color]').forEach(btn => {
        btn.addEventListener('click', () => {
            const color = (btn as HTMLElement).dataset.color!;
            deps.display.setBackgroundColor(color);
            // Update active state
            document.querySelectorAll('.swatch[data-color]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            // Update color picker
            const picker = document.getElementById('bg-color-picker') as HTMLInputElement | null;
            if (picker) picker.value = color;
            // Uncheck env-as-background
            const envBgToggle = document.getElementById('toggle-env-background') as HTMLInputElement | null;
            if (envBgToggle) envBgToggle.checked = false;
        });
    });

    // ─── Scene settings — Custom background color ────────────
    addListener('bg-color-picker', 'input', (e: Event) => {
        deps.display.setBackgroundColor((e.target as HTMLInputElement).value);
        // Remove active from presets
        document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
        // Uncheck env-as-background
        const envBgToggle = document.getElementById('toggle-env-background') as HTMLInputElement | null;
        if (envBgToggle) envBgToggle.checked = false;
    });

    // ─── Scene settings — Background image ───────────────────
    addListener('bg-image-input', 'change', async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file || !sceneManager) return;
        try {
            await sceneManager.loadBackgroundImageFromFile(file);
            const filenameEl = document.getElementById('bg-image-filename');
            if (filenameEl) { filenameEl.textContent = file.name; filenameEl.style.display = ''; }
            const envBgToggle = document.getElementById('toggle-env-background') as HTMLInputElement | null;
            if (envBgToggle) envBgToggle.checked = false;
            document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
            const clearBtn = document.getElementById('btn-clear-bg-image');
            if (clearBtn) clearBtn.style.display = '';
        } catch (err: any) {
            notify.error('Failed to load background image: ' + err.message);
        }
    });

    addListener('btn-load-bg-image-url', 'click', async () => {
        const url = prompt('Enter background image URL:');
        if (!url || !sceneManager) return;
        try {
            await sceneManager.loadBackgroundImage(url);
            const envBgToggle = document.getElementById('toggle-env-background') as HTMLInputElement | null;
            if (envBgToggle) envBgToggle.checked = false;
            document.querySelectorAll('.color-preset').forEach(b => b.classList.remove('active'));
            const clearBtn = document.getElementById('btn-clear-bg-image');
            if (clearBtn) clearBtn.style.display = '';
        } catch (err: any) {
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

    // ─── Scene settings — Tone mapping ───────────────────────
    addListener('tone-mapping-select', 'change', (e: Event) => {
        if (sceneManager) sceneManager.setToneMapping((e.target as HTMLSelectElement).value);
    });

    addListener('tone-mapping-exposure', 'input', (e: Event) => {
        const val = parseFloat((e.target as HTMLInputElement).value);
        document.getElementById('tone-mapping-exposure-value')!.textContent = val.toFixed(1);
        if (sceneManager) sceneManager.setToneMappingExposure(val);
    });

    // ─── Scene settings — Environment map (IBL) ─────────────
    addListener('env-map-select', 'change', async (e: Event) => {
        const value = (e.target as HTMLSelectElement).value;
        if (!value) {
            if (sceneManager) sceneManager.clearEnvironment();
            return;
        }
        if (value.startsWith('preset:')) {
            const index = parseInt(value.split(':')[1]);
            const presets = ENVIRONMENT.PRESETS.filter((p: any) => p.url);
            if (presets[index]) {
                showLoading('Loading HDR environment...');
                try {
                    await sceneManager.loadHDREnvironment(presets[index].url);
                    notify.success('Environment loaded');
                } catch (err: any) {
                    notify.error('Failed to load environment: ' + err.message);
                } finally {
                    hideLoading();
                }
            }
        }
    });

    addListener('hdr-file-input', 'change', async (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        showLoading('Loading HDR environment...');
        try {
            await sceneManager.loadHDREnvironmentFromFile(file);
            const filenameEl = document.getElementById('hdr-filename');
            if (filenameEl) { filenameEl.textContent = file.name; filenameEl.style.display = ''; }
            const select = document.getElementById('env-map-select') as HTMLSelectElement | null;
            if (select) select.value = '';
            notify.success('Environment loaded from file');
        } catch (err: any) {
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
            const select = document.getElementById('env-map-select') as HTMLSelectElement | null;
            if (select) select.value = '';
            notify.success('Environment loaded from URL');
        } catch (err: any) {
            notify.error('Failed to load HDR: ' + err.message);
        } finally {
            hideLoading();
        }
    });

    // ─── Scene settings — Environment as background ──────────
    addListener('toggle-env-background', 'change', (e: Event) => {
        if (sceneManager) sceneManager.setEnvironmentAsBackground((e.target as HTMLInputElement).checked);
    });

    // ─── Scene settings — Shadows ────────────────────────────
    addListener('toggle-shadows', 'change', (e: Event) => {
        if (sceneManager) sceneManager.enableShadows((e.target as HTMLInputElement).checked);
        const opacityGroup = document.getElementById('shadow-opacity-group');
        if (opacityGroup) opacityGroup.style.display = (e.target as HTMLInputElement).checked ? '' : 'none';
    });

    addListener('shadow-opacity', 'input', (e: Event) => {
        const val = parseFloat((e.target as HTMLInputElement).value);
        document.getElementById('shadow-opacity-value')!.textContent = val.toFixed(2);
        if (sceneManager) sceneManager.setShadowCatcherOpacity(val);
    });

    // ─── Close annotation popup when clicking outside ────────
    document.addEventListener('click', (e: MouseEvent) => {
        const popup = document.getElementById('annotation-info-popup');
        if (popup && !popup.classList.contains('hidden')) {
            // Check if click was outside popup and not on an annotation marker
            if (!popup.contains(e.target as Node) && !(e.target as HTMLElement).closest('.annotation-marker')) {
                deps.annotations.dismissPopup();
            }
        }
    });

    // ─── Keyboard shortcuts ──────────────────────────────────
    window.addEventListener('keydown', (e: KeyboardEvent) => {
        const activeEl = document.activeElement;
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
            return; // Don't trigger if typing in input
        }

        // In fly mode, only allow F (toggle out) and Escape
        if (sceneRefs.flyControls && sceneRefs.flyControls.enabled) {
            if (e.key.toLowerCase() === 'f' && !e.ctrlKey && !e.metaKey) {
                deps.camera.toggleFlyMode();
            }
            return;
        }

        if (e.ctrlKey || e.metaKey) return;

        const key = e.key.toLowerCase();

        // Tool rail pane shortcuts (match data-tooltip in HTML)
        let activatedTool: string | null = null;
        switch (key) {
            case 's': activateTool('scene'); activatedTool = 'scene'; break;
            case 'a': activateTool('assets'); activatedTool = 'assets'; break;
            case 't':
                activateTool('transform'); activatedTool = 'transform';
                if (state.selectedObject === 'none') {
                    if (sceneRefs.splatMesh) {
                        deps.transform.setSelectedObject('splat' as any);
                    } else if (sceneRefs.modelGroup && sceneRefs.modelGroup.children.length > 0) {
                        deps.transform.setSelectedObject('model' as any);
                    }
                }
                break;
            case 'n': activateTool('annotate'); activatedTool = 'annotate'; break;
            case 'x':
                activateTool('crosssection'); activatedTool = 'crosssection';
                if (!deps.crossSection.active) {
                    const box = new THREE.Box3();
                    box.expandByObject(sceneRefs.modelGroup);
                    box.expandByObject(sceneRefs.pointcloudGroup);
                    const center = new THREE.Vector3();
                    if (!box.isEmpty()) box.getCenter(center);
                    sceneManager.setLocalClippingEnabled(true);
                    deps.crossSection.start(center);
                }
                break;
            case 'm': activateTool('measure'); activatedTool = 'measure'; break;
            case 'c': activateTool('capture'); activatedTool = 'capture'; break;
            case 'd': activateTool('metadata'); activatedTool = 'metadata'; break;
            case ',': activateTool('settings'); activatedTool = 'settings'; break;
            case 'f': deps.camera.toggleFlyMode(); break;
            default: break;
        }
        // Show/hide transform gizmo and orbit center line based on active tool
        if (activatedTool && sceneRefs.transformControls) {
            try {
                sceneRefs.transformControls.getHelper().visible = (activatedTool === 'transform');
                sceneRefs.transformControls.enabled = (activatedTool === 'transform');
            } catch { /* ignore */ }
        }
        if (activatedTool) {
            if (activatedTool === 'transform') {
                sceneManager.showOrbitCenterLine(sceneRefs.controls.target);
            } else {
                sceneManager.hideOrbitCenterLine();
            }
        }
        // Stop cross-section when switching away via keyboard
        if (activatedTool && activatedTool !== 'crosssection' && deps.crossSection.active) {
            deps.crossSection.stop();
            sceneManager.setLocalClippingEnabled(false);
        }

        if (e.key === 'Escape') {
            deps.annotations.dismissPopup();
            // Hide props panel if open (Escape is the only way to dismiss)
            const propsPanel = document.getElementById('props-panel');
            if (propsPanel && !propsPanel.classList.contains('hidden')) {
                propsPanel.classList.add('hidden');
            }
        }
    });

    // ─── Default View settings — live toggle ─────────────────
    addListener('meta-viewer-single-sided', 'change', (e: Event) => {
        const side = (e.target as HTMLInputElement).checked ? THREE.FrontSide : THREE.DoubleSide;
        if (sceneRefs.modelGroup) {
            sceneRefs.modelGroup.traverse((child: any) => {
                if (child.isMesh && child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach((m: any) => { m.side = side; m.needsUpdate = true; });
                }
            });
        }
    });

    addListener('meta-viewer-bg-override', 'change', (e: Event) => {
        const checked = (e.target as HTMLInputElement).checked;
        const colorRow = document.getElementById('meta-viewer-bg-color-row');
        if (colorRow) colorRow.style.display = checked ? '' : 'none';
    });

    addListener('meta-viewer-bg-color', 'input', (e: Event) => {
        const hex = (e.target as HTMLInputElement).value;
        if (sceneRefs.scene) sceneRefs.scene.background = new THREE.Color(hex);
        const hexLabel = document.getElementById('meta-viewer-bg-color-hex');
        if (hexLabel) hexLabel.textContent = hex;
    });

    // ─── Setup collapsible sections ──────────────────────────
    setupCollapsibles();

    // ─── Metadata sidebar event handlers ─────────────────────
    deps.metadata.setupMetadataSidebar();

    // ─── Fullscreen toggle ────────────────────────────────────
    setupFullscreen();

    log.info(' UI events setup complete');
}

// ============================================================
// PRIVATE HELPERS
// ============================================================

/**
 * Clear all other debug view modes when activating a new one.
 * Debug views are mutually exclusive: wireframe, matcap, normals,
 * roughness, metalness, specularF0.
 */
function clearDebugViews(state: any, deps: EventWiringDeps, activeView: string): void {
    const views: Record<string, { stateKey: string; cbId: string; update: () => void; styleGroupId?: string }> = {
        wireframe:  { stateKey: 'modelWireframe',  cbId: 'model-wireframe',   update: deps.display.updateModelWireframe },
        matcap:     { stateKey: 'modelMatcap',      cbId: 'model-matcap',      update: deps.display.updateModelMatcap, styleGroupId: 'matcap-style-group' },
        normals:    { stateKey: 'modelNormals',     cbId: 'model-normals',     update: deps.display.updateModelNormals },
        roughness:  { stateKey: 'modelRoughness',   cbId: 'model-roughness',   update: deps.display.updateModelRoughnessView },
        metalness:  { stateKey: 'modelMetalness',   cbId: 'model-metalness',   update: deps.display.updateModelMetalnessView },
        specularF0: { stateKey: 'modelSpecularF0',  cbId: 'model-specular-f0', update: deps.display.updateModelSpecularF0View },
    };

    for (const [name, view] of Object.entries(views)) {
        if (name === activeView) continue;
        if (state[view.stateKey]) {
            state[view.stateKey] = false;
            const cb = document.getElementById(view.cbId) as HTMLInputElement | null;
            if (cb) cb.checked = false;
            if (view.styleGroupId) {
                const sg = document.getElementById(view.styleGroupId);
                if (sg) sg.style.display = 'none';
            }
            view.update();
        }
    }
}

function setupFullscreen(): void {
    const btn = document.getElementById('btn-fullscreen');
    if (!document.fullscreenEnabled) {
        if (btn) btn.style.display = 'none';
        return;
    }

    const toggle = () => {
        if (!document.fullscreenElement) {
            document.documentElement.requestFullscreen();
        } else {
            document.exitFullscreen();
        }
    };

    if (btn) btn.addEventListener('click', toggle);

    document.addEventListener('fullscreenchange', () => {
        if (btn) btn.classList.toggle('is-fullscreen', !!document.fullscreenElement);
    });
}
