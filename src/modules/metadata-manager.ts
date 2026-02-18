/**
 * Metadata Manager Module
 *
 * Handles metadata display and editing:
 * - Metadata sidebar (view/edit/annotations modes)
 * - Museum-style metadata display
 * - Metadata collection from form
 * - Metadata prefill from archive manifest
 * - Custom fields management
 * - Stats display
 * - Archive metadata UI
 */

import { Logger, parseMarkdown, resolveAssetRefs } from './utilities.js';
import type { AppState, Annotation } from '@/types.js';
import type { MetadataProfile } from './metadata-profile.js';
import { TAB_TIERS, isTierVisible, computeCompleteness } from './metadata-profile.js';

const log = Logger.getLogger('metadata-manager');

let activeProfile: MetadataProfile = 'standard';

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

export interface MetadataDeps {
    state?: AppState;
    annotationSystem?: any; // TODO: Create AnnotationSystem interface
    onAddAnnotation?: () => void;
    onUpdateAnnotationCamera?: () => void;
    onDeleteAnnotation?: () => void;
    onAnnotationUpdated?: () => void;
    onExportMetadata?: () => void;
    onImportMetadata?: () => void;
    getCameraState?: () => { position: { x: number; y: number; z: number }; target: { x: number; y: number; z: number } };
    imageAssets?: Map<string, { blob: Blob; url: string; name: string }>;
    currentSplatBlob?: Blob | null;
    currentMeshBlob?: Blob | null;
    currentPointcloudBlob?: Blob | null;
}

export interface MetadataProject {
    title: string;
    id: string;
    description: string;
    license: string;
    tags: string[];
}

export interface MetadataRelationships {
    partOf: string;
    derivedFrom: string;
    replaces: string;
    relatedObjects: Array<{
        title: string;
        description: string;
        url: string;
    }>;
}

export interface MetadataProvenance {
    captureDate: string;
    captureDevice: string;
    deviceSerial: string;
    operator: string;
    operatorOrcid: string;
    location: string;
    conventions: string;
    processingSoftware: Array<{
        name: string;
        version: string;
        url: string;
    }>;
    processingNotes: string;
}

export interface CaptureResolution {
    value: number | null;
    unit: string;
    type: string;
}

export interface AlignmentError {
    value: number | null;
    unit: string;
    method: string;
}

export interface DataQuality {
    coverageGaps: string;
    reconstructionAreas: string;
    colorCalibration: string;
    measurementUncertainty: string;
}

export interface MetadataQualityMetrics {
    tier: string;
    accuracyGrade: string;
    captureResolution: CaptureResolution;
    alignmentError: AlignmentError;
    scaleVerification: string;
    dataQuality: DataQuality;
}

export interface MetadataArchivalRecord {
    standard: string;
    title: string;
    alternateTitles: string[];
    ids: {
        accessionNumber: string;
        sirisId: string;
        uri: string;
    };
    creation: {
        creator: string;
        dateCreated: string;
        period: string;
        culture: string;
    };
    physicalDescription: {
        medium: string;
        dimensions: {
            height: string;
            width: string;
            depth: string;
        };
        condition: string;
    };
    provenance: string;
    rights: {
        copyrightStatus: string;
        creditLine: string;
    };
    context: {
        description: string;
        locationHistory: string;
    };
    coverage: {
        spatial: {
            locationName: string;
            coordinates: [number | null, number | null];
        };
        temporal: {
            subjectPeriod: string;
            subjectDateCirca: boolean;
        };
    };
}

export interface MetadataMaterialStandard {
    workflow: string;
    occlusionPacked: boolean;
    colorSpace: string;
    normalSpace: string;
}

export interface MetadataPreservation {
    formatRegistry: {
        glb: string;
        obj: string;
        ply: string;
        e57: string;
    };
    significantProperties: string[];
    renderingRequirements: string;
    renderingNotes: string;
}

export interface AssetMetadata {
    createdBy: string;
    version: string;
    sourceNotes: string;
    role: string;
}

export interface ViewerSettings {
    singleSided: boolean;
    backgroundColor: string | null;
    displayMode: string;
    cameraPosition: { x: number; y: number; z: number } | null;
    cameraTarget: { x: number; y: number; z: number } | null;
    autoRotate: boolean;
    annotationsVisible: boolean;
}

export interface VersionHistoryEntry {
    version: string;
    date: string;
    description: string;
}

export interface CollectedMetadata {
    project: MetadataProject;
    relationships: MetadataRelationships;
    provenance: MetadataProvenance;
    qualityMetrics: MetadataQualityMetrics;
    archivalRecord: MetadataArchivalRecord;
    materialStandard: MetadataMaterialStandard;
    preservation: MetadataPreservation;
    splatMetadata: AssetMetadata;
    meshMetadata: AssetMetadata;
    pointcloudMetadata: AssetMetadata;
    customFields: Record<string, string>;
    versionHistory: VersionHistoryEntry[];
    includeIntegrity: boolean;
    viewerSettings: ViewerSettings;
}

interface ValidationRule {
    pattern?: RegExp;
    validate?: (value: string) => boolean;
    message: string;
    emptyOk: boolean;
}

// =============================================================================
// METADATA SIDEBAR
// =============================================================================

/**
 * Show metadata sidebar in specified mode
 */
export function showMetadataSidebar(mode: 'view' | 'edit' | 'annotations' = 'view', deps: MetadataDeps = {}): void {
    const sidebar = document.getElementById('metadata-sidebar');
    if (!sidebar) return;

    sidebar.classList.remove('hidden');

    // Switch to the requested mode
    switchSidebarMode(mode, deps);

    // Update toolbar button state
    const btn = document.getElementById('btn-metadata');
    if (btn) btn.classList.add('active');

    // Adjust annotation bar to account for sidebar width
    const annotationBar = document.getElementById('annotation-bar');
    if (annotationBar) annotationBar.style.right = '380px';
}

/**
 * Hide metadata sidebar
 */
export function hideMetadataSidebar(): void {
    const sidebar = document.getElementById('metadata-sidebar');
    if (sidebar) {
        sidebar.classList.add('hidden');
    }

    const btn = document.getElementById('btn-metadata');
    if (btn) btn.classList.remove('active');

    // Reset annotation bar to full width
    const annotationBar = document.getElementById('annotation-bar');
    if (annotationBar) annotationBar.style.right = '0';

    // Trigger resize so the 3D view reclaims the space after transition
    setTimeout(() => window.dispatchEvent(new Event('resize')), 300);
}

/**
 * Switch sidebar mode (view/edit/annotations)
 */
export function switchSidebarMode(mode: string, deps: MetadataDeps = {}): void {
    // Update tab buttons
    const tabs = document.querySelectorAll('.sidebar-mode-tab');
    tabs.forEach(tab => {
        tab.classList.toggle('active', (tab as HTMLElement).dataset.mode === mode);
    });

    // Update content sections
    const contents = document.querySelectorAll('.sidebar-mode-content');
    contents.forEach(content => {
        content.classList.toggle('active', content.id === `sidebar-${mode}`);
    });

    // Refresh content for the selected mode
    if (mode === 'view') {
        populateMetadataDisplay(deps);
    } else if (mode === 'edit') {
        updateMetadataStats(deps);
        updateAssetStatus(deps);
    }
}

/**
 * Switch edit sub-tab
 */
export function switchEditTab(tabName: string): void {
    // Update tab buttons
    const tabs = document.querySelectorAll('.edit-tab');
    tabs.forEach(tab => {
        tab.classList.toggle('active', (tab as HTMLElement).dataset.tab === tabName);
    });

    // Update content sections
    const contents = document.querySelectorAll('.edit-tab-content');
    contents.forEach(content => {
        content.classList.toggle('active', content.id === `edit-tab-${tabName}`);
    });
}

/**
 * Toggle metadata display visibility
 */
export function toggleMetadataDisplay(deps: MetadataDeps = {}): void {
    const sidebar = document.getElementById('metadata-sidebar');
    if (!sidebar) return;

    if (sidebar.classList.contains('hidden')) {
        showMetadataSidebar('view', deps);
    } else {
        hideMetadataSidebar();
    }
}

// Legacy function names for compatibility
export function showMetadataPanel(deps: MetadataDeps = {}): void {
    showMetadataSidebar('edit', deps);
}

export function hideMetadataPanel(): void {
    hideMetadataSidebar();
}

// =============================================================================
// METADATA TABS SETUP
// =============================================================================

/**
 * Setup metadata tab switching (legacy)
 */
export function setupMetadataTabs(): void {
    const tabs = document.querySelectorAll('.metadata-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update active content
            const tabContents = document.querySelectorAll('.metadata-tab-content');
            tabContents.forEach(content => content.classList.remove('active'));

            const tabId = (tab as HTMLElement).dataset.tab;
            const targetContent = document.getElementById(`tab-${tabId}`);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });
}

/**
 * Get the currently active metadata profile.
 */
export function getActiveProfile(): MetadataProfile {
    return activeProfile;
}

/**
 * Set the active metadata profile. Updates UI visibility and completeness indicator.
 */
export function setActiveProfile(profile: MetadataProfile): void {
    activeProfile = profile;

    // Update button active states
    document.querySelectorAll('#metadata-profile-selector .profile-btn').forEach(btn => {
        (btn as HTMLElement).classList.toggle('active', (btn as HTMLElement).dataset.profile === profile);
    });

    // Set data attribute for CSS-driven tier visibility
    const editPanel = document.getElementById('sidebar-edit');
    if (editPanel) editPanel.dataset.activeProfile = profile;

    // Update dropdown options visibility (hidden + disabled for Safari compat)
    const select = document.getElementById('edit-category-select') as HTMLSelectElement | null;
    if (select) {
        Array.from(select.options).forEach(opt => {
            const tabTier = TAB_TIERS[opt.value] as MetadataProfile | undefined;
            if (tabTier) {
                const visible = isTierVisible(tabTier, profile);
                opt.hidden = !visible;
                opt.disabled = !visible;
            }
        });

        // If current tab is now hidden, switch to first visible tab
        const currentOpt = select.options[select.selectedIndex];
        if (currentOpt?.hidden) {
            const firstVisible = Array.from(select.options).find(o => !o.hidden);
            if (firstVisible) {
                select.value = firstVisible.value;
                switchEditTab(firstVisible.value);
            }
        }
    }

    updateCompleteness();
}

