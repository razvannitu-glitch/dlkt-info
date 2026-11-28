import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {parseDocument,DomUtils} from 'htmlparser2';
import {resolve} from 'node:path';
import {pathToFileURL} from 'node:url';

export const KNOWLEDGE_ORIGIN='https://www.dlkt.ee';
const evidence=JSON.parse(readFileSync(new URL('../source/tests/evidence/nsw-fuelcheck-admission-20261126.json',import.meta.url),'utf8'));
const id='dlkt-elsewhere-nsw-fuelcheck';
const digest=evidence.candidateDigest, revision=evidence.revision;
const decision=evidence.decisions.filter(item=>item.scope==='standalone');
const reviewedAt=Date.parse(evidence.reviewedAt);
const expiresAt=Math.min(Date.parse(evidence.reviewBy),Date.parse(decision[0]?.expiresAt));
const source=evidence.observation.receipt.sourceUrl, terms=evidence.observation.receipt.policyUrl;
const labDigest=evidence.priorLabDigest;
const reviewedPacket=JSON.parse(readFileSync(new URL('../docs/evidence/nsw-fuelcheck-admission-candidate-20261126.json',import.meta.url),'utf8'));
const reviewedCard=reviewedPacket.card,reviewedRights=reviewedPacket.rights;
const reviewedLanguages=Object.freeze(['en','ro','it']);
const hash=value=>typeof value==='string'&&/^[a-f0-9]{64}$/u.test(value);
const requireIdentity=evidence.cardId===id&&revision===1&&hash(digest)&&hash(labDigest)&&digest!==labDigest
  &&decision.length===1&&decision[0].id===id&&decision[0].revision===revision&&decision[0].digest===digest
  &&decision[0].decision==='permit-on-verified-release'&&Number.isFinite(reviewedAt)&&expiresAt>reviewedAt
  &&source.startsWith('https://www.nsw.gov.au/')&&terms.startsWith('https://www.nsw.gov.au/');
if(!requireIdentity)throw Error('DLKT_LIVE_KNOWLEDGE_IDENTITY');
// The oracle comes from the independently reviewed, committed wording dossier,
// never from the HTTP response, current catalogue renderer or a fixture.
// Reproduce the versioned editorial tuple to bind every expected field to the
// existing admitted digest, not a mutable digest label on the HTML.
const reviewedPayload=JSON.stringify(['dlkt-knowledge-editorial-v1',reviewedCard.kind,reviewedCard.id,reviewedCard.revision,reviewedCard.category,
  reviewedCard.format??null,reviewedCard.calendarDay??null,reviewedCard.distribution??null,
  [reviewedCard.source.publisher,reviewedCard.source.url],
  [reviewedCard.geography.countryCode,[...reviewedCard.geography.cityIds],reviewedLanguages.map(language=>reviewedCard.geography.label[language])],
  reviewedLanguages.map(language=>[language,reviewedCard.topic[language],reviewedCard.copy[language].title,reviewedCard.copy[language].explanation,reviewedCard.copy[language].connection]),
  reviewedCard.reviewedAt,reviewedCard.publishAt??null,reviewedCard.reviewBy,
  [reviewedRights.credit,reviewedRights.licenseUrl,reviewedRights.policyUrl]]);
if(reviewedPacket.kind!=='dlkt-editorial-admission-candidate-not-authorized'||reviewedPacket.candidateDigest!==digest||
  reviewedCard.id!==id||reviewedCard.revision!==revision||reviewedCard.source.url!==source||
  reviewedRights.policyUrl!==terms||reviewedCard.reviewedAt!==evidence.reviewedAt||reviewedCard.reviewBy!==evidence.reviewBy||
  reviewedCard.geography.countryCode!=='AU'||reviewedCard.geography.cityIds.length!==0||
  createHash('sha256').update(reviewedPayload,'utf8').digest('hex')!==digest)
  throw Error('DLKT_LIVE_KNOWLEDGE_REVIEWED_PAYLOAD');
export const KNOWLEDGE_IDENTITY=Object.freeze({id,digest,labDigest,revision,reviewedAt,expiresAt,source,terms,
  license:'https://creativecommons.org/licenses/by/4.0/'});
