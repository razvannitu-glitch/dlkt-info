import {getLocale,setupLanguage} from '../i18n/browser.js';
import {LOCALES} from '../i18n/locale.js';
import {initializeCountryLanguage} from '../i18n/country-hint.js';
import {accountText,topicName,applyAccountPresentation} from './presentation.js';
import {ACCOUNT_VERSION, ACCOUNT_MAX_BYTES, parseAccountState, parseAccountValue, isObject, type AccountState, type AccountValue} from './contracts.js';
import {DeviceMemory} from '../iceo/device-memory.js';
import {safeLink} from '../iceo/card-validation.js';
import {DAILY_TOPICS} from '../daily/contracts.js';
import {createPersonalProfileFields} from '../personal/profile-fields.js';
import {WALLET_PROFILE_MAX_BYTES, parseWalletProfile, parseWalletSnapshot, type WalletProfile, type WalletProfileState} from '../wallet/contracts.js';

setupLanguage({updateUrl:false});
const languageReady=initializeCountryLanguage();

function el<T extends HTMLElement>(id: string): T {
  const node = document.getElementById(id);
  if (!node) throw new Error('ACCOUNT_ELEMENT_MISSING');
  return node as T;
}
const message = el('account-message');
const login = el<HTMLFormElement>('account-login');
const code = el<HTMLFormElement>('account-code');
const emailInput = el<HTMLInputElement>('account-email');
const otpInput = el<HTMLInputElement>('account-otp');
const panel = el('account-data');
const signOut = el<HTMLButtonElement>('account-signout');
const device = new DeviceMemory();
const profilePanel = el('account-profile');
const profileForm = el<HTMLFormElement>('account-profile-form');
const profileName = el<HTMLInputElement>('account-profile-name');
const profileLocale = el<HTMLSelectElement>('account-profile-locale');
const profileTimezone = el<HTMLInputElement>('account-profile-timezone');
const personalFields = createPersonalProfileFields('account-profile');
const profileInterests = new Map<string, HTMLInputElement>();
for (const topic of DAILY_TOPICS) {
  const label = document.createElement('label');
  const input = document.createElement('input'); input.type = 'checkbox'; input.value = topic;
  const name=text('span',topicName(topic));name.dataset.accountCopy=topicName(topic);
  label.append(input,name);
  el('account-profile-interests').append(label); profileInterests.set(topic, input);
}
document.addEventListener('dlkt:language-changed',applyAccountPresentation);
applyAccountPresentation();
function setProfileLocale(value:string):void{
  profileLocale.replaceChildren();
  const empty=document.createElement('option');empty.value='';empty.textContent=accountText('—');profileLocale.append(empty);
  for(const locale of LOCALES){
    const option=document.createElement('option');option.value=locale.code;option.textContent=locale.nativeName;
    option.lang=locale.code;profileLocale.append(option);
  }
  if(value&&!LOCALES.some(locale=>locale.code===value)){
    const option=document.createElement('option');option.value=value;
    try{option.textContent=new Intl.DisplayNames([getLocale()],{type:'language'}).of(value)??value;}catch{option.textContent=value;}
    profileLocale.append(option);
  }
  profileLocale.value=value;
}
type ReturnIntent = 'wallet' | null;
// An exact enum, never a URL supplied by the caller. Extra or encoded queries fail closed.
const returnIntent: ReturnIntent = window.location.search === '?returnTo=wallet' && window.location.hash === '' ? 'wallet' : null;
type Session = {readonly status: 'unavailable'; readonly userId: null}
  | {readonly status: 'signed-out'; readonly userId: null}
  | {readonly status: 'signed-in'; readonly userId: string};
