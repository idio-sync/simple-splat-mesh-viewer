/**
 * Archive Pipeline Module
 *
 * Handles archive loading, processing, lazy asset extraction, quality tier switching,
 * and archive metadata UI. Extracted from main.js — all functions receive dependencies
 * via the deps pattern.
 */

import * as THREE from 'three';
import { SplatMesh } from '@sparkjsdev/spark';
import { ArchiveLoader } from './archive-loader.js';
import { hasAnyProxy } from './quality-tier.js';
import { ASSET_STATE } from './constants.js';
import { loadWalkthroughFromArchive } from './walkthrough-controller.js';
import { Logger, notify, computeMeshFaceCount, computeTextureInfo, disposeObject } from './utilities.js';
import { getStore } from './asset-store.js';
import {
    loadGLTF,
    loadOBJFromUrl as loadOBJFromUrlFn,
    loadPointcloudFromBlobUrl as loadPointcloudFromBlobUrlHandler,
    loadDrawingFromBlobUrl as loadDrawingFromBlobUrlHandler,
    loadArchiveFullResMesh, loadArchiveFullResSplat,
    loadArchiveProxyMesh, loadArchiveProxySplat,
    getPrimaryAssetType
} from './file-handlers.js';
import { loadCADFromBlobUrl } from './cad-loader.js';
import { centerModelOnGrid } from './alignment.js';
import { updatePronomRegistry } from './metadata-manager.js';
import type { ArchivePipelineDeps } from '@/types.js';
import { normalizeScale } from '@/types.js';

const log = Logger.getLogger('archive-pipeline');

// ==================== Private Helpers ====================

/**
 * Load splat from a blob URL (used by archive loader).
 * Reassigns splatMesh via deps.setSplatMesh.
 */
async function loadSplatFromBlobUrl(blobUrl: string, fileName: string, deps: ArchivePipelineDeps): Promise<void> {
    const { sceneRefs, state, setSplatMesh } = deps;

    // Spark.js requires WebGL — switch renderer if currently WebGPU
    if (deps.sceneManager?.ensureWebGLRenderer) {
        await deps.sceneManager.ensureWebGLRenderer();
    }

    // Remove existing splat
    if (sceneRefs.splatMesh) {
        sceneRefs.scene.remove(sceneRefs.splatMesh);
        if (sceneRefs.splatMesh.dispose) sceneRefs.splatMesh.dispose();
        setSplatMesh(null);
    }

    // Ensure WASM is ready (required for compressed formats like .sog, .spz)
    await SplatMesh.staticInitialized;

    // Create SplatMesh using Spark
    const newSplatMesh = new SplatMesh({ url: blobUrl });
    setSplatMesh(newSplatMesh);

    // Apply default rotation to correct upside-down orientation
    newSplatMesh.rotation.x = Math.PI;

    // Match properties set in file-handlers.ts for consistency
    newSplatMesh.frustumCulled = false;
    newSplatMesh.matrixAutoUpdate = true;
    newSplatMesh.renderOrder = 0;

    // Verify SplatMesh is a valid THREE.Object3D
    if (!(newSplatMesh instanceof THREE.Object3D)) {
        log.warn(' WARNING: SplatMesh is not an instance of THREE.Object3D!');
    }

    // Wait for splat to finish loading/parsing
    await newSplatMesh.initialized;

    try {
        sceneRefs.scene.add(newSplatMesh);
    } catch (addError) {
        log.error(' Error adding splatMesh to scene:', addError);
        throw addError;
    }

    state.splatLoaded = true;
    deps.ui.updateVisibility();

    // Update UI
    document.getElementById('splat-filename')!.textContent = fileName;
    document.getElementById('splat-vertices')!.textContent = 'Loaded';
}

/**
 * Load model from a blob URL (used by archive loader).
 */
