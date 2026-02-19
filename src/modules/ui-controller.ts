/**
 * UI Controller Module
 *
 * Handles UI state and interactions:
 * - Display mode management (splat, model, both, split)
 * - Loading overlay and progress
 * - Controls panel visibility and mode
 * - Transform input updates
 * - Collapsible sections
 * - Keyboard shortcuts
 */

import * as THREE from 'three';
import { Logger, notify } from './utilities.js';
import type { AppState, DisplayMode } from '@/types.js';

const log = Logger.getLogger('ui-controller');

// =============================================================================
// DISPLAY MODE MANAGEMENT
// =============================================================================

interface SetDisplayModeDeps {
    state: AppState;
    canvasRight: HTMLCanvasElement | null;
    onResize?: () => void;
    updateVisibility?: () => void;
}

/**
 * Set the display mode and update UI accordingly
 */
export function setDisplayMode(mode: DisplayMode, deps: SetDisplayModeDeps): void {
    const { state, canvasRight, onResize, updateVisibility } = deps;

    state.displayMode = mode;

    // Update button states
    ['splat', 'model', 'pointcloud', 'both', 'split', 'stl'].forEach(m => {
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
        if (onResize) onResize();
    });

    if (updateVisibility) updateVisibility();
}

/**
 * Update object visibility based on display mode
 */
export function updateVisibility(
    displayMode: DisplayMode,
    splatMesh: any, // TODO: type when @types/three is installed
    modelGroup: any, // TODO: type when @types/three is installed (THREE.Group)
    pointcloudGroup?: any, // TODO: type when @types/three is installed (THREE.Group)
    stlGroup?: any // TODO: type when @types/three is installed (THREE.Group)
): void {
    if (displayMode === 'split') {
        // In split mode, both are visible but rendered in separate views
        if (splatMesh) splatMesh.visible = true;
        if (modelGroup) modelGroup.visible = true;
        if (pointcloudGroup) pointcloudGroup.visible = true;
        if (stlGroup) stlGroup.visible = true;
    } else {
        const showSplat = displayMode === 'splat' || displayMode === 'both';
        const showModel = displayMode === 'model' || displayMode === 'both';
        const showPointcloud = displayMode === 'pointcloud';
        const showSTL = displayMode === 'stl';

        if (splatMesh) {
            splatMesh.visible = showSplat;
        }

        if (modelGroup) {
            modelGroup.visible = showModel;
        }

        if (pointcloudGroup) {
            pointcloudGroup.visible = showPointcloud;
        }

        if (stlGroup) {
            stlGroup.visible = showSTL;
        }
    }
}

/**
 * Show/hide display mode pill buttons based on which asset types are loaded.
 * "Both" and "Split" only appear when multiple types are loaded.
 */
export function updateDisplayPill(loaded: { splat: boolean; model: boolean; pointcloud: boolean; stl: boolean }): void {
    const show = (id: string, visible: boolean) => {
        const el = document.getElementById(id);
        if (el) el.style.display = visible ? '' : 'none';
    };

    show('btn-splat', loaded.splat);
    show('btn-model', loaded.model);
    show('btn-pointcloud', loaded.pointcloud);
    show('btn-stl', loaded.stl);

    // "Both" (M/S) only when splat AND model are loaded
    show('btn-both', loaded.splat && loaded.model);
    // "Split" only when at least 2 types are loaded
    const count = [loaded.splat, loaded.model, loaded.pointcloud, loaded.stl].filter(Boolean).length;
    show('btn-split', count >= 2);

    // Show the pill itself only if at least one type is loaded
    const pill = document.getElementById('vp-display-pill');
    if (pill) pill.style.display = count > 0 ? '' : 'none';
}

// =============================================================================
// LOADING OVERLAY
// =============================================================================

/**
 * Show loading overlay
 */
