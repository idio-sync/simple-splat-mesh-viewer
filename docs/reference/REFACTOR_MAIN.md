# Refactoring main.js — Extraction Plan

`main.js` started at ~3,889 lines and handles too many concerns. This document identifies 9 extractable modules, ordered by impact and separation difficulty.

After all extractions, main.js would shrink to ~1,450 lines — primarily `init()`, state/variable declarations, deps factories, the animation loop, thin delegation wrappers, and bootstrap code. A proper glue layer.

## Progress

**Phase 1 complete** (2025-02-14). main.js reduced from 3,889 → 3,507 lines (382 lines removed).
**Phase 1.5 complete** (2025-02-14). Structural prep — main.js at 3,522 lines (net +15 from `sceneRefs` block; no line-reduction goal).
**Phase 2 complete** (2025-02-15). main.js reduced from 3,522 → 1,725 lines (1,797 lines removed). 5 extraction steps, 3 new TypeScript modules, 2 existing JS modules extended.

| Step | Module | Status | Lines Removed |
|------|--------|--------|---------------|
| 1.1 | `screenshot-manager.js` (new) | Done | 86 |
| 1.2 | `transform-controller.js` (new) | Done | 128 |
| 1.3 | Alignment I/O → `alignment.js` | Done | 61 |
| 1.4 | Controls/viewer → `ui-controller.js` | Done | 107 |
| 1.5a | `asset-store.js` (new singleton) | Done | — (structural) |
| 1.5b | `sceneRefs` getter object in main.js | Done | — (structural) |
| 2.1 | `export-controller.ts` (new) | Done | 379 |
| 2.2 | `archive-pipeline.ts` (new) | Done | 544 |
| 2.3 | URL loaders → `file-handlers.js` | Done | 116 |
| 2.4 | Tauri dialogs → `tauri-bridge.js` | Done | 54 |
| 2.5 | `event-wiring.ts` (new) | Done | 704 |

**Phase 1 notes:**
- `screenshot-manager.js`: 6 functions extracted, each receives deps via `{ renderer, scene, camera, state }`. Imports `captureScreenshot` directly from `archive-creator.js`.
- `transform-controller.js`: 4 functions + 9 tracking vectors (now encapsulated as private module state). Receives deps per call.
- `alignment.js`: Extended with `saveAlignment`, `loadAlignment`, `loadAlignmentFromUrl`. Updated existing `applyAlignmentData` to handle `pointcloudGroup` and call `storeLastPositions`.
- `ui-controller.js`: Replaced simpler `toggleControlsPanel`/`applyControlsVisibility` with richer main.js versions (handle controlsMode, width/padding styles, resize callback). Added `ensureToolbarVisibility`, `applyViewerModeSettings`.
- Dockerfile updated with COPY lines for 2 new modules.

**Phase 1.5 notes:**
- `asset-store.js`: ES module singleton exporting `getStore()` and `resetBlobs()`. Replaces 6 scattered `let` blob variables (`currentSplatBlob`, `currentMeshBlob`, `currentProxyMeshBlob`, `currentProxySplatBlob`, `currentPointcloudBlob`) and `sourceFiles` array. All references in main.js updated to `assets.splatBlob`, `assets.meshBlob`, etc. via `const assets = getStore()`. Property names in `createMetadataDeps()` preserved for `metadata-manager.js` compatibility.
- `sceneRefs`: Getter object in main.js wrapping all mutable Three.js references (`splatMesh`, `modelGroup`, `pointcloudGroup`, `scene`, `camera`, `renderer`, `controls`, `transformControls`, etc.). Getters prevent stale-reference bugs when objects are reassigned after loading new files. Ready for Phase 2 modules to consume instead of individual object deps.
- Dockerfile updated with COPY line for `asset-store.js`.

**Phase 2 notes:**
- `export-controller.ts`: 6 functions extracted (`showExportPanel`, `updateArchiveAssetCheckboxes`, `downloadArchive`, `downloadGenericViewer`, `exportMetadataManifest`, `importMetadataManifest`). Each receives `deps: ExportDeps`. Read-only consumer of state/assets.
- `archive-pipeline.ts`: 11 functions extracted (8 exported, 3 private). Handles entire archive loading/processing pipeline. Uses `setSplatMesh` callback for mesh reassignment. Imports directly from file-handlers.js, archive-loader.js, constants.js, utilities.js.
- URL loaders: `loadSplatFromUrl` and `loadModelFromUrl` converted from 70+ line functions to ~13-line thin wrappers delegating to file-handlers.js with progress UI.
- Tauri dialogs: `wireNativeFileDialogs(handlers)` moved to tauri-bridge.js, accepts handler map. main.js builds compact handler map inline.
- `event-wiring.ts`: 752-line `setupUIEvents()` extracted. Uses namespaced deps (files, display, camera, alignment, annotations, export, screenshots, metadata, share, controls, tauri). `clearDebugViews()` helper collapsed ~180 lines of repetitive mutual-exclusion code into ~30 lines. Fixed bug: Escape key handler called undefined `hideMetadataDisplay()` — corrected to `hideMetadataSidebar()`.
- `sceneRefs` extended with light getters (`ambientLight`, `hemisphereLight`, `directionalLight1`, `directionalLight2`) for event-wiring consumption.
- All new `.ts` modules import from `.js` via `.js` extensions (Vite resolves). No config changes needed.

