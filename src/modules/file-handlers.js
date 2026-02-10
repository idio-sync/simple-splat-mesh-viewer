/**
 * File Handlers Module
 *
 * Handles loading of 3D assets:
 * - Gaussian splat files (via Spark SplatMesh)
 * - 3D models (GLTF, GLB, OBJ)
 * - Archive containers (.a3d/.a3z)
 * - URL-based loading
 * - Blob management
 */

import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OBJLoader } from 'three/addons/loaders/OBJLoader.js';
import { MTLLoader } from 'three/addons/loaders/MTLLoader.js';
import { SplatMesh } from '@sparkjsdev/spark';
import { ArchiveLoader } from './archive-loader.js';
import { TIMING, ASSET_STATE } from './constants.js';
// E57Loader is loaded lazily via dynamic import to allow graceful degradation
// when the three-e57-loader CDN module is unavailable (e.g., offline kiosk viewer).
import { Logger, notify, processMeshMaterials, computeMeshFaceCount, computeMeshVertexCount, disposeObject, fetchWithProgress } from './utilities.js';

// Lazy-loaded E57 support
let _E57Loader = null;
let _e57Checked = false;

/**
 * Lazily load the E57Loader. Returns null if unavailable (e.g., offline).
 * @returns {Promise<Function|null>}
 */
async function getE57Loader() {
    if (_e57Checked) return _E57Loader;
    _e57Checked = true;
    try {
        const mod = await import('three-e57-loader');
        _E57Loader = mod.E57Loader;
        log.info('E57 loader available');
    } catch (e) {
        log.warn('E57 loader not available:', e.message);
        _E57Loader = null;
    }
    return _E57Loader;
}

const log = Logger.getLogger('file-handlers');

// =============================================================================
// URL VALIDATION
// =============================================================================

/**
 * Validates a URL to prevent loading from untrusted sources.
 * @param {string} urlString - The URL string to validate
 * @param {string} resourceType - Type of resource (for error messages)
 * @param {Array<string>} allowedDomains - List of allowed external domains
 * @returns {{valid: boolean, url: string, error: string}}
 */
export function validateUserUrl(urlString, resourceType, allowedDomains = []) {
    if (!urlString || urlString.trim() === '') {
        return { valid: false, url: '', error: 'URL is empty' };
    }

    try {
        const url = new URL(urlString.trim(), window.location.origin);

        // Block dangerous protocols
        const allowedProtocols = ['http:', 'https:'];
        if (!allowedProtocols.includes(url.protocol)) {
            return {
                valid: false,
                url: '',
                error: `Unsafe protocol "${url.protocol}" is not allowed. Use http: or https:`
            };
        }

        // Check if same-origin
        const isSameOrigin = url.origin === window.location.origin;

        // Check if domain is in allowed list
        const isAllowedExternal = allowedDomains.some(domain => {
            if (domain.startsWith('*.')) {
                const baseDomain = domain.slice(2);
                return url.hostname === baseDomain || url.hostname.endsWith('.' + baseDomain);
            }
            return url.hostname === domain;
        });

        if (!isSameOrigin && !isAllowedExternal) {
            return {
                valid: false,
                url: '',
                error: `External domain "${url.hostname}" is not allowed.\n\nOnly same-origin URLs are permitted by default.`
            };
        }

        // Enforce HTTPS for external URLs when page is served over HTTPS
        if (!isSameOrigin && window.location.protocol === 'https:' && url.protocol !== 'https:') {
            return {
                valid: false,
                url: '',
                error: 'External URLs must use HTTPS when the viewer is served over HTTPS.'
            };
        }

        log.info(`Validated ${resourceType} URL:`, url.href);
        return { valid: true, url: url.href, error: '' };

    } catch (e) {
        return {
            valid: false,
            url: '',
            error: `Invalid URL format: ${e.message}`
        };
    }
}

// =============================================================================
// SPLAT LOADING
// =============================================================================

/**
 * Load splat from a file
 * @param {File} file - The splat file
 * @param {Object} deps - Dependencies
 * @returns {Promise<Object>} The loaded splat mesh
 */
export async function loadSplatFromFile(file, deps) {
    const { scene, getSplatMesh, setSplatMesh, state, archiveCreator, callbacks } = deps;

    // Remove existing splat
    const existingSplat = getSplatMesh();
    if (existingSplat) {
        scene.remove(existingSplat);
        if (existingSplat.dispose) existingSplat.dispose();
        setSplatMesh(null);
    }

    // Create object URL for the file
    const fileUrl = URL.createObjectURL(file);

    // Create SplatMesh using Spark
    const splatMesh = new SplatMesh({ url: fileUrl });

    // Apply default rotation to correct upside-down orientation
    splatMesh.rotation.x = Math.PI;

    // Verify SplatMesh is a valid THREE.Object3D
    if (!(splatMesh instanceof THREE.Object3D)) {
        log.warn('WARNING: SplatMesh is not an instance of THREE.Object3D!');
        log.warn('This may indicate multiple THREE.js instances are loaded.');
    }

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, TIMING.SPLAT_LOAD_DELAY));

    try {
        scene.add(splatMesh);
    } catch (addError) {
        log.error('Error adding splatMesh to scene:', addError);
        throw addError;
    }

    // Clean up URL after a delay
    setTimeout(() => URL.revokeObjectURL(fileUrl), TIMING.BLOB_REVOKE_DELAY);

    // Update state
    setSplatMesh(splatMesh);
    state.splatLoaded = true;
    state.currentSplatUrl = null; // Local files cannot be shared

    // Pre-compute hash in background
    if (archiveCreator) {
        archiveCreator.precomputeHash(file).catch(e => {
            log.warn('Background hash precompute failed:', e);
        });
    }

    // Call callbacks
    if (callbacks.onSplatLoaded) {
        callbacks.onSplatLoaded(splatMesh, file);
    }

    return splatMesh;
}

