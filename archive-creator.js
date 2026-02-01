// Archive Creator Module
// Handles creating .a3d/.a3z archive containers
// Based on the U3DP Creator Python tool manifest schema

import JSZip from 'jszip';

/**
 * Calculate SHA-256 hash of a Blob or ArrayBuffer
 * @param {Blob|ArrayBuffer} data - The data to hash
 * @returns {Promise<string>} Hex string of hash
 */
async function calculateSHA256(data) {
    let buffer;
    if (data instanceof Blob) {
        buffer = await data.arrayBuffer();
    } else {
        buffer = data;
    }

    const hashBuffer = await crypto.subtle.digest('SHA-256', buffer);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Archive Creator class for building .a3d/.a3z files
 */
export class ArchiveCreator {
    constructor() {
        this.manifest = this._createEmptyManifest();
        this.files = new Map(); // path -> { blob, originalName }
        this.annotations = [];
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
            data_entries: {},
            annotations: [],
            _meta: {}
        };
    }

    /**
     * Reset the creator to empty state
     */
    reset() {
        this.manifest = this._createEmptyManifest();
        this.files.clear();
        this.annotations = [];
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
        const { splatBlob, splatFileName, splatTransform,
                meshBlob, meshFileName, meshTransform,
                annotations } = viewerState;

        if (splatBlob && splatFileName) {
            this.addScene(splatBlob, splatFileName, {
                position: splatTransform?.position || [0, 0, 0],
                rotation: splatTransform?.rotation || [0, 0, 0],
                scale: splatTransform?.scale || 1
            });
        }

        if (meshBlob && meshFileName) {
            this.addMesh(meshBlob, meshFileName, {
                position: meshTransform?.position || [0, 0, 0],
                rotation: meshTransform?.rotation || [0, 0, 0],
                scale: meshTransform?.scale || 1
            });
        }

        if (annotations && annotations.length > 0) {
            this.setAnnotations(annotations);
        }
    }

    /**
     * Calculate integrity hashes for all files
     * @returns {Promise<Object>} Hash mapping
     */
    async calculateHashes() {
        const hashes = {};

        for (const [path, { blob }] of this.files.entries()) {
            hashes[path] = await calculateSHA256(blob);
        }

        // Calculate manifest hash from all asset hashes
        const allHashes = Object.values(hashes).sort().join('');
        const manifestHash = await calculateSHA256(new TextEncoder().encode(allHashes));

        this.manifest.integrity = {
            algorithm: "SHA-256",
            manifest_hash: manifestHash,
            assets: hashes
        };

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
     * Create the archive file
     * @param {Object} options - Creation options
     * @returns {Promise<Blob>} The archive blob
     */
    async createArchive(options = {}) {
        const {
            format = 'a3d',
            includeHashes = true,
            compression = format === 'a3z' ? 'DEFLATE' : 'STORE'
        } = options;

        // Calculate hashes if requested
        if (includeHashes) {
            await this.calculateHashes();
        }

        const zip = new JSZip();

        // Add manifest
        const manifestJson = this.generateManifest();
        zip.file('manifest.json', manifestJson, {
            compression: 'DEFLATE'
        });

        // Add all files
        for (const [path, { blob }] of this.files.entries()) {
            // Use STORE for already-compressed formats, DEFLATE for others
            const ext = path.split('.').pop().toLowerCase();
            const alreadyCompressed = ['glb', 'spz', 'sog', 'jpg', 'jpeg', 'png', 'webp'].includes(ext);

            zip.file(path, blob, {
                compression: alreadyCompressed ? 'STORE' : compression
            });
        }

        // Generate the archive
        const archiveBlob = await zip.generateAsync({
            type: 'blob',
            compression: compression,
            compressionOptions: compression === 'DEFLATE' ? { level: 6 } : undefined
        });

        return archiveBlob;
    }

    /**
     * Download the archive
     * @param {Object} options - Creation options plus filename
     */
    async downloadArchive(options = {}) {
        const {
            filename = 'archive',
            format = 'a3d',
            ...createOptions
        } = options;

        const blob = await this.createArchive({ format, ...createOptions });
        const url = URL.createObjectURL(blob);

        const a = document.createElement('a');
        a.href = url;
        a.download = `${filename}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);

        URL.revokeObjectURL(url);
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
