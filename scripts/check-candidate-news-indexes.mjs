import {XMLParser,XMLValidator} from 'fast-xml-parser';
import {readNewsArticleMetadata,validateNewsCandidate} from '../source/.build/src/iceo/news-discovery.js';
import {classifyNewsHeadline} from '../source/.build/src/iceo/editorial-categories.js';
const urls=['https://www.france24.com/en/rss','https://www.dw.com/ro/news-sitemap.xml','https://www.dw.com/de/news-sitemap.xml','https://www.dw.com/fr/news-sitemap.xml','https://www.dw.com/es/news-sitemap.xml','https://www.dw.com/ar/news-sitemap.xml'];
const blocked=new Set(),now=Date.now();
async function read(url){
 const origin=new URL(url).origin;if(blocked.has(origin))return {status:'not_run_origin_denied'};
 const response=await fetch(url,{redirect:'manual',signal:AbortSignal.timeout(6000),headers:{Accept:'application/rss+xml, application/xml, text/html;q=0.5','User-Agent':'DLKT-Info/0.9.46 (+https://www.dlkt.ee/sources)'}});
 if([401,402,403,429].includes(response.status))blocked.add(origin);
 if(!response.ok){await response.body?.cancel();return {status:response.status};}
 if(!response.body)return{status:'empty'};
 const reader=response.body.getReader();let bytes=0,text='';const decoder=new TextDecoder();
 try{for(;;){const part=await reader.read();if(part.done)break;bytes+=part.value.byteLength;if(bytes>1048576)throw Error('TOO_LARGE');text+=decoder.decode(part.value,{stream:true});}text+=decoder.decode();}finally{await reader.cancel();}
 return {status:response.status,text};
}
const output=[];
for(const url of urls){
 try{
  const response=await read(url);if(!response.text){output.push({url,status:response.status});continue;}
  if(/<!\s*(?:DOCTYPE|ENTITY)/iu.test(response.text)||XMLValidator.validate(response.text)!==true){output.push({url,status:response.status,xml:false});continue;}
  const xml=new XMLParser({ignoreAttributes:false,removeNSPrefix:true,parseTagValue:false,trimValues:true}).parse(response.text);
  const channel=xml.rss?.channel;const entries=channel?[channel.item??[]].flat():[xml.urlset?.url??[]].flat();
  const records=entries.flatMap(item=>{const title=channel?item.title:item.news?.title,sourceUrl=channel?item.link:item.loc,date=channel?item.pubDate:item.news?.publication_date,language=channel?channel.language:item.news?.publication?.language;return typeof title==='string'&&typeof sourceUrl==='string'? [{title,sourceUrl,date,language}]:[];});
  const current=records.filter(item=>Number.isFinite(Date.parse(item.date))&&Date.parse(item.date)>now-86400000&&Date.parse(item.date)<=now+300000);
  const sample=current.find(item=>new URL(item.sourceUrl).origin===new URL(url).origin);
  let article=null;
  if(sample){const publisher=new URL(url).hostname==='www.dw.com'?'DW':'France 24',candidate=validateNewsCandidate({sourceUrl:sample.sourceUrl,title:sample.title,publisher,indexedAt:new Date(now).toISOString(),category:classifyNewsHeadline(sample.title,sample.sourceUrl)},now);if(candidate){const response=await read(candidate.sourceUrl);article={url:candidate.sourceUrl,status:response.status,verified:response.text?readNewsArticleMetadata(response.text,candidate,candidate.sourceUrl,now)!==null:false};}}
  output.push({url,status:response.status,xml:true,feedTitle:channel?.title??null,feedHome:channel?.link??null,feedLanguage:channel?.language??null,records:records.length,current:current.length,languages:[...new Set(records.map(r=>r.language))],sample:sample??null,article});
 }catch(error){output.push({url,error:error instanceof Error?error.message:'UNKNOWN'});}
}
console.log('DLKT_NEWS_INDEX_PROBE '+JSON.stringify({checkedAt:new Date(now).toISOString(),sourceCommit:process.env.GITHUB_SHA,results:output}));
