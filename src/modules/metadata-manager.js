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

const log = Logger.getLogger('metadata-manager');

// =============================================================================
// METADATA SIDEBAR
// =============================================================================

/**
 * Show metadata sidebar in specified mode
 * @param {string} mode - 'view', 'edit', or 'annotations'
 * @param {Object} deps - Dependencies (state, annotationSystem)
 */
export function showMetadataSidebar(mode = 'view', deps = {}) {
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
export function hideMetadataSidebar() {
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
 * @param {string} mode - Mode to switch to
 * @param {Object} deps - Dependencies
 */
export function switchSidebarMode(mode, deps = {}) {
    // Update tab buttons
    const tabs = document.querySelectorAll('.sidebar-mode-tab');
    tabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.mode === mode);
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
    } else if (mode === 'annotations' && deps.updateAnnotationsList) {
        deps.updateAnnotationsList();
    }
}

/**
 * Switch edit sub-tab
 * @param {string} tabName - Tab name
 */
export function switchEditTab(tabName) {
    // Update tab buttons
    const tabs = document.querySelectorAll('.edit-tab');
    tabs.forEach(tab => {
        tab.classList.toggle('active', tab.dataset.tab === tabName);
    });

    // Update content sections
    const contents = document.querySelectorAll('.edit-tab-content');
    contents.forEach(content => {
        content.classList.toggle('active', content.id === `edit-tab-${tabName}`);
    });
}

/**
 * Toggle metadata display visibility
 * @param {Object} deps - Dependencies
 */
export function toggleMetadataDisplay(deps = {}) {
    const sidebar = document.getElementById('metadata-sidebar');
    if (!sidebar) return;

    if (sidebar.classList.contains('hidden')) {
        showMetadataSidebar('view', deps);
    } else {
        hideMetadataSidebar();
    }
}

// Legacy function names for compatibility
export function showMetadataPanel(deps = {}) {
    showMetadataSidebar('edit', deps);
}

export function hideMetadataPanel() {
    hideMetadataSidebar();
}

// =============================================================================
// METADATA TABS SETUP
// =============================================================================

/**
 * Setup metadata tab switching (legacy)
 */
export function setupMetadataTabs() {
    const tabs = document.querySelectorAll('.metadata-tab');
    tabs.forEach(tab => {
        tab.addEventListener('click', () => {
            // Update active tab
            tabs.forEach(t => t.classList.remove('active'));
            tab.classList.add('active');

            // Update active content
            const tabContents = document.querySelectorAll('.metadata-tab-content');
            tabContents.forEach(content => content.classList.remove('active'));

            const tabId = tab.dataset.tab;
            const targetContent = document.getElementById(`tab-${tabId}`);
            if (targetContent) {
                targetContent.classList.add('active');
            }
        });
    });
}

/**
 * Setup metadata sidebar event handlers
 * @param {Object} deps - Dependencies (callbacks for annotations, etc.)
 */
