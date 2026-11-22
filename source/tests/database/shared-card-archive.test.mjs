import {before,after,test} from 'node:test';
import assert from 'node:assert/strict';
import {readFile,readdir} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {PGlite} from '@electric-sql/pglite';
import {cardContent} from '../../.build/src/iceo/card-validation.js';
import {NEWS_PUBLISHERS} from '../../.build/src/iceo/news-sources.js';
import {ICEO_SOURCES} from '../../.build/src/iceo/registry.js';
import {extract} from '../../.build/src/iceo/extract.js';
import {validArchiveCard} from '../../.build/src/share/archive.js';
import {EXPECTED_SCHEMA_FINGERPRINT} from '../../.build/src/provisioning/readiness-manifest.js';

const writerKey='test-only-archive-key-never-a-production-secret-123456789';
const digest=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
let db;let now;
function card(changes={}){
  const identity='https://www.ecb.europa.eu/press/pr/date/2026/html/archive.en.html';
  const value={id:digest(identity).slice(0,24),identity,title:'“Quoted” / source statement, €5 and 日本',topic:'business',kind:'publication',sourceUrl:identity,
    publisher:'European Central Bank',sourceIds:['ecb-news'],date:new Date(now-10_000).toISOString(),dateLabel:'Published',observedAt:new Date(now-1000).toISOString(),
    contentHash:'',boundary:'Official publication listing.',deadline:null,version:null,attribution:'Source: European Central Bank.',sourceState:'verified',...changes};
  value.contentHash=digest(cardContent(value));return value;
}
async function asRole(role,fn){await db.exec(`set role ${role}`);try{return await fn();}finally{await db.exec('reset role');}}
async function headers(value){await db.query("select set_config('request.headers',$1,false)",[JSON.stringify(value)]);}
async function capture(value=card(),time=now){return db.query('select public.dlkt_info_capture_shared_card($1::jsonb,$2::timestamptz,$3::timestamptz,false) as stored',[JSON.stringify(value),new Date(time).toISOString(),new Date(now+300_000).toISOString()]);}

before(async()=>{
  db=new PGlite();await db.waitReady;now=Date.now();
  await db.exec(`create role anon noinherit;create role authenticated noinherit;create role service_role noinherit bypassrls;create role untrusted_visitor noinherit;
    grant usage on schema public to anon,authenticated,service_role,untrusted_visitor;
    alter default privileges in schema public grant all on tables to anon,authenticated,service_role;
    create schema auth;create table auth.users(id uuid primary key,raw_user_meta_data jsonb not null default '{}'::jsonb);
    create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$;
    create function auth.role() returns text language sql stable as $$ select nullif(current_setting('request.jwt.claim.role',true),'') $$;`);
  for(const file of (await readdir('supabase/migrations')).filter(name=>name.endsWith('.sql')).sort()) await db.exec(await readFile(`supabase/migrations/${file}`,'utf8'));
});
after(async()=>{await db?.close();});

test('writer RPC fails closed without provisioning, missing key, bad key and invalid headers',async()=>{
  await headers({'x-dlkt-share-write':writerKey});await assert.rejects(asRole('anon',()=>capture()),{code:'42501'});
  const hashed=createHash('sha256').update(writerKey).digest('hex');
  await db.query('insert into dlkt_info_private.share_archive_writer(key_hash) values($1)',[hashed]);
  for(const value of [{},{'x-dlkt-share-write':'bad'},{'x-dlkt-share-write':'x'.repeat(43)}]){
    await headers(value);await assert.rejects(asRole('anon',()=>capture()),{code:'42501'});
  }
  await db.query("select set_config('request.headers','not json',false)");await assert.rejects(asRole('anon',()=>capture()),{code:'42501'});
  await headers({'x-dlkt-share-write':writerKey});
  await assert.rejects(asRole('untrusted_visitor',()=>capture()),{code:'42501'});
});

