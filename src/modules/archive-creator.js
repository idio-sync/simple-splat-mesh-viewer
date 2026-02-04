// Archive Creator Module
// Handles creating .a3d/.a3z archive containers
// Based on the U3DP Creator Python tool manifest schema

import { zip, strToU8 } from 'fflate';
import { Logger } from './utilities.js';

// Create logger for this module
const log = Logger.getLogger('archive-creator');

// Pre-computed hex lookup table for faster conversion
const HEX_CHARS = '0123456789abcdef';
const HEX_TABLE = new Array(256);
for (let i = 0; i < 256; i++) {
    HEX_TABLE[i] = HEX_CHARS[i >> 4] + HEX_CHARS[i & 0x0f];
}

// Check if Web Crypto API is available (requires secure context)
const CRYPTO_AVAILABLE = typeof crypto !== 'undefined' && crypto.subtle;

/**
 * Calculate SHA-256 hash of a Blob or ArrayBuffer
 * Uses streaming for large blobs to reduce memory pressure
 * @param {Blob|ArrayBuffer} data - The data to hash
 * @param {Function} onProgress - Optional progress callback
 * @returns {Promise<string>} Hex string of hash, or null if crypto unavailable
 */
async function calculateSHA256(data, onProgress = null) {
    if (!CRYPTO_AVAILABLE) {
        log.warn(' crypto.subtle not available (requires HTTPS). Skipping hash.');
        return null;
    }

    let buffer;
    if (data instanceof Blob) {
        // For large blobs, read in chunks to reduce memory pressure
        if (data.size > 10 * 1024 * 1024 && data.stream) {
            // Use streaming approach for files > 10MB
            return await calculateSHA256Streaming(data, onProgress);
        }
        buffer = await data.arrayBuffer();
    } else {
        buffer = data;
    }

    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);

    // Fast hex conversion using lookup table
    const hashArray = new Uint8Array(hashBuffer);
    let hex = '';
    for (let i = 0; i < hashArray.length; i++) {
        hex += HEX_TABLE[hashArray[i]];
    }
    return hex;
}

/**
 * Calculate SHA-256 using streaming for large files
 * This reduces peak memory usage
 */
async function calculateSHA256Streaming(blob, onProgress = null) {
    if (!CRYPTO_AVAILABLE) {
        log.warn(' crypto.subtle not available (requires HTTPS). Skipping hash.');
        return null;
    }

    const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB chunks
    const totalSize = blob.size;
    let processedSize = 0;

    // We need to accumulate chunks and hash at the end
    // Unfortunately, SubtleCrypto doesn't support incremental hashing
    // So we read in chunks but still need full buffer for hashing
    // The benefit is more responsive UI during the read phase

    const chunks = [];
    let offset = 0;

    while (offset < totalSize) {
        const end = Math.min(offset + CHUNK_SIZE, totalSize);
        const chunk = blob.slice(offset, end);
        const arrayBuffer = await chunk.arrayBuffer();
        chunks.push(new Uint8Array(arrayBuffer));

        processedSize = end;
        if (onProgress) {
            onProgress(processedSize / totalSize);
        }

        offset = end;

        // Yield to UI thread between chunks
        await new Promise(resolve => setTimeout(resolve, 0));
    }

    // Combine chunks
    const totalLength = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
    const combined = new Uint8Array(totalLength);
    let position = 0;
    for (const chunk of chunks) {
        combined.set(chunk, position);
        position += chunk.length;
    }

    // Hash the combined buffer
    const hashBuffer = await crypto.subtle.digest('SHA-256', combined.buffer);

    // Fast hex conversion
    const hashArray = new Uint8Array(hashBuffer);
    let hex = '';
    for (let i = 0; i < hashArray.length; i++) {
        hex += HEX_TABLE[hashArray[i]];
    }
    return hex;
}

/**
 * Archive Creator class for building .a3d/.a3z files
 */
export class ArchiveCreator {
    constructor() {
        this.manifest = this._createEmptyManifest();
        this.files = new Map(); // path -> { blob, originalName, hash? }
        this.annotations = [];
        this.hashCache = new Map(); // blob -> hash (for pre-computed hashes)
    }

