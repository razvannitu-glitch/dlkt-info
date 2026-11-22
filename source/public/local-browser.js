import { initializeCurrentCity } from './local-startup.js';
import { localCardNode } from './local-card-node.js';
import { localDiscovery, cardInterest } from './local-discovery.js';
import { contextPhotoNode } from './card-photo-browser.js';
import { object, validCity, validLocalSnapshot, currentLocalSnapshot, localCoverageNotes } from './local-contracts.js';
import { localCoverageReading, localDiscoveryLabel } from './local-presentation.js';
import { readLocalMemory, writeLocalMemory, compareLocal } from './local-memory.js';
const node = (tag, text = '', className = '') => { const n = document.createElement(tag); n.textContent = text; n.className = className; return n; };
function get(id) { const n = document.getElementById(id); if (!n)
    throw Error('LOCAL_ELEMENT_MISSING'); return n; }
async function json(url, init = {}) { const response = await fetch(url, { credentials: 'omit', ...init, headers: { Accept: 'application/json', ...init.headers }, signal: init.signal ? AbortSignal.any([init.signal, AbortSignal.timeout(20000)]) : AbortSignal.timeout(20000) }); if (!response.ok)
    throw Error('LOCAL_REQUEST_FAILED'); const text = await response.text(); if (text.length > 150000)
    throw Error('LOCAL_RESPONSE_TOO_LARGE'); return JSON.parse(text); }
