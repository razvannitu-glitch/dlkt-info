/** Server-only provider drivers. See task-local provider-sources.md for verified contracts.
 * Only token lifecycle operations mutate provider grants. Activity calls are GET-only.
 */
import {isUuid} from '../data/guards.js';
import {GmailMetadataAdapter, GMAIL_METADATA_SCOPE} from '../wallet/gmail.js';
import {isPersonalSourceUrl, isWalletMailbox, validatePersonalEvent} from '../wallet/events.js';
import type {PersonalActor, PersonalEvent} from '../wallet/events.js';
import {isWalletProviderId} from '../wallet/providers.js';
import type {WalletProviderId} from '../wallet/providers.js';
import {connectionCallbackPath, type ProviderConfiguration, type ProviderDependencies, type ProviderGrant, type ProviderResource, type ProviderSync} from './types.js';
import {ProviderError, ProviderHttp, fail, instant, numericId, plain, record, secret} from './provider-http.js';
export {ProviderError} from './provider-http.js';

const DAY = 86_400_000;
const SCOPES: Readonly<Record<WalletProviderId, readonly string[]>> = Object.freeze({
  gmail: Object.freeze(['openid', 'email', GMAIL_METADATA_SCOPE]),
  outlook: Object.freeze(['offline_access', 'User.Read', 'Mail.ReadBasic']),
  instagram: Object.freeze(['instagram_business_basic', 'instagram_business_manage_comments']),
  'facebook-pages': Object.freeze(['pages_show_list', 'pages_read_engagement', 'pages_read_user_content'])
});
function configure(config: ProviderConfiguration): void {
  if (typeof window !== 'undefined' || !isWalletProviderId(config.providerId)) fail('configuration');
  try {
    secret(config.clientId); secret(config.clientSecret);
    const redirect = new URL(config.redirectUri);
    if (redirect.protocol !== 'https:' || redirect.username || redirect.password || redirect.port || redirect.hash || redirect.href !== `${redirect.origin}${connectionCallbackPath(config.providerId)}` || redirect.href !== config.redirectUri) fail('configuration');
    if (['instagram', 'facebook-pages'].includes(config.providerId) && (typeof config.graphVersion !== 'string' || !/^v\d{1,2}\.\d{1,2}$/u.test(config.graphVersion))) fail('configuration');
  } catch { fail('configuration'); }
}
function graph(config: ProviderConfiguration, node: string, params: Record<string, string> = {}): URL {
  const host = config.providerId === 'instagram' ? 'graph.instagram.com' : 'graph.facebook.com';
  const url = new URL(`https://${host}/${config.graphVersion}/${node}`);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}