test('valid purpose-bound write is public, immutable and idempotent, including metadata',async()=>{
  await headers({'x-dlkt-share-write':writerKey});
  const first=(await asRole('anon',()=>capture())).rows[0].stored;
  const value=card({observedAt:new Date(now+1000).toISOString(),sourceState:'partial'});
  const again=(await asRole('anon',()=>capture(value,now+1000))).rows[0].stored;
  assert.deepEqual(again,first);assert.equal(first.card.sourceState,'verified');
  const rows=(await asRole('anon',()=>db.query('select * from public.dlkt_info_shared_cards'))).rows;
  assert.equal(rows.length,1);assert.deepEqual(rows[0].card,card());
  await assert.rejects(db.exec("update public.dlkt_info_shared_cards set partial=true"),{code:'55000'});
  await assert.rejects(db.exec('delete from public.dlkt_info_shared_cards'),{code:'55000'});
  await assert.rejects(db.exec('truncate public.dlkt_info_shared_cards'),{code:'55000'});
});

test('anonymous, authenticated and service roles cannot directly mutate or inspect private writer state',async()=>{
  for(const role of ['anon','authenticated','service_role']){
    await assert.rejects(asRole(role,()=>db.exec('select key_hash from dlkt_info_private.share_archive_writer')),{code:'42501'});
    await assert.rejects(asRole(role,()=>db.exec('update public.dlkt_info_shared_cards set partial=true')),{code:'42501'});
    await assert.rejects(asRole(role,()=>db.exec('delete from public.dlkt_info_shared_cards')),{code:'42501'});
    await assert.rejects(asRole(role,()=>db.exec('truncate public.dlkt_info_shared_cards')),{code:'42501'});
    await assert.rejects(asRole(role,()=>db.exec('insert into public.dlkt_info_shared_cards select * from public.dlkt_info_shared_cards')),{code:'42501'});
  }
  const rows=(await db.query("select relname,relrowsecurity from pg_class where relname in ('share_archive_writer','dlkt_info_shared_cards')")).rows;
  assert.equal(rows.length,2);assert.ok(rows.every(row=>row.relrowsecurity));
});

test('authenticated writer still cannot inject private fields, malformed records, unknown sources or forged hashes',async()=>{
  await headers({'x-dlkt-share-write':writerKey});
  const attacks=[card({ownerId:'private'}),card({sourceIds:['unknown']}),card({sourceIds:['nasa-news']}),card({sourceIds:[]}),
    card({sourceIds:['ecb-news','ecb-news']}),card({publisher:'Wrong publisher'}),card({sourceUrl:'https://www.ecb.europa.eu.evil.example/a'}),
    card({sourceState:'stale'}),card({summary:'x'.repeat(1001)}),card({date:'infinity'}),card({deadline:'tomorrow'}),
    {...card(),contentHash:'0'.repeat(64)},{...card(),id:'0'.repeat(24)},card({context:{countries:[],basis:'unspecified',label:'Test',boundary:'Test',owner:'private'}})];
  for(const value of attacks)await assert.rejects(asRole('anon',()=>capture(value)),{code:'22023'});
  await assert.rejects(asRole('anon',()=>capture(card(),now-600_000)),{code:'22023'});
});

test('SQL canonical content exactly matches JavaScript, including optional credits, context and Unicode',async()=>{
  const value=card({summary:'A complete statement: "quoted" \\ path.',byline:'Publisher',licenseUrl:'https://creativecommons.org/licenses/by/4.0/',
    context:{countries:[{code:'RO',name:'Romania'},{code:'US',name:'United States'}],basis:'publisher-category',label:'Publisher locations',boundary:'No applicability inferred.'}});
  const canonical=(await db.query('select dlkt_info_private.share_archive_content($1::jsonb) as value',[JSON.stringify(value)])).rows[0].value;
  assert.equal(canonical,JSON.stringify(cardContent(value)));
  assert.equal((await db.query('select dlkt_info_private.valid_share_archive_card($1::jsonb) as valid',[JSON.stringify(value)])).rows[0].valid,true);
});

