import { timingSafeEqual } from 'node:crypto';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { refreshPublicIceoSnapshot, type DailyRefreshReceipt, type ContinuousRefreshReceipt } from '../src/iceo/daily-cache.js';
import {validRefreshTrigger,type RefreshTrigger} from '../src/iceo/refresh-ledger.js';

interface RefreshDependencies {
  readonly environment?: Readonly<Record<string, string | undefined>>;
  readonly refresh?: (trigger:RefreshTrigger) => Promise<DailyRefreshReceipt|ContinuousRefreshReceipt>;
  readonly now?:()=>number;
}

function authorized(value: string | string[] | undefined, secret: string | undefined): boolean {
  if (typeof secret !== 'string' || secret.length < 32 || secret.length > 512
    || /[\s\u0000-\u001f\u007f]/u.test(secret) || typeof value !== 'string' || value.length > 520) return false;
  const expected = Buffer.from(`Bearer ${secret}`, 'utf8'), actual = Buffer.from(value, 'utf8');
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

/** Header origin is recorded only after authentication; incomplete tuples remain manual checks. */
export function refreshRequestTrigger(headers:IncomingMessage['headers'],now:number):RefreshTrigger{
  if(headers['ce-type']!=='com.vercel.schedule.v1beta'||headers['user-agent']!=='vercel-cron/1.0')return {kind:'manual'};
  const trigger:unknown={kind:'scheduled',executionId:headers['ce-id'],scheduleName:headers['ce-vssschedulename'],scheduledAt:headers['ce-vssscheduledat'],
    namespace:headers['ce-vssnamespace'],expression:headers['ce-vssexpression']};
  return validRefreshTrigger(trigger,now)?trigger:{kind:'manual'};
}

/** Native continuous source schedule; this never enables private scheduled delivery. */
export async function handleIceoRefresh(request: IncomingMessage, response: ServerResponse, dependencies: RefreshDependencies = {}): Promise<void> {
  response.setHeader('Content-Type', 'application/json; charset=utf-8');
  response.setHeader('Cache-Control', 'private, no-store');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  const send = (code: number, body: unknown): void => { response.statusCode = code; response.end(JSON.stringify(body)); };
  if (request.method !== 'GET') { response.setHeader('Allow', 'GET'); send(405, {error: 'METHOD_NOT_ALLOWED'}); return; }
  if ((request.url ?? '').includes('?')) { send(400, {error: 'QUERY_NOT_ALLOWED'}); return; }
  if (!authorized(request.headers.authorization, (dependencies.environment ?? process.env).CRON_SECRET)) {
    send(401, {error: 'AUTHENTICATION_REQUIRED'}); return;
  }
  try { send(200, await (dependencies.refresh ?? refreshPublicIceoSnapshot)(refreshRequestTrigger(request.headers,(dependencies.now??Date.now)()))); }
  catch {
    response.setHeader('Retry-After', '60');
    send(503, {error: 'DAILY_REFRESH_UNAVAILABLE'});
  }
}
export default handleIceoRefresh;
