import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {resolvePublicNewsTranslation,acceptNewsTranslationProjection,NEWS_TRANSLATION_VERSION} from '../.build/src/iceo/news-translation.js';
import {createNewsCorpusStore} from '../.build/src/iceo/news-corpus-store.js';
import {cardContent} from '../.build/src/iceo/card-validation.js';
import {validArchiveCard} from '../.build/src/share/archive.js';
import {ICEO_SOURCES} from '../.build/src/iceo/registry.js';
import {newsCategory} from '../.build/src/iceo/news-taxonomy.js';
import {newsCard} from '../.build/src/local/service.js';
import {NOW,article,local} from './fixtures/news-corpus.mjs';

const hash=value=>createHash('sha256').update(JSON.stringify(value),'utf8').digest('hex');
const withText=(card,fields)=>{const result={...card,...fields};result.contentHash=hash(cardContent(result));return result;};

const summaryArticle=(id,fields={})=>{
 const source=ICEO_SOURCES.find(entry=>entry.id==='nasa-news'),url='https://www.nasa.gov/news-release/controlled-translation-'+id+'/';
 assert.ok(source);
 const card=withText({...article(id),id:hash(url).slice(0,24),identity:url,sourceUrl:url,publisher:source.publisher,
  sourceIds:[source.id],topic:source.topic,boundary:source.feed.boundary,attribution:source.attribution},fields);
 assert.ok(validArchiveCard(card),'Summary fixture must satisfy the unchanged reviewed-source policy');return card;
};

const globalItem=card=>({kind:'global',key:'article:'+card.id,category:newsCategory(card),card});
const localItem=entry=>{const card=newsCard(entry.snapshot.articles[0],entry.city);return {kind:'local',key:'local:'+card.id,category:newsCategory(card),card};};
const reference=item=>({id:item.card.id,revision:item.kind==='global'?item.card.contentHash:item.card.news.documentHash,
 ...(item.kind==='local'?{cityId:item.card.news.cityId}:{})});
const request=(item,extra={})=>({reference:reference(item),epoch:'1',targetLocale:'ro',translatorVersion:'fixture-v1',...extra});
const storeFor=item=>({calls:[],async lookup(ref,epoch){this.calls.push({reference:structuredClone(ref),epoch});return item;}});
const candidate=(resolved,translated={title:'Titlu tradus'})=>({
 version:NEWS_TRANSLATION_VERSION,key:resolved.key,original:{...resolved.original},
 sourceLanguage:resolved.sourceLanguage,targetLocale:resolved.targetLocale,translatorVersion:resolved.translatorVersion,translated,
});

test('only exact committed public references resolve and output contains publisher fields without mutating originals',async()=>{
 const card=summaryArticle(801,{title:'A public research result',summary:'An exact publisher excerpt.'});
 const item=globalItem(card),before=structuredClone(item),store=storeFor(item),query=request(item);
 const resolved=await resolvePublicNewsTranslation(store,query,()=>NOW);
 assert.ok(resolved);assert.deepEqual(store.calls,[{reference:reference(item),epoch:'1'}]);
 assert.deepEqual(resolved.fields,{title:card.title,summary:card.summary});
 assert.deepEqual(resolved.original,{kind:'global',id:card.id,identity:card.identity,revision:card.contentHash,
  fieldsHash:hash([NEWS_TRANSLATION_VERSION,'public-fields',card.title,card.summary])});
 assert.deepEqual(item,before);assert.ok(Object.isFrozen(resolved)&&Object.isFrozen(resolved.fields)&&Object.isFrozen(resolved.original));
 assert.deepEqual(Object.keys(resolved.fields),['title','summary']);
 for(const privateKey of ['profile','email','ownerId','preferences','sourceUrl','publisher','date'])assert.equal(Object.hasOwn(resolved.fields,privateKey),false);
});

