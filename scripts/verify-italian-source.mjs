// Fixed, bounded source receipt. No credentials, article bodies or user data are logged.
const feedUrl='https://www.repubblica.it/rss/homepage/rss2.0.xml';
const origin='https://www.repubblica.it';
const decode=value=>value.replace(/^<!\[CDATA\[([\s\S]*)\]\]>$/u,'$1').replace(/&amp;/gu,'&').replace(/&quot;/gu,'"').replace(/&#39;/gu,"'").replace(/&lt;/gu,'<').replace(/&gt;/gu,'>').trim();
const tag=(value,name)=>decode(value.match(new RegExp('<'+name+'(?:\\s[^>]*)?>([\\s\\S]*?)<\\/'+name+'>','iu'))?.[1]??'');
async function bounded(url,max){
 const target=new URL(url);if(target.origin!==origin||target.username||target.password)throw Error('ORIGIN');
 const response=await fetch(target,{redirect:'error',headers:{'user-agent':'DLKT source verification (+https://www.dlkt.ee/sources)','accept':'application/rss+xml,application/xml,text/html'},signal:AbortSignal.timeout(15000)});
 if(!response.ok)throw Error('HTTP_'+response.status);
 const reader=response.body.getReader();let size=0,body='';
 const decoder=new TextDecoder();for(;;){const x=await reader.read();if(x.done)break;size+=x.value.length;if(size>max){await reader.cancel();throw Error('SIZE');}body+=decoder.decode(x.value,{stream:true});}
 body+=decoder.decode();return{body,status:response.status,type:response.headers.get('content-type'),bytes:size};
}
const feed=await bounded(feedUrl,524288);
const items=[...feed.body.matchAll(/<item(?:\s[^>]*)?>([\s\S]*?)<\/item>/giu)].map(x=>x[1]);
const channel=feed.body.split(/<item\b/iu)[0];
const candidates=items.map(x=>({title:tag(x,'title'),url:tag(x,'link'),publishedAt:tag(x,'pubDate'),category:tag(x,'category')})).filter(x=>{try{const u=new URL(x.url);return u.origin===origin&&/^\/(?:politica|cronaca|esteri|economia|sport|spettacoli|scienze|tecnologia|salute|green-and-blue|italian-tech)\//u.test(u.pathname);}catch{return false;}}).slice(0,2);
console.log('DLKT_SOURCE_RECEIPT '+JSON.stringify({checkedAt:new Date().toISOString(),feed:{url:feedUrl,status:feed.status,type:feed.type,bytes:feed.bytes,title:tag(channel,'title'),home:tag(channel,'link'),language:tag(channel,'language'),lastBuildDate:tag(channel,'lastBuildDate'),itemCount:items.length},candidates}));
const attrs=html=>Object.fromEntries([...html.matchAll(/([\w:-]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/gu)].map(x=>[x[1].toLowerCase(),decode(x[2]??x[3])]));
for(const candidate of candidates){
 try{
 const article=await bounded(candidate.url,2097152);
 const metas=[...article.body.matchAll(/<meta\b[^>]*>/giu)].map(x=>attrs(x[0]));
 const links=[...article.body.matchAll(/<link\b[^>]*>/giu)].map(x=>attrs(x[0]));
 const pick=name=>metas.find(x=>x.property===name||x.name===name)?.content??null;
 const json=[];
 const visit=(value,depth=0)=>{if(depth>8||value===null||typeof value!=='object')return;if(Array.isArray(value)){for(const x of value.slice(0,30))visit(x,depth+1);return;}
 const type=value['@type'];if((typeof type==='string'?/Article$/u.test(type):Array.isArray(type)&&type.some(t=>typeof t==='string'&&/Article$/u.test(t))))json.push({type,headline:value.headline,datePublished:value.datePublished,dateModified:value.dateModified,url:value.url,mainEntityOfPage:value.mainEntityOfPage,articleSection:value.articleSection,keywords:value.keywords,image:value.image,creditText:value.creditText});
 if(value['@graph'])visit(value['@graph'],depth+1);};
 for(const match of article.body.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/giu)){try{visit(JSON.parse(match[1]));}catch{}}
 console.log('DLKT_ARTICLE_RECEIPT '+JSON.stringify({url:candidate.url,status:article.status,type:article.type,bytes:article.bytes,canonical:links.find(x=>x.rel==='canonical')?.href??null,htmlLanguage:article.body.match(/<html\b[^>]*\blang=["']([^"']+)/iu)?.[1]??null,title:pick('og:title'),publishedAt:pick('article:published_time'),image:pick('og:image'),imageAlt:pick('og:image:alt'),articleSection:pick('article:section'),jsonLd:json.slice(0,4)}));
 }catch(error){console.log('DLKT_ARTICLE_RECEIPT '+JSON.stringify({url:candidate.url,error:String(error)}));}
}
if(candidates.length!==2)throw Error('SOURCE_RECEIPT_INCOMPLETE');
