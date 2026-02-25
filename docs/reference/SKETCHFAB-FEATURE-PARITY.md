# Sketchfab Feature Parity Analysis

**Date:** 2026-02-11 (last updated 2026-02-24)
**Purpose:** Ranked feature gap analysis between this viewer and Sketchfab, evaluated for Three.js 0.170.0 feasibility.

---

## Changelog

| Date | Features Implemented | Files Modified |
|------|---------------------|----------------|
| 2026-02-11 | Ranks 1–5: Tone mapping, HDR environment maps (IBL), environment as background, shadow casting, shadow catcher ground plane. Bonus: background image loading from file/URL. | `constants.js`, `index.html`, `scene-manager.js`, `main.js`, `kiosk-main.js` |
| 2026-02-11 | Rank 7: Auto-rotate toggle. Toolbar button in both main and kiosk. Default on in kiosk (disables on manual interaction), default off in main app. Speed matches Sketchfab (~30s/revolution). | `constants.js`, `index.html`, `scene-manager.js`, `main.js`, `kiosk-main.js` |
| 2026-02-11 | Rank 6: Screenshot capture. Collapsible sidebar section with capture button, viewfinder-based archive preview override, thumbnail grid with delete, screenshots exported to `/screenshots/` in archive. | `main.js`, `index.html`, `styles.css`, `archive-creator.js` |
| 2026-02-12 | Rank 16: Matcap rendering mode. Checkbox toggle + 5 procedurally-generated presets (Clay/Chrome/Pearl/Jade/Copper). Mutually exclusive with wireframe. Works in both main app and kiosk. | `file-handlers.js`, `index.html`, `main.js`, `kiosk-main.js` |
| 2026-02-12 | Rank 26: Normal map visualization. MeshNormalMaterial toggle (RGB = XYZ normals). Mutually exclusive with wireframe and matcap. Works in main app, kiosk, and editorial theme. | `file-handlers.js`, `index.html`, `main.js`, `kiosk-main.js`, `editorial/layout.js` |
| 2026-02-12 | Rank 9: FOV control slider (10°–120°). Added to Scene Settings in main app, kiosk standard UI, and editorial theme bottom ribbon as compact inline slider. | `index.html`, `main.js`, `kiosk-main.js`, `editorial/layout.js`, `editorial/layout.css` |
| 2026-02-12 | STL file loading. Full STL support with file input, URL loading, and display mode toggle. Works in main app and kiosk. | `file-handlers.js`, `index.html`, `main.js`, `kiosk-main.js` |
| 2026-02-12 | Kiosk theming system. Pluggable theme architecture with `src/themes/` directory, theme-loader.js, template/minimal/editorial themes. Editorial theme has custom layout with bottom ribbon. | `theme-loader.js`, `kiosk-main.js`, `config.js`, `themes/` |
| 2026-02-12 | SD/HD quality tier toggle. Device-aware auto-detection, proxy mesh and proxy splat support, one-click tier switching. Partially addresses LOD (Rank 40). | `quality-tier.js`, `main.js`, `kiosk-main.js`, `file-handlers.js`, `archive-loader.js`, `archive-creator.js` |
| 2026-02-13 | Tauri native desktop app. Full desktop application via Tauri with native OS file dialogs, filesystem access, and GitHub Actions release workflow. | `tauri-bridge.js`, `main.js`, `archive-creator.js`, `src-tauri/` |
| 2026-02-24 | Rank 13: Cross-section clipping plane tool. Arbitrary-orientation clipping plane with draggable 3D handle, normal flip, and depth snap. Works in main app and kiosk viewer. | `cross-section.ts`, `index.html`, `main.ts`, `kiosk-main.ts` |
| 2026-02-24 | Rank 14: Distance measurement tool. Two-click flow, 3D line overlay, DOM distance markers, configurable units (m/cm/mm/in/ft). Works in main app and kiosk viewer. | `measurement-system.ts`, `index.html`, `main.ts`, `kiosk-main.ts` |
| 2026-02-24 | Rank 15: Walkthrough engine (guided annotation tours). Author camera-stop sequences with fly/fade/cut transitions, configurable dwell times, annotation links, auto-play and loop. Playback in editor and kiosk viewer. | `walkthrough-engine.ts`, `walkthrough-controller.ts`, `walkthrough-editor.ts`, `index.html`, `main.ts`, `kiosk-main.ts` |
| 2026-02-24 | Annotation enhancements. Smooth camera animation when navigating to annotations, hero image zone with lightbox in popups, YouTube embed support in annotation descriptions, weighted connecting lines from markers to popups. | `annotation-system.ts`, `annotation-controller.ts`, `index.html`, `styles.css` |
| 2026-02-24 | DXF drawing files as independent asset type (bonus). Loaded via `three-dxf-loader`, displayed in a dedicated drawing layer, round-trips through archive. | `file-handlers.ts`, `index.html`, `main.ts`, `kiosk-main.ts` |
| 2026-02-24 | Draco mesh compression (bonus). DRACOLoader with WASM decoder served from `public/draco/`. Draco-compressed GLB files load transparently alongside uncompressed models. | `file-handlers.ts`, `scene-manager.ts` |