/**
 * Update the completeness indicator based on the active profile.
 */
export function updateCompleteness(): void {
    const { filled, total } = computeCompleteness(activeProfile);
    const percent = total > 0 ? Math.round((filled / total) * 100) : 0;

    const fill = document.getElementById('completeness-fill');
    const text = document.getElementById('completeness-text');
    if (fill) fill.style.width = `${percent}%`;
    if (text) text.textContent = `${filled} / ${total}`;
}

/**
 * Wire up the profile selector buttons.
 */
function setupProfileSelector(): void {
    const container = document.getElementById('metadata-profile-selector');
    if (!container) return;

    container.addEventListener('click', (e) => {
        const btn = (e.target as HTMLElement).closest('.profile-btn') as HTMLElement | null;
        if (!btn?.dataset.profile) return;
        setActiveProfile(btn.dataset.profile as MetadataProfile);
    });

    // Set initial state
    setActiveProfile(activeProfile);

    // Debounced completeness updates on field changes
    let completenessTimer: ReturnType<typeof setTimeout>;
    const editPanel = document.getElementById('sidebar-edit');
    if (editPanel) {
        editPanel.addEventListener('input', () => {
            clearTimeout(completenessTimer);
            completenessTimer = setTimeout(updateCompleteness, 300);
        });
        editPanel.addEventListener('change', () => {
            clearTimeout(completenessTimer);
            completenessTimer = setTimeout(updateCompleteness, 300);
        });
    }
}

/**
 * Setup metadata sidebar event handlers
 */
export function setupMetadataSidebar(deps: MetadataDeps = {}): void {
    // Mode tabs (View/Edit/Annotations)
    const modeTabs = document.querySelectorAll('.sidebar-mode-tab');
    modeTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const mode = (tab as HTMLElement).dataset.mode;
            if (mode) {
                switchSidebarMode(mode, deps);
            }
        });
    });

    // Edit category dropdown
    const editCategorySelect = document.getElementById('edit-category-select') as HTMLSelectElement | null;
    if (editCategorySelect) {
        editCategorySelect.addEventListener('change', () => {
            switchEditTab(editCategorySelect.value);
        });
    }

    // Close button
    const closeBtn = document.getElementById('btn-close-sidebar');
    if (closeBtn) {
        closeBtn.addEventListener('click', hideMetadataSidebar);
    }

    // Sidebar Add Annotation button
    const addAnnoBtn = document.getElementById('btn-sidebar-add-annotation');
    if (addAnnoBtn && deps.onAddAnnotation) {
        addAnnoBtn.addEventListener('click', () => {
            hideMetadataSidebar();
            deps.onAddAnnotation!();
        });
    }

    // Sidebar annotation editor buttons
    const updateCameraBtn = document.getElementById('btn-sidebar-update-anno-camera');
    if (updateCameraBtn && deps.onUpdateAnnotationCamera) {
        updateCameraBtn.addEventListener('click', deps.onUpdateAnnotationCamera);
    }

    const deleteAnnoBtn = document.getElementById('btn-sidebar-delete-anno');
    if (deleteAnnoBtn && deps.onDeleteAnnotation) {
        deleteAnnoBtn.addEventListener('click', deps.onDeleteAnnotation);
    }

    // Sidebar annotation title/body change handlers
    const annoTitleInput = document.getElementById('sidebar-edit-anno-title') as HTMLInputElement | null;
    const annoBodyInput = document.getElementById('sidebar-edit-anno-body') as HTMLTextAreaElement | null;

    if (annoTitleInput && deps.annotationSystem) {
        annoTitleInput.addEventListener('change', () => {
            const selectedAnno = deps.annotationSystem.selectedAnnotation;
            if (selectedAnno) {
                deps.annotationSystem.updateAnnotation(selectedAnno.id, {
                    title: annoTitleInput.value
                });
                if (deps.onAnnotationUpdated) deps.onAnnotationUpdated();
            }
        });
    }

    if (annoBodyInput && deps.annotationSystem) {
        annoBodyInput.addEventListener('change', () => {
            const selectedAnno = deps.annotationSystem.selectedAnnotation;
            if (selectedAnno) {
                deps.annotationSystem.updateAnnotation(selectedAnno.id, {
                    body: annoBodyInput.value
                });
            }
        });
    }

    // Dynamic list add buttons
    const addSoftwareBtn = document.getElementById('btn-add-processing-software');
    if (addSoftwareBtn) {
        addSoftwareBtn.addEventListener('click', addProcessingSoftware);
    }

    const addRelatedBtn = document.getElementById('btn-add-related-object');
    if (addRelatedBtn) {
        addRelatedBtn.addEventListener('click', addRelatedObject);
    }

    const addVersionBtn = document.getElementById('btn-add-version-entry');
    if (addVersionBtn) {
        addVersionBtn.addEventListener('click', addVersionEntry);
    }

    // Image insert buttons — shared file input, target tracks which textarea
    const imageInput = document.getElementById('image-insert-input') as HTMLInputElement | null;
    let activeTextarea: HTMLTextAreaElement | null = null;

    function insertAtCursor(textarea: HTMLTextAreaElement, text: string): void {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const before = textarea.value.substring(0, start);
        const after = textarea.value.substring(end);
        textarea.value = before + text + after;
        textarea.selectionStart = textarea.selectionEnd = start + text.length;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function sanitizeFileName(name: string): string {
        return name.replace(/[^a-zA-Z0-9._-]/g, '_').toLowerCase();
    }

    if (imageInput) {
        // Wire up insert buttons to open file picker
        const insertButtons = [
            { btnId: 'btn-anno-insert-image', textareaId: 'anno-body' },
            { btnId: 'btn-sidebar-insert-image', textareaId: 'sidebar-edit-anno-body' },
            { btnId: 'btn-desc-insert-image', textareaId: 'meta-description' }
        ];

        insertButtons.forEach(({ btnId, textareaId }) => {
            const btn = document.getElementById(btnId);
            if (btn) {
                btn.addEventListener('click', (e) => {
                    e.preventDefault();
                    activeTextarea = document.getElementById(textareaId) as HTMLTextAreaElement | null;
                    imageInput.value = '';
                    imageInput.click();
                });
            }
        });

        // Handle file selection
        imageInput.addEventListener('change', () => {
            const file = imageInput.files?.[0];
            if (!file || !activeTextarea) return;

            const ext = file.name.split('.').pop()?.toLowerCase() || '';
            const baseName = file.name.replace(/\.[^.]+$/, '');
            const safeName = sanitizeFileName(baseName);
            const timestamp = Date.now();
            const assetPath = `images/${safeName}_${timestamp}.${ext}`;

            const blob = file;
            const url = URL.createObjectURL(blob);

            // Store in imageAssets if available via deps
            if (deps.imageAssets) {
                deps.imageAssets.set(assetPath, { blob, url, name: file.name });
            }

            // Insert markdown at cursor
            insertAtCursor(activeTextarea, `![${file.name}](asset:${assetPath})`);
            activeTextarea = null;
        });
    }

    // Metadata import/export buttons
    if (deps.onExportMetadata) {
        const exportBtn = document.getElementById('btn-export-metadata');
        if (exportBtn) exportBtn.addEventListener('click', deps.onExportMetadata);
    }
    if (deps.onImportMetadata) {
        const importBtn = document.getElementById('btn-import-metadata');
        if (importBtn) importBtn.addEventListener('click', deps.onImportMetadata);
    }

    // Setup field validation
    setupFieldValidation();

    // Profile selector
    setupProfileSelector();

    // Camera save/clear buttons
    const saveCameraBtn = document.getElementById('btn-save-camera');
    if (saveCameraBtn) {
        saveCameraBtn.addEventListener('click', () => {
            if (deps.getCameraState) {
                const cam = deps.getCameraState();
                setCameraHiddenFields('pos', cam.position);
                setCameraHiddenFields('target', cam.target);
                updateCameraSaveDisplay();
                updateCompleteness();
            }
        });
    }

    const clearCameraBtn = document.getElementById('btn-clear-camera');
    if (clearCameraBtn) {
        clearCameraBtn.addEventListener('click', () => {
            ['pos-x', 'pos-y', 'pos-z', 'target-x', 'target-y', 'target-z'].forEach(suffix => {
                const el = document.getElementById(`meta-viewer-camera-${suffix}`) as HTMLInputElement | null;
                if (el) el.value = '';
            });
            updateCameraSaveDisplay();
            updateCompleteness();
        });
    }
}

/**
 * Setup license dropdown custom field toggle
 */
export function setupLicenseField(): void {
    const licenseSelect = document.getElementById('meta-license') as HTMLSelectElement | null;
    const customLicenseField = document.getElementById('custom-license-field');

    if (licenseSelect && customLicenseField) {
        licenseSelect.addEventListener('change', () => {
            if (licenseSelect.value === 'custom') {
                customLicenseField.classList.remove('hidden');
            } else {
                customLicenseField.classList.add('hidden');
            }
        });
    }
}

// =============================================================================
// STATS DISPLAY
// =============================================================================

/**
 * Format file size for display
 */
