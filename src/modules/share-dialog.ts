/**
 * Share Dialog Module
 * Provides a dialog for creating customized share links with various viewer options.
 *
 * URL Parameters supported:
 *   ?toolbar=show|hide     - Show/hide the left toolbar buttons
 *   ?sidebar=closed|view|edit - Metadata sidebar state on load
 *   ?ui=full|viewer|kiosk  - Preset UI modes (overrides individual settings)
 *
 * UI Presets:
 *   full   - All controls visible (default)
 *   viewer - No toolbar, metadata sidebar in view-only mode
 *   kiosk  - No toolbar, no controls panel, metadata sidebar in view-only mode
 */

import { Logger } from './utilities.js';
import type { AppState, Transform } from '../types.js';

const log = Logger.getLogger('ShareDialog');

// =============================================================================
// STATE
// =============================================================================

let dialogElement: HTMLElement | null = null;
let currentState: ShareState | null = null;  // Will be set when showing dialog

// =============================================================================
// TYPES
// =============================================================================

interface ShareState {
    archiveUrl?: string | null;
    splatUrl?: string | null;
    modelUrl?: string | null;
    pointcloudUrl?: string | null;
    displayMode?: string;
    splatTransform?: Transform | null;
    modelTransform?: Transform | null;
    pointcloudTransform?: Transform | null;
}

interface ShareOption {
    param: string;
    label: string;
    type: 'select';
    options: Array<{ value: string; label: string }>;
    default: string;
}

interface UIPreset {
    label: string;
    description: string;
    settings: Record<string, string>;
}

type ShareOptions = Record<string, ShareOption>;
type UIPresets = Record<string, UIPreset>;

// =============================================================================
// URL PARAMETER DEFINITIONS
// =============================================================================

/**
 * Available share link options with their URL parameter mappings
 */
const SHARE_OPTIONS: ShareOptions = {
    // Display mode
    displayMode: {
        param: 'mode',
        label: 'Display Mode',
        type: 'select',
        options: [
            { value: 'both', label: 'Model/Splat' },
            { value: 'splat', label: 'Splat Only' },
            { value: 'model', label: 'Model Only' },
            { value: 'pointcloud', label: 'Point Cloud Only' },
            { value: 'split', label: 'Split Model/Splat' }
        ],
        default: 'both'
    },

    // Controls panel visibility
    controlsPanel: {
        param: 'controls',
        label: 'Settings Panel',
        type: 'select',
        options: [
            { value: 'full', label: 'Full Controls' },
            { value: 'minimal', label: 'Minimal Controls' },
            { value: 'none', label: 'Hidden' }
        ],
        default: 'full'
    },

    // Toolbar visibility
    toolbar: {
        param: 'toolbar',
        label: 'Toolbar Buttons',
        type: 'select',
        options: [
            { value: 'show', label: 'Visible' },
            { value: 'hide', label: 'Hidden' }
        ],
        default: 'show'
    },

    // Metadata sidebar state
    sidebar: {
        param: 'sidebar',
        label: 'Metadata Sidebar',
        type: 'select',
        options: [
            { value: 'closed', label: 'Closed' },
            { value: 'view', label: 'Open (View Only)' },
            { value: 'edit', label: 'Open (Editable)' }
        ],
        default: 'closed'
    }
};

/**
 * Preset UI modes for quick configuration
 */
const UI_PRESETS: UIPresets = {
    full: {
        label: 'Full Editor',
        description: 'All controls and editing features',
        settings: {
            controlsPanel: 'full',
            toolbar: 'show',
            sidebar: 'closed'
        }
    },
    viewer: {
        label: 'Viewer Mode',
        description: 'View-only with metadata visible',
        settings: {
            controlsPanel: 'none',
            toolbar: 'hide',
            sidebar: 'view'
        }
    },
    kiosk: {
        label: 'Kiosk Mode',
        description: 'Clean display, no UI elements',
        settings: {
            controlsPanel: 'none',
            toolbar: 'hide',
            sidebar: 'closed'
        }
    },
    minimal: {
        label: 'Minimal',
        description: 'Toolbar only, no panels',
        settings: {
            controlsPanel: 'none',
            toolbar: 'show',
            sidebar: 'closed'
        }
    }
};

