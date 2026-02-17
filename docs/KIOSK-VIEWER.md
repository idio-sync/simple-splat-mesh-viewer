# Kiosk Viewer

Kiosk view mode is a read only mode used for presentation or 3D data. It can be accessed via a url augment, a compiled executable or via a n offline usable bundled HTML file.

The **Download Viewer** button in the archive export prompt generates a self-contained HTML file (~1 MB before archive data) that works entirely offline with zero network access. This is designed for delivering 3D scan data to clients who may not have internet access or technical expertise.

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
- Annotation viewing with depth-aware markers, popups, connecting lines, and image attachments via `asset:` protocol
- Image support in project descriptions via `asset:` protocol
- Metadata sidebar (view-only)
- Scene settings (background color, lighting, grid)
- Asset-specific controls (opacity, wireframe, point size)
- LOD proxy mesh support — automatically loads pre-simplified proxy meshes when available, with SD/HD quality tier toggle
- Mobile-responsive layout with bottom sheet navigation and swipe-based annotation browsing
- Lazy asset loading — the manifest loads first, then individual assets load on demand with inline progress indicators
- Click-to-load gate for deferred archive download (`?autoload=false`)

## Click-to-Load Gate

When embedding multiple viewers on a single page, auto-downloading all archives wastes bandwidth. The `?autoload=false` URL parameter defers the archive download until the user clicks a play button — similar to Sketchfab's embed behavior.

### How it works

1. The viewer fetches only the ZIP central directory via HTTP Range requests (~64KB)
2. Parses the manifest to extract the title and content types
3. Extracts the thumbnail (`preview.jpg`) for a poster image (~50KB)
4. Displays a play button overlay with the poster, title, and content types
5. On click, dismisses the overlay and downloads the full archive

Total initial transfer: **~100-120KB** instead of the full archive.

### URL parameter

```
?autoload=false    Show click-to-load gate (defer download)
?autoload=true     Auto-load immediately (default, same as omitting the param)
```

### Example embed

```html
<iframe src="https://viewer.example.com?archive=/archives/uuid/scan.a3d&autoload=false"></iframe>
```

### Fallback behavior

| Scenario | Behavior |
|----------|----------|
| Server supports Range requests | Poster extracted from archive, play button + title + types shown |
| Server doesn't support Range requests | Range request fails gracefully, generic play button shown (no poster) |
| Archive has no thumbnail | Play button shown without poster image |
| No `?autoload` param (default) | Archive downloads immediately, today's behavior |
| `?autoload=false`, no archive URL | Falls through to file picker (gate skipped) |

## Themes

The kiosk viewer supports themes — self-contained packages that control colors, typography, and layout. Add `?theme=name` to the viewer URL to activate a theme. Themes also carry into offline kiosk HTML files generated with "Download Viewer".

### Built-in themes

| Theme | Layout | Description |
|-------|--------|-------------|
| *(default)* | Sidebar | Cyan/purple palette with metadata sidebar |
| `editorial` | Editorial | Gold and navy palette with full-bleed scene, edge-anchored title block, bottom ribbon, and magazine-spread details overlay |
| `minimal` | Sidebar | Neutral white accent with standard sidebar layout |

### Creating a custom theme

1. Copy `src/themes/_template/` to `src/themes/your-theme-name/`
2. Edit `theme.css` — uncomment and change the CSS variables you want to override
3. Set the metadata in the comment block at the top:
   - `@theme` — Display name (e.g., `@theme My Custom Theme`)
   - `@layout sidebar` or `@layout editorial` — which layout to use
   - `@scene-bg #hex` — Three.js scene background color
4. Use with `?theme=your-theme-name`

Only override the variables you want to change — everything else inherits sensible defaults from `styles.css`.

### Available CSS variables

All variables are defined on `body.kiosk-mode` in `styles.css` with default values. Themes override whichever they want:

```css
/* Accent color — buttons, links, highlights, markers */
--kiosk-accent: #4ecdc4;
--kiosk-accent-rgb: 78, 205, 196;

/* Surface backgrounds (RGB triplets for use at varying opacity) */
--kiosk-surface-rgb: 15, 15, 26;
--kiosk-elevated-rgb: 42, 42, 74;
--kiosk-bg-deep-rgb: 10, 10, 20;

/* Text colors (RGB triplets) */
--kiosk-text-bright-rgb: 220, 220, 235;
--kiosk-text-body-rgb: 180, 180, 200;
--kiosk-text-dim-rgb: 150, 150, 170;
--kiosk-text-heading-rgb: 240, 240, 250;

/* Borders */
--kiosk-border-subtle: rgba(255, 255, 255, 0.06);

/* Typography */
--kiosk-font-display: Georgia, 'Times New Roman', serif;
--kiosk-font-body: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;

/* Scene background (read by JS for Three.js scene) */
--kiosk-scene-bg: #1a1a2e;
```

### Custom layouts

Themes can include their own layout (DOM structure and positioning) beyond the default sidebar. A custom layout is a pair of optional files in the theme folder:

- **`layout.css`** — CSS rules for the layout, scoped under `body.kiosk-mode.kiosk-{layout-name}`
- **`layout.js`** — JS module that creates layout DOM elements. Must:
  - Export a `setup(manifest, deps)` function that receives all dependencies via the `deps` object (no ES imports — this avoids path resolution issues between online and offline modes)
  - Self-register on `window.__KIOSK_LAYOUTS__['{layout-name}']` at module load time

See `src/themes/editorial/` for a complete example with all three files.

### Theme URL parameters

```
?theme=editorial          Full editorial experience (layout + colors)
?theme=minimal            Sidebar layout with neutral colors
?theme=my-custom-theme    Any user-created theme folder
?layout=editorial         Override layout regardless of theme
(no ?theme param)         Default sidebar look — zero regression
```

### How theme loading works

**Online (live server):**
1. `config.js` parses `?theme=` from the URL
2. `theme-loader.js` fetches `themes/{name}/theme.css`, injects it as `<style id="kiosk-theme">`
3. For non-sidebar layouts, also fetches `layout.css` and dynamically imports `layout.js`
4. CSS variable overrides cascade over the defaults in `styles.css`

**Offline (generated kiosk HTML):**
1. `kiosk-viewer.js` fetches theme CSS, layout CSS, and layout JS at generation time
2. Theme and layout CSS are inlined as `<style>` blocks in the HTML
3. Layout JS is base64-encoded in the deps bundle and loaded by the bootstrap before `init()`
4. The layout module self-registers on `window.__KIOSK_LAYOUTS__` so `theme-loader.js` finds it without network access

### Graceful fallback

| Scenario | Behavior |
|----------|----------|
| No `?theme=` | Base variables from `styles.css`, sidebar layout. Identical to pre-theme behavior. |
| `?theme=nonexistent` | 404 warning logged, defaults apply. |
| Theme omits some variables | Only overridden variables change, rest keep defaults. |
| Layout module missing | Warning logged, falls back to sidebar layout. |

## Embed Security (Docker Deployment)

When embedding the kiosk viewer via `<iframe>` on client websites, four Docker environment variables (`KIOSK_LOCK`, `ARCHIVE_PATH_PREFIX`, `EMBED_REFERERS`, `FRAME_ANCESTORS`) lock down the viewer to prevent URL tampering, restrict archive access, and control iframe embedding.

For full details — environment variable reference, example deployment commands, security layers table, recommended non-guessable archive paths, and the threat model — see the [Kiosk Embed Security section in DEPLOYMENT.md](DEPLOYMENT.md#kiosk-embed-security).

Use `autoload=false` when embedding multiple viewers on one page to defer downloads until the user clicks each embed's play button.

## Limitations

- The kiosk viewer is read-only — no archive creation, metadata editing, or alignment tools
- The embedded JavaScript stack (Three.js, Spark.js) in the executable and bundled HTML file is frozen at export time and may eventually become incompatible with future browsers
- The archive's raw data files (GLB, PLY, E57) remain the authoritative preservation copies; the kiosk viewer is a convenience access layer