    /**
     * Create an empty manifest with default structure
     */
    _createEmptyManifest() {
        return {
            container_version: "1.0",
            packer: "simple-splat-mesh-viewer",
            packer_version: "1.0.0",
            _creation_date: new Date().toISOString(),
            project: {
                title: "",
                id: "",
                license: "CC0",
                description: ""
            },
            provenance: {
                capture_date: "",
                capture_device: "",
                operator: "",
                location: "",
                convention_hints: []
            },
            data_entries: {},
            annotations: [],
            _meta: {}
        };
    }

    /**
     * Reset the creator to empty state
     * Note: hashCache is preserved to allow reuse of pre-computed hashes
     */
    reset() {
        this.manifest = this._createEmptyManifest();
        this.files.clear();
        this.annotations = [];
        // Don't clear hashCache - it can be reused across exports
    }

    /**
     * Pre-compute and cache a hash for a blob
     * Call this when loading files to speed up later export
     * @param {Blob} blob - The blob to hash
     * @returns {Promise<string|null>} The hash, or null if crypto unavailable
     */
    async precomputeHash(blob) {
        if (!CRYPTO_AVAILABLE) {
            return null;
        }
        if (this.hashCache.has(blob)) {
            return this.hashCache.get(blob);
        }
        log.debug(' Pre-computing hash for blob, size:', blob.size);
        const hash = await calculateSHA256(blob);
        if (hash) {
            this.hashCache.set(blob, hash);
            log.debug(' Hash pre-computed and cached');
        }
        return hash;
    }

    /**
     * Get cached hash for a blob, or null if not cached
     * @param {Blob} blob
     * @returns {string|null}
     */
    getCachedHash(blob) {
        return this.hashCache.get(blob) || null;
    }

    /**
     * Set project information
     * @param {Object} info - Project info
     */
    setProjectInfo({ title, id, license, description }) {
        if (title !== undefined) this.manifest.project.title = title;
        if (id !== undefined) this.manifest.project.id = id;
        if (license !== undefined) this.manifest.project.license = license;
        if (description !== undefined) this.manifest.project.description = description;
    }

    /**
     * Set provenance information
     * @param {Object} info - Provenance info
     */
    setProvenance({ captureDate, captureDevice, operator, location, conventions }) {
        if (captureDate !== undefined) this.manifest.provenance.capture_date = captureDate;
        if (captureDevice !== undefined) this.manifest.provenance.capture_device = captureDevice;
        if (operator !== undefined) this.manifest.provenance.operator = operator;
        if (location !== undefined) this.manifest.provenance.location = location;
        if (conventions !== undefined) {
            this.manifest.provenance.convention_hints = Array.isArray(conventions)
                ? conventions
                : conventions.split(',').map(c => c.trim()).filter(c => c);
        }
    }

    /**
     * Set custom fields in _meta
     * @param {Object} customFields - Key-value pairs
     */
    setCustomFields(customFields) {
        this.manifest._meta.custom_fields = { ...customFields };
    }

    /**
     * Add a custom field
     * @param {string} key - Field key
     * @param {string} value - Field value
     */
    addCustomField(key, value) {
        if (!this.manifest._meta.custom_fields) {
            this.manifest._meta.custom_fields = {};
        }
        this.manifest._meta.custom_fields[key] = value;
    }

    /**
     * Set container version
     * @param {string} version
     */
    setVersion(version) {
        this.manifest.container_version = version;
    }

    /**
     * Set custom metadata
     * @param {Object} meta
     */
    setMeta(meta) {
        this.manifest._meta = { ...this.manifest._meta, ...meta };
    }

    /**
     * Add a scene entry (splat file)
     * @param {Blob} blob - The file data
     * @param {string} fileName - Original filename
     * @param {Object} options - Additional options
     */
    addScene(blob, fileName, options = {}) {
        const index = this._countEntriesOfType('scene_');
        const entryKey = `scene_${index}`;
        const ext = fileName.split('.').pop().toLowerCase();
        const archivePath = `assets/scene_${index}.${ext}`;

        this.files.set(archivePath, { blob, originalName: fileName });

        this.manifest.data_entries[entryKey] = {
            file_name: archivePath,
            created_by: options.created_by || "unknown",
            _created_by_version: options.created_by_version || "",
            _source_notes: options.source_notes || "",
            _parameters: {
                position: options.position || [0, 0, 0],
                rotation: options.rotation || [0, 0, 0],
                scale: options.scale !== undefined ? options.scale : 1,
                ...(options.parameters || {})
            }
        };

        return entryKey;
    }

