# Architecture Overview

## What This Project Is

Vitrine3D is a browser-based tool for viewing and comparing three kinds of 3D data side-by-side: Gaussian splats (a photogrammetry format), traditional 3D meshes (GLB/OBJ), and E57 point clouds. It targets cultural-heritage, surveying, and digital-preservation workflows. The app also defines a custom ZIP-based archive format (.a3d/.a3z) for bundling assets with metadata, and can generate a fully offline self-contained HTML viewer.

The project uses **Vite + TypeScript** with `allowJs: true` for hybrid .js/.ts support. All modules are now TypeScript (`.ts`). Run `npm run dev` for development (Vite dev server on port 8080), `npm run build` for production build to `dist/`. Dependencies installed via npm, resolved by Vite from `node_modules/`.

---

## Project Layout

```
src/
  index.html              - Single-page app shell (~1,100 lines)
  config.js               - URL-parameter parsing, security validation (IIFE, non-module)
  pre-module.js           - Non-module error catcher loaded before ES modules
  main.ts                 - Application glue layer (~1,445 lines)
  types.ts                - Shared TypeScript interfaces (AppState, SceneRefs, deps interfaces)
  styles.css              - All styling (~4,390 lines)
  modules/
    alignment.ts          - KD-tree, ICP algorithm, auto-align, fit-to-view
    annotation-system.ts  - 3D annotation markers and raycasting
    archive-creator.ts    - Archive creation with SHA-256 hashing
    archive-loader.ts     - ZIP extraction and manifest parsing
    archive-pipeline.ts   - Archive loading/processing pipeline (extracted from main.ts)
    asset-store.ts        - ES module singleton for blob references
    constants.ts          - Shared numeric/string constants
    event-wiring.ts       - Central UI event binding — setupUIEvents()
    export-controller.ts  - Archive export, kiosk viewer download, metadata manifests
    file-handlers.ts      - Asset loading (splat, mesh, point cloud, archive)
    file-input-handlers.ts- File input events, URL prompts, URL loaders, Tauri dialogs
    fly-controls.ts       - WASD + mouse-look first-person camera
    kiosk-main.ts         - Kiosk viewer entry point (viewer-only mode)
    kiosk-viewer.ts       - Offline viewer generator (fetches CDN deps)
    logger.ts             - Standalone Logger class (extracted from utilities)
    metadata-manager.ts   - Metadata sidebar (view/edit), Dublin Core schema
    quality-tier.ts       - Device capability detection for SD/HD asset selection
    scene-manager.ts      - Three.js scene, camera, renderers, animation
    screenshot-manager.ts - Screenshot capture, viewfinder, screenshot list management
    share-dialog.ts       - Share-link builder with URL parameters
    source-files-manager.ts- Source file list UI management for archive exports
    tauri-bridge.ts       - Tauri v2 native OS integration with browser fallback
    theme-loader.ts       - Kiosk theme CSS/layout loading and metadata parsing
    transform-controller.ts- Transform gizmo orchestration, object sync, delta tracking
    ui-controller.ts      - Display-mode switching, progress overlay, keyboard shortcuts
    url-validation.ts     - URL validation for user-entered URLs (extracted, testable)
    utilities.ts          - Logger, notifications, mesh helpers
    __tests__/            - Vitest test suites (206 tests across 8 suites)
  themes/
    _template/            - Copy to create a new theme
    editorial/            - Gold/navy editorial layout theme
    minimal/              - Neutral white sidebar theme
    lincoln-memorial/     - Lincoln Memorial showcase theme

docker/                   - Dockerfile (nginx:alpine), nginx.conf, entrypoint
docs/
  archive/                - Archive format spec, guide, and metadata editor docs
  reference/              - Architecture, code review, shortcomings, feasibility analyses
```

---

## How the Pieces Connect

### Boot sequence

1. **`index.html`** loads three scripts in order:
   - `pre-module.js` (regular script) — installs global `error` and `unhandledrejection` handlers and starts a 5-second watchdog timer (`window.moduleLoaded`).
   - `config.js` (regular script, IIFE) — reads every `?param=` from the URL, validates URLs against an allowlist, and writes a `window.APP_CONFIG` object.
   - `main.ts` (ES module via `<script type="module">`) — the real application entry point.