export function showLoading(text: string = 'Loading...', showProgress: boolean = false): void {
    const loadingOverlay = document.getElementById('loading-overlay');
    const loadingText = document.getElementById('loading-text');

    if (loadingText) loadingText.textContent = text;
    if (loadingOverlay) loadingOverlay.classList.remove('hidden');

    // Show/hide progress bar elements
    const progressContainer = document.getElementById('loading-progress-container');
    const progressText = document.getElementById('loading-progress-text');
    if (progressContainer && progressText) {
        if (showProgress) {
            progressContainer.classList.remove('hidden');
            progressText.classList.remove('hidden');
            updateProgress(0);
        } else {
            progressContainer.classList.add('hidden');
            progressText.classList.add('hidden');
        }
    }
}

/**
 * Update loading progress
 */
export function updateProgress(percent: number, stage: string | null = null): void {
    const progressBar = document.getElementById('loading-progress-bar') as HTMLDivElement | null;
    const progressText = document.getElementById('loading-progress-text');
    const loadingText = document.getElementById('loading-text');

    if (progressBar) {
        progressBar.style.width = `${percent}%`;
    }
    if (progressText) {
        progressText.textContent = `${Math.round(percent)}%`;
    }
    if (stage && loadingText) {
        loadingText.textContent = stage;
    }
}

/**
 * Hide loading overlay
 */
export function hideLoading(): void {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.add('hidden');

    // Reset progress bar
    const progressContainer = document.getElementById('loading-progress-container');
    const progressText = document.getElementById('loading-progress-text');
    const progressBar = document.getElementById('loading-progress-bar') as HTMLDivElement | null;
    if (progressContainer) progressContainer.classList.add('hidden');
    if (progressText) progressText.classList.add('hidden');
    if (progressBar) progressBar.style.width = '0%';
}

// =============================================================================
// TOOL RAIL & PROPERTIES PANEL
// =============================================================================

/** Map of tool names to their pane IDs and display titles */
const TOOL_PANE_MAP: Record<string, { pane: string; title: string }> = {
    scene:     { pane: 'pane-scene',     title: 'Scene' },
    assets:    { pane: 'pane-assets',    title: 'Assets' },
    transform: { pane: 'pane-transform', title: 'Transform' },
    align:     { pane: 'pane-align',     title: 'Alignment' },
    annotate:  { pane: 'pane-annotate',  title: 'Annotations' },
    measure:   { pane: 'pane-measure',   title: 'Measurements' },
    capture:   { pane: 'pane-capture',   title: 'Screenshots' },
    metadata:  { pane: 'pane-metadata',  title: 'Metadata' },
    export:    { pane: 'pane-export',    title: 'Export' },
    settings:  { pane: 'pane-settings',  title: 'Settings' },
};

/**
 * Activate a tool in the tool rail, showing its corresponding pane.
 * If the same tool is clicked again, toggle the props panel closed.
 */
let _activeTool: string | null = 'assets';

export function activateTool(toolName: string): void {
    const panel = document.getElementById('props-panel');
    const headerTitle = document.getElementById('props-header-title');

    // If tool has no pane (e.g. fullscreen), skip pane switching
    if (!TOOL_PANE_MAP[toolName]) return;

    // No-op if same tool clicked again — buttons stay active until a different one is selected
    if (_activeTool === toolName && panel && !panel.classList.contains('hidden')) {
        return;
    }

    _activeTool = toolName;

    // Show props panel
    if (panel) panel.classList.remove('hidden');

    // Update tool rail active state
    document.querySelectorAll('#tool-rail .tool-btn').forEach(btn => {
        btn.classList.toggle('active', btn.getAttribute('data-tool') === toolName);
    });

    // Switch pane visibility via .active class (CSS: .props-pane { display:none }, .props-pane.active { display:block })
    const mapping = TOOL_PANE_MAP[toolName];
    document.querySelectorAll('#props-panel .props-pane').forEach(pane => {
        pane.classList.toggle('active', pane.id === mapping.pane);
    });

    // Update header title
    if (headerTitle) headerTitle.textContent = mapping.title;

    log.debug(`Tool activated: ${toolName}`);
}

