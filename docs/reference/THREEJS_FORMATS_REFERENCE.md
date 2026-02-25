# Three.js Format Reference for Direct Dimensions Inc.

A comprehensive catalog of every 3D file format loadable in Three.js — core, official addons, and community ecosystem — ranked by relevance to DDI's cultural heritage, precision scanning, and client delivery work.

**Ranking Scale (1–10):** How useful each format is for DDI specifically, considering your client base (Smithsonian, Lockheed Martin, museums), your workflows (micron-level 3D scanning, photogrammetry, archival documentation), and your web-based presentation goals (Vitrine3D, interactive project showcases).

**Status Key:** Formats marked with `✅` are currently loaded and working in Vitrine3D. All others are not yet integrated.

---

## 1. Three.js Core Loaders

These ship with the core library (`src/loaders/`) and require no additional imports.

| DDI | Loader | Format(s) | Description |
|-----|--------|-----------|-------------|
| 9 ✅ | **TextureLoader** | `.png`, `.jpg`, `.webp`, `.gif`, `.bmp` | Standard image-based texture loading. Essential for any textured 3D content — scan textures, orthophotos, UV maps. |
| 6 | **FileLoader** | Any (text, arraybuffer, blob) | Generic file loader. The backbone for building custom loaders — relevant if DDI develops proprietary archive formats. |
| 5 | **CubeTextureLoader** | 6× image files | Loads six images as a cubemap for environment mapping and skyboxes. Useful for placing scanned objects in contextual environments. |
| 4 | **ImageLoader** | Standard image formats | Raw image loading (returns HTMLImageElement). Foundation for custom texture workflows. |
| 4 | **ImageBitmapLoader** | Standard image formats | Faster alternative to ImageLoader using ImageBitmap API. Better for performance-critical applications. |
| 3 | **ObjectLoader** | `.json` (Three.js scene format) | Loads Three.js's native JSON serialization of scenes, including geometry, materials, lights, and cameras. Used for saving/restoring editor state. |
| 3 | **BufferGeometryLoader** | `.json` (Three.js geometry) | Loads serialized BufferGeometry objects. Useful for pre-processed geometry data. |
| 3 | **AudioLoader** | `.mp3`, `.ogg`, `.wav` | Loads audio files for spatial audio in 3D scenes. Could enhance immersive heritage walkthroughs. |
| 2 | **MaterialLoader** | `.json` (Three.js materials) | Loads serialized Three.js material definitions. |

---

## 2. Official Addon Loaders

Located in `examples/jsm/loaders/`. Maintained by the Three.js team and community contributors. These are the standard, well-tested loaders.

### 2.1 Full Scene Formats

These carry geometry, materials, textures, animations, lights, and cameras in a single package.

| DDI | Loader | Format(s) | Description |
|-----|--------|-----------|-------------|
| **10** ✅ | **GLTFLoader** | `.gltf`, `.glb` | The recommended universal 3D exchange format. Compact, fast to load, supports PBR materials, animations, morph targets, skinning, lights, cameras. The standard output for web delivery of scan data. Supports Draco and meshopt compression via plugins. |
| 6 | **FBXLoader** | `.fbx` (ASCII & binary, v7.0+) | Industry standard from Autodesk. Full scene hierarchies with skeletal animations, blend shapes, embedded textures. Common export from Maya, 3ds Max, Mixamo. Relevant when receiving client assets or integrating with animation pipelines. |
| 5 | **ColladaLoader** | `.dae` | XML-based Khronos standard. Comprehensive feature set including kinematics and skinning. Legacy but still found in older archives, museum collections, and some photogrammetry exports. |
| 4 | **VRMLLoader** | `.wrl` (VRML 2.0) | Legacy Web3D format from the 1990s. Text-based with scene graphs. Occasionally encountered in older digital heritage archives and government datasets. |
| 4 | **KMZLoader** | `.kmz` | Compressed Collada bundled with Google Earth KML data. Relevant for geospatially-referenced heritage sites and integration with mapping platforms. |

### 2.2 Mesh & Geometry Formats

