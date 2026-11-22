import { COMMERCIAL_COPY, commercialAreaFromSearch, commercialLanguage, commercialRequestUrl, prepareCommercialRequest, validCommercialArea } from './commercial.js';
function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
export function commercialCardNode(area, language) {
    if (!validCommercialArea(area))
        throw Error('COMMERCIAL_AREA_INVALID');
    const copy = COMMERCIAL_COPY[commercialLanguage(language)], node = element('article', 'info-card commercial-invitation');
    node.id = 'local-commercial-invitation';
    node.dataset.commercial = 'invitation';
    node.dataset.liveSignature = JSON.stringify([area, commercialLanguage(language)]);
    const label = element('p', 'commercial-label', copy.label), place = element('p', 'commercial-area', area.city + ' · ' + area.country);
    const heading = element('h3', '', copy.title);
    heading.id = 'local-commercial-title';
    node.setAttribute('aria-labelledby', heading.id);
    const content = element('div', 'commercial-content');
    content.append(label, place, heading, element('p', 'commercial-copy', copy.body + ' ' + area.city + '.'));
    const action = element('a', 'commercial-action', copy.action);
    action.href = commercialRequestUrl(area, language);
    content.append(action, element('p', 'commercial-note', copy.note));
    node.append(content);
    return node;
}
export function setupCommercialRequest() {
    const host = document.getElementById('commercial-form');
    if (!host)
        return;
    const query = new URLSearchParams(window.location.search), language = commercialLanguage(query.getAll('lang').length === 1 ? query.get('lang') : 'en'), copy = COMMERCIAL_COPY[language];
    const section = document.getElementById('advertise');
    if (section)
        section.lang = language;
    section?.querySelectorAll('[data-commercial-copy]').forEach(node => {
        const key = node.dataset.commercialCopy;
        if (key && Object.hasOwn(copy, key))
            node.textContent = copy[key];
    });
    const required = (id) => { const node = document.getElementById(id); if (!node)
        throw Error('COMMERCIAL_ELEMENT_MISSING'); return node; };
    const fields = { business: required('commercial-business'), city: required('commercial-city'), country: required('commercial-country'), offer: required('commercial-offer'), destination: required('commercial-destination'), validUntil: required('commercial-valid-until') };
    const area = commercialAreaFromSearch(window.location.search);
    if (area) {
        fields.city.value = area.city;
        fields.country.value = area.country;
    }
    const panel = required('commercial-request'), text = required('commercial-request-text'), email = required('commercial-email'), feedback = required('commercial-feedback'), copyStatus = required('commercial-copy-status');
    const invalidate = () => { panel.hidden = true; text.value = ''; email.removeAttribute('href'); feedback.textContent = ''; copyStatus.textContent = ''; };
    host.addEventListener('input', invalidate);
    required('commercial-prepare').addEventListener('click', () => {
        for (const input of Object.values(fields))
            if (!input.reportValidity())
                return;
        const value = Object.fromEntries(Object.entries(fields).map(([key, input]) => [key, input.value.trim()]));
        const request = prepareCommercialRequest(value);
        if (!request) {
            feedback.textContent = copy.invalid;
            return;
        }
        text.value = request.body;
        email.href = request.mailto;
        panel.hidden = false;
        feedback.textContent = copy.ready;
        text.focus();
    });
    required('commercial-copy').addEventListener('click', () => {
        if (panel.hidden || !text.value)
            return;
        void (async () => { try {
            if (!navigator.clipboard?.writeText)
                throw Error('CLIPBOARD_UNAVAILABLE');
            await navigator.clipboard.writeText(text.value);
            copyStatus.textContent = copy.copied;
        }
        catch {
            text.focus();
            text.select();
            copyStatus.textContent = copy.copyFailed;
        } })();
    });
}
