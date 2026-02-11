# Proof of Concept 3D viewer

A web-based viewer for viewing Gaussian splats, 3D models, and E57 point clouds, powered by [Three.js](https://github.com/mrdoob/three.js/) and [Spark](https://sparkjs.dev/). Designed for cultural heritage, surveying, and digital preservation workflows, with a standards-based archive container format for long-term archival of real-world 3D captures.

## Features

- Load and display **3D models** (.glb, .gltf, .obj)
- Load and display **E57 point clouds** (.e57) via [three-e57-loader](https://www.npmjs.com/package/three-e57-loader)
- Load and display **Gaussian splat** files (.ply, .splat, .ksplat, .spz, .sog)
- **Archive container support** (.a3d, .a3z) — bundle all assets, metadata, and multi-data alignment into a single file
- **Four display modes**: Model only, Splat only, Both overlaid, or Split side-by-side, and Point Cloud
- **Scene settings** — tone mapping (6 modes + exposure), HDR environment maps (3 presets + file/URL loading), environment-as-background skybox, shadow casting with shadow catcher ground plane, background image loading
- **Auto-rotate** — turntable toggle in toolbar for both main app and kiosk viewer
- **Screenshot capture** — capture viewport screenshots with a viewfinder-based archive preview override, thumbnail gallery with delete, and automatic export to `/screenshots/` in archives
- **Transform controls** for positioning, rotating, and scaling each object independently
- **Alignment Tools** for registering splats and models in overlapping space
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

## Documentation

| Guide | Description |
|-------|-------------|
| [Usage Guide](docs/USAGE.md) | Controls, camera, alignment, annotations, scene settings, keyboard shortcuts |
| [Configuration](docs/CONFIGURATION.md) | URL parameters, share/embed, URL security |
| [Archive Format](docs/ARCHIVE-GUIDE.md) | Container structure, manifest schema, loading/exporting, preservation |
| [Metadata Editor](docs/METADATA.md) | 8-tab editor, field validation, Dublin Core alignment |
| [Kiosk Viewer](docs/KIOSK-VIEWER.md) | Offline self-contained HTML viewer generation |
| [Deployment](docs/DEPLOYMENT.md) | Docker env vars, compose, nginx, production setup |
| [Architecture](docs/ARCHITECTURE.md) | Codebase structure and module relationships |
| [Specification](docs/SPECIFICATION.md) | Formal archive-3d container format spec |
| [Roadmap](docs/ROADMAP.md) | Planned features and priorities |

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
│   ├── ARCHIVE-GUIDE.md            # Archive format user guide
│   ├── CODE_REVIEW.md              # Code review findings and remediation status
│   ├── CONFIGURATION.md            # URL parameters, share/embed, security
│   ├── DEPLOYMENT.md               # Docker and production deployment
│   ├── KIOSK-VIEWER.md             # Offline kiosk viewer documentation
│   ├── METADATA.md                 # Metadata editor documentation
│   ├── ROADMAP.md                  # Prioritized future work
│   ├── SHORTCOMINGS_AND_SOLUTIONS.md # Known gaps and proposed solutions
│   └── SPECIFICATION.md            # Archive format specification
└── README.md
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