async function loadModelFromBlobUrl(blobUrl: string, fileName: string, deps: ArchivePipelineDeps): Promise<void> {
    const { sceneRefs, sceneManager, state } = deps;
    const modelGroup = sceneRefs.modelGroup;

    // Clear existing model
    while (modelGroup.children.length > 0) {
        const child = modelGroup.children[0];
        disposeObject(child);
        modelGroup.remove(child);
    }

    const extension = fileName.split('.').pop()!.toLowerCase();
    let loadedObject: any;

    if (extension === 'glb' || extension === 'gltf') {
        loadedObject = await loadGLTF(blobUrl);
    } else if (extension === 'obj') {
        loadedObject = await loadOBJFromUrlFn(blobUrl);
    }

    if (loadedObject) {
        modelGroup.add(loadedObject);
        if (sceneManager) sceneManager.applyShadowProperties(loadedObject);
        state.modelLoaded = true;
        deps.ui.updateModelOpacity();
        deps.ui.updateModelWireframe();
        deps.ui.updateVisibility();

        // Center model on grid if no splat is loaded
        // (Archives with alignment data will override this later)
        if (!state.splatLoaded) {
            centerModelOnGrid(modelGroup);
        }

        // Count faces and update UI
        const faceCount = computeMeshFaceCount(loadedObject);
        document.getElementById('model-filename')!.textContent = fileName;
        document.getElementById('model-faces')!.textContent = faceCount.toLocaleString();

        const textureInfo = computeTextureInfo(loadedObject);
        state.meshTextureInfo = textureInfo;

        const texEl = document.getElementById('model-textures');
        if (texEl && textureInfo.count > 0) {
            texEl.textContent = `${textureInfo.count} × ${textureInfo.maxResolution}²`;
            const texRow = texEl.closest('.prop-row') as HTMLElement;
            if (texRow) texRow.style.display = '';
        }
    }
}

/**
 * Update archive metadata UI panel.
 */
function updateArchiveMetadataUI(manifest: any, archiveLoader: any): void {
    const section = document.getElementById('archive-metadata-section');
    if (!section) return;

    section.style.display = '';

    const metadata = archiveLoader.getMetadata();

    // Update basic info
    document.getElementById('archive-version')!.textContent = metadata.version || '-';

    const packerText = metadata.packerVersion
        ? `${metadata.packer} v${metadata.packerVersion}`
        : metadata.packer;
    document.getElementById('archive-packer')!.textContent = packerText;

    document.getElementById('archive-created')!.textContent =
        metadata.createdAt ? new Date(metadata.createdAt).toLocaleString() : '-';

    // Populate entries list
    const entriesList = document.getElementById('archive-entries-list')!;
    entriesList.replaceChildren(); // Clear existing content safely
    const header = document.createElement('p');
    header.className = 'entries-header';
    header.textContent = 'Contents:';
    entriesList.appendChild(header);

    const entries = archiveLoader.getEntryList();
    for (const entry of entries) {
        const entryDiv = document.createElement('div');
        entryDiv.className = 'archive-entry';

        // Determine entry type for styling
        let entryType = 'other';
        if (entry.key.startsWith('scene_')) entryType = 'scene';
        else if (entry.key.startsWith('mesh_')) entryType = 'mesh';
        else if (entry.key.startsWith('thumbnail_')) entryType = 'thumbnail';

        const typeSpan = document.createElement('span');
        typeSpan.className = `archive-entry-type ${entryType}`;
        typeSpan.textContent = entryType;

        const nameSpan = document.createElement('span');
        nameSpan.className = 'archive-entry-name';
        nameSpan.textContent = entry.fileName;

        const detailsDiv = document.createElement('div');
        detailsDiv.className = 'archive-entry-details';
        detailsDiv.textContent = entry.createdBy ? `Created by: ${entry.createdBy}` : '';

        entryDiv.appendChild(typeSpan);
        entryDiv.appendChild(nameSpan);
        entryDiv.appendChild(detailsDiv);
        entriesList.appendChild(entryDiv);
    }
}

// ==================== Exported Functions ====================

/**
 * Handle archive file input event.
 */
export async function handleArchiveFile(event: Event, deps: ArchivePipelineDeps): Promise<void> {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;

    document.getElementById('archive-filename')!.textContent = file.name;
    deps.ui.showLoading('Loading archive...');

    try {
        // Clean up previous archive if any
        if (deps.state.archiveLoader) {
            deps.state.archiveLoader.dispose();
        }

        const archiveLoader = new ArchiveLoader();
        await archiveLoader.loadFromFile(file);
        await processArchive(archiveLoader, file.name, deps);

        deps.state.currentArchiveUrl = null; // Local files cannot be shared
    } catch (error: any) {
        log.error('Error loading archive:', error);
        deps.ui.hideLoading();
        notify.error('Error loading archive: ' + error.message);
    }
}

/**
 * Load archive from URL.
 * Tries Range-based streaming first (downloads only ~64KB central directory,
 * then extracts files on demand via HTTP Range requests). Falls back to a
 * full download when the server doesn't support Range requests.
 */
