// Archive Loader Module
// Handles loading and parsing of .a3d/.a3z archive containers
// These are ZIP-based containers with a manifest.json for 3D gaussian splats and meshes
//
// Uses slice-based random access: only the ZIP central directory is read on load.
// Individual files are decompressed on demand via File.slice() + fflate inflateSync().
// For File objects, the entire file is never read into memory at once.

import { inflateSync } from 'fflate';
import { Logger } from './utilities.js';

// Create logger for this module
const log = Logger.getLogger('ArchiveLoader');

// Supported archive extensions
const ARCHIVE_EXTENSIONS = ['a3d', 'a3z'];

// Supported file formats within archives
const SUPPORTED_FORMATS = {
    splat: ['.ply', '.spz', '.ksplat', '.sog', '.splat'],
    mesh: ['.glb', '.gltf', '.obj'],
    pointcloud: ['.e57'],
    thumbnail: ['.png', '.jpg', '.jpeg', '.webp']
};

// =============================================================================
// FILENAME SANITIZATION - Security measure to prevent path traversal attacks
// =============================================================================

/**
 * Sanitizes a filename from an archive to prevent path traversal attacks.
 * This is critical because archive manifests are untrusted user data.
 *
 * @param {string} filename - The filename to sanitize
 * @returns {{safe: boolean, sanitized: string, error: string}} Sanitization result
 */
