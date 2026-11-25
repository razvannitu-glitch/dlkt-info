import {setupHeader} from './header.js';
import {organizationSetupFromHash} from '../organizations/setup.js';
import {sharedTopic} from '../share/link.js';
import { validCity, object, type City } from '../local/contracts.js';
import { initialEntryState, reduceEntry, topicSearchView, type EntryState, type EntryView } from './state.js';
function required<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error('ENTRY_ELEMENT_MISSING');
  return element as T;
}
const form = required<HTMLFormElement>('entry-search');
const query = required<HTMLInputElement>('entry-query');
const results = required<HTMLElement>('entry-suggestions');
const message = required<HTMLElement>('entry-message');
const description = required<HTMLElement>('entry-help');
const topicWorkspace = required<HTMLElement>('topic-workspace');
const localWorkspace = required<HTMLElement>('local-briefing');
const sourceSection = required<HTMLElement>('sources');
const options = required<HTMLDetailsElement>('entry-options');
setupHeader();
let state: EntryState = initialEntryState;
let searchMode: 'city' | 'topic' = 'city';
let ticket = 0;
let pending: AbortController | null = null;
let timer: ReturnType<typeof setTimeout> | undefined;
let composition = false;
let selectedCity: City | null = null;
function cancelSearch(): void {
  ++ticket; pending?.abort(); pending = null; clearTimeout(timer);
  results.replaceChildren(); results.hidden = true; query.setAttribute('aria-expanded', 'false');
}
function present(): void {
  document.body.dataset.entryView = state.view;
  if(state.view !== 'topics') required<HTMLElement>('briefing').setAttribute('aria-busy','false');
  topicWorkspace.hidden = state.view !== 'topics';
  required<HTMLElement>('discovery').hidden = state.view !== 'start';
  localWorkspace.hidden = state.view !== 'local';
  sourceSection.hidden = state.view !== 'topics' && state.view !== 'start';
  required<HTMLElement>('daily-workspace').hidden=state.view!=='daily';
  required<HTMLElement>('entry-return').hidden = state.view === 'start';
  required<HTMLElement>('entry-today').hidden = state.view !== 'start';
  required<HTMLElement>('entry-introduction').hidden = state.view !== 'start';
  options.open = state.view === 'topics';
  document.dispatchEvent(new CustomEvent('dlkt:entry-view',{detail:{view:state.view}}));
}
function chooseView(view: EntryView): void {
  state = reduceEntry(state, { type: 'choose', view }); cancelSearch(); present();
}
function openSaved(): void {
  chooseView('topics'); document.querySelector<HTMLButtonElement>('[data-view=saved]')?.click();
}
function openToday(): void {
  chooseView('start');
  required<HTMLElement>('entry-title').focus();
  required<HTMLElement>('discovery').scrollIntoView({block:'start'});
}
function chooseMode(mode: 'city' | 'topic', focus = false): void {
  cancelSearch(); searchMode = mode; query.value = ''; message.textContent = '';
  document.querySelectorAll<HTMLButtonElement>('[data-entry-mode]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.entryMode === mode)));
  query.placeholder = mode === 'city' ? 'Type your city' : 'A product, name or topic';
  query.setAttribute('aria-label', mode === 'city' ? 'Find your city' : 'Search connected topics');
  description.textContent = mode === 'city'
    ? 'Your local day from connected sources. Coverage is shown for each city.'
    : 'Explore connected world, culture, digital life, science, health, public affairs and economy sources. Not the whole web.';
  required<HTMLButtonElement>('entry-submit').setAttribute('aria-label', mode === 'city' ? 'Find city' : 'Show matching cards');
  if (focus) query.focus();
}
function requestTopics(text: string, topic = 'all'): void {
  chooseView('topics');
  if (searchMode !== 'topic') chooseMode('topic');
  query.value = text;
  document.dispatchEvent(new CustomEvent('dlkt:topic-request', { detail: { query: text, topic } }));
}
function selectCity(city: City): void {
  selectedCity = city; openToday();
  if(searchMode!=='city')chooseMode('city');
  query.value = city.name;
  document.dispatchEvent(new CustomEvent('dlkt:city-request', { detail: city }));
}
function openCityBriefing(): void {
  if (selectedCity) { selectCity(selectedCity); return; }
  required<HTMLButtonElement>('choose-place').click();
}
async function lookupCities(): Promise<void> {
  const text = query.value.trim(); cancelSearch();
  if (!text || searchMode !== 'city') { message.textContent = ''; return; }
  const current = ticket; pending = new AbortController();
  message.textContent = 'Finding cities…';
  try {
    const response = await fetch('/api/places?q=' + encodeURIComponent(text), {
      credentials: 'omit', headers: { Accept: 'application/json' },
      signal: AbortSignal.any([pending.signal, AbortSignal.timeout(12000)])
    });
    if (!response.ok) throw new Error('CITY_LOOKUP_UNAVAILABLE');
    const raw = await response.text();
    if (raw.length > 150000) throw new Error('CITY_RESPONSE_TOO_LARGE');
    const value: unknown = JSON.parse(raw);
    if (current !== ticket || searchMode !== 'city') return;
    if (!object(value) || !Array.isArray(value.cities) || value.cities.length > 8 || !value.cities.every(validCity)) throw new Error('CITY_RESPONSE_INVALID');
    for (const city of value.cities) {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'entry-city'; button.dataset.entryCity = city.id;
      const name = document.createElement('strong'); name.textContent = city.name;
      const context = document.createElement('span'); context.textContent = `${city.region} · ${city.country}`;
      button.append(name, context); button.addEventListener('click', () => selectCity(city));
      item.append(button); results.append(item);
    }
    results.hidden = value.cities.length === 0;
    query.setAttribute('aria-expanded', String(!results.hidden));
    message.textContent = value.cities.length ? 'Choose your city and country.' : 'No city found in the current catalog. Try another spelling or a nearby city.';
  } catch (error) {
    if (current !== ticket || error instanceof DOMException && error.name === 'AbortError') return;
    message.textContent = 'City search is unavailable. Try again; your saved choice has not changed.';
  }
}
query.addEventListener('input', () => {
  state = reduceEntry(state, { type: 'interact' }); cancelSearch();
  if (!composition && searchMode === 'city') timer = setTimeout(() => { void lookupCities(); }, 100);
});
query.addEventListener('compositionstart', () => { composition = true; cancelSearch(); });
query.addEventListener('compositionend', () => { composition = false; if (searchMode === 'city') void lookupCities(); });
query.addEventListener('keydown', event => {
  if (event.key === 'Escape') { cancelSearch(); message.textContent = ''; }
  if (event.key === 'ArrowDown' && !results.hidden) { event.preventDefault(); results.querySelector<HTMLButtonElement>('button')?.focus(); }
});
results.addEventListener('keydown', event => {
  const buttons = Array.from(results.querySelectorAll<HTMLButtonElement>('button'));
  const index = buttons.findIndex(button => button === document.activeElement);
  if (event.key === 'Escape') { cancelSearch(); query.focus(); }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    const next = event.key === 'ArrowDown' ? index + 1 : index - 1;
    if (next < 0) query.focus(); else buttons[Math.min(next, buttons.length - 1)]?.focus();
  }
});
form.addEventListener('submit', event => {
  event.preventDefault(); if (composition) return;
  state = reduceEntry(state, { type: 'interact' });
  if (searchMode === 'city') { if (query.value.trim()) void lookupCities(); else { query.focus(); message.textContent = 'Type a city, then choose the correct country.'; } }
  else if (topicSearchView(query.value) === 'start') openToday();
  else requestTopics(query.value.trim());
});
document.querySelectorAll<HTMLButtonElement>('[data-entry-mode]').forEach(button => button.addEventListener('click', () => {
  state = reduceEntry(state, { type: 'interact' }); chooseMode(button.dataset.entryMode === 'topic' ? 'topic' : 'city', true);
}));
document.querySelectorAll<HTMLButtonElement>('[data-entry-topic]').forEach(button => button.addEventListener('click', () => requestTopics('', button.dataset.entryTopic ?? 'all')));
required<HTMLButtonElement>('entry-weather').addEventListener('click', openCityBriefing);
required<HTMLButtonElement>('entry-nearby').addEventListener('click', () => { state = reduceEntry(state, { type: 'interact' }); required<HTMLButtonElement>('choose-place').click(); });
required<HTMLButtonElement>('entry-saved').addEventListener('click', openSaved);
required<HTMLButtonElement>('entry-today').addEventListener('click', openToday);
required<HTMLButtonElement>('entry-return').addEventListener('click', openToday);
required<HTMLButtonElement>('entry-show-city').addEventListener('click', openCityBriefing);
required<HTMLButtonElement>('home-city').addEventListener('click', () => { state = reduceEntry(state, {type:'interact'}); required<HTMLButtonElement>('choose-place').click(); });
document.addEventListener('dlkt:reader-selected', event => {
  if (!(event instanceof CustomEvent)) return;
  const restored = object(event.detail) && event.detail.restored === true;
  if (!restored && object(event.detail) && event.detail.view === 'start') { openToday(); return; }
  state = reduceEntry(state, restored ? { type: 'restore', view: 'topics' } : { type: 'choose', view: 'topics' });
  if (state.view === 'topics') { cancelSearch(); present(); if (searchMode !== 'topic') chooseMode('topic'); query.value = required<HTMLInputElement>('query').value; }
});
document.addEventListener('dlkt:city-selected', event => {
  if (!(event instanceof CustomEvent) || !object(event.detail) || !validCity(event.detail.city)) return;
  selectedCity = event.detail.city;
  const dailyPick=document.body.dataset.dailyPicking==='true';
  state = reduceEntry(state, dailyPick ? {type:'choose',view:'daily'} : event.detail.estimated === true ? {type:'suggest',view:'local'} : event.detail.restored === true ? { type: 'restore', view: 'local' } : { type: 'choose', view: 'start' });
  if(dailyPick){present();queueMicrotask(()=>{delete document.body.dataset.dailyPicking;});}
  else if(event.detail.estimated!==true&&event.detail.restored!==true){
    cancelSearch(); present();
    if(searchMode!=='city')chooseMode('city');
    query.value=selectedCity.name;
    required<HTMLElement>('entry-title').focus();
    required<HTMLElement>('discovery').scrollIntoView({block:'start'});
  }
  required<HTMLButtonElement>('entry-show-city').textContent = selectedCity.name;
  if (state.view === 'local') { cancelSearch(); present(); if (searchMode !== 'city') chooseMode('city'); query.value = selectedCity.name; }
});
// Keep a failed optional module from leaving a dead search field with no explanation.
window.addEventListener('error', event => { if (event.target instanceof HTMLScriptElement) message.textContent = 'Part of the page could not load. Reload to try again.'; }, true);
chooseMode('city'); present();

