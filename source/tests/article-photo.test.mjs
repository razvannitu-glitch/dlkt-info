import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {deflateSync} from 'node:zlib';
import {articleImageUrl,readArticlePhoto} from '../.build/src/media/article-photo-source.js';
import {inspectPhotoRaster} from '../.build/src/media/article-photo-raster.js';
import {ArticlePhotoService,PHOTO_IMAGE_LIMIT} from '../.build/src/media/article-photo-service.js';
import {handleArticlePhoto,resolvePhotoArticle} from '../.build/api/article-photo.js';
import {articlePhotoPath} from '../.build/src/media/article-photo-reference.js';
import {findCity} from '../.build/src/local/cities.js';
import {parseLocalNews} from '../.build/src/local/news-service.js';

const now=Date.parse('2026-11-22T16:00:00.000Z');
const article={id:'a'.repeat(24),revision:'b'.repeat(64),sourceUrl:'https://www.theguardian.com/world/2026/nov/22/source-article',
 title:'Publisher original story',publisher:'The Guardian',publishedAt:'2026-11-22T12:00:00.000Z',validUntil:now+300000};
const image='https://i.guim.co.uk/img/media/abcdef/0_0_1200_800/master/1200.jpg?width=1200&quality=85';
const html=(extra='',overrides={})=>{
 const value={url:article.sourceUrl,title:article.title,image,...overrides};
 return '<html><head><link rel="canonical" href="'+value.url+'"><meta property="og:url" content="'+value.url+'"><meta property="og:type" content="article"><meta property="og:title" content="'+value.title+'"><meta property="og:image" content="'+value.image+'">'+extra+'</head><body></body></html>';
};
function png(width=640,height=360){
 const signature=Buffer.from([137,80,78,71,13,10,26,10]);
 const chunk=(type,data)=>{const payload=Buffer.concat([Buffer.from(type),data]);let crc=0xffffffff;
  for(const byte of payload){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}
  const length=Buffer.alloc(4),end=Buffer.alloc(4);length.writeUInt32BE(data.length);end.writeUInt32BE((crc^0xffffffff)>>>0);
  return Buffer.concat([length,payload,end]);
 };
 const ihdr=Buffer.alloc(13);ihdr.writeUInt32BE(width,0);ihdr.writeUInt32BE(height,4);ihdr[8]=8;ihdr[9]=2;
 return Buffer.concat([signature,chunk('IHDR',ihdr),chunk('IDAT',deflateSync(Buffer.alloc((width*3+1)*height))),chunk('IEND',Buffer.alloc(0))]);
}
const pixels=png();
const mock=(body=html(),options={})=>{
 const calls=[];
 const fetcher=async(address,init)=>{const href=String(address);calls.push({url:href,init});
  if(href.endsWith('/robots.txt'))return new Response(options.robots??'User-agent: *\nAllow: /\n',{headers:{'content-type':'text/plain'}});
  if(href===article.sourceUrl)return new Response(body,{headers:{'content-type':'text/html'}});
  if(href===image)return options.asset?.()??new Response(pixels,{headers:{'content-type':'image/png'}});
  throw Error('Unexpected URL '+href);
 };return{calls,fetcher};
};