export function formatFileSize(bytes: number): string {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Update quality stats display in metadata panel
 */
export function updateMetadataStats(deps: MetadataDeps = {}): void {
    const { state = {} as AppState, annotationSystem, currentSplatBlob, currentMeshBlob, currentPointcloudBlob } = deps;

    // Splat count
    const splatCountEl = document.getElementById('meta-splat-count');
    if (splatCountEl) {
        splatCountEl.textContent = state.splatLoaded
            ? (document.getElementById('splat-vertices')?.textContent || '-')
            : '-';
    }

    // Mesh polygons and vertices
    const meshPolysEl = document.getElementById('meta-mesh-polys');
    const meshVertsEl = document.getElementById('meta-mesh-verts');
    if (meshPolysEl) {
        meshPolysEl.textContent = state.modelLoaded
            ? (document.getElementById('model-faces')?.textContent || '-')
            : '-';
    }
    if (meshVertsEl) {
        meshVertsEl.textContent = state.modelLoaded
            ? (state.meshVertexCount?.toString() || '-')
            : '-';
    }

    // Annotation count
    const annoCountEl = document.getElementById('meta-anno-count');
    if (annoCountEl && annotationSystem) {
        annoCountEl.textContent = annotationSystem.getCount().toString();
    }

    // File sizes
    const splatSizeEl = document.getElementById('meta-splat-size');
    const meshSizeEl = document.getElementById('meta-mesh-size');
    const archiveSizeEl = document.getElementById('meta-archive-size');

    if (splatSizeEl && currentSplatBlob) {
        splatSizeEl.textContent = formatFileSize(currentSplatBlob.size);
    } else if (splatSizeEl) {
        splatSizeEl.textContent = '-';
    }

    if (meshSizeEl && currentMeshBlob) {
        meshSizeEl.textContent = formatFileSize(currentMeshBlob.size);
    } else if (meshSizeEl) {
        meshSizeEl.textContent = '-';
    }

    if (archiveSizeEl) {
        let totalSize = 0;
        if (currentSplatBlob) totalSize += currentSplatBlob.size;
        if (currentMeshBlob) totalSize += currentMeshBlob.size;
        if (currentPointcloudBlob) totalSize += currentPointcloudBlob.size;
        archiveSizeEl.textContent = totalSize > 0 ? '~' + formatFileSize(totalSize) : '-';
    }
}

/**
 * Update asset status in metadata panel
 */
export function updateAssetStatus(deps: MetadataDeps = {}): void {
    const { state = {} as AppState } = deps;

    // Splat asset
    const splatStatus = document.getElementById('splat-asset-status');
    const splatFields = document.getElementById('splat-asset-fields');
    if (splatStatus) {
        if (state.splatLoaded) {
            const fileName = document.getElementById('splat-filename')?.textContent || 'Scene loaded';
            splatStatus.textContent = fileName;
            splatStatus.classList.add('loaded');
            if (splatFields) splatFields.classList.remove('hidden');
        } else {
            splatStatus.textContent = 'No splat loaded';
            splatStatus.classList.remove('loaded');
            if (splatFields) splatFields.classList.add('hidden');
        }
    }

    // Mesh asset
    const meshStatus = document.getElementById('mesh-asset-status');
    const meshFields = document.getElementById('mesh-asset-fields');
    if (meshStatus) {
        if (state.modelLoaded) {
            const fileName = document.getElementById('model-filename')?.textContent || 'Mesh loaded';
            meshStatus.textContent = fileName;
            meshStatus.classList.add('loaded');
            if (meshFields) meshFields.classList.remove('hidden');
        } else {
            meshStatus.textContent = 'No mesh loaded';
            meshStatus.classList.remove('loaded');
            if (meshFields) meshFields.classList.add('hidden');
        }
    }

    // Pointcloud asset
    const pcStatus = document.getElementById('pointcloud-asset-status');
    const pcFields = document.getElementById('pointcloud-asset-fields');
    if (pcStatus) {
        if (state.pointcloudLoaded) {
            const fileName = document.getElementById('pointcloud-filename')?.textContent || 'Point cloud loaded';
            pcStatus.textContent = fileName;
            pcStatus.classList.add('loaded');
            if (pcFields) pcFields.classList.remove('hidden');
        } else {
            pcStatus.textContent = 'No point cloud loaded';
            pcStatus.classList.remove('loaded');
            if (pcFields) pcFields.classList.add('hidden');
        }
    }
}

// =============================================================================
// CUSTOM FIELDS
// =============================================================================

/**
 * Add a custom field row
 */
export function addCustomField(): void {
    const container = document.getElementById('custom-fields-list');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'custom-field-row';

    // Create elements using safe DOM methods
    const keyInput = document.createElement('input');
    keyInput.type = 'text';
    keyInput.className = 'custom-field-key';
    keyInput.placeholder = 'Key';

    const valueInput = document.createElement('input');
    valueInput.type = 'text';
    valueInput.className = 'custom-field-value';
    valueInput.placeholder = 'Value';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'custom-field-remove';
    removeBtn.title = 'Remove';
    removeBtn.textContent = '\u00D7'; // × character
    removeBtn.addEventListener('click', () => row.remove());

    row.appendChild(keyInput);
    row.appendChild(valueInput);
    row.appendChild(removeBtn);
    container.appendChild(row);
}

/**
 * Add a processing software row with name, version, and URL fields
 */
export function addProcessingSoftware(): void {
    const container = document.getElementById('processing-software-list');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'software-row';

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'software-name';
    nameInput.placeholder = 'Software name';

    const versionInput = document.createElement('input');
    versionInput.type = 'text';
    versionInput.className = 'software-version';
    versionInput.placeholder = 'Version';

    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.className = 'software-url';
    urlInput.placeholder = 'URL (optional)';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.title = 'Remove';
    removeBtn.textContent = '\u00D7';
    removeBtn.addEventListener('click', () => row.remove());

    row.appendChild(nameInput);
    row.appendChild(versionInput);
    row.appendChild(urlInput);
    row.appendChild(removeBtn);
    container.appendChild(row);
}

/**
 * Add a related object row with title, description, and URL fields
 */
export function addRelatedObject(): void {
    const container = document.getElementById('related-objects-list');
    if (!container) return;

    const row = document.createElement('div');
    row.className = 'related-object-row';

    const titleInput = document.createElement('input');
    titleInput.type = 'text';
    titleInput.className = 'related-object-title';
    titleInput.placeholder = 'Title';

    const descInput = document.createElement('input');
    descInput.type = 'text';
    descInput.className = 'related-object-desc';
    descInput.placeholder = 'Description / relationship';

    const urlInput = document.createElement('input');
    urlInput.type = 'url';
    urlInput.className = 'related-object-url';
    urlInput.placeholder = 'URL (optional)';

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.title = 'Remove';
    removeBtn.textContent = '\u00D7';
    removeBtn.addEventListener('click', () => row.remove());

    row.appendChild(titleInput);
    row.appendChild(descInput);
    row.appendChild(urlInput);
    row.appendChild(removeBtn);
    container.appendChild(row);
}

/**
 * Add a version history row with version and description fields
 */
export function addVersionEntry(): void {
    const container = document.getElementById('version-history-list');
    if (!container) {
        log.warn('Version history container not found');
        return;
    }

    const row = document.createElement('div');
    row.className = 'version-history-row';

    const versionInput = document.createElement('input');
    versionInput.type = 'text';
    versionInput.className = 'version-entry-version';
    versionInput.placeholder = 'e.g., 1.0';

    const descInput = document.createElement('textarea');
    descInput.className = 'version-entry-description';
    descInput.placeholder = 'What changed...';
    descInput.rows = 1;

    const removeBtn = document.createElement('button');
    removeBtn.className = 'remove-btn';
    removeBtn.title = 'Remove';
    removeBtn.textContent = '\u00D7';
    removeBtn.addEventListener('click', () => {
        row.remove();
        log.info('Version history entry removed');
    });

    row.appendChild(versionInput);
    row.appendChild(descInput);
    row.appendChild(removeBtn);
    container.appendChild(row);

    log.info('Version history entry added');
}

// =============================================================================
// METADATA VALIDATION (ADVISORY)
// =============================================================================

const VALIDATION_RULES: Record<string, ValidationRule> = {
    'meta-operator-orcid': {
        pattern: /^\d{4}-\d{4}-\d{4}-\d{3}[\dX]$/,
        message: 'ORCID must be in format 0000-0000-0000-000X',
        emptyOk: true
    },
    'meta-coverage-lat': {
        validate: (v) => { const n = parseFloat(v); return !isNaN(n) && n >= -90 && n <= 90; },
        message: 'Latitude must be between -90 and 90',
        emptyOk: true
    },
    'meta-coverage-lon': {
        validate: (v) => { const n = parseFloat(v); return !isNaN(n) && n >= -180 && n <= 180; },
        message: 'Longitude must be between -180 and 180',
        emptyOk: true
    },
    'meta-capture-date': {
        validate: (v) => !isNaN(new Date(v).getTime()),
        message: 'Invalid date format',
        emptyOk: true
    },
    'meta-pres-format-glb': {
        pattern: /^fmt\/\d+$/,
        message: 'PRONOM ID must be in format fmt/NNN',
        emptyOk: true
    },
    'meta-pres-format-obj': {
        pattern: /^fmt\/\d+$/,
        message: 'PRONOM ID must be in format fmt/NNN',
        emptyOk: true
    },
    'meta-pres-format-ply': {
        pattern: /^fmt\/\d+$/,
        message: 'PRONOM ID must be in format fmt/NNN',
        emptyOk: true
    },
    'meta-pres-format-e57': {
        pattern: /^fmt\/\d+$/,
        message: 'PRONOM ID must be in format fmt/NNN',
        emptyOk: true
    }
};

/**
 * Validate a single field by ID. Shows/clears inline error.
 */
function validateField(fieldId: string): boolean {
    const field = document.getElementById(fieldId) as HTMLInputElement | null;
    if (!field) return true;

    const rule = VALIDATION_RULES[fieldId];
    if (!rule) return true;

    const value = field.value.trim();

    // Remove existing error
    const existingError = field.parentElement?.querySelector('.field-error');
    if (existingError) existingError.remove();
    field.classList.remove('validation-error', 'validation-valid');

    if (!value && rule.emptyOk) {
        return true;
    }

    let isValid = false;
    if (rule.pattern) {
        isValid = rule.pattern.test(value);
    } else if (rule.validate) {
        isValid = rule.validate(value);
    }

    if (isValid) {
        field.classList.add('validation-valid');
    } else {
        field.classList.add('validation-error');
        const errorSpan = document.createElement('span');
        errorSpan.className = 'field-error';
        errorSpan.textContent = rule.message;
        field.parentElement?.appendChild(errorSpan);
    }

    return isValid;
}

/**
 * Attach blur-event validation listeners to all validated fields.
 * Called once from setupMetadataSidebar().
 */
export function setupFieldValidation(): void {
    for (const fieldId in VALIDATION_RULES) {
        const field = document.getElementById(fieldId);
        if (field) {
            field.addEventListener('blur', () => validateField(fieldId));
        }
    }
}

// =============================================================================
// METADATA COLLECTION
// =============================================================================

function getCameraFromHiddenFields(prefix: 'pos' | 'target'): { x: number; y: number; z: number } | null {
    const x = (document.getElementById(`meta-viewer-camera-${prefix}-x`) as HTMLInputElement)?.value;
    const y = (document.getElementById(`meta-viewer-camera-${prefix}-y`) as HTMLInputElement)?.value;
    const z = (document.getElementById(`meta-viewer-camera-${prefix}-z`) as HTMLInputElement)?.value;
    if (!x && !y && !z) return null;
    return { x: parseFloat(x) || 0, y: parseFloat(y) || 0, z: parseFloat(z) || 0 };
}

function setCameraHiddenFields(prefix: 'pos' | 'target', coords: { x: number; y: number; z: number }): void {
    const setVal = (suffix: string, val: number) => {
        const el = document.getElementById(`meta-viewer-camera-${prefix}-${suffix}`) as HTMLInputElement | null;
        if (el) el.value = val.toFixed(4);
    };
    setVal('x', coords.x);
    setVal('y', coords.y);
    setVal('z', coords.z);
}

function updateCameraSaveDisplay(): void {
    const pos = getCameraFromHiddenFields('pos');
    const target = getCameraFromHiddenFields('target');
    const savedInfo = document.getElementById('camera-saved-info');
    const hint = document.getElementById('camera-save-hint');
    const clearBtn = document.getElementById('btn-clear-camera');
    const posDisplay = document.getElementById('camera-pos-display');
    const targetDisplay = document.getElementById('camera-target-display');

    if (pos && target) {
        if (savedInfo) savedInfo.style.display = '';
        if (hint) hint.style.display = 'none';
        if (clearBtn) clearBtn.style.display = '';
        if (posDisplay) posDisplay.textContent = `${pos.x.toFixed(2)}, ${pos.y.toFixed(2)}, ${pos.z.toFixed(2)}`;
        if (targetDisplay) targetDisplay.textContent = `${target.x.toFixed(2)}, ${target.y.toFixed(2)}, ${target.z.toFixed(2)}`;
    } else {
        if (savedInfo) savedInfo.style.display = 'none';
        if (hint) hint.style.display = '';
        if (clearBtn) clearBtn.style.display = 'none';
    }
}

/**
 * Collect all metadata from the panel
 */
export function collectMetadata(): CollectedMetadata {
    const tagsRaw = (document.getElementById('meta-tags') as HTMLInputElement)?.value?.trim() ?? '';
    const metadata: CollectedMetadata = {
        project: {
            title: (document.getElementById('meta-title') as HTMLInputElement)?.value || '',
            id: (document.getElementById('meta-id') as HTMLInputElement)?.value || '',
            description: (document.getElementById('meta-description') as HTMLTextAreaElement)?.value || '',
            license: (document.getElementById('meta-license') as HTMLSelectElement)?.value || 'CC0',
            tags: tagsRaw ? tagsRaw.split(',').map(t => t.trim()).filter(Boolean) : []
        },
        relationships: {
            partOf: (document.getElementById('meta-part-of') as HTMLInputElement)?.value || '',
            derivedFrom: (document.getElementById('meta-derived-from') as HTMLInputElement)?.value || '',
            replaces: (document.getElementById('meta-replaces') as HTMLInputElement)?.value || '',
            relatedObjects: []
        },
        provenance: {
            captureDate: (document.getElementById('meta-capture-date') as HTMLInputElement)?.value || '',
            captureDevice: (document.getElementById('meta-capture-device') as HTMLInputElement)?.value || '',
            deviceSerial: (document.getElementById('meta-device-serial') as HTMLInputElement)?.value || '',
            operator: (document.getElementById('meta-operator') as HTMLInputElement)?.value || '',
            operatorOrcid: (document.getElementById('meta-operator-orcid') as HTMLInputElement)?.value || '',
            location: (document.getElementById('meta-location') as HTMLInputElement)?.value || '',
            conventions: (document.getElementById('meta-conventions') as HTMLTextAreaElement)?.value || '',
            processingSoftware: [],
            processingNotes: (document.getElementById('meta-processing-notes') as HTMLTextAreaElement)?.value || ''
        },
        qualityMetrics: {
            tier: (document.getElementById('meta-quality-tier') as HTMLSelectElement)?.value || '',
            accuracyGrade: (document.getElementById('meta-quality-accuracy') as HTMLSelectElement)?.value || '',
            captureResolution: {
                value: parseFloat((document.getElementById('meta-quality-res-value') as HTMLInputElement)?.value) || null,
                unit: (document.getElementById('meta-quality-res-unit') as HTMLSelectElement)?.value || 'mm',
                type: (document.getElementById('meta-quality-res-type') as HTMLSelectElement)?.value || 'GSD'
            },
            alignmentError: {
                value: parseFloat((document.getElementById('meta-quality-align-value') as HTMLInputElement)?.value) || null,
                unit: (document.getElementById('meta-quality-align-unit') as HTMLSelectElement)?.value || 'mm',
                method: (document.getElementById('meta-quality-align-method') as HTMLSelectElement)?.value || 'RMSE'
            },
            scaleVerification: (document.getElementById('meta-quality-scale-verify') as HTMLTextAreaElement)?.value || '',
            dataQuality: {
                coverageGaps: (document.getElementById('meta-quality-coverage-gaps') as HTMLTextAreaElement)?.value || '',
                reconstructionAreas: (document.getElementById('meta-quality-reconstruction') as HTMLTextAreaElement)?.value || '',
                colorCalibration: (document.getElementById('meta-quality-color-calibration') as HTMLTextAreaElement)?.value || '',
                measurementUncertainty: (document.getElementById('meta-quality-uncertainty') as HTMLTextAreaElement)?.value || ''
            }
        },
        archivalRecord: {
            standard: (document.getElementById('meta-archival-standard') as HTMLInputElement)?.value || '',
            title: (document.getElementById('meta-archival-title') as HTMLInputElement)?.value || '',
            alternateTitles: ((document.getElementById('meta-archival-alt-titles') as HTMLInputElement)?.value || '')
                .split(',').map(t => t.trim()).filter(t => t),
            ids: {
                accessionNumber: (document.getElementById('meta-archival-accession') as HTMLInputElement)?.value || '',
                sirisId: (document.getElementById('meta-archival-siris') as HTMLInputElement)?.value || '',
                uri: (document.getElementById('meta-archival-uri') as HTMLInputElement)?.value || ''
            },
            creation: {
                creator: (document.getElementById('meta-archival-creator') as HTMLInputElement)?.value || '',
                dateCreated: (document.getElementById('meta-archival-date-created') as HTMLInputElement)?.value || '',
                period: (document.getElementById('meta-archival-period') as HTMLInputElement)?.value || '',
                culture: (document.getElementById('meta-archival-culture') as HTMLInputElement)?.value || ''
            },
            physicalDescription: {
                medium: (document.getElementById('meta-archival-medium') as HTMLInputElement)?.value || '',
                dimensions: {
                    height: (document.getElementById('meta-archival-dim-height') as HTMLInputElement)?.value || '',
                    width: (document.getElementById('meta-archival-dim-width') as HTMLInputElement)?.value || '',
                    depth: (document.getElementById('meta-archival-dim-depth') as HTMLInputElement)?.value || ''
                },
                condition: (document.getElementById('meta-archival-condition') as HTMLTextAreaElement)?.value || ''
            },
            provenance: (document.getElementById('meta-archival-provenance') as HTMLTextAreaElement)?.value || '',
            rights: {
                copyrightStatus: (document.getElementById('meta-archival-copyright') as HTMLSelectElement)?.value || '',
                creditLine: (document.getElementById('meta-archival-credit') as HTMLInputElement)?.value || ''
            },
            context: {
                description: (document.getElementById('meta-archival-context-desc') as HTMLTextAreaElement)?.value || '',
                locationHistory: (document.getElementById('meta-archival-location-history') as HTMLTextAreaElement)?.value || ''
            },
            coverage: {
                spatial: {
                    locationName: (document.getElementById('meta-coverage-location') as HTMLInputElement)?.value || '',
                    coordinates: [
                        parseFloat((document.getElementById('meta-coverage-lat') as HTMLInputElement)?.value) || null,
                        parseFloat((document.getElementById('meta-coverage-lon') as HTMLInputElement)?.value) || null
                    ]
                },
                temporal: {
                    subjectPeriod: (document.getElementById('meta-coverage-period') as HTMLInputElement)?.value || '',
                    subjectDateCirca: (document.getElementById('meta-coverage-circa') as HTMLInputElement)?.checked || false
                }
            }
        },
        materialStandard: {
            workflow: (document.getElementById('meta-material-workflow') as HTMLSelectElement)?.value || '',
            occlusionPacked: (document.getElementById('meta-material-occlusion-packed') as HTMLInputElement)?.checked || false,
            colorSpace: (document.getElementById('meta-material-colorspace') as HTMLSelectElement)?.value || '',
            normalSpace: (document.getElementById('meta-material-normalspace') as HTMLSelectElement)?.value || ''
        },
        preservation: {
            formatRegistry: {
                glb: (document.getElementById('meta-pres-format-glb') as HTMLInputElement)?.value || 'fmt/861',
                obj: (document.getElementById('meta-pres-format-obj') as HTMLInputElement)?.value || 'fmt/935',
                ply: (document.getElementById('meta-pres-format-ply') as HTMLInputElement)?.value || 'fmt/831',
                e57: (document.getElementById('meta-pres-format-e57') as HTMLInputElement)?.value || 'fmt/643'
            },
            significantProperties: [],
            renderingRequirements: (document.getElementById('meta-pres-render-req') as HTMLTextAreaElement)?.value || '',
            renderingNotes: (document.getElementById('meta-pres-render-notes') as HTMLTextAreaElement)?.value || ''
        },
        splatMetadata: {
            createdBy: (document.getElementById('meta-splat-created-by') as HTMLInputElement)?.value || '',
            version: (document.getElementById('meta-splat-version') as HTMLInputElement)?.value || '',
            sourceNotes: (document.getElementById('meta-splat-notes') as HTMLTextAreaElement)?.value || '',
            role: (document.getElementById('meta-splat-role') as HTMLSelectElement)?.value || ''
        },
        meshMetadata: {
            createdBy: (document.getElementById('meta-mesh-created-by') as HTMLInputElement)?.value || '',
            version: (document.getElementById('meta-mesh-version') as HTMLInputElement)?.value || '',
            sourceNotes: (document.getElementById('meta-mesh-notes') as HTMLTextAreaElement)?.value || '',
            role: (document.getElementById('meta-mesh-role') as HTMLSelectElement)?.value || ''
        },
        pointcloudMetadata: {
            createdBy: (document.getElementById('meta-pointcloud-created-by') as HTMLInputElement)?.value || '',
            version: (document.getElementById('meta-pointcloud-version') as HTMLInputElement)?.value || '',
            sourceNotes: (document.getElementById('meta-pointcloud-notes') as HTMLTextAreaElement)?.value || '',
            role: (document.getElementById('meta-pointcloud-role') as HTMLSelectElement)?.value || ''
        },
        customFields: {},
        versionHistory: [],
        includeIntegrity: (document.getElementById('meta-include-integrity') as HTMLInputElement)?.checked ?? true,
        viewerSettings: {
            singleSided: (document.getElementById('meta-viewer-single-sided') as HTMLInputElement)?.checked ?? true,
            backgroundColor: (document.getElementById('meta-viewer-bg-override') as HTMLInputElement)?.checked
                ? ((document.getElementById('meta-viewer-bg-color') as HTMLInputElement)?.value || '#1a1a2e')
                : null,
            displayMode: (document.getElementById('meta-viewer-display-mode') as HTMLSelectElement)?.value || '',
            cameraPosition: getCameraFromHiddenFields('pos'),
            cameraTarget: getCameraFromHiddenFields('target'),
            autoRotate: (document.getElementById('meta-viewer-auto-rotate') as HTMLInputElement)?.checked ?? false,
            annotationsVisible: (document.getElementById('meta-viewer-annotations-visible') as HTMLInputElement)?.checked ?? true,
        }
    };

    // Handle custom license
    if (metadata.project.license === 'custom') {
        metadata.project.license = (document.getElementById('meta-custom-license') as HTMLInputElement)?.value || 'Custom';
    }

    // Auto-generate ID from title if empty
    if (!metadata.project.id && metadata.project.title) {
        metadata.project.id = metadata.project.title
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/^-|-$/g, '');
    }

    // Collect related objects
    const relatedObjectRows = document.querySelectorAll('.related-object-row');
    relatedObjectRows.forEach(row => {
        const title = (row.querySelector('.related-object-title') as HTMLInputElement)?.value?.trim();
        const description = (row.querySelector('.related-object-desc') as HTMLInputElement)?.value?.trim();
        const url = (row.querySelector('.related-object-url') as HTMLInputElement)?.value?.trim();
        if (title || url) {
            metadata.relationships.relatedObjects.push({
                title: title || '',
                description: description || '',
                url: url || ''
            });
        }
    });

    // Collect processing software
    const softwareRows = document.querySelectorAll('.software-row');
    softwareRows.forEach(row => {
        const name = (row.querySelector('.software-name') as HTMLInputElement)?.value?.trim();
        const version = (row.querySelector('.software-version') as HTMLInputElement)?.value?.trim();
        const url = (row.querySelector('.software-url') as HTMLInputElement)?.value?.trim();
        if (name) {
            metadata.provenance.processingSoftware.push({
                name,
                version: version || '',
                url: url || ''
            });
        }
    });

    // Collect significant properties (checkboxes)
    const propCheckboxes = [
        { id: 'meta-pres-prop-geometry', value: 'geometry' },
        { id: 'meta-pres-prop-vertex-color', value: 'vertex_color' },
        { id: 'meta-pres-prop-uv', value: 'uv_mapping' },
        { id: 'meta-pres-prop-normals', value: 'normal_maps' },
        { id: 'meta-pres-prop-pbr', value: 'pbr_materials' },
        { id: 'meta-pres-prop-scale', value: 'real_world_scale' },
        { id: 'meta-pres-prop-splat', value: 'gaussian_splat_data' },
        { id: 'meta-pres-prop-pointcloud', value: 'e57_point_cloud_data' }
    ];
    propCheckboxes.forEach(({ id, value }) => {
        if ((document.getElementById(id) as HTMLInputElement)?.checked) {
            metadata.preservation.significantProperties.push(value);
        }
    });

    // Collect custom fields
    const customFieldRows = document.querySelectorAll('.custom-field-row');
    customFieldRows.forEach(row => {
        const key = (row.querySelector('.custom-field-key') as HTMLInputElement)?.value?.trim();
        const value = (row.querySelector('.custom-field-value') as HTMLInputElement)?.value?.trim();
        if (key && value) {
            metadata.customFields[key] = value;
        }
    });

    // Collect version history entries
    const versionRows = document.querySelectorAll('.version-history-row');
    versionRows.forEach(row => {
        const version = (row.querySelector('.version-entry-version') as HTMLInputElement)?.value?.trim();
        const description = (row.querySelector('.version-entry-description') as HTMLTextAreaElement)?.value?.trim();
        if (version || description) {
            metadata.versionHistory.push({
                version: version || '',
                date: new Date().toISOString().split('T')[0],
                description: description || ''
            });
        }
    });

    return metadata;
}

