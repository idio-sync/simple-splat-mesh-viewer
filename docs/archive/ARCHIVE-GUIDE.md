# Archive Format Guide

The archive container format (`.a3d` / `.a3z`) bundles 3D assets, metadata, alignment data, annotations, and preservation information into a single distributable file. It is designed for long-term archival and interoperability, integrating with the [archive-3d](https://github.com/idio-sync/archive-3d) specification.

For the formal specification, see [SPECIFICATION.md](SPECIFICATION.md).

## Structure

Archives are ZIP files containing:

```
scene.a3d/
  manifest.json              # Metadata, file listings, transforms, annotations
  README.txt                 # Plain-text guide to archive contents (auto-generated)
  preview.jpg                # Thumbnail preview (optional, auto-captured or manual)
  assets/
    scene_0.ply              # Gaussian splat data
    mesh_0.glb               # 3D mesh
    pointcloud_0.e57         # Point cloud (optional)
    mesh_0_proxy.glb         # LOD proxy mesh (optional)
  images/                    # Image attachments referenced by annotations/descriptions
    photo1.jpg
    detail2.png
  screenshots/               # User-captured viewport screenshots (optional)
    screenshot_0.jpg
    screenshot_1.jpg
  sources/                   # Archived source files (optional, not rendered)
    calibration_report.pdf
```

## Manifest Overview

The `manifest.json` file is the heart of the archive. It contains structured metadata organized into these sections:

| Section | Purpose |
|---------|---------|
| `project` | Title, description, tags, license, project ID |
| `relationships` | Links to parent collections, related objects, superseded archives |
| `provenance` | Capture date, device, operator, processing software chain |
| `quality_metrics` | Accuracy tier, alignment error, capture resolution, data quality notes |
| `archival_record` | Dublin Core / VRA Core cataloging metadata for the physical subject |
| `material_standard` | PBR workflow, color space, normal map convention |
| `preservation` | PRONOM format registry IDs, significant properties, rendering requirements |
| `data_entries` | Asset file manifest with spatial transforms (`_parameters`) and roles |
| `annotations` | 3D spatial annotations with camera viewpoints |
| `integrity` | SHA-256 per-asset and manifest-level hashes |
| `version_history` | Chronological list of archive revisions |
| `_meta` | Implementation-specific data (asset statistics, custom fields) |

For field-by-field documentation, types, and requirement levels, see [SPECIFICATION.md — Section 5](SPECIFICATION.md#5-manifest-specification). A complete manifest example is in [SPECIFICATION.md — Section 13](SPECIFICATION.md#13-complete-manifest-example).

## Loading Archives

**From the UI**: Click "From File" in the Load Archive section and select a `.a3d` or `.a3z` file.

**From a URL parameter**:
```
https://viewer.example.com?archive=/path/to/scene.a3d
```

**Via Docker**:
```bash
docker run -p 8080:80 -e DEFAULT_ARCHIVE_URL="/assets/scene.a3d" vitrine3d
```

When an archive is loaded:
- The manifest is extracted first (lazy loading — asset files remain compressed in memory)
- Assets are decompressed and loaded on demand, with per-asset inline progress indicators
- Saved transforms from `_parameters` are applied to each object
- Metadata populates the sidebar (including version history and data entry roles)
- Annotations are restored with their 3D positions, camera views, and image attachments
- Image assets under `images/` are resolved to blob URLs for display in descriptions and annotations

## Exporting Archives

Click the **Export Archive** toolbar button to save the current scene:

1. Choose format: `.a3d` (standard) or `.a3z` (compressed)
2. The export bundles all loaded assets, current transforms, annotations, metadata, and image attachments
3. SHA-256 integrity hashes are computed for each asset file (requires HTTPS; a warning is shown on HTTP)
4. A preview thumbnail is auto-captured from the current viewport (or uses a manual preview if one was set via the viewfinder)
5. Any captured screenshots are exported to a `screenshots/` directory in the archive
6. Version history entries and data entry roles are preserved in the manifest

## Designing for Long-Term Preservation

The `.a3d` / `.a3z` archive container is designed with digital preservation as a first-class concern. For institutions capturing real-world objects — buildings, artifacts, archaeological sites, heritage assets — the format addresses key challenges in long-term 3D data archival.

### Self-Describing and Self-Contained

Each archive is a single file containing all assets, metadata, and alignment data. There are no external dependencies or broken links. A researcher opening the archive in 10 or 50 years finds everything needed to understand and render the capture, including:

- The raw 3D data in standardized formats (glTF, PLY, E57)
- Full provenance: who captured it, when, with what device, what processing was done
- Quality metrics: accuracy grade, alignment error, measurement uncertainty
- Spatial annotations with descriptions and saved camera views
- Relationships to other objects in a collection

### Standards Alignment

The manifest metadata maps to established standards used by archives, libraries, and museums:

- **Dublin Core** — International metadata standard for digital resources, enabling discovery and cataloging
- **Smithsonian EDAN** — Enterprise Digital Asset Network fields for museum collection management
- **PRONOM** — UK National Archives technical registry; each file format is identified by its PRONOM ID (e.g., `fmt/861` for glTF Binary, `fmt/643` for E57), enabling automated format identification and migration planning
- **ORCID** — Persistent digital identifiers for researchers, linking captures to their creators

### Preservation-Specific Metadata

The `preservation` section captures information critical for future rendering and migration:

- **Format registry IDs** ensure files can be identified even if extensions change
- **Significant properties** declare which aspects of the data must be preserved (geometry, vertex colors, real-world scale, Gaussian splat data, point cloud data)
- **Rendering requirements** document the minimum environment needed (WebGL 2.0)
- **Rendering notes** capture any special considerations for faithful reproduction

### Integrity Verification

Archives include SHA-256 hashes for:
- Each individual asset file
- The manifest itself

This enables bit-level integrity checks to detect corruption or tampering over storage lifetimes spanning decades.

### Quality Documentation

The tiered quality system (Metrology / Reference / Visualization) with accuracy grades, capture resolution, alignment error measurements, and data quality notes provides the context needed to assess fitness-for-purpose. A researcher can determine whether a 20-year-old scan is suitable for structural analysis or only for visual reference.

### Multi-Representation Bundling

By packaging Gaussian splats, traditional meshes, and E57 point clouds together in a single archive, the format hedges against technological change. If one rendering technology becomes obsolete, alternative representations remain available. The alignment transforms ensure all representations are spatially registered and can be displayed together.

### Open Format

The container is a standard ZIP file with a JSON manifest. No proprietary tools are required to extract or inspect the contents. Any programming language with ZIP and JSON support can read the archive.
