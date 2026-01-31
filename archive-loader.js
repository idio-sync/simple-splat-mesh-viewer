// Archive Loader Module
// Handles loading and parsing of .a3d/.a3z archive containers
// These are ZIP-based containers with a manifest.json for 3D gaussian splats and meshes

import JSZip from 'jszip';

// Supported archive extensions
const ARCHIVE_EXTENSIONS = ['a3d', 'a3z'];

// Supported file formats within archives
const SUPPORTED_FORMATS = {
    splat: ['.ply', '.spz', '.ksplat', '.sog', '.splat'],
    mesh: ['.glb', '.gltf', '.obj'],
    thumbnail: ['.png', '.jpg', '.jpeg', '.webp']
};

/**
 * Check if a filename is an archive file
 * @param {string} filename - The filename to check
 * @returns {boolean} True if the file is an archive
 */
export function isArchiveFile(filename) {
    if (!filename) return false;
    const ext = filename.split('.').pop().toLowerCase();
    return ARCHIVE_EXTENSIONS.includes(ext);
}

/**
 * Get the file extension from a filename
 * @param {string} filename - The filename
 * @returns {string} The lowercase extension
 */
function getExtension(filename) {
    return '.' + filename.split('.').pop().toLowerCase();
}

/**
 * Check if a file format is supported for a given type
 * @param {string} filename - The filename to check
 * @param {string} type - The type ('splat', 'mesh', 'thumbnail')
 * @returns {boolean} True if supported
 */
function isFormatSupported(filename, type) {
    const ext = getExtension(filename);
    return SUPPORTED_FORMATS[type]?.includes(ext) || false;
}

/**
 * Archive Loader class for handling .a3d/.a3z archive containers
 */
export class ArchiveLoader {
    constructor() {
        this.zip = null;
        this.manifest = null;
        this.blobUrls = []; // Track blob URLs for cleanup
    }

    /**
     * Load archive from a File object
     * @param {File} file - The archive file
     * @returns {Promise<void>}
     */
    async loadFromFile(file) {
        const arrayBuffer = await file.arrayBuffer();
        await this.loadFromArrayBuffer(arrayBuffer);
    }