type Operation = {readonly generation: number; readonly controller: AbortController};
type ActionKind = 'load' | 'request-code' | 'verify-code' | 'prepare-import' | 'upload' | 'restore' | 'delete' | 'sign-out' | 'save-profile';
type ProfileView = {readonly status: 'unavailable'} | {readonly status: 'ready'; readonly profile: WalletProfileState | null};
type Pending = {readonly kind: 'upload'; readonly ownerId: string; readonly copy: AccountState | null; readonly value: AccountValue; readonly profile: ProfileView}
  | {readonly kind: 'restore' | 'delete'; readonly ownerId: string; readonly copy: AccountState; readonly profile: ProfileView};
let state: AccountState | null = null;
let profileView: ProfileView = {status: 'unavailable'};
let ownerId: string | null = null;
let sessionStatus: Session['status'] | 'unknown' = 'unknown';
let pending: Pending | null = null;
let challengeEmail: string | null = null;
let displayedEmail = '';
let generation = 0;
let active: AbortController | null = null;
let busy = false;
let focused = document.hasFocus();

class AccountRequestError extends Error {
  constructor(readonly statusCode: number) { super('ACCOUNT_REQUEST_FAILED'); }
}
function foreground(): boolean { return !document.hidden && focused && document.hasFocus(); }
function isCurrent(operation: Operation): boolean {
  return operation.generation === generation && active === operation.controller
    && !operation.controller.signal.aborted && foreground();
}
function requireCurrent(operation: Operation): void {
  if (!isCurrent(operation)) throw new Error('ACCOUNT_OPERATION_INVALIDATED');
}
function text(tag: string, value: string): HTMLElement {
  const node = document.createElement(tag);
  node.textContent = accountText(value);
  return node;
}
function normalizedEmail(value: string): string { return value.normalize('NFKC').trim().toLowerCase(); }
function setEmail(value: string): void { emailInput.value = value; displayedEmail = normalizedEmail(value); }
function setBusy(value: boolean): void {
  busy = value;
  for (const element of [panel, login, code, profileForm]) element.setAttribute('aria-busy', String(value));
  for (const input of profileInterests.values()) input.disabled = value;
  personalFields.setBusy(value);
  document.querySelectorAll<HTMLInputElement | HTMLButtonElement | HTMLSelectElement>('input, button, select').forEach(control => { control.disabled = value; });
}
function closeConfirmation(): void {
  pending = null;
  el('account-confirmation').hidden = true;
  el('account-confirm-copy').textContent = accountText('');
}
/** Only the acknowledged email challenge survives an email-app round trip in page memory. */
function clearPrivate(): void {
  state = null; ownerId = null; sessionStatus = 'unknown';
  profileView = {status: 'unavailable'}; profilePanel.hidden = true; profileForm.hidden = true;
  profileName.value = ''; setProfileLocale(''); profileTimezone.value = '';
  personalFields.clear();
  for (const input of profileInterests.values()) input.checked = false;
  el('account-profile-summary').replaceChildren(); el('account-profile-message').textContent = accountText('');
  panel.hidden = true; signOut.hidden = true; login.hidden = true; code.hidden = true;
  el('account-summary').replaceChildren(); el('account-saved').replaceChildren();
  closeConfirmation(); setEmail(''); otpInput.value = '';
}
function invalidate(status: string, forgetChallenge = false): void {
  generation += 1;
  active?.abort(); active = null;
  if (forgetChallenge) challengeEmail = null;
  clearPrivate(); setBusy(false); message.textContent = accountText(status);
}
function begin(status: string): Operation {
  invalidate(status);
  const controller = new AbortController(); active = controller; setBusy(true);
  return {generation, controller};
}