---

## New Modules

### 1. `archive-pipeline.js` — ~650 lines (biggest win)

**Source lines:** 1429–1946, 2846–2894, 2953–2984

**Functions to extract:**
- `processArchive()`
- `ensureAssetLoaded()`
- `loadSplatFromBlobUrl()`
- `loadModelFromBlobUrl()`
- `loadArchiveFromUrl()`
- `handleArchiveFile()`
- `updateArchiveMetadataUI()`
- `clearArchiveMetadata()`
- `switchQualityTier()`
- `handleLoadFullResMesh()`

**What it is:** The entire archive loading and processing pipeline — load archive, parse manifest, lazy-extract assets, apply transforms, update UI. These functions form a cohesive flow and share heavy coupling to `state.archiveLoader`, `state.assetStates`, and the blob variables (`currentSplatBlob`, `currentMeshBlob`, etc.).

**Separation difficulty:** Medium. Needs access to blob variables, state, and several loader functions from file-handlers.js. Would receive those via a deps object.

---

### 2. `export-controller.js` — ~330 lines

**Source lines:** 2005–2486

**Functions to extract:**
- `downloadArchive()` (290 lines alone — single largest function in main.js)
- `downloadGenericViewer()`
- `updateArchiveAssetCheckboxes()`
- `showExportPanel()`

**What it is:** Archive export assembly. `downloadArchive()` collects metadata, assembles all assets with transforms, adds screenshots/images/source-files, validates, and triggers the download.

**Separation difficulty:** Medium. Reads from many state variables and blob references, but only reads — it doesn't mutate main.js state. Clean consumer boundary.

---

### 3. `screenshot-manager.js` — ~120 lines

**Source lines:** 2030–2150

**Functions to extract:**
- `captureScreenshotToList()`
- `showViewfinder()`
- `hideViewfinder()`
- `captureManualPreview()`
- `renderScreenshotsList()`
- `removeScreenshot()`

**What it is:** Screenshot capture, viewfinder overlay, and screenshot list management. Entirely self-contained — manages `state.screenshots` and `state.manualPreviewBlob`, interacts with the renderer for captures, and manages the viewfinder overlay DOM.

**Separation difficulty:** Easy. Only needs `renderer`, `scene`, `camera`, and the `state.screenshots`/`state.manualPreviewBlob` references. Cleanest extraction candidate.

---

### 4. `transform-controller.js` — ~150 lines

**Source lines:** 1219–1368

**Functions to extract:**
- `setSelectedObject()`
- `syncBothObjects()`
- `storeLastPositions()`
- `setTransformMode()`

**State to move:**
- 9 tracking vectors: `lastSplatPosition`, `lastSplatRotation`, `lastSplatScale`, `lastModelPosition`, `lastModelRotation`, `lastModelScale`, `lastPointcloudPosition`, `lastPointcloudRotation`, `lastPointcloudScale`

**What it is:** Transform gizmo orchestration — attaching/detaching controls, syncing paired objects in "both" mode, and tracking delta movements for multi-object sync.

**Separation difficulty:** Easy. Needs `transformControls`, `splatMesh`, `modelGroup`, `pointcloudGroup`, and `state`. Well-defined inputs/outputs.

---

### 5. `event-wiring.js` — ~560 lines

**Source lines:** 617–1179

**Functions to extract:**
- `setupUIEvents()` (the entire function)

**What it is:** The massive event wiring function. Purely declarative — binding DOM element IDs to handler functions. Contains sub-concerns:

| Sub-concern | Lines |
|-------------|-------|
| Scene settings (background, tone mapping, HDR, shadows) | ~170 |
| Model/splat/pointcloud sliders and position inputs | ~160 |
| File input bindings | ~50 |
| Lighting controls | ~30 |
| Keyboard shortcuts | ~25 |
| Everything else (annotation, export, camera buttons) | ~125 |

**Separation difficulty:** Hard. References ~40 functions from main.js scope. Would need a large deps/callbacks object, making the extraction mechanically straightforward but the API surface wide. Could be split further (e.g., scene settings wiring vs. asset settings wiring).

---

## Extend Existing Modules

### 6. Alignment I/O → fold into `alignment.js` — ~90 lines

**Source lines:** 2994–3081

**Functions to move:**
- `saveAlignment()`
- `applyAlignmentData()`
- `loadAlignment()`
- `loadAlignmentFromUrl()`

**What it is:** Alignment persistence — saving/loading alignment JSON files and applying transform data to scene objects. Currently `alignment.js` handles the computation (ICP, auto-center); these handle the I/O. They logically belong together.

**Separation difficulty:** Easy. `applyAlignmentData()` just sets position/rotation/scale on objects. Pure data application.