---

## Legend

| Column | Meaning |
|--------|---------|
| **Status** | `HAVE` = already implemented, `DONE` = implemented during this analysis, `GAP` = missing |
| **Feasibility** | `TRIVIAL` / `LOW` / `MEDIUM` / `HIGH` / `VERY HIGH` = effort to implement in Three.js |
| **Impact** | How much this feature closes the gap with Sketchfab for our use case (3D scan deliverables) |
| **Rank** | Priority order — higher rank = implement first (best ratio of impact to effort) |

---

## Current Advantages Over Sketchfab

These features exist in our viewer but **not in Sketchfab**:

| Feature | Notes |
|---------|-------|
| Gaussian splat rendering (.ply, .spz, .ksplat, .sog, .splat) | Sketchfab has zero splat support |
| E57 point cloud native loading (WASM) | Sketchfab only supports PLY point clouds |
| DXF drawing files as independent asset type | Floor plans / technical drawings alongside 3D data |
| Custom archive format (.a3d/.a3z) with manifest | Bundled deliverables with metadata |
| Fully offline kiosk HTML (~1MB self-contained) | No network dependency at all |
| N-point landmark alignment (Kabsch algorithm) with live preview & RMSE | Spatial registration of multi-asset scenes |
| ICP auto-alignment | Iterative closest point alignment |
| Dublin Core metadata system (50+ fields, 8 tabs) | Archival-grade metadata |
| SIP compliance validation at export time | Required-field checking, compliance scoring, manifest audit trail |
| Split-view dual-canvas rendering | Side-by-side comparison |
| Kiosk theming system | Pluggable themes (editorial, minimal, template) with custom layouts |
| SD/HD quality tier with proxy assets | Device-aware auto-detection, one-click switching |
| Draco mesh compression support | Transparent loading of Draco-compressed GLBs |
| Tauri native desktop application | Offline desktop app with OS file dialogs and filesystem access |

---

## Ranked Feature Gaps

### TIER 1 — High Impact, Low-to-Medium Effort (Implement First)

These features deliver the most visual/functional parity per hour of work.

