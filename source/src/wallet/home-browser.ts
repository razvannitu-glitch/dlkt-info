import {loadPersonalInbox, personalInboxProviderName, personalInboxStatus, PersonalInboxError, type PersonalInbox} from './personal-inbox.js';

const panel = document.getElementById('wallet-home');
const status = document.getElementById('wallet-home-status');
const updates = document.getElementById('wallet-home-updates');
const reload = document.getElementById('wallet-home-refresh') as HTMLButtonElement | null;
let generation = 0;
let active: AbortController | null = null;
let focused = document.hasFocus();
let nextCheck: number | null = null;
let connected = false;
let failures = 0;

function foreground(): boolean {
  return !document.hidden && focused && document.hasFocus();
}

function clear(message: string): void {
  generation += 1;
  active?.abort();
  active = null;
  if (nextCheck !== null) window.clearTimeout(nextCheck);
  nextCheck = null;
  updates?.replaceChildren();
  if (status) status.textContent = message;
  if (reload) { reload.hidden = true; reload.disabled = false; }
  panel?.setAttribute('aria-busy', 'false');
}

function render(value: PersonalInbox): void {
  if (!updates || !status) return;
  updates.replaceChildren();
  status.textContent = personalInboxStatus(value);
  for (const event of value.events) {
    const item = document.createElement('li');
    const link = document.createElement('a');
    link.textContent = event.title;
    link.href = event.sourceUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    link.referrerPolicy = 'no-referrer';
    const details = document.createElement('span');
    details.className = 'wallet-home-update-meta';
    details.textContent = `${personalInboxProviderName(event.providerId)} · ${new Date(event.occurredAt).toLocaleString(undefined, {dateStyle: 'medium', timeStyle: 'short'})}${event.unread === true ? ' · Unread' : event.unread === false ? ' · Read' : ''}`;
    item.append(link, details);
    updates.append(item);
  }
}

async function refresh(): Promise<void> {
  if (!panel || !status || !updates || !foreground() || active) return;
  clear('Checking private account updates…');
  const current = generation;
  const controller = new AbortController();
  active = controller;
  panel.setAttribute('aria-busy', 'true');
  if (reload) { reload.hidden = !connected; reload.disabled = true; }
  const timer = window.setTimeout(() => controller.abort(), 20_000);
  try {
    const value = await loadPersonalInbox(fetch, controller.signal);
    if (generation !== current || active !== controller || controller.signal.aborted || !foreground()) return;
    connected = value.account === 'signed-in' && value.connected > 0;
    failures = value.failedProviders > 0 ? Math.min(failures + 1, 3) : 0;
    render(value);
  } catch (error) {
    if (generation === current && active === controller && foreground()) {
      updates.replaceChildren();
      failures = Math.min(failures + 1, 3);
      if (error instanceof PersonalInboxError && error.reason === 'signed-out') {
        connected = false;
        status.textContent = 'Your session ended. Sign in through Info Wallet to check private updates.';
      } else if (error instanceof PersonalInboxError && (error.reason === 'changed' || error.reason === 'invalid')) {
        connected = false;
        status.textContent = 'Your private connection could not be confirmed. Open Info Wallet to check it.';
      } else status.textContent = 'Your private updates could not be checked. Open Info Wallet or try again.';
    }
  } finally {
    window.clearTimeout(timer);
    controller.abort();
    if (generation === current && active === controller) {
      active = null;
      panel.setAttribute('aria-busy', 'false');
      if (reload) { reload.hidden = !connected; reload.disabled = false; }
      if (connected && foreground()) {
        nextCheck = window.setTimeout(() => { nextCheck = null; void refresh(); }, Math.min(300_000, 60_000 * 2 ** failures));
      }
    }
  }
}

if (panel && status && updates) {
  reload?.addEventListener('click', () => { if (connected) { failures = 0; void refresh(); } });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clear('Private account updates are hidden until you return.');
    else { focused = document.hasFocus(); void refresh(); }
  });
  window.addEventListener('pagehide', () => clear('Private account updates are hidden until you return.'));
  window.addEventListener('pageshow', event => { if (event.persisted) { focused = document.hasFocus(); void refresh(); } });
  window.addEventListener('blur', () => { focused = false; clear('Private account updates are hidden until you return.'); });
  window.addEventListener('focus', () => { focused = true; void refresh(); });
  try {
    const channel = new BroadcastChannel('dlkt-info-account-session-v1');
    channel.addEventListener('message', event => {
      if (event.data !== 'signed-out' && event.data !== 'signed-in') return;
      connected = false;
      failures = 0;
      clear(event.data === 'signed-out' ? 'You are signed out. Open Info Wallet to sign in.' : 'Your account status changed. Checking your Wallet again…');
      if (event.data === 'signed-in') void refresh();
    });
  } catch { /* Server-authenticated checks remain required without cross-tab messages. */ }
  void refresh();
}
