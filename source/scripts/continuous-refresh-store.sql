-- Forward-only continuous public catalog store. No account data or article body.
begin;

__UNCLASSIFIED_NEWS_COMPATIBILITY__

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
declare registry constant jsonb := __REFRESH_SOURCE_REGISTRY__;
  item jsonb; record_card jsonb; source_id text; field text; rule jsonb; stamp timestamptz;
  topics constant text[]:=array[__REFRESH_TOPICS__];
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
commit;
