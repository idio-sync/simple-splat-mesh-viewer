# Configuration

## URL Parameters

### File Loading

| Parameter | Description |
|-----------|-------------|
| `archive` | URL to archive container (.a3d, .a3z). **Takes priority over individual file params.** |
| `splat` | URL to Gaussian splat file |
| `model` | URL to 3D model file |
| `pointcloud` | URL to E57 point cloud file |
| `alignment` | URL to alignment JSON file |

### UI Configuration

| Parameter | Values | Description |
|-----------|--------|-------------|
| `controls` | `full`, `minimal`, `none` | Control panel mode |
| `mode` | `splat`, `model`, `pointcloud`, `both`, `split` | Initial display mode |
| `toolbar` | `show`, `hide` | Toolbar visibility |
| `sidebar` | `closed`, `view`, `edit` | Metadata sidebar state |
| `theme` | theme folder name | Kiosk theme (e.g., `editorial`, `minimal`) |
| `layout` | `sidebar`, `editorial` | Layout override (overrides theme default) |
| `autoload` | `true`, `false` | Auto-load archive on page load (default `true`; `false` shows a click-to-load gate) |

### Inline Alignment

Embed transform data directly in the URL instead of using an alignment file:

| Splat | Model | Point Cloud | Description |
|-------|-------|-------------|-------------|
| `sp=x,y,z` | `mp=x,y,z` | `pp=x,y,z` | Position |
| `sr=x,y,z` | `mr=x,y,z` | `pr=x,y,z` | Rotation (radians) |
| `ss=scale` | `ms=scale` | `ps=scale` | Uniform scale |

### Example URLs

```
# Load an archive container
https://viewer.example.com?archive=/assets/scene.a3d

# Archive with minimal controls in split view
https://viewer.example.com?archive=/assets/scene.a3d&controls=minimal&mode=split

# Pre-loaded files with inline alignment
https://viewer.example.com?splat=/scene.ply&model=/model.glb&sp=0,1,0&sr=0,3.14,0&ss=1.5

# Kiosk mode: no controls, no toolbar, metadata view-only
https://viewer.example.com?archive=/scene.a3d&controls=none&toolbar=hide&sidebar=view

# Point cloud with model comparison
https://viewer.example.com?model=/model.glb&pointcloud=/scan.e57&mode=both

# Kiosk with editorial theme
https://viewer.example.com?archive=/scene.a3d&controls=none&theme=editorial

# Deferred loading (click-to-load gate)
https://viewer.example.com?archive=/scene.a3d&autoload=false
```

## Share & Embed

### Share Dialog

Click **Copy Share Link** to generate a URL encoding the current display mode, alignment transforms, and UI configuration. The share dialog includes presets:

- **Full Editor** — All controls and editing enabled
- **Viewer Mode** — Toolbar hidden, metadata sidebar in view-only mode
- **Kiosk Mode** — All controls hidden

### Embedding

```html
<iframe
  src="https://viewer.example.com?archive=/scene.a3d&controls=minimal&toolbar=hide"
  width="100%" height="600" frameborder="0" allow="fullscreen">
</iframe>
```

### CORS

If the viewer and files are on different origins, configure your file server with:

```
Access-Control-Allow-Origin: https://viewer.example.com
Access-Control-Allow-Methods: GET, OPTIONS
Access-Control-Allow-Headers: Origin, Content-Type, Accept, Range
```

## URL Security

By default, only same-origin URLs are permitted for file loading. External domains can be allowed via the `ALLOWED_DOMAINS` environment variable (Docker) or the `ALLOWED_EXTERNAL_DOMAINS` array in `config.js` (local development). Wildcard subdomains are supported (e.g., `*.mycompany.com`).

For full details on URL validation, domain allowlisting, HTTPS enforcement, and all other security controls, see the [Security section in DEPLOYMENT.md](DEPLOYMENT.md#security).