// =============================================================================
// DIALOG CREATION
// =============================================================================

/**
 * Create the share dialog HTML structure
 */
function createDialogHTML(): HTMLElement {
    const dialog = document.createElement('div');
    dialog.id = 'share-dialog';
    dialog.className = 'share-dialog hidden';

    dialog.innerHTML = `
        <div class="share-dialog-backdrop"></div>
        <div class="share-dialog-content">
            <div class="share-dialog-header">
                <h3>Share Link</h3>
                <button class="share-dialog-close" title="Close">&times;</button>
            </div>

            <div class="share-dialog-body">
                <!-- Presets Section -->
                <div class="share-section">
                    <label class="share-section-label">Quick Presets</label>
                    <div class="share-presets">
                        ${Object.entries(UI_PRESETS).map(([key, preset]) => `
                            <button class="share-preset-btn" data-preset="${key}" title="${preset.description}">
                                ${preset.label}
                            </button>
                        `).join('')}
                    </div>
                </div>

                <div class="share-divider"></div>

                <!-- Individual Options -->
                <div class="share-section">
                    <label class="share-section-label">Customize Options</label>

                    <div class="share-options">
                        ${Object.entries(SHARE_OPTIONS).map(([key, option]) => `
                            <div class="share-option">
                                <label for="share-${key}">${option.label}</label>
                                <select id="share-${key}" data-option="${key}">
                                    ${option.options.map(opt => `
                                        <option value="${opt.value}">${opt.label}</option>
                                    `).join('')}
                                </select>
                            </div>
                        `).join('')}
                    </div>
                </div>

                <div class="share-divider"></div>

                <!-- Include Alignment Data -->
                <div class="share-section">
                    <label class="share-option-inline">
                        <input type="checkbox" id="share-include-alignment" checked>
                        <span>Include current alignment/transforms</span>
                    </label>
                </div>

                <!-- URL Preview -->
                <div class="share-section">
                    <label class="share-section-label">Generated Link</label>
                    <div class="share-url-container">
                        <input type="text" id="share-url-preview" readonly>
                        <button id="share-copy-btn" class="action-btn" title="Copy to clipboard">
                            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                            </svg>
                            Copy
                        </button>
                    </div>
                </div>
            </div>

            <div class="share-dialog-footer">
                <button id="share-cancel-btn" class="action-btn secondary">Cancel</button>
                <button id="share-copy-close-btn" class="action-btn">Copy & Close</button>
            </div>
        </div>
    `;

    return dialog;
}

// =============================================================================
// URL GENERATION
// =============================================================================

/**
 * Build share URL based on current options
 */
function buildShareUrl(): string {
    if (!currentState) return '';

    const baseUrl = window.location.origin + window.location.pathname;
    const params = new URLSearchParams();

    // Add content URLs
    if (currentState.archiveUrl) {
        params.set('archive', currentState.archiveUrl);
    } else {
        if (currentState.splatUrl) {
            params.set('splat', currentState.splatUrl);
        }
        if (currentState.modelUrl) {
            params.set('model', currentState.modelUrl);
        }
        if (currentState.pointcloudUrl) {
            params.set('pointcloud', currentState.pointcloudUrl);
        }
    }

    // Get current option values from the form
    const options = getSelectedOptions();

    // Add display mode (always include)
    params.set('mode', options.displayMode);

    // Add controls panel setting (only if not default)
    if (options.controlsPanel !== 'full') {
        params.set('controls', options.controlsPanel);
    }

    // Add toolbar setting (only if not default)
    if (options.toolbar !== 'show') {
        params.set('toolbar', options.toolbar);
    }

    // Add sidebar setting (only if not default)
    if (options.sidebar !== 'closed') {
        params.set('sidebar', options.sidebar);
    }

    // Add alignment data if checkbox is checked and we have transforms
    const includeAlignment = (document.getElementById('share-include-alignment') as HTMLInputElement | null)?.checked;
    if (includeAlignment && !currentState.archiveUrl) {
        addAlignmentParams(params);
    }

    return baseUrl + '?' + params.toString();
}

/**
 * Add alignment/transform parameters to URL
 */
