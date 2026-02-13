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

const log = Logger.getLogger('ui-controller');

// =============================================================================
// DISPLAY MODE MANAGEMENT
// =============================================================================

/**
 * Set the display mode and update UI accordingly
 * @param {string} mode - Display mode: 'splat', 'model', 'both', 'split'
 * @param {Object} deps - Dependencies
 */
export function setDisplayMode(mode, deps) {
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
 * @param {string} displayMode - Current display mode
 * @param {Object} splatMesh - The splat mesh
 * @param {THREE.Group} modelGroup - The model group
 * @param {THREE.Group} [pointcloudGroup] - The point cloud group (optional)
 * @param {THREE.Group} [stlGroup] - The STL group (optional)
 */
export function updateVisibility(displayMode, splatMesh, modelGroup, pointcloudGroup, stlGroup) {
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
 * @param {string} text - Loading text
 * @param {boolean} showProgress - Whether to show progress bar
 */
export function showLoading(text = 'Loading...', showProgress = false) {
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
 * @param {number} percent - Progress percentage (0-100)
 * @param {string} stage - Optional stage description
 */
export function updateProgress(percent, stage = null) {
    const progressBar = document.getElementById('loading-progress-bar');
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
export function hideLoading() {
    const loadingOverlay = document.getElementById('loading-overlay');
    if (loadingOverlay) loadingOverlay.classList.add('hidden');

    // Reset progress bar
    const progressContainer = document.getElementById('loading-progress-container');
    const progressText = document.getElementById('loading-progress-text');
    const progressBar = document.getElementById('loading-progress-bar');
    if (progressContainer) progressContainer.classList.add('hidden');
    if (progressText) progressText.classList.add('hidden');
    if (progressBar) progressBar.style.width = '0%';
}

// =============================================================================
// CONTROLS PANEL
// =============================================================================

/**
 * Toggle controls panel visibility
 * @param {Object} state - Application state
 */
export function toggleControlsPanel(state) {
    state.controlsVisible = !state.controlsVisible;
    applyControlsVisibility(state.controlsVisible);
}

/**
 * Apply controls panel visibility
 * @param {boolean} visible - Whether panel should be visible
 */
export function applyControlsVisibility(visible) {
    const controlsPanel = document.getElementById('controls-panel');
    if (!controlsPanel) {
        log.warn('Controls panel not found');
        return;
    }

    log.debug('applyControlsVisibility:', visible);

    if (visible) {
        controlsPanel.classList.remove('panel-hidden');
        controlsPanel.style.width = '';
        controlsPanel.style.minWidth = '';
        controlsPanel.style.padding = '';
        controlsPanel.style.overflow = '';
        controlsPanel.style.borderLeftWidth = '';
        controlsPanel.style.pointerEvents = '';
    } else {
        controlsPanel.classList.add('panel-hidden');
        controlsPanel.style.width = '0';
        controlsPanel.style.minWidth = '0';
        controlsPanel.style.padding = '0';
        controlsPanel.style.overflow = 'hidden';
        controlsPanel.style.borderLeftWidth = '0';
        controlsPanel.style.pointerEvents = 'none';
    }

    // Update toggle button icon
    const toggleBtn = document.getElementById('btn-toggle-controls');
    if (toggleBtn) {
        const icon = toggleBtn.querySelector('span');
        if (icon) {
            icon.textContent = visible ? '▶' : '◀';
        }
    }

    // Update annotation bar position to match panel visibility
    const annotationBar = document.getElementById('annotation-bar');
    if (annotationBar) {
        annotationBar.style.left = visible ? '280px' : '0';
    }
}

/**
 * Apply controls mode (full, minimal, none)
 * @param {string} mode - Controls mode
 */
export function applyControlsMode(mode) {
    const controlsPanel = document.getElementById('controls-panel');

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
                section.style.display = 'none';
            }
        });

        // Hide the main title
        const title = controlsPanel?.querySelector('h2');
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
 * @param {Object} splatMesh - The splat mesh
 * @param {THREE.Group} modelGroup - The model group
 * @param {THREE.Group} [pointcloudGroup] - The point cloud group (optional)
 */
export function updateTransformInputs(splatMesh, modelGroup, pointcloudGroup) {
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
 * @param {string} elementId - Element ID to update
 * @param {string} filename - Filename to display
 */
export function updateFilename(elementId, filename) {
    const el = document.getElementById(elementId);
    if (el) el.textContent = filename;
}

/**
 * Update status text
 * @param {string} elementId - Element ID to update
 * @param {string} text - Status text
 */
export function updateStatusText(elementId, text) {
    const el = document.getElementById(elementId);
    if (el) el.textContent = text;
}

// =============================================================================
// COLLAPSIBLE SECTIONS
// =============================================================================

/**
 * Setup collapsible section handlers
 */
export function setupCollapsibles() {
    const collapsibles = document.querySelectorAll('.collapsible-header');

    collapsibles.forEach(header => {
        header.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            const section = header.closest('.control-section.collapsible');
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
 * @param {string} id - Element ID
 * @param {string} event - Event type
 * @param {Function} handler - Event handler
 * @returns {boolean} Whether listener was added
 */
export function addListener(id, event, handler) {
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
 * @param {Object} handlers - Object with key -> handler mappings
 */
export function setupKeyboardShortcuts(handlers) {
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
export function showExportPanel() {
    const panel = document.getElementById('export-panel');
    if (panel) panel.classList.remove('hidden');
}

/**
 * Hide export panel
 */
export function hideExportPanel() {
    const panel = document.getElementById('export-panel');
    if (panel) panel.classList.add('hidden');
}

// =============================================================================
// SHARE LINK
// =============================================================================

/**
 * Copy share link to clipboard
 * @param {Object} deps - Dependencies (state, config, splatMesh, modelGroup)
 */
export function copyShareLink(deps) {
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

    // Helper to format vec3
    const formatVec3 = (arr) => arr.map(n => parseFloat(n.toFixed(4))).join(',');

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
        log.error('Failed to copy share link:', err);
        notify.info('Share link: ' + shareUrl, { duration: 10000 });
    });
}

// =============================================================================
// INLINE ASSET LOADING INDICATOR
// =============================================================================

/**
 * Asset type → display mode button ID mapping
 */
const ASSET_BUTTON_MAP = {
    splat: 'btn-splat',
    mesh: 'btn-model',
    pointcloud: 'btn-pointcloud'
};

/**
 * Show an inline loading spinner on the button for a given asset type.
 * @param {string} assetType - 'splat' | 'mesh' | 'pointcloud'
 */
export function showInlineLoading(assetType) {
    const btnId = ASSET_BUTTON_MAP[assetType];
    if (!btnId) return;
    const btn = document.getElementById(btnId);
    if (btn) {
        btn.classList.add('asset-loading');
    }
}

/**
 * Hide the inline loading spinner on the button for a given asset type.
 * @param {string} assetType - 'splat' | 'mesh' | 'pointcloud'
 */
export function hideInlineLoading(assetType) {
    const btnId = ASSET_BUTTON_MAP[assetType];
    if (!btnId) return;
    const btn = document.getElementById(btnId);
    if (btn) {
        btn.classList.remove('asset-loading');
    }
}