---

### 7. URL asset loaders → fold into `file-handlers.js` — ~235 lines

**Source lines:** 3287–3522

**Functions to move:**
- `loadSplatFromUrl()`
- `loadModelFromUrl()`
- `loadPointcloudFromUrl()`
- `loadDefaultFiles()` (may stay in main.js as boot orchestration)

**What it is:** URL-based asset loading. These duplicate significant logic with the blob URL loaders already in file-handlers.js — both do: fetch blob, create blob URL, clear existing object, load, update state, update UI. Consolidating would eliminate code duplication between `loadSplatFromBlobUrl()` and `loadSplatFromUrl()`.

**Separation difficulty:** Medium. `loadDefaultFiles()` orchestrates the boot sequence and may want to stay in main.js, but the individual URL loaders could move.

---

### 8. Controls/viewer mode → fold into `ui-controller.js` — ~130 lines

**Source lines:** 3151–3284

**Functions to move:**
- `toggleControlsPanel()`
- `applyControlsVisibility()`
- `ensureToolbarVisibility()`
- `applyViewerModeSettings()`

**What it is:** Controls panel show/hide, toolbar visibility safeguards, and sidebar initial state management. Already closely related to what `ui-controller.js` does.

**Separation difficulty:** Easy. Mostly DOM manipulation with `config` and `state.controlsVisible` as inputs.

---

### 9. Tauri file dialog wiring → fold into `tauri-bridge.js` — ~130 lines

**Source lines:** 2615–2745

**Functions to move:**
- `wireNativeFileDialogs()`
- `wireInput()` (helper)

**What it is:** Overrides browser file inputs with native Tauri OS dialogs. Platform-specific concern that belongs with the existing Tauri bridge module.

**Separation difficulty:** Medium. Each `wireInput` call references a specific handler from main.js. Could take the handlers as a config map.

---

## Summary

| # | Module | Lines | Difficulty | Strategy | Status |
|---|--------|-------|------------|----------|--------|
| 1 | `archive-pipeline.ts` | ~650 | Medium | New module | **Done** |
| 2 | `export-controller.ts` | ~330 | Medium | New module | **Done** |
| 3 | `screenshot-manager.js` | ~120 | Easy | New module | **Done** |
| 4 | `transform-controller.js` | ~150 | Easy | New module | **Done** |
| 5 | `event-wiring.ts` | ~560 | Hard | New module | **Done** |
| 6 | Alignment I/O → `alignment.js` | ~90 | Easy | Extend existing | **Done** |
| 7 | URL loaders → `file-handlers.js` | ~235 | Medium | Extend existing | **Done** |
| 8 | Controls/viewer → `ui-controller.js` | ~130 | Easy | Extend existing | **Done** |
| 9 | Tauri dialogs → `tauri-bridge.js` | ~130 | Medium | Extend existing | **Done** |
| — | `asset-store.js` (structural prep) | ~50 | Easy | New singleton | **Done** |
| — | `sceneRefs` getter (structural prep) | ~15 | Easy | Refactor in main.js | **Done** |
| | **Total extractable** | **~2,395** | | | **9/9 done + structural prep** |

**Remaining in main.js (1,725 lines):**
- `init()` — scene setup, system initialization, boot orchestration
- State object and module-scope variable declarations
- Dependency factory functions (`createFileHandlerDeps()`, `createExportDeps()`, `createArchivePipelineDeps()`, `createEventWiringDeps()`, etc.)
- Animation loop (`animate()`)
- Thin one-liner delegation wrappers (annotation, metadata, file handlers, etc.)
- URL validation (`validateUserUrl()`)
- App bootstrap (`startApp()`, DOMContentLoaded)

## Recommended Order

Start with the **easy, clean-boundary** extractions to build confidence:

1. `screenshot-manager.js` — most self-contained, minimal deps
2. `transform-controller.js` — clean inputs/outputs, easy to test
3. Alignment I/O → `alignment.js` — natural home, easy merge
4. Controls/viewer → `ui-controller.js` — pure DOM, low risk

Then tackle the **medium-difficulty, high-value** extractions:

5. `archive-pipeline.js` — biggest single win
6. `export-controller.js` — second biggest, read-only consumer
7. URL loaders → `file-handlers.js` — eliminates duplication
8. Tauri dialogs → `tauri-bridge.js` — platform concern

Save the **hardest** for last:

9. `event-wiring.js` — wide API surface, but biggest remaining chunk

## Notes

- **Phase 2+ extractions should be written as TypeScript (`.ts`)** — Vite + `allowJs: true` means new `.ts` modules interop seamlessly with existing `.js` modules.
- All new modules should follow existing conventions: create a logger via `Logger.getLogger('module-name')`, export functions that receive deps objects, use `notify()` for user-facing messages.
- Docker uses `COPY dist/` — no per-file Dockerfile updates needed. New modules that the kiosk viewer fetches as raw text must be added to the `KIOSK_MODULES` list in `vite.config.ts`.
- The deps pattern is already established — new modules should follow it rather than importing main.js.