test('original preview is associated with the exact article and never inherits article author/licence',()=>{
 const result=readArticlePhoto(html(),article);
 assert.equal(result.imageUrl,image);assert.equal(result.articleUrl,article.sourceUrl);assert.equal(result.credit,null);assert.equal(result.basis,'article-opengraph');assert.equal(result.license,undefined);
});
test('conflicting canonical, OG binding and headline reject the photo',()=>{
 for(const document of [html('',{url:article.sourceUrl+'-other'}),html('<meta property="og:url" content="https://www.theguardian.com/world/other">'),html('',{title:'An unrelated story'})])assert.equal(readArticlePhoto(document,article),null);
 assert.equal(readArticlePhoto(html(),article,article.sourceUrl+'-other'),null);
});
test('Article JSON-LD needs an explicit matching binding and retains only photo-specific credit',()=>{
 const structured=value=>'<script type="application/ld+json">'+JSON.stringify(value)+'</script>';
 const value={'@type':'NewsArticle',url:article.sourceUrl,headline:article.title,datePublished:article.publishedAt,author:{name:'Writer'},image:{'@type':'ImageObject',contentUrl:image,creditText:'Photographer / Agency',caption:'Archive photograph supplied with this article'}};
 const result=readArticlePhoto(structured(value),article);assert.equal(result.credit,'Photographer / Agency');assert.match(result.caption,/Archive/);assert.equal(result.basis,'article-jsonld');
 assert.equal(readArticlePhoto(structured({...value,url:undefined}),article),null);
 assert.equal(readArticlePhoto(structured({...value,url:article.sourceUrl+'-different'}),article),null);
 const noCredit=readArticlePhoto(structured({...value,image}),article);assert.equal(noCredit.credit,null);
 assert.equal(readArticlePhoto(structured({'@type':'Organization',url:article.sourceUrl,headline:article.title,image}),article),null);
});
test('different articles preserve different original image identities',()=>{
 const another={...article,sourceUrl:article.sourceUrl+'-two',title:'A second independent story'};
 const second=image.replace('abcdef','987654');
 const value=readArticlePhoto(html('',{url:another.sourceUrl,title:another.title,image:second}),another);
 assert.equal(value.imageUrl,second);assert.notEqual(value.imageUrl,readArticlePhoto(html(),article).imageUrl);
});
test('unsafe, arbitrary and publisher-brand image URLs fail before fetching',()=>{
 for(const bad of ['http://i.guim.co.uk/img/media/x.jpg','https://127.0.0.1/x.jpg','https://i.guim.co.uk.evil.test/img/media/x.jpg','https://user:pass@i.guim.co.uk/img/media/x.jpg','https://i.guim.co.uk:444/img/media/x.jpg','https://i.guim.co.uk/img/media/logo.jpg','https://i.guim.co.uk/img/media/x.jpg?url=https://example.com','https://i.guim.co.uk/img/media/%2e%2e/private.jpg','data:image/png;base64,AAAA','https://other.example/x.jpg'])assert.equal(articleImageUrl(bad,article.sourceUrl),null,bad);
 assert.equal(readArticlePhoto(html('',{image:'https://other.example/x.jpg'}),article),null);
});
test('local publisher paths and body limits are strict',()=>{
 const local={...article,sourceUrl:'https://b365.ro/lucrari-in-bucuresti-629580/',publisher:'B365'};
 assert.equal(articleImageUrl('https://b365.ro/wp-content/uploads/2026/11/apa.jpg',local.sourceUrl),'https://b365.ro/wp-content/uploads/2026/11/apa.jpg');
 assert.equal(articleImageUrl('https://b365.ro/api/proxy.jpg',local.sourceUrl),null);
 assert.equal(readArticlePhoto(' '.repeat(1048577),article),null);
});
test('raster inspection rejects HTML, SVG, tiny images and oversized decoded dimensions',()=>{
 assert.deepEqual(inspectPhotoRaster(pixels),{mime:'image/png',width:640,height:360});
 assert.equal(inspectPhotoRaster(Buffer.from('<svg><script>alert(1)</script></svg>')),null);
 assert.equal(inspectPhotoRaster(png(1,1)),null);
 const enormous=Buffer.from(pixels);enormous.writeUInt32BE(100000,16);assert.equal(inspectPhotoRaster(enormous),null);
});
test('service coalesces same-revision requests, caches verified bytes and preserves title data',async()=>{
 const source=mock(),service=new ArticlePhotoService(source.fetcher,()=>now),before=JSON.stringify(article);
 const [first,second]=await Promise.all([service.read(article),service.read(article)]);
 assert.equal(first,second);assert.equal(first.metadata.imageUrl,image);assert.equal(first.sha256,createHash('sha256').update(pixels).digest('hex'));
 assert.equal((await service.read(article)),first);assert.equal(source.calls.length,3);assert.equal(JSON.stringify(article),before);
 assert.ok(source.calls.every(call=>call.init.redirect==='manual'&&call.init.credentials==='omit'&&call.init.signal));
});
test('robots denial makes no article/image request and caches absence without any substitute',async()=>{
 const source=mock(html(),{robots:'User-agent: *\nDisallow: /\n'}),service=new ArticlePhotoService(source.fetcher,()=>now);
 assert.equal(await service.read(article),null);assert.equal(await service.read(article),null);assert.equal(source.calls.length,1);
});
test('wrong article image, non-raster, MIME mismatch, external redirect and byte limit fail closed',async()=>{
 const cases=[
 {body:html('',{image:'https://evil.example/photo.jpg'})},
 {asset:()=>new Response('<html>Not an image</html>',{headers:{'content-type':'text/html'}})},
 {asset:()=>new Response(pixels,{headers:{'content-type':'image/jpeg'}})},
 {asset:()=>new Response(null,{status:302,headers:{location:'https://127.0.0.1/private'}})},
 {asset:()=>new Response(pixels,{headers:{'content-type':'image/png','content-length':String(PHOTO_IMAGE_LIMIT+1)}})},
 ];
 for(const scenario of cases){const source=mock(scenario.body??html(),scenario),service=new ArticlePhotoService(source.fetcher,()=>now);assert.equal(await service.read(article),null);assert.ok(source.calls.every(call=>!call.url.includes('127.0.0.1')&&!call.url.includes('evil.example')));}
});
test('expired article and unreviewed publisher cannot make outbound requests',async()=>{
 const source=mock(),service=new ArticlePhotoService(source.fetcher,()=>now);
 assert.equal(await service.read({...article,validUntil:now}),null);assert.equal(await service.read({...article,sourceUrl:'https://evil.example/article'}),null);assert.equal(source.calls.length,0);
});
test('failed acquisition cannot stamp a new successful photo check',async()=>{
 const service=new ArticlePhotoService(async()=>{throw Error('source denied');},()=>now);
 assert.equal(await service.read(article),null);
});
const card=JSON.parse(readFileSync('tests/fixtures/card-photos.json','utf8'))[0];
const snapshot={generatedAt:new Date(now).toISOString(),state:'ready',cards:[card]};
const services={global:async()=>snapshot,local:async()=>({articles:[],sources:[]}),photos:{read:async value=>({bytes:pixels,mime:'image/png',width:640,height:360,sha256:'d'.repeat(64),metadata:{articleUrl:value.sourceUrl,imageUrl:image,basis:'article-opengraph',alt:'',credit:null,caption:null},checkedAt:now,until:now+60000})},clock:()=>now};
test('API resolves only exact current article IDs and revisions, rejecting stale or absent catalog records',async()=>{
 const ref={id:card.id,revision:card.contentHash};
 assert.equal((await resolvePhotoArticle(ref,services)).sourceUrl,card.sourceUrl);
 assert.equal(await resolvePhotoArticle({...ref,revision:'f'.repeat(64)},services),null);
 assert.equal(await resolvePhotoArticle({...ref,id:'e'.repeat(24)},services),null);
 assert.equal(await resolvePhotoArticle(ref,{...services,global:async()=>({...snapshot,generatedAt:new Date(now-3600000).toISOString()})}),null);
 assert.equal(await resolvePhotoArticle(ref,{...services,global:async()=>({...snapshot,cards:[{...card,kind:'software-release'}]})}),null);
});
test('API returns a source-bound raster, HEAD and ETag; rejects URL injection and wrong revisions',async()=>{
 const server=createServer((req,res)=>{void handleArticlePhoto(req,res,services);}).listen(0,'127.0.0.1');await once(server,'listening');
 const base='http://127.0.0.1:'+server.address().port,path=articlePhotoPath({id:card.id,revision:card.contentHash});
 try{
  const response=await fetch(base+path);assert.equal(response.status,200);assert.equal(response.headers.get('content-type'),'image/png');assert.equal(response.headers.get('x-content-type-options'),'nosniff');assert.match(response.headers.get('link'),/globalvoices/);assert.deepEqual(Buffer.from(await response.arrayBuffer()),pixels);
  const head=await fetch(base+path,{method:'HEAD'});assert.equal(head.status,200);assert.equal(await head.text(),'');
  const unchanged=await fetch(base+path,{headers:{'If-None-Match':'"'+('d'.repeat(64))+'"'}});assert.equal(unchanged.status,304);
  assert.equal((await fetch(base+path,{method:'POST'})).status,405);
  for(const query of ['?url=https://evil.test',path.slice(path.indexOf('?'))+'&url=https://evil.test',path.slice(path.indexOf('?'))+'&id='+card.id])assert.equal((await fetch(base+'/api/article-photo'+query)).status,400);
  assert.equal((await fetch(base+articlePhotoPath({id:card.id,revision:'e'.repeat(64)}))).status,404);
  assert.equal((await fetch(base+articlePhotoPath({id:card.id,revision:card.contentHash})+'&city=683506')).status,400);
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});
test('API never returns photo bytes bound to a different source article',async()=>{
 const altered={...services,photos:{read:async value=>({...await services.photos.read(value),metadata:{articleUrl:'https://wrong.example/',imageUrl:image,basis:'article-opengraph',alt:'',credit:null,caption:null}})}};
 const server=createServer((req,res)=>{void handleArticlePhoto(req,res,altered);}).listen(0,'127.0.0.1');await once(server,'listening');
 try{assert.equal((await fetch('http://127.0.0.1:'+server.address().port+articlePhotoPath({id:card.id,revision:card.contentHash}))).status,404);}
 finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));}
});

