/**
 * Asset Store Module — ES module singleton for asset blob state.
 *
 * Centralizes blob/file storage that was previously scattered as `let` variables
 * in main.js. Any module can import and read/write the store directly.
 *
 * Usage:
 *   import { getStore } from './modules/asset-store.js';
 *   const assets = getStore();
 *   assets.splatBlob = file;       // write
 *   if (assets.meshBlob) { ... }   // read
 */

import { Logger } from './utilities.js';

const log = Logger.getLogger('asset-store');

const store = {
    splatBlob: null,
    meshBlob: null,
    proxyMeshBlob: null,
    proxySplatBlob: null,
    pointcloudBlob: null,
    sourceFiles: []   // Array of { file: File|null, name: string, size: number, category: string, fromArchive: boolean }
};

/**
 * Get the asset store singleton.
 * @returns {Object} The mutable store object
 */
export function getStore() {
    return store;
}

/**
 * Reset all blob references and source files.
 * Useful when loading a new project/archive.
 */
export function resetBlobs() {
    store.splatBlob = null;
    store.meshBlob = null;
    store.proxyMeshBlob = null;
    store.proxySplatBlob = null;
    store.pointcloudBlob = null;
    store.sourceFiles = [];
    log.info('Asset store reset');
}
