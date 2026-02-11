# Sketchfab Feature Parity Analysis

**Date:** 2026-02-11
**Purpose:** Ranked feature gap analysis between this viewer and Sketchfab, evaluated for Three.js 0.170.0 feasibility.

---

## Changelog

| Date | Features Implemented | Files Modified |
|------|---------------------|----------------|
| 2026-02-11 | Ranks 1–5: Tone mapping, HDR environment maps (IBL), environment as background, shadow casting, shadow catcher ground plane. Bonus: background image loading from file/URL. | `constants.js`, `index.html`, `scene-manager.js`, `main.js`, `kiosk-main.js` |
| 2026-02-11 | Rank 7: Auto-rotate toggle. Toolbar button in both main and kiosk. Default on in kiosk (disables on manual interaction), default off in main app. Speed matches Sketchfab (~30s/revolution). | `constants.js`, `index.html`, `scene-manager.js`, `main.js`, `kiosk-main.js` |
| 2026-02-11 | Rank 6: Screenshot capture. Collapsible sidebar section with capture button, viewfinder-based archive preview override, thumbnail grid with delete, screenshots exported to `/screenshots/` in archive. | `main.js`, `index.html`, `styles.css`, `archive-creator.js` |

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
| Custom archive format (.a3d/.a3z) with manifest | Bundled deliverables with metadata |
| Fully offline kiosk HTML (~1MB self-contained) | No network dependency at all |
| 3-point landmark alignment (Kabsch algorithm) | Spatial registration of multi-asset scenes |
| ICP auto-alignment | Iterative closest point alignment |
| Dublin Core metadata system (50+ fields, 8 tabs) | Archival-grade metadata |
| Split-view dual-canvas rendering | Side-by-side comparison |

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
| 8 | **Camera constraints** | Orbit angle limits, zoom min/max, pan bounds | No | LOW | Medium | OrbitControls properties: `minDistance`, `maxDistance`, `minPolarAngle`, `maxPolarAngle`. Prevents going underground. |
| 9 | **FOV control** | Adjustable field of view slider | No | TRIVIAL | Medium | `camera.fov = value; camera.updateProjectionMatrix()`. One slider. |
| 10 | **Orthographic view toggle** | Parallel projection mode | No | LOW | Medium | Swap between `PerspectiveCamera` and `OrthographicCamera`. Useful for architectural viewing. |

**Estimated total effort for Tier 1: ~15-25 hours**
**Progress: 7 of 10 features implemented (ranks 1–7)**
**Expected result: ~60% visual parity with Sketchfab**

---

### TIER 2 — High Impact, Medium Effort (Core Professional Features)

These are the features that make a 3D viewer feel "professional grade."

| Rank | Feature | Sketchfab Has | We Have | Feasibility | Impact | Notes |
|------|---------|--------------|---------|-------------|--------|-------|
| 11 | **SSAO (ambient occlusion)** | Adjustable intensity & radius | No | MEDIUM | Very High | `SSAOPass` via EffectComposer. Dramatically improves depth perception. ~15-25% FPS cost. |
| 12 | **Bloom** | HDR bloom with threshold & intensity | No | MEDIUM | High | `UnrealBloomPass`. Makes emissive surfaces glow, adds cinematic quality. |
| 13 | **Clipping/section planes** | X/Y/Z axis with position sliders | No | MEDIUM | Very High | `renderer.clippingPlanes`. Critical for architectural/engineering clients to see interiors. Three.js has native support. |
| 14 | **Distance measurement tool** | Click two points, show distance | No | MEDIUM | Very High | Raycasting (already have) + line geometry + label. Essential for architecture/engineering clients. |
| 15 | **Guided annotation tours** | Sequential walkthrough with camera animation | No | MEDIUM | High | Extend existing annotation system. Add tween.js for camera interpolation. Auto-play with configurable duration per step. |
| 16 | **Matcap rendering mode** | Clay/form-study visualization | No | LOW | Medium | `MeshMatcapMaterial`. Add 3-5 preset matcap textures. Good for mesh topology review. |
| 17 | **Model inspector panel** | Vertex/face/texture count, memory usage | No | LOW | Medium | Traverse scene graph, count geometry stats. Display in sidebar. |
| 18 | **Angle measurement** | Three-point angle calculation | No | MEDIUM | High | Extension of distance measurement. Click 3 points, calculate and display angle. |
| 19 | **Camera position presets / saved viewpoints** | Named camera positions, smooth transitions | No | MEDIUM | Medium-High | Save camera pos/target/up, tween between them. Store in archive metadata. |
| 20 | **Outline / selection highlight** | Glow effect on hovered/selected objects | No | LOW-MEDIUM | Medium | `OutlinePass` in EffectComposer. Better visual feedback for object interaction. |

