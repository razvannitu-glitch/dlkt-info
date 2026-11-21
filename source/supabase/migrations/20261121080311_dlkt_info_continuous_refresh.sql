-- Forward-only continuous public catalog store. No account data or article body.
begin;

-- Preserve existing candidates and all immutable shares; only the disposable candidate label becomes nullable.
alter table public.dlkt_info_news_candidates alter column category drop not null;

create or replace function dlkt_info_private.valid_news_candidate(p_candidate jsonb, p_now timestamptz)
returns boolean language plpgsql immutable set search_path = '' as $$
declare field_name text; stamp timestamptz;
begin
  if p_candidate is null or jsonb_typeof(p_candidate) <> 'object' or p_now is null or not isfinite(p_now) then return false; end if;
  if (select count(*) from jsonb_object_keys(p_candidate)) <> 5
    or not p_candidate ?& array['sourceUrl','title','publisher','indexedAt','category'] then return false; end if;
  foreach field_name in array array['sourceUrl','title','publisher','indexedAt'] loop
    if jsonb_typeof(p_candidate->field_name) <> 'string' then return false; end if;
  end loop;
  if jsonb_typeof(p_candidate->'category') not in ('null','string') then return false; end if;
  if length(p_candidate->>'sourceUrl') not between 1 and 3000
    or length(p_candidate->>'title') not between 1 and 200
    or btrim(p_candidate->>'title') <> p_candidate->>'title'
    or p_candidate->>'title' ~ '[[:cntrl:]<>]'
    or length(p_candidate->>'publisher') not between 1 and 120
    or p_candidate->>'publisher' ~ '[[:cntrl:]<>]'
    or not dlkt_info_private.valid_news_candidate_publisher(p_candidate->>'publisher',p_candidate->>'sourceUrl')
    or (p_candidate->'category'<>'null'::jsonb and not (p_candidate->>'category' = any(array['world','business','technology','money','health','sport','gaming','culture','shopping','travel','work','education','family','science','environment','public-affairs','digital-life','food','housing','weather'])))
    or p_candidate->>'indexedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' then return false; end if;
  stamp := (p_candidate->>'indexedAt')::timestamptz;
  return isfinite(stamp) and stamp between p_now - interval '24 hours' and p_now + interval '5 minutes';
exception when others then return false;
end $$;

create or replace function dlkt_info_private.valid_share_archive_card(p_card jsonb)
returns boolean language plpgsql immutable set search_path = '' as $$
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
    or exists(select 1 from jsonb_object_keys(p_card) as k where k <> all(array['id','identity','title','topic','kind','sourceUrl','publisher','sourceIds','date','dateLabel','observedAt','contentHash','boundary','deadline','version','attribution','sourceState','summary','byline','licenseUrl','context'])) then return false; end if;
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
end $$;


create table dlkt_info_private.public_refresh_state (
  singleton boolean primary key default true check(singleton),
  fence bigint not null default 0 check(fence between 0 and 9007199254740991),
  worker_id uuid, lease_token uuid, lease_expires_at timestamptz, claimed_at timestamptz,
  active_slot bigint, successful_slot bigint not null default -1,
  trigger jsonb, failure_count integer not null default 0 check(failure_count between 0 and 1000),
  retry_at timestamptz, last_attempt_at timestamptz,
  last_scheduled_attempt_at timestamptz, last_scheduled_success_at timestamptz,
  snapshot jsonb, digest text, revision bigint not null default 0 check(revision between 0 and 9007199254740991),
  generated_at timestamptz, refreshed_at timestamptz,
  check((lease_token is null)=(lease_expires_at is null)),
  check((snapshot is null)=(digest is null)),
  check(digest is null or digest ~ '^[a-f0-9]{64}$'),
  check(snapshot is null or octet_length(snapshot::text)<=1048576)
);
create table dlkt_info_private.public_refresh_runs (
  fence bigint primary key, worker_id uuid not null, slot bigint not null,
  trigger jsonb not null, started_at timestamptz not null, finished_at timestamptz,
  outcome text not null check(outcome in ('running','succeeded','failed','expired')),
  error text check(error in ('collector-unavailable','invalid-snapshot','publish-unavailable','timeout')),
  digest text check(digest ~ '^[a-f0-9]{64}$')
);
alter table dlkt_info_private.public_refresh_state enable row level security;
alter table dlkt_info_private.public_refresh_runs enable row level security;
revoke all on dlkt_info_private.public_refresh_state,dlkt_info_private.public_refresh_runs from public,anon,authenticated,service_role;
insert into dlkt_info_private.public_refresh_state(singleton) values(true);