test('Guardian variants keep the exact signed original-photo URL without a social overlay',()=>{
 const overlay=image+'&overlay=guardian-logo',clean=image+'&fit=max&s=preserve-this-published-signature';
 const node={'@type':'NewsArticle',url:article.sourceUrl,headline:article.title,image:[overlay,clean]};
 const value=readArticlePhoto('<script type="application/ld+json">'+JSON.stringify(node)+'</script>',article);
 assert.equal(value.imageUrl,clean);
});
test('contradictory publication metadata cannot bind a photograph to this revision',()=>{
 assert.equal(readArticlePhoto(html('<meta property="article:published_time" content="2020-01-01T00:00:00Z">'),article),null);
});

test('WordPress Article references resolve only their own declared ImageObject',()=>{
 const photoId=article.sourceUrl+'#primaryimage';
 const graph={'@graph':[
 {'@type':'WebSite','@id':article.sourceUrl+'#website',image:'https://evil.example/brand.jpg'},
 {'@type':'ImageObject','@id':photoId,url:image,caption:'FOTO: Arhiva'},
 {'@type':'NewsArticle','@id':article.sourceUrl+'#article',headline:article.title,image:{'@id':photoId}},
 ]};
 const value=readArticlePhoto('<script type="application/ld+json">'+JSON.stringify(graph)+'</script>',article);
 assert.equal(value.imageUrl,image);assert.equal(value.caption,'FOTO: Arhiva');
 graph['@graph'][2].image={'@id':'https://www.theguardian.com/different#primaryimage'};
 assert.equal(readArticlePhoto('<script type="application/ld+json">'+JSON.stringify(graph)+'</script>',article),null);
});