test('malformed references, arbitrary text, private fields and unknown locale/epoch are rejected before any source lookup',async()=>{
 const item=globalItem(article(802)),store=storeFor(item),good=request(item);
 const invalid=[
  null,[],{}, {...good,title:'User supplied text'}, {...good,profile:{email:'private@example.invalid'}},
  {...good,reference:{...good.reference,text:'Do not translate me'}}, {...good,reference:{...good.reference,id:'bad'}},
  {...good,reference:{...good.reference,revision:'a'.repeat(63)}}, {...good,reference:{...good.reference,cityId:'999999999999'}},
  {...good,reference:{...good.reference,cityId:undefined}}, {...good,epoch:'0'}, {...good,epoch:'1.0'},
  {...good,targetLocale:'ro-RO'}, {...good,targetLocale:'not-supported'}, {...good,translatorVersion:''},
  {...good,translatorVersion:'https://untrusted.invalid'}, {...good,translatorVersion:'x'.repeat(81)},
 ];
 for(const input of invalid)await assert.rejects(resolvePublicNewsTranslation(store,input,()=>NOW),error=>error.code==='NEWS_TRANSLATION_REQUEST_INVALID');
 await assert.rejects(resolvePublicNewsTranslation(store,good,()=>NaN),/NEWS_TRANSLATION_REQUEST_INVALID/);
 assert.equal(store.calls.length,0);
});

test('local translation uses source summary only and never invents the platform fallback as a description',async()=>{
 const entry=local(1),item=localItem(entry),before=structuredClone(item),store=storeFor(item);
 const resolved=await resolvePublicNewsTranslation(store,request(item),()=>NOW);
 assert.ok(resolved);assert.match(item.card.text,/Read the publisher report/);
 assert.deepEqual(resolved.fields,{title:item.card.news.title});assert.equal(Object.hasOwn(resolved.fields,'summary'),false);
 assert.equal(resolved.original.identity,item.card.sourceUrl);assert.equal(resolved.original.revision,item.card.news.documentHash);
 assert.deepEqual(item,before);
 const withSummary=structuredClone(entry);withSummary.snapshot.articles[0].summary='Descrierea exacta a editorului.';
 const summaryItem=localItem(withSummary),summaryResolved=await resolvePublicNewsTranslation(storeFor(summaryItem),request(summaryItem),()=>NOW);
 assert.deepEqual(summaryResolved.fields,{title:summaryItem.card.news.title,summary:'Descrierea exacta a editorului.'});
 assert.notEqual(summaryResolved.key,resolved.key);
 assert.notEqual(summaryResolved.original.fieldsHash,resolved.original.fieldsHash);
});

test('missing originals return no input; backend errors and invalid public records do not leak source details',async()=>{
 const item=globalItem(article(803)),query=request(item);
 assert.equal(await resolvePublicNewsTranslation(storeFor(null),query,()=>NOW),null);
 await assert.rejects(resolvePublicNewsTranslation({async lookup(){throw Error('private upstream credential');}},query,()=>NOW),
  error=>error.message==='NEWS_TRANSLATION_SOURCE_UNAVAILABLE'&&!error.message.includes('credential'));
 for(const bad of [
  {...item,card:{...item.card,privateToken:'secret'}},
  {...item,card:{...item.card,title:'Changed without content digest'}},
  globalItem(article(804)),
  {...item,card:{...item.card,sourceUrl:'https://unknown.invalid/story'}},
 ]){
  await assert.rejects(resolvePublicNewsTranslation(storeFor(bad),query,()=>NOW),/NEWS_TRANSLATION_SOURCE_UNAVAILABLE/);
 }
 const expired=globalItem(article(805,{observed:NOW-3599995}));let now=NOW;
 const delayed={async lookup(){now+=6;return expired;}};
 await assert.rejects(resolvePublicNewsTranslation(delayed,request(expired),()=>now),/NEWS_TRANSLATION_SOURCE_UNAVAILABLE/);
});

