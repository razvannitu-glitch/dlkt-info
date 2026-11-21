import {parseWalletProfile, parseWalletSnapshot, type WalletProfile, type WalletSnapshot} from './contracts.js';
import {createConnectionsWallet} from '../connections/browser.js';
import {DAILY_TOPICS} from '../daily/contracts.js';
import {TOPIC_LABELS, TOPIC_DESCRIPTIONS} from '../iceo/topics.js';

function el<T extends HTMLElement>(id: string): T {
  const element = document.getElementById(id);
  if (!element) throw new Error('WALLET_ELEMENT_MISSING');
  return element as T;
}

const connections = createConnectionsWallet(() => {
  invalidate('Your session ended. Sign in again to check your private profile.');
  signIn.hidden = false;
});
const status = el('wallet-status');
const account = el('wallet-account');
const panel = el('wallet-profile-panel');
const form = el<HTMLFormElement>('wallet-profile-form');
const signIn = el<HTMLAnchorElement>('wallet-signin');
const signOut = el<HTMLButtonElement>('wallet-signout');
const reload = el<HTMLButtonElement>('wallet-reload');
const displayName = el<HTMLInputElement>('wallet-display-name');
const locale = el<HTMLInputElement>('wallet-locale');
const timezone = el<HTMLInputElement>('wallet-timezone');
const readingTime = el<HTMLInputElement>('wallet-briefing-time');
const balanced = el<HTMLInputElement>('wallet-priority-balanced');
const personalFirst = el<HTMLInputElement>('wallet-priority-personal');
const deleteButton = el<HTMLButtonElement>('wallet-delete');
const confirmation = el('wallet-delete-confirmation');
const deleteConfirm = el<HTMLButtonElement>('wallet-delete-confirm');
const deleteCancel = el<HTMLButtonElement>('wallet-delete-cancel');
const interestInputs = DAILY_TOPICS.map(topic => {
  const label = document.createElement('label');
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.name = 'interests';
  input.value = topic;
  label.append(input, document.createTextNode(TOPIC_LABELS[topic]));
  const description = document.createElement('span');
  description.textContent = TOPIC_DESCRIPTIONS[topic];
  label.append(description);
  el('wallet-interests').append(label);
  return {topic, input};
});

let snapshot: WalletSnapshot | null = null;
let pendingDelete: string | null = null;
let generation = 0;
let active: AbortController | null = null;
let busy = false;
let focused = document.hasFocus();

class WalletRequestError extends Error {
  constructor(readonly statusCode: number) {
    super('WALLET_REQUEST_FAILED');
  }
}

function setStatus(value: string, warning = false): void {
  status.textContent = value;
  status.dataset.level = warning ? 'warning' : 'normal';
}

function setBusy(value: boolean): void {
  busy = value;
  account.setAttribute('aria-busy', String(value));
  form.setAttribute('aria-busy', String(value));
  form.querySelectorAll<HTMLInputElement | HTMLButtonElement>('input, button').forEach(control => {
    control.disabled = value;
  });
  for (const control of [reload, signOut, deleteConfirm, deleteCancel]) control.disabled = value;
}

function closeConfirmation(): void {
  pendingDelete = null;
  confirmation.hidden = true;
  deleteButton.setAttribute('aria-expanded', 'false');
}

/** Clear private fields before checking a session, leaving the page, or starting a mutation. */
function clearPrivate(): void {
  snapshot = null;
  panel.hidden = true;
  signIn.hidden = true;
  signOut.hidden = true;
  deleteButton.hidden = true;
  form.reset();
  for (const input of [displayName, locale, timezone, readingTime]) input.value = '';
  balanced.checked = false;
  personalFirst.checked = false;
  for (const {input} of interestInputs) input.checked = false;
  el('wallet-profile-summary').textContent = '';
  connections.clear();
  closeConfirmation();
}

function invalidate(message: string): void {
  generation += 1;
  active?.abort();
  active = null;
  clearPrivate();
  setBusy(false);
  setStatus(message);
}

function begin(message: string): {generation: number; controller: AbortController} {
  invalidate(message);
  const controller = new AbortController();
  active = controller;
  setBusy(true);
  return {generation, controller};
}

function isCurrent(operation: {generation: number; controller: AbortController}): boolean {
  return operation.generation === generation && active === operation.controller
    && !operation.controller.signal.aborted && foreground();
}

function foreground(): boolean {
  return !document.hidden && focused && document.hasFocus();
}

