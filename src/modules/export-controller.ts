/**
 * Export Controller Module
 *
 * Handles archive export, generic viewer download, and metadata manifest import/export.
 * Extracted from main.js — all functions receive dependencies via the deps pattern.
 */

import { captureScreenshot } from './archive-creator.js';
import { Logger, notify } from './utilities.js';
import { formatFileSize, getActiveProfile } from './metadata-manager.js';
import { getMissingCriticalFields } from './metadata-profile.js';
import { getStore } from './asset-store.js';
import type { ExportDeps } from '@/types.js';

const log = Logger.getLogger('export-controller');

/**
 * Show the export panel and sync asset checkboxes.
 */
export function showExportPanel(deps: ExportDeps): void {
    deps.ui.showExportPanelHandler();
    updateArchiveAssetCheckboxes(deps);
}

/**
 * Update archive asset checkboxes based on loaded state.
 */
export function updateArchiveAssetCheckboxes(deps: ExportDeps): void {
    const { sceneRefs, state } = deps;
    const { annotationSystem } = sceneRefs;

    const checkboxes = [
        { id: 'archive-include-splat', loaded: state.splatLoaded },
        { id: 'archive-include-model', loaded: state.modelLoaded },
        { id: 'archive-include-pointcloud', loaded: state.pointcloudLoaded },
        { id: 'archive-include-annotations', loaded: annotationSystem && annotationSystem.hasAnnotations() }
    ];
    checkboxes.forEach(({ id, loaded }) => {
        const el = document.getElementById(id) as HTMLInputElement | null;
        if (el) {
            el.checked = !!loaded;
            el.disabled = !loaded;
        }
    });
}

/**
 * Show the validation dialog and return true if user chooses to export anyway.
 */
function showValidationDialog(missing: Array<{ id: string; label: string }>, profileName: string): Promise<boolean> {
    return new Promise(resolve => {
        const overlay = document.getElementById('export-validation-overlay');
        const list = document.getElementById('validation-missing-list');
        const profileEl = document.getElementById('validation-profile-name');
        const backBtn = document.getElementById('btn-validation-back');
        const exportBtn = document.getElementById('btn-validation-export');

        if (!overlay || !list || !backBtn || !exportBtn) {
            resolve(true); // If dialog elements missing, proceed with export
            return;
        }

        // Populate
        if (profileEl) profileEl.textContent = profileName;
        list.innerHTML = missing.map(f => `<li>${f.label}</li>`).join('');

        // Show
        overlay.classList.remove('hidden');

        const cleanup = () => {
            overlay.classList.add('hidden');
            backBtn.removeEventListener('click', onBack);
            exportBtn.removeEventListener('click', onExport);
        };

        const onBack = () => { cleanup(); resolve(false); };
        const onExport = () => { cleanup(); resolve(true); };

        backBtn.addEventListener('click', onBack);
        exportBtn.addEventListener('click', onExport);
    });
}

/**
 * Create and download an archive (.a3d/.a3z) with all selected assets.
 */
