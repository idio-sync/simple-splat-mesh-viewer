# Proof of Concept 3D viewer

A web-based viewer for viewing Gaussian splats, 3D models, and E57 point clouds, powered by [Three.js](https://github.com/mrdoob/three.js/) and [Spark](https://sparkjs.dev/). Designed for cultural heritage, surveying, and digital preservation workflows, with a standards-based archive container format for long-term archival of real-world 3D captures.

## Features

- Load and display **3D models** (.glb, .gltf, .obj)
- Load and display **E57 point clouds** (.e57) via [three-e57-loader](https://www.npmjs.com/package/three-e57-loader)
- Load and display **Gaussian splat** files (.ply, .splat, .ksplat, .spz, .sog)
- **Archive container support** (.a3d, .a3z) — bundle all assets, metadata, and multi-data alignment into a single file
- **Four display modes**: Model only, Splat only, Both overlaid, or Split side-by-side, and Point Cloud
- **Transform controls** for positioning, rotating, and scaling each object independently
- **Auto-alignment** and **ICP alignment** for registering splats and models
- **Fly camera mode** for first-person navigation (WASD + mouse look)
- **Annotation system** for placing spatial notes on 3D surfaces, with image attachments and depth-aware markers
- **Metadata editor** with 8 tabs covering project info, provenance, archival records, quality metrics, preservation, and more — with inline field validation
- **Offline kiosk viewer** — generate a self-contained ~1 MB HTML file for client delivery, fully functional with zero network access
- **Lazy archive loading** — only the manifest is decompressed on open; individual assets load on demand
- **Image support** in annotations and project descriptions via an `asset:` protocol, stored as separate entries in the archive
- **Version history** tracking within archives for recording changes across exports
- **Data entry roles** — classify assets as primary records or derived products for preservation clarity
- **Shareable URLs** with embedded alignment, display settings, and UI presets
- **Docker deployment** with environment-variable configuration and kiosk mode support
- **Digital preservation metadata** aligned with Dublin Core, PRONOM, and Smithsonian EDAN standards

## Quick Start

### Using Python (simplest)
```bash
cd simple-splat-mesh-viewer/src
python3 -m http.server 8080
```
Then open http://localhost:8080 in your browser.

### Using Node.js
```bash
npx serve src
```

### Using Docker
```bash
# Build the image
docker build -t splat-mesh-viewer -f docker/Dockerfile .

# Run with default settings
docker run -p 8080:80 splat-mesh-viewer

# Run with pre-loaded archive
docker run -p 8080:80 \
  -e DEFAULT_ARCHIVE_URL="https://example.com/scene.a3d" \
  splat-mesh-viewer

# Run with pre-loaded files
docker run -p 8080:80 \
  -e DEFAULT_SPLAT_URL="https://example.com/model.ply" \
  -e DEFAULT_MODEL_URL="https://example.com/model.glb" \
  -e DEFAULT_POINTCLOUD_URL="https://example.com/scan.e57" \
  splat-mesh-viewer
```

## Supported Formats

### Archive Containers
- `.a3d` — Archive 3D container (ZIP-based, uncompressed)
- `.a3z` — Archive 3D container (ZIP-based, compressed) - experimental 

### Gaussian Splats (via Spark)
- `.ply` — Standard PLY format with Gaussian splat data
- `.splat` — Compressed splat format
- `.ksplat` — Compressed splat format
- `.spz` — Spark compressed format
- `.sog` — SOG format

### 3D Models (via Three.js)
- `.glb` — Binary glTF
- `.gltf` — glTF with external resources
- `.obj` — Wavefront OBJ

### Point Clouds
- `.e57` — ASTM E57 format (via [three-e57-loader](https://www.npmjs.com/package/three-e57-loader), which uses the [web-e57](https://www.npmjs.com/package/web-e57) WASM parser)

## Usage

### Loading Files

**From the UI**: Use the Load Files panel to load assets from local files or URLs. Each asset type (Splat, Model, Point Cloud, Archive) has "From File" and "From URL" buttons.

**From URL parameters**: Pass file URLs directly in the address bar (see [URL Parameters](#url-parameters)).

**From an archive**: Loading a `.a3d` or `.a3z` file automatically extracts and displays all bundled assets with their saved transforms, metadata, and annotations.

### Display Modes

| Mode | Description |
|------|-------------|
| **Splat** | Show only the Gaussian splat |
| **Model** | Show only the 3D model (point cloud follows model visibility) |
| **Both** | Overlay all assets for comparison |
| **Split** | Side-by-side: splat on left, model + point cloud on right, with synced camera |

### Camera Controls

**Orbit mode** (default):
- **Left-click + drag** — Rotate view
- **Right-click + drag** — Pan view
- **Scroll wheel** — Zoom in/out
- **Reset Camera** button — Return to initial position
- **Fit to View** button — Auto-frame all loaded content

**Fly mode** (press `F` or click the fly camera toolbar button):
- **WASD** — Move forward/left/backward/right
- **Q / E** — Move down / up
- **Right-click + drag** — Mouse look (yaw/pitch)
- **Shift** — Fast movement (3x speed)
- **Ctrl** — Slow movement (0.25x speed)
- **Scroll wheel** — Adjust movement speed
- **Escape** — Exit fly mode

### Alignment

- **Auto Align** — Aligns objects using bounding box center-of-mass matching
- **ICP Align** — Iterative Closest Point algorithm for precise point-to-point registration (works best when objects are roughly aligned first)
- **Save Alignment** — Downloads transform data as a JSON file
- **Load Alignment** — Applies transforms from a saved JSON file or URL
- **Reset All** — Resets all objects to origin with default scale

### Annotations

Press `A` or click the annotation toolbar button to enter placement mode, then click on any 3D surface to create an annotation.

Each annotation stores:
- Title and description (supports markdown with inline images)
- 3D position on the surface
- Camera viewpoint (position + target) for restoring the view
- Optional image attachments stored inside the archive

Annotations appear as numbered markers in the 3D view and as chips in a bottom bar. Markers are **depth-aware** — they fade when the annotated surface faces away from the camera, reducing visual clutter. In the kiosk viewer, selecting a marker draws an SVG connecting line to its popup.

Annotations are saved inside archive containers and persist across sessions via localStorage. Images referenced in annotation descriptions use an `asset:images/filename.ext` protocol that resolves to blob URLs at runtime.

### Scene Settings

- **Grid** — Toggle a reference grid
- **Background color** — Choose from presets (dark blue, near black, grays, light gray) or pick a custom color
- **Lighting** — Adjust ambient, hemisphere, and two directional lights (affects models and point clouds only)

### Asset-Specific Settings

**Splat**: Scale, position, rotation

**Model**: Scale, opacity, wireframe toggle, position, rotation

**Point Cloud**: Scale, point size, opacity, position, rotation

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `W` | Translate mode |
| `E` | Rotate mode |
| `R` | Scale mode |
| `A` | Toggle annotation placement mode |
| `M` | Toggle metadata sidebar |
| `F` | Toggle fly camera mode |
| `Escape` | Deselect object / exit fly mode / close popups |

## Toolbar

The left-side toolbar provides quick access to:

| Button | Action |
|--------|--------|
| Toggle Controls (hamburger icon) | Show/hide the controls panel |
| Metadata | Open the metadata sidebar for viewing or editing |
| Annotate | Enter annotation placement mode |
| Fly Camera | Switch to first-person fly camera |
| Toggle Annotations | Show/hide annotation markers (visible when annotations exist) |
| Export Archive | Export the current scene as an .a3d or .a3z archive |
| Download Viewer | Generate a self-contained offline kiosk HTML file |

## URL Parameters

### File Loading

| Parameter | Description |
|-----------|-------------|
| `archive` | URL to archive container (.a3d, .a3z). **Takes priority over individual file params.** |
| `splat` | URL to Gaussian splat file |
| `model` | URL to 3D model file |
| `pointcloud` | URL to E57 point cloud file |
| `alignment` | URL to alignment JSON file |

### UI Configuration

| Parameter | Values | Description |
|-----------|--------|-------------|
| `controls` | `full`, `minimal`, `none` | Control panel mode |
| `mode` | `splat`, `model`, `both`, `split` | Initial display mode |
| `toolbar` | `show`, `hide` | Toolbar visibility |
| `sidebar` | `closed`, `view`, `edit` | Metadata sidebar state |

### Inline Alignment

Embed transform data directly in the URL instead of using an alignment file:

| Splat | Model | Point Cloud | Description |
|-------|-------|-------------|-------------|
| `sp=x,y,z` | `mp=x,y,z` | `pp=x,y,z` | Position |
| `sr=x,y,z` | `mr=x,y,z` | `pr=x,y,z` | Rotation (radians) |
| `ss=scale` | `ms=scale` | `ps=scale` | Uniform scale |

### Example URLs

```
# Load an archive container
https://viewer.example.com?archive=/assets/scene.a3d

# Archive with minimal controls in split view
https://viewer.example.com?archive=/assets/scene.a3d&controls=minimal&mode=split

# Pre-loaded files with inline alignment
https://viewer.example.com?splat=/scene.ply&model=/model.glb&sp=0,1,0&sr=0,3.14,0&ss=1.5

# Kiosk mode: no controls, no toolbar, metadata view-only
https://viewer.example.com?archive=/scene.a3d&controls=none&toolbar=hide&sidebar=view

# Point cloud with model comparison
https://viewer.example.com?model=/model.glb&pointcloud=/scan.e57&mode=both
```

## Share & Embed

### Share Dialog

Click **Copy Share Link** to generate a URL encoding the current display mode, alignment transforms, and UI configuration. The share dialog includes presets:

- **Full Editor** — All controls and editing enabled
- **Viewer Mode** — Toolbar hidden, metadata sidebar in view-only mode
- **Kiosk Mode** — All controls hidden

### Embedding

```html
<iframe
  src="https://viewer.example.com?archive=/scene.a3d&controls=minimal&toolbar=hide"
  width="100%" height="600" frameborder="0" allow="fullscreen">
</iframe>
```

### CORS

If the viewer and files are on different origins, configure your file server with:

```
Access-Control-Allow-Origin: https://viewer.example.com
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Origin, Content-Type, Accept, Range
```

## Offline Kiosk Viewer

The **Download Viewer** button generates a self-contained HTML file (~1 MB before archive data) that works entirely offline with zero network access. This is designed for delivering 3D scan data to clients who may not have internet access or technical expertise.

### How It Works

1. The generator fetches all CDN dependencies (Three.js, Spark.js, fflate) and application modules at export time
2. Everything is base64-encoded and embedded inside a single HTML file
3. Import specifiers are rewritten to blob URLs at runtime so ES modules work without a server
4. The user opens the HTML file in any modern browser and loads an `.a3d`/`.a3z` archive via file picker or drag-and-drop

### Kiosk Viewer Capabilities

- Full 3D rendering (splats, meshes, point clouds) with display mode switching
- Orbit and fly camera controls
- Annotation viewing with depth-aware markers, popups, and connecting lines
- Metadata sidebar (view-only)
- Scene settings (background color, lighting, grid)
- Asset-specific controls (opacity, wireframe, point size)
- Lazy asset loading — the manifest loads first, then individual assets load on demand with inline progress indicators

### Limitations

- The kiosk viewer is read-only — no archive creation, metadata editing, or alignment tools
- The embedded JavaScript stack (Three.js 0.170.0, Spark.js 0.1.10) is frozen at export time and may eventually become incompatible with future browsers
- The archive's raw data files (GLB, PLY, E57) remain the authoritative preservation copies; the kiosk viewer is a convenience access layer

## Archive Container Format

The archive container format (`.a3d` / `.a3z`) bundles 3D assets, metadata, alignment data, annotations, and preservation information into a single distributable file. It is designed for long-term archival and interoperability, integrating with the [archive-3d](https://github.com/idio-sync/archive-3d) specification.

### Structure

Archives are ZIP files containing:

```
scene.a3d/
  manifest.json          # Metadata, file listings, transforms, annotations
  scene.ply              # Gaussian splat data
  model.glb              # 3D mesh
  scan.e57               # Point cloud (optional)
  preview.jpg            # Thumbnail preview (optional)
  images/                # Image attachments referenced by annotations/descriptions
    photo1.jpg
    detail2.png
```

### Manifest Schema

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
    "tier": "Tier 2 - Reference",
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
      "spatial": { "location_name": "Oxford, UK", "coordinates": "51.752,-1.258" },
      "temporal": { "subject_period": "1860-1875", "circa": true }
    }
  },

  "material_standard": {
    "workflow": "metal_roughness",
    "color_space": "srgb",
    "normal_space": "opengl"
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
      "description": "Structural crack running NE-SW, approx 2.3m\n\n![Detail](asset:images/crack_detail.jpg)",
      "position": { "x": 1.2, "y": 3.4, "z": -0.1 },
      "cameraPosition": { "x": 2.0, "y": 4.0, "z": 3.0 },
      "cameraTarget": { "x": 1.2, "y": 3.4, "z": -0.1 }
    }
  ],

  "_meta": {
    "custom_fields": {},
    "_manifest_hash": "sha256:..."
  }
}
```

### Loading Archives

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

### Exporting Archives

Click the **Export Archive** toolbar button to save the current scene:

1. Choose format: `.a3d` (standard) or `.a3z` (compressed)
2. The export bundles all loaded assets, current transforms, annotations, metadata, and image attachments
3. SHA-256 integrity hashes are computed for each asset file (requires HTTPS; a warning is shown on HTTP)
4. A preview thumbnail is captured from the current viewport
5. Version history entries and data entry roles are preserved in the manifest

## Metadata Editor

The metadata sidebar (press `M` or click the toolbar button) provides structured editing across 8 tabs:

| Tab | Contents |
|-----|----------|
| **Project** | Title, ID, description (with markdown and image support), license, relationships, version history |
| **Provenance** | Capture date/device/serial, operator/ORCID, location, processing software list, processing notes, convention hints |
| **Archival Record** | Dublin Core / Smithsonian EDAN fields: title, identifiers (accession, SIRIS, URI), creation details, physical description, provenance, rights, geographic and temporal coverage |
| **Quality** | Quality tier (Metrology/Reference/Visualization), accuracy grade, capture resolution, alignment error, scale verification, data quality notes, read-only asset statistics |
| **Material** | PBR workflow (metal/roughness or specular/glossiness), color space, normal map space, occlusion packing |
| **Preservation** | PRONOM format registry IDs, significant properties checklist, rendering requirements and notes |
| **Assets** | Per-asset metadata: created by, tool version, source notes, and archival role (primary/derived) for splat, mesh, and point cloud |
| **Integrity** | SHA-256 hash algorithm, manifest hash, per-asset hashes, toggle for including integrity data in exports. Displays a warning when HTTPS is unavailable. |

### Field Validation

Structured metadata fields are validated on blur with inline error indicators:
- **ORCID**: format `0000-0000-0000-000X`
- **Coordinates**: numeric latitude/longitude within valid ranges
- **Dates**: ISO 8601 format
- **PRONOM IDs**: format `fmt/000` or `x-fmt/000`

Validation is advisory — it highlights problems but does not block export.

All metadata is saved into the archive's `manifest.json` on export.

## Archive Format for Long-Term Preservation

The `.a3d` / `.a3z` archive container is designed with digital preservation as a first-class concern. For institutions capturing real-world objects — buildings, artifacts, archaeological sites, heritage assets — the format addresses key challenges in long-term 3D data archival:

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

## Docker Deployment

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_ARCHIVE_URL` | `""` | Archive container (.a3d, .a3z) to load on startup. Takes priority over individual file URLs. |
| `DEFAULT_SPLAT_URL` | `""` | Gaussian splat file to load on startup |
| `DEFAULT_MODEL_URL` | `""` | 3D model file to load on startup |
| `DEFAULT_POINTCLOUD_URL` | `""` | E57 point cloud file to load on startup |
| `DEFAULT_ALIGNMENT_URL` | `""` | Alignment JSON file to load on startup |
| `SHOW_CONTROLS` | `"true"` | Show (`true`) or hide (`false`) the controls panel |

### Docker Compose Example

```yaml
version: '3.8'
services:
  viewer:
    build:
      context: .
      dockerfile: docker/Dockerfile
    ports:
      - "8080:80"
    environment:
      - DEFAULT_ARCHIVE_URL=https://example.com/scene.a3d
      - SHOW_CONTROLS=true
    volumes:
      # Optional: mount local files to serve
      - ./archives:/usr/share/nginx/html/archives
```

### Nginx Configuration

The Docker image includes nginx configured with:
- GZIP compression for text-based assets
- 1-day cache headers for static files
- CORS headers for cross-origin file loading
- Proper MIME types for `.a3d`, `.a3z` (application/zip) and `.e57` (application/octet-stream) files
- Content Security Policy and security headers

## URL Security

By default, only same-origin URLs are permitted for file loading. To allow external domains, add them to the `ALLOWED_EXTERNAL_DOMAINS` array in `config.js` (or `config.js.template` for Docker):

```javascript
const ALLOWED_EXTERNAL_DOMAINS = [
    'trusted-cdn.example.com',
    '*.mycompany.com',  // wildcard subdomain support
];
```

External URLs are validated against:
- Protocol whitelist (http/https only)
- Domain allowlist
- HTTPS enforcement when the viewer itself is served over HTTPS

## Project Structure

```
simple-splat-mesh-viewer/
├── src/
│   ├── index.html                  # Main HTML file with UI structure
│   ├── main.js                     # Core application logic and event handling
│   ├── config.js                   # Runtime configuration (URL params, kiosk detection)
│   ├── pre-module.js               # Pre-module initialization
│   ├── styles.css                  # UI styles (dark theme + kiosk-mode overrides)
│   └── modules/
│       ├── constants.js            # Application constants and defaults
│       ├── utilities.js            # Logging, hashing, markdown, image asset resolution
│       ├── scene-manager.js        # Three.js scene, camera, renderer setup
│       ├── file-handlers.js        # File loading with lazy archive extraction
│       ├── archive-loader.js       # Archive ZIP parsing, lazy on-demand extraction
│       ├── archive-creator.js      # Archive creation, manifest, image bundling
│       ├── alignment.js            # Auto-align, ICP, fit-to-view
│       ├── annotation-system.js    # 3D annotation placement with depth awareness
│       ├── metadata-manager.js     # Metadata editing, validation, and display
│       ├── share-dialog.js         # Share URL generation
│       ├── fly-controls.js         # First-person fly camera
│       ├── ui-controller.js        # UI state management
│       ├── kiosk-viewer.js         # Offline viewer HTML generator
│       └── kiosk-main.js           # Kiosk viewer entry point (viewer-only mode)
├── docker/
│   ├── Dockerfile                  # nginx:alpine-based container
│   ├── nginx.conf                  # Nginx configuration
│   ├── config.js.template          # Docker config with env var substitution
│   └── docker-entrypoint.sh        # Startup script
├── docs/
│   ├── ARCHITECTURE.md             # Plain-English architecture overview
│   ├── CODE_REVIEW.md              # Code review findings and remediation status
│   ├── SHORTCOMINGS_AND_SOLUTIONS.md # Known gaps and proposed solutions
│   ├── SPECIFICATION.md            # Archive format specification
│   └── ROADMAP.md                  # Prioritized future work
└── README.MD
```

## Technologies

- [Spark](https://sparkjs.dev/) — 3D Gaussian Splatting renderer for Three.js
- [Three.js](https://threejs.org/) — 3D rendering, model loading, and scene management
- [three-e57-loader](https://www.npmjs.com/package/three-e57-loader) — E57 point cloud loading (WASM-based via web-e57)
- [fflate](https://github.com/101arrowz/fflate) — Fast ZIP compression/decompression
- [nginx](https://nginx.org/) — Web server for Docker deployment
- Vanilla JavaScript (ES Modules, no build step)

Runtime dependencies are loaded via browser [import maps](https://developer.mozilla.org/en-US/docs/Web/HTML/Element/script/type/importmap) from [esm.sh](https://esm.sh/) and [jsDelivr](https://www.jsdelivr.com/) CDNs. The kiosk viewer generator fetches Three.js core from jsDelivr and Three.js addons from esm.sh for reliable offline bundling. No bundler or build toolchain is required.

## Browser Compatibility

Requires a modern browser with WebGL 2.0 support:
- Chrome 79+
- Firefox 72+
- Safari 15+
- Edge 79+

E57 loading additionally requires WebAssembly support (available in all the above browsers).

## Related Projects

- [archive-3d](https://github.com/idio-sync/archive-3d) — Archive container format specification and tools