| DDI | Loader | Format(s) | Description |
|-----|--------|-----------|-------------|
| **9** | **PLYLoader** | `.ply` (Stanford format) | Flexible format supporting both mesh and point cloud data with vertex colors, normals, and custom properties. Direct output from many 3D scanners and photogrammetry pipelines. Critical for DDI's scan-to-web workflow. |
| **8** ✅ | **OBJLoader** | `.obj` | Ubiquitous plain-text mesh format. Widespread tool support. No animations or advanced materials, but universally readable. Common export from scanning software. |
| **8** ✅ | **MTLLoader** | `.mtl` | Companion material file for OBJ. Defines colors, textures, and basic material properties. Always paired with OBJLoader. |
| **8** ✅ | **STLLoader** | `.stl` (ASCII & binary) | Standard for 3D printing and CAD. Geometry only — no color, no materials. Common deliverable for engineering clients like Lockheed Martin. DDI likely receives and delivers STL regularly. |
| 5 | **3MFLoader** | `.3mf` | Modern 3D Manufacturing Format. Supports color, materials, and multi-object assemblies. Successor to STL for 3D printing with richer data. |
| 5 | **3DMLoader** | `.3dm` (Rhino/openNURBS) | Loads Rhino 3D files directly via rhino3dm.js WASM module. Preserves NURBS surfaces, layers, and object attributes. Valuable if DDI works with architectural clients using Rhino. |
| 4 | **SVGLoader** | `.svg` | Converts 2D SVG vector paths into 3D extruded geometry. Useful for generating 3D text, logos, floor plan extrusions, and architectural diagrams from vector drawings. |
| 3 | **AMFLoader** | `.amf` | Additive Manufacturing File Format (XML-based). Supports color, materials, lattice structures. Less common than 3MF but still used in some manufacturing workflows. |
| 3 | **TDSLoader** | `.3ds` | Legacy 3D Studio format. Limited to 65,536 vertices per mesh. Occasionally found in older archives and legacy asset libraries. |
| 2 | **GCodeLoader** | `.gcode` | CNC/3D printer toolpath visualization. Renders layer-by-layer print paths. Niche but relevant if DDI ever does manufacturing visualization. |
| 1 | **LDrawLoader** | LDraw parts library | LEGO brick format with massive parts library. Highly specific — unlikely DDI use unless documenting toy/model collections. |

### 2.3 Point Cloud Formats

| DDI | Loader | Format(s) | Description |
|-----|--------|-----------|-------------|
| 7 | **PCDLoader** | `.pcd` | Point Cloud Data format from the Point Cloud Library (PCL). Supports ASCII, binary, and compressed binary with fields for position, color, normals, intensity. Common in robotics and some scanning pipelines. |
| 5 | **XYZLoader** | `.xyz` | Minimal plain-text point cloud format (x, y, z per line, optional color). Simple but limited. Quick-and-dirty point cloud visualization. |
| 4 | **VTKLoader** | `.vtk` | Visualization Toolkit format for scientific data. Supports structured/unstructured grids, vertex colors. Used in scientific visualization and some engineering analysis outputs. |

### 2.4 Animation & Character Formats

| DDI | Loader | Format(s) | Description |
|-----|--------|-----------|-------------|
| 2 | **BVHLoader** | `.bvh` | Biovision Hierarchy — motion capture skeletal animation data. Standard for mocap. Could be relevant if DDI ever does performance capture or animated heritage recreations. |
| 1 | **MD2Loader** | `.md2` | Quake II model format with vertex-based animations. Legacy game format, no modern use case for DDI. |
| 1 | **MMDLoader** | `.pmd`, `.pmx`, `.vmd` | MikuMikuDance format. Japanese animation/VTuber ecosystem. Unlikely DDI use. |

### 2.5 Volume & Medical Imaging

| DDI | Loader | Format(s) | Description |
|-----|--------|-----------|-------------|
| 3 | **NRRDLoader** | `.nrrd` | Nearly Raw Raster Data — voxel volumes for medical/scientific imaging. Could be relevant if DDI ever does CT scanning visualization or volumetric heritage analysis (e.g., scanning inside sealed artifacts). |

### 2.6 Texture & Image Formats

