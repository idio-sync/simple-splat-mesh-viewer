// Pre-module error detection (regular script, not module)
console.log('[Pre-module] Page loading, checking for errors...');
window.addEventListener('error', function(e) {
    console.error('[Pre-module] Error caught:', e.message, e.filename, e.lineno);
});
// Track unhandled promise rejections (often from module loading issues)
window.addEventListener('unhandledrejection', function(e) {
    console.error('[Pre-module] Unhandled promise rejection:', e.reason);
});
window.moduleLoaded = false;
setTimeout(function() {
    if (!window.moduleLoaded) {
        console.error('[Pre-module] Module failed to load within 5 seconds');
    }
}, 5000);