| Rank | Feature | Sketchfab Has | We Have | Feasibility | Impact | Notes |
|------|---------|--------------|---------|-------------|--------|-------|
| 1 | **Tone mapping** | ACESFilmic, Reinhard, Filmic, etc. | **DONE** | TRIVIAL | High | 6 modes (None/Linear/Reinhard/Cineon/ACESFilmic/AgX) + exposure slider. Default: None (neutral). In `scene-manager.js`. |
| 2 | **HDR environment maps (IBL)** | Full HDRI with rotation, exposure, blur | **DONE** | LOW | Very High | `RGBELoader` + `PMREMGenerator`. 3 presets (Outdoor/Studio/Sunset) + load from file or URL. In `scene-manager.js`. |
| 3 | **Environment as background** | Show/hide/blur environment skybox | **DONE** | LOW | High | Checkbox toggle to show HDR env as skybox. Mutually exclusive with solid color and background image. |
| 4 | **Shadow casting** | Real-time directional shadows, resolution control | **DONE** | LOW | High | PCFSoftShadowMap, 2048px map. Toggle in settings. Auto-enabled in kiosk mode. |
| 5 | **Shadow catcher ground plane** | Invisible plane receiving shadows | **DONE** | LOW | High | ShadowMaterial with adjustable opacity (0.05–1.0). Excluded from raycasting. Auto-created with shadows. |
| 6 | **Screenshot capture** | 1x/2x/4x resolution export | **DONE** | LOW | Medium-High | Capture button + viewfinder preview override + thumbnail grid. Screenshots exported to `/screenshots/` in archive. 1024x1024 JPEG. |
| 7 | **Auto-rotate** | Turntable with speed/direction control | **DONE** | TRIVIAL | Medium | Toolbar toggle button. Default on in kiosk (auto-disables on interaction), off in main app. Speed: 2.0 (~30s/rev). |
| 8 | **Camera constraints** | Orbit angle limits, zoom min/max, pan bounds | Partial | LOW | Medium | Zoom limits (`minDistance`/`maxDistance`) set via `ORBIT_CONTROLS` constants in scene-manager.js. Still missing: polar angle limits to prevent going underground, UI controls for runtime adjustment. |
| 9 | **FOV control** | Adjustable field of view slider | **DONE** | TRIVIAL | Medium | Slider (10°–120°) in Scene Settings, kiosk, and editorial ribbon. |
| 10 | **Orthographic view toggle** | Parallel projection mode | No | LOW | Medium | Swap between `PerspectiveCamera` and `OrthographicCamera`. Useful for architectural viewing. |

**Estimated total effort for Tier 1: ~15-25 hours**
**Progress: 8 of 10 features implemented (ranks 1–7, 9). Rank 8 partial (zoom limits only).**
**Expected result: ~60% visual parity with Sketchfab**

---

### TIER 2 — High Impact, Medium Effort (Core Professional Features)

These are the features that make a 3D viewer feel "professional grade."

| Rank | Feature | Sketchfab Has | We Have | Feasibility | Impact | Notes |
|------|---------|--------------|---------|-------------|--------|-------|
| 11 | **SSAO (ambient occlusion)** | Adjustable intensity & radius | No | MEDIUM | Very High | `SSAOPass` via EffectComposer. Dramatically improves depth perception. ~15-25% FPS cost. |
| 12 | **Bloom** | HDR bloom with threshold & intensity | No | MEDIUM | High | `UnrealBloomPass`. Makes emissive surfaces glow, adds cinematic quality. |
| 13 | **Clipping/section planes** | X/Y/Z axis with position sliders | **DONE** | MEDIUM | Very High | Arbitrary-orientation clipping plane with draggable 3D handle, normal flip, and depth snap. `cross-section.ts`. Works in main app and kiosk. |
| 14 | **Distance measurement tool** | Click two points, show distance | **DONE** | MEDIUM | Very High | Two-click flow, 3D line overlay, DOM distance markers, configurable units (m/cm/mm/in/ft). `measurement-system.ts`. Works in main app and kiosk. |
| 15 | **Guided annotation tours** | Sequential walkthrough with camera animation | **DONE** | MEDIUM | High | Walkthrough engine with camera-stop sequences, fly/fade/cut transitions, configurable dwell times, annotation links, auto-play and loop. `walkthrough-engine.ts`, `walkthrough-controller.ts`, `walkthrough-editor.ts`. |
| 16 | **Matcap rendering mode** | Clay/form-study visualization | **DONE** | LOW | Medium | `MeshMatcapMaterial` with 5 procedural presets (Clay/Chrome/Pearl/Jade/Copper). Checkbox + dropdown in Model Settings. Mutually exclusive with wireframe. |
| 17 | **Model inspector panel** | Vertex/face/texture count, memory usage | No | LOW | Medium | Traverse scene graph, count geometry stats. Display in sidebar. |
| 18 | **Angle measurement** | Three-point angle calculation | No | MEDIUM | High | Extension of distance measurement. Click 3 points, calculate and display angle. |
| 19 | **Camera position presets / saved viewpoints** | Named camera positions, smooth transitions | No | MEDIUM | Medium-High | Save camera pos/target/up, tween between them. Store in archive metadata. |
| 20 | **Outline / selection highlight** | Glow effect on hovered/selected objects | No | LOW-MEDIUM | Medium | `OutlinePass` in EffectComposer. Better visual feedback for object interaction. |

