import { displayPhotoFor } from './card-photo-catalog.js';
import { articlePhotoPath } from './article-photo-reference.js';
import { safeLink } from './card-validation.js';
import { newsSourceForUrl } from './local-news-policy.js';
import { arcubPhotoSource } from './local-photo-reference.js';
import { translate as tr, getLocale } from './i18n-browser.js';
const watched = new WeakSet();
/** Cover parser-time errors as well as failures after lazy loading; retain all text/actions. */
export function watchCardPhotos(root) {
    for (const image of [...root.querySelectorAll('img[data-reviewed-photo]'), ...root.querySelectorAll('img[data-article-photo]')]) {
        if (watched.has(image))
            continue;
        watched.add(image);
        const remove = () => {
            const figure = image.closest('.card-photo');
            if (!figure)
                return;
            figure.dataset.photoFailed = 'true';
            if (figure.querySelector('.card-photo-headline')) {
                retainHeadlineWithoutImage(figure);
                return;
            }
            // Legacy/shared figures contain only photographic material, never the article title.
            figure.hidden = true;
            figure.remove();
        };
        const loaded = () => {
            if (image.dataset.articlePhoto === undefined)
                return;
            const figure = image.closest('.card-photo');
            if (!figure || figure.dataset.photoFailed === 'true')
                return;
            const badge = figure.querySelector('.card-photo-label');
            if (badge)
                badge.hidden = false;
            const caption = figure.querySelector('.card-photo-caption');
            if (caption)
                caption.hidden = false;
        };
        image.addEventListener('error', remove, { once: true });
        image.addEventListener('load', loaded, { once: true });
        queueMicrotask(() => { if (image.complete) {
            if (image.naturalWidth === 0)
                remove();
            else
                loaded();
        } });
    }
}
function retainHeadlineWithoutImage(figure) {
    figure.hidden = false;
    figure.classList.add('photo-unavailable');
    const frame = figure.querySelector('.card-photo-frame');
    if (frame)
        frame.hidden = true;
    const badge = figure.querySelector('.card-photo-label');
    if (badge)
        badge.hidden = true;
}
/** Relocate the existing heading/header without recreating their links, IDs or listeners. */
export function integratePhotoHeadline(figure, heading, header) {
    const frame = figure.querySelector('.card-photo-frame');
    if (!frame)
        return;
    let visual = figure.querySelector('.card-photo-visual');
    if (!visual) {
        visual = document.createElement('div');
        visual.className = 'card-photo-visual';
        frame.before(visual);
        visual.append(frame);
    }
    if (header) {
        header.classList.add('card-photo-overline');
        visual.prepend(header);
    }
    let headline = visual.querySelector('.card-photo-headline');
    if (!headline) {
        headline = document.createElement('div');
        headline.className = 'card-photo-headline';
        visual.append(headline);
    }
    headline.append(heading);
    figure.classList.add('photo-editorial');
    // A layout hint only: the complete text remains in the same heading at every width.
    figure.classList.toggle('photo-title-long', (heading.textContent ?? '').trim().length > 96);
    if (figure.dataset.photoFailed === 'true')
        retainHeadlineWithoutImage(figure);
}
export function photoNode(card, now = Date.now()) {
    if (!Number.isFinite(now))
        return null;
    const p = displayPhotoFor(card, now);
    if (p)
        return renderPhotoNode(p);
    return card.kind === 'publication' ? renderArticlePhotoNode(card, { id: card.id, revision: card.contentHash }) : null;
}
/** Local article identity comes from its checked source record, never from a title/category guess. */
export function contextPhotoNode(card, now = Date.now(), reference) {
    return Number.isFinite(now) && reference !== undefined ? renderArticlePhotoNode(card, reference) : null;
}
function renderArticlePhotoNode(card, reference) {
    if (!card.sourceUrl)
        return null;
    let path;
    try {
        path = articlePhotoPath(reference);
    }
    catch {
        return null;
    }
    const localSource = reference.cityId === undefined ? undefined : newsSourceForUrl(card.sourceUrl);
    const source = reference.cityId === undefined ? safeLink(card.sourceUrl) : (localSource && localSource.cityId === reference.cityId && reference.id.startsWith('local-news:' + localSource.cityId + ':' + localSource.id + ':') || arcubPhotoSource(card.sourceUrl, reference)) ? card.sourceUrl : null;
    if (!source)
        return null;
    const figure = document.createElement('figure');
    figure.className = 'card-photo';
    figure.dataset.photoKind = 'source';
    figure.dataset.photoId = 'article:' + reference.id + ':' + reference.revision;
    const frame = document.createElement('div');
    frame.className = 'card-photo-frame';
    const image = document.createElement('img');
    image.src = path;
    image.alt = tr('photoSourceLabel');
    image.lang = getLocale();
    image.width = 960;
    image.height = 540;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.dataset.articlePhoto = reference.id;
    frame.append(image);
    const badge = document.createElement('span');
    badge.className = 'card-photo-label';
    badge.dataset.i18n = 'photoSourceLabel';
    badge.textContent = tr('photoSourceLabel');
    badge.hidden = true;
    frame.append(badge);
    const caption = document.createElement('figcaption');
    caption.className = 'card-photo-caption';
    caption.hidden = true;
    const credit = photoLink(tr('photoSourceLabel'), source);
    credit.dataset.i18n = 'photoSourceLabel';
    caption.append(credit);
    figure.append(frame, caption);
    watchCardPhotos(figure);
    return figure;
}
function renderPhotoNode(p) {
    const figure = document.createElement('figure');
    figure.className = `card-photo${p.fit === 'contain' ? ' photo-contain' : ''}`;
    figure.dataset.photoId = p.key;
    figure.dataset.photoKind = 'kind' in p ? p.kind : 'source';
    const frame = document.createElement('div');
    frame.className = 'card-photo-frame';
    const image = document.createElement('img');
    image.src = p.path;
    image.alt = p.alt;
    image.lang = 'en';
    image.translate = false;
    image.width = p.width;
    image.height = p.height;
    image.loading = 'lazy';
    image.decoding = 'async';
    image.referrerPolicy = 'no-referrer';
    image.dataset.reviewedPhoto = p.key;
    frame.append(image);
    const badge = document.createElement('span');
    badge.className = 'card-photo-label';
    const label = photoLabel(p);
    badge.textContent = tr(label.key, label.year === undefined ? undefined : { year: label.year });
    badge.dataset.i18n = label.key;
    if (label.year !== undefined)
        badge.dataset.i18nYear = label.year;
    frame.append(badge);
    const caption = document.createElement('figcaption');
    caption.className = 'card-photo-caption';
    const credit = document.createElement('span');
    credit.className = 'card-photo-credit';
    const creditLabel = document.createElement('span');
    creditLabel.dataset.i18n = 'photoCreditLabel';
    creditLabel.textContent = tr('photoCreditLabel');
    credit.append(creditLabel, document.createTextNode(' '), photoLink(p.credit, p.creditUrl), document.createTextNode(' · '), photoLink(p.license, p.licenseUrl));
    const details = document.createElement('details');
    details.className = 'photo-details';
    const summary = document.createElement('summary');
    summary.dataset.i18n = 'photoDetailsLabel';
    summary.textContent = tr('photoDetailsLabel');
    const description = document.createElement('p');
    description.lang = 'en';
    description.translate = false;
    description.textContent = `${p.caption} ${p.changeNote}`;
    details.append(summary, description);
    caption.append(credit);
    if ('kind' in p) {
        const note = document.createElement('p');
        note.className = 'card-photo-note';
        const key = p.kind === 'editorial' ? 'photoEditorialNote' : 'photoContextNote';
        note.dataset.i18n = key;
        note.textContent = tr(key);
        caption.append(note);
    }
    caption.append(details);
    figure.append(frame, caption);
    watchCardPhotos(figure);
    return figure;
}
function photoLink(label, url) {
    const link = document.createElement('a');
    link.textContent = label;
    link.href = url;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    return link;
}
function photoLabel(p) {
    if ('kind' in p)
        return { key: p.kind === 'editorial' ? 'photoEditorialLabel' : 'photoContextLabel' };
    // Only expose an archival year already stated explicitly in the reviewed caption.
    const year = /\(((?:19|20)\d{2})\)/u.exec(p.caption)?.[1];
    if (year && Number(year) < Number(p.articleDate.slice(0, 4)))
        return { key: 'photoArchiveLabel', year };
    return { key: /source photo collage/iu.test(p.caption) ? 'photoCollageLabel' : 'photoSourceLabel' };
}
