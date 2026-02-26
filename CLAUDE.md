# CLAUDE.md — Vitrine3D

## What This Project Is

A browser-based 3D viewer for assembling and delivering scan data — Gaussian splats, meshes (GLB/OBJ), and E57 point clouds — together or individually, without losing real-world spatial context. Built as an alternative to Sketchfab for a 3D scanning company's deliverables pipeline.

Two modes of use:
- **Main app** (`src/index.html`): Internal tool for composing scenes — load assets, align them spatially, add annotations, fill in metadata, and export as a `.a3d`/`.a3z` archive.
- **Kiosk viewer** (generated via "Download Viewer" button): A self-contained ~1 MB offline HTML file sent to clients. Must work entirely locally with zero network access — all dependencies are inlined at generation time.

## Tech Stack & Constraints

- **Vite + TypeScript (hybrid).** Vite serves `src/` in dev and bundles to `dist/` for production. TypeScript configured with `allowJs: true` — existing `.js` files work unchanged, new modules written as `.ts`.
- **ES modules only.** Bare specifiers (`'three'`, `'fflate'`, etc.) resolved by Vite from `node_modules/`.
- **Runtime dependencies** installed via npm. Pinned versions:
  - Three.js 0.182.0
  - Spark.js 2.0.0-preview (Gaussian splat renderer, vendored in `src/vendor/`)
  - fflate 0.8.2 (ZIP compression)
  - three-e57-loader 1.2.0 / web-e57 1.2.0 (E57 point clouds, WASM)
- **Docker deployment** via nginx:alpine. `docker/docker-entrypoint.sh` substitutes env vars into `config.js` at container start.
- **Tauri v2** for desktop builds. `src-tauri/` scaffold with Cargo.toml, capabilities, etc.

## Project Structure

```
src/
  index.html              Entry point. CSP, all HTML structure (~1100 lines)
  config.js               IIFE (non-module). Parses URL params, sets window.APP_CONFIG
  pre-module.js           Error watchdog. Loaded before ES modules
  main.ts                 App controller / glue layer (~1,450 lines, refactored from ~3,900)
  types.ts                Shared TypeScript types (AppState, SceneRefs, deps interfaces)
  styles.css              All CSS (~2,600 lines)
  modules/
    constants.js          Shared config values (camera, lighting, timing, extensions)
    utilities.js          Logger, notify(), mesh helpers, disposeObject(), fetchWithProgress()
    logger.ts             Standalone Logger class (extracted from utilities)
    scene-manager.ts      Three.js scene/camera/renderer/controls/lighting setup
    ui-controller.ts      Loading overlay, display-mode helpers, addListener()
    file-handlers.ts      Asset loading: splat, mesh, point cloud, archive
    file-input-handlers.ts File input events, URL prompts, URL loaders, Tauri dialogs
    archive-loader.ts     ZIP extraction, manifest parsing, filename sanitization
    archive-creator.ts    Archive creation, SHA-256 hashing, screenshot capture
    archive-pipeline.ts   Archive loading/processing pipeline (extracted from main.ts)
    export-controller.ts  Archive export, generic viewer download, metadata manifests
    event-wiring.ts       Central UI event binding — setupUIEvents()
    asset-store.ts        ES module singleton for blob references (splat, mesh, pointcloud)
    screenshot-manager.ts Screenshot capture, viewfinder, screenshot list management
    transform-controller.ts Transform gizmo orchestration, object sync, delta tracking
    url-validation.ts     URL validation for user-entered URLs (extracted, testable)
    source-files-manager.ts Source file list UI management for archive exports
    alignment.ts          KD-tree, ICP algorithm, auto-align, fit-to-view, alignment I/O
    annotation-system.ts  3D annotation placement via raycasting
    metadata-manager.ts   Metadata sidebar (view/edit/annotations), Dublin Core schema
    fly-controls.ts       WASD + mouse-look first-person camera
    share-dialog.ts       Share link builder with URL parameters
    quality-tier.ts       SD/HD quality detection and switching
    theme-loader.ts       Theme CSS/layout loading for kiosk mode
    kiosk-viewer.ts       Offline viewer generator — fetches CDN deps, base64-inlines them
    kiosk-main.ts         Kiosk mode entry point (embedded into offline HTML)
    __tests__/            Vitest test suites (url-validation, theme-loader, archive-loader, utilities, quality-tier)
docker/
  Dockerfile              nginx:alpine, serves Vite build output from dist/
  nginx.conf              Gzip, CORS, caching, CSP headers
  config.js.template      Template for env var substitution
  docker-entrypoint.sh    Runs envsubst at container start
```

## How to Run

```bash
npm run dev                # Vite dev server on http://localhost:8080
npm run build              # Vite production build to dist/
npm run preview            # Preview production build locally
npm run docker:build       # Vite build + Docker image
npm run docker:run         # runs on http://localhost:8080 (port 80 inside container)
npx tauri dev              # Desktop app (Tauri, requires Rust)
npm run lint               # ESLint check (0 errors expected, warnings OK)
npm run lint:fix           # ESLint auto-fix
npm run format:check       # Prettier formatting check
npm run format             # Prettier auto-format
npm test                   # Vitest — run all test suites
npm run test:watch         # Vitest in watch mode
```