export async function downloadArchive(deps: ExportDeps): Promise<void> {
    const { sceneRefs, state, ui, metadata: metadataFns } = deps;
    const { archiveCreator, renderer, scene, camera, splatMesh, modelGroup, pointcloudGroup, annotationSystem } = sceneRefs;
    const assets = getStore();

    log.info(' downloadArchive called');
    if (!archiveCreator) {
        log.error(' archiveCreator is null');
        return;
    }

    // Reset creator
    log.info(' Resetting archive creator');
    archiveCreator.reset();

    // Preserve original creation date when re-exporting a loaded archive
    if (state.archiveManifest?._creation_date) {
        archiveCreator.preserveCreationDate(state.archiveManifest._creation_date);
    }

    // Get metadata from metadata panel
    log.info(' Collecting metadata');
    const metadata = metadataFns.collectMetadata();
    log.info(' Metadata collected:', metadata);

    // Get export options
    const formatRadio = document.querySelector('input[name="export-format"]:checked') as HTMLInputElement | null;
    const format = formatRadio?.value || 'a3d';
    // Preview image and integrity hashes are always included
    const includePreview = true;
    const includeHashes = true;
    log.info(' Export options:', { format, includePreview, includeHashes });

    // Validate title is set
    if (!metadata.project.title) {
        log.info(' No title set, showing metadata panel');
        notify.warning('Please enter a project title in the metadata panel before exporting.');
        ui.showMetadataPanel();
        return;
    }

    // Profile-aware metadata validation
    const profile = getActiveProfile();
    const missing = getMissingCriticalFields(profile);
    if (missing.length > 0) {
        const profileLabels: Record<string, string> = { basic: 'Basic', standard: 'Standard', archival: 'Archival' };
        const proceed = await showValidationDialog(missing, profileLabels[profile] || profile);
        if (!proceed) {
            ui.showMetadataPanel();
            return;
        }
    }

    // Apply project info
    log.info(' Setting project info');
    archiveCreator.setProjectInfo(metadata.project);

    // Apply provenance
    log.info(' Setting provenance');
    archiveCreator.setProvenance(metadata.provenance);

    // Apply relationships
    log.info(' Setting relationships');
    archiveCreator.setRelationships(metadata.relationships);

    // Apply quality metrics
    log.info(' Setting quality metrics');
    archiveCreator.setQualityMetrics(metadata.qualityMetrics);

    // Apply archival record
    log.info(' Setting archival record');
    archiveCreator.setArchivalRecord(metadata.archivalRecord);

    // Apply material standard
    log.info(' Setting material standard');
    archiveCreator.setMaterialStandard(metadata.materialStandard);

    // Apply preservation
    log.info(' Setting preservation');
    archiveCreator.setPreservation(metadata.preservation);

    // Apply viewer settings
    log.info(' Setting viewer settings');
    archiveCreator.setViewerSettings(metadata.viewerSettings);

    // Apply custom fields
    if (Object.keys(metadata.customFields).length > 0) {
        log.info(' Setting custom fields');
        archiveCreator.setCustomFields(metadata.customFields);
    }

    // Apply version history
    if (metadata.versionHistory && metadata.versionHistory.length > 0) {
        log.info(' Setting version history');
        archiveCreator.setVersionHistory(metadata.versionHistory);
    }

    // Read which assets the user wants to include
    const includeSplat = (document.getElementById('archive-include-splat') as HTMLInputElement)?.checked;
    const includeModel = (document.getElementById('archive-include-model') as HTMLInputElement)?.checked;
    const includePointcloud = (document.getElementById('archive-include-pointcloud') as HTMLInputElement)?.checked;
    const includeAnnotations = (document.getElementById('archive-include-annotations') as HTMLInputElement)?.checked;

    // Add splat if loaded and selected
    log.info(' Checking splat:', { splatBlob: !!assets.splatBlob, splatLoaded: state.splatLoaded });
    if (includeSplat && assets.splatBlob && state.splatLoaded) {
        const fileName = document.getElementById('splat-filename')?.textContent || 'scene.ply';
        const position = splatMesh ? [splatMesh.position.x, splatMesh.position.y, splatMesh.position.z] : [0, 0, 0];
        const rotation = splatMesh ? [splatMesh.rotation.x, splatMesh.rotation.y, splatMesh.rotation.z] : [0, 0, 0];
        const scale = splatMesh ? splatMesh.scale.x : 1;

        log.info(' Adding scene:', { fileName, position, rotation, scale });
        archiveCreator.addScene(assets.splatBlob, fileName, {
            position, rotation, scale,
            created_by: metadata.splatMetadata.createdBy || 'unknown',
            created_by_version: metadata.splatMetadata.version || '',
            source_notes: metadata.splatMetadata.sourceNotes || '',
            role: metadata.splatMetadata.role || ''
        });
    }

    // Add mesh if loaded and selected
    log.info(' Checking mesh:', { meshBlob: !!assets.meshBlob, modelLoaded: state.modelLoaded });
    // If viewing a proxy and full-res blob hasn't been extracted yet, extract now
    if (includeModel && state.modelLoaded && !assets.meshBlob && state.viewingProxy && state.archiveLoader) {
        const meshEntry = state.archiveLoader.getMeshEntry();
        if (meshEntry) {
            const fullData = await state.archiveLoader.extractFile(meshEntry.file_name);
            if (fullData) assets.meshBlob = fullData.blob;
        }
    }
    if (includeModel && assets.meshBlob && state.modelLoaded) {
        const fileName = document.getElementById('model-filename')?.textContent || 'mesh.glb';
        const position = modelGroup ? [modelGroup.position.x, modelGroup.position.y, modelGroup.position.z] : [0, 0, 0];
        const rotation = modelGroup ? [modelGroup.rotation.x, modelGroup.rotation.y, modelGroup.rotation.z] : [0, 0, 0];
        const scale = modelGroup ? modelGroup.scale.x : 1;

        log.info(' Adding mesh:', { fileName, position, rotation, scale });
        archiveCreator.addMesh(assets.meshBlob, fileName, {
            position, rotation, scale,
            created_by: metadata.meshMetadata.createdBy || 'unknown',
            created_by_version: metadata.meshMetadata.version || '',
            source_notes: metadata.meshMetadata.sourceNotes || '',
            role: metadata.meshMetadata.role || ''
        });
    }

    // Add display proxy mesh if available
    if (includeModel && assets.proxyMeshBlob) {
        const proxyFileName = document.getElementById('proxy-mesh-filename')?.textContent || 'mesh_proxy.glb';
        const position = modelGroup ? [modelGroup.position.x, modelGroup.position.y, modelGroup.position.z] : [0, 0, 0];
        const rotation = modelGroup ? [modelGroup.rotation.x, modelGroup.rotation.y, modelGroup.rotation.z] : [0, 0, 0];
        const scale = modelGroup ? modelGroup.scale.x : 1;

        log.info(' Adding mesh proxy:', { proxyFileName });
        archiveCreator.addMeshProxy(assets.proxyMeshBlob, proxyFileName, {
            position, rotation, scale,
            derived_from: 'mesh_0'
        });
    }

    // Add display proxy splat if available
    if (assets.proxySplatBlob) {
        const proxySplatFileName = document.getElementById('proxy-splat-filename')?.textContent || 'scene_proxy.spz';
        const splatPosition = splatMesh ? [splatMesh.position.x, splatMesh.position.y, splatMesh.position.z] : [0, 0, 0];
        const splatRotation = splatMesh ? [splatMesh.rotation.x, splatMesh.rotation.y, splatMesh.rotation.z] : [0, 0, 0];
        const splatScale = splatMesh ? splatMesh.scale.x : 1;

        log.info(' Adding splat proxy:', { proxySplatFileName });
        archiveCreator.addSceneProxy(assets.proxySplatBlob, proxySplatFileName, {
            position: splatPosition, rotation: splatRotation, scale: splatScale,
            derived_from: 'scene_0'
        });
    }

    // Add point cloud if loaded and selected
    log.info(' Checking pointcloud:', { pointcloudBlob: !!assets.pointcloudBlob, pointcloudLoaded: state.pointcloudLoaded });
    if (includePointcloud && assets.pointcloudBlob && state.pointcloudLoaded) {
        const fileName = document.getElementById('pointcloud-filename')?.textContent || 'pointcloud.e57';
        const position = pointcloudGroup ? [pointcloudGroup.position.x, pointcloudGroup.position.y, pointcloudGroup.position.z] : [0, 0, 0];
        const rotation = pointcloudGroup ? [pointcloudGroup.rotation.x, pointcloudGroup.rotation.y, pointcloudGroup.rotation.z] : [0, 0, 0];
        const scale = pointcloudGroup ? pointcloudGroup.scale.x : 1;

        log.info(' Adding pointcloud:', { fileName, position, rotation, scale });
        archiveCreator.addPointcloud(assets.pointcloudBlob, fileName, {
            position, rotation, scale,
            created_by: metadata.pointcloudMetadata?.createdBy || 'unknown',
            created_by_version: metadata.pointcloudMetadata?.version || '',
            source_notes: metadata.pointcloudMetadata?.sourceNotes || '',
            role: metadata.pointcloudMetadata?.role || ''
        });
    }

    // Add annotations if selected
    if (includeAnnotations && annotationSystem && annotationSystem.hasAnnotations()) {
        log.info(' Adding annotations');
        archiveCreator.setAnnotations(annotationSystem.toJSON());
    }

    // Add embedded images
    if (state.imageAssets.size > 0) {
        log.info(` Adding ${state.imageAssets.size} embedded images`);
        for (const [path, asset] of state.imageAssets) {
            archiveCreator.addImage(asset.blob, path);
        }
    }

    // Add user-added source files (have blobs, not from archive)
    const sourceFilesWithBlobs = assets.sourceFiles.filter((sf: any) => sf.file && !sf.fromArchive);
    if (sourceFilesWithBlobs.length > 0) {
        const totalSourceSize = sourceFilesWithBlobs.reduce((sum: number, sf: any) => sum + sf.size, 0);
        if (totalSourceSize > 2 * 1024 * 1024 * 1024) {
            notify.warning(`Source files total ${formatFileSize(totalSourceSize)}. Very large archives may fail in the browser. Consider adding files to the ZIP after export using external tools.`);
        }
        log.info(` Adding ${sourceFilesWithBlobs.length} source files (${formatFileSize(totalSourceSize)})`);
        for (const sf of sourceFilesWithBlobs) {
            archiveCreator.addSourceFile(sf.file, sf.name, { category: sf.category });
        }
    }

    // Re-extract source files from the loaded archive (raw data retained for this purpose)
    if (state.archiveLoader && state.archiveLoader.hasSourceFiles()) {
        const archiveSourceEntries = state.archiveLoader.getSourceFileEntries();
        for (const { entry } of archiveSourceEntries) {
            try {
                const data = await state.archiveLoader.extractFile(entry.file_name);
                if (data) {
                    archiveCreator.addSourceFile(data.blob, entry.original_name || entry.file_name.split('/').pop(), {
                        category: entry.source_category || ''
                    });
                }
            } catch (e: any) {
                log.warn('Failed to re-extract source file:', entry.file_name, e.message);
            }
        }
    }

    // Apply metadata profile
    archiveCreator.setMetadataProfile(getActiveProfile());

    // Set quality stats
    log.info(' Setting quality stats');
    archiveCreator.setQualityStats({
        splat_count: (includeSplat && state.splatLoaded) ? parseInt(document.getElementById('splat-vertices')?.textContent || '0') || 0 : 0,
        mesh_polygons: (includeModel && state.modelLoaded) ? parseInt(document.getElementById('model-faces')?.textContent || '0') || 0 : 0,
        mesh_vertices: (includeModel && state.modelLoaded) ? (state.meshVertexCount || 0) : 0,
        splat_file_size: (includeSplat && assets.splatBlob) ? assets.splatBlob.size : 0,
        mesh_file_size: (includeModel && assets.meshBlob) ? assets.meshBlob.size : 0,
        pointcloud_points: (includePointcloud && state.pointcloudLoaded) ? parseInt(document.getElementById('pointcloud-points')?.textContent?.replace(/,/g, '') || '0') || 0 : 0,
        pointcloud_file_size: (includePointcloud && assets.pointcloudBlob) ? assets.pointcloudBlob.size : 0,
        texture_count: (includeModel && state.modelLoaded && state.meshTextureInfo) ? state.meshTextureInfo.count : 0,
        texture_max_resolution: (includeModel && state.modelLoaded && state.meshTextureInfo) ? state.meshTextureInfo.maxResolution : 0,
        texture_maps: (includeModel && state.modelLoaded && state.meshTextureInfo) ? state.meshTextureInfo.maps : []
    });

    // Add preview/thumbnail
    if (includePreview && renderer) {
        try {
            let previewBlob;
            if (state.manualPreviewBlob) {
                log.info(' Using manual preview');
                previewBlob = state.manualPreviewBlob;
            } else {
                log.info(' Auto-capturing preview screenshot');
                renderer.render(scene, camera);
                previewBlob = await captureScreenshot(renderer.domElement, { width: 512, height: 512 });
            }
            if (previewBlob) {
                log.info(' Preview captured, adding thumbnail');
                archiveCreator.addThumbnail(previewBlob, 'preview.jpg');
            }
        } catch (e) {
            log.warn(' Failed to capture preview:', e);
        }
    }

    // Add screenshots
    if (state.screenshots.length > 0) {
        log.info(` Adding ${state.screenshots.length} screenshot(s) to archive`);
        for (const screenshot of state.screenshots) {
            try {
                archiveCreator.addScreenshot(screenshot.blob, `screenshot_${screenshot.id}.jpg`);
            } catch (e) {
                log.warn(' Failed to add screenshot:', e);
            }
        }
    }

    // Validate
    log.info(' Validating archive');
    const validation = archiveCreator.validate();
    log.info(' Validation result:', validation);
    if (!validation.valid) {
        notify.error('Cannot create archive: ' + validation.errors.join('; '));
        return;
    }

    // Create and download with progress
    log.info(' Starting archive creation');
    ui.showLoading('Creating archive...', true);
    try {
        log.info(' Calling archiveCreator.downloadArchive');
        await archiveCreator.downloadArchive(
            {
                filename: metadata.project.id || 'archive',
                format: format,
                includeHashes: includeHashes
            },
            (percent: number, stage: string) => {
                ui.updateProgress(percent, stage);
            }
        );
        log.info(' Archive download complete');
        ui.hideLoading();
        ui.hideExportPanel();
    } catch (e: any) {
        ui.hideLoading();
        log.error(' Error creating archive:', e);
        notify.error('Error creating archive: ' + e.message);
    }
}

