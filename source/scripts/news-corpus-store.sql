-- Immutable verified news epochs. Apply after news-subject-store.sql; no new credentials.
alter table dlkt_info_private.public_refresh_state add column news_diagnostics jsonb;
alter table dlkt_info_private.public_refresh_runs add column news_diagnostics jsonb;
alter table dlkt_info_private.public_refresh_state add constraint public_refresh_news_diagnostics_size check(news_diagnostics is null or octet_length(news_diagnostics::text)<=65536);
alter table dlkt_info_private.public_refresh_runs add constraint public_refresh_run_news_diagnostics_size check(news_diagnostics is null or octet_length(news_diagnostics::text)<=65536);

create table dlkt_info_private.news_corpus_epochs (
 fence bigint primary key check(fence between 1 and 9007199254740991),
 lease_token uuid not null, corpus jsonb not null, digest text not null check(digest ~ '^[a-f0-9]{64}$'),
 generated_at timestamptz not null, expires_at timestamptz not null,
 revision bigint unique check(revision between 1 and 9007199254740991), published_at timestamptz,
 diagnostics jsonb,
 check(jsonb_typeof(corpus)='object' and octet_length(corpus::text)<=8388608),
 check((revision is null)=(published_at is null)),
 check(expires_at=generated_at+interval '1 hour'),
 check(diagnostics is null or octet_length(diagnostics::text)<=65536)
);
alter table dlkt_info_private.news_corpus_epochs enable row level security;
revoke all on dlkt_info_private.news_corpus_epochs from public,anon,authenticated,service_role;
create index news_corpus_expiry on dlkt_info_private.news_corpus_epochs(expires_at);
comment on table dlkt_info_private.news_corpus_epochs is 'Immutable full verified public article metadata, private staging and bounded one-hour epoch retention. No account data or article bodies.';

-- Proposed private validator only; this text has not been applied to a database.
-- Mirrors news-diagnostics.ts at publisher catalog72 / direct indexes26.
create or replace function dlkt_info_private.valid_news_diagnostics(p_diagnostics jsonb,p_now timestamptz default statement_timestamp())
returns boolean language plpgsql stable set search_path='' as $fn$
declare
  publisher_ids text[] := array['reuters','ap','bbc','guardian','ft','cnbc','france24','dw','aljazeera','npr','rte','cnn','abc-au','cbc','euronews','politico','bloomberg','business-insider','fortune','techcrunch','the-verge','ars-technica','wired','engadget','nvidia','anthropic','rockstar','playstation','ign','pcgamer','eurogamer','gamespot','variety','billboard','hollywood-reporter','deadline','espn','sky-sports','olympics','parents','edweek','nature','science','live-science','scientific-american','space','national-geographic','new-scientist','travel-leisure','skift','lonely-planet','conde-nast-traveler','good-housekeeping','consumer-reports','which','food-wine','food-safety-news','architectural-digest','dezeen','weather-channel','accuweather','carbon-brief','global-voices','360info','scmp','the-hindu','japan-times','cna','straits-times','nytimes','digi24','hotnews'];
  language_ids text[] := array['en','fr','ja','es','ar','de','pt-BR','pt-002','sq','am','bn','bs','bg','zh-Hans','zh-Hant','hr','fa-AF','el','ha','hi','id','sw','mk','ps','fa-IR','pl','ro','ru','sr','tr','uk','ur'];
  reason_ids text[] := array['index-identity','index-schema','index-stale','index-unavailable','access-denied','rate-limited','http-unavailable','timeout','deadline','request-capacity','origin-backoff','redirect','content-type','response-size','empty-response','metadata-unverified','identity-conflict','duplicate','request-unavailable','rights-review-expired','candidate-store'];
  counter_keys text[] := array['freshDiscovered','pool','scheduled','attempted','requestAttempts','verifiedNow','rejected','duplicates','deferredCapacity','deferredBeforeAttempt','retained'];
  index_identity jsonb := '{"gdelt-gal":{"publisherId":null,"language":null},"digi24-ro-news":{"publisherId":"digi24","language":"ro"},"hotnews-ro-news":{"publisherId":"hotnews","language":"ro"},"guardian-news":{"publisherId":"guardian","language":"en"},"ap-news":{"publisherId":"ap","language":null},"bbc-news":{"publisherId":"bbc","language":null},"verge-news":{"publisherId":"the-verge","language":"en"},"pcgamer-news":{"publisherId":"pcgamer","language":"en"},"live-science-news":{"publisherId":"live-science","language":"en"},"parents-news":{"publisherId":"parents","language":"en"},"travel-leisure-news":{"publisherId":"travel-leisure","language":null},"food-wine-news":{"publisherId":"food-wine","language":null},"good-housekeeping-news":{"publisherId":"good-housekeeping","language":null},"education-week-news":{"publisherId":"edweek","language":"en"},"weather-channel-news":{"publisherId":"weather-channel","language":null},"the-hindu-news":{"publisherId":"the-hindu","language":"en"},"dw-ro-news":{"publisherId":"dw","language":"ro"},"dw-de-news":{"publisherId":"dw","language":"de"},"dw-fr-news":{"publisherId":"dw","language":"fr"},"dw-es-news":{"publisherId":"dw","language":"es"},"dw-ar-news":{"publisherId":"dw","language":"ar"},"france24-en-news":{"publisherId":"france24","language":"en"},"france24-fr-news":{"publisherId":"france24","language":"fr"},"france24-es-news":{"publisherId":"france24","language":"es"},"france24-ar-news":{"publisherId":"france24","language":"ar"},"japan-times-news":{"publisherId":"japan-times","language":"en"},"guardian-africa-news":{"publisherId":"guardian","language":"en"}}'::jsonb;
  totals_acc jsonb := '{"freshDiscovered":0,"pool":0,"scheduled":0,"attempted":0,"requestAttempts":0,"verifiedNow":0,"rejected":0,"duplicates":0,"deferredCapacity":0,"deferredBeforeAttempt":0,"retained":0}'::jsonb;
  stamp_pattern text := '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$';
  counts jsonb; item jsonb; detail jsonb; expected jsonb;
  field text; item_key text; code text; checked timestamptz; verified timestamptz;
  seen_groups text[] := array[]::text[]; seen_indexes text[] := array[]::text[];
  seen_reasons text[]; seen_issues text[] := array[]::text[]; reason_total bigint;