export async function loadArchiveFromUrl(url: string, deps: ArchivePipelineDeps): Promise<void> {
    deps.ui.showLoading('Loading archive...');

    try {
        // Clean up previous archive if any
        if (deps.state.archiveLoader) {
            deps.state.archiveLoader.dispose();
        }

        const archiveLoader = new ArchiveLoader();
        const fileName = url.split('/').pop() || 'archive.a3d';

        // Try Range-based streaming first — only downloads the ZIP central
        // directory (~64KB). Each subsequent extractFile() call fetches just
        // the bytes for that file via an HTTP Range request.
        try {
            const fileSize = await archiveLoader.loadRemoteIndex(url);
            log.info(`Range-based loading: indexed ${fileSize} bytes from ${fileName}`);
        } catch (rangeError: any) {
            // Server doesn't support Range requests or HEAD failed — fall back
            log.info('Range-based loading unavailable, falling back to full download:', rangeError.message);
            deps.ui.showLoading('Downloading archive...', true);
            await archiveLoader.loadFromUrl(url, (progress: number) => {
                deps.ui.updateProgress(Math.round(progress * 100), 'Downloading archive...');
            });
        }

        document.getElementById('archive-filename')!.textContent = fileName;

        deps.state.currentArchiveUrl = url;
        await processArchive(archiveLoader, fileName, deps);
    } catch (error: any) {
        log.error('Error loading archive from URL:', error);
        deps.ui.hideLoading();
        notify.error('Error loading archive from URL: ' + error.message);
    }
}

/**
 * Ensure a single archive asset type is loaded on demand.
 * Returns true if the asset is loaded (or was already loaded), false otherwise.
 */
