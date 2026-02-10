# CLAUDE.md — Simple Splat Mesh Viewer

## What This Project Is

A browser-based 3D viewer for assembling and delivering scan data — Gaussian splats, meshes (GLB/OBJ), and E57 point clouds — together or individually, without losing real-world spatial context. Built as an alternative to Sketchfab for a 3D scanning company's deliverables pipeline.

Two modes of use:
- **Main app** (`src/index.html`): Internal tool for composing scenes — load assets, align them spatially, add annotations, fill in metadata, and export as a `.a3d`/`.a3z` archive.
- **Kiosk viewer** (generated via "Download Viewer" button): A self-contained ~1 MB offline HTML file sent to clients. Must work entirely locally with zero network access — all dependencies are inlined at generation time.

## Tech Stack & Constraints

- **No build step.** `src/` is served directly. No bundler, no transpiler, no node_modules at runtime.
- **ES modules only.** All imports resolve through the import map in `index.html`.
- **All dependencies are from CDN** (esm.sh / sparkjs.dev). Pinned versions:
  - Three.js 0.170.0
  - Spark.js 0.1.10 (Gaussian splat renderer)
  - fflate 0.8.2 (ZIP compression)
  - three-e57-loader 1.2.0 / web-e57 1.2.0 (E57 point clouds, WASM)
- **`package.json` only has `serve` as a devDependency** — used for `npm start`.
- **Docker deployment** via nginx:alpine. `docker/docker-entrypoint.sh` substitutes env vars into `config.js` at container start.

## Project Structure

```
src/
  index.html              Entry point. CSP, import map, all HTML structure (~1100 lines)
  config.js               IIFE (non-module). Parses URL params, sets window.APP_CONFIG
  pre-module.js           Error watchdog. Loaded before ES modules
  main.js                 App controller / glue layer (~3,900 lines)
  styles.css              All CSS (~2,600 lines)
  modules/
    constants.js          Shared config values (camera, lighting, timing, extensions)
    utilities.js          Logger, notify(), mesh helpers, disposeObject(), fetchWithProgress()
    scene-manager.js      Three.js scene/camera/renderer/controls/lighting setup
    ui-controller.js      Loading overlay, display-mode helpers, addListener()
    file-handlers.js      Asset loading: splat, mesh, point cloud, archive
    archive-loader.js     ZIP extraction, manifest parsing, filename sanitization
    archive-creator.js    Archive creation, SHA-256 hashing, screenshot capture
    alignment.js          KD-tree, ICP algorithm, auto-align, fit-to-view
    annotation-system.js  3D annotation placement via raycasting
    metadata-manager.js   Metadata sidebar (view/edit/annotations), Dublin Core schema
    fly-controls.js       WASD + mouse-look first-person camera
    share-dialog.js       Share link builder with URL parameters
    kiosk-viewer.js       Offline viewer generator — fetches CDN deps, base64-inlines them
docker/
  Dockerfile              nginx:alpine, copies src/ files individually
  nginx.conf              Gzip, CORS, caching, CSP headers
  config.js.template      Template for env var substitution
  docker-entrypoint.sh    Runs envsubst at container start
```

## How to Run

```bash
npm start                  # serves src/ on http://localhost:8080
npm run docker:build       # builds Docker image
npm run docker:run         # runs on http://localhost:8080 (port 80 inside container)
```

There are no tests. There is no linter configured. There is no type checking.

## Boot Sequence

1. `index.html` loads `config.js` (regular script) → parses URL params, validates URLs, writes `window.APP_CONFIG`
2. `pre-module.js` (regular script) → installs error handlers, starts 5s watchdog
3. `main.js` (ES module) → imports all modules, reads `APP_CONFIG`, calls `init()`
4. `init()` creates `SceneManager`, extracts its internals to module-scope variables, wires up all UI events, calls `loadDefaultFiles()`, starts `animate()` loop

## Key Patterns to Understand

### The "deps pattern"
Modules don't store references to shared objects. Instead, `main.js` builds a fresh dependency object on each call:
```js
function createAlignmentDeps() {
    return { splatMesh, modelGroup, camera, controls, state, ... };
}
icpAlignObjectsHandler(createAlignmentDeps());
```
This means module functions receive current state but there's no type checking or validation on the shape of these objects.

### SceneManager extraction
After creating `SceneManager`, `init()` copies all its properties into loose `let` variables (`scene`, `camera`, `renderer`, etc.) at module scope in `main.js`. These loose variables are what the rest of `main.js` actually uses. Two sources of truth — be aware.

### State management
A single mutable `const state = { ... }` object in `main.js`. No setters, no events, no validation. Any function can mutate it directly.

### URL validation
Implemented **three separate times** with **three separate domain allowlists**:
- `config.js` line 58 — validates URL params at boot
- `main.js` line 109 — validates URLs from prompt dialogs
- `file-handlers.js` line 35 — validates programmatic URL loads

When adding allowed domains, all three must be updated or loads will be silently blocked.

### Timing-based sequencing
Several post-load operations use `setTimeout` with delays from `constants.js` TIMING (e.g., `AUTO_ALIGN_DELAY: 500`). These are not promise-based — they assume assets finish loading within the delay window.

## Rules for Making Changes

### Do not introduce a build step
This project serves `src/` directly. Do not add webpack, vite, rollup, esbuild, or any other bundler. Do not add TypeScript compilation. All code must be valid browser ES modules.

### Do not add npm runtime dependencies
All runtime dependencies come from CDN via the import map in `index.html`. The only npm dependency is `serve` for local dev. If a new library is needed, add it to the import map.

### Keep CDN versions in sync
The import map in `index.html` and the `CDN_DEPS` object in `kiosk-viewer.js` both reference Three.js, Spark.js, etc. by version. If you update a version in one, update the other. Mismatched versions have caused real bugs.

### Kiosk mode must work fully offline
The generated kiosk HTML must contain all dependencies inlined (base64-encoded). It must never make network requests at runtime. Test by opening the generated file with network disabled.

### Dockerfile needs manual updates for new files
The Dockerfile copies each source file by name. If you add a new module to `src/modules/`, add a corresponding `COPY` line to `docker/Dockerfile` or it will be missing from Docker builds.

### CSP requires `unsafe-eval`
Spark.js WASM needs `'unsafe-eval'` in the CSP `script-src`. Do not remove it or splat rendering will break. If the CSP in `index.html` is changed, also check `docker/nginx.conf` which adds its own `frame-ancestors` header.

### Module conventions
- Each module creates a logger: `const log = Logger.getLogger('module-name');`
- Export functions/classes that `main.js` imports and orchestrates
- Modules receive dependencies via the deps pattern — don't import main.js
- Use `notify()` from utilities.js for user-facing messages
- Use `showLoading()` / `hideLoading()` from ui-controller.js for progress

### HTML is in index.html, not generated by JS
All DOM structure lives in `index.html`. Modules query elements by ID. If you need new UI elements, add them to `index.html` and reference by ID in JS. The exception is dynamically-created elements like annotation markers and metadata form fields.

## Known Fragile Areas

- **`main.js` is ~3,900 lines** and handles too many concerns. Tread carefully when modifying — changes can have non-obvious side effects.
- **No tests.** Manual testing is the only verification. Security-critical code (archive filename sanitization, URL validation) has no automated coverage.
- **Point cloud memory.** No size limits on E57 loading. Large files can OOM the browser.
- **`annotation-system.js`** is the only module that doesn't use Logger — it has no structured logging.

## When changes are made
- Update ROADMAP.MD if changed item is present