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