/**
 * Load splat from a URL
 * @param {string} url - The splat URL
 * @param {Object} deps - Dependencies
 * @returns {Promise<Object>} The loaded splat mesh
 */
export async function loadSplatFromUrl(url, deps, onProgress = null) {
    const { scene, getSplatMesh, setSplatMesh, state, archiveCreator, callbacks } = deps;

    log.info('Fetching splat from URL:', url);
    const blob = await fetchWithProgress(url, onProgress);
    log.info('Splat blob fetched, size:', blob.size);

    // Pre-compute hash in background
    if (archiveCreator) {
        archiveCreator.precomputeHash(blob).catch(e => {
            log.warn('Background hash precompute failed:', e);
        });
    }

    // Create blob URL for loading
    const blobUrl = URL.createObjectURL(blob);

    // Remove existing splat
    const existingSplat = getSplatMesh();
    if (existingSplat) {
        scene.remove(existingSplat);
        if (existingSplat.dispose) existingSplat.dispose();
        setSplatMesh(null);
    }

    // Create SplatMesh using Spark
    const splatMesh = new SplatMesh({ url: blobUrl });

    // Apply default rotation
    splatMesh.rotation.x = Math.PI;

    // Verify SplatMesh
    if (!(splatMesh instanceof THREE.Object3D)) {
        log.warn('WARNING: SplatMesh is not an instance of THREE.Object3D!');
    }

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, TIMING.SPLAT_LOAD_DELAY));

    try {
        scene.add(splatMesh);
    } catch (addError) {
        log.error('Error adding splatMesh to scene:', addError);
        throw addError;
    }

    // Update state
    setSplatMesh(splatMesh);
    state.splatLoaded = true;
    state.currentSplatUrl = url;

    // Call callbacks
    if (callbacks.onSplatLoaded) {
        callbacks.onSplatLoaded(splatMesh, blob);
    }

    return splatMesh;
}

/**
 * Load splat from a blob URL (used by archive loader)
 * @param {string} blobUrl - The blob URL
 * @param {string} fileName - Original filename
 * @param {Object} deps - Dependencies
 * @returns {Promise<Object>} The loaded splat mesh
 */
export async function loadSplatFromBlobUrl(blobUrl, fileName, deps) {
    const { scene, getSplatMesh, setSplatMesh, state } = deps;

    // Remove existing splat
    const existingSplat = getSplatMesh();
    if (existingSplat) {
        scene.remove(existingSplat);
        if (existingSplat.dispose) existingSplat.dispose();
        setSplatMesh(null);
    }

    // Create SplatMesh using Spark
    const splatMesh = new SplatMesh({ url: blobUrl });

    // Apply default rotation
    splatMesh.rotation.x = Math.PI;

    // Verify SplatMesh
    if (!(splatMesh instanceof THREE.Object3D)) {
        log.warn('WARNING: SplatMesh is not an instance of THREE.Object3D!');
    }

    // Wait for initialization
    await new Promise(resolve => setTimeout(resolve, TIMING.SPLAT_LOAD_DELAY));

    try {
        scene.add(splatMesh);
    } catch (addError) {
        log.error('Error adding splatMesh to scene:', addError);
        throw addError;
    }

    // Update state
    setSplatMesh(splatMesh);
    state.splatLoaded = true;

    return splatMesh;
}

// =============================================================================
// MODEL LOADING
// =============================================================================

/**
 * Load GLTF/GLB model
 * @param {File|string} source - File object or URL
 * @returns {Promise<THREE.Group>}
 */
export function loadGLTF(source) {
    return new Promise((resolve, reject) => {
        const loader = new GLTFLoader();
        const url = source instanceof File ? URL.createObjectURL(source) : source;
        const isFile = source instanceof File;

        loader.load(
            url,
            (gltf) => {
                if (isFile) URL.revokeObjectURL(url);
                processMeshMaterials(gltf.scene);
                resolve(gltf.scene);
            },
            undefined,
            (error) => {
                if (isFile) URL.revokeObjectURL(url);
                reject(error);
            }
        );
    });
}

/**
 * Load OBJ model (with optional MTL)
 * @param {File} objFile - The OBJ file
 * @param {File|null} mtlFile - Optional MTL file
 * @returns {Promise<THREE.Group>}
 */