2. **`main.ts`** imports every module, reads `window.APP_CONFIG`, builds a global `state` object, calls `init()`, and enters the `animate()` render loop.

3. **`init()`** creates a `SceneManager`, extracts its Three.js objects into module-scope variables (scene, camera, renderer, controls, etc.), wires up all DOM event listeners via `setupUIEvents()`, and calls `loadDefaultFiles()` if any URLs were provided via config.

### Module dependency graph

```
constants.ts  (no imports — pure config values)
     |
logger.ts     (standalone Logger class)
     |
utilities.ts  (imports constants, logger, THREE)
     |
     +---> scene-manager.ts       (THREE, OrbitControls, TransformControls, constants, utilities)
     +---> file-handlers.ts       (THREE, GLTFLoader, OBJLoader, MTLLoader, SplatMesh, E57Loader,
     |                             fflate via archive-loader, constants, utilities)
     +---> archive-loader.ts      (fflate, utilities)
     +---> archive-creator.ts     (fflate, utilities)
     +---> archive-pipeline.ts    (file-handlers, archive-loader, quality-tier, utilities)
     +---> alignment.ts           (THREE, utilities)
     +---> annotation-system.ts   (THREE — no utility imports)
     +---> metadata-manager.ts    (utilities)
     +---> fly-controls.ts        (THREE, utilities)
     +---> share-dialog.ts        (utilities)
     +---> kiosk-viewer.ts        (utilities)
     +---> ui-controller.ts       (utilities)
     +---> quality-tier.ts        (constants, utilities)
     +---> theme-loader.ts        (utilities)
     +---> tauri-bridge.ts        (utilities)
     +---> url-validation.ts      (utilities)
     +---> asset-store.ts         (ES module singleton)
     +---> event-wiring.ts        (ui-controller, utilities)
     +---> export-controller.ts   (archive-creator, kiosk-viewer, utilities)
     +---> file-input-handlers.ts (file-handlers, tauri-bridge, utilities)
     +---> screenshot-manager.ts  (utilities)
     +---> source-files-manager.ts(utilities)
     +---> transform-controller.ts(THREE, utilities)

main.ts  (imports everything above and orchestrates it all)

kiosk-main.ts  (slim viewer entry point — imports scene-manager, file-handlers,
                annotation-system, metadata-manager, fly-controls, quality-tier,
                theme-loader, ui-controller, utilities)
```

Dependencies installed via npm (pinned versions in `package.json`):
- Three.js 0.170.0
- Spark.js 0.1.10
- fflate 0.8.2
- three-e57-loader 1.2.0 / web-e57 1.2.0

Vite resolves bare specifiers (`'three'`, `'fflate'`, etc.) from `node_modules/` at build time.

### Data flow: loading an asset

```
User picks file / provides URL
  → file-handlers.ts validates URL, reads bytes
  → If archive (.a3d/.a3z): archive-loader.ts unzips, parses manifest.json,
    sanitizes filenames, returns individual asset blobs
  → Splat bytes → Spark.js SplatMesh.load() → added to scene
  → Mesh bytes  → GLTFLoader / OBJLoader → wrapped in modelGroup → added to scene
  → E57 bytes   → E57Loader (WASM) → THREE.Points → added to pointcloudGroup
  → main.ts callbacks update UI state, trigger auto-alignment if needed
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
  → archive-creator.ts gathers current splat blob, mesh blob, cloud blob
  → Computes SHA-256 hashes (Web Crypto API, streaming for >10 MB)
  → Serializes transforms, metadata, annotations into manifest.json
  → fflate streaming Zip class bundles everything with per-file progress → browser download
```

### Data flow: share links

```
User opens share dialog
  → share-dialog.ts reads current state (transforms, display mode, controls mode)
  → Builds URL query string (?mode=both&controls=minimal&sp=1,2,3&...)
  → User copies link; on load, config.js parses it back into APP_CONFIG
```

---

## What Each Major File Does

