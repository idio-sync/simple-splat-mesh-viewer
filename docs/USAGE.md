# Usage Guide

## Loading Files

**From the UI**: Use the Load Files panel to load assets from local files or URLs. Each asset type (Splat, Model, Point Cloud, Drawing, Archive) has "From File" and "From URL" buttons.

**From URL parameters**: Pass file URLs directly in the address bar (see [Configuration](CONFIGURATION.md#url-parameters)).

**From an archive**: Loading a `.a3d` or `.a3z` file automatically extracts and displays all bundled assets with their saved transforms, metadata, and annotations.

**Asset types**:
- **Splat** — Gaussian splat (`.splat`, `.ply`, `.sog`, `.sogz`)
- **Model** — 3D mesh (`.glb`, `.obj`)
- **Point Cloud** — E57 point cloud (`.e57`)
- **Drawing** — 2D/3D CAD drawing (`.dxf`); load from file or URL like any other asset type

## Display Modes

| Mode | Description |
|------|-------------|
| **Splat** | Show only the Gaussian splat |
| **Model** | Show only the 3D model |
| **Point Cloud** | Show only the point cloud |
| **Both** | Overlay all assets for comparison |
| **Split** | Side-by-side: splat on left, model + point cloud on right, with synced camera |

## Camera Controls

### Orbit Mode (default)

- **Left-click + drag** — Rotate view
- **Right-click + drag** — Pan view
- **Scroll wheel** — Zoom in/out
- **Reset Camera** button — Return to initial position
- **Fit to View** button — Auto-frame all loaded content

### Fly Mode (press `F` or click the fly camera toolbar button)

- **WASD** — Move forward/left/backward/right
- **Q / E** — Move down / up
- **Right-click + drag** — Mouse look (yaw/pitch)
- **Shift** — Fast movement (3x speed)
- **Ctrl** — Slow movement (0.25x speed)
- **Scroll wheel** — Adjust movement speed
- **Escape** — Exit fly mode

## Alignment

- **Auto Align** — Aligns objects using bounding box center-of-mass matching
- **ICP Align** — Iterative Closest Point algorithm for precise point-to-point registration (works best when objects are roughly aligned first)
- **Landmark Alignment (N-point)** — Interactive point-pair matching for precise manual alignment:
  1. Click the landmark alignment button to enter the tool
  2. Click a point on the anchor object, then the matching point on the mover object — this is one pair
  3. Add 3 or more pairs; the transformation previews live as each pair is added
  4. RMSE quality metric updates after each pair
  5. Press Ctrl+Z (or the Undo button) to remove the last placed point
  6. Click Apply to commit the alignment
- **Save Alignment** — Downloads transform data as a JSON file
- **Load Alignment** — Applies transforms from a saved JSON file or URL
- **Reset All** — Resets all objects to origin with default scale

## Measurement & Analysis Tools

### Distance Measurement

- Click the ruler (Measurement) toolbar button to enter measurement mode
- Click two points on any loaded mesh surface to measure point-to-point distance
- A 3D line overlay with DOM labels shows each measurement
- Units are configurable: m, cm, mm, in, ft
- Measurements are session-only — they are not saved to archives
- Multiple measurements can be active simultaneously; each has an × button to remove it

### Cross-Section

- Click the Cross-Section toolbar button to activate a clipping plane
- The plane can be oriented on any axis and repositioned along it
- Everything on one side of the plane is hidden, exposing interior geometry
- Toggle the clipping plane on/off without losing its current position

## Annotations

Press `A` or click the annotation toolbar button to enter placement mode, then click on any 3D surface to create an annotation.

Each annotation stores:
- Title and description (supports markdown with inline images)
- 3D position on the surface
- Camera viewpoint (position + target) for restoring the view
- Optional image attachments stored inside the archive

Annotations appear as numbered markers in the 3D view and as chips in a bottom bar. Markers are **depth-aware** — they fade when the annotated surface faces away from the camera, reducing visual clutter. In the kiosk viewer, selecting a marker draws an SVG connecting line to its popup.

Annotations are saved inside archive containers and persist across sessions via localStorage. Images referenced in annotation descriptions use an `asset:images/filename.ext` protocol that resolves to blob URLs at runtime.

Additional annotation features:
- **Smooth camera animation** — clicking an annotation chip navigates the camera to the saved viewpoint with a smooth animated transition; the viewport fades during the move
- **Hero image** — annotations can include a hero image displayed prominently above the description text
- **Lightbox** — clicking any inline image in an annotation opens a full-screen lightbox viewer
- **YouTube embeds** — a bare YouTube URL on its own line in an annotation description renders as an embedded video player (uses youtube-nocookie.com)

## Walkthrough

A walkthrough is a guided sequence of camera stops that plays back automatically. Walkthroughs are saved in the archive and play in both the editor and kiosk viewer.

**Creating a walkthrough (editor)**:
1. Open the Walkthrough panel in the properties pane
2. Click "Add Stop" to capture the current camera position as a stop
3. Each stop has: title, optional annotation link, transition type (fly/fade/cut), transition duration, and dwell time
4. Stops can be reordered by drag-and-drop
5. Click Preview to play back the sequence in the editor

**Playback**:
- Auto-play starts the walkthrough automatically when the archive loads (configurable)
- Loop option replays the sequence continuously
- Play/pause button in the kiosk viewer controls playback
- Respects `prefers-reduced-motion` — skips animations for accessibility

**Transition types**:

| Type | Behaviour |
|------|-----------|
| `fly` | Smooth camera animation from current position to stop |
| `fade` | Fades to black, cuts camera, fades back in |
| `cut` | Instant camera jump with no animation |

## Scene Settings

- **Grid** — Toggle a reference grid
- **Background color** — Choose from presets (dark blue, near black, grays, light gray) or pick a custom color
- **Background image** — Load a background image from file or URL; clears when switching to environment-as-background
- **Lighting** — Adjust ambient, hemisphere, and two directional lights (affects models and point clouds only)
- **Tone mapping** — 6 modes: None (default), Linear, Reinhard, Cineon, ACESFilmic, AgX. Exposure slider (0.1–3.0). Default is None for neutral rendering; opt-in to cinematic looks
- **HDR environment maps (IBL)** — 3 built-in presets (Outdoor, Studio, Sunset) plus load from `.hdr` file or URL. Provides image-based lighting for realistic reflections and ambient light
- **Environment as background** — Toggle to display the HDR environment map as a skybox behind the scene (mutually exclusive with solid color and background image)
- **Shadows** — Toggle shadow casting with VSM (Variance Shadow Maps, 2048px). Automatically creates a shadow catcher ground plane with adjustable opacity (0.05–1.0). Auto-enabled in kiosk mode

## Screenshots

- **Capture Screenshot** — Captures a 1024x1024 JPEG of the current viewport. Screenshots appear as thumbnails below the button with a red X to delete
- **Set Archive Preview Image** — Opens a viewfinder overlay showing the square crop region. Capture from the viewfinder to override the automatic preview generated during archive export
- **Archive export** — All captured screenshots are bundled into the archive's `/screenshots/` directory on export

## Asset-Specific Settings

**Splat**: Scale, position, rotation

**Model**: Scale, opacity, wireframe toggle, position, rotation

**Point Cloud**: Scale, point size, opacity, position, rotation

## Transform Controls

- **Rotation pivot** — Toggle between rotating around the object's own center vs. the world origin
- **Scale lock** — When enabled, scaling adjusts all three axes proportionally
- **Center at origin** — Button that snaps the object's position to the world origin

## Metadata

The metadata sidebar (press `M` or click the Metadata toolbar button) provides Dublin Core-compatible fields for documenting the scene:

- **Tags** — Appear as chips in the kiosk viewer below the project description
- **Coordinates** — Has an interactive **map picker**: clicking it opens an OpenStreetMap modal where you can click to place a pin or search by name; coordinates are filled in automatically
- **Metadata completeness profile** — A selector (Basic / Standard / Archival) controls which metadata tabs and fields are visible. Basic shows essential fields only; Archival shows all preservation fields

Metadata is saved in archives and displayed read-only in the kiosk viewer.

## Keyboard Shortcuts

| Key | Action |
|-----|--------|
| `W` | Translate mode |
| `E` | Rotate mode |
| `R` | Scale mode |
| `A` | Toggle annotation placement mode |
| `M` | Toggle metadata sidebar |
| `F` | Toggle fly camera mode |
| `Escape` | Deselect object / exit fly mode / close popups |

## Toolbar

The left-side toolbar provides quick access to:

| Button | Action |
|--------|--------|
| Toggle Controls (hamburger icon) | Show/hide the controls panel |
| Metadata | Open the metadata sidebar for viewing or editing |
| Annotate | Enter annotation placement mode |
| Toggle Annotations | Show/hide annotation markers (visible when annotations exist) |
| Fly Camera | Switch to first-person fly camera |
| Auto-Rotate | Toggle turntable auto-rotation (disabled by default in main app) |
| Load Full Resolution | Swap LOD proxy mesh for the full-resolution version (appears only when a proxy mesh is loaded) |
| Export Archive | Export the current scene as an .a3d or .a3z archive |
| Fullscreen | Toggle browser fullscreen mode |
| Reset Orbit Center | Reset the orbit pivot point to the bounding box center of loaded meshes/point clouds |
| Cross-Section | Toggle cross-section clipping plane tool |
| Measurement | Toggle point-to-point distance measurement tool |
| Walkthrough | Open the walkthrough editor/player panel |
