import { parseWalletSnapshot } from './wallet-contracts.js';
import { parseConnectionsSnapshot, parseConnectionSync } from './connections-browser.js';
import { getWalletProviders } from './wallet-providers.js';
export class PersonalInboxError extends Error {
    reason;
    constructor(reason) {
        super(`PERSONAL_INBOX_${reason.toUpperCase()}`);
        this.reason = reason;
        this.name = 'PersonalInboxError';
    }
}
const PROVIDERS = getWalletProviders();
export function personalInboxProviderName(providerId) {
    return PROVIDERS.find(provider => provider.id === providerId)?.name ?? providerId;
}
function assertActive(signal) {
    if (signal.aborted)
        throw new PersonalInboxError('unavailable');
}
/** Only the authenticated same-origin adapter is called; no provider credentials enter this module. */
async function request(fetcher, signal, path, providerId) {
    assertActive(signal);
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(abort, 8_000);
    let rejectAborted;
    const interrupted = new Promise((_resolve, reject) => {
        rejectAborted = () => reject(new PersonalInboxError('unavailable'));
        controller.signal.addEventListener('abort', rejectAborted, { once: true });
    });
    try {
        const operation = (async () => {
            const response = await fetcher(path, {
                method: providerId === undefined ? 'GET' : 'POST', credentials: 'same-origin',
                cache: 'no-store', redirect: 'error', signal: controller.signal,
                headers: { Accept: 'application/json', 'X-DLKT-Info-Request': path === '/api/wallet' ? 'wallet-v1' : 'connections-v1',
                    ...(providerId === undefined ? {} : { 'Content-Type': 'application/json' }) },
                ...(providerId === undefined ? {} : { body: JSON.stringify({ action: 'sync', providerId }) }),
            });
            assertActive(controller.signal);
            if (response.status === 401)
                throw new PersonalInboxError('signed-out');
            if (!response.ok)
                throw new PersonalInboxError('unavailable');
            const value = await response.json();
            assertActive(controller.signal);
            return value;
        })();
        return await Promise.race([operation, interrupted]);
    }
    finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        if (rejectAborted)
            controller.signal.removeEventListener('abort', rejectAborted);
    }
}
function counts(snapshot) {
    return {
        connected: snapshot.providers.filter(provider => provider.status === 'connected' && provider.connection?.status === 'connected').length,
        available: snapshot.providers.filter(provider => provider.status === 'available').length,
        reconnect: snapshot.providers.filter(provider => provider.status === 'reconnect-required').length,
    };
}
/** One foreground check: at most four authorized read-only syncs, then a connection readback.
 * Connection UUIDs bind authenticated results to this check; account labels never identify an owner.
 * Only five latest returned metadata events are retained, without a complete-history claim.
 */
export async function loadPersonalInbox(fetcher, signal, clock = Date.now) {
    const wallet = parseWalletSnapshot(await request(fetcher, signal, '/api/wallet'));
    assertActive(signal);
    const base = { account: wallet.account, profileSaved: wallet.profile !== null,
        connected: 0, available: 0, reconnect: 0, events: [], state: 'idle', failedProviders: 0, checkedAt: null };
    if (wallet.account !== 'signed-in')
        return base;
    const snapshot = parseConnectionsSnapshot(await request(fetcher, signal, '/api/connections'));
    assertActive(signal);
    const eligible = snapshot.providers.filter(provider => provider.status === 'connected' && provider.connection?.status === 'connected').slice(0, 4);
    if (eligible.length === 0)
        return { ...base, ...counts(snapshot) };
    const results = await Promise.all(eligible.map(async (provider) => {
        let value;
        try {
            value = await request(fetcher, signal, '/api/connections', provider.providerId);
        }
        catch (error) {
            assertActive(signal);
            if (error instanceof PersonalInboxError && error.reason === 'signed-out')
                throw error;
            return null;
        }
        try {
            const result = parseConnectionSync(value, provider, new Date(clock()).toISOString());
            // Existing scopes cover email metadata and professional-post comments only.
            if (result.events.some(event => event.kind !== (provider.providerId === 'gmail' || provider.providerId === 'outlook' ? 'email.received' : 'comment.received')))
                throw new Error('SCOPE');
            return result;
        }
        catch {
            throw new PersonalInboxError('invalid');
        }
    }));
    assertActive(signal);
    const owners = new Set(results.flatMap(result => result?.events.map(event => event.ownerId) ?? []));
    if (owners.size > 1)
        throw new PersonalInboxError('invalid');
    const current = parseConnectionsSnapshot(await request(fetcher, signal, '/api/connections'));
    assertActive(signal);
    for (const provider of eligible) {
        const confirmed = current.providers.find(item => item.providerId === provider.providerId);
        if (confirmed?.status !== 'connected' || confirmed.connection?.status !== 'connected'
            || confirmed.connection.id !== provider.connection?.id)
            throw new PersonalInboxError('changed');
    }
    const events = results.flatMap(result => result?.events ?? [])
        .sort((a, b) => Date.parse(b.occurredAt) - Date.parse(a.occurredAt)
        || a.providerId.localeCompare(b.providerId) || a.providerEventId.localeCompare(b.providerEventId)).slice(0, 5);
    return { ...base, ...counts(current), events,
        state: results.some(result => result === null || result.state === 'partial') ? 'partial' : 'ready',
        failedProviders: results.filter(result => result === null).length,
        checkedAt: new Date(clock()).toISOString() };
}
export function personalInboxStatus(value) {
    if (value.account === 'unavailable')
        return 'Private profiles and email or social connections are not activated yet. Explore your Info Wallet.';
    if (value.account === 'signed-out')
        return 'Sign in through Info Wallet to check your private updates.';
    if (value.connected > 0) {
        if (value.state === 'partial')
            return value.events.length > 0
                ? 'Latest returned private updates. Some updates could not be checked. Open Info Wallet for connection details.'
                : 'Your connected accounts could not be checked completely. Open Info Wallet or try again.';
        const prefix = value.events.length > 0 ? 'Latest private updates from your connected accounts.' : 'No recent updates were returned by your connected accounts.';
        return `${prefix} Checked while this page is open; this is not your complete account history.`;
    }
    if (value.reconnect > 0)
        return 'Your connection needs authorization again. Open Info Wallet to reconnect.';
    if (value.available > 0)
        return 'Connect an available account in Info Wallet to see its private updates here.';
    return value.profileSaved
        ? 'Your private profile is saved. Open Info Wallet to review your preferences and personal selection. Email and social connections are currently unavailable.'
        : 'Create your private profile in Info Wallet. Email and social connections are currently unavailable.';
}