**Estimated total effort for Tier 2: ~40-60 hours**
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
| 26 | **Normal map visualization** | Display normals as RGB | No | LOW | Low-Medium | Custom shader or `VertexNormalsHelper`. Diagnostic tool. |
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
| 40 | **LOD (level of detail)** | Auto-simplify by camera distance | No | HIGH | Medium | `THREE.LOD` class exists but requires pre-simplified meshes. Need mesh decimation. |

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
| Screenshot capture | 1024x1024 JPEG, viewfinder preview, thumbnail grid, archive `/screenshots/` export | Full |
| Screenshot (for archives) | Canvas capture for archive thumbnails | Full |
| URL sharing with state | URL parameters for scene config | Full |
| Embed/sharing controls | Share dialog with link builder | Partial |
| Vertex color display | Point cloud vertex colors | Full |
| Loading progress | Overlay with progress bar | Full |
| Responsive design | Desktop + mobile/kiosk layouts | Full |
| Camera reset | Reset to default + fit-to-view | Full |
| Multiple light controls | 4 lights with independent intensity sliders | Full |

---

## Implementation Roadmap Summary

```
Phase 1 (Tier 1):  ~15-25 hrs  →  60% visual parity  [IN PROGRESS — 7/10 done]
  ✅ Tone mapping, HDR/IBL, env-as-background, shadows, shadow catcher
  ✅ Background image loading (bonus, not in Sketchfab)
  ✅ Auto-rotate (toolbar toggle, kiosk default-on)
  ✅ Screenshot capture (viewfinder preview, thumbnail grid, archive export)
  ⬜ Camera constraints, FOV, ortho view

Phase 2 (Tier 2):  ~40-60 hrs  →  85% functional parity
  - SSAO, bloom, clipping planes, measurement tools,
    guided tours, matcap, inspector, saved viewpoints, outlines

Phase 3 (Tier 3):  ~25-35 hrs  →  90% polish parity
  - DOF, color grading, vignette, diagnostic overlays,
    unlit mode, area measurement

Phase 4 (Tier 4):  ~80-120 hrs →  95% feature parity
  - Section box, animation system, exploded view,
    scene tree, material editor, video export

Phase 5 (Tier 5):  ~60-100 hrs →  ~98% parity (diminishing returns)
  - VR/AR, spatial audio, SSS, viewer API, analytics
```

**Total estimated effort to full parity: ~220-340 hours**
**Recommended stopping point: End of Phase 2 (~55-85 hours) for 85% parity**

---

## CDN Dependencies Needed

All new features use Three.js addons available via esm.sh. Add to `index.html` import map:

```javascript
// Phase 1 — HDR environment maps
"three/addons/loaders/RGBELoader.js": "https://esm.sh/three@0.170.0/examples/jsm/loaders/RGBELoader.js",

// Phase 2 — Post-processing
"three/addons/postprocessing/EffectComposer.js": "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/EffectComposer.js",
"three/addons/postprocessing/RenderPass.js": "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/RenderPass.js",
"three/addons/postprocessing/UnrealBloomPass.js": "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/UnrealBloomPass.js",
"three/addons/postprocessing/SSAOPass.js": "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/SSAOPass.js",
"three/addons/postprocessing/OutputPass.js": "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/OutputPass.js",
"three/addons/postprocessing/OutlinePass.js": "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/OutlinePass.js",
"three/addons/postprocessing/BokehPass.js": "https://esm.sh/three@0.170.0/examples/jsm/postprocessing/BokehPass.js",

// Phase 2 — Camera animation
"@tweenjs/tween.js": "https://esm.sh/@tweenjs/tween.js@25.0.0"
```

Remember: any new CDN deps must also be added to `kiosk-viewer.js` `CDN_DEPS` for offline kiosk support.

---

## Key Architectural Considerations

1. **Post-processing pipeline**: Introducing `EffectComposer` changes the render loop from `renderer.render(scene, camera)` to `composer.render()`. This affects the dual-canvas split view and kiosk mode. Plan this carefully.

2. **Kiosk mode**: Every new CDN dependency increases the kiosk HTML file size. HDR environment textures could add significant bulk — consider low-res HDR (512x256) for kiosk or making environments optional.

3. **Gaussian splat compatibility**: Spark.js renders splats in its own pass. Post-processing effects (SSAO, bloom) may not apply to splats correctly. Test early.

4. **Performance budget**: SSAO + bloom together cost ~30% FPS. Add quality presets (Low/Medium/High) that toggle expensive effects.

5. **No build step**: All addons must work as ES modules from CDN. Verify each import resolves correctly before committing to a feature.
