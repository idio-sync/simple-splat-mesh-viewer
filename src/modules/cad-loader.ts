/**
 * CAD Loader Module
 *
 * Loads STEP (.step, .stp) and IGES (.iges, .igs) parametric CAD files
 * using occt-import-js (OpenCASCADE Technology compiled to WASM).
 *
 * Tessellation is handled internally by occt-import-js — the library
 * returns Three.js-ready Float32Array/Uint32Array buffers directly.
 * No manual BRep tessellation required.
 */

import * as THREE from 'three';
import { Logger } from './utilities.js';
import { getStore } from './asset-store.js';
import type { AppState } from '@/types.js';

const log = Logger.getLogger('cad-loader');

// ===== Singleton OCCT instance =====

let _occt: any = null;

async function getOCCT(): Promise<any> {
    if (_occt) return _occt;
    log.info('Initializing occt-import-js WASM...');
    const { default: occtimportjs } = await import('occt-import-js');
    // Serve WASM from server root — dev middleware and build plugin both place it at /occt-import-js.wasm
    _occt = await occtimportjs({
        locateFile: (filename: string) => filename.endsWith('.wasm') ? '/occt-import-js.wasm' : filename,
    });
    log.info('occt-import-js WASM ready');
    return _occt;
}

// ===== Types =====

export interface LoadCADDeps {
    cadGroup: THREE.Group;
    state: AppState;
    showLoading: (msg: string) => void;
    hideLoading: () => void;
}

export interface CADLoadResult {
    group: THREE.Group;
    meshCount: number;
}

// ===== Internal helpers =====

function getCADFormat(fileName: string): 'step' | 'iges' {
    const ext = fileName.split('.').pop()?.toLowerCase() ?? '';
    return (ext === 'iges' || ext === 'igs') ? 'iges' : 'step';
}

function buildThreeMesh(mesh: any): THREE.Mesh {
    const geometry = new THREE.BufferGeometry();

    geometry.setAttribute(
        'position',
        new THREE.Float32BufferAttribute(mesh.attributes.position.array, 3),
    );

    if (mesh.attributes.normal) {
        geometry.setAttribute(
            'normal',
            new THREE.Float32BufferAttribute(mesh.attributes.normal.array, 3),
        );
    }

    geometry.setIndex(new THREE.BufferAttribute(new Uint32Array(mesh.index.array), 1));

    if (!mesh.attributes.normal) {
        geometry.computeVertexNormals();
    }

    const material = new THREE.MeshPhongMaterial({
        color: mesh.color ? new THREE.Color(...(mesh.color as [number, number, number])) : 0xcccccc,
        side: THREE.DoubleSide,
        specular: 0x111111,
        shininess: 30,
    });

    return new THREE.Mesh(geometry, material);
}

function clearCADGroup(group: THREE.Group): void {
    while (group.children.length > 0) {
        const child = group.children[0] as THREE.Mesh;
        if (child.geometry) child.geometry.dispose();
        if (child.material) {
            const mat = child.material;
            if (Array.isArray(mat)) mat.forEach(m => m.dispose());
            else (mat as THREE.Material).dispose();
        }
        group.remove(child);
    }
}

// ===== Public API =====

export async function loadCADFromBuffer(
    buffer: ArrayBuffer,
    fileName: string,
    deps: LoadCADDeps,
): Promise<CADLoadResult> {
    const format = getCADFormat(fileName);
    log.info(`Loading ${format.toUpperCase()}: ${fileName}`);

    clearCADGroup(deps.cadGroup);

    const occt = await getOCCT();
    const uint8 = new Uint8Array(buffer);

    const result = format === 'step'
        ? occt.ReadStepFile(uint8, null)
        : occt.ReadIgesFile(uint8, null);

    if (!result.success || result.meshes.length === 0) {
        throw new Error(`No geometry found in ${format.toUpperCase()} file`);
    }

    for (const meshData of result.meshes) {
        deps.cadGroup.add(buildThreeMesh(meshData));
    }

    deps.state.cadLoaded = true;
    log.info(`CAD loaded: ${result.meshes.length} mesh(es)`);

    return { group: deps.cadGroup, meshCount: result.meshes.length };
}

export async function loadCADFromFile(file: File, deps: LoadCADDeps): Promise<CADLoadResult> {
    const buffer = await file.arrayBuffer();
    const store = getStore();
    store.cadBlob = file;
    store.cadFileName = file.name;
    return loadCADFromBuffer(buffer, file.name, deps);
}

export async function loadCADFromUrl(
    url: string,
    deps: LoadCADDeps,
): Promise<CADLoadResult> {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    const buffer = await response.arrayBuffer();
    const fileName = url.split('/').pop() || 'model.step';
    const store = getStore();
    store.cadBlob = new Blob([buffer]);
    store.cadFileName = fileName;
    return loadCADFromBuffer(buffer, fileName, deps);
}

export async function loadCADFromBlobUrl(
    blobUrl: string,
    fileName: string,
    deps: Pick<LoadCADDeps, 'cadGroup' | 'state'>,
): Promise<CADLoadResult> {
    const response = await fetch(blobUrl);
    const buffer = await response.arrayBuffer();
    return loadCADFromBuffer(buffer, fileName, {
        cadGroup: deps.cadGroup,
        state: deps.state,
        showLoading: () => {},
        hideLoading: () => {},
    });
}
