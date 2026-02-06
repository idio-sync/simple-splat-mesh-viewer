# Archive-3D Container Format Specification

**Version:** 1.0
**Date:** 2026-02-06
**Status:** Draft
**Authors:** archive-3d contributors

---

## Abstract

Archive-3D is an open container format for bundling 3D assets, structured metadata, spatial annotations, and preservation information into a single distributable file. It is designed for long-term archival of real-world 3D captures in cultural heritage, surveying, and scientific documentation workflows.

The format uses ZIP as its physical container and JSON as its metadata language. No proprietary tools are required to create, read, or extract the contents.

---

## Table of Contents

1. [Terminology](#1-terminology)
2. [File Format Overview](#2-file-format-overview)
3. [Physical Container](#3-physical-container)
4. [Archive Structure](#4-archive-structure)
5. [Manifest Specification](#5-manifest-specification)
   - 5.1 [Root Fields](#51-root-fields)
   - 5.2 [project](#52-project)
   - 5.3 [relationships](#53-relationships)
   - 5.4 [provenance](#54-provenance)
   - 5.5 [quality_metrics](#55-quality_metrics)
   - 5.6 [archival_record](#56-archival_record)
   - 5.7 [material_standard](#57-material_standard)
   - 5.8 [preservation](#58-preservation)
   - 5.9 [data_entries](#59-data_entries)
   - 5.10 [annotations](#510-annotations)
   - 5.11 [integrity](#511-integrity)
   - 5.12 [_meta](#512-_meta)
6. [Supported Asset Formats](#6-supported-asset-formats)
7. [Integrity Verification](#7-integrity-verification)
8. [Compatibility and Extensibility](#8-compatibility-and-extensibility)
9. [Security Considerations](#9-security-considerations)
10. [IANA Considerations](#10-iana-considerations)
11. [Conformance Levels](#11-conformance-levels)
12. [Standards Crosswalk](#12-standards-crosswalk)
13. [Complete Manifest Example](#13-complete-manifest-example)

---

## 1. Terminology

The key words "MUST", "MUST NOT", "REQUIRED", "SHALL", "SHALL NOT", "SHOULD", "SHOULD NOT", "RECOMMENDED", "MAY", and "OPTIONAL" in this document are to be interpreted as described in [RFC 2119](https://www.rfc-editor.org/rfc/rfc2119).

| Term | Definition |
|------|-----------|
| **Archive** | A single `.a3d` or `.a3z` file conforming to this specification |
| **Manifest** | The `manifest.json` file within the archive describing its contents and metadata |
| **Asset** | A 3D data file (mesh, point cloud, Gaussian splat) or supporting file (thumbnail) within the archive |
| **Data entry** | A record in the manifest's `data_entries` object describing one asset |
| **Packer** | The software application that created the archive |
| **Reader** | Any software application that reads and interprets the archive |
| **Transform** | A set of position, rotation, and scale values defining an asset's spatial placement |

---

## 2. File Format Overview

An Archive-3D container is a ZIP file containing:

1. A **manifest** (`manifest.json`) — REQUIRED. Describes the archive contents, metadata, and structure.
2. One or more **3D assets** — at least one REQUIRED. The actual data files (meshes, point clouds, Gaussian splats).
3. Optional **supporting files** — thumbnails, previews, or supplementary data.

The format comes in two variants:

| Extension | Compression | MIME Type | Use Case |
|-----------|-------------|-----------|----------|
| `.a3d` | STORE (uncompressed) | `application/zip` | Default. Fast extraction, predictable size. Best when assets are already compressed (GLB, SPZ). |
| `.a3z` | DEFLATE (compressed) | `application/zip` | Reduced file size. Best when assets contain uncompressed data (PLY, OBJ). |

Both variants are valid ZIP files. The extension signals the expected compression strategy but does not change the physical format.

---

## 3. Physical Container

### 3.1 ZIP Format

Archives MUST be valid ZIP files as defined by [APPNOTE.TXT](https://pkware.cachefly.net/webdocs/casestudies/APPNOTE.TXT) (ZIP Application Note).

Readers MUST validate the ZIP magic bytes (`0x50 0x4B`) at offset 0 before processing.

### 3.2 Compression

For `.a3d` archives, packers SHOULD use STORE (method 0) for asset files and MAY use DEFLATE (method 8) for `manifest.json`.

For `.a3z` archives, packers SHOULD use DEFLATE (method 8) with compression level 6 as the default. Packers SHOULD use STORE (method 0) for assets in already-compressed formats (GLB, SPZ, SOG, JPEG, PNG, WebP, E57).

Readers MUST support both STORE and DEFLATE compression methods regardless of file extension.

### 3.3 Character Encoding

All text content within the archive (manifest, filenames) MUST be encoded as UTF-8.

---

## 4. Archive Structure

### 4.1 Required Layout

An archive MUST contain the following at minimum:

```
archive.a3d
├── manifest.json                    # REQUIRED
└── <at least one 3D asset file>     # REQUIRED
```

### 4.2 Recommended Layout

Archives SHOULD follow this directory structure:

```
archive.a3d
├── manifest.json
├── assets/
│   ├── scene_0.<ext>                # Gaussian splat file
│   ├── mesh_0.<ext>                 # Mesh file
│   ├── pointcloud_0.<ext>           # Point cloud file
│   └── ...
└── preview.<ext>                    # Thumbnail image
```

### 4.3 Filename Constraints

Filenames within the archive:
- MUST be valid UTF-8
- MUST NOT contain null bytes
- MUST NOT contain path traversal sequences (`../`, `..\\`, or URL-encoded equivalents)
- MUST NOT begin with `/` (absolute paths)
- MUST NOT exceed 255 characters in length
- SHOULD contain only alphanumeric characters, underscores, hyphens, periods, and forward slashes
- SHOULD NOT begin with `.` (hidden files)

Readers MUST validate filenames before extraction and MUST reject any filename containing path traversal sequences.

### 4.4 manifest.json Location

The `manifest.json` file MUST be located at the root of the ZIP archive (not inside a subdirectory).

---

## 5. Manifest Specification

The manifest is a single JSON object. Fields are organized into sections. Each field is marked as:

- **REQUIRED** — MUST be present. Readers MAY reject archives missing required fields.
- **RECOMMENDED** — SHOULD be present. Readers MUST NOT reject archives missing recommended fields.
- **OPTIONAL** — MAY be present. Readers MUST ignore unknown fields gracefully.

The notation `string | ""` indicates a string field that MAY be an empty string when the value is unknown or not applicable.

### 5.1 Root Fields

| Field | Type | Status | Description |
|-------|------|--------|-------------|
| `container_version` | string | REQUIRED | Format version. MUST be `"1.0"` for archives conforming to this specification. |
| `packer` | string | REQUIRED | Identifier of the software that created the archive. |
| `packer_version` | string | RECOMMENDED | Version of the packer software. |
| `_creation_date` | string | RECOMMENDED | ISO 8601 datetime when the archive was created. Example: `"2026-02-05T12:00:00.000Z"` |
| `project` | object | REQUIRED | Project information. See [5.2](#52-project). |
| `relationships` | object | OPTIONAL | Links to related objects. See [5.3](#53-relationships). |
| `provenance` | object | OPTIONAL | Capture and processing provenance. See [5.4](#54-provenance). |
| `quality_metrics` | object | OPTIONAL | Quality and accuracy information. See [5.5](#55-quality_metrics). |
| `archival_record` | object | OPTIONAL | Cataloging metadata. See [5.6](#56-archival_record). |
| `material_standard` | object | OPTIONAL | PBR material conventions. See [5.7](#57-material_standard). |
| `preservation` | object | OPTIONAL | Preservation and format registry metadata. See [5.8](#58-preservation). |
| `data_entries` | object | REQUIRED | Asset file manifest. See [5.9](#59-data_entries). |
| `annotations` | array | OPTIONAL | Spatial annotations. See [5.10](#510-annotations). |
| `integrity` | object | OPTIONAL | Integrity verification hashes. See [5.11](#511-integrity). |
| `_meta` | object | OPTIONAL | Implementation-specific metadata. See [5.12](#512-_meta). |

### 5.2 project

Project-level identification. This section provides the minimal descriptive metadata needed for discovery.

| Field | Type | Status | Description |
|-------|------|--------|-------------|
| `title` | string | REQUIRED | Human-readable title of the archive. MUST NOT be empty. |
| `id` | string | RECOMMENDED | Machine-readable identifier (slug, UUID, or institutional ID). |
| `description` | string | OPTIONAL | Extended description. MAY contain Markdown. |
| `license` | string | RECOMMENDED | License identifier. SHOULD use [SPDX identifiers](https://spdx.org/licenses/) (e.g., `"CC-BY-4.0"`, `"CC0-1.0"`) or a URL to the license text. |

```json
"project": {
    "title": "Lincoln Memorial — Seated Statue",
    "id": "lm-metrology-2025-03",
    "description": "High-resolution metrology-grade 3D scan...",
    "license": "CC0-1.0"
}
```

### 5.3 relationships

Links to related archives, collections, or external resources. All fields are OPTIONAL.

| Field | Type | Description |
|-------|------|-------------|
| `part_of` | string | Name or identifier of a parent collection or project this archive belongs to. |
| `derived_from` | string | Identifier of a source dataset this archive was derived from. |
| `replaces` | string | Identifier of an earlier archive this one supersedes. |
| `related_objects` | array | Related objects. Each element MAY be a string (simple identifier) or an object with `title`, `description`, and `url` fields. |

```json
"relationships": {
    "part_of": "National Mall Digital Preservation Collection",
    "derived_from": "NPS HABS/HAER Survey DC-0428",
    "replaces": "",
    "related_objects": [
        {
            "title": "Lincoln Memorial Building — Exterior Laser Scan",
            "description": "Companion TLS scan of the full memorial exterior.",
            "url": "https://www.nps.gov/subjects/heritagedocumentation/lincoln-memorial.htm"
        }
    ]
}
```

### 5.4 provenance

Documents how the 3D data was captured and processed. All fields are OPTIONAL.

| Field | Type | Description |
|-------|------|-------------|
| `capture_date` | string | Date of data capture. SHOULD be ISO 8601 (`YYYY-MM-DD`). |
| `capture_device` | string | Name/model of capture hardware. |
| `device_serial` | string | Serial number(s) of capture device(s). |
| `operator` | string | Name and affiliation of the person who performed the capture. |
| `operator_orcid` | string | ORCID identifier of the operator. Format: `XXXX-XXXX-XXXX-XXXX`. See [orcid.org](https://orcid.org/). |
| `location` | string | Human-readable capture location. |
| `convention_hints` | array of strings | Coordinate convention notes (e.g., `"Y-up"`, `"meters"`, `"right-handed"`). |
| `processing_software` | array of objects | Ordered list of software used in the processing chain. Each object has `name` (REQUIRED), `version` (OPTIONAL), and `url` (OPTIONAL) fields. |
| `processing_notes` | string | Free-text description of the processing workflow. |

```json
"provenance": {
    "capture_date": "2025-03-10",
    "capture_device": "Leica RTC360 + Artec Ray II",
    "device_serial": "RTC360-7842195 / AR2-20241087",
    "operator": "Sarah Chen, NPS Heritage Documentation Programs",
    "operator_orcid": "0000-0002-7391-5482",
    "location": "Lincoln Memorial Interior, Washington, D.C.",
    "convention_hints": ["Y-up", "meters", "right-handed"],
    "processing_software": [
        { "name": "Leica Cyclone REGISTER 360+", "version": "2024.1.0" },
        { "name": "CloudCompare", "version": "2.13.1" }
    ],
    "processing_notes": "Point cloud registration from 47 TLS scan positions..."
}
```

### 5.5 quality_metrics

Documents the accuracy and quality of the captured data. All fields are OPTIONAL.

| Field | Type | Description |
|-------|------|-------------|
| `tier` | string | Quality tier classification. RECOMMENDED values: `"metrology"`, `"reference"`, `"visualization"`. See [5.5.1](#551-quality-tiers). |
| `accuracy_grade` | string | Free-text accuracy classification (e.g., `"survey-grade"`, `"A"`, `"consumer"`). |
| `capture_resolution` | object | Spatial resolution of the capture. Fields: `value` (number), `unit` (string, e.g., `"mm"`), `type` (string, e.g., `"GSD"`, `"point spacing"`). |
| `alignment_error` | object | Registration error. Fields: `value` (number), `unit` (string), `method` (string, e.g., `"RMSE"`, `"RMS"`, `"mean"`). |
| `scale_verification` | string | Description of how real-world scale was verified. |
| `data_quality` | object | Known quality limitations. See [5.5.2](#552-data_quality). |

#### 5.5.1 Quality Tiers

| Tier | Intended Use | Typical Accuracy |
|------|-------------|-----------------|
| `metrology` | Dimensional analysis, structural monitoring, legal documentation | Sub-millimeter |
| `reference` | Scholarly research, condition recording, visual documentation | Millimeter-range |
| `visualization` | Public display, education, virtual tours | Centimeter-range or unverified |

Packers MAY use other tier values. Readers MUST NOT reject archives with unrecognized tier values.

#### 5.5.2 data_quality

| Field | Type | Description |
|-------|------|-------------|
| `coverage_gaps` | string | Description of areas not captured or with reduced density. |
| `reconstruction_areas` | string | Description of areas filled by algorithmic reconstruction. |
| `color_calibration` | string | Description of color calibration methodology. |
| `measurement_uncertainty` | string | Combined measurement uncertainty statement. |

### 5.6 archival_record

Structured cataloging metadata inspired by Dublin Core, VRA Core, and Smithsonian EDAN. This section describes the **physical subject** being documented, not the digital archive itself. All fields are OPTIONAL.

| Field | Type | Description |
|-------|------|-------------|
| `standard` | string | Metadata standard(s) followed (e.g., `"Dublin Core"`, `"VRA Core + Dublin Core"`). |
| `title` | string | Title of the physical object or site. |
| `alternate_titles` | array of strings | Alternative names for the subject. |
| `ids` | object | Institutional identifiers. See below. |
| `creation` | object | Information about the physical subject's creation. See below. |
| `physical_description` | object | Physical attributes of the subject. See below. |
| `provenance` | string | Ownership and custodial history of the physical subject. |
| `rights` | object | Copyright and usage rights. See below. |
| `context` | object | Historical and interpretive context. See below. |
| `coverage` | object | Geographic and temporal coverage. See below. |

#### 5.6.1 ids

| Field | Type | Description |
|-------|------|-------------|
| `accession_number` | string | Institutional accession or catalog number. |
| `siris_id` | string | Smithsonian SIRIS identifier. |
| `uri` | string | Persistent URI for the object (institutional catalog URL, Handle, DOI, ARK). |

#### 5.6.2 creation

| Field | Type | Description |
|-------|------|-------------|
| `creator` | string | Creator(s) of the physical subject (not the digital capture). Maps to `dc:creator`. |
| `date_created` | string | Date or date range of creation. Maps to `dcterms:created`. |
| `period` | string | Art-historical or cultural period. |
| `culture` | string | Cultural origin or affiliation. |

#### 5.6.3 physical_description

| Field | Type | Description |
|-------|------|-------------|
| `medium` | string | Materials and techniques. Maps to `dc:format`. |
| `dimensions` | object | Physical size with `height`, `width`, `depth` fields (strings with units). |
| `condition` | string | Current physical condition. |

#### 5.6.4 rights

| Field | Type | Description |
|-------|------|-------------|
| `copyright_status` | string | Copyright status or license. Maps to `dc:rights`. |
| `credit_line` | string | Required attribution text. |

#### 5.6.5 context

| Field | Type | Description |
|-------|------|-------------|
| `description` | string | Interpretive or historical description of the subject. |
| `location_history` | string | History of the subject's physical location. |

#### 5.6.6 coverage

| Field | Type | Description |
|-------|------|-------------|
| `spatial` | object | Geographic location. Contains `location_name` (string) and `coordinates` (object with `latitude` and `longitude` as strings or numbers). Latitude and longitude SHOULD be decimal degrees in WGS 84. |
| `temporal` | object | Time period of the subject. Contains `subject_period` (string) and `subject_date_circa` (boolean, true if the date is approximate). |

### 5.7 material_standard

Documents the PBR (Physically-Based Rendering) material conventions used in mesh assets. All fields are OPTIONAL.

| Field | Type | Description |
|-------|------|-------------|
| `workflow` | string | PBR workflow type. RECOMMENDED values: `"metalness-roughness"`, `"specular-glossiness"`. |
| `occlusion_packed` | boolean | Whether ambient occlusion is packed into the roughness/metalness texture. |
| `color_space` | string | Color space of textures (e.g., `"sRGB"`, `"linear"`). |
| `normal_space` | string | Normal map convention (e.g., `"OpenGL (+Y up)"`, `"DirectX (+Y down)"`). |

### 5.8 preservation

Metadata supporting long-term digital preservation and future format migration. All fields are OPTIONAL.

| Field | Type | Description |
|-------|------|-------------|
| `format_registry` | object | PRONOM format identifiers. Keys are file extensions (lowercase, without dot), values are PRONOM IDs (e.g., `"fmt/861"`). See [pronom.nationalarchives.gov.uk](https://www.nationalarchives.gov.uk/PRONOM/). |
| `significant_properties` | array of strings | Aspects of the data that MUST be preserved during any future migration (e.g., `"Geometric accuracy"`, `"Color fidelity"`, `"Real-world scale"`). |
| `rendering_requirements` | string | Minimum rendering environment required for faithful display. |
| `rendering_notes` | string | Additional rendering considerations. |

**Known PRONOM identifiers for common 3D formats:**

| Format | PRONOM ID | Name |
|--------|-----------|------|
| GLB (glTF Binary) | `fmt/861` | GL Transmission Format Binary |
| OBJ (Wavefront) | `fmt/935` | Wavefront OBJ |
| PLY (Polygon File Format) | `fmt/831` | Polygon File Format |
| E57 | `fmt/643` | ASTM E57 3D File Format |

> **Note on Gaussian Splat PLY files:** PLY files containing Gaussian splat data (spherical harmonics, opacity, scale, rotation attributes) are structurally valid PLY files but contain non-standard attributes. Packers SHOULD note this in `rendering_notes`. A future PRONOM registration for Gaussian splat formats will supersede the generic PLY ID for these files.

### 5.9 data_entries

An object mapping entry keys to asset descriptors. Each key uniquely identifies an asset within the archive. This is the core of the manifest, connecting metadata to physical files.

#### 5.9.1 Entry Key Convention

Entry keys MUST follow the pattern `<type>_<index>` where:

| Type Prefix | Asset Type |
|-------------|-----------|
| `scene_` | Gaussian splat representation |
| `mesh_` | Polygon mesh (GLB, glTF, OBJ) |
| `pointcloud_` | Point cloud (E57) |
| `thumbnail_` | Preview image |

Index is a zero-based integer. Examples: `scene_0`, `mesh_0`, `mesh_1`, `pointcloud_0`, `thumbnail_0`.

Readers MUST support entries with unrecognized type prefixes by treating them as opaque data.

#### 5.9.2 Entry Fields

| Field | Type | Status | Description |
|-------|------|--------|-------------|
| `file_name` | string | REQUIRED | Path to the file within the archive, relative to the archive root. |
| `created_by` | string | RECOMMENDED | Name of the software that created this specific file. |
| `_created_by_version` | string | OPTIONAL | Version of the creating software. |
| `_source_notes` | string | OPTIONAL | Free-text notes about how this file was produced. |
| `_parameters` | object | OPTIONAL | Spatial transform for this asset. See [5.9.3](#593-_parameters). |
| `_hash` | string | OPTIONAL | Deprecated. Per-asset hashes SHOULD use the `integrity` section instead. |

#### 5.9.3 _parameters

Defines the spatial placement of an asset in a common coordinate space, allowing multiple representations to be displayed in correct alignment.

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `position` | array of 3 numbers | `[0, 0, 0]` | Translation offset `[x, y, z]` in scene units. |
| `rotation` | array of 3 numbers | `[0, 0, 0]` | Euler rotation `[x, y, z]` in radians. Rotation order: YXZ. |
| `scale` | number | `1` | Uniform scale factor. |

```json
"scene_0": {
    "file_name": "assets/scene_0.spz",
    "created_by": "Postshot",
    "_created_by_version": "1.3.0",
    "_source_notes": "Gaussian splat trained from 1,847 photogrammetric images.",
    "_parameters": {
        "position": [0, 0, 0],
        "rotation": [3.14159, 0, 0],
        "scale": 1
    }
}
```

#### 5.9.4 Minimum Asset Requirement

A valid archive MUST contain at least one data entry with a type prefix of `scene_`, `mesh_`, or `pointcloud_`. Archives containing only `thumbnail_` entries are not valid.

### 5.10 annotations

An array of spatial annotation objects. Annotations mark specific locations in 3D space with descriptive text and an associated camera viewpoint. The array MAY be empty.

| Field | Type | Status | Description |
|-------|------|--------|-------------|
| `id` | string | REQUIRED | Unique identifier within this archive. Convention: `"anno_<n>"` with a 1-based index. |
| `title` | string | REQUIRED | Short title displayed as a label. |
| `body` | string | OPTIONAL | Extended description. MAY contain Markdown. |
| `position` | object | REQUIRED | 3D world-space position. Fields: `x`, `y`, `z` (numbers). |
| `camera_position` | object | RECOMMENDED | Camera location for viewing this annotation. Fields: `x`, `y`, `z` (numbers). |
| `camera_target` | object | RECOMMENDED | Camera look-at point. Fields: `x`, `y`, `z` (numbers). |

```json
"annotations": [
    {
        "id": "anno_1",
        "title": "Hairline Crack — Torso Seam",
        "body": "Visible hairline crack running along the seam between blocks 14 and 15...",
        "position": { "x": 0.042, "y": 2.845, "z": 0.410 },
        "camera_position": { "x": 0.15, "y": 2.90, "z": 1.60 },
        "camera_target": { "x": 0.042, "y": 2.845, "z": 0.410 }
    }
]
```

### 5.11 integrity

Cryptographic hashes for verifying archive integrity. The entire section is OPTIONAL, but when present, the fields below apply.

| Field | Type | Status | Description |
|-------|------|--------|-------------|
| `algorithm` | string | REQUIRED | Hash algorithm. MUST be `"SHA-256"`. |
| `manifest_hash` | string | REQUIRED | Hex-encoded hash derived from sorting and concatenating all asset hashes. |
| `assets` | object | REQUIRED | Map of file paths (relative to archive root) to hex-encoded SHA-256 hashes. |

See [Section 7](#7-integrity-verification) for the verification algorithm.

```json
"integrity": {
    "algorithm": "SHA-256",
    "manifest_hash": "a1b2c3d4e5f6...",
    "assets": {
        "assets/scene_0.spz": "3f8a2b1c4d5e...",
        "assets/mesh_0.glb": "7c6d5e4f3a2b...",
        "preview.jpg": "e4f5a6b7c8d9..."
    }
}
```

### 5.12 _meta

An OPTIONAL object for implementation-specific metadata that does not fit into the structured sections above. Readers MUST NOT require any field within `_meta` for basic archive processing.

Fields prefixed with `_` throughout the manifest are considered implementation-specific. Readers SHOULD preserve them during round-trip operations (load, modify, re-export) but MUST NOT depend on them.

#### 5.12.1 Common _meta Fields

| Field | Type | Description |
|-------|------|-------------|
| `quality` | object | Computed statistics: `splat_count`, `mesh_polygons`, `mesh_vertices`, `splat_file_size`, `mesh_file_size`, `pointcloud_points`, `pointcloud_file_size` (all numbers). |
| `custom_fields` | object | Arbitrary key-value pairs for institutional or project-specific metadata. |

```json
"_meta": {
    "quality": {
        "splat_count": 3000000,
        "mesh_polygons": 45000000,
        "mesh_vertices": 22500000
    },
    "custom_fields": {
        "nps_unit_code": "LINC",
        "survey_datum": "NAD83 / UTM Zone 18N / NAVD88"
    }
}
```

---

## 6. Supported Asset Formats

Archives MAY contain files in any format. The following formats are defined by this specification and SHOULD be supported by conforming readers:

### 6.1 Gaussian Splat Formats

| Extension | Format | Notes |
|-----------|--------|-------|
| `.ply` | PLY with splat attributes | Spherical harmonics, opacity, scale, rotation quaternions. Not standard PLY semantics. |
| `.splat` | Compressed splat | Community format. No formal specification. |
| `.ksplat` | Compressed splat | Viewer-specific format. |
| `.spz` | Compressed splat (Spark) | Spark.js native format. |
| `.sog` | SOG format | Compressed splat variant. |

> **Stability warning:** Gaussian splat formats are under active development and lack formal standardization. Packers SHOULD include a mesh or point cloud representation alongside splat data to ensure long-term accessibility.

### 6.2 Mesh Formats

| Extension | Format | Specification |
|-----------|--------|--------------|
| `.glb` | glTF Binary 2.0 | [Khronos glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) |
| `.gltf` | glTF 2.0 (JSON + binary) | [Khronos glTF 2.0](https://registry.khronos.org/glTF/specs/2.0/glTF-2.0.html) |
| `.obj` | Wavefront OBJ | [Wavefront OBJ specification](http://www.martinreddy.net/gfx/3d/OBJ.spec) |

GLB is RECOMMENDED for meshes due to its single-file nature, binary efficiency, widespread tooling support, and Khronos Group stewardship.

### 6.3 Point Cloud Formats

| Extension | Format | Specification |
|-----------|--------|--------------|
| `.e57` | ASTM E57 | [ASTM E2807](https://www.astm.org/e2807-11r19.html) |

### 6.4 Thumbnail Formats

| Extension | Format |
|-----------|--------|
| `.jpg` / `.jpeg` | JPEG |
| `.png` | PNG |
| `.webp` | WebP |

Thumbnails SHOULD be placed at the archive root as `preview.<ext>`. Packers SHOULD generate square thumbnails at 1024x1024 pixels.

---

## 7. Integrity Verification

### 7.1 Per-Asset Hashes

When the `integrity` section is present, each value in `integrity.assets` is the lowercase hex-encoded SHA-256 hash of the corresponding file's raw bytes as stored in the ZIP archive (after decompression if applicable).

### 7.2 Manifest Hash

The `manifest_hash` is computed as follows:

1. Collect all values from `integrity.assets` (the per-asset hash strings).
2. Sort the hash strings lexicographically (ascending).
3. Concatenate them into a single string with no separator.
4. Compute the SHA-256 hash of the UTF-8 encoding of the concatenated string.
5. Encode the result as a lowercase hex string.

### 7.3 Verification Procedure

To verify an archive's integrity:

1. Extract all files from the ZIP.
2. For each file path listed in `integrity.assets`, compute the SHA-256 hash of the extracted file's bytes.
3. Compare the computed hash to the stored hash. If any mismatch is found, the asset has been modified or corrupted.
4. Recompute the `manifest_hash` using the procedure in [7.2](#72-manifest-hash) and compare it to the stored value.

Readers SHOULD warn the user if hashes do not match but SHOULD NOT refuse to load the archive. Data may still be usable despite integrity concerns.

### 7.4 Absence of Integrity Data

If the `integrity` section is absent, the archive has no integrity verification. This is permitted but Readers MAY warn the user.

---

## 8. Compatibility and Extensibility

### 8.1 Forward Compatibility

Readers MUST ignore fields they do not recognize. This allows newer packers to add fields without breaking older readers.

### 8.2 Backward Compatibility

When a future version of this specification adds new REQUIRED fields, the `container_version` MUST be incremented to a new major version (e.g., `"2.0"`).

New OPTIONAL or RECOMMENDED fields MAY be added within the same major version.

### 8.3 Underscore Convention

Fields with names beginning with `_` (e.g., `_creation_date`, `_parameters`, `_meta`) are implementation-specific extensions. They carry no guarantees of interoperability across different tools. Readers MUST NOT require underscore-prefixed fields for basic archive loading and display.

### 8.4 Version Negotiation

Readers SHOULD process archives with an unrecognized `container_version` on a best-effort basis, treating all unrecognized fields as optional. Readers MAY warn the user that the archive was created with a newer version of the format.

---

## 9. Security Considerations

### 9.1 Path Traversal

Malicious archives may contain filenames with path traversal sequences (e.g., `../../etc/passwd`). Readers MUST sanitize all filenames before extraction. See [Section 4.3](#43-filename-constraints).

### 9.2 ZIP Bombs

Readers SHOULD enforce a maximum decompressed size to prevent denial-of-service via zip bombs. A reasonable default is 10x the compressed archive size.

### 9.3 Manifest Injection

The `manifest.json` is untrusted input. Readers MUST NOT evaluate any manifest string value as code. Fields containing Markdown or HTML (such as `project.description` or `annotations[].body`) MUST be sanitized before rendering in a web context to prevent cross-site scripting (XSS).

### 9.4 URL Fields

Fields that contain URLs (such as `archival_record.ids.uri`, `relationships.related_objects[].url`, or `provenance.processing_software[].url`) MUST NOT be automatically loaded or navigated to without user confirmation. Readers SHOULD validate that URL values use `http:` or `https:` schemes only.

---

## 10. IANA Considerations

### 10.1 Media Type

The Archive-3D format does not currently have a registered IANA media type. Archives SHOULD be served with `application/zip` until a dedicated media type is registered.

Proposed future registration: `application/vnd.archive-3d+zip`.

### 10.2 File Extensions

| Extension | Usage |
|-----------|-------|
| `.a3d` | Archive-3D container (uncompressed assets) |
| `.a3z` | Archive-3D container (compressed assets) |

---

## 11. Conformance Levels

This specification defines three conformance levels to accommodate different use cases.

### Level 1: Minimal

The archive is a valid ZIP containing a `manifest.json` with the REQUIRED fields and at least one 3D asset.

**Required manifest fields:**
- `container_version`
- `packer`
- `project.title`
- `data_entries` (at least one `scene_`, `mesh_`, or `pointcloud_` entry with `file_name`)

### Level 2: Documented

Level 1, plus provenance and quality metadata sufficient for a researcher to understand and evaluate the data.

**Additional expected fields:**
- `provenance.capture_date`
- `provenance.capture_device`
- `provenance.operator`
- `provenance.processing_software` (at least one entry)
- `quality_metrics.tier`
- `integrity` section with per-asset hashes

### Level 3: Preservation

Level 2, plus metadata sufficient for institutional archiving and long-term preservation.

**Additional expected fields:**
- `archival_record` section with `ids`, `creation`, `rights`, and `coverage`
- `preservation.format_registry` entries for all assets
- `preservation.significant_properties`
- `provenance.operator_orcid`
- `project.license`
- At least one mesh or point cloud asset in a standardized format (GLB, E57)

---

## 12. Standards Crosswalk

The following table maps manifest fields to established metadata standards. This crosswalk is informative, not normative.

| Manifest Field | Dublin Core | VRA Core | PREMIS | PRONOM |
|---------------|-------------|----------|--------|--------|
| `project.title` | `dc:title` | `title` | `objectIdentifier.value` | — |
| `project.description` | `dc:description` | `description` | — | — |
| `project.license` | `dc:rights` | — | `rightsStatement` | — |
| `archival_record.creation.creator` | `dc:creator` | `agent.name` | — | — |
| `archival_record.creation.date_created` | `dcterms:created` | `date.earliestDate` | — | — |
| `archival_record.creation.culture` | — | `culturalContext` | — | — |
| `archival_record.physical_description.medium` | `dc:format` | `material.type` | — | — |
| `archival_record.rights.copyright_status` | `dc:rights` | `rights.type` | `rightsStatement` | — |
| `archival_record.coverage.spatial` | `dcterms:spatial` | `location` | — | — |
| `archival_record.coverage.temporal` | `dcterms:temporal` | `date` | — | — |
| `provenance.operator` | `dc:contributor` | `agent.name` | `agentIdentifier` | — |
| `provenance.operator_orcid` | — | — | `agentIdentifier.type="ORCID"` | — |
| `preservation.format_registry.*` | `dc:format` | — | `formatRegistryKey` | PRONOM ID |
| `integrity.algorithm` | — | — | `fixity.messageDigestAlgorithm` | — |
| `integrity.assets.*` | — | — | `fixity.messageDigest` | — |

---

## 13. Complete Manifest Example

The following is a complete manifest demonstrating all sections at Conformance Level 3.

```json
{
    "container_version": "1.0",
    "packer": "simple-splat-mesh-viewer",
    "packer_version": "1.0.0",
    "_creation_date": "2026-02-05T12:00:00.000Z",

    "project": {
        "title": "East Facade of St. Mary's Church",
        "id": "st-marys-east-facade-2026",
        "description": "Photogrammetric capture of the east facade.",
        "license": "CC-BY-4.0"
    },

    "relationships": {
        "part_of": "St. Mary's Church Conservation Survey 2026",
        "derived_from": "raw-scan-001",
        "replaces": "",
        "related_objects": [
            "west-facade",
            {
                "title": "Interior Nave Scan",
                "description": "Companion interior laser scan.",
                "url": ""
            }
        ]
    },

    "provenance": {
        "capture_date": "2026-01-15",
        "capture_device": "Leica RTC360",
        "device_serial": "SN-12345",
        "operator": "Jane Smith, Heritage Survey Team",
        "operator_orcid": "0000-0002-1234-5678",
        "location": "Oxford, UK",
        "convention_hints": ["Y-up", "meters", "right-handed"],
        "processing_software": [
            { "name": "Reality Capture", "version": "1.4", "url": "https://www.capturingreality.com/" },
            { "name": "CloudCompare", "version": "2.13" }
        ],
        "processing_notes": "Aligned from 847 images, cleaned and decimated."
    },

    "quality_metrics": {
        "tier": "reference",
        "accuracy_grade": "A",
        "capture_resolution": { "value": 2, "unit": "mm", "type": "GSD" },
        "alignment_error": { "value": 0.5, "unit": "mm", "method": "RMSE" },
        "scale_verification": "Verified with calibrated scale bar.",
        "data_quality": {
            "coverage_gaps": "Minor occlusion behind downpipe.",
            "reconstruction_areas": "None.",
            "color_calibration": "X-Rite ColorChecker used.",
            "measurement_uncertainty": "0.3mm"
        }
    },

    "archival_record": {
        "standard": "Dublin Core",
        "title": "East Facade of St. Mary's Church",
        "alternate_titles": [],
        "ids": {
            "accession_number": "2026.001.0042",
            "siris_id": "",
            "uri": "https://collection.example.org/objects/42"
        },
        "creation": {
            "creator": "Unknown (attributed to George Edmund Street)",
            "date_created": "1860-1875",
            "period": "Gothic Revival",
            "culture": "English"
        },
        "physical_description": {
            "medium": "Limestone ashlar with flint infill",
            "dimensions": { "height": "15m", "width": "22m", "depth": "1.2m" },
            "condition": "Fair — weathering to upper tracery."
        },
        "provenance": "Parish of St. Mary the Virgin since construction.",
        "rights": {
            "copyright_status": "CC-BY-4.0",
            "credit_line": "Heritage Survey Team, 2026"
        },
        "context": {
            "description": "East-facing facade with decorated tracery window.",
            "location_history": "Original location since construction."
        },
        "coverage": {
            "spatial": {
                "location_name": "Oxford, UK",
                "coordinates": { "latitude": "51.752", "longitude": "-1.258" }
            },
            "temporal": {
                "subject_period": "1860-1875",
                "subject_date_circa": true
            }
        }
    },

    "material_standard": {
        "workflow": "metalness-roughness",
        "occlusion_packed": false,
        "color_space": "sRGB",
        "normal_space": "OpenGL (+Y up)"
    },

    "preservation": {
        "format_registry": {
            "glb": "fmt/861",
            "ply": "fmt/831",
            "e57": "fmt/643"
        },
        "significant_properties": [
            "Geometric accuracy (point positions)",
            "Color fidelity",
            "Real-world scale"
        ],
        "rendering_requirements": "WebGL 2.0 with EXT_color_buffer_float for Gaussian splat rendering.",
        "rendering_notes": "Splat default orientation is rotated 180 degrees on X-axis (Z-up to Y-up conversion)."
    },

    "data_entries": {
        "scene_0": {
            "file_name": "assets/scene_0.ply",
            "created_by": "nerfstudio",
            "_created_by_version": "1.1.0",
            "_source_notes": "Trained for 30k iterations from 847 images.",
            "_parameters": {
                "position": [0, 0, 0],
                "rotation": [3.14159, 0, 0],
                "scale": 1
            }
        },
        "mesh_0": {
            "file_name": "assets/mesh_0.glb",
            "created_by": "Reality Capture",
            "_created_by_version": "1.4",
            "_source_notes": "Decimated from 200M to 10M faces.",
            "_parameters": {
                "position": [0, 0, 0],
                "rotation": [0, 0, 0],
                "scale": 1
            }
        },
        "pointcloud_0": {
            "file_name": "assets/pointcloud_0.e57",
            "created_by": "Leica Cyclone",
            "_created_by_version": "2024.1.0",
            "_source_notes": "Registered from 12 scan positions.",
            "_parameters": {
                "position": [0, 0, 0],
                "rotation": [0, 0, 0],
                "scale": 1
            }
        },
        "thumbnail_0": {
            "file_name": "preview.jpg",
            "created_by": "simple-splat-mesh-viewer"
        }
    },

    "annotations": [
        {
            "id": "anno_1",
            "title": "Crack in tracery",
            "body": "Structural crack running NE-SW, approximately 2.3m in length.",
            "position": { "x": 1.2, "y": 3.4, "z": -0.1 },
            "camera_position": { "x": 2.0, "y": 4.0, "z": 3.0 },
            "camera_target": { "x": 1.2, "y": 3.4, "z": -0.1 }
        }
    ],

    "integrity": {
        "algorithm": "SHA-256",
        "manifest_hash": "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2",
        "assets": {
            "assets/scene_0.ply": "3f8a2b1c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1",
            "assets/mesh_0.glb": "7c6d5e4f3a2b1c0d9e8f7a6b5c4d3e2f1a0b9c8d7e6f5a4b3c2d1e0f9a8b7c6",
            "assets/pointcloud_0.e57": "b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6e7f8a9b0c1d2e3f4a5b6c7d8e9f0a1b2c3",
            "preview.jpg": "e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5"
        }
    },

    "_meta": {
        "quality": {
            "splat_count": 2000000,
            "mesh_polygons": 10000000,
            "mesh_vertices": 5000000,
            "pointcloud_points": 50000000
        },
        "custom_fields": {
            "diocese": "Oxford",
            "listed_grade": "Grade I"
        }
    }
}
```

---

## Revision History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 (Draft) | 2026-02-06 | Initial specification derived from the simple-splat-mesh-viewer reference implementation. |
