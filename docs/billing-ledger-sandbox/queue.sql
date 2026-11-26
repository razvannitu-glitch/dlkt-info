-- Disposable PostgreSQL candidate only. DO NOT APPLY TO PRODUCTION.
begin;
-- Separate machine roles. The definer is not a superuser, cannot log in or bypass RLS,
-- and owns only the three queue functions, not the underlying tables.
create role dlkt_billing_queue_owner nologin noinherit nobypassrls;
create role dlkt_billing_worker nologin noinherit nobypassrls;
grant usage on schema dlkt_info_billing to dlkt_billing_queue_owner, dlkt_billing_worker;
grant select on dlkt_info_billing.event_notices to dlkt_billing_queue_owner;
grant insert (account_id,event_id,event_type,object_id,event_created)
on dlkt_info_billing.event_notices to dlkt_billing_queue_owner;
create policy queue_read_notice on dlkt_info_billing.event_notices
for select to dlkt_billing_queue_owner using (true);
create policy queue_insert_notice on dlkt_info_billing.event_notices
for insert to dlkt_billing_queue_owner with check (true);

create table dlkt_info_billing.event_jobs (
  account_id text not null,
  event_id text not null,
  state text not null default 'pending' check (state in ('pending','leased','routed','dead')),
  attempt integer not null default 0 check (attempt between 0 and 5),
  available_at timestamptz not null default clock_timestamp(),
  lease_until timestamptz,
  finished_at timestamptz,
  outcome text check (outcome in ('retry','routed','permanent_failure','attempts_exhausted')),
  primary key (account_id,event_id),
  foreign key (account_id,event_id) references dlkt_info_billing.event_notices(account_id,event_id),
  check (
    (state = 'pending' and attempt < 5 and lease_until is null and finished_at is null and (outcome is null or outcome = 'retry'))
    or (state = 'leased' and attempt >= 1 and lease_until is not null and finished_at is null and outcome is null)
    or (state = 'routed' and attempt >= 1 and lease_until is null and finished_at is not null and outcome is not null and outcome = 'routed')
    or (state = 'dead' and attempt >= 1 and lease_until is null and finished_at is not null and outcome is not null and outcome in ('permanent_failure','attempts_exhausted'))
  )
);
create index event_jobs_ready_idx on dlkt_info_billing.event_jobs(account_id, available_at, event_id) where state = 'pending';
create index event_jobs_expired_idx on dlkt_info_billing.event_jobs(account_id, lease_until, event_id) where state = 'leased';
alter table dlkt_info_billing.event_jobs enable row level security;
revoke all on dlkt_info_billing.event_jobs from public, anon, authenticated, service_role, dlkt_billing_worker;
grant select, insert, update on dlkt_info_billing.event_jobs to dlkt_billing_queue_owner;
create policy queue_read_job on dlkt_info_billing.event_jobs
for select to dlkt_billing_queue_owner using (true);
create policy queue_insert_job on dlkt_info_billing.event_jobs
for insert to dlkt_billing_queue_owner with check (true);
create policy queue_update_job on dlkt_info_billing.event_jobs
for update to dlkt_billing_queue_owner using (true) with check (true);

-- Backfill the lab's preexisting immutable notices, not production data.
insert into dlkt_info_billing.event_jobs(account_id,event_id)
select account_id,event_id from dlkt_info_billing.event_notices;
-- After this point every notice must enter through the atomic intake function.
revoke insert (account_id,event_id,event_type,object_id,event_created)
on dlkt_info_billing.event_notices from service_role;

create function dlkt_info_billing.ingest_notice(
  p_account text, p_event text, p_type text, p_object text, p_created bigint
) returns text
language plpgsql security definer set search_path = pg_catalog as $$
declare v_inserted boolean; v_existing dlkt_info_billing.event_notices%rowtype;
begin
  -- Called ONLY after exact raw-body signature verification by the server.
  insert into dlkt_info_billing.event_notices(account_id,event_id,event_type,object_id,event_created)
  values (p_account,p_event,p_type,p_object,p_created)
  on conflict (account_id,event_id) do nothing returning true into v_inserted;
  if v_inserted is true then
    insert into dlkt_info_billing.event_jobs(account_id,event_id) values (p_account,p_event);
    return 'accepted';
  end if;
  select n.* into v_existing from dlkt_info_billing.event_notices n
  where n.account_id = p_account and n.event_id = p_event;
  if not found or v_existing.event_type is distinct from p_type
    or v_existing.object_id is distinct from p_object
    or v_existing.event_created is distinct from p_created then
    raise exception using errcode = '23514', message = 'BILLING_NOTICE_CONFLICT';
  end if;
  if not exists (select 1 from dlkt_info_billing.event_jobs j where j.account_id = p_account and j.event_id = p_event) then
    raise exception using errcode = '23514', message = 'BILLING_NOTICE_JOB_MISSING';
  end if;
  -- Duplicate receipt is not equivalent to completed processing.
  return 'duplicate';
end;
$$;