    /**
     * Update an existing scene entry's metadata
     * @param {number} index - Scene index (0-based)
     * @param {Object} metadata - Metadata to update
     */
    updateSceneMetadata(index, { createdBy, version, sourceNotes }) {
        const entryKey = `scene_${index}`;
        if (!this.manifest.data_entries[entryKey]) return false;

        if (createdBy !== undefined) this.manifest.data_entries[entryKey].created_by = createdBy;
        if (version !== undefined) this.manifest.data_entries[entryKey]._created_by_version = version;
        if (sourceNotes !== undefined) this.manifest.data_entries[entryKey]._source_notes = sourceNotes;
        return true;
    }

    /**
     * Add a mesh entry
     * @param {Blob} blob - The file data
     * @param {string} fileName - Original filename
     * @param {Object} options - Additional options
     */
    addMesh(blob, fileName, options = {}) {
        const index = this._countEntriesOfType('mesh_');
        const entryKey = `mesh_${index}`;
        const ext = fileName.split('.').pop().toLowerCase();
        const archivePath = `assets/mesh_${index}.${ext}`;

        this.files.set(archivePath, { blob, originalName: fileName });

        this.manifest.data_entries[entryKey] = {
            file_name: archivePath,
            created_by: options.created_by || "unknown",
            _created_by_version: options.created_by_version || "",
            _source_notes: options.source_notes || "",
            _parameters: {
                position: options.position || [0, 0, 0],
                rotation: options.rotation || [0, 0, 0],
                scale: options.scale !== undefined ? options.scale : 1,
                ...(options.parameters || {})
            }
        };

        return entryKey;
    }

    /**
     * Update an existing mesh entry's metadata
     * @param {number} index - Mesh index (0-based)
     * @param {Object} metadata - Metadata to update
     */
    updateMeshMetadata(index, { createdBy, version, sourceNotes }) {
        const entryKey = `mesh_${index}`;
        if (!this.manifest.data_entries[entryKey]) return false;

        if (createdBy !== undefined) this.manifest.data_entries[entryKey].created_by = createdBy;
        if (version !== undefined) this.manifest.data_entries[entryKey]._created_by_version = version;
        if (sourceNotes !== undefined) this.manifest.data_entries[entryKey]._source_notes = sourceNotes;
        return true;
    }

    /**
     * Add a thumbnail/preview image
     * @param {Blob} blob - The image data
     * @param {string} fileName - Original filename
     */
    addThumbnail(blob, fileName) {
        const index = this._countEntriesOfType('thumbnail_');
        const entryKey = `thumbnail_${index}`;
        const ext = fileName.split('.').pop().toLowerCase();
        const archivePath = `preview.${ext}`;

        this.files.set(archivePath, { blob, originalName: fileName });

        this.manifest.data_entries[entryKey] = {
            file_name: archivePath,
            created_by: this.manifest.packer
        };

        return entryKey;
    }

    /**
     * Count entries of a specific type
     */
    _countEntriesOfType(prefix) {
        return Object.keys(this.manifest.data_entries)
            .filter(k => k.startsWith(prefix))
            .length;
    }

    /**
     * Set quality statistics in _meta
     * @param {Object} stats - Quality statistics
     */
    setQualityStats({ splatCount, meshPolys, meshVerts, splatFileSize, meshFileSize }) {
        if (!this.manifest._meta.quality) {
            this.manifest._meta.quality = {};
        }
        if (splatCount !== undefined) this.manifest._meta.quality.splat_count = splatCount;
        if (meshPolys !== undefined) this.manifest._meta.quality.mesh_polygons = meshPolys;
        if (meshVerts !== undefined) this.manifest._meta.quality.mesh_vertices = meshVerts;
        if (splatFileSize !== undefined) this.manifest._meta.quality.splat_file_size = splatFileSize;
        if (meshFileSize !== undefined) this.manifest._meta.quality.mesh_file_size = meshFileSize;
    }

    /**
     * Get current quality stats from _meta
     * @returns {Object} Quality stats
     */
    getQualityStats() {
        return this.manifest._meta.quality || {};
    }

    /**
     * Get integrity data (hashes)
     * @returns {Object|null} Integrity data or null if not calculated
     */
    getIntegrity() {
        return this.manifest.integrity || null;
    }

    /**
     * Set annotations
     * @param {Array} annotations - Array of annotation objects
     */
    setAnnotations(annotations) {
        this.annotations = [...annotations];
        this.manifest.annotations = this.annotations;
    }

