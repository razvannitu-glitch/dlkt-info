import {walletCopy, walletNode} from '../wallet/presentation.js';
import {isRecord, isUuid} from '../data/guards.js';
import {getWalletProviders, isWalletProviderId, WALLET_PROVIDER_IDS, type WalletProviderId} from '../wallet/providers.js';
import {isWalletInstant, validatePersonalEvent, type PersonalEvent} from '../wallet/events.js';
import {CONNECTIONS_VERSION, connectionCallbackPath, type ConnectionProviderView, type ConnectionsSnapshot, type ProviderSync} from './types.js';

type AccountState = 'signed-in' | 'signed-out' | 'unavailable';
type Action = 'connect' | 'sync' | 'disconnect';
const INVALID = 'CONNECTION_RESPONSE_INVALID';
const CATALOG = getWalletProviders();

function keys(value: Record<string, unknown>, expected: readonly string[]): boolean {
  return Object.keys(value).length === expected.length && expected.every(key => Object.hasOwn(value, key));
}

/** This endpoint, rather than profile preferences or callback query text, is authoritative. */
export function parseConnectionsSnapshot(value: unknown): ConnectionsSnapshot {
  if (!isRecord(value) || !keys(value, ['version', 'providers']) || value.version !== CONNECTIONS_VERSION
    || !Array.isArray(value.providers) || value.providers.length !== WALLET_PROVIDER_IDS.length) throw new Error(INVALID);
  const seen = new Set<WalletProviderId>();
  const providers: ConnectionProviderView[] = value.providers.map((entry: unknown) => {
    if (!isRecord(entry) || !keys(entry, ['providerId', 'status', 'connection']) || !isWalletProviderId(entry.providerId)
      || seen.has(entry.providerId) || !['unavailable', 'available', 'connected', 'reconnect-required'].includes(String(entry.status))) throw new Error(INVALID);
    seen.add(entry.providerId);
    const state = entry.status as ConnectionProviderView['status'];
    const connection = entry.connection;
    if (connection === null) {
      if (state === 'connected' || state === 'reconnect-required') throw new Error(INVALID);
      return {providerId: entry.providerId, status: state, connection: null};
    }
    if (!isRecord(connection) || !keys(connection, ['id', 'accountLabel', 'connectedAt', 'lastSyncAt', 'status'])
      || !isUuid(connection.id) || typeof connection.accountLabel !== 'string' || !connection.accountLabel.trim()
      || connection.accountLabel.length > 320 || /[\p{Cc}\p{Cf}]/u.test(connection.accountLabel)
      || !isWalletInstant(connection.connectedAt) || !(connection.lastSyncAt === null || isWalletInstant(connection.lastSyncAt))
      || (connection.status !== 'connected' && connection.status !== 'reconnect-required')
      || state === 'available' || (state !== 'unavailable' && state !== connection.status)) throw new Error(INVALID);
    return {providerId: entry.providerId, status: state, connection: {
      id: connection.id, accountLabel: connection.accountLabel, connectedAt: connection.connectedAt,
      lastSyncAt: connection.lastSyncAt, status: connection.status,
    }};
  });
  return {version: CONNECTIONS_VERSION, providers};
}

export function validateAuthorizationUrl(providerId: WalletProviderId, value: unknown, appOrigin: string): string {
  if (typeof value !== 'string' || value.length > 8_192 || /[\s\\\u0000-\u001f\u007f]/u.test(value)) throw new Error(INVALID);
  const url = new URL(value);
  const destinations: Record<WalletProviderId, readonly [string, RegExp]> = {
    gmail: ['https://accounts.google.com', /^\/o\/oauth2\/v2\/auth$/u],
    outlook: ['https://login.microsoftonline.com', /^\/common\/oauth2\/v2\.0\/authorize$/u],
    instagram: ['https://www.instagram.com', /^\/oauth\/authorize$/u],
    'facebook-pages': ['https://www.facebook.com', /^\/v\d{1,2}\.\d{1,2}\/dialog\/oauth$/u],
  };
  const [origin, path] = destinations[providerId];
  const names = [...url.searchParams.keys()];
  if (url.origin !== origin || !path.test(url.pathname) || url.username || url.password || url.port || url.hash
    || new Set(names).size !== names.length || url.searchParams.get('response_type') !== 'code'
    || !url.searchParams.get('client_id') || !url.searchParams.get('state')) throw new Error(INVALID);
  const callback = new URL(url.searchParams.get('redirect_uri') ?? '');
  if (callback.origin !== appOrigin || callback.username || callback.password || callback.port || callback.hash
    || callback.href !== `${appOrigin}${connectionCallbackPath(providerId)}`) throw new Error(INVALID);
  return url.href;
}

