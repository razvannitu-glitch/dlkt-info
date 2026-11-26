import { watchCardPhotos } from './card-photo-browser.js';
import { PUBLIC_ORIGIN, parseCardReference, parseKnowledgeCardReference, knowledgeReferencePath } from './shared-card-link.js';
const button = document.getElementById('shared-copy'), input = document.getElementById('shared-fallback'), message = document.getElementById('shared-message'), freshness = document.getElementById('shared-freshness');
let timer;
function checkAge() {
    clearTimeout(timer);
    if (!freshness)
        return;
    const until = Number(freshness.dataset.validUntil);
    if (!Number.isFinite(until))
        return;
    if (Date.now() >= until) {
        freshness.textContent = freshness.dataset.expiredMessage ?? 'This source check has expired. The text below is the previously checked listing. Use Check current listing before relying on its current status.';
        freshness.className = 'status';
        return;
    }
    if (document.visibilityState === 'visible')
        timer = setTimeout(checkAge, Math.min(2147483647, Math.max(25, until - Date.now() + 25)));
}
if (button instanceof HTMLButtonElement && input instanceof HTMLInputElement && message) {
    const url = button.dataset.cardUrl;
    let safe = false;
    try {
        if (url) {
            const u = new URL(url);
            const knowledge = parseKnowledgeCardReference(u.pathname + u.search);
            safe = u.origin === PUBLIC_ORIGIN && (parseCardReference(u.pathname + u.search) !== null || knowledge !== null && url === PUBLIC_ORIGIN + knowledgeReferencePath(knowledge));
        }
    }
    catch { /* Do not copy a malformed destination. */ }
    if (safe && url) {
        button.hidden = false;
        button.addEventListener('click', () => { const fallback = () => { input.value = url; input.hidden = false; input.focus(); input.select(); message.textContent = button.dataset.copyFallback ?? 'Copy the selected link. It contains no personal briefing data.'; }; button.disabled = true; void (async () => { try {
            if (!navigator.clipboard?.writeText) {
                fallback();
                return;
            }
            await navigator.clipboard.writeText(url);
            message.textContent = button.dataset.copySuccess ?? 'DLKT card link copied.';
        }
        catch {
            fallback();
        }
        finally {
            button.disabled = false;
        } })(); });
    }
}
checkAge();
document.addEventListener('visibilitychange', checkAge);
window.addEventListener('pageshow', checkAge);
watchCardPhotos(document);
