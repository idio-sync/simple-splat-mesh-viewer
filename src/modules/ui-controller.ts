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
import type { AppState, DisplayMode } from '../types.js';

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
// CONTROLS PANEL
// =============================================================================

interface ControlsPanelDeps {
    state: AppState;
    config?: { controlsMode?: string; showControls?: boolean };
    onWindowResize?: () => void;
}

/**
 * Toggle controls panel visibility
 */
export function toggleControlsPanel(deps: ControlsPanelDeps): void {
    const { state } = deps;
    state.controlsVisible = !state.controlsVisible;
    applyControlsVisibility(deps);
}

/**
 * Apply controls panel visibility. Handles controlsMode (full/minimal/none),
 * width/padding styles, toggle button class management, and resize callback.
 */
export function applyControlsVisibility(deps: ControlsPanelDeps, shouldShowOverride?: boolean): void {
    const { state, config, onWindowResize } = deps;
    const controlsPanel = document.getElementById('controls-panel') as HTMLDivElement | null;
    if (!controlsPanel) return;

    const toggleBtn = document.getElementById('btn-toggle-controls');
    const shouldShow = shouldShowOverride !== undefined ? shouldShowOverride : state.controlsVisible;
    const mode = (config && config.controlsMode) || 'full';

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
        try { if (onWindowResize) onWindowResize(); } catch (e) { /* ignore */ }
    }, 200);
}

/**
 * Ensure toolbar visibility is maintained (safeguard against race conditions).
 */
export function ensureToolbarVisibility(config: { showToolbar?: boolean }): void {
    // Only hide toolbar if explicitly set to false (not undefined)
    if (config.showToolbar === false) {
        return; // Toolbar intentionally hidden via URL parameter
    }

    const toolbar = document.getElementById('left-toolbar') as HTMLDivElement | null;
    if (!toolbar) return;

    // Force toolbar to be visible
    toolbar.style.display = 'flex';
    toolbar.style.visibility = 'visible';
    toolbar.style.zIndex = '10000';

    // Re-check after file loading completes (delayed checks)
    setTimeout(() => {
        const tb = document.getElementById('left-toolbar') as HTMLDivElement | null;
        if (tb && config.showToolbar !== false) {
            tb.style.display = 'flex';
            tb.style.visibility = 'visible';
            tb.style.zIndex = '10000';
        }
    }, 1000);

    setTimeout(() => {
        const tb = document.getElementById('left-toolbar') as HTMLDivElement | null;
        if (tb && config.showToolbar !== false) {
            tb.style.display = 'flex';
            tb.style.visibility = 'visible';
            tb.style.zIndex = '10000';
        }
    }, 3000);
}

/**
 * Apply viewer mode settings (toolbar visibility, sidebar state).
 */
export function applyViewerModeSettings(config: {
    showToolbar?: boolean;
    sidebarMode?: string;
    controlsMode?: string;
}): void {
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
                    const editTab = document.querySelector('.sidebar-mode-tab[data-mode="edit"]') as HTMLElement | null;
                    if (editTab) {
                        editTab.style.display = 'none';
                        log.info('Edit tab hidden for view-only mode');
                    }

                    // Also hide the annotations tab if in pure view mode
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
            }
        }, 100);
    }
}

/**
 * Apply controls mode (full, minimal, none)
 */
export function applyControlsMode(mode: string): void {
    const controlsPanel = document.getElementById('controls-panel') as HTMLDivElement | null;

    if (mode === 'none') {
        // Hide panel completely
        if (controlsPanel) controlsPanel.style.display = 'none';
        const toggleBtn = document.getElementById('btn-toggle-controls');
        if (toggleBtn) toggleBtn.style.display = 'none';
        return;
    }

    // Show panel
    if (controlsPanel) controlsPanel.style.display = '';
    const toggleBtn = document.getElementById('btn-toggle-controls');
    if (toggleBtn) toggleBtn.style.display = '';

    if (mode === 'minimal') {
        // Hide all sections except display mode toggle
        const sections = controlsPanel?.querySelectorAll('.control-section');
        sections?.forEach(section => {
            const header = section.querySelector('h3');
            const headerText = header?.textContent?.toLowerCase() || '';
            // Keep only display mode section
            if (!headerText.includes('display')) {
                (section as HTMLElement).style.display = 'none';
            }
        });

        // Hide the main title
        const title = controlsPanel?.querySelector('h2') as HTMLElement | null;
        if (title) title.style.display = 'none';

        // Make the panel narrower for minimal mode
        if (controlsPanel) controlsPanel.style.width = '200px';
    }
    // 'full' mode shows everything (default)
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
 * Setup collapsible section handlers
 */
export function setupCollapsibles(): void {
    const collapsibles = document.querySelectorAll('.collapsible-header');

    collapsibles.forEach(header => {
        header.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const section = (header as HTMLElement).closest('.control-section.collapsible');
            if (section) {
                section.classList.toggle('collapsed');
                const icon = header.querySelector('.collapse-icon');
                if (icon) {
                    icon.textContent = section.classList.contains('collapsed') ? '▶' : '▼';
                }
            }
        });
    });

    log.debug('Collapsible sections initialized');
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
 * Show export panel
 */
export function showExportPanel(): void {
    const panel = document.getElementById('export-panel');
    if (panel) panel.classList.remove('hidden');
}

/**
 * Hide export panel
 */
export function hideExportPanel(): void {
    const panel = document.getElementById('export-panel');
    if (panel) panel.classList.add('hidden');
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
