-- Bootstrap template mirrors reviewed publisher validation and nullable category discovery.
-- Apply the versioned migration chain to an existing database; this template creates fresh objects.
-- No credential provisioning and no changes to historical shared cards.
begin;

CREATE OR REPLACE FUNCTION dlkt_info_private.valid_news_candidate_publisher(p_publisher text, p_url text)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
declare origins constant jsonb := '{"https://www.reuters.com":"Reuters","https://reuters.com":"Reuters","https://apnews.com":"Associated Press","https://www.apnews.com":"Associated Press","https://www.bbc.com":"BBC","https://bbc.com":"BBC","https://www.bbc.co.uk":"BBC","https://bbc.co.uk":"BBC","https://www.theguardian.com":"The Guardian","https://theguardian.com":"The Guardian","https://www.ft.com":"Financial Times","https://ft.com":"Financial Times","https://www.cnbc.com":"CNBC","https://cnbc.com":"CNBC","https://www.france24.com":"France 24","https://france24.com":"France 24","https://www.dw.com":"DW","https://dw.com":"DW","https://amp.dw.com":"DW","https://www.aljazeera.com":"Al Jazeera","https://aljazeera.com":"Al Jazeera","https://www.npr.org":"NPR","https://npr.org":"NPR","https://www.rte.ie":"RTE","https://rte.ie":"RTE","https://www.cnn.com":"CNN","https://cnn.com":"CNN","https://edition.cnn.com":"CNN","https://www.abc.net.au":"ABC Australia","https://abc.net.au":"ABC Australia","https://www.cbc.ca":"CBC","https://cbc.ca":"CBC","https://www.euronews.com":"Euronews","https://euronews.com":"Euronews","https://www.politico.com":"POLITICO","https://politico.com":"POLITICO","https://www.politico.eu":"POLITICO","https://politico.eu":"POLITICO","https://www.bloomberg.com":"Bloomberg","https://bloomberg.com":"Bloomberg","https://www.businessinsider.com":"Business Insider","https://businessinsider.com":"Business Insider","https://fortune.com":"Fortune","https://www.fortune.com":"Fortune","https://techcrunch.com":"TechCrunch","https://www.techcrunch.com":"TechCrunch","https://www.theverge.com":"The Verge","https://theverge.com":"The Verge","https://arstechnica.com":"Ars Technica","https://www.arstechnica.com":"Ars Technica","https://www.wired.com":"WIRED","https://wired.com":"WIRED","https://www.engadget.com":"Engadget","https://engadget.com":"Engadget","https://blogs.nvidia.com":"NVIDIA","https://nvidianews.nvidia.com":"NVIDIA","https://www.anthropic.com":"Anthropic","https://anthropic.com":"Anthropic","https://www.rockstargames.com":"Rockstar Games","https://rockstargames.com":"Rockstar Games","https://blog.playstation.com":"PlayStation","https://www.ign.com":"IGN","https://ign.com":"IGN","https://www.pcgamer.com":"PC Gamer","https://pcgamer.com":"PC Gamer","https://www.eurogamer.net":"Eurogamer","https://eurogamer.net":"Eurogamer","https://www.gamespot.com":"GameSpot","https://gamespot.com":"GameSpot","https://variety.com":"Variety","https://www.variety.com":"Variety","https://www.billboard.com":"Billboard","https://billboard.com":"Billboard","https://www.hollywoodreporter.com":"The Hollywood Reporter","https://hollywoodreporter.com":"The Hollywood Reporter","https://deadline.com":"Deadline","https://www.deadline.com":"Deadline","https://www.espn.com":"ESPN","https://espn.com":"ESPN","https://global.espn.com":"ESPN","https://africa.espn.com":"ESPN","https://www.skysports.com":"Sky Sports","https://skysports.com":"Sky Sports","https://www.olympics.com":"Olympics","https://olympics.com":"Olympics","https://www.parents.com":"Parents","https://parents.com":"Parents","https://www.edweek.org":"Education Week","https://edweek.org":"Education Week","https://www.nature.com":"Nature","https://nature.com":"Nature","https://www.science.org":"Science","https://science.org":"Science","https://www.livescience.com":"Live Science","https://livescience.com":"Live Science","https://www.scientificamerican.com":"Scientific American","https://scientificamerican.com":"Scientific American","https://www.space.com":"Space.com","https://space.com":"Space.com","https://www.nationalgeographic.com":"National Geographic","https://nationalgeographic.com":"National Geographic","https://www.newscientist.com":"New Scientist","https://newscientist.com":"New Scientist","https://www.travelandleisure.com":"Travel + Leisure","https://travelandleisure.com":"Travel + Leisure","https://skift.com":"Skift","https://www.skift.com":"Skift","https://www.lonelyplanet.com":"Lonely Planet","https://lonelyplanet.com":"Lonely Planet","https://www.cntraveler.com":"Conde Nast Traveler","https://cntraveler.com":"Conde Nast Traveler","https://www.goodhousekeeping.com":"Good Housekeeping","https://goodhousekeeping.com":"Good Housekeeping","https://www.consumerreports.org":"Consumer Reports","https://consumerreports.org":"Consumer Reports","https://www.which.co.uk":"Which?","https://which.co.uk":"Which?","https://www.foodandwine.com":"Food & Wine","https://foodandwine.com":"Food & Wine","https://www.foodsafetynews.com":"Food Safety News","https://foodsafetynews.com":"Food Safety News","https://www.architecturaldigest.com":"Architectural Digest","https://architecturaldigest.com":"Architectural Digest","https://www.dezeen.com":"Dezeen","https://dezeen.com":"Dezeen","https://weather.com":"The Weather Channel","https://www.weather.com":"The Weather Channel","https://www.accuweather.com":"AccuWeather","https://accuweather.com":"AccuWeather","https://www.carbonbrief.org":"Carbon Brief","https://carbonbrief.org":"Carbon Brief","https://globalvoices.org":"Global Voices","https://www.globalvoices.org":"Global Voices","https://360info.org":"360info","https://www.360info.org":"360info","https://www.scmp.com":"South China Morning Post","https://scmp.com":"South China Morning Post","https://www.thehindu.com":"The Hindu","https://thehindu.com":"The Hindu","https://www.japantimes.co.jp":"The Japan Times","https://japantimes.co.jp":"The Japan Times","https://www.channelnewsasia.com":"CNA","https://channelnewsasia.com":"CNA","https://www.straitstimes.com":"The Straits Times","https://straitstimes.com":"The Straits Times","https://www.nytimes.com":"The New York Times","https://nytimes.com":"The New York Times","https://www.digi24.ro":"Digi24","https://hotnews.ro":"HotNews.ro","https://www.repubblica.it":"la Repubblica","https://stirileprotv.ro":"Știrile ProTV"}'::jsonb; origin text; path text;
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