create function dlkt_info_private.require_public_refresh_writer()
returns void language plpgsql security invoker set search_path='' as $$
declare supplied text; expected text;
begin
  begin supplied:=coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-dlkt-share-write','');
  exception when others then raise exception using errcode='42501',message='PUBLIC_REFRESH_WRITE_DENIED'; end;
  select key_hash into expected from dlkt_info_private.share_archive_writer where singleton;
  if supplied !~ '^[A-Za-z0-9_-]{43,128}$' or expected is null
    or encode(sha256(convert_to(supplied,'UTF8')),'hex')<>expected then
    raise exception using errcode='42501',message='PUBLIC_REFRESH_WRITE_DENIED';
  end if;
end $$;

create function dlkt_info_private.valid_public_refresh_snapshot(p_snapshot jsonb,p_now timestamptz)
returns boolean language plpgsql immutable set search_path='' as $$
declare registry constant jsonb := '{"eu-law":{"label":"EU legal documents","publisher":"EU Publications Office","topic":"regulation","termsUrl":"https://eur-lex.europa.eu/content/legal-notice/legal-notice.html"},"ecb-news":{"label":"ECB publications","publisher":"European Central Bank","topic":"business","termsUrl":"https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html"},"ecb-statistics":{"label":"ECB statistics","publisher":"European Central Bank","topic":"business","termsUrl":"https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html"},"ecb-procurement":{"label":"ECB procurement notices","publisher":"European Central Bank","topic":"opportunities","termsUrl":"https://www.ecb.europa.eu/services/using-our-site/disclaimer/html/index.en.html"},"nextjs":{"label":"Next.js releases","publisher":"Vercel / Next.js maintainers","topic":"technology","termsUrl":"https://github.com/vercel/next.js/blob/canary/license.md"},"nodejs":{"label":"Node.js releases","publisher":"Node.js maintainers","topic":"technology","termsUrl":"https://github.com/nodejs/node/blob/main/LICENSE"},"nasa-news":{"label":"NASA science and missions","publisher":"NASA","topic":"science","termsUrl":"https://www.nasa.gov/nasa-brand-center/"},"usgs-news":{"label":"USGS Earth science","publisher":"U.S. Geological Survey","topic":"environment","termsUrl":"https://www.usgs.gov/information-policies-and-instructions/copyrights-and-credits"},"fda-news":{"label":"US FDA announcements","publisher":"U.S. Food and Drug Administration","topic":"health","termsUrl":"https://www.fda.gov/about-fda/about-website/website-policies"},"govuk-news":{"label":"UK public announcements","publisher":"UK Government","topic":"public-affairs","termsUrl":"https://www.gov.uk/help/terms-conditions"},"gv-world":{"label":"Global Voices world perspectives","publisher":"Global Voices","topic":"world","termsUrl":"https://globalvoices.org/about/global-voices-attribution-policy/"},"gv-culture":{"label":"Global Voices arts and culture","publisher":"Global Voices","topic":"culture","termsUrl":"https://globalvoices.org/about/global-voices-attribution-policy/"},"eff-digital":{"label":"EFF digital life and rights","publisher":"Electronic Frontier Foundation","topic":"digital-life","termsUrl":"https://www.eff.org/copyright"},"govuk-products":{"label":"UK product safety alerts and recalls","publisher":"UK Government","topic":"public-affairs","termsUrl":"https://www.gov.uk/help/terms-conditions"},"ncsc-news":{"label":"NCSC cyber security news","publisher":"UK National Cyber Security Centre","topic":"digital-life","termsUrl":"https://www.ncsc.gov.uk/section/about-this-website/terms-and-conditions"},"sanews":{"label":"SAnews South African news","publisher":"SAnews","topic":"world","termsUrl":"https://www.sanews.gov.za/content/user-policy"},"ec-press":{"label":"European Commission press releases","publisher":"European Commission","topic":"public-affairs","termsUrl":"https://commission.europa.eu/legal-notice_en"},"eu-council":{"label":"Council of the EU press releases","publisher":"Council of the European Union","topic":"regulation","termsUrl":"https://www.consilium.europa.eu/en/about-site/copyright/"},"cbs-news":{"label":"Statistics Netherlands news","publisher":"Statistics Netherlands (CBS)","topic":"business","termsUrl":"https://www.cbs.nl/en-gb/about-us/website/copyright"},"scidev-news":{"label":"SciDev.Net science and development","publisher":"SciDev.Net","topic":"science","termsUrl":"https://www.scidev.net/global/content/policies.html"},"360-news":{"label":"360info research perspectives","publisher":"360info","topic":"world","termsUrl":"https://360info.org/how-to-use-our-content/"},"noaa-news":{"label":"NOAA weather and ocean news","publisher":"NOAA","topic":"weather","termsUrl":"https://www.noaa.gov/office-education/outreach-communication/faq"},"nist-news":{"label":"NIST technology and research","publisher":"NIST","topic":"technology","termsUrl":"https://www.nist.gov/copyrights-disclaimers"},"nsf-news":{"label":"NSF science news","publisher":"U.S. National Science Foundation","topic":"science","termsUrl":"https://www.nsf.gov/policies/digital"},"fed-news":{"label":"Federal Reserve Board releases","publisher":"Federal Reserve Board","topic":"business","termsUrl":"https://www.federalreserve.gov/disclaimer.htm"},"ftc-consumer":{"label":"FTC consumer alerts","publisher":"U.S. Federal Trade Commission","topic":"money","termsUrl":"https://www.ftc.gov/policy-notices/website-policy"},"fda-food":{"label":"US FDA food safety recalls","publisher":"U.S. Food and Drug Administration","topic":"food","termsUrl":"https://www.fda.gov/about-fda/about-website/website-policies"},"govuk-travel":{"label":"UK foreign travel advice updates","publisher":"UK Government","topic":"travel","termsUrl":"https://www.gov.uk/help/terms-conditions"},"beehive-news":{"label":"New Zealand Government announcements","publisher":"New Zealand Government","topic":"world","termsUrl":"https://www.beehive.govt.nz/copyright"},"news-world":{"label":"World & geopolitics","publisher":"Reviewed news discovery","topic":"world","termsUrl":"https://www.gdeltproject.org/about.html"},"news-business":{"label":"Business & economy","publisher":"Reviewed news discovery","topic":"business","termsUrl":"https://www.gdeltproject.org/about.html"},"news-technology":{"label":"AI & technology","publisher":"Reviewed news discovery","topic":"technology","termsUrl":"https://www.gdeltproject.org/about.html"},"news-money":{"label":"Money & cost of living","publisher":"Reviewed news discovery","topic":"money","termsUrl":"https://www.gdeltproject.org/about.html"},"news-health":{"label":"Health & wellbeing","publisher":"Reviewed news discovery","topic":"health","termsUrl":"https://www.gdeltproject.org/about.html"},"news-sport":{"label":"Sports & competitions","publisher":"Reviewed news discovery","topic":"sport","termsUrl":"https://www.gdeltproject.org/about.html"},"news-gaming":{"label":"Gaming & esports","publisher":"Reviewed news discovery","topic":"culture","termsUrl":"https://www.gdeltproject.org/about.html"},"news-culture":{"label":"Culture & entertainment","publisher":"Reviewed news discovery","topic":"culture","termsUrl":"https://www.gdeltproject.org/about.html"},"news-shopping":{"label":"Shopping & consumer products","publisher":"Reviewed news discovery","topic":"money","termsUrl":"https://www.gdeltproject.org/about.html"},"news-travel":{"label":"Travel & flights","publisher":"Reviewed news discovery","topic":"travel","termsUrl":"https://www.gdeltproject.org/about.html"},"news-work":{"label":"Work & careers","publisher":"Reviewed news discovery","topic":"work-education","termsUrl":"https://www.gdeltproject.org/about.html"},"news-education":{"label":"Education & learning","publisher":"Reviewed news discovery","topic":"work-education","termsUrl":"https://www.gdeltproject.org/about.html"},"news-family":{"label":"Family & parenting","publisher":"Reviewed news discovery","topic":"public-affairs","termsUrl":"https://www.gdeltproject.org/about.html"},"news-science":{"label":"Science & space","publisher":"Reviewed news discovery","topic":"science","termsUrl":"https://www.gdeltproject.org/about.html"},"news-environment":{"label":"Climate & energy","publisher":"Reviewed news discovery","topic":"environment","termsUrl":"https://www.gdeltproject.org/about.html"},"news-public-affairs":{"label":"Politics & rights","publisher":"Reviewed news discovery","topic":"public-affairs","termsUrl":"https://www.gdeltproject.org/about.html"},"news-digital-life":{"label":"Digital life & security","publisher":"Reviewed news discovery","topic":"digital-life","termsUrl":"https://www.gdeltproject.org/about.html"},"news-food":{"label":"Food & everyday living","publisher":"Reviewed news discovery","topic":"food","termsUrl":"https://www.gdeltproject.org/about.html"},"news-housing":{"label":"Housing & cities","publisher":"Reviewed news discovery","topic":"housing","termsUrl":"https://www.gdeltproject.org/about.html"},"news-weather":{"label":"Weather & major disruptions","publisher":"Reviewed news discovery","topic":"weather","termsUrl":"https://www.gdeltproject.org/about.html"},"news-unclassified":{"label":"Other source-checked topics","publisher":"Reviewed news discovery","topic":"other","termsUrl":"https://www.gdeltproject.org/about.html"},"editorial-frontpage":{"label":"Publisher homepage selection","publisher":"Publisher homepage selection","topic":"world","termsUrl":"https://apnews.com/termsofservice"}}'::jsonb;
  item jsonb; record_card jsonb; source_id text; field text; rule jsonb; stamp timestamptz;
  topics constant text[]:=array['technology','business','regulation','opportunities','science','environment','health','public-affairs','world','digital-life','culture','money','space','weather','energy','work-education','housing','travel','food','sport','other'];