test('SQL source allowlist covers every reviewed registry ID and keeps distinct immutable revisions',async()=>{
  const migration=await readFile(new URL('../../scripts/share-archive-migration.sql',import.meta.url),'utf8');
  for(const source of ICEO_SOURCES.filter(source=>source.adapter!=='news-index'))assert.ok(migration.includes(`"${source.id}":[`),`Missing reviewed source: ${source.id}`);
  await headers({'x-dlkt-share-write':writerKey});const revised=card({title:'A material publisher update'});
  await asRole('anon',()=>capture(revised,now+2000));
  const rows=(await asRole('anon',()=>db.query('select revision from public.dlkt_info_shared_cards order by captured_at desc,revision desc'))).rows;
  assert.equal(rows.length,2);assert.equal(rows[0].revision,revised.contentHash);
});

test('all reviewed source adapters preserve archive integrity and exact publisher origins',async()=>{
  const esc=value=>value.replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
  for(const source of ICEO_SOURCES.filter(source=>source.adapter!=='news-index')){
    let raw;
    if(source.adapter==='github-releases')raw=JSON.stringify([{draft:false,prerelease:false,tag_name:'v1.2.3',html_url:`https://github.com/${source.repo}/releases/tag/v1.2.3`,name:'Release 1.2.3',published_at:new Date(now-10_000).toISOString()}]);
    else if(source.adapter==='cellar-sparql')raw=JSON.stringify({results:{bindings:[{celex:{value:'32026R1234'},work:{value:'http://publications.europa.eu/resource/cellar/12345678-1234-1234-1234-123456789abc'},date:{value:new Date(now-86_400_000).toISOString().slice(0,10)},title:{value:'Controlled legal metadata','xml:lang':'en'}}]}});
    else if(source.adapter==='ecb-rss')raw=`<rss><channel><title>ECB - European Central Bank</title><item><title>Controlled publisher statement</title><link>https://www.ecb.europa.eu/press/${source.id}.html</link><pubDate>${new Date(now-10_000).toUTCString()}</pubDate><description>A complete source statement with its limitation.</description></item></channel></rss>`;
    else {
      const feed=source.feed,home=feed.homeUrl??feed.homeOrigin+(feed.homePath??'/'),link=feed.articleOrigins[0]+feed.articlePaths[0]+'archive-check';
      const title='Controlled publisher statement',summary='A complete publisher paragraph with its qualification intact.';
      if(feed.format==='atom')raw=`<feed xmlns="http://www.w3.org/2005/Atom"><title>${esc(feed.title)}</title><link rel="alternate" type="text/html" href="${esc(home)}"/><entry><title>${title}</title><link rel="alternate" type="text/html" href="${esc(link)}"/><${feed.dateField}>${new Date(now-10_000).toISOString()}</${feed.dateField}><summary>${summary}</summary></entry></feed>`;
      else raw=`<rss xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:a10="http://www.w3.org/2005/Atom" xmlns:content="http://purl.org/rss/1.0/modules/content/"><channel><title>${esc(feed.title)}</title><link>${esc(home)}</link><item><title>${title}</title><link>${esc(link)}</link><${feed.dateField}>${new Date(now-10_000).toUTCString()}</${feed.dateField}><dc:creator>Controlled author</dc:creator><category>Romania</category><description><![CDATA[<p>${summary}</p>]]></description><summary>${summary}</summary><content:encoded><![CDATA[<div class="gv-rss-footer"><div class="text-credits-section"><span class="credit-label">Written by</span><span class="user-link">Controlled author</span></div></div>]]></content:encoded></item></channel></rss>`;
    }
    const extracted=extract(raw,source,now);assert.equal(extracted.cards.length,1,source.id);const value=extracted.cards[0];
    assert.equal(validArchiveCard(value),true,`${source.id}: TypeScript`);
    assert.equal((await db.query('select dlkt_info_private.valid_share_archive_card($1::jsonb) as valid',[JSON.stringify(value)])).rows[0].valid,true,`${source.id}: SQL`);
    assert.equal((await db.query('select dlkt_info_private.share_archive_content($1::jsonb) as content',[JSON.stringify(value)])).rows[0].content,JSON.stringify(cardContent(value)),`${source.id}: canonical content`);
    const attack={...value,sourceUrl:value.sourceUrl.replace('https://','https://attacker.invalid/'),identity:value.identity.replace('https://','https://attacker.invalid/')};attack.id=digest(attack.identity).slice(0,24);attack.contentHash=digest(cardContent(attack));
    assert.equal(validArchiveCard(attack),false,`${source.id}: foreign URL`);
    assert.equal((await db.query('select dlkt_info_private.valid_share_archive_card($1::jsonb) as valid',[JSON.stringify(attack)])).rows[0].valid,false,`${source.id}: SQL foreign URL`);
  }
});