async function request(path: string, marker: string, method: 'GET' | 'PUT' | 'DELETE', signal: AbortSignal, body?: unknown): Promise<unknown> {
  const timeout = new AbortController();
  const abort = (): void => timeout.abort();
  signal.addEventListener('abort', abort, {once: true});
  if (signal.aborted) timeout.abort();
  const timer = window.setTimeout(abort, 25_000);
  try {
    const response = await fetch(path, {
      method,
      credentials: 'same-origin',
      cache: 'no-store',
      redirect: 'error',
      headers: {Accept: 'application/json', 'Content-Type': 'application/json', 'X-DLKT-Info-Request': marker},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      signal: timeout.signal,
    });
    if (!response.ok) throw new WalletRequestError(response.status);
    const value: unknown = await response.json();
    if (signal.aborted || timeout.signal.aborted) throw new Error('WALLET_REQUEST_ABORTED');
    return value;
  } finally {
    window.clearTimeout(timer);
    signal.removeEventListener('abort', abort);
  }
}

function defaults(): WalletProfile {
  let preferredLocale = 'en';
  let preferredZone = 'UTC';
  try {
    preferredLocale = new Intl.Locale(navigator.language).toString();
    preferredZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return parseWalletProfile({displayName: null, locale: preferredLocale, timezone: preferredZone,
      briefingTime: '08:00', interests: [], personalPriority: 'balanced'});
  } catch {
    return parseWalletProfile({displayName: null, locale: 'en', timezone: 'UTC',
      briefingTime: '08:00', interests: [], personalPriority: 'balanced'});
  }
}

function render(value: WalletSnapshot, message?: string): void {
  snapshot = value;
  connections.setAccount(value.account);
  signIn.hidden = value.account !== 'signed-out';
  signOut.hidden = value.account !== 'signed-in';
  panel.hidden = value.account !== 'signed-in';
  if (value.account === 'unavailable') {
    setStatus(message ?? 'Account sign-in and private profile saving are not activated yet. No email address is collected here. You can explore the connection requirements below.');
    return;
  }
  if (value.account === 'signed-out') {
    setStatus(message ?? 'Sign in to create your private Wallet profile. This does not authorize access to your email or social accounts.');
    return;
  }
  const profile = value.profile?.value ?? defaults();
  displayName.value = profile.displayName ?? '';
  locale.value = profile.locale;
  timezone.value = profile.timezone;
  readingTime.value = profile.briefingTime;
  balanced.checked = profile.personalPriority === 'balanced';
  personalFirst.checked = profile.personalPriority === 'personal-first';
  for (const {topic, input} of interestInputs) input.checked = profile.interests.includes(topic);
  deleteButton.hidden = value.profile === null;
  el('wallet-profile-summary').textContent = value.profile === null
    ? 'Your profile has not been saved yet. Review these preferences before saving.'
    : `Your profile was saved on ${new Date(value.profile.updatedAt).toLocaleString('en', {timeZone: profile.timezone})} (${profile.timezone}).`;
  setStatus(message ?? 'Signed in. Your profile is private. Email and social connections require separate authorization.');
}

function failure(error: unknown, operation: 'load' | 'save' | 'delete' | 'sign-out'): void {
  clearPrivate();
  connections.setAccount(error instanceof WalletRequestError && error.statusCode === 401 ? 'signed-out' : 'unavailable');
  if (error instanceof WalletRequestError && error.statusCode === 401) {
    signIn.hidden = false;
    setStatus('Your session ended. Sign in again to check your private profile.', true);
  } else if (error instanceof WalletRequestError && error.statusCode === 409) {
    setStatus('Your profile changed in another tab or device. Reload your Wallet before making another change.', true);
  } else if (error instanceof WalletRequestError && error.statusCode === 503) {
    setStatus('Private profile saving is unavailable right now. Reload your Wallet to check its current state.', true);
  } else if (operation === 'sign-out') {
    setStatus('Sign-out could not be confirmed. Your private details have been cleared from this page. Reload your Wallet to check your session.', true);
  } else if (operation === 'save' || operation === 'delete') {
    setStatus('The change could not be confirmed. Reload your Wallet to check the saved profile before trying again.', true);
  } else {
    setStatus('Your private Wallet could not be checked. Reload to try again; no profile or activity is shown.', true);
  }
}

async function perform(kind: 'load' | 'save' | 'delete' | 'sign-out', message: string,
  work: (signal: AbortSignal) => Promise<{value: WalletSnapshot; message?: string}>): Promise<void> {
  const operation = begin(message);
  try {
    const result = await work(operation.controller.signal);
    if (isCurrent(operation)) render(result.value, result.message);
  } catch (error) {
    if (isCurrent(operation)) failure(error, kind);
  } finally {
    if (operation.generation === generation && active === operation.controller) {
      if (!foreground()) invalidate('Private details are hidden. Return to reload your Wallet.');
      else {
        active = null;
        setBusy(false);
      }
    }
  }
}

async function refresh(): Promise<void> {
  if (!foreground()) return;
  await perform('load', 'Checking private profile availability…', async signal => ({
    value: parseWalletSnapshot(await request('/api/wallet', 'wallet-v1', 'GET', signal)),
  }));
}

