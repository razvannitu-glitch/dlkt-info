import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {EXPECTED_SCHEMA_MANIFEST as original} from '../.build/src/provisioning/readiness-manifest.js';
import {NEWS_PUBLISHERS} from '../.build/src/iceo/news-sources.js';
import {EDITORIAL_CATEGORY_TOPICS} from '../.build/src/iceo/editorial-categories.js';
import {ICEO_SOURCES} from '../.build/src/iceo/registry.js';

const revision='20261120195508_dlkt_info_global_editorial',version='dlkt-info-schema-manifest-5';
const priorRevision='20261120184745_dlkt_info_public_share_archive',priorHash='2046fac81fee84aba2c66b69a3e9141286598a17eab8456d7f8a309dc9cf368b';
const currentManifestSource=readFileSync('src/provisioning/readiness-manifest.ts','utf8');
const activeHash=currentManifestSource.match(/EXPECTED_SCHEMA_FINGERPRINT = '([a-f0-9]{64})'/u)?.[1];
if(!activeHash)throw Error('ACTIVE_FINGERPRINT_MISSING');
const m=structuredClone(original);
const add=(array,...values)=>{for(const value of values)if(!array.includes(value))array.push(value);};
const privateFunctions=['dlkt_info_private.valid_news_candidate_publisher(text, text)','dlkt_info_private.valid_news_candidate(jsonb, timestamp with time zone)'];
const rpc='public.dlkt_info_upsert_news_candidates(jsonb)',relation='public.dlkt_info_news_candidates';
add(m.relations,relation);add(m.functions,...privateFunctions,rpc);add(m.publicFunctions,rpc);add(m.privateFunctions,...privateFunctions);add(m.rls,relation);
add(m.policies,'public.dlkt_info_news_candidates.dlkt_info_news_candidates_public_read:SELECT:anon,authenticated,service_role');
for(const key of ['publicAnon','publicAuthenticated','publicService'])add(m.permissions[key],rpc);
add(m.permissions.publicDefiner,rpc);add(m.permissions.privateInvoker,...privateFunctions);
m.newsCandidatePermissions={relation,public:[],tableRoles:{anon:['SELECT'],authenticated:['SELECT'],service_role:['SELECT']},grantOptions:[],explicitColumnAcls:[],policy:{command:'SELECT',roles:['anon','authenticated','service_role'],using:'true',withCheck:null},fixedFunctionSearchPath:'',writerAuthentication:'SHA256 of x-dlkt-share-write compared with existing private singleton',maximumInput:500,maximumRows:5000,retentionHours:48,indexDateIsPublicationDate:false};
m.newsPublisherOrigins=NEWS_PUBLISHERS.map(p=>({label:p.label,origins:p.origins}));
m.publicEditorialTopics=EDITORIAL_CATEGORY_TOPICS;
m.newsFeaturedSource={id:'editorial-frontpage',publisherIds:['ap','guardian','pcgamer','bbc'],requiresPairedCategory:true,signal:'observed matching link within publisher homepage main content'};
m.newsCanonicalUrl={trackingKeysCaseInsensitive:true,encodedParameterNames:false,dotSegments:false,articleIdentityParametersPreserved:true};
const hash=createHash('sha256').update(JSON.stringify({version,manifest:m})).digest('hex');
const counts=Object.fromEntries(['relations','functions','publicFunctions','privateFunctions','rls','policies','triggers'].map(k=>[k,m[k].length]));
const origins=Object.fromEntries(NEWS_PUBLISHERS.flatMap(p=>p.origins.map(origin=>[origin,p.label])));
const topics=Object.fromEntries(Object.entries(EDITORIAL_CATEGORY_TOPICS).map(([k,v])=>['news-'+k,v]));
const quote=value=>"'"+value.replaceAll("'","''")+"'";
let pool=readFileSync('scripts/news-candidate-store.sql','utf8');
const publisherSql=`create function dlkt_info_private.valid_news_candidate_publisher(p_publisher text, p_url text)
returns boolean language plpgsql immutable set search_path = '' as $$
declare origins constant jsonb := ${quote(JSON.stringify(origins))}::jsonb; origin text; path text;
begin
  if p_url is null or p_publisher is null or length(p_url) not between 1 and 3000
    or p_url ~ '[[:space:]#<>\\\\]' then return false; end if;
  origin := substring(p_url from '^(https://[^/?#]+)');
  path := substring(p_url from '^https://[^/?#]+(/[^?#]*)');
  if origin is null or origins->>origin is distinct from p_publisher or path is null or path='/'
    or lower(path) ~ '/(login|signin|sign-in|account|subscribe|search|api)(/|$)'
    or lower(path) ~ '(^|/)([.]|%2e){1,2}(/|$)'
    or lower(p_url) ~ '[?&](utm_[^=&]*|fbclid|gclid|mc_cid|mc_eid)(=|&|$)'
    or p_url ~ '[?&][^=&]*%[^=&]*(=|&|$)' then return false; end if;
  return true;
end $$;`;
pool=pool.replace(/-- DRAFT ONLY\.[\s\S]*?begin;/u,'-- Bounded public candidate pool. No account data or historical share mutation.\nbegin;')
  .replace(/-- TODO\(ROOT\):[\s\S]*?create function dlkt_info_private.valid_news_candidate_publisher[\s\S]*?\$\$;/u,()=>publisherSql);