const format = (time, zone) => new Intl.DateTimeFormat('en-GB', { timeZone: zone, month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZoneName: 'short' }).format(new Date(time));
/** Directory references retain their own source; a generic photo never claims to show the venue. */
export function renderLocalPlace(place, c, placeCheck = null, now = Date.now()) {
    const article = node('article', '', 'info-card local-card local-place');
    article.dataset.placeId = place.id;
    const category = place.category === 'outdoors' ? 'environment' : place.category;
    article.dataset.editorialCategory = category;
    const head = node('header');
    head.append(node('span', place.category === 'food' ? 'Food & drink' : place.category === 'culture' ? 'Arts & museums' : 'Outdoors', 'card-topic'), node('span', 'Place reference', 'card-index'));
    const body = node('div', '', 'card-content');
    body.append(node('h3', place.name), node('p', `${place.type.charAt(0).toUpperCase() + place.type.slice(1)}${place.address ? ' · ' + place.address : ''}`, 'card-context'), node('p', `${place.source === 'wikidata' ? 'Reference place in ' + c.name : 'Mapped near ' + c.name + ' city centre'}. Check opening hours, access and bookings with the venue.`, 'card-context'));
    const link = node('a', 'Explore this place ↗', 'source-link');
    link.href = place.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    body.append(link, node('p', place.source === 'wikidata' ? 'Wikidata structured data · CC0. Reference reviewed 17 November 2026. Confirm current venue details at the source.' : '© OpenStreetMap contributors · ODbL. A map entry, not an open-now check, recommendation or scheduled event.', 'card-boundary'));
    if (placeCheck?.checkedAt)
        body.append(node('p', `Map fetched ${format(placeCheck.checkedAt, c.timezone)}. Data as of ${placeCheck.dataAsOf ? format(placeCheck.dataAsOf, c.timezone) : 'unknown'}.`, 'card-date'));
    const sharing = node('details', '', 'evidence');
    sharing.append(node('summary', 'Share this place'));
    const native = node('button', 'Share place', 'text-button');
    native.type = 'button';
    const feedback = node('p', '', 'privacy-note');
    feedback.setAttribute('role', 'status');
    native.addEventListener('click', () => { void (async () => { try {
        if (navigator.share) {
            await navigator.share({ title: place.name, text: `${place.name} · discovered with DLKT. Check details at the source.`, url: place.sourceUrl });
            feedback.textContent = 'Share sheet opened.';
        }
        else {
            await navigator.clipboard.writeText(place.sourceUrl);
            feedback.textContent = 'Place link copied.';
        }
    }
    catch (error) {
        feedback.textContent = error instanceof DOMException && error.name === 'AbortError' ? 'Sharing cancelled.' : 'Sharing is unavailable here. Use a network link or open the source.';
    } })(); });
    sharing.append(native);
    for (const [name, href] of [['Facebook', 'https://www.facebook.com/sharer/sharer.php?u=' + encodeURIComponent(place.sourceUrl)], ['X', 'https://twitter.com/intent/tweet?url=' + encodeURIComponent(place.sourceUrl) + '&text=' + encodeURIComponent(place.name + ' · DLKT')], ['Threads', 'https://www.threads.net/intent/post?text=' + encodeURIComponent(place.name + ' · DLKT ' + place.sourceUrl)]]) {
        if (!name || !href)
            continue;
        const link = node('a', name, 'text-button');
        link.href = href;
        link.target = '_blank';
        link.rel = 'noopener noreferrer';
        sharing.append(link);
    }
    sharing.append(feedback);
    article.append(head);
    // Venue names can contain people, sports or place words without supplying image evidence.
    const photograph = contextPhotoNode({ title: '', sourceUrl: place.sourceUrl, editorialCategory: category }, now);
    if (photograph)
        article.append(photograph);
    article.append(body, sharing);
    return article;
}
export function setupLocal() {
    const chooser = get('place-dialog'), input = get('place-query'), results = get('place-results'), message = get('place-message'), location = get('choose-place'), section = get('local-briefing'), cards = get('local-cards'), status = get('local-status'), follow = get('follow-place'), forget = get('forget-place'), refresh = get('refresh-local'), difference = get('local-changes');
    let expiryTimer, manualSelection = false, autoSuppressed = document.body.dataset.entryView !== 'start';
    let city = null, snapshot = null, memory = null, sequence = 0, searchSequence = 0, lookup = null, timer, busy = false, storageFailed = false, storageLoaded = false, estimatedCity = false;
    let interest = 'all';
    document.addEventListener('input', event => { if (event.target instanceof Element && event.target.closest('#entry-search,#place-dialog'))
        autoSuppressed = true; }, { capture: true });
    document.addEventListener('dlkt:entry-view', event => { if (event instanceof CustomEvent && object(event.detail) && event.detail.view !== 'start')
        autoSuppressed = true; });
    const feedback = (text) => { get('local-feedback').textContent = text; };
    const interests = get('local-interests');
    interests.addEventListener('click', event => { const target = event.target; if (!(target instanceof Element))
        return; const button = target.closest('[data-local-interest]'); if (!button)
        return; const value = button.dataset.localInterest; if (!['all', 'events', 'food', 'culture', 'administration', 'transport', 'outdoors', 'local'].includes(value ?? ''))
        return; interest = value; for (const b of interests.querySelectorAll('button'))
        b.setAttribute('aria-pressed', String(b === button)); render(); });
    const open = () => { if (!chooser.open)
        chooser.showModal(); input.focus(); };
    location.addEventListener('click', open);
    get('close-place').addEventListener('click', () => chooser.close());
    chooser.addEventListener('click', e => { if (e.target === chooser) {
        const r = chooser.getBoundingClientRect();
        if (e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom)
            chooser.close();
    } });
    function showCandidates(list, nearby = false) { results.replaceChildren(); for (const c of list) {
        const b = node('button', `${c.name} · ${c.region} · ${c.country}`, 'secondary place-option');
        b.type = 'button';
        b.dataset.cityId = c.id;
        b.addEventListener('click', () => { ++searchSequence; lookup?.abort(); chooser.close(); void select(c); });
        results.append(b);
    } message.textContent = list.length ? (nearby ? 'Nearby city centres. Choose the correct city; proximity does not establish your address.' : 'Choose your city. Nothing is selected automatically.') : 'No matching city in this catalog. Try another spelling or a nearby listed city.'; }
    async function search() { const q = input.value.trim(), ticket = ++searchSequence; lookup?.abort(); results.replaceChildren(); if (!q) {
        message.textContent = 'Start typing a city. Suggestions begin with the first letter.';
        return;
    } lookup = new AbortController(); message.textContent = 'Finding cities…'; try {
        const data = await json('/api/places?q=' + encodeURIComponent(q), { signal: lookup.signal });
        if (ticket !== searchSequence)
            return;
        if (!object(data) || !Array.isArray(data.cities) || !data.cities.every(validCity))
            throw Error('CITY_RESPONSE_INVALID');
        showCandidates(data.cities);
    }
    catch (e) {
        if (ticket !== searchSequence || e instanceof DOMException && e.name === 'AbortError')
            return;
        message.textContent = 'City search is unavailable. Your existing selection has not changed.';
    } }
    input.addEventListener('input', () => { clearTimeout(timer); ++searchSequence; lookup?.abort(); timer = setTimeout(() => { void search(); }, 100); });
    get('locate-place').addEventListener('click', () => { if (!navigator.geolocation) {
        message.textContent = 'Location is not supported here. Search for your city instead.';
        return;
    } const ticket = ++searchSequence; lookup?.abort(); results.replaceChildren(); message.textContent = 'Waiting for location permission…'; navigator.geolocation.getCurrentPosition(position => { if (ticket !== searchSequence)
        return; const { latitude, longitude, accuracy } = position.coords; if (!Number.isFinite(accuracy) || accuracy > 5000 || Date.now() - position.timestamp > 120000 || position.timestamp > Date.now() + 5000) {
        message.textContent = 'The position is old or too imprecise. Choose your city manually.';
        return;
    } void (async () => { try {
        const data = await json('/api/places', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-DLKT-Info-Request': 'local-place-1' }, body: JSON.stringify({ lat: Math.round(latitude * 100) / 100, lon: Math.round(longitude * 100) / 100, accuracy, timestamp: position.timestamp }) });
        if (ticket !== searchSequence)
            return;
        if (!object(data) || !Array.isArray(data.nearby) || !data.nearby.every(r => object(r) && validCity(r.city)))
            throw Error('CITY_RESPONSE_INVALID');
        showCandidates(data.nearby.map(r => r.city), true);
    }
    catch {
        message.textContent = 'Nearby cities could not be checked. Search manually; your selection is unchanged.';
    } })(); }, error => { if (ticket !== searchSequence)
        return; message.textContent = error.code === 1 ? 'Location permission was declined. Search for your city instead.' : error.code === 3 ? 'Location request timed out. Search for your city instead.' : 'Location is unavailable. Search for your city instead.'; }, { maximumAge: 0, timeout: 10000, enableHighAccuracy: false }); });
    function renderExplore(c) {
        const explore = get('local-explore');
        explore.replaceChildren();
        const heading = node('div', '', 'local-explore-heading');
        heading.append(node('h3', 'Explore more in ' + c.name), node('p', 'Direct access to the organiser, public authority or map. These links are not live DLKT feeds.', 'privacy-note'));
        explore.append(heading);
        const grid = node('div', '', 'local-explore-grid');
        for (const item of localDiscovery(c)) {
            if (interest !== 'all' && interest !== item.interest)
                continue;
            const a = node('a', '', 'local-explore-link');
            a.href = item.url;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.append(node('span', item.title + ' ↗', 'local-explore-title'), node('span', item.note, 'local-explore-note'));
            grid.append(a);
        }
        explore.append(grid);
    }
    function render() { if (!city || !snapshot)
        return; clearTimeout(expiryTimer); const now = Date.now(); const expiries = [...snapshot.cards.map(c => Date.parse(c.validTo)), ...(snapshot.places?.validTo ? [Date.parse(snapshot.places.validTo)] : []), ...(snapshot.coverage ?? []).flatMap(item => item.checkedAt ? [Date.parse(item.checkedAt) + 300000] : [])].filter(t => t > now); if (expiries.length)
        expiryTimer = setTimeout(render, Math.min(2147483647, Math.max(25, Math.min(...expiries) - now + 25))); const current = snapshot.cards.filter(c => Date.parse(c.validTo) > now && (interest === 'all' || cardInterest(c) === interest)); cards.replaceChildren(); renderExplore(city); get('local-city-context').textContent = estimatedCity ? `Near ${city.name}? Approximate location from your connection. Change it if needed; nothing is saved automatically.` : `Your local view for ${city.name}. Change the city whenever you need.`; for (const group of ['essential', 'discover']) {
        const selected = current.filter(c => (c.context?.section ?? 'essential') === group);
        if (selected.length) {
            if (snapshot.coverage)
                cards.append(node('h3', group === 'essential' ? 'What can affect your day' : localDiscoveryLabel(selected)));
            cards.append(...selected.map(c => localCardNode(c, city)));
        }
    } const context = current.filter(c => c.context?.section === 'context'); if (context.length) {
        cards.append(node('h3', 'Recent city announcements'), ...context.map(c => localCardNode(c, city)));
    } if (snapshot.places?.state === 'reference' || snapshot.places?.state === 'ready' && snapshot.places.validTo && Date.parse(snapshot.places.validTo) > now) {
        const places = snapshot.places.items.filter(p => interest === 'all' || interest === p.category);
        if (places.length) {
            cards.append(node('h3', 'Places to explore'), ...places.map(p => renderLocalPlace(p, city, snapshot?.places ?? null, now)));
        }
    } if (!cards.children.length)
        cards.append(node('p', 'No current connected cards for this category. Explore the local sources below.', 'privacy-note')); const notes = localCoverageReading(snapshot, now); if (notes.length) {
        const overview = node('section', '', 'local-overview');
        overview.setAttribute('aria-label', 'Local source results');
        overview.append(node('h3', 'What else was checked'));
        for (const note of notes) {
            const paragraph = node('p', note.text, 'card-context');
            if (note.sourceUrl && note.domain) {
                const source = node('a', `Open ${note.domain === 'administration' ? 'council' : note.domain} source`, 'source-link');
                source.href = note.sourceUrl;
                source.target = '_blank';
                source.rel = 'noopener noreferrer';
                paragraph.append(document.createTextNode(' '), source);
            }
            overview.append(paragraph);
        }
        cards.append(overview);
    } get('local-title').textContent = `For ${city.name}`; location.textContent = `${city.name}, ${city.countryCode} · Change`; section.hidden = document.body.dataset.entryView !== 'local'; const w = snapshot.weatherState === 'unavailable' ? 'Weather could not be verified. ' : ''; const coverage = get('local-coverage'); coverage.replaceChildren(); for (const note of localCoverageNotes(snapshot))
        coverage.append(node('p', note, 'privacy-note')); for (const item of snapshot.coverage ?? []) {
        if (item.sourceUrl) {
            const a = node('a', `Open ${item.domain} source`, 'source-link');
            a.href = item.sourceUrl;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            coverage.append(a);
        }
    } const t = snapshot.coverage ? `Local sources checked for ${city.name}. Coverage and missing domains are listed in Local sources & coverage.` : snapshot.transportState === 'not-covered' ? 'Local transport and events are not connected for this city.' : snapshot.transportState === 'unavailable' ? 'Tube status is unavailable, not an all-clear.' : 'London Tube only; not all local transport. Recheck before travelling.'; status.textContent = w + t + (snapshot.places?.state === 'unavailable' ? ' Mapped places could not be loaded. Explore them at the source below.' : '') + (snapshot.cards.some(c => Date.parse(c.validTo) <= now) ? ' Some checks have expired. Refresh local before relying on them.' : ''); follow.disabled = busy || !storageLoaded || storageFailed || snapshot.state === 'unavailable' || snapshot.cards.some(c => Date.parse(c.validTo) <= now); follow.textContent = memory?.cityId === city.id ? 'Update saved comparison' : 'Remember city & compare here'; forget.hidden = !memory; difference.replaceChildren(); if (memory?.cityId === city.id) {
        const changes = compareLocal(memory.snapshot, snapshot);
        difference.append(node('summary', changes.length ? `${changes.length} changes from your saved check` : 'Comparison with your saved check'));
        difference.append(node('p', `Saved ${format(memory.savedAt, city.timezone)}. Only matching forecast hours and identifiable local listings are compared. Missing entries do not prove an incident ended.`, 'privacy-note'));
        if (!changes.length)
            difference.append(node('p', snapshot.state === 'unavailable' ? 'Comparison unavailable.' : 'No changes in the comparable items. New time windows are not revisions; missing or expired source checks are not an all-clear.', 'privacy-note'));
        for (const change of changes)
            difference.append(node('p', change, 'privacy-note'));
        difference.hidden = false;
    }
    else
        difference.hidden = true; }
    async function select(c, restoring = false, estimated = false) { if (!restoring && !estimated)
        manualSelection = true; estimatedCity = estimated; interest = 'all'; for (const button of interests.querySelectorAll('button'))
        button.setAttribute('aria-pressed', String(button.dataset.localInterest === 'all')); clearTimeout(expiryTimer); city = c; document.dispatchEvent(new CustomEvent('dlkt:city-selected', { detail: { city: c, restored: restoring, estimated } })); snapshot = null; cards.replaceChildren(); difference.hidden = true; section.hidden = document.body.dataset.entryView !== 'local'; get('local-title').textContent = `For ${c.name}`; location.textContent = `${c.name}, ${c.countryCode} · Change`; feedback(estimated ? 'Approximate city from your connection. Change it if needed; it has not been saved.' : 'This city is selected for this visit. Remember it only on your own browser.'); renderExplore(c); get('local-city-context').textContent = estimated ? `Near ${c.name}? Approximate location from your connection. Nothing is saved automatically.` : `Your local view for ${c.name}.`; await load(); }
    async function load() { if (!city)
        return; const requested = city, ticket = ++sequence; refresh.disabled = true; follow.disabled = true; status.textContent = 'Checking local sources…'; try {
        const value = await json('/api/local?city=' + encodeURIComponent(requested.id));
        if (ticket !== sequence)
            return;
        if (!currentLocalSnapshot(value, requested, Date.now()))
            throw Error('LOCAL_IDENTITY_INVALID');
        snapshot = value;
        document.dispatchEvent(new CustomEvent('dlkt:local-snapshot', { detail: { city: requested, snapshot: value } }));
        render();
    }
    catch {
        if (ticket !== sequence)
            return;
        snapshot = null;
        document.dispatchEvent(new CustomEvent('dlkt:local-snapshot', { detail: { city: requested, snapshot: null } }));
        clearTimeout(expiryTimer);
        cards.replaceChildren();
        difference.hidden = true;
        status.textContent = 'Local sources could not be verified. This does not mean there are no problems.';
        follow.disabled = true;
    }
    finally {
        if (ticket === sequence)
            refresh.disabled = false;
    } }
    refresh.addEventListener('click', () => { void load(); });
    follow.addEventListener('click', () => { if (!snapshot || busy || !storageLoaded || storageFailed)
        return; if (memory && !window.confirm('Replace the saved city and comparison in this browser?'))
        return; busy = true; render(); void writeLocalMemory(snapshot, memory?.revision ?? null).then(v => { memory = v; estimatedCity = false; feedback('City and comparison saved only in this browser. Checked again when you open this page or refresh; no background alerts.'); }).catch(() => { feedback('Not saved. Browser storage may be blocked or another tab changed the saved city. Reload before trying again.'); }).finally(() => { busy = false; render(); }); });
    forget.addEventListener('click', () => { if (!memory || busy || !window.confirm('Forget the saved city and local comparison? Your other saved cards stay unchanged.'))
        return; busy = true; void writeLocalMemory(null, memory.revision).then(() => { memory = null; feedback('Saved city and local comparison removed.'); }).catch(() => feedback('Removal could not be confirmed. Reload and try again.')).finally(() => { busy = false; render(); forget.hidden = !memory; }); });
    chooser.addEventListener('keydown', event => { if (event.key === 'Escape') {
        event.preventDefault();
        chooser.close();
    } });
    chooser.addEventListener('close', () => { ++searchSequence; lookup?.abort(); });
    // Public reading is independent of storage; no automatic background source polling.
    document.addEventListener('dlkt:city-request', event => { if (event instanceof CustomEvent && validCity(event.detail))
        void select(event.detail); });
    // One check when an expired page is revisited; no recurring background polling.
    const resume = () => { if (document.visibilityState !== 'visible' || !city || refresh.disabled)
        return; if (snapshot && !currentLocalSnapshot(snapshot, city, Date.now()))
        void load();
    else if (snapshot)
        render(); };
    document.addEventListener('visibilitychange', resume);
    window.addEventListener('pageshow', event => { if (event.persisted)
        resume(); });
    // Storage restores comparisons only. Its speed or an old saved city cannot choose this visit's location.
    void readLocalMemory().then(value => { memory = value; }, () => { storageFailed = true; feedback('Local storage is unavailable. City selection still works for this visit.'); }).finally(() => { storageLoaded = true; forget.hidden = !memory; if (city && snapshot)
        render(); });
    void initializeCurrentCity({
        readHint: () => json('/api/places?hint=1'),
        maySelect: () => document.body.dataset.entryView === 'start' && !city && !manualSelection && !autoSuppressed && searchSequence === 0 && !input.value.trim(),
        select: current => select(current, false, true),
    }).then(result => { if (result === 'unavailable' && !city)
        feedback('Your current city could not be identified. Choose a city to see its local edition. Saved comparisons have not changed.'); }).finally(() => { document.dispatchEvent(new CustomEvent('dlkt:location-settled')); });
}
if (typeof document !== 'undefined')
    setupLocal();
