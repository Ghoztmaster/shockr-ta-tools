/**
 * bugfix.js — targeted fix for the qooxdoo _onNativeUnload slowdown.
 *
 * The game's qooxdoo framework registers an 'unload' handler that destroys
 * all objects on page close, causing a multi-second freeze. The original
 * Shockr fix hijacked window.addEventListener globally — breaking other
 * scripts. This version only patches the specific qooxdoo handler.
 *
 * Call fixUnload() once after the game has loaded.
 */

export function fixUnload() {
    try {
        // Find and neutralize qooxdoo's _onNativeUnload
        const mgr = qx.event.Registration.getManager(window);
        if (mgr) {
            const handlers = mgr.getHandlers('unload', window);
            if (handlers && handlers.length > 0) {
                for (const handler of handlers) {
                    try {
                        qx.event.Registration.removeListenerById(window, handler);
                    } catch { /* ignore individual failures */ }
                }
                console.log(`[ST] BugFix: removed ${handlers.length} qooxdoo unload handler(s)`);
                return;
            }
        }
    } catch {
        // If qooxdoo internals changed, do nothing rather than hijack
        // addEventListener globally. A slow page close is better than
        // breaking other scripts.
    }
    console.log('[ST] BugFix: no qooxdoo unload handler found (may already be patched)');
}
