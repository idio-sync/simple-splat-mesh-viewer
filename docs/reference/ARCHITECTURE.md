# Architecture Overview

## What This Project Is

Simple Splat Mesh Viewer is a browser-based tool for viewing and comparing three kinds of 3D data side-by-side: Gaussian splats (a photogrammetry format), traditional 3D meshes (GLB/OBJ), and E57 point clouds. It targets cultural-heritage, surveying, and digital-preservation workflows. The app also defines a custom ZIP-based archive format (.a3d/.a3z) for bundling assets with metadata, and can generate a fully offline self-contained HTML viewer.

There is **no build step**. The `src/` directory is served directly by nginx (Docker) or `npx serve` (development). All JavaScript uses native ES modules loaded by the browser via import maps defined in `index.html`.

---

## Project Layout

```
src/
  index.html           - Single-page app shell (HTML + import map)
  config.js             - URL-parameter parsing, security validation
  pre-module.js         - Non-module error catcher loaded before ES modules
  main.js               - Application controller (~3,900 lines)
  styles.css            - All styling (~2,600 lines)
  modules/
    constants.js        - Shared numeric/string constants
    utilities.js        - Logger, notifications, mesh helpers
    scene-manager.js    - Three.js scene, camera, renderers, animation
    ui-controller.js    - Display-mode switching, progress overlay, keyboard shortcuts
    file-handlers.js    - Asset loading (splat, mesh, point cloud, archive)
    archive-loader.js   - ZIP extraction and manifest parsing
    archive-creator.js  - Archive creation with SHA-256 hashing
    alignment.js        - KD-tree, ICP algorithm, auto-align, fit-to-view
    annotation-system.js- 3D annotation markers and raycasting
    metadata-manager.js - Metadata sidebar (view/edit), Dublin Core schema
    fly-controls.js     - WASD + mouse-look first-person camera
    share-dialog.js     - Share-link builder with URL parameters
    kiosk-viewer.js     - Offline viewer generator (fetches deps from CDN)

docker/                 - Dockerfile (nginx:alpine), nginx.conf, entrypoint
docs/                   - Specifications, code review, known issues
samples/                - Example archive manifest
```

---

## How the Pieces Connect

### Boot sequence

1. **`index.html`** loads three scripts in order:
   - `pre-module.js` (regular script) — installs global `error` and `unhandledrejection` handlers and starts a 5-second watchdog timer (`window.moduleLoaded`).
   - `config.js` (regular script, IIFE) — reads every `?param=` from the URL, validates URLs against an allowlist, and writes a `window.APP_CONFIG` object.
   - `main.js` (ES module via `<script type="module">`) — the real application entry point.

2. **`main.js`** imports every module, reads `window.APP_CONFIG`, builds a global `state` object, calls `init()`, and enters the `animate()` render loop.

3. **`init()`** creates a `SceneManager`, extracts its Three.js objects into module-scope variables (scene, camera, renderer, controls, etc.), wires up all DOM event listeners via `setupUIEvents()`, and calls `loadDefaultFiles()` if any URLs were provided via config.

### Module dependency graph

```
constants.js  (no imports — pure config values)
     |
utilities.js  (imports constants, THREE)
     |
     +---> scene-manager.js   (THREE, OrbitControls, TransformControls, constants, utilities)
     +---> file-handlers.js   (THREE, GLTFLoader, OBJLoader, MTLLoader, SplatMesh, E57Loader,
     |                         fflate via archive-loader, constants, utilities)
     +---> archive-loader.js  (fflate, utilities)
     +---> archive-creator.js (fflate, utilities)
     +---> alignment.js       (THREE, utilities)
     +---> annotation-system.js (THREE — no utility imports)
     +---> metadata-manager.js  (utilities)
     +---> fly-controls.js    (THREE, utilities)
     +---> share-dialog.js    (utilities)
     +---> kiosk-viewer.js    (utilities)
     +---> ui-controller.js   (utilities)

main.js  (imports everything above and orchestrates it all)
```

All third-party libraries (Three.js, Spark.js, fflate, three-e57-loader) are resolved at runtime through the import map in `index.html`, pointing to jsDelivr/sparkjs.dev CDN URLs. There are no `node_modules` used at runtime — `package.json` only has `serve` as a dev dependency.

### Data flow: loading an asset