export function loadOBJ(objFile, mtlFile) {
    const objUrl = URL.createObjectURL(objFile);

    return new Promise((resolve, reject) => {
        const objLoader = new OBJLoader();

        if (mtlFile) {
            const mtlUrl = URL.createObjectURL(mtlFile);
            const mtlLoader = new MTLLoader();

            mtlLoader.load(
                mtlUrl,
                (materials) => {
                    materials.preload();
                    objLoader.setMaterials(materials);

                    objLoader.load(
                        objUrl,
                        (object) => {
                            URL.revokeObjectURL(objUrl);
                            URL.revokeObjectURL(mtlUrl);
                            processMeshMaterials(object, { forceDefaultMaterial: true, preserveTextures: true });
                            resolve(object);
                        },
                        undefined,
                        (error) => {
                            URL.revokeObjectURL(objUrl);
                            URL.revokeObjectURL(mtlUrl);
                            reject(error);
                        }
                    );
                },
                undefined,
                () => {
                    URL.revokeObjectURL(mtlUrl);
                    loadOBJWithoutMaterials(objLoader, objUrl, resolve, reject);
                }
            );
        } else {
            loadOBJWithoutMaterials(objLoader, objUrl, resolve, reject);
        }
    });
}

/**
 * Load OBJ without materials
 */
function loadOBJWithoutMaterials(loader, url, resolve, reject) {
    loader.load(
        url,
        (object) => {
            URL.revokeObjectURL(url);
            processMeshMaterials(object, { forceDefaultMaterial: true });
            resolve(object);
        },
        undefined,
        (error) => {
            URL.revokeObjectURL(url);
            reject(error);
        }
    );
}

/**
 * Load OBJ from URL
 * @param {string} url - The URL
 * @returns {Promise<THREE.Group>}
 */
export function loadOBJFromUrl(url) {
    return new Promise((resolve, reject) => {
        const loader = new OBJLoader();
        loader.load(
            url,
            (object) => {
                processMeshMaterials(object, { forceDefaultMaterial: true, preserveTextures: true });
                resolve(object);
            },
            undefined,
            (error) => reject(error)
        );
    });
}

/**
 * Load model from a file
 * @param {FileList} files - The file list (may include MTL)
 * @param {Object} deps - Dependencies
 * @returns {Promise<THREE.Group>}
 */
export async function loadModelFromFile(files, deps) {
    const { modelGroup, state, archiveCreator, callbacks } = deps;
    const mainFile = files[0];

    // Clear existing model
    while (modelGroup.children.length > 0) {
        const child = modelGroup.children[0];
        disposeObject(child);
        modelGroup.remove(child);
    }

    const extension = mainFile.name.split('.').pop().toLowerCase();
    let loadedObject;

    if (extension === 'glb' || extension === 'gltf') {
        loadedObject = await loadGLTF(mainFile);
    } else if (extension === 'obj') {
        let mtlFile = null;
        for (const f of files) {
            if (f.name.toLowerCase().endsWith('.mtl')) {
                mtlFile = f;
                break;
            }
        }
        loadedObject = await loadOBJ(mainFile, mtlFile);
    }

    if (loadedObject) {
        modelGroup.add(loadedObject);
        state.modelLoaded = true;
        state.currentModelUrl = null; // Local files cannot be shared

        // Pre-compute hash in background
        if (archiveCreator) {
            archiveCreator.precomputeHash(mainFile).catch(e => {
                log.warn('Background hash precompute failed:', e);
            });
        }

        // Count faces
        const faceCount = computeMeshFaceCount(loadedObject);

        // Call callbacks
        if (callbacks.onModelLoaded) {
            callbacks.onModelLoaded(loadedObject, mainFile, faceCount);
        }
    }

    return loadedObject;
}

/**
 * Load model from URL
 * @param {string} url - The model URL
 * @param {Object} deps - Dependencies
 * @returns {Promise<THREE.Group>}
 */
export async function loadModelFromUrl(url, deps, onProgress = null) {
    const { modelGroup, state, archiveCreator, callbacks } = deps;

    log.info('Fetching model from URL:', url);
    const blob = await fetchWithProgress(url, onProgress);
    log.info('Mesh blob fetched, size:', blob.size);

    // Pre-compute hash in background
    if (archiveCreator) {
        archiveCreator.precomputeHash(blob).catch(e => {
            log.warn('Background hash precompute failed:', e);
        });
    }

    // Create blob URL for loading
    const blobUrl = URL.createObjectURL(blob);

    // Clear existing model
    while (modelGroup.children.length > 0) {
        const child = modelGroup.children[0];
        disposeObject(child);
        modelGroup.remove(child);
    }

    const extension = url.split('.').pop().toLowerCase().split('?')[0];
    let loadedObject;

    if (extension === 'glb' || extension === 'gltf') {
        loadedObject = await loadGLTF(blobUrl);
    } else if (extension === 'obj') {
        loadedObject = await loadOBJFromUrl(blobUrl);
    }

    if (loadedObject) {
        modelGroup.add(loadedObject);
        state.modelLoaded = true;
        state.currentModelUrl = url;

        // Count faces and vertices
        const faceCount = computeMeshFaceCount(loadedObject);
        state.meshVertexCount = computeMeshVertexCount(loadedObject);

        // Call callbacks
        if (callbacks.onModelLoaded) {
            callbacks.onModelLoaded(loadedObject, blob, faceCount);
        }
    }

    return loadedObject;
}

/**
 * Load model from a blob URL (used by archive loader)
 * @param {string} blobUrl - The blob URL
 * @param {string} fileName - Original filename
 * @param {Object} deps - Dependencies
 * @returns {Promise<THREE.Group>}
 */
