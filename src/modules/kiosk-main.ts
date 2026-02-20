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
import type { Annotation, DisplayMode } from '@/types.js';
import { SceneManager } from './scene-manager.js';
import { SparkRenderer } from '@sparkjsdev/spark';

// Local AssetType (not exported from types.ts)
type AssetType = 'splat' | 'mesh' | 'pointcloud';
import { FlyControls } from './fly-controls.js';
import { AnnotationSystem } from './annotation-system.js';
import { MeasurementSystem } from './measurement-system.js';
import { CrossSectionTool } from './cross-section.js';
import { CAMERA, ASSET_STATE, QUALITY_TIER } from './constants.js';
import { resolveQualityTier, hasAnyProxy } from './quality-tier.js';
import { Logger, notify, parseMarkdown, resolveAssetRefs, fetchWithProgress, downloadBlob } from './utilities.js';
import {
    showLoading, hideLoading, updateProgress,
    setDisplayMode, setupCollapsibles, addListener,
    setupKeyboardShortcuts,
    showInlineLoading, hideInlineLoading
} from './ui-controller.js';
import {
    loadArchiveFromFile,
    processArchivePhase1, loadArchiveAsset,
    getAssetTypesForMode, getPrimaryAssetType,
    updateModelOpacity, updateModelWireframe, updateModelTextures, updateModelMatcap, updateModelNormals,
    updateModelRoughness, updateModelMetalness, updateModelSpecularF0,
    updatePointcloudPointSize, updatePointcloudOpacity,
    loadSplatFromFile, loadSplatFromUrl,
    loadModelFromFile, loadModelFromUrl,
    loadPointcloudFromFile, loadPointcloudFromUrl,
    loadArchiveFullResMesh, loadArchiveFullResSplat,
    loadArchiveProxyMesh, loadArchiveProxySplat
} from './file-handlers.js';
import {
    showMetadataSidebar, hideMetadataSidebar, switchSidebarMode,
    setupMetadataSidebar, prefillMetadataFromArchive,
    populateMetadataDisplay, updateArchiveMetadataUI,
    showAnnotationPopup, hideAnnotationPopup, updateAnnotationPopupPosition
} from './metadata-manager.js';
import { loadTheme } from './theme-loader.js';
import type { LayoutModule } from './theme-loader.js';
import { ArchiveLoader } from './archive-loader.js';
import { KIOSK_SECTION_TIERS, EDITORIAL_SECTION_TIERS, isTierVisible } from './metadata-profile.js';
import type { MetadataProfile } from './metadata-profile.js';


// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

type FileCategory = 'splat' | 'model' | 'pointcloud' | 'archive';
type SheetSnap = 'peek' | 'half' | 'full';

interface KioskState {
    displayMode: string;
    controlsVisible: boolean;
    splatLoaded: boolean;
    modelLoaded: boolean;
    pointcloudLoaded: boolean;
    archiveLoaded: boolean;
    archiveLoader: ArchiveLoader | null;
    archiveManifest: any;
    archiveFileName: string | null;
    currentArchiveUrl: string | null;
    currentSplatUrl: string | null;
    currentModelUrl: string | null;
    flyModeActive: boolean;
    annotationsVisible: boolean;
    assetStates: Record<string, string>;
    imageAssets: Map<string, any>;
    qualityTier: string;
    qualityResolved: string;
    archiveSourceUrl?: string | null;
}

interface AppConfig {
    theme?: string;
    layout?: string;
    defaultArchiveUrl?: string;
    autoload?: boolean;
    defaultSplatUrl?: string;
    defaultModelUrl?: string;
    defaultPointcloudUrl?: string;
    initialViewMode?: string;
    inlineAlignment?: {
        splat?: { position?: number[]; rotation?: number[]; scale?: number };
        model?: { position?: number[]; rotation?: number[]; scale?: number };
        pointcloud?: { position?: number[]; rotation?: number[]; scale?: number };
    };
    _resolvedLayout?: string;
    _themeMeta?: any;
    _layoutModule?: LayoutModule | null;
}

interface WindowWithConfig extends Window {
    APP_CONFIG?: AppConfig;
    __TAURI__?: any;
    __KIOSK_THEME_ASSETS__?: Record<string, any>;
}

declare const window: WindowWithConfig;
const log = Logger.getLogger('kiosk-main');

// =============================================================================
// MANIFEST NORMALIZATION
// =============================================================================

/** Convert a camelCase string to snake_case */
function camelToSnake(str: string): string {
    return str.replace(/[A-Z]/g, letter => `_${letter.toLowerCase()}`);
}

/** Recursively convert all object keys from camelCase to snake_case */
function deepSnakeKeys(obj: any): any {
    if (Array.isArray(obj)) return obj.map(deepSnakeKeys);
    if (obj !== null && typeof obj === 'object') {
        const result = {};
        for (const [key, value] of Object.entries(obj)) {
            result[camelToSnake(key)] = deepSnakeKeys(value);
        }
        return result;
    }
    return obj;
}

/**
 * Normalize a manifest to canonical snake_case keys and lift common fields.
 * Handles manifests created with either camelCase or snake_case conventions.
 */
function normalizeManifest(raw: any): any {
    const m = deepSnakeKeys(raw);
    // Lift project fields to top level for convenient access
    if (m.project) {
        if (m.project.title && !m.title) m.title = m.project.title;
        if (m.project.description && !m.description) m.description = m.project.description;
        if (m.project.license && !m.license) m.license = m.project.license;
    }
    return m;
}

/**
 * Format a date string for display. Returns null if the input is not a valid date.
 *  - 'long'  → "February 18, 2026"  (sidebar / detail views)
 *  - 'medium'→ "February 2026"       (bylines — wall label, info overlay)
 */