// =============================================================================
// METADATA PREFILL FROM ARCHIVE
// =============================================================================

/**
 * Prefill metadata panel from archive manifest
 */
export function prefillMetadataFromArchive(manifest: any): void {
    if (!manifest) return;

    // Project info
    if (manifest.project) {
        const titleEl = document.getElementById('meta-title') as HTMLInputElement | null;
        if (titleEl && manifest.project.title) titleEl.value = manifest.project.title;

        const idEl = document.getElementById('meta-id') as HTMLInputElement | null;
        if (idEl && manifest.project.id) idEl.value = manifest.project.id;

        const descEl = document.getElementById('meta-description') as HTMLTextAreaElement | null;
        if (descEl && manifest.project.description) descEl.value = manifest.project.description;

        const tagsEl = document.getElementById('meta-tags') as HTMLInputElement | null;
        if (tagsEl) tagsEl.value = (manifest.project?.tags ?? []).join(', ');

        if (manifest.project.license) {
            const licenseSelect = document.getElementById('meta-license') as HTMLSelectElement | null;
            const standardLicenses = ['CC0', 'CC-BY 4.0', 'CC-BY-SA 4.0', 'CC-BY-NC 4.0', 'MIT', 'All Rights Reserved'];
            if (licenseSelect) {
                if (standardLicenses.includes(manifest.project.license)) {
                    licenseSelect.value = manifest.project.license;
                } else {
                    licenseSelect.value = 'custom';
                    const customField = document.getElementById('custom-license-field');
                    if (customField) customField.classList.remove('hidden');
                    const customLicenseEl = document.getElementById('meta-custom-license') as HTMLInputElement | null;
                    if (customLicenseEl) customLicenseEl.value = manifest.project.license;
                }
            }
        }
    }

    // Relationships
    if (manifest.relationships) {
        const relFields: Record<string, any> = {
            'meta-part-of': manifest.relationships.part_of,
            'meta-derived-from': manifest.relationships.derived_from,
            'meta-replaces': manifest.relationships.replaces
        };
        for (const [id, value] of Object.entries(relFields)) {
            const el = document.getElementById(id) as HTMLInputElement | null;
            if (el && value) el.value = value;
        }

        // Related objects
        if (manifest.relationships.related_objects?.length) {
            const container = document.getElementById('related-objects-list');
            if (container) {
                container.replaceChildren();
                for (const obj of manifest.relationships.related_objects) {
                    addRelatedObject();
                    const rows = container.querySelectorAll('.related-object-row');
                    const lastRow = rows[rows.length - 1];
                    const titleInput = lastRow.querySelector('.related-object-title') as HTMLInputElement | null;
                    const descInput = lastRow.querySelector('.related-object-desc') as HTMLInputElement | null;
                    const urlInput = lastRow.querySelector('.related-object-url') as HTMLInputElement | null;
                    if (titleInput) titleInput.value = obj.title || '';
                    if (descInput) descInput.value = obj.description || '';
                    if (urlInput) urlInput.value = obj.url || '';
                }
            }
        }
    }

    // Provenance
    if (manifest.provenance) {
        const fields: Record<string, any> = {
            'meta-capture-date': manifest.provenance.capture_date,
            'meta-capture-device': manifest.provenance.capture_device,
            'meta-device-serial': manifest.provenance.device_serial,
            'meta-operator': manifest.provenance.operator,
            'meta-operator-orcid': manifest.provenance.operator_orcid,
            'meta-location': manifest.provenance.location,
            'meta-processing-notes': manifest.provenance.processing_notes
        };

        for (const [id, value] of Object.entries(fields)) {
            const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
            if (el && value) el.value = value;
        }

        if (manifest.provenance.convention_hints) {
            const conventionsEl = document.getElementById('meta-conventions') as HTMLTextAreaElement | null;
            if (conventionsEl) {
                const hints = Array.isArray(manifest.provenance.convention_hints)
                    ? manifest.provenance.convention_hints.join(', ')
                    : manifest.provenance.convention_hints;
                conventionsEl.value = hints;
            }
        }

        // Processing software
        if (manifest.provenance.processing_software?.length) {
            const container = document.getElementById('processing-software-list');
            if (container) {
                container.replaceChildren();
                for (const sw of manifest.provenance.processing_software) {
                    addProcessingSoftware();
                    const rows = container.querySelectorAll('.software-row');
                    const lastRow = rows[rows.length - 1];
                    const nameInput = lastRow.querySelector('.software-name') as HTMLInputElement | null;
                    const versionInput = lastRow.querySelector('.software-version') as HTMLInputElement | null;
                    const urlInput = lastRow.querySelector('.software-url') as HTMLInputElement | null;
                    if (nameInput) nameInput.value = sw.name || '';
                    if (versionInput) versionInput.value = sw.version || '';
                    if (urlInput) urlInput.value = sw.url || '';
                }
            }
        }
    }

    // Quality Metrics
    if (manifest.quality_metrics) {
        const qm = manifest.quality_metrics;

        const tierEl = document.getElementById('meta-quality-tier') as HTMLSelectElement | null;
        if (tierEl && qm.tier) tierEl.value = qm.tier;

        const accuracyEl = document.getElementById('meta-quality-accuracy') as HTMLSelectElement | null;
        if (accuracyEl && qm.accuracy_grade) accuracyEl.value = qm.accuracy_grade;

        // Capture Resolution
        if (qm.capture_resolution) {
            const resValueEl = document.getElementById('meta-quality-res-value') as HTMLInputElement | null;
            if (resValueEl && qm.capture_resolution.value != null) resValueEl.value = qm.capture_resolution.value;

            const resUnitEl = document.getElementById('meta-quality-res-unit') as HTMLSelectElement | null;
            if (resUnitEl && qm.capture_resolution.unit) resUnitEl.value = qm.capture_resolution.unit;

            const resTypeEl = document.getElementById('meta-quality-res-type') as HTMLSelectElement | null;
            if (resTypeEl && qm.capture_resolution.type) resTypeEl.value = qm.capture_resolution.type;
        }

        // Alignment Error
        if (qm.alignment_error) {
            const alignValueEl = document.getElementById('meta-quality-align-value') as HTMLInputElement | null;
            if (alignValueEl && qm.alignment_error.value != null) alignValueEl.value = qm.alignment_error.value;

            const alignUnitEl = document.getElementById('meta-quality-align-unit') as HTMLSelectElement | null;
            if (alignUnitEl && qm.alignment_error.unit) alignUnitEl.value = qm.alignment_error.unit;

            const alignMethodEl = document.getElementById('meta-quality-align-method') as HTMLSelectElement | null;
            if (alignMethodEl && qm.alignment_error.method) alignMethodEl.value = qm.alignment_error.method;
        }

        const scaleVerifyEl = document.getElementById('meta-quality-scale-verify') as HTMLTextAreaElement | null;
        if (scaleVerifyEl && qm.scale_verification) scaleVerifyEl.value = qm.scale_verification;

        // Data Quality
        if (qm.data_quality) {
            const dqFields: Record<string, any> = {
                'meta-quality-coverage-gaps': qm.data_quality.coverage_gaps,
                'meta-quality-reconstruction': qm.data_quality.reconstruction_areas,
                'meta-quality-color-calibration': qm.data_quality.color_calibration,
                'meta-quality-uncertainty': qm.data_quality.measurement_uncertainty
            };
            for (const [id, value] of Object.entries(dqFields)) {
                const el = document.getElementById(id) as HTMLTextAreaElement | null;
                if (el && value) el.value = value;
            }
        }
    }

    // Archival Record (Dublin Core)
    if (manifest.archival_record) {
        const ar = manifest.archival_record;

        const archivalFields: Record<string, any> = {
            'meta-archival-standard': ar.standard,
            'meta-archival-title': ar.title,
            'meta-archival-condition': ar.physical_description?.condition,
            'meta-archival-medium': ar.physical_description?.medium,
            'meta-archival-dim-height': ar.physical_description?.dimensions?.height,
            'meta-archival-dim-width': ar.physical_description?.dimensions?.width,
            'meta-archival-dim-depth': ar.physical_description?.dimensions?.depth,
            'meta-archival-accession': ar.ids?.accession_number,
            'meta-archival-siris': ar.ids?.siris_id,
            'meta-archival-uri': ar.ids?.uri,
            'meta-archival-creator': ar.creation?.creator,
            'meta-archival-date-created': ar.creation?.date_created,
            'meta-archival-period': ar.creation?.period,
            'meta-archival-culture': ar.creation?.culture,
            'meta-archival-credit': ar.rights?.credit_line,
            'meta-archival-location-history': ar.context?.location_history
        };

        for (const [id, value] of Object.entries(archivalFields)) {
            const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | null;
            if (el && value) el.value = value;
        }

        // Alternate titles (array to comma-separated)
        if (ar.alternate_titles) {
            const altTitlesEl = document.getElementById('meta-archival-alt-titles') as HTMLInputElement | null;
            if (altTitlesEl) {
                const titles = Array.isArray(ar.alternate_titles)
                    ? ar.alternate_titles.join(', ')
                    : ar.alternate_titles;
                altTitlesEl.value = titles;
            }
        }

        // Textareas
        const provenanceEl = document.getElementById('meta-archival-provenance') as HTMLTextAreaElement | null;
        if (provenanceEl && ar.provenance) provenanceEl.value = ar.provenance;

        const contextDescEl = document.getElementById('meta-archival-context-desc') as HTMLTextAreaElement | null;
        if (contextDescEl && ar.context?.description) contextDescEl.value = ar.context.description;

        // Copyright status (select)
        const copyrightEl = document.getElementById('meta-archival-copyright') as HTMLSelectElement | null;
        if (copyrightEl && ar.rights?.copyright_status) copyrightEl.value = ar.rights.copyright_status;

        // Coverage
        if (ar.coverage) {
            if (ar.coverage.spatial) {
                const locNameEl = document.getElementById('meta-coverage-location') as HTMLInputElement | null;
                if (locNameEl && ar.coverage.spatial.location_name) locNameEl.value = ar.coverage.spatial.location_name;

                if (ar.coverage.spatial.coordinates) {
                    // Legacy compat: convert {latitude, longitude} object to [lat, lon] tuple
                    let coords: [number | null, number | null] | any = ar.coverage.spatial.coordinates;
                    if (!Array.isArray(coords) && typeof coords === 'object' && coords !== null) {
                        coords = [
                            coords.latitude != null ? parseFloat(String(coords.latitude)) || null : null,
                            coords.longitude != null ? parseFloat(String(coords.longitude)) || null : null
                        ];
                    }
                    if (Array.isArray(coords) && coords.length >= 2) {
                        const latEl = document.getElementById('meta-coverage-lat') as HTMLInputElement | null;
                        const lonEl = document.getElementById('meta-coverage-lon') as HTMLInputElement | null;
                        if (latEl && coords[0] != null) latEl.value = String(coords[0]);
                        if (lonEl && coords[1] != null) lonEl.value = String(coords[1]);
                    }
                }
            }
            if (ar.coverage.temporal) {
                const periodEl = document.getElementById('meta-coverage-period') as HTMLInputElement | null;
                if (periodEl && ar.coverage.temporal.subject_period) periodEl.value = ar.coverage.temporal.subject_period;

                const circaEl = document.getElementById('meta-coverage-circa') as HTMLInputElement | null;
                if (circaEl) circaEl.checked = ar.coverage.temporal.subject_date_circa || false;
            }
        }
    }

    // Material Standard
    if (manifest.material_standard) {
        const ms = manifest.material_standard;

        const workflowEl = document.getElementById('meta-material-workflow') as HTMLSelectElement | null;
        if (workflowEl && ms.workflow) workflowEl.value = ms.workflow;

        const occlusionEl = document.getElementById('meta-material-occlusion-packed') as HTMLInputElement | null;
        if (occlusionEl) occlusionEl.checked = ms.occlusion_packed || false;

        const colorSpaceEl = document.getElementById('meta-material-colorspace') as HTMLSelectElement | null;
        if (colorSpaceEl && ms.color_space) colorSpaceEl.value = ms.color_space;

        const normalSpaceEl = document.getElementById('meta-material-normalspace') as HTMLSelectElement | null;
        if (normalSpaceEl && ms.normal_space) normalSpaceEl.value = ms.normal_space;
    }

    // Preservation
    if (manifest.preservation) {
        const pres = manifest.preservation;

        if (pres.format_registry) {
            const formatFields: Record<string, any> = {
                'meta-pres-format-glb': pres.format_registry.glb,
                'meta-pres-format-obj': pres.format_registry.obj,
                'meta-pres-format-ply': pres.format_registry.ply,
                'meta-pres-format-e57': pres.format_registry.e57
            };
            for (const [id, value] of Object.entries(formatFields)) {
                const el = document.getElementById(id) as HTMLInputElement | null;
                if (el && value) el.value = value;
            }
        }

        // Significant properties (checkboxes)
        if (pres.significant_properties?.length) {
            const propMap: Record<string, string> = {
                'geometry': 'meta-pres-prop-geometry',
                'vertex_color': 'meta-pres-prop-vertex-color',
                'uv_mapping': 'meta-pres-prop-uv',
                'normal_maps': 'meta-pres-prop-normals',
                'pbr_materials': 'meta-pres-prop-pbr',
                'real_world_scale': 'meta-pres-prop-scale',
                'gaussian_splat_data': 'meta-pres-prop-splat',
                'e57_point_cloud_data': 'meta-pres-prop-pointcloud'
            };
            // First uncheck all
            for (const id of Object.values(propMap)) {
                const el = document.getElementById(id) as HTMLInputElement | null;
                if (el) el.checked = false;
            }
            // Then check the ones in the manifest
            for (const prop of pres.significant_properties) {
                const id = propMap[prop];
                if (id) {
                    const el = document.getElementById(id) as HTMLInputElement | null;
                    if (el) el.checked = true;
                }
            }
        }

        const renderReqEl = document.getElementById('meta-pres-render-req') as HTMLTextAreaElement | null;
        if (renderReqEl && pres.rendering_requirements) renderReqEl.value = pres.rendering_requirements;

        const renderNotesEl = document.getElementById('meta-pres-render-notes') as HTMLTextAreaElement | null;
        if (renderNotesEl && pres.rendering_notes) renderNotesEl.value = pres.rendering_notes;
    }

    // Asset metadata from data_entries
    if (manifest.data_entries) {
        // Find scene entry
        const sceneKey = Object.keys(manifest.data_entries).find(k => k.startsWith('scene_'));
        if (sceneKey) {
            const scene = manifest.data_entries[sceneKey];
            const splatFields: Record<string, any> = {
                'meta-splat-created-by': scene.created_by,
                'meta-splat-version': scene._created_by_version,
                'meta-splat-notes': scene._source_notes,
                'meta-splat-role': scene.role
            };
            for (const [id, value] of Object.entries(splatFields)) {
                const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
                if (el && value) el.value = value;
            }
        }

        // Find mesh entry
        const meshKey = Object.keys(manifest.data_entries).find(k => k.startsWith('mesh_'));
        if (meshKey) {
            const mesh = manifest.data_entries[meshKey];
            const meshFields: Record<string, any> = {
                'meta-mesh-created-by': mesh.created_by,
                'meta-mesh-version': mesh._created_by_version,
                'meta-mesh-notes': mesh._source_notes,
                'meta-mesh-role': mesh.role
            };
            for (const [id, value] of Object.entries(meshFields)) {
                const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
                if (el && value) el.value = value;
            }
        }

        // Find pointcloud entry
        const pcKey = Object.keys(manifest.data_entries).find(k => k.startsWith('pointcloud_'));
        if (pcKey) {
            const pc = manifest.data_entries[pcKey];
            const pcFields: Record<string, any> = {
                'meta-pointcloud-created-by': pc.created_by,
                'meta-pointcloud-version': pc._created_by_version,
                'meta-pointcloud-notes': pc._source_notes,
                'meta-pointcloud-role': pc.role
            };
            for (const [id, value] of Object.entries(pcFields)) {
                const el = document.getElementById(id) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null;
                if (el && value) el.value = value;
            }
        }
    }

    // Viewer settings
    if (manifest.viewer_settings) {
        const singleSidedEl = document.getElementById('meta-viewer-single-sided') as HTMLInputElement | null;
        if (singleSidedEl) singleSidedEl.checked = manifest.viewer_settings.single_sided ?? true;

        const bgOverrideEl = document.getElementById('meta-viewer-bg-override') as HTMLInputElement | null;
        const bgColorEl = document.getElementById('meta-viewer-bg-color') as HTMLInputElement | null;
        const bgColorRow = document.getElementById('meta-viewer-bg-color-row');
        const hasBgColor = !!manifest.viewer_settings.background_color;
        if (bgOverrideEl) {
            bgOverrideEl.checked = hasBgColor;
        }
        if (bgColorRow) {
            bgColorRow.style.display = hasBgColor ? '' : 'none';
        }
        if (bgColorEl && hasBgColor) {
            bgColorEl.value = manifest.viewer_settings.background_color;
            const hexLabel = document.getElementById('meta-viewer-bg-color-hex');
            if (hexLabel) hexLabel.textContent = manifest.viewer_settings.background_color;
        }

        // Display mode
        const displayModeEl = document.getElementById('meta-viewer-display-mode') as HTMLSelectElement | null;
        if (displayModeEl && manifest.viewer_settings.display_mode) {
            displayModeEl.value = manifest.viewer_settings.display_mode;
        }

        // Camera position
        if (manifest.viewer_settings.camera_position) {
            const cp = manifest.viewer_settings.camera_position;
            setCameraHiddenFields('pos', cp);
        }
        if (manifest.viewer_settings.camera_target) {
            const ct = manifest.viewer_settings.camera_target;
            setCameraHiddenFields('target', ct);
        }
        updateCameraSaveDisplay();

        // Auto-rotate
        const autoRotateEl = document.getElementById('meta-viewer-auto-rotate') as HTMLInputElement | null;
        if (autoRotateEl) autoRotateEl.checked = manifest.viewer_settings.auto_rotate ?? false;

        // Annotations visible
        const annoVisEl = document.getElementById('meta-viewer-annotations-visible') as HTMLInputElement | null;
        if (annoVisEl) annoVisEl.checked = manifest.viewer_settings.annotations_visible ?? true;
    }

    // Custom fields from _meta
    if (manifest._meta?.custom_fields) {
        const container = document.getElementById('custom-fields-list');
        if (container) {
            container.replaceChildren(); // Clear safely
            for (const [key, value] of Object.entries(manifest._meta.custom_fields)) {
                addCustomField();
                const rows = container.querySelectorAll('.custom-field-row');
                const lastRow = rows[rows.length - 1];
                const keyInput = lastRow.querySelector('.custom-field-key') as HTMLInputElement | null;
                const valueInput = lastRow.querySelector('.custom-field-value') as HTMLInputElement | null;
                if (keyInput) keyInput.value = key;
                if (valueInput) valueInput.value = value as string;
            }
        }
    }

    // Version history
    if (manifest.version_history?.length) {
        const container = document.getElementById('version-history-list');
        if (container) {
            container.replaceChildren();
            for (const entry of manifest.version_history) {
                addVersionEntry();
                const rows = container.querySelectorAll('.version-history-row');
                const lastRow = rows[rows.length - 1];
                if (lastRow) {
                    const versionInput = lastRow.querySelector('.version-entry-version') as HTMLInputElement | null;
                    const descInput = lastRow.querySelector('.version-entry-description') as HTMLTextAreaElement | null;
                    if (versionInput) versionInput.value = entry.version || '';
                    if (descInput) descInput.value = entry.description || '';
                }
            }
        }
    }

    // Restore metadata profile if present in manifest
    if (manifest.metadata_profile && ['basic', 'standard', 'archival'].includes(manifest.metadata_profile)) {
        setActiveProfile(manifest.metadata_profile as MetadataProfile);
    }
}