async function abortable<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) { void work.catch(() => undefined); throw new Error('ACCOUNT_REQUEST_ABORTED'); }
  return new Promise<T>((resolve, reject) => {
    const aborted = (): void => { signal.removeEventListener('abort', aborted); reject(new Error('ACCOUNT_REQUEST_ABORTED')); };
    signal.addEventListener('abort', aborted, {once: true});
    work.then(value => { signal.removeEventListener('abort', aborted); resolve(value); }, error => {
      signal.removeEventListener('abort', aborted); reject(error);
    });
  });
}
async function readResponse(response: Response, signal: AbortSignal, maximum: number): Promise<unknown> {
  const size = response.headers.get('content-length');
  if (!/^application\/json(?:\s*;|$)/iu.test(response.headers.get('content-type') ?? '')
    || (size !== null && (!/^\d+$/u.test(size) || Number(size) > maximum))) {
    void response.body?.cancel().catch(() => undefined);
    throw new Error('ACCOUNT_RESPONSE_INVALID');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error('ACCOUNT_RESPONSE_INVALID');
  const decoder = new TextDecoder('utf-8', {fatal: true});
  const chunks: string[] = []; let bytes = 0;
  try {
    while (true) {
      const part = await abortable(reader.read(), signal);
      if (part.done) break;
      bytes += part.value.byteLength;
      if (bytes > maximum) { void reader.cancel().catch(() => undefined); throw new Error('ACCOUNT_RESPONSE_TOO_LARGE'); }
      chunks.push(decoder.decode(part.value, {stream: true}));
    }
    chunks.push(decoder.decode());
    if (signal.aborted) throw new Error('ACCOUNT_REQUEST_ABORTED');
    return JSON.parse(chunks.join('')) as unknown;
  } finally {
    if (signal.aborted) void reader.cancel().catch(() => undefined);
    reader.releaseLock();
  }
}
async function request(path: '/api/account' | '/api/account-session' | '/api/wallet', method: 'GET' | 'POST' | 'PUT' | 'DELETE', signal: AbortSignal, body?: unknown, expectedOwner?: string): Promise<unknown> {
  const timeout = new AbortController(); const abort = (): void => timeout.abort();
  signal.addEventListener('abort', abort, {once: true}); if (signal.aborted) timeout.abort();
  const timer = window.setTimeout(abort, 25_000);
  try {
    const response = await abortable(fetch(path, {
      method, credentials: 'same-origin',
      headers: {Accept: 'application/json', 'Content-Type': 'application/json', 'X-DLKT-Info-Request': path === '/api/account' ? 'account-v1' : path === '/api/wallet' ? 'wallet-v1' : 'identity-v1', ...(expectedOwner === undefined ? {} : {'X-DLKT-Info-Owner': expectedOwner})},
      ...(body === undefined ? {} : {body: JSON.stringify(body)}),
      cache: 'no-store', redirect: 'error', signal: timeout.signal,
    }), timeout.signal);
    if (!response.ok) { void response.body?.cancel().catch(() => undefined); throw new AccountRequestError(response.status); }
    return await readResponse(response, timeout.signal, path === '/api/account' ? ACCOUNT_MAX_BYTES + 65_536 : path === '/api/wallet' ? WALLET_PROFILE_MAX_BYTES + 16_384 : 16_384);
  } finally { window.clearTimeout(timer); signal.removeEventListener('abort', abort); }
}

function parseSession(value: unknown, challenge = false): Session {
  const keys = challenge ? 'authenticated,blocker,challenge,configured,enabled,user,version' : 'authenticated,blocker,configured,enabled,user,version';
  if (!isObject(value) || Object.keys(value).sort().join(',') !== keys || value.version !== 'dlkt-info-identity-1'
    || typeof value.configured !== 'boolean' || typeof value.enabled !== 'boolean' || typeof value.authenticated !== 'boolean'
    || (value.blocker !== null && typeof value.blocker !== 'string')
    || (challenge && value.challenge !== 'code-sent')) throw new Error('ACCOUNT_SESSION_RESPONSE_INVALID');
  if (!value.enabled) {
    if (value.authenticated || value.user !== null || challenge) throw new Error('ACCOUNT_SESSION_RESPONSE_INVALID');
    return {status: 'unavailable', userId: null};
  }
  if (!value.configured || value.blocker !== null) throw new Error('ACCOUNT_SESSION_RESPONSE_INVALID');
  if (!value.authenticated) {
    if (value.user !== null) throw new Error('ACCOUNT_SESSION_RESPONSE_INVALID');
    return {status: 'signed-out', userId: null};
  }
  if (challenge || !isObject(value.user) || Object.keys(value.user).sort().join(',') !== 'email,id'
    || typeof value.user.id !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value.user.id)
    || typeof value.user.email !== 'string' || value.user.email.length > 254
    || /[\u0000-\u001f\u007f]/u.test(value.user.email)
    || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(value.user.email)) throw new Error('ACCOUNT_SESSION_RESPONSE_INVALID');
  return {status: 'signed-in', userId: value.user.id};
}
function parseCopy(value: unknown): AccountState | null {
  if (!isObject(value) || Object.keys(value).sort().join(',') !== 'enabled,state,version'
    || value.version !== ACCOUNT_VERSION || value.enabled !== true) throw new Error('ACCOUNT_COPY_UNAVAILABLE');
  return value.state === null ? null : parseAccountState(value.state);
}
async function readSession(operation: Operation): Promise<Session> {
  const result = parseSession(await request('/api/account-session', 'GET', operation.controller.signal));
  requireCurrent(operation); return result;
}
async function requireOwner(operation: Operation, expectedOwner: string): Promise<void> {
  const session = await readSession(operation);
  if (session.status !== 'signed-in' || session.userId !== expectedOwner) throw new Error('ACCOUNT_SESSION_CHANGED');
}
function renderCopy(): void {
  const summary = el('account-summary'); const list = el('account-saved');
  summary.replaceChildren(); list.replaceChildren();
  if (!state) { summary.append(text('p', 'No reader copy has been saved in this account.')); return; }
  summary.append(text('p', `${state.value.cards.length} saved cards. ${state.value.focus ? 'A remembered focus.' : 'No remembered focus.'} ${state.value.checkpoint ? 'A comparison check.' : 'No comparison check.'}`),
    text('p', `Account copy updated: ${state.updatedAt}. Saved cards are dated copies, not fresh source checks.`));
  for (const card of state.value.cards) {
    const paragraph = text('p', ''); const link = text('a', card.card.title) as HTMLAnchorElement;
    link.href = safeLink(card.card.sourceUrl) ?? '#'; link.target = '_blank'; link.rel = 'noopener noreferrer';
    paragraph.append(link); list.append(paragraph);
  }
}