/**
 * Download a generic offline viewer (standalone HTML that opens any .a3d/.a3z).
 */
export async function downloadGenericViewer(deps: ExportDeps): Promise<void> {
    const { ui, tauriBridge } = deps;

    log.info(' downloadGenericViewer called');
    ui.showLoading('Building offline viewer...', true);

    try {
        ui.updateProgress(1, 'Loading viewer module...');
        const { fetchDependencies: fetchViewerDeps, generateGenericViewer } =
            await import('./kiosk-viewer.js');

        ui.updateProgress(5, 'Fetching viewer libraries...');
        const viewerDeps = await fetchViewerDeps((msg: string) => {
            ui.updateProgress(15, msg);
        });

        ui.updateProgress(90, 'Assembling viewer...');
        const html = generateGenericViewer(viewerDeps);

        ui.updateProgress(95, 'Starting download...');
        const blob = new Blob([html], { type: 'text/html' });
        if (tauriBridge) {
            await tauriBridge.download(blob, 'archive-viewer.html', { name: 'HTML Files', extensions: ['html'] });
        } else {
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = 'archive-viewer.html';
            a.click();
            URL.revokeObjectURL(url);
        }

        log.info(`[Viewer] Generic viewer exported (${(blob.size / 1024).toFixed(0)} KB)`);
        ui.updateProgress(100, 'Complete');
        ui.hideLoading();
        notify.success('Offline viewer downloaded: archive-viewer.html');

    } catch (e: any) {
        ui.hideLoading();
        log.error(' Error creating generic viewer:', e);
        notify.error('Error creating viewer: ' + e.message);
    }
}