function addAlignmentParams(params: URLSearchParams): void {
    const formatVec3 = (arr: [number, number, number]): string => arr.map(n => parseFloat(n.toFixed(4))).join(',');

    if (currentState?.splatTransform) {
        const t = currentState.splatTransform;
        const pos: [number, number, number] = [t.position.x, t.position.y, t.position.z];
        const rot: [number, number, number] = [t.rotation.x, t.rotation.y, t.rotation.z];

        if (pos[0] !== 0 || pos[1] !== 0 || pos[2] !== 0) {
            params.set('sp', formatVec3(pos));
        }
        if (rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0) {
            params.set('sr', formatVec3(rot));
        }
        if (t.scale !== undefined && t.scale !== 1) {
            params.set('ss', parseFloat(t.scale.toFixed(4)).toString());
        }
    }

    if (currentState?.modelTransform) {
        const t = currentState.modelTransform;
        const pos: [number, number, number] = [t.position.x, t.position.y, t.position.z];
        const rot: [number, number, number] = [t.rotation.x, t.rotation.y, t.rotation.z];

        if (pos[0] !== 0 || pos[1] !== 0 || pos[2] !== 0) {
            params.set('mp', formatVec3(pos));
        }
        if (rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0) {
            params.set('mr', formatVec3(rot));
        }
        if (t.scale !== undefined && t.scale !== 1) {
            params.set('ms', parseFloat(t.scale.toFixed(4)).toString());
        }
    }

    if (currentState?.pointcloudTransform) {
        const t = currentState.pointcloudTransform;
        const pos: [number, number, number] = [t.position.x, t.position.y, t.position.z];
        const rot: [number, number, number] = [t.rotation.x, t.rotation.y, t.rotation.z];

        if (pos[0] !== 0 || pos[1] !== 0 || pos[2] !== 0) {
            params.set('pp', formatVec3(pos));
        }
        if (rot[0] !== 0 || rot[1] !== 0 || rot[2] !== 0) {
            params.set('pr', formatVec3(rot));
        }
        if (t.scale !== undefined && t.scale !== 1) {
            params.set('ps', parseFloat(t.scale.toFixed(4)).toString());
        }
    }
}

/**
 * Get currently selected options from the form
 */
function getSelectedOptions(): Record<string, string> {
    const options: Record<string, string> = {};

    Object.keys(SHARE_OPTIONS).forEach(key => {
        const select = document.getElementById(`share-${key}`) as HTMLSelectElement | null;
        options[key] = select ? select.value : SHARE_OPTIONS[key].default;
    });

    return options;
}

/**
 * Update URL preview
 */
function updateUrlPreview(): void {
    const preview = document.getElementById('share-url-preview') as HTMLInputElement | null;
    if (preview) {
        preview.value = buildShareUrl();
    }
}

// =============================================================================
// EVENT HANDLERS
// =============================================================================

/**
 * Apply a preset configuration
 */
function applyPreset(presetKey: string): void {
    const preset = UI_PRESETS[presetKey];
    if (!preset) return;

    // Update form values
    Object.entries(preset.settings).forEach(([optionKey, value]) => {
        const select = document.getElementById(`share-${optionKey}`) as HTMLSelectElement | null;
        if (select) {
            select.value = value;
        }
    });

    // Update preset button states
    document.querySelectorAll('.share-preset-btn').forEach(btn => {
        btn.classList.toggle('active', (btn as HTMLElement).dataset.preset === presetKey);
    });

    updateUrlPreview();
}

/**
 * Copy URL to clipboard
 */
async function copyToClipboard(): Promise<boolean> {
    const url = buildShareUrl();

    try {
        await navigator.clipboard.writeText(url);

        // Visual feedback
        const copyBtn = document.getElementById('share-copy-btn');
        if (copyBtn) {
            const originalText = copyBtn.innerHTML;
            copyBtn.innerHTML = `
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <polyline points="20 6 9 17 4 12"></polyline>
                </svg>
                Copied!
            `;
            copyBtn.classList.add('success');

            setTimeout(() => {
                copyBtn.innerHTML = originalText;
                copyBtn.classList.remove('success');
            }, 2000);
        }

        return true;
    } catch (err) {
        log.error('Failed to copy to clipboard:', err);
        return false;
    }
}

/**
 * Set up event listeners for the dialog
 */
