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

## Manifest Schema

The `manifest.json` file is the heart of the archive, containing structured metadata across several domains:

```json
{
  "container_version": "1.0",
  "packer": "simple-splat-mesh-viewer",
  "packer_version": "1.0.0",
  "_creation_date": "2026-02-05T12:00:00.000Z",

  "project": {
    "title": "Historic Building Facade",
    "id": "historic-building-facade",
    "description": "Photogrammetric capture of the east facade",
    "license": "CC-BY 4.0"
  },

  "relationships": {
    "part_of": "building-survey-2026",
    "derived_from": "raw-scan-001",
    "replaces": "",
    "related_objects": ["west-facade", "interior-scan"]
  },

  "provenance": {
    "capture_date": "2026-01-15",
    "capture_device": "Leica RTC360",
    "device_serial": "SN-12345",
    "operator": "Jane Smith",
    "operator_orcid": "0000-0002-1234-5678",
    "location": "Oxford, UK",
    "convention_hints": ["arxiv:2312.13299"],
    "processing_software": [
      { "name": "Reality Capture", "version": "1.4" },
      { "name": "CloudCompare", "version": "2.13" }
    ],
    "processing_notes": "Aligned from 847 images, cleaned and decimated"
  },

  "quality_metrics": {
    "tier": "reference",
    "accuracy_grade": "A",
    "capture_resolution": { "value": "2", "unit": "mm", "type": "GSD" },
    "alignment_error": { "value": "0.5", "unit": "mm", "method": "RMSE" },
    "scale_verification": "Verified with calibrated scale bar",
    "data_quality": {
      "coverage_gaps": "Minor occlusion behind downpipe",
      "reconstruction_areas": "None",
      "color_calibration": "X-Rite ColorChecker used",
      "measurement_uncertainty": "0.3mm"
    }
  },

  "archival_record": {
    "standard": "Dublin Core / Smithsonian EDAN",
    "title": "East Facade of St. Mary's Church",
    "ids": {
      "accession_number": "2026.001.0042",
      "uri": "https://collection.example.org/objects/42"
    },
    "creation": {
      "creator": "Heritage Survey Team",
      "date_created": "2026-01-15",
      "period": "Gothic Revival",
      "culture": "English"
    },
    "physical_description": {
      "medium": "Limestone ashlar with flint infill",
      "dimensions": { "height": "15m", "width": "22m", "depth": "1.2m" },
      "condition": "Fair — weathering to upper tracery"
    },
    "rights": {
      "copyright_status": "CC-BY 4.0",
      "credit_line": "Heritage Survey Team, 2026"
    },
    "coverage": {
      "spatial": { "location_name": "Oxford, UK", "coordinates": { "latitude": "51.752", "longitude": "-1.258" } },
      "temporal": { "subject_period": "1860-1875", "subject_date_circa": true }
    }
  },

  "material_standard": {
    "workflow": "metalness-roughness",
    "color_space": "sRGB",
    "normal_space": "OpenGL (+Y up)"
  },

  "preservation": {
    "format_registry": {
      "glb": "fmt/861",
      "obj": "fmt/935",
      "ply": "fmt/831",
      "e57": "fmt/643"
    },
    "significant_properties": [
      "geometry_mesh_structure",
      "vertex_colors",
      "real_world_scale",
      "gaussian_splat_data",
      "e57_point_cloud_data"
    ],
    "rendering_requirements": "WebGL 2.0",
    "rendering_notes": ""
  },

  "version_history": [
    {
      "version": "1.0",
      "date": "2026-01-15T08:30:00Z",
      "description": "Initial capture and processing"
    },
    {
      "version": "1.1",
      "date": "2026-03-20T14:00:00Z",
      "description": "Added condition annotations, updated mesh with gap-filled regions"
    }
  ],

  "data_entries": {
    "scene_0": {
      "file_name": "scene.ply",
      "role": "derived",
      "created_by": "nerfstudio",
      "_created_by_version": "1.1.0",
      "_source_notes": "Trained for 30k iterations",
      "_parameters": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": 1 },
      "_hash": "sha256:abc123..."
    },
    "mesh_0": {
      "file_name": "model.glb",
      "role": "derived",
      "created_by": "Reality Capture",
      "_parameters": { "position": [0.1, 0, -0.2], "rotation": [0, 0, 0], "scale": 1 },
      "_hash": "sha256:def456..."
    },
    "pointcloud_0": {
      "file_name": "scan.e57",
      "role": "primary",
      "created_by": "Leica Cyclone",
      "_parameters": { "position": [0, 0, 0], "rotation": [0, 0, 0], "scale": 1 },
      "_hash": "sha256:789ghi..."
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
      "body": "Structural crack running NE-SW, approx 2.3m\n\n![Detail](asset:images/crack_detail.jpg)",
      "position": { "x": 1.2, "y": 3.4, "z": -0.1 },
      "camera_position": { "x": 2.0, "y": 4.0, "z": 3.0 },
      "camera_target": { "x": 1.2, "y": 3.4, "z": -0.1 }
    }
  ],

  "integrity": {
    "algorithm": "SHA-256",
    "manifest_hash": "a1b2c3d4e5f6...",
    "assets": {
      "assets/scene_0.ply": "sha256:abc123...",
      "assets/mesh_0.glb": "sha256:def456...",
      "assets/pointcloud_0.e57": "sha256:789ghi..."
    }
  },

  "_meta": {
    "custom_fields": {}
  }
}
```

## Loading Archives

**From the UI**: Click "From File" in the Load Archive section and select a `.a3d` or `.a3z` file.

**From a URL parameter**:
```
https://viewer.example.com?archive=/path/to/scene.a3d
```

**Via Docker**:
```bash
docker run -p 8080:80 -e DEFAULT_ARCHIVE_URL="/assets/scene.a3d" splat-mesh-viewer
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