function sanitizeArchiveFilename(filename) {
    if (!filename || typeof filename !== 'string') {
        return { safe: false, sanitized: '', error: 'Filename is empty or not a string' };
    }

    // Trim whitespace
    let sanitized = filename.trim();

    // Check for null bytes (can be used for path injection)
    if (sanitized.includes('\0')) {
        log.warn(' Blocked filename with null byte:', filename);
        return { safe: false, sanitized: '', error: 'Filename contains null bytes' };
    }

    // Normalize path separators (convert backslashes to forward slashes)
    sanitized = sanitized.replace(/\\/g, '/');

    // Remove any path traversal sequences
    // Handle various encodings: .., %2e%2e, %252e%252e
    const originalFilename = sanitized;
    sanitized = sanitized
        .replace(/%252e/gi, '.') // Double-encoded dots
        .replace(/%2e/gi, '.')   // URL-encoded dots
        .replace(/\.\.\//g, '')  // ../
        .replace(/\.\./g, '')    // .. (catch remaining)
        .replace(/\/\.\//g, '/') // /./
        .replace(/^\.\//g, '');  // ./  at start

    // Remove leading slashes (absolute path attempt)
    sanitized = sanitized.replace(/^\/+/, '');

    // Check if path traversal was attempted
    if (originalFilename !== sanitized && originalFilename.includes('..')) {
        log.warn(' Blocked path traversal attempt:', filename);
        return { safe: false, sanitized: '', error: 'Path traversal attempt detected' };
    }

    // Validate remaining characters - allow alphanumeric, underscore, hyphen, dot, forward slash
    // This allows subdirectories within the archive (e.g., "assets/model.glb")
    if (!/^[a-zA-Z0-9_\-\.\/]+$/.test(sanitized)) {
        log.warn(' Blocked filename with invalid characters:', filename);
        return { safe: false, sanitized: '', error: 'Filename contains invalid characters' };
    }

    // Ensure filename doesn't start with a dot (hidden files) unless it's an extension
    if (sanitized.startsWith('.') && !sanitized.startsWith('./')) {
        log.warn(' Blocked hidden file:', filename);
        return { safe: false, sanitized: '', error: 'Hidden files are not allowed' };
    }

    // Check for empty result after sanitization
    if (sanitized.length === 0) {
        return { safe: false, sanitized: '', error: 'Filename is empty after sanitization' };
    }

    // Check for reasonable length (prevent DoS with extremely long filenames)
    if (sanitized.length > 255) {
        log.warn(' Blocked overly long filename:', filename.substring(0, 50) + '...');
        return { safe: false, sanitized: '', error: 'Filename exceeds maximum length (255 characters)' };
    }

    return { safe: true, sanitized, error: '' };
}

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
 * Archive Loader class for handling .a3d/.a3z archive containers.
 *
 * Uses slice-based random access: when loaded from a File, only the ZIP
 * central directory is read (~64KB). Individual files are decompressed on
 * demand by reading their specific byte ranges via File.slice().
 * When loaded from an ArrayBuffer (URL fetch), the buffer is retained and
 * sliced in-memory. Decompressed files are cached for instant re-access.
 */
export class ArchiveLoader {
    constructor() {
        this._file = null;          // File/Blob reference for slice-based reading (from loadFromFile)
        this._rawData = null;       // Uint8Array - raw ZIP bytes (from loadFromArrayBuffer/loadFromUrl)
        this._fileCache = new Map(); // Map<string, Uint8Array> - decompressed file cache
        this._fileIndex = [];       // Array<{name, originalSize}> - from central directory scan
        this._centralDir = null;    // Map<string, {offset, compressedSize, uncompressedSize, method}>
        this.manifest = null;
        this.blobUrls = [];         // Track blob URLs for cleanup
    }

    /**
     * Check if archive data is available (either File reference or raw buffer).
     */
    get _hasData() {
        return !!(this._file || this._rawData);
    }

    /**
     * Backward-compatible getter: returns cached files as a plain object.
     * Returns null if no files have been cached yet.
     */
    get files() {
        if (this._fileCache.size === 0 && !this._hasData) return null;
        // Return a truthy object so existing `if (!this.files)` checks pass
        // when we have data but haven't cached anything yet
        if (this._hasData) {
            return this._fileCache.size > 0 ? Object.fromEntries(this._fileCache) : {};
        }
        return null;
    }

    /**
     * Load archive from a File object.
     * Only reads the ZIP central directory (~64KB) — does not read the full file.
     * @param {File} file - The archive file
     * @returns {Promise<void>}
     */
    async loadFromFile(file) {
        // Validate ZIP magic bytes by reading first 4 bytes
        const header = new Uint8Array(await file.slice(0, 4).arrayBuffer());
        if (header[0] !== 0x50 || header[1] !== 0x4B) {
            throw new Error('Invalid archive: Not a valid ZIP file');
        }

        // Store File reference — the full file is never read into memory
        this._file = file;
        this._rawData = null;
        this._fileCache = new Map();
        await this._parseCentralDirectory();
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
     * Load archive from an ArrayBuffer.
     * Only scans the central directory — no files are decompressed.
     * @param {ArrayBuffer} arrayBuffer - The archive data
     * @returns {Promise<void>}
     */
    async loadFromArrayBuffer(arrayBuffer) {
        // Validate ZIP magic bytes
        const header = new Uint8Array(arrayBuffer, 0, 4);
        if (header[0] !== 0x50 || header[1] !== 0x4B) {
            throw new Error('Invalid archive: Not a valid ZIP file');
        }

        // Store raw data for on-demand extraction (used when loaded via URL)
        this._rawData = new Uint8Array(arrayBuffer);
        this._file = null;
        this._fileCache = new Map();
        await this._parseCentralDirectory();
    }

    // =========================================================================
    // INTERNAL ZIP PARSING
    // =========================================================================

    /**
     * Read bytes from the archive source (File or raw buffer).
     * For File sources, only the requested range is read from disk.
     * For ArrayBuffer sources, returns a zero-copy subarray view.
     * @param {number} offset - Byte offset from start of archive
     * @param {number} length - Number of bytes to read
     * @returns {Promise<Uint8Array>} The requested bytes
     * @private
     */
    async _readBytes(offset, length) {
        if (length === 0) return new Uint8Array(0);
        if (this._file) {
            const slice = this._file.slice(offset, offset + length);
            return new Uint8Array(await slice.arrayBuffer());
        }
        if (this._rawData) {
            return this._rawData.subarray(offset, offset + length);
        }
        throw new Error('No archive data available');
    }

    /**
     * Parse the ZIP central directory to build a file index with byte offsets.
     * Supports ZIP64 for archives > 4GB or with > 65535 entries.
     * Only reads the end of the archive (central directory) — file data is not touched.
     * @private
     */
    async _parseCentralDirectory() {
        const fileSize = this._file ? this._file.size : this._rawData.length;

        // Read last ~65KB to find End of Central Directory record.
        // EOCD is 22 bytes minimum; with a ZIP comment it can be up to 22 + 65535 bytes.
        const tailSize = Math.min(fileSize, 65557);
        const tailOffset = fileSize - tailSize;
        const tail = await this._readBytes(tailOffset, tailSize);

        // Scan backwards for EOCD signature (0x06054b50)
        let eocdPos = -1;
        for (let i = tail.length - 22; i >= 0; i--) {
            if (tail[i] === 0x50 && tail[i + 1] === 0x4B &&
                tail[i + 2] === 0x05 && tail[i + 3] === 0x06) {
                eocdPos = i;
                break;
            }
        }
        if (eocdPos === -1) {
            throw new Error('Invalid archive: End of Central Directory not found');
        }

        const eocdView = new DataView(tail.buffer, tail.byteOffset + eocdPos, 22);
        let entryCount = eocdView.getUint16(10, true);
        let cdSize = eocdView.getUint32(12, true);
        let cdOffset = eocdView.getUint32(16, true);

        // Check for ZIP64 (values at their 32-bit max indicate ZIP64 is in use)
        if (cdOffset === 0xFFFFFFFF || entryCount === 0xFFFF) {
            // ZIP64 EOCD Locator is 20 bytes immediately before the EOCD
            const locPos = eocdPos - 20;
            if (locPos >= 0 &&
                tail[locPos] === 0x50 && tail[locPos + 1] === 0x4B &&
                tail[locPos + 2] === 0x06 && tail[locPos + 3] === 0x07) {
                const locView = new DataView(tail.buffer, tail.byteOffset + locPos, 20);
                const zip64EocdAbsOffset = Number(locView.getBigUint64(8, true));

                // Read ZIP64 EOCD Record (56 bytes minimum)
                const z64Eocd = await this._readBytes(zip64EocdAbsOffset, 56);
                const z64View = new DataView(z64Eocd.buffer, z64Eocd.byteOffset, 56);
                if (z64View.getUint32(0, true) !== 0x06064b50) {
                    throw new Error('Invalid ZIP64 End of Central Directory record');
                }

                entryCount = Number(z64View.getBigUint64(32, true));
                cdSize = Number(z64View.getBigUint64(40, true));
                cdOffset = Number(z64View.getBigUint64(48, true));
            }
        }

        // Read the central directory
        const cdData = await this._readBytes(cdOffset, cdSize);

        // Parse central directory entries
        this._centralDir = new Map();
        this._fileIndex = [];
        let pos = 0;
        const decoder = new TextDecoder();

        for (let i = 0; i < entryCount && pos + 46 <= cdData.length; i++) {
            const cdView = new DataView(cdData.buffer, cdData.byteOffset + pos);

            // Verify central directory file header signature (0x02014b50)
            if (cdView.getUint32(0, true) !== 0x02014b50) {
                log.warn(`Unexpected central directory entry at position ${pos}, stopping`);
                break;
            }

            const method = cdView.getUint16(10, true);
            let compressedSize = cdView.getUint32(20, true);
            let uncompressedSize = cdView.getUint32(24, true);
            const nameLen = cdView.getUint16(28, true);
            const extraLen = cdView.getUint16(30, true);
            const commentLen = cdView.getUint16(32, true);
            let localHeaderOffset = cdView.getUint32(42, true);

            const name = decoder.decode(cdData.subarray(pos + 46, pos + 46 + nameLen));

            // Parse ZIP64 extended info if any sizes/offset are at 32-bit max
            if (compressedSize === 0xFFFFFFFF || uncompressedSize === 0xFFFFFFFF ||
                localHeaderOffset === 0xFFFFFFFF) {
                const extraStart = pos + 46 + nameLen;
                const extraEnd = extraStart + extraLen;
                let ePos = extraStart;
                while (ePos + 4 <= extraEnd) {
                    const tag = cdData[ePos] | (cdData[ePos + 1] << 8);
                    const fieldSize = cdData[ePos + 2] | (cdData[ePos + 3] << 8);
                    if (tag === 0x0001) { // ZIP64 extended information
                        const eView = new DataView(cdData.buffer, cdData.byteOffset + ePos + 4, fieldSize);
                        let eOff = 0;
                        if (uncompressedSize === 0xFFFFFFFF && eOff + 8 <= fieldSize) {
                            uncompressedSize = Number(eView.getBigUint64(eOff, true));
                            eOff += 8;
                        }
                        if (compressedSize === 0xFFFFFFFF && eOff + 8 <= fieldSize) {
                            compressedSize = Number(eView.getBigUint64(eOff, true));
                            eOff += 8;
                        }
                        if (localHeaderOffset === 0xFFFFFFFF && eOff + 8 <= fieldSize) {
                            localHeaderOffset = Number(eView.getBigUint64(eOff, true));
                            eOff += 8;
                        }
                        break;
                    }
                    ePos += 4 + fieldSize;
                }
            }

            this._centralDir.set(name, {
                offset: localHeaderOffset,
                compressedSize,
                uncompressedSize,
                method
            });

            this._fileIndex.push({
                name,
                originalSize: uncompressedSize
            });

            pos += 46 + nameLen + extraLen + commentLen;
        }

        log.info(`Archive indexed: ${this._fileIndex.length} files`);
    }

    /**
     * Extract a single file from the archive, using the cache if available.
     * Reads only the specific byte range for the requested file.
     * @param {string} filename - The exact filename within the ZIP
     * @returns {Promise<Uint8Array|null>} The decompressed file data, or null if not found
     * @private
     */
    async _extractSingle(filename) {
        // Check cache first
        if (this._fileCache.has(filename)) {
            return this._fileCache.get(filename);
        }

        if (!this._hasData) {
            throw new Error('No archive loaded');
        }

        const entry = this._centralDir?.get(filename);
        if (!entry) {
            return null;
        }

        // Read local file header (30 bytes fixed) to get actual data offset.
        // The local header's extra field length can differ from the central directory's.
        const localHeader = await this._readBytes(entry.offset, 30);
        const lhView = new DataView(localHeader.buffer, localHeader.byteOffset, 30);

        // Verify local file header signature (0x04034b50)
        if (lhView.getUint32(0, true) !== 0x04034b50) {
            throw new Error(`Invalid local file header for ${filename}`);
        }

        const localNameLen = lhView.getUint16(26, true);
        const localExtraLen = lhView.getUint16(28, true);
        const dataOffset = entry.offset + 30 + localNameLen + localExtraLen;

        // Read only the compressed data for this file
        const compressedData = await this._readBytes(dataOffset, entry.compressedSize);

        // Decompress based on compression method
        let fileData;
        if (entry.method === 0) {
            // Stored (no compression) — use bytes directly
            fileData = compressedData;
        } else if (entry.method === 8) {
            // Deflate — decompress with fflate inflateSync
            fileData = inflateSync(compressedData, new Uint8Array(entry.uncompressedSize));
        } else {
            throw new Error(`Unsupported compression method ${entry.method} for ${filename}`);
        }

        // Cache for future access
        this._fileCache.set(filename, fileData);
        return fileData;
    }

    /**
     * Parse and validate the manifest.json from the archive
     * @returns {Promise<Object>} The parsed manifest
     */
    async parseManifest() {
        if (!this._hasData) {
            throw new Error('No archive loaded');
        }

        const manifestData = await this._extractSingle('manifest.json');
        if (!manifestData) {
            throw new Error('Invalid archive: manifest.json not found');
        }

        // Decode Uint8Array to string
        const manifestText = new TextDecoder().decode(manifestData);

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
     * Get the primary mesh entry (excludes proxy entries)
     * @returns {Object|null} The mesh entry or null
     */
    getMeshEntry() {
        const meshes = this.findEntriesByPrefix('mesh_');
        // Return the first non-proxy mesh entry
        for (const { key, entry } of meshes) {
            if (entry.lod !== 'proxy') return entry;
        }
        return meshes.length > 0 ? meshes[0].entry : null;
    }

    /**
     * Get the display proxy mesh entry if one exists
     * @returns {Object|null} The proxy mesh entry or null
     */
    getMeshProxyEntry() {
        const meshes = this.findEntriesByPrefix('mesh_');
        for (const { key, entry } of meshes) {
            if (entry.lod === 'proxy') return entry;
        }
        return null;
    }

    /**
     * Check if the archive has a display proxy for the mesh
     * @returns {boolean}
     */
    hasMeshProxy() {
        return this.getMeshProxyEntry() !== null;
    }

    /**
     * Get the primary point cloud entry
     * @returns {Object|null} The point cloud entry or null
     */
    getPointcloudEntry() {
        const pointclouds = this.findEntriesByPrefix('pointcloud_');
        return pointclouds.length > 0 ? pointclouds[0].entry : null;
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
     * Get all embedded image entries (used in annotation/description markdown)
     * @returns {Object[]} Array of image entry objects
     */
    getImageEntries() {
        return this.findEntriesByPrefix('image_').map(({ entry }) => entry);
    }

    /**
     * Get all source file entries (archived for preservation, not rendered)
     * @returns {Array<{key: string, entry: Object}>} Source file entries
     */
    getSourceFileEntries() {
        return this.findEntriesByPrefix('source_');
    }

    /**
     * Check if the archive contains source files
     * @returns {boolean}
     */
    hasSourceFiles() {
        return this.getSourceFileEntries().length > 0;
    }

    /**
     * Extract a file from the archive as a blob URL.
     * Decompresses on demand and caches the result.
     * @param {string} filename - The filename within the archive
     * @returns {Promise<{blob: Blob, url: string, name: string}|null>}
     */
    async extractFile(filename) {
        if (!this._hasData) {
            throw new Error('No archive loaded');
        }

        // SECURITY: Sanitize filename to prevent path traversal attacks
        const sanitization = sanitizeArchiveFilename(filename);
        if (!sanitization.safe) {
            log.error(` Rejected unsafe filename: ${filename} - ${sanitization.error}`);
            throw new Error(`Invalid filename in archive: ${sanitization.error}`);
        }

        const safeFilename = sanitization.sanitized;
        const fileData = await this._extractSingle(safeFilename);
        if (!fileData) {
            log.warn(` File not found in archive: ${safeFilename}`);
            return null;
        }

        // Convert Uint8Array to Blob
        const blob = new Blob([fileData]);
        const url = URL.createObjectURL(blob);
        this.blobUrls.push(url);

        return { blob, url, name: safeFilename };
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
     * Get annotations from manifest
     * @returns {Array} Array of annotation objects
     */
    getAnnotations() {
        if (!this.manifest) return [];
        return this.manifest.annotations || [];
    }

    /**
     * Get project info from manifest
     * @returns {Object|null} Project info
     */
    getProjectInfo() {
        if (!this.manifest) return null;
        return this.manifest.project || null;
    }

    /**
     * Get all entries with their details for UI display
     * @returns {Array<Object>} Entry details
     */
    getEntryList() {
        const entries = this.getDataEntries();
        const list = [];

        for (const [key, entry] of Object.entries(entries)) {
            // Sanitize filename for safe display
            const sanitization = sanitizeArchiveFilename(entry.file_name);
            const displayName = sanitization.safe ? sanitization.sanitized : '[invalid filename]';

            list.push({
                key,
                fileName: displayName,
                createdBy: entry.created_by || 'Unknown',
                createdByVersion: entry._created_by_version || '',
                parameters: entry._parameters || {}
            });
        }

        return list;
    }

    /**
     * Check if the archive contains viewable content
     * @returns {{hasSplat: boolean, hasMesh: boolean, hasPointcloud: boolean, hasThumbnail: boolean}}
     */
    getContentInfo() {
        const scene = this.getSceneEntry();
        const mesh = this.getMeshEntry();
        const meshProxy = this.getMeshProxyEntry();
        const pointcloud = this.getPointcloudEntry();
        const thumbnail = this.getThumbnailEntry();

        const sourceFiles = this.getSourceFileEntries();

        return {
            hasSplat: scene !== null && isFormatSupported(scene.file_name, 'splat'),
            hasMesh: mesh !== null && isFormatSupported(mesh.file_name, 'mesh'),
            hasMeshProxy: meshProxy !== null && isFormatSupported(meshProxy.file_name, 'mesh'),
            hasPointcloud: pointcloud !== null && isFormatSupported(pointcloud.file_name, 'pointcloud'),
            hasThumbnail: thumbnail !== null && isFormatSupported(thumbnail.file_name, 'thumbnail'),
            hasSourceFiles: sourceFiles.length > 0,
            sourceFileCount: sourceFiles.length
        };
    }

    // =========================================================================
    // LOD-READY & LAZY LOADING HELPERS
    // =========================================================================

    /**
     * Get the file index (names and sizes) without decompressing anything.
     * @returns {Array<{name: string, originalSize: number}>}
     */
    getFileIndex() {
        return this._fileIndex ? [...this._fileIndex] : [];
    }

    /**
     * Check if a specific file has already been extracted and cached.
     * @param {string} filename
     * @returns {boolean}
     */
    isFileCached(filename) {
        return this._fileCache.has(filename);
    }

    /**
     * Find entries by prefix with their cached/uncached status.
     * Useful for LOD: returns all scene_0, scene_1, etc. with their parameters and readiness.
     * @param {string} prefix - e.g., 'scene_', 'mesh_', 'pointcloud_'
     * @returns {Array<{key: string, entry: Object, cached: boolean}>}
     */
    findEntriesWithStatus(prefix) {
        const entries = this.findEntriesByPrefix(prefix);
        return entries.map(({ key, entry }) => ({
            key,
            entry,
            cached: this.isFileCached(entry.file_name)
        }));
    }

    /**
     * Pre-extract specific files into the cache (for background loading).
     * @param {Array<string>} filenames
     * @returns {Promise<void>}
     */
    async preExtract(filenames) {
        for (const filename of filenames) {
            if (!this._fileCache.has(filename)) {
                await this._extractSingle(filename);
            }
        }
    }

    /**
     * Release the raw ZIP data to free memory.
     * Call this after all needed assets have been extracted and cached.
     * After calling this, no new files can be extracted.
     */
    releaseRawData() {
        const hadData = this._hasData;
        this._rawData = null;
        this._file = null;
        if (hadData) {
            log.info('Raw archive data released to free memory');
        }
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
     * Full cleanup including raw data and file cache
     */
    dispose() {
        this.cleanup();
        this._rawData = null;
        this._file = null;
        this._centralDir = null;
        this._fileCache?.clear();
        this._fileCache = null;
        this._fileIndex = null;
        this.manifest = null;
    }
}

export default ArchiveLoader;