### `src/config.js`
IIFE that runs before any ES module. Parses every supported URL parameter (`?archive=`, `?splat=`, `?mode=`, `?sp=`, etc.), validates external URLs against a domain allowlist, and writes the result to `window.APP_CONFIG`. This is the security boundary for URL-based asset loading at startup.

### `src/pre-module.js`
Tiny non-module script. Installs global error handlers and a 5-second timeout that logs a warning if `main.ts` never sets `window.moduleLoaded = true`. Purely diagnostic.

### `src/main.ts`
The application glue layer. At ~1,445 lines (down from ~3,900 via Phase 1-4 refactoring), this is now a typed orchestration layer. It:
- Holds all global state in a single `state: AppState` object (display mode, loaded flags, opacity settings, etc.)
- Creates `SceneManager`, `AnnotationSystem`, `ArchiveCreator`, `FlyControls`
- Defines typed factory functions that build dependency objects (`createExportDeps()`, `createArchivePipelineDeps()`, etc.) for module calls — the "deps pattern" (see Fragility section below)
- Contains the `animate()` render loop
- Delegates event wiring to `event-wiring.ts`, file inputs to `file-input-handlers.ts`, archive pipeline to `archive-pipeline.ts`, exports to `export-controller.ts`

### `src/types.ts`
Shared TypeScript interfaces:
- `AppState` — global mutable state shape
- `SceneRefs` — Three.js scene/camera/renderer/controls references
- `ExportDeps`, `ArchivePipelineDeps`, `EventWiringDeps`, `FileInputDeps` — deps pattern interfaces

### `src/modules/constants.ts`
Pure data — exported objects for camera FOV, orbit control limits, lighting colors/intensities, grid settings, timing delays, material defaults, and supported file extensions. No logic.

### `src/modules/logger.ts`
Standalone `Logger` class — configurable log levels (DEBUG/INFO/WARN/ERROR/NONE), set via `?log=` URL param, with per-module prefixes. Extracted from utilities.ts for cleaner separation.

### `src/modules/utilities.ts`
Shared infrastructure:
- **`notify()`** — shows toast notifications at the bottom of the screen.
- **`processMeshMaterials()`** — walks a loaded mesh and ensures every material has sensible defaults (metalness, roughness, double-sided).
- **`computeMeshFaceCount()` / `computeMeshVertexCount()`** — traverse a mesh hierarchy and sum geometry stats.
- **`disposeObject()`** — recursively disposes Three.js objects to free GPU memory.
- **`parseMarkdown()`** — minimal Markdown-to-HTML converter for metadata display.
- **`fetchWithProgress()`** — wraps `fetch()` with a progress callback using `ReadableStream`.

### `src/modules/scene-manager.ts`
Encapsulates Three.js setup in a `SceneManager` class:
- Creates scene, perspective camera, two WebGL renderers (left and right canvases for split view), orbit controls for each, transform controls (gizmo), and a standard 4-light rig.
- `render()` method handles visibility toggling per display mode and renders to one or two canvases.
- `onWindowResize()` recalculates aspect ratios for single or split layout.
- FPS counter logic (frame counting + periodic update).

### `src/modules/file-handlers.ts`
All asset-loading logic:
- `loadSplatFromFile()` / `loadSplatFromUrl()` — uses Spark.js `SplatMesh` to load PLY/SPZ/SPLAT Gaussian splat data.
- `loadModelFromFile()` / `loadModelFromUrl()` — uses `GLTFLoader` or `OBJLoader` depending on extension. Handles blob URL creation for archives.
- `loadPointcloudFromFile()` / `loadPointcloudFromUrl()` / `loadPointcloudFromBlobUrl()` — uses `E57Loader` (WASM-based) for .e57 files. Creates `THREE.Points` with custom point size/opacity.
- `updatePointcloudPointSize()` / `updatePointcloudOpacity()` — mutate point cloud material properties.

### `src/modules/archive-loader.ts`
`ArchiveLoader` class:
- `load(source)` accepts a File, Blob, or URL.
- Uses fflate's `unzip()` to decompress ZIP contents.
- Parses `manifest.json` from the archive root.
- **`sanitizeArchiveFilename()`** — security-critical function that blocks path traversal (`../`), null bytes, double-encoded dots, hidden files, and characters outside `[a-zA-Z0-9_\-\.\/]`. Covered by 41 Vitest tests.
- Returns an object with asset blobs, manifest data, and any errors.