function newProfile(): WalletProfile {
  const defaults = new Intl.DateTimeFormat().resolvedOptions();
  return parseWalletProfile({displayName: null, locale: getLocale(), timezone: defaults.timeZone,
    briefingTime: '08:00', interests: [], personalPriority: 'balanced', cityId: null, localNeeds: []});
}
function renderProfile(): void {
  profilePanel.hidden = false;
  const summary = el('account-profile-summary'); summary.replaceChildren();
  if (profileView.status !== 'ready') {
    profileForm.hidden = true;
    el('account-profile-message').textContent = accountText('Profile preferences could not be loaded. Reload your account to retry. Your saved reader copy remains available.');
    return;
  }
  const saved = profileView.profile;
  const value = saved?.value ?? newProfile();
  profileName.value = value.displayName ?? ''; setProfileLocale(value.locale); profileTimezone.value = value.timezone;
  personalFields.render(value);
  for (const [topic, input] of profileInterests) input.checked = value.interests.some(interest => interest === topic);
  summary.append(text('p', saved ? `Profile updated: ${saved.updatedAt}.` : 'No profile has been saved in this account. These starting values are saved only when you choose Save profile.'));
  el('account-profile-message').textContent = accountText('');
  profileForm.hidden = false; applyAccountPresentation();
}
async function readProfile(operation: Operation, id: string): Promise<ProfileView> {
  let snapshot: ReturnType<typeof parseWalletSnapshot>;
  try {
    snapshot = parseWalletSnapshot(await request('/api/wallet', 'GET', operation.controller.signal, undefined, id));
  } catch (error) {
    requireCurrent(operation);
    if (error instanceof AccountRequestError && (error.statusCode === 401 || error.statusCode === 403)) throw error;
    if (error instanceof AccountRequestError && error.statusCode === 409) throw new Error('ACCOUNT_SESSION_CHANGED');
    await requireOwner(operation, id);
    return {status: 'unavailable'};
  }
  requireCurrent(operation);
  if (snapshot.account === 'signed-out') throw new Error('ACCOUNT_SESSION_CHANGED');
  // The reader copy is private too: null or unavailable profiles must not bypass owner revalidation.
  await requireOwner(operation, id);
  if (snapshot.account !== 'signed-in') return {status: 'unavailable'};
  return {status: 'ready', profile: snapshot.profile};
}