    /**
     * Add a single annotation
     * @param {Object} annotation
     */
    addAnnotation(annotation) {
        this.annotations.push(annotation);
        this.manifest.annotations = this.annotations;
    }

    /**
     * Capture current scene from viewer
     * @param {Object} viewerState - State from the viewer
     */
    captureFromViewer(viewerState) {
        const { splatBlob, splatFileName, splatTransform, splatMetadata,
                meshBlob, meshFileName, meshTransform, meshMetadata,
                annotations, qualityStats } = viewerState;

        if (splatBlob && splatFileName) {
            this.addScene(splatBlob, splatFileName, {
                position: splatTransform?.position || [0, 0, 0],
                rotation: splatTransform?.rotation || [0, 0, 0],
                scale: splatTransform?.scale || 1,
                created_by: splatMetadata?.createdBy || "unknown",
                created_by_version: splatMetadata?.version || "",
                source_notes: splatMetadata?.sourceNotes || ""
            });
        }

        if (meshBlob && meshFileName) {
            this.addMesh(meshBlob, meshFileName, {
                position: meshTransform?.position || [0, 0, 0],
                rotation: meshTransform?.rotation || [0, 0, 0],
                scale: meshTransform?.scale || 1,
                created_by: meshMetadata?.createdBy || "unknown",
                created_by_version: meshMetadata?.version || "",
                source_notes: meshMetadata?.sourceNotes || ""
            });
        }

        if (annotations && annotations.length > 0) {
            this.setAnnotations(annotations);
        }

        if (qualityStats) {
            this.setQualityStats(qualityStats);
        }
    }

    /**
     * Apply all metadata from a metadata panel form
     * @param {Object} metadata - Collected metadata from form
     */
    applyMetadata(metadata) {
        // Project info
        if (metadata.project) {
            this.setProjectInfo(metadata.project);
        }

        // Provenance
        if (metadata.provenance) {
            this.setProvenance(metadata.provenance);
        }

        // Asset metadata
        if (metadata.splatMetadata) {
            this.updateSceneMetadata(0, metadata.splatMetadata);
        }
        if (metadata.meshMetadata) {
            this.updateMeshMetadata(0, metadata.meshMetadata);
        }

        // Custom fields
        if (metadata.customFields && Object.keys(metadata.customFields).length > 0) {
            this.setCustomFields(metadata.customFields);
        }

        // Quality stats
        if (metadata.qualityStats) {
            this.setQualityStats(metadata.qualityStats);
        }
    }

    /**
     * Get a summary of current metadata for display
     * @returns {Object} Metadata summary
     */
    getMetadataSummary() {
        return {
            project: { ...this.manifest.project },
            provenance: { ...this.manifest.provenance },
            annotationCount: this.annotations.length,
            fileCount: this.files.size,
            hasIntegrity: !!this.manifest.integrity,
            customFields: this.manifest._meta.custom_fields || {},
            quality: this.manifest._meta.quality || {}
        };
    }

    /**
     * Calculate integrity hashes for all files
     * Runs hashes in parallel for better performance
     * @param {Function} onProgress - Optional progress callback
     * @returns {Promise<Object|null>} Hash mapping, or null if crypto unavailable
     */
    async calculateHashes(onProgress = null) {
        log.debug(' calculateHashes started, files:', this.files.size);

        // Check if crypto is available
        if (!CRYPTO_AVAILABLE) {
            log.warn(' crypto.subtle not available - skipping integrity hashes');
            log.warn(' Archive will be created without integrity verification');
            return null;
        }

        const entries = Array.from(this.files.entries());
        const totalSize = entries.reduce((sum, [, { blob }]) => sum + blob.size, 0);
        let processedSize = 0;

        // Check which files have cached hashes
        const cachedCount = entries.filter(([, { blob }]) => this.hashCache.has(blob)).length;
        log.debug(' Cached hashes available:', cachedCount, '/', entries.length);

        // Calculate all hashes in parallel (using cache when available)
        log.debug(' Starting hash calculations, total size:', totalSize);
        const startTime = performance.now();

        const hashPromises = entries.map(async ([path, { blob }]) => {
            // Check cache first
            const cachedHash = this.hashCache.get(blob);
            if (cachedHash) {
                log.debug(' Using cached hash for:', path);
                processedSize += blob.size;
                if (onProgress) {
                    onProgress(processedSize / totalSize);
                }
                return { path, hash: cachedHash };
            }

            log.debug(' Computing hash for:', path, 'size:', blob.size);
            const hash = await calculateSHA256(blob, (progress) => {
                // Individual file progress (for streaming)
            });

            // Cache the computed hash (only if valid)
            if (hash) {
                this.hashCache.set(blob, hash);
            }

            processedSize += blob.size;
            if (onProgress) {
                onProgress(processedSize / totalSize);
            }
            log.debug(' Hash complete for:', path);
            return { path, hash };
        });

        const results = await Promise.all(hashPromises);

        const hashes = {};
        for (const { path, hash } of results) {
            if (hash) {
                hashes[path] = hash;
            }
        }

        const elapsed = performance.now() - startTime;
        log.debug(` All file hashes calculated in ${elapsed.toFixed(0)}ms`);

        // Calculate manifest hash from all asset hashes
        log.debug(' Calculating manifest hash');
        const allHashes = Object.values(hashes).sort().join('');
        const manifestHash = await calculateSHA256(new TextEncoder().encode(allHashes));

        this.manifest.integrity = {
            algorithm: "SHA-256",
            manifest_hash: manifestHash,
            assets: hashes
        };

        log.debug(' All hashes calculated');
        return hashes;
    }