### `src/modules/archive-pipeline.ts`
Archive loading/processing pipeline extracted from main.ts. Coordinates `archive-loader.ts`, `file-handlers.ts`, and `quality-tier.ts` to load archives with quality tier detection and asset resolution.

### `src/modules/archive-creator.ts`
`ArchiveCreator` class:
- `createArchive()` bundles splat, mesh, and point cloud blobs with a manifest.
- SHA-256 hashing via Web Crypto API. For blobs >10 MB, uses a streaming approach to reduce peak memory.
- `captureScreenshot()` (exported standalone) renders the current scene to a PNG data URL for use as an archive thumbnail.
- Generates manifest.json following the Archive-3D v1.0 spec.
- Uses fflate streaming `Zip` class with per-file progress callbacks.

### `src/modules/alignment.ts`
Spatial alignment tools:
- **`KDTree`** — classic KD-tree for 3D nearest-neighbor lookup. Used by ICP.
- **`icpAlignObjects()`** — Iterative Closest Point algorithm. Samples points from the source mesh, finds nearest neighbors in the target via KD-tree, computes optimal rotation+translation, and iterates.
- **`autoAlignObjects()`** — simpler bounding-box-based alignment. Centers both objects, matches scales, used as default when assets are first loaded.
- **`fitToView()`** — positions camera to frame all loaded objects.
- **`resetAlignment()`** / **`resetCamera()`** — restore transforms and camera to defaults.
- **`centerModelOnGrid()`** — centers a standalone model at the grid origin.

### `src/modules/annotation-system.ts`
`AnnotationSystem` class:
- Lets users click on 3D surfaces to place annotation markers (small spheres in a `markerGroup`).
- Uses `THREE.Raycaster` against loaded meshes to find click positions.
- Each annotation stores a position, camera preset (position + target), title, and body text.
- Manages corresponding DOM elements (2D marker labels projected from 3D positions each frame).
- Supports placement mode toggle, annotation selection, and camera-preset navigation.

### `src/modules/metadata-manager.ts`
Manages the metadata sidebar:
- Three modes: **view** (museum-style read-only display), **edit** (8-tab form), **annotations** (list of placed annotations).
- Edit tabs: Project, Provenance, Archival, Quality, Material, Preservation, Assets, Integrity.
- Schema aligns with Dublin Core, PRONOM format registry, and Smithsonian EDAN standards.
- Inline field validation for ORCID, coordinates, dates, and PRONOM IDs.
- `collectMetadata()` scrapes form inputs into a structured object for archive export.
- `prefillFromManifest()` populates the form when loading an archive.

### `src/modules/fly-controls.ts`
`FlyControls` class — WASD + mouse-look first-person camera:
- Uses `pointerlockchange` events for mouse capture.
- Right-click activates mouse look; WASD/QE for movement.
- Scroll wheel adjusts movement speed.
- `update()` called each frame to apply velocity.

### `src/modules/share-dialog.ts`
Builds a modal dialog where users configure share-link options (display mode, controls visibility, toolbar, sidebar state, UI presets). Generates a URL with all current transforms serialized as query parameters. Supports three presets: `full`, `viewer`, `kiosk`.

### `src/modules/kiosk-viewer.ts`
Generates a self-contained ~1 MB HTML file that can view any .a3d/.a3z archive offline:
- `fetchDependencies()` downloads Three.js, Spark.js, fflate, and Three.js addons from CDN.
- Base64-encodes each dependency and embeds them in an HTML template.
- At runtime, the generated HTML decodes the base64, creates blob URLs, rewrites `from "three"` bare imports to point at the Three.js blob URL, and dynamically imports everything.
- The kiosk module itself is loaded lazily in `main.ts` to avoid blocking startup.

### `src/modules/ui-controller.ts`
Utility functions for UI state:
- `showLoading()` / `hideLoading()` / `updateProgress()` — loading overlay management.
- `addListener()` — safe DOM event binding with null checks.
- Display-mode helpers.