begin
  if p_diagnostics is null or p_now is null or not isfinite(p_now)
    or jsonb_typeof(p_diagnostics) is distinct from 'object' or octet_length(p_diagnostics::text)>65536
    or not p_diagnostics ?& array['version','checkedAt','indexes','groups','totals','issues']
    or exists(select 1 from jsonb_object_keys(p_diagnostics) k where k<>all(array['version','checkedAt','indexes','groups','totals','issues']))
    or jsonb_typeof(p_diagnostics->'version') is distinct from 'string'
    or p_diagnostics->>'version'<>'dlkt-news-diagnostics-1'
    or jsonb_typeof(p_diagnostics->'checkedAt') is distinct from 'string' or p_diagnostics->>'checkedAt' !~ stamp_pattern
    or jsonb_typeof(p_diagnostics->'indexes') is distinct from 'array' or jsonb_array_length(p_diagnostics->'indexes')>27
    or jsonb_typeof(p_diagnostics->'groups') is distinct from 'array' or jsonb_array_length(p_diagnostics->'groups')>256
    or jsonb_typeof(p_diagnostics->'issues') is distinct from 'array' or jsonb_array_length(p_diagnostics->'issues')>cardinality(reason_ids)
    then return false; end if;
  checked:=(p_diagnostics->>'checkedAt')::timestamptz;
  if not isfinite(checked) or checked>p_now+interval '5 minutes'
    or to_char(checked at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>p_diagnostics->>'checkedAt'
    then return false; end if;
  for counts in select p_diagnostics->'totals' union all select value->'counts' from jsonb_array_elements(p_diagnostics->'groups') loop
    if jsonb_typeof(counts) is distinct from 'object' or not counts ?& counter_keys
      or exists(select 1 from jsonb_object_keys(counts) k where k<>all(counter_keys)) then return false; end if;
    foreach field in array counter_keys loop
      if jsonb_typeof(counts->field) is distinct from 'number' or counts->>field !~ '^[0-9]+$'
        or (counts->>field)::numeric>140000 then return false; end if;
    end loop;
    if (counts->>'pool')::bigint<>(counts->>'scheduled')::bigint+(counts->>'deferredCapacity')::bigint
      or (counts->>'scheduled')::bigint<>(counts->>'attempted')::bigint+(counts->>'deferredBeforeAttempt')::bigint
      or (counts->>'attempted')::bigint<>(counts->>'verifiedNow')::bigint+(counts->>'rejected')::bigint+(counts->>'duplicates')::bigint
      or (counts->>'requestAttempts')::bigint<(counts->>'attempted')::bigint then return false; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_diagnostics->'indexes') loop
    if jsonb_typeof(item) is distinct from 'object' or not item ?& array['indexId','publisherId','language','attempted','state','checkedAt','reason']
      or exists(select 1 from jsonb_object_keys(item) k where k<>all(array['indexId','publisherId','language','attempted','state','checkedAt','reason']))
      or jsonb_typeof(item->'indexId') is distinct from 'string' or jsonb_typeof(item->'attempted') is distinct from 'boolean'
      or item->'checkedAt' is distinct from p_diagnostics->'checkedAt'
      or jsonb_typeof(item->'state') is distinct from 'string'
      or item->>'state' not in ('verified','unavailable','deferred') then return false; end if;
    item_key:=item->>'indexId';
    if not index_identity ? item_key or item_key=any(seen_indexes) then return false; end if;
    seen_indexes:=array_append(seen_indexes,item_key);expected:=index_identity->item_key;
    if item->'publisherId' is distinct from expected->'publisherId' or item->'language' is distinct from expected->'language' then return false; end if;
    if item->>'state'='verified' then
      if item->'attempted'<>'true'::jsonb or item->'reason'<>'null'::jsonb then return false; end if;
    else
      if jsonb_typeof(item->'reason') is distinct from 'string' or not (item->>'reason'=any(reason_ids))
        or (item->>'state'='unavailable' and item->'attempted'<>'true'::jsonb)
        or (item->>'state'='deferred' and item->'attempted'<>'false'::jsonb) then return false; end if;
    end if;
  end loop;
  for item in select value from jsonb_array_elements(p_diagnostics->'groups') loop
    if jsonb_typeof(item) is distinct from 'object' or not item ?& array['publisherId','language','counts','reasons','lastAttemptAt','lastVerifiedAt']
      or exists(select 1 from jsonb_object_keys(item) k where k<>all(array['publisherId','language','counts','reasons','lastAttemptAt','lastVerifiedAt']))
      or jsonb_typeof(item->'publisherId') is distinct from 'string' or not (item->>'publisherId'=any(publisher_ids))
      or not (item->'language'='null'::jsonb or jsonb_typeof(item->'language')='string' and item->>'language'=any(language_ids))
      or jsonb_typeof(item->'reasons') is distinct from 'array' or jsonb_array_length(item->'reasons')>cardinality(reason_ids)
      then return false; end if;
    item_key:=(item->>'publisherId')||'|'||coalesce(item->>'language','');
    if item_key=any(seen_groups) then return false; end if;seen_groups:=array_append(seen_groups,item_key);
    counts:=item->'counts';seen_reasons:=array[]::text[];reason_total:=0;
    for detail in select value from jsonb_array_elements(item->'reasons') loop
      if jsonb_typeof(detail) is distinct from 'object' or not detail ?& array['code','count']
        or exists(select 1 from jsonb_object_keys(detail) k where k<>all(array['code','count']))
        or jsonb_typeof(detail->'code') is distinct from 'string' or not (detail->>'code'=any(reason_ids))
        or jsonb_typeof(detail->'count') is distinct from 'number' or detail->>'count' !~ '^[0-9]+$'
        or (detail->>'count')::numeric not between 1 and 140000 then return false; end if;
      code:=detail->>'code';if code=any(seen_reasons) then return false; end if;
      seen_reasons:=array_append(seen_reasons,code);reason_total:=reason_total+(detail->>'count')::bigint;
    end loop;
    if reason_total<>(counts->>'rejected')::bigint+(counts->>'duplicates')::bigint+(counts->>'deferredCapacity')::bigint+(counts->>'deferredBeforeAttempt')::bigint then return false; end if;
    if (counts->>'attempted')::bigint>0 then
      if item->'lastAttemptAt' is distinct from p_diagnostics->'checkedAt' then return false; end if;
    elsif item->'lastAttemptAt'<>'null'::jsonb then return false; end if;
    if (counts->>'verifiedNow')::bigint+(counts->>'retained')::bigint>0 then
      if jsonb_typeof(item->'lastVerifiedAt') is distinct from 'string' or item->>'lastVerifiedAt' !~ stamp_pattern then return false; end if;
      verified:=(item->>'lastVerifiedAt')::timestamptz;
      if not isfinite(verified) or verified>checked+interval '5 minutes'
        or to_char(verified at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>item->>'lastVerifiedAt'
        or ((counts->>'verifiedNow')::bigint>0 and verified<checked) then return false; end if;
    elsif item->'lastVerifiedAt'<>'null'::jsonb then return false; end if;
    foreach field in array counter_keys loop
      totals_acc:=jsonb_set(totals_acc,array[field],to_jsonb((totals_acc->>field)::bigint+(counts->>field)::bigint));
    end loop;
  end loop;
  for item in select value from jsonb_array_elements(p_diagnostics->'issues') loop
    if jsonb_typeof(item) is distinct from 'string' then return false; end if;code:=item#>>'{}';
    if not code=any(reason_ids) or code=any(seen_issues) then return false; end if;seen_issues:=array_append(seen_issues,code);
  end loop;
  return totals_acc=p_diagnostics->'totals'
    and (totals_acc->>'pool')::bigint<=5000 and (totals_acc->>'scheduled')::bigint<=80
    and (totals_acc->>'requestAttempts')::bigint<=80 and (totals_acc->>'retained')::bigint<=5000;
exception when others then return false;
end;
$fn$;
revoke all on function dlkt_info_private.valid_news_diagnostics(jsonb,timestamptz) from public,anon,authenticated,service_role;

create function dlkt_info_private.news_fold(p_value text)
returns text language sql immutable strict set search_path='' as $$
 select lower(regexp_replace(normalize(p_value,NFD),U&'[\0300-\036f]','','g'));
$$;

create function dlkt_info_private.news_local_anchors(p_title text,p_summary text)
returns jsonb language plpgsql immutable set search_path='' as $$
declare raw text:=p_title||case when p_summary is null then '' else ' '||p_summary end;
 value text; patterns text[]:=array['\y(bucuresti|bucharest)\y','\ysector(ul|ului)?\s*[1-6]\y','\y(metrorex|termoenergetica|pmb)\y','\y(drumul taberei|vatra noua|colosseum mall|pajura|parcul pantelimon|aleea privighetorilor|calea victoriei|piata universitatii)\y'];
 outside_city boolean; result jsonb:='[]'; pattern text; matched text; anchor text; position integer; occurrence integer; index integer;
begin
 value:=dlkt_info_private.news_fold(raw);
 outside_city:=value ~ '\y(ganeasa|voluntari|tribunalul ilfov|judetul ilfov)\y'
  or value ~ '\y(langa|aproape de|in apropierea|din apropierea)\s+bucuresti\y';
 for index in 1..4 loop
  if index=1 and outside_city then continue; end if;
  pattern:=patterns[index];
  for occurrence in 1..200 loop
   matched:=regexp_substr(value,pattern,1,occurrence);
   exit when matched is null;
   position:=regexp_instr(value,pattern,1,occurrence);
   anchor:=substr(raw,position,length(matched));
   if not exists(select 1 from jsonb_array_elements_text(result) entry where dlkt_info_private.news_fold(entry)=dlkt_info_private.news_fold(anchor)) then
    result:=result||jsonb_build_array(anchor);
    if jsonb_array_length(result)=6 then return result; end if;
   end if;
  end loop;
 end loop;
 return result;
end $$;

create function dlkt_info_private.valid_news_local_article(p_article jsonb,p_city jsonb,p_now timestamptz)
returns boolean language plpgsql immutable set search_path='' as $$
declare required text[]:=array['id','sourceId','title','publisher','url','publishedAt','checkedAt','validUntil','topic','cityId','geographyBasis','geoAnchors','documentHash','documentUrl','attribution'];
 field text; source_id text; source_url text; publisher text; attribution text; allowed integer; checked timestamptz; published timestamptz; until_at timestamptz; value text; topic text;
begin
 if jsonb_typeof(p_article) is distinct from 'object' or jsonb_typeof(p_city) is distinct from 'object' or p_now is null or not isfinite(p_now)
  or not p_article ?& required or exists(select 1 from jsonb_object_keys(p_article) key where not(key=any(required||array['summary','byline','licenseUrl'])))
  or p_city->>'id' is distinct from '683506' or p_city->>'countryCode' is distinct from 'RO' or p_city->>'timezone' is distinct from 'Europe/Bucharest'
  or to_char(p_now at time zone 'UTC','YYYY-MM-DD')>'2026-12-18' then return false; end if;
 foreach field in array required loop
  if field<>'geoAnchors' and jsonb_typeof(p_article->field) is distinct from 'string' then return false; end if;
 end loop;
 source_id:=p_article->>'sourceId';
 if source_id='bucharest-b365' then
  source_url:='https://b365.ro/feed/';publisher:='B365';allowed:=250;
  attribution:='Source: B365. Publisher headline and optional short excerpt. Read the original article for its full context.';
  if p_article->>'url' !~ '^https://b365[.]ro/[a-z0-9-]+-[0-9]{4,}/$' or p_article ? 'byline' or p_article ? 'licenseUrl' then return false; end if;
 elsif source_id='bucharest-buletin' then
  source_url:='https://buletin.de/bucuresti/feed/';publisher:='Buletin de București';allowed:=500;
  attribution:='Source: Buletin de București. CC BY 4.0. Publisher headline and optional excerpt selected from the feed; the excerpt may be shortened. Read the original article.';
  if p_article->>'url' !~ '^https://buletin[.]de/bucuresti/[a-z0-9]+(-[a-z0-9]+)+/$'
   or p_article->>'url' in ('https://buletin.de/bucuresti/termeni-si-conditii/','https://buletin.de/bucuresti/politica-de-confidentialitate/')
   or jsonb_typeof(p_article->'licenseUrl') is distinct from 'string' or p_article->>'licenseUrl'<>'https://creativecommons.org/licenses/by/4.0/'
   or jsonb_typeof(p_article->'byline') is distinct from 'string' or length(p_article->>'byline') not between 4 and 205 or p_article->>'byline' not like 'By %'
   or p_article->>'byline' ~ '[<>[:cntrl:]]' then return false; end if;
 else return false; end if;
 if p_article->>'cityId'<>'683506' or p_article->>'publisher'<>publisher or p_article->>'documentUrl'<>source_url or p_article->>'attribution'<>attribution
  or p_article->>'id'<>'local-news:683506:'||source_id||':'||substr(encode(sha256(convert_to(p_article->>'url','UTF8')),'hex'),1,24)
  or length(p_article->>'url')>2000 or p_article->>'documentHash' !~ '^[a-f0-9]{64}$'
  or length(p_article->>'title') not between 1 and least(300,allowed) or p_article->>'title' ~ '[<>[:cntrl:]]'
  or p_article->>'geographyBasis'<>'article-place-reference' or jsonb_typeof(p_article->'geoAnchors') is distinct from 'array'
  or jsonb_array_length(p_article->'geoAnchors') not between 1 and 6 then return false; end if;
 if p_article ? 'summary' and (jsonb_typeof(p_article->'summary') is distinct from 'string' or length(p_article->>'summary') not between 1 and allowed or p_article->>'summary' ~ '[<>[:cntrl:]]') then return false; end if;
 if length(p_article->>'title')+(case when p_article ? 'summary' then length(p_article->>'summary')+1 else 0 end)>allowed then return false; end if;
 foreach field in array array['publishedAt','checkedAt','validUntil'] loop
  if p_article->>field !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
   or to_char((p_article->>field)::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>p_article->>field then return false; end if;
 end loop;
 checked:=(p_article->>'checkedAt')::timestamptz;published:=(p_article->>'publishedAt')::timestamptz;until_at:=(p_article->>'validUntil')::timestamptz;
 if not isfinite(checked) or not isfinite(published) or checked>p_now+interval '5 seconds' or checked<=p_now-interval '5 minutes'
  or published>p_now+interval '5 minutes' or published<p_now-interval '72 hours' or until_at<>checked+interval '5 minutes' or until_at<=p_now then return false; end if;
 if p_article->'geoAnchors'<>dlkt_info_private.news_local_anchors(p_article->>'title',p_article->>'summary') then return false; end if;
 value:=dlkt_info_private.news_fold((p_article->>'title')||case when p_article ? 'summary' then ' '||(p_article->>'summary') else '' end);
 topic:=case
  when value ~ '\y(termoficare|termoenergetica|apa calda|caldura|avarii|distributie a apei)\y' then 'utilities'
  when value ~ '\y(scoala|scoli|liceu|liceul|elevi|gradinita|gradinite|universitate|educatie)\y' then 'education'
  when value ~ '\y(deseuri|mediu|spatii verzi|poluare|garda de mediu)\y' then 'environment'
  when value ~ '\y(agresiune|arest|incendiu|evacuare|accident|politisti|politia)\y' then 'safety'
  when value ~ '\y(metrorex|metrou|magistrala|tramvai|autobuz|trafic|transport|trenuri|statie)\y' then 'transport'
  when value ~ '\y(festival|concert|eveniment|spectacol|targ|craciun)\y' then 'events'
  when value ~ '\y(muzeu|teatru|expozitie|cultura|cinema)\y' then 'culture'
  when value ~ '\y(preturi|salarii|locuri de munca|afaceri|economie)\y' then 'economy' else 'city' end;
 return p_article->>'topic'=topic;
exception when others then return false;
end $$;

create function dlkt_info_private.valid_news_corpus(p_corpus jsonb,p_now timestamptz)
returns boolean language plpgsql stable set search_path='' as $$
declare generated timestamptz; item jsonb; article jsonb; city jsonb; snapshot jsonb; source jsonb; city_ids text[]:='{}'; source_ids text[]; total integer;
  projected_sources jsonb; probe jsonb; count_articles bigint; expected_feed text; expected_publisher text; expected_terms text; source_id text;
begin
 if jsonb_typeof(p_corpus) is distinct from 'object' or p_now is null or not isfinite(p_now)
  or octet_length(p_corpus::text)>8388608 or not p_corpus ?& array['version','orderVersion','generatedAt','cards','sources','local']
  or (select count(*) from jsonb_object_keys(p_corpus))<>6
  or p_corpus->>'version' is distinct from 'dlkt-news-corpus-1' or p_corpus->>'orderVersion' is distinct from 'iptc17-rounds-started-20261122'
  or jsonb_typeof(p_corpus->'generatedAt') is distinct from 'string'
  or p_corpus->>'generatedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
  or jsonb_typeof(p_corpus->'cards') is distinct from 'array' or jsonb_typeof(p_corpus->'sources') is distinct from 'array'
  or jsonb_typeof(p_corpus->'local') is distinct from 'array' or jsonb_array_length(p_corpus->'local')>1 then return false; end if;
 generated:=(p_corpus->>'generatedAt')::timestamptz;
 if not isfinite(generated) or generated<p_now-interval '5 minutes' or generated>p_now+interval '5 seconds'
  or to_char(generated at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')<>p_corpus->>'generatedAt' then return false; end if;
 total:=jsonb_array_length(p_corpus->'cards');if total>5000 then return false; end if;
 -- Reuse the current registry validator without duplicating its reviewed source catalog.
 select coalesce(jsonb_agg(s||jsonb_build_object('count',0)),'[]'::jsonb) into projected_sources from jsonb_array_elements(p_corpus->'sources') s;
 probe:=jsonb_build_object('version','iceo-primary-mesh-1','product','dlkt-info','productVersion','news-corpus-1','mode','current-source-records','generatedAt',p_corpus->>'generatedAt',
  'state','partial','sources',projected_sources,'cards','[]'::jsonb,'conflictCount',0,'duplicateCount',0,'deltaAvailable',false,'scheduledDelivery',false,'accountPersistence',false,'coverage','[]'::jsonb);
 if not dlkt_info_private.valid_public_refresh_snapshot(probe,p_now) then return false; end if;
 if (select count(distinct c->>'id') from jsonb_array_elements(p_corpus->'cards') c)<>total
  or (select count(distinct c->>'identity') from jsonb_array_elements(p_corpus->'cards') c)<>total
  or (select count(distinct c->>'sourceUrl') from jsonb_array_elements(p_corpus->'cards') c)<>total then return false; end if;
 for article in select value from jsonb_array_elements(p_corpus->'cards') loop
  if not dlkt_info_private.valid_share_archive_card(article) or article->>'kind'<>'publication' or article->>'dateLabel'<>'Published'
   or article->>'sourceState' not in ('verified','partial') or (article->>'date')::timestamptz>generated
   or (article->>'date')::timestamptz<=generated-interval '24 hours'
   or (article->>'observedAt')::timestamptz>generated+interval '5 minutes'
   or (article->>'observedAt')::timestamptz<=generated-interval '1 hour' then return false; end if;
  for source_id in select jsonb_array_elements_text(article->'sourceIds') loop
   if not exists(select 1 from jsonb_array_elements(p_corpus->'sources') s where s->>'id'=source_id and s->>'state'<>'unavailable') then return false; end if;
  end loop;
 end loop;
 for source in select value from jsonb_array_elements(p_corpus->'sources') loop
  if jsonb_typeof(source->'count') is distinct from 'number' or source->>'count' !~ '^[0-9]+$'
   or (source->>'count')::numeric<>(select count(*) from jsonb_array_elements(p_corpus->'cards') c where c->'sourceIds' ? (source->>'id')) then return false; end if;
 end loop;
 for item in select value from jsonb_array_elements(p_corpus->'local') loop
  if jsonb_typeof(item) is distinct from 'object' or not item ?& array['city','snapshot'] or (select count(*) from jsonb_object_keys(item))<>2 then return false; end if;
  city:=item->'city';snapshot:=item->'snapshot';
  if jsonb_typeof(city) is distinct from 'object' or not city ?& array['id','name','countryCode','country','region','lat','lon','timezone'] or (select count(*) from jsonb_object_keys(city))<>8
   or city->>'id' is distinct from '683506' or city->>'countryCode' is distinct from 'RO' or city->>'timezone' is distinct from 'Europe/Bucharest'
   or city->>'id'=any(city_ids) or jsonb_typeof(city->'name') is distinct from 'string' or length(city->>'name') not between 1 and 200
   or jsonb_typeof(city->'country') is distinct from 'string' or length(city->>'country') not between 1 and 120
   or jsonb_typeof(city->'region') is distinct from 'string' or length(city->>'region')>200
   or jsonb_typeof(city->'lat') is distinct from 'number' or (city->>'lat')::numeric not between -90 and 90
   or jsonb_typeof(city->'lon') is distinct from 'number' or (city->>'lon')::numeric not between -180 and 180
   or jsonb_typeof(snapshot) is distinct from 'object' or not snapshot ?& array['articles','sources'] or (select count(*) from jsonb_object_keys(snapshot))<>2
   or jsonb_typeof(snapshot->'articles') is distinct from 'array' or jsonb_typeof(snapshot->'sources') is distinct from 'array'
   or jsonb_array_length(snapshot->'sources')<>2 then return false; end if;
  city_ids:=array_append(city_ids,city->>'id');total:=total+jsonb_array_length(snapshot->'articles');if total>5000 then return false; end if;
  if (select count(distinct a->>'id') from jsonb_array_elements(snapshot->'articles') a)<>jsonb_array_length(snapshot->'articles')
   or (select count(distinct a->>'url') from jsonb_array_elements(snapshot->'articles') a)<>jsonb_array_length(snapshot->'articles') then return false; end if;
  for article in select value from jsonb_array_elements(snapshot->'articles') loop
   if not dlkt_info_private.valid_news_local_article(article,city,generated) then return false; end if;
  end loop;
  source_ids:='{}';
  for source in select value from jsonb_array_elements(snapshot->'sources') loop
   if jsonb_typeof(source) is distinct from 'object' or not source ?& array['sourceId','publisher','feedUrl','termsUrl','state','checkedAt','count','rejected','error']
    or (select count(*) from jsonb_object_keys(source))<>9 or jsonb_typeof(source->'sourceId') is distinct from 'string' then return false; end if;
   source_id:=source->>'sourceId';
   if source_id='bucharest-b365' then expected_feed:='https://b365.ro/feed/';expected_publisher:='B365';expected_terms:='https://b365.ro/despre-noi/';
   elsif source_id='bucharest-buletin' then expected_feed:='https://buletin.de/bucuresti/feed/';expected_publisher:='Buletin de București';expected_terms:='https://buletin.de/bucuresti/termeni-si-conditii/';
   else return false; end if;
   if source_id=any(source_ids) or source->>'publisher' is distinct from expected_publisher or source->>'feedUrl' is distinct from expected_feed or source->>'termsUrl' is distinct from expected_terms
    or jsonb_typeof(source->'state') is distinct from 'string' or source->>'state' not in ('ready','partial','unavailable')
    or jsonb_typeof(source->'count') is distinct from 'number' or source->>'count' !~ '^[0-9]+$'
    or jsonb_typeof(source->'rejected') is distinct from 'number' or source->>'rejected' !~ '^[0-9]+$' or (source->>'rejected')::numeric>9007199254740991 then return false; end if;
   source_ids:=array_append(source_ids,source_id);
   select count(*) into count_articles from jsonb_array_elements(snapshot->'articles') a where a->>'sourceId'=source_id;
   if (source->>'count')::numeric<>count_articles then return false; end if;
   if source->>'state'='unavailable' then
    if source->'checkedAt'<>'null'::jsonb or count_articles<>0 or jsonb_typeof(source->'error') is distinct from 'string' or source->>'error' !~ '^[A-Z][A-Z0-9_]{1,80}$' then return false; end if;
   else
    if source->'error'<>'null'::jsonb or jsonb_typeof(source->'checkedAt') is distinct from 'string'
     or (source->>'checkedAt')::timestamptz>generated+interval '5 seconds' or (source->>'checkedAt')::timestamptz<=generated-interval '5 minutes'
     or exists(select 1 from jsonb_array_elements(snapshot->'articles') a where a->>'sourceId'=source_id and a->>'checkedAt'<>source->>'checkedAt')
     or (source->>'state'='partial')<>((source->>'rejected')::numeric>0) then return false; end if;
   end if;
  end loop;
 end loop;
 return true;
exception when others then return false;
end $$;

create function public.dlkt_info_stage_news_corpus(p_lease_token uuid,p_fence bigint,p_corpus jsonb,p_digest text,p_diagnostics jsonb default null)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s dlkt_info_private.public_refresh_state%rowtype; previous dlkt_info_private.news_corpus_epochs%rowtype; n timestamptz:=clock_timestamp(); generated timestamptz;
begin
 perform dlkt_info_private.require_public_refresh_writer();
 select * into s from dlkt_info_private.public_refresh_state where singleton for update;
 if p_lease_token is null or p_fence is null or s.lease_token is distinct from p_lease_token or s.fence<>p_fence or s.lease_expires_at is null or s.lease_expires_at<=n then raise exception using errcode='55000',message='PUBLIC_REFRESH_LEASE_LOST'; end if;
 if p_digest is null or p_digest !~ '^[a-f0-9]{64}$' or not dlkt_info_private.valid_news_corpus(p_corpus,n)
  or (p_diagnostics is not null and not dlkt_info_private.valid_news_diagnostics(p_diagnostics,n)) then raise exception using errcode='22023',message='NEWS_CORPUS_INVALID'; end if;
 generated:=(p_corpus->>'generatedAt')::timestamptz;
 if generated<s.claimed_at-interval '5 seconds' or generated>n+interval '5 seconds' then raise exception using errcode='22023',message='NEWS_CORPUS_GENERATION_INVALID'; end if;
 select * into previous from dlkt_info_private.news_corpus_epochs where fence=p_fence;
 if found then
  if previous.lease_token<>p_lease_token or previous.corpus<>p_corpus or previous.digest<>p_digest or previous.diagnostics is distinct from p_diagnostics then raise exception using errcode='55000',message='NEWS_CORPUS_IMMUTABLE'; end if;
 else
  delete from dlkt_info_private.news_corpus_epochs where expires_at<=n or (revision is null and fence<>s.fence and generated_at<n-interval '2 minutes');
  if (select count(*) from dlkt_info_private.news_corpus_epochs)>=64 then raise exception using errcode='54000',message='NEWS_CORPUS_CAPACITY'; end if;
  insert into dlkt_info_private.news_corpus_epochs(fence,lease_token,corpus,digest,generated_at,expires_at,diagnostics)
   values(p_fence,p_lease_token,p_corpus,p_digest,generated,generated+interval '1 hour',p_diagnostics);
 end if;
 return jsonb_build_object('epoch',p_fence::text,'digest',p_digest);
end $$;

-- Called inside the existing snapshot publication transaction, while its state row is locked.
-- Missing stage is a no-op for the old writer during the additive migration/deployment transition.
create function dlkt_info_private.publish_news_corpus(p_fence bigint,p_revision bigint,p_generated_at timestamptz)
returns void language plpgsql security invoker set search_path='' as $$
declare staged dlkt_info_private.news_corpus_epochs%rowtype; s dlkt_info_private.public_refresh_state%rowtype; n timestamptz:=clock_timestamp();
begin
 select * into staged from dlkt_info_private.news_corpus_epochs where fence=p_fence for update;
 if not found then return; end if;
 select * into s from dlkt_info_private.public_refresh_state where singleton for update;
 if staged.revision is not null or p_revision is null or p_revision<>s.revision+1 or staged.generated_at<>p_generated_at
  or s.fence<>p_fence or s.lease_token is distinct from staged.lease_token or s.lease_expires_at is null or s.lease_expires_at<=n
  or staged.expires_at<=n then raise exception using errcode='55000',message='NEWS_CORPUS_PUBLICATION_INVALID'; end if;
 update dlkt_info_private.news_corpus_epochs set revision=p_revision,published_at=n where fence=p_fence;
 update dlkt_info_private.public_refresh_state set news_diagnostics=staged.diagnostics where singleton;
 update dlkt_info_private.public_refresh_runs set news_diagnostics=staged.diagnostics where fence=p_fence;
end $$;

create function public.dlkt_info_read_news_corpus(p_epoch bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare entry dlkt_info_private.news_corpus_epochs%rowtype;
begin
 perform dlkt_info_private.require_public_refresh_writer();
 if p_epoch is not null and p_epoch not between 1 and 9007199254740991 then raise exception using errcode='22023',message='NEWS_CORPUS_REFERENCE_INVALID'; end if;
 select * into entry from dlkt_info_private.news_corpus_epochs e where e.revision is not null and e.expires_at>statement_timestamp() and (p_epoch is null or e.fence=p_epoch) order by e.revision desc limit 1;
 if not found then return null; end if;
 return jsonb_build_object('version','dlkt-news-epoch-1','epoch',entry.fence::text,'revision',entry.revision,'generatedAt',entry.corpus->>'generatedAt',
  'publishedAt',to_char(entry.published_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
  'expiresAt',to_char(entry.expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'digest',entry.digest,'corpus',entry.corpus);
end $$;

create function public.dlkt_info_find_news_corpus_article(p_id text,p_revision text,p_city_id text default null,p_epoch bigint default null)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result jsonb; n timestamptz:=statement_timestamp();
begin
 perform dlkt_info_private.require_public_refresh_writer();
 if p_id is null or p_revision is null or p_revision !~ '^[a-f0-9]{64}$' or (p_epoch is not null and p_epoch not between 1 and 9007199254740991)
  or (p_city_id is null and p_id !~ '^[a-f0-9]{24}$')
  or (p_city_id is not null and (p_city_id<>'683506' or p_id !~ '^local-news:683506:bucharest-(b365|buletin):[a-f0-9]{24}$')) then raise exception using errcode='22023',message='NEWS_CORPUS_REFERENCE_INVALID'; end if;
 if p_city_id is null then
  select jsonb_build_object('kind','global','card',a.value) into result
  from dlkt_info_private.news_corpus_epochs e cross join lateral jsonb_array_elements(e.corpus->'cards') a
  where e.revision is not null and e.expires_at>n and (p_epoch is null or e.fence=p_epoch) and a.value->>'id'=p_id and a.value->>'contentHash'=p_revision
   and (a.value->>'observedAt')::timestamptz>n-interval '1 hour' and (a.value->>'observedAt')::timestamptz<=n+interval '5 minutes'
   and (a.value->>'date')::timestamptz>n-interval '24 hours' and (a.value->>'date')::timestamptz<=n
  order by e.revision desc limit 1;
 else
  select jsonb_build_object('kind','local','article',a.value,'city',local.value->'city') into result
  from dlkt_info_private.news_corpus_epochs e cross join lateral jsonb_array_elements(e.corpus->'local') local
  cross join lateral jsonb_array_elements(local.value->'snapshot'->'articles') a
  where e.revision is not null and e.expires_at>n and (p_epoch is null or e.fence=p_epoch) and local.value->'city'->>'id'=p_city_id
   and a.value->>'id'=p_id and a.value->>'documentHash'=p_revision
   and dlkt_info_private.valid_news_local_article(a.value,local.value->'city',n)
  order by e.revision desc limit 1;
 end if;
 return result;
end $$;

revoke all on function dlkt_info_private.news_fold(text),dlkt_info_private.news_local_anchors(text,text),dlkt_info_private.valid_news_local_article(jsonb,jsonb,timestamptz),dlkt_info_private.valid_news_corpus(jsonb,timestamptz),dlkt_info_private.publish_news_corpus(bigint,bigint,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.dlkt_info_stage_news_corpus(uuid,bigint,jsonb,text,jsonb),public.dlkt_info_read_news_corpus(bigint),public.dlkt_info_find_news_corpus_article(text,text,text,bigint) from public,anon,authenticated,service_role;
grant execute on function public.dlkt_info_stage_news_corpus(uuid,bigint,jsonb,text,jsonb),public.dlkt_info_read_news_corpus(bigint),public.dlkt_info_find_news_corpus_article(text,text,text,bigint) to anon,authenticated,service_role;
comment on function public.dlkt_info_read_news_corpus(bigint) is 'Server-only corpus read guarded by the existing writer header. Excludes lease tokens and diagnostics; public visitors use the bounded page API.';