export function setupMetadataSidebar(deps = {}) {
    // Mode tabs (View/Edit/Annotations)
    const modeTabs = document.querySelectorAll('.sidebar-mode-tab');
    modeTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const mode = tab.dataset.mode;
            switchSidebarMode(mode, deps);
        });
    });

    // Edit sub-tabs
    const editTabs = document.querySelectorAll('.edit-tab');
    editTabs.forEach(tab => {
        tab.addEventListener('click', () => {
            const tabName = tab.dataset.tab;
            switchEditTab(tabName);
        });
    });

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
            deps.onAddAnnotation();
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
    const annoTitleInput = document.getElementById('sidebar-edit-anno-title');
    const annoBodyInput = document.getElementById('sidebar-edit-anno-body');

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
    const imageInput = document.getElementById('image-insert-input');
    let activeTextarea = null;

    function insertAtCursor(textarea, text) {
        const start = textarea.selectionStart;
        const end = textarea.selectionEnd;
        const before = textarea.value.substring(0, start);
        const after = textarea.value.substring(end);
        textarea.value = before + text + after;
        textarea.selectionStart = textarea.selectionEnd = start + text.length;
        textarea.dispatchEvent(new Event('input', { bubbles: true }));
        textarea.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function sanitizeFileName(name) {
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
                    activeTextarea = document.getElementById(textareaId);
                    imageInput.value = '';
                    imageInput.click();
                });
            }
        });

        // Handle file selection
        imageInput.addEventListener('change', () => {
            const file = imageInput.files[0];
            if (!file || !activeTextarea) return;

            const ext = file.name.split('.').pop().toLowerCase();
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
}

/**
 * Setup license dropdown custom field toggle
 */
export function setupLicenseField() {
    const licenseSelect = document.getElementById('meta-license');
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
 * @param {number} bytes - Size in bytes
 * @returns {string} Formatted size
 */
export function formatFileSize(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * Update quality stats display in metadata panel
 * @param {Object} deps - Dependencies (state, annotationSystem, blobs)
 */
export function updateMetadataStats(deps = {}) {
    const { state = {}, annotationSystem, currentSplatBlob, currentMeshBlob, currentPointcloudBlob } = deps;

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
            ? (state.meshVertexCount || '-')
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
 * @param {Object} deps - Dependencies (state)
 */
export function updateAssetStatus(deps = {}) {
    const { state = {} } = deps;

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
export function addCustomField() {
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
export function addProcessingSoftware() {
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
export function addRelatedObject() {
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
export function addVersionEntry() {
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

const VALIDATION_RULES = {
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
 * @param {string} fieldId - DOM element ID
 * @returns {boolean} true if valid or empty
 */
function validateField(fieldId) {
    const field = document.getElementById(fieldId);
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
export function setupFieldValidation() {
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

/**
 * Collect all metadata from the panel
 * @returns {Object} Collected metadata
 */
export function collectMetadata() {
    const metadata = {
        project: {
            title: document.getElementById('meta-title')?.value || '',
            id: document.getElementById('meta-id')?.value || '',
            description: document.getElementById('meta-description')?.value || '',
            license: document.getElementById('meta-license')?.value || 'CC0'
        },
        relationships: {
            partOf: document.getElementById('meta-part-of')?.value || '',
            derivedFrom: document.getElementById('meta-derived-from')?.value || '',
            replaces: document.getElementById('meta-replaces')?.value || '',
            relatedObjects: []
        },
        provenance: {
            captureDate: document.getElementById('meta-capture-date')?.value || '',
            captureDevice: document.getElementById('meta-capture-device')?.value || '',
            deviceSerial: document.getElementById('meta-device-serial')?.value || '',
            operator: document.getElementById('meta-operator')?.value || '',
            operatorOrcid: document.getElementById('meta-operator-orcid')?.value || '',
            location: document.getElementById('meta-location')?.value || '',
            conventions: document.getElementById('meta-conventions')?.value || '',
            processingSoftware: [],
            processingNotes: document.getElementById('meta-processing-notes')?.value || ''
        },
        qualityMetrics: {
            tier: document.getElementById('meta-quality-tier')?.value || '',
            accuracyGrade: document.getElementById('meta-quality-accuracy')?.value || '',
            captureResolution: {
                value: parseFloat(document.getElementById('meta-quality-res-value')?.value) || null,
                unit: document.getElementById('meta-quality-res-unit')?.value || 'mm',
                type: document.getElementById('meta-quality-res-type')?.value || 'GSD'
            },
            alignmentError: {
                value: parseFloat(document.getElementById('meta-quality-align-value')?.value) || null,
                unit: document.getElementById('meta-quality-align-unit')?.value || 'mm',
                method: document.getElementById('meta-quality-align-method')?.value || 'RMSE'
            },
            scaleVerification: document.getElementById('meta-quality-scale-verify')?.value || '',
            dataQuality: {
                coverageGaps: document.getElementById('meta-quality-coverage-gaps')?.value || '',
                reconstructionAreas: document.getElementById('meta-quality-reconstruction')?.value || '',
                colorCalibration: document.getElementById('meta-quality-color-calibration')?.value || '',
                measurementUncertainty: document.getElementById('meta-quality-uncertainty')?.value || ''
            }
        },
        archivalRecord: {
            standard: document.getElementById('meta-archival-standard')?.value || '',
            title: document.getElementById('meta-archival-title')?.value || '',
            alternateTitles: (document.getElementById('meta-archival-alt-titles')?.value || '')
                .split(',').map(t => t.trim()).filter(t => t),
            ids: {
                accessionNumber: document.getElementById('meta-archival-accession')?.value || '',
                sirisId: document.getElementById('meta-archival-siris')?.value || '',
                uri: document.getElementById('meta-archival-uri')?.value || ''
            },
            creation: {
                creator: document.getElementById('meta-archival-creator')?.value || '',
                dateCreated: document.getElementById('meta-archival-date-created')?.value || '',
                period: document.getElementById('meta-archival-period')?.value || '',
                culture: document.getElementById('meta-archival-culture')?.value || ''
            },
            physicalDescription: {
                medium: document.getElementById('meta-archival-medium')?.value || '',
                dimensions: {
                    height: document.getElementById('meta-archival-dim-height')?.value || '',
                    width: document.getElementById('meta-archival-dim-width')?.value || '',
                    depth: document.getElementById('meta-archival-dim-depth')?.value || ''
                },
                condition: document.getElementById('meta-archival-condition')?.value || ''
            },
            provenance: document.getElementById('meta-archival-provenance')?.value || '',
            rights: {
                copyrightStatus: document.getElementById('meta-archival-copyright')?.value || '',
                creditLine: document.getElementById('meta-archival-credit')?.value || ''
            },
            context: {
                description: document.getElementById('meta-archival-context-desc')?.value || '',
                locationHistory: document.getElementById('meta-archival-location-history')?.value || ''
            },
            coverage: {
                spatial: {
                    locationName: document.getElementById('meta-coverage-location')?.value || '',
                    coordinates: [
                        parseFloat(document.getElementById('meta-coverage-lat')?.value) || null,
                        parseFloat(document.getElementById('meta-coverage-lon')?.value) || null
                    ]
                },
                temporal: {
                    subjectPeriod: document.getElementById('meta-coverage-period')?.value || '',
                    subjectDateCirca: document.getElementById('meta-coverage-circa')?.checked || false
                }
            }
        },
        materialStandard: {
            workflow: document.getElementById('meta-material-workflow')?.value || '',
            occlusionPacked: document.getElementById('meta-material-occlusion-packed')?.checked || false,
            colorSpace: document.getElementById('meta-material-colorspace')?.value || '',
            normalSpace: document.getElementById('meta-material-normalspace')?.value || ''
        },
        preservation: {
            formatRegistry: {
                glb: document.getElementById('meta-pres-format-glb')?.value || 'fmt/861',
                obj: document.getElementById('meta-pres-format-obj')?.value || 'fmt/935',
                ply: document.getElementById('meta-pres-format-ply')?.value || 'fmt/831',
                e57: document.getElementById('meta-pres-format-e57')?.value || 'fmt/643'
            },
            significantProperties: [],
            renderingRequirements: document.getElementById('meta-pres-render-req')?.value || '',
            renderingNotes: document.getElementById('meta-pres-render-notes')?.value || ''
        },
        splatMetadata: {
            createdBy: document.getElementById('meta-splat-created-by')?.value || '',
            version: document.getElementById('meta-splat-version')?.value || '',
            sourceNotes: document.getElementById('meta-splat-notes')?.value || '',
            role: document.getElementById('meta-splat-role')?.value || ''
        },
        meshMetadata: {
            createdBy: document.getElementById('meta-mesh-created-by')?.value || '',
            version: document.getElementById('meta-mesh-version')?.value || '',
            sourceNotes: document.getElementById('meta-mesh-notes')?.value || '',
            role: document.getElementById('meta-mesh-role')?.value || ''
        },
        pointcloudMetadata: {
            createdBy: document.getElementById('meta-pointcloud-created-by')?.value || '',
            version: document.getElementById('meta-pointcloud-version')?.value || '',
            sourceNotes: document.getElementById('meta-pointcloud-notes')?.value || '',
            role: document.getElementById('meta-pointcloud-role')?.value || ''
        },
        customFields: {},
        versionHistory: [],
        includeIntegrity: document.getElementById('meta-include-integrity')?.checked ?? true
    };

    // Handle custom license
    if (metadata.project.license === 'custom') {
        metadata.project.license = document.getElementById('meta-custom-license')?.value || 'Custom';
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
        const title = row.querySelector('.related-object-title')?.value?.trim();
        const description = row.querySelector('.related-object-desc')?.value?.trim();
        const url = row.querySelector('.related-object-url')?.value?.trim();
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
        const name = row.querySelector('.software-name')?.value?.trim();
        const version = row.querySelector('.software-version')?.value?.trim();
        const url = row.querySelector('.software-url')?.value?.trim();
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
        if (document.getElementById(id)?.checked) {
            metadata.preservation.significantProperties.push(value);
        }
    });

    // Collect custom fields
    const customFieldRows = document.querySelectorAll('.custom-field-row');
    customFieldRows.forEach(row => {
        const key = row.querySelector('.custom-field-key')?.value?.trim();
        const value = row.querySelector('.custom-field-value')?.value?.trim();
        if (key && value) {
            metadata.customFields[key] = value;
        }
    });

    // Collect version history entries
    const versionRows = document.querySelectorAll('.version-history-row');
    versionRows.forEach(row => {
        const version = row.querySelector('.version-entry-version')?.value?.trim();
        const description = row.querySelector('.version-entry-description')?.value?.trim();
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
 * @param {Object} manifest - Archive manifest
 */
export function prefillMetadataFromArchive(manifest) {
    if (!manifest) return;

    // Project info
    if (manifest.project) {
        const titleEl = document.getElementById('meta-title');
        if (titleEl && manifest.project.title) titleEl.value = manifest.project.title;

        const idEl = document.getElementById('meta-id');
        if (idEl && manifest.project.id) idEl.value = manifest.project.id;

        const descEl = document.getElementById('meta-description');
        if (descEl && manifest.project.description) descEl.value = manifest.project.description;

        if (manifest.project.license) {
            const licenseSelect = document.getElementById('meta-license');
            const standardLicenses = ['CC0', 'CC-BY 4.0', 'CC-BY-SA 4.0', 'CC-BY-NC 4.0', 'MIT', 'All Rights Reserved'];
            if (licenseSelect) {
                if (standardLicenses.includes(manifest.project.license)) {
                    licenseSelect.value = manifest.project.license;
                } else {
                    licenseSelect.value = 'custom';
                    const customField = document.getElementById('custom-license-field');
                    if (customField) customField.classList.remove('hidden');
                    const customLicenseEl = document.getElementById('meta-custom-license');
                    if (customLicenseEl) customLicenseEl.value = manifest.project.license;
                }
            }
        }
    }

    // Relationships
    if (manifest.relationships) {
        const relFields = {
            'meta-part-of': manifest.relationships.part_of,
            'meta-derived-from': manifest.relationships.derived_from,
            'meta-replaces': manifest.relationships.replaces
        };
        for (const [id, value] of Object.entries(relFields)) {
            const el = document.getElementById(id);
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
                    const titleInput = lastRow.querySelector('.related-object-title');
                    const descInput = lastRow.querySelector('.related-object-desc');
                    const urlInput = lastRow.querySelector('.related-object-url');
                    if (titleInput) titleInput.value = obj.title || '';
                    if (descInput) descInput.value = obj.description || '';
                    if (urlInput) urlInput.value = obj.url || '';
                }
            }
        }
    }

    // Provenance
    if (manifest.provenance) {
        const fields = {
            'meta-capture-date': manifest.provenance.capture_date,
            'meta-capture-device': manifest.provenance.capture_device,
            'meta-device-serial': manifest.provenance.device_serial,
            'meta-operator': manifest.provenance.operator,
            'meta-operator-orcid': manifest.provenance.operator_orcid,
            'meta-location': manifest.provenance.location,
            'meta-processing-notes': manifest.provenance.processing_notes
        };

        for (const [id, value] of Object.entries(fields)) {
            const el = document.getElementById(id);
            if (el && value) el.value = value;
        }

        if (manifest.provenance.convention_hints) {
            const conventionsEl = document.getElementById('meta-conventions');
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
                    const nameInput = lastRow.querySelector('.software-name');
                    const versionInput = lastRow.querySelector('.software-version');
                    const urlInput = lastRow.querySelector('.software-url');
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

        const tierEl = document.getElementById('meta-quality-tier');
        if (tierEl && qm.tier) tierEl.value = qm.tier;

        const accuracyEl = document.getElementById('meta-quality-accuracy');
        if (accuracyEl && qm.accuracy_grade) accuracyEl.value = qm.accuracy_grade;

        // Capture Resolution
        if (qm.capture_resolution) {
            const resValueEl = document.getElementById('meta-quality-res-value');
            if (resValueEl && qm.capture_resolution.value != null) resValueEl.value = qm.capture_resolution.value;

            const resUnitEl = document.getElementById('meta-quality-res-unit');
            if (resUnitEl && qm.capture_resolution.unit) resUnitEl.value = qm.capture_resolution.unit;

            const resTypeEl = document.getElementById('meta-quality-res-type');
            if (resTypeEl && qm.capture_resolution.type) resTypeEl.value = qm.capture_resolution.type;
        }

        // Alignment Error
        if (qm.alignment_error) {
            const alignValueEl = document.getElementById('meta-quality-align-value');
            if (alignValueEl && qm.alignment_error.value != null) alignValueEl.value = qm.alignment_error.value;

            const alignUnitEl = document.getElementById('meta-quality-align-unit');
            if (alignUnitEl && qm.alignment_error.unit) alignUnitEl.value = qm.alignment_error.unit;

            const alignMethodEl = document.getElementById('meta-quality-align-method');
            if (alignMethodEl && qm.alignment_error.method) alignMethodEl.value = qm.alignment_error.method;
        }

        const scaleVerifyEl = document.getElementById('meta-quality-scale-verify');
        if (scaleVerifyEl && qm.scale_verification) scaleVerifyEl.value = qm.scale_verification;

        // Data Quality
        if (qm.data_quality) {
            const dqFields = {
                'meta-quality-coverage-gaps': qm.data_quality.coverage_gaps,
                'meta-quality-reconstruction': qm.data_quality.reconstruction_areas,
                'meta-quality-color-calibration': qm.data_quality.color_calibration,
                'meta-quality-uncertainty': qm.data_quality.measurement_uncertainty
            };
            for (const [id, value] of Object.entries(dqFields)) {
                const el = document.getElementById(id);
                if (el && value) el.value = value;
            }
        }
    }

    // Archival Record (Dublin Core)
    if (manifest.archival_record) {
        const ar = manifest.archival_record;

        const archivalFields = {
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
            const el = document.getElementById(id);
            if (el && value) el.value = value;
        }

        // Alternate titles (array to comma-separated)
        if (ar.alternate_titles) {
            const altTitlesEl = document.getElementById('meta-archival-alt-titles');
            if (altTitlesEl) {
                const titles = Array.isArray(ar.alternate_titles)
                    ? ar.alternate_titles.join(', ')
                    : ar.alternate_titles;
                altTitlesEl.value = titles;
            }
        }

        // Textareas
        const provenanceEl = document.getElementById('meta-archival-provenance');
        if (provenanceEl && ar.provenance) provenanceEl.value = ar.provenance;

        const contextDescEl = document.getElementById('meta-archival-context-desc');
        if (contextDescEl && ar.context?.description) contextDescEl.value = ar.context.description;

        // Copyright status (select)
        const copyrightEl = document.getElementById('meta-archival-copyright');
        if (copyrightEl && ar.rights?.copyright_status) copyrightEl.value = ar.rights.copyright_status;

        // Coverage
        if (ar.coverage) {
            if (ar.coverage.spatial) {
                const locNameEl = document.getElementById('meta-coverage-location');
                if (locNameEl && ar.coverage.spatial.location_name) locNameEl.value = ar.coverage.spatial.location_name;

                if (ar.coverage.spatial.coordinates?.length >= 2) {
                    const latEl = document.getElementById('meta-coverage-lat');
                    const lonEl = document.getElementById('meta-coverage-lon');
                    if (latEl && ar.coverage.spatial.coordinates[0] != null) latEl.value = ar.coverage.spatial.coordinates[0];
                    if (lonEl && ar.coverage.spatial.coordinates[1] != null) lonEl.value = ar.coverage.spatial.coordinates[1];
                }
            }
            if (ar.coverage.temporal) {
                const periodEl = document.getElementById('meta-coverage-period');
                if (periodEl && ar.coverage.temporal.subject_period) periodEl.value = ar.coverage.temporal.subject_period;

                const circaEl = document.getElementById('meta-coverage-circa');
                if (circaEl) circaEl.checked = ar.coverage.temporal.subject_date_circa || false;
            }
        }
    }

    // Material Standard
    if (manifest.material_standard) {
        const ms = manifest.material_standard;

        const workflowEl = document.getElementById('meta-material-workflow');
        if (workflowEl && ms.workflow) workflowEl.value = ms.workflow;

        const occlusionEl = document.getElementById('meta-material-occlusion-packed');
        if (occlusionEl) occlusionEl.checked = ms.occlusion_packed || false;

        const colorSpaceEl = document.getElementById('meta-material-colorspace');
        if (colorSpaceEl && ms.color_space) colorSpaceEl.value = ms.color_space;

        const normalSpaceEl = document.getElementById('meta-material-normalspace');
        if (normalSpaceEl && ms.normal_space) normalSpaceEl.value = ms.normal_space;
    }

    // Preservation
    if (manifest.preservation) {
        const pres = manifest.preservation;

        if (pres.format_registry) {
            const formatFields = {
                'meta-pres-format-glb': pres.format_registry.glb,
                'meta-pres-format-obj': pres.format_registry.obj,
                'meta-pres-format-ply': pres.format_registry.ply,
                'meta-pres-format-e57': pres.format_registry.e57
            };
            for (const [id, value] of Object.entries(formatFields)) {
                const el = document.getElementById(id);
                if (el && value) el.value = value;
            }
        }

        // Significant properties (checkboxes)
        if (pres.significant_properties?.length) {
            const propMap = {
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
                const el = document.getElementById(id);
                if (el) el.checked = false;
            }
            // Then check the ones in the manifest
            for (const prop of pres.significant_properties) {
                const id = propMap[prop];
                if (id) {
                    const el = document.getElementById(id);
                    if (el) el.checked = true;
                }
            }
        }

        const renderReqEl = document.getElementById('meta-pres-render-req');
        if (renderReqEl && pres.rendering_requirements) renderReqEl.value = pres.rendering_requirements;

        const renderNotesEl = document.getElementById('meta-pres-render-notes');
        if (renderNotesEl && pres.rendering_notes) renderNotesEl.value = pres.rendering_notes;
    }

    // Asset metadata from data_entries
    if (manifest.data_entries) {
        // Find scene entry
        const sceneKey = Object.keys(manifest.data_entries).find(k => k.startsWith('scene_'));
        if (sceneKey) {
            const scene = manifest.data_entries[sceneKey];
            const splatFields = {
                'meta-splat-created-by': scene.created_by,
                'meta-splat-version': scene._created_by_version,
                'meta-splat-notes': scene._source_notes,
                'meta-splat-role': scene.role
            };
            for (const [id, value] of Object.entries(splatFields)) {
                const el = document.getElementById(id);
                if (el && value) el.value = value;
            }
        }

        // Find mesh entry
        const meshKey = Object.keys(manifest.data_entries).find(k => k.startsWith('mesh_'));
        if (meshKey) {
            const mesh = manifest.data_entries[meshKey];
            const meshFields = {
                'meta-mesh-created-by': mesh.created_by,
                'meta-mesh-version': mesh._created_by_version,
                'meta-mesh-notes': mesh._source_notes,
                'meta-mesh-role': mesh.role
            };
            for (const [id, value] of Object.entries(meshFields)) {
                const el = document.getElementById(id);
                if (el && value) el.value = value;
            }
        }

        // Find pointcloud entry
        const pcKey = Object.keys(manifest.data_entries).find(k => k.startsWith('pointcloud_'));
        if (pcKey) {
            const pc = manifest.data_entries[pcKey];
            const pcFields = {
                'meta-pointcloud-created-by': pc.created_by,
                'meta-pointcloud-version': pc._created_by_version,
                'meta-pointcloud-notes': pc._source_notes,
                'meta-pointcloud-role': pc.role
            };
            for (const [id, value] of Object.entries(pcFields)) {
                const el = document.getElementById(id);
                if (el && value) el.value = value;
            }
        }
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
                const keyInput = lastRow.querySelector('.custom-field-key');
                const valueInput = lastRow.querySelector('.custom-field-value');
                if (keyInput) keyInput.value = key;
                if (valueInput) valueInput.value = value;
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
                    const versionInput = lastRow.querySelector('.version-entry-version');
                    const descInput = lastRow.querySelector('.version-entry-description');
                    if (versionInput) versionInput.value = entry.version || '';
                    if (descInput) descInput.value = entry.description || '';
                }
            }
        }
    }
}

// =============================================================================
// MUSEUM-STYLE METADATA DISPLAY
// =============================================================================

/**
 * Populate the museum-style metadata display
 * @param {Object} deps - Dependencies (state, annotationSystem)
 */
export function populateMetadataDisplay(deps = {}) {
    const { state = {}, annotationSystem, imageAssets } = deps;
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
    const detailsSection = document.querySelector('#sidebar-view .display-details');
    const divider = document.querySelector('#sidebar-view .display-divider');
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
            const customLicense = document.getElementById('meta-custom-license')?.value;
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
 * @param {Object} manifest - Archive manifest
 * @param {Object} archiveLoader - Archive loader instance
 */
export function updateArchiveMetadataUI(manifest, archiveLoader) {
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
        entries.forEach(entry => {
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
export function clearArchiveMetadata() {
    const elements = {
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
 * @param {Object} annotation - Annotation object
 * @param {string|null} currentPopupId - Reference to track current popup ID
 * @returns {string} The annotation ID that was shown
 */
export function showAnnotationPopup(annotation, imageAssets) {
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
 * @param {string} currentPopupAnnotationId - ID of the annotation whose popup is shown
 */
export function updateAnnotationPopupPosition(currentPopupAnnotationId) {
    if (!currentPopupAnnotationId) return;

    // On mobile kiosk, popup is hidden — annotation content shown in bottom sheet
    if (window.innerWidth <= 768 && document.body.classList.contains('kiosk-mode')) return;

    const popup = document.getElementById('annotation-info-popup');
    if (!popup || popup.classList.contains('hidden')) return;

    const marker = document.querySelector(`.annotation-marker[data-annotation-id="${currentPopupAnnotationId}"]`);
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
    let left;
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
export function hideAnnotationPopup() {
    const popup = document.getElementById('annotation-info-popup');
    if (popup) popup.classList.add('hidden');
}