```
User picks file / provides URL
  → file-handlers.js validates URL, reads bytes
  → If archive (.a3d/.a3z): archive-loader.js unzips, parses manifest.json,
    sanitizes filenames, returns individual asset blobs
  → Splat bytes → Spark.js SplatMesh.load() → added to scene
  → Mesh bytes  → GLTFLoader / OBJLoader → wrapped in modelGroup → added to scene
  → E57 bytes   → E57Loader (WASM) → THREE.Points → added to pointcloudGroup
  → main.js callbacks update UI state, trigger auto-alignment if needed
```

### Data flow: the render loop (`animate()`)

```
requestAnimationFrame → animate()
  1. Update active controls (fly or orbit)
  2. Sync right-side orbit controls target to left (split view)
  3. sceneManager.render() — decides single-canvas or split-canvas rendering,
     toggles visibility of splat/model/cloud based on state.displayMode
  4. annotationSystem.updateMarkerPositions() — projects 3D markers to 2D
  5. sceneManager.updateFPS()
```

### Data flow: creating/exporting an archive

```
User clicks "Save Archive"
  → archive-creator.js gathers current splat blob, mesh blob, cloud blob
  → Computes SHA-256 hashes (Web Crypto API, streaming for >10 MB)
  → Serializes transforms, metadata, annotations into manifest.json
  → fflate.zip() bundles everything → browser download
```

### Data flow: share links

```
User opens share dialog
  → share-dialog.js reads current state (transforms, display mode, controls mode)
  → Builds URL query string (?mode=both&controls=minimal&sp=1,2,3&...)
  → User copies link; on load, config.js parses it back into APP_CONFIG
```

---

## What Each Major File Does

### `src/config.js`
IIFE that runs before any ES module. Parses every supported URL parameter (`?archive=`, `?splat=`, `?mode=`, `?sp=`, etc.), validates external URLs against a domain allowlist, and writes the result to `window.APP_CONFIG`. This is the security boundary for URL-based asset loading at startup.

### `src/pre-module.js`
Tiny non-module script. Installs global error handlers and a 5-second timeout that logs a warning if `main.js` never sets `window.moduleLoaded = true`. Purely diagnostic.

### `src/main.js`
The application controller. At ~3,900 lines this is the largest file and acts as the glue layer. It:
- Holds all global state in a single `state` object (display mode, loaded flags, opacity settings, etc.)
- Creates `SceneManager`, `AnnotationSystem`, `ArchiveCreator`, `FlyControls`
- Wires every DOM button/input to the appropriate handler function
- Defines wrapper functions that build dependency objects and pass them to module functions (the "deps pattern" — see Fragility section below)
- Contains the `animate()` render loop
- Contains a second copy of `validateUserUrl()` for URLs entered via prompt dialogs (as opposed to config.js which handles URL-parameter URLs)

### `src/modules/constants.js`
Pure data — exported objects for camera FOV, orbit control limits, lighting colors/intensities, grid settings, timing delays, material defaults, and supported file extensions. No logic.

### `src/modules/utilities.js`
Shared infrastructure:
- **`Logger`** class — configurable log levels (DEBUG/INFO/WARN/ERROR/NONE), set via `?log=` URL param, with per-module prefixes.
- **`notify()`** — shows toast notifications at the bottom of the screen.
- **`processMeshMaterials()`** — walks a loaded mesh and ensures every material has sensible defaults (metalness, roughness, double-sided).
- **`computeMeshFaceCount()` / `computeMeshVertexCount()`** — traverse a mesh hierarchy and sum geometry stats.
- **`disposeObject()`** — recursively disposes Three.js objects to free GPU memory.
- **`parseMarkdown()`** — minimal Markdown-to-HTML converter for metadata display.
- **`fetchWithProgress()`** — wraps `fetch()` with a progress callback using `ReadableStream`.

### `src/modules/scene-manager.js`
Encapsulates Three.js setup in a `SceneManager` class:
- Creates scene, perspective camera, two WebGL renderers (left and right canvases for split view), orbit controls for each, transform controls (gizmo), and a standard 4-light rig.
- `render()` method handles visibility toggling per display mode and renders to one or two canvases.
- `onWindowResize()` recalculates aspect ratios for single or split layout.
- FPS counter logic (frame counting + periodic update).

### `src/modules/file-handlers.js`
All asset-loading logic:
- `loadSplatFromFile()` / `loadSplatFromUrl()` — uses Spark.js `SplatMesh` to load PLY/SPZ/SPLAT Gaussian splat data.
- `loadModelFromFile()` / `loadModelFromUrl()` — uses `GLTFLoader` or `OBJLoader` depending on extension. Handles blob URL creation for archives.
- `loadPointcloudFromFile()` / `loadPointcloudFromUrl()` / `loadPointcloudFromBlobUrl()` — uses `E57Loader` (WASM-based) for .e57 files. Creates `THREE.Points` with custom point size/opacity.
- `updatePointcloudPointSize()` / `updatePointcloudOpacity()` — mutate point cloud material properties.
- Has its own copy of `validateUserUrl()` (the third such implementation — see Inconsistencies below).

