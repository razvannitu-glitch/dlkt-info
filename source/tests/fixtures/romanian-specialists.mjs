// Reduced public metadata observations; no descriptions, images or article bodies.
// Actions45467805296/job138707282525 and45469244043/job138712368119,2026-11-24.
export const SPECIALIST_NOW=Date.parse('2026-11-24T19:25:00Z');
export const SPECIALIST_FEEDS=Object.freeze({
  "descopera": {
    "publisher": "Descopera",
    "url": "https://www.descopera.ro/feed",
    "title": "Descopera",
    "home": "https://www.descopera.ro/",
    "language": "ro-RO",
    "origin": "https://www.descopera.ro",
    "articlePath": "/"
  },
  "spotmedia": {
    "publisher": "Spotmedia.ro",
    "url": "https://spotmedia.ro/feed",
    "title": "spotmedia.ro",
    "home": "https://spotmedia.ro/",
    "language": "ro-RO",
    "origin": "https://spotmedia.ro",
    "articlePath": "/stiri/"
  }
});
export const SPECIALIST_ROWS=Object.freeze([
  {
    "publisherId": "descopera",
    "publisher": "Descopera",
    "url": "https://www.descopera.ro/stiinta/21160587-oamenii-de-stiinta-au-transformat-praful-de-pe-luna-in-caramizi-pentru-viitoarele-baze",
    "title": "Oamenii de știință au transformat praful de pe Lună în cărămizi pentru viitoarele baze",
    "rssDate": "Tue, 24 Nov 2026 18:00:58 +0000",
    "date": "2026-11-24T18:00:58+00:00",
    "sections": [
      "Știință"
    ],
    "categories": [
      "Știință",
      "3D",
      "Artemis",
      "baze",
      "imprimare",
      "luna",
      "misiuni",
      "praf"
    ]
  },
  {
    "publisherId": "descopera",
    "publisher": "Descopera",
    "url": "https://www.descopera.ro/istorie/21160837-un-lant-muntos-din-vremea-gondwanei-se-ascunde-sub-gheata-din-antarctica",
    "title": "Un lanț muntos din vremea Gondwanei se ascunde sub gheața din Antarctica",
    "rssDate": "Tue, 24 Nov 2026 17:00:02 +0000",
    "date": "2026-11-24T17:00:02+00:00",
    "sections": [
      "Istorie"
    ],
    "categories": [
      "Istorie",
      "Antarctica",
      "gondwana",
      "munti"
    ]
  },
  {
    "publisherId": "spotmedia",
    "publisher": "Spotmedia.ro",
    "url": "https://spotmedia.ro/stiri/horoscop/horoscop-zilnic-25-noiembrie-6",
    "title": "Horoscop zilnic: 25 noiembrie",
    "rssDate": "Tue, 24 Nov 2026 17:51:00 +0000",
    "date": "2026-11-24T17:51:00+00:00",
    "sections": [
      "Horoscop"
    ],
    "categories": [
      "Horoscop",
      "horoscop 2026",
      "horoscop 25 noiembrie 2026",
      "horoscop astrocafe",
      "horoscop noiembrie 2026",
      "horoscop zilnic"
    ]
  },
  {
    "publisherId": "spotmedia",
    "publisher": "Spotmedia.ro",
    "url": "https://spotmedia.ro/stiri/eveniment/ginerele-lui-trump-dezvaluie-cum-a-incercat-sa-si-tina-in-frau-socrul-in-razboiul-cu-zelenski-detalii-din-culisele-negocierilor",
    "title": "Ginerele lui Trump dezvăluie cum a încercat să-și țină în frâu socrul în războiul cu Zelenski. Detalii din culisele negocierilor",
    "rssDate": "Tue, 24 Nov 2026 17:24:33 +0000",
    "date": "2026-11-24T17:24:33+00:00",
    "sections": [
      "Eveniment"
    ],
    "categories": [
      "Eveniment",
      "Jared Kushner",
      "negocieri pace Putin Zelenski",
      "Rusia invazie Ucraina",
      "Rusia război Ucraina",
      "Steve Witkoff Jared Kushner Kiev",
      "Steve Witkoff Jared Kushner Moscova",
      "Steve Witkoff Jared Kushner Putin",
      "Steve Witkoff Jared Kushner Ucraina",
      "Steve Witkoff plan pace Jared Kushner",
      "Steve Witkoff și Jared Kushner"
    ]
  }
]);
const escape=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export function specialistFeed(id,rows=SPECIALIST_ROWS.filter(row=>row.publisherId===id)){
 const feed=SPECIALIST_FEEDS[id];
 return `<rss><channel><title>${escape(feed.title)}</title><link>${feed.home}</link><language>${feed.language}</language>${rows.map(row=>`<item><title>${escape(row.title)}</title><link>${row.url}</link><pubDate>${row.rssDate}</pubDate>${(row.categories??[]).map(value=>`<category>${escape(value)}</category>`).join('')}<description>Ignored description</description></item>`).join('')}</channel></rss>`;
}
export function specialistDocument(row,overrides={},head={}){
 const article={'@context':'https://schema.org','@type':'NewsArticle','@id':row.url+'#article',headline:row.title,datePublished:row.date,mainEntityOfPage:row.url,articleSection:row.sections,...overrides};
 const canonical=head.canonical??row.url,ogTitle=head.title??row.title,ogUrl=head.url??row.url,ogDate=head.date===undefined?row.date:head.date;
 return `<!doctype html><html><head><link rel="canonical" href="${escape(canonical)}"><meta property="og:title" content="${escape(ogTitle)}"><meta property="og:url" content="${escape(ogUrl)}">${ogDate===null?'':`<meta property="article:published_time" content="${escape(ogDate)}">`}${head.section? `<meta property="article:section" content="${escape(head.section)}">`:''}<script type="application/ld+json">${JSON.stringify(article)}</script>${head.extra??''}</head><body>Article body not retained</body></html>`;
}
export async function specialistFetcher(input){
 const url=String(input),feed=Object.entries(SPECIALIST_FEEDS).find(([,value])=>value.url===url);
 if(feed)return new Response(specialistFeed(feed[0]),{headers:{'content-type':'application/rss+xml'}});
 if(url==='https://data.gdeltproject.org/gdeltv3/gal/feed.rss')return new Response(`<rss><channel><title>GDELT Article List RSS Feed</title><link>${url}</link><lastBuildDate>${new Date(SPECIALIST_NOW).toUTCString()}</lastBuildDate></channel></rss>`,{headers:{'content-type':'application/rss+xml'}});
 const row=SPECIALIST_ROWS.find(value=>value.url===url);
 return row?new Response(specialistDocument(row),{headers:{'content-type':'text/html'}}):new Response('',{status:404});
}
