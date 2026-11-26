import { watchCardPhotos } from './card-photo-browser.js';
import { PUBLIC_ORIGIN, parseCardReference, parseKnowledgeCardReference, knowledgeReferencePath } from './shared-card-link.js';
const button = document.getElementById('shared-copy'), input = document.getElementById('shared-fallback'), message = document.getElementById('shared-message'), freshness = document.getElementById('shared-freshness');
const standalone = document.querySelector('[data-shared-knowledge-id]') !== null;
const social = standalone ? [...document.querySelectorAll('a[data-knowledge-share-url]')] : [];
let timer, standaloneExpired = false;
function disableStandalone() {
    standaloneExpired = true;
    clearTimeout(timer);
    if (button instanceof HTMLButtonElement) {
        button.disabled = true;
        button.hidden = true;
    }
    if (input instanceof HTMLInputElement) {
        input.value = '';
        input.hidden = true;
        input.disabled = true;
    }
    for (const link of social) {
        link.removeAttribute('href');
        link.setAttribute('aria-disabled', 'true');
        link.tabIndex = -1;
    }
    const expired = freshness?.dataset.expiredMessage ?? 'This editorial link is no longer available.';
    if (freshness) {
        freshness.textContent = expired;
        freshness.className = 'status';
    }
    if (message)
        message.textContent = expired;
}
/** Check again at every action, not only on the timer. Never re-enable after expiry. */
function canShareKnowledge() {
    if (!standalone)
        return true;
    const until = Number(freshness?.dataset.validUntil), now = Date.now();
    if (standaloneExpired || !Number.isSafeInteger(until) || !Number.isSafeInteger(now) || now >= until) {
        disableStandalone();
        return false;
    }
    return true;
}
function guardKnowledgeAction(event) {
    if (!canShareKnowledge()) {
        event.preventDefault();
        event.stopImmediatePropagation();
    }
}
function checkAge() {
    clearTimeout(timer);
    if (!canShareKnowledge() || !freshness)
        return;
    const until = Number(freshness.dataset.validUntil);
    if (!Number.isFinite(until))
        return;
    if (Date.now() >= until) {
        if (standalone) {
            disableStandalone();
            return;
        }
        freshness.textContent = 'This source check has expired. The text below is the previously checked listing. Use Check current listing before relying on its current status.';
        freshness.className = 'status';
        return;
    }
    if (document.visibilityState === 'visible')
        timer = setTimeout(checkAge, Math.min(2147483647, Math.max(standalone ? 1 : 25, until - Date.now() + (standalone ? 0 : 25))));
}
if (button instanceof HTMLButtonElement && input instanceof HTMLInputElement && message) {
    const url = button.dataset.cardUrl;
    let safe = false;
    try {
        if (url) {
            const u = new URL(url), knowledge = parseKnowledgeCardReference(u.pathname + u.search);
            safe = u.origin === PUBLIC_ORIGIN && (standalone ? knowledge !== null && url === PUBLIC_ORIGIN + knowledgeReferencePath(knowledge) : parseCardReference(u.pathname + u.search) !== null);
        }
    }
    catch { /* Do not copy a malformed destination. */ }
    if (safe && url && canShareKnowledge()) {
        button.hidden = false;
        button.disabled = false;
        button.addEventListener('click', () => {
            if (!canShareKnowledge())
                return;
            const fallback = () => { if (!canShareKnowledge())
                return; input.value = url; input.hidden = false; input.focus(); input.select(); message.textContent = button.dataset.copyFallback ?? 'Copy the selected link. It contains no personal briefing data.'; };
            button.disabled = true;
            void (async () => { try {
                if (!navigator.clipboard?.writeText) {
                    fallback();
                    return;
                }
                if (!canShareKnowledge())
                    return;
                await navigator.clipboard.writeText(url);
                if (canShareKnowledge())
                    message.textContent = button.dataset.copySuccess ?? 'DLKT card link copied.';
            }
            catch {
                fallback();
            }
            finally {
                if (canShareKnowledge())
                    button.disabled = false;
            } })();
        });
        if (standalone) {
            // The fallback is a real manual clipboard surface, not just a display field.
            for (const type of ['copy', 'cut', 'keydown', 'pointerdown', 'contextmenu'])
                input.addEventListener(type, guardKnowledgeAction, { capture: true });
        }
        if (standalone)
            for (const link of social) {
                const destination = link.dataset.knowledgeShareUrl;
                if (!destination)
                    continue;
                for (const type of ['click', 'auxclick', 'pointerdown', 'keydown', 'contextmenu'])
                    link.addEventListener(type, guardKnowledgeAction, { capture: true });
                if (canShareKnowledge()) {
                    link.href = destination;
                    link.setAttribute('aria-disabled', 'false');
                    link.tabIndex = 0;
                }
            }
    }
    else if (standalone)
        disableStandalone();
}
else if (standalone)
    disableStandalone();
checkAge();
document.addEventListener('visibilitychange', checkAge);
window.addEventListener('pageshow', checkAge);
if (standalone) {
    window.addEventListener('focus', checkAge);
    document.addEventListener('focusin', checkAge);
}
watchCardPhotos(document);