export async function loadModelFromBlobUrl(blobUrl, fileName, deps) {
    const { modelGroup, state } = deps;

    // Clear existing model
    while (modelGroup.children.length > 0) {
        const child = modelGroup.children[0];
        disposeObject(child);
        modelGroup.remove(child);
    }

    const extension = fileName.split('.').pop().toLowerCase();
    let loadedObject;

    if (extension === 'glb' || extension === 'gltf') {
        loadedObject = await loadGLTF(blobUrl);
    } else if (extension === 'obj') {
        loadedObject = await loadOBJFromUrl(blobUrl);
    }

    if (loadedObject) {
        modelGroup.add(loadedObject);
        state.modelLoaded = true;

        // Count faces
        const faceCount = computeMeshFaceCount(loadedObject);

        return { object: loadedObject, faceCount };
    }

    return { object: loadedObject, faceCount: 0 };
}

// =============================================================================
// ARCHIVE LOADING
// =============================================================================

/**
 * Load archive from a file
 * @param {File} file - The archive file
 * @param {Object} deps - Dependencies
 * @returns {Promise<Object>} Archive loader and manifest
 */
export async function loadArchiveFromFile(file, deps) {
    const { state } = deps;

    // Clean up previous archive
    if (state.archiveLoader) {
        state.archiveLoader.dispose();
    }

    const archiveLoader = new ArchiveLoader();
    await archiveLoader.loadFromFile(file);

    state.currentArchiveUrl = null; // Local files cannot be shared

    return archiveLoader;
}

/**
 * Load archive from URL
 * @param {string} url - The archive URL
 * @param {Object} deps - Dependencies
 * @param {Function} onProgress - Progress callback
 * @returns {Promise<Object>} Archive loader
 */
export async function loadArchiveFromUrl(url, deps, onProgress = null) {
    const { state } = deps;

    // Clean up previous archive
    if (state.archiveLoader) {
        state.archiveLoader.dispose();
    }

    const archiveLoader = new ArchiveLoader();
    await archiveLoader.loadFromUrl(url, onProgress);

    state.currentArchiveUrl = url;

    return archiveLoader;
}

/**
 * Process loaded archive - extract and load splat/mesh
 * @param {ArchiveLoader} archiveLoader - The archive loader
 * @param {string} archiveName - Archive filename
 * @param {Object} deps - Dependencies
 * @returns {Promise<Object>} Processing results
 */
export async function processArchive(archiveLoader, archiveName, deps) {
    const { state, callbacks } = deps;

    const manifest = await archiveLoader.parseManifest();
    log.info('Archive manifest:', manifest);

    state.archiveLoader = archiveLoader;
    state.archiveManifest = manifest;
    state.archiveFileName = archiveName;
    state.archiveLoaded = true;

    const contentInfo = archiveLoader.getContentInfo();
    const errors = [];
    let loadedSplat = false;
    let loadedMesh = false;
    let splatBlob = null;
    let meshBlob = null;

    // Load splat (scene_0) if present
    const sceneEntry = archiveLoader.getSceneEntry();
    if (sceneEntry && contentInfo.hasSplat) {
        try {
            const splatData = await archiveLoader.extractFile(sceneEntry.file_name);
            if (splatData) {
                await loadSplatFromBlobUrl(splatData.url, sceneEntry.file_name, deps);
                loadedSplat = true;
                splatBlob = splatData.blob;

                // Apply transform from entry parameters if present
                const transform = archiveLoader.getEntryTransform(sceneEntry);
                if (callbacks.onApplySplatTransform) {
                    callbacks.onApplySplatTransform(transform);
                }
            }
        } catch (e) {
            errors.push(`Failed to load splat: ${e.message}`);
            log.error('Error loading splat from archive:', e);
        }
    }

    // Load mesh (mesh_0) if present
    const meshEntry = archiveLoader.getMeshEntry();
    if (meshEntry && contentInfo.hasMesh) {
        try {
            const meshData = await archiveLoader.extractFile(meshEntry.file_name);
            if (meshData) {
                const result = await loadModelFromBlobUrl(meshData.url, meshEntry.file_name, deps);
                loadedMesh = true;
                meshBlob = meshData.blob;

                // Apply transform from entry parameters if present
                const transform = archiveLoader.getEntryTransform(meshEntry);
                if (callbacks.onApplyModelTransform) {
                    callbacks.onApplyModelTransform(transform);
                }
            }
        } catch (e) {
            errors.push(`Failed to load mesh: ${e.message}`);
            log.error('Error loading mesh from archive:', e);
        }
    }

    // Get global alignment data
    const globalAlignment = archiveLoader.getGlobalAlignment();

    // Get annotations
    const annotations = archiveLoader.getAnnotations();

    return {
        manifest,
        archiveLoader,
        loadedSplat,
        loadedMesh,
        splatBlob,
        meshBlob,
        errors,
        globalAlignment,
        annotations
    };
}

// =============================================================================
// PHASED ARCHIVE PROCESSING (Lazy Loading)
// =============================================================================

/**
 * Phase 1: Fast archive processing — manifest + metadata only, no 3D asset decompression.
 * Typically completes in ~50ms. Extracts thumbnail if present.
 * @param {ArchiveLoader} archiveLoader - The archive loader (already loaded)
 * @param {string} archiveName - Archive filename
 * @param {Object} deps - Dependencies { state }
 * @returns {Promise<Object>} { manifest, contentInfo, thumbnailUrl }
 */
