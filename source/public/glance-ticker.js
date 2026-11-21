export const TICKER_SPEED = 28;
/** At least one complete group spans the viewport before its identical successor enters. */
export function tickerGeometry(viewport, sequence) {
    if (!Number.isFinite(viewport) || !Number.isFinite(sequence) || viewport <= 0 || sequence <= 0)
        return null;
    const copies = Math.ceil(viewport / sequence), distance = copies * sequence;
    if (copies > 64 || !Number.isFinite(distance))
        return null;
    return { copies, distance, duration: distance / TICKER_SPEED * 1000 };
}
const signal = (v) => v !== undefined && ['weather', 'forex', 'key', 'notice'].includes(v);
/** Autoplays without a manual motion control; source actions remain in the static Read updates dialog. */
export class NewsTicker {
    root;
    open;
    media = matchMedia('(prefers-reduced-motion: reduce)');
    hoverMedia = matchMedia('(hover: hover) and (pointer: fine)');
    animation = null;
    items = [];
    signature = '';
    duration = 0;
    hovered = false;
    focused = false;
    touched = false;
    frame = 0;
    viewport;
    track;
    summary;
    constructor(root, open) {
        this.root = root;
        this.open = open;
        const required = (id) => { const n = document.getElementById(id); if (!n)
            throw Error('TICKER_ELEMENT_MISSING'); return n; };
        this.viewport = required('glance-ticker-viewport');
        this.track = required('glance-ticker-track');
        this.summary = required('glance-screen-summary');
        this.viewport.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse' && this.hoverMedia.matches) {
            this.hovered = true;
            this.sync();
        } });
        this.viewport.addEventListener('pointerleave', () => { this.hovered = false; this.sync(); });
        this.viewport.addEventListener('pointerdown', e => { if (e.pointerType === 'touch') {
            this.hovered = false;
            this.touched = true;
            this.sync();
        } });
        const releaseTouch = () => { if (this.touched) {
            this.touched = false;
            this.hovered = false;
            this.sync();
        } };
        window.addEventListener('pointerup', releaseTouch);
        window.addEventListener('pointercancel', releaseTouch);
        window.addEventListener('blur', () => { this.touched = false; this.hovered = false; this.sync(); });
        this.viewport.addEventListener('click', e => { const target = e.target instanceof Element ? e.target.closest('[data-ticker-signal]') : null; const kind = target?.dataset.tickerSignal; if (signal(kind))
            this.open(kind); });
        this.root.addEventListener('focusin', e => { this.focused = e.target instanceof Element && e.target.matches(':focus-visible'); this.sync(); });
        this.root.addEventListener('focusout', e => { this.focused = e.relatedTarget instanceof Element && this.root.contains(e.relatedTarget) && e.relatedTarget.matches(':focus-visible'); this.sync(); });
        this.media.addEventListener('change', () => this.layout());
        this.hoverMedia.addEventListener('change', () => { this.hovered = false; this.sync(); });
        document.addEventListener('visibilitychange', () => { if (document.visibilityState !== 'visible') {
            this.touched = false;
            this.hovered = false;
        } this.sync(); });
        window.addEventListener('pageshow', () => this.layout());
        window.addEventListener('pagehide', () => { this.touched = false; this.hovered = false; this.animation?.pause(); });
        new ResizeObserver(() => this.schedule()).observe(this.viewport);
        new MutationObserver(() => this.sync()).observe(document.body, { subtree: true, attributes: true, attributeFilter: ['open'] });
    }
    update(items) {
        const signature = JSON.stringify(items);
        if (signature === this.signature)
            return;
        this.signature = signature;
        this.items = items;
        this.summary.textContent = items.length ? items.map(i => `${i.label}: ${i.value}. ${i.note}.`).join(' ') : 'Your daily signals are hidden. Customize to bring them back.';
        this.layout();
    }
    sequence() {
        const sequence = document.createElement('div');
        sequence.className = 'glance-ticker-sequence';
        for (const item of this.items) {
            const span = document.createElement('span');
            span.className = 'glance-ticker-item';
            span.dataset.tickerSignal = item.signal;
            const label = document.createElement('span');
            label.className = 'ticker-label';
            label.textContent = item.label;
            const value = document.createElement('strong');
            value.textContent = item.value;
            const note = document.createElement('span');
            note.className = 'ticker-note';
            note.textContent = item.note;
            span.append(label, value, note);
            sequence.append(span);
        }
        return sequence;
    }
    schedule() { cancelAnimationFrame(this.frame); this.frame = requestAnimationFrame(() => this.layout()); }
    layout() {
        const travelled = this.animation && typeof this.animation.currentTime === 'number' && this.duration ? this.animation.currentTime % this.duration / 1000 * TICKER_SPEED : 0;
        this.animation?.cancel();
        this.animation = null;
        this.track.replaceChildren();
        this.root.dataset.reducedMotion = String(this.media.matches);
        this.root.dataset.staticTicker = 'false';
        this.root.dataset.tickerEmpty = String(this.items.length === 0);
        this.viewport.hidden = this.items.length === 0;
        if (!this.items.length) {
            this.sync();
            return;
        }
        const group = document.createElement('div');
        group.className = 'glance-ticker-group';
        const unit = this.sequence();
        group.append(unit);
        this.track.append(group);
        const plan = tickerGeometry(this.viewport.clientWidth, unit.getBoundingClientRect().width);
        this.root.dataset.staticTicker = String(plan === null);
        this.viewport.tabIndex = plan === null ? 0 : -1;
        if (plan) {
            for (let i = 1; i < plan.copies; i++)
                group.append(this.sequence());
            const distance = group.getBoundingClientRect().width;
            this.duration = distance / TICKER_SPEED * 1000;
            this.track.append(group.cloneNode(true));
            this.animation = this.track.animate([{ transform: 'translateX(0)' }, { transform: `translateX(-${distance}px)` }], { duration: this.duration, iterations: Infinity, easing: 'linear' });
            this.animation.currentTime = travelled % distance / TICKER_SPEED * 1000;
        }
        this.sync();
    }
    sync() {
        const blocked = this.hovered || this.focused || this.touched || document.visibilityState !== 'visible' || document.querySelector('dialog[open]') !== null;
        this.root.dataset.tickerPaused = String(blocked || this.animation === null);
        if (this.animation) {
            if (blocked)
                this.animation.pause();
            else
                this.animation.play();
        }
    }
}