// =============================================================================
// MUSEUM-STYLE METADATA DISPLAY
// =============================================================================

/**
 * Populate the museum-style metadata display
 */
export function populateMetadataDisplay(deps: MetadataDeps = {}): void {
    const { state = {} as AppState, annotationSystem, imageAssets } = deps;
    const metadata = collectMetadata();

    let hasDetails = false;
    let hasStats = false;

    // Title - always show
    const titleEl = document.getElementById('display-title');
    if (titleEl) {
        titleEl.textContent = metadata.project.title || 'Untitled';
    }

    // Description - hide if empty, render as markdown
    const descEl = document.getElementById('display-description');
    if (descEl) {
        if (metadata.project.description) {
            descEl.innerHTML = parseMarkdown(resolveAssetRefs(metadata.project.description, imageAssets));
            descEl.style.display = '';
        } else {
            descEl.style.display = 'none';
        }
    }

    // Tags - render as chips below description
    const tagsDisplayEl = document.getElementById('display-tags');
    if (tagsDisplayEl) {
        const tags = metadata.project?.tags ?? [];
        if (tags.length > 0) {
            tagsDisplayEl.innerHTML = tags
                .map(t => `<span class="tag-chip">${t.replace(/</g, '&lt;')}</span>`)
                .join('');
            tagsDisplayEl.style.display = '';
        } else {
            tagsDisplayEl.style.display = 'none';
        }
    }

    // Creator/Operator
    const creatorRow = document.getElementById('display-creator-row');
    const creatorEl = document.getElementById('display-creator');
    if (creatorRow && creatorEl) {
        if (metadata.provenance.operator) {
            creatorEl.textContent = metadata.provenance.operator;
            creatorRow.style.display = '';
            hasDetails = true;
        } else {
            creatorRow.style.display = 'none';
        }
    }

    // Capture Date
    const dateRow = document.getElementById('display-date-row');
    const dateEl = document.getElementById('display-date');
    if (dateRow && dateEl) {
        if (metadata.provenance.captureDate) {
            const date = new Date(metadata.provenance.captureDate);
            dateEl.textContent = date.toLocaleDateString('en-US', {
                year: 'numeric', month: 'long', day: 'numeric'
            });
            dateRow.style.display = '';
            hasDetails = true;
        } else {
            dateRow.style.display = 'none';
        }
    }

    // Location
    const locationRow = document.getElementById('display-location-row');
    const locationEl = document.getElementById('display-location');
    if (locationRow && locationEl) {
        if (metadata.provenance.location) {
            locationEl.textContent = metadata.provenance.location;
            locationRow.style.display = '';
            hasDetails = true;
        } else {
            locationRow.style.display = 'none';
        }
    }

    // Device
    const deviceRow = document.getElementById('display-device-row');
    const deviceEl = document.getElementById('display-device');
    if (deviceRow && deviceEl) {
        if (metadata.provenance.captureDevice) {
            deviceEl.textContent = metadata.provenance.captureDevice;
            deviceRow.style.display = '';
            hasDetails = true;
        } else {
            deviceRow.style.display = 'none';
        }
    }

    // Hide the details section and divider if no details
    const detailsSection = document.querySelector('#sidebar-view .display-details') as HTMLElement | null;
    const divider = document.querySelector('#sidebar-view .display-divider') as HTMLElement | null;
    if (detailsSection) detailsSection.style.display = hasDetails ? '' : 'none';
    if (divider) divider.style.display = hasDetails ? '' : 'none';

    // License - hide if not set
    const licenseRow = document.getElementById('display-license-row');
    const licenseEl = document.getElementById('display-license');
    if (licenseRow && licenseEl) {
        const license = metadata.project.license;
        if (license && license !== 'custom' && license !== 'CC0') {
            licenseEl.textContent = license;
            licenseRow.style.display = '';
        } else if (license === 'custom') {
            const customLicense = (document.getElementById('meta-custom-license') as HTMLInputElement)?.value;
            if (customLicense) {
                licenseEl.textContent = customLicense;
                licenseRow.style.display = '';
            } else {
                licenseRow.style.display = 'none';
            }
        } else {
            licenseRow.style.display = 'none';
        }
    }

    // Stats - Splat count
    const splatStat = document.getElementById('display-splat-stat');
    const splatCountEl = document.getElementById('display-splat-count');
    if (splatStat && splatCountEl) {
        if (state.splatLoaded) {
            const count = document.getElementById('splat-vertices')?.textContent || '-';
            splatCountEl.textContent = count;
            splatStat.style.display = '';
            hasStats = true;
        } else {
            splatStat.style.display = 'none';
        }
    }

    // Stats - Mesh polygons
    const meshStat = document.getElementById('display-mesh-stat');
    const meshCountEl = document.getElementById('display-mesh-count');
    if (meshStat && meshCountEl) {
        if (state.modelLoaded) {
            const count = document.getElementById('model-faces')?.textContent || '-';
            meshCountEl.textContent = count;
            meshStat.style.display = '';
            hasStats = true;
        } else {
            meshStat.style.display = 'none';
        }
    }

    // Stats - Point cloud count
    const pcStat = document.getElementById('display-pointcloud-stat');
    const pcCountEl = document.getElementById('display-pointcloud-count');
    if (pcStat && pcCountEl) {
        if (state.pointcloudLoaded) {
            const count = document.getElementById('pointcloud-points')?.textContent || '-';
            pcCountEl.textContent = count;
            pcStat.style.display = '';
            hasStats = true;
        } else {
            pcStat.style.display = 'none';
        }
    }

    // Stats - Annotation count
    const annoStat = document.getElementById('display-anno-stat');
    const annoCountEl = document.getElementById('display-anno-count');
    if (annoStat && annoCountEl && annotationSystem) {
        const count = annotationSystem.getCount();
        if (count > 0) {
            annoCountEl.textContent = count.toString();
            annoStat.style.display = '';
            hasStats = true;
        } else {
            annoStat.style.display = 'none';
        }
    }

    // Hide the stats section if nothing to show
    const statsSection = document.getElementById('display-stats');
    if (statsSection) {
        statsSection.style.display = hasStats ? '' : 'none';
    }
}

