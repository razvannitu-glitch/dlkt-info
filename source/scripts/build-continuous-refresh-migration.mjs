import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {registerHooks} from 'node:module';

// Read-only imports of the exact local registry; no services or old generators.
registerHooks({resolve(specifier,context,next){
  if(specifier.startsWith('.')&&context.parentURL){const url=new URL(specifier,context.parentURL);if(url.pathname.includes('/src/')&&url.pathname.endsWith('.js')){const source=new URL(url.href.replace(/\.js$/u,'.ts'));if(existsSync(source))return next(source.href,context);}}
  return next(specifier,context);
}});
const {ICEO_SOURCES}=await import('../src/iceo/registry.ts');
const {PUBLIC_TOPICS}=await import('../src/iceo/topics.ts');
const {NEWS_CATEGORY_SOURCES,NEWS_UNCLASSIFIED_SOURCE}=await import('../src/iceo/news-sources.ts');
const filename=process.argv[2];
if(!filename||!/^\d{14}_dlkt_info_continuous_refresh\.sql$/u.test(filename)||!existsSync('supabase/migrations/'+filename))throw Error('CLI_GENERATED_MIGRATION_FILENAME_REQUIRED');
const revision=filename.slice(0,-4),priorRevision='20261120195508_dlkt_info_global_editorial';
const priorHash='dca02b4fa88e55faa745b06c71f9a0e1ae1ed9b61b40d83faa51d1c1d6def4a7',version='dlkt-info-schema-manifest-6';
const source=readFileSync('src/provisioning/readiness-manifest.ts','utf8');
const match=source.match(/EXPECTED_SCHEMA_MANIFEST = Object.freeze\((\{[\s\S]*\}) as const\);/u);
if(!match)throw Error('BASE_MANIFEST_INVALID');
const m=JSON.parse(match[1]);
const previousHash=source.match(/EXPECTED_SCHEMA_FINGERPRINT = '([a-f0-9]{64})'/u)?.[1];
if(!previousHash)throw Error('BASE_FINGERPRINT_MISSING');
const relations=['dlkt_info_private.public_refresh_state','dlkt_info_private.public_refresh_runs'];
const privateFunctions=['dlkt_info_private.require_public_refresh_writer()','dlkt_info_private.valid_public_refresh_snapshot(jsonb, timestamp with time zone)'];
const publicFunctions=['public.dlkt_info_read_public_snapshot()','public.dlkt_info_claim_public_refresh(uuid, jsonb)','public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)','public.dlkt_info_fail_public_refresh(uuid, bigint, text)'];
// Reruns remove only this generator's own additions before checking the exact
// previous contract. No historical migration is executed or rewritten.
if(source.includes(`SCHEMA_MANIFEST_VERSION = '${version}'`)){
  if(!source.includes(`DATABASE_READINESS_MIGRATION = '${revision}'`))throw Error('REVISION_MISMATCH');
  for(const key of ['relations','rls'])m[key]=m[key].filter(value=>!relations.includes(value));
  for(const key of ['functions','publicFunctions','privateFunctions'])m[key]=m[key].filter(value=>![...privateFunctions,...publicFunctions].includes(value));
  for(const key of ['publicAnon','publicAuthenticated','publicService','publicDefiner'])m.permissions[key]=m.permissions[key].filter(value=>!publicFunctions.includes(value));
  m.permissions.privateInvoker=m.permissions.privateInvoker.filter(value=>!privateFunctions.includes(value));
  delete m.continuousRefreshPermissions;
}else if(!source.includes(`DATABASE_READINESS_MIGRATION = '${priorRevision}'`))throw Error('BASE_REVISION_MISMATCH');
if(createHash('sha256').update(JSON.stringify({version:'dlkt-info-schema-manifest-5',manifest:m})).digest('hex')!==priorHash)throw Error('BASE_MANIFEST_DRIFT');
const quote=value=>"'"+value.replaceAll("'","''")+"'";
const registry=Object.fromEntries(ICEO_SOURCES.map(s=>[s.id,{label:s.label,publisher:s.publisher,topic:s.topic,termsUrl:s.termsUrl}]));
if(NEWS_UNCLASSIFIED_SOURCE.id!=='news-unclassified'||NEWS_UNCLASSIFIED_SOURCE.topic!=='other'||NEWS_CATEGORY_SOURCES.length!==20||ICEO_SOURCES.length!==51||PUBLIC_TOPICS.length!==21||!PUBLIC_TOPICS.includes('other'))throw Error('UNCLASSIFIED_REGISTRY_CONTRACT');
const add=(array,...values)=>{for(const value of values)if(!array.includes(value))array.push(value);};
add(m.relations,...relations);add(m.rls,...relations);add(m.functions,...privateFunctions,...publicFunctions);add(m.publicFunctions,...publicFunctions);add(m.privateFunctions,...privateFunctions);
for(const key of ['publicAnon','publicAuthenticated','publicService','publicDefiner'])add(m.permissions[key],...publicFunctions);
add(m.permissions.privateInvoker,...privateFunctions);
m.continuousRefreshPermissions={relations,tableRoles:{PUBLIC:[],anon:[],authenticated:[],service_role:[]},policies:[],explicitColumnAcls:[],fixedFunctionSearchPath:'',writerAuthentication:'SHA256 of x-dlkt-share-write compared with existing private singleton',slotSeconds:120,leaseSeconds:90,maximumSnapshotBytes:1048576,maximumCards:5000,maximumSources:100,maximumHistory:720,historyRetentionDays:7,backoffSeconds:[30,60,120,300],fencing:true,atomicSnapshotAndReceipt:true,publicReadExcludes:['worker_id','lease_token','fence','trigger','key_hash'],digest:'Authenticated writer SHA256; canonical sorted JSON verified again by the server reader',catalogue:{candidateCategoryNullable:true,nonNullCandidateCategories:NEWS_CATEGORY_SOURCES.map(source=>source.id.slice(5)),unclassifiedSource:'news-unclassified',unclassifiedTopic:'other',coverageTopics:[...PUBLIC_TOPICS],sourceRegistry:registry,sourceRegistryCount:51,unclassifiedShares:'Reviewed publisher URL and exact identity; headline-only; optional verified homepage signal'}};
const hash=createHash('sha256').update(JSON.stringify({version,manifest:m})).digest('hex');
const counts=Object.fromEntries(['relations','functions','publicFunctions','privateFunctions','rls','policies','triggers'].map(key=>[key,m[key].length]));
let base=readFileSync('scripts/continuous-refresh-store.sql','utf8').replace('__REFRESH_SOURCE_REGISTRY__',()=>quote(JSON.stringify(registry))+'::jsonb').replace('__REFRESH_TOPICS__',()=>PUBLIC_TOPICS.map(quote).join(',')).replace(/commit;\s*$/u,'');
const old=readFileSync('supabase/migrations/'+priorRevision+'.sql','utf8');
if(createHash('sha256').update(old).digest('hex')!=='6a2c5ccd0937d5b68c193ecf0534fb89ac5c976deb37fe1810d34934a0ba4c5b')throw Error('HISTORICAL_MIGRATION_DRIFT');
const replaceOnce=(value,from,to)=>{if(value.split(from).length!==2)throw Error('COMPATIBILITY_MARKER_DRIFT:'+from);return value.replace(from,to);};
const definition=name=>{
 const start=old.search(new RegExp('create (?:or replace )?function dlkt_info_private[.]'+name+'\\('));
 const end=old.indexOf('\nend $$;',start);
 if(start<0||end<start)throw Error('BASE_FUNCTION_MISSING:'+name);
 return old.slice(start,end+'\nend $$;'.length).replace(/^create function/u,'create or replace function');
};
let candidate=definition('valid_news_candidate');
candidate=replaceOnce(candidate,"foreach field_name in array array['sourceUrl','title','publisher','indexedAt','category'] loop","foreach field_name in array array['sourceUrl','title','publisher','indexedAt'] loop");
candidate=replaceOnce(candidate,"  if length(p_candidate->>'sourceUrl')", "  if jsonb_typeof(p_candidate->'category') not in ('null','string') then return false; end if;\n  if length(p_candidate->>'sourceUrl')");
const categoryGuard="not (p_candidate->>'category' = any(array["+NEWS_CATEGORY_SOURCES.map(source=>quote(source.id.slice(5))).join(',')+"]))";
candidate=replaceOnce(candidate,categoryGuard,"(p_candidate->'category'<>'null'::jsonb and "+categoryGuard+")");
let share=definition('valid_share_archive_card');
const topics=Object.fromEntries([...NEWS_CATEGORY_SOURCES,NEWS_UNCLASSIFIED_SOURCE].map(source=>[source.id,source.topic]));
share=share.replace(/news_topics constant jsonb := '[^']+'::jsonb;/u,'news_topics constant jsonb := '+quote(JSON.stringify(topics))+'::jsonb;');
share=replaceOnce(share,"or (p_card->>'topic') not in ('technology','business','regulation','opportunities','science','environment','health','public-affairs','world','digital-life','culture','money','space','weather','energy','work-education','housing','travel','food','sport')","or (p_card->>'topic') not in ("+PUBLIC_TOPICS.map(quote).join(',')+")");
share=replaceOnce(share,"  for source_id in select value from jsonb_array_elements_text(p_card->'sourceIds') loop", "  if p_card->>'topic'='other' and (not (p_card->'sourceIds' ? 'news-unclassified')\n    or exists(select 1 from jsonb_array_elements_text(p_card->'sourceIds') as candidate(id) where candidate.id not in ('news-unclassified','editorial-frontpage'))) then return false; end if;\n  for source_id in select value from jsonb_array_elements_text(p_card->'sourceIds') loop");
base=base.replace('__UNCLASSIFIED_NEWS_COMPATIBILITY__',()=>"-- Preserve existing candidates and all immutable shares; only the disposable candidate label becomes nullable.\nalter table public.dlkt_info_news_candidates alter column category drop not null;\n\n"+candidate+'\n\n'+share+'\n');
if(/__(?:REFRESH|UNCLASSIFIED)_/u.test(base))throw Error('UNSEALED_REFRESH_REGISTRY');
let ready=old.slice(old.indexOf('create or replace function public.dlkt_info_read_database_readiness()')).replaceAll(priorRevision,revision).replaceAll(priorHash,hash);
const array=(name,values)=>{const re=new RegExp('  '+name+' text\\[\\] := array\\[[\\s\\S]*?\\]::text\\[\\];');if(!re.test(ready))throw Error('ARRAY_NOT_FOUND:'+name);ready=ready.replace(re,'  '+name+' text[] := array[\n'+values.map(v=>'    '+quote(v)).join(',\n')+'\n  ]::text[];');};
for(const [name,key]of Object.entries({v_required_relations:'relations',v_required_functions:'functions',v_public_functions:'publicFunctions',v_private_functions:'privateFunctions',v_required_rls:'rls',v_required_policies:'policies',v_required_triggers:'triggers'}))array(name,m[key]);
array('v_private_relations',m.relations.filter(value=>value.startsWith('dlkt_info_private.')));
for(const [name,key]of Object.entries({v_public_anon_functions:'publicAnon',v_public_authenticated_functions:'publicAuthenticated',v_public_service_functions:'publicService',v_private_authenticated_functions:'privateAuthenticated',v_private_service_functions:'privateService',v_public_definer_functions:'publicDefiner',v_public_invoker_functions:'publicInvoker',v_private_definer_functions:'privateDefiner',v_private_invoker_functions:'privateInvoker'}))array(name,m.permissions[key]);
const relationSql=relations.map(quote).join(','),functionSql=[...privateFunctions,...publicFunctions].map(value=>quote(value)+'::regprocedure').join(',');
const extra=`  -- Unclassified candidates remain nullable text, with the existing non-null category constraint intact.
  v_public_data_permissions_ok := v_public_data_permissions_ok and exists (
    select 1 from pg_attribute a where a.attrelid='public.dlkt_info_news_candidates'::regclass
      and a.attname='category' and not a.attisdropped and not a.attnotnull and a.atttypid='text'::regtype
  ) and exists (
    select 1 from pg_constraint c where c.conrelid='public.dlkt_info_news_candidates'::regclass
      and c.conname='dlkt_info_news_candidates_category_check' and c.contype='c' and c.convalidated
      and pg_get_expr(c.conbin,c.conrelid)=${quote("(category = ANY (ARRAY["+NEWS_CATEGORY_SOURCES.map(source=>quote(source.id.slice(5))+'::text').join(', ')+"]))")}
  );
  -- Continuous refresh state and receipts are private even from service-role REST access.
  v_private_tables_ok := v_private_tables_ok and coalesce((
    select bool_and(not has_table_privilege(role.name,relation.name,privilege.name)
      and not has_table_privilege(role.name,relation.name,privilege.name || ' WITH GRANT OPTION'))
    from unnest(array['anon','authenticated','service_role']) role(name)
    cross join unnest(array[${relationSql}]) relation(name)
    cross join unnest(v_table_privileges) privilege(name)
  ),false) and coalesce((
    select bool_and(not has_any_column_privilege(role.name,relation.name,privilege.name)
      and not has_any_column_privilege(role.name,relation.name,privilege.name || ' WITH GRANT OPTION'))
    from unnest(array['anon','authenticated','service_role']) role(name)
    cross join unnest(array[${relationSql}]) relation(name)
    cross join unnest(v_column_privileges) privilege(name)
  ),false) and not exists (
    select 1 from pg_class c cross join lateral aclexplode(c.relacl) acl
    where c.oid=any(array[${relations.map(value=>quote(value)+'::regclass').join(',')}]) and acl.grantee=0
  ) and not exists (
    select 1 from pg_attribute a cross join lateral aclexplode(case when cardinality(a.attacl)>0 then a.attacl end) acl
    where a.attrelid=any(array[${relations.map(value=>quote(value)+'::regclass').join(',')}]) and a.attnum>0 and not a.attisdropped
      and case when acl.grantee=0 then true else pg_has_role('anon',acl.grantee,'USAGE') or pg_has_role('authenticated',acl.grantee,'USAGE') or pg_has_role('service_role',acl.grantee,'USAGE') end
  );
  v_search_path_ok := v_search_path_ok and coalesce((select bool_and(p.proconfig @> array['search_path=""']::text[])
    from pg_proc p where p.oid=any(array[${functionSql}])),false);
  v_public_rpc_permissions_ok := v_public_rpc_permissions_ok and not exists (
    select 1 from pg_proc p cross join lateral aclexplode(p.proacl) acl
    where p.oid=any(array[${functionSql}]) and acl.grantee=0
  ) and coalesce((select bool_and(not has_function_privilege(role.name,p.oid,'EXECUTE WITH GRANT OPTION'))
    from pg_proc p cross join unnest(array['anon','authenticated','service_role']) role(name)
    where p.oid=any(array[${functionSql}])),false);
`;
ready=ready.replace('Readiness v2 / schema manifest v4:', 'Readiness v2 / schema manifest v6:');
ready=ready.replace('  v_no_unexpected_objects :=',extra+'\n  v_no_unexpected_objects :=');
const migration=base+'\n'+ready;
writeFileSync('supabase/migrations/'+filename,migration);
writeFileSync('src/provisioning/readiness-manifest.ts',`export const DATABASE_READINESS_VERSION = 'dlkt-info-database-readiness-2' as const;\nexport const SCHEMA_MANIFEST_VERSION = '${version}' as const;\nexport const DATABASE_READINESS_RPC = 'dlkt_info_read_database_readiness' as const;\nexport const DATABASE_READINESS_MIGRATION = '${revision}' as const;\n// SHA-256 of UTF-8 serializeSchemaManifest(); object/array order is part of this versioned contract.\nexport const EXPECTED_SCHEMA_FINGERPRINT = '${hash}' as const;\nexport const EXPECTED_SCHEMA_COUNTS = Object.freeze(${JSON.stringify(counts,null,2)} as const);\nexport const EXPECTED_SCHEMA_MANIFEST = Object.freeze(${JSON.stringify(m,null,2)} as const);\nexport function serializeSchemaManifest():string{return JSON.stringify({version:SCHEMA_MANIFEST_VERSION,manifest:EXPECTED_SCHEMA_MANIFEST});}\n`);
for(const file of ['tests/database/database-readiness-attestation.test.mjs','tests/experience.test.mjs','tests/provisioning-control.test.mjs','tests/identity.test.mjs','tests/persistence.test.mjs']){
  let fixture=readFileSync(file,'utf8').replaceAll(priorRevision,revision).replaceAll(priorHash,hash).replaceAll(previousHash,hash).replaceAll('dlkt-info-schema-manifest-5',version);
  for(const [key,before,after]of [['relations',30,counts.relations],['functions',52,counts.functions],['rls',18,counts.rls]])fixture=fixture.replaceAll(`${key}Expected: ${before}, ${key}Present: ${before}, ${key}Total: ${before}`,`${key}Expected: ${after}, ${key}Present: ${after}, ${key}Total: ${after}`);
  writeFileSync(file,fixture);
}
writeFileSync('../evidence/continuous-refresh-schema.json',JSON.stringify({revision,hash,version,counts,migrationBytes:Buffer.byteLength(migration)},null,2)+'\n');
console.log(JSON.stringify({revision,hash,version,counts,migrationBytes:Buffer.byteLength(migration)}));