CREATE OR REPLACE FUNCTION dlkt_info_private.valid_news_candidate(p_candidate jsonb, p_now timestamp with time zone)
 RETURNS boolean
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path TO ''
AS $function$
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
end $function$;

create table public.dlkt_info_news_candidates (
  source_url text not null check (length(source_url) between 1 and 3000),
  -- Hash avoids btree key-size failures for legitimate long article URLs.
  url_hash text primary key check (url_hash ~ '^[a-f0-9]{64}$' and url_hash = encode(sha256(convert_to(source_url,'UTF8')),'hex')),
  title text not null check (length(title) between 1 and 200),
  publisher text not null check (length(publisher) between 1 and 120),
  indexed_at timestamptz not null check (isfinite(indexed_at)),
  category text check (category is null or category = any(array['world','business','technology','money','health','sport','gaming','culture','shopping','travel','work','education','family','science','environment','public-affairs','digital-life','food','housing','weather']))
);
create index dlkt_info_news_candidates_recent on public.dlkt_info_news_candidates(indexed_at desc,url_hash);
alter table public.dlkt_info_news_candidates enable row level security;
revoke all on public.dlkt_info_news_candidates from public,anon,authenticated,service_role;
grant select on public.dlkt_info_news_candidates to anon,authenticated,service_role;
create policy dlkt_info_news_candidates_public_read on public.dlkt_info_news_candidates
  for select to anon,authenticated,service_role using (true);

create function public.dlkt_info_upsert_news_candidates(p_candidates jsonb)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare supplied text; expected text; checked_at timestamptz := clock_timestamp();
  entry jsonb; existing public.dlkt_info_news_candidates%rowtype; digest text;
  capacity integer; accepted integer := 0; affected integer; evicted_hash text;