/** Get the currently active tool name */
export function getActiveTool(): string | null {
    return _activeTool;
}

/**
 * Toggle properties panel visibility
 */
export function togglePropsPanel(): void {
    const panel = document.getElementById('props-panel');
    if (!panel) return;
    panel.classList.toggle('hidden');
}

// --- Legacy compatibility wrappers (controls-panel no longer exists) ---

interface ControlsPanelDeps {
    state: AppState;
    config?: { controlsMode?: string; showControls?: boolean };
    onWindowResize?: () => void;
}

/** @deprecated Controls panel replaced by tool rail + props panel */
export function toggleControlsPanel(_deps: ControlsPanelDeps): void {
    togglePropsPanel();
}

/** @deprecated Controls panel replaced by tool rail + props panel */
export function applyControlsVisibility(_deps: ControlsPanelDeps, _shouldShowOverride?: boolean): void {
    // No-op — layout managed by CSS grid now
}

/** @deprecated Left toolbar replaced by tool rail */
export function ensureToolbarVisibility(_config: { showToolbar?: boolean }): void {
    // No-op — tool rail visibility managed by CSS
}

/**
 * Apply viewer mode settings (sidebar state via URL params).
 */
export function applyViewerModeSettings(config: {
    showToolbar?: boolean;
    sidebarMode?: string;
    controlsMode?: string;
}): void {
    // Apply sidebar state — open metadata pane if requested
    if (config.sidebarMode && config.sidebarMode !== 'closed') {
        setTimeout(() => {
            activateTool('metadata');
            log.info('Metadata pane shown via URL parameter');

            // If view-only mode, hide the Edit tab
            if (config.sidebarMode === 'view') {
                const editTab = document.querySelector('.sidebar-mode-tab[data-mode="edit"]') as HTMLElement | null;
                if (editTab) {
                    editTab.style.display = 'none';
                    log.info('Edit tab hidden for view-only mode');
                }

                const annotationsTab = document.querySelector('.sidebar-mode-tab[data-mode="annotations"]') as HTMLElement | null;
                if (annotationsTab) {
                    annotationsTab.style.display = 'none';
                }
            }

            // Activate View tab by default
            const viewTab = document.querySelector('.sidebar-mode-tab[data-mode="view"]') as HTMLElement | null;
            const viewContent = document.getElementById('sidebar-view');
            if (viewTab && viewContent) {
                document.querySelectorAll('.sidebar-mode-tab').forEach(t => t.classList.remove('active'));
                document.querySelectorAll('.sidebar-mode-content').forEach(c => c.classList.remove('active'));
                viewTab.classList.add('active');
                viewContent.classList.add('active');
            }
        }, 100);
    }

    // Hide tool rail if controls=none
    if (config.controlsMode === 'none') {
        const rail = document.getElementById('tool-rail');
        const panel = document.getElementById('props-panel');
        if (rail) rail.style.display = 'none';
        if (panel) panel.style.display = 'none';
    }
}

/** @deprecated Controls panel replaced by tool rail + props panel */
export function applyControlsMode(mode: string): void {
    if (mode === 'none') {
        const rail = document.getElementById('tool-rail');
        const panel = document.getElementById('props-panel');
        if (rail) rail.style.display = 'none';
        if (panel) panel.style.display = 'none';
    }
}

// =============================================================================
// TRANSFORM INPUT UPDATES
// =============================================================================

/**
 * Update transform input fields from object transforms
 */