const MAX_BYTES=128_000;
const TIMEOUT_MS=10_000;
const headers=['content-type','cache-control','set-cookie','x-content-type-options','x-robots-tag'];
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value);
const safeClock=now=>Number.isSafeInteger(now)&&now>=0;
const active=now=>now>=reviewedAt&&now<expiresAt;
const phase=now=>now<reviewedAt?'pre-review':active(now)?'active':'expired';
const commitHash=value=>typeof value==='string'&&/^[a-f0-9]{40}$/u.test(value);
const deploymentOrigin=/^https:\/\/dlkt-info-[a-z0-9]+-dlkt-group-ou\.vercel\.app$/u;
export function knowledgeProbeOptions({mode='monitor',origin=KNOWLEDGE_ORIGIN,expectedCommit='',expectedManifest=''}={}){
  if(mode==='monitor'&&origin===KNOWLEDGE_ORIGIN&&expectedCommit===''&&expectedManifest==='')return Object.freeze({mode,origin,expectedCommit,expectedManifest});
  if(mode==='recovery'&&typeof origin==='string'&&(origin===KNOWLEDGE_ORIGIN||deploymentOrigin.test(origin))&&commitHash(expectedCommit)&&hash(expectedManifest))
    return Object.freeze({mode,origin,expectedCommit,expectedManifest});
  throw Error('DLKT_LIVE_KNOWLEDGE_PROBE_OPTIONS');
}
export function readKnowledgeProbeOptions(env=process.env){
  return knowledgeProbeOptions({mode:env.DLKT_KNOWLEDGE_PROBE_MODE||'monitor',origin:env.DLKT_KNOWLEDGE_PROBE_ORIGIN||KNOWLEDGE_ORIGIN,
    expectedCommit:env.DLKT_KNOWLEDGE_EXPECTED_COMMIT||'',expectedManifest:env.DLKT_KNOWLEDGE_EXPECTED_MANIFEST||''});
}
// Explicit test oracle for the reviewed NSW attribution and translated controls.
const labels=Object.freeze({
  en:Object.freeze({adapted:'Original DLKT synthesis and translations',terms:'Source terms',copied:'DLKT card link copied.',origin:'Works elsewhere',use:'The useful bit',boundary:'This is a DLKT editorial synthesis, not a new live source check or proof of local availability. The exact link is available only during its current review window.'}),
  ro:Object.freeze({adapted:'Sinteza originala si traduceri DLKT',terms:'Termenii sursei',copied:'Linkul cardului DLKT a fost copiat.',origin:'Functioneaza in alta parte',use:'Ce merita retinut',boundary:'Aceasta este o sinteza editoriala DLKT, nu o noua verificare live a sursei sau o confirmare a disponibilitatii locale. Linkul exact este disponibil doar in perioada sa de verificare.'}),
  it:Object.freeze({adapted:'Sintesi originale e traduzioni DLKT',terms:'Condizioni della fonte',copied:'Link della scheda DLKT copiato.',origin:'Funziona altrove',use:'Da ricordare',boundary:'Questa è una sintesi editoriale DLKT, non una nuova verifica in tempo reale o una conferma della disponibilità locale. Il link esatto è disponibile solo durante il periodo di verifica corrente.'}),
});
function labelFor(language){
  if(!Object.hasOwn(labels,language))throw Error('DLKT_LIVE_KNOWLEDGE_LANGUAGE');
  return labels[language];
}
export const KNOWLEDGE_CREDIT='© State of New South Wales. For current information go to www.nsw.gov.au.';
export function knowledgeCreditText(language){
  const label=labelFor(language);
  return KNOWLEDGE_CREDIT+' · '+label.adapted+' · CC BY 4.0 · '+label.terms;
}
export function knowledgeCopyMessage(language){return labelFor(language).copied;}
export function knowledgeRenderedFields(language){
  const label=labelFor(language),copy=reviewedCard.copy[language];
  return Object.freeze({title:copy.title,explanation:copy.explanation,connection:label.use+': '+copy.connection,
    geography:label.origin+' · '+reviewedCard.geography.label[language],publisher:reviewedCard.source.publisher,boundary:label.boundary});
}
export function knowledgeEditorialFailures(language,fields){
  return Object.entries(knowledgeRenderedFields(language)).flatMap(([name,value])=>{
    const field=fields?.[name];
    return field?.count===1&&field.visible===true&&field.structure===true&&field.text===normalizeKnowledgeText(value)?[]:['editorial-'+name];
  });
}
export function knowledgeCanonicalUrl(language){labelFor(language);return KNOWLEDGE_ORIGIN+'/card/'+id+'?v='+revision+'&lang='+language+'&h='+digest;}
export const normalizeKnowledgeText=value=>typeof value==='string'?value.replace(/\s+/gu,' ').trim():'';
export function knowledgeCreditLinks(language){
  return [{href:KNOWLEDGE_IDENTITY.license,text:'CC BY 4.0'},{href:terms,text:labelFor(language).terms}];
}
export function knowledgeRunBoundary(before,after,started,completed,options={}){
  const config=knowledgeProbeOptions(options);
  const stable=Boolean(before&&after&&commitHash(before.commit)&&hash(before.manifest)&&before.commit===after.commit&&before.manifest===after.manifest);
  const activeAtStart=active(started);
  const stableClock=safeClock(started)&&safeClock(completed)&&completed>=started&&phase(started)===phase(completed);
  const failures=[...(!stable?['release-receipt-changed-or-unavailable']:[]),...(!stableClock?['review-window-changed-or-clock-invalid']:[])];
  if(config.mode==='recovery'){
    if(!activeAtStart||!active(completed))failures.push('recovery-requires-active-admission');
    if(!stable||before.commit!==config.expectedCommit)failures.push('expected-release-commit');
    if(!stable||before.manifest!==config.expectedManifest)failures.push('expected-release-manifest');
  }
  return {stable,activeAtStart,failures};
}
export function knowledgeCases(now){
  if(!safeClock(now))throw Error('DLKT_LIVE_KNOWLEDGE_CLOCK');
  const canonical='/card/'+id,api='/api/card?id='+id;
  const query=(language,h)=>'v='+revision+'&lang='+language+'&h='+h;
  const admitted=active(now)?200:404;
  return Object.freeze([
    ...['en','ro','it'].flatMap(language=>[
      {key:'canonical-'+language,path:canonical+'?'+query(language,digest),language,status:admitted},
      {key:'api-'+language,path:api+'&'+query(language,digest),language,status:admitted},
    ]),
    {key:'lab-canonical',path:canonical+'?'+query('en',labDigest),language:'en',status:404},
    {key:'lab-api',path:api+'&'+query('en',labDigest),language:'en',status:404},
    {key:'duplicate-digest',path:canonical+'?'+query('en',digest)+'&h='+digest,language:'en',status:400},
    {key:'duplicate-id',path:api+'&'+query('en',digest)+'&id='+id,language:'en',status:400},
  ].map(item=>Object.freeze(item)));
}
const findAll=(nodes,predicate)=>DomUtils.findAll(predicate,nodes);
const attr=(node,key)=>node?.attribs?.[key];
const classHas=(node,value)=>(attr(node,'class')??'').split(/\s+/u).includes(value);
const textOf=node=>normalizeKnowledgeText(node?DomUtils.textContent(node):'');
const declaredVisible=node=>{
  for(let n=node;n;n=n.parent){
    if(n.attribs&&(Object.hasOwn(n.attribs,'hidden')||attr(n,'aria-hidden')==='true'||/(?:display\s*:\s*none|visibility\s*:\s*hidden|opacity\s*:\s*0(?:\s*[;}]|\s*$))/iu.test(attr(n,'style')??'')))return false;
  }
  return Boolean(node);
};
function inspectHttpEditorial(inside){
  const field=(nodes,tag,connection=false)=>{
    const node=nodes[0],parts=node?.children??[];
    const nonText=parts.filter(part=>part.type!=='text');
    const strong=nonText[0];
    const structure=Boolean(node&&node.name===tag&&(connection?
      nonText.length===1&&parts[0]===strong&&strong.name==='strong'&&declaredVisible(strong)&&strong.children?.every(child=>child.type==='text'):
      nonText.length===0));
    return {count:nodes.length,visible:declaredVisible(node),structure,text:textOf(node)};
  };
  const guides=findAll(inside,n=>classHas(n,'card-guide'));
  return {
    title:field(findAll(inside,n=>n.name==='h1'),'h1'),
    explanation:field(findAll(inside,n=>classHas(n,'card-context')),'p'),
    connection:field(guides.length===1?findAll(guides[0].children??[],n=>n.name==='p'):[],'p',true),
    geography:field(findAll(inside,n=>classHas(n,'card-topic')),'span'),
    publisher:field(findAll(inside,n=>classHas(n,'card-meta')),'p'),
    boundary:field(findAll(inside,n=>n.name==='p'&&classHas(n,'privacy-note')&&attr(n,'id')===undefined),'p'),
  };
}
export function assessKnowledgeResponse(item,reading){
  const failures=[];
  const check=(name,ok)=>{if(!ok)failures.push(name);};
  if(!object(reading)||!object(reading.headers)||typeof reading.body!=='string')return ['unreachable'];
  const header=name=>reading.headers[name]??'';
  check('status',reading.status===item.status);
  check('no-redirect',reading.redirected===false);
  check('html',/^text\/html(?:;|$)/iu.test(header('content-type')));
  check('no-store',/\bno-store\b/iu.test(header('cache-control')));
  check('no-cookie',header('set-cookie')==='');
  check('nosniff',header('x-content-type-options').toLowerCase()==='nosniff');
  check('noindex',/\bnoindex\b/iu.test(header('x-robots-tag'))&&/\bnofollow\b/iu.test(header('x-robots-tag')));
  let doc;try{doc=parseDocument(reading.body);}catch{return [...failures,'invalid-html'];}
  const nodes=doc.children;
  const pages=findAll(nodes,n=>n.name==='html');
  check('language',pages.length===1&&attr(pages[0],'lang')===item.language);
  const articles=findAll(nodes,n=>attr(n,'data-shared-knowledge-id')!==undefined);
  const buttons=findAll(nodes,n=>attr(n,'id')==='shared-copy');
  if(item.status===200){
    const article=articles[0],inside=article?.children??[];
    const canonical=knowledgeCanonicalUrl(item.language);
    const links=findAll(nodes,n=>n.name==='link'&&attr(n,'rel')==='canonical');
    const fresh=findAll(inside,n=>attr(n,'id')==='shared-freshness');
    const credits=findAll(inside,n=>classHas(n,'card-credits'));
    const credit=credits[0],creditAnchors=findAll(credit?.children??[],n=>n.name==='a');
    const creditExpected=knowledgeCreditLinks(item.language);
    check('identity',articles.length===1&&article.name==='article'&&attr(article,'data-shared-knowledge-id')===id);
    failures.push(...knowledgeEditorialFailures(item.language,inspectHttpEditorial(inside)));
    check('expiry',fresh.length===1&&attr(fresh[0],'data-valid-until')===String(expiresAt));
    check('canonical',links.length===1&&attr(links[0],'href')===canonical);
    check('source',findAll(inside,n=>n.name==='a'&&classHas(n,'source-link')&&attr(n,'href')===source&&declaredVisible(n)).length===1);
    check('credit',credits.length===1&&credit.name==='p'&&declaredVisible(credit)&&textOf(credit)===knowledgeCreditText(item.language));
    check('license',creditAnchors.length===2&&attr(creditAnchors[0],'href')===creditExpected[0].href&&textOf(creditAnchors[0])===creditExpected[0].text&&declaredVisible(creditAnchors[0]));
    check('terms',creditAnchors.length===2&&attr(creditAnchors[1],'href')===creditExpected[1].href&&textOf(creditAnchors[1])===creditExpected[1].text&&declaredVisible(creditAnchors[1]));
    check('copy-reference',buttons.length===1&&buttons[0].name==='button'&&findAll(inside,n=>n===buttons[0]).length===1&&attr(buttons[0],'data-card-url')===canonical);
  }else{
    check('no-substitute',articles.length===0&&buttons.length===0);
  }
  return failures;
}
function receipt(reading){
  if(!object(reading)||reading.status!==200||reading.redirected!==false
    ||!/^application\/json(?:;|$)/iu.test(reading.headers?.['content-type']??''))return null;
  try{
    const data=JSON.parse(reading.body);
    return data.format==='dlkt-info-public-build-1'&&data.product==='dlkt-info'
      &&typeof data.gitCommitSha==='string'&&/^[a-f0-9]{40}$/u.test(data.gitCommitSha)
      &&hash(data.manifestSha256)?{commit:data.gitCommitSha,manifest:data.manifestSha256}:null;
  }catch{return null;}
}
async function read(path,fetcher,accept,origin){
  const response=await fetcher(origin+path,{
    method:'GET',redirect:'manual',cache:'no-store',credentials:'omit',
    headers:{Accept:accept},signal:AbortSignal.timeout(TIMEOUT_MS),
  });
  const resultHeaders=Object.fromEntries(headers.map(name=>[name,response.headers.get(name)??'']));
  const declared=response.headers.get('content-length');
  if(declared!==null&&(!/^\d+$/u.test(declared)||Number(declared)>MAX_BYTES)){
    await response.body?.cancel();throw Error('DLKT_LIVE_KNOWLEDGE_BODY_LIMIT');
  }
  if(!response.body)throw Error('DLKT_LIVE_KNOWLEDGE_EMPTY');
  const reader=response.body.getReader(),parts=[];let count=0;
  try{
    for(;;){
      const part=await reader.read();if(part.done)break;
      count+=part.value.byteLength;
      if(count>MAX_BYTES){await reader.cancel();throw Error('DLKT_LIVE_KNOWLEDGE_BODY_LIMIT');}
      parts.push(part.value);
    }
  }finally{reader.releaseLock();}
  return {status:response.status,redirected:response.redirected,headers:resultHeaders,body:Buffer.concat(parts).toString('utf8')};
}
export async function readKnowledgeReceipt(fetcher=fetch,options={}){
  const config=knowledgeProbeOptions(options);
  try{return receipt(await read('/release.json',fetcher,'application/json',config.origin));}catch{return null;}
}
export async function collectLiveKnowledge(fetcher=fetch,clock=()=>Date.now(),options={}){
  const config=knowledgeProbeOptions(options),started=clock(),cases=knowledgeCases(started);
  const bounded=async(path,accept)=>{try{return await read(path,fetcher,accept,config.origin);}catch{return null;}};
  const before=await readKnowledgeReceipt(fetcher,config);
  const results=[];
  for(const item of cases){
    const sample=await bounded(item.path,'text/html');
    results.push({key:item.key,expected:item.status,status:sample?.status??null,failures:assessKnowledgeResponse(item,sample)});
  }
  const after=await readKnowledgeReceipt(fetcher,config),completed=clock();
  const boundary=knowledgeRunBoundary(before,after,started,completed,config);
  const failures=[...boundary.failures,...results.flatMap(item=>item.failures.map(failure=>item.key+':'+failure))];
  const recoveryVerified=config.mode==='recovery'&&failures.length===0;
  const status=failures.length?'LIVE_KNOWLEDGE_HTTP_BLOCKED':recoveryVerified?'LIVE_KNOWLEDGE_RECOVERY_PASS':boundary.activeAtStart?'LIVE_KNOWLEDGE_MONITOR_PASS':'LIVE_KNOWLEDGE_DENIAL_PASS';
  return {status,mode:config.mode,origin:config.origin,recoveryVerified,scope:'direct anonymous GET; explicit approved origin; no credentials, no redirects, no mutations',
    checkedAt:new Date(started).toISOString(),commit:boundary.stable?before.commit:null,manifest:boundary.stable?before.manifest:null,
    activeAtStart:boundary.activeAtStart,requests:cases.length+2,results,failures};
}
const invoked=process.argv[1]&&pathToFileURL(resolve(process.argv[1])).href===import.meta.url;
if(invoked){
  try{
    const report=await collectLiveKnowledge(fetch,()=>Date.now(),readKnowledgeProbeOptions());
    console.log('DLKT_LIVE_KNOWLEDGE_HTTP '+JSON.stringify(report));
    if(report.failures.length)process.exitCode=1;
  }catch{
    console.error('DLKT_LIVE_KNOWLEDGE_HTTP_BLOCKED');process.exitCode=1;
  }
}