begin
  begin supplied := coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-dlkt-share-write','');
  exception when others then raise exception using errcode='42501',message='NEWS_CANDIDATE_WRITE_DENIED'; end;
  select key_hash into expected from dlkt_info_private.share_archive_writer where singleton;
  if supplied !~ '^[A-Za-z0-9_-]{43,128}$' or expected is null or encode(sha256(convert_to(supplied,'UTF8')),'hex') <> expected then
    raise exception using errcode='42501',message='NEWS_CANDIDATE_WRITE_DENIED';
  end if;
  if p_candidates is null or jsonb_typeof(p_candidates) <> 'array' then
    raise exception using errcode='22023',message='NEWS_CANDIDATE_INVALID';
  end if;
  if jsonb_array_length(p_candidates) > 500 or octet_length(p_candidates::text) > 2097152 then
    raise exception using errcode='22023',message='NEWS_CANDIDATE_INVALID';
  end if;
  for entry in select value from jsonb_array_elements(p_candidates) loop
    if not dlkt_info_private.valid_news_candidate(entry,checked_at) then
      raise exception using errcode='22023',message='NEWS_CANDIDATE_INVALID';
    end if;
  end loop;
  if (select count(distinct value->>'sourceUrl') from jsonb_array_elements(p_candidates)) <> jsonb_array_length(p_candidates) then
    raise exception using errcode='22023',message='NEWS_CANDIDATE_INVALID';
  end if;
  -- Serialize only this small public cache so the cap also holds under concurrency.
  lock table public.dlkt_info_news_candidates in share row exclusive mode;
  delete from public.dlkt_info_news_candidates where indexed_at < checked_at - interval '48 hours';
  select greatest(0,5000-count(*))::integer into capacity from public.dlkt_info_news_candidates;
  for entry in select value from jsonb_array_elements(p_candidates) order by value->>'indexedAt' desc,value->>'sourceUrl' loop
    digest := encode(sha256(convert_to(entry->>'sourceUrl','UTF8')),'hex');
    select * into existing from public.dlkt_info_news_candidates where url_hash=digest;
    if found then
      if existing.source_url <> entry->>'sourceUrl' then
        raise exception using errcode='22023',message='NEWS_CANDIDATE_INVALID';
      end if;
      update public.dlkt_info_news_candidates set title=entry->>'title',publisher=entry->>'publisher',
        indexed_at=(entry->>'indexedAt')::timestamptz,category=entry->>'category'
        where url_hash=digest and indexed_at <= (entry->>'indexedAt')::timestamptz
          and (
            (title,publisher,category) is distinct from (entry->>'title',entry->>'publisher',entry->>'category')
            or (
              indexed_at < (entry->>'indexedAt')::timestamptz
              and indexed_at <= checked_at - interval '10 minutes'
            )
          );
      get diagnostics affected = row_count; accepted := accepted + affected;
    else
      if capacity = 0 then
        -- Only this disposable cache is evicted. Prefer expired eligibility,
        -- then the oldest current record, and never replace newer with older.
        select url_hash into evicted_hash from public.dlkt_info_news_candidates
          where indexed_at < (entry->>'indexedAt')::timestamptz
          order by (indexed_at < checked_at - interval '24 hours') desc,indexed_at,url_hash limit 1;
        if found then
          delete from public.dlkt_info_news_candidates where url_hash=evicted_hash;
          get diagnostics affected = row_count; capacity := capacity+affected;
        end if;
      end if;
      if capacity > 0 then
        insert into public.dlkt_info_news_candidates(source_url,url_hash,title,publisher,indexed_at,category)
          values(entry->>'sourceUrl',digest,entry->>'title',entry->>'publisher',(entry->>'indexedAt')::timestamptz,entry->>'category');
        capacity := capacity-1; accepted := accepted+1;
      end if;
    end if;
  end loop;
  return jsonb_build_object('accepted',accepted);
end $$;

revoke all on function dlkt_info_private.valid_news_candidate_publisher(text,text) from public,anon,authenticated,service_role;
revoke all on function dlkt_info_private.valid_news_candidate(jsonb,timestamptz) from public,anon,authenticated,service_role;
revoke all on function public.dlkt_info_upsert_news_candidates(jsonb) from public,anon,authenticated,service_role;
grant execute on function public.dlkt_info_upsert_news_candidates(jsonb) to anon,authenticated,service_role;
comment on table public.dlkt_info_news_candidates is 'Bounded public discovery metadata. indexed_at is not publication time. Reverify original publisher date before creating an EvidenceCard. No account data.';
comment on function public.dlkt_info_upsert_news_candidates(jsonb) is 'Purpose-bound server writer header required. Maximum500 input candidates, maximum5000 cached rows. Identical metadata observations coalesce for up to10 minutes; changed metadata updates immediately. Cache expiry after48hours; oldest cache rows may be evicted earlier only to admit newer candidates. Never changes share history.';
commit;