document.addEventListener('dlkt:daily-selected',event=>{if(!(event instanceof CustomEvent))return;const restored=object(event.detail)&&event.detail.restored===true;state=reduceEntry(state,restored?{type:'restore',view:'daily'}:{type:'choose',view:'daily'});if(state.view==='daily'){cancelSearch();present();}});

required<HTMLDialogElement>('place-dialog').addEventListener('close',()=>{queueMicrotask(()=>{delete document.body.dataset.dailyPicking;});});

function openLinkedView():void{
 if(window.location.hash === '#saved'){openSaved();return;}
 if(organizationSetupFromHash(window.location.hash)){chooseView('topics');return;}
 const topic=sharedTopic(window.location.hash);if(!topic)return;
 chooseView('daily');document.dispatchEvent(new CustomEvent('dlkt:shared-topic',{detail:{topic}}));
}
if(document.readyState!=='complete')document.addEventListener('DOMContentLoaded',openLinkedView,{once:true});else queueMicrotask(openLinkedView);
window.addEventListener('hashchange',openLinkedView);

// Native fragment focus can follow DOMContentLoaded; reconcile only that untouched Saved control.
window.addEventListener('load', () => {
  requestAnimationFrame(() => {
    const savedControl = required<HTMLButtonElement>('saved');
    if (window.location.hash !== '#saved' || state.view !== 'topics'
      || savedControl.getAttribute('aria-pressed') !== 'true' || document.activeElement !== savedControl) return;
    const heading = required<HTMLElement>('result-heading');
    heading.focus(); heading.scrollIntoView({block: 'start'});
  });
}, {once: true});
