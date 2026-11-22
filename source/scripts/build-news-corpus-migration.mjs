import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';

function buildNewsCorpusMigration(files,sha256){
 const priorRevision='20261122174603_dlkt_info_news_coverage',revision='20261122200813_dlkt_info_news_corpus';
 const priorHash='453dbf1779705cff24a46781bbdae8871db5d24af5c3b16a1c85d65af4fc19db',priorVersion='dlkt-info-schema-manifest-7',version='dlkt-info-schema-manifest-8';
 const source=files['src/provisioning/readiness-manifest.ts'];
 const match=source.match(/EXPECTED_SCHEMA_MANIFEST = Object.freeze\((\{[\s\S]*\}) as const\);/u);
 if(!match)throw Error('BASE_MANIFEST_INVALID');
 const m=JSON.parse(match[1]);
 const oldHash=source.match(/EXPECTED_SCHEMA_FINGERPRINT = '([a-f0-9]{64})'/u)?.[1];
 const relations=['dlkt_info_private.news_corpus_epochs'];
 const privateFunctions=['dlkt_info_private.valid_news_diagnostics(jsonb, timestamp with time zone)','dlkt_info_private.news_fold(text)','dlkt_info_private.news_local_anchors(text, text)','dlkt_info_private.valid_news_local_article(jsonb, jsonb, timestamp with time zone)','dlkt_info_private.valid_news_corpus(jsonb, timestamp with time zone)','dlkt_info_private.publish_news_corpus(bigint, bigint, timestamp with time zone)'];
 const publicFunctions=['public.dlkt_info_stage_news_corpus(uuid, bigint, jsonb, text, jsonb)','public.dlkt_info_read_news_corpus(bigint)','public.dlkt_info_find_news_corpus_article(text, text, text, bigint)'];
 if(source.includes("SCHEMA_MANIFEST_VERSION = '"+version+"'")){
  if(!source.includes("DATABASE_READINESS_MIGRATION = '"+revision+"'"))throw Error('REVISION_MISMATCH');
  for(const key of ['relations','rls'])m[key]=m[key].filter(v=>!relations.includes(v));
  for(const key of ['functions','publicFunctions','privateFunctions'])m[key]=m[key].filter(v=>![...privateFunctions,...publicFunctions].includes(v));
  for(const key of ['publicAnon','publicAuthenticated','publicService','publicDefiner'])m.permissions[key]=m.permissions[key].filter(v=>!publicFunctions.includes(v));
  m.permissions.privateInvoker=m.permissions.privateInvoker.filter(v=>!privateFunctions.includes(v));
  delete m.newsCorpusPermissions;
 }else if(!source.includes("DATABASE_READINESS_MIGRATION = '"+priorRevision+"'"))throw Error('BASE_REVISION_MISMATCH');
 if(sha256(JSON.stringify({version:priorVersion,manifest:m}))!==priorHash)throw Error('BASE_MANIFEST_DRIFT');
 const quote=v=>"'"+v.replaceAll("'","''")+"'";
 const add=(a,...v)=>{for(const x of v)if(!a.includes(x))a.push(x);};
 add(m.relations,...relations);add(m.rls,...relations);add(m.functions,...privateFunctions,...publicFunctions);add(m.publicFunctions,...publicFunctions);add(m.privateFunctions,...privateFunctions);
 for(const key of ['publicAnon','publicAuthenticated','publicService','publicDefiner'])add(m.permissions[key],...publicFunctions);
 add(m.permissions.privateInvoker,...privateFunctions);
 m.newsCorpusPermissions={
  relations,tableRoles:{PUBLIC:[],anon:[],authenticated:[],service_role:[]},policies:[],explicitColumnAcls:[],fixedFunctionSearchPath:'',
  writerAuthentication:'Existing purpose-bound x-dlkt-share-write header on all corpus RPCs',
  maximumCorpusBytes:8388608,maximumArticles:5000,maximumEpochs:64,epochRetentionSeconds:3600,
  immutableEpoch:true,atomicSnapshotCorpusAndDiagnostics:true,leaseAndFenceRequired:true,
  diagnostics:{version:'dlkt-news-diagnostics-1',maximumBytes:65536,maximumGroups:256,privateColumns:['public_refresh_state.news_diagnostics','public_refresh_runs.news_diagnostics','news_corpus_epochs.diagnostics'],publiclyReadable:false},
  validity:{globalPublishedHours:24,globalObservedSeconds:3600,localPublishedHours:72,localCheckedSeconds:300,rightsReviewRequired:true},
  page:{version:'dlkt-news-page-1',maximumItems:20,orderVersion:'iptc17-rounds-started-20261122',signedCursor:'HMAC with separate domain derived from existing writer key',pins:['epoch','digest','startedAt','language','city','filter','orderVersion','offset','expiry'],publicRequestCollectsSources:false},
  articleSubject:{basis:'publisher-jsonld',canonicalArticleUrlRequired:true,maximumSections:8,maximumKeywords:12,maximumTermCodepoints:80,normalization:'NFC, single whitespace, no markup or control characters',uniqueArrays:true,arrayOrderHashed:true,optionalForExistingRevisions:true}
 };
 const hash=sha256(JSON.stringify({version,manifest:m}));
 const counts=Object.fromEntries(['relations','functions','publicFunctions','privateFunctions','rls','policies','triggers'].map(k=>[k,m[k].length]));
 const old=files['supabase/migrations/'+priorRevision+'.sql'];
 if(!old.includes(priorHash)||!old.includes(priorRevision))throw Error('PRIOR_READINESS_DRIFT');
 const refresh=files['scripts/continuous-refresh-store.sql'];
 const start=refresh.indexOf('create function public.dlkt_info_publish_public_snapshot('),end=refresh.indexOf('\nend $$;',start);
 if(start<0||end<start)throw Error('PUBLISH_FUNCTION_MISSING');
 let publish=refresh.slice(start,end+'\nend $$;'.length).replace(/^create function/u,'create or replace function');
 const marker='  update dlkt_info_private.public_refresh_state set snapshot=p_snapshot';
 if(publish.split(marker).length!==2)throw Error('PUBLISH_HOOK_DRIFT');
 publish=publish.replace(marker,'  -- Publish the staged corpus and its private diagnostics under this same lease and revision.\n  perform dlkt_info_private.publish_news_corpus(p_fence,s.revision+1,g);\n'+marker);
 let ready=old.slice(old.indexOf('create or replace function public.dlkt_info_read_database_readiness()')).replaceAll(priorRevision,revision).replaceAll(priorHash,hash);
 if(!ready.startsWith('create or replace function'))throw Error('READINESS_FUNCTION_MISSING');
 const array=(name,values)=>{const re=new RegExp('  '+name+' text\\[\\] := array\\[[\\s\\S]*?\\]::text\\[\\];');if(!re.test(ready))throw Error('ARRAY_NOT_FOUND:'+name);ready=ready.replace(re,'  '+name+' text[] := array[\n'+values.map(v=>'    '+quote(v)).join(',\n')+'\n  ]::text[];');};
 for(const [name,key] of Object.entries({v_required_relations:'relations',v_required_functions:'functions',v_public_functions:'publicFunctions',v_private_functions:'privateFunctions',v_required_rls:'rls',v_required_policies:'policies',v_required_triggers:'triggers'}))array(name,m[key]);
 array('v_private_relations',m.relations.filter(v=>v.startsWith('dlkt_info_private.')));
 for(const [name,key]of Object.entries({v_public_anon_functions:'publicAnon',v_public_authenticated_functions:'publicAuthenticated',v_public_service_functions:'publicService',v_private_authenticated_functions:'privateAuthenticated',v_private_service_functions:'privateService',v_public_definer_functions:'publicDefiner',v_public_invoker_functions:'publicInvoker',v_private_definer_functions:'privateDefiner',v_private_invoker_functions:'privateInvoker'}))array(name,m.permissions[key]);
 const functionSql=[...privateFunctions,...publicFunctions].map(v=>quote(v)+'::regprocedure').join(',');
 const extra=[
 '  -- Corpus and diagnostics stay private; only purpose-bound server RPCs can access them.',
 '  v_private_tables_ok := v_private_tables_ok and coalesce((',
 '    select bool_and(not has_table_privilege(role.name,relation.name,privilege.name)',
 "      and not has_table_privilege(role.name,relation.name,privilege.name || ' WITH GRANT OPTION'))",
 "    from unnest(array['anon','authenticated','service_role']) role(name)",
 "    cross join unnest(array['dlkt_info_private.news_corpus_epochs']) relation(name)",
 '    cross join unnest(v_table_privileges) privilege(name)',
 '  ),false) and coalesce((',
 '    select bool_and(not has_any_column_privilege(role.name,relation.name,privilege.name)',
 "      and not has_any_column_privilege(role.name,relation.name,privilege.name || ' WITH GRANT OPTION'))",
 "    from unnest(array['anon','authenticated','service_role']) role(name)",
 "    cross join unnest(array['dlkt_info_private.news_corpus_epochs']) relation(name)",
 '    cross join unnest(v_column_privileges) privilege(name)',
 '  ),false) and not exists (',
 '    select 1 from pg_class c cross join lateral aclexplode(c.relacl) acl',
 "    where c.oid='dlkt_info_private.news_corpus_epochs'::regclass and acl.grantee=0",
 '  ) and not exists (',
 '    select 1 from pg_attribute a cross join lateral aclexplode(case when cardinality(a.attacl)>0 then a.attacl end) acl',
 "    where a.attrelid='dlkt_info_private.news_corpus_epochs'::regclass and a.attnum>0 and not a.attisdropped",
 "      and case when acl.grantee=0 then true else pg_has_role('anon',acl.grantee,'USAGE') or pg_has_role('authenticated',acl.grantee,'USAGE') or pg_has_role('service_role',acl.grantee,'USAGE') end",
 '  );',
 "  v_search_path_ok := v_search_path_ok and coalesce((select bool_and(p.proconfig @> array['search_path=\"\"']::text[])",
 '    from pg_proc p where p.oid=any(array['+functionSql+'])),false);',
 '  v_public_rpc_permissions_ok := v_public_rpc_permissions_ok and not exists (',
 '    select 1 from pg_proc p cross join lateral aclexplode(p.proacl) acl',
 '    where p.oid=any(array['+functionSql+']) and acl.grantee=0',
 "  ) and coalesce((select bool_and(not has_function_privilege(role.name,p.oid,'EXECUTE WITH GRANT OPTION'))",
 "    from pg_proc p cross join unnest(array['anon','authenticated','service_role']) role(name)",
 '    where p.oid=any(array['+functionSql+'])),false);',
 '  v_private_tables_ok := v_private_tables_ok and 2 = (',
 "    select count(*) from pg_attribute a where a.attrelid=any(array['dlkt_info_private.public_refresh_state'::regclass,'dlkt_info_private.public_refresh_runs'::regclass])",
 "      and a.attname='news_diagnostics' and not a.attisdropped and a.atttypid='jsonb'::regtype",
 '  ) and 2 = (',
 "    select count(*) from pg_constraint c where (c.conrelid='dlkt_info_private.public_refresh_state'::regclass and c.conname='public_refresh_news_diagnostics_size'",
 "      or c.conrelid='dlkt_info_private.public_refresh_runs'::regclass and c.conname='public_refresh_run_news_diagnostics_size') and c.contype='c' and c.convalidated",
 '  );'
 ].join('\n')+'\n';
 if(ready.split('  v_no_unexpected_objects :=').length!==2)throw Error('READINESS_INSERTION_DRIFT');
 ready=ready.replace('  v_no_unexpected_objects :=',extra+'\n  v_no_unexpected_objects :=').replace('Readiness v2 / schema manifest v7:','Readiness v2 / schema manifest v8:');
 const migration='-- Verified news corpus, atomic publication, private source diagnostics and canonical subject metadata.\nbegin;\n\n'+files['scripts/news-subject-store.sql']+'\n'+files['scripts/news-corpus-store.sql']+'\n'+publish+'\n\n'+ready;
 const result={};
 result['supabase/migrations/'+revision+'.sql']=migration;
 result['src/provisioning/readiness-manifest.ts']="export const DATABASE_READINESS_VERSION = 'dlkt-info-database-readiness-2' as const;\nexport const SCHEMA_MANIFEST_VERSION = '"+version+"' as const;\nexport const DATABASE_READINESS_RPC = 'dlkt_info_read_database_readiness' as const;\nexport const DATABASE_READINESS_MIGRATION = '"+revision+"' as const;\n// SHA-256 of UTF-8 serializeSchemaManifest(); object/array order is part of this versioned contract.\nexport const EXPECTED_SCHEMA_FINGERPRINT = '"+hash+"' as const;\nexport const EXPECTED_SCHEMA_COUNTS = Object.freeze("+JSON.stringify(counts,null,2)+" as const);\nexport const EXPECTED_SCHEMA_MANIFEST = Object.freeze("+JSON.stringify(m,null,2)+" as const);\nexport function serializeSchemaManifest():string{return JSON.stringify({version:SCHEMA_MANIFEST_VERSION,manifest:EXPECTED_SCHEMA_MANIFEST});}\n";
 for(const p of ['tests/database/database-readiness-attestation.test.mjs','tests/experience.test.mjs','tests/provisioning-control.test.mjs','tests/identity.test.mjs','tests/persistence.test.mjs','verify-release.mjs']){
  let f=files[p].replaceAll(priorRevision,revision).replaceAll(priorHash,hash).replaceAll(oldHash,hash).replaceAll(priorVersion,version);
  for(const [k,before]of [['relations',32],['functions',58],['rls',20]])f=f.replaceAll(k+'Expected: '+before+', '+k+'Present: '+before+', '+k+'Total: '+before,k+'Expected: '+counts[k]+', '+k+'Present: '+counts[k]+', '+k+'Total: '+counts[k]);
  if(p==='verify-release.mjs')for(const [key,before]of [['relations',32],['functions',58],['rls',20]])f=f.replaceAll('"'+key+'": '+before,'"'+key+'": '+counts[key]);
  result[p]=f;
 }
 return {files:result,evidence:{revision,version,hash,counts,migrationSha256:sha256(migration)}};
}

const required=[
  "src/provisioning/readiness-manifest.ts",
  "supabase/migrations/20261122174603_dlkt_info_news_coverage.sql",
  "scripts/continuous-refresh-store.sql",
  "scripts/news-subject-store.sql",
  "scripts/news-corpus-store.sql",
  "tests/database/database-readiness-attestation.test.mjs",
  "tests/experience.test.mjs",
  "tests/provisioning-control.test.mjs",
  "tests/identity.test.mjs",
  "tests/persistence.test.mjs",
  "verify-release.mjs"
];
const inputs=Object.fromEntries(required.map(path=>[path,readFileSync(path,'utf8')]));
const output=buildNewsCorpusMigration(inputs,value=>createHash('sha256').update(value).digest('hex'));
if(process.argv.includes('--check')){
 for(const [path,content]of Object.entries(output.files))if(readFileSync(path,'utf8')!==content)throw Error('NEWS_CORPUS_GENERATED_DRIFT:'+path);
}else for(const [path,content]of Object.entries(output.files))writeFileSync(path,content);
console.log(JSON.stringify(output.evidence));
