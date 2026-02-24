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
import { STLLoader } from 'three/addons/loaders/STLLoader.js';
import { SplatMesh } from '@sparkjsdev/spark';
import { ArchiveLoader } from './archive-loader.js';
import { TIMING, ASSET_STATE } from './constants.js';
import { Logger, processMeshMaterials, computeMeshFaceCount, computeMeshVertexCount, computeTextureInfo, disposeObject, fetchWithProgress } from './utilities.js';
import type { AppState, QualityTier } from '@/types.js';

// E57Loader is loaded lazily via dynamic import to allow graceful degradation
// when the three-e57-loader CDN module is unavailable (e.g., offline kiosk viewer).

/**
 * Map file extension to Spark 2.0 SplatFileType enum value.
 * Needed when loading from blob URLs where Spark can't infer format from the path.
 */
const SPLAT_FILE_TYPE_MAP: Record<string, string> = {
    ply: 'ply', spz: 'spz', splat: 'splat', ksplat: 'ksplat', rad: 'rad',
    // Note: .sog (SOGS) format is not supported in Spark 2.0 preview.
    // Convert .sog files to .spz using splat-transform or SuperSplat.
};

function getSplatFileType(fileNameOrUrl: string): string | undefined {
    const ext = fileNameOrUrl.split(/[?#]/)[0].split('.').pop()?.toLowerCase();
    return ext ? SPLAT_FILE_TYPE_MAP[ext] : undefined;
}

// Lazy-loaded E57 support
let _E57Loader: any = null;
let _e57Checked = false;

/**
 * Lazily load the E57Loader. Returns null if unavailable (e.g., offline).
 */
async function getE57Loader(): Promise<any | null> {
    if (_e57Checked) return _E57Loader;
    _e57Checked = true;
    try {
        const mod = await import('three-e57-loader');
        _E57Loader = mod.E57Loader;
        log.info('E57 loader available');
    } catch (e: any) {
        log.warn('E57 loader not available:', e.message);
        _E57Loader = null;
    }
    return _E57Loader;
}

const log = Logger.getLogger('file-handlers');

// =============================================================================
// TYPE DEFINITIONS
// =============================================================================

interface LoadSplatDeps {
    scene: THREE.Scene;
    getSplatMesh: () => any;
    setSplatMesh: (mesh: any) => void;
    state: AppState;
    archiveCreator?: any;
    sceneManager?: { ensureWebGLRenderer: () => Promise<void>; ensureWebGPURenderer: () => Promise<void> };
    callbacks?: {
        onSplatLoaded?: (mesh: any, file: File | Blob) => void;
        onApplySplatTransform?: (transform: any) => void;
        [key: string]: any;
    };
}

interface LoadModelDeps {
    modelGroup: THREE.Group;
    state: AppState;
    archiveCreator?: any;
    callbacks?: {
        onModelLoaded?: (object: THREE.Object3D, file: File | Blob, faceCount: number) => void;
    };
}

interface LoadSTLDeps {
    stlGroup: THREE.Group;
    state: AppState;
    callbacks?: {
        onSTLLoaded?: (object: THREE.Mesh, file: File | Blob, faceCount: number) => void;
    };
}

interface LoadArchiveDeps {
    state: AppState;
}

interface ProcessArchiveDeps {
    scene: THREE.Scene;
    getSplatMesh: () => any;
    setSplatMesh: (mesh: any) => void;
    modelGroup: THREE.Group;
    state: AppState;
    callbacks?: {
        onApplySplatTransform?: (transform: any) => void;
        onApplyModelTransform?: (transform: any) => void;
        onApplyPointcloudTransform?: (transform: any) => void;
    };
}

interface LoadArchiveAssetDeps {
    scene: THREE.Scene;
    getSplatMesh: () => any;
    setSplatMesh: (mesh: any) => void;
    modelGroup: THREE.Group;
    pointcloudGroup: THREE.Group;
    state: AppState;
    qualityTier?: QualityTier | string;
    sceneManager?: { ensureWebGLRenderer: () => Promise<void>; ensureWebGPURenderer: () => Promise<void> };
    callbacks?: {
        onApplySplatTransform?: (transform: any) => void;
        onApplyModelTransform?: (transform: any) => void;
        onApplyPointcloudTransform?: (transform: any) => void;
    };
    onProgress?: (percent: number, stage: string) => void;
}

interface LoadFullResDeps {
    scene: THREE.Scene;
    getSplatMesh: () => any;
    setSplatMesh: (mesh: any) => void;
    modelGroup: THREE.Group;
    state: AppState;
    sceneManager?: { ensureWebGLRenderer: () => Promise<void>; ensureWebGPURenderer: () => Promise<void> };
    callbacks?: {
        onApplySplatTransform?: (transform: any) => void;
        onApplyModelTransform?: (transform: any) => void;
    };
}

interface LoadPointcloudDeps {
    pointcloudGroup: THREE.Group;
    state: AppState;
    archiveCreator?: any;
    callbacks?: {
        onPointcloudLoaded?: (object: THREE.Object3D, file: File | { name: string }, pointCount: number, blob: Blob) => void;
    };
}

interface ProcessArchiveResult {
    manifest: any;
    archiveLoader: ArchiveLoader;
    loadedSplat: boolean;
    loadedMesh: boolean;
    splatBlob: Blob | null;
    meshBlob: Blob | null;
    errors: string[];
    globalAlignment: any;
    annotations: any[];
}

interface Phase1Result {
    manifest: any;
    contentInfo: any;
    thumbnailUrl: string | null;
}

interface AssetLoadResult {
    loaded: boolean;
    blob: Blob | null;
    error: string | null;
    faceCount?: number;
    pointCount?: number;
    isProxy?: boolean;
}

interface ModelLoadResult {
    object: THREE.Object3D;
    faceCount: number;
    textureInfo?: import('./utilities.js').TextureInfo;
}

interface PointcloudLoadResult {
    object: THREE.Group;
    pointCount: number;
}

type ProgressCallback = ((received: number, total: number) => void) | null;

// =============================================================================
// SPLAT LOADING
// =============================================================================

/**
 * Load splat from a file
 */
export async function loadSplatFromFile(file: File, deps: LoadSplatDeps): Promise<any> {
    const { scene, getSplatMesh, setSplatMesh, state, archiveCreator, callbacks } = deps;

    // Spark.js requires WebGL — switch renderer if currently WebGPU
    if (deps.sceneManager) await deps.sceneManager.ensureWebGLRenderer();

    // Remove existing splat
    const existingSplat = getSplatMesh();
    if (existingSplat) {
        scene.remove(existingSplat);
        if (existingSplat.dispose) existingSplat.dispose();
        setSplatMesh(null);
    }

    // Create object URL for the file
    const fileUrl = URL.createObjectURL(file);

    // Ensure WASM is ready (required for compressed formats like .sog, .spz)
    await SplatMesh.staticInitialized;

    // Pass fileType for blob URLs where Spark 2.0 can't detect format from path
    const fileType = getSplatFileType(file.name);

    // Create SplatMesh using Spark
    const splatMesh = new SplatMesh({ url: fileUrl, ...(fileType && { fileType }) });

    // Apply default rotation to correct upside-down orientation
    splatMesh.rotation.x = Math.PI;

    // Disable frustum culling to prevent clipping issues with rotated splats
    splatMesh.frustumCulled = false;

    // Force matrix auto-update and set render order
    splatMesh.matrixAutoUpdate = true;
    splatMesh.renderOrder = 0;

    // Verify SplatMesh is a valid THREE.Object3D
    if (!(splatMesh instanceof THREE.Object3D)) {
        log.warn('WARNING: SplatMesh is not an instance of THREE.Object3D!');
        log.warn('This may indicate multiple THREE.js instances are loaded.');
    }

    // Wait for splat to finish loading/parsing
    await splatMesh.initialized;

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
        archiveCreator.precomputeHash(file).catch((e: Error) => {
            log.warn('Background hash precompute failed:', e);
        });
    }

    // Call callbacks
    if (callbacks?.onSplatLoaded) {
        callbacks.onSplatLoaded(splatMesh, file);
    }

    return splatMesh;
}

/**
 * Load splat from a URL
 */
export async function loadSplatFromUrl(url: string, deps: LoadSplatDeps, onProgress: ProgressCallback = null): Promise<any> {
    const { scene, getSplatMesh, setSplatMesh, state, archiveCreator, callbacks } = deps;

    // Spark.js requires WebGL — switch renderer if currently WebGPU
    if (deps.sceneManager) await deps.sceneManager.ensureWebGLRenderer();

    log.info('Fetching splat from URL:', url);
    const blob = await fetchWithProgress(url, onProgress);
    log.info('Splat blob fetched, size:', blob.size);

    // Pre-compute hash in background
    if (archiveCreator) {
        archiveCreator.precomputeHash(blob).catch((e: Error) => {
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

    // Ensure WASM is ready (required for compressed formats like .sog, .spz)
    await SplatMesh.staticInitialized;

    // Pass fileType for blob URLs where Spark 2.0 can't detect format from path
    const fileType = getSplatFileType(url);

    // Create SplatMesh using Spark
    const splatMesh = new SplatMesh({ url: blobUrl, ...(fileType && { fileType }) });

    // Apply default rotation
    splatMesh.rotation.x = Math.PI;

    // Disable frustum culling to prevent clipping issues with rotated splats
    splatMesh.frustumCulled = false;

    // Verify SplatMesh
    if (!(splatMesh instanceof THREE.Object3D)) {
        log.warn('WARNING: SplatMesh is not an instance of THREE.Object3D!');
    }

    // Wait for splat to finish loading/parsing
    await splatMesh.initialized;

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
    if (callbacks?.onSplatLoaded) {
        callbacks.onSplatLoaded(splatMesh, blob);
    }

    return splatMesh;
}

/**
 * Load splat from a blob URL (used by archive loader)
 */
export async function loadSplatFromBlobUrl(blobUrl: string, fileName: string, deps: LoadSplatDeps): Promise<any> {
    const { scene, getSplatMesh, setSplatMesh, state } = deps;

    // Spark.js requires WebGL — switch renderer if currently WebGPU
    if (deps.sceneManager) await deps.sceneManager.ensureWebGLRenderer();

    // Remove existing splat
    const existingSplat = getSplatMesh();
    if (existingSplat) {
        scene.remove(existingSplat);
        if (existingSplat.dispose) existingSplat.dispose();
        setSplatMesh(null);
    }

    // Ensure WASM is ready (required for compressed formats like .sog, .spz)
    await SplatMesh.staticInitialized;

    // Pass fileType for blob URLs where Spark 2.0 can't detect format from path
    const fileType = getSplatFileType(fileName);

    // Create SplatMesh using Spark
    const splatMesh = new SplatMesh({ url: blobUrl, ...(fileType && { fileType }) });

    // Apply default rotation
    splatMesh.rotation.x = Math.PI;

    // Disable frustum culling to prevent clipping issues with rotated splats
    splatMesh.frustumCulled = false;

    // Verify SplatMesh
    if (!(splatMesh instanceof THREE.Object3D)) {
        log.warn('WARNING: SplatMesh is not an instance of THREE.Object3D!');
    }

    // Wait for splat to finish loading/parsing
    await splatMesh.initialized;

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
 */
export function loadGLTF(source: File | string, onProgress?: (loaded: number, total: number) => void): Promise<THREE.Group> {
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
            onProgress ? (event) => { if (event.lengthComputable) onProgress(event.loaded, event.total); } : undefined,
            (error) => {
                if (isFile) URL.revokeObjectURL(url);
                reject(error);
            }
        );
    });
}

/**
 * Load OBJ model (with optional MTL)
 */
export function loadOBJ(objFile: File, mtlFile: File | null): Promise<THREE.Group> {
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
function loadOBJWithoutMaterials(
    loader: OBJLoader,
    url: string,
    resolve: (value: THREE.Group) => void,
    reject: (reason?: any) => void
): void {
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
 */
export function loadOBJFromUrl(url: string, onProgress?: (loaded: number, total: number) => void): Promise<THREE.Group> {
    return new Promise((resolve, reject) => {
        const loader = new OBJLoader();
        loader.load(
            url,
            (object) => {
                processMeshMaterials(object, { forceDefaultMaterial: true, preserveTextures: true });
                resolve(object);
            },
            onProgress ? (event) => { if (event.lengthComputable) onProgress(event.loaded, event.total); } : undefined,
            (error) => reject(error)
        );
    });
}

/**
 * Load STL from a File object
 * STLLoader returns a BufferGeometry, so we wrap it in a Mesh.
 */
export function loadSTL(fileOrUrl: File | string): Promise<THREE.Mesh> {
    return new Promise((resolve, reject) => {
        const loader = new STLLoader();
        const url = typeof fileOrUrl === 'string' ? fileOrUrl : URL.createObjectURL(fileOrUrl);
        loader.load(
            url,
            (geometry) => {
                if (typeof fileOrUrl !== 'string') URL.revokeObjectURL(url);
                geometry.computeVertexNormals();
                const material = new THREE.MeshStandardMaterial({
                    color: 0xaaaaaa,
                    metalness: 0.2,
                    roughness: 0.6,
                    flatShading: false
                });
                const mesh = new THREE.Mesh(geometry, material);
                mesh.name = typeof fileOrUrl === 'string' ? 'stl_model' : fileOrUrl.name;
                resolve(mesh);
            },
            undefined,
            (error) => {
                if (typeof fileOrUrl !== 'string') URL.revokeObjectURL(url);
                reject(error);
            }
        );
    });
}

/**
 * Load STL from URL (no blob URL revocation needed)
 */
export function loadSTLFromUrl(url: string, onProgress?: (loaded: number, total: number) => void): Promise<THREE.Mesh> {
    return new Promise((resolve, reject) => {
        const loader = new STLLoader();
        loader.load(
            url,
            (geometry) => {
                geometry.computeVertexNormals();
                const material = new THREE.MeshStandardMaterial({
                    color: 0xaaaaaa,
                    metalness: 0.2,
                    roughness: 0.6,
                    flatShading: false
                });
                const mesh = new THREE.Mesh(geometry, material);
                mesh.name = 'stl_model';
                resolve(mesh);
            },
            onProgress ? (event) => { if (event.lengthComputable) onProgress(event.loaded, event.total); } : undefined,
            (error) => reject(error)
        );
    });
}

/**
 * Load STL from a file into the STL group (separate asset type)
 */
export async function loadSTLFile(files: FileList, deps: LoadSTLDeps): Promise<THREE.Mesh> {
    const { stlGroup, state, callbacks } = deps;
    const mainFile = files[0];

    // Clear existing STL
    while (stlGroup.children.length > 0) {
        const child = stlGroup.children[0];
        disposeObject(child);
        stlGroup.remove(child);
    }

    const loadedObject = await loadSTL(mainFile);

    if (loadedObject) {
        stlGroup.add(loadedObject);
        state.stlLoaded = true;

        const faceCount = computeMeshFaceCount(loadedObject);

        if (callbacks?.onSTLLoaded) {
            callbacks.onSTLLoaded(loadedObject, mainFile, faceCount);
        }
    }

    return loadedObject;
}

/**
 * Load STL from URL into the STL group (separate asset type)
 */
export async function loadSTLFromUrlWithDeps(url: string, deps: LoadSTLDeps): Promise<THREE.Mesh> {
    const { stlGroup, state, callbacks } = deps;

    log.info('Fetching STL from URL:', url);
    const blob = await fetchWithProgress(url);
    log.info('STL blob fetched, size:', blob.size);

    const blobUrl = URL.createObjectURL(blob);

    // Clear existing STL
    while (stlGroup.children.length > 0) {
        const child = stlGroup.children[0];
        disposeObject(child);
        stlGroup.remove(child);
    }

    const loadedObject = await loadSTLFromUrl(blobUrl);

    if (loadedObject) {
        stlGroup.add(loadedObject);
        state.stlLoaded = true;
        state.currentStlUrl = url;

        const faceCount = computeMeshFaceCount(loadedObject);

        if (callbacks?.onSTLLoaded) {
            callbacks.onSTLLoaded(loadedObject, blob, faceCount);
        }
    }

    return loadedObject;
}

/**
 * Load model from a file
 */
export async function loadModelFromFile(files: FileList, deps: LoadModelDeps): Promise<THREE.Object3D | undefined> {
    const { modelGroup, state, archiveCreator, callbacks } = deps;
    const mainFile = files[0];

    // Clear existing model
    while (modelGroup.children.length > 0) {
        const child = modelGroup.children[0];
        disposeObject(child);
        modelGroup.remove(child);
    }

    const extension = mainFile.name.split('.').pop()?.toLowerCase();
    let loadedObject: THREE.Object3D | undefined;

    if (extension === 'glb' || extension === 'gltf') {
        loadedObject = await loadGLTF(mainFile);
    } else if (extension === 'obj') {
        let mtlFile: File | null = null;
        for (const f of Array.from(files)) {
            if (f.name.toLowerCase().endsWith('.mtl')) {
                mtlFile = f;
                break;
            }
        }
        loadedObject = await loadOBJ(mainFile, mtlFile);
    } else if (extension === 'stl') {
        loadedObject = await loadSTL(mainFile);
    }

    if (loadedObject) {
        modelGroup.add(loadedObject);
        state.modelLoaded = true;
        state.currentModelUrl = null; // Local files cannot be shared

        // Pre-compute hash in background
        if (archiveCreator) {
            archiveCreator.precomputeHash(mainFile).catch((e: Error) => {
                log.warn('Background hash precompute failed:', e);
            });
        }

        // Count faces
        const faceCount = computeMeshFaceCount(loadedObject);

        // Call callbacks
        if (callbacks?.onModelLoaded) {
            callbacks.onModelLoaded(loadedObject, mainFile, faceCount);
        }
    }

    return loadedObject;
}

/**
 * Load model from URL
 */
export async function loadModelFromUrl(url: string, deps: LoadModelDeps, onProgress: ProgressCallback = null): Promise<THREE.Object3D | undefined> {
    const { modelGroup, state, archiveCreator, callbacks } = deps;

    log.info('Fetching model from URL:', url);
    const blob = await fetchWithProgress(url, onProgress);
    log.info('Mesh blob fetched, size:', blob.size);

    // Pre-compute hash in background
    if (archiveCreator) {
        archiveCreator.precomputeHash(blob).catch((e: Error) => {
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

    const extension = url.split('.').pop()?.toLowerCase().split('?')[0];
    let loadedObject: THREE.Object3D | undefined;

    if (extension === 'glb' || extension === 'gltf') {
        loadedObject = await loadGLTF(blobUrl);
    } else if (extension === 'obj') {
        loadedObject = await loadOBJFromUrl(blobUrl);
    } else if (extension === 'stl') {
        loadedObject = await loadSTLFromUrl(blobUrl);
    }

    if (loadedObject) {
        modelGroup.add(loadedObject);
        state.modelLoaded = true;
        state.currentModelUrl = url;

        // Count faces and vertices
        const faceCount = computeMeshFaceCount(loadedObject);
        state.meshVertexCount = computeMeshVertexCount(loadedObject);
        state.meshTextureInfo = computeTextureInfo(loadedObject);

        // Call callbacks
        if (callbacks?.onModelLoaded) {
            callbacks.onModelLoaded(loadedObject, blob, faceCount);
        }
    }

    return loadedObject;
}

/**
 * Load model from a blob URL (used by archive loader)
 */
export async function loadModelFromBlobUrl(blobUrl: string, fileName: string, deps: Pick<LoadModelDeps, 'modelGroup' | 'state'>, onProgress?: (loaded: number, total: number) => void): Promise<ModelLoadResult> {
    const { modelGroup, state } = deps;

    // Clear existing model
    while (modelGroup.children.length > 0) {
        const child = modelGroup.children[0];
        disposeObject(child);
        modelGroup.remove(child);
    }

    const extension = fileName.split('.').pop()?.toLowerCase();
    let loadedObject: THREE.Object3D | undefined;

    if (extension === 'glb' || extension === 'gltf') {
        loadedObject = await loadGLTF(blobUrl, onProgress);
    } else if (extension === 'obj') {
        loadedObject = await loadOBJFromUrl(blobUrl, onProgress);
    } else if (extension === 'stl') {
        loadedObject = await loadSTLFromUrl(blobUrl, onProgress);
    }

    if (loadedObject) {
        modelGroup.add(loadedObject);
        state.modelLoaded = true;

        // Count faces
        const faceCount = computeMeshFaceCount(loadedObject);
        const textureInfo = computeTextureInfo(loadedObject);

        return { object: loadedObject, faceCount, textureInfo };
    }

    return { object: loadedObject!, faceCount: 0 };
}

// =============================================================================
// ARCHIVE LOADING
// =============================================================================

/**
 * Load archive from a file
 */
export async function loadArchiveFromFile(file: File, deps: LoadArchiveDeps): Promise<ArchiveLoader> {
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
 */
export async function loadArchiveFromUrl(url: string, deps: LoadArchiveDeps, onProgress: ((progress: number) => void) | null = null): Promise<ArchiveLoader> {
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
 */
export async function processArchive(archiveLoader: ArchiveLoader, archiveName: string, deps: ProcessArchiveDeps): Promise<ProcessArchiveResult> {
    const { state, callbacks } = deps;

    const manifest = await archiveLoader.parseManifest();
    log.info('Archive manifest:', manifest);

    state.archiveLoader = archiveLoader;
    state.archiveManifest = manifest;
    state.archiveFileName = archiveName;
    state.archiveLoaded = true;

    const contentInfo = archiveLoader.getContentInfo();
    const errors: string[] = [];
    let loadedSplat = false;
    let loadedMesh = false;
    let splatBlob: Blob | null = null;
    let meshBlob: Blob | null = null;

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
                if (callbacks?.onApplySplatTransform) {
                    callbacks.onApplySplatTransform(transform);
                }
            }
        } catch (e: any) {
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
                await loadModelFromBlobUrl(meshData.url, meshEntry.file_name, deps);
                loadedMesh = true;
                meshBlob = meshData.blob;

                // Apply transform from entry parameters if present
                const transform = archiveLoader.getEntryTransform(meshEntry);
                if (callbacks?.onApplyModelTransform) {
                    callbacks.onApplyModelTransform(transform);
                }
            }
        } catch (e: any) {
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
 */
export async function processArchivePhase1(archiveLoader: ArchiveLoader, archiveName: string, deps: Pick<ProcessArchiveDeps, 'state'>): Promise<Phase1Result> {
    const { state } = deps;

    const manifest = await archiveLoader.parseManifest();
    log.info('Phase 1 — manifest parsed:', manifest);

    state.archiveLoader = archiveLoader;
    state.archiveManifest = manifest;
    state.archiveFileName = archiveName;
    state.archiveLoaded = true;

    const contentInfo = archiveLoader.getContentInfo();

    // Extract thumbnail (small file, fast)
    let thumbnailUrl: string | null = null;
    const thumbnailEntry = archiveLoader.getThumbnailEntry();
    if (thumbnailEntry) {
        try {
            const thumbData = await archiveLoader.extractFile(thumbnailEntry.file_name);
            if (thumbData) {
                thumbnailUrl = thumbData.url;
            }
        } catch (e: any) {
            log.warn('Failed to extract thumbnail:', e.message);
        }
    }

    return { manifest, contentInfo, thumbnailUrl };
}

/**
 * Load a single archive asset type on demand.
 */
export async function loadArchiveAsset(archiveLoader: ArchiveLoader, assetType: 'splat' | 'mesh' | 'pointcloud', deps: LoadArchiveAssetDeps): Promise<AssetLoadResult> {
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
    deps.onProgress?.(10, 'Preparing...');

    try {
        if (assetType === 'splat') {
            const contentInfo = archiveLoader.getContentInfo();
            const sceneEntry = archiveLoader.getSceneEntry();
            if (!sceneEntry || !contentInfo.hasSplat) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return { loaded: false, blob: null, error: 'No splat in archive' };
            }

            // Prefer proxy when available and quality tier is SD
            const qualityTier = deps.qualityTier || 'hd';
            const proxyEntry = archiveLoader.getSceneProxyEntry();
            const useProxy = qualityTier === 'sd' && contentInfo.hasSceneProxy && proxyEntry;
            const entryToLoad = useProxy ? proxyEntry : sceneEntry;

            deps.onProgress?.(40, 'Decompressing splat...');
            const splatData = await archiveLoader.extractFile(entryToLoad.file_name);
            if (!splatData) {
                state.assetStates[assetType] = ASSET_STATE.ERROR;
                return { loaded: false, blob: null, error: 'Failed to extract splat file' };
            }

            deps.onProgress?.(60, 'Parsing splat data...');
            // Spark.js SplatMesh has no progress callback — simulate gradual progress
            let simInterval: ReturnType<typeof setInterval> | undefined;
            if (deps.onProgress) {
                let simPct = 60;
                simInterval = setInterval(() => {
                    simPct = Math.min(simPct + 3, 92);
                    deps.onProgress!(simPct, 'Parsing splat data...');
                }, 100);
            }
            try {
                await loadSplatFromBlobUrl(splatData.url, entryToLoad.file_name, deps);
            } finally {
                if (simInterval) clearInterval(simInterval);
            }

            // Apply transform from the primary scene entry (proxy inherits the same transform)
            const transform = archiveLoader.getEntryTransform(sceneEntry);
            if (callbacks.onApplySplatTransform) {
                callbacks.onApplySplatTransform(transform);
            }

            state.assetStates[assetType] = ASSET_STATE.LOADED;
            return { loaded: true, blob: splatData.blob, error: null, isProxy: !!useProxy };

        } else if (assetType === 'mesh') {
            const contentInfo = archiveLoader.getContentInfo();
            const meshEntry = archiveLoader.getMeshEntry();
            if (!meshEntry || !contentInfo.hasMesh) {
                state.assetStates[assetType] = ASSET_STATE.UNLOADED;
                return { loaded: false, blob: null, error: 'No mesh in archive' };
            }

            // Prefer proxy mesh when available and quality tier is SD
            const qualityTier = deps.qualityTier || 'hd';
            const proxyEntry = archiveLoader.getMeshProxyEntry();
            const useProxy = qualityTier === 'sd' && contentInfo.hasMeshProxy && proxyEntry;
            const entryToLoad = useProxy ? proxyEntry : meshEntry;

            deps.onProgress?.(40, 'Decompressing model...');
            const meshData = await archiveLoader.extractFile(entryToLoad.file_name);
            if (!meshData) {
                state.assetStates[assetType] = ASSET_STATE.ERROR;
                return { loaded: false, blob: null, error: 'Failed to extract mesh file' };
            }

            deps.onProgress?.(60, 'Parsing model data...');
            const parseProgress = deps.onProgress ? (loaded: number, total: number) => {
                if (total > 0) deps.onProgress!(60 + Math.round((loaded / total) * 35), 'Parsing model data...');
            } : undefined;
            const result = await loadModelFromBlobUrl(meshData.url, entryToLoad.file_name, deps, parseProgress);

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

            const pcEntry = pcEntries[0].entry;
            deps.onProgress?.(40, 'Decompressing point cloud...');
            const pcData = await archiveLoader.extractFile(pcEntry.file_name);
            if (!pcData) {
                state.assetStates[assetType] = ASSET_STATE.ERROR;
                return { loaded: false, blob: null, error: 'Failed to extract pointcloud file' };
            }

            deps.onProgress?.(60, 'Parsing point cloud data...');
            const parseProgress = deps.onProgress ? (loaded: number, total: number) => {
                if (total > 0) deps.onProgress!(60 + Math.round((loaded / total) * 35), 'Parsing point cloud data...');
            } : undefined;
            const result = await loadPointcloudFromBlobUrl(pcData.url, pcEntry.file_name, deps, parseProgress);

            // Apply transform if present
            const transform = archiveLoader.getEntryTransform(pcEntry);
            if (callbacks.onApplyPointcloudTransform) {
                callbacks.onApplyPointcloudTransform(transform);
            }

            state.assetStates[assetType] = ASSET_STATE.LOADED;
            return { loaded: true, blob: pcData.blob, error: null, pointCount: result?.pointCount || 0 };
        }

        return { loaded: false, blob: null, error: `Unknown asset type: ${assetType}` };

    } catch (e: any) {
        state.assetStates[assetType] = ASSET_STATE.ERROR;
        log.error(`Error loading ${assetType} from archive:`, e);
        return { loaded: false, blob: null, error: e.message };
    }
}

/**
 * Load the full-resolution mesh from an archive, replacing the currently displayed proxy.
 * Clears the existing modelGroup contents before loading.
 */
export async function loadArchiveFullResMesh(archiveLoader: ArchiveLoader, deps: LoadFullResDeps): Promise<AssetLoadResult> {
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
 * Load the full-resolution splat from an archive, replacing the currently displayed proxy.
 */
export async function loadArchiveFullResSplat(archiveLoader: ArchiveLoader, deps: LoadFullResDeps): Promise<AssetLoadResult> {
    const { state, scene, getSplatMesh, setSplatMesh, callbacks = {} } = deps;
    const sceneEntry = archiveLoader.getSceneEntry();
    if (!sceneEntry) {
        return { loaded: false, blob: null, error: 'No full-resolution splat in archive' };
    }

    const splatData = await archiveLoader.extractFile(sceneEntry.file_name);
    if (!splatData) {
        return { loaded: false, blob: null, error: 'Failed to extract full-resolution splat' };
    }

    // Remove existing splat (the proxy) before loading
    const existingSplat = getSplatMesh();
    if (existingSplat) {
        scene.remove(existingSplat);
        if (existingSplat.dispose) existingSplat.dispose();
        setSplatMesh(null);
    }

    state.splatLoaded = false;
    await loadSplatFromBlobUrl(splatData.url, sceneEntry.file_name, deps);

    // Apply transform from manifest
    const transform = archiveLoader.getEntryTransform(sceneEntry);
    if (callbacks.onApplySplatTransform) {
        callbacks.onApplySplatTransform(transform);
    }

    state.assetStates.splat = ASSET_STATE.LOADED;
    return { loaded: true, blob: splatData.blob, error: null };
}

/**
 * Load the proxy splat from an archive, replacing the currently displayed full-res.
 */
export async function loadArchiveProxySplat(archiveLoader: ArchiveLoader, deps: LoadFullResDeps): Promise<AssetLoadResult> {
    const { state, scene, getSplatMesh, setSplatMesh, callbacks = {} } = deps;
    const proxyEntry = archiveLoader.getSceneProxyEntry();
    if (!proxyEntry) {
        return { loaded: false, blob: null, error: 'No proxy splat in archive' };
    }

    const splatData = await archiveLoader.extractFile(proxyEntry.file_name);
    if (!splatData) {
        return { loaded: false, blob: null, error: 'Failed to extract proxy splat' };
    }

    // Remove existing splat (the full-res) before loading
    const existingSplat = getSplatMesh();
    if (existingSplat) {
        scene.remove(existingSplat);
        if (existingSplat.dispose) existingSplat.dispose();
        setSplatMesh(null);
    }

    state.splatLoaded = false;
    await loadSplatFromBlobUrl(splatData.url, proxyEntry.file_name, deps);

    // Apply transform from the primary scene entry (proxy inherits the same transform)
    const sceneEntry = archiveLoader.getSceneEntry();
    const transform = archiveLoader.getEntryTransform(sceneEntry || proxyEntry);
    if (callbacks.onApplySplatTransform) {
        callbacks.onApplySplatTransform(transform);
    }

    state.assetStates.splat = ASSET_STATE.LOADED;
    return { loaded: true, blob: splatData.blob, error: null };
}

/**
 * Load the proxy mesh from an archive, replacing the currently displayed full-res.
 */
export async function loadArchiveProxyMesh(archiveLoader: ArchiveLoader, deps: LoadFullResDeps): Promise<AssetLoadResult> {
    const { state, callbacks = {} } = deps;
    const proxyEntry = archiveLoader.getMeshProxyEntry();
    if (!proxyEntry) {
        return { loaded: false, blob: null, error: 'No proxy mesh in archive' };
    }

    const meshData = await archiveLoader.extractFile(proxyEntry.file_name);
    if (!meshData) {
        return { loaded: false, blob: null, error: 'Failed to extract proxy mesh' };
    }

    // Clear existing model (the full-res) before loading
    const { modelGroup } = deps;
    if (modelGroup) {
        while (modelGroup.children.length > 0) {
            const child = modelGroup.children[0];
            modelGroup.remove(child);
            disposeObject(child);
        }
    }

    state.modelLoaded = false;
    const result = await loadModelFromBlobUrl(meshData.url, proxyEntry.file_name, deps);

    // Apply transform from the primary mesh entry (proxy inherits the same transform)
    const meshEntry = archiveLoader.getMeshEntry();
    const transform = archiveLoader.getEntryTransform(meshEntry || proxyEntry);
    if (callbacks.onApplyModelTransform) {
        callbacks.onApplyModelTransform(transform);
    }

    state.assetStates.mesh = ASSET_STATE.LOADED;
    return { loaded: true, blob: meshData.blob, error: null, faceCount: result?.faceCount || 0 };
}

/**
 * Determine which asset types are needed for a given display mode.
 */
export function getAssetTypesForMode(mode: string): string[] {
    switch (mode) {
        case 'splat': return ['splat'];
        case 'model': return ['mesh'];
        case 'both': return ['splat', 'mesh'];
        case 'split': return ['splat', 'mesh'];
        case 'pointcloud': return ['pointcloud'];
        case 'stl': return ['stl'];
        default: return ['splat', 'mesh'];
    }
}

/**
 * Determine the primary asset type to load first based on display mode and available content.
 * Priority: splat > mesh > pointcloud (splat gives fastest visual feedback).
 */
export function getPrimaryAssetType(displayMode: string, contentInfo: any): string {
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
 */
export function updateModelOpacity(modelGroup: THREE.Group, opacity: number): void {
    if (modelGroup) {
        modelGroup.traverse((child) => {
            if ((child as any).isMesh && (child as any).material) {
                const materials = Array.isArray((child as any).material) ? (child as any).material : [(child as any).material];
                materials.forEach((mat: any) => {
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
 */
export function updateModelWireframe(modelGroup: THREE.Group, wireframe: boolean): void {
    if (modelGroup) {
        modelGroup.traverse((child) => {
            if ((child as any).isMesh && (child as any).material) {
                const materials = Array.isArray((child as any).material) ? (child as any).material : [(child as any).material];
                materials.forEach((mat: any) => {
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

// Per-mesh storage of original materials (same pattern as _storedMaterials for matcap).
// Whole-material swap avoids setting map=null+needsUpdate=true which causes WebGPU
// pipeline recompilation errors in Three.js r170+.
const _storedTexturedMaterials = new WeakMap<any, any>();

/**
 * Toggle model textures on/off by swapping whole materials (WebGPU-safe).
 */
export function updateModelTextures(modelGroup: THREE.Group, showTextures: boolean): void {
    if (!modelGroup) return;
    modelGroup.traverse((child) => {
        if (!(child as any).isMesh || !(child as any).material) return;

        const isArray = Array.isArray((child as any).material);
        const materials: any[] = isArray ? (child as any).material : [(child as any).material];

        if (!showTextures) {
            // Store originals on the mesh object (only once)
            if (!_storedTexturedMaterials.has(child)) {
                _storedTexturedMaterials.set(child, isArray ? [...materials] : materials[0]);
            }
            // Replace with texture-free clones — no map=null, no needsUpdate
            const noTexMats = materials.map((mat: any) => {
                const noTex = new THREE.MeshStandardMaterial({
                    color: mat.color ? mat.color.clone() : new THREE.Color(0xcccccc),
                    roughness: mat.roughness ?? 0.8,
                    metalness: mat.metalness ?? 0.0,
                    side: mat.side,
                    transparent: mat.transparent,
                    opacity: mat.opacity,
                    wireframe: mat.wireframe ?? false,
                });
                return noTex;
            });
            (child as any).material = isArray ? noTexMats : noTexMats[0];
        } else {
            const stored = _storedTexturedMaterials.get(child);
            if (stored) {
                (child as any).material = stored;
            }
        }
    });
}

// =============================================================================
// MATCAP RENDERING MODE
// =============================================================================

const _storedMaterials = new WeakMap<any, any>();
const _matcapTextureCache = new Map<string, THREE.CanvasTexture>();

/**
 * Generate a matcap texture procedurally using canvas gradients.
 */
function generateMatcapTexture(style: string): THREE.CanvasTexture {
    if (_matcapTextureCache.has(style)) return _matcapTextureCache.get(style)!;

    const size = 256;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;
    const cx = size / 2, cy = size / 2, r = size / 2;

    const presets: Record<string, { stops: Array<[number, string]> }> = {
        clay:   { stops: [[0, '#d4c8b8'], [0.5, '#a89880'], [0.85, '#6b5d4f'], [1, '#3a3028']] },
        chrome: { stops: [[0, '#ffffff'], [0.3, '#e0e0e0'], [0.6, '#888888'], [0.85, '#333333'], [1, '#111111']] },
        pearl:  { stops: [[0, '#faf0f0'], [0.4, '#e8d8e0'], [0.7, '#c0a8b8'], [0.9, '#8a7088'], [1, '#504058']] },
        jade:   { stops: [[0, '#c8e8c0'], [0.4, '#80c078'], [0.7, '#488040'], [0.9, '#285828'], [1, '#183818']] },
        copper: { stops: [[0, '#f0c8a0'], [0.35, '#d89860'], [0.6, '#b07038'], [0.85, '#704020'], [1, '#402010']] },
    };

    const preset = presets[style] || presets.clay;

    // Radial gradient for the sphere shape
    const grad = ctx.createRadialGradient(cx * 0.9, cy * 0.85, 0, cx, cy, r);
    preset.stops.forEach(([offset, color]) => grad.addColorStop(offset, color));

    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, size, size);

    // Add subtle specular highlight for realism
    const highlight = ctx.createRadialGradient(cx * 0.7, cy * 0.6, 0, cx * 0.7, cy * 0.6, r * 0.4);
    highlight.addColorStop(0, 'rgba(255,255,255,0.25)');
    highlight.addColorStop(1, 'rgba(255,255,255,0)');
    ctx.fillStyle = highlight;
    ctx.fillRect(0, 0, size, size);

    const texture = new THREE.CanvasTexture(canvas);
    texture.colorSpace = THREE.SRGBColorSpace;
    _matcapTextureCache.set(style, texture);
    return texture;
}

/**
 * Return the list of available matcap preset names.
 */
export function getMatcapPresets(): string[] {
    return ['clay', 'chrome', 'pearl', 'jade', 'copper'];
}

/**
 * Toggle matcap rendering mode on all meshes in a model group.
 * When enabled, replaces materials with MeshMatcapMaterial.
 * When disabled, restores original materials.
 */
export function updateModelMatcap(modelGroup: THREE.Group, enabled: boolean, style: string = 'clay'): void {
    if (!modelGroup) return;
    const matcapTexture = enabled ? generateMatcapTexture(style) : null;

    modelGroup.traverse((child) => {
        if (!(child as any).isMesh || !(child as any).material) return;

        const isArray = Array.isArray((child as any).material);
        const materials = isArray ? (child as any).material : [(child as any).material];

        if (enabled) {
            // Store originals (only on first enable, not on style change)
            if (!_storedMaterials.has(child)) {
                _storedMaterials.set(child, isArray ? [...materials] : materials[0]);
            }

            const matcapMats = materials.map((mat: any) => {
                const matcapMat = new THREE.MeshMatcapMaterial({
                    matcap: matcapTexture!,
                    color: mat.color ? mat.color.clone() : new THREE.Color(0xffffff),
                    flatShading: false,
                });
                return matcapMat;
            });

            (child as any).material = isArray ? matcapMats : matcapMats[0];
        } else {
            // Restore originals
            const stored = _storedMaterials.get(child);
            if (stored) {
                // Dispose the matcap materials
                const currentMats = isArray ? (child as any).material : [(child as any).material];
                currentMats.forEach((m: any) => { if (m && m.dispose) m.dispose(); });

                (child as any).material = stored;
                _storedMaterials.delete(child);
            }
        }
    });
}

// =============================================================================
// VERTEX NORMALS VISUALIZATION
// =============================================================================

/**
 * Toggle vertex normals visualization on all meshes in a model group.
 * When enabled, replaces materials with MeshNormalMaterial (RGB = XYZ normals).
 * When disabled, restores original materials.
 * Mutually exclusive with matcap mode (shares _storedMaterials).
 */
export function updateModelNormals(modelGroup: THREE.Group, enabled: boolean): void {
    if (!modelGroup) return;

    modelGroup.traverse((child) => {
        if (!(child as any).isMesh || !(child as any).material) return;

        const isArray = Array.isArray((child as any).material);
        const materials = isArray ? (child as any).material : [(child as any).material];

        if (enabled) {
            // Store originals (only if not already stored by matcap)
            if (!_storedMaterials.has(child)) {
                _storedMaterials.set(child, isArray ? [...materials] : materials[0]);
            }

            const normalMats = materials.map(() => {
                return new THREE.MeshNormalMaterial({ flatShading: false });
            });

            (child as any).material = isArray ? normalMats : normalMats[0];
        } else {
            // Restore originals
            const stored = _storedMaterials.get(child);
            if (stored) {
                const currentMats = isArray ? (child as any).material : [(child as any).material];
                currentMats.forEach((m: any) => { if (m && m.dispose) m.dispose(); });

                (child as any).material = stored;
                _storedMaterials.delete(child);
            }
        }
    });
}

// =============================================================================
// PBR CHANNEL DEBUG VIEWS (Roughness / Metalness / Specular F0)
// =============================================================================

const _pbrDebugVert = /* glsl */`
varying vec2 vUv;
void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}`;

const _pbrDebugFrag = /* glsl */`
uniform int uMode;
uniform float uRoughness;
uniform float uMetalness;
uniform float uF0;
uniform vec3 uBaseColor;
uniform sampler2D uRoughnessMap;
uniform sampler2D uMetalnessMap;
uniform sampler2D uBaseColorMap;
uniform bool uHasRoughnessMap;
uniform bool uHasMetalnessMap;
uniform bool uHasBaseColorMap;
varying vec2 vUv;
void main() {
    if (uMode == 0) {
        float val = uRoughness;
        if (uHasRoughnessMap) val *= texture2D(uRoughnessMap, vUv).g;
        gl_FragColor = vec4(vec3(val), 1.0);
    } else if (uMode == 1) {
        float val = uMetalness;
        if (uHasMetalnessMap) val *= texture2D(uMetalnessMap, vUv).b;
        gl_FragColor = vec4(vec3(val), 1.0);
    } else {
        float met = uMetalness;
        if (uHasMetalnessMap) met *= texture2D(uMetalnessMap, vUv).b;
        vec3 base = uBaseColor;
        if (uHasBaseColorMap) base *= texture2D(uBaseColorMap, vUv).rgb;
        gl_FragColor = vec4(mix(vec3(uF0), base, met), 1.0);
    }
}`;

/**
 * Create a ShaderMaterial that visualises a single PBR channel.
 */
function _createPBRDebugMaterial(mat: any, mode: number): THREE.ShaderMaterial {
    const roughness = mat.roughness !== undefined ? mat.roughness : 0.8;
    const metalness = mat.metalness !== undefined ? mat.metalness : 0.1;
    const ior = mat.ior !== undefined ? mat.ior : 1.5;
    const f0 = Math.pow((ior - 1) / (ior + 1), 2);
    const baseColor = mat.color ? mat.color.clone() : new THREE.Color(1, 1, 1);

    return new THREE.ShaderMaterial({
        vertexShader: _pbrDebugVert,
        fragmentShader: _pbrDebugFrag,
        uniforms: {
            uMode: { value: mode },
            uRoughness: { value: roughness },
            uMetalness: { value: metalness },
            uF0: { value: f0 },
            uBaseColor: { value: baseColor },
            uRoughnessMap: { value: mat.roughnessMap || null },
            uMetalnessMap: { value: mat.metalnessMap || null },
            uBaseColorMap: { value: mat.map || null },
            uHasRoughnessMap: { value: !!mat.roughnessMap },
            uHasMetalnessMap: { value: !!mat.metalnessMap },
            uHasBaseColorMap: { value: !!mat.map },
        },
    });
}

/**
 * Generic PBR debug view toggle. Saves/restores originals via _storedMaterials.
 */
function _togglePBRDebugView(modelGroup: THREE.Group, enabled: boolean, mode: number): void {
    if (!modelGroup) return;

    modelGroup.traverse((child) => {
        if (!(child as any).isMesh || !(child as any).material) return;

        const isArray = Array.isArray((child as any).material);
        const materials = isArray ? (child as any).material : [(child as any).material];

        if (enabled) {
            if (!_storedMaterials.has(child)) {
                _storedMaterials.set(child, isArray ? [...materials] : materials[0]);
            }

            const debugMats = materials.map((mat: any) => _createPBRDebugMaterial(mat, mode));
            (child as any).material = isArray ? debugMats : debugMats[0];
        } else {
            const stored = _storedMaterials.get(child);
            if (stored) {
                const currentMats = isArray ? (child as any).material : [(child as any).material];
                currentMats.forEach((m: any) => { if (m && m.dispose) m.dispose(); });
                (child as any).material = stored;
                _storedMaterials.delete(child);
            }
        }
    });
}

/**
 * Toggle roughness debug view — grayscale visualisation of roughness values.
 * Mutually exclusive with matcap, normals, and other debug views (shares _storedMaterials).
 */
export function updateModelRoughness(modelGroup: THREE.Group, enabled: boolean): void {
    _togglePBRDebugView(modelGroup, enabled, 0);
}

/**
 * Toggle metalness debug view — grayscale visualisation of metalness values.
 * Mutually exclusive with matcap, normals, and other debug views (shares _storedMaterials).
 */
export function updateModelMetalness(modelGroup: THREE.Group, enabled: boolean): void {
    _togglePBRDebugView(modelGroup, enabled, 1);
}

/**
 * Toggle specular F0 debug view — shows Fresnel reflectance at normal incidence.
 * Dielectrics show a dark ~0.04 value; metals show their base color.
 * Mutually exclusive with matcap, normals, and other debug views (shares _storedMaterials).
 */
export function updateModelSpecularF0(modelGroup: THREE.Group, enabled: boolean): void {
    _togglePBRDebugView(modelGroup, enabled, 2);
}

// =============================================================================
// E57 POINT CLOUD LOADING
// =============================================================================

/**
 * Load an E57 file and return a THREE.Group containing THREE.Points.
 * E57 files from surveying/scanning use Z-up convention, so we rotate
 * the geometry to Three.js Y-up coordinate system.
 */
export async function loadE57(url: string, onProgress?: (loaded: number, total: number) => void): Promise<THREE.Group> {
    const E57Loader = await getE57Loader();
    if (!E57Loader) {
        throw new Error('E57 point cloud loading is not available. The three-e57-loader module could not be loaded (requires network access).');
    }
    return new Promise((resolve, reject) => {
        const loader = new E57Loader();
        loader.load(
            url,
            (geometry: THREE.BufferGeometry) => {
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
            onProgress ? (event: any) => { if (event.lengthComputable) onProgress(event.loaded, event.total); } : undefined,
            (error: any) => {
                reject(error);
            }
        );
    });
}

/**
 * Load a point cloud from a File object
 */
export async function loadPointcloudFromFile(file: File, deps: LoadPointcloudDeps): Promise<void> {
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
            if ((child as any).isPoints && (child as any).geometry) {
                const posAttr = (child as any).geometry.getAttribute('position');
                if (posAttr) pointCount += posAttr.count;
            }
        });

        // Pre-compute hash for archive export
        const blob = (file as any).slice ? file : new Blob([file]);
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
 */
export async function loadPointcloudFromUrl(url: string, deps: LoadPointcloudDeps, onProgress: ProgressCallback = null): Promise<void> {
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
            if ((child as any).isPoints && (child as any).geometry) {
                const posAttr = (child as any).geometry.getAttribute('position');
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
 */
export async function loadPointcloudFromBlobUrl(blobUrl: string, fileName: string, deps: Pick<LoadPointcloudDeps, 'pointcloudGroup'>, onProgress?: (loaded: number, total: number) => void): Promise<PointcloudLoadResult> {
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

    const loadedObject = await loadE57(blobUrl, onProgress);
    pointcloudGroup.add(loadedObject);

    // Compute point count
    let pointCount = 0;
    loadedObject.traverse((child) => {
        if ((child as any).isPoints && (child as any).geometry) {
            const posAttr = (child as any).geometry.getAttribute('position');
            if (posAttr) pointCount += posAttr.count;
        }
    });

    return { object: loadedObject, pointCount };
}

/**
 * Update point cloud point size
 */
export function updatePointcloudPointSize(pointcloudGroup: THREE.Group, size: number): void {
    if (pointcloudGroup) {
        pointcloudGroup.traverse((child) => {
            if ((child as any).isPoints && (child as any).material) {
                (child as any).material.size = size;
                (child as any).material.needsUpdate = true;
            }
        });
    }
}

/**
 * Update point cloud opacity
 */
export function updatePointcloudOpacity(pointcloudGroup: THREE.Group, opacity: number): void {
    if (pointcloudGroup) {
        pointcloudGroup.traverse((child) => {
            if ((child as any).isPoints && (child as any).material) {
                (child as any).material.transparent = opacity < 1;
                (child as any).material.opacity = opacity;
                (child as any).material.needsUpdate = true;
            }
        });
    }
}