export async function processArchivePhase1(archiveLoader, archiveName, deps) {
    const { state } = deps;

    const manifest = await archiveLoader.parseManifest();
    log.info('Phase 1 — manifest parsed:', manifest);

    state.archiveLoader = archiveLoader;
    state.archiveManifest = manifest;
    state.archiveFileName = archiveName;
    state.archiveLoaded = true;

    const contentInfo = archiveLoader.getContentInfo();

    // Extract thumbnail (small file, fast)
    let thumbnailUrl = null;
    const thumbnailEntry = archiveLoader.getThumbnailEntry();
    if (thumbnailEntry) {
        try {
            const thumbData = await archiveLoader.extractFile(thumbnailEntry.file_name);
            if (thumbData) {
                thumbnailUrl = thumbData.url;
            }
        } catch (e) {
            log.warn('Failed to extract thumbnail:', e.message);
        }
    }

    return { manifest, contentInfo, thumbnailUrl };
}

/**
 * Load a single archive asset type on demand.
 * @param {ArchiveLoader} archiveLoader - The archive loader
 * @param {'splat'|'mesh'|'pointcloud'} assetType - Which asset to load
 * @param {Object} deps - Dependencies { state, scene, getSplatMesh, setSplatMesh, modelGroup, pointcloudGroup, callbacks }
 * @returns {Promise<Object>} { loaded, blob, error, faceCount?, pointCount? }
 */
export async function loadArchiveAsset(archiveLoader, assetType, deps) {
    const { state, callbacks = {} } = deps;

    // Initialize assetStates if not present
    if (!state.assetStates) {
        state.assetStates = { splat: ASSET_STATE.UNLOADED, mesh: ASSET_STATE.UNLOADED, pointcloud: ASSET_STATE.UNLOADED };
    }

    // Guard against duplicate loads
    if (state.assetStates[assetType] === ASSET_STATE.LOADING) {
        log.warn(`Asset "${assetType}" is already loading, skipping duplicate request`);
        return { loaded: false, blob: null, error: 'Already loading' };
    }
    if (state.assetStates[assetType] === ASSET_STATE.LOADED) {
        log.info(`Asset "${assetType}" already loaded`);
        return { loaded: true, blob: null, error: null };
    }

    state.assetStates[assetType] = ASSET_STATE.LOADING;

    try {
        if (assetType === 'splat') {
            const sceneEntry = archiveLoader.getSceneEntry();
            const contentInfo = archiveLoader.getContentInfo();
            if (!sceneEntry || !contentInfo.hasSplat) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return { loaded: false, blob: null, error: 'No splat in archive' };
            }

            const splatData = await archiveLoader.extractFile(sceneEntry.file_name);
            if (!splatData) {
                state.assetStates[assetType] = ASSET_STATE.ERROR;
                return { loaded: false, blob: null, error: 'Failed to extract splat file' };
            }

            await loadSplatFromBlobUrl(splatData.url, sceneEntry.file_name, deps);

            // Apply transform from manifest
            const transform = archiveLoader.getEntryTransform(sceneEntry);
            if (callbacks.onApplySplatTransform) {
                callbacks.onApplySplatTransform(transform);
            }

            state.assetStates[assetType] = ASSET_STATE.LOADED;
            return { loaded: true, blob: splatData.blob, error: null };

        } else if (assetType === 'mesh') {
            const contentInfo = archiveLoader.getContentInfo();
            const meshEntry = archiveLoader.getMeshEntry();
            if (!meshEntry || !contentInfo.hasMesh) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return { loaded: false, blob: null, error: 'No mesh in archive' };
            }

            // Prefer proxy mesh when available
            const proxyEntry = archiveLoader.getMeshProxyEntry();
            const useProxy = contentInfo.hasMeshProxy && proxyEntry;
            const entryToLoad = useProxy ? proxyEntry : meshEntry;

            const meshData = await archiveLoader.extractFile(entryToLoad.file_name);
            if (!meshData) {
                state.assetStates[assetType] = ASSET_STATE.ERROR;
                return { loaded: false, blob: null, error: 'Failed to extract mesh file' };
            }

            const result = await loadModelFromBlobUrl(meshData.url, entryToLoad.file_name, deps);

            // Apply transform from the primary mesh entry (proxy inherits the same transform)
            const transform = archiveLoader.getEntryTransform(meshEntry);
            if (callbacks.onApplyModelTransform) {
                callbacks.onApplyModelTransform(transform);
            }

            state.assetStates[assetType] = ASSET_STATE.LOADED;
            return {
                loaded: true,
                blob: meshData.blob,
                error: null,
                faceCount: result?.faceCount || 0,
                isProxy: !!useProxy
            };

        } else if (assetType === 'pointcloud') {
            const contentInfo = archiveLoader.getContentInfo();
            if (!contentInfo.hasPointcloud) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return { loaded: false, blob: null, error: 'No pointcloud in archive' };
            }

            // Find pointcloud entry
            const pcEntries = archiveLoader.findEntriesByPrefix('pointcloud');
            if (pcEntries.length === 0) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return { loaded: false, blob: null, error: 'No pointcloud entries found' };
            }

            const pcEntry = pcEntries[0];
            const pcData = await archiveLoader.extractFile(pcEntry.file_name);
            if (!pcData) {
                state.assetStates[assetType] = ASSET_STATE.ERROR;
                return { loaded: false, blob: null, error: 'Failed to extract pointcloud file' };
            }

            const result = await loadPointcloudFromBlobUrl(pcData.url, pcEntry.file_name, deps);

            // Apply transform if present
            const transform = archiveLoader.getEntryTransform(pcEntry);
            if (callbacks.onApplyPointcloudTransform) {
                callbacks.onApplyPointcloudTransform(transform);
            }

            state.assetStates[assetType] = ASSET_STATE.LOADED;
            return { loaded: true, blob: pcData.blob, error: null, pointCount: result?.pointCount || 0 };
        }

        return { loaded: false, blob: null, error: `Unknown asset type: ${assetType}` };

    } catch (e) {
        state.assetStates[assetType] = ASSET_STATE.ERROR;
        log.error(`Error loading ${assetType} from archive:`, e);
        return { loaded: false, blob: null, error: e.message };
    }
}