begin
  if p_snapshot is null or p_now is null or not isfinite(p_now) or jsonb_typeof(p_snapshot)<>'object'
    or octet_length(p_snapshot::text)>1048576
    or not p_snapshot ?& array['version','product','productVersion','mode','generatedAt','state','sources','cards','conflictCount','duplicateCount','deltaAvailable','scheduledDelivery','accountPersistence','coverage']
    or exists(select 1 from jsonb_object_keys(p_snapshot) k where k<>all(array['version','product','productVersion','mode','generatedAt','state','sources','cards','conflictCount','duplicateCount','deltaAvailable','scheduledDelivery','accountPersistence','coverage'])) then return false; end if;
  foreach field in array array['version','product','productVersion','mode','generatedAt','state'] loop
    if jsonb_typeof(p_snapshot->field)<>'string' then return false; end if;
  end loop;
  if p_snapshot->>'version'<>'iceo-primary-mesh-1' or p_snapshot->>'product'<>'dlkt-info'
    or jsonb_typeof(p_snapshot->'productVersion')<>'string' or length(p_snapshot->>'productVersion') not between 1 and 40
    or p_snapshot->>'mode' not in ('current-official-records','current-source-records')
    or p_snapshot->>'state' not in ('ready','partial')
    or p_snapshot->'deltaAvailable'<>'false'::jsonb or p_snapshot->'scheduledDelivery'<>'false'::jsonb or p_snapshot->'accountPersistence'<>'false'::jsonb
    or p_snapshot->>'generatedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$'
    or jsonb_typeof(p_snapshot->'sources')<>'array' or jsonb_array_length(p_snapshot->'sources') not between 1 and 100
    or jsonb_typeof(p_snapshot->'cards')<>'array' or jsonb_array_length(p_snapshot->'cards')>5000
    or jsonb_typeof(p_snapshot->'coverage')<>'array' or jsonb_array_length(p_snapshot->'coverage')>cardinality(topics) then return false; end if;
  stamp:=(p_snapshot->>'generatedAt')::timestamptz;
  if not isfinite(stamp) or stamp<p_now-interval '5 minutes' or stamp>p_now+interval '5 seconds' then return false; end if;
  foreach field in array array['conflictCount','duplicateCount'] loop
    if jsonb_typeof(p_snapshot->field)<>'number' or p_snapshot->>field !~ '^[0-9]+$' or (p_snapshot->>field)::numeric>9007199254740991 then return false; end if;
  end loop;
  if (p_snapshot->>'conflictCount')::numeric>0 and p_snapshot->>'state'='ready' then return false; end if;
  if (select count(distinct value->>'id') from jsonb_array_elements(p_snapshot->'cards'))<>jsonb_array_length(p_snapshot->'cards')
    or (select count(distinct value->>'identity') from jsonb_array_elements(p_snapshot->'cards'))<>jsonb_array_length(p_snapshot->'cards')
    or (select count(distinct value->>'id') from jsonb_array_elements(p_snapshot->'sources'))<>jsonb_array_length(p_snapshot->'sources')
    or (select count(distinct value) from jsonb_array_elements(p_snapshot->'coverage'))<>jsonb_array_length(p_snapshot->'coverage') then return false; end if;
  for item in select value from jsonb_array_elements(p_snapshot->'sources') loop
    if jsonb_typeof(item)<>'object' or not item ?& array['id','label','publisher','topic','state','checkedAt','verifiedAt','count','rejected','error','retryAt','scope','termsUrl','windowed']
      or exists(select 1 from jsonb_object_keys(item) k where k<>all(array['id','label','publisher','topic','state','checkedAt','verifiedAt','count','rejected','error','retryAt','scope','termsUrl','windowed'])) then return false; end if;
    rule:=registry->(item->>'id');
    if rule is null or item->>'label' is distinct from rule->>'label' or item->>'publisher' is distinct from rule->>'publisher'
      or item->>'topic' is distinct from rule->>'topic' or item->>'termsUrl' is distinct from rule->>'termsUrl'
      or jsonb_typeof(item->'state')<>'string' or item->>'state' not in ('verified','partial','stale','unavailable') or item->'windowed'<>'true'::jsonb
      or jsonb_typeof(item->'scope')<>'string' or length(item->>'scope') not between 1 and 8000
      or item->>'scope' ~ '[[:cntrl:]]' then return false; end if;
    foreach field in array array['count','rejected'] loop
      if jsonb_typeof(item->field)<>'number' or item->>field !~ '^[0-9]+$' or (item->>field)::numeric>9007199254740991 then return false; end if;
    end loop;
    if (item->>'count')::numeric<>(select count(*) from jsonb_array_elements(p_snapshot->'cards') c where c->'sourceIds' ? (item->>'id')) then return false; end if;
    foreach field in array array['checkedAt','verifiedAt','retryAt'] loop
      if item->field='null'::jsonb then
        if field='checkedAt' then return false; end if;
      else
        if jsonb_typeof(item->field)<>'string' or item->>field !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then return false; end if;
        stamp:=(item->>field)::timestamptz;
        if not isfinite(stamp) or (field<>'retryAt' and stamp>p_now+interval '5 minutes') then return false; end if;
      end if;
    end loop;
    if item->'error'<>'null'::jsonb and (jsonb_typeof(item->'error')<>'string' or item->>'error' !~ '^[A-Z][A-Z0-9_]{0,199}$') then return false; end if;
    if p_snapshot->>'state'='ready' and item->>'state'<>'verified' then return false; end if;
  end loop;
  for record_card in select value from jsonb_array_elements(p_snapshot->'cards') loop
    if jsonb_typeof(record_card->'sourceState')<>'string' or record_card->>'sourceState' not in ('verified','partial','stale')
      or not dlkt_info_private.valid_share_archive_card(record_card||jsonb_build_object('sourceState','verified')) then return false; end if;
    stamp:=(record_card->>'observedAt')::timestamptz;
    if stamp>p_now+interval '5 minutes' then return false; end if;
    foreach source_id in array array(select jsonb_array_elements_text(record_card->'sourceIds')) loop
      if not exists(select 1 from jsonb_array_elements(p_snapshot->'sources') s where s->>'id'=source_id and s->>'state'<>'unavailable') then return false; end if;
    end loop;
    if not (p_snapshot->'coverage' ? (record_card->>'topic')) then return false; end if;
  end loop;
  for item in select value from jsonb_array_elements(p_snapshot->'coverage') loop
    if jsonb_typeof(item)<>'string' or not (item#>>'{}'=any(topics))
      or not exists(select 1 from jsonb_array_elements(p_snapshot->'cards') c where c->>'topic'=item#>>'{}') then return false; end if;
  end loop;
  return true;
exception when others then return false;
end $$;

create function public.dlkt_info_read_public_snapshot()
returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('version','iceo-shared-snapshot-1','snapshot',s.snapshot,'digest',s.digest,'revision',s.revision,
    'refreshedAt',to_char(s.refreshed_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'lastAttemptAt',to_char(s.last_attempt_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'lastScheduledAttemptAt',to_char(s.last_scheduled_attempt_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'lastScheduledSuccessAt',to_char(s.last_scheduled_success_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'status',case when s.lease_expires_at>statement_timestamp() then 'refreshing' when s.retry_at>statement_timestamp() then 'backoff' when s.snapshot is null then 'empty' else 'ready' end,
    'retryAt',to_char(case when s.retry_at>statement_timestamp() then s.retry_at end at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
  from dlkt_info_private.public_refresh_state s where singleton;
$$;

create function public.dlkt_info_claim_public_refresh(p_worker_id uuid,p_trigger jsonb)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s dlkt_info_private.public_refresh_state%rowtype; n timestamptz:=clock_timestamp();
  slot bigint:=floor(extract(epoch from n)/120)::bigint; token uuid; state text; stamp timestamptz; field text;
begin
  perform dlkt_info_private.require_public_refresh_writer();
  if p_worker_id is null or p_trigger is null or jsonb_typeof(p_trigger)<>'object' then raise exception using errcode='22023',message='PUBLIC_REFRESH_TRIGGER_INVALID'; end if;
  if p_trigger->>'kind'='manual' then
    if (select count(*) from jsonb_object_keys(p_trigger))<>1 then raise exception using errcode='22023',message='PUBLIC_REFRESH_TRIGGER_INVALID'; end if;
  elsif p_trigger->>'kind'='scheduled' then
    foreach field in array array['kind','executionId','scheduleName','scheduledAt','namespace','expression'] loop
      if jsonb_typeof(p_trigger->field) is distinct from 'string' then raise exception using errcode='22023',message='PUBLIC_REFRESH_TRIGGER_INVALID'; end if;
    end loop;
    if (select count(*) from jsonb_object_keys(p_trigger))<>6 or not p_trigger ?& array['kind','executionId','scheduleName','scheduledAt','namespace','expression']
      or jsonb_typeof(p_trigger->'executionId')<>'string' or p_trigger->>'executionId' !~ '^[A-Za-z0-9_.:/-]{1,160}$'
      or p_trigger->>'scheduleName'<>'iceo-daily-top' or p_trigger->>'namespace'<>'default' or p_trigger->>'expression'<>'*/2 * * * *'
      or p_trigger->>'scheduledAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T' then raise exception using errcode='22023',message='PUBLIC_REFRESH_TRIGGER_INVALID'; end if;
    begin stamp:=(p_trigger->>'scheduledAt')::timestamptz;
    exception when others then raise exception using errcode='22023',message='PUBLIC_REFRESH_TRIGGER_INVALID'; end;
    if not isfinite(stamp) or stamp<n-interval '10 minutes' or stamp>n+interval '60 seconds' then raise exception using errcode='22023',message='PUBLIC_REFRESH_TRIGGER_INVALID'; end if;
  else raise exception using errcode='22023',message='PUBLIC_REFRESH_TRIGGER_INVALID'; end if;
  select * into s from dlkt_info_private.public_refresh_state where singleton for update;
  -- Scheduled duplicate delivery is suppressed across slots while the successful
  -- receipt remains in the bounded history. Failed attempts may retry.
  if p_trigger->>'kind'='scheduled' and exists(select 1 from dlkt_info_private.public_refresh_runs r
    where r.outcome='succeeded' and r.trigger->>'kind'='scheduled' and r.trigger->>'executionId'=p_trigger->>'executionId') then state:='complete';
  elsif s.lease_expires_at>n then state:='busy';
  elsif s.successful_slot>=slot then state:='complete';
  elsif s.retry_at>n then state:='backoff';
  else
    if s.lease_token is not null then update dlkt_info_private.public_refresh_runs set outcome='expired',finished_at=n,error='timeout' where fence=s.fence and outcome='running'; end if;
    token:=gen_random_uuid();
    update dlkt_info_private.public_refresh_state set fence=fence+1,worker_id=p_worker_id,lease_token=token,lease_expires_at=n+interval '90 seconds',claimed_at=n,active_slot=slot,trigger=p_trigger,retry_at=null,last_attempt_at=n,
      last_scheduled_attempt_at=case when p_trigger->>'kind'='scheduled' then n else last_scheduled_attempt_at end where singleton returning * into s;
    insert into dlkt_info_private.public_refresh_runs(fence,worker_id,slot,trigger,started_at,outcome) values(s.fence,p_worker_id,slot,p_trigger,n,'running');
    delete from dlkt_info_private.public_refresh_runs where fence not in (select fence from dlkt_info_private.public_refresh_runs order by fence desc limit 720) or started_at<n-interval '7 days';
    state:='claimed';
  end if;
  return jsonb_build_object('version','iceo-refresh-claim-1','state',state,'slot',slot,'fence',s.fence,
    'leaseToken',case when state='claimed' then token end,
    'leaseExpiresAt',case when state='claimed' then to_char(s.lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end,
    'retryAt',case when state='backoff' then to_char(s.retry_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') when state='busy' then to_char(s.lease_expires_at at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') end);
end $$;

create function public.dlkt_info_publish_public_snapshot(p_lease_token uuid,p_fence bigint,p_snapshot jsonb,p_digest text)
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
  update dlkt_info_private.public_refresh_state set snapshot=p_snapshot,digest=p_digest,revision=revision+1,generated_at=g,refreshed_at=n,successful_slot=active_slot,
    last_scheduled_success_at=case when trigger->>'kind'='scheduled' then n else last_scheduled_success_at end,
    failure_count=0,retry_at=null,lease_token=null,lease_expires_at=null,worker_id=null,trigger=null where singleton;
  update dlkt_info_private.public_refresh_runs set outcome='succeeded',finished_at=n,digest=p_digest where fence=p_fence;
  return public.dlkt_info_read_public_snapshot();
end $$;

create function public.dlkt_info_fail_public_refresh(p_lease_token uuid,p_fence bigint,p_error text)
returns jsonb language plpgsql security definer set search_path='' as $$
declare s dlkt_info_private.public_refresh_state%rowtype; n timestamptz:=clock_timestamp(); next_retry timestamptz;
begin
  perform dlkt_info_private.require_public_refresh_writer();
  if p_error is null or p_error not in ('collector-unavailable','invalid-snapshot','publish-unavailable','timeout') then raise exception using errcode='22023',message='PUBLIC_REFRESH_ERROR_INVALID'; end if;
  select * into s from dlkt_info_private.public_refresh_state where singleton for update;
  if p_lease_token is null or p_fence is null or s.lease_token is distinct from p_lease_token or s.fence<>p_fence or s.lease_expires_at is null or s.lease_expires_at<=n then return jsonb_build_object('recorded',false,'retryAt',null); end if;
  next_retry:=n+make_interval(secs=>case when s.failure_count=0 then 30 when s.failure_count=1 then 60 when s.failure_count=2 then 120 else 300 end);
  update dlkt_info_private.public_refresh_state set failure_count=least(failure_count+1,1000),retry_at=next_retry,lease_token=null,lease_expires_at=null,worker_id=null,trigger=null where singleton;
  update dlkt_info_private.public_refresh_runs set outcome='failed',finished_at=n,error=p_error where fence=p_fence;
  return jsonb_build_object('recorded',true,'retryAt',to_char(next_retry at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'));
end $$;

revoke all on function dlkt_info_private.require_public_refresh_writer() from public,anon,authenticated,service_role;
revoke all on function dlkt_info_private.valid_public_refresh_snapshot(jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.dlkt_info_read_public_snapshot() from public,anon,authenticated,service_role;
revoke all on function public.dlkt_info_claim_public_refresh(uuid,jsonb) from public,anon,authenticated,service_role;
revoke all on function public.dlkt_info_publish_public_snapshot(uuid,bigint,jsonb,text) from public,anon,authenticated,service_role;
revoke all on function public.dlkt_info_fail_public_refresh(uuid,bigint,text) from public,anon,authenticated,service_role;
grant execute on function public.dlkt_info_read_public_snapshot(),public.dlkt_info_claim_public_refresh(uuid,jsonb),public.dlkt_info_publish_public_snapshot(uuid,bigint,jsonb,text),public.dlkt_info_fail_public_refresh(uuid,bigint,text) to anon,authenticated,service_role;
comment on function public.dlkt_info_read_public_snapshot() is 'Public catalog and authoritative database timestamps only. No worker, fencing token, writer key or run payload is exposed.';
comment on table dlkt_info_private.public_refresh_runs is 'Server-only bounded history: at most720 recent attempts, maximum7days, pruned on claim. No snapshot bodies and no lease tokens.';

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
    'dlkt_info_private.public_refresh_runs'
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
    'dlkt_info_private.public_refresh_runs'
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
    'public.dlkt_info_fail_public_refresh(uuid, bigint, text)'
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
    'public.dlkt_info_fail_public_refresh(uuid, bigint, text)'
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
    'dlkt_info_private.valid_public_refresh_snapshot(jsonb, timestamp with time zone)'
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
    'dlkt_info_private.public_refresh_runs'
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
    'public.dlkt_info_fail_public_refresh(uuid, bigint, text)'
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
    'public.dlkt_info_fail_public_refresh(uuid, bigint, text)'
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
    'public.dlkt_info_fail_public_refresh(uuid, bigint, text)'
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
    'public.dlkt_info_fail_public_refresh(uuid, bigint, text)'
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
    'dlkt_info_private.valid_public_refresh_snapshot(jsonb, timestamp with time zone)'
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
      v_instance_id::text || ':' || '481dee0bc8f4c8807fff49856c8aebf399ae637ffbde42a9e3d61ea9340bf240' || ':' || '20261121080311_dlkt_info_continuous_refresh',
      'UTF8'
    )), 'hex');
  end if;

  return jsonb_build_object(
    'version', 'dlkt-info-database-readiness-2',
    'instanceId', v_instance_id,
    'schemaRevision', '20261121080311_dlkt_info_continuous_refresh',
    'schemaFingerprint', '481dee0bc8f4c8807fff49856c8aebf399ae637ffbde42a9e3d61ea9340bf240',
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
  'Readiness v2 / schema manifest v6: bounded non-secret attestation including exact existing table ACLs and narrowly authorized immutable public archive objects. Service-role administrative rights are preserved. No activation receipt is returned after detected schema or ACL drift.';

commit;
