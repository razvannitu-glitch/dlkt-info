import {PERSONAL_LOCAL_VERSION, type LocalNeed} from './contracts.js';
import {parsePersonalSession} from './session.js';
import {selectPersonalLocalEdition, type PersonalLocalEdition} from '../iceo/personal-relevance.js';
import {parseWalletSnapshot, type WalletProfileState} from '../wallet/contracts.js';
import {validTopicSnapshot, DAILY_TOPIC_FRESHNESS_MS, type DailyProfile, type DailyEdition} from '../daily/contracts.js';
import {selectDaily, type DailyItem, type DailySelection} from '../daily/selection.js';
import {nextReadingBoundary, changeExplanation} from '../daily/reading.js';
import {object, validCity, currentLocalSnapshot, type City, type LocalSnapshot} from '../local/contracts.js';
import {localCardNode} from '../local/card-node.js';
import {cardCreditsNode} from '../iceo/credits.js';
import {pressReviewCitation, safeLink} from '../iceo/source-links.js';
import {TOPIC_LABELS} from '../iceo/topics.js';
import {editorialCategory} from '../iceo/editorial-categories.js';
import {DeviceMemory} from '../iceo/device-memory.js';
import type {IceoSnapshot} from '../iceo/contracts.js';

export interface PersonalReader {
  clear(): void;
  load(profile: WalletProfileState, ownerId: string): Promise<void>;
}
const PAGE_SIZE = 20;
const NEED_LABELS: Readonly<Record<LocalNeed, string>> = {
  weather: 'weather', mobility: 'mobility', utilities: 'utilities', culture: 'culture',
  administration: 'administration', 'local-reporting': 'local reporting',
};
const node = <K extends keyof HTMLElementTagNameMap>(tag: K, value = '', className = ''): HTMLElementTagNameMap[K] => {
  const element = document.createElement(tag); element.textContent = value; element.className = className; return element;
};

/** First-party public corpus requests never include the account cookie or private profile. */
async function json(path: string, signal: AbortSignal, ownerId?: string): Promise<unknown> {
  const response = await fetch(path, {
    method: 'GET', credentials: ownerId === undefined ? 'omit' : 'same-origin',
    cache: 'no-store', redirect: 'error', signal,
    headers: {Accept: 'application/json', ...(ownerId === undefined ? {} : {
      'X-DLKT-Info-Request': path === '/api/account-session' ? 'identity-v1' : 'wallet-v1',
      ...(path === '/api/wallet' ? {'X-DLKT-Info-Owner': ownerId} : {}),
    })},
  });
  const maximum = ownerId === undefined ? 2_000_000 : 32_768;
  const length = response.headers.get('content-length');
  if (!response.ok || !/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')
    || (length !== null && (!/^\d+$/u.test(length) || Number(length) > maximum))) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error(ownerId === undefined ? 'PERSONAL_SOURCE_UNAVAILABLE' : 'PERSONAL_PROFILE_CHANGED');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('PERSONAL_RESPONSE_INVALID');
  const decoder = new TextDecoder('utf-8', {fatal: true}); let bytes = 0; const chunks: string[] = [];
  try {
    while (true) {
      if (signal.aborted) throw new Error('PERSONAL_REQUEST_ABORTED');
      const part = await reader.read(); if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximum) { void reader.cancel().catch(() => undefined); throw new Error('PERSONAL_RESPONSE_TOO_LARGE'); }
      chunks.push(decoder.decode(part.value, {stream: true}));
    }
    chunks.push(decoder.decode());
    if (signal.aborted) throw new Error('PERSONAL_REQUEST_ABORTED');
    return JSON.parse(chunks.join('')) as unknown;
  } finally { reader.releaseLock(); }
}

async function localCorpus(cityId: string, signal: AbortSignal): Promise<{city: City; snapshot: LocalSnapshot}> {
  const places = await json('/api/places?id=' + encodeURIComponent(cityId), signal);
  if (!object(places) || !Array.isArray(places.cities) || places.cities.length !== 1
    || !validCity(places.cities[0]) || places.cities[0].id !== cityId) throw new Error('PERSONAL_CITY_INVALID');
  const city = places.cities[0];
  const value = await json('/api/local?city=' + encodeURIComponent(city.id), signal);
  if (!object(value) || typeof value.checkedAt !== 'string'
    || !currentLocalSnapshot(value, city, Date.parse(value.checkedAt))) throw new Error('PERSONAL_LOCAL_INVALID');
  return {city, snapshot: value};
}

