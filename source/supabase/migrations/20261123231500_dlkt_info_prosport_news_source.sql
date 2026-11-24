-- Reviewed ProSport RSS discovery; exact www.prosport.ro original metadata only.
-- Existing private signatures and ACLs remain unchanged. No account, archive or writer changes.
-- Registry: 75 publisher families, 29 direct indexes plus GDELT; article request cap stays80.
-- Source receipt: Actions45286173292 / job138082948684,2026-11-23.
begin;
do $guard$
begin
  if to_regprocedure('dlkt_info_private.valid_news_candidate_publisher(text,text)') is null
    or to_regprocedure('dlkt_info_private.valid_news_diagnostics(jsonb,timestamp with time zone)') is null then
    raise exception 'NEWS_PROSPORT_SOURCE_PREREQUISITE_MISSING';
  end if;
end $guard$;

CREATE OR REPLACE FUNCTION dlkt_info_private.valid_news_candidate_publisher(p_publisher text, p_url text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare origins constant jsonb := '{"https://www.reuters.com":"Reuters","https://reuters.com":"Reuters","https://apnews.com":"Associated Press","https://www.apnews.com":"Associated Press","https://www.bbc.com":"BBC","https://bbc.com":"BBC","https://www.bbc.co.uk":"BBC","https://bbc.co.uk":"BBC","https://www.theguardian.com":"The Guardian","https://theguardian.com":"The Guardian","https://www.ft.com":"Financial Times","https://ft.com":"Financial Times","https://www.cnbc.com":"CNBC","https://cnbc.com":"CNBC","https://www.france24.com":"France 24","https://france24.com":"France 24","https://www.dw.com":"DW","https://dw.com":"DW","https://amp.dw.com":"DW","https://www.aljazeera.com":"Al Jazeera","https://aljazeera.com":"Al Jazeera","https://www.npr.org":"NPR","https://npr.org":"NPR","https://www.rte.ie":"RTE","https://rte.ie":"RTE","https://www.cnn.com":"CNN","https://cnn.com":"CNN","https://edition.cnn.com":"CNN","https://www.abc.net.au":"ABC Australia","https://abc.net.au":"ABC Australia","https://www.cbc.ca":"CBC","https://cbc.ca":"CBC","https://www.euronews.com":"Euronews","https://euronews.com":"Euronews","https://www.politico.com":"POLITICO","https://politico.com":"POLITICO","https://www.politico.eu":"POLITICO","https://politico.eu":"POLITICO","https://www.bloomberg.com":"Bloomberg","https://bloomberg.com":"Bloomberg","https://www.businessinsider.com":"Business Insider","https://businessinsider.com":"Business Insider","https://fortune.com":"Fortune","https://www.fortune.com":"Fortune","https://techcrunch.com":"TechCrunch","https://www.techcrunch.com":"TechCrunch","https://www.theverge.com":"The Verge","https://theverge.com":"The Verge","https://arstechnica.com":"Ars Technica","https://www.arstechnica.com":"Ars Technica","https://www.wired.com":"WIRED","https://wired.com":"WIRED","https://www.engadget.com":"Engadget","https://engadget.com":"Engadget","https://blogs.nvidia.com":"NVIDIA","https://nvidianews.nvidia.com":"NVIDIA","https://www.anthropic.com":"Anthropic","https://anthropic.com":"Anthropic","https://www.rockstargames.com":"Rockstar Games","https://rockstargames.com":"Rockstar Games","https://blog.playstation.com":"PlayStation","https://www.ign.com":"IGN","https://ign.com":"IGN","https://www.pcgamer.com":"PC Gamer","https://pcgamer.com":"PC Gamer","https://www.eurogamer.net":"Eurogamer","https://eurogamer.net":"Eurogamer","https://www.gamespot.com":"GameSpot","https://gamespot.com":"GameSpot","https://variety.com":"Variety","https://www.variety.com":"Variety","https://www.billboard.com":"Billboard","https://billboard.com":"Billboard","https://www.hollywoodreporter.com":"The Hollywood Reporter","https://hollywoodreporter.com":"The Hollywood Reporter","https://deadline.com":"Deadline","https://www.deadline.com":"Deadline","https://www.espn.com":"ESPN","https://espn.com":"ESPN","https://global.espn.com":"ESPN","https://africa.espn.com":"ESPN","https://www.skysports.com":"Sky Sports","https://skysports.com":"Sky Sports","https://www.olympics.com":"Olympics","https://olympics.com":"Olympics","https://www.parents.com":"Parents","https://parents.com":"Parents","https://www.edweek.org":"Education Week","https://edweek.org":"Education Week","https://www.nature.com":"Nature","https://nature.com":"Nature","https://www.science.org":"Science","https://science.org":"Science","https://www.livescience.com":"Live Science","https://livescience.com":"Live Science","https://www.scientificamerican.com":"Scientific American","https://scientificamerican.com":"Scientific American","https://www.space.com":"Space.com","https://space.com":"Space.com","https://www.nationalgeographic.com":"National Geographic","https://nationalgeographic.com":"National Geographic","https://www.newscientist.com":"New Scientist","https://newscientist.com":"New Scientist","https://www.travelandleisure.com":"Travel + Leisure","https://travelandleisure.com":"Travel + Leisure","https://skift.com":"Skift","https://www.skift.com":"Skift","https://www.lonelyplanet.com":"Lonely Planet","https://lonelyplanet.com":"Lonely Planet","https://www.cntraveler.com":"Conde Nast Traveler","https://cntraveler.com":"Conde Nast Traveler","https://www.goodhousekeeping.com":"Good Housekeeping","https://goodhousekeeping.com":"Good Housekeeping","https://www.consumerreports.org":"Consumer Reports","https://consumerreports.org":"Consumer Reports","https://www.which.co.uk":"Which?","https://which.co.uk":"Which?","https://www.foodandwine.com":"Food & Wine","https://foodandwine.com":"Food & Wine","https://www.foodsafetynews.com":"Food Safety News","https://foodsafetynews.com":"Food Safety News","https://www.architecturaldigest.com":"Architectural Digest","https://architecturaldigest.com":"Architectural Digest","https://www.dezeen.com":"Dezeen","https://dezeen.com":"Dezeen","https://weather.com":"The Weather Channel","https://www.weather.com":"The Weather Channel","https://www.accuweather.com":"AccuWeather","https://accuweather.com":"AccuWeather","https://www.carbonbrief.org":"Carbon Brief","https://carbonbrief.org":"Carbon Brief","https://globalvoices.org":"Global Voices","https://www.globalvoices.org":"Global Voices","https://360info.org":"360info","https://www.360info.org":"360info","https://www.scmp.com":"South China Morning Post","https://scmp.com":"South China Morning Post","https://www.thehindu.com":"The Hindu","https://thehindu.com":"The Hindu","https://www.japantimes.co.jp":"The Japan Times","https://japantimes.co.jp":"The Japan Times","https://www.channelnewsasia.com":"CNA","https://channelnewsasia.com":"CNA","https://www.straitstimes.com":"The Straits Times","https://straitstimes.com":"The Straits Times","https://www.nytimes.com":"The New York Times","https://nytimes.com":"The New York Times","https://www.digi24.ro":"Digi24","https://hotnews.ro":"HotNews.ro","https://www.repubblica.it":"la Repubblica","https://stirileprotv.ro":"Știrile ProTV","https://www.prosport.ro":"ProSport"}'::jsonb; origin text; path text;
begin
  if p_url is null or p_publisher is null or length(p_url) not between 1 and 3000
    or p_url ~ '[[:space:]#<>\\]' then return false; end if;
  origin := substring(p_url from '^(https://[^/?#]+)');
  path := substring(p_url from '^https://[^/?#]+(/[^?#]*)');
  if origin is null or origins->>origin is distinct from p_publisher or path is null or path='/'
    or (origin='https://stirileprotv.ro' and path not like '/stiri/%')
    or lower(path) ~ '/(login|signin|sign-in|account|subscribe|search|api)(/|$)'
    or lower(path) ~ '(^|/)([.]|%2e){1,2}(/|$)'
    or lower(p_url) ~ '[?&](utm_[^=&]*|fbclid|gclid|mc_cid|mc_eid)(=|&|$)'
    or p_url ~ '[?&][^=&]*%[^=&]*(=|&|$)' then return false; end if;
  return true;
end $function$;

CREATE OR REPLACE FUNCTION dlkt_info_private.valid_news_diagnostics(p_diagnostics jsonb, p_now timestamp with time zone DEFAULT statement_timestamp())
 RETURNS boolean
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  publisher_ids text[] := array['reuters','ap','bbc','guardian','ft','cnbc','france24','dw','aljazeera','npr','rte','cnn','abc-au','cbc','euronews','politico','bloomberg','business-insider','fortune','techcrunch','the-verge','ars-technica','wired','engadget','nvidia','anthropic','rockstar','playstation','ign','pcgamer','eurogamer','gamespot','variety','billboard','hollywood-reporter','deadline','espn','sky-sports','olympics','parents','edweek','nature','science','live-science','scientific-american','space','national-geographic','new-scientist','travel-leisure','skift','lonely-planet','conde-nast-traveler','good-housekeeping','consumer-reports','which','food-wine','food-safety-news','architectural-digest','dezeen','weather-channel','accuweather','carbon-brief','global-voices','360info','scmp','the-hindu','japan-times','cna','straits-times','nytimes','digi24','hotnews','repubblica','stirile-protv','prosport'];
  language_ids text[] := array['en','fr','ja','es','ar','de','it','pt-BR','pt-002','sq','am','bn','bs','bg','zh-Hans','zh-Hant','hr','fa-AF','el','ha','hi','id','sw','mk','ps','fa-IR','pl','ro','ru','sr','tr','uk','ur'];
  reason_ids text[] := array['index-identity','index-schema','index-stale','index-unavailable','access-denied','rate-limited','http-unavailable','timeout','deadline','request-capacity','origin-backoff','redirect','content-type','response-size','empty-response','metadata-unverified','identity-conflict','duplicate','request-unavailable','rights-review-expired','candidate-store'];
  counter_keys text[] := array['freshDiscovered','pool','scheduled','attempted','requestAttempts','verifiedNow','rejected','duplicates','deferredCapacity','deferredBeforeAttempt','retained'];
  index_identity jsonb := '{"gdelt-gal":{"publisherId":null,"language":null},"digi24-ro-news":{"publisherId":"digi24","language":"ro"},"hotnews-ro-news":{"publisherId":"hotnews","language":"ro"},"guardian-news":{"publisherId":"guardian","language":"en"},"ap-news":{"publisherId":"ap","language":null},"bbc-news":{"publisherId":"bbc","language":null},"verge-news":{"publisherId":"the-verge","language":"en"},"pcgamer-news":{"publisherId":"pcgamer","language":"en"},"live-science-news":{"publisherId":"live-science","language":"en"},"parents-news":{"publisherId":"parents","language":"en"},"travel-leisure-news":{"publisherId":"travel-leisure","language":null},"food-wine-news":{"publisherId":"food-wine","language":null},"good-housekeeping-news":{"publisherId":"good-housekeeping","language":null},"education-week-news":{"publisherId":"edweek","language":"en"},"weather-channel-news":{"publisherId":"weather-channel","language":null},"the-hindu-news":{"publisherId":"the-hindu","language":"en"},"dw-ro-news":{"publisherId":"dw","language":"ro"},"dw-de-news":{"publisherId":"dw","language":"de"},"dw-fr-news":{"publisherId":"dw","language":"fr"},"dw-es-news":{"publisherId":"dw","language":"es"},"dw-ar-news":{"publisherId":"dw","language":"ar"},"france24-en-news":{"publisherId":"france24","language":"en"},"france24-fr-news":{"publisherId":"france24","language":"fr"},"france24-es-news":{"publisherId":"france24","language":"es"},"france24-ar-news":{"publisherId":"france24","language":"ar"},"japan-times-news":{"publisherId":"japan-times","language":"en"},"guardian-africa-news":{"publisherId":"guardian","language":"en"},"repubblica-it-news":{"publisherId":"repubblica","language":"it"},"stirile-protv-ro-news":{"publisherId":"stirile-protv","language":"ro"},"prosport-ro-news":{"publisherId":"prosport","language":"ro"}}'::jsonb;
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
    or jsonb_typeof(p_diagnostics->'indexes') is distinct from 'array' or jsonb_array_length(p_diagnostics->'indexes')>30
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
        or (counts->>field)::numeric>150000 then return false; end if;
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
        or (detail->>'count')::numeric not between 1 and 150000 then return false; end if;
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
$function$;
commit;