**Estimated total effort for Tier 2: ~40-60 hours**
**Progress: 4 of 10 features implemented (ranks 13, 14, 15, 16).**
**Expected result: ~85% functional parity with Sketchfab**

---

### TIER 3 — Medium Impact, Medium Effort (Quality-of-Life Polish)

Features that enhance the professional feel but aren't critical for core use case.

| Rank | Feature | Sketchfab Has | We Have | Feasibility | Impact | Notes |
|------|---------|--------------|---------|-------------|--------|-------|
| 21 | **Depth of field** | Adjustable focal distance & aperture | No | MEDIUM | Medium | `BokehPass`. Cinematic but niche — most useful for beauty shots. |
| 22 | **Color grading / exposure control** | Temperature, brightness, contrast, saturation | No | MEDIUM | Medium | Custom shader pass or LUTPass. Add exposure slider at minimum. |
| 23 | **Vignette** | Corner darkening with adjustable falloff | No | LOW | Low-Medium | Simple shader pass. Quick cinematic polish. |
| 24 | **Chromatic aberration** | RGB channel separation | No | LOW | Low | Custom shader. Subtle cinematic effect. |
| 25 | **Film grain** | Noise overlay | No | LOW | Low | Custom shader. Very subtle effect. |
| 26 | **Normal map visualization** | Display normals as RGB | **DONE** | LOW | Low-Medium | `MeshNormalMaterial` toggle. RGB = XYZ surface normals. Mutually exclusive with wireframe/matcap. |
| 27 | **UV checker pattern** | Validate UV unwrapping | No | LOW | Low | Apply checkerboard texture. Diagnostic tool for modelers. |
| 28 | **Unlit / shadeless mode** | Disable lighting, show base color only | No | LOW | Medium | Set all materials to `MeshBasicMaterial` temporarily. Useful for texture inspection. |
| 29 | **Double-sided rendering toggle** | Render back faces | Partial | LOW | Low-Medium | `material.side = THREE.DoubleSide`. Already works on some models. Add UI toggle. |
| 30 | **Area measurement** | Click polygon, calculate area | No | HIGH | Medium | Significantly more complex than distance/angle. Polygon input + area calculation. |

**Estimated total effort for Tier 3: ~25-35 hours**

---

### TIER 4 — Medium Impact, High Effort (Advanced Professional Features)

Significant engineering investment but differentiating for professional use.