function showSignedOut(email = challengeEmail ?? ''): void {
  sessionStatus = 'signed-out'; login.hidden = false; code.hidden = challengeEmail === null; setEmail(email);
}
function showAccount(id: string, copy: AccountState | null, profile: ProfileView): void {
  challengeEmail = null; ownerId = id; state = copy; profileView = profile; sessionStatus = 'signed-in';
  setEmail(''); otpInput.value = '';
  login.hidden = true; code.hidden = true; panel.hidden = false; signOut.hidden = false; renderCopy(); renderProfile();
}
async function showSession(session: Session, operation: Operation): Promise<void> {
  requireCurrent(operation);
  if (session.status === 'unavailable') {
    challengeEmail = null; sessionStatus = 'unavailable';
    message.textContent = accountText('Account sign-in and cross-device saving are not activated yet. Reading, browser-only saving and edition preparation remain available. No email address is collected here.');
    return;
  }
  if (session.status === 'signed-out') {
    showSignedOut();
    message.textContent = accountText(challengeEmail ? 'Enter the sign-in code sent to your email. You can request another code if needed.' : 'Sign in to access your reader copy across devices.');
    return;
  }
  challengeEmail = null;
  if (returnIntent === 'wallet') {
    invalidate('Your session is confirmed. Opening Info Wallet.', true);
    window.location.replace('/wallet'); return;
  }
  const copy = parseCopy(await request('/api/account', 'GET', operation.controller.signal));
  const profile = await readProfile(operation, session.userId);
  requireCurrent(operation); showAccount(session.userId, copy, profile);
  message.textContent = accountText('Signed in. Local data is not uploaded automatically.');
}
function failure(error: unknown, kind: ActionKind): void {
  clearPrivate();
  if (error instanceof AccountRequestError && error.statusCode === 400 && kind === 'verify-code' && challengeEmail) {
    showSignedOut(); message.textContent = accountText('The code was not accepted. Try the code from your email or request a new code.');
  } else if (error instanceof AccountRequestError && error.statusCode === 429 && (kind === 'verify-code' || kind === 'request-code')) {
    showSignedOut(); message.textContent = accountText('Too many sign-in attempts. Wait before trying again.');
  } else if (error instanceof AccountRequestError && error.statusCode === 401) {
    challengeEmail = null; message.textContent = accountText('Your session ended. Check account to sign in again. Private account details and pending actions have been cleared.');
  } else if (error instanceof Error && error.message === 'ACCOUNT_SESSION_CHANGED') {
    challengeEmail = null; message.textContent = accountText('Your session changed. Check account before making another change. Private details and pending actions have been cleared.');
  } else if (error instanceof AccountRequestError && error.statusCode === 409) {
    message.textContent = accountText(kind === 'save-profile' ? 'This profile changed on another device. Reload your account before saving again.' : 'This account copy changed on another device. Check account to reload it before making another change.');
  } else if (kind === 'save-profile') {
    message.textContent = accountText('The profile change could not be confirmed. Reload your account before retrying. Private details and pending changes have been cleared.');
  } else if (kind === 'sign-out') {
    challengeEmail = null; message.textContent = accountText('Sign-out could not be confirmed. Private details have been cleared from this page. Check account to verify your session.');
  } else if (kind === 'upload' || kind === 'restore' || kind === 'delete') {
    message.textContent = accountText('The change could not be confirmed. Check account and the browser copy before trying again. No pending action is retained.');
  } else {
    message.textContent = accountText('Account availability could not be verified. Private details are hidden. Check account to try again.');
  }
}
async function perform(kind: ActionKind, status: string, work: (operation: Operation) => Promise<void>): Promise<void> {
  if (busy || !foreground()) return;
  const operation = begin(status);
  try { await work(operation); }
  catch (error) { if (isCurrent(operation)) failure(error, kind); }
  finally {
    if (operation.generation === generation && active === operation.controller) {
      if (!foreground()) invalidate('Private details are hidden. Return to check your account.');
      else {
        active = null; setBusy(false);
        if ((kind === 'request-code' || kind === 'verify-code') && challengeEmail && !code.hidden) otpInput.focus();
      }
    }
  }
}
async function refresh(): Promise<void> {
  await perform('load', 'Checking account availability.', async operation => { await showSession(await readSession(operation), operation); });
}