    /**
     * Generate the manifest JSON
     * @returns {string} JSON string
     */
    generateManifest() {
        // Update creation date
        this.manifest._creation_date = new Date().toISOString();

        return JSON.stringify(this.manifest, null, 2);
    }

    /**
     * Preview the manifest (for UI display)
     * @returns {Object} The manifest object
     */
    previewManifest() {
        return JSON.parse(this.generateManifest());
    }

    /**
     * Create the archive file using fflate for fast ZIP creation
     * @param {Object} options - Creation options
     * @param {Function} onProgress - Progress callback (percent, stage)
     * @returns {Promise<Blob>} The archive blob
     */
    async createArchive(options = {}, onProgress = null) {
        log.debug(' createArchive called with options:', options);
        const {
            format = 'a3d',
            includeHashes = true,
            compression = format === 'a3z' ? 'DEFLATE' : 'STORE'
        } = options;

        // Compression level: 0 = STORE, 6 = good balance for DEFLATE
        const defaultLevel = compression === 'DEFLATE' ? 6 : 0;
        log.debug(' Using compression:', compression, 'level:', defaultLevel);

        // Calculate hashes if requested (0-20% of progress)
        if (includeHashes) {
            log.debug(' Calculating hashes...');
            if (onProgress) onProgress(0, 'Calculating hashes...');
            await this.calculateHashes();
            log.debug(' Hashes calculated');
            if (onProgress) onProgress(20, 'Hashes complete');
        }

        // Build the fflate file structure
        log.debug(' Preparing files for fflate');
        if (onProgress) onProgress(includeHashes ? 20 : 0, 'Preparing archive...');

        const zipData = {};

        // Add manifest (always use light compression for JSON)
        log.debug(' Generating manifest');
        const manifestJson = this.generateManifest();
        zipData['manifest.json'] = [strToU8(manifestJson), { level: 6 }];

        // Convert blobs to Uint8Array and add to structure
        log.debug(' Converting files, count:', this.files.size);
        const entries = Array.from(this.files.entries());
        const totalSize = entries.reduce((sum, [, { blob }]) => sum + blob.size, 0);
        let convertedSize = 0;

        const baseProgress = includeHashes ? 25 : 5;
        const conversionRange = 15; // 25-40% for file conversion

        for (const [path, { blob }] of entries) {
            // Use STORE (level 0) for already-compressed formats
            const ext = path.split('.').pop().toLowerCase();
            const alreadyCompressed = ['glb', 'spz', 'sog', 'jpg', 'jpeg', 'png', 'webp'].includes(ext);
            const fileLevel = alreadyCompressed ? 0 : defaultLevel;

            log.debug(' Converting file:', path, 'size:', blob.size, 'level:', fileLevel);

            // Convert blob to Uint8Array
            const arrayBuffer = await blob.arrayBuffer();
            const uint8Array = new Uint8Array(arrayBuffer);

            zipData[path] = [uint8Array, { level: fileLevel }];

            convertedSize += blob.size;
            if (onProgress) {
                const conversionProgress = (convertedSize / totalSize) * conversionRange;
                onProgress(Math.round(baseProgress + conversionProgress), `Preparing: ${path}`);
            }
        }

        // Generate the archive using fflate (40-100% of progress)
        log.debug(' Generating zip archive with fflate...');
        if (onProgress) onProgress(baseProgress + conversionRange, 'Generating archive...');

        const startZipTime = performance.now();

        // fflate's zip() is callback-based, wrap in promise
        const zipResult = await new Promise((resolve, reject) => {
            zip(zipData, { level: defaultLevel }, (err, data) => {
                if (err) {
                    log.error(' fflate error:', err);
                    reject(err);
                } else {
                    resolve(data);
                }
            });
        });

        const zipElapsed = performance.now() - startZipTime;
        log.debug(` fflate ZIP generation took ${zipElapsed.toFixed(0)}ms`);

        // Convert Uint8Array to Blob
        const archiveBlob = new Blob([zipResult], { type: 'application/zip' });

        log.debug(' Archive generated, size:', archiveBlob.size);
        if (onProgress) onProgress(100, 'Complete');
        return archiveBlob;
    }