/**
 * Load the full-resolution mesh from an archive, replacing the currently displayed proxy.
 * Clears the existing modelGroup contents before loading.
 * @param {ArchiveLoader} archiveLoader - The archive loader
 * @param {Object} deps - Dependencies { state, modelGroup, callbacks }
 * @returns {Promise<Object>} { loaded, blob, error, faceCount }
 */
export async function loadArchiveFullResMesh(archiveLoader, deps) {
    const { state, callbacks = {} } = deps;
    const meshEntry = archiveLoader.getMeshEntry();
    if (!meshEntry) {
        return { loaded: false, blob: null, error: 'No full-resolution mesh in archive' };
    }

    const meshData = await archiveLoader.extractFile(meshEntry.file_name);
    if (!meshData) {
        return { loaded: false, blob: null, error: 'Failed to extract full-resolution mesh' };
    }

    // Clear existing model (the proxy) before loading
    const { modelGroup } = deps;
    if (modelGroup) {
        while (modelGroup.children.length > 0) {
            const child = modelGroup.children[0];
            modelGroup.remove(child);
            disposeObject(child);
        }
    }

    state.modelLoaded = false;
    const result = await loadModelFromBlobUrl(meshData.url, meshEntry.file_name, deps);

    // Apply transform from manifest
    const transform = archiveLoader.getEntryTransform(meshEntry);
    if (callbacks.onApplyModelTransform) {
        callbacks.onApplyModelTransform(transform);
    }

    state.assetStates.mesh = ASSET_STATE.LOADED;
    return { loaded: true, blob: meshData.blob, error: null, faceCount: result?.faceCount || 0 };
}

/**
 * Determine which asset types are needed for a given display mode.
 * @param {string} mode - Display mode ('splat', 'model', 'both', 'split', 'pointcloud')
 * @returns {string[]} Array of asset type strings
 */
export function getAssetTypesForMode(mode) {
    switch (mode) {
        case 'splat': return ['splat'];
        case 'model': return ['mesh'];
        case 'both': return ['splat', 'mesh'];
        case 'split': return ['splat', 'mesh'];
        case 'pointcloud': return ['pointcloud'];
        default: return ['splat', 'mesh'];
    }
}

/**
 * Determine the primary asset type to load first based on display mode and available content.
 * Priority: splat > mesh > pointcloud (splat gives fastest visual feedback).
 * @param {string} displayMode - Current display mode
 * @param {Object} contentInfo - Content info from archiveLoader.getContentInfo()
 * @returns {string} Primary asset type
 */
export function getPrimaryAssetType(displayMode, contentInfo) {
    const modeTypes = getAssetTypesForMode(displayMode);

    // Try mode-preferred types first
    for (const type of modeTypes) {
        if (type === 'splat' && contentInfo.hasSplat) return 'splat';
        if (type === 'mesh' && contentInfo.hasMesh) return 'mesh';
        if (type === 'pointcloud' && contentInfo.hasPointcloud) return 'pointcloud';
    }

    // Fallback: whatever is available
    if (contentInfo.hasSplat) return 'splat';
    if (contentInfo.hasMesh) return 'mesh';
    if (contentInfo.hasPointcloud) return 'pointcloud';

    return 'splat'; // Default
}

// =============================================================================
// MODEL MATERIAL UPDATES
// =============================================================================

/**
 * Update model opacity
 * @param {THREE.Group} modelGroup - The model group
 * @param {number} opacity - Opacity value (0-1)
 */
export function updateModelOpacity(modelGroup, opacity) {
    if (modelGroup) {
        modelGroup.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    mat.transparent = opacity < 1;
                    mat.opacity = opacity;
                    mat.needsUpdate = true;
                });
            }
        });
    }
}

/**
 * Update model wireframe mode
 * @param {THREE.Group} modelGroup - The model group
 * @param {boolean} wireframe - Wireframe mode
 */
export function updateModelWireframe(modelGroup, wireframe) {
    if (modelGroup) {
        modelGroup.traverse((child) => {
            if (child.isMesh && child.material) {
                const materials = Array.isArray(child.material) ? child.material : [child.material];
                materials.forEach(mat => {
                    mat.wireframe = wireframe;
                    mat.needsUpdate = true;
                });
            }
        });
    }
}