function formatDisplayDate(raw: string, style: 'long' | 'medium' = 'long'): string | null {
    if (!raw) return null;
    const d = new Date(raw);
    if (isNaN(d.getTime())) return raw;          // pass through unparseable strings as-is
    if (style === 'medium') {
        return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long' });
    }
    return d.toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

// =============================================================================
// MODULE STATE
// =============================================================================

let sceneManager: SceneManager | null = null;
let scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: any, controls: any, modelGroup: THREE.Group, pointcloudGroup: THREE.Group;
let flyControls: FlyControls | null = null;
let annotationSystem: AnnotationSystem | null = null;
let crossSection: CrossSectionTool | null = null;
let measurementSystem: MeasurementSystem | null = null;
let sparkRenderer: any = null; // SparkRenderer instance
let splatMesh: any = null; // TODO: SplatMesh type
let fpsElement: HTMLElement | null = null;
let currentPopupAnnotationId: string | null = null;
let annotationLineEl: SVGLineElement | null = null;
let currentSheetSnap: SheetSnap = 'peek'; // 'peek' | 'half' | 'full'

/** Get the resolved layout module, if any. */
function getLayoutModule(): LayoutModule | null {
    return (window.APP_CONFIG as any)?._layoutModule || null;
}

const state: KioskState = {
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
    flyModeActive: false,
    annotationsVisible: true,
    assetStates: { splat: ASSET_STATE.UNLOADED, mesh: ASSET_STATE.UNLOADED, pointcloud: ASSET_STATE.UNLOADED },
    imageAssets: new Map(),
    qualityTier: QUALITY_TIER.AUTO,
    qualityResolved: QUALITY_TIER.HD
};

// =============================================================================
// FILE FORMAT CLASSIFICATION
// =============================================================================

const FILE_CATEGORIES = {
    archive:    ['.a3d', '.a3z'],
    model:      ['.glb', '.gltf', '.obj', '.stl'],
    splat:      ['.ply', '.splat', '.ksplat', '.spz', '.sog'],
    pointcloud: ['.e57']
};
/**
 * Classify a filename into its asset category.
 * @param {string} filename
 * @returns {'splat'|'model'|'pointcloud'|'archive'|null}
 */
function classifyFile(filename: string): FileCategory | null {
    const ext = '.' + filename.split('.').pop().toLowerCase();
    for (const [category, extensions] of Object.entries(FILE_CATEGORIES)) {
        if (extensions.includes(ext)) return category as FileCategory;
    }
    return null;
}

// =============================================================================
// INITIALIZATION
// =============================================================================

export async function init(): Promise<void> {
    log.info('Kiosk viewer initializing...');
    document.body.classList.add('kiosk-mode');

    const canvas = document.getElementById('viewer-canvas');
    const canvasRight = document.getElementById('viewer-canvas-right');

    sceneManager = new SceneManager();
    if (!await sceneManager.init(canvas as HTMLCanvasElement, canvasRight as HTMLCanvasElement)) {
        log.error('Scene initialization failed');
        return;
    }
    log.info('Renderer type:', sceneManager.rendererType);

    // Extract scene objects for local use
    scene = sceneManager.scene;
    camera = sceneManager.camera;
    renderer = sceneManager.renderer;
    controls = sceneManager.controls;
    modelGroup = sceneManager.modelGroup;
    pointcloudGroup = sceneManager.pointcloudGroup;
    fpsElement = document.getElementById('fps-counter');

    // Create SparkRenderer only when starting with WebGL — Spark.js requires
    // WebGL context (uses .flush()). If starting with WebGPU, SparkRenderer
    // will be created in onRendererChanged when switching to WebGL for splat loading.
    if (sceneManager.rendererType === 'webgl') {
        sparkRenderer = new SparkRenderer({
            renderer: renderer,
            clipXY: 3.0,           // Prevent aggressive frustum culling (default: 1.4)
            autoUpdate: true,
            minAlpha: 3 / 255,     // Cull near-invisible splats (default: ~0.002)
            view: { sortDistance: 0.005 }  // Re-sort after 5mm movement (default: 0.01)
        });
        scene.add(sparkRenderer);
        log.info('SparkRenderer created with clipXY=3.0, minAlpha=3/255, sortDistance=0.005');
    } else {
        log.info('SparkRenderer deferred — will be created after WebGL switch');
    }

    // Disable transform controls (viewer only)
    sceneManager.detachTransformControls();

    // Create fly controls
    flyControls = new FlyControls(camera, renderer.domElement);

    // Initialize cross-section tool (stlGroup not used in kiosk)
    crossSection = new CrossSectionTool(scene, camera, renderer, controls, modelGroup, pointcloudGroup, null);

    // Register callback for renderer switches (WebGPU <-> WebGL)
    sceneManager.onRendererChanged = (newRenderer: any) => {
        renderer = newRenderer;
        controls = sceneManager!.controls;
        if (annotationSystem) annotationSystem.updateRenderer(newRenderer);
        if (measurementSystem) measurementSystem.updateRenderer(newRenderer);
        if (flyControls) {
            flyControls.dispose();
            flyControls = new FlyControls(camera, newRenderer.domElement);
        }
        // Recreate SparkRenderer with new renderer instance
        if (sparkRenderer) {
            scene.remove(sparkRenderer);
            if (sparkRenderer.dispose) sparkRenderer.dispose();
        }
        sparkRenderer = new SparkRenderer({
            renderer: newRenderer,
            clipXY: 3.0,
            autoUpdate: true,
            minAlpha: 3 / 255,
            view: { sortDistance: 0.005 }
        });
        scene.add(sparkRenderer);
        log.info('Renderer changed to', sceneManager!.rendererType, '- SparkRenderer recreated');
    };

    // Create annotation system
    annotationSystem = new AnnotationSystem(scene, camera, renderer, controls);
    annotationSystem.onAnnotationSelected = (annotation) => {
        if (currentPopupAnnotationId === annotation.id) {
            if (isMobileKiosk()) {
                hideMobileAnnotationDetail();
                setSheetSnap('peek');
            } else {
                hideAnnotationPopup();
                hideAnnotationLine();
            }
            currentPopupAnnotationId = null;
            annotationSystem.selectedAnnotation = null;
            document.querySelectorAll('.annotation-marker.selected').forEach(m => m.classList.remove('selected'));
            document.querySelectorAll('.kiosk-anno-item.active').forEach(c => c.classList.remove('active'));
            // Notify layout module of deselection
            getLayoutModule()?.onAnnotationDeselect?.();
            return;
        }
        // Highlight the corresponding sidebar item
        document.querySelectorAll('.kiosk-anno-item.active').forEach(c => c.classList.remove('active'));
        const item = document.querySelector(`.kiosk-anno-item[data-anno-id="${annotation.id}"]`);
        if (item) item.classList.add('active');

        // Notify layout module of selection
        getLayoutModule()?.onAnnotationSelect?.(annotation.id);

        if (isMobileKiosk()) {
            currentPopupAnnotationId = annotation.id;
            showMobileAnnotationInSheet(annotation.id);
        } else {
            currentPopupAnnotationId = showAnnotationPopup(annotation, state.imageAssets);
        }
    };

    // Create measurement system
    measurementSystem = new MeasurementSystem(scene, camera, renderer, controls);

    // Create kiosk-only DOM elements before theme init (layout modules customize them)
    createFilePicker();
    createClickGate();

    // Load theme and determine layout
    const config = window.APP_CONFIG || {};
    const themeMeta = await loadTheme(config.theme, { layoutOverride: config.layout || undefined });

    // ?layout= overrides theme's @layout; theme overrides default 'sidebar'
    const requestedLayout = config.layout || themeMeta.layout || 'sidebar';

    // Only use a custom layout if its module is available; fall back to sidebar otherwise
    const hasLayoutModule = !!themeMeta.layoutModule;
    const layoutStyle = hasLayoutModule ? requestedLayout : (requestedLayout !== 'sidebar' ? 'sidebar' : requestedLayout);

    // Store resolved layout + module for other code paths
    config._resolvedLayout = layoutStyle;
    config._themeMeta = themeMeta;
    config._layoutModule = themeMeta.layoutModule || null;

    if (hasLayoutModule) {
        document.body.classList.add(`kiosk-${layoutStyle}`);
        log.info(`Layout module enabled: ${layoutStyle}`);

        const layoutModule = themeMeta.layoutModule!;
        const layoutOpts = {
            themeAssets: (themeMeta as any).themeAssets || {},
            themeBaseUrl: `themes/${config.theme}/`
        };

        // Let layout module customize loading screen before any archive loading
        if (layoutModule.initLoadingScreen) {
            const overlay = document.getElementById('loading-overlay');
            if (overlay) layoutModule.initLoadingScreen(overlay, layoutOpts);
        }

        // Let layout module customize click gate
        if (layoutModule.initClickGate) {
            const gate = document.getElementById('kiosk-click-gate');
            if (gate) layoutModule.initClickGate(gate, layoutOpts);
        }

        // Let layout module customize file picker
        if (layoutModule.initFilePicker) {
            const picker = document.getElementById('kiosk-file-picker');
            if (picker) layoutModule.initFilePicker(picker, layoutOpts);
        }
    } else if (requestedLayout !== 'sidebar') {
        log.warn(`Layout "${requestedLayout}" requested but no layout module available — using sidebar`);
    }

    // Wire up UI
    setupViewerUI();
    // Always set up sidebar (layout modules hide it via CSS but need it as mobile fallback)
    setupMetadataSidebar({ state: state as any, annotationSystem, imageAssets: state.imageAssets });
    setupCollapsibles();
    setupViewerKeyboardShortcuts();

    // Apply initial display mode from config
    if (config.initialViewMode) {
        state.displayMode = config.initialViewMode;
    }
    setDisplayMode(state.displayMode as DisplayMode, createDisplayModeDeps());

    // Hide editor-only UI
    hideEditorOnlyUI();

    // Handle window resize
    window.addEventListener('resize', onWindowResize);

    // Setup mobile bottom sheet drag (always — layout modules use sidebar as mobile fallback)
    setupBottomSheetDrag();
    if (isMobileKiosk()) setSheetSnap('peek');

    // Start render loop
    animate();

    // Show file picker overlay
    setupFilePicker();

    log.info('Kiosk viewer ready');
}

// =============================================================================
// DOM CREATION — Kiosk-only elements created dynamically (not in index.html)
// =============================================================================

function createFilePicker(): HTMLElement {
    const picker = document.createElement('div');
    picker.id = 'kiosk-file-picker';
    picker.className = 'hidden';
    picker.innerHTML = `
        <div class="kiosk-picker-content">
            <h1>Vitrine3D</h1>
            <p>Open a 3D file or archive to view its content.</p>
            <div class="kiosk-picker-box" id="kiosk-drop-zone">
                <div class="kiosk-picker-icon">&#128194;</div>
                <p>Select a <strong>3D file</strong> or <strong>archive</strong></p>
                <button id="kiosk-picker-btn" type="button">Select File</button>
                <p class="kiosk-picker-hint">or drag and drop it here</p>
                <p class="kiosk-picker-formats">
                    Archives: .a3d, .a3z<br>
                    Models: .glb, .gltf, .obj, .stl<br>
                    Splats: .ply, .splat, .ksplat, .spz, .sog<br>
                    Point Clouds: .e57
                </p>
            </div>
            <input type="file" id="kiosk-picker-input" accept=".a3z,.a3d,.glb,.gltf,.obj,.stl,.ply,.splat,.ksplat,.spz,.sog,.e57" multiple style="display:none">
        </div>
    `;
    document.body.appendChild(picker);
    return picker;
}

function createClickGate(): HTMLElement {
    const gate = document.createElement('div');
    gate.id = 'kiosk-click-gate';
    gate.className = 'hidden';
    gate.innerHTML = `
        <div class="kiosk-gate-vignette"></div>
        <img id="kiosk-gate-poster" alt="" />
        <div class="kiosk-gate-card">
            <h2 id="kiosk-gate-title"></h2>
            <p id="kiosk-gate-description" class="hidden"></p>
            <div id="kiosk-gate-tags" class="display-tags hidden"></div>
            <button id="kiosk-gate-play" type="button" aria-label="Load 3D viewer">
                <svg viewBox="0 0 24 24" width="32" height="32">
                    <polygon points="8,5 19,12 8,19" />
                </svg>
            </button>
            <p id="kiosk-gate-cta" class="hidden">Touch to begin</p>
            <div id="kiosk-gate-types"></div>
        </div>
    `;
    document.body.appendChild(gate);
    return gate;
}

// =============================================================================
// FILE PICKER
// =============================================================================

function setupFilePicker(): void {
    const picker = document.getElementById('kiosk-file-picker');

    // Check for URL-based archive loading (e.g. ?kiosk=true&archive=URL)
    const config = window.APP_CONFIG || {};
    if (config.defaultArchiveUrl) {
        if (config.autoload === false) {
            showClickGate(config.defaultArchiveUrl);
            return;
        }

        // In Tauri, read local archive directly from filesystem (no HTTP fetch)
        if (window.__TAURI__) {
            log.info('Tauri: loading archive directly from filesystem:', config.defaultArchiveUrl);
            loadArchiveFromTauri(config.defaultArchiveUrl);
            return;
        }

        log.info('Loading archive from URL:', config.defaultArchiveUrl);
        loadArchiveFromUrl(config.defaultArchiveUrl);
        return;
    }

    // Check for direct file URL params (e.g. ?kiosk=true&splat=URL or ?model=URL)
    const hasDirectUrl = config.defaultSplatUrl || config.defaultModelUrl || config.defaultPointcloudUrl;
    if (hasDirectUrl) {
        log.info('Loading direct files from URL params');
        loadDirectFilesFromUrls(config);
        return;
    }

    if (picker) picker.classList.remove('hidden');

    const btn = document.getElementById('kiosk-picker-btn');
    const input = document.getElementById('kiosk-picker-input');
    const dropZone = document.getElementById('kiosk-drop-zone');

    if (btn && input) {
        // In Tauri, use native OS file dialog instead of browser file input
        if (window.__TAURI__) {
            btn.addEventListener('click', async () => {
                try {
                    const { openFileDialog } = await import('./tauri-bridge.js');
                    const files = await openFileDialog({ filterKey: 'all', multiple: false });
                    if (files && files.length > 0) {
                        handlePickedFiles(files, picker);
                    }
                } catch (err) {
                    log.warn('Native file dialog failed, falling back to browser input:', err.message);
                    input.click();
                }
            });
        } else {
            btn.addEventListener('click', () => input.click());
        }
        // Browser file input still needed as fallback
        input.addEventListener('change', (e) => {
            const target = e.target as HTMLInputElement;
            if (target.files && target.files.length > 0) {
                handlePickedFiles(target.files, picker);
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
            if (e.dataTransfer.files.length > 0) {
                handlePickedFiles(e.dataTransfer.files, picker);
            }
        });
    }

}

// =============================================================================
// DIRECT FILE LOADING (non-archive)
// =============================================================================

/**
 * Route picked/dropped files to the correct loader.
 * Handles: archives, direct splats, models (with OBJ+MTL), point clouds.
 */
function handlePickedFiles(fileList: FileList | File[], pickerElement: HTMLElement | null): void {
    const files = Array.from(fileList);
    const mainFile = files[0];
    const category = classifyFile(mainFile.name);

    if (!category) {
        const ext = mainFile.name.split('.').pop();
        notify.warning(`Unsupported file format: .${ext}`);
        return;
    }

    // Hide picker
    if (pickerElement) pickerElement.classList.add('hidden');

    if (category === 'archive') {
        state.archiveSourceUrl = null;
        handleArchiveFile(mainFile);
        return;
    }

    // Direct file loading
    handleDirectFile(mainFile, category, files);
}

/**
 * Load a single direct (non-archive) file into the kiosk viewer.
 * @param {File} mainFile - The primary file
 * @param {'splat'|'model'|'pointcloud'} category - Detected category
 * @param {File[]} allFiles - All dropped files (for OBJ+MTL pairs)
 */
async function handleDirectFile(mainFile: File, category: FileCategory, allFiles: File[]): Promise<void> {
    log.info(`Loading direct ${category} file:`, mainFile.name);
    showLoading(`Loading ${category}...`, true);

    try {
        updateProgress(20, `Loading ${mainFile.name}...`);

        if (category === 'splat') {
            await loadSplatFromFile(mainFile, createSplatDeps());
        } else if (category === 'model') {
            await loadModelFromFile(allFiles as any || [mainFile], createModelDeps());
        } else if (category === 'pointcloud') {
            await loadPointcloudFromFile(mainFile, createPointcloudDeps());
        }

        updateProgress(80, 'Finalizing...');
        onDirectFileLoaded(mainFile.name);
    } catch (err) {
        log.error(`Failed to load ${category}:`, err);
        hideLoading();
        notify.error(`Failed to load ${category}: ${err.message}`);
        // Show picker again for retry
        const picker = document.getElementById('kiosk-file-picker');
        if (picker) picker.classList.remove('hidden');
    }
}

/**
 * Load direct files from URL params (?splat=, ?model=, ?pointcloud=).
 */
async function loadDirectFilesFromUrls(config: AppConfig): Promise<void> {
    showLoading('Loading 3D data...', true);

    try {
        if (config.defaultSplatUrl) {
            updateProgress(10, 'Loading splat...');
            await loadSplatFromUrl(config.defaultSplatUrl, createSplatDeps(), ((received: number, totalBytes: number) => {
                if (totalBytes > 0) {
                    const pct = Math.round((received / totalBytes) * 100);
                    updateProgress(pct * 0.3, `Downloading splat... ${(received / 1048576).toFixed(1)} MB`);
                }
            }) as any);
        }

        if (config.defaultModelUrl) {
            updateProgress(40, 'Loading model...');
            await loadModelFromUrl(config.defaultModelUrl, createModelDeps(), ((received: number, totalBytes: number) => {
                if (totalBytes > 0) {
                    const pct = Math.round((received / totalBytes) * 100);
                    updateProgress(40 + pct * 0.3, `Downloading model... ${(received / 1048576).toFixed(1)} MB`);
                }
            }) as any);
        }

        if (config.defaultPointcloudUrl) {
            updateProgress(70, 'Loading point cloud...');
            await loadPointcloudFromUrl(config.defaultPointcloudUrl, createPointcloudDeps(), ((received: number, totalBytes: number) => {
                if (totalBytes > 0) {
                    const pct = Math.round((received / totalBytes) * 100);
                    updateProgress(70 + pct * 0.2, `Downloading point cloud... ${(received / 1048576).toFixed(1)} MB`);
                }
            }) as any);
        }

        // Apply inline alignment if provided via URL params (?sp=, ?sr=, ?ss=, ?mp=, etc.)
        if (config.inlineAlignment) {
            const alignment = config.inlineAlignment;
            if (alignment.splat && splatMesh) {
                if (alignment.splat.position) splatMesh.position.fromArray(alignment.splat.position);
                if (alignment.splat.rotation) splatMesh.rotation.set(...alignment.splat.rotation as [number, number, number]);
                if (alignment.splat.scale != null) splatMesh.scale.setScalar(alignment.splat.scale);
                // Force matrix world update after transforms
                splatMesh.updateMatrixWorld(true);
            }
            if (alignment.model && modelGroup) {
                if (alignment.model.position) modelGroup.position.fromArray(alignment.model.position);
                if (alignment.model.rotation) modelGroup.rotation.set(...alignment.model.rotation as [number, number, number]);
                if (alignment.model.scale != null) modelGroup.scale.setScalar(alignment.model.scale);
            }
            if (alignment.pointcloud && pointcloudGroup) {
                if (alignment.pointcloud.position) pointcloudGroup.position.fromArray(alignment.pointcloud.position);
                if (alignment.pointcloud.rotation) pointcloudGroup.rotation.set(...alignment.pointcloud.rotation as [number, number, number]);
                if (alignment.pointcloud.scale != null) pointcloudGroup.scale.setScalar(alignment.pointcloud.scale);
            }
        }

        updateProgress(90, 'Finalizing...');
        onDirectFileLoaded(null);
    } catch (err) {
        log.error('Failed to load from URLs:', err);
        hideLoading();
        notify.error(`Failed to load: ${err.message}`);
        const picker = document.getElementById('kiosk-file-picker');
        if (picker) picker.classList.remove('hidden');
    }
}

/**
 * Post-load UI setup for direct (non-archive) file loading.
 * Simplified version of the post-archive flow — no manifest, no branded loading,
 * no annotations, no metadata.
 */
function onDirectFileLoaded(fileName: string | null): void {
    // Set display mode based on what loaded
    if (state.modelLoaded) {
        state.displayMode = 'model';
    } else if (state.splatLoaded) {
        state.displayMode = 'splat';
    } else if (state.pointcloudLoaded) {
        state.displayMode = 'pointcloud';
    }
    setDisplayMode(state.displayMode as DisplayMode, createDisplayModeDeps());

    // Show only relevant settings sections
    showRelevantSettings(state.splatLoaded, state.modelLoaded, state.pointcloudLoaded);

    // Fit camera to loaded content
    fitCameraToScene();

    // Enable shadows for models
    if (state.modelLoaded) {
        sceneManager.enableShadows(true);
        sceneManager.applyShadowProperties(modelGroup);
    }

    // Enable auto-rotate
    controls.autoRotate = true;
    const autoRotateBtn = document.getElementById('btn-auto-rotate');
    if (autoRotateBtn) autoRotateBtn.classList.add('active');

    // Branch UI setup based on resolved layout (theme + ?layout= override)
    const layoutModule = getLayoutModule();

    if (layoutModule) {
        // Delegate to layout module — it creates its own ribbon/toolbar
        layoutModule.setup(null, createLayoutDeps());
        // View switcher as mobile fallback (hidden on desktop by layout CSS)
        createViewSwitcher();
    } else {
        // Standard kiosk UI
        createViewSwitcher();
    }

    // Set filename as display title if available
    if (fileName) {
        const displayTitle = document.getElementById('display-title');
        if (displayTitle) displayTitle.textContent = fileName;
    }

    updateProgress(100, 'Complete');
    smoothTransitionIn();

    log.info('Direct file loaded:', fileName || '(from URL)');
    notify.success(`Loaded: ${fileName || 'file from URL'}`);
}

// =============================================================================
// CLICK GATE
// =============================================================================

/**
 * Show click-to-load overlay with poster extracted from archive via Range requests.
 * Only downloads the ZIP central directory + thumbnail (~100KB), not the full archive.
 */
async function showClickGate(archiveUrl: string): Promise<void> {
    const gate = document.getElementById('kiosk-click-gate');
    if (!gate) {
        log.warn('Click gate element not found, falling back to auto-load');
        loadArchiveFromUrl(archiveUrl);
        return;
    }

    // Try to extract poster and metadata from archive via Range requests
    try {
        const loader = new ArchiveLoader();
        await loader.loadRemoteIndex(archiveUrl);

        // Parse manifest for title + content types
        const manifest = await loader.parseManifest();
        const contentInfo = loader.getContentInfo();

        // Set title
        const titleEl = document.getElementById('kiosk-gate-title');
        const title = manifest?.project?.title || manifest?._meta?.title || '';
        if (titleEl && title) titleEl.textContent = title;

        // Extract thumbnail for poster
        let posterBlobUrl = null;
        const thumbEntry = loader.getThumbnailEntry();
        if (thumbEntry) {
            const thumbData = await loader.extractFile(thumbEntry.file_name);
            if (thumbData) {
                posterBlobUrl = thumbData.url;
                const posterImg = document.getElementById('kiosk-gate-poster') as HTMLImageElement;
                if (posterImg) posterImg.src = posterBlobUrl;
            }
        }

        // Show content types
        const typesEl = document.getElementById('kiosk-gate-types');
        const types = [];
        if (contentInfo.hasSplat) types.push('Gaussian Splat');
        if (contentInfo.hasMesh) types.push('Mesh');
        if (contentInfo.hasPointcloud) types.push('Point Cloud');
        
        if (typesEl) {
            typesEl.innerHTML = '';
            types.forEach(t => {
                const span = document.createElement('span');
                span.className = 'kiosk-gate-pill';
                span.textContent = t;
                typesEl.appendChild(span);
            });
        }

        // Remove poster blob URL from loader's tracked URLs before dispose
        // so it isn't revoked before the <img> finishes loading
        if (posterBlobUrl) {
            loader.blobUrls = loader.blobUrls.filter(u => u !== posterBlobUrl);
        }
        loader.dispose();
    } catch (e) {
        log.warn('Could not extract poster via Range requests:', e.message);
        // Fallback: generic play button without poster (still functional)
    }

    gate.classList.remove('hidden');

    // Click anywhere on the gate to start full download
    gate.addEventListener('click', () => {
        gate.classList.add('hidden');
        log.info('Click gate dismissed, loading archive:', archiveUrl);
        loadArchiveFromUrl(archiveUrl);
    }, { once: true });
}

async function loadArchiveFromUrl(url: string): Promise<void> {
    showLoading('Downloading archive...', true);
    try {
        const blob = await fetchWithProgress(url, (received, total) => {
            if (total > 0) {
                const pct = Math.round((received / total) * 100);
                const mb = (received / (1024 * 1024)).toFixed(1);
                const totalMb = (total / (1024 * 1024)).toFixed(1);
                updateProgress(pct, `Downloading... ${mb} / ${totalMb} MB`);
            } else {
                const mb = (received / (1024 * 1024)).toFixed(1);
                updateProgress(0, `Downloading... ${mb} MB`);
            }
        });
        const fileName = url.split('/').pop().split('?')[0] || 'archive.a3d';
        const file = new File([blob], fileName, { type: blob.type });
        state.archiveSourceUrl = url;
        handleArchiveFile(file);
    } catch (err) {
        log.error('Failed to load archive from URL:', err);
        hideLoading();
        notify.error(`Failed to load archive: ${err.message}`);
        // Fall back to showing file picker
        const picker = document.getElementById('kiosk-file-picker');
        if (picker) picker.classList.remove('hidden');
    }
}

/**
 * Load an archive directly from the local filesystem via Tauri FS plugin.
 * Bypasses HTTP fetch entirely — no "Downloading..." phase.
 * @param {string} filePath - Local filesystem path to the archive
 */
async function loadArchiveFromTauri(filePath: string): Promise<void> {
    showLoading('Loading archive...', true);
    try {
        const { readFile } = window.__TAURI__.fs;
        updateProgress(5, 'Reading file...');
        const contents = await readFile(filePath);
        const fileName = filePath.split(/[\\/]/).pop() || 'archive.a3d';
        const file = new File([contents], fileName);
        state.archiveSourceUrl = null;
        handleArchiveFile(file);
    } catch (err) {
        log.error('Failed to load archive from filesystem:', err);
        hideLoading();
        notify.error(`Failed to load archive: ${err.message}`);
        const picker = document.getElementById('kiosk-file-picker');
        if (picker) picker.classList.remove('hidden');
    }
}

// =============================================================================
// ARCHIVE PROCESSING
// =============================================================================

// Ensure a single archive asset type is loaded on demand (kiosk version).
async function ensureAssetLoaded(assetType: AssetType, onProgress?: (percent: number, stage: string) => void): Promise<boolean> {
    if (!state.archiveLoader) return false;

    if (state.assetStates[assetType] === ASSET_STATE.LOADED) return true;
    if (state.assetStates[assetType] === ASSET_STATE.ERROR) return false;
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

    showInlineLoading(assetType);
    try {
        const result = await loadArchiveAsset(state.archiveLoader, assetType, { ...createArchiveDeps(), onProgress });
        if (result.loaded) {
            if (assetType === 'splat') state.splatLoaded = true;
            else if (assetType === 'mesh') state.modelLoaded = true;
            else if (assetType === 'pointcloud') state.pointcloudLoaded = true;
        }
        return result.loaded;
    } catch (e) {
        log.error(`Error loading ${assetType}:`, e);
        state.assetStates[assetType] = ASSET_STATE.ERROR;
        return false;
    } finally {
        hideInlineLoading(assetType);
    }
}

// Trigger lazy loading of assets needed for a display mode
function triggerLazyLoad(mode: string): void {
    if (!state.archiveLoaded || !state.archiveLoader) return;
    const neededTypes = getAssetTypesForMode(mode);
    for (const type of neededTypes) {
        if (state.assetStates[type] === ASSET_STATE.UNLOADED) {
            ensureAssetLoaded(type as AssetType).then(loaded => {
                if (loaded) {
                    const deps = createDisplayModeDeps();
                    if (deps.updateVisibility) deps.updateVisibility();
                }
            });
        }
    }
}

async function handleArchiveFile(file: File): Promise<void> {
    log.info('Loading archive:', file.name);
    showLoading('Loading archive...', true);

    try {
        // === Phase 1: Read file + index ZIP directory (no decompression) ===
        updateProgress(5, 'Reading archive...');
        const archiveLoader = await loadArchiveFromFile(file, { state: state as any });

        // Reset asset states for new archive
        state.assetStates = { splat: ASSET_STATE.UNLOADED, mesh: ASSET_STATE.UNLOADED, pointcloud: ASSET_STATE.UNLOADED };

        // Parse manifest + extract thumbnail (small files only)
        updateProgress(15, 'Reading metadata...');
        const phase1 = await processArchivePhase1(archiveLoader, file.name, { state: state as any });
        const { contentInfo } = phase1;
        const manifest = normalizeManifest(phase1.manifest);

        // Resolve quality tier based on device capabilities
        const glContext = renderer ? renderer.getContext() : null;
        state.qualityResolved = resolveQualityTier(state.qualityTier, glContext);
        log.info('Quality tier resolved:', state.qualityResolved);

        // Switch to WebGL BEFORE loading if archive contains splat (Spark.js requires WebGL)
        // This avoids renderer switching mid-load which can cause rendering corruption
        if (contentInfo.hasSplat && sceneManager) {
            await sceneManager.ensureWebGLRenderer();
        }

        // Show branded loading screen with thumbnail, title, and content types
        await showBrandedLoading(archiveLoader);

        // === Phase 2: Load primary asset for initial display ===
        // Set intended display mode early so getPrimaryAssetType loads the right asset first
        if (contentInfo.hasMesh) {
            state.displayMode = 'model';
        } else if (contentInfo.hasSplat) {
            state.displayMode = 'splat';
        } else if (contentInfo.hasPointcloud) {
            state.displayMode = 'pointcloud';
        }
        updateProgress(30, 'Loading 3D data...');
        const primaryType = getPrimaryAssetType(state.displayMode, contentInfo);
        const primaryLoaded = await ensureAssetLoaded(primaryType as AssetType, (pct, stage) => {
            // Map 0-100% from loadArchiveAsset onto 30-80% of the overall progress bar
            updateProgress(30 + pct * 0.5, stage);
        });

        if (!primaryLoaded) {
            // Try any available type as fallback
            const fallbackTypes = ['splat', 'mesh', 'pointcloud'].filter(t => t !== primaryType);
            let anyLoaded = false;
            for (const type of fallbackTypes) {
                if (await ensureAssetLoaded(type as AssetType)) { anyLoaded = true; break; }
            }
            if (!anyLoaded) {
                hideLoading();
                notify.warning('Archive does not contain any viewable content.');
                return;
            }
        }

        // Apply global alignment if present
        const globalAlignment = archiveLoader.getGlobalAlignment();
        if (globalAlignment) {
            applyGlobalAlignment(globalAlignment);
        }

        // Load annotations
        const annotations = archiveLoader.getAnnotations();
        if (annotations && annotations.length > 0) {
            annotationSystem.fromJSON(annotations);
            populateAnnotationList();
            log.info(`Loaded ${annotations.length} annotations`);
        }

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
            log.info(`Extracted ${state.imageAssets.size} embedded images`);
        }

        // Update metadata display
        updateProgress(80, 'Loading metadata...');
        updateArchiveMetadataUI(manifest, archiveLoader);
        prefillMetadataFromArchive(manifest);

        // Populate basic display fields directly from manifest (edit fields are stripped in kiosk mode)
        const displayTitle = document.getElementById('display-title');
        if (displayTitle && manifest.project?.title) displayTitle.textContent = manifest.project.title;
        const displayDesc = document.getElementById('display-description');
        if (displayDesc && manifest.project?.description) {
            displayDesc.innerHTML = parseMarkdown(resolveAssetRefs(manifest.project.description, state.imageAssets));
            displayDesc.style.display = '';
        }
        const displayCreator = document.getElementById('display-creator');
        const displayCreatorRow = document.getElementById('display-creator-row');
        if (displayCreator && displayCreatorRow && manifest.provenance?.operator) {
            displayCreator.textContent = manifest.provenance.operator;
            displayCreatorRow.style.display = '';
        }
        const displayDate = document.getElementById('display-date');
        const displayDateRow = document.getElementById('display-date-row');
        if (displayDate && displayDateRow && manifest.provenance?.capture_date) {
            displayDate.textContent = formatDisplayDate(manifest.provenance.capture_date, 'long') || manifest.provenance.capture_date;
            displayDateRow.style.display = '';
        }
        const displayLocation = document.getElementById('display-location');
        const displayLocationRow = document.getElementById('display-location-row');
        if (displayLocation && displayLocationRow && manifest.provenance?.location) {
            displayLocation.textContent = manifest.provenance.location;
            displayLocationRow.style.display = '';
        }

        // Populate detailed metadata sections (kiosk-specific, more comprehensive than populateMetadataDisplay)
        populateDetailedMetadata(manifest);
        populateDisplayStats(annotationSystem);
        populateSourceFilesList(archiveLoader);
        reorderKioskSidebar();

        // Populate the wall label and info overlay with key metadata
        populateWallLabel(manifest);
        populateInfoOverlay(manifest);

        // Set display mode: default to model, fall back to splat, then pointcloud
        updateProgress(90, 'Finalizing...');
        if (state.modelLoaded) {
            state.displayMode = 'model';
        } else if (state.splatLoaded) {
            state.displayMode = 'splat';
        } else if (state.pointcloudLoaded) {
            state.displayMode = 'pointcloud';
        }
        // Override with saved display mode if specified
        const savedDisplayMode = manifest?.viewer_settings?.display_mode;
        if (savedDisplayMode && ['splat', 'model', 'pointcloud', 'both'].includes(savedDisplayMode)) {
            state.displayMode = savedDisplayMode;
        }
        setDisplayMode(state.displayMode as DisplayMode, createDisplayModeDeps());

        // Show only relevant settings
        showRelevantSettings(state.splatLoaded, state.modelLoaded, state.pointcloudLoaded);

        // Fit camera to loaded content
        fitCameraToScene();

        // Enable shadows in kiosk mode
        sceneManager.enableShadows(true);
        sceneManager.applyShadowProperties(modelGroup);

        // Enable auto-rotate by default in kiosk mode, unless manifest overrides it
        const savedAutoRotate = manifest?.viewer_settings?.auto_rotate;
        controls.autoRotate = savedAutoRotate !== false;
        const autoRotateBtn = document.getElementById('btn-auto-rotate');
        if (controls.autoRotate && autoRotateBtn) autoRotateBtn.classList.add('active');

        // Branch UI setup based on resolved layout (theme + ?layout= override)
        const layoutModule = getLayoutModule();

        if (layoutModule) {
            // Delegate to layout module — it creates its own UI
            layoutModule.setup(manifest, createLayoutDeps());

            // Also populate the sidebar content as a mobile fallback
            // (layout CSS hides it on desktop, media query shows it on mobile)
            createViewSwitcher();
            updateInfoPanel();
        } else {
            // Sidebar layout: standard kiosk UI
            createViewSwitcher();
            updateInfoPanel();

            const archiveSection = document.getElementById('archive-metadata-section');
            if (archiveSection) archiveSection.style.display = '';
        }

        // Apply viewer settings from manifest (after theme, so these override theme defaults)
        if (manifest.viewer_settings) {
            if (manifest.viewer_settings.single_sided !== undefined) {
                const side = manifest.viewer_settings.single_sided ? THREE.FrontSide : THREE.DoubleSide;
                if (modelGroup) {
                    modelGroup.traverse((child: any) => {
                        if (child.isMesh && child.material) {
                            const mats = Array.isArray(child.material) ? child.material : [child.material];
                            mats.forEach((m: any) => { m.side = side; m.needsUpdate = true; });
                        }
                    });
                }
            }
            if (manifest.viewer_settings.background_color && scene) {
                scene.background = new THREE.Color(manifest.viewer_settings.background_color);
            }
            // Apply saved camera position and target (overrides fitCameraToScene result)
            const savedCamPos = manifest.viewer_settings.camera_position;
            const savedCamTarget = manifest.viewer_settings.camera_target;
            if (savedCamPos && savedCamTarget && camera && controls) {
                camera.position.set(savedCamPos.x, savedCamPos.y, savedCamPos.z);
                controls.target.set(savedCamTarget.x, savedCamTarget.y, savedCamTarget.z);
                controls.update();
            }
            // Apply annotations visibility setting
            if (manifest.viewer_settings.annotations_visible === false && annotationSystem) {
                state.annotationsVisible = false;
                const markersContainer = document.getElementById('annotation-markers');
                if (markersContainer) markersContainer.style.display = 'none';
            }
            log.info('Applied viewer settings:', manifest.viewer_settings);
        }

        updateProgress(100, 'Complete');

        // Smooth entry transition: fade overlay + camera ease-in
        smoothTransitionIn();

        // Reveal wall label after transition settles
        setTimeout(showWallLabel, 1400);

        if (layoutModule) {
            // Populate sidebar content for mobile fallback (hidden on desktop by layout CSS)
            showMetadataSidebar('view', { state: state as any, annotationSystem, imageAssets: state.imageAssets });
            populateAnnotationList();
        } else {
            // Add export section to settings tab now that archive data is available
            createExportSection();

            // Show annotation toggle button if annotations exist; reflect saved visibility state
            if (annotationSystem.hasAnnotations()) {
                const annoBtn = document.getElementById('btn-toggle-annotations');
                if (annoBtn) {
                    annoBtn.style.display = '';
                    annoBtn.classList.toggle('active', state.annotationsVisible);
                }
                // Trigger intro glow on markers
                triggerMarkerGlowIntro();
            }

            // Populate sidebar content but start hidden — user opens via info button
            showMetadataSidebar('view', { state: state as any, annotationSystem, imageAssets: state.imageAssets });
            hideMetadataSidebar();
        }

        // Show quality toggle if archive has proxies (layout modules with own toggle handle this)
        if (hasAnyProxy(contentInfo) && !layoutModule?.hasOwnQualityToggle) {
            showQualityToggle();
        }

        log.info('Archive loaded successfully:', file.name);
        notify.success(`Loaded: ${file.name}`);

        // === Phase 3: Background-load remaining assets ===
        const remainingTypes = ['splat', 'mesh', 'pointcloud'].filter(
            t => state.assetStates[t] === ASSET_STATE.UNLOADED
        );
        if (remainingTypes.length > 0) {
            setTimeout(async () => {
                for (const type of remainingTypes) {
                    const typeAvailable = (type === 'splat' && contentInfo.hasSplat) ||
                                          (type === 'mesh' && contentInfo.hasMesh) ||
                                          (type === 'pointcloud' && contentInfo.hasPointcloud);
                    if (typeAvailable) {
                        log.info(`Background loading: ${type}`);
                        await ensureAssetLoaded(type as AssetType);
                        // Update settings visibility after background load
                        showRelevantSettings(state.splatLoaded, state.modelLoaded, state.pointcloudLoaded);
                        // Update visibility to match current display mode
                        const deps = createDisplayModeDeps();
                        if (deps.updateVisibility) deps.updateVisibility();
                        // Re-apply viewer settings to newly loaded meshes
                        if (type === 'mesh' && manifest.viewer_settings?.single_sided !== undefined) {
                            const side = manifest.viewer_settings.single_sided ? THREE.FrontSide : THREE.DoubleSide;
                            modelGroup.traverse((child: any) => {
                                if (child.isMesh && child.material) {
                                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                                    mats.forEach((m: any) => { m.side = side; m.needsUpdate = true; });
                                }
                            });
                        }
                    }
                }
                // Keep archive data available for export downloads
                log.info('All archive assets loaded, raw data retained for export');
            }, 100);
        } else {
            log.info('Archive data retained for export');
        }

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
// QUALITY TIER TOGGLE
// =============================================================================

/**
 * Show the SD/HD quality toggle. Uses existing HTML element if present,
 * otherwise creates one dynamically (for kiosk without index.html).
 */
function showQualityToggle(): void {
    let container = document.getElementById('quality-toggle-container');
    if (!container) {
        // Dynamically create toggle (kiosk offline HTML won't have it)
        container = document.createElement('div');
        container.id = 'quality-toggle-container';
        container.innerHTML = `
            <button class="quality-toggle-btn${state.qualityResolved === 'sd' ? ' active' : ''}" data-tier="sd">SD</button>
            <button class="quality-toggle-btn${state.qualityResolved === 'hd' ? ' active' : ''}" data-tier="hd">HD</button>
        `;
        document.body.appendChild(container);
    } else {
        container.classList.remove('hidden');
        // Set initial active state
        container.querySelectorAll('.quality-toggle-btn').forEach(btn => {
            btn.classList.toggle('active', (btn as HTMLElement).dataset.tier === state.qualityResolved);
        });
    }

    // Wire click handlers
    container.querySelectorAll('.quality-toggle-btn').forEach(btn => {
        btn.addEventListener('click', () => switchQualityTier((btn as HTMLElement).dataset.tier!));
    });
}

/**
 * Switch between SD and HD quality tiers, swapping proxy/full-res assets.
 */
async function switchQualityTier(newTier: string): Promise<void> {
    if (newTier === state.qualityResolved) return;
    state.qualityResolved = newTier;

    // Update button states
    document.querySelectorAll('.quality-toggle-btn').forEach(btn => {
        btn.classList.toggle('active', (btn as HTMLElement).dataset.tier === newTier);
        btn.classList.add('loading');
    });

    const archiveLoader = state.archiveLoader;
    if (!archiveLoader) return;

    const contentInfo = archiveLoader.getContentInfo();
    const deps = createArchiveDeps();

    try {
        // Switch splat if proxy exists
        if (contentInfo.hasSceneProxy) {
            if (newTier === 'hd') {
                await loadArchiveFullResSplat(archiveLoader, deps);
            } else {
                await loadArchiveProxySplat(archiveLoader, deps);
            }
        }
        // Switch mesh if proxy exists
        if (contentInfo.hasMeshProxy) {
            if (newTier === 'hd') {
                await loadArchiveFullResMesh(archiveLoader, deps);
            } else {
                await loadArchiveProxyMesh(archiveLoader, deps);
            }
        }
        log.info(`Quality tier switched to ${newTier}`);
    } catch (e) {
        log.error('Error switching quality tier:', e);
        notify.error(`Failed to switch quality: ${e.message}`);
    } finally {
        document.querySelectorAll('.quality-toggle-btn').forEach(btn => {
            btn.classList.remove('loading');
        });
    }
}

// =============================================================================
// DEPS BUILDERS (matching the deps pattern used by file-handlers.js)
// =============================================================================

function createArchiveDeps(): any {
    return {
        scene,
        modelGroup,
        pointcloudGroup,
        state,
        qualityTier: state.qualityResolved,
        sceneManager,
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
                // Force matrix world update after transforms
                splatMesh.updateMatrixWorld(true);
            },
            onApplyModelTransform: (transform) => {
                if (!modelGroup || !transform) return;

                // Center model on grid if no splat is loaded (matches main viewer behavior)
                // This ensures the model's base position is consistent before applying saved transforms
                if (!state.splatLoaded && modelGroup.children.length > 0) {
                    const box = new THREE.Box3().setFromObject(modelGroup);
                    if (!box.isEmpty()) {
                        const center = box.getCenter(new THREE.Vector3());
                        const size = box.getSize(new THREE.Vector3());
                        modelGroup.updateMatrixWorld(true);
                        const localCenter = modelGroup.worldToLocal(center.clone());
                        for (const child of modelGroup.children) {
                            child.position.x -= localCenter.x;
                            child.position.y -= localCenter.y;
                            child.position.z -= localCenter.z;
                        }
                        modelGroup.position.set(0, size.y / 2, 0);
                    }
                }

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

function createSplatDeps(): any {
    return {
        scene,
        getSplatMesh: () => splatMesh,
        setSplatMesh: (mesh) => { splatMesh = mesh; },
        state,
        sceneManager,
        archiveCreator: null,
        callbacks: {}
    };
}

function createModelDeps(): any {
    return {
        modelGroup,
        state,
        archiveCreator: null,
        callbacks: {}
    };
}

function createPointcloudDeps(): any {
    return {
        pointcloudGroup,
        state,
        archiveCreator: null,
        callbacks: {}
    };
}

function createDisplayModeDeps(): any {
    const canvasRight = document.getElementById('viewer-canvas-right');
    return {
        state,
        canvasRight,
        onResize: () => onWindowResize(),
        updateVisibility: () => {
            const showSplat = state.displayMode === 'splat' || state.displayMode === 'both' || state.displayMode === 'split';
            const showModel = state.displayMode === 'model' || state.displayMode === 'both' || state.displayMode === 'split';
            const showPointcloud = state.displayMode === 'pointcloud' || state.displayMode === 'both' || state.displayMode === 'split';

            // Helper to set opacity on all materials in an object
            const setOpacity = (obj: any, opacity: number) => {
                obj.traverse((child: any) => {
                    if (child.material) {
                        const mats = Array.isArray(child.material) ? child.material : [child.material];
                        mats.forEach((m: any) => {
                            m.transparent = true;
                            m.opacity = opacity;
                            m.needsUpdate = true;
                        });
                    }
                });
            };

            // Helper to animate fade-in for regular meshes
            const fadeIn = (obj: any, duration: number = 500) => {
                obj.visible = true;
                setOpacity(obj, 0);
                const startTime = performance.now();
                const animate = () => {
                    const elapsed = performance.now() - startTime;
                    const progress = Math.min(elapsed / duration, 1);
                    setOpacity(obj, progress);
                    if (progress < 1) requestAnimationFrame(animate);
                };
                animate();
            };

            // Helper to animate fade-in for SplatMesh (uses .opacity property)
            const fadeInSplat = (splat: any, duration: number = 500) => {
                splat.visible = true;
                splat.opacity = 0;
                const startTime = performance.now();
                const animate = () => {
                    const elapsed = performance.now() - startTime;
                    const progress = Math.min(elapsed / duration, 1);
                    splat.opacity = progress;
                    if (progress < 1) requestAnimationFrame(animate);
                };
                animate();
            };

            // Splat: instant hide, fade-in show (uses SplatMesh.opacity property)
            if (splatMesh) {
                if (showSplat && !splatMesh.visible) fadeInSplat(splatMesh);
                else if (!showSplat) splatMesh.visible = false;
            }

            // Model: instant hide, fade-in show
            if (modelGroup) {
                if (showModel && !modelGroup.visible) fadeIn(modelGroup);
                else if (!showModel) modelGroup.visible = false;
            }

            // Pointcloud: instant hide, fade-in show
            if (pointcloudGroup) {
                if (showPointcloud && !pointcloudGroup.visible) fadeIn(pointcloudGroup);
                else if (!showPointcloud) pointcloudGroup.visible = false;
            }
        }
    };
}

/**
 * Build the dependency object for theme layout modules.
 * Layout modules receive everything via this object — no ES imports.
 */
function createLayoutDeps(): any {
    return {
        Logger,
        escapeHtml,
        parseMarkdown,
        resolveAssetRefs,
        updateModelTextures,
        updateModelWireframe,
        updateModelMatcap,
        updateModelNormals,
        updateModelRoughness,
        updateModelMetalness,
        updateModelSpecularF0,
        sceneManager,
        state,
        annotationSystem,
        measurementSystem,
        modelGroup,
        setDisplayMode,
        createDisplayModeDeps,
        triggerLazyLoad,
        showAnnotationPopup,
        hideAnnotationPopup,
        hideAnnotationLine,
        getCurrentPopupId: () => currentPopupAnnotationId,
        setCurrentPopupId: (id) => { currentPopupAnnotationId = id; },
        themeBaseUrl: (window.APP_CONFIG?.theme) ? `themes/${window.APP_CONFIG.theme}/` : '',
        themeAssets: window.__KIOSK_THEME_ASSETS__ || {},
        hasAnyProxy: hasAnyProxy(state.archiveLoader ? state.archiveLoader.getContentInfo() : {}),
        qualityResolved: state.qualityResolved,
        switchQualityTier,
        metadataProfile: state.archiveManifest?.metadata_profile || 'archival',
        isTierVisible,
        EDITORIAL_SECTION_TIERS,
    };
}

// =============================================================================
// UI SETUP
// =============================================================================

function setupViewerUI(): void {
    // Standard kiosk: create wall label + info overlay (layout modules with own panels skip this)
    if (!getLayoutModule()?.hasOwnInfoPanel) {
        createWallLabel();
        createInfoOverlay();
    }

    // Display mode buttons (with lazy loading trigger)
    ['model', 'splat', 'pointcloud', 'both', 'split'].forEach(mode => {
        addListener(`btn-${mode}`, 'click', () => {
            state.displayMode = mode;
            setDisplayMode(mode as DisplayMode, createDisplayModeDeps());
            // Lazy-load any needed assets not yet loaded
            if (state.archiveLoaded && state.archiveLoader) {
                const neededTypes = getAssetTypesForMode(mode);
                for (const type of neededTypes) {
                    if (state.assetStates[type] === ASSET_STATE.UNLOADED) {
                        ensureAssetLoaded(type as AssetType).then(loaded => {
                            if (loaded) {
                                const deps = createDisplayModeDeps();
                                if (deps.updateVisibility) deps.updateVisibility();
                            }
                        });
                    }
                }
            }
        });
    });

    // Measurement tool
    const measureBtn = document.getElementById('btn-measure');
    if (measureBtn) {
        measureBtn.style.display = '';
        measureBtn.addEventListener('click', () => {
            if (!measurementSystem) return;
            const active = !measurementSystem.isActive;
            measurementSystem.setMeasureMode(active);
            measureBtn.classList.toggle('active', active);
            const panel = document.getElementById('measure-scale-panel');
            if (panel) panel.classList.toggle('hidden', !active);
        });
    }

    // Escape exits measure mode and clears measurements
    document.addEventListener('keydown', (e: KeyboardEvent) => {
        if (e.key === 'Escape' && measurementSystem?.isActive) {
            measurementSystem.setMeasureMode(false);
            measurementSystem.clearAll();
            if (measureBtn) measureBtn.classList.remove('active');
            const panel = document.getElementById('measure-scale-panel');
            if (panel) panel.classList.add('hidden');
        }
    });
    let _kioskScaleUnit = 'm';
    addListener('measure-scale-value', 'input', (e) => {
        const val = parseFloat((e as InputEvent & { target: HTMLInputElement }).target.value);
        if (measurementSystem && !isNaN(val) && val > 0) {
            measurementSystem.setScale(val, _kioskScaleUnit);
        }
    });
    addListener('measure-scale-unit', 'change', (e) => {
        _kioskScaleUnit = (e as Event & { target: HTMLSelectElement }).target.value;
        const valueInput = document.getElementById('measure-scale-value') as HTMLInputElement | null;
        const val = valueInput ? parseFloat(valueInput.value) : 1;
        if (measurementSystem && !isNaN(val) && val > 0) {
            measurementSystem.setScale(val, _kioskScaleUnit);
        }
    });
    addListener('measure-clear-all', 'click', () => {
        if (measurementSystem) measurementSystem.clearAll();
    });

    // Fullscreen toggle
    const fullscreenBtn = document.getElementById('btn-fullscreen');
    if (!document.fullscreenEnabled) {
        if (fullscreenBtn) fullscreenBtn.style.display = 'none';
    } else {
        if (fullscreenBtn) {
            fullscreenBtn.addEventListener('click', () => {
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen();
                } else {
                    document.exitFullscreen();
                }
            });
        }
        document.addEventListener('fullscreenchange', () => {
            if (fullscreenBtn) fullscreenBtn.classList.toggle('is-fullscreen', !!document.fullscreenElement);
        });
        document.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'F11') {
                e.preventDefault();
                if (!document.fullscreenElement) {
                    document.documentElement.requestFullscreen();
                } else {
                    document.exitFullscreen();
                }
            }
        });
    }

    // Fly mode toggle
    addListener('btn-fly-mode', 'click', toggleFlyMode);

    // Auto-rotate toggle
    addListener('btn-auto-rotate', 'click', () => {
        controls.autoRotate = !controls.autoRotate;
        const btn = document.getElementById('btn-auto-rotate');
        if (btn) btn.classList.toggle('active', controls.autoRotate);
    });

    // Disable auto-rotate on manual interaction so users can inspect freely
    controls.addEventListener('start', () => {
        if (controls.autoRotate) {
            controls.autoRotate = false;
            const btn = document.getElementById('btn-auto-rotate');
            if (btn) btn.classList.remove('active');
        }
    });

    // Metadata info toggle — overlay on desktop, sidebar on mobile
    addListener('btn-metadata', 'click', () => {
        if (isMobileKiosk()) {
            const sidebar = document.getElementById('metadata-sidebar');
            if (sidebar && !sidebar.classList.contains('hidden')) {
                hideMetadataSidebar();
            } else {
                showMetadataSidebar('view', { state: state as any, annotationSystem, imageAssets: state.imageAssets });
                setSheetSnap('half');
            }
        } else {
            toggleInfoOverlay();
        }
    });

    // Grid toggle
    addListener('toggle-gridlines', 'change', (e) => {
        sceneManager.toggleGrid((e.target as HTMLInputElement).checked);
    });

    // Background color presets
    document.querySelectorAll('.swatch[data-color]').forEach(btn => {
        btn.addEventListener('click', () => {
            const color = (btn as HTMLElement).dataset.color;
            sceneManager.setBackgroundColor(color!);
            document.querySelectorAll('.swatch[data-color]').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            const picker = document.getElementById('bg-color-picker') as HTMLInputElement;
            if (picker) picker.value = color!;
        });
    });

    // Custom background color
    addListener('bg-color-picker', 'input', (e) => {
        sceneManager.setBackgroundColor((e.target as HTMLInputElement).value);
        document.querySelectorAll('.swatch[data-color]').forEach(b => b.classList.remove('active'));
    });

    // Model settings
    addListener('model-scale', 'input', (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value);
        if (modelGroup) modelGroup.scale.setScalar(val);
        const label = document.getElementById('model-scale-value');
        if (label) label.textContent = val.toFixed(1);
    });
    addListener('model-opacity', 'input', (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value);
        updateModelOpacity(modelGroup, val);
        const label = document.getElementById('model-opacity-value');
        if (label) label.textContent = val.toFixed(1);
    });
    addListener('model-wireframe', 'change', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.checked) {
            const matcapCb = document.getElementById('model-matcap') as HTMLInputElement;
            if (matcapCb?.checked) {
                matcapCb.checked = false;
                const styleGroup = document.getElementById('matcap-style-group') as HTMLElement;
                if (styleGroup) styleGroup.style.display = 'none';
                updateModelMatcap(modelGroup, false);
            }
            const normalsCb = document.getElementById('model-normals') as HTMLInputElement;
            if (normalsCb?.checked) {
                normalsCb.checked = false;
                updateModelNormals(modelGroup, false);
            }
            const roughCb = document.getElementById('model-roughness') as HTMLInputElement;
            if (roughCb?.checked) { roughCb.checked = false; updateModelRoughness(modelGroup, false); }
            const metalCb = document.getElementById('model-metalness') as HTMLInputElement;
            if (metalCb?.checked) { metalCb.checked = false; updateModelMetalness(modelGroup, false); }
            const f0Cb = document.getElementById('model-specular-f0') as HTMLInputElement;
            if (f0Cb?.checked) { f0Cb.checked = false; updateModelSpecularF0(modelGroup, false); }
        }
        updateModelWireframe(modelGroup, target.checked);
    });
    addListener('model-matcap', 'change', (e) => {
        const target = e.target as HTMLInputElement;
        const styleGroup = document.getElementById('matcap-style-group') as HTMLElement;
        if (styleGroup) styleGroup.style.display = target.checked ? '' : 'none';
        if (target.checked) {
            const wireCb = document.getElementById('model-wireframe') as HTMLInputElement;
            if (wireCb?.checked) {
                wireCb.checked = false;
                updateModelWireframe(modelGroup, false);
            }
            const normalsCb = document.getElementById('model-normals') as HTMLInputElement;
            if (normalsCb?.checked) {
                normalsCb.checked = false;
                updateModelNormals(modelGroup, false);
            }
            const roughCb = document.getElementById('model-roughness') as HTMLInputElement;
            if (roughCb?.checked) { roughCb.checked = false; updateModelRoughness(modelGroup, false); }
            const metalCb = document.getElementById('model-metalness') as HTMLInputElement;
            if (metalCb?.checked) { metalCb.checked = false; updateModelMetalness(modelGroup, false); }
            const f0Cb = document.getElementById('model-specular-f0') as HTMLInputElement;
            if (f0Cb?.checked) { f0Cb.checked = false; updateModelSpecularF0(modelGroup, false); }
        }
        const matcapStyle = (document.getElementById('matcap-style') as HTMLInputElement)?.value || 'clay';
        updateModelMatcap(modelGroup, target.checked, matcapStyle);
    });
    addListener('matcap-style', 'change', (e) => {
        const matcapCb = document.getElementById('model-matcap') as HTMLInputElement;
        if (matcapCb?.checked) {
            updateModelMatcap(modelGroup, true, (e.target as HTMLInputElement).value);
        }
    });
    addListener('model-normals', 'change', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.checked) {
            const wireCb = document.getElementById('model-wireframe') as HTMLInputElement;
            if (wireCb?.checked) {
                wireCb.checked = false;
                updateModelWireframe(modelGroup, false);
            }
            const matcapCb = document.getElementById('model-matcap') as HTMLInputElement;
            if (matcapCb?.checked) {
                matcapCb.checked = false;
                const styleGroup = document.getElementById('matcap-style-group') as HTMLElement;
                if (styleGroup) styleGroup.style.display = 'none';
                updateModelMatcap(modelGroup, false);
            }
            const roughCb = document.getElementById('model-roughness') as HTMLInputElement;
            if (roughCb?.checked) { roughCb.checked = false; updateModelRoughness(modelGroup, false); }
            const metalCb = document.getElementById('model-metalness') as HTMLInputElement;
            if (metalCb?.checked) { metalCb.checked = false; updateModelMetalness(modelGroup, false); }
            const f0Cb = document.getElementById('model-specular-f0') as HTMLInputElement;
            if (f0Cb?.checked) { f0Cb.checked = false; updateModelSpecularF0(modelGroup, false); }
        }
        updateModelNormals(modelGroup, target.checked);
    });
    addListener('model-roughness', 'change', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.checked) {
            const wireCb = document.getElementById('model-wireframe') as HTMLInputElement;
            if (wireCb?.checked) { wireCb.checked = false; updateModelWireframe(modelGroup, false); }
            const matcapCb = document.getElementById('model-matcap') as HTMLInputElement;
            if (matcapCb?.checked) {
                matcapCb.checked = false;
                const styleGroup = document.getElementById('matcap-style-group') as HTMLElement;
                if (styleGroup) styleGroup.style.display = 'none';
                updateModelMatcap(modelGroup, false);
            }
            const normalsCb = document.getElementById('model-normals') as HTMLInputElement;
            if (normalsCb?.checked) { normalsCb.checked = false; updateModelNormals(modelGroup, false); }
            const metalCb = document.getElementById('model-metalness') as HTMLInputElement;
            if (metalCb?.checked) { metalCb.checked = false; updateModelMetalness(modelGroup, false); }
            const f0Cb = document.getElementById('model-specular-f0') as HTMLInputElement;
            if (f0Cb?.checked) { f0Cb.checked = false; updateModelSpecularF0(modelGroup, false); }
        }
        updateModelRoughness(modelGroup, target.checked);
    });
    addListener('model-metalness', 'change', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.checked) {
            const wireCb = document.getElementById('model-wireframe') as HTMLInputElement;
            if (wireCb?.checked) { wireCb.checked = false; updateModelWireframe(modelGroup, false); }
            const matcapCb = document.getElementById('model-matcap') as HTMLInputElement;
            if (matcapCb?.checked) {
                matcapCb.checked = false;
                const styleGroup = document.getElementById('matcap-style-group') as HTMLElement;
                if (styleGroup) styleGroup.style.display = 'none';
                updateModelMatcap(modelGroup, false);
            }
            const normalsCb = document.getElementById('model-normals') as HTMLInputElement;
            if (normalsCb?.checked) { normalsCb.checked = false; updateModelNormals(modelGroup, false); }
            const roughCb = document.getElementById('model-roughness') as HTMLInputElement;
            if (roughCb?.checked) { roughCb.checked = false; updateModelRoughness(modelGroup, false); }
            const f0Cb = document.getElementById('model-specular-f0') as HTMLInputElement;
            if (f0Cb?.checked) { f0Cb.checked = false; updateModelSpecularF0(modelGroup, false); }
        }
        updateModelMetalness(modelGroup, target.checked);
    });
    addListener('model-specular-f0', 'change', (e) => {
        const target = e.target as HTMLInputElement;
        if (target.checked) {
            const wireCb = document.getElementById('model-wireframe') as HTMLInputElement;
            if (wireCb?.checked) { wireCb.checked = false; updateModelWireframe(modelGroup, false); }
            const matcapCb = document.getElementById('model-matcap') as HTMLInputElement;
            if (matcapCb?.checked) {
                matcapCb.checked = false;
                const styleGroup = document.getElementById('matcap-style-group') as HTMLElement;
                if (styleGroup) styleGroup.style.display = 'none';
                updateModelMatcap(modelGroup, false);
            }
            const normalsCb = document.getElementById('model-normals') as HTMLInputElement;
            if (normalsCb?.checked) { normalsCb.checked = false; updateModelNormals(modelGroup, false); }
            const roughCb = document.getElementById('model-roughness') as HTMLInputElement;
            if (roughCb?.checked) { roughCb.checked = false; updateModelRoughness(modelGroup, false); }
            const metalCb = document.getElementById('model-metalness') as HTMLInputElement;
            if (metalCb?.checked) { metalCb.checked = false; updateModelMetalness(modelGroup, false); }
        }
        updateModelSpecularF0(modelGroup, target.checked);
    });
    addListener('model-no-texture', 'change', (e) => {
        updateModelTextures(modelGroup, !(e.target as HTMLInputElement).checked);
    });

    // Camera FOV
    addListener('camera-fov', 'input', (e) => {
        const fov = parseInt((e.target as HTMLInputElement).value, 10);
        const valueEl = document.getElementById('camera-fov-value');
        if (valueEl) valueEl.textContent = String(fov);
        if (sceneManager && sceneManager.camera) {
            sceneManager.camera.fov = fov;
            sceneManager.camera.updateProjectionMatrix();
        }
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
            const val = parseFloat((e.target as HTMLInputElement).value);
            sceneManager.setLightIntensity(type, val);
            const label = document.getElementById(`${id}-value`);
            if (label) label.textContent = val.toFixed(1);
        });
    });

    // Point cloud settings
    addListener('pointcloud-scale', 'input', (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value);
        if (pointcloudGroup) pointcloudGroup.scale.setScalar(val);
        const label = document.getElementById('pointcloud-scale-value');
        if (label) label.textContent = val.toFixed(1);
    });
    addListener('pointcloud-point-size', 'input', (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value);
        updatePointcloudPointSize(pointcloudGroup, val);
        const label = document.getElementById('pointcloud-point-size-value');
        if (label) label.textContent = val.toFixed(3);
    });
    addListener('pointcloud-opacity', 'input', (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value);
        updatePointcloudOpacity(pointcloudGroup, val);
        const label = document.getElementById('pointcloud-opacity-value');
        if (label) label.textContent = val.toFixed(1);
    });

    // Splat settings
    addListener('splat-scale', 'input', (e) => {
        const val = parseFloat((e.target as HTMLInputElement).value);
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

    // Annotation visibility toggle
    addListener('btn-toggle-annotations', 'click', () => {
        state.annotationsVisible = !state.annotationsVisible;
        const btn = document.getElementById('btn-toggle-annotations');
        const markersContainer = document.getElementById('annotation-markers');
        if (btn) btn.classList.toggle('active', state.annotationsVisible);
        if (markersContainer) {
            markersContainer.style.display = state.annotationsVisible ? '' : 'none';
        }
        // Hide popup when hiding all markers
        if (!state.annotationsVisible && currentPopupAnnotationId) {
            hideAnnotationPopup();
            currentPopupAnnotationId = null;
            annotationSystem.selectedAnnotation = null;
            hideAnnotationLine();
        }
    });

    // Cross-section toggle
    addListener('btn-toggle-crosssection', 'click', () => {
        const btn = document.getElementById('btn-toggle-crosssection');
        if (!crossSection) return;
        if (crossSection.active) {
            crossSection.stop();
            sceneManager!.setLocalClippingEnabled(false);
            if (btn) btn.classList.remove('active');
        } else {
            const box = new THREE.Box3();
            box.expandByObject(modelGroup);
            box.expandByObject(pointcloudGroup);
            const center = new THREE.Vector3();
            if (!box.isEmpty()) box.getCenter(center);
            sceneManager!.setLocalClippingEnabled(true);
            crossSection.start(center);
            if (btn) btn.classList.add('active');
        }
    });

    // Create SVG overlay for annotation connecting lines
    const svgOverlay = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svgOverlay.id = 'annotation-line-overlay';
    const svgLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    svgLine.style.display = 'none';
    svgOverlay.appendChild(svgLine);
    document.body.appendChild(svgOverlay);
    annotationLineEl = svgLine;

    // On mobile, move annotation toggle out of toolbar so position:fixed works
    // (backdrop-filter on toolbar creates a containing block that breaks fixed positioning)
    repositionAnnotationToggle();
}

function setupViewerKeyboardShortcuts(): void {
    const lm = getLayoutModule();
    setupKeyboardShortcuts({
        'f': () => toggleFlyMode(),
        'm': () => {
            if (lm?.onKeyboardShortcut?.('m')) return;
            toggleInfoOverlay();
        },
        '1': () => switchViewMode('model'),
        '2': () => switchViewMode('splat'),
        '3': () => switchViewMode('pointcloud'),
        'g': () => {
            const cb = document.getElementById('toggle-gridlines') as HTMLInputElement;
            if (cb) { cb.checked = !cb.checked; sceneManager.toggleGrid(cb.checked); }
        },
        'escape': () => {
            if (!lm?.onKeyboardShortcut?.('escape')) {
                // Default: close standard info overlay
                const overlay = document.getElementById('kiosk-info-overlay');
                if (overlay && overlay.classList.contains('open')) {
                    toggleInfoOverlay(false);
                }
            }
            hideAnnotationPopup();
            currentPopupAnnotationId = null;
        }
    });
}

// =============================================================================
// VIEW SWITCHER
// =============================================================================

function switchViewMode(mode: string): void {
    state.displayMode = mode;
    setDisplayMode(mode as DisplayMode, createDisplayModeDeps());
    triggerLazyLoad(mode);

    // Update active button state (sidebar layout)
    document.querySelectorAll('.kiosk-view-btn').forEach(btn => {
        const isActive = (btn as HTMLElement).dataset.mode === mode;
        btn.classList.toggle('active', isActive);
        btn.setAttribute('aria-selected', isActive ? 'true' : 'false');
        (btn as HTMLElement).tabIndex = isActive ? 0 : -1;
    });
    // Notify layout module of view mode change
    getLayoutModule()?.onViewModeChange?.(mode);
}

// =============================================================================
// Full-Screen Info Overlay (replaces sidebar on desktop)
// =============================================================================

function createInfoOverlay(): void {
    if (document.getElementById('kiosk-info-overlay')) return;

    const overlay = document.createElement('div');
    overlay.id = 'kiosk-info-overlay';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-label', 'Object details');

    overlay.innerHTML = `
        <button class="kiosk-info-close" aria-label="Close details">\u00d7</button>
        <div class="kiosk-info-spread">
            <div class="kiosk-info-col-left">
                <h2 class="kiosk-info-title"></h2>
                <hr class="kiosk-info-rule">
                <p class="kiosk-info-byline"></p>
                <div class="kiosk-info-description"></div>
                <div class="kiosk-info-tags"></div>
                <div class="kiosk-info-license"></div>
            </div>
            <div class="kiosk-info-divider"></div>
            <div class="kiosk-info-col-right"></div>
        </div>
    `;

    // Close button
    const closeBtn = overlay.querySelector('.kiosk-info-close');
    if (closeBtn) closeBtn.addEventListener('click', () => toggleInfoOverlay(false));

    // Click backdrop to close
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) toggleInfoOverlay(false);
    });

    document.body.appendChild(overlay);
}

