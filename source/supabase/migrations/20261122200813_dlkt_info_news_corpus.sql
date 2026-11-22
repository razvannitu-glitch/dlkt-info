-- Verified news corpus, atomic publication, private source diagnostics and canonical subject metadata.
begin;

-- Exact public metadata projection. Existing immutable revisions without subject metadata remain valid.
CREATE OR REPLACE FUNCTION dlkt_info_private.share_archive_content(p_card jsonb)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare result text; countries text; sections text; keywords text;
begin
  result := '{"identity":' || to_json(p_card->>'identity')::text
    || ',"title":' || to_json(p_card->>'title')::text
    || ',"sourceUrl":' || to_json(p_card->>'sourceUrl')::text
    || ',"date":' || to_json(p_card->>'date')::text
    || ',"dateLabel":' || to_json(p_card->>'dateLabel')::text
    || ',"publisher":' || to_json(p_card->>'publisher')::text
    || ',"deadline":' || coalesce(to_json(p_card->>'deadline')::text, 'null')
    || ',"version":' || coalesce(to_json(p_card->>'version')::text, 'null');
  if p_card ? 'summary' then result := result || ',"summary":' || to_json(p_card->>'summary')::text; end if;
  if p_card ? 'byline' then result := result || ',"byline":' || to_json(p_card->>'byline')::text || ',"licenseUrl":' || to_json(p_card->>'licenseUrl')::text; end if;
  if p_card ? 'context' then
    select coalesce(string_agg('{"code":' || to_json(country->>'code')::text || ',"name":' || to_json(country->>'name')::text || '}', ',' order by ordinal), '')
      into countries from jsonb_array_elements(p_card->'context'->'countries') with ordinality as entry(country, ordinal);
    result := result || ',"context":{"countries":[' || countries || '],"basis":' || to_json(p_card->'context'->>'basis')::text
      || ',"label":' || to_json(p_card->'context'->>'label')::text || ',"boundary":' || to_json(p_card->'context'->>'boundary')::text || '}';
  end if;
  if p_card ? 'articleSubject' then
    select coalesce(string_agg(to_json(value #>> '{}')::text, ',' order by ordinal),'') into sections
      from jsonb_array_elements(p_card->'articleSubject'->'sections') with ordinality entry(value,ordinal);
    select coalesce(string_agg(to_json(value #>> '{}')::text, ',' order by ordinal),'') into keywords
      from jsonb_array_elements(p_card->'articleSubject'->'keywords') with ordinality entry(value,ordinal);
    result := result || ',"articleSubject":{"basis":"publisher-jsonld","articleUrl":' || to_json(p_card->'articleSubject'->>'articleUrl')::text
      || ',"sections":[' || sections || '],"keywords":[' || keywords || ']}';
  end if;
  return result || '}';
end $function$;

CREATE OR REPLACE FUNCTION dlkt_info_private.valid_share_archive_card(p_card jsonb)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare item record; source_id text; rule jsonb; source_count integer; country jsonb; stamp timestamptz;
  -- Reviewed registry snapshot. A source addition requires an explicit migration.
  news_topics constant jsonb := '{"news-world":"world","news-business":"business","news-technology":"technology","news-money":"money","news-health":"health","news-sport":"sport","news-gaming":"culture","news-culture":"culture","news-shopping":"money","news-travel":"travel","news-work":"work-education","news-education":"work-education","news-family":"public-affairs","news-science":"science","news-environment":"environment","news-public-affairs":"public-affairs","news-digital-life":"digital-life","news-food":"food","news-housing":"housing","news-weather":"weather","news-unclassified":"other"}'::jsonb;
  sources constant jsonb := '{
    "eu-law":["EU Publications Office","^https://eur-lex[.]europa[.]eu/legal-content/EN/TXT/","legal-document",null],
    "ecb-news":["European Central Bank","^https://www[.]ecb[.]europa[.]eu/","publication",null],
    "ecb-statistics":["European Central Bank","^https://www[.]ecb[.]europa[.]eu/","publication",null],
    "ecb-procurement":["European Central Bank","^https://www[.]ecb[.]europa[.]eu/","procurement-notice",null],
    "nextjs":["Vercel / Next.js maintainers","^https://github[.]com/vercel/next[.]js/releases/tag/","software-release",null],
    "nodejs":["Node.js maintainers","^https://github[.]com/nodejs/node/releases/tag/","software-release",null],
    "nasa-news":["NASA","^https://(www|science)[.]nasa[.]gov/","publication",null],
    "usgs-news":["U.S. Geological Survey","^https://www[.]usgs[.]gov/news/national-news-release/","publication",null],
    "fda-news":["U.S. Food and Drug Administration","^https://www[.]fda[.]gov/news-events/press-announcements/","publication",null],
    "govuk-news":["UK Government","^https://www[.]gov[.]uk/government/","publication",null],
    "gv-world":["Global Voices","^https://globalvoices[.]org/20","publication","https://creativecommons.org/licenses/by/3.0/"],
    "gv-culture":["Global Voices","^https://globalvoices[.]org/20","publication","https://creativecommons.org/licenses/by/3.0/"],
    "eff-digital":["Electronic Frontier Foundation","^https://www[.]eff[.]org/deeplinks/","publication","https://creativecommons.org/licenses/by/4.0/"],
    "govuk-products":["UK Government","^https://www[.]gov[.]uk/product-safety-alerts-reports-recalls/","publication",null],
    "ncsc-news":["UK National Cyber Security Centre","^https://www[.]ncsc[.]gov[.]uk/news/","publication",null],
    "sanews":["SAnews","^https://www[.]sanews[.]gov[.]za/(south-africa|features)/","publication",null],
    "ec-press":["European Commission","^https://ec[.]europa[.]eu/commission/presscorner/detail/en/","publication","https://creativecommons.org/licenses/by/4.0/"],
    "eu-council":["Council of the European Union","^https://www[.]consilium[.]europa[.]eu/en/press/","publication",null],
    "cbs-news":["Statistics Netherlands (CBS)","^https://www[.]cbs[.]nl/en-gb/news/","publication","https://creativecommons.org/licenses/by/4.0/"],
    "scidev-news":["SciDev.Net","^https://www[.]scidev[.]net/global/","publication","https://creativecommons.org/licenses/by/3.0/"],
    "360-news":["360info","^https://360info[.]org/","publication","https://creativecommons.org/licenses/by/4.0/"],
    "noaa-news":["NOAA","^https://www[.]noaa[.]gov/(news|stories)/","publication",null],
    "nist-news":["NIST","^https://www[.]nist[.]gov/news-events/news/","publication",null],
    "nsf-news":["U.S. National Science Foundation","^https://www[.]nsf[.]gov/news/","publication",null],
    "fed-news":["Federal Reserve Board","^https://www[.]federalreserve[.]gov/newsevents/pressreleases/","publication",null],
    "ftc-consumer":["U.S. Federal Trade Commission","^https://consumer[.]ftc[.]gov/consumer-alerts/","publication",null],
    "fda-food":["U.S. Food and Drug Administration","^https://www[.]fda[.]gov/safety/recalls-market-withdrawals-safety-alerts/","publication",null],
    "govuk-travel":["UK Government","^https://www[.]gov[.]uk/foreign-travel-advice/","publication",null],
    "beehive-news":["New Zealand Government","^https://www[.]beehive[.]govt[.]nz/(release|speech)/","publication",null]
  }'::jsonb;
begin
  if p_card is null or jsonb_typeof(p_card) <> 'object' or octet_length(p_card::text) > 32768
    or not (p_card ?& array['id','identity','title','topic','kind','sourceUrl','publisher','sourceIds','date','dateLabel','observedAt','contentHash','boundary','deadline','version','attribution','sourceState'])
    or exists(select 1 from jsonb_object_keys(p_card) as k where k <> all(array['id','identity','title','topic','kind','sourceUrl','publisher','sourceIds','date','dateLabel','observedAt','contentHash','boundary','deadline','version','attribution','sourceState','summary','byline','licenseUrl','context','articleSubject'])) then return false; end if;
  for item in select * from (values ('id',24),('identity',3000),('title',4000),('topic',40),('kind',30),('sourceUrl',3000),('publisher',300),('date',100),('dateLabel',20),('observedAt',100),('contentHash',64),('boundary',4000),('attribution',4000),('sourceState',10)) as limits(field,maximum) loop
    if jsonb_typeof(p_card->item.field) <> 'string' or length(p_card->>item.field) not between 1 and item.maximum
      or (p_card->>item.field) ~ '[[:cntrl:]]' then return false; end if;
  end loop;
  if (p_card->>'id') !~ '^[a-f0-9]{24}$' or (p_card->>'contentHash') !~ '^[a-f0-9]{64}$'
    or (p_card->>'sourceState') not in ('verified','partial')
    or (p_card->>'topic') not in ('technology','business','regulation','opportunities','science','environment','health','public-affairs','world','digital-life','culture','money','space','weather','energy','work-education','housing','travel','food','sport','other')
    or (p_card->>'dateLabel') not in ('Published','Document date','Updated')
    or (p_card->>'sourceUrl') ~ '[[:space:]#\\]' then return false; end if;
  for item in select * from (values ('summary',1000),('byline',600),('licenseUrl',100)) as limits(field,maximum) loop
    if p_card ? item.field and (jsonb_typeof(p_card->item.field) <> 'string' or length(p_card->>item.field) not between 1 and item.maximum or (p_card->>item.field) ~ '[[:cntrl:]]') then return false; end if;
  end loop;
  if (p_card ? 'byline') <> (p_card ? 'licenseUrl') or (p_card ? 'licenseUrl' and p_card->>'licenseUrl' not in ('https://creativecommons.org/licenses/by/3.0/','https://creativecommons.org/licenses/by/4.0/')) then return false; end if;
  if jsonb_typeof(p_card->'version') not in ('null','string') or coalesce(length(p_card->>'version'),0) > 100
    or jsonb_typeof(p_card->'deadline') not in ('null','string') then return false; end if;
  for item in select * from (values ('date'),('observedAt'),('deadline')) as dates(field) loop
    if p_card->item.field <> 'null'::jsonb then
      if (p_card->>item.field) !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}(T[0-9]{2}:[0-9]{2}:[0-9]{2}([.][0-9]{1,6})?(Z|[+-][0-9]{2}:[0-9]{2}))?$' then return false; end if;
      stamp := (p_card->>item.field)::timestamptz;
      if not isfinite(stamp) then return false; end if;
    end if;
  end loop;
  if jsonb_typeof(p_card->'sourceIds') <> 'array' or jsonb_array_length(p_card->'sourceIds') not between 1 and 8 then return false; end if;
  select count(distinct value) into source_count from jsonb_array_elements_text(p_card->'sourceIds');
  if source_count <> jsonb_array_length(p_card->'sourceIds') then return false; end if;
  if p_card->>'topic'='other' and (not (p_card->'sourceIds' ? 'news-unclassified')
    or exists(select 1 from jsonb_array_elements_text(p_card->'sourceIds') as candidate(id) where candidate.id not in ('news-unclassified','editorial-frontpage'))) then return false; end if;
  for source_id in select value from jsonb_array_elements_text(p_card->'sourceIds') loop
    if left(source_id,5)='news-' then
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
    rule := sources->source_id;
    if rule is null or p_card->>'publisher' <> rule->>0 or p_card->>'kind' <> rule->>2 or (p_card->>'sourceUrl') !~ (rule->>1)
      or (rule->>3 is not null and (p_card->>'licenseUrl' is distinct from rule->>3)) then return false; end if;
    if source_id = 'eu-law' then
      if (p_card->>'identity') !~ '^celex:[0-9A-Z][0-9]{4}[A-Z0-9()/_-]{3,60}$' or p_card->>'sourceUrl' <> 'https://eur-lex.europa.eu/legal-content/EN/TXT/?uri=CELEX:' || replace(substr(p_card->>'identity',7), '/', '%2F') then return false; end if;
    elsif p_card->>'identity' <> p_card->>'sourceUrl' then return false;
    elsif source_id in ('nextjs','nodejs') then
      if p_card->>'version' is null or (p_card->>'version') !~ '^v?[0-9]+[.][0-9]+[.][0-9]+$'
        or p_card->>'sourceUrl' <> ('https://github.com/' || (case when source_id='nextjs' then 'vercel/next.js' else 'nodejs/node' end) || '/releases/tag/' || (p_card->>'version')) then return false; end if;
    elsif source_id not in ('ecb-news','ecb-statistics','ecb-procurement') and position('?' in p_card->>'sourceUrl') > 0 then return false;
    end if;
  end loop;
  if p_card ? 'articleSubject' then
    if p_card->>'kind'<>'publication' or jsonb_typeof(p_card->'articleSubject') is distinct from 'object'
      or not (p_card->'articleSubject' ?& array['basis','articleUrl','sections','keywords'])
      or (select count(*) from jsonb_object_keys(p_card->'articleSubject'))<>4
      or p_card->'articleSubject'->>'basis' is distinct from 'publisher-jsonld'
      or jsonb_typeof(p_card->'articleSubject'->'articleUrl') is distinct from 'string'
      or p_card->'articleSubject'->>'articleUrl' is distinct from p_card->>'sourceUrl'
      or jsonb_typeof(p_card->'articleSubject'->'sections') is distinct from 'array'
      or jsonb_typeof(p_card->'articleSubject'->'keywords') is distinct from 'array'
      or jsonb_array_length(p_card->'articleSubject'->'sections')>8
      or jsonb_array_length(p_card->'articleSubject'->'keywords')>12
      or jsonb_array_length(p_card->'articleSubject'->'sections')+jsonb_array_length(p_card->'articleSubject'->'keywords')=0 then return false; end if;
    for item in select value from jsonb_array_elements(p_card->'articleSubject'->'sections')
      union all select value from jsonb_array_elements(p_card->'articleSubject'->'keywords') loop
      if jsonb_typeof(item.value)<>'string' or length(item.value #>> '{}') not between 1 and 80
        or item.value #>> '{}' ~ '[<>[:cntrl:]]'
        or strpos(item.value #>> '{}',chr(65279))>0
        or item.value #>> '{}' <> normalize(item.value #>> '{}',NFC)
        or item.value #>> '{}' <> btrim(regexp_replace(item.value #>> '{}','\s+',' ','g')) then return false; end if;
    end loop;
    if (select count(distinct value) from jsonb_array_elements(p_card->'articleSubject'->'sections'))<>jsonb_array_length(p_card->'articleSubject'->'sections')
      or (select count(distinct value) from jsonb_array_elements(p_card->'articleSubject'->'keywords'))<>jsonb_array_length(p_card->'articleSubject'->'keywords') then return false; end if;
  end if;
  if p_card ? 'context' then
    if jsonb_typeof(p_card->'context') <> 'object' or not ((p_card->'context') ?& array['countries','basis','label','boundary'])
      or (select count(*) from jsonb_object_keys(p_card->'context')) <> 4
      or jsonb_typeof(p_card->'context'->'countries') <> 'array' or jsonb_array_length(p_card->'context'->'countries') > 8
      or p_card->'context'->>'basis' not in ('publisher-category','publisher-scope','unspecified') then return false; end if;
    for item in select * from (values ('basis',40),('label',400),('boundary',4000)) as limits(field,maximum) loop
      if jsonb_typeof(p_card->'context'->item.field) <> 'string' or length(p_card->'context'->>item.field) not between 1 and item.maximum then return false; end if;
    end loop;
    for country in select value from jsonb_array_elements(p_card->'context'->'countries') loop
      if jsonb_typeof(country) <> 'object' or not (country ?& array['code','name']) or (select count(*) from jsonb_object_keys(country)) <> 2
        or jsonb_typeof(country->'code') <> 'string' or (country->>'code') !~ '^[A-Z]{2}$'
        or jsonb_typeof(country->'name') <> 'string' or length(country->>'name') not between 1 and 100 then return false; end if;
    end loop;
  end if;
  return p_card->>'id' = substr(encode(sha256(convert_to(to_json(p_card->>'identity')::text,'UTF8')),'hex'),1,24)
    and p_card->>'contentHash' = encode(sha256(convert_to(dlkt_info_private.share_archive_content(p_card),'UTF8')),'hex');
exception when others then return false;
end $function$;

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

create or replace function public.dlkt_info_publish_public_snapshot(p_lease_token uuid,p_fence bigint,p_snapshot jsonb,p_digest text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s dlkt_info_private.public_refresh_state%rowtype; n timestamptz:=clock_timestamp(); g timestamptz;
begin
  perform dlkt_info_private.require_public_refresh_writer();
  select * into s from dlkt_info_private.public_refresh_state where singleton for update;
  if p_lease_token is null or p_fence is null or s.lease_token is distinct from p_lease_token or s.fence<>p_fence or s.lease_expires_at is null or s.lease_expires_at<=n then raise exception using errcode='55000',message='PUBLIC_REFRESH_LEASE_LOST'; end if;
  if p_digest is null or p_digest !~ '^[a-f0-9]{64}$' or not dlkt_info_private.valid_public_refresh_snapshot(p_snapshot,n) then raise exception using errcode='22023',message='PUBLIC_REFRESH_SNAPSHOT_INVALID'; end if;
  g:=(p_snapshot->>'generatedAt')::timestamptz;
  if g<s.claimed_at-interval '5 seconds' or g>n+interval '5 seconds' or (s.generated_at is not null and g<=s.generated_at) then raise exception using errcode='22023',message='PUBLIC_REFRESH_GENERATION_REGRESSION'; end if;
  -- A new envelope timestamp cannot turn retained observations into a successful
  -- source check. At least one source must have been checked and verified during
  -- this lease; retained stale cards may coexist with that current evidence.
  if not exists(select 1 from jsonb_array_elements(p_snapshot->'sources') source
    where source->>'state' in ('verified','partial')
      and (source->>'verifiedAt')::timestamptz between s.claimed_at-interval '5 seconds' and n+interval '5 seconds'
      and (source->>'checkedAt')::timestamptz between s.claimed_at-interval '5 seconds' and n+interval '5 seconds') then
    raise exception using errcode='22023',message='PUBLIC_REFRESH_CURRENT_SOURCE_REQUIRED';
  end if;
  -- Publish the staged corpus and its private diagnostics under this same lease and revision.
  perform dlkt_info_private.publish_news_corpus(p_fence,s.revision+1,g);
  update dlkt_info_private.public_refresh_state set snapshot=p_snapshot,digest=p_digest,revision=revision+1,generated_at=g,refreshed_at=n,successful_slot=active_slot,
    last_scheduled_success_at=case when trigger->>'kind'='scheduled' then n else last_scheduled_success_at end,
    failure_count=0,retry_at=null,lease_token=null,lease_expires_at=null,worker_id=null,trigger=null where singleton;
  update dlkt_info_private.public_refresh_runs set outcome='succeeded',finished_at=n,digest=p_digest where fence=p_fence;
  return public.dlkt_info_read_public_snapshot();
end $$;

create or replace function public.dlkt_info_read_database_readiness()
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, dlkt_info_private, auth
as $$
declare
  v_required_relations text[] := array[
    'dlkt_info_private.briefing_card_claims',
    'dlkt_info_private.claim_evidence',
    'dlkt_info_private.claims',
    'dlkt_info_private.delivery_endpoint_secrets',
    'dlkt_info_private.delivery_outbox',
    'dlkt_info_private.entities',
    'dlkt_info_private.internal_delta_jobs',
    'dlkt_info_private.internal_delta_review_events',
    'dlkt_info_private.internal_delta_trial_card_claims',
    'dlkt_info_private.internal_delta_trial_cards',
    'dlkt_info_private.internal_delta_trials',
    'dlkt_info_private.source_acquisition_events',
    'dlkt_info_private.source_acquisition_state',
    'dlkt_info_private.source_claim_batch_items',
    'dlkt_info_private.source_claim_batches',
    'dlkt_info_private.source_registry',
    'dlkt_info_private.system_identity',
    'public.dlkt_info_briefing_cards',
    'public.dlkt_info_briefing_events',
    'public.dlkt_info_briefing_runs',
    'public.dlkt_info_briefing_targets',
    'public.dlkt_info_briefings',
    'public.dlkt_info_delivery_endpoints',
    'public.dlkt_info_delivery_receipts',
    'public.dlkt_info_interest_rules',
    'public.dlkt_info_profiles',
    'public.dlkt_info_user_memory',
    'dlkt_info_private.share_archive_writer',
    'public.dlkt_info_shared_cards',
    'public.dlkt_info_news_candidates',
    'dlkt_info_private.public_refresh_state',
    'dlkt_info_private.public_refresh_runs',
    'dlkt_info_private.news_corpus_epochs'
  ]::text[];
  v_private_relations text[] := array[
    'dlkt_info_private.briefing_card_claims',
    'dlkt_info_private.claim_evidence',
    'dlkt_info_private.claims',
    'dlkt_info_private.delivery_endpoint_secrets',
    'dlkt_info_private.delivery_outbox',
    'dlkt_info_private.entities',
    'dlkt_info_private.internal_delta_jobs',
    'dlkt_info_private.internal_delta_review_events',
    'dlkt_info_private.internal_delta_trial_card_claims',
    'dlkt_info_private.internal_delta_trial_cards',
    'dlkt_info_private.internal_delta_trials',
    'dlkt_info_private.source_acquisition_events',
    'dlkt_info_private.source_acquisition_state',
    'dlkt_info_private.source_claim_batch_items',
    'dlkt_info_private.source_claim_batches',
    'dlkt_info_private.source_registry',
    'dlkt_info_private.system_identity',
    'dlkt_info_private.share_archive_writer',
    'dlkt_info_private.public_refresh_state',
    'dlkt_info_private.public_refresh_runs',
    'dlkt_info_private.news_corpus_epochs'
  ]::text[];
  v_required_functions text[] := array[
    'dlkt_info_private.append_event(uuid, uuid, text, text, text, jsonb)',
    'dlkt_info_private.clean_error_detail(text)',
    'dlkt_info_private.enqueue_internal_delta_job()',
    'dlkt_info_private.ensure_default_web_target()',
    'dlkt_info_private.handle_new_user()',
    'dlkt_info_private.hash_text(text)',
    'dlkt_info_private.internal_claim_payload(uuid)',
    'dlkt_info_private.is_sha256(text)',
    'dlkt_info_private.is_valid_channels(text[])',
    'dlkt_info_private.is_valid_iso_weekdays(smallint[])',
    'dlkt_info_private.is_valid_text_collection(text[], integer, integer)',
    'dlkt_info_private.is_valid_text_set(text[], integer, integer)',
    'dlkt_info_private.is_valid_timezone(text)',
    'dlkt_info_private.prevent_mutation()',
    'dlkt_info_private.protect_briefing_system_fields()',
    'dlkt_info_private.protect_endpoint_system_fields()',
    'dlkt_info_private.protect_profile_system_fields()',
    'dlkt_info_private.require_service_role()',
    'dlkt_info_private.set_briefing_schedule()',
    'dlkt_info_private.set_card_owner()',
    'dlkt_info_private.set_receipt_owner()',
    'dlkt_info_private.set_run_owner()',
    'dlkt_info_private.touch_updated_at()',
    'dlkt_info_private.validate_briefing_target()',
    'public.dlkt_info_claim_delivery_jobs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_due_briefings(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_internal_delta_jobs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_queued_runs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_commit_source_acquisition(text, uuid, text, integer, jsonb, text, text, text, boolean, jsonb, timestamp with time zone)',
    'public.dlkt_info_complete_internal_delta_trial(uuid, text, text, text, text, text, timestamp with time zone, timestamp with time zone, text, jsonb, jsonb, timestamp with time zone)',
    'public.dlkt_info_complete_source_acquisition(text, uuid, text, text, integer, jsonb, text, text, text, text, timestamp with time zone)',
    'public.dlkt_info_fail_internal_delta_job(uuid, text, text, timestamp with time zone, timestamp with time zone)',
    'public.dlkt_info_finalize_run(uuid, text, jsonb, text, text, text, timestamp with time zone)',
    'public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamp with time zone)',
    'public.dlkt_info_read_companion_configuration()',
    'public.dlkt_info_read_database_readiness()',
    'public.dlkt_info_read_internal_delta_review_queue(integer)',
    'public.dlkt_info_read_source_acquisition(text)',
    'public.dlkt_info_read_system_identity()',
    'public.dlkt_info_record_delivery_attempt(uuid, text, boolean, text, text, timestamp with time zone, jsonb, timestamp with time zone)',
    'public.dlkt_info_recover_expired_leases(timestamp with time zone)',
    'public.dlkt_info_reserve_source_acquisition(text, text, timestamp with time zone, integer)',
    'public.dlkt_info_review_internal_delta_card(uuid, text, text, text, timestamp with time zone)',
    'public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, integer, text, boolean, text, text, text, integer, integer, boolean)',
    'public.dlkt_info_verify_delivery_endpoint(uuid, text, timestamp with time zone)',
    'dlkt_info_private.share_archive_content(jsonb)',
    'dlkt_info_private.valid_share_archive_card(jsonb)',
    'dlkt_info_private.prevent_share_archive_mutation()',
    'public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)',
    'dlkt_info_private.valid_news_candidate_publisher(text, text)',
    'dlkt_info_private.valid_news_candidate(jsonb, timestamp with time zone)',
    'public.dlkt_info_upsert_news_candidates(jsonb)',
    'dlkt_info_private.require_public_refresh_writer()',
    'dlkt_info_private.valid_public_refresh_snapshot(jsonb, timestamp with time zone)',
    'public.dlkt_info_read_public_snapshot()',
    'public.dlkt_info_claim_public_refresh(uuid, jsonb)',
    'public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)',
    'public.dlkt_info_fail_public_refresh(uuid, bigint, text)',
    'dlkt_info_private.valid_news_diagnostics(jsonb, timestamp with time zone)',
    'dlkt_info_private.news_fold(text)',
    'dlkt_info_private.news_local_anchors(text, text)',
    'dlkt_info_private.valid_news_local_article(jsonb, jsonb, timestamp with time zone)',
    'dlkt_info_private.valid_news_corpus(jsonb, timestamp with time zone)',
    'dlkt_info_private.publish_news_corpus(bigint, bigint, timestamp with time zone)',
    'public.dlkt_info_stage_news_corpus(uuid, bigint, jsonb, text, jsonb)',
    'public.dlkt_info_read_news_corpus(bigint)',
    'public.dlkt_info_find_news_corpus_article(text, text, text, bigint)'
  ]::text[];
  v_public_functions text[] := array[
    'public.dlkt_info_claim_delivery_jobs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_due_briefings(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_internal_delta_jobs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_queued_runs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_commit_source_acquisition(text, uuid, text, integer, jsonb, text, text, text, boolean, jsonb, timestamp with time zone)',
    'public.dlkt_info_complete_internal_delta_trial(uuid, text, text, text, text, text, timestamp with time zone, timestamp with time zone, text, jsonb, jsonb, timestamp with time zone)',
    'public.dlkt_info_complete_source_acquisition(text, uuid, text, text, integer, jsonb, text, text, text, text, timestamp with time zone)',
    'public.dlkt_info_fail_internal_delta_job(uuid, text, text, timestamp with time zone, timestamp with time zone)',
    'public.dlkt_info_finalize_run(uuid, text, jsonb, text, text, text, timestamp with time zone)',
    'public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamp with time zone)',
    'public.dlkt_info_read_companion_configuration()',
    'public.dlkt_info_read_database_readiness()',
    'public.dlkt_info_read_internal_delta_review_queue(integer)',
    'public.dlkt_info_read_source_acquisition(text)',
    'public.dlkt_info_read_system_identity()',
    'public.dlkt_info_record_delivery_attempt(uuid, text, boolean, text, text, timestamp with time zone, jsonb, timestamp with time zone)',
    'public.dlkt_info_recover_expired_leases(timestamp with time zone)',
    'public.dlkt_info_reserve_source_acquisition(text, text, timestamp with time zone, integer)',
    'public.dlkt_info_review_internal_delta_card(uuid, text, text, text, timestamp with time zone)',
    'public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, integer, text, boolean, text, text, text, integer, integer, boolean)',
    'public.dlkt_info_verify_delivery_endpoint(uuid, text, timestamp with time zone)',
    'public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)',
    'public.dlkt_info_upsert_news_candidates(jsonb)',
    'public.dlkt_info_read_public_snapshot()',
    'public.dlkt_info_claim_public_refresh(uuid, jsonb)',
    'public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)',
    'public.dlkt_info_fail_public_refresh(uuid, bigint, text)',
    'public.dlkt_info_stage_news_corpus(uuid, bigint, jsonb, text, jsonb)',
    'public.dlkt_info_read_news_corpus(bigint)',
    'public.dlkt_info_find_news_corpus_article(text, text, text, bigint)'
  ]::text[];
  v_private_functions text[] := array[
    'dlkt_info_private.append_event(uuid, uuid, text, text, text, jsonb)',
    'dlkt_info_private.clean_error_detail(text)',
    'dlkt_info_private.enqueue_internal_delta_job()',
    'dlkt_info_private.ensure_default_web_target()',
    'dlkt_info_private.handle_new_user()',
    'dlkt_info_private.hash_text(text)',
    'dlkt_info_private.internal_claim_payload(uuid)',
    'dlkt_info_private.is_sha256(text)',
    'dlkt_info_private.is_valid_channels(text[])',
    'dlkt_info_private.is_valid_iso_weekdays(smallint[])',
    'dlkt_info_private.is_valid_text_collection(text[], integer, integer)',
    'dlkt_info_private.is_valid_text_set(text[], integer, integer)',
    'dlkt_info_private.is_valid_timezone(text)',
    'dlkt_info_private.prevent_mutation()',
    'dlkt_info_private.protect_briefing_system_fields()',
    'dlkt_info_private.protect_endpoint_system_fields()',
    'dlkt_info_private.protect_profile_system_fields()',
    'dlkt_info_private.require_service_role()',
    'dlkt_info_private.set_briefing_schedule()',
    'dlkt_info_private.set_card_owner()',
    'dlkt_info_private.set_receipt_owner()',
    'dlkt_info_private.set_run_owner()',
    'dlkt_info_private.touch_updated_at()',
    'dlkt_info_private.validate_briefing_target()',
    'dlkt_info_private.share_archive_content(jsonb)',
    'dlkt_info_private.valid_share_archive_card(jsonb)',
    'dlkt_info_private.prevent_share_archive_mutation()',
    'dlkt_info_private.valid_news_candidate_publisher(text, text)',
    'dlkt_info_private.valid_news_candidate(jsonb, timestamp with time zone)',
    'dlkt_info_private.require_public_refresh_writer()',
    'dlkt_info_private.valid_public_refresh_snapshot(jsonb, timestamp with time zone)',
    'dlkt_info_private.valid_news_diagnostics(jsonb, timestamp with time zone)',
    'dlkt_info_private.news_fold(text)',
    'dlkt_info_private.news_local_anchors(text, text)',
    'dlkt_info_private.valid_news_local_article(jsonb, jsonb, timestamp with time zone)',
    'dlkt_info_private.valid_news_corpus(jsonb, timestamp with time zone)',
    'dlkt_info_private.publish_news_corpus(bigint, bigint, timestamp with time zone)'
  ]::text[];
  v_required_rls text[] := array[
    'dlkt_info_private.internal_delta_jobs',
    'dlkt_info_private.internal_delta_review_events',
    'dlkt_info_private.internal_delta_trial_card_claims',
    'dlkt_info_private.internal_delta_trial_cards',
    'dlkt_info_private.internal_delta_trials',
    'public.dlkt_info_briefing_cards',
    'public.dlkt_info_briefing_events',
    'public.dlkt_info_briefing_runs',
    'public.dlkt_info_briefing_targets',
    'public.dlkt_info_briefings',
    'public.dlkt_info_delivery_endpoints',
    'public.dlkt_info_delivery_receipts',
    'public.dlkt_info_interest_rules',
    'public.dlkt_info_profiles',
    'public.dlkt_info_user_memory',
    'dlkt_info_private.share_archive_writer',
    'public.dlkt_info_shared_cards',
    'public.dlkt_info_news_candidates',
    'dlkt_info_private.public_refresh_state',
    'dlkt_info_private.public_refresh_runs',
    'dlkt_info_private.news_corpus_epochs'
  ]::text[];
  v_required_policies text[] := array[
    'public.dlkt_info_briefing_cards.dlkt_info_briefing_cards_select_own:SELECT:authenticated',
    'public.dlkt_info_briefing_events.dlkt_info_briefing_events_select_own:SELECT:authenticated',
    'public.dlkt_info_briefing_runs.dlkt_info_briefing_runs_select_own:SELECT:authenticated',
    'public.dlkt_info_briefing_targets.dlkt_info_briefing_targets_delete_own:DELETE:authenticated',
    'public.dlkt_info_briefing_targets.dlkt_info_briefing_targets_insert_own:INSERT:authenticated',
    'public.dlkt_info_briefing_targets.dlkt_info_briefing_targets_select_own:SELECT:authenticated',
    'public.dlkt_info_briefing_targets.dlkt_info_briefing_targets_update_own:UPDATE:authenticated',
    'public.dlkt_info_briefings.dlkt_info_briefings_delete_own:DELETE:authenticated',
    'public.dlkt_info_briefings.dlkt_info_briefings_insert_own:INSERT:authenticated',
    'public.dlkt_info_briefings.dlkt_info_briefings_select_own:SELECT:authenticated',
    'public.dlkt_info_briefings.dlkt_info_briefings_update_own:UPDATE:authenticated',
    'public.dlkt_info_delivery_endpoints.dlkt_info_delivery_endpoints_delete_own:DELETE:authenticated',
    'public.dlkt_info_delivery_endpoints.dlkt_info_delivery_endpoints_insert_own:INSERT:authenticated',
    'public.dlkt_info_delivery_endpoints.dlkt_info_delivery_endpoints_select_own:SELECT:authenticated',
    'public.dlkt_info_delivery_endpoints.dlkt_info_delivery_endpoints_update_own:UPDATE:authenticated',
    'public.dlkt_info_delivery_receipts.dlkt_info_delivery_receipts_select_own:SELECT:authenticated',
    'public.dlkt_info_interest_rules.dlkt_info_interest_rules_delete_own:DELETE:authenticated',
    'public.dlkt_info_interest_rules.dlkt_info_interest_rules_insert_own:INSERT:authenticated',
    'public.dlkt_info_interest_rules.dlkt_info_interest_rules_select_own:SELECT:authenticated',
    'public.dlkt_info_interest_rules.dlkt_info_interest_rules_update_own:UPDATE:authenticated',
    'public.dlkt_info_profiles.dlkt_info_profiles_insert_own:INSERT:authenticated',
    'public.dlkt_info_profiles.dlkt_info_profiles_select_own:SELECT:authenticated',
    'public.dlkt_info_profiles.dlkt_info_profiles_update_own:UPDATE:authenticated',
    'public.dlkt_info_user_memory.dlkt_info_user_memory_delete_own:DELETE:authenticated',
    'public.dlkt_info_user_memory.dlkt_info_user_memory_insert_own:INSERT:authenticated',
    'public.dlkt_info_user_memory.dlkt_info_user_memory_select_own:SELECT:authenticated',
    'public.dlkt_info_user_memory.dlkt_info_user_memory_update_own:UPDATE:authenticated',
    'public.dlkt_info_shared_cards.dlkt_info_shared_cards_public_read:SELECT:anon,authenticated,service_role',
    'public.dlkt_info_news_candidates.dlkt_info_news_candidates_public_read:SELECT:anon,authenticated,service_role'
  ]::text[];
  v_required_triggers text[] := array[
    'auth.users.on_auth_user_created_dlkt_info',
    'dlkt_info_private.briefing_card_claims.dlkt_info_card_claims_append_only',
    'dlkt_info_private.claim_evidence.dlkt_info_claim_evidence_append_only',
    'dlkt_info_private.claims.dlkt_info_claims_append_only',
    'dlkt_info_private.delivery_endpoint_secrets.dlkt_info_delivery_endpoint_secrets_touch',
    'dlkt_info_private.entities.dlkt_info_entities_touch',
    'dlkt_info_private.internal_delta_jobs.dlkt_info_internal_delta_jobs_touch',
    'dlkt_info_private.internal_delta_review_events.dlkt_info_internal_delta_review_events_immutable',
    'dlkt_info_private.internal_delta_trial_card_claims.dlkt_info_internal_delta_trial_card_claims_immutable',
    'dlkt_info_private.internal_delta_trials.dlkt_info_internal_delta_trials_touch',
    'dlkt_info_private.source_acquisition_events.dlkt_info_source_acquisition_events_immutable',
    'dlkt_info_private.source_acquisition_state.dlkt_info_source_acquisition_state_touch',
    'dlkt_info_private.source_claim_batch_items.dlkt_info_source_claim_batch_items_immutable',
    'dlkt_info_private.source_claim_batches.dlkt_info_source_claim_batches_enqueue_internal_delta',
    'dlkt_info_private.source_claim_batches.dlkt_info_source_claim_batches_immutable',
    'public.dlkt_info_briefing_cards.dlkt_info_briefing_cards_append_only',
    'public.dlkt_info_briefing_cards.dlkt_info_briefing_cards_owner',
    'public.dlkt_info_briefing_events.dlkt_info_briefing_events_append_only',
    'public.dlkt_info_briefing_runs.dlkt_info_briefing_runs_owner',
    'public.dlkt_info_briefing_targets.dlkt_info_briefing_targets_touch',
    'public.dlkt_info_briefing_targets.dlkt_info_briefing_targets_validate',
    'public.dlkt_info_briefings.dlkt_info_briefings_default_web_target',
    'public.dlkt_info_briefings.dlkt_info_briefings_protect_system_fields',
    'public.dlkt_info_briefings.dlkt_info_briefings_schedule',
    'public.dlkt_info_delivery_endpoints.dlkt_info_delivery_endpoints_protect_system_fields',
    'public.dlkt_info_delivery_endpoints.dlkt_info_delivery_endpoints_touch',
    'public.dlkt_info_delivery_receipts.dlkt_info_delivery_receipts_append_only',
    'public.dlkt_info_delivery_receipts.dlkt_info_delivery_receipts_owner',
    'public.dlkt_info_interest_rules.dlkt_info_interest_rules_touch',
    'public.dlkt_info_profiles.dlkt_info_profiles_protect_system_fields',
    'public.dlkt_info_profiles.dlkt_info_profiles_touch',
    'public.dlkt_info_user_memory.dlkt_info_user_memory_touch',
    'public.dlkt_info_shared_cards.dlkt_info_shared_cards_immutable',
    'public.dlkt_info_shared_cards.dlkt_info_shared_cards_no_truncate'
  ]::text[];
  v_public_anon_functions text[] := array[
    'public.dlkt_info_read_database_readiness()',
    'public.dlkt_info_read_system_identity()',
    'public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)',
    'public.dlkt_info_upsert_news_candidates(jsonb)',
    'public.dlkt_info_read_public_snapshot()',
    'public.dlkt_info_claim_public_refresh(uuid, jsonb)',
    'public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)',
    'public.dlkt_info_fail_public_refresh(uuid, bigint, text)',
    'public.dlkt_info_stage_news_corpus(uuid, bigint, jsonb, text, jsonb)',
    'public.dlkt_info_read_news_corpus(bigint)',
    'public.dlkt_info_find_news_corpus_article(text, text, text, bigint)'
  ]::text[];
  v_public_authenticated_functions text[] := array[
    'public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamp with time zone)',
    'public.dlkt_info_read_companion_configuration()',
    'public.dlkt_info_read_database_readiness()',
    'public.dlkt_info_read_system_identity()',
    'public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, integer, text, boolean, text, text, text, integer, integer, boolean)',
    'public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)',
    'public.dlkt_info_upsert_news_candidates(jsonb)',
    'public.dlkt_info_read_public_snapshot()',
    'public.dlkt_info_claim_public_refresh(uuid, jsonb)',
    'public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)',
    'public.dlkt_info_fail_public_refresh(uuid, bigint, text)',
    'public.dlkt_info_stage_news_corpus(uuid, bigint, jsonb, text, jsonb)',
    'public.dlkt_info_read_news_corpus(bigint)',
    'public.dlkt_info_find_news_corpus_article(text, text, text, bigint)'
  ]::text[];
  v_public_service_functions text[] := array[
    'public.dlkt_info_claim_delivery_jobs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_due_briefings(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_internal_delta_jobs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_queued_runs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_commit_source_acquisition(text, uuid, text, integer, jsonb, text, text, text, boolean, jsonb, timestamp with time zone)',
    'public.dlkt_info_complete_internal_delta_trial(uuid, text, text, text, text, text, timestamp with time zone, timestamp with time zone, text, jsonb, jsonb, timestamp with time zone)',
    'public.dlkt_info_complete_source_acquisition(text, uuid, text, text, integer, jsonb, text, text, text, text, timestamp with time zone)',
    'public.dlkt_info_fail_internal_delta_job(uuid, text, text, timestamp with time zone, timestamp with time zone)',
    'public.dlkt_info_finalize_run(uuid, text, jsonb, text, text, text, timestamp with time zone)',
    'public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamp with time zone)',
    'public.dlkt_info_read_companion_configuration()',
    'public.dlkt_info_read_database_readiness()',
    'public.dlkt_info_read_internal_delta_review_queue(integer)',
    'public.dlkt_info_read_source_acquisition(text)',
    'public.dlkt_info_read_system_identity()',
    'public.dlkt_info_record_delivery_attempt(uuid, text, boolean, text, text, timestamp with time zone, jsonb, timestamp with time zone)',
    'public.dlkt_info_recover_expired_leases(timestamp with time zone)',
    'public.dlkt_info_reserve_source_acquisition(text, text, timestamp with time zone, integer)',
    'public.dlkt_info_review_internal_delta_card(uuid, text, text, text, timestamp with time zone)',
    'public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, integer, text, boolean, text, text, text, integer, integer, boolean)',
    'public.dlkt_info_verify_delivery_endpoint(uuid, text, timestamp with time zone)',
    'public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)',
    'public.dlkt_info_upsert_news_candidates(jsonb)',
    'public.dlkt_info_read_public_snapshot()',
    'public.dlkt_info_claim_public_refresh(uuid, jsonb)',
    'public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)',
    'public.dlkt_info_fail_public_refresh(uuid, bigint, text)',
    'public.dlkt_info_stage_news_corpus(uuid, bigint, jsonb, text, jsonb)',
    'public.dlkt_info_read_news_corpus(bigint)',
    'public.dlkt_info_find_news_corpus_article(text, text, text, bigint)'
  ]::text[];
  v_private_authenticated_functions text[] := array[
    'dlkt_info_private.is_sha256(text)',
    'dlkt_info_private.is_valid_channels(text[])',
    'dlkt_info_private.is_valid_iso_weekdays(smallint[])',
    'dlkt_info_private.is_valid_text_collection(text[], integer, integer)',
    'dlkt_info_private.is_valid_text_set(text[], integer, integer)',
    'dlkt_info_private.is_valid_timezone(text)'
  ]::text[];
  v_private_service_functions text[] := array[
    'dlkt_info_private.append_event(uuid, uuid, text, text, text, jsonb)',
    'dlkt_info_private.clean_error_detail(text)',
    'dlkt_info_private.enqueue_internal_delta_job()',
    'dlkt_info_private.ensure_default_web_target()',
    'dlkt_info_private.handle_new_user()',
    'dlkt_info_private.hash_text(text)',
    'dlkt_info_private.internal_claim_payload(uuid)',
    'dlkt_info_private.is_sha256(text)',
    'dlkt_info_private.is_valid_channels(text[])',
    'dlkt_info_private.is_valid_iso_weekdays(smallint[])',
    'dlkt_info_private.is_valid_text_collection(text[], integer, integer)',
    'dlkt_info_private.is_valid_text_set(text[], integer, integer)',
    'dlkt_info_private.is_valid_timezone(text)',
    'dlkt_info_private.prevent_mutation()',
    'dlkt_info_private.protect_briefing_system_fields()',
    'dlkt_info_private.protect_endpoint_system_fields()',
    'dlkt_info_private.protect_profile_system_fields()',
    'dlkt_info_private.require_service_role()',
    'dlkt_info_private.set_briefing_schedule()',
    'dlkt_info_private.set_card_owner()',
    'dlkt_info_private.set_receipt_owner()',
    'dlkt_info_private.set_run_owner()',
    'dlkt_info_private.touch_updated_at()',
    'dlkt_info_private.validate_briefing_target()'
  ]::text[];
  v_public_definer_functions text[] := array[
    'public.dlkt_info_claim_delivery_jobs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_due_briefings(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_internal_delta_jobs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_claim_queued_runs(text, integer, timestamp with time zone, integer)',
    'public.dlkt_info_commit_source_acquisition(text, uuid, text, integer, jsonb, text, text, text, boolean, jsonb, timestamp with time zone)',
    'public.dlkt_info_complete_internal_delta_trial(uuid, text, text, text, text, text, timestamp with time zone, timestamp with time zone, text, jsonb, jsonb, timestamp with time zone)',
    'public.dlkt_info_complete_source_acquisition(text, uuid, text, text, integer, jsonb, text, text, text, text, timestamp with time zone)',
    'public.dlkt_info_fail_internal_delta_job(uuid, text, text, timestamp with time zone, timestamp with time zone)',
    'public.dlkt_info_finalize_run(uuid, text, jsonb, text, text, text, timestamp with time zone)',
    'public.dlkt_info_read_companion_configuration()',
    'public.dlkt_info_read_database_readiness()',
    'public.dlkt_info_read_internal_delta_review_queue(integer)',
    'public.dlkt_info_read_source_acquisition(text)',
    'public.dlkt_info_read_system_identity()',
    'public.dlkt_info_record_delivery_attempt(uuid, text, boolean, text, text, timestamp with time zone, jsonb, timestamp with time zone)',
    'public.dlkt_info_recover_expired_leases(timestamp with time zone)',
    'public.dlkt_info_reserve_source_acquisition(text, text, timestamp with time zone, integer)',
    'public.dlkt_info_review_internal_delta_card(uuid, text, text, text, timestamp with time zone)',
    'public.dlkt_info_save_companion_configuration(uuid, text[], text[], text, time without time zone, integer, text, boolean, text, text, text, integer, integer, boolean)',
    'public.dlkt_info_verify_delivery_endpoint(uuid, text, timestamp with time zone)',
    'public.dlkt_info_capture_shared_card(jsonb, timestamp with time zone, timestamp with time zone, boolean)',
    'public.dlkt_info_upsert_news_candidates(jsonb)',
    'public.dlkt_info_read_public_snapshot()',
    'public.dlkt_info_claim_public_refresh(uuid, jsonb)',
    'public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)',
    'public.dlkt_info_fail_public_refresh(uuid, bigint, text)',
    'public.dlkt_info_stage_news_corpus(uuid, bigint, jsonb, text, jsonb)',
    'public.dlkt_info_read_news_corpus(bigint)',
    'public.dlkt_info_find_news_corpus_article(text, text, text, bigint)'
  ]::text[];
  v_public_invoker_functions text[] := array[
    'public.dlkt_info_next_delivery_at(text, time without time zone, smallint[], timestamp with time zone)'
  ]::text[];
  v_private_definer_functions text[] := array[
    'dlkt_info_private.append_event(uuid, uuid, text, text, text, jsonb)',
    'dlkt_info_private.enqueue_internal_delta_job()',
    'dlkt_info_private.ensure_default_web_target()',
    'dlkt_info_private.handle_new_user()',
    'dlkt_info_private.set_briefing_schedule()',
    'dlkt_info_private.set_card_owner()',
    'dlkt_info_private.set_receipt_owner()',
    'dlkt_info_private.set_run_owner()',
    'dlkt_info_private.validate_briefing_target()'
  ]::text[];
  v_private_invoker_functions text[] := array[
    'dlkt_info_private.clean_error_detail(text)',
    'dlkt_info_private.hash_text(text)',
    'dlkt_info_private.internal_claim_payload(uuid)',
    'dlkt_info_private.is_sha256(text)',
    'dlkt_info_private.is_valid_channels(text[])',
    'dlkt_info_private.is_valid_iso_weekdays(smallint[])',
    'dlkt_info_private.is_valid_text_collection(text[], integer, integer)',
    'dlkt_info_private.is_valid_text_set(text[], integer, integer)',
    'dlkt_info_private.is_valid_timezone(text)',
    'dlkt_info_private.prevent_mutation()',
    'dlkt_info_private.protect_briefing_system_fields()',
    'dlkt_info_private.protect_endpoint_system_fields()',
    'dlkt_info_private.protect_profile_system_fields()',
    'dlkt_info_private.require_service_role()',
    'dlkt_info_private.touch_updated_at()',
    'dlkt_info_private.share_archive_content(jsonb)',
    'dlkt_info_private.valid_share_archive_card(jsonb)',
    'dlkt_info_private.prevent_share_archive_mutation()',
    'dlkt_info_private.valid_news_candidate_publisher(text, text)',
    'dlkt_info_private.valid_news_candidate(jsonb, timestamp with time zone)',
    'dlkt_info_private.require_public_refresh_writer()',
    'dlkt_info_private.valid_public_refresh_snapshot(jsonb, timestamp with time zone)',
    'dlkt_info_private.valid_news_diagnostics(jsonb, timestamp with time zone)',
    'dlkt_info_private.news_fold(text)',
    'dlkt_info_private.news_local_anchors(text, text)',
    'dlkt_info_private.valid_news_local_article(jsonb, jsonb, timestamp with time zone)',
    'dlkt_info_private.valid_news_corpus(jsonb, timestamp with time zone)',
    'dlkt_info_private.publish_news_corpus(bigint, bigint, timestamp with time zone)'
  ]::text[];
  -- Manifest v3 uses effective privileges (including inherited/PUBLIC grants).
  -- MAINTAIN was introduced in PostgreSQL 17; never ask older servers about it.
  v_table_privileges text[] := array['SELECT', 'INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER']::text[]
    || case when current_setting('server_version_num')::integer >= 170000 then array['MAINTAIN']::text[] else array[]::text[] end;
  v_column_privileges text[] := array['SELECT', 'INSERT', 'UPDATE', 'REFERENCES']::text[];
  v_sequence_privileges text[] := array['USAGE', 'SELECT', 'UPDATE']::text[];
  v_public_relations text[] := array[
    'public.dlkt_info_briefing_cards',
    'public.dlkt_info_briefing_events',
    'public.dlkt_info_briefing_runs',
    'public.dlkt_info_briefing_targets',
    'public.dlkt_info_briefings',
    'public.dlkt_info_delivery_endpoints',
    'public.dlkt_info_delivery_receipts',
    'public.dlkt_info_interest_rules',
    'public.dlkt_info_profiles',
    'public.dlkt_info_user_memory'
  ]::text[];
  v_public_authenticated_tables jsonb := '{"public.dlkt_info_briefing_cards":["SELECT"],"public.dlkt_info_briefing_events":["SELECT"],"public.dlkt_info_briefing_runs":["SELECT"],"public.dlkt_info_briefing_targets":["SELECT","INSERT","UPDATE","DELETE"],"public.dlkt_info_briefings":["SELECT","INSERT","UPDATE","DELETE"],"public.dlkt_info_delivery_endpoints":["SELECT","INSERT","UPDATE","DELETE"],"public.dlkt_info_delivery_receipts":["SELECT"],"public.dlkt_info_interest_rules":["SELECT","INSERT","UPDATE","DELETE"],"public.dlkt_info_profiles":["SELECT","INSERT","UPDATE"],"public.dlkt_info_user_memory":["SELECT","INSERT","UPDATE","DELETE"]}'::jsonb;
  v_event_sequence oid;
  v_public_data_permissions_ok boolean := false;
  v_instance_id uuid;
  v_relations_present integer := 0;
  v_relations_total integer := 0;
  v_functions_present integer := 0;
  v_functions_total integer := 0;
  v_rls_present integer := 0;
  v_rls_total integer := 0;
  v_policies_present integer := 0;
  v_policies_total integer := 0;
  v_triggers_present integer := 0;
  v_triggers_total integer := 0;
  v_identity_ok boolean := false;
  v_relations_ok boolean := false;
  v_functions_ok boolean := false;
  v_rls_ok boolean := false;
  v_policies_ok boolean := false;
  v_triggers_ok boolean := false;
  v_private_schema_ok boolean := false;
  v_private_tables_ok boolean := false;
  v_public_rpc_permissions_ok boolean := false;
  v_private_function_permissions_ok boolean := false;
  v_security_definer_ok boolean := false;
  v_search_path_ok boolean := false;
  v_no_unexpected_objects boolean := false;
  v_ready boolean := false;
  v_activation_receipt text;
begin
  select instance_id into v_instance_id
  from dlkt_info_private.system_identity
  where singleton
  limit 1;

  select
    count(*) = 1
      and bool_and(product_id = 'dlkt-info')
      and bool_and(engine_id = 'dlkt-info-inphocore-engine-orchestra')
      and bool_and(data_foundation_version = 'dlkt-info-data-1')
      and bool_and(persistence_version = 'dlkt-info-persistence-2')
      and bool_and(schema_revision = '20261113115256_dlkt_info_provisioning_identity_guard')
      and bool_and(data_region = 'eu-central-1')
      and bool_and(dedicated)
      and bool_and(not automatic_execution)
      and bool_and(not public_cards_enabled)
  into v_identity_ok
  from dlkt_info_private.system_identity;

  select count(*) into v_relations_present
  from unnest(v_required_relations) as required(relation_name)
  where to_regclass(required.relation_name) is not null;

  select count(*) into v_relations_total
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r'
    and (n.nspname = 'dlkt_info_private' or (n.nspname = 'public' and c.relname like 'dlkt_info_%'));

  v_relations_ok := v_relations_present = cardinality(v_required_relations);

  select count(*) into v_functions_present
  from unnest(v_required_functions) as required(function_signature)
  where to_regprocedure(required.function_signature) is not null;

  select count(*) into v_functions_total
  from pg_proc p
  join pg_namespace n on n.oid = p.pronamespace
  where (n.nspname = 'public' and p.proname like 'dlkt_info_%')
     or n.nspname = 'dlkt_info_private';

  v_functions_ok := v_functions_present = cardinality(v_required_functions);

  select count(*) into v_rls_present
  from unnest(v_required_rls) as required(relation_name)
  join pg_class c on c.oid = to_regclass(required.relation_name)
  where c.relrowsecurity;

  select count(*) into v_rls_total
  from pg_class c
  join pg_namespace n on n.oid = c.relnamespace
  where c.relkind = 'r' and c.relrowsecurity
    and (n.nspname = 'dlkt_info_private' or (n.nspname = 'public' and c.relname like 'dlkt_info_%'));

  v_rls_ok := v_rls_present = cardinality(v_required_rls);

  select count(*) into v_policies_present
  from unnest(v_required_policies) as required(policy_signature)
  where exists (
    select 1 from pg_policies p
    where format('%s.%s.%s:%s:%s', p.schemaname, p.tablename, p.policyname, p.cmd, array_to_string(p.roles, ',')) = required.policy_signature
  );

  select count(*) into v_policies_total
  from pg_policies p
  where p.schemaname in ('public', 'dlkt_info_private')
    and (p.schemaname = 'dlkt_info_private' or p.tablename like 'dlkt_info_%');

  v_policies_ok := v_policies_present = cardinality(v_required_policies);

  -- pg_trigger preserves the original non-internal trigger scope and also sees
  -- statement TRUNCATE triggers, which information_schema.triggers omits.
  select count(*) into v_triggers_present
  from unnest(v_required_triggers) as required(trigger_signature)
  where exists (
    select 1 from pg_trigger t
    join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
    where not t.tgisinternal and t.tgenabled in ('O','A')
      and format('%s.%s.%s', n.nspname, c.relname, t.tgname) = required.trigger_signature
  );

  select count(*) into v_triggers_total
  from pg_trigger t
  join pg_class c on c.oid=t.tgrelid join pg_namespace n on n.oid=c.relnamespace
  where not t.tgisinternal and (
    (n.nspname in ('public','dlkt_info_private') and (n.nspname='dlkt_info_private' or c.relname like 'dlkt_info_%'))
    or (n.nspname='auth' and c.relname='users' and t.tgname='on_auth_user_created_dlkt_info')
  );

  v_triggers_ok := v_triggers_present = cardinality(v_required_triggers);

  v_private_schema_ok :=
    not has_schema_privilege('anon', 'dlkt_info_private', 'USAGE')
    and has_schema_privilege('authenticated', 'dlkt_info_private', 'USAGE')
    and has_schema_privilege('service_role', 'dlkt_info_private', 'USAGE');

  -- The private table boundary has the same deny-all semantics for untrusted
  -- roles as before, now including every table/column privilege and grant option.
  select coalesce(bool_and(coalesce(
    not has_table_privilege('anon', to_regclass(required.relation_name), privilege.name)
    and not has_table_privilege('anon', to_regclass(required.relation_name), privilege.name || ' WITH GRANT OPTION')
    and not has_table_privilege('authenticated', to_regclass(required.relation_name), privilege.name)
    and not has_table_privilege('authenticated', to_regclass(required.relation_name), privilege.name || ' WITH GRANT OPTION')
  , false)), false) into v_private_tables_ok
  from unnest(v_private_relations) as required(relation_name)
  cross join unnest(v_table_privileges) as privilege(name);

  v_private_tables_ok := v_private_tables_ok and coalesce((
    select bool_and(coalesce(
      not has_any_column_privilege('anon', to_regclass(required.relation_name), privilege.name)
      and not has_any_column_privilege('anon', to_regclass(required.relation_name), privilege.name || ' WITH GRANT OPTION')
      and not has_any_column_privilege('authenticated', to_regclass(required.relation_name), privilege.name)
      and not has_any_column_privilege('authenticated', to_regclass(required.relation_name), privilege.name || ' WITH GRANT OPTION')
    , false))
    from unnest(v_private_relations) as required(relation_name)
    cross join unnest(v_column_privileges) as privilege(name)
  ), false);

  -- The authenticated table operations are an exact set, never merely required
  -- minimums. anon has none; PUBLIC grants are included by privilege inquiry.
  -- All table privileges remain required for the trusted service_role, but its
  -- additional administrative/grant-option privileges are intentionally retained.
  select coalesce(bool_and(coalesce(
    not has_table_privilege('anon', to_regclass(required.relation_name), privilege.name)
    and not has_table_privilege('anon', to_regclass(required.relation_name), privilege.name || ' WITH GRANT OPTION')
    and has_table_privilege('authenticated', to_regclass(required.relation_name), privilege.name)
      = ((v_public_authenticated_tables -> required.relation_name) ? privilege.name)
    and not has_table_privilege('authenticated', to_regclass(required.relation_name), privilege.name || ' WITH GRANT OPTION')
    and has_table_privilege('service_role', to_regclass(required.relation_name), privilege.name)
  , false)), false) into v_public_data_permissions_ok
  from unnest(v_public_relations) as required(relation_name)
  cross join unnest(v_table_privileges) as privilege(name);

  v_public_data_permissions_ok := v_public_data_permissions_ok and coalesce((
    select bool_and(coalesce(
      not has_any_column_privilege('anon', to_regclass(required.relation_name), privilege.name)
      and not has_any_column_privilege('anon', to_regclass(required.relation_name), privilege.name || ' WITH GRANT OPTION')
      and has_any_column_privilege('authenticated', to_regclass(required.relation_name), privilege.name)
        = ((v_public_authenticated_tables -> required.relation_name) ? privilege.name)
      and not has_any_column_privilege('authenticated', to_regclass(required.relation_name), privilege.name || ' WITH GRANT OPTION')
    , false))
    from unnest(v_public_relations) as required(relation_name)
    cross join unnest(v_column_privileges) as privilege(name)
  ), false);

  -- Reject even redundant explicit column grants available to the untrusted
  -- roles, directly or through inherited roles. Table-level grants above are
  -- the sole intended source of their column privileges.
  v_public_data_permissions_ok := v_public_data_permissions_ok and not exists (
    select 1
    from pg_attribute a
    cross join lateral aclexplode(case when cardinality(a.attacl) > 0 then a.attacl end) as acl
    where a.attrelid = any(array(select to_regclass(r) from unnest(v_public_relations) as r))
      and a.attnum > 0 and not a.attisdropped
      and case when acl.grantee = 0 then true else
        pg_has_role('anon', acl.grantee, 'USAGE') or pg_has_role('authenticated', acl.grantee, 'USAGE')
      end
  );
  v_private_tables_ok := v_private_tables_ok and not exists (
    select 1
    from pg_attribute a
    cross join lateral aclexplode(case when cardinality(a.attacl) > 0 then a.attacl end) as acl
    where a.attrelid = any(array(select to_regclass(r) from unnest(v_private_relations) as r))
      and a.attnum > 0 and not a.attisdropped
      and case when acl.grantee = 0 then true else
        pg_has_role('anon', acl.grantee, 'USAGE') or pg_has_role('authenticated', acl.grantee, 'USAGE')
      end
  );

  select c.oid into v_event_sequence
  from pg_class c
  where c.oid = to_regclass('public.dlkt_info_briefing_events_id_seq') and c.relkind = 'S';

  v_public_data_permissions_ok := v_public_data_permissions_ok
    and v_event_sequence is not null
    and coalesce((
      select bool_and(coalesce(
        not has_sequence_privilege('anon', v_event_sequence, privilege.name)
        and not has_sequence_privilege('anon', v_event_sequence, privilege.name || ' WITH GRANT OPTION')
        and not has_sequence_privilege('authenticated', v_event_sequence, privilege.name)
        and not has_sequence_privilege('authenticated', v_event_sequence, privilege.name || ' WITH GRANT OPTION')
      , false))
      from unnest(v_sequence_privileges) as privilege(name)
    ), false)
    and coalesce(has_sequence_privilege('service_role', v_event_sequence, 'USAGE'), false)
    and coalesce(has_sequence_privilege('service_role', v_event_sequence, 'SELECT'), false);

  select coalesce(bool_and(
    has_function_privilege('service_role', to_regprocedure(required.function_signature), 'EXECUTE') = (required.function_signature = any(v_public_service_functions))
    and has_function_privilege('anon', to_regprocedure(required.function_signature), 'EXECUTE') = (required.function_signature = any(v_public_anon_functions))
    and has_function_privilege('authenticated', to_regprocedure(required.function_signature), 'EXECUTE') = (required.function_signature = any(v_public_authenticated_functions))
  ), false) into v_public_rpc_permissions_ok
  from unnest(v_public_functions) as required(function_signature)
  where to_regprocedure(required.function_signature) is not null;

  select coalesce(bool_and(
    not has_function_privilege('anon', to_regprocedure(required.function_signature), 'EXECUTE')
    and has_function_privilege('authenticated', to_regprocedure(required.function_signature), 'EXECUTE') = (required.function_signature = any(v_private_authenticated_functions))
    and has_function_privilege('service_role', to_regprocedure(required.function_signature), 'EXECUTE') = (required.function_signature = any(v_private_service_functions))
  ), false) into v_private_function_permissions_ok
  from unnest(v_private_functions) as required(function_signature)
  where to_regprocedure(required.function_signature) is not null;

  select coalesce(bool_and(
    p.prosecdef = (required.function_signature = any(v_public_definer_functions))
    and (p.prosecdef or required.function_signature = any(v_public_invoker_functions))
  ), false) into v_security_definer_ok
  from unnest(v_public_functions) as required(function_signature)
  join pg_proc p on p.oid = to_regprocedure(required.function_signature);

  v_security_definer_ok := v_security_definer_ok and coalesce((
    select bool_and(
      p.prosecdef = (required.function_signature = any(v_private_definer_functions))
      and (p.prosecdef or required.function_signature = any(v_private_invoker_functions))
    )
    from unnest(v_private_functions) as required(function_signature)
    join pg_proc p on p.oid = to_regprocedure(required.function_signature)
  ), false);

  select coalesce(bool_and(exists (
    select 1 from unnest(coalesce(p.proconfig, array[]::text[])) as config(value) where config.value like 'search_path=%'
  )), false) into v_search_path_ok
  from unnest(v_required_functions) as required(function_signature)
  join pg_proc p on p.oid = to_regprocedure(required.function_signature);

  -- Archive-only additions. The ten existing public table ACLs and all existing
  -- private-data checks above remain unchanged; this is a separate exact public
  -- copy table and a secret hash table with stricter service-role restrictions.
  v_public_data_permissions_ok := v_public_data_permissions_ok and coalesce((
    select bool_and(
      has_table_privilege(role.name,'public.dlkt_info_shared_cards',privilege.name) = (privilege.name='SELECT')
      and not has_table_privilege(role.name,'public.dlkt_info_shared_cards',privilege.name || ' WITH GRANT OPTION')
    ) from unnest(array['anon','authenticated','service_role']) as role(name)
    cross join unnest(v_table_privileges) as privilege(name)
  ),false) and coalesce((
    select bool_and(
      has_any_column_privilege(role.name,'public.dlkt_info_shared_cards',privilege.name) = (privilege.name='SELECT')
      and not has_any_column_privilege(role.name,'public.dlkt_info_shared_cards',privilege.name || ' WITH GRANT OPTION')
    ) from unnest(array['anon','authenticated','service_role']) as role(name)
    cross join unnest(v_column_privileges) as privilege(name)
  ),false);
  v_private_tables_ok := v_private_tables_ok and coalesce((
    select bool_and(
      not has_table_privilege(role.name,'dlkt_info_private.share_archive_writer',privilege.name)
      and not has_table_privilege(role.name,'dlkt_info_private.share_archive_writer',privilege.name || ' WITH GRANT OPTION')
    ) from unnest(array['anon','authenticated','service_role']) as role(name)
    cross join unnest(v_table_privileges) as privilege(name)
  ),false) and coalesce((
    select bool_and(
      not has_any_column_privilege(role.name,'dlkt_info_private.share_archive_writer',privilege.name)
      and not has_any_column_privilege(role.name,'dlkt_info_private.share_archive_writer',privilege.name || ' WITH GRANT OPTION')
    ) from unnest(array['anon','authenticated','service_role']) as role(name)
    cross join unnest(v_column_privileges) as privilege(name)
  ),false);
  v_public_data_permissions_ok := v_public_data_permissions_ok and not exists (
    select 1 from pg_attribute a
    cross join lateral aclexplode(case when cardinality(a.attacl)>0 then a.attacl end) acl
    where a.attrelid='public.dlkt_info_shared_cards'::regclass and a.attnum>0 and not a.attisdropped
      and case when acl.grantee=0 then true else
        pg_has_role('anon',acl.grantee,'USAGE') or pg_has_role('authenticated',acl.grantee,'USAGE') or pg_has_role('service_role',acl.grantee,'USAGE') end
  ) and not exists (
    select 1 from pg_class c cross join lateral aclexplode(c.relacl) acl
    where c.oid='public.dlkt_info_shared_cards'::regclass and acl.grantee=0
  );
  v_private_tables_ok := v_private_tables_ok and not exists (
    select 1 from pg_attribute a
    cross join lateral aclexplode(case when cardinality(a.attacl)>0 then a.attacl end) acl
    where a.attrelid='dlkt_info_private.share_archive_writer'::regclass and a.attnum>0 and not a.attisdropped
      and case when acl.grantee=0 then true else
        pg_has_role('anon',acl.grantee,'USAGE') or pg_has_role('authenticated',acl.grantee,'USAGE') or pg_has_role('service_role',acl.grantee,'USAGE') end
  );
  v_policies_ok := v_policies_ok and exists (
    select 1 from pg_policy p where p.polrelid='public.dlkt_info_shared_cards'::regclass
      and p.polname='dlkt_info_shared_cards_public_read' and p.polcmd='r' and p.polpermissive
      and pg_get_expr(p.polqual,p.polrelid)='true' and p.polwithcheck is null
  );
  v_triggers_ok := v_triggers_ok and exists (
    select 1 from pg_trigger t where t.tgrelid='public.dlkt_info_shared_cards'::regclass
      and t.tgname='dlkt_info_shared_cards_immutable' and t.tgtype=27 and t.tgenabled in ('O','A')
      and t.tgfoid='dlkt_info_private.prevent_share_archive_mutation()'::regprocedure
  ) and exists (
    select 1 from pg_trigger t where t.tgrelid='public.dlkt_info_shared_cards'::regclass
      and t.tgname='dlkt_info_shared_cards_no_truncate' and t.tgtype=34 and t.tgenabled in ('O','A')
      and t.tgfoid='dlkt_info_private.prevent_share_archive_mutation()'::regprocedure
  );
  v_search_path_ok := v_search_path_ok and coalesce((
    select bool_and(p.proconfig @> array['search_path=""']::text[])
    from pg_proc p where p.oid = any(array[
      'dlkt_info_private.share_archive_content(jsonb)'::regprocedure,
      'dlkt_info_private.valid_share_archive_card(jsonb)'::regprocedure,
      'dlkt_info_private.prevent_share_archive_mutation()'::regprocedure,
      'public.dlkt_info_capture_shared_card(jsonb,timestamptz,timestamptz,boolean)'::regprocedure
    ])
  ),false);

  -- Public candidate cache retains strict SELECT-only application roles.
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

  -- Unclassified candidates remain nullable text, with the existing non-null category constraint intact.
  v_public_data_permissions_ok := v_public_data_permissions_ok and exists (
    select 1 from pg_attribute a where a.attrelid='public.dlkt_info_news_candidates'::regclass
      and a.attname='category' and not a.attisdropped and not a.attnotnull and a.atttypid='text'::regtype
  ) and exists (
    select 1 from pg_constraint c where c.conrelid='public.dlkt_info_news_candidates'::regclass
      and c.conname='dlkt_info_news_candidates_category_check' and c.contype='c' and c.convalidated
      and pg_get_expr(c.conbin,c.conrelid)='(category = ANY (ARRAY[''world''::text, ''business''::text, ''technology''::text, ''money''::text, ''health''::text, ''sport''::text, ''gaming''::text, ''culture''::text, ''shopping''::text, ''travel''::text, ''work''::text, ''education''::text, ''family''::text, ''science''::text, ''environment''::text, ''public-affairs''::text, ''digital-life''::text, ''food''::text, ''housing''::text, ''weather''::text]))'
  );
  -- Continuous refresh state and receipts are private even from service-role REST access.
  v_private_tables_ok := v_private_tables_ok and coalesce((
    select bool_and(not has_table_privilege(role.name,relation.name,privilege.name)
      and not has_table_privilege(role.name,relation.name,privilege.name || ' WITH GRANT OPTION'))
    from unnest(array['anon','authenticated','service_role']) role(name)
    cross join unnest(array['dlkt_info_private.public_refresh_state','dlkt_info_private.public_refresh_runs']) relation(name)
    cross join unnest(v_table_privileges) privilege(name)
  ),false) and coalesce((
    select bool_and(not has_any_column_privilege(role.name,relation.name,privilege.name)
      and not has_any_column_privilege(role.name,relation.name,privilege.name || ' WITH GRANT OPTION'))
    from unnest(array['anon','authenticated','service_role']) role(name)
    cross join unnest(array['dlkt_info_private.public_refresh_state','dlkt_info_private.public_refresh_runs']) relation(name)
    cross join unnest(v_column_privileges) privilege(name)
  ),false) and not exists (
    select 1 from pg_class c cross join lateral aclexplode(c.relacl) acl
    where c.oid=any(array['dlkt_info_private.public_refresh_state'::regclass,'dlkt_info_private.public_refresh_runs'::regclass]) and acl.grantee=0
  ) and not exists (
    select 1 from pg_attribute a cross join lateral aclexplode(case when cardinality(a.attacl)>0 then a.attacl end) acl
    where a.attrelid=any(array['dlkt_info_private.public_refresh_state'::regclass,'dlkt_info_private.public_refresh_runs'::regclass]) and a.attnum>0 and not a.attisdropped
      and case when acl.grantee=0 then true else pg_has_role('anon',acl.grantee,'USAGE') or pg_has_role('authenticated',acl.grantee,'USAGE') or pg_has_role('service_role',acl.grantee,'USAGE') end
  );
  v_search_path_ok := v_search_path_ok and coalesce((select bool_and(p.proconfig @> array['search_path=""']::text[])
    from pg_proc p where p.oid=any(array['dlkt_info_private.require_public_refresh_writer()'::regprocedure,'dlkt_info_private.valid_public_refresh_snapshot(jsonb, timestamp with time zone)'::regprocedure,'public.dlkt_info_read_public_snapshot()'::regprocedure,'public.dlkt_info_claim_public_refresh(uuid, jsonb)'::regprocedure,'public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)'::regprocedure,'public.dlkt_info_fail_public_refresh(uuid, bigint, text)'::regprocedure])),false);
  v_public_rpc_permissions_ok := v_public_rpc_permissions_ok and not exists (
    select 1 from pg_proc p cross join lateral aclexplode(p.proacl) acl
    where p.oid=any(array['dlkt_info_private.require_public_refresh_writer()'::regprocedure,'dlkt_info_private.valid_public_refresh_snapshot(jsonb, timestamp with time zone)'::regprocedure,'public.dlkt_info_read_public_snapshot()'::regprocedure,'public.dlkt_info_claim_public_refresh(uuid, jsonb)'::regprocedure,'public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)'::regprocedure,'public.dlkt_info_fail_public_refresh(uuid, bigint, text)'::regprocedure]) and acl.grantee=0
  ) and coalesce((select bool_and(not has_function_privilege(role.name,p.oid,'EXECUTE WITH GRANT OPTION'))
    from pg_proc p cross join unnest(array['anon','authenticated','service_role']) role(name)
    where p.oid=any(array['dlkt_info_private.require_public_refresh_writer()'::regprocedure,'dlkt_info_private.valid_public_refresh_snapshot(jsonb, timestamp with time zone)'::regprocedure,'public.dlkt_info_read_public_snapshot()'::regprocedure,'public.dlkt_info_claim_public_refresh(uuid, jsonb)'::regprocedure,'public.dlkt_info_publish_public_snapshot(uuid, bigint, jsonb, text)'::regprocedure,'public.dlkt_info_fail_public_refresh(uuid, bigint, text)'::regprocedure])),false);

  -- This forward change admits only the two reviewed national Romanian publisher origins.
  v_public_data_permissions_ok := v_public_data_permissions_ok
    and dlkt_info_private.valid_news_candidate_publisher('Digi24','https://www.digi24.ro/stiri/checked-origin')
    and dlkt_info_private.valid_news_candidate_publisher('HotNews.ro','https://hotnews.ro/checked-origin')
    and not dlkt_info_private.valid_news_candidate_publisher('HotNews.ro','https://www.digi24.ro/stiri/checked-origin')
    and not dlkt_info_private.valid_news_candidate_publisher('Digi24','https://www.digi24.ro.attacker.invalid/stiri/checked-origin');

  -- Corpus and diagnostics stay private; only purpose-bound server RPCs can access them.
  v_private_tables_ok := v_private_tables_ok and coalesce((
    select bool_and(not has_table_privilege(role.name,relation.name,privilege.name)
      and not has_table_privilege(role.name,relation.name,privilege.name || ' WITH GRANT OPTION'))
    from unnest(array['anon','authenticated','service_role']) role(name)
    cross join unnest(array['dlkt_info_private.news_corpus_epochs']) relation(name)
    cross join unnest(v_table_privileges) privilege(name)
  ),false) and coalesce((
    select bool_and(not has_any_column_privilege(role.name,relation.name,privilege.name)
      and not has_any_column_privilege(role.name,relation.name,privilege.name || ' WITH GRANT OPTION'))
    from unnest(array['anon','authenticated','service_role']) role(name)
    cross join unnest(array['dlkt_info_private.news_corpus_epochs']) relation(name)
    cross join unnest(v_column_privileges) privilege(name)
  ),false) and not exists (
    select 1 from pg_class c cross join lateral aclexplode(c.relacl) acl
    where c.oid='dlkt_info_private.news_corpus_epochs'::regclass and acl.grantee=0
  ) and not exists (
    select 1 from pg_attribute a cross join lateral aclexplode(case when cardinality(a.attacl)>0 then a.attacl end) acl
    where a.attrelid='dlkt_info_private.news_corpus_epochs'::regclass and a.attnum>0 and not a.attisdropped
      and case when acl.grantee=0 then true else pg_has_role('anon',acl.grantee,'USAGE') or pg_has_role('authenticated',acl.grantee,'USAGE') or pg_has_role('service_role',acl.grantee,'USAGE') end
  );
  v_search_path_ok := v_search_path_ok and coalesce((select bool_and(p.proconfig @> array['search_path=""']::text[])
    from pg_proc p where p.oid=any(array['dlkt_info_private.valid_news_diagnostics(jsonb, timestamp with time zone)'::regprocedure,'dlkt_info_private.news_fold(text)'::regprocedure,'dlkt_info_private.news_local_anchors(text, text)'::regprocedure,'dlkt_info_private.valid_news_local_article(jsonb, jsonb, timestamp with time zone)'::regprocedure,'dlkt_info_private.valid_news_corpus(jsonb, timestamp with time zone)'::regprocedure,'dlkt_info_private.publish_news_corpus(bigint, bigint, timestamp with time zone)'::regprocedure,'public.dlkt_info_stage_news_corpus(uuid, bigint, jsonb, text, jsonb)'::regprocedure,'public.dlkt_info_read_news_corpus(bigint)'::regprocedure,'public.dlkt_info_find_news_corpus_article(text, text, text, bigint)'::regprocedure])),false);
  v_public_rpc_permissions_ok := v_public_rpc_permissions_ok and not exists (
    select 1 from pg_proc p cross join lateral aclexplode(p.proacl) acl
    where p.oid=any(array['dlkt_info_private.valid_news_diagnostics(jsonb, timestamp with time zone)'::regprocedure,'dlkt_info_private.news_fold(text)'::regprocedure,'dlkt_info_private.news_local_anchors(text, text)'::regprocedure,'dlkt_info_private.valid_news_local_article(jsonb, jsonb, timestamp with time zone)'::regprocedure,'dlkt_info_private.valid_news_corpus(jsonb, timestamp with time zone)'::regprocedure,'dlkt_info_private.publish_news_corpus(bigint, bigint, timestamp with time zone)'::regprocedure,'public.dlkt_info_stage_news_corpus(uuid, bigint, jsonb, text, jsonb)'::regprocedure,'public.dlkt_info_read_news_corpus(bigint)'::regprocedure,'public.dlkt_info_find_news_corpus_article(text, text, text, bigint)'::regprocedure]) and acl.grantee=0
  ) and coalesce((select bool_and(not has_function_privilege(role.name,p.oid,'EXECUTE WITH GRANT OPTION'))
    from pg_proc p cross join unnest(array['anon','authenticated','service_role']) role(name)
    where p.oid=any(array['dlkt_info_private.valid_news_diagnostics(jsonb, timestamp with time zone)'::regprocedure,'dlkt_info_private.news_fold(text)'::regprocedure,'dlkt_info_private.news_local_anchors(text, text)'::regprocedure,'dlkt_info_private.valid_news_local_article(jsonb, jsonb, timestamp with time zone)'::regprocedure,'dlkt_info_private.valid_news_corpus(jsonb, timestamp with time zone)'::regprocedure,'dlkt_info_private.publish_news_corpus(bigint, bigint, timestamp with time zone)'::regprocedure,'public.dlkt_info_stage_news_corpus(uuid, bigint, jsonb, text, jsonb)'::regprocedure,'public.dlkt_info_read_news_corpus(bigint)'::regprocedure,'public.dlkt_info_find_news_corpus_article(text, text, text, bigint)'::regprocedure])),false);
  v_private_tables_ok := v_private_tables_ok and 2 = (
    select count(*) from pg_attribute a where a.attrelid=any(array['dlkt_info_private.public_refresh_state'::regclass,'dlkt_info_private.public_refresh_runs'::regclass])
      and a.attname='news_diagnostics' and not a.attisdropped and a.atttypid='jsonb'::regtype
  ) and 2 = (
    select count(*) from pg_constraint c where (c.conrelid='dlkt_info_private.public_refresh_state'::regclass and c.conname='public_refresh_news_diagnostics_size'
      or c.conrelid='dlkt_info_private.public_refresh_runs'::regclass and c.conname='public_refresh_run_news_diagnostics_size') and c.contype='c' and c.convalidated
  );

  v_no_unexpected_objects :=
    v_relations_total = cardinality(v_required_relations)
    and v_functions_total = cardinality(v_required_functions)
    and v_rls_total = cardinality(v_required_rls)
    and v_policies_total = cardinality(v_required_policies)
    and v_triggers_total = cardinality(v_required_triggers);

  v_ready :=
    v_identity_ok
    and v_relations_ok
    and v_functions_ok
    and v_rls_ok
    and v_policies_ok
    and v_triggers_ok
    and v_private_schema_ok
    and v_private_tables_ok
    and v_public_data_permissions_ok
    and v_public_rpc_permissions_ok
    and v_private_function_permissions_ok
    and v_security_definer_ok
    and v_search_path_ok
    and v_no_unexpected_objects;

  if v_ready then
    v_activation_receipt := encode(sha256(convert_to(
      v_instance_id::text || ':' || 'ef03f90d229d089f8871c64b996994c79c65d0e1e3a0f8e2b0bb08dc2d6f6dec' || ':' || '20261122200813_dlkt_info_news_corpus',
      'UTF8'
    )), 'hex');
  end if;

  return jsonb_build_object(
    'version', 'dlkt-info-database-readiness-2',
    'instanceId', v_instance_id,
    'schemaRevision', '20261122200813_dlkt_info_news_corpus',
    'schemaFingerprint', 'ef03f90d229d089f8871c64b996994c79c65d0e1e3a0f8e2b0bb08dc2d6f6dec',
    'activationReceipt', v_activation_receipt,
    'ready', v_ready,
    'counts', jsonb_build_object(
      'relationsExpected', cardinality(v_required_relations),
      'relationsPresent', v_relations_present,
      'relationsTotal', v_relations_total,
      'functionsExpected', cardinality(v_required_functions),
      'functionsPresent', v_functions_present,
      'functionsTotal', v_functions_total,
      'rlsExpected', cardinality(v_required_rls),
      'rlsPresent', v_rls_present,
      'rlsTotal', v_rls_total,
      'policiesExpected', cardinality(v_required_policies),
      'policiesPresent', v_policies_present,
      'policiesTotal', v_policies_total,
      'triggersExpected', cardinality(v_required_triggers),
      'triggersPresent', v_triggers_present,
      'triggersTotal', v_triggers_total
    ),
    'checks', jsonb_build_object(
      'identity', v_identity_ok,
      'relations', v_relations_ok,
      'functions', v_functions_ok,
      'rls', v_rls_ok,
      'policies', v_policies_ok,
      'triggers', v_triggers_ok,
      'privateSchema', v_private_schema_ok,
      'privateTables', v_private_tables_ok,
      'publicDataPermissions', v_public_data_permissions_ok,
      'publicRpcPermissions', v_public_rpc_permissions_ok,
      'privateFunctionPermissions', v_private_function_permissions_ok,
      'securityDefiner', v_security_definer_ok,
      'searchPath', v_search_path_ok,
      'noUnexpectedObjects', v_no_unexpected_objects
    ),
    'automaticExecution', false,
    'publicCardsEnabled', false
  );
end;
$$;

revoke all on function public.dlkt_info_read_database_readiness() from public, anon, authenticated;
grant execute on function public.dlkt_info_read_database_readiness() to anon, authenticated, service_role;

comment on function public.dlkt_info_read_database_readiness() is
  'Readiness v2 / schema manifest v8: bounded non-secret attestation including exact existing table ACLs and narrowly authorized immutable public archive objects. Service-role administrative rights are preserved. No activation receipt is returned after detected schema or ACL drift.';

commit;