export async function ensureAssetLoaded(assetType: string, deps: ArchivePipelineDeps): Promise<boolean> {
    const { state, sceneRefs } = deps;
    const assets = getStore();

    if (!state.archiveLoader) return false;
    const archiveLoader = state.archiveLoader;

    // Already loaded
    if (state.assetStates[assetType] === ASSET_STATE.LOADED) return true;
    // Already errored — don't retry automatically
    if (state.assetStates[assetType] === ASSET_STATE.ERROR) return false;
    // Already loading — wait for it
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

    state.assetStates[assetType] = ASSET_STATE.LOADING;
    deps.ui.showInlineLoading(assetType);

    try {
        if (assetType === 'splat') {
            const sceneEntry = archiveLoader.getSceneEntry();
            const contentInfo = archiveLoader.getContentInfo();
            if (!sceneEntry || !contentInfo.hasSplat) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return false;
            }
            // Prefer proxy splat when quality tier is SD
            const proxyEntry = archiveLoader.getSceneProxyEntry();
            const useProxy = state.qualityResolved === 'sd' && contentInfo.hasSceneProxy && proxyEntry;
            const entryToLoad = useProxy ? proxyEntry : sceneEntry;

            const splatData = await archiveLoader.extractFile(entryToLoad.file_name);
            if (!splatData) { state.assetStates[assetType] = ASSET_STATE.ERROR; return false; }
            await loadSplatFromBlobUrl(splatData.url, entryToLoad.file_name, deps);
            // Apply transform from primary scene entry
            const transform = archiveLoader.getEntryTransform(sceneEntry);
            const currentSplat = sceneRefs.splatMesh;
            const s = normalizeScale(transform.scale);
            if (currentSplat && (transform.position.some((v: number) => v !== 0) || transform.rotation.some((v: number) => v !== 0) || s.some(v => v !== 1))) {
                currentSplat.position.fromArray(transform.position);
                currentSplat.rotation.set(...transform.rotation);
                currentSplat.scale.set(...s);
            }
            if (useProxy) {
                // Store the proxy blob for re-export, extract full-res blob in background
                assets.proxySplatBlob = splatData.blob;
                archiveLoader.extractFile(sceneEntry.file_name).then((fullData: any) => {
                    if (fullData) assets.splatBlob = fullData.blob;
                }).catch(() => {});
            } else {
                assets.splatBlob = splatData.blob;
                // Extract proxy blob in background so it survives re-export
                if (contentInfo.hasSceneProxy && proxyEntry) {
                    archiveLoader.extractFile(proxyEntry.file_name).then((proxyData: any) => {
                        if (proxyData) assets.proxySplatBlob = proxyData.blob;
                    }).catch(() => {});
                }
            }
            // Detect splat format from archive filename
            state.splatFormat = sceneEntry.file_name.split('.').pop()?.toLowerCase() || 'splat';
            state.assetStates[assetType] = ASSET_STATE.LOADED;
            updatePronomRegistry(state);
            return true;

        } else if (assetType === 'mesh') {
            const contentInfo = archiveLoader.getContentInfo();
            const meshEntry = archiveLoader.getMeshEntry();
            if (!meshEntry || !contentInfo.hasMesh) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return false;
            }
            // Prefer proxy mesh when quality tier is SD
            const proxyEntry = archiveLoader.getMeshProxyEntry();
            const useProxy = state.qualityResolved === 'sd' && contentInfo.hasMeshProxy && proxyEntry;
            const entryToLoad = useProxy ? proxyEntry : meshEntry;

            const meshData = await archiveLoader.extractFile(entryToLoad.file_name);
            if (!meshData) { state.assetStates[assetType] = ASSET_STATE.ERROR; return false; }
            await loadModelFromBlobUrl(meshData.url, entryToLoad.file_name, deps);
            // Apply transform from primary mesh entry
            const transform = archiveLoader.getEntryTransform(meshEntry);
            const modelGroup = sceneRefs.modelGroup;
            const ms = normalizeScale(transform.scale);
            if (modelGroup && (transform.position.some((v: number) => v !== 0) || transform.rotation.some((v: number) => v !== 0) || ms.some(v => v !== 1))) {
                modelGroup.position.fromArray(transform.position);
                modelGroup.rotation.set(...transform.rotation);
                modelGroup.scale.set(...ms);
            }
            if (useProxy) {
                // Store the proxy blob for re-export, extract full-res blob in background
                assets.proxyMeshBlob = meshData.blob;
                const proxyName = entryToLoad.file_name.split('/').pop();
                const proxyFilenameEl = document.getElementById('proxy-mesh-filename');
                if (proxyFilenameEl) proxyFilenameEl.textContent = proxyName;
                archiveLoader.extractFile(meshEntry.file_name).then((fullData: any) => {
                    if (fullData) assets.meshBlob = fullData.blob;
                }).catch(() => {});
                state.viewingProxy = true;
                document.getElementById('proxy-mesh-indicator')?.classList.remove('hidden');
                const fullResBtn = document.getElementById('btn-load-full-res');
                if (fullResBtn) (fullResBtn as HTMLElement).style.display = '';
            } else {
                assets.meshBlob = meshData.blob;
                // Extract proxy blob in background so it survives re-export
                if (contentInfo.hasMeshProxy && proxyEntry) {
                    archiveLoader.extractFile(proxyEntry.file_name).then((proxyData: any) => {
                        if (proxyData) assets.proxyMeshBlob = proxyData.blob;
                    }).catch(() => {});
                }
            }
            // Detect mesh format from archive filename
            state.meshFormat = meshEntry.file_name.split('.').pop()?.toLowerCase() || 'glb';
            state.assetStates[assetType] = ASSET_STATE.LOADED;
            updatePronomRegistry(state);
            return true;

        } else if (assetType === 'pointcloud') {
            const contentInfo = archiveLoader.getContentInfo();
            if (!contentInfo.hasPointcloud) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return false;
            }
            const pointcloudEntry = archiveLoader.getPointcloudEntry();
            if (!pointcloudEntry) { state.assetStates[assetType] = ASSET_STATE.UNLOADED; return false; }
            const pcData = await archiveLoader.extractFile(pointcloudEntry.file_name);
            if (!pcData) { state.assetStates[assetType] = ASSET_STATE.ERROR; return false; }
            const result = await loadPointcloudFromBlobUrlHandler(pcData.url, pointcloudEntry.file_name, { pointcloudGroup: sceneRefs.pointcloudGroup });
            state.pointcloudLoaded = true;
            // Apply transform
            const transform = archiveLoader.getEntryTransform(pointcloudEntry);
            const pointcloudGroup = sceneRefs.pointcloudGroup;
            const ps = normalizeScale(transform.scale);
            if (pointcloudGroup && (transform.position.some((v: number) => v !== 0) || transform.rotation.some((v: number) => v !== 0) || ps.some(v => v !== 1))) {
                pointcloudGroup.position.fromArray(transform.position);
                pointcloudGroup.rotation.set(...transform.rotation);
                pointcloudGroup.scale.set(...ps);
            }
            document.getElementById('pointcloud-filename')!.textContent = pointcloudEntry.file_name.split('/').pop()!;
            document.getElementById('pointcloud-points')!.textContent = result.pointCount.toLocaleString();
            assets.pointcloudBlob = pcData.blob;
            // Detect point cloud format from archive filename
            state.pointcloudFormat = pointcloudEntry.file_name.split('.').pop()?.toLowerCase() || 'e57';
            state.assetStates[assetType] = ASSET_STATE.LOADED;
            updatePronomRegistry(state);
            return true;

        } else if (assetType === 'drawing') {
            const contentInfo = archiveLoader.getContentInfo();
            if (!contentInfo.hasDrawing) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return false;
            }
            const drawingEntry = archiveLoader.getDrawingEntry();
            if (!drawingEntry) { state.assetStates[assetType] = ASSET_STATE.UNLOADED; return false; }
            const drawingData = await archiveLoader.extractFile(drawingEntry.file_name);
            if (!drawingData) { state.assetStates[assetType] = ASSET_STATE.ERROR; return false; }
            await loadDrawingFromBlobUrlHandler(drawingData.url, drawingEntry.file_name, { drawingGroup: sceneRefs.drawingGroup, state });
            // Apply transform
            const transform = archiveLoader.getEntryTransform(drawingEntry);
            const drawingGroup = sceneRefs.drawingGroup;
            const ds = normalizeScale(transform.scale);
            if (drawingGroup && (transform.position.some((v: number) => v !== 0) || transform.rotation.some((v: number) => v !== 0) || ds.some(v => v !== 1))) {
                drawingGroup.position.fromArray(transform.position);
                drawingGroup.rotation.set(...transform.rotation);
                drawingGroup.scale.set(...ds);
            }
            document.getElementById('drawing-filename')!.textContent = drawingEntry.file_name.split('/').pop()!;
            state.assetStates[assetType] = ASSET_STATE.LOADED;
            return true;

        } else if (assetType === 'cad') {
            const contentInfo = archiveLoader.getContentInfo();
            if (!contentInfo.hasCAD) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return false;
            }
            const cadEntry = archiveLoader.getCADEntry();
            if (!cadEntry) { state.assetStates[assetType] = ASSET_STATE.UNLOADED; return false; }
            const cadData = await archiveLoader.extractFile(cadEntry.file_name);
            if (!cadData) { state.assetStates[assetType] = ASSET_STATE.ERROR; return false; }
            await loadCADFromBlobUrl(cadData.url, cadEntry.file_name, { cadGroup: sceneRefs.cadGroup, state });
            state.cadLoaded = true;
            // Apply transform
            const cadTransform = archiveLoader.getEntryTransform(cadEntry);
            const cadGroup = sceneRefs.cadGroup;
            const cs = normalizeScale(cadTransform.scale);
            if (cadGroup && (cadTransform.position.some((v: number) => v !== 0) || cadTransform.rotation.some((v: number) => v !== 0) || cs.some(v => v !== 1))) {
                cadGroup.position.fromArray(cadTransform.position);
                cadGroup.rotation.set(...cadTransform.rotation);
                cadGroup.scale.set(...cs);
            }
            document.getElementById('cad-filename')!.textContent = cadEntry.file_name.split('/').pop()!;
            const cadStore = getStore();
            cadStore.cadFileName = cadEntry.original_name || cadEntry.file_name.split('/').pop() || cadEntry.file_name;
            cadStore.cadBlob = cadData.blob;
            state.assetStates[assetType] = ASSET_STATE.LOADED;
            return true;
        }

        return false;
    } catch (e: any) {
        log.error(`Error loading ${assetType} from archive:`, e);
        state.assetStates[assetType] = ASSET_STATE.ERROR;
        return false;
    } finally {
        deps.ui.hideInlineLoading(assetType);
    }
}