export function parseConnectionSync(value: unknown, provider: ConnectionProviderView, now = new Date().toISOString()): ProviderSync {
  if (!provider.connection || provider.status !== 'connected' || !isRecord(value)
    || !keys(value, ['events', 'state', 'checkedAt']) || !Array.isArray(value.events) || value.events.length > 200
    || (value.state !== 'available' && value.state !== 'partial') || !isWalletInstant(value.checkedAt)
    || !isWalletInstant(now) || Math.abs(Date.parse(now) - Date.parse(value.checkedAt)) > 120_000) throw new Error(INVALID);
  let owner: string | null = null;
  const seen = new Set<string>();
  const events = value.events.map((event: unknown) => {
    if (!isRecord(event) || !isUuid(event.ownerId) || (owner !== null && owner !== event.ownerId)) throw new Error(INVALID);
    owner = event.ownerId;
    const parsed = validatePersonalEvent(event, {ownerId: owner, connectionId: provider.connection!.id,
      providerId: provider.providerId, now});
    if (seen.has(parsed.providerEventId)) throw new Error(INVALID);
    seen.add(parsed.providerEventId);
    return parsed;
  });
  return {events, state: value.state, checkedAt: value.checkedAt};
}

export interface ConnectionsWallet {
  clear(): void;
  setAccount(state: AccountState): void;
}