/**
 * Export metadata as a standalone JSON manifest file.
 */
export async function exportMetadataManifest(deps: ExportDeps): Promise<void> {
    const { sceneRefs, state, tauriBridge, metadata: metadataFns } = deps;
    const { annotationSystem } = sceneRefs;

    // Use a temporary ArchiveCreator to produce consistent snake_case output
    const { ArchiveCreator } = await import('./archive-creator.js');
    const tempCreator = new ArchiveCreator();

    // Preserve original creation date if re-exporting
    if (state.archiveManifest?._creation_date) {
        tempCreator.preserveCreationDate(state.archiveManifest._creation_date);
    }

    const metadata = metadataFns.collectMetadata();
    tempCreator.applyMetadata(metadata);
    tempCreator.setMetadataProfile(getActiveProfile());

    // Include annotations if present
    if (annotationSystem && annotationSystem.hasAnnotations()) {
        tempCreator.setAnnotations(annotationSystem.toJSON());
    }

    const json = tempCreator.generateManifest();
    const blob = new Blob([json], { type: 'application/json' });
    if (tauriBridge) {
        await tauriBridge.download(blob, 'manifest.json', { name: 'JSON Files', extensions: ['json'] });
    } else {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'manifest.json';
        a.click();
        URL.revokeObjectURL(url);
    }
    notify.success('Manifest exported');
}

/**
 * Import metadata from a JSON manifest file.
 */
export function importMetadataManifest(deps: ExportDeps): void {
    const { metadata: metadataFns } = deps;

    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.addEventListener('change', (e: Event) => {
        const file = (e.target as HTMLInputElement).files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const manifest = JSON.parse(event.target!.result as string);
                metadataFns.prefillMetadataFromArchive(manifest);

                // Load annotations if present in manifest
                if (manifest.annotations && Array.isArray(manifest.annotations) && manifest.annotations.length > 0) {
                    metadataFns.loadAnnotationsFromArchive(manifest.annotations);
                }

                metadataFns.populateMetadataDisplay();
                notify.success('Manifest imported');
            } catch (err: any) {
                log.error('Failed to parse manifest:', err);
                notify.error('Invalid manifest file: ' + err.message);
            }
        };
        reader.readAsText(file);
    });
    input.click();
}
