import type { IncomingMessage, ServerResponse } from 'node:http';
import { buildSyntheticBriefing } from '../src/demo.js';

export default function demo(req: IncomingMessage, res: ServerResponse): void {
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-DLKT-Info-Synthetic', '1');
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.statusCode = 405;
    res.setHeader('Allow', 'GET, HEAD');
    res.end(JSON.stringify({ error: 'METHOD_NOT_ALLOWED' }));
    return;
  }
  res.statusCode = 200;
  if (req.method === 'HEAD') { res.end(); return; }
  res.end(JSON.stringify(buildSyntheticBriefing()));
}