    /**
     * Load archive from a URL
     * @param {string} url - The URL to fetch
     * @param {function} onProgress - Optional progress callback (0-1)
     * @returns {Promise<void>}
     */
    async loadFromUrl(url, onProgress = null) {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`HTTP ${response.status}: ${response.statusText}`);
        }

        // If we can track progress
        if (onProgress && response.headers.get('content-length')) {
            const contentLength = parseInt(response.headers.get('content-length'), 10);
            const reader = response.body.getReader();
            const chunks = [];
            let receivedLength = 0;

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;
                chunks.push(value);
                receivedLength += value.length;
                onProgress(receivedLength / contentLength);
            }

            const arrayBuffer = new Uint8Array(receivedLength);
            let position = 0;
            for (const chunk of chunks) {
                arrayBuffer.set(chunk, position);
                position += chunk.length;
            }
            await this.loadFromArrayBuffer(arrayBuffer.buffer);
        } else {
            const arrayBuffer = await response.arrayBuffer();
            await this.loadFromArrayBuffer(arrayBuffer);
        }
    }

    /**
     * Load archive from an ArrayBuffer
     * @param {ArrayBuffer} arrayBuffer - The archive data
     * @returns {Promise<void>}
     */
    async loadFromArrayBuffer(arrayBuffer) {
        // Validate ZIP magic bytes
        const header = new Uint8Array(arrayBuffer, 0, 4);
        if (header[0] !== 0x50 || header[1] !== 0x4B) {
            throw new Error('Invalid archive: Not a valid ZIP file');
        }

        this.zip = await JSZip.loadAsync(arrayBuffer);
    }

    /**
     * Parse and validate the manifest.json from the archive
     * @returns {Promise<Object>} The parsed manifest
     */
    async parseManifest() {
        if (!this.zip) {
            throw new Error('No archive loaded');
        }

        const manifestFile = this.zip.file('manifest.json');
        if (!manifestFile) {
            throw new Error('Invalid archive: manifest.json not found');
        }

        const manifestText = await manifestFile.async('text');

        try {
            this.manifest = JSON.parse(manifestText);
        } catch (e) {
            throw new Error('Invalid archive: manifest.json is not valid JSON');
        }

        // Validate required fields
        if (!this.manifest.container_version) {
            throw new Error('Invalid manifest: missing container_version');
        }

        if (!this.manifest.data_entries) {
            throw new Error('Invalid manifest: missing data_entries');
        }

        return this.manifest;
    }

    /**
     * Get data entries from manifest
     * @returns {Object} The data_entries object
     */
    getDataEntries() {
        return this.manifest?.data_entries || {};
    }

    /**
     * Find entries by type prefix (e.g., 'scene_', 'mesh_', 'thumbnail_')
     * @param {string} prefix - The entry name prefix
     * @returns {Array<{key: string, entry: Object}>} Matching entries
     */
    findEntriesByPrefix(prefix) {
        const entries = this.getDataEntries();
        const results = [];

        for (const [key, entry] of Object.entries(entries)) {
            if (key.startsWith(prefix)) {
                results.push({ key, entry });
            }
        }

        // Sort by key to get scene_0, scene_1, etc. in order
        results.sort((a, b) => a.key.localeCompare(b.key));
        return results;
    }

    /**
     * Get the primary scene entry (splat)
     * @returns {Object|null} The scene entry or null
     */
    getSceneEntry() {
        const scenes = this.findEntriesByPrefix('scene_');
        return scenes.length > 0 ? scenes[0].entry : null;
    }

    /**
     * Get the primary mesh entry
     * @returns {Object|null} The mesh entry or null
     */
    getMeshEntry() {
        const meshes = this.findEntriesByPrefix('mesh_');
        return meshes.length > 0 ? meshes[0].entry : null;
    }

    /**
     * Get the primary thumbnail entry
     * @returns {Object|null} The thumbnail entry or null
     */
    getThumbnailEntry() {
        const thumbnails = this.findEntriesByPrefix('thumbnail_');
        return thumbnails.length > 0 ? thumbnails[0].entry : null;
    }

    /**
     * Extract a file from the archive as a blob URL
     * @param {string} filename - The filename within the archive
     * @returns {Promise<{blob: Blob, url: string, name: string}|null>}
     */
    async extractFile(filename) {
        if (!this.zip) {
            throw new Error('No archive loaded');
        }

        const file = this.zip.file(filename);
        if (!file) {
            console.warn(`[ArchiveLoader] File not found in archive: ${filename}`);
            return null;
        }

        const blob = await file.async('blob');
        const url = URL.createObjectURL(blob);
        this.blobUrls.push(url);

        return { blob, url, name: filename };
    }

    /**
     * Get transform/alignment data for an entry
     * @param {Object} entry - The data entry from manifest
     * @returns {Object} Transform data with position, rotation, scale
     */
    getEntryTransform(entry) {
        const params = entry?._parameters || {};
        return {
            position: params.position || [0, 0, 0],
            rotation: params.rotation || [0, 0, 0],
            scale: params.scale !== undefined ? params.scale : 1
        };
    }

    /**
     * Get global alignment data from manifest
     * @returns {Object|null} Alignment data or null
     */
    getGlobalAlignment() {
        // Check for alignment in manifest root or _parameters
        return this.manifest?.alignment ||
               this.manifest?._parameters?.alignment ||
               null;
    }

    /**
     * Get archive metadata summary
     * @returns {Object} Metadata summary
     */
    getMetadata() {
        if (!this.manifest) return null;

        return {
            version: this.manifest.container_version,
            packer: this.manifest.packer || 'Unknown',
            packerVersion: this.manifest.packer_version || '',
            createdAt: this.manifest._creation_date || this.manifest.created_at || null,
            conventionHints: this.manifest.convention_hints || [],
            meta: this.manifest._meta || {},
            parameters: this.manifest._parameters || {}
        };
    }

    /**
     * Get all entries with their details for UI display
     * @returns {Array<Object>} Entry details
     */
    getEntryList() {
        const entries = this.getDataEntries();
        const list = [];

        for (const [key, entry] of Object.entries(entries)) {
            list.push({
                key,
                fileName: entry.file_name,
                createdBy: entry.created_by || 'Unknown',
                createdByVersion: entry._created_by_version || '',
                parameters: entry._parameters || {}
            });
        }

        return list;
    }

    /**
     * Check if the archive contains viewable content
     * @returns {{hasSplat: boolean, hasMesh: boolean, hasThumbnail: boolean}}
     */
    getContentInfo() {
        const scene = this.getSceneEntry();
        const mesh = this.getMeshEntry();
        const thumbnail = this.getThumbnailEntry();

        return {
            hasSplat: scene !== null && isFormatSupported(scene.file_name, 'splat'),
            hasMesh: mesh !== null && isFormatSupported(mesh.file_name, 'mesh'),
            hasThumbnail: thumbnail !== null && isFormatSupported(thumbnail.file_name, 'thumbnail')
        };
    }

    /**
     * Clean up all created blob URLs
     */
    cleanup() {
        for (const url of this.blobUrls) {
            URL.revokeObjectURL(url);
        }
        this.blobUrls = [];
    }

    /**
     * Full cleanup including zip reference
     */
    dispose() {
        this.cleanup();
        this.zip = null;
        this.manifest = null;
    }
}

export default ArchiveLoader;