| DDI | Loader | Format(s) | Description |
|-----|--------|-----------|-------------|
| **8** | **KTX2Loader** | `.ktx2` | Khronos Texture Container v2 with GPU-compressed textures (Basis Universal). Dramatically reduces texture memory and load times. Critical for mobile/web performance with large scan textures. |
| 7 | **EXRLoader** | `.exr` (OpenEXR) | High dynamic range image format. 32-bit float per channel. Essential for environment maps, light probes, and HDR-based PBR rendering. Elevates scan presentation quality significantly. |
| 7 ✅ | **RGBELoader** | `.hdr` (Radiance RGBE) | HDR environment map format. Widely used for image-based lighting. Same use case as EXR but more common in web workflows. |
| 6 | **HDRCubeTextureLoader** | `.hdr` cubemaps | Loads six HDR images as environment cubemap. For high-quality reflections and lighting. |
| 5 | **IESLoader** | `.ies` | Photometric light profiles from real light fixtures. Enables physically accurate lighting in architectural visualization of scanned spaces. |
| 4 | **TGALoader** | `.tga` | Targa image format. Legacy but still exported by some 3D software and scanners. |
| 3 | **KTXLoader** | `.ktx` | Legacy Khronos Texture format. Superseded by KTX2 but still encountered. |
| 3 | **DDSLoader** | `.dds` | DirectDraw Surface — GPU-compressed textures (DXT/BC formats). Common in game engines, less so on web. |
| 2 | **LUT3dlLoader** | `.3dl` | 3D Look-Up Table for color grading. Post-processing effect for cinematic presentation of scan data. |
| 2 | **LUTCubeLoader** | `.cube` | Alternative LUT format (Adobe/DaVinci standard). Same use case as .3dl. |

### 2.7 Other Official Loaders

| DDI | Loader | Format(s) | Description |
|-----|--------|-----------|-------------|
| **9** ✅ | **DRACOLoader** | `.drc` (Draco compressed geometry) | Google's mesh compression. Typically used as a plugin for GLTFLoader to dramatically reduce file sizes. Essential for web delivery of large scan meshes. |
| 5 | **FontLoader** | Three.js JSON font | Loads fonts for 3D text geometry. Useful for labels, annotations, and measurement displays in scan viewers. |
| 3 | **LottieLoader** | Lottie `.json` animations | Renders Lottie animations as textures. Could be used for animated UI elements, loading indicators, or branded overlays in viewers. |
| 1 | **PDBLoader** | `.pdb` | Protein Data Bank — molecular structure visualization. No DDI use unless scanning molecular models for science museums. |
| 1 | **VOXLoader** | `.vox` | MagicaVoxel format — voxel-based 3D models. Niche creative tool, no scanning relevance. |

### 2.8 Official Exporters

| DDI | Exporter | Format(s) | Description |
|-----|----------|-----------|-------------|
| **9** | **GLTFExporter** | `.gltf`, `.glb` | Export Three.js scenes to glTF. Enables round-trip editing and re-packaging scan data for delivery. |
| **8** | **USDZExporter** | `.usdz` | Export to Apple's USDZ for AR Quick Look on iOS/macOS. Enables "view in your space" AR experiences for scanned objects — excellent for museum clients. |
| 7 | **OBJExporter** | `.obj` | Export meshes to OBJ. Universal compatibility for client delivery. |
| 7 | **PLYExporter** | `.ply` | Export point clouds and meshes to PLY. Useful for archival export. |
| 7 | **STLExporter** | `.stl` | Export meshes to STL. For 3D printing deliverables. |
| 6 | **DRACOExporter** | `.drc` | Export Draco-compressed geometry. Standalone compression output. |
| 5 | **KTX2Exporter** | `.ktx2` | Export GPU-compressed textures. For optimized asset pipelines. |
| 4 | **EXRExporter** | `.exr` | Export render targets to OpenEXR. For HDR output. |
| 1 | **MMDExporter** | MMD format | Export to MikuMikuDance. No DDI use. |

---

## 3. Community / Third-Party Loaders

These are maintained outside the Three.js repository. Quality, maintenance status, and API stability vary.

### 3.1 Gaussian Splat / Radiance Field Renderers

The bleeding edge of 3D capture visualization — directly relevant to DDI's photogrammetry and NeRF/splat workflows.

| DDI | Package | Format(s) | Description |
|-----|---------|-----------|-------------|
| **10** ✅ | **@sparkjsdev/spark** | `.ply`, `.spz`, `.splat`, `.ksplat`, `.sog` | Advanced Gaussian splat renderer for Three.js. Fast rendering on all devices, programmable dynamic effects, wide format support. Integrates as a SplatMesh directly into standard Three.js scenes. DDI is already using this. |
| **9** | **@mkkellogg/gaussian-splats-3d** | `.ply`, `.splat`, `.ksplat` | Full-featured splat viewer with custom octree culling, WASM SIMD sorting, and progressive loading. Mature and well-documented. Good alternative/complement to Spark. |
| 5 | **@lumaai/luma-web** | Luma AI captures | Luma AI's proprietary web renderer for their capture format. Tied to Luma's ecosystem but produces stunning results. Relevant if DDI or clients use Luma for capture. |
| 4 | **@zappar/three-gaussian-splat** | `.splat` | Simpler splat renderer with masking primitives (sphere/plane) for cropping splat scenes. Useful for isolating objects within larger captures. |

