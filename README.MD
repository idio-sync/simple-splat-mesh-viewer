# Vitrine3D

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
- **Kiosk themes** — customizable color palettes and layouts via self-contained theme packages (`?theme=editorial`, `?theme=minimal`, or create your own)
- **Lazy archive loading** — only the manifest is decompressed on open; individual assets load on demand
- **Image support** in annotations and project descriptions via an `asset:` protocol, stored as separate entries in the archive
- **Version history** tracking within archives for recording changes across exports
- **Data entry roles** — classify assets as primary records or derived products for preservation clarity
- **Shareable URLs** with embedded alignment, display settings, and UI presets
- **Docker deployment** with environment-variable configuration and kiosk mode support
- **Digital preservation metadata** aligned with Dublin Core, PRONOM, and Smithsonian EDAN standards

## Kiosk Themes

The kiosk viewer supports themes — self-contained packages that control colors, typography, and layout. Built-in themes include `editorial` (gold/navy with full-bleed layout) and `minimal` (neutral white sidebar). Create your own by copying `src/themes/_template/` and customizing the CSS variables. See the [Kiosk Viewer docs](docs/KIOSK-VIEWER.md#themes) for full details.

```
?theme=editorial    → Gold/navy editorial inspired layout
?theme=minimal      → Neutral white sidebar, template theme
?theme=your-theme   → Any custom theme folder
```

## Quick Start

### Development
```bash
npm install
npm run dev
```
Then open http://localhost:8080 in your browser.

### Production Build
```bash
npm run build       # Vite production build to dist/
npm run preview     # Preview production build locally
```

### Using Docker
```bash
npm run docker:build    # Vite build + Docker image
npm run docker:run      # http://localhost:8080

# Or with pre-loaded archive
docker run -p 8080:80 \
  -e DEFAULT_ARCHIVE_URL="https://example.com/scene.a3d" \
  vitrine3d

# Or with pre-loaded files
docker run -p 8080:80 \
  -e DEFAULT_SPLAT_URL="https://example.com/model.ply" \
  -e DEFAULT_MODEL_URL="https://example.com/model.glb" \
  -e DEFAULT_POINTCLOUD_URL="https://example.com/scan.e57" \
  vitrine3d
```

## Supported Formats

### Archive Containers
- `.a3d` — Archive 3D container with metadata (ZIP-based, uncompressed)
- `.a3z` — Archive 3D container with metadata (ZIP-based, compressed) - experimental

### 3D Models (via Three.js)
- `.glb` — Binary glTF
- `.gltf` — glTF with external resources
- `.obj` — Wavefront OBJ

### Gaussian Splats (via Spark)
- `.ply` — Standard PLY format with Gaussian splat data
- `.splat` — Compressed splat format
- `.ksplat` — Compressed splat format
- `.spz` — Spark compressed format
- `.sog` — SOG format

### Point Clouds
- `.e57` — ASTM E57 format (via [three-e57-loader](https://www.npmjs.com/package/three-e57-loader), which uses the [web-e57](https://www.npmjs.com/package/web-e57) WASM parser)

## Documentation

| Guide | Description |
|-------|-------------|
| [Usage Guide](docs/USAGE.md) | Controls, camera, alignment, annotations, scene settings, keyboard shortcuts |
| [Configuration](docs/CONFIGURATION.md) | URL parameters, share/embed, URL security |
| [Archive Format](docs/archive/ARCHIVE-GUIDE.md) | Container structure, manifest schema, loading/exporting, preservation |
| [Metadata Editor](docs/archive/METADATA.md) | 8-tab editor, field validation, Dublin Core alignment |
| [Kiosk Viewer](docs/KIOSK-VIEWER.md) | Offline self-contained HTML viewer generation |
| [Deployment](docs/DEPLOYMENT.md) | Docker env vars, compose, nginx, production setup |
| [Architecture](docs/reference/ARCHITECTURE.md) | Codebase structure and module relationships |
| [Specification](docs/archive/SPECIFICATION.md) | Formal archive-3d container format spec |
| [Roadmap](docs/ROADMAP.md) | Planned features and priorities |

## Technologies

- [Spark](https://sparkjs.dev/) — 3D Gaussian Splatting renderer for Three.js
- [Three.js](https://threejs.org/) — 3D rendering, model loading, and scene management
- [three-e57-loader](https://www.npmjs.com/package/three-e57-loader) — E57 point cloud loading (WASM-based via web-e57)
- [fflate](https://github.com/101arrowz/fflate) — Fast ZIP compression/decompression
- [nginx](https://nginx.org/) — Web server for Docker deployment
- [Vite](https://vitejs.dev/) — Dev server, bundler, and build toolchain
- [Vitest](https://vitest.dev/) — Test runner
- TypeScript with ESLint and Prettier

Runtime dependencies are installed via npm and resolved by Vite from `node_modules/`. The kiosk viewer generator fetches Three.js core from jsDelivr and Three.js addons from esm.sh at generation time for reliable offline bundling.

## Browser Compatibility

Requires a modern browser with WebGL 2.0 support:
- Chrome 79+
- Firefox 72+
- Safari 15+
- Edge 79+

E57 loading additionally requires WebAssembly support (available in all the above browsers).

## Related Projects

- [archive-3d](https://github.com/idio-sync/archive-3d) — Archive container format specification and tools