## Boot Sequence

1. `index.html` loads `config.js` (regular script) → parses URL params, validates URLs, writes `window.APP_CONFIG`
2. `pre-module.js` (regular script) → installs error handlers, starts 5s watchdog
3. `main.ts` (ES module) → imports all modules, reads `APP_CONFIG`, calls `init()`
4. `init()` creates `SceneManager`, extracts its internals to module-scope variables, wires up all UI events, calls `loadDefaultFiles()`, starts `animate()` loop

## Key Patterns to Understand

### The "deps pattern"
Modules don't store references to shared objects. Instead, `main.ts` builds a fresh dependency object on each call:
```js
/** @returns {import('./types.js').ExportDeps} */
function createExportDeps() {
    return { sceneRefs, state, tauriBridge, ui: { ... }, metadata: { ... } };
}
downloadArchive(createExportDeps());
```
Deps interfaces for the largest extracted modules (`ExportDeps`, `ArchivePipelineDeps`, `EventWiringDeps`, `FileInputDeps`) are defined in `src/types.ts` and `src/modules/file-input-handlers.ts`. The main.ts factory functions have typed return annotations.

### SceneManager extraction
After creating `SceneManager`, `init()` copies all its properties into loose `let` variables (`scene`, `camera`, `renderer`, etc.) at module scope in `main.ts`. These loose variables are what the rest of `main.ts` actually uses. Two sources of truth — be aware.

### State management
A single mutable `const state: AppState = { ... }` object in `main.ts`. No setters, no events, no validation. Any function can mutate it directly.

### URL validation
The core validation logic is in `url-validation.ts` (extracted, testable). It is used by:
- `main.ts` — thin wrapper that passes `window.location` context and `ALLOWED_EXTERNAL_DOMAINS`
- `config.js` line 58 — validates URL params at boot (separate implementation)
- `file-handlers.js` line 35 — validates programmatic URL loads (separate implementation)

When adding allowed domains, all three locations must be updated or loads will be silently blocked.

### Timing-based sequencing
Several post-load operations use `setTimeout` with delays from `constants.js` TIMING (e.g., `AUTO_ALIGN_DELAY: 500`). These are not promise-based — they assume assets finish loading within the delay window.

## Rules for Making Changes

### Keep modular
If adding functionality, investigate if it makes sense to create a module instead of locating new code in main.ts before writing code. All modules are now TypeScript (`.ts`).

### npm dependencies
Runtime deps are in `package.json` and resolved by Vite. If adding a new dependency, install via `npm install` and import normally. Vite resolves bare specifiers from `node_modules/`.

### Keep kiosk CDN deps in sync
The `CDN_DEPS` object in `kiosk-viewer.js` fetches dependencies from CDN at kiosk generation time (not from `node_modules/`). If you update a dependency version in `package.json`, also update the corresponding URL in `kiosk-viewer.js`.

### Kiosk mode must work fully offline
The generated kiosk HTML must contain all dependencies inlined (base64-encoded). It must never make network requests at runtime. Test by opening the generated file with network disabled.

### Docker uses Vite build output
The Dockerfile copies `dist/` (Vite build output). Run `npm run build` before `docker build`. No need to add per-file COPY lines — just ensure new modules are imported so Vite bundles them, or add them to the `KIOSK_MODULES` list in `vite.config.ts` if they need to be copied as raw files for the kiosk viewer.

### CSP requires `unsafe-eval`
Spark.js WASM needs `'unsafe-eval'` in the CSP `script-src`. Do not remove it or splat rendering will break. If the CSP in `index.html` is changed, also check `docker/nginx.conf` which adds its own `frame-ancestors` header.

### Module conventions
- Each module creates a logger: `const log = Logger.getLogger('module-name');`
- Export functions/classes that `main.ts` imports and orchestrates
- Modules receive dependencies via the deps pattern — don't import main.ts
- Use `notify()` from utilities.js for user-facing messages
- Use `showLoading()` / `hideLoading()` from ui-controller.js for progress

### HTML is in index.html, not generated by JS
All DOM structure lives in `index.html`. Modules query elements by ID. If you need new UI elements, add them to `index.html` and reference by ID in JS. The exception is dynamically-created elements like annotation markers and metadata form fields.

## Known Fragile Areas

- **`main.ts` is ~1,450 lines** — reduced from ~3,900 via Phase 1-4 refactoring (see `docs/reference/REFACTOR_MAIN.md`). It's now a fully typed glue layer: `init()`, state declarations, deps factories, animation loop, and thin delegation wrappers.
- **Tests cover security-critical code only.** 90 tests across 5 suites: URL validation, theme metadata parsing, archive filename sanitization. No E2E or integration tests yet.
- **Point cloud memory.** No size limits on E57 loading. Large files can OOM the browser.
- **`annotation-system.js`** is the only module that doesn't use Logger — it has no structured logging.
- **`@types/three` is installed** but many Three.js references still use `any` for compatibility with Spark.js and dynamic patterns.

## When changes are made
- Update ROADMAP.MD if changed item is present
