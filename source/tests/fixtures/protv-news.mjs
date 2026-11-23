// Metadata receipt: Actions45272649682 / job138036195759, checked2026-11-23.
// RSS and canonical original headline/date/section declarations are observed values.
// HTML below is a controlled minimal fixture; it does not copy article bodies or images.
export const PROTV_NOW=Date.parse('2026-11-23T21:30:00.000Z');
export const PROTV_PUBLISHER='Știrile ProTV';
export const PROTV_ROWS=[
 {url:'https://stirileprotv.ro/stiri/international/pretul-petrolului-la-minimul-ultimelor-trei-luni-in-ciuda-haosului-geopolitic-cum-se-explica-scaderea.html',
  title:'Prețul petrolului, la minimul ultimelor trei luni, în ciuda haosului geopolitic. Cum se explică scăderea',
  rssDate:'Mon, 23 Nov 2026 21:24:36 +0000',date:'2026-11-23T21:24:36+00:00',ogDate:'2026-11-23T23:24:36+02:00',section:'Stiri externe'},
 {url:'https://stirileprotv.ro/stiri/international/de-ce-trump-si-jd-vance-au-intervenit-personal-pentru-revenirea-lui-jensen-huang-la-sefia-nvidia-miza-este-una-uriasa.html',
  title:'De ce Trump şi JD Vance au intervenit personal pentru revenirea lui Jensen Huang la șefia Nvidia. Miza este una uriașă',
  rssDate:'Mon, 23 Nov 2026 21:21:47 +0000',date:'2026-11-23T21:21:47+00:00',ogDate:'2026-11-23T23:21:47+02:00',section:'Stiri externe'},
];
const xml=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');
export const protvFeed=(rows=PROTV_ROWS)=>'<rss version="2.0"><channel><title>Știrile ProTV</title><link>https://stirileprotv.ro</link><language>ro-ro</language>'+
 rows.map(row=>'<item><title>'+xml(row.title)+'</title><link>'+xml(row.url)+'</link><pubDate>'+row.rssDate+'</pubDate><category>'+row.section+'</category><description>Do not retain this excerpt.</description></item>').join('')+'</channel></rss>';
export const protvDocument=(row,patch={},ogDate=row.ogDate)=>'<html lang="ro"><head><link rel="canonical" href="'+row.url+'"><meta property="og:title" content="'+xml(row.title+' - Știrile ProTV')+'">'+
 (ogDate===null?'':'<meta property="article:published_time" content="'+ogDate+'">')+'<script type="application/ld+json">'+JSON.stringify({
  '@context':'https://schema.org','@type':'NewsArticle',headline:row.title,datePublished:row.date,dateModified:row.date,
  mainEntityOfPage:{'@type':'WebPage','@id':row.url},articleSection:[row.section],...patch,
 })+'</script></head><body>Article body must never be retained.</body></html>';
export const protvFetcher=async input=>{
 const url=String(input);
 if(url==='https://rss.stirileprotv.ro/')return new Response(protvFeed(),{headers:{'content-type':'application/rss+xml; charset=utf-8'}});
 const row=PROTV_ROWS.find(value=>value.url===url);
 return row?new Response(protvDocument(row),{headers:{'content-type':'text/html; charset=utf-8'}}):new Response('Unavailable fixture index',{status:404});
};
