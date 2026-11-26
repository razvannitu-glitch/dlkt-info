/**
 * One-shot read-only primary feed metadata probe, not a publisher integration.
 * No secrets, article bodies, photos or remote payloads are retained.
 */
const sources = [
  {
    id: 'cfpb-newsroom',
    url: 'https://www.consumerfinance.gov/about-us/newsroom/feed/',
    expectedHost: 'www.consumerfinance.gov',
  },
  {
    id: 'eurostat-economy-news',
    url: 'https://ec.europa.eu/eurostat/en/search?_estatsearchportlet_WAR_estatsearchportlet_collection=CAT_EURNEW&_estatsearchportlet_WAR_estatsearchportlet_theme=PER_ECOFIN&p_p_id=estatsearchportlet_WAR_estatsearchportlet&p_p_lifecycle=2&p_p_mode=view&p_p_resource_id=atom&p_p_state=maximized',
    expectedHost: 'ec.europa.eu',
  },
];
const MAX_BYTES = 1572864;
const maxContent = (content) => String(content || '').slice(0, 120).replace(/[\r\n\t]/gu, ' ');

async function inspect(entry) {
  const url = new URL(entry.url);
  if (url.protocol !== 'https:' || url.hostname !== entry.expectedHost) throw Error('UNAPPROVED_FEED');
  const result = {
    id: entry.id,
    status: 'not-tested',
    contentType: null,
    root: null,
    title: null,
    entryCountInSample: 0,
    publishedDatePresent: false,
    articleLinkHost: null,
    articlePathSample: null,
    articleQueryKeys: [],
    atomEntryLinkRel: null,
    atomEntryLinkType: null,
    feedHome: null,
    atomNamespace: null,
    dateSample: null,
    descriptionPresent: false,
    reason: null,
  };
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
      headers: {Accept: 'application/rss+xml, application/atom+xml, application/xml, text/xml', 'User-Agent': 'DLKT-Info/0.9.46 (+https://www.dlkt.ee)'},
    });
  } catch (error) {
    result.status = 'transport-error';
    result.reason = error instanceof Error ? error.name : 'unknown';
    return result;
  }
  result.status = String(response.status);
  result.contentType = (response.headers.get('content-type') || '').split(';')[0]?.trim().toLowerCase() || null;
  if (response.status !== 200) {
    await response.body?.cancel();
    return result;
  }
  if (!['application/rss+xml','application/atom+xml','application/xml','text/xml'].includes(result.contentType)) {
    result.reason = 'unexpected-content-type';
    await response.body?.cancel();
    return result;
  }
  const reader = response.body?.getReader();
  if (!reader) {result.reason='no-stream';return result;}
  const chunks = [];
  let bytes = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      const remaining = MAX_BYTES - bytes;
      if (next.value.byteLength > remaining) {
        chunks.push(next.value.subarray(0, remaining));
        bytes += remaining;
        await reader.cancel();
        break;
      }
      chunks.push(next.value);
      bytes += next.value.byteLength;
      if (bytes === MAX_BYTES) {await reader.cancel();break;}
    }
  } finally {
    reader.releaseLock();
  }
  const text = new TextDecoder('utf-8', {fatal:true}).decode(Buffer.concat(chunks));
  result.root = /<(?:rss)\b/iu.test(text.slice(0,1024)) ? 'rss'
    : /<(?:feed)\b/iu.test(text.slice(0,1024)) ? 'atom'
    : 'unrecognized';
  result.title = maxContent(text.match(/<title(?:\s[^>]*)?>([^<]{1,220})<\/title>/iu)?.[1]);
  const header = text.split(/<(?:entry|item)(?:\s|>)/iu)[0] || '';
  result.atomNamespace = result.root==='atom' ? text.match(/<feed[^>]*xmlns=["']([^"']+)["']/iu)?.[1] || null : null;
  const declaredHome = result.root==='rss'
    ? header.match(/<channel\b[\s\S]{0,3000}?<link>([^<]{1,300})<\/link>/iu)?.[1]
    : header.match(/<link[^>]*rel=["']alternate["'][^>]*href=["'](https:\/\/[^"']{1,300})["']/iu)?.[1]
      || header.match(/<link[^>]*href=["'](https:\/\/[^"']{1,300})["'][^>]*rel=["']alternate["']/iu)?.[1];
  try {const u=new URL(declaredHome || ''); if(u.protocol==='https:') result.feedHome=u.origin+u.pathname;} catch {}
  result.dateSample = text.match(/<(?:pubDate|published|updated)(?:\s[^>]*)?>([^<]{1,100})<\/\w+>/iu)?.[1] || null;
  result.descriptionPresent = /<(?:description|summary)(?:\s|>)/iu.test(text);
  result.entryCountInSample = (text.match(/<(?:entry|item)(?:\s|>)/giu) || []).length;
  if(result.root === 'atom') {
    const entryTag = text.match(/<entry(?:\s[^>]*)?>[\s\S]{0,3000}?(<link\b[^>]*>)/iu)?.[1] || '';
    result.atomEntryLinkRel = entryTag.match(/rel=["']([^"']+)["']/iu)?.[1] || null;
    result.atomEntryLinkType = entryTag.match(/type=["']([^"']+)["']/iu)?.[1] || null;
  }
  result.publishedDatePresent = /<(?:pubDate|published|updated)(?:\s|>)/iu.test(text);
  const rssLink = text.match(/<item\b[\s\S]{0,3000}?<link>(https:\/\/[^<]{1,250})<\/link>/iu)?.[1];
  const atomLink = text.match(/<entry\b[\s\S]{0,3000}?<link[^>]*href=["'](https:\/\/[^"']{1,250})["']/iu)?.[1];
  try {
    const link = new URL(rssLink || atomLink || '');
    if (link.protocol === 'https:') {result.articleLinkHost = link.hostname;result.articlePathSample=link.pathname;result.articleQueryKeys=[...new Set(link.searchParams.keys())];}
  } catch { /* no article link observed in bounded prefix */ }
  if (!result.title || result.entryCountInSample === 0) result.reason='feed-structure-needs-review';
  result.sampleTruncated = bytes === MAX_BYTES;
  return result;
}
for (const source of sources) {
  try {process.stdout.write('DLKT_OFFICIAL_FEED_PROBE '+JSON.stringify(await inspect(source))+'\n');}
  catch (error) {process.stdout.write('DLKT_OFFICIAL_FEED_PROBE '+JSON.stringify({id:source.id,status:'probe-failed',reason:error instanceof Error?error.name:'unknown'})+'\n');}
}