function setupEventListeners(): void {
    if (!dialogElement) return;

    // Close button
    dialogElement.querySelector('.share-dialog-close')?.addEventListener('click', hideShareDialog);

    // Backdrop click to close
    dialogElement.querySelector('.share-dialog-backdrop')?.addEventListener('click', hideShareDialog);

    // Cancel button
    document.getElementById('share-cancel-btn')?.addEventListener('click', hideShareDialog);

    // Copy & Close button
    document.getElementById('share-copy-close-btn')?.addEventListener('click', async () => {
        if (await copyToClipboard()) {
            hideShareDialog();
            // Trigger notification if available
            if ((window as any).notify) {
                (window as any).notify.success('Share link copied to clipboard!');
            }
        }
    });

    // Copy button
    document.getElementById('share-copy-btn')?.addEventListener('click', copyToClipboard);

    // Preset buttons
    dialogElement.querySelectorAll('.share-preset-btn').forEach(btn => {
        btn.addEventListener('click', () => applyPreset((btn as HTMLElement).dataset.preset || ''));
    });

    // Option changes update URL preview
    Object.keys(SHARE_OPTIONS).forEach(key => {
        const select = document.getElementById(`share-${key}`);
        select?.addEventListener('change', () => {
            // Clear active preset when manually changing options
            document.querySelectorAll('.share-preset-btn').forEach(btn => {
                btn.classList.remove('active');
            });
            updateUrlPreview();
        });
    });

    // Alignment checkbox
    document.getElementById('share-include-alignment')?.addEventListener('change', updateUrlPreview);

    // Escape key to close
    document.addEventListener('keydown', handleEscapeKey);
}

function handleEscapeKey(e: KeyboardEvent): void {
    if (e.key === 'Escape' && dialogElement && !dialogElement.classList.contains('hidden')) {
        hideShareDialog();
    }
}

// =============================================================================
// PUBLIC API
// =============================================================================

/**
 * Initialize the share dialog (call once on app startup)
 */
export function initShareDialog(): void {
    if (dialogElement) return; // Already initialized

    dialogElement = createDialogHTML();
    document.body.appendChild(dialogElement);
    setupEventListeners();

    log.info('Share dialog initialized');
}

/**
 * Show the share dialog
 * @param state - Current app state with URLs and transforms
 */
export function showShareDialog(state: ShareState | AppState): void {
    if (!dialogElement) {
        initShareDialog();
    }

    // Validate that we have shareable content
    if (!state.archiveUrl && !state.splatUrl && !state.modelUrl) {
        if ((window as any).notify) {
            (window as any).notify.warning('Cannot share: No files loaded from URL. Share links only work for files loaded via URL, not local uploads.');
        }
        return;
    }

    // Store state for URL generation
    currentState = state as ShareState;

    // Reset form to current state
    const displayModeSelect = document.getElementById('share-displayMode') as HTMLSelectElement | null;
    if (displayModeSelect && state.displayMode) {
        displayModeSelect.value = state.displayMode;
    }

    // Reset other options to defaults
    const controlsPanelSelect = document.getElementById('share-controlsPanel') as HTMLSelectElement | null;
    const toolbarSelect = document.getElementById('share-toolbar') as HTMLSelectElement | null;
    const sidebarSelect = document.getElementById('share-sidebar') as HTMLSelectElement | null;
    const alignmentCheckbox = document.getElementById('share-include-alignment') as HTMLInputElement | null;

    if (controlsPanelSelect) controlsPanelSelect.value = 'full';
    if (toolbarSelect) toolbarSelect.value = 'show';
    if (sidebarSelect) sidebarSelect.value = 'closed';
    if (alignmentCheckbox) alignmentCheckbox.checked = true;

    // Clear preset selection
    document.querySelectorAll('.share-preset-btn').forEach(btn => {
        btn.classList.remove('active');
    });

    // Update URL preview
    updateUrlPreview();

    // Show dialog
    dialogElement.classList.remove('hidden');

    // Focus URL input for easy copying
    setTimeout(() => {
        const preview = document.getElementById('share-url-preview') as HTMLInputElement | null;
        preview?.select();
    }, 100);
}

/**
 * Hide the share dialog
 */
function hideShareDialog(): void {
    if (dialogElement) {
        dialogElement.classList.add('hidden');
    }
    currentState = null;
}