### 3.2 Massive Point Cloud Viewers

Critical for DDI's LiDAR and large-scale scanning output where standard loaders choke on millions of points.

| DDI | Package | Format(s) | Description |
|-----|---------|-----------|-------------|
| **9** | **@pnext/three-loader** | Potree format (`cloud.js`) | Modular Potree core for Three.js. Octree-based level-of-detail streaming for massive point clouds. Handles billions of points with frustum culling and dynamic loading. |
| **9** | **potree-loader** | Potree v2 (`metadata.json`) | Fork supporting PotreeConverter 2.0 single-file format with WebGL2. Maintained for heritage archive use cases. |
| **8** | **potree-core** | Potree format, LAS, LAZ, binary | Standalone Potree core library. Supports LAS/LAZ point clouds from LiDAR. The most complete Potree integration for custom Three.js apps. |
| **8** | **Potree** (full viewer) | LAS, LAZ, E57 (via converter), binary | Complete point cloud viewer with measurement tools, elevation profiles, cross-sections. Overkill as a library but excellent reference. E57 support via PotreeConverter is relevant for DDI's FARO scanner output. |
| 7 | **copc.js** | COPC (Cloud Optimized Point Cloud) | Streaming reader for LAZ 1.4 COPC files. Enables range-request-based streaming without pre-conversion. Cutting edge for large scan delivery. |

### 3.3 3D Tiles / Geospatial Streaming

For large-scale, geospatially-referenced datasets — buildings, cityscapes, terrain.

| DDI | Package | Format(s) | Description |
|-----|---------|-----------|-------------|
| **8** | **3d-tiles-renderer** (gkjohnson) | 3D Tiles (`.b3dm`, `.i3dm`, `.pnts`, `.cmpt`), Google 3D Tiles | Most actively maintained 3D Tiles implementation for Three.js. Supports Cesium ION, Google Photorealistic 3D Tiles. Hierarchical LOD for massive datasets. Excellent for contextualizing DDI's building scans in geographic context. |
| 7 | **three-loader-3dtiles** (NY Times) | 3D Tiles (`.b3dm`, point clouds) | Uses loaders.gl under the hood. Developed for journalism but applicable to heritage. Supports photogrammetry and LiDAR exported as 3D Tiles from RealityCapture or Cesium ION. |

### 3.4 GIS / Geographic Visualization

| DDI | Package | Format(s) | Description |
|-----|---------|-----------|-------------|
| 6 | **three-geojson** (gkjohnson) | `.geojson`, WKT | Converts GeoJSON/WKT geographic features into Three.js meshes and lines. Supports ellipsoid projection, altitude values. Good for site plans and geographic context around scanned buildings. |
| 6 | **three-geo** | Mapbox DEM tiles | Generates satellite-textured 3D terrain from GPS coordinates using Mapbox. Drop in coordinates, get a terrain mesh. Excellent for contextualizing heritage sites. |
| 5 | **geo-three** | Map tiles (Mapbox, Google, Bing, OSM, MapTiler, HERE) | Tile-based 3D map layers with LOD. Multiple provider support. For embedding scanned buildings into real-world map contexts. |
| 5 | **cityjson-threejs-loader** | CityJSON, CityJSONSeq | Loads 3D city model data. Supports raycasting for object identification. Relevant for urban heritage documentation and city-scale projects. |
| 5 | **threebox / threebox-plugin** | GeoJSON + 3D models on Mapbox GL | Bridges Three.js and Mapbox GL JS. Place 3D scanned models on interactive maps with real sun lighting and terrain sync. |
| 3 | **THREE.Terrain** | Heightmaps (PNG, procedural) | Procedural and heightmap-based terrain generation. Useful for creating context around scanned heritage sites. |

### 3.5 CAD / Engineering Formats

| DDI | Package | Format(s) | Description |
|-----|---------|-----------|-------------|
| **8** | **opencascade.js** | `.step`, `.stp`, `.iges`, `.igs`, `.brep` | WASM port of the OpenCascade CAD kernel. Tessellates B-Rep solid models into Three.js-compatible meshes. Handles the parametric CAD formats that DDI's engineering clients (Lockheed Martin) commonly use. Heavy WASM bundle but powerful. |
| 6 ✅ | **three-dxf-loader** | `.dxf` | AutoCAD DXF 2D/3D drawing exchange format. Loads entities like lines, arcs, circles, polylines, 3D faces. Relevant for architectural documentation and as-built drawings. |
| 5 | **CAD Exchanger SDK** (commercial) | `.step`, `.jt`, `.iges`, `.catia`, `.solidworks`, many more | Commercial conversion service. Converts virtually any CAD format to glTF/OBJ for Three.js. Most comprehensive CAD support available but requires licensing. |