| Rank | Feature | Sketchfab Has | We Have | Feasibility | Impact | Notes |
|------|---------|--------------|---------|-------------|--------|-------|
| 31 | **Section box (6-plane clipping)** | Interactive box to isolate region | No | HIGH | High | 6 clipping planes + TransformControls gizmo. Powerful for BIM/architecture. Extension of #13. |
| 32 | **Animation playback controls** | Play/pause, timeline, speed, loop modes | No | MEDIUM | Medium | `AnimationMixer` is built-in. Need UI: play/pause, scrubber, speed slider, clip selector. Only relevant when model has animations. |
| 33 | **Animation clip selector** | Switch between multiple animations | No | MEDIUM | Medium | Dropdown populated from `gltf.animations`. Crossfade between clips. |
| 34 | **Morph target / blend shape controls** | Facial expressions, shape keys | No | MEDIUM | Low-Medium | Slider UI per morph target. Built-in to Three.js. Niche for scan data. |
| 35 | **Exploded view** | Animate parts to separated positions | No | HIGH | Medium | Calculate part bounding boxes, animate along center-to-origin vectors. Useful for assembly visualization. |
| 36 | **Object picking / scene tree** | Click to select, view hierarchy | Partial | HIGH | Medium | Have raycasting. Need scene graph UI panel + per-object visibility toggles + transform display. |
| 37 | **Material inspector / editor** | View & edit PBR properties per material | No | HIGH | Medium | Read material properties from scene. Display in UI. Editing adds significant complexity. |
| 38 | **Turntable video export** | Generate 360-degree animation GIF/video | No | HIGH | Medium | Rotate camera programmatically + `MediaRecorder` API on canvas stream. |
| 39 | **Camera animation timeline** | Keyframe camera paths, export video | No | VERY HIGH | Medium | Full keyframe editor UI + camera path interpolation + video export. |
| 40 | **LOD (level of detail)** | Auto-simplify by camera distance | Partial | HIGH | Medium | SD/HD quality tier system with proxy mesh/splat support addresses manual LOD switching. Still missing: automatic distance-based LOD via `THREE.LOD` class, runtime mesh decimation. |

**Estimated total effort for Tier 4: ~80-120 hours**

---

### TIER 5 — Low Impact for Our Use Case (Long-Term / Niche)

Features Sketchfab has that are less relevant for 3D scan deliverables.

| Rank | Feature | Sketchfab Has | We Have | Feasibility | Impact | Notes |
|------|---------|--------------|---------|-------------|--------|-------|
| 41 | **WebXR (VR mode)** | HMD viewing | No | HIGH | Low | `renderer.xr.enabled = true`. Needs controller handling. Niche audience. |
| 42 | **AR mode (mobile)** | Place model in real world | No | HIGH | Low | WebXR hit-testing. iOS needs USDZ export path. |
| 43 | **Gyroscope camera (mobile)** | Tilt phone to look around | No | MEDIUM | Low | DeviceOrientationControls. Mobile-only feature. |
| 44 | **Spatial audio** | 3D positioned sound sources | No | MEDIUM | Very Low | `THREE.PositionalAudio`. Not relevant for scan data. |
| 45 | **Background audio** | Ambient music/sound | No | LOW | Very Low | Standard Web Audio API. Not relevant for scan data. |
| 46 | **Subsurface scattering** | Skin, wax, marble translucency | No | VERY HIGH | Very Low | MeshPhysicalMaterial has limited transmission. True SSS needs custom shaders. Not relevant for scans. |
| 47 | **Texture UV tiling/offset controls** | Per-material UV manipulation | No | LOW | Very Low | `material.map.repeat` / `material.map.offset`. Niche. |
| 48 | **Viewer JavaScript API** | Programmatic embed control | No | VERY HIGH | Low | Requires major architecture refactor to expose clean API. Future consideration if embedding becomes a priority. |
| 49 | **QR code generation** | Share via QR code | No | LOW | Low | Use a QR library. Nice-to-have for on-site sharing. |
| 50 | **Heatmap analytics** | Track where users look | No | VERY HIGH | Very Low | Complex tracking + visualization system. Sketchfab PRO only. |

**Estimated total effort for Tier 5: ~60-100+ hours**

---

## Features We Already Match Sketchfab On