### `src/modules/event-wiring.ts`
Central UI event binding extracted from main.ts. `setupUIEvents()` wires all DOM button/input events to handler functions. Receives dependencies via `EventWiringDeps` interface.

### `src/modules/export-controller.ts`
Archive export and kiosk viewer download orchestration extracted from main.ts. Receives dependencies via `ExportDeps` interface.

### `src/modules/file-input-handlers.ts`
File input events, URL prompts, URL loaders, and Tauri native dialogs extracted from main.ts. 16 functions total. Receives dependencies via `FileInputDeps` interface.

### `src/modules/url-validation.ts`
URL validation for user-entered URLs. Extracted from main.ts to make it testable and shareable. Used by main.ts (thin wrapper with `window.location` context) and file-handlers.ts. Note: config.js still has its own copy for boot-time validation — see Inconsistencies below.

### `src/modules/asset-store.ts`
ES module singleton for blob references (splat, mesh, pointcloud). Centralized blob management.

### `src/modules/screenshot-manager.ts`
Screenshot capture, viewfinder, screenshot list management extracted from main.ts.

### `src/modules/source-files-manager.ts`
Source file list UI management for archive exports. `handleSourceFilesInput()`, `updateSourceFilesUI()`. Self-contained, no deps factory needed.

### `src/modules/transform-controller.ts`
Transform gizmo orchestration, object sync, delta tracking extracted from main.ts.

### `src/modules/kiosk-main.ts`
Slim viewer entry point for kiosk/offline mode. Imports from real application modules so that visual and functional changes propagate automatically. Viewer-only — no archive creation, metadata editing, or alignment tools. Handles archive loading, display mode switching, annotations, and theme application in the generated offline HTML.

### `src/modules/quality-tier.ts`
Device capability detection for SD/HD asset selection:
- `detectDeviceTier()` scores 5 hardware heuristics (device memory, CPU cores, screen width, GPU info via WebGL) to classify as SD or HD.
- `resolveQualityTier()` / `hasAnyProxy()` — helpers for choosing between full-resolution and proxy assets.
- Used by both `main.ts` and `kiosk-main.ts`.

### `src/modules/theme-loader.ts`
Runtime theme loading for kiosk viewer:
- Fetches `theme.css` (required), `layout.css` (optional), and `layout.js` (optional) from `themes/{name}/`.
- `parseThemeMeta()` extracts `@theme`, `@layout`, and `@scene-bg` directives from CSS comment blocks.
- Supports sidebar and editorial layout modes.

### `src/modules/tauri-bridge.ts`
Native OS integration when running inside Tauri v2, with browser fallback:
- `isTauri()` — detects `window.__TAURI__` for feature gating.
- Native file dialogs with format-specific filters (splats, meshes, point clouds, archives, images).
- Native save dialogs for archive export and kiosk viewer download.
- Falls back to standard browser file input / download when not in Tauri.

---

## Inconsistencies and Fragile Spots

### 1. URL validation still has two implementations
Core validation logic extracted to **`url-validation.ts`** (testable, shared). Used by:
- `main.ts` — thin wrapper that passes `window.location` context and `ALLOWED_EXTERNAL_DOMAINS`
- `file-handlers.ts` — validates programmatic URL loads

However, **`config.js:58`** still has its own copy for boot-time validation. When adding allowed domains, both `config.js` and the `ALLOWED_EXTERNAL_DOMAINS` constant in main.ts must be updated or loads will be silently blocked.

### 2. The "deps pattern" creates tight implicit coupling (now typed)
Modules like `alignment.ts` and `file-handlers.ts` don't hold references to the objects they operate on. Instead, `main.ts` builds a fresh dependency object (`createAlignmentDeps()`, `createFileHandlerDeps()`) on every call, passing the current values of module-scope variables.

**Improvement**: Now typed via TypeScript interfaces in `types.ts` (`ExportDeps`, `ArchivePipelineDeps`, `EventWiringDeps`, `FileInputDeps`). This provides compile-time checks for missing properties.

