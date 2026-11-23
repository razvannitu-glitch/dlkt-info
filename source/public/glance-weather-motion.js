import { validWeatherSymbol, validWeatherSymbols } from './local-contracts.js';
import { getLocale } from './i18n-browser.js';
const UNKNOWN = Object.freeze({ condition: 'unknown', light: 'unspecified', label: 'Condition unavailable', precipitation: null });
/** Map the publisher's exact code. No weather is inferred from prose, precipitation totals or a local clock. */
export function weatherVisual(symbol) {
    if (!validWeatherSymbol(symbol))
        return UNKNOWN;
    const [raw, period] = symbol.split('_'), base = raw ?? '';
    const light = period === 'day' ? 'day' : period === 'night' ? 'night' : period === 'polartwilight' ? 'twilight' : 'unspecified';
    const precipitation = base.includes('sleet') ? 'sleet' : base.includes('snow') ? 'snow' : base.includes('rain') ? 'rain' : null;
    const condition = base.includes('thunder') ? 'thunder' : precipitation ?? { clearsky: 'clear', fair: 'fair', partlycloudy: 'partly-cloudy', cloudy: 'cloudy', fog: 'fog' }[base] ?? 'unknown';
    const amount = base.startsWith('light') ? 'Light ' : base.startsWith('heavy') ? 'Heavy ' : '';
    const weather = precipitation ? `${amount}${precipitation}${base.includes('showers') ? ' showers' : ''}${base.includes('thunder') ? ' and thunder' : ''}` : { clearsky: 'Clear sky', fair: 'Mostly clear', partlycloudy: 'Partly cloudy', cloudy: 'Cloudy', fog: 'Fog' }[base];
    const label = (weather ?? 'Condition unavailable').replace(/^./u, first => first.toUpperCase()) + (light === 'night' ? ' · Night' : light === 'twilight' ? ' · Polar twilight' : '');
    return Object.freeze({ condition, light, label, precipitation });
}
/** Only the source interval covering this hour may drive motion. A future or expired code stays neutral. */
export function weatherPresentation(card, now) {
    const missing = (state, nextAt = null) => ({ ...UNKNOWN, label: state === 'expired' ? 'Forecast expired' : 'Condition unavailable', state, symbol: null, nextAt });
    if (!card || card.kind !== 'forecast' || !Number.isFinite(now))
        return missing('unavailable');
    const checked = Date.parse(card.checkedAt), issued = Date.parse(card.sourceUpdatedAt ?? ''), end = Date.parse(card.validTo);
    if (!Number.isFinite(checked) || checked > now + 5000 || !Number.isFinite(issued) || issued > now + 300000 || !Number.isFinite(end))
        return missing('unavailable');
    const expires = Math.min(end, checked + 18 * 3600000, issued + 18 * 3600000);
    if (expires <= now)
        return missing('expired');
    if (!validWeatherSymbols(card.weatherSymbols, card.validFrom, card.validTo))
        return missing('unavailable', expires);
    const current = card.weatherSymbols.find(row => Date.parse(row.at) <= now && now < Date.parse(row.at) + 3600000);
    const nextTimes = [expires, ...card.weatherSymbols.flatMap(row => [Date.parse(row.at), Date.parse(row.at) + 3600000])].filter(at => at > now);
    const nextAt = nextTimes.length ? Math.min(...nextTimes) : null;
    return current ? { ...weatherVisual(current.symbol), state: 'current', symbol: current.symbol, nextAt } : missing('unavailable', nextAt);
}
/** The pure weather projection is available even in SSR/test environments without a URL. */
const motionLocale = () => { try { return getLocale(); } catch { return 'en'; } };
const NS = 'http://www.w3.org/2000/svg';
function svgElement(name, attributes = {}) {
    const node = document.createElementNS(NS, name);
    for (const [key, value] of Object.entries(attributes))
        node.setAttribute(key, value);
    return node;
}
function graphic(view) {
    const svg = svgElement('svg', { viewBox: '0 0 112 80', 'aria-hidden': 'true', focusable: 'false', class: 'weather-graphic' });
    const path = (d, className = '') => svgElement('path', { d, ...(className ? { class: className } : {}) });
    if (view.condition === 'unknown') {
        svg.append(svgElement('circle', { cx: '56', cy: '37', r: '19', class: 'weather-outline weather-muted' }), path('M48 37h16', 'weather-outline weather-muted'));
        return svg;
    }
    const celestial = view.condition === 'clear' || view.condition === 'fair' || view.condition === 'partly-cloudy' || view.precipitation !== null && view.light !== 'unspecified';
    if (celestial) {
        const group = svgElement('g', { class: 'weather-celestial' }), x = view.condition === 'clear' ? 56 : 75, y = view.condition === 'clear' ? 37 : 25;
        if (view.light === 'night') {
            group.append(path(`M${x + 8} ${y - 15}a17 17 0 1 0 8 27a16 16 0 0 1-8-27Z`, 'weather-outline weather-moon'));
            group.append(path(`M${x - 21} ${y - 18}v6m-3-3h6m35 11v4m-2-2h4`, 'weather-outline weather-loop weather-stars'));
        }
        else if (view.light === 'twilight') {
            group.append(path(`M${x - 13} ${y + 4}a13 13 0 0 1 26 0m-31 3h36m-29 6h22`, 'weather-outline weather-accent weather-loop weather-haze'));
        }
        else if (view.light === 'day') {
            group.append(svgElement('circle', { cx: String(x), cy: String(y), r: '11', class: 'weather-sun weather-accent' }));
            const rays = svgElement('g', { class: 'weather-outline weather-accent weather-loop weather-rays' });
            rays.append(path(`M${x} ${y - 24}v6m0 36v6m-24-24h6m36 0h6m-41-17 4 4m26 26 4 4m0-34-4 4m-26 26-4 4`));
            group.append(rays);
        }
        svg.append(group);
    }
    if (view.condition !== 'clear') {
        const cloud = svgElement('g', { class: 'weather-loop weather-cloud' });
        cloud.append(path('M30 52a13 13 0 1 1 1-26a19 19 0 0 1 36-2a14 14 0 1 1 9 28Z', 'weather-outline weather-cloud-shape'));
        svg.append(cloud);
    }
    if (view.condition === 'fog') {
        const fog = svgElement('g', { class: 'weather-outline weather-loop weather-haze' });
        fog.append(path('M24 57h56m-47 8h57m-67 8h48'));
        svg.append(fog);
    }
    if (view.precipitation === 'rain' || view.precipitation === 'sleet') {
        const rain = svgElement('g', { class: 'weather-outline weather-accent weather-loop weather-rain' });
        rain.append(path('M37 59l-4 9m22-9-4 9m22-9-4 9'));
        svg.append(rain);
    }
    if (view.precipitation === 'snow' || view.precipitation === 'sleet') {
        const snow = svgElement('g', { class: 'weather-outline weather-loop weather-snow' });
        for (const [x, y] of (view.precipitation === 'sleet' ? [[45, 65], [78, 66]] : [[35, 65], [56, 69], [77, 63]]))
            snow.append(path(`M${x} ${Number(y) - 3}v6m-3-3h6`));
        svg.append(snow);
    }
    if (view.condition === 'thunder')
        svg.append(path('M59 47l-10 17h9l-5 12 19-22H61l6-7Z', 'weather-bolt weather-accent'));
    return svg;
}
const mounted = new Map();
let initialized = false, scheduled = false, timer, reduced = null;
/** Shared observer/timer prevents detached card renderers from leaving animations or timers behind. */
function syncAll() {
    scheduled = false;
    clearTimeout(timer);
    const now = Date.now();
    let next = Infinity;
    const dialogs = [...document.querySelectorAll('dialog[open]')];
    for (const [element, entry] of mounted) {
        if (!element.isConnected) {
            mounted.delete(element);
            continue;
        }
        const view = weatherPresentation(entry.card, now), key = JSON.stringify([view.state, view.symbol, motionLocale()]);
        if (entry.key !== key) {
            renderMotion(element, view);
            entry.key = key;
        }
        const rect = element.getBoundingClientRect(), visible = document.visibilityState === 'visible' && element.getClientRects().length > 0 && rect.bottom > 0 && rect.top < innerHeight && (!dialogs.length || dialogs.some(dialog => dialog.contains(element)));
        element.dataset.active = String(visible && !reduced?.matches && view.state === 'current');
        if (visible && view.nextAt !== null)
            next = Math.min(next, view.nextAt);
    }
    if (Number.isFinite(next))
        timer = setTimeout(syncAll, Math.min(2147483647, Math.max(25, next - now + 5)));
}
function schedule() { if (scheduled)
    return; scheduled = true; queueMicrotask(syncAll); }