let sessionChannel: BroadcastChannel | null = null;
try {
  sessionChannel = new BroadcastChannel('dlkt-info-account-session-v1');
  sessionChannel.addEventListener('message', event => {
    if (event.data !== 'signed-out' && event.data !== 'signed-in') return;
    invalidate('Your session changed. Checking your account again.', true); void refresh();
  });
} catch { /* Foreground revalidation also works without a session channel. */ }
function signalSession(change: 'signed-in' | 'signed-out'): void {
  try { sessionChannel?.postMessage(change); } catch { /* Session verification does not depend on broadcasting. */ }
}

emailInput.addEventListener('input', () => {
  const raw = emailInput.value; const next = normalizedEmail(raw);
  if (next === displayedEmail) return;
  const wasSignedOut = sessionStatus === 'signed-out';
  if (active || challengeEmail !== null) {
    invalidate('Email changed. Request a sign-in code for this address.', true);
    if (wasSignedOut && foreground()) showSignedOut(raw);
  } else { challengeEmail = null; otpInput.value = ''; code.hidden = true; displayedEmail = next; }
});
login.addEventListener('submit', event => {
  event.preventDefault();
  if (busy || sessionStatus !== 'signed-out' || !foreground() || !login.reportValidity()) return;
  const email = normalizedEmail(emailInput.value);
  if (email.length > 254 || /[\u0000-\u001f\u007f]/u.test(email) || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/u.test(email)) return;
  challengeEmail = null;
  void perform('request-code', 'Requesting a sign-in code.', async operation => {
    showSignedOut(email);
    await languageReady; requireCurrent(operation);
    let timezone = 'UTC';
    try { timezone = new Intl.DateTimeFormat().resolvedOptions().timeZone; } catch { /* UTC fallback. */ }
    const result = parseSession(await request('/api/account-session', 'POST', operation.controller.signal,
      {action: 'request-code', email, timezone, locale: getLocale()}), true);
    requireCurrent(operation);
    if (result.status !== 'signed-out') throw new Error('ACCOUNT_CHALLENGE_NOT_CONFIRMED');
    challengeEmail = email; showSignedOut(); message.textContent = accountText('Enter the sign-in code sent to your email.');
  });
});
code.addEventListener('submit', event => {
  event.preventDefault();
  if (busy || sessionStatus !== 'signed-out' || !foreground() || !code.reportValidity()) return;
  if (challengeEmail === null || normalizedEmail(emailInput.value) !== challengeEmail) {
    const raw = emailInput.value;
    invalidate('Email changed. Request a sign-in code for this address.', true); showSignedOut(raw); return;
  }
  const email = challengeEmail; const otp = otpInput.value.trim();
  if (!/^\d{6,10}$/u.test(otp)) return;
  void perform('verify-code', 'Verifying your sign-in code.', async operation => {
    showSignedOut();
    const acknowledgment = parseSession(await request('/api/account-session', 'PUT', operation.controller.signal,
      {action: 'verify-code', email, code: otp}));
    requireCurrent(operation);
    if (acknowledgment.status !== 'signed-in') throw new Error('ACCOUNT_SIGNIN_NOT_CONFIRMED');
    const session = await readSession(operation);
    if (session.status !== 'signed-in' || session.userId !== acknowledgment.userId) throw new Error('ACCOUNT_SIGNIN_NOT_CONFIRMED');
    challengeEmail = null; signalSession('signed-in'); await showSession(session, operation);
  });
});
signOut.addEventListener('click', () => {
  if (busy || sessionStatus !== 'signed-in' || !ownerId) return;
  challengeEmail = null;
  void perform('sign-out', 'Signing out and clearing private details.', async operation => {
    const result = parseSession(await request('/api/account-session', 'DELETE', operation.controller.signal));
    requireCurrent(operation);
    if (result.status !== 'signed-out') throw new Error('ACCOUNT_SIGNOUT_NOT_CONFIRMED');
    const session = await readSession(operation);
    if (session.status !== 'signed-out') throw new Error('ACCOUNT_SIGNOUT_NOT_CONFIRMED');
    signalSession('signed-out'); showSignedOut();
    message.textContent = accountText('You are signed out. Private account details and pending actions have been cleared from this page.');
  });
});
el('account-check').addEventListener('click', () => { if (!busy) void refresh(); });
el('account-reload').addEventListener('click', () => { if (!busy && sessionStatus === 'signed-in') void refresh(); });
el('account-upload').addEventListener('click', () => {
  if (busy || sessionStatus !== 'signed-in' || !ownerId) return;
  const id = ownerId; const copy = state; const profile = profileView;
  void perform('prepare-import', 'Checking the browser copy before confirmation.', async operation => {
    await requireOwner(operation, id);
    const local = await device.read(); requireCurrent(operation);
    const checkpoint = await device.readCheckpoint(); requireCurrent(operation);
    if (local.rejected) throw new Error('ACCOUNT_LOCAL_COPY_INVALID');
    const value = parseAccountValue({focus: local.focus, cards: local.cards, checkpoint});
    showAccount(id, copy, profile); pending = {kind: 'upload', ownerId: id, copy, value, profile};
    el('account-confirm-copy').textContent = `Replace the account reader copy with ${value.cards.length} saved cards, ${value.focus ? 'your remembered focus' : 'no remembered focus'} and ${value.checkpoint ? 'your saved comparison' : 'no comparison'} from this browser? Existing account data will be replaced; browser data stays intact.`;
    el('account-confirmation').hidden = false; message.textContent = accountText('Review the replacement before confirming. Nothing has been imported.');
  });
});
el('account-restore').addEventListener('click', () => {
  if (busy || !foreground() || sessionStatus !== 'signed-in' || !ownerId || !state) return;
  pending = {kind: 'restore', ownerId, copy: state, profile: profileView};
  el('account-confirm-copy').textContent = accountText('Replace this browser’s remembered focus, saved cards and comparison check with the account copy? Other site data will not be changed.');
  el('account-confirmation').hidden = false;
});
el('account-delete').addEventListener('click', () => {
  if (busy || !foreground() || sessionStatus !== 'signed-in' || !ownerId || !state) return;
  pending = {kind: 'delete', ownerId, copy: state, profile: profileView};
  el('account-confirm-copy').textContent = accountText('Delete only the reader copy from this account? This does not delete your sign-in account or local browser copies.');
  el('account-confirmation').hidden = false;
});
el('account-cancel').addEventListener('click', () => { if (!busy) closeConfirmation(); });
el('account-confirm').addEventListener('click', () => {
  const choice = pending;
  if (busy || !choice || sessionStatus !== 'signed-in' || ownerId !== choice.ownerId
    || (state?.revision ?? null) !== (choice.copy?.revision ?? null)) return;
  void perform(choice.kind, 'Checking your session before applying the confirmed change.', async operation => {
    await requireOwner(operation, choice.ownerId);
    if (choice.kind === 'upload') {
      const result = parseCopy(await request('/api/account', 'PUT', operation.controller.signal,
        {expectedRevision: choice.copy?.revision ?? null, value: choice.value}));
      requireCurrent(operation);
      if (!result || JSON.stringify(result.value) !== JSON.stringify(choice.value)) throw new Error('ACCOUNT_WRITE_NOT_CONFIRMED');
      showAccount(choice.ownerId, result, choice.profile); message.textContent = accountText('Reader copy saved to the account. The local browser copy is unchanged.');
    } else if (choice.kind === 'restore') {
      await device.restorePersonal(choice.copy.value, operation.controller.signal); requireCurrent(operation); showAccount(choice.ownerId, choice.copy, choice.profile);
      message.textContent = accountText('Account copy restored in this browser. Return to the briefing to use it.');
      try { const channel = new BroadcastChannel('dlkt-info-device-changes-v1'); channel.postMessage('changed'); channel.close(); }
      catch { /* The explicitly confirmed local transaction has already committed. */ }
    } else {
      const result = parseCopy(await request('/api/account', 'DELETE', operation.controller.signal, {expectedRevision: choice.copy.revision}));
      requireCurrent(operation);
      if (result !== null) throw new Error('ACCOUNT_DELETE_NOT_CONFIRMED');
      showAccount(choice.ownerId, null, choice.profile); message.textContent = accountText('Account reader copy deleted. Local browser data is unchanged.');
    }
  });
});