function populateInfoOverlay(manifest: any): void {
    const overlay = document.getElementById('kiosk-info-overlay');
    if (!overlay) return;

    const titleEl = overlay.querySelector('.kiosk-info-title') as HTMLElement | null;
    const bylineEl = overlay.querySelector('.kiosk-info-byline') as HTMLElement | null;
    const descEl = overlay.querySelector('.kiosk-info-description') as HTMLElement | null;
    const tagsEl = overlay.querySelector('.kiosk-info-tags') as HTMLElement | null;
    const licenseEl = overlay.querySelector('.kiosk-info-license') as HTMLElement | null;
    const rightCol = overlay.querySelector('.kiosk-info-col-right') as HTMLElement | null;

    const title = manifest.project?.title;
    const creator = manifest.provenance?.operator;
    const captureDate = manifest.provenance?.capture_date;
    const location = manifest.provenance?.location;
    const description = manifest.project?.description;
    const tags = manifest.project?.tags;
    const license = manifest.archival_record?.rights || manifest.project?.license;

    // Title
    if (titleEl) titleEl.textContent = title || 'Untitled';

    // Byline: creator · date · location
    if (bylineEl) {
        const parts: string[] = [];
        if (creator) parts.push(creator);
        if (captureDate) {
            parts.push(formatDisplayDate(captureDate, 'medium') || captureDate);
        }
        if (location) parts.push(location);
        if (parts.length > 0) {
            bylineEl.textContent = parts.join(' \u00b7 ');
        } else {
            bylineEl.style.display = 'none';
        }
    }

    // Description (markdown rendered)
    if (descEl) {
        if (description) {
            descEl.innerHTML = parseMarkdown(resolveAssetRefs(description, state.imageAssets));
        } else {
            descEl.style.display = 'none';
        }
    }

    // Tags
    if (tagsEl) {
        const tagList = Array.isArray(tags) ? tags : (typeof tags === 'string' && tags ? tags.split(',').map(t => t.trim()) : []);
        if (tagList.length > 0) {
            tagsEl.innerHTML = tagList.map(t => `<span class="kiosk-info-tag">${t}</span>`).join('');
        } else {
            tagsEl.style.display = 'none';
        }
    }

    // License
    if (licenseEl) {
        if (license) {
            licenseEl.innerHTML = linkifyValue(typeof license === 'object' ? (license.credit_line || license.copyright_status || JSON.stringify(license)) : license);
        } else {
            licenseEl.style.display = 'none';
        }
    }

    // Right column: move sidebar display-content into overlay via DOM reparenting
    if (rightCol) {
        const sidebarContent = document.querySelector('#sidebar-view .display-content');
        if (sidebarContent) {
            rightCol.appendChild(sidebarContent);
        }
    }
}