/**
 * Process loaded archive — phased lazy loading.
 */
export async function processArchive(archiveLoader: any, archiveName: string, deps: ArchivePipelineDeps): Promise<void> {
    const { state } = deps;
    const assets = getStore();

    deps.ui.showLoading('Parsing manifest...');

    try {
        // === Phase 1: Manifest + metadata (fast, no 3D decompression) ===
        const manifest = await archiveLoader.parseManifest();
        log.info(' Archive manifest:', manifest);

        state.archiveLoader = archiveLoader;
        state.archiveManifest = manifest;
        state.archiveFileName = archiveName;
        state.archiveLoaded = true;
        // Reset asset states for new archive
        state.assetStates = { splat: ASSET_STATE.UNLOADED, mesh: ASSET_STATE.UNLOADED, pointcloud: ASSET_STATE.UNLOADED, cad: ASSET_STATE.UNLOADED };

        // Prefill metadata panel from loaded archive
        deps.metadata.prefillMetadataFromArchive(manifest);

        const contentInfo = archiveLoader.getContentInfo();

        // Populate proxy filenames in the file menu (even when loading at HD quality)
        if (contentInfo.hasMeshProxy) {
            const proxyMeshEntry = archiveLoader.getMeshProxyEntry();
            if (proxyMeshEntry) {
                const proxyFilenameEl = document.getElementById('proxy-mesh-filename');
                if (proxyFilenameEl) proxyFilenameEl.textContent = proxyMeshEntry.file_name.split('/').pop() || proxyMeshEntry.file_name;
            }
        }
        if (contentInfo.hasSceneProxy) {
            const proxySplatEntry = archiveLoader.getSceneProxyEntry();
            if (proxySplatEntry) {
                const proxyFilenameEl = document.getElementById('proxy-splat-filename');
                if (proxyFilenameEl) proxyFilenameEl.textContent = proxySplatEntry.file_name.split('/').pop() || proxySplatEntry.file_name;
            }
        }

        // Update archive metadata UI
        updateArchiveMetadataUI(manifest, archiveLoader);

        // Check for global alignment data
        const globalAlignment = archiveLoader.getGlobalAlignment();

        // Load annotations from archive
        const annotations = archiveLoader.getAnnotations();

        // Populate source files list from archive manifest (metadata only).
        // Blobs are re-extracted on demand at export time via archiveLoader.extractFile().
        // releaseRawData() is skipped when source files exist so extraction stays possible.
        const archiveSourceEntries = archiveLoader.getSourceFileEntries();
        if (archiveSourceEntries.length > 0) {
            for (const { entry } of archiveSourceEntries) {
                assets.sourceFiles.push({
                    file: null,
                    name: entry.original_name || entry.file_name.split('/').pop(),
                    size: entry.size_bytes || 0,
                    category: entry.source_category || '',
                    fromArchive: true
                });
            }
            deps.sourceFiles.updateSourceFilesUI();
            log.info(` Found ${archiveSourceEntries.length} source files in archive manifest`);
        }

        // === Phase 2: Load primary asset for current display mode ===
        // Moved BEFORE image extraction — get 3D content on screen first.
        const primaryType = getPrimaryAssetType(state.displayMode, contentInfo);
        deps.ui.showLoading(`Loading ${primaryType} from archive...`);
        const primaryLoaded = await ensureAssetLoaded(primaryType, deps);

        if (!primaryLoaded) {
            // Try loading any available asset
            const fallbackTypes = ['splat', 'mesh', 'pointcloud', 'drawing', 'cad'].filter(t => t !== primaryType);
            let anyLoaded = false;
            for (const type of fallbackTypes) {
                deps.ui.showLoading(`Loading ${type} from archive...`);
                if (await ensureAssetLoaded(type, deps)) {
                    anyLoaded = true;
                    break;
                }
            }
            if (!anyLoaded) {
                deps.ui.hideLoading();
                notify.warning('Archive does not contain any viewable splat, mesh, or point cloud files.');
                return;
            }
        }

        // Apply global alignment after primary asset is loaded
        if (globalAlignment) {
            deps.alignment.applyAlignmentData(globalAlignment);
        }

        // Update UI
        deps.ui.updateTransformInputs();
        deps.alignment.storeLastPositions();

        // Load annotations
        if (annotations && annotations.length > 0) {
            deps.annotations.loadAnnotationsFromArchive(annotations);
        }

        // Load walkthrough
        const walkthroughData = archiveLoader.getWalkthrough();
        if (walkthroughData) {
            loadWalkthroughFromArchive(walkthroughData);
        }

        deps.ui.hideLoading();

        // Apply viewer settings from manifest
        if (manifest.viewer_settings) {
            applyViewerSettings(manifest.viewer_settings, deps);
        }

        // Show quality toggle if archive has any proxies
        const contentInfoFinal = archiveLoader.getContentInfo();
        if (hasAnyProxy(contentInfoFinal)) {
            document.getElementById('quality-toggle-container')?.classList.remove('hidden');
        }

        // Extract embedded images for markdown rendering (deferred — not needed for initial render).
        // Runs in parallel with Phase 3 background loading below.
        const imageEntries = archiveLoader.getImageEntries();
        if (imageEntries.length > 0) {
            state.imageAssets.clear();
            Promise.all(imageEntries.map(async (entry: any) => {
                try {
                    const data = await archiveLoader.extractFile(entry.file_name);
                    if (data) {
                        state.imageAssets.set(entry.file_name, { blob: data.blob, url: data.url, name: entry.file_name });
                    }
                } catch (e: any) {
                    log.warn('Failed to extract image:', entry.file_name, e.message);
                }
            })).then(() => {
                log.info(`Extracted ${state.imageAssets.size} embedded images`);
            });
        }

        // === Phase 3: Background-load remaining assets (in parallel) ===
        const remainingTypes = ['splat', 'mesh', 'pointcloud', 'drawing', 'cad'].filter(
            t => t !== primaryType && state.assetStates[t] === ASSET_STATE.UNLOADED
        );
        if (remainingTypes.length > 0) {
            setTimeout(async () => {
                const typesToLoad = remainingTypes.filter(type =>
                    (type === 'splat' && contentInfo.hasSplat) ||
                    (type === 'mesh' && contentInfo.hasMesh) ||
                    (type === 'pointcloud' && contentInfo.hasPointcloud) ||
                    (type === 'drawing' && contentInfo.hasDrawing) ||
                    (type === 'cad' && contentInfo.hasCAD)
                );
                await Promise.all(typesToLoad.map(async (type) => {
                    log.info(`Background loading: ${type}`);
                    await ensureAssetLoaded(type, deps);
                    deps.ui.updateTransformInputs();
                    // Re-apply viewer settings to newly loaded meshes
                    if (type === 'mesh' && manifest.viewer_settings) {
                        applyViewerSettings(manifest.viewer_settings, deps);
                    }
                }));
                // Release raw ZIP data after all assets are extracted,
                // but keep it if archive has source files (needed for re-export)
                // or proxies (needed for on-demand quality switching).
                // For file-based archives, _file is just a File handle — no memory cost.
                const hasProxies = hasAnyProxy(contentInfoFinal);
                if (!archiveLoader.hasSourceFiles() && !hasProxies) {
                    archiveLoader.releaseRawData();
                    log.info('All archive assets loaded, raw data released');
                } else {
                    log.info(`All archive assets loaded, raw data retained (source files: ${archiveLoader.hasSourceFiles()}, proxies: ${hasProxies})`);
                }
            }, 100);
        } else {
            const hasProxiesElse = hasAnyProxy(contentInfoFinal);
            if (!archiveLoader.hasSourceFiles() && !hasProxiesElse) {
                archiveLoader.releaseRawData();
            } else {
                log.info(`Raw data retained (source files: ${archiveLoader.hasSourceFiles()}, proxies: ${hasProxiesElse})`);
            }
        }
    } catch (error: any) {
        log.error(' Error processing archive:', error);
        deps.ui.hideLoading();
        notify.error('Error processing archive: ' + error.message);
    }
}

