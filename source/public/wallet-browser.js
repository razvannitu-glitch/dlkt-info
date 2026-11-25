import { parseWalletProfile, parseWalletSnapshot, walletSnapshot } from './wallet-contracts.js';
import { createPersonalProfileFields } from './personal-profile-fields.js';
import { createPersonalReader } from './personal-browser.js';
import { parsePersonalSession } from './personal-session.js';
import { createConnectionsWallet } from './connections-browser.js';
import { DAILY_TOPICS } from './daily-contracts.js';
import { TOPIC_LABELS, TOPIC_DESCRIPTIONS } from './topics.js';
function el(id) {
    const element = document.getElementById(id);
    if (!element)
        throw new Error('WALLET_ELEMENT_MISSING');
    return element;
}
const connections = createConnectionsWallet(() => {
    invalidate('Your session ended. Sign in again to check your private profile.');
    signIn.hidden = false;
});
const personalReader = createPersonalReader(() => {
    invalidate('Your saved profile or session changed. Reload your Wallet before reading personal cards.');
});
const personalFields = createPersonalProfileFields('wallet');
const status = el('wallet-status');
const account = el('wallet-account');
const panel = el('wallet-profile-panel');
const form = el('wallet-profile-form');
const signIn = el('wallet-signin');
const signOut = el('wallet-signout');
const reload = el('wallet-reload');
const displayName = el('wallet-display-name');
const locale = el('wallet-locale');
const timezone = el('wallet-timezone');
const readingTime = el('wallet-briefing-time');
const balanced = el('wallet-priority-balanced');
const personalFirst = el('wallet-priority-personal');
const deleteButton = el('wallet-delete');
const confirmation = el('wallet-delete-confirmation');
const deleteConfirm = el('wallet-delete-confirm');
const deleteCancel = el('wallet-delete-cancel');
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
    return { topic, input };
});
let snapshot = null;
let ownerId = null;
let pendingDelete = null;
let generation = 0;
let active = null;
let busy = false;
let focused = document.hasFocus();
class WalletRequestError extends Error {
    statusCode;
    constructor(statusCode) {
        super('WALLET_REQUEST_FAILED');
        this.statusCode = statusCode;
    }
}
function setStatus(value, warning = false) {
    status.textContent = value;
    status.dataset.level = warning ? 'warning' : 'normal';
}
function setBusy(value) {
    busy = value;
    account.setAttribute('aria-busy', String(value));
    form.setAttribute('aria-busy', String(value));
    personalFields.setBusy(value);
    form.querySelectorAll('input, button, select').forEach(control => {
        control.disabled = value;
    });
    for (const control of [reload, signOut, deleteConfirm, deleteCancel])
        control.disabled = value;
}
function closeConfirmation() {
    pendingDelete = null;
    confirmation.hidden = true;
    deleteButton.setAttribute('aria-expanded', 'false');
}
/** Clear private fields before checking a session, leaving the page, or starting a mutation. */
function clearPrivate() {
    snapshot = null;
    ownerId = null;
    personalReader.clear();
    personalFields.clear();
    panel.hidden = true;
    signIn.hidden = true;
    signOut.hidden = true;
    deleteButton.hidden = true;
    form.reset();
    for (const input of [displayName, locale, timezone, readingTime])
        input.value = '';
    balanced.checked = false;
    personalFirst.checked = false;
    for (const { input } of interestInputs)
        input.checked = false;
    el('wallet-profile-summary').textContent = '';
    connections.clear();
    closeConfirmation();
}
function invalidate(message) {
    generation += 1;
    active?.abort();
    active = null;
    clearPrivate();
    setBusy(false);
    setStatus(message);
}
function begin(message) {
    invalidate(message);
    const controller = new AbortController();
    active = controller;
    setBusy(true);
    return { generation, controller };
}
function isCurrent(operation) {
    return operation.generation === generation && active === operation.controller
        && !operation.controller.signal.aborted && foreground();
}
function foreground() {
    return !document.hidden && focused && document.hasFocus();
}
async function request(path, marker, method, signal, body, expectedOwner) {
    const timeout = new AbortController();
    const abort = () => timeout.abort();
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted)
        timeout.abort();
    const timer = window.setTimeout(abort, 25_000);
    try {
        const response = await fetch(path, {
            method,
            credentials: 'same-origin',
            cache: 'no-store',
            redirect: 'error',
            headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'X-DLKT-Info-Request': marker, ...(expectedOwner === undefined ? {} : { 'X-DLKT-Info-Owner': expectedOwner }) },
            ...(body === undefined ? {} : { body: JSON.stringify(body) }),
            signal: timeout.signal,
        });
        if (!response.ok)
            throw new WalletRequestError(response.status);
        const value = await response.json();
        if (signal.aborted || timeout.signal.aborted)
            throw new Error('WALLET_REQUEST_ABORTED');
        return value;
    }
    finally {
        window.clearTimeout(timer);
        signal.removeEventListener('abort', abort);
    }
}
function defaults() {
    let preferredLocale = 'en';
    let preferredZone = 'UTC';
    try {
        preferredLocale = new Intl.Locale(navigator.language).toString();
        preferredZone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
        return parseWalletProfile({ displayName: null, locale: preferredLocale, timezone: preferredZone,
            briefingTime: '08:00', interests: [], personalPriority: 'balanced', cityId: null, localNeeds: [] });
    }
    catch {
        return parseWalletProfile({ displayName: null, locale: 'en', timezone: 'UTC',
            briefingTime: '08:00', interests: [], personalPriority: 'balanced', cityId: null, localNeeds: [] });
    }
}
async function requireOwner(id, signal) {
    const session = parsePersonalSession(await request('/api/account-session', 'identity-v1', 'GET', signal));
    if (session.status !== 'signed-in' || session.userId !== id)
        throw new Error('WALLET_SESSION_CHANGED');
}
function render(value, message, verifiedOwner) {
    if (value.account === 'signed-in' && !verifiedOwner)
        throw new Error('WALLET_OWNER_NOT_VERIFIED');
    snapshot = value;
    ownerId = value.account === 'signed-in' ? verifiedOwner ?? null : null;
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
    personalFields.render(profile);
    displayName.value = profile.displayName ?? '';
    locale.value = profile.locale;
    timezone.value = profile.timezone;
    readingTime.value = profile.briefingTime;
    balanced.checked = profile.personalPriority === 'balanced';
    personalFirst.checked = profile.personalPriority === 'personal-first';
    for (const { topic, input } of interestInputs)
        input.checked = profile.interests.includes(topic);
    deleteButton.hidden = value.profile === null;
    el('wallet-profile-summary').textContent = value.profile === null
        ? 'Your profile has not been saved yet. Review these preferences before saving.'
        : `Your profile was saved on ${new Date(value.profile.updatedAt).toLocaleString('en', { timeZone: profile.timezone })} (${profile.timezone}).`;
    setStatus(message ?? 'Signed in. Your profile is private. Email and social connections require separate authorization.');
    if (value.profile !== null && ownerId !== null)
        void personalReader.load(value.profile, ownerId);
}
function failure(error, operation) {
    clearPrivate();
    connections.setAccount(error instanceof WalletRequestError && error.statusCode === 401 ? 'signed-out' : 'unavailable');
    if (error instanceof WalletRequestError && error.statusCode === 401) {
        signIn.hidden = false;
        setStatus('Your session ended. Sign in again to check your private profile.', true);
    }
    else if (error instanceof Error && error.message === 'WALLET_SESSION_CHANGED') {
        setStatus('Your session changed. Reload your Wallet before making another change. Private details have been cleared.', true);
    }
    else if (error instanceof WalletRequestError && error.statusCode === 409) {
        setStatus('Your profile changed in another tab or device. Reload your Wallet before making another change.', true);
    }
    else if (error instanceof WalletRequestError && error.statusCode === 503) {
        setStatus('Private profile saving is unavailable right now. Reload your Wallet to check its current state.', true);
    }
    else if (operation === 'sign-out') {
        setStatus('Sign-out could not be confirmed. Your private details have been cleared from this page. Reload your Wallet to check your session.', true);
    }
    else if (operation === 'save' || operation === 'delete') {
        setStatus('The change could not be confirmed. Reload your Wallet to check the saved profile before trying again.', true);
    }
    else {
        setStatus('Your private Wallet could not be checked. Reload to try again; no profile or activity is shown.', true);
    }
}
async function perform(kind, message, work) {
    const operation = begin(message);
    try {
        const result = await work(operation.controller.signal);
        if (isCurrent(operation))
            render(result.value, result.message, result.ownerId);
    }
    catch (error) {
        if (isCurrent(operation))
            failure(error, kind);
    }
    finally {
        if (operation.generation === generation && active === operation.controller) {
            if (!foreground())
                invalidate('Private details are hidden. Return to reload your Wallet.');
            else {
                active = null;
                setBusy(false);
            }
        }
    }
}
async function refresh() {
    if (!foreground())
        return;
    await perform('load', 'Checking private profile availability…', async (signal) => {
        const session = parsePersonalSession(await request('/api/account-session', 'identity-v1', 'GET', signal));
        if (session.status !== 'signed-in')
            return { value: walletSnapshot(session.status) };
        const value = parseWalletSnapshot(await request('/api/wallet', 'wallet-v1', 'GET', signal, undefined, session.userId));
        if (value.account !== 'signed-in')
            return { value };
        await requireOwner(session.userId, signal);
        return { value, ownerId: session.userId };
    });
}
form.addEventListener('submit', event => {
    event.preventDefault();
    if (busy || snapshot?.account !== 'signed-in' || ownerId === null || !form.reportValidity())
        return;
    const expectedOwner = ownerId;
    let profile;
    try {
        profile = parseWalletProfile({
            displayName: displayName.value.trim() || null,
            locale: locale.value.trim(),
            timezone: timezone.value.trim(),
            briefingTime: readingTime.value,
            interests: interestInputs.filter(({ input }) => input.checked).map(({ topic }) => topic),
            personalPriority: personalFirst.checked ? 'personal-first' : 'balanced',
            ...personalFields.read(),
        });
    }
    catch {
        setStatus('Check your language code, time zone and preferred reading time. Keep the display name within 80 characters and use ordinary text.', true);
        return;
    }
    const expectedRevision = snapshot.profile?.revision ?? null;
    void perform('save', 'Saving your private profile…', async (signal) => {
        const value = parseWalletSnapshot(await request('/api/wallet', 'wallet-v1', 'PUT', signal, { expectedRevision, value: profile }, expectedOwner));
        if (value.account !== 'signed-in' || value.profile === null
            || JSON.stringify(value.profile.value) !== JSON.stringify(profile))
            throw new Error('WALLET_WRITE_NOT_CONFIRMED');
        await requireOwner(expectedOwner, signal);
        return { value, ownerId: expectedOwner, message: 'Your private profile is saved. Your personal selection uses these confirmed preferences. Automatic delivery is not active.' };
    });
});
deleteButton.addEventListener('click', () => {
    if (busy || snapshot?.account !== 'signed-in' || !snapshot.profile)
        return;
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
    if (busy || !expectedRevision || snapshot?.profile?.revision !== expectedRevision || ownerId === null)
        return;
    const expectedOwner = ownerId;
    void perform('delete', 'Deleting your Wallet preferences…', async (signal) => {
        const value = parseWalletSnapshot(await request('/api/wallet', 'wallet-v1', 'DELETE', signal, { expectedRevision }, expectedOwner));
        if (value.account !== 'signed-in' || value.profile !== null)
            throw new Error('WALLET_DELETE_NOT_CONFIRMED');
        await requireOwner(expectedOwner, signal);
        return { value, ownerId: expectedOwner, message: 'Your Wallet preferences were deleted. Your sign-in account and browser briefing are unchanged.' };
    });
});
let sessionChannel = null;
try {
    sessionChannel = new BroadcastChannel('dlkt-info-account-session-v1');
    sessionChannel.addEventListener('message', event => {
        if (event.data !== 'signed-out' && event.data !== 'signed-in')
            return;
        invalidate('Your session changed. Checking your Wallet again…');
        void refresh();
    });
}
catch { /* Revalidation on page return remains available. */ }
signOut.addEventListener('click', () => {
    if (busy || snapshot?.account !== 'signed-in')
        return;
    void perform('sign-out', 'Signing out and clearing private details…', async (signal) => {
        const result = await request('/api/account-session', 'identity-v1', 'DELETE', signal);
        if (typeof result !== 'object' || result === null || Array.isArray(result)
            || !('version' in result) || result.version !== 'dlkt-info-identity-1'
            || !('configured' in result) || result.configured !== true
            || !('enabled' in result) || result.enabled !== true
            || !('authenticated' in result) || result.authenticated !== false
            || !('user' in result) || result.user !== null
            || !('blocker' in result) || result.blocker !== null)
            throw new Error('WALLET_SIGNOUT_NOT_CONFIRMED');
        const value = parseWalletSnapshot(await request('/api/wallet', 'wallet-v1', 'GET', signal));
        if (value.account !== 'signed-out')
            throw new Error('WALLET_SIGNOUT_NOT_CONFIRMED');
        try {
            sessionChannel?.postMessage('signed-out');
        }
        catch { /* The signed-out readback is already verified. */ }
        return { value, message: 'You are signed out. Your private details have been cleared from this page.' };
    });
});
reload.addEventListener('click', () => { if (!busy)
    void refresh(); });
document.addEventListener('visibilitychange', () => {
    if (document.hidden)
        invalidate('Private details are hidden. Return to reload your Wallet.');
    else {
        focused = document.hasFocus();
        void refresh();
    }
});
window.addEventListener('pagehide', () => invalidate('Private details are hidden. Return to reload your Wallet.'));
window.addEventListener('pageshow', event => { if (event.persisted)
    void refresh(); });
window.addEventListener('blur', () => { focused = false; invalidate('Private details are hidden. Return to reload your Wallet.'); });
window.addEventListener('focus', () => { focused = true; if (!active)
    void refresh(); });
void refresh();