function toggleInfoOverlay(show?: boolean): void {
    const overlay = document.getElementById('kiosk-info-overlay');
    if (!overlay) return;

    const isOpen = overlay.classList.contains('open');
    const shouldShow = show !== undefined ? show : !isOpen;

    overlay.classList.toggle('open', shouldShow);

    // Update toolbar button active state
    const btn = document.getElementById('btn-metadata');
    if (btn) btn.classList.toggle('active', shouldShow);
}

// =============================================================================
// Wall Label — persistent metadata placard (museum-style)
// =============================================================================

function createWallLabel(): void {
    // Don't duplicate
    if (document.getElementById('kiosk-wall-label')) return;

    const label = document.createElement('aside');
    label.id = 'kiosk-wall-label';
    label.setAttribute('aria-label', 'Object information');

    label.innerHTML = `
        <h2 class="wall-label-title"></h2>
        <p class="wall-label-byline"></p>
        <p class="wall-label-desc"></p>
        <button class="wall-label-details-btn" aria-label="Show full details">Details &#8250;</button>
    `;

    // Wire details button to open info overlay (falls back to sidebar on mobile)
    const detailsBtn = label.querySelector('.wall-label-details-btn');
    if (detailsBtn) {
        detailsBtn.addEventListener('click', () => {
            if (window.innerWidth > 768) {
                toggleInfoOverlay(true);
            } else {
                showMetadataSidebar('view', { state: state as any, annotationSystem, imageAssets: state.imageAssets });
            }
        });
    }

    document.body.appendChild(label);
}