// =============================================================================
// ARCHIVE METADATA UI
// =============================================================================

/**
 * Update archive metadata UI from manifest
 */
export function updateArchiveMetadataUI(manifest: any, archiveLoader: any): void {
    if (!manifest) return;

    // Update container info
    const versionEl = document.getElementById('archive-container-version');
    if (versionEl) versionEl.textContent = manifest.container_version || '-';

    const packerEl = document.getElementById('archive-packer');
    if (packerEl) {
        const packer = manifest.packer || 'Unknown';
        const version = manifest.packer_version ? ` v${manifest.packer_version}` : '';
        packerEl.textContent = packer + version;
    }

    const createdEl = document.getElementById('archive-created');
    if (createdEl) {
        const date = manifest._creation_date || manifest.created_at;
        if (date) {
            createdEl.textContent = new Date(date).toLocaleString();
        } else {
            createdEl.textContent = '-';
        }
    }

    // Update entries list
    const entriesContainer = document.getElementById('archive-entries-list');
    if (entriesContainer && archiveLoader) {
        entriesContainer.replaceChildren(); // Clear safely
        const entries = archiveLoader.getEntryList();
        entries.forEach((entry: any) => {
            const div = document.createElement('div');
            div.className = 'archive-entry';

            const nameSpan = document.createElement('span');
            nameSpan.className = 'entry-name';
            nameSpan.textContent = entry.key;

            const fileSpan = document.createElement('span');
            fileSpan.className = 'entry-file';
            fileSpan.textContent = entry.fileName;

            div.appendChild(nameSpan);
            div.appendChild(fileSpan);
            entriesContainer.appendChild(div);
        });
    }
}

