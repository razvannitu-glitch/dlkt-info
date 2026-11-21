export const DISCOVERY_SLOW_MS = 8_000;
/** Loading is presentation of the real request; existing eligible reports always remain usable. */
export function discoveryLoadingPhase(state, startedAt, now) {
    if (state.firstCount + state.moreCount > 0)
        return 'hidden';
    if (state.pending)
        return startedAt !== null && now - startedAt >= DISCOVERY_SLOW_MS ? 'slow' : 'initial';
    return state.unavailable ? 'error' : 'hidden';
}
const browserClock = {
    now: () => performance.now(),
    schedule: (callback, delay) => setTimeout(callback, delay),
    cancel: timer => clearTimeout(timer),
};
/** One finite waiting notification per request; this never fetches, retries or delays a result. */
export class DiscoveryLoading {
    onSlow;
    clock;
    startedAt = null;
    timer;
    generation = 0;
    constructor(onSlow, clock = browserClock) {
        this.onSlow = onSlow;
        this.clock = clock;
    }
    begin() {
        if (this.startedAt !== null)
            return;
        this.startedAt = this.clock.now();
        const generation = ++this.generation;
        this.timer = this.clock.schedule(() => {
            if (this.startedAt === null || generation !== this.generation)
                return;
            this.timer = undefined;
            this.onSlow();
        }, DISCOVERY_SLOW_MS);
    }
    finish() {
        this.generation++;
        if (this.timer !== undefined)
            this.clock.cancel(this.timer);
        this.timer = undefined;
        this.startedAt = null;
    }
    phase(state) {
        return discoveryLoadingPhase(state, this.startedAt, this.clock.now());
    }
}
const copy = {
    initial: {
        title: 'Your day, coming into focus.',
        description: "Loading today's stories from connected sources.",
        announcement: "Loading today's stories.",
    },
    slow: {
        title: 'Still connecting.',
        description: "Today's stories are taking longer to load. You can choose your interests while this check finishes.",
        announcement: "Today's stories are taking longer to load. You can choose your interests while this check finishes.",
    },
    error: {
        title: "Let's try that again.",
        description: "Today's stories could not be loaded. Check your connection or try again.",
        announcement: "Today's stories could not be loaded. Try again when you are ready.",
    },
};
function setText(node, text) { if (node.textContent !== text)
    node.textContent = text; }
/** Reuse the server-supplied composition so unrelated city renders never restart its motion. */
export function renderDiscoveryLoading(elements, phase) {
    if (elements.panel.dataset.phase !== phase)
        elements.panel.dataset.phase = phase;
    const hidden = phase === 'hidden';
    if (elements.panel.hidden !== hidden)
        elements.panel.hidden = hidden;
    elements.status.classList.toggle('sr-only', !hidden);
    if (hidden)
        return;
    const content = copy[phase];
    setText(elements.title, content.title);
    setText(elements.copy, content.description);
    setText(elements.status, content.announcement);
    elements.retry.hidden = phase !== 'error';
    elements.personalise.hidden = phase === 'error';
    elements.hint.hidden = phase === 'error';
}
/** Call existing actions and keep focus usable when their transient loading controls disappear. */
export function bindDiscoveryLoadingActions(elements, actions, focus) {
    let settingsFromLoading = false, disposed = false;
    const visible = (element) => element.isConnected && !element.hidden && element.getClientRects().length > 0;
    const available = (button) => visible(button) && !button.disabled && !elements.panel.hidden;
    const personalise = () => { settingsFromLoading = true; actions.personalise(); };
    const retry = () => { focus.retryTarget.focus({ preventScroll: true }); actions.retry(); };
    const settingsClosed = () => {
        if (!settingsFromLoading)
            return;
        settingsFromLoading = false;
        // Match the header's native-dialog handling: let close and explicit submit focus settle first.
        queueMicrotask(() => {
            if (disposed || focus.settings.open || available(elements.personalise))
                return;
            const owner = elements.panel.ownerDocument, active = owner.activeElement;
            const hiddenControl = active === elements.personalise && !available(elements.personalise) || active === elements.retry && !available(elements.retry);
            if (active === owner.body || hiddenControl || focus.settings.contains(active)) {
                const destination = visible(focus.settingsFallback) ? focus.settingsFallback : focus.menuFallback;
                if (visible(destination))
                    destination.focus({ preventScroll: true });
            }
        });
    };
    elements.personalise.addEventListener('click', personalise);
    elements.retry.addEventListener('click', retry);
    focus.settings.addEventListener('close', settingsClosed);
    return () => {
        disposed = true;
        elements.personalise.removeEventListener('click', personalise);
        elements.retry.removeEventListener('click', retry);
        focus.settings.removeEventListener('close', settingsClosed);
    };
}