test('cache identity is exact across content, target and translator changes but reusable across valid epochs',async()=>{
 const item=globalItem(summaryArticle(806,{summary:'A source excerpt'})),store=storeFor(item);
 const first=await resolvePublicNewsTranslation(store,request(item),()=>NOW);
 const second=await resolvePublicNewsTranslation(store,request(item,{epoch:'2'}),()=>NOW);
 assert.equal(first.key,second.key);
 assert.notEqual(first.key,(await resolvePublicNewsTranslation(store,request(item,{targetLocale:'en'}),()=>NOW)).key);
 assert.notEqual(first.key,(await resolvePublicNewsTranslation(store,request(item,{translatorVersion:'fixture-v2'}),()=>NOW)).key);
 const changed=globalItem(withText(item.card,{summary:'A source excerpt '}));
 const next=await resolvePublicNewsTranslation(storeFor(changed),request(changed),()=>NOW);
 assert.notEqual(first.key,next.key);assert.notEqual(first.original.fieldsHash,next.original.fieldsHash);
 const other=globalItem(summaryArticle(807,{title:item.card.title,summary:item.card.summary}));
 const otherResolved=await resolvePublicNewsTranslation(storeFor(other),request(other),()=>NOW);
 assert.equal(first.original.fieldsHash,otherResolved.original.fieldsHash);assert.notEqual(first.key,otherResolved.key);
 const expected=hash([NEWS_TRANSLATION_VERSION,first.original.kind,first.original.id,first.original.identity,first.original.revision,
  first.original.fieldsHash,first.sourceLanguage,first.targetLocale,first.translatorVersion]);
 assert.equal(first.key,expected);
});

test('projection acceptance requires an issued immutable resolution and rechecks its committed original',async()=>{
 const item=globalItem(article(808)),before=structuredClone(item),store=storeFor(item);
 const resolved=await resolvePublicNewsTranslation(store,request(item),()=>NOW),value=candidate(resolved);
 assert.equal(await acceptNewsTranslationProjection({...resolved},value),null);assert.equal(store.calls.length,1);
 const accepted=await acceptNewsTranslationProjection(resolved,value);
 assert.ok(accepted);assert.equal(store.calls.length,2);assert.deepEqual(accepted,value);
 assert.notEqual(accepted,value);assert.notEqual(accepted.translated,value.translated);
 assert.ok(Object.isFrozen(accepted)&&Object.isFrozen(accepted.translated)&&Object.isFrozen(accepted.original));
 value.translated.title='Mutated adapter result';value.original.identity='mutated';
 assert.equal(accepted.translated.title,'Titlu tradus');assert.equal(accepted.original.identity,item.card.identity);
 assert.deepEqual(item,before);
});

test('wrong binding, incomplete or extra translated fields and excessive text fail before further source calls',async()=>{
 const item=globalItem(summaryArticle(809,{summary:'Source summary.'})),store=storeFor(item);
 const resolved=await resolvePublicNewsTranslation(store,request(item),()=>NOW);
 const good=candidate(resolved,{title:'Titlu tradus',summary:'Descriere tradusa'});
 const invalid=[
  null,[],{}, {...good,version:'other'}, {...good,key:'a'.repeat(64)}, {...good,targetLocale:'en'},
  {...good,sourceLanguage:'unknown'}, {...good,translatorVersion:'fixture-v2'}, {...good,privateToken:'secret'},
  ...['kind','id','identity','revision','fieldsHash'].map(key=>({...good,original:{...good.original,[key]:'wrong'}})),
  {...good,original:{...good.original,sourceUrl:item.card.sourceUrl}},
  {...good,translated:{title:'Title only'}}, {...good,translated:{summary:'Summary only'}},
  {...good,translated:{...good.translated,privateText:'hidden'}}, {...good,translated:{title:' ',summary:'Valid'}},
  {...good,translated:{title:'x'.repeat(8001),summary:'Valid'}}, {...good,translated:{title:'Valid',summary:'x'.repeat(4001)}},
  {...good,translated:{title:'Valid',summary:''}}, {...good,translated:{title:'Line\nbreak',summary:'Valid'}},
 ];
 for(const value of invalid)assert.equal(await acceptNewsTranslationProjection(resolved,value),null);
 assert.equal(store.calls.length,1);assert.ok(await acceptNewsTranslationProjection(resolved,good));
});