### `src/modules/archive-loader.js`
`ArchiveLoader` class:
- `load(source)` accepts a File, Blob, or URL.
- Uses fflate's `unzip()` to decompress ZIP contents.
- Parses `manifest.json` from the archive root.
- **`sanitizeArchiveFilename()`** — security-critical function that blocks path traversal (`../`), null bytes, double-encoded dots, hidden files, and characters outside `[a-zA-Z0-9_\-\.\/]`.
- Returns an object with asset blobs, manifest data, and any errors.

### `src/modules/archive-creator.js`
`ArchiveCreator` class:
- `createArchive()` bundles splat, mesh, and point cloud blobs with a manifest.
- SHA-256 hashing via Web Crypto API. For blobs >10 MB, uses a streaming approach to reduce peak memory.
- `captureScreenshot()` (exported standalone) renders the current scene to a PNG data URL for use as an archive thumbnail.
- Generates manifest.json following the Archive-3D v1.0 spec.

### `src/modules/alignment.js`
Spatial alignment tools:
- **`KDTree`** — classic KD-tree for 3D nearest-neighbor lookup. Used by ICP.
- **`icpAlignObjects()`** — Iterative Closest Point algorithm. Samples points from the source mesh, finds nearest neighbors in the target via KD-tree, computes optimal rotation+translation, and iterates.
- **`autoAlignObjects()`** — simpler bounding-box-based alignment. Centers both objects, matches scales, used as default when assets are first loaded.
- **`fitToView()`** — positions camera to frame all loaded objects.
- **`resetAlignment()`** / **`resetCamera()`** — restore transforms and camera to defaults.
- **`centerModelOnGrid()`** — centers a standalone model at the grid origin.

### `src/modules/annotation-system.js`
`AnnotationSystem` class:
- Lets users click on 3D surfaces to place annotation markers (small spheres in a `markerGroup`).
- Uses `THREE.Raycaster` against loaded meshes to find click positions.
- Each annotation stores a position, camera preset (position + target), title, and body text.
- Manages corresponding DOM elements (2D marker labels projected from 3D positions each frame).
- Supports placement mode toggle, annotation selection, and camera-preset navigation.

### `src/modules/metadata-manager.js`
The largest module (~1,450 lines). Manages the metadata sidebar:
- Three modes: **view** (museum-style read-only display), **edit** (8-tab form), **annotations** (list of placed annotations).
- Edit tabs cover: Basic info, Origin/Provenance, Dates, Technical, Legal, Relationships, Custom Fields, Processing Notes.
- Schema aligns with Dublin Core, PRONOM format registry, and Smithsonian EDAN standards.
- `collectMetadata()` scrapes form inputs into a structured object for archive export.
- `prefillFromManifest()` populates the form when loading an archive.

### `src/modules/fly-controls.js`
`FlyControls` class — WASD + mouse-look first-person camera:
- Uses `pointerlockchange` events for mouse capture.
- Right-click activates mouse look; WASD/QE for movement.
- Scroll wheel adjusts movement speed.
- `update()` called each frame to apply velocity.

### `src/modules/share-dialog.js`
Builds a modal dialog where users configure share-link options (display mode, controls visibility, toolbar, sidebar state, UI presets). Generates a URL with all current transforms serialized as query parameters. Supports three presets: `full`, `viewer`, `kiosk`.

### `src/modules/kiosk-viewer.js`
Generates a self-contained ~1 MB HTML file that can view any .a3d/.a3z archive offline:
- `fetchDependencies()` downloads Three.js, Spark.js, fflate, and Three.js addons from CDN.
- Base64-encodes each dependency and embeds them in an HTML template.
- At runtime, the generated HTML decodes the base64, creates blob URLs, rewrites `from "three"` bare imports to point at the Three.js blob URL, and dynamically imports everything.
- The kiosk module itself is loaded lazily in `main.js` to avoid blocking startup.

### `src/modules/ui-controller.js`
Utility functions for UI state:
- `showLoading()` / `hideLoading()` / `updateProgress()` — loading overlay management.
- `addListener()` — safe DOM event binding with null checks.
- Display-mode helpers.