test('every news category, unclassified source and reviewed publisher retains strict TypeScript and SQL archive validation',async()=>{
  const sources=ICEO_SOURCES.filter(source=>source.id.startsWith('news-'));
  assert.equal(sources.length,21);
  for(const source of sources){
    const identity='https://www.ign.com/articles/controlled-editorial-'+source.id;
    const value=card({identity,id:digest(identity).slice(0,24),sourceUrl:identity,topic:source.topic,publisher:'IGN',sourceIds:[source.id],title:'Controlled original publication',dateLabel:'Published'});
    assert.equal(validArchiveCard(value),true,source.id);
    assert.equal((await db.query('select dlkt_info_private.valid_share_archive_card($1::jsonb) as ok',[JSON.stringify(value)])).rows[0].ok,true,source.id);
    for(const patch of [{publisher:'Forged publisher'},{summary:'Unlicensed body excerpt'},{dateLabel:'Updated'},{sourceUrl:'https://www.ign.com.attacker.invalid/article'}]){
      const bad=card({...value,...patch});
      assert.equal(validArchiveCard(bad),false,JSON.stringify(patch));
      assert.equal((await db.query('select dlkt_info_private.valid_share_archive_card($1::jsonb) as ok',[JSON.stringify(bad)])).rows[0].ok,false,JSON.stringify(patch));
    }
  }
  for(const publisher of NEWS_PUBLISHERS)for(const origin of publisher.origins){
    const identity=origin+'/news/controlled-article';
    const value=card({identity,id:digest(identity).slice(0,24),sourceUrl:identity,topic:'world',publisher:publisher.label,sourceIds:['news-world']});
    assert.equal(validArchiveCard(value),true,origin);
    assert.equal((await db.query('select dlkt_info_private.valid_share_archive_card($1::jsonb) as ok',[JSON.stringify(value)])).rows[0].ok,true,origin);
  }
});
test('homepage provenance requires a matching news category and a reviewed homepage publisher',async()=>{
  const identity='https://www.theguardian.com/world/2026/nov/20/controlled-original';
  const value=card({identity,id:digest(identity).slice(0,24),sourceUrl:identity,publisher:'The Guardian',topic:'world',sourceIds:['news-world','editorial-frontpage']});
  for(const candidate of [value,{...value,sourceIds:['editorial-frontpage','news-world']}]){
    assert.equal(validArchiveCard(candidate),true);
    assert.equal((await db.query('select dlkt_info_private.valid_share_archive_card($1::jsonb) as ok',[JSON.stringify(candidate)])).rows[0].ok,true);
  }
  const bbcIdentity='https://www.bbc.com/news/articles/controlled-original';
  const bbc=card({...value,identity:bbcIdentity,id:digest(bbcIdentity).slice(0,24),sourceUrl:bbcIdentity,publisher:'BBC'});
  assert.equal(validArchiveCard(bbc),true);assert.equal((await db.query('select dlkt_info_private.valid_share_archive_card($1::jsonb) as ok',[JSON.stringify(bbc)])).rows[0].ok,true);
  for(const patch of [{sourceIds:['editorial-frontpage']},{topic:'health'},{publisher:'IGN',sourceUrl:'https://www.ign.com/articles/original',identity:'https://www.ign.com/articles/original'}]){
    const bad=card({...value,...patch});bad.id=digest(bad.identity).slice(0,24);bad.contentHash=digest(cardContent(bad));
    assert.equal(validArchiveCard(bad),false);
    assert.equal((await db.query('select dlkt_info_private.valid_share_archive_card($1::jsonb) as ok',[JSON.stringify(bad)])).rows[0].ok,false);
  }
});
test('extended readiness is exact and rejects new RPCs, archive ACL drift, policy changes and missing TRUNCATE protection',async()=>{
  const read=async()=>asRole('anon',async()=>(await db.query('select public.dlkt_info_read_database_readiness() as value')).rows[0].value);
  const healthy=await read();assert.equal(healthy.ready,true);assert.equal(healthy.schemaFingerprint,EXPECTED_SCHEMA_FINGERPRINT);
  assert.deepEqual([healthy.counts.relationsTotal,healthy.counts.functionsTotal,healthy.counts.rlsTotal,healthy.counts.policiesTotal,healthy.counts.triggersTotal],[33,67,21,29,34]);
  const cases=[
    ["create function public.dlkt_info_arbitrary_archive_rpc() returns integer language sql as $$select 1$$",'noUnexpectedObjects'],
    ['grant insert on public.dlkt_info_shared_cards to anon','publicDataPermissions'],
    ['grant select on public.dlkt_info_shared_cards to public','publicDataPermissions'],
    ['grant select (id) on public.dlkt_info_shared_cards to anon','publicDataPermissions'],
    ['grant select on dlkt_info_private.share_archive_writer to service_role','privateTables'],
    ['grant execute on function dlkt_info_private.share_archive_content(jsonb) to authenticated','privateFunctionPermissions'],
    ['alter policy dlkt_info_shared_cards_public_read on public.dlkt_info_shared_cards using(false)','policies'],
    ['drop trigger dlkt_info_shared_cards_no_truncate on public.dlkt_info_shared_cards','triggers'],
    ['alter table public.dlkt_info_shared_cards disable trigger dlkt_info_shared_cards_immutable','triggers'],
    ["alter function public.dlkt_info_capture_shared_card(jsonb,timestamptz,timestamptz,boolean) set search_path=public",'searchPath'],
  ];
  for(const [sql,check] of cases){await db.exec('begin');try{await db.exec(sql);const value=await read();assert.equal(value.ready,false,sql);assert.equal(value.checks[check],false,sql);assert.equal(value.activationReceipt,null);}finally{await db.exec('reset role;rollback');}}
  assert.equal((await read()).ready,true);
});