form.addEventListener('submit', event => {
  event.preventDefault();
  if (busy || snapshot?.account !== 'signed-in' || !form.reportValidity()) return;
  let profile: WalletProfile;
  try {
    profile = parseWalletProfile({
      displayName: displayName.value.trim() || null,
      locale: locale.value.trim(),
      timezone: timezone.value.trim(),
      briefingTime: readingTime.value,
      interests: interestInputs.filter(({input}) => input.checked).map(({topic}) => topic),
      personalPriority: personalFirst.checked ? 'personal-first' : 'balanced',
    });
  } catch {
    setStatus('Check your language code, time zone and preferred reading time. Keep the display name within 80 characters and use ordinary text.', true);
    return;
  }
  const expectedRevision = snapshot.profile?.revision ?? null;
  void perform('save', 'Saving your private profile…', async signal => {
    const value = parseWalletSnapshot(await request('/api/wallet', 'wallet-v1', 'PUT', signal, {expectedRevision, value: profile}));
    if (value.account !== 'signed-in' || value.profile === null
      || JSON.stringify(value.profile.value) !== JSON.stringify(profile)) throw new Error('WALLET_WRITE_NOT_CONFIRMED');
    return {value, message: 'Your private profile is saved. Account connections are managed separately below. Automatic delivery is not active.'};
  });
});

deleteButton.addEventListener('click', () => {
  if (busy || snapshot?.account !== 'signed-in' || !snapshot.profile) return;
  pendingDelete = snapshot.profile.revision;
  confirmation.hidden = false;
  deleteButton.setAttribute('aria-expanded', 'true');
  deleteCancel.focus();
});

deleteCancel.addEventListener('click', () => {
  closeConfirmation();
  deleteButton.focus();
});

deleteConfirm.addEventListener('click', () => {
  const expectedRevision = pendingDelete;
  if (busy || !expectedRevision || snapshot?.profile?.revision !== expectedRevision) return;
  void perform('delete', 'Deleting your Wallet preferences…', async signal => {
    const value = parseWalletSnapshot(await request('/api/wallet', 'wallet-v1', 'DELETE', signal, {expectedRevision}));
    if (value.account !== 'signed-in' || value.profile !== null) throw new Error('WALLET_DELETE_NOT_CONFIRMED');
    return {value, message: 'Your Wallet preferences were deleted. Your sign-in account and browser briefing are unchanged.'};
  });
});

let sessionChannel: BroadcastChannel | null = null;
try {
  sessionChannel = new BroadcastChannel('dlkt-info-account-session-v1');
  sessionChannel.addEventListener('message', event => {
    if (event.data !== 'signed-out' && event.data !== 'signed-in') return;
    invalidate('Your session changed. Checking your Wallet again…');
    void refresh();
  });
} catch { /* Revalidation on page return remains available. */ }

signOut.addEventListener('click', () => {
  if (busy || snapshot?.account !== 'signed-in') return;
  void perform('sign-out', 'Signing out and clearing private details…', async signal => {
    const result = await request('/api/account-session', 'identity-v1', 'DELETE', signal);
    if (typeof result !== 'object' || result === null || Array.isArray(result)
      || !('version' in result) || result.version !== 'dlkt-info-identity-1'
      || !('configured' in result) || result.configured !== true
      || !('enabled' in result) || result.enabled !== true
      || !('authenticated' in result) || result.authenticated !== false
      || !('user' in result) || result.user !== null
      || !('blocker' in result) || result.blocker !== null) throw new Error('WALLET_SIGNOUT_NOT_CONFIRMED');
    const value = parseWalletSnapshot(await request('/api/wallet', 'wallet-v1', 'GET', signal));
    if (value.account !== 'signed-out') throw new Error('WALLET_SIGNOUT_NOT_CONFIRMED');
    try { sessionChannel?.postMessage('signed-out'); } catch { /* The signed-out readback is already verified. */ }
    return {value, message: 'You are signed out. Your private details have been cleared from this page.'};
  });
});

reload.addEventListener('click', () => { if (!busy) void refresh(); });
document.addEventListener('visibilitychange', () => {
  if (document.hidden) invalidate('Private details are hidden. Return to reload your Wallet.');
  else { focused = document.hasFocus(); void refresh(); }
});
window.addEventListener('pagehide', () => invalidate('Private details are hidden. Return to reload your Wallet.'));
window.addEventListener('pageshow', event => { if (event.persisted) void refresh(); });
window.addEventListener('blur', () => { focused = false; invalidate('Private details are hidden. Return to reload your Wallet.'); });
window.addEventListener('focus', () => { focused = true; if (!active) void refresh(); });
void refresh();