test('a title-only original cannot acquire an invented summary in a translation projection',async()=>{
 const item=globalItem(article(810)),store=storeFor(item),resolved=await resolvePublicNewsTranslation(store,request(item),()=>NOW);
 assert.equal(await acceptNewsTranslationProjection(resolved,candidate(resolved,{title:'Titlu',summary:'Invented'})),null);
 assert.equal(await acceptNewsTranslationProjection(resolved,candidate(resolved,{title:'Titlu',summary:undefined})),null);
 assert.equal(store.calls.length,1);
 assert.ok(await acceptNewsTranslationProjection(resolved,candidate(resolved)));
});

test('withdrawn, changed or expired originals and store failures invalidate otherwise correctly bound results',async()=>{
 for(const mode of ['missing','changed','expired','failure']){
  const item=globalItem(article(811,{observed:NOW-3599995}));let calls=0,now=NOW;
  const store={async lookup(){calls++;
   if(calls>1){if(mode==='missing')return null;if(mode==='failure')throw Error('private backend failure');
    if(mode==='changed')return globalItem(withText(item.card,{title:'Updated source title'}));if(mode==='expired')now+=6;}
   return item;
  }};
  const resolved=await resolvePublicNewsTranslation(store,request(item),()=>now);
  assert.ok(resolved);assert.equal(await acceptNewsTranslationProjection(resolved,candidate(resolved)),null);assert.equal(calls,2);
 }
});

test('request and result ownership cannot be changed while their source lookups are pending',async()=>{
 const item=globalItem(article(812));let release;
 const barrier=new Promise(resolve=>{release=resolve;}),seen=[];
 const store={async lookup(ref,epoch){seen.push({ref:structuredClone(ref),epoch});await barrier;return item;}};
 const query=request(item),pending=resolvePublicNewsTranslation(store,query,()=>NOW);
 query.reference.id='b'.repeat(24);query.epoch='2';query.targetLocale='en';
 release();const resolved=await pending;
 assert.ok(resolved);assert.equal(resolved.targetLocale,'ro');assert.equal(resolved.original.id,item.card.id);assert.equal(seen[0].epoch,'1');
 let releaseAgain;const secondBarrier=new Promise(resolve=>{releaseAgain=resolve;});let calls=0;
 const secondStore={async lookup(){calls++;if(calls>1)await secondBarrier;return item;}};
 const second=await resolvePublicNewsTranslation(secondStore,request(item),()=>NOW),result=candidate(second);
 const accepting=acceptNewsTranslationProjection(second,result);
 result.translated.title='Changed after validation';result.targetLocale='en';result.original.identity='changed';
 releaseAgain();const accepted=await accepting;
 assert.equal(accepted.translated.title,'Titlu tradus');assert.equal(accepted.targetLocale,'ro');assert.equal(accepted.original.identity,item.card.identity);
});

test('markup-like translations remain bounded plain data without parsing, interpolation or DOM execution',async()=>{
 const item=globalItem(article(813)),resolved=await resolvePublicNewsTranslation(storeFor(item),request(item),()=>NOW);
 const literal='<img src=x onerror=alert(1)> & <b>literal news text</b>';
 const accepted=await acceptNewsTranslationProjection(resolved,candidate(resolved,{title:literal}));
 assert.equal(accepted.translated.title,literal);
 assert.deepEqual(Object.keys(accepted.translated),['title']);
});

