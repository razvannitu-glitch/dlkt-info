import test from 'node:test';
import assert from 'node:assert/strict';
import {parseDocument,DomUtils} from 'htmlparser2';
import {handleCard} from '../.build/api/card.js';
import {KNOWLEDGE_CARDS} from '../.build/src/iceo/knowledge-catalog.js';
import {knowledgeCardLink,knowledgeReferencePath,parseKnowledgeCardReference,parseCardReference,parseCardImageReference,knowledgeShareEligible} from '../.build/src/share/link.js';
import {knowledgeShareDestinations} from '../.build/src/share/actions.js';
import {resolveKnowledgeShare} from '../.build/src/share/knowledge-resolution.js';
import {renderSharedKnowledgeCard} from '../.build/src/share/render.js';
import {knowledgeRightsCandidates} from './fixtures/knowledge-rights-candidates.mjs';

const helsinki=KNOWLEDGE_CARDS.find(card=>card.id==='dlkt-elsewhere-helsinki-shared-workshop');
const paris=KNOWLEDGE_CARDS.find(card=>card.id==='dlkt-elsewhere-paris-schoolyard-oasis');
const now=Date.parse('2026-11-26T12:00:00.000Z');
const reference={id:helsinki.id,revision:helsinki.revision,language:'en'};
const path=knowledgeReferencePath(reference);
const find=(doc,name,attr,value)=>DomUtils.findOne(node=>node.name===name&&node.attribs?.[attr]===value,doc.children);
async function invoke({url=path,method='GET',at=now,clock=()=>at,headers={}}={}){
 let body='',loads=0,explanations=0,archiveReads=0,archiveWrites=0;const h={};
 const res={statusCode:200,setHeader(k,v){h[k.toLowerCase()]=v;},end(v=''){body=String(v);}};
 const archive={async read(){archiveReads++;throw Error('ARCHIVE_READ_FORBIDDEN');},async write(){archiveWrites++;throw Error('ARCHIVE_WRITE_FORBIDDEN');}};
 await handleCard({method,url,headers},res,async()=>{loads++;throw Error('LIVE_LOAD_FORBIDDEN');},async()=>{explanations++;throw Error('INSIGHT_FORBIDDEN');},clock,archive);
 assert.equal(loads+explanations+archiveReads+archiveWrites,0,'knowledge route must not touch news or archive services');
 return {status:res.statusCode,body,headers:h};
}

test('distinct exact references round-trip through direct and rewritten routes',()=>{
 for(const card of [helsinki,paris]){
  assert.ok(knowledgeShareEligible(card));
  for(const language of ['en','ro','it']){
   const ref={id:card.id,revision:card.revision,language},url=new URL(knowledgeCardLink({...card,privateQuery:'secret'},language));
   assert.equal(url.origin,'https://www.dlkt.ee');assert.equal(url.hash,'');
   assert.deepEqual([...url.searchParams.keys()],['v','lang']);assert.ok(!url.href.includes('secret'));
   assert.deepEqual(parseKnowledgeCardReference(url.pathname+url.search),ref);
   assert.deepEqual(parseKnowledgeCardReference('/api/card?lang='+language+'&id='+card.id+'&v='+card.revision),ref);
   assert.equal(parseCardReference(url.pathname+url.search),null);
   assert.equal(parseCardImageReference('/api/card-image?id='+card.id+'&v='+card.revision),null);
  }
 }
 const news='/card/'+'a'.repeat(24)+'?v='+'b'.repeat(64);
 assert.equal(parseKnowledgeCardReference(news),null);assert.ok(parseCardReference(news));
 assert.throws(()=>knowledgeCardLink(KNOWLEDGE_CARDS[0],'en'),/KNOWLEDGE_SHARE_CARD_INVALID/);
 assert.throws(()=>knowledgeReferencePath({...reference,revision:0}),/KNOWLEDGE_SHARE_REFERENCE_INVALID/);
});

test('malformed references are rejected without source requests or private data',async()=>{
 for(const url of [
  'https://www.dlkt.ee'+path,'//evil.example'+path,path+'#private',path+'&q=private',path+'&lang=ro',path+'&id='+reference.id,
  path.replace('lang=en','lang=de'),path.replace('v=2','v=02'),path.replace('v=2','v=0'),path.replace('v=2','v=9007199254740992'),
  path.replace('v=2','v=2.0'),path.replace('lang=en','lang=%65n'),path.replace('/card/','/card/../card/'),path+'&',
  '/api/card?lang=en&v=2','/api/card?id='+reference.id+'&id='+reference.id+'&v=2&lang=en','/card/'+reference.id,
  '/card/'+reference.id+'?v=2&lang=en%00','/card/'+reference.id+'?v=2&lang=en&url=https://evil.example',
 ]){
  assert.equal(parseKnowledgeCardReference(url),null,url);const r=await invoke({url});assert.equal(r.status,400,url);
  assert.doesNotMatch(r.body,/evil\.example|q=private/);
 }
});