if(pool.includes('TODO(ROOT)')||pool.includes('select false $$'))throw Error('NEWS_REGISTRY_NOT_SEALED');
const old=readFileSync('supabase/migrations/'+priorRevision+'.sql','utf8');
let archive=old.slice(old.indexOf('create function dlkt_info_private.valid_share_archive_card'),old.indexOf('create table dlkt_info_private.share_archive_writer'));
archive=archive.replace('create function','create or replace function').replace('sources constant jsonb :=',`news_topics constant jsonb := ${quote(JSON.stringify(topics))}::jsonb;\n  sources constant jsonb :=`);
archive=archive.replace('    rule := sources->source_id;',`    if left(source_id,5)='news-' then
      if news_topics->>source_id is null or p_card->>'topic' is distinct from news_topics->>source_id
        or p_card->>'kind'<>'publication' or p_card->>'dateLabel'<>'Published'
        or p_card->>'identity'<>p_card->>'sourceUrl'
        or p_card ?| array['summary','byline','licenseUrl']
        or p_card->'deadline'<>'null'::jsonb or p_card->'version'<>'null'::jsonb
        or not dlkt_info_private.valid_news_candidate_publisher(p_card->>'publisher',p_card->>'sourceUrl') then return false; end if;
      continue;
    end if;
    if source_id='editorial-frontpage' then
      if not exists (
        select 1 from jsonb_array_elements_text(p_card->'sourceIds') as candidate(id)
        where news_topics->>candidate.id=p_card->>'topic'
      ) or p_card->>'publisher' not in ('Associated Press','The Guardian','PC Gamer','BBC')
        or p_card->>'kind'<>'publication' or p_card->>'dateLabel'<>'Published'
        or p_card->>'identity'<>p_card->>'sourceUrl'
        or p_card ?| array['summary','byline','licenseUrl']
        or p_card->'deadline'<>'null'::jsonb or p_card->'version'<>'null'::jsonb
        or not dlkt_info_private.valid_news_candidate_publisher(p_card->>'publisher',p_card->>'sourceUrl') then return false; end if;
      continue;
    end if;
    rule := sources->source_id;`);