/**
 * Clear archive metadata from UI
 */
export function clearArchiveMetadata(): void {
    const elements: Record<string, string> = {
        'archive-container-version': '-',
        'archive-packer': '-',
        'archive-created': '-',
        'archive-filename': 'No archive loaded'
    };

    for (const [id, text] of Object.entries(elements)) {
        const el = document.getElementById(id);
        if (el) el.textContent = text;
    }

    const entriesContainer = document.getElementById('archive-entries-list');
    if (entriesContainer) entriesContainer.replaceChildren();
}

// =============================================================================
// ANNOTATION POPUP
// =============================================================================

/**
 * Show annotation popup near the selected marker
 */
export function showAnnotationPopup(annotation: Annotation, imageAssets?: Map<string, any>): string | null {
    const popup = document.getElementById('annotation-info-popup');
    if (!popup) return null;

    const marker = document.querySelector(`.annotation-marker[data-annotation-id="${annotation.id}"]`);
    if (!marker) return null;

    // Get annotation number from marker
    const number = marker.textContent;

    // Populate popup
    const numberEl = popup.querySelector('.annotation-info-number');
    const titleEl = popup.querySelector('.annotation-info-title');
    const bodyEl = popup.querySelector('.annotation-info-body');

    if (numberEl) numberEl.textContent = number;
    if (titleEl) titleEl.textContent = annotation.title || 'Untitled';
    if (bodyEl) bodyEl.innerHTML = parseMarkdown(resolveAssetRefs(annotation.body || '', imageAssets));

    popup.classList.remove('hidden');

    return annotation.id;
}