export function updateTransformInputs(
    splatMesh: any, // TODO: type when @types/three is installed
    modelGroup: any, // TODO: type when @types/three is installed (THREE.Group)
    pointcloudGroup?: any // TODO: type when @types/three is installed (THREE.Group)
): void {
    // Helper to safely set input value
    const setInputValue = (id: string, value: string | number): void => {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el) el.value = String(value);
    };
    const setTextContent = (id: string, value: string | number): void => {
        const el = document.getElementById(id);
        if (el) el.textContent = String(value);
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

    // Update pointcloud inputs
    if (pointcloudGroup) {
        setInputValue('pointcloud-pos-x', pointcloudGroup.position.x.toFixed(2));
        setInputValue('pointcloud-pos-y', pointcloudGroup.position.y.toFixed(2));
        setInputValue('pointcloud-pos-z', pointcloudGroup.position.z.toFixed(2));
        setInputValue('pointcloud-rot-x', THREE.MathUtils.radToDeg(pointcloudGroup.rotation.x).toFixed(1));
        setInputValue('pointcloud-rot-y', THREE.MathUtils.radToDeg(pointcloudGroup.rotation.y).toFixed(1));
        setInputValue('pointcloud-rot-z', THREE.MathUtils.radToDeg(pointcloudGroup.rotation.z).toFixed(1));
        setInputValue('pointcloud-scale', pointcloudGroup.scale.x);
        setTextContent('pointcloud-scale-value', pointcloudGroup.scale.x.toFixed(1));
    }
}

/**
 * Update filename display
 */
export function updateFilename(elementId: string, filename: string): void {
    const el = document.getElementById(elementId);
    if (el) el.textContent = filename;
}

/**
 * Update status text
 */
export function updateStatusText(elementId: string, text: string): void {
    const el = document.getElementById(elementId);
    if (el) el.textContent = text;
}

// =============================================================================
// COLLAPSIBLE SECTIONS
// =============================================================================

/**
 * Setup collapsible section handlers for .prop-section elements.
 * Clicking a .prop-section-hd toggles the .open class on the parent .prop-section,
 * which controls body visibility and chevron rotation via CSS.
 */
export function setupCollapsibles(): void {
    const headers = document.querySelectorAll('.prop-section-hd');

    headers.forEach(header => {
        header.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const section = (header as HTMLElement).closest('.prop-section');
            if (section) {
                section.classList.toggle('open');
            }
        });
    });

    log.debug('Collapsible prop-sections initialized');
}

// =============================================================================
// STATUS BAR
// =============================================================================

/**
 * Update status bar elements. Called from the animate loop (throttled by caller).
 */
export function updateStatusBar(info: {
    fps?: number;
    renderer?: string;
    tris?: number;
    splats?: number;
    cameraMode?: string;
    filename?: string;
}): void {
    if (info.fps !== undefined) {
        const el = document.getElementById('status-fps');
        if (el) el.textContent = `${info.fps} fps`;
    }
    if (info.renderer !== undefined) {
        const el = document.getElementById('status-renderer');
        if (el) {
            el.textContent = info.renderer;
            el.classList.toggle('badge-webgpu', info.renderer === 'WebGPU');
        }
    }
    if (info.tris !== undefined) {
        const el = document.getElementById('status-tris');
        if (el) el.textContent = info.tris > 0 ? `${info.tris.toLocaleString()} tris` : '- tris';
    }
    if (info.splats !== undefined) {
        const el = document.getElementById('status-splats');
        if (el) el.textContent = info.splats > 0 ? `${info.splats.toLocaleString()} splats` : '- splats';
    }
    if (info.cameraMode !== undefined) {
        const el = document.getElementById('status-camera-mode');
        if (el) el.textContent = info.cameraMode;
    }
    if (info.filename !== undefined) {
        const el = document.getElementById('status-filename');
        if (el) el.textContent = info.filename;
    }
}

// =============================================================================
// EVENT LISTENER HELPERS
// =============================================================================

/**
 * Safely add event listener with null check
 */
export function addListener(id: string, event: string, handler: EventListener): boolean {
    const el = document.getElementById(id);
    if (el) {
        el.addEventListener(event, handler);
        return true;
    } else {
        log.warn(`Element not found: ${id}`);
        return false;
    }
}

/**
 * Setup keyboard shortcuts
 */