test('local photo resolution requires the registered city, exact feed revision and current article',async()=>{
 const city=findCity('683506');
 const feed='<rss version="2.0"><channel><title>B365</title><link>https://b365.ro/</link><item><title>Bucuresti: lucrari la reteaua de apa</title><link>https://b365.ro/lucrari-apa-bucuresti-629580/</link><pubDate>Sun, 22 Nov 2026 14:00:00 +0000</pubDate><description>Lucrarile sunt anuntate de operator.</description></item></channel></rss>';
 const articles=parseLocalNews(feed,'bucharest-b365',city,new Date(now).toISOString(),now).articles;
 assert.equal(articles.length,1);const local=articles[0];
 let globalCalls=0,localCalls=0;
 const deps={...services,global:async()=>{globalCalls++;return snapshot;},local:async selected=>{localCalls++;assert.equal(selected.id,city.id);return{articles,sources:[]};}};
 const ref={id:local.id,revision:local.documentHash,cityId:city.id};
 assert.equal((await resolvePhotoArticle(ref,deps)).sourceUrl,local.url);assert.equal(globalCalls,0);assert.equal(localCalls,1);
 assert.equal(await resolvePhotoArticle({...ref,revision:'c'.repeat(64)},deps),null);
 assert.equal(await resolvePhotoArticle({...ref,cityId:'0000000'},deps),null);
 assert.equal(await resolvePhotoArticle(ref,{...deps,clock:()=>now+300001}),null);
});