**Remaining issue**: Still implicit coupling — if a variable is renamed or removed in `main.ts`, TypeScript will catch it, but it's unclear from reading a module alone what properties it expects without checking the deps interface.

### 3. `main.ts` extracts SceneManager internals into loose variables
After `sceneManager = new SceneManager()`, `init()` immediately copies `sceneManager.scene`, `.camera`, `.renderer`, etc. into module-scope `let` variables (`scene`, `camera`, `renderer`, etc.) "for backward compatibility." This creates two sources of truth — if anything ever re-initializes the SceneManager, the loose variables go stale.

### 4. `main.ts` size — improved but still largest file
**Before**: ~3,900 lines, God Module anti-pattern.
**After**: ~1,445 lines via Phase 1-4 refactoring. Now a typed glue layer: `init()`, state declarations, deps factories, animation loop, and thin delegation wrappers.

Still the largest single file, but manageable and focused on orchestration rather than implementation.

### 5. State is a plain mutable object with no change tracking
`const state: AppState = { ... }` is mutated freely from dozens of functions. There's no setter, no event emission on change, and no validation. TypeScript provides compile-time shape checking via the `AppState` interface, but any function can set `state.displayMode` to an invalid string and nothing will catch it at runtime until rendering breaks.

### 6. Hardcoded timing delays are load-bearing
Several operations rely on `setTimeout` with constants from `TIMING` (e.g., `AUTO_ALIGN_DELAY: 500`, `BLOB_REVOKE_DELAY: 5000`). Auto-alignment after archive load waits 500 ms for assets to finish initializing. On slow connections or large files, this can fire before the asset is ready. A callback/promise-based approach would be more reliable.

### 7. Docker uses `COPY dist/` — no longer an issue
**Before**: Dockerfile listed every `.js` module file individually (13 COPY lines).
**Fixed**: Docker now uses `COPY dist/` — copies entire Vite build output. New modules are automatically included as long as they're imported (bundled by Vite) or listed in `KIOSK_MODULES` in `vite.config.ts`.

### 8. Test coverage improved but not comprehensive
**Before**: No tests of any kind.
**After**: 206 tests across 8 Vitest suites covering security-critical code:
- `url-validation.test.ts` (62 tests)
- `theme-loader.test.ts` (26 tests)
- `archive-loader.test.ts` (41 tests)
- `utilities.test.ts` (30 tests)
- `quality-tier.test.ts` (21 tests)
- `archive-creator.test.ts` (15 tests)
- `share-dialog.test.ts` (11 tests)

**Remaining gaps**: No E2E tests, no integration tests. Complex logic like KD-tree, ICP algorithm, metadata collection, and transform controller still have no automated verification.

### 9. `'unsafe-eval'` in the Content Security Policy
The CSP in `index.html` includes `'unsafe-eval'` because Spark.js uses WASM that requires it. This weakens XSS protections for the entire page. If Spark.js ever supports `'wasm-unsafe-eval'` (a narrower permission), it should be switched.

### 10. Point cloud memory management
`E57Loader` uses a WASM-based parser. There are no explicit limits on point count, so loading a very large E57 file can exhaust browser memory with no graceful degradation. The `disposeObject()` utility handles cleanup, but there's a known shortcoming (documented in [SHORTCOMINGS_AND_SOLUTIONS.md](SHORTCOMINGS_AND_SOLUTIONS.md)) around memory leaks during point cloud disposal.

### 11. Kiosk CDN versions must be kept in sync
The kiosk-viewer.ts `CDN_DEPS` object fetches dependencies from CDN at kiosk generation time (not from `node_modules/`). Versions must match `package.json`:
- Three.js 0.170.0
- Spark.js 0.1.10
- fflate 0.8.2
- three-e57-loader 1.2.0

If `package.json` is updated but kiosk-viewer.ts is not, the kiosk viewer will bundle different versions than the main app uses, causing subtle breakage (this has already caused bugs per the git history).

### 12. Annotation system doesn't import Logger
`annotation-system.ts` imports only `THREE` and uses no logging. Every other module uses `Logger.getLogger()`. Annotation debugging currently produces no structured log output, unlike the rest of the app.