/**
 * Apply viewer settings from manifest to scene and materials.
 */
export function applyViewerSettings(settings: any, deps: ArchivePipelineDeps): void {
    if (!settings) return;

    const { sceneRefs } = deps;

    // Material side
    if (settings.single_sided !== undefined) {
        const side = settings.single_sided ? THREE.FrontSide : THREE.DoubleSide;
        const modelGroup = sceneRefs.modelGroup;
        if (modelGroup) {
            modelGroup.traverse((child: any) => {
                if (child.isMesh && child.material) {
                    const mats = Array.isArray(child.material) ? child.material : [child.material];
                    mats.forEach((m: any) => { m.side = side; m.needsUpdate = true; });
                }
            });
        }
        // Sync sidebar checkbox
        const el = document.getElementById('meta-viewer-single-sided') as HTMLInputElement | null;
        if (el) el.checked = settings.single_sided;
    }

    // Background color
    if (settings.background_color) {
        if (sceneRefs.scene) sceneRefs.scene.background = new THREE.Color(settings.background_color);
        // Sync sidebar color input
        const colorEl = document.getElementById('meta-viewer-bg-color') as HTMLInputElement | null;
        if (colorEl) colorEl.value = settings.background_color;
        const hexLabel = document.getElementById('meta-viewer-bg-color-hex');
        if (hexLabel) hexLabel.textContent = settings.background_color;
    }

    // Apply saved camera position and target
    if (settings.camera_position && settings.camera_target) {
        const cp = settings.camera_position;
        const ct = settings.camera_target;
        const camera = sceneRefs.camera;
        const controls = sceneRefs.controls;
        if (camera && controls) {
            camera.position.set(cp.x, cp.y, cp.z);
            controls.target.set(ct.x, ct.y, ct.z);
            controls.update();
        }
    }

    log.info('Applied viewer settings:', settings);
}