function initialize() {
    if (initialized)
        return;
    initialized = true;
    reduced = matchMedia('(prefers-reduced-motion: reduce)');
    reduced.addEventListener('change', schedule);
    document.addEventListener('visibilitychange', schedule);
    document.addEventListener('dlkt:language-changed', schedule);
    window.addEventListener('pageshow', schedule);
    window.addEventListener('pagehide', () => { clearTimeout(timer); for (const element of mounted.keys())
        element.dataset.active = 'false'; });
    window.addEventListener('resize', schedule);
    document.addEventListener('scroll', schedule, { passive: true, capture: true });
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['open', 'hidden'] });
}
function renderMotion(element, view) {
    const copy = document.createElement('span');
    copy.className = 'weather-motion-copy';
    const ro = motionLocale() === 'ro';
    const caption = document.createElement('small');
    caption.textContent = ro ? (view.state === 'current' ? 'Prognoza pentru aceasta ora' : 'Starea prognozei') : (view.state === 'current' ? 'Forecast this hour' : 'Forecast condition');
    const romanian = { clear: 'Senin', fair: 'Mai mult senin', 'partly-cloudy': 'Partial noros', cloudy: 'Innorat', fog: 'Ceata', rain: 'Ploaie', snow: 'Ninsoare', sleet: 'Lapovita', thunder: 'Furtuna', unknown: 'Conditie indisponibila' };
    const roLabel = view.state === 'expired' ? 'Prognoza expirata' : view.state === 'unavailable' ? 'Conditie indisponibila' : romanian[view.condition] + (view.light === 'night' ? ' · Noaptea' : '');
    const label = document.createElement('strong');
    label.textContent = ro ? roLabel : view.label;
    copy.append(caption, label);
    element.replaceChildren(graphic(view), copy);
    element.dataset.condition = view.condition;
    element.dataset.state = view.state;
    element.dataset.light = view.light;
    element.dataset.active = 'false';
    element.title = view.state === 'current' ? 'MET Norway forecast for the current hourly interval, not measured conditions.' : 'No verified condition symbol for this hour. Numerical forecast values may remain available.';
}
export function updateWeatherMotion(element, card, now = Date.now()) {
    initialize();
    const view = weatherPresentation(card, now), key = JSON.stringify([view.state, view.symbol, motionLocale()]), previous = mounted.get(element);
    if (previous?.key !== key)
        renderMotion(element, view);
    mounted.set(element, { card, key });
    schedule();
}
export function weatherMotionNode(card, now = Date.now(), compact = false) {
    const element = document.createElement('span');
    element.className = 'weather-motion' + (compact ? ' weather-motion-compact' : '');
    updateWeatherMotion(element, card, now);
    return element;
}