profileForm.addEventListener('submit', event => {
  event.preventDefault();
  if (busy || !foreground() || sessionStatus !== 'signed-in' || !ownerId || profileView.status !== 'ready') return;
  const id = ownerId, copy = state, prior = profileView.profile;
  let value: WalletProfile;
  try {
    const base = prior?.value ?? newProfile();
    value = parseWalletProfile({...base, displayName: profileName.value.trim() || null,
      locale: profileLocale.value.trim(), timezone: profileTimezone.value.trim(),
      interests: [...profileInterests].filter(([, input]) => input.checked).map(([topic]) => topic), ...personalFields.read()});
  } catch {
    el('account-profile-message').textContent = accountText('Check the name, language tag, timezone and interests before saving.');
    return;
  }
  void perform('save-profile', 'Checking your session before saving the profile.', async operation => {
    await requireOwner(operation, id);
    const snapshot = parseWalletSnapshot(await request('/api/wallet', 'PUT', operation.controller.signal,
      {expectedRevision: prior?.revision ?? null, value}, id));
    requireCurrent(operation);
    if (snapshot.account !== 'signed-in' || snapshot.profile === null
      || JSON.stringify(snapshot.profile.value) !== JSON.stringify(value)) throw new Error('ACCOUNT_PROFILE_WRITE_NOT_CONFIRMED');
    await requireOwner(operation, id);
    showAccount(id, copy, {status: 'ready', profile: snapshot.profile});
    message.textContent = accountText('Profile saved to your account. Open Info Wallet to read your personal selection. Your saved reader copy and this browser’s reading preferences are unchanged.');
  });
});

document.addEventListener('visibilitychange', () => {
  if (document.hidden) invalidate('Private details are hidden. Return to check your account.');
  else { focused = document.hasFocus(); void refresh(); }
});
window.addEventListener('pagehide', () => invalidate('Private details are hidden. Return to check your account.'));
window.addEventListener('pageshow', event => { if (event.persisted) { focused = document.hasFocus(); void refresh(); } });
window.addEventListener('blur', () => { focused = false; invalidate('Private details are hidden. Return to check your account.'); });
window.addEventListener('focus', () => { focused = true; if (!active) void refresh(); });
void refresh();
