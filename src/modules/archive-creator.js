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
export const CRYPTO_AVAILABLE = typeof crypto !== 'undefined' && crypto.subtle;

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
            relationships: {
                part_of: "",
                derived_from: "",
                replaces: "",
                related_objects: []
            },
            provenance: {
                capture_date: "",
                capture_device: "",
                device_serial: "",
                operator: "",
                operator_orcid: "",
                location: "",
                convention_hints: [],
                processing_software: [],
                processing_notes: ""
            },
            quality_metrics: {
                tier: "",
                accuracy_grade: "",
                capture_resolution: {
                    value: null,
                    unit: "mm",
                    type: "GSD"
                },
                alignment_error: {
                    value: null,
                    unit: "mm",
                    method: "RMSE"
                },
                scale_verification: "",
                data_quality: {
                    coverage_gaps: "",
                    reconstruction_areas: "",
                    color_calibration: "",
                    measurement_uncertainty: ""
                }
            },
            archival_record: {
                standard: "",
                title: "",
                alternate_titles: [],
                ids: {
                    accession_number: "",
                    siris_id: "",
                    uri: ""
                },
                creation: {
                    creator: "",
                    date_created: "",
                    period: "",
                    culture: ""
                },
                physical_description: {
                    medium: "",
                    dimensions: {
                        height: "",
                        width: "",
                        depth: ""
                    },
                    condition: ""
                },
                provenance: "",
                rights: {
                    copyright_status: "",
                    credit_line: ""
                },
                context: {
                    description: "",
                    location_history: ""
                },
                coverage: {
                    spatial: {
                        location_name: "",
                        coordinates: {
                            latitude: "",
                            longitude: ""
                        }
                    },
                    temporal: {
                        subject_period: "",
                        subject_date_circa: false
                    }
                }
            },
            material_standard: {
                workflow: "",
                occlusion_packed: false,
                color_space: "",
                normal_space: ""
            },
            viewer_settings: {
                single_sided: true,
                background_color: "#1a1a2e"
            },
            preservation: {
                format_registry: {
                    glb: "fmt/861",
                    obj: "fmt/935",
                    ply: "fmt/831",
                    e57: "fmt/643"
                },
                significant_properties: [],
                rendering_requirements: "",
                rendering_notes: ""
            },
            data_entries: {},
            annotations: [],
            version_history: [],
            _meta: {}
        };
    }

    /**
     * Generate a plain-text README for inclusion in the archive.
     * Written for maximum longevity: pure ASCII, no markup, no Unicode.
     * A reader in 50 or 200 years should be able to understand the archive
     * contents without any knowledge of this software.
     * @returns {string} Plain-text README content
     */
    _generateReadme() {
        const m = this.manifest;
        const lines = [];
        const W = 68; // line width for separators
        const sep = '='.repeat(W);
        const subsep = '-'.repeat(W);

        // -- Header --
        lines.push(sep);
        lines.push('ARCHIVE-3D CONTAINER');
        lines.push(sep);
        lines.push('');
        lines.push('This file is a self-contained archive of 3D scan data in the');
        lines.push('archive-3d format. It is a standard ZIP file. You can extract');
        lines.push('its contents with any ZIP utility on any operating system.');
        lines.push('');

        // -- Project --
        const hasProject = m.project.title || m.project.description;
        if (hasProject) {
            lines.push('PROJECT');
            lines.push(subsep);
            if (m.project.title) lines.push(`Title:       ${m.project.title}`);
            if (m.project.description) {
                // Strip asset: references and keep plain text only
                const desc = m.project.description
                    .replace(/!\[.*?\]\(asset:[^)]+\)/g, '')
                    .replace(/\n+/g, ' ')
                    .trim();
                if (desc) lines.push(`Description: ${desc}`);
            }
            if (m.project.license) lines.push(`License:     ${m.project.license}`);
            if (m.archival_record?.creation?.creator) {
                lines.push(`Creator:     ${m.archival_record.creation.creator}`);
            } else if (m.provenance.operator) {
                lines.push(`Operator:    ${m.provenance.operator}`);
            }
            if (m.provenance.capture_date) lines.push(`Captured:    ${m.provenance.capture_date}`);
            if (m.provenance.location) lines.push(`Location:    ${m.provenance.location}`);
            if (m.provenance.capture_device) lines.push(`Device:      ${m.provenance.capture_device}`);
            lines.push('');
        }

        // -- Contents --
        lines.push('CONTENTS');
        lines.push(subsep);
        lines.push('manifest.json    Structured metadata (JSON format)');

        // List data entry files with descriptions
        const formatLabels = {
            ply: 'Gaussian splat data (PLY format)',
            splat: 'Gaussian splat data',
            ksplat: 'Gaussian splat data',
            spz: 'Gaussian splat data (Spark compressed)',
            sog: 'Gaussian splat data (SOG format)',
            glb: '3D mesh (glTF Binary format)',
            gltf: '3D mesh (glTF format)',
            obj: '3D mesh (Wavefront OBJ format)',
            e57: 'Point cloud (ASTM E57 format)',
            jpg: 'Image',
            jpeg: 'Image',
            png: 'Image',
        };

        for (const [key, entry] of Object.entries(m.data_entries)) {
            const fname = entry.file_name;
            const ext = fname.split('.').pop().toLowerCase();
            let label = formatLabels[ext] || 'Data file';
            if (key.startsWith('thumbnail_')) label = 'Thumbnail preview';
            if (key.startsWith('image_')) label = 'Embedded image';
            const role = entry.role ? ` [${entry.role}]` : '';

            // Find size from this.files if available
            const fileInfo = this.files.get(fname);
            let sizeStr = '';
            if (fileInfo) {
                const bytes = fileInfo.blob.size;
                if (bytes >= 1024 * 1024) {
                    sizeStr = ` (${(bytes / (1024 * 1024)).toFixed(1)} MB)`;
                } else if (bytes >= 1024) {
                    sizeStr = ` (${(bytes / 1024).toFixed(0)} KB)`;
                }
            }
            const padded = (fname + sizeStr).padEnd(24);
            lines.push(`${padded} ${label}${role}`);
        }

        lines.push('README.txt'.padEnd(24) + ' This file');
        lines.push('');

        // Annotation count
        if (m.annotations && m.annotations.length > 0) {
            lines.push(`This archive contains ${m.annotations.length} spatial annotation(s)`);
            lines.push('stored in manifest.json.');
            lines.push('');
        }

        // -- Source files --
        const sourceEntries = Object.entries(m.data_entries)
            .filter(([key]) => key.startsWith('source_'));
        if (sourceEntries.length > 0) {
            lines.push('SOURCE FILES');
            lines.push(subsep);
            lines.push(`This archive contains ${sourceEntries.length} source file(s) preserved for archival:`);
            let totalSourceBytes = 0;
            const categoryLabels = {
                raw_photography: 'Raw Photography',
                processing_report: 'Processing Report',
                ground_control: 'Ground Control Points',
                calibration: 'Calibration Data',
                project_file: 'Project File',
                reference: 'Reference Material',
                other: 'Other'
            };
            for (const [, entry] of sourceEntries) {
                const bytes = entry.size_bytes || 0;
                totalSourceBytes += bytes;
                let sizeStr = '';
                if (bytes >= 1024 * 1024) {
                    sizeStr = `(${(bytes / (1024 * 1024)).toFixed(1)} MB)`;
                } else if (bytes >= 1024) {
                    sizeStr = `(${(bytes / 1024).toFixed(0)} KB)`;
                }
                const cat = entry.source_category ? `  [${categoryLabels[entry.source_category] || entry.source_category}]` : '';
                const name = entry.file_name || entry.original_name || 'unknown';
                lines.push(`  ${name}  ${sizeStr}${cat}`);
            }
            if (totalSourceBytes >= 1024 * 1024) {
                lines.push(`Total: ${(totalSourceBytes / (1024 * 1024)).toFixed(1)} MB`);
            }
            lines.push('');
        }

        // -- Technology Guide --
        lines.push('TECHNOLOGY GUIDE');
        lines.push(subsep);
        lines.push('The data files in this archive use open, documented formats.');
        lines.push('Below is a brief description of each, for reference:');
        lines.push('');

        // Only list formats that are actually present
        const presentExts = new Set();
        for (const entry of Object.values(m.data_entries)) {
            presentExts.add(entry.file_name.split('.').pop().toLowerCase());
        }

        if (presentExts.has('glb') || presentExts.has('gltf')) {
            lines.push('  glTF / GLB (Graphics Language Transmission Format)');
            lines.push('    An open standard by the Khronos Group for 3D models.');
            lines.push('    Contains geometry, materials, and textures. GLB is the');
            lines.push('    binary-packed variant. Widely supported by 3D software');
            lines.push('    including Blender, MeshLab, and most CAD tools.');
            lines.push('    Specification: https://www.khronos.org/gltf/');
            lines.push('');
        }
        if (presentExts.has('obj')) {
            lines.push('  OBJ (Wavefront OBJ)');
            lines.push('    A plain-text 3D geometry format. Contains vertices,');
            lines.push('    faces, and normals. Readable by virtually all 3D');
            lines.push('    software. Developed by Wavefront Technologies (1980s).');
            lines.push('');
        }
        if (presentExts.has('e57')) {
            lines.push('  E57 (ASTM E2807 standard)');
            lines.push('    A standardized format for 3D point cloud data from');
            lines.push('    laser scanners and other 3D imaging systems. Governed');
            lines.push('    by ASTM International. Supported by CloudCompare,');
            lines.push('    Leica Cyclone, Autodesk ReCap, and most survey tools.');
            lines.push('    Standard: ASTM E2807-11');
            lines.push('');
        }
        if (presentExts.has('ply') || presentExts.has('splat') || presentExts.has('ksplat') || presentExts.has('spz') || presentExts.has('sog')) {
            lines.push('  PLY / splat formats (Gaussian Splatting)');
            lines.push('    3D Gaussian Splatting is a rendering technique published');
            lines.push('    in 2023 that represents scenes as collections of 3D');
            lines.push('    Gaussian primitives. These formats store per-splat');
            lines.push('    attributes (position, covariance, color, opacity).');
            lines.push('    NOTE: This is a rapidly evolving technology. The splat');
            lines.push('    files in this archive are derived visualization products,');
            lines.push('    not primary measurement data. If these formats become');
            lines.push('    unreadable in the future, the mesh and/or point cloud');
            lines.push('    files in this archive preserve the underlying geometry.');
            lines.push('');
        }

        lines.push('  JSON (JavaScript Object Notation)');
        lines.push('    A plain-text data interchange format. The manifest.json');
        lines.push('    file contains all metadata, spatial annotations, and');
        lines.push('    alignment transforms. Readable by any text editor and');
        lines.push('    parseable by every modern programming language.');
        lines.push('    Specification: RFC 8259 / ECMA-404');
        lines.push('');

        // -- How To Use --
        lines.push('HOW TO USE THIS ARCHIVE');
        lines.push(subsep);
        lines.push('1. Extract the ZIP file using any standard tool:');
        lines.push('     unzip archive.a3d');
        lines.push('   or rename to .zip and use your OS built-in extractor.');
        lines.push('');
        lines.push('2. Open manifest.json in any text editor to read the full');
        lines.push('   metadata: project information, provenance, quality metrics,');
        lines.push('   spatial annotations, and alignment transforms.');
        lines.push('');
        lines.push('3. Open the 3D data files in appropriate software:');
        lines.push('   - GLB/glTF/OBJ meshes: Blender, MeshLab, or any 3D viewer');
        lines.push('   - E57 point clouds: CloudCompare, Leica Cyclone, ReCap');
        lines.push('   - PLY splat files: any Gaussian splatting viewer');
        lines.push('');
        lines.push('4. The alignment transforms in manifest.json (under each');
        lines.push('   data entry\'s _parameters field) record the position,');
        lines.push('   rotation, and scale needed to spatially register the');
        lines.push('   assets relative to each other.');
        lines.push('');

        // -- About This Format --
        lines.push('ABOUT THIS FORMAT');
        lines.push(subsep);
        lines.push(`Format:    archive-3d v${m.container_version}`);
        lines.push(`Created:   ${m._creation_date}`);
        lines.push(`Packer:    ${m.packer} v${m.packer_version}`);
        lines.push('');
        lines.push('The archive-3d format is an open container for bundling 3D');
        lines.push('scan data with structured metadata for long-term preservation.');
        lines.push('It uses standard ZIP compression and JSON metadata so that no');
        lines.push('specialized software is required to extract or inspect the');
        lines.push('contents.');
        lines.push('');
        lines.push('For the format specification, see:');
        lines.push('  https://github.com/idio-sync/archive-3d');
        lines.push('');

        return lines.join('\n');
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
    setProvenance({ captureDate, captureDevice, deviceSerial, operator, operatorOrcid, location, conventions, processingSoftware, processingNotes }) {
        if (captureDate !== undefined) this.manifest.provenance.capture_date = captureDate;
        if (captureDevice !== undefined) this.manifest.provenance.capture_device = captureDevice;
        if (deviceSerial !== undefined) this.manifest.provenance.device_serial = deviceSerial;
        if (operator !== undefined) this.manifest.provenance.operator = operator;
        if (operatorOrcid !== undefined) this.manifest.provenance.operator_orcid = operatorOrcid;
        if (location !== undefined) this.manifest.provenance.location = location;
        if (conventions !== undefined) {
            this.manifest.provenance.convention_hints = Array.isArray(conventions)
                ? conventions
                : conventions.split(',').map(c => c.trim()).filter(c => c);
        }
        if (processingSoftware !== undefined) {
            this.manifest.provenance.processing_software = Array.isArray(processingSoftware)
                ? processingSoftware
                : [];
        }
        if (processingNotes !== undefined) this.manifest.provenance.processing_notes = processingNotes;
    }

    /**
     * Set quality metrics
     * @param {Object} metrics - Quality metrics from form
     */
    setQualityMetrics(metrics) {
        if (!metrics) return;

        if (metrics.tier !== undefined) this.manifest.quality_metrics.tier = metrics.tier;
        if (metrics.accuracyGrade !== undefined) this.manifest.quality_metrics.accuracy_grade = metrics.accuracyGrade;
        if (metrics.scaleVerification !== undefined) this.manifest.quality_metrics.scale_verification = metrics.scaleVerification;

        if (metrics.captureResolution) {
            if (metrics.captureResolution.value !== undefined) {
                this.manifest.quality_metrics.capture_resolution.value = metrics.captureResolution.value;
            }
            if (metrics.captureResolution.unit !== undefined) {
                this.manifest.quality_metrics.capture_resolution.unit = metrics.captureResolution.unit;
            }
            if (metrics.captureResolution.type !== undefined) {
                this.manifest.quality_metrics.capture_resolution.type = metrics.captureResolution.type;
            }
        }

        if (metrics.alignmentError) {
            if (metrics.alignmentError.value !== undefined) {
                this.manifest.quality_metrics.alignment_error.value = metrics.alignmentError.value;
            }
            if (metrics.alignmentError.unit !== undefined) {
                this.manifest.quality_metrics.alignment_error.unit = metrics.alignmentError.unit;
            }
            if (metrics.alignmentError.method !== undefined) {
                this.manifest.quality_metrics.alignment_error.method = metrics.alignmentError.method;
            }
        }

        // Data quality / known limitations
        if (metrics.dataQuality) {
            if (metrics.dataQuality.coverageGaps !== undefined) {
                this.manifest.quality_metrics.data_quality.coverage_gaps = metrics.dataQuality.coverageGaps;
            }
            if (metrics.dataQuality.reconstructionAreas !== undefined) {
                this.manifest.quality_metrics.data_quality.reconstruction_areas = metrics.dataQuality.reconstructionAreas;
            }
            if (metrics.dataQuality.colorCalibration !== undefined) {
                this.manifest.quality_metrics.data_quality.color_calibration = metrics.dataQuality.colorCalibration;
            }
            if (metrics.dataQuality.measurementUncertainty !== undefined) {
                this.manifest.quality_metrics.data_quality.measurement_uncertainty = metrics.dataQuality.measurementUncertainty;
            }
        }
    }

    /**
     * Set archival record (Dublin Core)
     * @param {Object} record - Archival record from form
     */
    setArchivalRecord(record) {
        if (!record) return;

        if (record.standard !== undefined) this.manifest.archival_record.standard = record.standard;
        if (record.title !== undefined) this.manifest.archival_record.title = record.title;
        if (record.alternateTitles !== undefined) {
            this.manifest.archival_record.alternate_titles = Array.isArray(record.alternateTitles)
                ? record.alternateTitles
                : [];
        }
        if (record.provenance !== undefined) this.manifest.archival_record.provenance = record.provenance;

        if (record.ids) {
            if (record.ids.accessionNumber !== undefined) {
                this.manifest.archival_record.ids.accession_number = record.ids.accessionNumber;
            }
            if (record.ids.sirisId !== undefined) {
                this.manifest.archival_record.ids.siris_id = record.ids.sirisId;
            }
            if (record.ids.uri !== undefined) {
                this.manifest.archival_record.ids.uri = record.ids.uri;
            }
        }

        if (record.creation) {
            if (record.creation.creator !== undefined) {
                this.manifest.archival_record.creation.creator = record.creation.creator;
            }
            if (record.creation.dateCreated !== undefined) {
                this.manifest.archival_record.creation.date_created = record.creation.dateCreated;
            }
            if (record.creation.period !== undefined) {
                this.manifest.archival_record.creation.period = record.creation.period;
            }
            if (record.creation.culture !== undefined) {
                this.manifest.archival_record.creation.culture = record.creation.culture;
            }
        }

        if (record.physicalDescription) {
            if (record.physicalDescription.medium !== undefined) {
                this.manifest.archival_record.physical_description.medium = record.physicalDescription.medium;
            }
            if (record.physicalDescription.condition !== undefined) {
                this.manifest.archival_record.physical_description.condition = record.physicalDescription.condition;
            }
            if (record.physicalDescription.dimensions) {
                if (record.physicalDescription.dimensions.height !== undefined) {
                    this.manifest.archival_record.physical_description.dimensions.height = record.physicalDescription.dimensions.height;
                }
                if (record.physicalDescription.dimensions.width !== undefined) {
                    this.manifest.archival_record.physical_description.dimensions.width = record.physicalDescription.dimensions.width;
                }
                if (record.physicalDescription.dimensions.depth !== undefined) {
                    this.manifest.archival_record.physical_description.dimensions.depth = record.physicalDescription.dimensions.depth;
                }
            }
        }

        if (record.rights) {
            if (record.rights.copyrightStatus !== undefined) {
                this.manifest.archival_record.rights.copyright_status = record.rights.copyrightStatus;
            }
            if (record.rights.creditLine !== undefined) {
                this.manifest.archival_record.rights.credit_line = record.rights.creditLine;
            }
        }

        if (record.context) {
            if (record.context.description !== undefined) {
                this.manifest.archival_record.context.description = record.context.description;
            }
            if (record.context.locationHistory !== undefined) {
                this.manifest.archival_record.context.location_history = record.context.locationHistory;
            }
        }

        // Geographic/temporal coverage
        if (record.coverage) {
            if (record.coverage.spatial) {
                if (record.coverage.spatial.locationName !== undefined) {
                    this.manifest.archival_record.coverage.spatial.location_name = record.coverage.spatial.locationName;
                }
                if (record.coverage.spatial.coordinates) {
                    if (record.coverage.spatial.coordinates.latitude !== undefined) {
                        this.manifest.archival_record.coverage.spatial.coordinates.latitude = record.coverage.spatial.coordinates.latitude;
                    }
                    if (record.coverage.spatial.coordinates.longitude !== undefined) {
                        this.manifest.archival_record.coverage.spatial.coordinates.longitude = record.coverage.spatial.coordinates.longitude;
                    }
                }
            }
            if (record.coverage.temporal) {
                if (record.coverage.temporal.subjectPeriod !== undefined) {
                    this.manifest.archival_record.coverage.temporal.subject_period = record.coverage.temporal.subjectPeriod;
                }
                if (record.coverage.temporal.subjectDateCirca !== undefined) {
                    this.manifest.archival_record.coverage.temporal.subject_date_circa = record.coverage.temporal.subjectDateCirca;
                }
            }
        }
    }

    /**
     * Set viewer settings (display defaults)
     * @param {Object} settings - Viewer settings from form
     */
    setViewerSettings(settings) {
        if (!settings) return;

        if (settings.singleSided !== undefined) this.manifest.viewer_settings.single_sided = settings.singleSided;
        if (settings.backgroundColor !== undefined) this.manifest.viewer_settings.background_color = settings.backgroundColor;
    }

    /**
     * Set material standard (PBR)
     * @param {Object} material - Material standard from form
     */
    setMaterialStandard(material) {
        if (!material) return;

        if (material.workflow !== undefined) this.manifest.material_standard.workflow = material.workflow;
        if (material.occlusionPacked !== undefined) this.manifest.material_standard.occlusion_packed = material.occlusionPacked;
        if (material.colorSpace !== undefined) this.manifest.material_standard.color_space = material.colorSpace;
        if (material.normalSpace !== undefined) this.manifest.material_standard.normal_space = material.normalSpace;
    }

    /**
     * Set relationship links
     * @param {Object} relationships - Relationship data from form
     */
    setRelationships(relationships) {
        if (!relationships) return;

        if (relationships.partOf !== undefined) this.manifest.relationships.part_of = relationships.partOf;
        if (relationships.derivedFrom !== undefined) this.manifest.relationships.derived_from = relationships.derivedFrom;
        if (relationships.replaces !== undefined) this.manifest.relationships.replaces = relationships.replaces;
        if (relationships.relatedObjects !== undefined) {
            this.manifest.relationships.related_objects = Array.isArray(relationships.relatedObjects)
                ? relationships.relatedObjects
                : [];
        }
    }

    /**
     * Set preservation metadata (PREMIS-inspired)
     * @param {Object} preservation - Preservation data from form
     */
    setPreservation(preservation) {
        if (!preservation) return;

        if (preservation.formatRegistry) {
            if (preservation.formatRegistry.glb !== undefined) {
                this.manifest.preservation.format_registry.glb = preservation.formatRegistry.glb;
            }
            if (preservation.formatRegistry.obj !== undefined) {
                this.manifest.preservation.format_registry.obj = preservation.formatRegistry.obj;
            }
            if (preservation.formatRegistry.ply !== undefined) {
                this.manifest.preservation.format_registry.ply = preservation.formatRegistry.ply;
            }
            if (preservation.formatRegistry.e57 !== undefined) {
                this.manifest.preservation.format_registry.e57 = preservation.formatRegistry.e57;
            }
        }

        if (preservation.significantProperties !== undefined) {
            this.manifest.preservation.significant_properties = Array.isArray(preservation.significantProperties)
                ? preservation.significantProperties
                : [];
        }

        if (preservation.renderingRequirements !== undefined) {
            this.manifest.preservation.rendering_requirements = preservation.renderingRequirements;
        }
        if (preservation.renderingNotes !== undefined) {
            this.manifest.preservation.rendering_notes = preservation.renderingNotes;
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
            role: options.role || "",
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
    updateSceneMetadata(index, { createdBy, version, sourceNotes, role }) {
        const entryKey = `scene_${index}`;
        if (!this.manifest.data_entries[entryKey]) return false;

        if (createdBy !== undefined) this.manifest.data_entries[entryKey].created_by = createdBy;
        if (version !== undefined) this.manifest.data_entries[entryKey]._created_by_version = version;
        if (sourceNotes !== undefined) this.manifest.data_entries[entryKey]._source_notes = sourceNotes;
        if (role !== undefined) this.manifest.data_entries[entryKey].role = role;
        return true;
    }

    /**
     * Add a display proxy scene (splat) entry (pre-simplified LOD variant)
     * @param {Blob} blob - The proxy splat file data
     * @param {string} fileName - Original filename
     * @param {Object} options - Additional options (derived_from, etc.)
     */
    addSceneProxy(blob, fileName, options = {}) {
        const derivedFrom = options.derived_from || 'scene_0';
        const entryKey = `${derivedFrom}_proxy`;
        const ext = fileName.split('.').pop().toLowerCase();
        const archivePath = `assets/${entryKey}.${ext}`;

        this.files.set(archivePath, { blob, originalName: fileName });

        this.manifest.data_entries[entryKey] = {
            file_name: archivePath,
            created_by: options.created_by || "unknown",
            _created_by_version: options.created_by_version || "",
            _source_notes: options.source_notes || "",
            role: "derived",
            lod: "proxy",
            derived_from: derivedFrom,
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
            _source_notes: options.source_notes || "",
            role: options.role || "",
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
    updateMeshMetadata(index, { createdBy, version, sourceNotes, role }) {
        const entryKey = `mesh_${index}`;
        if (!this.manifest.data_entries[entryKey]) return false;

        if (createdBy !== undefined) this.manifest.data_entries[entryKey].created_by = createdBy;
        if (version !== undefined) this.manifest.data_entries[entryKey]._created_by_version = version;
        if (sourceNotes !== undefined) this.manifest.data_entries[entryKey]._source_notes = sourceNotes;
        if (role !== undefined) this.manifest.data_entries[entryKey].role = role;
        return true;
    }

    /**
     * Add a display proxy mesh entry (pre-simplified LOD variant)
     * @param {Blob} blob - The proxy mesh file data
     * @param {string} fileName - Original filename
     * @param {Object} options - Additional options (derived_from, face_count, etc.)
     */
    addMeshProxy(blob, fileName, options = {}) {
        // Find the primary mesh index this proxy derives from
        const derivedFrom = options.derived_from || 'mesh_0';
        const entryKey = `${derivedFrom}_proxy`;
        const ext = fileName.split('.').pop().toLowerCase();
        const archivePath = `assets/${entryKey}.${ext}`;

        this.files.set(archivePath, { blob, originalName: fileName });

        this.manifest.data_entries[entryKey] = {
            file_name: archivePath,
            created_by: options.created_by || "unknown",
            _created_by_version: options.created_by_version || "",
            _source_notes: options.source_notes || "",
            role: "derived",
            lod: "proxy",
            derived_from: derivedFrom,
            _parameters: {
                position: options.position || [0, 0, 0],
                rotation: options.rotation || [0, 0, 0],
                scale: options.scale !== undefined ? options.scale : 1,
                ...(options.parameters || {})
            }
        };

        if (options.face_count !== undefined) {
            this.manifest.data_entries[entryKey].face_count = options.face_count;
        }

        return entryKey;
    }

    /**
     * Add a point cloud entry (E57 file)
     * @param {Blob} blob - The file data
     * @param {string} fileName - Original filename
     * @param {Object} options - Additional options
     */
    addPointcloud(blob, fileName, options = {}) {
        const index = this._countEntriesOfType('pointcloud_');
        const entryKey = `pointcloud_${index}`;
        const ext = fileName.split('.').pop().toLowerCase();
        const archivePath = `assets/pointcloud_${index}.${ext}`;

        this.files.set(archivePath, { blob, originalName: fileName });

        this.manifest.data_entries[entryKey] = {
            file_name: archivePath,
            created_by: options.created_by || "unknown",
            _created_by_version: options.created_by_version || "",
            _source_notes: options.source_notes || "",
            role: options.role || "",
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
     * Update an existing point cloud entry's metadata
     * @param {number} index - Pointcloud index (0-based)
     * @param {Object} metadata - Metadata to update
     */
    updatePointcloudMetadata(index, { createdBy, version, sourceNotes, role }) {
        const entryKey = `pointcloud_${index}`;
        if (!this.manifest.data_entries[entryKey]) return false;

        if (createdBy !== undefined) this.manifest.data_entries[entryKey].created_by = createdBy;
        if (version !== undefined) this.manifest.data_entries[entryKey]._created_by_version = version;
        if (sourceNotes !== undefined) this.manifest.data_entries[entryKey]._source_notes = sourceNotes;
        if (role !== undefined) this.manifest.data_entries[entryKey].role = role;
        return true;
    }

    /**
     * Add a source file for archival preservation (not rendered in viewer)
     * @param {Blob} blob - The file data
     * @param {string} fileName - Original filename
     * @param {Object} options - Additional options (category, etc.)
     * @returns {string} The entry key
     */
    addSourceFile(blob, fileName, options = {}) {
        const index = this._countEntriesOfType('source_');
        const entryKey = `source_${index}`;

        // Sanitize filename, preserving extension
        const sanitized = fileName.replace(/[^a-zA-Z0-9._-]/g, '_').replace(/_{2,}/g, '_');
        let archivePath = `sources/${sanitized}`;

        // Handle duplicate filenames
        if (this.files.has(archivePath)) {
            const dotIdx = sanitized.lastIndexOf('.');
            const base = dotIdx > 0 ? sanitized.slice(0, dotIdx) : sanitized;
            const ext = dotIdx > 0 ? sanitized.slice(dotIdx) : '';
            archivePath = `sources/${base}_${index}${ext}`;
        }

        this.files.set(archivePath, { blob, originalName: fileName });

        this.manifest.data_entries[entryKey] = {
            file_name: archivePath,
            original_name: fileName,
            role: "source",
            source_category: options.category || "",
            size_bytes: blob.size
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
     * Add a screenshot to the archive
     * @param {Blob} blob - The image data
     * @param {string} fileName - Original filename
     */
    addScreenshot(blob, fileName) {
        const index = this._countEntriesOfType('screenshot_');
        const entryKey = `screenshot_${index}`;
        const ext = fileName.split('.').pop().toLowerCase();
        const archivePath = `screenshots/${entryKey}.${ext}`;

        this.files.set(archivePath, { blob, originalName: fileName });

        this.manifest.data_entries[entryKey] = {
            file_name: archivePath,
            created_by: this.manifest.packer
        };

        return entryKey;
    }

    /**
     * Add an embedded image (used in annotation/description markdown)
     * @param {Blob} blob - The image data
     * @param {string} archivePath - Path within archive (e.g., 'images/photo.jpg')
     */
    addImage(blob, archivePath) {
        const index = this._countEntriesOfType('image_');
        const entryKey = `image_${index}`;

        this.files.set(archivePath, { blob, originalName: archivePath });

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
    setQualityStats({ splatCount, meshPolys, meshVerts, splatFileSize, meshFileSize, pointcloudPoints, pointcloudFileSize }) {
        if (!this.manifest._meta.quality) {
            this.manifest._meta.quality = {};
        }
        if (splatCount !== undefined) this.manifest._meta.quality.splat_count = splatCount;
        if (meshPolys !== undefined) this.manifest._meta.quality.mesh_polygons = meshPolys;
        if (meshVerts !== undefined) this.manifest._meta.quality.mesh_vertices = meshVerts;
        if (splatFileSize !== undefined) this.manifest._meta.quality.splat_file_size = splatFileSize;
        if (meshFileSize !== undefined) this.manifest._meta.quality.mesh_file_size = meshFileSize;
        if (pointcloudPoints !== undefined) this.manifest._meta.quality.pointcloud_points = pointcloudPoints;
        if (pointcloudFileSize !== undefined) this.manifest._meta.quality.pointcloud_file_size = pointcloudFileSize;
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
     * Set version history entries
     * @param {Array} entries - Array of {version, date, description}
     */
    setVersionHistory(entries) {
        this.manifest.version_history = Array.isArray(entries) ? [...entries] : [];
    }

    /**
     * Add a single version history entry
     * @param {Object} entry - {version, date, description}
     */
    addVersionHistoryEntry(entry) {
        if (!this.manifest.version_history) {
            this.manifest.version_history = [];
        }
        this.manifest.version_history.push({
            version: entry.version || '',
            date: entry.date || new Date().toISOString().split('T')[0],
            description: entry.description || ''
        });
    }

    /**
     * Capture current scene from viewer
     * @param {Object} viewerState - State from the viewer
     */
    captureFromViewer(viewerState) {
        const { splatBlob, splatFileName, splatTransform, splatMetadata,
                meshBlob, meshFileName, meshTransform, meshMetadata,
                pointcloudBlob, pointcloudFileName, pointcloudTransform, pointcloudMetadata,
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

        if (pointcloudBlob && pointcloudFileName) {
            this.addPointcloud(pointcloudBlob, pointcloudFileName, {
                position: pointcloudTransform?.position || [0, 0, 0],
                rotation: pointcloudTransform?.rotation || [0, 0, 0],
                scale: pointcloudTransform?.scale || 1,
                created_by: pointcloudMetadata?.createdBy || "unknown",
                created_by_version: pointcloudMetadata?.version || "",
                source_notes: pointcloudMetadata?.sourceNotes || ""
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

        // Relationships
        if (metadata.relationships) {
            this.setRelationships(metadata.relationships);
        }

        // Provenance
        if (metadata.provenance) {
            this.setProvenance(metadata.provenance);
        }

        // Quality Metrics
        if (metadata.qualityMetrics) {
            this.setQualityMetrics(metadata.qualityMetrics);
        }

        // Archival Record (Dublin Core)
        if (metadata.archivalRecord) {
            this.setArchivalRecord(metadata.archivalRecord);
        }

        // Material Standard (PBR)
        if (metadata.materialStandard) {
            this.setMaterialStandard(metadata.materialStandard);
        }

        // Viewer settings
        if (metadata.viewerSettings) {
            this.setViewerSettings(metadata.viewerSettings);
        }

        // Preservation metadata
        if (metadata.preservation) {
            this.setPreservation(metadata.preservation);
        }

        // Asset metadata
        if (metadata.splatMetadata) {
            this.updateSceneMetadata(0, metadata.splatMetadata);
        }
        if (metadata.meshMetadata) {
            this.updateMeshMetadata(0, metadata.meshMetadata);
        }
        if (metadata.pointcloudMetadata) {
            this.updatePointcloudMetadata(0, metadata.pointcloudMetadata);
        }

        // Custom fields
        if (metadata.customFields && Object.keys(metadata.customFields).length > 0) {
            this.setCustomFields(metadata.customFields);
        }

        // Version history
        if (metadata.versionHistory && metadata.versionHistory.length > 0) {
            this.setVersionHistory(metadata.versionHistory);
        }

        // Quality stats (read-only computed stats)
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

        // Add plain-text README for long-term discoverability
        const readmeText = this._generateReadme();
        zipData['README.txt'] = [strToU8(readmeText), { level: 6 }];

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
            const alreadyCompressed = ['glb', 'spz', 'sog', 'jpg', 'jpeg', 'png', 'webp', 'e57'].includes(ext);
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

        const downloadName = `${filename}.${format}`;

        // Try Tauri native save dialog first
        if (window.__TAURI__) {
            try {
                const { save } = window.__TAURI__.dialog;
                const { writeFile } = window.__TAURI__.fs;
                const path = await save({
                    title: 'Save Archive',
                    defaultPath: downloadName,
                    filters: [{ name: '3D Archive', extensions: [format] }],
                });
                if (path) {
                    const buffer = new Uint8Array(await blob.arrayBuffer());
                    await writeFile(path, buffer);
                    log.info('Archive saved via native dialog:', path);
                    return;
                }
            } catch (e) {
                log.warn('Tauri save failed, falling back to browser:', e);
            }
        }

        // Browser fallback: anchor-click download
        const url = URL.createObjectURL(blob);
        log.debug(' Blob URL created:', url);

        const a = document.createElement('a');
        a.href = url;
        a.download = downloadName;
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
        const hasPointcloud = Object.keys(this.manifest.data_entries).some(k => k.startsWith('pointcloud_'));

        if (!hasScene && !hasMesh && !hasPointcloud) {
            errors.push('Archive must contain at least one scene (splat), mesh, or point cloud file');
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
