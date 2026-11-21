-- DRAFT ONLY. Root must generate the migration, complete the reviewed publisher
-- validator below, and update exact readiness/ACL attestation before applying.
-- No credential provisioning and no changes to historical shared cards.
begin;

-- TODO(ROOT): replace this fail-closed body with the exact reviewed
-- NEWS_PUBLISHERS label/origin pairs and canonical URL restrictions.
create function dlkt_info_private.valid_news_candidate_publisher(p_publisher text, p_url text)
returns boolean language sql immutable set search_path = '' as $$ select false $$;

create function dlkt_info_private.valid_news_candidate(p_candidate jsonb, p_now timestamptz)
returns boolean language plpgsql immutable set search_path = '' as $$
declare field_name text; stamp timestamptz;
begin
  if p_candidate is null or jsonb_typeof(p_candidate) <> 'object' or p_now is null or not isfinite(p_now) then return false; end if;
  if (select count(*) from jsonb_object_keys(p_candidate)) <> 5
    or not p_candidate ?& array['sourceUrl','title','publisher','indexedAt','category'] then return false; end if;
  foreach field_name in array array['sourceUrl','title','publisher','indexedAt','category'] loop
    if jsonb_typeof(p_candidate->field_name) <> 'string' then return false; end if;
  end loop;
  if length(p_candidate->>'sourceUrl') not between 1 and 3000
    or length(p_candidate->>'title') not between 1 and 200
    or btrim(p_candidate->>'title') <> p_candidate->>'title'
    or p_candidate->>'title' ~ '[[:cntrl:]<>]'
    or length(p_candidate->>'publisher') not between 1 and 120
    or p_candidate->>'publisher' ~ '[[:cntrl:]<>]'
    or not dlkt_info_private.valid_news_candidate_publisher(p_candidate->>'publisher',p_candidate->>'sourceUrl')
    or not (p_candidate->>'category' = any(array['world','business','technology','money','health','sport','gaming','culture','shopping','travel','work','education','family','science','environment','public-affairs','digital-life','food','housing','weather']))
    or p_candidate->>'indexedAt' !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}[.][0-9]{3}Z$' then return false; end if;
  stamp := (p_candidate->>'indexedAt')::timestamptz;
  return isfinite(stamp) and stamp between p_now - interval '24 hours' and p_now + interval '5 minutes';
exception when others then return false;
end $$;

create table public.dlkt_info_news_candidates (
  source_url text not null check (length(source_url) between 1 and 3000),
  -- Hash avoids btree key-size failures for legitimate long article URLs.
  url_hash text primary key check (url_hash ~ '^[a-f0-9]{64}$' and url_hash = encode(sha256(convert_to(source_url,'UTF8')),'hex')),
  title text not null check (length(title) between 1 and 200),
  publisher text not null check (length(publisher) between 1 and 120),
  indexed_at timestamptz not null check (isfinite(indexed_at)),
  category text not null check (category = any(array['world','business','technology','money','health','sport','gaming','culture','shopping','travel','work','education','family','science','environment','public-affairs','digital-life','food','housing','weather']))
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
        where url_hash=digest and indexed_at <= (entry->>'indexedAt')::timestamptz;
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
comment on function public.dlkt_info_upsert_news_candidates(jsonb) is 'Purpose-bound server writer header required. Maximum500 input candidates, maximum5000 cached rows. Cache expiry after48hours; oldest cache rows may be evicted earlier only to admit newer candidates. Never changes share history.';
commit;