### 3.6 BIM / Architecture

| DDI | Package | Format(s) | Description |
|-----|---------|-----------|-------------|
| **8** | **web-ifc-three** (ThatOpen/IFC.js) | `.ifc` | Official IFC Loader for Three.js. Loads Building Information Models with full semantic data — walls, doors, windows, MEP systems. Directly relevant for DDI's building documentation work (e.g., Comsat Building). Enables querying building elements from scan data. |

### 3.7 VR Avatars / Characters

| DDI | Package | Format(s) | Description |
|-----|---------|-----------|-------------|
| 2 | **@pixiv/three-vrm** | `.vrm` (VRM 0.x and 1.0) | VRM avatar loader as a GLTFLoader plugin. Handles MToon toon materials, spring bone physics, expression blending, eye gaze. Relevant only if DDI builds interactive heritage experiences with virtual guides. |
| 2 | **three-vrm-animation** | `.vrma` | VRM animation format companion to three-vrm. |

### 3.8 Robotics / Simulation

| DDI | Package | Format(s) | Description |
|-----|---------|-----------|-------------|
| 3 | **urdf-loader** | `.urdf`, `.xacro` | Universal Robot Description Format. Loads robot definitions with articulated joints. Originates from NASA JPL. Relevant if DDI ever does robotic scanning system visualization or works with automated inspection rigs. |
| 2 | **xacro-parser** | `.xacro` | Xacro macro preprocessor for URDF files. Companion to urdf-loader. |

### 3.9 Medical / Scientific Imaging

| DDI | Package | Format(s) | Description |
|-----|---------|-----------|-------------|
| 4 | **ami.js** (FNNDSC) | DICOM, NIfTI, NRRD, MGH/MGZ, TRKI | Full medical imaging toolkit built on Three.js. Volume rendering, MPR views, segmentation overlays. Relevant if DDI does CT/micro-CT scanning of artifacts for museums. |
| 3 | **cornerstone3D** | DICOM series | Medical imaging with GPU-accelerated volume rendering. Enterprise-grade DICOM viewer. Same use case as ami.js but more mature. |
| 1 | **NIfTI-Reader-JS** | `.nii`, `.nii.gz` | Neuroimaging volume loader. Very niche. |

### 3.10 Compression / Streaming Middleware

| DDI | Package | Format(s) | Description |
|-----|---------|-----------|-------------|
| **8** | **meshoptimizer** (via GLTFLoader) | `EXT_meshopt_compression` | GPU-friendly mesh compression for glTF. Alternative to Draco with better decompression performance. Critical for optimizing scan mesh delivery. |
| **8** | **basis_universal** (via KTX2Loader) | `.basis`, `.ktx2` | GPU texture supercompression. Single compressed file transcodes to any GPU format at runtime. Massive bandwidth savings for textured scans. |
| 7 | **@loaders.gl** | Dozens of formats (3D Tiles, LAS, LAZ, PCD, PLY, glTF, etc.) | Universal, framework-agnostic loader library from Uber/vis.gl. Can pipe any supported format into Three.js. Swiss army knife for format support. |

### 3.11 Apple AR / Mobile

| DDI | Package | Format(s) | Description |
|-----|---------|-----------|-------------|
| 7 | **three-usdz-loader** | `.usdz` (import) | Community USDZ importer. Apple's AR format. Combined with the official USDZExporter, enables full round-trip. "View in AR" on iPhone is a powerful museum deliverable. |

### 3.12 Legacy / Niche Community Formats

These appear in older Three.js extension packages or are very specialized.