const largeWpArticle={...article,sourceUrl:'https://buletin.de/bucuresti/elevii-de-la-liceul-tehnologic-elie-radu-ar-putea-face-practica-la-doua-service-uri-auto-si-la-un-magazin-angro-proiectul-pe-masa-consilierilor-locali/',
 publisher:'Buletin de București',title:'Elevii de la Liceul Tehnologic Elie Radu ar putea face practică la două service-uri auto și la un magazin angro'};
const largeWpOriginal='https://buletin.de/bucuresti/wp-content/uploads/2026/11/female-owner-checking-inventory-food-products-grocery-store-1.jpg';
const largeWpPreview='https://buletin.de/bucuresti/wp-content/uploads/2026/11/female-owner-checking-inventory-food-products-grocery-store-1-1000x667.jpg';
function largeWpHtml(preview=largeWpPreview,dimensions={width:7802,height:5204}){
 return html('<script type="application/ld+json">'+JSON.stringify({'@type':'NewsArticle',url:largeWpArticle.sourceUrl,headline:largeWpArticle.title,datePublished:largeWpArticle.publishedAt,image:{'@type':'ImageObject',url:largeWpOriginal,...dimensions,caption:'Sursă foto: magnific.com'}})+'</script><meta property="og:image" content="'+preview+'">',{url:largeWpArticle.sourceUrl,title:largeWpArticle.title,image:largeWpOriginal});
}
test('oversized original uses only the publisher-declared same-photo WordPress preview',()=>{
 const selected=readArticlePhoto(largeWpHtml(),largeWpArticle);
 assert.equal(selected.imageUrl,largeWpPreview);assert.deepEqual(selected.expectedDimensions,{width:1000,height:667});
 assert.equal(selected.caption,'Sursă foto: magnific.com');assert.equal(selected.basis,'article-jsonld');
 const query=readArticlePhoto(largeWpHtml(largeWpPreview+'?cache=20261122'),largeWpArticle);
 assert.equal(query.imageUrl,largeWpPreview+'?cache=20261122','Declared preview query is preserved, never constructed');
});
test('WordPress preview choice cannot change identity, aspect, minimum quality or unknown dimensions',()=>{
 for(const other of [
  largeWpPreview.replace('store-1-','store-2-'),largeWpPreview.replace('/2026/11/','/2026/10/'),
  largeWpPreview.replace('buletin.de','b365.ro'),largeWpPreview.replace('1000x667','150x100'),
  largeWpPreview.replace('1000x667','1000x1000'),largeWpPreview.replace('.jpg','.png'),largeWpPreview.replace('store-1','STORE-1')
 ])assert.equal(readArticlePhoto(largeWpHtml(other),largeWpArticle).imageUrl,largeWpOriginal);
 assert.equal(readArticlePhoto(largeWpHtml(largeWpOriginal),largeWpArticle).imageUrl,largeWpOriginal,'No invented derivative');
 for(const size of [{},{width:'7802',height:5204},{width:1600,height:1067}])
  assert.equal(readArticlePhoto(largeWpHtml(largeWpPreview,size),largeWpArticle).imageUrl,largeWpOriginal);
});
test('downloaded preview dimensions must agree with the declared same-photo derivative',async()=>{
 for(const [width,height,expected] of [[1000,667,true],[640,360,false]]){
  const calls=[],fetcher=async(address)=>{
   const href=String(address);calls.push(href);
   if(href.endsWith('/robots.txt'))return new Response(null,{status:404});
   if(href===largeWpArticle.sourceUrl)return new Response(largeWpHtml(),{headers:{'content-type':'text/html'}});
   if(href===largeWpPreview)return new Response(png(width,height),{headers:{'content-type':'image/png'}});
   throw Error('Unexpected URL '+href);
  };
  const service=new ArticlePhotoService(fetcher,()=>now);
  assert.equal((await service.read(largeWpArticle))!==null,expected);
  assert.ok(calls.includes(largeWpPreview));assert.ok(!calls.includes(largeWpOriginal));
 }
});