/**
 * Update annotation popup position to follow the marker
 */
export function updateAnnotationPopupPosition(currentPopupAnnotationId: string | null): void {
    if (!currentPopupAnnotationId) return;

    // On mobile kiosk, popup is hidden — annotation content shown in bottom sheet
    if (window.innerWidth <= 768 && document.body.classList.contains('kiosk-mode')) return;

    const popup = document.getElementById('annotation-info-popup');
    if (!popup || popup.classList.contains('hidden')) return;

    const marker = document.querySelector(`.annotation-marker[data-annotation-id="${currentPopupAnnotationId}"]`) as HTMLElement | null;
    if (!marker) return;

    // Hide popup if marker is hidden (behind camera)
    if (marker.style.display === 'none') {
        popup.style.visibility = 'hidden';
        return;
    }
    popup.style.visibility = 'visible';

    const markerRect = marker.getBoundingClientRect();
    const popupWidth = popup.getBoundingClientRect().width || 320;
    const popupHeight = popup.getBoundingClientRect().height || 200;
    const edgeMargin = 40;
    const padding = 15;
    const markerCenterX = markerRect.left + markerRect.width / 2;

    // Use the viewer container to determine the visible midpoint
    const viewer = document.getElementById('viewer-container');
    const viewerRect = viewer ? viewer.getBoundingClientRect() : { left: 0, right: window.innerWidth };
    const viewerMidX = (viewerRect.left + viewerRect.right) / 2;

    // Snap popup toward the nearest horizontal edge of the viewer
    let left: number;
    if (markerCenterX < viewerMidX) {
        // Marker on left half → popup to the left edge
        left = viewerRect.left + edgeMargin;
    } else {
        // Marker on right half → popup to the right edge
        left = viewerRect.right - popupWidth - edgeMargin;
    }

    // Vertical: align with marker center, clamped to viewport
    // In editorial mode, avoid title zone (top) and bottom ribbon
    const isEditorial = document.body.classList.contains('kiosk-editorial');
    const topZone = isEditorial ? 95 : padding;
    const bottomZone = isEditorial ? 48 : padding;

    let top = markerRect.top + markerRect.height / 2 - popupHeight / 2;
    if (top < topZone) top = topZone;
    if (top + popupHeight > window.innerHeight - bottomZone) {
        top = window.innerHeight - popupHeight - bottomZone;
    }

    popup.style.left = left + 'px';
    popup.style.top = top + 'px';
}

/**
 * Hide annotation popup
 */
export function hideAnnotationPopup(): void {
    const popup = document.getElementById('annotation-info-popup');
    if (popup) popup.classList.add('hidden');
}
