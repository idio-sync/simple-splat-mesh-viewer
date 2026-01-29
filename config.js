// Runtime configuration
// Supports URL parameters for embedding:
//   ?splat=URL       - Default splat file to load
//   ?model=URL       - Default model file to load
//   ?alignment=URL   - Default alignment JSON file to load
//   ?controls=MODE   - Control panel mode: full, minimal, none
//   ?mode=VIEW       - Initial view mode: splat, model, both, split
//
// Examples:
//   viewer.website.com?splat=/assets/scene.ply&model=/assets/model.glb&controls=minimal
//   viewer.website.com?splat=https://example.com/file.ply&controls=none&mode=split
//   viewer.website.com?splat=/scene.ply&model=/model.glb&alignment=/alignment.json

(function() {
    // Parse URL parameters
    const params = new URLSearchParams(window.location.search);

    // Get parameters with defaults
    const splatUrl = params.get('splat') || '';
    const modelUrl = params.get('model') || '';
    const alignmentUrl = params.get('alignment') || '';
    const controlsMode = params.get('controls') || 'full'; // full, minimal, none
    const viewMode = params.get('mode') || 'both'; // splat, model, both, split

    // Determine what to show based on controls mode
    // full: show everything
    // minimal: only display mode toggle and toggle button
    // none: hide all controls (view only)

    window.APP_CONFIG = {
        defaultSplatUrl: splatUrl,
        defaultModelUrl: modelUrl,
        defaultAlignmentUrl: alignmentUrl,
        showControls: controlsMode !== 'none',
        controlsMode: controlsMode,
        initialViewMode: viewMode
    };
})();