| DDI | Package | Format(s) | Description |
|-----|---------|-----------|-------------|
| 2 | **AssimpLoader / AssimpJSONLoader** | Assimp JSON export | Loader for Open Asset Import Library's JSON export. Assimp supports 40+ formats, but the JSON intermediate is bulky. Better to convert to glTF directly. |
| 2 | **PRWMLoader** | `.prwm` (Packed Raw WebGL Model) | Minimal binary mesh format optimized for WebGL. Fast loading but no tooling ecosystem. |
| 1 | **AWDLoader** | `.awd` (Away3D) | Away3D engine binary format. Dead ecosystem. |
| 1 | **BabylonLoader** | Babylon.js JSON | Loads Babylon.js scene exports. Cross-engine interop, rarely needed. |
| 1 | **PlayCanvasLoader** | PlayCanvas JSON | PlayCanvas engine format. Same situation as Babylon. |
| 1 | **UTF8Loader** | UTF-8 encoded mesh | Google's experimental compressed mesh format. Abandoned in favor of Draco. |
| 1 | **XLoader** | `.x` (DirectX) | Legacy DirectX model format. Extremely rare in modern workflows. |

---

## 4. Summary: DDI Top 15 Formats

Ranked by combined relevance across DDI's scanning, archival, client delivery, and web presentation workflows:

| Rank | Score | Format / Loader | Primary DDI Use Case |
|------|-------|----------------|---------------------|
| 1 | **10** ✅ | **glTF/GLB** (GLTFLoader) | Universal web delivery, archival, client handoff |
| 2 | **10** ✅ | **Gaussian Splats** (Spark) | Photorealistic scan visualization on web |
| 3 | **9** | **PLY** (PLYLoader) | Direct scanner output, point clouds, colored meshes |
| 4 | **9** ✅ | **Draco** (DRACOLoader) | Compression for web delivery of large meshes |
| 5 | **9** | **Potree** (@pnext/three-loader) | Massive point cloud streaming (LiDAR, FARO) |
| 6 | **9** | **Gaussian Splats** (GaussianSplats3D) | Alternative splat renderer, .ksplat compression |
| 7 | **9** ✅ | **Standard Textures** (TextureLoader) | Scan textures, orthophotos, UV maps |
| 8 | **8** ✅ | **OBJ/MTL** (OBJLoader) | Universal mesh exchange, legacy compatibility |
| 9 | **8** ✅ | **STL** (STLLoader) | Engineering client deliverables, 3D printing |
| 10 | **8** | **KTX2** (KTX2Loader) | GPU-compressed textures for mobile/web performance |
| 11 | **8** | **STEP/IGES** (opencascade.js) | Engineering CAD from clients like Lockheed Martin |
| 12 | **8** | **IFC** (web-ifc-three) | Building documentation (Comsat Building, etc.) |
| 13 | **8** | **3D Tiles** (3d-tiles-renderer) | Large-scale photogrammetry and LiDAR streaming |
| 14 | **8** | **USDZ** (USDZExporter) | "View in AR" on iPhone for museum clients |
| 15 | **8** | **Meshoptimizer / Basis** | Compression pipeline for optimized web delivery |

> **Also supported but not listed above:** E57 point clouds via `three-e57-loader` (1.2.0) + `web-e57` WASM. HDR environment maps via `RGBELoader`. Custom `.a3d`/`.a3z` archive format (ZIP-based, proprietary).

---

## 5. Format Decision Tree for DDI Projects

```
Start: What are you trying to do?
│
├── Deliver scan to client for web viewing?
│   ├── Photorealistic capture → Gaussian Splat (.splat/.spz via Spark)
│   ├── Textured mesh → glTF/GLB (with Draco + KTX2)
│   ├── Point cloud (< 10M points) → PLY via PLYLoader
│   └── Point cloud (> 10M points) → Potree or 3D Tiles
│
├── Deliver to client for their use?
│   ├── CAD/engineering → STEP, IGES, or STL
│   ├── 3D printing → STL or 3MF
│   ├── General 3D → glTF/GLB or OBJ
│   └── AR on iPhone → USDZ
│
├── Archive for long-term preservation?
│   ├── Mesh → glTF/GLB (open standard, Dublin Core metadata via extensions)
│   ├── Point cloud → E57 (via converter) or PLY
│   └── Raw scan → Original scanner format + PLY export
│
├── Present on interactive web page?
│   ├── Single object showcase → glTF with Draco + KTX2
│   ├── Immersive walkthrough → Gaussian splats via Spark
│   ├── Building with context → IFC + 3D Tiles or Potree
│   └── Geographic context → three-geo or 3d-tiles-renderer
│
└── Receive from client?
    ├── CAD files → opencascade.js (STEP/IGES) → convert to glTF
    ├── BIM files → web-ifc-three (IFC)
    ├── Existing scans → PLY, OBJ, or E57 → process normally
    └── Game/animation assets → FBX or glTF
```

---

*Generated February 2026 for Direct Dimensions Inc. internal reference.*
*Covers Three.js r175+ and community packages as of early 2026.*