let ready=old.slice(old.indexOf('create or replace function public.dlkt_info_read_database_readiness()'));
ready=ready.replaceAll(priorRevision,revision).replaceAll(priorHash,hash);
const array=(name,values)=>{const re=new RegExp('  '+name+' text\\[\\] := array\\[[\\s\\S]*?\\]::text\\[\\];');if(!re.test(ready))throw Error('ARRAY_NOT_FOUND:'+name);ready=ready.replace(re,'  '+name+' text[] := array[\n'+values.map(v=>'    '+quote(v)).join(',\n')+'\n  ]::text[];');};
for(const [name,key] of Object.entries({v_required_relations:'relations',v_required_functions:'functions',v_public_functions:'publicFunctions',v_private_functions:'privateFunctions',v_required_rls:'rls',v_required_policies:'policies',v_required_triggers:'triggers'}))array(name,m[key]);
for(const [name,key] of Object.entries({v_public_anon_functions:'publicAnon',v_public_authenticated_functions:'publicAuthenticated',v_public_service_functions:'publicService',v_private_authenticated_functions:'privateAuthenticated',v_private_service_functions:'privateService'}))array(name,m.permissions[key]);
for(const [name,key] of Object.entries({v_public_definer_functions:'publicDefiner',v_public_invoker_functions:'publicInvoker',v_private_definer_functions:'privateDefiner',v_private_invoker_functions:'privateInvoker'}))array(name,m.permissions[key]);
const extra=`  -- Public candidate cache retains strict SELECT-only application roles.
  v_public_data_permissions_ok := v_public_data_permissions_ok and coalesce((
    select bool_and(has_table_privilege(role.name,'public.dlkt_info_news_candidates',privilege.name)=(privilege.name='SELECT')
      and not has_table_privilege(role.name,'public.dlkt_info_news_candidates',privilege.name || ' WITH GRANT OPTION'))
    from unnest(array['anon','authenticated','service_role']) as role(name)
    cross join unnest(v_table_privileges) as privilege(name)
  ),false) and coalesce((
    select bool_and(has_any_column_privilege(role.name,'public.dlkt_info_news_candidates',privilege.name)=(privilege.name='SELECT')
      and not has_any_column_privilege(role.name,'public.dlkt_info_news_candidates',privilege.name || ' WITH GRANT OPTION'))
    from unnest(array['anon','authenticated','service_role']) as role(name)
    cross join unnest(v_column_privileges) as privilege(name)
  ),false) and not exists (
    select 1 from pg_class c cross join lateral aclexplode(c.relacl) acl
    where c.oid='public.dlkt_info_news_candidates'::regclass and acl.grantee=0
  ) and not exists (
    select 1 from pg_attribute a cross join lateral aclexplode(case when cardinality(a.attacl)>0 then a.attacl end) acl
    where a.attrelid='public.dlkt_info_news_candidates'::regclass and a.attnum>0 and not a.attisdropped
      and case when acl.grantee=0 then true else pg_has_role('anon',acl.grantee,'USAGE') or pg_has_role('authenticated',acl.grantee,'USAGE') or pg_has_role('service_role',acl.grantee,'USAGE') end
  );
  v_policies_ok := v_policies_ok and exists (
    select 1 from pg_policy p where p.polrelid='public.dlkt_info_news_candidates'::regclass
      and p.polname='dlkt_info_news_candidates_public_read' and p.polcmd='r' and p.polpermissive
      and pg_get_expr(p.polqual,p.polrelid)='true' and p.polwithcheck is null
  );
  v_search_path_ok := v_search_path_ok and coalesce((
    select bool_and(p.proconfig @> array['search_path=""']::text[]) from pg_proc p
    where p.oid=any(array['dlkt_info_private.valid_news_candidate_publisher(text,text)'::regprocedure,
      'dlkt_info_private.valid_news_candidate(jsonb,timestamptz)'::regprocedure,'public.dlkt_info_upsert_news_candidates(jsonb)'::regprocedure])
  ),false);
\n`;
ready=ready.replace('  v_no_unexpected_objects :=',extra+'  v_no_unexpected_objects :=');
const migration=pool.replace(/commit;\s*$/u,'')+'\n'+archive+'\n'+ready;
writeFileSync('scripts/global-editorial-migration.sql',migration);
writeFileSync('supabase/migrations/'+revision+'.sql',migration);
const manifestSource=`export const DATABASE_READINESS_VERSION = 'dlkt-info-database-readiness-2' as const;
export const SCHEMA_MANIFEST_VERSION = '${version}' as const;
export const DATABASE_READINESS_RPC = 'dlkt_info_read_database_readiness' as const;
export const DATABASE_READINESS_MIGRATION = '${revision}' as const;
// SHA-256 of UTF-8 serializeSchemaManifest(); object/array order is part of this versioned contract.
export const EXPECTED_SCHEMA_FINGERPRINT = '${hash}' as const;
export const EXPECTED_SCHEMA_COUNTS = Object.freeze(${JSON.stringify(counts,null,2)} as const);
export const EXPECTED_SCHEMA_MANIFEST = Object.freeze(${JSON.stringify(m,null,2)} as const);
export function serializeSchemaManifest():string{return JSON.stringify({version:SCHEMA_MANIFEST_VERSION,manifest:EXPECTED_SCHEMA_MANIFEST});}
`;
writeFileSync('src/provisioning/readiness-manifest.ts',manifestSource);
for(const file of ['scripts/generate-release-manifest.mjs','tests/database/database-readiness-attestation.test.mjs','tests/experience.test.mjs','tests/provisioning-control.test.mjs','tests/identity.test.mjs','tests/persistence.test.mjs']){
  let s=readFileSync(file,'utf8').replaceAll(priorRevision,revision).replaceAll(priorHash,hash).replaceAll(activeHash,hash).replaceAll('dlkt-info-schema-manifest-4',version);
  s=s.replaceAll('relationsExpected: 29, relationsPresent: 29, relationsTotal: 29','relationsExpected: 30, relationsPresent: 30, relationsTotal: 30').replaceAll('functionsExpected: 49, functionsPresent: 49, functionsTotal: 49','functionsExpected: 52, functionsPresent: 52, functionsTotal: 52').replaceAll('rlsExpected: 17, rlsPresent: 17, rlsTotal: 17','rlsExpected: 18, rlsPresent: 18, rlsTotal: 18').replaceAll('policiesExpected: 28, policiesPresent: 28, policiesTotal: 28','policiesExpected: 29, policiesPresent: 29, policiesTotal: 29');
  writeFileSync(file,s);
}
let gate=readFileSync('verify-release.mjs','utf8');
gate=gate.replace("manifest.schemaManifestVersion !== 'dlkt-info-schema-manifest-4'","manifest.schemaManifestVersion !== '"+version+"'")
  .replace("manifest.databaseReadinessMigration !== '"+priorRevision+"'","manifest.databaseReadinessMigration !== '"+revision+"'")
  .replace("manifest.expectedSchemaFingerprint !== '"+priorHash+"'","manifest.expectedSchemaFingerprint !== '"+hash+"'")
  .replace("manifest.expectedSchemaFingerprint !== '"+activeHash+"'","manifest.expectedSchemaFingerprint !== '"+hash+"'")
  .replace("SCHEMA_MANIFEST_VERSION = 'dlkt-info-schema-manifest-4'","SCHEMA_MANIFEST_VERSION = '"+version+"'")
  .replace("EXPECTED_SCHEMA_FINGERPRINT = '"+priorHash+"'","EXPECTED_SCHEMA_FINGERPRINT = '"+hash+"'")
  .replace("EXPECTED_SCHEMA_FINGERPRINT = '"+activeHash+"'","EXPECTED_SCHEMA_FINGERPRINT = '"+hash+"'")
  .replace(/manifest.publicSourceCount !== \d+/u,'manifest.publicSourceCount !== '+ICEO_SOURCES.length)
  .replace(/manifest.publicPublisherCount !== \d+/u,'manifest.publicPublisherCount !== '+new Set(ICEO_SOURCES.map(source=>source.publisher)).size)
  .replaceAll('\\\"tables\\\":29','\\\"tables\\\":30')
  .replaceAll('schedule:\'0 5 * * *\'','schedule:\'*/15 * * * *\'')
  .replaceAll('\'"relations": 29\', \'"functions": 49\', \'"rls": 17\', \'"policies": 28\'','\'"relations": 30\', \'"functions": 52\', \'"rls": 18\', \'"policies": 29\'');
writeFileSync('verify-release.mjs',gate);
writeFileSync('../evidence/editorial-schema.json',JSON.stringify({revision,hash,version,counts,publishers:NEWS_PUBLISHERS.length},null,2));
console.log(JSON.stringify({revision,hash,counts,publishers:NEWS_PUBLISHERS.length,migrationBytes:Buffer.byteLength(migration)}));