test('publisher subject metadata has identical JS and PostgreSQL integrity semantics',async()=>{
 const base=card(),metadata=(sections,keywords=[])=>({basis:'publisher-jsonld',articleUrl:base.sourceUrl,sections,keywords});
 for(const subject of [metadata(['Economy']),metadata(['Sport','Economy']),metadata(['😀'.repeat(80)]),metadata([],['Markets'])]){
  const value=card({articleSubject:subject});
  assert.equal(validArchiveCard(value),true);
  const result=(await db.query('select dlkt_info_private.valid_share_archive_card($1::jsonb) valid,dlkt_info_private.share_archive_content($1::jsonb) content',[JSON.stringify(value)])).rows[0];
  assert.equal(result.valid,true);assert.equal(result.content,JSON.stringify(cardContent(value)));
 }
 for(const subject of [metadata(['Economy','Economy']),metadata(['x'.repeat(81)]),metadata(['😀'.repeat(81)]),
  metadata(['ab'+String.fromCharCode(65279)+'cd']),metadata(['ab'+String.fromCharCode(9)+'cd']),metadata(['Two  spaces']),
  {...metadata(['Economy']),articleUrl:base.sourceUrl+'/other'},{...metadata(['Economy']),token:'private'}]){
  const value=card({articleSubject:subject});
  assert.equal(validArchiveCard(value),false);
  assert.equal((await db.query('select dlkt_info_private.valid_share_archive_card($1::jsonb) valid',[JSON.stringify(value)])).rows[0].valid,false);
 }
 const changed=card({articleSubject:metadata(['Economy'])});changed.contentHash=base.contentHash;
 assert.equal((await db.query('select dlkt_info_private.valid_share_archive_card($1::jsonb) valid',[JSON.stringify(changed)])).rows[0].valid,false);
 const previous=(await db.query('select dlkt_info_private.valid_share_archive_card($1::jsonb) valid,dlkt_info_private.share_archive_content($1::jsonb) content',[JSON.stringify(base)])).rows[0];
 assert.equal(previous.valid,true);assert.equal(previous.content,JSON.stringify(cardContent(base)));
});
