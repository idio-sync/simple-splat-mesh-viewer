# Shortcomings & Solutions Roadmap

**Date:** 2026-02-06
**Scope:** Viewer application and .a3d/.a3z container format
**Status:** Proof of concept — this document tracks known gaps and proposed solutions for moving toward a production-quality tool and a genuinely preservable archive format.

---

## Table of Contents

1. [Technology — Rendering & Runtime](#1-technology--rendering--runtime)
2. [Technology — Alignment & Analysis](#2-technology--alignment--analysis)
3. [Preservation — Format Specification](#3-preservation--format-specification)
4. [Preservation — Standards Compliance](#4-preservation--standards-compliance)
5. [Preservation — Integrity & Trust](#5-preservation--integrity--trust)
6. [Preservation — Kiosk Viewer Durability](#6-preservation--kiosk-viewer-durability)
7. [Usability — Measurement & Analysis Tools](#7-usability--measurement--analysis-tools)
8. [Usability — Metadata Authoring](#8-usability--metadata-authoring)
9. [Usability — Collaboration & Versioning](#9-usability--collaboration--versioning)
10. [Usability — Annotation System](#10-usability--annotation-system)
11. [Architecture — Format Independence](#11-architecture--format-independence)
12. [Architecture — Data Hierarchy](#12-architecture--data-hierarchy)

---

## 1. Technology — Rendering & Runtime

### 1.1 Gaussian Splat Formats Are Unstable

**Problem:** 3D Gaussian Splatting (published August 2023) is a rapidly evolving research area. The splat formats supported (`.splat`, `.ksplat`, `.spz`, `.sog`, and custom-attribute `.ply`) have no formal specification, no standards body, and no stability guarantees. These formats may fragment, merge, or become obsolete within years.

**Solutions:**
- **Short-term:** Add a prominent `format_stability: "experimental"` flag to splat entries in the manifest, distinguishing them from stable formats like GLB and E57. Document in the manifest spec that splat files are considered derived visualization products, not primary archival records.
- **Medium-term:** Monitor the emerging standardization efforts around radiance fields. When a stable format emerges (likely through Khronos Group, given their stewardship of glTF), add support and provide a migration path. Consider supporting the [3DGS specification draft](https://github.com/mkkellogg/GaussianSplats3D) or whatever consolidates.
- **Long-term:** Build a migration tool that can re-derive splats from the archived mesh/point cloud when newer splat formats become available. The archival mesh and E57 are the ground truth — the splat is always regenerable.

### 1.2 WebGL 2.0 Dependency Has a Limited Lifespan

**Problem:** The viewer requires WebGL 2.0, which is being superseded by WebGPU. The kiosk viewer freezes a WebGL-dependent rendering stack. Browser vendors may eventually deprecate WebGL 2.0 as they did WebGL 1.0 extensions.

**Solutions:**
- **Short-term:** Abstract the rendering backend behind an interface so the Three.js/Spark.js dependency can be swapped without rewriting the application logic. Three.js already has a `WebGPURenderer` in development.
- **Medium-term:** Add a WebGPU rendering path alongside WebGL 2.0, with runtime detection and fallback. Update the kiosk viewer generator to embed whichever backend the target browser supports.
- **Long-term:** When generating kiosk viewers, include both WebGL and WebGPU code paths so the file remains renderable as browsers evolve. Document the rendering API version in the manifest's `preservation.rendering_requirements` as a structured object rather than a free-text string:
  ```json
  "rendering_requirements": {
    "apis": ["WebGPU", "WebGL 2.0"],
    "minimum_gpu_memory_mb": 2048,
    "notes": "WebGPU preferred; WebGL 2.0 fallback included"
  }
  ```

### 1.3 CDN Dependency at Export Time

**Problem:** Kiosk export fetches dependencies from `esm.sh` at build time. If the CDN is unavailable, restructures URLs, or changes bundling behavior, export fails entirely. There is a single retry with no fallback.

**Solutions:**
- **Short-term:** Add a local cache of fetched dependencies using the Cache API or IndexedDB. Once fetched successfully, subsequent exports use the cached copy. Display a clear error if the CDN is unreachable and no cache exists.
- **Medium-term:** Bundle the required dependencies (Three.js, Spark.js, fflate) as local assets within the application's deployment. Fetch from local first, fall back to CDN. This eliminates the CDN as a single point of failure.
- **Long-term:** Provide a CLI or build script that pre-fetches and bundles all dependencies for air-gapped or institutional deployments where external network access may be restricted.

### 1.4 No Progressive or Level-of-Detail Loading

**Problem:** The viewer loads entire files into memory. Large assets (45M-face meshes, 1.2B-point E57 clouds) either load completely or not at all. There's no tiling, streaming, octree, or LOD system. This limits usability to machines with substantial GPU memory.

**Solutions:**
- **Short-term:** Add file size warnings in the UI. When loading assets above a threshold (e.g., 100MB mesh, 500MB E57), warn the user and offer to skip.
- **Medium-term:** Implement mesh simplification on load — use a decimation algorithm to create a display-resolution proxy while keeping the full-resolution file in the archive. For E57 point clouds, implement an octree-based renderer that loads visible nodes on demand.
- **Long-term:** Support multi-resolution archives. The manifest could list multiple LOD versions of each asset:
  ```json
  "mesh_0": {
    "file_name": "assets/mesh_0_full.glb",
    "lod_variants": [
      { "file_name": "assets/mesh_0_lod1.glb", "face_count": 1000000 },
      { "file_name": "assets/mesh_0_lod2.glb", "face_count": 100000 }
    ]
  }
  ```
  The viewer loads the appropriate LOD based on device capability. Potree-style tiled point cloud formats could replace monolithic E57 files for web display.

---

## 2. Technology — Alignment & Analysis

### 2.1 ICP Alignment Is Naive

**Problem:** The ICP implementation uses basic nearest-neighbor matching with a KD-tree but lacks RANSAC outlier rejection, multi-scale coarse-to-fine alignment, convergence criteria beyond iteration count, or point-to-plane variants. For a tool that documents metrology-grade accuracy, this is a significant gap between what the metadata can describe and what the tool can verify.

**Solutions:**
- **Short-term:** Add convergence criteria (stop when the transformation change between iterations falls below a threshold). Add a maximum correspondence distance to reject gross outliers.
- **Medium-term:** Implement point-to-plane ICP (requires normals), which converges faster and more accurately on planar surfaces common in architecture and sculpture. Add RANSAC-based initial alignment for cases where the starting positions are far apart.
- **Long-term:** Integrate a WASM-compiled alignment library (e.g., Open3D's registration module compiled to WebAssembly) for robust, production-quality registration. Provide alignment quality metrics (RMSE, overlap percentage, correspondence histogram) in the UI and store them in the manifest.

---

## 3. Preservation — Format Specification

### 3.1 No Formal Specification Document

**Problem:** The `.a3d` format is defined implicitly by the code in `archive-loader.js` and `archive-creator.js`. There is no standalone specification document. Anyone writing an independent reader must reverse-engineer the behavior from JavaScript source code. For a preservation format, the specification should be a document, not an implementation.

**Solutions:**
- **Short-term:** Write a standalone specification document (`SPECIFICATION.md` or a versioned PDF) that defines the archive structure, manifest schema, required and optional fields, data types, and processing rules independent of any implementation. Publish it in the `archive-3d` repository.
- **Medium-term:** Create a formal JSON Schema for `manifest.json` and include it in the archive itself (or reference it by URL). Validators can then check any manifest against the schema without running the viewer. Version the schema and include the schema version in the manifest:
  ```json
  {
    "$schema": "https://archive-3d.org/schemas/manifest/1.0.json",
    "container_version": "1.0",
    ...
  }
  ```
- **Long-term:** Register the format with relevant bodies — submit to PRONOM for a format ID, register an IANA media type (`application/vnd.archive-3d+zip`), and seek review from digital preservation communities (Digital Preservation Coalition, NDSA, Library of Congress). Formal recognition builds institutional trust.

### 3.2 No Forward/Backward Compatibility Strategy

**Problem:** `container_version: "1.0"` exists but there's no defined behavior for how a v1.0 reader handles v2.0 manifests, or how a v2.0 reader handles v1.0 manifests. The presence of underscore-prefixed fields (`_creation_date`, `_parameters`, `_created_by_version`) suggests a convention for "private" fields, but this isn't documented.

**Solutions:**
- **Short-term:** Document the versioning contract in the spec:
  - Readers MUST ignore unknown fields (forward compatibility)
  - New required fields bump the major version
  - New optional fields bump the minor version
  - Underscore-prefixed fields are implementation-specific and MUST NOT be required for basic parsing
- **Medium-term:** Add a `minimum_reader_version` field so archives can declare the oldest reader version that can process them. Add a `extensions` array for optional capability declarations.
- **Long-term:** Consider adopting a linked-data approach (JSON-LD context) so fields are self-describing and new vocabularies can be mixed in without schema conflicts.

---

## 4. Preservation — Standards Compliance

### 4.1 Dublin Core Mapping Is Informal

**Problem:** The manifest field names resemble Dublin Core but are not interoperable with DC. A DC processor cannot read the manifest directly. The fields use custom names (`creation.creator`, `coverage.spatial`) rather than Dublin Core qualified names (`dc:creator`, `dcterms:spatial`).

**Solutions:**
- **Short-term:** Add a mapping table to the specification document showing exactly which manifest field corresponds to which Dublin Core element and qualifier. This lets humans do the crosswalk even if machines can't.
- **Medium-term:** Add an optional `@context` field (JSON-LD) that provides machine-readable mappings to Dublin Core, Schema.org, and other vocabularies:
  ```json
  {
    "@context": {
      "creator": "dc:creator",
      "date_created": "dcterms:created",
      "spatial": "dcterms:spatial"
    }
  }
  ```
- **Long-term:** Provide export functions that generate standards-compliant metadata sidecar files:
  - Dublin Core XML (`dc.xml`)
  - METS (Metadata Encoding and Transmission Standard) wrapper
  - PREMIS (Preservation Metadata) for preservation events
  These could optionally be included in the archive or generated on demand.

### 4.2 PRONOM IDs Are Misleading for Splat PLY Files

**Problem:** The manifest lists `fmt/831` (PLY) for Gaussian splat PLY files. But splat PLY files contain non-standard custom attributes (spherical harmonics, opacity, scale, rotation quaternions) that no standard PLY reader understands. A preservation system trusting the PRONOM ID would misidentify the file's nature.

**Solutions:**
- **Short-term:** Add a `format_variant` or `format_note` field alongside the PRONOM ID:
  ```json
  "format_registry": {
    "ply_splat": {
      "pronom_id": "fmt/831",
      "variant": "3D Gaussian Splatting (non-standard attributes)",
      "note": "Contains spherical harmonics, opacity, scale, and rotation quaternion attributes not part of the PLY specification"
    },
    "glb": { "pronom_id": "fmt/861" },
    "e57": { "pronom_id": "fmt/643" }
  }
  ```
- **Medium-term:** When/if a PRONOM ID is assigned specifically for Gaussian splat formats, use it. Consider submitting a format description to PRONOM for the splat PLY variant.
- **Long-term:** If Gaussian splats gain a formal specification, update the format registry accordingly. Until then, the variant annotation ensures archivists aren't misled.

### 4.3 No OAIS Reference Model Mapping

**Problem:** The format mixes Submission Information Package (SIP) concerns (provenance, processing notes), Archival Information Package (AIP) concerns (integrity, format registry), and Dissemination Information Package (DIP) concerns (rendering requirements, kiosk viewer) without distinguishing them. Preservation professionals working within OAIS (ISO 14721) expect clear separation.

**Solutions:**
- **Short-term:** Add an OAIS mapping section to the specification document explaining which manifest sections correspond to which OAIS information package components. Identify the manifest as primarily an AIP with DIP generation capability (kiosk export).
- **Medium-term:** Structure the manifest to clearly separate concerns:
  ```json
  {
    "descriptive_information": { /* Dublin Core, archival record */ },
    "provenance_information": { /* capture, processing, operator */ },
    "fixity_information": { /* integrity hashes, checksums */ },
    "representation_information": { /* format registry, rendering requirements */ },
    "context_information": { /* relationships, collection membership */ }
  }
  ```
- **Long-term:** Generate PREMIS metadata for preservation events (creation, migration, integrity checks). Include a METS structural map that describes the relationship between files in the archive. These are the interchange formats that institutional repositories actually ingest.

---

## 5. Preservation — Integrity & Trust

### 5.1 No Digital Signatures

**Problem:** SHA-256 hashes detect accidental corruption but not intentional tampering. For heritage documentation used in legal proceedings, insurance claims, or forensic analysis, the absence of cryptographic signatures means there's no way to verify that the archive hasn't been modified since creation.

**Solutions:**
- **Short-term:** Document this limitation in the spec. Add a `signature` field to the manifest schema as reserved/optional.
- **Medium-term:** Implement optional signing using the Web Crypto API. The creator generates a keypair, signs the manifest hash, and includes the public key and signature in the archive:
  ```json
  "integrity": {
    "algorithm": "SHA-256",
    "manifest_hash": "a1b2c3...",
    "signature": {
      "algorithm": "ECDSA-P256",
      "value": "base64-encoded-signature",
      "public_key": "base64-encoded-public-key",
      "signer": "Jane Smith",
      "signer_orcid": "0000-0002-1234-5678",
      "timestamp": "2026-01-15T08:30:00Z"
    }
  }
  ```
- **Long-term:** Support institutional PKI certificates and timestamping authorities (RFC 3161) so signatures can be verified against a chain of trust. This is what legal and forensic contexts require.

### 5.2 SHA-256 Fails Silently on HTTP

**Problem:** The Web Crypto API's `SubtleCrypto` requires a secure context (HTTPS). On HTTP deployments (common in development and some institutional intranets), hashing silently returns `null`. Archives created over HTTP have empty integrity sections with no user-visible warning.

**Solutions:**
- **Short-term:** Display a prominent UI warning when `crypto.subtle` is unavailable: "Integrity hashing unavailable — HTTPS required. Archives created here will not include checksums."

  **Status: Implemented (2026-02-08)**
  - Warning banner added to Integrity tab (shows when crypto.subtle unavailable)
  - Toast notification on page load for HTTP contexts
  - Advisory only, does not block archive creation

- **Medium-term:** Bundle a pure-JavaScript SHA-256 fallback (e.g., from the `js-sha256` library, ~4KB minified). Use `crypto.subtle` when available for performance, fall back to the JS implementation on HTTP. This ensures integrity data is always present.
- **Long-term:** Enforce HTTPS for the application in production deployments. The Docker/nginx configuration should redirect HTTP to HTTPS. Document HTTPS as a deployment requirement.

---

## 6. Preservation — Kiosk Viewer Durability

### 6.1 Polyglot HTML+ZIP Format Is Fragile

**Problem:** The kiosk viewer appends raw ZIP bytes after `</html>`. This polyglot format can be corrupted by: HTML sanitizers that strip content after `</html>`, email systems that transcode attachments, CMS platforms, charset-aware file transfers (FTP ASCII mode), or any tool that processes "HTML files" and doesn't expect trailing binary data.

**Solutions:**
- **Short-term:** Document the fragility clearly in the spec and in the kiosk viewer's UI. Add a warning: "This file must be transferred as binary. Do not open in text editors or send via systems that may modify HTML content."
- **Medium-term:** Base64-encode the ZIP data and embed it within a `<script>` tag as a JavaScript string, rather than appending raw binary after `</html>`. This makes the file valid HTML throughout:
  ```html
  <script id="archive-data" type="application/octet-stream">
  base64-encoded-zip-data-here
  </script>
  </body></html>
  ```
  This increases file size by ~33% but survives any HTML-aware processing. The viewer decodes the base64 at runtime.
- **Long-term:** Consider alternative self-contained formats:
  - A `.zip` file where `index.html` is the entry point (like EPUB). Browsers can serve this from a Service Worker.
  - A Web Bundle (`.wbn`) — a W3C format specifically designed for self-contained web content. Browser support is emerging.
  - An Electron/Tauri-packaged offline viewer for institutional desktops where browser compatibility is less certain.

### 6.2 Embedded JavaScript Will Age

**Problem:** The kiosk viewer embeds Three.js 0.170.0 and Spark.js 0.1.10 as base64 blobs. These libraries use JavaScript patterns, APIs, and WebGL calls that may break as browsers evolve. A kiosk file created today may not render correctly in a 2036 browser.

**Solutions:**
- **Short-term:** Accept this limitation and document it. The kiosk viewer is a best-effort snapshot, not a permanent renderer. The archive's true preservation value is in the raw data files and metadata.
- **Medium-term:** Include a `viewer_version` and `viewer_created_date` in the kiosk HTML metadata. Add a conspicuous "This viewer was created on [date] and may not work in future browsers. The original data files can be extracted from the archive." message in the kiosk UI.
- **Long-term:** Investigate rendering to a static format as a preservation fallback. Generate a set of pre-rendered turntable images or a video orbit alongside the interactive viewer. If the WebGL code breaks, the pre-rendered media survives:
  ```json
  "preservation_fallback": {
    "turntable_video": "assets/preview_orbit.mp4",
    "preview_images": [
      "assets/preview_front.jpg",
      "assets/preview_side.jpg",
      "assets/preview_top.jpg"
    ]
  }
  ```

---

## 7. Usability — Measurement & Analysis Tools

### 7.1 No Measurement Tools

**Problem:** The quality metrics section documents sub-millimeter accuracy, but the viewer has no distance measurement, area calculation, cross-section, or volume estimation tools. Users can read that the data is precise but cannot actually measure anything.

**Solutions:**
- **Short-term:** Add a point-to-point distance tool. Click two points on the 3D surface (via raycasting), display the Euclidean distance in the scene units (meters). This is the most-requested feature in any 3D heritage viewer.
- **Medium-term:** Add:
  - **Multi-point polyline measurement** — click a series of points, display cumulative distance
  - **Surface area measurement** — select a region, compute area from the mesh triangles within it
  - **Cross-section tool** — define a cutting plane, display the intersection profile as a 2D line drawing
  - **Coordinate readout** — hover over the surface, display XYZ coordinates in real-time
- **Long-term:** Add:
  - **Volume estimation** from closed mesh regions
  - **Deviation analysis** — color-map the distance between two representations (e.g., mesh vs. point cloud) to visualize reconstruction accuracy
  - **Change detection** — compare two versions of the same capture over time, highlight differences
  - Store measurement results as a special annotation type in the manifest so they persist across sessions

---

## 8. Usability — Metadata Authoring

### 8.1 Metadata UI Is Overwhelming

**Problem:** Eight metadata tabs with many free-text fields require domain expertise. Fields like PRONOM IDs, ORCID, accuracy grades, and PBR workflow types are opaque to non-specialists. Most users will leave them blank.

**Solutions:**
- **Short-term:** Add tooltips/help text to every field explaining what it is and why it matters. Add placeholder text with realistic examples (e.g., "0000-0002-1234-5678" for ORCID).
- **Medium-term:** Implement metadata templates for common scenarios:
  - "Heritage Survey" — pre-fills relevant preservation fields, quality tier, Dublin Core structure
  - "Research Capture" — emphasizes provenance, processing chain, ORCID
  - "Quick Archive" — minimal required fields only (title, creator, license)

  Add auto-detection where possible:
  - Parse EXIF data from images to pre-fill capture date, device, GPS coordinates
  - Detect file format and auto-populate PRONOM IDs
  - Infer mesh statistics (face count, vertex count, bounding box dimensions) from loaded files
- **Long-term:** Add a "metadata completeness score" that shows users how thorough their metadata is, with suggestions for what to add next. Implement ORCID lookup (autocomplete from the ORCID API) and PRONOM lookup (search the PRONOM registry). Support import of metadata from external sources (CSV, Dublin Core XML, institutional collection management systems).

### 8.2 No Metadata Validation

**Problem:** There's no validation that metadata values are well-formed. An ORCID field accepts any string, coordinates accept any text, dates accept any format. Invalid metadata is silently accepted and persisted.

**Solutions:**
- **Short-term:** Add format validation for structured fields:
  - ORCID: regex `\d{4}-\d{4}-\d{4}-\d{3}[\dX]` with checksum verification
  - Coordinates: numeric latitude/longitude within valid ranges
  - Dates: ISO 8601 format validation
  - PRONOM IDs: regex `fmt/\d+` or `x-fmt/\d+`
  Display validation errors inline next to the field.

  **Status: Implemented (2026-02-08)**
  - Format validation for ORCID, coordinates, dates, PRONOM IDs
  - Inline error display with blur-triggered validation
  - Advisory only, does not block export
  - CSS classes for error/valid states

- **Medium-term:** Validate the entire manifest against a JSON Schema before export. Show a validation report listing errors, warnings, and suggestions. Allow export with warnings but block export with errors (e.g., missing required fields).
- **Long-term:** Implement a pre-submission validation service that checks metadata against institutional requirements. Different institutions may have different required fields — support configurable validation profiles.

---

## 9. Usability — Collaboration & Versioning

### 9.1 No Versioning Within Archives

**Problem:** Each export creates a new, complete archive. There's no diff, no changelog, no mechanism to track what changed between versions. The `replaces` relationship field exists but is free text with no linking.

**Solutions:**
- **Short-term:** Add a `version_history` array to the manifest that records previous versions:
  ```json
  "version_history": [
    {
      "version": "1.0",
      "date": "2026-01-15T08:30:00Z",
      "author": "Sarah Chen",
      "notes": "Initial capture and processing"
    },
    {
      "version": "1.1",
      "date": "2026-03-20T14:00:00Z",
      "author": "James Park",
      "notes": "Added condition annotations, updated mesh with gap-filled regions"
    }
  ]
  ```

  **Status: Implemented (2026-02-08)**
  - version_history array added to manifest root
  - UI in Project tab with "Add Version Entry" button
  - Each entry contains: version, date, description
  - Preserved on archive re-import (round-trip support)

- **Medium-term:** Implement a diff tool that can compare two `.a3d` archives and report changes: new/modified/removed files, metadata differences, annotation changes, transform differences.
- **Long-term:** Support incremental archives that reference a base archive and contain only the changed files. This reduces storage for large datasets with frequent updates. Implement a PREMIS-style event log that records every significant action (creation, annotation, re-alignment, export).

### 9.2 No Collaboration Model

**Problem:** The annotation system is single-user. There's no attribution on individual annotations, no timestamps, no review workflow. For institutional use (museum condition reports, survey team reviews), multi-user annotation with attribution is essential.

**Solutions:**
- **Short-term:** Add `author`, `created_date`, and `modified_date` fields to each annotation:
  ```json
  {
    "id": "anno_1",
    "title": "Crack on left armrest",
    "body": "...",
    "author": "Sarah Chen",
    "author_orcid": "0000-0002-7391-5482",
    "created_date": "2026-01-15T09:45:00Z",
    "modified_date": "2026-03-20T14:12:00Z",
    "status": "confirmed"
  }
  ```
- **Medium-term:** Add annotation status workflow: `draft` → `submitted` → `reviewed` → `confirmed`. Add a `replies` array so annotations can have threaded comments. Support multiple annotation layers (e.g., "Condition Assessment 2026", "Historical Notes", "Survey Control Points") that can be toggled independently.
- **Long-term:** Implement a Web Annotation Data Model (W3C standard) compatible export. This makes annotations interoperable with other annotation tools and institutional systems. Support real-time collaboration via a server component for teams working on the same archive simultaneously.

---

## 10. Usability — Annotation System

### 10.1 Annotations Are Text-Only

**Problem:** Annotations support title, body, and 3D position but no measurements, area highlighting, polyline markup, or domain-specific types. For condition documentation, free text is insufficient — assessors need to mark crack lengths, areas of loss, severity classifications, and comparable regions.

**Solutions:**
- **Short-term:** Add annotation types with type-specific fields:
  ```json
  {
    "id": "anno_3",
    "type": "condition_observation",
    "title": "Hairline crack — torso seam",
    "severity": "minor",
    "category": "structural/crack",
    "measurement": { "length_mm": 420, "width_mm_min": 0.08, "width_mm_max": 0.22 },
    "body": "...",
    "position": { "x": 0.04, "y": 2.85, "z": 0.41 }
  }
  ```
- **Medium-term:** Support geometric annotation primitives beyond single points:
  - **Polyline annotations** — trace a crack path as a series of 3D points
  - **Area annotations** — define a polygon on the surface to mark a region (loss area, biological growth zone)
  - **Measurement annotations** — store two endpoints and the computed distance
  - **Cross-reference annotations** — link two annotations together (e.g., "this crack is the same feature as anno_5")
- **Long-term:** Support image attachments on annotations (e.g., a close-up photograph taken during the survey). Support annotation import/export in the Web Annotation Data Model format for interoperability with IIIF, Mirador, and other cultural heritage annotation tools.

---

## 11. Architecture — Format Independence

### 11.1 The Archive Format Is Coupled to the Viewer

**Problem:** `packer: "simple-splat-mesh-viewer"` in the manifest, and the absence of an independent specification, means the format is defined by this specific tool. If the project is abandoned, the format specification effectively dies with it. Contrast with IIIF (independent spec, consortium governance, multiple implementations) or E57 (ASTM standard).

**Solutions:**
- **Short-term:** Give the format its own identity separate from the viewer. The `archive-3d` repository is a start — flesh it out with a standalone specification, examples, and a validator. Change `packer` to reference the tool, but add a `format` field that references the spec:
  ```json
  {
    "format": "archive-3d",
    "format_version": "1.0",
    "format_spec": "https://archive-3d.org/spec/1.0",
    "packer": "simple-splat-mesh-viewer",
    "packer_version": "1.0.0"
  }
  ```
- **Medium-term:** Write reference implementations in at least two languages (JavaScript for the web, Python for institutional workflows/scripting). A Python reader/writer would significantly increase adoption in the heritage and survey communities where Python tooling is standard (Open3D, CloudCompare scripting, Agisoft Metashape scripts).
- **Long-term:** Form a small governance group (even 3-5 people from different institutions) to steward the specification. Publish the spec under a permissive license (CC-BY or similar). Seek endorsement from relevant professional bodies (CIPA Heritage Documentation, ISPRS, AIA).

### 11.2 Tension Between Self-Contained and Open

**Problem:** The `.a3d` archive requires this viewer to display. The kiosk export is self-contained but depends on a frozen JavaScript stack. Neither is truly self-contained in the archival sense — one needs software, the other needs a compatible browser.

**Solutions:**
- **Short-term:** Accept and document the two-tier model explicitly:
  - **Tier 1 (Archive, .a3d):** Long-term preservation. Standard ZIP + JSON + standard file formats. Any ZIP library + JSON parser can extract and read the contents. The data survives without any specific viewer.
  - **Tier 2 (Kiosk, .html):** Convenient access. Works in contemporary browsers. May stop working as browsers evolve. The viewer is a convenience, not a preservation guarantee.
- **Medium-term:** Ensure the archive's data files are fully self-describing without the viewer. Include a `README.txt` in every archive explaining the structure in plain text:
  ```
  This is an archive-3d container (version 1.0).
  It is a standard ZIP file. To extract:
    unzip archive.a3d
  Contents:
    manifest.json - Metadata (JSON format)
    assets/       - 3D data files (GLB, PLY, E57)
    preview.jpg   - Thumbnail image
  For the specification, see: https://archive-3d.org/spec
  ```
- **Long-term:** Provide export to established institutional formats:
  - **BagIt** (Library of Congress) — a standard packaging format used by digital preservation repositories
  - **OCFL** (Oxford Common File Layout) — used by institutional repositories for versioned digital objects
  - **SIP generator** — create submission packages for specific repository systems (Archivematica, Preservica, DSpace)

---

## 12. Architecture — Data Hierarchy

### 12.1 Splats, Meshes, and Point Clouds Are Treated as Peers

**Problem:** All data entries in the manifest have equal standing. A Gaussian splat (derived visualization product, experimental format) sits alongside an E57 point cloud (primary measurement artifact, ASTM standard) as a sibling entry. This obscures the archival hierarchy — some representations are primary records; others are derived products for convenience.

**Solutions:**
- **Short-term:** Add a `role` field to each data entry:
  ```json
  "data_entries": {
    "pointcloud_0": {
      "file_name": "assets/scan.e57",
      "role": "primary",
      "role_description": "Original measurement data from terrestrial laser scanner"
    },
    "mesh_0": {
      "file_name": "assets/mesh.glb",
      "role": "derived",
      "derived_from": "pointcloud_0",
      "role_description": "Surface reconstruction from point cloud"
    },
    "splat_0": {
      "file_name": "assets/scene.ply",
      "role": "derived",
      "derived_from": "mesh_0",
      "role_description": "Gaussian splat visualization trained from photogrammetric images"
    }
  }
  ```

  **Status: Implemented (2026-02-08)**
  - Role field added to each data entry (primary/derived/blank)
  - Dropdown in Assets tab for splat, mesh, and pointcloud
  - Stored in manifest as data_entries[key].role
  - Preserved on round-trip

- **Medium-term:** Support a derivation chain in the manifest that records how each file was produced from its parent: which software, which parameters, which version. This creates a full processing provenance graph within the archive, not just a flat list of files.
- **Long-term:** Align the data hierarchy with PREMIS (Preservation Metadata: Implementation Strategies) object relationships. PREMIS defines relationship types like `isDerivedFrom`, `hasSource`, `isPartOf` that map naturally to this hierarchy and are understood by preservation systems worldwide.

---

## Priority Matrix

| # | Issue | Impact | Effort | Priority |
|---|-------|--------|--------|----------|
| 3.1 | No formal specification | High | Medium | **Critical** |
| 11.1 | Format coupled to viewer | High | Medium | **Critical** |
| 12.1 | No data hierarchy | High | Low | **Critical** |
| 4.2 | PRONOM IDs misleading | Medium | Low | **High** |
| 5.2 | SHA-256 fails on HTTP | Medium | Low | **High** |
| 7.1 | No measurement tools | High | Medium | **High** |
| 8.1 | Metadata UI overwhelming | Medium | Medium | **High** |
| 3.2 | No compatibility strategy | Medium | Low | **High** |
| 10.1 | Annotations text-only | Medium | Medium | **High** |
| 9.2 | No collaboration model | Medium | Medium | **Medium** |
| 5.1 | No digital signatures | Medium | High | **Medium** |
| 1.1 | Splat format instability | High | Low (document) | **Medium** |
| 1.2 | WebGL 2.0 lifespan | Medium | High | **Medium** |
| 6.1 | Polyglot format fragile | Medium | Medium | **Medium** |
| 4.1 | Dublin Core informal | Medium | Medium | **Medium** |
| 4.3 | No OAIS mapping | Low | Medium | **Medium** |
| 1.4 | No LOD loading | Medium | High | **Medium** |
| 8.2 | No metadata validation | Medium | Medium | **Medium** |
| 9.1 | No versioning | Medium | Medium | **Medium** |
| 1.3 | CDN dependency | Low | Low | **Low** |
| 2.1 | ICP alignment naive | Low | High | **Low** |
| 6.2 | Embedded JS will age | Low | High | **Low** |

---

## Summary

The three most impactful areas of work are:

1. **Write a standalone format specification** (3.1, 3.2, 11.1) — this unlocks everything else. Without a spec, the format can't gain institutional trust, independent implementations, or standards recognition.

2. **Add data hierarchy and role classification** (12.1, 4.2, 1.1) — distinguish primary records from derived products. This is essential for preservation systems to make correct decisions about what to preserve and what can be regenerated.

3. **Add measurement and structured annotation tools** (7.1, 10.1) — this is what makes the viewer genuinely useful for heritage and survey professionals, rather than just a pretty display.

Everything else is important but secondary to these three foundations.