// =============================================================================
// MODEL TEXTURE TOGGLE
// =============================================================================

const _storedTextures = new WeakMap();

/**
 * Toggle model textures on/off
 * @param {THREE.Group} modelGroup - The model group
 * @param {boolean} showTextures - Whether to show textures
 */
export function updateModelTextures(modelGroup, showTextures) {
    if (!modelGroup) return;
    modelGroup.traverse((child) => {
        if (child.isMesh && child.material) {
            const materials = Array.isArray(child.material) ? child.material : [child.material];
            materials.forEach(mat => {
                if (!showTextures) {
                    if (!_storedTextures.has(mat)) {
                        _storedTextures.set(mat, {
                            map: mat.map, normalMap: mat.normalMap,
                            roughnessMap: mat.roughnessMap, metalnessMap: mat.metalnessMap,
                            aoMap: mat.aoMap, emissiveMap: mat.emissiveMap
                        });
                    }
                    mat.map = null;
                    mat.normalMap = null;
                    mat.roughnessMap = null;
                    mat.metalnessMap = null;
                    mat.aoMap = null;
                    mat.emissiveMap = null;
                } else {
                    const stored = _storedTextures.get(mat);
                    if (stored) {
                        mat.map = stored.map;
                        mat.normalMap = stored.normalMap;
                        mat.roughnessMap = stored.roughnessMap;
                        mat.metalnessMap = stored.metalnessMap;
                        mat.aoMap = stored.aoMap;
                        mat.emissiveMap = stored.emissiveMap;
                    }
                }
                mat.needsUpdate = true;
            });
        }
    });
}

// =============================================================================
// E57 POINT CLOUD LOADING
// =============================================================================

/**
 * Load an E57 file and return a THREE.Group containing THREE.Points.
 * E57 files from surveying/scanning use Z-up convention, so we rotate
 * the geometry to Three.js Y-up coordinate system.
 * @param {string} url - URL or blob URL to the E57 file
 * @returns {Promise<THREE.Group>} Group containing the point cloud
 */
export async function loadE57(url) {
    const E57Loader = await getE57Loader();
    if (!E57Loader) {
        throw new Error('E57 point cloud loading is not available. The three-e57-loader module could not be loaded (requires network access).');
    }
    return new Promise((resolve, reject) => {
        const loader = new E57Loader();
        loader.load(
            url,
            (geometry) => {
                // Convert from Z-up (E57/surveying) to Y-up (Three.js)
                geometry.rotateX(-Math.PI / 2);

                const material = new THREE.PointsMaterial({
                    size: 0.01,
                    vertexColors: geometry.hasAttribute('color'),
                    sizeAttenuation: true
                });
                const points = new THREE.Points(geometry, material);
                const group = new THREE.Group();
                group.add(points);
                resolve(group);
            },
            undefined,
            (error) => {
                reject(error);
            }
        );
    });
}

/**
 * Load a point cloud from a File object
 * @param {File} file - The E57 file
 * @param {Object} deps - Dependencies
 */
export async function loadPointcloudFromFile(file, deps) {
    const {
        pointcloudGroup,
        state,
        archiveCreator,
        callbacks = {}
    } = deps;

    log.info('Loading point cloud from file:', file.name);

    // Clear existing pointcloud
    if (pointcloudGroup) {
        while (pointcloudGroup.children.length > 0) {
            const child = pointcloudGroup.children[0];
            disposeObject(child);
            pointcloudGroup.remove(child);
        }
    }

    // Create blob URL
    const fileUrl = URL.createObjectURL(file);

    try {
        const loadedObject = await loadE57(fileUrl);
        pointcloudGroup.add(loadedObject);
        state.pointcloudLoaded = true;

        // Compute point count
        let pointCount = 0;
        loadedObject.traverse((child) => {
            if (child.isPoints && child.geometry) {
                const posAttr = child.geometry.getAttribute('position');
                if (posAttr) pointCount += posAttr.count;
            }
        });

        // Pre-compute hash for archive export
        const blob = file.slice ? file : new Blob([file]);
        if (archiveCreator) {
            archiveCreator.precomputeHash(blob).catch(() => {});
        }

        if (callbacks.onPointcloudLoaded) {
            callbacks.onPointcloudLoaded(loadedObject, file, pointCount, blob);
        }

        log.info('Point cloud loaded:', file.name, 'points:', pointCount);
    } finally {
        URL.revokeObjectURL(fileUrl);
    }
}

/**
 * Load a point cloud from a URL
 * @param {string} url - The URL to the E57 file
 * @param {Object} deps - Dependencies
 * @param {Function} onProgress - Progress callback
 */