/**
 * Clear archive metadata when loading new files.
 */
export function clearArchiveMetadata(deps: ArchivePipelineDeps): void {
    const { state } = deps;
    const assets = getStore();

    state.archiveLoaded = false;
    state.archiveManifest = null;
    state.archiveFileName = null;
    state.currentArchiveUrl = null;

    if (state.archiveLoader) {
        state.archiveLoader.dispose();
        state.archiveLoader = null;
    }

    // Delegate DOM cleanup to metadata-manager.js
    deps.metadata.clearArchiveMetadataHandler();

    const section = document.getElementById('archive-metadata-section');
    if (section) section.style.display = 'none';

    // Clear source files from previous archive
    assets.sourceFiles = [];
    deps.sourceFiles.updateSourceFilesUI();
}

/**
 * Switch quality tier (SD/HD) for archive assets.
 */
export async function switchQualityTier(newTier: string, deps: ArchivePipelineDeps): Promise<void> {
    const { state } = deps;
    const assets = getStore();

    if (newTier === state.qualityResolved) return;
    state.qualityResolved = newTier;

    // Update button states
    document.querySelectorAll('.quality-toggle-btn').forEach((btn: Element) => {
        btn.classList.toggle('active', (btn as HTMLElement).dataset.tier === newTier);
        btn.classList.add('loading');
    });

    const archiveLoader = state.archiveLoader;
    if (!archiveLoader) return;

    const contentInfo = archiveLoader.getContentInfo();
    const fileHandlerDeps = deps.createFileHandlerDeps();

    try {
        if (contentInfo.hasSceneProxy) {
            if (newTier === 'hd') {
                await loadArchiveFullResSplat(archiveLoader, fileHandlerDeps);
            } else {
                await loadArchiveProxySplat(archiveLoader, fileHandlerDeps);
            }
        }
        if (contentInfo.hasMeshProxy) {
            if (newTier === 'hd') {
                const result = await loadArchiveFullResMesh(archiveLoader, fileHandlerDeps);
                if (result.loaded) {
                    assets.meshBlob = result.blob;
                    state.viewingProxy = false;
                    document.getElementById('proxy-mesh-indicator')?.classList.add('hidden');
                }
            } else {
                await loadArchiveProxyMesh(archiveLoader, fileHandlerDeps);
                state.viewingProxy = true;
                document.getElementById('proxy-mesh-indicator')?.classList.remove('hidden');
            }
        }
        deps.ui.updateVisibility();
        log.info(`Quality tier switched to ${newTier}`);
    } catch (e: any) {
        log.error('Error switching quality tier:', e);
        notify.error(`Failed to switch quality: ${e.message}`);
    } finally {
        document.querySelectorAll('.quality-toggle-btn').forEach((btn: Element) => {
            btn.classList.remove('loading');
        });
    }
}

