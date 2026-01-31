# Gaussian Splat & Mesh Viewer

A simple web-based viewer for comparing Gaussian splat files with traditional 3D models, powered by [Spark](https://sparkjs.dev/) and Three.js. Supports archive containers for bundled splat/mesh distribution.

## Features

- Load and display Gaussian splat files (.ply, .splat, .ksplat, .spz, .sog)
- Load and display 3D models (.glb, .gltf, .obj)
- **Archive container support** (.a3d, .a3z) - Load bundled splat + mesh + metadata from a single file
- Toggle between viewing: Splat only, Model only, or Both overlaid
- **Split view** for side-by-side comparison with synced cameras
- **Transform controls** for individually positioning, rotating, and scaling each object
- **Save/Load alignment** to preserve your transforms as JSON
- **Auto-alignment** with ICP (Iterative Closest Point) algorithm
- Manual position and rotation input fields for precise alignment
- Wireframe mode and adjustable opacity for models
- Orbit camera controls (rotate, pan, zoom)
- FPS counter and mesh statistics
- **Shareable URLs** with embedded alignment data

## Quick Start

### Using Python (simplest)
```bash
cd simple-splat-mesh-viewer
python3 -m http.server 8080
```
Then open http://localhost:8080 in your browser.

### Using Node.js
```bash
npx serve .
```

### Using Docker
```bash
# Build the image
docker build -t splat-mesh-viewer .

# Run with default settings
docker run -p 8080:80 splat-mesh-viewer

# Run with pre-loaded archive
docker run -p 8080:80 \
  -e DEFAULT_ARCHIVE_URL="https://example.com/scene.a3d" \
  splat-mesh-viewer

# Run with pre-loaded files and hidden controls
docker run -p 8080:80 \
  -e DEFAULT_SPLAT_URL="https://example.com/model.ply" \
  -e DEFAULT_MODEL_URL="https://example.com/model.glb" \
  -e SHOW_CONTROLS="false" \
  splat-mesh-viewer
```

## Archive Container Support

The viewer supports archive containers (`.a3d`, `.a3z` files) which bundle splats, meshes, and metadata into a single distributable file. This integrates with the [archive-3d](https://github.com/idio-sync/archive-3d) project.

### Archive Format

Archives are ZIP files containing:
- `manifest.json` - Metadata and file listings
- Scene files (splats) - e.g., `scene.ply`, `scene.spz`
- Mesh files - e.g., `model.glb`, `model.obj`
- Optional thumbnails and other assets

### Manifest Schema

```json
{
  "container_version": "1.0",
  "packer": "your-application-name",
  "packer_version": "1.0.0",
  "convention_hints": ["arxiv:2312.13299"],
  "_creation_date": "2026-01-31T12:00:00Z",
  "data_entries": {
    "scene_0": {
      "file_name": "scene.ply",
      "created_by": "nerfstudio",
      "_parameters": {
        "position": [0, 0, 0],
        "rotation": [0, 0, 0],
        "scale": 1
      }
    },
    "mesh_0": {
      "file_name": "model.glb",
      "created_by": "blender",
      "_parameters": {
        "position": [0, 0, 0],
        "rotation": [0, 0, 0],
        "scale": 1
      }
    },
    "thumbnail_0": {
      "file_name": "preview.png",
      "created_by": "viewer"
    }
  }
}
```

### Loading Archives

**From the UI:**
1. Click "From File" in the "Load Archive" section
2. Select a `.a3d` or `.a3z` file

**From URL parameter:**
```
https://viewer.website.com?archive=/path/to/scene.a3d
```

**Via Docker environment:**
```bash
docker run -p 8080:80 -e DEFAULT_ARCHIVE_URL="/assets/scene.a3d" splat-mesh-viewer
```

When an archive is loaded:
- The splat (`scene_0`) and mesh (`mesh_0`) are automatically extracted and displayed
- Transform data from `_parameters` is applied to each object
- Archive metadata is shown in the "Archive Info" panel

## Docker Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `DEFAULT_ARCHIVE_URL` | `""` | URL to an archive container (.a3d, .a3z) to load on startup. Takes priority over splat/model URLs. |
| `DEFAULT_SPLAT_URL` | `""` | URL to a Gaussian splat file to load on startup |
| `DEFAULT_MODEL_URL` | `""` | URL to a 3D model file to load on startup |
| `DEFAULT_ALIGNMENT_URL` | `""` | URL to an alignment JSON file to load on startup |
| `SHOW_CONTROLS` | `true` | Show (`true`) or hide (`false`) the controls panel on startup |

### Example Docker Compose
```yaml
version: '3.8'
services:
  viewer:
    build: .
    ports:
      - "8080:80"
    environment:
      - DEFAULT_ARCHIVE_URL=https://example.com/scene.a3d
      - SHOW_CONTROLS=true
    volumes:
      # Optional: mount local archive files
      - ./archives:/usr/share/nginx/html/archives
```

## URL Parameters

The viewer supports URL parameters for embedding with different configurations:

| Parameter | Values | Description |
|-----------|--------|-------------|
| `archive` | URL | Path or URL to archive container (.a3d, .a3z). **Takes priority over splat/model.** |
| `splat` | URL | Path or URL to splat file to load on startup |
| `model` | URL | Path or URL to model file to load on startup |
| `alignment` | URL | Path or URL to alignment JSON file |
| `controls` | `full`, `minimal`, `none` | Control panel mode |
| `mode` | `splat`, `model`, `both`, `split` | Initial display mode |

### Inline Alignment Parameters

You can embed alignment data directly in the URL instead of using an alignment file:

| Parameter | Description |
|-----------|-------------|
| `sp` | Splat position as `x,y,z` |
| `sr` | Splat rotation as `x,y,z` (radians) |
| `ss` | Splat scale |
| `mp` | Model position as `x,y,z` |
| `mr` | Model rotation as `x,y,z` (radians) |
| `ms` | Model scale |

### Control Modes

- **full** - All controls visible (default)
- **minimal** - Only the display mode toggle (Splat/Model/Both/Split buttons)
- **none** - No UI at all, just the viewer

### Example URLs

```
# Load an archive container
https://viewer.website.com?archive=/assets/scene.a3d

# Archive with minimal controls
https://viewer.website.com?archive=/assets/scene.a3d&controls=minimal&mode=both

# Pre-loaded files with minimal UI
https://viewer.website.com?splat=/assets/scene.ply&model=/assets/model.glb&controls=minimal

# Split view comparison with no controls
https://viewer.website.com?splat=/assets/scene.ply&model=/assets/model.glb&controls=none&mode=split

# With inline alignment
https://viewer.website.com?splat=/scene.ply&model=/model.glb&sp=0,1,0&sr=0,3.14,0&ss=1.5

# With alignment file
https://viewer.website.com?splat=/scene.ply&model=/model.glb&alignment=/alignment.json
```

## Embedding

You can embed the viewer on other pages using an iframe:

```html
<!-- Embed with archive -->
<iframe
  src="https://viewer.website.com?archive=/path/to/scene.a3d&controls=minimal"
  width="100%"
  height="600"
  frameborder="0"
  allow="fullscreen">
</iframe>

<!-- Embed with separate files -->
<iframe
  src="https://viewer.website.com?splat=/path/to/scene.ply&model=/path/to/model.glb&controls=minimal&mode=split"
  width="100%"
  height="600"
  frameborder="0"
  allow="fullscreen">
</iframe>
```

### CORS Considerations

If your viewer is hosted at `viewer.website.com` and your files are on `files.website.com`, you'll need to configure CORS headers on your file server:

```
Access-Control-Allow-Origin: https://viewer.website.com
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Origin, Content-Type, Accept
```

Or for development:
```
Access-Control-Allow-Origin: *
```

## Usage

### Loading Files

1. **Load an Archive**: Click "From File" in the "Load Archive" section and select a `.a3d` or `.a3z` file. This loads both the splat and mesh with their embedded alignment.

2. **Load a Gaussian Splat**: Click "From File" in the "Load Splat" section and select a .ply, .splat, .ksplat, .spz, or .sog file

3. **Load a 3D Model**: Click "From File" in the "Load 3D Model" section and select a .glb, .gltf, or .obj file

4. **Load from URL**: Click "From URL" for any file type and enter the URL

### Display Modes
- **Splat**: Show only the Gaussian splat
- **Model**: Show only the 3D model
- **Both**: Overlay both (useful for comparison)
- **Split**: Side-by-side view with splat on left, model on right (synced camera)

### Transform Controls
1. Select which object to transform: **Splat**, **Model**, **Both** (synchronized), or **None** to disable
2. Choose transform mode: **Move**, **Rotate**, or **Scale**
3. Drag the gizmo handles in the 3D view, or use the input fields in the panel

**Tip:** Select **Both** to move the splat and model together after aligning them.

**Keyboard shortcuts:**
- `W` - Move mode
- `E` - Rotate mode
- `R` - Scale mode
- `Escape` - Deselect

### Alignment
- **Auto Align**: Automatically aligns the model to the splat using center-of-mass matching
- **ICP Align**: Uses Iterative Closest Point algorithm for precise alignment (works best when objects are roughly aligned first)
- **Save Alignment**: Downloads a JSON file with current transforms
- **Load Alignment**: Loads a previously saved alignment
- **Reset All**: Resets both objects to origin with default scale
- **Copy Share Link**: Copies a URL with embedded alignment data to clipboard

### Camera Controls
- **Left click + drag**: Rotate view
- **Right click + drag**: Pan view
- **Scroll**: Zoom in/out
- **Reset Camera**: Return to default view
- **Fit to View**: Auto-frame the loaded content

### Toggle Controls Panel
Click the settings icon (⚙) in the top-right corner of the viewer to show/hide the controls panel.

## Supported Formats

### Archive Containers
- `.a3d` - Archive 3D container (ZIP-based)
- `.a3z` - Archive 3D container (ZIP-based, compressed)

### Gaussian Splats (via Spark)
- `.ply` - Standard PLY format with Gaussian splat data
- `.splat` - Compressed splat format
- `.ksplat` - Compressed splat format
- `.spz` - Spark compressed format
- `.sog` - SOG format

### 3D Models (via Three.js)
- `.glb` - Binary glTF
- `.gltf` - glTF with external resources
- `.obj` - Wavefront OBJ (optionally with .mtl materials)

## Project Structure

```
simple-splat-mesh-viewer/
├── index.html              # Main HTML file
├── main.js                 # Core application logic
├── archive-loader.js       # Archive container parsing module
├── config.js               # Runtime configuration (URL params)
├── config.js.template      # Docker config template
├── styles.css              # UI styles
├── nginx.conf              # nginx configuration for Docker
├── Dockerfile              # Docker build configuration
├── docker-entrypoint.sh    # Docker startup script
└── README.MD               # This file
```

## Technologies Used

- [Spark](https://sparkjs.dev/) - Advanced 3D Gaussian Splatting renderer for Three.js
- [Three.js](https://threejs.org/) - 3D rendering and model loading
- [JSZip](https://stuk.github.io/jszip/) - ZIP file handling for archive containers
- [nginx](https://nginx.org/) - Web server (Docker)
- Vanilla JavaScript (ES Modules)

## Browser Compatibility

Requires a modern browser with WebGL 2.0 support:
- Chrome 79+
- Firefox 72+
- Safari 15+
- Edge 79+

## Related Projects

- [archive-3d](https://github.com/idio-sync/archive-3d) - Archive container format specification and tools