---

## Inconsistencies and Fragile Spots

### 1. URL validation is copy-pasted three times
The same `validateUserUrl()` logic exists in:
- `src/config.js:58` (IIFE, handles URL params at boot)
- `src/main.js:109` (handles URLs entered via prompt dialogs)
- `src/modules/file-handlers.js:35` (exported, handles programmatic URL loading)

Each copy has its own `ALLOWED_EXTERNAL_DOMAINS` array. If an admin adds a domain to one, the other two silently ignore it. This is a maintenance trap. All three should share a single implementation and a single domain list.

### 2. The "deps pattern" creates tight implicit coupling
Modules like `alignment.js` and `file-handlers.js` don't hold references to the objects they operate on. Instead, `main.js` builds a fresh dependency object (`createAlignmentDeps()`, `createFileHandlerDeps()`) on every call, passing the current values of module-scope variables. This means:
- If a variable is renamed or removed in `main.js`, it fails silently (the dep object just gets `undefined`).
- The shape of the deps object is never validated — no TypeScript, no runtime checks.
- It's unclear from reading `alignment.js` alone what properties it expects; you have to cross-reference with `main.js`.

### 3. `main.js` extracts SceneManager internals into loose variables
After `sceneManager = new SceneManager()`, `init()` immediately copies `sceneManager.scene`, `.camera`, `.renderer`, etc. into module-scope `let` variables (`scene`, `camera`, `renderer`, etc.) "for backward compatibility." This creates two sources of truth — if anything ever re-initializes the SceneManager, the loose variables go stale.

### 4. `main.js` is oversized and acts as a God Module
At ~3,900 lines, `main.js` handles event wiring, state management, file loading callbacks, alignment wrappers, annotation callbacks, archive loading/saving orchestration, display mode switching, transform input syncing, and the render loop. A significant portion is DOM event listener setup (`setupUIEvents()` alone is hundreds of lines). This makes it hard to understand the overall flow.

### 5. State is a plain mutable object with no change tracking
`const state = { ... }` is mutated freely from dozens of functions. There's no setter, no event emission on change, and no validation. Any function can set `state.displayMode` to an invalid string and nothing will catch it until rendering breaks.

### 6. Hardcoded timing delays are load-bearing
Several operations rely on `setTimeout` with constants from `TIMING` (e.g., `AUTO_ALIGN_DELAY: 500`, `BLOB_REVOKE_DELAY: 5000`). Auto-alignment after archive load waits 500 ms for assets to finish initializing. On slow connections or large files, this can fire before the asset is ready. A callback/promise-based approach would be more reliable.

### 7. Dockerfile uses individual COPY lines instead of a glob
The Dockerfile lists every `.js` module file individually (13 COPY lines). If a new module is added to `src/modules/` and the Dockerfile isn't updated, the Docker image silently misses it. A `COPY src/ /usr/share/nginx/html/` would be simpler and less error-prone.

### 8. No tests of any kind
There are no unit tests, integration tests, or end-to-end tests. The KD-tree, ICP algorithm, archive sanitization, URL validation, and metadata collection are all non-trivial logic with no automated verification. The archive filename sanitizer in particular is security-critical and deserves thorough test coverage.

### 9. `'unsafe-eval'` in the Content Security Policy
The CSP in `index.html` includes `'unsafe-eval'` because Spark.js uses WASM that requires it. This weakens XSS protections for the entire page. If Spark.js ever supports `'wasm-unsafe-eval'` (a narrower permission), it should be switched.

### 10. Point cloud memory management
`E57Loader` uses a WASM-based parser. There are no explicit limits on point count, so loading a very large E57 file can exhaust browser memory with no graceful degradation. The `disposeObject()` utility handles cleanup, but there's a known shortcoming (documented in `SHORTCOMINGS_AND_SOLUTIONS.md`) around memory leaks during point cloud disposal.

### 11. Import map pinned to exact CDN versions with no lockfile
The import map in `index.html` pins Three.js 0.170.0, Spark 0.1.10, fflate 0.8.2, etc. via CDN URLs. The kiosk-viewer.js has its own matching list of CDN URLs. If one is updated but not the other, the kiosk viewer will bundle a different Three.js version than the main app uses, which can cause subtle breakage (this has already caused bugs per the git history).

### 12. Annotation system doesn't import Logger
`annotation-system.js` imports only `THREE` and uses no logging. Every other module uses `Logger.getLogger()`. Annotation debugging currently produces no structured log output, unlike the rest of the app.