/**
 * Handle "Load Full Res Mesh" button click.
 */
export async function handleLoadFullResMesh(deps: ArchivePipelineDeps): Promise<void> {
    const { state } = deps;
    const assets = getStore();

    const archiveLoader = state.archiveLoader;
    if (!archiveLoader) {
        notify.error('No archive loaded');
        return;
    }

    deps.ui.showLoading('Loading full resolution mesh...');
    try {
        const result = await loadArchiveFullResMesh(archiveLoader, deps.createFileHandlerDeps());
        if (result.loaded) {
            assets.meshBlob = result.blob;
            state.viewingProxy = false;
            document.getElementById('model-faces')!.textContent = (result.faceCount || 0).toLocaleString();
            // Hide proxy indicator and Load Full Res button
            document.getElementById('proxy-mesh-indicator')?.classList.add('hidden');
            const fullResBtn = document.getElementById('btn-load-full-res');
            if (fullResBtn) (fullResBtn as HTMLElement).style.display = 'none';
            deps.ui.updateModelOpacity();
            deps.ui.updateModelWireframe();
            deps.ui.updateVisibility();
            notify.success('Full resolution mesh loaded');
        } else {
            notify.error(result.error || 'Failed to load full resolution mesh');
        }
        deps.ui.hideLoading();
    } catch (error: any) {
        log.error('Error loading full resolution mesh:', error);
        deps.ui.hideLoading();
        notify.error('Error loading full resolution mesh: ' + error.message);
    }
}