function urlWith(base: string, params: Record<string, string>): URL {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return url;
}
function scopes(value: unknown): readonly string[] {
  if (typeof value !== 'string' || value.length > 4096) fail('scope-denied');
  const result = value.split(/[ ,]+/u).filter(Boolean);
  if (result.length > 32) fail('scope-denied');
  return Object.freeze([...new Set(result)]);
}
function requireScopes(providerId: WalletProviderId, granted: readonly string[]): void {
  const normalized = granted.map(item => item.replace(/^https:\/\/graph\.microsoft\.com\//u, '').toLowerCase());
  const required = SCOPES[providerId].filter(item => !['offline_access', 'openid', 'email'].includes(item));
  if (required.some(item => !normalized.includes(item.toLowerCase()))) fail('scope-denied');
}
function expires(value: unknown, now: string): string {
  if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 1 || value > 100 * 86_400) fail();
  return new Date(Date.parse(now) + value * 1000).toISOString();
}
function grantToken(body: unknown, now: string): {accessToken: string; expiresAt: string} {
  const value = record(body);
  if (value.token_type !== undefined && String(value.token_type).toLowerCase() !== 'bearer') fail();
  return {accessToken: secret(value.access_token), expiresAt: expires(value.expires_in, now)};
}
function freezeGrant(value: ProviderGrant): ProviderGrant {
  return Object.freeze({...value, scopes: Object.freeze([...value.scopes]), resources: Object.freeze(value.resources.map(resource => Object.freeze({...resource})))});
}
function checkGrant(config: ProviderConfiguration, grant: ProviderGrant): void {
  configure(config); secret(grant.accessToken); plain(grant.accountId); plain(grant.accountLabel);
  if (!Number.isFinite(Date.parse(grant.expiresAt)) || grant.resources.length > 20) fail();
  if (grant.refreshToken !== null) secret(grant.refreshToken);
  requireScopes(config.providerId, grant.scopes);
  if (config.providerId === 'gmail' && !isWalletMailbox(grant.accountLabel)) fail();
  if (['instagram', 'facebook-pages'].includes(config.providerId)) numericId(grant.accountId);
}

export function authorizationUrl(config: ProviderConfiguration, state: string, codeChallenge: string): string {
  configure(config);
  if (!/^[A-Za-z0-9_-]{32,256}$/u.test(state) || !/^[A-Za-z0-9_-]{43}$/u.test(codeChallenge)) fail('configuration');
  const parameters: Record<string, string> = {client_id: config.clientId, redirect_uri: config.redirectUri, response_type: 'code', state, scope: SCOPES[config.providerId].join(config.providerId === 'gmail' || config.providerId === 'outlook' ? ' ' : ',')};
  if (config.providerId === 'gmail' || config.providerId === 'outlook') {
    parameters.code_challenge = codeChallenge; parameters.code_challenge_method = 'S256';
  }
  if (config.providerId === 'gmail') {
    parameters.access_type = 'offline'; parameters.prompt = 'consent select_account';
    return urlWith('https://accounts.google.com/o/oauth2/v2/auth', parameters).href;
  }
  if (config.providerId === 'outlook') {
    parameters.response_mode = 'query'; parameters.prompt = 'select_account';
    return urlWith('https://login.microsoftonline.com/common/oauth2/v2.0/authorize', parameters).href;
  }
  if (config.providerId === 'instagram') {
    parameters.enable_fb_login = 'false';
    return urlWith('https://www.instagram.com/oauth/authorize', parameters).href;
  }
  return urlWith(`https://www.facebook.com/${config.graphVersion}/dialog/oauth`, parameters).href;
}

async function googleIdentity(http: ProviderHttp, token: string): Promise<{accountId: string; accountLabel: string}> {
  const identity = record(await http.request(new URL('https://openidconnect.googleapis.com/v1/userinfo'), {token}));
  if (!isWalletMailbox(identity.email) || identity.email_verified !== true) fail('authorization');
  return {accountId: plain(identity.sub), accountLabel: identity.email.toLowerCase()};
}
async function microsoftIdentity(http: ProviderHttp, token: string): Promise<{accountId: string; accountLabel: string}> {
  const identity = record(await http.request(urlWith('https://graph.microsoft.com/v1.0/me', {$select: 'id,displayName,mail,userPrincipalName'}), {token}));
  const label = isWalletMailbox(identity.mail) ? identity.mail : isWalletMailbox(identity.userPrincipalName) ? identity.userPrincipalName : plain(identity.displayName, 160);
  return {accountId: plain(identity.id), accountLabel: label};
}
async function instagramIdentity(config: ProviderConfiguration, http: ProviderHttp, token: string): Promise<{accountId: string; accountLabel: string; appScopedId: string}> {
  const response = record(await http.request(graph(config, 'me', {fields: 'id,user_id,username,account_type'}), {token}));
  const identity = response.data !== undefined ? record(dataArray(response, 1).items[0]) : response;
  if (typeof identity.account_type !== 'string' || !['business', 'media_creator'].includes(identity.account_type.toLowerCase())) fail('authorization');
  // Instagram distinguishes the app-scoped id used during code exchange from
  // the professional user_id used for /{IG_ID}/media. Never conflate them.
  return {accountId: numericId(identity.user_id), appScopedId: numericId(identity.id), accountLabel: plain(identity.username, 160)};
}
function dataArray(value: unknown, maximum: number): {items: unknown[]; more: boolean} {
  const body = record(value);
  if (!Array.isArray(body.data) || body.data.length > maximum) fail();
  const more = body.paging !== undefined && record(body.paging).next !== undefined;
  return {items: body.data as unknown[], more};
}
async function facebookIdentity(config: ProviderConfiguration, http: ProviderHttp, token: string): Promise<{accountId: string; accountLabel: string; scopes: readonly string[]; resources: readonly ProviderResource[]}> {
  const identity = record(await http.request(graph(config, 'me', {fields: 'id,name'}), {token}));
  const accountId = numericId(identity.id);
  const permissions = dataArray(await http.request(graph(config, `${accountId}/permissions`), {token}), 32);
  const granted: string[] = [];
  for (const item of permissions.items) { const p = record(item); if (p.status === 'granted') granted.push(plain(p.permission)); }
  requireScopes('facebook-pages', granted);
  const pages = dataArray(await http.request(graph(config, `${accountId}/accounts`, {fields: 'id,name,access_token', limit: '20'}), {token}), 20);
  // Never silently lose managed Pages at the grant boundary. A selection UI is
  // needed before supporting accounts with more than this bounded collection.
  if (pages.more) fail('configuration');
  const seen = new Set<string>();
  const resources = pages.items.map(item => {
    const page = record(item), id = numericId(page.id);
    if (seen.has(id)) fail(); seen.add(id);
    return {id, label: plain(page.name, 160), accessToken: secret(page.access_token)};
  });
  if (!resources.length) fail('scope-denied');
  return {accountId, accountLabel: plain(identity.name, 160), scopes: granted, resources};
}

export async function exchangeCode(config: ProviderConfiguration, code: string, codeVerifier: string, deps: ProviderDependencies = {}): Promise<ProviderGrant> {
  configure(config);
  if (typeof code !== 'string' || code.length < 1 || code.length > 4096 || /[\u0000-\u0020\u007f]/u.test(code) || !/^[A-Za-z0-9._~-]{43,128}$/u.test(codeVerifier)) fail('configuration');
  const now = instant(deps.now), http = new ProviderHttp(deps);
  try {
    if (config.providerId === 'gmail' || config.providerId === 'outlook') {
      const endpoint = config.providerId === 'gmail' ? 'https://oauth2.googleapis.com/token' : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
      const body = record(await http.request(new URL(endpoint), {method: 'POST', form: new URLSearchParams({client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code', redirect_uri: config.redirectUri, code, code_verifier: codeVerifier})}));
      const granted = scopes(body.scope); requireScopes(config.providerId, granted);
      const token = grantToken(body, now);
      if (typeof body.refresh_token !== 'string') fail('reauthorization-required');
      const identity = config.providerId === 'gmail' ? await googleIdentity(http, token.accessToken) : await microsoftIdentity(http, token.accessToken);
      return freezeGrant({...identity, ...token, refreshToken: secret(body.refresh_token), scopes: granted, resources: []});
    }
    if (config.providerId === 'instagram') {
      const response = record(await http.request(new URL('https://api.instagram.com/oauth/access_token'), {method: 'POST', form: new URLSearchParams({client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'authorization_code', redirect_uri: config.redirectUri, code})}));
      const body = response.data !== undefined ? record(dataArray(response, 1).items[0]) : response;
      const granted = scopes(body.permissions); requireScopes('instagram', granted);
      const expectedId = numericId(body.user_id), shortToken = secret(body.access_token);
      // Meta documents GET with these sensitive query parameters. This URL is
      // kept inside the server transport and is never logged, returned or saved.
      const token = grantToken(await http.request(urlWith('https://graph.instagram.com/access_token', {grant_type: 'ig_exchange_token', client_secret: config.clientSecret, access_token: shortToken})), now);
      const identity = await instagramIdentity(config, http, token.accessToken);
      if (identity.appScopedId !== expectedId) fail('authorization');
      return freezeGrant({accountId: identity.accountId, accountLabel: identity.accountLabel, ...token, refreshToken: null, scopes: granted, resources: []});
    }
    const short = record(await http.request(graph(config, 'oauth/access_token', {client_id: config.clientId, client_secret: config.clientSecret, redirect_uri: config.redirectUri, code})));
    const token = grantToken(await http.request(graph(config, 'oauth/access_token', {grant_type: 'fb_exchange_token', client_id: config.clientId, client_secret: config.clientSecret, fb_exchange_token: secret(short.access_token)})), now);
    const identity = await facebookIdentity(config, http, token.accessToken);
    return freezeGrant({...identity, ...token, refreshToken: null});
  } finally { http.close(); }
}

export async function refreshGrant(config: ProviderConfiguration, grant: ProviderGrant, deps: ProviderDependencies = {}): Promise<ProviderGrant> {
  checkGrant(config, grant);
  const now = instant(deps.now);
  // Meta web tokens are not OAuth refresh tokens. Never pretend an expired
  // Facebook grant was refreshed; its user must authorize again.
  if (config.providerId === 'facebook-pages') {
    if (Date.parse(grant.expiresAt) <= Date.parse(now) + 60_000) fail('reauthorization-required');
    return freezeGrant(grant);
  }
  const http = new ProviderHttp(deps);
  try {
    if (config.providerId === 'instagram') {
      if (Date.parse(grant.expiresAt) <= Date.parse(now)) fail('reauthorization-required');
      // Long-lived tokens may only be refreshed after 24h. Refresh near expiry,
      // never immediately after issuance; the 7-day threshold stays below 60d.
      if (Date.parse(grant.expiresAt) - Date.parse(now) > 7 * DAY) return freezeGrant(grant);
      const token = grantToken(await http.request(urlWith('https://graph.instagram.com/refresh_access_token', {grant_type: 'ig_refresh_token', access_token: grant.accessToken})), now);
      const identity = await instagramIdentity(config, http, token.accessToken);
      if (identity.accountId !== grant.accountId) fail('authorization');
      return freezeGrant({...grant, ...token, accountLabel: identity.accountLabel});
    }
    if (!grant.refreshToken) fail('reauthorization-required');
    const endpoint = config.providerId === 'gmail' ? 'https://oauth2.googleapis.com/token' : 'https://login.microsoftonline.com/common/oauth2/v2.0/token';
    const body = record(await http.request(new URL(endpoint), {method: 'POST', form: new URLSearchParams({client_id: config.clientId, client_secret: config.clientSecret, grant_type: 'refresh_token', refresh_token: grant.refreshToken})}));
    const token = grantToken(body, now), granted = body.scope === undefined ? grant.scopes : scopes(body.scope);
    requireScopes(config.providerId, granted);
    const identity = config.providerId === 'gmail' ? await googleIdentity(http, token.accessToken) : await microsoftIdentity(http, token.accessToken);
    if (identity.accountId !== grant.accountId) fail('authorization');
    return freezeGrant({...grant, ...token, accountLabel: identity.accountLabel, scopes: granted, refreshToken: body.refresh_token === undefined ? grant.refreshToken : secret(body.refresh_token)});
  } finally { http.close(); }
}

export async function revokeGrant(config: ProviderConfiguration, grant: ProviderGrant, deps: ProviderDependencies = {}): Promise<'revoked' | 'manual-required'> {
  checkGrant(config, grant);
  // Do not request directory-wide permissions or invent an Instagram endpoint.
  // The caller removes local credentials and tells the user manual revocation
  // is still required when the provider cannot acknowledge it here.
  if (config.providerId === 'outlook' || config.providerId === 'instagram') return 'manual-required';
  const http = new ProviderHttp(deps);
  try {
    if (config.providerId === 'gmail') {
      await http.request(new URL('https://oauth2.googleapis.com/revoke'), {method: 'POST', form: new URLSearchParams({token: grant.refreshToken ?? grant.accessToken}), empty: true});
    } else {
      const result = record(await http.request(graph(config, `${numericId(grant.accountId)}/permissions`), {method: 'DELETE', token: grant.accessToken}));
      if (result.success !== true) fail();
    }
    return 'revoked';
  } catch { return 'manual-required'; } finally { http.close(); }
}

interface Context {readonly ownerId: string; readonly connectionId: string}
function text(value: unknown, max: number, fallback: string): string {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string') fail();
  return plain(value.replace(/[\r\n\t]+/gu, ' '), 16_384).slice(0, max) || fallback;
}
function eventTime(value: unknown, now: string): string | null {
  const date = Date.parse(plain(value, 64)), observed = Date.parse(now);
  if (!Number.isFinite(date) || date > observed + 60_000) fail();
  return date < observed - DAY ? null : new Date(date).toISOString();
}
function actor(value: unknown, providerId: WalletProviderId): PersonalActor | null {
  if (value === undefined || value === null) return null;
  const person = record(value);
  if (providerId === 'outlook') {
    const address = record(person.emailAddress);
    if (!isWalletMailbox(address.address)) return null;
    return {providerId, providerActorId: `email:${address.address.toLowerCase()}`, displayName: address.name ? text(address.name, 160, '') : null, provenance: 'sender-header'};
  }
  if (person.id === undefined) return null;
  return {providerId, providerActorId: numericId(person.id), displayName: person.name || person.username ? text(person.name ?? person.username, 160, '') : null, provenance: 'provider-identity'};
}
function makeEvent(context: Context, providerId: WalletProviderId, now: string, fields: Pick<PersonalEvent, 'providerEventId' | 'providerThreadId' | 'kind' | 'occurredAt' | 'actor' | 'title' | 'sourceUrl' | 'sourceUrlOrigin' | 'unread' | 'importance'>): PersonalEvent {
  try { return validatePersonalEvent({...context, providerId, observedAt: now, ...fields, excerpt: null, metrics: [], visibility: 'private'}, {...context, providerId, now}); } catch { return fail(); }
}
function recoverable(error: unknown, collected: number): boolean {
  if (!(error instanceof ProviderError) || ['authorization', 'scope-denied', 'configuration', 'reauthorization-required'].includes(error.code) || collected === 0) return false;
  return true;
}
async function syncOutlook(config: ProviderConfiguration, grant: ProviderGrant, context: Context, deps: ProviderDependencies): Promise<ProviderSync> {
  const now = instant(deps.now), http = new ProviderHttp(deps), events: PersonalEvent[] = [], seen = new Set<string>();
  const initial = urlWith('https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages', {$select: 'id,conversationId,subject,from,receivedDateTime,isRead,importance,webLink', $top: '25', $filter: `receivedDateTime ge ${new Date(Date.parse(now) - DAY).toISOString()}`, $orderby: 'receivedDateTime desc'});
  let current: URL | null = initial, partial = false;
  const visited = new Set<string>();
  try {
    for (let page = 0; page < 2 && current; page += 1) {
      if (visited.has(current.href)) fail(); visited.add(current.href);
      const body = record(await http.request(current, {token: grant.accessToken}));
      if (!Array.isArray(body.value) || body.value.length > 25) fail();
      for (const raw of body.value) {
        const item = record(raw), id = plain(item.id), occurredAt = eventTime(item.receivedDateTime, now);
        if (!occurredAt || seen.has(id)) continue;
        seen.add(id);
        if (typeof item.isRead !== 'boolean' || !isPersonalSourceUrl('outlook', item.webLink)) { partial = true; continue; }
        events.push(makeEvent(context, 'outlook', now, {providerEventId: id, providerThreadId: typeof item.conversationId === 'string' ? plain(item.conversationId) : null, kind: 'email.received', occurredAt, actor: actor(item.from, 'outlook'), title: text(item.subject, 240, 'Message without a subject'), sourceUrl: item.webLink, sourceUrlOrigin: 'provider-supplied', unread: !item.isRead, importance: item.importance === 'high' ? 'source-important' : 'normal'}));
      }
      const next: unknown = body['@odata.nextLink'];
      current = null;
      if (next !== undefined) {
        const candidate = new URL(plain(next, 4096));
        if (candidate.origin !== initial.origin || candidate.pathname !== initial.pathname || candidate.username || candidate.password || candidate.hash || candidate.port || candidate.href.includes(grant.accessToken)) fail();
        const permitted = ['$select', '$top', '$filter', '$orderby', '$skip', '$skiptoken'];
        if ([...candidate.searchParams.keys()].some(key => !permitted.includes(key)) || [...candidate.searchParams.keys()].length !== new Set(candidate.searchParams.keys()).size) fail();
        for (const key of ['$select', '$top', '$filter', '$orderby']) if (candidate.searchParams.get(key) !== initial.searchParams.get(key)) fail();
        current = candidate;
      }
    }
    if (current) partial = true;
  } catch (error: unknown) { if (!(error instanceof ProviderError)) fail(); if (!recoverable(error, events.length)) throw error; partial = true; } finally { http.close(); }
  return Object.freeze({events: Object.freeze(events), state: partial ? 'partial' : 'available', checkedAt: now});
}

async function syncSocial(config: ProviderConfiguration, grant: ProviderGrant, context: Context, deps: ProviderDependencies): Promise<ProviderSync> {
  const now = instant(deps.now), http = new ProviderHttp(deps), events: PersonalEvent[] = [], seen = new Set<string>();
  // Deliberately bounded snapshot of top-level comments, not a complete personal
  // activity feed: replies, DMs, mentions, named viewers/sharers are not fetched.
  // Thus social scans always remain explicitly partial, including empty scans.
  const resources: readonly ProviderResource[] = config.providerId === 'instagram' ? [{id: grant.accountId, label: grant.accountLabel, accessToken: grant.accessToken}] : grant.resources.slice(0, 5);
  try {
    for (const resource of resources) {
      const resourceId = numericId(resource.id), token = secret(resource.accessToken);
      const instagram = config.providerId === 'instagram';
      const posts = dataArray(await http.request(graph(config, `${resourceId}/${instagram ? 'media' : 'posts'}`, {fields: instagram ? 'id,permalink' : 'id,permalink_url', limit: '5'}), {token}), 5);
      for (const raw of posts.items) {
        const post = record(raw), postId = plain(post.id, 129);
        if (instagram ? !/^\d{1,64}$/u.test(postId) : !new RegExp(`^${resourceId}_\\d{1,64}$`, 'u').test(postId)) fail();
        const link = instagram ? post.permalink : post.permalink_url;
        if (!isPersonalSourceUrl(config.providerId, link)) continue;
        const comments = dataArray(await http.request(graph(config, `${postId}/comments`, {fields: instagram ? 'id,text,timestamp,from' : 'id,message,created_time,from', limit: '20'}), {token}), 20);
        for (const rawComment of comments.items) {
          const comment = record(rawComment), id = plain(comment.id, 129);
          if (!/^\d{1,64}(?:_\d{1,64})?$/u.test(id)) fail();
          const occurredAt = eventTime(instagram ? comment.timestamp : comment.created_time, now);
          if (!occurredAt || seen.has(id)) continue;
          if (events.length >= 50) return Object.freeze({events: Object.freeze(events), state: 'partial', checkedAt: now});
          seen.add(id);
          events.push(makeEvent(context, config.providerId, now, {providerEventId: id, providerThreadId: postId, kind: 'comment.received', occurredAt, actor: actor(comment.from, config.providerId), title: text(instagram ? comment.text : comment.message, 240, 'New comment'), sourceUrl: link, sourceUrlOrigin: 'provider-supplied', unread: null, importance: 'normal'}));
        }
      }
    }
  } catch (error: unknown) { if (!(error instanceof ProviderError)) fail(); if (!recoverable(error, events.length)) throw error; } finally { http.close(); }
  return Object.freeze({events: Object.freeze(events), state: 'partial', checkedAt: now});
}

export async function syncProvider(config: ProviderConfiguration, grant: ProviderGrant, context: Context, deps: ProviderDependencies = {}): Promise<ProviderSync> {
  checkGrant(config, grant);
  if (!isUuid(context.ownerId) || !isUuid(context.connectionId)) fail('configuration');
  if (Date.parse(grant.expiresAt) <= Date.parse(instant(deps.now))) fail('reauthorization-required');
  if (config.providerId === 'gmail') {
    const adapter = new GmailMetadataAdapter({...context, accountEmail: grant.accountLabel, accessToken: grant.accessToken, ...(deps.fetchImpl ? {fetchImpl: deps.fetchImpl} : {}), ...(deps.now ? {now: deps.now} : {})});
    const result = await adapter.sync();
    if (result.source.reason === 'authorization') fail('authorization');
    if (result.source.state === 'failed') fail(result.source.reason === 'rate-limited' ? 'rate-limited' : result.source.reason === 'timeout' ? 'timeout' : 'upstream');
    return Object.freeze({events: result.source.events, state: result.source.state === 'success' ? 'available' : 'partial', checkedAt: result.source.checkedAt ?? instant(deps.now)});
  }
  return config.providerId === 'outlook' ? syncOutlook(config, grant, context, deps) : syncSocial(config, grant, context, deps);
}