test('HotNews original photos keep the exact article binding, illustration caption and upload-origin boundary',()=>{
 const sourceUrl='https://hotnews.ro/o-nava-ruseasca-a-fost-lovita-de-o-drona-intr-un-port-la-marea-mediterana-2411119';
 const photo='https://hotnews.ro/wp-content/uploads/2026/11/profimedia-1153180822.jpg';
 const record={...article,sourceUrl,publisher:'HotNews.ro',title:'Controlled HotNews report'};
 const metadata={'@type':'NewsArticle',url:sourceUrl,headline:record.title,datePublished:record.publishedAt,
   image:{'@type':'ImageObject',contentUrl:photo,creditText:'Photo-specific credit',caption:'Illustrative image supplied with this article'}};
 const document='<link rel="canonical" href="'+sourceUrl+'"><script type="application/ld+json">'+JSON.stringify(metadata)+'</script>';
 const result=readArticlePhoto(document,record);
 assert.equal(result.imageUrl,photo);assert.equal(result.articleUrl,sourceUrl);
 assert.equal(result.caption,'Illustrative image supplied with this article');assert.equal(result.credit,'Photo-specific credit');
 assert.equal(result.license,undefined);
 for(const rejected of ['https://hotnews.ro.attacker.invalid/wp-content/uploads/image.jpg','https://hotnews.ro/private/image.jpg','https://hotnews.ro/wp-content/uploads/image.svg','https://127.0.0.1/wp-content/uploads/image.jpg'])
   assert.equal(articleImageUrl(rejected,sourceUrl),null);
 assert.equal(readArticlePhoto(document,{...record,title:'Unrelated report'}),null);
});

test('Digi24 accepts only the exact original article photo on its reviewed raster gateway',()=>{
 const sourceUrl='https://www.digi24.ro/stiri/externe/mesajul-sefului-serviciilor-de-informatii-americane-despre-putin-dupa-ce-trump-l-a-numit-prieten-4048107';
 const photo='https://s.iw.ro/gateway/g/ZmlsZVNvdXJjZT1odHRwJTNBJTJGJTJG/c3RvcmFnZTA4dHJhbnNjb2Rlci5yY3Mt/cmRzLnJvJTJGc3RvcmFnZSUyRjIwMjYl/MkYxMSUyRjIyJTJGMzA4MTg4OV8zMDgx/ODg5X01XRTVOMkl4Wm1Oa1lUUmxaRFps/Tm1RMU9XRmlaVEppWkFfdGh1bWJfLmpw/ZyZ3PTc4MCZoPTQ0MCZoYXNoPWRiZDFh/OGFkM2RiZDBmZDkyZjAxNGNlNTNjM2JhOWNi.thumb.jpg';
 const record={...article,sourceUrl,publisher:'Digi24',title:'Controlled Digi24 report',publishedAt:'2026-11-22T19:35:37+02:00'};
 const metadata={'@type':'NewsArticle',url:sourceUrl,headline:record.title,datePublished:record.publishedAt,image:photo};
 const document='<html><head><link rel="canonical" href="'+sourceUrl+'"><meta name="publish-date" content="'+record.publishedAt+'"><script type="application/ld+json">'+JSON.stringify(metadata)+'</script></head></html>';
 const result=readArticlePhoto(document,record);
 assert.equal(result.imageUrl,photo);assert.equal(result.articleUrl,sourceUrl);assert.equal(result.basis,'article-jsonld');
 assert.equal(result.credit,null);assert.equal(result.license,undefined);
 assert.equal(readArticlePhoto(document,{...record,title:'Another report'}),null);
 assert.equal(readArticlePhoto(document,record,sourceUrl+'-other'),null);
 for(const rejected of [
  photo.replace('s.iw.ro','s.iw.ro.attacker.invalid'),photo.replace('/gateway/g/','/private/'),photo.replace('.jpg','.svg'),
  photo+'?url=https://127.0.0.1/private',photo.replace('https:','http:'),'https://127.0.0.1/gateway/g/image.jpg'
 ])assert.equal(articleImageUrl(rejected,sourceUrl),null);
 assert.equal(articleImageUrl(photo,article.sourceUrl),null,'Gateway does not become available to another publisher');
});
