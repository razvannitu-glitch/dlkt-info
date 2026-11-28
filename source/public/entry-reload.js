/** A plain homepage reload starts a new reading visit at the top.
 * Keep deep links and normal back/forward navigation untouched. This classic
 * entry-only script runs before CSS and data modules, without storage or I/O.
 */
(() => {
    const { location, history, performance } = window;
    const topTarget = () => location.hash === '' || location.hash === '#top';
    if (!['/', '/index.html', '/iceo.html'].includes(location.pathname) || !topTarget())
        return;
    const navigation = performance?.getEntriesByType?.('navigation')[0];
    if (navigation?.type !== 'reload')
        return;
    let previous;
    try {
        if ('scrollRestoration' in history) {
            previous = history.scrollRestoration;
            history.scrollRestoration = 'manual';
        }
    }
    catch { /* Still reset the viewport on browsers without this capability. */ }
    let active = true, frame = null;
    const intents = ['wheel', 'touchstart', 'pointerdown', 'keydown'];
    const stop = () => {
        if (!active)
            return;
        active = false;
        if (frame !== null)
            window.cancelAnimationFrame(frame);
        for (const event of intents)
            window.removeEventListener(event, stop, true);
        window.removeEventListener('hashchange', stop);
        window.removeEventListener('pagehide', stop);
        window.removeEventListener('load', reset);
        window.removeEventListener('pageshow', shown);
        document.removeEventListener('DOMContentLoaded', reset);
        try {
            if (previous !== undefined && history.scrollRestoration === 'manual')
                history.scrollRestoration = previous;
        }
        catch { /* Preserve navigation if restoration is unavailable. */ }
    };
    const reset = () => {
        if (!active)
            return;
        if (!topTarget()) {
            stop();
            return;
        }
        window.scrollTo({ top: 0, left: 0, behavior: 'instant' });
    };
    const settle = () => {
        if (!active)
            return;
        reset();
        if (!active)
            return;
        // The browser may complete its restoration after the load event. Keep
        // manual restoration until the first two post-pageshow frame boundaries.
        frame = window.requestAnimationFrame(() => {
            reset();
            if (active)
                frame = window.requestAnimationFrame(() => { reset(); stop(); });
        });
    };
    const shown = (event) => { if (event.persisted) {
        stop();
        return;
    } settle(); };
    for (const event of intents)
        window.addEventListener(event, stop, { capture: true, passive: true, once: true });
    window.addEventListener('hashchange', stop, { once: true });
    window.addEventListener('pagehide', stop, { once: true });
    document.addEventListener('DOMContentLoaded', reset, { once: true });
    window.addEventListener('load', reset, { once: true });
    window.addEventListener('pageshow', shown, { once: true });
    reset();
})();