/** The account module owns lifecycle/session checks; this module alone owns connection and activity DOM. */
export function createConnectionsWallet(onSessionExpired: () => void = () => {}): ConnectionsWallet {
  const element = <T extends HTMLElement>(id: string): T => {
    const found = document.getElementById(id);
    if (!found) throw new Error('CONNECTION_ELEMENT_MISSING');
    return found as T;
  };
  const section = element('wallet-connections');
  const list = element('wallet-providers');
  const notice = element('wallet-connections-status');
  const reload = element<HTMLButtonElement>('wallet-connections-reload');
  const updates = element('wallet-updates');
  const activityState = element('wallet-activity-state');
  const activityCopy = element('wallet-activity-copy');
  let account: AccountState | 'checking' = 'checking';
  let snapshot: ConnectionsSnapshot | null = null;
  let active: AbortController | null = null;
  let epoch = 0;
  let busy = false;
  const fetched = new Map<WalletProviderId, {connectionId: string; result: ProviderSync}>();
  let callbackNotice = '';
  try {
    const url = new URL(window.location.href);
    const result = url.searchParams.get('connection');
    const messages: Record<string, string> = {
      connected: 'Authorization returned. The current saved connection state is shown below.',
      cancelled: 'Authorization was cancelled. Your saved connections are checked below.',
      failed: 'Authorization could not be completed. Check the service and try again.',
      expired: 'The authorization request expired. Start Connect again.',
    };
    callbackNotice = result === null ? '' : messages[result] ?? '';
    if (result !== null) {
      url.searchParams.delete('connection');
      window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
  } catch { /* Callback text never grants connected status. */ }

  function text(tag: string, value: string, className = ''): HTMLElement {
    const node = document.createElement(tag);
    node.textContent = value;
    node.className = className;
    return node;
  }
  function status(value: string, warning = false): void {
    notice.replaceChildren(walletNode('span', value));
    notice.dataset.level = warning ? 'warning' : 'normal';
  }
  function setBusy(value: boolean): void {
    busy = value;
    section.setAttribute('aria-busy', String(value));
    reload.disabled = value || account !== 'signed-in';
    list.querySelectorAll<HTMLButtonElement>('button').forEach(button => {
      button.disabled = value || button.dataset.available !== 'true';
    });
  }
  function renderProviders(): void {
    list.replaceChildren();
    for (const description of CATALOG) {
      const view = snapshot?.providers.find(provider => provider.providerId === description.id);
      const row = text('article', '', 'wallet-provider');
      row.setAttribute('aria-labelledby', `wallet-provider-${description.id}`);
      const main = text('div', '', 'wallet-provider-main');
      const label = text('div', '', 'wallet-provider-label');
      const heading = text('h3', description.name);
      heading.id = `wallet-provider-${description.id}`;
      const state = view?.status === 'connected' ? 'Connected'
        : view?.status === 'reconnect-required' ? 'Authorization needs renewal'
        : view?.status === 'available' ? 'Ready to connect'
        : account === 'signed-out' ? 'Sign in to check availability'
        : account === 'checking' ? 'Checking availability'
        : snapshot ? 'Not enabled for DLKT yet' : 'Availability not confirmed';
      label.append(heading, walletNode('p', state, 'wallet-provider-state'), walletNode('p', description.accountType, 'wallet-provider-type'));
      if (view?.connection) {
        label.append(text('p', view.connection.accountLabel, 'wallet-provider-account'));
        label.append(walletNode('p', view.connection.lastSyncAt
          ? `Last checked: ${new Date(view.connection.lastSyncAt).toLocaleString()}`
          : 'No updates checked yet.', 'wallet-provider-time'));
      }
      const actions = text('div', '', 'wallet-provider-actions');
      const button = (title: string, action: Action | null): void => {
        const node = document.createElement('button');
        node.type = 'button';
        node.className = action === 'connect' ? 'primary' : 'secondary';
        walletCopy(node, title, description.name);
        node.dataset.available = String(action !== null && account === 'signed-in');
        node.dataset.providerId = description.id;
        node.dataset.action = action ?? 'unavailable';
        node.disabled = busy || node.dataset.available !== 'true';
        if (action) node.addEventListener('click', () => { void perform(action, description.id); });
        actions.append(node);
      };
      if (view?.status === 'available') button('Connect', 'connect');
      else if (view?.status === 'connected') button('Check updates', 'sync');
      else if (view?.status === 'reconnect-required') button('Reconnect', 'connect');
      else button('Unavailable', null);
      if (view?.connection) button('Disconnect', 'disconnect');
      main.append(label, actions);
      const details = document.createElement('details');
      details.className = 'wallet-provider-details';
      details.append(walletNode('summary', 'Permissions & limits'));
      for (const capability of description.capabilities) details.append(walletNode('p', capability));
      for (const limit of description.limitations) {
        // Legacy catalog availability is not evidence of the current server configuration.
        if (limit.startsWith('Connection is not available') || limit.startsWith('Google must approve')) continue;
        details.append(walletNode('p', limit));
      }
      row.append(main, details);
      list.append(row);
    }
  }
  function renderUpdates(): void {
    updates.replaceChildren();
    const results = [...fetched.values()];
    const events: PersonalEvent[] = results.flatMap(entry => [...entry.result.events])
      .sort((a, b) => b.occurredAt.localeCompare(a.occurredAt));
    if (results.length === 0) {
      walletCopy(activityState, snapshot?.providers.some(provider => provider.connection) ? 'Ready when you are' : 'No personal updates loaded');
      walletCopy(activityCopy, account === 'signed-in'
        ? 'Connect an available account, then choose Check updates. This page does not run automatic or background synchronization.'
        : 'Sign in to check your connections. Personal updates stay private and are cleared when you leave this page.');
      return;
    }
    const partial = results.some(entry => entry.result.state === 'partial');
    walletCopy(activityState, partial ? 'Some updates could not be retrieved' : `${events.length} updates retrieved`);
    walletCopy(activityCopy, partial
      ? 'These are the updates the service returned. This is not a complete activity history. Try Check updates again.'
      : events.length === 0 ? 'The latest check returned no updates within the supported window. This does not mean the account has no activity.'
        : 'Only activity returned by your authorized services is shown. Open an item to read it at the source.');
    for (const event of events) {
      const item = text('li', '', 'wallet-update');
      const link = document.createElement('a');
      link.textContent = event.title;
      link.href = event.sourceUrl;
      link.target = '_blank';
      link.rel = 'noopener noreferrer';
      const provider = CATALOG.find(entry => entry.id === event.providerId)?.name ?? event.providerId;
      const actor = event.actor?.displayName ?? event.actor?.providerActorId ?? '';
      item.append(link, text('p', `${provider} · ${new Date(event.occurredAt).toLocaleString()}${actor ? ` · ${actor}` : ''}`, 'wallet-update-meta'));
      if (event.actor?.provenance === 'sender-header') item.append(walletNode('p', 'Sender as reported in the email header.', 'wallet-update-meta'));
      if (event.excerpt) item.append(text('p', event.excerpt));
      if (event.metrics.length) item.append(text('p', event.metrics.map(metric => `${metric.count} ${metric.name}`).join(' · ')));
      updates.append(item);
    }
  }
  function applySnapshot(value: ConnectionsSnapshot): void {
    snapshot = value;
    for (const [id, entry] of fetched) {
      const provider = value.providers.find(item => item.providerId === id);
      if (provider?.status !== 'connected' || provider.connection?.id !== entry.connectionId) fetched.delete(id);
    }
    renderProviders();
    renderUpdates();
  }
  async function request(method: 'GET' | 'POST', signal: AbortSignal, body?: unknown): Promise<unknown> {
    const response = await fetch('/api/connections', {method, credentials: 'same-origin', cache: 'no-store', redirect: 'error',
      headers: {Accept: 'application/json', 'Content-Type': 'application/json', 'X-DLKT-Info-Request': 'connections-v1'},
      signal, ...(body === undefined ? {} : {body: JSON.stringify(body)})});
    if (!response.ok) throw new Error(response.status === 401 ? 'CONNECTION_SIGN_IN_REQUIRED' : 'CONNECTION_REQUEST_FAILED');
    const value: unknown = await response.json();
    if (signal.aborted) throw new Error('CONNECTION_REQUEST_ABORTED');
    return value;
  }
  function current(token: number, controller: AbortController): boolean {
    return token === epoch && active === controller && !controller.signal.aborted
      && account === 'signed-in' && !document.hidden && document.hasFocus();
  }
  function clear(): void {
    epoch += 1;
    active?.abort();
    active = null;
    account = 'checking';
    snapshot = null;
    fetched.clear();
    setBusy(false);
    status('Checking connection availability…');
    renderProviders();
    renderUpdates();
  }
  async function perform(action?: Action, providerId?: WalletProviderId): Promise<void> {
    if (busy || account !== 'signed-in' || document.hidden || !document.hasFocus()) return;
    const prior = providerId ? snapshot?.providers.find(provider => provider.providerId === providerId) : null;
    if (action && (!prior || (action === 'connect' && !['available', 'reconnect-required'].includes(prior.status))
      || (action === 'sync' && prior.status !== 'connected') || (action === 'disconnect' && !prior.connection))) return;
    const initiating = document.activeElement;
    let restoreFocus = initiating === reload || [...list.querySelectorAll<HTMLButtonElement>('button')].some(button => button === initiating);
    const focusMoved = (): void => { restoreFocus = false; };
    const controller = new AbortController();
    active = controller;
    const token = ++epoch;
    const timer = window.setTimeout(() => controller.abort(), 30_000);
    if (providerId && action !== 'connect') fetched.delete(providerId);
    renderUpdates();
    setBusy(true);
    document.addEventListener('focusin', focusMoved);
    document.addEventListener('pointerdown', focusMoved);
    status(action === 'connect' ? 'Opening secure authorization…' : action === 'sync' ? 'Checking updates with the service…'
      : action === 'disconnect' ? 'Disconnecting this account…' : 'Checking saved connections…');
    try {
      let sync: ProviderSync | null = null;
      let manualRevocation = false;
      if (action && providerId && prior) {
        const result = await request('POST', controller.signal, {action, providerId});
        if (!current(token, controller)) return;
        if (action === 'connect') {
          if (!isRecord(result) || !keys(result, ['authorizationUrl'])) throw new Error(INVALID);
          const destination = validateAuthorizationUrl(providerId, result.authorizationUrl, window.location.origin);
          window.location.assign(destination);
          return;
        }
        if (action === 'sync') sync = parseConnectionSync(result, prior);
        else if (isRecord(result) && keys(result, ['disconnected', 'revocation']) && result.disconnected === true
          && (result.revocation === 'revoked' || result.revocation === 'manual-required')) manualRevocation = result.revocation === 'manual-required';
        else parseConnectionsSnapshot(result);
      }
      const next = parseConnectionsSnapshot(await request('GET', controller.signal));
      if (!current(token, controller)) return;
      const nextProvider = next.providers.find(provider => provider.providerId === providerId);
      if (action === 'disconnect' && nextProvider?.connection !== null) throw new Error('CONNECTION_CHANGE_UNCONFIRMED');
      if (sync && providerId && prior?.connection) {
        if (nextProvider?.status !== 'connected' || nextProvider.connection?.id !== prior.connection.id) throw new Error('CONNECTION_CHANGE_UNCONFIRMED');
        const owner = sync.events[0]?.ownerId;
        if (owner && [...fetched.values()].some(entry => entry.result.events.some(event => event.ownerId !== owner))) throw new Error(INVALID);
        fetched.set(providerId, {connectionId: prior.connection.id, result: sync});
      }
      applySnapshot(next);
      const message = action === 'disconnect'
        ? manualRevocation ? 'Disconnected from DLKT. Also remove DLKT access in the service account settings to revoke its authorization.' : 'This account is disconnected from DLKT.'
        : action === 'sync' ? 'Latest check completed. Results are shown below.'
          : callbackNotice || (next.providers.some(provider => provider.status === 'available')
            ? 'Choose Connect to authorize an available service. Each account needs your permission.'
            : next.providers.some(provider => provider.connection) ? 'Your saved connections are shown below. Updates are checked only when you request them.'
              : 'These services are not enabled for DLKT yet. Your DLKT profile is ready; no external account has been connected.');
      status(message, manualRevocation || sync?.state === 'partial');
      callbackNotice = '';
      if (restoreFocus) {
        const nextAction = action === 'disconnect' ? 'connect' : action;
        const nextButton = [...list.querySelectorAll<HTMLButtonElement>('button')].find(button => button.dataset.providerId === providerId && button.dataset.action === nextAction);
        setBusy(false);
        (nextButton ?? reload).focus();
      }
    } catch (error) {
      if (token !== epoch || active !== controller || account !== 'signed-in') return;
      snapshot = null;
      fetched.clear();
      renderProviders();
      renderUpdates();
      const signInRequired = error instanceof Error && error.message === 'CONNECTION_SIGN_IN_REQUIRED';
      if (signInRequired) {
        onSessionExpired();
        account = 'signed-out';
        renderProviders();
        renderUpdates();
        setBusy(false);
      }
      status(signInRequired ? 'Your session ended. Sign in to DLKT again to check these accounts.'
        : 'The connection state or change could not be confirmed. Choose Retry connections before trying again.', true);
      if (signInRequired) {
        const link = document.createElement('a');
        link.href = '/account?returnTo=wallet';
        link.className = 'text-button';
        walletCopy(link, 'Sign in to DLKT');
        notice.append(link);
        if (restoreFocus) link.focus();
      } else if (restoreFocus) {
        setBusy(false);
        reload.focus();
      }
    } finally {
      window.clearTimeout(timer);
      document.removeEventListener('focusin', focusMoved);
      document.removeEventListener('pointerdown', focusMoved);
      if (token === epoch && active === controller) { active = null; setBusy(false); }
    }
  }
  reload.addEventListener('click', () => { void perform(); });
  clear();
  return {
    clear,
    setAccount(state): void {
      clear();
      account = state;
      if (state === 'signed-in') { void perform(); return; }
      snapshot = null;
      fetched.clear();
      setBusy(false);
      renderProviders();
      renderUpdates();
      status(state === 'signed-out' ? 'Sign in to DLKT above to check which accounts you can connect.'
        : 'Account connections are not available in this environment.');
    },
  };
}
