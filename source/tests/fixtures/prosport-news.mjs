// Primary metadata receipt: Actions45286173292 / job138082948684,2026-11-23.
// RSS and canonical headline/date/section values below were observed in that run.
// The HTML is a controlled minimal fixture, with no original article body or image.
export const PROSPORT_NOW=Date.parse('2026-11-23T23:09:05.000Z');
export const PROSPORT_PUBLISHER='ProSport';
export const PROSPORT_ROWS=[
  {
    "url": "https://www.prosport.ro/fotbal-extern/campionate-externe/italia/radu-dragusin-nota-monza-fiorentina-3-0-integralist-serie-a-dezastru-20576187",
    "rssTitle": "Nota lui Radu Drăgușin după ce a fost integralist în dezastrul din Monza &#8211; Fiorentina 3-0",
    "headline": "Nota lui Radu Drăgușin după ce a fost integralist în dezastrul din Monza &#8211; Fiorentina 3-0",
    "title": "Nota lui Radu Drăgușin după ce a fost integralist în dezastrul din Monza – Fiorentina 3-0",
    "rssDate": "Mon, 23 Nov 2026 22:03:36 +0000",
    "date": "2026-11-24T00:03:36+02:00",
    "modifiedDate": "2026-11-24T00:15:30+02:00",
    "ogTitle": "Nota lui Radu Drăgușin după ce a fost integralist în dezastrul din Monza - Fiorentina 3-0",
    "ogDate": "2026-11-23T22:03:36+00:00",
    "ogModifiedDate": "2026-11-23T22:15:30+00:00",
    "sections": [
      "Campionate Externe",
      "Fotbal Extern",
      "Naționala",
      "Serie A",
      "Stranieri"
    ]
  },
  {
    "url": "https://www.prosport.ro/fotbal-intern/superliga/anunt-venire-mirel-radoi-u-cluj-20576183",
    "rssTitle": "DECLARAȚII Lovitură de teatru! Anunț despre venirea lui Mirel Rădoi la „U” Cluj, noul El Dorado din Superliga",
    "headline": "Lovitură de teatru! Anunț despre venirea lui Mirel Rădoi la „U” Cluj, noul El Dorado din Superliga",
    "title": "Lovitură de teatru! Anunț despre venirea lui Mirel Rădoi la „U” Cluj, noul El Dorado din Superliga",
    "rssDate": "Mon, 23 Nov 2026 22:00:49 +0000",
    "date": "2026-11-24T00:00:49+02:00",
    "modifiedDate": "2026-11-24T00:11:25+02:00",
    "ogTitle": "Lovitură de teatru! Anunț despre venirea lui Mirel Rădoi la „U” Cluj",
    "ogDate": "2026-11-23T22:00:49+00:00",
    "ogModifiedDate": "2026-11-23T22:11:25+00:00",
    "sections": [
      "Fotbal Intern",
      "Liga 1",
      "Superliga"
    ]
  }
];
const xml=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export const prosportFeed=(rows=PROSPORT_ROWS)=>'<rss version="2.0"><channel><title>Prosport</title><link>https://www.prosport.ro</link><language>ro-RO</language><lastBuildDate>Mon, 23 Nov 2026 22:15:30 +0000</lastBuildDate>'+
 rows.map(row=>'<item><title>'+xml(row.rssTitle)+'</title><link>'+xml(row.url)+'</link><pubDate>'+row.rssDate+'</pubDate><description>Do not retain this excerpt.</description></item>').join('')+'</channel></rss>';
export const prosportDocument=(row,patch={},meta={})=>{
 const ogTitle=meta.ogTitle??row.ogTitle,ogDate=meta.ogDate===undefined?row.ogDate:meta.ogDate,canonical=meta.canonical??row.url;
 return '<html lang="ro"><head><link rel="canonical" href="'+canonical+'"><meta property="og:title" content="'+xml(ogTitle)+'"><meta property="og:url" content="'+row.url+'">'+
  (ogDate===null?'':'<meta property="article:published_time" content="'+ogDate+'">')+'<meta property="article:modified_time" content="'+row.ogModifiedDate+'"><script type="application/ld+json">'+JSON.stringify({
   '@context':'https://schema.org','@type':'NewsArticle','@id':row.url+'#article',mainEntityOfPage:row.url,
   headline:row.headline,datePublished:row.date,dateModified:row.modifiedDate,articleSection:row.sections,...patch,
  })+'</script></head><body>Article body must never be retained.</body></html>';
};
export const prosportFetcher=async input=>{
 const url=String(input);
 if(url==='https://www.prosport.ro/feed')return new Response(prosportFeed(),{headers:{'content-type':'application/rss+xml; charset=utf-8'}});
 const row=PROSPORT_ROWS.find(value=>value.url===url);
 return row?new Response(prosportDocument(row),{headers:{'content-type':'text/html; charset=utf-8'}}):new Response('Unavailable fixture index',{status:404});
};