test('server-rendered multilingual discovery has exact metadata and source even without a reading session',async()=>{
 for(const card of [helsinki,paris])for(const language of ['en','ro','it']){
  const url=new URL(knowledgeCardLink(card,language)),r=await invoke({url:url.pathname+url.search,headers:{host:'evil.example','x-forwarded-host':'evil.example',cookie:'private-session'}});
  assert.equal(r.status,200);const doc=parseDocument(r.body),copy=card.copy[language];
  assert.equal(find(doc,'html','lang',language)?.attribs.lang,language);
  assert.equal(find(doc,'meta','property','og:title').attribs.content,copy.title);
  assert.equal(find(doc,'meta','property','og:description').attribs.content,copy.explanation);
  assert.equal(find(doc,'meta','property','og:url').attribs.content,url.href);
  assert.equal(find(doc,'link','rel','canonical').attribs.href,url.href);
  assert.equal(find(doc,'meta','name','twitter:card').attribs.content,'summary');
  assert.equal(find(doc,'meta','property','og:image'),null);
  assert.ok(DomUtils.textContent(doc).includes(copy.explanation));assert.ok(DomUtils.textContent(doc).includes(copy.connection));
  assert.ok(DomUtils.textContent(doc).includes(card.geography.label[language]));
  assert.ok(find(doc,'a','href',card.source.url));assert.ok(find(doc,'time','datetime',card.reviewedAt));assert.ok(find(doc,'time','datetime',card.reviewBy));
  assert.equal(find(doc,'p','id','shared-freshness').attribs['data-valid-until'],String(Date.parse(card.reviewBy)));
  assert.ok(find(doc,'p','id','shared-freshness').attribs['data-expired-message']);
  assert.equal(find(doc,'button','id','shared-copy').attribs['data-card-url'],url.href);
  assert.ok(!r.body.includes('evil.example'));assert.ok(!r.body.includes('private-session'));assert.equal(r.headers['set-cookie'],undefined);
  assert.equal(r.headers['cache-control'],'no-store');assert.equal(r.headers['x-robots-tag'],'noindex, nofollow');
  assert.match(r.headers['content-security-policy'],/default-src 'none'/);
 }
});

test('sharing choices reuse existing social destinations with only the public exact link',async()=>{
 const expected=[['https://www.facebook.com','u'],['https://x.com','url'],['https://www.threads.com','text']];
 const url=knowledgeCardLink(helsinki,'en'),r=await invoke(),doc=parseDocument(r.body);
 const choices=knowledgeShareDestinations({...helsinki,privateQuery:'secret'},'en');
 choices.forEach((choice,i)=>{
  const target=new URL(choice.href),[origin,key]=expected[i];assert.equal(target.origin,origin);
  assert.deepEqual([...target.searchParams.keys()],[key]);assert.equal(target.searchParams.get(key),url);
  const a=find(doc,'a','href',choice.href);assert.equal(a.attribs.target,'_blank');assert.equal(a.attribs.rel,'noopener noreferrer');
 });
 assert.doesNotMatch(r.body,/widgets\.js|platform\.twitter|connect\.facebook|Download share image/);
});

test('unknown, superseded, future, expired and rights-pending references never substitute content',async()=>{
 for(const [url,at] of [
  [path.replace('v=2','v=1'),now],
  [path,Date.parse(helsinki.publishAt)-1],
  [path,Date.parse(helsinki.reviewBy)],
  [knowledgeReferencePath({...reference,id:'dlkt-elsewhere-unlisted'}),now],
  ...knowledgeRightsCandidates.map(card=>[new URL(knowledgeCardLink(card,'en')).pathname+new URL(knowledgeCardLink(card,'en')).search,Date.parse('2026-11-27T12:00:00Z')]),
 ]){
  const r=await invoke({url,at});assert.equal(r.status,404,url);
  assert.match(r.body,/No other information has been substituted/);
  assert.ok(!r.body.includes(helsinki.copy.en.title));assert.ok(!r.body.includes(paris.copy.en.title));
  assert.ok(!find(parseDocument(r.body),'article','data-shared-knowledge-id',helsinki.id));
 }
 const before=Date.parse(helsinki.reviewBy)-1,after=before+1;
 let count=0;assert.equal((await invoke({clock:()=>count++===0?before:after})).status,404);
 assert.equal(await resolveKnowledgeShare(reference,Date.parse(helsinki.reviewBy)),null);
});

test('HTTP HEAD and invalid methods retain existing public route boundaries',async()=>{
 const head=await invoke({method:'HEAD'});assert.equal(head.status,200);assert.equal(head.body,'');
 const post=await invoke({method:'POST'});assert.equal(post.status,405);assert.equal(post.headers.allow,'GET, HEAD');
 const rewritten=await invoke({url:'/api/card?id='+reference.id+'&v='+reference.revision+'&lang=en'});assert.equal(rewritten.status,200);
 assert.equal(rewritten.body,(await invoke()).body);
});

test('licensed lab renderer preserves exact attribution while fixtures stay outside the actual public resolver',async()=>{
 for(const card of knowledgeRightsCandidates)for(const language of ['en','ro','it']){
  const html=renderSharedKnowledgeCard({card,language,validUntil:Date.parse(card.reviewBy)}),doc=parseDocument(html);
  assert.ok(find(doc,'a','href','https://creativecommons.org/licenses/by/4.0/'));
  assert.ok(find(doc,'a','href',card.source.url));
  assert.match(DomUtils.textContent(doc),/©/);
  assert.match(find(doc,'meta','property','og:description').attribs.content,/CC BY 4\.0/);
  assert.equal(await resolveKnowledgeShare({id:card.id,revision:card.revision,language},Date.parse(card.publishAt)),null);
 }
});