export async function loadPointcloudFromUrl(url, deps, onProgress = null) {
    const {
        pointcloudGroup,
        state,
        archiveCreator,
        callbacks = {}
    } = deps;

    log.info('Loading point cloud from URL:', url);

    // Clear existing pointcloud
    if (pointcloudGroup) {
        while (pointcloudGroup.children.length > 0) {
            const child = pointcloudGroup.children[0];
            disposeObject(child);
            pointcloudGroup.remove(child);
        }
    }

    // Fetch with progress
    const blob = await fetchWithProgress(url, onProgress);
    const blobUrl = URL.createObjectURL(blob);

    // Pre-compute hash
    if (archiveCreator) {
        archiveCreator.precomputeHash(blob).catch(() => {});
    }

    try {
        const loadedObject = await loadE57(blobUrl);
        pointcloudGroup.add(loadedObject);
        state.pointcloudLoaded = true;
        state.currentPointcloudUrl = url;

        // Compute point count
        let pointCount = 0;
        loadedObject.traverse((child) => {
            if (child.isPoints && child.geometry) {
                const posAttr = child.geometry.getAttribute('position');
                if (posAttr) pointCount += posAttr.count;
            }
        });

        const fileName = url.split('/').pop() || 'pointcloud.e57';

        if (callbacks.onPointcloudLoaded) {
            callbacks.onPointcloudLoaded(loadedObject, { name: fileName }, pointCount, blob);
        }

        log.info('Point cloud loaded from URL:', url, 'points:', pointCount);
    } finally {
        URL.revokeObjectURL(blobUrl);
    }
}

/**
 * Load a point cloud from a blob URL (used by archive loader)
 * @param {string} blobUrl - The blob URL
 * @param {string} fileName - Original filename
 * @param {Object} deps - Dependencies
 * @returns {Promise<{object: THREE.Group, pointCount: number}>}
 */
export async function loadPointcloudFromBlobUrl(blobUrl, fileName, deps) {
    const { pointcloudGroup } = deps;

    log.info('Loading point cloud from blob URL:', fileName);

    // Clear existing pointcloud
    if (pointcloudGroup) {
        while (pointcloudGroup.children.length > 0) {
            const child = pointcloudGroup.children[0];
            disposeObject(child);
            pointcloudGroup.remove(child);
        }
    }

    const loadedObject = await loadE57(blobUrl);
    pointcloudGroup.add(loadedObject);

    // Compute point count
    let pointCount = 0;
    loadedObject.traverse((child) => {
        if (child.isPoints && child.geometry) {
            const posAttr = child.geometry.getAttribute('position');
            if (posAttr) pointCount += posAttr.count;
        }
    });

    return { object: loadedObject, pointCount };
}

/**
 * Update point cloud point size
 * @param {THREE.Group} pointcloudGroup - The point cloud group
 * @param {number} size - Point size
 */
export function updatePointcloudPointSize(pointcloudGroup, size) {
    if (pointcloudGroup) {
        pointcloudGroup.traverse((child) => {
            if (child.isPoints && child.material) {
                child.material.size = size;
                child.material.needsUpdate = true;
            }
        });
    }
}

/**
 * Update point cloud opacity
 * @param {THREE.Group} pointcloudGroup - The point cloud group
 * @param {number} opacity - Opacity value (0-1)
 */
export function updatePointcloudOpacity(pointcloudGroup, opacity) {
    if (pointcloudGroup) {
        pointcloudGroup.traverse((child) => {
            if (child.isPoints && child.material) {
                child.material.transparent = opacity < 1;
                child.material.opacity = opacity;
                child.material.needsUpdate = true;
            }
        });
    }
}

// =============================================================================
// ALIGNMENT FILE OPERATIONS
// =============================================================================

/**
 * Save alignment data to a JSON file
 * @param {Object} alignmentData - The alignment data
 * @param {string} filename - Download filename
 */
export function saveAlignmentToFile(alignmentData, filename = 'alignment.json') {
    const blob = new Blob([JSON.stringify(alignmentData, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    a.click();
    URL.revokeObjectURL(url);
}

/**
 * Load alignment data from a file
 * @param {File} file - The alignment JSON file
 * @returns {Promise<Object>} The parsed alignment data
 */
export function loadAlignmentFromFile(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const alignment = JSON.parse(e.target.result);
                resolve(alignment);
            } catch (error) {
                reject(new Error('Invalid alignment file: ' + error.message));
            }
        };
        reader.onerror = () => reject(new Error('Failed to read file'));
        reader.readAsText(file);
    });
}

/**
 * Load alignment from a URL
 * @param {string} url - The alignment URL
 * @returns {Promise<Object>} The parsed alignment data
 */
export async function loadAlignmentFromUrl(url) {
    log.info('Loading alignment from URL:', url);
    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
    }
    const alignment = await response.json();
    log.info('Alignment loaded successfully from URL');
    return alignment;
}

export default {
    validateUserUrl,
    loadSplatFromFile,
    loadSplatFromUrl,
    loadSplatFromBlobUrl,
    loadGLTF,
    loadOBJ,
    loadOBJFromUrl,
    loadModelFromFile,
    loadModelFromUrl,
    loadModelFromBlobUrl,
    loadE57,
    loadPointcloudFromFile,
    loadPointcloudFromUrl,
    loadPointcloudFromBlobUrl,
    updatePointcloudPointSize,
    updatePointcloudOpacity,
    loadArchiveFromFile,
    loadArchiveFromUrl,
    processArchive,
    processArchivePhase1,
    loadArchiveAsset,
    loadArchiveFullResMesh,
    getAssetTypesForMode,
    getPrimaryAssetType,
    updateModelOpacity,
    updateModelWireframe,
    saveAlignmentToFile,
    loadAlignmentFromFile,
    loadAlignmentFromUrl
};