/** This controller never reads or writes the browser's separate DailyState. */
export function createPersonalReader(onInvalidated: () => void): PersonalReader {
  const panel = document.getElementById('wallet-personal');
  const status = document.getElementById('wallet-personal-status');
  const coverage = document.getElementById('wallet-personal-coverage');
  const cards = document.getElementById('wallet-personal-cards');
  const refresh = document.getElementById('wallet-personal-refresh') as HTMLButtonElement | null;
  const more = document.getElementById('wallet-personal-more') as HTMLButtonElement | null;
  if (!panel || !status || !coverage || !cards || !refresh || !more) throw new Error('PERSONAL_ELEMENT_MISSING');
  const ui = {panel, status, coverage, cards, refresh, more};
  const memory = new DeviceMemory();
  let generation = 0, active: AbortController | null = null, expiry: number | null = null;
  let saved: WalletProfileState | null = null, owner: string | null = null;
  let city: City | null = null, local: LocalSnapshot | null = null, topics: IceoSnapshot | null = null;
  let topicPrior: DailyEdition | null = null, displayed = PAGE_SIZE;
  let currentSelection: DailySelection | null = null;
  const rendered = new Map<string, {signature: string; element: HTMLElement}>();
  const foreground = (): boolean => !document.hidden && document.hasFocus();
  const current = (ticket: number, controller: AbortController): boolean =>
    generation === ticket && active === controller && !controller.signal.aborted && foreground();

  function clear(): void {
    generation += 1; active?.abort(); active = null;
    if (expiry !== null) window.clearTimeout(expiry); expiry = null;
    saved = null; owner = null; city = null; local = null; topics = null; topicPrior = null; currentSelection = null;
    displayed = PAGE_SIZE; rendered.clear();
    ui.panel.hidden = true; ui.panel.setAttribute('aria-busy', 'false');
    ui.status.textContent = ''; ui.coverage.replaceChildren(); ui.cards.replaceChildren();
    ui.refresh.disabled = false; ui.more.hidden = true; ui.more.disabled = false;
  }
  function link(label: string, address: string): HTMLAnchorElement | null {
    const href = safeLink(address); if (!href) return null;
    const element = node('a', label, 'source-link'); element.href = href; element.target = '_blank';
    element.rel = 'noopener noreferrer'; element.referrerPolicy = 'no-referrer'; return element;
  }
  async function confirmProfile(profile: WalletProfileState, userId: string, controller: AbortController): Promise<void> {
    const verification = new AbortController();
    const abort = (): void => verification.abort();
    controller.signal.addEventListener('abort', abort, {once: true});
    if (controller.signal.aborted) abort();
    const timeout = window.setTimeout(abort, 20_000);
    try {
      const value = parseWalletSnapshot(await json('/api/wallet', verification.signal, userId));
      if (value.account !== 'signed-in' || value.profile === null || value.profile.revision !== profile.revision
        || JSON.stringify(value.profile.value) !== JSON.stringify(profile.value)) throw new Error('PERSONAL_PROFILE_CHANGED');
      const session = parsePersonalSession(await json('/api/account-session', verification.signal, userId));
      if (verification.signal.aborted || session.status !== 'signed-in' || session.userId !== userId) throw new Error('PERSONAL_PROFILE_CHANGED');
    } finally {
      window.clearTimeout(timeout);
      controller.signal.removeEventListener('abort', abort);
    }
  }
  function topicNode(item: DailyItem, profile: WalletProfileState, ticket: number, controller: AbortController): HTMLElement {
    const view = item.topic; if (!view) throw new Error('PERSONAL_TOPIC_INVALID');
    const card = view.card, article = node('article', '', 'info-card');
    article.dataset.personalId = item.id; article.dataset.sourceId = card.id;
    const category = editorialCategory(card);
    if (category !== null) article.dataset.editorialCategory = category;
    const header = node('header'); header.append(node('span', TOPIC_LABELS[card.topic], 'card-topic'));
    const citation = pressReviewCitation(card.sourceUrl);
    if (citation) { const credit = link(citation.label, citation.homeUrl); if (credit) header.append(credit); }
    else header.append(node('span', card.publisher, 'card-index'));
    const content = node('div', '', 'card-content'), title = node('h3', card.title);
    content.append(title, node('p', item.reason, 'card-kind personal-reason'), node('p', view.context, 'card-context'),
      node('p', view.dateLabel + ': ' + card.date, 'card-date'));
    const credits = cardCreditsNode(card); if (credits) content.append(credits);
    const original = link(citation?.originalLabel ?? 'Open original source', card.sourceUrl); if (original) content.append(original);
    const details = node('details', '', 'evidence'); details.append(node('summary', 'Source and coverage'),
      node('p', 'Source checked ' + card.observedAt, 'card-boundary'),
      node('p', card.boundary, 'card-boundary'), node('p', card.attribution, 'card-boundary'));
    for (const related of view.related) { const source = link(related.publisher + ' · ' + related.title, related.sourceUrl); if (source) details.append(source); }
    if (item.change === 'different') {
      content.append(node('p', 'Changed since the previous source check in this session.', 'daily-change'));
      for (const change of item.changes) details.append(node('p', changeExplanation(change), 'card-boundary'));
    } else if (item.change === 'coverage') content.append(node('p', 'Additional publisher coverage of this existing story.', 'daily-change'));
    const save = node('button', 'Save card in this browser', 'text-button'); save.type = 'button';
    save.dataset.personalSave = card.id; const feedback = node('p', '', 'card-boundary'); feedback.setAttribute('role', 'status');
    save.addEventListener('click', () => {
      if (save.disabled || !owner || !current(ticket, controller)) return;
      const userId = owner; save.disabled = true;
      void (async () => {
        try {
          await confirmProfile(profile, userId, controller);
        } catch {
          if (current(ticket, controller)) { clear(); onInvalidated(); }
          return;
        }
        if (!current(ticket, controller)) return;
        try {
          await memory.save(card);
          if (current(ticket, controller)) feedback.textContent = 'This public source card was saved in this browser. Your private profile was not copied.';
        } catch {
          if (current(ticket, controller)) feedback.textContent = 'Saving in this browser could not be confirmed.';
        } finally { if (current(ticket, controller)) save.disabled = false; }
      })();
    });
    content.append(save, feedback); article.append(header, content, details); return article;
  }
  function paint(ticket: number, controller: AbortController): void {
    if (!saved || !current(ticket, controller)) return;
    const profile = saved, value = profile.value, now = Date.now();
    const result: PersonalLocalEdition = selectPersonalLocalEdition(
      value.cityId === null ? null : {version: PERSONAL_LOCAL_VERSION, cityId: value.cityId, needs: value.localNeeds},
      local, city, now);
    const daily: DailyProfile = {cityId: null, topics: value.interests, query: '', budget: 5000, timezone: value.timezone};
    const validTopics = topics && validTopicSnapshot(topics, now) ? topics : null;
    const topicSelection = value.interests.length ? selectDaily(daily, validTopics, null, topicPrior, [], now) : null;
    currentSelection = topicSelection;
    const rows: {id: string; signature: string; create: () => HTMLElement}[] = [];
    const selectedCity = city;
    if (selectedCity) for (const match of result.matches) {
      const id = 'local:' + match.card.id;
      rows.push({id, signature: JSON.stringify([match.card, match.need, selectedCity]), create: () => {
        const card = localCardNode(match.card, selectedCity, now, {photos: false}); card.dataset.personalId = id;
        const reason = node('p', 'For ' + selectedCity.name + ', which you confirmed, and ' + NEED_LABELS[match.need]
          + ', which you selected. This is city context; confirm exact applicability at the source.', 'card-kind personal-reason');
        card.querySelector('.card-content')?.prepend(reason); return card;
      }});
    }
    for (const item of topicSelection?.items ?? []) if (item.topic) {
      rows.push({id: item.id, signature: JSON.stringify([item.topic, item.reason, item.change, item.changes]),
        create: () => topicNode(item, profile, ticket, controller)});
    }
    const visible = rows.slice(0, displayed), retained = new Set(visible.map(row => row.id));
    const focused = document.activeElement, focusWasInside = focused instanceof HTMLElement && ui.cards.contains(focused);
    for (const [id, entry] of rendered) if (!retained.has(id)) { entry.element.remove(); rendered.delete(id); }
    for (let index = 0; index < visible.length; index += 1) {
      const row = visible[index]; if (!row) continue;
      const previous = rendered.get(row.id);
      const card = previous?.signature === row.signature ? previous.element : row.create();
      if (previous && previous.element !== card) { previous.element.replaceWith(card); }
      rendered.set(row.id, {signature: row.signature, element: card});
      const position = ui.cards.children[index];
      if (position !== card) ui.cards.insertBefore(card, position ?? null);
    }
    if (focusWasInside && focused instanceof HTMLElement && !ui.cards.contains(focused)) ui.refresh.focus();
    ui.more.hidden = displayed >= rows.length; ui.more.textContent = 'Show more matched cards (' + Math.max(0, rows.length - displayed) + ')';
    ui.coverage.replaceChildren();
    if (value.localNeeds.length && value.cityId === null) ui.coverage.append(node('p', 'Confirm a city to match the local needs you selected.', 'privacy-note'));
    for (const entry of result.coverage) {
      ui.coverage.append(node('p', NEED_LABELS[entry.need] + ' · ' + entry.state + '. ' + entry.note, 'privacy-note'));
    }
    for (const note of topicSelection?.notes ?? []) ui.coverage.append(node('p', note, 'privacy-note'));
    const localSelected = value.cityId !== null && value.localNeeds.length > 0;
    const interestState = topicSelection?.edition.topicState ?? 'not-selected';
    ui.status.textContent = !localSelected && !value.interests.length
      ? 'Choose interests or confirm a city and select local needs, then save your profile.'
      : rows.length + ' matched card' + (rows.length === 1 ? '' : 's') + ' from available checked sources. '
        + (localSelected ? 'Local coverage: ' + result.state + '. ' : '')
        + (value.interests.length ? 'Interest sources: ' + interestState + '. ' : '')
        + 'Missing checks do not mean that nothing happened.';
    if (expiry !== null) window.clearTimeout(expiry); expiry = null;
    const boundaries = [result.expiresAt,
      value.interests.length ? nextReadingBoundary(daily, validTopics, null, now) : null,
      topics ? Date.parse(topics.generatedAt) + DAILY_TOPIC_FRESHNESS_MS + 1 : null,
    ].filter((time): time is number => time !== null && Number.isFinite(time) && time > now);
    if (boundaries.length) expiry = window.setTimeout(() => { expiry = null; paint(ticket, controller); }, Math.max(1, Math.min(...boundaries) - now));
  }
  async function load(profile: WalletProfileState, userId: string): Promise<void> {
    const previous = owner === userId && saved?.revision === profile.revision ? currentSelection?.edition ?? null : null;
    clear();
    if (!foreground()) return;
    saved = profile; owner = userId; topicPrior = previous;
    const ticket = generation, controller = new AbortController(); active = controller;
    ui.panel.hidden = false; ui.panel.setAttribute('aria-busy', 'true'); ui.refresh.disabled = true;
    ui.status.textContent = 'Checking sources for your saved preferences.';
    const timeout = window.setTimeout(() => controller.abort(), 20_000);
    try {
      const [localResult, topicResult] = await Promise.allSettled([
        profile.value.cityId !== null && profile.value.localNeeds.length ? localCorpus(profile.value.cityId, controller.signal) : Promise.resolve(null),
        profile.value.interests.length ? json('/api/iceo', controller.signal) : Promise.resolve(null),
      ]);
      if (!current(ticket, controller)) return;
      await confirmProfile(profile, userId, controller);
      if (!current(ticket, controller)) return;
      city = localResult.status === 'fulfilled' ? localResult.value?.city ?? null : null;
      local = localResult.status === 'fulfilled' ? localResult.value?.snapshot ?? null : null;
      topics = topicResult.status === 'fulfilled' && validTopicSnapshot(topicResult.value, Date.now()) ? topicResult.value : null;
      paint(ticket, controller);
    } catch {
      if (generation === ticket && active === controller && foreground()) { clear(); onInvalidated(); }
    } finally {
      window.clearTimeout(timeout);
      if (generation === ticket && active === controller && foreground()) {
        ui.panel.setAttribute('aria-busy', 'false'); ui.refresh.disabled = false;
        if (controller.signal.aborted) {
          ui.cards.replaceChildren(); ui.coverage.replaceChildren(); ui.more.hidden = true;
          ui.status.textContent = 'Source checks timed out. Reload your Wallet to retry.';
        }
      }
    }
  }
  ui.refresh.addEventListener('click', () => { if (saved && owner && !ui.refresh.disabled) void load(saved, owner); });
  ui.more.addEventListener('click', () => { if (active && saved && current(generation, active)) { displayed += PAGE_SIZE; paint(generation, active); } });
  clear();
  return {clear, load};
}