function populateWallLabel(manifest: any): void {
    const label = document.getElementById('kiosk-wall-label');
    if (!label) return;

    const titleEl = label.querySelector('.wall-label-title') as HTMLElement | null;
    const bylineEl = label.querySelector('.wall-label-byline') as HTMLElement | null;
    const descEl = label.querySelector('.wall-label-desc') as HTMLElement | null;

    const title = manifest.project?.title;
    const creator = manifest.provenance?.operator;
    const captureDate = manifest.provenance?.capture_date;
    const description = manifest.project?.description;

    // Title
    if (titleEl) {
        titleEl.textContent = title || 'Untitled';
    }

    // Byline: "Creator · February 2026" or just one
    if (bylineEl) {
        const parts: string[] = [];
        if (creator) parts.push(creator);
        if (captureDate) {
            parts.push(formatDisplayDate(captureDate, 'medium') || captureDate);
        }
        if (parts.length > 0) {
            bylineEl.textContent = parts.join(' \u00b7 ');
        } else {
            bylineEl.style.display = 'none';
        }
    }

    // Description (plain text, no markdown in the wall label)
    if (descEl) {
        if (description) {
            // Strip markdown to plain text for the wall label
            descEl.textContent = description.replace(/[#*_`[\]()>~-]/g, '').trim();
        } else {
            descEl.style.display = 'none';
        }
    }

    // Hide details button if no meaningful metadata beyond title
    if (!creator && !captureDate && !description) {
        const btn = label.querySelector('.wall-label-details-btn') as HTMLElement | null;
        if (btn) btn.style.display = 'none';
    }
}

function showWallLabel(): void {
    const label = document.getElementById('kiosk-wall-label');
    if (label) label.classList.add('visible');
}

function createViewSwitcher(): void {
    // Remove existing switcher if recreating
    const existing = document.getElementById('kiosk-view-switcher');
    if (existing) existing.remove();

    // Use contentInfo from archive to know what types are available
    const contentInfo = state.archiveLoader ? state.archiveLoader.getContentInfo() : null;
    const types: { mode: string; label: string }[] = [];
    if (contentInfo) {
        if (contentInfo.hasMesh) types.push({ mode: 'model', label: 'Mesh' });
        if (contentInfo.hasSplat) types.push({ mode: 'splat', label: 'Scan' });
        if (contentInfo.hasPointcloud) types.push({ mode: 'pointcloud', label: 'Points' });
    } else {
        if (state.modelLoaded) types.push({ mode: 'model', label: 'Mesh' });
        if (state.splatLoaded) types.push({ mode: 'splat', label: 'Scan' });
        if (state.pointcloudLoaded) types.push({ mode: 'pointcloud', label: 'Points' });
    }

    // Only show view buttons if 2+ types available
    if (types.length < 2) return;

    const toolbar = document.getElementById('kiosk-toolbar');
    if (!toolbar) return;

    // Add separator between tool buttons and view buttons
    const sep = document.createElement('div');
    sep.className = 'kiosk-toolbar-sep';
    toolbar.appendChild(sep);

    // Create view switcher wrapper (display:contents — children flow into toolbar)
    const pill = document.createElement('div');
    pill.id = 'kiosk-view-switcher';
    pill.className = 'kiosk-view-switcher';
    pill.setAttribute('role', 'tablist');
    pill.setAttribute('aria-label', 'View mode');

    types.forEach(({ mode, label }) => {
        const btn = document.createElement('button');
        btn.className = 'kiosk-view-btn';
        btn.dataset.mode = mode;
        btn.textContent = label;
        btn.setAttribute('role', 'tab');
        btn.setAttribute('aria-selected', state.displayMode === mode ? 'true' : 'false');
        if (state.displayMode === mode) btn.classList.add('active');
        if (state.displayMode !== mode) btn.setAttribute('tabindex', '-1');
        btn.addEventListener('click', () => switchViewMode(mode));
        btn.addEventListener('keydown', (e: KeyboardEvent) => {
            const btns = Array.from(pill.querySelectorAll('.kiosk-view-btn')) as HTMLButtonElement[];
            let idx = btns.indexOf(btn);
            if (e.key === 'ArrowRight' || e.key === 'ArrowDown') { e.preventDefault(); idx = (idx + 1) % btns.length; btns[idx].focus(); btns[idx].click(); }
            if (e.key === 'ArrowLeft' || e.key === 'ArrowUp') { e.preventDefault(); idx = (idx - 1 + btns.length) % btns.length; btns[idx].focus(); btns[idx].click(); }
        });
        pill.appendChild(btn);
    });

    toolbar.appendChild(pill);
}

function repositionViewSwitcher(): void {
    // View switcher now lives inside the toolbar — no repositioning needed
}

// =============================================================================
// VIEWER FEATURES
// =============================================================================

function toggleFlyMode(): void {
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

function fitCameraToScene(): void {
    const box = new THREE.Box3();
    let hasContent = false;

    if (splatMesh && splatMesh.visible) {
        // Use SplatMesh.getBoundingBox() instead of expandByObject()
        // expandByObject() doesn't work correctly with Spark.js SplatMesh
        if (typeof splatMesh.getBoundingBox === 'function') {
            const splatBox = splatMesh.getBoundingBox(false); // centers_only=false for full extent
            if (splatBox && !splatBox.isEmpty()) {
                box.union(splatBox);
                hasContent = true;
            }
        } else {
            // Fallback to expandByObject if getBoundingBox doesn't exist
            box.expandByObject(splatMesh);
            hasContent = true;
        }
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

    // FOV-aware distance calculation to fill 90% of viewport
    const targetFill = 0.90;
    const fov = camera.fov * (Math.PI / 180);
    const aspect = camera.aspect;

    const verticalDist = (size.y / 2) / Math.tan(fov / 2) / targetFill;
    const horizontalDist = (size.x / 2) / Math.tan((fov * aspect) / 2) / targetFill;
    const distance = Math.max(verticalDist, horizontalDist, (size.z / 2) + 0.5);

    // Slight angle for a more interesting default view
    camera.position.set(
        center.x + distance * 0.3,
        center.y + distance * 0.2,
        center.z + distance * 0.9
    );
    camera.lookAt(center);
    controls.target.copy(center);
    controls.update();
}

function applyGlobalAlignment(alignment: any): void {
    if (!alignment) return;

    // Apply object transforms (position, rotation, scale)
    if (alignment.splat && splatMesh) {
        splatMesh.position.fromArray(alignment.splat.position);
        splatMesh.rotation.set(...alignment.splat.rotation as [number, number, number]);
        splatMesh.scale.setScalar(alignment.splat.scale);
    }
    if (alignment.model && modelGroup) {
        modelGroup.position.fromArray(alignment.model.position);
        modelGroup.rotation.set(...alignment.model.rotation as [number, number, number]);
        modelGroup.scale.setScalar(alignment.model.scale);
    }
    if (alignment.pointcloud && pointcloudGroup) {
        pointcloudGroup.position.fromArray(alignment.pointcloud.position);
        pointcloudGroup.rotation.set(...alignment.pointcloud.rotation as [number, number, number]);
        pointcloudGroup.scale.setScalar(alignment.pointcloud.scale);
    }

    // Apply orbit controls target and camera position
    if (alignment.target) {
        controls.target.set(alignment.target[0], alignment.target[1], alignment.target[2]);
    }
    if (alignment.camera) {
        camera.position.set(alignment.camera[0], alignment.camera[1], alignment.camera[2]);
    }
    controls.update();
}

/**
 * Reorder the kiosk sidebar so the layout is:
 *   Title > Description > Annotations > Detail collapsibles > Creator/Date/Location/Device/License
 * Called after all sidebar sections have been populated.
 */
function reorderKioskSidebar(): void {
    const viewContent = document.querySelector('#sidebar-view .display-content');
    if (!viewContent) return;

    // Gather the sections we want to reorder
    const annoHeader = viewContent.querySelector('.kiosk-anno-header');
    const annoList = document.getElementById('kiosk-annotation-list');
    const detailSections = viewContent.querySelectorAll('.kiosk-detail-section');
    const details = viewContent.querySelector('.display-details');
    const license = document.getElementById('display-license-row');
    const stats = document.getElementById('display-stats');

    // Find all dividers (we'll re-add them as needed)
    const dividers = viewContent.querySelectorAll('.display-divider');

    // Remove dividers (we'll create fresh ones where needed)
    dividers.forEach(d => d.remove());

    // Move annotations right after description (remove first, then re-insert)
    const description = document.getElementById('display-description');
    const insertAfter = description || viewContent.querySelector('.display-title');
    if (!insertAfter) return;

    const addDivider = (beforeEl) => {
        const d = document.createElement('div');
        d.className = 'display-divider';
        viewContent.insertBefore(d, beforeEl);
    };

    // 1. Annotations block — right after description
    if (annoHeader && annoList) {
        const annoDiv = annoHeader.previousElementSibling;
        if (annoDiv && annoDiv.classList.contains('display-divider')) annoDiv.remove();

        // Insert after description
        const afterDesc = insertAfter.nextSibling;
        addDivider(afterDesc);
        viewContent.insertBefore(annoHeader, afterDesc);
        viewContent.insertBefore(annoList, afterDesc);
    }

    // 2. Detail collapsibles — after annotations (or after description if no annotations)
    if (detailSections.length > 0) {
        // Find the spot right before details/license/stats
        const refNode = details || license || stats;
        if (refNode) {
            addDivider(refNode);
            detailSections.forEach(s => viewContent.insertBefore(s, refNode));
        }
    }

    // 3. Details (Creator/Date/Location/Device), License, Stats — stay at the end
    // They're already at the end by default, just add a divider before them
    if (details && (details as HTMLElement).style.display !== 'none') {
        addDivider(details);
    }
}

function populateAnnotationList(): void {
    const annotations = annotationSystem.getAnnotations();
    if (annotations.length === 0) return;

    const viewContent = document.querySelector('#sidebar-view .display-content');
    if (!viewContent) return;

    // Create annotation section in sidebar
    const divider = document.createElement('div');
    divider.className = 'display-divider';
    viewContent.appendChild(divider);

    const header = document.createElement('div');
    header.className = 'kiosk-anno-header';
    header.textContent = 'Annotations';
    viewContent.appendChild(header);

    const listContainer = document.createElement('div');
    listContainer.id = 'kiosk-annotation-list';
    viewContent.appendChild(listContainer);

    annotations.forEach((anno, i) => {
        const item = document.createElement('div');
        item.className = 'kiosk-anno-item';
        item.dataset.annoId = anno.id;

        const badge = document.createElement('span');
        badge.className = 'kiosk-anno-badge';
        badge.textContent = String(i + 1);
        item.appendChild(badge);

        const info = document.createElement('div');
        info.className = 'kiosk-anno-info';

        const title = document.createElement('span');
        title.className = 'kiosk-anno-title';
        title.textContent = anno.title || 'Untitled';
        info.appendChild(title);

        if (anno.body) {
            const preview = document.createElement('span');
            preview.className = 'kiosk-anno-preview';
            // Strip markdown-like formatting for preview
            const plainText = anno.body.replace(/[*_#[\]()]/g, '');
            preview.textContent = plainText.substring(0, 80) + (plainText.length > 80 ? '...' : '');
            info.appendChild(preview);
        }

        item.appendChild(info);

        item.addEventListener('click', () => {
            if (currentPopupAnnotationId === anno.id) {
                if (isMobileKiosk()) {
                    hideMobileAnnotationDetail();
                    setSheetSnap('peek');
                } else {
                    hideAnnotationPopup();
                    hideAnnotationLine();
                }
                currentPopupAnnotationId = null;
                annotationSystem.selectedAnnotation = null;
                document.querySelectorAll('.annotation-marker.selected').forEach(m => m.classList.remove('selected'));
                document.querySelectorAll('.kiosk-anno-item.active').forEach(c => c.classList.remove('active'));
                // If annotations hidden globally, re-hide the single marker
                if (!state.annotationsVisible) {
                    hideSingleMarker();
                }
            } else {
                document.querySelectorAll('.kiosk-anno-item.active').forEach(c => c.classList.remove('active'));
                item.classList.add('active');
                // If annotations hidden globally, show only this marker
                if (!state.annotationsVisible) {
                    showSingleMarker(anno.id);
                }
                annotationSystem.goToAnnotation(anno.id);
                if (isMobileKiosk()) {
                    currentPopupAnnotationId = anno.id;
                    showMobileAnnotationDetail(anno);
                } else {
                    currentPopupAnnotationId = showAnnotationPopup(anno, state.imageAssets);
                }
            }
        });

        listContainer.appendChild(item);
    });
}

// --- Detailed metadata helpers ---

function hasValue(val: any): boolean {
    if (val === null || val === undefined || val === '') return false;
    if (Array.isArray(val)) return val.length > 0;
    if (typeof val === 'object') {
        return Object.keys(val).filter(k => !k.startsWith('_')).some(k => hasValue(val[k]));
    }
    return true;
}

function escapeHtml(str: any): string {
    if (typeof str !== 'string') str = String(str);
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Escape HTML, then convert [title](url) markdown links and bare URLs to clickable <a> tags */
function linkifyValue(str: any): string {
    let html = escapeHtml(str);
    // Markdown links: [text](url)
    html = html.replace(
        /\[([^\]]+)\]\(([^)]+)\)/g,
        '<a href="$2" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>'
    );
    // Auto-link bare URLs not already in href
    html = html.replace(
        /(?<!href="|src=")(https?:\/\/[^\s<"&]+)/g,
        '<a href="$1" target="_blank" rel="noopener noreferrer" class="md-link">$1</a>'
    );
    return html;
}

function createDetailSection(title: string): { section: HTMLElement; content: HTMLElement } {
    const section = document.createElement('div');
    section.className = 'kiosk-detail-section';

    const header = document.createElement('div');
    header.className = 'kiosk-detail-header';
    header.innerHTML = `<span class="kiosk-detail-title">${escapeHtml(title)}</span><span class="kiosk-detail-chevron">&#9654;</span>`;

    const content = document.createElement('div');
    content.className = 'kiosk-detail-content';
    content.style.display = 'none';

    header.addEventListener('click', () => {
        const isOpen = header.classList.toggle('open');
        content.style.display = isOpen ? '' : 'none';
    });

    section.appendChild(header);
    section.appendChild(content);
    return { section, content };
}

function addDetailRow(container: HTMLElement, label: string, value: any): void {
    if (!hasValue(value)) return;
    const row = document.createElement('div');
    row.className = 'display-detail';
    const displayVal = typeof value === 'object' ? JSON.stringify(value) : String(value);
    row.innerHTML = `<span class="display-label">${escapeHtml(label)}</span><span class="display-value">${linkifyValue(displayVal)}</span>`;
    container.appendChild(row);
}

function populateDetailedMetadata(manifest: any): void {
    if (!manifest) return;

    const viewContent = document.querySelector('#sidebar-view .display-content');
    if (!viewContent) return;

    const sections = [];

    // 1. Quality & Accuracy
    const qm = manifest.quality_metrics;
    if (hasValue(qm)) {
        const { section, content } = createDetailSection('Quality & Accuracy');
        addDetailRow(content, 'Tier', qm.tier);
        addDetailRow(content, 'Accuracy Grade', qm.accuracy_grade);
        if (hasValue(qm.capture_resolution)) {
            const cr = qm.capture_resolution;
            addDetailRow(content, 'Capture Resolution', cr.value != null ? `${cr.value} ${cr.unit || ''}`.trim() : cr);
        }
        if (hasValue(qm.alignment_error)) {
            const ae = qm.alignment_error;
            addDetailRow(content, 'Alignment Error', ae.value != null ? `${ae.value} ${ae.unit || ''} (${ae.method || 'unknown'})`.trim() : ae);
        }
        addDetailRow(content, 'Scale Verification', qm.scale_verification);
        if (hasValue(qm.data_quality)) {
            const dq = qm.data_quality;
            Object.keys(dq).forEach(k => addDetailRow(content, k.replace(/_/g, ' '), dq[k]));
        }
        // Texture info from quality stats
        const texCount = qm.texture_count || manifest._meta?.quality?.texture_count;
        const texMaxRes = qm.texture_max_resolution || manifest._meta?.quality?.texture_max_resolution;
        if (texCount && texCount > 0) {
            addDetailRow(content, 'Textures', `${texCount} maps, max ${texMaxRes}×${texMaxRes}`);
        }
        const texMaps = qm.texture_maps || manifest._meta?.quality?.texture_maps;
        if (Array.isArray(texMaps) && texMaps.length > 0) {
            texMaps.forEach((m: any) => {
                const label = (m.type || '').replace(/([A-Z])/g, ' $1').replace(/^./, (s: string) => s.toUpperCase());
                addDetailRow(content, `  ${label}`, `${m.width}×${m.height}`);
            });
        }
        if (content.children.length > 0) sections.push(section);
    }

    // 2. Processing Details
    const prov = manifest.provenance;
    if (hasValue(prov)) {
        const { section, content } = createDetailSection('Processing Details');
        addDetailRow(content, 'Device Serial', prov.device_serial);
        addDetailRow(content, 'Operator ORCID', prov.operator_orcid);
        if (Array.isArray(prov.processing_software)) {
            prov.processing_software.forEach(sw => {
                addDetailRow(content, 'Software', typeof sw === 'object' ? `${sw.name || ''} ${sw.version || ''}`.trim() : sw);
            });
        }
        addDetailRow(content, 'Processing Notes', prov.processing_notes);
        addDetailRow(content, 'Convention Hints', prov.convention_hints);
        if (content.children.length > 0) sections.push(section);
    }

    // 3. Data Assets
    const entries = manifest.data_entries;
    if (Array.isArray(entries) && entries.length > 0) {
        const { section, content } = createDetailSection('Data Assets');
        entries.forEach((entry, i) => {
            if (i > 0) {
                const sep = document.createElement('div');
                sep.style.borderTop = '1px solid rgba(78,205,196,0.06)';
                sep.style.margin = '6px 0';
                content.appendChild(sep);
            }
            addDetailRow(content, 'File', entry.file_name || entry.filename);
            addDetailRow(content, 'Role', entry.role);
            addDetailRow(content, 'Created By', entry.created_by);
            addDetailRow(content, 'Notes', entry._source_notes);
        });
        if (content.children.length > 0) sections.push(section);
    }

    // 4. Archival Record
    const ar = manifest.archival_record;
    if (hasValue(ar)) {
        const { section, content } = createDetailSection('Archival Record');
        addDetailRow(content, 'Standard', ar.standard);
        addDetailRow(content, 'Title', ar.title);
        if (Array.isArray(ar.alternate_titles) && ar.alternate_titles.length > 0) {
            addDetailRow(content, 'Alternate Titles', ar.alternate_titles.join(', '));
        }
        if (hasValue(ar.ids)) {
            Object.keys(ar.ids).forEach(k => addDetailRow(content, `ID (${k})`, ar.ids[k]));
        }
        if (hasValue(ar.creation)) {
            const c = ar.creation;
            addDetailRow(content, 'Creator', c.creator);
            addDetailRow(content, 'Date', c.date_created);
            addDetailRow(content, 'Period', c.period);
            addDetailRow(content, 'Culture', c.culture);
        }
        if (hasValue(ar.physical_description)) {
            const pd = ar.physical_description;
            Object.keys(pd).forEach(k => addDetailRow(content, k.replace(/_/g, ' '), pd[k]));
        }
        addDetailRow(content, 'Provenance', ar.provenance);
        if (hasValue(ar.rights)) {
            const r = ar.rights;
            addDetailRow(content, 'Copyright', r.copyright_status);
            addDetailRow(content, 'Credit', r.credit_line);
        }
        if (hasValue(ar.context)) {
            const ctx = ar.context;
            Object.keys(ctx).forEach(k => addDetailRow(content, k.replace(/_/g, ' '), ctx[k]));
        }
        if (hasValue(ar.coverage)) {
            if (hasValue(ar.coverage.spatial)) {
                const sp = ar.coverage.spatial;
                Object.keys(sp).forEach(k => addDetailRow(content, `Spatial ${k}`, sp[k]));
            }
            if (hasValue(ar.coverage.temporal)) {
                const t = ar.coverage.temporal;
                Object.keys(t).forEach(k => addDetailRow(content, `Temporal ${k}`, t[k]));
            }
        }
        if (content.children.length > 0) sections.push(section);
    }

    // 5. Material Properties
    const ms = manifest.material_standard;
    if (hasValue(ms)) {
        const { section, content } = createDetailSection('Material Properties');
        addDetailRow(content, 'Workflow', ms.workflow);
        addDetailRow(content, 'Color Space', ms.color_space);
        addDetailRow(content, 'Normal Space', ms.normal_space);
        addDetailRow(content, 'Occlusion Packed', ms.occlusion_packed);
        if (content.children.length > 0) sections.push(section);
    }

    // 6. Relationships
    const rel = manifest.relationships;
    if (hasValue(rel)) {
        const { section, content } = createDetailSection('Relationships');
        addDetailRow(content, 'Part Of', rel.part_of);
        addDetailRow(content, 'Derived From', rel.derived_from);
        addDetailRow(content, 'Replaces', rel.replaces);
        if (Array.isArray(rel.related_objects)) {
            rel.related_objects.forEach(obj => {
                addDetailRow(content, obj.relation || 'Related', obj.id || obj.title || JSON.stringify(obj));
            });
        }
        if (content.children.length > 0) sections.push(section);
    }

    // 7. Preservation
    const pres = manifest.preservation;
    if (hasValue(pres)) {
        const { section, content } = createDetailSection('Preservation');
        if (Array.isArray(pres.format_registry)) {
            pres.format_registry.forEach(fr => {
                addDetailRow(content, 'Format', typeof fr === 'object' ? `${fr.name || ''} (${fr.id || ''})`.trim() : fr);
            });
        }
        if (Array.isArray(pres.significant_properties)) {
            pres.significant_properties.forEach(sp => addDetailRow(content, 'Property', sp));
        }
        addDetailRow(content, 'Rendering Requirements', pres.rendering_requirements);
        addDetailRow(content, 'Rendering Notes', pres.rendering_notes);
        if (content.children.length > 0) sections.push(section);
    }

    // 8. Version History
    const vh = manifest.version_history;
    if (Array.isArray(vh) && vh.length > 0) {
        const { section, content } = createDetailSection('Version History');
        vh.forEach(entry => {
            const parts = [];
            if (entry.version) parts.push(`v${entry.version}`);
            if (entry.date) parts.push(entry.date);
            addDetailRow(content, parts.join(' — ') || 'Entry', entry.description || entry.notes || '');
        });
        if (content.children.length > 0) sections.push(section);
    }

    // 9. Custom Fields
    const cf = manifest._meta && manifest._meta.custom_fields;
    if (hasValue(cf)) {
        const { section, content } = createDetailSection('Custom Fields');
        Object.keys(cf).forEach(k => addDetailRow(content, k, cf[k]));
        if (content.children.length > 0) sections.push(section);
    }

    // 10. Integrity
    const integ = manifest.integrity;
    if (hasValue(integ)) {
        const { section, content } = createDetailSection('Integrity');
        addDetailRow(content, 'Algorithm', integ.algorithm);
        addDetailRow(content, 'Manifest Hash', integ.manifest_hash);
        if (hasValue(integ.assets)) {
            Object.keys(integ.assets).forEach(filename => {
                addDetailRow(content, filename, integ.assets[filename]);
            });
        }
        if (content.children.length > 0) sections.push(section);
    }

    // Filter sections by metadata profile
    const profile = (manifest?.metadata_profile || 'archival') as MetadataProfile;
    const filteredSections = sections.filter(section => {
        const titleEl = section.querySelector('.kiosk-detail-title');
        const title = titleEl?.textContent || '';
        const tier = KIOSK_SECTION_TIERS[title];
        return !tier || isTierVisible(tier, profile);
    });

    if (filteredSections.length === 0) return;

    // Insert before annotation section if it exists, otherwise append
    const annoHeader = viewContent.querySelector('.kiosk-anno-header');
    const annoDivider = annoHeader ? annoHeader.previousElementSibling : null;
    const insertBefore = (annoDivider && annoDivider.classList.contains('display-divider')) ? annoDivider : annoHeader;

    // Add a divider before the detail sections
    const divider = document.createElement('div');
    divider.className = 'display-divider';

    if (insertBefore) {
        viewContent.insertBefore(divider, insertBefore);
        filteredSections.forEach(s => viewContent.insertBefore(s, insertBefore));
    } else {
        viewContent.appendChild(divider);
        filteredSections.forEach(s => viewContent.appendChild(s));
    }

    log.info(`Populated ${filteredSections.length} detailed metadata sections`);
}

function formatBytes(bytes: number): string {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    if (bytes < 1024 * 1024 * 1024) return (bytes / (1024 * 1024)).toFixed(1) + ' MB';
    return (bytes / (1024 * 1024 * 1024)).toFixed(1) + ' GB';
}

function populateSourceFilesList(archiveLoader: ArchiveLoader): void {
    const sourceEntries = archiveLoader.getSourceFileEntries();
    if (sourceEntries.length === 0) return;

    const viewContent = document.querySelector('#sidebar-view .display-content');
    if (!viewContent) return;

    const categoryLabels = {
        raw_photography: 'Raw Photography',
        processing_report: 'Processing Report',
        ground_control: 'Ground Control Points',
        calibration: 'Calibration Data',
        project_file: 'Project File',
        reference: 'Reference Material',
        other: 'Other'
    };

    const { section, content } = createDetailSection(`Source Files (${sourceEntries.length})`);

    let totalSize = 0;
    sourceEntries.forEach(({ entry }) => {
        const name = entry.original_name || entry.file_name || 'Unknown';
        const size = entry.size_bytes || 0;
        totalSize += size;
        const cat = entry.source_category || '';
        const catLabel = cat ? categoryLabels[cat] || cat.replace(/_/g, ' ') : '';

        const row = document.createElement('div');
        row.className = 'display-detail';
        row.innerHTML =
            `<span class="display-label" style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap" title="${escapeHtml(name)}">${escapeHtml(name)}</span>` +
            `<span class="display-value">${escapeHtml(formatBytes(size))}${catLabel ? ' · ' + escapeHtml(catLabel) : ''}</span>`;
        content.appendChild(row);
    });

    // Total size summary
    if (sourceEntries.length > 1) {
        const summary = document.createElement('div');
        summary.style.cssText = 'font-size:0.75em;opacity:0.6;margin-top:6px;text-align:right;';
        summary.textContent = `Total: ${formatBytes(totalSize)}`;
        content.appendChild(summary);
    }

    // Guidance note
    const note = document.createElement('div');
    note.style.cssText = 'font-size:0.75em;opacity:0.5;margin-top:8px;font-style:italic;';
    note.textContent = 'Source files are included in the .a3d archive. Unpack to access.';
    content.appendChild(note);

    viewContent.appendChild(section);
    log.info(`Populated source files list: ${sourceEntries.length} files, ${formatBytes(totalSize)}`);
}

function updateInfoPanel(): void {
    const setInfo = (id, text) => {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    };

    if (splatMesh) {
        setInfo('splat-vertices', 'Loaded');
    }
    if (modelGroup && modelGroup.children.length > 0) {
        let faceCount = 0;
        modelGroup.traverse((child: any) => {
            if (child.isMesh && child.geometry) {
                const idx = child.geometry.index;
                faceCount += idx ? idx.count / 3 : (child.geometry.getAttribute('position')?.count || 0) / 3;
            }
        });
        setInfo('model-faces', faceCount.toLocaleString());
    }
    if (pointcloudGroup && pointcloudGroup.children.length > 0) {
        let pointCount = 0;
        pointcloudGroup.traverse((child: any) => {
            if (child.isPoints && child.geometry) {
                const pos = child.geometry.getAttribute('position');
                if (pos) pointCount += pos.count;
            }
        });
        setInfo('pointcloud-points', pointCount.toLocaleString());
    }
}

function populateDisplayStats(annotationSystem: any): void {
    // Update display stats in sidebar
    const splatStat = document.getElementById('display-splat-stat');
    const splatCount = document.getElementById('display-splat-count');
    if (splatStat && splatCount) {
        if (state.splatLoaded) {
            const count = document.getElementById('splat-vertices')?.textContent || '-';
            splatCount.textContent = count;
            splatStat.style.display = '';
        } else {
            splatStat.style.display = 'none';
        }
    }

    const meshStat = document.getElementById('display-mesh-stat');
    const meshCount = document.getElementById('display-mesh-count');
    if (meshStat && meshCount) {
        if (state.modelLoaded) {
            const count = document.getElementById('model-faces')?.textContent || '-';
            meshCount.textContent = count;
            meshStat.style.display = '';
        } else {
            meshStat.style.display = 'none';
        }
    }

    const pcStat = document.getElementById('display-pointcloud-stat');
    const pcCount = document.getElementById('display-pointcloud-count');
    if (pcStat && pcCount) {
        if (state.pointcloudLoaded) {
            const count = document.getElementById('pointcloud-points')?.textContent || '-';
            pcCount.textContent = count;
            pcStat.style.display = '';
        } else {
            pcStat.style.display = 'none';
        }
    }

    const annoStat = document.getElementById('display-anno-stat');
    const annoCount = document.getElementById('display-anno-count');
    if (annoStat && annoCount && annotationSystem) {
        const count = annotationSystem.getCount();
        if (count > 0) {
            annoCount.textContent = count.toString();
            annoStat.style.display = '';
        } else {
            annoStat.style.display = 'none';
        }
    }

    // Hide stats section if nothing to show
    const statsSection = document.getElementById('display-stats');
    if (statsSection) {
        const hasStats = state.splatLoaded || state.modelLoaded || state.pointcloudLoaded || (annotationSystem && annotationSystem.getCount() > 0);
        statsSection.style.display = hasStats ? '' : 'none';
    }
}

// =============================================================================
// HIDE EDITOR-ONLY UI
// =============================================================================

function hideEditorOnlyUI(): void {
    // Move metadata sidebar OUT of #props-panel before hiding it.
    // In the editor layout, #metadata-sidebar lives inside #props-panel.
    // Kiosk mode hides #props-panel (display:none), which would hide the sidebar too.
    const sidebar = document.getElementById('metadata-sidebar');
    const appContainer = document.getElementById('app');
    if (sidebar && appContainer && sidebar.closest('#props-panel')) {
        appContainer.appendChild(sidebar);
    }

    // Hide tool rail, props panel, status bar (CSS already does this for body.kiosk-mode,
    // but belt-and-suspenders for robustness)
    hideEl('tool-rail');
    hideEl('props-panel');
    hideEl('status-bar');

    // Hide bottom annotation bar (annotations shown in sidebar instead)
    hideEl('annotation-bar');

    // Uncheck grid checkbox — grid is never created in kiosk mode
    const gridCb = document.getElementById('toggle-gridlines') as HTMLInputElement;
    if (gridCb) gridCb.checked = false;

    // Create floating kiosk toolbar — move essential buttons out of hidden containers
    createKioskToolbar();

    // Hide editor-only sidebar tabs
    const editTab = document.querySelector('.sidebar-mode-tab[data-mode="edit"]') as HTMLElement;
    if (editTab) editTab.style.display = 'none';
    const annoTab = document.querySelector('.sidebar-mode-tab[data-mode="annotations"]') as HTMLElement;
    if (annoTab) annoTab.style.display = 'none';

    // Rename View tab to Info
    const viewTab = document.querySelector('.sidebar-mode-tab[data-mode="view"]');
    if (viewTab) viewTab.textContent = 'Info';

    // Move scene settings into sidebar as a tab
    moveSettingsToSidebar();
}

/**
 * Create a floating toolbar for kiosk mode with essential control buttons.
 * Moves buttons from their hidden parent containers (tool-rail, props-panel)
 * into a fixed-position toolbar overlay.
 */
// SVG icon paths (24x24 viewBox, stroke-based, 2px stroke)
const KIOSK_ICONS: Record<string, string> = {
    info: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="16" x2="12" y2="12"/><line x1="12" y1="8" x2="12.01" y2="8"/></svg>',
    fullscreen: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="15 3 21 3 21 9"/><polyline points="9 21 3 21 3 15"/><line x1="21" y1="3" x2="14" y2="10"/><line x1="3" y1="21" x2="10" y2="14"/></svg>',
    pin: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/></svg>',
    ruler: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 20l20-20"/><path d="M5.5 13.5L8 11"/><path d="M9.5 9.5L12 7"/><path d="M13.5 5.5L16 3"/></svg>',
    scissors: '<svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><line x1="20" y1="4" x2="8.12" y2="15.88"/><line x1="14.47" y1="14.48" x2="20" y2="20"/><line x1="8.12" y1="8.12" x2="12" y2="12"/></svg>',
};

function createKioskToolbar(): void {
    const toolbar = document.createElement('div');
    toolbar.id = 'kiosk-toolbar';

    // Buttons to move: [id, label, iconKey]
    const buttons: [string, string, string][] = [
        ['btn-metadata', 'Info', 'info'],
        ['btn-fullscreen', 'Fullscreen', 'fullscreen'],
        ['btn-toggle-annotations', 'Annotations', 'pin'],
        ['btn-toggle-crosssection', 'Slice', 'scissors'],
        ['btn-measure', 'Measure', 'ruler'],
    ];

    for (const [id, label, iconKey] of buttons) {
        const existing = document.getElementById(id);
        if (existing) {
            existing.className = 'kiosk-tool-btn';
            existing.id = id;
            existing.setAttribute('aria-label', label);
            existing.setAttribute('title', label);
            existing.innerHTML = KIOSK_ICONS[iconKey] || '';
            toolbar.appendChild(existing);
        }
    }

    if (toolbar.children.length > 0) {
        document.body.appendChild(toolbar);
    }
}

function hideEl(id: string): void {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
}

/**
 * Move scene settings into the metadata sidebar as a "Settings" tab.
 * In the new layout, scene settings live in #pane-scene inside the props panel.
 * Uses DOM appendChild which preserves all event listeners.
 */
function moveSettingsToSidebar(): void {
    const sidebar = document.getElementById('metadata-sidebar');
    const scenePane = document.getElementById('pane-scene');
    if (!sidebar || !scenePane) return;

    // 1. Add "Settings" tab button
    const tabBar = sidebar.querySelector('.sidebar-mode-tabs');
    if (tabBar) {
        const settingsTab = document.createElement('button');
        settingsTab.className = 'sidebar-mode-tab';
        settingsTab.dataset.mode = 'settings';
        settingsTab.textContent = 'Settings';
        tabBar.appendChild(settingsTab);
        settingsTab.addEventListener('click', () => {
            switchSidebarMode('settings', {});
        });
    }

    // 2. Create sidebar content div for settings
    const settingsContent = document.createElement('div');
    settingsContent.className = 'sidebar-mode-content';
    settingsContent.id = 'sidebar-settings';

    // 3. Move .prop-section elements from scene pane (preserves event listeners)
    const sections = Array.from(scenePane.querySelectorAll('.prop-section'));
    sections.forEach(section => {
        settingsContent.appendChild(section);
    });

    // 4. Insert into sidebar before footer
    const footer = sidebar.querySelector('.sidebar-footer');
    if (footer) {
        sidebar.insertBefore(settingsContent, footer);
    } else {
        sidebar.appendChild(settingsContent);
    }

    log.info('Scene settings moved into sidebar');
}

/**
 * Build the "Export" collapsible section and append it to the settings tab.
 * Called after archive is fully loaded so state.archiveLoader/archiveManifest are available.
 */
function createExportSection(): void {
    const settingsContainer = document.getElementById('sidebar-settings');
    if (!settingsContainer || !state.archiveLoader) return;

    // Remove existing export section if present (e.g. when loading a second archive)
    const existing = settingsContainer.querySelector('.export-section');
    if (existing) existing.remove();

    // Determine base filename from project title or archive filename
    const title = state.archiveManifest?.project?.title;
    const baseName = sanitizeFilename(title || stripExtension(state.archiveFileName || 'archive'));

    // Get content info
    const contentInfo = state.archiveLoader.getContentInfo();
    const sceneEntry = state.archiveLoader.getSceneEntry();
    const meshEntry = state.archiveLoader.getMeshEntry();
    const pcEntry = state.archiveLoader.getPointcloudEntry();

    // Build the collapsible section using the standard prop-section pattern
    const section = document.createElement('div');
    section.className = 'prop-section export-section';

    const header = document.createElement('div');
    header.className = 'prop-section-hd';
    header.innerHTML = '<span class="prop-section-title">Export</span><span class="prop-section-chevron">&#9654;</span>';
    header.addEventListener('click', () => {
        section.classList.toggle('open');
    });

    const content = document.createElement('div');
    content.className = 'prop-section-body';

    // --- Full archive download (only when loaded from URL) ---
    if (state.archiveSourceUrl) {
        const archiveBtn = createExportButton(
            'Download Full Archive (.a3d)',
            `${baseName}.a3d`,
            async (_btn) => {
                const a = document.createElement('a');
                a.href = state.archiveSourceUrl;
                a.download = `${baseName}.a3d`;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                log.info(`Archive download initiated from source URL`);
            }
        );
        content.appendChild(archiveBtn);

        const archiveNote = document.createElement('p');
        archiveNote.className = 'export-note';
        archiveNote.textContent = 'Full archive includes metadata, annotations, version history, and source files if present.';
        content.appendChild(archiveNote);
    }

    // --- Individual assets ---
    const assets = [];
    if (contentInfo.hasMesh && meshEntry) {
        const ext = getFileExtension(meshEntry.file_name);
        assets.push({ label: `3D Model (${ext})`, entry: meshEntry, filename: `${baseName}${ext}` });
    }
    if (contentInfo.hasSplat && sceneEntry) {
        const ext = getFileExtension(sceneEntry.file_name);
        assets.push({ label: `Gaussian Splat (${ext})`, entry: sceneEntry, filename: `${baseName}${ext}` });
    }
    if (contentInfo.hasPointcloud && pcEntry) {
        const ext = getFileExtension(pcEntry.file_name);
        assets.push({ label: `Point Cloud (${ext})`, entry: pcEntry, filename: `${baseName}${ext}` });
    }

    if (assets.length > 0) {
        const subHeader = document.createElement('div');
        subHeader.className = 'export-individual-label';
        subHeader.textContent = 'Individual Assets';
        content.appendChild(subHeader);

        for (const asset of assets) {
            const btn = createExportButton(asset.label, asset.filename, async (_btnEl) => {
                const result = await state.archiveLoader.extractFile(asset.entry.file_name);
                if (result) {
                    downloadBlob(result.blob, asset.filename);
                }
            });
            content.appendChild(btn);
        }
    }

    section.appendChild(header);
    section.appendChild(content);
    settingsContainer.appendChild(section);
    log.info('Export section added to settings');
}

/**
 * Create a styled export button with loading state handling.
 */
function createExportButton(label: string, filename: string, onClick: (btn: HTMLButtonElement) => Promise<void>): HTMLButtonElement {
    const btn = document.createElement('button');
    btn.className = 'export-btn';
    btn.textContent = label;
    btn.addEventListener('click', async () => {
        const origText = btn.textContent;
        btn.disabled = true;
        btn.textContent = 'Preparing download...';
        try {
            await onClick(btn);
        } catch (err) {
            log.error('Export failed:', err);
            notify.error(`Export failed: ${err.message}`);
        } finally {
            btn.disabled = false;
            btn.textContent = origText;
        }
    });
    return btn;
}

/** Sanitize a string for use as a filename */
function sanitizeFilename(name: string): string {
    return name.replace(/[<>:"/\\|?*]/g, '-').replace(/\s+/g, ' ').trim() || 'archive';
}

/** Strip file extension from a filename */
function stripExtension(filename: string): string {
    return filename.replace(/\.[^.]+$/, '');
}

/** Get file extension including the dot (e.g. ".glb") */
function getFileExtension(filename: string): string {
    const match = filename.match(/\.[^.]+$/);
    return match ? match[0] : '';
}

/**
 * Show only settings sections and display mode buttons relevant to the loaded data.
 */
function showRelevantSettings(hasSplat: boolean, hasMesh: boolean, hasPointcloud: boolean): void {
    // After DOM move, sections live in #sidebar-settings (from #pane-scene)
    const container = document.getElementById('sidebar-settings');
    if (!container) return;

    const sections = container.querySelectorAll('.prop-section');
    sections.forEach(section => {
        const header = section.querySelector('.prop-section-title');
        const text = header?.textContent?.trim().toLowerCase() || '';
        if (text.startsWith('model settings') && !hasMesh) (section as HTMLElement).style.display = 'none';
        if (text.startsWith('splat settings') && !hasSplat) (section as HTMLElement).style.display = 'none';
        if (text.startsWith('point cloud settings') && !hasPointcloud) (section as HTMLElement).style.display = 'none';
    });

    // In kiosk mode, hide editing controls (scale, opacity, position, rotation)
    // but keep visual controls (wireframe, hide textures, lighting)
    const hideByIds = [
        'model-scale', 'model-opacity', 'splat-scale',
        'pointcloud-scale', 'pointcloud-point-size', 'pointcloud-opacity'
    ];
    hideByIds.forEach(id => {
        const el = document.getElementById(id);
        if (el) (el.closest('.sl-row') as HTMLElement)?.style.setProperty('display', 'none');
    });
    // Hide all position/rotation inputs
    container.querySelectorAll('.xyz-block').forEach(el => {
        (el as HTMLElement).style.display = 'none';
    });
    // Hide entire splat and pointcloud settings (no useful kiosk controls remain)
    sections.forEach(section => {
        const header = section.querySelector('.prop-section-title');
        const text = header?.textContent?.trim().toLowerCase() || '';
        if (text.startsWith('splat settings')) (section as HTMLElement).style.display = 'none';
        if (text.startsWith('point cloud settings')) (section as HTMLElement).style.display = 'none';
    });

    // Hide display mode buttons for absent data types
    if (!hasMesh) hideEl('btn-model');
    if (!hasSplat) hideEl('btn-splat');
    if (!hasPointcloud) hideEl('btn-pointcloud');
    if (!hasMesh || !hasSplat) { hideEl('btn-both'); hideEl('btn-split'); }

    // STL button only visible when the mesh is actually an STL file
    const meshEntry = state.archiveLoader ? state.archiveLoader.getMeshEntry() : null;
    const isSTL = meshEntry && meshEntry.file_name && meshEntry.file_name.toLowerCase().endsWith('.stl');
    if (!isSTL) hideEl('btn-stl');

    // Hide entire Display Mode section if 0 or 1 button visible
    const displaySection = Array.from(container.querySelectorAll('.prop-section'))
        .find(s => s.querySelector('.prop-section-title')?.textContent?.trim() === 'Display Mode');
    if (displaySection) {
        const visibleButtons = displaySection.querySelectorAll('.prop-btn:not([style*="display: none"])');
        if (visibleButtons.length <= 1) (displaySection as HTMLElement).style.display = 'none';
    }
}

// =============================================================================
// WINDOW RESIZE
// =============================================================================

function isMobileKiosk(): boolean {
    return window.innerWidth <= 768 && document.body.classList.contains('kiosk-mode');
}

function setSheetSnap(snap: SheetSnap): void {
    const sidebar = document.getElementById('metadata-sidebar');
    if (!sidebar) return;
    sidebar.classList.remove('sheet-peek', 'sheet-half', 'sheet-full');
    sidebar.classList.add('sheet-' + snap);
    currentSheetSnap = snap;
}

function setupBottomSheetDrag(): void {
    const handle = document.getElementById('sidebar-drag-handle');
    const sidebar = document.getElementById('metadata-sidebar');
    if (!handle || !sidebar) return;

    let isDragging = false;
    let startY = 0;
    let startTranslateY = 0;
    let lastY = 0;
    let lastTime = 0;
    let velocity = 0;

    const VELOCITY_THRESHOLD = 0.4; // px/ms

    function getCurrentTranslateY() {
        const style = getComputedStyle(sidebar);
        const matrix = new DOMMatrix(style.transform);
        return matrix.m42;
    }

    handle.addEventListener('pointerdown', (e) => {
        if (!isMobileKiosk()) return;
        isDragging = true;
        startY = e.clientY;
        startTranslateY = getCurrentTranslateY();
        lastY = e.clientY;
        lastTime = Date.now();
        velocity = 0;
        sidebar.classList.add('sheet-dragging');
        handle.setPointerCapture(e.pointerId);
        e.preventDefault();
    });

    handle.addEventListener('pointermove', (e) => {
        if (!isDragging) return;
        const deltaY = e.clientY - startY;
        const newTranslateY = Math.max(0, startTranslateY + deltaY);
        sidebar.style.transform = `translateY(${newTranslateY}px)`;

        // Track velocity
        const now = Date.now();
        const dt = now - lastTime;
        if (dt > 0) {
            velocity = (e.clientY - lastY) / dt;
        }
        lastY = e.clientY;
        lastTime = now;
    });

    const onPointerUp = () => {
        if (!isDragging) return;
        isDragging = false;
        sidebar.classList.remove('sheet-dragging');
        sidebar.style.transform = '';

        // Determine snap based on velocity or position
        if (Math.abs(velocity) > VELOCITY_THRESHOLD) {
            // Swipe direction: positive velocity = swipe down
            if (velocity > 0) {
                // Swiping down: go to next lower snap
                if (currentSheetSnap === 'full') setSheetSnap('half');
                else setSheetSnap('peek');
            } else {
                // Swiping up: go to next higher snap
                if (currentSheetSnap === 'peek') setSheetSnap('half');
                else setSheetSnap('full');
            }
        } else {
            // Snap to nearest based on current position
            const sidebarHeight = sidebar.offsetHeight;
            const currentY = getCurrentTranslateY();
            const visibleFraction = 1 - (currentY / sidebarHeight);

            if (visibleFraction < 0.2) setSheetSnap('peek');
            else if (visibleFraction < 0.65) setSheetSnap('half');
            else setSheetSnap('full');
        }
    };

    handle.addEventListener('pointerup', onPointerUp);
    handle.addEventListener('pointercancel', onPointerUp);

    // Prevent touch scroll on the handle
    handle.addEventListener('touchmove', (e) => e.preventDefault(), { passive: false });
}

function showMobileAnnotationInSheet(annotationId: string): void {
    const sidebar = document.getElementById('metadata-sidebar');
    if (!sidebar) return;

    // Ensure sidebar is visible
    if (sidebar.classList.contains('hidden')) {
        showMetadataSidebar();
    }

    // Switch to Info tab
    switchSidebarMode('view');

    // Find the full annotation object
    const annotation = annotationSystem.getAnnotations().find(a => a.id === annotationId);
    if (annotation) {
        showMobileAnnotationDetail(annotation);
    }

    // Highlight the matching list item
    document.querySelectorAll('.kiosk-anno-item.active').forEach(c => c.classList.remove('active'));
    const item = document.querySelector(`.kiosk-anno-item[data-anno-id="${annotationId}"]`);
    if (item) item.classList.add('active');
}

function showMobileAnnotationDetail(annotation: Annotation): void {
    const sidebarView = document.getElementById('sidebar-view');
    if (!sidebarView) return;

    // Hide normal sidebar content
    const displayContent = sidebarView.querySelector('.display-content') as HTMLElement;
    if (displayContent) displayContent.style.display = 'none';

    // Create or reuse detail container
    let detail = document.getElementById('mobile-anno-detail');
    if (!detail) {
        detail = document.createElement('div');
        detail.id = 'mobile-anno-detail';
        sidebarView.appendChild(detail);
    }

    // Find annotation number from marker
    const marker = document.querySelector(`.annotation-marker[data-annotation-id="${annotation.id}"]`);
    const number = marker ? marker.textContent.trim() : '?';

    // Render full content
    const bodyHtml = parseMarkdown(resolveAssetRefs(annotation.body || '', state.imageAssets));

    // Determine prev/next availability
    const annotations = annotationSystem.getAnnotations();
    const currentIndex = annotations.findIndex(a => a.id === annotation.id);
    const hasPrev = currentIndex > 0;
    const hasNext = currentIndex < annotations.length - 1;

    detail.innerHTML = `
        <div class="mobile-anno-nav">
            <button class="mobile-anno-nav-btn" id="mobile-anno-prev" ${hasPrev ? '' : 'disabled'}>&#8592; Prev</button>
            <button class="mobile-anno-nav-btn mobile-anno-return" id="mobile-anno-back">Return</button>
            <button class="mobile-anno-nav-btn" id="mobile-anno-next" ${hasNext ? '' : 'disabled'}>Next &#8594;</button>
        </div>
        <div class="mobile-anno-header">
            <span class="mobile-anno-number">${number}</span>
            <h2 class="mobile-anno-title">${annotation.title || 'Untitled'}</h2>
        </div>
        <div class="mobile-anno-body">${bodyHtml}</div>
    `;

    detail.style.display = 'flex';

    // Wire up nav buttons
    const backBtn = document.getElementById('mobile-anno-back');
    if (backBtn) {
        backBtn.addEventListener('click', () => {
            hideMobileAnnotationDetail();
        });
    }
    const prevBtn = document.getElementById('mobile-anno-prev');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => navigateAnnotation(-1));
    }
    const nextBtn = document.getElementById('mobile-anno-next');
    if (nextBtn) {
        nextBtn.addEventListener('click', () => navigateAnnotation(1));
    }

    // Expand sheet to see content
    if (currentSheetSnap === 'peek') {
        setSheetSnap('half');
    }

    // Scroll to top of detail
    sidebarView.scrollTop = 0;
}

function hideMobileAnnotationDetail(): void {
    const detail = document.getElementById('mobile-anno-detail');
    if (detail) detail.style.display = 'none';

    // Show normal sidebar content again
    const displayContent = document.querySelector('#sidebar-view .display-content') as HTMLElement;
    if (displayContent) displayContent.style.display = '';

    // Re-render metadata to restore asset images (blob URLs may need re-resolving)
    populateMetadataDisplay({ state: state as any, annotationSystem, imageAssets: state.imageAssets });

    // Clear active annotation state
    currentPopupAnnotationId = null;
    annotationSystem.selectedAnnotation = null;
    document.querySelectorAll('.annotation-marker.selected').forEach(m => m.classList.remove('selected'));
    document.querySelectorAll('.kiosk-anno-item.active').forEach(c => c.classList.remove('active'));
}

function navigateAnnotation(direction: number): void {
    const annotations = annotationSystem.getAnnotations();
    if (!annotations || annotations.length === 0) return;

    const currentIndex = annotations.findIndex(a => a.id === currentPopupAnnotationId);
    if (currentIndex === -1) return;

    const newIndex = currentIndex + direction;
    if (newIndex < 0 || newIndex >= annotations.length) return;

    const newAnno = annotations[newIndex];

    // Update sidebar list active state
    document.querySelectorAll('.kiosk-anno-item.active').forEach(c => c.classList.remove('active'));
    const item = document.querySelector(`.kiosk-anno-item[data-anno-id="${newAnno.id}"]`);
    if (item) item.classList.add('active');

    // Show single marker if annotations are globally hidden
    if (!state.annotationsVisible) {
        showSingleMarker(newAnno.id);
    }

    // Navigate camera and update detail view
    annotationSystem.goToAnnotation(newAnno.id);
    currentPopupAnnotationId = newAnno.id;
    showMobileAnnotationDetail(newAnno);
}

function repositionAnnotationToggle(): void {
    const annoBtn = document.getElementById('btn-toggle-annotations');
    if (!annoBtn) return;
    if (isMobileKiosk()) {
        // Move to body so position:fixed works (toolbar backdrop-filter creates containing block)
        if (annoBtn.parentElement !== document.body) {
            document.body.appendChild(annoBtn);
        }
    } else {
        // Keep in viewer container on desktop kiosk
        const viewer = document.getElementById('viewer-container');
        if (viewer && annoBtn.parentElement !== viewer) {
            viewer.appendChild(annoBtn);
        }
    }
}

function onWindowResize(): void {
    const container = document.getElementById('viewer-container');
    if (!container) return;
    sceneManager.onWindowResize(state.displayMode, container);

    // Move annotation toggle and view switcher based on viewport
    repositionAnnotationToggle();
    repositionViewSwitcher();

    // Reset sheet state when crossing mobile/desktop boundary
    const sidebar = document.getElementById('metadata-sidebar');
    if (!sidebar) return;
    if (isMobileKiosk()) {
        if (!sidebar.classList.contains('sheet-peek') &&
            !sidebar.classList.contains('sheet-half') &&
            !sidebar.classList.contains('sheet-full')) {
            setSheetSnap('peek');
        }
    } else {
        sidebar.classList.remove('sheet-peek', 'sheet-half', 'sheet-full', 'sheet-dragging');
        sidebar.style.transform = '';
    }
}

// =============================================================================
// VISUAL POLISH HELPERS
// =============================================================================

/**
 * Show branded loading screen with thumbnail, title, and content types.
 * Called after archive extraction but before 3D asset loading.
 */
async function showBrandedLoading(archiveLoader: ArchiveLoader): Promise<void> {
    try {
        const manifest = await archiveLoader.parseManifest();
        const contentInfo = archiveLoader.getContentInfo();

        const brandEl = document.getElementById('loading-brand');
        const thumbEl = document.getElementById('loading-thumbnail') as HTMLImageElement;
        const titleEl = document.getElementById('loading-title');
        const typesEl = document.getElementById('loading-content-types');

        if (!brandEl) return;

        // Set title from manifest
        const title = manifest?.project?.title || manifest?._meta?.title || '';
        if (titleEl && title) {
            titleEl.textContent = title;
        } else if (titleEl) {
            titleEl.style.display = 'none';
        }

        // Set thumbnail from archive
        const thumbEntry = archiveLoader.getThumbnailEntry();
        if (thumbEntry && thumbEl) {
            const thumbData = await archiveLoader.extractFile(thumbEntry.file_name);
            if (thumbData) {
                thumbEl.src = thumbData.url;
            }
        }

        // Build content type labels
        const types = [];
        if (contentInfo.hasSplat) types.push('Gaussian Splat');
        if (contentInfo.hasMesh) types.push('Mesh');
        if (contentInfo.hasPointcloud) types.push('Point Cloud');
        if (typesEl && types.length > 0) {
            typesEl.textContent = types.join(' + ');
        } else if (typesEl) {
            typesEl.style.display = 'none';
        }

        // Show the branded section
        brandEl.classList.remove('hidden');

        updateProgress(20, 'Preparing scene...');
    } catch (e) {
        log.warn('Could not show branded loading:', e.message);
    }
}

/**
 * Smooth entry transition: fade out loading overlay while easing camera in.
 * Camera starts 15% further back than the fit position and eases to target.
 */
function smoothTransitionIn(): void {
    const overlay = document.getElementById('loading-overlay');
    const targetPos = camera.position.clone();
    const targetTarget = controls.target.clone();

    // Pull camera back 15% further for the ease-in start
    const direction = new THREE.Vector3().subVectors(targetPos, targetTarget).normalize();
    const pullback = targetPos.distanceTo(targetTarget) * 0.15;
    camera.position.add(direction.multiplyScalar(pullback));

    const startPos = camera.position.clone();
    const startTime = performance.now();
    const duration = 1200;
    // Fade out the loading overlay with CSS transition
    if (overlay) {
        overlay.classList.add('fade-out');
        overlay.addEventListener('transitionend', () => {
            overlay.classList.add('hidden');
            overlay.classList.remove('fade-out');
        }, { once: true });
    }

    function easeOutCubic(t) {
        return 1 - Math.pow(1 - t, 3);
    }

    function animateEntry() {
        const elapsed = performance.now() - startTime;
        const t = Math.min(elapsed / duration, 1);
        const eased = easeOutCubic(t);

        camera.position.lerpVectors(startPos, targetPos, eased);
        controls.update();

        if (t < 1) {
            requestAnimationFrame(animateEntry);
        }
    }

    requestAnimationFrame(animateEntry);
}

/**
 * Trigger the intro glow animation on all annotation markers.
 * Adds glow-intro class, removes it after the animation completes (~6s).
 */
function triggerMarkerGlowIntro(): void {
    const markers = document.querySelectorAll('.annotation-marker');
    markers.forEach(m => m.classList.add('glow-intro'));
    setTimeout(() => {
        markers.forEach(m => m.classList.remove('glow-intro'));
    }, 6500);
}

/**
 * Show only the marker for a specific annotation ID when annotations are globally hidden.
 */
function showSingleMarker(annotationId: string): void {
    const markersContainer = document.getElementById('annotation-markers') as HTMLElement;
    if (!markersContainer) return;
    // Temporarily show the container
    markersContainer.style.display = '';
    // Hide all markers, then show only the target
    markersContainer.querySelectorAll('.annotation-marker').forEach(m => {
        (m as HTMLElement).style.display = 'none';
    });
    const target = markersContainer.querySelector(`.annotation-marker[data-annotation-id="${annotationId}"]`) as HTMLElement;
    if (target) target.style.display = 'flex';
}

/**
 * Re-hide markers container when in globally-hidden mode.
 */
function hideSingleMarker(): void {
    const markersContainer = document.getElementById('annotation-markers') as HTMLElement;
    if (markersContainer) {
        // Restore all markers to default display so toggle-on works correctly
        markersContainer.querySelectorAll('.annotation-marker').forEach(m => {
            (m as HTMLElement).style.display = '';
        });
        markersContainer.style.display = 'none';
    }
}

/**
 * Update the SVG connecting line from marker to popup.
 */
function updateAnnotationLine(annotationId: string | null): void {
    if (!annotationLineEl || !annotationId) {
        hideAnnotationLine();
        return;
    }

    const marker = document.querySelector(`.annotation-marker[data-annotation-id="${annotationId}"]`) as HTMLElement;
    const popup = document.getElementById('annotation-info-popup');

    if (!marker || !popup || popup.classList.contains('hidden') ||
        marker.style.display === 'none') {
        hideAnnotationLine();
        return;
    }

    const markerRect = marker.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();

    const mx = markerRect.left + markerRect.width / 2;
    const my = markerRect.top + markerRect.height / 2;

    // Connect to the nearest edge of the popup with margin gap
    const lineMargin = 12; // gap between line end and marker/popup
    let px, py;
    let lx1, ly1; // line start (near marker)
    if (popupRect.left > mx) {
        // Popup is to the right of marker
        px = popupRect.left - lineMargin;
        py = Math.max(popupRect.top, Math.min(my, popupRect.bottom));
    } else {
        // Popup is to the left of marker
        px = popupRect.right + lineMargin;
        py = Math.max(popupRect.top, Math.min(my, popupRect.bottom));
    }

    // Offset line start away from marker center toward popup
    const dx = px - mx;
    const dy = py - my;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist > lineMargin * 3) {
        const ratio = lineMargin / dist;
        lx1 = mx + dx * ratio;
        ly1 = my + dy * ratio;
    } else {
        lx1 = mx;
        ly1 = my;
    }

    annotationLineEl.setAttribute('x1', lx1);
    annotationLineEl.setAttribute('y1', ly1);
    annotationLineEl.setAttribute('x2', px);
    annotationLineEl.setAttribute('y2', py);
    annotationLineEl.style.display = '';
}

function hideAnnotationLine(): void {
    if (annotationLineEl) {
        annotationLineEl.style.display = 'none';
    }
}

// =============================================================================
// ANIMATION LOOP
// =============================================================================

function animate(): void {
    requestAnimationFrame(animate);

    try {
        if (state.flyModeActive) {
            flyControls.update();
        } else {
            controls.update();
        }

        sceneManager.render(state.displayMode as any, splatMesh, modelGroup, pointcloudGroup, null);

        // Update cross-section plane to track gizmo anchor
        if (crossSection) crossSection.updatePlane();

        // Update annotation marker screen positions (skip when globally hidden, unless single-marker is shown)
        if (annotationSystem.hasAnnotations()) {
            const markersContainer = document.getElementById('annotation-markers');
            const markersShown = !markersContainer || markersContainer.style.display !== 'none';
            if (markersShown) {
                annotationSystem.updateMarkerPositions();
            }
            updateAnnotationPopupPosition(currentPopupAnnotationId);
            updateAnnotationLine(currentPopupAnnotationId);
        }

        // Update measurement marker screen positions
        if (measurementSystem) {
            measurementSystem.updateMarkerPositions();
        }

        sceneManager.updateFPS(fpsElement);
    } catch (e) {
        console.warn('[animate] frame error:', e);
    }
}