export function setupKeyboardShortcuts(handlers: Record<string, (e: KeyboardEvent) => void>): void {
    window.addEventListener('keydown', (e) => {
        const activeEl = document.activeElement;
        // Don't trigger if typing in input
        if (activeEl && (activeEl.tagName === 'INPUT' || activeEl.tagName === 'TEXTAREA')) {
            return;
        }

        const key = e.key.toLowerCase();
        if (handlers[key] && !e.ctrlKey && !e.metaKey) {
            handlers[key](e);
        } else if (e.key === 'Escape' && handlers.escape) {
            handlers.escape(e);
        }
    });
}

// =============================================================================
// BUTTON STATE MANAGEMENT
// =============================================================================

// =============================================================================
// EXPORT PANEL
// =============================================================================

/**
 * Show export panel — no-op in new layout (export content always visible inside pane)
 */
export function showExportPanel(): void {
    // In the new layout, export content is always visible inside #pane-export.
    // Tool rail controls pane visibility via activateTool().
}

/**
 * Hide export panel — no-op in new layout
 */
export function hideExportPanel(): void {
    // In the new layout, export content is always visible inside #pane-export.
    // Tool rail controls pane visibility via activateTool().
}

// =============================================================================
// SHARE LINK
// =============================================================================

interface CopyShareLinkDeps {
    state: AppState;
    config: { showControls?: boolean; controlsMode?: string };
    splatMesh: any; // TODO: type when @types/three is installed
    modelGroup: any; // TODO: type when @types/three is installed (THREE.Group)
}

/**
 * Copy share link to clipboard
 */
export function copyShareLink(deps: CopyShareLinkDeps): void {
    const { state, config, splatMesh, modelGroup } = deps;

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
            log.error('Failed to copy share link:', err);
            notify.info('Share link: ' + shareUrl);
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

    // Helper to format vec3
    const formatVec3 = (arr: number[]): string => arr.map(n => parseFloat(n.toFixed(4))).join(',');

    // Add inline alignment data
    if (splatMesh) {
        const pos = splatMesh.position;
        const rot = splatMesh.rotation;
        const scale = splatMesh.scale.x;

        if (pos.x !== 0 || pos.y !== 0 || pos.z !== 0) {
            params.set('sp', formatVec3([pos.x, pos.y, pos.z]));
        }
        if (rot.x !== 0 || rot.y !== 0 || rot.z !== 0) {
            params.set('sr', formatVec3([rot.x, rot.y, rot.z]));
        }
        if (scale !== 1) {
            params.set('ss', parseFloat(scale.toFixed(4)).toString());
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
            params.set('ms', parseFloat(scale.toFixed(4)).toString());
        }
    }

    // Build the full URL
    const shareUrl = baseUrl + '?' + params.toString();

    // Copy to clipboard
    navigator.clipboard.writeText(shareUrl).then(() => {
        notify.success('Share link copied to clipboard!');
    }).catch((err) => {
        log.error('Failed to copy share link:', err);
        notify.info('Share link: ' + shareUrl);
    });
}

// =============================================================================
// INLINE ASSET LOADING INDICATOR
// =============================================================================

/**
 * Asset type → display mode button ID mapping
 */
const ASSET_BUTTON_MAP: Record<string, string> = {
    splat: 'btn-splat',
    mesh: 'btn-model',
    pointcloud: 'btn-pointcloud'
};

/**
 * Show an inline loading spinner on the button for a given asset type.
 */
export function showInlineLoading(assetType: string): void {
    const btnId = ASSET_BUTTON_MAP[assetType];
    if (!btnId) return;
    const btn = document.getElementById(btnId);
    if (btn) {
        btn.classList.add('asset-loading');
    }
}

/**
 * Hide the inline loading spinner on the button for a given asset type.
 */
export function hideInlineLoading(assetType: string): void {
    const btnId = ASSET_BUTTON_MAP[assetType];
    if (!btnId) return;
    const btn = document.getElementById(btnId);
    if (btn) {
        btn.classList.remove('asset-loading');
    }
}
