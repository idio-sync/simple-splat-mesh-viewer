# Offline Kiosk Viewer

The **Download Viewer** button generates a self-contained HTML file (~1 MB before archive data) that works entirely offline with zero network access. This is designed for delivering 3D scan data to clients who may not have internet access or technical expertise.

## How It Works

1. The generator fetches all CDN dependencies (Three.js, Spark.js, fflate) and application modules at export time
2. Everything is base64-encoded and embedded inside a single HTML file
3. Import specifiers are rewritten to blob URLs at runtime so ES modules work without a server
4. The user opens the HTML file in any modern browser and loads an `.a3d`/`.a3z` archive via file picker or drag-and-drop

## Capabilities

- Full 3D rendering (splats, meshes, point clouds) with display mode switching
- Orbit and fly camera controls
- Auto-rotate turntable (enabled by default, auto-disables on manual interaction)
- Shadow casting with shadow catcher ground plane
- Annotation viewing with depth-aware markers, popups, and connecting lines
- Metadata sidebar (view-only)
- Scene settings (background color, lighting, grid)
- Asset-specific controls (opacity, wireframe, point size)
- Lazy asset loading — the manifest loads first, then individual assets load on demand with inline progress indicators

## Limitations

- The kiosk viewer is read-only — no archive creation, metadata editing, or alignment tools
- The embedded JavaScript stack (Three.js 0.170.0, Spark.js 0.1.10) is frozen at export time and may eventually become incompatible with future browsers
- The archive's raw data files (GLB, PLY, E57) remain the authoritative preservation copies; the kiosk viewer is a convenience access layer