    /**
     * Download the archive
     * @param {Object} options - Creation options plus filename
     * @param {Function} onProgress - Progress callback (percent, stage)
     */
    async downloadArchive(options = {}, onProgress = null) {
        log.debug(' downloadArchive called with options:', options);
        const {
            filename = 'archive',
            format = 'a3d',
            ...createOptions
        } = options;

        log.debug(' Creating archive blob...');
        const blob = await this.createArchive({ format, ...createOptions }, onProgress);
        log.debug(' Archive blob created, size:', blob.size);

        const url = URL.createObjectURL(blob);
        log.debug(' Blob URL created:', url);

        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.${format}`;
        document.body.appendChild(a);
        log.debug(' Triggering download:', a.download);
        a.click();
        document.body.removeChild(a);

        URL.revokeObjectURL(url);
        log.debug(' Download triggered, URL revoked');
    }

    /**
     * Get file count
     * @returns {number}
     */
    getFileCount() {
        return this.files.size;
    }

    /**
     * Get list of files in the archive
     * @returns {Array<{path: string, size: number, originalName: string}>}
     */
    getFileList() {
        return Array.from(this.files.entries()).map(([path, { blob, originalName }]) => ({
            path,
            size: blob.size,
            originalName
        }));
    }

    /**
     * Check if archive is valid (has minimum required content)
     * @returns {{valid: boolean, errors: string[]}}
     */
    validate() {
        const errors = [];

        // Check for at least one viewable asset
        const hasScene = Object.keys(this.manifest.data_entries).some(k => k.startsWith('scene_'));
        const hasMesh = Object.keys(this.manifest.data_entries).some(k => k.startsWith('mesh_'));

        if (!hasScene && !hasMesh) {
            errors.push('Archive must contain at least one scene (splat) or mesh file');
        }

        // Check project info
        if (!this.manifest.project.title) {
            errors.push('Project title is required');
        }

        // Check that all referenced files exist
        for (const entry of Object.values(this.manifest.data_entries)) {
            if (!this.files.has(entry.file_name)) {
                errors.push(`Missing file: ${entry.file_name}`);
            }
        }

        return {
            valid: errors.length === 0,
            errors
        };
    }
}

/**
 * Capture a screenshot from a canvas element
 * @param {HTMLCanvasElement} canvas - The canvas to capture
 * @param {Object} options - Capture options
 * @returns {Promise<Blob>} The image blob
 */
export async function captureScreenshot(canvas, options = {}) {
    const {
        width = 1024,
        height = 1024,
        format = 'image/jpeg',
        quality = 0.9
    } = options;

    // Create a temporary canvas for resizing
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = width;
    tempCanvas.height = height;
    const ctx = tempCanvas.getContext('2d');

    // Draw the source canvas, cropping to square from center
    const srcWidth = canvas.width;
    const srcHeight = canvas.height;
    const minDim = Math.min(srcWidth, srcHeight);
    const srcX = (srcWidth - minDim) / 2;
    const srcY = (srcHeight - minDim) / 2;

    ctx.drawImage(
        canvas,
        srcX, srcY, minDim, minDim,
        0, 0, width, height
    );

    return new Promise(resolve => {
        tempCanvas.toBlob(resolve, format, quality);
    });
}

export default ArchiveCreator;
