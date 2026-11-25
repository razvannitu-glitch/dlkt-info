/**
 * A local exposure heuristic, never evidence of reading or comprehension.
 * The caller owns persistence. This module performs no storage or network work.
 */
export const KNOWLEDGE_EXPOSURE_MS = 2000;
export const KNOWLEDGE_EXPOSURE_FRACTION = 0.5;
export const KNOWLEDGE_EXPOSURE_LIMIT = 5000;
const ID = /^[a-z][a-z0-9-]{2,79}$/u;
function browserEnvironment() {
    if (typeof window === 'undefined' || typeof document === 'undefined' || typeof IntersectionObserver !== 'function' ||
        typeof ResizeObserver !== 'function' || typeof MutationObserver !== 'function')
        return null;
    return {
        now: () => performance.now(),
        foreground: () => document.visibilityState === 'visible' && document.hasFocus(),
        measure: target => {
            if (!target.isConnected || target.getClientRects().length === 0)
                return null;
            for (let ancestor = target; ancestor; ancestor = ancestor.parentElement) {
                const style = getComputedStyle(ancestor);
                if (ancestor.hidden || ancestor.inert || style.display === 'none' || style.visibility !== 'visible' || Number(style.opacity) === 0)
                    return null;
            }
            const rect = target.getBoundingClientRect(), viewport = window.visualViewport;
            const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
            const width = viewport?.width ?? window.innerWidth, height = viewport?.height ?? window.innerHeight;
            return { width: rect.width, height: rect.height,
                possibleArea: Math.min(rect.width, width) * Math.min(rect.height, height),
                visibleArea: Math.max(0, Math.min(rect.right, left + width) - Math.max(rect.left, left)) *
                    Math.max(0, Math.min(rect.bottom, top + height) - Math.max(rect.top, top)) };
        },
        setTimer: (callback, delay) => window.setTimeout(callback, delay),
        clearTimer: handle => window.clearTimeout(handle),
        listen: (event, callback) => {
            const target = event === 'visibilitychange' ? document : window;
            target.addEventListener(event, callback, { capture: true, passive: true });
            // Zooming or mobile browser chrome can change the visual viewport independently.
            const visual = event === 'resize' || event === 'scroll' ? window.visualViewport : null;
            visual?.addEventListener(event, callback, { passive: true });
            return () => { target.removeEventListener(event, callback, true); visual?.removeEventListener(event, callback); };
        },
        intersection: callback => new IntersectionObserver(entries => callback(entries), { threshold: Array.from({ length: 101 }, (_, index) => index / 100) }),
        resize: callback => new ResizeObserver(() => callback()),
        mutation: callback => {
            const observer = new MutationObserver(() => callback());
            return {
                observe: target => {
                    observer.observe(target, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class', 'hidden', 'inert', 'open'] });
                    // A modal outside the feed can suspend exposure without changing its geometry.
                    observer.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden', 'inert', 'data-entry-view', 'data-world-explore'] });
                },
                disconnect: () => observer.disconnect(),
            };
        },
    };
}
function finitePositive(value) { return Number.isFinite(value) && value > 0; }
function qualifies(entry, measurement) {
    if (!entry?.isIntersecting || measurement === null)
        return false;
    const { width, height, possibleArea, visibleArea } = measurement;
    if (![width, height, possibleArea].every(finitePositive) || !Number.isFinite(visibleArea) || visibleArea < 0 ||
        !finitePositive(entry.intersectionRect.width) || !finitePositive(entry.intersectionRect.height) ||
        !finitePositive(entry.boundingClientRect.width) || !finitePositive(entry.boundingClientRect.height))
        return false;
    if (entry.boundingClientRect.width !== width || entry.boundingClientRect.height !== height)
        return false;
    const threshold = possibleArea * KNOWLEDGE_EXPOSURE_FRACTION;
    return visibleArea >= threshold && entry.intersectionRect.width * entry.intersectionRect.height >= threshold;
}
/** Bind to the reconciled feed. Rebinding requires calling the previous stop function. */
export function observeKnowledgeExposure(container, onQualifiedExposure, options = {}) {
    const environment = options.environment ?? browserEnvironment();
    if (!environment?.intersection || !environment.resize || !environment.mutation)
        return () => { };
    const env = environment, createIntersection = environment.intersection, createResize = environment.resize, createMutation = environment.mutation;
    const completed = new Set(), observations = new Map(), cleanups = [];
    let stopped = false, generation = 0, startedAt = env.now(), timer = null;
    let intersection = null, resize = null, mutation = null;
    const active = () => {
        try {
            return !stopped && env.foreground() && (options.isActive?.() ?? true);
        }
        catch {
            return false;
        }
    };
    const cancelTimer = () => { if (timer !== null) {
        env.clearTimer(timer);
        timer = null;
    } };
    const resetDwell = () => { cancelTimer(); for (const state of observations.values())
        state.since = null; };
    const measure = (state) => {
        if (!container.contains(state.node) || !state.node.isConnected)
            return null;
        try {
            return env.measure(state.node);
        }
        catch {
            return null;
        }
    };
    const schedule = () => {
        cancelTimer();
        if (!active())
            return;
        let earliest = Infinity;
        for (const state of observations.values())
            if (state.since !== null)
                earliest = Math.min(earliest, state.since + KNOWLEDGE_EXPOSURE_MS);
        if (Number.isFinite(earliest))
            timer = env.setTimer(confirm, Math.max(1, earliest - env.now()));
    };
    const checkGeometry = () => {
        if (!active()) {
            resetDwell();
            return;
        }
        const now = env.now();
        for (const state of observations.values()) {
            if (qualifies(state.entry, measure(state))) {
                if (state.since === null)
                    state.since = now;
            }
            else
                state.since = null;
        }
        schedule();
    };
    const receive = (entries, token) => {
        if (stopped || token !== generation)
            return;
        if (!active()) {
            resetDwell();
            return;
        }
        const now = env.now();
        for (const entry of [...entries].sort((a, b) => a.time - b.time)) {
            const state = observations.get(entry.target);
            if (!state || !Number.isFinite(entry.time) || entry.time < startedAt || entry.time < state.lastTime || entry.time > now)
                continue;
            state.lastTime = entry.time;
            state.entry = entry;
            if (qualifies(entry, measure(state))) {
                if (state.since === null)
                    state.since = now;
            }
            else
                state.since = null;
        }
        schedule();
    };
    function confirm() {
        timer = null;
        if (!active()) {
            resetDwell();
            return;
        }
        // Entries queued before this task must invalidate dwell before it can qualify.
        if (intersection)
            receive(intersection.takeRecords(), generation);
        cancelTimer();
        if (!active()) {
            resetDwell();
            return;
        }
        const now = env.now();
        for (const state of [...observations.values()]) {
            if (stopped)
                break;
            if (!active() || !qualifies(state.entry, measure(state))) {
                state.since = null;
                continue;
            }
            if (state.since === null || now - state.since < KNOWLEDGE_EXPOSURE_MS)
                continue;
            if (completed.size >= KNOWLEDGE_EXPOSURE_LIMIT) {
                stop();
                break;
            }
            completed.add(state.id);
            observations.delete(state.node);
            intersection?.unobserve(state.node);
            try {
                onQualifiedExposure(state.id);
            }
            catch { /* A callback failure must not affect the public feed or create repeated exposure. */ }
        }
        schedule();
    }
    const restart = () => {
        if (stopped)
            return;
        resetDwell();
        intersection?.disconnect();
        intersection = null;
        generation++;
        startedAt = env.now();
        for (const state of observations.values()) {
            state.entry = null;
            state.lastTime = startedAt;
        }
        if (!active())
            return;
        const token = generation;
        try {
            intersection = createIntersection(entries => receive(entries, token));
            for (const state of observations.values())
                intersection.observe(state.node);
        }
        catch {
            intersection?.disconnect();
            intersection = null;
            resetDwell();
        }
    };
    const bind = () => {
        if (stopped)
            return;
        resetDwell();
        resize?.disconnect();
        observations.clear();
        const nodes = [...container.querySelectorAll('article[data-news-stream-key^="knowledge:"]')];
        if (nodes.length > KNOWLEDGE_EXPOSURE_LIMIT) {
            intersection?.disconnect();
            intersection = null;
            generation++;
            return;
        }
        const counts = new Map();
        for (const node of nodes) {
            const id = (node.dataset.newsStreamKey ?? '').slice('knowledge:'.length);
            if (ID.test(id))
                counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        for (const node of nodes) {
            const id = (node.dataset.newsStreamKey ?? '').slice('knowledge:'.length);
            if (!ID.test(id) || counts.get(id) !== 1 || completed.has(id))
                continue;
            observations.set(node, { id, node, since: null, entry: null, lastTime: env.now() });
        }
        try {
            resize?.observe(container);
            for (const state of observations.values())
                resize?.observe(state.node);
        }
        catch {
            observations.clear();
        }
        restart();
    };
    const stop = () => {
        if (stopped)
            return;
        stopped = true;
        generation++;
        resetDwell();
        intersection?.disconnect();
        resize?.disconnect();
        mutation?.disconnect();
        observations.clear();
        for (const cleanup of cleanups.splice(0))
            cleanup();
    };
    try {
        resize = createResize(restart);
        mutation = createMutation(bind);
        for (const event of ['visibilitychange', 'focus', 'blur', 'resize'])
            cleanups.push(env.listen(event, restart));
        cleanups.push(env.listen('scroll', checkGeometry), env.listen('pagehide', stop));
        mutation.observe(container);
        bind();
    }
    catch {
        stop();
    }
    return stop;
}