| Sketchfab Feature | Our Implementation | Parity |
|---|---|---|
| 3D annotation placement | Raycasted surface annotations with numbered markers | Full |
| Annotation titles & descriptions | ID, title, body fields | Full |
| Markdown in annotations | Markdown rendering in popups | Full |
| Images in annotations | `asset:images/` protocol in markdown | Full |
| Camera animation to annotation | Stored camera viewpoint per annotation | Full |
| Orbit controls | OrbitControls with rotate/pan/zoom | Full |
| First-person (WASD) navigation | fly-controls.js module | Full |
| Touch controls | Pinch zoom, one-finger rotate | Full |
| Keyboard shortcuts | W/E/R gizmo, A/M/F features | Full |
| Wireframe toggle | Material wireframe property | Full |
| Model opacity control | Slider-based opacity | Full |
| Background color options | 4 presets + custom color picker | Full |
| Background image | Load from file or URL, clear button | Full |
| Tone mapping | 6 modes (None/Linear/Reinhard/Cineon/ACESFilmic/AgX) + exposure | Full |
| HDR environment maps (IBL) | 3 presets + load from file/URL, PMREMGenerator | Full |
| Environment as background | Toggle HDR env as skybox | Full |
| Shadow casting | PCFSoftShadowMap, toggleable, auto in kiosk | Full |
| Shadow catcher ground plane | ShadowMaterial with adjustable opacity | Full |
| Auto-rotate | Toolbar toggle, ~30s/rev, kiosk default-on with auto-disable on interaction | Full |
| Grid helper | Toggle grid display | Full |
| Transform gizmo | Translate/rotate/scale via TransformControls | Full |
| GLTF/GLB loading | GLTFLoader | Full |
| OBJ loading | OBJLoader + MTL | Full |
| STL loading | STLLoader with file input, URL loading, display mode | Full |
| Screenshot capture | 1024x1024 JPEG, viewfinder preview, thumbnail grid, archive `/screenshots/` export | Full |
| Screenshot (for archives) | Canvas capture for archive thumbnails | Full |
| Matcap rendering mode | 5 procedural presets (Clay/Chrome/Pearl/Jade/Copper) with dropdown | Full |
| Normal map visualization | MeshNormalMaterial toggle (RGB = XYZ normals) | Full |
| URL sharing with state | URL parameters for scene config | Full |
| Embed/sharing controls | Share dialog with link builder | Partial |
| Vertex color display | Point cloud vertex colors | Full |
| Loading progress | Overlay with progress bar | Full |
| Responsive design | Desktop + mobile/kiosk layouts | Full |
| Camera reset | Reset to default + fit-to-view | Full |
| Multiple light controls | 4 lights with independent intensity sliders | Full |
| FOV control | Slider (10°–120°) in Scene Settings, kiosk, and editorial ribbon | Full |
| Clipping/section planes | Arbitrary-orientation clipping plane, draggable 3D handle, main app and kiosk | Full |
| Distance measurement | Two-click flow, 3D line overlay, configurable units (m/cm/mm/in/ft) | Full |
| Guided annotation tours | Walkthrough engine with fly/fade/cut transitions, dwell times, auto-play and loop | Full |

---

## Implementation Roadmap Summary

