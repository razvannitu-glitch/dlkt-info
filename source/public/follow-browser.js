import { getLocale, translate as tr, translatedCategory } from './i18n-browser.js';
import { cardLink } from './shared-card-link.js';
import { uniqueFollowStories } from './follow-stories.js';
import { sourceLanguage } from './news-sources.js';
import { nextCategoryFollowDelay, selectCategoryFollowReturn } from './category-follow.js';
function relatedLabel(followed, removing = false) {
    const ro = getLocale() === 'ro';
    return removing ? (ro ? 'Nu mai urmari stiri conexe' : 'Unfollow related coverage') : followed ? (ro ? 'Urmaresti stiri conexe' : 'Following related coverage') : (ro ? 'Urmareste stiri conexe' : 'Follow related coverage');
}
function relatedScope(category) {
    const filter = translatedCategory(category);
    return getLocale() === 'ro' ? `Filtru asociat: ${filter}. Actiunea urmareste stiri conexe prin filtrul existent, nu toate articolele categoriei afisate.` : `Associated filter: ${filter}. This follows related coverage through the existing filter, not every article in the displayed category.`;
}
function element(tag, className, text) {
    const node = document.createElement(tag);
    node.className = className;
    if (text !== undefined)
        node.textContent = text;
    return node;
}
function date(value) { return new Intl.DateTimeFormat(getLocale(), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value)); }
function itemMessage(item) {
    if (item.state === 'baseline-required')
        return tr(item.canAcknowledge ? 'followBaseline' : 'followUnavailable');
    if (item.state === 'unavailable')
        return tr('followUnavailable');
    if (item.state === 'stale')
        return tr('followStale');
    const changes = item.newCount + item.updatedCount;
    return (changes || item.state === 'partial' ? tr('followSummary', { new: item.newCount, updated: item.updatedCount }) : tr('followNoChanges')) + (item.state === 'partial' ? ' ' + tr(item.excludedConflicts ? 'followExcludedConflicts' : 'followPartial') : '');
}
/** One local preference controller. It neither fetches sources nor starts a timer. */
export class CategoryFollowing {
    options;
    state = null;
    loaded = false;
    invalid = false;
    readGeneration = 0;
    signature = '';
    host;
    constructor(options) {
        this.options = options;
        const host = document.getElementById('following-brief');
        if (!host)
            throw Error('FOLLOWING_ELEMENT_MISSING');
        this.host = host;
    }
    get hasMemory() { return this.state !== null || this.invalid; }
    async read() {
        const generation = ++this.readGeneration;
        try {
            const state = await this.options.device.readCategoryFollows();
            if (generation === this.readGeneration) {
                this.state = state;
                this.invalid = false;
            }
        }
        catch (error) {
            if (generation === this.readGeneration)
                this.invalid = true;
            throw error;
        }
        finally {
            if (generation === this.readGeneration) {
                this.loaded = true;
                this.render();
            }
        }
    }
    nextDelay(now) { return nextCategoryFollowDelay(this.state, this.options.snapshot(), now); }
    follows(category) { return this.state?.entries.some(entry => entry.category === category) ?? false; }
    async toggle(category, desired, presentation = 'category') {
        if (this.options.busy() || !this.loaded)
            return;
        if (this.invalid) {
            try {
                await this.read();
            }
            catch {
                await this.options.write(async () => { throw Error('CATEGORY_FOLLOW_STORAGE_INVALID'); }, '', undefined, true);
                return;
            }
        }
        const followed = desired ?? !this.follows(category), expected = this.state?.revision ?? null;
        const snapshot = this.options.available() ? this.options.snapshot() : null;
        const message = presentation === 'related' ? (getLocale() === 'ro' ? (followed ? 'Stirile conexe sunt urmarite in acest browser.' : 'Urmarirea stirilor conexe a fost oprita in acest browser.') : (followed ? 'Related coverage is followed in this browser.' : 'Related coverage is no longer followed in this browser.')) : tr(followed ? 'followSaved' : 'followRemoved', { category: translatedCategory(category) });
        await this.options.write(async () => { this.state = await this.options.device.setCategoryFollow(category, followed, snapshot, expected); this.readGeneration++; this.invalid = false; }, message, undefined, true);
    }
    async acknowledge(category) {
        const snapshot = this.options.snapshot(), revision = this.state?.revision;
        if (this.options.busy() || !this.options.available() || !snapshot || !revision || this.invalid)
            return;
        await this.options.write(async () => { this.state = await this.options.device.acknowledgeCategoryFollow(category, snapshot, revision); this.readGeneration++; }, tr('followAcknowledged', { category: translatedCategory(category) }), undefined, true);
    }
    attach(article, category, presentation = 'category') {
        const content = article.querySelector('.card-content');
        if (!content)
            return;
        const row = element('div', 'card-follow');
        const button = element('button', 'follow-category');
        button.type = 'button';
        button.dataset.followCategory = category;
        button.dataset.followPresentation = presentation;
        button.addEventListener('click', () => { void this.toggle(category, undefined, presentation); });
        row.append(button, element('span', 'follow-scope', tr('browserOnly')));
        content.append(row);
        this.updateButton(button, category);
    }
    updateButton(button, category) {
        const followed = this.follows(category), related = button.dataset.followPresentation === 'related', label = related ? relatedLabel(followed) : tr(followed ? 'followingCategory' : 'followCategory', { category: translatedCategory(category) });
        button.textContent = (followed ? '✓ ' : '+ ') + label;
        button.setAttribute('aria-pressed', String(followed));
        button.setAttribute('aria-label', label + (related ? '. ' + relatedScope(category) : ''));
        button.title = (related ? relatedLabel(followed, followed) + '. ' + relatedScope(category) : tr(followed ? 'unfollowCategory' : 'followCategory', { category: translatedCategory(category) })) + ' · ' + tr('browserOnly');
        button.disabled = this.options.busy() || !this.loaded;
    }
    render() {
        for (const button of document.querySelectorAll('[data-follow-category]')) {
            const category = button.dataset.followCategory;
            this.updateButton(button, category);
            const scope = button.parentElement?.querySelector('.follow-scope');
            if (scope)
                scope.textContent = tr('browserOnly');
        }
        const model = selectCategoryFollowReturn(this.state, this.options.snapshot(), Date.now(), this.options.available());
        this.host.hidden = !this.invalid && !model.items.length;
        if (this.host.hidden) {
            this.signature = '';
            this.host.replaceChildren();
            return;
        }
        const pending = this.options.loading(), busy = this.options.busy();
        const signature = JSON.stringify([getLocale(), this.invalid, pending, busy, model.state, model.excludedConflicts, model.items.map(item => [item.category, item.state, item.savedAt, item.canAcknowledge, item.excludedConflicts, item.newCount, item.updatedCount, item.cards.map(change => [change.storyKey, change.coverageOnly, change.kind, [change.card, ...change.related].map(record => [record.id, record.contentHash, record.title, record.publisher, record.date, record.sourceUrl])])])]);
        if (signature === this.signature)
            return;
        this.signature = signature;
        const expanded = new Set([...this.host.querySelectorAll('details[open][data-follow-topic]')].map(node => node.dataset.followTopic));
        const active = document.activeElement instanceof HTMLElement && this.host.contains(document.activeElement) ? document.activeElement.dataset.followAction : null;
        const header = element('div', 'following-heading'), title = element('h2', '', '');
        title.id = 'following-title';
        title.tabIndex = -1;
        title.textContent = tr('followedTopics');
        const refresh = element('button', 'text-button', tr('refresh'));
        refresh.type = 'button';
        refresh.disabled = pending;
        refresh.dataset.followAction = 'refresh';
        refresh.addEventListener('click', () => this.options.refresh());
        header.append(title, refresh);
        const scope = element('p', 'follow-scope', tr('browserOnly')), status = element('p', 'following-status');
        status.setAttribute('role', 'status');
        status.setAttribute('aria-live', 'polite');
        this.host.replaceChildren(header, scope, status);
        this.host.dataset.followState = this.invalid ? 'invalid' : pending ? 'pending' : model.state;
        if (this.invalid) {
            status.textContent = tr('followInvalid');
            const settings = element('button', 'secondary', tr('navPersonalise'));
            settings.type = 'button';
            settings.dataset.followAction = 'personalise';
            settings.addEventListener('click', () => this.options.personalise());
            this.host.append(settings);
            return;
        }
        if (pending)
            status.textContent = tr('followChecking');
        else if (model.state === 'complete')
            status.textContent = model.newCount + model.updatedCount ? tr('followSummary', { new: model.newCount, updated: model.updatedCount }) : tr('followNoChanges');
        else if (model.state === 'partial')
            status.textContent = tr('followSummary', { new: model.newCount, updated: model.updatedCount }) + ' · ' + tr(model.excludedConflicts ? 'followExcludedConflicts' : 'followPartial');
        else {
            const key = model.state === 'stale' ? 'followStale' : model.state === 'baseline-required' && model.items.some(item => item.canAcknowledge) ? 'followBaseline' : 'followUnavailable';
            status.textContent = tr(key);
        }
        const changedStories = uniqueFollowStories(model.items.flatMap(item => item.cards));
        if (changedStories.length) {
            const updates = element('details', 'follow-updates');
            updates.dataset.followTopic = 'updates:all';
            updates.open = expanded.has(updates.dataset.followTopic);
            updates.append(element('summary', '', tr('followOpen')));
            const list = element('ul', 'following-items');
            // The validated snapshot bounds the list; each item opens the existing public card route.
            for (const change of changedStories) {
                const row = element('li', ''), link = element('a', '', change.card.title);
                link.href = cardLink(change.card);
                link.dir = 'auto';
                link.lang = sourceLanguage(change.card) ?? '';
                link.setAttribute('translate', 'no');
                const source = element('span', 'follow-source', change.card.publisher);
                source.dir = 'auto';
                source.setAttribute('translate', 'no');
                row.dataset.storyKey = change.storyKey;
                row.append(element('span', 'follow-change', tr(change.coverageOnly ? 'storyCoverageAdded' : change.kind === 'listing-updated' ? 'followUpdated' : 'followNew')), link, source);
                if (change.related.length) {
                    const reports = element('details', 'related');
                    reports.dataset.followTopic = 'story:' + change.storyKey;
                    reports.open = expanded.has(reports.dataset.followTopic);
                    reports.append(element('summary', '', tr('storyReports', { count: change.related.length })), element('p', 'privacy-note', tr('storyReportsNote')));
                    const originals = element('ul', 'following-items');
                    for (const record of change.related) {
                        const original = element('li', ''), sourceLink = element('a', '', record.title);
                        original.dataset.relatedCardId = record.id;
                        sourceLink.href = cardLink(record);
                        sourceLink.dir = 'auto';
                        sourceLink.lang = sourceLanguage(record) ?? '';
                        sourceLink.setAttribute('translate', 'no');
                        const attribution = element('span', 'follow-source', record.publisher + ' · ' + date(record.date));
                        attribution.dir = 'auto';
                        attribution.setAttribute('translate', 'no');
                        original.append(sourceLink, attribution);
                        originals.append(original);
                    }
                    reports.append(originals);
                    row.append(reports);
                }
                list.append(row);
            }
            updates.append(list);
            this.host.append(updates);
        }
        const topics = element('div', 'following-topics');
        for (const item of model.items) {
            const details = element('details', 'follow-topic');
            details.dataset.followTopic = item.category;
            details.open = expanded.has(item.category);
            const summary = element('summary', '');
            summary.dataset.followAction = 'open:' + item.category;
            const counts = pending ? tr('followChecking') : item.state === 'complete' || item.state === 'partial' ? tr('followSummary', { new: item.newCount, updated: item.updatedCount }) + (item.state === 'partial' ? ' · ' + tr('partialCoverage') : '') : itemMessage(item);
            summary.append(element('span', '', translatedCategory(item.category)), element('span', 'follow-count', counts));
            details.append(summary);
            const body = element('div', 'follow-topic-body');
            body.append(element('p', 'privacy-note', pending ? tr('followChecking') : itemMessage(item)));
            if (item.savedAt)
                body.append(element('p', 'privacy-note', tr('followCheckSaved', { time: date(item.savedAt) })));
            const actions = element('div', 'follow-actions'), save = element('button', 'secondary', tr('followAcknowledge')), remove = element('button', 'text-button', tr('unfollowCategory', { category: translatedCategory(item.category) }));
            save.type = 'button';
            save.disabled = busy || pending || !item.canAcknowledge;
            save.dataset.followAction = 'ack:' + item.category;
            save.addEventListener('click', () => { void this.acknowledge(item.category); });
            remove.type = 'button';
            remove.disabled = busy;
            remove.dataset.followAction = 'remove:' + item.category;
            remove.addEventListener('click', () => { void this.toggle(item.category, false); });
            actions.append(save, remove);
            body.append(actions);
            details.append(body);
            topics.append(details);
        }
        this.host.append(topics, element('p', 'follow-boundary', tr('followBoundary')));
        if (active) {
            const replacement = [...this.host.querySelectorAll('[data-follow-action]')].find(node => node.dataset.followAction === active);
            (replacement ?? title).focus({ preventScroll: true });
        }
    }
}
