-- Reduce high-frequency news discovery cache writes without delaying changed information.
-- A synthetic indexedAt timestamp changes on each discovery pass; it is NOT a publication date.
-- Preserve immediate changed title/publisher/category writes, source URL identity, monotonic
-- indexedAt, 48-hour expiry, the 5000-row bound and existing purpose-bound writer auth.
-- Coalesce identical records for up to 10 minutes (well inside the 24-hour read window).
-- Rollback: restore the RPC definition from migration 20261120195508_dlkt_info_global_editorial.
BEGIN;
create or replace function public.dlkt_info_upsert_news_candidates(p_candidates jsonb)
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
comment on function public.dlkt_info_upsert_news_candidates(jsonb) is 'Purpose-bound server writer header required. Maximum500 input candidates, maximum5000 cached rows. Identical metadata observations coalesce for up to10 minutes; changed metadata updates immediately. Cache expiry after48hours; oldest cache rows may be evicted earlier only to admit newer candidates. Never changes share history.';
COMMIT;
