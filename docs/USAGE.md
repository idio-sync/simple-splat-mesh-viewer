# Usage Guide

## Loading Files

**From the UI**: Use the Load Files panel to load assets from local files or URLs. Each asset type (Splat, Model, Point Cloud, Archive) has "From File" and "From URL" buttons.

**From URL parameters**: Pass file URLs directly in the address bar (see [Configuration](CONFIGURATION.md#url-parameters)).

**From an archive**: Loading a `.a3d` or `.a3z` file automatically extracts and displays all bundled assets with their saved transforms, metadata, and annotations.

## Display Modes

| Mode | Description |
|------|-------------|
| **Splat** | Show only the Gaussian splat |
| **Model** | Show only the 3D model (point cloud follows model visibility) |
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
- **Save Alignment** — Downloads transform data as a JSON file
- **Load Alignment** — Applies transforms from a saved JSON file or URL
- **Reset All** — Resets all objects to origin with default scale

## Annotations

Press `A` or click the annotation toolbar button to enter placement mode, then click on any 3D surface to create an annotation.

Each annotation stores:
- Title and description (supports markdown with inline images)
- 3D position on the surface
- Camera viewpoint (position + target) for restoring the view
- Optional image attachments stored inside the archive

Annotations appear as numbered markers in the 3D view and as chips in a bottom bar. Markers are **depth-aware** — they fade when the annotated surface faces away from the camera, reducing visual clutter. In the kiosk viewer, selecting a marker draws an SVG connecting line to its popup.

Annotations are saved inside archive containers and persist across sessions via localStorage. Images referenced in annotation descriptions use an `asset:images/filename.ext` protocol that resolves to blob URLs at runtime.

## Scene Settings

- **Grid** — Toggle a reference grid
- **Background color** — Choose from presets (dark blue, near black, grays, light gray) or pick a custom color
- **Background image** — Load a background image from file or URL; clears when switching to environment-as-background
- **Lighting** — Adjust ambient, hemisphere, and two directional lights (affects models and point clouds only)
- **Tone mapping** — 6 modes: None (default), Linear, Reinhard, Cineon, ACESFilmic, AgX. Exposure slider (0.1–3.0). Default is None for neutral rendering; opt-in to cinematic looks
- **HDR environment maps (IBL)** — 3 built-in presets (Outdoor, Studio, Sunset) plus load from `.hdr` file or URL. Provides image-based lighting for realistic reflections and ambient light
- **Environment as background** — Toggle to display the HDR environment map as a skybox behind the scene (mutually exclusive with solid color and background image)
- **Shadows** — Toggle shadow casting with PCFSoftShadowMap (2048px). Automatically creates a shadow catcher ground plane with adjustable opacity (0.05–1.0). Auto-enabled in kiosk mode

## Screenshots

- **Capture Screenshot** — Captures a 1024x1024 JPEG of the current viewport. Screenshots appear as thumbnails below the button with a red X to delete
- **Set Archive Preview Image** — Opens a viewfinder overlay showing the square crop region. Capture from the viewfinder to override the automatic preview generated during archive export
- **Archive export** — All captured screenshots are bundled into the archive's `/screenshots/` directory on export

## Asset-Specific Settings

**Splat**: Scale, position, rotation

**Model**: Scale, opacity, wireframe toggle, position, rotation

**Point Cloud**: Scale, point size, opacity, position, rotation

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
| Fly Camera | Switch to first-person fly camera |
| Auto-Rotate | Toggle turntable auto-rotation (disabled by default in main app) |
| Toggle Annotations | Show/hide annotation markers (visible when annotations exist) |
| Export Archive | Export the current scene as an .a3d or .a3z archive |
| Download Viewer | Generate a self-contained offline kiosk HTML file |