test('the existing concrete corpus adapter supplies exact public versions and can revoke them before acceptance',async()=>{
 const card=summaryArticle(814,{summary:'Published source excerpt.'}),item=globalItem(card),calls=[];
 const environment={DLKT_INFO_SUPABASE_PROJECT_REF:'a'.repeat(20),DLKT_INFO_SUPABASE_URL:'https://'+'a'.repeat(20)+'.supabase.co',
  DLKT_INFO_SUPABASE_PUBLISHABLE_KEY:'sb_publishable_'+'b'.repeat(30),DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY:'test-only-corpus-write-key-123456789012345678901234567890'};
 const store=createNewsCorpusStore(environment,async(url,init)=>{
  calls.push({url:String(url),args:JSON.parse(init.body)});
  return new Response(JSON.stringify(calls.length===1?{kind:'global',card}:null),{headers:{'content-type':'application/json'}});
 },()=>NOW);
 const resolved=await resolvePublicNewsTranslation(store,request(item),()=>NOW);
 assert.deepEqual(resolved.fields,{title:card.title,summary:card.summary});
 assert.equal(await acceptNewsTranslationProjection(resolved,candidate(resolved,{title:'Titlu',summary:'Descriere'})),null);
 assert.equal(calls.length,2);assert.ok(calls.every(call=>call.url.endsWith('/dlkt_info_find_news_corpus_article')));
 assert.ok(calls.every(call=>call.args.p_id===card.id&&call.args.p_revision===card.contentHash&&call.args.p_epoch===1));
 assert.equal(JSON.stringify(resolved).includes(environment.DLKT_INFO_SHARE_ARCHIVE_WRITE_KEY),false);
});

test('request accessors and throwing proxies cannot change validated source authority or locale',async()=>{
 const item=globalItem(article(815)),store=storeFor(item),good=request(item);let reads=0;
 const changing={...good,get targetLocale(){reads++;return reads===1?'ro':'not-supported';}};
 await assert.rejects(resolvePublicNewsTranslation(store,changing,()=>NOW),/NEWS_TRANSLATION_REQUEST_INVALID/);
 const nested={...good,reference:{...good.reference,get id(){reads++;return item.card.id;}}};
 await assert.rejects(resolvePublicNewsTranslation(store,nested,()=>NOW),/NEWS_TRANSLATION_REQUEST_INVALID/);
 const proxy=new Proxy(good,{ownKeys(){throw Error('private proxy detail');}});
 await assert.rejects(resolvePublicNewsTranslation(store,proxy,()=>NOW),error=>error.message==='NEWS_TRANSLATION_REQUEST_INVALID');
 assert.equal(reads,0);assert.equal(store.calls.length,0);
});
test('provider accessors cannot substitute unvalidated title types or invent descriptions during copying',async()=>{
 const item=globalItem(article(816)),store=storeFor(item),resolved=await resolvePublicNewsTranslation(store,request(item),()=>NOW);
 const good=candidate(resolved);let reads=0;
 const changing={...good,get translated(){reads++;return reads<=2?{title:'Valid'}:{title:123,summary:'invented'};}};
 assert.equal(await acceptNewsTranslationProjection(resolved,changing),null);
 const nested={...good,translated:{get title(){reads++;return 'Valid';}}};
 assert.equal(await acceptNewsTranslationProjection(resolved,nested),null);
 const proxy=new Proxy(good,{getOwnPropertyDescriptor(){throw Error('private proxy detail');}});
 assert.equal(await acceptNewsTranslationProjection(resolved,proxy),null);
 assert.equal(reads,0);assert.equal(store.calls.length,1);
});
test('a news-index original with an invented publisher summary remains ineligible',async()=>{
 const original=article(817),forged=withText(original,{summary:'Invented publisher excerpt'}),item=globalItem(forged);
 assert.equal(validArchiveCard(forged),false);
 await assert.rejects(resolvePublicNewsTranslation(storeFor(item),request(item),()=>NOW),/NEWS_TRANSLATION_SOURCE_UNAVAILABLE/);
});