```
Phase 1 (Tier 1):  ~15-25 hrs  →  60% visual parity  [IN PROGRESS — 8/10 done]
  ✅ Tone mapping, HDR/IBL, env-as-background, shadows, shadow catcher
  ✅ Background image loading (bonus, not in Sketchfab)
  ✅ Auto-rotate (toolbar toggle, kiosk default-on)
  ✅ Screenshot capture (viewfinder preview, thumbnail grid, archive export)
  ✅ FOV control slider (10°–120°)
  🟡 Camera constraints (zoom limits only — needs angle limits + UI)
  ⬜ Orthographic view

Phase 2 (Tier 2):  ~40-60 hrs  →  85% functional parity  [IN PROGRESS — 4/10 done]
  ✅ Matcap rendering mode (5 procedural presets, checkbox + dropdown)
  ✅ Clipping/section planes (cross-section.ts, arbitrary orientation, draggable handle)
  ✅ Distance measurement tool (two-click, 3D overlay, configurable units)
  ✅ Guided annotation tours (walkthrough engine, fly/fade/cut transitions, auto-play)
  ⬜ SSAO, bloom, inspector, angle measurement, saved viewpoints, outlines

Phase 3 (Tier 3):  ~25-35 hrs  →  90% polish parity  [IN PROGRESS — 1/10 done]
  ✅ Normal map visualization (MeshNormalMaterial toggle)
  ⬜ DOF, color grading, vignette, diagnostic overlays,
    unlit mode, area measurement

Phase 4 (Tier 4):  ~80-120 hrs →  95% feature parity
  🟡 LOD (partial — SD/HD quality tier with proxy assets)
  ⬜ Section box, animation system, exploded view,
    scene tree, material editor, video export

Phase 5 (Tier 5):  ~60-100 hrs →  ~98% parity (diminishing returns)
  ⬜ VR/AR, spatial audio, SSS, viewer API, analytics

Bonus (not in Sketchfab):
  ✅ STL file loading
  ✅ Kiosk theming system (editorial/minimal/template themes)
  ✅ SD/HD quality tier toggle with device-aware auto-detection
  ✅ Tauri native desktop application
  ✅ DXF drawing files as independent asset type (three-dxf-loader)
  ✅ Draco mesh compression (DRACOLoader, transparent loading of compressed GLBs)
```

**Total estimated effort to full parity: ~220-340 hours**
**Recommended stopping point: End of Phase 2 (~55-85 hours) for 85% parity**

---

## Adding New Dependencies

The project uses **Vite + npm**. New Three.js addons and packages are added via `npm install` and imported normally — no import map changes required.

```bash
npm install some-package
```

```typescript
import { SSAOPass } from 'three/addons/postprocessing/SSAOPass.js';
```

**Kiosk mode requires a separate step.** The kiosk generator fetches dependencies from CDN at generation time. Any package used in kiosk mode must also have a CDN URL added to the `CDN_DEPS` object in `kiosk-viewer.ts`:

```typescript
// Example: adding a new Three.js post-processing pass for kiosk use
"three/addons/postprocessing/SSAOPass.js":
  "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/SSAOPass.js",
```

Remaining Phase 2 post-processing deps (not yet added):

```typescript
// Post-processing
"three/addons/postprocessing/EffectComposer.js": "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/EffectComposer.js",
"three/addons/postprocessing/RenderPass.js":     "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/RenderPass.js",
"three/addons/postprocessing/UnrealBloomPass.js": "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/UnrealBloomPass.js",
"three/addons/postprocessing/SSAOPass.js":        "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/SSAOPass.js",
"three/addons/postprocessing/OutputPass.js":      "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/OutputPass.js",
"three/addons/postprocessing/OutlinePass.js":     "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/OutlinePass.js",
"three/addons/postprocessing/BokehPass.js":       "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/BokehPass.js",
// Camera animation (if not using built-in Three.js AnimationMixer)
"@tweenjs/tween.js": "https://esm.sh/@tweenjs/tween.js@25.0.0"
```

---

## Key Architectural Considerations

1. **Post-processing pipeline**: Introducing `EffectComposer` changes the render loop from `renderer.render(scene, camera)` to `composer.render()`. This affects the dual-canvas split view and kiosk mode. Plan this carefully.

2. **Kiosk mode**: Every new CDN dependency increases the kiosk HTML file size. HDR environment textures could add significant bulk — consider low-res HDR (512x256) for kiosk or making environments optional.

3. **Gaussian splat compatibility**: Spark.js renders splats in its own pass. Post-processing effects (SSAO, bloom) may not apply to splats correctly. Test early.

4. **Performance budget**: SSAO + bloom together cost ~30% FPS. Add quality presets (Low/Medium/High) that toggle expensive effects.

5. **Build pipeline via Vite**: Three.js addons can be imported directly from npm (`three/addons/...`) — no CDN needed for the main app. The kiosk generator separately fetches dependencies from CDN at generation time; any new dependency used in kiosk mode must also be added to `kiosk-viewer.ts` `CDN_DEPS`.