create function dlkt_info_billing.claim_notice(p_account text)
returns table(account_id text,event_id text,event_type text,object_id text,event_created bigint,attempt integer,lease_until timestamptz)
language plpgsql security definer set search_path = pg_catalog as $$
declare v_job dlkt_info_billing.event_jobs%rowtype; v_now timestamptz := clock_timestamp();
begin
  if p_account is null or p_account !~ '^acct_[A-Za-z0-9]{1,250}$' then
    raise exception using errcode = '22023', message = 'BILLING_ACCOUNT_INVALID';
  end if;
  -- Bounded dead-letter sweep; do not block on another worker's row lock.
  with exhausted as (
    select j.account_id,j.event_id from dlkt_info_billing.event_jobs j
    where j.account_id = p_account and j.state = 'leased' and j.attempt = 5 and j.lease_until <= v_now
    order by j.lease_until,j.event_id limit 32 for update skip locked
  )
  update dlkt_info_billing.event_jobs j
  set state='dead',lease_until=null,finished_at=v_now,outcome='attempts_exhausted'
  from exhausted e where j.account_id=e.account_id and j.event_id=e.event_id;
  select j.* into v_job from dlkt_info_billing.event_jobs j
  where j.account_id=p_account and j.attempt < 5
    and ((j.state='pending' and j.available_at <= v_now) or (j.state='leased' and j.lease_until <= v_now))
  order by case when j.state='leased' then j.lease_until else j.available_at end,j.event_id
  limit 1 for update skip locked;
  if not found then return; end if;
  update dlkt_info_billing.event_jobs j
  set state='leased',attempt=j.attempt+1,lease_until=clock_timestamp()+interval '30 seconds',
      outcome=null
  where j.account_id=v_job.account_id and j.event_id=v_job.event_id
  returning j.* into v_job;
  return query select n.account_id,n.event_id,n.event_type,n.object_id,n.event_created,v_job.attempt,v_job.lease_until
  from dlkt_info_billing.event_notices n
  where n.account_id=v_job.account_id and n.event_id=v_job.event_id;
end;
$$;

create function dlkt_info_billing.finish_notice(p_account text,p_event text,p_attempt integer,p_outcome text)
returns boolean
language plpgsql security definer set search_path = pg_catalog as $$
declare v_job dlkt_info_billing.event_jobs%rowtype; v_now timestamptz;
begin
  if p_attempt is null or p_attempt not between 1 and 5 or p_outcome is null
    or p_outcome not in ('routed','retry','permanent_failure') then
    raise exception using errcode = '22023', message = 'BILLING_OUTCOME_INVALID';
  end if;
  -- Lock first, then compare the database clock. A late or superseded worker
  -- cannot commit a result even if its statement began before lease expiry.
  select j.* into v_job from dlkt_info_billing.event_jobs j
  where j.account_id=p_account and j.event_id=p_event for update;
  if not found then return false; end if;
  v_now := clock_timestamp();
  if v_job.state <> 'leased' or v_job.attempt <> p_attempt or v_job.lease_until <= v_now then
    return false;
  end if;
  update dlkt_info_billing.event_jobs j
  set state=case when p_outcome='routed' then 'routed' when p_outcome='permanent_failure' or p_attempt=5 then 'dead' else 'pending' end,
      outcome=case when p_outcome='retry' and p_attempt=5 then 'attempts_exhausted' else p_outcome end,
      lease_until=null,
      finished_at=case when p_outcome='retry' and p_attempt<5 then null else v_now end,
      available_at=case when p_outcome='retry' and p_attempt<5 then v_now+interval '30 seconds' else j.available_at end
  where j.account_id=p_account and j.event_id=p_event;
  return true;
end;
$$;

-- Functions are a narrow machine-only capability boundary, not public RPCs.
-- Transfer ownership to a constrained, non-login role and remove its CREATE grant.
grant create on schema dlkt_info_billing to dlkt_billing_queue_owner;
alter function dlkt_info_billing.ingest_notice(text,text,text,text,bigint) owner to dlkt_billing_queue_owner;
alter function dlkt_info_billing.claim_notice(text) owner to dlkt_billing_queue_owner;
alter function dlkt_info_billing.finish_notice(text,text,integer,text) owner to dlkt_billing_queue_owner;
revoke create on schema dlkt_info_billing from dlkt_billing_queue_owner;
revoke all on function dlkt_info_billing.ingest_notice(text,text,text,text,bigint) from public,anon,authenticated,service_role,dlkt_billing_worker;
revoke all on function dlkt_info_billing.claim_notice(text) from public,anon,authenticated,service_role,dlkt_billing_worker;
revoke all on function dlkt_info_billing.finish_notice(text,text,integer,text) from public,anon,authenticated,service_role,dlkt_billing_worker;
grant execute on function dlkt_info_billing.ingest_notice(text,text,text,text,bigint) to service_role;
grant execute on function dlkt_info_billing.claim_notice(text), dlkt_info_billing.finish_notice(text,text,integer,text) to dlkt_billing_worker;
commit;
